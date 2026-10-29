// Second emulation core: AltirraSDL's libretro core built to WASM (tools/altirra-core). It mirrors the AC.Emu interface so the
// UI drives either core the same way. Loaded lazily; the wasm is embedded (ref/altirra-wasm.js) so it also works from file://.
window.AC = window.AC || {};
(function () {
  const Emu = AC.Emu;
  const W = AC.SCREEN.w, H = AC.SCREEN.h;
  const RAM = { '48': '48K', '52': '52K', '64': '64K', '128': '128K', '320r': '320K', '320c': '320K_Compy', '576': '576K', '1088': '1088K' };
  const SYSTEM = { '800': '800', '800xl': '800xl', '65xe': '800xl', '130xe': '130xe', '1200xl': '1200xl' };
  // Atari scan codes for ctrl+letter (keychar 1..26).
  const LETTER = [0x3f, 0x15, 0x12, 0x3a, 0x2a, 0x38, 0x3d, 0x39, 0x0d, 0x01, 0x05, 0x00, 0x25, 0x23, 0x08, 0x0a, 0x2f, 0x28, 0x3e, 0x2d, 0x0b, 0x10, 0x2e, 0x16, 0x2b, 0x17];
  const SPECIAL_CHAR = { 10: 0x0c, 8: 0x34, 9: 0x2c, 27: 0x1c };
  const UP = 1 << 4, DOWN = 1 << 5, LEFT = 1 << 6, RIGHT = 1 << 7, FIRE = 1;

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('cannot load ' + src));
      document.head.append(s);
    });
  }
  let modPromise = null;
  function loadModule() {
    if (!modPromise) {
      modPromise = (async () => {
        if (typeof AltirraWeb === 'undefined') await loadScript('ref/altirra-web.js?v=7');
        if (!window.ALTIRRA_WASM_B64) await loadScript('ref/altirra-wasm.js?v=7');
        return AltirraWeb({ locateFile: (p) => (p.endsWith('.wasm') ? 'data:application/wasm;base64,' + window.ALTIRRA_WASM_B64 : p), print: () => {}, printErr: () => {} });
      })();
      modPromise.catch(() => { modPromise = null; });
    }
    return modPromise;
  }

  class AltEmu extends Emu {
    constructor(m, opt) {
      super({ _malloc: () => 0 }, opt);
      this.m = m;
      const cw = (n, r, a) => m.cwrap(n, r, a || []);
      this.aw = {
        init: cw('aw_init', 'number'), opt: cw('aw_opt', null, ['string', 'string']), boot: cw('aw_boot', 'number'), run: cw('aw_run'), act: cw('aw_act', 'number', ['number']),
        reset: cw('aw_reset', null, ['number']), frame: cw('aw_frame', 'number'), fw: cw('aw_frame_w', 'number'), fh: cw('aw_frame_h', 'number'),
        pitch: cw('aw_frame_pitch', 'number'), audio: cw('aw_audio', 'number'), afr: cw('aw_audio_frames', 'number'),
        scan: cw('aw_scan', null, ['number']), chScan: cw('aw_char_scan', 'number', ['number']), brk: cw('aw_break', null, ['number']),
        joy: cw('aw_joy', null, ['number', 'number']), con: cw('aw_console', null, ['number', 'number']),
        mount: cw('aw_disk_mount', 'number', ['number', 'string', 'number']), eject: cw('aw_disk_eject', null, ['number']),
        save: cw('aw_disk_save', 'number', ['number', 'string']),
        cart: cw('aw_cart_load', 'number', ['number', 'string', 'number']), cartEject: cw('aw_cart_eject', null, ['number']),
        load: cw('aw_load', 'number', ['string']),
        tapeLoad: cw('aw_tape_load', 'number', ['string']), tapeEject: cw('aw_tape_eject'), tapeRewind: cw('aw_tape_rewind'),
        tapePlay: cw('aw_tape_play', null, ['number']), tapePos: cw('aw_tape_pos', 'number'), tapeLen: cw('aw_tape_len', 'number'),
        stSize: cw('aw_state_size', 'number'), stSave: cw('aw_state_save', 'number', ['number', 'number']), stLoad: cw('aw_state_load', 'number', ['number', 'number']),
        ram: cw('aw_ram', 'number'), ramSize: cw('aw_ram_size', 'number'), alloc: cw('aw_alloc', 'number', ['number']), free: cw('aw_free', null, ['number']),
        host: cw('aw_host', 'number', ['number']), fwCustom: cw('aw_fw_custom', null, ['string', 'string']), xep: cw('aw_xep', 'number', ['number']), xepUpdate: cw('aw_xep_update', 'number'),
        xepFrame: cw('aw_xep_frame', 'number'), xepW: cw('aw_xep_w', 'number'), xepH: cw('aw_xep_h', 'number'),
        fn: cw('aw_fn', 'number', ['number']), fnProto: cw('aw_fn_proto', null, ['number', 'number', 'number']),
      };
      this.prev = { special: 0, start: 0, select: 0, option: 0 };
      this.resPos = 0;
      this.last = 0;
      this.core = 'altirra';
    }

    static async boot(opt) {
      const m = await loadModule();
      const emu = new AltEmu(m, opt);
      const a = emu.aw;
      if (!a.init()) throw new Error('Altirra init failed');
      const o = (k, v) => a.opt('altirra_' + k, v);
      o('system', SYSTEM[opt.model] || 'auto');
      o('memory', RAM[opt.ram] || (opt.model === '800' ? '48K' : '64K'));
      o('video_standard', opt.tv === 'pal' ? 'pal' : 'ntsc');
      o('basic', opt.basicOn ? 'enabled' : 'disabled');
      // The OS and BASIC picked in the ROM selectors are what boots, same as the Atari800 core.
      const fwFile = (kind, bytes) => { const p = '/system/' + kind + '.rom'; m.FS.writeFile(p, bytes); a.fwCustom(kind, p); };
      if (opt.os) fwFile(opt.model === '800' ? 'os800' : 'osxl', opt.os);
      else o('os_firmware', 'internal');
      if (opt.basic) fwFile('basic', opt.basic);
      else o('basic_firmware', 'internal');
      o('sio_patch', opt.fastSio === false ? 'disabled' : 'enabled');
      o('stereo_pokey', opt.stereo ? 'enabled' : 'disabled');
      o('cpu', opt.cpu || '6502c');
      for (const [k, v] of Object.entries(opt.altirra || {})) o(k, v);
      if (!a.boot()) throw new Error('Altirra boot failed');
      try { m.FS.mkdir('/host'); } catch (e) { /* exists */ }
      for (const [n, b] of Object.entries(opt.host || {})) m.FS.writeFile('/host/' + n, b);
      a.host(1);
      if (opt.xep80) a.xep(1);
      a.reset(1);
      return emu;
    }

    hostFiles() {
      const out = {};
      for (const n of this.m.FS.readdir('/host')) if (n !== '.' && n !== '..') out[n] = this.m.FS.readFile('/host/' + n);
      return out;
    }
    hostWrite(name, bytes) { this.m.FS.writeFile('/host/' + name, bytes); }
    hostDelete(name) { this.m.FS.unlink('/host/' + name); }

    clearInput() {}

    // Virtual FujiNet ($70): the core's SIO device calls back into FujiNet.sio().
    fnAttach(fn) {
      const a = this.aw;
      for (const [c, d, l] of fn.proto) a.fnProto(c, d, l);
      this.m.fnSio = (cmd, dstats, aux, buf, len) => fn.sio(cmd, dstats, aux, buf, len);
      this.fnDevice(fn.enabled);
    }
    fnDevice(on) { this.aw.fn(on ? 1 : 0); }
    fnMem() { return this.m.HEAPU8; }

    // Same input model as AC.Emu (held fields + key FIFO), delivered to Altirra's POKEY/GTIA instead of libatari800.
    applyInput() {
      const a = this.aw;
      const merged = {};
      for (const [id, k] of this.keys) {
        for (const [f, v] of Object.entries(k.fields)) {
          if (f === 'joy0' || f === 'joy1') merged[f] = (merged[f] || 0) | v;
          else merged[f] = v;
        }
        if (k.ttl !== Infinity && --k.ttl <= 0) this.keys.delete(id);
      }
      let key = null;
      if (this.gap > 0) this.gap--;
      else {
        const cur = this.kq[0];
        if (cur) {
          if (cur.age === 0) key = cur.fields;
          Object.assign(merged, cur.fields);
          if (++cur.age >= 3 && !cur.held) { this.kq.shift(); this.gap = 2; }
        }
      }
      const p = this.prev;
      const sp = merged.special || 0;
      if (sp !== p.special) {
        if (sp === 2) a.reset(0);
        else if (sp === 3) a.reset(1);
        a.brk(sp === 5 ? 1 : 0);
        p.special = sp;
      }
      [['start', 1], ['select', 2], ['option', 4]].forEach(([f, bit]) => {
        const v = merged[f] ? 1 : 0;
        if (v !== p[f]) { a.con(bit, v); p[f] = v; }
      });
      for (let port = 0; port < 2; port++) {
        const j = merged['joy' + port] || 0, t = merged['trig' + port];
        let mask = 0;
        // libatari800 bits: 1 up, 2 down, 4 left, 8 right. Pressed joystick lines read 0 only for the quadrature mice, which send joy|trig the same way.
        if (j & 1) mask |= UP;
        if (j & 2) mask |= DOWN;
        if (j & 4) mask |= LEFT;
        if (j & 8) mask |= RIGHT;
        if (t) mask |= FIRE;
        a.joy(port, mask);
      }
      if (key) this.sendKey(key);
    }

    sendKey(f) {
      const a = this.aw;
      if (f.keycode) { a.scan(f.keycode); return; }
      const c = f.keychar;
      if (!c) return;
      if (SPECIAL_CHAR[c] != null) { a.scan(SPECIAL_CHAR[c] | (f.shift ? 0x40 : 0) | (f.control ? 0x80 : 0)); return; }
      if (c >= 1 && c <= 26) { a.scan(LETTER[c - 1] | 0x80 | (f.shift ? 0x40 : 0)); return; }
      const sc = a.chScan(c);
      if (sc >= 0) a.scan(f.control ? sc | 0x80 : sc);
    }

    // Activity from the core's indicator hooks: ids 0-7 are D1-D8, 15-17 are H:/IDE/PCLink, 18 flash, 19 cartridge.
    pollActivity() {
      if (!this.onActivity) return;
      const ids = { 15: 'H', 16: 'H', 17: 'H', 19: 'K1' };
      for (let i = 0; i < 20; i++) {
        const v = this.aw.act(i);
        if (!v) continue;
        const id = i < 8 ? 'D' + (i + 1) : ids[i];
        if (id) this.onActivity(id, v & 1 ? 'wr' : i < 8 ? 'ot' : 'rd');
      }
    }

    frame() {
      this.applyInput();
      this.aw.run();
      this.pollActivity();
      this.frames++;
      if (this.onAudio) this.pushAudio();
    }

    // Altirra gives stereo 48 kHz; resample to 44.1 kHz, keeping both channels when stereo POKEY is on and mixing down otherwise.
    pushAudio() {
      const a = this.aw, n = a.afr();
      if (!n) return;
      const src = new Int16Array(this.m.HEAPU8.buffer, this.aw.audio(), n * 2);
      const step = 48000 / 44100, st = !!this.opt.stereo;
      const out = [];
      let pos = this.resPos;
      while (pos < n - 1) {
        const i = pos | 0, fr = pos - i;
        if (st) {
          for (let c = 0; c < 2; c++) out.push(src[i * 2 + c] + (src[i * 2 + 2 + c] - src[i * 2 + c]) * fr);
        } else {
          const s0 = (src[i * 2] + src[i * 2 + 1]) * 0.5, s1 = (src[i * 2 + 2] + src[i * 2 + 3]) * 0.5;
          out.push(s0 + (s1 - s0) * fr);
        }
        pos += step;
      }
      this.resPos = pos - n;
      this.onAudio(Int16Array.from(out), st ? 2 : 1);
    }

    screenHash() {
      const p = this.aw.frame(), pitch = this.aw.pitch(), h = this.aw.fh();
      const b = this.m.HEAPU8;
      let x = 0;
      for (let i = 0; i < pitch * h; i += 29) x = (x * 31 + b[p + i]) | 0;
      return x;
    }

    // XEP80 80-column output (560 px wide), shared with the Atari800 core's interface. Returns 0 until the adapter has a valid signal.
    xepHeight() {
      if (!this.opt.xep80) return 0;
      this.xepOk = !!this.aw.xepUpdate();
      return this.xepOk ? this.aw.xepH() : 0;
    }

    xepRender(img32, _palette, _phase) {
      const w = this.aw.xepW(), h = this.aw.xepH();
      if (!this.xepOk || !w || !h) return 0;
      const src = new Uint32Array(this.m.HEAPU8.buffer, this.aw.xepFrame(), w * h);
      const cw = Math.min(w, 560);
      for (let y = 0; y < h; y++) img32.set(src.subarray(y * w, y * w + cw), y * 560);
      return h;
    }

    render(img32, _palette) {
      const a = this.aw, w = Math.min(a.fw(), W), h = Math.min(a.fh(), H), pitch = a.pitch();
      const p = a.frame();
      const src = new Uint32Array(this.m.HEAPU8.buffer, p, (pitch >> 2) * a.fh());
      const stride = pitch >> 2, y0 = (H - h) >> 1, x0 = (W - w) >> 1;
      img32.fill(0xff000000);
      for (let y = 0; y < h; y++) {
        let o = (y0 + y) * W + x0, s = y * stride;
        for (let x = 0; x < w; x++, o++, s++) {
          const v = src[s];
          img32[o] = 0xff000000 | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
        }
      }
    }

    path(prefix, n, name) { return '/' + prefix + n + '_' + name.replace(/[^\w.]/g, '_'); }

    mountDisk(n, name, bytes) {
      const path = this.path('d', n, name);
      this.m.FS.writeFile(path, bytes);
      (this.diskPaths || (this.diskPaths = {}))[n] = path;
      return this.aw.mount(n - 1, path, 3);
    }

    readDisk(n) {
      const path = this.diskPaths && this.diskPaths[n];
      if (!path) return null;
      const out = '/out_d' + n + '.atr';
      return this.aw.save(n - 1, out) ? this.m.FS.readFile(out) : this.m.FS.readFile(path);
    }

    ejectDisk(n) { this.aw.eject(n - 1); }

    detect(name, bytes) {
      const n = name.toLowerCase();
      if (/\.(xex|com|exe)$/.test(n)) return 6;
      if (/\.(car|rom|bin)$/.test(n)) return 9;
      if (/\.cas$/.test(n)) return 11;
      if (/\.atr$/.test(n)) return 1;
      if (/\.xfd$/.test(n)) return 2;
      if (/\.atx$/.test(n)) return 16;
      if (/\.pro$/.test(n)) return 15;
      return bytes[0] === 0xff && bytes[1] === 0xff ? 6 : 0;
    }

    tapeInsert(name, bytes) {
      const path = this.path('tape', '', name);
      this.m.FS.writeFile(path, bytes);
      return !!this.aw.tapeLoad(path);
    }
    tapeEject() { this.aw.tapeEject(); }
    tapeRewind() { this.aw.tapeRewind(); }
    tapeBoot() { this.aw.reset(1); this.aw.tapePlay(1); }
    tapeInfo() { return { status: 0, size: this.aw.tapeLen(), pos: this.aw.tapePos() }; }

    bootFile(name, bytes) {
      const path = this.path('boot', '', name);
      this.m.FS.writeFile(path, bytes);
      const ok = this.aw.load(path);
      this.aw.reset(1);
      return ok ? 1 : 0;
    }

    insertCart(slot, name, bytes) {
      const path = this.path('cart', slot, name);
      this.m.FS.writeFile(path, bytes);
      this.cartPaths = this.cartPaths || {};
      this.cartPaths[slot] = path;
      if (this.aw.cart(slot - 1, path, 0)) return { ok: true };
      return { ok: false, error: 'unknown cartridge format' };
    }
    cartTypes() { return []; }
    setCartType() {}
    ejectCart(slot) { this.aw.cartEject(slot - 1); }

    coldStart() { this.aw.reset(1); }
    warmStart() { this.aw.reset(0); }

    mem() {
      const p = this.aw.ram();
      return this.m.HEAPU8.subarray(p, p + Math.min(65536, this.aw.ramSize()));
    }

    snapshot() {
      const n = this.aw.stSize(), p = this.aw.alloc(n);
      const ok = this.aw.stSave(p, n);
      const out = ok ? this.m.HEAPU8.slice(p, p + n) : null;
      this.aw.free(p);
      return out;
    }

    restore(snap) {
      const p = this.aw.alloc(snap.length);
      this.m.HEAPU8.set(snap, p);
      this.aw.stLoad(p, snap.length);
      this.aw.free(p);
    }
  }

  AC.AltEmu = AltEmu;
})();
