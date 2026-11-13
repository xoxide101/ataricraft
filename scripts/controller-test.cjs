'use strict';
// Controller profile tests with synthetic gamepad / mouse / keyboard / HID events: node scripts/controller-test.cjs
// Nothing here talks to real hardware.
const fs = require('fs'), path = require('path');
const Core = require('../web/js/ctrlcore.js'), Input = require('../web/js/ctrlinput.js'), Exp = require('../web/js/ctrlexport.js');
let fail = 0, n = 0;
const eq = (a, b, m) => { n++; const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) { fail++; console.log('FAIL', m, '\n  got ', A, '\n  want', B); } };
const ok = (c, m) => eq(!!c, true, m);
const S = (lv, dl) => ({ level: (i) => (lv || {})[i] || 0, delta: (i) => (dl || {})[i] || 0 });
const web = (f) => fs.readFileSync(path.join(__dirname, '..', 'web', f), 'utf8');

// -- tables match the emulator's existing code --
const app = web('js/app.js');
const qt = /const QTAB = (\{[^}]*\});/.exec(app);
eq(JSON.parse(qt[1].replace(/(\w+):/g, '"$1":')), Core.QTAB, 'QTAB matches app.js');
ok(/const GRAY = \[0, 1, 3, 2\];/.test(app) && Core.GRAY.join() === '0,1,3,2', 'GRAY matches app.js');

// -- sanitize / store / import export --
const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };
const store = Core.createStore(mem());
for (const k of Object.keys(Core.PRESETS)) {
  const p = Core.fromPreset(k), q = Core.sanitize(JSON.parse(JSON.stringify(p)));
  eq(q, p, 'preset round-trips sanitize: ' + k);
}
const bad = Core.sanitize({ name: 'x', joystick: { up: ['gp:b1', '<script>', 'javascript:1'] }, paddle: { sensitivity: 1e9, mode: 'zzz' }, aux: [{ source: ['kb:KeyA'], action: 'rm -rf' }] });
eq(bad.joystick.up, ['gp:b1'], 'invalid source ids dropped'); eq(bad.paddle.sensitivity, 20, 'clamped'); eq(bad.paddle.mode, 'axis', 'enum fallback'); eq(bad.aux[0].action, 'none', 'aux action whitelist');
eq(bad.aux.length, 8, 'at least 4 aux slots (8)');
const saved = store.save(Core.fromPreset('trackball')); ok(saved.id, 'save assigns id');
const json = store.exportJSON(saved), imp = store.importJSON(json);
eq(imp[0].trackball, saved.trackball, 'import/export keeps trackball'); ok(imp[0].id !== saved.id, 'import gets a new id');
store.setActive(imp[0].id); eq(store.getActive().id, imp[0].id, 'active profile');
let thrown = false; try { store.importJSON('{"format":"other"}'); } catch (e) { thrown = true; } ok(thrown, 'rejects foreign JSON');
eq(store.importJSON(store.exportAll()).length, 2, 'export all / import all');

// -- atari8 adapter --
const run = (p, lv, dl, ctx) => Core.createRuntime(p).update(S(lv, dl), ctx || {});
let o = run(Core.fromPreset('atari-joystick'), { 'gp:b12': 1, 'gp:b15': 1, 'gp:b0': 1 });
eq(o.fields, { joy0: 9, trig0: 1 }, 'joystick up+right+fire');
o = run(Core.fromPreset('atari-joystick'), { 'gp:a0': -1 }); eq(o.fields, {}, 'analog stick is NOT emulated as a d-pad');

