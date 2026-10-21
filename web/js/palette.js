// Approximate NTSC GTIA palette (index = hue<<4 | luminance). Replace with a measured palette later.
window.AC = window.AC || {};
(function () {
  const HUES = [0, 40, 28, 12, 352, 325, 290, 262, 236, 214, 192, 172, 140, 105, 75, 55];

  function hsl(h, s, l) {
    h /= 360;
    const f = (n) => {
      const k = (n + h * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
  }

  AC.makePalette = function () {
    const out = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const hue = i >> 4;
      const lum = i & 15;
      const l = 0.02 + 0.93 * Math.pow(lum / 15, 0.95);
      let r, g, b;
      if (hue === 0) r = g = b = Math.round(l * 255);
      else [r, g, b] = hsl(HUES[hue], 0.62, Math.min(0.95, l * 0.92 + 0.03));
      out[i] = ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }
    return out;
  };
})();
