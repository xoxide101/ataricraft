'use strict';
// Craft calculation engine (machine independent). Runs in Node and the browser (no dependencies).
// Numbers: mode 'ieee' (JS doubles) or 'bcd' (Atari 6-byte BCD floating point model, see docs/XCCALC.md).
// Cells: number | string | boolean | error | blank. Formulas are compiled to an AST, dependencies are tracked
// per cell, and a change recalculates only the dirty cells in topological order (cycles give #CIRC!).

const MAXROW = 65536, MAXCOL = 256, SK = 16777216;
const ERR = { DIV0: '#DIV/0!', VALUE: '#VALUE!', REF: '#REF!', NAME: '#NAME?', NUM: '#NUM!', NA: '#N/A', CIRC: '#CIRC!', NULL: '#NULL!', PARSE: '#PARSE!' };
const ERRCODES = [ERR.DIV0, ERR.VALUE, ERR.REF, ERR.NAME, ERR.NUM, ERR.NA, ERR.CIRC, ERR.NULL, ERR.PARSE];
class XErr { constructor(code) { this.err = code; } toString() { return this.err; } }
const isErr = (v) => v instanceof XErr;
const err = (c) => new XErr(c);

// ---------- A1 references ----------
function colName(c) { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = ((c - 1 - m) / 26) | 0; } return s; }
function colIndex(s) { let c = 0; for (const ch of s.toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; }
const addr = (r, c) => colName(c) + (r + 1);
function parseAddr(s) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(s.trim());
  if (!m) return null;
  const c = colIndex(m[1]), r = +m[2] - 1;
  return c < MAXCOL && r >= 0 && r < MAXROW ? { r, c } : null;
}
function parseRange(s) {
  const p = s.split(':');
  if (p.length > 2) return null;
  const a = parseAddr(p[0]), b = parseAddr(p[p.length - 1]);
  if (!a || !b) return null;
  return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
}

