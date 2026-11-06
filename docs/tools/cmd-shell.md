# CMD shell and the stand-alone DOS tools (`tools/cmd/`)

`CMD.COM` is a DOS-style command shell written from scratch in 6502 for Atari DOS 2.x, MyDOS, BW-DOS and SpartaDOS. Full command list, limits and plug-in notes are in `tools/cmd/README.md` and `tools/cmd/MANUAL.TXT`; this page is the map.

## Programs (prebuilt `.COM` in `tools/cmd/bin/`, built from `tools/cmd/*.asm`)

| Program | Source | What it does |
|---|---|---|
| CMD.COM | `cmd.asm`, `cmds/*.asm`, `lib/*.asm` | The shell: DIR, TYPE, COPY, DEL, REN, CD/MD/RD, FIND, DUMP, PEEK/POKE, SET, batch files, `.CMX` plug-ins, FujiNet `FN`, `NGET` |
| ARC / ALF / ARJ / LZH / ZIP / ZOO .COM | `arc.asm`, `alf.asm`, `arj.asm`, `lzh.asm`, `zip.asm`, `zoo.asm` | List, test and extract archives on the Atari itself (`L`, `T`, `X archive [dest] [member]`). Each documents the methods it supports in its header (ZIP: stored and deflate, CRC32; ARC: methods 1-4 and 8; LZH: lh0/1/4/5; ZOO: stored, LZW, LZH; ARJ: methods 0-4; ALF: LZ/DZ) |
| DCM.COM | `dcm.asm` | DiskComm `.DCM` to `.ATR`, streaming, no seeking; output verified identical to `web/js/diskconv.js` |
| DISC.COM | `disc.asm` | Read-only reader for the raw drives D9:/D10: (ISO 9660, FAT12/16/32) |
| CALC.COM, VIEW.COM, NANO.COM | `calc.asm`, `view.asm`, `nano.asm` | Calculator (`2+3*4`, `SQR(16)`, `ANS`), text viewer, nano-style full-screen editor |
| 80COL.COM | `80col.asm`, `res80.asm`, `mkfont80.cjs` | 80-column text screen driver for E:, resident in the top 12K of RAM (assembled three times for three RAMTOP values) |
| MEMTEST / KEYTEST / INPUT / COLOR / MONITOR | `cmds/test.asm`, `rt.asm` | Built-in hardware diagnostics (see also [hardware-tests.md](hardware-tests.md)) |

## How it is organised

- `lib/sys.asm` equates shared by the shell and every tool; `lib/io.asm` console, CIO helpers, number printing, tokenizer; `lib/path.asm` current folder and the `LONGNAME.TXT` long-name map (kept by AFM); `lib/dos.asm` detects which DOS is running; `lib/fn.asm` FujiNet hooks; `lib/hand.asm` command-line hand-off (the rest of the line is left at `$0480` for tools); `lib/uniq.asm` unique 8.3 names for archive members.
- `loader.asm` is a tiny binary loader copied to page 6 so it survives a program overwriting the shell.
- Plug-ins (`NAME.CMX`, `org PLUG`) call the shell's API table; `cmds/*.asm` are the built-in commands in the same style.
- `build.cjs` assembles everything with MADS (`out/mads/mads.exe`, not in the repo) into `bin/`.

## Tested

In the emulator on DOS 2.5, MyDOS 4.55, BW-DOS 1.30, SpartaDOS 3.x (720K). Archive tools are checked against the host decoders (`web/js/arc.js`, `lzh.js`, `archives.js`) with `scripts/dcm-test.cjs`, `scripts/sdx-test.cjs` and friends. Not tested on real hardware, SpartaDOS X, or 80COL on every machine type.
