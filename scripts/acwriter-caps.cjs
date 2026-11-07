// ACWriter item 3: the status line shows CAPS (inverse) when caps lock is on and plain caps when off, in text, page and zoom views.
const L = require('./acwriter-cursor-lib.cjs');
const fs = require('fs');
const ok = (m) => console.log('ok  ' + m);
const bad = (m) => { console.log('FAIL ' + m); process.exitCode = 1; };
(async () => {
  const t = await L.boot({ wait: 14000 });
  const { p, key, type } = t;
  const out = L.ROOT + '/out/shots/caps';
  fs.mkdirSync(out, { recursive: true });
  await key('n', 1500);
  await type('abc', 300);
  const lock = async () => (await t.peek(0x02BE, 1))[0];
  await t.shot(out + '/1-text-on.png');
  if ((await lock()) !== 0) bad('caps lock should be off after start'); else ok('caps lock off at start, SHFLOK 0');
  await key('CapsLock', 1000);
  if ((await lock()) !== 0x40) bad('caps key did not set SHFLOK'); else ok('caps lock on, SHFLOK $40');
  await t.shot(out + '/2-text-off.png');
  await type('xyz', 300);
  await t.shot(out + '/3-typed-lower.png');
  await key('CapsLock', 1000);
  // page view and zoom
  await key('Escape', 700); await key('l', 900); await key('v', 3000);
  console.log('hmode', (await t.peek(0x1330,1))[0]);
  await t.shot(out + '/4-page-on.png');
  await key('Escape', 700); await key('l', 900); await key('z', 3000);
  console.log('hmode', (await t.peek(0x1330,1))[0], 'zoom', (await t.peek(0x14E7,1))[0]);
  await t.shot(out + '/6-zoom-on.png');
  await key('CapsLock', 1500);
  await t.shot(out + '/7-zoom-off.png');
  await key('CapsLock', 1500);
  await key('Escape', 700); await key('l', 900); await key('z', 3000);
  await key('CapsLock', 1500);
  await t.shot(out + '/5-page-off.png');
  console.log('errors', t.errs);
  await t.b.close();
})();
