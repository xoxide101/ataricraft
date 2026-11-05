// Checks that the generated browser bundle (web/js/xcwriter/core/xcw-core.js) behaves exactly like the Node tools.
// Runs the bundle in a vm context that has no Buffer/require/fs, opens every import sample and saves every format with both.
// Usage: node scripts/test-xcwriter-bundle.cjs
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib'), cp = require('child_process');
const root = path.join(__dirname, '..');
assert.strictEqual(cp.spawnSync('node', [path.join(__dirname, 'sync-xcwriter-core.cjs'), '--check'], { encoding: 'utf8' }).status, 0, 'generated core is out of date: run node scripts/sync-xcwriter-core.cjs');
const ctx = vm.createContext({ TextEncoder, TextDecoder, atob, btoa, console });
vm.runInContext(fs.readFileSync(path.join(root, 'web/js/xcwriter/core/xcw-core.js'), 'utf8'), ctx);
vm.runInContext('XCW', ctx);
assert(vm.runInContext('typeof require === "undefined" && typeof process === "undefined"', ctx));
const N = require('../tools/xcwcore.cjs');

const dir = path.join(root, 'docs', 'samples', 'import');
const guess = (f) => (/^(letterperfect|paperclip|firstxlent|textwizard|bankstreet)/.exec(f) || [])[1] || 'auto';
const inputs = fs.readdirSync(dir).filter((f) => !f.endsWith('.txt')).map((f) => [f, fs.readFileSync(path.join(dir, f)), guess(f)]);
inputs.push(['ACWRITER-DEMO.CWD', fs.readFileSync(path.join(root, 'docs/samples/ACWRITER-DEMO.CWD')), 'auto']);
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.txt'))) inputs.push([f, fs.readFileSync(path.join(dir, f)), 'text']);

// a deflate-compressed docx plus rtf/html/md, so the browser path through inflate and the importers is exercised
function recompress(zip) {
  const ents = []; let o = 0;
  while (zip.readUInt32LE(o) === 0x04034b50) {
    const sz = zip.readUInt32LE(o + 18), nl = zip.readUInt16LE(o + 26), name = zip.toString('utf8', o + 30, o + 30 + nl);
    ents.push([name, zip.subarray(o + 30 + nl, o + 30 + nl + sz)]); o += 30 + nl + sz;
  }
  const parts = [], cen = []; let off = 0;
  for (const [name, data] of ents) {
    const c = zlib.deflateRawSync(data), nb = Buffer.from(name), crc = N.crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(c.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(c.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nb, c); cen.push(ch, nb); off += 30 + nb.length + c.length;
  }
  const cd = Buffer.concat(cen), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(ents.length, 8); end.writeUInt16LE(ents.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
const doc = N.openDoc(Buffer.from('# Head\n\nHello **world** and *text*\n- bullet\n'), 'x.md').paras;
const deflated = recompress(N.save(doc, 'docx').bytes);
assert(deflated.length > 100);
inputs.push(['deflated.docx', deflated, 'auto']);
for (const f of ['rtf', 'html', 'md']) inputs.push(['gen.' + f, N.save(doc, f).bytes, 'auto']);
assert(N.plain(N.openDoc(deflated, 'd.docx').paras).includes('world'));

const FM = ['cwd', 'text', 'atascii', 'rtf', 'html', 'md', 'docx'];
let n = 0;
for (const [name, buf, fmt] of inputs) {
  const a = N.openDoc(buf, name, { format: fmt });
  ctx.IN = Uint8Array.from(buf); ctx.NAME = name; ctx.FMT = fmt;
  const b = vm.runInContext('(() => { const r = XCW.openDoc(IN, NAME, { format: FMT }); return JSON.stringify([r.format, r.paras, r.notes]); })()', ctx);
  assert.strictEqual(b, JSON.stringify([a.format, a.paras, a.notes]), name + ' open differs');
  for (const f of FM) {
    ctx.F = f; ctx.IN = Uint8Array.from(buf);
    const bb = vm.runInContext('(() => { const r = XCW.openDoc(IN, NAME, { format: FMT }); const s = XCW.save(r.paras, F); return Array.from(s.bytes).join(",") + "|" + s.report.join(";"); })()', ctx);
    const s = N.save(a.paras, f);
    assert.strictEqual(bb, Array.from(s.bytes).join(',') + '|' + s.report.join(';'), name + ' -> ' + f + ' differs');
    n++;
  }
  assert(a.paras.some((p) => N.ptext(p).trim()), name + ' opened empty');
}
console.log('ok: ' + inputs.length + ' inputs, ' + n + ' conversions identical in Node and the browser bundle');
