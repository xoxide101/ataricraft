# Changelog

## v8.0 (2026-11-04)

Everything here was tested in the emulator (both cores where noted) and with scripted checks. **Nothing has been run on real Atari or FujiNet hardware, and no audio, print dialog or font look was judged on a real device.**

### FujiNet and the relay
- **N: device** (`web/js/ndev.js`): HTTP/HTTPS, TCP, UDP, TNFS and SD: folders through the relay; a 6502 CIO handler (`nhandler.inc`) so normal CIO programs can open `N:`.
- **One-command start:** the relay serves the emulator, makes a token and prints the address (`start.cmd` / `start.sh`). See `docs/GETTING-STARTED.md`.
- **SD: from a relay folder** (`--sd`), **TNFS writes** with `--allow-write`.
- **Network diagnostics:** `PING`, `NSLOOKUP`, `TRACERT` (`tools/net/netdiag.asm`). Each asks the relay first (`N:HTTP://diag.ataricraft/ping|dns|trace/<host>`, real OS ping/tracert/DNS). Without the relay, PING times TCP connects, NSLOOKUP uses DNS-over-HTTPS, TRACERT says it needs the relay (FujiNet has no ICMP or TTL control). `scripts/netdiag-test.cjs`.
- **N: apps:** `WGET`, `CURL`, `LYNX`, `JQ`, `MAIL` (POP3/SMTP, plain text), `NC`.
- **P: printer** (SIO device `\`) with a WYSIWYG paper window (PNG, text or browser print).

### AFM / WebAFM
- AFM browses and operates on `N:` drives (keys 9/0): copy, move, delete, rename, mkdir.
- AFM `H` prints the pane listing to `P:`.
- **AFM80 new 3x7 font:** lowercase, descenders and `{ | } ~ \``; exported as `web/library/fonts/atari/Afm3x7.fnt`.
- WebAFM: 2x2 four-pane layout, FujiNet N: pane source, mount the relay SD folder or a TNFS server as a drive, print directory / disk label / catalog on Letter, Legal and Tabloid.

### Languages and tools
- **Atari BASIC to 6502 compiler** (integer subset) to ASM or XEX, with a BASIC tab to compile and run (`docs/LANGUAGES.md` has the plan for other languages).
- **`tui.inc`:** Atari text-mode UI library (windows, menus, dialogs, ST mouse) with demo and tests.
- **Fonts:** local font library (import FNT / TTF / ZIP), TTF/OTF to Atari 8x8 conversion in the FONT tab, bundled public-domain and OFL fonts (`AtariPixel8.fnt`, `Kidpixies12.fnt`, PressStart2P, Connection). Your own third-party fonts stay in `web/library/fonts/personal/`, which is git-ignored.

### Tools disk
`AtariCraft Tools 360K.atr` (MyDOS, no DOS on it) now holds every tool on one disk: AFM, AFM80, CMD, VIEW, NANO, CALC, 80COL, the 8 archive tools, the hardware tests, MIDIPLAY / MP3PLAY with demo files, and all the network tools. About 370 sectors are free. Rebuild: `node tools/net/build.cjs; node tools/tests/build.cjs; node tools/make-tools-disk.cjs`.

### Fixes
- Netdiag: a label named `nodiag` clashed with the `NODIAG` build flag (MADS labels are case-insensitive), which disabled the relay attempt.
- `tools/tests/build.cjs` now builds the shared-include apps (CURL, JQ, MAIL, NC) and falls back to the Workbench assembler for `lynx.asm`; before, a plain run deleted their `.COM` files.
- Bundled fonts were being skipped by the `web/library/*` ignore rule; they are now tracked.
- Several N: CIO, 8.3 listing and wildcard fixes in AFM and ndev.

### Known gaps
Real-hardware behaviour, real FujiNet fallbacks, TUI mouse, NLQ and `.64c` font import, fonts in the P: printer, 5200 keypad and carts. See `NOTES.md`.
