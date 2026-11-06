// Docs vs code: node scripts/docs-check.cjs [--verbose] [--no-run]
// Scans docs/**/*.md and the root *.md for
//   - relative markdown links           -> target must exist
//   - file references in `code spans`   -> file must exist (or be a documented local-only/runtime path)
//   - `node SCRIPT ...` / `powershell ... .ps1` examples -> script must exist, every documented --flag must appear in its source,
//     the script must parse (node --check), and scripts that implement --help are actually run with it (timeout 20 s)
// Exit 1 on any broken reference. docs/ARCH*.md are checked read-only like every other file.
'use strict';
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const VERBOSE = process.argv.includes('--verbose'), NORUN = process.argv.includes('--no-run');
if (process.argv.includes('--help')) { console.log('usage: node scripts/docs-check.cjs [--verbose] [--no-run]'); process.exit(0); }
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

function listMd(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/^(node_modules|out|vendor|\.git)$/.test(e.name)) listMd(p, out); } else if (/\.md$/i.test(e.name)) out.push(p);
  }
  return out;
}
const docs = [...fs.readdirSync(ROOT).filter((f) => /\.md$/i.test(f)).map((f) => path.join(ROOT, f)), ...listMd(path.join(ROOT, 'docs'))];

const ls = spawnSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }).stdout.split('\n').filter(Boolean);
const byBase = new Map();
for (const f of ls) { const b = path.basename(f).toLowerCase(); (byBase.get(b) || byBase.set(b, []).get(b)).push(f); }

