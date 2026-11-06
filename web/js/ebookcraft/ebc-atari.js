// EBC.atari - Atari output: 4x7-font text pages, GR.8 / GR.15 / GR.9 screen packers, boot ATR and XEX page viewers, DOS 2 text disk.
// Page geometry (all modes): 192 lines x 40 bytes = 7680 bytes of ANTIC mode F/E memory. Pixels per line: 320 (1-bit), 160 (4 gray), 80 (16 gray).
(function (G) {
  'use strict';
  const EBC = (G.EBC = G.EBC || {});
  const B = EBC.base;
  const W = 320, H = 192, PAGE = 7680, SECT = 128, PAGE_SECT = 60;
  const MODES = {
    gr8: { id: 0, w: 320, levels: 2, name: 'GR.8 1-bit 320x192' },
    gr15: { id: 1, w: 160, levels: 4, name: 'GR.15 4-gray 160x192' },
    gr9: { id: 2, w: 80, levels: 16, name: 'GR.9 16-gray 80x192' },
  };

  function font4() {
    if (G.XCW_DATA && G.XCW_DATA.font4) return G.XCW_DATA.font4;
    if (!font4.c) font4.c = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', '..', 'tools', 'acwriter', 'font4.json'), 'utf8'));
    return font4.c;
  }

  // Draw ASCII lines with the ACWriter 4x7 font (64 columns x 20 rows, 5x8 px cells) into a 320x192 gray image.
  // opt: header (string drawn inverted in the top 8 px bar), invert (white on black).
  function textPage(lines, opt = {}) {
    const F = font4(), g = new Uint8Array(W * H).fill(opt.invert ? 0 : 255), ink = opt.invert ? 255 : 0;
    const put = (x, y, ch, inv) => {
      const c = ch.charCodeAt(0), rows = F[(c >= 32 && c < 127 ? c : 63) - 32];
      for (let r = 0; r < 7; r++) for (let b = 0; b < 4; b++) if (rows[r] & (8 >> b)) g[(y + r) * W + x + b] = inv ? 255 - ink : ink;
    };
    if (opt.header) {
      g.fill(ink, 0, W * 8);
      const t = String(opt.header).slice(0, 64);
      for (let i = 0; i < t.length; i++) put(i * 5, 0, t[i], true);
    }
    const top = opt.header ? 8 : 0, rowsMax = opt.header ? 23 : 24;
    for (let r = 0; r < Math.min(lines.length, rowsMax); r++) {
      const t = lines[r] || '';
      for (let i = 0; i < Math.min(t.length, 64); i++) if (t[i] !== ' ') put(i * 5, top + r * 8, t[i], false);
    }
    return { w: W, h: H, g };
  }

  // Quantized image (EBC.image.quantize result, width 320/160/80 by mode) -> 7680 screen bytes.
  function pack(q, mode) {
    const M = MODES[mode];
    if (!M) throw new Error('unknown Atari mode ' + mode);
    if (q.w !== M.w || q.h !== H) throw new Error(mode + ' needs a ' + M.w + 'x' + H + ' image, got ' + q.w + 'x' + q.h);
    const out = new Uint8Array(PAGE), lv = q.lv;
    for (let y = 0; y < H; y++) {
      for (let b = 0; b < 40; b++) {
        let v = 0;
        if (mode === 'gr8') { for (let k = 0; k < 8; k++) v = (v << 1) | (lv[y * W + b * 8 + k] ? 0 : 1); } // bit 1 = ink (PF1, black)
        else if (mode === 'gr15') { for (let k = 0; k < 4; k++) v = (v << 2) | lv[y * 160 + b * 4 + k]; }
        else { v = (lv[y * 80 + b * 2] << 4) | lv[y * 80 + b * 2 + 1]; }
        out[y * 40 + b] = v;
      }
    }
    return out;
  }

  // Gray image of any size -> page bytes. opt: fit ('contain'|'cover'|'stretch'), contrast/brightness/gamma/auto (EBC.image.adjust), dither, invert.
  function pageFromImage(img, mode, opt = {}) {
    const M = MODES[mode], I = EBC.image;
    let g = opt.adjust === false ? img : I.adjust(img, { contrast: opt.contrast, brightness: opt.brightness, gamma: opt.gamma, auto: opt.auto });
    g = I.fit(g, M.w, H,     { mode: opt.fit || 'contain', bg: 255 });
        const q = I.quantize(g, { levels: M.levels, method: opt.dither || 'atkinson' });
    return pack(q, mode);
  }

  function palette(mode, invert) {
    if (mode === 'gr8') return invert ? [0x00, 0, 0x0f, 0x00, 0] : [0x0f, 0, 0x00, 0x0f, 0];
    if (mode === 'gr15') return [0x00, 0x05, 0x0a, 0x0f, 0];
    return [0, 0, 0, 0, 0];
  }

  function patch(code, npages, mode, sec0, pal) {
    const o = 9;
    code[o] = npages & 255; code[o + 1] = npages >> 8; code[o + 2] = MODES[mode].id; code[o + 3] = sec0 & 255; code[o + 4] = sec0 >> 8;
    for (let i = 0; i < 5; i++) code[o + 5 + i] = pal[i];
  }

  function atr(sectors, bytes) {
    const par = (sectors * SECT) >> 4, out = new Uint8Array(16 + sectors * SECT);
    out.set([0x96, 0x02, par & 255, (par >> 8) & 255, SECT, 0, (par >> 16) & 255]);
    out.set(bytes, 16);
    return out;
  }

  // Bootable single-density-style ATR (128-byte sectors) holding the viewer and N pages. No DOS: boots straight into the viewer.
  // Each page is 60 sectors. 720 sectors (90K) hold 11 pages and 1040 (130K) hold 17; larger books get a larger image (any size up to 65535 sectors).
  function bootAtr(pages, opt = {}) {
    const mode = opt.mode || 'gr8', V = EBC.viewerData;
    if (!V) throw new Error('viewer data missing (run tools/ebookcraft/build-viewer.cjs)');
    const code = new Uint8Array(B.unb64(V.boot)), bootSec = Math.ceil(code.length / SECT), sec0 = bootSec + 1;
    if (!pages.length) throw new Error('no pages');
    let total = sec0 - 1 + pages.length * PAGE_SECT;
    if (total > 65535) throw new Error('too many pages for one disk (max ' + Math.floor((65535 - bootSec) / PAGE_SECT) + ')');
    const sectors = total <= 720 ? 720 : total <= 1040 ? 1040 : total;
    patch(code, pages.length, mode, sec0, opt.pal || palette(mode, opt.invert));
    const body = new Uint8Array(sectors * SECT);
    body.set(code, 0);
    pages.forEach((p, i) => body.set(p, (sec0 - 1 + i * PAGE_SECT) * SECT));
    return atr(sectors, body);
  }

  // DOS .XEX viewer: at most three pages are resident (pages at $6000, $7E00, $9C00). Use bootAtr for longer books.
  function xex(pages, opt = {}) {
    const mode = opt.mode || 'gr8', V = EBC.viewerData;
    const code = new Uint8Array(B.unb64(V.xex)), n = Math.min(3, pages.length);
    patch(code, n, mode, 0, opt.pal || palette(mode, opt.invert));
    const parts = [code];
    for (let i = 0; i < n; i++) {
      const a = 0x6000 + i * 0x1e00, e = a + PAGE - 1;
      parts.push(new Uint8Array([a & 255, a >> 8, e & 255, e >> 8]), pages[i]);
    }
    return B.concat(parts);
  }

  const atascii = (s) => new Uint8Array([...String(s).replace(/\r?\n/g, '\x9b')].map((c) => c.charCodeAt(0) & 255));

  function dosfs() {
    if (G.AC && G.AC.DosFs && G.AC.AfmCore) return G.AC;
    if (typeof require === 'undefined') throw new Error('dosfs.js / afmcore.js are not loaded');
    const fs = require('fs'), path = require('path'), dir = path.join(__dirname, '..');
    const saveW = global.window, saveAC = global.AC;
    global.window = global; global.AC = {};
    (0, eval)(fs.readFileSync(path.join(dir, 'dosfs.js'), 'utf8'));
    (0, eval)(fs.readFileSync(path.join(dir, 'afmcore.js'), 'utf8'));
    const ac = global.AC; global.AC = saveAC; if (saveW === undefined) delete global.window; else global.window = saveW;
    return ac;
  }

  // Atari DOS 2.x data disk (90K or 130K) with the given text files {NAME83: string|bytes}. Text is converted to ATASCII (EOL = $9B).
  function textDisk(files, opt = {}) {
    const AC = dosfs(), sectors = opt.sectors || 1040;
    const m = AC.AfmCore.mount(AC.DosFs.createDos2({ sectors }), 'book.atr');
    const skipped = [];
    for (const [name, data] of Object.entries(files)) {
      try { m.vol.writeFile(name, typeof data === 'string' ? atascii(data) : data, true); } catch (e) { skipped.push(name + ': ' + e.message); }
    }
    return { bytes: new Uint8Array(m.bytes), skipped, free: m.vol.freeSectors() };
  }

  EBC.atari = { W, H, PAGE, PAGE_SECT, MODES, font4, textPage, pack, pageFromImage, palette, bootAtr, xex, textDisk, atascii };
  if (typeof module !== 'undefined') module.exports = EBC;
})(typeof window !== 'undefined' ? window : globalThis);
