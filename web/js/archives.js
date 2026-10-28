// archives.js - one front door for every archive/container format Ataricraft can open.
//
// HOW THE FORMAT LAYERS FIT TOGETHER (read this before adding a format)
//   Layer 1  Disk-image containers   diskconv.js   ATR, XFD, DCM, PRO  <->  ATR bytes (a disk image, not a file list)
//   Layer 2  Disk filesystems        dosfs.js      DOS 2.x / MyDOS / SpartaDOS inside an ATR (files + directories)
//   Layer 3  File archives           THIS FILE     ARC/ARK, ZIP (PKZIP), 7z, RAR, LZH/LHA, ARJ, GZ ... (a list of files)
//   A DCM/PRO is Layer 1 (it holds a whole disk), so it is NOT registered here; afmcore.mount() converts it. An archive
//   found *inside* a disk (e.g. GAME.ARC on an ATR) is read through Layer 2 first, then expanded here.
//
// ADDING A FORMAT
//   AC.Archives.register({
//     id:      'lbr',                      // unique short id
//     name:    'CP/M library',             // shown to the user
//     exts:    ['lbr'],                    // lower-case extensions, used only as a hint
//     sniff:   (head, name) => boolean,    // head = first 64 bytes (Uint8Array). Content wins over extension.
//     list:    async (file) => [{ name, size, ...anything the extractor needs }],   // files only, '/' separators
//     extract: async (file, entry) => Uint8Array | ArrayBuffer,
//   });
//   Formats are tried in registration order and the first whose sniff() is true wins, so register specific formats
//   before general ones. The 7-Zip WASM fallback is registered last and claims by extension only.
//
// BUILT-IN FORMATS
//   arc  SEA ARC and ARK (same 0x1A-marked layout). Methods 1-4, 8 (stored, packed, squeezed, crunched). Pure JS (arc.js),
//        mirrors the 6502 ARC.COM. Methods 5-7 (old hashed crunch) and 9 (squashed) are reported as unsupported.
//   zip  PKZIP. Stored/Deflate/zstd go through zip.js (fast, browser-native). Every other PKZIP method -
//        Shrink, Reduce, Implode, Deflate64, BZip2, LZMA, PPMd, AES - and ZIP64 are handed to 7-Zip per entry.
//   7z   7-Zip WASM (web/js/7z, LGPL + unRAR licence): 7z, RAR/RAR5, LZH/LHA, ARJ, CAB, GZ, BZ2, XZ, TAR, ZOO and more.
//
// NOT SUPPORTED YET (ideas for later): SpartaDOS X .SDX archives, CP/M .LBR/.SQ/.CRU (squeeze/crunch), Atari
//   "Archiver/Editor" files, ARC methods 5-7/9, writing archives (only ZIP can be created, via the host zip builder).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else { root.AC = root.AC || {}; root.AC.Archives = factory(root); }
})(typeof self !== 'undefined' ? self : this, function (root) {
  // Readers (AC.Arc, AC.Zip, AC.SevenZip) are looked up at call time so script load order does not matter.
  const AC = new Proxy({}, { get: (_, k) => (globalThis.AC || {})[k] });
  const formats = [];
  const extOf = (n) => ((String(n || '').match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
  const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);

  function register(f) {
    if (!f || !f.id || typeof f.sniff !== 'function' || !f.list || !f.extract) throw new Error('archive format needs id, sniff, list, extract');
    const i = formats.findIndex((x) => x.id === f.id);
    if (i >= 0) formats[i] = f; else formats.push(f);
    return f;
  }

  // arc.js reports {year,month,day,hour,minute,second}; other readers may give a Date or nothing.
  const stamp = (m) => (m instanceof Date ? m.getTime() : m && m.year ? new Date(m.year, (m.month || 1) - 1, m.day || 1, m.hour || 0, m.minute || 0, m.second || 0).getTime() : Date.now());
  const readBytes = async (file) => new Uint8Array(await file.arrayBuffer());

  // ---- ARC / ARK ----
  register({
    id: 'arc', name: 'SEA ARC / ARK', exts: ['arc', 'ark'],
    sniff: (h) => h.length > 2 && h[0] === 0x1a && h[1] >= 1 && h[1] <= 9,
    async list(file) {
      const b = await readBytes(file);
      return AC.Arc.list(b).map((e) => ({ name: e.name, size: e.size, modified: e.modified, method: e.methodName, _e: e }));
    },
    async extract(file, ent) { return AC.Arc.extract(await readBytes(file), ent._e); },
  });

  // ---- ZIP / PKZIP ----
  const ZIP_NATIVE = new Set([0, 8, 93]);
  register({
    id: 'zip', name: 'ZIP (PKZIP)', exts: ['zip'],
    sniff: (h) => h.length > 3 && h[0] === 0x50 && h[1] === 0x4b && (h[2] === 3 || h[2] === 5 || h[2] === 7),
    async list(file) {
      try { return (await AC.Zip.list(file)).map((e) => ({ name: e.name, size: e.size, method: 'zip:' + e.method, _z: e })); }
      catch (e) { // ZIP64 and oddities: let 7-Zip read the directory
        return (await AC.SevenZip.list(file)).map((x) => ({ name: x.name, size: x.size, _7: x }));
      }
    },
    async extract(file, ent) {
      if (ent._z && ZIP_NATIVE.has(ent._z.method)) return AC.Zip.extract(file, ent._z);
      return AC.SevenZip.extract(file, ent._7 || { name: ent.name, size: ent.size });
    },
  });

  // ---- everything else 7-Zip knows (claimed by extension or common magic) ----
  const SZ_EXT = new Set(['7z', 'rar', 'r00', 'lzh', 'lha', 'arj', 'cab', 'gz', 'tgz', 'bz2', 'xz', 'tar', 'zoo', 'lzma', 'z', 'cpio', 'rpm', 'deb', 'iso']);
  const magic = (h, s) => s.every((v, i) => h[i] === v);
  register({
    id: '7z', name: '7-Zip / RAR / LZH / ARJ / other', exts: [...SZ_EXT],
    sniff: (h, name) => magic(h, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) || magic(h, [0x52, 0x61, 0x72, 0x21]) ||
      (h.length > 6 && h[2] === 0x2d && h[3] === 0x6c && (h[4] === 0x68 || h[4] === 0x7a)) || // "-lh?-" LHA header
      (h[0] === 0x60 && h[1] === 0xea) || // ARJ
      magic(h, [0x1f, 0x8b]) || SZ_EXT.has(extOf(name)),
    async list(file) { return (await AC.SevenZip.list(file)).map((x) => ({ name: x.name, size: x.size, _7: x })); },
    async extract(file, ent) { return AC.SevenZip.extract(file, ent._7); },
  });

  // ---- public API ----
  async function detect(file) {
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    return formats.find((f) => { try { return f.sniff(head, file.name); } catch (e) { return false; } }) || null;
  }

  // Quick, name-only check used by UI to decide whether to offer "extract instead of copy".
  function looksLikeArchive(name) {
    const e = extOf(name);
    return formats.some((f) => f.exts.includes(e));
  }

  async function list(file) {
    const f = await detect(file);
    if (!f) throw new Error('not a recognised archive: ' + (file.name || ''));
    const entries = await f.list(file);
    return { format: f, entries };
  }

  async function extract(file, entry, format) {
    const f = format || (await detect(file));
    const d = await f.extract(file, entry);
    return d instanceof Uint8Array ? d : new Uint8Array(d);
  }

  // Lazy file list for UI code: [{ name (base name), path, size, get() -> Promise<File> }]
  async function expand(file) {
    const { format, entries } = await list(file);
    return entries.map((e) => ({
      name: baseOf(e.name), path: e.name, size: e.size, method: e.method,
      get: async () => new File([await extract(file, e, format)], baseOf(e.name), { lastModified: stamp(e.modified) }),
    }));
  }

  return { register, detect, list, extract, expand, looksLikeArchive, formats };
});
