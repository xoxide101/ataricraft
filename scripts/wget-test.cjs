// WGET.COM end to end (Atari input is upper case, so the mock FTP login is ATARI/SECRET; set FTP=1 to fetch ftp://user:pass@host/x from the mock FTP server instead of HTTP): boots it, types an http:// URL, and checks the fetched body reached the 6502 (BUF at $3200).
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
const { assemble } = require(ROOT + '/web/js/asm6502.js');
const xex = assemble(fs.readFileSync(ROOT + '/tools/tests/wget.asm', 'utf8')).xex;
const BODY = 'hello from wget\nline two\n';
(async () => {
  const web = http.createServer((q, p) => { p.setHeader('Content-Type', 'text/plain'); p.end(BODY); }).listen(0, '127.0.0.1');
  await new Promise((r) => web.once('listening', r));
  let ftp = null;
  if (process.env.FTP) { const dir = ROOT + '/out/wgetftp'; fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(dir + '/x', BODY); ftp = await require(ROOT + '/tools/tests/mockftp.cjs').start(dir, { user: 'ATARI', pass: 'SECRET' }); }
  const relay = spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', '8791', '--allow-lan'], { env: Object.assign({}, process.env, { AC_TOKEN: 'testtoken' }) });
  await new Promise((r) => setTimeout(r, 800));
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  let bad = 0;
  for (const core of (process.env.CORES || 'atari800,altirra').split(',')) {
    const p = await (await b.newContext()).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('file:///' + ROOT + '/web/index.html');
    await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
    await p.selectOption('#core', core);
    await p.click('#boot'); await p.waitForTimeout(3000);
    await p.evaluate(({ port }) => {
      FujiNet.enabled = true; FujiNet.bridge = 'http://127.0.0.1:8791'; localStorage.setItem('ac.nettoken', 'testtoken');
      if (FujiNet.emu.fnDevice) FujiNet.emu.fnDevice(true);
    }, { port: web.address().port });
    await p.waitForTimeout(4000);
    const hand = !!process.env.HAND; const url = process.env.FTP ? 'ftp://ATARI:SECRET@127.0.0.1:' + ftp.port + '/x' : 'http://127.0.0.1:' + web.address().port + '/x';
    let img = Array.from(xex);
    if (hand) { const d = [0xA5, ...Buffer.from(url + ' ', 'latin1'), 0x9B]; d.splice(1 + url.length, 1); img = img.concat([0x80, 0x04, 0x80 + d.length - 1 & 255, 0x04], d); }
    await p.evaluate((x) => ataricraft.bootFile('WGET.COM', new Uint8Array(x)), img);
    await p.waitForTimeout(2500);
    if (!hand) await p.evaluate((t) => ataricraft.type(t), url + '\n');
    await p.waitForTimeout(5000);
    if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + core + '.png' });
    if (process.env.DBG) console.log(await p.evaluate(() => { const e = FujiNet.emu; return JSON.stringify({ spec: String.fromCharCode(...Array.from(e.peek(0x3000, 40)).map((c) => (c === 0x9b ? 10 : c))), dcb: Array.from(e.peek(0x300, 12)) }); }));
    const out = await p.evaluate(() => { const e = FujiNet.emu; return String.fromCharCode(...Array.from(e.peek(0x3200, 25)).map((c) => (c === 0x9b ? 10 : c))); });
    if (ftp && process.env.DBG) console.log('ftp log', JSON.stringify(ftp.log));
    const ok = out === BODY;
    console.log(core, JSON.stringify(out), errs, ok ? 'OK' : 'FAILED');
    if (!ok) bad++;
    await p.close();
  }
  await b.close(); relay.kill(); web.close(); if (ftp) ftp.close();
  process.exit(bad ? 1 : 0);
})();
