var exchange = require('../');
var net = require('net');
var Readable = require('readable-stream').Readable;
var concat = require('concat-stream');
var shasum = require('shasum');

var messages = [ 'beep', 'boop', 'hey yo' ];
var data = {};
messages.forEach(function (msg) { data[shasum(msg)] = msg });

net.createServer(function (stream) {
    var ex = exchange(function (hash) {
        var r = new Readable;
        r._read = function () {};
        r.push(data[hash]);
        r.push(null);
        return r;
    });
    ex.provide(Object.keys(data));
    
    ex.on('available', function (hashes) {
        ex.request(hashes);
    });
    
    ex.on('response', function (hash, stream) {
        stream.pipe(concat(function (body) {
            console.log('# BEGIN ' + hash);
            console.log(body.toString('utf8'));
            console.log('# END ' + hash);
        }));
    });
    
    stream.pipe(ex).pipe(stream);
}).listen(5000);
