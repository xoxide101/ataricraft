// diskconv.js - Atari disk image container conversion: DCM (Disk Communicator), PRO (APE ProSystem), XFD and ATR.
// Pure functions on Uint8Array, no DOM. Everything is normalised to/from an ATR image. The DCM decoder follows the
// format as implemented in atari800's compfile.c (GPL); the PRO layout is 16-byte header + 140-byte sector records.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.AC = root.AC || {}; root.AC.DiskConv = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  const isAtr = (b) => b.length >= 16 && b[0] === 0x96 && b[1] === 0x02;

  function atrHeader(secs, ss) {
    const paras = ss !== 256 || secs <= 3 ? secs << 3 : (secs << 4) - 0x18;
    const h = new Uint8Array(16);
    h.set([0x96, 0x02, paras & 255, (paras >> 8) & 255, ss & 255, ss >> 8, (paras >> 16) & 255, (paras >> 24) & 255]);
    return h;
  }

  // Sectors 1-3 are always 128 bytes in an ATR, later ones are `ss`.
  function buildAtr(sectors, ss) {
    let n = 0;
    for (let i = 0; i < sectors.length; i++) n += i < 3 ? 128 : ss;
    const out = new Uint8Array(16 + n);
    out.set(atrHeader(sectors.length, ss));
    let o = 16;
    for (let i = 0; i < sectors.length; i++) { const l = i < 3 ? 128 : ss; out.set(sectors[i].subarray(0, l), o); o += l; }
    return out;
  }

  function dcmToAtr(b) {
    let p = 0;
    const byte = () => { if (p >= b.length) throw new Error('DCM: unexpected end of data'); return b[p++]; };
    const word = () => byte() | (byte() << 8);
    const need = (n) => { if (p + n > b.length) throw new Error('DCM: unexpected end of data'); const r = b.subarray(p, p + n); p += n; return r; };
    const type = byte();
    if (type !== 0xf9 && type !== 0xfa) throw new Error('not a DCM image');
    const flags = byte();
    if ((flags & 0x1f) !== 1) throw new Error('DCM: archive must start at pass 1 (multi-part files must be concatenated in order)');
    const d = (flags >> 5) & 3;
    if (d === 3) throw new Error('DCM: unknown density');
    const ss = d === 1 ? 256 : 128, count = d === 2 ? 1040 : 720;
    const sectors = [];
    const buf = new Uint8Array(256);
    const pad = (till) => { while (sectors.length + 1 < till) sectors.push(new Uint8Array(256)); };
    const push = () => sectors.push(buf.slice());
    const pass = () => {
      for (;;) {
        const no = word();
        let st = byte();
        if (st === 0x45) return;
        if (no < sectors.length + 1) throw new Error('DCM: sector groups out of order');
        pad(no);
        for (;;) {
          let i;
          switch (st & 0x7f) {
            case 0x41: i = byte(); do { buf[i] = byte(); } while (i-- !== 0); break;
            case 0x42: buf.set(need(5), 123); buf.fill(buf[123], 0, 123); break;
            case 0x43: {
              i = 0;
              do {
                let j = byte();
                if (j < i) { if (j !== 0) throw new Error('DCM: bad run data'); j = 256; }
                if (i < j) buf.set(need(j - i), i);
                if (j >= ss) break;
                i = byte();
                if (i < j) { if (i !== 0) throw new Error('DCM: bad run data'); i = 256; }
                buf.fill(byte(), j, i);
              } while (i < ss);
              break;
            }
            case 0x44: i = byte(); if (i >= ss) throw new Error('DCM: bad sector data'); buf.set(need(ss - i), i); break;
            case 0x46: break;
            case 0x47: buf.set(need(ss), 0); break;
            default: throw new Error('DCM: unknown sector coding 0x' + st.toString(16));
          }
          push();
          if (!(st & 0x80)) break;
          st = byte();
          if (st === 0x45) return;
        }
      }
    };
    let pf = flags;
    for (;;) {
      pass();
      if (pf & 0x80) break;
      if (byte() !== type) throw new Error('DCM: multi-part archive is incomplete');
      pf = byte();
      if ((pf ^ flags) & 0x60) throw new Error('DCM: density changed inside archive');
    }
    pad(count + 1);
    return buildAtr(sectors, ss);
  }

  function proToAtr(b) {
    if (b.length < 16 || b[2] !== 0x50) throw new Error('not a PRO image');
    const n = (b[0] << 8) | b[1];
    if (!n || 16 + n * 140 > b.length) throw new Error('PRO: truncated image');
    const sectors = [];
    for (let i = 0; i < n; i++) sectors.push(b.subarray(16 + i * 140 + 12, 16 + i * 140 + 140));
    return buildAtr(sectors, 128);
  }

  // Single-density ATR -> PRO (no copy-protection data, every sector marked good).
  function atrToPro(b) {
    if (!isAtr(b) || (b[4] | (b[5] << 8)) !== 128) throw new Error('PRO export needs a single-density (128 byte) ATR');
    const n = Math.floor((b.length - 16) / 128);
    if (n > 0xffff) throw new Error('image too large for PRO');
    const out = new Uint8Array(16 + n * 140);
    out[0] = n >> 8; out[1] = n & 255; out[2] = 0x50;
    for (let i = 0; i < n; i++) {
      const o = 16 + i * 140;
      out[o + 1] = 0xff;
      out.set(b.subarray(16 + i * 128, 16 + i * 128 + 128), o + 12);
    }
    return out;
  }

  function xfdToAtr(b) {
    if (b.length % 128) throw new Error('XFD size is not a multiple of 128');
    const ss = b.length % 256 === 0 && b.length !== 92160 && b.length !== 133120 ? 256 : 128;
    const sectors = [];
    for (let o = 0; o < b.length; o += ss) sectors.push(b.subarray(o, o + ss));
    if (ss === 256) { // XFD stores the three boot sectors as full 256-byte slots
      const first = sectors.slice(0, 3).map((s) => s.subarray(0, 128));
      return buildAtr(first.concat(sectors.slice(3)), 256);
    }
    return buildAtr(sectors, 128);
  }

  function atrToXfd(b) {
    if (!isAtr(b)) throw new Error('not an ATR');
    const ss = (b[4] | (b[5] << 8)) || 128;
    if (ss === 128) return b.slice(16);
    const body = b.subarray(16), out = new Uint8Array(3 * 256 + Math.max(0, body.length - 384));
    for (let i = 0; i < 3; i++) out.set(body.subarray(i * 128, i * 128 + 128), i * 256);
    out.set(body.subarray(384), 768);
    return out;
  }

  // Identify by content (names lie): returns 'atr' | 'dcm' | 'pro' | 'xfd' | null.
  function detect(b, name) {
    if (isAtr(b)) return 'atr';
    const ext = ((name || '').match(/\.([a-z0-9]+)$/i) || [])[1];
    const e = ext ? ext.toLowerCase() : '';
    if ((b[0] === 0xf9 || b[0] === 0xfa) && (b[1] & 0x1f) === 1 && e !== 'car' && e !== 'rom') return 'dcm';
    if (b.length >= 16 && b[2] === 0x50 && b.length === 16 + ((b[0] << 8) | b[1]) * 140 && e !== 'xex') return 'pro';
    if (e === 'xfd' || (b.length % 128 === 0 && (b.length === 92160 || b.length === 133120 || b.length === 183936 || b.length === 184320))) return 'xfd';
    return null;
  }

  // Anything this module understands -> ATR bytes (ATR is returned untouched).
  function toAtr(b, name) {
    switch (detect(b, name)) {
      case 'dcm': return dcmToAtr(b);
      case 'pro': return proToAtr(b);
      case 'xfd': return xfdToAtr(b);
      default: return b;
    }
  }

  return { isAtr, detect, toAtr, dcmToAtr, proToAtr, atrToPro, xfdToAtr, atrToXfd, buildAtr };
});
