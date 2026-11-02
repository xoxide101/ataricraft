// Assembler panel: edit 6502 source, assemble with web/js/asm6502.js, run the result on the emulated Atari or save it as an .XEX file.
(function () {
  const AC = (window.AC = window.AC || {});
  let win = null;
  const SAMPLE = `; Border colour cycle. Assemble, then Run on Atari.
        org $2000
start   inc $d01a        ; COLBK
        inc $d200        ; harmless read-modify-write on POKEY
        jmp start

        org $2e0         ; RUNAD
        .word start
`;
  const el = (t, css, txt) => { const e = document.createElement(t); if (css) e.style.cssText = css; if (txt) e.textContent = txt; return e; };

  function open() {
    if (win) { win.style.display = 'flex'; return; }
    const host = AC.BasicHost || {};
    win = el('div', 'position:fixed;z-index:9000;right:24px;top:24px;width:min(94vw,820px);height:min(88vh,620px);background:#1e2128;color:#d8dce4;border:1px solid #4a5160;border-radius:10px;box-shadow:0 8px 30px #000a;display:flex;flex-direction:column;font:13px system-ui,sans-serif;resize:both;overflow:hidden');
    const bar = el('div', 'display:flex;gap:6px;align-items:center;padding:6px 8px;background:#14161a;cursor:move;flex-wrap:wrap');
    const btn = (t, f, tip) => { const b = el('button', 'background:#2a2f39;color:#d8dce4;border:1px solid #3a4150;border-radius:5px;padding:3px 9px;font:inherit;cursor:pointer', t); if (tip) b.title = tip; b.onclick = f; return b; };
    const ed = el('textarea', 'flex:2;min-height:100px;background:#0d0f12;color:#e6e6e6;border:0;border-top:1px solid #2c313b;padding:8px;font:13px Consolas,monospace;resize:none;white-space:pre');
    ed.spellcheck = false; ed.value = localStorage.getItem('ac.asm.src') || SAMPLE;
    const out = el('pre', 'flex:1;min-height:70px;margin:0;padding:8px;background:#000;color:#9bd1ff;font:12px Consolas,monospace;overflow:auto;border-top:1px solid #2c313b');
    let last = null;
    const build = () => {
      localStorage.setItem('ac.asm.src', ed.value);
      try {
        const r = AC.Asm.assemble(ed.value); last = r;
        const segs = r.segments.map((s) => `$${s.addr.toString(16).toUpperCase().padStart(4, '0')}-$${(s.addr + s.bytes.length - 1).toString(16).toUpperCase().padStart(4, '0')}  ${s.bytes.length} bytes`);
        const syms = Object.entries(r.symbols).map(([k, v]) => `${k} = $${(v & 0xFFFF).toString(16).toUpperCase()}`).join('   ');
        out.style.color = '#9bd1ff'; out.textContent = `OK, ${r.xex.length} bytes\n${segs.join('\n')}\n\n${syms}`; return r;
      } catch (e) {
        last = null; out.style.color = '#ff7b7b'; out.textContent = e.message;
        const m = /^line (\d+)/.exec(e.message); if (m) { const ln = +m[1] - 1, ls = ed.value.split('\n'); const a = ls.slice(0, ln).join('\n').length + (ln ? 1 : 0); ed.focus(); ed.setSelectionRange(a, a + (ls[ln] || '').length); }
        return null;
      }
    };
    const run = () => {
      const r = build(); if (!r) return;
      const emu = host.emu && host.emu();
      if (!emu) { out.textContent += '\n\nThe Atari is not running. Boot it first (Boot button), then press Run.'; return; }
      emu.bootFile('PROGRAM.XEX', r.xex); out.textContent += '\n\nStarted on the Atari.';
    };
    const fi = el('input'); fi.type = 'file'; fi.accept = '.asm,.s,.txt,.a65'; fi.style.display = 'none';
    fi.onchange = async () => { if (fi.files[0]) ed.value = (await fi.files[0].text()).replace(/\r\n?/g, '\n'); fi.value = ''; };
    const dl = (name, parts, type) => { const a = el('a'); a.href = URL.createObjectURL(new Blob(parts, { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
    bar.append(el('b', '', 'ASM 6502'), btn('Assemble', build), btn('Run on Atari', run, 'Assemble and boot the program in the running emulator'),
      btn('Save .XEX', () => { const r = build(); if (r) dl('PROGRAM.XEX', [r.xex], 'application/octet-stream'); }),
      btn('Load .ASM', () => fi.click()), btn('Save .ASM', () => dl('PROGRAM.ASM', [ed.value.replace(/\n/g, '\r\n')], 'text/plain')),
      btn('Sample', () => { ed.value = SAMPLE; }), el('span', 'flex:1'), btn('X', () => { win.style.display = 'none'; }));
    win.append(bar, ed, out, el('div', 'padding:3px 8px;background:#14161a;color:#8a93a3;font-size:11px', 'MADS-style subset: labels, ORG, .BYTE/.WORD/.TEXT/.FILL, expressions. No macros or includes. Output matches MADS on the tests so far.'), fi);
    let dx = 0, dy = 0, drag = false;
    bar.onmousedown = (e) => { if (e.target !== bar) return; drag = true; const r = win.getBoundingClientRect(); dx = e.clientX - r.left; dy = e.clientY - r.top; };
    window.addEventListener('mousemove', (e) => { if (drag) { win.style.left = e.clientX - dx + 'px'; win.style.top = e.clientY - dy + 'px'; win.style.right = 'auto'; } });
    window.addEventListener('mouseup', () => { drag = false; });
    document.body.append(win);
  }
  AC.AsmPanel = { open };
})();
