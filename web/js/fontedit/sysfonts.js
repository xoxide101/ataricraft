// System and local fonts: browse the fonts installed on this computer (Chrome queryLocalFonts), or pick font files / a folder, preview them as
// Atari bitmap glyphs (size, threshold, hinting off), add them to the working set and use them as source or target for compare, merge and copy.
// Every font added here keeps a source/licence note (FE.sources) that the copy tab writes into the credits of any family that receives glyphs.
(() => {
  'use strict';
  const FE = window.FE, CF = FE.CF, FP = FE.FP, $ = FE.$, st = FE.state, esc = FE.esc;
  const KEY = 'craft.fontedit.sources';
  let db = {}; try { db = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { db = {}; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* quota */ } };
  FE.sources = { get: (id) => db[id] || null, set: (id, v) => { db[id] = v; save(); }, all: () => db };

  // name table of a font file: copyright (0), family (1), style (2), full name (4), PostScript (6), manufacturer (8), designer (9), licence (13), licence URL (14)
  const U16 = (b, o) => (b[o] << 8) | b[o + 1], U32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  function nameTable(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), tag = String.fromCharCode(...b.slice(0, 4));
    if (tag === 'wOFF' || tag === 'wOF2') { try { const t = FP.Sfnt.parse(b).tables.name; return t ? Uint8Array.from(t) : null; } catch (e) { return null; } }
    const base = tag === 'ttcf' ? U32(b, 12) : 0, n = U16(b, base + 4);
    for (let i = 0; i < n; i++) { const o = base + 12 + i * 16; if (String.fromCharCode(...b.slice(o, o + 4)) === 'name') return b.subarray(U32(b, o + 8), U32(b, o + 8) + U32(b, o + 12)); }
    return null;
  }
  FE.nameInfo = (bytes) => {
    const out = {}; let t = null;
    try { t = nameTable(bytes); } catch (e) { t = null; }
    if (!t || t.length < 6) return out;
    const cnt = U16(t, 2), so = U16(t, 4), best = {};
    for (let i = 0; i < cnt; i++) {
      const o = 6 + i * 12, pid = U16(t, o), id = U16(t, o + 6), len = U16(t, o + 8), off = so + U32(new Uint8Array([0, 0, t[o + 10], t[o + 11]]), 0);
      if (off + len > t.length) continue;
      let s = '';
      if (pid === 1) for (let k = 0; k < len; k++) s += String.fromCharCode(t[off + k]); else for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(U16(t, off + k));
      const rank = pid === 3 && U16(t, o + 4) === 0x409 ? 3 : pid === 3 ? 2 : 1;
      if (!best[id] || rank > best[id]) { best[id] = rank; out[id] = s.trim(); }
    }
    return { copyright: out[0], family: out[1], style: out[2], fullName: out[4], postscript: out[6], manufacturer: out[8], designer: out[9], license: out[13], licenseUrl: out[14] };
  };

  let items = [], sel = null, token = 0;
  const bytesOf = async (it) => (it.bytes || (it.bytes = new Uint8Array(await (await it.blob()).arrayBuffer())));
  const rOpts = () => ({ threshold: +$('systh').value, weight: +$('sysw').value, hint: $('sysh').checked });
  const sfntOf = (bytes) => FP.Sfnt.parse(String.fromCharCode(...bytes.slice(0, 4)) === 'ttcf' ? FP.Formats.ttcUnpack(bytes, 0) : bytes);

  function list() {
    const q = $('sysfilter').value.trim().toLowerCase(), rows = items.filter((it) => !q || (it.family + ' ' + it.style + ' ' + (it.ps || '')).toLowerCase().includes(q));
    $('syscount').textContent = rows.length + ' of ' + items.length + ' fonts' + (rows.length > 400 ? ' (first 400 shown: type to narrow)' : '');
    $('syslist').innerHTML = rows.slice(0, 400).map((it) => '<div class="fitem' + (it === sel ? ' on' : '') + '" data-i="' + items.indexOf(it) + '" tabindex="0"><div class="fn">' + esc(it.family) + '</div><div class="fb"><span class="badge">' + esc(it.style || 'Regular') + '</span><span class="fc">' + esc(it.origin) + '</span></div></div>').join('') || '<div class="empty">No fonts listed yet. Use "Installed fonts" (Chrome), or pick font files or a folder.</div>';
  }
  async function preview() {
    const it = sel; if (!it) return; const my = ++token;
    try {
      const bytes = await bytesOf(it); if (my !== token) return;
      const f = FP.rasterFont(sfntOf(bytes), +$('syssize').value, rOpts()), z = 3, text = $('systext').value || 'Hamburgefonstiv', cv = $('syspv'), c = cv.getContext('2d'), t = FE.themeColors();
      const lines = text.split('\n'), w = Math.max(...lines.map((l) => window.FESheet.textWidth(f, l, { codeOf: FE.codeOfChar }))) + 8;
      cv.width = Math.min(1400, w * z); cv.height = (lines.length * (f.rows + 2) + 4) * z; c.fillStyle = t.paper; c.fillRect(0, 0, cv.width, cv.height);
      lines.forEach((l, i) => FE.drawLine(c, f, l, 4, 2 + i * (f.rows + 2), z, '#16181c', { kern: false }));
      it.info = it.info || FE.nameInfo(bytes);
      const i = it.info, have = rangeCount(f);
      $('sysinfo').innerHTML = '<b>' + esc(it.family + ' ' + (it.style || '')) + '</b> - ' + have + ' of 95 ASCII glyphs have pixels at ' + f.adv + ' px<br>' + (i.license ? 'Licence: ' + esc(i.license.slice(0, 400)) + '<br>' : '<span class="dim">No licence text in the font file: check the licence before you merge glyphs from it.</span><br>') + (i.licenseUrl ? 'Licence URL: ' + esc(i.licenseUrl) + '<br>' : '') + (i.copyright ? esc(i.copyright.slice(0, 300)) : '');
    } catch (e) { $('sysinfo').textContent = 'Cannot read this font: ' + e.message; }
  }
  const rangeCount = (f) => { let n = 0; for (let c = 33; c < 127; c++) if (f.glyphs[f.map[c]].some((v) => v)) n++; return n; };

  async function add(role) {
    const it = sel; if (!it) return FE.toast('Pick a font in the list first');
    try {
      const bytes = await bytesOf(it), size = +$('syssize').value, o = rOpts(), info = it.info || FE.nameInfo(bytes);
      // the Source panel controls drive the import: set them to this dialog's settings (hinting off by default) so a later re-render matches
      $('ttfth').value = o.threshold; $('ttfw').value = o.weight; $('ttfh').checked = o.hint;
      const name = ((it.family + ' ' + (it.style && !/^regular$/i.test(it.style) ? it.style : '')).trim()).slice(0, 40);
      await FE.openBytes(bytes, name + '.ttf', { keep: $('syskeep').checked });
      const id = st.entry, e = FE.entries.get(id); if (!e || !e.fam) throw new Error('the font was not added');
      if ($('sysdirect').checked) {
        const f = FP.rasterFont(sfntOf(bytes), size, o); f.name = name.slice(0, 40); f.origin = CF.ORIGIN.master; f.masterAdv = size === 12 ? 0 : 12;
        const G = XCW.Gfx; if (G && !G.hasGfx(f)) G.install(f);
        e.fam.sizes[size] = f; FE.libChanged(); FE.selectSize(size);
      }
      if (!e.badges.includes('System')) e.badges.push(it.origin === 'installed' ? 'System' : 'File');
      FE.sources.set(id, { origin: it.origin, family: it.family, style: it.style, postscript: it.ps || info.postscript, file: it.file || null, license: info.license || '', licenseUrl: info.licenseUrl || '', copyright: info.copyright || '', manufacturer: info.manufacturer || '', designer: info.designer || '', added: new Date().toISOString().slice(0, 10), raster: { size, threshold: o.threshold, weight: o.weight, hint: o.hint } });
      FE.libChanged(); FE.toast('Added ' + name + ' to the working set' + (role ? ' as ' + (role === 'src' ? 'copy source' : role === 'tgt' ? 'copy target' : 'compare font') : ''));
      if (role && FE.useAs) FE.useAs(role, id);
      return id;
    } catch (x) { FE.toast('Cannot add this font: ' + x.message); }
  }

  async function installed() {
    if (!window.queryLocalFonts) return FE.toast('This browser cannot list installed fonts (Chrome/Edge 103+ can). Use "Pick font files" or "Pick a folder" instead.');
    try {
      const fonts = await window.queryLocalFonts();
      items = items.filter((i) => i.origin !== 'installed').concat(fonts.map((f) => ({ family: f.family, style: f.style, ps: f.postscriptName, origin: 'installed', blob: () => f.blob() })));
      items.sort((a, b) => (a.family + a.style).localeCompare(b.family + b.style)); list();
    } catch (e) { FE.toast(e.name === 'NotAllowedError' || e.name === 'SecurityError' ? 'Permission to read installed fonts was refused. Use "Pick font files" instead.' : 'Cannot list installed fonts: ' + e.message); }
  }
  const FONT_EXT = /\.(ttf|otf|ttc|woff)$/i;
  const addFiles = (files) => {
    for (const f of files) { if (!FONT_EXT.test(f.name)) continue; const base = f.name.replace(/\.[^.]+$/, ''); items.push({ family: base, style: '', origin: 'file', file: f.webkitRelativePath || f.name, blob: async () => f }); }
    items.sort((a, b) => a.family.localeCompare(b.family)); list();
  };
  async function walk(dir, out, depth = 0) {
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'file' && FONT_EXT.test(name)) out.push(await h.getFile());
      else if (h.kind === 'directory' && depth < 4) await walk(h, out, depth + 1);
    }
  }
  async function pickFolder() {
    if (window.showDirectoryPicker) { try { const d = await window.showDirectoryPicker(), out = []; await walk(d, out); addFiles(out); return; } catch (e) { if (e.name === 'AbortError') return; } }
    $('sysdirin').click();
  }
  FE.openSystemFonts = () => { $('sysdlg').hidden = false; list(); $('sysfilter').focus(); };

  document.addEventListener('DOMContentLoaded', () => {
    $('bsys').onclick = FE.openSystemFonts; $('sysclose').onclick = () => { $('sysdlg').hidden = true; };
    $('sysdlg').addEventListener('mousedown', (e) => { if (e.target === $('sysdlg')) $('sysdlg').hidden = true; });
    $('sysdlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); $('sysdlg').hidden = true; } });
    $('sysq').onclick = installed; $('sysfile').onclick = () => $('sysfiles').click(); $('sysdir').onclick = pickFolder;
    $('sysfiles').onchange = () => { addFiles([...$('sysfiles').files]); $('sysfiles').value = ''; };
    $('sysdirin').onchange = () => { addFiles([...$('sysdirin').files]); $('sysdirin').value = ''; };
    $('sysfilter').oninput = list;
    const pick = (el) => { const r = el.closest('[data-i]'); if (!r) return; sel = items[+r.dataset.i]; list(); preview(); };
    $('syslist').onclick = (e) => pick(e.target);
    $('syslist').onkeydown = (e) => {
      const rows = [...$('syslist').querySelectorAll('[data-i]')], i = rows.findIndex((r) => r === document.activeElement || r.classList.contains('on')), step = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 }[e.key];
      if (step) { e.preventDefault(); const n = rows[Math.max(0, Math.min(rows.length - 1, i + step))]; if (n) { pick(n); const again = $('syslist').querySelector('.on'); if (again) { again.focus(); again.scrollIntoView({ block: 'nearest' }); } } }
      else if (e.key === 'Enter') add();
    };
    for (const id of ['syssize', 'systh', 'sysw', 'sysh', 'systext']) $(id).addEventListener('input', preview);
    $('syssize').innerHTML = (FE.SIZES || []).map((s) => '<option value="' + s + '"' + (s === 12 ? ' selected' : '') + '>' + s + ' px' + (s === 8 ? ' (Atari 8x8)' : '') + '</option>').join('');
    $('sysadd').onclick = () => add(); $('sysassrc').onclick = () => add('src'); $('sysastgt').onclick = () => add('tgt'); $('syscmp').onclick = () => add('cmp');
  });
})();