// Paths that are produced at run time or live only on a user's machine (gitignored, see .gitignore / docs/BUILD.md).
const LOCAL_ONLY = [/^out\//, /^roms\//, /^software_n_roms\//, /^font_personal\//, /^books\//, /^vendor\//, /^node_modules\//, /^web\/ref\//, /^web\/library\/fonts\/(local|personal)\//, /^web\/library\/(?!craftapps\/(AFM|Tools)\b)/, /^archive\/boot\//, /^library\/craftapps\//, /^SOURCES\//, /^web\/library\/craftapps\/Tools\/AtariCraft/, /^catalog\.sqlite$/, /^library\.json$/, /^web\/js\/diskdb\.js$/, /^tools\/ebookcraft\/ocr\//, /^web\/js\/ebookcraft\/ocr\//, /^tools\/acwriter\/poc5\.xex$/, /\.(rom|ROM)$/, /^[A-Za-z]:[\\/]/, /^~/, /^\//];
const SRC_EXT = 'cjs|mjs|js|html|css|md|asm|inc|json|ps1|txt|svg|png|jpg|sh';
const DATA_EXT = 'com|xex|atr|acf|xcf|fnt|cwd|xcw|xcs|xcd|cdc|dic|ovl|bdf|ttf|otf|woff2?|pdf|car|rom|zip|dat|bin|cfg|xml';
const FILE_RE = new RegExp('^[A-Za-z0-9_@.\\-/\\\\]+\\.(' + SRC_EXT + '|' + DATA_EXT + ')$', 'i');
const DIR_RE = /^(tools|scripts|web|docs|font|games|archive|roms)\/[A-Za-z0-9_.\-/]*\/?$/;

const st = { docs: docs.length, links: 0, linksOk: 0, refs: 0, refsOk: 0, refsLocal: 0, cmds: 0, cmdsOk: 0, flags: 0, flagsOk: 0, helpRun: 0, helpOk: 0, syntaxOk: 0 };
const bad = [];
const note = (doc, line, msg) => bad.push(rel(doc) + ':' + line + ': ' + msg);

function resolveRef(doc, t0) {
  let t = t0.replace(/\\/g, '/').replace(/^\.\//, '').replace(/[.,;:)]+$/, '');
  if (!t) return { ok: true, skip: true };
  if (LOCAL_ONLY.some((r) => r.test(t))) return { ok: true, local: true };
  const docDir = path.dirname(doc);
  const cands = [path.join(ROOT, t), path.join(docDir, t), ...['tools', 'scripts', 'web', 'web/js', 'docs', 'tools/acwriter', 'tools/tests', 'tools/cmd', 'tools/net', 'tools/ebookcraft', 'font', 'tools/tnfs-bridge'].map((d) => path.join(ROOT, d, t))];
  if (cands.some((c) => fs.existsSync(c))) return { ok: true };
  if (!t.includes('/') && byBase.has(t.toLowerCase())) return { ok: true };
  if (t.includes('/') && ls.some((f) => f.toLowerCase().endsWith('/' + t.toLowerCase()))) return { ok: true };
  // gitignored build outputs that the docs name explicitly are accepted only through LOCAL_ONLY
  return { ok: false };
}

function findScript(doc, s) {
  const t = s.replace(/\\/g, '/').replace(/^\.\//, '');
  for (const c of [path.join(ROOT, t), path.join(path.dirname(doc), t), path.join(ROOT, 'scripts', t), path.join(ROOT, 'tools', t)]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}

const BARE_OK = ['tools/craftdoc.cjs', 'tools/craftimport.cjs', 'tools/craftexport.cjs', 'tools/midiconv.cjs', 'tools/audioconv.cjs', 'tools/mkdict.cjs', 'tools/spellcheck.cjs', 'tools/imgtool.cjs', 'scripts/fontpipe.cjs'];
const scriptsSeen = new Map(); // abs path -> {flags:Set, where:[]}
function checkCommand(doc, ln, text) {
  const m = /(?:^|\s)(node|powershell(?:\.exe)?|pwsh)\s+(.*)$/.exec(text);
  if (!m) return;
  const toks = m[2].split(/\s+/).map((x) => x.replace(/^["']|["'];?$/g, ''));
  let script = null, i = 0;
  if (m[1] === 'node') { while (toks[i] && toks[i].startsWith('-')) i++; script = toks[i]; } else { const k = toks.findIndex((x) => /\.ps1$/i.test(x)); script = k >= 0 ? toks[k] : null; i = k; }
  if (!script || !/\.(cjs|js|mjs|ps1)$/i.test(script) || /[<>{}*%$]/.test(script)) return;
  if (LOCAL_ONLY.some((r) => r.test(script.replace(/\\/g, '/')))) return;
  st.cmds++;
  const abs = findScript(doc, script);
  if (!abs) { note(doc, ln, 'command runs missing script `' + script + '`'); return; }
  st.cmdsOk++;
  const rec = scriptsSeen.get(abs) || scriptsSeen.set(abs, { flags: new Set(), where: [] }).get(abs);
  rec.where.push(rel(doc) + ':' + ln);
  if (m[1] !== 'node') return;
  for (const f of toks.slice(i + 1)) {
    const fm = /^(--?[A-Za-z][\w-]*)(?:=.*)?$/.exec(f);
    if (!fm || /^-\d/.test(f)) continue;
    const flag = fm[1];
    if (flag === '--help' || flag === '-h') continue;
    st.flags++;
    const src = fs.readFileSync(abs, 'utf8');
    if (src.includes("'" + flag + "'") || src.includes('"' + flag + '"') || src.includes(flag + '=') || new RegExp('(^|[^\\w-])' + flag.replace(/[-]/g, '\\-') + '(?![\\w-])').test(src)) st.flagsOk++;
    else note(doc, ln, '`' + rel(abs) + '` has no flag ' + flag);
  }
}

function checkRefs(doc, ln, span) {
  for (const raw of span.split(/\s+/)) {
    const t = raw.replace(/^["'(\[]+|["'),;\]]+$/g, '');
    if (!t || /^\./.test(t) || /(^|\/)(NAME|FILE|OUTPUT|DISK|DATA|DICT|LONGNAME|FOO)\.\w+$/.test(t) || /[*<>{}%$|=]/.test(t) || /^https?:/.test(t) || /^-/.test(t) || /^\d/.test(t)) continue;
    if (!(FILE_RE.test(t) || (t.includes('/') && DIR_RE.test(t.replace(/\\/g, '/'))))) continue;
    if (/^[\w-]+\.(js|cjs)$/.test(t) && !t.includes('/') && !byBase.has(t.toLowerCase()) && /^(window|document|navigator|Math|Object|Array|JSON|Buffer|Date|String|Number|process|fs|path|module|console)\./.test(raw)) continue;
    // bare data/example names (book.txt, index.json, KOALA.ATR) are user-supplied or run-time files, not repo files
    if (!t.includes('/') && !t.includes('\\') && !/\.(cjs|mjs|js|html|css|md|asm|inc|ps1)$/i.test(t)) continue;
    st.refs++;
    const r = resolveRef(doc, t);
    if (r.local) st.refsLocal++;
    if (r.ok) st.refsOk++; else note(doc, ln, 'missing file `' + t + '`');
  }
}

for (const doc of docs) {
  const lines = fs.readFileSync(doc, 'utf8').split(/\r?\n/);
  let fence = false;
  lines.forEach((line, k) => {
    const ln = k + 1;
    if (/^\s*```/.test(line)) { fence = !fence; return; }
    if (fence) { checkCommand(doc, ln, line.replace(/^\s*(?:PS [^>]*>|\$|>)\s*/, '')); return; }
    for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const u = m[1];
      if (/^(https?:|mailto:|#)/.test(u)) continue;
      st.links++;
      const p = decodeURIComponent(u.split('#')[0]);
      if (fs.existsSync(path.resolve(path.dirname(doc), p)) || (p.startsWith('/') && fs.existsSync(path.join(ROOT, p)))) st.linksOk++; else note(doc, ln, 'broken link ' + u);
    }
    for (const m of line.matchAll(/`([^`]+)`/g)) {
      const span = m[1];
      checkCommand(doc, ln, span);
      if (!/(^|\s)(node|powershell|pwsh)\s/.test(span)) checkRefs(doc, ln, span);
      else for (const tok of span.split(/\s+/).slice(1)) if (/\.(cjs|js|ps1)$/.test(tok) === false) checkRefs(doc, ln, tok);
    }
  });
}

for (const [abs, rec] of scriptsSeen) {
  if (!/\.(cjs|js|mjs)$/.test(abs)) continue;
  const c = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8', timeout: 20000 });
  if (c.status === 0) st.syntaxOk++; else bad.push(rel(abs) + ': does not parse (' + rec.where[0] + '): ' + (c.stderr || '').split('\n').find((l) => /Error/.test(l)));
  const src = fs.readFileSync(abs, 'utf8');
  // no --help: CLIs that print usage when called without arguments (docs/TOOLS.md convention) are run bare in a scratch cwd; only this reviewed list, since other scripts do real work
  const bare = !/['"]--help['"]/.test(src) && BARE_OK.includes(rel(abs));
  if (!NORUN && bare) {
    const cwd = path.join(ROOT, 'out', 'docs-check-cwd'); fs.mkdirSync(cwd, { recursive: true });
    st.bareRun = (st.bareRun || 0) + 1;
    const r = spawnSync(process.execPath, [abs], { cwd, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = (r.stdout || '') + (r.stderr || '');
    if (r.status === null) bad.push(rel(abs) + ' with no arguments timed out (' + rec.where[0] + ')');
    else if (!out.trim() || r.status > 2 || /Cannot find module|\n\s+at .*\(.*:\d+:\d+\)/.test(out)) bad.push(rel(abs) + ' with no arguments: exit ' + r.status + ', no usage text: ' + out.split('\n')[0]);
    else st.bareOk = (st.bareOk || 0) + 1;
  }
  if (!NORUN && /['"]--help['"]/.test(src)) {
    st.helpRun++;
    const r = spawnSync(process.execPath, [abs, '--help'], { cwd: ROOT, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = (r.stdout || '') + (r.stderr || '');
    if (r.status === null) bad.push(rel(abs) + ' --help timed out (' + rec.where[0] + ')');
    else if ((r.status > 1 && !/usage/i.test(out)) || r.status > 2 || /Cannot find module|\n\s+at .*\(.*:\d+:\d+\)/.test(out)) bad.push(rel(abs) + ' --help failed, exit ' + r.status + ': ' + out.split('\n')[0]);
    else st.helpOk++;
  }
}

if (VERBOSE) for (const [abs, rec] of scriptsSeen) console.log(rel(abs) + '  <- ' + rec.where.slice(0, 3).join(', '));
bad.forEach((b) => console.log('BAD ' + b));
console.log('docs-check: ' + st.docs + ' docs | links ' + st.linksOk + '/' + st.links + ' | file refs ' + st.refsOk + '/' + st.refs + ' (' + st.refsLocal + ' local-only/gitignored, not checkable) | commands ' + st.cmdsOk + '/' + st.cmds + ' (' + scriptsSeen.size + ' scripts, ' + st.syntaxOk + ' parse) | flags ' + st.flagsOk + '/' + st.flags + ' | --help runs ' + st.helpOk + '/' + st.helpRun + ' | no-arg usage runs ' + (st.bareOk || 0) + '/' + (st.bareRun || 0) + ' | problems ' + bad.length);
process.exit(bad.length ? 1 : 0);
