# Changelog

## Unreleased

- BASIC panel: `RESTORE line`, `COM`, inert `SAVE`/`CSAVE`/`CLOAD`/`STATUS`; pasted listings are cleaned (typographic quotes, `\*` escapes, wrapped lines). New **Debug** button: statement stepping, Continue, breakpoints (`break @ lines`) and a live variable/string/array view (`onStep` hook and `snapshot()` in `basic.js`). `scripts/atr-basic-scan.cjs` runs every BASIC file on `.ATR` disk images through the interpreter and tallies errors. `node scripts/build-basic-exe.cjs prog.bas out.exe` builds a standalone Windows console .exe (Node single-executable; text and INPUT only, no graphics or sound). No DOS build.
- BASIC panel: `DIM A(X,Y)` two-dimensional numeric arrays (read, assign, DIM ERR 9 on bad bounds), `CALL addr[,args]` (statement and `CALL(` form, optional host `call` hook), `ADR`, `DPEEK`, and accepted-but-inert `OPEN`, `CLOSE`, `XIO`, `NOTE`, `POINT`, `LOCATE`, `GET`, `PUT`, `BYE`, `DOS`, `LPRINT`, `PRINT #n`. Test: `node scripts/basic-run-test.cjs`.

- **8.2.0-beta.6:** on-screen **Trackball** tab in the keyboard panel (ball, Fire/Fire 2, Start/Select/Option/Reset, Coin, Pause, 4 Aux; port, protocol, speed and invert persisted); the controller diagnostics page now shows a "looks like" device type and suggested preset (`classifyDevice`); right-click the video display or the keyboard to stretch it to fill the area ignoring aspect ratio, and again to restore. See [docs/CONTROLLER.md](docs/CONTROLLER.md). Tested with `scripts/controller-test.cjs` and browser checks; not tried on real hardware.

- **ASM/IDE and Craft Studio:** assembler gains `.RUN`/`.INIT`, MADS/dasm directives, macros, `.INCLUDE`/`.INCBIN`, 65C02 mode and listings; in-memory buffer registry (`AC.Buffers`) so the Font editor's unsaved 8x8 set can be `.INCLUDE`d as `assets/font.fnt`; 6502 simulator/debugger; `studio.html` tabbed shell with per-tab ribbons. See [docs/WORKBENCH.md](docs/WORKBENCH.md). Browser test `scripts/asmpanel-test.cjs`.
- **Run built-in programs from the Inspector** (Inject tab, `AC.Inspect.runProg`, `ctl prog NAME`): PING, NSLOOKUP, TRACERT, WHOIS, IPCONFIG, CPUTEST, MEMTEST, GFXTEST, SNDTEST, KEYTEST, BANKTEST, TUIDEMO, CALC, 80COL, AFM, AFM80 boot straight from the page (bundled by `tools/progs/build.cjs`). Banks tab buttons and `ctl banks|bank|bankfind|bankwrite` added; tooltips on every Inspector button; new Inspector screenshots and a button reference in docs/INSPECT.md. Bank viewer also verified on 320K Rambo and 576K. `scripts/inspect-ui-test.cjs` drives every tab.
- **Extended-RAM bank viewer** (Inspector > Banks, `AC.Inspect.banks`): read, write, scan and search every 16 KB bank of 128K/320K/576K/1088K machines. Neither core exports extended RAM, so a small resident monitor (`tools/bankmon`) hooks the vertical-blank vector and maps banks into the $4000-$7FFF window. libatari800 only (tested 128K and 1088K, every byte); Altirra gives a clear error. Needs the running program to leave OS interrupts on. There is no 256K or 512K option.
- **Inspector** (sidebar tab, [docs/INSPECT.md](docs/INSPECT.md)): RAM page map and system variables, network activity log with byte counters, editable virtual adapter IP settings (returned by the FujiNet adapter-config command), and injection of memory, programs, typed text and fake N:HTTP replies.
- **Remote control:** the relay's /ctl/* endpoints and 	ools/ctl.cjs let scripts outside the browser read and drive the emulator (token protected). Tested with scripts/inspect-test.cjs; not tried from another machine.

## v8.1 (2026-11-04)

- **BASIC compiler:** string variables (DIM A$(n), substrings, CHR$/LEN/ASC/VAL, compare, INPUT), DATA/READ/RESTORE, OPEN/CLOSE/PRINT #/INPUT #/GET/PUT, variable STEP, array and string bounds checks (ERROR 9). Still no floats, STR$, TRAP or string +. Tested on a node 6502 and in the browser; not on real hardware.
- **Fonts:** C64 .64c charsets import in the FONT tab and font library (converted to Atari screen-code order). Not checked against many real files.
- **Network tools:** WHOIS and IPCONFIG (relay only; real internet check of WHOIS done once against google.com).

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
