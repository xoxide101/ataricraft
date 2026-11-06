// craftcore tests: node scripts/craftcore-test.cjs
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const nodeCrypto = require('crypto');
const R = path.join(__dirname, '..') + path.sep;
const U = require(R + 'tools/craftcore/util.cjs');
const ENC = require(R + 'tools/craftcore/encodings.cjs');
const { Container, ContainerError, roundTrip } = require(R + 'tools/craftcore/container.cjs');
const A = require(R + 'tools/craftcore/adapters.cjs');
const F = require(R + 'tools/craftcore/framing.cjs');
const LB = require(R + 'tools/craftcore/loopback.cjs');
const P = require(R + 'tools/craftcore/profile.cjs');
const Transport = require(R + 'web/js/transport.js');

let n = 0;
const ok = (m) => { n++; console.log('ok  ' + m); };
const FIXED = '2026-01-01T00:00:00.000Z';
const rnd = U.prng(12345);
const rbytes = (len) => Uint8Array.from({ length: len }, () => Math.floor(rnd() * 256));
const rd = (p) => new Uint8Array(fs.readFileSync(R + p));

async function main() {
  // ---------------------------------------------------------------- util
  for (const len of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 65537]) {
    const b = rbytes(len);
    assert.strictEqual(U.sha256hex(b), nodeCrypto.createHash('sha256').update(b).digest('hex'), 'sha256 len ' + len);
    assert.strictEqual(U.crc32(b), zlib.crc32(b), 'crc32 len ' + len);
  }
  assert.strictEqual(U.sha256hex(U.enc('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.strictEqual(U.crc16(U.enc('123456789')), 0x29b1, 'CRC-16/CCITT-FALSE check value');
  assert.strictEqual(U.crc32(U.enc('123456789')), 0xcbf43926);
  assert.strictEqual(U.canonical({ b: 1, a: [2, { d: 1, c: undefined }] }), '{"a":[2,{"d":1}],"b":1}');
  ok('util: sha256 and crc32 agree with Node, crc16 check value, canonical JSON');

  // ---------------------------------------------------------------- encodings
  assert.strictEqual(ENC.decode(Uint8Array.of(72, 105, 0x9b), 'atascii').text, 'Hi\n');
  const inv = ENC.decode(Uint8Array.of(0xc8, 0x69), 'atascii'); // inverse H, i
  assert.strictEqual(inv.text, 'Hi'); assert.strictEqual(inv.lost.length, 1);
  assert.strictEqual(ENC.decode(Uint8Array.of(0x1c), 'atascii').lost.length, 1);
  assert.strictEqual(ENC.decode(Uint8Array.of(0x48, 0x49, 0x0d, 0xc1), 'petscii').text, 'hi\nA');
  assert.deepStrictEqual(Array.from(ENC.encode('Aa\n', 'petscii').bytes), [0xc1, 0x41, 0x0d]);
  const euro = ENC.encode('a\u20ac', 'ascii'); assert.deepStrictEqual(Array.from(euro.bytes), [97, 63]); assert.strictEqual(euro.lost[0].char, '\u20ac');
  for (const name of ['ascii', 'latin1', 'utf8', 'atascii', 'petscii']) { const t = 'Hello, world 123\n'; assert.strictEqual(ENC.decode(ENC.encode(t, name).bytes, name).text, t, name); }
  assert.ok(ENC.partial('atascii') && !ENC.partial('latin1'));
  ok('encodings: ATASCII/PETSCII/ASCII/Latin-1/UTF-8 round trips and loss lists');

  // ---------------------------------------------------------------- container core
  const c0 = Container.create({ type: 'test', name: 't.bin', created: FIXED, source: { kind: 'file', uri: 't.bin' } });
  c0.setOriginal(U.enc('hello'), { mediaType: 'text/plain' });
  c0.addDerived('upper.txt', U.enc('HELLO'), { kind: 'text', lossy: false, encoding: 'ascii' });
  c0.setSchema({ encoding: 'utf8', records: 1, fields: [{ name: 'a', type: 'string', size: 5, encoding: 'ascii' }, { name: 'n', type: 'int', native: 'INTEGER' }] });
  c0.addLoss({ code: 'demo', severity: 'info', where: 'original', count: 2, detail: 'demo' });
  assert.ok(c0.verify().ok, c0.verify().problems.join(';'));
  const bin = c0.serialize();
  assert.ok(U.equals(bin, c0.serialize()), 'serialize is deterministic');
  const c1 = Container.parse(bin);
  assert.ok(c1.verify().ok); assert.ok(U.equals(c1.serialize(), bin), 'parse then serialize is identical');
  assert.strictEqual(U.dec(c1.original()), 'hello'); assert.strictEqual(c1.manifest.schema.fields[1].type, 'int');
  assert.strictEqual(U.dec(bin.subarray(0, 4)), 'CCNT');
  for (const pos of [0, 5, 20, bin.length >> 1, bin.length - 40, bin.length - 1]) {
    const x = bin.slice(); x[pos] ^= 0x10;
    assert.throws(() => Container.parse(x), ContainerError, 'damage at ' + pos);
  }
  assert.throws(() => Container.parse(bin.subarray(0, bin.length - 5)), ContainerError);
  const t1 = Container.parse(bin); t1.blobs.set('upper.txt', U.enc('HELLX')); assert.ok(!t1.verify().ok, 'verify catches a changed blob');
  const t2 = Container.parse(bin); t2.manifest.schema.fields[0].type = 'varchar'; assert.ok(t2.verify().problems.some((p) => /unknown type/.test(p)));
  const files = c1.toFiles(); assert.ok(files.has('manifest.json') && files.has('derived/upper.txt'));
  assert.ok(U.equals(Container.fromFiles(files).serialize(), bin), 'folder form round trips');
  assert.throws(() => c0.addDerived('original', U.enc('x')), ContainerError);
  assert.throws(() => c0.addDerived('upper.txt', U.enc('x')), ContainerError);
  ok('container: deterministic file form, damage detection, verify, schema checks, folder form');

  // ---------------------------------------------------------------- round trips with real files
  const samples = {
    atr90: ['archive/blank/mydos_90K.atr', 'atr'], atr180: ['archive/blank/mydos_180K.atr', 'atr'], atrSdfs: ['archive/blank/sdfs_180K.atr', 'atr'],
    cwd: ['docs/samples/ACWRITER-DEMO.CWD', 'cwd'], cwd2: ['docs/samples/ebook/sampler.cwd', 'cwd'],
    f4: ['font/craft4.acf', 'acf'], f5: ['font/craft5.acf', 'acf'], f12: ['font/craft12.acf', 'acf'],
  };
  for (const [k, [file, ad]] of Object.entries(samples)) {
    const bytes = rd(file);
    assert.strictEqual(A.detect(bytes, file).name, ad, 'detect ' + file);
    const rt = roundTrip(A.ADAPTERS[ad], bytes, { name: path.basename(file), created: FIXED });
    assert.ok(rt.ok, file + ': ' + (rt.identical ? 'container invalid' : 'first difference at byte ' + rt.firstDiff));
    assert.strictEqual(rt.sizeIn, rt.sizeOut);
    assert.ok(U.equals(rt.container.original(), bytes), 'the original bytes are kept');
    assert.strictEqual(rt.container.manifest.source.sha256, U.sha256hex(bytes));
    ok('round trip ' + ad + ' ' + file + ' (' + bytes.length + ' bytes) identical, ' + rt.container.manifest.derived.length + ' derived, ' + rt.losses.length + ' loss entries');
  }

  // ATR facts
  const atr = A.atr.import(rd('archive/blank/mydos_90K.atr'), { name: 'm.atr', created: FIXED });
  const ai = JSON.parse(U.dec(atr.blob('atr.json')));
  assert.strictEqual(ai.sectorSize, 128); assert.strictEqual(ai.sectors, 720);
  const atr2 = A.atr.import(rd('archive/blank/mydos_180K.atr'), { created: FIXED });
  const ai2 = JSON.parse(U.dec(atr2.blob('atr.json'))); assert.deepStrictEqual([ai2.sectorSize, ai2.sectors], [256, 720]);
  // synthetic DOS 2 disk with one file: catalog and file checksum
  const body = U.enc('HELLO ATARI'), img = new Uint8Array(720 * 128), put = (s, o, v) => { img[(s - 1) * 128 + o] = v; };
  img.set(body, 0 + 400 * 128 - 0); // file data sector 401
  img.fill(0, 400 * 128, 401 * 128); img.set(body, 400 * 128); put(401, 125, 0); put(401, 126, 0); put(401, 127, body.length);
  const de = (361 - 1) * 128; img[de] = 0x42; img[de + 1] = 1; img[de + 3] = 401 & 255; img[de + 4] = 401 >> 8; img.set(U.enc('HELLO   TXT'), de + 5);
  const hdr = new Uint8Array(16); hdr[0] = 0x96; hdr[1] = 0x02; hdr[2] = (img.length / 16) & 255; hdr[3] = (img.length / 16) >> 8; hdr[4] = 128;
  const synth = U.concat([hdr, img]);
  const sc = A.atr.import(synth, { created: FIXED }), cat = JSON.parse(U.dec(sc.blob('catalog.json')));
  assert.strictEqual(cat.files.length, 1); assert.strictEqual(cat.files[0].name, 'HELLO.TXT'); assert.strictEqual(cat.files[0].size, body.length);
  assert.strictEqual(cat.files[0].sha256, U.sha256hex(body)); assert.ok(cat.files[0].chainOk);
  assert.ok(sc.losses().some((l) => l.code === 'catalog-heuristic' && l.severity === 'info'));
  assert.ok(roundTrip(A.atr, synth).ok);
  // ATR with extra trailing bytes and a short image still round-trips, and says so
  const odd = U.concat([synth, Uint8Array.of(1, 2, 3)]); const ort = roundTrip(A.atr, odd);
  assert.ok(ort.ok && ort.losses.some((l) => l.code === 'atr-size-mismatch'));
  assert.throws(() => A.atr.import(U.enc('not an atr at all....')));
  ok('atr: header facts, DOS 2 catalog with per-file sha256, size mismatch reported and kept');

  // CWD: loss report
  const demo = A.cwd.import(rd('docs/samples/ACWRITER-DEMO.CWD'), { created: FIXED });
  assert.ok(demo.manifest.blobs['text.txt'].lossy);
  assert.ok(U.dec(demo.blob('text.txt')).length > 100);
  const codes = demo.losses().map((l) => l.code);
  assert.ok(codes.includes('style-codes-dropped') || codes.includes('paragraph-markers-dropped'), 'demo document carries styles: ' + codes);
  assert.ok(!demo.isLossless());
  // hand-built document: bold toggles, centre marker, graphics char, no-break space, soft line end, bad checksum
  const payload = Uint8Array.of(15, 1, 72, 105, 1, 14, 128, 160, 173, 13);
  const cw = new Uint8Array(16 + payload.length), cdv = new DataView(cw.buffer);
  cw.set(U.enc('CRFT')); cw[4] = 1; cw[5] = 0x57; cdv.setUint16(8, payload.length, true); cdv.setUint16(10, 2, true); cw[12] = 64; cw[13] = 20; cdv.setUint16(14, 9999, true); cw.set(payload, 16);
  const cc = A.cwd.import(cw, { created: FIXED }), L = Object.fromEntries(cc.losses().map((l) => [l.code, l]));
  assert.strictEqual(L['style-codes-dropped'].count, 2); assert.strictEqual(L['paragraph-markers-dropped'].count, 1);
  assert.strictEqual(L['atari-graphics-chars'].count, 1); assert.deepStrictEqual(L['atari-graphics-chars'].samples, [6]);
  assert.strictEqual(L['checksum-mismatch'].severity, 'warn');
  assert.strictEqual(U.dec(cc.blob('text.txt')), 'Hi \ufffd\u00a0\u2011\n');
  assert.ok(roundTrip(A.cwd, cw).ok, 'a wrong stored checksum is kept, not silently fixed');
  const withTrailer = U.concat([cw, Uint8Array.of(7, 7, 7)]); const wt = roundTrip(A.cwd, withTrailer);
  assert.ok(wt.ok && wt.container.hasBlob('trailer.bin'));
  assert.throws(() => A.cwd.import(cw.subarray(0, 20)));
  const ft = A.cwd.fromText('Line one\nCaf\u00e9 \u20ac5\n'); assert.strictEqual(ft.lost.length, 1);
  assert.ok(A.cwd.import(ft.bytes).losses('warn').length === 0, 'a document we write has a valid checksum');
  ok('cwd: loss report counts styles, markers, graphics, checksum; trailer kept; text -> CWD reports unmappable characters');

  // font
  const fc = A.acf.import(rd('font/craft5.acf'), { created: FIXED });
  assert.ok(fc.isLossless() && fc.losses().length === 0);
  assert.strictEqual(JSON.parse(U.dec(fc.blob('font.json'))).adv, 5);
  const odd5 = rd('font/craft5.acf'); const oddc = A.acf.import(odd5);
  assert.throws(() => A.acf.import(U.enc('nope')));
  ok('font: derived JSON carries the metrics, lossless');

  // raw fallback + detect
  const rawBytes = rbytes(777), rr = roundTrip(A.raw, rawBytes); assert.ok(rr.ok); assert.strictEqual(A.detect(rawBytes, 'x.bin').name, 'raw');
  ok('raw adapter and detect fallback');

  // ---------------------------------------------------------------- profiles
  const dir = R + 'tools/craftcore/profiles/';
  const profiles = {};
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const p = JSON.parse(fs.readFileSync(dir + f, 'utf8')); profiles[p.id] = p;
    const r = P.validate(p); assert.ok(r.ok, f + ': ' + r.errors.join('; '));
    assert.ok(r.warnings.length === 0, f + ' warnings: ' + r.warnings.join('; '));
  }
  assert.deepStrictEqual(Object.keys(profiles).sort(), ['atari8', 'c64', 'nes', 'zx-spectrum']);
  assert.strictEqual(profiles.atari8.status, 'complete'); assert.ok(['zx-spectrum', 'c64', 'nes'].every((k) => profiles[k].status === 'stub'));
  const clone = () => JSON.parse(JSON.stringify(profiles.atari8));
  const errs = (p) => P.validate(p).errors.join('|');
  let b = clone(); b.memory.regions.push({ name: 'dup', start: 100, end: 200, type: 'ram' }); assert.match(errs(b), /overlap/);
  b = clone(); b.memory.regions[0].end = 70000; assert.match(errs(b), /start\/end/);
  b = clone(); b.video.palette.rgb = [1]; assert.match(errs(b), /does not|has a value/);
  b = clone(); b.cpu.clockHz = null; assert.match(errs(b), /not listed in unknown/);
  b = clone(); b.roms.policy = 'embedded'; assert.match(errs(b), /local-only/);
  b = clone(); b.roms.list[0].data = 'A'.repeat(400); assert.match(errs(b), /embedded data/);
  b = clone(); b.roms.list[0].sha256 = 'xyz'; assert.match(errs(b), /sha256/);
  b = clone(); b.unknown = ['no.such.path']; assert.match(errs(b), /does not exist/);
  b = clone(); delete b.audio; assert.match(errs(b), /audio is required/);
  b = clone(); b.video.modes.push(b.video.modes[0]); assert.match(errs(b), /duplicate id/);
  b = clone(); b.id = 'Bad Id'; assert.match(errs(b), /id must/);
  b = clone(); b.memory.regions.pop(); b.memory.regions.pop(); b.memory.regions.pop(); b.memory.regions.pop(); b.memory.regions.pop(); b.memory.regions.splice(0, 1); assert.ok(P.validate(b).warnings.length > 0, 'a gap in the base layer warns');
  assert.ok(!P.validate(null).ok && !P.validate([]).ok);
  ok('profiles: atari8 + 3 stubs validate; 12 broken variants are rejected');

  // ---------------------------------------------------------------- framing
  // codec names match the existing transport.js error names
  for (const nm of ['NotFound', 'Exists', 'NotAllowed', 'BadToken', 'Unreachable', 'Unsupported', 'Error']) assert.ok(F.ERRORS[nm] > 0, nm);
  assert.ok(Transport.PROTOCOL === F.PROTOCOL, 'protocol number matches transport.js');
  for (const op of Transport.WRITE_OPS) if (op.startsWith('fs.')) assert.ok(F.OPCODES[op], 'opcode for ' + op);
  assert.strictEqual(F.errorName(F.errorCode('Timeout')), 'Timeout'); assert.strictEqual(F.errorName(999), 'Error');

  const opKeys = Object.keys(F.OPCODES); assert.strictEqual(new Set(Object.values(F.OPCODES)).size, opKeys.length, 'opcodes are unique');
  // frame fuzz
  for (let i = 0; i < 3000; i++) {
    const f = { type: 1 + Math.floor(rnd() * 3), msgId: Math.floor(rnd() * 65536), seq: Math.floor(rnd() * 65536), more: rnd() < 0.5, crc32: rnd() < 0.5, payload: rbytes(Math.floor(rnd() * (rnd() < 0.1 ? 3000 : 300))) };
    const w = F.encodeFrame(f), r = F.parseFrame(w);
    assert.ok(r.frame && r.used === w.length, 'parse ' + i);
    assert.deepStrictEqual([r.frame.type, r.frame.msgId, r.frame.seq, r.frame.more, r.frame.crc32], [f.type, f.msgId, f.seq, f.more, f.crc32]);
    assert.ok(U.equals(r.frame.payload, f.payload));
    for (let cut = 0; cut < 3; cut++) { const k = Math.floor(rnd() * w.length); assert.ok(F.parseFrame(w.subarray(0, k)).need > 0 || k === 0 || F.parseFrame(w.subarray(0, k)).error, 'truncated frame is never accepted'); }
  }
  ok('framing: 3000 random frames encode/decode exactly (CRC-16 and CRC-32), truncation never accepted');
  // every single-bit error is detected (both CRCs)
  for (const crc32 of [false, true]) {
    const w = F.encodeFrame({ type: 1, msgId: 7, seq: 3, more: true, crc32, payload: rbytes(40) });
    for (let bit = 8; bit < w.length * 8; bit++) { const x = w.slice(); x[bit >> 3] ^= 1 << (bit & 7); assert.ok(!F.parseFrame(x).frame, 'bit ' + bit + ' accepted'); }
  }
  ok('framing: every single-bit flip is rejected');
  // decoder: garbage, fragments, resync
  const dec0 = new F.Decoder();
  for (let i = 0; i < 500; i++) assert.doesNotThrow(() => dec0.push(rbytes(Math.floor(rnd() * 600))));
  const frames = Array.from({ length: 40 }, (_, i) => ({ type: 1, msgId: i, seq: 0, more: false, crc32: i % 2 === 0, payload: rbytes(1 + Math.floor(rnd() * 200)) }));
  const stream = U.concat(frames.flatMap((f) => [rbytes(Math.floor(rnd() * 5)).map((x) => (x === F.SYNC ? 0 : x)), F.encodeFrame(f)]));
  const d1 = new F.Decoder(), got = [];
  for (let p = 0; p < stream.length;) { const k = 1 + Math.floor(rnd() * 20); got.push(...d1.push(stream.subarray(p, p + k))); p += k; }
  assert.deepStrictEqual(got.map((f) => f.msgId), frames.map((f) => f.msgId), 'frames survive random fragmentation and leading garbage');
  const dmg = U.concat(frames.slice(0, 5).map((f) => F.encodeFrame(f))); dmg[F.HEADER + 3] ^= 0x55; // hurt frame 0's payload
  const d2 = new F.Decoder(); const g2 = d2.push(dmg);
  assert.deepStrictEqual(g2.map((f) => f.msgId), [1, 2, 3, 4], 'a damaged frame costs only itself'); assert.ok(d2.stats.badChecksum >= 1);
  const lenBomb = F.encodeFrame(frames[0]); lenBomb[8] = 0xff; lenBomb[9] = 0xff;
  const d3 = new F.Decoder(4096); assert.deepStrictEqual(d3.push(U.concat([lenBomb, F.encodeFrame(frames[1])])).map((f) => f.msgId), [1], 'a corrupted length cannot stall the decoder');
  const verBad = F.encodeFrame(frames[0]); verBad[1] = 9; assert.strictEqual(F.parseFrame(verBad).error, 'BadChecksum'); // version is covered by the checksum
  ok('framing: decoder survives garbage, fragmentation, damage, length bombs');
  // chunking
  for (const [len, mc] of [[0, 64], [1, 64], [63, 64], [64, 64], [65, 64], [1000, 1], [5000, 256], [70000, 65535]]) {
    const pl = rbytes(len), ch = F.chunk(1, 9, pl, { maxChunk: mc });
    assert.strictEqual(ch.length, Math.max(1, Math.ceil(len / mc))); assert.ok(ch.every((c, i) => c.seq === i && c.more === (i < ch.length - 1) && c.payload.length <= mc));
    assert.ok(U.equals(U.concat(ch.map((c) => c.payload)), pl));
  }
  ok('framing: chunking splits and rejoins exactly');
  // messages
  for (let i = 0; i < 400; i++) {
    const op = rnd() < 0.5 ? opKeys[Math.floor(rnd() * opKeys.length)] : 'app.custom' + Math.floor(rnd() * 99), args = { path: '/a/b' + i, n: i, s: '\u00e9\u20ac', nested: { x: [1, 2, null] } }, body = rbytes(Math.floor(rnd() * 500));
    const r = F.decodeRequest(F.encodeRequest({ op, args, body }));
    assert.strictEqual(r.op, op); assert.deepStrictEqual(r.args, args); assert.ok(U.equals(r.body, body));
  }
  const okReply = F.encodeReply({ ok: true, meta: { value: [1, 2] }, body: Uint8Array.of(9, 8) }), dr = F.decodeReply(okReply.type, okReply.payload);
  assert.deepStrictEqual([dr.ok, dr.meta, Array.from(dr.body)], [true, { value: [1, 2] }, [9, 8]]);
  for (const nm of Object.keys(F.ERRORS).filter((k) => k !== 'OK')) { const e = F.encodeReply({ ok: false, error: { name: nm, message: 'm ' + nm, code: 167 } }), d = F.decodeReply(e.type, e.payload); assert.strictEqual(e.type, F.TYPE.ERR); assert.deepStrictEqual([d.ok, d.error.name, d.error.code, d.error.message, d.error.native], [false, nm, F.ERRORS[nm], 'm ' + nm, 167]); }
  assert.throws(() => F.decodeRequest(Uint8Array.of(0)), F.ProtocolError); assert.throws(() => F.decodeRequest(Uint8Array.of(1, 5, 0)), F.ProtocolError);
  assert.throws(() => F.decodeRequest(Uint8Array.of(200, 0, 0)), /unknown opcode/); assert.throws(() => F.decodeRequest(Uint8Array.of(1, 2, 0, 123, 34)), F.ProtocolError);
  assert.throws(() => F.encodeRequest({ op: 'x'.repeat(300) }), F.ProtocolError);
  for (let i = 0; i < 2000; i++) assert.doesNotThrow(() => { try { F.decodeRequest(rbytes(Math.floor(rnd() * 40))); } catch (e) { if (!(e instanceof F.ProtocolError)) throw e; } });
  ok('framing: request/reply messages round trip, all error codes, malformed messages only raise ProtocolError');

  // ---------------------------------------------------------------- loopback transport
  const T = (o) => LB.loopback(Object.assign({ ackTimeoutMs: 5, replyTimeoutMs: 8000 }, o));
  let lb = T({ maxChunk: 64 });
  assert.strictEqual((await lb.open()).state, 'open'); assert.strictEqual(lb.status().caps.protocol, 1);
  for (const m of ['open', 'send', 'receive', 'close', 'status', 'on', 'off']) assert.strictEqual(typeof lb[m], 'function', 'interface ' + m);
  const big = rbytes(20000), echo = await lb.send({ op: 'sys.echo', args: { k: 1 }, body: big });
  assert.ok(echo.ok && U.equals(echo.body, big) && echo.meta.k === 1); assert.ok(lb.client.stats.sent >= 20000 / 64);
  lb.handle('fs.list', (a) => ({ meta: { value: [{ name: a.path, dir: false, size: 3 }] } }));
  lb.handle('fs.read', () => { const e = new Error('no such file'); e.name = 'NotFound'; throw e; });
  lb.handle('fs.write', () => ({ meta: { written: true } }));
  const ls = await lb.send({ op: 'fs.list', args: { path: '/x' } }); assert.deepStrictEqual(ls.meta.value[0].name, '/x');
  const nf = await lb.send({ op: 'fs.read', args: { path: '/nope' } }); assert.deepStrictEqual([nf.ok, nf.error.name, nf.error.code], [false, 'NotFound', 2]);
  assert.strictEqual((await lb.send({ op: 'nothing.here' })).error.name, 'Unsupported');
  lb.handle('boom', () => { throw new Error('kaput'); }); const bm = await lb.send({ op: 'boom' }); assert.deepStrictEqual([bm.ok, bm.error.name, bm.error.message], [false, 'Error', 'kaput']);
  const ev = lb.receive(2000); await lb.pushEvent('fs.changed', { path: '/z' }, Uint8Array.of(1)); const e1 = await ev; assert.strictEqual(e1.op, 'fs.changed'); assert.strictEqual(e1.args.path, '/z');
  assert.strictEqual(await lb.receive(20), null, 'receive times out with null');
  const seen = []; lb.on('message', (m) => seen.push(m.op)); await lb.pushEvent('a.b'); await new Promise((r) => setTimeout(r, 20)); assert.deepStrictEqual(seen, ['a.b']);
  await lb.close(); assert.strictEqual((await lb.send({ op: 'sys.ping' })).error.name, 'Unreachable'); assert.strictEqual(lb.status().state, 'closed');
  ok('loopback: interface, large echo, handlers, error mapping, events, close');

  // write protection (client side and server side), same rule as transport.js
  lb = T({ caps: { allowWrite: false } }); await lb.open();
  lb.handle('fs.write', () => ({ meta: {} })); lb.handle('fs.read', () => ({ meta: { v: 1 } }));
  const w1 = await lb.send({ op: 'fs.write', args: { path: '/a' }, body: Uint8Array.of(1) }); assert.deepStrictEqual([w1.ok, w1.error.name], [false, 'NotAllowed']);
  assert.ok((await lb.send({ op: 'fs.read', args: {} })).ok);
  assert.strictEqual((await lb.send({ op: 'net.http', args: { method: 'DELETE', url: 'x' } })).error.name, 'NotAllowed');
  lb.caps.allowWrite = true; // the client believes writes are fine: the far end must still refuse
  const w3 = await lb.send({ op: 'fs.write', args: { path: '/a' }, body: Uint8Array.of(1) }); assert.deepStrictEqual([w3.ok, w3.error.name], [false, 'NotAllowed']);
  ok('loopback: read-only mode refuses writes (fs.*, net.http PUT/DELETE/PATCH, sql.exec)');

  // faulty wire: loss, corruption, duplication, fragmentation; every message must arrive exact
  const faultSets = [{ seed: 1, drop: 0.1 }, { seed: 2, corrupt: 0.15 }, { seed: 3, dup: 0.2, fragment: 0.5 }, { seed: 4, drop: 0.08, corrupt: 0.08, dup: 0.08, fragment: 0.6 }];
  for (const faults of faultSets) {
    for (const [mc, crc32] of [[32, false], [200, true]]) {
      const l = T({ maxChunk: mc, crc32, faults, retries: 60 }); l.handle('sys.echo2', (a, body) => ({ meta: { n: body.length, a }, body }));
      await l.open();
      for (let i = 0; i < 12; i++) {
        const body = rbytes(Math.floor(rnd() * (i % 4 === 0 ? 3000 : 300))), r = await l.send({ op: 'sys.echo2', args: { i }, body });
        assert.ok(r.ok, JSON.stringify(faults) + ' msg ' + i + ': ' + (r.error && r.error.message));
        assert.ok(U.equals(r.body, body) && r.meta.n === body.length && r.meta.a.i === i, 'body identical under ' + JSON.stringify(faults));
      }
      const ws = l.wire.stats, st = l.client.stats; if (faults.drop || faults.corrupt) assert.ok(st.retransmits + l.server.stats.retransmits > 0, 'faults were really injected');
      if (faults.dup) assert.ok(ws.duplicated > 0 && (st.duplicates + l.server.stats.duplicates) > 0, 'duplicates were ignored');
      await l.close();
    }
  }
  ok('loopback: 96 messages (up to 3 KB, chunks of 32 and 200, CRC-16 and CRC-32) exact under drop/corrupt/duplicate/fragment faults');
  // dead wire: the sender gives up with Timeout
  const dead = T({ faults: { seed: 9, drop: 1 }, retries: 2, ackTimeoutMs: 3, replyTimeoutMs: 200 });
  const o2 = await dead.open(); assert.strictEqual(o2.state, 'error');
  const dr2 = await dead.send({ op: 'sys.ping' }); assert.deepStrictEqual([dr2.ok, dr2.error.name], [false, 'Timeout']);
  ok('loopback: a dead link reports Timeout instead of hanging');

  // stop-and-wait Endpoint pair over a direct pipe: ordering and unlimited-size message check
  const wp = LB.wirePair({ seed: 5, drop: 0.05, corrupt: 0.05 }), inbox = [];
  const ea = new F.Endpoint({ write: (x) => wp.a.write(x), maxChunk: 50, ackTimeoutMs: 4, retries: 50, onMessage: () => {} });
  const eb = new F.Endpoint({ write: (x) => wp.b.write(x), maxChunk: 50, ackTimeoutMs: 4, retries: 50, onMessage: (m) => inbox.push(m) });
  wp.a.onBytes = (x) => ea.receive(x); wp.b.onBytes = (x) => eb.receive(x);
  const msgs = Array.from({ length: 10 }, () => rbytes(Math.floor(rnd() * 400))); await Promise.all(msgs.map((m, i) => ea.send(F.TYPE.REQ, i + 1, m)));
  assert.strictEqual(inbox.length, 10); msgs.forEach((m, i) => assert.ok(U.equals(inbox[i].payload, m) && inbox[i].msgId === i + 1, 'ordered message ' + i));
  ok('endpoint: queued messages arrive in order and exact over a lossy pipe');

  // browser-usable: the modules load with only a global (no require/module)
  const vm = require('vm'), ctx = { self: {}, TextEncoder, TextDecoder, setTimeout, clearTimeout, setImmediate, console }; ctx.self = ctx; vm.createContext(ctx);
  for (const f of ['util', 'encodings', 'container', 'adapters', 'framing', 'loopback', 'profile']) vm.runInContext(fs.readFileSync(R + 'tools/craftcore/' + f + '.cjs', 'utf8'), ctx, { filename: f });
  const BC = ctx.AC.CraftCore; assert.ok(BC.Container && BC.framing && BC.profile && BC.adapters && BC.loopback && BC.encodings);
  const bc = BC.adapters.atr.import(synth, { created: FIXED }); assert.ok(bc.verify().ok); assert.strictEqual(BC.util.sha256hex(synth), U.sha256hex(synth));
  assert.strictEqual(bc.serialize().length, A.atr.import(synth, { created: FIXED }).serialize().length);
  ok('browser form: all modules load without require/module and produce the same results');

  console.log('\n' + n + ' checks passed');
}
main().then(() => process.exit(0), (e) => { console.error('FAIL', e); process.exit(1); });
