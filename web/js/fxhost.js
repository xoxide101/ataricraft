/* Emulator-side half of the FujiNet Explorer link (docs/TRANSPORT.md). Answers the explorer tab over a BroadcastChannel,
   so the explorer can mount/swap disks, read the printer, and view or change FujiNet and network settings without
   the user touching this page. Handlers are plain functions: AC.FxHost.handle(op, args, body) also works in-process. */
(function () {
  const AC = (window.AC = window.AC || {});
  if (!AC.Transport) return;
  const emu = () => window.ataricraft;
  const need = (n) => { const d = +n; if (!(d >= 1 && d <= 8)) throw Object.assign(new Error('drive must be 1-8'), { name: 'BadArg' }); return d; };
  const booted = () => { try { return !!emu().state().booted; } catch (e) { return false; } };
  const mustBoot = () => { if (!booted()) throw Object.assign(new Error('the emulator is not booted: press Boot on the Ataricraft page'), { name: 'NotReady' }); };

  const handlers = {
    'emu.ping': () => ({ protocol: AC.Transport.PROTOCOL, booted: booted(), fujinet: !!(window.FujiNet && FujiNet.enabled), version: emu() ? emu().version : '', origin: location.origin }),
    'emu.disks': () => ({ disks: emu().fxDisks() }),
    'emu.mount': (a, body) => { mustBoot(); const n = need(a.drive); if (!body || !body.length) throw new Error('no disk data'); if (!emu().fxMount(n, a.name || 'disk.atr', body)) throw new Error('the emulator could not mount ' + (a.name || 'the image')); return { drive: n, disks: emu().fxDisks() }; },
    'emu.eject': (a) => { mustBoot(); emu().fxEject(need(a.drive)); return { disks: emu().fxDisks() }; },
    'emu.swap': (a) => { mustBoot(); emu().fxMove(need(a.from), need(a.to)); return { disks: emu().fxDisks() }; },
    'emu.disk.read': (a) => { mustBoot(); const b = emu().readDisk(need(a.drive)); if (!b) throw Object.assign(new Error('D' + a.drive + ' is empty'), { name: 'NotFound' }); return { meta: { drive: +a.drive }, body: b }; },
    'emu.boot': (a, body) => { mustBoot(); emu().bootFile(a.name || 'prog.xex', body); return { booted: true }; },
    'emu.printer': () => { const P = window.Printer; if (!P) throw Object.assign(new Error('printer not available'), { name: 'Unsupported' }); return { count: P.lines.length, lines: P.lines.map((l) => ({ text: P.asText(l.b), mode: l.m })), text: P.text() }; },
    'emu.printer.clear': () => { if (window.Printer) Printer.clear(); return {}; },
    'emu.fujinet.get': () => { const F = window.FujiNet; if (!F) throw Object.assign(new Error('FujiNet not available'), { name: 'Unsupported' }); return { enabled: !!F.enabled, bridge: F.bridge || localStorage.getItem('ac.tnfsbridge') || '', hosts: F.hosts.slice(), slots: F.slots.map((s, i) => ({ slot: i + 1, host: s.host, mode: s.mode, path: s.path, mounted: !!s.mounted })) }; },
    'emu.fujinet.set': (a) => {
      const F = window.FujiNet; if (!F) throw Object.assign(new Error('FujiNet not available'), { name: 'Unsupported' });
      if (Array.isArray(a.hosts)) a.hosts.forEach((h, i) => { if (i > 0 && i < F.hosts.length) F.hosts[i] = String(h).slice(0, 31); });
      if (Array.isArray(a.slots)) a.slots.forEach((s, i) => { if (i < F.slots.length && s) F.slots[i] = Object.assign(F.slots[i], { host: s.host == null ? F.slots[i].host : s.host, mode: s.mode == null ? F.slots[i].mode : s.mode, path: s.path == null ? F.slots[i].path : String(s.path) }); });
      if (typeof a.enabled === 'boolean') F.enabled = a.enabled;
      F.save(); return handlers['emu.fujinet.get']();
    },
    'emu.net.get': () => ({ ip: emu().inspect.ip() }),
    'emu.net.set': (a) => { emu().inspect.setIp(a.ip || {}); return { ip: emu().inspect.ip() }; },
    'emu.time': () => { const d = new Date(); return { now: d.getTime(), iso: d.toISOString(), tzOffset: d.getTimezoneOffset(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone }; },
    'emu.screenshot': async () => ({ png: await emu().screenshot({ scale: 1 }) }),
  };

  const srv = AC.Transport.serve(handlers);
  AC.FxHost = { handle: srv.handle, handlers };
  srv.announce({ op: 'emu.hello' });
})();
