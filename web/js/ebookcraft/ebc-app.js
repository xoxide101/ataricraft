/* EBookCraft web app: wires ebookcraft.html to EBC.reader (reading) and EBC.pack (convert / deploy).
 * UI only; all format and pipeline logic lives in the ebc-*.js modules (shared with the Node CLI).
 * Storage (all local to the browser): localStorage  ebc.settings, ebc.pos.<bookid>, ebc.bm.<bookid>
 *                                     IndexedDB     ebookcraft/books  (bundle or original bytes, for the Shelf)
 */
(function () {
  'use strict';
  const EBC = window.EBC, B = EBC.base, $ = (id) => document.getElementById(id);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota */ } },
  };
  const st = { book: null, s: Object.assign({ size: 19, face: 'serif', theme: 'day', cols: 1 }, LS.get('ebc.settings', {})), panel: 'toc', inputs: [], lastBytes: null, result: null };
  const saveSettings = () => LS.set('ebc.settings', st.s);
  const fmtBytes = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';
  const dl = (name, bytes, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: type || 'application/octet-stream' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); };
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- IndexedDB shelf
  const idb = {
    db: null,
    open() {
      return this.db ? Promise.resolve(this.db) : new Promise((res, rej) => {
        const r = indexedDB.open('ebookcraft', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('books', { keyPath: 'id' });
        r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => rej(r.error);
      });
    },
    async tx(mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('books', mode), q = fn(t.objectStore('books')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); },
    put(rec) { return this.tx('readwrite', (s) => s.put(rec)); },
    all() { return this.tx('readonly', (s) => s.getAll()).then((a) => a || []); },
    get(id) { return this.tx('readonly', (s) => s.get(id)); },
    del(id) { return this.tx('readwrite', (s) => s.delete(id)); },
  };

  // ---------- reader
  const flow = $('flow'), view = $('view');
  const R = EBC.reader.create({ flow, view, onChange: onPos });

  function applySettings() {
    document.body.classList.remove('t-night', 't-sepia');
    if (st.s.theme !== 'day') document.body.classList.add('t-' + st.s.theme);
    flow.style.setProperty('--fs', st.s.size + 'px');
    document.getElementById('paper').style.setProperty('--fs', st.s.size + 'px');
    flow.style.fontSize = st.s.size + 'px';
    flow.style.fontFamily = st.s.faceCss || { serif: 'Georgia,"Times New Roman",serif', sans: 'system-ui,"Segoe UI",sans-serif', mono: 'ui-monospace,Consolas,monospace' }[st.s.face] || st.s.face;
    document.querySelectorAll('#theme button').forEach((b) => b.classList.toggle('on', b.dataset.t === st.s.theme));
    document.querySelectorAll('#colsel button').forEach((b) => b.classList.toggle('on', +b.dataset.c === st.s.cols));
  }
  async function initFaces() {
    const sel = $('face');
    sel.innerHTML = '<option value="serif">Serif</option><option value="sans">Sans</option><option value="mono">Mono</option>';
    let list = [];
    try { if (window.XFACE) { try { XFACE.init && XFACE.init(); } catch (e) { /* optional */ } list = (XFACE.list && XFACE.list()) || []; } } catch (e) { list = []; }
    if (list.length) {
      const og = el('optgroup'); og.label = 'Craft fonts';
      list.forEach((f) => { const o = el('option'); o.value = 'x:' + f.id; o.textContent = f.label || f.id; og.appendChild(o); });
      sel.appendChild(og);
    }
    sel.value = st.s.face; if (sel.value !== st.s.face) sel.value = 'serif';
    sel.onchange = async () => {
      const v = sel.value; st.s.face = v; st.s.faceCss = null;
      if (v.startsWith('x:')) {
        try { const f = XFACE.list().find((x) => 'x:' + x.id === v); const fam = await XFACE.hqFont(f); if (fam) st.s.faceCss = fam + ',serif'; } catch (e) { /* keep default */ }
      }
      saveSettings(); applySettings(); R.relayout();
    };
  }

  const bmKey = () => 'ebc.bm.' + st.book.id, posKey = () => 'ebc.pos.' + st.book.id;
  function onPos(p) {
    if (!st.book) return;
    $('pos').textContent = (p.atari ? 'Atari screen ' : 'Page ') + (p.page + 1) + ' / ' + p.pages + '   |   ' + (st.book.chapters[p.ch].title || tocTitle(p.ch) || 'Chapter ' + (p.ch + 1));
    $('prog').textContent = Math.round((p.overall || 0) * 100) + '%';
    const sl = $('slider'); sl.max = 1000; sl.value = Math.round((p.overall || 0) * 1000);
    if (p.atari) { R.drawAtari($('acv')); $('ainfo').textContent = '320x192 text screen, 64 columns x 23 rows, 4x7 Craft font. Same pages the Atari viewer shows.'; }
    LS.set(posKey(), { ch: p.ch, bi: p.bi });
    if (st.panel === 'toc') markToc(p);
  }
  const tocTitle = (ch) => { const t = st.book.toc.find((x) => x.ch === ch); return t && t.title; };

  async function openBytes(bytes, name) {
    try {
      let book;
      if (await EBC.pack.isBundle(bytes)) book = await EBC.pack.openBundle(bytes);
      else book = await EBC.book.open(bytes, name);
      st.book = book; st.lastBytes = { bytes, name };
      document.title = book.title + ' - EBookCraft';
      $('docname').innerHTML = '<b>' + esc(book.title) + '</b>' + (book.author ? ' - ' + esc(book.author) : '') + ' <span style="opacity:.7">(' + esc(book.format) + ', ' + (book.meta.words || 0).toLocaleString() + ' words)</span>';
      $('welcomeMsg') && $('welcomeMsg').remove();
      showTab('reader');
      R.load(book, LS.get(posKey(), null));
      setPanel('toc');
      idb.put({ id: book.id, title: book.title, author: book.author, name, bytes: B.u8(bytes), added: Date.now() }).then(renderShelfIfOpen).catch(() => {});
      if (book.warnings && book.warnings.length) console.warn(book.warnings);
    } catch (e) { alert('Cannot open ' + name + ': ' + e.message); console.error(e); }
  }
  async function openFile(f) { openBytes(new Uint8Array(await f.arrayBuffer()), f.name); }

  // ---------- side panels
  function setPanel(p) {
    st.panel = p;
    document.querySelectorAll('#sidetabs button').forEach((b) => b.classList.toggle('on', b.dataset.p === p));
    const body = $('sidebody'); body.innerHTML = '';
    if (p === 'shelf') return renderShelf();
    if (!st.book) { body.appendChild(el('div', 'empty', 'Open a book first.')); return; }
    if (p === 'toc') {
      st.book.toc.forEach((t) => {
        const a = el('a', 'it', esc(t.title)); a.style.paddingLeft = 8 + ((t.lvl || 1) - 1) * 14 + 'px'; a.dataset.ch = t.ch; a.dataset.bi = t.bi || 0;
        a.onclick = () => R.goto({ ch: t.ch, bi: t.bi || 0 }); body.appendChild(a);
      });
      markToc(R.pos());
    } else if (p === 'bm') {
      const l = LS.get(bmKey(), []);
      if (!l.length) body.appendChild(el('div', 'empty', 'No bookmarks yet. Press B or the Bookmark button.'));
      l.forEach((b, i) => {
        const a = el('a', 'it', esc(b.label) + '<small>' + new Date(b.t).toLocaleString() + '</small>');
        a.onclick = () => R.goto(b);
        const x = el('button', null, 'x'); x.style.cssText = 'float:right;padding:0 6px'; x.onclick = (ev) => { ev.stopPropagation(); l.splice(i, 1); LS.set(bmKey(), l); setPanel('bm'); }; a.prepend(x);
        body.appendChild(a);
      });
    } else if (p === 'find') {
      const f = el('div', 'srch', '<input type="text" id="q" placeholder="Search text"><button id="qgo">Go</button>');
      body.appendChild(f); const out = el('div'); body.appendChild(out);
      const run = () => {
        const q = $('q').value.trim(); out.innerHTML = ''; R.highlight('');
        if (!q) return;
        const hits = EBC.book.search(st.book, q, { max: 300 });
        out.appendChild(el('div', 'empty', hits.length + (hits.length >= 300 ? '+' : '') + ' match(es)'));
        hits.forEach((h) => { const a = el('a', 'it', esc(h.snippet) + '<small>' + esc(tocTitle(h.ch) || 'Chapter ' + (h.ch + 1)) + '</small>'); a.onclick = () => { R.goto(h); R.highlight(q); }; out.appendChild(a); });
      };
      $('qgo').onclick = run; $('q').onkeydown = (e) => { if (e.key === 'Enter') run(); e.stopPropagation(); };
      $('q').focus();
    }
  }
  function markToc(p) {
    let best = null;
    document.querySelectorAll('#sidebody a.it').forEach((a) => { a.style.background = ''; if (+a.dataset.ch < p.ch || (+a.dataset.ch === p.ch && +a.dataset.bi <= p.bi)) best = a; });
    if (best) best.style.background = '#2c3340';
  }
  async function renderShelf() {
    const body = $('sidebody'); body.innerHTML = '';
    body.appendChild(el('div', 'empty', 'Books opened or deployed in this browser:'));
    const mine = await idb.all().catch(() => []);
    mine.sort((a, b) => b.added - a.added).forEach((r) => {
      const a = el('a', 'it', esc(r.title) + '<small>' + esc(r.author || r.name) + '</small>');
      a.onclick = () => openBytes(r.bytes, r.name);
      const x = el('button', null, 'x'); x.style.cssText = 'float:right;padding:0 6px'; x.onclick = async (e) => { e.stopPropagation(); await idb.del(r.id); renderShelf(); }; a.prepend(x);
      body.appendChild(a);
    });
    if (!mine.length) body.appendChild(el('div', 'empty', '(none)'));
    // server/library shelf produced by `ebookcraft convert --deploy`
    try {
      const r = await fetch('library/craftapps/EBookCraft/index.json', { cache: 'no-store' });
      if (r.ok) {
        const idx = await r.json();
        body.appendChild(el('div', 'empty', 'Library (' + idx.length + '):'));
        idx.forEach((e) => {
          const a = el('a', 'it', esc(e.title) + '<small>' + esc(e.author || '') + ' - ' + e.pages + ' pages' + (e.ocr ? ', OCR' : '') + '</small>');
          a.onclick = async () => { const z = await fetch('library/craftapps/EBookCraft/' + e.bundle); openBytes(new Uint8Array(await z.arrayBuffer()), e.slug + '.ebookcraft.zip'); };
          body.appendChild(a);
        });
      }
    } catch (e) { /* no library on this host */ }
  }
  const renderShelfIfOpen = () => { if (st.panel === 'shelf') renderShelf(); };

  function addBookmark() {
    if (!st.book) return;
    const c = R.current(), l = LS.get(bmKey(), []), blk = st.book.chapters[c.ch].blocks[c.bi];
    l.push({ ch: c.ch, bi: c.bi, t: Date.now(), label: ((blk && blk.text) || '').slice(0, 60) || 'Chapter ' + (c.ch + 1) });
    LS.set(bmKey(), l); setPanel('bm');
  }

  // ---------- tabs and toolbar wiring
  function showTab(t) {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x.id === t));
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    if (t === 'reader' && st.book) setTimeout(() => R.relayout(), 0);
  }
  document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  document.querySelectorAll('#sidetabs button').forEach((b) => (b.onclick = () => setPanel(b.dataset.p)));
  $('open').onclick = () => $('file').click();
  $('file').onchange = (e) => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; };
  $('prev').onclick = () => R.prev(); $('next').onclick = () => R.next();
  $('fplus').onclick = () => { st.s.size = Math.min(40, st.s.size + 1); saveSettings(); applySettings(); R.relayout(); };
  $('fminus').onclick = () => { st.s.size = Math.max(10, st.s.size - 1); saveSettings(); applySettings(); R.relayout(); };
  document.querySelectorAll('#theme button').forEach((b) => (b.onclick = () => { st.s.theme = b.dataset.t; saveSettings(); applySettings(); }));
  document.querySelectorAll('#colsel button').forEach((b) => (b.onclick = () => { st.s.cols = +b.dataset.c; saveSettings(); applySettings(); R.setCols(st.s.cols); }));
  document.querySelectorAll('#viewsel button').forEach((b) => (b.onclick = () => {
    document.querySelectorAll('#viewsel button').forEach((x) => x.classList.toggle('on', x === b));
    const a = b.dataset.v === 'atari'; document.body.classList.toggle('atariview', a); R.mode(a ? 'atari' : 'hq');
    if (st.book) { if (!a) R.goto(R.current()); else onPos(R.pos()); }
  }));
  $('addbm').onclick = addBookmark;
  $('slider').oninput = (e) => { if (st.book) R.goFraction(e.target.value / 1000); };
  document.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || !$('reader').classList.contains('on')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { R.next(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { R.prev(); e.preventDefault(); }
    else if (e.key === 'b' || e.key === 'B') addBookmark();
    else if (e.key === 'n' || e.key === 'N') { st.s.theme = st.s.theme === 'night' ? 'day' : 'night'; saveSettings(); applySettings(); }
    else if (e.key === '/' ) { setPanel('find'); e.preventDefault(); }
  });
  window.addEventListener('resize', () => { if (st.book) R.relayout(); });
  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement) document.body.classList.remove('dragging'); }));
  document.addEventListener('drop', (e) => {
    const fs = [...(e.dataTransfer.files || [])]; if (!fs.length) return;
    if ($('conv').classList.contains('on')) addInputs(fs); else openFile(fs[0]);
  });

  // ---------- convert / deploy
  async function addInputs(files) {
    for (const f of files) st.inputs.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    listInputs();
  }
  function listInputs() {
    const L = $('files-list');
    L.innerHTML = st.inputs.length ? st.inputs.map((i) => esc(i.name) + ' <span style="opacity:.6">(' + fmtBytes(i.bytes.length) + ')</span>').join('<br>') : 'No input yet.';
  }
  $('cpick').onclick = () => $('cfile').click();
  $('cfile').onchange = async (e) => { st.inputs = []; await addInputs([...e.target.files]); e.target.value = ''; };
  $('cfromreader').onclick = () => { if (!st.lastBytes) return alert('Open a book in the reader first.'); st.inputs = [{ name: st.lastBytes.name, bytes: st.lastBytes.bytes }]; listInputs(); };

  EBC.ocr.available().then((ok) => {
    $('ocrstate').innerHTML = ok ? '<span class="okc">OCR add-on installed (Tesseract, English, fully offline).</span>' : '<span class="warn">OCR add-on not installed.</span> Run <code>node scripts\\ebookcraft-install-ocr.cjs</code> (needs npm once; ~22 MB, Apache-2.0), then reload. Everything else works without it.';
    $('o-ocr').disabled = !ok;
  });

  function readOpts() {
    const g = []; if ($('o-g4').checked) g.push(4); if ($('o-g16').checked) g.push(16); if ($('o-g256').checked) g.push(256);
    return {
      text: $('o-text').checked, ocr: $('o-ocr').checked, bw: $('o-bw').checked, gray: g, dither: $('o-dither').value,
      contrast: +$('o-contrast').value, brightness: +$('o-bright').value, auto: $('o-auto').checked, deskew: $('o-deskew').checked, crop: $('o-crop').checked,
      atari: $('o-atari').checked, print: $('o-print').checked, printWidth: +$('o-pw').value, tiles: +$('o-tiles').value,
      mode: $('o-mode').value, atr: $('o-atr').checked, xex: $('o-xex').checked, textdisk: $('o-td').checked, bundle: $('o-bundle').checked,
    };
  }
  const logEl = $('log');
  const log = (m) => { logEl.textContent += m + '\n'; logEl.scrollTop = logEl.scrollHeight; };
  $('run').onclick = async () => {
    if (!st.inputs.length) return alert('Choose input files first.');
    const btn = $('run'); btn.disabled = true; logEl.textContent = ''; $('results').innerHTML = '';
    try {
      const t0 = performance.now();
      const res = await EBC.pack.convert(st.inputs, readOpts(), log);
      st.result = res; log('done in ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s, ' + res.files.length + ' files');
      showResults(res);
    } catch (e) { log('ERROR: ' + e.message); console.error(e); }
    btn.disabled = false;
  };

  function showResults(res) {
    const out = $('results'); out.innerHTML = '';
    const m = res.manifest;
    out.appendChild(el('h3', null, esc(m.title) + (m.author ? ' - ' + esc(m.author) : '')));
    out.appendChild(el('div', null, m.counts.pages + ' page(s), ' + m.counts.screens + ' Atari screen(s), OCR: ' + (m.ocr.ran ? '<span class="okc">ran (confidence ' + (m.ocr.meanConfidence != null ? Math.round(m.ocr.meanConfidence) : '?') + ')</span>' : 'not run')));
    (res.report || []).forEach((r) => out.appendChild(el('div', 'warn', esc(r))));
    const row = el('div', 'row');
    const mk = (label, fn) => { const b = el('button', null, label); b.onclick = fn; row.appendChild(b); return b; };
    const zip = res.files.find((f) => f.path.endsWith('.ebookcraft.zip'));
    if (zip) mk('Download bundle (.ebookcraft.zip)', () => dl(zip.path.split('/').pop(), zip.bytes, 'application/zip'));
    mk('Download everything (.zip)', async () => dl(res.slug + '-all.zip', await B.zipWrite(res.files.map((f) => ({ name: f.path, data: f.bytes })), { deflate: true }), 'application/zip'));
    mk('Deploy: server-layout zip', async () => dl(res.slug + '-server.zip', await B.zipWrite(EBC.pack.deployFiles(res).map((f) => ({ name: f.path, data: f.bytes })), { deflate: true }), 'application/zip'));
    mk('Save to my shelf', async () => {
      const book = zip ? zip.bytes : null; if (!book) return alert('Enable the bundle output first.');
      const e = EBC.pack.shelfEntry(res); await idb.put({ id: 'bundle:' + res.slug, title: e.title, author: e.author, name: res.slug + '.ebookcraft.zip', bytes: book, added: Date.now() }); alert('Saved. Find it under Reader > Shelf.');
    });
    mk('Open in reader', () => zip ? openBytes(zip.bytes, zip.path) : alert('Enable the bundle output first.'));
    out.appendChild(row);
    const txt = res.files.find((f) => f.path === 'text/book.txt');
    if (txt) {
      out.appendChild(el('h3', null, 'Text' + (m.ocr.ran ? ' (OCR)' : '')));
      const ta = el('textarea', 'ocrtxt'); ta.id = 'ocrtext'; ta.readOnly = true; ta.value = B.decodeText(txt.bytes).slice(0, 60000); out.appendChild(ta);
    }
    const imgs = res.files.filter((f) => /^pages\/.*\.png$/.test(f.path));
    if (imgs.length) {
      out.appendChild(el('h3', null, 'Pages (' + imgs.length + ' images)'));
      const g = el('div', 'grid'); g.id = 'pagegrid';
      imgs.slice(0, 120).forEach((f) => {
        const c = el('div', 'card'), im = new Image(); im.src = URL.createObjectURL(new Blob([f.bytes], { type: 'image/png' }));
        c.appendChild(im); c.appendChild(el('div', null, '<b>' + esc(f.path.replace(/^pages\//, '')) + '</b><br>' + fmtBytes(f.bytes.length)));
        c.style.cursor = 'pointer'; c.onclick = () => dl(f.path.split('/').pop(), f.bytes, 'image/png'); g.appendChild(c);
      });
      out.appendChild(g);
    }
    out.appendChild(el('h3', null, 'Files'));
    const ul = el('div');
    res.files.filter((f) => !/^pages\//.test(f.path)).forEach((f) => { const a = el('div', 'it', '<a href="#" style="color:var(--fg)">' + esc(f.path) + '</a> <span style="opacity:.6">' + fmtBytes(f.bytes.length) + '</span>'); a.querySelector('a').onclick = (e) => { e.preventDefault(); dl(f.path.split('/').pop(), f.bytes); }; ul.appendChild(a); });
    out.appendChild(ul);
  }

  // Optional full PDF rasteriser: reuses the pdf.js copy vendored for the PDF viewer (js/pdfjs), loaded on first use.
  // Absent => EBC.pdf falls back to its own decoder (scans that are single embedded images).
  let pdfjsP = null;
  const loadPdfjs = () => pdfjsP || (pdfjsP = new Promise((res, rej) => {
    if (window.pdfjsLib) return res(window.pdfjsLib);
    const s = document.createElement('script'); s.src = 'js/pdfjs/pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/pdfjs/pdf.worker.min.js'; res(window.pdfjsLib); };
    s.onerror = () => rej(new Error('js/pdfjs not installed')); document.head.appendChild(s);
  }));
  EBC.pdf.engine = {
    async renderPage(bytes, no, dpi) {
      const lib = await loadPdfjs();
      const doc = await lib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
      const pg = await doc.getPage(no), vp = pg.getViewport({ scale: (dpi || 150) / 72 });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: cx, viewport: vp }).promise;
      const d = cx.getImageData(0, 0, c.width, c.height);
      return { w: c.width, h: c.height, rgba: new Uint8Array(d.data.buffer) };
    },
  };
  // pdf.js missing => drop the engine so pack.js takes the built-in path
  fetch('js/pdfjs/pdf.min.js', { method: 'HEAD' }).then((r) => { if (!r.ok) EBC.pdf.engine = null; }).catch(() => { EBC.pdf.engine = null; });

  // test hook (used by scripts/ebookcraft-browser-test.cjs)
  window.EBCApp = { openBytes, R, st, showTab, setPanel, addInputs, listInputs, readOpts };

  applySettings();
  initFaces();
  const w = el('div'); w.id = 'welcomeMsg'; w.innerHTML = '<div id="welcome"><h2>EBookCraft</h2>Open or drop an EPUB, TXT, HTML, FB2, MOBI/AZW, CWD, DOCX, RTF or PDF.<br>The <b>Convert &amp; deploy</b> tab turns books, PDFs and scanned pages into OCR text, 1-bit / gray page images and Atari disks.</div>';
  $('view').appendChild(w);
  const q = new URLSearchParams(location.search).get('book');
  if (q) fetch(q).then((r) => r.arrayBuffer()).then((b) => openBytes(new Uint8Array(b), q.split('/').pop())).catch(() => {});
})();
