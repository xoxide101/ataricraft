// ASM / IDE panel (Tools hub): edit 6502 source, assemble with asm6502.js, run on the connected Atari or in the built-in simulator,
// step through code, watch RAM, disassemble. One 38px ribbon, one status bar. Keys: F7 assemble, F5 run, F6 break, F10 step over, F11 step into.
(function () {
  const AC = (window.AC = window.AC || {});
  let win = null;
  const SAMPLE = `; Border colour cycle. F7 assembles, F5 runs.
        org $2000
start   inc COLBK        ; $D01A
        jmp start

        .run start       ; RUNAD ($2E0)
`;
  const FONT_SAMPLE = `; Uses the font open (even unsaved) in the Font editor: it publishes assets/font.fnt in memory.
        org $2000
        .include "atari.inc"
start   lda #>font
        sta CHBAS
        jmp *
        org $3000        ; 1K aligned
font    .include "assets/font.fnt"
        .run start
`;
  const hx = (n, w) => (n >>> 0).toString(16).toUpperCase().padStart(w, '0');
  const el = (t, css, txt) => { const e = document.createElement(t); if (css) e.style.cssText = css; if (txt) e.textContent = txt; return e; };
  const CSS_BTN = 'background:#2a2f39;color:#d8dce4;border:1px solid #3a4150;border-radius:4px;padding:0 6px;height:21px;font:inherit;cursor:pointer;white-space:nowrap';
  const CSS_SEL = 'background:#0d0f12;color:#d8dce4;border:1px solid #3a4150;border-radius:4px;height:21px;font:inherit';
  const CSS_PANE = 'margin:0;padding:6px 8px;background:#000;color:#9bd1ff;font:12px Consolas,monospace;overflow:auto;white-space:pre';

  // open(): floating window (Tools hub). open({dock: element}): fill that element (Studio IDE tab).
  function open(o) {
    if (win) { win.style.display = 'flex'; return win; }
    const dock = o && o.dock;
    const host = AC.BasicHost || {}, W = AC.WTools, Cpu = AC.Sim6502;
    win = el('div', (dock ? 'position:relative;width:100%;height:100%;' : 'position:fixed;z-index:9000;right:24px;top:24px;width:min(96vw,940px);height:min(90vh,680px);border:1px solid #4a5160;border-radius:10px;box-shadow:0 8px 30px #000a;resize:both;') + 'background:#1e2128;color:#d8dce4;display:flex;flex-direction:column;font:13px system-ui,sans-serif;overflow:hidden');
    win.tabIndex = -1;
    const st = { last: null, used: new Set(), sim: null, mem: null, run: 0, raf: 0, stale: '', toggles: { dis: false, watch: false, mirror: false }, bp: new Set() };

    // ---------- ribbon (single row) ----------
    const bar = el('div', 'display:flex;gap:6px;align-items:center;height:40px;min-height:40px;padding:0 8px;background:#14161a;cursor:move;overflow-x:auto;overflow-y:hidden;box-sizing:border-box');
    const btn = (t, f, tip) => { const b = el('button', CSS_BTN, t); if (tip) b.title = tip; b.onclick = f; return b; };
    const sep = () => el('span', 'width:1px;height:20px;background:#3a4150;margin:0 2px');
    const toggle = (t, key, tip) => { const b = btn(t, () => { st.toggles[key] = !st.toggles[key]; b.style.background = st.toggles[key] ? '#2d5a8a' : '#2a2f39'; layout(); refresh(); }, tip); return b; };
    const sel = (opts, tip) => { const s = el('select', CSS_SEL); for (const o of opts) { const op = el('option', '', o[1] || o); op.value = o[0] || o; s.append(op); } if (tip) s.title = tip; return s; };

    const ed = el('textarea', 'flex:2;min-height:100px;background:#0d0f12;color:#e6e6e6;border:0;border-top:1px solid #2c313b;padding:8px;font:13px Consolas,monospace;resize:none;white-space:pre;tab-size:8');
    ed.spellcheck = false; ed.value = localStorage.getItem('ac.asm.src') || SAMPLE;
    const out = el('pre', CSS_PANE + ';flex:1;min-width:0');
    const dis = el('pre', CSS_PANE + ';flex:1;min-width:0;color:#c9e7a3;border-left:1px solid #2c313b');
    const watchBox = el('div', 'flex:1;min-width:0;display:flex;flex-direction:column;border-left:1px solid #2c313b;background:#000');
    const wIn = el('input', 'background:#0d0f12;color:#d8dce4;border:0;border-bottom:1px solid #2c313b;padding:3px 8px;font:12px Consolas,monospace'); wIn.value = '0080 40'; wIn.title = 'Watch RAM: start address and length (hex)';
    const wOut = el('pre', CSS_PANE + ';flex:1;color:#ffd479');
    watchBox.append(wIn, wOut);
    const mirror = el('pre', CSS_PANE + ';flex:1;min-width:0;color:#b8ffb8;border-left:1px solid #2c313b;line-height:1.1');
    const panes = el('div', 'display:flex;flex:1;min-height:70px;border-top:1px solid #2c313b;overflow:hidden');
    const status = el('div', 'display:flex;gap:14px;align-items:center;height:22px;min-height:22px;padding:0 8px;background:#14161a;color:#8a93a3;font:11px Consolas,monospace;white-space:nowrap;overflow:hidden');
    const sDev = el('span'), sRegs = el('span'), sMsg = el('span', 'flex:1;overflow:hidden;text-overflow:ellipsis');
    status.append(sDev, sRegs, sMsg);
    const layout = () => { panes.textContent = ''; panes.append(out); if (st.toggles.dis) panes.append(dis); if (st.toggles.watch) panes.append(watchBox); if (st.toggles.mirror) panes.append(mirror); };

    const msg = (t, err) => { out.style.color = err ? '#ff7b7b' : '#9bd1ff'; out.textContent = t; };
    const emu = () => { try { return host.emu && host.emu(); } catch (e) { return null; } };
    const cpuSel = sel([['6502', 'CPU 6502'], ['65c02', 'CPU 65C02']], 'Target dialect');
    const runSel = sel([['atari', 'Run on Atari'], ['sim', 'Run in simulator']], 'Where F5 runs the program');
    const segSel = sel([['', 'Segments']], 'Jump to a segment'); segSel.style.maxWidth = '140px';
    const cycIn = el('input', CSS_SEL + ';width:62px;padding:0 4px'); cycIn.value = '29868'; cycIn.title = 'Simulator cycles per animation frame';
    const bpIn = el('input', CSS_SEL + ';width:70px;padding:0 4px'); bpIn.placeholder = 'break @'; bpIn.title = 'Breakpoint addresses (hex, comma separated)';

    // ---------- assemble ----------
    const resolver = (name) => {
      const n = name.replace(/\\/g, '/').toLowerCase();
      st.used.add(n);
      if (/(^|\/)atari\.(inc|equ)$/.test(n) && W) return W.equatesInc();
      return AC.Buffers ? AC.Buffers.resolve(name) : null;
    };
    const build = (quiet) => {
      localStorage.setItem('ac.asm.src', ed.value); st.used.clear(); st.stale = '';
      try {
        const r = AC.Asm.assemble(ed.value, { symbols: W ? W.atariEquates() : {}, cpu: cpuSel.value, resolve: resolver }); st.last = r;
        segSel.textContent = ''; segSel.append(Object.assign(el('option', '', 'Segments'), { value: '' }));
        r.segments.forEach((s) => segSel.append(Object.assign(el('option', '', `$${hx(s.addr, 4)}-$${hx(s.addr + s.bytes.length - 1, 4)}`), { value: s.addr })));
        const segs = r.segments.map((s) => `$${hx(s.addr, 4)}-$${hx(s.addr + s.bytes.length - 1, 4)}  ${s.bytes.length} bytes`);
        const syms = Object.entries(r.symbols).map(([k, v]) => `${k} = $${hx(v & 0xFFFF, 4)}`).join('   ');
        if (!quiet) msg(`OK, ${r.xex.length} bytes\n${segs.join('\n')}\n\n${syms}`);
        sMsg.textContent = `Assembled: ${r.xex.length} bytes, ${r.segments.length} segment(s)`; sMsg.style.color = '#8a93a3';
        return r;
      } catch (e) {
        st.last = null; msg(e.message, true); sMsg.textContent = e.message; sMsg.style.color = '#ff7b7b';
        const m = /^line (\d+)/.exec(e.message);
        if (m && !/\(in /.test(e.message)) { const ln = +m[1] - 1, ls = ed.value.split('\n'); const a = ls.slice(0, ln).join('\n').length + (ln ? 1 : 0); ed.focus(); ed.setSelectionRange(a, a + (ls[ln] || '').length); }
        return null;
      }
    };
    const cleanBuild = () => { stop(); st.sim = null; out.textContent = ''; dis.textContent = ''; wOut.textContent = ''; build(); refresh(); };

    // ---------- simulator ----------
    const labels = () => { const L = Object.assign({}, W ? W.ATARI_LABELS : {}); if (st.last) for (const [k, v] of Object.entries(st.last.symbols)) if (v >= 0 && v < 65536 && !(v in L)) L[v] = k; return L; };
    const loadSim = (r) => {
      st.mem = new Uint8Array(65536);
      for (const s of r.segments) st.mem.set(s.bytes, s.addr);
      st.sim = Cpu(st.mem); st.sim.sp = 0xFF; st.sim.I = 1;
      const run = st.mem[0x2E0] | st.mem[0x2E1] << 8;
      st.sim.pc = run || (r.segments.find((s) => s.addr !== 0x2E0 && s.addr !== 0x2E2) || r.segments[0] || { addr: 0x2000 }).addr;
      st.bp = new Set((bpIn.value.match(/[0-9a-fA-F]{1,4}/g) || []).map((x) => parseInt(x, 16)));
      return st.sim;
    };
    const ensureSim = () => { if (st.sim) return st.sim; const r = st.last || build(); return r ? loadSim(r) : null; };
    const stop = () => { st.run = 0; cancelAnimationFrame(st.raf); };
    const safeStep = () => { try { st.sim.step(); return true; } catch (e) { stop(); sMsg.textContent = 'Simulator stopped: ' + e.message; sMsg.style.color = '#ff7b7b'; return false; } };
    const frame = () => {
      if (!st.run) return;
      const c = st.sim, target = c.cycles + (parseInt(cycIn.value, 10) || 29868);
      while (c.cycles < target) { if (!safeStep()) break; if (st.bp.has(c.pc)) { stop(); sMsg.textContent = 'Breakpoint at $' + hx(c.pc, 4); sMsg.style.color = '#ffd479'; break; } }
      refresh(); if (st.run) st.raf = requestAnimationFrame(frame);
    };
    const runSim = () => { const c = ensureSim(); if (!c) return; stop(); st.bp = new Set((bpIn.value.match(/[0-9a-fA-F]{1,4}/g) || []).map((x) => parseInt(x, 16))); st.run = 1; sMsg.textContent = 'Running in simulator'; sMsg.style.color = '#8a93a3'; st.raf = requestAnimationFrame(frame); };
    const stepInto = () => { stop(); const c = ensureSim(); if (!c) return; safeStep(); refresh(); };
    const stepOver = () => {
      stop(); const c = ensureSim(); if (!c) return;
      if (st.mem[c.pc] !== 0x20) { safeStep(); refresh(); return; }
      const ret = (c.pc + 3) & 0xFFFF; let n = 0;
      while (c.pc !== ret && n++ < 2000000) if (!safeStep()) break;
      if (c.pc !== ret) { sMsg.textContent = 'Step over did not return within 2M instructions'; sMsg.style.color = '#ffd479'; }
      refresh();
    };
    const breakRun = () => { stop(); refresh(); sMsg.textContent = 'Paused'; sMsg.style.color = '#8a93a3'; };

    const run = () => {
      const r = build(); if (!r) return;
      const e = emu();
      if (runSel.value === 'atari') {
        if (!e) { msg(out.textContent + '\n\nThe Atari is not running. Boot it first, or choose "Run in simulator".', true); return; }
        stop(); e.bootFile('PROGRAM.XEX', r.xex); out.textContent += '\n\nStarted on the Atari.'; sMsg.textContent = 'Started on the Atari'; refresh(); return;
      }
      st.sim = null; loadSim(r); runSim();
    };

    // ---------- views ----------
    const memAt = (a, n) => { const e = runSel.value === 'atari' && emu(); if (e) return Uint8Array.from(e.peek(a, n)); if (st.mem) return st.mem.subarray(a, a + n); return new Uint8Array(n); };
    const refresh = () => {
      const e = emu(), c = st.sim;
      sDev.textContent = (st.run ? '● sim running' : c ? '○ sim paused' : '○ sim idle') + ' | Atari ' + (e ? 'connected' : 'not connected');
      sDev.style.color = st.run ? '#7be07b' : '#8a93a3';
      sRegs.textContent = c ? `PC=${hx(c.pc, 4)} A=${hx(c.a, 2)} X=${hx(c.x, 2)} Y=${hx(c.y, 2)} S=${hx(c.sp, 2)} ${c.N ? 'N' : '-'}${c.V ? 'V' : '-'}-${c.D ? 'D' : '-'}${c.I ? 'I' : '-'}${c.Z ? 'Z' : '-'}${c.C ? 'C' : '-'} cyc=${c.cycles}` : 'PC=---- A=-- X=-- Y=-- S=--';
      if (st.toggles.dis && W) {
        if (!st.last && !c) build(true);
        let a = c ? c.pc : (segSel.value ? +segSel.value : st.last && st.last.segments[0] ? st.last.segments[0].addr : 0x2000), txt = [];
        const L = labels(), m = st.mem || (st.last ? (() => { const x = new Uint8Array(65536); for (const s of st.last.segments) x.set(s.bytes, s.addr); return x; })() : new Uint8Array(65536));
        for (let k = 0; k < 24 && a < 65536; k++) { const r = W.disasm1(m, a, a, { labels: L }); txt.push((c && a === c.pc ? '▶ ' : '  ') + (L[a] && a !== (c && c.pc) ? (L[a] + ':\n  ') : '') + hx(a, 4) + '  ' + r.bytes.map((b) => hx(b, 2)).join(' ').padEnd(8) + '  ' + r.text); a += r.len; }
        dis.textContent = txt.join('\n');
      }
      if (st.toggles.watch) {
        const [a, n] = wIn.value.trim().split(/\s+/).map((x) => parseInt(x.replace(/^\$/, ''), 16));
        if (a >= 0 && a < 65536) {
          const len = Math.min(n > 0 ? n : 64, 512, 65536 - a), d = memAt(a, len), rows = [];
          for (let i = 0; i < len; i += 8) rows.push(hx(a + i, 4) + ': ' + Array.from(d.subarray(i, i + 8)).map((b) => hx(b, 2)).join(' '));
          wOut.textContent = rows.join('\n');
        }
      }
      if (st.toggles.mirror) {
        const e2 = emu();
        if (!e2) mirror.textContent = 'Atari not connected.';
        else { const p = e2.peek(0x58, 2), sa = p[0] | p[1] << 8, d = e2.peek(sa, 960), rows = []; for (let r = 0; r < 24; r++) rows.push(String.fromCharCode(...Array.from(d.slice(r * 40, r * 40 + 40), (b) => { b &= 127; const ch = b < 64 ? b + 32 : b < 96 ? b - 64 : b; return ch >= 32 && ch < 127 ? ch : 46; }))); mirror.textContent = rows.join('\n'); }
      }
    };
    const poll = setInterval(() => { if (win.style.display !== 'none' && (st.toggles.mirror || (st.toggles.watch && !st.run) || !st.run)) refresh(); }, 500);

    // ---------- file / export ----------
    const dl = (name, parts, type) => { const a = el('a'); a.href = URL.createObjectURL(new Blob(parts, { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
    const exportAs = (ext) => { const r = build(); if (r) dl('PROGRAM.' + ext, [r.xex], 'application/octet-stream'); };
    const fi = el('input'); fi.type = 'file'; fi.multiple = true; fi.accept = '.asm,.s,.txt,.a65,.inc,.fnt,.bin'; fi.style.display = 'none';
    fi.onchange = async () => {
      const files = [...fi.files]; let first = true;
      for (const f of files) {
        const isText = /\.(asm|s|txt|a65|inc)$/i.test(f.name);
        if (isText) { const t = (await f.text()).replace(/\r\n?/g, '\n'); if (first && /\.(asm|s|a65)$/i.test(f.name)) { ed.value = t; first = false; } if (AC.Buffers) AC.Buffers.set(f.name, t, { source: 'asm-load' }); }
        else if (AC.Buffers) AC.Buffers.set(f.name, new Uint8Array(await f.arrayBuffer()), { source: 'asm-load' });
      }
      fi.value = ''; sMsg.textContent = `Loaded ${files.length} file(s); other files are available to .INCLUDE / .INCBIN by name`;
    };

    // fixed-height ribbon: bordered .ribbon-group cards, 9px uppercase footer labels, kbd pills for accelerators
    const kbd = (t) => el('kbd', 'font:9px Consolas,monospace;background:#0d0f12;border:1px solid #4a5160;border-radius:3px;padding:0 3px;margin-left:4px;color:#9bd1ff', t);
    const kbtn = (t, key, f, tip) => { const b = btn(t, f, tip); if (key) b.append(kbd(key)); return b; };
    const grp = (label, ...items) => {
      const g = el('div', 'display:flex;flex-direction:column;justify-content:space-between;height:35px;padding:2px 5px 0;border:1px solid #3a4150;border-radius:5px;flex:none;box-sizing:border-box'); g.className = 'ribbon-group';
      const row = el('div', 'display:flex;gap:4px;align-items:center;height:21px'); row.append(...items);
      g.append(row, el('div', 'font:9px system-ui;text-transform:uppercase;letter-spacing:.06em;color:#8a93a3;line-height:9px;text-align:center', label)); return g;
    };
    const preset = (t, addr, len, tip) => btn(t, () => { wIn.value = hx(addr, 4) + ' ' + hx(len, 3); if (!st.toggles.watch) { st.toggles.watch = true; layout(); } refresh(); }, tip);
    const dlistPreset = btn('DList', () => { const e = emu(), m = st.mem; const p = e ? e.peek(0x230, 2) : m ? [m[0x230], m[0x231]] : [0, 0]; wIn.value = hx(p[0] | p[1] << 8, 4) + ' 20'; if (!st.toggles.watch) { st.toggles.watch = true; layout(); } refresh(); }, 'Watch the display list (SDLSTL $230)');
    const disRam = btn('Disasm RAM', () => {
      const e = emu(); if (!W) return msg('Disassembler (wtools.js) is not loaded.', true); if (!e) return msg('The Atari is not running. Boot it first.', true);
      const v = prompt('Disassemble RAM: start address (hex) and length (hex), e.g. 2000 80', '2000 80'); if (!v) return;
      const [a, n] = v.trim().split(/\s+/).map((x) => parseInt(x.replace(/^\$/, ''), 16));
      if (!(a >= 0 && a < 65536) || !(n > 0)) return msg('Give a start address and a length in hex.', true);
      msg(W.disasm(e.peek(a, Math.min(n, 65536 - a)), a, {}));
    }, 'Disassemble memory of the running Atari');
    bar.append(
      grp('Build & Emit', kbtn('Assemble', 'F7', () => { build(); refresh(); }, 'Assemble (F7)'), btn('Clean&Link', cleanBuild, 'Reset the simulator and rebuild'), btn('.XEX', () => exportAs('XEX'), 'Export Atari binary load file'), btn('.COM', () => exportAs('COM'), 'Export as DOS .COM'),
        btn('Listing', () => { const r = build(); if (r) msg(r.listingText || '(no code)'); }, 'Addresses, bytes and source')),
      grp('Execution & Trace', kbtn('Run', 'F5', run, 'Assemble and run (F5)'), kbtn('Break', 'F6', breakRun, 'Pause the simulator (F6)'), kbtn('Over', 'F10', stepOver, 'Step over (simulator)'), kbtn('Into', 'F11', stepInto, 'Step into (simulator)'), bpIn),
      grp('Architecture', cpuSel, runSel, cycIn),
      grp('Segment Views', segSel, toggle('Disasm', 'dis', 'Disassembly view'), preset('ZP', 0, 0x40, 'Watch zero page'), dlistPreset, preset('POKEY', 0xD200, 0x10, 'Watch POKEY registers'), disRam),
      grp('Scratchpads', toggle('Watch', 'watch', 'Watch RAM (hex peek)'), toggle('Screen', 'mirror', 'Live text screen mirror from the Atari')),
      grp('File', btn('Load', () => fi.click(), 'Load .asm (and .inc/.fnt files for INCLUDE)'), btn('Save', () => dl('PROGRAM.ASM', [ed.value.replace(/\n/g, '\r\n')], 'text/plain')),
        btn('Sample', () => { ed.value = SAMPLE; }), btn('Font', () => { ed.value = FONT_SAMPLE; }, 'Sample: include the font open in the Font editor (unsaved is fine)')),
      el('span', 'flex:1'), dock ? el('span') : btn('X', () => { stop(); win.style.display = 'none'; }));
    win.append(bar, ed, panes, status, fi);
    layout(); refresh();

    // keys: F7 / F5 / F6 / F10 / F11 inside the panel
    win.addEventListener('keydown', (ev) => {
      const k = { F7: () => { build(); refresh(); }, F5: run, F6: breakRun, F10: stepOver, F11: stepInto }[ev.key];
      if (k) { ev.preventDefault(); k(); }
    });
    // in-memory buffers changed elsewhere (e.g. the Font editor): tell the user the build is stale
    const onBuf = (e) => {
      if (e.remote === undefined && e.meta && e.meta.source === 'asm-load') return;
      const p = e.path || ''; for (const u of st.used) { const b = (x) => x.slice(x.lastIndexOf('/') + 1); if (u === p || b(u) === b(p)) { sMsg.textContent = `"${p}" changed in memory: press F7/F5 to rebuild with it`; sMsg.style.color = '#ffd479'; return; } }
    };
    if (AC.Buffers) AC.Buffers.on(onBuf);
    win.addEventListener('remove', () => clearInterval(poll));

    let dx = 0, dy = 0, drag = false;
    bar.onmousedown = (e) => { if (dock) return; if (e.target !== bar) return; drag = true; const r = win.getBoundingClientRect(); dx = e.clientX - r.left; dy = e.clientY - r.top; };
    window.addEventListener('mousemove', (e) => { if (drag) { win.style.left = e.clientX - dx + 'px'; win.style.top = e.clientY - dy + 'px'; win.style.right = 'auto'; } });
    window.addEventListener('mouseup', () => { drag = false; });
    (dock || document.body).append(win);
    Object.assign(AC.AsmPanel, { el: win, editor: ed, build, run, breakRun, stepOver, stepInto, cleanBuild, exportAs, state: st, refresh });
    return win;
  }
  AC.AsmPanel = { open };
})();
