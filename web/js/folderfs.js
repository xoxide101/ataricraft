// WebAFM folder drive: a folder on the PC used like a disk. The whole tree is mirrored in memory under 8.3 short names (the same
// vol interface as dosfs.js, so afmcore.js works on it unchanged); the real Windows long names live in `real`, and LONGNAME.TXT
// (short | long | date | size | source) is the bridge. Changes are written back to the folder by flush().
(function () {
  const SIDE = 'LONGNAME.TXT';
  const NAME83 = /^[A-Z0-9_]{1,8}(\.[A-Z0-9_]{1,3})?$/;
  const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
  const BLOCK = 4096, FREE = 2000000, MAXBYTES = 1.5e9;
  const pad2 = (n) => String(n).padStart(2, '0');
  const stamp = (t) => { const d = new Date(t || Date.now()); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const core = () => AC.AfmCore;

  // A Windows file name from any long name: no reserved characters, no trailing dot/space, not a device name.
  function sanitize(n) {
    n = String(n).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
    if (!n) n = '_';
    if (RESERVED.test(n)) n = '_' + n;
    return n.slice(0, 255);
  }
  // LONGNAME.TXT is kept with the Atari EOL byte (0x9B) in memory and with CRLF on the PC so Notepad can read it.
  function toPc(b) {
    let n = 0;
    for (const x of b) n += x === 0x9b ? 2 : 1;
    const o = new Uint8Array(n);
    let i = 0;
    for (const x of b) { if (x === 0x9b) { o[i++] = 13; o[i++] = 10; } else o[i++] = x; }
    return o;
  }
  function fromPc(b) {
    const o = [];
    for (let i = 0; i < b.length; i++) {
      if (b[i] === 13) { if (b[i + 1] === 10) i++; o.push(0x9b); } else if (b[i] === 10) o.push(0x9b); else o.push(b[i]);
    }
    return Uint8Array.from(o);
  }
  const mkNode = (name, dir, parent) => ({ name, real: name, dir, parent, kids: dir ? new Map() : null, data: dir ? null : new Uint8Array(0), dirty: false, onDisk: null, gone: [], date: stamp(), mtime: Date.now() });

  function shorts(items, side) {
    const used = new Set(), pair = new Map(), D = AC.DosFs;
    for (const e of side.values()) pair.set(e.long, e.short);
    for (const it of items) if (!it.dir && it.real.toUpperCase() === SIDE) { it.short = SIDE; used.add(SIDE); }
    for (const it of items) { const s = !it.short && pair.get(it.real); if (s && NAME83.test(s) && !used.has(s)) { it.short = s; used.add(s); } }
    for (const it of items) {
      const u = it.real.toUpperCase();
      if (!it.short && NAME83.test(u) && !(it.dir && u.includes('.')) && !used.has(u)) { it.short = u; used.add(u); }
    }
    for (const it of items) if (!it.short) it.short = D.to83(it.real, used, it.dir);
  }

  async function load(handle, onProgress) {
    const root = mkNode('', true, null);
    root.onDisk = '';
    const st = { files: 0, bytes: 0, skipped: [] };
    async function scan(node, dh) {
      const items = [];
      for await (const [n, h] of dh.entries()) items.push({ real: n, h, dir: h.kind === 'directory' });
      items.sort((a, b) => (a.real < b.real ? -1 : 1));
      for (const it of items) {
        if (it.dir) continue;
        try {
          const f = await it.h.getFile();
          if ((st.bytes += f.size) > MAXBYTES) throw new Error('This folder is too large to load into memory (over 1.5 GB). Pick a smaller folder.');
          it.data = new Uint8Array(await f.arrayBuffer()); it.mtime = f.lastModified;
          st.files++;
          if (onProgress) onProgress(st);
        } catch (e) { if (/too large/.test(e.message)) throw e; it.bad = true; st.skipped.push(it.real + ': ' + e.message); }
      }
      const sc = items.find((x) => !x.dir && !x.bad && x.real.toUpperCase() === SIDE);
      const side = sc ? core().parseLongNames(core().sidecarText(fromPc(sc.data))) : new Map();
      const live = items.filter((x) => !x.bad);
      shorts(live, side);
      for (const it of live) {
        const k = mkNode(it.short, it.dir, node);
        k.real = it.real; k.onDisk = it.real;
        if (!it.dir) { k.data = it.short === SIDE ? fromPc(it.data) : it.data; k.mtime = it.mtime; k.date = stamp(it.mtime); }
        node.kids.set(it.short, k);
        if (it.dir) await scan(k, it.h);
      }
    }
    await scan(root, handle);
    return make(handle, root, st.skipped);
  }

  function make(handle, root, skipped) {
    const find = (path) => {
      let n = root;
      if (!path) return n;
      for (const p of path.split('/')) { n = n.kids && n.kids.get(p.toUpperCase()); if (!n) return null; }
      return n;
    };
    const split = (path) => { const i = path.lastIndexOf('/'); return [i < 0 ? '' : path.slice(0, i), path.slice(i + 1)]; };
    const each = (n, f) => { for (const k of n.kids.values()) { f(k); if (k.dir) each(k, f); } };
    const markTree = (n) => { n.gone = []; for (const k of n.kids.values()) { k.onDisk = null; k.dirty = !k.dir; if (k.dir) markTree(k); } };
    const uniqueReal = (dir, kid, want) => {
      const taken = new Set([...dir.kids.values()].filter((x) => x !== kid).map((x) => x.real.toLowerCase()));
      if (!taken.has(want.toLowerCase())) return want;
      const i = kid.dir ? -1 : want.lastIndexOf('.'), b = i > 0 ? want.slice(0, i) : want, e = i > 0 ? want.slice(i) : '';
      for (let k = 2; ; k++) { const w = `${b} (${k})${e}`; if (!taken.has(w.toLowerCase())) return w; }
    };
    const setReal = (kid, real) => {
      if (kid.real === real) return;
      if (kid.onDisk) kid.parent.gone.push({ name: kid.onDisk, dir: kid.dir });
      kid.onDisk = null; kid.real = real; kid.dirty = true;
      if (kid.dir) markTree(kid);
    };
    // A LONGNAME.TXT was written: any entry whose long name differs from the file's current Windows name renames the file on the PC.
    const reconcile = (dir) => {
      const sc = dir.kids.get(SIDE); if (!sc) return;
      const side = core().parseLongNames(core().sidecarText(sc.data));
      for (const kid of dir.kids.values()) {
        if (kid.name === SIDE) continue;
        const e = side.get(kid.name.toUpperCase());
        if (!e || !e.long || e.long === kid.real || e.long.toUpperCase() === kid.name.toUpperCase()) continue;
        setReal(kid, uniqueReal(dir, kid, sanitize(e.long)));
      }
    };
    const needs = (n) => n.gone.length > 0 || [...n.kids.values()].some((k) => k.dirty || (k.dir && (!k.onDisk || needs(k))));
    async function rm(dh, g) { try { await dh.removeEntry(g.name, { recursive: true }); } catch (e) { if (e.name !== 'NotFoundError') throw e; } }
    async function flushDir(n, dh, prog) {
      const live = new Set([...n.kids.values()].map((k) => k.real.toLowerCase()));
      for (const g of n.gone) if (live.has(g.name.toLowerCase())) await rm(dh, g);
      for (const k of n.kids.values()) {
        if (k.dir) {
          if (k.onDisk && !needs(k)) continue;
          const sub = await dh.getDirectoryHandle(k.real, { create: true });
          k.onDisk = k.real; k.dirty = false;
          await flushDir(k, sub, prog);
        } else if (k.dirty) {
          const fh = await dh.getFileHandle(k.real, { create: true }), w = await fh.createWritable();
          await w.write(k.name === SIDE ? toPc(k.data) : k.data); await w.close();
          k.onDisk = k.real; k.dirty = false;
          if (prog) prog(k.real);
        }
      }
      for (const g of n.gone) if (!live.has(g.name.toLowerCase())) await rm(dh, g);
      n.gone = [];
    }

    const vol = {
      kind: 'folder', sectorSize: BLOCK + 3, readOnly: false, label: '', handle, root, skipped: skipped || [],
      get sectors() { let u = 0; each(root, (k) => { if (!k.dir) u += Math.ceil(k.data.length / BLOCK) || 1; }); return u + FREE; },
      freeSectors: () => FREE,
      list() {
        const out = [];
        const walk = (n, pre) => { for (const k of n.kids.values()) { out.push({ path: pre + k.name, name: k.name, dir: k.dir, size: k.dir ? 0 : k.data.length, date: k.date, node: k }); if (k.dir) walk(k, pre + k.name + '/'); } };
        walk(root, '');
        return out;
      },
      read: (e) => e.node.data,
      writeFile(path, bytes, overwrite) {
        const [dp, base] = split(path), d = find(dp);
        if (!d || !d.dir) throw new Error('no such folder: ' + dp);
        const ex = d.kids.get(base.toUpperCase());
        if (ex && ex.dir) throw new Error(base + ' is a folder');
        if (ex && !overwrite) throw new Error('already exists: ' + base);
        let n = ex;
        if (!n) { n = mkNode(base, false, d); d.kids.set(base.toUpperCase(), n); n.real = sanitize(base); }
        n.data = new Uint8Array(bytes); n.dirty = true; n.mtime = Date.now(); n.date = stamp();
        if (n.name.toUpperCase() === SIDE) reconcile(d);
      },
      mkdir(path) {
        const [dp, base] = split(path), d = find(dp);
        if (!d || !d.dir) throw new Error('no such folder: ' + dp);
        if (d.kids.has(base.toUpperCase())) throw new Error('already exists: ' + base);
        const n = mkNode(base, true, d); n.real = sanitize(base); d.kids.set(base.toUpperCase(), n);
      },
      rename(path, short) {
        const n = find(path); if (!n) throw new Error('not found: ' + path);
        const p = n.parent, key = short.toUpperCase(), ex = p.kids.get(key);
        if (ex && ex !== n) throw new Error('already exists: ' + short);
        p.kids.delete(n.name.toUpperCase()); n.name = short; p.kids.set(key, n);
        setReal(n, uniqueReal(p, n, sanitize(short)));
      },
      remove(path) {
        const n = find(path); if (!n || n === root) throw new Error('not found: ' + path);
        if (n.dir && n.kids.size) throw new Error('folder not empty');
        n.parent.kids.delete(n.name.toUpperCase());
        if (n.onDisk) n.parent.gone.push({ name: n.onDisk, dir: n.dir });
      },
      // Make LONGNAME.TXT mirror the real Windows names. Folders whose names are all plain upper-case 8.3 are left alone unless force.
      primeNames(force) {
        const C = core(); let changed = 0;
        const dirs = [root]; each(root, (k) => { if (k.dir) dirs.push(k); });
        for (const d of dirs) {
          const sc = d.kids.get(SIDE), kids = [...d.kids.values()].filter((k) => k.name !== SIDE);
          const odd = kids.some((k) => k.real !== k.name);
          if (!sc && !(force && kids.length) && !odd) continue;
          const old = sc ? C.parseLongNames(C.sidecarText(sc.data)) : new Map(), map = new Map();
          for (const k of kids) {
            const o = old.get(k.name.toUpperCase()), size = k.dir ? 0 : k.data.length;
            map.set(k.name.toUpperCase(), { short: k.name.toUpperCase(), long: k.real, added: o && o.size === size && o.added ? o.added : k.date, size, source: (o && o.source) || 'DISK' });
          }
          const bytes = map.size ? C.formatLongNames(map) : null;
          if (!bytes) { if (sc) { d.kids.delete(SIDE); if (sc.onDisk) d.gone.push({ name: sc.onDisk, dir: false }); changed++; } continue; }
          if (sc && sc.data.length === bytes.length && sc.data.every((x, i) => x === bytes[i])) continue;
          vol.writeFile((d === root ? '' : pathOf(d) + '/') + SIDE, bytes, true); changed++;
        }
        return changed;
      },
      get dirty() { return needs(root); },
      async flush(prog) {
        if (handle.queryPermission && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('permission to write the folder was denied');
        await flushDir(root, handle, prog);
      },
    };
    const pathOf = (n) => { const a = []; for (; n && n.parent; n = n.parent) a.unshift(n.name); return a.join('/'); };
    return vol;
  }

  const api = { load, sanitize, SIDE };
  if (typeof AC !== 'undefined') AC.FolderFs = api;
})();
