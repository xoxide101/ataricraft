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
      if (d[off] & 0x20) {
        const cd = readMap(rd16(d, off + 1), rd24(readMap(rd16(d, off + 1), 6), 3));
        for (let o = 23; o + 23 <= cd.length; o += 23) if ((cd[o] & 0x08) && !(cd[o] & 0x10)) throw new Error('directory not empty');
      }
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
    function rename(path, newName) {
      const parts = path.split('/').filter(Boolean), fname = parts.pop();
      const dir = findDir(parts, false), p = packName(fname), np = packName(newName);
      let d = readMap(dir.map, rd24(readMap(dir.map, 6), 3)), hit = -1;
      for (let o = 23; o + 23 <= d.length; o += 23) {
        if (!(d[o] & 0x08) || (d[o] & 0x10)) continue;
        if (sameName(d, o, np) && !sameName(d, o, p)) throw new Error('already exists: ' + newName);
        if (sameName(d, o, p)) hit = o;
      }
      if (hit < 0) throw new Error('not found: ' + path);
      d.set(np, hit + 6);
      dirWrite(dir.map, d);
      if (d[hit] & 0x20) sec(mapSectors(rd16(d, hit + 1)).data[0]).set(np, 6);
    }
    function setLabel(label) {
      const s = boot(), t = label.toUpperCase().replace(/[^A-Z0-9_ ]/g, '_').slice(0, 8);
      for (let i = 0; i < 8; i++) s[22 + i] = i < t.length ? t.charCodeAt(i) : 0x20;
    }

    return {
      kind: 'sdfs', label: str(boot(), 22, 8), sectorSize: ss, sectors: L.nsec, layoutUniform: L.uniform,
      freeSectors, setLabel, rename,
      list: () => dirEntries(rd16(boot(), 9), '', []),
      read: (e) => readMap(e.map, e.size),
      writeFile, remove, mkdir,
    };
  }

  // ---------------- DOS 2.x / MyDOS ----------------
  function dosVol(b, L, kind) {
    const { ss, sec, nsec } = L;
    // MyDOS volumes over 1023 sectors use full 16-bit links; DOS 2.5 enhanced density (1040 x 128) keeps 10-bit links.
    const use16 = nsec > 1023 && !(ss === 128 && nsec === 1040);
    const nextOf = (s) => { const l = s.length; return use16 ? (s[l - 3] << 8) | s[l - 2] : ((s[l - 3] & 3) << 8) | s[l - 2]; };
    function read(e) {
      const parts = [];
      let n = e.start, g = 0;
      while (n && n <= nsec && g++ < nsec + 8) {
        const s = sec(n), l = s.length, cnt = s[l - 1];
        parts.push(s.subarray(0, Math.min(cnt, l - 3)));
        n = nextOf(s);
      }
      let t = 0; for (const p of parts) t += p.length;
      const out = new Uint8Array(t); t = 0; for (const p of parts) { out.set(p, t); t += p.length; }
      return out;
    }
    function dir(start, prefix, out, depth) {
      for (let i = 0; i < 8; i++) {
        const s = sec(start + i);
        for (let o = 0; o + 16 <= Math.min(s.length, 128); o += 16) {
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
    function chain(start) {
      const out = []; let n = start;
      while (n && n <= nsec && out.length <= nsec) { out.push(n); n = nextOf(sec(n)); }
      return out;
    }
    function exactSize(e) { let t = 0; for (const n of chain(e.start)) { const s = sec(n); t += Math.min(s[s.length - 1], s.length - 3); } return t; }
    // Only layouts with a single, DOS 2-style bitmap model are written (MyDOS multi-VTOC for 256-byte sectors, or 90K single density).
    // Atari DOS 2.5 enhanced density: 1040 x 128 B. Sectors 0..719 live in the VTOC at 360; sectors 720..1023 in the second VTOC at
    // sector 1024 (whose bytes 0..83 also mirror 48..719 and bytes 122..123 count the free sectors above 719).
    const ed = ss === 128 && nsec === 1040 && sec(360)[0] === 2;
    const writable = ((ss === 256 || nsec === 720) && nsec <= 65535 && nsec >= 720) || ed;
    const nvtoc = 1 + Math.floor((nsec + 80) / (ss * 8));
    const bitLoc = (s) => {
      if (ed) {
        if (s >= 1024 || s === 0) return [new Uint8Array(1), 0, 0];
        if (s >= 720) return [sec(1024), (s - 48) >> 3, 0x80 >> ((s - 48) & 7)];
        return [sec(360), 10 + (s >> 3), 0x80 >> (s & 7)];
      }
      const bi = (s >> 3) + 10; return [sec(360 - Math.floor(bi / ss)), bi % ss, 0x80 >> (s & 7)];
    };
    const isFree = (s) => { const [d, i, m] = bitLoc(s); return !!(d[i] & m); };
    const mark = (s, free) => {
      const [d, i, m] = bitLoc(s);
      if (free) d[i] |= m; else d[i] &= ~m;
      if (ed && s >= 48 && s < 720) { const v = sec(1024), j = (s - 48) >> 3, mm = 0x80 >> ((s - 48) & 7); if (free) v[j] |= mm; else v[j] &= ~mm; }
    };
    const setFree = (d, s) => {
      if (ed && s >= 720) { const v = sec(1024), f = rd16(v, 122) + d; v[122] = f & 255; v[123] = (f >> 8) & 255; return; }
      const t = sec(360), f = rd16(t, 3) + d; t[3] = f & 255; t[4] = (f >> 8) & 255;
    };
    const freeSectors = () => rd16(sec(360), 3) + (ed ? rd16(sec(1024), 122) : 0);
    let cursor = 369;
    function alloc() {
      for (let k = 0; k < nsec; k++) {
        const s = ((cursor - 1 + k) % nsec) + 1;
        if (isFree(s)) { mark(s, false); setFree(-1, s); cursor = s + 1; return s; }
      }
      throw new Error('disk full');
    }
    function allocRun(n) {
      for (let s = 369; s + n - 1 <= nsec; s++) {
        let ok = true;
        for (let k = 0; k < n; k++) if (!isFree(s + k)) { ok = false; s += k; break; }
        if (ok) { for (let k = 0; k < n; k++) { mark(s + k, false); setFree(-1, s + k); } return s; }
      }
      throw new Error('disk full (no contiguous space for a directory)');
    }
    function release(n) { if (!isFree(n)) { mark(n, true); setFree(1, n); } }
    const pack = (name) => {
      const up = name.toUpperCase(), dot = up.lastIndexOf('.');
      const c = (x, k) => x.replace(/[^A-Z0-9_]/g, '_').slice(0, k).padEnd(k, ' ');
      return (dot > 0 ? c(up.slice(0, dot), 8) + c(up.slice(dot + 1), 3) : c(up, 8) + '   ');
    };
    function slots(start, cb) {
      for (let i = 0; i < 8; i++) {
        const s = sec(start + i);
        for (let k = 0; k < 8; k++) { const r = cb(s, k * 16, i * 8 + k); if (r !== undefined) return r; }
      }
    }
    function lookup(start, packed, wantDir) {
      return slots(start, (s, o, idx) => {
        const f = s[o];
        if (f === 0) return null;
        if (f & 0x80) return;
        if (!!(f & 0x10) !== wantDir) return;
        for (let k = 0; k < 11; k++) if (s[o + 5 + k] !== packed.charCodeAt(k)) return;
        return { s, o, idx };
      }) || null;
    }
    function freeSlot(start) {
      const r = slots(start, (s, o, idx) => ((s[o] === 0 || (s[o] & 0x80)) ? { s, o, idx } : undefined));
      if (!r) throw new Error('directory full (64 entries)');
      return r;
    }
    function setEntry(slot, flag, count, first, packed) {
      const { s, o } = slot;
      s[o] = flag; s[o + 1] = count & 255; s[o + 2] = count >> 8; s[o + 3] = first & 255; s[o + 4] = first >> 8;
      for (let k = 0; k < 11; k++) s[o + 5 + k] = packed.charCodeAt(k);
    }
    function findDir(parts, create) {
      let cur = 361;
      for (const part of parts) {
        const p = pack(part), e = lookup(cur, p, true);
        if (e) { cur = rd16(e.s, e.o + 3); continue; }
        if (!create) return null;
        if (kind !== 'mydos') throw new Error('subdirectories need a MyDOS volume');
        const slot = freeSlot(cur), first = allocRun(8);
        for (let k = 0; k < 8; k++) sec(first + k).fill(0);
        setEntry(slot, 0x10, 8, first, p);
        cur = first;
      }
      return cur;
    }
    function splitPath(path) { const parts = path.split('/').filter(Boolean); return [parts.slice(0, -1), parts[parts.length - 1]]; }
    function freeChain(first) { for (const n of chain(first)) release(n); }
    function writeFile(path, data, overwrite = true) {
      if (!writable) throw new Error('this disk geometry is read-only here');
      const [dirParts, name] = splitPath(path), packed = pack(name), dir = findDir(dirParts, true);
      const old = lookup(dir, packed, false);
      if (old) { if (!overwrite) throw new Error('file exists: ' + path); freeChain(rd16(old.s, old.o + 3)); old.s[old.o] = 0x80; }
      const per = ss - 3, need = Math.max(1, Math.ceil(data.length / per));
      if (need > freeSectors()) throw new Error('disk full');
      const slot = freeSlot(dir), ns = [];
      for (let k = 0; k < need; k++) ns.push(alloc());
      for (let k = 0; k < need; k++) {
        const s = sec(ns[k]), part = data.subarray(k * per, Math.min(data.length, (k + 1) * per)), nx = k + 1 < need ? ns[k + 1] : 0;
        s.fill(0); s.set(part);
        s[ss - 3] = use16 ? nx >> 8 : ((slot.idx << 2) | (nx >> 8)); s[ss - 2] = nx & 255; s[ss - 1] = part.length;
      }
      setEntry(slot, use16 ? 0x46 : 0x42, need, ns[0], packed);
    }
    function remove(path) {
      const [dirParts, name] = splitPath(path), dir = findDir(dirParts, false);
      if (dir == null) throw new Error('no such path: ' + path);
      const packed = pack(name), f = lookup(dir, packed, false), d = f ? null : lookup(dir, packed, true);
      if (f) { freeChain(rd16(f.s, f.o + 3)); f.s[f.o] = 0x80; return; }
      if (!d) throw new Error('no such file: ' + path);
      const first = rd16(d.s, d.o + 3);
      if (slots(first, (s, o) => (s[o] !== 0 && !(s[o] & 0x80) ? true : undefined))) throw new Error('directory not empty: ' + path);
      for (let k = 0; k < 8; k++) release(first + k);
      d.s[d.o] = 0x80;
    }
    function rename(path, newName) {
      const [dirParts, name] = splitPath(path), dir = findDir(dirParts, false);
      if (dir == null) throw new Error('no such path: ' + path);
      const packed = pack(name), np = pack(newName);
      const e = lookup(dir, packed, false) || lookup(dir, packed, true);
      if (!e) throw new Error('not found: ' + path);
      if (np !== packed && (lookup(dir, np, false) || lookup(dir, np, true))) throw new Error('already exists: ' + newName);
      for (let k = 0; k < 11; k++) e.s[e.o + 5 + k] = np.charCodeAt(k);
    }
    return {
      kind, label: '', sectorSize: ss, sectors: nsec, layoutUniform: L.uniform, rename,
      list: () => { const out = []; dir(361, '', out, 0); for (const e of out) if (!e.dir) { try { e.size = exactSize(e); e.approxSize = false; } catch (x) { /* keep estimate */ } } return out; },
      read, readOnly: !writable, writeFile, remove, mkdir: (p) => { if (!writable) throw new Error('read-only geometry'); findDir(p.split('/').filter(Boolean), true); }, freeSectors,
    };
  }

  // Guards against copy-protected disks whose sector 361 holds text/junk: every used 16-byte entry must have a sane flag, start sector and name.
  function dirSane(L) {
    for (let s = 361; s <= 368 && s <= L.nsec; s++) {
      const d = L.sec(s);
      for (let o = 0; o + 16 <= d.length; o += 16) {
        const fl = d[o];
        if (fl === 0) { if (s === 361 && o === 0) continue; break; }
        if (fl & 0x80) continue;
        const start = d[o + 3] | (d[o + 4] << 8);
        if (start < 1 || start > L.nsec) return false;
        for (let k = 5; k < 16; k++) if (d[o + k] < 0x20 || d[o + k] > 0x7e) return false;
      }
    }
    return true;
  }

  function open(bytes) {
    const L = layout(bytes);
    if (L.nsec < 4) return null;
    try {
      if (looksSdfs(L)) return sdfsVol(bytes, L);
      if (L.nsec >= 369) {
        const v = L.sec(360)[0], f0 = L.sec(361)[0];
        if (v <= 3 && dirSane(L) && (f0 === 0 || (f0 & 0x40) || (f0 & 0x10)) && !((f0 & 0x20) && !(f0 & 0x40)) && (f0 & 0x80) === 0) {
          const nv = 1 + Math.floor((L.nsec + 80) / (L.ss * 8));
          const myTotal = rd16(L.sec(360), 1) === L.nsec - 11 - nv;
          return dosVol(bytes, L, (v === 2 || v === 0) && !myTotal && !(f0 & 0x10) ? 'dos2' : 'mydos');
        }
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

  // Empty Atari DOS 2.x volume: 90K single density (DOS 2.0S layout) or 130K enhanced density (DOS 2.5 layout with the
  // second VTOC at sector 1024). 128-byte sectors. Not bootable: add the DOS files, or boot another disk.
  function createDos2(o) {
    const nsec = o.sectors || 720;
    if ((o.sectorSize || 128) !== 128 || (nsec !== 720 && nsec !== 1040)) throw new Error('Atari DOS 2.x volumes here are 128-byte sectors, 720 or 1040 sectors');
    const img = makeAtr(128, nsec), L = layout(img), t = L.sec(360);
    const used = new Set([0, 1, 2, 3, 360, 361, 362, 363, 364, 365, 366, 367, 368, 720]);
    const free = (s) => !used.has(s);
    const part1 = []; for (let s = 0; s < 720; s++) if (free(s)) part1.push(s);
    t[0] = 2;
    const total = part1.length + (nsec === 1040 ? 303 : 0);
    t[1] = total & 255; t[2] = total >> 8;
    t[3] = part1.length & 255; t[4] = part1.length >> 8;
    for (let s = 0; s < 720; s++) if (free(s)) t[10 + (s >> 3)] |= 0x80 >> (s & 7);
    if (nsec === 1040) {
      const v = L.sec(1024);
      for (let s = 48; s < 1024; s++) if (free(s)) v[(s - 48) >> 3] |= 0x80 >> ((s - 48) & 7);
      v[122] = 303 & 255; v[123] = 303 >> 8;
    }
    const b1 = L.sec(1); b1[1] = 3; b1[3] = 7;
    return img;
  }

  // Empty MyDOS volume (256-byte sectors up to 65535, or 90K single density). Not bootable: add the DOS files or boot another disk.
  function createMyDos(o) {
    const ss = o.sectorSize || 256, nsec = o.sectors || 65535;
    if (ss !== 256 && !(ss === 128 && nsec === 720)) throw new Error('MyDOS volumes here use 256-byte sectors (or 90K single density)');
    if (nsec > 65535 || nsec < 720) throw new Error('sector count must be 720..65535');
    const img = makeAtr(ss, nsec), L = layout(img), nv = 1 + Math.floor((nsec + 80) / (ss * 8));
    const t = L.sec(360);
    t[0] = ss === 256 && nsec >= 1024 ? 2 + nv : 2;
    const total = nsec - 11 - nv;
    t[1] = total & 255; t[2] = total >> 8; t[3] = total & 255; t[4] = total >> 8;
    const bit = (s) => { const bi = (s >> 3) + 10; return [L.sec(360 - Math.floor(bi / ss)), bi % ss, 0x80 >> (s & 7)]; };
    for (let s = 1; s <= nsec; s++) { const [d, i, m] = bit(s); d[i] |= m; }
    const used = [1, 2, 3, 361, 362, 363, 364, 365, 366, 367, 368];
    for (let k = 0; k < nv; k++) used.push(360 - k);
    for (const s of used) { const [d, i, m] = bit(s); d[i] &= ~m; }
    const b1 = L.sec(1); b1[1] = 3; b1[3] = 7;
    return img;
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

  // Host name -> unique upper-case 8.3 name within `used` (a Set of upper-case names in that directory).
  function to83(name, used, isDir) {
    const i = isDir ? -1 : name.lastIndexOf('.');
    const c = (s, k) => s.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, k);
    const ext = i > 0 ? c(name.slice(i + 1), 3) : '', base = c(i > 0 ? name.slice(0, i) : name, 8) || '_';
    let out = base + (ext ? '.' + ext : ''), k = 1;
    while (used && used.has(out)) { const suf = '_' + k++; out = base.slice(0, 8 - suf.length) + suf + (ext ? '.' + ext : ''); }
    if (used) used.add(out);
    return out;
  }

  // Build an SDFS image holding `files` ([{path:'dir/file.ext', data}]) plus `freeBytes` of spare room.
  // Returns {image, entries:[{host, sdfs}]} where entries map each host path to the 8.3 path used on the disk.
  function buildSdfs(files, o) {
    o = o || {};
    const ss = o.sectorSize || 256, perMap = (ss - 4) >> 1, used = new Map(), entries = [], dirsSeen = new Map();
    const nameFor = (dirKey, hostName, isDir) => { if (!used.has(dirKey)) used.set(dirKey, new Set()); return to83(hostName, used.get(dirKey), isDir); };
    const dirMap = new Map(); // host dir path -> sdfs dir path
    const sdfsDir = (hostDir) => {
      if (!hostDir) return '';
      if (dirMap.has(hostDir)) return dirMap.get(hostDir);
      const k = hostDir.lastIndexOf('/'), parent = sdfsDir(k < 0 ? '' : hostDir.slice(0, k));
      const p = (parent ? parent + '/' : '') + nameFor(parent, hostDir.slice(k + 1), true);
      dirMap.set(hostDir, p); dirsSeen.set(p, 0);
      return p;
    };
    let need = 0;
    for (const f of files) {
      const k = f.path.lastIndexOf('/'), d = sdfsDir(k < 0 ? '' : f.path.slice(0, k));
      const sd = (d ? d + '/' : '') + nameFor(d, f.path.slice(k + 1), false);
      entries.push({ host: f.path, sdfs: sd, data: f.data });
      const ds = Math.ceil(f.data.length / ss);
      need += ds + Math.max(1, Math.ceil(ds / perMap));
      dirsSeen.set(d, (dirsSeen.get(d) || 0) + 1);
    }
    need += 3 * dirsSeen.size + Math.ceil(((files.length + dirsSeen.size) * 23) / ss);
    need += Math.ceil((o.freeBytes || 0) / ss) + 64;
    let nsec = Math.min(65535, Math.max(o.minSectors || 1440, Math.ceil(need * 1.02) + 64));
    for (;;) {
      const img = createSdfs({ sectorSize: ss, sectors: nsec, label: o.label || 'FOLDER' }), v = open(img);
      try {
        for (const e of entries) v.writeFile(e.sdfs, e.data);
        return { image: img, entries: entries.map((e) => ({ host: e.host, sdfs: e.sdfs })), free: v.freeSectors() };
      } catch (err) {
        if (!/full|space/i.test(err.message) || nsec >= 65535) throw new Error(nsec >= 65535 ? 'folder does not fit in a 16 MB SDFS image (' + err.message + ')' : err.message);
        nsec = Math.min(65535, Math.ceil(nsec * 1.1) + 64);
      }
    }
  }

  const api = { open, createSdfs, createMyDos, createDos2, buildSdfs, to83, makeAtr, layout };
  if (typeof AC !== 'undefined') AC.DosFs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
