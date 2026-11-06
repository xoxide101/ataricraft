/* Emulator-side half of the Craft Tools link (docs/TOOLSHUB.md). Loaded by index.html after app.js.
   Answers tools.html (and any other same-origin tab) over the BroadcastChannel 'ataricraft-tools' so the BASIC, ASM, Inspect and FONT
   panels there can read memory, inject programs and drive this machine. Requests are {t:'req', id, to, op, args}; answers {t:'res', id, ok, val|err}. */
(function () {
  const AC = (window.AC = window.AC || {});
  if (typeof BroadcastChannel === 'undefined' || !window.ataricraft) return;
  const A = window.ataricraft, id = Math.random().toString(36).slice(2, 8), I = () => AC.Inspect;
  A.toolsId = id;
  const ch = new BroadcastChannel('ataricraft-tools');
  const booted = () => { try { return !!A.state().booted; } catch (e) { return false; } };
  const u8 = (v) => (v instanceof Uint8Array ? v : Uint8Array.from(v));
  const info = () => { const s = A.state(); return { id, version: A.version, booted: !!s.booted, running: !!s.running, frames: s.frames | 0, model: s.model, core: A.describe().core }; };
  const need = () => { if (!booted()) throw new Error('boot the emulator first'); };
  const INS = ['dump', 'find', 'fill', 'poke', 'ip', 'setIp', 'mock', 'unmock', 'resetNet', 'net', 'state', 'ramText', 'segs'];
  const BANKS = ['list', 'scan', 'read', 'write', 'fill', 'find', 'page', 'probe', 'install'];

  const OPS = {
    ping: () => info(),
    mem: () => { need(); return u8(A.peek(0, 65536)); },
    peek: (a) => { need(); return u8(A.peek(a.addr, a.len)); },
    poke: (a) => { need(); A.poke(a.addr, u8(a.bytes)); return true; },
    bootFile: (a) => { need(); I().load(a.name, u8(a.bytes)); return { segs: I().lastLoad ? I().lastLoad.segs : [] }; },
    type: (a) => { need(); A.type(String(a.text)); return true; },
    romFont: () => { const f = AC.BasicHost && AC.BasicHost.romFont(); return f ? u8(f) : null; },
    screenText: () => { need(); return A.screenText(); },
    screenshot: (a) => { need(); return A.screenshot(a || {}); },
    'inspect.ram': () => { need(); const r = I().ram(); return Object.assign({}, r, { text: I().ramText(r) }); },
    'inspect.load': (a) => { need(); I().load(a.name, u8(a.bytes)); return { segs: I().lastLoad ? I().lastLoad.segs : [] }; },
    'inspect.progs': async () => { await I().loadProgs(); return I().progs(); },
    'inspect.runProg': async (a) => { need(); await I().runProg(a.name); return { segs: I().lastLoad ? I().lastLoad.segs : [] }; },
    'net.get': () => { const L = AC.NetLog; return { summary: L.summary(), events: L.events.slice(-80), cfg: Object.assign({}, L.cfg) }; },
    'net.reset': () => { AC.NetLog.reset(); return true; },
    'remote.status': () => AC.Remote.status(),
    'remote.connect': (a) => { AC.Remote.connect(a && a.url); return AC.Remote.status(); },
    'remote.stop': () => { AC.Remote.stop(); return AC.Remote.status(); },
  };
  for (const n of INS) OPS['inspect.' + n] = (a) => I()[n](...((a && a.args) || []));
  for (const n of BANKS) OPS['banks.' + n] = (a) => I().banks[n](...((a && a.args) || []));

  const post = (m) => { try { ch.postMessage(Object.assign({ from: id }, m)); } catch (e) { /* channel closed */ } };
  ch.onmessage = async (e) => {
    const d = e.data || {};
    if (d.t === 'hello') { post({ t: 'ready', info: info() }); return; }
    if (d.t !== 'req' || (d.to && d.to !== id)) return;
    const f = OPS[d.op];
    if (!f) { post({ t: 'res', id: d.id, ok: false, err: 'unknown op ' + d.op }); return; }
    try { post({ t: 'res', id: d.id, ok: true, val: await f(d.args || {}) }); } catch (er) { post({ t: 'res', id: d.id, ok: false, err: String(er && er.message || er) }); }
  };
  post({ t: 'ready', info: info() });
  setInterval(() => post({ t: 'ready', info: info() }), 3000);
  addEventListener('pagehide', () => post({ t: 'bye' }));
  AC.ToolsHost = { id, ops: Object.keys(OPS), info };
})();
