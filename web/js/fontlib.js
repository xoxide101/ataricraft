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
    if (e === '64c' && bytes.length >= 1026) return { name: stem(path), kind: 'fnt', pack, bytes: fromC64(bytes) };
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

  // Rasterise a registered font family into an Atari 1024-byte set (screen-code order). Codes 64-95 (ATASCII graphics) are kept from `base`.
  function toAtari(family, o, base) {
    o = o || {}; const px = o.size || 8, dy = o.dy == null ? 7 : o.dy, th = o.threshold || 128, out = new Uint8Array(1024);
    if (base) out.set(base.subarray(0, 1024));
    const cv = document.createElement('canvas'); cv.width = 8; cv.height = 8; const g = cv.getContext('2d', { willReadFrequently: true });
    for (let sc = 0; sc < 128; sc++) {
      if (sc >= 64 && sc < 96) continue;
      const ch = String.fromCharCode(sc < 64 ? sc + 32 : sc);
      g.clearRect(0, 0, 8, 8); g.fillStyle = '#000'; g.font = `${px}px "${family}"`; g.textBaseline = 'alphabetic'; g.fillText(ch, o.dx || 0, dy);
      const d = g.getImageData(0, 0, 8, 8).data;
      for (let r = 0; r < 8; r++) { let v = 0; for (let c = 0; c < 8; c++) if (d[(r * 8 + c) * 4 + 3] >= th) v |= 0x80 >> c; out[sc * 8 + r] = v; }
    }
    return out;
  }

  // C64 charset (.64c: optional 2-byte load address, then 1024 or 2048 bytes of screen-code glyphs) to an Atari 1024-byte set.
  // The lower/upper second set is used when present; ATASCII graphics (codes 64-95) and the inverse half are kept from `base`.
  function fromC64(bytes, base) {
    const o = bytes.length % 1024 === 2 ? 2 : 0;
    const src = bytes.subarray(o), lo = src.length >= 2048 ? 1024 : 0, out = new Uint8Array(1024);
    if (base) out.set(base.subarray(0, 1024));
    for (let a = 32; a < 128; a++) {
      const sc = a === 64 ? 0 : (a >= 65 && a <= 90) ? a : (a >= 91 && a <= 95) ? a - 64 : (a >= 97 && a <= 122) ? a - 96 : a < 64 ? a : -1;
      const dst = a < 96 ? a - 32 : a; if (sc < 0 || (a >= 96 && !(a >= 97 && a <= 122))) continue;
      for (let r = 0; r < 8; r++) { out[dst * 8 + r] = src[lo + sc * 8 + r] || 0; out[(dst + 128) * 8 + r] = (~out[dst * 8 + r]) & 255; }
    }
    return out;
  }
  window.AC = window.AC || {};
  AC.FontLib = { list, get, remove, clear, importFiles, face, css, toAtari, fromC64 };
})();
