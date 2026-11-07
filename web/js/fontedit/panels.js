// Panel system: every fixed section of the editor is a PANEL with the same small title bar: zoom (- / + / Fit / 100%), pop out (floating window), maximise, bring back.
// Panels are the real DOM sections (nothing is cloned), so all ids and handlers keep working. Layout and zoom are remembered in localStorage "craft.layout".
//
// Add a panel in one line (see docs/FONT.md "Panels"):
//   FE.panels.add({ id: 'myview', title: 'My view', el: '#v-my', zoom: FE.panels.selectZoom('#myzoom') });
//   zoom: omitted = CSS zoom of the content; FE.panels.selectZoom(sel) = step a <select>/<input> of numbers; or { get, set, nudge(dir), fit, label } for a native zoom.
(() => {
  'use strict';
  const FE = window.FE, $ = FE.$;
  const KEY = 'craft.layout', STEP = 1.25, MINZ = 0.5, MAXZ = 4;
  const P = new Map();
  let saved = { layout: 'editor', panels: {} };
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.panels) saved = s; } catch (e) { /* ignore a damaged value */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* quota */ } };
  const rec = (id) => saved.panels[id] || (saved.panels[id] = {});
  let z = 60, hover = null, backdrop = null;

  // ---- zoom helpers -----------------------------------------------------------------------------------------------------------
  const selectZoom = (sel, def) => {
    const el = () => (typeof sel === 'string' ? document.querySelector(sel) : sel);
    const vals = () => [...(el().options || [])].map((o) => +o.value);
    const set = (v) => { const e = el(); if (!e) return; e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    return {
      get: () => +el().value, set, label: () => '\u00d7' + el().value, min: 1, max: 4,
      nudge: (d) => { const v = vals(), i = v.indexOf(+el().value), n = Math.max(0, Math.min(v.length - 1, (i < 0 ? 0 : i) + d)); set(v[n]); },
      reset: () => set(def || vals()[0]), isDefault: () => +el().value === (def || vals()[0]),
    };
  };
  const cssZoom = (p) => ({
    get: () => p.cz || 1, label: () => Math.round((p.cz || 1) * 100) + '%',
    set: (f) => { p.cz = Math.max(MINZ, Math.min(MAXZ, f)); applyCss(p); },
    nudge: (d) => { const f = (p.cz || 1) * (d > 0 ? STEP : 1 / STEP); p.cz = Math.round(Math.max(MINZ, Math.min(MAXZ, f)) * 100) / 100; applyCss(p); },
    reset: () => { p.cz = 1; applyCss(p); }, isDefault: () => (p.cz || 1) === 1,
  });
  function applyCss(p) {
    if (!p.body) {
      if ((p.cz || 1) === 1) return;
      p.body = document.createElement('div'); p.body.className = 'pbody';
      const keep = new Set([p.bar, p.sum]);
      for (const c of [...p.el.childNodes]) if (!keep.has(c)) p.body.appendChild(c);
      p.el.appendChild(p.body);
    }
    p.body.style.zoom = p.cz === 1 ? '' : String(p.cz);
    FE.render && FE.render();
  }

  // ---- panel chrome -----------------------------------------------------------------------------------------------------------
  const BUTTONS = [['out', '\u2212', 'Zoom out (-)'], ['in', '+', 'Zoom in (+)'], ['fit', 'Fit', 'Fit to the window'], ['reset', '100%', 'Back to the normal zoom (0)'], ['float', '\u29c9', 'Pop out as a floating window you can move and resize'], ['max', '\u2922', 'Maximise (Esc or double-click the bar to go back)'], ['dock', 'Back', 'Put the panel back in its place']];
  function add(o) {
    const el = typeof o.el === 'string' ? document.querySelector(o.el) : o.el; if (!el) return null;
    const p = { id: o.id, title: o.title, el, mode: 'dock', spec: o.zoom, cz: 1, sum: el.tagName === 'DETAILS' ? el.querySelector(':scope > summary') : null };
    p.spec = o.zoom || cssZoom(p);
    const bar = document.createElement('div'); bar.className = 'pbar'; bar.dataset.panel = o.id;
    bar.innerHTML = (p.sum ? '' : '<b class="ptitle">' + FE.esc(o.title) + '</b>') + '<span class="psp"></span>' + BUTTONS.map(([a, t, tip]) => '<button data-a="' + a + '" title="' + tip + '"' + (a === 'dock' ? ' hidden' : '') + (a === 'fit' && !p.spec.fit ? ' hidden' : '') + '>' + t + '</button>').join('') + '<span class="pz"></span>';
    p.bar = bar;
    if (p.sum) p.sum.after(bar); else el.prepend(bar);
    el.classList.add('panel'); el.dataset.panel = o.id;
    bar.addEventListener('click', (ev) => { const b = ev.target.closest('button[data-a]'); if (b) act(p, b.dataset.a); });
    bar.addEventListener('dblclick', (ev) => { if (!ev.target.closest('button')) setMode(p, p.mode === 'max' ? (p.prev || 'dock') : 'max'); });
    bar.addEventListener('mousedown', (ev) => startDrag(p, ev));
    el.addEventListener('mouseenter', () => { hover = p; }); el.addEventListener('mouseleave', () => { if (hover === p) hover = null; });
    el.addEventListener('wheel', (ev) => { if (!ev.ctrlKey || !p.spec) return; ev.preventDefault(); zoom(p, ev.deltaY < 0 ? 1 : -1); }, { passive: false });
    el.addEventListener('mousedown', () => { if (p.mode === 'float') el.style.zIndex = ++z; }, true);
    P.set(o.id, p);
    const r = saved.panels[o.id];
    if (r && r.zoom && p.spec.set && !p.spec.label) p.spec.set(r.zoom);
    else if (r && r.zoom && p.spec.set) { if (o.zoom) p.spec.set(r.zoom); else { p.cz = r.zoom; applyCss(p); } }
    if (r && r.mode === 'float') setMode(p, 'float', true);
    label(p);
    return p;
  }

  function label(p) {
    const s = p.spec, z0 = p.bar.querySelector('.pz');
    z0.textContent = s.label ? s.label() : s.get ? Math.round(s.get() * 100) + '%' : '';
    const canZoom = !!(s.nudge || s.set);
    p.bar.querySelectorAll('[data-a=out],[data-a=in],[data-a=reset]').forEach((b) => { b.hidden = !canZoom; });
    const f = p.bar.querySelector('[data-a=fit]'); f.hidden = !s.fit;
    p.bar.querySelector('[data-a=float]').hidden = p.mode !== 'dock';
    p.bar.querySelector('[data-a=max]').hidden = p.mode === 'max';
    p.bar.querySelector('[data-a=dock]').hidden = p.mode === 'dock';
  }
  function zoom(p, d) {
    const s = p.spec; if (s.nudge) s.nudge(d); else if (s.set && s.get) s.set(s.get() * (d > 0 ? STEP : 1 / STEP));
    remember(p); label(p);
  }
  function remember(p) { const s = p.spec; if (s.get && s.set) { const r = rec(p.id); r.zoom = s.get(); if (s.isDefault && s.isDefault()) delete r.zoom; save(); } }
  function act(p, a) {
    if (a === 'in') zoom(p, 1); else if (a === 'out') zoom(p, -1);
    else if (a === 'fit') { p.spec.fit(); label(p); }
    else if (a === 'reset') { if (p.spec.reset) p.spec.reset(); else if (p.spec.set) p.spec.set(1); const r = rec(p.id); delete r.zoom; save(); label(p); }
    else if (a === 'float') setMode(p, 'float');
    else if (a === 'max') setMode(p, 'max');
    else if (a === 'dock') setMode(p, 'dock');
  }

  // ---- modes: dock (in place), float (window), max (nearly the whole window) -------------------------------------------------------------------
  function setMode(p, mode, restoring) {
    if (mode === p.mode) return;
    const el = p.el;
    if (mode !== 'max' && p.mode !== 'max') p.prev = 'dock';
    if (mode === 'max') p.prev = p.mode;
    if (p.mode === 'max') { document.body.classList.remove('pmaxed'); if (backdrop) backdrop.hidden = true; }
    el.classList.remove('pfloat', 'pmax'); if (mode === 'dock') { el.style.cssText = ''; }
    if (mode === 'float') {
      const r = rec(p.id), b = el.getBoundingClientRect();
      const w = r.w || Math.min(560, Math.max(300, b.width)), h = r.h || Math.min(460, Math.max(220, b.height));
      el.classList.add('pfloat'); Object.assign(el.style, { left: Math.max(0, Math.min(innerWidth - 120, r.x !== undefined ? r.x : b.left)) + 'px', top: Math.max(0, Math.min(innerHeight - 60, r.y !== undefined ? r.y : b.top)) + 'px', width: w + 'px', height: h + 'px', zIndex: ++z });
    } else if (mode === 'max') {
      el.style.cssText = ''; el.classList.add('pmax'); el.style.zIndex = 60; document.body.classList.add('pmaxed'); if (!backdrop) { backdrop = document.createElement('div'); backdrop.id = 'pback'; backdrop.onclick = () => { for (const q of P.values()) if (q.mode === 'max') setMode(q, q.prev || 'dock'); }; document.body.appendChild(backdrop); } backdrop.hidden = false;
    }
    if (el.tagName === 'DETAILS' && mode !== 'dock') el.open = true;
    p.mode = mode;
    placeholder(p);
    const r = rec(p.id); if (mode === 'max') { /* maximise is never remembered */ } else if (mode === 'float') r.mode = 'float'; else delete r.mode;
    if (!restoring) save();
    label(p);
    if (FE.render) FE.render(); window.dispatchEvent(new Event('resize'));
  }
  function placeholder(p) {
    if (p.ph) { p.ph.remove(); p.ph = null; }
    if (p.mode === 'dock') return;
    const d = document.createElement('div'); d.className = 'pph';
    d.innerHTML = '<span>' + FE.esc(p.title) + ' is in its own window.</span> <button>Bring it back</button>';
    d.querySelector('button').onclick = () => setMode(p, 'dock');
    p.el.before(d); p.ph = d;
  }
  let drag = null;
  function startDrag(p, ev) {
    if (p.mode !== 'float' || ev.target.closest('button') || ev.button !== 0) return;
    const r = p.el.getBoundingClientRect(); drag = { p, dx: ev.clientX - r.left, dy: ev.clientY - r.top }; p.el.style.zIndex = ++z; ev.preventDefault();
  }
  window.addEventListener('mousemove', (ev) => {
    if (!drag) return; const el = drag.p.el;
    el.style.left = Math.max(0, Math.min(innerWidth - 80, ev.clientX - drag.dx)) + 'px'; el.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - drag.dy)) + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!drag) return; const p = drag.p, r = rec(p.id), b = p.el.getBoundingClientRect(); drag = null; r.x = Math.round(b.left); r.y = Math.round(b.top); r.w = Math.round(b.width); r.h = Math.round(b.height); save();
  });
  // remember the size after the user resizes a floating window
  const ro = new ResizeObserver((es) => { for (const e of es) { const p = P.get(e.target.dataset.panel); if (p && p.mode === 'float' && !drag) { const r = rec(p.id), b = p.el.getBoundingClientRect(); if (Math.abs((r.w || 0) - b.width) > 2 || Math.abs((r.h || 0) - b.height) > 2) { r.w = Math.round(b.width); r.h = Math.round(b.height); save(); } } } });

  // ---- keys: +, - and 0 zoom the panel under the pointer; Esc leaves maximise ------------------------------------------------------------------
  document.addEventListener('keydown', (ev) => {
    const t = ev.target, typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
    if (ev.key === 'Escape') { const m = [...P.values()].find((q) => q.mode === 'max'); if (m && $('chooser').hidden) { ev.stopImmediatePropagation(); setMode(m, m.prev || 'dock'); } return; }
    if (typing || !hover || ev.altKey || (ev.ctrlKey && !/[-+=0]/.test(ev.key))) return;
    const k = ev.key; let d = 0;
    if (k === '+' || k === '=') d = 1; else if (k === '-' || k === '_') d = -1; else if (k !== '0') return;
    if (ev.ctrlKey) ev.preventDefault();
    ev.stopImmediatePropagation(); ev.preventDefault();
    if (k === '0') act(hover, 'reset'); else zoom(hover, d);
  }, true);

  // ---- layouts ----------------------------------------------------------------------------------------------------------------------------------
  const LAYOUTS = {
    editor: { label: 'Editor', tab: 'edit', left: true, right: true, hint: 'Fonts on the left, glyphs and pixels in the middle, details on the right' },
    compare: { label: 'Compare', tab: 'family', left: false, right: true, hint: 'All sizes of the family side by side, with the preview' },
    overview: { label: 'Overview', tab: 'specimen', left: false, right: false, hint: 'Specimen and waterfall using the whole window' },
  };
  const side = (id, btn, open) => { const a = $(id); a.classList.toggle('collapsed', !open); $(btn).classList.toggle('on', open); };
  function layout(name, keepTab) {
    const L = LAYOUTS[name]; if (!L) return;
    for (const p of P.values()) if (p.mode !== 'dock') setMode(p, 'dock', true);
    side('lpanel', 'tgl', L.left); side('rpanel', 'tgr', L.right);
    if (!keepTab) FE.showTab(L.tab);
    saved.layout = name; for (const id of Object.keys(saved.panels)) delete saved.panels[id].mode; save();
    document.querySelectorAll('#laybar [data-lay]').forEach((b) => b.classList.toggle('on', b.dataset.lay === name));
    FE.render();
  }
  function reset() {
    for (const p of P.values()) { if (p.mode !== 'dock') setMode(p, 'dock', true); if (p.spec.reset) p.spec.reset(); else if (p.spec.set) p.spec.set(1); if (p.spec.fit && p.id === 'pixels') p.spec.fit(); label(p); }
    saved = { layout: 'editor', panels: {} }; save(); layout('editor');
    FE.toast('Layout reset: all panels are back in place at normal zoom');
  }

  FE.panels = { add, get: (id) => P.get(id), list: () => [...P.values()].map((p) => p.id), setMode: (id, m) => setMode(P.get(id), m), zoom: (id, d) => zoom(P.get(id), d), layout, reset, LAYOUTS, selectZoom, cssZoom, saved: () => saved };

  // ---- the panels of this editor (one line each) -------------------------------------------------------------------------------------------------------
  const sec = (title) => [...document.querySelectorAll('#rpanel > details.sec')].find((d) => d.querySelector('summary').textContent.trim().startsWith(title));
  const fire = (el) => el.dispatchEvent(new Event('input', { bubbles: true }));
  FE.panelsInit = () => {
    add({ id: 'glyphs', title: 'Glyph grid', el: '#gcol', zoom: { get: () => FE.gridZoom(), set: (f) => FE.gridZoom(f), nudge: (d) => FE.gridZoom(FE.gridZoom() * (d > 0 ? STEP : 1 / STEP)), reset: () => FE.gridZoom(1), isDefault: () => FE.gridZoom() === 1 } });
    add({ id: 'pixels', title: 'Pixel editor', el: '#ecol', zoom: {
      get: () => +$('zoom').value / 24, set: (f) => { $('zoom').value = Math.round(24 * f); fire($('zoom')); }, label: () => $('zoom').value + ' px per pixel',
      nudge: (d) => { $('zoom').value = Math.max(4, Math.min(64, +$('zoom').value + (d > 0 ? 4 : -4))); fire($('zoom')); }, fit: () => $('zfit').click(), reset: () => { $('zoom').value = 24; fire($('zoom')); }, isDefault: () => +$('zoom').value === 24 } });
    add({ id: 'outline', title: 'Outline editor', el: '#olmain', zoom: {
      label: () => 'wheel', nudge: (d) => { const cv = $('olcv'), r = cv.getBoundingClientRect(); cv.dispatchEvent(new WheelEvent('wheel', { deltaY: d > 0 ? -100 : 100, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true })); }, fit: () => $('olfit').click(), reset: () => $('olfit').click() } });
    add({ id: 'outlineinfo', title: 'Outline details', el: '#olside' });
    add({ id: 'family', title: 'Family sizes', el: '#v-family' });
    add({ id: 'specimen', title: 'Specimen and waterfall', el: '#v-specimen', zoom: selectZoom('#spz', 2) });
    add({ id: 'atari', title: 'Atari screen and graphics', el: '#v-atari', zoom: selectZoom('#simz', 2) });
    add({ id: 'kerning', title: 'Kerning', el: '#v-kern', zoom: selectZoom('#kz', 2) });
    add({ id: 'manager', title: 'Font manager', el: '#v-manager' });
    add({ id: 'quality', title: 'Quality check', el: '#v-quality' });
    add({ id: 'glyphinfo', title: 'Glyph', el: sec('Glyph') });
    add({ id: 'batch', title: 'Selection', el: sec('Selection') });
    add({ id: 'ghost', title: 'Reference ghost', el: sec('Reference ghost') });
    add({ id: 'metrics', title: 'Metrics', el: sec('Metrics') });
    add({ id: 'preview', title: 'Preview', el: sec('Preview'), zoom: selectZoom('#pvz', 2) });
    add({ id: 'history', title: 'History', el: sec('History') });
    for (const p of P.values()) if (p.mode === 'float') ro.observe(p.el);
    const bar = $('laybar');
    bar.innerHTML = Object.entries(LAYOUTS).map(([k, v]) => '<button data-lay="' + k + '" title="' + FE.esc(v.hint) + '">' + v.label + '</button>').join('') + '<button id="layreset" title="Put every panel back and reset all zoom levels">Reset layout</button>';
    bar.querySelectorAll('[data-lay]').forEach((b) => { b.onclick = () => layout(b.dataset.lay); b.classList.toggle('on', b.dataset.lay === saved.layout); });
    $('layreset').onclick = reset;
    // a narrow window starts with the side panels folded away: use Maximise on a panel instead of cramped columns
    if (innerWidth <= 900 && !localStorage.getItem(KEY)) { side('lpanel', 'tgl', false); side('rpanel', 'tgr', false); }
    new MutationObserver(() => {}).observe(document.body, { attributes: true });
  };
  // floating windows need to be observed for resizing as soon as they float
  const sm = setMode; // eslint-disable-line no-unused-vars
  document.addEventListener('DOMContentLoaded', () => { FE.panelsInit(); for (const p of P.values()) ro.observe(p.el); });
})();
