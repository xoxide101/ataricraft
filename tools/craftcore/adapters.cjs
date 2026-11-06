// Import/export adapters for the Craft Container: ATR (Atari disk image), CWD (CRFT word document), ACF2 (Craft font), raw (anything).
// An adapter is {name, detect(bytes, filename) -> 0..1, import(bytes, opts) -> Container, export(container) -> Uint8Array}.
// Rule: export() rebuilds the file from the DERIVED forms, never from the original, so a round trip proves the derived forms are complete.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    let font = null; try { font = require('../craftfont.cjs'); } catch (e) { /* the font adapter is then unavailable */ }
    module.exports = factory(require('./util.cjs'), require('./container.cjs'), require('./encodings.cjs'), font);
  } else {
    const C = (root.AC = root.AC || {}).CraftCore;
    C.adapters = factory(C.util, C.Container, C.encodings, root.XCW && root.XCW.Font);
  }
})(typeof self !== 'undefined' ? self : this, function (U, CC, ENC, FONT) {
  'use strict';
  const { Container } = CC;
  const TOOL = { name: 'craftcore', version: '1' };
  const jbytes = (o) => U.enc(JSON.stringify(o, null, 1));
  const parseJ = (b) => JSON.parse(U.dec(b));
  const make = (type, name, bytes, o) => {
    const c = Container.create({ type, name, source: (o && o.source) || { kind: 'file', uri: name }, tool: TOOL, created: o && o.created });
    c.setOriginal(bytes, { mediaType: o && o.mediaType, name });
    return c;
  };
  const ext = (n) => ((n || '').match(/\.([^.\\/]+)$/) || [, ''])[1].toLowerCase();

  // ------------------------------------------------------------------ raw
  const raw = {
    name: 'raw', detect: () => 0.01,
    import(bytes, o) { o = o || {}; const c = make('file.raw', o.name || 'file.bin', U.u8(bytes), o); c.addProvenance({ step: 'import', adapter: 'raw' }); return c; },
    export: (c) => c.original(),
  };

  // ------------------------------------------------------------------ ATR
  const ATR_MAGIC = 0x0296;
  function atrInfo(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const paras = dv.getUint16(2, true) | (b[6] << 16), ss = dv.getUint16(4, true);
    const size = paras * 16, sectors = ss === 128 ? size / 128 : size >= 384 ? 3 + (size - 384) / ss : 0;
    return { paragraphs: paras, imageBytes: size, sectorSize: ss, sectors: Math.floor(sectors), header: U.hex(b.subarray(0, 16)) };
  }
  // byte offset of sector n (1-based) inside the payload; the first three sectors are always 128 bytes
  const atrSectorOffset = (n, ss) => (n <= 3 ? (n - 1) * 128 : 384 + (n - 4) * ss);
  const atrSectorLen = (n, ss) => (n <= 3 ? 128 : ss);

  // DOS 2 compatible directory (sectors 361-368), also what MyDOS uses on small disks. Heuristic: marked as such in the loss report.
  function atrCatalog(pay, info) {
    const ss = info.sectorSize, files = [];
    for (let s = 361; s <= 368; s++) {
      const o = atrSectorOffset(s, ss); if (o + 128 > pay.length) return null;
      for (let e = 0; e < 8; e++) {
        const d = pay.subarray(o + e * 16, o + e * 16 + 16);
        if (d[0] === 0) return files;
        if (d[0] & 0x80) continue;
        const count = d[1] | (d[2] << 8), start = d[3] | (d[4] << 8);
        const name = String.fromCharCode(...d.subarray(5, 13)).trimEnd() + (String.fromCharCode(...d.subarray(13, 16)).trimEnd() ? '.' + String.fromCharCode(...d.subarray(13, 16)).trimEnd() : '');
        const parts = []; let n = start, guard = 0, ok = true;
        while (n && guard++ <= info.sectors) {
          const so = atrSectorOffset(n, ss), len = atrSectorLen(n, ss);
          if (so + len > pay.length || n > info.sectors) { ok = false; break; }
          const sec = pay.subarray(so, so + len);
          parts.push(sec.subarray(0, sec[len - 1]));
          n = ((sec[len - 3] & 3) << 8) | sec[len - 2];
        }
        const data = U.concat(parts);
        files.push({ name, flags: d[0], sectors: count, start, size: data.length, sha256: U.sha256hex(data), chainOk: ok && guard <= info.sectors });
      }
    }
    return files;
  }

  const atr = {
    name: 'atr',
    detect: (b, n) => (b.length >= 16 && (b[0] | (b[1] << 8)) === ATR_MAGIC ? 0.95 : ext(n) === 'atr' ? 0.3 : 0),
    import(bytes, o) {
      o = o || {}; bytes = U.u8(bytes);
      if (bytes.length < 16 || (bytes[0] | (bytes[1] << 8)) !== ATR_MAGIC) throw new Error('not an ATR image (0x96 0x02 expected)');
      const info = atrInfo(bytes), pay = bytes.subarray(16);
      const c = make('disk.atr', o.name || 'disk.atr', bytes, Object.assign({ mediaType: 'application/x-atari-disk' }, o));
      c.addDerived('payload.bin', pay, { kind: 'disk.sectors', from: 'original', tool: 'atr-import' });
      c.addDerived('atr.json', jbytes(info), { kind: 'disk.info', mediaType: 'application/json', from: 'original', tool: 'atr-import' });
      if (pay.length !== info.imageBytes) c.addLoss({ code: 'atr-size-mismatch', severity: 'warn', where: 'original', count: 1, detail: 'header says ' + info.imageBytes + ' image bytes, file has ' + pay.length + '; all bytes kept' });
      if (info.sectorSize === 128 || info.sectorSize === 256 || info.sectorSize === 512) {
        const cat = info.sectors >= 368 ? atrCatalog(pay, info) : null;
        if (cat) {
          c.addDerived('catalog.json', jbytes({ filesystem: 'dos2-compatible (heuristic, not verified)', files: cat }), { kind: 'disk.catalog', mediaType: 'application/json', from: 'payload.bin', tool: 'atr-import' });
          c.addLoss({ code: 'catalog-heuristic', severity: 'info', where: 'derived:catalog.json', count: 1, detail: 'directory read as DOS 2 layout; other file systems may differ' });
        }
      } else c.addLoss({ code: 'atr-odd-sector-size', severity: 'warn', where: 'original', count: 1, detail: 'sector size ' + info.sectorSize + ' is not 128, 256 or 512; no catalog' });
      c.addProvenance({ step: 'import', adapter: 'atr' });
      return c;
    },
    export(c) {
      const info = parseJ(c.blob('atr.json')), hdr = U.unhex(info.header);
      return U.concat([hdr, c.blob('payload.bin')]);
    },
  };

  // ------------------------------------------------------------------ CWD (docs/CRAFT-FORMAT.md)
  const STYLE = new Set([1, 2, 3, 4, 11, 12]);
  function cwdParse(b) {
    if (b.length < 16 || U.dec(b.subarray(0, 4)) !== 'CRFT') throw new Error('not a CRFT file');
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const h = { version: b[4], type: String.fromCharCode(b[5]), flags: b[6], charset: b[7], length: dv.getUint16(8, true), aux: dv.getUint16(10, true), cols: b[12], rows: b[13], checksum: dv.getUint16(14, true) };
    if (b.length < 16 + h.length) throw new Error('truncated CRFT file');
    return { h, payload: b.subarray(16, 16 + h.length), trailer: b.subarray(16 + h.length) };
  }
  function cwdText(payload) {
    let text = '', style = 0, para = 0, gfx = 0, other = 0; const gs = [];
    for (let i = 0; i < payload.length; i++) {
      const c = payload[i];
      if (c === 13) text += '\n'; else if (c === 14) text += ' ';
      else if (c < 32) { if (STYLE.has(c)) style++; else para++; }
      else if (c >= 128 && c <= 159) { text += '\ufffd'; gfx++; if (gs.length < 5) gs.push(i); }
      else if (c === 160) text += '\u00a0'; else if (c === 173) text += '\u2011';
      else if (c === 127) { other++; } else text += String.fromCharCode(c);
    }
    return { text, style, para, gfx, gs, other };
  }
  const cwd = {
    name: 'cwd',
    detect: (b, n) => (b.length >= 16 && U.dec(b.subarray(0, 4)) === 'CRFT' ? 0.95 : /^(xcw|cwd)$/.test(ext(n)) ? 0.3 : 0),
    import(bytes, o) {
      o = o || {}; bytes = U.u8(bytes);
      const p = cwdParse(bytes);
      const c = make('doc.cwd', o.name || 'doc.xcw', bytes, Object.assign({ mediaType: 'application/x-craft-word' }, o));
      c.addDerived('header.json', jbytes(p.h), { kind: 'craft.header', mediaType: 'application/json', from: 'original', tool: 'cwd-import' });
      c.addDerived('payload.bin', p.payload, { kind: 'craft.payload', from: 'original', tool: 'cwd-import' });
      if (p.trailer.length) c.addDerived('trailer.bin', p.trailer, { kind: 'craft.trailer', from: 'original', tool: 'cwd-import' });
      const t = cwdText(p.payload);
      c.addDerived('text.txt', U.enc(t.text), { kind: 'text', mediaType: 'text/plain; charset=utf-8', lossy: true, from: 'payload.bin', encoding: 'utf8', tool: 'cwd-import' });
      if (U.sum16(p.payload) !== p.h.checksum) c.addLoss({ code: 'checksum-mismatch', severity: 'warn', where: 'original', count: 1, detail: 'stored ' + p.h.checksum + ', computed ' + U.sum16(p.payload) + '; stored value kept' });
      if (t.style) c.addLoss({ code: 'style-codes-dropped', severity: 'lossy', where: 'derived:text.txt', count: t.style, detail: 'bold/italic/underline/inverse/super/subscript toggles are not in plain text' });
      if (t.para) c.addLoss({ code: 'paragraph-markers-dropped', severity: 'lossy', where: 'derived:text.txt', count: t.para, detail: 'alignment, indent, bullet, size and spacer markers are not in plain text' });
      if (t.gfx) c.addLoss({ code: 'atari-graphics-chars', severity: 'lossy', where: 'derived:text.txt', count: t.gfx, detail: 'Craft text 128-159 (Atari graphics) written as U+FFFD', samples: t.gs });
      if (t.other) c.addLoss({ code: 'reserved-code-dropped', severity: 'lossy', where: 'derived:text.txt', count: t.other, detail: 'code 127 is reserved' });
      if (p.trailer.length) c.addLoss({ code: 'trailer-kept-opaque', severity: 'info', where: 'derived:trailer.bin', count: p.trailer.length, detail: 'page-setup trailer kept as bytes, not interpreted' });
      c.addProvenance({ step: 'import', adapter: 'cwd' });
      return c;
    },
    export(c) {
      const h = parseJ(c.blob('header.json')), pay = c.blob('payload.bin'), hd = new Uint8Array(16), dv = new DataView(hd.buffer);
      hd.set(U.enc('CRFT')); hd[4] = h.version; hd[5] = h.type.charCodeAt(0); hd[6] = h.flags; hd[7] = h.charset;
      dv.setUint16(8, h.length, true); dv.setUint16(10, h.aux, true); hd[12] = h.cols; hd[13] = h.rows; dv.setUint16(14, h.checksum, true);
      return U.concat([hd, pay, c.hasBlob('trailer.bin') ? c.blob('trailer.bin') : new Uint8Array(0)]);
    },
    // text -> new CWD (lossy in the other direction too: only plain paragraphs). Returns {bytes, lost}.
    fromText(text) {
      const e = ENC.encode(text.replace(/\r\n?/g, '\n'), 'latin1'), pay = Array.from(e.bytes, (x) => (x === 10 ? 13 : x));
      const hd = new Uint8Array(16), dv = new DataView(hd.buffer);
      hd.set(U.enc('CRFT')); hd[4] = 1; hd[5] = 0x57; dv.setUint16(8, pay.length, true); dv.setUint16(10, pay.filter((x) => x === 13).length + 1, true); hd[12] = 64; hd[13] = 20;
      dv.setUint16(14, U.sum16(pay), true);
      return { bytes: U.concat([hd, Uint8Array.from(pay)]), lost: e.lost };
    },
  };

  // ------------------------------------------------------------------ ACF2 (docs/FONT.md)
  const acf = {
    name: 'acf',
    detect: (b, n) => (b.length >= 4 && U.dec(b.subarray(0, 4)) === 'ACF2' ? 0.95 : /^(acf|xcf)$/.test(ext(n)) ? 0.3 : 0),
    import(bytes, o) {
      o = o || {}; bytes = U.u8(bytes);
      if (!FONT) throw new Error('tools/craftfont.cjs is not available');
      const f = FONT.parse(bytes);
      const c = make('font.acf2', o.name || 'font.acf', bytes, Object.assign({ mediaType: 'application/x-craft-font' }, o));
      c.addDerived('font.json', U.enc(FONT.toJson(f)), { kind: 'font.json', mediaType: 'application/json', from: 'original', tool: 'craftfont' });
      if (!U.equals(FONT.serialize(f), bytes)) c.addLoss({ code: 'font-not-canonical', severity: 'warn', where: 'derived:font.json', count: 1, detail: 'the file differs from what the font model writes; export will not be byte-identical' });
      c.addProvenance({ step: 'import', adapter: 'acf' });
      return c;
    },
    export(c) { return U.u8(FONT.serialize(FONT.fromJson(U.dec(c.blob('font.json'))))); },
  };

  let xcs = null; // spreadsheet adapter, Node only (tools/craftcore/adapter-xcs.cjs)
  try { if (typeof require === 'function') xcs = require('./adapter-xcs.cjs')(U, make, jbytes, ext); } catch (e) { xcs = null; }
  let xcd = null; // database adapter, Node only (tools/craftcore/adapter-xcd.cjs)
  try { if (typeof require === 'function') xcd = require('./adapter-xcd.cjs')(U, make, jbytes, ext); } catch (e) { xcd = null; }
  const ADAPTERS = Object.assign({ atr, cwd, acf }, xcs ? { xcs } : {}, xcd ? { xcd } : {}, { raw });
  // Craft file extensions (docs/FILE-EXTENSIONS.md). The adapter id 'cwd' (container type) is the Craft Word adapter; .xcw is its name, .cwd the legacy alias.
  const EXTENSIONS = {
    xcw: { adapter: 'cwd', kind: 'word', status: 'implemented', description: 'Craft Word document' },
    cwd: { adapter: 'cwd', kind: 'word', status: 'legacy alias of xcw', description: 'Craft Word document (old name, still read)' },
    xcs: { adapter: 'xcs', kind: 'spreadsheet', status: 'implemented', description: 'Craft spreadsheet' },
    xcd: { adapter: 'xcd', kind: 'database', status: 'implemented', description: 'Craft database' },
    acf: { adapter: 'acf', kind: 'font', status: 'implemented', description: 'Craft font (ACF2)' },
    xcf: { adapter: 'acf', kind: 'font', status: 'implemented', description: 'Craft font (same format as .acf)' },
  };
  // best adapter for these bytes (never null: raw is the fallback)
  const detect = (bytes, filename) => {
    bytes = U.u8(bytes); let best = raw, s = raw.detect();
    for (const a of Object.values(ADAPTERS)) { if (a === acf && !FONT) continue; const v = a.detect(bytes, filename); if (v > s) { best = a; s = v; } }
    return best;
  };
  return { ADAPTERS, EXTENSIONS, detect, atr, cwd, acf, xcs, xcd, raw, cwdText };
});
