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
  o.font = String(o.font || '').replace(/[^\x20-\x7e]/g, '').slice(0, 32);
  const fs = new Set();
  o.fonts = (Array.isArray(o.fonts) ? o.fonts : []).map((r) => ({ p: Math.max(0, Math.min(65535, Math.round(+r.p) || 0)), font: String(r.font || '').replace(/[^\x20-\x7e]/g, '').slice(0, 32) }))
    .filter((r) => !fs.has(r.p) && fs.add(r.p)).sort((a, b) => a.p - b.p).slice(0, 64);
  return o;
}

// One font per line block (docs/FONT.md): a paragraph's font is its `font` property. The trailer stores only the changes, each at a
// paragraph start, so a font can never change in the middle of a line.
function fontRecords(paras, docFont = '') {
  const out = []; let cur = docFont || '';
  paras.forEach((p, i) => { let f = p.font || docFont || ''; if (!f && cur) f = 'ROM'; if (f !== cur) { out.push({ p: i, font: f }); cur = f; } });
  return out;
}
function applyFonts(paras, page) {
  const recs = (page && page.fonts) || []; let cur = (page && page.font) || '', k = 0;
  paras.forEach((p, i) => { while (k < recs.length && recs[k].p <= i) cur = recs[k++].font; if (cur && cur !== 'ROM') p.font = cur; else delete p.font; });
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
    at += 2 + len;
  }
  return normalize(raw);
}

module.exports = { PAPERS, PITCHES, LPI, FLAG_TRAILER, defaults, normalize, info, usableCols, paperCols, paperLines, stops, expandTabs, toTrailer, fromTrailer, fontRecords, applyFonts };
