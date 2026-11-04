# Ataricraft Workbench and tools guide (beta)

A guide for people and AI agents who want to learn Atari 8-bit development, or build tools and games with it. Everything is offline: open the files from disk in Chrome or Edge. There is no server, no install and no build step for the web parts.

**Beta means:** it works in the emulator and in the checks listed below, but most of it has not been run on real hardware and none of the audio has been judged by ear. Each section says what was checked. Please report problems.

## 1. The pieces

| Piece | Open | What it is |
|---|---|---|
| Emulator | `web/index.html` | Atari 8-bit machine in the browser (libatari800 and AltirraSDL cores, both WASM). You supply your own ROMs; none are included. |
| Workbench | `web/workbench.html` | Nine tabs for sound, graphics, maps, music and images. Details in section 2. |
| In-browser tools | tabs inside `index.html` | BASIC, ASM (6502 assembler), FONT editor, AFM file manager, WebAFM. |
| Tools disk and Audio disk | `web/library/craftapps/Tools/` | Ready-made Atari programs (NANO editor, CALC, 80COL, VIEW, SNDTEST, MIDI/MP3 players and tests). |
| Circuit Runner | `games/circuit/` | A platformer built with the Workbench tools. A worked example of the whole pipeline. |
| Agent API | `window.ataricraft` | The same machine, driven from a script or an AI agent. See section 5. |

## 2. Workbench tabs

All tabs run in the page. Loaders check their input and refuse bad files without wiping your current work.

- **MIDI to POKEY**: converts a `.mid` file into a `.PMD` file for the Atari players. Options include a "smart voices" mode (melody and bass priority, chord arpeggio, poly4 bass, decay). The preview is approximate. Unverified: the poly4 pitch formula.
- **SAP files**: reads and edits SAP headers. SAP types B and C can be turned into a runnable `.XEX`; types D, S and R, and COVOX, are not handled. The stereo flag is carried through (SAPX2).
- **RMT modules**: loads a Raster Music Tracker `.rmt`, previews it, and exports a `.SAP` or an `.XEX`. Checked: the JavaScript player matched the original 6502 player register for register on 6 RMT4 songs (`node tools/tests/rmtplay.test.cjs`). Not checked: RMT8 stereo, and whether the exported XEX runs well on hardware.
- **Sprites**: pixel editor for tiles and sprite sheets (4 colours per tile, per-band palettes). Reads and writes the shared project file `games/circuit/assets.json`.
- **Map**: tile map editor (512 x 25, a 2048 px world, with a slow sky layer). Upgrades older 256 x 23 files on load.
- **Tracker**: pattern tracker with MIDI import. Exports through the RMT packer. Voice sharing is not done; poly4 and noise pitch are approximate.
- **Player-missile**: editor for Atari player/missile graphics. Export is not yet wired into the example game.
- **Scroll art**: draws large scrolling pictures. Export is not yet wired into the example game.
- **Images**: add files or a whole folder, see them grouped by format (PNG, GIF, BMP, JPEG, WebP, ICO, TIFF and the Atari GR.8, GR.9 and GR.15 / MicroPainter raw dumps), filter by type or name, convert the selection to PNG, BMP, JPEG, WebP or an Atari format (resize, fit, dither, colour registers, hue), and download one file, a ZIP of conversions, or a ZIP with one folder per type. Nothing is uploaded. The same code runs on the command line as `node tools/imgtool.cjs` (`info`, `scan`, `find`, `organize`, `convert`; run it with no arguments for usage). Library: `web/js/imgconv.js`. Checks: `node tools/tests/imgconv.test.cjs` and `node scripts/img-test.cjs` (browser). Limits: Atari dumps are recognised by file extension plus size (7680 bytes), because the raw formats have no header, so a renamed file can be misread. Atari colours are chosen by nearest match in a fixed palette; MicroPainter files with 4 trailing colour bytes (7684 bytes) are read with those colours, and "MicroPainter colour bytes" / `--trailer` writes them (order PF0, PF1, PF2, BAK is from memory and was not checked against MicroPainter itself; explicit colours override it). Plain 7680-byte files take their colours from the options. JPEG, WebP, ICO and TIFF need the browser, or ffmpeg on the command line; GIF is read (first frame) and written (one frame, exact palette up to 256 colours, otherwise a fixed 3-3-2 palette, no dithering; checked with our own reader and ffmpeg). PNG and Atari output were tested in Chrome and Node only, and Atari pictures were not loaded on real hardware.

Workflow for the example game: edit in the tabs, download the file, replace `games/circuit/assets.json` (or `music.json`), then run `node games\circuit\build.cjs` to produce `out\circuit.xex`. The tabs cannot write into the repository themselves; that is a browser limit.

## 3. In-browser developer tools (in `index.html`)

