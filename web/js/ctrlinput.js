// Device-agnostic input layer: Gamepad API + optional WebHID raw reports + keyboard/mouse fallback, with "press this control" learning.
// Everything is reduced to source ids (see ctrlcore.js). Written so it runs against synthetic events/gamepads in Node.
// UNVERIFIED on the real Atari Gamestation Gamepad: how it enumerates (HID gamepad, keyboard/mouse or custom) is not known yet.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.AC = root.AC || {}; root.AC.CtrlInput = api; }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const NOW = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const isText = (t) => t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || t.isContentEditable);

  function create(opts) {
    opts = opts || {};
    const win = opts.win, nav = opts.nav || {}, doc = opts.doc || null, now = opts.now || NOW;
    const mouseTarget = opts.mouseTarget || win;
    const I = {
      pads: [], keys: new Set(), mbtn: new Set(), deltas: new Map(), hid: new Map(), hidLast: new Map(), hidInfo: new Map(),
      mouse: { seen: false, dx: 0, dy: 0, wheel: 0, tx: 0, ty: 0, buttons: 0, last: 0 }, kb: { seen: false, last: '' },
      events: [], stats: new Map(), learnReq: null, listeners: [], swallow: opts.swallow || null, filter: null, started: false,
    };
    const log = (type, text) => { I.events.push({ t: now(), type, text }); if (I.events.length > 300) I.events.shift(); if (I.onEvent) I.onEvent(I.events[I.events.length - 1]); };
    const addDelta = (id, v) => { if (v) I.deltas.set(id, (I.deltas.get(id) || 0) + v); };

    // ---- absolute/relative classification (heuristic) ----
    function track(key, v, kind) {
      let s = I.stats.get(key);
      if (!s) { s = { kind, rest: v, last: v, lastChange: now(), moved: false, returned: 0, held: 0, wrapped: 0, changes: 0, min: v, max: v, heldFlag: false }; I.stats.set(key, s); return; }
      if (v === s.last) return;
      if (Math.abs(v - s.last) > 1.2) s.wrapped++;
      if (Math.abs(v - s.rest) < 0.05 && s.moved && Math.abs(s.last - s.rest) >= 0.1) s.returned++;
      if (Math.abs(v - s.rest) >= 0.1) s.moved = true;
      s.changes++; s.last = v; s.lastChange = now(); s.heldFlag = false; s.min = Math.min(s.min, v); s.max = Math.max(s.max, v);
    }
    function verdict(key) {
      if (/^ms:/.test(key)) return 'relative (deltas)';
      const s = I.stats.get(key);
      if (!s || s.changes < 2) return 'unknown: move the control, then release it';
      if (/:d8$/.test(key)) return 'relative (per-report deltas)';
      const idle = now() - s.lastChange > 600, holds = idle && Math.abs(s.last - s.rest) >= 0.1;
      if (s.wrapped) return 'absolute, wrapping angle (turns past the end and jumps back): derive deltas from it';
      if (holds && !s.returned) return 'absolute (holds its position)';
      if (s.returned && !holds) return 'relative / velocity (returns to rest): treat as spinner or encoder';
      return 'unclear: try one slow turn, stop, then release';
    }
    I.verdict = verdict;

    // ---- learn ----
    function offer(id, extra) {
      const r = I.learnReq;
      if (!r) return;
      const want = r.want, isDel = /^ms:(dx|dy|wheel)$/.test(id) || /:d8$/.test(id);
      if (want === 'digital' && (isDel || /^(gp:a\d+|hid:.*:(u8|s8))$/.test(id))) return;
      if (want === 'analog' && !(isDel || /^(gp:a\d+|hid:.*:(u8|s8))$/.test(id) || /^gp:a\d+[+-]$/.test(id))) return;
      I.learnReq = null; r.resolve(Object.assign({ id }, extra || {}));
    }
    I.learn = (want) => new Promise((resolve) => {
      if (I.learnReq) I.learnReq.resolve(null);
      const base = {};
      I.pads.forEach((g) => g.axes.forEach((v, i) => { base[g.index + ':' + i] = v; }));
      const hidBase = new Map(I.hidLast);
      I.learnReq = { want: want || 'digital', resolve, base, hidBase, mx: 0, my: 0, t: now() };
    });
    I.cancelLearn = () => { if (I.learnReq) { const r = I.learnReq; I.learnReq = null; r.resolve(null); } };

    // ---- gamepads ----
    I.poll = () => {
      const list = nav.getGamepads ? [...nav.getGamepads()].filter(Boolean) : [];
      const prev = I.pads;
      const pads = list.filter((g) => g.connected !== false && (!I.filter || String(g.id).toLowerCase().includes(I.filter)));
      pads.forEach((g) => {
        const old = prev.find((p) => p.index === g.index);
        const buttons = [...g.buttons].map((b) => (typeof b === 'object' ? (b.value !== undefined && !b.pressed ? b.value : b.pressed ? Math.max(b.value || 0, 1) : 0) : +!!b));
        const axes = [...g.axes];
        g._s = { index: g.index, id: g.id, mapping: g.mapping || '', buttons, axes };
        axes.forEach((v, i) => track('gp:a' + i + '@' + g.index, v, 'gp'));
        axes.forEach((v, i) => track('gp:a' + i, v, 'gp'));
        buttons.forEach((v, i) => { if (v >= 0.5 && !(old && old.buttons[i] >= 0.5)) { log('gamepad', `pad ${g.index} button ${i} down`); offer('gp:b' + i); } });
        axes.forEach((v, i) => {
          if (old && Math.abs(v - (old.axes[i] || 0)) > 0.3) log('gamepad', `pad ${g.index} axis ${i} = ${v.toFixed(2)}`);
          const r = I.learnReq; if (!r) return;
          const b = r.base[g.index + ':' + i] || 0;
          if (Math.abs(v - b) > 0.6 && (r.want !== 'digital' || Math.abs(v) > 0.6)) offer(r.want === 'digital' ? 'gp:a' + i + (v - b > 0 ? '+' : '-') : 'gp:a' + i);
        });
      });
      I.pads = pads.map((g) => g._s);
      return I.pads;
    };

    // ---- keyboard ----
    const onKey = (down) => (e) => {
      I.kb.seen = true; I.kb.last = e.code;
      const id = 'kb:' + e.code;
      if (down) { if (!I.keys.has(e.code)) log('key', e.code + ' down'); I.keys.add(e.code); if (I.learnReq && e.code !== 'Escape' && !e.repeat) { offer(id, { key: e.key }); if (e.preventDefault) e.preventDefault(); } else if (I.learnReq && e.code === 'Escape') I.cancelLearn(); } else I.keys.delete(e.code);
      if (I.swallow && I.swallow(id) && !isText(e.target)) { if (e.preventDefault) e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); }
    };
    // ---- mouse ----
    const onMove = (e) => {
      const dx = e.movementX || 0, dy = e.movementY || 0;
      I.mouse.seen = true; I.mouse.dx = dx; I.mouse.dy = dy; I.mouse.tx += dx; I.mouse.ty += dy; I.mouse.last = now();
      addDelta('ms:dx', dx); addDelta('ms:dy', dy);
      const r = I.learnReq;
      if (r && r.want !== 'digital') { r.mx += Math.abs(dx); r.my += Math.abs(dy); if (r.mx > 30 || r.my > 30) offer(r.mx >= r.my ? 'ms:dx' : 'ms:dy'); }
    };
    const onWheel = (e) => {
      const n = e.deltaMode === 1 ? e.deltaY : e.deltaY / 100;
      I.mouse.seen = true; I.mouse.wheel += n; addDelta('ms:wheel', -n);
      log('mouse', 'wheel ' + (n > 0 ? 'down' : 'up'));
      if (I.learnReq && I.learnReq.want !== 'digital') offer('ms:wheel');
      if (I.swallow && I.swallow('ms:wheel') && e.preventDefault) e.preventDefault();
    };
    const onMDown = (e) => { I.mouse.seen = true; I.mbtn.add(e.button); I.mouse.buttons = I.mbtn.size; log('mouse', 'button ' + e.button + ' down'); if (I.learnReq && I.learnReq.want !== 'analog') { offer('ms:b' + e.button); if (e.preventDefault) e.preventDefault(); } };
    const onMUp = (e) => { I.mbtn.delete(e.button); I.mouse.buttons = I.mbtn.size; };
    const onBlur = () => { I.keys.clear(); I.mbtn.clear(); };
    const onPad = (e) => log('gamepad', (e.type === 'gamepadconnected' ? 'connected: ' : 'disconnected: ') + (e.gamepad && e.gamepad.id));

    // ---- WebHID ----
    function hidReport(dev, e) {
      const u8 = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
      const key = dev._k + '#' + e.reportId, prev = I.hid.get(key);
      const bytes = Uint8Array.from(u8);
      I.hid.set(key, { dev: dev._k, name: dev.productName, reportId: e.reportId, bytes, prev: prev ? prev.bytes : null, count: (prev ? prev.count : 0) + 1, t: now() });
      I.hidLast.set(e.reportId, bytes);
      const old = prev ? prev.bytes : null;
      bytes.forEach((b, i) => {
        track(`hid:r${e.reportId}:b${i}:u8`, (b - 127.5) / 127.5, 'hid');
        if (b) addDelta(`hid:r${e.reportId}:b${i}:d8`, b << 24 >> 24); // relative encoders put the signed count in the byte
      });
      log('hid', `report ${e.reportId}: ${hex(bytes)}`);
      const r = I.learnReq;
      if (r && old) {
        for (let i = 0; i < bytes.length; i++) {
          const x = bytes[i] ^ old[i];
          if (!x) continue;
          if (r.want === 'analog') { offer(`hid:r${e.reportId}:b${i}:u8`, { note: 'byte level; use :s8 for signed, :d8 for a per-report delta' }); return; }
          const rose = x & bytes[i];
          if (rose) { const bit = rose & -rose; offer(`hid:r${e.reportId}:b${i}:m${bit.toString(16).padStart(2, '0')}`); return; }
        }
      }
    }
    function openHid(dev) {
      if (I.hidInfo.has(dev)) return Promise.resolve();
      dev._k = (dev.vendorId || 0).toString(16).padStart(4, '0') + ':' + (dev.productId || 0).toString(16).padStart(4, '0');
      I.hidInfo.set(dev, { error: '' });
      const fn = (e) => hidReport(dev, e);
      dev.addEventListener('inputreport', fn);
      return Promise.resolve(dev.opened ? null : dev.open()).then(() => log('hid', 'opened ' + dev.productName)).catch((err) => { I.hidInfo.get(dev).error = String(err && err.message || err); log('hid', 'open failed: ' + I.hidInfo.get(dev).error); });
    }
    I.requestHid = (filters) => {
      if (!nav.hid) return Promise.reject(new Error('WebHID is not available in this browser (needs Chrome/Edge on https or localhost)'));
      return nav.hid.requestDevice({ filters: filters || [] }).then((devs) => Promise.all(devs.map(openHid)).then(() => devs));
    };
    I.reopenHid = () => (nav.hid && nav.hid.getDevices ? nav.hid.getDevices().then((d) => Promise.all(d.map(openHid))) : Promise.resolve());

    // ---- sampler used by the profile runtime ----
    I.sampler = {
      level(id) {
        let m;
        if ((m = /^gp:b(\d+)$/.exec(id))) { for (const g of I.pads) if (g.buttons[+m[1]] !== undefined && g.buttons[+m[1]] > 0) return g.buttons[+m[1]]; return 0; }
        if ((m = /^gp:a(\d+)$/.exec(id))) { let v = 0; for (const g of I.pads) { const a = g.axes[+m[1]] || 0; if (Math.abs(a) > Math.abs(v)) v = a; } return v; }
        if (id.startsWith('kb:')) return I.keys.has(id.slice(3)) ? 1 : 0;
        if ((m = /^ms:b(\d)$/.exec(id))) return I.mbtn.has(+m[1]) ? 1 : 0;
        if ((m = /^hid:r(\d+):b(\d+):(m[0-9a-f]{2}|u8|s8)$/.exec(id))) {
          const rep = I.hidLast.get(+m[1]); if (!rep) return 0; const b = rep[+m[2]] || 0;
          return m[3] === 'u8' ? (b - 127.5) / 127.5 : m[3] === 's8' ? (b << 24 >> 24) / 128 : (b & parseInt(m[3].slice(1), 16)) ? 1 : 0;
        }
        return 0;
      },
      delta: (id) => I.deltas.get(id) || 0,
    };
    I.endTick = () => I.deltas.clear();

    // ---- lifecycle / helpers ----
    const bind = (t, ev, fn, cap) => { if (t && t.addEventListener) { t.addEventListener(ev, fn, cap); I.listeners.push([t, ev, fn, cap]); } };
    I.start = () => {
      if (I.started) return I; I.started = true;
      bind(win, 'keydown', onKey(true), true); bind(win, 'keyup', onKey(false), true);
      bind(mouseTarget, 'mousemove', onMove); bind(mouseTarget, 'mousedown', onMDown, true); bind(mouseTarget, 'wheel', onWheel);
      bind(win, 'mouseup', onMUp, true); bind(win, 'blur', onBlur);
      bind(win, 'gamepadconnected', onPad); bind(win, 'gamepaddisconnected', onPad);
      if (nav.hid && nav.hid.addEventListener) { bind(nav.hid, 'disconnect', (e) => log('hid', 'disconnected: ' + (e.device && e.device.productName))); I.reopenHid(); }
      return I;
    };
    I.stop = () => { I.listeners.forEach(([t, ev, fn, cap]) => t.removeEventListener(ev, fn, cap)); I.listeners = []; I.started = false; I.cancelLearn(); };
    I.lockPointer = (el) => (el && el.requestPointerLock ? el.requestPointerLock() : null);
    I.hidDevices = () => [...I.hidInfo.keys()].map((d) => ({ name: d.productName, vendorId: d.vendorId, productId: d.productId, opened: !!d.opened, error: I.hidInfo.get(d).error,
      collections: (d.collections || []).map((c) => ({ usagePage: c.usagePage, usage: c.usage, inputReports: (c.inputReports || []).map((r) => r.reportId) })) }));
    I.hidReports = () => [...I.hid.values()];
    return I;
  }
  return { create, hex };
});
