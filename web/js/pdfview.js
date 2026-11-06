// Ataricraft PDF viewer: offline pdf.js (js/pdfjs, Apache-2.0) with HiDPI rendering, zoom, page navigation,
// text search, an IndexedDB library, and "Send to Atari" (dithered GR.8 picture / XEX viewer).
(function () {
  const $ = (id) => document.getElementById(id);
  const pdfjs = window.pdfjsLib;
  const MAX_PIXELS = 24e6; // per page canvas; the backing store is scaled down above this
  // pdf.worker.min.js is loaded by a script tag, so pdf.js runs the worker code on the main thread; that also works from file:// where Chrome blocks Workers.
  pdfjs.GlobalWorkerOptions.workerSrc = 'js/pdfjs/pdf.worker.min.js';

  const V = { doc: null, name: '', pages: [], zoom: 'fitw', scale: 1, cur: 1, matches: [], mi: -1, text: [], bytes: null };
  const view = $('view'), status = (t) => ($('status').textContent = t);

  // ---- loading ----
  async function openBytes(bytes, name, keep) {
    status('Opening ' + name + '...');
    try {
      if (V.doc) { V.doc.destroy(); V.doc = null; }
      const copy = bytes.slice(0);
      const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
      V.doc = doc; V.name = name; V.bytes = copy; V.text = []; V.matches = []; V.mi = -1; $('qn').textContent = '';
      $('np').textContent = '/ ' + doc.numPages; $('pg').max = doc.numPages; $('pg').value = 1;
      document.title = name + ' - Ataricraft PDF viewer';
      await buildPages();
      status(name + ': ' + doc.numPages + ' page' + (doc.numPages === 1 ? '' : 's'));
      if (keep !== false) libPut(name, copy).catch(() => {});
    } catch (e) { status('Cannot open ' + name + ': ' + (e.message || e)); throw e; }
  }
  async function openFile(f) { return openBytes(new Uint8Array(await f.arrayBuffer()), f.name); }

  // ---- page layout ----
  async function pageSize(n) { const p = await V.doc.getPage(n); const v = p.getViewport({ scale: 1 }); return { p, w: v.width, h: v.height }; }
  function computeScale(w, h) {
    const aw = view.clientWidth - 24, ah = view.clientHeight - 20;
    if (V.zoom === 'fitw') return aw / w;
    if (V.zoom === 'fitp') return Math.min(aw / w, ah / h);
    return +V.zoom;
  }
  async function buildPages() {
    view.innerHTML = ''; V.pages = [];
    const first = await pageSize(1);
    V.scale = computeScale(first.w, first.h);
    for (let n = 1; n <= V.doc.numPages; n++) {
      const el = document.createElement('div'); el.className = 'page'; el.dataset.n = n;
      const pg = { n, el, rendered: 0, task: null, size: n === 1 ? first : null };
      V.pages.push(pg); view.appendChild(el);
    }
    // sizes of the other pages load lazily; until then use page 1's size
    layoutAll(first);
    observe();
    for (let n = 2; n <= Math.min(V.doc.numPages, 400); n++) pageSize(n).then((s) => { V.pages[n - 1].size = s; sizeEl(V.pages[n - 1]); }).catch(() => {});
  }
  function sizeEl(pg) {
    const s = pg.size || V.pages[0].size; pg.el.style.width = Math.floor(s.w * V.scale) + 'px'; pg.el.style.height = Math.floor(s.h * V.scale) + 'px';
  }
  function layoutAll() { V.pages.forEach(sizeEl); }
  let io;
  function observe() {
    if (io) io.disconnect();
    io = new IntersectionObserver((es) => es.forEach((e) => { const pg = V.pages[+e.target.dataset.n - 1]; if (e.isIntersecting) render(pg); else release(pg); }), { root: view, rootMargin: '600px 0px' });
    V.pages.forEach((pg) => io.observe(pg.el));
  }
  function release(pg) { if (pg.task) { try { pg.task.cancel(); } catch (e) { /* ignore */ } pg.task = null; } pg.el.innerHTML = ''; pg.rendered = 0; }

  async function render(pg) {
    const token = ++pg.rendered, scale = V.scale;
    const page = await V.doc.getPage(pg.n);
    if (token !== pg.rendered) return;
    const vp = page.getViewport({ scale });
    pg.el.style.width = Math.floor(vp.width) + 'px'; pg.el.style.height = Math.floor(vp.height) + 'px';
    // HiDPI: back the canvas with devicePixelRatio device pixels per CSS pixel
    let out = Math.max(1, window.devicePixelRatio || 1);
    if (vp.width * vp.height * out * out > MAX_PIXELS) out = Math.sqrt(MAX_PIXELS / (vp.width * vp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.floor(vp.width * out); cv.height = Math.floor(vp.height * out);
    const ctx = cv.getContext('2d');
    pg.el.innerHTML = ''; pg.el.style.setProperty('--scale-factor', scale); pg.el.appendChild(cv); pg.out = out;
    const task = page.render({ canvasContext: ctx, viewport: vp, transform: [out, 0, 0, out, 0, 0], background: 'rgb(255,255,255)' });
    pg.task = task;
    try { await task.promise; } catch (e) { return; }
    if (token !== pg.rendered) return;
    cv.dataset.done = '1';
    const tl = document.createElement('div'); tl.className = 'textLayer'; pg.el.appendChild(tl);
    const tc = await page.getTextContent();
    if (token !== pg.rendered) return;
    const divs = [], strs = [];
    const tt = pdfjs.renderTextLayer({ textContentSource: tc, container: tl, viewport: vp, textDivs: divs, textContentItemsStr: strs });
    await tt.promise.catch(() => {});
    pg.divs = divs; pg.strs = strs;
    applyHighlights(pg);
    pg.el.dataset.ready = '1';
  }

  function setZoom(z) {
    V.zoom = z; if ($('zoom').value !== z) { if (![...$('zoom').options].some((o) => o.value === z)) { const o = new Option(Math.round(+z * 100) + '%', z); $('zoom').add(o); } $('zoom').value = z; }
    if (!V.doc) return;
    const keep = V.cur, fracTop = 0;
    const s0 = V.pages[0].size; V.scale = computeScale(s0.w, s0.h);
    V.pages.forEach((pg) => { release(pg); sizeEl(pg); });
    observe(); goPage(keep, fracTop);
  }
  const stepZoom = (dir) => { const cur = V.scale; const z = Math.max(0.1, Math.min(10, cur * (dir > 0 ? 1.25 : 0.8))); setZoom(String(Math.round(z * 1000) / 1000)); };

  function goPage(n, off) {
    n = Math.max(1, Math.min(V.doc ? V.doc.numPages : 1, n | 0)); V.cur = n; $('pg').value = n;
    const el = V.pages[n - 1]; if (el) view.scrollTop = el.el.offsetTop - view.offsetTop - 8 + (off || 0);
  }
  view.addEventListener('scroll', () => {
    if (!V.doc) return; const mid = view.scrollTop + view.clientHeight / 3 + view.offsetTop;
    let n = 1; for (const pg of V.pages) { if (pg.el.offsetTop <= mid) n = pg.n; else break; }
    if (n !== V.cur) { V.cur = n; $('pg').value = n; }
  });

  // ---- search ----
  async function ensureText() {
    if (V.text.length === V.doc.numPages) return;
    V.text = [];
    for (let n = 1; n <= V.doc.numPages; n++) { const tc = await (await V.doc.getPage(n)).getTextContent(); V.text.push(tc.items.map((i) => i.str)); }
  }
  async function search(q) {
    V.matches = []; V.mi = -1;
    if (!V.doc || !q) { $('qn').textContent = ''; V.pages.forEach(applyHighlights); return; }
    await ensureText(); const ql = q.toLowerCase();
    V.text.forEach((items, pi) => items.forEach((s, ii) => { const sl = s.toLowerCase(); let k = sl.indexOf(ql); while (k >= 0) { V.matches.push({ page: pi + 1, item: ii, at: k, len: q.length }); k = sl.indexOf(ql, k + ql.length); } }));
    $('qn').textContent = V.matches.length ? '0 / ' + V.matches.length : 'no match';
    V.pages.forEach(applyHighlights);
    if (V.matches.length) stepMatch(1);
  }
  function applyHighlights(pg) {
    if (!pg.divs) return;
    pg.divs.forEach((d, i) => { if (d.dataset.hl) { d.textContent = pg.strs[i]; delete d.dataset.hl; } });
    const mine = V.matches.map((m, idx) => ({ m, idx })).filter((x) => x.m.page === pg.n);
    const byItem = {}; mine.forEach((x) => (byItem[x.m.item] = byItem[x.m.item] || []).push(x));
    Object.keys(byItem).forEach((it) => {
      const d = pg.divs[+it], s = pg.strs[+it]; if (!d) return;
      d.textContent = ''; let p = 0;
      byItem[it].forEach((x) => {
        d.appendChild(document.createTextNode(s.slice(p, x.m.at)));
        const mk = document.createElement('mark'); mk.textContent = s.substr(x.m.at, x.m.len); mk.dataset.mi = x.idx; if (x.idx === V.mi) mk.className = 'cur'; d.appendChild(mk); p = x.m.at + x.m.len;
      });
      d.appendChild(document.createTextNode(s.slice(p))); d.dataset.hl = 1;
    });
  }
  async function stepMatch(dir) {
    if (!V.matches.length) return;
    V.mi = (V.mi + dir + V.matches.length) % V.matches.length;
    $('qn').textContent = V.mi + 1 + ' / ' + V.matches.length;
    const m = V.matches[V.mi]; goPage(m.page);
    // wait for the page's text layer, then highlight the current match and scroll to it
    for (let i = 0; i < 100 && !(V.pages[m.page - 1].el.dataset.ready === '1'); i++) await new Promise((r) => setTimeout(r, 50));
    V.pages.forEach(applyHighlights);
    const cur = view.querySelector('mark.cur'); if (cur) { const r = cur.getBoundingClientRect(), vr = view.getBoundingClientRect(); view.scrollTop += r.top - vr.top - vr.height / 3; }
  }

  // ---- library (IndexedDB) ----
  const dbp = () => new Promise((res, rej) => { const r = indexedDB.open('ac-pdf-library', 1); r.onupgradeneeded = () => r.result.createObjectStore('pdf', { keyPath: 'name' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (mode, fn) => { const db = await dbp(); return new Promise((res, rej) => { const t = db.transaction('pdf', mode), s = t.objectStore('pdf'), rq = fn(s); t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error); }); };
  const libPut = (name, bytes) => tx('readwrite', (s) => s.put({ name, bytes, size: bytes.length, at: Date.now() }));
  const libAll = () => tx('readonly', (s) => s.getAll());
  const libDel = (name) => tx('readwrite', (s) => s.delete(name));
  async function showLib() {
    const side = $('side'); if (side.classList.toggle('show') === false) return;
    const all = (await libAll()).sort((a, b) => b.at - a.at);
    side.innerHTML = '<b>Library</b> <small>(this browser)</small>';
    if (!all.length) side.innerHTML += '<div style="opacity:.7;margin-top:6px">Empty. PDFs you open are kept here.</div>';
    all.forEach((e) => {
      const d = document.createElement('div'); d.className = 'it';
      const a = document.createElement('a'); a.textContent = e.name + ' (' + Math.round(e.size / 1024) + ' KB)'; a.onclick = () => openBytes(e.bytes, e.name, false);
      const x = document.createElement('button'); x.textContent = 'x'; x.title = 'Remove from library'; x.onclick = async () => { await libDel(e.name); d.remove(); };
      d.append(a, x); side.appendChild(d);
    });
  }

  // ---- Send to Atari ----
  const A = { tile: [0, 0], tiles: [1, 1], canvas: document.createElement('canvas'), gr8: null };
  async function atariSource() {
    const page = await V.doc.getPage(V.cur), mode = $('amode').value;
    const base = page.getViewport({ scale: 1 });
    const c = A.canvas; c.width = 320; c.height = 192; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 320, 192);
    const tmp = document.createElement('canvas'), tg = tmp.getContext('2d');
    if (mode === 'fit') {
      const s = Math.min(320 / base.width, 192 / base.height), sup = 4; // render large, let the browser downsample smoothly
      const vp = page.getViewport({ scale: s * sup }); tmp.width = Math.ceil(vp.width); tmp.height = Math.ceil(vp.height);
      await page.render({ canvasContext: tg, viewport: vp, background: 'rgb(255,255,255)' }).promise;
      const w = base.width * s, h = base.height * s; g.imageSmoothingQuality = 'high';
      g.drawImage(tmp, 0, 0, tmp.width, tmp.height, (320 - w) / 2, (192 - h) / 2, w, h); A.tiles = [1, 1]; A.tile = [0, 0];
    } else {
      const z = +mode.slice(1), W = 320 * z, s = W / base.width, sup = 1;
      const vp = page.getViewport({ scale: s * sup }); tmp.width = Math.ceil(vp.width); tmp.height = Math.ceil(vp.height);
      await page.render({ canvasContext: tg, viewport: vp, background: 'rgb(255,255,255)' }).promise;
      A.tiles = [Math.ceil(tmp.width / 320), Math.ceil(tmp.height / 192)];
      A.tile = [Math.min(A.tile[0], A.tiles[0] - 1), Math.min(A.tile[1], A.tiles[1] - 1)];
      g.drawImage(tmp, A.tile[0] * 320, A.tile[1] * 192, 320, 192, 0, 0, 320, 192);
    }
  }
  async function atariRender() {
    await atariSource();
    const d = A.canvas.getContext('2d').getImageData(0, 0, 320, 192);
    const img = { w: 320, h: 192, data: new Uint8Array(d.data.buffer.slice(0)) };
    if ($('ainv').checked) for (let i = 0; i < img.data.length; i += 4) { img.data[i] = 255 - img.data[i]; img.data[i + 1] = 255 - img.data[i + 1]; img.data[i + 2] = 255 - img.data[i + 2]; }
    A.gr8 = AC.img.encodeAtari(img, 'gr8', { dither: $('adith').checked, colors: [0x00, 0x0F], fit: 'stretch' });
    const out = $('acv').getContext('2d'), od = out.createImageData(320, 192), pal = [[0, 0, 0], [255, 255, 255]];
    for (let y = 0; y < 192; y++) for (let x = 0; x < 320; x++) { const v = (A.gr8[y * 40 + (x >> 3)] >> (7 - (x & 7))) & 1, o = (y * 320 + x) * 4; od.data[o] = od.data[o + 1] = od.data[o + 2] = v ? 255 : 0; od.data[o + 3] = 255; }
    out.putImageData(od, 0, 0);
    $('atile').textContent = A.tiles[0] * A.tiles[1] > 1 ? 'tile ' + (A.tile[0] + 1) + ',' + (A.tile[1] + 1) + ' of ' + A.tiles[0] + 'x' + A.tiles[1] : 'page ' + V.cur;
    $('amsg').textContent = '';
  }
  // XEX viewer: ANTIC mode F, two LMS blocks (screen data may not cross a 4K boundary), COLPF1 white on COLPF2 black.
  function makeXex(gr8) {
    const DL = 0x3F00, CODE = 0x3E00, S1 = 0x4000, S2 = 0x5000, n1 = 102 * 40, out = [];
    const seg = (a, b) => { out.push(a & 255, a >> 8, (a + b.length - 1) & 255, (a + b.length - 1) >> 8, ...b); };
    out.push(0xFF, 0xFF);
    seg(S1, Array.from(gr8.subarray(0, n1))); seg(S2, Array.from(gr8.subarray(n1)));
    const dl = [0x70, 0x70, 0x70, 0x4F, S1 & 255, S1 >> 8]; for (let i = 0; i < 101; i++) dl.push(0x0F);
    dl.push(0x4F, S2 & 255, S2 >> 8); for (let i = 0; i < 89; i++) dl.push(0x0F);
    dl.push(0x41, DL & 255, DL >> 8); seg(DL, dl);
    const code = [0xA9, DL & 255, 0x8D, 0x30, 0x02, 0xA9, DL >> 8, 0x8D, 0x31, 0x02, 0xA9, 0x22, 0x8D, 0x2F, 0x02,
      0xA9, 0x00, 0x8D, 0xC6, 0x02, 0xA9, 0x0F, 0x8D, 0xC5, 0x02, 0xA9, 0x00, 0x8D, 0xC8, 0x02];
    const loop = CODE + code.length; code.push(0x4C, loop & 255, loop >> 8); seg(CODE, code);
    seg(0x02E0, [CODE & 255, CODE >> 8]);
    return Uint8Array.from(out);
  }
  const dl = (bytes, name, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: type || 'application/octet-stream' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const stem = () => (V.name.replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5) || 'PAGE') + String(V.cur).slice(0, 3);
  function wireAtari() {
    $('toAtari').onclick = async () => { if (!V.doc) return; $('atari').classList.add('show'); await atariRender(); };
    $('aclose').onclick = () => $('atari').classList.remove('show');
    ['amode', 'adith', 'ainv'].forEach((id) => ($(id).onchange = () => { if (id === 'amode') A.tile = [0, 0]; atariRender(); }));
    const mv = (dx, dy) => { let x = A.tile[0] + dx, y = A.tile[1] + dy; if (x >= A.tiles[0]) { x = 0; y++; } if (x < 0) { x = A.tiles[0] - 1; y--; } if (y < 0 || y >= A.tiles[1]) return; A.tile = [x, y]; atariRender(); };
    $('atp').onclick = () => mv(-1, 0); $('atn').onclick = () => mv(1, 0);
    $('agr8').onclick = () => dl(A.gr8, stem() + '.GR8');
    $('axex').onclick = () => dl(makeXex(A.gr8), stem() + '.XEX');
    $('apng').onclick = () => A.canvas.toBlob((b) => b.arrayBuffer().then((ab) => dl(new Uint8Array(ab), stem() + '.png', 'image/png')));
    $('asend').onclick = () => {
      const host = window.opener && !window.opener.closed ? window.opener : null;
      if (host) { host.postMessage({ type: 'ac-boot', name: stem() + '.XEX', bytes: makeXex(A.gr8) }, '*'); $('amsg').textContent = 'Sent. Booting in the emulator.'; }
      else $('amsg').textContent = 'No emulator window found. Open this viewer from the emulator page (PDF tab), or download the .XEX.';
    };
    window.PDFVIEW_XEX = makeXex;
  }

  // ---- wiring ----
  $('open').onclick = () => $('file').click();
  $('file').onchange = (e) => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; };
  $('lib').onclick = showLib;
  $('prev').onclick = () => V.doc && goPage(V.cur - 1);
  $('next').onclick = () => V.doc && goPage(V.cur + 1);
  $('pg').onchange = () => V.doc && goPage(+$('pg').value);
  $('zoom').onchange = () => setZoom($('zoom').value);
  $('zin').onclick = () => V.doc && stepZoom(1); $('zout').onclick = () => V.doc && stepZoom(-1);
  $('q').onkeydown = (e) => { if (e.key === 'Enter') { if (e.shiftKey) stepMatch(-1); else if (V.matches.length && $('q').dataset.last === $('q').value) stepMatch(1); else { $('q').dataset.last = $('q').value; search($('q').value); } } };
  $('qnext').onclick = () => { if ($('q').dataset.last !== $('q').value) { $('q').dataset.last = $('q').value; search($('q').value); } else stepMatch(1); };
  $('qprev').onclick = () => stepMatch(-1);
  document.addEventListener('keydown', (e) => {
    if (!V.doc || /INPUT|SELECT/.test(e.target.tagName)) { if (e.key === 'f' && e.ctrlKey && V.doc) { e.preventDefault(); $('q').focus(); } return; }
    if (e.key === 'PageDown' || (e.key === 'ArrowRight' && e.altKey)) { e.preventDefault(); goPage(V.cur + 1); }
    else if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && e.altKey)) { e.preventDefault(); goPage(V.cur - 1); }
    else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); goPage(1); }
    else if (e.key === 'End' && e.ctrlKey) { e.preventDefault(); goPage(V.doc.numPages); }
    else if (e.ctrlKey && (e.key === '+' || e.key === '=')) { e.preventDefault(); stepZoom(1); }
    else if (e.ctrlKey && e.key === '-') { e.preventDefault(); stepZoom(-1); }
    else if (e.ctrlKey && e.key === 'f') { e.preventDefault(); $('q').focus(); }
  });
  view.addEventListener('wheel', (e) => { if (e.ctrlKey && V.doc) { e.preventDefault(); stepZoom(e.deltaY < 0 ? 1 : -1); } }, { passive: false });
  ['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); view.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); view.classList.remove('drag'); }));
  document.addEventListener('drop', (e) => { const f = [...(e.dataTransfer.files || [])].find((x) => /\.pdf$/i.test(x.name) || x.type === 'application/pdf'); if (f) openFile(f); else status('Drop a .pdf file'); });
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (V.doc && /^fit/.test(V.zoom)) setZoom(V.zoom); }, 150); });
  wireAtari();
  window.PDFVIEW = { open: openBytes, state: V };

  // ?src=URL opens a PDF by URL (same origin or CORS-enabled; works when served over http)
  const src = new URLSearchParams(location.search).get('src');
  if (src) fetch(src).then((r) => r.arrayBuffer()).then((b) => openBytes(new Uint8Array(b), decodeURIComponent(src.split('/').pop() || 'document.pdf'))).catch((e) => status('Cannot load ' + src + ': ' + e.message));
})();
