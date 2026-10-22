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