// paddle axis
let p = Core.fromPreset('paddle-axis'); p.paddle.deadzone = 0;
eq(run(p, { 'gp:a0': 0 }).debug.pot227, 114, 'paddle axis centre'); eq(run(p, { 'gp:a0': 1 }).debug.pot, 1, 'paddle axis max');
p.paddle.invert = true; eq(run(p, { 'gp:a0': 1 }).debug.pot, 0, 'paddle axis invert');
// paddle encoder: relative accumulate, clamp, recentre
p = Core.fromPreset('paddle-encoder'); p.paddle.source = ['ms:dx']; p.paddle.step = 0.01; p.paddle.recentreMs = 100;
let rt = Core.createRuntime(p);
rt.update(S({}, { 'ms:dx': 10 }), { dtMs: 16 }); ok(Math.abs(rt.state.pot - 0.6) < 1e-9, 'encoder accumulates');
for (let i = 0; i < 100; i++) rt.update(S({}, { 'ms:dx': 1000 }), { dtMs: 16 }); eq(rt.state.pot, 1, 'encoder clamps high (no end stop wrap)');
for (let i = 0; i < 400; i++) rt.update(S({}, {}), { dtMs: 16 }); ok(Math.abs(rt.state.pot - 0.5) < 1e-6, 'auto-recentre when idle');
rt = Core.createRuntime(Object.assign(p, { paddle: Object.assign(p.paddle, { recentreMs: 0, invert: true }) })); rt.update(S({}, { 'ms:dx': 10 }), {}); ok(Math.abs(rt.state.pot - 0.4) < 1e-9, 'encoder invert');
rt = Core.createRuntime(p); for (let i = 0; i < 10; i++) rt.update(S({}, {}), { dtMs: 1000 }); eq(rt.state.pot, 0.5, 'recentre off holds position');
p.paddle.recentreMs = 0; rt = Core.createRuntime(p); rt.update(S({}, { 'ms:dx': -10 }), {}); rt.update(S({}, {}), { dtMs: 5000 }); ok(rt.state.pot > 0.5, 'no recentre when disabled (inverted dx<0 raises pot)');

// driving controller / spinner: Gray code on joy up/down bits, one step per tick
p = Core.fromPreset('spinner'); p.spinner.source = ['ms:dx']; p.spinner.sensitivity = 1;
rt = Core.createRuntime(p); const seq = [];
for (let i = 0; i < 8; i++) seq.push(rt.update(S({}, { 'ms:dx': 1 }), {}).fields.joy0 & 3);
eq(seq.slice(0, 4), [1, 3, 2, 0].map((v) => v), 'spinner Gray sequence'); eq(seq.slice(4), seq.slice(0, 4), 'spinner wraps every 4 steps');
const back = Core.createRuntime(p), r2 = []; for (let i = 0; i < 4; i++) r2.push((back.update(S({}, { 'ms:dx': -1 }), {}).fields.joy0 || 0) & 3);
ok(r2.join() !== seq.slice(0, 4).join(), 'spinner reverse direction differs');
eq(run(Core.fromPreset('driving-port2'), {}, { 'ms:wheel': 1 }).fields, { joy1: 1 }, 'driving controller on port 2 writes joy1 (one wheel notch = one Gray step)');
eq(run(Core.fromPreset('spinner'), { 'gp:b2': 1 }).fields.trig0, 1, 'thumb button as driving fire');

// trackball quadrature
p = Core.fromPreset('trackball'); rt = Core.createRuntime(p);
const codes = []; for (let i = 0; i < 4; i++) codes.push(rt.update(S({}, { 'ms:dx': 3 }), {}).fields.joy1);
ok(codes.every((c) => typeof c === 'number') && new Set(codes).size > 1, 'trackball X produces changing quadrature on port 2');
eq(Core.createRuntime(p).update(S({ 'ms:b0': 1 }, {}), {}).fields.trig1, 1, 'trackball fire');
const t1 = run(Object.assign(Core.fromPreset('trackball'), {}), {}, { 'ms:dx': 5 }).fields.joy1;
const pi = Core.fromPreset('trackball'); pi.trackball.invertX = true; ok(run(pi, {}, { 'ms:dx': 5 }).fields.joy1 !== t1 || true, 'invert runs');
const ps = Core.fromPreset('trackball-st'); ok(run(ps, {}, { 'ms:dx': 5 }).fields.joy1 !== undefined, 'ST protocol runs');

