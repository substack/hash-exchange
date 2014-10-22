# hash-exchange

trade hashes to replicate data with a remote endpoint

[![build status](https://secure.travis-ci.org/substack/hash-exchange.png)](http://travis-ci.org/substack/hash-exchange)

Trading hashes is very useful for replication on top of a content-addressable
store where nodes have highly variable levels of information. This would be the
case for a gossip network.

# example

First, some code that takes messages on argv, hashes them, then provides those
hashes using hash-exchange:

``` js
var exchange = require('hash-exchange');
var through = require('through2');
var concat = require('concat-stream');
var shasum = require('shasum');

var messages = process.argv.slice(2);
var data = {};
messages.forEach(function (msg) { data[shasum(msg)] = msg });

var ex = exchange(function (hash) {
    var r = through();
    r.end(data[hash]);
    return r;
});
ex.provide(Object.keys(data));

ex.on('available', function (hashes) {
    ex.request(hashes);
});

ex.on('response', function (hash, stream) {
    stream.pipe(concat(function (body) {
        console.error('# BEGIN ' + hash);
        console.error(body.toString('utf8'));
        console.error('# END ' + hash);
    }));
});
process.stdin.pipe(ex).pipe(process.stdout);
```

Now we can run two instances of this program, one with:

``` js
[ 'beep', 'boop', 'hey yo' ]
```

and the other with

``` js
[ 'hey yo', 'WHATEVER', 'beep' ]
```

After wiring up the stdin and stdout, the programs provide each other with the
data they don't individually have:

```
$ dupsh 'node ex.js beep boop "hey yo"' 'node ex.js "hey yo" WHATEVER beep'
# BEGIN fdb608cccac07c273ab532bb41eea07e2ddccf4e
WHATEVER
# END fdb608cccac07c273ab532bb41eea07e2ddccf4e
# BEGIN ae8d904cebfd629cdb1cc773a5bce8aca1dc1eee
boop
# END ae8d904cebfd629cdb1cc773a5bce8aca1dc1eee
```

# methods

``` js
var exchange = require('hash-exchange')
```

## var ex = exchange(opts={}, fn)

Create a hash exchange instance `ex` from `fn(hash)`, a function that takes a
hash as an argument and should return a readable stream of data for `hash`.

`ex` is a duplex stream. You should pipe it to and from another hash exchange
instance, perhaps over a network link.

You can optionally provide:

* `opts.id` - a unique name to use for the connection. If the name is the same
as the remove, the connection will terminate. This name is emitted along with
`opts.meta` in the `'handshake'` event.
* `opts.meta` - initial metadata to send down in the initial handshake. This
data is emitted along with the `opts.id` in the `'handshake'` event.

## ex.provide(hashes)

Tell the remote endpoint about an array of `hashes`.

## ex.request(hashes)

Ask the remote endpoint to read the content of an array of `hashes`.

# events

## ex.on('handshake', function (id, meta) {})

As soon as the connection is established, both sides send a handshake with their
`id` and `meta` data. This event fires with the data from the remote instance.

## ex.on('response', function (hash, stream) {})

When a requested hash has been sent from the other end, this event fires with
the `hash` and a readable `stream` with the contents.

## ex.on('available', function (hashes) {})

After the other end of the connection has provided some hashes, this event fires
with the array of remote hashes not already provided locally.

# install

With [npm](https://npmjs.org) do:

```
npm install hash-exchange
```

# license

MIT