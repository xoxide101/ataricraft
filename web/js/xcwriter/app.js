// xCWriter application: state, screens, dialogs, commands. The editors (HQ / AT) only render and capture input;
// every change goes through the DOM-free model in XCW (see tools/xcwcore.cjs).
(function () {
  const $ = (id) => document.getElementById(id);
  const KEYS = ['b', 'i', 'u', 'sup', 'sub'];
  const cmp = XCW.cmp;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const dict = XCW.dictParse(b64(XCW_DATA.dict));
  const LS = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
  const NOTES = ['Typefaces and styles are stored in a .xcw; ACWriter shows 8x8 faces in PAGE zoom (4 fonts, 8 changes). Sizes other than 8x8 and line spacing stay in xCWriter/docx', 'Bullets show as * with a 2 column indent'];

  const XW = window.XW = {
    doc: XCW.newDoc(), mode: 'hq', name: 'Untitled', id: null, dirty: false, docVer: 0, warnVer: -1, warns: [],
    undo: [], redo: [], lastSnap: 0, pend: {}, lastKey: '', clip: null, misses: [], missSet: new Set(), spellOn: true, ignore: new Set(LS.get('xcw.ignore', [])),
    sourceFormat: null, find: { q: '', matches: [] },
  };
  const isAt = () => XW.mode !== 'hq';
  const cur = () => (XW.mode === 'page' ? PG : XW.mode === 'atari' ? AT : HQ);
  const pgOpt = () => (XW.page ? { page: XW.page } : {});
  const sel = () => cur().getSel() || { a: { p: 0, o: 0 }, f: { p: 0, o: 0 } };

  // ---------- small UI helpers ----------
  let toastT;
  function toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, ms || 3500); }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function modal(html) { $('dlg').innerHTML = html; $('modal').classList.add('on'); }
  function closeModal() { $('modal').classList.remove('on'); $('dlg').innerHTML = ''; }
  $('modal').addEventListener('mousedown', (e) => { if (e.target === $('modal')) closeModal(); });
  const repHtml = (rep) => (rep && rep.length ? '<ul class="rep">' + rep.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>' : '<ul class="rep none"><li>Nothing is lost in this format.</li></ul>');
  function download(bytes, name, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
    a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const baseName = (n) => n.replace(/\.[^.\\/]*$/, '');
  const hostName = (n) => n.toUpperCase().replace(/[^A-Z0-9._]/g, '').slice(0, 12);

  // ---------- screens and modes ----------
  function screen(s) {
    document.body.classList.remove('s-home', 's-editor', 's-help');
    document.body.classList.add('s-' + s);
    if (s === 'home') renderRecent();
    if (s === 'editor') { cur().focus(); refreshAll(); }
  }
  function setMode(m) {
    if (m === XW.mode) return;
    if (m === 'page' && !XW.page) XW.page = XCW.Page.normalize({});
    const s = sel();
    XW.mode = m;
    if (m === 'atari' || m === 'page') {
      const before = XCW.atariWarnings(XW.doc);
      const fixed = atariSanitize(XW.doc);
      if (JSON.stringify(fixed) !== JSON.stringify(XW.doc)) { snapshot(true); XW.doc = fixed; }
      if (before.length) toast('Atari matching: ' + before.join('; '), 7000);
    }
    document.body.classList.toggle('m-hq', m === 'hq'); document.body.classList.toggle('m-atari', m === 'atari'); document.body.classList.toggle('m-page', m === 'page');
    $('mhq').classList.toggle('on', m === 'hq'); $('mat').classList.toggle('on', m === 'atari'); $('mpg').classList.toggle('on', m === 'page');
    XW.pend = {};
    cur().load(XW.doc, s);
    if (document.body.classList.contains('s-editor')) cur().focus();
    refreshAll();
  }
  // characters ACWriter cannot show become their look-alike or ?, so that caret offsets map 1:1 onto screen cells
  function atariSanitize(doc) {
    const c = XCW.cleanParas(XW.mode === 'page' && XW.page ? XCW.Page.expandTabs(doc, XW.page) : doc);
    for (const p of c) for (const r of p.runs) r.t = [...r.t].map((ch) => (XCW.charOk(ch) || (ch.codePointAt(0) >= 0xe080 && ch.codePointAt(0) <= 0xe09f) ? ch : '?')).join('');
    return XCW.normalize(c);
  }
  $('mhq').onclick = () => setMode('hq');
  $('mat').onclick = () => setMode('atari');
  $('mpg').onclick = () => setMode('page');

  // ---------- undo / change tracking ----------
  function snapshot(force) {
    const now = Date.now();
    if (!force && now - XW.lastSnap < 700 && XW.undo.length) return;
    XW.lastSnap = now;
    XW.undo.push({ doc: JSON.parse(JSON.stringify(XW.doc)), sel: sel() });
    if (XW.undo.length > 200) XW.undo.shift();
    XW.redo = [];
  }
  XW.beforeEdit = () => snapshot(false);
  XW.edit = (fn) => { snapshot(false); fn(XW.doc); XW.doc = XCW.normalize(XW.doc); changed(); };
  function changed() { XW.dirty = true; XW.docVer++; scheduleSpell(); scheduleSave(); updateStatus(); }
  function refreshAll() { XW.docVer++; scheduleSpell(); updateStatus(); updateTools(); if (isAt()) cur().render(); }
  function doUndo(redo) {
    const from = redo ? XW.redo : XW.undo, to = redo ? XW.undo : XW.redo;
    if (!from.length) return;
    to.push({ doc: JSON.parse(JSON.stringify(XW.doc)), sel: sel() });
    const s = from.pop(); XW.doc = s.doc; XW.lastSnap = 0;
    cur().load(XW.doc, s.sel); changed();
  }
  XW.undoRedo = doUndo;
  const refresh = (s) => { cur().load(XW.doc, s); changed(); updateTools(); };

  // ---------- commands ----------
  function toggle(key) {
    const s = sel(), [a, b] = XCW.order(s.a, s.f);
    if (!cmp(a, b)) {
      if (XW.mode === 'hq') { HQ.focus(); document.execCommand({ b: 'bold', i: 'italic', u: 'underline', sup: 'superscript', sub: 'subscript' }[key]); return; }
      const like = XCW.toCells(XW.doc[a.p])[a.o - 1] || {};
      XW.pend[key] = XW.pend[key] === undefined ? (like[key] ? 0 : 1) : XW.pend[key] ? 0 : 1;
      if (XW.pend[key] && (key === 'sup' || key === 'sub')) XW.pend[key === 'sup' ? 'sub' : 'sup'] = 0;
      updateTools(); return;
    }
    snapshot(true);
    XCW.styleRange(XW.doc, a, b, key, !XCW.hasStyle(XW.doc, a, b, key));
    refresh(s);
  }
  // typeface per paragraph (docs/FONT.md): the face of every paragraph touched by the selection; '' = standard
  XW.setFont = (name) => {
    const s = sel(), [a, b] = XCW.order(s.a, s.f);
    snapshot(true);
    for (let p = a.p; p <= b.p; p++) {
      if (name) XW.doc[p].font = name; else { delete XW.doc[p].font; if (XW.page && XCW.Page.resolve(XW.doc, XW.page)[p].face) XW.doc[p].font = 'ROM'; }
    }
    XW.dirty = true; refresh(s);
  };
  // ---------- styles and sections (docs/FONT.md): default < section font < role style < paragraph font/size ----------
  const SZ = XCW.Page.SIZES, RL = XCW.Page.ROLES, RLAB = XCW.Page.ROLE_LABEL;
  const DEF_STYLES = { title: { size: 12, b: 1, align: 'c', space: 1 }, h1: { size: 10, b: 1, space: 1 }, h2: { size: 8, b: 1, space: 1 }, h3: { size: 8, i: 1 }, cap: { size: 6, i: 1 } };
  function ensurePage() {
    if (!XW.page) XW.page = XCW.Page.normalize({});
    if (!Object.keys(XW.page.styles || {}).length) XW.page.styles = JSON.parse(JSON.stringify(DEF_STYLES));
    return XW.page;
  }
  const faceOpts = (blank) => '<option value="">' + blank + '</option><option value="ROM">Standard (ACWriter 4x7)</option>' + [...$('pgfont').options].filter((o) => o.value).map((o) => '<option value="' + o.value + '">' + esc(o.textContent) + '</option>').join('') + [...$('pgfont').querySelectorAll('optgroup')].map((g) => '').join('');
  const sizeOpts = (auto) => '<option value="0">' + auto + '</option>' + SZ.map((z) => '<option value="' + z + '">' + z + ' px cell</option>').join('');
  const faceNote = (f) => (!f || f === 'ROM' ? 'Standard face: one size (4x7 cell).' : /^craft\d+$/i.test(f) ? 'Craft faces exist in every cell size: ' + SZ.join('/') + '.' : f + ' has a single size; a size choice leaves it unchanged.');
  XW.styleUi = function () {
    const s = sel(), [a, b] = XCW.order(s.a, s.f), para = XW.doc[Math.min(a.p, XW.doc.length - 1)]; if (!para) return;
    const RF = XCW.Page.resolve(XW.doc, XW.page || {}), secs = XCW.Page.sections(XW.doc, XW.page || {});
    $('pgrole').innerHTML = RL.map((r) => '<option value="' + r + '">' + RLAB[r] + '</option>').join(''); $('pgrole').value = para.role || '';
    $('pgsize').innerHTML = sizeOpts('Auto'); $('pgsize').value = String(para.size || 0);
    const cur = $('secfont').value; $('secfont').innerHTML = faceOpts('Document default'); const sec = secs.find((q) => a.p >= q.start && a.p <= q.end) || secs[0];
    $('secfont').value = sec ? sec.font : '';
    $('seclist').innerHTML = secs.map((q, i) => '<option value="' + q.start + '"' + (q === sec ? ' selected' : '') + '>' + (i + 1) + '/' + secs.length + ': ' + esc(q.font === 'ROM' ? 'Standard' : q.font || 'document default') + ' (para ' + (q.start + 1) + (q.end > q.start ? '-' + (q.end + 1) : '') + ')</option>').join('');
    $('sizenote').textContent = faceNote(RF[a.p] && RF[a.p].face) + (RF[a.p] && RF[a.p].role ? '' : '');
    void cur;
  };
  const doStyle = (fn) => { const s = sel(), [a, b] = XCW.order(s.a, s.f); snapshot(true); ensurePage(); fn(a, b); XW.dirty = true; XW.useFaces(); refresh(s); XW.styleUi(); };
  $('pgrole').onchange = () => doStyle((a, b) => XCW.setRole(XW.doc, a.p, b.p, $('pgrole').value, XW.page.styles));
  $('pgsize').onchange = () => doStyle((a, b) => XCW.setParaSize(XW.doc, a.p, b.p, +$('pgsize').value));
  $('secfont').onchange = () => doStyle((a, b) => XCW.setSectionFontRange(XW.doc, a.p, b.p, $('secfont').value));
  $('secbrk').onclick = () => {
    const s = sel(), [a] = XCW.order(s.a, s.f); snapshot(true); ensurePage();
    const np = XCW.sectionBreak(XW.doc, a); XW.dirty = true; refresh({ a: np, f: np }); XW.styleUi(); toast('New section starts at paragraph ' + (np.p + 1) + ' (inherits the font)');
  };
  $('seclist').onchange = () => { const p = +$('seclist').value, pos = { p, o: 0 }; cur().load(XW.doc, { a: pos, f: pos }); cur().focus(); XW.styleUi(); };
  $('pgstyles').onclick = () => {
    ensurePage(); const pg = XW.page, st = pg.styles;
    const row = (r) => { const q = st[r] || {}; return '<tr><td>' + RLAB[r] + '</td><td><select data-r="' + r + '" data-k="face">' + faceOpts('Follow section') + '</select></td><td><select data-r="' + r + '" data-k="size">' + sizeOpts('Auto') + '</select></td><td><input type="checkbox" data-r="' + r + '" data-k="b"></td><td><input type="checkbox" data-r="' + r + '" data-k="i"></td><td><select data-r="' + r + '" data-k="align"><option value="">-</option><option value="l">L</option><option value="c">C</option><option value="r">R</option><option value="j">J</option></select></td><td><input type="number" min="0" max="3" data-r="' + r + '" data-k="space" style="width:48px"></td></tr>'; };
    modal('<h3>Styles</h3><label>Document default font</label><select id="sdf">' + faceOpts('Standard (ACWriter 4x7)') + '</select><div class="dim">Order of precedence: default &lt; section font &lt; style &lt; paragraph font/size. A line never mixes faces or sizes. ' + faceNote('craft8') + '</div><table style="width:100%;margin-top:8px"><tr><th></th><th>Face</th><th>Size</th><th>B</th><th>I</th><th>Align</th><th>Space</th></tr>' + RL.filter((r) => r).map(row).join('') + '</table><div class="row"><button id="scancel">Cancel</button><button id="sok" class="primary">OK</button></div>');
    $('sdf').value = pg.dfont || pg.font || '';
    for (const e of $('dlg').querySelectorAll('[data-r]')) { const q = st[e.dataset.r] || {}, v = q[e.dataset.k]; if (e.type === 'checkbox') e.checked = !!v; else e.value = v === undefined ? (e.dataset.k === 'size' ? '0' : '') : String(v); }
    $('scancel').onclick = closeModal;
    $('sok').onclick = () => {
      const s = sel(); snapshot(true); const ns = {};
      for (const e of $('dlg').querySelectorAll('[data-r]')) { const r = e.dataset.r, k = e.dataset.k; ns[r] = ns[r] || {}; const v = e.type === 'checkbox' ? (e.checked ? 1 : 0) : e.value; if (k === 'size' || k === 'space') ns[r][k] = +v || 0; else if (e.type === 'checkbox') ns[r][k] = v; else if (v) ns[r][k] = v; }
      pg.dfont = $('sdf').value; pg.font = ''; pg.styles = ns; XW.dirty = true; closeModal(); XW.useFaces(); refresh(s); XW.styleUi();
    };
  };
  function setAlign(al) {
    const s = sel(), [a, b] = XCW.order(s.a, s.f);
    snapshot(true);
    for (let p = a.p; p <= b.p; p++) XW.doc[p].align = al;
    refresh(s);
  }
  function toggleBullet() {
    const s = sel(), [a, b] = XCW.order(s.a, s.f), on = !XW.doc[a.p].bullet;
    snapshot(true);
    for (let p = a.p; p <= b.p; p++) XW.doc[p].bullet = on;
    refresh(s);
  }
  XW.typingStyle = (doc, pos) => {
    if (!Object.keys(XW.pend).length) return undefined;
    const like = XCW.toCells(doc[pos.p])[pos.o - 1] || {}, s = {};
    for (const k of KEYS) s[k] = XW.pend[k] !== undefined ? XW.pend[k] : like[k] || 0;
    return s;
  };
  XW.selChanged = () => {
    const s = sel(), key = s.f.p + ':' + s.f.o;
    if (isAt() && key !== XW.lastKey) XW.pend = {};
    XW.lastKey = key; updateTools(); updateStatus();
  };
  function updateTools() {
    const s = sel(), [a, b] = XCW.order(s.a, s.f);
    for (const k of KEYS) {
      let on = XCW.hasStyle(XW.doc, a, b, k);
      if (!cmp(a, b) && isAt() && XW.pend[k] !== undefined) on = !!XW.pend[k];
      if (!cmp(a, b) && XW.mode === 'hq') { try { on = document.queryCommandState({ b: 'bold', i: 'italic', u: 'underline', sup: 'superscript', sub: 'subscript' }[k]); } catch (e) { /* ignore */ } }
      $('tb-' + k).classList.toggle('on', on);
    }
    const para = XW.doc[Math.min(a.p, XW.doc.length - 1)];
    if (para) {
      for (const al of ['l', 'c', 'r', 'j']) $('tb-' + al).classList.toggle('on', para.align === al); $('tb-bul').classList.toggle('on', !!para.bullet);
      const fs = $('pgfont'), pf = (XCW.Page.resolve(XW.doc, XW.page || {})[Math.min(a.p, XW.doc.length - 1)] || {}).face || ''; if (fs.value !== pf && [...fs.options].some((o) => o.value === pf)) fs.value = pf;
      if (XW.mode === 'page' && XW.styleUi) XW.styleUi();
    }
  }
  // load the faces a document uses as soon as it is opened, so every view can draw them
  XW.useFaces = () => { for (const r of XCW.Page.resolve(XW.doc, XW.page || {})) if (r.face) XFACE.use(r.face); };
  XFACE.onChange(() => { XW.useFaces(); updateTools(); });
  for (const k of KEYS) $('tb-' + k).onmousedown = (e) => { e.preventDefault(); toggle(k); };
  for (const al of ['l', 'c', 'r', 'j']) $('tb-' + al).onmousedown = (e) => { e.preventDefault(); setAlign(al); };
  $('tb-bul').onmousedown = (e) => { e.preventDefault(); toggleBullet(); };
  $('tb-undo').onmousedown = (e) => { e.preventDefault(); doUndo(false); };
  $('tb-redo').onmousedown = (e) => { e.preventDefault(); doUndo(true); };
  $('tb-find').onclick = () => openFind();
  $('tb-spell').onclick = () => { XW.spellOn = !XW.spellOn; $('tb-spell').classList.toggle('on', XW.spellOn); runSpell(); };

  XW.key = (e) => {
    const ctl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (!ctl) return false;
    const go = (f) => { e.preventDefault(); f(); return true; };
    if (k === 'b') return go(() => toggle('b'));
    if (k === 'i') return go(() => toggle('i'));
    if (k === 'u') return go(() => toggle('u'));
    if (k === 'z') return go(() => doUndo(e.shiftKey));
    if (k === 'y') return go(() => doUndo(true));
    if (k === 'f') return go(openFind);
    if (k === 's') return go(saveDialog);
    if (k === 'o') return go(() => $('filein').click());
    if (k === 'a' && isAt()) return go(() => cur().setSel({ p: 0, o: 0 }, XCW.docEnd(XW.doc)));
    return false;
  };

  // ---------- clipboard ----------
  function sanitizeFrag(frag) { return isAt() ? atariSanitize(frag) : XCW.normalize(frag); }
  function replaceSel(frag) {
    const s = sel(), [a, b] = XCW.order(s.a, s.f);
    snapshot(true);
    let pos = a;
    if (cmp(a, b)) pos = XCW.deleteRange(XW.doc, a, b);
    pos = XCW.insertFragment(XW.doc, pos, frag);
    XW.doc = XCW.normalize(XW.doc);
    refresh({ a: pos, f: pos });
  }
  XW.pasteData = (dt) => {
    const text = dt.getData('text/plain'), html = dt.getData('text/html');
    let frag;
    if (XW.clip && XW.clip.text === text) frag = JSON.parse(JSON.stringify(XW.clip.frag));
    else if (html && XW.mode === 'hq') { try { frag = XCW.openDoc(enc.encode(html), 'paste.html', { format: 'html' }).paras; } catch (e) { frag = null; } }
    if (!frag) frag = text.replace(/\r\n?/g, '\n').split('\n').map((t) => ({ align: 'l', bullet: false, runs: t ? [{ t, b: 0, i: 0, u: 0, sup: 0, sub: 0 }] : [] }));
    replaceSel(sanitizeFrag(frag));
  };
  XW.copyData = (dt, cut) => {
    const s = sel(), [a, b] = XCW.order(s.a, s.f);
    if (!cmp(a, b)) return;
    const frag = XCW.getFragment(XW.doc, a, b), text = frag.map(XCW.ptext).join('\n');
    dt.setData('text/plain', text);
    if (XW.mode === 'hq') dt.setData('text/html', dec.decode(XCW.save(frag, 'html').bytes));
    XW.clip = { text, frag };
    if (cut) { snapshot(true); const p = XCW.deleteRange(XW.doc, a, b); refresh({ a: p, f: p }); }
  };
  HQ.el.addEventListener('copy', (e) => { e.preventDefault(); XW.copyData(e.clipboardData, false); });
  HQ.el.addEventListener('cut', (e) => { e.preventDefault(); XW.copyData(e.clipboardData, true); });
  HQ.onChange(() => { changed(); updateTools(); });

  // ---------- spell check ----------
  let spellT;
  function scheduleSpell() { clearTimeout(spellT); spellT = setTimeout(runSpell, 250); }
  function runSpell() {
    XW.misses = XW.spellOn ? XCW.spellCheck(dict, XW.doc, XW.ignore) : [];
    XW.missSet = new Set();
    for (const m of XW.misses) for (let o = m.start; o < m.end; o++) XW.missSet.add(m.p * 100000 + o);
    if (XW.mode === 'hq') HQ.mark('xcw-miss', XW.misses); else cur().render();
    updateStatus();
  }
  XW.missAt = (p, o) => XW.missSet.has(p * 100000 + o);

  const ctxEl = $('ctx');
  ctxEl.addEventListener('mousedown', (e) => e.preventDefault());
  function hideCtx() { ctxEl.style.display = 'none'; }
  document.addEventListener('mousedown', (e) => { if (!ctxEl.contains(e.target)) hideCtx(); });
  // Custom menu only where it is relevant: the editor surfaces and the recent-documents list. Everything else keeps the browser menu.
  function showCtx(e, items) {
    ctxEl.innerHTML = '';
    for (const it of items) {
      if (it === '-') { ctxEl.append(document.createElement('hr')); continue; }
      const d = document.createElement('div'); d.textContent = it.label;
      if (it.dis) d.className = 'dis'; else d.onclick = () => { hideCtx(); it.fn(); };
      ctxEl.append(d);
    }
    ctxEl.style.display = 'block';
    ctxEl.style.left = Math.max(0, Math.min(e.clientX, innerWidth - ctxEl.offsetWidth - 6)) + 'px'; ctxEl.style.top = Math.max(0, Math.min(e.clientY, innerHeight - ctxEl.offsetHeight - 10)) + 'px';
  }
  // History only: recent documents, last-used save format, find box, undo/redo. Documents, saved fonts and the user dictionary stay.
  function clearHistory() {
    LS.set('xcw.recent', []); try { localStorage.removeItem('xcw.fmt'); } catch (x) { /* storage unavailable */ }
    XW.undo = []; XW.redo = []; XW.pend = {}; XW.cleared = XW.id;
    for (const i of document.querySelectorAll('#findbar input[type=text],#findbar input:not([type])')) i.value = '';
    if (XW.find) XW.find.matches = [];
    if ($('fq')) findAll();
    renderRecent(); toast('History cleared');
  }
  XW.clearHistory = clearHistory;
  const clipDt = () => ({ d: {}, setData(k, v) { this.d[k] = v; }, getData(k) { return this.d[k] || ''; } });
  const copyCut = async (cut) => {
    const dt = clipDt(); XW.copyData(dt, cut);
    try { if (dt.d['text/plain']) await navigator.clipboard.writeText(dt.d['text/plain']); } catch (x) { /* internal clipboard still works */ }
  };
  const pasteIn = async () => {
    let text = null; try { text = await navigator.clipboard.readText(); } catch (x) { text = XW.clip ? XW.clip.text : null; }
    if (text) XW.pasteData({ getData: (k) => (k === 'text/plain' ? text : '') });
  };
  XW.contextMenu = (e, pos) => {
    e.preventDefault();
    const s = sel(), has = !!cmp(...XCW.order(s.a, s.f));
    const m = pos && XW.misses.find((x) => x.p === pos.p && pos.o >= x.start && pos.o <= x.end);
    const items = [];
    if (m) {
      const sug = XCW.suggest(dict, m.word);
      items.push({ label: '"' + m.word + '" is not in the dictionary', dis: 1 });
      if (sug.length) sug.forEach((w) => items.push({ label: w, fn: () => {
        snapshot(true);
        XCW.deleteRange(XW.doc, { p: m.p, o: m.start }, { p: m.p, o: m.end });
        const np = XCW.insertText(XW.doc, { p: m.p, o: m.start }, isAt() ? atariSanitize([{ align: 'l', bullet: false, runs: [{ t: w, b: 0, i: 0, u: 0, sup: 0, sub: 0 }] }])[0].runs[0].t : w);
        refresh({ a: np, f: np });
      } })); else items.push({ label: '(no suggestions)', dis: 1 });
      items.push({ label: 'Ignore all', fn: () => { XW.ignore.add(m.word.toLowerCase()); runSpell(); } });
      items.push({ label: 'Add to my dictionary', fn: () => { XW.ignore.add(m.word.toLowerCase()); LS.set('xcw.ignore', [...XW.ignore]); runSpell(); toast('Added "' + m.word + '"'); } });
      items.push('-');
    }
    items.push({ label: 'Cut', dis: !has, fn: () => copyCut(true) }, { label: 'Copy', dis: !has, fn: () => copyCut(false) }, { label: 'Paste', fn: pasteIn },
      { label: 'Select all', fn: () => refresh({ a: { p: 0, o: 0 }, f: XCW.docEnd(XW.doc) }) }, '-',
      { label: 'Clear undo history', dis: !XW.undo.length && !XW.redo.length, fn: () => { XW.undo = []; XW.redo = []; XW.pend = {}; toast('Undo history cleared'); } },
      { label: 'Clear history', fn: clearHistory });
    showCtx(e, items);
  };
  // ---------- status / Atari side panel ----------
  function words(doc) { const t = XCW.plain(doc); return { w: (t.match(/\S+/g) || []).length, c: t.replace(/\n/g, '').length }; }
  function updateStatus() {
    const n = words(XW.doc), s = sel();
    $('st-words').innerHTML = '<b>' + n.w + '</b> words, <b>' + n.c + '</b> characters';
    $('st-pos').textContent = 'Paragraph ' + (s.f.p + 1) + '/' + XW.doc.length + ', char ' + (s.f.o + 1) + (XW.misses.length ? ' | ' + XW.misses.length + ' spelling' : '');
    const f = XCW.fit(XW.doc, undefined, XW.mode === 'page' ? XW.page : null);
    $('st-fit').textContent = 'Fits in ACWriter: ' + (f.bytes / 1024).toFixed(1) + ' of ~11 KB' + (f.over ? ' (OVER by ' + f.over + ' bytes)' : '');
    $('st-fit').classList.toggle('over', !!f.over);
    $('st-mode').textContent = isAt() ? (XW.mode === 'page' ? 'PAGE VIEW' : 'ATARI MATCHING') : 'HIGH QUALITY';
    $('docname').innerHTML = '<b>' + esc(XW.name) + '</b>' + (XW.sourceFormat ? ' &middot; opened as ' + esc(XW.sourceFormat) : '') + (XW.dirty ? ' &middot; edited' : '');
  }
  XW.modal = modal; XW.closeModal = closeModal; XW.toast = toast;
  XW.pageChanged = () => { XW.dirty = true; XW.warnVer = -1; scheduleSave(); refreshAll(); };
  XW.atariInfo = (f) => {
    $('fittext').innerHTML = '<b>' + (f.bytes / 1024).toFixed(1) + ' KB</b> of ~11 KB (' + f.bytes + ' / ' + f.limit + ' bytes, ' + f.pct + '%)';
    const m = $('meter'); m.className = 'meter' + (f.over ? ' over' : f.pct > 85 ? ' warn' : ''); m.firstElementChild.style.width = Math.min(100, f.pct) + '%';
    if (XW.warnVer !== XW.docVer) { XW.warnVer = XW.docVer; XW.warns = XCW.atariWarnings(XW.doc).concat(NOTES); $('warns').innerHTML = XW.warns.map((w) => '<li>' + esc(w) + '</li>').join(''); }
    updateStatusFit(f);
  };
  function updateStatusFit(f) { $('st-fit').textContent = 'Fits in ACWriter: ' + (f.bytes / 1024).toFixed(1) + ' of ~11 KB' + (f.over ? ' (OVER by ' + f.over + ' bytes)' : ''); $('st-fit').classList.toggle('over', !!f.over); }

  // ---------- documents, recents ----------
  function loadDoc(paras, name, fmt, notes, page) {
    XW.page = page || (XW.mode === 'page' ? XCW.Page.normalize({}) : null);
    XW.doc = XCW.normalize(paras); XW.name = name; XW.sourceFormat = fmt || null; XW.id = 'd' + Date.now(); XW.dirty = false;
    XW.undo = []; XW.redo = []; XW.pend = {};
    if (isAt()) XW.doc = atariSanitize(XW.doc);
    screen('editor');
    cur().load(XW.doc, { a: { p: 0, o: 0 }, f: { p: 0, o: 0 } });
    refreshAll(); XW.useFaces();
    saveRecent();
    if (notes && notes.length) toast(notes.join('; '), 6000);
  }
  function newDoc() { loadDoc(XCW.newDoc(), 'Untitled', null); cur().focus(); }
  let saveT;
  function scheduleSave() { XW.cleared = null; clearTimeout(saveT); saveT = setTimeout(saveRecent, 1500); }
  function saveRecent() {
    if (!XW.id || XW.cleared === XW.id) return;
    const text = XCW.plain(XW.doc);
    if (!text.trim() && !XW.dirty) return;
    let list = LS.get('xcw.recent', []).filter((r) => r.id !== XW.id);
    list.unshift({ id: XW.id, name: XW.name, t: Date.now(), fmt: XW.sourceFormat, preview: text.slice(0, 160), doc: XW.doc });
    list = list.slice(0, 8);
    let saved = LS.set('xcw.recent', list);
    while (!saved && list.length > 1) { list.pop(); saved = LS.set('xcw.recent', list); }
  }
  function renderRecent() {
    const list = LS.get('xcw.recent', []), box = $('recent');
    box.innerHTML = list.length ? '' : '<span class="dim">Nothing yet. Documents you open or write are remembered here (in this browser only).</span>';
    list.forEach((r) => {
      const d = document.createElement('div'); d.className = 'card';
      d.innerHTML = '<b>' + esc(r.name) + '</b><small>' + new Date(r.t).toLocaleString() + (r.fmt ? ' &middot; ' + esc(r.fmt) : '') + '</small><p>' + esc(r.preview) + '</p>';
      d.onclick = () => { loadDoc(r.doc, r.name, r.fmt); XW.id = r.id; };
      d.dataset.id = r.id;
      box.append(d);
    });
  }
  $('recent').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const card = e.target.closest('.card'), items = [];
    if (card) items.push({ label: 'Remove from list', fn: () => { LS.set('xcw.recent', LS.get('xcw.recent', []).filter((r) => r.id !== card.dataset.id)); renderRecent(); } });
    items.push({ label: 'Clear history', fn: clearHistory });
    showCtx(e, items);
  });

  // ---------- open ----------
  const KNOWN = /\.(xcw|cwd|txt|text|atx|rtf|html?|md|markdown|docx|doc|atr)$/i;
  const readFile = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(new Uint8Array(r.result)); r.onerror = no; r.readAsArrayBuffer(f); });
  async function openFile(f, force) {
    const buf = await readFile(f);
    if (force || !KNOWN.test(f.name)) { chooseFormat(f.name, buf); return; }
    openBuf(buf, f.name, 'auto');
  }
  function openBuf(buf, name, fmt) {
    try {
      const r = XCW.openDoc(buf, name, { format: fmt });
      loadDoc(r.paras, baseName(name), r.format, r.notes, r.page);
    } catch (err) { toast('Could not open ' + name + ': ' + err.message, 6000); }
  }
  function chooseFormat(name, buf) {
    let guess = 'auto';
    try { guess = XCW.detect(buf, name); } catch (e) { /* ignore */ }
    modal('<h3>Open ' + esc(name) + '</h3><div class="dim">The format could not be recognised from the file name. Pick how to read it (the Atari word processors cannot be detected reliably).</div><label>Read as</label><select id="ofmt">' + XCW.OPEN_FORMATS.map((f) => '<option value="' + f.id + '"' + (f.id === 'auto' ? ' selected' : '') + '>' + esc(f.label) + (f.id === guess && f.id !== 'auto' ? ' (detected)' : '') + '</option>').join('') + '</select><div class="row"><button id="ocancel">Cancel</button><button class="on" id="ook">Open</button></div>');
    $('ocancel').onclick = closeModal;
    $('ook').onclick = () => { const v = $('ofmt').value; closeModal(); openBuf(buf, name, v); };
  }
  async function openFiles(list, force) { if (list && list.length) await openFile(list[0], force); }
  $('filein').onchange = (e) => { openFiles(e.target.files, e.shiftKey); e.target.value = ''; };
  const pick = (e) => { $('filein').click(); };
  $('bopen').onclick = pick; $('hopen').onclick = pick;
  ['dragenter', 'dragover'].forEach((t) => window.addEventListener(t, (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); document.body.classList.add('dragging'); } }));
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
  window.addEventListener('drop', (e) => { e.preventDefault(); document.body.classList.remove('dragging'); openFiles(e.dataTransfer.files, e.shiftKey); });

  // ---------- save / export ----------
  function saveDialog() {
    const def = isAt() ? 'cwd' : LS.get('xcw.fmt', 'rtf');
    modal('<h3>Save / export</h3><label>Format</label><select id="sfmt">' + XCW.SAVE_FORMATS.map((f) => '<option value="' + f.id + '"' + (f.id === def ? ' selected' : '') + '>' + esc(f.label) + '</option>').join('') + '</select><label>File name</label><input type="text" id="sname" value="' + esc(XW.name) + '"><div id="srep"></div><div class="row"><button id="scancel">Close</button><button class="on" id="sok">Download</button></div>');
    const upd = () => { const r = XCW.save(XW.doc, $('sfmt').value, pgOpt()); $('srep').innerHTML = '<label>What this format cannot keep</label>' + repHtml(r.report); };
    $('sfmt').onchange = upd; upd();
    $('scancel').onclick = closeModal;
    $('sok').onclick = () => {
      const fmt = $('sfmt').value, r = XCW.save(XW.doc, fmt, pgOpt()), nm = ($('sname').value || 'Untitled').replace(/[\\/:*?"<>|]/g, '_');
      LS.set('xcw.fmt', fmt);
      download(r.bytes, nm.replace(/\.[^.]*$/, '') + '.' + r.ext, r.mime);
      if (nm) XW.name = nm.replace(/\.[^.]*$/, '');
      XW.dirty = false; updateStatus(); saveRecent(); closeModal();
      toast('Saved ' + nm + '.' + r.ext + (r.report.length ? ' (' + r.report.length + ' note(s))' : ''));
    };
  }
  $('bsave').onclick = saveDialog;

  // ---------- convert ----------
  function convertDialog() {
    modal('<h3>Convert a file</h3><label>Input file</label><input type="file" id="cfile"><label>Read as</label><select id="cin">' + XCW.OPEN_FORMATS.map((f) => '<option value="' + f.id + '">' + esc(f.label) + '</option>').join('') + '</select><label>Convert to</label><select id="cout">' + XCW.SAVE_FORMATS.map((f) => '<option value="' + f.id + '">' + esc(f.label) + '</option>').join('') + '</select><div id="crep"></div><div class="row"><button id="cclose">Close</button><button id="cedit" disabled>Open in editor</button><button class="on" id="cgo" disabled>Convert and download</button></div>');
    let buf = null, name = '', last = null;
    const run = (dl) => {
      if (!buf) return;
      try {
        const o = XCW.openDoc(buf, name, { format: $('cin').value }), r = XCW.save(o.paras, $('cout').value);
        last = o; const out = baseName(name) + '.' + r.ext;
        if (dl) download(r.bytes, out, r.mime);
        $('crep').innerHTML = '<label>' + (dl ? 'Converted to ' + esc(out) : 'Preview') + ' (read as ' + esc(o.format) + ', ' + r.bytes.length + ' bytes)</label>' + repHtml(o.notes.concat(r.report));
        $('cedit').disabled = false;
      } catch (err) { $('crep').innerHTML = '<ul class="rep"><li>Failed: ' + esc(err.message) + '</li></ul>'; }
    };
    $('cfile').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; buf = await readFile(f); name = f.name; $('cgo').disabled = false; run(false); };
    $('cin').onchange = () => run(false); $('cout').onchange = () => run(false);
    $('cgo').onclick = () => run(true);
    $('cedit').onclick = () => { if (last) { closeModal(); loadDoc(last.paras, baseName(name), last.format, last.notes); } };
    $('cclose').onclick = closeModal;
  }
  $('bconv').onclick = convertDialog; $('hconv').onclick = convertDialog;
  XW.convert = (buf, name, from, to) => { const o = XCW.openDoc(buf, name, { format: from }); return XCW.save(o.paras, to); };

  // ---------- find / replace ----------
  function findAll() {
    const q = $('fq').value, cs = $('fcase').checked, out = [];
    if (q) XW.doc.forEach((p, pi) => {
      const t = cs ? XCW.ptext(p) : XCW.ptext(p).toLowerCase(), n = cs ? q : q.toLowerCase();
      for (let i = t.indexOf(n); i >= 0; i = t.indexOf(n, i + Math.max(1, n.length))) out.push({ p: pi, start: i, end: i + n.length });
    });
    XW.find.matches = out;
    $('fcount').textContent = q ? out.length + ' match(es)' : '';
    if (XW.mode === 'hq') HQ.mark('xcw-find', out);
    return out;
  }
  function openFind() { $('findbar').classList.add('on'); $('fq').focus(); $('fq').select(); findAll(); }
  function gotoMatch(dir) {
    const ms = findAll(); if (!ms.length) return;
    const s = sel(), [a, b] = XCW.order(s.a, s.f), from = dir > 0 ? b : a;
    let m = dir > 0 ? ms.find((x) => cmp({ p: x.p, o: x.start }, from) >= 0 && (cmp({ p: x.p, o: x.start }, a) > 0 || cmp(a, b) === 0 || true) && cmp({ p: x.p, o: x.start }, from) >= 0) : [...ms].reverse().find((x) => cmp({ p: x.p, o: x.end }, from) <= 0);
    if (dir > 0 && m && cmp(a, b) && m.p === a.p && m.start === a.o) m = ms.find((x) => cmp({ p: x.p, o: x.start }, b) >= 0 && !(x.p === a.p && x.start === a.o));
    if (!m) m = dir > 0 ? ms[0] : ms[ms.length - 1];
    cur().setSel({ p: m.p, o: m.start }, { p: m.p, o: m.end });
    if (isAt()) cur().render();
  }
  $('fnext').onclick = () => gotoMatch(1); $('fprev').onclick = () => gotoMatch(-1);
  $('fq').oninput = () => { findAll(); }; $('fcase').onchange = findAll;
  $('fq').onkeydown = (e) => { if (e.key === 'Enter') gotoMatch(e.shiftKey ? -1 : 1); if (e.key === 'Escape') $('fclose').click(); };
  $('fclose').onclick = () => { $('findbar').classList.remove('on'); if (XW.mode === 'hq') HQ.mark('xcw-find', []); cur().focus(); };
  function replaceAt(m, text) {
    XCW.deleteRange(XW.doc, { p: m.p, o: m.start }, { p: m.p, o: m.end });
    return XCW.insertText(XW.doc, { p: m.p, o: m.start }, isAt() ? atariSanitize([{ align: 'l', bullet: false, runs: [{ t: text, b: 0, i: 0, u: 0, sup: 0, sub: 0 }] }])[0].runs[0].t : text);
  }
  $('frep').onclick = () => {
    const s = sel(), [a, b] = XCW.order(s.a, s.f), ms = findAll(), m = ms.find((x) => x.p === a.p && x.start === a.o && x.end === b.o);
    if (!m) { gotoMatch(1); return; }
    snapshot(true); const p = replaceAt(m, $('fr').value); XW.doc = XCW.normalize(XW.doc); refresh({ a: p, f: p }); gotoMatch(1);
  };
  $('frall').onclick = () => {
    const ms = findAll(); if (!ms.length) return;
    snapshot(true);
    for (let k = ms.length - 1; k >= 0; k--) replaceAt(ms[k], $('fr').value);
    XW.doc = XCW.normalize(XW.doc); refresh(); findAll(); toast('Replaced ' + ms.length);
  };

  // ---------- Send to Atari ----------
  const bc = window.BroadcastChannel ? new BroadcastChannel('xcwriter') : null;
  function sendAtari() {
    const r = XCW.save(XW.doc, 'cwd', pgOpt()), nm = (hostName(XW.name.replace(/\.[^.]*$/, '')).replace(/\./g, '').slice(0, 8) || 'DOC') + '.CWD';
    if (!bc) { toast('BroadcastChannel is not available: save the .xcw and add it to H: in the emulator'); return; }
    let answered = false;
    bc.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'pong') {
        answered = true;
        if (!m.booted) { toast('The emulator tab is open but not booted. Boot it, then send again.', 6000); return; }
        bc.postMessage({ type: 'hostWrite', name: nm, bytes: Array.from(r.bytes) });
      } else if (m.type === 'result') toast(m.ok ? 'Sent as H:' + m.name + '. In ACWriter use File > Open and type H:' + m.name : 'Not sent: ' + m.msg, 7000);
    };
    bc.postMessage({ type: 'ping' });
    setTimeout(() => { if (!answered) toast('No emulator tab found. Open the main page (index.html) in this browser, boot ACWriter, and try again. Or save the .xcw and import it into the H: panel.', 8000); }, 900);
  }
  $('tb-send').onclick = sendAtari;

  // ---------- font controls, theme ----------
  const FONTS = [['Georgia (serif)', 'Georgia,serif'], ['Times New Roman', '"Times New Roman",Times,serif'], ['Palatino', '"Palatino Linotype",Palatino,serif'], ['Cambria', 'Cambria,Georgia,serif'], ['Segoe UI', '"Segoe UI",system-ui,sans-serif'], ['Calibri', 'Calibri,"Segoe UI",sans-serif'], ['Arial', 'Arial,Helvetica,sans-serif'], ['Verdana', 'Verdana,sans-serif'], ['Courier New', '"Courier New",monospace'], ['Consolas', 'Consolas,monospace']];
  $('fontsel').innerHTML = FONTS.map((f, i) => '<option value="' + i + '">' + esc(f[0]) + '</option>').join('');
  $('sizesel').innerHTML = [10, 11, 12, 13, 14, 16, 18, 20].map((s) => '<option' + (s === 12 ? ' selected' : '') + '>' + s + '</option>').join('');
  const applyFont = () => HQ.setFont(FONTS[$('fontsel').value][1], $('sizesel').value, $('spacesel').value);
  $('fontsel').onchange = $('sizesel').onchange = $('spacesel').onchange = applyFont;
  $('atview').onchange = () => { AT.setView2($('atview').value === '2'); AT.focus(); };
  $('themesel').onchange = () => { AT.setTheme($('themesel').value); PG.setTheme($('themesel').value); };
  $('scalesel').onchange = () => { const k = +$('scalesel').value; AT.canvas.style.width = 320 * k + 'px'; AT.canvas.style.height = 192 * k + 'px'; };

  // ---------- help, nav ----------
  $('helpdoc').innerHTML = `<h2>xCWriter help</h2>
<p>xCWriter (eXtreme Craft Writer) writes, opens and converts documents for the Atari 8-bit ACWriter and for ordinary desktop word processors. Everything runs in your browser; no file leaves it.</p>
<h3>Two modes</h3>
<p><b>High quality</b> is a normal word processor page with proportional system fonts, real sizes and justification. <b>Atari matching</b> shows the document exactly as ACWriter will: 64 columns by 20 lines on a 320x192 screen with the ACWriter pixel font, the same word wrap as the .CWD exporter, and a live meter of how much of ACWriter's ~11 KB document area you use. Switching keeps the document. Entering matching mode turns characters the Atari lacks into look-alikes (curly quotes, dashes) or ?, which you can undo.</p>
<h3>Opening</h3>
<p>Open or drop: .xcw (or old .cwd), text, ATASCII (EOL $9B), RTF, HTML, Markdown, .docx, .doc (text only), Letter Perfect, PaperClip, First XLEnt, Text Wizard, Bank Street Writer files and Bank Street .ATR disk images. Files whose type is not recognised ask you how to read them; hold <kbd>Shift</kbd> when opening to always choose the format.</p>
<h3>Saving and converting</h3>
<p>Save offers .xcw, text, ATASCII, RTF, HTML, Markdown and .docx, and lists what the format cannot keep (for example bold in plain text). Convert changes a file without opening it in the editor. A .docx written here uses stored (uncompressed) zip parts and has only been checked by re-reading it, not in Microsoft Word.</p>
<h3>Send to Atari</h3>
<p>With the main app (index.html) open and booted in another tab of this browser, <b>Send to Atari</b> writes the document to the emulator's H: device as NAME.CWD (the name ACWriter's Open adds by itself). In ACWriter choose File &gt; Open and type <code>H:NAME.CWD</code>. Otherwise save the .xcw and add it in the main app's H: panel (open it as <code>H:NAME.XCW</code>).</p>
<h3>Keys</h3>
<table><tr><td><kbd>Ctrl</kbd>+<kbd>B</kbd> <kbd>I</kbd> <kbd>U</kbd></td><td>bold, italic, underline</td></tr><tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Y</kbd></td><td>undo, redo</td></tr><tr><td><kbd>Ctrl</kbd>+<kbd>F</kbd></td><td>find and replace</td></tr><tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd> / <kbd>O</kbd></td><td>save/export, open</td></tr><tr><td>right-click a red squiggle</td><td>spelling suggestions (dictionary: EN.CDC)</td></tr></table>
<h3>Limits</h3>
<p>The spell checker is a compact Bloom-filter dictionary: about 2% of misspellings are not flagged. Bold, italic and underline in matching mode are drawn approximately; the exported .xcw stores exact style codes. Font and size are not part of a .xcw.</p>`;
  $('logo').onclick = $('bhome').onclick = () => screen('home');
  $('bhelp').onclick = $('hhelp').onclick = () => screen('help');
  $('hnew').onclick = newDoc;
  $('hdemo').onclick = () => openBuf(b64(XCW_DATA.demo), 'ACWRITER-DEMO.XCW', 'auto');
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); hideCtx(); } });
  window.addEventListener('beforeunload', saveRecent);

  applyFont();
  $('tb-spell').classList.add('on');
  renderRecent();
  XW.api = { loadDoc, openBuf, setMode, screen, sendAtari, saveDialog, convertDialog, toggle, setAlign, toggleBullet, runSpell, openFind, gotoMatch, doUndo };
})();
