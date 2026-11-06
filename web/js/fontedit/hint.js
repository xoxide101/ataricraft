// Pixel layer of a derived size: per-glyph overrides that survive "Re-render all sizes", the override diff highlight, per-glyph
// re-render from the master with the hinting-lite settings (see FE.hintOpts in core.js and CF.deriveGlyph options).
// An override is a glyph you changed by hand in a size that is not the master. Overrides are kept in f.ovr ({slot: 1}) and in
// localStorage 'craft.ovr' ("family|size" -> slots); the ACF/XCF formats have no field for them.
(() => {
  'use strict';
  const FE = window.FE, $ = FE.$, st = FE.state, CF = window.XCW.Font, KEY = 'craft.ovr';
  const store = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  const keyOf = (f) => (st.fam ? st.fam.name : '') + '|' + f.adv;
  const master = () => (st.fam && st.fam.sizes[st.fam.master]) || null;
  const isMaster = (f) => !st.fam || st.fam.sizes[st.fam.master] === f;
  FE.ovrOf = (f = st.f) => { if (!f.ovr) { f.ovr = {}; for (const s of store()[keyOf(f)] || []) f.ovr[s] = 1; } return f.ovr; };
  FE.isOvr = (slot, f = st.f) => !!(f && !isMaster(f) && FE.ovrOf(f)[slot]);
  function save() {
    if (!st.fam) return;
    const all = store();
    for (const f of Object.values(st.fam.sizes)) { if (!f.ovr) continue; const k = keyOf(f), a = Object.keys(f.ovr).map(Number); if (a.length) all[k] = a; else delete all[k]; }
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* storage full or blocked: overrides then last for this session */ }
  }
  FE.setOvr = (slots, on, f = st.f) => { const o = FE.ovrOf(f); for (const s of slots) { if (on) o[s] = 1; else delete o[s]; } save(); FE.render(); };

  // every pushed edit of a glyph in a non-master size marks that glyph as an override
  const push0 = FE.push;
  FE.pushRaw = push0;
  FE.push = (label, slots, meta) => {
    push0(label, slots, meta);
    if (slots && slots.length && st.tgt === 0 && st.f && !isMaster(st.f)) { const o = FE.ovrOf(); for (const s of slots) if (!CF.isGfxSlot(s)) o[s] = 1; save(); }
  };

  // Re-render the selected glyphs of this size from the master (one undo step); this clears their override flag.
  FE.rerenderGlyphs = (slots) => {
    const m = master(), f = st.f; if (!m || m === f) return FE.toast('This size is the master: there is nothing to re-render from');
    const todo = slots.filter((s) => !CF.isGfxSlot(s)), o = { ...FE.hintOpts() };
    push0('Re-render from master', todo);
    for (const s of todo) FE.rows(s, 0, true).splice(0, f.rows, ...CF.deriveGlyph(m, f, m.glyphs[s] || new Array(m.rows).fill(0), o));
    FE.setOvr(todo, false); FE.changed();
    FE.toast('Re-rendered ' + todo.length + ' glyph(s) from the ' + m.adv + ' px master');
    return todo.length;
  };

  // Re-render every glyph of every derived size; glyphs flagged as overrides (and locked sizes) are kept unless `all` is true.
  FE.rerenderAll = (all) => {
    const fam = st.fam, m = master(); if (!fam || !m) return { sizes: 0, glyphs: 0, kept: 0, locked: 0 };
    const res = { sizes: 0, glyphs: 0, kept: 0, locked: [] }, o = { ...FE.hintOpts() };
    for (const k of Object.keys(fam.sizes).map(Number)) {
      const f = fam.sizes[k]; if (f === m) continue;
      if (f.locked && !all) { res.locked.push(k); continue; }
      const fresh = CF.derive(m, k, o), ov = FE.ovrOf(f), slots = [];
      for (let s = 0; s < 256; s++) { if (CF.isGfxSlot(s) || !fresh.glyphs[s]) continue; if (ov[s] && !all) { res.kept++; continue; } slots.push(s); }
      if (f === st.f && slots.length) push0('Re-render all sizes', slots);
      for (const s of slots) f.glyphs[s] = fresh.glyphs[s].slice();
      for (const [tab, out] of [[fresh.sup, f.sup], [fresh.sub, f.sub]]) for (const c of Object.keys(tab)) out[c] = tab[c].slice();
      if (all) f.ovr = {};
      f.origin = Object.keys(FE.ovrOf(f)).length ? 2 : 1; res.sizes++; res.glyphs += slots.length;
    }
    save(); FE.a8cache = null; FE.changed(); if (FE.emitFont) FE.emitFont();
    return res;
  };

  // diff highlight: green = a pixel you added, red ring = a pixel a fresh re-render would have, in this glyph
  FE.drawDiff = (ex, E, nc) => {
    const m = master(), f = st.f;
    if (!$('bdiff').checked || !m || m === f || st.tgt || CF.isGfxSlot(st.slot)) return;
    const fresh = CF.deriveGlyph(m, f, m.glyphs[st.slot] || new Array(m.rows).fill(0), FE.hintOpts()), g = FE.rows(st.slot, 0, false);
    for (let r = 0; r < f.rows; r++) for (let q = 0; q < nc; q++) {
      const a = CF.hasPx(f, g[r], q), b = CF.hasPx(f, fresh[r], q);
      if (a && !b) { ex.fillStyle = '#2fbf5fcc'; ex.fillRect(q * E, r * E, E, E); } else if (!a && b) { ex.strokeStyle = '#e5484d'; ex.lineWidth = 2; ex.strokeRect(q * E + 3, r * E + 3, E - 6, E - 6); }
    }
  };

  FE.renders.push(() => {
    const el = $('ovrinfo'); if (!el || !st.f) return;
    const n = isMaster(st.f) ? 0 : Object.keys(FE.ovrOf()).length;
    el.textContent = isMaster(st.f) ? '(master size)' : n + ' override' + (n === 1 ? '' : 's') + ' in ' + st.f.adv + ' px';
  });

  document.addEventListener('DOMContentLoaded', () => {
    $('bfrommaster').onclick = () => FE.rerenderGlyphs(FE.selSlots());
    $('bovrmark').onclick = () => { FE.setOvr(FE.selSlots(), true); FE.toast('Marked as override: kept when you re-render all sizes'); };
    $('bovrclear').onclick = () => FE.setOvr(FE.selSlots(), false);
    $('bdiff').onchange = () => FE.render();
    $('brerall').onclick = () => {
      const r = FE.rerenderAll($('brinc').checked);
      FE.toast('Re-rendered ' + r.glyphs + ' glyphs in ' + r.sizes + ' size(s); kept ' + r.kept + ' override(s)' + (r.locked.length ? '; locked: ' + r.locked.join(', ') + ' px' : ''));
    };
    for (const id of ['dth', 'dkeep', 'dsnapx', 'dsnapb', 'dwt']) $(id).addEventListener('change', () => { FE.a8cache = null; });
  });
})();
