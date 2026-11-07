// ACNet in the emulator: register window $D1A0-$D1BF + IRQ (patched libatari800 core) and SIO device $65, both backed by one
// shared service core (acnet-core.js) that talks to tools/acnet/bridge.cjs over a WebSocket. Offline-first: no bridge = "no link".
(function () {
  'use strict';
  const Core = AC.ACNetCore;
  const KEY = 'ac.acnet.url', ONKEY = 'ac.acnet.on';
  const AcNet = {
    core: null, ws: null, emu: null, url: localStorage.getItem(KEY) || 'ws://127.0.0.1:8765',
    enabled: localStorage.getItem(ONKEY) !== '0', timer: 0, chip: null,

    dec: (t) => JSON.parse(t, (k, v) => (v && typeof v === 'object' && typeof v.b64 === 'string' ? Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0)) : v)),

    attach(emu) {
      this.emu = emu;
      if (!this.core) {
        this.core = Core.create({});
        this.core.backend = (m) => { if (this.ws && this.ws.readyState === 1) this.ws.send(this.encode(m)); };
      }
      const m = emu.m, core = this.core;
      m.acNet = (rw, addr, val) => (rw === 1 ? (core.regWrite(addr - 0xd1a0, val & 255), 0) : core.regRead(addr - 0xd1a0, rw === 2));
      core.onIrq = (l) => { if (m._ac_net_irq) m._ac_net_irq(l ? 1 : 0); };
      if (m._ac_net_enable) m._ac_net_enable(this.enabled ? 1 : 0);
      const inner = m.acSio;
      m.acSio = (dev, cmd, dstats, aux, data, len) => (dev === 0x65 && this.enabled ? this.sio(cmd, dstats, aux, data, len) : inner ? inner(dev, cmd, dstats, aux, data, len) : 0);
      if (!emu.__acnetFrame) {
        emu.__acnetFrame = true;
        const frame = emu.frame.bind(emu);
        emu.frame = (...a) => { const r = frame(...a); if (AcNet.enabled) core.tick(); return r; };
      }
      this.ui();
      this.connectSoon(0);
    },

    encode(m) { // Uint8Array data -> base64 without call-stack limits
      return JSON.stringify(m, (k, v) => {
        if (k === 'data' && v && v.buffer) { let s = ''; for (let i = 0; i < v.length; i += 4096) s += String.fromCharCode.apply(null, v.subarray(i, i + 4096)); return { b64: btoa(s) }; }
        return v;
      });
    },

    sio(cmd, dstats, aux, data, len) {
      const mem = this.emu.mem(), core = this.core;
      const wr = (dstats & 0x80) !== 0;
      const input = wr ? Uint8Array.from(mem.subarray(data, data + len)) : undefined;
      const r = core.sio(cmd, aux & 255, (aux >> 8) & 255, input);
      if (r.data && !wr) mem.set(r.data.subarray(0, len), data);
      return r.st || 0;
    },

    connectSoon(ms) {
      clearTimeout(this.timer);
      if (!this.enabled) return;
      this.timer = setTimeout(() => this.connect(), ms);
    },
    connect() {
      if (!this.enabled || (this.ws && this.ws.readyState <= 1)) return;
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { this.connectSoon(3000); return; }
      this.ws = ws;
      ws.onopen = () => { this.core.setBridge(true); this.paint(); };
      ws.onmessage = (ev) => { try { this.core.deliver(this.dec(ev.data)); } catch (e) { console.error('acnet', e); } this.paint(); };
      ws.onclose = () => { if (this.ws === ws) { this.ws = null; this.core.setBridge(false); this.paint(); this.connectSoon(3000); } };
      ws.onerror = () => {};
    },
    setEnabled(on) {
      this.enabled = on; localStorage.setItem(ONKEY, on ? '1' : '0');
      if (this.emu && this.emu.m._ac_net_enable) this.emu.m._ac_net_enable(on ? 1 : 0);
      if (!on && this.ws) { const w = this.ws; this.ws = null; w.close(); this.core.setBridge(false); }
      if (on) this.connectSoon(0);
      this.paint();
    },
    setUrl(u) { this.url = u; localStorage.setItem(KEY, u); if (this.ws) this.ws.close(); this.connectSoon(0); },

    status() {
      if (!this.enabled) return 'ACNet off';
      const l = this.core && this.core.link;
      if (!this.ws) return 'ACNet: no link (bridge not running)';
      return l && l.up ? 'ACNet ' + l.ip.join('.') : 'ACNet: bridge up, waiting for DHCP';
    },
    ui() {
      if (this.chip || !document.body) return;
      const c = document.createElement('div');
      c.id = 'acnetchip';
      c.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:50;font:11px monospace;background:#222;color:#ccc;border:1px solid #555;border-radius:10px;padding:2px 8px;cursor:pointer;opacity:.85';
      c.onclick = () => this.setEnabled(!this.enabled);
      c.oncontextmenu = (e) => { e.preventDefault(); const u = prompt('ACNet bridge WebSocket URL', this.url); if (u) this.setUrl(u.trim()); };
      document.body.appendChild(c); this.chip = c; this.paint();
    },
    paint() {
      if (!this.chip) return;
      const up = this.enabled && this.ws && this.core.link.up;
      this.chip.textContent = (up ? '\u25cf ' : '\u25cb ') + this.status();
      this.chip.style.color = up ? '#6c6' : '#aaa';
      this.chip.title = 'Click: toggle. Right-click: bridge URL (' + this.url + '). Register window $D1A0, SIO device $65.';
    },
  };

  const FN = window.FujiNet;
  if (FN && FN.attach) {
    const orig = FN.attach.bind(FN);
    FN.attach = (emu) => { orig(emu); AcNet.attach(emu); };
  }
  window.ACNet = AcNet;
})();
