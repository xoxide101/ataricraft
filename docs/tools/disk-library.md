# Disk, library and build tools (`tools/*.cjs`)

All are dependency-free Node scripts; run with no arguments for usage and read the header comment for details.

| Tool | Purpose |
|---|---|
| `lsdisk.cjs` | List files on an ATR/XEX/disk image |
| `imgtool.cjs` | Inspect/convert images |
| `libscan.cjs` | Read-only scan of the library folder (counts, types, problems) |
| `libcheck.cjs` | Check library entries for consistency |
| `librename.cjs`, `ziprename.cjs`, `zipsort.cjs`, `zipmanifest.cjs` | Rename/sort/manifest the library and zip collections |
| `makedat.cjs`, `fetch-dats.cjs` | Build/fetch checksum DAT databases |
| `make-diskdb.cjs`, `make-romdb.cjs` | Build the disk and ROM identification databases |
| `make-tools-disk.cjs` | Build the Tools disk (our own programs) |
| `make-xep80chr.cjs` | Generate the XEP80 character set |
| `index_chipdocs.cjs` | Index chip documentation |
| `apt/apt.cjs` | Atari Partition Table tool |
| `dospack/build.cjs` | Packs DOS files into `ACDOS.PAK` from `manifest.json` |
| `dosboot/` | DOS boot helpers, see [../DOSBOOT.md](../DOSBOOT.md) |
| `bankmon/build.cjs` | Builds the bank monitor into `web/js/bankmon.js` |
| `progs/build.cjs` | Bundles programs into `web/js/progs.js` |
| `xexboot/xexboot.asm`, `menuboot.asm` | Boot sectors that load an XEX / show a menu |
| `afm/` | AFM file manager (`afm.asm`, `nhandler.inc` N: handler); see `tools/afm/README.md` |
| `tui/` | Text-UI library `tui.inc`, demo, test; see `tools/tui/README.md` |
| `altirra-core/` | Notes and patch for the Altirra core build; see its README |

Copyright: disk images, ROMs and personal fonts are never committed (`.gitignore`: `*.atr`, `*.rom`, `*.xex`, `font_personal/`, `software_n_roms/`).
