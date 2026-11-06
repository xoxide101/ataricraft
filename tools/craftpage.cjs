// Craft page model (docs/PAGE.md): paper, pitch, margins, tab stops, font name, and the CRFT trailer that stores them.
// DOM-free, shared by craftdoc/craftimport/xcwcore and the browser bundle.
'use strict';

const PAPERS = {
  letter: { id: 'letter', name: 'Letter 8.5 x 11 in', w: 8.5, h: 11 },
  a4: { id: 'a4', name: 'A4 210 x 297 mm', w: 210 / 25.4, h: 297 / 25.4 },
  legal: { id: 'legal', name: 'Legal 8.5 x 14 in', w: 8.5, h: 14 },
};
const PAPER_CODE = ['letter', 'a4', 'legal'];
const PITCHES = [10, 12, 17];
const LPI = 6;
const KIND_CODE = { l: 0, c: 1, r: 2 };
const KIND_NAME = ['l', 'c', 'r'];
const TRAILER_MAGIC = 'CPG1';
const FLAG_TRAILER = 0x02;

// Style roles (docs/FONT.md "Styles"): '' is Body. Cell sizes that exist as Craft faces (craft4 .. craft12).
const ROLES = ['', 'title', 'h1', 'h2', 'h3', 'cap'];
const ROLE_LABEL = { '': 'Body', title: 'Title', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', cap: 'Caption' };
const SIZES = [4, 5, 6, 8, 10, 12];
const ALIGN_CODE = { l: 0, c: 1, r: 2, j: 3 };
const ALIGN_NAME = ['l', 'c', 'r', 'j'];
const fname = (s) => String(s || '').replace(/[^\x20-\x7e]/g, '').slice(0, 32);
function cleanStyles(st) {
  const o = {};
  for (const r of ROLES) {
    const s = st && st[r]; if (!s || typeof s !== 'object') continue;
    const c = { face: fname(s.face), size: SIZES.includes(+s.size) ? +s.size : 0, b: s.b ? 1 : 0, i: s.i ? 1 : 0, align: ALIGN_CODE[s.align] !== undefined ? s.align : '', space: Math.max(0, Math.min(3, Math.round(+s.space) || 0)) };
    if (c.face || c.size || c.b || c.i || c.align || c.space) o[r] = c;
  }
  return o;
}

// Whole columns that fit across the paper (a small epsilon keeps 8.5 x 12 = 102 exact).
const paperCols = (paper, pitch) => Math.floor(PAPERS[paper].w * pitch + 1e-6);
const paperLines = (paper) => Math.floor(PAPERS[paper].h * LPI + 1e-6);

function defaults(paper = 'letter', pitch = 10) {
  return { paper, pitch, left: Math.round(0.3 * pitch), right: Math.round(0.2 * pitch), top: 6, bottom: 6, tabs: [], font: '' };
}

// Clamps and completes a page setup; margins always leave at least 8 usable columns.
function normalize(p) {
  const d = defaults(p && PAPERS[p.paper] ? p.paper : 'letter', p && PITCHES.includes(p.pitch) ? p.pitch : 10);
  const o = { ...d, ...(p || {}) };
  if (!PAPERS[o.paper]) o.paper = d.paper;
  if (!PITCHES.includes(o.pitch)) o.pitch = d.pitch;
  const pc = paperCols(o.paper, o.pitch), pl = paperLines(o.paper);
  const num = (v, dv, max) => Math.max(0, Math.min(max, Number.isFinite(+v) ? Math.round(+v) : dv));
  o.left = num(o.left, d.left, pc - 9);
  o.right = num(o.right, d.right, pc - 9 - o.left);
  o.top = num(o.top, d.top, pl >> 2); o.bottom = num(o.bottom, d.bottom, pl >> 2);
  const seen = new Set();
  o.tabs = (o.tabs || []).map((t) => ({ pos: Math.round(+t.pos), kind: KIND_CODE[t.kind] !== undefined ? t.kind : 'l' }))
    .filter((t) => t.pos >= 0 && t.pos < pc && !seen.has(t.pos) && seen.add(t.pos)).sort((a, b) => a.pos - b.pos).slice(0, 24);
  o.font = fname(o.font); o.dfont = fname(o.dfont); o.styles = cleanStyles(o.styles);
  const sq = new Set(), pq = new Set();
  o.secs = (Array.isArray(o.secs) ? o.secs : []).map((r) => ({ p: Math.max(0, Math.min(65535, Math.round(+r.p) || 0)), font: fname(r.font) }))
    .filter((r) => !sq.has(r.p) && sq.add(r.p)).sort((a, b) => a.p - b.p).slice(0, 120);
  o.pp = (Array.isArray(o.pp) ? o.pp : []).map((r) => ({ p: Math.max(0, Math.min(65535, Math.round(+r.p) || 0)), role: ROLES.includes(r.role) ? r.role : '', size: SIZES.includes(+r.size) ? +r.size : 0, font: fname(r.font) }))
    .filter((r) => (r.role || r.size || r.font) && !pq.has(r.p) && pq.add(r.p)).sort((a, b) => a.p - b.p).slice(0, 4000);
  const fs = new Set();
  o.fonts = (Array.isArray(o.fonts) ? o.fonts : []).map((r) => ({ p: Math.max(0, Math.min(65535, Math.round(+r.p) || 0)), font: String(r.font || '').replace(/[^\x20-\x7e]/g, '').slice(0, 32) }))
    .filter((r) => !fs.has(r.p) && fs.add(r.p)).sort((a, b) => a.p - b.p).slice(0, 64);
  return o;
}

// One font per line block (docs/FONT.md): a paragraph's font is its `font` property. The trailer stores only the changes, each at a
// paragraph start, so a font can never change in the middle of a line.
function fontRecords(paras, docFont = '') {
  const out = []; let cur = docFont || '';
  paras.forEach((p, i) => { let f = p.font || docFont || ''; if (f === 'ROM') f = ''; if (!f && cur) f = 'ROM'; if (f !== cur) { out.push({ p: i, font: f }); cur = f; } });
  return out;
}
function applyFonts(paras, page) {
  const recs = (page && page.fonts) || []; let cur = (page && page.font) || '', k = 0;
  paras.forEach((p, i) => { while (k < recs.length && recs[k].p <= i) cur = recs[k++].font; if (cur && cur !== 'ROM') p.font = cur; else delete p.font; });
  return paras;
}

// ---- sections, roles, sizes (docs/FONT.md "Styles and sections") --------------------------------------------------------------------
// Paragraph properties: sec (a section starts here; paragraph 0 always does), sf (that section's font), role ('' body, title, h1..h3, cap),
// size (cell size override) and font (explicit override; 'ROM' forces the standard face). Precedence, lowest to highest:
// document default (page.dfont) < section font < style of the role (page.styles[role], face and size) < paragraph font/size.
// Every resolved face is one face per paragraph, so a line never mixes faces or sizes.
function withSize(face, size) {
  size = +size; if (!SIZES.includes(size)) return face || '';
  if (!face || face === 'ROM') return '';
  const m = /^(craft)(\d+)$/i.exec(face); return m ? m[1] + size : face;
}
const faceSize = (face) => { const m = /^craft(\d+)$/i.exec(face || ''); return m ? +m[1] : 0; };
// Faces of all paragraphs: [{ face, role, sec }] (face '' = standard, sec = index of the section the paragraph is in).
function resolve(paras, page) {
  const st = (page && page.styles) || {}, dfont = (page && (page.dfont || page.font)) || '';
  let sec = '', n = -1;
  return paras.map((p, i) => {
    if (i === 0 || p.sec) { sec = p.sf || ''; n++; }
    const s = st[p.role || ''] || null;
    let face = p.font || (s && s.face) || sec || dfont || '';
    const size = p.size || (p.font ? 0 : s && s.size) || 0;
    if (size) face = withSize(face, size);
    if (face === 'ROM') face = '';
    return { face, role: p.role || '', sec: n, style: s };
  });
}
// Sections as [{ start, end (inclusive), font (section font), face (face of its first paragraph) }]
function sections(paras, page) {
  const r = resolve(paras, page), out = [];
  paras.forEach((p, i) => { if (i === 0 || p.sec) out.push({ start: i, end: i, font: p.sf || '', face: r[i].face }); else out[out.length - 1].end = i; });
  return out;
}
// Model -> page record: structure (tags 4..7) plus the resolved faces as the plain font records (tags 2/3) that ACWriter reads.
function embed(paras, page) {
  const pg = { ...(page || {}) }, dfont = pg.dfont || pg.font || '';
  pg.dfont = dfont;
  const r = resolve(paras, { ...pg, dfont });
  pg.secs = []; pg.pp = [];
  paras.forEach((p, i) => {
    if (i === 0 ? p.sf : p.sec) pg.secs.push({ p: i, font: p.sf || '' });
    if (p.role || p.size || p.font) pg.pp.push({ p: i, role: p.role || '', size: p.size || 0, font: p.font || '' });
  });
  pg.font = r.length ? r[0].face : ''; pg.fonts = [];
  let cur = pg.font;
  r.forEach((x, i) => { if (x.face !== cur) { pg.fonts.push({ p: i, font: x.face || 'ROM' }); cur = x.face; } });
  return pg;
}
// Page record -> model: new files carry structure; old ones (tags 2/3 only) become explicit per-paragraph faces.
function extract(paras, page) {
  const pg = page || {};
  if (pg.secs && pg.secs.length || pg.pp && pg.pp.length || pg.styles && Object.keys(pg.styles).length || pg.dfont) {
    for (const p of paras) { delete p.sec; delete p.sf; delete p.role; delete p.size; delete p.font; }
    for (const s of pg.secs || []) { const p = paras[s.p]; if (!p) continue; if (s.p) p.sec = true; if (s.font) p.sf = s.font; }
    for (const q of pg.pp || []) { const p = paras[q.p]; if (!p) continue; if (q.role) p.role = q.role; if (q.size) p.size = q.size; if (q.font) p.font = q.font; }
    pg.font = pg.dfont || ''; pg.dfont = ''; pg.fonts = [];
    return paras;
  }
  applyFonts(paras, pg); pg.font = ''; pg.fonts = [];
  return paras;
}

function info(page) {
  const p = normalize(page), pc = paperCols(p.paper, p.pitch), pl = paperLines(p.paper);
  return {
    ...p, paperCols: pc, paperLines: pl, usable: pc - p.left - p.right, textLines: pl - p.top - p.bottom,
    centre: pc / 2, usableCentre: p.left + (pc - p.left - p.right) / 2, inchesWide: PAPERS[p.paper].w, inchesHigh: PAPERS[p.paper].h,
    usableInches: (pc - p.left - p.right) / p.pitch,
  };
}
const usableCols = (page) => info(page).usable;

// Page center mark and tab stops in the order a ruler draws them; positions are absolute columns from the paper's left edge.
function stops(page) {
  const i = info(page);
  return [{ pos: i.centre, kind: 'page' }, ...i.tabs];
}

// Expands \t in paragraph runs into spaces so the stored Craft stream (which has no tab code) lines up on the stops.
// Left stop: text starts at pos. Centre stop: the segment up to the next tab is centred on pos. Right stop: it ends at pos.
// Applies to the first line of a paragraph (column counted from the left margin); past the last stop, tabs go to the next 8.
function expandTabs(paras, page) {
  const i = info(page);
  return paras.map((p) => {
    const cells = []; for (const r of p.runs) for (const ch of r.t) cells.push({ ch, r });
    if (!cells.some((c) => c.ch === '\t')) return p;
    const out = []; let col = i.left + (p.bullet ? 2 : 0);
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      if (c.ch !== '\t') { out.push(c); col++; continue; }
      let seg = 0; for (let m = k + 1; m < cells.length && cells[m].ch !== '\t'; m++) seg++;
      const st = i.tabs.find((t) => t.pos > col);
      let target;
      if (!st) target = col + 8 - ((col - i.left) % 8);
      else target = st.kind === 'c' ? st.pos - (seg >> 1) : st.kind === 'r' ? st.pos - seg : st.pos;
      if (target <= col) target = col + 1;
      for (; col < target; col++) out.push({ ch: ' ', r: c.r });
    }
    const runs = []; let last = null;
    for (const c of out) {
      if (last && last.r === c.r) last.t += c.ch; else { last = { r: c.r, t: c.ch }; runs.push(last); }
    }
    return { ...p, runs: runs.map((x) => ({ ...x.r, t: x.t })) };
  });
}

