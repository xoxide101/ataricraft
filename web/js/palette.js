// GTIA/CTIA palette generator (index = hue<<4 | luminance), ported from the model in cyco130/sfotty-pie
// (packages/a8/src/palette.ts, apps/a8-web/src/display-settings.ts): NTSC = YIQ decode, PAL = YUV decode,
// with tint (hue 1 angle), colour-pot hue step, saturation, brightness, contrast, gamma and a
// phosphor-primaries correction (None / SMPTE-C / NTSC 1953 / EBU).
window.AC = window.AC || {};
(function () {
  const NTSC = { hue1Angle: 303, hueStep: 360 / 14, matrix: [[0.9563, 0.621], [-0.2721, -0.6474], [-1.107, 1.7046]] };
  const PAL = { hue1Angle: 135, hueStep: 22.5, matrix: [[0, 1.13983], [-0.39465, -0.5806], [2.03211, 0]] };
  const PAL_TAPS = [0, 1, 2, 3, 4, 5, 7, 0, 1, 2, 4, 5, 6, 7, 0];
  const PAL_INV = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0];
  const base = { saturation: 0.25, brightness: 0, contrast: 1, gamma: 1 };

  AC.PALETTE_PRESETS = {
    ntsc: [
      ['vintage', 'Vintage', { ...base, hue1Angle: 327, hueStep: 360 / 14, primaries: 'smpteC' }],
      ['modern', 'Modern', { ...base, hue1Angle: 303, hueStep: 360 / 14, primaries: 'smpteC' }],
      ['hues15', '15 hues', { ...base, hue1Angle: 340, hueStep: 24, primaries: 'smpteC' }],
    ],
    pal: [
      ['calibrated', 'Calibrated', { ...base, hue1Angle: 135, hueStep: 22.5, primaries: 'ebu' }],
      ['bluegr0', 'Blue GR.0', { ...base, hue1Angle: 154, hueStep: 23, primaries: 'ebu' }],
    ],
  };
  AC.PALETTE_PRIMARIES = [['srgb', 'None'], ['smpteC', 'SMPTE-C'], ['ntsc1953', 'NTSC 1953'], ['ebu', 'EBU (PAL)']];

  const D65 = [0.3127, 0.329];
  const CHROMA = {
    srgb: { r: [0.64, 0.33], g: [0.3, 0.6], b: [0.15, 0.06], w: D65 },
    ntsc1953: { r: [0.67, 0.33], g: [0.21, 0.71], b: [0.14, 0.08], w: [0.31006, 0.31616] },
    smpteC: { r: [0.63, 0.34], g: [0.31, 0.595], b: [0.155, 0.07], w: D65 },
    ebu: { r: [0.64, 0.33], g: [0.29, 0.6], b: [0.15, 0.06], w: D65 },
  };
  const BRADFORD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];

  const mul = (a, b) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));
  const mulVec = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  const invert = (m) => {
    const [[a, b, c], [d, e, f], [g, h, i]] = m, A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
    return [[A / det, (c * h - b * i) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, (c * d - a * f) / det], [C / det, (b * g - a * h) / det, (a * e - b * d) / det]];
  };
  const xyz = ([x, y]) => [x / y, 1, (1 - x - y) / y];
  const rgbToXyz = (c) => {
    const r = xyz(c.r), g = xyz(c.g), b = xyz(c.b);
    const s = mulVec(invert([[r[0], g[0], b[0]], [r[1], g[1], b[1]], [r[2], g[2], b[2]]]), xyz(c.w));
    return [[r[0] * s[0], g[0] * s[1], b[0] * s[2]], [r[1] * s[0], g[1] * s[1], b[1] * s[2]], [r[2] * s[0], g[2] * s[1], b[2] * s[2]]];
  };
  const adapt = (from, to) => {
    const s = mulVec(BRADFORD, xyz(from)), d = mulVec(BRADFORD, xyz(to));
    return mul(invert(BRADFORD), mul([[d[0] / s[0], 0, 0], [0, d[1] / s[1], 0], [0, 0, d[2] / s[2]]], BRADFORD));
  };
  const conversion = (from, to) => mul(invert(rgbToXyz(to)), mul(adapt(from.w, to.w), rgbToXyz(from)));
  const clamp = (v) => Math.max(0, Math.min(1, v));

  // tv: 'ntsc' | 'pal'; o: palette options (missing fields fall back to the standard's defaults).
  AC.buildPalette = function (tv, o, out) {
    const D = tv === 'pal' ? PAL : NTSC;
    o = { ...base, hue1Angle: D.hue1Angle, hueStep: D.hueStep, primaries: 'srgb', ...o };
    out = out || new Uint32Array(256);
    const corr = o.primaries === 'srgb' ? null : conversion(CHROMA[o.primaries] || CHROMA.srgb, CHROMA.srgb), ig = 1 / o.gamma;
    const ch = (v) => { v = clamp(v); return Math.round((ig === 1 ? v : Math.pow(v, ig)) * 255); };
    for (let i = 0; i < 256; i++) {
      const hue = i >> 4, y = ((i & 15) / 15 - 0.5) * o.contrast + 0.5 + o.brightness;
      let c1 = 0, c2 = 0;
      if (hue > 0) {
        const ang = ((tv === 'pal' ? o.hue1Angle - PAL_TAPS[hue - 1] * o.hueStep - PAL_INV[hue - 1] * 180 : o.hue1Angle + (hue - 1) * o.hueStep) * Math.PI) / 180;
        c1 = o.saturation * Math.cos(ang); c2 = o.saturation * Math.sin(ang);
      }
      let [r, g, b] = D.matrix.map((m) => y + m[0] * c1 + m[1] * c2);
      if (corr) {
        const lin = mulVec(corr, [Math.pow(clamp(r), 2.2), Math.pow(clamp(g), 2.2), Math.pow(clamp(b), 2.2)]);
        [r, g, b] = lin.map((v) => Math.pow(clamp(v), 1 / 2.2));
      }
      out[i] = (0xff000000 | (ch(b) << 16) | (ch(g) << 8) | ch(r)) >>> 0;
    }
    return out;
  };
})();
