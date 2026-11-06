const L = require('./acwriter-cursor-lib.cjs');
(async () => {
  const t = await L.boot();
  await t.p.waitForTimeout(1500);
  await t.p.screenshot({ path: L.ROOT + '/out/shots/cursor/ver-start.png', clip: { x: 610, y: 130, width: 495, height: 330 } });
  await t.key('h', 1200);
  await t.p.screenshot({ path: L.ROOT + '/out/shots/cursor/ver-help.png', clip: { x: 610, y: 130, width: 495, height: 330 } });
  await t.b.close();
})();
