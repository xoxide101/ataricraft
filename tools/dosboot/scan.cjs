// Folder scanner shared by scripts/dosboot-scan.cjs and the local relay: finds DOS disk images, detects the DOS, builds boot records.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const Z = require('./zipread.cjs');
const Dos = require('../../web/js/dosfs.js');
const DB = require('../../web/js/dosboot.js');

const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? (e.name.startsWith('.') ? [] : walk(p)) : [p];
});

function namesOf(bytes) {
  try { const v = Dos.open(new Uint8Array(bytes)); if (v) return { kind: v.kind, names: v.list().map((e) => e.path) }; } catch (e) { /* fall back to the raw directory */ }
  return {};
}

function versionFromName(stem) {
  const my = /mydos[ _-]?(\d)(\d\d)(b\d*)?/i.exec(stem);
  if (my) return my[1] + '.' + my[2] + (my[3] || '');
  const sp = /sparta-?dos[ _-]?(\d)(\d\d)(?!\d)/i.exec(stem);
  if (sp) return sp[1] + '.' + sp[2];
  const v = /\bv(\d+(?:\.\d+)?[a-z]?)(?![\w.])/i.exec(stem);
  return v ? v[1] : '';
}

// opts: { all, machine, ram }. Returns { records, skipped: [[name, why]] }.
function scan(base, opts) {
  opts = opts || {};
  const rel = (p) => path.relative(base, p).replace(/\\/g, '/');
  const records = [], skipped = [], warnings = [], seen = new Map(), usedIds = new Set();
  function consider(file, member, bytes) {
    const stem = path.basename(member || file);
    const label = path.basename(file).replace(/\.(zip|atr|xfd)$/i, '').replace(/^OS - /, '').replace(/^DOS - /, '');
    const nm = namesOf(bytes), det = DB.detect(new Uint8Array(bytes), nm.names, nm.kind);
    if (det.family === 'spartados' && /bw-?dos/i.test(label)) { det.family = 'bw-dos'; det.name = 'BW-DOS'; det.evidence.push('named BW-DOS'); }
    const claimed = /sparta/i.test(label) ? 'spartados' : /bw-?dos/i.test(label) ? 'bw-dos' : /mydos/i.test(label) ? 'mydos' : '';
    const mislabelled = !!(claimed && det.bootable && det.family !== claimed);
    if (mislabelled) warnings.push([label, 'named for ' + claimed + ' but the disk is ' + det.family + ' (' + det.evidence.slice(-1)[0] + ')']);
    const hash = sha1(bytes);
    if (seen.has(hash)) { skipped.push([label, 'duplicate of ' + seen.get(hash)]); return; }
    if (!opts.all && (!det.bootable || det.family === 'unknown' || det.family === 'bootstub')) { skipped.push([label, det.family === 'bootstub' ? 'file collection, no DOS' : 'not a recognised DOS boot disk (' + det.evidence.slice(-1)[0] + ')']); return; }
    const fileVer = mislabelled ? '' : versionFromName(label);
    const version = det.version && det.family !== 'atari-dos2' ? det.version : fileVer || det.version;
    let id = DB.slug(label), n = 2;
    while (usedIds.has(id)) id = DB.slug(label) + '-' + n++;
    usedIds.add(id); seen.set(hash, id);
    const machine = {};
    if (opts.machine) machine.model = opts.machine;
    if (opts.ram) machine.ram = opts.ram;
    const media = { path: rel(file), format: /\.xfd$/i.test(stem) ? 'xfd' : 'atr', sizeBytes: bytes.length, sha1: hash };
    if (member) media.member = member;
    const r = DB.newRecord({ id, name: label, version, detect: det, machine, media });
    const errs = DB.validateRecord(r);
    if (errs.length) { skipped.push([label, 'invalid record: ' + errs.join('; ')]); return; }
    records.push(r);
  }
  for (const f of walk(base)) {
    try {
      if (/\.(atr|xfd)$/i.test(f)) consider(f, null, fs.readFileSync(f));
      else if (/\.zip$/i.test(f)) for (const e of Z.list(f)) if (/\.(atr|xfd)$/i.test(e.name) && e.size < 20e6) consider(f, e.name, Z.read(f, e.name));
    } catch (e) { skipped.push([rel(f), 'unreadable: ' + e.message]); }
  }
  return { records, skipped, warnings };
}

// Reads one medium of a record: a loose image, or a member of a zip. The path must stay inside root.
function readMedia(root, media) {
  const rootReal = fs.realpathSync(root);
  const full = fs.realpathSync(path.resolve(root, '.' + path.posix.normalize('/' + String(media.path).replace(/\\/g, '/'))));
  if (!(full === rootReal || full.startsWith(rootReal + path.sep))) throw new Error('path leaves the folder');
  if (media.member) return Z.read(full, media.member);
  if (/\.zip$/i.test(full)) { const l = Z.list(full).find((e) => /\.(atr|xfd)$/i.test(e.name)); if (!l) throw new Error('no disk image in zip'); return Z.read(full, l.name); }
  return fs.readFileSync(full);
}

module.exports = { scan, readMedia, sha1 };
