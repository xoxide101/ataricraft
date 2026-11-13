# dos-basic: BASIC listing to a DOS .exe

A small Atari-style BASIC runtime written in C (`basic.c`), built with Open Watcom into a 16-bit real-mode DOS program (about 54 KB, no DOS extender). The listing is compiled into the exe.

    node tools/dos-basic/build-dos.cjs program.bas [OUT.EXE]
    node tools/dos-basic/dos-test.cjs          # builds the sample, runs it in DOSBox-X, checks the output

Supported: PRINT/`?`, INPUT, LET, IF/THEN, GOTO, GOSUB/RETURN/POP, FOR/NEXT/STEP, DIM/COM (numeric 1-D/2-D arrays, strings), READ/DATA/RESTORE, `A$(x,y)` substrings (read and assign), INT ABS SQR SGN SIN COS ATN LOG CLOG EXP RND LEN ASC VAL CHR$ STR$ LEFT$ RIGHT$ MID$. Graphics, sound, POKE/PEEK, file I/O and machine code are accepted and ignored. Errors print `ERROR n AT LINE m` using Atari error numbers (strings need DIM, as on a real Atari).

Limits (64 KB data segment): 1500 lines, 200 variables, 255-character strings, 16 nested FOR, 32 nested GOSUB.

## Toolchain (not in git)

Open Watcom 2.0, from the `Current-build` pre-release at `open-watcom/open-watcom-v2` on GitHub. The installers there only give 32-bit Windows targets, so use `ow-snapshot.tar.xz` instead (full 16/32-bit DOS, OS/2, Windows):

    gh release download Current-build -R open-watcom/open-watcom-v2 -p ow-snapshot.tar.xz
    mkdir C:\WATCOM; tar -xf ow-snapshot.tar.xz -C C:\WATCOM

The build script sets `WATCOM`, `INCLUDE` and `PATH` itself (override the location with the `WATCOM` env var). Manual use:

    wcl -bt=dos -ml prog.c '-fe=out'                # 16-bit DOS; quote -fe in PowerShell
    wcl386 -bt=dos -l=dos4g prog.c '-fe=out'        # 32-bit DOS (needs DOS/4GW to run)

`DOSBASIC_TARGET=nt node tools/dos-basic/build-dos.cjs ...` builds the same runtime as a native Windows exe, handy for debugging.

Running DOS exes: DOSBox-X (`C:\DOSBox-X\dosbox-x.exe`, or set `DOSBOX`). When scripting it, pass each `-c` command as one quoted argument.
