/* Virtual printer P: (SIO device $40) for ataricraft, with a "paper" window that shows what was printed.
   Hooked from the SIO patch via Module.acSio, so only the libatari800 core can claim it (the Altirra core claims only $70).

   The OS P: handler sends one frame per line: command $57 (write), DBYT bytes (normally 40), AUX1 = mode
   ('N' normal, 'D' double width, 'S' sideways). The line ends at the first EOL ($9B). Status ($53) returns 4 bytes.

   Output is kept as ATASCII lines. The paper draws them in the Atari character set (copied from the OS ROM at
   $E000) or in a normal text font, on a roll or on sheets, and can be saved as PNG or text or printed.
   Not done: Epson/ESC codes, graphics mode of the 1020 plotter, sideways printing (printed as normal width).
*/
(function () {
  const C = 0x43, N = 0x4e, E = 0x45, MAXLINES = 20000;
  const KEY = 'ac.printer.';
  const get = (k, d) => { const v = localStorage.getItem(KEY + k); return v == null ? d : v; };

  const P = {
    lines: [],                 // {b: Uint8Array of ATASCII, m: 'N'|'D'|'S'}
    cfg: { font: get('font', 'text'), paper: get('paper', 'roll'), cols: +get('cols', 40) || 40, zoom: +get('zoom', 1) || 1, auto: get('auto', '1') !== '0' },
    rom: null, mem: null, onChange: null, win: null,

    attach(emu) {
      if (emu.core === 'altirra' || !emu.m) return false;
      this.mem = () => (emu.fnMem ? emu.fnMem() : emu.mem());
      const inner = emu.m.acSio;
      emu.m.acSio = (dev, cmd, dstats, aux, data, len) => {
        if (dev !== 0x40) return inner ? inner(dev, cmd, dstats, aux, data, len) : 0;
        try { return this.sio(cmd, aux, data, len); } catch (e) { console.error('printer', e); return E; }
      };
      return true;
    },

    sio(cmd, aux, data, len) {
      const m = this.mem();
      if (cmd === 0x53) { const st = [0, 0, 0x1e, 0]; for (let i = 0; i < len; i++) m[data + i] = st[i] || 0; return C; }
      if (cmd !== 0x57) return N;
      const raw = m.slice(data, data + len), end = raw.indexOf(0x9b);
      this.add(end < 0 ? raw : raw.subarray(0, end), String.fromCharCode(aux & 255));
      return C;
    },

    add(bytes, mode) {
      if (!this.rom) this.grabRom();
      this.lines.push({ b: Uint8Array.from(bytes), m: mode === 'D' || mode === 'S' ? mode : 'N' });
      if (this.lines.length > MAXLINES) this.lines.splice(0, this.lines.length - MAXLINES);
      if (this.onChange) this.onChange();
      this.dirty();
      if (this.cfg.auto && !this.shown()) this.show();
    },

    grabRom() {
      try { const m = this.mem(), r = m.slice(0xe000, 0xe400); if (r.some((x) => x)) this.rom = r; } catch (e) { /* not booted */ }
    },

    clear() { this.lines = []; this.dirty(); if (this.onChange) this.onChange(); },

    // ATASCII line -> plain text (printable ASCII only; the inverse bit is dropped)
    asText(b) { let s = ''; for (const x of b) { const c = x & 0x7f; s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ' '; } return s.replace(/\s+$/, ''); },
    text() { return this.lines.map((l) => this.asText(l.b)).join('\r\n') + (this.lines.length ? '\r\n' : ''); },

    // ---- drawing ----
    // Lines wrap at the column setting; double width ('D') uses two columns per character.
    layout() {
      const cols = this.cfg.cols, rows = [];
      for (const l of this.lines) {
        const dbl = l.m === 'D', per = dbl ? Math.max(1, cols >> 1) : cols;
        if (!l.b.length) { rows.push({ b: l.b, d: dbl }); continue; }
        for (let i = 0; i < l.b.length; i += per) rows.push({ b: l.b.subarray(i, i + per), d: dbl });
      }
      return rows;
    },

    // Renders to a canvas at the given zoom. Returns {canvas, rows, pages}.
    render(canvas, zoom) {
      zoom = zoom || this.cfg.zoom;
      const rows = this.layout(), cols = this.cfg.cols, sheet = this.cfg.paper === 'sheet', PL = sheet ? 60 : 0;
      const cw = 8 * zoom, lh = 10 * zoom, mx = 4 * cw, my = 2 * lh;
      const w = cols * cw + mx * 2, pageRows = PL + 6;
      const pages = sheet ? Math.max(1, Math.ceil(rows.length / PL)) : 1;
      const h = sheet ? pages * (pageRows * lh + my) : Math.max(rows.length + 2, 6) * lh;
      canvas.width = w; canvas.height = h;
      const g = canvas.getContext('2d');
      g.fillStyle = '#fbfaf5'; g.fillRect(0, 0, w, h);
      if (!this.rom) this.grabRom();
      const useRom = this.cfg.font === 'atari' && this.rom, rom = this.rom;
      g.fillStyle = '#16181d';
      g.font = `${Math.round(9 * zoom)}px "Courier New",Consolas,monospace`; g.textBaseline = 'top';
      // tractor-feed holes
      if (!sheet) { g.fillStyle = '#dedbd0'; for (let y = lh; y < h; y += lh * 6) { g.beginPath(); g.arc(cw * 1.5, y, cw * .5, 0, 7); g.arc(w - cw * 1.5, y, cw * .5, 0, 7); g.fill(); } }
      g.fillStyle = '#16181d';
      const glyph = (code, x, y, sx) => {
        const inv = code & 0x80, a = code & 0x7f, ic = a < 0x20 ? a + 0x40 : a < 0x60 ? a - 0x20 : a;
        const bits = (r) => (rom[ic * 8 + r] ^ (inv ? 0xff : 0));
        for (let r = 0; r < 8; r++) { const bb = bits(r); for (let c = 0; c < 8; c++) if (bb & (0x80 >> c)) { const x0 = Math.round(x + c * zoom * sx), y0 = Math.round(y + r * zoom + zoom / 2); g.fillRect(x0, y0, Math.round(x + (c + 1) * zoom * sx) - x0, Math.max(1, Math.round(y + (r + 1) * zoom + zoom / 2) - y0)); } }
      };
      let lastY = 0;
      rows.forEach((row, ri) => {
        const page = sheet ? Math.floor(ri / PL) : 0, y = (sheet ? page * (pageRows * lh + my) + my + (ri % PL) * lh : (ri + 1) * lh);
        lastY = y + lh;
        const step = row.d ? 2 : 1;
        for (let i = 0; i < row.b.length; i++) {
          const code = row.b[i], x = mx + i * cw * step;
          if (code === 0x20 || code === 0) continue;
          const c7 = code & 0x7f;
          if (useRom || c7 < 0x20 || c7 > 0x7e || (code & 0x80 && this.cfg.font !== 'text')) { if (rom) glyph(code, x, y, step); continue; }
          if (code & 0x80) { g.fillRect(x, y, cw * step, lh); g.save(); g.fillStyle = '#fbfaf5'; this.t(g, String.fromCharCode(c7), x, y, step, cw); g.restore(); continue; }
          this.t(g, String.fromCharCode(code), x, y, step, cw);
        }
      });
      if (sheet) { g.strokeStyle = '#b9b5a8'; g.setLineDash([6, 4]); for (let p = 1; p < pages; p++) { const y = p * (pageRows * lh + my) - 1; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } }
      return { canvas, rows: rows.length, pages, lastY };
    },
    t(g, ch, x, y, step, cw) { g.save(); g.translate(x, y); g.scale(step, 1); g.fillText(ch, 0, 0); g.restore(); },

    // ---- window ----
    shown() { return !!(this.win && this.win.isConnected && this.win.style.display !== 'none'); },
    dirty() { if (this.shown()) { clearTimeout(this._t); this._t = setTimeout(() => this.paint(), 60); } },
    paint() {
      const w = this.win; if (!w) return;
      const cv = w.querySelector('canvas'), box = w.querySelector('.pbox');
      const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
      const r = this.render(cv);
      w.querySelector('.pinfo').textContent = `${this.lines.length} line${this.lines.length === 1 ? '' : 's'}` + (this.cfg.paper === 'sheet' ? `, ${r.pages} page${r.pages === 1 ? '' : 's'}` : '') + (this.rom ? '' : ' · Atari font not available yet');
      if (atEnd) box.scrollTop = Math.max(0, r.lastY + 20 - box.clientHeight);
    },
    show() {
      if (!this.win) this.build();
      this.win.style.display = 'flex'; this.paint();
    },
    hide() { if (this.win) this.win.style.display = 'none'; },

    png() { const c = document.createElement('canvas'); this.render(c, 2); return new Promise((r) => c.toBlob(r, 'image/png')); },
    download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); },
    async print() {
      const png = await this.png(), url = URL.createObjectURL(png);
      const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;left:-9999px;width:0;height:0;border:0';
      document.body.append(f);
      f.contentDocument.write(`<style>@page{margin:10mm}body{margin:0}img{width:100%;display:block}</style><img src="${url}">`);
      f.contentDocument.close();
      f.contentDocument.querySelector('img').onload = () => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 4000); };
    },

    build() {
      const w = this.win = document.createElement('div'); w.id = 'paperwin';
      w.style.cssText = 'position:fixed;right:16px;bottom:16px;width:min(560px,92vw);height:min(70vh,640px);min-width:320px;min-height:240px;z-index:9000;display:none;flex-direction:column;background:#1b1e24;color:#e6e0d4;border:1px solid #4a5160;border-radius:10px;box-shadow:0 8px 30px #000b;resize:both;overflow:hidden;font:13px system-ui,sans-serif';
      const sel = (k, opts) => `<select data-k="${k}" style="background:#2a2f39;color:inherit;border:1px solid #4a5160;border-radius:5px;padding:2px 4px">${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
      w.innerHTML = `<div class="phd" style="display:flex;gap:6px;align-items:center;padding:6px 8px;background:#232730;cursor:move;flex-wrap:wrap"><b style="color:#e8a33d">P: printer</b><span class="pinfo" style="opacity:.7;flex:1"></span><button data-a="x" title="Hide (output keeps being captured)">✕</button></div>
        <div style="display:flex;gap:6px;padding:6px 8px;flex-wrap:wrap;align-items:center;border-bottom:1px solid #2c313b">
          ${sel('font', [['text', 'Text font'], ['atari', 'Atari font']])}${sel('paper', [['roll', 'Roll'], ['sheet', 'Sheets']])}${sel('cols', [[40, '40 col'], [80, '80 col']])}${sel('zoom', [[1, '1×'], [1.5, '1.5×'], [2, '2×']])}
          <label style="display:flex;gap:3px;align-items:center" title="Show this window when something prints"><input type="checkbox" data-k="auto"> open on output</label>
        </div>
        <div style="display:flex;gap:6px;padding:6px 8px;flex-wrap:wrap;border-bottom:1px solid #2c313b">
          <button data-a="png">Save PNG</button><button data-a="txt">Save text</button><button data-a="copy">Copy text</button><button data-a="print">Print…</button><button data-a="clear" title="Tear off: throw away what is on the paper">Tear off</button>
        </div>
        <div class="pbox" style="flex:1;min-height:0;overflow:auto;background:#3a3e48;padding:10px"><canvas style="display:block;margin:auto;box-shadow:0 2px 10px #0008"></canvas></div>`;
      for (const b of w.querySelectorAll('button')) b.style.cssText = 'cursor:pointer;background:#2a2f39;color:inherit;border:1px solid #4a5160;border-radius:5px;padding:3px 8px';
      for (const s of w.querySelectorAll('select[data-k]')) { s.value = String(this.cfg[s.dataset.k]); s.onchange = () => { this.cfg[s.dataset.k] = s.dataset.k === 'cols' || s.dataset.k === 'zoom' ? +s.value : s.value; localStorage.setItem(KEY + s.dataset.k, s.value); this.paint(); }; }
      const au = w.querySelector('input[data-k="auto"]'); au.checked = this.cfg.auto; au.onchange = () => { this.cfg.auto = au.checked; localStorage.setItem(KEY + 'auto', au.checked ? '1' : '0'); };
      w.onclick = async (e) => {
        const b = e.target.closest('button[data-a]'); if (!b) return;
        const a = b.dataset.a;
        if (a === 'x') this.hide();
        else if (a === 'png') this.download(await this.png(), 'printout.png');
        else if (a === 'txt') this.download(new Blob([this.text()], { type: 'text/plain' }), 'printout.txt');
        else if (a === 'copy') { try { await navigator.clipboard.writeText(this.text()); b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy text'), 1200); } catch (err) { b.textContent = 'Not allowed'; } }
        else if (a === 'print') this.print();
        else if (a === 'clear') this.clear();
      };
      // drag by the title bar
      const hd = w.querySelector('.phd');
      hd.onpointerdown = (e) => {
        if (e.target.closest('button')) return;
        const r = w.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
        const mv = (ev) => { w.style.left = Math.max(0, ev.clientX - dx) + 'px'; w.style.top = Math.max(0, ev.clientY - dy) + 'px'; w.style.right = 'auto'; w.style.bottom = 'auto'; };
        const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
        addEventListener('pointermove', mv); addEventListener('pointerup', up);
      };
      document.body.append(w);
    },
  };
  window.Printer = P;
})();
