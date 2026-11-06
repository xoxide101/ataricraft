// ACWriter text-mode cursor: it must be visible when idle, blink only inside its own cell, and sit at the right column.
const L = require('./acwriter-cursor-lib.cjs'), path = require('path'), fs = require('fs');
const OUT = path.join(L.ROOT, 'out', 'shots', 'cursor'); fs.mkdirSync(OUT, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

// grab ~1.6 s of idle frames; return the on and off frames and the bbox of what differs between them
async function blink(t) {
  const f = []; for (let i = 0; i < 28; i++) { f.push(await t.grab()); await t.p.waitForTimeout(60); }
  let a = f[0], b = null;
  for (const g of f) if (L.diff(a, g).length) { b = g; break; }
  if (!b) return { n: 0, f };
  const bb = L.bbox(a, b);
  // every frame must equal one of the two states (no third state = no redraw flash)
  let other = 0; for (const g of f) if (L.diff(g, a).length && L.diff(g, b).length) other++;
  return { ...bb, other, a, b, f };
}
(async () => {
  const t = await L.boot();
  await t.key('n', 1500);
  let r = await blink(t);
  ok(r.n > 0 && r.n <= 5 * 8, 'empty document blinks a cell (' + r.n + ' px)');
  if (r.n) ok(r.x0 === 8 && r.y0 === 40 && r.x1 === 12, 'empty doc cursor at col 0: ' + JSON.stringify({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }));
  await t.type('Hello world', 100);
  await t.p.waitForTimeout(1500);
  r = await blink(t);
  ok(r.n > 0 && r.n <= 40 && r.other === 0, 'end of line: only the cursor cell changes (' + r.n + ' px, other states ' + r.other + ')');
  if (r.n) ok(r.x0 === 8 + 11 * 5, 'end-of-line column 11 at x ' + r.x0);
  await t.key('ArrowLeft'); await t.key('ArrowLeft'); await t.key('ArrowLeft');
  await t.p.waitForTimeout(300);
  r = await blink(t);
  ok(r.n > 0 && r.n <= 40 && r.other === 0, 'mid-line cursor blinks only its cell (' + r.n + ' px)');
  if (r.n) ok(r.x0 === 8 + 8 * 5, 'mid-line column 8 at x ' + r.x0);
  // visibility right after a key: capture the very next frames, the block must be on
  await t.key('ArrowLeft', 30);
  const g = await t.grab(); await t.p.waitForTimeout(150); const g2 = await t.grab();
  let tx = 0; for (let y = 40; y < 200; y++) for (let x = 0; x < g.w; x++) if (g.a[y * g.w + x] !== g2.a[y * g.w + x]) tx++;
  ok(tx === 0, 'cursor is on right after a key (no blink-off within 0.2 s; text area, ' + tx + ' px)');
  await t.shot(path.join(OUT, 'after-cursor-mid.png'));
  // idle on/off pixels in the cell around the cursor
  await t.p.locator('canvas').first().screenshot({ path: path.join(OUT, 'after-canvas.png') });
  console.log('errors', t.errs);
  await t.b.close();
  process.exit(fails ? 1 : 0);
})();


