var multiplex = require('multiplex');
var inherits = require('inherits');
var Duplex = require('readable-stream').Duplex;
var protobuf = require('protocol-buffers');
var fs = require('fs');
var through = require('through2');
var isarray = require('isarray');
var has = require('has');

var messages = protobuf(fs.readFileSync(__dirname + '/schema.proto'));
var TYPE = messages.TYPE;
var RPC = messages.RPC;

module.exports = Rep;
inherits(Rep, Duplex);

function Rep (fn) {
    var self = this;
    if (!(this instanceof Rep)) return new Rep(fn);
    Duplex.call(this);
    
    this._mplex = multiplex({}, function (stream, ch) {
        var seq = parseInt(ch, 16);
        var hseq = seq - 1;
        if (seq === 0) {
            stream.pipe(self._handleRPC());
        }
        else if (has(self._hashes, hseq)) {
            var hash = self._hashes[hseq];
            delete self._hashes[hseq];
            self.emit('response', hash, stream, hseq);
        }
        else self.destroy();
    });
    this._mplex.on('readable', function () {
        if (self._reading) {
            self._reading = false;
            self._read();
        }
    });
    this._rpc = this._mplex.createStream('0');
    
    this._provided = {};
    this._requested = {};
    this._hashes = {};
    this._index = 0;
    this._createReadStream = fn;
    this._closed = { local: false, remote: false };
}

Rep.prototype._read = function () {
    if (this._closed.remote && this._closed.local) return;
    
    var buf, times = 0;
    while ((buf = this._mplex.read()) !== null) {
        this.push(buf);
        times ++;
    }
    if (times === 0) this._reading = true;
};

Rep.prototype._write = function (buf, enc, next) {
    return this._mplex._write(buf, enc, next);
};

Rep.prototype.destroy = function () {
    this._mplex.destroy();
};

Rep.prototype._handleRPC = function () {
    var self = this;
    return through.obj(function (buf, enc, next) {
        var msg = decode(buf);
        if (!msg) return self.destroy();
        if (msg.type === TYPE.AVAILABLE) {
            var hs = msg.hashes.filter(function (h) {
                return !has(self._provided, h);
            });
            self.emit('available', hs);
            next();
        }
        else if (msg.type === TYPE.REQUEST) {
            self._handleRequest(msg.hashes, next);
        }
        else if (msg.type === TYPE.HASHES) {
            msg.mapping.forEach(function (m) {
                if (!has(self._requested, m.hash)) return self.destroy();
                if (has(self._hashes, m.sequence)) return self.destroy();
                self._hashes[m.sequence] = m.hash;
            });
            next();
        }
        else if (msg.type === TYPE.SINCE) {
            self.emit('since', msg.sequence - 1);
            next();
        }
        else if (msg.type === TYPE.SEEN) {
            self.emit('seen', msg.sequence - 1);
            next();
        }
        else if (msg.type === TYPE.ID) {
            self.emit('id', msg.hashes[0]);
            next();
        }
        else if (msg.type === TYPE.CLOSE) {
            self._closed.remote = true;
            if (self._closed.local) {
                self.emit('close');
                self.push(null);
            }
        }
        else next();
    });
    
    function decode (buf) {
        try { return RPC.decode(buf) }
        catch (err) { return null }
    }
};

Rep.prototype._handleRequest = function (hashes, next) {
    var self = this;
    var hs = [], rs = {};
    var pending = hashes.length;
    if (pending === 0) done();
    
    hashes.forEach(function (h) {
        if (!has(self._provided, h)) {
            if (-- pending === 0) done();
            return false;
        }
        self._createReadStream(h, function (err, r, seq) {
            if (r) {
                if (seq === undefined) seq = ++ self._index;
                rs[h] = { stream: r, sequence: seq };
                hs.push({ hash: h, sequence: seq });
            }
            if (-- pending === 0) done();
        });
    });
    
    function done () {
        self._rpc.write(RPC.encode({
            type: TYPE.HASHES,
            mapping: hs
        }));
        
        Object.keys(rs).forEach(function (hash) {
            var r = rs[hash].stream, seq = rs[hash].sequence;
            var stream = self._mplex.createStream((seq+1).toString(16));
            r.pipe(stream);
        });
        next();
    }
};

Rep.prototype.since = function (seq) {
    this._rpc.write(RPC.encode({
        type: TYPE.SINCE,
        sequence: seq + 1
    }));
};

Rep.prototype.seen = function (seq) {
    this._rpc.write(RPC.encode({
        type: TYPE.SEEN,
        sequence: seq + 1
    }));
};

Rep.prototype.id = function (id) {
    this._rpc.write(RPC.encode({
        type: TYPE.ID,
        hashes: [ id ]
    }));
};

Rep.prototype.provide = function (hashes) {
    var self = this;
    if (!isarray(hashes) && hashes && typeof hashes === 'object') {
        Object.keys(hashes).forEach(function (key) {
            self._provided[key] = hashes[key];
        });
    }
    else {
        if (!isarray(hashes)) hashes = [ hashes ];
        hashes.forEach(function (h) {
            self._provided[h] = true;
        });
    }
    self._rpc.write(RPC.encode({
        type: TYPE.AVAILABLE,
        hashes: hashes
    }));
};

Rep.prototype.request = function (hashes) {
    var self = this;
    if (!isarray(hashes)) hashes = [ hashes ];
    hashes.forEach(function (h) {
        self._requested[h] = true;
    });
    self._rpc.write(RPC.encode({
        type: TYPE.REQUEST,
        hashes: hashes
    }));
};

Rep.prototype.close = function () {
    this._rpc.write(RPC.encode({
        type: TYPE.CLOSE
    }));
    this._closed.local = true;
    if (this._closed.remote) {
        this.emit('close');
        this.push(null);
    }
};
