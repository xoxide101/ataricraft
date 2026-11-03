// The N: CIO handler (tools/afm/nhandler.inc) driven through real CIO calls on a 6502 (tools/tests/nhtest.asm):
// directory read, file read, write + read back, mkdir (XIO 42) and a missing file, against a relay --sd folder.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = 'C:/Users/raver/ataricraft';
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
(async () => {
  execFileSync(ROOT + '/out/mads/mads.exe', ['nhtest.asm', '-o:' + ROOT + '/out/nhtest.xex'], { cwd: ROOT + '/tools/tests', stdio: 'ignore' });
  const xex = fs.readFileSync(ROOT + '/out/nhtest.xex');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-'));
  fs.writeFileSync(path.join(dir, 'hello.txt'), 'FROM SD FILE');
  fs.mkdirSync(path.join(dir, 'games'));
  fs.writeFileSync(path.join(dir, 'A Very Long File Name.txt'), 'x');
  const relay = spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', '8791', '--allow-lan', '--sd', dir, '--allow-write'], { env: Object.assign({}, process.env, { AC_TOKEN: 'testtoken' }) });
  await new Promise((r) => setTimeout(r, 900));
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext()).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.click('#boot'); await p.waitForTimeout(2500);
  await p.evaluate(() => { FujiNet.enabled = true; FujiNet.bridge = 'http://127.0.0.1:8791'; localStorage.setItem('ac.nettoken', 'testtoken'); if (FujiNet.emu.fnDevice) FujiNet.emu.fnDevice(true); });
  await p.waitForTimeout(3000);
  await p.evaluate((x) => ataricraft.bootFile('NHTEST.XEX', new Uint8Array(x)), Array.from(xex));
  let r;
  for (let i = 0; i < 20; i++) {
    await p.waitForTimeout(500);
    r = await p.evaluate(() => { const e = FujiNet.emu, s = (a, n) => String.fromCharCode(...Array.from(e.peek(a, n)).map((c) => (c === 0x9b ? 10 : c))); return { res: Array.from(e.peek(0x2f00, 16)), dir: s(0x3000, 160), hello: s(0x3400, 14), back: s(0x3600, 8) }; });
    if (r.res[15] === 0xaa) break;
  }
  console.log(JSON.stringify(r));
  const R = r.res;
  ok(R[15] === 0xaa, 'test program ran to the end');
  ok(R[0] & 1 ? false : true, 'handler installed in HATABS');
  ok(R[1] === 1, 'open directory', R[1]);
  ok(/\/ GAMES {3}DIR 001/.test(r.dir) && /  HELLO {3}TXT 001/.test(r.dir) && /AVERYL[0-9A-F]{2}TXT 001/.test(r.dir) && /999\+FREE SECTORS/.test(r.dir), 'directory records read through CIO', r.dir);
  ok(R[2] === 136, 'directory ends with end of file', R[2]);
  ok(R[5] === 1, 'close', R[5]);
  ok(R[6] === 1 && r.hello.startsWith('FROM SD FILE') && R[8] === 12, 'file read through CIO', [R[6], r.hello, R[8]]);
  ok(R[9] === 1 && R[10] === 1 && R[11] === 1, 'file write and close', [R[9], R[10], R[11]]);
  ok(fs.existsSync(path.join(dir, 'out.txt')) && fs.readFileSync(path.join(dir, 'out.txt'), 'latin1').replace(/\x9b/g, '\n') === 'HELLO\n', 'written file is on the SD folder', fs.existsSync(path.join(dir, 'out.txt')) && fs.readFileSync(path.join(dir, 'out.txt'), 'latin1'));
  ok(r.back.startsWith('HELLO') && R[12] === 6, 'written file reads back', [r.back, R[12]]);
  ok(R[13] === 1 && fs.existsSync(path.join(dir, 'newdir')), 'mkdir through XIO 42', R[13]);
  ok(R[14] === 170, 'missing file reports not found (170)', R[14]);
  ok(!errs.length, 'no page errors', errs);
  await b.close(); relay.kill(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(bad ? 'FAILED ' + bad : 'all passed');
  process.exit(bad ? 1 : 0);
})();
