// Atari CX2620 "BASIC Programming" (2600) emulator, language-level.
// Rules follow the CX2620 manual: 2-digit wrapping numbers, single-letter variables,
// auto-numbered one-statement lines, 63-symbol memory, six display regions.
(function (root) {
  'use strict';

  const KEYWORDS = ['IF', 'THEN', 'ELSE', 'GOTO', 'PRINT', 'CLEAR', 'NOTE', 'KEY', 'HIT', 'MOD', 'HOR1', 'VER1', 'HOR2', 'VER2'];
  const SPECIAL_VARS = ['NOTE', 'HOR1', 'VER1', 'HOR2', 'VER2'];
  const SPEEDS = [1, 8, 30, 60];
  const MEM = 63;
  const wrap = (n) => ((Math.trunc(n) % 100) + 100) % 100;

  // Lines are arrays of tokens. A string literal is one token starting with '"'.
  function tokenize(text) {
    const out = [];
    const re = /"[^"]*"?|HOR[12]|VER[12]|[A-Z]+|\d|<-|←|[+\-×÷*\/=<>(),]/gi;
    let m;
    while ((m = re.exec(text.toUpperCase().replace(/"[^"]*"?/g, (s) => s.replace(/[a-z]/g, (c) => c))))) {
      let t = m[0];
      if (t === '<-') t = '←';
      else if (t === '*') t = '×';
      else if (t === '/') t = '÷';
      else if (t === '-') t = '−';
      if (/^[A-Z]+$/.test(t) && !KEYWORDS.includes(t)) t.split('').forEach((c) => out.push(c));
      else out.push(t);
    }
    return out;
  }

  function cost(tokens) {
    return tokens.reduce((n, t) => n + (t[0] === '"' ? t.length : 1), 0);
  }

  class Core {
    constructor() {
      this.lines = [[]];
      this.speed = 30;
      this.resetValues();
      this.running = false;
      this.view = { STATUS: 1, PROGRAM: 1, STACK: 1, VARIABLES: 1, OUTPUT: 1, GRAPHICS: 1 };
      this.titles = false;
      this.keyDown = 0;
      this.onNote = null;
    }

    resetValues() {
      this.vars = {};
      for (let i = 0; i < 26; i++) this.vars[String.fromCharCode(65 + i)] = 0;
      this.hor1 = this.ver1 = this.hor2 = this.ver2 = 0;
      this.note = 0;
      this.pc = 0;
      this.output = [''];
      this.stack = [];
      this.halted = false;
      this.error = '';
      this.continued = false;
      if (this.onNote) this.onNote(0);
    }

    eraseAll() {
      this.lines = [[]];
      this.running = false;
      this.resetValues();
    }

    get used() {
      return this.lines.reduce((n, l) => n + cost(l), 0);
    }
    get remaining() {
      return MEM - this.used;
    }
    get cur() {
      return this.lines[this.lines.length - 1];
    }

    // Program entry: returns false when memory is full.
    addToken(t) {
      const cur = this.cur;
      const last = cur[cur.length - 1];
      const inString = last && last[0] === '"' && (last.length < 2 || last[last.length - 1] !== '"');
      if (inString) {
        const c = t === 'SPACE' ? ' ' : t.length === 1 ? t : null;
        if (c === null) return false;
        if (this.remaining < 1) return false;
        cur[cur.length - 1] = last + c;
        return true;
      }
      if (t === 'SPACE') return false;
      if (this.remaining < 1) return false;
      if (t === '"') {
        cur.push('"');
        return true;
      }
      cur.push(t);
      return true;
    }

    closeString() {
      const cur = this.cur;
      const last = cur[cur.length - 1];
      if (last && last[0] === '"' && last.length >= 1 && !(last.length > 1 && last.endsWith('"'))) return false;
      return true;
    }

    newLine() {
      if (this.cur.length) this.lines.push([]);
    }

    eraseLast() {
      const cur = this.cur;
      if (cur.length) {
        const last = cur[cur.length - 1];
        if (last[0] === '"' && last.length > 1) cur[cur.length - 1] = last.slice(0, -1);
        else cur.pop();
      } else if (this.lines.length > 1) {
        this.lines.pop();
        this.lines[this.lines.length - 1].pop();
      }
    }

    loadText(text) {
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.replace(/^\s*\d+\s+(?=\D)/, ''))
        .map(tokenize)
        .filter((l) => l.length);
      if (lines.reduce((n, l) => n + cost(l), 0) > MEM) throw new Error('program exceeds ' + MEM + ' symbols');
      this.lines = lines.concat([[]]);
      this.running = false;
      this.resetValues();
    }

    static lineText(tokens) {
      let s = '';
      tokens.forEach((t, i) => {
        const prev = tokens[i - 1];
        const digits = /^\d$/.test(t) && prev && /^\d$/.test(prev);
        s += (i && !digits ? ' ' : '') + (t[0] === '"' && !t.endsWith('"') || t === '"' ? t : t);
      });
      return s;
    }

    text() {
      return this.lines
        .filter((l) => l.length)
        .map((l, i) => i + 1 + ' ' + Core.lineText(l))
        .join('\n');
    }

    programLines() {
      return this.lines.filter((l) => l.length);
    }

    // ---- execution ----
    run() {
      if (this.halted || this.pc >= this.programLines().length) {
        const keep = this.output;
        this.resetValues();
        this.output = keep;
      }
      this.running = true;
    }
    halt() {
      this.running = false;
    }
    reset() {
      this.resetValues();
    }

    step() {
      const prog = this.programLines();
      if (this.pc >= prog.length) {
        this.halted = true;
        this.running = false;
        return;
      }
      const tokens = prog[this.pc];
      const line = this.pc + 1;
      this.pc++;
      this.stack = [];
      try {
        this.exec(tokens, 0, line);
      } catch (e) {
        this.error = 'ERROR ' + line;
        this.halted = true;
        this.running = false;
      }
      if (this.pc >= prog.length) {
        this.halted = true;
        this.running = false;
      }
    }

    tick(dt) {
      if (!this.running) return;
      this._acc = (this._acc || 0) + dt * this.speed;
      let n = 0;
      while (this._acc >= 1 && this.running && n++ < 200) {
        this._acc -= 1;
        this.step();
      }
    }

    exec(t, i, line) {
      const st = { t, i, line };
      this.statement(st);
      if (st.i < t.length) throw new Error('trailing');
    }

    statement(st) {
      const t = st.t;
      const tok = t[st.i];
      if (tok === undefined) throw new Error('empty');
      if (tok === 'IF') {
        st.i++;
        const c = this.expr(st);
        if (t[st.i++] !== 'THEN') throw new Error('THEN');
        let elseAt = -1;
        for (let k = st.i, d = 0; k < t.length; k++) {
          if (t[k] === 'IF') d++;
          else if (t[k] === 'ELSE') {
            if (d === 0) {
              elseAt = k;
              break;
            }
            d--;
          }
        }
        const end = elseAt < 0 ? t.length : elseAt;
        if (c !== 0) {
          this.statement({ t: t.slice(0, end), i: st.i, line: st.line });
        } else if (elseAt >= 0) {
          this.statement({ t, i: elseAt + 1, line: st.line });
        }
        st.i = t.length;
        return;
      }
      if (tok === 'GOTO') {
        st.i++;
        const n = this.expr(st);
        const count = this.programLines().length;
        this.pc = n >= 1 && n <= count ? n - 1 : count;
        return;
      }
      if (tok === 'PRINT') {
        st.i++;
        this.printItems(st);
        return;
      }
      if (tok === 'CLEAR') {
        st.i++;
        this.output = [''];
        return;
      }
      if (/^[A-Z]$/.test(tok) || SPECIAL_VARS.includes(tok)) {
        st.i++;
        if (t[st.i++] !== '←') throw new Error('←');
        const v = wrap(this.expr(st));
        this.assign(tok, v);
        return;
      }
      throw new Error('syntax');
    }

    assign(name, v) {
      if (name === 'NOTE') {
        this.note = v;
        if (this.onNote) this.onNote(v);
      } else if (name === 'HOR1') this.hor1 = v;
      else if (name === 'VER1') this.ver1 = v;
      else if (name === 'HOR2') this.hor2 = v;
      else if (name === 'VER2') this.ver2 = v;
      else this.vars[name] = v;
    }

    printItems(st) {
      const t = st.t;
      let more = false;
      for (;;) {
        const tok = t[st.i];
        if (tok === undefined) break;
        let s;
        if (tok[0] === '"') {
          s = tok.slice(1, tok.endsWith('"') && tok.length > 1 ? -1 : undefined);
          st.i++;
        } else s = String(this.expr(st)).padStart(2, '0');
        this.out(s);
        more = false;
        if (t[st.i] === ',') {
          st.i++;
          more = true;
          if (t[st.i] === undefined) break;
        } else break;
      }
      if (!more || false) {
        this.output.push('');
        if (this.output.length > 40) this.output.shift();
      }
    }

    out(s) {
      const w = 20;
      let cur = this.output[this.output.length - 1];
      for (const c of s) {
        if (cur.length >= w) {
          this.output.push('');
          cur = '';
        }
        cur += c;
        this.output[this.output.length - 1] = cur;
      }
    }

    // priority: × ÷ , + −, MOD, = > <
    expr(st) {
      let a = this.mod(st);
      const t = st.t;
      while (t[st.i] === '=' || t[st.i] === '>' || t[st.i] === '<') {
        const op = t[st.i++];
        const b = this.mod(st);
        a = op === '=' ? +(a === b) : op === '>' ? +(a > b) : +(a < b);
        this.stack.push(a);
      }
      return a;
    }
    mod(st) {
      let a = this.add(st);
      while (st.t[st.i] === 'MOD') {
        st.i++;
        const b = this.add(st);
        a = b === 0 ? 0 : a % b;
        this.stack.push(a);
      }
      return a;
    }
    add(st) {
      let a = this.mul(st);
      while (st.t[st.i] === '+' || st.t[st.i] === '−') {
        const op = st.t[st.i++];
        const b = this.mul(st);
        a = wrap(op === '+' ? a + b : a - b);
        this.stack.push(a);
      }
      return a;
    }
    mul(st) {
      let a = this.prim(st);
      while (st.t[st.i] === '×' || st.t[st.i] === '÷') {
        const op = st.t[st.i++];
        const b = this.prim(st);
        a = op === '×' ? wrap(a * b) : b === 0 ? 0 : Math.trunc(a / b);
        this.stack.push(a);
      }
      return a;
    }
    prim(st) {
      const t = st.t;
      const tok = t[st.i];
      if (tok === undefined) throw new Error('operand');
      if (tok === '(') {
        st.i++;
        const v = this.expr(st);
        if (t[st.i++] !== ')') throw new Error(')');
        return v;
      }
      if (/^\d$/.test(tok)) {
        let n = 0;
        let digits = 0;
        while (t[st.i] !== undefined && /^\d$/.test(t[st.i])) {
          n = n * 10 + +t[st.i++];
          digits++;
        }
        return wrap(n);
      }
      st.i++;
      if (/^[A-Z]$/.test(tok)) return this.vars[tok];
      if (tok === 'NOTE') return this.note;
      if (tok === 'HOR1') return this.hor1;
      if (tok === 'VER1') return this.ver1;
      if (tok === 'HOR2') return this.hor2;
      if (tok === 'VER2') return this.ver2;
      if (tok === 'KEY') return this.keyDown;
      if (tok === 'HIT') return +(this.hor1 === this.hor2 && this.ver1 === this.ver2);
      throw new Error('operand');
    }

    slower() {
      const i = SPEEDS.indexOf(this.speed);
      this.speed = SPEEDS[Math.max(0, (i < 0 ? 2 : i) - 1)];
    }
    faster() {
      const i = SPEEDS.indexOf(this.speed);
      this.speed = SPEEDS[Math.min(SPEEDS.length - 1, (i < 0 ? 2 : i) + 1)];
    }
  }

  // ---- keypads ----
  // Each key: [white, red, blue, green]. Null white means no function in that mode.
  const LEFT = [
    [['STATUS', '+', 'A', 'IF'], ['PROGRAM', '−', 'B', 'THEN'], ['STACK', '←', 'C', 'ELSE']],
    [['VARIABLES', '×', 'D', 'GOTO'], ['OUTPUT', '÷', 'E', 'PRINT'], ['GRAPHICS', 'NOTE', 'F', '"']],
    [['STEP', 'HOR1', 'G', '('], ['SLOWER', 'VER1', 'H', ')'], ['FASTER', 'KEY', 'I', ',']],
  ];
  const RIGHT = [
    [[null, '1', 'J', 'U'], [null, '2', 'K', 'V'], [null, '3', 'L', 'W']],
    [[null, '4', 'M', 'X'], [null, '5', 'N', 'Y'], [null, '6', 'O', 'Z']],
    [[null, '7', 'P', 'CLEAR'], [null, '8', 'Q', 'MOD'], [null, '9', 'R', 'HIT']],
    [['BACKWARD', 'HOR2', 'S', '='], ['FORWARD', 'VER2', 'T', '>'], ['NEW LINE', '0', 'SPACE', '<']],
  ];
  const MODES = ['white', 'red', 'blue', 'green'];
  const MODE_COLOR = { white: '#e8e8e8', red: '#e0524a', blue: '#4f8cf0', green: '#4fc46a' };

  // ---- UI ----
  function mount(host, opts) {
    opts = opts || {};
    const core = new Core();
    let mode = 0;
    let last = performance.now();
    let audio = null;
    let osc = null;
    let focus = 'PROGRAM';
    const REGIONS = ['STATUS', 'PROGRAM', 'STACK', 'VARIABLES', 'OUTPUT', 'GRAPHICS'];

    host.innerHTML =
      '<div class="cxwrap"><div class="cxscreen"><canvas width="640" height="480"></canvas></div>' +
      '<div class="cxpads"><div class="cxpad" data-pad="L"></div><div class="cxpad" data-pad="R"></div></div>' +
      '<div class="cxbar"><button data-c="select">Game Select (erase)</button><button data-c="reset">Game Reset</button>' +
      '<button data-c="titles">Titles</button><button data-c="copy">Copy program</button><button data-c="paste">Paste program</button>' +
      '<span class="cxmsg dim"></span></div></div>';
    const cv = host.querySelector('canvas');
    const ctx = cv.getContext('2d');
    const msg = host.querySelector('.cxmsg');

    core.onNote = (n) => {
      if (!audio) return;
      if (osc) {
        try {
          osc.stop();
        } catch (e) {}
        osc = null;
      }
      if (n > 0) {
        osc = audio.createOscillator();
        const g = audio.createGain();
        g.gain.value = 0.05;
        osc.type = 'square';
        osc.frequency.value = 110 * Math.pow(2, n / 12);
        osc.connect(g).connect(audio.destination);
        osc.start();
      }
    };
    const ensureAudio = () => {
      if (!audio) {
        try {
          audio = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {}
      }
    };

    function flash(s) {
      msg.textContent = s;
      clearTimeout(flash.t);
      flash.t = setTimeout(() => (msg.textContent = ''), 1800);
    }

    function press(label, mname) {
      ensureAudio();
      if (label === null) return;
      if (mname === 'white') {
        switch (label) {
          case 'STATUS': case 'PROGRAM': case 'STACK': case 'VARIABLES': case 'OUTPUT': case 'GRAPHICS':
            core.view[label] = core.view[label] ? 0 : 1;
            return;
          case 'STEP': core.halt(); core.step(); return;
          case 'SLOWER': core.slower(); return;
          case 'FASTER': core.faster(); return;
          case 'BACKWARD': focus = REGIONS[(REGIONS.indexOf(focus) + 5) % 6]; return;
          case 'FORWARD': focus = REGIONS[(REGIONS.indexOf(focus) + 1) % 6]; return;
          case 'NEW LINE': core.newLine(); return;
        }
      }
      if (!core.addToken(label)) flash(core.remaining < 1 ? 'NO SYMBOLS LEFT' : 'not valid here');
    }

    function pad(el, rows, side) {
      let h = '';
      rows.forEach((row, r) => {
        h += '<div class="cxrow">';
        row.forEach((k, c) => (h += '<button class="cxk" data-s="' + side + '" data-r="' + r + '" data-c="' + c + '"></button>'));
        h += '</div>';
      });
      h += '<div class="cxrow">';
      if (side === 'L') h += '<button class="cxk" data-f="run">RUN/HALT</button><button class="cxk" data-f="shift">SHIFT</button><button class="cxk" data-f="erase">ERASE</button>';
      el.innerHTML = h + '</div>';
    }
    const padEls = host.querySelectorAll('.cxpad');
    pad(padEls[0], LEFT, 'L');
    pad(padEls[1], RIGHT, 'R');

    function labelFor(side, r, c) {
      const key = (side === 'L' ? LEFT : RIGHT)[r][c];
      return key[mode];
    }

    function refreshPads() {
      host.querySelectorAll('.cxk[data-s]').forEach((b) => {
        const l = labelFor(b.dataset.s, +b.dataset.r, +b.dataset.c);
        b.textContent = l === null ? '' : l;
        b.style.color = MODE_COLOR[MODES[mode]];
      });
      const sh = host.querySelector('[data-f=shift]');
      sh.style.background = MODE_COLOR[MODES[mode]];
      sh.style.color = '#111';
    }

    const KEYNUM = (l) => (/^\d$/.test(l) ? +l : 0);
    host.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.cxk');
      if (!b) return;
      if (b.dataset.f) {
        if (b.dataset.f === 'shift') mode = (mode + 1) % 4;
        else if (b.dataset.f === 'run') core.running ? core.halt() : core.run();
        else core.eraseLast();
        refreshPads();
        return;
      }
      const l = labelFor(b.dataset.s, +b.dataset.r, +b.dataset.c);
      if (core.running && b.dataset.s === 'R' && mode === 1 && /^\d$/.test(l)) {
        core.keyDown = KEYNUM(l);
        b.dataset.held = '1';
        return;
      }
      press(l, MODES[mode]);
    });
    const release = () => {
      core.keyDown = 0;
    };
    host.addEventListener('pointerup', release);
    host.addEventListener('pointerleave', release);

    host.querySelector('.cxbar').addEventListener('click', async (e) => {
      const c = e.target.dataset.c;
      if (c === 'select') core.eraseAll();
      else if (c === 'reset') core.reset();
      else if (c === 'titles') core.titles = !core.titles;
      else if (c === 'copy') {
        try {
          await navigator.clipboard.writeText(core.text());
          flash('program copied');
        } catch (err) {
          flash('clipboard blocked');
        }
      } else if (c === 'paste') {
        try {
          core.loadText(await navigator.clipboard.readText());
          flash('program loaded');
        } catch (err) {
          flash(err.message || 'clipboard blocked');
        }
      }
    });

    // PC keyboard: letters, digits, operators go in directly; digits act as KEY while running.
    const kmap = { '+': '+', '-': '−', '*': '×', '/': '÷', '=': '=', '<': '<', '>': '>', '(': '(', ')': ')', ',': ',', '"': '"', '`': '←', ' ': 'SPACE' };
    function onKey(e) {
      if (!host.closest('dialog').open || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest && e.target.closest('input,textarea,select')) return;
      const k = e.key;
      if (/^\d$/.test(k) && core.running) {
        core.keyDown = +k;
        e.preventDefault();
        return;
      }
      if (k === 'Enter') core.newLine();
      else if (k === 'Backspace') core.eraseLast();
      else if (k === 'F5') core.running ? core.halt() : core.run();
      else if (k === 'F10') core.halt(), core.step();
      else if (/^[a-z]$/i.test(k)) press(k.toUpperCase(), 'blue');
      else if (/^\d$/.test(k)) press(k, 'red');
      else if (kmap[k]) press(kmap[k], 'green');
      else return;
      e.preventDefault();
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', (e) => {
      if (/^\d$/.test(e.key)) core.keyDown = 0;
    });

    // ---- rendering ----
    function draw() {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 640, 480);
      ctx.font = '16px "Courier New", monospace';
      ctx.textBaseline = 'top';
      let y = 4;
      const lh = 18;
      const show = (r) => core.view[r];
      const title = (r) => {
        if (core.titles) {
          ctx.fillStyle = '#6a7';
          ctx.fillText(r, 8, y);
          y += lh;
        }
      };
      const lines = (arr, color) => {
        ctx.fillStyle = color;
        arr.forEach((s) => {
          ctx.fillText(s, 8, y);
          y += lh;
        });
      };
      if (show('STATUS')) {
        title('STATUS');
        lines(['SYMBOLS = ' + String(core.remaining).padStart(2, '0') + '  SPEED = ' + String(core.speed).padStart(2, '0') + (core.running ? '  RUN' : core.error ? '  ' + core.error : '')], '#fff');
      }
      if (show('PROGRAM')) {
        title('PROGRAM');
        const ls = core.programLines().map((l, i) => String(i + 1).padStart(2, '0') + ' ' + Core.lineText(l));
        const cur = core.cur.length ? [String(ls.length + 1).padStart(2, '0') + ' ' + Core.lineText(core.cur) + '_'] : [String(ls.length + 1).padStart(2, '0') + ' _'];
        const all = core.cur.length ? ls.slice(0, -1).concat(cur) : ls.concat(cur);
        const fixed = core.cur.length ? ls.filter((_, i) => i < ls.length - 1).concat(cur) : all;
        const shown = fixed.slice(-9);
        shown.forEach((s) => {
          const n = parseInt(s, 10);
          ctx.fillStyle = n === core.pc && core.running ? '#ff0' : '#ddd';
          ctx.fillText(s, 8, y);
          y += lh;
        });
      }
      if (show('STACK')) {
        title('STACK');
        lines([core.stack.slice(-8).map((n) => String(n).padStart(2, '0')).join(' ')], '#8cf');
      }
      if (show('VARIABLES')) {
        title('VARIABLES');
        const v = Object.keys(core.vars)
          .filter((k) => core.vars[k] !== 0)
          .map((k) => k + '=' + String(core.vars[k]).padStart(2, '0'))
          .join(' ');
        lines([v.slice(0, 40), v.slice(40, 80)].filter((s) => s !== '' || true), '#fc8');
      }
      if (show('OUTPUT')) {
        title('OUTPUT');
        lines(core.output.slice(-6), '#0f0');
      }
      if (show('GRAPHICS')) {
        const gx = 440, gy = 20, gs = 190;
        ctx.strokeStyle = '#555';
        ctx.strokeRect(gx, gy, gs, gs);
        ctx.fillStyle = '#e0524a';
        ctx.fillRect(gx + (core.hor1 / 100) * (gs - 8), gy + (core.ver1 / 100) * (gs - 8), 8, 8);
        ctx.fillStyle = '#fff';
        ctx.fillRect(gx + (core.hor2 / 100) * (gs - 8), gy + (core.ver2 / 100) * (gs - 8), 8, 8);
        if (core.titles) {
          ctx.fillStyle = '#6a7';
          ctx.fillText('GRAPHICS', gx, gy - 18);
        }
      }
    }
    function frame(now) {
      core.tick(Math.min(0.1, (now - last) / 1000));
      last = now;
      draw();
      if (host.closest('dialog').open || true) requestAnimationFrame(frame);
    }
    refreshPads();
    requestAnimationFrame(frame);
    return core;
  }

  const api = { Core, tokenize, mount, SPEEDS, MEM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CX2620 = api;
})(typeof self !== 'undefined' ? self : this);