// ---- CRFT trailer ----------------------------------------------------------------
// After the payload: 'CPG1', then records [tag u8][len u8][data]. Tag 1 page setup, tag 2 document font name (ASCII),
// tag 3 font change at a paragraph start: [paragraph u16 LE][name ASCII] (repeatable; paragraph = hard line, counted by CR codes).
// Page record: paper u8 (0 letter, 1 a4, 2 legal), pitch u8 (cpi), left, right, top, bottom u8, ntabs u8, ntabs x (pos u8, kind u8: 0 L, 1 C, 2 R).
function toTrailer(page) {
  const p = normalize(page), rec = [];
  const d = [PAPER_CODE.indexOf(p.paper), p.pitch, p.left, p.right, p.top, p.bottom, p.tabs.length];
  for (const t of p.tabs) d.push(t.pos, KIND_CODE[t.kind]);
  rec.push(1, d.length, ...d);
  if (p.font) { const f = Buffer.from(p.font, 'latin1'); rec.push(2, f.length, ...f); }
  for (const r of p.fonts) { const f = Buffer.from(r.font, 'latin1'); rec.push(3, 2 + f.length, r.p & 255, r.p >> 8, ...f); }
  // tags 4..7: sections, styles, paragraph roles/sizes/overrides, document default font (older readers skip them)
  for (const r of p.secs) { const f = Buffer.from(r.font, 'latin1'); rec.push(4, 2 + f.length, r.p & 255, r.p >> 8, ...f); }
  for (const role of ROLES) { const s = p.styles[role]; if (!s) continue; const f = Buffer.from(s.face, 'latin1'); rec.push(5, 5 + f.length, ROLES.indexOf(role), (s.b ? 1 : 0) | (s.i ? 2 : 0), s.align ? ALIGN_CODE[s.align] : 255, s.size, s.space, ...f); }
  for (const r of p.pp) { const f = Buffer.from(r.font, 'latin1'); rec.push(6, 4 + f.length, r.p & 255, r.p >> 8, ROLES.indexOf(r.role), r.size, ...f); }
  if (p.dfont) { const f = Buffer.from(p.dfont, 'latin1'); rec.push(7, f.length, ...f); }
  return Buffer.concat([Buffer.from(TRAILER_MAGIC, 'latin1'), Buffer.from(rec)]);
}

