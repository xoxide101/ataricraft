// Controller profiles: model, presets, storage, JSON import/export and the runtime that turns input into emulator fields.
// Device-agnostic and DOM-free (runs in Node for tests). Nothing here has been verified against the real Atari Gamestation Gamepad.
//
// Source ids (what a binding points at):
//   gp:b<N>            Gamepad API button N            gp:a<N>  axis N (-1..1)      gp:a<N>+ / gp:a<N>-  half axis as a button
//   kb:<code>          KeyboardEvent.code              ms:b<N>  mouse button N
//   ms:dx ms:dy ms:wheel   relative mouse motion / wheel notches (deltas)
//   hid:r<R>:b<B>:m<hex>   WebHID report R, byte B, bit mask      hid:r<R>:b<B>:u8 / :s8   byte as unsigned / signed level
//   hid:r<R>:b<B>:d8       byte as a signed per-report delta (relative encoder)
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.AC = root.AC || {}; root.AC.CtrlCore = api; }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const FORMAT = 'ataricraft-controller-profile', VERSION = 1;
  const SRC_RE = /^(gp:(b\d{1,2}|a\d{1,2}[+-]?)|kb:[A-Za-z0-9]{1,24}|ms:(b\d|dx|dy|wheel)|hid:r\d{1,3}:b\d{1,3}:(m[0-9a-f]{2}|u8|s8|d8))$/;
  const KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
  const KP5200 = { 1: 0x3f, 2: 0x3d, 3: 0x3b, 4: 0x37, 5: 0x35, 6: 0x33, 7: 0x2f, 8: 0x2d, 9: 0x2b, '*': 0x27, 0: 0x25, '#': 0x23, start: 0x39, pause: 0x31, reset: 0x29 };
  // Same tables as the Pad tab in app.js (guarded by scripts/controller-test.cjs).
  const QTAB = { st: [0, 2, 3, 1, 8, 10, 11, 9, 12, 14, 15, 13, 4, 6, 7, 5], amiga: [0, 2, 10, 8, 1, 3, 11, 9, 5, 7, 15, 13, 4, 6, 14, 12] };
  const GRAY = [0, 1, 3, 2];
  const AUX_SLOTS = 8;
  // Emulator functions an aux button can trigger. credit = coin: acts as SELECT on computers and START on the 5200 (no emulated coin slot).
  const AUX_ACTIONS = ['none', 'fire', 'fire2', 'start', 'select', 'option', 'reset', 'break', 'help', 'pause', 'credit'];
  const DELTA_SCALE = { 'ms:wheel': 12 };
  const POT_MAX = 227; // emulator POT range (0..227), as used by the existing paddle code; pot255 in debug output is the 0..255 view

  // Physical controls of the Atari Gamestation Gamepad (names from the product listing); the diagnostic page records a source for each.
  const PHYS = [
    ['DPAD_UP', 'D-pad up', 'digital'], ['DPAD_DOWN', 'D-pad down', 'digital'], ['DPAD_LEFT', 'D-pad left', 'digital'], ['DPAD_RIGHT', 'D-pad right', 'digital'],
    ['A', 'A', 'digital'], ['B', 'B', 'digital'], ['X', 'X', 'digital'], ['Y', 'Y', 'digital'],
    ['L1', 'L1', 'digital'], ['L2', 'L2', 'digital'], ['R1', 'R1', 'digital'], ['R2', 'R2', 'digital'],
    ['START', 'START', 'digital'], ['SELECT', 'SELECT', 'digital'], ['CREDIT', 'CREDIT', 'digital'], ['SETTINGS', 'SETTINGS', 'digital'], ['MENU', 'MENU', 'digital'],
    ...['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => ['K' + k, 'Keypad ' + k, 'digital']), ['KSTAR', 'Keypad *', 'digital'], ['KHASH', 'Keypad #', 'digital'],
    ['TRACKBALL_X', 'Trackball X', 'analog'], ['TRACKBALL_Y', 'Trackball Y', 'analog'], ['SPINNER', 'Paddle / spinner (rotary)', 'analog'],
  ];

  const isDelta = (id) => id === 'ms:dx' || id === 'ms:dy' || id === 'ms:wheel' || /:d8$/.test(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const num = (v, d, a, b) => (typeof v === 'number' && isFinite(v) ? clamp(v, a, b) : d);
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  const srcs = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && SRC_RE.test(s)).slice(0, 8) : []);
  const port = (v, d) => (v === 1 || v === 2 ? v : d);
  const oneOf = (v, list, d) => (list.includes(v) ? v : d);

  function blank(name) {
    const keys = {}; KEYPAD_KEYS.forEach((k) => { keys[k] = []; });
    return {
      format: FORMAT, version: VERSION, id: '', name: name || 'New profile', notes: '', preset: '', untestedOnHardware: true, captureKeys: false,
      device: { name: '', vendorId: null, productId: null, mapping: '', controls: {} },
      joystick: { enabled: false, port: 1, up: [], down: [], left: [], right: [], fire: [], fire2: [] },
      // axis: absolute position -> POT. encoder: relative deltas accumulate into a clamped POT (optional auto-recentre).
      paddle: { enabled: false, port: 1, mode: 'axis', source: [], left: [], right: [], button: [], sensitivity: 1, invert: false, deadzone: 0.05, step: 0.004, recentreMs: 0 },
      // Free-spinning 360 degree dial: relative counts become a 16-step-per-turn quadrature (driving controller code) on the port's up/down lines.
      spinner: { enabled: false, port: 1, source: [], fire: [], sensitivity: 1, invert: false },
      trackball: { enabled: false, port: 2, protocol: 'trak', x: [], y: [], fire: [], sensitivity: 0.7, invertX: false, invertY: false, swapXY: false, lockPointer: true },
      keypad: { enabled: false, target: 'auto', keys },
      console: { enabled: true, start: [], select: [], option: [], reset: [], pause: [], credit: [] },
      // Thumb/aux buttons (X/Y/L1/L2/R1/R2...), each bound to an emulator function from AUX_ACTIONS.
      aux: Array.from({ length: AUX_SLOTS }, () => ({ source: [], action: 'none' })),
    };
  }

  // Coerce anything (imported JSON, old versions) into a valid profile; unknown keys are dropped.
  function sanitize(p) {
    const d = blank(), o = p && typeof p === 'object' ? p : {}, g = (k) => (o[k] && typeof o[k] === 'object' ? o[k] : {});
    const r = blank(String(o.name || d.name).slice(0, 80));
    r.id = /^[a-z0-9-]{1,48}$/.test(o.id || '') ? o.id : '';
    r.notes = String(o.notes || '').slice(0, 2000); r.preset = String(o.preset || '').slice(0, 40);
    r.untestedOnHardware = o.untestedOnHardware !== false; r.captureKeys = bool(o.captureKeys, false);
    const dv = g('device');
    r.device = { name: String(dv.name || '').slice(0, 120), vendorId: Number.isInteger(dv.vendorId) ? clamp(dv.vendorId, 0, 65535) : null, productId: Number.isInteger(dv.productId) ? clamp(dv.productId, 0, 65535) : null, mapping: dv.mapping === 'standard' ? 'standard' : '', controls: {} };
    const dc = dv.controls && typeof dv.controls === 'object' ? dv.controls : {};
    PHYS.forEach(([k]) => { const s = srcs(dc[k]); if (s.length) r.device.controls[k] = s; });
    const j = g('joystick'), jd = d.joystick;
    r.joystick = { enabled: bool(j.enabled, false), port: port(j.port, jd.port) };
    ['up', 'down', 'left', 'right', 'fire', 'fire2'].forEach((k) => { r.joystick[k] = srcs(j[k]); });
    const pd = g('paddle');
    r.paddle = { enabled: bool(pd.enabled, false), port: port(pd.port, 1), mode: oneOf(pd.mode, ['axis', 'encoder'], 'axis'), source: srcs(pd.source), left: srcs(pd.left), right: srcs(pd.right), button: srcs(pd.button),
      sensitivity: num(pd.sensitivity, 1, 0.05, 20), invert: bool(pd.invert, false), deadzone: num(pd.deadzone, 0.05, 0, 0.9), step: num(pd.step, 0.004, 0.0001, 0.1), recentreMs: num(pd.recentreMs, 0, 0, 60000) };
    const sp = g('spinner');
    r.spinner = { enabled: bool(sp.enabled, false), port: port(sp.port, 1), source: srcs(sp.source), fire: srcs(sp.fire), sensitivity: num(sp.sensitivity, 1, 0.05, 20), invert: bool(sp.invert, false) };
    const t = g('trackball');
    r.trackball = { enabled: bool(t.enabled, false), port: port(t.port, 2), protocol: oneOf(t.protocol, ['trak', 'st', 'amiga'], 'trak'), x: srcs(t.x), y: srcs(t.y), fire: srcs(t.fire),
      sensitivity: num(t.sensitivity, 0.7, 0.05, 20), invertX: bool(t.invertX, false), invertY: bool(t.invertY, false), swapXY: bool(t.swapXY, false), lockPointer: bool(t.lockPointer, true) };
    const k = g('keypad'), kk = k.keys && typeof k.keys === 'object' ? k.keys : {};
    r.keypad = { enabled: bool(k.enabled, false), target: oneOf(k.target, ['auto', '5200', 'computer'], 'auto'), keys: {} };
    KEYPAD_KEYS.forEach((x) => { r.keypad.keys[x] = srcs(kk[x]); });
    const c = g('console');
    r.console = { enabled: bool(c.enabled, true) };
    ['start', 'select', 'option', 'reset', 'pause', 'credit'].forEach((x) => { r.console[x] = srcs(c[x]); });
    const ax = Array.isArray(o.aux) ? o.aux : [];
    r.aux = r.aux.map((_, i) => { const a = ax[i] && typeof ax[i] === 'object' ? ax[i] : {}; return { source: srcs(a.source), action: oneOf(a.action, AUX_ACTIONS, 'none') }; });
    return r;
  }

  // Human-readable problems with a profile (never throws).
  function validate(p) {
    const w = [];
    if (p.joystick.enabled && p.trackball.enabled && p.joystick.port === p.trackball.port) w.push('Joystick and trackball use the same port: the trackball quadrature would overwrite the stick lines.');
    if (p.joystick.enabled && p.spinner.enabled && p.joystick.port === p.spinner.port) w.push('Joystick and spinner use the same port: the spinner drives the up/down lines.');
    if (p.trackball.enabled && p.spinner.enabled && p.trackball.port === p.spinner.port) w.push('Trackball and spinner use the same port.');
    if (p.paddle.enabled && p.spinner.enabled && p.paddle.port === p.spinner.port) w.push('Paddle and spinner use the same rotary control on the same port; enable only one.');
    if (p.aux.some((a) => a.source.length && a.action === 'none')) w.push('An aux button has a source but no action.');
    if (p.paddle.enabled && !p.paddle.source.length && !p.paddle.left.length) w.push('Paddle has no source bound.');
    if (p.trackball.enabled && !p.trackball.x.length && !p.trackball.y.length) w.push('Trackball has no X/Y source bound.');
    if (p.spinner.enabled && !p.spinner.source.length) w.push('Spinner has no source bound.');
    return w;
  }

  const B = (n) => 'gp:b' + n;
  const PRESETS = {
    'atari-joystick': { label: 'Atari joystick (d-pad + fire)', apply(p) {
      Object.assign(p.joystick, { enabled: true, port: 1, up: [B(12)], down: [B(13)], left: [B(14)], right: [B(15)], fire: [B(0)], fire2: [B(1)] });
      Object.assign(p.console, { start: [B(9)], select: [B(8)], option: [B(2)] });
    } },
    'paddle-axis': { label: 'Paddle: absolute axis to POT', apply(p) { Object.assign(p.paddle, { enabled: true, port: 1, mode: 'axis', source: ['gp:a0'], button: [B(0)] }); } },
    'paddle-encoder': { label: 'Paddle: relative encoder to clamped POT', apply(p) { Object.assign(p.paddle, { enabled: true, port: 1, mode: 'encoder', source: ['ms:wheel'], button: [B(0), 'ms:b0'], recentreMs: 0 }); } },
    'spinner': { label: 'Driving controller / spinner: 360 degree relative to Gray-code quadrature', apply(p) { Object.assign(p.spinner, { enabled: true, port: 1, source: ['ms:wheel'], fire: [B(0), B(1), B(2), B(3), 'ms:b0'] }); } },
    'driving-port2': { label: 'Driving controller on port 2 (second controller)', apply(p) { PRESETS['spinner'].apply(p); p.spinner.port = 2; } },
    'trackball': { label: 'Trackball: mouse delta to Atari trak-ball quadrature', apply(p) { Object.assign(p.trackball, { enabled: true, port: 2, protocol: 'trak', x: ['ms:dx'], y: ['ms:dy'], fire: ['ms:b0', B(0)] }); } },
    'trackball-st': { label: 'Trackball: mouse delta to Atari ST mouse quadrature', apply(p) { Object.assign(p.trackball, { enabled: true, port: 2, protocol: 'st', x: ['ms:dx'], y: ['ms:dy'], fire: ['ms:b0', B(0)] }); } },
    'keypad-5200': { label: '5200 keypad 0-9 * # (numpad)', apply(p) {
      p.keypad.enabled = true; p.keypad.target = 'auto'; p.captureKeys = true;
      for (let i = 0; i <= 9; i++) p.keypad.keys[String(i)] = ['kb:Numpad' + i];
      p.keypad.keys['*'] = ['kb:NumpadMultiply']; p.keypad.keys['#'] = ['kb:NumpadDivide'];
      Object.assign(p.console, { start: ['kb:NumpadAdd'], pause: ['kb:NumpadSubtract'] });
    } },
    'keypad-5200-full': { label: 'Atari 5200 controller: keypad 0-9 * #, Start, Pause, Reset, two fire buttons', apply(p) {
      PRESETS['keypad-5200'].apply(p); p.keypad.target = '5200';
      Object.assign(p.joystick, { enabled: true, port: 1, up: [B(12)], down: [B(13)], left: [B(14)], right: [B(15)], fire: [B(0)], fire2: [B(1)] });
      Object.assign(p.console, { start: [B(9), 'kb:NumpadAdd'], pause: [B(8), 'kb:NumpadSubtract'], reset: [B(3), 'kb:NumpadDecimal'] });
    } },
    // Jaguar: A/B/C, Pause, Option and the 12-key keypad. There is no Jaguar core in Ataricraft, so these are generic bindings (C is an aux button) useful for exports.
    'jaguar': { label: 'Atari Jaguar pad: A/B/C, Pause, Option, keypad 0-9 * #', apply(p) {
      PRESETS['keypad-5200'].apply(p); p.keypad.target = 'computer';
      Object.assign(p.joystick, { enabled: true, port: 1, up: [B(12)], down: [B(13)], left: [B(14)], right: [B(15)], fire: [B(0)], fire2: [B(1)] });
      Object.assign(p.console, { start: [], pause: [B(9), 'kb:NumpadSubtract'], option: [B(8), 'kb:NumpadAdd'] });
      p.aux[0] = { source: [B(2)], action: 'select' };
    } },
    'coin-aux': { label: 'Coin/credit + thumb/aux buttons (X/Y/L1/R1/L2/R2)', apply(p) {
      Object.assign(p.console, { enabled: true, credit: [B(16)], start: [B(9)], select: [B(8)] });
      [[2, 'option'], [3, 'break'], [4, 'pause'], [5, 'help'], [6, 'select'], [7, 'start']].forEach(([n, a], i) => { p.aux[i] = { source: [B(n)], action: a }; });
    } },
    'console-switches': { label: 'Console switches START / SELECT / OPTION / RESET', apply(p) { Object.assign(p.console, { enabled: true, start: [B(9)], select: [B(8)], option: [B(2)], reset: [B(3)], pause: [B(16)] }); } },
    // Template only: real sources come from the device map recorded on the Controller page.
    'gamestation': { label: 'Atari Gamestation Gamepad (template, record controls first)', apply(p) {
      PRESETS['atari-joystick'].apply(p); PRESETS['trackball'].apply(p); PRESETS['keypad-5200'].apply(p); PRESETS['coin-aux'].apply(p);
      p.captureKeys = false; p.device.name = 'Atari Gamestation Gamepad (DGUNL-7152)';
    } },
  };

  function fromPreset(key, name) {
    const p = blank(name || (PRESETS[key] ? PRESETS[key].label : 'New profile'));
    if (PRESETS[key]) { PRESETS[key].apply(p); p.preset = key; }
    return p;
  }

  // Fill the Atari bindings from the recorded physical controls (only for controls that were recorded).
  function applyDeviceMap(p) {
    const c = p.device.controls, has = (k) => c[k] && c[k].length, cp = (k) => (c[k] || []).slice();
    if (['DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'A'].some(has)) {
      p.joystick.enabled = true;
      [['up', 'DPAD_UP'], ['down', 'DPAD_DOWN'], ['left', 'DPAD_LEFT'], ['right', 'DPAD_RIGHT'], ['fire', 'A'], ['fire2', 'B']].forEach(([a, k]) => { if (has(k)) p.joystick[a] = cp(k); });
    }
    [['start', 'START'], ['select', 'SELECT'], ['option', 'MENU'], ['reset', 'SETTINGS'], ['credit', 'CREDIT']].forEach(([a, k]) => { if (has(k)) p.console[a] = cp(k); });
    // Thumb/aux defaults: X option, Y break, L1 pause, R1 help, L2 select, R2 start (editable in the profile)
    ['X:option', 'Y:break', 'L1:pause', 'R1:help', 'L2:select', 'R2:start'].forEach((x, i) => { const [k, act] = x.split(':'); if (has(k)) p.aux[i] = { source: cp(k), action: act }; });
    if (has('TRACKBALL_X') || has('TRACKBALL_Y')) {
      p.trackball.enabled = true; if (has('TRACKBALL_X')) p.trackball.x = cp('TRACKBALL_X'); if (has('TRACKBALL_Y')) p.trackball.y = cp('TRACKBALL_Y');
      if (has('A')) p.trackball.fire = cp('A');
    }
    if (has('SPINNER')) { p.spinner.source = cp('SPINNER'); p.paddle.source = cp('SPINNER'); if (has('A')) { p.paddle.button = cp('A'); p.spinner.fire = cp('A'); } }
    const kp = [...'0123456789'].map((n) => [n, 'K' + n]).concat([['*', 'KSTAR'], ['#', 'KHASH']]);
    if (kp.some(([, k]) => has(k))) { p.keypad.enabled = true; kp.forEach(([a, k]) => { if (has(k)) p.keypad.keys[a] = cp(k); }); }
    return p;
  }

  // ---- runtime ----
  // sampler: { level(id) -> number, delta(id) -> number accumulated since the last tick }
  const lvl = (s, id) => s.level(id) || 0;
  function down(s, id) {
    if (isDelta(id)) return false;
    const m = /^gp:a(\d+)([+-])$/.exec(id);
    if (m) { const v = lvl(s, 'gp:a' + m[1]); return m[2] === '+' ? v > 0.5 : v < -0.5; }
    return lvl(s, id) > 0.5;
  }
  const anyDown = (s, ids) => ids.some((i) => down(s, i));
  // Sum of relative counts from a source list; level sources (stick-like axes) count as a velocity.
  function counts(s, ids, vel) {
    let c = 0;
    for (const id of ids) c += isDelta(id) ? (s.delta(id) || 0) * (DELTA_SCALE[id] || 1) : (/^gp:a/.test(id) ? lvl(s, id) * vel : 0);
    return c;
  }

  // ---- adapters: canonical profile + sampler -> per-system output. Register more (2600, 7800, Lynx, ST...) without touching the device layer. ----
  // An adapter is a factory (profile) => ({ update(sampler, ctx) -> any, ...optional }). Built-ins: 'atari8' (default; also 5200 via ctx.model) and 'neutral'.
  const ADAPTERS = {};
  const registerAdapter = (name, factory) => { ADAPTERS[name] = factory; };
  function createRuntime(profile, adapter) {
    const f = ADAPTERS[adapter || 'atari8'];
    if (!f) throw new Error('Unknown adapter: ' + adapter);
    return f(profile);
  }
  // System-neutral output: dpad/buttons/keypad/console as booleans, spinner/trackball as per-tick relative counts (no Atari semantics).
  registerAdapter('neutral', (profile) => {
    const P = sanitize(profile);
    return { profile: P, update(s) {
      const o = { dpad: { up: anyDown(s, P.joystick.up), down: anyDown(s, P.joystick.down), left: anyDown(s, P.joystick.left), right: anyDown(s, P.joystick.right) },
        buttons: { fire: anyDown(s, P.joystick.fire), fire2: anyDown(s, P.joystick.fire2) }, keypad: {}, console: {}, aux: [],
        spinner: counts(s, P.spinner.source, 8) * (P.spinner.invert ? -1 : 1) * P.spinner.sensitivity, trackball: { x: counts(s, P.trackball.x, 8) * (P.trackball.invertX ? -1 : 1) * P.trackball.sensitivity, y: counts(s, P.trackball.y, 8) * (P.trackball.invertY ? -1 : 1) * P.trackball.sensitivity } };
      Core_KEYS.forEach((k) => { o.keypad[k] = anyDown(s, P.keypad.keys[k]); });
      ['start', 'select', 'option', 'reset', 'pause', 'credit'].forEach((k) => { o.console[k] = anyDown(s, P.console[k]); });
      P.aux.forEach((x) => { if (x.action !== 'none') o.aux.push({ action: x.action, down: anyDown(s, x.source) }); });
      return o;
    } };
  });
  const Core_KEYS = KEYPAD_KEYS;
  function createAtari8(profile) {
    const P = sanitize(profile);
    const st = { pot: 0.5, idle: 0, prevWrap: null, acc: { x: 0, y: 0 }, qx: 0, qy: 0, right: 0, down: 0, step: 0, spinAcc: 0, held: {} };
    function update(s, ctx) {
      ctx = ctx || {};
      const dt = ctx.dtMs || 16, is5200 = P.keypad.target === '5200' || (P.keypad.target === 'auto' && ctx.model === '5200');
      const f = {}, keys = {};
      const addJoy = (pt, bits, trig) => { const n = 'joy' + (pt - 1), t = 'trig' + (pt - 1); if (bits) f[n] = (f[n] || 0) | bits; if (trig) f[t] = 1; };
      const J = P.joystick;
      if (J.enabled) {
        addJoy(J.port, (anyDown(s, J.up) ? 1 : 0) | (anyDown(s, J.down) ? 2 : 0) | (anyDown(s, J.left) ? 4 : 0) | (anyDown(s, J.right) ? 8 : 0), anyDown(s, J.fire) || anyDown(s, J.fire2));
      }
      const D = P.paddle;
      if (D.enabled) {
        const sg = D.invert ? -1 : 1;
        let moved = false;
        if (D.mode === 'axis') {
          let v = 0;
          for (const id of D.source) { const x = isDelta(id) ? 0 : lvl(s, id); if (Math.abs(x) > Math.abs(v)) v = x; }
          const a = Math.abs(v);
          v = a < D.deadzone ? 0 : Math.sign(v) * (a - D.deadzone) / (1 - D.deadzone);
          st.pot = clamp(0.5 + sg * v * 0.5 * D.sensitivity, 0, 1);
          moved = true;
        } else {
          const c = counts(s, D.source, 8);
          if (c) { st.pot = clamp(st.pot + sg * c * D.step * D.sensitivity, 0, 1); moved = true; }
        }
        const dir = (anyDown(s, D.right) ? 1 : 0) - (anyDown(s, D.left) ? 1 : 0);
        if (dir) { st.pot = clamp(st.pot + sg * dir * 0.02 * D.sensitivity, 0, 1); moved = true; }
        if (D.mode === 'encoder' || dir) {
          if (moved) st.idle = 0; else st.idle += dt;
          if (D.recentreMs > 0 && st.idle >= D.recentreMs) st.pot += clamp(0.5 - st.pot, -0.02, 0.02);
        }
        const slot = D.port - 1;
        f[slot ? 'mousey' : 'mousex'] = POT_MAX - Math.round(st.pot * POT_MAX);
        f[slot ? 'mousex' : 'mousey'] = 113;
        f.mouse_mode = 1;
        if (anyDown(s, D.button)) f.mouse_buttons = (f.mouse_buttons || 0) | (slot ? 2 : 1);
      }
      const Sp = P.spinner;
      if (Sp.enabled) {
        // Raw counts (no wheel scaling). One Gray step per tick at most, remainder queued (clamped), so a once-per-frame reader never aliases.
        let c = 0; for (const id of Sp.source) c += isDelta(id) ? (s.delta(id) || 0) : (/^gp:a/.test(id) ? lvl(s, id) * 0.5 : 0);
        st.spinAcc = clamp(st.spinAcc + c * Sp.sensitivity * (Sp.invert ? -1 : 1), -40, 40);
        const one = Math.sign(Math.trunc(st.spinAcc)); st.spinAcc -= one; st.step += one;
        addJoy(Sp.port, GRAY[st.step & 3], anyDown(s, Sp.fire));
      }
      const T = P.trackball;
      if (T.enabled) {
        let dx = counts(s, T.x, 8), dy = counts(s, T.y, 8);
        if (T.swapXY) [dx, dy] = [dy, dx];
        st.acc.x += dx * T.sensitivity * (T.invertX ? -1 : 1); st.acc.y += dy * T.sensitivity * (T.invertY ? -1 : 1);
        // One quadrature step per axis per tick, as the Pad tab does, so a once-per-frame reader cannot alias.
        const sx = Math.sign(Math.trunc(st.acc.x)), sy = Math.sign(Math.trunc(st.acc.y));
        st.acc.x = clamp(st.acc.x - sx, -40, 40); st.acc.y = clamp(st.acc.y - sy, -40, 40);
        if (sx) { st.qx = (st.qx + sx) & 3; st.right = sx > 0 ? 1 : 0; }
        if (sy) { st.qy = (st.qy + sy) & 3; st.down = sy > 0 ? 1 : 0; }
        const code = T.protocol === 'trak' ? ((st.qy & 1) << 3) | (st.down << 2) | ((st.qx & 1) << 1) | st.right : QTAB[T.protocol][(st.qy & 3) * 4 + (st.qx & 3)];
        f['joy' + (T.port - 1)] = code ^ 0xf;
        if (anyDown(s, T.fire)) f['trig' + (T.port - 1)] = 1;
      }
      const C = P.console, act = new Set();
      if (C.enabled) ['start', 'select', 'option', 'reset', 'pause', 'credit'].forEach((k) => { if (anyDown(s, C[k])) act.add(k); });
      P.aux.forEach((x) => { if (x.action !== 'none' && anyDown(s, x.source)) act.add(x.action); });
      if (act.has('credit')) act.add(is5200 ? 'start' : 'select');
      if (act.has('start')) { if (is5200) keys.cstart = { keycode: KP5200.start }; else f.start = 1; }
      if (!is5200 && act.has('select')) f.select = 1;
      if (!is5200 && act.has('option')) f.option = 1;
      if (act.has('reset')) { if (is5200) keys.creset = { keycode: KP5200.reset }; else f.special = 2; }
      if (act.has('pause') && is5200) keys.cpause = { keycode: KP5200.pause };
      if (act.has('break')) f.special = 5;
      if (act.has('help')) keys.chelp = { keycode: 0x11 };
      if (act.has('fire') || act.has('fire2')) { const jp = P.joystick.port - 1; f['trig' + jp] = 1; f['joy' + jp] = (f['joy' + jp] || 0); }
      if (P.keypad.enabled) {
        for (const k of KEYPAD_KEYS) if (anyDown(s, P.keypad.keys[k])) keys['k' + k] = is5200 ? { keycode: KP5200[k] } : { keychar: k.charCodeAt(0) };
      }
      return { fields: f, keys, debug: { pot: st.pot, pot227: Math.round(st.pot * POT_MAX), pot255: Math.round(st.pot * 255), spinStep: st.step, quad: [st.qx, st.qy] } };
    }
    return { profile: P, update, state: st };
  }
  registerAdapter('atari8', createAtari8);

  // Every source id a profile uses (for keyboard capture and the preview).
  function sourcesOf(p) {
    const out = new Set(), add = (a) => (a || []).forEach((x) => out.add(x));
    ['up', 'down', 'left', 'right', 'fire', 'fire2'].forEach((k) => add(p.joystick[k]));
    ['source', 'left', 'right', 'button'].forEach((k) => add(p.paddle[k]));
    add(p.spinner.source); add(p.spinner.fire); add(p.trackball.x); add(p.trackball.y); add(p.trackball.fire);
    KEYPAD_KEYS.forEach((k) => add(p.keypad.keys[k]));
    ['start', 'select', 'option', 'reset', 'pause', 'credit'].forEach((k) => add(p.console[k]));
    p.aux.forEach((a) => add(a.source));
    return out;
  }

  // ---- storage ----
  const PKEY = 'ac.ctrl.profiles', AKEY = 'ac.ctrl.active';
  function createStore(storage) {
    const ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const read = () => { try { const a = JSON.parse(ls.getItem(PKEY) || '[]'); return Array.isArray(a) ? a.map(sanitize).filter((x) => x.id) : []; } catch (e) { return []; } };
    const write = (a) => ls.setItem(PKEY, JSON.stringify(a));
    const newId = (list) => { let i; do { i = 'p-' + Math.random().toString(36).slice(2, 8); } while (list.some((x) => x.id === i)); return i; };
    return {
      list: read,
      get: (id) => read().find((x) => x.id === id) || null,
      save(p) { const list = read(), q = sanitize(p); if (!q.id) q.id = newId(list); const i = list.findIndex((x) => x.id === q.id); if (i >= 0) list[i] = q; else list.push(q); write(list); return q; },
      remove(id) { write(read().filter((x) => x.id !== id)); if (ls.getItem(AKEY) === id) ls.removeItem(AKEY); },
      active: () => ls.getItem(AKEY) || '',
      setActive(id) { if (id) ls.setItem(AKEY, id); else ls.removeItem(AKEY); },
      getActive() { const id = ls.getItem(AKEY); return id ? read().find((x) => x.id === id) || null : null; },
      // JSON in/out: a single profile or { format, profiles: [...] }
      exportJSON: (p) => JSON.stringify(sanitize(p), null, 2),
      exportAll: () => JSON.stringify({ format: FORMAT + 's', version: VERSION, profiles: read() }, null, 2),
      importJSON(text) {
        const o = JSON.parse(text), items = Array.isArray(o) ? o : o && Array.isArray(o.profiles) ? o.profiles : [o];
        const out = [];
        for (const it of items) {
          if (!it || typeof it !== 'object' || (it.format && it.format !== FORMAT)) throw new Error('Not an ataricraft controller profile');
          const q = sanitize(it); q.id = ''; out.push(this.save(q));
        }
        return out;
      },
    };
  }

  // "Name (STANDARD GAMEPAD Vendor: 046d Product: c216)" (Chrome) or "046d-c216-Name" (Firefox)
  function parsePadId(id) {
    id = String(id || '');
    let m = /Vendor:\s*([0-9a-f]{4})\s+Product:\s*([0-9a-f]{4})/i.exec(id);
    if (m) return { name: id.replace(/\s*\(.*\)\s*$/, ''), vendorId: parseInt(m[1], 16), productId: parseInt(m[2], 16) };
    m = /^([0-9a-f]{4})-([0-9a-f]{4})-(.*)$/i.exec(id);
    if (m) return { name: m[3], vendorId: parseInt(m[1], 16), productId: parseInt(m[2], 16) };
    return { name: id, vendorId: null, productId: null };
  }

  return { registerAdapter, ADAPTERS, AUX_ACTIONS, AUX_SLOTS, FORMAT, VERSION, PHYS, KEYPAD_KEYS, KP5200, QTAB, GRAY, POT_MAX, PRESETS, SRC_RE, blank, sanitize, validate, fromPreset, applyDeviceMap, createRuntime, createStore, sourcesOf, isDelta, parsePadId, down };
});
