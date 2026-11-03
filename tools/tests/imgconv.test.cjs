// Tests for web/js/imgconv.js and tools/imgtool.cjs: node tools/tests/imgconv.test.cjs
global.window = global;
require('../../web/js/palette.js');
const I = require('../../web/js/imgconv.js');
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const { spawnSync } = require('child_process');
let bad = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } else console.log('ok  ', m); };
const ctx = { inflate: (b) => zlib.inflateSync(Buffer.from(b)), deflate: (b) => zlib.deflateSync(Buffer.from(b)) };
const grad = (w, h) => { const d = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; d[o] = (x * 255 / (w - 1)) | 0; d[o + 1] = (y * 255 / (h - 1)) | 0; d[o + 2] = 128; d[o + 3] = 255; } return { w, h, data: d }; };
const same = (a, b) => a.w === b.w && a.h === b.h && Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)) === 0;

const g = grad(37, 23);
const png = I.encodePNG(g), pngz = I.encodePNG(g, ctx);
ok(I.detect(png) === 'png' && I.info(png).w === 37 && I.info(png).h === 23, 'detect and info PNG');
ok(same(I.decodePNG(png, ctx), g), 'PNG stored round trip');
ok(same(I.decodePNG(pngz, ctx), g), 'PNG deflate round trip');
ok(pngz.length < png.length, 'deflate smaller than stored');
const bmp = I.encodeBMP(g);
ok(I.detect(bmp) === 'bmp' && I.info(bmp).w === 37, 'detect BMP');
ok(same(I.decodeBMP(bmp), g), 'BMP round trip');
{
  const gif = I.encodeGIF(g), back = I.decodeGIF(gif);
  ok(I.detect(gif) === 'gif' && I.info(gif).w === 37, 'GIF encode detected');
  const q = (x) => x & 0xe0; // 3-3-2 fallback loses low bits
  let exactOk = back.w === g.w && back.h === g.h, near = true;
  for (let i = 0; i < g.data.length; i += 4) { if (back.data[i] !== g.data[i] || back.data[i + 1] !== g.data[i + 1] || back.data[i + 2] !== g.data[i + 2]) exactOk = false; if (Math.abs(back.data[i] - g.data[i]) > 40) near = false; }
  ok(exactOk || near, 'GIF round trip (exact or 3-3-2)');
  const w = 300, h = 200, d = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { const x = i % w, y = (i / w) | 0; d[i * 4] = (x * 7 + y * 13) & 255; d[i * 4 + 1] = (x * y) & 255; d[i * 4 + 2] = (x ^ y) & 255; d[i * 4 + 3] = x < 10 ? 0 : 255; }
  const big = I.decodeGIF(I.encodeGIF({ w, h, data: d }));
  let good = big.w === w && big.h === h;
  for (let i = 0; i < w * h && good; i++) { if ((d[i * 4 + 3] === 0) !== (big.data[i * 4 + 3] === 0)) good = false; else if (d[i * 4 + 3] && Math.abs(big.data[i * 4] - d[i * 4]) > 40) good = false; }
  ok(good, 'GIF many colours + transparency + table reset');
  const two = { w: 2, h: 1, data: Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255) };
  ok(same(I.decodeGIF(I.encodeGIF(two)), two), 'GIF exact palette 2 colours');
  try { const fs = require('fs'), cp = require('child_process'); fs.writeFileSync('tools/tests/bin/_t.gif', I.encodeGIF({ w, h, data: d })); const r = cp.spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', 'tools/tests/bin/_t.gif', '-f', 'null', '-']); if (r.error) console.log('skip ffmpeg GIF check'); else ok(r.status === 0 && !String(r.stderr).trim(), 'ffmpeg reads our GIF'); } catch (e) { console.log('skip ffmpeg GIF check'); }
}
ok(I.detect(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 0)) === 'jpg', 'detect JPEG');
ok(I.detect(Buffer.from('GIF89a\x10\x00\x10\x00')) === 'gif' && I.info(Buffer.from('GIF89a\x10\x00\x20\x00\x00\x00\x00')).h === 32, 'detect and info GIF');
ok(I.detect(Buffer.from('RIFF\0\0\0\0WEBPVP8X'.padEnd(40, '\0'), 'latin1')) === 'webp', 'detect WebP');
ok(I.detect(new Uint8Array(7680), 'a.mic') === 'gr15' && I.detect(new Uint8Array(7680), 'a.gr8') === 'gr8' && I.detect(new Uint8Array(7680), 'a.pic') === 'gr9' && I.detect(new Uint8Array(7680), 'a.bin') === null && I.detect(new Uint8Array(100), 'a.mic') === null, 'detect Atari by extension and size');

// 1x1 GIF from the spec-sized sample (red pixel)
const gif = Buffer.from('R0lGODlhAQABAIAAAP8AAAAAACwAAAAAAQABAAACAkQBADs=', 'base64');
const gi = I.decodeGIF(gif);
ok(gi.w === 1 && gi.h === 1 && gi.data[0] === 255 && gi.data[1] === 0 && gi.data[3] === 255, 'GIF decode');

