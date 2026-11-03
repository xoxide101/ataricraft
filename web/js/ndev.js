/* Virtual FujiNet network devices N1: - N8: (SIO $71-$78) for ataricraft.
   Follows the FujiNet firmware command set (O C R W S P Q T L M Z ... plus the filesystem commands).
   Transport-agnostic: all I/O goes through a synchronous `net` object (see relayNet), so the core runs in node tests.
   Not supported: PROCEED/interrupt (programs must poll status), FTP/SSH/SMB/NFS/S3 and the cloud-service protocols (error 144). */
(function (root) {
  const C = 0x43, N = 0x4e, E = 0x45;
  const ERR = { OK: 1, WRITE_ONLY: 131, INVALID_CMD: 132, READ_ONLY: 135, EOF: 136, TIMEOUT: 138, GENERAL: 144, NOT_IMPL: 146, EXISTS: 151, NO_SPACE: 162, BAD_SPEC: 165, BAD_POINT: 166, DENIED: 167, NOT_FOUND: 170, REFUSED: 200, UNREACH: 201, SOCK_TIMEOUT: 202, RESET: 204, NOT_CONN: 207, NO_SERVER: 208, NO_WAIT: 209, UNAVAIL: 210, BAD_AUTH: 212, JSON_FAIL: 213, CLIENT: 214, SERVER: 215 };
  const ATARI_EOL = 0x9b;
  const enc = (s) => Uint8Array.from(unescape(encodeURIComponent(s)), (c) => c.charCodeAt(0));
  const dec = (b) => { let s = ''; for (const x of b) s += String.fromCharCode(x); try { return decodeURIComponent(escape(s)); } catch (e) { return s; } };

  // HTTP status -> FujiNet error (HTTP.cpp)
  function httpErr(c) {
    if ((c >= 200 && c <= 208) || c === 226) return ERR.OK;
    if (c === 401 || c === 402 || c === 403 || c === 407) return ERR.BAD_AUTH;
    if (c === 404 || c === 410) return ERR.NOT_FOUND;
    if (c === 405) return ERR.NOT_IMPL;
    if (c === 408) return ERR.TIMEOUT;
    if (c === 423 || c === 451) return ERR.DENIED;
    if (c === 901) return ERR.NOT_CONN;
    if (c >= 500 && c < 600) return ERR.SERVER;
    if (c >= 400 && c < 500) return ERR.CLIENT;
    return ERR.GENERAL;
  }

  // Applies the line-ending translation on data coming from the network (to Atari) and going out.
  function toAtari(b, mode, eolStr) {
    if (!mode) return b;
    const o = [];
    for (let i = 0; i < b.length; i++) {
      const c = b[i];
      if (mode === 3 || (mode === 4 && eolStr === 'crlf')) { if (c === 13 && b[i + 1] === 10) { o.push(ATARI_EOL); i++; continue; } if (c === 10) { o.push(ATARI_EOL); continue; } }
      if (mode === 1 && c === 13) { o.push(ATARI_EOL); continue; }
      if (mode === 2 && c === 10) { o.push(ATARI_EOL); continue; }
      o.push(c);
    }
    return Uint8Array.from(o);
  }
  function fromAtari(b, mode) {
    if (!mode) return b;
    const o = [];
    for (const c of b) {
      if (c === ATARI_EOL) { if (mode === 1) o.push(13); else if (mode === 2) o.push(10); else o.push(13, 10); } else o.push(c);
    }
    return Uint8Array.from(o);
  }

  // Parse "scheme://host:port/path?query"
  function parseUrl(s) {
    const m = /^([a-z][a-z0-9+.-]*):\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^:/?#]*)(?::(\d+))?([^?#]*)(?:\?([^#]*))?/i.exec(s);
    if (!m) return null;
    return { scheme: m[1].toLowerCase(), user: m[2] || '', pass: m[3] || '', host: m[4], port: m[5] ? +m[5] : 0, path: m[6] || '', query: m[7] || '' };
  }

  // Devicespec -> URL (util_devicespec_fix_for_parsing + prefix rules)
  function fixSpec(raw, prefix, isDirRead) {
    let s = raw.replace(/^N\d*:/i, '');
    s = s.replace(/[^\x20-\x7e]/g, '');
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && prefix) s = prefix + s;
    s = s.replace(/^sd:(?!\/\/)\/?/i, 'SD:///');
    if (!isDirRead) s = s.replace(/\*.*$/, '');
    s = s.replace(/\.$/, '').replace(/ /g, '');
    return s;
  }
  function chdirPrefix(prefix, arg) {
    const up = (p) => { const u = parseUrl(p); if (!u) return p; const parts = u.path.split('/').filter(Boolean); parts.pop(); return u.scheme + '://' + u.host + (u.port ? ':' + u.port : '') + '/' + parts.join('/') + (parts.length ? '/' : ''); };
    const root = (p) => { const u = parseUrl(p); return u ? u.scheme + '://' + u.host + (u.port ? ':' + u.port : '') + '/' : p; };
    arg = arg.replace(/^N\d*:/i, '');
    if (arg === '..' || arg === '<') return up(prefix);
    if (arg === '/' || arg === '>') return root(prefix);
    if (arg.includes(':')) return arg;
    if (arg.startsWith('/')) return root(prefix).replace(/\/$/, '') + arg;
    return prefix + (prefix && !prefix.endsWith('/') ? '/' : '') + arg;
  }

  // ---------- protocols ----------
  // Each returns {err, status(), read(n), write(b), close(), ...}. rx is filled lazily via fill().
  const protocols = {};

  protocols.test = (u, o) => {
    const eol = ['\x9b', '\x9b', '\x0d', '\x0a', '\x0d\x0a'][o.trans] || '\x9b';
    const data = enc('This is test data being initialized in the test protocol, a single line of input with line ending.' + eol);
    const sent = [];
    return { raw: true, rx: Uint8Array.from(data), eof: true, sent, write: (b) => { sent.push(...b); return ERR.OK; } };
  };

  protocols.http = (u, o, net) => {
    const m = o.aux1;
    const st = { raw: false, rx: new Uint8Array(0), eof: false, mode: 0, reqH: {}, respH: [], post: null, code: 0, started: false, err: ERR.OK, method: 'GET', url: o.url, pos: 0, sent: false, headersKeys: [] };
    st.method = { 4: 'GET', 12: 'GET', 5: 'DELETE', 9: 'DELETE', 8: 'PUT', 14: 'PUT', 13: 'POST' }[m] || 'GET';
    st.hasHeaders = m === 12 || m === 9 || m === 14 || m === 13;
    st.body = [];
    st.start = () => {
      if (st.started) return;
      st.started = true;
      const r = net.http({ method: st.method, url: o.url, headers: Object.assign({}, st.reqH, st.pos ? { Range: 'bytes=' + st.pos + '-' } : {}, o.user ? { Authorization: 'Basic ' + btoa(o.user + ':' + o.pass) } : {}), body: st.post || (st.method === 'PUT' || st.method === 'POST' ? Uint8Array.from(st.body) : null) });
      st.code = r.status;
      st.err = httpErr(r.status);
      st.respH = r.headers || [];
      st.rx = r.body || new Uint8Array(0);
      st.eof = true;
    };
    st.lazy = true;
    st.write = (b) => {
      if (st.mode === 3) { const t = dec(b).replace(/[\r\n\x9b]+$/, ''); const i = t.indexOf(':'); if (i > 0) st.reqH[t.slice(0, i).trim()] = t.slice(i + 1).trim(); return ERR.OK; }
      if (st.mode === 4) { st.post = Uint8Array.from([...(st.post || []), ...b]); return ERR.OK; }
      if (st.method === 'GET' || st.method === 'DELETE') return ERR.READ_ONLY;
      st.body.push(...b);
      return ERR.OK;
    };
    st.setMode = (v) => {
      if (v === 4 && !st.post) st.post = new Uint8Array(0);
      st.mode = v;
      if (v === 2 || v === 0) { st.start(); if (v === 2) { st.saved = st.rx; st.rx = enc(st.respH.map((h) => h[0] + ': ' + h[1]).join('\x9b') + '\x9b'); } }
      if (v === 0 && st.saved) { st.rx = st.saved; st.saved = null; }
      if (v === 1) st.headersKeys = [];
    };
    st.closeFn = () => { if ((st.method === 'PUT' || st.method === 'POST') && !st.started) st.start(); };
    return st;
  };
  protocols.https = protocols.http;

  protocols.tcp = (u, o, net) => {
    if (!u.port) return { fail: ERR.BAD_SPEC };
    const st = { raw: false, tcp: true, rx: new Uint8Array(0), eof: false, lazy: false, server: !u.host };
    if (st.server) {
      const r = net.tcpListen(u.port);
      if (r.err) return { fail: r.err };
      st.id = null; st.lid = r.id; st.err = ERR.OK; st.connected = false;
      st.accept = () => {
        if (st.id != null) return ERR.EXISTS;
        const a = net.tcpAccept(st.lid);
        if (a.err) return a.err;
        st.id = a.id; st.connected = true; return ERR.OK;
      };
      st.dropClient = () => { if (st.id != null) { net.tcpClose(st.id); st.id = null; st.connected = false; return ERR.OK; } return ERR.NOT_CONN; };
    } else {
      const r = net.tcpOpen(u.host, u.port);
      if (r.err) return { fail: r.err };
      st.id = r.id; st.connected = true;
    }
    st.pull = (n) => {
      if (st.id == null) return;
      const r = net.tcpRead(st.id, n);
      if (r.data && r.data.length) { const m = new Uint8Array(st.rx.length + r.data.length); m.set(st.rx); m.set(r.data, st.rx.length); st.rx = m; }
      if (r.eof) { st.eof = true; st.connected = false; }
    };
    st.write = (b) => { if (st.id == null) return ERR.NOT_CONN; const e = net.tcpWrite(st.id, b); return e || ERR.OK; };
    st.closeFn = () => { if (st.id != null) net.tcpClose(st.id); if (st.lid != null) net.tcpClose(st.lid); };
    return st;
  };

  protocols.udp = (u, o, net) => {
    const st = { raw: false, rx: new Uint8Array(0), eof: false, lazy: false, udp: true };
    const r = net.udpOpen(u.host, u.port, o.aux1);
    if (r.err) return { fail: r.err };
    st.id = r.id;
    st.dest = u.host ? { host: u.host, port: u.port } : null;
    st.pull = () => { const d = net.udpRead(st.id); if (d && d.length) { const m = new Uint8Array(st.rx.length + d.length); m.set(st.rx); m.set(d, st.rx.length); st.rx = m; } };
    st.write = (b) => (st.dest ? (net.udpSend(st.id, st.dest.host, st.dest.port, b) || ERR.OK) : ERR.GENERAL);
    st.closeFn = () => net.udpClose(st.id);
    return st;
  };

  // TNFS: directory listing and whole-file read through the existing relay. Writes (modes 8 and 9) and the
  // file commands need a relay started with --allow-write; the data is sent when the channel is closed.
  protocols.tnfs = (u, o, net) => {
    const st = { raw: false, rx: new Uint8Array(0), eof: true, lazy: false, err: ERR.OK };
    const host = u.host + (u.port ? ':' + u.port : '');
    if (o.aux1 === 8 || o.aux1 === 9) {
      if (!net.tnfsPut) return { fail: ERR.NOT_IMPL };
      const parts = [];
      st.writeOnly = true;
      st.write = (b) => { parts.push(Uint8Array.from(b)); return ERR.OK; };
      st.closeFn = () => {
        const n = parts.reduce((s, p) => s + p.length, 0), all = new Uint8Array(n);
        let at = 0; for (const p of parts) { all.set(p, at); at += p.length; }
        return net.tnfsPut(host, u.path, all, o.aux1 === 9);
      };
      return st;
    }
    try {
      if (o.aux1 === 6 || o.aux1 === 7) {
        const l = net.tnfsList(host, u.path || '/');
        st.rx = enc(l.map((e) => (e.dir ? '*' : ' ') + e.name).join('\x9b') + '\x9b');
      } else st.rx = net.tnfsFile(host, u.path);
    } catch (e) { return { fail: ERR.NOT_FOUND }; }
    st.write = () => ERR.READ_ONLY;
    return st;
  };

  // SD: a folder on the PC served by the relay (--sd DIR). Same behaviour as TNFS; writes need --allow-write.
  protocols.sd = (u, o, net) => {
    const st = { raw: false, rx: new Uint8Array(0), eof: true, err: ERR.OK };
    if (!net.sdFile) return { fail: ERR.NOT_IMPL };
    if (o.aux1 === 8 || o.aux1 === 9) {
      const parts = [];
      st.writeOnly = true;
      st.write = (b) => { parts.push(Uint8Array.from(b)); return ERR.OK; };
      st.closeFn = () => {
        const n = parts.reduce((s, p) => s + p.length, 0), all = new Uint8Array(n);
        let at = 0; for (const p of parts) { all.set(p, at); at += p.length; }
        return net.sdPut(u.path, all, o.aux1 === 9);
      };
      return st;
    }
    try {
      if (o.aux1 === 6 || o.aux1 === 7) {
        const l = net.sdList(u.path || '/');
        st.rx = enc(l.map((e) => (e.dir ? '*' : ' ') + e.name).join('\x9b') + '\x9b');
      } else st.rx = net.sdFile(u.path);
    } catch (e) { return { fail: ERR.NOT_FOUND }; }
    st.write = () => ERR.READ_ONLY;
    return st;
  };

  const JSON_FLAGS = { remap: 1, intl: 2, sgml: 4, ascii: 16 };

  class Unit {
    constructor(n, net) { this.n = n; this.net = net; this.prefix = ''; this.eolSel = 0; this.reset(); this.user = ''; this.pass = ''; this.flags = 0; this.parser = 0; }
    reset() { this.p = null; this.rx = new Uint8Array(0); this.err = ERR.OK; this.trans = 0; this.mode = 4; this.parsed = null; this.parseErr = 0; this.destination = null; this.hdrMode = 0; this.pendingQuery = null; }
    avail() { this.pull(); return this.rx.length; }
    pull() {
      const p = this.p;
      if (!p) return;
      if (p.lazy && !p.started) { if (!this.deferStart) p.start(); }
      if (p.raw && p.rx.length) { this.rx = this.xlate(p.rx); p.rx = new Uint8Array(0); }
      else if (p.pull) { p.pull(512); }
      if (!p.raw && p.rx.length) { const t = this.xlate(p.rx); const m = new Uint8Array(this.rx.length + t.length); m.set(this.rx); m.set(t, this.rx.length); this.rx = m; p.rx = new Uint8Array(0); }
    }
    xlate(b) { return toAtari(b, this.trans & 3 || (this.trans === 4 ? 3 : 0), 'crlf'); }
    open(spec, aux1, aux2) {
      this.close();
      this.reset();
      this.mode = aux1; this.trans = aux2 & 7;
      const isDir = aux1 === 6 || aux1 === 7;
      const raw = spec.replace(/[\x9b\x00].*$/s, '');
      const url = fixSpec(raw, this.prefix, isDir);
      const u = parseUrl(url);
      if (!u) { this.err = ERR.BAD_SPEC; return ERR.BAD_SPEC; }
      const key = u.scheme === 'tnfs' ? 'tnfs' : u.scheme;
      const f = protocols[key];
      if (!f) { this.err = ERR.GENERAL; return ERR.GENERAL; }
      const r = f(u, { aux1, trans: this.trans, url, user: this.user, pass: this.pass }, this.net);
      if (r.fail) { this.err = r.fail; return r.fail; }
      this.p = r; this.url = url;
      if (r.lazy) this.deferStart = true;
      if (this.parser && r.rx != null) this.parserWanted = true;
      this.err = ERR.OK;
      return ERR.OK;
    }
    close() {
      this.closeErr = 0;
      if (this.p) {
        try { if (this.p.closeFn) { const e = this.p.closeFn(); if (typeof e === 'number' && e !== ERR.OK && e !== 0) this.closeErr = e; } } catch (e) { this.closeErr = ERR.GENERAL; }
      }
      this.p = null; this.rx = new Uint8Array(0); this.parsed = null; this.deferStart = false;
    }
    status() {
      if (!this.p) return [0, 0, 0, this.err === ERR.OK ? ERR.NOT_CONN : this.err];
      if (this.p.lazy && !this.p.started && !this.deferStart) this.p.start();
      if (this.p.lazy && this.deferStart && this.p.mode === 0) { this.deferStart = false; if (this.p.method === 'GET' || this.p.method === 'DELETE') this.p.start(); }
      this.pull();
      if (this.p.lazy && this.mode >= 8 && this.mode !== 12 && !this.p.started) this.p.start();
      const a = this.rx.length;
      let err = this.err;
      if (this.p.lazy) err = this.p.err;
      else if (this.p.tcp && !this.p.connected && !a) err = this.p.eof ? ERR.EOF : this.err;
      if (this.parseErr) err = this.parseErr;
      if (!a && this.p.eof && err === ERR.OK && !this.p.tcp && !this.p.lazy && !this.p.writeOnly) err = ERR.EOF;
      if (!a && this.p.lazy && this.p.started && this.p.eof && err === ERR.OK) err = ERR.EOF;
      const conn = this.p.tcp ? (this.p.server ? (this.p.connected ? 1 : 0) : (this.p.connected ? 1 : 0)) : (a ? 1 : 0);
      return [a & 255, (a >> 8) & 255, conn, err & 255];
    }
    read(n) {
      if (!this.p) return { err: ERR.NOT_CONN, data: new Uint8Array(0) };
      this.pull();
      if (this.p.lazy && this.deferStart) { this.deferStart = false; if (!this.p.started) this.p.start(); this.pull(); }
      const d = this.rx.subarray(0, n);
      this.rx = this.rx.subarray(d.length);
      const err = this.p.lazy ? this.p.err : ERR.OK;
      return { err: (!d.length && (this.p.eof || !this.p.tcp)) ? ERR.EOF : err, data: d };
    }
    write(b) {
      if (!this.p) return ERR.NOT_CONN;
      if (this.mode === 4 || this.mode === 6) return ERR.READ_ONLY;
      return this.p.write(fromAtari(b, this.trans & 3 || (this.trans === 4 ? 3 : 0)));
    }
  }

  // ---------- JSON / XML parser mode ----------
  function jsonQuery(unit, q) {
    // Path: /a/b/0 ; or "a/b/0".  Objects and arrays are returned as compact JSON.
    let v = unit.parsed;
    const parts = q.replace(/^\/+/, '').split('/').filter((x) => x !== '');
    for (const k of parts) {
      if (v == null || typeof v !== 'object' || !(k in v)) return null;
      v = v[k];
    }
    return typeof v === 'string' ? v : (v === null ? 'null' : JSON.stringify(v));
  }
  function xmlQuery(unit, q) {
    const doc = unit.parsed;
    const parts = q.replace(/^\/+/, '').split('/').filter(Boolean);
    let nodes = [doc.documentElement];
    for (let i = 0; i < parts.length; i++) {
      if (i === 0 && nodes[0].nodeName === parts[0]) continue;
      const next = [];
      for (const n of nodes) for (const c of n.children) if (c.nodeName === parts[i]) next.push(c);
      nodes = next;
    }
    return nodes.length ? nodes.map((n) => n.textContent).join('\x00') : null;
  }
  function parseBody(unit) {
    unit.deferStart = false;
    unit.pull();
    const text = dec(unit.rx);
    unit.rx = new Uint8Array(0);
    try {
      if (unit.parser === 1) unit.parsed = JSON.parse(text);
      else if (unit.parser === 3 && typeof DOMParser !== 'undefined') {
        const d = new DOMParser().parseFromString(text, 'application/xml');
        if (d.getElementsByTagName('parsererror').length) throw new Error('xml');
        unit.parsed = d;
      } else throw new Error('mode');
      unit.parseErr = 0;
      return ERR.OK;
    } catch (e) { unit.parsed = null; unit.parseErr = ERR.JSON_FAIL; return ERR.JSON_FAIL; }
  }

  // ---------- device ----------
  function NDev(net) {
    const dev = { net, units: [], enabled: true };
    for (let i = 1; i <= 8; i++) dev.units.push(new Unit(i, net));

    // dev-level direction table (get_dstats_for_command): 0 none, 1 read (0x40), 2 write (0x80)
    const DIR = { 0x43: 0, 0x50: 0, 0x41: 0, 0x63: 0, 0xfc: 0, 0x54: 0, 0x5a: 0, 0xfb: 0, 0x4d: 0, 0x72: 0,
      0x3f: 1, 0x52: 1, 0x53: 1, 0x30: 1, 0x26: 1, 0x45: 1,
      0x4f: 2, 0x57: 2, 0x2c: 2, 0x51: 2, 0xfd: 2, 0xfe: 2, 0x20: 2, 0x21: 2, 0x23: 2, 0x24: 2, 0x2a: 2, 0x2b: 2, 0x44: 2, 0x4c: 2, 0x25: 2 };
    dev.dir = (cmd) => (cmd in DIR ? DIR[cmd] : 0);

    dev.sio = (devId, cmd, dstats, aux, data, len, mem) => {
      const u = dev.units[devId - 0x71];
      if (!u) return 0;
      const a1 = aux & 255, a2 = (aux >> 8) & 255;
      const rd = () => mem.slice(data, data + len);
      const put = (arr) => { mem.set(arr.subarray ? arr.subarray(0, len) : Uint8Array.from(arr).subarray(0, len), data); };
      try {
        switch (cmd) {
          case 0x4f: { // open
            const spec = dec(rd());
            return u.open(spec, a1, a2) === ERR.OK ? C : E;
          }
          case 0x43: { u.close(); const e = u.closeErr || 0; u.err = e || ERR.OK; return e ? E : C; }
          case 0x53: put(Uint8Array.from(u.status())); return C;
          case 0x52: { // read
            const n = (len || 0);
            if (u.parser && u.pendingQuery != null) { const q = u.pendingQuery; const r = new Uint8Array(len); r.set(q.subarray(0, len)); u.pendingQuery = q.length > len ? q.subarray(len) : null; mem.set(r, data); return C; }
            const r = u.read(n);
            const out = new Uint8Array(len); out.set(r.data);
            mem.set(out, data);
            if (!r.data.length || r.err !== ERR.OK) { u.err = r.err; return r.err === ERR.OK ? C : E; }
            return C;
          }
          case 0x57: { // write
            const b = rd().subarray(0, aux);
            const e = u.write(b);
            u.err = e;
            return e === ERR.OK ? C : E;
          }
          case 0x54: u.trans = a2 & 7; return C;
          case 0x4c: u.eolSel = a1; return C;
          case 0x4d: if (u.p && u.p.setMode) { u.p.setMode(a1 || a2); return C; } return E;
          case 0x5a: return C;
          case 0xfc: { const m = a1 || a2; if (m === 2 || m > 3) return E; u.parser = m; return C; }
          case 0xfb: if (a1 === 0) u.flags = a2; return C;
          case 0xfd: u.user = dec(rd()).replace(/[\x9b\x00].*$/s, ''); return C;
          case 0xfe: u.pass = dec(rd()).replace(/[\x9b\x00].*$/s, ''); return C;
          case 0x50: { // parse the received body
            if (!u.parser) return E;
            return parseBody(u) === ERR.OK ? C : E;
          }
          case 0x51: { // query
            if (!u.parser || u.parsed == null) return E;
            const q = dec(rd()).replace(/[\x9b\x00].*$/s, '');
            const r = u.parser === 1 ? jsonQuery(u, q) : xmlQuery(u, q);
            if (r == null) { u.parseErr = ERR.NOT_FOUND; return E; }
            u.parseErr = 0;
            u.pendingQuery = Uint8Array.from([...enc(r), ATARI_EOL]);
            u.rx = u.pendingQuery; u.pendingQuery = null;
            return C;
          }
          case 0x41: { if (!u.p || !u.p.accept) return E; const e = u.p.accept(); u.err = e; return e === ERR.OK ? C : E; }
          case 0x63: { if (!u.p || !u.p.dropClient) return E; const e = u.p.dropClient(); u.err = e; return e === ERR.OK ? C : E; }
          case 0x44: { // UDP destination
            if (!u.p || !u.p.udp) return E;
            const m = /^(.+):(\d+)/.exec(dec(rd()).replace(/[\x9b\x00].*$/s, '').replace(/^N\d*:/i, '').replace(/^udp:\/\//i, ''));
            if (!m) return E;
            u.p.dest = { host: m[1], port: +m[2] };
            return C;
          }
          case 0x20: case 0x21: case 0x2a: case 0x2b: { // rename, delete, mkdir, rmdir (TNFS only)
            const raw = dec(rd()).replace(/[\x9b\x00].*$/s, '');
            const op = { 0x20: 'rename', 0x21: 'unlink', 0x2a: 'mkdir', 0x2b: 'rmdir' }[cmd];
            const parts = op === 'rename' ? raw.split(',') : [raw];
            if (op === 'rename' && parts.length !== 2) { u.err = ERR.BAD_SPEC; return E; }
            const url = parseUrl(fixSpec(parts[0], u.prefix, false));
            if (!url) { u.err = ERR.BAD_SPEC; return E; }
            if (url.scheme !== 'tnfs' && url.scheme !== 'sd') { u.err = ERR.NOT_IMPL; return E; }
            if (url.scheme === 'tnfs' ? !dev.net.tnfsOp : !dev.net.sdOp) { u.err = ERR.NOT_IMPL; return E; }
            let to = '';
            if (op === 'rename') {
              const t = parts[1].replace(/^N\d*:/i, '').trim();
              const dir = url.path.replace(/[^/]*$/, '');
              to = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? (parseUrl(t) || {}).path || '' : t.startsWith('/') ? t : dir + t;
            }
            const e = url.scheme === 'sd' ? dev.net.sdOp(op, url.path, to) : dev.net.tnfsOp(url.host + (url.port ? ':' + url.port : ''), op, url.path, to);
            u.err = e || ERR.OK;
            return e && e !== ERR.OK ? E : C;
          }
          case 0x45: put(Uint8Array.from([u.err])); return C;
          case 0x2c: { u.prefix = chdirPrefix(u.prefix, dec(rd()).replace(/[\x9b\x00].*$/s, '')); return C; }
          case 0x30: { put(enc(u.prefix + '\x9b')); return C; }
          case 0xff: put(Uint8Array.from([dev.dir(a1) === 2 ? 0x80 : dev.dir(a1) === 1 ? 0x40 : 0])); return C;
          default: u.err = ERR.INVALID_CMD; return N;
        }
      } catch (e) { console.error('ndev', e); u.err = ERR.GENERAL; return E; }
    };
    return dev;
  }

  // Default transport: synchronous XHR to the local relay (tools/tnfs-bridge/bridge.cjs) using a token.
  function relayNet(opts) {
    const base = () => (typeof opts.base === 'function' ? opts.base() : opts.base);
    const tok = () => (typeof opts.token === 'function' ? opts.token() : opts.token) || '';
    const call = (path, body, headers) => {
      const x = new XMLHttpRequest();
      x.open('POST', base() + path, false);
      x.overrideMimeType('text/plain; charset=x-user-defined');
      x.setRequestHeader('X-AC-Token', tok());
      for (const k in headers || {}) x.setRequestHeader(k, headers[k]);
      try { x.send(body || null); } catch (e) { return { err: ERR.UNREACH }; }
      if (x.status === 403) return { err: ERR.DENIED };
      const b = new Uint8Array(x.responseText.length);
      for (let i = 0; i < b.length; i++) b[i] = x.responseText.charCodeAt(i) & 255;
      return { status: x.status, body: b, hdr: (n) => x.getResponseHeader(n) };
    };
    const jh = (o) => ({ 'X-AC-Args': encodeURIComponent(JSON.stringify(o)) });
    const j = (path, o, body) => {
      const r = call(path, body, jh(o));
      if (r.err) return r;
      if (r.status !== 200) return { err: +(r.hdr('X-AC-Err') || ERR.GENERAL) };
      return { body: r.body, meta: JSON.parse(decodeURIComponent(r.hdr('X-AC-Meta') || '%7B%7D')) };
    };
    return {
      http(req) {
        const r = j('/net/http', { method: req.method, url: req.url, headers: req.headers }, req.body);
        if (r.err) return { status: 901, body: new Uint8Array(0), headers: [] };
        return { status: r.meta.status, headers: r.meta.headers || [], body: r.body };
      },
      tcpOpen(host, port) { const r = j('/net/tcp/open', { host, port }); return r.err ? { err: r.err } : { id: r.meta.id }; },
      tcpListen(port) { const r = j('/net/tcp/listen', { port }); return r.err ? { err: r.err } : { id: r.meta.id }; },
      tcpAccept(id) { const r = j('/net/tcp/accept', { id }); return r.err ? { err: r.err } : { id: r.meta.id }; },
      tcpRead(id, n) { const r = j('/net/tcp/read', { id, n }); return r.err ? { eof: true } : { data: r.body, eof: !!r.meta.eof }; },
      tcpWrite(id, b) { const r = j('/net/tcp/write', { id }, b); return r.err || 0; },
      tcpClose(id) { j('/net/tcp/close', { id }); },
      udpOpen(host, port, mode) { const r = j('/net/udp/open', { host, port, mode }); return r.err ? { err: r.err } : { id: r.meta.id }; },
      udpRead(id) { const r = j('/net/udp/read', { id }); return r.err ? null : r.body; },
      udpSend(id, host, port, b) { const r = j('/net/udp/send', { id, host, port }, b); return r.err || 0; },
      udpClose(id) { j('/net/udp/close', { id }); },
      tnfsList(host, path) { const r = j('/net/tnfs/list', { host, path }); if (r.err) throw new Error('tnfs'); return JSON.parse(dec(r.body)); },
      tnfsFile(host, path) { const r = j('/net/tnfs/file', { host, path }); if (r.err) throw new Error('tnfs'); return r.body; },
      tnfsPut(host, path, data, append) { const r = j('/net/tnfs/put', { host, path, append: !!append }, data); return r.err || ERR.OK; },
      tnfsOp(host, op, path, to) { const r = j('/net/tnfs/op', { host, op, path, to }); return r.err || ERR.OK; },
      sdList(path) { const r = j('/net/sd/list', { path }); if (r.err) throw new Error('sd'); return JSON.parse(dec(r.body)); },
      sdFile(path) { const r = j('/net/sd/file', { path }); if (r.err) throw new Error('sd'); return r.body; },
      sdPut(path, data, append) { const r = j('/net/sd/put', { path, append: !!append }, data); return r.err || ERR.OK; },
      sdOp(op, path, to) { const r = j('/net/sd/op', { op, path, to }); return r.err || ERR.OK; },
    };
  }

  const api = { NDev, relayNet, ERR, parseUrl, fixSpec, chdirPrefix, httpErr, toAtari, fromAtari };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NDev = api;
})(typeof window !== 'undefined' ? window : globalThis);
