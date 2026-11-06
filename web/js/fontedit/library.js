// One list of FONT FAMILIES (shipped, Craft, ACWriter, personal, converted, imported, ROM) -> a strip of ALL sizes (4-26 px) ->
// glyphs. The master (TTF outline or pixel master) and its render settings are properties of the family (Source panel).
(() => {
  'use strict';
  const FE = window.FE, CF = FE.CF, FP = FE.FP, $ = FE.$, st = FE.state, esc = FE.esc;
  const ALL = [4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26];
  FE.SIZES = ALL;
  const ORIG = ['master', 'derived', 'hand-edited'];
  const label = (s) => (s === 8 ? '8 Atari' : String(s));
  const baseOf = (n) => String(n).replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const acwFaces = () => window.ACW_FACES || [];

  // ---- the entry list ---------------------------------------------------------------------------------------------------------
  const entries = new Map(); // id -> {id, name, badges, kind, url, fam, src}
  const add = (e) => { e.badges = e.badges || []; const o = entries.get(e.id); if (o) Object.assign(o, e, { fam: e.fam || o.fam }); else entries.set(e.id, e); return entries.get(e.id); };
  FE.entries = entries;
  let manifest = null, filter = 'all';

  function buildEntries() {
    add({ id: 'craft', name: 'Craft Sans', kind: 'craft', badges: ['Craft', 'ACWriter', 'pixel master 12'], group: 'craft', hint: 'The faces ACWriter and xCWriter draw with' });
    if (acwFaces().some((x) => x.id === 'zfont')) add({ id: 'zfont', name: 'ZFont (zoom font)', kind: 'craft', badges: ['ACWriter', 'single size'], group: 'craft' });
    if (manifest) {
      for (const g of manifest.groups) for (const f of g.fonts) {
        if (g.label === 'Craft faces' || /^craft\d+\.acf$/.test(f.name)) continue;
        const ext = (f.name.match(/\.([^.]+)$/) || [])[1] || '';
        const badges = [{ Shipped: 'Shipped', 'Atari ROM': 'ROM', Personal: 'Personal', Converted: 'Converted' }[g.label] || g.label];
        badges.push({ ttf: 'TTF', otf: 'OTF', fnt: 'Atari .fnt', acf: 'ACF', xcf: 'XCF' }[ext.toLowerCase()] || ext.toUpperCase());
        add({ id: 'url:' + f.url, name: g.label === 'Atari ROM' ? 'Atari ROM charset (8x8)' : f.name.replace(/\.[^.]+$/, ''), kind: 'url', url: f.url, badges, group: g.label.toLowerCase().split(' ')[0] });
      }
    }
    if (![...entries.values()].some((e) => e.badges.includes('ROM'))) add({ id: 'url:library/fonts/local/atarirom.fnt', name: 'Atari ROM charset (8x8)', kind: 'url', url: 'library/fonts/local/atarirom.fnt', badges: ['ROM', 'Atari .fnt'], group: 'atari' });
    const my = FE.myFonts();
    for (const n of Object.keys(my).sort()) add({ id: 'my:' + n, name: n, kind: 'my', badges: ['Mine'], group: 'mine' });
    const a = FE.autosaved();
    if (a) add({ id: 'autosave', name: 'Autosaved session: ' + a.name, kind: 'autosave', badges: ['Autosave', new Date(a.t).toLocaleString()], group: 'mine' });
  }

  const FILTERS = [['all', 'All'], ['craft', 'Craft'], ['shipped', 'Shipped'], ['atari', 'Atari / ROM'], ['personal', 'Personal'], ['mine', 'Mine / imported']];
  const matches = (e) => {
    const q = $('fsearch').value.trim().toLowerCase();
    if (q && !(e.name + ' ' + e.badges.join(' ')).toLowerCase().includes(q)) return false;
    if (filter === 'all') return true;
    if (filter === 'atari') return e.badges.some((b) => /ROM|Atari/.test(b));
    if (filter === 'personal') return e.badges.includes('Personal') || e.badges.includes('Converted');
    return e.group === filter;
  };
  const sizeCount = (e) => { const f = e.fam; return f ? Object.keys(f.sizes).length + ' of ' + ALL.length + ' sizes' : e.kind === 'craft' && e.id === 'craft' ? '6+ sizes' : ''; };
  function drawList() {
    const box = $('flist');
    box.innerHTML = '';
    const items = [...entries.values()].filter(matches);
    for (const e of items) {
      const d = document.createElement('div');
      d.className = 'fitem' + (st.entry === e.id ? ' on' : ''); d.dataset.fid = e.id; d.tabIndex = 0; d.setAttribute('role', 'option');
      d.innerHTML = '<div class="fn">' + esc(e.name) + '</div><div class="fb">' + e.badges.map((b) => '<span class="badge">' + esc(b) + '</span>').join('') + '<span class="fc">' + sizeCount(e) + '</span></div>';
      d.onclick = () => FE.openEntry(e.id).catch((x) => FE.toast('Cannot open: ' + x.message));
      d.onkeydown = (ev) => { if (ev.key === 'Enter') d.click(); };
      box.appendChild(d);
    }
    if (!items.length) box.innerHTML = '<div class="empty">No font matches. Drop a font file here or use Import.</div>';
    $('fcount').textContent = items.length + ' of ' + entries.size + ' families';
  }
  FE.libChanged = () => { buildEntries(); drawList(); };

  // ---- open a family -----------------------------------------------------------------------------------------------------------
  const craftFamily = () => {
    const fam = { format: 'craft-family', version: 1, name: 'Craft Sans', master: 12, sizes: {} };
    st.acw = new Map();
    for (const x of acwFaces()) {
      if (x.id === 'zfont') continue;
      const f = CF.parse(FE.b64ToBuf(x.acf)); f.origin = x.adv === 12 ? CF.ORIGIN.master : CF.ORIGIN.hand; f.masterAdv = x.adv === 12 ? 0 : 12;
      fam.sizes[x.adv] = f; st.acw.set(f, x.id);
    }
    return fam;
  };
  // sizes 14-26 are embedded (craft-big.js, made by the build) so this works from file:// without fetch
  async function loadBigCraft(fam) {
    for (const [s, b64] of Object.entries(window.CRAFT_BIG || {})) {
      if (fam.sizes[s]) continue;
      const f = CF.parse(FE.b64ToBuf(b64)); f.origin = CF.ORIGIN.hand; f.masterAdv = 12; fam.sizes[s] = f;
    }
  }  function show(e, size) {
    st.entry = e.id; st.src = FE.srcs.get(e.id) || null; st.acw = e.acw || new Map();
    const fam = e.fam, f = fam.sizes[size] || fam.sizes[fam.master] || Object.values(fam.sizes)[0];
    $('imp').hidden = !st.src;
    FE.setFont(f, fam); drawList();
  }
  FE.srcs = new Map();
  FE.openEntry = async (id, size) => {
    const e = entries.get(id); if (!e) throw new Error('unknown font ' + id);
    if (!e.fam) {
      if (e.kind === 'craft') {
        if (id === 'zfont') { const meta = acwFaces().find((x) => x.id === 'zfont'), f = CF.parse(FE.b64ToBuf(meta.acf)); e.acw = new Map([[f, 'zfont']]); e.fam = CF.familyNew(f, 'ZFont'); }
        else { e.fam = craftFamily(); e.acw = st.acw; await loadBigCraft(e.fam); }
      } else if (e.kind === 'my') await openBytes(new TextEncoder().encode(FE.myFonts()[e.name]), e.name + '.xcf', { entry: id, keep: false });
      else if (e.kind === 'autosave') { FE.restoreAutosave(); st.entry = id; e.fam = st.fam; return drawList(); }
      else { const r = await fetch(e.url); if (!r.ok) throw new Error('HTTP ' + r.status); await openBytes(new Uint8Array(await r.arrayBuffer()), e.url.split('/').pop(), { entry: id, keep: false }); return; }
    }
    show(e, size);
  };

  // ---- size strip: every size is selectable, a missing one is created from the master with one click ------------------------------------
  const originTag = (f) => (f.locked ? '\ud83d\udd12' : f.origin === 0 ? 'M' : f.origin === 1 ? 'd' : '\u270e');
  let sig = '';
  function drawSizes() {
    const fam = st.fam; if (!fam) return;
    const have = Object.keys(fam.sizes).map(Number), all = [...new Set([...ALL, ...have])].sort((a, b) => a - b);
    const s = all.map((k) => k + ':' + (fam.sizes[k] ? (fam.sizes[k].origin + '' + (fam.sizes[k].locked ? 'L' : '')) : '-')).join(',') + '|' + (st.f && st.f.adv) + '|' + fam.master;
    if (s === sig) return; sig = s;
    $('sizes').innerHTML = all.map((k) => {
      const f = fam.sizes[k], cls = 'sz' + (f ? ' have' : ' missing') + (st.f && st.f.adv === k ? ' on' : '') + (fam.master === k ? ' master' : '');
      const tip = f ? (CF.SIZES[k] ? CF.SIZES[k].label : k + ' px') + ' - ' + ORIG[f.origin] + (f.locked ? ', locked' : '') : k + ' px does not exist yet: click to create it from the ' + fam.master + ' px master';
      return '<button class="' + cls + '" data-size="' + k + '" title="' + esc(tip) + '"><b>' + label(k) + '</b><i>' + (f ? originTag(f) : '+') + '</i></button>';
    }).join('');
    $('sizes').querySelectorAll('.sz').forEach((b) => { b.onclick = () => FE.selectSize(+b.dataset.size); });
  }
  FE.selectSize = (s) => {
    const fam = st.fam; if (!fam) return null;
    let f = fam.sizes[s], made = false;
    if (!f) { f = FE.createSize(s); made = true; }
    if (!f) return null;
    FE.setFont(f, fam, true); if (made) FE.libChanged();
    return f;
  };
  FE.createSize = (s) => {
    const fam = st.fam;
    if (!fam.sizes[fam.master]) return null;
    if (s === fam.master) return fam.sizes[s];
    CF.familyDerive(fam, [s], FE.hintOpts());
    if (!fam.sizes[s]) fam.sizes[s] = CF.createSize(s, { name: fam.name });
    st.dirty = true; sig = '';
    FE.toast(s + ' px created from the ' + fam.master + ' px master (derived: re-derive any time, or edit and it becomes hand-edited)');
    return fam.sizes[s];
  };
  FE.fontListeners.push(() => { sig = ''; });
  FE.renders.push(() => {
    drawSizes();
    const f = st.f, fam = st.fam; if (!f) return;
    $('flock').checked = !!f.locked;
    $('famtitle').textContent = fam.name || f.name;
    $('famsub').textContent = (CF.SIZES[f.adv] ? CF.SIZES[f.adv].label : f.adv + ' px') + ' - ' + ORIG[f.origin] + (f.locked ? ', locked' : '') + (f.origin !== 0 && fam.sizes[fam.master] ? ' from ' + fam.master + ' px master' : '');
    $('bmaster').disabled = fam.master === f.adv;
    const srcT = st.src ? 'Outline font <b>' + esc(st.src.name) + '</b> (TTF/OTF/WOFF), rendered to pixel sizes' : (fam.sizes[fam.master] && fam.sizes[fam.master].adv === 8 && Object.keys(fam.sizes).length < 8 && !st.acw.size ? 'Atari 8x8 charset (master)' : 'Pixel master <b>' + fam.master + ' px</b> - sizes marked d are derived from it');
    $('srcinfo').innerHTML = srcT; $('ttfbox').hidden = !st.src;
    const lbl = $('hnote'); if (lbl) lbl.textContent = '';
    updateAcwBar();
  });

  // ---- family operations ---------------------------------------------------------------------------------------------------------------
  const deriveOpts = () => (FE.hintOpts());
  function deriveSizes(sizes, force) {
    const fam = st.fam, cur = st.f.adv;
    if (!fam.sizes[fam.master]) fam.sizes[fam.master] = st.f;
    const r = CF.familyDerive(fam, sizes.filter((s) => s !== fam.master), Object.assign(deriveOpts(), { force }));
    sig = ''; st.dirty = true;
    FE.setFont(fam.sizes[cur] || fam.sizes[fam.master], fam, true); FE.libChanged();
    FE.toast((r.done.length ? 'Derived ' + r.done.join(', ') + ' px' : 'Nothing to derive') + (r.skipped.length ? '; kept locked/hand-edited ' + r.skipped.join(', ') : ''));
    return r;
  }
  FE.deriveSizes = deriveSizes;
  document.addEventListener('DOMContentLoaded', () => {
    $('bderive').onclick = () => deriveSizes(ALL, false);
    $('bmissing').onclick = () => deriveSizes(ALL.filter((s) => !st.fam.sizes[s]), false);
    $('flock').onchange = () => { st.f.locked = $('flock').checked; sig = ''; FE.render(); };
    $('bmaster').onclick = () => {
      const f = st.f, fam = st.fam, old = fam.sizes[fam.master];
      if (old && old !== f && old.origin === CF.ORIGIN.master) old.origin = CF.ORIGIN.hand;
      fam.master = f.adv; f.origin = CF.ORIGIN.master; f.masterAdv = 0;
      for (const g of Object.values(fam.sizes)) if (g !== f) g.masterAdv = f.adv;
      sig = ''; FE.render(); FE.toast(f.adv + ' px is now the master of "' + fam.name + '"; Derive rebuilds the other sizes from it');
    };
    $('fsearch').oninput = drawList;
    $('fchips').innerHTML = FILTERS.map(([k, l]) => '<button data-f="' + k + '" class="' + (k === 'all' ? 'on' : '') + '">' + l + '</button>').join('');
    $('fchips').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; filter = b.dataset.f; $('fchips').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); drawList(); };
    $('bnew').onclick = () => {
      const f = CF.createSize(12, { name: 'New font' }), fam = CF.familyNew(f, 'New font');
      let n = 'New font', i = 1; while (entries.has('my:' + n)) n = 'New font ' + ++i; fam.name = n; f.name = n;
      add({ id: 'my:' + n, name: n, kind: 'my', badges: ['Mine', 'blank'], group: 'mine', fam }); FE.keepFamily(false, fam);
      show(entries.get('my:' + n), 12); FE.toast('Blank family "' + n + '": draw the 12 px master, then create the other sizes from the size strip');
    };
    $('bopen').onclick = () => $('file').click();
    $('file').onchange = async () => { for (const f of [...$('file').files]) await importFile(f); $('file').value = ''; };
    $('bautorestore').onclick = () => FE.openEntry('autosave');
  });

  // ---- import: TTF/OTF/WOFF, BDF, PNG sheet, ACF, XCF, FNT, charset (1024), ROM -> a family in the list ------------------------------------------------------
  async function importFile(f) { try { await openBytes(new Uint8Array(await f.arrayBuffer()), f.name); } catch (e) { FE.toast('Cannot open ' + f.name + ': ' + e.message); } }
  window.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); $('drop').hidden = false; } });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('drop').hidden = true; });
  window.addEventListener('drop', async (e) => { e.preventDefault(); $('drop').hidden = true; for (const f of [...e.dataTransfer.files]) await importFile(f); });

  const rangeSet = () => {
    const k = $('imprange').value;
    if (k === 'full') return null;
    if (k === 'custom') return new Set([...$('imprangetxt').value].map((c) => FE.codeOfChar(c)));
    return new Set(FE.COVERAGE[k][1]());
  };
  // keep only the chosen coverage (graphics slots and the space stay)
  function applyRange(fam) {
    const keep = rangeSet(); if (!keep) return 0;
    let n = 0;
    for (const f of Object.values(fam.sizes)) for (let c = 0; c < 256; c++) { const s = f.map[c]; if (!keep.has(c) && !CF.isGfxSlot(c) && c !== 32 && f.glyphs[s] && f.glyphs[s].some((v) => v)) { f.glyphs[s] = new Array(f.rows).fill(0); n++; } }
    return n;
  }
  const ttfOpts = (name) => ({ name: baseOf(name).slice(0, 40), sizes: ALL, threshold: +$('ttfth').value, weight: +$('ttfw').value, hint: $('ttfh').checked, baseline: +$('ttfbl').value || 0, noGrid: !$('ttfnative').checked, direct: $('ttfdirect').checked });

  function drawImpPreview(fam) {
    const cv = $('impprev'), c = cv.getContext('2d'), z = 2, text = 'Hamburgefonstiv, gypsy jug: 0123 ABC xyz', sizes = Object.keys(fam.sizes).map(Number).sort((a, b) => b - a);
    const adv = (f, code) => f.advs[f.map[code]] || f.adv;
    const W = Math.max(...sizes.map((s) => [...text].reduce((n, ch) => n + adv(fam.sizes[s], ch.charCodeAt(0)), 0))) + 8;
    cv.width = Math.min(W, 640) * z; cv.height = sizes.reduce((h, s) => h + fam.sizes[s].rows + 3, 4) * z;
    c.fillStyle = FE.themeColors().paper; c.fillRect(0, 0, cv.width, cv.height); c.fillStyle = '#16181c';
    let y = 2;
    for (const s of sizes) {
      const f = fam.sizes[s]; let x = 4;
      for (const ch of text) { const code = ch.charCodeAt(0), g = CF.glyph(f, code); for (let r = 0; r < f.rows; r++) for (let q = 0; q < f.gw; q++) if (CF.hasPx(f, g[r] || 0, q)) c.fillRect((x + q) * z, (y + r) * z, z, z); x += adv(f, code); }
      y += f.rows + 3;
    }
  }
  function showImport(r, name) {
    $('imp').hidden = false; $('impname').textContent = name;
    const i = r.info || {};
    $('impinfo').textContent = (i.pixel ? ' - pixel-grid font, sampled natively as 8x8 (grid ' + i.pixel + ' units)' : ' - outline scaled to the cell') + ', ' + Object.keys(r.fam.sizes).length + ' sizes, ' + (i.glyphs || '?') + ' glyphs' + (i.warnings && i.warnings.length ? '; ' + i.warnings.join('; ') : '');
    drawImpPreview(r.fam);
  }
  function convertTtf(bytes, name, o) {
    const r = FP.load(bytes, name, ttfOpts(name));
    const cut = applyRange(r.fam), id = (o && o.entry) || 'my:' + (r.fam.name || baseOf(name));
    const e = add({ id, name: r.fam.name || baseOf(name), kind: 'my', badges: ['Mine', 'TTF'], group: o && o.entry && o.entry.startsWith('url:') ? entries.get(o.entry).group : 'mine', fam: r.fam });
    e.fam = r.fam; FE.srcs.set(id, { bytes, name });
    if (o && o.entry && o.entry.startsWith('url:')) e.badges = entries.get(o.entry).badges;
    const keepSize = o && o.size;
    show(e, keepSize || (st.fam && e.fam === st.fam ? st.f.adv : (r.info && r.info.pixel && r.fam.sizes[8] ? 8 : r.fam.master || 12))); showImport(r, name);
    if (!o || o.keep !== false) FE.keepFamily(true, r.fam, id.replace(/^my:/, ''));
    FE.libChanged(); st.entry = id; drawList();
    FE.toast('Imported ' + name + ' as a family: ' + Object.keys(r.fam.sizes).length + ' sizes (4-26 px)' + (cut ? ', ' + cut + ' glyphs outside the chosen range cleared' : '') + '. Change a Source setting to render again.');
  }
  // re-render the TTF master of the current family when a Source setting changes
  function rerender() {
    if (!st.src) return;
    const size = st.f.adv, id = st.entry, hold = Object.values(st.fam.sizes).filter((f) => f.origin === 2 || f.locked).map((f) => f.adv);
    convertTtf(st.src.bytes, st.src.name, { entry: id, size, keep: false });
    if (hold.length) FE.toast('Re-rendered from the outline: hand-edited/locked sizes (' + hold.join(', ') + ') were replaced; use Undo history or the autosave if needed');
  }
  FE.rerender = rerender;
  document.addEventListener('DOMContentLoaded', () => {
    for (const id of ['ttfth', 'ttfw', 'ttfh', 'ttfbl', 'ttfnative', 'ttfdirect']) $(id).addEventListener('change', rerender);
    $('impkeep').onclick = () => { FE.keepFamily(); };
    $('imprange').onchange = () => { $('imprangetxt').hidden = $('imprange').value !== 'custom'; };
    $('imprange').innerHTML = '<option value="full">All glyphs in the file</option>' + Object.entries(FE.COVERAGE).filter(([k]) => ['ascii', 'latin1', 'letters'].includes(k)).map(([k, v]) => '<option value="' + k + '">' + v[0] + '</option>').join('') + '<option value="custom">Only these characters...</option>';
  });

  async function sheetFromPng(bytes, name) {
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const c = cv.getContext('2d'); c.drawImage(bmp, 0, 0);
    const im = c.getImageData(0, 0, bmp.width, bmp.height).data, data = new Uint8Array(bmp.width * bmp.height);
    for (let i = 0; i < data.length; i++) data[i] = im[i * 4 + 3] > 127 && (im[i * 4] + im[i * 4 + 1] + im[i * 4 + 2]) / 3 < 128 ? 1 : 0;
    return CF.fromSheet(data, bmp.width, bmp.height, { name });
  }
  const addFamily = (fam, name, badges, o) => {
    const id = (o && o.entry) || 'my:' + name, e = add({ id, name, kind: 'my', badges: (o && o.entry && entries.get(o.entry) ? entries.get(o.entry).badges : badges), group: o && o.entry && entries.get(o.entry) ? entries.get(o.entry).group : 'mine', fam });
    e.fam = fam; FE.srcs.delete(id);
    if (!o || o.keep !== false) FE.keepFamily(true, fam, name);
    FE.libChanged(); show(entries.get(id), o && o.size);
  };
  async function openBytes(bytes, name, o) {
    const buf = Buffer.from(bytes), kind = FP.detect(bytes, name), nm = baseOf(name).slice(0, 40);
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      const raw = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      return openBytes(new Uint8Array(raw), name.replace(/\.gz$/i, ''), o);
    }
    if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') { const f = await sheetFromPng(bytes, nm); f.name = nm; addFamily(CF.familyNew(f, nm), nm, ['Mine', 'PNG sheet'], o); return FE.toast('PNG sheet imported as ' + f.adv + ' px family'); }
    const acfm = (kind === 'bdf' && /ACFM/.test(buf.toString('latin1', 0, 4096))) || (kind === 'ttf' && buf.toString('latin1', 0, 600).includes('ACFM'));
    if ((kind === 'ttf' || kind === 'woff' || kind === 'woff2') && !acfm) return convertTtf(bytes, name, o);
    if (kind === 'rom-nocharset') throw new Error('this ROM image has no Atari character set at the standard location');
    const magic = buf.toString('latin1', 0, 4);
    if (magic === 'ACF2') { const f = CF.parse(buf); f.name = f.name || nm; const fam = CF.familyNew(f, f.name); return addFamily(fam, f.name, ['Mine', 'ACF'], o); }
    if (magic === 'ACF1') {
      const sizes = CF.acf1Sizes(buf); let idx = 0;
      if (sizes.length > 1) idx = Math.max(0, Math.min(sizes.length - 1, parseInt(prompt('This legacy .acf has ' + sizes.length + ' sizes:\n' + sizes.map((s, i) => i + ': ' + s.W + 'x' + s.H).join('\n') + '\nUse which?', '0'), 10) || 0));
      const f = CF.fromAcf1(buf, idx); f.name = nm; return addFamily(CF.familyNew(f, nm), nm, ['Mine', 'ACF'], o);
    }
    if (['xcf', 'rom', 'fnt', 'bdf', 'pcf', 'family', 'ttf'].includes(kind)) {
      const r = FP.load(bytes, name, { name: nm, size: +$('impsize').value || undefined });
      const cut = applyRange(r.fam), what = { rom: 'Atari ROM charset (8x8)', fnt: 'Atari charset (.fnt)' }[kind] || kind.toUpperCase();
      addFamily(r.fam, r.fam.name || nm, ['Mine', what.split(' ')[0]], o);
      return FE.toast(what + ' imported as a family: ' + Object.keys(r.fam.sizes).join(', ') + ' px' + (cut ? ', ' + cut + ' glyphs cleared by the range' : ''));
    }
    if (kind === 'json') { const f = CF.fromJson(buf.toString('utf8')); return addFamily(CF.familyNew(f, f.name || nm), f.name || nm, ['Mine', 'JSON'], o); }
    throw new Error('unrecognised font file (' + name + ')');
  }
  FE.openBytes = openBytes;

  // ---- My fonts: imported families persist in this browser (localStorage craft.myfonts) -----------------------------------------------------------------
  const MY = 'craft.myfonts';
  FE.myFonts = () => { try { return JSON.parse(localStorage.getItem(MY) || '{}'); } catch (e) { return {}; } };
  FE.keepFamily = (quiet, fam, nm) => {
    try {
      fam = fam || st.fam || CF.familyNew(st.f);
      const name = (nm || fam.name || st.f.name || 'font').slice(0, 40), m = FE.myFonts();
      m[name] = FP.toXcf(fam, {}); localStorage.setItem(MY, JSON.stringify(m));
      if (!quiet) { add({ id: 'my:' + name, name, kind: 'my', badges: ['Mine'], group: 'mine', fam }); FE.toast('"' + name + '" is kept in this browser (Mine / imported)'); }
      if (!quiet) FE.libChanged();
      return name;
    } catch (e) { if (!quiet) FE.toast('Could not keep the font in this browser: ' + e.message); return null; }
  };
  document.addEventListener('DOMContentLoaded', () => { $('bkeep').onclick = () => FE.keepFamily(); });

  // ---- ACWriter faces: write back to source -------------------------------------------------------------------------------------------------------------
  function updateAcwBar() {
    const bar = $('acwbar'), id = st.acw && st.acw.get(st.f), m = acwFaces().find((x) => x.id === id);
    if (!m) { bar.hidden = true; return; }
    if (!bar.hidden && bar.dataset.id === id) return;
    bar.hidden = false; bar.dataset.id = id;
    bar.innerHTML = '<b>ACWriter face ' + m.id + '</b><span>' + esc(m.used) + '</span><span class="dim">source: ' + esc(m.src) + '</span>' +
      '<button id="bacwsave" title="Write this face back to its source (needs node scripts/fontedit-server.cjs; otherwise downloads the file to put in font/overrides/)">Save to ACWriter source</button>' +
      '<button id="bacwreset" title="Remove the edit; the face is built from its source again (needs the local server)">Reset to built face</button>';
    $('bacwsave').onclick = FE.saveAcw; $('bacwreset').onclick = FE.resetAcw;
  }
  FE.saveAcw = async () => {
    const id = st.acw.get(st.f), m = acwFaces().find((x) => x.id === id), acf = FE.exportAcf();
    let r;
    try { r = await (await fetch('/__acwface/' + id, { method: 'POST', body: acf })).json(); } catch (e) { r = { ok: false, msg: e.message }; }
    if (r.ok) { m.acf = Buffer.from(acf).toString('base64'); m.override = true; FE.toast('Saved ' + id + ' to ' + r.where + '. Rebuild ACWriter (mkcraftfonts / mkzoomfont) to use it'); return { ok: true, where: r.where }; }
    FE.download(id + '.acf', acf); FE.toast('No write-back server (' + r.msg + '): downloaded ' + id + '.acf - put it in font/overrides/ (or run node scripts/fontedit-server.cjs)');
    return { ok: false, downloaded: true, msg: r.msg, size: acf.length };
  };
  FE.resetAcw = async () => {
    const id = st.acw.get(st.f);
    try { const r = await (await fetch('/__acwface/' + id, { method: 'DELETE' })).json(); if (!r.ok) throw new Error(r.msg); } catch (e) { FE.toast('Reset needs the local server: ' + e.message); return { ok: false }; }
    const mod = await (await fetch('js/fontedit/acw-faces.js', { cache: 'no-store' })).text();
    (0, eval)(mod);
    entries.get('craft').fam = null; entries.get('zfont') && (entries.get('zfont').fam = null);
    await FE.openAcw(id); FE.toast(id + ' is built from its source again'); return { ok: true };
  };
  FE.openAcw = async (id) => {
    const meta = acwFaces().find((x) => x.id === id); if (!meta) throw new Error('unknown ACWriter face ' + id);
    if (id === 'zfont') return FE.openEntry('zfont');
    const e = entries.get('craft'); if (!e.fam) await FE.openEntry('craft', meta.adv); else show(e, meta.adv);
    FE.selectSize(meta.adv); updateAcwBar();
  };

  // ---- start -------------------------------------------------------------------------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', async () => {
    buildEntries(); drawList();
    $('bautorestore').hidden = !FE.autosaved();
    await FE.openEntry('craft', 12);
    try { if (location.protocol === 'file:') throw 0; manifest = await (await fetch('library/fonts/local/manifest.json', { cache: 'no-store' })).json(); buildEntries(); drawList(); } catch (e) { /* file://: shipped list unavailable; sizes 14-26 are created from the master */ }
  });
})();
