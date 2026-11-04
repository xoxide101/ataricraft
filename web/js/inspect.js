// Inspector: RAM use, network activity (N: device), virtual adapter IP settings, and injection (memory, files, keys, network replies).
// AC.NetLog wraps the relay transport used by the virtual FujiNet; AC.Inspect reads the running emulator. Everything is reachable
// as ataricraft.inspect.* and, through the relay's /ctl endpoints (AC.Remote), from outside the browser (tools/ctl.cjs).
(function () {
  const AC = (window.AC = window.AC || {});
  let getEmu = () => null;
  const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0');
  const b64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  // ---------------------------------------------------------------- network log, counters, mock replies, IP settings
  const NetLog = {
    events: [], conns: new Map(), tx: 0, rx: 0, calls: 0, errors: 0, mocks: [], max: 500, listeners: [],
    cfg: { ssid: 'ataricraft', hostname: 'fujinet-virtual', ip: '127.0.0.1', gw: '127.0.0.1', mask: '255.0.0.0', dns: '8.8.8.8', mac: '02:00:00:00:00:01', bssid: '02:00:00:00:00:02', dhcp: false },
    add(e) { e.t = Date.now(); this.events.push(e); if (this.events.length > this.max) this.events.shift(); this.listeners.forEach((f) => f(e)); },
    reset() { this.events.length = 0; this.conns.clear(); this.tx = this.rx = this.calls = this.errors = 0; },
    mock(pattern, status, body, headers) { const m = { pattern: String(pattern), status: status || 200, body: typeof body === 'string' ? Uint8Array.from(body, (c) => c.charCodeAt(0) & 255) : body || new Uint8Array(0), headers: headers || [], hits: 0 }; this.mocks.push(m); return this.mocks.length - 1; },
    unmock(i) { if (i == null) this.mocks.length = 0; else this.mocks.splice(i, 1); },
    ipBytes(s) { const p = String(s).split('.').map(Number); return p.length === 4 && p.every((v) => v >= 0 && v < 256) ? p : [0, 0, 0, 0]; },
    macBytes(s) { const p = String(s).split(':').map((x) => parseInt(x, 16)); return p.length === 6 && p.every((v) => v >= 0 && v < 256) ? p : [2, 0, 0, 0, 0, 1]; },
    setIp(o) {
      const c = this.cfg, ok = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && this.ipBytes(s).some((v) => v) || s === '0.0.0.0';
      for (const k of ['ip', 'gw', 'mask', 'dns']) if (o[k] != null) { if (!ok(String(o[k]))) throw new Error('bad ' + k); c[k] = String(o[k]); }
      for (const k of ['ssid', 'hostname']) if (o[k] != null) c[k] = String(o[k]).slice(0, 32);
      for (const k of ['mac', 'bssid']) if (o[k] != null) { if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(o[k])) throw new Error('bad ' + k); c[k] = String(o[k]).toLowerCase(); }
      if (o.dhcp != null) c.dhcp = !!o.dhcp;
      this.add({ kind: 'IP', desc: `${c.ip} / ${c.mask} gw ${c.gw} dns ${c.dns}${c.dhcp ? ' (DHCP)' : ''}` });
      return Object.assign({}, c);
    },
    summary() { return { calls: this.calls, errors: this.errors, tx: this.tx, rx: this.rx, open: [...this.conns.values()].filter((c) => !c.closed).length, mocks: this.mocks.map((m) => ({ pattern: m.pattern, status: m.status, hits: m.hits })) }; },
    wrap(t) {
      const L = this, out = {};
      const note = (kind, desc, o) => { L.calls++; if (o.err || (o.status && o.status >= 400)) L.errors++; L.tx += o.tx || 0; L.rx += o.rx || 0; L.add(Object.assign({ kind, desc }, o)); };
      for (const k of Object.keys(t)) out[k] = t[k];
      out.http = (req) => {
        const t0 = performance.now(), m = L.mocks.find((x) => req.url.includes(x.pattern));
        if (m) { m.hits++; note('HTTP', `${req.method || 'GET'} ${req.url} [mock]`, { status: m.status, rx: m.body.length, tx: (req.body || []).length, ms: 0 }); return { status: m.status, headers: m.headers, body: m.body }; }
        const r = t.http(req);
        note('HTTP', `${req.method || 'GET'} ${req.url}`, { status: r.status, rx: r.body.length, tx: (req.body || []).length, ms: Math.round(performance.now() - t0) });
        return r;
      };
      for (const kind of ['tcp', 'udp']) {
        const open = kind === 'tcp' ? 'tcpOpen' : 'udpOpen', rd = kind + 'Read', wr = kind === 'tcp' ? 'tcpWrite' : 'udpSend', cl = kind + 'Close';
        out[open] = (host, port, mode) => { const r = t[open](host, port, mode); const key = kind + (r.id != null ? r.id : ''); if (r.id != null) L.conns.set(key, { kind, host, port, tx: 0, rx: 0, since: Date.now() }); note(kind.toUpperCase(), `open ${host}:${port}`, { err: r.err }); return r; };
        if (kind === 'tcp') out.tcpAccept = (id) => { const r = t.tcpAccept(id); if (r.id != null) L.conns.set('tcp' + r.id, { kind: 'tcp', host: 'client', port: (L.conns.get('tcp' + id) || {}).port, tx: 0, rx: 0, since: Date.now() }); if (r.id != null) note('TCP', 'accept on :' + (L.conns.get('tcp' + id) || {}).port, {}); return r; };
        if (kind === 'tcp') out.tcpListen = (port) => { const r = t.tcpListen(port); if (r.id != null) L.conns.set('tcp' + r.id, { kind: 'tcp', host: 'listen', port, tx: 0, rx: 0, since: Date.now() }); note('TCP', `listen :${port}`, { err: r.err }); return r; };
        out[rd] = (id, n) => { const r = t[rd](id, n), d = r && (r.data || (r instanceof Uint8Array ? r : null)), c = L.conns.get(kind + id); if (d && d.length) { L.rx += d.length; if (c) c.rx += d.length; } return r; };
        out[wr] = (id, a, b, c2) => { const body = kind === 'tcp' ? a : c2, r = t[wr](id, a, b, c2), c = L.conns.get(kind + id); if (body && body.length) { L.tx += body.length; if (c) c.tx += body.length; } return r; };
        out[cl] = (id) => { const c = L.conns.get(kind + id); if (c) { c.closed = true; note(kind.toUpperCase(), `close ${c.host}:${c.port} tx=${c.tx} rx=${c.rx}`, { tx: 0, rx: 0 }); } return t[cl](id); };
      }
      for (const k of ['tnfsList', 'tnfsFile', 'tnfsPut', 'tnfsOp', 'sdList', 'sdFile', 'sdPut', 'sdOp']) {
        out[k] = (...a) => { const r = t[k](...a); const n = r && r.length != null ? r.length : 0; note(k.startsWith('tnfs') ? 'TNFS' : 'SD', k.replace(/^(tnfs|sd)/, '').toLowerCase() + ' ' + a.filter((x) => typeof x === 'string').join(' '), { rx: k.endsWith('File') ? n : 0, tx: k.endsWith('Put') && a[2] ? a[2].length : 0 }); return r; };
      }
      return out;
    },
  };

  // ---------------------------------------------------------------- RAM report
  const W = (m, a) => m[a] | (m[a + 1] << 8);
  let prev = null;
  function ram() {
    const emu = getEmu(); if (!emu) throw new Error('boot first');
    const m = emu.mem(), cur = new Uint8Array(m.subarray(0, 65536));
    const sys = { RAMTOP: m[0x6A] << 8, MEMLO: W(m, 0x2E7), MEMTOP: W(m, 0x2E5), APPMHI: W(m, 0x0E), DOSINI: W(m, 0x0C), DLIST: W(m, 0x230), SAVMSC: W(m, 0x58), CHBAS: m[0x2F4] << 8, RAMSIZ: m[0x2E4] << 8, RUNAD: W(m, 0x2E0), INITAD: W(m, 0x2E2), BASLO: W(m, 0x80), BASTOP: W(m, 0x90) };
    const pages = [];
    for (let p = 0; p < 256; p++) {
      let nz = 0, ch = 0;
      for (let i = p << 8, e = i + 256; i < e; i++) { if (cur[i]) nz++; if (prev && prev[i] !== cur[i]) ch++; }
      pages.push({ page: p, nonzero: nz, changed: ch });
    }
    const label = (p) => { const a = p << 8; if (p === 0) return 'zero page'; if (p === 1) return 'stack'; if (p < 6) return 'OS variables'; if (a === (sys.CHBAS & 0xFF00) && sys.CHBAS) return 'charset'; if (a >= (sys.DLIST & 0xFF00) && a <= sys.DLIST && sys.DLIST) return 'display list'; if (a >= (sys.SAVMSC & 0xFF00) && a < sys.SAVMSC + 0x1000 && sys.SAVMSC) return 'screen'; if (a >= 0xD000 && a < 0xD800) return 'hardware'; if (a >= 0xC000) return 'OS ROM'; if (a >= 0xA000 && a < 0xC000) return 'BASIC/cart'; return ''; };
    pages.forEach((x) => { x.label = label(x.page); });
    prev = cur;
    const freeLo = sys.MEMLO, freeHi = sys.MEMTOP, free = freeHi >= freeLo ? freeHi - freeLo + 1 : 0;
    const zp = []; for (let i = 0; i < 256; i++) if (cur[i]) zp.push(i);
    return { sys, free, freeRange: [freeLo, freeHi], loaded: AC.Inspect.lastLoad, pages, zeroPageUsed: zp.length };
  }
  function ramText(r) {
    const s = r.sys, L = [];
    L.push(`MEMLO  $${hex(s.MEMLO, 4)}   MEMTOP $${hex(s.MEMTOP, 4)}   free ${r.free} bytes`);
    L.push(`RAMTOP $${hex(s.RAMTOP, 4)}   APPMHI $${hex(s.APPMHI, 4)}   RAMSIZ $${hex(s.RAMSIZ, 4)}`);
    L.push(`DLIST  $${hex(s.DLIST, 4)}   SAVMSC $${hex(s.SAVMSC, 4)}   CHBAS  $${hex(s.CHBAS, 4)}`);
    L.push(`RUNAD  $${hex(s.RUNAD, 4)}   INITAD $${hex(s.INITAD, 4)}   zero page bytes used ${r.zeroPageUsed}/256`);
    if (r.loaded) L.push('Last load: ' + r.loaded.name + '  ' + r.loaded.segs.map((x) => `$${hex(x[0], 4)}-$${hex(x[1], 4)}`).join(' '));
    return L.join('\n');
  }

  // XEX segment parser for "what did this program load, and where".
  function segs(b) {
    const out = []; let i = 0;
    while (i + 1 < b.length) {
      if (b[i] === 0xFF && b[i + 1] === 0xFF) { i += 2; continue; }
      if (i + 3 >= b.length) break;
      const a = b[i] | (b[i + 1] << 8), e = b[i + 2] | (b[i + 3] << 8);
      if (e < a) break; out.push([a, e]); i += 4 + (e - a + 1);
    }
    return out;
  }

  // ---------------------------------------------------------------- injection helpers
  const bytesOf = (v) => (v instanceof Uint8Array ? v : typeof v === 'string' ? unb64(v) : Uint8Array.from(v));
  const Inspect = {
    lastLoad: null,
    attach(fn) { getEmu = fn; },
    ram, ramText, segs, hex,
    net: () => ({ summary: NetLog.summary(), events: NetLog.events.slice(-200), conns: [...NetLog.conns.values()].map((c) => Object.assign({}, c)) }),
    ip: () => Object.assign({}, NetLog.cfg),
    setIp: (o) => NetLog.setIp(o || {}),
    mock: (p, s, b, h) => NetLog.mock(p, s, b, h), unmock: (i) => NetLog.unmock(i),
    resetNet: () => NetLog.reset(),
    dump(addr, len) { const emu = getEmu(); if (!emu) throw new Error('boot first'); return b64(Uint8Array.from(emu.peek(addr, len || 256))); },
    find(pattern, from, to) { // hex string like "A9 00" or plain text; returns up to 64 addresses
      const emu = getEmu(); if (!emu) throw new Error('boot first');
      const m = emu.mem(), pat = /^[0-9a-f\s]+$/i.test(pattern) && /\s|^[0-9a-f]{2}$/i.test(pattern.trim()) ? pattern.trim().split(/\s+/).map((x) => parseInt(x, 16)) : Array.from(pattern, (c) => c.charCodeAt(0));
      const out = []; for (let a = from | 0; a <= (to == null ? 0xFFFF : to) - pat.length + 1 && out.length < 64; a++) { let k = 0; while (k < pat.length && m[a + k] === pat[k]) k++; if (k === pat.length) out.push(a); } return out;
    },
    fill(addr, len, v) { const emu = getEmu(); if (!emu) throw new Error('boot first'); emu.poke(addr, new Uint8Array(len).fill(v & 255)); return len; },
    load(name, data) { const b = bytesOf(data); Inspect.lastLoad = { name, segs: segs(b) }; return getEmu().bootFile(name, b); },
    poke(addr, data) { getEmu().poke(addr, bytesOf(data)); return bytesOf(data).length; },
    state() { const emu = getEmu(); return { booted: !!emu, ram: emu ? ramText(ram()) : '', net: NetLog.summary(), ip: NetLog.cfg }; },
  };
  AC.NetLog = NetLog; AC.Inspect = Inspect;

  // ---------------------------------------------------------------- panel
  let win = null, timer = 0;
  const el = (t, css, txt) => { const e = document.createElement(t); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; return e; };
  function open() {
    if (win) { win.style.display = 'flex'; return; }
    win = el('div', 'position:fixed;top:60px;right:20px;width:640px;max-height:86vh;overflow:auto;z-index:50;background:#14171d;color:#dfe3ea;border:1px solid #3a4150;border-radius:8px;display:flex;flex-direction:column;font:12px system-ui,sans-serif;box-shadow:0 8px 30px #000a');
    const bar = el('div', 'display:flex;gap:6px;align-items:center;padding:6px 8px;border-bottom:1px solid #2a2f39;cursor:move;flex-wrap:wrap');
    const btn = (t, f, tip) => { const b = el('button', 'padding:3px 8px', t); if (tip) b.title = tip; b.onclick = f; return b; };
    const body = el('div', 'padding:8px;display:flex;flex-direction:column;gap:8px'), tabs = {};
    const show = (k) => { for (const n in tabs) { tabs[n].box.style.display = n === k ? '' : 'none'; tabs[n].btn.style.opacity = n === k ? 1 : .6; } localStorage.setItem('ac.inspect.tab', k); refresh(); };
    const mk = (k, label) => { const box = el('div', 'display:flex;flex-direction:column;gap:6px'), b = btn(label, () => show(k)); tabs[k] = { box, btn: b }; bar.append(b); body.append(box); return box; };
    bar.append(el('b', '', 'INSPECT'));
    const ramBox = mk('ram', 'RAM'), netBox = mk('net', 'Network'), ipBox = mk('ip', 'IP'), injBox = mk('inj', 'Inject'), remBox = mk('rem', 'Remote');
    bar.append(el('span', 'flex:1'), btn('X', () => { win.style.display = 'none'; }));

    // RAM
    const cv = el('canvas'); cv.width = 512; cv.height = 256; cv.style.cssText = 'width:512px;height:256px;image-rendering:pixelated;background:#000;align-self:center'; const ramInfo = el('pre', 'margin:0;font:12px Consolas,monospace;white-space:pre-wrap'), tip = el('div', 'color:#8a93a3', 'Each cell is a 256-byte page ($00 top-left, 16 per row). Brightness = non-zero bytes, red = changed since the last refresh.');
    cv.onmousemove = (e) => { const r = cv.getBoundingClientRect(), p = (((e.clientY - r.top) / r.height * 16) | 0) * 16 + (((e.clientX - r.left) / r.width * 16) | 0); const x = lastRam && lastRam.pages[p]; if (x) tip.textContent = `Page $${hex(p, 2)}00  ${x.label}  ${x.nonzero}/256 non-zero, ${x.changed} changed`; };
    ramBox.append(cv, ramInfo, tip);
    let lastRam = null;
    // Network
    const netInfo = el('pre', 'margin:0;font:12px Consolas,monospace;white-space:pre-wrap'), netLog = el('pre', 'margin:0;font:11px Consolas,monospace;white-space:pre;overflow:auto;max-height:300px;background:#0c0e12;padding:6px;border-radius:4px');
    netBox.append(el('div', 'display:flex;gap:6px', ''), netInfo, netLog); netBox.firstChild.append(btn('Clear', () => { NetLog.reset(); refresh(); }));
    // IP
    const fields = {}, ipMsg = el('div', 'color:#8a93a3');
    const grid = el('div', 'display:grid;grid-template-columns:110px 1fr;gap:4px 8px;align-items:center');
    for (const [k, l] of [['ssid', 'Network name'], ['hostname', 'Hostname'], ['ip', 'IP address'], ['mask', 'Netmask'], ['gw', 'Gateway'], ['dns', 'DNS'], ['mac', 'MAC'], ['bssid', 'BSSID']]) { const i = el('input', 'background:#0c0e12;color:#dfe3ea;border:1px solid #2a2f39;border-radius:4px;padding:3px 6px'); fields[k] = i; grid.append(el('label', '', l), i); }
    const dh = el('input'); dh.type = 'checkbox'; fields.dhcp = dh; grid.append(el('label', '', 'DHCP lease'), dh);
    const fillIp = () => { for (const k in fields) if (k === 'dhcp') fields[k].checked = NetLog.cfg.dhcp; else fields[k].value = NetLog.cfg[k]; };
    const apply = () => { try { const o = {}; for (const k in fields) o[k] = k === 'dhcp' ? fields[k].checked : fields[k].value; NetLog.setIp(o); ipMsg.textContent = 'Applied. The Atari sees this the next time it reads the adapter config (FujiNet command $E8, or IPCONFIG).'; } catch (e) { ipMsg.textContent = 'Error: ' + e.message; } };
    const fromPc = async () => { try { const base = localStorage.getItem('ac.tnfsbridge') || 'http://127.0.0.1:8765', r = await (await fetch(base + '/ctl/info', { method: 'POST', headers: { 'X-AC-Token': localStorage.getItem('ac.nettoken') || '' } })).json(); const a = r.interfaces && r.interfaces[0]; if (!a) throw new Error('no interface'); fields.ip.value = a.address; fields.mask.value = a.netmask; fields.gw.value = a.gateway || fields.gw.value; fields.mac.value = a.mac || fields.mac.value; fields.dhcp.checked = true; apply(); } catch (e) { ipMsg.textContent = 'Needs the relay: ' + e.message; } };
    ipBox.append(grid, el('div', 'display:flex;gap:6px', ''), ipMsg); ipBox.children[1].append(btn('Apply', apply), btn('Use this PC\'s address (relay)', fromPc, 'Copies the PC\'s first non-loopback IPv4 settings from the relay'), btn('Reset', () => { NetLog.setIp({ ip: '127.0.0.1', gw: '127.0.0.1', mask: '255.0.0.0', dns: '8.8.8.8', dhcp: false }); fillIp(); }));
    // Inject
    const inp = (ph, w) => { const i = el('input', `background:#0c0e12;color:#dfe3ea;border:1px solid #2a2f39;border-radius:4px;padding:3px 6px;${w ? 'width:' + w : ''}`); i.placeholder = ph; return i; }, say = el('div', 'color:#8a93a3;white-space:pre-wrap');
    const guard = (f) => async () => { try { say.textContent = String(await f()); } catch (e) { say.textContent = 'Error: ' + e.message; } };
    const pAddr = inp('address (hex)', '90px'), pBytes = inp('bytes (hex, spaces)', '260px'), pLen = inp('length', '60px');
    const rowA = el('div', 'display:flex;gap:6px;flex-wrap:wrap;align-items:center'); rowA.append(pAddr, pBytes, btn('Poke', guard(() => { const a = parseInt(pAddr.value, 16), d = pBytes.value.trim().split(/\s+/).map((x) => parseInt(x, 16)); if (isNaN(a) || d.some(isNaN)) throw new Error('bad hex'); return `Wrote ${Inspect.poke(a, d)} byte(s) at $${hex(a, 4)}`; })), pLen,
      btn('Dump', guard(() => { const a = parseInt(pAddr.value, 16), n = +pLen.value || 64, d = unb64(Inspect.dump(a, n)); let s = ''; for (let i = 0; i < d.length; i += 16) s += `$${hex(a + i, 4)}  ${[...d.subarray(i, i + 16)].map((x) => hex(x, 2)).join(' ')}\n`; return s; })));
    const pFind = inp('find (hex bytes or text)', '200px'); const rowF = el('div', 'display:flex;gap:6px'); rowF.append(pFind, btn('Find', guard(() => 'Found at: ' + (Inspect.find(pFind.value, 0, 0xFFFF).map((a) => '$' + hex(a, 4)).join(' ') || 'nowhere'))));
    const fi = el('input'); fi.type = 'file'; fi.style.display = 'none'; fi.onchange = guard(async () => { const f = fi.files[0]; if (!f) return ''; const b = new Uint8Array(await f.arrayBuffer()); fi.value = ''; Inspect.load(f.name, b); return `Booted ${f.name} (${b.length} bytes), segments: ${Inspect.lastLoad.segs.map((x) => `$${hex(x[0], 4)}-$${hex(x[1], 4)}`).join(' ') || 'n/a'}`; });
    const typ = inp('type text into the Atari', '260px'); const rowT = el('div', 'display:flex;gap:6px'); rowT.append(btn('Run a .COM/.XEX…', () => fi.click()), typ, btn('Type', guard(() => { AC.InspectHost.type(typ.value); return 'Typed.'; })));
    const mP = inp('URL contains…', '200px'), mS = inp('status', '60px'), mB = inp('reply body text', '240px'); mS.value = '200'; const rowM = el('div', 'display:flex;gap:6px;flex-wrap:wrap'); rowM.append(mP, mS, mB, btn('Add fake reply', guard(() => { if (!mP.value) throw new Error('enter part of a URL'); NetLog.mock(mP.value, +mS.value || 200, mB.value); return 'The Atari now gets that reply for N:HTTP requests whose URL contains "' + mP.value + '".'; })), btn('Remove all', guard(() => { NetLog.unmock(); return 'Fake replies removed.'; })));
    injBox.append(el('b', '', 'Memory'), rowA, rowF, el('b', '', 'Programs and keys'), rowT, el('b', '', 'Network replies (injected into the N: device)'), rowM, say, fi);
    // Remote
    const remInfo = el('div', 'white-space:pre-wrap;color:#8a93a3'), rurl = inp('relay address', '240px'); rurl.value = localStorage.getItem('ac.tnfsbridge') || 'http://127.0.0.1:8765';
    remBox.append(el('div', '', 'Lets scripts outside the browser read and drive this emulator through the local relay (token protected, local only).'), el('div', 'display:flex;gap:6px'), remInfo, el('pre', 'margin:0;font:11px Consolas,monospace;color:#aab', 'node tools/ctl.cjs state\nnode tools/ctl.cjs peek 0600 32\nnode tools/ctl.cjs poke 0600 A9 01 60\nnode tools/ctl.cjs run GAME.XEX\nnode tools/ctl.cjs net | ip | ram | type "PRINT 1"'));
    remBox.children[1].append(rurl, btn('Connect', () => { localStorage.setItem('ac.tnfsbridge', rurl.value); AC.Remote.connect(rurl.value); refresh(); }), btn('Disconnect', () => { AC.Remote.stop(); refresh(); }));

    function refresh() {
      const k = localStorage.getItem('ac.inspect.tab') || 'ram';
      if (k === 'ram') {
        try {
          const r = lastRam = ram(), g = cv.getContext('2d'), im = g.createImageData(512, 256);
          r.pages.forEach((p, i) => { const x0 = (i & 15) * 32, y0 = (i >> 4) * 16, v = Math.min(255, 40 + p.nonzero), hot = p.changed > 0; for (let y = 0; y < 15; y++) for (let x = 0; x < 31; x++) { const o = ((y0 + y) * 512 + x0 + x) * 4; im.data[o] = hot ? 255 : p.nonzero ? v / 3 : 18; im.data[o + 1] = hot ? 90 : p.nonzero ? v : 18; im.data[o + 2] = hot ? 60 : p.nonzero ? v / 2 : 22; im.data[o + 3] = 255; } });
          g.putImageData(im, 0, 0); ramInfo.textContent = ramText(r);
        } catch (e) { ramInfo.textContent = 'Boot the emulator first.'; }
      } else if (k === 'net') {
        const s = NetLog.summary(); netInfo.textContent = `calls ${s.calls}   errors ${s.errors}   sent ${s.tx} B   received ${s.rx} B   open sockets ${s.open}   fake replies ${s.mocks.length}`;
        const rows = NetLog.events.slice(-80).map((e) => `${new Date(e.t).toLocaleTimeString()} ${e.kind.padEnd(5)} ${(e.status || (e.err ? 'E' + e.err : '')).toString().padEnd(4)} ${String(e.rx || '').padStart(6)} ${String(e.ms != null ? e.ms + 'ms' : '').padStart(6)}  ${e.desc}`);
        netLog.textContent = rows.length ? rows.join('\n') : 'No network activity yet (enable FujiNet and use N: from the Atari).';
      } else if (k === 'ip') fillIp();
      else if (k === 'rem') remInfo.textContent = AC.Remote.status();
    }
    let dx = 0, dy = 0, drag = false;
    bar.onmousedown = (e) => { if (e.target !== bar) return; drag = true; const r = win.getBoundingClientRect(); dx = e.clientX - r.left; dy = e.clientY - r.top; };
    window.addEventListener('mousemove', (e) => { if (drag) { win.style.left = e.clientX - dx + 'px'; win.style.top = e.clientY - dy + 'px'; win.style.right = 'auto'; } });
    window.addEventListener('mouseup', () => { drag = false; });
    win.append(bar, body); document.body.append(win);
    show(localStorage.getItem('ac.inspect.tab') || 'ram');
    timer = setInterval(() => { if (win.style.display !== 'none') refresh(); }, 600);
  }

  // ---------------------------------------------------------------- remote control (page side): long-polls the relay for commands
  const Remote = (() => {
    let on = false, base = '', n = 0, last = '', ctl = null;
    const tok = () => localStorage.getItem('ac.nettoken') || '';
    const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'X-AC-Token': tok() }, body: body == null ? null : JSON.stringify(body), signal: ctl && ctl.signal });
    const ALLOW = { state: () => window.ataricraft.state(), describe: () => window.ataricraft.describe(), peek: (a, l) => window.ataricraft.peek(a, l), poke: (a, d) => Inspect.poke(a, d), dump: (a, l) => Inspect.dump(a, l), find: (p, f, t) => Inspect.find(p, f, t), fill: (a, l, v) => Inspect.fill(a, l, v),
      ram: () => { const r = ram(); return Object.assign({}, r, { text: ramText(r) }); }, net: () => Inspect.net(), ip: () => Inspect.ip(), setIp: (o) => Inspect.setIp(o), mock: (p, s, b) => Inspect.mock(p, s, b), unmock: (i) => Inspect.unmock(i), resetNet: () => Inspect.resetNet(),
      load: (name, d) => Inspect.load(name, d), mountDisk: (d, name, data) => window.ataricraft.mountDisk(d, name, bytesOf(data)), type: (t) => window.ataricraft.type(t), press: (f, fr) => window.ataricraft.press(f, fr), screenText: () => window.ataricraft.screenText(),
      screenshot: async (o) => window.ataricraft.screenshot(o), reset: (c) => window.ataricraft.reset(c), pause: () => window.ataricraft.pause(), run: () => window.ataricraft.run(), step: (nf) => window.ataricraft.step(nf), speed: (x) => window.ataricraft.speed(x) };
    async function loop() {
      while (on) {
        try {
          const r = await post('/ctl/poll'); if (r.status === 403) { last = 'token refused'; on = false; break; }
          if (r.status === 204) { last = 'connected'; continue; }
          const c = await r.json(); n++; let res;
          try { if (!ALLOW[c.method]) throw new Error('unknown method ' + c.method); const v = await ALLOW[c.method](...(c.args || [])); res = { id: c.id, ok: true, result: v instanceof Uint8Array ? { b64: b64(v) } : v === undefined ? null : v }; } catch (e) { res = { id: c.id, ok: false, error: String(e && e.message || e) }; }
          await post('/ctl/result', res);
        } catch (e) { if (!on) break; last = 'relay unreachable'; await new Promise((s) => setTimeout(s, 2000)); }
      }
    }
    return {
      connect(url) { if (on) return; base = String(url || localStorage.getItem('ac.tnfsbridge') || '').replace(/\/$/, ''); if (!base) return; on = true; ctl = new AbortController(); last = 'connecting'; loop(); },
      stop() { on = false; if (ctl) ctl.abort(); last = 'stopped'; },
      status: () => `${on ? 'ON' : 'off'}  ${last}  commands served: ${n}`, methods: () => Object.keys(ALLOW),
    };
  })();
  if (/^https?:/.test(location.protocol) && localStorage.getItem('ac.tnfsbridge') === location.origin) setTimeout(() => Remote.connect(location.origin), 1500);
  AC.Remote = Remote; AC.InspectHost = { type: (t) => window.ataricraft.type(t) };
  AC.InspectPanel = { open };
})();
