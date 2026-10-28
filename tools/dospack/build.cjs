// Builds web/library/dospack/ACDOS.PAK from tools/dospack/manifest.json.
// Drop extra items (OS ROMs, more DOS images) into tools/dospack/extra with a
// sibling <file>.json describing it: {"kind":"dos|rom|tool","id":"...","name":"...","version":"..."}
// Container: "ACDOSPK1" | u32le manifestLen | manifest JSON | blobs (raw deflate)
const fs = require('fs'), zlib = require('zlib'), path = require('path');
global.window = global; global.AC = {};
const root = path.resolve(__dirname, '..', '..') + path.sep;
(0, eval)(fs.readFileSync(root + 'web/js/dosfs.js', 'utf8'));
(0, eval)(fs.readFileSync(root + 'web/js/afmcore.js', 'utf8'));
const C = AC.AfmCore;
const man = JSON.parse(fs.readFileSync(__dirname + '/manifest.json', 'utf8'));
const items = man.entries.slice();
const xd = root + man.extraDir;
if (fs.existsSync(xd)) {
  for (const j of fs.readdirSync(xd).filter((f) => f.endsWith('.json'))) {
    const meta = JSON.parse(fs.readFileSync(path.join(xd, j), 'utf8'));
    meta.file = meta.file || ('tools/dospack/extra/' + j.slice(0, -5));
    items.push(meta);
  }
}
const blobs = [], out = [];
let off = 0;
for (const it of items) {
  let data = new Uint8Array(fs.readFileSync(root + it.file));
  const rec = { ...it };
  delete rec.file; delete rec.strip;
  if (it.strip && it.kind === 'dos') {
    const m = C.mount(data, path.basename(it.file));
    for (const e of C.entries(m)) if (!e.dir && man.strip.includes(e.name.toUpperCase())) { try { m.vol.remove(e.path); } catch (_) {} }
    C.refresh(m);
    data = new Uint8Array(m.bytes);
  }
  if (it.kind === 'dos') {
    const m = C.mount(data, 'x');
    rec.fs = m.kind;
    rec.free = m.vol.freeSectors();
    rec.files = C.entries(m).filter((e) => !e.dir).map((e) => e.name);
  }
  const z = zlib.deflateRawSync(Buffer.from(data), { level: 9 });
  rec.off = off; rec.len = z.length; rec.raw = data.length;
  off += z.length; blobs.push(z); out.push(rec);
}
const mj = Buffer.from(JSON.stringify({ format: man.format, built: new Date().toISOString(), items: out }), 'utf8');
const hdr = Buffer.alloc(12);
hdr.write(man.format, 0, 'latin1'); hdr.writeUInt32LE(mj.length, 8);
const dest = root + 'web/library/dospack/ACDOS.PAK';
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, Buffer.concat([hdr, mj, ...blobs]));
console.log('wrote', dest, fs.statSync(dest).size, 'bytes,', out.length, 'items');
for (const r of out) console.log(' ', r.kind.padEnd(5), r.id.padEnd(16), String(r.raw).padStart(9), '->', String(r.len).padStart(8), r.fs || '', r.free != null ? 'free ' + r.free : '');
