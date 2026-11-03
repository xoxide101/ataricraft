// LYNX.COM end to end: renders an HTML page (tags, entities, script skipped, links), then follows link 1.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
const { assemble } = require(ROOT + '/web/js/asm6502.js');
const xex = assemble(fs.readFileSync(ROOT + '/tools/tests/lynx.asm', 'utf8')).xex;
const PAGES = {
  '/': '<html><head><title>T</title><style>p{color:red}</style><script>var x="HIDDEN";</script></head><body>\n<h1>Hello Atari</h1>\n<p>Tom &amp; Jerry <b>bold</b> text that is long enough to wrap across the screen width of forty columns.</p>\n<ul><li>one<li>two</ul>\n<a href="/two">Next page</a> and <a href="three.html">third</a>\n</body></html>',
  '/two': '<p>SECOND PAGE OK</p>',
  '/three.html': '<p>THIRD PAGE OK</p>',
};
const screen = () => {
  const e = FujiNet.emu, sm = e.peek(0x58, 2), base = sm[0] | (sm[1] << 8), rows = [];
  for (let r = 0; r < 24; r++) rows.push(Array.from(e.peek(base + r * 40, 40)).map((c) => { c &= 0x7f; c = c < 64 ? c + 32 : c < 96 ? c - 64 : c; return String.fromCharCode(c); }).join('').trimEnd());
  return rows.join('\n');
};
(async () => {
  const web = http.createServer((q, p) => { const b = PAGES[q.url]; p.statusCode = b ? 200 : 404; p.setHeader('Content-Type', 'text/html'); p.end(b || 'nf'); }).listen(0, '127.0.0.1');
  await new Promise((r) => web.once('listening', r));
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
    await p.evaluate(() => { FujiNet.enabled = true; FujiNet.bridge = 'http://127.0.0.1:8791'; localStorage.setItem('ac.nettoken', 'testtoken'); if (FujiNet.emu.fnDevice) FujiNet.emu.fnDevice(true); });
    await p.waitForTimeout(4000);
    await p.evaluate((x) => ataricraft.bootFile('LYNX.COM', new Uint8Array(x)), Array.from(xex));
    await p.waitForTimeout(2500);
    await p.evaluate((t) => ataricraft.type(t), 'http://127.0.0.1:' + web.address().port + '/\n');
    await p.waitForTimeout(7000);
    const s1 = await p.evaluate(`(${screen.toString()})()`);
    if (process.env.DBG) console.log('before1', await p.evaluate(() => String.fromCharCode(...Array.from(FujiNet.emu.peek(0x3000, 40)).map((c) => (c === 0x9b ? 10 : c || 46)))));
    await p.evaluate(() => ataricraft.type('1\n'));
    await p.waitForTimeout(6000);
    const s2 = await p.evaluate(`(${screen.toString()})()`);
    if (process.env.DBG) console.log(JSON.stringify(await p.evaluate(() => window.__o)));
    if (process.env.DBG) console.log(await p.evaluate(() => { const e = FujiNet.emu; const s = (a, n) => String.fromCharCode(...Array.from(e.peek(a, n)).map((c) => (c === 0x9b ? 10 : c || 46))); return JSON.stringify({ zp: Array.from(e.peek(0x80, 34)).map((x) => x.toString(16)).join(' '), spec: s(0x3000, 40), link0: s(0x3500, 20), base: s(0x3800, 40) }); }));
    if (process.env.SHOW) console.log(s1 + '\n-----\n' + s2);
    const up = s1.toUpperCase();
    const ok1 = /HELLO ATARI/.test(up) && /TOM & JERRY/.test(up) && !/HIDDEN|COLOR/.test(up) && /NEXT PAGE\[1\]/.test(up) && /THIRD\[2\]/.test(up) && !/[<>]/.test(s1.replace(/[<>]/g, (m, i) => (s1.slice(i - 3, i + 3).includes('--') ? '' : m)));
    await p.evaluate((t) => ataricraft.type(t), 'http://127.0.0.1:' + web.address().port + '/\n');
    await p.waitForTimeout(6000);
    await p.evaluate(() => ataricraft.type('2\n'));
    await p.waitForTimeout(6000);
    const s3 = await p.evaluate(`(${screen.toString()})()`);
    const ok2 = /SECOND PAGE OK/.test(s2.toUpperCase()) && /THIRD PAGE OK/.test(s3.toUpperCase());
    console.log(core, 'page', ok1 ? 'OK' : 'FAILED', 'link', ok2 ? 'OK' : 'FAILED', errs);
    if (!(ok1 && ok2)) bad++;
    await p.close();
  }
  await b.close(); relay.kill(); web.close();
  process.exit(bad ? 1 : 0);
})();
