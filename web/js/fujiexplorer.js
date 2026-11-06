/* FujiNet Explorer: reach every FujiNet resource (TNFS, SD, FTP, PC folders, disk images, drives D1-D8, N: network,
   printer, settings, DOS boot records) from a browser tab. All traffic goes through one AC.Transport (docs/TRANSPORT.md). */
(function () {
  const AC = window.AC, T = AC.Transport, P = AC.FxPreview;
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };

  // ------------------------------------------------------------ log and dialogs
  function log(msg, cls) { const l = $('log'), d = el('div', cls || '', new Date().toLocaleTimeString() + '  ' + msg); l.append(d); l.scrollTop = l.scrollHeight; while (l.children.length > 300) l.firstChild.remove(); }
  function modal(build) {
    return new Promise((res) => {
      const box = $('mbox'); box.textContent = '';
      const done = (v) => { $('modal').classList.remove('show'); res(v); };
      build(box, done); $('modal').classList.add('show');
      const i = box.querySelector('input'); if (i) { i.focus(); i.select(); }
    });
  }
  const ask = (label, def) => modal((box, done) => {
    box.append(el('div', null, label)); const i = el('input'); i.value = def || ''; i.id = 'askin'; box.append(i);
    const r = el('div', 'row'), ok = el('button', 'on', 'OK'), no = el('button', null, 'Cancel'); r.append(no, ok); box.append(r);
    ok.onclick = () => done(i.value); no.onclick = () => done(null); i.onkeydown = (e) => { if (e.key === 'Enter') done(i.value); else if (e.key === 'Escape') done(null); };
  });
  const confirmBox = (msg) => modal((box, done) => {
    box.append(el('div', null, msg)); const r = el('div', 'row'), ok = el('button', 'on', 'Yes'), no = el('button', null, 'No'); ok.id = 'confirmyes'; r.append(no, ok); box.append(r);
    ok.onclick = () => done(true); no.onclick = () => done(false);
  });

  // ------------------------------------------------------------ transport
  let relayT, emuT, localT, X, mockEmu = null;
  const state = { loc: null, entries: [], sel: null, disk: null, bytes: null, name: '', tab: 'files' };
  const saved = (k) => { try { return JSON.parse(store.get(k, '[]')); } catch (e) { return []; } };

  function relayBase() { return ($('relayUrl').value || store.get('ac.tnfsbridge', '') || (/^https?:/.test(location.protocol) ? location.origin : '')).replace(/\/$/, ''); }
  function build() {
    if (X) { try { X.close(); } catch (e) { /* closing */ } }
    localT = T.local();
    if (q.get('transport') === 'loopback') {
      relayT = T.loopback({ caps: { sd: true, tool: 'loopback', time: Date.now(), tzOffset: new Date().getTimezoneOffset() }, allowWrite: q.get('ro') !== '1' });
      seedLoopback(relayT);
      emuT = q.get('emu') === 'none' ? T.emulator({ timeout: 300 }) : (mockEmu = makeMockEmu());
    } else {
      relayT = T.relay({ base: relayBase(), token: () => $('token').value || store.get('ac.nettoken', '') });
      emuT = T.emulator();
    }
    X = T.router({ relay: relayT, emulator: emuT, local: localT });
    X.on('status', paintStatus);
    return X.open().then(() => { paintStatus(); renderRes(); });
  }

  function seedLoopback(lb) {
    const enc = (s) => new TextEncoder().encode(s);
    lb.dirs.add('/docs'); lb.dirs.add('/fonts'); lb.dirs.add('/disks');
    lb.files.set('/readme.txt', enc('FujiNet Explorer loopback sample\nSecond line\n'));
    lb.files.set('/docs/note.txt', enc('Hello from a loopback file.\n'));
    const g = new Uint8Array(1024); for (let c = 0; c < 128; c++) for (let y = 0; y < 8; y++) g[c * 8 + y] = (c * 37 + y * 11) & 0xff;
    lb.files.set('/fonts/sample.fnt', g);
    const img = AC.DosFs.createDos2 ? AC.DosFs.createDos2({}) : null;
    if (img) { try { const v = AC.DosFs.open(img); v.writeFile('HELLO.TXT', enc('inside the disk image\n')); lb.files.set('/disks/test.atr', img); } catch (e) { /* no sample disk */ } }
  }

  // An in-page stand-in for the emulator (loopback tests of the UI without booting an Atari)
  function makeMockEmu() {
    const lb = T.loopback({ caps: {} }), drives = Array.from({ length: 8 }, () => null), pr = [{ text: 'HELLO FROM P:', mode: 'N' }];
    const fn = { enabled: true, bridge: '', hosts: ['SD', 'tnfs.example.org', '', '', '', '', '', ''], slots: Array.from({ length: 8 }, (_, i) => ({ slot: i + 1, host: 0xff, mode: 0, path: '', mounted: false })) };
    const ip = { ssid: 'ataricraft', hostname: 'fujinet-virtual', ip: '127.0.0.1', gw: '127.0.0.1', mask: '255.0.0.0', dns: '8.8.8.8' };
    const disks = () => ({ disks: drives.map((d, i) => ({ drive: i + 1, name: d ? d.name : '', size: d ? d.bytes.length : 0 })) });
    lb.handle('emu.ping', () => ({ meta: { value: { protocol: 1, booted: true, mock: true } } }));
    lb.handle('emu.disks', () => ({ meta: { value: disks() } }));
    lb.handle('emu.mount', (m) => { drives[m.args.drive - 1] = { name: m.args.name, bytes: m.body }; return { meta: { value: disks() } }; });
    lb.handle('emu.eject', (m) => { drives[m.args.drive - 1] = null; return { meta: { value: disks() } }; });
    lb.handle('emu.swap', (m) => { const a = m.args.from - 1, b = m.args.to - 1; [drives[a], drives[b]] = [drives[b], drives[a]]; return { meta: { value: disks() } }; });
    lb.handle('emu.disk.read', (m) => (drives[m.args.drive - 1] ? { meta: {}, body: drives[m.args.drive - 1].bytes } : T.fail('NotFound', 'D' + m.args.drive + ' is empty')));
    lb.handle('emu.printer', () => ({ meta: { value: { count: pr.length, lines: pr, text: pr.map((l) => l.text).join('\r\n') + '\r\n' } } }));
    lb.handle('emu.printer.clear', () => { pr.length = 0; return { meta: { value: {} } }; });
    lb.handle('emu.fujinet.get', () => ({ meta: { value: fn } }));
    lb.handle('emu.fujinet.set', (m) => { if (m.args.hosts) m.args.hosts.forEach((h, i) => { if (i) fn.hosts[i] = h; }); if (m.args.slots) m.args.slots.forEach((s, i) => Object.assign(fn.slots[i], s)); return { meta: { value: fn } }; });
    lb.handle('emu.net.get', () => ({ meta: { value: { ip } } }));
    lb.handle('emu.net.set', (m) => { Object.assign(ip, m.args.ip); return { meta: { value: { ip } } }; });
    lb.handle('emu.time', () => { const d = new Date(); return { meta: { value: { now: d.getTime(), iso: d.toISOString(), tzOffset: d.getTimezoneOffset(), tz: 'mock' } } }; });
    lb.mockPrinter = pr;
    return lb;
  }

  async function rpc(op, args, body) {
    const t0 = performance.now();
    const r = await X.send({ op, args: args || {}, body: body || null });
    const ms = Math.round(performance.now() - t0);
    if (!r.ok) { log(op + ' ' + describe(args) + ' -> ' + r.error.name + ': ' + r.error.message, 'e'); const e = new Error(r.error.message); e.name = r.error.name; throw e; }
    log(op + ' ' + describe(args) + ' ok (' + ms + ' ms' + (r.body ? ', ' + r.body.length + ' bytes' : '') + ')');
    return r;
  }
  const describe = (a) => (a ? [a.scheme, a.host, a.path, a.drive && 'D' + a.drive, a.url].filter(Boolean).join(' ') : '');
  const quiet = async (op, args, body) => { try { return await rpc(op, args, body); } catch (e) { return null; } };

  function paintStatus() {
    const s = X.status(), r = (s.parts || {}).relay || {}, e = (s.parts || {}).emulator || {};
    const ch = (id, cls, text, title) => { const c = $(id); c.className = 'chip ' + cls; c.textContent = text; c.title = title || ''; };
    ch('chRelay', r.state === 'open' ? 'ok' : 'bad', 'relay: ' + (r.state === 'open' ? 'connected' : r.error || 'off'), r.error || '');
    ch('chEmu', e.state === 'open' ? 'ok' : 'bad', 'emulator: ' + (e.state === 'open' ? (e.caps && e.caps.booted === false ? 'open, not booted' : 'connected') : 'not found'), e.error || '');
    const c = r.caps;
    if (!c || r.state !== 'open') ch('chWrite', 'bad', 'writes: n/a');
    else if (c.allowWrite === false) ch('chWrite', 'ro', 'relay read-only', 'Start the relay with --allow-write to change TNFS, SD or FTP files');
    else ch('chWrite', 'ok', c.allowWrite ? 'relay writes on' : 'writes: relay decides');
    paintActions();
  }
  const caps = () => ((X.status().parts || {}).relay || {}).caps || null;
  function writable() {
    const l = state.loc; if (!l || l.scheme === 'disk' || state.disk) return false;
    if (l.scheme === 'pc') return true;
    const c = caps(); return !c || c.allowWrite !== false;
  }

  // ------------------------------------------------------------ tabs
  const TABS = [['files', 'Files'], ['drives', 'Drives D1-D8'], ['net', 'N: Network'], ['printer', 'P: Printer'], ['settings', 'Clock & settings'], ['dos', 'DOS boot']];
  let pollTimer = 0;
  function showTab(t) {
    state.tab = t;
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('show', s.id === 'tab-' + t));
    clearInterval(pollTimer);
    if (t === 'drives') refreshDrives(); else if (t === 'printer') { refreshPrinter(); pollTimer = setInterval(() => { if ($('prauto') && $('prauto').checked) refreshPrinter(); }, 1500); }
    else if (t === 'settings') renderSettings(); else if (t === 'dos') renderDos(); else if (t === 'net') renderNet();
  }
  for (const [k, l] of TABS) { const b = el('button', null, l); b.dataset.t = k; b.id = 'nav-' + k; b.onclick = () => showTab(k); $('nav').append(b); }

  // ------------------------------------------------------------ resources (left list)
  function addRes(box, label, loc, title) {
    const b = el('button', 'r', label); b.title = title || ''; b.onclick = () => navigate(loc, '/'); box.append(b); return b;
  }
  let resSeq = 0;
  async function renderRes() {
    const my = ++resSeq, live = $('res'), box = el('div'); box.id = 'resbox';
    const h = (t) => box.append(el('h3', null, t));
    h('Relay');
    if (q.get('transport') === 'loopback') addRes(box, 'Memory (loopback)', { scheme: 'mem', host: '' });
    else addRes(box, 'SD: folder', { scheme: 'sd', host: '' }, 'The folder the relay serves with --sd');
    h('TNFS servers');
    const tn = saved('fx.tnfs');
    for (const t of tn) addRes(box, t, { scheme: 'tnfs', host: t });
    const row = el('div', 'row'), ti = el('input'); ti.id = 'tnfshost'; ti.placeholder = 'host[:port]'; const tb = el('button', null, 'Open'); tb.id = 'tnfsopen';
    tb.onclick = () => { const v = ti.value.trim(); if (!v) return; if (!saved('fx.tnfs').includes(v)) store.set('fx.tnfs', JSON.stringify(saved('fx.tnfs').concat(v))); renderRes().then(() => navigate({ scheme: 'tnfs', host: v }, '/')); };
    row.append(ti, tb); box.append(row);
    const fj = await quiet('emu.fujinet.get');
    if (fj && fj.meta.value) { const hs = fj.meta.value.hosts.filter((x, i) => i > 0 && x); if (hs.length) { h('FujiNet host slots'); hs.forEach((x) => addRes(box, x, { scheme: 'tnfs', host: x }, 'From the emulator CONFIG host list')); } }
    h('FTP');
    const fr = el('div'); fr.innerHTML = '<div class="row"><input id="ftphost" placeholder="host[:port]"></div><div class="row"><input id="ftpuser" placeholder="user" value="anonymous"><input id="ftppass" placeholder="password" type="password"></div>';
    const fb = el('button', null, 'Open FTP'); fb.id = 'ftpopen'; fb.onclick = () => { const host = $('ftphost').value.trim(); if (host) navigate({ scheme: 'ftp', host, user: $('ftpuser').value, pass: $('ftppass').value }, '/'); };
    fr.append(fb); box.append(fr);
    h('PC folders');
    for (const n of localT.roots()) addRes(box, n, { scheme: 'pc', host: n });
    const pb = el('button', null, 'Add PC folder...'); pb.id = 'addpc';
    pb.onclick = async () => { if (!window.showDirectoryPicker) { log('This browser has no folder picker', 'e'); return; } try { const hd = await showDirectoryPicker({ mode: 'readwrite' }); localT.addRoot(hd.name, hd); renderRes(); navigate({ scheme: 'pc', host: hd.name }, '/'); } catch (e) { /* cancelled */ } };
    box.append(pb);
    h('Mounted disks');
    const d = await quiet('emu.disks');
    if (d && d.meta.value) for (const x of d.meta.value.disks) if (x.name) { const b = el('button', 'r', 'D' + x.drive + ': ' + x.name); b.onclick = () => browseDrive(x.drive); box.append(b); }
    if (my === resSeq) { live.textContent = ''; while (box.firstChild) live.append(box.firstChild); }
  }

  // ------------------------------------------------------------ browsing
  const join = (p, n) => (p.endsWith('/') ? p : p + '/') + n;
  const parentOf = (p) => { const s = p.replace(/\/$/, ''); return s.slice(0, s.lastIndexOf('/')) || '/'; };
  const fa = (extra) => Object.assign({ scheme: state.loc.scheme, host: state.loc.host, user: state.loc.user, pass: state.loc.pass, path: state.loc.path }, extra);

  async function navigate(loc, path) {
    state.disk = null; state.loc = Object.assign({}, loc, { path: path || '/' });
    await refresh();
  }
  async function refresh() {
    if (!state.loc) return;
    state.sel = null; state.bytes = null; $('prev').textContent = ''; $('prev').append(el('div', 'note', 'Select a file to preview it.'));
    document.querySelectorAll('#res .r').forEach((b) => b.classList.remove('on'));
    if (state.disk) { state.entries = AC.AfmCore.listDir(state.disk.m, state.disk.dir).map((e) => ({ name: e.name, dir: e.dir, size: e.size, mtime: 0, path: e.path })); $('path').value = state.disk.name + ':/' + state.disk.dir; }
    else {
      $('path').value = state.loc.scheme + (state.loc.host ? '://' + state.loc.host : ':') + state.loc.path;
      try { const r = await rpc('fs.list', fa()); state.entries = r.meta.value.filter((e) => e.name !== '.' && e.name !== '..'); }
      catch (e) { state.entries = []; paintList(); showError(e); return; }
    }
    paintList(); paintActions();
  }
  function showError(e) { const l = $('list'); l.textContent = ''; const tr = el('tr'), td = el('td', null, e.name + ': ' + e.message); td.style.color = 'var(--bad)'; td.colSpan = 3; td.id = 'listerr'; tr.append(td); l.append(tr); }
  const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1 << 20 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  function paintList() {
    const l = $('list'); l.textContent = '';
    const hd = el('tr'); hd.innerHTML = '<th>Name</th><th>Size</th><th>Modified</th>'; l.append(hd);
    const sorted = state.entries.slice().sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
    for (const e of sorted) {
      const tr = el('tr', 'f'); tr.dataset.name = e.name;
      const n = el('td', 'n', (e.dir ? '\u{1F4C1} ' : '') + e.name), s = el('td', 's', e.dir ? '' : fmtSize(e.size)), m = el('td', 's', e.mtime ? new Date(e.mtime).toLocaleString() : '');
      tr.append(n, s, m);
      tr.onclick = () => select(e, tr);
      tr.ondblclick = () => (e.dir ? enter(e) : select(e, tr, true));
      if (!e.dir && !state.disk) { tr.draggable = true; tr.ondragstart = (ev) => ev.dataTransfer.setData('application/x-fx-entry', JSON.stringify({ loc: state.loc, name: e.name, size: e.size })); }
      l.append(tr);
    }
    if (!sorted.length) { const tr = el('tr'), td = el('td', null, '(empty)'); td.colSpan = 3; td.style.color = 'var(--dim)'; tr.append(td); l.append(tr); }
  }
  async function enter(e) {
    if (state.disk) { state.disk.dir = e.path; refresh(); return; }
    state.loc.path = join(state.loc.path, e.name); await refresh();
  }
  async function up() {
    if (state.disk) { if (!state.disk.dir) { const b = state.disk.back; state.disk = null; state.loc = b; return refresh(); } state.disk.dir = state.disk.dir.includes('/') ? state.disk.dir.slice(0, state.disk.dir.lastIndexOf('/')) : ''; return refresh(); }
    if (!state.loc) return; state.loc.path = parentOf(state.loc.path); await refresh();
  }

  async function readEntry(e) {
    if (state.disk) { const b = AC.AfmCore.readFile(state.disk.m, e.path); if (!b) throw new Error('cannot read ' + e.name); return b; }
    return (await rpc('fs.read', fa({ path: join(state.loc.path, e.name) }))).body;
  }
  async function select(e, tr, force) {
    document.querySelectorAll('#list tr.sel').forEach((x) => x.classList.remove('sel')); if (tr) tr.classList.add('sel');
    state.sel = e; paintActions();
    const pv = $('prev'); pv.textContent = '';
    if (e.dir) { pv.append(el('div', 'note', 'Folder ' + e.name)); return; }
    if (e.size > 8 << 20 && !force) { pv.append(el('div', 'note', e.name + ' is ' + fmtSize(e.size) + '. Double-click to load the preview.')); return; }
    pv.append(el('div', 'note', 'Loading ' + e.name + '...'));
    let b; try { b = await readEntry(e); } catch (x) { pv.textContent = ''; const d = el('div', 'note', x.name + ': ' + x.message); d.style.color = 'var(--bad)'; pv.append(d); return; }
    if (state.sel !== e) return;
    state.bytes = b; state.name = e.name;
    pv.textContent = '';
    pv.append(el('div', null, e.name));
    const acts = el('div', 'acts'); acts.id = 'acts'; pv.append(acts);
    const body = el('div'); body.id = 'pvbody'; pv.append(body);
    const k = P.render(body, e.name, b, { browseDisk: (m, n) => browseDisk(m, n) });
    buildActions(acts, e, b, k);
  }

  function buildActions(acts, e, b, k) {
    const add = (label, fn, id) => { const x = el('button', null, label); if (id) x.id = id; x.onclick = fn; acts.append(x); return x; };
    add('Download', () => saveAs(e.name, b), 'pv-download');
    const isDisk = k === 'disk' || (b.length >= 92160 && /\.(atr|xfd|dcm)$/i.test(e.name));
    if (isDisk) {
      const sel = el('select'); sel.id = 'mdrv'; for (let i = 1; i <= 8; i++) sel.append(new Option('D' + i, i));
      const mb = add('Mount', () => mountBytes(+sel.value, e.name, b), 'pv-mount'); acts.insertBefore(sel, mb);
    }
    if (k === 'xex') add('Run in emulator', async () => { try { await rpc('emu.boot', { name: e.name }, b); } catch (x) { /* logged */ } }, 'pv-run');
    for (const t of OPEN_IN) if (t.kinds.includes(k)) add(t.label, () => handoff(t, e.name, b), 'pv-open-' + t.id);
  }

  // ------------------------------------------------------------ open in another Craft app
  // Same-origin only: the target tab's own file input is filled in and its change handler fires, so no app needs changing.
  const OPEN_IN = [
    { id: 'xcw', label: 'Open in xCWriter', page: 'xcwriter.html', input: 'filein', kinds: ['text', 'atascii', 'html', 'rtf', 'doc'] },
    { id: 'font', label: 'Open in font editor', page: 'fontedit.html', input: 'file', kinds: ['font'] },
    { id: 'pdf', label: 'Open in PDF viewer', page: 'pdfview.html', input: 'file', kinds: ['pdf'] },
    { id: 'ebc', label: 'Open / convert in EBookCraft', page: 'ebookcraft.html', input: 'file', kinds: ['ebook', 'pdf', 'text', 'html', 'rtf', 'doc'] },
  ];
  async function handoff(t, name, bytes) {
    const w = window.open(t.page, '_blank');
    if (!w) { log('The browser blocked the new tab; allow pop-ups for this page', 'e'); return false; }
    try {
      const t0 = Date.now();
      for (;;) { // reading w.document throws if the page is cross-origin (file://)
        if (w.document.readyState === 'complete' && w.document.getElementById(t.input)) break;
        if (Date.now() - t0 > 15000) throw new Error('the page did not load');
        await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((r) => setTimeout(r, 250));
      const dt = new w.DataTransfer(); dt.items.add(new w.File([bytes], name));
      const inp = w.document.getElementById(t.input); inp.files = dt.files; inp.dispatchEvent(new w.Event('change', { bubbles: true }));
      log('Sent ' + name + ' to ' + t.page); return true;
    } catch (e) { saveAs(name, bytes); log('Could not hand ' + name + ' to ' + t.page + ' (' + e.message + '). It was downloaded: open it there with Open. Serve this page over http (start.cmd) for the direct handoff.', 'w'); return false; }
  }

  function saveAs(name, bytes) { const a = el('a'); a.href = URL.createObjectURL(new Blob([bytes])); a.download = name; document.body.append(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 1000); }

  // ------------------------------------------------------------ disk images
  function browseDisk(m, name) {
    state.disk = { m, name, dir: '', back: state.loc || { scheme: 'mem', host: '', path: '/' } }; showTab('files'); refresh();
  }
  async function browseDrive(n) {
    const r = await quiet('emu.disk.read', { drive: n }); if (!r) return;
    const nm = (((await quiet('emu.disks')) || { meta: { value: { disks: [] } } }).meta.value.disks[n - 1] || {}).name || 'D' + n + '.atr';
    const m = AC.AfmCore.mount(r.body, nm); if (!m) { log('D' + n + ' is not a readable disk image', 'w'); return; }
    browseDisk(m, nm);
  }
  async function mountBytes(n, name, bytes) {
    try { await rpc('emu.mount', { drive: n, name }, bytes); log('D' + n + ' <- ' + name); if (state.tab === 'drives') refreshDrives(); renderRes(); return true; }
    catch (e) { return false; }
  }

  // Build a disk image from a folder (SDFS) and mount it; recursive, capped
  async function folderToDisk(n) {
    const files = []; let total = 0;
    async function walk(path, rel) {
      const r = await rpc('fs.list', fa({ path }));
      for (const e of r.meta.value) {
        if (e.name === '.' || e.name === '..') continue;
        if (e.dir) { await walk(join(path, e.name), rel + e.name + '/'); continue; }
        if (files.length >= 300 || total + e.size > 8 << 20) throw new Error('folder is too big for a disk image (limit 300 files / 8 MB)');
        files.push({ path: rel + e.name, data: (await rpc('fs.read', fa({ path: join(path, e.name) }))).body }); total += e.size;
      }
    }
    await walk(state.loc.path, '');
    const img = AC.DosFs.buildSdfs(files, { label: (state.loc.host || state.loc.scheme).toUpperCase().slice(0, 8) });
    return mountBytes(n, (state.loc.path.split('/').filter(Boolean).pop() || state.loc.scheme) + '.atr', img.image);
  }

  // ------------------------------------------------------------ file actions
  function paintActions() {
    const w = writable(), has = !!state.sel, inDisk = !!state.disk;
    const set = (id, on, why) => { const b = $(id); if (!b) return; b.disabled = !on; b.title = on ? '' : why || ''; };
    const ro = inDisk ? 'Disk images are browsed read-only; copy files out with Download' : 'Writes are off: start the relay with --allow-write';
    set('upload', w, ro); set('mkdir', w, ro); set('rename', w && has, has ? ro : 'Select a file first'); set('delete', w && has, has ? ro : 'Select a file first');
    set('download', has && !(state.sel && state.sel.dir), 'Select a file first'); set('up', !!state.loc, '');
  }
  async function doUpload(files) {
    if (!writable()) { log('Upload refused: writes are off for this resource', 'e'); return; }
    for (const f of files) { try { await rpc('fs.write', fa({ path: join(state.loc.path, f.name) }), new Uint8Array(await f.arrayBuffer())); } catch (e) { /* logged */ } }
    await refresh();
  }
  $('upload').onclick = () => $('upfile').click();
  $('upfile').onchange = (e) => { doUpload([...e.target.files]); e.target.value = ''; };
  $('mkdir').onclick = async () => { const n = await ask('New folder name'); if (!n) return; try { await rpc('fs.mkdir', fa({ path: join(state.loc.path, n) })); } catch (e) { /* logged */ } await refresh(); };
  $('rename').onclick = async () => { const e = state.sel; if (!e) return; const n = await ask('Rename ' + e.name + ' to', e.name); if (!n || n === e.name) return; try { await rpc('fs.rename', fa({ path: join(state.loc.path, e.name), to: join(state.loc.path, n) })); } catch (x) { /* logged */ } await refresh(); };
  $('delete').onclick = async () => { const e = state.sel; if (!e) return; if (!(await confirmBox('Delete ' + e.name + (e.dir ? ' (folder)' : '') + '?'))) return; try { await rpc(e.dir ? 'fs.rmdir' : 'fs.unlink', fa({ path: join(state.loc.path, e.name) })); } catch (x) { /* logged */ } await refresh(); };
  $('download').onclick = async () => { const e = state.sel; if (!e || e.dir) return; try { saveAs(e.name, state.bytes && state.name === e.name ? state.bytes : await readEntry(e)); } catch (x) { /* logged */ } };
  $('up').onclick = up; $('refresh').onclick = refresh;
  $('go').onclick = () => { const v = $('path').value; if (state.disk || !state.loc) return; const m = v.match(/^(\w+):(?:\/\/([^/]*))?(.*)$/); if (m) navigate(Object.assign({}, state.loc, { scheme: m[1], host: m[2] || '' }), m[3] || '/'); };
  $('path').onkeydown = (e) => { if (e.key === 'Enter') $('go').click(); };
  const lw = $('listwrap');
  lw.ondragover = (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); lw.classList.add('drag'); } };
  lw.ondragleave = () => lw.classList.remove('drag');
  lw.ondrop = (e) => { lw.classList.remove('drag'); if (e.dataTransfer.files.length) { e.preventDefault(); doUpload([...e.dataTransfer.files]); } };
  const fb = el('button', null, 'Folder \u2192 disk'); fb.id = 'folder2disk'; fb.title = 'Build a SpartaDOS disk image from this folder and mount it in D1';
  fb.onclick = async () => { if (state.disk || !state.loc) return; try { await folderToDisk(1); } catch (e) { log('Folder to disk: ' + e.message, 'e'); } };
  $('bar').append(fb);

  // ------------------------------------------------------------ drives
  async function refreshDrives() {
    const box = $('drives'); box.textContent = '';
    const r = await quiet('emu.disks');
    $('drvnote').textContent = r ? 'Drop a disk image (from your PC, or dragged from the file list or a DOS boot record) onto a drive to mount it in the emulator.' : 'The emulator tab was not found. Open index.html in this browser and boot it; mounting needs the emulator.';
    const list = r ? r.meta.value.disks : Array.from({ length: 8 }, (_, i) => ({ drive: i + 1, name: '', size: 0 }));
    for (const d of list) {
      const c = el('div', 'card'); c.id = 'drive' + d.drive; c.dataset.drive = d.drive;
      c.append(el('h4', null, 'D' + d.drive + ':'), el('div', 'note', d.name ? d.name + ' - ' + fmtSize(d.size) : 'empty'));
      const row = el('div', 'row');
      const mk = (label, fn, dis) => { const b = el('button', null, label); b.disabled = !!dis; b.onclick = fn; row.append(b); return b; };
      mk('Eject', async () => { try { await rpc('emu.eject', { drive: d.drive }); } catch (e) { /* logged */ } refreshDrives(); }, !d.name);
      mk('Browse', () => browseDrive(d.drive), !d.name);
      mk('Save', async () => { const x = await quiet('emu.disk.read', { drive: d.drive }); if (x) saveAs(d.name || 'D' + d.drive + '.atr', x.body); }, !d.name);
      const sw = el('select'); for (let i = 1; i <= 8; i++) if (i !== d.drive) sw.append(new Option('D' + i, i));
      mk('Swap with', async () => { try { await rpc('emu.swap', { from: d.drive, to: +sw.value }); } catch (e) { /* logged */ } refreshDrives(); }, !r); row.append(sw);
      c.append(row);
      c.ondragover = (e) => { e.preventDefault(); c.classList.add('over'); }; c.ondragleave = () => c.classList.remove('over');
      c.ondrop = (e) => { e.preventDefault(); c.classList.remove('over'); dropOnDrive(d.drive, e.dataTransfer); };
      box.append(c);
    }
  }
  async function dropOnDrive(n, dt) {
    try {
      if (dt.files && dt.files.length) { const f = dt.files[0]; await mountBytes(n, f.name, new Uint8Array(await f.arrayBuffer())); }
      else if (dt.getData('application/x-fx-entry')) { const x = JSON.parse(dt.getData('application/x-fx-entry')); const r = await rpc('fs.read', { scheme: x.loc.scheme, host: x.loc.host, user: x.loc.user, pass: x.loc.pass, path: join(x.loc.path, x.name) }); await mountBytes(n, x.name, r.body); }
      else if (dt.getData('application/x-fx-dos')) { const x = JSON.parse(dt.getData('application/x-fx-dos')); await mountDosMedia(x.root, x.media, n); }
    } catch (e) { /* logged */ }
    refreshDrives();
  }
  window.addEventListener('dragover', (e) => { if (!e.target.closest || !e.target.closest('.card, #listwrap')) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (!e.target.closest || !e.target.closest('.card, #listwrap')) e.preventDefault(); });

  // ------------------------------------------------------------ N: network
  function renderNet() {
    const p = $('netpane'); if (p.dataset.built) return; p.dataset.built = 1;
    p.innerHTML = `<div class="note">Requests go through the relay exactly like the Atari's N: device (HTTP, TCP, UDP). PUT, DELETE and PATCH need the relay started with --allow-write. Targets on private networks need --allow-lan.</div>
    <h2>HTTP (N:HTTP://)</h2><div class="form wide"><label>Method</label><select id="hmeth"><option>GET</option><option>HEAD</option><option>POST</option><option>PUT</option><option>DELETE</option><option>PATCH</option></select>
      <label>URL</label><input id="hurl" value="http://example.com/"><label>Headers</label><textarea id="hhead" rows="2" placeholder="Name: value"></textarea><label>Body</label><textarea id="hbody" rows="2"></textarea>
      <span></span><span><button id="hsend" class="on">Send</button> <button id="hsave">Save response</button></span></div><pre class="out" id="hout">(no request yet)</pre>
    <h2>TCP (N:TCP://)</h2><div class="form wide"><label>Host</label><input id="thost" value="127.0.0.1"><label>Port</label><input id="tport" value="80"><label>Send (text)</label><textarea id="tdata" rows="2">GET / HTTP/1.0\\r\\n\\r\\n</textarea>
      <span></span><span><button id="tsend" class="on">Connect, send, read</button></span></div><pre class="out" id="tout">(nothing yet)</pre>
    <h2>UDP (N:UDP://)</h2><div class="form wide"><label>Host</label><input id="uhost" value="127.0.0.1"><label>Port</label><input id="uport" value="9"><label>Send (text)</label><input id="udata" value="ping">
      <span></span><span><button id="usend" class="on">Send and wait 1 s</button></span></div><pre class="out" id="uout">(nothing yet)</pre>`;
    const unesc = (s) => s.replace(/\\r/g, '\r').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    let last = null;
    $('hsend').onclick = async () => {
      const headers = {}; for (const l of $('hhead').value.split('\n')) { const m = l.match(/^\s*([^:]+):\s*(.*)$/); if (m) headers[m[1]] = m[2]; }
      $('hout').textContent = 'sending...';
      try {
        const b = $('hbody').value; const r = await rpc('net.http', { url: $('hurl').value, method: $('hmeth').value, headers }, b ? new TextEncoder().encode(b) : null);
        last = r.body; const m = r.meta;
        $('hout').textContent = 'HTTP ' + m.status + '\n' + (m.headers || []).map((h) => h[0] + ': ' + h[1]).join('\n') + '\n\n' + (P.isText(r.body) ? new TextDecoder().decode(r.body.subarray(0, 20000)) : P.hexdump(r.body, 512));
      } catch (e) { $('hout').textContent = e.name + ': ' + e.message; }
    };
    $('hsave').onclick = () => { if (last) saveAs('response.bin', last); };
    $('tsend').onclick = async () => {
      let id = null; $('tout').textContent = 'connecting...';
      try {
        id = (await rpc('net.tcp.open', { host: $('thost').value, port: +$('tport').value })).meta.id;
        await rpc('net.tcp.write', { id }, new TextEncoder().encode(unesc($('tdata').value)));
        let got = new Uint8Array(0);
        for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 200)); const r = await rpc('net.tcp.read', { id, n: 4096 }); const n = new Uint8Array(got.length + r.body.length); n.set(got); n.set(r.body, got.length); got = n; if (r.meta.eof) break; }
        $('tout').textContent = got.length + ' bytes\n' + (P.isText(got) ? new TextDecoder().decode(got.subarray(0, 20000)) : P.hexdump(got, 512));
      } catch (e) { $('tout').textContent = e.name + ': ' + e.message; } finally { if (id != null) await quiet('net.tcp.close', { id }); }
    };
    $('usend').onclick = async () => {
      let id = null; $('uout').textContent = 'sending...';
      try {
        id = (await rpc('net.udp.open', { host: $('uhost').value })).meta.id;
        await rpc('net.udp.send', { id, host: $('uhost').value, port: +$('uport').value }, new TextEncoder().encode(unesc($('udata').value)));
        await new Promise((r) => setTimeout(r, 1000)); const r = await rpc('net.udp.read', { id });
        $('uout').textContent = r.body.length ? r.body.length + ' bytes\n' + new TextDecoder().decode(r.body) : 'no reply within 1 s (UDP may not answer)';
      } catch (e) { $('uout').textContent = e.name + ': ' + e.message; } finally { if (id != null) await quiet('net.udp.close', { id }); }
    };
  }

  // ------------------------------------------------------------ printer
  function renderPrinterShell() {
    const p = $('prpane'); if (p.dataset.built) return; p.dataset.built = 1;
    p.innerHTML = '<div class="note">Output the Atari sent to P: (virtual printer in the emulator tab).</div><div style="margin:6px 0"><button id="prref">Refresh</button> <label class="note"><input type="checkbox" id="prauto" checked> auto</label> <button id="prsave">Save text</button> <button id="prcopy">Copy</button> <button id="prclear">Clear</button> <span class="note" id="prinfo"></span></div><pre class="paper" id="paper"></pre>';
    $('prref').onclick = refreshPrinter; $('prclear').onclick = async () => { await quiet('emu.printer.clear'); refreshPrinter(); };
    $('prsave').onclick = () => saveAs('printer.txt', new TextEncoder().encode($('paper').textContent));
    $('prcopy').onclick = () => navigator.clipboard && navigator.clipboard.writeText($('paper').textContent).catch(() => {});
  }
  async function refreshPrinter() {
    renderPrinterShell();
    const r = await quiet('emu.printer');
    if (!r) { $('prinfo').textContent = 'emulator not reachable'; return; }
    $('paper').textContent = r.meta.value.count ? r.meta.value.text : ''; $('prinfo').textContent = r.meta.value.count + ' line(s)';
  }

  // ------------------------------------------------------------ clock and settings
  async function renderSettings() {
    const p = $('setpane'); p.textContent = '';
    const sec = (t) => { p.append(el('h2', null, t)); const d = el('div'); p.append(d); return d; };
    const c = sec('Clock'); c.id = 'clock';
    const rc = caps(), et = await quiet('emu.time');
    const now = Date.now(), skew = (a) => (a == null ? 'n/a' : (a - now >= 0 ? '+' : '') + (a - now) + ' ms');
    c.innerHTML = '<div class="form"><label>This browser</label><span id="clkb">' + esc(new Date(now).toString()) + '</span><label>Relay PC</label><span id="clkr">' + (rc && rc.time ? esc(new Date(rc.time).toString()) + ' (' + skew(rc.time) + ' from the browser, UTC' + (rc.tzOffset > 0 ? '-' : '+') + Math.abs(rc.tzOffset) / 60 + ')' : 'not reported (old relay or offline)') + '</span><label>Emulator tab</label><span id="clke">' + (et ? esc(et.meta.value.iso) + ' (' + et.meta.value.tz + ', ' + skew(et.meta.value.now) + ')' : 'emulator not reachable') + '</span></div><div class="note">The Atari reads the browser clock when it asks FujiNet for the time.</div>';
    const f = sec('FujiNet (hosts and device slots)'); f.id = 'fnbox';
    const fj = await quiet('emu.fujinet.get');
    if (!fj) f.append(el('div', 'note', 'Needs the emulator tab with FujiNet on.'));
    else {
      const v = fj.meta.value, form = el('div', 'form');
      form.append(el('label', null, 'FujiNet on'), (() => { const x = el('input'); x.type = 'checkbox'; x.checked = v.enabled; x.id = 'fnon'; return x; })());
      v.hosts.forEach((h, i) => { form.append(el('label', null, 'Host ' + (i + 1) + (i === 0 ? ' (SD)' : '')), (() => { const x = el('input'); x.value = h; x.id = 'fnhost' + i; x.disabled = i === 0; return x; })()); });
      f.append(form);
      const tb = el('table', 'segs'); tb.innerHTML = '<tr><th>Slot</th><th>Host</th><th>Mode</th><th>Path</th></tr>';
      v.slots.forEach((s, i) => { const r = el('tr'); r.innerHTML = '<td>D' + (i + 1) + '</td><td>' + (s.host === 255 ? '-' : 'host ' + (s.host + 1) + ' (' + esc(v.hosts[s.host] || '') + ')') + '</td><td>' + (s.mode === 2 ? 'write' : 'read') + '</td><td>' + esc(s.path || '') + '</td>'; tb.append(r); });
      f.append(tb);
      const ap = el('button', 'on', 'Apply FujiNet settings'); ap.id = 'fnapply'; ap.onclick = async () => { const hosts = v.hosts.map((_, i) => $('fnhost' + i).value); try { await rpc('emu.fujinet.set', { hosts, enabled: $('fnon').checked }); } catch (e) { /* logged */ } renderSettings(); renderRes(); };
      f.append(ap);
    }
    const n = sec('Network (what the Atari sees)'); n.id = 'netbox';
    const ni = await quiet('emu.net.get');
    if (!ni) n.append(el('div', 'note', 'Needs the emulator tab.'));
    else {
      const ip = ni.meta.value.ip, form = el('div', 'form');
      for (const k of ['ssid', 'hostname', 'ip', 'gw', 'mask', 'dns']) { form.append(el('label', null, k), (() => { const x = el('input'); x.id = 'ip_' + k; x.value = ip[k] || ''; return x; })()); }
      n.append(form);
      const ap = el('button', 'on', 'Apply network settings'); ap.id = 'ipapply'; ap.onclick = async () => { const o = {}; for (const k of ['ssid', 'hostname', 'ip', 'gw', 'mask', 'dns']) o[k] = $('ip_' + k).value; try { await rpc('emu.net.set', { ip: o }); } catch (e) { /* logged */ } renderSettings(); };
      n.append(ap);
    }
    const r = sec('Connection'); r.id = 'conbox';
    const st = X.status();
    r.innerHTML = '<pre class="out" id="statjson">' + esc(JSON.stringify(st, null, 2)) + '</pre><div class="note">Relay address and token are in the header; they are remembered in this browser only.</div>';
  }

  // ------------------------------------------------------------ DOS boot records
  async function mountDosMedia(root, md, n) {
    const r = await rpc('dosboot.media', { root, path: md.path, member: md.member || '' });
    await mountBytes(n, (md.member || md.path).split(/[\\/]/).pop(), r.body);
  }
  async function renderDos() {
    const p = $('dospane'); p.textContent = '';
    p.append(el('div', 'note', 'Boot records from the relay (scripts/dosboot-scan.cjs, --dos DIR). Mount a record\'s media in the emulator, or drag a record onto a drive on the Drives tab. Same-origin only: open this page through the relay address.'));
    const r = await quiet('dosboot.roots');
    if (!r) { p.append(el('div', 'note', 'No dosboot data (relay not reachable, or this page was not opened through the relay).')); return; }
    const roots = r.meta.value.roots;
    if (!roots.length) p.append(el('div', 'note', 'No DOS boot folders registered. Run: node scripts\\dosboot-scan.cjs "C:\\path\\to\\DOS"'));
    for (const rt of roots) {
      p.append(el('h2', null, rt.root));
      const bx = el('div', 'cards');
      for (const rec of rt.doc.records || []) {
        const c = el('div', 'card'); c.draggable = true; c.dataset.rec = rec.id;
        c.ondragstart = (e) => { const md = (rec.media || []).find((m) => m.role === 'boot') || (rec.media || [])[0]; e.dataTransfer.setData('application/x-fx-dos', JSON.stringify({ root: rt.i, media: md })); };
        c.append(el('h4', null, rec.name), el('div', 'note', (rec.family || rec.kind || '') + ' ' + (rec.version || '') + ' - boot ' + ((rec.boot && rec.boot.target) || '?')));
        const row = el('div', 'row');
        for (const md of rec.media || []) { const b = el('button', null, 'Mount ' + md.slot); b.onclick = async () => { try { await mountDosMedia(rt.i, md, +md.slot.slice(1)); } catch (e) { /* logged */ } }; row.append(b); }
        c.append(row); bx.append(c);
      }
      p.append(bx);
      const rs = el('button', null, 'Rescan folder'); rs.id = 'dosrescan'; rs.disabled = caps() && caps().allowWrite === false; rs.title = rs.disabled ? 'Rescan writes dosboot.json: start the relay with --allow-write' : '';
      rs.onclick = async () => { try { await rpc('dosboot.rescan', { root: rt.i }); } catch (e) { /* logged */ } renderDos(); };
      p.append(rs);
    }
  }

  // ------------------------------------------------------------ start
  $('relayUrl').value = store.get('ac.tnfsbridge', '') || (/^https?:/.test(location.protocol) ? location.origin : '');
  $('token').value = store.get('ac.nettoken', '');
  $('reconnect').onclick = () => { store.set('ac.tnfsbridge', $('relayUrl').value); store.set('ac.nettoken', $('token').value); build(); };
  window.FujiExplorer = { transport: () => X, state, navigate, refresh, mountBytes, browseDisk, rpc, mockEmu: () => mockEmu, showTab, ready: null };
  window.FujiExplorer.ready = build().then(() => { showTab('files'); paintActions(); });
})();
