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

  // ATR -> single-pass DCM (DiskComm). Each sector is coded against the previously coded sector with the smallest
  // of: identical (0x46), changed head (0x41), changed tail (0x44), uniform start + 5 bytes (0x42), run mix (0x43), raw (0x47).
  // Sectors 1-3 of a double-density image are 128 bytes; DCM stores them padded to 256 like atari800 does.
  function atrToDcm(b) {
    if (!isAtr(b)) throw new Error('not an ATR');
    const ss = (b[4] | (b[5] << 8)) || 128;
    if (ss !== 128 && ss !== 256) throw new Error('DCM export needs a 128 or 256 byte sector ATR');
    const body = b.subarray(16);
    const sectors = [];
    for (let i = 0, o = 0; o < body.length; i++) {
      const l = i < 3 ? 128 : ss, s = new Uint8Array(256);
      s.set(body.subarray(o, o + l));
      sectors.push(s); o += l;
    }
    const n = sectors.length;
    if (!n || n > 65535) throw new Error('DCM: image has no sectors or too many');
    const d = ss === 256 ? 1 : n > 720 ? 2 : 0;
    if (n > (d === 2 ? 1040 : 720)) throw new Error('DCM export supports up to 720 sectors (1040 for 128-byte enhanced density)');
    const out = [0xfa, 0x01 | (d << 5) | 0x80, 1, 0];
    const prev = new Uint8Array(256);
    const same = (a, o, e, p) => { for (let i = o; i < e; i++) if (a[i] !== p[i]) return false; return true; };
    for (let k = 0; k < n; k++) {
      const cur = sectors[k];
      let best = null;
      const offer = (code, data) => { const c = 1 + data.length; if (!best || c < best.cost) best = { cost: c, code, data }; };
      let lo = 0, hi = ss - 1;
      while (lo < ss && cur[lo] === prev[lo]) lo++;
      while (hi >= 0 && cur[hi] === prev[hi]) hi--;
      if (lo === ss) offer(0x46, []);
      else {
        offer(0x47, Array.from(cur.subarray(0, ss)));
        const head = [hi]; for (let i = hi; i >= 0; i--) head.push(cur[i]);
        offer(0x41, head);
        offer(0x44, [lo, ...cur.subarray(lo, ss)]);
        if (same(cur, 0, 123, new Uint8Array(123).fill(cur[123])) && (ss === 128 || same(cur, 128, 256, prev))) offer(0x42, Array.from(cur.subarray(123, 128)));
        const r = [];
        let p = 0, ok = true;
        for (;;) {
          let q = p;
          for (; q < ss; q++) { let e = q; while (e < ss && cur[e] === cur[q]) e++; if (e - q >= 4) break; }
          if (ss === 256 && p === 0 && q === 256) { ok = false; break; }
          r.push(q & 255);
          for (let i = p; i < q; i++) r.push(cur[i]);
          if (q >= ss) break;
          let e = q; while (e < ss && cur[e] === cur[q]) e++;
          if (q === 0 && e === 256) e = 128;
          r.push(e & 255, cur[q]);
          p = e;
          if (p >= ss) break;
        }
        if (ok) offer(0x43, r);
      }
      out.push(best.code | (k < n - 1 ? 0x80 : 0), ...best.data);
      prev.set(cur);
    }
    out.push(0, 0, 0x45);
    return Uint8Array.from(out);
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

  // Boot-sector XEX loader (source: tools/xexboot/xexboot.asm). 3 boot sectors, stream from sector 4, length at +9.
  const XEX_LOADER = '0003000706074c0c07000000d8a9008d000a8d010a8d020a8d050aa9048d040aa9808d030aad000acd0907ad010aed0a07ad020aed0b07b06520ac078d060a20ac078d070a2d060ac9fff0d920ac078d080a20ac078d090aad060a85e0ad070a85e120ac07a00091e0a5e0cd080ad007a5e1cd090af009e6e0d0e7e6e14c6207ad060ac9e2d09ead070ac902d097ad080ac9e3d090209b074c25076ce202ade0020de102f0036ce0026c0a00ae030ae080900520cd07a200bd8008e88e030aee000ad008ee010ad003ee020a60a9318d0003a9018d0103a9528d0203a9408d0303a9808d0403a9088d0503a9078d0603a9808d0803a9008d0903ad040a8d0a03ad050a8d0b032059e43009ee040ad003ee050a60ee1ad04ccd07';

  // Atari binary (XEX/COM/OBJ) -> self-booting single-density ATR (no DOS needed; 720 sectors, or 1040 when larger).
  function xexToAtr(x) {
    if (x.length < 6 || x[0] !== 0xff || x[1] !== 0xff) throw new Error('not an Atari binary (no $FFFF header)');
    const n = Math.ceil(x.length / 128), nsec = n + 3 <= 720 ? 720 : 1040;
    if (n + 3 > nsec) throw new Error('binary too large for a 130K boot disk (max ' + (1040 - 3) * 128 + ' bytes)');
    const out = new Uint8Array(16 + nsec * 128);
    out.set(atrHeader(nsec, 128));
    for (let i = 0; i < XEX_LOADER.length; i += 2) out[16 + i / 2] = parseInt(XEX_LOADER.substr(i, 2), 16);
    out[16 + 9] = x.length & 255; out[16 + 10] = (x.length >> 8) & 255; out[16 + 11] = x.length >> 16;
    out.set(x, 16 + 384);
    return out;
  }

  // Inverse of xexToAtr for disks it made.
  function atrToXex(b) {
    const hex = (o, k) => Array.from(b.subarray(16 + o, 16 + o + k), (v) => v.toString(16).padStart(2, '0')).join('');
    if (!isAtr(b) || hex(0, 9) !== XEX_LOADER.slice(0, 18) || hex(12, 270) !== XEX_LOADER.slice(24)) throw new Error('not a disk made by xexToAtr');
    const len = b[16 + 9] | (b[16 + 10] << 8) | (b[16 + 11] << 16);
    return b.slice(16 + 384, 16 + 384 + len);
  }

  // VAPI ATX (copy-protected disk image) -> plain ATR. Keeps the sector data only; weak bits, timing and
  // duplicate/phantom sectors are lost, so protected disks will not boot from the result.
  function atxToAtr(b) {
    if (b.length < 48 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'AT8X') throw new Error('not an ATX image');
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const density = b[0x12], ss = density === 2 ? 256 : 128, spt = density === 1 ? 26 : 18;
    const sectors = [];
    let tp = dv.getUint32(0x1c, true);
    while (tp + 32 <= b.length) {
      const size = dv.getUint32(tp, true), type = dv.getUint16(tp + 4, true);
      if (size < 32) break;
      if (type === 0) {
        const track = b[tp + 8], count = dv.getUint16(tp + 10, true), hs = dv.getUint32(tp + 20, true);
        let cp = tp + hs, list = null;
        while (cp + 8 <= tp + size) {
          const cs = dv.getUint32(cp, true), ct = b[cp + 4];
          if (cs < 8) break;
          if (ct === 1) list = cp + 8;
          cp += cs;
        }
        if (list !== null) for (let i = 0; i < count; i++) {
          const e = list + i * 8, num = b[e], st = b[e + 1], off = dv.getUint32(e + 4, true);
          if (!num || num > spt) continue;
          const idx = track * spt + num - 1;
          if (sectors[idx]) continue;
          const s = new Uint8Array(ss);
          if (!(st & 0x10) && tp + off + ss <= b.length) s.set(b.subarray(tp + off, tp + off + ss));
          sectors[idx] = s;
        }
      }
      tp += size;
    }
    if (!sectors.length) throw new Error('ATX: no sector data found');
    let n = sectors.length;
    for (let i = 0; i < n; i++) if (!sectors[i]) sectors[i] = new Uint8Array(ss);
    return buildAtr(sectors, ss);
  }

  // What copy protection an ATX carries: statuses other than 0, repeated sector numbers, and weak-bit or extended chunks.
  function atxInfo(b) {
    if (b.length < 48 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'AT8X') throw new Error('not an ATX image');
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), r = { badStatus: 0, duplicates: 0, weak: 0, tracks: 0 };
    let tp = dv.getUint32(0x1c, true);
    while (tp + 32 <= b.length) {
      const size = dv.getUint32(tp, true);
      if (size < 32) break;
      if (dv.getUint16(tp + 4, true) === 0) {
        r.tracks++;
        const count = dv.getUint16(tp + 10, true), hs = dv.getUint32(tp + 20, true), seen = new Set();
        for (let cp = tp + hs; cp + 8 <= tp + size;) {
          const cs = dv.getUint32(cp, true), ct = b[cp + 4];
          if (cs < 8) break;
          if (ct === 1) for (let i = 0; i < count; i++) {
            const e = cp + 8 + i * 8;
            if (b[e + 1]) r.badStatus++;
            if (seen.has(b[e])) r.duplicates++; else seen.add(b[e]);
          }
          if (ct === 0x10) r.weak++;
          cp += cs;
        }
      }
      tp += size;
    }
    r.protected = !!(r.badStatus || r.duplicates || r.weak);
    return r;
  }

  // Menu boot disk (source: tools/xexboot/menuboot.asm): up to 36 binaries picked with 1-9,0 then A-Z, no DOS needed.
  // Layout: sectors 1-6 loader, 7-13 directory (24-byte entries), programs from sector 14, 128-byte sectors.
  const MENU_LOADER = '0006000706074c0a0700d8a9078d840aa9008d850a8de0028de1028de2028de302a9008d8d0aa90b8d8e0aa9078d900a202d09ad8d0a1869808d8d0a9003ee8e0ace900ad0eaa97f8d4403a9098d4503a916201b09a9008d8f0aa90085e2a90b85e3ad8f0acd0907b04bc9099008f00c1869374c7e071869314c7e07a9308da00aa9208da10aa00fb1e299a20a8810f8a99b8db20aa9a08d4403a90a8d4503a913201b09a5e218691885e29002e6e3ee8f0a4c6207a9038d5203a97c8d5403a9098d5503a9048d5a03a9008d5b03a2102056e4a9078d5203a9008d58038d5903a2102056e4c9619002e920c93090e4c93ab00fc930f00638e9314c0d08a9094c0d08c94190cdc95bb0c938e937cd0907b0c18d8f0aa90c8d5203a2102056e4a90085e2a90b85e3ae8f0af00ea5e218691885e29002e6e3cad0f2a010b1e28d840ac8b1e28d850ac8b1e28d8a0ac8b1e28d8b0ac8b1e28d8c0aa9008d800a8d810a8d820aa9808d830aa9008d8d0aa90a8d8e0aad800acd8a0aad810aed8b0aad820aed8c0ab06520fa088d860a20fa088d870a2d860ac9fff0d920fa088d880a20fa088d890aad860a85e0ad870a85e120fa08a00091e0a5e0cd880ad007a5e1cd890af009e6e0d0e7e6e14cb008ad860ac9e2d09ead870ac902d097ad880ac9e3d09020e9084c73086ce202ade0020de102f0036ce0026c0a00ae830ae0809005202d09a200bd000ae88e830aee800ad008ee810ad003ee820a608d4803a9008d4903a9098d4203a2004c56e4a9318d0003a9018d0103a9528d0203a9408d0303ad8d0a8d0403ad8e0a8d0503a9078d0603a9808d0803a9008d0903ad840a8d0a03ad850a8d0b032059e43009ee840ad003ee850a60ee1ad04c2d094b3a9b415441524943524146542047414d45204d454e559b9b';

  // Plain 8K/16K cartridge (.car or raw .rom) -> Atari binary: ROM copied into RAM at $A000/$8000, BASIC ROM banked out, then the cart's own init and run vectors. Bank-switched carts are not supported.
  function cartToXex(d, viaSlot) {
    let rom = d, type = d.length === 8192 ? 1 : d.length === 16384 ? 2 : 0;
    if (d[0] === 0x43 && d[1] === 0x41 && d[2] === 0x52 && d[3] === 0x54) {
      type = d[7]; rom = d.subarray(16);
      if (type !== 1 && type !== 2) throw new Error('only plain 8K/16K cartridges can go on a menu disk (CAR type ' + type + ')');
    }
    if (!type || rom.length !== (type === 1 ? 8192 : 16384)) throw new Error('not an Atari binary or a plain 8K/16K cartridge');
    const start = 0xc000 - rom.length, run = [rom[rom.length - 6], rom[rom.length - 5]];
    const stub = [0xad, 1, 0xd3, 9, 2, 0x8d, 1, 0xd3, 0x20, 0x0c, 6, 0x60, 0x6c, 0xfe, 0xbf];
    const seg = (a, b) => [a & 255, a >> 8, b & 255, b >> 8];
    // viaSlot: load the ROM, then post 'ACRT'+size at $06F0 and spin; Ataricraft sees it and inserts the real cartridge.
    if (viaSlot) return Uint8Array.from([0xff, 0xff, ...seg(start, 0xbfff), ...rom, ...seg(0x600, 0x602), 0x4c, 0, 6, ...seg(0x6f0, 0x6f4), 0x41, 0x43, 0x52, 0x54, rom.length >> 10, ...seg(0x2e0, 0x2e1), 0, 6]);
    return Uint8Array.from([0xff, 0xff, ...seg(start, 0xbfff), ...rom, ...seg(0x600, 0x60e), ...stub, ...seg(0x2e2, 0x2e3), 0, 6, ...seg(0x2e0, 0x2e1), ...run]);
  }

  // items: [{name, data}] of Atari binaries or plain cartridges -> menu ATR. Names are shown as 16 upper-case characters.
  function menuToAtr(items) {
    if (!items.length || items.length > 36) throw new Error('a menu disk holds 1 to 36 programs');
    items = items.map((it) => (it.data[0] === 0xff && it.data[1] === 0xff ? it : { name: it.name, needsSlot: it.needsSlot, data: (() => { try { return cartToXex(it.data, it.needsSlot); } catch (e) { throw new Error(it.name + ': ' + e.message); } })() }));
    const loader = new Uint8Array(768);
    for (let i = 0; i < MENU_LOADER.length; i += 2) loader[i / 2] = parseInt(MENU_LOADER.substr(i, 2), 16);
    loader[9] = items.length;
    const dir = new Uint8Array(896);
    let sec = 14;
    items.forEach((it, i) => {
      const x = it.data;
      if (x.length < 6 || x[0] !== 0xff || x[1] !== 0xff) throw new Error(it.name + ': not an Atari binary');
      const nm = it.name.replace(/\.[^.]*$/, '').toUpperCase().replace(/[^ -~]/g, ' ').slice(0, it.needsSlot ? 15 : 16).padEnd(15, ' ').padEnd(16, it.needsSlot ? '*' : ' '), o = i * 24;
      for (let k = 0; k < 16; k++) dir[o + k] = nm.charCodeAt(k);
      dir[o + 16] = sec & 255; dir[o + 17] = sec >> 8;
      dir[o + 18] = x.length & 255; dir[o + 19] = (x.length >> 8) & 255; dir[o + 20] = x.length >> 16;
      sec += Math.ceil(x.length / 128);
    });
    const last = sec - 1, nsec = last <= 720 ? 720 : last <= 1040 ? 1040 : last;
    if (nsec > 65535) throw new Error('programs too large for one disk');
    const out = new Uint8Array(16 + nsec * 128);
    out.set(atrHeader(nsec, 128));
    out.set(loader, 16);
    out.set(dir, 16 + 6 * 128);
    sec = 14;
    for (const it of items) { out.set(it.data, 16 + (sec - 1) * 128); sec += Math.ceil(it.data.length / 128); }
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

  return { isAtr, detect, toAtr, dcmToAtr, atrToDcm, proToAtr, atrToPro, xfdToAtr, atrToXfd, xexToAtr, atrToXex, menuToAtr, cartToXex, atxToAtr, atxInfo, buildAtr };
});
