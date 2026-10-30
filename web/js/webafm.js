// WebAFM: two-pane file explorer for Atari disk images. All disk logic lives in afmcore.js; this file is only the page.
(() => {
  const AC = window.AC, C = AC.AfmCore, host = () => AC.WebAfmHost;
  const W = { el: null, mounts: new Map(), panes: [], active: 0, undo: [], seq: 0, drag: null, conflict: 'error', lnLoad: localStorage.getItem('ac.wafm.lnLoad') !== '0', lnSave: localStorage.getItem('ac.wafm.lnSave') !== '0' };
  const newPane = () => ({ src: null, dir: '', sel: new Set(), cur: '', anchor: '', sort: { k: 'name', asc: true }, filter: '', tree: false, collapsed: new Set() });
  W.panes = [newPane(), newPane()];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B');
  const log = (s) => { setStatus(s); try { host().log(s); } catch (e) { /* none */ } };
  const parentOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
  const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
  const rec = (p) => (p.src ? W.mounts.get(p.src) : null);
  const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  const CSS = `
  #wafm{position:fixed;inset:0;z-index:9000;background:#14161a;color:#d8dce4;display:flex;flex-direction:column;font:13px system-ui,sans-serif}
  #wafm button,#wafm select,#wafm input{background:#2a2f39;color:#d8dce4;border:1px solid #2c313b;border-radius:5px;padding:4px 9px;font:inherit}
  #wafm button{cursor:pointer}#wafm button:hover{background:#343a47}#wafm button:disabled{opacity:.35;cursor:not-allowed;text-decoration:line-through;text-decoration-color:#0000}#wafm button:disabled:hover{background:#2a2f39}
  #wafm .caps{margin-top:4px;display:flex;flex-wrap:wrap;gap:3px 8px;font-size:11px}#wafm .cap.yes{color:#6fcf8a}#wafm .cap.no{color:#7d838f;opacity:.55;text-decoration:line-through}
  #wafm .wtb{display:flex;gap:6px;flex-wrap:wrap;padding:8px;background:#1e2128;border-bottom:1px solid #2c313b;align-items:center}
  #wafm .wtb h2{margin:0 10px 0 0;font-size:15px;color:#e8a33d}#wafm .sp{flex:1}#wafm .lnc{font-size:12px;color:#aab;display:flex;align-items:center;gap:3px;white-space:nowrap}
  #wafm .wpanes{flex:1;display:flex;gap:8px;padding:8px;min-height:0}
  #wafm .wp{flex:1;min-width:0;display:flex;flex-direction:column;border:2px solid #2c313b;border-radius:8px;background:#1b1e24}
  #wafm .wp.act{border-color:#e8a33d}
  #wafm .wph{display:flex;gap:5px;padding:6px;align-items:center;flex-wrap:wrap}
  #wafm .wcrumb{padding:2px 8px;color:#e8a33d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #wafm .wcrumb a{cursor:pointer;color:#e8a33d}#wafm .wcrumb a:hover{text-decoration:underline}
  #wafm .winfo{padding:2px 8px;color:#8a93a3;font-size:12px}
  #wafm .bar{position:relative;height:10px;margin:2px 8px 6px;background:#0d0f12;border-radius:5px;overflow:hidden;border:1px solid #2c313b}
  #wafm .bar i{position:absolute;top:0;bottom:0}#wafm .bar .u{left:0;background:#5b7fb5}#wafm .bar .pd{background:repeating-linear-gradient(45deg,#e8a33d,#e8a33d 4px,#b07a20 4px,#b07a20 8px)}#wafm .bar.bad .pd{background:#d04545}
  #wafm .wl{flex:1;overflow:auto;min-height:0;border-top:1px solid #2c313b}
  #wafm table{border-collapse:collapse;width:100%}#wafm th{position:sticky;top:0;background:#232730;text-align:left;font-weight:600;padding:4px 6px;cursor:pointer;user-select:none;border-bottom:1px solid #2c313b}
  #wafm td{padding:3px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px}
  #wafm tr.r{cursor:default;user-select:none}#wafm tr.r:hover{background:#262b34}#wafm tr.sel{background:#2f3a52}#wafm tr.cur td:first-child{box-shadow:inset 3px 0 #e8a33d}
  #wafm tr.dropt{outline:2px dashed #e8a33d}#wafm td.n small{color:#8a93a3;margin-left:6px}#wafm td.num{text-align:right;color:#aab}
  #wafm tr.wix td{color:#8a93a3}
  #wafm .wpt{padding:4px 10px;background:#14161a;border-top:1px solid #2c313b;color:#9bd1ff;font:12px Consolas,monospace;min-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #wafm .wst{padding:6px 10px;background:#1e2128;border-top:1px solid #2c313b;color:#e8a33d;min-height:18px}
  #wafm .wxf{padding:6px 10px;background:#171a20;border-top:1px solid #2c313b;font-size:12px}
  #wafm .wxf[hidden]{display:none}
  #wafm .wxf .r1{display:flex;gap:12px;align-items:center}#wafm .wxf .xt{color:#8fb8ff}#wafm .wxf .xs{flex:1;text-align:right;color:#aab}
  #wafm .wxf .xc{padding:1px 10px}#wafm .wxf .xf{color:#cfd3da;margin:3px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #wafm .wxf .xb{position:relative;height:16px;background:#232733;border:1px solid #39404f;border-radius:3px;overflow:hidden}
  #wafm .wxf .xb i{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#2b6fd6,#4aa3ff)}
  #wafm .wxf .xb.done i{background:#3aa55d}#wafm .wxf .xb.bad i{background:#c2503f}
  #wafm .wxf .xp{position:absolute;right:6px;top:0;line-height:16px;font-weight:600;color:#fff;text-shadow:0 0 2px #000}
  #wafm .wdlg{position:absolute;inset:0;background:#000a;display:flex;align-items:center;justify-content:center;z-index:5}
  #wafm .wdb{background:#1e2128;border:1px solid #4a5160;border-radius:10px;padding:14px;min-width:340px;max-width:min(92vw,720px);max-height:88vh;overflow:auto}
  #wafm .wdb h3{margin:0 0 8px;color:#e8a33d}#wafm .wdb .bt{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
  #wafm .wdb button.pri{background:#e8a33d;color:#000;border-color:#e8a33d}#wafm .bad{color:#ff7b7b}#wafm .warn{color:#e8c23d}#wafm .ok{color:#7bd88f}
  #wafm pre{margin:0;font:12px/1.35 Consolas,monospace;white-space:pre;overflow:auto;max-height:55vh;background:#0d0f12;padding:8px;border-radius:6px}
  #wafm textarea{width:70vw;max-width:100%;height:50vh;background:#0d0f12;color:#d8dce4;border:1px solid #2c313b;font:12px Consolas,monospace}
  #wafm .dim{color:#8a93a3}
  `;

  // ---------- small UI helpers ----------
  const KINDS = [
    ['⚙', 'Program', 'COM XEX EXE OBJ BIN CMD'], ['📜', 'BASIC', 'BAS BA LST TUR ACT'], ['📝', 'Text / source', 'TXT DOC ASM SRC MAC M65 H A65 INC LIB MD'],
    ['🖼', 'Picture', 'PIC MIC GR7 GR8 GR9 GR15 GR11 APL PCT HIP MCH INP RGB VBM IMG'], ['🎵', 'Music', 'MUS CMC MPT RMT TMC TM2 SAP DMC MPD DLT'],
    ['💾', 'Disk image', 'ATR ATX XFD DCM PRO DI'], ['🎮', 'Cartridge', 'CAR ROM'], ['🗜', 'Archive', 'ZIP LZH LHA ARC ARJ SDX 7Z GZ'], ['🔧', 'System', 'SYS DOS DUP AUT'],
    ['🔤', 'Font', 'FNT SET FON CHR'], ['📊', 'Data', 'DAT DTA DB'],
  ];
  const KIND_OF = {}; for (const [ic, nm, ex] of KINDS) for (const x of ex.split(' ')) KIND_OF[x] = [ic, nm];
  function kindOf(e) {
    if (e.dir) return ['📁', 'Folder']; if (e.sidecar) return ['🏷', 'Long-name index'];
    const m = /\.([^.]+)$/.exec(e.name); return (m && KIND_OF[m[1].toUpperCase()]) || ['📄', 'File'];
  }
  const iconOf = (e) => kindOf(e)[0];
  function setStatus(s) { const e = W.el && W.el.querySelector('.wst'); if (e) e.textContent = s; }
  // Transfer panel above the status line: "File 3 of 20", current file, bytes, speed, elapsed and a bar.
  function xferBar(title, nFiles) {
    const box = W.el.querySelector('.wxf'), q = (s) => box.querySelector(s), t0 = performance.now();
    const clock = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    clearTimeout(W.xfHide); W.cancel = false;
    box.hidden = false; q('.xt').textContent = title; q('.xc').hidden = false; q('.xc').disabled = false; q('.xb').className = 'xb';
    q('.xc').onclick = () => { W.cancel = true; q('.xc').disabled = true; q('.xf').textContent = 'Cancelling after the current file…'; };
    const bar = (frac, pctText) => { q('.xb i').style.width = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%'; q('.xp').textContent = pctText; };
    bar(0, '0%'); q('.xs').textContent = ''; q('.xf').textContent = 'Starting…';
    const phaseText = { write: 'Writing', verify: 'Verifying', folder: 'Folder', skip: 'Skipped', done: 'Done', index: 'Updating', cleanup: 'Removing' };
    return {
      update(d, t, label, i) {
        i = i || {}; const sec = (performance.now() - t0) / 1000;
        const frac = i.totalBytes ? i.bytes / i.totalBytes : t ? d / t : 0, rate = sec > 0.05 ? i.bytes / sec : 0;
        const n = i.files ? `File ${Math.min(Math.max(i.file, 1), i.files)} of ${i.files}` : (t ? `${d} of ${t}` : '');
        q('.xf').textContent = `${phaseText[i.phase] || ''} ${label || ''}${i.size ? ' · ' + kb(i.size) : ''}`.trim();
        q('.xs').textContent = [n, i.totalBytes ? kb(i.bytes) + ' / ' + kb(i.totalBytes) : '', rate ? kb(rate) + '/s' : '', clock(sec)].filter(Boolean).join('  ·  ');
        bar(frac, Math.floor(frac * 100) + '%');
      },
      end(text, bad) {
        q('.xc').hidden = true; q('.xb').className = 'xb ' + (bad ? 'bad' : 'done'); bar(1, bad ? 'stopped' : '100%'); q('.xf').textContent = text || '';
        W.xfHide = setTimeout(() => { box.hidden = true; }, 8000);
      },
    };
  }
  function dlg(title, body, buttons) {
    return new Promise((res) => {
      const bk = document.createElement('div'); bk.className = 'wdlg';
      const b = document.createElement('div'); b.className = 'wdb';
      const h = document.createElement('h3'); h.textContent = title; b.append(h);
      if (typeof body === 'string') { const d = document.createElement('div'); d.innerHTML = body; b.append(d); } else if (body) b.append(body);
      const bt = document.createElement('div'); bt.className = 'bt';
      const done = (v) => { bk.remove(); W.el.removeEventListener('keydown', onk, true); if (W.dlgKey === onk) W.dlgKey = null; W.el.focus(); res(v); };
      for (const x of buttons || [{ label: 'OK', value: true, pri: true }]) {
        const k = document.createElement('button'); k.textContent = x.label; if (x.pri) k.className = 'pri';
        k.onclick = () => done(typeof x.value === 'function' ? x.value() : x.value); bt.append(k); x.el = k;
      }
      b.append(bt); bk.append(b); W.el.append(bk);
      const onk = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); done(null); }
        else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'SELECT') { const p = (buttons || [{ pri: 1, el: bt.firstChild }]).find((x) => x.pri); if (p && p.el) { e.stopPropagation(); e.preventDefault(); p.el.click(); } }
      };
      W.el.addEventListener('keydown', onk, true); W.dlgKey = onk;
      const f = b.querySelector('input,textarea,select') || (bt.querySelector('.pri') || bt.firstChild); f && f.focus();
      if (f && f.select) f.select();
    });
  }
  async function ask(title, label, def, extra) {
    const w = document.createElement('div');
    w.innerHTML = `<div class="dim" style="margin-bottom:6px">${esc(label)}</div><input style="width:100%;box-sizing:border-box" value="${esc(def || '')}">${extra ? '<div class="dim" style="margin-top:6px">' + extra + '</div>' : ''}`;
    const r = await dlg(title, w, [{ label: 'Cancel', value: null }, { label: 'OK', value: () => w.querySelector('input').value.trim(), pri: true }]);
    return r;
  }
  const msg = (t, html) => dlg(t, html, [{ label: 'OK', value: true, pri: true }]);

  // ---------- sources ----------
  function mountDrive(n) {
    const d = host().disk(n);
    if (!d) return null;
    const m = C.mount(d.bytes, d.name);
    if (!m) return { err: `D${n}: no DOS 2.x / MyDOS / SpartaDOS-family file system found` };
    return { key: 'D' + n, kind: 'drive', n, name: d.name, m };
  }
  function setDrive(i, n) {
    const r = mountDrive(n);
    const p = W.panes[i];
    if (!r) { log(`D${n}: nothing mounted`); return; }
    if (r.err) { log(r.err); return; }
    W.mounts.set(r.key, r);
    Object.assign(p, { src: r.key, dir: '', sel: new Set(), cur: '', filter: '' });
    render();
    if (W.lnLoad) makeNames(r, true);
  }
  async function openFile(i, file, handle) {
    const bytes = AC.Progress ? await AC.Progress.read(file, 'Loading ' + file.name) : new Uint8Array(await file.arrayBuffer());
    const m = C.mount(bytes, file.name);
    if (!m) { log(`${file.name}: no DOS 2.x / MyDOS / SpartaDOS-family file system found`); return; }
    const key = 'F' + (++W.seq);
    const nr = { key, kind: 'file', name: file.name, m, handle: handle || null, unsaved: false };
    W.mounts.set(key, nr);
    Object.assign(W.panes[i], { src: key, dir: '', sel: new Set(), cur: '', filter: '' });
    render();
    if (W.lnLoad) makeNames(nr, true);
  }
  async function openFolder(i, handle) {
    const pg = AC.Progress ? AC.Progress.begin('Reading folder ' + handle.name + '…', 0) : null;
    let vol;
    try { vol = await AC.FolderFs.load(handle, (s) => { if (pg) pg.text(`Reading ${s.files} files · ${kb(s.bytes)}`); }); }
    catch (e) { log('folder ' + handle.name + ': ' + e.message); return; }
    finally { if (pg) pg.end(); }
    const m = { vol, bytes: null, name: handle.name, kind: 'folder', dirty: false, from: null };
    const key = 'F' + (++W.seq), nr = { key, kind: 'folder', name: handle.name, m, handle, unsaved: false };
    W.mounts.set(key, nr);
    Object.assign(W.panes[i], { src: key, dir: '', sel: new Set(), cur: '', filter: '' });
    if (vol.skipped.length) log(`${handle.name}: ${vol.skipped.length} file(s) could not be read and are left alone (${vol.skipped[0]})`);
    if (W.lnLoad && vol.primeNames()) { C.refresh(m); await commit(nr); }
    render();
  }
  async function pickFolder(i) {
    if (!window.showDirectoryPicker) return log('Folder drives need a Chromium browser (Chrome or Edge) with the File System Access API.');
    try { openFolder(i, await showDirectoryPicker({ id: 'ataricraft-wafm-folder', mode: 'readwrite' })); } catch (e) { if (e.name !== 'AbortError') log('folder: ' + e.message); }
  }
  // Re-read a folder drive from the PC (picks up changes made outside WebAFM).
  async function reloadFolder(r) {
    try { r.m = { vol: await AC.FolderFs.load(r.handle), bytes: null, name: r.name, kind: 'folder', dirty: false, from: null }; r.unsaved = false; } catch (e) { log('reload ' + r.name + ': ' + e.message); }
  }
  async function pickFile(i) {
    try {
      if (window.showOpenFilePicker) {
        const [h] = await showOpenFilePicker({ id: 'ataricraft-wafm', multiple: false, types: [{ description: 'Atari disk images', accept: { 'application/octet-stream': ['.atr', '.xfd', '.dsk', '.img'] } }] });
        return openFile(i, await h.getFile(), h);
      }
    } catch (e) { if (e.name === 'AbortError') return; }
    const inp = document.createElement('input'); inp.type = 'file';
    inp.onchange = () => inp.files[0] && openFile(i, inp.files[0]);
    inp.click();
  }
  function open(a) {
    build();
    W.el.style.display = 'flex';
    refreshDrives();
    if (a && a.drive) setDrive(a.pane || 0, a.drive);
    else if (!W.panes[0].src) { for (let n = 1; n <= 8; n++) if (host().disk(n)) { setDrive(0, n); break; } }
    render(); W.el.focus();
  }
  async function close() {
    if (W.lnSave) for (const r of new Set(W.panes.map(rec))) if (r) await makeNames(r, true);
    if (W.el) W.el.style.display = 'none';
  }
  function refreshDrives() {
    for (const [k, r] of [...W.mounts]) if (r.kind === 'drive') {
      const nr = mountDrive(r.n);
      if (nr && !nr.err) W.mounts.set(k, nr); else { W.mounts.delete(k); for (const p of W.panes) if (p.src === k) Object.assign(p, { src: null, dir: '', sel: new Set() }); }
    }
  }

  // ---------- persistence and undo ----------
  async function commit(r) {
    if (r.kind === 'drive') { host().commit(r.n, r.m.bytes); return; }
    if (r.kind === 'folder') {
      try { await r.m.vol.flush(); r.unsaved = false; } catch (e) { r.unsaved = true; log('could not write folder ' + r.name + ': ' + e.message); }
      return;
    }
    r.unsaved = true;
    if (r.handle) await saveFile(r, true);
  }
  async function saveFile(r, quiet) {
    try {
      if (r.handle) {
        if ((await r.handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('permission denied');
        const w = await r.handle.createWritable(); await w.write(r.m.bytes); await w.close();
        r.unsaved = false; if (!quiet) log('saved ' + r.name); return;
      }
    } catch (e) { log('could not write ' + r.name + ' in place (' + e.message + '); use Save as…'); }
    if (!r.handle) { host().save(r.name, r.m.bytes); r.unsaved = false; log('downloaded ' + r.name); }
  }
  function snapshot(label, recs) {
    const seen = new Set(), snaps = [];
    for (const r of recs) if (r && r.m.bytes && !seen.has(r.key)) { seen.add(r.key); snaps.push({ key: r.key, bytes: r.m.bytes.slice() }); }
    if (recs.some((r) => r && r.kind === 'folder')) W.undo.length = 0; // PC folders are written straight away and cannot be undone
    if (!snaps.length) return;
    W.undo.push({ label, snaps }); if (W.undo.length > 6) W.undo.shift();
  }
  async function undo() {
    const u = W.undo.pop(); if (!u) return log('nothing to undo');
    for (const s of u.snaps) {
      const r = W.mounts.get(s.key); if (!r) continue;
      r.m.bytes.set(s.bytes); r.m = C.mount(r.m.bytes, r.name);
      await commit(r);
    }
    for (const p of W.panes) { p.sel = new Set(); }
    log('undone: ' + u.label); render();
  }
  async function afterWrite(recs) { const seen = new Set(); for (const r of recs) if (r && !seen.has(r.key)) { seen.add(r.key); if (W.lnSave) fillNames(r, true); C.refresh(r.m); await commit(r); } }

  // Fill LONGNAME.TXT from the scan title database (host.titleFor); returns a one-line summary or '' when nothing changed.
  function fillNames(r, quiet, force) {
    if (r.kind === 'folder') {
      const n = r.m.vol.primeNames(!!force);
      if (n) C.refresh(r.m);
      const s = n ? `${r.name}: LONGNAME.TXT updated in ${n} folder(s)` : '';
      if (s && !quiet) log(s);
      return { res: { written: n }, s };
    }
    const res = C.syncLongNames(r.m, { lookup: (n) => (host().titleFor ? host().titleFor(n) : '') });
    const bits = [res.added && res.added + ' added', res.upgraded && res.upgraded + ' titled', res.pruned && res.pruned + ' removed'].filter(Boolean);
    const s = bits.length ? `${r.name}: LONGNAME.TXT ${bits.join(', ')}` : '';
    if (res.skipped) log(`${r.name}: LONGNAME.TXT not updated — ${res.skipped}`);
    else if (s && !quiet) log(s);
    return { res, s };
  }
  async function makeNames(r, auto) {
    if (!r) return;
    const { res, s } = fillNames(r, true, !auto);
    if (!res.written) { if (!auto) log(res.skipped ? `${r.name}: LONGNAME.TXT not updated — ${res.skipped}` : `${r.name}: LONGNAME.TXT already lists every file`); return; }
    C.refresh(r.m); await commit(r); log(s); render();
  }

  // ---------- listing ----------
  const sorters = {
    name: (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0), long: (a, b) => (a.long || a.name).localeCompare(b.long || b.name),
    size: (a, b) => a.size - b.size, sectors: (a, b) => a.sectors - b.sectors, date: (a, b) => (a.date || a.added || '').localeCompare(b.date || b.added || ''),
  };
  function rowsOf(p) {
    const r = rec(p); if (!r) return [];
    const out = [], s = sorters[p.sort.k] || sorters.name, dirn = p.sort.asc ? 1 : -1;
    const ord = (l) => l.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : s(a, b) * dirn));
    if (p.filter) {
      const f = p.filter.toLowerCase();
      for (const e of C.entries(r.m)) {
        if (!(e.name.toLowerCase().includes(f) || e.path.toLowerCase().includes(f))) continue;
        const l = C.listDir(r.m, parentOf(e.path)).find((x) => x.path === e.path); if (l) out.push({ ...l, depth: 0, flat: true });
      }
      return out;
    }
    if (p.tree) {
      const walk = (dir, depth) => { for (const e of ord(C.listDir(r.m, dir))) { out.push({ ...e, depth }); if (e.dir && !p.collapsed.has(e.path)) walk(e.path, depth + 1); } };
      walk('', 0); return out;
    }
    for (const e of ord(C.listDir(r.m, p.dir))) out.push({ ...e, depth: 0 });
    return out;
  }
  const selItems = (p) => { const r = rec(p); if (!r) return []; const ex = new Set(C.entries(r.m).map((e) => e.path)); return [...p.sel].filter((x) => ex.has(x)); };

  // ---------- rendering ----------
  function build() {
    if (W.el) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    const el = W.el = document.createElement('div'); el.id = 'wafm'; el.tabIndex = 0;
    el.innerHTML = `<div class="wtb"><h2>WebAFM</h2>
      <button data-a="copy" title="F5">Copy ▶</button><button data-a="move" title="F6">Move ▶</button>      <button data-a="mkdir" title="F7">New folder</button><button data-a="az" title="Make one-letter folders A-Z and/or 0-9 here">A–Z / 0–9 folders</button><button data-a="dup" title="Make a copy of the selected file(s) in this folder">Make copy</button><button data-a="rename" title="F2">Rename</button><button data-a="del" title="F8 / Delete">Delete</button><button data-a="props" title="Alt+Enter">Properties</button><button data-a="view" title="F3">View / edit</button><button data-a="export" title="Download the selected files">Save to PC</button><button data-a="unarc" title="List and unpack the archive (ZIP, ARC, LZH, ALF, 7z...) selected on this disk into the other pane's disk, or into this folder">Unpack archive</button><button data-a="cart" title="Cartridge images: see the CAR header, strip it to a raw ROM, or add one. Uses the selected file, or asks for one from the PC">Cartridge…</button><button data-a="mkzip" title="Pack the selected files into a ZIP on this disk">Make ZIP</button><button data-a="import" title="Add files from the PC or from the scanned media library">Add files ▾</button>      <button data-a="all" title="Ctrl+A">Tag all</button><button data-a="undo" title="Ctrl+Z">Undo</button><button data-a="newdisk">New disk…</button><button data-a="f2d" title="Pack a PC folder onto one disk, or span it over a set of disks of a chosen size">Folder → disk(s)…</button><button data-a="compare">Compare panes</button><button data-a="sectors" title="Raw sector editor for the disk in the active pane">Disk editor</button><button data-a="refresh">Refresh</button><button data-a="names" title="Write LONGNAME.TXT for every file on this disk, using the scan title database where it knows the name">Make LONGNAME.TXT</button>
      <label class="lnc" title="Update LONGNAME.TXT whenever a disk is opened"><input type="checkbox" data-k="lnLoad"> on load</label><label class="lnc" title="Update LONGNAME.TXT whenever changes are written to a disk"><input type="checkbox" data-k="lnSave"> on save</label>
      <span class="sp"></span><button data-a="close">✕ Close</button></div>
      <div class="wpanes"></div><div class="wxf" hidden><div class="r1"><b class="xt"></b><span class="xs"></span><button class="xc">Cancel</button></div><div class="r2 xf"></div><div class="xb"><i></i><span class="xp"></span></div></div><div class="wst">Ready. Tab switches panes · F5 copy · F6 move · F7 folder · F8 delete · drag between panes.</div><div class="wpt" title="Where you are"></div>`;
    document.body.append(el);
    const pn = el.querySelector('.wpanes');
    W.panes.forEach((p, i) => {
      const d = document.createElement('div'); d.className = 'wp'; d.dataset.i = i;
      d.innerHTML = `<div class="wph"><select class="src"></select><button class="up" title="Up one folder (Backspace)">⬆</button><button class="tg" title="Switch between folder view and full tree">Tree</button><button class="sv" title="Write the disk image to the PC">Save as…</button><input class="flt" placeholder="find in disk…" style="flex:1;min-width:80px"></div>
        <div class="wcrumb"></div><div class="winfo"></div><div class="bar"><i class="u"></i><i class="pd"></i></div><div class="wl"></div>`;
      pn.append(d); wirePane(d, i);
    });
    el.querySelector('.wtb').onclick = (e) => { const b = e.target.closest('button'); if (b) act(b.dataset.a); };
    for (const c of el.querySelectorAll('.wtb input[data-k]')) { c.checked = !!W[c.dataset.k]; c.onchange = () => { W[c.dataset.k] = c.checked; localStorage.setItem('ac.wafm.' + c.dataset.k, c.checked ? '1' : '0'); }; }
    el.addEventListener('keydown', onKey);
  }
  function wirePane(d, i) {
    const p = W.panes[i];
    // Only flag the pane here; a full render would replace the row under the cursor and swallow the click.
    d.addEventListener('mousedown', () => { if (W.active !== i) { W.active = i; W.el.querySelectorAll('.wp').forEach((x) => x.classList.toggle('act', +x.dataset.i === i)); updateTb(); } }, true);
    d.querySelector('.src').onchange = (e) => {
      const v = e.target.value; e.target.value = p.src || '';
      if (v === 'pc') pickFile(i); else if (v === 'folder') pickFolder(i); else if (v === 'lib') importLib(i); else if (v.startsWith('D')) setDrive(i, +v.slice(1)); else if (v.startsWith('F')) { Object.assign(p, { src: v, dir: '', sel: new Set() }); render(); }
    };
    d.querySelector('.up').onclick = () => { p.dir = parentOf(p.dir); p.sel = new Set(); render(); };
    d.querySelector('.tg').onclick = () => { p.tree = !p.tree; render(); };
    d.querySelector('.sv').onclick = () => { const r = rec(p); if (r) host().save(r.name, r.m.bytes), (r.unsaved = false), render(); };
    d.querySelector('.flt').oninput = (e) => { p.filter = e.target.value; render(); };
    const l = d.querySelector('.wl');
    l.onclick = (e) => rowClick(i, e);
    // Rows are rebuilt on every click, so the browser's dblclick can miss; use the click count instead.
    l.onclick = (e) => { const tr = e.target.closest('tr.r'); if (e.detail === 2 && tr && !e.target.classList.contains('ck')) { openRow(i, tr.dataset.p, tr.dataset.up === '1'); return; } const th = e.target.closest('th[data-k]'); if (th) { const k = th.dataset.k; p.sort = { k, asc: p.sort.k === k ? !p.sort.asc : true }; render(); } else rowClick(i, e); };
    l.addEventListener('contextmenu', (e) => { e.preventDefault(); const tr = e.target.closest('tr.r'); if (tr && tr.dataset.p && !p.sel.has(tr.dataset.p)) { p.sel = new Set([tr.dataset.p]); p.cur = tr.dataset.p; render(); } ctxMenu(i, e.clientX, e.clientY); });
    d.addEventListener('dragover', (e) => { e.preventDefault(); const tr = e.target.closest('tr.r'); l.querySelectorAll('.dropt').forEach((x) => x.classList.remove('dropt')); if (tr && tr.dataset.dir === '1') tr.classList.add('dropt'); });
    d.addEventListener('dragleave', () => l.querySelectorAll('.dropt').forEach((x) => x.classList.remove('dropt')));
    d.addEventListener('drop', async (e) => {
      e.preventDefault(); l.querySelectorAll('.dropt').forEach((x) => x.classList.remove('dropt'));
      const tr = e.target.closest('tr.r'), toDir = tr && tr.dataset.dir === '1' ? tr.dataset.p : p.dir;
      if (W.drag) { const dg = W.drag; W.drag = null; if (dg.from !== i || toDir !== p.dir) xfer(e.shiftKey || e.ctrlKey ? true : false, dg.from, dg.items, i, toDir); return; }
      const files = [...e.dataTransfer.files]; if (!files.length) return;
      if (!rec(p)) return openFile(i, files[0]);
      addFiles(i, files, toDir);
    });
  }
  function render() {
    if (!W.el) return;
    W.panes.forEach((p, i) => renderPane(i));
    updateTb();
    pathBar();
  }
  // Full path of the active pane's cursor (or current folder), e.g. D1:\GAMES\ARCADE\PACMAN.COM
  function pathBar() {
    const e = W.el.querySelector('.wpt'); if (!e) return;
    const p = W.panes[W.active], r = rec(p);
    if (!r) { e.textContent = ''; return; }
    const root = r.kind === 'drive' ? 'D' + r.n + ':' : r.name + ':';
    const cur = p.cur && C.entries(r.m).find((x) => x.path === p.cur);
    const path = cur ? cur.path : p.dir || '';
    e.textContent = root + '\\' + path.replace(/\//g, '\\') + (cur && cur.dir ? '\\' : '') + (cur && cur.long ? '   (' + cur.long + ')' : '');
  }
  function updateTb() {
    const a = W.panes[W.active], r = rec(a), o = rec(W.panes[1 - W.active]);
    const need = {
      mkdir: r && C.caps(r.m).mkdir, az: r && C.caps(r.m).mkdir, dup: r && C.caps(r.m).write, rename: r && C.caps(r.m).rename, del: r && C.caps(r.m).del, import: r && C.caps(r.m).import, names: r && C.caps(r.m).longnames,
      copy: o ? C.caps(o.m).write : { ok: false, why: 'open a disk in the other pane first' },
      move: !o ? { ok: false, why: 'open a disk in the other pane first' } : !C.caps(o.m).write.ok ? C.caps(o.m).write : C.caps(r ? r.m : o.m).del,
    };
    for (const b of W.el.querySelectorAll('.wtb button')) {
      const k = b.dataset.a;
      if (b.dataset.t === undefined) b.dataset.t = b.title || '';
      if (!['copy', 'move', 'mkdir', 'az', 'dup', 'rename', 'del', 'props', 'view', 'export', 'import', 'all', 'names'].includes(k)) continue;
      let ok = !!r, why = r ? '' : 'pick a disk first';
      if (r && need[k] && !need[k].ok) { ok = false; why = need[k].why; }
      if (r && (k === 'copy' || k === 'move') && !o) { ok = false; why = 'open a disk in the other pane first'; }
      b.disabled = !ok; b.title = ok ? b.dataset.t : (b.dataset.t ? b.dataset.t + ' — ' : '') + 'not available: ' + why;
    }
    const ud = W.el.querySelector('.wtb [data-a="undo"]'); if (ud) ud.disabled = !W.undo.length;
  }
  function renderPane(i) {
    const p = W.panes[i], d = W.el.querySelector(`.wp[data-i="${i}"]`), r = rec(p);
    d.classList.toggle('act', W.active === i);
    const sel = d.querySelector('.src');
    sel.innerHTML = '<option value="">— choose a disk —</option>';
    for (let n = 1; n <= 8; n++) { const dk = host().disk(n); if (dk) sel.insertAdjacentHTML('beforeend', `<option value="D${n}">D${n}: ${esc(dk.name)}</option>`); }
    for (const [k, x] of W.mounts) if (x.kind === 'file') sel.insertAdjacentHTML('beforeend', `<option value="${k}">PC: ${esc(x.name)}${x.unsaved ? ' ●' : ''}</option>`);
    for (const [k, x] of W.mounts) if (x.kind === 'folder') sel.insertAdjacentHTML('beforeend', `<option value="${k}">PC folder: ${esc(x.name)}${x.unsaved ? ' ●' : ''}</option>`);
    sel.insertAdjacentHTML('beforeend', '<option value="pc">PC disk image…</option><option value="folder">PC folder as a drive…</option><option value="lib">Scanned media library…</option>');
    sel.value = p.src || '';
    d.querySelector('.tg').textContent = p.tree ? 'Folders' : 'Tree';
    { const tg = d.querySelector('.tg'), cp = r ? C.caps(r.m).tree : { ok: false, why: 'pick a disk first' }; tg.disabled = !cp.ok; tg.title = cp.ok ? '' : 'not available: ' + cp.why; }
    d.querySelector('.sv').style.display = r && r.kind === 'file' ? '' : 'none';
    d.querySelector('.sv').textContent = r && r.unsaved ? 'Save as… ●' : 'Save as…';
    const fl = d.querySelector('.flt'); if (fl.value !== p.filter) fl.value = p.filter;
    const info = d.querySelector('.winfo'), bar = d.querySelector('.bar'), crumb = d.querySelector('.wcrumb'), l = d.querySelector('.wl');
    if (!r) { info.textContent = 'Pick a mounted drive (D1–D8) or a disk image on the PC. You can also drop a disk image or files here.'; crumb.textContent = ''; bar.style.visibility = 'hidden'; l.textContent = ''; return; }
    bar.style.visibility = '';
    const inf = C.info(r.m), u = inf.usage;
    info.innerHTML = r.kind === 'folder' ? `${esc(r.name)} · PC folder${inf.writable ? '' : ' · <b class="bad">read-only</b>'} · long names kept on the PC, 8.3 names shown beside them<br>${C.entries(r.m).filter((e) => !e.dir).length} files · ${kb(C.entries(r.m).reduce((a, e) => a + e.size, 0))}${r.unsaved ? ' · <span class="warn">changes not written yet</span>' : ''}` : `${esc(r.kind === 'drive' ? 'D' + r.n + ': ' : '')}${esc(r.name)} · ${inf.kind.toUpperCase()}${inf.label ? ' “' + esc(inf.label) + '”' : ''} · ${inf.sectors}×${inf.sectorSize} B ${inf.density}${inf.writable ? '' : ' · <b class="bad">read-only</b>'}${inf.folders ? '' : ' · no folders'}<br>${u.free} sectors free (${kb(u.bytesFree)}) of ${u.total}${r.kind === 'drive' && host().running() ? ' · <span class="warn">in the running computer</span>' : ''}`;
    bar.firstChild.style.width = u.pct + '%';
    const cc = C.caps(r.m), chips = ['write', 'folders', 'rename', 'del', 'import', 'edit', 'label', 'longnames'].map((k) => `<span class="cap ${cc[k].ok ? 'yes' : 'no'}" title="${esc(cc[k].ok ? 'available' : 'not available: ' + cc[k].why)}">${cc[k].ok ? '✔' : '✖'} ${esc(cc[k].label)}</span>`).join('');
    info.innerHTML += `<div class="caps">${chips}</div>`;
    const pd = bar.lastChild; pd.style.width = '0'; bar.classList.remove('bad'); pd.title = '';
    if (W.active !== i) {
      const ap = W.panes[W.active], ar = rec(ap), items = ar ? selItems(ap) : [];
      if (ar && items.length) { try { const P = C.plan(ar.m, items, r.m, p.dir, { conflict: 'rename' }); const w = Math.min(100 - u.pct, (P.sectors / u.total) * 100); pd.style.left = u.pct + '%'; pd.style.width = Math.max(w, 1) + '%'; bar.classList.toggle('bad', !P.ok); pd.title = P.ok ? `${P.sectors} sectors pending from the other pane` : P.errors.join('; '); info.innerHTML += ` · <b class="${P.ok ? 'warn' : 'bad'}">${P.ok ? '+' + P.sectors + ' sectors if copied here' : 'will not fit / not possible'}</b>`; } catch (e) { /* ignore */ } }
    }
    const parts = p.dir ? p.dir.split('/') : [];
    crumb.innerHTML = '<a data-p="">' + esc(r.name) + '</a>' + parts.map((x, k) => ' / <a data-p="' + esc(parts.slice(0, k + 1).join('/')) + '">' + esc(x) + '</a>').join('') + (p.filter ? ' &nbsp;<span class="warn">search: ' + esc(p.filter) + '</span>' : '');
    crumb.onclick = (e) => { const a = e.target.closest('a'); if (a) { p.dir = a.dataset.p; p.sel = new Set(); p.filter = ''; render(); } };
    const rows = rowsOf(p), arrow = (k) => (p.sort.k === k ? (p.sort.asc ? ' ▲' : ' ▼') : '');
    let h = `<table><tr><th style="width:24px"></th><th data-k="name">Name${arrow('name')}</th><th data-k="size">Size${arrow('size')}</th><th data-k="sectors">Sect${arrow('sectors')}</th><th data-k="date">Date${arrow('date')}</th></tr>`;
    if (p.dir && !p.tree && !p.filter) h += `<tr class="r" data-up="1" data-p="${esc(parentOf(p.dir))}" data-dir="1"><td></td><td class="n">⬑ ..</td><td></td><td></td><td></td></tr>`;
    for (const e of rows) {
      const isSel = p.sel.has(e.path), name = e.long || e.name;
      const exp = p.tree && e.dir ? (p.collapsed.has(e.path) ? '▸ ' : '▾ ') : '';
      h += `<tr class="r${isSel ? ' sel' : ''}${p.cur === e.path ? ' cur' : ''}${e.sidecar ? ' wix' : ''}" draggable="true" data-p="${esc(e.path)}" data-dir="${e.dir ? 1 : 0}"><td><input type="checkbox" class="ck" ${isSel ? 'checked' : ''} style="padding:0"></td><td class="n" style="padding-left:${6 + e.depth * 16}px" title="${esc(kindOf(e)[1] + ' · ' + e.path + (e.long ? '\n' + e.long : ''))}">${exp}${iconOf(e)} ${esc(name)}${e.long ? '<small>' + esc(e.name) + '</small>' : ''}${e.flat ? '<small>' + esc(parentOf(e.path)) + '</small>' : ''}</td><td class="num">${e.dir ? '' : (e.approx ? '~' : '') + kb(e.size)}</td><td class="num">${e.dir ? '' : e.sectors}</td><td>${esc(e.date || e.added || '')}</td></tr>`;
    }
    l.dataset.sc = l.scrollTop; l.innerHTML = h + '</table>';
    l.scrollTop = +l.dataset.sc || 0;
    l.querySelectorAll('tr.r[draggable]').forEach((tr) => {
      tr.ondragstart = (e) => { if (!p.sel.has(tr.dataset.p)) { p.sel = new Set([tr.dataset.p]); } W.drag = { from: i, items: [...p.sel] }; e.dataTransfer.setData('text/plain', 'wafm'); e.dataTransfer.effectAllowed = 'copyMove'; };
      tr.ondragend = () => { W.drag = null; };
    });
  }
  function rowClick(i, e) {
    const p = W.panes[i], tr = e.target.closest('tr.r'); if (!tr) return;
    if (tr.dataset.up === '1') return;
    const path = tr.dataset.p;
    if (p.tree && e.target.closest('td.n') && tr.dataset.dir === '1' && e.offsetX < 26 + (+tr.querySelector('td.n').style.paddingLeft.replace('px', '') - 6)) { p.collapsed.has(path) ? p.collapsed.delete(path) : p.collapsed.add(path); render(); return; }
    if (e.shiftKey && p.anchor) {
      const rows = rowsOf(p).map((x) => x.path), a = rows.indexOf(p.anchor), b = rows.indexOf(path);
      if (a >= 0 && b >= 0) { p.sel = new Set(rows.slice(Math.min(a, b), Math.max(a, b) + 1)); }
    } else if (e.ctrlKey || e.metaKey || e.target.classList.contains('ck')) { p.sel.has(path) ? p.sel.delete(path) : p.sel.add(path); p.anchor = path; }
    else { p.sel = new Set([path]); p.anchor = path; }
    p.cur = path; render();
  }
  function openRow(i, path, up) {
    const p = W.panes[i], r = rec(p); if (!r) return;
    if (up || C.entries(r.m).find((x) => x.path === path && x.dir)) { p.dir = path; p.sel = new Set(); p.filter = ''; p.tree = false; render(); return; }
    viewFile(i, path);
  }
  function ctxMenu(i, x, y) {
    W.active = i;
    const items = [['Open / view', 'view'], ['Copy to other pane', 'copy'], ['Make a copy here…', 'dup'], ['Move to other pane', 'move'], ['Rename…', 'rename'], ['New folder…', 'mkdir'], ['A–Z / 0–9 folders…', 'az'], ['Delete…', 'del'], ['Save to PC', 'export'], ['Properties…', 'props']];
    const m = document.createElement('div');
    m.style.cssText = `position:fixed;z-index:9999;left:${Math.min(x, innerWidth - 200)}px;top:${Math.min(y, innerHeight - 260)}px;background:#1b1e24;border:1px solid #4a5160;border-radius:8px;box-shadow:0 6px 24px #000a;min-width:190px;overflow:hidden`;
    for (const [l, a] of items) { const d = document.createElement('div'); d.textContent = l; d.style.cssText = 'padding:8px 12px;cursor:pointer'; d.onmouseenter = () => (d.style.background = '#2a2f39'); d.onmouseleave = () => (d.style.background = ''); d.onclick = () => { m.remove(); act(a); }; m.append(d); }
    document.body.append(m);
    const off = (e) => { if (e && m.contains(e.target)) return; m.remove(); window.removeEventListener('pointerdown', off, true); };
    setTimeout(() => window.addEventListener('pointerdown', off, true), 0);
  }

  // ---------- actions ----------
  function act(a) {
    const A = W.panes[W.active];
    ({ copy: () => xfer(false), move: () => xfer(true), mkdir: doMkdir, az: doAZ, dup: doDup, rename: doRename, del: doDelete, props: doProps, view: () => viewFile(W.active), export: doExport, import: doImport, unarc: doUnarc, cart: doCart, mkzip: doMkZip,
      all: () => { const r = rec(A); if (r) { A.sel = new Set(rowsOf(A).filter((x) => !x.sidecar).map((x) => x.path)); render(); } }, undo, newdisk: doNewDisk, f2d: doF2D, compare: doCompare, names: () => makeNames(rec(A)), sectors: diskEdit, refresh: async () => { for (const r of new Set(W.panes.map(rec))) if (r && r.kind === 'folder') await reloadFolder(r); refreshDrives(); render(); }, close }[a] || (() => {}))();
  }
  const other = () => 1 - W.active;

  async function xfer(move, from, items, to, toDir) {
    from = from == null ? W.active : from; to = to == null ? 1 - from : to;
    const sp = W.panes[from], dp = W.panes[to], sr = rec(sp), dr = rec(dp);
    if (!sr) return log('choose a disk in the active pane first');
    if (!dr) return log('choose a disk in the other pane first (the target)');
    items = items || selItems(sp);
    if (!items.length) return log('tag or select something first');
    toDir = toDir == null ? dp.dir : toDir;
    let P, opts = { conflict: W.conflict === 'error' ? undefined : W.conflict, index: W.index !== false, flatten: W.flatten !== false };
    const sum = document.createElement('div');
    const paint = () => {
      P = C.plan(sr.m, items, dr.m, toDir, opts);
      const nf = P.files.length, nd = P.dirs.length, warns = [];
      if (sr.m.kind !== dr.m.kind) warns.push(`Copying between different DOS types (${sr.m.kind.toUpperCase()} → ${dr.m.kind.toUpperCase()}): names are converted to 8.3${dr.m.kind === 'dos2' ? ' and folders are not supported' : ''}.`);
      if (dr.kind === 'drive' && host().running()) warns.push(`D${dr.n}: is mounted in the running computer. The change is written to the mounted disk now; press Reset so the DOS rereads it.`);
      if (move && sr.kind === 'drive' && host().running()) warns.push(`Files will be removed from D${sr.n}: which is in the running computer.`);
      if (P.longNames.size) warns.push('Long names will be recorded in LONGNAME.TXT (cost included below).');
      for (const w of P.warnings) warns.push(w);
      const free = P.free, need = P.sectors;
      sum.innerHTML = `<div><b>${move ? 'Move' : 'Copy'}</b> ${nf} file${nf === 1 ? '' : 's'}${nd ? ' and ' + nd + ' folder' + (nd === 1 ? '' : 's') : ''} from <b>${esc(sr.name)}</b> to <b>${esc(dr.name)}</b>${toDir ? ' / ' + esc(toDir) : ''}</div>
        <div style="margin:8px 0">${dr.m.kind === 'folder' ? `Writes <b>${nf}</b> file(s), about <b>${kb(P.files.reduce((a, f) => a + (f.size || 0), 0))}</b>, into the PC folder. Long names are kept as the real Windows names.` : `Needs <b>${need}</b> sectors (${kb(need * (dr.m.vol.sectorSize - (dr.m.kind === 'sdfs' ? 0 : 3)))}); <b>${free}</b> free of ${dr.m.vol.sectors} on the target (${dr.m.vol.sectorSize}-byte sectors).`}
        ${P.ok && dr.m.kind !== 'folder' ? `<span class="ok">Fits — ${free - need} sectors will remain free.</span>` : ''}</div>
        ${P.errors.map((x) => '<div class="bad">✖ ' + esc(x) + '</div>').join('')}${warns.map((x) => '<div class="warn">⚠ ' + esc(x) + '</div>').join('')}
        ${P.conflicts.length ? `<div style="margin-top:8px">If a name already exists: <select class="cf"><option value="error">stop</option><option value="overwrite">overwrite</option><option value="skip">skip it</option><option value="rename">keep both (new name)</option></select></div>` : ''}`;
      const cf = sum.querySelector('.cf'); if (cf) { cf.value = opts.conflict || 'error'; cf.onchange = () => { opts.conflict = cf.value === 'error' ? undefined : cf.value; W.conflict = cf.value; paint(); }; }
      const go = sum.parentElement && sum.parentElement.querySelector('.pri'); if (go) go.disabled = !P.ok;
      flat.style.display = !C.canDirs(dr.m) && sr.m.kind !== 'dos2' ? 'block' : 'none';
    };
    const verify = document.createElement('label'); verify.innerHTML = '<input type="checkbox" checked> Verify every file by reading it back'; verify.style.cssText = 'display:block;margin-top:8px';
    const idx = document.createElement('label'); idx.innerHTML = `<input type="checkbox" ${opts.index === false ? '' : 'checked'}> Record every name, date, size and source in LONGNAME.TXT`; idx.style.cssText = 'display:block;margin-top:4px';
    idx.querySelector('input').onchange = (e) => { opts.index = e.target.checked; W.index = opts.index; paint(); };
    const flat = document.createElement('label'); flat.innerHTML = `<input type="checkbox" ${opts.flatten ? 'checked' : ''}> Flatten folders when the target has none (files go to the root, paths kept in LONGNAME.TXT)`; flat.style.cssText = 'display:block;margin-top:4px';
    flat.querySelector('input').onchange = (e) => { opts.flatten = e.target.checked; W.flatten = opts.flatten; paint(); };
    const wrap = document.createElement('div'); wrap.append(sum, verify, idx, flat);
    paint();
    const go = dlg(move ? 'Move' : 'Copy', wrap, [{ label: 'Cancel', value: false }, { label: move ? 'Move' : 'Copy', value: true, pri: true }]);
    paint();
    if (!(await go)) return;
    P = C.plan(sr.m, items, dr.m, toDir, opts);
    if (!P.ok) return log('not done: ' + P.errors.join('; '));
    snapshot((move ? 'move' : 'copy') + ' ' + items.length + ' item(s)', [sr, dr]);
    const total = P.files.length + P.dirs.length, verb = move ? 'Moving' : 'Copying';
    const pg = AC.Progress.begin(verb + ' to ' + dr.name + '…', total), xb = xferBar(`${verb}  ${sr.name} → ${dr.name}`, P.files.length), t0 = performance.now();
    let res;
    try { res = await C.executeAsync(P, sr.m, dr.m, { move, verify: verify.querySelector('input').checked, conflict: opts.conflict, cancelled: () => W.cancel, onProgress: (d, t, l, i) => { pg.set(d, t); pg.text(verb + ' ' + l); xb.update(d, t, l, i); } }); }
    catch (e) { xb.end('Failed: ' + e.message, true); throw e; }
    finally { pg.end(); }
    const secs = (performance.now() - t0) / 1000, tb = P.files.reduce((a, f) => a + (f.size || 0), 0);
    xb.end(`${res.cancelled ? 'Cancelled after' : 'Finished'} ${res.copied + res.skipped} of ${P.files.length} file(s), ${kb(tb)} in ${secs.toFixed(1)} s${res.failed.length ? ' · ' + res.failed.length + ' failed' : ''}`, res.cancelled || res.failed.length > 0);
    await afterWrite([sr, dr]);
    sp.sel = new Set(); dp.sel = new Set();
    log(`${move ? 'Moved' : 'Copied'} ${res.copied} file(s)${res.verified ? ', ' + res.verified + ' verified' : ''}${res.skipped ? ', ' + res.skipped + ' skipped' : ''}${res.failed.length ? ', ' + res.failed.length + ' FAILED' : ''}.`);
    render();
    if (res.failed.length) msg('Some items failed', res.failed.map((f) => `<div class="bad">${esc(f.path)}: ${esc(f.error)}</div>`).join(''));
  }
  // Archives (ARC/ARK, ZIP, 7z, RAR, LZH...) dropped or picked from the PC can be unpacked onto the disk instead of copied whole (see archives.js).
  async function unpackArchives(files) {
    if (!window.AC || !AC.Archives) return files;
    const out = [];
    for (const f of files) {
      if (!AC.Archives.looksLikeArchive(f.name)) { out.push(f); continue; }
      if (!confirm(f.name + ' is an archive.\n\nOK = unpack its files onto the disk\nCancel = copy the archive file itself')) { out.push(f); continue; }
      try { for (const it of await AC.Archives.expand(f)) out.push(await it.get()); }
      catch (e) { log(f.name + ': ' + e.message + ' - copying the archive as a file'); out.push(f); }
    }
    return out;
  }

  async function addFiles(i, files, dir) {
    const p = W.panes[i], r = rec(p); if (!r) return;
    if (r.m.vol.readOnly) return log('this disk is read-only here');
    files = await unpackArchives(files);
    snapshot('add files', [r]);
    const pg = AC.Progress.begin('Adding files to ' + r.name + '…', files.length), xb = xferBar('Adding from PC → ' + r.name, files.length), t0 = performance.now(), totalB = files.reduce((a, f) => a + (f.size || 0), 0); let n = 0, doneB = 0, k = 0; const bad = [];
    try {
      for (const f of files) {
        if (W.cancel) break;
        k++; pg.text('Adding ' + f.name); pg.set(n);
        xb.update(n, files.length, f.name, { phase: 'write', file: k, files: files.length, bytes: doneB, totalBytes: totalB, size: f.size });
        try { C.addHostFile(r.m, dir == null ? p.dir : dir, f.name, await AC.Progress.read(f), { source: 'PC', now: new Date(f.lastModified || Date.now()), index: W.index !== false }); n++; } catch (e) { bad.push(f.name + ': ' + e.message); }
        doneB += f.size || 0; await new Promise((ok) => setTimeout(ok, 0));
      }
    } finally { pg.end(); xb.end(`${W.cancel ? 'Cancelled after' : 'Finished'} ${n} of ${files.length} file(s), ${kb(doneB)} in ${((performance.now() - t0) / 1000).toFixed(1)} s${bad.length ? ' · ' + bad.length + ' failed' : ''}`, W.cancel || bad.length > 0); }
    await afterWrite([r]); log(`Added ${n} file(s)${bad.length ? '; ' + bad.length + ' failed' : ''}.`); render();
    if (bad.length) msg('Some files were not added', bad.map((x) => `<div class="bad">${esc(x)}</div>`).join(''));
  }
  // Archive that already lives on a disk: show what is inside, then unpack into the other pane's disk (or this folder).
  async function doUnarc() {
    const p = W.panes[W.active], r = rec(p), items = selItems(p); if (!r || !items.length) return log('select an archive file first');
    const ents = C.entries(r.m), e = ents.find((x) => items.includes(x.path) && !x.dir && AC.Archives.looksLikeArchive(x.name)) || ents.find((x) => x.path === items[0]);
    if (!e || e.dir) return log('select an archive file first');
    const file = new File([r.m.vol.read(e.raw)], e.long || e.name);
    let ex; try { ex = await AC.Archives.expand(file); } catch (err) { return msg('Cannot read archive', esc(file.name + ': ' + err.message)); }
    if (!ex.length) return msg('Empty archive', esc(file.name) + ' has no files.');
    const tot = ex.reduce((a, x) => a + (x.size || 0), 0), o = rec(W.panes[1 - W.active]);
    const body = document.createElement('div');
    body.innerHTML = `<div><b>${esc(file.name)}</b>: ${ex.length} file(s), ${kb(tot)} unpacked</div><div style="max-height:220px;overflow:auto;margin:8px 0;font-family:monospace">${ex.map((x) => esc(x.path || x.name) + '  <span class="dim">' + (x.size || 0) + '</span>').join('<br>')}</div>
      <label><input type="radio" name="wut" value="here" checked> Unpack into this folder of ${esc(r.name)}</label><br><label><input type="radio" name="wut" value="other" ${o ? '' : 'disabled'}> Unpack into the other pane${o ? ' (' + esc(o.name) + ')' : ' (no disk there)'}</label><br><label><input type="radio" name="wut" value="pc"> Save the unpacked files to the PC as a ZIP</label>`;
    const v = await dlg('Unpack archive', body, [{ label: 'Cancel', value: null }, { label: 'Unpack', pri: true, value: () => body.querySelector('input[name=wut]:checked').value }]);
    if (!v) return;
    const files = []; for (const x of ex) files.push(await x.get());
    if (v === 'pc') { const z = []; for (const f of files) z.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }); host().save(file.name.replace(/\.[^.]*$/, '') + '.zip', host().zip(z), 'application/zip'); return log('Saved to the PC.'); }
    const ti = v === 'other' ? 1 - W.active : W.active, tp = W.panes[ti];
    const keep = AC.Archives.looksLikeArchive; AC.Archives.looksLikeArchive = () => false;
    try { await addFiles(ti, files, tp.dir); } finally { AC.Archives.looksLikeArchive = keep; }
  }
  async function doMkZip() {
    const p = W.panes[W.active], r = rec(p), items = selItems(p); if (!r || !items.length) return log('tag or select files first');
    if (r.m.vol.readOnly) return log('this disk is read-only here');
    const files = [];
    for (const path of items) {
      const e = C.entries(r.m).find((x) => x.path === path);
      if (e.dir) { for (const x of C.entries(r.m)) if (!x.dir && x.path.startsWith(path + '/')) files.push({ name: x.path, data: r.m.vol.read(x.raw) }); } else files.push({ name: e.long || e.name, data: r.m.vol.read(e.raw) });
    }
    const nm = await ask('Make ZIP', 'Name of the ZIP file', 'FILES.ZIP'); if (!nm) return;
    const z = host().zip(files);
    await addFiles(W.active, [new File([new Blob(z)], /\.zip$/i.test(nm) ? nm : nm + '.zip')], p.dir);
  }  // Cartridge image tool: inspect, strip the CART header, add one, and move the result to the PC or onto the active disk.
  async function doCart() {
    const p = W.panes[W.active], r = rec(p), CT = AC.CartTool;
    let name, bytes; const sel = r && C.entries(r.m).find((x) => selItems(p).includes(x.path) && !x.dir && /\.(car|rom|bin)$/i.test(x.name));
    if (sel) { name = sel.long || sel.name; bytes = r.m.vol.read(sel.raw); }
    else {
      const f = await new Promise((ok) => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.car,.rom,.bin'; i.onchange = () => ok(i.files[0]); i.oncancel = () => ok(null); i.click(); });
      if (!f) return; name = f.name; bytes = new Uint8Array(await f.arrayBuffer());
    }
    const c = CT.parse(bytes), base = name.replace(/\.[^.]*$/, '');
    const tys = CT.typesFor(c.kb), pre = c.hasHeader ? c.type : c.known ? c.known.type : tys.length ? tys[0][0] : 1;
    const body = document.createElement('div');
    body.innerHTML = `<div><b>${esc(name)}</b></div><div class="dim" style="margin:6px 0">${c.hasHeader ? 'CART header: type ' + c.type + (c.checksumOk ? ', checksum OK' : ', <span class="bad">checksum does not match</span>') : 'Raw ROM, no header'} · ${c.kb} KB · CRC32 ${c.crc}${c.known ? ' · known: ' + esc(c.known.name) : ''}</div>
      <div class="dim">Cartridge type for a header</div><select class="ct" style="width:100%">${CT.TYPES.map((t) => `<option value="${t[0]}" ${t[0] === pre ? 'selected' : ''}>${t[0]} - ${esc(t[2])}</option>`).join('')}</select>
      <div style="margin-top:8px"><label><input type="radio" name="wca" value="rom" checked> Strip header → raw ROM</label><br><label><input type="radio" name="wca" value="car"> Add / replace header → .CAR</label></div>
      <div style="margin-top:8px"><label><input type="radio" name="wcd" value="pc" checked> Save to the PC</label><br><label><input type="radio" name="wcd" value="disk" ${r ? '' : 'disabled'}> Put on the disk in the active pane</label></div>`;
    const v = await dlg('Cartridge', body, [{ label: 'Cancel', value: null }, { label: 'Go', pri: true, value: () => ({ a: body.querySelector('[name=wca]:checked').value, d: body.querySelector('[name=wcd]:checked').value, t: +body.querySelector('.ct').value }) }]);
    if (!v) return;
    const out = v.a === 'rom' ? c.rom.slice() : CT.addHeader(c.rom, v.t), on = base + (v.a === 'rom' ? '.ROM' : '.CAR');
    if (v.d === 'pc') { host().save(on, out); return log(`Saved ${on} (${out.length} bytes).`); }
    await addFiles(W.active, [new File([out], on)], p.dir);
  }  function doImport() {
    const btn = W.el.querySelector('.wtb [data-a="import"]'); if (!btn) return importPC();
    const old = W.el.querySelector('.wimpmenu'); if (old) { old.remove(); return; }
    const mn = document.createElement('div'); mn.className = 'wimpmenu';
    const rc = btn.getBoundingClientRect(), wr = W.el.getBoundingClientRect();
    mn.style.cssText = `position:absolute;z-index:60;left:${rc.left - wr.left}px;top:${rc.bottom - wr.top + 2}px;background:#252a33;border:1px solid #4a5160;border-radius:6px;padding:4px 0;min-width:240px;box-shadow:0 6px 20px #000a`;
    const off = () => { mn.remove(); document.removeEventListener('pointerdown', away, true); };
    const away = (e) => { if (!mn.contains(e.target)) off(); };
    for (const [t, fn] of [['From this PC…', importPC], ['From scanned media library…', importLib]]) {
      const it = document.createElement('div'); it.textContent = t; it.style.cssText = 'padding:6px 14px;cursor:pointer;font-size:13px';
      it.onmouseenter = () => { it.style.background = '#37404d'; }; it.onmouseleave = () => { it.style.background = ''; };
      it.onclick = () => { off(); fn(); }; mn.append(it);
    }
    W.el.append(mn); setTimeout(() => document.addEventListener('pointerdown', away, true));
  }
  function importPC() { const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.onchange = () => addFiles(W.active, [...inp.files]); inp.click(); }
  // Scanned-library picker for pane `i`: folder tree (or flat when filtering), type filter, wildcard filter, select all or a few.
  // "Add" puts the files into that pane's current folder; "Open as disk" opens the first selected disk image in that pane.
  async function importLib(i) {
    i = typeof i === 'number' ? i : W.active;
    const p = W.panes[i], r = rec(p), all = host().library ? host().library() : [];
    if (!all.length) return msg('Media library is empty', 'Scan a folder in the media library first (File manager → Scan folder), then use it here.');
    const kinds = [...new Set(all.map((f) => f.kind).filter(Boolean))].sort();
    const body = document.createElement('div');
    body.innerHTML = `<div style="display:flex;gap:6px;margin-bottom:6px"><input class="lq" placeholder="text or wildcard: *.atr  mydos*  ???.com" style="flex:1;min-width:0"><select class="lk"><option value="">All types</option>${kinds.map((k) => `<option>${esc(k)}</option>`).join('')}</select></div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px"><button class="ea">Expand all</button><button class="ca">Collapse all</button><button class="sa">Select all shown</button><button class="sn">Select none</button></div>
      <div class="lc dim" style="margin-bottom:4px"></div><div class="dim" style="margin-bottom:4px">${r ? `Files go to <b>${esc(r.name)}</b>${p.dir ? ' / ' + esc(p.dir) : ''} (pane ${i ? 'right' : 'left'})` : `Pane ${i ? 'right' : 'left'} has no disk: use “Open as disk”`}</div>
      <div class="ll" style="max-height:340px;overflow:auto;border:1px solid #3a4150;border-radius:4px"></div>`;
    const q = (s) => body.querySelector(s), pick = new Set(), state = new Map(); let dflt = null, hit = [];
    const rx = () => { const t = q('.lq').value.trim(); if (!t) return null; if (!/[*?]/.test(t)) { const l = t.toLowerCase(); return { test: (s) => s.toLowerCase().includes(l) }; } return new RegExp('^' + t.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'); };
    const files = (n) => { let o = n.files.map((x) => x.f.name); for (const c of n.dirs.values()) o = o.concat(files(c)); return o; };
    const draw = () => {
      const re = rx(), k = q('.lk').value, filtering = !!(re || k);
      hit = all.filter((f) => (!k || f.kind === k) && (!re || re.test(f.name) || re.test(f.name.split('/').pop()) || re.test(f.title || '')));
      const root = { dirs: new Map(), files: [] };
      for (const f of hit) { const parts = f.name.split('/'); let n = root, pa = ''; for (let j = 0; j < parts.length - 1; j++) { pa += (pa ? '/' : '') + parts[j]; if (!n.dirs.has(parts[j])) n.dirs.set(parts[j], { dirs: new Map(), files: [], path: pa, name: parts[j] }); n = n.dirs.get(parts[j]); } n.files.push({ f, leaf: parts[parts.length - 1] }); }
      const isOpen = (n) => state.has(n.path) ? state.get(n.path) : dflt === 'all' || (dflt === null && filtering && hit.length <= 400);
      const ll = q('.ll'); ll.textContent = ''; let rows = 0, capped = false;
      const row = (depth) => { const d = document.createElement('div'); d.style.cssText = `display:flex;gap:6px;align-items:center;padding:1px 6px 1px ${6 + depth * 16}px;font-size:12px;white-space:nowrap;overflow:hidden`; ll.append(d); return d; };
      const walk = (n, depth) => {
        for (const c of [...n.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
          if (rows++ > 1500) { capped = true; return; }
          const fs = files(c), on = fs.filter((x) => pick.has(x)).length, d = row(depth), open = isOpen(c);
          const tg = document.createElement('span'); tg.textContent = open ? '▾' : '▸'; tg.style.cssText = 'cursor:pointer;width:12px'; tg.onclick = () => { state.set(c.path, !open); draw(); };
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on === fs.length && fs.length > 0; cb.indeterminate = on > 0 && on < fs.length;
          cb.onchange = () => { for (const x of fs) cb.checked ? pick.add(x) : pick.delete(x); draw(); };
          const nm = document.createElement('span'); nm.textContent = '📁 ' + c.name + '  (' + fs.length + ')'; nm.style.cssText = 'cursor:pointer;overflow:hidden;text-overflow:ellipsis'; nm.onclick = tg.onclick;
          d.append(tg, cb, nm);
          if (open) walk(c, depth + 1);
          if (capped) return;
        }
        for (const x of n.files.sort((a, b) => a.leaf.localeCompare(b.leaf))) {
          if (rows++ > 1500) { capped = true; return; }
          const d = row(depth), cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = pick.has(x.f.name);
          cb.onchange = () => { cb.checked ? pick.add(x.f.name) : pick.delete(x.f.name); count(); };
          const nm = document.createElement('span'); nm.textContent = x.leaf + (x.f.title ? '  —  ' + x.f.title : ''); nm.style.cssText = 'overflow:hidden;text-overflow:ellipsis';
          const kd = document.createElement('span'); kd.textContent = x.f.kind || ''; kd.className = 'dim'; kd.style.marginLeft = 'auto';
          d.append(cb, nm, kd); d.style.cursor = 'pointer'; d.onclick = (e) => { if (e.target !== cb) { cb.checked = !cb.checked; cb.onchange(); } };
        }
      };
      walk(root, 0);
      if (capped) ll.insertAdjacentHTML('beforeend', '<div class="dim" style="padding:4px 6px">…more rows not shown; narrow the filter or collapse folders</div>');
      count();
    };
    const count = () => { q('.lc').textContent = `${hit.length} of ${all.length} files shown · ${pick.size} selected`; };
    q('.lq').oninput = draw; q('.lk').onchange = draw;
    q('.ea').onclick = () => { state.clear(); dflt = 'all'; draw(); }; q('.ca').onclick = () => { state.clear(); dflt = false; draw(); };
    q('.sa').onclick = () => { for (const f of hit) pick.add(f.name); draw(); }; q('.sn').onclick = () => { pick.clear(); draw(); };
    draw();
    const go = await dlg('Scanned media library', body, [{ label: 'Cancel', value: null }, { label: 'Open as disk', value: 'open' }, { label: 'Add selected to this pane', value: 'add', pri: true }]);
    if (!go || !pick.size) return;
    if (go === 'open') {
      const nm = [...pick].find((n) => /\.(atr|atx|xfd|dcm|pro|dsk|img)$/i.test(n)) || [...pick][0];
      try { const f = await host().libraryFile(nm); if (f) await openFile(i, f); else msg('Could not read', esc(nm)); } catch (e) { msg('Could not read', esc(nm + ': ' + e.message)); }
      return;
    }
    if (!r) return msg('No disk in this pane', 'Open or create a disk in this pane first, or use “Open as disk”.');
    const got = [], bad = [];
    for (const nm of pick) {
      try { const f = await host().libraryFile(nm); if (f) got.push(f); else bad.push(nm); } catch (e) { bad.push(nm + ': ' + e.message); }
    }
    if (got.length) await addFiles(i, got, p.dir);
    if (bad.length) msg('Some files could not be read', bad.map((x) => `<div class="bad">${esc(x)}</div>`).join(''));
  }
  function doExport() {
    const p = W.panes[W.active], r = rec(p), items = selItems(p); if (!r || !items.length) return log('tag or select files first');
    const files = [];
    for (const path of items) {
      const e = C.entries(r.m).find((x) => x.path === path);
      if (e.dir) { for (const x of C.entries(r.m)) if (!x.dir && x.path.startsWith(path + '/')) files.push({ name: x.path, data: r.m.vol.read(x.raw) }); } else files.push({ name: e.name, data: r.m.vol.read(e.raw) });
    }
    if (files.length === 1) host().save(baseOf(files[0].name), files[0].data); else host().save((r.name.replace(/\.[^.]*$/, '') || 'files') + '.zip', host().zip(files), 'application/zip');
    log(`Saved ${files.length} file(s) to the PC.`);
  }
  async function doMkdir() {
    const p = W.panes[W.active], r = rec(p); if (!r) return;
    if (!C.canDirs(r.m)) return msg('No folders here', `${r.m.kind.toUpperCase()} disks cannot have folders. MyDOS and SpartaDOS disks can.`);
    if (r.m.vol.readOnly) return log('this disk is read-only here');
    const nm = await ask('New folder', 'Folder name (long names are fine; a short 8-character name is made and the long one is recorded)', ''); if (!nm) return;
    snapshot('new folder', [r]);
    try { C.mkdir(r.m, p.dir, nm); await afterWrite([r]); log('Folder created.'); } catch (e) { log('new folder: ' + e.message); }
    render();
  }
  async function doAZ() {
    const p = W.panes[W.active], r = rec(p); if (!r) return;
    if (!C.canDirs(r.m)) return msg('No folders here', `${r.m.kind.toUpperCase()} disks cannot have folders. MyDOS and SpartaDOS disks can.`);
    if (r.m.vol.readOnly) return log('this disk is read-only here');
    const body = document.createElement('div');
    body.innerHTML = '<p>Make one-letter folders in the current folder (existing ones are skipped).</p><label><input type="checkbox" id="wazl" checked> A–Z (26 folders)</label><br><label><input type="checkbox" id="wazn" checked> 0–9 (10 folders)</label><div class="azc" style="margin-top:8px"></div>';
    const per = r.m.kind === 'sdfs' ? 2 : 8, free = r.m.vol.freeSectors(), ss = r.m.vol.sectorSize || 256;
    const cost = () => {
      const n = (body.querySelector('#wazl').checked ? 26 : 0) + (body.querySelector('#wazn').checked ? 10 : 0), s = n * per;
      body.querySelector('.azc').innerHTML = `<span class="${s > free ? 'bad' : s > free / 3 ? 'warn' : 'dim'}">Each folder uses ${per} sectors on this disk. ${n} folder(s) = ${s} of ${free} free sectors (${Math.round(s * ss / 1024)} KB, ${free ? Math.round(s * 100 / free) : 0}%).${s > free ? ' Not enough room.' : ''}</span>`;
    };
    body.addEventListener('change', cost); cost();
    const v = await dlg('A–Z / 0–9 folders', body, [{ label: 'Cancel', value: null }, { label: 'Create', pri: true, value: () => ({ l: body.querySelector('#wazl').checked, n: body.querySelector('#wazn').checked }) }]);
    if (!v || (!v.l && !v.n)) return;
    const names = []; if (v.n) for (let i = 0; i < 10; i++) names.push(String(i)); if (v.l) for (let i = 0; i < 26; i++) names.push(String.fromCharCode(65 + i));
    const have = new Set(C.entries(r.m).filter((e) => e.path.split('/').slice(0, -1).join('/') === p.dir).map((e) => e.name.toUpperCase()));
    snapshot('A-Z / 0-9 folders', [r]);
    let made = 0, skipped = 0, err = '';
    for (const n of names) {
      if (have.has(n)) { skipped++; continue; }
      try { C.mkdir(r.m, p.dir, n); made++; } catch (e) { err = e.message; break; }
    }
    await afterWrite([r]);
    log(`Folders: ${made} created, ${skipped} already there${err ? '; stopped: ' + err : ''}.`);
    render();
  }
  async function doRename() {
    const p = W.panes[W.active], r = rec(p), items = selItems(p); if (!r) return;
    if (r.m.vol.readOnly) return log('this disk is read-only here');
    if (!items.length) return renameDisk(W.active);
    const e = C.listDir(r.m, parentOf(items[0])).find((x) => x.path === items[0]);
    const nm = await ask('Rename', `Rename "${e.long || e.name}" (short name on disk: ${e.name})`, e.long || e.name, 'Names longer than 8.3 are shortened on the disk and the full name is kept in LONGNAME.TXT.'); if (!nm) return;
    snapshot('rename', [r]);
    try { const x = C.rename(r.m, items[0], nm); await afterWrite([r]); p.sel = new Set([x.path]); p.cur = x.path; log(`Renamed to ${x.short}${x.long ? ' (“' + x.long + '”)' : ''}.`); } catch (er) { log('rename: ' + er.message); }
    render();
  }
  async function renameDisk(i) {
    const r = rec(W.panes[i]); if (!r) return;
    const sdfs = !!r.m.vol.setLabel;
    const nm = await ask('Rename disk', sdfs ? 'Volume label (up to 8 characters)' : `${r.m.kind.toUpperCase()} stores no volume label, so this renames the disk image`, sdfs ? r.m.vol.label.trim() : r.name); if (!nm) return;
    snapshot('rename disk', [r]);
    try {
      if (sdfs) { C.setLabel(r.m, nm); await afterWrite([r]); } else if (r.kind === 'drive') { host().renameDisk(r.n, nm); r.name = nm; } else r.name = nm;
      log('Disk renamed to ' + nm);
    } catch (e) { log('rename disk: ' + e.message); }
    render();
  }
  async function doDup() {
    const p = W.panes[W.active], r = rec(p), items = selItems(p); if (!r) return;
    if (r.m.vol.readOnly) return log('this disk is read-only here');
    const all = C.entries(r.m), files = items.map((it) => all.find((x) => x.path === it)).filter((e) => e && !e.dir);
    if (!files.length) return log('tag or select a file to copy first');
    const used = new Set(all.filter((x) => parentOf(x.path) === parentOf(files[0].path)).map((x) => x.name.toUpperCase()));
    // TEST.TXT -> TEST_1.TXT, TEST_2.TXT ...; an 8-character stem is trimmed to make room (TEXT1234.TXT -> TEXT12_1.TXT)
    const label = (e) => {
      const n = e.name, i = n.lastIndexOf('.'), stem = i > 0 ? n.slice(0, i) : n, ext = i > 0 ? n.slice(i) : '';
      for (let k = 1; k < 1000; k++) { const sfx = '_' + k, cand = stem.slice(0, 8 - sfx.length) + sfx + ext; if (!used.has(cand.toUpperCase())) { used.add(cand.toUpperCase()); return cand; } }
      return stem + '_X' + ext;
    };
    const names = new Map();
    if (files.length === 1) {
      const nm = await ask('Make a copy', `Name for the copy of "${files[0].long || files[0].name}" (made in this folder)`, label(files[0]), 'Names longer than 8.3 are shortened on the disk and the full name is kept in LONGNAME.TXT.'); if (!nm) return;
      names.set(files[0].path, nm);
    } else for (const e of files) names.set(e.path, label(e));
    snapshot('make copy', [r]);
    const made = [], bad = [];
    for (const e of files) {
      try { made.push(C.addHostFile(r.m, parentOf(e.path), names.get(e.path), r.m.vol.read(e.raw), { source: 'COPY', index: true })); } catch (er) { bad.push(e.name + ': ' + er.message); }
    }
    await afterWrite([r]);
    if (made.length) { p.sel = new Set(made); p.cur = made[made.length - 1]; }
    log(`Made ${made.length} cop${made.length === 1 ? 'y' : 'ies'}.`); render();
    if (bad.length) msg('Some copies were not made', bad.map((x) => `<div class="bad">${esc(x)}</div>`).join(''));
  }
  async function doDelete() {
    const p = W.panes[W.active], r = rec(p), items = selItems(p); if (!r || !items.length) return log('tag or select something first');
    if (r.m.vol.readOnly) return log('this disk is read-only here');
    let files = 0, dirs = 0, secs = 0;
    for (const it of items) { const pr = C.props(r.m, it); files += pr.files; dirs += pr.dirs + (C.entries(r.m).find((x) => x.path === it).dir ? 1 : 0); secs += pr.sectors; }
    const ok = await dlg('Delete', `<div>Delete <b>${items.length}</b> item(s) — ${files} file(s)${dirs ? ', ' + dirs + ' folder(s)' : ''} — from <b>${esc(r.name)}</b>?</div><div class="dim" style="margin-top:6px">Frees about ${secs} sectors. You can undo this with Ctrl+Z while WebAFM is open.</div>${r.kind === 'drive' && host().running() ? `<div class="warn" style="margin-top:6px">⚠ D${r.n}: is in the running computer.</div>` : ''}`, [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, pri: true }]);
    if (!ok) return;
    snapshot('delete', [r]); const bad = [];
    for (const it of items) { try { C.remove(r.m, it); } catch (e) { bad.push(it + ': ' + e.message); } }
    await afterWrite([r]); p.sel = new Set(); log(`Deleted ${items.length - bad.length} item(s).`); render();
    if (bad.length) msg('Some items were not deleted', bad.map((x) => `<div class="bad">${esc(x)}</div>`).join(''));
  }
  async function doProps() {
    const p = W.panes[W.active], r = rec(p); if (!r) return;
    const items = selItems(p), inf = C.info(r.m), u = inf.usage;
    let h = '';
    if (items.length) {
      let t = { files: 0, dirs: 0, bytes: 0, sectors: 0, depth: 0 }, one = null;
      for (const it of items) { const pr = C.props(r.m, it); t.files += pr.files; t.dirs += pr.dirs; t.bytes += pr.bytes; t.sectors += pr.sectors; t.depth = Math.max(t.depth, pr.depth); if (items.length === 1) one = { pr, e: C.listDir(r.m, parentOf(it)).find((x) => x.path === it) }; }
      if (one) h += `<div><b>${esc(one.e.long || one.e.name)}</b>${one.e.long ? ' <span class="dim">(on disk: ' + esc(one.e.name) + ')</span>' : ''}</div><div class="dim">${esc(one.e.path)}${one.e.added ? ' · added ' + esc(one.e.added) : ''}${one.e.date ? ' · ' + esc(one.e.date) : ''}</div>`;
      h += `<table style="margin-top:8px"><tr><td>Files</td><td class="num">${t.files}</td></tr><tr><td>Folders inside</td><td class="num">${t.dirs}</td></tr><tr><td>Total size</td><td class="num">${t.bytes.toLocaleString()} bytes (${kb(t.bytes)})</td></tr><tr><td>Sectors used (${inf.sectorSize}-byte)</td><td class="num">${t.sectors}</td></tr>${t.depth ? `<tr><td>Deepest nesting</td><td class="num">${t.depth}</td></tr>` : ''}${one && one.pr.largest && one.e.dir ? `<tr><td>Largest file</td><td class="num">${esc(one.pr.largest.path.slice(one.e.path.length + 1))} (${kb(one.pr.largest.size)})</td></tr>` : ''}</table>`;
      if (one && one.e.dir && one.pr.children.length) h += `<div class="dim" style="margin-top:8px">Inside:</div><table>${one.pr.children.map((c) => `<tr><td>${c.dir ? '📁' : '📄'} ${esc(c.name)}</td><td class="num">${c.dir ? c.files + ' files, ' + c.dirs + ' folders' : kb(c.bytes)}</td><td class="num">${c.sectors} sect</td></tr>`).join('')}</table>`;
    } else {
      const free = u.free * u.sectorBytes;
      h += `<table><tr><td>Image</td><td>${esc(r.name)}</td></tr><tr><td>File system</td><td>${inf.kind.toUpperCase()}${inf.label ? ' “' + esc(inf.label) + '”' : ''}</td></tr><tr><td>Geometry</td><td>${inf.sectors} sectors × ${inf.sectorSize} B (${inf.density})</td></tr><tr><td>Capacity</td><td>${kb(inf.sectors * inf.sectorSize)}</td></tr><tr><td>Used</td><td>${u.used} sectors (${u.pct}%)</td></tr><tr><td>Free</td><td>${u.free} sectors (${kb(free)})</td></tr><tr><td>Folders</td><td>${inf.folders ? 'supported' : 'not on this DOS'}</td></tr><tr><td>Writable here</td><td>${inf.writable ? 'yes' : 'no'}</td></tr></table>`;
    }
    const act = [{ label: 'OK', value: true, pri: true }];
    if (!items.length) act.unshift({ label: 'Rename disk…', value: 'rn' });
    const v = await dlg(items.length ? 'Properties' : 'Disk properties', h, act);
    if (v === 'rn') renameDisk(W.active);
  }

  // ---------- viewer / editor ----------
  async function viewFile(i, path, mode) {
    const p = W.panes[i], r = rec(p); path = path || selItems(p)[0]; if (!r || !path) return log('select a file first');
    const e = C.entries(r.m).find((x) => x.path === path); if (!e || e.dir) return;
    if (W.ed) return;
    const data = r.m.vol.read(e.raw), ro = !!r.m.vol.readOnly;
    await AC.WEdit.open({
      parent: W.el, title: (e.long || e.name) + (e.long ? '  [' + e.name + ']' : ''), data, readOnly: ro, mode,
      onReady: (a) => { W.ed = a; W.dlgKey = () => a.focus(); },
      onClose: () => { W.ed = null; W.dlgKey = null; W.el.focus(); },
      onSave: async (out) => {
        snapshot('edit ' + e.name, [r]);
        r.m.vol.writeFile(e.path, out, true); await afterWrite([r]); log(`Saved ${e.name} (${out.length} bytes).`); render();
      },
    });
  }

  function diskEdit() {
    const r = rec(W.panes[W.active]); if (!r) return log('pick a disk first');
    if (!r.m.bytes) return log('the raw sector editor works on disk images, not PC folders');
    if (W.ed) return;
    const ents = r.m.kind === 'dos2' || r.m.kind === 'mydos' ? C.entries(r.m).filter((e) => !e.dir && e.raw).map((e) => ({ path: e.path, start: e.raw.start })) : [];
    AC.WDisk.open({
      parent: W.el, title: r.name, bytes: r.m.bytes, entries: ents, kind: r.m.kind,
      onReady: (a) => { W.ed = a; W.dlgKey = () => a.focus(); },
      onClose: () => { W.ed = null; W.dlgKey = null; W.el.focus(); },
      onSave: async (out, secs) => {
        snapshot('sector edit', [r]);
        r.m.bytes.set(out); r.m = C.mount(r.m.bytes, r.name); await commit(r);
        log(`Wrote ${secs.length} edited sector(s) to ${r.name}.`); render();
      },
    });
  }

  // ---------- folder -> disk(s) ----------
  function doF2D() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.webkitdirectory = true; inp.multiple = true;
    inp.onchange = () => { const fl = [...inp.files]; if (fl.length) f2dDialog(fl); };
    inp.click();
  }
  async function f2dDialog(fl) {
    const items = fl.map((f) => ({ f, path: (f.webkitRelativePath || f.name).replace(/\\/g, '/'), size: f.size })).filter((x) => !/(^|\/)(LONGNAME\.TXT)$/i.test(x.path));
    const root = (items[0].path.split('/')[0] || 'FOLDER'), total = items.reduce((a, x) => a + x.size, 0);
    const dirs = new Set(); for (const x of items) for (let p = parentOf(x.path); p; p = parentOf(p)) dirs.add(p);
    const kb = (b) => b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : Math.ceil(b / 1024) + ' KB';
    const w = document.createElement('div');
    const specOpts = C.SPECS.map((s) => `<option value="${s.id}">${esc(s.label)} (${kb(C.specBytes(s))})</option>`).join('');
    w.innerHTML = `<div><b>${esc(root)}</b>: ${items.length} file(s), ${dirs.size} folder(s), ${kb(total)} of data</div>
      <div class="dim" style="margin-top:8px">Disk layout</div>
      <select class="mode" style="width:100%"><option value="single">One disk, smallest size that fits</option><option value="set">A set of disks of a chosen size (span)</option></select>
      <div class="dim" style="margin-top:8px">Format</div><select class="fmt" style="width:100%"><option value="mydos">MyDOS</option><option value="sdfs">SpartaDOS (bigger directories)</option></select>
      <div class="szrow"><div class="dim" style="margin-top:8px">Disk size</div><select class="sz" style="width:100%">${specOpts}<option value="custom">Custom (MB)…</option></select><input class="cu" type="number" min="0.1" max="16" step="0.1" value="1.4" style="width:100%;box-sizing:border-box;display:none;margin-top:4px"></div>
      <div class="dim" style="margin-top:8px">Packing</div>
      <select class="fit" style="width:100%"><option value="order">Keep folder order (like a backup span)</option><option value="tight">Fill each disk as full as possible</option></select>
      <label style="display:block;margin-top:8px"><input type="checkbox" class="flat"> Flatten (no sub-folders)</label>
      <label style="display:block;margin-top:4px"><input type="checkbox" class="zipit"> Also download everything as a .zip</label>
      <div class="dim" style="margin-top:8px">Disk name</div><input class="nm" style="width:100%;box-sizing:border-box" value="${esc(root.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 8) || 'FOLDER')}">
      <div class="est" style="margin-top:10px"></div>`;
    const q = (s) => w.querySelector(s);
    let cur = null;
    const calc = () => {
      const fmt = q('.fmt').value, set = q('.mode').value === 'set';
      q('.szrow').style.display = set ? '' : 'none';
      for (const o of q('.sz').options) o.hidden = o.value !== 'custom' && C.SPECS.find((s) => s.id === o.value).fmt !== fmt;
      if (set && q('.sz').selectedOptions[0].hidden) q('.sz').value = C.SPECS.find((s) => s.fmt === fmt && s.ss === 256 && s.sectors === 2880).id;
      q('.cu').style.display = set && q('.sz').value === 'custom' ? '' : 'none';
      const fl2 = items.map((x) => ({ path: x.path, size: x.size })), o = { fit: q('.fit').value, flatten: q('.flat').checked };
      let plan = null;
      try {
        if (!set) plan = C.planSingle(fl2, fmt, o);
        else plan = C.planSet(fl2, q('.sz').value === 'custom' ? C.customSpec(fmt, (+q('.cu').value || 1.4) * 1048576) : C.SPECS.find((s) => s.id === q('.sz').value), o);
      } catch (e) { q('.est').innerHTML = `<span class="warn">${esc(e.message)}</span>`; cur = null; return; }
      cur = plan; const est = q('.est');
      if (!plan) { est.innerHTML = '<span class="warn">Does not fit on one disk (even 16 MB). Choose "A set of disks".</span>'; return; }
      const sb = C.specBytes(plan.spec), n = plan.disks.length;
      const used = plan.disks.map((d) => d.usedSectors * (plan.spec.ss - (fmt === 'sdfs' ? 0 : 3)));
      est.innerHTML = `<b>${n} disk(s)</b> of ${esc(plan.spec.label)} (${kb(sb)} each, ${kb(sb * n)} total)`
        + `<div class="dim">${plan.disks.slice(0, 8).map((d, k) => `Disk ${k + 1}: ${d.files.length} file(s), ${kb(used[k])} used, ${kb(d.freeSectors * plan.spec.ss)} free`).join('<br>')}${n > 8 ? '<br>…' : ''}</div>`
        + (plan.tooBig.length ? `<div class="warn">${plan.tooBig.length} file(s) are too big for one disk and will be skipped: ${esc(plan.tooBig.slice(0, 4).map((i) => baseOf(items[i].path)).join(', '))}${plan.tooBig.length > 4 ? ', …' : ''}</div>` : '');
    };
    w.addEventListener('input', calc); w.addEventListener('change', calc); calc();
    const ok = await dlg('Folder → disk(s)', w, [{ label: 'Cancel', value: null }, { label: 'Make disk(s)', value: () => (cur && cur.disks.length ? { plan: cur, name: q('.nm').value.trim() || 'FOLDER', flat: q('.flat').checked, zip: q('.zipit').checked } : undefined), pri: true }]);
    if (!ok) return;
    try {
      const data = [];
      for (const x of items) data.push({ path: x.path, size: x.size, data: await AC.Progress.read(x.f, 'Reading ' + x.path), lastModified: x.f.lastModified });
      const set = C.buildSet(data, ok.plan, { label: ok.name, flatten: ok.flat });
      if (!set.disks.length) return log('folder → disk: nothing could be written');
      const base = ok.name.replace(/[^\w-]/g, '_'), out = [];
      set.disks.forEach((d, k) => {
        const nm = set.disks.length > 1 ? `${base}_${k + 1}of${set.disks.length}.atr` : base + '.atr', key = 'F' + (++W.seq);
        W.mounts.set(key, { key, kind: 'file', name: nm, m: d.m, handle: null, unsaved: true }); out.push({ key, name: nm, data: d.bytes });
      });
      W.panes[0] && Object.assign(W.panes[0], { src: out[0].key, dir: '', sel: new Set() });
      if (out[1]) Object.assign(W.panes[1], { src: out[1].key, dir: '', sel: new Set() });
      if (ok.zip) host().save(base + '.zip', host().zip(out.map((o) => ({ name: o.name, data: o.data }))), 'application/zip');
      log(`Made ${out.length} disk(s) from ${root}` + (set.failed.length ? `; ${set.failed.length} file(s) skipped (${set.failed.slice(0, 3).map((f) => baseOf(f.path) + ': ' + f.error).join('; ')})` : '') + '. Use Save as… on each pane to keep them.');
      render();
    } catch (e) { log('folder → disk: ' + e.message); }
  }

  // ---------- new disk / compare ----------
  async function doNewDisk() {
    const D = AC.DosFs, fm = [
      ['MyDOS 90K (128-byte sectors, 720)', () => D.createMyDos({ sectorSize: 128, sectors: 720 })],
      ['MyDOS 360K (256-byte sectors, 1440)', () => D.createMyDos({ sectorSize: 256, sectors: 1440 })],
      ['MyDOS 16 MB (256-byte sectors, 65535)', () => D.createMyDos({ sectorSize: 256, sectors: 65535 })],
      ['SpartaDOS 720K (256-byte, 2880)', () => D.createSdfs({ sectorSize: 256, sectors: 2880, label: 'NEWDISK' })],
      ['SpartaDOS 16 MB (256-byte, 65535)', () => D.createSdfs({ sectorSize: 256, sectors: 65535, label: 'NEWDISK' })],
    ];
    const w = document.createElement('div');
    w.innerHTML = `<div class="dim">Format</div><select class="f" style="width:100%">${fm.map((x, k) => `<option value="${k}">${esc(x[0])}</option>`).join('')}</select><div class="dim" style="margin-top:8px">File name</div><input class="n" style="width:100%;box-sizing:border-box" value="NEW.ATR"><div class="dim" style="margin-top:8px">The disk opens in the active pane. It is empty and not bootable until you copy a DOS onto it. Save it to the PC or mount it with Add to drive.</div>`;
    const v = await dlg('New disk', w, [{ label: 'Cancel', value: null }, { label: 'Create', value: () => ({ k: +w.querySelector('.f').value, n: w.querySelector('.n').value.trim() || 'NEW.ATR' }), pri: true }]);
    if (!v) return;
    try {
      const bytes = fm[v.k][1](), m = C.mount(bytes, v.n), key = 'F' + (++W.seq);
      W.mounts.set(key, { key, kind: 'file', name: v.n, m, handle: null, unsaved: true });
      Object.assign(W.panes[W.active], { src: key, dir: '', sel: new Set() }); log('Created ' + v.n); render();
    } catch (e) { log('new disk: ' + e.message); }
  }
  function doCompare() {
    const a = rec(W.panes[0]), b = rec(W.panes[1]); if (!a || !b) return log('choose a disk in both panes first');
    const idx = (r) => new Map(C.entries(r.m).map((e) => [e.path.toUpperCase(), e]));
    const A = idx(a), B = idx(b), onlyA = [], onlyB = [], diff = []; let same = 0;
    for (const [k, e] of A) { const o = B.get(k); if (!o) onlyA.push(e.path); else if (!e.dir && !o.dir) { if (eq(a.m.vol.read(e.raw), b.m.vol.read(o.raw))) same++; else diff.push(e.path); } }
    for (const [k, e] of B) if (!A.has(k)) onlyB.push(e.path);
    const list = (t, l, c) => l.length ? `<div class="${c}" style="margin-top:8px"><b>${t} (${l.length})</b></div><div class="dim">${l.slice(0, 40).map(esc).join('<br>')}${l.length > 40 ? '<br>…' : ''}</div>` : '';
    msg('Compare panes', `<div>${esc(a.name)} ⇄ ${esc(b.name)}</div><div class="ok" style="margin-top:6px">${same} identical file(s)</div>${list('Different content', diff, 'warn')}${list('Only on the left', onlyA, '')}${list('Only on the right', onlyB, '')}`);
  }

  // ---------- keyboard ----------
  function onKey(e) {
    if (e.target.closest && e.target.closest('.wed')) return;
    if (W.ed) { W.ed.focus(); e.preventDefault(); e.stopPropagation(); return; }
    if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') { if (e.key === 'Escape' && !W.el.querySelector('.wdlg')) e.target.blur(); return; }
    if (W.el.querySelector('.wdlg')) return;
    const p = W.panes[W.active], rows = rowsOf(p), k = e.key;
    const move = (d) => { const idx = rows.findIndex((x) => x.path === p.cur), n = Math.max(0, Math.min(rows.length - 1, (idx < 0 ? (d > 0 ? -1 : rows.length) : idx) + d)); if (!rows[n]) return; p.cur = rows[n].path; if (e.shiftKey) p.sel.add(p.cur); else p.sel = new Set([p.cur]); render(); W.el.querySelector(`.wp[data-i="${W.active}"] tr.cur`)?.scrollIntoView({ block: 'nearest' }); };
    let hit = true;
    if (k === 'Tab') { W.active = 1 - W.active; render(); }
    else if (k === 'ArrowDown') move(1); else if (k === 'ArrowUp') move(-1);
    else if (k === 'Enter' && e.altKey) doProps(); else if (k === 'Enter') { if (p.cur) openRow(W.active, p.cur); else if (p.dir) { /* none */ } }
    else if (k === 'Backspace') { p.dir = parentOf(p.dir); p.sel = new Set(); render(); }
    else if (k === ' ' || k === 'Insert') { if (p.cur) { p.sel.has(p.cur) ? p.sel.delete(p.cur) : p.sel.add(p.cur); if (k === 'Insert') { const idx = rows.findIndex((x) => x.path === p.cur); if (rows[idx + 1]) p.cur = rows[idx + 1].path; } render(); } }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'a') act('all');
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') undo();
    else if (k === 'F2') doRename(); else if (k === 'F3') viewFile(W.active); else if (k === 'F5') xfer(false); else if (k === 'F6') xfer(true); else if (k === 'F7') doMkdir(); else if (k === 'F8' || k === 'Delete') doDelete();
    else if (k === 'Escape') close();
    else hit = false;
    if (hit) { e.preventDefault(); e.stopPropagation(); }
  }

  // The emulator listens on window; while WebAFM is open it must not see the keys, even when focus fell back to the page.
  window.addEventListener('keydown', (e) => {
    if (!W.el || W.el.style.display === 'none' || W.el.contains(e.target)) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (W.dlgKey) { W.dlgKey(e); e.stopPropagation(); return; }
    W.el.focus(); onKey(e);
    if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
  }, true);

  AC.WebAfm = { open, close, openDrive: (pane, n) => open({ pane, drive: n }), openFile: (pane, file) => { open(); return openFile(pane, file); }, openFolder: (pane, handle) => { open(); return openFolder(pane, handle); }, _state: W, _core: C };
})();
