// "Boot DOS" picker: lists dosboot.json records and boots one via ataricraft.bootRecord().
// Sources: the local relay (/dosboot/roots, same-origin), a folder picked with showDirectoryPicker (localhost/https only), or a records JSON file.
(function () {
  const $ = (id) => document.getElementById(id);
  const src = []; // {label, doc, fetchMedia(md) -> Uint8Array, save?(rec), del?(id)}
  let sel = null;

  async function unzipMember(buf, member) {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let e = buf.length - 22;
    while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('not a zip');
    let p = v.getUint32(e + 16, true);
    for (let n = v.getUint16(e + 10, true); n > 0; n--) {
      const method = v.getUint16(p + 10, true), csz = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
      const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl));
      if (!member || name === member) {
        const lo = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true), data = buf.subarray(lo, lo + csz);
        if (method === 0) return data;
        const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(ds).arrayBuffer());
      }
      p += 46 + nl + xl + cl;
    }
    throw new Error('member not found: ' + member);
  }

  async function fromRelay() {
    try {
      const r = await fetch('dosboot/roots', { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      const tok = () => localStorage.getItem('ac.nettoken') || (window.ac && window.ac.nettoken) || '';
      const post = (i, p, body) => fetch('dosboot/' + p + '?root=' + i, { method: 'POST', headers: { 'X-AC-Token': tok() }, body: JSON.stringify(body) }).then(async (x) => { const o = await x.json(); if (!x.ok) throw new Error(o.error); return o; });
      for (const root of j.roots) {
        src.push({
          label: 'relay: ' + root.root, doc: root.doc,
          fetchMedia: async (md) => new Uint8Array(await (await fetch('dosboot/media?root=' + root.i + '&path=' + encodeURIComponent(md.path) + (md.member ? '&member=' + encodeURIComponent(md.member) : ''))).arrayBuffer()),
          save: (rec) => post(root.i, 'record', { record: rec }), del: (id) => post(root.i, 'record', { delete: id }),
        });
      }
    } catch (e) { /* no relay */ }
  }

  async function fromDir(dir) {
    const walk = async (parts) => { let d = dir; for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p); return d.getFileHandle(parts[parts.length - 1]); };
    let doc;
    try { doc = AC.DosBoot.parse(await (await (await dir.getFileHandle('dosboot.json')).getFile()).text()); } catch (e) { doc = null; }
    if (!doc) { alert('No dosboot.json in that folder. Run: node scripts\\dosboot-scan.cjs "<folder>"'); return; }
    src.push({
      label: 'folder: ' + dir.name, doc,
      fetchMedia: async (md) => {
        const b = new Uint8Array(await (await (await walk(md.path.split('/'))).getFile()).arrayBuffer());
        return md.member ? unzipMember(b, md.member) : b;
      },
    });
  }

  function render() {
    const q = ($('dbq').value || '').toLowerCase(), box = $('dblist');
    box.textContent = '';
    for (const s of src) {
      for (const rec of s.doc.records) {
        const m = rec.machine || {};
        const txt = [rec.name, rec.family, rec.version].join(' ').toLowerCase();
        if (q && !txt.includes(q)) continue;
        const row = document.createElement('div');
        row.className = 'row'; row.dataset.id = rec.id;
        row.innerHTML = '<span style="flex:1"></span><span class="dim"></span><button>Boot</button><button>Edit</button>';
        row.children[0].textContent = rec.name;
        row.children[1].textContent = (m.model || '') + '/' + (m.ram || '') + 'K';
        row.children[2].onclick = () => bootIt(s, rec);
        row.children[3].onclick = () => { sel = { s, rec }; $('dbjson').value = JSON.stringify(rec, null, 2); };
        box.appendChild(row);
      }
    }
    if (!box.children.length) box.textContent = src.length ? 'No matching records.' : 'No record sources found. Start the relay (node tools\\tnfs-bridge\\bridge.cjs) after running scripts\\dosboot-scan.cjs, pick a folder, or open a records file.';
  }

  async function bootIt(s, rec) {
    const st = $('dbstat');
    try {
      st.textContent = 'loading images…';
      const images = {};
      for (const md of rec.media || []) if (md.path) images[md.slot] = await s.fetchMedia(md);
      const ok = await window.ataricraft.bootRecord(rec, images);
      st.textContent = ok === false ? 'Need an OS ROM first (load ROMs, then try again).' : 'Booted ' + rec.name;
      if (ok !== false) $('dbdlg').close();
    } catch (e) { st.textContent = 'Failed: ' + e.message; }
  }

  function build() {
    const dlg = document.createElement('dialog');
    dlg.id = 'dbdlg';
    dlg.innerHTML = '<h3>Boot DOS</h3><div class="row"><input id="dbq" placeholder="filter (bw-dos, mydos, 2.5…)" style="flex:1"><button id="dbdir" title="Pick a folder containing dosboot.json (localhost / https only)">Folder…</button><button id="dbfile">Records file…</button><input id="dbfin" type="file" accept=".json" hidden></div>' +
      '<div id="dblist" style="max-height:40vh;overflow:auto;min-width:min(560px,80vw)"></div>' +
      '<details><summary>Add / edit record (JSON)</summary><textarea id="dbjson" rows="12" style="width:100%;font:12px monospace"></textarea><div class="row"><button id="dbnew">New template</button><button id="dbsave">Save to relay</button><button id="dbdel">Delete</button></div></details>' +
      '<div id="dbstat" class="dim"></div><div class="row" style="justify-content:flex-end"><button id="dbclose">Close</button></div>';
    document.body.appendChild(dlg);
    $('dbclose').onclick = () => dlg.close();
    $('dbq').oninput = render;
    $('dbdir').onclick = async () => {
      if (!window.showDirectoryPicker) { $('dbstat').textContent = 'Folder picker unavailable here (needs https or localhost); use the relay or a records file.'; return; }
      try { await fromDir(await window.showDirectoryPicker()); render(); } catch (e) { /* cancelled */ }
    };
    $('dbfile').onclick = () => $('dbfin').click();
    $('dbfin').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const doc = AC.DosBoot.parse(await f.text());
      src.push({ label: 'file: ' + f.name, doc, fetchMedia: async (md) => { const r = await fetch(new URL(md.path, location.href)); if (!r.ok) throw new Error('fetch ' + md.path + ': ' + r.status); const b = new Uint8Array(await r.arrayBuffer()); return md.member ? unzipMember(b, md.member) : b; } });
      render();
    };
    $('dbnew').onclick = () => { sel = null; $('dbjson').value = JSON.stringify(AC.DosBoot.newRecord({ name: 'My DOS', media: [{ slot: 'D1', role: 'boot', path: 'disk.atr' }] }), null, 2); };
    $('dbsave').onclick = async () => {
      try {
        const rec = JSON.parse($('dbjson').value), errs = AC.DosBoot.validateRecord(rec);
        if (errs.length) throw new Error(errs.join('; '));
        const s = (sel && sel.s) || src.find((x) => x.save);
        if (!s) throw new Error('no writable source (start the relay with --allow-write token)');
        await s.save(rec);
        const i = s.doc.records.findIndex((x) => x.id === rec.id);
        if (i >= 0) s.doc.records[i] = rec; else s.doc.records.push(rec);
        $('dbstat').textContent = 'Saved ' + rec.id; render();
      } catch (e) { $('dbstat').textContent = 'Save failed: ' + e.message; }
    };
    $('dbdel').onclick = async () => {
      try {
        if (!sel || !sel.s.del) throw new Error('select a relay record via Edit first');
        await sel.s.del(sel.rec.id);
        sel.s.doc.records = sel.s.doc.records.filter((x) => x.id !== sel.rec.id); render();
        $('dbstat').textContent = 'Deleted ' + sel.rec.id;
      } catch (e) { $('dbstat').textContent = 'Delete failed: ' + e.message; }
    };
    return dlg;
  }

  window.addEventListener('DOMContentLoaded', () => {
    const btn = document.createElement('button');
    btn.id = 'dosbtn'; btn.className = 'tgl'; btn.textContent = 'DOS'; btn.title = 'Boot a DOS from a dosboot.json record';
    $('fnbtn').after(btn);
    const dlg = build();
    btn.onclick = async () => { src.length = 0; await fromRelay(); render(); dlg.showModal(); };
    window.ataricraftDosBoot = { open: () => btn.click(), sources: src, boot: bootIt, render };
  });
})();
