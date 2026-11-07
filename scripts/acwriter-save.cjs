// ACWriter item 1: Save writes a real DOS 2 file on the boot disk, readable by xcwcore, and Open reads it back after a cold start.
const L = require('./acwriter-cursor-lib.cjs');
const fs = require('fs');
const DOS = require('../web/js/dosfs.js');
const X = require('../tools/xcwcore.cjs');
const ok = (m) => console.log('ok  ' + m);
const bad = (m) => { console.log('FAIL ' + m); process.exitCode = 1; };
(async () => {
  const t = await L.boot({ wait: 14000 });
  const { p, key, type } = t;
  const out = L.ROOT + '/out/shots/save';
  fs.mkdirSync(out, { recursive: true });
  await key('n', 1500);
  await type('Saved text one', 300);
  await t.shot(out + '/1-typed.png');
  await key('Escape', 700); await key('f', 700); await key('a', 1500);
  await type('rttest', 300);
  await key('Enter', 4000);
  await t.shot(out + '/2-saved.png');
  const disk = Buffer.from(await p.evaluate(() => Array.from(FujiNet.emu.readDisk(1))));
  const list = DOS.open(new Uint8Array(disk)).list();
  console.log(list.map((e) => e.name + ' ' + e.size).join(', '));
  const e = list.find((x) => /^RTTEST\.XCW$/i.test(x.name));
  if (!e) bad('RTTEST.XCW not on the disk'); else {
    ok('RTTEST.XCW on disk, ' + e.size + ' bytes');
    const data = Buffer.from(DOS.open(new Uint8Array(disk)).read(e));
    fs.writeFileSync(out + '/RTTEST.XCW', data);
    const txt = JSON.stringify(X.openDoc(data));
    if (/Saved text one/i.test(txt)) ok('xcwcore reads the text'); else bad('xcwcore cannot find the text: ' + txt.slice(0, 200));
  }
  await p.click('#cold'); await p.waitForTimeout(25000); await t.shot(out + '/2b-cold.png'); await p.locator('canvas').first().click();
  await key('o', 4000); await t.shot(out + '/2c-open.png');
  await type('rttest', 300);
  await key('Enter', 4000);
  await t.shot(out + '/3-reopened.png');
  console.log('fer/cmsg', await t.peek(0x1412, 1), await t.peek(0xAC, 1));
  console.log('name seen by D:', (await t.peek(0xBFB8, 11)).map((c) => String.fromCharCode(c)).join(''), 'found', await t.peek(0xBFA9, 2));
  console.log('errors', t.errs);
  await t.b.close();
})();
