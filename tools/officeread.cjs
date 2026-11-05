// Minimal readers for Word documents: .docx (zip + XML) and legacy .doc (OLE compound file, Word 97-2003).
// Both return the importer's intermediate model: paragraphs of { align, bullet, runs: [{ t, b, i, u, sup, sub }] }.
// .docx keeps bold/italic/underline/super/sub/alignment/bullets; legacy .doc yields plain text only.
const zlib = require('zlib');

function unzip(buf, want) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip file');
  let n = buf.readUInt16LE(e + 10), p = buf.readUInt32LE(e + 16);
  while (n--) {
    const method = buf.readUInt16LE(p + 10), csz = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl); p += 46 + nl + xl + cl;
    if (name !== want) continue;
    const d = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), raw = buf.slice(d, d + csz);
    return method === 0 ? raw : zlib.inflateRawSync(raw);
  }
  return null;
}

const xmlDecode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]);

function readDocx(buf) {
  const x = unzip(buf, 'word/document.xml'); if (!x) throw new Error('word/document.xml not found');
  const xml = x.toString('utf8'); const out = [];
  const flag = (rpr, tag) => { const m = new RegExp('<w:' + tag + '(?:\\s[^>]*)?/?>').exec(rpr); return m ? (/w:val="(0|false|none)"/.test(m[0]) ? 0 : 1) : 0; };
  const parsePara = (ps) => {
    const p = { align: 'l', bullet: false, runs: [] };
    const ppr = (/<w:pPr>[\s\S]*?<\/w:pPr>/.exec(ps) || [''])[0];
    const jc = /<w:jc w:val="(\w+)"/.exec(ppr); if (jc) p.align = { center: 'c', right: 'r', both: 'j' }[jc[1]] || 'l';
    if (/<w:numPr>/.test(ppr)) p.bullet = true;
    for (const rm of ps.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)) {
      const r = rm[0], rpr = (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(r) || [''])[0];
      const va = /<w:vertAlign w:val="(\w+)"/.exec(rpr);
      const st = { b: flag(rpr, 'b'), i: flag(rpr, 'i'), u: flag(rpr, 'u'), sup: va && va[1] === 'superscript' ? 1 : 0, sub: va && va[1] === 'subscript' ? 1 : 0 };
      let t = '';
      for (const tm of r.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:noBreakHyphen\/>/g)) t += tm[1] !== undefined ? xmlDecode(tm[1]) : tm[0] === '<w:tab/>' ? '    ' : tm[0] === '<w:br/>' ? ' ' : '-';
      if (t) p.runs.push({ t, ...st });
    }
    return p;
  };
  const sp = { t: ' | ', b: 0, i: 0, u: 0, sup: 0, sub: 0 };
  // a table row becomes one line, cells separated by ' | '
  for (const m of xml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>|<w:p[ >][\s\S]*?<\/w:p>/g)) {
    if (!m[0].startsWith('<w:tr')) { out.push(parsePara(m[0])); continue; }
    const row = { align: 'l', bullet: false, runs: [] };
    for (const cm of m[0].matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)) {
      const cell = [...cm[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((pp) => parsePara(pp[0]).runs).filter((r) => r.length);
      if (row.runs.length) row.runs.push({ ...sp });
      cell.forEach((rs, k) => { if (k) row.runs.push({ ...sp, t: ' ' }); row.runs.push(...rs); });
    }
    out.push(row);
  }
  return out;
}

