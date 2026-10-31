#!/usr/bin/env node
// libcheck: read-only audit of a folder of Atari disk images (ATR, XFD, ATX, DCM, PRO).
//   node tools/libcheck.cjs <folder> [--csv out.csv] [--json out.json]
// Reports exact duplicates (same file), content duplicates (same sectors in a different container, e.g. ATX vs ATR or an
// ATR with a different header), files whose extension lies about the container, ATR headers that disagree with the file
// size, copy-protected ATX images, images that cannot be parsed, and a DOS 2 / MyDOS deleted-file and hidden-data summary.
// Nothing is renamed, moved or deleted.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const W = path.join(__dirname, '..', 'web', 'js');
const DC = require(path.join(W, 'diskconv.js')), DOS = require(path.join(W, 'dosfs.js')), AUD = require(path.join(W, 'diskaudit.js'));

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const root = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
if (!root) { console.log('usage: node tools/libcheck.cjs <folder> [--csv out.csv] [--json out.json]'); process.exit(1); }

const EXT = /\.(atr|xfd|atx|dcm|pro)$/i;
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (EXT.test(f.name)) files.push(p); } })(root);

const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const crc = (b) => (zlib.crc32 ? zlib.crc32(b) >>> 0 : 0).toString(16).padStart(8, '0');
const rows = [];
for (const p of files) {
  const rel = path.relative(root, p).replace(/\\/g, '/');
  const b = new Uint8Array(fs.readFileSync(p));
  const r = { path: rel, bytes: b.length, crc32: crc(b), md5: md5(b), sha1: sha1(b), flags: [] };
  const ext = path.extname(p).slice(1).toLowerCase();
  let kind = null; try { kind = DC.detect(b, path.basename(p)); } catch (e) { /* unknown */ }
  r.container = kind || 'unknown';
  if (kind && kind !== ext && !(kind === 'atr' && ext === 'atr')) r.flags.push(`extension .${ext} but content is ${kind.toUpperCase()}`);
  let atr = null;
  try { atr = kind === 'atr' ? b : DC.toAtr(b, path.basename(p)); } catch (e) { r.flags.push('cannot convert: ' + e.message); }
  if (atr) {
    const ss = (atr[4] | (atr[5] << 8)) || 128, declared = ((atr[2] | (atr[3] << 8) | (atr[6] << 16)) * 16);
    r.sectorSize = ss; r.payloadMd5 = md5(atr.subarray(16));
    try { r.sectors = DOS.layout(atr).nsec; } catch (e) { /* ignore */ }
    if (kind === 'atr' && declared !== atr.length - 16) r.flags.push(`ATR header says ${declared} bytes, file holds ${atr.length - 16}`);
    try { const v = DOS.open(atr); r.fs = v ? v.kind : 'none'; if (v) r.files = v.list().length; } catch (e) { r.fs = 'none'; }
    const a = AUD.scan(atr);
    if (a) { r.deleted = a.deleted.length; r.recoverable = a.deleted.filter((d) => d.bytes > 0).length; r.freeData = a.freeData.length; if (a.headerExtra) r.flags.push('extra ATR header bytes ' + a.headerExtra); }
  }
  if (kind === 'atx') { try { const i = DC.atxInfo(b); if (i.protected) r.flags.push(`copy protection: ${i.duplicates} duplicate, ${i.badStatus} bad-status, ${i.weak} weak-bit`); } catch (e) { /* ignore */ } }
  rows.push(r);
}

const group = (key) => { const m = new Map(); for (const r of rows) if (r[key]) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r); } return [...m.values()].filter((g) => g.length > 1); };
const score = (r) => (/\[!\]|\(!\)|!\.|!\)/.test(r.path) ? 0 : 1) * 1000 + r.path.length;
const exact = group('md5');
const exactKeys = new Set(exact.flat().map((r) => r.path));
const content = group('payloadMd5').map((g) => g.filter((r, _, a) => a.filter((x) => x.md5 === r.md5).length === a.length || true)).filter((g) => new Set(g.map((r) => r.md5)).size > 1);

const out = [];
const P = (s = '') => out.push(s);
P(`Library check: ${root}`);
P(`${rows.length} disk images, ${(rows.reduce((a, r) => a + r.bytes, 0) / 1048576).toFixed(1)} MB`);
const by = {}; rows.forEach((r) => { by[r.container] = (by[r.container] || 0) + 1; });
P('Containers: ' + Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', '));
const fsBy = {}; rows.forEach((r) => { if (r.fs) fsBy[r.fs] = (fsBy[r.fs] || 0) + 1; });
P('Filesystems: ' + Object.entries(fsBy).map(([k, v]) => `${k} ${v}`).join(', '));
P();
P(`EXACT DUPLICATES: ${exact.length} groups, ${exact.reduce((a, g) => a + g.length - 1, 0)} redundant files`);
for (const g of exact) { const s = g.slice().sort((x, y) => score(x) - score(y)); P(`  keep  ${s[0].path}`); s.slice(1).forEach((r) => P(`  same  ${r.path}`)); }
P();
P(`SAME SECTORS, DIFFERENT FILE: ${content.length} groups (e.g. ATX vs ATR, or different ATR headers)`);
for (const g of content) g.forEach((r) => P(`  ${r.container} ${r.path}`));
P();
const flagged = rows.filter((r) => r.flags.length);
P(`FLAGS: ${flagged.length} images`);
for (const r of flagged) r.flags.forEach((f) => P(`  ${r.path}: ${f}`));
P();
const rec = rows.filter((r) => r.recoverable);
P(`RECOVERABLE DELETED FILES: ${rec.length} disks, ${rec.reduce((a, r) => a + r.recoverable, 0)} files`);
rec.slice(0, 30).forEach((r) => P(`  ${r.recoverable} file(s), ${r.freeData} free-space sector(s) with data: ${r.path}`));
if (rec.length > 30) P(`  ... ${rec.length - 30} more`);
console.log(out.join('\n'));

const csvOut = opt('--csv'), jsonOut = opt('--json');
if (csvOut) {
  const cols = ['path', 'bytes', 'container', 'sectorSize', 'sectors', 'fs', 'files', 'crc32', 'md5', 'sha1', 'payloadMd5', 'deleted', 'recoverable', 'freeData', 'flags'];
  const q = (v) => '"' + String(v === undefined ? '' : Array.isArray(v) ? v.join('; ') : v).replace(/"/g, '""') + '"';
  fs.writeFileSync(csvOut, [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\n'));
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
