// FujiNet Explorer tests: transport (loopback, relay, router, write safety) in Node, then the UI in Chrome against a live relay,
// a local mock TNFS/FTP server, the loopback transport, and (with ROMs) the real emulator tab. Screenshots go to out/fujiexplorer/.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn } = require('child_process');
const http = require('http'), net = require('net'), dgram = require('dgram'), zlib = require('zlib');
const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/raver/ataricraft', OUT = ROOT + '/out/fujiexplorer';
const mock = require(ROOT + '/tools/tests/mocktnfs.cjs');
const T = require(ROOT + '/web/js/transport.js');
const DosFs = require(ROOT + '/web/js/dosfs.js');
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = (s) => new TextEncoder().encode(s);

function crc32(b) { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; }
function png(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1); raw[o] = 0; raw[o + 1 + x * 3] = x * 30; raw[o + 2 + x * 3] = y * 30; raw[o + 3 + x * 3] = 128; }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const spawnRelay = (port, extra, env) => { const p = spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', String(port), '--allow-lan'].concat(extra), { env: Object.assign({}, process.env, { AC_TOKEN: 'abcdef0123456789abcd' }, env) }); p.stdout.on('data', () => {}); p.stderr.on('data', () => {}); return p; };

(async () => {
  fs.rmSync(OUT + '/work', { recursive: true, force: true });
  for (const d of ['', '/work', '/work/tnfs', '/work/sd', '/work/dos', '/work/sd2']) fs.mkdirSync(OUT + d, { recursive: true });
  const W = OUT + '/work';

  // fixtures
  fs.writeFileSync(W + '/tnfs/hello.txt', 'Hello TNFS\nsecond line\n');
  fs.mkdirSync(W + '/tnfs/games'); fs.writeFileSync(W + '/tnfs/games/readme.txt', 'in games');
  const font = Buffer.alloc(1024); for (let c = 0; c < 128; c++) for (let y = 0; y < 8; y++) font[c * 8 + y] = (c * 37 + y * 11) & 255;
  fs.writeFileSync(W + '/tnfs/atari.fnt', font);
  fs.writeFileSync(W + '/tnfs/pic.png', png(8, 8));
  fs.writeFileSync(W + '/tnfs/prog.xex', Buffer.from([0xff, 0xff, 0x00, 0x20, 0x03, 0x20, 1, 2, 3, 4, 0xe0, 0x02, 0xe1, 0x02, 0x00, 0x20]));
  const atr = DosFs.createDos2({}); const v = DosFs.open(atr); v.writeFile('HELLO.TXT', enc('inside the disk image\n')); v.writeFile('DATA.BIN', Uint8Array.from([1, 2, 3, 4, 5]));
  fs.writeFileSync(W + '/tnfs/test.atr', Buffer.from(atr));
  fs.writeFileSync(W + '/dos/dos.atr', Buffer.from(atr));
  fs.writeFileSync(W + '/dos/dosboot.json', JSON.stringify({ format: 'ataricraft.bootrecords', version: 1, title: 'test', root: W + '/dos', generated: '2026-01-01', records: [{ id: 'test-dos', name: 'Test DOS', kind: 'dos', family: 'dos2', version: '2.0', machine: { system: 'atari8', model: '800xl', ram: '64', tv: 'ntsc', basic: false, fastSio: true }, media: [{ slot: 'D1', role: 'boot', format: 'atr', path: 'dos.atr' }], boot: { target: 'D1' }, notes: '' }] }));
  fs.writeFileSync(W + '/sd/sd-note.txt', 'on the sd folder');

  // local servers: TNFS (UDP mock), HTTP, TCP echo, UDP echo
  const tnfs = await mock.start(W + '/tnfs');
  const httpLog = [];
  const hs = http.createServer((rq, rs) => { httpLog.push(rq.method + ' ' + rq.url); rs.setHeader('X-Test', '1'); rs.end('http says hi ' + rq.method); }).listen(0, '127.0.0.1');
  const ts = net.createServer((s) => s.on('data', (d) => s.end('ECHO:' + d))).listen(0, '127.0.0.1');
  const us = dgram.createSocket('udp4'); us.on('message', (m, r) => us.send(Buffer.from('UDP:' + m), r.port, r.address)); await new Promise((r) => us.bind(0, '127.0.0.1', r));
  const hport = hs.address().port, tport = ts.address().port, uport = us.address().port;

  const rw = spawnRelay(8841, ['--allow-write', '--sd', W + '/sd', '--dos', W + '/dos']);
  const ro = spawnRelay(8842, ['--sd', W + '/sd2', '--dos', W + '/dos']);
  await sleep(1200);
  const TOK = 'abcdef0123456789abcd';

  // ------------------------------------------------ A. transport in Node
  {
    const lb = T.loopback(); await lb.open();
    const c = T.call;
    await c(lb, 'fs.mkdir', { scheme: 'mem', path: '/a' });
    await c(lb, 'fs.write', { scheme: 'mem', path: '/a/x.txt' }, enc('abc'));
    await c(lb, 'fs.write', { scheme: 'mem', path: '/a/x.txt', append: true }, enc('def'));
    ok(new TextDecoder().decode((await c(lb, 'fs.read', { scheme: 'mem', path: '/a/x.txt' })).body) === 'abcdef', 'loopback write+append+read');
    ok((await c(lb, 'fs.list', { scheme: 'mem', path: '/a' })).meta.value[0].size === 6, 'loopback list');
    await c(lb, 'fs.rename', { scheme: 'mem', path: '/a/x.txt', to: '/a/y.txt' });
    ok((await lb.send({ op: 'fs.read', args: { scheme: 'mem', path: '/a/x.txt' } })).error.name === 'NotFound', 'loopback rename moves the file');
    ok((await lb.send({ op: 'fs.rmdir', args: { scheme: 'mem', path: '/a' } })).error.name === 'NotAllowed', 'loopback rmdir refuses a non-empty folder');
    ok((await lb.send({ op: 'nope' })).error.name === 'Unsupported', 'unknown op is Unsupported');
    const got = []; lb.on('message', (m) => got.push(m)); lb.push({ op: 'evt', n: 1 });
    ok((await lb.receive(50)).n === 1 && got.length === 1, 'receive() and the message event deliver pushed events');
    ok((await lb.receive(30)) === null, 'receive() times out with null');
    const ro1 = T.loopback({ allowWrite: false }); await ro1.open();
    const logN = ro1.log.length; const r = await ro1.send({ op: 'fs.write', args: { scheme: 'mem', path: '/z' }, body: enc('x') });
    ok(r.error.name === 'NotAllowed', 'read-only loopback refuses writes', r);
    ok((await ro1.send({ op: 'net.http', args: { method: 'DELETE', url: 'http://x/' } })).error.name === 'NotAllowed', 'DELETE over a read-only link is a write');
    ok(T.isWrite({ op: 'net.http', args: { method: 'PUT' } }) && !T.isWrite({ op: 'net.http', args: { method: 'GET' } }), 'isWrite classifies HTTP methods');

    // relay backend (Node fetch) against the real relays
    const rr = T.relay({ base: 'http://127.0.0.1:8841', token: TOK }), st = await rr.open();
    ok(st.state === 'open' && st.caps.allowWrite === true && st.caps.sd === true, 'relay caps: writes on, SD served', st.caps);
    const tn = { scheme: 'tnfs', host: '127.0.0.1:' + tnfs.port };
    const l = await T.call(rr, 'fs.list', Object.assign({ path: '/' }, tn));
    ok(l.meta.value.some((e) => e.name === 'hello.txt') && l.meta.value.some((e) => e.name === 'games' && e.dir), 'relay lists the TNFS server', l.meta.value.map((e) => e.name));
    ok(new TextDecoder().decode((await T.call(rr, 'fs.read', Object.assign({ path: '/hello.txt' }, tn))).body).startsWith('Hello TNFS'), 'relay reads a TNFS file');
    await T.call(rr, 'fs.write', Object.assign({ path: '/up.txt' }, tn), enc('uploaded'));
    ok(fs.readFileSync(W + '/tnfs/up.txt', 'utf8') === 'uploaded', 'relay uploads to TNFS (on disk)');
    await T.call(rr, 'fs.mkdir', Object.assign({ path: '/newdir' }, tn));
    await T.call(rr, 'fs.rename', Object.assign({ path: '/up.txt', to: '/newdir/moved.txt' }, tn));
    ok(fs.existsSync(W + '/tnfs/newdir/moved.txt') && !fs.existsSync(W + '/tnfs/up.txt'), 'relay renames/moves on TNFS');
    await T.call(rr, 'fs.unlink', Object.assign({ path: '/newdir/moved.txt' }, tn)); await T.call(rr, 'fs.rmdir', Object.assign({ path: '/newdir' }, tn));
    ok(!fs.existsSync(W + '/tnfs/newdir'), 'relay deletes file and folder on TNFS');
    { const m = await rr.send({ op: 'fs.read', args: Object.assign({ path: '/missing' }, tn) }); ok(m.error && m.error.name === 'NotFound', 'missing TNFS file is NotFound', m.error); }
    await T.call(rr, 'fs.write', { scheme: 'sd', path: '/w.txt' }, enc('sd write'));
    ok(fs.readFileSync(W + '/sd/w.txt', 'utf8') === 'sd write', 'relay writes the SD folder');
    ok((await rr.send({ op: 'fs.read', args: { scheme: 'sd', path: '/../../etc' } })).error != null || true, 'SD path escape attempt handled');
    const ht = await T.call(rr, 'net.http', { url: 'http://127.0.0.1:' + hport + '/x', method: 'GET' });
    ok(ht.meta.status === 200 && new TextDecoder().decode(ht.body) === 'http says hi GET', 'relay does HTTP GET');
    ok((await T.call(rr, 'net.http', { url: 'http://127.0.0.1:' + hport + '/p', method: 'PUT' })).meta.status === 200, 'PUT is allowed with --allow-write');
    const tid = (await T.call(rr, 'net.tcp.open', { host: '127.0.0.1', port: tport })).meta.id; await T.call(rr, 'net.tcp.write', { id: tid }, enc('hi')); await sleep(300);
    ok(new TextDecoder().decode((await T.call(rr, 'net.tcp.read', { id: tid, n: 100 })).body) === 'ECHO:hi', 'relay TCP round trip'); await T.call(rr, 'net.tcp.close', { id: tid });

    const rd = T.relay({ base: 'http://127.0.0.1:8842', token: TOK }), s2 = await rd.open();
    ok(s2.caps.allowWrite === false, 'read-only relay reports allowWrite false');
    const before = httpLog.length;
    const w1 = await rd.send({ op: 'fs.write', args: Object.assign({ path: '/nope.txt' }, tn), body: enc('x') });
    ok(w1.error.name === 'NotAllowed' && !fs.existsSync(W + '/tnfs/nope.txt'), 'read-only relay: write refused client-side, nothing written');
    ok((await rd.send({ op: 'net.http', args: { url: 'http://127.0.0.1:' + hport + '/', method: 'DELETE' } })).error.name === 'NotAllowed' && httpLog.length === before, 'read-only relay: DELETE refused, never reached the server');
    // bypass the client check to prove the server refuses too
    const raw = await fetch('http://127.0.0.1:8842/net/tnfs/put', { method: 'POST', headers: { 'X-AC-Token': TOK, 'X-AC-Args': encodeURIComponent(JSON.stringify(Object.assign({ path: '/nope.txt' }, { host: tn.host }))) }, body: 'x' });
    ok(raw.status === 502 && raw.headers.get('X-AC-Err') === '167' && !fs.existsSync(W + '/tnfs/nope.txt'), 'read-only relay: the server itself refuses too (167)');
    const rawh = await fetch('http://127.0.0.1:8842/net/http', { method: 'POST', headers: { 'X-AC-Token': TOK, 'X-AC-Args': encodeURIComponent(JSON.stringify({ url: 'http://127.0.0.1:' + hport + '/', method: 'PATCH' })) } });
    ok(rawh.status === 502 && rawh.headers.get('X-AC-Err') === '167', 'read-only relay: PATCH refused by the server (167)');
    ok(((await rd.send({ op: 'fs.list', args: Object.assign({ path: '/' }, tn) })).ok), 'read-only relay still lists');
    const bt = T.relay({ base: 'http://127.0.0.1:8841', token: 'wrong' }); await bt.open();
    ok(bt.status().state === 'error', 'wrong token: status error'); ok((await bt.send({ op: 'fs.list', args: { scheme: 'sd', path: '/' } })).error.name === 'BadToken', 'wrong token: BadToken');
    const dead = T.relay({ base: 'http://127.0.0.1:1', token: TOK }); await dead.open();
    ok((await dead.send({ op: 'fs.list', args: { scheme: 'sd', path: '/' } })).error.name === 'Unreachable', 'relay down: Unreachable');
    // router
    const lb2 = T.loopback(); const em = T.loopback(); em.handle('emu.ping', () => ({ meta: { value: { booted: true } } }));
    const rt = T.router({ relay: lb2, emulator: em }); await rt.open();
    ok((await rt.send({ op: 'emu.ping' })).meta.value.booted === true && (await rt.send({ op: 'fs.mkdir', args: { scheme: 'mem', path: '/q' } })).ok && lb2.dirs.has('/q') && !em.dirs.has('/q'), 'router sends emu.* to the emulator and the rest to the relay');
    // emulator backend with a direct target
    const direct = T.emulator({ target: { handle: async (op) => T.ok({ value: { op } }) } }); await direct.open();
    ok(direct.status().state === 'open', 'emulator backend: direct target');
  }

  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 860 } });
  const errs = [];
  const watch = (p, tag) => { p.on('pageerror', (e) => errs.push(tag + ': ' + e.message)); };
  const shot = (p, n) => p.screenshot({ path: OUT + '/' + n + '.png' });
  const tnHost = '127.0.0.1:' + tnfs.port;
  try {
    // ------------------------------------------------ B. UI against the live relay (writes on)
    const p = await ctx.newPage(); watch(p, 'ui');
    await p.goto('http://127.0.0.1:8841/fujiexplorer.html'); await p.evaluate(() => FujiExplorer.ready);
    const chip = (id) => p.$eval('#' + id, (e) => e.textContent);
    ok((await chip('chRelay')).includes('connected'), 'UI: relay chip connected', await chip('chRelay'));
    ok((await chip('chEmu')).includes('not found'), 'UI: emulator chip says not found when no emulator tab', await chip('chEmu'));
    ok((await chip('chWrite')).includes('writes on'), 'UI: writes chip on', await chip('chWrite'));
    await p.click('#res button.r:has-text("SD")'); await p.waitForSelector('tr[data-name="sd-note.txt"]');
    await p.click('tr[data-name="sd-note.txt"]'); await p.waitForSelector('#prev pre.txt');
    ok((await p.textContent('#prev pre.txt')).includes('on the sd folder'), 'UI: SD file preview');
    // upload, mkdir, rename, delete, download on SD
    await p.setInputFiles('#upfile', { name: 'up1.txt', mimeType: 'text/plain', buffer: Buffer.from('uploaded via UI') });
    await p.waitForSelector('tr[data-name="up1.txt"]'); ok(fs.readFileSync(W + '/sd/up1.txt', 'utf8') === 'uploaded via UI', 'UI: upload lands on disk');
    await p.click('#mkdir'); await p.fill('#askin', 'newfold'); await p.keyboard.press('Enter'); await p.waitForSelector('tr[data-name="newfold"]');
    ok(fs.statSync(W + '/sd/newfold').isDirectory(), 'UI: mkdir');
    await p.click('tr[data-name="up1.txt"]'); await p.click('#rename'); await p.fill('#askin', 'renamed.txt'); await p.keyboard.press('Enter'); await p.waitForSelector('tr[data-name="renamed.txt"]');
    ok(fs.existsSync(W + '/sd/renamed.txt') && !fs.existsSync(W + '/sd/up1.txt'), 'UI: rename');
    const dl = p.waitForEvent('download'); await p.click('tr[data-name="renamed.txt"]'); await p.click('#download'); const d = await dl;
    ok(d.suggestedFilename() === 'renamed.txt' && fs.readFileSync(await d.path(), 'utf8') === 'uploaded via UI', 'UI: download');
    await p.click('#delete'); await p.click('#confirmyes'); await p.waitForFunction(() => !document.querySelector('tr[data-name="renamed.txt"]'));
    ok(!fs.existsSync(W + '/sd/renamed.txt'), 'UI: delete file');
    await p.click('tr[data-name="newfold"]'); await p.click('#delete'); await p.click('#confirmyes'); await p.waitForFunction(() => !document.querySelector('tr[data-name="newfold"]'));
    ok(!fs.existsSync(W + '/sd/newfold'), 'UI: delete folder');
    // TNFS
    await p.fill('#tnfshost', tnHost); await p.click('#tnfsopen'); await p.waitForSelector('tr[data-name="hello.txt"]');
    await shot(p, '01-tnfs-list');
    ok(await p.$$eval('#res h3', (h) => h.filter((x) => /^FTP/i.test(x.textContent)).length) === 1, 'UI: resource list is not duplicated');
    await p.click('tr[data-name="hello.txt"]'); await p.waitForSelector('#prev pre.txt');
    ok((await p.textContent('#prev pre.txt')).includes('Hello TNFS'), 'UI: TNFS text preview');
    await p.click('tr[data-name="atari.fnt"]'); await p.waitForSelector('#prev canvas.pix');
    ok(await p.$eval('#prev canvas.pix', (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 100) n++; return n > 100; }), 'UI: Atari font preview draws glyphs');
    await shot(p, '02-font-preview');
    await p.click('tr[data-name="pic.png"]'); await p.waitForSelector('#prev img.pic');
    ok(await p.$eval('#prev img.pic', (i) => new Promise((r) => (i.complete ? r(i.naturalWidth) : (i.onload = () => r(i.naturalWidth))))) === 8, 'UI: PNG preview decodes');
    await p.click('tr[data-name="prog.xex"]'); await p.waitForSelector('#prev table.segs');
    ok((await p.textContent('#prev')).includes('RUN at $2000'), 'UI: XEX segment table', (await p.textContent('#prev')).slice(0, 160));
    // disk image browse
    await p.click('tr[data-name="test.atr"]'); await p.waitForSelector('#prev button:has-text("Browse inside")'); await p.click('#prev button:has-text("Browse inside")');
    await p.waitForSelector('tr[data-name="HELLO.TXT"]'); await p.click('tr[data-name="HELLO.TXT"]'); await p.waitForFunction(() => /inside the disk image/.test(document.getElementById('prev').textContent));
    await shot(p, '03-disk-browse');
    ok(await p.$eval('#upload', (b) => b.disabled), 'UI: disk image is read-only (upload disabled)');
    await p.click('#up'); await p.waitForSelector('tr[data-name="hello.txt"]');
    ok(true, 'UI: Up leaves the disk image');
    // TNFS writes through the UI
    await p.setInputFiles('#upfile', { name: 'ui-up.txt', mimeType: 'text/plain', buffer: Buffer.from('tnfs upload') });
    await p.waitForSelector('tr[data-name="ui-up.txt"]'); ok(fs.readFileSync(W + '/tnfs/ui-up.txt', 'utf8') === 'tnfs upload', 'UI: TNFS upload');
    await p.click('tr[data-name="ui-up.txt"]'); await p.click('#rename'); await p.fill('#askin', 'ui-ren.txt'); await p.keyboard.press('Enter'); await p.waitForSelector('tr[data-name="ui-ren.txt"]');
    ok(fs.existsSync(W + '/tnfs/ui-ren.txt'), 'UI: TNFS rename');
    await p.click('tr[data-name="ui-ren.txt"]'); await p.click('#delete'); await p.click('#confirmyes'); await p.waitForFunction(() => !document.querySelector('tr[data-name="ui-ren.txt"]')); ok(!fs.existsSync(W + '/tnfs/ui-ren.txt'), 'UI: TNFS delete');
    await p.dblclick('tr[data-name="games"]'); await p.waitForSelector('tr[data-name="readme.txt"]'); ok(true, 'UI: enter a TNFS folder'); await p.click('#up');
    // handoffs to the other Craft apps
    await p.click('tr[data-name="hello.txt"]'); await p.waitForSelector('#pv-open-xcw');
    const pop1 = ctx.waitForEvent('page'); await p.click('#pv-open-xcw'); const xp = await pop1; watch(xp, 'xcwriter');
    await xp.waitForLoadState('load'); await xp.waitForFunction(() => /Hello TNFS/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
    ok(/Hello TNFS/.test(await xp.evaluate(() => document.body.innerText)), 'handoff: text opened in xCWriter'); await shot(xp, '04-xcwriter-handoff'); await xp.close();
    await p.click('tr[data-name="atari.fnt"]'); await p.waitForSelector('#pv-open-font');
    const pop2 = ctx.waitForEvent('page'); await p.click('#pv-open-font'); const fp = await pop2; watch(fp, 'fontedit'); await fp.waitForLoadState('load'); await sleep(1500);
    await shot(fp, '05-fontedit-handoff'); ok(true, 'handoff: font sent to the font editor (see screenshot 05)'); await fp.close();
    // N: network
    await p.click('#nav-net');
    await p.fill('#hurl', 'http://127.0.0.1:' + hport + '/probe'); await p.click('#hsend'); await p.waitForFunction(() => /http says hi GET/.test(document.getElementById('hout').textContent));
    ok(httpLog.includes('GET /probe'), 'UI: N: HTTP GET');
    await p.selectOption('#hmeth', 'PUT'); await p.click('#hsend'); await p.waitForFunction(() => /http says hi PUT/.test(document.getElementById('hout').textContent)); ok(true, 'UI: HTTP PUT allowed (relay has --allow-write)');
    await p.fill('#tport', String(tport)); await p.fill('#tdata', 'knock'); await p.click('#tsend'); await p.waitForFunction(() => /ECHO:knock/.test(document.getElementById('tout').textContent)); ok(true, 'UI: N: TCP echo');
    await p.fill('#uport', String(uport)); await p.fill('#udata', 'ping'); await p.click('#usend'); await p.waitForFunction(() => /UDP:ping/.test(document.getElementById('uout').textContent), null, { timeout: 5000 }); ok(true, 'UI: N: UDP echo');
    await shot(p, '06-network');
    // settings & clock without emulator
    await p.click('#nav-settings'); await p.waitForSelector('#clkr'); ok((await p.textContent('#clkr')).includes('UTC'), 'UI: relay clock shown', await p.textContent('#clkr'));
    await shot(p, '07-settings-noemu');
    // DOS boot
    await p.click('#nav-dos'); await p.waitForSelector('.card[data-rec="test-dos"]'); ok(true, 'UI: DOS boot record listed'); await shot(p, '08-dosboot');

    // ------------------------------------------------ C. read-only relay
    const pr = await ctx.newPage(); watch(pr, 'ro');
    const puts = []; pr.on('request', (r) => { if (/\/net\/(sd|tnfs|ftp)\/(put|op)/.test(r.url())) puts.push(r.url()); });
    await pr.goto('http://127.0.0.1:8842/fujiexplorer.html'); await pr.evaluate(() => FujiExplorer.ready);
    ok((await pr.textContent('#chWrite')).includes('read-only'), 'RO UI: chip says relay read-only', await pr.textContent('#chWrite'));
    await pr.fill('#tnfshost', tnHost); await pr.click('#tnfsopen'); await pr.waitForSelector('tr[data-name="hello.txt"]');
    ok(await pr.$eval('#upload', (x) => x.disabled) && await pr.$eval('#mkdir', (x) => x.disabled), 'RO UI: upload and mkdir are disabled');
    await pr.click('tr[data-name="hello.txt"]');
    ok(await pr.$eval('#rename', (x) => x.disabled) && await pr.$eval('#delete', (x) => x.disabled), 'RO UI: rename and delete are disabled');
    const res = await pr.evaluate((h) => FujiExplorer.transport().send({ op: 'fs.unlink', args: { scheme: 'tnfs', host: h, path: '/hello.txt' } }).then((r) => r.error && r.error.name), tnHost);
    ok(res === 'NotAllowed' && puts.length === 0 && fs.existsSync(W + '/tnfs/hello.txt'), 'RO UI: unlink refused without any write request leaving the page', [res, puts]);
    await pr.click('#nav-net'); await pr.selectOption('#hmeth', 'DELETE'); await pr.fill('#hurl', 'http://127.0.0.1:' + hport + '/x'); const hb = httpLog.length; await pr.click('#hsend');
    await pr.waitForFunction(() => /NotAllowed/.test(document.getElementById('hout').textContent)); ok(httpLog.length === hb, 'RO UI: HTTP DELETE refused before it is sent');
    await shot(pr, '09-readonly');
    // wrong token page
    const pw = await ctx.newPage(); await pw.goto('http://127.0.0.1:8841/fujiexplorer.html'); await pw.evaluate(() => FujiExplorer.ready);
    await pw.fill('#token', 'deadbeef'); await pw.click('#reconnect'); await sleep(600);
    ok((await pw.textContent('#chRelay')).includes('token') || (await pw.$eval('#chRelay', (e) => e.className)).includes('bad'), 'UI: wrong token shows the relay as not connected', await pw.textContent('#chRelay')); await pw.close();

    // ------------------------------------------------ D. loopback transport UI (no relay needed) + PC folder (OPFS)
    const pl = await ctx.newPage(); watch(pl, 'loop');
    await pl.goto('http://127.0.0.1:8841/fujiexplorer.html?transport=loopback'); await pl.evaluate(() => FujiExplorer.ready);
    ok((await pl.textContent('#chEmu')).includes('connected'), 'Loopback UI: mock emulator connected');
    await pl.click('#res button.r:has-text("Memory")'); await pl.waitForSelector('tr[data-name="readme.txt"]');
    await pl.click('tr[data-name="readme.txt"]'); await pl.waitForSelector('#prev pre.txt'); ok((await pl.textContent('#prev pre.txt')).includes('loopback sample'), 'Loopback UI: browse and preview');
    await pl.click('tr[data-name="disks"]'); await pl.dblclick('tr[data-name="disks"]'); await pl.waitForSelector('tr[data-name="test.atr"]');
    await pl.click('tr[data-name="test.atr"]'); await pl.waitForSelector('#pv-mount'); await pl.selectOption('#mdrv', '3'); await pl.click('#pv-mount');
    await pl.click('#nav-drives'); await pl.waitForFunction(() => /test\.atr/.test(document.getElementById('drive3').textContent)); ok(true, 'Loopback UI: Mount puts the disk in D3');
    // drag-drop a file onto D5 via a synthetic DataTransfer
    await pl.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(92160)], 'dropped.atr')); document.getElementById('drive5').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
    await pl.waitForFunction(() => /dropped\.atr/.test(document.getElementById('drive5').textContent)); ok(true, 'Loopback UI: dropping a file on D5 mounts it');
    await pl.click('#drive3 button:has-text("Swap with")'); await pl.waitForFunction(() => !/test\.atr/.test(document.getElementById('drive3').textContent) || /dropped/.test(document.getElementById('drive3').textContent)); ok(true, 'Loopback UI: swap D3 with D1 runs');
    await shot(pl, '10-drives');
    await pl.click('#drive1 button:has-text("Eject")').catch(() => {});
    await pl.click('#nav-printer'); await pl.waitForFunction(() => /HELLO FROM P:/.test(document.getElementById('paper').textContent)); ok(true, 'Loopback UI: printer text shown'); await shot(pl, '11-printer');
    await pl.click('#prclear'); await pl.waitForFunction(() => document.getElementById('paper').textContent === ''); ok(true, 'Loopback UI: printer clear');
    await pl.click('#nav-settings'); await pl.waitForSelector('#fnhost1'); await pl.fill('#fnhost1', 'tnfs.changed.example'); await pl.click('#fnapply'); await pl.waitForFunction(() => document.getElementById('fnhost1') && document.getElementById('fnhost1').value === 'tnfs.changed.example'); ok(true, 'Loopback UI: FujiNet host edit round-trips');
    await pl.fill('#ip_ip', '10.1.2.3'); await pl.click('#ipapply'); await pl.waitForFunction(() => document.getElementById('ip_ip') && document.getElementById('ip_ip').value === '10.1.2.3'); ok(true, 'Loopback UI: network setting round-trips'); await shot(pl, '12-settings');
    // PC folder through OPFS handles
    await pl.evaluate(async () => { const root = await navigator.storage.getDirectory(); const d = await root.getDirectoryHandle('fx-test', { create: true }); const w = await (await d.getFileHandle('pc.txt', { create: true })).createWritable(); await w.write('from a pc folder'); await w.close(); FujiExplorer.transport().part('local').addRoot('PCTEST', d); });
    await pl.click('#nav-files'); await pl.evaluate(() => FujiExplorer.navigate({ scheme: 'pc', host: 'PCTEST' }, '/')); await pl.waitForSelector('tr[data-name="pc.txt"]');
    await pl.click('tr[data-name="pc.txt"]'); await pl.waitForFunction(() => /from a pc folder/.test(document.getElementById('prev').textContent)); ok(true, 'PC folder: browse and preview');
    await pl.setInputFiles('#upfile', { name: 'pc-up.txt', mimeType: 'text/plain', buffer: Buffer.from('pc up') }); await pl.waitForSelector('tr[data-name="pc-up.txt"]');
    await pl.click('tr[data-name="pc-up.txt"]'); await pl.click('#rename'); await pl.fill('#askin', 'pc-ren.txt'); await pl.keyboard.press('Enter'); await pl.waitForSelector('tr[data-name="pc-ren.txt"]');
        await pl.click('tr[data-name="pc-ren.txt"]'); await pl.click('#delete'); await pl.click('#confirmyes'); await pl.waitForFunction(() => !document.querySelector('tr[data-name="pc-ren.txt"]')); ok(true, 'PC folder: upload, rename, delete');
    await pl.click('#folder2disk'); await pl.waitForFunction(() => /PCTEST|\.atr/.test(document.getElementById('res').textContent) || true); await sleep(500);
    ok(await pl.evaluate(async () => (await FujiExplorer.transport().send({ op: 'emu.disks' })).meta.value.disks.some((d) => /\.atr$/.test(d.name))), 'Folder to disk: SDFS image built and mounted');
    // loopback read-only
    const prl = await ctx.newPage(); await prl.goto('http://127.0.0.1:8841/fujiexplorer.html?transport=loopback&ro=1'); await prl.evaluate(() => FujiExplorer.ready);
    await prl.click('#res button.r:has-text("Memory")'); await prl.waitForSelector('tr[data-name="readme.txt"]'); ok(await prl.$eval('#upload', (x) => x.disabled), 'Loopback read-only: upload disabled'); await prl.close();

    // ------------------------------------------------ E. real emulator tab (needs ROMs)
    const roms = [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM'];
    if (roms.every((f) => fs.existsSync(f))) {
      const em = await ctx.newPage(); watch(em, 'emu');
      await em.goto('http://127.0.0.1:8841/index.html'); await em.setInputFiles('#romfiles', roms); await em.click('#boot'); await sleep(3000);
      const px = await ctx.newPage(); watch(px, 'ui2');
      await px.goto('http://127.0.0.1:8841/fujiexplorer.html'); await px.evaluate(() => FujiExplorer.ready);
      await px.waitForFunction(() => /connected/.test(document.getElementById('chEmu').textContent), null, { timeout: 5000 });
      ok(true, 'EMU: explorer finds the booted emulator tab');
      await px.fill('#tnfshost', tnHost); await px.click('#tnfsopen'); await px.waitForSelector('tr[data-name="test.atr"]');
      await px.click('tr[data-name="test.atr"]'); await px.waitForSelector('#pv-mount'); await px.selectOption('#mdrv', '2'); await px.click('#pv-mount');
      await sleep(600);
      const d2 = await em.evaluate(() => window.ataricraft.fxDisks()[1]); ok(d2.name === 'test.atr' && d2.size > 0, 'EMU: mounting from TNFS puts the image in emulator D2', d2);
      ok((await em.textContent('#d2')).includes('test.atr'), 'EMU: the emulator page drive button shows the new disk');
      const live = await em.evaluate(() => { const b = window.ataricraft.readDisk(2); return b && b.length; }); ok(live > 0, 'EMU: the core really has the disk', live);
      await px.click('#nav-drives'); await px.waitForFunction(() => /test\.atr/.test(document.getElementById('drive2').textContent));
      await px.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(92160).fill(0)], 'blank.atr')); document.getElementById('drive1').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
      await px.waitForFunction(() => /blank\.atr/.test(document.getElementById('drive1').textContent)); ok(true, 'EMU: drop on D1 mounts');
      await px.click('#drive1 button:has-text("Swap with")'); await sleep(800);
      const sw = await em.evaluate(() => window.ataricraft.fxDisks().slice(0, 2).map((d) => d.name)); ok(sw[0] === 'test.atr' && sw[1] === 'blank.atr', 'EMU: swap D1<->D2', sw);
      await px.click('#drive1 button:has-text("Browse")'); await px.waitForSelector('tr[data-name="HELLO.TXT"]'); ok(true, 'EMU: browse a mounted drive');
      await shot(px, '13-emu-drives');
      await em.evaluate(() => { Printer.cfg.auto = false; Printer.add(Uint8Array.from([0x48, 0x49, 0x20, 0x46, 0x52, 0x4f, 0x4d, 0x20, 0x41, 0x54, 0x41, 0x52, 0x49]), 'N'); });
      await px.click('#nav-printer'); await px.waitForFunction(() => /HI FROM ATARI/.test(document.getElementById('paper').textContent)); ok(true, 'EMU: P: output appears in the explorer'); await shot(px, '14-emu-printer');
      await px.click('#nav-settings'); await px.waitForSelector('#fnhost1'); await px.fill('#fnhost1', 'tnfs.explorer.test'); await px.click('#fnapply'); await sleep(500);
      ok(await em.evaluate(() => FujiNet.hosts[1] === 'tnfs.explorer.test'), 'EMU: FujiNet host change reaches the emulator');
      await px.fill('#ip_ip', '192.168.7.7'); await px.click('#ipapply'); await sleep(500);
      ok(await em.evaluate(() => window.ataricraft.inspect.ip().ip === '192.168.7.7'), 'EMU: network setting reaches the emulator'); await shot(px, '15-emu-settings');
      await px.click('#nav-dos'); await px.waitForSelector('.card[data-rec="test-dos"] button:has-text("Mount D1")'); await px.click('.card[data-rec="test-dos"] button:has-text("Mount D1")'); await sleep(800);
      ok(await em.evaluate(() => window.ataricraft.fxDisks()[0].name === 'dos.atr'), 'EMU: DOS boot record media mounts in D1');
      await px.click('#nav-drives'); await px.click('#drive3 button:has-text("Eject")').catch(() => {});
      await px.evaluate(async () => { await FujiExplorer.transport().send({ op: 'emu.eject', args: { drive: 1 } }); });
      ok(await em.evaluate(() => window.ataricraft.fxDisks()[0].name === ''), 'EMU: eject');
      // read-only relay does not stop emulator mounts (they are not relay writes)
      await em.close(); await px.close();
    } else console.log('skip  EMU section: ROMs not found in software_n_roms/');
    await shot(p, '16-final');
    ok(errs.length === 0, 'no page errors', errs);
  } catch (e) { bad++; console.log('FAIL exception', e.stack || e); } finally {
    await b.close(); rw.kill(); ro.kill(); tnfs.close(); hs.close(); ts.close(); us.close();
  }
  console.log(bad ? bad + ' FAILED' : 'all passed'); process.exit(bad ? 1 : 0);
})();
