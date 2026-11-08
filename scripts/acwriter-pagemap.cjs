// Page map box at the bottom right: whole document as a strip, thick bar = part on screen
const L = require('./acwriter-cursor-lib.cjs');
const fs = require('fs');
(async () => {
  const t = await L.boot({ wait: 17000 });
  const out = 'scripts/pagemap-shots'; fs.mkdirSync(out, { recursive: true });
  const cv = () => t.p.locator('canvas').first();
  let fails = 0;
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
  // Returns [first, last] lit inner pixel of the map's thick-bar row, or null
  const bar = async () => {
    const lo = (await t.peek(0x700 + 22))[0], hi = (await t.peek(0x720 + 22))[0];
    const base = lo + hi * 256 + 37 + 40 * 3;
    const b = await t.peek(base, 3);
    const bits = []; for (let i = 0; i < 24; i++) bits.push((b[i >> 3] >> (7 - (i & 7))) & 1);
    const inner = bits.slice(1, 23); const f = inner.indexOf(1), l = inner.lastIndexOf(1);
    return f < 0 ? null : [f, l];
  };
  const vars = async () => (await t.peek(0x93, 5)).join(',');
  const matches = async (r) => { const v = await t.peek(0x95, 2); const T = v[1] + 1; let w = Math.min(22, Math.max(1, Math.floor(20 * 22 / T))); let s = Math.floor(v[0] * 22 / T); if (s + w > 22) s = 22 - w; console.log('want', s, s + w - 1); return r && r[0] === s && r[1] === s + w - 1; };
  await t.key('n', 2500);
  for (let i = 0; i < 150; i++) await t.key('Enter', 110);
  await t.p.waitForTimeout(1500);
  await cv().screenshot({ path: out + '/text-end.png' });
  const e = await bar(); console.log('end', e, await vars());
  ok(await matches(e), 'text: bar matches the view at the end');
  for (let i = 0; i < 25; i++) await t.key('ArrowUp', 90);
  await t.p.waitForTimeout(1500);
  await cv().screenshot({ path: out + '/text-middle.png' });
  const m = await bar(); console.log('middle', m, await vars());
  ok(await matches(m), 'text: bar matches the view in the middle');
  for (let i = 0; i < 300 && (await t.peek(0x95))[0] > 0; i++) await t.key('ArrowUp', 90);
  await t.p.waitForTimeout(1500);
  await cv().screenshot({ path: out + '/text-start.png' });
  const s = await bar(); console.log('start', s, await vars());
  ok(await matches(s) && s[0] === 0, 'text: bar at the start');
  await t.key('Escape', 800); await t.key('l', 800); await t.key('z', 2500);
  await cv().screenshot({ path: out + '/zoom-start.png' });
  const z = await bar(); console.log('zoom', z);
  ok(await matches(z), 'zoom: bar matches the view');
  await t.key('Escape', 800); await t.key('l', 800); await t.key('v', 3000);
  await cv().screenshot({ path: out + '/page.png' });
  ok(t.errs.length === 0, 'no page errors');
  console.log(fails ? 'FAILS ' + fails : 'ALL PASS');
  await t.b.close();
  process.exit(fails ? 1 : 0);
})();
