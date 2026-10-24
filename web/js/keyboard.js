// On-screen Atari keyboard. Legends are drawn from the Atari's own character set (read from the OS ROM),
// so shifted and Ctrl glyphs show what the key really types.
window.AC = window.AC || {};
(function () {
  // ATASCII code -> screen code (character set index)
  const a2s = (a) => (a < 0x20 ? a + 0x40 : a < 0x60 ? a - 0x20 : a);
  const code = (ch) => ch.charCodeAt(0);
  const C = (ch) => a2s(code(ch));

  function letter(ch) {
    const i = code(ch) - 97;
    const up = ch.toUpperCase();
    return {
      id: ch, base: C(ch), shift: C(up), ctrl: a2s(1 + i),
      send: (sh, ct) => (ct ? { keychar: 1 + i, shift: sh ? 1 : 0 } : { keychar: code(sh ? up : ch) }),
    };
  }

  function sym(b, s, ctrlScreen, ctrlSend) {
    return {
      id: b, base: C(b), shift: s ? C(s) : null, ctrl: ctrlScreen == null ? null : ctrlScreen,
      send: (sh, ct) => (ct ? (ctrlSend || { keychar: code(b), control: 1 }) : { keychar: code(sh && s ? s : b) }),
    };
  }

  function txt(id, text, w, send, extra) {
    return Object.assign({ id, text, w: w || 1, send }, extra);
  }

  const digits = '1234567890'.split('');
  const shiftDigits = '!"#$%&\'@()'.split('');

  const ROWS = [
    [
      txt('esc', 'Esc', 1.3, () => ({ keychar: 27 })),
      ...digits.map((d, i) => sym(d, shiftDigits[i], null)),
      txt('lt', '<', 1, (sh) => (sh ? { keycode: 0x76 } : { keychar: code('<') }), { shiftText: 'Clear' }),
      txt('gt', '>', 1, (sh) => (sh ? { keycode: 0x77 } : { keychar: code('>') }), { shiftText: 'Insert' }),
      txt('bksp', 'BkSp', 1.4, (sh, ct) => (sh ? { keycode: 0x74 } : ct ? { keycode: 0xb4 } : { keychar: 8 }), { shiftText: 'Delete' }),
      txt('break', 'Break', 1.4, () => ({ special: 5 })),
    ],
    [
      txt('tab', 'Tab', 1.6, () => ({ keychar: 9 })),
      ...'qwertyuiop'.split('').map(letter),
      sym('-', '_', a2s(28), { keycode: 0x8e }),
      sym('=', '|', a2s(29), { keycode: 0x8f }),
      txt('return', 'Return', 1.9, () => ({ keychar: 10 })),
    ],
    [
      txt('control', 'Control', 1.9, null, { latch: 'ctrl' }),
      ...'asdfghjkl'.split('').map(letter),
      sym(';', ':', a2s(0x7b)),
      sym('+', '\\', a2s(30), { keycode: 0x86 }),
      sym('*', '^', a2s(31), { keycode: 0x87 }),
      txt('caps', 'Caps', 1.4, () => ({ keycode: 0x3c })),
    ],
    [
      txt('shift', 'Shift', 2.4, null, { latch: 'shift' }),
      ...'zxcvbnm'.split('').map(letter),
      sym(',', '[', a2s(0)),
      sym('.', ']', a2s(0x60)),
      sym('/', '?', null),
      txt('shift2', 'Shift', 2.4, null, { latch: 'shift' }),
      txt('inv', 'Inverse', 1.4, () => ({ keycode: 0x27 })),
    ],
    [txt('space', 'Space', 8, () => ({ keychar: 32 }), { space: true })],
  ];

  // Console keys sit in a separate cluster right of the main keyboard.
  // 1200XL adds 12 function keys above; only F1-F4 are mapped (a guess), F5-F12 are inert until verified.
  const SIDE = (power) => [
    txt('reset', 'Reset', 1, () => ({ special: 2 })), txt('option', 'Option', 1, () => ({ option: 1 })),
    txt('select', 'Select', 1, () => ({ select: 1 })), txt('start', 'Start', 1, () => ({ start: 1 })),
    txt('help', 'Help', 1, () => ({ keycode: 0x11 })),
    ...(power ? [txt('power', 'Power', 1, () => ({ special: 3 }))] : []),
  ].map((k) => Object.assign([k], { side: true }));
  const FKEYS = () => [Array.from({ length: 12 }, (_, i) => {
    const m = [{ special: 2 }, { option: 1 }, { select: 1 }, { start: 1 }][i];
    return txt('f' + (i + 1), 'F' + (i + 1), 1, () => m || {});
  })];
  const INV_TEXT = 'Atari';

  let charset = null;
  let glyphs = [];

  function drawGlyph(cv, screenCode, color) {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 8, 8);
    if (screenCode == null || !charset) return;
    const img = g.createImageData(8, 8);
    const d = new DataView(img.data.buffer);
    for (let y = 0; y < 8; y++) {
      const byte = charset[(screenCode & 0x7f) * 8 + y];
      for (let x = 0; x < 8; x++) if (byte & (0x80 >> x)) d.setUint32((y * 8 + x) * 4, color, true);
    }
    g.putImageData(img, 0, 0);
  }

  function glyphCanvas(cls, screenCode, color) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 8;
    cv.className = 'g ' + cls;
    glyphs.push({ cv, screenCode, color });
    return cv;
  }

  const COLORS = { base: 0xff202020, shift: 0xff1a70d6, ctrl: 0xff9a7d00 };

  AC.keyboard = {
    latch: { shift: false, ctrl: false },
    phys: { shift: false, ctrl: false },
    eff(k) { return this.latch[k] || this.phys[k]; },

    keyById(id) {
      for (const row of [...ROWS, ...SIDE(true)]) { const k = row.find((x) => x.id === id); if (k) return k; }
      return null;
    },

    keyForChar(ch) {
      const c = ch.charCodeAt(0);
      for (const row of [...ROWS, ...SIDE(true)]) {
        for (const k of row) {
          if (!k.send || k.latch) continue;
          const f = k.send(false, false) || {};
          const s = k.send(true, false) || {};
          if (f.keychar === c || s.keychar === c) return k.id;
        }
      }
      return null;
    },

    setCharset(bytes) {
      charset = bytes;
      try { localStorage.setItem('ac.charset', btoa(String.fromCharCode(...bytes))); } catch (e) {}
      glyphs.forEach((e) => drawGlyph(e.cv, e.screenCode, e.color));
    },

    restoreCharset() {
      try {
        const s = localStorage.getItem('ac.charset');
        if (s) charset = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      } catch (e) {}
    },

    // Cursor keys are Control+- / = / + / * on the Atari: up, down, left, right.
    // compact=true: single strip (arrows, Return, Esc, Space, BkSp); otherwise a full pad with D-pad and console keys.
    buildArrows(el, h, compact) {
      el.innerHTML = '';
      const A = {
        up: ['▲', () => ({ keycode: 0x8e })], down: ['▼', () => ({ keycode: 0x8f })],
        left: ['◀', () => ({ keycode: 0x86 })], right: ['▶', () => ({ keycode: 0x87 })],
        ret: ['Return', () => ({ keychar: 10 })], esc: ['Esc', () => ({ keychar: 27 })],
        space: ['Space', () => ({ keychar: 32 })], bksp: ['BkSp', () => ({ keychar: 8 })], tab: ['Tab', () => ({ keychar: 9 })],
        brk: ['Break', () => ({ special: 5 })], start: ['Start', () => ({ start: 1 })], select: ['Select', () => ({ select: 1 })],
        option: ['Option', () => ({ option: 1 })], help: ['Help', () => ({ keycode: 0x11 })], reset: ['Reset', () => ({ special: 2 })],
        ctrlc: ['Ctrl-C', () => ({ keychar: 3 })],
      };
      const btn = (id, cls) => {
        const b = document.createElement('button');
        b.className = 'key akey ' + (cls || '') + ' a-' + id;
        b.textContent = A[id][0];
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); h.down('arr:' + id, A[id][1]()); b.classList.add('down'); });
        const up = () => { if (!b.classList.contains('down')) return; b.classList.remove('down'); h.up('arr:' + id); };
        b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
        return b;
      };
      const mk = (cls, ids) => { const d = document.createElement('div'); d.className = cls; ids.forEach((i) => d.append(btn(i))); return d; };
      if (compact) { el.append(mk('amini', ['left', 'down', 'up', 'right', 'ret', 'esc', 'space', 'bksp'])); return; }
      const dpad = document.createElement('div');
      dpad.className = 'dpad';
      dpad.append(btn('up'), btn('left'), btn('down'), btn('right'));
      el.append(dpad, mk('aside', ['ret', 'esc', 'space', 'bksp', 'tab', 'brk', 'ctrlc', 'help']), mk('aside con', ['start', 'select', 'option', 'reset']));
    },

    build(el, h, layout) {
      this.layout = layout || this.layout || '130xe';
      el.innerHTML = '';
      glyphs = [];
      const latchEls = { shift: [], ctrl: [] };
      const refresh = () => {
        for (const k of ['shift', 'ctrl']) latchEls[k].forEach((b) => b.classList.toggle('on', this.eff(k)));
        el.dataset.layer = this.eff('ctrl') ? 'ctrl' : this.eff('shift') ? 'shift' : 'base';
      };
      this.refresh = refresh;
      const main = document.createElement('div');
      main.className = 'kmain';
      const side = document.createElement('div');
      side.className = 'kside';
      el.append(main, side);
      const is1200 = this.layout === '1200xl';
      [...(is1200 ? FKEYS() : []), ...ROWS, ...SIDE(is1200)].forEach((row) => {
        row.forEach((k) => { if (k.id === 'inv') k.text = INV_TEXT; });
        const r = document.createElement('div');
        r.className = 'krow';
        row.forEach((k) => {
          const b = document.createElement('button');
          b.className = 'key' + (k.space ? ' space' : '') + (k.gap ? ' gap' : '');
          b.style.flex = String(k.w || 1);
          b.dataset.id = k.id;
          if (k.base != null) {
            if (k.shift != null) b.append(glyphCanvas('shift', k.shift, COLORS.shift));
            if (k.ctrl != null) b.append(glyphCanvas('ctrl', k.ctrl, COLORS.ctrl));
            b.append(glyphCanvas('base', k.base, COLORS.base));
          } else {
            if (k.shiftText) { const s = document.createElement('span'); s.className = 't shift'; s.textContent = k.shiftText; b.append(s); }
            const t = document.createElement('span');
            t.className = 't base';
            t.textContent = k.text;
            b.append(t);
          }
          if (k.latch) {
            latchEls[k.latch].push(b);
            b.addEventListener('click', () => { this.latch[k.latch] = !this.latch[k.latch]; refresh(); });
          } else {
            b.addEventListener('pointerdown', (e) => {
              e.preventDefault();
              b.setPointerCapture(e.pointerId);
              h.down('kbd:' + k.id, k.send(this.eff('shift'), this.eff('ctrl')));
              b.classList.add('down');
            });
            const up = () => {
              if (!b.classList.contains('down')) return;
              b.classList.remove('down');
              h.up('kbd:' + k.id);
              this.latch.shift = this.latch.ctrl = false;
              refresh();
            };
            b.addEventListener('pointerup', up);
            b.addEventListener('pointercancel', up);
          }
          r.append(b);
        });
        (row.side ? side : main).append(r);
      });
      refresh();
      glyphs.forEach((e) => drawGlyph(e.cv, e.screenCode, e.color));
    },
  };
})();
