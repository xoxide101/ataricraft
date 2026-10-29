# ataricraft notes

Owner: Jeff (xoxide101). Offline, no build step for the web shell, opens from `file://`.

## Done

- libatari800 built to WASM (`scripts/build-reference.ps1`); `build/ac_glue.c` glue; `build/atari800-sio-hook.patch` adds a JS SIO hook (`ac_sio_js`) to `sio.c`.
- Web shell: models/RAM, ROM folder scan, OS/BASIC selection, stretch-to-fit screen, speed control, headless-friendly `window.ataricraft` API.
- Keyboard: on-screen keyboard with Atari glyph legends (Shift/Control layers), key lighting for physical presses, mixed physical+virtual modifiers, key mapping dialog, Lower/Caps/Special display toggles, fluid scaling.
- Audio: sound on/off, key click.
- Persistence: scanned ROMs (IndexedDB), ROM selection and FujiNet config (localStorage), Reset ROMs / Reset config.
- Virtual FujiNet (`web/js/fujinet.js`): device $70, CONFIG boot disk, host list, directory browse, mount-to-slot, on/off toggle.
- Responsive layout: collapsible side panel; phone/tablet breakpoints.
- Media: content-based format detection (AFILE) routes ATR, XFD, ATR/XFD.gz (zlib), DCM, PRO, ATX to drives; XEX/COM/BAS/LST to run; CART and raw ROM (type picker) to cart slots; CAS and boot tapes to a cassette deck (Boot tape / Rewind / Eject). Media library with text + type filter; ROM filter box.
- Tests (Playwright, `scripts/*-test.cjs`): fujinet, persist, romsel, pixel (layout), kbview.

## To do / unverified

- FujiNet: confirm Option-boot of a mounted image works and slot `mounted` flag; test on/off toggle and Reset config end to end; adapter-config offsets and some command names (0xD3/0xD6/0xD9) are best-effort; block-mode directory reads unsupported; N: network devices (fetch/WebSocket) not started.
- Keyboard: when Lower is hidden, the remaining glyph should centre on the key (corner placement still seen); recheck phone key crowding after the 38px min height.
- Desktop 1366x900: page scrolls ~35px (screen-fit reserve not re-measured).
- 1200XL F-key mapping, cart slot naming and `-1200` flag are guesses.
- `web/js/cx2620.js` (2600 BASIC) written but not wired into the UI or tested.
- Own Rust cycle-exact core, differential testing, enhanced hardware modules (U1MB, PokeyMAX, VBXE), NetSIO bridge, WebSerial: not started.
- `web/ref/` (built WASM) is git-ignored; rebuild locally.

## Working notes

- Test ROMs: `software_n_roms/ATARIXL.ROM`, `ATARIBAS.ROM` (git-ignored). Playwright from `C:/Users/raver/craftapi/node_modules` with Chrome.
- `setInputFiles` on a `webkitdirectory` input needs a directory path.
- Never modify `3dcraft` or `AI-AgentKVM` repos.

- Disk formats: DCM + PRO verified (scripts/fmt-test.cjs, dcm-test.cjs); ATX untested (no sample). Mounted disks and carts now survive a reboot (S.disks / S.carts); fixed hookAudio() missing after a Boot-refactor.

- Zip support: web/js/zip.js (central directory + DecompressionStream); zips expand to virtual files in ROM scan, media library and FujiNet folder (scripts/zip-test.cjs). 7z/nested zips unsupported.

- MAME titles: #medxml / auto-load a800*.xml from scanned folder; TITLES in localStorage ac.titles; scripts/titles-test.cjs.


## v0.4.0 (2026-10-28)

- AFM/AFM80 (REV 13) with full Properties screen (long name, added date, DOS date on SDX/BW-DOS); WebAFM two-pane disk explorer; DAT/CRC cart identification; FujiNet TNFS browse via relay.
- Release zip: web/ (with git-ignored web/ref cores, only library/craftapps/AFM from the library), roms/altirra, tools/altirra-core, docs, README, NOTES, LICENSE. Third-party DOS boot disks are not shipped.
- Screenshots: scripts/screenshots.cjs, scripts/screenshots-webafm.cjs; AFM shots taken from the emulator.

