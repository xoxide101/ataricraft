// Compact font pull-downs in the header (Family > Style > Size) and keyboard browsing of fonts.
// Browsing keys work the same in the pull-down, the Fonts list and the big chooser: Up/Down (and PageUp/PageDown, Home/End) move to the
// next font and LOAD it at once, so you can see it; Enter keeps it, Esc goes back to the font you started from. Typing finds a font by name.
(() => {
  'use strict';
  const FE = window.FE, $ = FE.$, st = FE.state;
  const esc = FE.esc;
  let timer = 0, seq = 0;

  // load a font after a short pause so a held arrow key does not open every font on the way
  FE.liveOpen = (id, done) => {
    clearTimeout(timer); const my = ++seq;
    timer = setTimeout(() => {
      FE.openEntry(id).then(() => { if (my === seq && done) done(); }).catch((x) => FE.toast('Cannot open ' + ((FE.entries.get(id) || {}).name || id) + ': ' + x.message));
    }, 120);
  };
  const stepIndex = (key, i, n) => ({ ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, PageDown: i + 8, PageUp: i - 8, Home: 0, End: n - 1 }[key]);
  FE.navKeys = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'];

  // ---- header pull-downs -----------------------------------------------------------------------------------------------------
  const GROUPS = [['craft', 'Craft'], ['shipped', 'Shipped'], ['atari', 'Atari / ROM'], ['personal', 'Personal'], ['mine', 'Mine / imported']];
  let startEntry = null;
  function fill() {
    const fam = $('hfam'); if (!fam) return;
    const items = [...FE.entries.values()];
    let h = '';
    for (const [g, label] of GROUPS) {
      const part = items.filter((e) => (e.group || 'mine') === g); if (!part.length) continue;
      h += '<optgroup label="' + esc(label) + '">' + part.map((e) => '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>').join('') + '</optgroup>';
    }
    const rest = items.filter((e) => !GROUPS.some(([g]) => g === (e.group || 'mine')));
    if (rest.length) h += '<optgroup label="Other">' + rest.map((e) => '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>').join('') + '</optgroup>';
    if (fam.dataset.sig !== h) { fam.innerHTML = h; fam.dataset.sig = h; }
    if (st.entry && FE.entries.has(st.entry)) fam.value = st.entry;
    // style
    const sty = $('hstyle'), f = st.fam;
    let styles = ['regular'];
    try { const reg = f && FE.regSync(f); if (reg && reg.styles.length) styles = reg.styles.map((s) => s.style); } catch (e) { /* no registry yet */ }
    sty.innerHTML = styles.map((s) => '<option>' + esc(s[0].toUpperCase() + s.slice(1)) + '</option>').join(''); sty.disabled = styles.length < 2;
    sty.title = styles.length < 2 ? 'This family has one style' : 'Style of the family';
    // size
    const sz = $('hsize'); if (!f) return;
    const have = Object.keys(f.sizes).map(Number), all = [...new Set([...(FE.SIZES || []), ...have])].sort((a, b) => a - b);
    sz.innerHTML = all.map((k) => '<option value="' + k + '">' + (k === 8 ? '8 px (Atari 8x8)' : k + ' px') + (f.sizes[k] ? '' : ' (create)') + '</option>').join('');
    sz.value = st.f ? String(st.f.adv) : '';
  }
  FE.pickerFill = fill;

  function onFamKey(ev) {
    const sel = ev.currentTarget;
    if (ev.key === 'Enter') { startEntry = st.entry; sel.blur(); }
    else if (ev.key === 'Escape') {
      if (startEntry && st.entry !== startEntry) { ev.stopPropagation(); FE.openEntry(startEntry).then(fill); }
    }
  }

  // ---- the Fonts list in the left panel: same keys -------------------------------------------------------------------------------
  function listKeys(box) {
    let buf = '', bt = 0, start = null;
    box.addEventListener('focusin', () => { if (start === null) start = st.entry; });
    box.addEventListener('focusout', () => { setTimeout(() => { if (!box.contains(document.activeElement)) start = null; }, 0); });
    box.addEventListener('keydown', (ev) => {
      const items = [...box.querySelectorAll('.fitem')]; if (!items.length || ev.ctrlKey || ev.altKey || ev.metaKey) return;
      const cur = items.findIndex((x) => x === document.activeElement || x.dataset.fid === st.entry);
      let to = -1;
      if (FE.navKeys.includes(ev.key)) to = Math.max(0, Math.min(items.length - 1, stepIndex(ev.key, cur < 0 ? 0 : cur, items.length)));
      else if (ev.key === 'Enter') { ev.preventDefault(); start = st.entry; FE.openEntry(items[Math.max(cur, 0)].dataset.fid).catch((x) => FE.toast('Cannot open: ' + x.message)); return; }
      else if (ev.key === 'Escape') { if (start && st.entry !== start) { ev.stopPropagation(); FE.openEntry(start).then(() => refocus(box, start)); } return; }
      else if (ev.key.length === 1 && /\S/.test(ev.key)) {
        const now = Date.now(); buf = now - bt > 900 ? ev.key.toLowerCase() : buf + ev.key.toLowerCase(); bt = now;
        to = items.findIndex((x) => x.querySelector('.fn').textContent.toLowerCase().startsWith(buf));
        if (to < 0) to = items.findIndex((x) => x.querySelector('.fn').textContent.toLowerCase().includes(buf));
        if (to < 0) return;
      } else return;
      ev.preventDefault();
      const id = items[to].dataset.fid; items[to].focus(); items[to].scrollIntoView({ block: 'nearest' });
      FE.liveOpen(id, () => refocus(box, id));
    });
  }
  // the list is drawn again after every load; put the keyboard focus back on the font that is now open
  function refocus(box, id) {
    const it = [...box.querySelectorAll('.fitem')].find((x) => x.dataset.fid === id); if (it) { it.focus({ preventScroll: true }); it.scrollIntoView({ block: 'nearest' }); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const fam = $('hfam');
    fam.addEventListener('focus', () => { startEntry = st.entry; });
    fam.addEventListener('keydown', onFamKey);
    fam.onchange = () => FE.liveOpen(fam.value, fill);
    $('hsize').onchange = () => { FE.selectSize(+$('hsize').value); fill(); };
    $('hstyle').onchange = () => FE.toast('This family only has the ' + $('hstyle').value + ' style');
    listKeys($('flist'));
    fill();
  });
  const wf = FE.setFont; FE.setFont = function () { const r = wf.apply(this, arguments); fill(); return r; };
  const wl = FE.libChanged; FE.libChanged = function () { const r = wl.apply(this, arguments); fill(); return r; };
})();
