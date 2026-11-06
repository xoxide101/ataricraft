// ACWriter flicker audit: frame-exact (one emulator frame per step) diffs while typing and moving in text mode.
// Per scenario: frames with any change, the largest per-frame change, band changes, and the ink dip of the ruler/status bands
// (a dip = the row was cleared before being redrawn, i.e. visible flicker). Usage: node scripts/acwriter-flicker.cjs [label]
const L = require('./acwriter-cursor-lib.cjs'), F = require('./acwriter-frames-lib.cjs'), path = require('path'), fs = require('fs');
const OX = 8, OY = 24;
const BANDS = [['menu', 0, 8], ['ruler', 8, 16], ['text', 16, 176], ['status', 176, 192]];
const label = process.argv[2] || 'run';
(async () => {
  const t = await L.boot();
  await t.key('n', 1500);
  await t.p.evaluate(() => ataricraft.pause());
  await F.install(t.p);
  const run = async (name, keys, hold = 3, after = 40) => {
    const frames = [];
    for (const k of keys) {
      await t.p.keyboard.down(k); frames.push(...await t.p.evaluate(([h, b, x, y]) => window.__cap(h, b, x, y, window.__last), [hold, BANDS, OX, OY]));
      await t.p.keyboard.up(k); frames.push(...await t.p.evaluate(([h, b, x, y]) => window.__cap(h, b, x, y, window.__last), [after, BANDS, OX, OY]));
    }
    const nz = frames.filter((r) => r.tot);
    const sum = BANDS.map((b, i) => frames.reduce((s, r) => s + r.chg[i], 0));
    const dip = (i) => { const ink = frames.map((r) => r.ink[i]), mx = Math.max(...ink); return mx ? +(Math.min(...ink) / mx).toFixed(2) : 1; };
    const worst = frames.reduce((a, r) => (r.tot > a.tot ? r : a), { tot: 0 });
    const res = { name, frames: frames.length, changedFrames: nz.length, maxPx: worst.tot, bandPx: Object.fromEntries(BANDS.map((b, i) => [b[0], sum[i]])), rulerMinInk: dip(1), statusMinInk: dip(3), textMinInk: dip(2) };
    console.log(JSON.stringify(res));
    return res;
  };
  const out = [];
  await t.p.evaluate(([b, x, y]) => window.__cap(1, b, x, y, window.__grab()), [BANDS, OX, OY]);
  out.push(await run('type 8 letters', ['h', 'e', 'l', 'l', 'o', 'w', 'o', 'r']));
  out.push(await run('arrow left x4', ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft']));
  out.push(await run('arrow right x2', ['ArrowRight', 'ArrowRight']));
  out.push(await run('return', ['Enter']));
  out.push(await run('type 3 on line 2', ['a', 'b', 'c']));
  out.push(await run('arrow up', ['ArrowUp']));
  out.push(await run('arrow down', ['ArrowDown']));
  out.push(await run('backspace x2', ['Backspace', 'Backspace']));
  // pure idle: 150 frames, nothing pressed
  const idle = await t.p.evaluate(([b, x, y]) => window.__cap(150, b, x, y, window.__last), [BANDS, OX, OY]);
  const idleChg = idle.filter((r) => r.tot);
  console.log(JSON.stringify({ name: 'idle 150 frames', changedFrames: idleChg.length, maxPx: Math.max(0, ...idle.map((r) => r.tot)), box: idleChg[0] && idleChg[0].box }));
  fs.mkdirSync(path.join(L.ROOT, 'out', 'shots', 'cursor'), { recursive: true });
  fs.writeFileSync(path.join(L.ROOT, 'out', 'shots', 'cursor', 'flicker-' + label + '.json'), JSON.stringify({ out, idle: { changedFrames: idleChg.length } }, null, 1));
  console.log('errors', t.errs);
  await t.b.close();
})();
