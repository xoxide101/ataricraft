/* Tools-side half of the Craft Tools link (docs/TOOLSHUB.md). Finds the emulator tab (js/toolshub-host.js) over the BroadcastChannel
   'ataricraft-tools' and gives the BASIC / ASM / FONT panels the same host object they had inside the emulator page:
   AC.BasicHost.emu() -> {peek, poke, bootFile} and AC.BasicHost.romFont().
   When this tab was opened by the emulator (or opened it) the same-origin window is used directly, so peek is exact and synchronous.
   Otherwise peek reads a 64 KB mirror that refreshes about 3 times a second while a panel is using it; poke and bootFile go over the channel. */
(function () {
  const AC = (window.AC = window.AC || {});
  const subs = [];
  let peer = null, nid = 1, emuWin = null, mirror = null, wantUntil = 0, mt = 0, inflight = false, romFont = null, romAsked = null;
  const pending = new Map();
  const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ataricraft-tools') : null;
  const emit = () => subs.forEach((f) => { try { f(status()); } catch (e) { /* listener error */ } });
  const status = () => ({ connected: !!peer, id: peer && peer.id, info: peer && peer.info, direct: !!direct() });
  const post = (m) => { if (ch) ch.postMessage(m); };

  function direct() {
    if (!peer) return null;
    for (const w of [emuWin, window.opener]) {
      try { const a = w && !w.closed && w.ataricraft; if (a && a.toolsId === peer.id) return a; } catch (e) { /* cross-origin opener */ }
    }
    return null;
  }

  if (ch) {
    ch.onmessage = (e) => {
      const d = e.data || {};
      if (d.t === 'ready') {
        const fresh = !peer || peer.id !== d.from;
        if (!peer || peer.id === d.from || Date.now() - peer.seen > 8000) { const was = peer && peer.info; peer = { id: d.from, info: d.info, seen: Date.now() }; if (fresh || !was || was.booted !== d.info.booted) { if (fresh) { mirror = null; romFont = null; romAsked = null; setTimeout(() => AC.BasicHost.romFont(), 0); } emit(); } }
      } else if (d.t === 'bye') { if (peer && peer.id === d.from) { peer = null; mirror = null; emit(); } }
      else if (d.t === 'res' && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); clearTimeout(p.timer); if (d.ok) p.res(d.val); else p.rej(new Error(d.err)); }
    };
    setInterval(() => { if (peer && Date.now() - peer.seen > 8000) { peer = null; mirror = null; emit(); } if (!peer) post({ t: 'hello' }); }, 1500);
    post({ t: 'hello' });
  }

  function call(op, args, ms) {
    return new Promise((res, rej) => {
      if (!ch) return rej(new Error('BroadcastChannel is not available in this browser'));
      if (!peer) return rej(new Error('The emulator is not connected. Open it with the Emulator button.'));
      const id = nid++;
      const timer = setTimeout(() => { pending.delete(id); rej(new Error('The emulator did not answer (' + op + ')')); }, ms || 20000);
      pending.set(id, { res, rej, timer });
      post({ t: 'req', id, to: peer.id, op, args: args || {} });
    });
  }

  async function refresh() {
    if (inflight || !peer || !peer.info.booted) return;
    inflight = true;
    try { mirror = await call('mem', {}, 5000); } catch (e) { /* retry on the next tick */ } finally { inflight = false; }
  }
  function wantMirror() {
    wantUntil = Date.now() + 15000;
    if (!mt) mt = setInterval(() => { if (Date.now() > wantUntil) { clearInterval(mt); mt = 0; } else refresh(); }, 350);
    if (!mirror) refresh();
  }

  function emu() {
    if (!peer || !peer.info.booted) return null;
    const a = direct();
    if (a) return { direct: true, peek: (ad, l) => a.peek(ad, l), poke: (ad, b) => a.poke(ad, b), bootFile: (n, b) => a.bootFile(n, b) };
    wantMirror();
    if (!mirror) return null;
    return {
      direct: false,
      peek: (ad, l) => mirror.slice(ad, ad + (l == null ? 1 : l)),
      poke: (ad, b) => { const u = Uint8Array.from(b); if (mirror) mirror.set(u.subarray(0, Math.max(0, mirror.length - ad)), ad); call('poke', { addr: ad, bytes: u }).catch(() => {}); },
      bootFile: (n, b) => call('bootFile', { name: n, bytes: Uint8Array.from(b) }),
    };
  }

  AC.BasicHost = {
    emu,
    romFont: () => { if (!romAsked && peer) romAsked = call('romFont', {}, 5000).then((f) => { romFont = f; }, () => {}); return romFont; },
  };
  AC.ToolsLink = {
    call, emu, status, wantMirror,
    onChange: (f) => { subs.push(f); },
    openEmulator() { emuWin = window.open('index.html', 'ataricraft-emulator'); return emuWin; },
    connected: () => !!peer,
  };
})();
