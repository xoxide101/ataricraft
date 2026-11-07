// Link to the Atari emulator tab (js/toolshub-link.js): read the ROM character set, install the current 8x8 set into the running Atari.
// Also lists fonts kept by the old Tools font library (js/fontlib.js) so nothing imported earlier is lost.
(() => {
  'use strict';
  const FE = window.FE, AC = window.AC || {}, CF = FE.CF, $ = FE.$, st = FE.state;
  const INSTALL = 0x9800, CHBAS = 756;
  const emu = () => (AC.ToolsLink && AC.ToolsLink.emu ? AC.ToolsLink.emu() : null);

  const status = () => {
    const s = AC.ToolsLink && AC.ToolsLink.status ? AC.ToolsLink.status() : { connected: false };
    const el = $('emustat'); if (!el) return;
    el.classList.toggle('on', !!s.connected);
    el.textContent = s.connected ? 'Emulator connected' : 'Emulator not connected';
    el.title = s.connected ? 'You can load the ROM character set and install fonts into the running Atari' : 'Click to open the Atari emulator in another tab';
  };
  if (AC.ToolsLink) AC.ToolsLink.onChange(status);
  status();
  $('emustat').onclick = () => { if (AC.ToolsLink && !AC.ToolsLink.connected()) AC.ToolsLink.openEmulator(); };

  FE.installInEmulator = () => {
    const e = emu();
    if (!e) { FE.toast('The Atari emulator is not connected. Click "Emulator not connected" at the top to open it, then boot it.'); return false; }
    const f8 = FE.atari8(true); if (!f8) { FE.toast('There is no 8x8 size to send'); return false; }
    e.poke(INSTALL, Array.from(CF.toFnt(f8))); e.poke(CHBAS, [INSTALL >> 8]);
    FE.toast('Installed in the running Atari (RAM $9800, CHBAS set). A program that resets CHBAS or uses that RAM will replace it.');
    return true;
  };

  // ---- ROM character set: emulator, ROMs the emulator page keeps in this browser, the library file, or a ROM file you pick ----------------
  const SIG = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0x18, 0x18, 0x18, 0x18, 0, 0x18, 0];
  const isSig = (b, o) => o >= 0 && o + 1024 <= b.length && SIG.every((v, i) => b[o + i] === v);
  // The 1024-byte set sits at $E000: offset 0x2000 in a 16 KB XL/XE OS ROM, 0x800 in a 10 KB 400/800 OS ROM, 0 in an 8 KB ROM or a plain .fnt.
  FE.romCharset = (bytes) => {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const first = { 16384: 0x2000, 10240: 0x800, 8192: 0, 1024: 0 }[b.length];
    if (first !== undefined && isSig(b, first)) return b.slice(first, first + 1024);
    for (let o = 0; o + 1024 <= b.length; o += 0x400) if (isSig(b, o)) return b.slice(o, o + 1024);
    return null;
  };
  const savedRoms = async () => {
    try {
      if (!indexedDB.databases || !(await indexedDB.databases()).some((d) => d.name === 'ataricraft')) return [];
      const db = await new Promise((ok, no) => { const q = indexedDB.open('ataricraft'); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); });
      if (!db.objectStoreNames.contains('roms')) { db.close(); return []; }
      const all = await new Promise((ok) => { const r = db.transaction('roms').objectStore('roms').getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => ok([]); });
      db.close(); return all;
    } catch (e) { return []; }
  };
  const openSet = async (set, name, from) => {
    await FE.openBytes(set, name, { keep: false });
    FE.toast('Loaded the Atari character set from ' + from + ' (8x8, 128 glyphs plus inverse). It is kept only in this session; use Keep in My fonts to save it.');
    return true;
  };
  FE.openRomBytes = async (bytes, name) => {
    const set = FE.romCharset(bytes);
    if (!set) { FE.toast('"' + name + '" (' + bytes.length + ' bytes) has no Atari character set. Choose an Atari OS ROM such as ATARIXL.ROM (16 KB), a 400/800 OS ROM (10 KB) or a 1024-byte .fnt.'); return false; }
    return openSet(set, 'Atari ROM charset.fnt', name);
  };
  FE.loadRomFromEmulator = async () => {
    const e = emu();
    let bytes = AC.BasicHost && AC.BasicHost.romFont ? AC.BasicHost.romFont() : null;
    if (!bytes && e) bytes = e.peek(0xE000, 1024);
    const set = bytes && bytes.length >= 1024 ? FE.romCharset(new Uint8Array(Array.from(bytes).slice(0, 1024))) : null;
    if (!set) return false;
    return openSet(set, 'Atari ROM charset (emulator).fnt', 'the emulator');
  };
  FE.openRomCharset = async () => {
    try {
      if (await FE.loadRomFromEmulator()) return true;
      const rank = (r) => ({ osxl: 0, os800: 1 }[r.kind] === undefined ? 2 : { osxl: 0, os800: 1 }[r.kind]);
      for (const r of (await savedRoms()).sort((x, y) => rank(x) - rank(y))) {
        const set = r.bytes && FE.romCharset(new Uint8Array(r.bytes.buffer ? r.bytes : r.bytes));
        if (set) return await openSet(set, 'Atari ROM charset.fnt', 'the ROM "' + r.name + '" saved by the emulator page');
      }
      try { if (location.protocol === 'file:') throw new Error('no fetch from file://'); const res = await fetch('library/fonts/local/atarirom.fnt'); if (res.ok) { const set = FE.romCharset(new Uint8Array(await res.arrayBuffer())); if (set) return await openSet(set, 'Atari ROM charset.fnt', 'the font library'); } } catch (e) { /* not available from file:// or not installed */ }
      FE.toast('No Atari ROM found: the emulator is not connected and no ROM is saved in this browser. Choose ATARIXL.ROM (or any Atari OS ROM or .fnt) in the file window.');
      $('romfile').click();
    } catch (e) { FE.toast('Cannot load the Atari ROM character set: ' + e.message); }
    return false;
  };
  $('romfile').onchange = async () => {
    const f = $('romfile').files[0]; $('romfile').value = ''; if (!f) return;
    try { await FE.openRomBytes(new Uint8Array(await f.arrayBuffer()), f.name); } catch (e) { FE.toast('Cannot read ' + f.name + ': ' + e.message); }
  };

  $('bemurom').onclick = FE.openRomCharset;  $('binstall').onclick = FE.installInEmulator;
  if ($('binstall2')) $('binstall2').onclick = FE.installInEmulator;

  // Fonts imported earlier through the old Tools font library show up in the Fonts list.
  if (AC.FontLib && AC.FontLib.list) {
    AC.FontLib.list().then((L) => { FE.libFonts = L.filter((f) => f.kind === 'fnt' || f.kind === 'ttf'); FE.libChanged(); }).catch(() => { /* no database */ });
  }
})();
