// xCBase table grid: DOM rows with virtual scrolling (only the visible window is built, so 65535 records stay fast).
(function () {
  'use strict';
  const XA = window.XA, $ = XA.$, D = XA.D;
  const RH = 24, RN = 54;
  const G = XA.grid = { editing: false };
  let scroll, head, sizer, ced, widths = [], lastKey = '';

  const colW = (f) => (f.type === 'text' ? Math.min(Math.max(f.len, f.name.length + 3) * 8 + 18, 280) : f.type === 'memo' ? 220 : f.type === 'int' ? 90 : f.type === 'num' ? 120 : f.type === 'date' ? 110 : 70);
  const align = (f) => (f.type === 'int' || f.type === 'num' ? 'right' : f.type === 'bool' ? 'center' : 'left');
  const show = (f, v) => (v === null || v === undefined ? '' : f.type === 'memo' ? String(v).split(/\r?\n/)[0] : D.fmtValue(v, f.type, f));

  G.init = () => {
    scroll = $('gscroll'); head = $('ghead'); sizer = $('gsizer'); ced = $('ced');
    scroll.addEventListener('scroll', () => { G.paint(); });
    scroll.tabIndex = 0;
    new ResizeObserver(() => G.paint()).observe(scroll);
    head.addEventListener('click', (e) => {
      const d = e.target.closest('[data-f]'); if (!d) return;
      const f = d.dataset.f, s = XA.sort;
      if (!s || s.field !== f) XA.setSort(f, false); else if (!s.desc) XA.setSort(f, true); else XA.setSort(null);
    });
    sizer.addEventListener('mousedown', (e) => {
      const c = e.target.closest('[data-c]'), r = e.target.closest('[data-r]'); if (!r) return;
      if (G.editing) G.commit();
      XA.cur.row = +r.dataset.r; if (c) XA.cur.col = +c.dataset.c; G.paint(); scroll.focus({ preventScroll: true }); XA.emit('select');
    });
    sizer.addEventListener('dblclick', (e) => { if (e.target.closest('[data-c]')) G.edit(); });
    sizer.addEventListener('contextmenu', (e) => { const r = e.target.closest('[data-r]'); if (r) { XA.cur.row = +r.dataset.r; const c = e.target.closest('[data-c]'); if (c) XA.cur.col = +c.dataset.c; G.paint(); } e.preventDefault(); XA.emit('context', e); });
    scroll.addEventListener('keydown', onKey);
    ced.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); G.commit(); XA.cur.row = Math.min(XA.positions().length - 1, XA.cur.row + 1); G.reveal(); G.paint(); scroll.focus(); XA.emit('select'); }
      else if (e.key === 'Escape') { e.preventDefault(); G.cancel(); } else if (e.key === 'Tab') { e.preventDefault(); G.commit(); XA.cur.col = Math.min(XA.table().fields.length - 1, XA.cur.col + (e.shiftKey ? -1 : 1)); G.paint(); scroll.focus(); XA.emit('select'); }
    });
    ced.addEventListener('blur', () => { if (G.editing) G.commit(); });
  };

  function onKey(e) {
    if (G.editing || !XA.db) return;
    const n = XA.positions().length, nf = XA.table().fields.length, vis = Math.max(1, Math.floor(scroll.clientHeight / RH) - 2);
    let used = true;
    if (e.ctrlKey || e.metaKey) return;
    switch (e.key) {
      case 'ArrowDown': XA.cur.row = Math.min(n - 1, XA.cur.row + 1); break;
      case 'ArrowUp': XA.cur.row = Math.max(0, XA.cur.row - 1); break;
      case 'ArrowRight': XA.cur.col = Math.min(nf - 1, XA.cur.col + 1); break;
      case 'ArrowLeft': XA.cur.col = Math.max(0, XA.cur.col - 1); break;
      case 'PageDown': XA.cur.row = Math.min(n - 1, XA.cur.row + vis); break;
      case 'PageUp': XA.cur.row = Math.max(0, XA.cur.row - vis); break;
      case 'Home': XA.cur.row = 0; break;
      case 'End': XA.cur.row = Math.max(0, n - 1); break;
      case 'Enter': case 'F2': G.edit(); break;
      case 'Insert': XA.addRecord(); break;
      case 'Delete': if (n) { XA.deleteRecord(XA.positions()[XA.cur.row]); } break;
      case ' ': { const f = XA.table().fields[XA.cur.col]; if (f.type === 'bool' && n) { const i = XA.positions()[XA.cur.row], v = XA.table().rows[i][XA.cur.col]; XA.setCell(i, f.name, v === true ? 'no' : 'yes'); } break; }
      default: used = false;
        if (e.key.length === 1 && !e.altKey && n) { G.edit(e.key); e.preventDefault(); }
    }
    if (used) { e.preventDefault(); G.reveal(); G.paint(); XA.emit('select'); }
  }

  G.reveal = () => {
    const top = XA.cur.row * RH, vh = scroll.clientHeight - 26;
    if (top < scroll.scrollTop) scroll.scrollTop = top; else if (top + RH > scroll.scrollTop + vh) scroll.scrollTop = top + RH - vh;
    const x = RN + widths.slice(0, XA.cur.col).reduce((a, b) => a + b, 0), w = widths[XA.cur.col] || 0;
    if (x - RN < scroll.scrollLeft) scroll.scrollLeft = Math.max(0, x - RN); else if (x + w > scroll.scrollLeft + scroll.clientWidth) scroll.scrollLeft = x + w - scroll.clientWidth;
  };

  G.rebuild = () => {
    if (!XA.db || !XA.tname) { head.innerHTML = ''; sizer.innerHTML = ''; return; }
    const t = XA.table(); widths = t.fields.map(colW);
    head.innerHTML = `<div class="rn" style="width:${RN}px">#</div>` + t.fields.map((f, i) => {
      const s = XA.sort && XA.sort.field.toLowerCase() === f.name.toLowerCase();
      return `<div data-f="${XA.esc(f.name)}" style="width:${widths[i]}px;text-align:${align(f)}" title="${f.type}${f.type === 'text' ? ' ' + f.len : ''} - click to sort">${XA.esc(f.name)}${s ? '<small>' + (XA.sort.desc ? '&#9660;' : '&#9650;') + '</small>' : ''}</div>`;
    }).join('');
    lastKey = ''; G.paint();
  };

  G.paint = () => {
    if (!XA.db || !XA.tname || !scroll) return;
    const t = XA.table(), pos = XA.positions(), n = pos.length;
    sizer.style.height = n * RH + 'px';
    const first = Math.max(0, Math.floor(scroll.scrollTop / RH) - 4), last = Math.min(n, Math.ceil((scroll.scrollTop + scroll.clientHeight) / RH) + 4);
    const key = [first, last, t.version, t.rows.length, XA.cur.row, XA.cur.col, XA.filter, JSON.stringify(XA.sort), t.name].join('|');
    if (key === lastKey) return; lastKey = key;
    let h = '';
    for (let r = first; r < last; r++) {
      const row = t.rows[pos[r]];
      h += `<div class="grow${r === XA.cur.row ? ' sel' : ''}" data-r="${r}" style="top:${r * RH}px"><div class="rn" style="width:${RN}px">${pos[r] + 1}</div>` +
        t.fields.map((f, c) => { const v = row[c]; return `<div data-c="${c}" class="${r === XA.cur.row && c === XA.cur.col ? 'cur' : ''}${v === null || v === undefined ? ' nul' : ''}" style="width:${widths[c]}px;text-align:${align(f)}">${XA.esc(show(f, v))}</div>`; }).join('') + '</div>';
    }
    sizer.innerHTML = h;
    XA.emit('paint');
  };
  G.refresh = () => { lastKey = ''; G.paint(); };

  G.edit = (seed) => {
    const t = XA.table(), pos = XA.positions(); if (!pos.length) return;
    const f = t.fields[XA.cur.col];
    if (f.type === 'memo') { XA.toast('Memo fields are edited in Form view'); return; }
    G.reveal(); G.paint();
    const cell = sizer.querySelector(`[data-r="${XA.cur.row}"] [data-c="${XA.cur.col}"]`); if (!cell) return;
    const sr = scroll.getBoundingClientRect(), cr = cell.getBoundingClientRect();
    ced.style.left = cr.left - sr.left + scroll.scrollLeft + 'px'; ced.style.top = cr.top - sr.top + scroll.scrollTop + 'px';
    ced.style.width = cr.width + 'px'; ced.style.height = cr.height + 'px'; ced.style.display = 'block';
    const v = t.rows[pos[XA.cur.row]][XA.cur.col];
    ced.value = seed !== undefined ? seed : v === null || v === undefined ? '' : f.type === 'bool' ? (v ? 'yes' : 'no') : f.type === 'num' ? String(v) : show(f, v);
    G.editing = true; ced.focus(); if (seed === undefined) ced.select();
  };
  G.cancel = () => { G.editing = false; ced.style.display = 'none'; scroll.focus(); };
  G.commit = () => {
    if (!G.editing) return; G.editing = false; ced.style.display = 'none';
    const t = XA.table(), i = XA.positions()[XA.cur.row], f = t.fields[XA.cur.col];
    try { XA.setCell(i, f.name, ced.value); } catch (e) { XA.toast(f.name + ': ' + e.message); }
    G.refresh();
  };
  XA.on('change', G.refresh); XA.on('view', () => { lastKey = ''; G.rebuild(); }); XA.on('table', G.rebuild); XA.on('db', G.rebuild);
})();
