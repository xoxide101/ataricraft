const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const zlib = require('zlib');
(async () => {
  const R = 'C:/Users/raver/ataricraft/';
  const D = R + 'out/media';
  fs.rmSync(D, { recursive: true, force: true });
  fs.mkdirSync(D, { recursive: true });
  const atr = fs.readFileSync(R + 'software_n_roms/Eprom Arc.atr');
  fs.writeFileSync(D + '/t_atr.atr', atr);
  fs.writeFileSync(D + '/t_xfd.xfd', atr.subarray(16));
  fs.writeFileSync(D + '/t_gz.atr.gz', zlib.gzipSync(atr));
  fs.writeFileSync(D + '/t_noext.xex', atr);
  fs.writeFileSync(D + '/t_prog.xex', Buffer.from([0xff, 0xff, 0x00, 0x06, 0x02, 0x06, 0xa9, 0x00, 0x60, 0xe0, 0x02, 0xe1, 0x02, 0x00, 0x06]));
  const rom = Buffer.alloc(8192, 0xff);
  rom[0x1ffc] = 0x00; rom[0x1ffd] = 0xa0; rom[0x1ffa] = 0; rom[0x1ffb] = 0xa0;
  fs.writeFileSync(D + '/t_raw.rom', rom);
  const car = Buffer.concat([Buffer.from('CART'), Buffer.from([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]), rom]);
  fs.writeFileSync(D + '/t_cart.car', car);
  const rec = Buffer.alloc(132);
  rec[0] = 0x55; rec[1] = 0x55; rec[2] = 0xfc; rec[3] = 0; rec[4] = 1; rec[5] = 0; rec[6] = 0x08;
  const chunk = (id, aux, data) => { const h = Buffer.alloc(8); h.write(id, 0); h.writeUInt32LE(data.length, 4); const a = Buffer.alloc(0); return Buffer.concat([h.subarray(0, 4), h.subarray(4, 6), Buffer.from([aux & 255, aux >> 8]), data]); };
  fs.writeFileSync(D + '/t_tape.cas', Buffer.concat([chunk('FUJI', 0, Buffer.alloc(0)), chunk('baud', 600, Buffer.alloc(0)), chunk('data', 1000, rec)]));

  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + R + 'web/index.html');
  await p.setInputFiles('#romfiles', [R + 'software_n_roms/ATARIXL.ROM', R + 'software_n_roms/ATARIBAS.ROM']);
  await p.waitForTimeout(800);
  await p.click('#boot');
  await p.waitForTimeout(2500);
  await p.setInputFiles('#medfolder', D);
  await p.waitForTimeout(500);
  console.log('library:', await p.textContent('#medcount'));
  const log = () => p.evaluate(() => document.getElementById('status').textContent);
  for (const n of ['t_atr.atr', 't_xfd', 't_gz', 't_noext', 't_prog', 't_raw', 't_cart', 't_tape']) {
    await p.fill('#medfilter', n);
    await p.click('#medlist div');
    await p.waitForTimeout(700);
    const d1 = await p.textContent('#d1'), c1 = await p.textContent('#cn1'), tn = await p.textContent('#tn');
    const ct = await p.evaluate(() => document.getElementById('ctyperow').style.display);
    console.log(n.padEnd(10), '| D1:', d1, '| cart:', c1, '| ctype row:', ct, '| tape:', tn, '|', await log());
    if (ct === 'flex') { await p.click('#ctypeok'); }
  }
  console.log('errors', errs);
  await b.close();
})();
