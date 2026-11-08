// Copy tab: copy glyphs, ranges, advances, vertical metrics and kerning from one font (any size) to another, with a slot offset map,
// optional scaling or re-rasterizing from the source outline, one-step undo (Ctrl+Z) and a licence/credit record on the receiving family.
// The planning maths is in fontdiff.js (FEDiff.planGlyphs / planMetrics / planKern); this file is the panel.
(() => {
  'use strict';
  const FE = window.FE, CF = FE.CF, FP = FE.FP, $ = FE.$, st = FE.state, esc = FE.esc, D = window.FEDiff;
  const CKEY = 'craft.fontedit.credits';
  let credits = {}; try { credits = JSON.parse(localStorage.getItem(CKEY) || '{}') || {}; } catch (e) { credits = {}; }
  FE.credits = { of: (name) => credits[name] || [], all: () => credits, add(name, rec) { (credits[name] = credits[name] || []).push(rec); try { localStorage.setItem(CKEY, JSON.stringify(credits)); } catch (e) { /* quota */ } } };
  FE.creditsText = (name) => {
    const l = FE.credits.of(name); if (!l.length) return '';
    return 'Glyph sources merged into ' + name + '\n\n' + l.map((r) => '- ' + r.date + ': ' + r.what + ' from ' + r.from + ' (' + r.origin + ')' + (r.license ? '\n  Licence: ' + r.license.replace(/\s+/g, ' ').slice(0, 300) : '') + (r.licenseUrl ? '\n  ' + r.licenseUrl : '') + (r.copyright ? '\n  ' + r.copyright.replace(/\s+/g, ' ').slice(0, 200) : '')).join('\n') + '\n';
  };

  const PRESETS = { sel: ['Selected glyphs (Glyphs tab)', null], ascii: ['ASCII 32-126', '32-126'], upper: ['A-Z', 'A-Z'], lower: ['a-z', 'a-z'], digits: ['0-9', '0-9'], latin1: ['Latin-1 160-255', '160-255'], all: ['Every glyph with pixels', '0-255'], custom: ['Custom (below)', null] };
  const sfntOf = (b) => FP.Sfnt.parse(String.fromCharCode(...b.slice(0, 4)) === 'ttcf' ? FP.Formats.ttcUnpack(b, 0) : b);
  const val = (id) => $(id).value;
  let last = null;

  const fillFonts = () => {
    const h = [...FE.entries.values()].map((e) => '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>').join('');
    for (const id of ['cpsrc', 'cptgt']) { const el = $(id), v = el.value; if (el.dataset.sig !== h) { el.innerHTML = h; el.dataset.sig = h; } el.value = v && FE.entries.has(v) ? v : (st.entry || ''); }
  };
  async function fillSizes(which) {
    const id = val(which === 'src' ? 'cpsrc' : 'cptgt'), el = $(which === 'src' ? 'cpsrcsz' : 'cptgtsz'), v = el.value;
    if (!id) return; let fam; try { fam = await FE.famOf(id); } catch (e) { fam = null; } if (!fam) { el.innerHTML = ''; return; } const sizes = Object.keys(fam.sizes).map(Number).sort((a, b) => a - b);
    el.innerHTML = sizes.map((s) => '<option value="' + s + '">' + s + ' px</option>').join('');
    el.value = sizes.includes(+v) ? v : String(sizes.includes(st.f && st.f.adv) ? st.f.adv : sizes[0]);
  }
  const srcInfo = () => { const id = val('cpsrc'), s = FE.sources && FE.sources.get(id); return s || null; };
  function licence() {
    const s = srcInfo(), row = $('cplicrow'), need = !!s && (s.origin === 'installed' || !!s.license);
    row.hidden = !need; if (!need) { $('cplic').checked = false; return; }
    $('cplictxt').textContent = 'I may use these glyphs from ' + s.family + (s.style ? ' ' + s.style : '') + ' (' + (s.origin === 'installed' ? 'installed font' : 'file') + '; ' + (s.license ? 'licence: ' + s.license.replace(/\s+/g, ' ').slice(0, 120) : 'no licence text in the font') + '). Note the source in the credits.';
  }

  // the glyph codes to copy (source codes)
  function codes(srcF) {
    const k = val('cpset');
    let spec = k === 'custom' ? val('cpcodes') : PRESETS[k][1];
    if (k === 'sel') return [...new Set(FE.selSlots().map((s) => FE.codeOfSlot(s, st.f)))].filter((c) => c != null).sort((a, b) => a - b);
    if (!spec) return [];
    let out = D.parseCodes(spec, FE.codeOfChar);
    if (k === 'all') out = out.filter((c) => D.present(CF, srcF, c));
    return out;
  }
  const offsetOf = (cs) => {
    const t = val('cpat').trim(); if (!t || !cs.length) return 0;
    if (/^[+-]\d+$/.test(t)) return +t;
    const to = /^#\d+$/.test(t) ? +t.slice(1) : /^(0x|U\+)/i.test(t) ? parseInt(t.replace(/^(0x|U\+)/i, ''), 16) : FE.codeOfChar([...t][0]);
    return to - Math.min(...cs);
  };
  const srcKern = (srcFam, srcF) => {
    const own = srcFam.kern && srcFam.kern[srcF.adv], fromOwn = own && Object.keys(own).some((k) => k[0] !== '@');
    return (a, b) => { if (fromOwn && srcFam !== st.fam) { const v = own[a + ',' + b]; if (v) return v; return 0; } return FE.kernOf(srcF, a, b); };
  };

  // Everything a copy would do, without touching any font
  async function plan() {
    const sid = val('cpsrc'), tid = val('cptgt'); if (!sid || !tid) throw new Error('Pick a source and a target font');
    const sfam = await FE.famOf(sid), tfam = await FE.famOf(tid), ssz = +val('cpsrcsz'), tsz = +val('cptgtsz');
    if (!sfam || !tfam) throw new Error('Cannot load that font');
    let src = sfam.sizes[ssz], dst = tfam.sizes[tsz]; if (!src || !dst) throw new Error('Pick a size for both fonts');
    if (src === dst && !val('cpat') && !$('cpmetrics').checked && !$('cpkern').checked) throw new Error('Source and target are the same font: set "Put at" to copy within it');
    const fit = val('cpfit'), o = { threshold: +val('cpth') / 100, baseline: val('cpbase') === '1', overwrite: val('cpover'), advs: $('cpadv').checked, mode: fit === 'scale' ? 'scale' : 'copy' };
    let from = src, raster = null;
    if (fit === 'raster') {
      const s = FE.srcs.get(sid); if (!s) throw new Error('This font has no outline to re-rasterize (only TTF/OTF/WOFF imports and system fonts do). Use copy or scale.');
      from = FP.rasterFont(sfntOf(s.bytes), tsz, { threshold: Math.round(+val('cpth') * 2.55), weight: +val('cpw'), hint: $('cphint').checked });
      raster = { size: tsz, threshold: val('cpth'), weight: val('cpw'), hint: $('cphint').checked };
    }
    const cs = $('cpglyph').checked || $('cpkern').checked ? codes(from) : [], off = offsetOf(cs);
    const gl = $('cpglyph').checked ? D.planGlyphs(CF, from, dst, cs, Object.assign({ offset: off }, o)) : { items: [], skipped: [] };
    const met = $('cpmetrics').checked ? D.planMetrics(CF, from, dst, { scale: fit !== 'copy' && src.rows !== dst.rows }) : null;
    const kern = $('cpkern').checked ? D.planKern(srcKern(sfam, src), cs, src.adv, dst.adv, { offset: off, scale: fit !== 'copy' }) : null;
    return { sid, tid, sfam, tfam, src, dst, from, gl, met, kern, off, cs, fit, raster, ssz, tsz };
  }

  function preview(p) {
    const cv = $('cppv'), c = cv.getContext('2d'), z = 3, items = p.gl.items.slice(0, 120), cell = Math.max(p.dst.adv, p.src.adv) + 4, rowsH = Math.max(p.dst.rows, p.src.rows) + 3, per = Math.max(1, Math.min(items.length || 1, 16)), n = Math.ceil(items.length / per) || 1, t = FE.themeColors();
    cv.width = per * cell * z * 2; cv.height = n * rowsH * z; c.fillStyle = t.paper; c.fillRect(0, 0, cv.width, cv.height);
    const draw = (f, rows, x, y, col) => { const w = CF.colsOf ? Math.max(f.adv, 8) : f.adv; c.fillStyle = col; for (let r = 0; r < f.rows; r++) for (let q = 0; q < w + 8; q++) if (CF.hasPx(f, rows[r] || 0, q)) c.fillRect((x + q) * z, (y + r) * z, z, z); };
    items.forEach((it, i) => {
      const x = (i % per) * cell * 2, y = Math.floor(i / per) * rowsH;
      draw(p.from, p.from.glyphs[p.from.map[it.code]] || [], x + 1, y + 1, '#8a93a3');
      draw(p.dst, it.rows, x + cell + 1, y + 1, it.replaces ? '#d04040' : '#1a7f37');
    });
  }
  const summary = (p) => {
    const g = p.gl, rep = g.items.filter((i) => i.replaces).length;
    return (g.items.length ? '<b>' + g.items.length + '</b> glyph' + (g.items.length > 1 ? 's' : '') + ' to copy (' + rep + ' replace existing pixels, ' + (g.items.length - rep) + ' new), ' : '') +
      (g.skipped.length ? g.skipped.length + ' skipped (' + esc([...new Set(g.skipped.map((s) => s.why.replace(/\d+/g, 'N')))].join('; ')) + '), ' : '') +
      (p.off ? 'slots shifted by ' + (p.off > 0 ? '+' : '') + p.off + ', ' : '') + (p.met ? 'vertical metrics, ' : '') + (p.kern ? Object.keys(p.kern).length + ' kerning pairs, ' : '') +
      (p.fit === 'raster' ? 'outline re-rasterized at ' + p.tsz + ' px, ' : '') + 'grey = source, ' + 'red = replaces, green = new.';
  };
  async function doPreview() {
    try { const p = await plan(); preview(p); $('cpinfo').innerHTML = summary(p); return p; } catch (e) { $('cpinfo').textContent = e.message; const cv = $('cppv'); cv.width = 1; cv.height = 1; return null; }
  }

  async function apply() {
    let p; try { p = await plan(); } catch (e) { return FE.toast(e.message); }
    if (!p.gl.items.length && !p.met && !(p.kern && Object.keys(p.kern).length)) return FE.toast('Nothing to copy: ' + (p.gl.skipped[0] ? p.gl.skipped[0].why : 'choose glyphs or tick metrics / kerning'));
    const s = srcInfo(); if (!$('cplicrow').hidden && !$('cplic').checked) return FE.toast('Tick the licence box first: this font comes from a system or licensed source');
    // undo works on the open font, so make the target the open font
    if (st.entry !== p.tid) await FE.openEntry(p.tid, p.tsz);
    if (st.f !== p.dst) FE.selectSize(p.tsz);
    if (st.f !== p.dst) return FE.toast('Could not open the target size');
    st.tgt = 0; document.querySelectorAll('.tgt').forEach((b) => b.classList.toggle('on', +b.dataset.t === 0));
    const slots = p.gl.items.map((i) => i.slot);
    const label = 'Copy ' + (p.gl.items.length ? p.gl.items.length + ' glyph' + (p.gl.items.length > 1 ? 's' : '') : '') + (p.met ? ' metrics' : '') + (p.kern ? ' kerning' : '') + ' from ' + (FE.entries.get(p.sid) || { name: '?' }).name + ' ' + p.src.adv;
    FE.push(label, slots, !!p.met || p.gl.items.some((i) => i.adv !== undefined), !!p.kern);
    D.applyGlyphs(p.dst, p.gl);
    if (p.met) Object.assign(p.dst, p.met);
    if (p.kern) { const t = st.kern[p.dst.adv] || (st.kern[p.dst.adv] = {}); Object.assign(t, p.kern); }
    CF.markEdited(p.dst);
    const from = FE.entries.get(p.sid), what = [p.gl.items.length ? p.gl.items.length + ' glyphs' : '', p.met ? 'metrics' : '', p.kern ? 'kerning' : ''].filter(Boolean).join(', ') + ' at ' + p.tsz + ' px';
    if (from && p.sid !== p.tid) {
      const rec = { date: new Date().toISOString().slice(0, 10), from: from.name + ' ' + p.src.adv + ' px', origin: s ? s.origin : (from.kind || 'library'), what, license: s ? s.license : '', licenseUrl: s ? s.licenseUrl : '', copyright: s ? s.copyright : '' };
      FE.credits.add(p.tfam.name, rec); p.tfam.credits = FE.credits.of(p.tfam.name);
    }
    last = { name: label };
    FE.changed(); FE.libChanged && FE.libChanged();
    $('cplog').innerHTML = '<div class="ok">Done: ' + esc(label) + '. Ctrl+Z (or "Undo last copy") puts everything back.</div>' + $('cplog').innerHTML;
    FE.toast('Copied: ' + what);
    doPreview();
  }

  // select source/target from other panels (system fonts dialog, manager)
  FE.useAs = async (role, id) => {
    FE.showTab('copy'); fillFonts(); $(role === 'src' ? 'cpsrc' : 'cptgt').value = id; await fillSizes(role === 'src' ? 'src' : 'tgt'); licence(); doPreview();
    if (role === 'cmp') { FE.showTab('sheets'); const o = [...$('shfonts').options].find((x) => x.value === id); if (o) { o.selected = true; $('shtype').value = 'diff'; $('shtype').dispatchEvent(new Event('change')); } }
  };

  document.addEventListener('DOMContentLoaded', () => {
    $('cpset').innerHTML = Object.entries(PRESETS).map(([k, v]) => '<option value="' + k + '">' + v[0] + '</option>').join('');
    const again = () => { licence(); doPreview(); };
    $('cpsrc').onchange = async () => { await fillSizes('src'); again(); }; $('cptgt').onchange = async () => { await fillSizes('tgt'); again(); };
    for (const id of ['cpsrcsz', 'cptgtsz', 'cpset', 'cpcodes', 'cpat', 'cpfit', 'cpbase', 'cpth', 'cpw', 'cphint', 'cpover', 'cpglyph', 'cpadv', 'cpmetrics', 'cpkern']) { $(id).addEventListener('change', again); $(id).addEventListener('input', again); }
    $('cpprev').onclick = doPreview; $('cpapply').onclick = apply; $('cpsys').onclick = () => FE.openSystemFonts && FE.openSystemFonts();
    $('cpundo').onclick = async () => {
      if (!last) return FE.toast('No copy to undo');
      const n = FE.undo(); if (n) { FE.toast('Undone: ' + last.name); last = null; doPreview(); }
    };
    $('cpswap').onclick = async () => { const a = [val('cpsrc'), val('cpsrcsz')], b = [val('cptgt'), val('cptgtsz')]; $('cpsrc').value = b[0]; $('cptgt').value = a[0]; await fillSizes('src'); await fillSizes('tgt'); $('cpsrcsz').value = b[1]; $('cptgtsz').value = a[1]; again(); };
    FE.onTab('copy', async () => { fillFonts(); if (!$('cpsrcsz').options.length) { await fillSizes('src'); await fillSizes('tgt'); } licence(); doPreview(); });
  });
  const wl = FE.libChanged; FE.libChanged = function () { const r = wl.apply(this, arguments); if ($('cpsrc')) { fillFonts(); } return r; };
})();
