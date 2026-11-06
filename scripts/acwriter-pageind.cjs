// ACWriter page indicator: status bottom-right "Pg n/m Lnn" must change when typing crosses a page boundary (text mode).
const L = require('./acwriter-cursor-lib.cjs');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
(async () => {
  const t = await L.boot();
  await t.key('n', 1500);
  const hashRight = async () => {
    await t.p.waitForTimeout(900);
    const g = await t.grab(); let h = 0;
    for (let y = 176; y < 192; y++) for (let x = 246; x < 320; x++) h = (h * 31 + (g.a[(y + 24) * g.w + x + 8] ? 1 : 0) + 7) >>> 0;
    return h;
  };
  const h0 = await hashRight();
  for (let i = 0; i < 45; i++) await t.p.keyboard.press('Enter', { delay: 70 }), await t.p.waitForTimeout(120);
  const h1 = await hashRight();
  await t.p.screenshot({ path: L.ROOT + '/out/shots/cursor/pg-line53.png' });
  for (let i = 0; i < 45; i++) await t.p.keyboard.press('Enter', { delay: 70 }), await t.p.waitForTimeout(120);
  const h2 = await hashRight();
  await t.p.screenshot({ path: L.ROOT + '/out/shots/cursor/pg-line56.png' });
  ok(h0 !== h1, 'indicator changes with line (1 -> 53)');
  ok(h1 !== h2, 'indicator changes across the page boundary (line 53 -> 56)');
  await t.p.keyboard.press('ArrowUp', { delay: 70 }), await t.p.waitForTimeout(150); await t.p.keyboard.press('ArrowUp', { delay: 70 }), await t.p.waitForTimeout(150); await t.p.keyboard.press('ArrowUp', { delay: 70 }), await t.p.waitForTimeout(150);
  const h3 = await hashRight();
  ok(h3 !== h2, 'moving up changes the indicator again');
  console.log(bad ? 'FAILED' : 'PASS', 'errors', t.errs);
  await t.b.close();
  process.exit(bad ? 1 : 0);
})();