## Raw drives D9:/D10: (read-only)

web\js\rawdisk.js claims SIO $39/$3A through Module.acSio (libatari800 core only; Altirra can't claim non-$70 IDs). Commands: $53 status (8 bytes: sectors u32, sector size u16, flags, unit), $48 set high 16 bits of the next sector number, $52 read (AUX = low 16 bits, DBYT bytes). Images load from the D9/D10 device-bar dialog; sector size is 2048 for ISO/UDF, else 512. Host readers for the filesystems: web\js\discfs.js. Smoke test: out\t_sio.cjs (scratch).

### DISC.COM / UDF (6502)
`tools\cmd\disc.asm` reads D9:/D10: via SIO ($48 high-word read): ISO 9660, UDF (AVDP@256, VDS -> partition + LVD -> FSD -> root ICB; 2048-byte sectors, UBUF=$7800), FAT12/16/32. Verified in `out\sim6502.cjs` against fat12/16/32/iso/joliet/udf images (23/0 files byte-identical). Host `discfs.js` LVD FSD lbn is at +252 (fixed). ARC.COM T mode no longer prints the "X " prefix. Not yet browser-tested with real RawDisk.

### ROM auto-load and hooks
On load the app fetches the `roms/` folder (tries `roms/` then `../roms/`; uses `roms/index.json` as a name list if present, else the server's directory listing; `roms/altirra` is skipped, already built in). Drop your own dumps there when serving over http. `?os=NAME&basic=NAME` selects ROMs by partial name (`basic=` = none). Hooks: `ataricraft.roms.{list,current,select(kind,name),rescan,addSource(fn)}` and the `ac-roms-changed` window event; `addSource` takes an async function returning File-like objects (server, FujiNet, cloud). Not available from file://.

#### ROM roots and scheme handlers
ROM roots are URLs (default `roms/`, `../roms/` resolved against the page). Each root is read by the handler for its scheme: built-ins `http:`, `https:`, `file:` (fetch-based; `file:` only yields files where the browser lets the page fetch it, otherwise use Scan folder or inject). `ataricraft.roms.registerHandler('scheme', {list(root)->[{path,url}], read(entry)->Blob})` adds or overrides a scheme; `addRoot(url)` adds a root; `inject([File | {name,bytes}])` pushes ROMs directly; `handlers()` lists schemes. `window.postMessage({type:'ac-roms', files:[{name,bytes}]})` or `{type:'ac-roms-root', url}` works from the same origin, parent frame or opener.

### Ease of use (ROM modes, drop zone, HELP)
ROMs tab: Mode = Auto (recognised original ROM, else built-in Altirra) / Realistic (originals first) / Symbolic (built-in first), stored in localStorage `ac.rommode`; Auto-pick clears manual choices; a line shows where the OS and BASIC came from. API: `ataricraft.roms.mode([m])`. Dropping files anywhere sends OS/BASIC ROMs to the library (8K files only if the CRC is known or the name has "bas") and everything else to drive 1. CMD: `HELP` lists commands and tools, `HELP ARC|ZIP|LZH|ALF|DCM|DISC` shows usage. DISC.COM verified in the real emulator with RawDisk D9: (UDF image: I and D correct). Tab completion is not done: CMD reads lines through the screen editor, so it would need its own key loop (losing cursor editing and history).

## Ready-to-run disks
Every disk in web/library/craftapps/Ready to run holds CMD, ARC, ZIP, DCM, LZH, ALF, DISC, AFM, AFM80 and TOOLS.TXT (usage summary, ATASCII). The MyDOS 4.55 boot disk is now a bootable 720K image (was 90K); DOS 2.5 stays 90K and fits everything; BW-DOS 360K, SpartaDOS 720K/16MB and MyDOS 16MB have room to spare.

## ACDOS.PAK (DOS installer pack)

One file, `web/library/dospack/ACDOS.PAK`, holds every DOS template (DOS 2.0S/2.5/XL, MyDOS, SuperDOS, SpartaDOS, BW-DOS) plus our tools (AFM, CMD, ARC, ZIP, DCM, LZH, ALF, DISC). Rebuild with `node tools/dospack/build.cjs` (reads `tools/dospack/manifest.json`). New items (more DOS versions, OS ROMs) go in `tools/dospack/extra/` with a sibling `<file>.json` giving kind/id/name/version. Runtime: `AC.DosPack.load()` then `pack.list('dos')` and `await pack.install(id, {tools:'all'|[ids]})` returns a ready ATR; tools that do not fit are reported in `skipped` (DOS XL is nearly full). No UI yet. Tested with `out/t_dospack.cjs`.


## Pending

- **Chip documentation archive (Atari Preservation Society):** 8-bit, 16-bit (ST/STE) and 32-bit (TT/Falcon/Jaguar) chip documents. The user is still downloading the whole archive; path to be supplied. Planned: one subfolder per generation, catalogue and audit, then feed the machine-profile / chip-database work (parked until the user says go).
- DCM: decoder now verified on 7 real Hobby-Tronic DCM disks (hobby89a/b, 90, 91a/b, 92a/b: 720 and 1040 sectors, all mount as DOS 2.x with sane directories); our encoder re-encodes them and decodes back byte-identical (sizes differ slightly from the originals' encoder, as expected). "Save as .dcm" is next to Save disk (browser-tested). Samples kept locally in web/library/craftapps/Samples/DCM (gitignored).
- DOS 2.0S/2.5 blank creator (`DosFs.createDos2`, "Pre-format as Atari DOS 2.0S / 2.5" checkbox): 1040-sector enhanced density verified under real DOS 2.5 (directory of D2 reads, 1010 free) and read/write in Node. Note a blank can only be inserted after Boot.
- **Unverified, no samples:** UDF with non-zero FSD lbn / fragmented / embedded files; Rock Ridge/Joliet ignored on the 6502 side; Altirra core not claiming D9/D10; SpartaDOS XIO 43; CMD FORMAT Y path; ARJ hand-off form and multi-volume; ZOO comments and version suffixes. `?os=` is verified (picks from saved ROMs only).

- **Chip-doc archive path:** `I:\Online_Archives_A-Z` (mirror of 10 sites; still downloading). Richest area: `Atari_FTP\collections\Atari documents` (CPUs / Custom Chips Datasheets and Databooks, Schematics, Service Manuals, TT030 manuals, 8-bit internal docs). First-pass index: `node tools/index_chipdocs.cjs` -> `out/chipdocs_index.csv` (790 candidate docs; keyword match includes game manuals, needs filtering). Re-run when the download finishes.
- **Reference archive policy:** the large Atari archive (millions of files: docs, books, software, disks) is private reference only and is never shipped or committed. Only the DOS images database (ACDOS.PAK, 101 items) is for runtime use and extraction.

- Disk conversion (diskconv.js): xexToAtr/atrToXex = no-DOS boot-sector loader (tools/xexboot/xexboot.asm, MADS); verified in the browser with a 2-segment XEX (INIT then RUN both ran) and byte-identical round-trip; loader does not relocate, so XEX data overwriting $0700- breaks it. atxToAtr = sector data only (no weak bits/timing/duplicate sectors), so protected disks will not boot from the ATR; checked only by DOS directory parsing on ~35 ATX files, not booted. Not wired into the UI.

- UI: Cartridges & drives has Save as .dcm/.xfd/.pro/.xex plus 'Convert file to ATR...' (DCM, PRO, XFD, ATX, XEX/COM); browser-tested (XEX -> ATR -> boot -> .xex identical, ATX -> ATR, .xfd/.pro download). arc.js already handled ARC method 8 (checked on uue.arc: 3 files, CRC OK); added method 9 (squashed = 13-bit LZW, no RLE) UNTESTED (no sample); methods 5-7 still unsupported.

- Protected ATX: kept as ATX (ATR cannot hold timing/duplicate sectors); Convert file refuses them and says to load the .atx directly. atxInfo() flags duplicates, bad statuses and weak-bit chunks: 298 of 450 ATX in the library are protected. A.E. (8 duplicate sectors) boots natively as ATX in the browser. Not done: ATX writing, ATX -> PRO with status flags.

## Hardware test programs

- tools/tests/ (MADS; shared common.inc and cscreen.inc colour framework: per-row DLI colour bars, mode-7 block map, VBI-reset; `node tools/tests/build.cjs` -> tools/tests/bin/*.COM). All tests show colour PASS/FAIL rows and a RESULT bar.
  - CPUTEST: detects 6502/65C02/65C816, instruction self-checks, speed estimate (approx).
  - SNDTEST: POKEY1 random check, stereo detection (second POKEY at $D210, probed both ways), guided listening test (G, then Y/N/S) for left/right/both/noise/sweep, free-play keys 0-9.
  - KEYTEST: visual keyboard, grey untested / yellow held / green tested; Start/Select/Option, Break, Shift, Ctrl; joystick and paddle readout; hold Start+Select+Option to exit. Emulators only report Shift together with another key.
  - GFXTEST: GR.0-15, GR.8 1-bit mono pattern, mixed ANTIC modes screen; Y/N/S per screen and a colour summary.
  - MEMTEST: RAM size and total, bank map, burn-in (B), aliasing check.
- Verified on both cores: MEMTEST (128K only since the colour rewrite), CPUTEST on all Altirra CPU options and Atari800, SNDTEST mono and stereo on both, KEYTEST, GFXTEST all screens. Audio itself not heard; stereo left/right separation not listened to. Joystick/paddle rows not exercised by real input.
- Archive tools (ARC ZIP DCM LZH ALF DISC ZOO ARJ): Q at the prompt quits (blank line too).
- Packaged: added to ACDOS.PAK (manifest tool entries + strip list), to the Ready-to-run disks (except the 90K DOS 2.5 disk, which is full), and a new 'Hardware tests (DOS 2.0S boot).atr'.

## Menu disk builder

- menuToAtr(items) in diskconv.js builds a no-DOS boot disk (loader: tools/xexboot/menuboot.asm, 661 bytes) with up to 36 XEX/COM programs on a 1-9, 0, A-Z menu. UI: 'Build menu disk from XEX/COM...'. Verified: menu shows, key 2 runs program 2. Not done: cart wrappers, template-loader mode (trigger unknown), return-to-menu after a program exits.

- Menu disk also accepts plain 8K/16K carts (.car/.rom) via cartToXex: ROM is copied to RAM, BASIC banked out, cart init/run vectors used. Verified with Jr. Pac-Man. Bank-switched carts are rejected.
- Menu disk cart check: building runs each cart in a hidden libatari800 machine (cartSurvives in app.js); if its RAM copy at $8000/$A000 changes after launch (Gyruss clears RAM downward, Jr. Pac-Man writes 2 bytes) the entry is marked '*' and built as a slot request (ROM loaded, 'ACRT'+KB posted at $06F0). app.js cartRequest() sees it, inserts the real cart in slot 1 and cold starts. Slot entries only work in Ataricraft. Verified with Gyruss (title screen).
- Bank-switched/any-type CARs on a menu disk: stored whole after the programs, entry is a stub posting 'ACRT',0,sector,length at $06F0; cartRequest() extracts the CAR from the mounted ATR and inserts it (Ataricraft only). Verified: Mario Bros (64K XE), Super Bunny (128K). Compat test over the 377 plain carts: 163 flagged '*', 214 run as plain RAM copies. A tester crash counts as flagged.
- Machine/chip database: web/js/chipdb.js seeds chips, chip_variants, machines, machine_slots into the catalog SQLite (versioned via meta chipdb_version); Debugging tab shows it. Only the parts remembered from the user's LSI list are seeded (verified=0 are unchecked); the full pasted list and the chip-doc archive still need to be loaded.

- Stereo POKEY: the ST header toggle reboots with a second POKEY on both cores. Altirra uses `altirra_stereo_pokey`; libatari800 needs `STEREO_SOUND` in build/config.h (rebuild web/ref with scripts/build-reference.ps1, EMSDK_DIR=C:\Users\raver\emsdk) and `-stereo`, giving interleaved 2-channel 44.1 kHz output. The CPU select (6502C/65C02/65C816) is Altirra-only. Verified with SNDTEST (FOUND stereo with ST on, mono with it off) on both cores.
