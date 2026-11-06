// Frame-exact capture for ACWriter: pause the emulator, hold a key, step one frame at a time and diff the canvas after every frame.
// Regions are Atari scanline bands (y in 0..191, x in 0..319); the canvas origin offset is calibrated from the layout.
const L = require('./acwriter-cursor-lib.cjs');

// installs window.__cap(steps) in the page: returns per-frame {ink[], changed[]} for the bands
async function install(p) {
  await p.evaluate(() => {
    window.__ox = null;
    window.__grab = () => {
      const c = document.querySelector('canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, o = new Uint8Array(c.width * c.height);
      for (let i = 0; i < o.length; i++) o[i] = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] < 330 ? 1 : 0;
      return { w: c.width, h: c.height, a: o };
    };
    // bands: [name, y0, y1) in Atari scanlines; ox/oy = canvas offset of Atari pixel (0,0)
    window.__cap = (n, bands, ox, oy, prev0) => {
      const out = []; let prev = prev0 || window.__grab();
      for (let f = 0; f < n; f++) {
        ataricraft.step(1);
        const g = window.__grab(), r = { f, chg: bands.map(() => 0), ink: bands.map(() => 0), box: bands.map(() => null), tot: 0 };
        for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
          const i = y * g.w + x, ay = y - oy, ax = x - ox;
          const bi = bands.findIndex((b) => ay >= b[1] && ay < b[2]);
          if (bi >= 0 && ax >= 0 && ax < 320 && g.a[i]) r.ink[bi]++;
          if (g.a[i] !== prev.a[i]) {
            r.tot++;
            if (bi >= 0) { r.chg[bi]++; const b = r.box[bi]; if (!b) r.box[bi] = [ax, ay, ax, ay]; else { b[0] = Math.min(b[0], ax); b[1] = Math.min(b[1], ay); b[2] = Math.max(b[2], ax); b[3] = Math.max(b[3], ay); } }
          }
        }
        out.push(r); prev = g;
      }
      window.__last = prev;
      return out;
    };
  });
}
module.exports = { install };