for (const fmt of ['gr8', 'gr9', 'gr15']) {
  const bytes = I.encodeAtari(g, fmt, {});
  ok(bytes.length === 7680, fmt + ' encodes 7680 bytes');
  const back = I.decodeAtari(bytes, fmt, {});
  ok(back.w === 320 && back.h === 192, fmt + ' decodes to 320x192');
  const again = I.encodeAtari(back, fmt, {});
  ok(Buffer.compare(Buffer.from(bytes), Buffer.from(again)) === 0, fmt + ' round trip is stable');
}
// GR.15 should use all four colours on a 4 shade strip
const strip = { w: 160, h: 192, data: new Uint8Array(160 * 192 * 4) };
const reg = [0x00, 0x28, 0xCA, 0x94], rgb = I.atariPalette({});
for (let y = 0; y < 192; y++) for (let x = 0; x < 160; x++) { const c = rgb(reg[x >> 5 & 3]); const o = (y * 160 + x) * 4; strip.data.set([c[0], c[1], c[2], 255], o); }
const sb = I.encodeAtari(strip, 'gr15', { colors: reg });
ok(sb[0] === 0x00 && sb[8] === 0x55 && sb[16] === 0xAA && sb[24] === 0xFF, 'GR.15 picks the right colour registers');
const dith = I.encodeAtari(grad(320, 192), 'gr8', { dither: true }), plain = I.encodeAtari(grad(320, 192), 'gr8', {});
ok(Buffer.compare(Buffer.from(dith), Buffer.from(plain)) !== 0, 'dither changes the output');

const rs = I.resize(g, 10, 10, 'contain');
ok(rs.w === 10 && rs.h === 10 && rs.data[3] === 255, 'resize contain');

const org = I.organize([{ name: 'a.png', bytes: png }, { name: 'b.png', bytes: pngz }, { name: 'c.bmp', bytes: bmp }, { name: 'n.txt', bytes: Buffer.from('hello') }, { name: 'p.mic', bytes: new Uint8Array(7680) }]);
ok(org.groups.png.length === 2 && org.groups.bmp.length === 1 && org.groups.gr15.length === 1 && org.unknown[0] === 'n.txt', 'organize groups by format');

const z = I.zip([{ name: 'a/one.txt', bytes: Buffer.from('hello world') }, { name: 'two.bin', bytes: Buffer.from([1, 2, 3]) }]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'img-'));
fs.writeFileSync(path.join(tmp, 't.zip'), z);
const py = spawnSync('python', ['-c', "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip(),z.read('a/one.txt').decode(),len(z.namelist()))", path.join(tmp, 't.zip')]);
ok(py.status === 0 && /^None hello world 2/.test(py.stdout.toString()), 'zip writer opens in Python zipfile');

// CLI
const src = path.join(tmp, 'src'); fs.mkdirSync(src);
fs.writeFileSync(path.join(src, 'x.png'), png); fs.writeFileSync(path.join(src, 'y.bmp'), bmp); fs.writeFileSync(path.join(src, 'z.mic'), new Uint8Array(7680)); fs.writeFileSync(path.join(src, 'readme.txt'), 'hi');
const cli = (...a) => spawnSync('node', [path.join(__dirname, '..', 'imgtool.cjs'), ...a], { encoding: 'utf8' });
let r = cli('scan', src);
ok(/png\s+1 files/.test(r.stdout) && /bmp\s+1 files/.test(r.stdout) && /gr15\s+1 files/.test(r.stdout) && /other\s+1 files/.test(r.stdout), 'CLI scan');
r = cli('find', src, 'bmp'); ok(r.stdout.trim().endsWith('y.bmp'), 'CLI find');
r = cli('organize', src, '--out', path.join(tmp, 'out'));
ok(fs.existsSync(path.join(tmp, 'out', 'PNG', 'x.png')) && fs.existsSync(path.join(tmp, 'out', 'BMP', 'y.bmp')) && fs.existsSync(path.join(tmp, 'out', 'Atari-GR15', 'z.mic')) && fs.existsSync(path.join(src, 'x.png')), 'CLI organize copies into per-format folders');
r = cli('organize', src, '--out', path.join(tmp, 'out2'), '--dry'); ok(!fs.existsSync(path.join(tmp, 'out2')) && /dry run/.test(r.stdout), 'CLI organize --dry changes nothing');
r = cli('convert', path.join(src, 'x.png'), '--to', 'gr15', '--out', path.join(tmp, 'c')); ok(r.status === 0 && fs.statSync(path.join(tmp, 'c', 'x.mic')).size === 7680, 'CLI PNG to GR.15');
r = cli('convert', path.join(tmp, 'c', 'x.mic'), '--to', 'png', '--out', path.join(tmp, 'c2')); ok(r.status === 0 && I.info(fs.readFileSync(path.join(tmp, 'c2', 'x.png'))).w === 320, 'CLI GR.15 to PNG');
r = cli('convert', path.join(src, 'y.bmp'), '--to', 'png', '--w', '20', '--out', path.join(tmp, 'c3')); ok(r.status === 0 && I.info(fs.readFileSync(path.join(tmp, 'c3', 'y.png'))).w === 20, 'CLI BMP to PNG resized');
const hasFF = spawnSync('ffmpeg', ['-version']).status === 0;
if (hasFF) { r = cli('convert', path.join(src, 'x.png'), '--to', 'jpg', '--out', path.join(tmp, 'c4')); ok(r.status === 0 && I.detect(fs.readFileSync(path.join(tmp, 'c4', 'x.jpg'))) === 'jpg', 'CLI PNG to JPEG via ffmpeg'); r = cli('convert', path.join(tmp, 'c4', 'x.jpg'), '--to', 'png', '--out', path.join(tmp, 'c5')); ok(r.status === 0 && I.info(fs.readFileSync(path.join(tmp, 'c5', 'x.png'))).w === 37, 'CLI JPEG to PNG via ffmpeg'); }
else console.log('skip ffmpeg tests (not installed)');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? bad + ' FAILED' : 'all passed');
process.exit(bad ? 1 : 0);
