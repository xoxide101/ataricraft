const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const R = 'C:/Users/raver/ataricraft/';
const CORE = process.env.CORE || 'atari800';
const IMG = process.env.IMG || R + 'web/library/craftapps/DOS images/d25.atr';
const MODEL = process.env.MODEL || '130xe';
const tmp = R + 'out/_pd.atr';
fs.copyFileSync(IMG, tmp);
const has = (arr) => {
  const pat = [0x54, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x42, 0x41, 0x53];
  for (let i = 0; i < arr.length - 11; i++) { let ok = true; for (let j = 0; j < 11; j++) if (arr[i + j] !== pat[j]) { ok = false; break; } if (ok) return true; }
  return false;
};
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const ctx = await b.newContext({ viewport: { width: 1366, height: 1000 } });
  let p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  const setup = async () => {
    await p.goto('file:///' + R + 'web/index.html');
    await p.setInputFiles('#romfiles', [R + 'software_n_roms/8bit/Bios/ATARIXL.ROM', R + 'software_n_roms/8bit/Bios/ATARIBAS.ROM']);
    await p.waitForTimeout(800);
    await p.selectOption('#core', CORE).catch(() => {});
    await p.selectOption('#model', MODEL);
  };
  await setup();
  await p.evaluate(() => { document.getElementById('basic').checked = true; });
  await p.click('#boot'); await p.waitForTimeout(1500);
  await p.setInputFiles('#f1', tmp); await p.waitForTimeout(1000);
  await p.evaluate(() => ataricraft.reset(true)); await p.waitForTimeout(8000);
  await p.evaluate(() => ataricraft.speed(4));
  for (const l of ['NEW', '10 PRINT "HI"', 'SAVE "D:T.BAS"']) {
    await p.evaluate((x) => ataricraft.type(x + '\n'), l);
    while (!(await p.evaluate(() => ataricraft.typing() === 0))) await p.waitForTimeout(300);
    await p.waitForTimeout(2500);
  }
  await p.waitForTimeout(4000);
  console.log('state', JSON.stringify(await p.evaluate(() => ataricraft.diskState()))); const r1 = await p.evaluate(() => Array.from(ataricraft.readDisk(1)));
  console.log(CORE, MODEL, 'live disk has T.BAS:', has(r1));
  const lm = async () => p.evaluate(() => new Promise((res) => { const q = indexedDB.open('ataricraft-media', 1); q.onsuccess = () => { const g = q.result.transaction('kv').objectStore('kv').get('lastmedia'); g.onsuccess = () => { const d = g.result && g.result.disks && g.result.disks[1]; res(d ? { rev: d.rev, hasOrig: !!d.orig, bas: Array.from(d.bytes) } : null); }; }; }));
  await p.waitForTimeout(2500); const m1 = await lm();
  console.log('stored in browser: rev', m1 && m1.rev, 'orig kept', m1 && m1.hasOrig, 'T.BAS', m1 && has(m1.bas));
  // reboot (shift-click) must keep the edit
  await p.click('#boot', { modifiers: ['Shift'] }); await p.waitForTimeout(2500);
  const r2 = await p.evaluate(() => Array.from(ataricraft.readDisk(1)));
  console.log('after reboot has T.BAS:', has(r2));
  // reload the page: edit restored
  p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  await setup(); await p.click('#boot'); await p.waitForTimeout(2500);
  const r3 = await p.evaluate(() => Array.from(ataricraft.readDisk(1) || []));
  console.log('after page reload has T.BAS:', has(r3));
  // revert, then backup list
  await p.click('#sidetabs [data-t=drv]'); await p.evaluate(() => { document.getElementById('bkbox').open = true; }); await p.selectOption('#bkdrv', '1'); await p.click('#bkrev'); await p.waitForTimeout(1500);
  const r4 = await p.evaluate(() => Array.from(ataricraft.readDisk(1) || []));
  console.log('after revert has T.BAS (expect false):', has(r4), 'backups:', await p.$$eval('#bklist option', (o) => o.map((x) => x.textContent)));
  await p.selectOption('#bklist', { index: 0 }); await p.click('#bkrest'); await p.waitForTimeout(2500);
  const r5 = await p.evaluate(() => Array.from(ataricraft.readDisk(1) || []));
  console.log('after restore has T.BAS (expect true):', has(r5));
  await p.evaluate(() => document.getElementById('de1').click()); await p.waitForTimeout(2500);
  console.log('backups after eject:', await p.$$eval('#bklist option', (o) => o.length));
  console.log('errors', errs);
  await b.close();
  fs.unlinkSync(tmp);
})();
