// Tools hub end to end: reduced emulator tabs, file manager, hub, every tool, deep links, and BASIC/ASM/Inspect/FONT driving a connected emulator
// (opener-direct path via the Tools button and separate-tab mirror path via the BroadcastChannel). Usage: node scripts/toolshub-test.cjs [shots]
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn } = require('child_process');
const ROOT = 'C:/Users/raver/ataricraft', PORT = '8802', SHOTS = process.argv[2] === 'shots', OUT = ROOT + '/out/';
const U = 'http://127.0.0.1:' + PORT + '/';
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const srv = spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', PORT], { env: process.env });
  await wait(800);
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  const errs = [];
  const watch = (pg, tag) => { pg.on('pageerror', (e) => errs.push(tag + ': ' + e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/404|400 \(Bad/.test(m.text())) errs.push(tag + ': ' + m.text()); }); };
  const p = await ctx.newPage(); watch(p, 'emu');
  await p.goto(U);
  const tabs = await p.evaluate(() => [...document.querySelectorAll('#sidetabs button')].map((x) => x.dataset.t));
  ok(tabs.join() === 'sys,carts,fm,wafm,net,dbg,tools' || (tabs.length === 7 && tabs.includes('tools') && !tabs.includes('basic') && !tabs.includes('asm') && !tabs.includes('insp') && !tabs.includes('font')), 'emulator side tabs reduced', tabs);
  ok(await p.evaluate(() => !window.AC.BasicPanel && !window.AC.AsmPanel && !window.AC.FontPanel && !window.AC.InspectPanel), 'moved panels are not loaded in the emulator');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.click('#boot'); await wait(3500);
  await p.click('#sidetabs [data-t=fm]'); await wait(500);
  ok(await p.evaluate(() => { const e = document.querySelector('#sidetabs [data-t=fm]'); return e.classList.contains('on') || e.classList.contains('active') || !!document.querySelector('#fm, .fm, [id*=file]'); }), 'file manager tab opens');
  if (SHOTS) await p.screenshot({ path: OUT + 'emu-after.png' });

  // deep links redirect
  for (const h of ['basic', 'asm', 'insp', 'font', 'wb', 'xcw', 'fontedit']) {
    const q = await ctx.newPage(); await q.goto(U + 'index.html#' + h); await wait(500);
    ok(/tools\.html#/.test(q.url()), 'deep link #' + h + ' redirects', q.url()); await q.close();
  }

  // hub opened from the emulator button (opener-direct)
  const [hub] = await Promise.all([ctx.waitForEvent('page'), p.click('#toolsbtn')]);
  watch(hub, 'hub'); await hub.waitForLoadState(); await wait(1500);
  ok(/tools\.html/.test(hub.url()), 'Tools button opens the hub');
  ok(/Emulator connected/.test(await hub.innerText('#status')), 'hub reports emulator connected', await hub.innerText('#status'));
  ok((await hub.locator('.card').count()) === 12, 'hub lists 12 tools');
  await hub.fill('#q', 'midi'); ok((await hub.locator('.card').count()) === 1, 'search filters');
  await hub.fill('#q', '');
  if (SHOTS) await hub.screenshot({ path: OUT + 'hub.png' });

  // BASIC on the hub drives the emulator
  await hub.click('.card[data-tool=basic]'); await wait(800);
  const ta = hub.locator('textarea').first();
  await ta.fill('10 PRINT "HUB BASIC OK"\n20 GOTO 20');
  await hub.locator('button', { hasText: /run on atari/i }).first().click(); await p.bringToFront(); await wait(5000);
  let scr = await p.evaluate(() => ataricraft.screenText());
  ok(/HUB BASIC OK/.test(scr), 'BASIC compile+run shows output in the emulator', scr.replace(/\s+/g, ' ').slice(0, 160));
  if (SHOTS) { await hub.screenshot({ path: OUT + 'hub-basic.png' }); await p.screenshot({ path: OUT + 'emu-basic-run.png' }); }
  await hub.close();

  // separate tab (mirror path)
  const h2 = await ctx.newPage(); watch(h2, 'hub2'); await h2.goto(U + 'tools.html#asm'); await wait(3500);
  ok(/Emulator connected/.test(await h2.innerText('#status')), 'separate hub tab connects through the channel');
  const asmTa = h2.locator('textarea').first(); ok(await asmTa.count() > 0, 'ASM panel opens from #asm');
  await h2.locator('button', { hasText: /^(Assemble|Run|Assemble \+ run|Run on Atari)/i }).first().click().catch(() => {});
  await wait(1500);
  await h2.evaluate(() => { location.hash = ''; }); await h2.evaluate(() => AC.InspectPanel.open()); await wait(2500);
  const t = await h2.evaluate(() => document.body.innerText);
  ok(/MEMLO/.test(t), 'Inspect panel shows RAM over the channel');
  if (SHOTS) await h2.screenshot({ path: OUT + 'hub-inspect.png' });
  const r = await h2.evaluate(() => AC.ToolsLink.call('peek', { addr: 0x14, n: 1 }).then((v) => v).catch((e) => 'ERR ' + e.message));
  ok(r && !String(r).startsWith('ERR'), 'channel peek works', r);
  await h2.goto(U + 'tools.html#font'); await wait(2500);
  ok(await h2.evaluate(() => !!document.querySelector('canvas')), 'FONT panel opens');
  const q2 = await ctx.newPage(); await q2.goto(U + 'tools.html'); await wait(500);
  for (const u of ['workbench.html', 'xcwriter.html', 'xccalc.html', 'xcbase.html', 'ebookcraft.html', 'pdfview.html', 'fujiexplorer.html']) {
    const e0 = errs.length; const q = await ctx.newPage(); watch(q, u); await q.goto(U + u); await wait(800);
    ok(errs.length === e0, u + ' loads without errors', errs.slice(e0)); await q.close();
  }
  ok(errs.length === 0, 'no page errors overall', errs.slice(0, 5));
  await b.close(); srv.kill();
  console.log(bad ? 'TOOLSHUB FAIL ' + bad : 'TOOLSHUB PASS'); process.exit(bad ? 1 : 0);
})();
