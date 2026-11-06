// One build command for every derived artefact (docs/BUILD.md).
//   node scripts/build-all.cjs            regenerate everything
//   node scripts/build-all.cjs --check    regenerate in memory of the working tree, compare, restore; exit 1 if any derived file is stale
//   node scripts/build-all.cjs --list     print the derived-file table (also checks tracked/ignored status against git)
// Steps: xCWriter bundle, Craft faces (font/*.acf created only when missing), ACWriter faces + font/build/*.inc (honours font/overrides),
// font manifests (web/library/fonts/local), ACWriter build (only when tools/acwriter has no uncommitted changes).
'use strict';
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2), CHECK = args.includes('--check'), LIST = args.includes('--list');
if (args.includes('--help') || args.includes('-h')) { console.log('usage: node scripts/build-all.cjs [--check | --list]  (no flag: regenerate every derived file)'); process.exit(0); }
const node = (script, a = []) => spawnSync(process.execPath, [path.join(ROOT, script), ...a], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
const git = (a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });

// tracked: committed to git; false = gitignored, produced locally by this build. dir entries cover every file below them.
const DERIVED = [
  { step: 'xcwriter', files: ['web/js/xcwriter/core/xcw-core.js', 'web/js/xcwriter/core/xcw-data.js'], tracked: true, from: 'tools/*.cjs (bundle list in sync-xcwriter-core.cjs), tools/acwriter/font4.json, sym.json, docs/samples' },
  { step: 'faces', files: ['font/build/craft4.inc', 'font/build/craft5.inc', 'font/build/craft6.inc', 'font/build/zfont.inc', 'web/js/fontedit/acw-faces.js'], tracked: true, from: 'tools/acwfaces.cjs + font/overrides/*.acf' },
  { step: 'faces', files: ['web/library/fonts/acw'], tracked: true, from: 'tools/acwfaces.cjs + font/overrides/*.acf (force-added although web/library/* is ignored)' },
  { step: 'fontlist', files: ['web/library/fonts/local'], tracked: false, from: 'scripts/fontlist.cjs: font/, font_personal/, ROM charset, converted/ (manifest.json "generated" stamp ignored)' },
  { step: 'acwriter', files: ['tools/acwriter/craft4.inc', 'tools/acwriter/craft5.inc', 'tools/acwriter/craft6.inc', 'tools/acwriter/zfont.inc', 'tools/acwriter/craftpg.inc', 'tools/acwriter/craftpg_a.inc', 'tools/acwriter/craftpg_b.inc', 'web/js/fontedit/builtin-fonts.js', 'tools/acwriter/poc5.lst'], tracked: true, from: 'tools/acwriter/mk*.cjs, then font/build/*.inc overlay' },
  { step: 'acwriter', files: ['tools/acwriter/poc5.xex'], tracked: false, from: 'MADS (out/mads/mads.exe) on tools/acwriter/poc5.asm' },
  { step: 'acwriter', files: ['web/library/fonts/craft'], tracked: false, from: 'tools/acwriter/mkcraftfonts.cjs' },
  { step: 'xccalc', files: ['web/js/xccalc/core/xcc-core.js', 'web/js/xccalc/core/xcc-data.js'], tracked: true, from: 'tools/calccore.cjs, tools/xccalc/*.cjs (bundle list in sync-xccalc-core.cjs), tools/acwriter/font4.json' },
  { step: 'xcbase', files: ['web/js/xcbase/core/xcb-core.js', 'web/js/xcbase/core/xcb-data.js'], tracked: true, from: 'tools/calccore.cjs, dbcore.cjs, xcdformat.cjs, xcdio.cjs (bundle list in xcbase-sync-core.cjs), tools/acwriter/font4.json' },
];
// Hand-editable in place: created when missing, never overwritten, only validated.
const IN_PLACE = ['font/craft8.fnt', 'font/craft10.acf', 'font/craft12.acf', 'font/craft4.acf', 'font/craft5.acf', 'font/craft6.acf'];

