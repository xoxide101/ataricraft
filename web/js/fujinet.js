/* Virtual FujiNet (device $70) for ataricraft.
   Hooked from the SIO patch in the WASM core via Module.acSio(dev, cmd, dstats, aux, data, len).
   Returns 0 when the command is not ours, otherwise an SIO result char ('C' ok, 'N' nak, 'E' error).
   Disk services D1-D8 stay native: mounting an image from a FujiNet slot just mounts it into the core. */
(function () {
  const HOSTS = 8, SLOTS = 8, HOSTLEN = 32, FNAME = 256, SLOTREC = 38;
  const C = 0x43, N = 0x4e, E = 0x45;
  const IMG = /\.(atr|xfd|dcm|atx|pro)$/i;

  const FujiNet = {
    emu: null,
    enabled: localStorage.getItem('ac.fujinet') === '1',
    files: [],              // [{path:'/dir/x.atr', file:File}]
    cache: new Map(),       // path -> Uint8Array
    hosts: Array.from({ length: HOSTS }, (_, i) => (i === 0 ? 'SD' : '')),
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
        c.slots.slice(0, SLOTS).forEach((s, i) => { this.slots[i] = { host: s.host, mode: s.mode, path: s.path, mounted: false }; });
      } catch (e) { /* ignore corrupt config */ }
    },
    reset() {
      localStorage.removeItem('ac.fujinet.cfg');
      this.hosts = this.hosts.map((_, i) => (i === 0 ? 'SD' : ''));
      this.slots = this.slots.map(() => ({ host: 0xff, mode: 0, path: '', mounted: false }));
      this.dir = null;
    },

    attach(emu) {
      this.emu = emu;
      emu.m.acSio = (dev, cmd, dstats, aux, data, len) => {
        if (dev !== 0x70 || !this.enabled) return 0;
        try {
          const r = this.cmd(cmd, dstats, aux, data, len) || N;
          if (cmd === 0xf3 || cmd === 0xf1 || cmd === 0xe2 || cmd === 0xe9 || cmd === 0xf8) this.save();
          return r;
        } catch (e) { console.error('fujinet', e); return E; }
      };
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

    mem() { return this.emu.mem(); },
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
          const path = this.cstr(this.mem(), data, 256);
          this.dir = { entries: this.list(path.replace(/[*?].*$/, '')), pos: 0 };
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
          this.prefetch(path);
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
          if (a1 < 8) this.emu.ejectDisk(a1 + 1);
          return C;
        }
        case 0xe1: case 0xe0: if (cmd === 0xe0) this.put(data, [0], len); return C; // host prefix
        case 0xd9: case 0xd6: case 0xe3: case 0xdf: return C;  // config boot / boot mode / hsio index / clock
        case 0xd3: this.put(data, [4], 1); return C;           // random
        default: return N;
      }
    },

    mountSlot(i, mode) {
      const s = this.slots[i];
      if (!s || !s.path) return E;
      const bytes = this.cache.get(s.path);
      if (!bytes) { this.prefetch(s.path); return E; }
      if (!IMG.test(s.path)) return E;
      this.emu.mountDisk(i + 1, s.path.split('/').pop(), bytes);
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
  FujiNet.load();
})();
