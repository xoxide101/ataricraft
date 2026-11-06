// EBookCraft PDF reader (own, minimal, offline, DOM-free).
//   EBC.pdf.extractText(bytes) -> { title, author, pages:[{ paras:[string] }], warnings }
//   EBC.pdf.pageImages(bytes)  -> [{ page, w, h, kind:'raw'|'jpeg', data, cs, bpc, ... }]  (one entry per image XObject drawn on a page)
//   EBC.pdf.decodeImage(img)   -> { w, h, rgba }  (raw Flate images; JPEG only where the platform decodes it)
// Handles: classic and compressed (object stream) files, Flate/ASCIIHex/ASCII85, simple fonts with WinAnsi/MacRoman/Differences,
// Type0 fonts and any font with a ToUnicode CMap. Not handled: encryption, LZW, CCITT/JBIG2/JPX images, fonts without usable encodings.
// EBC.pdf.engine: set to an object { renderPage(bytes, pageNo, dpi) -> Promise<{w,h,rgba}> } (for example a pdf.js wrapper)
// and the Convert step uses it for full-fidelity page rasters; without it scanned pages must be single-image pages.
(function (G) {
  'use strict';
  const EBC = (G.EBC = G.EBC || {});
  const B = EBC.base;

  const latin1 = (a) => { let s = ''; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode.apply(null, a.subarray(i, i + 8192)); return s; };
  const bytesOf = (s) => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a; };
  const WS = ' \t\r\n\f\0', DELIM = '()<>[]{}/%';

  function skip(s, st) {
    for (;;) {
      const c = s[st.p];
      if (c !== undefined && WS.includes(c)) st.p++;
      else if (c === '%') { while (st.p < s.length && s[st.p] !== '\n' && s[st.p] !== '\r') st.p++; }
      else return;
    }
  }
  function value(s, st) {
    skip(s, st);
    const c = s[st.p];
    if (c === undefined) return { eof: true };
    if (c === '/') {
      let n = ''; st.p++;
      while (st.p < s.length && !WS.includes(s[st.p]) && !DELIM.includes(s[st.p])) {
        if (s[st.p] === '#' && /^[0-9a-fA-F]{2}$/.test(s.substr(st.p + 1, 2))) { n += String.fromCharCode(parseInt(s.substr(st.p + 1, 2), 16)); st.p += 3; } else n += s[st.p++];
      }
      return '/' + n;
    }
    if (c === '(') {
      let d = 1, o = ''; st.p++;
      while (st.p < s.length && d) {
        let ch = s[st.p++];
        if (ch === '\\') {
          const n = s[st.p++];
          if (n === 'n') o += '\n'; else if (n === 'r') o += '\r'; else if (n === 't') o += '\t'; else if (n === 'b') o += '\b'; else if (n === 'f') o += '\f';
          else if (/[0-7]/.test(n)) { let oc = n; while (oc.length < 3 && /[0-7]/.test(s[st.p])) oc += s[st.p++]; o += String.fromCharCode(parseInt(oc, 8) & 255); }
          else if (n === '\r') { if (s[st.p] === '\n') st.p++; } else if (n !== '\n') o += n;
        } else if (ch === '(') { d++; o += ch; } else if (ch === ')') { d--; if (d) o += ch; } else o += ch;
      }
      return { str: o };
    }
    if (c === '<' && s[st.p + 1] === '<') {
      st.p += 2; const d = {};
      for (;;) {
        skip(s, st);
        if (s[st.p] === '>' && s[st.p + 1] === '>') { st.p += 2; break; }
        const k = value(s, st);
        if (k.eof) break;
        if (typeof k !== 'string' || k[0] !== '/') continue;
        d[k.slice(1)] = value(s, st);
      }
      return d;
    }
    if (c === '<') {
      const e = s.indexOf('>', st.p), h = s.slice(st.p + 1, e).replace(/\s+/g, ''); st.p = e + 1;
      let o = ''; for (let i = 0; i < h.length; i += 2) o += String.fromCharCode(parseInt((h.substr(i, 2) + '0').slice(0, 2), 16));
      return { str: o, hex: true };
    }
    if (c === '[') {
      st.p++; const a = [];
      for (;;) { skip(s, st); if (s[st.p] === ']') { st.p++; break; } const v = value(s, st); if (v.eof) break; a.push(v); }
      return a;
    }
    if (c === ']' || c === '>' || c === ')' || c === '{' || c === '}') { st.p++; return { kw: c }; }
    const m = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(s.slice(st.p, st.p + 32));
    if (m && (/[\d.+-]/.test(c))) {
      st.p += m[0].length; const n = parseFloat(m[0]);
      if (Number.isInteger(n) && !m[0].includes('.')) {
        const r = /^\s+(\d+)\s+R(?![\w])/.exec(s.slice(st.p, st.p + 24));
        if (r) { st.p += r[0].length; return { ref: n, gen: +r[1] }; }
      }
      return n;
    }
    let w = '';
    while (st.p < s.length && !WS.includes(s[st.p]) && !DELIM.includes(s[st.p])) w += s[st.p++];
    if (!w) { st.p++; return { kw: c }; }
    if (w === 'true') return true; if (w === 'false') return false; if (w === 'null') return null;
    return { kw: w };
  }

  async function open(bytes) {
    const a = B.u8(bytes), s = latin1(a), objs = new Map(); // num -> { dict|value, stream:{start,end} }
    const warnings = [];
    if (!s.startsWith('%PDF') && s.indexOf('%PDF') < 0) throw new Error('Not a PDF file');
    const re = /(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj\b/g; let m;
    while ((m = re.exec(s))) {
      const st = { p: re.lastIndex }, num = +m[1], v = value(s, st);
      const o = { v, stream: null };
      skip(s, st);
      if (s.startsWith('stream', st.p)) {
        let b = st.p + 6; if (s[b] === '\r') b++; if (s[b] === '\n') b++;
        let len = v && typeof v === 'object' ? v.Length : undefined;
        if (len && len.ref !== undefined) { const lo = objs.get(len.ref); len = lo ? lo.v : undefined; }
        let e = typeof len === 'number' && s.startsWith('endstream', b + len + (/^[\r\n]+/.exec(s.slice(b + len, b + len + 2)) || [''])[0].length) ? b + len : -1;
        if (e < 0) { e = s.indexOf('endstream', b); if (e < 0) e = s.length; while (e > b && (s[e - 1] === '\n' || s[e - 1] === '\r')) e--; }
        o.stream = { start: b, end: e }; re.lastIndex = e;
      }
      objs.set(num, o);
    }
    const get = (x) => { let n = 0; while (x && typeof x === 'object' && x.ref !== undefined && n++ < 20) { const o = objs.get(x.ref); x = o ? o.v : null; } return x; };
    const decodeStream = async (o) => {
      let d = a.subarray(o.stream.start, o.stream.end);
      const dict = o.v || {};
      let fl = get(dict.Filter); fl = fl === undefined || fl === null ? [] : Array.isArray(fl) ? fl.map(get) : [fl];
      let pr = get(dict.DecodeParms); pr = Array.isArray(pr) ? pr.map(get) : [pr];
      for (let i = 0; i < fl.length; i++) {
        const f = fl[i];
        if (f === '/FlateDecode' || f === '/Fl') {
          d = await B.inflateLoose(d);
          const p = pr[i] && get(pr[i]);
          if (p && get(p.Predictor) >= 10) d = pngPredict(d, get(p.Columns) || 1, get(p.Colors) || 1, get(p.BitsPerComponent) || 8);
        } else if (f === '/ASCIIHexDecode') d = bytesOf(latin1(d).replace(/[^0-9a-fA-F]/g, '').replace(/(..)/g, (x) => String.fromCharCode(parseInt(x, 16))));
        else if (f === '/ASCII85Decode') d = a85(latin1(d));
        else return { data: d, filter: f }; // DCT, CCITT, JBIG2, JPX, LZW: leave to the caller
      }
      return { data: d, filter: null };
    };
    // compressed object streams
    for (const [num, o] of [...objs]) {
      if (o.stream && o.v && o.v.Type === '/ObjStm') {
        try {
          const { data } = await decodeStream(o), t = latin1(data), n = get(o.v.N), first = get(o.v.First), st = { p: 0 }, idx = [];
          for (let i = 0; i < n; i++) { const on = value(t, st), of = value(t, st); idx.push([on, of]); }
          for (const [on, of] of idx) { const sp = { p: first + of }; if (!objs.has(on)) objs.set(on, { v: value(t, sp), stream: null }); }
        } catch (e) { warnings.push('object stream ' + num + ': ' + e.message); }
      }
    }
    let trailer = {};
    const tm = s.lastIndexOf('trailer');
    if (tm >= 0) { try { trailer = value(s, { p: tm + 7 }) || {}; } catch (e) { /* ignore */ } }
    if (!trailer.Root) for (const [, o] of objs) if (o.v && o.v.Type === '/XRef' && o.v.Root) { trailer = o.v; break; }
    if (trailer.Encrypt) throw new Error('This PDF is encrypted; EBookCraft cannot read it');
    // page list
    const pages = [];
    const walk = (node, inherit, depth) => {
      node = get(node);
      if (!node || depth > 40) return;
      const inh = { Resources: node.Resources || inherit.Resources };
      if (node.Type === '/Page' || (!node.Kids && node.Contents !== undefined)) pages.push({ dict: node, res: get(inh.Resources) || {} });
      else for (const k of get(node.Kids) || []) walk(k, inh, depth + 1);
    };
    const root = get(trailer.Root);
    if (root && root.Pages) walk(root.Pages, {}, 0);
    if (!pages.length) for (const [, o] of objs) if (o.v && o.v.Type === '/Page') pages.push({ dict: o.v, res: get(o.v.Resources) || {} });
    return { a, s, objs, get, decodeStream, pages, trailer, warnings };
  }

  function pngPredict(d, cols, colors, bpc) {
    const bpp = Math.max(1, (colors * bpc) >> 3), stride = (cols * colors * bpc + 7) >> 3, rows = Math.floor(d.length / (stride + 1)), out = new Uint8Array(rows * stride);
    for (let y = 0; y < rows; y++) {
      const f = d[y * (stride + 1)], o = y * stride;
      for (let i = 0; i < stride; i++) {
        const x = d[y * (stride + 1) + 1 + i], l = i >= bpp ? out[o + i - bpp] : 0, u = y ? out[o - stride + i] : 0, ul = y && i >= bpp ? out[o - stride + i - bpp] : 0;
        let v = x;
        if (f === 1) v = x + l; else if (f === 2) v = x + u; else if (f === 3) v = x + ((l + u) >> 1);
        else if (f === 4) { const p = l + u - ul, pa = Math.abs(p - l), pb = Math.abs(p - u), pc = Math.abs(p - ul); v = x + (pa <= pb && pa <= pc ? l : pb <= pc ? u : ul); }
        out[o + i] = v & 255;
      }
    }
    return out;
  }
  function a85(t) {
    t = t.replace(/\s+/g, ''); t = t.replace(/^<~/, ''); const e = t.indexOf('~>'); if (e >= 0) t = t.slice(0, e);
    const out = []; let g = [];
    for (const ch of t) {
      if (ch === 'z' && !g.length) { out.push(0, 0, 0, 0); continue; }
      g.push(ch.charCodeAt(0) - 33);
      if (g.length === 5) { let n = 0; for (const x of g) n = n * 85 + x; out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255); g = []; }
    }
    if (g.length > 1) { const k = g.length; while (g.length < 5) g.push(84); let n = 0; for (const x of g) n = n * 85 + x; const b = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; out.push(...b.slice(0, k - 1)); }
    return Uint8Array.from(out);
  }

  // ---- fonts ----
  const WIN = (() => { // cp1252 0x80-0x9f
    const t = [0x20ac, 0, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0, 0x17d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0, 0x17e, 0x178];
    return (c) => (c >= 0x80 && c < 0xa0 ? String.fromCharCode(t[c - 0x80] || 63) : String.fromCharCode(c));
  })();
  const GLYPH = { space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', minus: '-', period: '.', slash: '/', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']', asciicircum: '^', underscore: '_', grave: '`', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~', quoteright: '\u2019', quoteleft: '\u2018', quotedblleft: '\u201c', quotedblright: '\u201d', quotesinglbase: ',', quotedblbase: '"', endash: '\u2013', emdash: '\u2014', bullet: '\u2022', ellipsis: '\u2026', fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', eacute: '\u00e9', egrave: '\u00e8', agrave: '\u00e0', aacute: '\u00e1', ecircumflex: '\u00ea', udieresis: '\u00fc', odieresis: '\u00f6', adieresis: '\u00e4', germandbls: '\u00df', ccedilla: '\u00e7', ntilde: '\u00f1', nbspace: ' ', copyright: '\u00a9', section: '\u00a7', degree: '\u00b0' };
  const glyphChar = (n) => {
    if (GLYPH[n] !== undefined) return GLYPH[n];
    if (/^[A-Za-z]$/.test(n)) return n;
    let m = /^uni([0-9A-Fa-f]{4})$/.exec(n); if (m) return String.fromCharCode(parseInt(m[1], 16));
    m = /^u([0-9A-Fa-f]{4,6})$/.exec(n); if (m) return String.fromCodePoint(parseInt(m[1], 16));
    return '';
  };
  function parseCMap(t) {
    const map = new Map(), hx = (h) => { let o = ''; for (let i = 0; i < h.length; i += 4) o += String.fromCharCode(parseInt(h.substr(i, 4), 16)); return o; };
    let m; const bf = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((m = bf.exec(t))) for (const p of m[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(p[1], 16), hx(p[2]));
    const br = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = br.exec(t))) {
      for (const p of m[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
        const lo = parseInt(p[1], 16), hi = parseInt(p[2], 16);
        if (p[3][0] === '[') { const l = [...p[3].matchAll(/<([0-9a-fA-F]+)>/g)]; for (let c = lo; c <= hi && c - lo < l.length; c++) map.set(c, hx(l[c - lo][1])); }
        else { const base = p[3].slice(1, -1), last = parseInt(base.slice(-4), 16); for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, hx(base.slice(0, -4) + (last + c - lo).toString(16).padStart(4, '0'))); }
      }
    }
    return map;
  }
  async function loadFont(doc, fd) {
    fd = doc.get(fd) || {};
    const f = { two: fd.Subtype === '/Type0', map: null, enc: null };
    const tu = doc.get(fd.ToUnicode);
    if (fd.ToUnicode && doc.objs.get(fd.ToUnicode.ref) && doc.objs.get(fd.ToUnicode.ref).stream) {
      try { const { data } = await doc.decodeStream(doc.objs.get(fd.ToUnicode.ref)); f.map = parseCMap(latin1(data)); } catch (e) { /* fall back to encoding */ }
    } else if (tu) f.map = null;
    const enc = doc.get(fd.Encoding);
    if (enc && typeof enc === 'object' && !Array.isArray(enc)) {
      const diff = doc.get(enc.Differences);
      if (diff) { f.enc = {}; let code = 0; for (const x of diff) { const v = doc.get(x); if (typeof v === 'number') code = v; else if (typeof v === 'string') f.enc[code++] = glyphChar(v.slice(1)); } }
    }
    return f;
  }
  function decodeShow(font, str) {
    if (!font) return str;
    let o = '';
    if (font.two) {
      for (let i = 0; i + 1 < str.length; i += 2) { const c = (str.charCodeAt(i) << 8) | str.charCodeAt(i + 1); o += font.map && font.map.has(c) ? font.map.get(c) : font.map ? '' : String.fromCharCode(c); }
      return o;
    }
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (font.map && font.map.has(c)) o += font.map.get(c);
      else if (font.enc && font.enc[c] !== undefined && font.enc[c] !== '') o += font.enc[c];
      else o += WIN(c);
    }
    return o;
  }

  // ---- content stream -> positioned text runs ----
  async function pageContent(doc, page) {
    let c = doc.get(page.dict.Contents); const list = Array.isArray(c) ? page.dict.Contents.map((x) => x) : [page.dict.Contents], parts = [];
    for (const r of list) {
      const o = r && r.ref !== undefined ? doc.objs.get(r.ref) : null;
      if (o && o.stream) { try { parts.push((await doc.decodeStream(o)).data); } catch (e) { doc.warnings.push('content stream: ' + e.message); } parts.push(B.enc('\n')); }
    }
    return latin1(B.concat(parts));
  }
  async function pageRuns(doc, page, fontCache) {
    const s = await pageContent(doc, page), st = { p: 0 }, runs = [];
    const fonts = doc.get(page.res.Font) || {};
    let font = null, size = 10, x = 0, y = 0, lx = 0, ly = 0, lead = 0, stack = [], ops = [], ctmY = 0;
    const fontFor = async (n) => { const k = fonts[n.slice(1)]; if (!k) return null; const key = k.ref !== undefined ? k.ref : n; if (!fontCache.has(key)) fontCache.set(key, await loadFont(doc, k)); return fontCache.get(key); };
    const show = (t, adj) => { if (t) runs.push({ x, y: y + ctmY, t, size, adj }); };
    for (;;) {
      const v = value(s, st);
      if (v.eof) break;
      if (!(v && typeof v === 'object' && !Array.isArray(v) && v.kw !== undefined && !(v.kw === ']' || v.kw === '>' || v.kw === ')'))) { ops.push(v); continue; }
      const op = v.kw, n = (i) => (typeof ops[i] === 'number' ? ops[i] : 0);
      if (op === 'BI') { const e = s.slice(st.p).search(/[\s]EI(?=[\s]|$)/); st.p = e < 0 ? s.length : st.p + e + 3; ops = []; continue; }
      if (op === 'q') stack.push([ctmY]); else if (op === 'Q') { const t = stack.pop(); if (t) ctmY = t[0]; }
      else if (op === 'cm') ctmY += n(5);
      else if (op === 'BT') { x = lx = 0; y = ly = 0; }
      else if (op === 'Tf') { size = Math.abs(n(1)) || size; font = await fontFor(ops[0]); }
      else if (op === 'TL') lead = n(0);
      else if (op === 'Td') { lx += n(0); ly += n(1); x = lx; y = ly; }
      else if (op === 'TD') { lead = -n(1); lx += n(0); ly += n(1); x = lx; y = ly; }
      else if (op === 'Tm') { lx = x = n(4); ly = y = n(5); if (Math.abs(n(3)) > 0) size = Math.abs(n(3)) < 1 ? size : Math.abs(n(3)); }
      else if (op === 'T*') { ly -= lead; y = ly; x = lx; }
      else if (op === 'Tj') { const t = ops[0]; if (t && t.str !== undefined) show(decodeShow(font, t.str)); }
      else if (op === "'" || op === '"') { ly -= lead; y = ly; x = lx; const t = ops[ops.length - 1]; if (t && t.str !== undefined) show(decodeShow(font, t.str)); }
      else if (op === 'TJ') {
        const arr = ops[0]; let acc = '';
        if (Array.isArray(arr)) for (const e of arr) { if (e && e.str !== undefined) acc += decodeShow(font, e.str); else if (typeof e === 'number' && e < -180 && acc && !acc.endsWith(' ')) acc += ' '; }
        show(acc);
      }
      ops = [];
    }
    return runs;
  }
  function runsToParas(runs) {
    if (!runs.length) return [];
    // group into lines: a new line whenever y changes
    const lines = []; let cur = null;
    for (const r of runs) {
      if (cur && Math.abs(r.y - cur.y) < Math.max(1, cur.size * 0.3)) {
        const gap = cur.text && !cur.text.endsWith(' ') && !r.t.startsWith(' ');
        cur.text += (gap ? ' ' : '') + r.t; cur.size = Math.max(cur.size, r.size);
      } else { cur = { y: r.y, x: r.x, text: r.t, size: r.size }; lines.push(cur); }
    }
    const lh = (() => { const d = []; for (let i = 1; i < lines.length; i++) { const g = Math.abs(lines[i - 1].y - lines[i].y); if (g > 0.5) d.push(g); } d.sort((p, q) => p - q); return d.length ? d[Math.floor(d.length / 2)] : 12; })();
    const maxLen = Math.max(...lines.map((l) => l.text.length));
    const paras = []; let p = '';
    lines.forEach((l, i) => {
      const t = l.text.replace(/\s+/g, ' ').trim();
      if (!t) return;
      const prev = lines[i - 1], bigGap = prev && Math.abs(prev.y - l.y) > lh * 1.45;
      if (p && (bigGap || (prev.text.length < maxLen * 0.55 && /[.!?:"'\u201d]\s*$/.test(prev.text)))) { paras.push(p); p = ''; }
      if (p && /[a-z]-$/.test(p) && /^[a-z]/.test(t)) p = p.slice(0, -1) + t; else p += (p ? ' ' : '') + t;
    });
    if (p) paras.push(p);
    return paras;
  }

  async function extractText(bytes) {
    const doc = await open(bytes), fontCache = new Map(), out = [];
    for (const pg of doc.pages) {
      let paras = [];
      try { paras = runsToParas(await pageRuns(doc, pg, fontCache)); } catch (e) { doc.warnings.push('page text: ' + e.message); }
      out.push({ paras });
    }
    const info = doc.get(doc.trailer.Info) || {};
    const sv = (v) => { v = doc.get(v); return v && v.str ? (v.str.charCodeAt(0) === 254 ? new TextDecoder('utf-16be').decode(bytesOf(v.str.slice(2))) : v.str) : ''; };
    return { title: sv(info.Title), author: sv(info.Author), pages: out, warnings: doc.warnings };
  }

  // image XObjects per page, in drawing order
  async function pageImages(bytes) {
    const doc = await open(bytes), out = [];
    for (let pi = 0; pi < doc.pages.length; pi++) {
      const pg = doc.pages[pi], xo = doc.get(pg.res.XObject) || {};
      const content = await pageContent(doc, pg), names = [...content.matchAll(/\/([\w.#-]+)\s+Do\b/g)].map((m) => m[1]);
      const seen = new Set();
      for (const nm of names.length ? names : Object.keys(xo)) {
        const ref = xo[nm]; if (!ref || seen.has(nm)) continue; seen.add(nm);
        const o = ref.ref !== undefined ? doc.objs.get(ref.ref) : null;
        if (!o || !o.stream || !o.v || o.v.Subtype !== '/Image') continue;
        const d = o.v, w = doc.get(d.Width), h = doc.get(d.Height), bpc = doc.get(d.BitsPerComponent) || 8, mask = doc.get(d.ImageMask) === true;
        let cs = doc.get(d.ColorSpace), pal = null;
        if (Array.isArray(cs)) {
          const k = doc.get(cs[0]);
          if (k === '/Indexed') { const base = doc.get(cs[1]); const lk = doc.get(cs[3]); const pb = lk && lk.str !== undefined ? bytesOf(lk.str) : (doc.objs.get(cs[3].ref) && (await doc.decodeStream(doc.objs.get(cs[3].ref))).data); pal = { base: Array.isArray(base) ? '/ICC' : base, data: pb }; cs = '/Indexed'; }
          else if (k === '/ICCBased') { const ic = doc.get(cs[1]); cs = (ic && ic.N === 1) ? '/DeviceGray' : (ic && ic.N === 4) ? '/DeviceCMYK' : '/DeviceRGB'; }
          else cs = k === '/CalGray' ? '/DeviceGray' : k === '/CalRGB' ? '/DeviceRGB' : k;
        }
        const dec = await doc.decodeStream(o).catch((e) => ({ err: e }));
        const dec2 = d.Decode ? doc.get(d.Decode) : null;
        out.push({ page: pi + 1, name: nm, w, h, bpc, cs: mask ? '/Mask' : cs, pal, filter: dec.filter, data: dec.data, err: dec.err ? dec.err.message : null, invert: !!(dec2 && doc.get(dec2[0]) === 1) });
      }
    }
    return out;
  }
  // -> { w, h, rgba } for raw images; throws a clear message for the codecs we do not have
  async function decodeImage(im) {
    if (im.err) throw new Error('image stream damaged: ' + im.err);
    if (im.filter === '/DCTDecode' || im.filter === '/DCT') {
      if (EBC.image && EBC.image.decodeJpeg) return EBC.image.decodeJpeg(im.data);
      throw new Error('JPEG page images need a browser (or the Node JPEG decoder)');
    }
    if (im.filter) throw new Error('image codec ' + im.filter.slice(1) + ' is not supported (CCITT/JBIG2/JPX/LZW); use the browser with a PDF engine or export the pages as PNG first');
    const { w, h, bpc } = im, rgba = new Uint8Array(w * h * 4), d = im.data;
    const comps = im.cs === '/DeviceRGB' ? 3 : im.cs === '/DeviceCMYK' ? 4 : 1, stride = (w * comps * bpc + 7) >> 3, mx = (1 << bpc) - 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = [];
        for (let c = 0; c < comps; c++) {
          if (bpc === 8) px.push(d[y * stride + x * comps + c]);
          else if (bpc === 16) px.push(d[y * stride + (x * comps + c) * 2]);
          else { const bit = (x * comps + c) * bpc; px.push((d[y * stride + (bit >> 3)] >> (8 - bpc - (bit & 7))) & mx); }
        }
        let r, g, b;
        if (im.cs === '/Indexed') { const i = px[0], P = im.pal.data, bs = im.pal.base === '/DeviceGray' ? 1 : 3; if (bs === 1) r = g = b = P[i]; else { r = P[i * 3]; g = P[i * 3 + 1]; b = P[i * 3 + 2]; } }
        else if (comps === 3) { r = px[0]; g = px[1]; b = px[2]; }
        else if (comps === 4) { const k = 255 - px[3]; r = ((255 - px[0]) * k) / 255; g = ((255 - px[1]) * k) / 255; b = ((255 - px[2]) * k) / 255; }
        else { const v = bpc === 8 || bpc === 16 ? px[0] : Math.round((px[0] * 255) / mx); r = g = b = v; }
        if (im.cs === '/Mask' || im.invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
        const o = (y * w + x) * 4; rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
      }
    }
    return { w, h, rgba };
  }

  EBC.pdf = { extractText, pageImages, decodeImage, open, engine: null, parseCMap };
  if (typeof module !== 'undefined' && module.exports) module.exports = EBC;
})(typeof window !== 'undefined' ? window : globalThis);
