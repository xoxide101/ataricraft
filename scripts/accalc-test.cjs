// ACCalc emulator harness. usage: node scripts/accalc-test.cjs [stage]
const fs = require('fs'), path = require('path'), cp = require('child_process');
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const R = path.join(__dirname, '..');
const OUT = path.join(R, 'out', 'accalc');
fs.mkdirSync(OUT, { recursive: true });

function build() {
  const r = cp.spawnSync(path.join(R, 'out', 'mads', 'mads.exe'), ['accalc.asm', '-o:accalc.xex', '-l:accalc.lst', '-t:accalc.lab'], { cwd: path.join(R, 'tools', 'accalc'), encoding: 'utf8' });
  if (r.status !== 0) { console.log(r.stdout + r.stderr); throw new Error('mads failed'); }
  return fs.readFileSync(path.join(R, 'tools', 'accalc', 'accalc.xex'));
}

function labels() {
  const m = {};
  const p = path.join(R, 'tools', 'accalc', 'accalc.lab');
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const x = l.trim().split(/\s+/); if (x.length >= 3 && /^[0-9A-F]+$/i.test(x[1])) m[x[2].toLowerCase()] = parseInt(x[1], 16); }
  return m;
}

async function boot(xex, files = {}) {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const p = await b.newPage({ viewport: { width: 1100, height: 800 } });
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto('file:///' + R.replace(/\\/g, '/') + '/web/index.html');
  await p.waitForTimeout(800);
  await p.setInputFiles('#romfiles', [path.join(R, 'software_n_roms', 'ATARIXL.ROM'), path.join(R, 'software_n_roms', 'ATARIBAS.ROM')]);
  await p.selectOption('#model', '130xe');
  await p.click('#boot');
  await p.waitForTimeout(3000);
  for (const [n, d] of Object.entries(files)) await p.evaluate(([n, a]) => FujiNet.emu.hostWrite(n, new Uint8Array(a)), [n, Array.from(d)]);
  await p.evaluate((a) => FujiNet.emu.bootFile('ACCALC.XEX', new Uint8Array(a)), Array.from(xex));
  await p.waitForTimeout(2500);
  await p.click('canvas');
  return {
    b, p,
    key: async (k, w = 250) => { const ks = k.split('+'); for (const x of ks) await p.keyboard.down(x); await p.waitForTimeout(70); for (const x of ks.reverse()) await p.keyboard.up(x); await p.waitForTimeout(w); },
    type: async (t, w = 120) => { for (const ch of t) { await p.keyboard.press(ch === ':' ? 'Shift+Semicolon' : ch === ' ' ? 'Space' : ch === '.' ? 'Period' : ch === '=' ? 'Equal' : ch === '(' ? 'Shift+9' : ch === ')' ? 'Shift+0' : ch === '+' ? 'Shift+Equal' : ch === '*' ? 'Shift+8' : ch === ',' ? 'Comma' : ch === '-' ? 'Minus' : ch === '^' ? 'Shift+6' : ch === '/' ? 'Slash' : ch === '"' ? 'Shift+Quote' : ch === '>' ? 'Shift+Period' : ch === '<' ? 'Shift+Comma' : ch); await p.waitForTimeout(w); } },
    shot: async (n) => { const f = path.join(OUT, n + '.png'); await p.locator('canvas').first().screenshot({ path: f }); return f; },
    peek: (a, n) => p.evaluate(([a, n]) => Array.from(ataricraft.peek(a, n)), [a, n]),
    host: () => p.evaluate(() => { const h = FujiNet.emu.hostFiles(); return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Array.from(v)])); }),
    nav: async (k, n, w = 550) => { for (let i = 0; i < n; i++) { await p.keyboard.press(k); await p.waitForTimeout(w); } },
    close: () => b.close(),
  };
}
module.exports = { build, labels, boot, OUT, R };

async function main() {
  const xex = build();
  const gen = require('./accalc-gen.cjs').make();
  const e = await boot(xex, { 'TEST.XCS': gen.blank, 'TESTFULL.XCS': gen.full });
  await e.shot('00-boot');
  await e.key('Control+o', 400);
  await e.type('h:testfull');
  await e.shot('01-prompt');
  await e.key('Enter', 6000);
  await e.shot('02-loaded');
  console.log('status bytes', await e.peek(0x14B1, 8));
  await e.nav('ArrowDown', 25);
  await e.nav('ArrowRight', 6);
  await e.p.waitForTimeout(1500);
  await e.shot('03-nav');
  console.log('cr,cc,vr0,vc0 (expect 25,6,>=5,>=3)', await e.peek(0x90, 4));
  await e.nav('ArrowUp', 25);
  await e.nav('ArrowLeft', 6);
  await e.p.waitForTimeout(1500);
  await e.shot('04-home');
  console.log('cr,cc,vr0,vc0 (expect 0,0,0,0)', await e.peek(0x90, 4));
  await e.close();
}
if (require.main === module) main().catch((x) => { console.error(x); process.exit(1); });