function cfb(buf) {
  if (buf.readUInt32BE(0) !== 0xd0cf11e0) throw new Error('not an OLE compound file');
  const ss = 1 << buf.readUInt16LE(30), ms = 1 << buf.readUInt16LE(32), sect = (i) => buf.slice(512 + i * ss, 512 + (i + 1) * ss);
  const difat = []; for (let i = 0; i < 109; i++) { const v = buf.readInt32LE(76 + i * 4); if (v >= 0) difat.push(v); }
  let d = buf.readInt32LE(68); for (let c = buf.readUInt32LE(72); c > 0 && d >= 0; c--) { const s = sect(d); for (let i = 0; i < ss / 4 - 1; i++) { const v = s.readInt32LE(i * 4); if (v >= 0) difat.push(v); } d = s.readInt32LE(ss - 4); }
  const fat = []; for (const f of difat) { const s = sect(f); for (let i = 0; i < ss / 4; i++) fat.push(s.readInt32LE(i * 4)); }
  const chain = (s) => { const r = []; while (s >= 0 && r.length < fat.length) { r.push(s); s = fat[s]; } return r; };
  const read = (s, size) => Buffer.concat(chain(s).map(sect)).slice(0, size);
  const dir = read(buf.readInt32LE(48), 1 << 30), ents = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) { const nl = dir.readUInt16LE(o + 64); if (!nl) continue; ents.push({ name: dir.toString('utf16le', o, o + nl - 2), type: dir[o + 66], start: dir.readInt32LE(o + 116), size: dir.readUInt32LE(o + 120) }); }
  const root = ents.find((e) => e.type === 5), mini = root ? read(root.start, root.size) : Buffer.alloc(0);
  const minifat = []; for (const s of chain(buf.readInt32LE(60))) { const b = sect(s); for (let i = 0; i < ss / 4; i++) minifat.push(b.readInt32LE(i * 4)); }
  return (name) => {
    const e = ents.find((x) => x.type === 2 && x.name === name); if (!e) return null;
    if (e.size >= buf.readUInt32LE(56)) return read(e.start, e.size);
    const parts = []; let s = e.start; for (let n = 0; s >= 0 && n < minifat.length; n++) { parts.push(mini.slice(s * ms, (s + 1) * ms)); s = minifat[s]; }
    return Buffer.concat(parts).slice(0, e.size);
  };
}

const CP1252 = { 0x80: '\u20ac', 0x82: '\u201a', 0x83: '\u0192', 0x84: '\u201e', 0x85: '\u2026', 0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201c', 0x94: '\u201d', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014', 0x99: '\u2122' };

function readDoc(buf) {
  const get = cfb(buf), wd = get('WordDocument'); if (!wd) throw new Error('no WordDocument stream');
  if (wd.readUInt16LE(0) !== 0xa5ec) throw new Error('not a Word 97-2003 document');
  const tbl = get((wd.readUInt16LE(10) & 0x200) ? '1Table' : '0Table'); if (!tbl) throw new Error('table stream missing (encrypted or damaged)');
  if (wd.readUInt16LE(10) & 0x100) throw new Error('document is encrypted');
  const csw = wd.readUInt16LE(32), lw = 34 + csw * 2, cslw = wd.readUInt16LE(lw), rgLw = lw + 2, ccpText = wd.readUInt32LE(rgLw + 12);
  const fb = rgLw + cslw * 4 + 2, fcClx = wd.readUInt32LE(fb + 33 * 8), lcbClx = wd.readUInt32LE(fb + 33 * 8 + 4);
  const clx = tbl.slice(fcClx, fcClx + lcbClx); let p = 0;
  while (clx[p] === 1) p += 3 + clx.readUInt16LE(p + 1);
  if (clx[p] !== 2) throw new Error('piece table not found');
  const lcb = clx.readUInt32LE(p + 1), n = (lcb - 4) / 12 | 0, cp = p + 5, pcd = cp + (n + 1) * 4;
  let text = '';
  for (let i = 0; i < n; i++) {
    const a = clx.readUInt32LE(cp + i * 4), b = Math.min(clx.readUInt32LE(cp + i * 4 + 4), ccpText); if (a >= ccpText) break;
    let fc = clx.readUInt32LE(pcd + i * 8 + 2); const comp = !!(fc & 0x40000000); fc &= 0x3fffffff;
    if (comp) { for (let k = 0; k < b - a; k++) { const c = wd[fc / 2 + k]; text += CP1252[c] || String.fromCharCode(c); } }
    else text += wd.toString('utf16le', fc, fc + (b - a) * 2);
  }
  text = text.replace(/\x13[^\x14\x15]*\x14?/g, '').replace(/\x15/g, '').replace(/\x0b/g, ' ').replace(/\x07\x07/g, '\x1e').replace(/\x07/g, ' | ').replace(/\x1e/g, '\r').replace(/[\x01\x08\x0c]/g, ' ').replace(/\t/g, '    ');
  return text.split('\r').map((l) => ({ align: 'l', bullet: false, runs: [{ t: l }] }));
}

module.exports = { readDocx, readDoc };
