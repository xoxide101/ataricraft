# Tools index

Every tool in this repository, with a page that explains what it does, how to use it, and how the code is organised.

| Page | Covers |
|---|---|
| [PDF viewer](PDFVIEW.md) | High-res offline PDF viewer, reusable `PDFENGINE` module, licence |
| [Network apps](tools/net-apps.md) | WGET, WPUT, LYNX, CURL, JQ, NC, MAIL, PING/NSLOOKUP/TRACERT/WHOIS/IPCONFIG, FTP, test results |
| [Relay](tools/tnfs-bridge.md) | `tools/tnfs-bridge` (bridge, netapi, ftp, ctl) and `tools/ctl.cjs` |
| [CMD shell](tools/cmd-shell.md) | CMD.COM and ARC/ZIP/LZH/ZOO/ARJ/ALF/DCM/DISC/CALC/NANO/80COL |
| [Hardware tests](tools/hardware-tests.md) | CPU/GFX/KEY/MEM/SND tests, shared includes, JS tests |
| [Audio](tools/audio.md) | MIDIPLAY, MP3PLAY, converters |
| [Disk and library](tools/disk-library.md) | lsdisk, imgtool, libscan, DB builders, apt, dospack, bankmon, xexboot, afm, tui |
| [Craft and documents](tools/craft-tools.md) | Craft format tools, fonts, dictionaries, importers, web apps |
| Existing | [Workbench](WORKBENCH.md), [Inspect](INSPECT.md), [FujiNet](FUJINET.md), [DOS boot](DOSBOOT.md), [Fonts](FONT.md), [Import](IMPORT.md), [xCWriter](XCWRITER.md), [EBookCraft](EBOOKCRAFT.md) |
| [FujiNet Explorer](FUJIEXPLORER.md) | `web/fujiexplorer.html`: browse TNFS/SD/FTP/PC folders, disk images, drives D1-D8, N:, P:, settings, DOS boot, without booting an Atari; [Transport layer](TRANSPORT.md) |

## Conventions

- Node scripts: dependency-free, plain `.cjs`, usage printed with no arguments.
- Assembly: 6501-style 6502 in the Workbench assembler dialect (MADS-compatible); `.COM` builds in-repo are ours.
- Browser tests (`scripts/*-test.cjs`) use Playwright and need ROMs from the untracked `software_n_roms/`.
- Never committed: ROMs, commercial disk images, `font_personal/`, third-party binaries.
