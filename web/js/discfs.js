// discfs.js - read-only readers for FAT12/16/32, ISO 9660 (+Joliet) and UDF disc/disk images. UMD so node tests can require() it.
//
// open(bytes) -> { type, label, list(path), read(path), stat(path) } or null. Paths use "/" ("" or "/" is the root); names are
// matched case-insensitively. list() returns [{name, dir, size}]. FAT images may carry an MBR (first FAT partition is used).
// UDF: 2048 byte sectors, plain partitions only (no virtual/sparing/metadata partitions), embedded/short/long allocation.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.AC = root.AC || {}; root.AC.DiscFs = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const ascii = (b, o, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(b[o + i]); return s; };
  const splitPath = p => String(p || '').split(/[\\/]/).filter(Boolean);

  // Shared tree walker: node.children() -> [{name, dir, size, ...}]
  function makeFs(type, label, rootNode, readNode) {
    function find(path) {
      let n = rootNode;
      for (const part of splitPath(path)) {
        if (!n.dir) return null;
        const u = part.toUpperCase();
        n = n.children().find(c => c.name.toUpperCase() === u);
        if (!n) return null;
      }
      return n;
    }
    return {
      type, label,
      stat(p) { const n = find(p); return n && { name: n.name, dir: !!n.dir, size: n.size }; },
      list(p) {
        const n = find(p);
        if (!n || !n.dir) throw new Error('Not a folder: ' + p);
        return n.children().map(c => ({ name: c.name, dir: !!c.dir, size: c.size }));
      },
      read(p) {
        const n = find(p);
        if (!n || n.dir) throw new Error('No such file: ' + p);
        return readNode(n);
      },
    };
  }

  // ---------------------------------------------------------------- ISO 9660
  function openIso(b) {
    const SS = 2048;
    if (b.length < SS * 17) return null;
    let pvd = -1, joliet = -1;
    for (let s = 16; s < 40 && (s + 1) * SS <= b.length; s++) {
      const o = s * SS;
      if (ascii(b, o + 1, 5) !== 'CD001') break;
      const t = b[o];
      if (t === 1 && pvd < 0) pvd = o;
      else if (t === 2 && b[o + 88] === 0x25 && b[o + 89] === 0x2F && '@CE'.includes(String.fromCharCode(b[o + 90]))) joliet = o;
      else if (t === 255) break;
    }
    if (pvd < 0) return null;
    const vd = joliet >= 0 ? joliet : pvd;
    const wide = joliet >= 0;
    const decode = (o, n) => {
      if (!wide) return ascii(b, o, n);
      let s = '';
      for (let i = 0; i + 1 < n; i += 2) s += String.fromCharCode((b[o + i] << 8) | b[o + i + 1]);
      return s;
    };
    function dirNode(o, name) {
      const lba = u32(b, o + 2), len = u32(b, o + 10), flags = b[o + 25];
      return {
        name, dir: !!(flags & 2), size: len, lba, flags,
        children() {
          const out = [];
          let p = lba * SS;
          const end = p + len;
          while (p < end) {
            const rl = b[p];
            if (!rl) { p = (Math.floor(p / SS) + 1) * SS; continue; }
            const nl = b[p + 32];
            if (!(nl === 1 && (b[p + 33] === 0 || b[p + 33] === 1))) {
              let nm = decode(p + 33, nl);
              nm = nm.replace(/;\d+$/, '');
              if (!wide && nm.endsWith('.')) nm = nm.slice(0, -1);
              out.push(dirNode(p, nm));
            }
            p += rl;
          }
          return out;
        },
      };
    }
    const label = decode(vd + 40, 32).replace(/[\0 ]+$/, '');
    const rootNode = dirNode(vd + 156, '');
    rootNode.dir = true;
    return makeFs(wide ? 'ISO 9660 + Joliet' : 'ISO 9660', label, rootNode,
      n => b.slice(n.lba * SS, n.lba * SS + n.size));
  }

  // ---------------------------------------------------------------- FAT
  function findFatStart(b) {
    const isBpb = o => o + 512 <= b.length && b[o + 510] === 0x55 && b[o + 511] === 0xAA &&
      u16(b, o + 11) >= 512 && (u16(b, o + 11) & (u16(b, o + 11) - 1)) === 0 && b[o + 13] > 0 && b[o + 16] > 0;
    if (isBpb(0) && (b[0] === 0xEB || b[0] === 0xE9)) return 0;
    if (b.length > 512 && b[510] === 0x55 && b[511] === 0xAA) {
      for (let i = 0; i < 4; i++) {
        const e = 446 + i * 16, t = b[e + 4];
        if ([1, 4, 6, 0xB, 0xC, 0xE, 0x14, 0x16, 0x1B, 0x1C, 0x1E].includes(t)) {
          const o = u32(b, e + 8) * 512;
          if (isBpb(o)) return o;
        }
      }
    }
    return isBpb(0) ? 0 : -1;
  }

  function openFat(b) {
    const base = findFatStart(b);
    if (base < 0) return null;
    const bs = u16(b, base + 11), spc = b[base + 13], rsv = u16(b, base + 14), nfat = b[base + 16];
    const rootEnt = u16(b, base + 17);
    const tot = u16(b, base + 19) || u32(b, base + 32);
    const spf = u16(b, base + 22) || u32(b, base + 36);
    const rootSecs = Math.ceil(rootEnt * 32 / bs);
    const dataStart = rsv + nfat * spf + rootSecs;
    const clusters = Math.floor((tot - dataStart) / spc);
    const kind = clusters < 4085 ? 12 : clusters < 65525 ? 16 : 32;
    const fatOff = base + rsv * bs;
    const cb = spc * bs;
    const next = c => {
      if (kind === 32) return u32(b, fatOff + c * 4) & 0x0FFFFFFF;
      if (kind === 16) return u16(b, fatOff + c * 2);
      const v = u16(b, fatOff + c + (c >> 1));
      return (c & 1) ? v >> 4 : v & 0xFFF;
    };
    const eoc = kind === 32 ? 0x0FFFFFF8 : kind === 16 ? 0xFFF8 : 0xFF8;
    function chain(c) {
      const out = [];
      const seen = new Set();
      while (c >= 2 && c < eoc && !seen.has(c) && out.length <= clusters + 2) { seen.add(c); out.push(c); c = next(c); }
      return out;
    }
    const cOff = c => base + (dataStart + (c - 2) * spc) * bs;
    function readChain(c, size) {
      const out = new Uint8Array(chain(c).length * cb);
      let i = 0;
      for (const k of chain(c)) { out.set(b.subarray(cOff(k), cOff(k) + cb), i); i += cb; }
      return size == null ? out : out.slice(0, size);
    }
    function parseDir(raw) {
      const out = [];
      let lfn = [];
      for (let p = 0; p + 32 <= raw.length; p += 32) {
        const f = raw[p];
        if (f === 0) break;
        if (f === 0xE5) { lfn = []; continue; }
        const attr = raw[p + 11];
        if (attr === 0x0F) {
          const seq = f & 0x1F;
          let s = '';
          for (const o of [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30]) {
            const ch = u16(raw, p + o);
            if (ch === 0 || ch === 0xFFFF) break;
            s += String.fromCharCode(ch);
          }
          lfn[seq] = s;
          continue;
        }
        if (attr & 8) { lfn = []; continue; }
        let name = ascii(raw, p, 8).replace(/ +$/, '');
        const ext = ascii(raw, p + 8, 3).replace(/ +$/, '');
        if (raw[p] === 5) name = String.fromCharCode(0xE5) + name.slice(1);
        if (raw[p + 12] & 8) name = name.toLowerCase();
        const short = ext ? name + '.' + ((raw[p + 12] & 16) ? ext.toLowerCase() : ext) : name;
        const long = lfn.length ? lfn.filter(x => x != null).join('') : null;
        lfn = [];
        if (short === '.' || short === '..') continue;
        const cl = u16(raw, p + 26) | (kind === 32 ? u16(raw, p + 20) << 16 : 0);
        out.push({ name: long || short, dir: !!(attr & 0x10), size: u32(raw, p + 28), cl: cl >>> 0 });
      }
      return out;
    }
    function node(e) {
      return {
        ...e,
        children: () => parseDir(readChain(e.cl)).map(node),
      };
    }
    const rootNode = {
      name: '', dir: true, size: 0,
      children: () => (kind === 32
        ? parseDir(readChain(u32(b, base + 44)))
        : parseDir(b.subarray(base + (rsv + nfat * spf) * bs, base + (rsv + nfat * spf + rootSecs) * bs))).map(node),
    };
    const lo = kind === 32 ? 71 : 43;
    const label = ascii(b, base + lo, 11).replace(/ +$/, '');
    return makeFs('FAT' + kind, label === 'NO NAME' ? '' : label, rootNode, n => n.size ? readChain(n.cl, n.size) : new Uint8Array(0));
  }

  // ---------------------------------------------------------------- UDF
  function openUdf(b) {
    const SS = 2048;
    if (b.length < SS * 260) return null;
    const tagId = o => u16(b, o);
    const avdp = 256 * SS;
    if (tagId(avdp) !== 2) return null;
    let vds = u32(b, avdp + 16 + 4), vlen = u32(b, avdp + 16);
    const parts = new Map();
    let lvdMap = null, fsd = null, label = '';
    for (let o = vds * SS, e = o + vlen; o < e; o += SS) {
      const t = tagId(o);
      if (t === 5) parts.set(u16(b, o + 22), u32(b, o + 188));
      else if (t === 6) {
        const nmap = u32(b, o + 268);
        lvdMap = [];
        let q = o + 440;
        for (let i = 0; i < nmap; i++) {
          const mt = b[q], ml = b[q + 1];
          if (mt === 1) lvdMap.push({ type: 1, part: u16(b, q + 4) });
          else lvdMap.push({ type: mt });
          q += ml;
        }
        fsd = { part: u16(b, o + 256 + 4), lbn: u32(b, o + 256) };
        label = ascii(b, o + 84, 31).replace(/[\0 ]+$/, '').replace(/^\x08/, '');
      } else if (t === 8) break;
    }
    if (!lvdMap || !fsd) return null;
    const lbaOf = (part, lbn) => {
      const m = lvdMap[part];
      if (!m || m.type !== 1 || !parts.has(m.part)) throw new Error('Unsupported UDF partition map');
      return (parts.get(m.part) + lbn) * SS;
    };
    const dstr = (o, n) => {
      if (!n) return '';
      const comp = b[o];
      let s = '';
      if (comp === 8) for (let i = 1; i < n; i++) s += String.fromCharCode(b[o + i]);
      else for (let i = 1; i + 1 < n; i += 2) s += String.fromCharCode((b[o + i] << 8) | b[o + i + 1]);
      return s;
    };
    function readFE(part, lbn) {
      const o = lbaOf(part, lbn);
      const t = tagId(o);
      if (t !== 261 && t !== 266) throw new Error('Bad UDF file entry');
      const ext = t === 266;
      const ftype = b[o + 16 + 11];
      const size = u32(b, o + 56);
      const lea = u32(b, o + (ext ? 208 : 168)), lad = u32(b, o + (ext ? 212 : 172));
      const ad = o + (ext ? 216 : 176) + lea;
      const icb = u16(b, o + 16 + 18) & 7;
      return { ftype, size, icb, ad, lad, part };
    }
    function data(fe) {
      if (fe.icb === 3) return b.slice(fe.ad, fe.ad + fe.lad);
      const out = new Uint8Array(fe.size);
      let pos = 0;
      const step = fe.icb === 0 ? 8 : 16;
      for (let q = fe.ad; q < fe.ad + fe.lad && pos < fe.size; q += step) {
        const w = u32(b, q), len = w & 0x3FFFFFFF, kind = w >>> 30;
        if (kind === 3) throw new Error('UDF allocation continuation not supported');
        const lbn = u32(b, q + 4);
        const part = fe.icb === 1 ? u16(b, q + 8) : fe.part;
        const n = Math.min(len, fe.size - pos);
        if (kind === 0) out.set(b.subarray(lbaOf(part, lbn), lbaOf(part, lbn) + n), pos);
        pos += n;
        if (!len) break;
      }
      return out;
    }
    function node(name, part, lbn) {
      const fe = readFE(part, lbn);
      const dir = fe.ftype === 4;
      return {
        name, dir, size: fe.size, fe,
        children() {
          const raw = data(fe), out = [];
          for (let p = 0; p + 38 <= raw.length;) {
            if (u16(raw, p) !== 257) break;
            const chars = raw[p + 18], lenfi = raw[p + 19], liu = u16(raw, p + 36);
            const nm = dstr(p + 38 + liu + 0, lenfi);
            const lbn2 = u32(raw, p + 20 + 4), part2 = u16(raw, p + 20 + 8);
            if (!(chars & 8) && !(chars & 4)) {
              const rawNm = (() => {
                const comp = raw[p + 38 + liu];
                let s = '';
                if (comp === 8) for (let i = 1; i < lenfi; i++) s += String.fromCharCode(raw[p + 38 + liu + i]);
                else for (let i = 1; i + 1 < lenfi; i += 2) s += String.fromCharCode((raw[p + 38 + liu + i] << 8) | raw[p + 38 + liu + i + 1]);
                return s;
              })();
              out.push(node(rawNm, part2, lbn2));
            }
            p += (38 + liu + lenfi + 3) & ~3;
            void nm;
          }
          return out;
        },
      };
    }
    const fsdOff = lbaOf(fsd.part, fsd.lbn);
    if (tagId(fsdOff) !== 256) return null;
    const rootLbn = u32(b, fsdOff + 400 + 4), rootPart = u16(b, fsdOff + 400 + 8);
    return makeFs('UDF', label, node('', rootPart, rootLbn), n => data(n.fe));
  }

  function open(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (const f of [openUdf, openIso, openFat]) {
      try { const r = f(b); if (r) return r; } catch (e) { /* try the next format */ }
    }
    return null;
  }

  return { open, openIso, openFat, openUdf };
});
