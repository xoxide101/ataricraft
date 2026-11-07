// ACWriter item 2: the Character menu shows the current font and size in the status line and messages.
const L = require('./acwriter-cursor-lib.cjs');
const fs = require('fs');
(async () => {
  const t = await L.boot({ wait: 14000 });
  const { key, type } = t;
  const out = L.ROOT + '/out/shots/fontmenu';
  fs.mkdirSync(out, { recursive: true });
  await key('n', 1500);
  await type('Hello font', 300);
  await t.shot(out + '/1-status.png');
  await key('Escape', 700); await key('c', 900);
  await t.shot(out + '/2-menu.png');
  await key('l', 1200);
  await t.shot(out + '/3-larger.png');
  await key('Escape', 700); await key('c', 900); await key('o', 1200);
  await t.shot(out + '/4-font-prompt.png');
  await key('Escape', 800);
  await key('c', 900); await key('f', 1500);
  await t.shot(out + '/5-face-prompt.png');
  await key('Escape', 800);
  console.log('errors', t.errs);
  await t.b.close();
})();