- **ASM tab** (`web/js/asm6502.js`): a 6502 assembler. Output is byte-identical to MADS on the repo's test programs (`node tools/tests/asm6502.test.cjs`). Not supported: macros, includes, `.proc`. Labels are case-insensitive, so `HP1` and `hp1` collide.
- **BASIC tab** (`web/js/basic.js`): an Atari BASIC style interpreter with graphics, sound and PEEK/POKE (`node tools/tests/basic.test.cjs`). Atari BASIC tokenised save is not done. The tab can also compile an integer subset to 6502 asm/XEX (see `docs/LANGUAGES.md`).
- **FONT tab** (`web/js/fontpanel.js`): character set editor with Windows TTF export. Not tested with a real ROM charset or in Windows. Check licences before shipping a font derived from a ROM.
- **AFM / WebAFM**: disk and file manager. Browse, extract, rename and write DOS 2, MyDOS and SpartaDOS/BW-DOS images (up to 16 MB). Viewers for `.MIC/.PIC/.GR15`, `.GR8`, `.FNT/.CHR/.SET` and Print Shop fonts. See `docs/LARGE-DISKS.md`. **Relay folders:** with the relay running (`start.cmd` / `./start.sh`), each WebAFM pane's source list has "N: FujiNet SD folder" (the folder given with `--sd`) and "TNFS server…". They mount like a PC folder, so you can copy between disk images, the PC and the SD folder or a TNFS server, in any browser. Changes need the relay started with `--allow-write`. Test: `node scripts/relayfs-test.cjs`. **Print…:** prints or saves (as text) a directory of the current folder, the same with all folders below, a disk label card, or a catalog of every open disk with an A-Z file index; the browser print dialog also offers Save as PDF. Test: `node scripts/afmprint-test.cjs`. **Panes:** the ⊞ Panes button switches between two panes and a 2×2 grid (1 2 / 3 4; panes 3 and 4 start on D3 and D4 if those hold a disk). Tab / Shift+Tab move between panes. Copy and Move go to the pane you were in before (dashed border), and drag and drop works between any two. Test: `node scripts/panes-test.cjs`. The native AFM program (`tools/afm`) also browses N: drives: press `9` or `0` in a pane (N1:/N2:) and enter a URL (RETURN = `SD:/`). Copy, move, delete, rename and mkdir work; lock, unlock, format, clear and properties are refused. AFM installs its own N: handler (needs the relay with `--sd`; real FujiNet hardware keeps its own). The 80-column AFM80 needs BASIC off for N:. Press H to print the pane's listing to P:. Test: `node scripts/afm-n-test.cjs`.
- **FujiNet (virtual)**: SIO device `$70`, CONFIG boot disk, host browsing and slot mounts. It is partial (see `NOTES.md`). N: network devices are not implemented yet. The aim is to keep real FujiNet devicespecs and commands (`N:TCP://`, `N:HTTP://`, ...) so programs stay compatible.
- **H: host drive**: in BASIC, `LIST "H:PROG.LST"` saves to the browser and `ENTER "H:PROG.LST"` loads it.
- **P: printer** (`web/js/printer.js`): SIO device `$40` answers the OS P: handler (`LPRINT`, `LIST "P:"`, `OPEN #1,8,0,"P:"`). Output appears in a draggable paper window, which opens on first output (click the P: light to reopen it). It shows the text as paper: roll or sheets, 40 or 80 columns, in a normal text font or the Atari character set (inverse and graphics characters too), and double-width lines. Save as PNG or text, copy text, Print… (the browser's print dialog also does PDF), or Tear off to clear. Agents: `ataricraft.printer.text()`. libatari800 core only. Not done: Epson/ESC codes, 1020 plotter graphics, sideways mode (printed as normal). Test: `node scripts/printer-test.cjs`.

## 4. Learning path

1. Boot the emulator, open BASIC, run a short program. Then try `PEEK`/`POKE` on screen memory.
2. Write the same thing in the ASM tab, assemble, and run the result.
3. Draw a tile in Sprites, put it in the Map tab, and look at how `games/circuit/build.cjs` turns `assets.json` into screen memory.
4. Read `games/circuit/game.asm`. It shows ANTIC mode 4 with four scroll bands using display list interrupts, VBI music, tile collision, and a two-actor co-op puzzle system. Design notes are in `games/circuit/DESIGN.md`.
5. Make music in Tracker, export it, and hear it in the emulator.
6. Add a new tile and a new puzzle (the hold-plate door is a small example of a change that touches the assets, the build constants and the game code).

Useful habits: change one thing at a time, rebuild, and look at the emulator. The regression checks in `tools/tests/` and `scripts/` show how to test without a screen.

## 5. Human and AI integration

The page exposes `window.ataricraft`, the same engine the buttons use. Call `window.ataricraft.describe()` for the list. Main calls:

- Machine: `boot({model,tv,basic})`, `reset(cold)`, `run()/pause()`, `step(n)`, `speed(x)`, `state()`
- Input: `type(text)`, `press(fields,frames)`, `joy(bits,fire)`, `console({start,select,option})`
- Output: `screenshot({scale})` (PNG data URL), `screenText()`
- Memory: `peek(addr,len)`, `poke(addr,bytes)`
- Media: `mountDisk(n,name,bytes)`, `bootFile(name,bytes)`, `mediaList()`, `loadEntry(name,drive)`
- State: `snapshot()`, `restore(snap)`

Suggested loop for an agent: build with `node games\circuit\build.cjs`, boot the emulator headless (Playwright works; see `scripts/*-test.cjs`), call `bootFile`, drive it with `joy`/`press`, then read results with `peek`, `screenText` or `screenshot`. This is how the Circuit Runner puzzles were tested (read actor positions from `$0600`-`$0607`, check door tiles in near-row memory). Tips: teleporting actors with `poke` can leave scroll buffers stale and show glitches that real play does not; prefer real movement when judging visuals. Pass absolute paths to .NET file APIs on Windows.

Please keep this separation when contributing: tools that humans click and the API that agents call should use the same underlying code, so both see the same behaviour.

## 6. Known limits (beta)

- Audio, hardware timing (PAL) and real-hardware boot are unverified.
- ATX disk images are untested (no sample).
- Print Shop border roles and some Print Shop formats are not decoded.
- Own cycle-exact core, enhanced hardware (U1MB, PokeyMAX, VBXE), NetSIO and WebSerial: not started.
- Licence: GPL-2.0 overall. The RMT player port is GPL-3.0 and whether the combined work can stay GPL-2.0 is unresolved (see `README.md`).

- Languages and compilers plan: [LANGUAGES.md](LANGUAGES.md)
