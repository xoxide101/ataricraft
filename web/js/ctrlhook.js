// Drives emulator ports 1-2 from the active controller profile (ac.ctrl.active in localStorage, managed on controller.html).
// Additive: keyboard handling in app.js/keyboard.js is untouched; profile output is merged through emu.down('ctrl', ...).
// UNVERIFIED with the real Atari Gamestation Gamepad.
(function () {
  const AC = window.AC;
  if (!AC || !AC.CtrlCore || !AC.CtrlInput) return;
  const Core = AC.CtrlCore, store = Core.createStore();
  let rt = null, inp = null, timer = 0, held = new Set(), lastTick = 0, hadFields = false;

  function load() {
    const p = store.getActive();
    rt = p ? Core.createRuntime(p) : null;
    if (inp) inp.swallow = null;
    if (rt && inp) {
      const ids = Core.sourcesOf(p);
      inp.swallow = p.captureKeys ? (id) => ids.has(id) : null;
    }
    release();
    if (rt) start(p); else stop();
  }
  function release() {
    const emu = window.AC_getEmu && window.AC_getEmu();
    if (emu) { held.forEach((k) => emu.up(k)); emu.keys.delete('ctrl'); }
    held = new Set(); hadFields = false;
  }
  function start(p) {
    if (!inp) {
      const screen = document.getElementById('screen');
      inp = AC.CtrlInput.create({ win: window, nav: navigator, doc: document, mouseTarget: window });
      inp.start();
      if (screen) screen.addEventListener('click', () => { const a = store.getActive(); if (a && a.trackball.enabled && a.trackball.lockPointer && !document.pointerLockElement) inp.lockPointer(screen); });
      const ids = Core.sourcesOf(p);
      inp.swallow = p.captureKeys ? (id) => ids.has(id) : null;
    }
    if (!timer) timer = setInterval(tick, 16);
  }
  function stop() { if (timer) clearInterval(timer); timer = 0; }

  function tick() {
    const emu = window.AC_getEmu && window.AC_getEmu();
    if (!rt || !emu || !inp) return;
    const now = performance.now(), dt = lastTick ? now - lastTick : 16; lastTick = now;
    inp.poll();
    const modelEl = document.getElementById('model');
    const out = rt.update(inp.sampler, { model: modelEl ? modelEl.value : '', dtMs: dt });
    inp.endTick();
    const has = Object.keys(out.fields).length > 0;
    if (has) { emu.down('ctrl', out.fields); hadFields = true; } else if (hadFields) { emu.keys.delete('ctrl'); hadFields = false; }
    const now2 = new Set();
    for (const [k, f] of Object.entries(out.keys)) {
      const id = 'ctrl:' + k; now2.add(id);
      if (!held.has(id)) emu.down(id, f);
    }
    held.forEach((id) => { if (!now2.has(id)) emu.up(id); });
    held = now2;
  }

  window.addEventListener('storage', (e) => { if (!e.key || /^ac\.ctrl\./.test(e.key)) load(); });
  window.AC.CtrlHook = { reload: load, status: () => ({ active: rt ? rt.profile.name : null, running: !!timer }) };
  load();
})();