const abs = (p) => path.join(ROOT, p);
function walk(p, out = []) {
  const a = abs(p);
  if (!fs.existsSync(a)) return out;
  if (fs.statSync(a).isDirectory()) for (const n of fs.readdirSync(a)) walk(p + '/' + n, out); else out.push(p);
  return out;
}
// text files compare modulo CRLF (git autocrlf checkouts); manifest.json ignores its timestamp
const norm = (p, b) => (/\.(inc|js|lst|json|asm)$/.test(p) ? Buffer.from(b.toString('latin1').replace(/\r\n/g, '\n').replace(/"generated": "[^"]*"/, '"generated": ""'), 'latin1') : b);

function trackedStatus() {
  const bad = [];
  for (const d of DERIVED) for (const f of d.files) {
    const ls = git(['ls-files', '--', f]).stdout.trim();
    const ign = git(['check-ignore', '-q', '--no-index', f]).status === 0;
    if (d.tracked && !ls) bad.push(f + ' is documented as committed but git does not track it');
    if (!d.tracked && ls) bad.push(f + ' is documented as gitignored but is tracked');
  }
  return bad;
}

if (LIST) {
  for (const d of DERIVED) console.log((d.tracked ? 'committed ' : 'gitignored') + '  ' + d.files.join(', ') + '\n            <- ' + d.from + '  [step ' + d.step + ']');
  console.log('in place   ' + IN_PLACE.join(', ') + '  (created when missing, hand edits kept)');
  const bad = trackedStatus();
  bad.forEach((b) => console.log('MISMATCH: ' + b));
  process.exit(bad.length ? 1 : 0);
}

const acwDirty = git(['status', '--porcelain', '--', 'tools/acwriter']).stdout.trim();
const madsExe = abs('out/mads/mads.exe');
const log = (s) => console.log((CHECK ? '[check] ' : '') + s);
const fail = [];

function step(name, script, a) {
  const r = node(script, a);
  if (r.status !== 0) { fail.push(name + ' failed: ' + ((r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | '))); log(name + ': FAILED'); return false; }
  log(name + ': ok');
  return true;
}

function validateOverrides() {
  const A = require('../tools/acwfaces.cjs'), CF = require('../tools/craftfont.cjs');
  const dir = abs('font/overrides');
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /\.acf$/i.test(n)) : [];
  for (const n of names) {
    const id = n.replace(/\.acf$/i, ''), meta = A.byId(id);
    if (!meta || meta.kind !== 'override') { fail.push('font/overrides/' + n + ': not an overridable ACWriter face (' + A.FACES.filter((f) => f.kind === 'override').map((f) => f.id).join(', ') + ')'); continue; }
    try { const f = CF.parse(fs.readFileSync(path.join(dir, n))); if (f.adv !== meta.adv) throw new Error('advance ' + f.adv + ' px, expected ' + meta.adv); } catch (e) { fail.push('font/overrides/' + n + ': ' + e.message); }
  }
  log('font overrides: ' + (names.length ? names.join(', ') : 'none') + ' (read by acwfaces.override(), baked into font/build/*.inc)');
}

function build() {
  step('xcwriter bundle', 'scripts/sync-xcwriter-core.cjs');
  step('xccalc bundle', 'scripts/sync-xccalc-core.cjs');
  step('xcbase bundle', 'scripts/xcbase-sync-core.cjs');
  validateOverrides();
  const rawFaces = !fail.length && step('craft faces (font/*.acf created when missing)', 'scripts/mkcraftfaces.cjs');
  void rawFaces;
  step('ACWriter faces -> font/build/*.inc, web/library/fonts/acw, acw-faces.js', 'scripts/acw-faces.cjs');
  step('font manifests (web/library/fonts/local)', 'scripts/fontlist.cjs');
  if (acwDirty) { log('ACWriter build: SKIPPED, tools/acwriter has uncommitted changes (' + acwDirty.split('\n').length + ' path(s)); commit or stash them first'); return; }
  for (const s of ['tools/acwriter/mkcraftfonts.cjs', 'tools/acwriter/mkzoomfont.cjs']) step(s, s);
  for (const f of ['craft4', 'craft5', 'craft6', 'zfont']) fs.copyFileSync(abs('font/build/' + f + '.inc'), abs('tools/acwriter/' + f + '.inc'));
  log('overlaid font/build/*.inc on tools/acwriter/*.inc (font/overrides applied)');
  step('tools/acwriter/mkpgfont.cjs', 'tools/acwriter/mkpgfont.cjs');
  if (!fs.existsSync(madsExe)) { log('poc5.xex: SKIPPED, ' + madsExe + ' not present (MADS is not in the repo)'); return; }
  const r = spawnSync(madsExe, ['poc5.asm', '-o:poc5.xex', '-l:poc5.lst'], { cwd: abs('tools/acwriter'), encoding: 'utf8' });
  if (r.status !== 0) { fail.push('mads poc5.asm failed: ' + (r.stdout + r.stderr).trim().split('\n').slice(-3).join(' | ')); log('poc5.xex: FAILED'); } else log('poc5.xex: ok');
}

if (!CHECK) {
  build();
  fail.length ? (console.error(fail.join('\n')), process.exit(1)) : console.log('build-all: done');
} else {
  const files = new Set();
  for (const d of DERIVED) if (d.step !== 'acwriter' || !acwDirty) for (const f of d.files) walk(f).forEach((x) => files.add(x));
  const before = new Map([...files].map((f) => [f, fs.readFileSync(abs(f))]));
  const dirs = DERIVED.filter((d) => d.step !== 'acwriter' || !acwDirty).flatMap((d) => d.files);
  const inPlace = new Map(IN_PLACE.map((f) => [f, fs.existsSync(abs(f)) ? fs.readFileSync(abs(f)) : null]));
  const stale = [], missing = [];
  try {
    build();
  } finally {
    const after = new Set();
    for (const d of dirs) walk(d).forEach((x) => after.add(x));
    for (const f of after) {
      const nb = fs.readFileSync(abs(f));
      if (!before.has(f)) { (DERIVED.find((d) => d.files.some((x) => f === x || f.startsWith(x + '/'))).tracked ? stale : missing).push(f); fs.rmSync(abs(f)); }
      else if (!norm(f, before.get(f)).equals(norm(f, nb))) { stale.push(f); fs.writeFileSync(abs(f), before.get(f)); }
      else fs.writeFileSync(abs(f), before.get(f));
    }
    for (const [f, b] of inPlace) { if (b === null) { if (fs.existsSync(abs(f))) { stale.push(f + ' (missing)'); fs.rmSync(abs(f)); } } else fs.writeFileSync(abs(f), b); }
  }
  trackedStatus().forEach((m) => fail.push(m));
  if (acwDirty) console.log('[check] ACWriter outputs not checked: tools/acwriter is dirty');
  missing.forEach((f) => console.log('[check] warn: gitignored ' + f + ' not built here (run node scripts/build-all.cjs)'));
  // the MADS listing is committed by the ACWriter author together with each poc5.asm change; stale means that commit is pending, not a broken build
  const ADVISORY = ['tools/acwriter/poc5.lst'];
  stale.filter((f) => ADVISORY.includes(f)).forEach((f) => console.log('[check] warn: ' + f + ' differs from a fresh MADS listing (advisory)'));
  stale.filter((f) => !ADVISORY.includes(f)).forEach((f) => fail.push('stale: ' + f));
  if (fail.length) { console.error(fail.join('\n') + '\nbuild-all --check: FAILED (run node scripts/build-all.cjs)'); process.exit(1); }
  console.log('build-all --check: all derived files up to date (' + before.size + ' files compared)');
}
