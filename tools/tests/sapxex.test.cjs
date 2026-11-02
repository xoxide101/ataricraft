// Checks the SAP -> XEX builder on a tiny synthetic SAP (type B): INIT stores A at $0600, PLAYER increments $0601.
const assert = require('assert'), P = require('../../web/js/pmd.js'), X = require('../../web/js/sapxex.js');
const hdr = (extra) => Uint8Array.from(Buffer.from(`SAP\r\nNAME "T"\r\nTYPE B\r\nINIT 0600\r\nPLAYER 0610\r\n${extra}`, 'latin1'));
const body = [0xFF, 0xFF, 0x00, 0x06, 0x13, 0x06, 0x8D, 0x00, 0x20, 0x60, ...new Array(12).fill(0), 0xEE, 0x01, 0x20, 0x60];
const sap = (extra) => { const h = hdr(extra), o = new Uint8Array(h.length + body.length); o.set(h); o.set(body, h.length); return P.parseSap(o); };
assert.strictEqual(sap('').blocks.length, 1);
let r = X.build(sap(''));
assert.strictEqual(r.xex[0], 0xFF); assert(Buffer.from(r.xex).indexOf(Buffer.from([0x00, 0x06, 0x13, 0x06, 0x8D])) > 0, 'SAP block copied'); assert.strictEqual(r.stub, 0xBC00);
const x = Buffer.from(r.xex), find = (s) => x.indexOf(Buffer.from(s));
assert(find([0xA9, 0x00, 0x20, 0x00, 0x06]) > 0, 'stub calls INIT with song 0');
assert(find([0x20, 0x5C, 0xE4]) > 0 && find([0x20, 0x10, 0x06, 0x4C, 0x62, 0xE4]) > 0, 'VBI calls PLAYER then XITVBV');
assert.deepStrictEqual([...x.subarray(x.length - 6)], [0xE0, 0x02, 0xE1, 0x02, 0x00, 0xBC], 'RUNAD at the end');
r = X.build(sap('FASTPLAY 156\r\n'));
assert.strictEqual(r.warnings.filter((w) => /FASTPLAY/.test(w)).length, 0);
assert.strictEqual(Buffer.from(r.xex).indexOf(Buffer.from([0xA2, 156, 0x8D, 0x0A, 0xD4, 0xCA, 0xD0, 0xFA])) > 0, true, 'two calls per frame');
assert(X.build(sap('FASTPLAY 100\r\n')).warnings.some((w) => /FASTPLAY/.test(w)));
assert.throws(() => X.build(sap('SONGS 2\r\n'), { song: 5 }), /does not exist/);
assert.throws(() => X.build(P.parseSap(Uint8Array.from([...Buffer.from('SAP\r\nTYPE D\r\nINIT 0600\r\n'), ...body]))), /not supported/);
console.log('sapxex: all ok');
