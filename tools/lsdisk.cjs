// Lists or extracts files from an Atari disk image using the web app's DOS reader.
// Usage: node tools/lsdisk.cjs DISK.ATR [NAME [OUTFILE]]
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
global.window = global; global.AC = {};
const load = (f) => (0, eval)(fs.readFileSync(path.join(root, 'web/js', f), 'utf8'));
load('dosfs.js'); load('afmcore.js');
const [img, name, outp] = process.argv.slice(2);
const m = AC.AfmCore.mount(new Uint8Array(fs.readFileSync(img)), 'x');
if (!name) { console.log(m.kind); for (const e of m.vol.list()) console.log(e.path || e.name, e.size); }
else {
  const e = m.vol.list().find((x) => (x.path || x.name).toUpperCase() === name.toUpperCase());
  const data = m.vol.read(e);
  if (outp) fs.writeFileSync(outp, Buffer.from(data)); else console.log(Buffer.from(data).toString('latin1'));
}
