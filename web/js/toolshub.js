/* Craft Tools & Workbench hub: menu, search, hash routing, emulator link status (docs/TOOLSHUB.md). */
(function () {
  const AC = window.AC;
  const T = [
    { id: 'basic', g: 'Development', n: 'BASIC', d: 'Atari BASIC editor and compiler; compile and run on the connected emulator.', k: 'basic compiler editor program', panel: () => AC.BasicPanel.open(), emu: 1 },
    { id: 'studio', g: 'Development', n: 'Craft Studio', d: 'Tabbed workbench: emulator manager, 6502 IDE with simulator/debugger, Font studio and disk inspector, one ribbon per tab (Alt+1..4).', k: 'studio ide workbench shell tabs ribbon', url: 'studio.html' },
    { id: 'asm', g: 'Development', n: 'ASM', d: '6502 assembler with listing; assemble and inject into emulator memory.', k: 'assembler 6502 macro listing', panel: () => AC.AsmPanel.open(), emu: 1 },
    { id: 'insp', g: 'Development', n: 'Inspect', d: 'RAM page map, N: network log, IP settings, extended banks, memory poke/dump, remote control.', k: 'inspect ram memory network banks remote debug', panel: () => AC.InspectPanel.open(), emu: 1 },
    { id: 'wb', g: 'Data in/out', n: 'Workbench', d: 'MIDI to POKEY converter and SAP editor.', k: 'workbench midi pokey sap music audio', url: 'workbench.html' },
    { id: 'fontedit', g: 'Data in/out', n: 'Font editor', d: 'Make and edit fonts for every Craft app: all sizes, Atari character sets, import and export, install into the running emulator.', k: 'font editor charset character glyph ttf', url: 'fontedit.html' },
    { id: 'xcw', g: 'Hybrid apps (web twin + Atari companion)', n: 'xCWriter', d: 'Word processor for Atari documents.', k: 'writer word processor text document', url: 'xcwriter.html' },
    { id: 'xcc', g: 'Hybrid apps (web twin + Atari companion)', n: 'xCCalc', d: 'Spreadsheet.', k: 'calc spreadsheet', url: 'xccalc.html' },
    { id: 'xcb', g: 'Hybrid apps (web twin + Atari companion)', n: 'xCBase', d: 'Database.', k: 'base database records', url: 'xcbase.html' },
    { id: 'ebc', g: 'Hybrid apps (web twin + Atari companion)', n: 'EBookCraft', d: 'E-book reader and builder.', k: 'ebook book reader epub', url: 'ebookcraft.html' },
    { id: 'pdf', g: 'Data in/out', n: 'PDF', d: 'PDF viewer; can send files to the emulator.', k: 'pdf viewer document', url: 'pdfview.html' },
    { id: 'fujiexplorer', g: 'Data in/out', n: 'FujiNet Explorer', d: 'Browse FujiNet and network resources.', k: 'fujinet explorer network tnfs', url: 'fujiexplorer.html' }
  ];
  const ALIAS = { font: 'fontedit', inspect: 'insp', workbench: 'wb', xcwriter: 'xcw', xccalc: 'xcc', xcbase: 'xcb', ebookcraft: 'ebc' };
  const $ = (id) => document.getElementById(id);
  const root = $('groups');

  function launch(t) {
    if (t.panel) { AC.ToolsLink.wantMirror(); t.panel(); } else window.open(t.url, '_blank');
  }

  function render() {
    const q = $('q').value.trim().toLowerCase();
    root.textContent = '';
    let any = false;
    for (const g of ['Development', 'Data in/out', 'Hybrid apps (web twin + Atari companion)']) {
      const items = T.filter((t) => t.g === g && (!q || (t.n + ' ' + t.d + ' ' + t.k).toLowerCase().includes(q)));
      if (!items.length) continue;
      any = true;
      const h = document.createElement('h2'); h.textContent = g;
      const grid = document.createElement('div'); grid.className = 'grid';
      for (const t of items) {
        const c = document.createElement('div'); c.className = 'card'; c.tabIndex = 0; c.dataset.tool = t.id;
        c.innerHTML = '<b></b><span></span><div class="tag"></div>';
        c.children[0].textContent = t.n; c.children[1].textContent = t.d;
        c.children[2].textContent = t.panel ? (t.emu ? 'opens here · needs emulator' : 'opens here') : 'opens in a new tab';
        c.onclick = () => { launch(t); };
        c.onkeydown = (e) => { if (e.key === 'Enter') launch(t); };
        grid.append(c);
      }
      root.append(h, grid);
    }
    $('none').style.display = any ? 'none' : 'block';
  }

  function route() {
    const h = decodeURIComponent(location.hash.replace(/^#/, '')).toLowerCase();
    const t = T.find((x) => x.id === (ALIAS[h] || h));
    if (t && t.panel) launch(t);
    else if (t && t.id === 'fontedit') location.replace('fontedit.html');
  }

  AC.ToolsLink.onChange((s) => {
    $('status').classList.toggle('on', s.connected);
    $('stxt').textContent = s.connected ? 'Emulator connected' + (s.info && s.info.model ? ' (' + s.info.model + ')' : '') : 'Emulator not connected';
    $('openemu').textContent = s.connected ? 'Show emulator' : 'Open emulator';
  });
  $('openemu').onclick = () => AC.ToolsLink.openEmulator();
  $('q').oninput = render;
  window.addEventListener('hashchange', route);
  // pdfview opens from this page and asks its opener to boot a file in the emulator
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.origin === location.origin && d && d.type === 'ac-boot' && d.bytes) AC.ToolsLink.emu().bootFile(d.name || 'FILE.XEX', new Uint8Array(d.bytes));
  });
  render();
  route();
})();
