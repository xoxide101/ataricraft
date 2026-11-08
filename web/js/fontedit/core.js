// Craft Font Editor core (web/fontedit.html): shared state, undo history, autosave, theme, tabs, shortcuts, toasts.
// Modules (loaded in this order): core, glyphs, editor, library, export, views, kern, quality, validate. Uses XCW.Font (tools/craftfont.cjs), no build step.
(() => {
  'use strict';
  const CF = XCW.Font, FP = XCW.FontPipe, $ = (id) => document.getElementById(id);
  const FE = (window.FE = { CF, FP, $, hooks: [], renders: [], tabHooks: {}, keys: [] });
  const st = (FE.state = { f: null, fam: null, slot: 65, tgt: 0, sel: new Set([65]), tool: 'pen', acw: new Map(), src: null, kern: {}, tab: 'edit', dirty: false });
  FE.COL = { head: '#4a78c8', cap: '#e8b030', xh: '#58c878', base: '#e05555', desc: '#9a6ad0' };

  FE.toast = (m) => { const d = document.createElement('div'); d.className = 'toast'; d.textContent = m; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); };
  FE.b64ToBuf = (s) => Buffer.from(s, 'base64');
  FE.esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  FE.themeColors = () => { const s = getComputedStyle(document.documentElement), g = (n) => s.getPropertyValue(n).trim(); return { bg: g('--cbg'), ink: g('--cink'), grid: g('--cgrid'), acc: g('--acc'), dim: g('--dim'), paper: g('--paper'), pink: g('--pink') }; };

  // ---- slots, codes, rows -------------------------------------------------------------------------------------------
  FE.codeOfSlot = (slot, f = st.f) => { for (let c = 0; c < 256; c++) if (f.map[c] === slot) return c; return slot; };
  FE.cur = () => FE.codeOfSlot(st.slot);
  FE.NC = (slot, f = st.f) => CF.colsOf(f, slot === undefined ? st.slot : slot);
  // live rows of a slot for the edit target (0 normal, 1 super, 2 sub); a variant is created on first edit
  FE.rows = (slot = st.slot, tgt = st.tgt, create = true, f = st.f) => {
    if (tgt === 0) return f.glyphs[slot] || (create ? (f.glyphs[slot] = new Array(f.rows).fill(0)) : new Array(f.rows).fill(0));
    const c = FE.codeOfSlot(slot, f), tab = tgt === 1 ? f.sup : f.sub;
    if (!tab[c] && create) tab[c] = CF.render(f, c, tgt);
    return tab[c] || CF.render(f, c, tgt);
  };
  const rowsOf = (slot, tgt) => {
    const f = st.f;
    if (tgt === 0) return f.glyphs[slot] ? f.glyphs[slot].slice() : null;
    const t = (tgt === 1 ? f.sup : f.sub)[FE.codeOfSlot(slot)]; return t ? t.slice() : null;
  };
  const setRows = (slot, tgt, rows) => {
    const f = st.f;
    if (tgt === 0) { if (rows) f.glyphs[slot] = rows.slice(); else delete f.glyphs[slot]; return; }
    const tab = tgt === 1 ? f.sup : f.sub, c = FE.codeOfSlot(slot);
    if (rows) tab[c] = rows.slice(); else delete tab[c];
  };
  const metaOf = (f) => ({ head: f.head, xTop: f.xTop, base: f.base, desc: f.desc, supUp: f.supUp, subDown: f.subDown, advs: Object.assign({}, f.advs) });
  const kernClone = () => JSON.parse(JSON.stringify(st.kern));
  // restore the kerning tables in place: fam.kern may be the same object as st.kern
  const kernSet = (k) => { for (const x of Object.keys(st.kern)) delete st.kern[x]; Object.assign(st.kern, JSON.parse(JSON.stringify(k))); };

  // ---- undo history (per font) ----------------------------------------------------------------------------------------
  const H = new WeakMap();
  const hist = (f = st.f) => H.get(f) || (H.set(f, { undo: [], redo: [] }), H.get(f));
  FE.hist = hist;
  // Call before changing glyph rows (slots) and/or metrics (meta = true); `label` appears in the History list.
  // `kern` = true also snapshots the kerning tables (copy/merge between fonts changes them)
  FE.push = (label, slots, meta, kern) => {
    const h = hist(), tgt = st.tgt;
    h.undo.push({ label, items: (slots || []).map((s) => ({ slot: s, tgt, rows: rowsOf(s, tgt) })), meta: meta ? metaOf(st.f) : null, kern: kern ? kernClone() : null });
    h.redo = []; if (h.undo.length > 200) h.undo.shift();
  };
  const apply = (e) => {
    const inv = { label: e.label, items: [], meta: null, kern: null };
    if (e.kern) { inv.kern = kernClone(); kernSet(e.kern); }
    if (e.meta) { inv.meta = metaOf(st.f); Object.assign(st.f, e.meta); }
    for (const it of e.items) { inv.items.push({ slot: it.slot, tgt: it.tgt, rows: rowsOf(it.slot, it.tgt) }); setRows(it.slot, it.tgt, it.rows); }
    if (e.items[0]) { st.slot = e.items[0].slot; st.tgt = e.items[0].tgt; document.querySelectorAll('.tgt').forEach((b) => b.classList.toggle('on', +b.dataset.t === st.tgt)); }
    return inv;
  };
  FE.undo = (n = 1) => { const h = hist(); let done = 0; while (n-- > 0 && h.undo.length) { h.redo.push(apply(h.undo.pop())); done++; } if (done) FE.changed(); return done; };
  FE.redo = () => { const h = hist(); if (!h.redo.length) return 0; h.undo.push(apply(h.redo.pop())); FE.changed(); return 1; };

  // edit helper: snapshot, run fn(rows, slot) on every slot, mark edited, redraw
  FE.editSlots = (label, slots, fn) => {
    FE.push(label, slots);
    for (const s of slots) { const g = FE.rows(s, st.tgt, true), n = fn(g.slice(), s); if (n) for (let i = 0; i < g.length; i++) g[i] = n[i]; }
    CF.markEdited(st.f); FE.changed();
  };
  FE.selSlots = () => { const a = [...st.sel]; return a.length ? a : [st.slot]; };

  // ---- render + autosave -------------------------------------------------------------------------------------------------
  FE.render = () => { for (const r of FE.renders) { try { r(); } catch (e) { console.error(e); } } };
  FE.changed = () => { st.dirty = true; FE.render(); schedAutosave(); };
  // Settings of the derive step (threshold, hinting-lite); every derive in the editor goes through this.
  FE.hintOpts = () => ({ threshold: +$('dth').value, keepStems: $('dkeep').checked, snapX: $('dsnapx') ? $('dsnapx').checked : false, snapBase: $('dsnapb') ? $('dsnapb').checked : true, weight: $('dwt') ? +$('dwt').value : 0 });
  const AUTO = 'craft.fontedit.autosave';
  let autoTimer = 0;
  function schedAutosave() { clearTimeout(autoTimer); autoTimer = setTimeout(FE.autosave, 700); }
  FE.autosave = () => {
    if (!st.dirty || !st.f) return false;
    try {
      const fam = st.fam || CF.familyNew(st.f);
      localStorage.setItem(AUTO, JSON.stringify({ t: Date.now(), name: fam.name, size: st.f.adv, kern: st.kern, fam: JSON.parse(CF.familyToJson(fam)) }));
      st.dirty = false; const el = $('autosaved'); if (el) el.textContent = 'autosaved ' + new Date().toLocaleTimeString();
      return true;
    } catch (e) { return false; }
  };
  FE.autosaved = () => { try { return JSON.parse(localStorage.getItem(AUTO) || 'null'); } catch (e) { return null; } };
  FE.restoreAutosave = () => {
    const a = FE.autosaved(); if (!a) return false;
    const fam = CF.familyFromJson(a.fam); st.kern = a.kern || {};
    FE.setFont(fam.sizes[a.size] || fam.sizes[fam.master], fam); return true;
  };
  window.addEventListener('pagehide', () => FE.autosave());

  // ---- theme ------------------------------------------------------------------------------------------------------------------
  const setTheme = (t) => { document.documentElement.dataset.theme = t; try { localStorage.setItem('craft.fontedit.theme', t); } catch (e) { /* private mode */ } if ($('btheme')) $('btheme').textContent = t === 'dark' ? 'Light theme' : 'Dark theme'; if (st.f) FE.render(); };
  FE.setTheme = setTheme;
  let th = 'dark'; try { th = localStorage.getItem('craft.fontedit.theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); } catch (e) { /* default */ }
  document.documentElement.dataset.theme = th;

  // ---- tabs and collapsible side panels -------------------------------------------------------------------------------------
  FE.isTab = (n) => st.tab === n;
  FE.showTab = (n) => {
    st.tab = n;
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== 'v-' + n; });
    document.querySelectorAll('.tabbtn').forEach((b) => b.classList.toggle('on', b.dataset.tab === n));
    if (FE.tabHooks[n]) FE.tabHooks[n]();
    FE.render();
  };
  FE.onTab = (n, fn) => { FE.tabHooks[n] = fn; };

  // ---- keyboard shortcuts (the table is also the help dialog) ---------------------------------------------------------------
  // keys: [combo, description, handler]; combo "Ctrl+Z", "Shift+H", "B", "ArrowLeft" ...
  FE.key = (combo, desc, fn, group) => FE.keys.push({ combo, desc, fn, group: group || 'General' });
  const comboOf = (e) => (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey && e.key.length > 1 ? 'Shift+' : '') + (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  window.addEventListener('keydown', (e) => {
    const t = document.activeElement && document.activeElement.tagName;
    if (t === 'TEXTAREA' || t === 'INPUT' || t === 'SELECT') { if (!(e.key === 'Escape')) return; }
    const c = comboOf(e), c2 = (e.shiftKey && e.key.length === 1 ? 'Shift+' : '') + c;
    const k = FE.keys.find((x) => x.combo === c2 || x.combo === c);
    if (k) { e.preventDefault(); k.fn(e); }
  });
  function drawHelp() {
    const groups = {};
    for (const k of FE.keys) (groups[k.group] = groups[k.group] || []).push(k);
    $('helpkeys').innerHTML = Object.entries(groups).map(([g, a]) => '<h4>' + g + '</h4><table>' + a.map((k) => '<tr><td><kbd>' + FE.esc(k.combo.replace('Arrow', '')) + '</kbd></td><td>' + FE.esc(k.desc) + '</td></tr>').join('') + '</table>').join('');
  }
  FE.showHelp = () => { drawHelp(); $('help').hidden = false; };

  // keepSlot: stay on the same slot (switching size inside a family); otherwise select 'A'
  FE.setFont = (f, fam, keepSlot) => {
    st.f = f;
    st.fam = fam || (st.fam && Object.values(st.fam.sizes).includes(f) ? st.fam : null);
    if (!st.fam) st.fam = CF.familyNew(f);
    if (!keepSlot) st.slot = f.map[65] === undefined ? 65 : f.map[65];
    st.sel = new Set([st.slot]);
    $('name').value = st.fam.name || f.name; $('supup').value = f.supUp; $('subdn').value = f.subDown;
    $('upslot').value = f.map[65]; $('lowslot').value = f.map[97];
    FE.emitFont();
  };
  FE.fontListeners = [];
  FE.emitFont = () => { for (const l of FE.fontListeners) l(); FE.render(); };

  // ---- init: panels, tabs, theme button, help ------------------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tabbtn').forEach((b) => { b.onclick = () => FE.showTab(b.dataset.tab); });
    $('btheme').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    setTheme(document.documentElement.dataset.theme);
    $('bhelp').onclick = FE.showHelp; $('helpclose').onclick = () => { $('help').hidden = true; };
    $('help').addEventListener('mousedown', (e) => { if (e.target === $('help')) $('help').hidden = true; });
    for (const [btn, side] of [['tgl', 'lpanel'], ['tgr', 'rpanel']]) $(btn).onclick = () => { const a = $(side); a.classList.toggle('collapsed'); $(btn).classList.toggle('on', !a.classList.contains('collapsed')); FE.render(); };
    FE.key('Escape', 'Close dialogs, drop the selection', () => { $('help').hidden = true; if (FE.clearRegion) FE.clearRegion(); });
    FE.key('Shift+?', 'Show this list of shortcuts', FE.showHelp);
    FE.key('?', 'Show this list of shortcuts', FE.showHelp);
    FE.key('Ctrl+Z', 'Undo', () => FE.undo(), 'History'); FE.key('Ctrl+Y', 'Redo', () => FE.redo(), 'History'); FE.key('Ctrl+Shift+Z', 'Redo', () => FE.redo(), 'History');
    $('undo').onclick = () => FE.undo(); $('redo').onclick = () => FE.redo();
    $('name').onchange = () => { const n = $('name').value.slice(0, 40); st.f.name = n; if (st.fam) st.fam.name = n; };
  });
})();
