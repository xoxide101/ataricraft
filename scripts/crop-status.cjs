// makes out\shots\<dir>\montage.png from the bottom two text rows of the named shots: node scripts\crop-status.cjs dir name1 name2 ...
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const dir = 'C:/Users/raver/ataricraft/out/shots/' + process.argv[2];
const names = process.argv.slice(3);
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1000, height: 140 * names.length } })).newPage();
  const imgs = names.map((n) => 'data:image/png;base64,' + fs.readFileSync(dir + '/' + n + '.png').toString('base64'));
  await p.setContent('<body style="margin:0;background:#333">' + imgs.map((s, i) => `<div style="width:960px;height:70px;overflow:hidden;margin:0 0 4px 0;position:relative"><img src="${s}" style="position:absolute;left:-615px;top:-420px;width:1400px;image-rendering:pixelated;transform:scale(2);transform-origin:615px 420px"></div>`).join('') + '</body>');
  await p.waitForTimeout(500);
  await p.screenshot({ path: dir + '/montage.png' });
  await b.close();
})();