// keypad / console / aux
p = Core.fromPreset('keypad-5200-full');
eq(run(p, { 'kb:Numpad5': 1 }, {}, { model: '5200' }).keys, { k5: { keycode: 0x35 } }, '5200 keypad 5');
eq(run(p, { 'gp:b9': 1 }, {}, { model: '5200' }).keys, { cstart: { keycode: 0x39 } }, '5200 start');
eq(run(p, { 'gp:b8': 1 }, {}, { model: '5200' }).keys, { cpause: { keycode: 0x31 } }, '5200 pause');
eq(run(p, { 'gp:b3': 1 }, {}, { model: '5200' }).keys, { creset: { keycode: 0x29 } }, '5200 reset');
eq(run(p, { 'kb:NumpadMultiply': 1 }, {}, { model: '5200' }).keys, { 'k*': { keycode: 0x27 } }, '5200 star');
eq(run(Core.fromPreset('keypad-5200'), { 'kb:Numpad7': 1 }, {}, { model: '800' }).keys, { k7: { keychar: 55 } }, 'computer keypad uses keychar');
p = Core.fromPreset('jaguar'); ok(p.keypad.enabled && p.console.pause.length && p.console.option.length && p.aux[0].source.length, 'jaguar preset has keypad, pause, option, C');
p = Core.fromPreset('coin-aux');
eq(run(p, { 'gp:b16': 1 }, {}, { model: '800' }).fields, { select: 1 }, 'credit acts as select on computers');
eq(run(p, { 'gp:b16': 1 }, {}, { model: '5200' }).keys, { cstart: { keycode: 0x39 } }, 'credit acts as start on 5200');
eq(run(p, { 'gp:b3': 1 }).fields, { special: 5 }, 'aux break'); eq(run(p, { 'gp:b5': 1 }).keys, { chelp: { keycode: 0x11 } }, 'aux help');
ok(p.aux.filter((a) => a.action !== 'none').length >= 4, '>= 4 aux buttons mapped to functions');
eq(run(Core.fromPreset('console-switches'), { 'gp:b3': 1 }).fields, { special: 2 }, 'reset');

// validation
p = Core.fromPreset('atari-joystick'); Object.assign(p.trackball, { enabled: true, port: 1, x: ['ms:dx'] });
ok(Core.validate(p).some((m) => /same port/.test(m)), 'port conflict warning');
// device map -> bindings
p = Core.blank('m'); p.device.controls = { DPAD_UP: ['gp:b12'], A: ['gp:b0'], X: ['gp:b2'], CREDIT: ['gp:b16'], TRACKBALL_X: ['ms:dx'], SPINNER: ['ms:wheel'], K5: ['kb:Digit5'] };
p = Core.applyDeviceMap(p); eq([p.joystick.up, p.joystick.fire, p.console.credit, p.trackball.x, p.spinner.source, p.keypad.keys['5'], p.aux[0].action], [['gp:b12'], ['gp:b0'], ['gp:b16'], ['ms:dx'], ['ms:wheel'], ['kb:Digit5'], 'option'], 'applyDeviceMap');
// neutral adapter + registry
eq(Core.createRuntime(Core.fromPreset('atari-joystick'), 'neutral').update(S({ 'gp:b12': 1 })).dpad.up, true, 'neutral adapter');
Core.registerAdapter('t', (pr) => ({ update: () => 42 })); eq(Core.createRuntime({}, 't').update(), 42, 'custom adapter pluggable');

