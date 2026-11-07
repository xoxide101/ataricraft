/* ACNet service core: one socket/ring-buffer state machine shared by every transport.
   - Memory-mapped register window (emulator-native PBI/ECI-style device): regRead/regWrite on offsets 0..31.
   - SIO device $65 command set (real Atari over a USB-SIO/serial bridge, or the emulator's SIO hook): sio().
   The core never touches a network itself: it talks to a backend through messages (see docs/ACNET.md, "Backend messages").
   Runs unchanged in the browser and in node. */
(function (root) {
  'use strict';
  const NSOCK = 16, RXCAP = 4096, TXCAP = 2048, UDPMAX = 1024, UDPQ = 8;
  const CMD = { ALLOC: 1, CONNECT: 2, LISTEN: 3, ACCEPT: 4, CLOSE: 5, UDP_OPEN: 6, FLUSH: 7, UDP_PEER: 8, DNS: 9, PEERINFO: 10, NETINFO: 11, PING: 12, RESET: 13, DROP: 16, SHUTDOWN: 17 };
  const ERR = { OK: 0, BADCMD: 1, BADSOCK: 2, NOSOCK: 3, NOLINK: 4, BADSTATE: 5, WOULDBLOCK: 6, BADARG: 7, TXFULL: 8, INUSE: 9 };
  const SERR = { NONE: 0, REFUSED: 1, RESET: 2, TIMEOUT: 3, DNS: 4, NOLINK: 5, OTHER: 6, NXDOMAIN: 7 };
  const EV = { RX: 1, EOF: 2, ACCEPT: 4, CONN: 8, ERR: 16, TX: 32, LINK: 64 };
  const SS = { OPEN: 1, RX: 2, TX: 4, EOF: 8, ERR: 16, CONNECTING: 32, LISTEN: 64, ACCEPT: 128 };
  const SIO = { DEV: 0x65, STATUS: 0x53, EXEC: 0xc0, READ: 0xc1, WRITE: 0xc2, EVACK: 0xc3 };
  const errCode = { refused: SERR.REFUSED, reset: SERR.RESET, timeout: SERR.TIMEOUT, 'no link': SERR.NOLINK, NXDOMAIN: SERR.NXDOMAIN, dns: SERR.DNS, other: SERR.OTHER };

  function newSock() {
    return { st: 'free', kind: '', rx: new Uint8Array(RXCAP), rh: 0, rn: 0, dq: [], tx: new Uint8Array(TXCAP), tn: 0, inflight: 0, ev: 0, serr: 0, eof: false,
      aq: [], peer: null, local: 0, txBlocked: false, rip: null, rport: 0 };
  }

  function create(opts) {
    opts = opts || {};
    const S = Array.from({ length: NSOCK }, newSock);
    S[0].st = 'ctl';
    const core = {
      backend: null, bridge: false, link: { up: false, mac: [0, 0, 0, 0, 0, 0], ip: [0, 0, 0, 0], mask: [0, 0, 0, 0], gw: [0, 0, 0, 0], dns: [] },
      result: 0, sock: 0, args: new Uint8Array(8), irqen: 0, onIrq: null, irqLevel: 0, dnsPending: false, creditDebt: new Array(NSOCK).fill(0),
      S, CMD, ERR, SERR, EV, SS, SIO, RXCAP, TXCAP, NSOCK, log: opts.log || (() => {}),
    };

    const send = (m) => { if (core.backend && core.bridge) core.backend(m); };
    const sk = (h) => (h >= 0 && h < NSOCK ? S[h] : null);
    const ready = () => core.bridge && core.link.up;
    const txFree = (s) => (s.kind === 'udp' ? UDPMAX - s.tn : Math.max(0, TXCAP - s.tn - s.inflight));
    const rxLen = (s) => (s.kind === 'udp' ? (s.dq.length ? s.dq[0].data.length - s.dq[0].off : 0) : s.rn);

    function raise(s, bits) { s.ev |= bits; updateIrq(); }
    function anyEv() { for (let i = 0; i < NSOCK; i++) if (S[i].ev && S[i].st !== 'free') return true; return false; }
    function updateIrq() {
      const lvl = core.irqen & 1 && anyEv() ? 1 : 0;
      if (lvl !== core.irqLevel) { core.irqLevel = lvl; if (core.onIrq) core.onIrq(lvl); }
    }
    core.updateIrq = updateIrq;

    function sstat(s) {
      let v = 0;
      if (s.st === 'open' || s.st === 'listen') v |= SS.OPEN;
      if (s.st === 'connecting') v |= SS.CONNECTING;
      if (s.st === 'listen') v |= SS.LISTEN;
      if (s.aq.length) v |= SS.ACCEPT;
      if (rxLen(s) > 0) v |= SS.RX;
      if (s.st === 'open' && txFree(s) > 0) v |= SS.TX;
      if (s.eof) v |= SS.EOF;
      if (s.serr) v |= SS.ERR;
      return v;
    }

    function flush(s, h) {
      if (!s.tn || s.kind !== 'tcp' || s.st !== 'open') return;
      const data = s.tx.slice(0, s.tn);
      s.inflight += s.tn; s.tn = 0;
      send({ op: 'send', h, data });
    }
    core.tick = function () { for (let h = 1; h < NSOCK; h++) flush(S[h], h); };

    function release(h) {
      const s = S[h];
      for (const a of s.aq) { send({ op: 'close', h: a.h }); resetSock(a.h); }
      send({ op: 'close', h });
      resetSock(h);
    }
    function resetSock(h) { const keep = S[h]; Object.assign(keep, newSock()); updateIrq(); }

    function alloc() { for (let h = 1; h < NSOCK; h++) if (S[h].st === 'free') { S[h].st = 'alloc'; return h; } return 0; }

    function takeTxString(s) {
      let str = '';
      for (let i = 0; i < s.tn; i++) str += String.fromCharCode(s.tx[i]);
      s.tn = 0;
      return str.replace(/[\0\r\n\x9b]+$/, '');
    }
    const portArg = () => core.args[0] | (core.args[1] << 8);

    function setSerr(s, e) { s.serr = typeof e === 'number' ? e : (errCode[e] || SERR.OTHER); }

    function pushRx(s, bytes) {
      let n = Math.min(bytes.length, RXCAP - s.rn);
      for (let i = 0; i < n; i++) s.rx[(s.rh + s.rn + i) % RXCAP] = bytes[i];
      s.rn += n;
      return n;
    }

    // ---- commands ----
    core.command = function (c) {
      let r = ERR.OK;
      const h = core.sock, s = sk(h);
      const needSock = () => (s && s.st !== 'free' ? null : ERR.BADSOCK);
      switch (c) {
        case CMD.ALLOC: { const n = alloc(); if (!n) r = ERR.NOSOCK; else core.sock = n; break; }
        case CMD.CONNECT:
          r = needSock() || (h === 0 ? ERR.BADSOCK : s.st !== 'alloc' ? ERR.BADSTATE : !ready() ? ERR.NOLINK : portArg() === 0 ? ERR.BADARG : 0);
          if (!r) {
            const host = takeTxString(s);
            if (!host) { r = ERR.BADARG; break; }
            s.kind = 'tcp'; s.st = 'connecting';
            send({ op: 'connect', h, host, port: portArg() });
          }
          break;
        case CMD.LISTEN:
          r = needSock() || (h === 0 ? ERR.BADSOCK : s.st !== 'alloc' ? ERR.BADSTATE : !ready() ? ERR.NOLINK : portArg() === 0 ? ERR.BADARG : 0);
          if (!r) {
            if (S.some((x, i) => i && x.st === 'listen' && x.local === portArg())) { r = ERR.INUSE; break; }
            s.kind = 'tcp'; s.st = 'listen'; s.local = portArg(); s.tn = 0;
            send({ op: 'listen', h, port: s.local });
          }
          break;
        case CMD.ACCEPT:
          r = needSock() || (s.st !== 'listen' ? ERR.BADSTATE : 0);
          if (!r) {
            const a = s.aq.shift();
            if (!a) { r = ERR.WOULDBLOCK; break; }
            core.sock = a.h; core.args.set([...a.rip, a.rport & 255, a.rport >> 8]);
            if (!s.aq.length) s.ev &= ~EV.ACCEPT;
            updateIrq();
          }
          break;
        case CMD.CLOSE:
          r = needSock() || (h === 0 ? ERR.BADSOCK : 0);
          if (!r) { flush(s, h); release(h); }
          break;
        case CMD.SHUTDOWN:
          r = needSock() || (s.kind !== 'tcp' || s.st !== 'open' ? ERR.BADSTATE : 0);
          if (!r) { flush(s, h); send({ op: 'shutdown', h }); }
          break;
        case CMD.UDP_OPEN:
          r = needSock() || (h === 0 ? ERR.BADSOCK : s.st !== 'alloc' ? ERR.BADSTATE : !ready() ? ERR.NOLINK : 0);
          if (!r) {
            if (portArg() && S.some((x, i) => i && x.kind === 'udp' && x.st !== 'free' && x.local === portArg())) { r = ERR.INUSE; break; }
            s.kind = 'udp'; s.st = 'connecting'; s.local = portArg(); s.tn = 0;
            send({ op: 'udp', h, port: s.local });
          }
          break;
        case CMD.UDP_PEER:
          r = needSock() || (s.kind !== 'udp' ? ERR.BADSTATE : 0);
          if (!r) s.peer = { ip: [...core.args.subarray(0, 4)], port: core.args[4] | (core.args[5] << 8) };
          break;
        case CMD.FLUSH:
          r = needSock();
          if (r) break;
          if (s.kind === 'udp') {
            if (s.st !== 'open' || !s.peer) { r = ERR.BADSTATE; break; }
            if (!ready()) { r = ERR.NOLINK; break; }
            send({ op: 'send', h, data: s.tx.slice(0, s.tn), host: s.peer.ip.join('.'), port: s.peer.port });
            s.tn = 0;
          } else if (s.kind === 'tcp') flush(s, h); else r = ERR.BADSTATE;
          break;
        case CMD.DNS:
          if (h !== 0) { r = ERR.BADSOCK; break; }
          if (!ready()) { r = ERR.NOLINK; break; }
          if (core.dnsPending) { r = ERR.WOULDBLOCK; break; }
          { const name = takeTxString(s); if (!name) { r = ERR.BADARG; break; } s.rn = 0; s.rh = 0; s.serr = 0; core.dnsPending = true; send({ op: 'dns', h: 0, name }); }
          break;
        case CMD.PING:
          if (h !== 0) { r = ERR.BADSOCK; break; }
          if (!ready()) { r = ERR.NOLINK; break; }
          if (core.dnsPending) { r = ERR.WOULDBLOCK; break; }
          s.rn = 0; s.rh = 0; s.serr = 0; core.dnsPending = true; send({ op: 'ping', h: 0, ip: [...core.args.subarray(0, 4)].join('.') });
          break;
        case CMD.PEERINFO:
          r = needSock();
          if (r) break;
          if (s.kind === 'udp') { const d = s.dq[0]; if (!d) { r = ERR.WOULDBLOCK; break; } core.args.set([...d.ip, d.port & 255, d.port >> 8]); }
          else if (s.rip) core.args.set([...s.rip, s.rport & 255, s.rport >> 8]);
          else r = ERR.BADSTATE;
          break;
        case CMD.NETINFO: {
          if (h !== 0) { r = ERR.BADSOCK; break; }
          const l = core.link, b = [...l.mac, ...l.ip, ...l.mask, ...l.gw, ...(l.dns[0] || [0, 0, 0, 0]), ...(l.dns[1] || [0, 0, 0, 0])];
          s.rn = 0; s.rh = 0; pushRx(s, b);
          break;
        }
        case CMD.DROP:
          r = needSock();
          if (r) break;
          if (s.kind === 'udp') { s.dq.shift(); creditBack(h, 0); } else { creditBack(h, s.rn); s.rn = 0; s.rh = 0; }
          break;
        case CMD.RESET:
          for (let i = 1; i < NSOCK; i++) if (S[i].st !== 'free') release(i);
          core.sock = 0; core.dnsPending = false;
          break;
        default: r = ERR.BADCMD;
      }
      core.result = r || 0;
      core.tick();
      return r;
    };

    function creditBack(h, n) {
      const s = S[h];
      if (s.kind !== 'tcp' || n <= 0) return;
      core.creditDebt[h] += n;
      if (core.creditDebt[h] >= 512 || s.rn === 0) { const c = core.creditDebt[h]; core.creditDebt[h] = 0; send({ op: 'credit', h, n: c }); }
    }

    // ---- data path ----
    core.rxPop = function (h, n) { // returns Uint8Array of up to n bytes
      const s = sk(h);
      if (!s || s.st === 'free') return new Uint8Array(0);
      if (s.kind === 'udp') {
        const d = s.dq[0]; if (!d) return new Uint8Array(0);
        const out = d.data.subarray(d.off, d.off + n); d.off += out.length;
        if (d.off >= d.data.length) { s.dq.shift(); if (s.dq.length) raise(s, EV.RX); }
        return new Uint8Array(out);
      }
      n = Math.min(n, s.rn);
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = s.rx[(s.rh + i) % RXCAP];
      s.rh = (s.rh + n) % RXCAP; s.rn -= n;
      if (h !== 0) creditBack(h, n);
      return out;
    };
    core.txPush = function (h, bytes) {
      const s = sk(h);
      if (!s || s.st === 'free' || s.st === 'listen') { core.result = ERR.BADSOCK; return 0; }
      if (s.st !== 'open' && s.st !== 'alloc' && s.st !== 'ctl') { core.result = ERR.BADSTATE; return 0; }
      const room = h === 0 || s.st === 'alloc' ? TXCAP - s.tn : txFree(s);
      const n = Math.min(room, bytes.length);
      s.tx.set(bytes.subarray ? bytes.subarray(0, n) : bytes.slice(0, n), s.tn); s.tn += n;
      if (n < bytes.length) { core.result = ERR.TXFULL; s.txBlocked = true; } else core.result = ERR.OK;
      if (s.kind === 'tcp' && s.tn >= 1024) flush(s, h);
      return n;
    };

    // ---- status ----
    core.statusFlags = () => (core.link.up && core.bridge ? 0x80 : 0) | (core.irqLevel ? 0x40 : 0) | (core.bridge ? 0x20 : 0) | (anyEv() ? 0x10 : 0);
    core.evMask = () => { let m = 0; for (let i = 0; i < NSOCK; i++) if (S[i].ev && S[i].st !== 'free') m |= 1 << i; return m; };

    // ---- messages from the backend ----
    core.deliver = function (m) {
      const h = m.h, s = sk(h);
      switch (m.op) {
        case 'link': {
          const was = core.link.up;
          core.link = { up: !!m.up, mac: m.mac, ip: m.ip, mask: m.mask, gw: m.gw, dns: m.dns || [] };
          if (was !== core.link.up) raise(S[0], EV.LINK);
          return;
        }
        case 'connected': if (s && s.st === 'connecting') { s.st = 'open'; raise(s, EV.CONN); } return;
        case 'opened': if (s && s.st === 'connecting') { s.st = 'open'; s.local = m.port; raise(s, EV.CONN); } return;
        case 'listening': return;
        case 'data':
          if (!s || s.st === 'free') return;
          if (s.kind === 'udp') {
            if (s.dq.length >= UDPQ) return;
            s.dq.push({ ip: m.ip, port: m.port, data: m.data.subarray(0, UDPMAX * 2), off: 0 });
          } else pushRx(s, m.data);
          raise(s, EV.RX); return;
        case 'sent': if (s && s.st !== 'free') { s.inflight = Math.max(0, s.inflight - m.n); if (s.txBlocked && txFree(s) > 0) { s.txBlocked = false; raise(s, EV.TX); } } return;
        case 'eof': if (s && s.st !== 'free') { s.eof = true; raise(s, EV.EOF); } return;
        case 'closed':
          if (!s || s.st === 'free' || s.st === 'alloc') return;
          if (m.err) { setSerr(s, m.err); if (s.st === 'connecting') s.st = 'dead'; raise(s, EV.ERR | EV.EOF); s.eof = true; } else { s.eof = true; raise(s, EV.EOF); }
          return;
        case 'error': if (s && s.st !== 'free') { setSerr(s, m.err); if (s.st === 'connecting') s.st = 'dead'; raise(s, EV.ERR); } return;
        case 'accepted': {
          const l = s;
          const nh = alloc();
          if (!l || l.st !== 'listen' || !nh || l.aq.length >= 4) { send({ op: 'close', h: m.id }); if (nh) S[nh].st = 'free'; return; }
          const c = S[nh]; c.kind = 'tcp'; c.st = 'open'; c.rip = m.rip; c.rport = m.rport; c.local = l.local;
          l.aq.push({ h: nh, rip: m.rip, rport: m.rport });
          send({ op: 'alias', id: m.id, h: nh });
          raise(l, EV.ACCEPT); return;
        }
        case 'dnsres': case 'pingres': {
          const c = S[0]; core.dnsPending = false;
          if (m.err) { setSerr(c, m.op === 'pingres' ? SERR.TIMEOUT : (errCode[m.err] || SERR.DNS)); raise(c, EV.ERR); }
          else { c.rn = 0; c.rh = 0; pushRx(c, m.op === 'dnsres' ? m.ip : [m.ms >> 8 & 255, m.ms & 255]); raise(c, EV.CONN); }
          return;
        }
        default: core.log('unknown backend op', m.op);
      }
    };

    core.setBridge = function (up) {
      core.bridge = !!up;
      if (!up) {
        core.link.up = false; core.dnsPending = false;
        for (let h = 1; h < NSOCK; h++) { const s = S[h]; if (s.st !== 'free' && s.st !== 'alloc') { s.serr = SERR.NOLINK; s.eof = true; if (s.st === 'connecting' || s.st === 'listen') s.st = 'dead'; s.ev |= EV.ERR | EV.EOF; } }
        S[0].ev |= EV.LINK;
        updateIrq();
      } else send({ op: 'hello' });
    };

    // ---- register window (offsets from $D1A0) ----
    core.regRead = function (o, peek) {
      const s = S[core.sock] || S[0];
      switch (o) {
        case 0: return 0xac;
        case 1: return 0x4e;
        case 2: return 0x10;
        case 3: return core.statusFlags();
        case 4: return core.result;
        case 5: return core.sock;
        case 6: return sstat(s);
        case 7: return s.ev & 255;
        case 8: return rxLen(s) & 255;
        case 9: return (rxLen(s) >> 8) & 255;
        case 10: return txFree(s) & 255;
        case 11: return (txFree(s) >> 8) & 255;
        case 12: { if (peek) return s.kind === 'udp' ? (s.dq[0] ? s.dq[0].data[s.dq[0].off] : 0) : s.rn ? s.rx[s.rh] : 0; const b = core.rxPop(core.sock, 1); return b.length ? b[0] : 0; }
        case 13: return core.irqen;
        case 14: return core.evMask() & 255;
        case 15: return (core.evMask() >> 8) & 255;
        case 24: return s.serr;
        default: return o >= 16 && o < 24 ? core.args[o - 16] : 0;
      }
    };
    core.regWrite = function (o, v) {
      v &= 255;
      const s = S[core.sock] || S[0];
      switch (o) {
        case 4: core.command(v); break;
        case 5: core.sock = v < NSOCK ? v : core.sock; if (v >= NSOCK) core.result = ERR.BADSOCK; break;
        case 7: s.ev &= ~v; updateIrq(); break;
        case 12: core.txPush(core.sock, Uint8Array.of(v)); break;
        case 13: core.irqen = v & 1; updateIrq(); break;
        case 24: s.serr = 0; break;
        default: if (o >= 16 && o < 24) core.args[o - 16] = v;
      }
    };

    // ---- SIO device $65 ----
    // 'S' status (R 32), $C0 exec (W 16: cmd, sock, arg0-7), $C1 read (R 256: len16 + 254 data), $C2 write (W 256), $C3 event ack (aux1 sock, aux2 mask)
    core.sioLen = { [SIO.STATUS]: [1, 32], [SIO.EXEC]: [2, 16], [SIO.READ]: [1, 256], [SIO.WRITE]: [2, 256], [SIO.EVACK]: [0, 0] };
    core.sio = function (cmd, aux1, aux2, data) {
      const s = S[aux1 & 255];
      if (cmd === SIO.STATUS) {
        const t = S[aux1 & 255] || S[0], o = new Uint8Array(32);
        o.set([core.result, aux1 & 255, sstat(t), t.ev & 255, rxLen(t) & 255, (rxLen(t) >> 8) & 255, txFree(t) & 255, (txFree(t) >> 8) & 255, core.statusFlags(),
          core.evMask() & 255, (core.evMask() >> 8) & 255, t.serr, ...core.args], 0);
        o[20] = core.sock;
        return { st: 0x43, data: o };
      }
      if (cmd === SIO.EXEC) {
        if (!data || data.length < 10) return { st: 0x4e };
        core.sock = data[1]; core.args.set(data.subarray(2, 10));
        if (core.sock >= NSOCK) { core.result = ERR.BADSOCK; return { st: 0x43 }; }
        core.command(data[0]);
        return { st: 0x43 };
      }
      if (cmd === SIO.READ) {
        if (!s) return { st: 0x4e };
        const b = core.rxPop(aux1 & 255, aux2 && aux2 < 254 ? aux2 : 254), o = new Uint8Array(256);
        o[0] = b.length & 255; o[1] = b.length >> 8; o.set(b, 2);
        return { st: 0x43, data: o };
      }
      if (cmd === SIO.WRITE) {
        if (!s || !data || data.length < 2) return { st: 0x4e };
        const n = data[0] | (data[1] << 8);
        core.txPush(aux1 & 255, data.subarray(2, 2 + Math.min(n, 254)));
        core.tick();
        return { st: 0x43 };
      }
      if (cmd === SIO.EVACK) { if (!s) return { st: 0x4e }; s.ev &= ~(aux2 & 255); updateIrq(); return { st: 0x43 }; }
      return { st: 0 };
    };

    return core;
  }

  const api = { create, CMD, ERR, SERR, EV, SS, SIO, NSOCK, RXCAP, TXCAP, UDPMAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else { root.AC = root.AC || {}; root.AC.ACNetCore = api; }
})(typeof window !== 'undefined' ? window : globalThis);
