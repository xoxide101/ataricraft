# CMD - a DOS-style command shell for Atari 8-bit DOSes

`CMD.COM` runs on Atari DOS 2.0/2.5, MyDOS, BW-DOS and SpartaDOS. It is written from scratch in 6502 (mads) and tracks its own current folder, so `CD`, `MD` and `RD` work on every DOS that has folders. Long names come from the `LONGNAME.TXT` file that AFM keeps in each folder.

Tested in the emulator: DOS 2.5, MyDOS 4.55, BW-DOS 1.30 and SpartaDOS 3.x (720K). Not yet tested: 80-column display, real hardware, SpartaDOS X.

## Use

Run `CMD.COM` from the DOS menu or prompt. `HELP` lists commands. `EXIT` returns to DOS.

## Built-in commands (working)

| Command | Notes |
| --- | --- |
| DIR, DIRS | directory with long names beside the 8.3 names; free sectors |
| TYPE, MORE, LESS | MORE and LESS page every 20 lines (ESC quits) |
| COPY, APPEND, NGET | NGET is COPY with an `N:` source, e.g. `NGET N:HTTP://host/file.xex FILE.XEX` (needs the FujiNet N: handler) |
| DEL, DELETE, ERASE | wildcards work as the DOS allows |
| REN, RENAME, RENDIR | `REN OLD NEW` |
| ATTRIB | `ATTRIB +R FILE` locks, `ATTRIB -R FILE` unlocks |
| MD, MKDIR, CREDIR / RD, RMDIR, DELDIR | folder DOSes only (MyDOS, BW-DOS, SpartaDOS) |
| CD, CHDIR, CWD, PWD | `CD ..` goes up; `CD >` or `CD \` goes to the root |
| DF, CHKDSK | file count and free sectors |
| FIND | `FIND text FILE`, case-insensitive |
| DUMP, MDUMP, PEEK, POKE, MEM | `MDUMP $E000 64`, numbers are decimal or `$hex` |
| SET, PATH, PROMPT | stored in CMD; SET with no argument lists |
| CLS, PAUSE, ECHO, VER, HELP, EXIT | |
| COLD, BASIC | BASIC is untested |
| X, LOAD, BLOAD | run a program by its exact file name |
| FN | FujiNet adapter status over SIO device `$70` |

Anything else is run as `NAME.CMX`, `NAME.COM` or `NAME.BAT` in the current folder. Batch files echo each line; `AUTOEXEC.BAT` runs at start.

## Not implemented yet

These names are accepted but only print a message: ARC, ATR, BOOT, CAR, CHTD, CHVOL, CLR, COMP, CON, DATE, DELTREE, DEV, ED, FMT, FORMAT, KEY, MAP, MENU, RS232, SAVE, SETPATHS, SIOSET, SORTDIR, SWAP, TD, TIME, UNERASE, VERIFY.

## Known limits

- A program run from CMD replaces it; when the program ends you are back at the DOS, not CMD. Plug-ins (`.CMX`) return to CMD.
- No PATH search yet (PATH is stored only), no nested batch files, no pipes or redirection.
- On DOS 2.x the folder commands print `NO FOLDERS ON THIS DOS`.
- Long names on the non-SpartaDOS DOSes are resolved through `LONGNAME.TXT`; typing a long name that is not listed fails with a file error.

## Plug-ins and FujiNet

A plug-in is a normal Atari binary assembled with `org $9000` (area `$9000-$9BFF`) that sets `RUNAD` to its entry point. CMD loads it, then calls it with `ARG` (zero page `$D4`) pointing at the argument text, ended by `$9B`. Return with carry clear for OK, or carry set with an error number in `$6340`.

API table at `$3800` (version byte at `$3803`, currently 1), three bytes per entry starting at `$3804`:

`putc, putnl, pstr, putdec16, nexttok, mkspec, fopen, fclose, bget, bput, rdrec, wrrec, getline, getkey, fnsio`

`fnsio` sends an SIO command to the FujiNet (device `$70`): fill `DCOMND`, `DSTATS`, `DBUFLO/HI`, `DBYTLO/HI`, `DAUX1/2`, then call it. Equates are in `lib\sys.asm`.

## Build

`node build.cjs` (needs `out\mads\mads.exe`) writes `bin\loader.bin` and `bin\cmd.com`.

## Layout

- `cmd.asm` shell, command table, API table
- `cmds\file.asm`, `cmds\misc.asm`, `cmds\run.asm` commands, program/batch/plug-in runner
- `lib\` console and CIO helpers, DOS detection, paths and long names, FujiNet
- `loader.asm` page-6 binary loader that survives programs which overwrite CMD
