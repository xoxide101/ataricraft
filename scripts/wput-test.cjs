// WPUT.COM end to end on DOS 2.5: reads D1:DATA.TXT and uploads it to a local mock FTP server (ftp://, STOR) and an HTTP server (PUT).
// Also checks that the relay refuses the upload when started without --allow-write.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/raver/ataricraft';
const { assemble } = require(ROOT + '/web/js/asm6502.js');
const Dos = require(ROOT + '/web/js/dosfs.js');
const mock = require(ROOT + '/tools/tests/mockftp.cjs');
const xex = assemble(require(ROOT + '/tools/tests/buildapp.cjs').build('wput').src).xex;
const DATA = Buffer.from('upload line 1\r\nline 2 \x00\x01\xff end\r\n');
let bad = 0;
// The args line CMD.COM would leave at $0480 is appended to the program as a data segment (DOS clobbers $0480 while loading).
const withArgs = (a) => { const d = [0xA5, ...Buffer.from(a, 'latin1'), 0x9B]; return Array.from(xex).concat([0x80, 0x04, (0x480 + d.length - 1) & 255, (0x480 + d.length - 1) >> 8], d, [0x00, 0x06, 0x05, 0x06, 0x20, 0x00, 0x20, 0x4C, 0x03, 0x06], [0xE0, 0x02, 0xE1, 0x02, 0x00, 0x06]); };
// the extra segment at $0600 runs the program then spins, so its last messages stay on screen instead of the DOS menu redraw
const ARGS = (port, ftp, web) => ({ 'WPUTF.COM': 'DATA.TXT ftp://atari:secret@127.0.0.1:' + ftp.port + '/up.bin', 'WPUTH.COM': 'DATA.TXT http://127.0.0.1:' + web.address().port + '/put/here' });
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
(async () => {
  const root = path.join(ROOT, 'out', 'wput-ftp'); fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root, { recursive: true });
  const ftp = await mock.start(root, { user: 'atari', pass: 'secret' });
  const puts = [];
  const web = http.createServer((q, r) => { const a = []; q.on('data', (d) => a.push(d)); q.on('end', () => { puts.push({ m: q.method, u: q.url, b: Buffer.concat(a) }); r.statusCode = 201; r.end('ok'); }); }).listen(0, '127.0.0.1');
  await new Promise((r) => web.once('listening', r));
  const relays = [];
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  for (const core of (process.env.CORES || 'atari800').split(',')) for (const allow of [true, false]) {
    const port = allow ? 8793 : 8794;
    const relay = spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', String(port), '--allow-lan'].concat(allow ? ['--allow-write'] : []), { env: Object.assign({}, process.env, { AC_TOKEN: 'testtoken' }) });
    relays.push(relay); if (process.env.DBG) { relay.stdout.on('data', (d) => process.stdout.write('[relay] ' + d)); relay.stderr.on('data', (d) => process.stdout.write('[relay!] ' + d)); } await new Promise((r) => setTimeout(r, 800));
    const tag = core + (allow ? '/write' : '/readonly');
    const p = await (await b.newContext()).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('file:///' + ROOT + '/web/index.html');
    await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
    await p.selectOption('#core', core);
    const img = new Uint8Array(fs.readFileSync(ROOT + '/web/library/craftapps/DOS images/Atari DOS 2.5.atr'));
    const v = Dos.open(img); for (const [n, a] of Object.entries(ARGS(port, ftp, web))) v.writeFile(n, new Uint8Array(withArgs(a))); v.writeFile('MEM.SAV', new Uint8Array(8192)); v.writeFile('DATA.TXT', new Uint8Array(DATA));
    await p.setInputFiles('#f1', { name: 'WPUT.atr', mimeType: 'application/octet-stream', buffer: Buffer.from(v.image ? v.image() : img) });
    await p.click('#boot'); await p.waitForTimeout(9000);
    await p.evaluate(() => ataricraft.type('DOS\n')); await p.waitForTimeout(6000);
    await p.evaluate((port) => { FujiNet.enabled = true; FujiNet.bridge = 'http://127.0.0.1:' + port; localStorage.setItem('ac.nettoken', 'testtoken'); if (FujiNet.emu.fnDevice) FujiNet.emu.fnDevice(true); }, port);
    await p.waitForTimeout(3000);
    const screen = () => p.evaluate(() => FujiNet.emu.screenText());
    let nrun = 0;
    const run = async (args) => {
      if (nrun++) { await p.click('button:has-text("Cold start")'); await p.waitForTimeout(9000); await p.evaluate(() => ataricraft.type('DOS\n')); await p.waitForTimeout(6000); }
      await p.evaluate(() => ataricraft.type('L\n')); await p.waitForTimeout(3000);
      await p.evaluate((t) => ataricraft.type(t), 'D1:' + args + '\n'); let last = ''; for (let i = 0; i < 30; i++) { await p.waitForTimeout(300); const t = await screen(); if (process.env.DBG && t !== last) console.log('[scr]', JSON.stringify(t.slice(-160))); last = t; }
      return screen();
    };
    let s = await run('WPUTF.COM');
    const f = path.join(root, 'up.bin');
    if (allow) {
            ok(fs.existsSync(f) && Buffer.compare(fs.readFileSync(f), DATA) === 0, tag + ' FTP: server file equals the disk file byte for byte', fs.existsSync(f) && fs.readFileSync(f));
      fs.rmSync(f, { force: true });
    } else {
      ok(!fs.existsSync(f), tag + ' FTP: refused without --allow-write, nothing written', s.slice(-200));
    }
    puts.length = 0;
    s = await run('WPUTH.COM');
    if (allow) {
      ok(puts.length === 1 && puts[0].m === 'PUT' && puts[0].u === '/put/here' && Buffer.compare(puts[0].b, DATA) === 0, tag + ' HTTP PUT: method, path and body', puts.map((x) => [x.m, x.u, x.b.length]));
    } else ok(puts.length === 0, tag + ' HTTP PUT refused without --allow-write', puts.length);
    ok(!errs.length, tag + ' no page errors', errs);
    await p.screenshot({ path: ROOT + '/out/wput-' + core + (allow ? '' : '-ro') + '.png' });
    await p.close(); relay.kill();
  }
  await b.close(); ftp.close(); web.close(); fs.rmSync(root, { recursive: true, force: true });
  console.log(bad ? 'FAILED ' + bad : 'all passed'); process.exit(bad ? 1 : 0);
})();
