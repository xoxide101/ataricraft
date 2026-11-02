// Font editor panel: edit an Atari 1024-byte character set (128 chars x 8 bytes, screen-code order), preview text,
// save .FNT, export a Windows .TTF (web/js/ttf.js), or install the set into the running Atari (RAM at $9800, CHBAS = $98).
(function () {
  const AC = (window.AC = window.AC || {});
  let win = null;
  const el = (t, css, txt) => { const e = document.createElement(t); if (css) e.style.cssText = css; if (txt) e.textContent = txt; return e; };
  const INSTALL = 0x9800;

  function open() {
    if (win) { win.style.display = 'flex'; return; }
    const host = AC.BasicHost || {};
    const font = new Uint8Array(1024); let cur = 33, inv = false;
    let saved = false;
    try { const s = localStorage.getItem('ac.font'); if (s) { font.set(JSON.parse(s)); saved = true; } } catch (e) { /* ignore */ }
    const rf = !saved && host.romFont && host.romFont();
    if (rf) font.set(rf);
    const save = () => localStorage.setItem('ac.font', JSON.stringify(Array.from(font)));
    win = el('div', 'position:fixed;z-index:9000;right:24px;top:24px;width:min(94vw,760px);height:min(90vh,640px);background:#1e2128;color:#d8dce4;border:1px solid #4a5160;border-radius:10px;box-shadow:0 8px 30px #000a;display:flex;flex-direction:column;font:13px system-ui,sans-serif;overflow:auto');
    const bar = el('div', 'display:flex;gap:6px;align-items:center;padding:6px 8px;background:#14161a;cursor:move;flex-wrap:wrap');
    const btn = (t, f, tip) => { const b = el('button', 'background:#2a2f39;color:#d8dce4;border:1px solid #3a4150;border-radius:5px;padding:3px 9px;font:inherit;cursor:pointer', t); if (tip) b.title = tip; b.onclick = f; return b; };
    const msg = el('div', 'padding:3px 8px;background:#14161a;color:#8a93a3;font-size:11px', 'Click a character, then click pixels to draw. Changes are kept in this browser.');
    const say = (t) => { msg.textContent = t; };

    const sheet = el('canvas'); sheet.width = 16 * 18; sheet.height = 8 * 18; sheet.style.cssText = 'background:#000;cursor:pointer;align-self:flex-start';
    const big = el('canvas'); big.width = big.height = 256; big.style.cssText = 'background:#000;cursor:crosshair;image-rendering:pixelated';
    const prev = el('canvas'); prev.width = 40 * 8 * 2; prev.height = 8 * 2 * 3; prev.style.cssText = 'background:#000;image-rendering:pixelated;max-width:100%';
    const text = el('input', 'background:#0d0f12;color:#e6e6e6;border:1px solid #3a4150;padding:3px 6px;font:13px Consolas,monospace;flex:1'); text.value = localStorage.getItem('ac.font.text') || 'HELLO, ATARI 8-BIT WORLD! 0123456789';

    const code = (n) => (inv ? n + 128 : n) & 127;
    const glyph = (n) => font.subarray(n * 8, n * 8 + 8);
    const paint = (ctx, n, x, y, s, invert, fg) => {
      const g = glyph(n);
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const on = ((g[r] >> (7 - c)) & 1) ^ (invert ? 1 : 0); if (on) { ctx.fillStyle = fg; ctx.fillRect(x + c * s, y + r * s, s, s); } }
    };
    const draw = () => {
      let c = sheet.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, sheet.width, sheet.height);
      for (let n = 0; n < 128; n++) { const x = (n & 15) * 18, y = (n >> 4) * 18; if (n === cur) { c.fillStyle = '#2d4a7a'; c.fillRect(x, y, 18, 18); } paint(c, n, x + 1, y + 1, 2, inv, '#9bd1ff'); }
      c = big.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, 256, 256);
      paint(c, cur, 0, 0, 32, false, '#9bd1ff');
      c.strokeStyle = '#2c313b'; c.beginPath(); for (let i = 0; i <= 8; i++) { c.moveTo(i * 32, 0); c.lineTo(i * 32, 256); c.moveTo(0, i * 32); c.lineTo(256, i * 32); } c.stroke();
      c = prev.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, prev.width, prev.height);
      const t = text.value.toUpperCase().slice(0, 40);
      for (let i = 0; i < t.length; i++) { const a = t.charCodeAt(i); if (a < 32 || a > 127) continue; const n = a < 96 ? a - 32 : a; paint(c, n & 127, i * 16, 0, 2, false, '#e6e6e6'); }
      const lc = text.value.slice(0, 40);
      for (let i = 0; i < lc.length; i++) { const a = lc.charCodeAt(i); if (a < 32 || a > 127) continue; paint(c, (a < 96 ? a - 32 : a) & 127, i * 16, 16, 2, true, '#e6e6e6'); }
      for (let i = 0; i < 40; i++) paint(c, i, i * 16, 32, 2, false, '#ffb347');
      info.textContent = `Character ${cur} (screen code), ${inv ? 'inverse view' : 'normal view'}.  Bytes: ${Array.from(glyph(cur)).map((b) => b.toString(16).padStart(2, '0')).join(' ')}`;
      save();
    };
    const info = el('div', 'font:12px Consolas,monospace;color:#9bd1ff;padding:0 8px');
    sheet.onclick = (e) => { const r = sheet.getBoundingClientRect(); const x = Math.floor(((e.clientX - r.left) * sheet.width) / r.width / 18), y = Math.floor(((e.clientY - r.top) * sheet.height) / r.height / 18); cur = Math.min(127, y * 16 + x); draw(); };
    let paintVal = null;
    const edit = (e) => {
      const r = big.getBoundingClientRect(); const x = Math.floor(((e.clientX - r.left) * 8) / r.width), y = Math.floor(((e.clientY - r.top) * 8) / r.height);
      if (x < 0 || y < 0 || x > 7 || y > 7) return;
      const m = 1 << (7 - x); if (paintVal === null) paintVal = !(font[cur * 8 + y] & m);
      font[cur * 8 + y] = paintVal ? font[cur * 8 + y] | m : font[cur * 8 + y] & ~m; draw();
    };
    big.onmousedown = (e) => { paintVal = null; edit(e); big.onmousemove = edit; };
    window.addEventListener('mouseup', () => { big.onmousemove = null; paintVal = null; });
    text.oninput = () => { localStorage.setItem('ac.font.text', text.value); draw(); };

    const rowop = (name, f) => btn(name, () => { const g = glyph(cur), o = Array.from(g); f(o); g.set(o); draw(); });
    const dl = (name, parts, type) => { const a = el('a'); a.href = URL.createObjectURL(new Blob(parts, { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
    const fi = el('input'); fi.type = 'file'; fi.accept = '.fnt,.bin,.set'; fi.style.display = 'none';
    fi.onchange = async () => { const f = fi.files[0]; if (!f) return; const b = new Uint8Array(await f.arrayBuffer()); if (b.length < 1024) say('That file is too short for a character set (need 1024 bytes).'); else { font.set(b.subarray(0, 1024)); say(`Loaded ${f.name} (${b.length} bytes${b.length > 1024 ? ', only the first 1024 used' : ''}).`); draw(); } fi.value = ''; };

    const fromRom = () => {
      const rom = host.romFont && host.romFont();
      if (rom) { font.set(rom); say('Loaded the standard Atari character set from your OS ROM file.'); draw(); return; }
      const emu = host.emu && host.emu(); if (!emu) { say('No OS ROM is loaded and the Atari is not running, so there is no ROM character set to read. Load a ROM or boot first.'); return; }
      const b = emu.peek(0xE000, 1024); font.set(b); say('Copied the ROM character set from $E000 (check it looks right; it is blank if the OS ROM is not mapped).'); draw();
    };
    const install = () => {
      const emu = host.emu && host.emu(); if (!emu) { say('The Atari is not running. Boot it first.'); return; }
      emu.poke(INSTALL, Array.from(font)); emu.poke(756, [INSTALL >> 8]);
      say('Sent to RAM $9800 and CHBAS (756) set. Programs that reset CHBAS, or that use that RAM, will overwrite it.');
    };
    const ttf = () => { const name = (prompt('Font name', 'Atari 8-bit') || '').trim(); if (!name) return; dl(name.replace(/\W+/g, '') + '.ttf', [AC.Ttf.build(font, { family: name })], 'font/ttf'); say('Saved. In Windows: right-click the .ttf and choose Install.'); };

    bar.append(el('b', '', 'FONT'), btn('From ROM', fromRom, 'Read the character set at $E000 from the running Atari'),
      btn('Load .FNT', () => fi.click()), btn('Save .FNT', () => dl('FONT.FNT', [font.slice()], 'application/octet-stream')),
      btn('Save .TTF', ttf, 'Windows TrueType font'), btn('Install on Atari', install),
      btn('Clear', () => { font.fill(0); draw(); }), el('span', 'flex:1'), btn('X', () => { win.style.display = 'none'; }));
    const tools = el('div', 'display:flex;gap:6px;padding:4px 8px;flex-wrap:wrap');
    tools.append(btn('Clear char', () => { glyph(cur).fill(0); draw(); }), btn('Invert char', () => { const g = glyph(cur); for (let i = 0; i < 8; i++) g[i] ^= 255; draw(); }),
      rowop('Up', (o) => o.push(o.shift())), rowop('Down', (o) => o.unshift(o.pop())),
      rowop('Left', (o) => { for (let i = 0; i < 8; i++) o[i] = ((o[i] << 1) | (o[i] >> 7)) & 255; }), rowop('Right', (o) => { for (let i = 0; i < 8; i++) o[i] = ((o[i] >> 1) | (o[i] << 7)) & 255; }),
      rowop('Flip H', (o) => { for (let i = 0; i < 8; i++) { let v = 0; for (let b = 0; b < 8; b++) if (o[i] & (1 << b)) v |= 1 << (7 - b); o[i] = v; } }), rowop('Flip V', (o) => o.reverse()),
      btn('Normal/inverse view', () => { inv = !inv; draw(); }));
    const mid = el('div', 'display:flex;gap:10px;padding:8px;flex-wrap:wrap'); mid.append(sheet, big);
    win.append(bar, tools, mid, info, el('div', 'padding:6px 8px;display:flex;gap:6px;align-items:center'), msg, fi);
    const row = win.children[4]; row.append(el('span', '', 'Preview:'), text);
    win.insertBefore(prev, msg);
    let dx = 0, dy = 0, drag = false;
    bar.onmousedown = (e) => { if (e.target !== bar) return; drag = true; const r = win.getBoundingClientRect(); dx = e.clientX - r.left; dy = e.clientY - r.top; };
    window.addEventListener('mousemove', (e) => { if (drag) { win.style.left = e.clientX - dx + 'px'; win.style.top = e.clientY - dy + 'px'; win.style.right = 'auto'; } });
    window.addEventListener('mouseup', () => { drag = false; });
    document.body.append(win); draw();
    if (rf) say('Started from the standard Atari character set in your OS ROM. Changes are kept in this browser.');
  }
  AC.FontPanel = { open };
})();
