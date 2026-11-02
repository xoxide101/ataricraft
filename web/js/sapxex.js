// Turns a parsed SAP file (AC.Pmd.parseSap) into an Atari executable (.XEX) that plays it on a real or emulated Atari.
// The SAP blocks are loaded as they are. A small stub then calls INIT (type B) or the CMC player setup (type C), and installs a
// deferred vertical-blank handler (SETVBV, $E45C) that calls PLAYER once per frame, as SAP players do.
// Not supported: types D, S, R, COVOX, and FASTPLAY values that do not divide the frame (an even divisor up to 255 scanlines gives several calls per frame).
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { root.AC = root.AC || {}; root.AC.SapXex = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  const hex = (v) => parseInt(v, 16);

  function build(sap, opt = {}) {
    const type = (sap.get('TYPE') || 'B').toUpperCase();
    if (type !== 'B' && type !== 'C') throw new Error(`SAP type ${type} is not supported yet (only B and C).`);
    const player = sap.get('PLAYER') !== undefined ? hex(sap.get('PLAYER')) : null;
    if (player === null) throw new Error('This SAP file has no PLAYER address.');
    const init = type === 'B' ? hex(sap.get('INIT')) : 0, music = type === 'C' ? hex(sap.get('MUSIC')) : 0;
    if (type === 'B' && Number.isNaN(init)) throw new Error('This SAP file has no INIT address.');
    if (type === 'C' && Number.isNaN(music)) throw new Error('This SAP file has no MUSIC address.');
    const songs = +(sap.get('SONGS') || 1), song = opt.song !== undefined ? opt.song : +(sap.get('DEFSONG') || 0);
    if (song < 0 || song >= songs) throw new Error(`Subsong ${song} does not exist (the file has ${songs}).`);
    const warnings = [], ntsc = sap.fields.some((f) => f.key === 'NTSC');
    const frame = ntsc ? 262 : 312, fast = +(sap.get('FASTPLAY') || frame);
    let calls = 1;
    if (fast !== frame) {
      if (fast > 0 && fast <= 255 && frame % fast === 0) calls = frame / fast;
      else warnings.push(`FASTPLAY ${fast} does not divide the frame evenly; PLAYER is called once per frame, so the tempo will be wrong.`);
    }
    const stereo = sap.fields.some((f) => f.key === 'STEREO');
    if (stereo) warnings.push('Stereo (SAPX2) file: turn Stereo on in Ataricraft before booting it, so the second POKEY at $D210 is heard.');
    if (sap.fields.some((f) => f.key === 'COVOX')) warnings.push('COVOX is not played.');
    warnings.push(`The file expects ${ntsc ? 'NTSC' : 'PAL'}; the emulator should be set to the same.`);

    const used = new Array(256).fill(false);
    for (const b of sap.blocks) {
      if (b.truncated) throw new Error('The SAP file is truncated.');
      if (b.start <= 0x2E3 && b.end >= 0x2E0) throw new Error('A block overlaps $02E0-$02E3 (the Atari run and init addresses).');
      for (let p = b.start >> 8; p <= b.end >> 8; p++) used[p] = true;
    }
    let page = -1;
    for (let p = 0xBC; p >= 0x06; p--) if (!used[p]) { page = p; break; }
    if (page < 0) throw new Error('No free page of memory for the player stub.');
    const S = page << 8;
    const code = [];
    if (type === 'C') code.push(0xA9, 0x70, 0xA2, music & 255, 0xA0, music >> 8, 0x20, (player + 3) & 255, (player + 3) >> 8, 0xA9, 0, 0xA2, song, 0x20, (player + 3) & 255, (player + 3) >> 8);
    else code.push(0xA9, song, 0x20, init & 255, init >> 8);
    const pre = code.length, vb = S + pre + 12, call = type === 'C' ? player + 6 : player;
    code.push(0xA9, 6, 0xA0, vb & 255, 0xA2, vb >> 8, 0x20, 0x5C, 0xE4, 0x4C, (S + pre + 9) & 255, (S + pre + 9) >> 8);
    for (let k = 0; k < calls; k++) { if (k) code.push(0xA2, fast, 0x8D, 0x0A, 0xD4, 0xCA, 0xD0, 0xFA); code.push(0x20, call & 255, call >> 8); }
    code.push(0x4C, 0x62, 0xE4);

    const out = [0xFF, 0xFF], seg = (a, d) => { out.push(a & 255, a >> 8, (a + d.length - 1) & 255, (a + d.length - 1) >> 8); for (const x of d) out.push(x); };
    for (const b of sap.blocks) seg(b.start, b.data);
    seg(S, code); seg(0x2E0, [S & 255, S >> 8]);
    return { xex: new Uint8Array(out), stub: S, warnings, type, song, stereo };
  }
  return { build };
});
