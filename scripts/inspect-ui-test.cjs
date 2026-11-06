// Inspector UI end to end: every tab, the built-in program picker, bank scan from the buttons, and the same things through tools/ctl.cjs.
// Also writes the Inspector screenshots to docs/screenshots when run with "shots". Usage: node scripts/inspect-ui-test.cjs [shots]
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn, execFileSync } = require('child_process');
const ROOT = 'C:/Users/raver/ataricraft', PORT = '8798', SHOTS = process.argv[2] === 'shots', OUT = ROOT + '/docs/screenshots/';
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
const ctl = (...a) => execFileSync('node', [ROOT + '/tools/ctl.cjs', ...a], { env: Object.assign({}, process.env, { AC_TOKEN: 'testtoken', AC_URL: 'http://127.0.0.1:' + PORT }), encoding: 'utf8', timeout: 90000 });
(async () => {
  const relay = spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', PORT, '--allow-lan'], { env: Object.assign({}, process.env, { AC_TOKEN: 'testtoken' }) });
  await new Promise((r) => setTimeout(r, 800));
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  let pt; const p = await (await b.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:' + PORT + '/');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.selectOption('#model', '130xe'); await p.selectOption('#core', 'atari800'); await p.selectOption('#ram', '1088');
  await p.click('#boot'); await p.waitForTimeout(3500);
  await p.evaluate(() => { FujiNet.enabled = true; FujiNet.bridge = location.origin; if (FujiNet.emu.fnDevice) FujiNet.emu.fnDevice(true); });
  await p.waitForTimeout(3000);
  const panel = async () => pt.evaluate(() => { const w = [...document.querySelectorAll('div')].find((d) => d.style.position === 'fixed' && /INSPECT/.test(d.textContent.slice(0, 40))); return !!w; });
  const tab = async (name) => { await pt.click(`text="${name}" >> xpath=ancestor-or-self::button`); await p.waitForTimeout(500); };
  const shot = async (name, full) => { if (!SHOTS) return; const w = pt.locator('div[style*="position: fixed"]', { hasText: 'INSPECT' }).first(); if (full) await p.screenshot({ path: OUT + name }); else await w.screenshot({ path: OUT + name }); };
  const screen = () => p.evaluate(() => ataricraft.screenText());

  // sidebar button and panel
  pt = await p.context().newPage(); await pt.goto('http://127.0.0.1:' + PORT + '/tools.html#insp'); await p.bringToFront(); await p.waitForTimeout(600);
  ok(await panel(), 'sidebar Inspect button opens the panel');
  const tabs = await pt.evaluate(() => [...document.querySelectorAll('div')].find((d) => d.style.position === 'fixed' && /INSPECT/.test(d.textContent.slice(0, 40))).querySelectorAll('button').length);
  ok(tabs >= 8, 'panel has the tab buttons and close', tabs);
  await p.evaluate(() => ataricraft.type('10 FOR I=1 TO 5:PRINT "INSPECTING ";I:NEXT I\nRUN\n')); await p.waitForTimeout(2500);

  // RAM
  await tab('RAM'); let t = await pt.evaluate(() => document.body.innerText);
  ok(/MEMLO/.test(t), 'RAM tab shows the report'); await shot('09-inspect-ram.png', false); await shot('09-inspect-ram-full.png', true);

  // IP
  await tab('IP'); 
  const ipVals = await pt.evaluate(() => { const w = [...document.querySelectorAll('div')].find((d) => d.style.position === 'fixed' && /INSPECT/.test(d.textContent.slice(0, 40))); return [...w.querySelectorAll('input')].map((i) => i.value).filter(Boolean); });
  ok(ipVals.length >= 6, 'IP tab shows adapter fields', ipVals);
  await p.evaluate(() => AC.Inspect.setIp({ ip: '192.168.50.77', mask: '255.255.255.0', gw: '192.168.50.1', dns: '1.1.1.1', hostname: 'atari-lab', ssid: 'AtariNet', dhcp: true }));
  await tab('IP'); await shot('10-inspect-ip.png', false);

  // built-in programs by button
  await tab('Inject');
  const opts = await p.evaluate(async () => (await AC.Inspect.loadProgs(), AC.Inspect.progs()).map((x) => x.name));
  ok(opts.length >= 16 && opts.includes('PING') && opts.includes('IPCONFIG'), 'built-in program list', opts);
  const w0 = pt.locator('div[style*="position: fixed"]', { hasText: 'INSPECT' }).first();
  await w0.locator('select').selectOption('IPCONFIG'); await w0.locator('button', { hasText: 'Run built-in program' }).click(); await p.waitForTimeout(4000);
  let s = await screen(); ok(/IP: \d+\.\d+\.\d+\.\d+/.test(s), 'IPCONFIG from the button lists interfaces', s.replace(/\s+/g, ' ').slice(0, 200));
  await shot('11-inspect-inject.png', false); await shot('11-inspect-inject-full.png', true);
  for (const n of ['PING', 'NSLOOKUP', 'TRACERT', 'WHOIS', 'CPUTEST', 'GFXTEST', 'SNDTEST', 'KEYTEST', 'TUIDEMO', 'CALC', '80COL', 'AFM', 'AFM80']) {
    await p.evaluate((x) => AC.Inspect.runProg(x), n); await p.waitForTimeout(2200);
    const a = await p.evaluate(() => ataricraft.peek(0x14, 1)[0]); await p.waitForTimeout(500); const c = await p.evaluate(() => ataricraft.peek(0x14, 1)[0]);
    ok(a !== c, `${n} runs (frame counter advances)`);
  }
  // network tab after PING with fake reply
  await p.evaluate(() => AC.Inspect.mock('example.test', 200, 'hello from a fake reply'));
  await p.evaluate(() => AC.Inspect.runProg('PING')); await p.waitForTimeout(2500);
  await tab('Network'); t = await pt.evaluate(() => document.body.innerText); ok(/calls\s+\d+/.test(t), 'Network tab shows counters'); await shot('12-inspect-network.png', false);

  // ctl
  const lst = ctl('progs'); ok(/PING/.test(lst) && /MEMTEST/.test(lst), 'ctl progs lists programs');
  ctl('prog', 'IPCONFIG'); await p.waitForTimeout(3500); s = await screen(); ok(/IP: \d+\.\d+\.\d+\.\d+/.test(s), 'ctl prog IPCONFIG runs it');

  // banks: fill with MEMTEST then use the buttons
  await p.evaluate(() => AC.Inspect.runProg('BANKTEST'));
  let st = null; for (let i = 0; i < 240; i++) { await p.waitForTimeout(1000); st = await p.evaluate(() => AC.MemTest.read(FujiNet.emu)); if (st.done) break; }
  ok(st && st.done && st.errors === 0 && st.found === 64, 'BANKTEST program finds 64 banks clean', st);
  await tab('Banks'); const w = pt.locator('div[style*="position: fixed"]', { hasText: 'INSPECT' }).first();
  await w.locator('button', { hasText: 'Scan banks' }).click(); await p.waitForTimeout(6000);
  t = await w.innerText(); ok(/64 extended banks \(1024 KB\)/.test(t), 'Scan banks button reports 64 banks', t.slice(0, 300));
  const cv = w.locator('canvas').nth(1); const bb = await cv.boundingBox(); await pt.mouse.click(bb.x + 100, bb.y + 3 * 4 + 2); await p.waitForTimeout(800);
  t = await w.innerText(); ok(/Bank 3 /.test(t), 'clicking a heat-map row selects that bank', t.slice(0, 400));
  await w.locator('input[placeholder^="offset"]').first().fill('0100'); await w.locator('button', { hasText: 'Go' }).click(); await p.waitForTimeout(800);
  t = await w.innerText(); ok(/offset \$0100/.test(t), 'offset Go moves the hex view');
  await p.evaluate(() => AC.Inspect.banks.write(5, 0x200, [...'ATARICRAFT'].map((c) => c.charCodeAt(0))));
  await w.locator('input[placeholder^="find"]').first().fill('ATARICRAFT'); await w.locator('button', { hasText: 'Find' }).nth(0).click(); await p.waitForTimeout(8000);
  t = await w.innerText(); ok(/Found: bank 5 \+\$0200/.test(t), 'Find button locates text written into bank 5', t.slice(0, 200));
  await shot('13-inspect-banks.png', false); await shot('13-inspect-banks-full.png', true);
  const bl = ctl('banks'); ok(/64 banks/.test(bl), 'ctl banks'); const bk = ctl('bank', '2', '0', '16'); ok(/^b2:0000 /m.test(bk), 'ctl bank dump', bk);
  ctl('bankwrite', '5', '0200', 'DE', 'AD', 'BE', 'EF'); ok(/DE AD BE EF/.test(ctl('bank', '5', '0200', '4')), 'ctl bankwrite then read back');
  ok(/bank 5 \+\$0200/.test(ctl('bankfind', 'DE AD BE EF')), 'ctl bankfind');
  ctl('bankwrite', '5', '0200', '00', '00', '00', '00');

  // remote tab
  await tab('Remote'); await shot('14-inspect-remote.png', false);
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3));
  await b.close(); relay.kill();
  console.log(bad ? 'INSPECT-UI FAIL ' + bad : 'INSPECT-UI PASS'); process.exit(bad ? 1 : 0);
})();
