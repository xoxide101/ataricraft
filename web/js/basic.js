// AtariCraft BASIC: an in-browser interpreter for Atari-BASIC-style programs (line numbers, A$(i,j) substrings, DIM, READ/DATA, FOR/NEXT, GOSUB, ON..GOTO).
// It is a test bench for programs before they go on a cart or disk; it is not the ROM and does not copy its tokenised format or timing.
// Dialect options (opts.dialect): 'atari' (default) is strict Atari BASIC; 'xl' adds ELSE-less extras such as WHILE/WEND and LEFT$/MID$/RIGHT$;
// 'altair' adds string '+', LEFT$/MID$/RIGHT$, and lets PRINT use '?'. Hooks (opts.hooks) connect PEEK/POKE and graphics to an emulator.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { root.AC = root.AC || {}; root.AC.Basic = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  const KW = ['PRINT', 'INPUT', 'LET', 'IF', 'THEN', 'FOR', 'NEXT', 'GOTO', 'GOSUB', 'RETURN', 'ON', 'DIM', 'END', 'STOP', 'REM', 'DATA', 'READ', 'RESTORE',
    'POKE', 'GRAPHICS', 'PLOT', 'DRAWTO', 'COLOR', 'SETCOLOR', 'SOUND', 'POSITION', 'CLR', 'WHILE', 'WEND', 'POP', 'TRAP', 'DEG', 'RAD', 'CLS', 'RANDOMIZE',
    'CALL', 'OPEN', 'CLOSE', 'XIO', 'NOTE', 'POINT', 'LOCATE', 'GET', 'PUT', 'BYE', 'DOS', 'LPRINT', 'COM', 'SAVE', 'CSAVE', 'CLOAD', 'STATUS'];
  const ERR = { 3: 'VALUE ERR', 5: 'STRING LENGTH ERR', 6: 'OUT OF DATA', 7: 'LINE NUMBER > 32767', 8: 'INPUT STMT ERR', 9: 'DIM ERR', 11: 'FP OVERFLOW',
    12: 'LINE NOT FOUND', 13: 'NO MATCHING FOR', 14: 'LINE TOO LONG', 15: 'GOSUB/FOR DELETED', 16: 'RETURN ERR', 17: 'SYNTAX ERR' };

  class BasicError extends Error { constructor(code, msg) { super(msg || ERR[code] || 'ERROR'); this.code = code; } }

  function fmt(n) {
    if (typeof n !== 'number') return String(n);
    if (Number.isInteger(n) && Math.abs(n) < 1e10) return String(n);
    let s = Math.abs(n) >= 1e10 || (n !== 0 && Math.abs(n) < 1e-2) ? n.toExponential(8).replace(/\.?0+e/, 'E').replace('e+', 'E+').replace('e-', 'E-') : String(+n.toPrecision(9));
    if (s.startsWith('0.')) s = s.slice(1); else if (s.startsWith('-0.')) s = '-' + s.slice(2);
    return s;
  }

  class Basic {
    constructor(opts = {}) {
      this.out = opts.print || (() => {});
      this.inp = opts.input || (async () => '');
      this.hooks = opts.hooks || {};
      this.onStep = opts.onStep || null; // debugger hook: awaited before every statement with (line, statement)
      this.dialect = opts.dialect || 'atari';
      this.maxSteps = opts.slice || 20000;
      this.mem = new Uint8Array(65536);
      this.new();
    }
    new() { this.lines = new Map(); this.reset(); }
    reset() {
      this.vars = new Map(); this.strs = new Map(); this.arrs = new Map(); this.dims = new Map(); this.adim = new Map();
      this.stack = []; this.data = []; this.dptr = 0; this.col = 0; this.running = false; this.stopFlag = false; this.rad = true; this.trap = 0;
      this.order = [...this.lines.keys()].sort((a, b) => a - b);
      this.idx = new Map(this.order.map((n, i) => [n, i]));
      this.prog = this.order.map((n) => this.compile(n, this.lines.get(n)));
      this.data = []; this.dataRef = [];
      this.prog.forEach((p, li) => p.forEach((s, si) => { if (s.kw === 'DATA') for (const v of splitTop(s.rest, ',')) { this.data.push(v.trim()); this.dataRef.push(this.order[li]); } }));
    }

    // Enter a program line or an immediate command. Returns an async result for immediate ones.
    // Pasted listings often carry typographic quotes and markdown-escaped asterisks; both are normalised to plain ASCII.
    load(text) {
      let last = 0;
      for (const l0 of String(text).split(/\r?\n/)) {
        const l = l0.replace(/[\u201c\u201d\u201e\u2033]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/\\([*_#<>~`])/g, '$1'); const m = /^\s*(\d+)\s?(.*)$/.exec(l);
        if (m) { last = +m[1]; if (m[2].trim()) this.lines.set(last, m[2]); else this.lines.delete(last); } else if (last && l.trim() && this.lines.has(last) && !/^\s*(RUN|LIST|NEW|CONT|CLR|END|SAVE|LOAD)\b/i.test(l)) this.lines.set(last, this.lines.get(last) + l.trim()); // wrapped listing line
      }
      this.reset();
    }
    list() { return this.order.map((n) => n + ' ' + this.lines.get(n)).join('\n'); }

    compile(n, text) {
      const out = [];
      for (const part of splitTop(text, ':')) {
        const t = part.trim(); if (!t) continue;
        const up = t.toUpperCase();
        let kw = null;
        if (up.startsWith('REM')) { out.push({ kw: 'REM', rest: '' }); break; }
        if (up[0] === '?' && this.dialect !== 'atari') { out.push({ kw: 'PRINT', rest: t.slice(1) }); continue; }
        if (up[0] === '?') { out.push({ kw: 'PRINT', rest: t.slice(1) }); continue; }
        for (const k of KW) if (up.startsWith(k) && (!kw || k.length > kw.length)) kw = k;
        if (kw) { const rest = t.slice(kw.length); if (/^\s*=/.test(rest) && kw !== 'COLOR') kw = null; }
        out.push(kw ? { kw, rest: t.slice(kw.length) } : { kw: 'LET', rest: t });
      }
      return out;
    }

    stop() { this.stopFlag = true; }

    // Read-only view of program state for a debugger.
    snapshot() {
      const arrs = {}; for (const [k, v] of this.arrs) arrs[k] = Array.from(v).slice(0, 64);
      return { line: this.cur, vars: Object.fromEntries(this.vars), strs: Object.fromEntries(this.strs), arrs, gosub: this.stack.length, data: this.dptr + '/' + this.data.length, trap: this.trap };
    }

    async run() {
      this.reset(); this.vars.clear();
      let li = 0, si = 0, steps = 0; this.running = true; this.stopFlag = false;
      try {
        while (li < this.prog.length && !this.stopFlag) {
          const st = this.prog[li][si];
          if (!st) { li++; si = 0; continue; }
          this.cur = this.order[li];
          if (this.onStep) await this.onStep(this.cur, st);
          if (this.stopFlag) break;
          let jump;
          try { jump = await this.exec(st, li, si); }
          catch (e) {
            if (!(e instanceof BasicError)) throw e;
            if (this.trap) { const t = this.trap; this.trap = 0; this.errCode = e.code; li = this.lineIdx(t); si = 0; continue; }
            this.out(`\nERROR- ${e.code} AT LINE ${this.cur}${e.message && e.message !== ERR[e.code] ? ' (' + e.message + ')' : ''}\n`); this.running = false; return { error: e.code, line: this.cur };
          }
          if (jump === 'END') break;
          if (jump) { li = jump.li; si = jump.si; } else si++;
          if (++steps >= this.maxSteps) { steps = 0; await new Promise((r) => setTimeout(r, 0)); }
        }
      } finally { this.running = false; }
      return { ok: true };
    }

    lineIdx(n) { n = Math.floor(n); if (!this.idx.has(n)) throw new BasicError(12); return this.idx.get(n); }

    async exec(s, li, si) {
      const r = s.rest;
      switch (s.kw) {
        case 'REM': case 'DATA': case 'DEG': if (s.kw === 'DEG') this.rad = false; return;
        case 'RAD': this.rad = true; return;
        case 'CLR': this.vars.clear(); this.strs.clear(); this.arrs.clear(); this.dims.clear(); this.adim.clear(); return;
        case 'CALL': { const a = splitTop(r.trim().replace(/^\((.*)\)$/s, '$1'), ',').filter((x) => x.trim()).map((x) => this.ev(x)); if (this.hooks.call) this.hooks.call(...a); return; }
        case 'OPEN': case 'CLOSE': case 'XIO': case 'NOTE': case 'POINT': case 'PUT': case 'BYE': case 'DOS': case 'SAVE': case 'CSAVE': case 'CLOAD': case 'STATUS': return;
        case 'LOCATE': { const a = splitTop(r, ','); if (a.length > 2) this.store(a[2].trim(), 0); return; }
        case 'GET': { const a = splitTop(r, ','); if (a.length > 1) this.store(a[1].trim(), 0); return; }
        case 'LPRINT': return this.print(r);
        case 'CLS': this.out('\f'); return;
        case 'RANDOMIZE': return;
        case 'END': case 'STOP': return 'END';
        case 'TRAP': this.trap = this.ev(r) >= 32768 ? 0 : Math.floor(this.ev(r)); return;
        case 'LET': return this.assign(r);
        case 'PRINT': return this.print(r);
        case 'INPUT': return this.input(r);
        case 'GOTO': return { li: this.lineIdx(this.ev(r)), si: 0 };
        case 'GOSUB': this.stack.push({ t: 'G', li, si: si + 1 }); return { li: this.lineIdx(this.ev(r)), si: 0 };
        case 'RETURN': { while (this.stack.length && this.stack[this.stack.length - 1].t !== 'G') this.stack.pop(); const f = this.stack.pop(); if (!f) throw new BasicError(16); return { li: f.li, si: f.si }; }
        case 'POP': { while (this.stack.length && this.stack[this.stack.length - 1].t !== 'G') this.stack.pop(); this.stack.pop(); return; }
        case 'ON': return this.on(r, li, si);
        case 'IF': return this.ifs(r, li, si);
        case 'FOR': return this.forStmt(r, li, si);
        case 'NEXT': return this.next(r);
        case 'WHILE': { const f = { t: 'W', li, si, cond: r }; if (this.ev(r)) { this.stack.push(f); return; } return this.skipTo('WEND', li, si); }
        case 'WEND': { const f = this.stack[this.stack.length - 1]; if (!f || f.t !== 'W') throw new BasicError(13); if (this.ev(f.cond)) return { li: f.li, si: f.si + 1 }; this.stack.pop(); return; }
        case 'DIM': case 'COM': return this.dim(r);
        case 'READ': return this.read(r);
        case 'RESTORE': { const ln = r.trim() ? Math.floor(this.ev(r)) : 0; const k = this.dataRef.findIndex((n) => n >= ln); this.dptr = ln ? (k < 0 ? this.data.length : k) : 0; return; }
        case 'POKE': { const a = splitTop(r, ','); const ad = Math.floor(this.ev(a[0])), v = Math.floor(this.ev(a[1])) & 255; this.mem[ad & 65535] = v; if (this.hooks.poke) this.hooks.poke(ad, v); return; }
        case 'GRAPHICS': case 'PLOT': case 'DRAWTO': case 'COLOR': case 'SETCOLOR': case 'SOUND': case 'POSITION': {
          const h = this.hooks[s.kw.toLowerCase()]; if (h) h(...splitTop(r, ',').map((x) => Math.floor(this.ev(x)))); return;
        }
        default: throw new BasicError(17);
      }
    }

    skipTo(kw, li, si) {
      let depth = 0;
      for (let l = li; l < this.prog.length; l++) for (let k = l === li ? si + 1 : 0; k < this.prog[l].length; k++) {
        const w = this.prog[l][k].kw; if (w === 'WHILE') depth++; else if (w === kw) { if (!depth) return { li: l, si: k + 1 }; depth--; }
      }
      throw new BasicError(13);
    }

    ifs(r, li, si) {
      const m = /\bTHEN\b/i.exec(maskStr(r)); if (!m) throw new BasicError(17);
      const cond = this.ev(r.slice(0, m.index)); let rest = r.slice(m.index + 4).trim();
      if (!cond) return { li, si: this.prog[li].length };
      if (/^\d/.test(rest)) return { li: this.lineIdx(this.ev(rest)), si: 0 };
      return this.inline(this.compile(this.cur, rest), li, si);
    }
    async inline(list, li, si) {
      for (let k = 0; k < list.length; k++) { const j = await this.exec(list[k], li, si); if (j) return j; }
      return { li, si: this.prog[li].length };
    }

    on(r, li, si) {
      const m = /\b(GOTO|GOSUB)\b/i.exec(r); if (!m) throw new BasicError(17);
      const k = Math.floor(this.ev(r.slice(0, m.index))), tg = splitTop(r.slice(m.index + m[0].length), ',');
      if (k < 1 || k > tg.length) return;
      if (m[1].toUpperCase() === 'GOSUB') this.stack.push({ t: 'G', li, si: si + 1 });
      return { li: this.lineIdx(this.ev(tg[k - 1])), si: 0 };
    }

    forStmt(r, li, si) {
      const m = /^\s*([A-Za-z][A-Za-z0-9]*)\s*=(.*)$/s.exec(r); if (!m) throw new BasicError(17);
      const mt = /\bTO\b/i.exec(maskStr(m[2])); if (!mt) throw new BasicError(17);
      const v = m[1].toUpperCase(), a = m[2].slice(0, mt.index), tail = m[2].slice(mt.index + 2), ms = /\bSTEP\b/i.exec(maskStr(tail));
      const lim = this.ev(ms ? tail.slice(0, ms.index) : tail), step = ms ? this.ev(tail.slice(ms.index + 4)) : 1;
      this.vars.set(v, this.ev(a));
      this.stack = this.stack.filter((f) => !(f.t === 'F' && f.v === v));
      this.stack.push({ t: 'F', v, lim, step, li, si: si + 1 });
    }
    next(r) {
      const v = r.trim().toUpperCase();
      while (this.stack.length) {
        const f = this.stack[this.stack.length - 1];
        if (f.t !== 'F') { this.stack.pop(); continue; }
        if (v && f.v !== v) { this.stack.pop(); continue; }
        const x = this.vars.get(f.v) + f.step; this.vars.set(f.v, x);
        if (f.step >= 0 ? x <= f.lim : x >= f.lim) return { li: f.li, si: f.si };
        this.stack.pop(); return;
      }
      throw new BasicError(13);
    }

    dim(r) {
      for (const d of splitTop(r, ',')) {
        const m = /^\s*([A-Za-z][A-Za-z0-9]*)(\$?)\s*\((.*)\)\s*$/s.exec(d); if (!m) throw new BasicError(17);
        const n = m[1].toUpperCase() + m[2], sizes = splitTop(m[3], ',').map((x) => Math.floor(this.ev(x)));
        if (sizes.length > 2 || sizes.some((z) => !(z >= 0 && z <= 32767))) throw new BasicError(9);
        if (m[2]) { this.strs.set(n, ''); this.dims.set(n, sizes[sizes.length - 1]); continue; }
        if (sizes.length === 2) { this.adim.set(n, [sizes[0] + 1, sizes[1] + 1]); this.arrs.set(n, new Array((sizes[0] + 1) * (sizes[1] + 1)).fill(0)); } else { this.adim.delete(n); this.arrs.set(n, new Array(sizes[0] + 1).fill(0)); }
      }
    }
    // Element offset for A(i) or A(i,j); every mismatch is DIM ERR (9) like the real interpreter.
    aidx(n, ix) {
      const arr = this.arrs.get(n); if (!arr) throw new BasicError(9);
      const dm = this.adim.get(n);
      if (dm ? ix.length !== 2 || ix[0] < 0 || ix[1] < 0 || ix[0] >= dm[0] || ix[1] >= dm[1] : ix.length !== 1 || ix[0] < 0 || ix[0] >= arr.length) throw new BasicError(9);
      return dm ? ix[0] * dm[1] + ix[1] : ix[0];
    }
    read(r) { for (const t of splitTop(r, ',')) { if (this.dptr >= this.data.length) throw new BasicError(6); const raw = this.data[this.dptr++]; this.store(t.trim(), /\$\s*(\(|$)/.test(t) ? unq(raw) : this.num(raw)); } }
    num(s) { const n = Number(s); if (s === '' || Number.isNaN(n)) throw new BasicError(8); return n; }

    print(r) {
      let nl = true, i = 0; const s = r.replace(/^\s*#\s*\d+\s*[,;]?/, '');
      while (i < s.length) {
        while (s[i] === ' ') i++;
        if (i >= s.length) break;
        if (s[i] === ';') { nl = false; i++; continue; }
        if (s[i] === ',') { const pad = 10 - (this.col % 10); this.emit(' '.repeat(pad)); nl = false; i++; continue; }
        const e = endOfExpr(s, i); const v = this.ev(s.slice(i, e)); this.emit(typeof v === 'number' ? fmt(v) : v); nl = true; i = e;
      }
      if (nl) this.emit('\n');
    }
    emit(t) { this.out(t); const k = t.lastIndexOf('\n'); this.col = k < 0 ? this.col + t.length : t.length - k - 1; }

    async input(r) {
      let rest = r.trim(), prompt = '?';
      const m = /^"([^"]*)"\s*[;,]?\s*(.*)$/s.exec(rest); if (m) { prompt = m[1]; rest = m[2]; }
      const vars = splitTop(rest, ',');
      let line = await this.inp(prompt === '?' ? '? ' : prompt), parts = splitTop(line, ',');
      for (let i = 0; i < vars.length; i++) {
        const t = vars[i].trim(), isS = /\$\s*(\(|$)/.test(t);
        if (!isS && i >= parts.length) { if (this.stopFlag) return; line = await this.inp('?? '); parts = parts.concat(splitTop(line, ',')); i--; continue; }
        this.store(t, isS ? (vars.length === 1 ? line : (parts[i] || '').trim()) : this.num(parts[i].trim()));
      }
    }

    assign(r) {
      const k = findEq(r); if (k < 0) throw new BasicError(17);
      this.store(r.slice(0, k).trim(), this.ev(r.slice(k + 1)));
    }
    store(target, v) {
      const m = /^([A-Za-z][A-Za-z0-9]*)(\$?)\s*(?:\((.*)\))?\s*$/s.exec(target); if (!m) throw new BasicError(17);
      const n = m[1].toUpperCase(), isS = !!m[2], key = n + m[2];
      if (isS) {
        if (typeof v !== 'string') throw new BasicError(3);
        const lim = this.dims.has(key) ? this.dims.get(key) : this.loose(key);
        if (m[3] === undefined) { if (v.length > lim) v = v.slice(0, lim); this.strs.set(key, v); return; }
        const ix = splitTop(m[3], ',').map((x) => Math.floor(this.ev(x))), cur = this.strs.get(key);
        const a = ix[0], b = ix.length > 1 ? ix[1] : lim;
        if (a < 1 || a > lim + 1 || b < a - 1 || b > lim) throw new BasicError(5);
        const nw = cur.padEnd(a - 1, ' ').slice(0, a - 1) + v.slice(0, ix.length > 1 ? b - a + 1 : v.length) + cur.slice(a - 1 + (ix.length > 1 ? b - a + 1 : v.length));
        this.strs.set(key, nw.length > lim ? nw.slice(0, lim) : nw); return;
      }
      if (typeof v !== 'number') throw new BasicError(3);
      if (m[3] === undefined) { this.vars.set(n, v); return; }
      const arr = this.arrs.get(n); if (!arr) throw new BasicError(9);
      arr[this.aidx(n, splitTop(m[3], ',').map((x) => Math.floor(this.nv(this.ev(x)))))] = v;
    }

    // ---- expressions ----
    ev(src) { const p = { s: src, i: 0 }; const v = this.or(p); skip(p); if (p.i < p.s.length) throw new BasicError(17); return v; }
    or(p) { let a = this.and(p); for (;;) { skip(p); if (kwAt(p, 'OR')) { p.i += 2; const b = this.and(p); a = (a || b) ? 1 : 0; } else return a; } }
    and(p) { let a = this.not(p); for (;;) { skip(p); if (kwAt(p, 'AND')) { p.i += 3; const b = this.not(p); a = (a && b) ? 1 : 0; } else return a; } }
    not(p) { skip(p); if (kwAt(p, 'NOT')) { p.i += 3; return this.not(p) ? 0 : 1; } return this.cmp(p); }
    cmp(p) {
      const a = this.add(p); skip(p);
      const m = /^(<=|>=|<>|#|<|>|=)/.exec(p.s.slice(p.i)); if (!m) return a;
      p.i += m[0].length; const b = this.add(p);
      if ((typeof a === 'string') !== (typeof b === 'string')) throw new BasicError(3);
      switch (m[0]) { case '<': return a < b ? 1 : 0; case '>': return a > b ? 1 : 0; case '<=': return a <= b ? 1 : 0; case '>=': return a >= b ? 1 : 0; case '=': return a === b ? 1 : 0; default: return a !== b ? 1 : 0; }
    }
    add(p) {
      let a = this.mul(p);
      for (;;) {
        skip(p); const c = p.s[p.i];
        if (c === '+') { p.i++; const b = this.mul(p); if (typeof a === 'string' || typeof b === 'string') { if (this.dialect !== 'altair' || typeof a !== typeof b) throw new BasicError(3); a += b; } else a += b; }
        else if (c === '-') { p.i++; const b = this.mul(p); this.nums(a, b); a -= b; } else return a;
      }
    }
    mul(p) {
      let a = this.pow(p);
      for (;;) {
        skip(p); const c = p.s[p.i];
        if (c === '*') { p.i++; const b = this.pow(p); this.nums(a, b); a *= b; }
        else if (c === '/') { p.i++; const b = this.pow(p); this.nums(a, b); if (b === 0) throw new BasicError(11); a /= b; } else return a;
      }
    }
    pow(p) { let a = this.un(p); for (;;) { skip(p); if (p.s[p.i] === '^') { p.i++; const b = this.un(p); this.nums(a, b); a = Math.pow(a, b); if (!Number.isFinite(a)) throw new BasicError(11); } else return a; } }
    un(p) { skip(p); const c = p.s[p.i]; if (c === '-') { p.i++; const v = this.un(p); this.nums(v); return -v; } if (c === '+') { p.i++; return this.un(p); } return this.atom(p); }
    nums(...v) { for (const x of v) if (typeof x !== 'number') throw new BasicError(3); }
    atom(p) {
      skip(p); const s = p.s, c = s[p.i];
      if (c === '(') { p.i++; const v = this.or(p); skip(p); if (s[p.i] !== ')') throw new BasicError(17); p.i++; return v; }
      if (c === '"') { const e = s.indexOf('"', p.i + 1); const end = e < 0 ? s.length : e; const v = s.slice(p.i + 1, end); p.i = e < 0 ? end : end + 1; return v; }
      const mn = /^(\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?/.exec(s.slice(p.i));
      if (mn) { p.i += mn[0].length; return Number(mn[0]); }
      if (c === '$') { const mh = /^\$([0-9A-Fa-f]+)/.exec(s.slice(p.i)); if (mh) { p.i += mh[0].length; return parseInt(mh[1], 16); } }
      const mi = /^([A-Za-z][A-Za-z0-9]*)(\$?)/.exec(s.slice(p.i)); if (!mi) throw new BasicError(17);
      const name = mi[1].toUpperCase(), suf = mi[2]; p.i += mi[0].length; skip(p);
      const fnKey = name + suf;
      if (FUN[fnKey]) {
        const args = []; if (s[p.i] === '(') { p.i++; skip(p); if (s[p.i] !== ')') for (;;) { args.push(this.or(p)); skip(p); if (s[p.i] === ',') { p.i++; continue; } break; } if (s[p.i] !== ')') throw new BasicError(17); p.i++; }
        return FUN[fnKey].call(this, ...args);
      }
      if (suf) {
        const cur = this.strs.has(fnKey) ? this.strs.get(fnKey) : (this.loose(fnKey), '');
        if (s[p.i] !== '(') return cur;
        p.i++; const ix = []; for (;;) { ix.push(Math.floor(this.nv(this.or(p)))); skip(p); if (s[p.i] === ',') { p.i++; continue; } break; } if (s[p.i] !== ')') throw new BasicError(17); p.i++;
        const a = ix[0], b = ix.length > 1 ? ix[1] : cur.length;
        if (a < 1 || b > cur.length || a > b + 1) throw new BasicError(5);
        return cur.slice(a - 1, b);
      }
      if (s[p.i] === '(') {
        p.i++; const ix = []; for (;;) { ix.push(Math.floor(this.nv(this.or(p)))); skip(p); if (s[p.i] === ',') { p.i++; continue; } break; }
        if (s[p.i] !== ')') throw new BasicError(17); p.i++;
        return this.arrs.get(name)[this.aidx(name, ix)];
      }
      return this.vars.has(name) ? this.vars.get(name) : 0;
    }
    loose(key) { if (this.dialect === 'atari') throw new BasicError(9); this.dims.set(key, 255); this.strs.set(key, ''); return 255; }
    nv(v) { if (typeof v !== 'number') throw new BasicError(3); return v; }
  }

  const FUN = {
    ABS: (x) => Math.abs(x), INT: (x) => Math.floor(x), SGN: (x) => Math.sign(x), SQR: (x) => { if (x < 0) throw new BasicError(3); return Math.sqrt(x); },
    SIN(x) { return Math.sin(this.rad ? x : x * Math.PI / 180); }, COS(x) { return Math.cos(this.rad ? x : x * Math.PI / 180); },
    ATN(x) { const r = Math.atan(x); return this.rad ? r : r * 180 / Math.PI; },
    LOG: (x) => { if (x <= 0) throw new BasicError(3); return Math.log(x); }, CLOG: (x) => { if (x <= 0) throw new BasicError(3); return Math.log10(x); },
    EXP: (x) => Math.exp(x), RND: () => Math.random(), FRE: () => 30000, PEEK(a) { a = Math.floor(a) & 65535; return this.hooks.peek ? this.hooks.peek(a) : this.mem[a]; },
    PADDLE: () => 228, STICK: () => 15, STRIG: () => 1, ERR: () => 0, ADR: () => 1536,
    USR(...a) { return this.hooks.usr ? Number(this.hooks.usr(...a)) || 0 : 0; },
    DPEEK(a) { a = Math.floor(a) & 65535; const pk = (x) => (this.hooks.peek ? this.hooks.peek(x & 65535) : this.mem[x & 65535]); return pk(a) + 256 * pk(a + 1); },
    LEN(s) { if (typeof s !== 'string') throw new BasicError(3); return s.length; }, ASC(s) { if (typeof s !== 'string' || !s.length) throw new BasicError(3); return s.charCodeAt(0) & 255; },
    VAL(s) { if (typeof s !== 'string') throw new BasicError(3); const n = Number(s.trim()); if (Number.isNaN(n)) throw new BasicError(8); return n; },
    STR$: (x) => fmt(x), CHR$: (x) => String.fromCharCode(Math.floor(x) & 255),
    LEFT$: (s, n) => s.slice(0, n), RIGHT$: (s, n) => s.slice(Math.max(0, s.length - n)), MID$: (s, a, n) => s.substr(a - 1, n === undefined ? s.length : n),
    TAB: () => '',
  };

  // Helpers on raw source text: split at top level (not inside quotes or parentheses), mask string contents so keyword search ignores them.
  function splitTop(s, sep) {
    const out = []; let d = 0, q = false, cur = '';
    for (const c of s) {
      if (c === '"') q = !q;
      if (!q) { if (c === '(') d++; else if (c === ')') d--; }
      if (c === sep && !q && d === 0) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur); return out;
  }
  function maskStr(s) { return s.replace(/"[^"]*"?/g, (m) => '"' + '_'.repeat(Math.max(0, m.length - 1))); }
  function unq(s) { return s.length > 1 && s[0] === '"' && s.endsWith('"') ? s.slice(1, -1) : s; }
  function skip(p) { while (p.s[p.i] === ' ') p.i++; }
  function kwAt(p, k) { return p.s.substr(p.i, k.length).toUpperCase() === k && !/[A-Za-z0-9$]/.test(p.s[p.i + k.length] || ''); }
  function findEq(s) { let d = 0, q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '"') q = !q; else if (!q) { if (c === '(') d++; else if (c === ')') d--; else if (c === '=' && d === 0) return i; } } return -1; }
  // PRINT items end at ';' or ',' that is outside quotes and parentheses.
  function endOfExpr(s, i) { let d = 0, q = false; for (; i < s.length; i++) { const c = s[i]; if (c === '"') q = !q; else if (!q) { if (c === '(') d++; else if (c === ')') d--; else if ((c === ';' || c === ',') && d === 0) return i; } } return i; }

  return { Basic, BasicError, fmt };
});
