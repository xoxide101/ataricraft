// Native AFM browsing an N: (FujiNet) drive: key 9 asks for a URL (RETURN = SD:/), lists the relay --sd folder,
// enters a folder and goes back up.  Reads AFM's pane-0 entry table straight out of RAM.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = 'C:/Users/raver/ataricraft';
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
(async () => {
  if (!process.env.AFMBIN) execFileSync(ROOT + '/out/mads/mads.exe', ['afm.asm', '-o:' + ROOT + '/out/afm-n.com'], { cwd: ROOT + '/tools/afm', stdio: 'ignore' });
  const xex = fs.readFileSync(process.env.AFMBIN || ROOT + '/out/afm-n.com');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afmn-'));
  fs.writeFileSync(path.join(dir, 'hello.txt'), 'FROM SD FILE');
  fs.mkdirSync(path.join(dir, 'games'));
  fs.writeFileSync(path.join(dir, 'games', 'pacman.com'), 'PAC');
  const relay = spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', '8792', '--allow-lan', '--sd', dir, '--allow-write'], { env: Object.assign({}, process.env, { AC_TOKEN: 'testtoken' }) });
  await new Promise((r) => setTimeout(r, 900));
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext()).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  const Dos = require(ROOT + '/web/js/dosfs.js');
  const img = new Uint8Array(fs.readFileSync(process.env.DISK || (ROOT + '/web/library/craftapps/DOS images/Atari DOS 2.5.atr')));
  const v = Dos.open(img); if (!process.env.NOAFM) v.writeFile('AFMN.COM', new Uint8Array(xex));
  await p.setInputFiles('#f1', { name: 'AFMBOOT.atr', mimeType: 'application/octet-stream', buffer: Buffer.from(v.image ? v.image() : img) });
  await p.setInputFiles('#f2', ROOT + '/web/library/craftapps/Blank disks/blank360.atr');
  const idle = async () => { await p.waitForTimeout(500); await p.waitForFunction(() => ataricraft.typing() === 0, null, { timeout: 60000 }); };
  await p.click('#boot'); await p.waitForTimeout(9000);
  await p.screenshot({ path: ROOT + '/out/afm-n-0.png' });
  await p.evaluate(() => ataricraft.type('DOS\n')); await idle();
  await p.waitForTimeout(2500);
  await p.evaluate(() => ataricraft.type('L')); await idle();
  await p.waitForTimeout(2000);
  await p.evaluate((f) => ataricraft.type(f + '\n'), process.env.LOADF || 'D1:AFMN.COM'); await idle();
  await p.waitForTimeout(1500);
  if (!process.env.NOFN) await p.evaluate(() => { FujiNet.enabled = true; FujiNet.bridge = 'http://127.0.0.1:8792'; localStorage.setItem('ac.nettoken', 'testtoken'); if (FujiNet.emu.fnDevice) FujiNet.emu.fnDevice(true); });
  await p.waitForTimeout(20000);
  await p.screenshot({ path: ROOT + '/out/afm-n-2.png' });
  console.log(await p.evaluate(() => { const e = FujiNet.emu; return JSON.stringify({ frame: e.frame && e.frame(), pc: e.cpu && e.cpu(), run: ataricraft.running && ataricraft.running(), text: e.screenText && e.screenText() }); }));
  const pane = () => p.evaluate(() => {
    const e = FujiNet.emu, a = Array.from(e.peek(0x5c00, 17 * 6)), out = [];
    for (let i = 0; i < 6; i++) out.push(String.fromCharCode(...a.slice(i * 17, i * 17 + 17).map((c) => (c >= 32 && c < 127 ? c : 46))));
    return out;
  });
  const key = async (k, w) => { await p.evaluate((k) => ataricraft.type(k), k); await idle(); await p.waitForTimeout(w || 1500); };
  await key(' ', 8000);
  await key(process.env.K9 || '9', 1000);
  await key('\n', 3000);
  let e = await pane(); console.log(e);
  ok(e.some((l) => /HELLO {3}TXT/.test(l)), 'N: pane lists hello.txt', e);
  ok(e.some((l) => /^ :GAMES {5}/.test(l)), 'folder shows as a directory entry', e);
  ok(!e.some((l) => /FREE/.test(l)), 'free-sector trailer is not an entry', e);
  await p.evaluate(() => { Printer.clear(); Printer.cfg.auto = false; });
  await key('H', 6000);
  const ptxt = await p.evaluate(() => Printer.text());
  ok(/ATARICRAFT AFM DIRECTORY/.test(ptxt) && /HELLO\s+TXT/.test(ptxt) && /GAMES/.test(ptxt), 'H prints the N: listing to P:', ptxt);
  await p.screenshot({ path: ROOT + '/out/afm-n-1.png' });
  const gi = e.findIndex((l) => /^ :GAMES/.test(l));
  for (let i = 0; i < gi; i++) await key('S', 400);
  await key('\n', 3000);
  e = await pane(); console.log(e);
  ok(e.some((l) => /^ :\.\./.test(l)) && e.some((l) => /PACMAN {2}COM/.test(l)), 'entered folder: .. and PACMAN.COM', e);
  await key('\n', 3000);
  e = await pane();
  ok(e.some((l) => /HELLO {3}TXT/.test(l)) && !e.some((l) => /PACMAN/.test(l)), 'back at the SD root through ..', e);

  const lsd = () => fs.readdirSync(dir).map((s) => s.toLowerCase());
  const msg = () => p.evaluate(() => FujiNet.emu.screenText().split('\n').slice(-4).join(' | '));
  const top = async (n) => { for (let i = 0; i < 14; i++) await key('W', 150); for (let i = 0; i < n; i++) await key('S', 300); };
  const pane1 = () => p.evaluate(() => {
    const a = Array.from(FujiNet.emu.peek(0x6400, 17 * 100)), out = [];
    for (let i = 0; i < 100; i++) out.push(String.fromCharCode(...a.slice(i * 17, i * 17 + 17).map((c) => (c >= 32 && c < 127 ? c : 46))));
    return out;
  });
  // mkdir
  await key('M', 1500); await key('NEWD\n', 4000);
  ok(lsd().includes('newd'), 'M makes a folder on the SD card', [lsd(), await msg()]);
  // copy N: -> D:
  await key(' ', 800); await key('1', 6000); await key(' ', 800);
  e = await pane();
  await top(e.findIndex((l) => /HELLO {3}TXT/.test(l)));
  await key('C', 6000);
  console.log(await msg());
  const q = await pane1();
  ok(q.some((l) => /HELLO {3}TXT/.test(l)), 'C copies N: -> D1:', [q, await msg()]);
  // rename
  await key('R', 1500); await key('HI.TXT\n', 4000);
  ok(lsd().includes('hi.txt') && !lsd().includes('hello.txt'), 'R renames on the SD card', [lsd(), await msg()]);
  // delete
  e = await pane();
  await top(e.findIndex((l) => /HI {6}TXT/.test(l)));
  await key('D', 1500); await key('Y', 4000);
  ok(!lsd().includes('hi.txt'), 'D deletes on the SD card', [lsd(), await msg()]);
  // copy D: -> N:
  await key(' ', 1000);
  const q2 = await pane1();
  const ai = q2.findIndex((l) => /AFMN {4}COM/.test(l));
  ok(ai >= 0, 'AFMN.COM is listed on D1:', q2);
  await top(Math.max(ai, 0));
  await key('C', 15000);
  const f = lsd().find((s) => s === 'afmn.com');
  ok(f && fs.statSync(path.join(dir, f)).size === xex.length, 'C copies D1: -> N: with the right size', [lsd(), f && fs.statSync(path.join(dir, f)).size, xex.length, await msg()]);
  // guarded commands
  await key(' ', 1000); await key('L', 1500);
  ok(/NOT SUPPORTED ON N:/.test(await p.evaluate(() => FujiNet.emu.screenText())), 'lock is refused on N:');
  ok(!errs.length, 'no page errors', errs);
  await b.close(); relay.kill(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(bad ? 'FAILED ' + bad : 'all passed');
  process.exit(bad ? 1 : 0);
})();
