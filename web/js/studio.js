/* Craft Studio shell: header, tab strip (Alt+1..4), one 40px ribbon row per tab. Reuses the emulator page, the IDE panel and the font editor
   (iframes stay alive across tab switches, so unsaved font edits and the emulator keep their state). Buffers go through AC.Buffers. */
(function () {
  const AC = window.AC, $ = (id) => document.getElementById(id), W = AC.WTools;
  const el = (t, css, txt) => { const e = document.createElement(t); if (css) e.style.cssText = css; if (txt) e.textContent = txt; return e; };
  const TABS = [['mgr', '4-Pane Manager'], ['ide', 'Web 6502 IDE'], ['font', 'Font / Glyph Studio'], ['disk', 'Disk & Flux Inspector']];
  const frames = {};
  const ribbon = $('ribbon'), rows = {};

  const btn = (t, f, tip, key, disabled) => { const b = el('button', '', t); if (tip) b.title = tip; if (f) b.onclick = f; if (key) b.append(Object.assign(el('kbd', '', key))); if (disabled) b.disabled = true; return b; };
  const grp = (label, ...items) => { const g = el('div'); g.className = 'ribbon-group'; const i = el('div'); i.className = 'items'; i.append(...items); const l = el('div'); l.className = 'lbl'; l.textContent = label; g.append(i, l); return g; };
  const row = (id, ...groups) => { const r = el('div'); r.className = 'row'; r.id = 'r-' + id; r.append(...groups); ribbon.append(r); rows[id] = r; return r; };
  const toast = (t) => { $('tel').textContent = t; };
  const pickFile = (accept, cb) => { const i = el('input'); i.type = 'file'; i.accept = accept; i.onchange = async () => { if (i.files[0]) cb(i.files[0], new Uint8Array(await i.files[0].arrayBuffer())); }; i.click(); };
  const ide = () => AC.AsmPanel;

  // ---------- tabs ----------
  let cur = null;
  function show(id) {
    if (!frames[id] && id === 'mgr') { frames.mgr = el('iframe'); frames.mgr.src = 'index.html'; $('p-mgr').append(frames.mgr); hookKeys(frames.mgr); }
    if (!frames[id] && id === 'font') { frames.font = el('iframe'); frames.font.src = 'fontedit.html'; $('p-font').append(frames.font); hookKeys(frames.font); }
    if (id === 'ide' && !ide().el) { const w = ide().open({ dock: $('p-ide') }); const bar = w.firstChild; bar.style.flex = '1'; bar.style.minWidth = '0'; rows.ide.prepend(bar); }
    for (const [k] of TABS) { $('p-' + k).classList.toggle('on', k === id); rows[k].classList.toggle('on', k === id); }
    [...$('tabs').children].forEach((b, i) => b.classList.toggle('on', TABS[i][0] === id));
    cur = id; location.hash = id; if (id === 'ide') ide().refresh();
  }
  function hookKeys(f) { f.addEventListener('load', () => { try { f.contentWindow.addEventListener('keydown', keys); } catch (e) { /* cross-origin */ } }); }
  function keys(e) { if (e.altKey && /^[1-4]$/.test(e.key)) { e.preventDefault(); show(TABS[+e.key - 1][0]); } }
  window.addEventListener('keydown', keys);
  TABS.forEach(([id, name], i) => { const b = btn(name, () => show(id), 'Alt+' + (i + 1), 'Alt+' + (i + 1)); $('tabs').append(b); });

  // ---------- Manager ribbon ----------
  const openInIde = (f, bytes) => {
    show('ide'); const ed = ide().editor;
    ed.value = /\.(asm|s|a65|txt|inc)$/i.test(f.name) ? new TextDecoder().decode(bytes).replace(/\r\n?/g, '\n') : W.disasmFile(bytes, 0x2000, {}); ed.focus();
  };
  row('mgr',
    grp('Physical Ingest', btn('Mount D1', null, 'Use the File manager inside this tab', '', 1), btn('Greaseweazle flux', null, 'Needs hardware (WebUSB): not implemented', '', 1), btn('Raw sector stream', null, 'Not implemented', '', 1)),
    grp('Container Tools', btn('New ATR/XFD', null, 'Use WebAFM inside this tab', '', 1), btn('Pack 90K/130K', null, 'Not implemented here', '', 1), btn('Verify CRC', null, 'Not implemented here', '', 1)),
    grp('FujiNet / Network', btn('FujiNet Explorer', () => window.open('fujiexplorer.html', '_blank'), 'TNFS/SD/FTP browser (new tab)')),
    grp('Batch Transcode', btn('Disassemble binary', () => pickFile('*', openInIde), 'Disassemble an XEX/COM/binary into the IDE editor'), btn('To BASIC / Markdown', null, 'Not implemented here', '', 1)),
    grp('Direct Launch', btn('Open in IDE', () => pickFile('.asm,.s,.a65,.txt,.inc,.xex,.com,.bin', openInIde), 'Source opens as text, binaries open disassembled'),
      btn('Boot in emulator', () => pickFile('.xex,.com,.exe,.obx', (f, b) => { const e = AC.BasicHost.emu(); if (!e) return toast('emulator not linked: boot it in this tab first'); e.bootFile(f.name, b); }), 'Boot a binary load file in the linked emulator')));

  // ---------- IDE ribbon: the panel's own ribbon is moved in on first show ----------
  row('ide');

  // ---------- Font ribbon: drives the font editor page; the working 8x8 set is published as the in-memory buffer assets/font.fnt ----------
  const F = () => { try { return frames.font && frames.font.contentWindow; } catch (e) { return null; } };
  const click = (id) => () => { const w = F(); const b = w && w.document.getElementById(id); if (b) b.click(); else toast('Font editor not ready'); };
  const bytesTable = () => {
    const b = AC.Buffers.resolve('assets/font.fnt'); if (!b) return null;
    const rows = []; for (let i = 0; i < b.length; i += 8) rows.push(' .byte ' + Array.from(b.slice(i, i + 8), (x) => '$' + x.toString(16).toUpperCase().padStart(2, '0')).join(','));
    return 'font' + '\n' + rows.join('\n') + '\n';
  };
  row('font',
    grp('Select', btn('Glyph picker', click('bchoose'), 'Open the big font chooser'), btn('ROM charset', click('bemurom'), 'Open the Atari ROM charset (revert to base ROM)')),
    grp('Bitwise', btn('Shift', click('bshift'), 'Shift the selected glyphs by the dx/dy in the editor'), btn('Weight +', click('bwplus')), btn('Weight -', click('bwminus'))),
    grp('Export', btn('.FNT 1024B', click('bfnt'), 'Export the 1024-byte charset'), btn('.BYTE table', () => { const t = bytesTable(); if (!t) return toast('no font buffer yet'); AC.Buffers.set('assets/font.inc', t, { source: 'studio' }); toast('assets/font.inc buffer written; .INCLUDE it in the IDE'); }, 'Emit the 8x8 set as .BYTE lines into the buffer assets/font.inc'), btn('.inc', click('binc'))),
    grp('Commit', btn('Commit to buffer', () => { const w = F(); if (w && w.FE && w.FE.publishBuffer) { w.FE.publishBuffer(); toast('assets/font.fnt updated in memory'); } else toast('Font editor not ready'); }, 'Publish the working set as assets/font.fnt (also done automatically on every edit)'), btn('Install in Atari', click('binstall'), 'Put the set into the running emulator')),
    grp('Preview', btn('Invert / mirror / 1-bit vs 2-bit', null, 'Not implemented', '', 1)));

  // ---------- Disk & Flux stub ----------
  row('disk',
    grp('Drive', btn('Motor', null, '', '', 1), btn('Step', null, '', '', 1), btn('Recalibrate', null, '', '', 1)),
    grp('Track', Object.assign(el('select'), { disabled: true, innerHTML: '<option>Track 0</option>' })),
    grp('Flux', btn('Scope', null, '', '', 1), btn('Weak-bit jitter', null, '', '', 1), btn('Force CRC', null, '', '', 1)),
    grp('Save', btn('.SCP / .RAW', null, '', '', 1), btn('Generate .ATX', null, '', '', 1)));

  // ---------- header: profile, transport, telemetry ----------
  const prof = $('profile'); prof.value = localStorage.getItem('ac.studio.profile') || '130xe'; prof.onchange = () => { localStorage.setItem('ac.studio.profile', prof.value); telemetry(); };
  const needIde = (f) => () => { show('ide'); f(); };
  $('tRun').onclick = needIde(() => ide().run()); $('tStep').onclick = needIde(() => ide().stepOver()); $('tPause').onclick = needIde(() => ide().breakRun()); $('tReset').onclick = needIde(() => ide().cleanBuild());
  function telemetry() {
    const r = ide().state && ide().state.last, s = ide().state && ide().state.sim, link = AC.ToolsLink.status();
    if (r && r.segments.length) {
      const lo = Math.min(...r.segments.map((x) => x.addr)), hi = Math.max(...r.segments.map((x) => x.addr + x.bytes.length - 1)), n = r.segments.reduce((a, x) => a + x.bytes.length, 0);
      const warn = [], io = r.segments.some((x) => x.addr < 0xD800 && x.addr + x.bytes.length > 0xD000), run = r.segments.some((x) => x.addr === 0x2E0 || x.addr <= 0x2E0 && x.addr + x.bytes.length > 0x2E0);
      if (io) warn.push('overlaps $D000-$D7FF I/O'); if (!run) warn.push('no RUN vector');
      $('tel').textContent = `image ${n} B  $${lo.toString(16).toUpperCase()}-$${hi.toString(16).toUpperCase()}` + (s ? `  cyc ${s.cycles}` : '') + (warn.length ? '  ⚠ ' + warn.join(', ') : '');
    } else $('tel').textContent = 'footprint: -';
    $('link').textContent = 'emulator: ' + (link.connected ? 'linked' + (link.info && link.info.model ? ' (' + link.info.model + ')' : '') : 'not linked');
  }
  setInterval(telemetry, 500);
  AC.Studio = { show, tab: () => cur, telemetry };
  const h = location.hash.slice(1); show(TABS.some((t) => t[0] === h) ? h : 'ide');
})();
