// Cartridge image helpers: read/strip/add the 16-byte CART header ("CART", type, checksum, 4 zero bytes; big-endian).
(function (root) {
  const AC = root.AC = root.AC || {};
  // Common Atari800 .CAR type ids, by ROM size in KB.
  const TYPES = [
    [1, 8, 'Standard 8 KB'], [2, 16, 'Standard 16 KB'], [3, 16, 'OSS 034M 16 KB'], [15, 16, 'OSS M091 16 KB'], [4, 32, '5200 32 KB'],
    [12, 32, 'XEGS 32 KB'], [8, 64, 'Williams 64 KB'], [9, 64, 'Express 64 KB'], [10, 64, 'Diamond 64 KB'], [11, 64, 'SpartaDOS X 64 KB'],
    [13, 64, 'XEGS 64 KB'], [14, 128, 'XEGS 128 KB'], [17, 128, 'Atrax 128 KB'],
  ];
  const sum = (b, o) => { let s = 0; for (let i = o; i < b.length; i++) s = (s + b[i]) >>> 0; return s; };
  function crc32(b, o) {
    let c, crc = 0xffffffff;
    for (let i = o; i < b.length; i++) { c = (crc ^ b[i]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; }
    return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
  }
  function parse(b) {
    const has = b.length >= 16 && b[0] === 0x43 && b[1] === 0x41 && b[2] === 0x52 && b[3] === 0x54;
    const o = has ? 16 : 0, dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const type = has ? dv.getUint32(4) : null, check = has ? dv.getUint32(8) : null;
    const rom = b.subarray(o), crc = crc32(b, o), db = (AC.CART_DB || {})[crc];
    return { hasHeader: has, type, checksumOk: has ? check === sum(b, 16) : null, size: rom.length, kb: rom.length / 1024, crc, known: db ? { type: db[1], name: db[2] } : null, rom };
  }
  const strip = (b) => parse(b).rom.slice();
  function addHeader(rom, type) {
    const out = new Uint8Array(16 + rom.length), dv = new DataView(out.buffer);
    out.set([0x43, 0x41, 0x52, 0x54]); dv.setUint32(4, type); dv.setUint32(8, sum(rom, 0)); out.set(rom, 16);
    return out;
  }
  const typesFor = (kb) => TYPES.filter((t) => t[1] === kb);
  AC.CartTool = { parse, strip, addHeader, typesFor, TYPES };
})(typeof self !== 'undefined' ? self : this);
