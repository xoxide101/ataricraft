const assert = require('assert');
const { NDev, ERR, fixSpec, chdirPrefix, httpErr } = require('../../web/js/ndev.js');

const calls = [];
const net = {
  http(r) { calls.push(r); if (r.url.includes('missing')) return { status: 404, headers: [], body: new Uint8Array(0) }; return { status: 200, headers: [['Content-Type', 'text/plain']], body: Buffer.from(r.url.includes('json') ? '{"a":{"b":[1,2]},"s":"hi"}' : 'line1\r\nline2\n') }; },
};
const dev = NDev(net);
const mem = new Uint8Array(65536);
const A = 0x2000;
const str = (s) => { const b = Buffer.from(s + '\x9b'); mem.fill(0, A, A + 256); mem.set(b, A); };
const sio = (unit, cmd, aux, len) => dev.sio(0x70 + unit, cmd, 0, aux, A, len, mem);
const status = (u) => { sio(u, 0x53, 0, 4); return [...mem.subarray(A, A + 4)]; };
const rd = (u, n) => { mem.fill(0, A, A + n); const r = sio(u, 0x52, n, n); return [r, Buffer.from(mem.subarray(A, A + n))]; };

// TEST protocol, atari translation
str('N:TEST://x'); assert.strictEqual(sio(1, 0x4f, 4, 256), 0x43);
let s = status(1); assert.ok(s[0] > 90 && s[3] === 1, 'avail ' + s);
let [r, d] = rd(1, 8); assert.strictEqual(d.toString('latin1'), 'This is ');
rd(1, s[0] - 8);
s = status(1); assert.strictEqual(s[3], ERR.EOF);
sio(1, 0x43, 0, 0); assert.strictEqual(status(1)[3], ERR.NOT_CONN);

// translation CRLF -> 0x9b on HTTP
str('N2:HTTP://example.com/t.txt'); assert.strictEqual(sio(2, 0x4f, 4 | (3 << 8), 256), 0x43);
s = status(2); assert.strictEqual(s[3], 1);
[r, d] = rd(2, s[0]); assert.strictEqual(d.toString('latin1'), 'line1\x9bline2\x9b');

// 404 mapping
str('N:HTTP://example.com/missing'); sio(1, 0x4f, 4, 256); s = status(1); assert.strictEqual(s[3], 170);

// POST with headers, channel mode
str('N:HTTP://example.com/post'); sio(1, 0x4f, 13, 256);
sio(1, 0x4d, 3, 0); str('X-Test: yes'); assert.strictEqual(sio(1, 0x57, 11, 256), 0x43);
sio(1, 0x4d, 4, 0); str('a=1'); sio(1, 0x57, 3, 256);
sio(1, 0x4d, 0, 0); status(1);
const post = calls.pop(); assert.strictEqual(post.method, 'POST'); assert.strictEqual(post.headers['X-Test'], 'yes'); assert.strictEqual(Buffer.from(post.body).toString(), 'a=1');

// JSON parser
str('N:HTTP://example.com/json'); sio(1, 0x4f, 4, 256); sio(1, 0xfc, 1, 0);
assert.strictEqual(sio(1, 0x50, 0, 0), 0x43);
str('/a/b/1'); assert.strictEqual(sio(1, 0x51, 0, 256), 0x43);
s = status(1); [r, d] = rd(1, s[0]); assert.strictEqual(d.toString('latin1'), '2\x9b');
str('/nope'); assert.strictEqual(sio(1, 0x51, 0, 256), 0x45);

// prefix / chdir
assert.strictEqual(chdirPrefix('http://h/a/b/', '..'), 'http://h/a/');
assert.strictEqual(chdirPrefix('http://h/a/b/', '>'), 'http://h/');
assert.strictEqual(chdirPrefix('http://h/a/', 'c'), 'http://h/a/c');
assert.strictEqual(fixSpec('N1:TEST://a b.', '', false), 'TEST://ab');
str('http://example.com/'); sio(1, 0x2c, 0, 256);
str('N:json'); sio(1, 0x4f, 4, 256); assert.ok(calls.pop().url.endsWith('/json'));

// invalid / unknown
str('N:nonsense'); assert.strictEqual(sio(5, 0x4f, 4, 256), 0x45); assert.strictEqual(status(5)[3], ERR.BAD_SPEC);
str('N:foo://x'); assert.strictEqual(sio(1, 0x4f, 4, 256), 0x45);
assert.strictEqual(httpErr(503), 215); assert.strictEqual(httpErr(418), 214);
console.log('ndev ok');
