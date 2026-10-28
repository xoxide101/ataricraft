# AFM - Atari File Manager (afm.com)

Two-pane 6502 file manager for DOS 2.0/2.5, MyDOS and SpartaDOS X. Load `AFM.COM` from DOS (binary load / `AFM.COM`).

## Keys
| Key | Action |
|---|---|
| W/S or -/= | move cursor |
| Tab / Space | switch pane |
| 1-8 | change drive |
| Return | run file / open folder (`..` goes up) |
| C D R | copy, delete, rename (use tags when set) |
| L U F X | lock, unlock, format, clear disk/folder |
| M K B | mkdir, rmdir, bulk mkdir (A-Z, 0-9 or both) |
| T A | tag file, tag all / clear |
| P | properties (tagged files too) |
| / N | find name, find next |
| V | view file (H toggles hex dump) |
| E | edit text file (up to ~16 KB) |
| G | new file (text, or press ESC H for hex entry), then ESC S to save |
| I | system info (also shown at start) |
| ? | help, Q quit |

Editor: arrows/Ctrl-arrows move, Backspace deletes, Return inserts a line break. Commands use an ESC prefix: ESC S save, ESC Q quit, ESC H hex, ESC U/D page, ESC T/E top/end. In hex mode (editing) type two hex digits (0-9 A-F) to overwrite the byte at the cursor or append at the end; Backspace deletes.

## Per-DOS notes
- DOS 2.0/2.5: no folders, 64 files per disk.
- MyDOS: folders supported; folder names cannot start with a digit (bulk 0-9 fails there).
- SpartaDOS X: folders supported; bulk mkdir is slow.

## Tested (in the ataricraft emulator only, not on real hardware)
Copy/tags/properties/find/mkdir/bulk mkdir on MyDOS, DOS 2 and SDX; viewer, hex view, edit+save+reload on DOS 2.0S; viewer/hex and save-error path on MyDOS; load/render/insert on SDX. New file (G) tested on DOS 2.5: create, save, "already exists", cancel; hex digit entry tested (41 42 FF). Editor save on SDX and on MyDOS (the beta image used rejects writes) is untested.

Build: `mads afm.asm -o:afm.com`.

## Screen updates
AFM no longer clears and redraws the whole screen after each action. Copy, delete, rename, lock, mkdir, cancel, pane switch and drive change repaint only what changed and re-read only the affected pane (and the other pane only when it shows the same drive).

Tested on DOS 2.0, DOS 2.5, DOS XL, MyDOS 4.55 and SpartaDOS X 4.43 (copy, delete, rename, cancel; DOS 2.0 also tab and drive change).

### Known limit: SuperDOS
SuperDOS keeps its resident code above $2000, where AFM loads, so booting SuperDOS and running AFM cannot read D1: safely. Boot another DOS and use the SuperDOS disk as D2 or higher (browsing works), or use the page's Browse files.

## 80-column build

Assemble with `mads afm.asm -d:COLS80=1 -o:afm80.com`. Uses a 4x8 glyph bitmap (ANTIC mode F) for the main file-manager screen; other screens (editor, viewer, help) fall back to 40 columns. Experimental: tested on the atari800 core only. Shipped as AFM80.COM and the disk 'DOS 2.5 boot + AFM 80-col.atr'.

