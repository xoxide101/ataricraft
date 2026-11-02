/*
 * RMT module player (JavaScript port of the Raster Music Tracker 1.x player routine).
 *
 * Derived from "Raster Music Tracker, RMT Atari routine version 1.20090108"
 * (c) Radek Sterba, Raster/C.P.U., 2002 - 2009, which is licensed under GPL-3.0.
 * This file is therefore GPL-3.0 as well; see LICENSE-GPL-3.0-RMT.txt.
 *
 * It follows the original routine step by step, with every FEAT_ option enabled, so a module that
 * plays in the original plays here. It produces POKEY register values; it does not make sound.
 *
 *   const m = AC.Rmt.load(bytes);             // parse a .rmt file (binary load segments)
 *   const p = AC.Rmt.player(m, { songline: 0 });
 *   const regs = p.play();                    // call once per instrument-speed tick; returns the registers to write
 *   // regs: { pokey: [ {audf:[4], audc:[4], audctl}, ... ] }  (2 entries for RMT8)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.AC = root.AC || {}; root.AC.Rmt = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Frequency tables from the original player: 64 notes each (note 60-63 use entry 63).
  const BASS1 = [
    191, 182, 170, 161, 152, 143, 137, 128, 242, 230, 218, 206, 191, 182, 170, 161,
    152, 143, 137, 128, 122, 113, 107, 101, 95, 92, 86, 80, 77, 71, 68, 62,
    60, 56, 53, 50, 47, 45, 42, 40, 37, 35, 33, 31, 29, 28, 26, 24,
    23, 22, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7,
  ];
  const BASS2 = [
    255, 241, 228, 216, 202, 192, 181, 171, 162, 153, 142, 135, 127, 121, 115, 112,
    102, 97, 90, 85, 82, 75, 72, 67, 63, 60, 57, 55, 51, 48, 45, 42,
    40, 37, 36, 33, 31, 30, 28, 27, 25, 23, 22, 21, 19, 18, 17, 16,
    15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
  ];
  const PURE = [
    243, 230, 217, 204, 193, 181, 173, 162, 153, 144, 136, 128, 121, 114, 108, 102,
    96, 91, 85, 81, 76, 72, 68, 64, 60, 57, 53, 50, 47, 45, 42, 40,
    37, 35, 33, 31, 29, 28, 26, 24, 23, 22, 20, 19, 18, 17, 16, 15,
    14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0,
  ];
  const BASSLO = [
    242, 51, 150, 226, 56, 140, 0, 106, 232, 106, 239, 128, 8, 174, 70, 230,
    149, 65, 246, 176, 110, 48, 246, 187, 132, 82, 34, 244, 200, 160, 122, 85,
    52, 20, 245, 216, 189, 164, 141, 119, 96, 78, 56, 39, 21, 6, 247, 232,
    219, 207, 195, 184, 172, 162, 154, 144, 136, 127, 120, 112, 106, 100, 94, 0,
  ];
  const BASSHI = [
    13, 13, 12, 11, 11, 10, 10, 9, 8, 8, 7, 7, 7, 6, 6, 5,
    5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2,
    2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ];
  const FRQ = BASS1.concat(BASS2, PURE);

  const VIB0 = [0, 1, 255, 255, 1, 1, 0, 255, 255, 0, 1, 1, 1, 0, 255, 255, 255, 255, 0, 1, 1];
  const VIBBEG = [0, 1, 5, 11];
  const VIBNEXT = [0, 2, 3, 4, 1, 6, 7, 8, 9, 10, 5, 12, 13, 14, 15, 16, 17, 18, 19, 20, 11];
  const DIST = [[128, 0x00], [128, 0x20], [128, 0x40], [0, 0xC0], [128, 0x80], [128, 0xA0], [0, 0xC0], [64, 0xC0]];
  const INSTRPAR = 12;
  const VOLTAB = new Uint8Array(256);
  for (let v = 0; v < 16; v++) for (let n = 0; n < 16; n++) VOLTAB[v * 16 + n] = Math.round(v * n / 15);

  // Parses the binary load file; returns a 64K image with the module in place and where it starts.
  function load(bytes) {
    const mem = new Uint8Array(65536);
    let p = 0, base = -1, first = true;
    while (p + 4 <= bytes.length) {
      if (bytes[p] === 0xFF && bytes[p + 1] === 0xFF) p += 2;
      const s = bytes[p] | bytes[p + 1] << 8, e = bytes[p + 2] | bytes[p + 3] << 8;
      p += 4;
      const n = e - s + 1;
      if (n <= 0 || p + n > bytes.length) throw new Error('RMT file: bad segment');
      mem.set(bytes.subarray(p, p + n), s);
      if (first) { base = s; first = false; }
      p += n;
    }
    return fromImage(mem, base);
  }

  function fromImage(mem, base) {
    const sig = String.fromCharCode(mem[base], mem[base + 1], mem[base + 2], mem[base + 3]);
    if (sig !== 'RMT4' && sig !== 'RMT8') throw new Error('Not an RMT module (header "' + sig + '")');
    const w = (a) => mem[a] | mem[a + 1] << 8;
    const m = {
      mem, base, tracks: sig === 'RMT8' ? 8 : 4, stereo: sig === 'RMT8',
      trackLen: mem[base + 4] || 256, speed: mem[base + 5], instrSpeed: mem[base + 6], version: mem[base + 7],
      pInstr: w(base + 8), pTrkLo: w(base + 10), pTrkHi: w(base + 12), pSong: w(base + 14),
    };
    if (m.version !== 1 && m.version !== 2) throw new Error('Unsupported RMT format version ' + m.version);
    if (!m.instrSpeed) throw new Error('RMT module has instrument speed 0');
    // The song table runs up to the first track pointer table above it; the module's end address bounds it.
    m.songLines = 0;
    return m;
  }

  function player(m, opt) {
    opt = opt || {};
    const mem = m.mem, TR = m.tracks, MAXLEN = m.trackLen & 255;
    const z = () => new Array(TR).fill(0);
    const s = {
      tdb: z(), idx: z(), pause: z(), note: z(), volume: z(), shiftfrq: z(),
      portafrqc: z(), portafrqa: z(), portaspeed: z(), portaspeeda: z(), portadepth: z(),
      instrx2: z(), iptr: z(), instridx: z(), instrlen: z(), instrlop: z(), reachend: z(),
      vsdepth: z(), vsvalue: z(), vmin: z(), effdelay: z(), vibra: z(), effshift: z(),
      ttspeed: z(), tmode: z(), tnote: z(), tablea: z(), tableend: z(), tablelop: z(), tspeeda: z(),
      command: z(), outnote: z(), filter: z(), audf: z(), audc: z(), audctl: z(),
    };
    let speed = m.speed, bspeed = 0, aspeed = 0, abeat = 0, ainstr = m.instrSpeed, psong = m.pSong;
    let audctl1 = 0, audctl2 = 0;
    const g = (a) => mem[a & 0xFFFF];
    const w = (a) => g(a) | g(a + 1) << 8;

    psong = (m.pSong + (opt.songline | 0) * TR) & 0xFFFF;

    function getSongLine() {
      abeat = 0;
      for (;;) {
        let x = 0, jumped = false;
        for (; x < TR; x++) {
          const b = g(psong + x);
          if (b >= 0xFE) {
            if (b === 0xFE) { psong = w(psong + 2); jumped = true; break; }
            s.pause[x] = 0; s.instrx2[x] = 0x80;
            continue;
          }
          s.tdb[x] = g(m.pTrkLo + b) | g(m.pTrkHi + b) << 8;
          s.idx[x] = 0; s.pause[x] = 1; s.instrx2[x] = 0x80;
        }
        if (jumped) continue;
        s.lineStart = psong;
        psong = (psong + TR) & 0xFFFF;
        return getTrackLine();
      }
    }

    function getTrackLine() {
      bspeed = speed;
      for (let x = 0; x < TR; x++) {
        s.pause[x] = (s.pause[x] - 1) & 255;
        if (s.pause[x] !== 0) continue;
        for (;;) {
          const ns = s.tdb[x], y = s.idx[x];
          s.idx[x] = (y + 1) & 255;
          const b0 = g(ns + y), n = b0 & 0x3F;
          if (n < 62) {
            if (n < 61) {
              s.note[x] = n; s.outnote[x] = n;
              s.instrx2[x] = (g(ns + y + 1) >> 1) & 0x7E;
            }
            const b1 = g(ns + s.idx[x]);
            s.idx[x] = (s.idx[x] + 1) & 255;
            s.pause[x] = 1;
            s.volume[x] = (((b1 & 3) << 6 | b0 >> 2) & 0xF0);
            break;
          }
          if (n === 62) {
            const t = b0 & 0xC0;
            if (t === 0) { s.pause[x] = g(ns + y + 1); s.idx[x] = (s.idx[x] + 1) & 255; }
            else s.pause[x] = t >> 6;
            break;
          }
          if (!(b0 & 0x80)) { bspeed = g(ns + y + 1); s.idx[x] = (s.idx[x] + 1) & 255; continue; }
          if (b0 === 0xFF) return getSongLine();
          s.idx[x] = g(ns + y + 1);
        }
      }
      speed = bspeed; aspeed = bspeed;
      initNewInstruments();
    }

    function initNewInstruments() {
      for (let x = TR - 1; x >= 0; x--) if (!(s.instrx2[x] & 0x80)) setUpInstrument(x, s.instrx2[x]);
      p3();
    }

    function setUpInstrument(x, y2) {
      const nt = w(m.pInstr + y2);
      s.iptr[x] = nt;
      s.filter[x] = 1;
      s.tablelop[x] = g(nt + 1);
      s.instrlen[x] = g(nt + 2);
      s.instrlop[x] = g(nt + 3);
      const t = g(nt + 4);
      s.ttspeed[x] = t; s.tspeeda[x] = t & 0x3F; s.tmode[x] = t & 0x40;
      s.audctl[x] = g(nt + 5);
      s.vsdepth[x] = g(nt + 6);
      s.vmin[x] = g(nt + 7);
      s.effdelay[x] = g(nt + 8);
      s.vibra[x] = VIBBEG[g(nt + 9) & 3];
      s.effshift[x] = g(nt + 10);
      s.vsvalue[x] = 128; s.instrx2[x] = 0x80; s.reachend[x] = 0; s.shiftfrq[x] = 0;
      s.tableend[x] = g(nt);
      s.instridx[x] = (g(nt) + 1) & 255;
      s.tablea[x] = INSTRPAR;
      s.tnote[x] = g(nt + INSTRPAR);
    }

    function p3() {
      for (let x = TR - 1; x >= 0; x--) {
        const nt = s.iptr[x];
        if ((nt >> 8) === 0) continue;
        let y = s.instridx[x];
        const reg1 = g(nt + y), reg2 = g(nt + y + 1), reg3 = g(nt + y + 2);
        y = (y + 3) & 255;
        if (y <= s.instrlen[x]) s.instridx[x] = y;
        else { s.reachend[x] = 0x80; s.instridx[x] = s.instrlop[x]; }
        let vn = reg1;
        if (TR > 4 && x >= 4) vn >>= 4;
        const vol = VOLTAB[((vn & 0x0F) | s.volume[x]) & 255];
        const d = DIST[(reg2 & 0x0E) >> 1], nr = d[0];
        s.audc[x] = vol | d[1];

        if (s.effdelay[x] !== 0) {
          if (s.effdelay[x] === 1) {
            const vi = s.vibra[x];
            s.shiftfrq[x] = (s.shiftfrq[x] + s.effshift[x] + VIB0[vi]) & 255;
            s.vibra[x] = VIBNEXT[vi];
          } else s.effdelay[x]--;
        }

        if (s.tableend[x] >= INSTRPAR + 1) {
          let a = s.tspeeda[x];
          if (a & 0x80) {
            if (s.tableend[x] === s.tablea[x]) s.tablea[x] = s.tablelop[x];
            else s.tablea[x] = (s.tablea[x] + 1) & 255;
            let v = g(nt + s.tablea[x]);
            if (s.tmode[x]) v = (v + s.tnote[x]) & 255;
            s.tnote[x] = v;
            a = s.ttspeed[x] & 0x3F;
          }
          s.tspeeda[x] = (a - 1) & 255;
        }

        if (s.reachend[x] & 0x80) {
          const v = s.volume[x];
          if (v !== 0 && v > s.vmin[x]) {
            const sum = s.vsvalue[x] + s.vsdepth[x];
            s.vsvalue[x] = sum & 255;
            if (sum > 255) s.volume[x] = (v - 16) & 255;
          }
        }

        let frqadd2 = 0, A, audfDone = false;
        s.command[x] = reg2;
        const cmd = (reg2 & 0x70) >> 4;
        const frq = (i) => FRQ[(nr + (i & 63))];
        switch (cmd) {
          case 0: A = (s.note[x] + reg3) & 255; break;
          case 1: s.audf[x] = reg3; audfDone = true; break;
          case 2: frqadd2 = reg3; A = s.note[x]; break;
          case 3: s.note[x] = (s.note[x] + reg3) & 255; A = s.note[x]; break;
          case 4: s.shiftfrq[x] = (s.shiftfrq[x] + reg3) & 255; A = s.note[x]; break;
          case 5: {
            let v;
            if (s.ttspeed[x] & 0x80) v = (frq(s.note[x]) + s.tnote[x]) & 255;
            else { let i = (s.note[x] + s.tnote[x]) & 255; if (i >= 61) i = 63; v = frq(i); }
            s.portafrqc[x] = v;
            if (reg3 === 0) s.portafrqa[x] = v;
            s.portaspeed[x] = reg3 >> 4; s.portaspeeda[x] = reg3 >> 4;
            s.portadepth[x] = reg3 & 0x0F;
            A = s.note[x];
            break;
          }
          case 6: s.filter[x] = (s.filter[x] + reg3) & 255; A = s.note[x]; break;
          default:
            if (reg3 === 0x80) { s.audc[x] |= 0xF0; A = s.note[x]; }
            else { s.note[x] = reg3; A = reg3; }
        }
        if (!audfDone) {
          if (!(s.ttspeed[x] & 0x80)) {
            A = (A + s.tnote[x]) & 255;
            if (A >= 61) { s.audc[x] = 0; A = 63; }
            s.outnote[x] = A;
            s.audf[x] = (frq(A) + s.shiftfrq[x] + frqadd2) & 255;
          } else {
            if (A >= 61) { s.audc[x] = 0; A = 63; }
            s.audf[x] = (s.shiftfrq[x] + s.tnote[x] + frq(A) + frqadd2) & 255;
          }
        }

        if (s.portaspeeda[x] !== 0) {
          s.portaspeeda[x]--;
          if (s.portaspeeda[x] === 0) {
            s.portaspeeda[x] = s.portaspeed[x];
            const f = s.portafrqa[x], c = s.portafrqc[x];
            if (f !== c) {
              let nf;
              if (f < c) { nf = f + s.portadepth[x]; if (nf > 255 || nf >= c) nf = c; }
              else { nf = f - s.portadepth[x]; if (nf < 0 || nf < c) nf = c; }
              s.portafrqa[x] = nf;
            }
          }
        }
        if (reg2 & 1) s.audf[x] = (s.portafrqa[x] + s.shiftfrq[x]) & 255;
      }
      combine();
    }

    // Filters and 16-bit bass for one POKEY (tracks o..o+3); returns its AUDCTL.
    function combinePokey(o) {
      let ctl = s.audctl[o] | s.audctl[o + 1] | s.audctl[o + 2] | s.audctl[o + 3];
      const base = ctl;
      const clr = (t) => { if (!(s.audc[t] & 0x10)) s.audc[t] = 0; };
      if ((s.command[o] & 0x80) && (s.audc[o] & 0x0F)) {
        s.audf[o + 2] = (s.audf[o] + s.filter[o]) & 255; clr(o + 2); ctl |= 4;
      }
      if ((s.command[o + 1] & 0x80) && (s.audc[o + 1] & 0x0F)) {
        s.audf[o + 3] = (s.audf[o + 1] + s.filter[o + 1]) & 255; clr(o + 3); ctl |= 2;
      }
      if (ctl === base) {
        if (((s.command[o + 1] & 0x0E) === 6) && (s.audc[o + 1] & 0x0F)) {
          const y = s.outnote[o + 1] & 63;
          s.audf[o] = BASSLO[y]; s.audf[o + 1] = BASSHI[y]; clr(o); ctl |= 0x50;
        }
        if (((s.command[o + 3] & 0x0E) === 6) && (s.audc[o + 3] & 0x0F)) {
          const y = s.outnote[o + 3] & 63;
          s.audf[o + 2] = BASSLO[y]; s.audf[o + 3] = BASSHI[y]; clr(o + 2); ctl |= 0x28;
        }
      }
      return ctl & 255;
    }

    function combine() {
      audctl1 = combinePokey(0);
      if (TR > 4) audctl2 = combinePokey(4);
    }

    function snapshot() {
      const one = (o, ctl) => ({ audf: s.audf.slice(o, o + 4), audc: s.audc.slice(o, o + 4), audctl: ctl });
      return { pokey: TR > 4 ? [one(0, audctl1), one(4, audctl2)] : [one(0, audctl1)] };
    }

    function init() {
      getSongLine();
    }

    // One player call: writes last tick's registers, then advances. Returns the registers to write.
    function play() {
      const out = snapshot();
      ainstr--;
      if (ainstr === 0) {
        ainstr = m.instrSpeed;
        aspeed = (aspeed - 1) & 255;
        if (aspeed === 0) {
          abeat = (abeat + 1) & 255;
          if (abeat === MAXLEN) getSongLine(); else getTrackLine();
          return out;
        }
      }
      p3();
      return out;
    }

    init();
    return { play, state: s, module: m };
  }

  return { load, fromImage, player };
});
