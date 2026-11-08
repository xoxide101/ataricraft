// Sheets tab: print or save font sheets (glyph chart, size comparison chart, font diff) as PNG at 150-4800 dpi, SVG or paper.
// The engine is web/js/fontedit/sheetcore.js (pages of rectangles, streamed PNG) and fontdiff.js (diff); this file is the panel.
(() => {
  'use strict';
  const FE = window.FE, CF = FE.CF, $ = FE.$, st = FE.state, esc = FE.esc, S = window.FESheet, D = window.FEDiff;
  let built = null, timer = 0, busy = false, cancel = false, labelFont = null;
  const PANGRAM = 'The quick brown fox jumps over the lazy dog.\nPack my box with five dozen liquor jugs 0123456789';
  const SETS = {
    ascii: ['ASCII 32-126', () => rng(32, 126)], latin1: ['Latin-1 160-255', () => rng(160, 255)], upper: ['A-Z', () => rng(65, 90)], lower: ['a-z', () => rng(97, 122)],
    digits: ['0-9', () => rng(48, 57)], graphics: ['Atari graphics', () => [...rng(0, 31), ...rng(128, 132)]], all: ['Every glyph that has pixels', () => rng(0, 255)], custom: ['Custom (below)', null],
  };
  function rng(a, b) { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; }

  // ---- fonts --------------------------------------------------------------------------------------------------------------------------
  // Loading a family switches the editor to it: remember what was open and put it back.
  FE.famOf = async (id) => {
    const e = FE.entries.get(id); if (!e) throw new Error('unknown font ' + id);
    if (!e.fam) { const prev = st.entry, size = st.f && st.f.adv; await FE.openEntry(id); if (prev && prev !== id && FE.entries.get(prev) && FE.entries.get(prev).fam) await FE.openEntry(prev, size); }
    return e.fam;
  };
  FE.pickSize = (fam, s) => {
    if (fam.sizes[s]) return fam.sizes[s];
    const ks = Object.keys(fam.sizes).map(Number); if (!ks.length) return null;
    return fam.sizes[ks.reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a))];
  };
  const labelF = () => {
    if (labelFont) return labelFont;
    const x = (window.ACW_FACES || []).find((f) => f.id === 'craft8') || (window.ACW_FACES || [])[0];
    labelFont = x ? CF.parse(FE.b64ToBuf(x.acf)) : st.f; return labelFont;
  };
  // kerning pairs of one size of a family as a plain table (the open family: tables + classes; others: what a copy stored)
  FE.kernTableOf = (fam, size) => {
    const f = fam.sizes[size]; if (!f) return {};
    if (fam === st.fam) { const t = st.kern[f.adv]; return t && Object.keys(t).length ? D.kernTable((a, b) => FE.kernOf(f, a, b), rng(32, 255)) : {}; }
    const t = fam.kern && fam.kern[size]; if (!t) return {};
    const o = {}; for (const k of Object.keys(t)) if (k[0] !== '@') o[k] = t[k]; return o;
  };
  const sizesOf = () => [...new Set(($('shsizes').value.match(/\d+/g) || []).map(Number))].filter((n) => n > 0 && n < 100);
  const selIds = () => [...$('shfonts').selectedOptions].map((o) => o.value);
  const codesOf = (f) => {
    const k = $('shset').value;
    let codes = k === 'custom' ? D.parseCodes($('shcodes').value, FE.codeOfChar) : SETS[k][1]();
    if (k === 'all' || k === 'graphics') codes = codes.filter((c) => D.present(CF, f, c));
    return codes;
  };

  function fillFonts() {
    const sel = $('shfonts'), keep = new Set(selIds()); if (!keep.size && st.entry) keep.add(st.entry);
    const h = [...FE.entries.values()].map((e) => '<option value="' + esc(e.id) + '"' + (keep.has(e.id) ? ' selected' : '') + '>' + esc(e.name) + '</option>').join('');
    if (sel.dataset.sig !== h) { sel.innerHTML = h; sel.dataset.sig = h; }
    const ref = $('shref'), rv = ref.value; ref.innerHTML = [...FE.entries.values()].map((e) => '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>').join('');
    ref.value = rv && FE.entries.has(rv) ? rv : (st.entry || '');
  }

  // ---- build the sheet ------------------------------------------------------------------------------------------------------------------
  async function build() {
    const type = $('shtype').value, ids = selIds(); if (!ids.length) throw new Error('Select at least one font');
    const spec = { CF, FD: D, paper: $('shpaper').value, landscape: $('shland').checked, zoom: +$('shzoom').value, dpi: +$('shdpi').value, labelFont: labelF(), labelZoom: 2, margin: 75, codeOf: FE.codeOfChar, guides: $('shguides').checked };
    const sizes = sizesOf(), cur = st.f ? st.f.adv : 8, fams = [];
    const failed = [];
    for (const id of ids) { try { const fam = await FE.famOf(id); if (!fam || !Object.keys(fam.sizes).length) throw new Error('no sizes'); fams.push({ id, name: FE.entries.get(id).name, fam }); } catch (e) { failed.push(FE.entries.get(id).name); } }
    if (!fams.length) throw new Error('Cannot load ' + failed.join(', '));
    let sheet, diffs = [];
    if (type === 'glyphs') {
      spec.items = fams.map((x) => { const f = FE.pickSize(x.fam, sizes[0] || cur); return { name: x.name, f }; });
      spec.codes = codesOf(spec.items[0].f); spec.title = 'Glyph chart';
      sheet = S.glyphChart(spec);
    } else if (type === 'sizes') {
      spec.items = fams.map((x) => ({ name: x.name, fam: x.fam, kern: $('shkern').checked && x.fam === st.fam ? (f, a, b) => FE.kernOf(f, a, b) : null }));
      spec.sizes = sizes.length ? sizes : Object.keys(fams[0].fam.sizes).map(Number).sort((a, b) => a - b);
      spec.text = $('shtext').value || PANGRAM; spec.title = 'Size comparison';
      sheet = S.sizeChart(spec);
    } else {
      const refId = $('shref').value && ids.includes($('shref').value) ? $('shref').value : ids[0], ref = fams.find((x) => x.id === refId);
      if (fams.length < 2) throw new Error('Select two or more fonts to compare');
      const s = sizes[0] || cur, A = FE.pickSize(ref.fam, s), align = $('shalign').value;
      const codes = codesOf(A), refName = ref.name + ' ' + A.adv + ' px';
      for (const x of fams) {
        if (x === ref) continue;
        const B = FE.pickSize(x.fam, s), diff = D.diffFonts(CF, A, B, { align, codes: $('shset').value === 'all' ? undefined : codes });
        const kern = D.kernDiff(FE.kernTableOf(ref.fam, A.adv), FE.kernTableOf(x.fam, B.adv));
        diffs.push({ name: x.name + ' ' + B.adv + ' px', f: B, diff, kern, ref: refName });
      }
      Object.assign(spec, { ref: { name: refName, f: A }, diffs, onlyDiff: $('shonly').checked, title: 'Font comparison' });
      sheet = S.diffSheet(spec);
    }
    return { sheet, spec, diffs, type, failed };
  }

  function summaryHtml(b) {
    if (b.type !== 'diff') return '';
    return b.diffs.map((d) => {
      const s = d.diff.summary, md = d.diff.metrics.filter((m) => m.differs), k = d.kern;
      return '<table class="mgtable"><thead><tr><th colspan="2">' + esc(d.ref) + ' (A) vs ' + esc(d.name) + ' (B)</th></tr></thead><tbody>' +
        '<tr><td>Glyphs compared</td><td>' + s.compared + ' (' + s.same + ' same, <b>' + s.changed + ' changed</b>, ' + s.missing + ' missing in B, ' + s.extra + ' extra in B)</td></tr>' +
        '<tr><td>Pixels</td><td>' + s.changedPx + ' differ (' + s.onlyA + ' only A, ' + s.onlyB + ' only B), ' + Math.round(s.similarity * 1000) / 10 + '% alike</td></tr>' +
        '<tr><td>Advance widths</td><td>' + s.advDiff + ' glyphs differ</td></tr>' +
        '<tr><td>Metrics</td><td>' + (md.length ? md.map((m) => esc(m.key) + ' ' + m.a + ' &rarr; ' + m.b).join(', ') : 'identical') + '</td></tr>' +
        '<tr><td>Kerning</td><td>' + k.differ.length + ' differ, ' + k.onlyA.length + ' only in A, ' + k.onlyB.length + ' only in B</td></tr></tbody></table>';
    }).join('');
  }

  // ---- preview ---------------------------------------------------------------------------------------------------------------------------
  function show() {
    const b = built; if (!b) return;
    const sel = $('shpage'), n = b.sheet.pages.length, cur = Math.min(+sel.value || 0, n - 1);
    sel.innerHTML = b.sheet.pages.map((_, i) => '<option value="' + i + '"' + (i === cur ? ' selected' : '') + '>Page ' + (i + 1) + ' of ' + n + '</option>').join('');
    const page = b.sheet.pages[cur], cv = $('shcv'), scale = Math.min(1, Math.max(0.3, ($('shpvw').value || 700) / page.w));
    cv.width = Math.round(page.w * scale); cv.height = Math.round(page.h * scale); S.paintCanvas(cv.getContext('2d'), page, scale);
    const dpi = +$('shdpi').value, [W, H] = S.dotsOf(page, dpi), mp = (W * H) / 1e6;
    $('shinfo').innerHTML = '<b>' + n + ' page' + (n > 1 ? 's' : '') + '</b>, ' + W + ' x ' + H + ' dots per page at ' + dpi + ' dpi (' + (mp >= 1000 ? (mp / 1000).toFixed(2) + ' Gpixel' : Math.round(mp) + ' Mpixel') + '), one font pixel = ' + S.dotsPer(b.spec).toFixed(b.spec.zoom * dpi % 150 ? 2 : 0) + ' dots, hard edges (no smoothing). ' + (mp > 150 ? 'Streamed to the file in strips: it does not need a big canvas.' : '');
    $('shsum').innerHTML = (b.failed.length ? '<div class="dim">Skipped (could not load): ' + esc(b.failed.join(', ')) + '</div>' : '') + summaryHtml(b);
    for (const id of ['shcsv', 'shjson']) $(id).hidden = b.type !== 'diff';
  }
  async function refresh() {
    if (!FE.isTab('sheets')) return;
    try { fillFonts(); built = await build(); show(); } catch (e) { built = null; $('shinfo').textContent = e.message; const cv = $('shcv'); cv.width = 1; cv.height = 1; $('shsum').innerHTML = ''; }
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(refresh, 150); };

  // ---- save and print --------------------------------------------------------------------------------------------------------------------------
  const baseName = (b) => ((b.type === 'diff' ? 'diff' : b.type) + '-' + (FE.entries.get(selIds()[0]) || { name: 'font' }).name).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40);
  const prog = (v) => { $('shprog').value = v; $('shprog').hidden = v >= 1 || v <= 0; };
  FE.sheetPng = async (pageIdx, dpi, region) => {
    if (!built) await refresh();
    const page = built.sheet.pages[pageIdx || 0];
    return new Blob(await S.renderPng(page, { dpi: dpi || +$('shdpi').value, region, name: built.sheet.info.title, onProgress: prog, cancelled: () => cancel }), { type: 'image/png' });
  };
  async function savePng(all) {
    if (busy) { cancel = true; return; }
    if (!built) return FE.toast('Nothing to save yet');
    busy = true; cancel = false; $('shpng').textContent = 'Stop'; $('shpngall').disabled = true;
    try {
      const dpi = +$('shdpi').value, tile = +$('shtile').value, nm = baseName(built), pages = all ? built.sheet.pages.map((_, i) => i) : [Math.min(+$('shpage').value || 0, built.sheet.pages.length - 1)], files = [];
      for (const pi of pages) {
        const page = built.sheet.pages[pi], tag = built.sheet.pages.length > 1 ? '-p' + (pi + 1) : '', [W, H] = S.dotsOf(page, dpi);
        if (tile && (W > tile || H > tile)) {
          for (const t of S.tiles(page, dpi, tile)) files.push([nm + tag + '-r' + (t.r + 1) + 'c' + (t.c + 1) + '-' + dpi + 'dpi.png', await FE.sheetPng(pi, dpi, t.region)]);
        } else files.push([nm + tag + '-' + dpi + 'dpi.png', await FE.sheetPng(pi, dpi)]);
      }
      if (files.length === 1) FE.download(files[0][0], files[0][1], 'image/png');
      else if (XCW.zipStore) {
        const z = XCW.zipStore(await Promise.all(files.map(async ([n, bl]) => [n, Buffer.from(await bl.arrayBuffer())])));
        FE.download(nm + '-' + dpi + 'dpi.zip', Buffer.from(z), 'application/zip');
      } else for (const [n, bl] of files) FE.download(n, bl, 'image/png');
      FE.toast('Saved ' + files.length + ' PNG' + (files.length > 1 ? 's (zip)' : '') + ' at ' + dpi + ' dpi');
    } catch (e) { FE.toast(e.message === 'cancelled' ? 'Stopped' : 'Cannot save PNG: ' + e.message); }
    busy = false; cancel = false; $('shpng').textContent = 'Save PNG'; $('shpngall').disabled = false; prog(0);
  }
  function saveSvg() {
    if (!built) return;
    const nm = baseName(built), pages = built.sheet.pages;
    if (pages.length === 1) FE.download(nm + '.svg', S.toSvg(pages[0], { title: built.sheet.info.title }), 'image/svg+xml');
    else FE.download(nm + '-svg.zip', Buffer.from(XCW.zipStore(pages.map((p, i) => [nm + '-p' + (i + 1) + '.svg', Buffer.from(S.toSvg(p, { title: built.sheet.info.title }))]))), 'application/zip');
    FE.toast('Saved vector SVG (scales to any resolution, A-Z of the font stays crisp)');
  }
  async function print() {
    if (!built) return;
    const raster = $('shprintmode').value === 'raster', dpi = +$('shdpi').value, pages = built.sheet.pages;
    let images = null;
    if (raster) {
      const [W, H] = S.dotsOf(pages[0], dpi);
      if (W * H > 150e6) FE.toast('Too big to print as a picture at ' + dpi + ' dpi: printing as vector (the printer uses its own resolution)');
      else { images = []; for (let i = 0; i < pages.length; i++) images.push(URL.createObjectURL(await FE.sheetPng(i, dpi))); }
    }
    const html = S.printHtml(pages, built.spec, { title: built.sheet.info.title, images });
    const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(fr);
    fr.srcdoc = html; fr.onload = () => { setTimeout(() => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { FE.toast('Cannot print: ' + e.message); } setTimeout(() => fr.remove(), 60000); }, 100); };
    FE.lastPrintHtml = html;
  }
  FE.sheetBuilt = () => built;
  FE.sheetRefresh = refresh;
  FE.sheetPreset = (kind) => {
    const P = { edit: ['glyphs', 'ascii'], outline: ['glyphs', 'ascii'], family: ['sizes', null], specimen: ['sizes', null], kern: ['sizes', null], atari: ['glyphs', 'all'], manager: ['diff', null] };
    const p = P[kind] || P.edit; $('shtype').value = p[0]; if (p[1]) $('shset').value = p[1];
    if (kind === 'kern') { $('shkern').checked = true; $('shtext').value = $('ktext').value; }
    if (kind === 'atari') $('shsizes').value = '8';
    if (kind === 'family' || kind === 'specimen') { const f = st.fam; if (f) $('shsizes').value = Object.keys(f.sizes).map(Number).sort((a, b) => a - b).join(' '); }
    if (kind === 'edit' || kind === 'outline') $('shsizes').value = String(st.f ? st.f.adv : 8);
    const ids = new Set(selIds()); if (st.entry && !ids.size) { /* fillFonts selects the open font */ }
    FE.showTab('sheets');
  };
  const sync = () => { $('shcodes').hidden = $('shset').value !== 'custom'; const t = $('shtype').value; for (const [id, on] of [['shtextrow', t === 'sizes'], ['shdiffrow', t === 'diff'], ['shsetrow', t !== 'sizes']]) $(id).hidden = !on; };

  document.addEventListener('DOMContentLoaded', () => {
    $('shset').innerHTML = Object.entries(SETS).map(([k, v]) => '<option value="' + k + '">' + v[0] + '</option>').join('');
    $('shdpi').innerHTML = S.DPIS.map((d) => '<option value="' + d + '"' + (d === 300 ? ' selected' : '') + '>' + d + ' dpi</option>').join('');
    $('shtext').value = PANGRAM; $('shsizes').value = '8 12 16 24';
    for (const id of ['shtype', 'shset', 'shcodes', 'shsizes', 'shtext', 'shzoom', 'shdpi', 'shpaper', 'shland', 'shalign', 'shonly', 'shguides', 'shkern', 'shfonts', 'shref']) { const el = $(id); el.addEventListener('input', () => { sync(); later(); }); el.addEventListener('change', () => { sync(); later(); }); }
    $('shpage').onchange = show;
    $('shpng').onclick = () => savePng(false); $('shpngall').onclick = () => savePng(true); $('shsvg').onclick = saveSvg; $('shprint').onclick = print;
    $('shcsv').onclick = () => built && built.diffs.length && FE.download(baseName(built) + '.csv', D.toCsv(built.diffs.map((d) => ({ ref: built.spec.ref.name, name: d.name, diff: d.diff }))), 'text/csv');
    $('shjson').onclick = () => built && built.diffs.length && FE.download(baseName(built) + '.json', D.toJson(built.diffs.map((d) => ({ ref: built.spec.ref.name, name: d.name, diff: d.diff, kern: d.kern }))), 'application/json');
    $('shall').onclick = () => { for (const o of $('shfonts').options) o.selected = true; later(); };
    $('shcur').onclick = () => { for (const o of $('shfonts').options) o.selected = o.value === st.entry; later(); };
    $('bsheet').onclick = () => FE.sheetPreset(st.tab);
    FE.key('Ctrl+P', 'Print or save a font sheet (PNG 150-4800 dpi, SVG, paper)', () => FE.sheetPreset(st.tab), 'Sheets');
    FE.onTab('sheets', () => { sync(); later(); });
    sync();
  });
  FE.renders.push(() => { if (FE.isTab('sheets') && !busy) later(); });
  const wl = FE.libChanged; FE.libChanged = function () { const r = wl.apply(this, arguments); if (FE.isTab('sheets')) { $('shfonts').dataset.sig = ''; later(); } return r; };
})();