// Returns a normalized page setup, or null when the buffer is not a trailer. Unknown records are skipped; damaged ones end the parse.
function fromTrailer(buf) {
  if (!buf || buf.length < 4 || buf.toString('latin1', 0, 4) !== TRAILER_MAGIC) return null;
  const raw = {}; let at = 4;
  while (at + 2 <= buf.length) {
    const tag = buf[at], len = buf[at + 1], d = buf.subarray(at + 2, at + 2 + len);
    if (d.length < len) break;
    if (tag === 1 && len >= 7) {
      raw.paper = PAPER_CODE[d[0]]; raw.pitch = d[1]; raw.left = d[2]; raw.right = d[3]; raw.top = d[4]; raw.bottom = d[5];
      raw.tabs = []; for (let k = 0; k < d[6] && 7 + k * 2 + 1 < d.length; k++) raw.tabs.push({ pos: d[7 + k * 2], kind: KIND_NAME[d[8 + k * 2]] || 'l' });
    } else if (tag === 2) raw.font = d.toString('latin1');
    else if (tag === 3 && len >= 2) (raw.fonts = raw.fonts || []).push({ p: d[0] | (d[1] << 8), font: d.toString('latin1', 2) });
    else if (tag === 4 && len >= 2) (raw.secs = raw.secs || []).push({ p: d[0] | (d[1] << 8), font: d.toString('latin1', 2) });
    else if (tag === 5 && len >= 5 && ROLES[d[0]] !== undefined) (raw.styles = raw.styles || {})[ROLES[d[0]]] = { b: d[1] & 1, i: (d[1] >> 1) & 1, align: d[2] < 4 ? ALIGN_NAME[d[2]] : '', size: d[3], space: d[4], face: d.toString('latin1', 5) };
    else if (tag === 6 && len >= 4 && ROLES[d[2]] !== undefined) (raw.pp = raw.pp || []).push({ p: d[0] | (d[1] << 8), role: ROLES[d[2]], size: d[3], font: d.toString('latin1', 4) });
    else if (tag === 7) raw.dfont = d.toString('latin1');
    at += 2 + len;
  }
  return normalize(raw);
}

module.exports = { PAPERS, PITCHES, LPI, FLAG_TRAILER, defaults, normalize, info, usableCols, paperCols, paperLines, stops, expandTabs, toTrailer, fromTrailer, fontRecords, applyFonts, ROLES, ROLE_LABEL, SIZES, withSize, faceSize, resolve, sections, embed, extract };
