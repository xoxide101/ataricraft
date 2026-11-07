// ACWriter item 5: Document > Color must colour the typing area, not the status line, in text, page and zoom views.
const L = require('./acwriter-cursor-lib.cjs');
const fs = require('fs');
const out = 'scripts/color-shots';
fs.mkdirSync(out, { recursive: true });
let fails = 0;
const check = (m, c, x) => { console.log((c ? 'ok   ' : 'FAIL ') + m + (c ? '' : ' ' + JSON.stringify(x))); if (!c) fails++; };
(async () => {
  const t = await L.boot({ wait: 17000 });
  const { p, key } = t;
  // average colour of a band of the emulator canvas, y as a fraction of the height
  const band = (y0, y1) => p.evaluate(([a, b]) => {
    const c = document.querySelector('canvas'), d = c.getContext('2d').getImageData(Math.floor(c.width * 0.3), Math.floor(c.height * a), Math.floor(c.width * 0.4), Math.max(1, Math.floor(c.height * (b - a)))).data;
    let r = 0, g = 0, bl = 0, n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; }
    return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)];
  }, [y0, y1]);
  const isBlue = (c) => c[2] > c[0] + 40;
  const modes = [['text', null], ['page', 'v'], ['zoom', 'z']];
  await key('n', 2500);
  await t.type('hello colour', 300);
  await key('Escape', 800); await key('d', 800); await key('c', 1500);
  for (const [name, k] of modes) {
    if (k) { await key('Escape', 800); await key('l', 800); await key(k, 2500); }
    const area = await band(0.3, 0.7), bar = await band(0.955, 0.985);
    await t.shot(out + '/' + name + '-blue.png');
    check(name + ': typing area is blue ' + area, isBlue(area), area);
    check(name + ': status line is not blue ' + bar, !isBlue(bar), bar);
  }
  console.log('fails:', fails, 'errors:', t.errs);
  await t.b.close();
  process.exit(fails ? 1 : 0);
})();
