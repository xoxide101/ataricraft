const L = require('./acwriter-cursor-lib.cjs');
const fs = require('fs');
(async () => {
  const t = await L.boot({ wait: 17000 });
  const out = 'scripts/map-shots'; fs.mkdirSync(out, { recursive: true });
  const cv = () => t.p.locator('canvas').first();
  await t.key('n', 2500); await t.type('abc', 300);
  await cv().screenshot({ path: out + '/probe-text.png' });
  await t.key('Escape', 800); await t.key('l', 800); await t.key('z', 2500);
  await cv().screenshot({ path: out + '/probe-zoom.png' });
  await t.key('Escape', 800); await t.key('l', 800); await t.key('v', 3000);
  await cv().screenshot({ path: out + '/probe-page.png' });
  const sz = await t.p.evaluate(() => { const c = document.querySelector('canvas'); return [c.width, c.height]; });
  console.log(sz);
  await t.b.close();
})();
