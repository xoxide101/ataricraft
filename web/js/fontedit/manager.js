// Font manager: browse every family, favourites, tags, collections, compare, coverage, duplicates, hand-off to apps.
(function () {
  'use strict';
  const FE = window.FE, st = FE.state, CF = window.XCW.Font, $ = (id) => document.getElementById(id);
  const KEY = 'craft.mgr';
  const load = () => { try { return Object.assign({ fav: {}, tags: {}, coll: {} }, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return { fav: {}, tags: {}, coll: {} }; } };
  let db = load(), sel = null, cov = {}, dupes = [];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* quota */ } };
  FE.mgrDb = () => db;

  const refFont = (fam) => fam.sizes[fam.master] || fam.sizes[12] || Object.values(fam.sizes)[0];
  const filled = (f, code) => { const s = f.map[code]; if (s === undefined || s === null || s < 0) return false; return CF.glyph(f, code).some((r) => r); };
  FE.coverageOf = (fam) => {
    const f = refFont(fam), o = {};
    for (const [k, [label, fn]] of Object.entries(FE.COVERAGE)) { const codes = fn(); const n = codes.filter((c) => filled(f, c)).length; o[k] = { label, have: n, total: codes.length }; }
    return o;
  };
  FE.fontHash = (fam) => { const f = refFont(fam); let h = 5381; for (let c = 32; c < 127; c++) for (const r of CF.glyph(f, c)) h = ((h * 33) ^ (r | 0)) >>> 0; return h.toString(16) + ':' + f.adv; };

  const colls = () => [...new Set([].concat(...Object.values(db.coll)))].sort();
  const tagsAll = () => [...new Set([].concat(...Object.values(db.tags)))].sort();
  const list = (o, id) => o[id] || [];

  function rows() {
    const q = ($('mgsearch').value || '').toLowerCase(), flt = $('mgfilter').value;
    return [...FE.entries.values()].filter((e) => {
      if (/^url:.*rom/i.test(e.id)) return false;
      const hay = (e.name + ' ' + e.badges.join(' ') + ' ' + list(db.tags, e.id).join(' ') + ' ' + list(db.coll, e.id).join(' ')).toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (flt === 'fav') return !!db.fav[e.id];
      if (flt.startsWith('t:')) return list(db.tags, e.id).includes(flt.slice(2));
      if (flt.startsWith('c:')) return list(db.coll, e.id).includes(flt.slice(2));
      return true;
    });
  }

  function draw() {
    const fl = $('mgfilter'), cur = fl.value;
    fl.innerHTML = '<option value="">All fonts</option><option value="fav">Favourites</option>' + tagsAll().map((t) => '<option value="t:' + FE.esc(t) + '">Tag: ' + FE.esc(t) + '</option>').join('') + colls().map((c) => '<option value="c:' + FE.esc(c) + '">Collection: ' + FE.esc(c) + '</option>').join('');
    fl.value = [...fl.options].some((o) => o.value === cur) ? cur : '';
    const rs = rows();
    $('mgcount').textContent = rs.length + ' fonts';
    $('mgrows').innerHTML = rs.map((e) => {
      const c = cov[e.id], tg = list(db.tags, e.id), cl = list(db.coll, e.id);
      return '<tr data-id="' + FE.esc(e.id) + '"' + (sel === e.id ? ' class="on"' : '') + '><td><button class="star" data-star="1" title="Favourite">' + (db.fav[e.id] ? '\u2605' : '\u2606') + '</button></td><td>' + FE.esc(e.name) + '</td><td>' + e.badges.map((b) => '<span class="badge">' + FE.esc(b) + '</span>').join('') + '</td><td>' + (e.fam ? Object.keys(e.fam.sizes).length : '?') + '</td><td>' + (c ? c.ascii.have + '/' + c.ascii.total : '') + '</td><td>' + tg.map((t) => '<span class="badge tag">#' + FE.esc(t) + '</span>').join('') + cl.map((t) => '<span class="badge coll">' + FE.esc(t) + '</span>').join('') + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="dim">No fonts match. Import a font on the left or clear the filter.</td></tr>';
    const e = sel && FE.entries.get(sel);
    $('mgsel').textContent = e ? e.name : 'Select a font in the table';
    for (const b of ['mgopen', 'mgxcw', 'mgacw', 'mginstall', 'mgtag', 'mgcoll', 'mguntag']) $(b).disabled = !e;
    const ids = [...FE.entries.values()];
    for (const s of ['mgA', 'mgB']) { const el = $(s), v = el.value; el.innerHTML = ids.map((x) => '<option value="' + FE.esc(x.id) + '">' + FE.esc(x.name) + '</option>').join(''); if (v) el.value = v; }
    $('mgdup').innerHTML = dupes.length ? dupes.map((g) => '<div>' + g.map((e2) => '<b>' + FE.esc(e2.name) + '</b>').join(' = ') + '</div>').join('') : '<span class="dim">Run "Scan all fonts" to find duplicates.</span>';
    const cv = sel && cov[sel];
    $('mgcov').innerHTML = cv ? Object.values(cv).map((x) => '<div class="covrow"><span>' + FE.esc(x.label) + '</span><i style="width:' + Math.round(100 * x.have / x.total) + 'px"></i> ' + x.have + '/' + x.total + '</div>').join('') : '<span class="dim">Scan to see coverage of the selected font.</span>';
  }

  // Loading a family switches the editor to it; remember the selection and put it back afterwards.
  async function ensure(id) { const e = FE.entries.get(id); if (!e.fam) await FE.openEntry(id); return e; }
  async function scan() {
    const prev = { id: st.entry, size: st.f && st.f.adv };
    $('mgscan').disabled = true;
    for (const e of FE.entries.values()) {
      if (/^url:.*rom/i.test(e.id)) continue;
      try { await ensure(e.id); cov[e.id] = FE.coverageOf(e.fam); } catch (err) { /* unreadable entry */ }
    }
    const by = new Map();
    for (const e of FE.entries.values()) if (e.fam) { const h = FE.fontHash(e.fam); (by.get(h) || by.set(h, []).get(h)).push(e); }
    dupes = [...by.values()].filter((g) => g.length > 1);
    if (prev.id && FE.entries.get(prev.id) && FE.entries.get(prev.id).fam) await FE.openEntry(prev.id, prev.size);
    $('mgscan').disabled = false; draw();
    FE.toast('Scanned ' + Object.keys(cov).length + ' fonts, ' + dupes.length + ' duplicate group(s)');
  }

  function paint(cv, fam, text, px) {
    const f = fam.sizes[px] || refFont(fam), z = 2, c = cv.getContext('2d'), cols = Math.max(...Array.from(text, (ch) => (f.advs && f.advs[f.map[ch.charCodeAt(0)]]) || f.adv));
    cv.width = Math.min(1400, (text.length * cols + 8) * z); cv.height = (f.rows + 6) * z;
    const t = FE.themeColors(); c.fillStyle = t.bg; c.fillRect(0, 0, cv.width, cv.height); c.fillStyle = t.ink;
    let x = 4;
    for (const ch of text) { const code = ch.charCodeAt(0), g = CF.glyph(f, code); for (let r = 0; r < f.rows; r++) for (let q = 0; q < f.gw; q++) if (CF.hasPx(f, g[r] || 0, q)) c.fillRect((x + q) * z, (3 + r) * z, z, z); x += (f.advs && f.advs[f.map[code]]) || f.adv; }
  }
  async function compare() {
    const a = await ensure($('mgA').value), b = await ensure($('mgB').value), text = $('mgtext').value || 'Hamburgefonstiv', px = +$('mgpx').value;
    paint($('mgcA'), a.fam, text, px); paint($('mgcB'), b.fam, text, px);
    $('mgcmpinfo').textContent = a.name + ' ' + (a.fam.sizes[px] ? px + ' px' : 'nearest size') + ' vs ' + b.name + ' ' + (b.fam.sizes[px] ? px + ' px' : 'nearest size');
  }
  async function waterfall() {
    const e = await ensure(sel || st.entry), text = $('mgtext').value || 'Hamburgefonstiv', box = $('mgwf'); box.innerHTML = '';
    for (const s of Object.keys(e.fam.sizes).map(Number).sort((x, y) => x - y)) { const cv = document.createElement('canvas'); paint(cv, e.fam, text, s); const row = document.createElement('div'); row.className = 'wfrow'; row.innerHTML = '<span class="dim">' + s + ' px</span>'; row.appendChild(cv); box.appendChild(row); }
  }

  function wire() {
    $('mgsearch').oninput = draw; $('mgfilter').onchange = draw;
    $('mgrows').onclick = (ev) => {
      const tr = ev.target.closest('tr[data-id]'); if (!tr) return; const id = tr.dataset.id;
      if (ev.target.dataset.star) { db.fav[id] = !db.fav[id]; if (!db.fav[id]) delete db.fav[id]; save(); } else { if (ev.detail >= 2 && sel === id) { draw(); return $('mgopen').click(); } sel = id; }
      draw();
    };
    const add = (map, inp) => { const v = inp.value.trim().replace(/^#/, ''); if (!v || !sel) return; const l = map[sel] || (map[sel] = []); if (!l.includes(v)) l.push(v); inp.value = ''; save(); draw(); };
    $('mgtag').onclick = () => add(db.tags, $('mgtagin')); $('mgcoll').onclick = () => add(db.coll, $('mgcollin'));
    $('mguntag').onclick = () => { delete db.tags[sel]; delete db.coll[sel]; save(); draw(); };
    $('mgopen').onclick = async () => { await FE.openEntry(sel); FE.showTab('edit'); };
    $('mgxcw').onclick = async () => { await FE.openEntry(sel); try { FE.useInXcwriter(); } catch (e) { FE.toast(e.message); } };
    $('mgacw').onclick = async () => { await FE.openEntry(sel); try { await FE.sendToAcwriter(); } catch (e) { FE.toast(e.message); } };
    $('mginstall').onclick = async () => { await FE.openEntry(sel); FE.keepFamily(true, st.fam, FE.entries.get(sel).name); FE.libChanged(); draw(); FE.toast('Installed "' + FE.entries.get(sel).name + '" in My fonts: it is offered in every Craft editor in this browser'); };
    $('mgscan').onclick = scan;
    for (const id of ['mgA', 'mgB', 'mgtext', 'mgpx']) $(id).onchange = compare;
    $('mgwfgo').onclick = waterfall;
    $('mgcmp').onclick = compare;
  }
  wire();
  FE.onTab('manager', () => { draw(); });
  FE.mgrRefresh = draw;
  const lc = FE.libChanged; FE.libChanged = function () { const r = lc.apply(this, arguments); if (FE.isTab('manager')) draw(); return r; };
})();
