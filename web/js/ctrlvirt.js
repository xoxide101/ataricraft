// Virtual (on-screen) trackball + button panel runtime for the keyboard area. DOM-free so it runs in Node tests.
// Feeds a controller profile (ctrlcore.js) from synthetic sources, so quadrature, ports and button actions match the real profile path.
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./ctrlcore.js') : root.AC.CtrlCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.AC = root.AC || {}; root.AC.CtrlVirtual = api; }
})(typeof window !== 'undefined' ? window : globalThis, function (Core) {
  // Buttons shown under the ball. fire/fire2 ride the trackball fire line; the rest are console or aux functions.
  const BUTTONS = [
    { id: 'fire', label: 'Fire', cls: 'big' }, { id: 'fire2', label: 'Fire 2', cls: 'big' },
    { id: 'start', label: 'Start' }, { id: 'select', label: 'Select' }, { id: 'option', label: 'Option' }, { id: 'reset', label: 'Reset' },
    { id: 'credit', label: 'Coin' }, { id: 'pause', label: 'Pause' },
    { id: 'aux1', label: 'Aux 1', action: 'option' }, { id: 'aux2', label: 'Aux 2', action: 'break' }, { id: 'aux3', label: 'Aux 3', action: 'help' }, { id: 'aux4', label: 'Aux 4', action: 'select' },
  ];
  const PROTOCOLS = [['trak', 'Atari CX22 / CX80 trak-ball'], ['st', 'Atari ST mouse'], ['amiga', 'Amiga mouse']];
  const src = (id) => 'kb:Virt' + id;

  function profile(opts) {
    opts = opts || {};
    const p = Core.fromPreset('trackball', 'On-screen trackball');
    Object.assign(p.trackball, {
      port: opts.port === 1 ? 1 : 2, protocol: PROTOCOLS.some((x) => x[0] === opts.protocol) ? opts.protocol : 'trak',
      sensitivity: typeof opts.sensitivity === 'number' ? opts.sensitivity : 0.7, invertX: !!opts.invertX, invertY: !!opts.invertY, lockPointer: false,
      x: ['ms:dx'], y: ['ms:dy'], fire: [src('fire'), src('fire2')],
    });
    BUTTONS.forEach((b, i) => {
      if (b.id === 'fire' || b.id === 'fire2') return;
      if (b.action) p.aux[i - 8] = { source: [src(b.id)], action: b.action };
      else p.console[b.id] = [src(b.id)];
    });
    return Core.sanitize(p);
  }

  function create(opts) {
    let rt = Core.createRuntime(profile(opts)), dx = 0, dy = 0;
    const held = new Set();
    const sampler = { level: (id) => (id.startsWith('kb:Virt') && held.has(id.slice(7)) ? 1 : 0), delta: (id) => (id === 'ms:dx' ? dx : id === 'ms:dy' ? dy : 0) };
    return {
      configure(o) { rt = Core.createRuntime(profile(o)); },
      move(x, y) { dx += x; dy += y; },
      press(id, on) { if (on) held.add(id); else held.delete(id); },
      isDown: (id) => held.has(id),
      // One emulator tick: returns { fields, keys } and consumes the accumulated ball motion.
      tick(ctx) { const o = rt.update(sampler, ctx || {}); dx = dy = 0; return o; },
      release() { held.clear(); dx = dy = 0; },
    };
  }
  return { BUTTONS, PROTOCOLS, profile, create };
});
