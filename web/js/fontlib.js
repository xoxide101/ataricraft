// Local font library (IndexedDB). Import .FNT (1024-byte Atari sets), .TTF/.OTF and .ZIP packs of them.
// The FONT editor loads the .FNT sets; WebAFM print embeds a chosen .TTF/.OTF in the printed page.
// Fonts stay in this browser only; nothing is uploaded or bundled.
(function () {
  const DB = 'ac-fonts', ST = 'fonts';
  const open = () => new Promise((res, rej) => {
    const q = indexedDB.open(DB, 1);
    q.onupgradeneeded = () => q.result.createObjectStore(ST, { keyPath: 'id', autoIncrement: true });
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  const tx = async (mode, f) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(ST, mode), r = f(t.objectStore(ST)); t.oncomplete = () => { d.close(); res(r && r.result); }; t.onerror = () => { d.close(); rej(t.error); }; }); };
  const list = async () => (await tx('readonly', (s) => s.getAll())).map((f) => ({ id: f.id, name: f.name, kind: f.kind, pack: f.pack, size: f.bytes.length }));
  const get = (id) => tx('readonly', (s) => s.get(id));
  const remove = (id) => tx('readwrite', (s) => s.delete(id));
  const clear = () => tx('readwrite', (s) => s.clear());
  const add = async (recs) => { if (recs.length) await tx('readwrite', (s) => { recs.forEach((r) => s.put(r)); }); return recs.length; };

  const base = (p) => p.split(/[\\/]/).pop();
  const stem = (p) => base(p).replace(/\.[^.]*$/, '');
  function classify(path, bytes, pack) {
    const ext = (/\.([^.\\/]+)$/.exec(path) || [])[1];
    const e = ext ? ext.toLowerCase() : '';
    if (e === 'fnt' && bytes.length === 1024) return { name: stem(path), kind: 'fnt', pack, bytes };
    if (e === 'ttf' || e === 'otf') return { name: stem(path), kind: 'ttf', pack, bytes };
    return null;
  }
  // files: File objects. Returns { added, skipped }.
  async function importFiles(files) {
    const recs = []; let skipped = 0;
    const have = new Set((await list()).map((f) => f.pack + '|' + f.kind + '|' + f.name));
    const push = (r) => { const k = r.pack + '|' + r.kind + '|' + r.name; if (!r || have.has(k)) { skipped++; return; } have.add(k); recs.push(r); };
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) {
        const pack = stem(f.name);
        for (const ent of await AC.Zip.list(f)) {
          if (!/\.(fnt|ttf|otf)$/i.test(ent.name) || /(^|\/)(__MACOSX|Source)\//i.test(ent.name)) continue;
          const r = classify(ent.name, await AC.Zip.extract(f, ent), pack);
          if (r) push(r); else skipped++;
        }
      } else {
        const r = classify(f.name, new Uint8Array(await f.arrayBuffer()), 'Imported');
        if (r) push(r); else skipped++;
      }
    }
    return { added: await add(recs), skipped };
  }
  // Registers a stored TTF/OTF with the page so it can be used by name; returns the family name.
  async function face(id) {
    const r = await get(id); if (!r || r.kind !== 'ttf') return null;
    const fam = 'ACLib' + id;
    if (!document.fonts.check('12px ' + fam)) { const ff = new FontFace(fam, r.bytes.buffer.slice(r.bytes.byteOffset, r.bytes.byteOffset + r.bytes.byteLength)); await ff.load(); document.fonts.add(ff); }
    return fam;
  }
  const b64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  // CSS @font-face block for a stored font, for embedding in a printable page.
  async function css(id, family) { const r = await get(id); return r && r.kind === 'ttf' ? `@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${b64(r.bytes)})}` : ''; }

  window.AC = window.AC || {};
  AC.FontLib = { list, get, remove, clear, importFiles, face, css };
})();
