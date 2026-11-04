// BASIC panel: editor, run console and a small graphics screen on top of web/js/basic.js.
// PEEK/POKE go to the emulated Atari when one is running (AC.BasicHost.emu()); otherwise they use the interpreter's own 64K array.
(function () {
  const AC = (window.AC = window.AC || {});
  let win = null;
  const SAMPLE = '10 REM HELLO\n20 GRAPHICS 7+16\n30 SETCOLOR 0,2,8\n40 COLOR 1\n50 FOR I=0 TO 95 STEP 4\n60 PLOT 0,I:DRAWTO 159,95-I\n70 NEXT I\n80 PRINT "DONE"\n';
  const el = (t, css, txt) => { const e = document.createElement(t); if (css) e.style.cssText = css; if (txt) e.textContent = txt; return e; };

  function atariRGB(hue, lum) {
    if (!hue) { const v = Math.round(lum * 17); return [v, v, v]; }
    const a = ((hue - 1) / 15) * 2 * Math.PI + 0.35, y = 0.12 + lum / 15 * 0.85, c = 0.28;
    const cl = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
    return [cl(y + 0.956 * c * Math.cos(a) + 0.62 * c * Math.sin(a)), cl(y - 0.27 * c * Math.cos(a) - 0.65 * c * Math.sin(a)), cl(y - 1.1 * c * Math.cos(a) + 1.7 * c * Math.sin(a))];
  }

  function open() {
    if (win) { win.style.display = 'flex'; return; }
    const host = AC.BasicHost || {};
    win = el('div', 'position:fixed;z-index:9000;right:12px;top:12px;width:min(94vw,860px);height:min(90vh,640px);background:#1e2128;color:#d8dce4;border:1px solid #4a5160;border-radius:10px;box-shadow:0 8px 30px #000a;display:flex;flex-direction:column;font:13px system-ui,sans-serif;resize:both;overflow:hidden');
    const bar = el('div', 'display:flex;gap:6px;align-items:center;padding:6px 8px;background:#14161a;cursor:move;flex-wrap:wrap');
    const btn = (t, f, tip) => { const b = el('button', 'background:#2a2f39;color:#d8dce4;border:1px solid #3a4150;border-radius:5px;padding:3px 9px;font:inherit;cursor:pointer', t); if (tip) b.title = tip; b.onclick = f; return b; };
    const dial = el('select', 'background:#2a2f39;color:#d8dce4;border:1px solid #3a4150;border-radius:5px;padding:3px');
    dial.innerHTML = '<option value="atari">Atari BASIC</option><option value="xl">BASIC XL-style</option><option value="altair">Altair-style</option>';
    const ed = el('textarea', 'flex:1;min-height:90px;background:#0d0f12;color:#e6e6e6;border:0;border-top:1px solid #2c313b;padding:8px;font:13px Consolas,monospace;resize:none;white-space:pre');
    ed.spellcheck = false; ed.value = localStorage.getItem('ac.basic.src') || SAMPLE;
    const mid = el('div', 'display:flex;flex:1;min-height:120px;border-top:1px solid #2c313b');
    const out = el('pre', 'flex:1;margin:0;padding:8px;background:#000;color:#9bd1ff;font:13px Consolas,monospace;overflow:auto;white-space:pre-wrap;min-width:0');
    const cv = el('canvas', 'width:320px;height:192px;image-rendering:pixelated;background:#000;margin:6px;align-self:flex-start;border:1px solid #333');
    cv.width = 160; cv.height = 96;
    const inl = el('input', 'background:#0d0f12;color:#e6e6e6;border:0;border-top:1px solid #2c313b;padding:6px 8px;font:13px Consolas,monospace;display:none');
    mid.append(out, cv);
    let B = null, scr = { w: 40, h: 24, cols: [[0, 0, 0], [224, 160, 48], [64, 160, 224], [96, 192, 96]], col: 1, x: 0, y: 0 }, aud = null, osc = [];
    const g = cv.getContext('2d');
    const say = (s) => { if (s === '\f') { out.textContent = ''; return; } out.textContent += s; out.scrollTop = out.scrollHeight; };
    const dot = (x, y) => { const c = scr.cols[scr.col & 3]; g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; g.fillRect(x * cv.width / scr.w | 0, y * cv.height / scr.h | 0, Math.max(1, cv.width / scr.w), Math.max(1, cv.height / scr.h)); };
    const hooks = {
      peek: (a) => (host.emu && host.emu() ? host.emu().peek(a, 1)[0] : B.mem[a]),
      poke: (a, v) => { if (host.emu && host.emu()) host.emu().poke(a, [v]); },
      graphics: (m) => { const mode = m & 15, sizes = { 3: [40, 24], 5: [80, 48], 7: [160, 96], 8: [320, 192], 4: [80, 48], 6: [160, 96], 15: [160, 192], 9: [80, 192], 10: [80, 192], 11: [80, 192], 14: [160, 192] }; const s = sizes[mode] || [40, 24]; scr.w = s[0]; scr.h = s[1]; cv.width = Math.min(320, scr.w); cv.height = Math.min(192, scr.h); g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height); },
      color: (c) => { scr.col = c; },
      setcolor: (r, h, l) => { if (r >= 0 && r < 4) scr.cols[r] = atariRGB(h & 15, l & 15); },
      position: (x, y) => { scr.x = x; scr.y = y; },
      plot: (x, y) => { dot(x, y); scr.x = x; scr.y = y; },
      drawto: (x2, y2) => {
        let x = scr.x, y = scr.y; const dx = Math.abs(x2 - x), dy = -Math.abs(y2 - y), sx = x < x2 ? 1 : -1, sy = y < y2 ? 1 : -1; let e = dx + dy;
        for (let n = 0; n < 5000; n++) { dot(x, y); if (x === x2 && y === y2) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x += sx; } if (e2 <= dx) { e += dx; y += sy; } }
        scr.x = x2; scr.y = y2;
      },
      sound: (v, p, d, vol) => {
        try { aud = aud || new AudioContext(); if (osc[v]) { try { osc[v].o.stop(); } catch (e) { /* already stopped */ } osc[v] = null; } if (!vol) return;
          const o = aud.createOscillator(), gn = aud.createGain(); o.type = 'square'; o.frequency.value = 31960 / (p + 1); gn.gain.value = Math.min(1, vol / 15) * 0.08; o.connect(gn); gn.connect(aud.destination); o.start(); osc[v] = { o }; } catch (e) { /* no audio */ }
      },
    };
    const killSound = () => osc.forEach((s) => { if (s) try { s.o.stop(); } catch (e) { /* ignore */ } }); 
    const runBtn = btn('Run', async () => {
      localStorage.setItem('ac.basic.src', ed.value); out.textContent = '';
      B = new AC.Basic.Basic({ print: say, hooks, dialect: dial.value, input: (p) => new Promise((res) => { say(p); inl.style.display = ''; inl.value = ''; inl.focus(); inl.onkeydown = (ev) => { if (ev.key === 'Enter') { inl.style.display = 'none'; say(inl.value + '\n'); res(inl.value); } }; }) });
      B.load(ed.value); runBtn.disabled = true;
      try { await B.run(); } finally { runBtn.disabled = false; inl.style.display = 'none'; }
    }, 'Run the program');
    const dl = (name, txt) => { const a = el('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
    const fi = el('input'); fi.type = 'file'; fi.accept = '.bas,.txt,.lst'; fi.style.display = 'none';
    fi.onchange = async () => { if (fi.files[0]) ed.value = (await fi.files[0].text()).replace(/\r\n?/g, '\n').replace(/\x9b/g, '\n'); fi.value = ''; };
    const comp = () => {
      const r = AC.BComp.compile(ed.value);
      if (r.errors.length) { out.textContent = r.errors.map((e) => `Compile error, line ${e.line}: ${e.msg}`).join('\n'); return null; }
      return r;
    };
    const dlb = (name, part) => { const a = el('a'); a.href = URL.createObjectURL(new Blob([part], { type: 'application/octet-stream' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
    const compRun = btn('Compile + run on Atari', () => {
      localStorage.setItem('ac.basic.src', ed.value); out.textContent = '';
      const r = comp(); if (!r) return;
      const emu = host.emu && host.emu();
      if (!emu) { out.textContent = 'The Atari is not running. Boot it first, then compile and run.'; return; }
      emu.bootFile('PROGRAM.XEX', r.xex); out.textContent = `Compiled ${r.xex.length} bytes and started on the Atari.`;
    }, 'Compile to 6502 and boot it in the running emulator (integers and strings, no floats)');
    bar.append(el('b', '', 'BASIC'), dial, runBtn, btn('Stop', () => { if (B) B.stop(); killSound(); }), btn('Clear', () => { out.textContent = ''; g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height); }),
      compRun, btn('Save .XEX', () => { out.textContent = ''; const r = comp(); if (r) dlb('PROGRAM.XEX', r.xex); }, 'Compile and download an Atari executable'),
      btn('Save .ASM', () => { out.textContent = ''; const r = comp(); if (r) dlb('PROGRAM.ASM', r.asm.replace(/\n/g, '\r\n')); }, 'Compile and download MADS-style assembly source'),
      btn('Load .BAS', () => fi.click(), 'Load a text listing'), btn('Save .BAS', () => dl('PROGRAM.BAS', ed.value.replace(/\n/g, '\r\n')), 'Save the listing as text'),
      btn('Sample', () => { ed.value = SAMPLE; }), el('span', 'flex:1'), btn('X', () => { win.style.display = 'none'; killSound(); }));
    const note = el('div', 'padding:3px 8px;background:#14161a;color:#8a93a3;font-size:11px', 'Text-listing BASIC for trying programs out. It is not the ROM: timing and some error cases differ. PEEK and POKE reach the running Atari.');
    win.append(bar, ed, mid, inl, note, fi);
    let dx = 0, dy = 0, drag = false;
    bar.onmousedown = (e) => { if (e.target !== bar) return; drag = true; const r = win.getBoundingClientRect(); dx = e.clientX - r.left; dy = e.clientY - r.top; };
    window.addEventListener('mousemove', (e) => { if (drag) { win.style.left = e.clientX - dx + 'px'; win.style.top = e.clientY - dy + 'px'; win.style.right = 'auto'; } });
    window.addEventListener('mouseup', () => { drag = false; });
    document.body.append(win);
  }
  AC.BasicPanel = { open };
})();
