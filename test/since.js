var shasum = require('shasum');
var test = require('tape');
var exchange = require('../');
var Readable = require('readable-stream').Readable;
var concat = require('concat-stream');

var messages = {};
messages.a = [ 'hey yo', 'WHATEVER', 'beep', 'zoom' ];
messages.b = [ 'boop', 'beep', 'hey yo' ];

var data = { a: {}, b: {} };
var keys = { a: [], b: [] };
messages.a.forEach(function (msg) {
    var h = shasum(msg);
    data.a[h] = msg;
    keys.a.push(h);
});
messages.b.forEach(function (msg) {
    var h = shasum(msg);
    data.b[h] = msg;
    keys.b.push(h);
});

test('since', function (t) {
    t.plan(6);
    
    var a = exchange(function (hash, cb) {
        var r = new Readable;
        r._read = function () {};
        r.push(data.a[hash]);
        r.push(null);
        cb(null, r);
    });
    a.on('since', function (seq) {
        t.equal(seq, 2, 'A received sequence');
        a.provide(keys.a.slice(seq));
    });
    a.on('available', function (hashes) {
        t.deepEqual(hashes, [ shasum('hey yo') ], 'A received available');
        a.request(hashes);
    });
    a.on('response', function (hash, stream) {
        stream.pipe(concat(function (body) {
            t.equal(body.toString('utf8'), data.b[hash], 'A response');
        }));
    });
    a.since(1);
    
    var b = exchange(function (hash, cb) {
        var r = new Readable;
        r._read = function () {};
        r.push(data.b[hash]);
        r.push(null);
        cb(null, r);
    });
    b.on('since', function (seq) {
        t.equal(seq, 1, 'B received sequence');
        b.provide(keys.b.slice(seq));
    });
    b.on('available', function (hashes) {
        t.deepEqual(hashes, [ shasum('zoom') ], 'B received available');
        b.request(hashes);
    });
    b.on('response', function (hash, stream) {
        stream.pipe(concat(function (body) {
            t.equal(body.toString('utf8'), data.a[hash], 'B response');
        }));
    });
    b.since(2);
    
    a.pipe(b).pipe(a);
});
