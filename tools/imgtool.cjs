// Image organizer and converter. Same code as the Workbench Images tab (web/js/imgconv.js).
//   node tools/imgtool.cjs info <file...>
//   node tools/imgtool.cjs scan <dir>                          count images by format (recurses)
//   node tools/imgtool.cjs find <dir> <fmt>                    list files of one format (png jpg gif bmp webp ico tiff gr8 gr9 gr15)
//   node tools/imgtool.cjs organize <dir> [--out DIR] [--move] [--dry]   sort into one folder per format (copy by default)
//   node tools/imgtool.cjs convert <file|dir...> --to <fmt> [--out DIR] [--w N --h N] [--fit contain|cover|stretch]
//                          [--dither] [--colors 00,28,CA,94] [--hue 0-15] [--video ntsc|pal] [--from gr8|gr9|gr15] [--native] [--trailer]
// PNG, BMP, GIF and the Atari raw formats are handled in pure code. JPEG, WebP, ICO and TIFF (and writing JPEG/WebP)
// use ffmpeg when it is on PATH. Atari colours are Atari colour bytes in hex: GR.15 = BAK,PF0,PF1,PF2; GR.8 = background,foreground;
// GR.9 = one hue (--hue) with 16 luminances. Atari output is 7680 raw bytes; Atari input is shown 320x192 unless --native.
// --trailer (GR.15): write the 4 MicroPainter colour bytes after the pixels (7684 bytes). A 7684-byte GR.15 input is read with them
// unless --colors is given. Byte order (PF0,PF1,PF2,BAK) is from memory of the format and not checked against MicroPainter.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { spawnSync } = require('child_process');
global.window = global;
require('../web/js/palette.js');
const I = require('../web/js/imgconv.js');

const args = process.argv.slice(2), cmd = args.shift();
const flags = new Set(['--move', '--dry', '--dither', '--native', '--trailer']);
const opt = {}, pos = [];
for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) { if (flags.has(args[i])) opt[args[i].slice(2)] = true; else opt[args[i].slice(2)] = args[++i]; } else pos.push(args[i]); }

const walk = (p, out) => {
  out = out || [];
  const st = fs.statSync(p);
  if (st.isDirectory()) fs.readdirSync(p).forEach((n) => walk(path.join(p, n), out));
  else out.push(p);
  return out;
};
const ff = (inBytes, inArgs, outArgs) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', ...inArgs, '-i', 'pipe:0', ...outArgs, 'pipe:1'], { input: Buffer.from(inBytes), maxBuffer: 1 << 29 });
  if (r.error || r.status !== 0) throw new Error('ffmpeg ' + (r.error ? 'not available' : r.stderr.toString().trim().split('\n').pop()));
  return new Uint8Array(r.stdout);
};
const ctx = {
  inflate: (b) => zlib.inflateSync(Buffer.from(b)),
  deflate: (b) => zlib.deflateSync(Buffer.from(b), { level: 9 }),
  external: (bytes, f) => I.decodePNG(ff(bytes, [], ['-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png']), ctx),
  externalEncode: (img, fmt) => ff(I.encodePNG(img, ctx), [], fmt === 'jpg' ? ['-f', 'mjpeg', '-q:v', '3'] : fmt === 'webp' ? ['-f', 'webp'] : fmt === 'gif' ? ['-f', 'gif'] : ['-f', 'image2pipe']),
  native: !!opt.native, trailer: !!opt.trailer, video: opt.video, dither: !!opt.dither, fit: opt.fit, from: opt.from,
  colors: opt.colors ? opt.colors.split(',').map((s) => parseInt(s, 16)) : null, hue: opt.hue !== undefined ? +opt.hue : undefined,
};
const fmtOf = (s) => { s = (s || '').toLowerCase(); return I.FORMATS[s] ? s : I.formatFromExt('x.' + s); };
const readAll = (paths) => paths.flatMap((p) => walk(p)).map((f) => ({ path: f, name: path.basename(f), bytes: new Uint8Array(fs.readFileSync(f)) }));
const usage = () => { console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); process.exit(1); };

if (cmd === 'info') {
  if (!pos.length) usage();
  for (const f of readAll(pos)) { const i = I.info(f.bytes, f.name); console.log(f.name + ': ' + (i ? i.format + ' ' + i.w + 'x' + i.h + ' ' + i.size + ' bytes' : 'not an image')); }
} else if (cmd === 'scan' || cmd === 'find') {
  if (!pos.length) usage();
  const want = cmd === 'find' ? fmtOf(pos[1]) : null;
  if (cmd === 'find' && !want) { console.log('unknown format ' + pos[1]); process.exit(1); }
  const files = readAll([pos[0]]), org = I.organize(files);
  if (cmd === 'find') { files.filter((f) => I.detect(f.bytes, f.name) === want).forEach((f) => console.log(f.path)); }
  else {
    Object.keys(org.groups).sort().forEach((k) => console.log(k.padEnd(6) + String(org.groups[k].length).padStart(6) + ' files  ' + org.groups[k].reduce((n, x) => n + x.size, 0) + ' bytes'));
    console.log('other'.padEnd(6) + String(org.unknown.length).padStart(6) + ' files (not images)');
  }
} else if (cmd === 'organize') {
  if (!pos.length) usage();
  const out = opt.out || path.join(pos[0], 'by-type');
  let n = 0;
  for (const f of readAll([pos[0]])) {
    if (path.resolve(f.path).startsWith(path.resolve(out) + path.sep)) continue;
    const fmt = I.detect(f.bytes, f.name);
    if (!fmt) continue;
    const dir = path.join(out, I.folderName(fmt));
    let dest = path.join(dir, f.name);
    for (let k = 2; fs.existsSync(dest); k++) dest = path.join(dir, path.basename(f.name, path.extname(f.name)) + '-' + k + path.extname(f.name));
    console.log((opt.move ? 'move ' : 'copy ') + f.path + ' -> ' + dest);
    if (!opt.dry) { fs.mkdirSync(dir, { recursive: true }); if (opt.move) fs.renameSync(f.path, dest); else fs.copyFileSync(f.path, dest); }
    n++;
  }
  console.log(n + ' image' + (n === 1 ? '' : 's') + (opt.dry ? ' (dry run)' : ''));
} else if (cmd === 'convert') {
  const to = fmtOf(opt.to);
  if (!pos.length || !to) usage();
  const files = readAll(pos).filter((f) => I.detect(f.bytes, f.name));
  if (!files.length) { console.log('no images found'); process.exit(1); }
  const dir = opt.out && (files.length > 1 || !path.extname(opt.out)) ? opt.out : null;
  let bad = 0;
  for (const f of files) {
    try {
      let img = I.decode(f.bytes, f.name, ctx);
      if (opt.w || opt.h) img = I.resize(img, +opt.w || Math.round(img.w * (+opt.h) / img.h), +opt.h || Math.round(img.h * (+opt.w) / img.w), ctx.fit);
      const bytes = I.encode(img, to, ctx);
      const base = path.basename(f.name, path.extname(f.name)) + '.' + I.extFor(to);
      const dest = dir ? path.join(dir, base) : opt.out || path.join(path.dirname(f.path), base);
      if (dir) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(dest, bytes);
      console.log(f.name + ' -> ' + dest + ' (' + bytes.length + ' bytes)');
    } catch (e) { bad++; console.log(f.name + ': ' + e.message); }
  }
  process.exit(bad ? 1 : 0);
} else usage();
