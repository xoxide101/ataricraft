// Large "Choose font" window: search, big sample of every font drawn in that font, grid/list, tree (group > family > style > size), favourites and tags.
(() => {
  'use strict';
  const FE = window.FE, CF = FE.CF, FP = FE.FP, $ = FE.$, st = FE.state, esc = FE.esc;
  const view = { mode: 'grid', filter: '', text: 'Hamburgefonstiv 0123 ABC xyz', px: 12, sel: null, selSize: null };
  const preview = new Map(); // entry id -> family, or null when no preview is possible
  const GROUPS = [['craft', 'Craft'], ['shipped', 'Shipped'], ['atari', 'Atari / ROM'], ['personal', 'Personal'], ['mine', 'Mine / imported']];
  const dbm = () => (FE.mgrDb ? FE.mgrDb() : { fav: {}, tags: {} });
  const label = (s) => (s === 8 ? '8 (Atari 8x8)' : String(s));
  const styleOf = (e) => { const m = /\b(bold|italic|oblique|light|medium|black|condensed)\b/i.exec(e.name); return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : 'Regular'; };

  // a family used only to draw the sample; it never touches the editor
  async function familyFor(e) {
    if (preview.has(e.id)) return preview.get(e.id);
    let fam = e.fam || null;
    try {
      if (!fam && e.kind === 'craft') {
        fam = { name: e.name, master: 12, sizes: {} };
        for (const x of window.ACW_FACES || []) if ((x.id === 'zfont') === (e.id === 'zfont')) fam.sizes[x.adv] = CF.parse(FE.b64ToBuf(x.acf));
        if (e.id === 'craft') for (const [s, b64] of Object.entries(window.CRAFT_BIG || {})) if (!fam.sizes[s]) fam.sizes[s] = CF.parse(FE.b64ToBuf(b64));
        if (!Object.keys(fam.sizes).length) fam = null;
      } else if (!fam && e.kind === 'url' && location.protocol === 'file:') {
        fam = null; // browsers block reading library files from file://; the sample appears once the font is opened
      } else if (!fam && e.kind === 'url') {
        const r = await fetch(e.url); if (!r.ok) throw new Error('HTTP ' + r.status);
        fam = FP.load(new Uint8Array(await r.arrayBuffer()), e.url.split('/').pop(), { name: e.name.slice(0, 40) }).fam;
      } else if (!fam && e.kind === 'my') {
        fam = FP.load(new TextEncoder().encode(FE.myFonts()[e.name]), e.name + '.xcf', { name: e.name }).fam;
      } else if (!fam && e.kind === 'lib') {
        const r = await window.AC.FontLib.get(e.libId); fam = FP.load(new Uint8Array(r.bytes), e.name + '.' + e.libKind, { name: e.name.slice(0, 40) }).fam;
      }
    } catch (x) { fam = null; }
    preview.set(e.id, fam); return fam;
  }
  const pickSize = (fam, want) => {
    const have = Object.keys(fam.sizes).map(Number); if (!have.length) return null;
    return fam.sizes[want] ? want : have.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
  };
  function drawSample(cv, fam, text, want, z) {
    const s = pickSize(fam, want), f = s && fam.sizes[s]; if (!f) return null;
    const adv = (code) => f.advs[f.map[code]] || f.adv, tc = FE.themeColors();
    const chars = [...text].map((c) => c.charCodeAt(0) & 255);
    const W = chars.reduce((n, c) => n + adv(c), 0) + 4;
    cv.width = Math.max(8, W * z); cv.height = (f.rows + 4) * z;
    const c = cv.getContext('2d'); c.fillStyle = tc.bg; c.fillRect(0, 0, cv.width, cv.height); c.fillStyle = tc.ink;
    let x = 2;
    for (const code of chars) {
      const g = CF.glyph(f, code);
      for (let r = 0; r < f.rows; r++) for (let q = 0; q < f.gw; q++) if (CF.hasPx(f, g[r] || 0, q)) c.fillRect((x + q) * z, (2 + r) * z, z, z);
      x += adv(code);
    }
    return s;
  }

  const entriesNow = () => [...FE.entries.values()].filter((e) => {
    if (e.id === 'autosave') return false;
    const q = $('chq').value.trim().toLowerCase(), d = dbm(), tags = d.tags[e.id] || [];
    if (q && !(e.name + ' ' + e.badges.join(' ') + ' ' + tags.join(' ')).toLowerCase().includes(q)) return false;
    const f = view.filter;
    if (!f) return true;
    if (f === 'fav') return !!d.fav[e.id];
    if (f.startsWith('g:')) return e.group === f.slice(2);
    if (f.startsWith('t:')) return tags.includes(f.slice(2));
    return true;
  });

  function drawTree(items) {
    const d = dbm(), tags = [...new Set([].concat(...Object.values(d.tags || {})))].sort();
    let h = '<div class="chf' + (!view.filter ? ' on' : '') + '" data-f="">All fonts <span>' + FE.entries.size + '</span></div>';
    h += '<div class="chf' + (view.filter === 'fav' ? ' on' : '') + '" data-f="fav">&#9733; Favourites <span>' + Object.keys(d.fav || {}).filter((k) => d.fav[k]).length + '</span></div>';
    for (const t of tags) h += '<div class="chf' + (view.filter === 't:' + t ? ' on' : '') + '" data-f="t:' + esc(t) + '">Tag: ' + esc(t) + '</div>';
    h += '<h4>Family &gt; Style &gt; Size</h4>';
    for (const [g, gl] of GROUPS) {
      const list = items.filter((e) => e.group === g); if (!list.length) continue;
      h += '<details class="chg" open><summary>' + gl + ' <span>' + list.length + '</span></summary>';
      for (const e of list) {
        const fam = preview.get(e.id) || e.fam, sizes = fam ? Object.keys(fam.sizes).map(Number).sort((a, b) => a - b) : [];
        h += '<details class="chfam"' + (view.sel === e.id ? ' open' : '') + '><summary data-id="' + esc(e.id) + '" class="' + (view.sel === e.id ? 'on' : '') + '">' + esc(e.name) + '</summary>' +
          '<div class="chsty"><b>' + styleOf(e) + '</b>' + (sizes.length ? sizes.map((s) => '<button data-id="' + esc(e.id) + '" data-size="' + s + '"' + (view.sel === e.id && view.selSize === s ? ' class="on"' : '') + '>' + label(s) + '</button>').join('') : '<i class="dim"> sizes load when shown</i>') + '</div></details>';
      }
      h += '</details>';
    }
    $('chtree').innerHTML = h;
    $('chtree').querySelectorAll('.chf').forEach((b) => { b.onclick = () => { view.filter = b.dataset.f; draw(); }; });
    $('chtree').querySelectorAll('summary[data-id]').forEach((s) => { s.onclick = () => { view.sel = s.dataset.id; view.selSize = null; markSel(); }; });
    $('chtree').querySelectorAll('button[data-size]').forEach((b) => { b.onclick = () => { view.sel = b.dataset.id; view.selSize = +b.dataset.size; markSel(); }; b.ondblclick = choose; });
  }

  function markSel() {
    $('chgrid').querySelectorAll('.chcard').forEach((c) => { const on = c.dataset.id === view.sel; c.classList.toggle('on', on); if (on) c.scrollIntoView({ block: 'nearest' }); });
    const e = FE.entries.get(view.sel);
    $('chpick').textContent = e ? 'Use ' + e.name + (view.selSize ? ' ' + view.selSize + ' px' : '') : 'Select a font';
    $('chpick').disabled = !e;
    $('chtree').querySelectorAll('summary[data-id]').forEach((s) => s.classList.toggle('on', s.dataset.id === view.sel));
    $('chtree').querySelectorAll('button[data-size]').forEach((b) => b.classList.toggle('on', b.dataset.id === view.sel && +b.dataset.size === view.selSize));
  }

  const redrawSamples = () => {
    $('chgrid').querySelectorAll('.chcard').forEach((c) => {
      const fam = preview.get(c.dataset.id); if (!fam) return;
      const s = drawSample(c.querySelector('canvas'), fam, view.text, view.px, view.mode === 'grid' ? 2 : 2);
      c.querySelector('.chpx').textContent = s ? s + ' px' : '';
    });
  };
  const loadCard = (c) => {
    if (c.dataset.done) return; c.dataset.done = '1';
    familyFor(FE.entries.get(c.dataset.id)).then((fam) => { if (!fam) { c.querySelector('.chpx').textContent = 'no preview'; return; } const s = drawSample(c.querySelector('canvas'), fam, view.text, view.px, 2); c.querySelector('.chpx').textContent = s + ' px'; });
  };
  // safety net for the observer: load every card inside the visible part of the list
  const sweep = () => {
    const g = $('chgrid'), r = g.getBoundingClientRect(); if ($('chooser').hidden) return;
    g.querySelectorAll('.chcard').forEach((c) => { const q = c.getBoundingClientRect(); if (q.bottom > r.top - 200 && q.top < r.bottom + 200) loadCard(c); });
  };
  let obs = null;
  function draw() {
    const items = entriesNow(), d = dbm();
    $('chgrid').className = 'chgrid ' + view.mode;
    $('chgrid').innerHTML = items.map((e) => '<div class="chcard' + (view.sel === e.id ? ' on' : '') + '" data-id="' + esc(e.id) + '" tabindex="-1" role="option">' +
      '<div class="chhead"><b>' + esc(e.name) + '</b><span class="chpx"></span><button class="chstar' + (d.fav && d.fav[e.id] ? ' on' : '') + '" title="Favourite">' + (d.fav && d.fav[e.id] ? '\u2605' : '\u2606') + '</button></div>' +
      '<canvas width="8" height="8"></canvas><div class="fb">' + e.badges.map((b) => '<span class="badge">' + esc(b) + '</span>').join('') + '</div></div>').join('') || '<div class="empty">No font matches. Clear the search or the filter.</div>';
    $('chcount').textContent = items.length + ' of ' + FE.entries.size + ' fonts';
    drawTree(items); markSel();
    if (obs) obs.disconnect();
    obs = new IntersectionObserver((ents) => { for (const en of ents) if (en.isIntersecting) { obs.unobserve(en.target); loadCard(en.target); } }, { root: $('chgrid'), rootMargin: '200px' });
    setTimeout(sweep, 150);
    $('chgrid').querySelectorAll('.chcard').forEach((c) => {
      obs.observe(c);
      c.onclick = (ev) => {
        if (ev.target.classList.contains('chstar')) { FE.mgrToggleFav ? FE.mgrToggleFav(c.dataset.id) : toggleFav(c.dataset.id); draw(); return; }
        view.sel = c.dataset.id; view.selSize = null; markSel(); if (ev.detail >= 2) choose();
      };
    });
  }
  const toggleFav = (id) => { const d = dbm(); d.fav[id] = !d.fav[id]; try { localStorage.setItem('craft.mgr', JSON.stringify(d)); } catch (e) { /* quota */ } };

  async function choose() {
    const id = view.sel; if (!id) return;
    const size = view.selSize || null;
    close();
    try { await FE.openEntry(id, size || undefined); if (size && st.fam && st.fam.sizes[size]) FE.selectSize(size); } catch (e) { FE.toast('Cannot open ' + (FE.entries.get(id) || { name: id }).name + ': ' + e.message); }
    FE.headerFont();
  }
  const move = (dir) => {
    const cards = [...$('chgrid').querySelectorAll('.chcard')]; if (!cards.length) return;
    let i = cards.findIndex((c) => c.dataset.id === view.sel);
    const step = view.mode === 'grid' && (dir === 'left' || dir === 'right') ? 1 : 1;
    const c0 = i < 0 ? 0 : i;
    i = dir === 'home' ? 0 : dir === 'end' ? cards.length - 1 : dir === 'pgup' ? Math.max(0, c0 - 8) : dir === 'pgdn' ? Math.min(cards.length - 1, c0 + 8) : dir === 'up' || dir === 'left' ? Math.max(0, c0 - step) : Math.min(cards.length - 1, i + step);
    view.sel = cards[i].dataset.id; view.selSize = null; markSel(); view.live = true;
    FE.liveOpen(view.sel);
  };

  function open() {
    $('chooser').hidden = false; view.sel = st.entry || view.sel; view.orig = st.entry; view.live = false; draw(); $('chq').focus(); $('chq').select();
  }
  function close() { $('chooser').hidden = true; }
  FE.openChooser = open; FE.closeChooser = close;
  FE.headerFont = () => { const e = FE.entries.get(st.entry); $('bchoose').firstElementChild.textContent = (e ? e.name : (st.fam && st.fam.name) || 'Choose font') + (st.f ? ' \u00b7 ' + st.f.adv + ' px' : ''); };

  document.addEventListener('DOMContentLoaded', () => {
    $('bchoose').onclick = open; $('bbrowse').onclick = open; $('chclose').onclick = close; $('chpick').onclick = choose;
    $('chooser').addEventListener('mousedown', (ev) => { if (ev.target === $('chooser')) close(); });
    $('chq').oninput = draw;
    $('chtext').oninput = () => { view.text = $('chtext').value || ' '; redrawSamples(); };
    $('chsize').oninput = () => { view.px = +$('chsize').value; $('chsizev').textContent = view.px + ' px'; redrawSamples(); };
    $('chgridb').onclick = () => { view.mode = 'grid'; draw(); }; $('chlistb').onclick = () => { view.mode = 'list'; draw(); };
    $('chooser').addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); if (view.live && view.orig && st.entry !== view.orig) FE.openEntry(view.orig).catch(() => {}); view.live = false; }
      else if (['PageDown', 'PageUp', 'Home', 'End'].includes(ev.key) && !/^(INPUT|SELECT)$/.test(ev.target.tagName)) { ev.preventDefault(); move({ PageDown: 'pgdn', PageUp: 'pgup', Home: 'home', End: 'end' }[ev.key]); }
      else if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') { if (ev.target.id === 'chtext' || ev.target.id === 'chsize') return; ev.preventDefault(); move('down'); }
      else if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') { if (ev.target.id === 'chtext' || ev.target.id === 'chsize') return; ev.preventDefault(); move('up'); }
      else if (ev.key === 'Enter' && ev.target.tagName !== 'BUTTON') { ev.preventDefault(); choose(); }
    });
    window.addEventListener('keydown', (ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'o' && ev.shiftKey) { ev.preventDefault(); open(); } });
    FE.headerFont();
  });
  const wrap = FE.libChanged;
  FE.libChanged = () => { wrap(); if (!$('chooser').hidden) draw(); FE.headerFont(); };
  const wf = FE.setFont; FE.setFont = function () { const r = wf.apply(this, arguments); FE.headerFont(); return r; };
})();
