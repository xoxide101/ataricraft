# FujiNet Explorer

`web/fujiexplorer.html` (+ `web/js/fujiexplorer.js`, `fxpreview.js`, `fxhost.js`, `transport.js`): a Craft web app that reaches the FujiNet resources without booting an Atari. All I/O goes through the [Transport](TRANSPORT.md).

## Run

```
node tools/tnfs-bridge/bridge.cjs 8765 --allow-lan --allow-write --sd D:\sd --dos D:\dos
```
Open `http://127.0.0.1:8765/fujiexplorer.html` (the relay injects the token). For emulator control also open `index.html` from the same address in another tab and boot it. Use `?transport=loopback` (add `&ro=1`, `&emu=none`) for an offline demo.

## What it does

- **Files**: SD folder, TNFS servers (saved list plus the emulator's host slots), FTP, PC folders (File System Access). Browse, preview, upload (button or drop), download, rename, delete, new folder. Actions grey out when the relay is read-only; disk images are read-only.
- **Previews**: text/HTML/RTF/ATASCII, Atari 1K/2K fonts, TTF/OTF, images, GR8 screens, XEX segment tables, disk images (Browse inside via `dosfs.js`/`afmcore.js`), hex fallback.
- **Open in**: xCWriter, Font Editor, PDF viewer, EBookCraft (opens the app in a new tab and feeds its file input; same-origin only, otherwise it downloads).
- **Drives D1-D8**: drop a disk (or a list entry or DOS boot record) on a slot to mount it in the emulator; eject, browse, save, swap. Folder to disk builds an SDFS image and mounts it in D1.
- **N: network**: HTTP (any method), TCP and UDP one-shot testers through the relay.
- **P: printer**: the emulator's P: output, auto-refresh, save, clear.
- **Clock & settings**: relay/emulator time, FujiNet host and device slots, IP settings.
- **DOS boot**: records from `--dos` roots (`DOSBOOT.md`), Mount D1 button, rescan.

## Safety

Without `--allow-write` the Explorer refuses all writes before they are sent, and the relay refuses them again. A wrong token shows the relay as not connected.

## Limits and unverified

- No WebSocket backend (relay has none). Polling is used.
- Tested against a mock TNFS/UDP server, the loopback, OPFS and the emulator in Chrome; **not** against real FujiNet hardware or real public TNFS hosts. The folder picker dialog itself is not automated.
- Emulator control needs the emulator tab in the same browser and origin.
- `dosboot.rescan/record` are blocked client-side on read-only relays (stricter than the server).

## Atari companion (planned)

A native Atari listing/browser using the same protocol would need:
1. TNFS via the standard `N:TNFS://host/path` device for directories and files.
2. For everything else, a read-only text endpoint on the relay (e.g. `/fx/list?scheme=&host=&path=&page=`) returning 40-column lines, 8.3 names, sizes and paging, fetched with `N:HTTP://`. Each handler maps to one transport op (`fs.list`, `fs.read`, `emu.disks`, `dosboot.roots`).
3. Mount/swap requests as `emu.mount/swap` equivalents, and write calls gated by `/net/caps` (`allowWrite`) plus the token.
This endpoint is not implemented yet.

## Tests

`node scripts/fujiexplorer-test.cjs` spawns two relays (writes on/off), a mock TNFS server, HTTP/TCP/UDP echo servers, drives Chrome and (when `software_n_roms/` has ROMs) the real emulator. Screenshots go to `out/fujiexplorer/`.
