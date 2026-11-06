// Boots the generated EBookCraft viewer ATR (and XEX) in the emulator and screenshots the result. Needs a local OS ROM (not in git).
// Usage: node scripts/ebookcraft-emu-test.cjs [atr] [xex]   -> out/ebc/emu-atr.png, out/ebc/emu-xex.png
const { chromium } = require(process.env.PLAYWRIGHT || 'C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const R = path.resolve(__dirname, '..') + '/', O = R + 'out/ebc/';
const rom = process.env.OSROM || R + 'software_n_roms/8bit/Atari 8-Bit/Atari 8-bit Archive of Archives/Atari800WinPLus 40/xf25/ATARIXL.ROM';
(async () => {
  const find = (re) => { const d = O + 'cli-test/'; const w = (x) => fs.readdirSync(x, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? w(x + e.name + '/') : [x + e.name]); return w(d).find((f) => re.test(f)); };
  const atr = process.argv[2] || find(/-view\.atr$/), xex = process.argv[3] || find(/\.xex$/);
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto('file:///' + R + 'web/index.html');
  await p.setInputFiles('#romfiles', [rom]); await p.waitForTimeout(800);
  await p.selectOption('#model', '130xe');
  await p.evaluate(() => { document.getElementById('basic').checked = false; });
  const bytes = (f) => [...fs.readFileSync(f)];
  for (const [kind, file] of [['atr', atr], ['xex', xex]]) {
    if (!file || process.env.ONLY && process.env.ONLY !== kind) { console.log('no', kind); continue; }
    await p.click('#boot'); await p.waitForTimeout(1500);
    if (kind === 'atr') { await p.evaluate((a) => { ataricraft.mountDisk(1, 'view.atr', new Uint8Array(a)); ataricraft.reset(true); }, bytes(file)); await p.waitForTimeout(9000); if (process.env.KEY) { await p.evaluate(() => ataricraft.type(' ')); await p.waitForTimeout(4000); } }
    else { await p.evaluate((a) => ataricraft.bootFile('view.xex', new Uint8Array(a)), bytes(file)); await p.waitForTimeout(6000); }
    const url = await p.evaluate(() => ataricraft.screenshot({ scale: 2 }));
    fs.writeFileSync(O + 'emu-' + kind + '.png', Buffer.from(url.split(',')[1], 'base64'));
    console.log(kind, file, 'screenshot saved');
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(2); });
