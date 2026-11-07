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

  FE.loadRomFromEmulator = async () => {
    const e = emu();
    let bytes = AC.BasicHost && AC.BasicHost.romFont ? AC.BasicHost.romFont() : null;
    if (!bytes && e) bytes = e.peek(0xE000, 1024);
    if (!bytes || !bytes.length) { FE.toast('No Atari ROM character set is available. Connect the emulator with an OS ROM loaded, or open an Atari .fnt file.'); return false; }
    const b = new Uint8Array(bytes.length === 1024 ? bytes : Array.from(bytes).slice(0, 1024));
    await FE.openBytes(b, 'Atari ROM charset (emulator).fnt', { keep: false });
    FE.toast('Loaded the Atari character set from the emulator (kept only in this session, not saved to My fonts)');
    return true;
  };

  $('bemurom').onclick = FE.loadRomFromEmulator;
  $('binstall').onclick = FE.installInEmulator;
  if ($('binstall2')) $('binstall2').onclick = FE.installInEmulator;

  // Fonts imported earlier through the old Tools font library show up in the Fonts list.
  if (AC.FontLib && AC.FontLib.list) {
    AC.FontLib.list().then((L) => { FE.libFonts = L.filter((f) => f.kind === 'fnt' || f.kind === 'ttf'); FE.libChanged(); }).catch(() => { /* no database */ });
  }
})();