// ---------- number models ----------
const P10 = (n) => 10n ** BigInt(n);
// round a decimal m*10^e to what an Atari 6-byte BCD number holds: 10 digits when the base-100 leading pair is >= 10,
// else 9 (the leading nibble of the first byte is 0). Round half up. Range 1e-99 .. 9.99999999e97.
function bcdRound(neg, m, e) {
  if (m === 0n) return 0;
  for (;;) {
    const nd = m.toString().length, E10 = nd - 1 + e, keep = (((E10 % 2) + 2) % 2 === 0) ? 9 : 10;
    if (nd <= keep) break;
    const drop = nd - keep, q = m / P10(drop), rem = m % P10(drop);
    m = q + (rem * 2n >= P10(drop) ? 1n : 0n);
    e += drop;
    if (m.toString().length > keep) { m /= 10n; e += 1; }
  }
  const E10 = m.toString().length - 1 + e;
  if (E10 > 97) throw err(ERR.NUM);
  if (E10 < -99) return 0;
  return Number((neg ? '-' : '') + m + 'e' + e);
}
function bcdDec(x) {
  if (x === 0) return { neg: false, m: 0n, e: 0 };
  const t = Math.abs(x).toExponential(9), [mant, ex] = t.split('e');
  return { neg: x < 0, m: BigInt(mant.replace('.', '')), e: +ex - 9 };
}
const bcdFromNumber = (x) => { if (!isFinite(x)) throw err(ERR.NUM); const d = bcdDec(x); return bcdRound(d.neg, d.m, d.e); };
function bcdAddSub(a, b, sub) {
  const x = bcdDec(a), y = bcdDec(b);
  if (sub) y.neg = !y.neg;
  const e = Math.min(x.e, y.e);
  let v = (x.neg ? -1n : 1n) * x.m * P10(x.e - e) + (y.neg ? -1n : 1n) * y.m * P10(y.e - e);
  const neg = v < 0n; if (neg) v = -v;
  return bcdRound(neg, v, e);
}
const NUMIEEE = {
  name: 'ieee',
  norm: (x) => { if (Number.isNaN(x) || !isFinite(x)) throw err(ERR.NUM); return x; },
  add: (a, b) => NUMIEEE.norm(a + b), sub: (a, b) => NUMIEEE.norm(a - b), mul: (a, b) => NUMIEEE.norm(a * b),
  div: (a, b) => { if (b === 0) throw err(ERR.DIV0); return NUMIEEE.norm(a / b); },
  parse: (s) => Number(s),
};
const NUMBCD = {
  name: 'bcd',
  norm: bcdFromNumber,
  add: (a, b) => bcdAddSub(a, b, false), sub: (a, b) => bcdAddSub(a, b, true),
  mul: (a, b) => { const x = bcdDec(a), y = bcdDec(b); return bcdRound(x.neg !== y.neg, x.m * y.m, x.e + y.e); },
  div: (a, b) => {
    if (b === 0) throw err(ERR.DIV0);
    const x = bcdDec(a), y = bcdDec(b);
    if (x.m === 0n) return 0;
    return bcdRound(x.neg !== y.neg, (x.m * P10(30)) / y.m, x.e - y.e - 30);
  },
  parse: (s) => {
    const m = /^([+-]?)(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?$/.exec(s.trim());
    if (!m || (!m[2] && !m[3])) return NaN;
    const digits = (m[2] + m[3]).replace(/^0+/, '');
    if (!digits) return 0;
    return bcdRound(m[1] === '-', BigInt(digits), (m[4] ? +m[4] : 0) - m[3].length);
  },
};
// Atari FP byte layout: byte0 = sign<<7 | (base-100 exponent + 64), bytes 1-5 = ten BCD digits d.ddd.. as pairs.
function bcdEncode(x) {
  const out = new Uint8Array(6);
  if (x === 0) return out;
  const d = bcdDec(bcdFromNumber(x));
  let digs = d.m.toString();
  const E10 = digs.length - 1 + d.e, odd = (((E10 % 2) + 2) % 2) === 1;
  digs = (odd ? digs : '0' + digs).padEnd(10, '0');
  out[0] = (d.neg ? 0x80 : 0) | (Math.floor(E10 / 2) + 64);
  for (let i = 0; i < 5; i++) out[1 + i] = ((digs.charCodeAt(2 * i) - 48) << 4) | (digs.charCodeAt(2 * i + 1) - 48);
  return out;
}
function bcdDecode(b, o = 0) {
  if ((b[o] & 0x7f) === 0 && b[o + 1] === 0) return 0;
  let digs = '';
  for (let i = 1; i <= 5; i++) digs += ((b[o + i] >> 4) & 15) + '' + (b[o + i] & 15);
  const e100 = (b[o] & 0x7f) - 64;
  return Number((b[o] & 0x80 ? '-' : '') + BigInt(digs) + 'e' + (2 * e100 - 8));
}

// ---------- formats ----------
const FORMATS = ['General', '0', '0.00', '#,##0', '#,##0.00', '0%', '0.00%', '$#,##0.00', 'yyyy-mm-dd', '@', '0.00E+00', 'hh:mm:ss', 'yyyy-mm-dd hh:mm'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EPOCH = Date.UTC(1899, 11, 30);
const serialToDate = (n) => new Date(EPOCH + Math.round(n * 86400000));
const dateToSerial = (d) => (d.getTime() - EPOCH) / 86400000;
const pad = (n, w) => String(n).padStart(w, '0');
function generalText(x) {
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e10 || a < 1e-4) {
    const [m, e] = x.toExponential(5).split('e');
    return m.replace(/\.?0+$/, '') + 'E' + (e[0] === '-' ? '-' : '+') + pad(Math.abs(+e), 2);
  }
  let s = x.toPrecision(10);
  if (s.includes('e')) s = String(Number(s));
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}
function fmtDate(n, code) {
  const d = serialToDate(n);
  const Y = d.getUTCFullYear(), Mo = d.getUTCMonth(), D = d.getUTCDate(), H = d.getUTCHours(), Mi = d.getUTCMinutes(), S = d.getUTCSeconds();
  const hasAP = /AM\/PM/i.test(code);
  let out = '', i = 0, lastH = false;
  while (i < code.length) {
    const rest = code.slice(i);
    let m;
    if ((m = /^"([^"]*)"/.exec(rest))) { out += m[1]; i += m[0].length; continue; }
    if ((m = /^(yyyy|yy)/i.exec(rest))) { out += m[1].length === 4 ? pad(Y, 4) : pad(Y % 100, 2); i += m[1].length; lastH = false; continue; }
    if ((m = /^(mmmm|mmm|mm|m)/i.exec(rest))) {
      const t = m[1].length;
      if (lastH || /^m{1,2}[^a-z]*s/i.test(rest)) out += t === 1 ? Mi : pad(Mi, 2);
      else out += t === 1 ? Mo + 1 : t === 2 ? pad(Mo + 1, 2) : t === 3 ? MONTHS[Mo].slice(0, 3) : MONTHS[Mo];
      i += t; lastH = false; continue;
    }
    if ((m = /^(dddd|ddd|dd|d)/i.exec(rest))) { const t = m[1].length; out += t === 1 ? D : t === 2 ? pad(D, 2) : t === 3 ? DAYS[d.getUTCDay()].slice(0, 3) : DAYS[d.getUTCDay()]; i += t; lastH = false; continue; }
    if ((m = /^(hh|h)/i.exec(rest))) { const h = hasAP ? (H % 12) || 12 : H; out += m[1].length === 1 ? h : pad(h, 2); i += m[1].length; lastH = true; continue; }
    if ((m = /^(ss|s)/i.exec(rest))) { out += m[1].length === 1 ? S : pad(S, 2); i += m[1].length; lastH = false; continue; }
    if ((m = /^AM\/PM/i.exec(rest))) { out += H < 12 ? 'AM' : 'PM'; i += 5; continue; }
    out += code[i++];
  }
  return out;
}
const isDateCode = (c) => /^[^"]*[ymdhs]/i.test(c.replace(/"[^"]*"/g, '')) && !/^(General|@)$/i.test(c) && !/[#0]/.test(c.replace(/"[^"]*"/g, ''));
function groupDigits(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function fmtNumber(x, code) {
  if (code === 'General' || code === '' || code == null) return generalText(x);
  if (code === '@') return generalText(x);
  code = code.split(';')[0];
  if (isDateCode(code)) return fmtDate(x, code);
  const m = /^((?:"[^"]*"|\\.|[^#0.,%E"])*)([#0.,]*(?:E[+-]0+)?)(.*)$/.exec(code);
  if (!m) return generalText(x);
  let pre = m[1].replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1'), pat = m[2], post = m[3].replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1');
  const pct = post.includes('%') || pre.includes('%');
  if (pct) x *= 100;
  const neg = x < 0; x = Math.abs(x);
  const sci = /E[+-]0+$/.exec(pat);
  let body;
  if (sci) {
    const mant = pat.slice(0, sci.index), dec = (mant.split('.')[1] || '').length;
    let e = x === 0 ? 0 : Math.floor(Math.log10(x)), mv = x / Math.pow(10, e);
    if (+mv.toFixed(dec) >= 10) { mv /= 10; e++; }
    body = mv.toFixed(dec) + 'E' + (e < 0 ? '-' : '+') + pad(Math.abs(e), sci[0].length - 2);
  } else {
    const ip = pat.split('.')[0], dp = pat.includes('.') ? pat.split('.')[1] : '';
    const dec = (dp.match(/[0#]/g) || []).length, minDec = (dp.match(/0/g) || []).length;
    let s = x.toFixed(dec);
    if (dec > minDec) { let [a, b] = s.split('.'); b = b.replace(/0+$/, ''); while (b.length < minDec) b += '0'; s = b ? a + '.' + b : a; }
    let [a, b] = s.split('.');
    const minInt = (ip.match(/0/g) || []).length;
    if (a === '0' && minInt === 0) a = '';
    a = a.padStart(minInt, '0');
    if (ip.includes(',')) a = groupDigits(a);
    body = b !== undefined ? a + '.' + b : a;
  }
  const isZero = /^[0.,]*$/.test(body.replace(/E.*$/, ''));
  return (neg && !isZero ? '-' : '') + pre + body + post;
}

// ---------- tokenizer ----------
const REF_RE = /^(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?(\$?[A-Za-z]{1,3}\$?\d+)(?::(\$?[A-Za-z]{1,3}\$?\d+))?/;
function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i], rest = src.slice(i);
    let m;
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') {
      let j = i + 1, s = '';
      for (;;) {
        if (j >= src.length) throw err(ERR.PARSE);
        if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; }
        s += src[j++];
      }
      toks.push({ t: 's', v: s, a: i, b: j + 1 }); i = j + 1; continue;
    }
    if ((m = /^(\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest)) && !/^[A-Za-z_]/.test(rest)) {
      toks.push({ t: 'n', v: m[0], a: i, b: i + m[0].length }); i += m[0].length; continue;
    }
    if (ch === '#' && (m = /^#(DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|NULL!)/i.exec(rest))) {
      toks.push({ t: 'e', v: '#' + m[1].toUpperCase(), a: i, b: i + m[0].length }); i += m[0].length; continue;
    }
    if ((m = REF_RE.exec(rest))) {
      const after = rest[m[0].length];
      if (after !== '(' && !(after && /[A-Za-z0-9_]/.test(after))) {
        const sh = m[1] ? m[1].replace(/''/g, "'") : m[2] || null;
        const a = parseAddrRaw(m[3]), b = m[4] ? parseAddrRaw(m[4]) : null;
        if (a && (!m[4] || b)) {
          toks.push({ t: b ? 'rng' : 'ref', sh, a: a, b2: b, src: m[0], p: i, q: i + m[0].length }); i += m[0].length; continue;
        }
      }
    }
    if ((m = /^([A-Za-z_][A-Za-z0-9_.]*)/.exec(rest))) {
      toks.push({ t: 'id', v: m[1], a: i, b: i + m[1].length }); i += m[1].length; continue;
    }
    if ((m = /^(<=|>=|<>|[-+*\/^&=<>(),;:%])/.exec(rest))) { toks.push({ t: 'op', v: m[1], a: i, b: i + 1 }); i += m[1].length; continue; }
    throw err(ERR.PARSE);
  }
  return toks;
}
function parseAddrRaw(s) {
  const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(s);
  if (!m) return null;
  const c = colIndex(m[2]), r = +m[4] - 1;
  return c < MAXCOL && r >= 0 && r < MAXROW ? { r, c, ra: !!m[3], ca: !!m[1] } : null;
}

// ---------- parser ----------
function parseFormula(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p], isOp = (v) => toks[p] && toks[p].t === 'op' && toks[p].v === v;
  const eat = (v) => { if (!isOp(v)) throw err(ERR.PARSE); p++; };
  function cmp() {
    let a = cat();
    while (toks[p] && toks[p].t === 'op' && /^(=|<>|<=|>=|<|>)$/.test(toks[p].v)) { const op = toks[p++].v; a = { k: 'bin', op, a, b: cat() }; }
    return a;
  }
  function cat() { let a = add(); while (isOp('&')) { p++; a = { k: 'bin', op: '&', a, b: add() }; } return a; }
  function add() { let a = mul(); while (isOp('+') || isOp('-')) { const op = toks[p++].v; a = { k: 'bin', op, a, b: mul() }; } return a; }
  function mul() { let a = pow(); while (isOp('*') || isOp('/')) { const op = toks[p++].v; a = { k: 'bin', op, a, b: pow() }; } return a; }
  function pow() { let a = unary(); while (isOp('^')) { p++; a = { k: 'bin', op: '^', a, b: unary() }; } return a; }
  function unary() {
    if (isOp('-')) { p++; return { k: 'un', op: '-', x: unary() }; }
    if (isOp('+')) { p++; return unary(); }
    let a = primary();
    while (isOp('%')) { p++; a = { k: 'pct', x: a }; }
    return a;
  }
  function primary() {
    const t = toks[p++];
    if (!t) throw err(ERR.PARSE);
    if (t.t === 'n') return { k: 'n', v: t.v };
    if (t.t === 's') return { k: 's', v: t.v };
    if (t.t === 'e') return { k: 'e', v: t.v };
    if (t.t === 'ref') return { k: 'ref', sh: t.sh, r: t.a.r, c: t.a.c, ra: t.a.ra, ca: t.a.ca };
    if (t.t === 'rng') {
      const a = t.a, b = t.b2;
      return { k: 'rng', sh: t.sh, a: { r: a.r, c: a.c, ra: a.ra, ca: a.ca }, b: { r: b.r, c: b.c, ra: b.ra, ca: b.ca } };
    }
    if (t.t === 'op' && t.v === '(') { const e = cmp(); eat(')'); return e; }
    if (t.t === 'id') {
      const u = t.v.toUpperCase();
      if (isOp('(')) {
        p++;
        const args = [];
        if (!isOp(')')) for (;;) { args.push(isOp(',') || isOp(';') ? { k: 'blank' } : cmp()); if (isOp(',') || isOp(';')) { p++; if (isOp(')')) { args.push({ k: 'blank' }); break; } continue; } break; }
        eat(')');
        return { k: 'fn', n: u, args };
      }
      if (u === 'TRUE') return { k: 'b', v: true };
      if (u === 'FALSE') return { k: 'b', v: false };
      return { k: 'name', n: t.v };
    }
    throw err(ERR.PARSE);
  }
  const ast = cmp();
  if (p < toks.length) throw err(ERR.PARSE);
  return ast;
}
// shift relative references by (dr, dc), used by copy and fill; returns the new formula text
function shiftFormula(src, dr, dc) {
  let toks;
  try { toks = tokenize(src); } catch (e) { return src; }
  let out = '', last = 0;
  const sh = (a) => {
    const r = a.ra ? a.r : a.r + dr, c = a.ca ? a.c : a.c + dc;
    if (r < 0 || c < 0 || r >= MAXROW || c >= MAXCOL) return '#REF!';
    return (a.ca ? '$' : '') + colName(c) + (a.ra ? '$' : '') + (r + 1);
  };
  for (const t of toks) {
    if (t.t !== 'ref' && t.t !== 'rng') continue;
    const m = /^((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?/.exec(t.src);
    let txt = (m[1] || '') + sh(t.a) + (t.b2 ? ':' + sh(t.b2) : '');
    out += src.slice(last, t.p) + txt; last = t.q;
  }
  return out + src.slice(last);
}

// ---------- values ----------
const isNum = (v) => typeof v === 'number';
function typeRank(v) { return typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : -1; }
function cmpVals(a, b) {
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = typeRank(a), rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 1) { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  return a < b ? -1 : a > b ? 1 : 0;
}

class Rng {
  constructor(wb, s, r1, c1, r2, c2) { this.wb = wb; this.s = s; this.r1 = r1; this.c1 = c1; this.r2 = r2; this.c2 = c2; }
  get rows() { return this.r2 - this.r1 + 1; } get cols() { return this.c2 - this.c1 + 1; }
  at(i, j) { const c = this.wb.sheets[this.s].cells.get((this.r1 + i) * 256 + this.c1 + j); return c ? c.val : null; }
  each(cb) {
    const sh = this.wb.sheets[this.s];
    if (this.rows * this.cols <= sh.cells.size * 2) {
      for (let r = this.r1; r <= this.r2; r++) for (let c = this.c1; c <= this.c2; c++) { const x = sh.cells.get(r * 256 + c); if (x && x.val !== null && x.val !== undefined) cb(x.val); }
    } else {
      for (const [k, x] of sh.cells) { const r = k >> 8, c = k & 255; if (r >= this.r1 && r <= this.r2 && c >= this.c1 && c <= this.c2 && x.val !== null && x.val !== undefined) cb(x.val); }
    }
  }
}

// ---------- evaluator ----------
function makeEval(wb) {
  const N = () => wb.num;
  const toNum = (v) => {
    if (isErr(v)) throw v;
    if (v === null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const t = String(v).trim();
    if (t === '') throw err(ERR.VALUE);
    const n = parseInput(t, wb.num).num;
    if (n === undefined) throw err(ERR.VALUE);
    return n;
  };
  const toStr = (v) => { if (isErr(v)) throw v; if (v === null) return ''; if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'; if (typeof v === 'number') return generalText(v); return v; };
  const toBool = (v) => { if (isErr(v)) throw v; if (v === null) return false; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v !== 0; const u = String(v).toUpperCase(); if (u === 'TRUE') return true; if (u === 'FALSE') return false; throw err(ERR.VALUE); };
  const scalar = (v) => { if (v instanceof Rng) { if (v.rows === 1 && v.cols === 1) return v.at(0, 0); throw err(ERR.VALUE); } return v; };

  function ev(n, ctx) {
    switch (n.k) {
      case 'n': return N().parse(n.v);
      case 's': return n.v;
      case 'b': return n.v;
      case 'e': throw err(n.v);
      case 'blank': return null;
      case 'ref': {
        const s = n.s === undefined ? ctx.s : n.s;
        if (s < 0) throw err(ERR.REF);
        const c = wb.sheets[s].cells.get(n.r * 256 + n.c);
        const v = c ? c.val : null;
        if (isErr(v)) throw v;
        return v === undefined ? null : v;
      }
      case 'rng': {
        const s = n.s === undefined ? ctx.s : n.s;
        if (s < 0) throw err(ERR.REF);
        return new Rng(wb, s, Math.min(n.a.r, n.b.r), Math.min(n.a.c, n.b.c), Math.max(n.a.r, n.b.r), Math.max(n.a.c, n.b.c));
      }
      case 'name': {
        const t = wb.names.get(n.n.toUpperCase());
        if (!t) throw err(ERR.NAME);
        if (!t.ast) t.ast = resolveSheets(parseFormula(t.ref), wb, ctx.s);
        return ev(t.ast, ctx);
      }
      case 'un': return N().sub(0, toNum(scalar(ev(n.x, ctx))));
      case 'pct': return N().div(toNum(scalar(ev(n.x, ctx))), 100);
      case 'bin': {
        const a = scalar(ev(n.a, ctx)), b = scalar(ev(n.b, ctx));
        switch (n.op) {
          case '+': return N().add(toNum(a), toNum(b));
          case '-': return N().sub(toNum(a), toNum(b));
          case '*': return N().mul(toNum(a), toNum(b));
          case '/': return N().div(toNum(a), toNum(b));
          case '^': return power(toNum(a), toNum(b));
          case '&': return toStr(a) + toStr(b);
          default: {
            if (isErr(a)) throw a; if (isErr(b)) throw b;
            const c = cmpVals(a, b);
            return n.op === '=' ? c === 0 : n.op === '<>' ? c !== 0 : n.op === '<' ? c < 0 : n.op === '>' ? c > 0 : n.op === '<=' ? c <= 0 : c >= 0;
          }
        }
      }
      case 'fn': {
        const f = FN[n.n];
        if (!f) throw err(ERR.NAME);
        if (f.lazy) return f.fn(n.args, ctx);
        return f.fn(n.args.map((a) => ev(a, ctx)), ctx);
      }
    }
    throw err(ERR.VALUE);
  }
  function power(a, b) {
    if (a === 0 && b < 0) throw err(ERR.DIV0);
    if (a < 0 && !Number.isInteger(b)) throw err(ERR.NUM);
    if (wb.num.name === 'bcd' && Number.isInteger(b) && Math.abs(b) <= 64) {
      let r = 1, base = a, e = Math.abs(b);
      while (e > 0) { if (e & 1) r = N().mul(r, base); e >>= 1; if (e) base = N().mul(base, base); }
      return b < 0 ? N().div(1, r) : r;
    }
    return N().norm(Math.pow(a, b));
  }
  // argument flattening for aggregate functions: numbers only from ranges, direct args coerced
  function nums(args, opts = {}) {
    const out = [];
    for (const a of args) {
      if (a instanceof Rng) a.each((v) => { if (isErr(v)) throw v; if (typeof v === 'number') out.push(v); else if (opts.bools && typeof v === 'boolean') out.push(v ? 1 : 0); });
      else if (a === null && opts.skipBlank) continue;
      else out.push(toNum(a));
    }
    return out;
  }
  function sum(xs) { let s = 0; for (const x of xs) s = N().add(s, x); return s; }
  const roundDigits = (x, d, mode) => {
    d = Math.trunc(d);
    const f = Math.pow(10, d);
    let y;
    if (mode === 'r') { const t = Math.abs(x) * f; y = Math.sign(x) * Math.floor(Number((t).toPrecision(14)) + 0.5) / f; }
    else if (mode === 'u') { y = Math.sign(x) * Math.ceil(Number((Math.abs(x) * f).toPrecision(14))) / f; }
    else y = Math.sign(x) * Math.floor(Number((Math.abs(x) * f).toPrecision(14))) / f;
    return N().norm(y);
  };
  function critMatch(crit) {
    if (typeof crit === 'string') {
      const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(crit);
      const op = m[1] || '=', rhs = m[2];
      const n = parseInput(rhs, wb.num).num;
      return (v) => {
        if (v === null) return false;
        let c;
        if (n !== undefined && typeof v === 'number') c = v - n;
        else if (n !== undefined && op !== '=' && op !== '<>') return false;
        else if (typeof v === 'string' || typeof v === 'boolean') {
          const a = String(v).toLowerCase(), b = rhs.toLowerCase();
          if (op === '=' || op === '<>') { const re = new RegExp('^' + b.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'); return re.test(a) === (op === '='); }
          c = a < b ? -1 : a > b ? 1 : 0;
        } else return op === '<>';
        return op === '=' ? c === 0 : op === '<>' ? c !== 0 : op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
      };
    }
    return (v) => v !== null && (typeof v === 'number' ? v === toNum(crit) : false);
  }
  const arr2 = (r) => { if (!(r instanceof Rng)) return [[r]]; const o = []; for (let i = 0; i < r.rows; i++) { const row = []; for (let j = 0; j < r.cols; j++) row.push(r.at(i, j)); o.push(row); } return o; };
  const reg = (name, fn, lazy) => { FN[name] = { fn, lazy }; };
  const FN = {};
  reg('SUM', (a) => sum(nums(a, { skipBlank: true })));
  reg('PRODUCT', (a) => nums(a, { skipBlank: true }).reduce((p, x) => N().mul(p, x), 1));
  reg('AVERAGE', (a) => { const x = nums(a, { skipBlank: true }); if (!x.length) throw err(ERR.DIV0); return N().div(sum(x), x.length); });
  reg('MIN', (a) => { const x = nums(a, { skipBlank: true }); return x.length ? Math.min(...x) : 0; });
  reg('MAX', (a) => { const x = nums(a, { skipBlank: true }); return x.length ? Math.max(...x) : 0; });
  reg('MEDIAN', (a) => { const x = nums(a, { skipBlank: true }).sort((p, q) => p - q); if (!x.length) throw err(ERR.NUM); const m = x.length >> 1; return x.length & 1 ? x[m] : N().div(N().add(x[m - 1], x[m]), 2); });
  reg('COUNT', (a) => { let n = 0; for (const x of a) { if (x instanceof Rng) x.each((v) => { if (typeof v === 'number') n++; }); else if (typeof x === 'number') n++; } return n; });
  reg('COUNTA', (a) => { let n = 0; for (const x of a) { if (x instanceof Rng) x.each(() => n++); else if (x !== null) n++; } return n; });
  reg('COUNTBLANK', (a) => { let n = 0; for (const x of a) if (x instanceof Rng) { let f = 0; x.each(() => f++); n += x.rows * x.cols - f; } return n; });
  reg('IF', (a, ctx) => {
    if (a.length < 2) throw err(ERR.VALUE);
    const c = toBool(scalar(ev(a[0], ctx)));
    if (c) return scalar(ev(a[1], ctx));
    return a.length > 2 ? scalar(ev(a[2], ctx)) : false;
  }, true);
  reg('IFERROR', (a, ctx) => { try { return scalar(ev(a[0], ctx)); } catch (e) { if (isErr(e)) return scalar(ev(a[1], ctx)); throw e; } }, true);
  reg('AND', (a) => { let r = true; for (const x of a) { if (x instanceof Rng) x.each((v) => { if (typeof v !== 'string') r = r && toBool(v); }); else r = r && toBool(x); } return r; });
  reg('OR', (a) => { let r = false; for (const x of a) { if (x instanceof Rng) x.each((v) => { if (typeof v !== 'string') r = r || toBool(v); }); else r = r || toBool(x); } return r; });
  reg('NOT', (a) => !toBool(scalar(a[0])));
  reg('TRUE', () => true); reg('FALSE', () => false);
  reg('ABS', (a) => Math.abs(toNum(scalar(a[0]))));
  reg('INT', (a) => Math.floor(toNum(scalar(a[0]))));
  reg('SIGN', (a) => Math.sign(toNum(scalar(a[0]))));
  reg('MOD', (a) => { const x = toNum(scalar(a[0])), y = toNum(scalar(a[1])); if (y === 0) throw err(ERR.DIV0); return N().norm(x - y * Math.floor(x / y)); });
  reg('SQRT', (a) => { const x = toNum(scalar(a[0])); if (x < 0) throw err(ERR.NUM); return N().norm(Math.sqrt(x)); });
  reg('POWER', (a) => power(toNum(scalar(a[0])), toNum(scalar(a[1]))));
  reg('EXP', (a) => N().norm(Math.exp(toNum(scalar(a[0])))));
  reg('LN', (a) => { const x = toNum(scalar(a[0])); if (x <= 0) throw err(ERR.NUM); return N().norm(Math.log(x)); });
  reg('LOG10', (a) => { const x = toNum(scalar(a[0])); if (x <= 0) throw err(ERR.NUM); return N().norm(Math.log10(x)); });
  reg('PI', () => N().norm(Math.PI));
  reg('ROUND', (a) => roundDigits(toNum(scalar(a[0])), a[1] === undefined ? 0 : toNum(scalar(a[1])), 'r'));
  reg('ROUNDUP', (a) => roundDigits(toNum(scalar(a[0])), a[1] === undefined ? 0 : toNum(scalar(a[1])), 'u'));
  reg('ROUNDDOWN', (a) => roundDigits(toNum(scalar(a[0])), a[1] === undefined ? 0 : toNum(scalar(a[1])), 'd'));
  reg('LEN', (a) => toStr(scalar(a[0])).length);
  reg('LEFT', (a) => toStr(scalar(a[0])).slice(0, a[1] === undefined ? 1 : Math.max(0, toNum(scalar(a[1])))));
  reg('RIGHT', (a) => { const s = toStr(scalar(a[0])), n = a[1] === undefined ? 1 : Math.max(0, toNum(scalar(a[1]))); return n ? s.slice(-n) : ''; });
  reg('MID', (a) => { const st = toNum(scalar(a[1])), n = toNum(scalar(a[2])); if (st < 1 || n < 0) throw err(ERR.VALUE); return toStr(scalar(a[0])).substr(st - 1, n); });
  reg('UPPER', (a) => toStr(scalar(a[0])).toUpperCase());
  reg('LOWER', (a) => toStr(scalar(a[0])).toLowerCase());
  reg('TRIM', (a) => toStr(scalar(a[0])).trim().replace(/ +/g, ' '));
  reg('FIND', (a) => { const i = toStr(scalar(a[1])).indexOf(toStr(scalar(a[0])), a[2] === undefined ? 0 : toNum(scalar(a[2])) - 1); if (i < 0) throw err(ERR.VALUE); return i + 1; });
  reg('CONCAT', (a) => { let s = ''; for (const x of a) { if (x instanceof Rng) x.each((v) => { s += toStr(v); }); else s += toStr(x); } return s; });
  FN.CONCATENATE = FN.CONCAT;
  reg('TEXT', (a) => { const v = scalar(a[0]); if (typeof v === 'string') return v; return fmtNumber(toNum(v), toStr(scalar(a[1]))); });
  reg('VALUE', (a) => toNum(scalar(a[0])));
  reg('ISNUMBER', (a) => typeof scalar(a[0]) === 'number');
  reg('ISTEXT', (a) => typeof scalar(a[0]) === 'string');
  reg('ISBLANK', (a) => scalar(a[0]) === null);
  reg('ISERROR', (a, ctx) => { try { scalar(ev(a[0], ctx)); return false; } catch (e) { if (isErr(e)) return true; throw e; } }, true);
  reg('ROW', (a, ctx) => { if (!a.length) return ctx.r + 1; const n = a[0]; return (n.k === 'ref' ? n.r : n.a.r) + 1; }, true);
  reg('COLUMN', (a, ctx) => { if (!a.length) return ctx.c + 1; const n = a[0]; return (n.k === 'ref' ? n.c : n.a.c) + 1; }, true);
  reg('CHOOSE', (a) => { const i = toNum(scalar(a[0])); if (i < 1 || i >= a.length) throw err(ERR.VALUE); return scalar(a[Math.trunc(i)]); });
  reg('NOW', () => dateToSerial(new Date()));
  reg('TODAY', () => Math.floor(dateToSerial(new Date())));
  reg('DATE', (a) => { const y = toNum(scalar(a[0])), m = toNum(scalar(a[1])), d = toNum(scalar(a[2])); return Math.round(dateToSerial(new Date(Date.UTC(y, m - 1, d)))); });
  reg('YEAR', (a) => serialToDate(toNum(scalar(a[0]))).getUTCFullYear());
  reg('MONTH', (a) => serialToDate(toNum(scalar(a[0]))).getUTCMonth() + 1);
  reg('DAY', (a) => serialToDate(toNum(scalar(a[0]))).getUTCDate());
  reg('SUMIF', (a) => {
    if (!(a[0] instanceof Rng)) throw err(ERR.VALUE);
    const m = critMatch(scalar(a[1])), sr = a[2] instanceof Rng ? a[2] : a[0];
    let s = 0;
    for (let i = 0; i < a[0].rows; i++) for (let j = 0; j < a[0].cols; j++) { const v = a[0].at(i, j); if (m(v)) { const x = sr.at(i, j); if (typeof x === 'number') s = N().add(s, x); } }
    return s;
  });
  reg('COUNTIF', (a) => { if (!(a[0] instanceof Rng)) throw err(ERR.VALUE); const m = critMatch(scalar(a[1])); let n = 0; a[0].each((v) => { if (m(v)) n++; }); return n; });
  const lookupIdx = (key, vec, approx) => {
    if (approx) {
      let best = -1;
      for (let i = 0; i < vec.length; i++) { const v = vec[i]; if (v === null || typeRank(v) !== typeRank(key)) continue; if (cmpVals(v, key) <= 0) best = i; else break; }
      return best;
    }
    for (let i = 0; i < vec.length; i++) if (vec[i] !== null && typeRank(vec[i]) === typeRank(key) && cmpVals(vec[i], key) === 0) return i;
    return -1;
  };
  reg('MATCH', (a) => {
    const key = scalar(a[0]), t = a[2] === undefined ? 1 : toNum(scalar(a[2]));
    if (isErr(key)) throw key;
    const g = arr2(a[1]), vec = g.length === 1 ? g[0] : g.map((r) => r[0]);
    let i;
    if (t === 0) i = lookupIdx(key, vec, false);
    else if (t > 0) i = lookupIdx(key, vec, true);
    else { i = -1; for (let k = 0; k < vec.length; k++) if (vec[k] !== null && cmpVals(vec[k], key) >= 0) i = k; else break; }
    if (i < 0) throw err(ERR.NA);
    return i + 1;
  });
  reg('INDEX', (a) => {
    const g = arr2(a[0]);
    let r = a[1] === undefined || a[1] === null ? 0 : toNum(scalar(a[1])), c = a[2] === undefined || a[2] === null ? 0 : toNum(scalar(a[2]));
    if (g.length === 1 && a[2] === undefined) { c = r; r = 1; }
    if (r === 0 && g.length === 1) r = 1;
    if (c === 0 && g[0].length === 1) c = 1;
    if (r < 1 || c < 1 || r > g.length || c > g[0].length) throw err(ERR.REF);
    return g[r - 1][c - 1];
  });
  reg('VLOOKUP', (a) => {
    const key = scalar(a[0]), g = arr2(a[1]), col = toNum(scalar(a[2])), approx = a[3] === undefined ? true : toBool(scalar(a[3]));
    if (isErr(key)) throw key;
    if (col < 1 || col > g[0].length) throw err(ERR.REF);
    const i = lookupIdx(key, g.map((r) => r[0]), approx);
    if (i < 0) throw err(ERR.NA);
    return g[i][col - 1];
  });
  reg('HLOOKUP', (a) => {
    const key = scalar(a[0]), g = arr2(a[1]), row = toNum(scalar(a[2])), approx = a[3] === undefined ? true : toBool(scalar(a[3]));
    if (isErr(key)) throw key;
    if (row < 1 || row > g.length) throw err(ERR.REF);
    const i = lookupIdx(key, g[0], approx);
    if (i < 0) throw err(ERR.NA);
    return g[row - 1][i];
  });
  return { ev, FN, toNum, toStr };
}

// Atari app function subset (the 6502 evaluator implements these; see docs/ACCALC.md)
const ATARI_FUNCS = ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'IF', 'AND', 'OR', 'NOT', 'ROUND', 'ABS', 'INT', 'MOD', 'SQRT', 'LEN', 'LEFT', 'RIGHT', 'MID', 'UPPER', 'LOWER', 'CONCAT', 'VLOOKUP', 'INDEX', 'MATCH', 'PRODUCT'];
const VOLATILE = new Set(['NOW', 'TODAY']);

function walk(n, fn) {
  fn(n);
  if (n.args) n.args.forEach((a) => walk(a, fn));
  if (n.a && n.a.k) walk(n.a, fn);
  if (n.b && n.b.k) walk(n.b, fn);
  if (n.x) walk(n.x, fn);
}
// resolve sheet names to indices in place (undefined = same sheet as the formula)
function resolveSheets(ast, wb, cur) {
  walk(ast, (n) => {
    if (n.k === 'ref' || n.k === 'rng') {
      if (n.sh) { const i = wb.sheetIndex(n.sh); n.s = i; } else n.s = cur;
    }
  });
  return ast;
}

// ---------- parse user input ----------
function parseInput(text, num) {
  num = num || NUMIEEE;
  const t = text.trim();
  if (t === '') return { blank: true };
  if (t[0] === "'") return { text: t.slice(1) };
  let m;
  if (/^(TRUE|FALSE)$/i.test(t)) return { bool: t.toUpperCase() === 'TRUE' };
  const NUMRE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
  if (NUMRE.test(t)) { const n = num.parse(t); return isNaN(n) ? { text } : { num: n }; }
  if ((m = /^([+-]?)\$\s*([\d,]*\.?\d+)$/.exec(t)) && /^\d{1,3}(,\d{3})*(\.\d+)?$|^\d*\.?\d+$/.test(m[2])) return { num: num.parse(m[1] + m[2].replace(/,/g, '')), fmt: '$#,##0.00' };
  if ((m = /^([+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/.exec(t))) return { num: num.parse(m[1].replace(/,/g, '')), fmt: '#,##0' };
  if ((m = /^([+-]?(?:\d+\.?\d*|\.\d+))%$/.exec(t))) { const d = (m[1].split('.')[1] || '').length; return { num: num.div(num.parse(m[1]), 100), fmt: d ? '0.' + '0'.repeat(d) + '%' : '0%' }; }
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCMonth() === +m[2] - 1) return { num: Math.round(dateToSerial(d)), fmt: 'yyyy-mm-dd' };
  }
  return { text };
}

// ---------- workbook ----------
class Sheet {
  constructor(name) { this.name = name; this.cells = new Map(); this.colw = new Map(); this.frozenRows = 0; this.frozenCols = 0; this.defaultColW = 9; }
}
class Workbook {
  constructor(opts = {}) {
    this.mode = opts.mode === 'bcd' ? 'bcd' : 'ieee';
    this.num = this.mode === 'bcd' ? NUMBCD : NUMIEEE;
    this.sheets = []; this.names = new Map(); this.formats = []; this.charts = [];
    this.deps = new Map(); // global precedent key -> Set of dependent formula keys
    this.rangeDeps = []; // {s, r1, c1, r2, c2, key}
    this.volatile = new Set();
    this.depth = 0; this.pending = new Set();
    this.E = makeEval(this);
    this.stats = { evaluated: 0 };
    if (opts.sheets !== 0) this.addSheet('Sheet1');
  }
  setMode(mode) { this.mode = mode === 'bcd' ? 'bcd' : 'ieee'; this.num = this.mode === 'bcd' ? NUMBCD : NUMIEEE; this.recompileAll(); }
  sheetIndex(name) { const u = name.toLowerCase(); return this.sheets.findIndex((s) => s.name.toLowerCase() === u); }
  addSheet(name) {
    if (this.sheets.length >= 16) throw new Error('at most 16 sheets');
    const n = name || 'Sheet' + (this.sheets.length + 1);
    if (this.sheetIndex(n) >= 0) throw new Error('duplicate sheet name');
    this.sheets.push(new Sheet(n)); return this.sheets.length - 1;
  }
  renameSheet(i, name) {
    if (this.sheetIndex(name) >= 0 && this.sheetIndex(name) !== i) throw new Error('duplicate sheet name');
    const old = this.sheets[i].name;
    for (const sh of this.sheets) for (const c of sh.cells.values()) if (c.f && new RegExp("(^|[^A-Za-z0-9_.'])'?" + old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'?!", 'i').test(c.f)) {
      c.f = c.f.replace(new RegExp("('?)" + old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "('?)!", 'gi'), /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name + '!' : "'" + name.replace(/'/g, "''") + "'!");
    }
    this.sheets[i].name = name; this.recompileAll();
  }
  key(s, r, c) { return s * SK + r * 256 + c; }
  batch(fn) { this.depth++; try { fn(); } finally { if (--this.depth === 0) this.flush(); } }
  cell(s, r, c) { return this.sheets[s].cells.get(r * 256 + c); }
  ensure(s, r, c) {
    if (r < 0 || c < 0 || r >= MAXROW || c >= MAXCOL) throw new Error('cell out of range');
    const sh = this.sheets[s];
    let x = sh.cells.get(r * 256 + c);
    if (!x) { x = { val: null, fmt: 0, st: 0 }; sh.cells.set(r * 256 + c, x); }
    return x;
  }
  prune(s, r, c) { const x = this.cell(s, r, c); if (x && x.val === null && !x.f && !x.fmt && !x.st && !x.fmtc) this.sheets[s].cells.delete(r * 256 + c); }
  // typed input exactly as a user would enter it; returns the parsed kind
  input(s, ref, text) {
    const a = typeof ref === 'string' ? parseAddr(ref) : ref;
    if (!a) throw new Error('bad reference ' + ref);
    const t = String(text);
    if (t.trim()[0] === '=' && t.trim().length > 1) return this.setFormula(s, a.r, a.c, t.trim().slice(1));
    const p = parseInput(t, this.num);
    if (p.blank) return this.clear(s, a.r, a.c);
    const x = this.ensure(s, a.r, a.c);
    this.unlink(s, a.r, a.c);
    delete x.f; delete x.ast;
    if (p.text !== undefined) x.val = p.text; else if (p.bool !== undefined) x.val = p.bool; else { x.val = p.num; if (p.fmt && !x.fmt && !x.fmtc) this.setFmtCode(x, p.fmt); }
    this.changed(s, a.r, a.c);
    return p.text !== undefined ? 'text' : p.bool !== undefined ? 'bool' : 'number';
  }
  setValue(s, r, c, v) { const x = this.ensure(s, r, c); this.unlink(s, r, c); delete x.f; delete x.ast; x.val = v; this.changed(s, r, c); }
  clear(s, r, c, all) {
    const x = this.cell(s, r, c);
    if (!x) return 'blank';
    this.unlink(s, r, c);
    delete x.f; delete x.ast; x.val = null;
    if (all) { x.fmt = 0; x.st = 0; delete x.fmtc; }
    this.prune(s, r, c); this.changed(s, r, c);
    return 'blank';
  }
  setFmtCode(x, code) {
    const i = FORMATS.indexOf(code);
    if (i >= 0) { x.fmt = i; delete x.fmtc; } else { x.fmtc = code; x.fmt = 0; }
  }
  fmtCode(x) { return x.fmtc || FORMATS[x.fmt] || 'General'; }
  setFormat(s, r, c, code) { const x = this.ensure(s, r, c); this.setFmtCode(x, code); this.prune(s, r, c); }
  setStyle(s, r, c, st) { const x = this.ensure(s, r, c); x.st = st; this.prune(s, r, c); }
  setFormula(s, r, c, f) {
    const x = this.ensure(s, r, c);
    this.unlink(s, r, c);
    x.f = f; x.val = null;
    this.compile(s, r, c);
    this.changed(s, r, c, true);
    return 'formula';
  }
  compile(s, r, c) {
    const x = this.cell(s, r, c), k = this.key(s, r, c);
    x.deps = null;
    try {
      x.ast = resolveSheets(parseFormula(x.f), this, s); x.perr = null;
    } catch (e) { x.ast = null; x.perr = isErr(e) ? e : err(ERR.PARSE); }
    if (!x.ast) return;
    const cells = [], ranges = [];
    let vol = false;
    const add = (n) => {
      if (n.k === 'ref') { if (n.s >= 0) cells.push(this.key(n.s, n.r, n.c)); }
      else if (n.k === 'rng') { if (n.s >= 0) ranges.push({ s: n.s, r1: Math.min(n.a.r, n.b.r), c1: Math.min(n.a.c, n.b.c), r2: Math.max(n.a.r, n.b.r), c2: Math.max(n.a.c, n.b.c), key: k }); }
      else if (n.k === 'name') {
        const t = this.names.get(n.n.toUpperCase());
        if (t) { try { const sub = resolveSheets(parseFormula(t.ref), this, s); walk(sub, add); } catch (e) { /* bad name target */ } }
      } else if (n.k === 'fn' && VOLATILE.has(n.n)) vol = true;
    };
    walk(x.ast, add);
    for (const d of cells) { let st = this.deps.get(d); if (!st) this.deps.set(d, st = new Set()); st.add(k); }
    for (const rg of ranges) this.rangeDeps.push(rg);
    x.deps = { cells, ranges };
    if (vol) this.volatile.add(k);
  }
  unlink(s, r, c) {
    const x = this.cell(s, r, c);
    if (!x || !x.deps) return;
    const k = this.key(s, r, c);
    for (const d of x.deps.cells) { const st = this.deps.get(d); if (st) { st.delete(k); if (!st.size) this.deps.delete(d); } }
    if (x.deps.ranges.length) this.rangeDeps = this.rangeDeps.filter((g) => g.key !== k);
    x.deps = null; this.volatile.delete(k);
  }
  recompileAll() {
    this.deps = new Map(); this.rangeDeps = []; this.volatile = new Set();
    this.sheets.forEach((sh, s) => { for (const [kk, x] of sh.cells) if (x.f) { x.deps = null; this.compile(s, kk >> 8, kk & 255); this.pending.add(this.key(s, kk >> 8, kk & 255)); } });
    if (!this.depth) this.flush();
  }
  changed(s, r, c, isFormula) {
    this.pending.add(this.key(s, r, c));
    if (!this.depth) this.flush();
  }
  dependentsOf(k, out) {
    const st = this.deps.get(k);
    if (st) for (const d of st) out.push(d);
    if (this.rangeDeps.length) {
      const s = Math.floor(k / SK), rem = k - s * SK, r = rem >> 8, c = rem & 255;
      for (const g of this.rangeDeps) if (g.s === s && r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2) out.push(g.key);
    }
  }
  flush() {
    const seeds = this.pending; this.pending = new Set();
    if (!seeds.size) return new Set();
    // dirty set: changed cells that hold formulas plus all transitive dependents
    const dirty = new Set(), edges = new Map(), indeg = new Map(), queue = [];
    const visit = (k) => { if (!dirty.has(k)) { dirty.add(k); queue.push(k); } };
    for (const k of seeds) { const x = this.keyCell(k); if (x && x.f) visit(k); }
    const out = [];
    for (let qi = 0; ; ) {
      // process seeds' dependents as well as queue items
      if (qi === 0) { for (const k of seeds) { out.length = 0; this.dependentsOf(k, out); for (const d of out) visit(d); } }
      if (qi >= queue.length) break;
      const k = queue[qi++];
      out.length = 0; this.dependentsOf(k, out);
      for (const d of out) { visit(d); let e = edges.get(k); if (!e) edges.set(k, e = new Set()); if (!e.has(d)) { e.add(d); indeg.set(d, (indeg.get(d) || 0) + 1); } }
    }
    // Kahn order inside the dirty set
    const order = [], ready = [];
    for (const k of dirty) if (!indeg.get(k)) ready.push(k);
    while (ready.length) {
      const k = ready.pop(); order.push(k);
      const e = edges.get(k);
      if (e) for (const d of e) { const n = indeg.get(d) - 1; indeg.set(d, n); if (!n) ready.push(d); }
    }
    const done = new Set(order);
    for (const k of dirty) if (!done.has(k)) { const x = this.keyCell(k); if (x) x.val = err(ERR.CIRC); }
    for (const k of order) this.evalCell(k);
    return dirty;
  }
  keyCell(k) { const s = Math.floor(k / SK), rem = k - s * SK; return this.sheets[s] && this.sheets[s].cells.get(rem); }
  evalCell(k) {
    const s = Math.floor(k / SK), rem = k - s * SK, r = rem >> 8, c = rem & 255, x = this.sheets[s].cells.get(rem);
    if (!x || !x.f) return;
    this.stats.evaluated++;
    if (!x.ast) { x.val = x.perr || err(ERR.PARSE); return; }
    try {
      let v = this.E.ev(x.ast, { s, r, c });
      if (v instanceof Rng) v = v.rows === 1 && v.cols === 1 ? v.at(0, 0) : (() => { throw err(ERR.VALUE); })();
      x.val = v === undefined ? null : v;
    } catch (e) {
      if (isErr(e)) x.val = e; else throw e;
    }
  }
  recalcAll() {
    for (const [s, sh] of this.sheets.entries()) for (const [kk, x] of sh.cells) if (x.f) this.pending.add(this.key(s, kk >> 8, kk & 255));
    this.flush();
  }
  recalcVolatile() { for (const k of this.volatile) this.pending.add(k); this.flush(); }
  // named ranges: name -> 'Sheet1!$A$1:$B$2'
  setName(name, ref) {
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) || parseAddr(name)) throw new Error('bad name');
    if (ref == null) this.names.delete(name.toUpperCase()); else this.names.set(name.toUpperCase(), { name, ref, ast: null });
    this.recompileAll();
  }
  // ---------- reading ----------
  get(s, r, c) { const x = this.cell(s, r, c); return x ? x.val : null; }
  getA1(s, ref) { const a = parseAddr(ref); return this.get(s, a.r, a.c); }
  formula(s, r, c) { const x = this.cell(s, r, c); return x && x.f ? '=' + x.f : null; }
  // text the way the grid shows it
  display(s, r, c) {
    const x = this.cell(s, r, c);
    if (!x || x.val === null || x.val === undefined) return '';
    const v = x.val;
    if (isErr(v)) return v.err;
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'string') return v;
    return fmtNumber(v, this.fmtCode(x));
  }
  // what a user edits: formula text, or the value as typed
  editText(s, r, c) {
    const x = this.cell(s, r, c);
    if (!x) return '';
    if (x.f) return '=' + x.f;
    const v = x.val;
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return /^[=']/.test(v) || (parseInput(v, this.num).text === undefined) ? "'" + v : v;
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (isErr(v)) return v.err;
    const code = this.fmtCode(x);
    if (/%$/.test(code)) return generalText(this.num.mul(v, 100)) + '%';
    return generalText(v);
  }
  align(s, r, c) {
    const x = this.cell(s, r, c), al = x ? (x.st >> 3) & 3 : 0;
    if (al) return ['', 'l', 'c', 'r'][al];
    return x && typeof x.val === 'number' ? 'r' : x && isErr(x.val) ? 'c' : 'l';
  }
  bounds(s) {
    let r = -1, c = -1;
    for (const kk of this.sheets[s].cells.keys()) { if ((kk >> 8) > r) r = kk >> 8; if ((kk & 255) > c) c = kk & 255; }
    return { rows: r + 1, cols: c + 1 };
  }
  // copy a rectangular block with relative-reference adjustment (used by copy/paste and fill)
  copyCell(s, r, c, s2, r2, c2, what = 'all') {
    const x = this.cell(s, r, c);
    this.batch(() => {
      if (!x) { if (what === 'all') this.clear(s2, r2, c2, true); return; }
      if (what !== 'format') {
        if (x.f) this.setFormula(s2, r2, c2, shiftFormula(x.f, r2 - r, c2 - c));
        else this.setValue(s2, r2, c2, x.val);
      }
      if (what !== 'value') {
        const y = this.ensure(s2, r2, c2); y.fmt = x.fmt; y.st = x.st;
        if (x.fmtc) y.fmtc = x.fmtc; else delete y.fmtc;
        this.prune(s2, r2, c2);
      }
    });
  }
  colWidth(s, c) { const sh = this.sheets[s]; return sh.colw.has(c) ? sh.colw.get(c) : sh.defaultColW; }
}

module.exports = {
  Workbook, Sheet, Rng, XErr, ERR, ERRCODES, isErr, MAXROW, MAXCOL, FORMATS, ATARI_FUNCS,
  colName, colIndex, addr, parseAddr, parseRange, parseFormula, shiftFormula, tokenize, parseInput,
  fmtNumber, generalText, serialToDate, dateToSerial,
  NUMIEEE, NUMBCD, bcdEncode, bcdDecode, bcdFromNumber, bcdRound,
};
