// APT (Atari Partition Table) reader/writer, per APT spec revision T.
// Usable from Node (require) and the browser (window.APT).
(function (root) {
  const SS = { 1: 128, 2: 256, 3: 512 };
  const rd32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const wr32 = (b, o, v) => { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; b[o + 2] = (v >>> 16) & 255; b[o + 3] = (v >>> 24) & 255; };
  const atascii = (b, o, n) => { let s = ''; for (let i = 0; i < n && b[o + i]; i++) s += String.fromCharCode(b[o + i] & 0x7f); return s; };

  function parseEntry(b, o) {
    const flags = b[o], sizeCode = flags & 3;
    const e = {
      flags, type: b[o + 1], start: rd32(b, o + 2), count: rd32(b, o + 6), id: b[o + 10] | (b[o + 11] << 8),
      skip: !!(flags & 0x80), hasMeta: !!(flags & 0x40), mapping: (flags >> 2) & 3,
      sectorSize: SS[sizeCode] || 0, endOfTable: sizeCode === 0, data: b.slice(o + 12, o + 16),
    };
    if (e.type === 0) { e.writeProtected = !!(e.data[0] & 0x80); e.active = !!(e.data[0] & 0x40); e.sector1Offset = e.data[2] | (e.data[3] << 8); }
    else if (e.type === 2) e.chunk = e.data[0] | (e.data[1] << 8);
    else if (e.type === 3) {
      e.writeProtected = !!(e.data[0] & 0x80); e.active = !!(e.data[0] & 0x40);
      e.metaLba = (((e.data[0] & 15) << 24) | (e.data[3] << 16) | (e.data[2] << 8) | e.data[1]) >>> 0;
    }
    return e;
  }

  function readMeta(img, e) {
    const lbaAt = e.type === 3 ? e.metaLba : e.start - 1;
    if (!e.hasMeta || lbaAt < 0) return null;
    const o = lbaAt * 512;
    if (o + 512 > img.length) return null;
    if (atascii(img, o, 3) !== 'APT' || atascii(img, o + 4, 4) !== 'META') return null;
    return atascii(img, o + 16, 39);
  }

  // The APT header sits in the first sector of the protective MBR's $7F partition.
  function findApt(img) {
    if (img.length >= 512 && img[510] === 0x55 && img[511] === 0xaa) {
      for (let i = 0; i < 4; i++) {
        const p = 0x1be + i * 16;
        if (img[p + 4] === 0x7f) return rd32(img, p + 8);
      }
    }
    return atascii(img, 1, 3) === 'APT' ? 0 : -1;
  }

  function parse(img) {
    const first = findApt(img);
    if (first < 0) throw new Error('No APT found');
    const res = { aptLba: first, boot: 0, slots: [], partitions: [], chain: [] };
    let lba = first, isFirst = true, guard = 0;
    while (guard++ < 64) {
      const o = lba * 512;
      if (o + 512 > img.length) throw new Error('APT sector beyond image at LBA ' + lba);
      if (isFirst) {
        if (atascii(img, o + 1, 3) !== 'APT') throw new Error('Bad APT signature');
        const g = img[o];
        res.dataInEvenBytes = !!(g & 0x80); res.revision = (g >> 5) & 3; res.globalMeta = !!(g & 0x10);
        res.mappingSlots = (g & 15) + 15; res.boot = img[o + 4];
      }
      res.chain.push(lba);
      const n = Math.min(img[o + 5], 32);
      for (let i = 1; i < n; i++) {
        const e = parseEntry(img, o + i * 16);
        if (e.endOfTable) continue;
        if (isFirst && i <= 15) { e.drive = i; res.slots.push(e); } else res.partitions.push(e);
      }
      const next = rd32(img, o + 8);
      if (!next) break;
      lba = next; isFirst = false;
    }
    for (const e of [...res.slots, ...res.partitions]) e.name = readMeta(img, e);
    return res;
  }

  // parts: [{ sectorSize:512|256|128, sectors, name, mapping, active, writeProtected, data:Uint8Array }]
  // DOS partitions are laid out back-to-back after the APT sector, each preceded by its metadata leader.
  function build(parts, { boot = 1 } = {}) {
    if (parts.length > 15) throw new Error('Max 15 mapped partitions');
    const lay = []; let lba = 2;
    for (const p of parts) {
      const secSz = p.sectorSize || 512, per = secSz === 512 ? 1 : 512 / secSz;
      const lbas = Math.ceil(p.sectors / per);
      lay.push({ ...p, secSz, start: lba + 1, lbas, meta: lba });
      lba += 1 + lbas;
    }
    const tbl = lba; lba++;
    const img = new Uint8Array(lba * 512);
    img[510] = 0x55; img[511] = 0xaa;
    const m = 0x1be; img[m + 4] = 0x7f; img[m + 5] = 0xff; img[m + 6] = 0xff; img[m + 7] = 0xff;
    wr32(img, m + 8, 1); wr32(img, m + 12, lba - 1);
    const h = 512;
    img.set([0x41, 0x50, 0x54], h + 1); img[h + 4] = boot; img[h + 5] = 16; wr32(img, h + 8, tbl);
    const c = tbl * 512; img.set([0x41, 0x50, 0x54], c + 1); img[c + 5] = 16;
    lay.forEach((p, i) => {
      const o = h + 16 + i * 16, oc = c + 16 + i * 16;
      const sz = p.secSz === 128 ? 1 : p.secSz === 256 ? 2 : 3;
      img[o] = sz | ((p.mapping || 0) << 2) | 0x40;
      wr32(img, o + 2, p.start); wr32(img, o + 6, p.sectors);
      img[o + 10] = i + 1;
      img[o + 12] = (p.writeProtected ? 0x80 : 0) | (p.active === false ? 0 : 0x40);
      img.copyWithin(oc, o, o + 16);
      const mo = p.meta * 512;
      img.set([0x41, 0x50, 0x54, 0, 0x4d, 0x45, 0x54, 0x41], mo);
      const nm = p.name || '';
      for (let k = 0; k < 39 && k < nm.length; k++) img[mo + 16 + k] = nm.charCodeAt(k) & 0x7f;
      if (p.data) img.set(p.data.subarray(0, p.lbas * 512), p.start * 512);
    });
    return img;
  }

  const api = { parse, build, findApt, parseEntry };
  if (typeof module !== 'undefined') module.exports = api; else root.APT = api;
})(typeof window !== 'undefined' ? window : globalThis);
