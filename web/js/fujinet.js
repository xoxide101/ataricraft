/* Virtual FujiNet (device $70) for ataricraft.
   Hooked from the SIO patch in the WASM core via Module.acSio(dev, cmd, dstats, aux, data, len).
   Returns 0 when the command is not ours, otherwise an SIO result char ('C' ok, 'N' nak, 'E' error).
   Disk services D1-D8 stay native: mounting an image from a FujiNet slot just mounts it into the core. */
(function () {
  const HOSTS = 8, SLOTS = 8, HOSTLEN = 32, FNAME = 256, SLOTREC = 38;
  const C = 0x43, N = 0x4e, E = 0x45;
  const IMG = /\.(atr|xfd|dcm|atx|pro)$/i;
  // Public TNFS servers (fujinet.online/tnfs-server-status). Host slot 1 is always the local SD folder.
  const PUBLIC_HOSTS = ['fujinet.diller.org', 'apps.irata.online', 'fujinet.abbuc.de', 'ec.tnfs.io', 'fujinet.pl', '13leader.net', 'atari8.us', 'calaro.cl', 'fujinet.us.to', 'atari-apps.irata.online', 'tnfs.fujinet.online', 'atarionline.eu', 'fujinet.skdev.org', 'tnfs.scatarians.org', 'alcatrazbbs.ddns.net', 'fujinet.sideburn.com', 'tnfs.adamarchive.org', 'coconet.ddns.net', 'tnfs.8bitatari.com', 'tnfs.calaluis.cl', 'fujinet.buriedbits.org'];
  const defaultHosts = () => ['SD', ...PUBLIC_HOSTS.slice(0, HOSTS - 1)];

  const FujiNet = {
    emu: null,
    enabled: localStorage.getItem('ac.fujinet') === '1',
    files: [],              // [{path:'/dir/x.atr', file:File}]
    cache: new Map(),       // path -> Uint8Array
    hosts: defaultHosts(),
    publicHosts: PUBLIC_HOSTS.slice(),
    off: new Set(),         // master-list hosts the user unticked
    gone: new Set(),        // built-in hosts the user removed
    slots: Array.from({ length: SLOTS }, () => ({ host: 0xff, mode: 0, path: '', mounted: false })),
    dir: null,              // {entries, pos}
    onMount: null,          // (slot, path) UI hook
    log: () => {},

    save() {
      localStorage.setItem('ac.fujinet.cfg', JSON.stringify({ hosts: this.hosts, slots: this.slots.map((s) => ({ host: s.host, mode: s.mode, path: s.path })) }));
    },
    load() {
      try {
        const c = JSON.parse(localStorage.getItem('ac.fujinet.cfg') || 'null');
        if (!c) return;
        c.hosts.slice(0, HOSTS).forEach((h, i) => { this.hosts[i] = h; });
        if (c.hosts.slice(1).every((h) => !h)) this.hosts = defaultHosts();
        this.hosts[0] = 'SD';
        c.slots.slice(0, SLOTS).forEach((s, i) => { this.slots[i] = { host: s.host, mode: s.mode, path: s.path, mounted: false }; });
      } catch (e) { /* ignore corrupt config */ }
    },
    reset() {
      localStorage.removeItem('ac.fujinet.cfg');
      this.hosts = defaultHosts();
      this.slots = this.slots.map(() => ({ host: 0xff, mode: 0, path: '', mounted: false }));
      this.dir = null;
    },

    attach(emu) {
      this.emu = emu;
      if (emu.fnAttach) { emu.fnAttach(this); return; }
      emu.m.acSio = (dev, cmd, dstats, aux, data, len) => (dev !== 0x70 ? 0 : this.sio(cmd, dstats, aux, data, len));
    },

    sio(cmd, dstats, aux, data, len) {
      if (!this.enabled) return 0;
      try {
        const r = this.cmd(cmd, dstats, aux, data, len) || N;
        if (cmd === 0xf3 || cmd === 0xf1 || cmd === 0xe2 || cmd === 0xe9 || cmd === 0xf8) this.save();
        return r;
      } catch (e) { console.error('fujinet', e); return E; }
    },

    // Direction (0 none, 1 read, 2 write) and length per command, for cores that need them before the data phase.
    proto: [[0xff, 0, 0], [0x53, 1, 4], [0xfa, 1, 1], [0xea, 1, 1], [0xfe, 1, 97], [0xfb, 2, 97], [0xfd, 1, 1], [0xfc, 1, 34], [0xe8, 1, 140], [0xc4, 1, 240],
      [0xf4, 1, 256], [0xf3, 2, 256], [0xf2, 1, 304], [0xf1, 2, 304], [0xf9, 0, 0], [0xe6, 0, 0], [0xf7, 2, 256], [0xf5, 0, 0], [0xf6, 1, 256], [0xe5, 1, 2], [0xe4, 0, 0],
      [0xe2, 2, 256], [0xda, 1, 256], [0xf8, 0, 0], [0xd7, 0, 0], [0xe9, 0, 0], [0xe1, 2, 256], [0xe0, 1, 256], [0xd9, 0, 0], [0xd6, 0, 0], [0xe3, 1, 1], [0xdf, 0, 0], [0xd3, 1, 1]],

    // Runs fn after the emulated machine returns control (disk changes must not happen inside an SIO command).
    defer(fn) { if (this.emu.core === 'altirra') Promise.resolve().then(fn); else fn(); },

    mem() { return this.emu.fnMem ? this.emu.fnMem() : this.emu.mem(); },

    fillPublic() { this.fillPage(0); },

    // Master list of servers: the user can tick which ones are usable and page them 7 at a time into slots 2-8.
    saveMaster() { localStorage.setItem('ac.fujinet.master', JSON.stringify({ list: this.publicHosts, off: [...this.off], gone: [...this.gone] })); },
    loadMaster() {
      try {
        const m = JSON.parse(localStorage.getItem('ac.fujinet.master') || 'null');
        if (!m) return;
        this.gone = new Set(m.gone || []);
        const extra = PUBLIC_HOSTS.filter((h) => !m.list.includes(h) && !this.gone.has(h));
        this.publicHosts = [...m.list, ...extra];
        this.off = new Set(m.off);
      } catch (e) { /* ignore corrupt list */ }
    },
    selected() { return this.publicHosts.filter((h) => !this.off.has(h)); },
    pageCount() { return Math.max(1, Math.ceil(this.selected().length / (HOSTS - 1))); },
    fillPage(n) {
      const per = HOSTS - 1, sel = this.selected().slice(n * per, (n + 1) * per);
      this.hosts = ['SD', ...sel, ...Array(per - sel.length).fill('')];
      this.save();
    },
    addHost(h) {
      h = h.trim().slice(0, 31);
      if (!h) return false;
      if (!this.publicHosts.includes(h)) this.publicHosts.push(h);
      this.off.delete(h);
      this.gone.delete(h);
      this.saveMaster();
      return true;
    },
    removeHost(h) {
      this.publicHosts = this.publicHosts.filter((x) => x !== h);
      this.off.delete(h);
      this.gone.add(h);
      this.saveMaster();
    },
    resetMaster() {
      localStorage.removeItem('ac.fujinet.master');
      this.publicHosts = PUBLIC_HOSTS.slice();
      this.off = new Set();
      this.gone = new Set();
    },
    // Asks the relay (async, so the page stays responsive) whether a host answers.
    async probe(h) {
      const t = performance.now();
      try {
        const r = await fetch(this.bridge + '/list?host=' + encodeURIComponent(h) + '&path=/');
        return r.ok ? Math.round(performance.now() - t) : -1;
      } catch (e) { return -2; }
    },
    // Best effort: the status page may be unreachable (offline, or blocked by CORS); the built-in list is kept then.
    async refreshPublic() {
      let t;
      try { t = await (await fetch('https://fujinet.online/tnfs-server-status/')).text(); }
      catch (e) { t = await (await fetch(this.bridge + '/status')).text(); } // blocked by CORS from a local page: ask the relay
      const up = [];
      for (const row of t.split(/<tr/i)) {
        const h = row.match(/>\s*([a-z0-9][a-z0-9.-]+\.[a-z]{2,})\s*</i);
        if (h && /up\.svg/.test(row) && !/down\.svg/.test(row)) up.push(h[1].toLowerCase());
      }
      if (!up.length) throw new Error('no servers found in the status page');
      const fresh = up.filter((h) => !this.publicHosts.includes(h));
      this.publicHosts.push(...fresh);
      this.saveMaster();
      return { up: up.length, fresh: fresh.length };
    },

    setFiles(list) {
      let strip = 0;
      if (list.length && list.every((f) => f.rel.includes('/'))) {
        const root = list[0].rel.split('/')[0];
        if (list.every((f) => f.rel.startsWith(root + '/'))) strip = root.length + 1;
      }
      this.files = list.map((f) => ({ path: '/' + f.rel.slice(strip), file: f.file }));
      this.cache.clear();
      this.preload();
    },

    async preload() {
      for (const f of this.files) {
        if (this.files.length === 0 || !IMG.test(f.path) || f.file.size > 8 << 20) continue;
        if (!this.cache.has(f.path)) this.cache.set(f.path, new Uint8Array(await f.file.arrayBuffer()));
      }
    },

    async prefetch(path) {
      const f = this.files.find((x) => x.path === path);
      if (f && !this.cache.has(path)) this.cache.set(path, new Uint8Array(await f.file.arrayBuffer()));
    },

    cstr(mem, p, max) {
      let s = '';
      for (let i = 0; i < max && mem[p + i]; i++) s += String.fromCharCode(mem[p + i]);
      return s;
    },
    put(p, bytes, len) {
      const m = this.mem();
      for (let i = 0; i < len; i++) m[p + i] = i < bytes.length ? bytes[i] : 0;
    },
    str(s, n) { const o = new Uint8Array(n); for (let i = 0; i < Math.min(s.length, n - 1); i++) o[i] = s.charCodeAt(i) & 255; return o; },

    list(path) {
      let p = path.replace(/\\/g, '/');
      if (!p.startsWith('/')) p = '/' + p;
      if (!p.endsWith('/')) p += '/';
      const dirs = new Set(), files = [];
      for (const f of this.files) {
        if (!f.path.startsWith(p)) continue;
        const rest = f.path.slice(p.length);
        const i = rest.indexOf('/');
        if (i >= 0) dirs.add(rest.slice(0, i));
        else files.push({ name: rest, size: f.file.size });
      }
      files.sort((a, b) => a.name.localeCompare(b.name));
      return [...[...dirs].sort().map((d) => ({ name: d, dir: true, size: 0 })), ...files];
    },

    cmd(cmd, dstats, aux, data, len) {
      const a1 = aux & 255, a2 = aux >> 8;
      switch (cmd) {
        case 0xff: return C;                                   // reset
        case 0x53: this.put(data, [0, 0, 0, 0], 4); return C;  // status
        case 0xfa: this.put(data, [3], 1); return C;           // wifi status: connected
        case 0xea: this.put(data, [1], 1); return C;           // wifi enabled
        case 0xfe: this.put(data, this.str('ataricraft', 33), 33 + 64); return C; // get ssid
        case 0xfb: return C;                                   // set ssid (accepted; the browser is already online)
        case 0xfd: this.put(data, [1], 1); return C;           // scan networks: one virtual network
        case 0xfc: {                                           // scan result: ssid[33] + rssi
          if (a1 !== 0) return E;
          const b = new Uint8Array(34);
          b.set(this.str('ataricraft', 33), 0); b[33] = 0xd0;
          this.put(data, b, len);
          return C;
        }
        case 0xe8: case 0xc4: {                                // adapter config (140 bytes; 0xc4 adds display strings)
          const ext = cmd === 0xc4;
          const b = new Uint8Array(ext ? 140 + 64 + 36 : 140);
          const sf = (s, off, n) => b.set(this.str(s, n), off);
          b.set(this.str('ataricraft', 33), 0);
          b.set(this.str('fujinet-virtual', 64), 33);
          b.set([127, 0, 0, 1], 97); b.set([127, 0, 0, 1], 101); b.set([255, 0, 0, 0], 105); b.set([8, 8, 8, 8], 109);
          b.set([2, 0, 0, 0, 0, 1], 113); b.set([2, 0, 0, 0, 0, 2], 119);
          b.set(this.str('1.0-virtual', 15), 125);
          if (ext) {
            sf('127.0.0.1', 140, 16); sf('127.0.0.1', 156, 16); sf('255.0.0.0', 172, 16); sf('8.8.8.8', 188, 16);
            sf('02:00:00:00:00:01', 204, 18); sf('02:00:00:00:00:02', 222, 18);
          }
          this.put(data, b, len);
          return C;
        }
        case 0xf4: {                                           // read host slots
          const b = new Uint8Array(HOSTS * HOSTLEN);
          this.hosts.forEach((h, i) => b.set(this.str(h, HOSTLEN), i * HOSTLEN));
          this.put(data, b, len);
          return C;
        }
        case 0xf3: {                                           // write host slots
          const m = this.mem();
          for (let i = 0; i < HOSTS; i++) this.hosts[i] = this.cstr(m, data + i * HOSTLEN, HOSTLEN);
          this.hosts[0] = 'SD';
          return C;
        }
        case 0xf2: {                                           // read device slots
          const b = new Uint8Array(SLOTS * SLOTREC);
          this.slots.forEach((s, i) => {
            b[i * SLOTREC] = s.host;
            b[i * SLOTREC + 1] = s.mode | (s.mounted ? 0x80 : 0);
            const base = s.path.split('/').pop();
            b.set(this.str(base, 36), i * SLOTREC + 2);
          });
          this.put(data, b, len);
          return C;
        }
        case 0xf1: {                                           // write device slots
          const m = this.mem();
          for (let i = 0; i < SLOTS; i++) {
            const o = data + i * SLOTREC;
            const name = this.cstr(m, o + 2, 36);
            const s = this.slots[i];
            s.host = m[o]; s.mode = m[o + 1] & 0x7f;
            if (!name) { s.path = ''; s.host = 0xff; s.mounted = false; }
            else if (s.path.split('/').pop() !== name) s.path = '/' + name;
          }
          return C;
        }
        case 0xf9: case 0xe6: return C;                        // mount/unmount host
        case 0xf7: {                                           // open directory
          const path = this.cstr(this.mem(), data, 256).replace(/[*?].*$/, '');
          if (this.isRemote(a1)) {
            const r = this.remoteList(this.hosts[a1], path);
            if (!r) return E;
            this.dir = { entries: r, pos: 0 };
          } else this.dir = { entries: this.list(path), pos: 0 };
          return C;
        }
        case 0xf5: this.dir = null; return C;
        case 0xf6: {                                           // read directory entry
          if (!this.dir) return E;
          const maxlen = a1, addtl = a2;
          if ((addtl & 0xc0) === 0xc0) return N;               // block mode not supported
          const ent = this.dir.entries[this.dir.pos++];
          const b = new Uint8Array(maxlen);
          if (!ent) { b[0] = 0x7f; b[1] = 0x7f; this.put(data, b, len); return C; }
          let o = 0;
          if (addtl & 0x80) {
            b.set([0, 1, 1, 0, 0, 0], 0);
            b[6] = ent.size & 255; b[7] = (ent.size >> 8) & 255; b[8] = (ent.size >> 16) & 255; b[9] = (ent.size >> 24) & 255;
            b[10] = ent.dir ? 1 : 0; b[11] = 0; b[12] = 0;
            o = 13;
          }
          let name = ent.name + (ent.dir ? '/' : '');
          if (name.length > maxlen - o - 1) name = name.slice(0, maxlen - o - 1);
          for (let i = 0; i < name.length; i++) b[o + i] = name.charCodeAt(i) & 255;
          this.put(data, b, len);
          return C;
        }
        case 0xe5: this.put(data, [this.dir ? this.dir.pos & 255 : 0, this.dir ? this.dir.pos >> 8 : 0], 2); return this.dir ? C : E;
        case 0xe4: if (this.dir) this.dir.pos = aux; return C;
        case 0xe2: {                                           // set device fullpath: aux1=slot, aux2=host<<4|mode
          const s = this.slots[a1];
          if (!s) return E;
          const path = this.cstr(this.mem(), data, FNAME);
          s.path = path; s.host = a2 >> 4; s.mode = a2 & 15; s.mounted = false;
          if (!this.isRemote(s.host)) this.prefetch(path);
          return C;
        }
        case 0xda: {                                           // get device fullpath
          const s = this.slots[a1];
          if (!s) return E;
          this.put(data, this.str(s.path, FNAME), len);
          return C;
        }
        case 0xf8: return this.mountSlot(a1, a2);              // mount image
        case 0xd7: {                                           // mount all
          this.slots.forEach((s, i) => { if (s.path && !s.mounted) this.mountSlot(i, s.mode || 1); });
          return C;
        }
        case 0xe9: {                                           // unmount image
          const s = this.slots[a1];
          if (!s) return E;
          s.mounted = false;
          if (a1 < 8) this.defer(() => this.emu.ejectDisk(a1 + 1));
          return C;
        }
        case 0xe1: case 0xe0: if (cmd === 0xe0) this.put(data, [0], len); return C; // host prefix
        case 0xd9: case 0xd6: case 0xe3: case 0xdf: return C;  // config boot / boot mode / hsio index / clock
        case 0xd3: this.put(data, [4], 1); return C;           // random
        default: return N;
      }
    },

    // Remote (TNFS) hosts go through the local relay in tools/tnfs-bridge. Synchronous XHR keeps them behaving like the SD host.
    bridge: localStorage.getItem('ac.tnfsbridge') || 'http://127.0.0.1:8765',
    down: 0,
    remote: new Map(),
    isRemote(h) { return h > 0 && h < HOSTS && !!this.hosts[h] && this.hosts[h] !== 'SD'; },
    xhr(url, binary) {
      if (Date.now() < this.down) return null;
      const x = new XMLHttpRequest();
      try {
        x.open('GET', url, false);
        if (binary) x.overrideMimeType('text/plain; charset=x-user-defined');
        x.send();
      } catch (e) {
        this.down = Date.now() + 5000;
        this.log('FujiNet: TNFS relay not running. Start it with: node tools\\tnfs-bridge\\bridge.cjs');
        return null;
      }
      if (x.status !== 200) { this.log('FujiNet: TNFS ' + (x.responseText || x.status)); return null; }
      return x;
    },
    remoteList(host, path) {
      const key = host + '|' + path;
      const hit = this.remote.get(key);
      if (hit && Date.now() - hit.t < 300000) return hit.v;
      const x = this.xhr(this.bridge + '/list?host=' + encodeURIComponent(host) + '&path=' + encodeURIComponent(path || '/'));
      if (!x) return null;
      const v = JSON.parse(x.responseText);
      v.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
      this.remote.set(key, { t: Date.now(), v });
      return v;
    },
    remoteFile(host, path) {
      const key = host + '|' + path;
      if (this.cache.has(key)) return this.cache.get(key);
      this.log('FujiNet: downloading ' + host + path);
      const x = this.xhr(this.bridge + '/file?host=' + encodeURIComponent(host) + '&path=' + encodeURIComponent(path), true);
      if (!x) return null;
      const t = x.responseText, b = new Uint8Array(t.length);
      for (let i = 0; i < t.length; i++) b[i] = t.charCodeAt(i) & 255;
      this.cache.set(key, b);
      return b;
    },

    mountSlot(i, mode) {
      const s = this.slots[i];
      if (!s || !s.path) return E;
      let bytes;
      if (this.isRemote(s.host)) bytes = this.remoteFile(this.hosts[s.host], s.path);
      else { bytes = this.cache.get(s.path); if (!bytes) this.prefetch(s.path); }
      if (!bytes) return E;
      if (!IMG.test(s.path)) return E;
      const name = s.path.split('/').pop();
      this.defer(() => this.emu.mountDisk(i + 1, name, bytes));
      s.mounted = true; s.mode = mode;
      this.log(`FujiNet: D${i + 1} = ${s.path}`);
      if (this.onMount) this.onMount(i, s.path);
      return C;
    },

    // Puts the CONFIG disk on D1 without resetting (used when powering on with FujiNet selected).
    mountConfig() {
      const bin = atob(window.FUJI_CONFIG_B64);
      const b = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
      this.slots.forEach((s) => { s.mounted = false; });
      this.emu.mountDisk(1, 'fujinet-config.atr', b);
    },

    // Mounts the CONFIG disk on D1 so the Atari boots into the FujiNet menu.
    bootConfig() {
      this.mountConfig();
      this.emu.coldStart();
    },
  };
  window.FujiNet = FujiNet;
  FujiNet.loadMaster();
  FujiNet.load();
})();
