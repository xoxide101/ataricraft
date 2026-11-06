// Typeface registry for the three xCWriter views (docs/FONT.md). One list, built from the font manifest (scripts/fontlist.cjs:
// Craft faces, Shipped, Atari ROM, Personal) plus the fonts saved by the font editor in this browser (localStorage). Every face is
// reduced to the same thing, a bitmap per character: { w, h, px } with px[y * w + x] = 1 for ink. The views scale that bitmap into their
// cells; the high quality view gets the same face as a real web font (a TrueType file generated from the bitmaps, or the original
// TTF/OTF). Paragraph font names are the 8.3-safe ids ACWriter loads (<ID>.FNT / <ID>.ACF), see docs/CRAFT-FORMAT.md.
(function () {
  const CF = XCW.Font;
  const faces = {}, order = [], listeners = [];
  const LS = 'craft.userfonts';
  const faceId = (n) => n.split('/').pop().replace(/\.[^.]*$/, '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 8);
  const screenCode = (c) => (c >= 96 ? c : c - 32);
  const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const notify = () => listeners.forEach((f) => f());

  // ACWriter document byte 128..159 = Atari graphics 0..31 (docs/FONT.md); they fill the whole advance, so they are not centred like letters
  const gfxSlot = (c) => (c >= 128 && c < 160 ? c - 128 : -1);
  function bitmapOf(f, code, mode) {
    const gs = gfxSlot(code), rows = CF.render(f, gs >= 0 ? gs : code, mode || 0), px = new Uint8Array(f.adv * f.rows), cols = gs >= 0 ? Math.min(f.adv, CF.colsOf(f, gs)) : f.gw, off = gs < 0 && f.adv > f.gw + 1 ? 1 : 0;
    for (let y = 0; y < f.rows; y++) for (let x = 0; x < cols; x++) if (CF.hasPx(f, rows[y], x)) px[y * f.adv + x + off] = 1;
    return { w: f.adv, h: f.rows, px };
  }
  function fntBitmap(buf, code) {
    const o = (gfxSlot(code) >= 0 ? gfxSlot(code) : screenCode(code)) * 8, px = new Uint8Array(64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((buf[o + y] >> (7 - x)) & 1) px[y * 8 + x] = 1;
    return { w: 8, h: 8, px };
  }

  // face.get(code, mode) -> bitmap | null (mode 0 normal, 1 superscript, 2 subscript)
  function setData(face, data) {
    face.data = data; face.cache = {};
    if (data.fnt) { face.w = 8; face.h = 8; face.get = (c) => (c >= 32 && c <= 127 || gfxSlot(c) >= 0 ? (face.cache[c] = face.cache[c] || fntBitmap(data.fnt, c)) : null); }
    else {
      const f = data.acf; face.w = f.adv; face.h = f.rows; face.base = f.base; face.font = f;
      face.get = (c, m) => (c >= 32 && c <= 127 || gfxSlot(c) >= 0 ? (face.cache[c + ':' + (m || 0)] = face.cache[c + ':' + (m || 0)] || bitmapOf(f, c, m)) : null);
    }
    face.state = 'ready'; face.ttf = null;
  }

  async function load(face) {
    if (face.state === 'ready' || face.state === 'loading') return face.ready;
    face.state = 'loading';
    face.ready = (async () => {
      try {
        if (face.user) setData(face, { acf: CF.parse(fromB64(face.user)) });
        else {
          const buf = new Uint8Array(await (await fetch(face.url)).arrayBuffer());
          if (/\.fnt$/i.test(face.url)) { if (buf.length !== 1024) throw new Error('not a 1 KB Atari charset'); setData(face, { fnt: buf }); }
          else if (/\.(ttf|otf)$/i.test(face.url)) {
            const f = await CF.rasterTtf(toB64(buf), { size: 12, threshold: 0.3, hint: true, name: face.id });
            setData(face, { acf: f });
            face.vector = new FontFace('XCV_' + face.id, 'url(' + face.url + ')');
            face.vectorReady = face.vector.load().then((ff) => { document.fonts.add(ff); }).catch(() => {});
          } else setData(face, { acf: CF.parse(buf) });
        }
      } catch (e) { face.state = 'error'; face.error = String(e.message || e); }
      notify();
    })();
    return face.ready;
  }

  function add(id, label, group, extra) {
    if (faces[id]) return faces[id];
    const f = Object.assign({ id, label, group, state: 'new', cache: {} }, extra);
    faces[id] = f; order.push(id); return f;
  }
  function userFonts() { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } }

  async function init() {
    const http = /^https?:/.test(location.protocol);
    if (http) {
      try {
        const m = await (await fetch('library/fonts/local/manifest.json', { cache: 'no-store' })).json();
        for (const g of m.groups) for (const f of g.fonts) {
          if (!/\.(fnt|acf|ttf|otf)$/i.test(f.url)) continue;
          let id = faceId(f.url);
          for (let n = 2; faces[id]; n++) id = faceId(f.url).slice(0, 8 - String(n).length) + n;
          add(id, f.label || (g.id === 'personal' ? f.name : f.name.replace(/\.[^.]*$/, '')), g.label, { url: f.url, groupId: g.id });
        }
      } catch (e) { /* no manifest: run node scripts/fontlist.cjs */ }
    }
    refreshUser();
    notify();
  }
  function refreshUser() {
    const u = userFonts();
    for (const id of Object.keys(u)) {
      if (faces[id] && !faces[id].user) continue;
      const f = add(id, id + ' (font editor)', 'Font editor (this browser)', { user: u[id], groupId: 'user' });
      if (f.user !== u[id]) { f.user = u[id]; f.state = 'new'; f.cache = {}; }
    }
  }
  window.addEventListener('storage', (e) => { if (e.key === LS) { refreshUser(); notify(); } });

  // Minimal TrueType file from the bitmaps of a face (96 ASCII glyphs): each ink run is one rectangle, so the browser draws the pixel
  // face crisp at any size. 100 font units per pixel.
  function ttfOf(face) {
    const U = 100, h = face.h, w = face.w, base = (face.base ?? 8) + 1, asc = base * U, des = (h - base) * U;
    const glyphs = [[]];
    for (let c = 32; c <= 127; c++) {
      const bm = face.get(c), rects = [];
      if (bm) for (let y = 0; y < h; y++) for (let x = 0; x < w;) {
        if (!bm.px[y * w + x]) { x++; continue; }
        let x1 = x; while (x1 < w && bm.px[y * w + x1]) x1++;
        rects.push([x * U, (base - y - 1) * U, x1 * U, (base - y) * U + 1]); x = x1;
      }
      glyphs.push(rects);
    }
    const n = glyphs.length, parts = [];
    const loca = [0]; let off = 0;
    for (const rects of glyphs) {
      const k = rects.length, len = k ? 10 + 2 * k + 2 + 4 * k + 16 * k : 0, pad = (4 - (len % 4)) % 4, b = new DataView(new ArrayBuffer(len + pad));
      if (k) {
        let p = 0; const i16 = (v) => { b.setInt16(p, v); p += 2; };
        const xs = rects.flatMap((r) => [r[0], r[0], r[2], r[2]]), ys = rects.flatMap((r) => [r[1], r[3], r[3], r[1]]);
        i16(k); i16(Math.min(...xs)); i16(Math.min(...ys)); i16(Math.max(...xs)); i16(Math.max(...ys));
        for (let j = 0; j < k; j++) i16(j * 4 + 3);
        i16(0);
        for (let j = 0; j < k * 4; j++) { b.setUint8(p++, 1); }
        let px0 = 0; for (const x of xs) { i16(x - px0); px0 = x; }
        let py0 = 0; for (const y of ys) { i16(y - py0); py0 = y; }
      }
      parts.push(new Uint8Array(b.buffer)); off += len + pad; loca.push(off);
    }
    const cat = (arrs) => { const t = arrs.reduce((s, a) => s + a.length, 0), o = new Uint8Array(t); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };
    const dv = (size, fn) => { const d = new DataView(new ArrayBuffer(size)); fn(d); return new Uint8Array(d.buffer); };
    const maxPts = Math.max(...glyphs.map((g) => g.length * 4)), maxCon = Math.max(...glyphs.map((g) => g.length));
    const tables = {};
    tables['OS/2'] = dv(78, (d) => {
      d.setUint16(0, 0); d.setInt16(2, w * U); d.setUint16(4, 400); d.setUint16(6, 5);
      d.setInt16(10, 650); d.setInt16(12, 600); d.setInt16(16, 350); d.setInt16(18, 650); d.setInt16(20, 600); d.setInt16(24, 1000);
      d.setInt16(26, 50); d.setInt16(28, 300); d.setUint16(62, 0x40); d.setUint16(64, 32); d.setUint16(66, 127);
      d.setInt16(68, asc); d.setInt16(70, -des); d.setInt16(72, 0); d.setUint16(74, asc); d.setUint16(76, des);
    });
    tables.cmap = dv(44, (d) => {
      d.setUint16(0, 0); d.setUint16(2, 1); d.setUint16(4, 3); d.setUint16(6, 1); d.setUint32(8, 12);
      let p = 12; d.setUint16(p, 4); d.setUint16(p + 2, 32); d.setUint16(p + 4, 0); d.setUint16(p + 6, 4); d.setUint16(p + 8, 4); d.setUint16(p + 10, 1); d.setUint16(p + 12, 0);
      p += 14; d.setUint16(p, 127); d.setUint16(p + 2, 0xffff); p += 4; d.setUint16(p, 0); p += 2;
      d.setUint16(p, 32); d.setUint16(p + 2, 0xffff); p += 4; d.setInt16(p, -31); d.setInt16(p + 2, 1);
    });
    tables.glyf = cat(parts);
    tables.head = dv(54, (d) => {
      d.setUint32(0, 0x00010000); d.setUint32(4, 0x00010000); d.setUint32(12, 0x5f0f3cf5); d.setUint16(16, 0x000b); d.setUint16(18, h * U);
      d.setInt16(36, 0); d.setInt16(38, -des); d.setInt16(40, w * U); d.setInt16(42, asc); d.setUint16(46, 8); d.setInt16(48, 2); d.setInt16(50, 1);
    });
    tables.hhea = dv(36, (d) => {
      d.setUint32(0, 0x00010000); d.setInt16(4, asc); d.setInt16(6, -des); d.setUint16(10, w * U); d.setInt16(16, w * U); d.setInt16(18, 1); d.setUint16(34, n);
    });
    tables.hmtx = dv(4 * n, (d) => { for (let i = 0; i < n; i++) { d.setUint16(i * 4, w * U); d.setInt16(i * 4 + 2, glyphs[i].length ? Math.min(...glyphs[i].map((r) => r[0])) : 0); } });
    tables.loca = dv(4 * (n + 1), (d) => { loca.forEach((v, i) => d.setUint32(i * 4, v)); });
    tables.maxp = dv(32, (d) => { d.setUint32(0, 0x00010000); d.setUint16(4, n); d.setUint16(6, maxPts); d.setUint16(8, maxCon); d.setUint16(14, 2); });
    const nm = (s) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) b[i * 2 + 1] = s.charCodeAt(i); return b; };
    const names = [[1, face.id], [2, 'Regular'], [4, face.id], [6, 'XCF-' + face.id]].map(([id, s]) => [id, nm(s)]);
    let so = 0;
    tables.name = cat([dv(6 + 12 * names.length, (d) => {
      d.setUint16(2, names.length); d.setUint16(4, 6 + 12 * names.length);
      names.forEach(([id, b], i) => { const p = 6 + i * 12; d.setUint16(p, 3); d.setUint16(p + 2, 1); d.setUint16(p + 4, 0x409); d.setUint16(p + 6, id); d.setUint16(p + 8, b.length); d.setUint16(p + 10, so); so += b.length; });
    }), ...names.map((x) => x[1])]);
    tables.post = dv(32, (d) => { d.setUint32(0, 0x00030000); d.setInt16(8, -100); d.setInt16(10, 50); d.setUint32(12, 1); });
    const tags = Object.keys(tables).sort(), dirLen = 12 + 16 * tags.length;
    let pos = dirLen; const dir = new DataView(new ArrayBuffer(dirLen)), bodies = [];
    dir.setUint32(0, 0x00010000); dir.setUint16(4, tags.length); dir.setUint16(6, 128); dir.setUint16(8, 3); dir.setUint16(10, tags.length * 16 - 128);
    tags.forEach((t, i) => {
      const b = tables[t], padded = new Uint8Array(Math.ceil(b.length / 4) * 4); padded.set(b);
      let sum = 0; const v = new DataView(padded.buffer); for (let k = 0; k < padded.length; k += 4) sum = (sum + v.getUint32(k)) >>> 0;
      for (let k = 0; k < 4; k++) dir.setUint8(12 + i * 16 + k, t.charCodeAt(k));
      dir.setUint32(12 + i * 16 + 4, sum); dir.setUint32(12 + i * 16 + 8, pos); dir.setUint32(12 + i * 16 + 12, b.length);
      bodies.push(padded); pos += padded.length;
    });
    return cat([new Uint8Array(dir.buffer), ...bodies]);
  }

  // CSS font-family for a face in the high quality view ('' for the standard face); the web font is registered once
  const hqFamilies = {};
  async function hqFont(face) {
    if (hqFamilies[face.id]) return hqFamilies[face.id];
    await load(face);
    if (face.state !== 'ready') return '';
    try {
      const ff = new FontFace('XCF_' + face.id, ttfOf(face).buffer);
      await ff.load(); document.fonts.add(ff); return (hqFamilies[face.id] = "'XCF_" + face.id + "',monospace");
    } catch (e) { face.error = 'web font: ' + e.message; }
    if (face.vectorReady) { await face.vectorReady; if (face.vector && face.vector.status === 'loaded') return (hqFamilies[face.id] = "'XCV_" + face.id + "',monospace"); }
    return '';
  }

  // reduce a bitmap to w x h by coverage (a target pixel is on when at least `th` of its source box is ink)
  function fold(bm, w, h, th = 0.5) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const x0 = (x * bm.w) / w, x1 = ((x + 1) * bm.w) / w, y0 = (y * bm.h) / h, y1 = ((y + 1) * bm.h) / h;
      let cov = 0, area = 0;
      for (let v = Math.floor(y0); v < Math.ceil(y1); v++) for (let u = Math.floor(x0); u < Math.ceil(x1); u++) {
        const a = (Math.min(u + 1, x1) - Math.max(u, x0)) * (Math.min(v + 1, y1) - Math.max(v, y0));
        area += a; if (bm.px[v * bm.w + u]) cov += a;
      }
      if (area && cov / area >= th - 1e-9) out[y * w + x] = 1;
    }
    return { w, h, px: out };
  }

  window.XFACE = {
    faces, order, init, load, faceId, ttfOf, hqFont, fold,
    list: () => order.map((id) => faces[id]),
    get: (id) => (id ? faces[id] || faces[String(id).toUpperCase()] || null : null),
    // starts loading and returns the face once its bitmaps are ready (null before that)
    css: (id) => hqFamilies[id] || '',
    use(id) { const f = id && (faces[id] || faces[String(id).toUpperCase()]); if (!f) return null; if (f.state === 'new') load(f); return f.state === 'ready' ? f : null; },
    onChange(fn) { listeners.push(fn); },
    nib(id, code) { const f = this.use(id), bm = f && f.get(code); if (!bm) return null; const k = id + ':n' + code; return (f.cache[k] = f.cache[k] || foldNib(bm)); },
    b8(id, code) { const f = this.use(id), bm = f && f.get(code); if (!bm) return null; const k = 'b8:' + code; return (f.cache[k] = f.cache[k] || fold(bm, 8, 8)); },
    saveUser(id, acfBytes) { const u = userFonts(); u[id] = toB64(acfBytes); localStorage.setItem(LS, JSON.stringify(u)); refreshUser(); notify(); },
  };
  function foldNib(bm) {
    const g = fold(bm, 4, 8), rows = [];
    for (let y = 0; y < 8; y++) { let n = 0; for (let x = 0; x < 4; x++) if (g.px[y * 4 + x]) n |= 8 >> x; rows.push(n); }
    return rows;
  }
})();
