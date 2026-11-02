// Turns an RMT module into a SAP (type B) by running AC.Rmt and storing the POKEY writes as a delta stream
// that a ~80 byte 6502 routine replays. Needs AC.Rmt, AC.Asm and AC.Pmd. The SAP then goes through AC.SapXex for an XEX.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./rmtplay.js'), require('./asm6502.js'), require('./pmd.js'));
  else root.AC = Object.assign(root.AC || {}, { RmtSap: factory(root.AC.Rmt, root.AC.Asm, root.AC.Pmd) });
})(typeof self !== 'undefined' ? self : this, function (Rmt, Asm, Pmd) {
  'use strict';
  const DATA = 0x2000, LIMIT = 0xD000;

  // Runs the player; returns per-frame register arrays plus where the song loops back to (or -1).
  function render(m, opt) {
    const pl = Rmt.player(m, { songline: opt.songline | 0 }), max = opt.maxFrames || 50 * 60 * 10;
    const frames = [], seen = new Map();
    let last = -1, loop = -1;
    for (let n = 0; n < max; n++) {
      const out = pl.play().pokey, regs = [];
      for (const p of out) { for (let c = 0; c < 4; c++) regs.push(p.audf[c], p.audc[c]); regs.push(p.audctl); }
      frames.push(regs);
      const ls = pl.state.lineStart;
      if (ls !== last) {
        last = ls;
        if (seen.has(ls)) { loop = seen.get(ls) + 1; break; }
        seen.set(ls, n);
      }
    }
    return { frames, loop };
  }

  function encode(frames, loop, nreg) {
    const mb = nreg > 16 ? 3 : 2, out = [], starts = [];
    let prev = null;
    frames.forEach((f, i) => {
      starts.push(out.length);
      const full = i === 0 || i === loop || !prev;
      let mask = 0; const vals = [];
      for (let r = 0; r < nreg; r++) if (full || f[r] !== prev[r]) { mask |= 1 << r; vals.push(f[r]); }
      for (let b = 0; b < mb; b++) out.push((mask >> (8 * b)) & 255);
      out.push(...vals); prev = f;
    });
    return { bytes: out, mb, loopOffset: loop >= 0 ? starts[loop] : 0 };
  }

  function player(nreg, mb, end, loopAddr) {
    const rtab = []; for (let r = 0; r < nreg; r++) rtab.push(r < 9 ? r : 0x10 + r - 9);
    const stereo = nreg > 9;
    const src = `
ptr = $E0
m0 = $E2
m1 = $E3
m2 = $E4
        org $0600
init    lda #<${DATA}
        sta ptr
        lda #>${DATA}
        sta ptr+1
        lda #0
        sta $D208
        lda #3
        sta $D20F
${stereo ? '        lda #0\n        sta $D218\n        lda #3\n        sta $D21F\n' : ''}        rts
play    lda ptr+1
        cmp #>${end}
        bne go
        lda ptr
        cmp #<${end}
        bne go
        lda #<${loopAddr}
        sta ptr
        lda #>${loopAddr}
        sta ptr+1
go      ldy #0
        lda (ptr),y
        sta m0
        iny
        lda (ptr),y
        sta m1
${mb === 3 ? '        iny\n        lda (ptr),y\n        sta m2\n' : '        lda #0\n        sta m2\n'}        lda ptr
        clc
        adc #${mb}
        sta ptr
        bcc nc
        inc ptr+1
nc      ldx #0
nx      lsr m2
        ror m1
        ror m0
        bcc sk
        ldy #0
        lda (ptr),y
        ldy rtab,x
        sta $D200,y
        inc ptr
        bne sk
        inc ptr+1
sk      inx
        cpx #${nreg}
        bne nx
        rts
rtab    .byte ${rtab.join(',')}
`;
    const r = Asm.assemble(src);
    return { segments: r.segments, init: r.symbols.init, play: r.symbols.play };
  }

  // rmtBytes: a binary-load .rmt file. opt: pal (default true), name, author, songline, maxFrames.
  function build(rmtBytes, opt) {
    opt = opt || {};
    const m = Rmt.load(rmtBytes), r = render(m, opt), nreg = m.stereo ? 18 : 9;
    const enc = encode(r.frames, r.loop, nreg), end = DATA + enc.bytes.length;
    if (end > LIMIT) throw new Error(`Register stream is ${enc.bytes.length} bytes (max ${LIMIT - DATA}). The song is too long to store as a stream.`);
    const pl = player(nreg, enc.mb, end, DATA + enc.loopOffset);
    const bin = [];
    const seg = (addr, bytes) => { const e = addr + bytes.length - 1; bin.push(addr & 255, addr >> 8, e & 255, e >> 8); for (const b of bytes) bin.push(b); };
    bin.push(0xFF, 0xFF);
    for (const s of pl.segments) seg(s.addr, s.bytes);
    seg(DATA, enc.bytes);
    const pal = opt.pal !== false, hx = (n) => n.toString(16).toUpperCase().padStart(4, '0');
    const fields = [{ key: 'AUTHOR', value: opt.author || '' }, { key: 'NAME', value: opt.name || 'RMT export' }, { key: 'DATE', value: '' },
      { key: 'TYPE', value: 'B' }, { key: 'FASTPLAY', value: pal ? '312' : '262' }, { key: 'INIT', value: hx(pl.init) }, { key: 'PLAYER', value: hx(pl.play) }];
    if (!pal) fields.push({ key: 'NTSC', value: '' });
    if (m.stereo) fields.push({ key: 'STEREO', value: '' });
    return { sap: Pmd.buildSap(fields, new Uint8Array(bin)), frames: r.frames.length, loop: r.loop, streamBytes: enc.bytes.length, stereo: m.stereo, tracks: m.tracks, seconds: r.frames.length / (pal ? 50 : 60) };
  }

  return { build, render };
});
