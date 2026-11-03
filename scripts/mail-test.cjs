// MAIL.COM end to end against a local POP3 + SMTP server, run from the CMD hand-off line ($0480) on both cores.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn } = require('child_process');
const net = require('net');
const ROOT = 'C:/Users/raver/ataricraft';
const { build } = require(ROOT + '/tools/tests/buildapp.cjs');
const xex = build('mail').xex;
const rec = { dele: [], smtp: [] };
const lines = (sock, f) => { let b = ''; sock.on('data', (d) => { b += d.toString('latin1'); let i; while ((i = b.indexOf('\r\n')) >= 0) { f(b.slice(0, i)); b = b.slice(i + 2); } }); sock.on('error', () => {}); };
const pop = net.createServer((s) => {
  s.write('+OK POP3 ready\r\n'); let user = '';
  lines(s, (l) => {
    const [c, a] = [l.split(' ')[0].toUpperCase(), l.slice(l.indexOf(' ') + 1)];
    if (c === 'USER') { user = a; s.write('+OK\r\n'); }
    else if (c === 'PASS') s.write(user === 'bob' && a === 'secret' ? '+OK logged in\r\n' : '-ERR bad password\r\n');
    else if (c === 'LIST') s.write('+OK 2 messages\r\n1 120\r\n2 340\r\n.\r\n');
    else if (c === 'RETR') s.write('+OK\r\nSubject: Hi\r\n\r\nHello from the Atari mailbox\r\n.\r\n');
    else if (c === 'DELE') { rec.dele.push(a); s.write('+OK deleted\r\n'); }
    else if (c === 'QUIT') { s.write('+OK bye\r\n'); s.end(); }
  });
}).listen(0, '127.0.0.1');
const smtp = net.createServer((s) => {
  s.write('220 ready\r\n'); let data = false, msg = [], env = [];
  lines(s, (l) => {
    if (data) { if (l === '.') { data = false; rec.smtp.push({ env, msg }); s.write('250 queued\r\n'); } else msg.push(l); return; }
    const c = l.split(' ')[0].toUpperCase();
    if (c === 'DATA') { data = true; s.write('354 go\r\n'); }
    else if (c === 'QUIT') { s.write('221 bye\r\n'); s.end(); }
    else { env.push(l); s.write('250 ok\r\n'); }
  });
}).listen(0, '127.0.0.1');
const screen = () => {
  const e = FujiNet.emu, sm = e.peek(0x58, 2), base = sm[0] | (sm[1] << 8), rows = [];
  for (let r = 0; r < 24; r++) rows.push(Array.from(e.peek(base + r * 40, 40)).map((c) => { c &= 0x7f; c = c < 64 ? c + 32 : c < 96 ? c - 64 : c; return String.fromCharCode(c); }).join('').trimEnd());
  return rows.join('\n');
};
(async () => {
  await Promise.all([pop, smtp].map((s) => new Promise((r) => s.once('listening', r))));
  const PP = '127.0.0.1:' + pop.address().port, SP = '127.0.0.1:' + smtp.address().port;
  const relay = spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', '8791', '--allow-lan'], { env: Object.assign({}, process.env, { AC_TOKEN: 'testtoken' }) });
  await new Promise((r) => setTimeout(r, 800));
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  let bad = 0;
  const cases = [
    ['L ' + PP + ' bob secret', (s) => /\+OK 2 messages/.test(s) && /1 120/.test(s) && /2 340/.test(s)],
    ['R ' + PP + ' bob secret 1', (s) => /Subject: Hi/.test(s) && /Hello from the Atari mailbox/.test(s)],
    ['D ' + PP + ' bob secret 2', (s) => /deleted/.test(s) && rec.dele[0] === '2'],
    ['L ' + PP + ' bob wrong', (s) => /bad password/.test(s) && /LOGIN FAILED/.test(s)],
    ['S ' + SP + ' bob@atari.net amy@home.org Hi Amy from the Atari', (s) => /queued/.test(s) && rec.smtp.length >= 1 && rec.smtp[0].env.join('|') === 'HELO atari|MAIL FROM:<bob@atari.net>|RCPT TO:<amy@home.org>' && rec.smtp[0].msg.includes('Hi Amy from the Atari') && rec.smtp[0].msg.includes('To: amy@home.org')],
  ];
  for (const core of (process.env.CORES || 'atari800,altirra').split(',')) {
    const p = await (await b.newContext()).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('file:///' + ROOT + '/web/index.html');
    await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
    await p.selectOption('#core', core);
    await p.click('#boot'); await p.waitForTimeout(3000);
    await p.evaluate(() => {
      FujiNet.enabled = true; FujiNet.bridge = 'http://127.0.0.1:8791'; localStorage.setItem('ac.nettoken', 'testtoken');
      if (FujiNet.emu.fnDevice) FujiNet.emu.fnDevice(true);
    });
    await p.waitForTimeout(4000);
    for (const [line, check] of cases) {
      const d = [0xA5, ...Buffer.from(line, 'latin1'), 0x9B];
      const img = Array.from(xex).concat([0x80, 0x04, (0x80 + d.length - 1) & 255, 0x04], d);
      // The program returns to a bare OS (BOOT ERROR clears the screen), so collect every screen while it runs.
      await p.evaluate((sc) => { window.__snaps = new Set(); window.__dcb = new Set(); clearInterval(window.__iv); window.__iv = setInterval(() => { window.__snaps.add(eval('(' + sc + ')()')); const d = Array.from(FujiNet.emu.peek(0x300, 12)); if (d[0] === 0x71) window.__dcb.add(d.join(',') + ' st=' + Array.from(FujiNet.emu.peek(0x3100, 4)).join(',')); }, 15); }, screen.toString());
      await p.evaluate((x) => ataricraft.bootFile('MAIL.COM', new Uint8Array(x)), img);
      await p.waitForFunction(() => Array.from(window.__snaps).some((x) => x.includes('BOOT ERROR')), null, { timeout: 20000, polling: 20 }).catch(() => {});
      await p.evaluate((x) => ataricraft.bootFile('IDLE.COM', new Uint8Array(x)), [0xFF, 0xFF, 0x00, 0x20, 0x02, 0x20, 0x4C, 0x00, 0x20]);
      await p.waitForTimeout(300);
      const s = (await p.evaluate(() => Array.from(window.__snaps))).join('\n');
      const ok = check(s);
      if (process.env.SHOW || !ok) console.log('---', core, line, '\n' + s);
      console.log(core, line.split(' ').slice(0, 1)[0], errs, ok ? 'OK' : 'FAILED');
      if (!ok) bad++;
    }
    rec.dele.length = 0; rec.smtp.length = 0;
    await p.close();
  }
  await b.close(); relay.kill(); pop.close(); smtp.close();
  process.exit(bad ? 1 : 0);
})();
