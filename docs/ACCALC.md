# ACCalc — Atari-native spreadsheet (XCCalc stage 4)

Companion of the XCCalc web app ([XCCALC.md](XCCALC.md)). Source: `tools/accalc/*.asm|inc` (MADS). Needs a **130XE (128K)**.

Build: `cd tools\accalc; ..\..\out\mads\mads.exe accalc.asm -o:accalc.xex -l:accalc.lst`

## What it does
- Loads/saves the compact `.XCS` binary (mode **bcd**, 1 sheet) via CIO (`H:` / `D:`), CRC-checked.
- 40x24 hi-res text grid (ANTIC F, 8x8 Craft `zfont`), arrow navigation, status/entry bar.
- Cell entry: numbers, text, formulas (`=...`). Recalculation with Atari BCD-6 using the OS FP ROM (AFP, FASC, IFP, FPI, FADD, FSUB, FMUL, FDIV, FLD0R, FST0R, FMOVE).
- Results equal the JS engine (`tools/calccore.cjs`, `atari-bcd` mode) on the test sheet: 52 cells, 30 formulas, 0 differences.

## Keys
Arrows move; printable key starts entry; Enter commits (cursor moves down), Esc cancels; Ctrl-E edit cell; Atari Backspace key in nav mode clears the cell; Ctrl-F cycles number format 0..7; Ctrl-B toggles bold; Ctrl-R recalc; Ctrl-S save; Ctrl-O load (file prompt shows mode letter then name, e.g. `h:test`).

## Memory map
- Cells: banks 0/1, 16-byte records at `$4000 + (row&63)<<8 + col<<4`, bank = row>>6. Record: +0 kind (0 blank,1 num,2 str,3 formula,4 err,5 bool), +1 vkind, +2 fmt, +3 style, +4..9 value (string: pointer), +10/11 formula heap pointer.
- Bank 2: pool index → heap pointer. Bank 3: length-prefixed string heap (16K).
- Main RAM: EBUF $0600, FBUF $0680, RECB $0700, OLDV $0710, TMPS $0720, VSTK $0800, formula list FLL/FLH $1000/$1200, IOBUF $1400, HDR $1480. PORTB shadow `pb0`; bank switching via `bopen` (keeps bit 7/self-test ROM state in mind).

## Format
Header `CRFT`,1,`S`,0,0,len,cells,maxC,maxR,sum16; payload pool + cells; CRC-16 CCITT (init FFFF). Saver writes custom formats, sheet name, cell strings (no de-dup), 0 names/charts. Identical semantic content verified by reopening with `xcsformat.fromBinary`.

## Coding notes
- `peek` in the harness sees main RAM only; verify banked data via saved files.
- FP routines clobber temps; `bround` clobbers t1..t4; `rdb`/`refill` save t1..t4/w16.
- MADS labels are case-insensitive (clashes with FADD/FMUL equates).
- Routines such as `sxput` clobber X: use memory loop indices.
- Emulator keyboard is positional; Atari Backspace = `IntlBackslash` (harness `e.bksp()`), Playwright `Backspace` is BREAK.

## Tests
`scripts/accalc-gen.cjs` (TEST/TESTFULL.XCS via calccore), `accalc-test.cjs` (harness + load/grid/nav), `accalc-save.cjs` (load, ^R, ^S, compare with calccore: 0 differing), `accalc-edit.cjs` (entry, edit, clear, fmt/bold, save, reopen). Screenshots in `out/accalc/`.

## Limits
128 rows x 16 cols (A–P), single sheet, 512 formula cells, strings ≤127 (entry ≤100 chars), formulas ≤100 chars. Functions: SUM AVERAGE MIN MAX COUNT PRODUCT ABS INT SQRT ROUND MOD IF AND OR NOT; operators + - * / ^ % = <> < > <= >=; ranges, A1/$A$1, TRUE/FALSE. Errors: #DIV/0 #VALUE #REF #NAME #NUM #N/A #CIRC #NULL #PARSE. Recalc is multi-pass (cap 40); converging cycles are not detected. Names, charts, extra sheets are dropped on save; ieee-mode files rejected; formats ≥8 show as General; no string literals in formulas; editing leaks old strings in the heap; emulator text input is uppercase (CAPS); booleans can't be typed as values.

## Not done / unverified
- **P: print not implemented.**
- Real hardware and recalc timing unverified (emulator only).
