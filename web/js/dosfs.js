// Atari disk-image filesystems: browse/extract DOS 2.x, MyDOS and SpartaDOS-family (SDFS: SpartaDOS 3.x, BW-DOS,
// RealDOS) volumes in ATR/XFD images, and create/write SDFS volumes up to the 65535-sector ATR limit.
// ATR 256-byte layout: sectors 1-3 are stored as 128 bytes (packed). Some tools (mkatr) store them as full 256-byte
// slots instead; both are read, new images always use the packed form.
(function () {
  const rd16 = (a, o) => a[o] | (a[o + 1] << 8);
  const rd24 = (a, o) => a[o] | (a[o + 1] << 8) | (a[o + 2] << 16);
  const str = (a, o, n) => String.fromCharCode(...a.subarray(o, o + n)).replace(/[^\x20-\x7e]/g, '').trim();
  const join = (n, e) => (e ? n + '.' + e : n);

  function layout(b) {
    const atr = b.length >= 16 && b[0] === 0x96 && b[1] === 0x02;
    const hdr = atr ? 16 : 0;
    const data = b.length - hdr;
    const ss = atr ? (rd16(b, 4) || 128) : (data % 128 === 0 && data / 128 === 720 || data / 128 === 1040 ? 128 : (data % 256 === 0 ? 256 : 128));
    const uniform = ss === 128 || data % ss === 0;
    const nsec = ss === 128 ? Math.floor(data / 128) : uniform ? Math.floor(data / ss) : 3 + Math.floor((data - 384) / ss);
    const sec = (n) => {
      if (n < 1 || n > nsec) throw new RangeError('sector ' + n + ' out of range');
      if (uniform || n > 3) {
        const o = hdr + (uniform ? (n - 1) * ss : 384 + (n - 4) * ss);
        return b.subarray(o, o + ss);
      }
      const o = hdr + (n - 1) * 128;
      return b.subarray(o, o + 128);
    };
    return { ss, uniform, nsec, sec, hdr };
  }

  function stamp(d, o) {
    const dd = d[o], mm = d[o + 1], yy = d[o + 2];
    if (!dd || !mm) return '';
    const p = (x) => String(x).padStart(2, '0');
    return `${yy < 80 ? 2000 + yy : 1900 + yy}-${p(mm)}-${p(dd)} ${p(d[o + 3])}:${p(d[o + 4])}`;
  }

  // ---------------- SDFS ----------------
  function looksSdfs(L) {
    const s1 = L.sec(1);
    const root = rd16(s1, 9), total = rd16(s1, 11);
    if (root < 4 || root > L.nsec || !total || total > L.nsec + 1) return false;
    try {
      const m = L.sec(root), d1 = rd16(m, 4);
      if (!d1 || d1 > L.nsec) return false;
      const d = L.sec(d1);
      return (d[0] & 0x28) === 0x28 && d[0] !== 0xff && rd24(d, 3) % 23 === 0 && rd24(d, 3) >= 23;
    } catch (e) { return false; }
  }

  function sdfsVol(b, L) {
    const { ss, sec } = L;
    const ptrs = (ss - 4) >> 1;
    const boot = () => sec(1);
    const guard = L.nsec + 8;

    function mapSectors(map) {
      const out = [], maps = [];
      let m = map, g = 0;
      while (m && g++ < guard) {
        maps.push(m);
        const s = sec(m);
        for (let i = 4; i + 1 < ss; i += 2) { const d = rd16(s, i); if (!d) break; out.push(d); }
        m = rd16(s, 0);
      }
      return { data: out, maps };
    }
    function readMap(map, len) {
      const { data } = mapSectors(map);
      const n = len == null ? data.length * ss : Math.min(len, data.length * ss);
      const out = new Uint8Array(n);
      for (let i = 0, o = 0; o < n; i++, o += ss) out.set(sec(data[i]).subarray(0, Math.min(ss, n - o)), o);
      return out;
    }
    function dirEntries(map, prefix, out) {
      const d = readMap(map, rd24(readMap(map, 6), 3));
      for (let o = 23; o + 23 <= d.length; o += 23) {
        const fl = d[o];
        if (!(fl & 0x08) || (fl & 0x10)) continue;
        const name = join(str(d, o + 6, 8), str(d, o + 14, 3));
        if (!name || !/^[\x20-\x7e]+$/.test(String.fromCharCode(...d.subarray(o + 6, o + 17)))) continue;
        const e = { path: prefix + name, name, dir: !!(fl & 0x20), map: rd16(d, o + 1), size: rd24(d, o + 3), date: stamp(d, o + 17), flags: fl };
        out.push(e);
        if (e.dir && e.map) dirEntries(e.map, e.path + '/', out);
      }
      return out;
    }

    // ---- allocation ----
    const bs = () => rd16(boot(), 16);
    const bitsPer = ss * 8;
    function bitLoc(n) { return [sec(bs() + Math.floor(n / bitsPer)), (n % bitsPer) >> 3, 0x80 >> (n & 7)]; }
    const isFree = (n) => { const [s, i, m] = bitLoc(n); return !!(s[i] & m); };
    function setFreeCount(d) { const s = boot(), f = rd16(s, 13) + d; s[13] = f & 255; s[14] = (f >> 8) & 255; }
    function alloc() {
      const total = L.nsec, s1 = boot();
      let n = rd16(s1, 18) || 4;
      for (let k = 0; k < total; k++, n++) {
        if (n > total) n = 4;
        if (isFree(n)) {
          const [s, i, m] = bitLoc(n); s[i] &= ~m; setFreeCount(-1);
          s1[18] = (n + 1) & 255; s1[19] = ((n + 1) >> 8) & 255;
          sec(n).fill(0);
          return n;
        }
      }
      throw new Error('disk full');
    }
    function release(n) { if (!isFree(n)) { const [s, i, m] = bitLoc(n); s[i] |= m; setFreeCount(1); } }
    const freeSectors = () => rd16(boot(), 13);

    // ---- maps ----
    function appendPtr(map, d) {
      let m = map;
      for (let g = 0; g < guard; g++) {
        const s = sec(m);
        for (let i = 4; i + 1 < ss; i += 2) if (!rd16(s, i)) { s[i] = d & 255; s[i + 1] = d >> 8; return; }
        const nx = rd16(s, 0);
        if (nx) { m = nx; continue; }
        const nm = alloc(), ns = sec(nm);
        s[0] = nm & 255; s[1] = nm >> 8; ns[2] = m & 255; ns[3] = m >> 8;
        m = nm;
      }
      throw new Error('sector map loop');
    }
    function freeChain(map) {
      const { data, maps } = mapSectors(map);
      data.forEach(release); maps.forEach(release);
    }

    // ---- directories ----
    function dirWrite(map, buf) {
      let { data } = mapSectors(map);
      while (data.length * ss < buf.length) { const d = alloc(); appendPtr(map, d); data = data.concat([d]); }
      for (let i = 0, o = 0; o < buf.length; i++, o += ss) sec(data[i]).set(buf.subarray(o, Math.min(o + ss, buf.length)));
    }
    const setLen = (a, o, n) => { a[o] = n & 255; a[o + 1] = (n >> 8) & 255; a[o + 2] = (n >> 16) & 255; };
    function nowStamp() {
      const t = new Date();
      return [t.getDate(), t.getMonth() + 1, t.getFullYear() % 100, t.getHours(), t.getMinutes(), t.getSeconds()];
    }
    function packName(nm) {
      const m = /^([A-Z0-9_]{1,8})(?:\.([A-Z0-9_]{0,3}))?$/.exec(nm.toUpperCase());
      if (!m) throw new Error('invalid name "' + nm + '" (use 8.3, A-Z 0-9 _)');
      const out = new Uint8Array(11).fill(0x20);
      for (let i = 0; i < m[1].length; i++) out[i] = m[1].charCodeAt(i);
      for (let i = 0; i < (m[2] || '').length; i++) out[8 + i] = m[2].charCodeAt(i);
      return out;
    }
    const sameName = (d, o, p) => { for (let i = 0; i < 11; i++) if (d[o + 6 + i] !== p[i]) return false; return true; };

    // Locate directory by path parts; returns {map, parent:{map, off}|null}
    function findDir(parts, create) {
      let cur = { map: rd16(boot(), 9), parent: null };
      for (const part of parts) {
        const d = readMap(cur.map, rd24(readMap(cur.map, 6), 3)), p = packName(part);
        let hit = -1;
        for (let o = 23; o + 23 <= d.length; o += 23) if ((d[o] & 0x28) === 0x28 && !(d[o] & 0x10) && sameName(d, o, p)) { hit = o; break; }
        if (hit < 0) {
          if (!create) throw new Error('no such directory: ' + part);
          hit = addEntry(cur, p, 0x28, true);
          const d2 = readMap(cur.map, rd24(readMap(cur.map, 6), 3));
          cur = { map: rd16(d2, hit + 1), parent: { map: cur.map, off: hit, parentRef: cur } };
        } else cur = { map: rd16(d, hit + 1), parent: { map: cur.map, off: hit, parentRef: cur } };
      }
      return cur;
    }

    // Append (or reuse a deleted slot for) an entry in dir `cur`; returns its byte offset. For directories, allocates and initialises the child.
    function addEntry(cur, packed, flag, isDir, fileMap, size) {
      let d = readMap(cur.map, rd24(readMap(cur.map, 6), 3));
      let off = -1;
      for (let o = 23; o + 23 <= d.length; o += 23) if (!(d[o] & 0x08)) { off = o; break; }
      if (off < 0) {
        if (d.length + 23 > 32768) throw new Error('directory full (SDFS limit is 32768 bytes, ~1424 entries)');
        off = d.length; const nd = new Uint8Array(d.length + 23); nd.set(d); d = nd;
      }
      const e = d.subarray(off, off + 23);
      e.fill(0); e[0] = flag;
      e.set(packed, 6); e.set(nowStamp(), 17);
      let map = fileMap || 0;
      if (isDir) {
        map = alloc();
        const dd = alloc(); appendPtr(map, dd);
        const hdr = new Uint8Array(23); hdr[0] = 0x28; hdr[1] = cur.map & 255; hdr[2] = cur.map >> 8; setLen(hdr, 3, 23);
        hdr.set(packed, 6); hdr.set(nowStamp(), 17);
        sec(dd).set(hdr);
        size = 23;
      }
      e[1] = map & 255; e[2] = map >> 8; setLen(e, 3, size || 0);
      if (d.length > rd24(d, 3)) setLen(d, 3, d.length);
      dirWrite(cur.map, d);
      growParents(cur, d.length);
      return off;
    }
    // A directory's length is also recorded in the parent's entry for it.
    function growParents(cur, len) {
      if (!cur.parent) return;
      const pm = cur.parent.map, pd = readMap(pm, rd24(readMap(pm, 6), 3));
      setLen(pd, cur.parent.off + 3, len);
      dirWrite(pm, pd);
    }

    function writeFile(path, data, overwrite = true) {
      const parts = path.split('/').filter(Boolean), fname = parts.pop();
      const dir = findDir(parts, true), p = packName(fname);
      const d = readMap(dir.map, rd24(readMap(dir.map, 6), 3));
      for (let o = 23; o + 23 <= d.length; o += 23) if ((d[o] & 0x08) && !(d[o] & 0x10) && sameName(d, o, p)) {
        if ((d[o] & 0x20) || !overwrite) throw new Error('exists: ' + path);
        removeAt(dir, o);
        break;
      }
      const n = Math.ceil(data.length / ss);
      if (n + Math.ceil(n / ptrs) + 2 > freeSectors()) throw new Error('disk full');
      const map = alloc();
      for (let i = 0; i < n; i++) {
        const s = alloc();
        appendPtr(map, s);
        sec(s).set(data.subarray(i * ss, Math.min((i + 1) * ss, data.length)));
      }
      addEntry(dir, p, 0x08, false, map, data.length);
    }
    function removeAt(dir, off) {
      const d = readMap(dir.map, rd24(readMap(dir.map, 6), 3));
      if (d[off] & 0x20) throw new Error('is a directory');
      freeChain(rd16(d, off + 1));
      d[off] = 0x10; d[off + 1] = 0; d[off + 2] = 0;
      dirWrite(dir.map, d);
    }
    function remove(path) {
      const parts = path.split('/').filter(Boolean), fname = parts.pop();
      const dir = findDir(parts, false), p = packName(fname);
      const d = readMap(dir.map, rd24(readMap(dir.map, 6), 3));
      for (let o = 23; o + 23 <= d.length; o += 23) if ((d[o] & 0x08) && !(d[o] & 0x10) && sameName(d, o, p)) { removeAt(dir, o); return; }
      throw new Error('not found: ' + path);
    }
    function mkdir(path) { findDir(path.split('/').filter(Boolean), true); }

    return {
      kind: 'sdfs', label: str(boot(), 22, 8), sectorSize: ss, sectors: L.nsec, layoutUniform: L.uniform,
      freeSectors,
      list: () => dirEntries(rd16(boot(), 9), '', []),
      read: (e) => readMap(e.map, e.size),
      writeFile, remove, mkdir,
    };
  }

  // ---------------- DOS 2.x / MyDOS ----------------
  function dosVol(b, L, kind) {
    const { ss, sec, nsec } = L;
    function read(e) {
      const parts = [];
      let n = e.start, g = 0;
      while (n && n <= nsec && g++ < nsec + 8) {
        const s = sec(n), l = s.length, cnt = s[l - 1];
        parts.push(s.subarray(0, Math.min(cnt, l - 3)));
        const hi = s[l - 3], lo = s[l - 2];
        // Large MyDOS volumes: if the top 6 bits are not this file's directory index the link is a full 16 bits.
        n = nsec > 1023 ? (hi << 8) | lo : ((hi & 3) << 8) | lo;
      }
      let t = 0; for (const p of parts) t += p.length;
      const out = new Uint8Array(t); t = 0; for (const p of parts) { out.set(p, t); t += p.length; }
      return out;
    }
    function dir(start, prefix, out, depth) {
      for (let i = 0; i < 8; i++) {
        const s = sec(start + i);
        for (let o = 0; o + 16 <= s.length; o += 16) {
          const f = s[o];
          if (f === 0) return;
          if (f & 0x80) continue;
          const isDir = !!(f & 0x10);
          if (!(f & 0x40) && !isDir) continue;
          const name = join(str(s, o + 5, 8), str(s, o + 13, 3));
          const e = { path: prefix + name, name, dir: isDir, count: rd16(s, o + 1), start: rd16(s, o + 3), size: rd16(s, o + 1) * (ss - 3), approxSize: true, index: i * (ss >> 4) + (o >> 4), flags: f };
          out.push(e);
          if (isDir && kind === 'mydos' && depth < 8 && e.start >= 4 && e.start + 7 <= nsec) dir(e.start, e.path + '/', out, depth + 1);
        }
      }
    }
    return {
      kind, label: '', sectorSize: ss, sectors: nsec, layoutUniform: L.uniform,
      list: () => { const out = []; dir(361, '', out, 0); return out; },
      read, readOnly: true,
    };
  }

  function open(bytes) {
    const L = layout(bytes);
    if (L.nsec < 4) return null;
    try {
      if (looksSdfs(L)) return sdfsVol(bytes, L);
      if (L.nsec >= 369) {
        const v = L.sec(360)[0], f0 = L.sec(361)[0];
        if (v !== 0xff && (f0 === 0 || (f0 & 0x40) || (f0 & 0x10)) && !(f0 & 0x20) && (f0 & 0x80) === 0) return dosVol(bytes, L, v === 2 || v === 0 ? 'dos2' : 'mydos');
      }
    } catch (e) { /* not a recognised volume */ }
    return null;
  }

  // New empty packed-layout ATR.
  function makeAtr(ss, nsec) {
    const len = ss === 128 ? nsec * 128 : 384 + (nsec - 3) * ss;
    const out = new Uint8Array(16 + len), par = len >> 4;
    out.set([0x96, 0x02, par & 255, (par >> 8) & 255, ss & 255, ss >> 8, (par >> 16) & 255]);
    return out;
  }

  // Empty SDFS volume (not bootable: add the DOS files, or boot another disk).
  function createSdfs(o) {
    const ss = o.sectorSize || 256, nsec = o.sectors || 65535, label = (o.label || 'DISK').toUpperCase().slice(0, 8);
    if (ss !== 256 && ss !== 512) throw new Error('SDFS volumes here use 256 or 512 byte sectors');
    if (nsec > 65535 || nsec < 100) throw new Error('sector count must be 100..65535');
    const img = makeAtr(ss, nsec), L = layout(img), s1 = L.sec(1);
    const bsLen = Math.ceil((nsec + 1) / (ss * 8)), bsStart = 4, rootMap = bsStart + bsLen, rootDir = rootMap + 1, first = rootDir + 1;
    s1.set([0x00, 0x03, 0x00, 0x07, 0x07, 0x07, 0x18, 0x80]); // byte 7 = $80 is checked by BW-DOS on mount
    s1[9] = rootMap & 255; s1[10] = rootMap >> 8;
    s1[11] = nsec & 255; s1[12] = nsec >> 8;
    const free = nsec - (first - 1);
    s1[13] = free & 255; s1[14] = free >> 8;
    s1[15] = bsLen; s1[16] = bsStart & 255; s1[17] = bsStart >> 8;
    s1[18] = first & 255; s1[19] = first >> 8; s1[20] = first & 255; s1[21] = first >> 8;
    for (let i = 0; i < 8; i++) s1[22 + i] = i < label.length ? label.charCodeAt(i) : 0x20;
    s1[30] = 0x28; s1[31] = ss === 512 ? 1 : 0; s1[32] = 0x20;
    // bitmap: bit7 of byte 0 = sector 0; set = free
    for (let n = 1; n <= nsec; n++) if (n >= first) { const s = L.sec(bsStart + Math.floor(n / (ss * 8))); s[(n % (ss * 8)) >> 3] |= 0x80 >> (n & 7); }
    const m = L.sec(rootMap); m[4] = rootDir & 255; m[5] = rootDir >> 8;
    const hdr = L.sec(rootDir), t = new Date();
    hdr[0] = 0x28; hdr[3] = 23;
    hdr.set(Array.from('MAIN       ').map((c) => c.charCodeAt(0)), 6);
    hdr.set([t.getDate(), t.getMonth() + 1, t.getFullYear() % 100, t.getHours(), t.getMinutes(), t.getSeconds()], 17);
    return img;
  }

  const api = { open, createSdfs, makeAtr, layout };
  if (typeof AC !== 'undefined') AC.DosFs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
