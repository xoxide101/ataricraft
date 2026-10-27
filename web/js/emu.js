// Thin wrapper over the libatari800 reference core (WASM). One Emu = one booted machine.
window.AC = window.AC || {};
(function () {
  const INPUT_FIELDS = ['keychar', 'keycode', 'special', 'shift', 'control', 'start', 'select', 'option',
    'joy0', 'trig0', 'joy1', 'trig1', 'joy2', 'trig2', 'joy3', 'trig3', 'mousex', 'mousey', 'mouse_buttons', 'mouse_mode'];
  const STATE_SIZE = 128 + 128 + 210000;
  const SCREEN_W = 384, SCREEN_H = 240, VIS_X1 = 24, VIS_W = 336;

  const XL_RAM = [
    { v: '64', label: '64 KB', args: ['-xl'] },
    { v: '128', label: '128 KB (130XE)', args: ['-xe'] },
    { v: '320r', label: '320 KB (Rambo)', args: ['-rambo'] },
    { v: '320c', label: '320 KB (Compy-Shop)', args: ['-320xe'] },
    { v: '576', label: '576 KB', args: ['-576xe'] },
    { v: '1088', label: '1088 KB', args: ['-1088xe'] },
  ];
  const MODELS = {
    '800': { label: 'Atari 800', romFlag: '-osb_rom', osKind: '800', def: '48', ram: [{ v: '48', label: '48 KB', args: ['-atari'] }, { v: '52', label: '52 KB', args: ['-atari', '-c'] }] },
    '800xl': { label: 'Atari 800XL', romFlag: '-xlxe_rom', osKind: 'xl', def: '64', ram: XL_RAM },
    '65xe': { label: 'Atari 65XE', romFlag: '-xlxe_rom', osKind: 'xl', def: '64', ram: XL_RAM },
    '130xe': { label: 'Atari 130XE', romFlag: '-xlxe_rom', osKind: 'xl', def: '128', ram: XL_RAM },
    '1200xl': { label: 'Atari 1200XL', romFlag: '-xlxe_rom', osKind: 'xl', def: '64', ram: [{ v: '64', label: '64 KB', args: ['-1200'] }] },
  };

  class Emu {
    constructor(m, opt) {
      this.m = m;
      this.opt = opt;
      this.keys = new Map();
      this.kq = [];
      this.gap = 0;
      this.inp = m._malloc(64);
      this.statePtr = 0;
      this.frames = 0;
      this.seq = 0;
    }

    static async boot(opt) {
      const m = await AtariRef();
      const model = MODELS[opt.model];
      m.FS.writeFile('/os.rom', opt.os);
      const ram = model.ram.find((r) => r.v === opt.ram) || model.ram.find((r) => r.v === model.def);
      const args = ['atari800', opt.tv === 'pal' ? '-pal' : '-ntsc', ...ram.args, model.romFlag, '/os.rom', '-H1', '/host',       '-hreadwrite', '-mouse', 'touch', '-directmouse'];
      m.FS.mkdir('/host');
      for (const [n, b] of Object.entries(opt.host || {})) m.FS.writeFile('/host/' + n, b);
      if (opt.basic) {
        m.FS.writeFile('/basic.rom', opt.basic);
        args.push('-basic_rom', '/basic.rom', opt.basicOn ? '-basic' : '-nobasic');
      }
      if (opt.fastSio === false) args.push('-nopatch');
      if (opt.xep80) {
        m.FS.writeFile('/xep80.chr', Uint8Array.from(atob(AC.XEP80_CHR), (c) => c.charCodeAt(0)));
        args.push('-xep80', '-xep80port', '1');
      }
      const emu = new Emu(m, opt);
      const argv = m._malloc(args.length * 4);
      const dv = new DataView(m.HEAPU8.buffer);
      args.forEach((a, i) => dv.setUint32(argv + i * 4, emu.cstr(a), true));
      const ok = m._libatari800_init(args.length, argv);
      if (!ok) throw new Error('libatari800_init failed');
      emu.clearInput();
      return emu;
    }

    // H: device: a virtual host drive (the atari800 "H:" CIO handler) backed by an in-memory folder.
    hostFiles() {
      const out = {};
      for (const n of this.m.FS.readdir('/host')) if (n !== '.' && n !== '..') out[n] = this.m.FS.readFile('/host/' + n);
      return out;
    }
    hostWrite(name, bytes) { this.m.FS.writeFile('/host/' + name, bytes); }
    hostDelete(name) { this.m.FS.unlink('/host/' + name); }

    cstr(s) {
      const b = new TextEncoder().encode(s + '\0');
      const p = this.m._malloc(b.length);
      this.m.HEAPU8.set(b, p);
      return p;
    }

    clearInput() {
      this.m.HEAPU8.fill(0, this.inp, this.inp + 64);
    }

    // Held inputs merge: joystick bits OR together. Key presses (keychar/keycode) go through a FIFO so
    // overlapping or rapid presses each reach the OS, like a typeahead buffer.
    down(id, fields, ttl) {
      if (fields.keychar || fields.keycode) {
        this.kq.push({ id, fields, held: ttl == null, age: 0 });
        return;
      }
      this.keys.set(id, { fields, ttl: ttl == null ? Infinity : ttl });
    }

    up(id) {
      const q = this.kq.find((e) => e.id === id && e.held);
      if (q) { q.held = false; return; }
      const k = this.keys.get(id);
      if (k) k.ttl = 3;
    }

    tap(fields, frames = 4) {
      this.down('tap' + this.seq++, fields, frames);
    }

    applyInput() {
      const merged = {};
      for (const [id, k] of this.keys) {
        for (const [f, v] of Object.entries(k.fields)) {
          if (f === 'joy0' || f === 'joy1') merged[f] = (merged[f] || 0) | v;
          else merged[f] = v;
        }
        if (k.ttl !== Infinity && --k.ttl <= 0) this.keys.delete(id);
      }
      if (this.gap > 0) this.gap--;
      else {
        const cur = this.kq[0];
        if (cur) {
          Object.assign(merged, cur.fields);
          if (++cur.age >= 3 && !cur.held) { this.kq.shift(); this.gap = 2; }
        }
      }
      const h = this.m.HEAPU8;
      h.fill(0, this.inp, this.inp + 64);
      INPUT_FIELDS.forEach((f, i) => { if (merged[f]) h[this.inp + i] = merged[f] & 0xff; });
    }

    frame() {
      this.applyInput();
      this.m._libatari800_next_frame(this.inp);
      this.frames++;
      if (this.onAudio) {
        const n = this.m._libatari800_get_sound_buffer_len() & ~1;
        if (n) {
          const p = this.m._libatari800_get_sound_buffer();
          this.onAudio(new Int16Array(this.m.HEAPU8.slice(p, p + n).buffer));
        }
      }
    }

    run(n) {
      for (let i = 0; i < n; i++) this.frame();
    }

    // Cheap fingerprint of the visible text area, used to tell when the machine has gone quiet.
    screenHash() {
      const p = this.m._libatari800_get_screen_ptr();
      const h = this.m.HEAPU8;
      let x = 0;
      for (let i = 0; i < 384 * 240; i += 7) x = (x * 31 + h[p + i]) | 0;
      return x;
    }

    // XEP80 80-column output: 560 px wide, two blink phases (0/1). Returns the height, or 0 when the XEP80 is off.
    xepHeight() { return this.m._ac_xep80_enabled ? (this.m._ac_xep80_enabled() ? this.m._ac_xep80_height() : 0) : 0; }

    xepRender(img32, palette, phase) {
      const h = this.xepHeight();
      const p = this.m._ac_xep80_screen(phase ? 1 : 0);
      const src = this.m.HEAPU8;
      for (let i = 0, n = 560 * h; i < n; i++) img32[i] = palette[src[p + i]];
      return h;
    }

    render(img32, palette) {
      const p = this.m._libatari800_get_screen_ptr();
      const src = this.m.HEAPU8;
      let o = 0;
      for (let y = 0; y < SCREEN_H; y++) {
        const row = p + y * SCREEN_W + VIS_X1;
        for (let x = 0; x < VIS_W; x++) img32[o++] = palette[src[row + x]];
      }
    }

    mountDisk(n, name, bytes) {
      const path = '/d' + n + '_' + name.replace(/[^\w.]/g, '_');
      this.m.FS.writeFile(path, bytes);
      (this.diskPaths || (this.diskPaths = {}))[n] = path;
      return this.m._libatari800_mount_disk_image(n, this.cstr(path), 0);
    }

    // Dismount to flush pending writes, read the image back, then remount it.
    readDisk(n) {
      const path = this.diskPaths && this.diskPaths[n];
      if (!path) return null;
      this.m._ac_disk_eject(n);
      const out = this.m.FS.readFile(path);
      this.m._libatari800_mount_disk_image(n, this.cstr(path), 0);
      return out;
    }

    // AFILE_* code from file content: 1 ATR, 2 XFD, 3 ATR.GZ, 4 XFD.GZ, 5 DCM, 6 XEX, 7 BAS, 8 LST, 9 CART, 10 ROM, 11 CAS, 12 boot tape, 13/14 state, 15 PRO, 16 ATX, 0 unknown.
    detect(name, bytes) {
      const path = '/probe_' + name.replace(/[^\w.]/g, '_');
      this.m.FS.writeFile(path, bytes);
      const t = this.m._ac_detect(this.cstr(path));
      this.m.FS.unlink(path);
      return t;
    }

    tapeInsert(name, bytes) {
      const path = '/tape_' + name.replace(/[^\w.]/g, '_');
      this.m.FS.writeFile(path, bytes);
      return !!this.m._ac_tape_insert(this.cstr(path));
    }
    tapeEject() { this.m._ac_tape_eject(); }
    tapeRewind() { this.m._ac_tape_rewind(); }
    tapeBoot() { this.m._ac_tape_boot(); }
    tapeInfo() { return { status: this.m._ac_tape_status(), size: this.m._ac_tape_size(), pos: this.m._ac_tape_pos() }; }

    bootFile(name, bytes) {
      const path = '/boot_' + name.replace(/[^\w.]/g, '_');
      this.m.FS.writeFile(path, bytes);
      return this.m._libatari800_reboot_with_file(this.cstr(path));
    }

    // Cartridge slots: 1 = main (right), 2 = left. Returns {ok, kb?} - kb set when the type must be chosen.
    insertCart(slot, name, bytes) {
      const path = '/cart' + slot + '_' + name.replace(/[^\w.]/g, '_');
      this.m.FS.writeFile(path, bytes);
      const r = this.m._ac_cart_insert(slot, this.cstr(path));
      if (r < 0) return { ok: false, error: { '-1': 'cannot open', '-2': 'unknown cartridge format', '-4': 'too little data' }[r] || 'error ' + r };
      return r > 0 ? { ok: true, kb: r } : { ok: true };
    }

    cartTypes(kb) {
      const out = [];
      for (let i = 1; i < this.m._ac_cart_type_count(); i++)
        if (this.m._ac_cart_type_kb(i) === kb) out.push({ id: i, name: this.m.ccall('ac_cart_type_desc', 'string', ['number'], [i]) });
      return out;
    }

    setCartType(slot, type) { this.m._ac_cart_set_type(slot, type); }
    ejectCart(slot) { this.m._ac_cart_eject(slot); }
    ejectDisk(n) { this.m._ac_disk_eject(n); }

    coldStart() { this.tap({ special: 3 }, 2); }
    warmStart() { this.tap({ special: 2 }, 2); }

    mem() {
      const p = this.m._libatari800_get_main_memory_ptr();
      return this.m.HEAPU8.subarray(p, p + 65536);
    }

    peek(addr, len = 1) { return Array.from(this.mem().subarray(addr, addr + len)); }
    poke(addr, bytes) { this.mem().set(bytes, addr); }

    // Read the text screen via the display-list-independent screen pointer (SAVMSC). Works for ANTIC mode 2 text.
    screenText() {
      const mem = this.mem();
      const base = mem[0x58] | (mem[0x59] << 8);
      const lines = [];
      for (let r = 0; r < 24; r++) {
        let s = '';
        for (let c = 0; c < 40; c++) {
          const code = mem[(base + r * 40 + c) & 0xffff] & 0x7f;
          s += code < 0x40 ? String.fromCharCode(code + 32) : code >= 0x61 && code <= 0x7a ? String.fromCharCode(code) : '.';
        }
        lines.push(s.replace(/\s+$/, ''));
      }
      return lines.join('\n').replace(/\n+$/, '');
    }

    snapshot() {
      if (!this.statePtr) this.statePtr = this.m._malloc(STATE_SIZE);
      this.m._libatari800_get_current_state(this.statePtr);
      return this.m.HEAPU8.slice(this.statePtr, this.statePtr + STATE_SIZE);
    }

    restore(snap) {
      if (!this.statePtr) this.statePtr = this.m._malloc(STATE_SIZE);
      this.m.HEAPU8.set(snap, this.statePtr);
      this.m._libatari800_restore_state(this.statePtr);
    }
  }

  AC.Emu = Emu;
  AC.MODELS = MODELS;
  AC.SCREEN = { w: VIS_W, h: SCREEN_H };
})();