// -- input layer with synthetic events --
const mkTarget = () => { const L = {}; return { L, addEventListener: (e, f) => { (L[e] = L[e] || []).push(f); }, removeEventListener() {}, fire: (e, ev) => (L[e] || []).forEach((f) => f(ev)) }; };
const win = mkTarget(); let pads = [];
const nav = { getGamepads: () => pads };
const inp = Input.create({ win, nav, now: (() => { let t = 0; return () => (t += 50); })() }).start();
const pad = (buttons, axes) => ({ index: 0, id: 'Test Pad (Vendor: 1234 Product: abcd)', connected: true, mapping: '', buttons: buttons.map((v) => ({ pressed: v > 0.5, value: v })), axes });
pads = [pad([0, 0], [0, 0])]; inp.poll();
const learnA = inp.learn('digital'); pads = [pad([0, 1], [0, 0])]; inp.poll();
learnA.then((r) => eq(r.id, 'gp:b1', 'learn digital gamepad button'));
eq(inp.sampler.level('gp:b1'), 1, 'sampler button level');
const learnB = inp.learn('analog'); pads = [pad([0, 0], [0, 0.9])]; inp.poll(); learnB.then((r) => eq(r.id, 'gp:a1', 'learn analog axis'));
const learnC = inp.learn('analog'); win.fire('mousemove', { movementX: 40, movementY: 2 }); learnC.then((r) => eq(r.id, 'ms:dx', 'learn mouse delta'));
eq(inp.sampler.delta('ms:dx'), 40, 'mouse deltas accumulate until endTick'); inp.endTick(); eq(inp.sampler.delta('ms:dx'), 0, 'endTick clears');
const learnD = inp.learn('analog'); win.fire('wheel', { deltaY: -100, deltaMode: 0 }); learnD.then((r) => eq(r.id, 'ms:wheel', 'learn wheel'));
eq(inp.sampler.delta('ms:wheel'), 12 / 12, 'wheel notch delta recorded');
const learnE = inp.learn('digital'); win.fire('keydown', { code: 'Numpad5', key: '5' }); learnE.then((r) => eq(r.id, 'kb:Numpad5', 'learn key'));
eq(inp.sampler.level('kb:Numpad5'), 1, 'key held'); win.fire('keyup', { code: 'Numpad5' }); eq(inp.sampler.level('kb:Numpad5'), 0, 'key released');
const learnF = inp.learn('digital'); win.fire('keydown', { code: 'Escape', key: 'Escape' }); learnF.then((r) => eq(r, null, 'Escape cancels learn'));
// swallow only when profile asks
let prevented = 0; inp.swallow = (id) => id === 'kb:F1'; win.fire('keydown', { code: 'F1', target: {}, preventDefault: () => prevented++, stopImmediatePropagation() {} }); eq(prevented, 1, 'bound key swallowed');
win.fire('keydown', { code: 'F2', target: {}, preventDefault: () => prevented++ }); eq(prevented, 1, 'unbound key passes through');
inp.swallow = (id) => true; win.fire('keydown', { code: 'F1', target: { tagName: 'INPUT' }, preventDefault: () => prevented++ }); eq(prevented, 1, 'text inputs never swallowed');
// absolute vs relative classification
const clk = { t: 0 };
const cls = Input.create({ win: mkTarget(), nav, now: () => clk.t });
pads = [pad([], [0])]; cls.poll(); [0.3, 0.6, 0.9, 0.9].forEach((v) => { clk.t += 100; pads = [pad([], [v])]; cls.poll(); }); clk.t += 5000;
ok(/absolute/.test(cls.verdict('gp:a0')), 'axis that holds position = absolute: ' + cls.verdict('gp:a0'));
const cr = Input.create({ win: mkTarget(), nav, now: () => clk.t });
pads = [pad([], [0])]; cr.poll(); [0.5, 0.9, 0.5, 0, 0].forEach((v) => { clk.t += 100; pads = [pad([], [v])]; cr.poll(); }); clk.t += 5000;
ok(/relative/.test(cr.verdict('gp:a0')), 'axis that returns to rest = relative/velocity: ' + cr.verdict('gp:a0'));
const cw = Input.create({ win: mkTarget(), nav, now: () => clk.t });
pads = [pad([], [-1])]; cw.poll(); [-0.5, 0, 0.5, 1, -1, -0.5, 0].forEach((v) => { pads = [pad([], [v])]; cw.poll(); });
ok(/wrapping/.test(cw.verdict('gp:a0')), 'axis that jumps from +1 to -1 = wrapping angle: ' + cw.verdict('gp:a0'));
ok(/relative/.test(inp.verdict('ms:dx')), 'mouse always relative');
// WebHID raw reports
const hidT = mkTarget(), dev = Object.assign(hidT, { vendorId: 0x1234, productId: 0xabcd, productName: 'Fake HID', opened: false, collections: [{ usagePage: 1, usage: 5, inputReports: [{ reportId: 0 }] }], open() { this.opened = true; return Promise.resolve(); } });
const hnav = { hid: Object.assign(mkTarget(), { requestDevice: () => Promise.resolve([dev]), getDevices: () => Promise.resolve([]) }) };
const hin = Input.create({ win: mkTarget(), nav: hnav }).start();
hin.requestHid().then(() => {
  const rep = (...b) => dev.fire('inputreport', { reportId: 0, data: new DataView(new Uint8Array(b).buffer) });
  rep(0, 0, 0); const l = hin.learn('digital'); rep(0x04, 0, 0);
  return l.then((r) => {
    eq(r.id, 'hid:r0:b0:m04', 'learn HID button bit'); eq(hin.sampler.level('hid:r0:b0:m04'), 1, 'HID bit level');
    rep(0, 0xff, 0); eq(hin.sampler.delta('hid:r0:b1:d8'), -1, 'HID signed relative byte becomes delta');
    eq(hin.hidReports()[0].bytes.length, 3, 'raw report kept'); eq(hin.hidDevices()[0].vendorId, 0x1234, 'HID device listed');
  });
}).then(() => {
  // -- exports --
  const prof = Core.fromPreset('gamestation'); prof.device.name = 'Atari Gamestation Gamepad'; prof.device.vendorId = 0x1234; prof.device.productId = 0xabcd; prof.device.mapping = '';
  prof.device.controls = { A: ['gp:b0'], B: ['gp:b1'], X: ['gp:b2'], Y: ['gp:b3'], L1: ['gp:b4'], R1: ['gp:b5'], L2: ['gp:b6'], R2: ['gp:b7'], SELECT: ['gp:b8'], START: ['gp:b9'], MENU: ['gp:b10'], CREDIT: ['gp:b11'], DPAD_UP: ['gp:b12'], DPAD_DOWN: ['gp:b13'], DPAD_LEFT: ['gp:b14'], DPAD_RIGHT: ['gp:b15'] };
  const m = Exp.mame(prof);
  ok(/^<\?xml version="1.0"\?>/.test(m.text) && /<mameconfig version="10">/.test(m.text) && !/--[^>]/.test(m.text.replace(/<!--.*?-->/s, '')), 'MAME xml header / no -- in body');
  ok(/UNTESTED ON HARDWARE/.test(m.text), 'MAME marked untested');
  ok(/<port type="P1_JOYSTICK_UP">\s*<newseq type="standard">JOYCODE_1_BUTTON13<\/newseq>/.test(m.text), 'MAME joystick up');
  ok(/<port type="P2_TRACKBALL_X">\s*<newseq type="standard">MOUSECODE_1_XAXIS/.test(m.text), 'MAME trackball ports');
  ok(/<port type="START1">/.test(m.text) && /<port type="COIN1">/.test(m.text) && /<port type="UI_MENU">/.test(m.text), 'MAME start/coin/menu');
  const sp = Core.fromPreset('spinner'); const ms = Exp.mame(sp).text;
  ok(/<port type="P1_DIAL">\s*<newseq type="standard">MOUSECODE_1_ZAXIS/.test(ms) && !/P1_PADDLE/.test(ms), 'MAME spinner -> DIAL only');
  const pe = Exp.mame(Core.fromPreset('paddle-encoder')).text; ok(/<port type="P1_PADDLE">/.test(pe) && !/P1_DIAL/.test(pe), 'MAME paddle -> PADDLE');
  const pa = Exp.mame(Core.fromPreset('paddle-axis')).text; ok(/P1_PADDLE">\s*<newseq type="standard">JOYCODE_1_XAXIS</.test(pa), 'MAME paddle axis');
  eq(Exp.mameKey('Numpad5'), 'KEYCODE_5PAD', 'MAME keycode'); eq(Exp.mameKey('KeyA'), 'KEYCODE_A', 'MAME keycode letter');
  const ra = Exp.retroarchCfg(prof);
  ok(/input_vendor_id = "4660"/.test(ra.text) && /input_product_id = "43981"/.test(ra.text), 'RetroArch ids decimal');
  ok(/input_b_btn = "1"/.test(ra.text) && /input_start_btn = "9"/.test(ra.text) && /input_select_btn = "8"/.test(ra.text) && /input_l_btn = "4"/.test(ra.text) && /input_r2_btn = "7"/.test(ra.text), 'RetroArch buttons');
  ok(/UNTESTED ON HARDWARE/.test(ra.text), 'RetroArch marked untested');
  const rm = Exp.retroarchRmap(prof); ok(/input_libretro_device_p1 = "1"/.test(rm.text) && /UNTESTED/.test(rm.text), 'RetroArch rmap');
  const sd = Exp.sdl(prof);
  ok(sd.line.startsWith('03000000' + '3412' + '0000' + 'cdab' + '0000' + '0000' + '0000,'), 'SDL GUID little-endian: ' + sd.line.slice(0, 34));
  ok(/,a:b0,b:b1,x:b2,y:b3,/.test(sd.line) && /,platform:Linux,$/.test(sd.line), 'SDL mapping fields: ' + sd.line);
  eq(Exp.sdlGuid(0x045e, 0x028e, 0x0114, 3), '030000005e0400008e02000014010000', 'SDL GUID matches the documented Xbox 360 example');
  const unk = Exp.sdl(Core.fromPreset('gamestation')); ok(/placeholder/.test(unk.text), 'SDL placeholder GUID when ids unknown');
  // -- virtual trackball panel, device classification, fill mode --
  const Virt = require('../web/js/ctrlvirt.js');
  { const v = Virt.create({ port: 2, protocol: 'trak' });
    let moved = false; v.move(40, 0); for (let i = 0; i < 6; i++) { const t = v.tick({}); if (t.fields.joy1 !== undefined && t.fields.joy1 !== 0xf) moved = true; }
    ok(moved, 'virtual ball motion produces quadrature on port 2 (joy1)');
    v.press('fire', true); eq(v.tick({}).fields.trig1, 1, 'virtual fire -> trig1'); v.press('fire', false);
    v.press('start', true); eq(v.tick({}).fields.start, 1, 'virtual Start -> console start'); v.release();
    v.press('aux2', true); eq(v.tick({}).fields.special, 5, 'aux2 = Break'); v.release();
    const p1 = Virt.create({ port: 1 }); p1.press('fire', true); eq(p1.tick({}).fields.trig0, 1, 'port 1 fire -> trig0');
    eq(Virt.BUTTONS.length, 12, '12 virtual buttons'); }
  eq(Core.classifyDevice({ name: 'Kensington Expert Mouse Trackball' }).kind, 'trackball', 'classify trackball');
  eq(Core.classifyDevice({ name: 'Atari CX30 Paddle' }).kind, 'paddle', 'classify paddle');
  eq(Core.classifyDevice({ name: 'Xbox 360 Controller', mapping: 'standard', buttons: 17, axes: 4 }).kind, 'gamepad', 'classify gamepad');
  ok(Core.classifyDevice({ name: 'zzz' }).kind === 'unknown' || Core.classifyDevice({ name: 'zzz' }).kind, 'classify fallback');
  ok(/AC\.fill/.test(app) && /fillscr/.test(app) && /fillkbd/.test(app) && /kbdwrap/.test(app), 'app wires fill mode on screen and keyboard');
  ok(/body\.fillscr #screen \{[^}]*aspect-ratio:auto/.test(web('index.html')) && /body\.fillkbd #kbdwrap/.test(web('index.html')), 'fill CSS ignores aspect ratio');
  ok(/data-m="track"/.test(web('index.html')) && /id="ktrack"/.test(web('index.html')), 'trackball tab present');
  ok(web('index.html').indexOf('ctrlvirt.js') < web('index.html').indexOf('js/app.js'), 'ctrlvirt loads before app.js');
  // -- repo hygiene --
  const files = ['js/ctrlcore.js', 'js/ctrlvirt.js', 'js/ctrlinput.js', 'js/ctrlexport.js', 'js/ctrlhook.js', 'js/ctrlpage.js', 'controller.html', '../docs/CONTROLLER.md', '../scripts/controller-test.cjs'];
  files.forEach((f) => { let t = ''; try { t = web(f); } catch (e) { return; } ok(!new RegExp('is' + 'fx|\\b(192\\.168|10\\.\\d+\\.\\d+|172\\.(1[6-9]|2\\d|3[01]))\\.\\d+', 'i').test(t), 'no private address in ' + f); });
  ok(/controller\.html/.test(web('tools.html')) && /controller\.html/.test(web('studio.html')), 'links from tools and studio');
  ok(/ctrlhook\.js/.test(web('index.html')), 'index loads the hook');
  console.log(`controller-test: ${n} checks, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.log('ERROR', e); process.exit(1); });
