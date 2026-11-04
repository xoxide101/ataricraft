# tui.inc - text-mode UI for the Atari 8-bit

A small 6502 library (MADS syntax, `icl 'tui.inc'` after your code, no ORG) for Borland/DOS-style screens in GR.0:
framed windows, a menu bar, pop-up menus, message boxes, and an Atari ST mouse pointer.

| Routine | Does |
|---|---|
| `tui_box` | Framed, cleared window at `TX,TY` size `TW,TH` |
| `tui_fill` | Fill a rectangle with screen code `TCH` |
| `tui_str` | Print the zero-terminated ATASCII string at `SP` at `TX,TY` (`TINV=$80` for inverse); returns length in A |
| `tui_inv` | Toggle inverse on `TW` cells of row `TY` |
| `tui_event` | Wait for input: A=1 key (`TKEY`, ATASCII) or A=2 click (`MX,MY`) |
| `tui_bar` / `tui_barhit` | Draw a menu bar from a string list; which title is under the pointer |
| `tui_menu` | Pop-up menu from a string list at `TX,TY`; returns the 0-based item or `$FF` (Esc / click outside) |
| `tui_msg` | Centred message box closed by Return, Esc or a click on `[ OK ]` |

String lists are zero-terminated strings ending with an extra `0`. Menu keys: up/down arrows (Ctrl+- / Ctrl+=), Return, Esc.
Pop-ups overwrite the screen under them, so the caller redraws afterwards. Zero page `$E0-$EF` is used.

`tuidemo.asm` shows all of it. Build: `..\..\out\mads\mads.exe tuidemo.asm -o:tuidemo.com`.

## Tests
- `node tools/tests/tui.test.cjs` - runs the demo on a node 6502: drawing, ST mouse quadrature, menu, dialog, quit (9 checks).
- `node scripts/tui-test.cjs` - boots the demo as AUTORUN.SYS in the emulator; Esc opens the pop-up menu (screenshots in `out/`).

## Not verified
- The mouse in the real emulator (decoded from the quadrature the emulator's ST-mouse mode produces) and on real hardware.
- The screen is assumed contiguous from SAVMSC (no 4K split); fine for the stock OS layout.
