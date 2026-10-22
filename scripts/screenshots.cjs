const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
(async () => {
  const R = 'C:/Users/raver/ataricraft/';
  const O = R + 'docs/screenshots/';
  require('fs').mkdirSync(O, { recursive: true });
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const boot = async (w, h) => {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    p.on('pageerror', (e) => console.log('ERR', e.message));
    await p.goto('file:///' + R + 'web/index.html');
    await p.setInputFiles('#romfiles', [R + 'software_n_roms/ATARIXL.ROM', R + 'software_n_roms/ATARIBAS.ROM']);
    await p.waitForTimeout(800);
    await p.click('#boot');
    await p.waitForTimeout(2500);
    return p;
  };
  let p = await boot(1366, 900);
  await p.evaluate(() => ataricraft.type('10 FOR I=1 TO 12\n20 PRINT "HELLO FROM ATARICRAFT ";I\n30 NEXT I\nRUN\n'));
  await p.waitForTimeout(30000);
  await p.screenshot({ path: O + '01-desktop-basic.png' });
  await p.close();

  p = await boot(1366, 900);
  await p.setInputFiles('#medfolder', R + 'software_n_roms');
  await p.waitForTimeout(1500);
  await p.fill('#medfilter', 'sparta');
  await p.evaluate(() => document.getElementById('medlist').scrollIntoView({ block: 'center' }));
  await p.click('#medlist div >> nth=1');
  await p.waitForTimeout(9000);
  await p.screenshot({ path: O + '02-spartados-x.png' });
  await p.close();

  p = await boot(412, 892);
  await p.screenshot({ path: O + '03-phone.png' });
  await p.close();

  p = await boot(1366, 900);
  await p.click('#kbview button[data-v=base]');
  await p.waitForTimeout(500);
  await p.screenshot({ path: O + '04-keyboard-caps-special.png', clip: { x: 320, y: 620, width: 1040, height: 280 } });
  await b.close();
})();
