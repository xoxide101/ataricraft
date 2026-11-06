// Glyph grid: character names / Unicode, category filters, search by char / name / code / Unicode, single and multi selection.
(() => {
  'use strict';
  const FE = window.FE, CF = FE.CF, FP = FE.FP, $ = FE.$, st = FE.state, G = XCW.Gfx;

  // ---- what a code is -------------------------------------------------------------------------------------------------
  const ACC = { 0x300: 'grave', 0x301: 'acute', 0x302: 'circumflex', 0x303: 'tilde', 0x308: 'diaeresis', 0x30a: 'ring', 0x327: 'cedilla' };
  const L1 = { 160: 'no-break space', 161: 'inverted exclamation', 162: 'cent', 163: 'pound', 164: 'currency', 165: 'yen', 166: 'broken bar', 167: 'section', 168: 'diaeresis', 169: 'copyright', 170: 'feminine ordinal', 171: 'left guillemet', 172: 'not', 173: 'soft hyphen', 174: 'registered', 175: 'macron', 176: 'degree', 177: 'plus-minus', 178: 'superscript two', 179: 'superscript three', 180: 'acute', 181: 'micro', 182: 'pilcrow', 183: 'middle dot', 184: 'cedilla', 185: 'superscript one', 186: 'masculine ordinal', 187: 'right guillemet', 188: 'one quarter', 189: 'one half', 190: 'three quarters', 191: 'inverted question', 198: 'AE', 208: 'Eth', 215: 'multiply', 216: 'O stroke', 222: 'Thorn', 223: 'sharp s', 230: 'ae', 240: 'eth', 247: 'divide', 248: 'o stroke', 254: 'thorn' };
  const info = (code) => {
    const f = st.f, ch = String.fromCharCode(code);
    let name, uni = code, cat = [];
    if (G.isGfxSlot(code)) {
      const e = G.bySlot(code); name = e.name; uni = e.uni; cat.push('atari'); if (uni >= 0x2500 && uni <= 0x259f) cat.push('box');
    } else if (code >= 32 && code < 127) {
      name = code === 32 ? 'space' : FP.glyphName(code).replace(/^./, (c) => c);
      if (/[A-Za-z]/.test(ch)) cat.push('letters'); else if (/[0-9]/.test(ch)) cat.push('digits'); else if (/[!"'(),\-./:;?[\]_{}]/.test(ch)) cat.push('punct'); else cat.push('symbols');
    } else if (code === 127) { name = 'delete'; cat.push('symbols'); uni = 127; }
    else if (code >= 160) {
      uni = code; const dec = ch.normalize('NFD');
      name = L1[code] || (dec.length > 1 ? dec[0] + ' ' + (ACC[dec.charCodeAt(1)] || 'mark') : 'U+' + code.toString(16).toUpperCase().padStart(4, '0'));
      if (code === 161 || code === 191 || code === 171 || code === 187) cat.push('punct');
      else if (/[A-Za-z]/.test(dec[0]) && dec.length > 1) cat.push('accents', 'letters');
      else if (L1[code] && /^(AE|ae|Eth|eth|Thorn|thorn|sharp s|O stroke|o stroke)$/.test(L1[code])) cat.push('accents', 'letters');
      else cat.push('symbols');
    } else { name = 'control ' + code; uni = code; }
    return { code, name, uni, cat, ch: uni >= 32 ? String.fromCodePoint(uni) : '', f, slot: f.map[code] };
  };
  FE.charInfo = info;
  // text char -> font code (ASCII/Latin-1 keep their value, the Atari graphics are found by their Unicode value)
  FE.codeOfChar = (ch) => { const cp = ch.codePointAt(0); if (cp < 128 || (cp >= 160 && cp < 256)) return cp; const c = FP.codeOfUni(cp); return c >= 0 ? c : 63; };

  const CATS = [['all', 'All'], ['letters', 'Letters'], ['digits', 'Digits'], ['punct', 'Punctuation'], ['symbols', 'Symbols'], ['atari', 'Atari graphics'], ['box', 'Box drawing'], ['accents', 'Accents']];
  const codesOfCat = (cat) => {
    const out = [];
    if (cat === 'all') { for (let c = 0; c < 256; c++) if (c < 133 || (c >= 160) || (st.f.glyphs[st.f.map[c]] || []).some((v) => v)) out.push(c); return out; }
    for (let c = 0; c < 256; c++) if (info(c).cat.includes(cat)) out.push(c);
    return out;
  };
  FE.codesOfCat = codesOfCat;
  // coverage sets for the validator and the import range
  FE.COVERAGE = {
    ascii: ['ASCII 32-126', () => range(33, 126)],
    latin1: ['Latin-1 (ASCII + 161-255)', () => range(33, 126).concat(range(161, 255).filter((c) => c !== 173))],
    atari: ['Atari graphics (0-31, 128-132)', () => range(0, 31).concat(range(128, 132))],
    box: ['Box drawing and blocks', () => range(0, 31).filter((c) => info(c).cat.includes('box'))],
    letters: ['Letters A-Z a-z', () => range(65, 90).concat(range(97, 122))],
  };
  const range = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; };

  // ---- search ------------------------------------------------------------------------------------------------------------------
  // "A" (the character), "65" / "0x41" / "$41" (code), "U+2500" (Unicode), "heart" / "grave" (name part)
  function matcher(q) {
    q = q.trim(); if (!q) return null;
    const ql = q.toLowerCase(), ids = new Set();
    let m;
    if ([...q].length === 1) { const cp = q.codePointAt(0), c = FE.codeOfChar(q); ids.add(c); ids.add(cp < 256 ? cp : -1); }
    if ((m = /^(?:u\+|\\u)([0-9a-f]{2,5})$/i.exec(q))) { const cp = parseInt(m[1], 16), c = cp < 256 && !(cp < 32) ? cp : FP.codeOfUni(cp); if (c >= 0) ids.add(c); ids.add('u' + cp); }
    if ((m = /^(?:0x|\$)([0-9a-f]+)$/i.exec(q))) ids.add(parseInt(m[1], 16));
    if (/^\d{1,3}$/.test(q)) ids.add(+q);
    if ((m = /^slot\s*(\d+)$/i.exec(q))) ids.add('s' + m[1]);
    return (i) => ids.has(i.code) || ids.has('u' + i.uni) || ids.has('s' + i.slot) || i.name.toLowerCase().includes(ql) || ('u+' + i.uni.toString(16)).includes(ql);
  }
  FE.searchCodes = (q) => { const mt = matcher(q); return mt ? range(0, 255).filter((c) => mt(info(c))) : null; };

  // ---- the grid ---------------------------------------------------------------------------------------------------------------
  st.cat = 'all'; st.query = ''; st.visible = [];
  const cv = $('grid'), cx = cv.getContext('2d'), TW = 40, TH = 46;
  function visibleCodes() {
    const base = codesOfCat(st.cat), mt = matcher(st.query);
    return mt ? base.filter((c) => mt(info(c))) : base;
  }
  function drawGlyphTile(f, slot, x, y, w, h, color) {
    const g = f.glyphs[slot]; if (!g) return;
    const nc = CF.colsOf(f, slot), s = Math.max(1, Math.floor(Math.min(w / nc, h / f.rows)));
    const ox = x + Math.floor((w - nc * s) / 2), oy = y + Math.floor((h - f.rows * s) / 2);
    cx.fillStyle = color;
    for (let r = 0; r < f.rows; r++) if (g[r]) for (let q = 0; q < nc; q++) if (CF.hasPx(f, g[r], q)) cx.fillRect(ox + q * s, oy + r * s, s, s);
  }
  function drawGrid() {
    if (!st.f) return;
    const f = st.f, C = FE.themeColors(), wrap = $('gridwrap'), W = Math.max(TW * 4, wrap.clientWidth - 2);
    st.visible = visibleCodes();
    const cols = Math.max(1, Math.floor(W / TW)), rows = Math.max(1, Math.ceil(st.visible.length / cols));
    cv.width = cols * TW; cv.height = rows * TH; st.gcols = cols;
    cx.fillStyle = C.bg; cx.fillRect(0, 0, cv.width, cv.height);
    cx.font = '10px system-ui,sans-serif'; cx.textAlign = 'center';
    st.visible.forEach((code, i) => {
      const x = (i % cols) * TW, y = ((i / cols) | 0) * TH, slot = f.map[code], g = f.glyphs[slot], has = g && g.some((v) => v), sel = st.sel.has(slot);
      if (sel) { cx.fillStyle = slot === st.slot ? C.acc + '55' : C.acc + '2a'; cx.fillRect(x + 1, y + 1, TW - 2, TH - 2); }
      cx.strokeStyle = C.grid; cx.lineWidth = 1; cx.strokeRect(x + .5, y + .5, TW - 1, TH - 1);
      if (!has && code !== 32 && code !== 160) { cx.setLineDash([3, 3]); cx.strokeStyle = C.dim; cx.strokeRect(x + 6.5, y + 4.5, TW - 13, TH - 22); cx.setLineDash([]); }
      drawGlyphTile(f, slot, x + 3, y + 3, TW - 6, TH - 20, has ? C.ink : C.dim);
      cx.fillStyle = sel ? C.acc : C.dim; cx.fillText(code >= 33 && code < 127 ? String.fromCharCode(code) + ' ' + code : '' + code, x + TW / 2, y + TH - 5);
      if (FE.isOvr && FE.isOvr(slot) && $('bdiff').checked) { cx.fillStyle = '#f59e0b'; cx.beginPath(); cx.moveTo(x + TW - 9, y + 2); cx.lineTo(x + TW - 2, y + 2); cx.lineTo(x + TW - 2, y + 9); cx.fill(); }
      if (slot === st.slot) { cx.strokeStyle = C.acc; cx.lineWidth = 2; cx.strokeRect(x + 1, y + 1, TW - 2, TH - 2); }
    });
    $('gcount').textContent = st.visible.length + ' glyphs' + (st.sel.size > 1 ? ', ' + st.sel.size + ' selected' : '');
  }
  FE.renders.push(drawGrid);

  const slotAt = (e) => {
    const r = cv.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * cv.width, y = ((e.clientY - r.top) / r.height) * cv.height;
    const i = Math.floor(y / TH) * st.gcols + Math.floor(x / TW), code = st.visible[i];
    return code === undefined ? null : { code, slot: st.f.map[code], i };
  };
  cv.addEventListener('mousedown', (e) => {
    const h = slotAt(e); if (!h) return;
    if (e.shiftKey && st.anchor !== undefined) {
      const a = st.visible.findIndex((c) => st.f.map[c] === st.anchor), lo = Math.min(a, h.i), hi = Math.max(a, h.i);
      st.sel = new Set(st.visible.slice(lo, hi + 1).map((c) => st.f.map[c])); st.slot = h.slot;
    } else if (e.ctrlKey || e.metaKey) { if (st.sel.has(h.slot) && st.sel.size > 1) st.sel.delete(h.slot); else st.sel.add(h.slot); st.slot = h.slot; st.anchor = h.slot; }
    else { st.slot = h.slot; st.sel = new Set([h.slot]); st.anchor = h.slot; }
    FE.render();
  });
  cv.addEventListener('dblclick', () => FE.showTab('edit'));
  FE.select = (s) => { st.slot = s; st.sel = new Set([s]); st.anchor = s; FE.render(); };
  FE.gotoCode = (code, size) => {
    if (size && st.fam && st.fam.sizes[size] && st.f.adv !== +size) FE.setFont(st.fam.sizes[size], st.fam, true);
    FE.showTab('edit'); FE.select(st.f.map[code]);
    if (!st.visible.includes(code)) { st.cat = 'all'; st.query = ''; $('gsearch').value = ''; syncChips(); FE.render(); }
  };
  const step = (d) => { const a = st.visible, i = a.findIndex((c) => st.f.map[c] === st.slot); const n = a[Math.max(0, Math.min(a.length - 1, i + d))]; if (n !== undefined) FE.select(st.f.map[n]); };

  function syncChips() { document.querySelectorAll('#cats button').forEach((b) => b.classList.toggle('on', b.dataset.cat === st.cat)); }
  document.addEventListener('DOMContentLoaded', () => {
    $('cats').innerHTML = CATS.map(([k, l]) => '<button data-cat="' + k + '">' + l + '</button>').join('');
    $('cats').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.cat = b.dataset.cat; syncChips(); FE.render(); };
    syncChips();
    $('gsearch').oninput = () => { st.query = $('gsearch').value; FE.render(); };
    $('gsearch').onkeydown = (e) => { if (e.key === 'Enter' && st.visible.length) FE.select(st.f.map[st.visible[0]]); };
    new ResizeObserver(() => { if (st.f) drawGrid(); }).observe($('gridwrap'));
    FE.key('[', 'Previous glyph', () => step(-1), 'Glyphs'); FE.key(']', 'Next glyph', () => step(1), 'Glyphs');
    FE.key('/', 'Search glyphs by character, name, code or Unicode', () => { FE.showTab('edit'); $('gsearch').focus(); }, 'Glyphs');
    FE.key('Ctrl+A', 'Select all glyphs shown in the grid', () => { st.sel = new Set(st.visible.map((c) => st.f.map[c])); FE.render(); }, 'Glyphs');
    $('gselnone').onclick = () => { st.sel = new Set([st.slot]); FE.render(); };
    $('gselall').onclick = () => { st.sel = new Set(st.visible.map((c) => st.f.map[c])); FE.render(); };
  });
})();
