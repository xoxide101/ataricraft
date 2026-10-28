// WebAFM core: size- and volume-aware file operations over Atari disk images (DOS 2.x, MyDOS, SpartaDOS-family).
// No DOM or browser APIs: the web explorer and a later standalone (Electron/Tauri/Node) app share this file.
(function () {
  const DosFs = typeof require !== 'undefined' && typeof module !== 'undefined' ? require('./dosfs.js') : AC.DosFs;
  const SIDECAR = 'LONGNAME.TXT';
  const NAME83 = /^[A-Z0-9_]{1,8}(\.[A-Z0-9_]{1,3})?$/;
  const pad2 = (n) => String(n).padStart(2, '0');
  const stampNow = (d) => { d = d || new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const parentOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
  const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
  const joinP = (a, b) => (a ? a + '/' + b : b);
  const eq = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

  // ---------- volumes ----------
  function mount(bytes, name) {
    const vol = DosFs.open(bytes);
    if (!vol) return null;
    return { vol, bytes, name: name || '', kind: vol.kind, dirty: false };
  }

  const canDirs = (m) => m.kind === 'sdfs' || m.kind === 'mydos';
  const dataPerSector = (m) => (m.kind === 'sdfs' ? m.vol.sectorSize : m.vol.sectorSize - 3);
  const dirLimit = (m) => (m.kind === 'sdfs' ? 1400 : 64);

  // Sectors a file of `size` bytes occupies on this volume (data + map sectors).
  function sectorsFor(m, size) {
    const per = dataPerSector(m), data = Math.max(m.kind === 'sdfs' ? 0 : 1, Math.ceil(size / per));
    if (m.kind !== 'sdfs') return data;
    const ptrs = (m.vol.sectorSize - 4) >> 1;
    return data + Math.max(1, Math.ceil(data / ptrs));
  }
  const dirSectors = (m) => (m.kind === 'sdfs' ? 2 : 8);

  function usage(m) {
    const total = m.vol.sectors, free = m.vol.freeSectors ? m.vol.freeSectors() : 0;
    return { total, free, used: total - free, pct: total ? Math.round(((total - free) / total) * 100) : 0, bytesFree: free * dataPerSector(m), sectorBytes: m.vol.sectorSize };
  }

  // What can be done with this disk, and why not when it can't (drives the dimmed buttons).
  function caps(m) {
    const ro = !!m.vol.readOnly, why = {};
    const roWhy = `read-only here (${m.kind.toUpperCase()}, ${m.vol.sectorSize}-byte sectors${m.vol.sectors > 720 && m.vol.sectorSize === 128 ? ', enhanced density' : ''})`;
    const c = {
      read: { label: 'Read / view / save to PC', ok: true },
      write: { label: 'Write files', ok: !ro, why: roWhy },
      folders: { label: 'Folders', ok: canDirs(m), why: m.kind === 'dos2' ? 'DOS 2 has no folders (copies can be flattened into the root)' : 'this disk type has no folders' },
      mkdir: { label: 'New folder', ok: !ro && canDirs(m), why: ro ? roWhy : 'DOS 2 has no folders' },
      rename: { label: 'Rename', ok: !ro, why: roWhy },
      del: { label: 'Delete', ok: !ro, why: roWhy },
      import: { label: 'Add from PC', ok: !ro, why: roWhy },
      edit: { label: 'Edit and save files', ok: !ro, why: roWhy },
      label: { label: 'Disk label', ok: !ro && m.kind === 'sdfs', why: ro ? roWhy : 'only SpartaDOS volumes have a label' },
      longnames: { label: 'Long names (LONGNAME.TXT)', ok: !ro, why: roWhy },
      tree: { label: 'Folder tree', ok: canDirs(m), why: 'no folders on this disk' },
    };
    c.limit = { label: `Directory limit ${dirLimit(m)} entries`, ok: true };
    return c;
  }

  function info(m) {
    const u = usage(m);
    return { kind: m.kind, label: m.vol.label || '', sectorSize: m.vol.sectorSize, sectors: m.vol.sectors, density: m.vol.sectorSize === 128 ? (m.vol.sectors > 720 ? 'enhanced' : 'single') : (m.vol.sectorSize === 256 ? 'double' : 'quad'), writable: !m.vol.readOnly, folders: canDirs(m), usage: u };
  }

  // ---------- long-name sidecar ----------
  // Line: SHORTNAME.EXT (padded to 12) | long name | date added | size | source
  function parseLongNames(text) {
    const out = new Map();
    for (const line of text.split(/[\r\n\x9b]+/)) {
      const f = line.split('|');
      if (f.length < 2) continue;
      const short = f[0].trim().toUpperCase();
      if (short) out.set(short, { short, long: f[1], added: (f[2] || '').trim(), size: +f[3] || 0, source: (f[4] || '').trim() });
    }
    return out;
  }
  function formatLongNames(map) {
    const lines = [];
    for (const e of [...map.values()].sort((a, b) => (a.short < b.short ? -1 : 1))) lines.push(`${e.short.padEnd(12)}|${e.long}|${e.added || ''}|${e.size || 0}|${e.source || ''}`);
    const s = lines.join('\x9b') + (lines.length ? '\x9b' : '');
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
    return out;
  }
  function readSidecar(m, dir) {
    const e = findEntry(m, joinP(dir, SIDECAR));
    if (!e) return new Map();
    try {
      const b = m.vol.read(e);
      let s = '';
      for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
      return parseLongNames(s);
    } catch (x) { return new Map(); }
  }
  function writeSidecar(m, dir, map) {
    const p = joinP(dir, SIDECAR);
    if (!map.size) { try { m.vol.remove(p); } catch (x) { /* none */ } return; }
    m.vol.writeFile(p, formatLongNames(map), true);
  }

  // ---------- listing ----------
  const cache = new WeakMap();
  function entries(m) {
    let c = cache.get(m);
    if (!c) { c = m.vol.list().map((e) => ({ path: e.path, name: e.name, dir: !!e.dir, size: e.dir ? 0 : e.size, approx: !!e.approxSize, date: e.date || '', raw: e })); cache.set(m, c); }
    return c;
  }
  const touch = (m) => { cache.delete(m); m.dirty = true; };
  const findEntry = (m, path) => { const u = path.toUpperCase(); const e = entries(m).find((x) => x.path.toUpperCase() === u); return e ? e.raw : null; };

  // Entries of one directory (path '' = root), each with long-name details when the sidecar has them.
  function listDir(m, dir) {
    const side = readSidecar(m, dir), out = [];
    for (const e of entries(m)) {
      if (parentOf(e.path) !== dir) continue;
      const l = side.get(e.name.toUpperCase());
      out.push({ ...e, long: l && l.long.toUpperCase() !== e.name.toUpperCase() ? l.long : '', indexed: !!l, added: l ? l.added : '', source: l ? l.source : '', sidecar: e.name.toUpperCase() === SIDECAR, sectors: e.dir ? 0 : sectorsFor(m, e.size) });
    }
    return out.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name < b.name ? -1 : 1));
  }

  // Totals for a file or folder, including everything below it.
  function props(m, path) {
    const e = entries(m).find((x) => x.path === path);
    if (!e) return null;
    if (!e.dir) return { files: 1, dirs: 0, bytes: e.size, sectors: sectorsFor(m, e.size), depth: 0, largest: { path: e.path, size: e.size } };
    const pre = path + '/', r = { files: 0, dirs: 0, bytes: 0, sectors: 0, depth: 0, largest: null, children: [] };
    for (const x of entries(m)) {
      if (!x.path.startsWith(pre)) continue;
      const rel = x.path.slice(pre.length), lvl = rel.split('/').length;
      r.depth = Math.max(r.depth, lvl);
      if (x.dir) { r.dirs++; r.sectors += dirSectors(m); } else if (x.name.toUpperCase() === SIDECAR) {
        r.sectors += sectorsFor(m, x.size); r.indexBytes = (r.indexBytes || 0) + x.size; // counted as space, not as a user file
      } else {
        r.files++; r.bytes += x.size; r.sectors += sectorsFor(m, x.size);
        if (!r.largest || x.size > r.largest.size) r.largest = { path: x.path, size: x.size };
      }
    }
    for (const x of entries(m)) if (parentOf(x.path) === path) { const p = props(m, x.path); r.children.push({ name: x.name, dir: x.dir, files: p.files, dirs: p.dirs, bytes: p.bytes, sectors: p.sectors }); }
    return r;
  }

  // ---------- names ----------
  function validName(m, name, isDir) {
    const up = name.toUpperCase();
    if (!up) return 'empty name';
    if (isDir && up.includes('.')) return 'folder names cannot have an extension';
    if (!NAME83.test(up)) return 'use 1-8 letters/digits/_ and an optional 1-3 character extension';
    return '';
  }
  // Short unique 8.3 name for any host name, and whether a long-name note is needed.
  function shortName(name, used, isDir) {
    const up = name.toUpperCase();
    if (NAME83.test(up) && !(used && used.has(up))) { if (used) used.add(up); return { short: up, long: '' }; }
    return { short: DosFs.to83(name, used, isDir), long: name };
  }
  const existingNames = (m, dir) => new Set(entries(m).filter((e) => parentOf(e.path) === dir).map((e) => e.name.toUpperCase()));

  // ---------- planning ----------
  // items: paths on src. Returns the full job so nothing is written unless it fits.
  // opts: {conflict:'error'|'skip'|'overwrite'|'rename', flatten:false}
  function plan(src, items, dst, dstDir, opts) {
    opts = opts || {};
    const P = { ok: true, errors: [], warnings: [], files: [], dirs: [], conflicts: [], sectors: 0, free: 0, sameVolume: src === dst, longNames: new Map(), items: items.slice() };
    const fail = (s) => { P.ok = false; P.errors.push(s); };
    if (dst.vol.readOnly) { fail(`${dst.kind.toUpperCase()} disk with ${dst.vol.sectorSize}-byte sectors is read-only here`); return P; }
    dstDir = dstDir || '';
    const usedByDir = new Map(), usedFor = (d) => { if (!usedByDir.has(d)) usedByDir.set(d, existingNames(dst, d)); return usedByDir.get(d); };
    const counted = new Map(), slotsLeft = (d) => dirLimit(dst) - existingNames(dst, d).size - (counted.get(d) || 0);
    const bump = (d) => counted.set(d, (counted.get(d) || 0) + 1);
    const srcEntries = entries(src), sideCache = new Map();
    const longOf = (e) => { const d = parentOf(e.path); if (!sideCache.has(d)) sideCache.set(d, readSidecar(src, d)); const l = sideCache.get(d).get(e.name.toUpperCase()); return l ? l.long : ''; };
    const note0 = (dir, short, long, size, from) => { if (opts.index === false || short.toUpperCase() === SIDECAR) return; if (!P.longNames.has(dir)) P.longNames.set(dir, new Map()); P.longNames.get(dir).set(short.toUpperCase(), { short: short.toUpperCase(), long: long || short, added: stampNow(opts.now), size, source: from }); };
    for (const top of items) {
      const te = srcEntries.find((x) => x.path === top);
      if (!te) { fail('not found: ' + top); continue; }
      if (te.dir && !canDirs(dst)) {
        if (!opts.flatten) { fail(`"${te.path}" is a folder but this disk type has no folders (tick "Flatten folders" to copy its files into the root)`); continue; }
        const pre = te.path + '/', top = baseOf(te.path);
        const kids = srcEntries.filter((y) => !y.dir && y.path.startsWith(pre) && y.name.toUpperCase() !== SIDECAR);
        if (!kids.length) { P.warnings.push(`"${te.path}" is empty; nothing to copy`); continue; }
        const used = usedFor('');
        for (const x of kids) {
          const rel = top + x.path.slice(te.path.length), flat = rel.replace(/\//g, '_');
          const s = shortName(flat, used, false), ln = longOf(x) ? top + '_' + longOf(x) : flat;
          if (slotsLeft('') <= 0) { fail(`directory "root" is full (${dirLimit(dst)} entries)`); break; }
          bump('');
          P.files.push({ from: x.path, to: s.short, size: x.size, long: ln });
          note0('', s.short, ln, x.size, (src.name || '') + ':' + x.path);
          P.sectors += sectorsFor(dst, x.size);
        }
        P.warnings.push(`"${te.path}" flattened into the root (${kids.length} file${kids.length > 1 ? 's' : ''}); original paths kept in ${SIDECAR}`);
        continue;
      }
      const topDst = (n) => {
        const s = shortName(n, null, te.dir), used = usedFor(dstDir);
        let sn = s.short, ln = s.long || longOf(te);
        if (used.has(sn.toUpperCase()) && !(te.dir && opts.conflict !== 'rename')) {
          if (opts.conflict === 'rename') { const r = shortName(n.length ? n : sn, used, te.dir); sn = r.short; ln = ln || n; }
          else P.conflicts.push(joinP(dstDir, sn));
        } else used.add(sn.toUpperCase());
        return { short: sn, long: ln };
      };
      const t = topDst(baseOf(te.path));
      if (!canDirs(dst) && dstDir) { fail('this disk type has no folders'); continue; }
      if (slotsLeft(dstDir) <= 0 && !P.conflicts.includes(joinP(dstDir, t.short))) { fail(`directory "${dstDir || 'root'}" is full (${dirLimit(dst)} entries)`); continue; }
      bump(dstDir);
      const dstTop = joinP(dstDir, t.short);
      const note = (dir, short, long, size, from) => { if (opts.index === false || short.toUpperCase() === SIDECAR) return; if (!P.longNames.has(dir)) P.longNames.set(dir, new Map()); P.longNames.get(dir).set(short.toUpperCase(), { short: short.toUpperCase(), long: long || short, added: stampNow(opts.now), size, source: from }); };
      if (!te.dir) {
        P.files.push({ from: te.path, to: dstTop, size: te.size, long: t.long, existed: findEntry(dst, dstTop) });
        note(dstDir, t.short, t.long, te.size, (src.name || '') + ':' + te.path);
        P.sectors += sectorsFor(dst, te.size);
        continue;
      }
      if (!canDirs(dst)) {
        if (!opts.flatten) { fail(`"${te.path}" is a folder but this disk type has no folders (copy its files instead)`); continue; }
      }
      if (src === dst && (dstDir === te.path || dstDir.startsWith(te.path + '/'))) { fail(`cannot copy "${te.path}" into itself`); continue; }
      P.dirs.push({ to: dstTop, long: t.long });
      note(dstDir, t.short, t.long, 0, (src.name || '') + ':' + te.path);
      P.sectors += dirSectors(dst);
      const pre = te.path + '/', dmap = new Map([[te.path, dstTop]]);
      for (const x of srcEntries.filter((y) => y.path.startsWith(pre) && (y.dir || y.name.toUpperCase() !== SIDECAR))) {
        const sp = parentOf(x.path), dp = dmap.get(sp);
        if (dp === undefined) continue;
        const used = usedFor(dp), s = shortName(baseOf(x.path), used, x.dir);
        if (slotsLeft(dp) <= 0) { fail(`directory "${dp}" would be full`); continue; }
        bump(dp);
        const to = joinP(dp, s.short), sl = s.long || longOf(x);
        if (x.dir) { dmap.set(x.path, to); P.dirs.push({ to, long: sl }); P.sectors += dirSectors(dst); }
        else { P.files.push({ from: x.path, to, size: x.size, long: sl }); P.sectors += sectorsFor(dst, x.size); }
        note(dp, s.short, sl, x.size, (src.name || '') + ':' + x.path);
      }
    }
    // sidecar files for folders that received long names
    for (const [d, mp] of P.longNames) {
      const old = readSidecar(dst, d), merged = new Map(old);
      for (const [k, v] of mp) merged.set(k, v);
      P.longNames.set(d, merged);
      const bytes = formatLongNames(merged).length;
      P.sectors += sectorsFor(dst, bytes) - (findEntry(dst, joinP(d, SIDECAR)) ? sectorsFor(dst, formatLongNames(old).length) : 0);
    }
    P.free = dst.vol.freeSectors ? dst.vol.freeSectors() : 0;
    if (P.conflicts.length && opts.conflict !== 'overwrite' && opts.conflict !== 'skip') { P.ok = false; P.errors.push(`${P.conflicts.length} name${P.conflicts.length > 1 ? 's' : ''} already exist: ${P.conflicts.slice(0, 3).join(', ')}${P.conflicts.length > 3 ? '…' : ''}`); }
    if (opts.conflict === 'overwrite') for (const f of P.files) if (f.existed) P.sectors -= Math.min(P.sectors, sectorsFor(dst, entries(dst).find((x) => x.path.toUpperCase() === f.to.toUpperCase()).size));
    if (P.sectors > P.free) fail(`does not fit: needs ${P.sectors} sectors, ${P.free} free on ${dst.name || 'target'} (${dataPerSector(dst)} bytes per sector)`);
    P.after = { free: P.free - P.sectors, total: dst.vol.sectors };
    return P;
  }

  // ---------- execution ----------
  // Writes the plan, reads every file back and compares, and (move) deletes each source only after its copy verified.
  // opts: {move, verify (default true), onProgress(done,total,label), conflict}
  function* run(P, src, dst, opts) {
    opts = opts || {};
    const res = { copied: 0, skipped: 0, failed: [], verified: 0, deleted: 0 };
    if (!P.ok) { res.failed.push({ path: '', error: P.errors.join('; ') }); return res; }
    const total = P.files.length + P.dirs.length;
    let done = 0, doneBytes = 0, fileNo = 0;
    const totalBytes = P.files.reduce((a, f) => a + (f.size || 0), 0);
    const info = (phase, f) => ({ phase, file: fileNo, files: P.files.length, bytes: doneBytes, totalBytes, size: f ? f.size || 0 : 0 });
    const tick = (l, ph, f) => { done++; if (opts.onProgress) opts.onProgress(done, total, l, info(ph || 'done', f)); };
    const step = (l, ph, f) => { if (opts.onProgress) opts.onProgress(done, total, l, info(ph, f)); };
    const okFiles = new Set();
    for (const d of P.dirs) {
      yield;
      try { dst.vol.mkdir(d.to); } catch (e) { res.failed.push({ path: d.to, error: e.message }); }
      tick(d.to, 'folder');
    }
    touch(dst);
    for (const f of P.files) {
      yield;
      if (opts.cancelled && opts.cancelled()) { res.cancelled = true; break; }
      fileNo++;
      try {
        step(f.to, 'write', f);
        if (f.existed && opts.conflict === 'skip') { res.skipped++; doneBytes += f.size || 0; tick(f.to, 'skip', f); continue; }
        const e = findEntry(src, f.from), data = src.vol.read(e);
        dst.vol.writeFile(f.to, data, true);
        res.copied++;
        if (opts.verify !== false) {
          yield; step(f.to, 'verify', f);
          touch(dst);
          const back = dst.vol.read(findEntry(dst, f.to));
          if (!eq(back, data)) { res.failed.push({ path: f.to, error: 'verify failed - source kept' }); doneBytes += f.size || 0; tick(f.to, 'done', f); continue; }
          res.verified++;
        }
        okFiles.add(f.from);
      } catch (e) { res.failed.push({ path: f.to, error: e.message }); }
      doneBytes += f.size || 0;
      tick(f.to, 'done', f);
    }
    touch(dst);
    step('long names', 'index');
    for (const [d, mp] of P.longNames) { try { writeSidecar(dst, d, mp); } catch (e) { res.failed.push({ path: joinP(d, SIDECAR), error: 'long-name file: ' + e.message }); } }
    touch(dst);
    if (opts.move) {
      step('removing sources', 'cleanup');
      for (const p of okFiles) { yield; try { remove(src, p); res.deleted++; } catch (e) { res.failed.push({ path: p, error: 'delete source: ' + e.message }); } }
      if (!res.failed.length && !res.cancelled) removeEmptyDirs(src, dirsUnder(src, P.items || []));
      touch(src);
    }
    return res;
  }
  const execute = (P, src, dst, opts) => { const g = run(P, src, dst, opts); let r; do { r = g.next(); } while (!r.done); return r.value; };
  // Same as execute() but lets the page paint every ~40 ms so the progress strip moves.
  async function executeAsync(P, src, dst, opts) {
    const g = run(P, src, dst, opts); let r, t = Date.now();
    for (;;) {
      r = g.next();
      if (r.done) return r.value;
      if (Date.now() - t > 40) { await new Promise((ok) => setTimeout(ok, 0)); t = Date.now(); }
    }
  }
  // Source folders (deepest first) that can be removed after a move; call after execute() when nothing failed.
  function removeEmptyDirs(src, paths) {
    let n = 0;
    for (const p of [...paths].sort((a, b) => b.length - a.length)) { try { src.vol.remove(p); n++; } catch (e) { /* not empty */ } }
    touch(src);
    return n;
  }
  function dirsUnder(m, tops) {
    const out = [];
    for (const t of tops) { const e = entries(m).find((x) => x.path === t); if (e && e.dir) { out.push(t); for (const x of entries(m)) if (x.dir && x.path.startsWith(t + '/')) out.push(x.path); } }
    return out;
  }

  // ---------- rename / delete / create ----------
  // Names that do not fit 8.3 get a short unique name plus a line in LONGNAME.TXT.
  function rename(m, path, newName) {
    const e = entries(m).find((x) => x.path === path);
    if (!e) throw new Error('not found: ' + path);
    const dir = parentOf(path), used = existingNames(m, dir);
    used.delete(e.name.toUpperCase());
    if (used.has(newName.toUpperCase())) throw new Error('already exists: ' + newName);
    const s = shortName(newName, used, e.dir);
    m.vol.rename(path, s.short);
    const side = readSidecar(m, dir), old = side.get(e.name.toUpperCase());
    if (old) side.delete(e.name.toUpperCase());
    if (s.long) side.set(s.short.toUpperCase(), { short: s.short.toUpperCase(), long: s.long, added: (old && old.added) || stampNow(), size: e.size, source: (old && old.source) || '' });
    else if (old) { /* name now fits; long entry dropped */ }
    if (side.size || old) writeSidecar(m, dir, side);
    touch(m);
    return { short: s.short, long: s.long, path: joinP(dir, s.short) };
  }
  function remove(m, path) {
    const e = entries(m).find((x) => x.path === path);
    if (!e) throw new Error('not found: ' + path);
    if (e.dir) {
      const pre = path + '/', kids = entries(m).filter((x) => x.path.startsWith(pre)).sort((a, b) => b.path.length - a.path.length);
      for (const k of kids) m.vol.remove(k.path);
    }
    m.vol.remove(path);
    const dir = parentOf(path), side = readSidecar(m, dir);
    if (side.delete(e.name.toUpperCase())) writeSidecar(m, dir, side);
    touch(m);
  }
  function mkdir(m, dir, name) {
    if (!canDirs(m)) throw new Error('this disk type has no folders');
    const used = existingNames(m, dir), s = shortName(name, used, true);
    m.vol.mkdir(joinP(dir, s.short));
    if (s.long) { const side = readSidecar(m, dir); side.set(s.short.toUpperCase(), { short: s.short.toUpperCase(), long: s.long, added: stampNow(), size: 0, source: '' }); writeSidecar(m, dir, side); }
    touch(m);
    return joinP(dir, s.short);
  }
  function setLabel(m, label) {
    if (!m.vol.setLabel) throw new Error(m.kind.toUpperCase() + ' disks store no volume label (rename the disk file instead)');
    m.vol.setLabel(label); m.dirty = true; m.vol.label = label.toUpperCase().slice(0, 8);
  }

  // Add a host file (name + bytes) to dir, with the same size/name checks.
  function addHostFile(m, dir, name, data, opts) {
    const side = entries(m).filter((e) => parentOf(e.path) === dir);
    const used = existingNames(m, dir), s = shortName(name, used, false);
    if (side.length >= dirLimit(m)) throw new Error('directory is full');
    const need = sectorsFor(m, data.length);
    if (need > m.vol.freeSectors()) throw new Error(`does not fit: needs ${need} sectors, ${m.vol.freeSectors()} free`);
    m.vol.writeFile(joinP(dir, s.short), data, true);
    if ((s.long || (opts || {}).index !== false) && s.short.toUpperCase() !== SIDECAR) { const sc = readSidecar(m, dir); sc.set(s.short.toUpperCase(), { short: s.short.toUpperCase(), long: s.long || s.short, added: stampNow((opts || {}).now), size: data.length, source: (opts || {}).source || 'PC' }); writeSidecar(m, dir, sc); }
    touch(m);
    return joinP(dir, s.short);
  }

  // Descriptions for well-known system/utility files; anything not listed gets none.
  const KNOWN = {
    'DUP.SYS': 'DOS menu (disk utility package)', 'AUTORUN.SYS': 'Runs automatically at boot', 'MEM.SAV': 'DOS menu memory-save file',
    'AFM.COM': 'Ataricraft File Manager', 'FMTDIR.COM': 'MyDOS directory formatter', 'RAMDISK.AR0': 'MyDOS RAM disk driver (130XE)',
    'COMMAND.COM': 'SpartaDOS command processor', 'DOS.SYS': '',
  };
  function describe(m, name) {
    const n = name.toUpperCase();
    if (n === 'DOS.SYS') return m.kind === 'mydos' ? 'MyDOS system file (boot)' : m.kind === 'dos2' ? 'Atari DOS 2.x system file (boot)' : '';
    return KNOWN[n] || '';
  }

  // Make LONGNAME.TXT list every file/folder on the disk. Missing entries get opts.lookup(name, path) (e.g. the scan title database), then a built-in
  // description of known system files, else the short name; entries whose long name is just the short name are upgraded when something is found;
  // entries for files that no longer exist are dropped.
  function syncLongNames(m, opts) {
    opts = opts || {};
    const res = { added: 0, upgraded: 0, pruned: 0, written: 0, skipped: '' };
    if (m.vol.readOnly) { res.skipped = 'disk is read-only'; return res; }
    const lookup = opts.lookup || (() => '');
    const dirs = [''].concat(entries(m).filter((e) => e.dir).map((e) => e.path));
    for (const d of dirs) {
      const kids = entries(m).filter((e) => parentOf(e.path) === d && e.name.toUpperCase() !== SIDECAR);
      const side = readSidecar(m, d);
      let changed = false;
      const names = new Set(kids.map((e) => e.name.toUpperCase()));
      for (const k of [...side.keys()]) if (!names.has(k)) { side.delete(k); res.pruned++; changed = true; }
      for (const e of kids) {
        const key = e.name.toUpperCase(), cur = side.get(key);
        let found = '', src = 'DB';
        if (!cur || cur.long.toUpperCase() === key) {
          try { found = (lookup(e.name, e.path) || '').trim(); } catch (x) { found = ''; }
          if (!found && !e.dir && d === '' && opts.describe !== false) { found = describe(m, e.name); src = 'INFO'; }
        }
        if (!cur) { side.set(key, { short: key, long: found || e.name, added: stampNow(opts.now), size: e.size, source: found ? src : 'DISK' }); res.added++; changed = true; }
        else if (found && found.toUpperCase() !== key) { cur.long = found; cur.source = cur.source || src; res.upgraded++; changed = true; }
      }
      if (!changed) continue;
      try { writeSidecar(m, d, side); res.written++; touch(m); }
      catch (x) { res.skipped = 'no room for ' + SIDECAR + ' (' + x.message + ')'; break; }
    }
    return res;
  }

  const api = { SIDECAR, mount, info, usage, entries, listDir, props, plan, execute, executeAsync, removeEmptyDirs, dirsUnder, rename, remove, mkdir, setLabel, addHostFile, syncLongNames, validName, shortName, sectorsFor, parseLongNames, formatLongNames, readSidecar, canDirs, caps, refresh: touch };
  if (typeof AC !== 'undefined') AC.AfmCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
