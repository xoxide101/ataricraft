// Reference reader for Craft documents (docs/CRAFT-FORMAT.md).
// Usage: node tools/craftdoc.cjs FILE.XCW [--text | --json]
// Validates the header and checksum, then prints the plain text (default), or the parsed header and paragraphs as JSON.
const fs = require('fs');

function parse(buf) {
  if (buf.length < 16) throw new Error('shorter than the 16-byte header');
  if (buf.toString('latin1', 0, 4) !== 'CRFT') throw new Error('bad magic (not a Craft document)');
  const h = {
    version: buf[4], type: String.fromCharCode(buf[5]), flags: buf[6], charset: buf[7],
    length: buf.readUInt16LE(8), aux: buf.readUInt16LE(10), cols: buf[12], rows: buf[13], checksum: buf.readUInt16LE(14),
  };
  if (h.version !== 1) throw new Error('unsupported version ' + h.version);
  if (buf.length < 16 + h.length) throw new Error('truncated: header says ' + h.length + ' payload bytes, file has ' + (buf.length - 16));
  const payload = buf.subarray(16, 16 + h.length);
  let sum = 0;
  for (const b of payload) sum = (sum + b) & 0xffff;
  h.checksumOk = sum === h.checksum;
  h.page = (h.flags & 2) ? require('./craftpage.cjs').fromTrailer(buf.subarray(16 + h.length)) : null;
  return { h, payload };
}

// Word payload: lines end in 13 (hard) or 14 (soft); codes 1-31 other than those are markers.
const STYLE = { 1: 'bold', 2: 'italic', 3: 'underline', 4: 'inverse', 11: 'super', 12: 'sub' };
function paragraphs(payload) {
  const out = []; let cur = { text: '', markers: [], runs: [] }; const on = {};
  for (const b of payload) {
    if (b === 13 || b === 14) {
      if (b === 13) { out.push(cur); cur = { text: '', markers: [], runs: [] }; }
    } else if (b < 32) {
      if (STYLE[b]) { on[STYLE[b]] = !on[STYLE[b]]; cur.runs.push({ at: cur.text.length, style: STYLE[b], on: !!on[STYLE[b]] }); }
      else cur.markers.push(b);
    } else if (b === 160) cur.text += '\u00a0';
    else if (b >= 128 && b < 160) cur.text += String.fromCodePoint(require('./atarigfx.cjs').uniOfAcw(b));
    else cur.text += String.fromCharCode(b);
  }
  if (cur.text || cur.markers.length) out.push(cur);
  return out;
}

if (require.main === module) {
  const [file, mode] = process.argv.slice(2);
  if (!file) { console.error('usage: node tools/craftdoc.cjs FILE.XCW [--text|--json]'); process.exit(2); }
  const { h, payload } = parse(fs.readFileSync(file));
  if (!h.checksumOk) console.error('warning: checksum mismatch');
  const ps = paragraphs(payload);
  if (mode === '--json') console.log(JSON.stringify({ header: h, paragraphs: ps }, null, 1));
  else console.log(ps.map((p) => p.text).join('\n'));
}

module.exports = { parse, paragraphs };
