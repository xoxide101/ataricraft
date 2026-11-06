# xCCalc: the Craft spreadsheet

xCCalc is the web spreadsheet of the Craft family. Its Atari-native twin is ACCalc (`docs/ACCALC.md`). Both read and write the same file, `.xcs`, and both use the same calculation engine rules. The engine is machine independent; the Atari program is a thin target.

| Part | Where |
|---|---|
| Shared engine (Node and browser) | `tools/calccore.cjs` |
| `.xcs` binary and JSON twin | `tools/xccalc/xcsformat.cjs` |
| CSV, TSV, XLSX, ODS, HTML import/export | `tools/xccalc/xcsio.cjs` |
| Container adapter | `tools/craftcore/adapter-xcs.cjs` |
| Tests | `scripts/calc-engine-test.cjs`, `scripts/calc-format-test.cjs`, `scripts/calc-excel-test.cjs` |

## Engine

Cells hold a number, text, boolean, error or nothing, plus an optional formula. A1 references, ranges, `$` absolute references, `Sheet!A1` references and named ranges work. A dependency graph gives incremental recalculation: only the cells that depend on an edit are recomputed, in topological order without recursion (a 5000-cell chain works). Cycles show `#CIRC!`.

Functions: SUM PRODUCT AVERAGE MIN MAX MEDIAN COUNT COUNTA COUNTBLANK IF IFERROR AND OR NOT TRUE FALSE ABS INT SIGN MOD SQRT POWER EXP LN LOG10 PI ROUND ROUNDUP ROUNDDOWN LEN LEFT RIGHT MID UPPER LOWER TRIM FIND CONCAT CONCATENATE TEXT VALUE ISNUMBER ISTEXT ISBLANK ISERROR ROW COLUMN CHOOSE NOW TODAY DATE YEAR MONTH DAY SUMIF COUNTIF MATCH INDEX VLOOKUP HLOOKUP, and the operators `+ - * / ^ & % = <> < > <= >=`. Excel precedence applies (`-2^2` is 4).

Not implemented: insert/delete rows and columns, sort, whole-column references (`A:A`), array formulas.

Limits: 65536 rows, 256 columns, 1 to 4 sheets in the Atari file (the engine itself allows more).

Formats: General, `0`, `0.00`, `#,##0`, `#,##0.00`, `0%`, `0.00%`, `$#,##0.00`, `yyyy-mm-dd`, `@`, `0.00E+00`, `hh:mm:ss`, `yyyy-mm-dd hh:mm`, and up to 16 custom codes per file. Styles: bold, italic, underline, alignment (auto, left, centre, right). Also column widths, frozen rows and columns.

## Number mode (decision)

The engine runs in one of two modes, stored in the file:

* `ieee`: JavaScript doubles. The default on the web.
* `bcd`: the Atari model. 6-byte BCD as used by the OS floating-point package and Atari BASIC. Byte 0 is `sign<<7 | (exponent + 64)`, exponent in base 100; bytes 1-5 are ten BCD digits with the point after the first pair. Documented examples are checked: 1 = `40 01 00 00 00 00`, 100 = `41 01 ..`, 0.5 = `3F 50 ..`, -1 = `C0 01 ..`.

Decision: ACCalc uses the OS FP ROM (the same numbers as Atari BASIC), so the web engine must be able to reproduce it. In `bcd` mode every result is rounded to the representable BCD value, add, subtract, multiply and divide are computed exactly and then rounded, and the range is about 1E-99 to 1E+98 (overflow `#NUM!`, underflow 0).

Unverified: the ROM's exact rounding in FMUL/FDIV and the accuracy of its transcendental functions (EXP, LN, LOG10, power with non-integer exponent). The model computes those through a double and rounds to BCD, so results may differ from the ROM in the last digit. These are to be compared with the real ROM in the emulator (stage 4); nothing about the ROM is assumed beyond the layout above.

## The .xcs file

CRFT header (16 bytes, `docs/CRAFT-FORMAT.md`) with type `S`, then a payload that ends in a CRC-16.

Header fields for `S`: `aux` = cell count (max 65535), `cols` = widest column (max 255), `rows` = last row (max 255, a hint only), `length` = payload size including the CRC, `checksum` = plain 16-bit sum of the payload.

Payload (little endian):

```
u8 mode (0 ieee, 1 bcd)  u8 nSheets  u8 nNames  u8 nCustomFormats  u8 nCharts  u8 0
u16 nStrings  u16 poolBytes
string pool: each entry = len (1 byte if <128, else 0x80|hi, lo) + Latin-1 bytes
custom formats: u16 string index each
names:  u16 name index, u16 reference index
charts: u8 kind (0 bar 1 line 2 pie) u8 sheet u16 title u16 range u16 row u8 col u8 w u8 h
sheets: u16 name, u8 frozenRows, u8 frozenCols, u8 defaultColW, u8 nColW + (col,width) pairs,
        u16 nRows, then per row: u16 row, u8 nCells-1, cells
cell:   u8 col, u8 flags (bits 0-2 kind: 0 blank 1 number 2 text 3 formula 4 error 5 boolean;
        bit 3 has format, bit 4 has style), [u8 format] [u8 style], value
value:  number = f64 (ieee) or 6-byte BCD (bcd); text = u16 pool index; boolean = u8;
        error = u8 index into the error list; formula = u16 pool index of the text without '=',
        then the cached value (u8 kind + payload)
u16 CRC-16/CCITT-FALSE over the payload
```

Format byte: 0-12 built in, 16+n custom format n. Style byte: bit 0 bold, 1 italic, 2 underline, bits 3-4 alignment.

The payload must stay under 65535 bytes (`xcs-too-big` otherwise); this is also the Atari limit for one file. Text is Latin-1; other characters are written as `?` and reported in the loss report. Loading recompiles every formula, recalculates, and warns when a cached value differs.

The lossless JSON twin (`format: "xcs-json"`) holds mode, sheets (cells by A1 address with formula, value, format and style), names and charts. `toBinary(toJSON-loaded)` is byte-identical to the original (tested).

## Interchange

* CSV/TSV: delimiter and encoding detection (UTF-8, Windows-1252), quoted fields, leading zeros, 16+ digit numbers and fields starting with `=` stay text. Export writes displayed values; the loss report says formulas become values.
* XLSX: zip + XML. Shared strings, shared formulas, styles, number formats, alignment, frozen panes, column widths, defined names. Unsupported functions are listed by name; recalculated results are compared with the cached values from the file. Export writes `CONCAT` as `CONCATENATE` because Excel 2016 lacks CONCAT. Charts are dropped on XLSX export (loss report).
* ODS: content XML with `of:=` formulas.
* HTML: export only, with styles.

Every importer and exporter returns a loss report of `{code, severity, count, detail}`.

## Tests

* `node scripts/calc-engine-test.cjs`: 63 engine checks (functions, deps, cycles, BCD).
* `node scripts/calc-format-test.cjs`: 36 checks (binary and JSON round trips in both modes, damage detection, CSV, XLSX, ODS, HTML, adapter).
* `node scripts/calc-excel-test.cjs`: drives real Excel through COM. 86 formulas give the same result in Excel; an Excel-saved workbook imports and recalculates to Excel's values; formats and styles agree. Skips when Excel is missing.

## Web app

web/xccalc.html is the browser spreadsheet, styled like xCWriter. Open it from the home page (xCCalc tab) or directly.

* Grid: canvas with virtual scrolling (65536 rows, 256 columns), formula bar, name box (cell, range or defined name), shift/drag selection, whole row/column selection, column resize (double-click the edge to fit), Ctrl+arrow jumps, fill down/right (Ctrl+D / Ctrl+R), undo/redo, bold/italic/underline, alignment, number formats, sheet tabs.
* Clipboard: copy/cut/paste as tab-separated text, so Excel ranges paste straight in.
* Charts: bar, line and pie from a selected range, drawn in 1 bit (320x192) with hatch fills; the PNG button exports a 1-bit PNG at 960x576. Charts are stored in the .xcs.
* Atari view: the sheet drawn at 320x192 with 64 columns of 5-pixel characters and the ACWriter 4x7 font, plus a report of what would not fit (sheets over 4, cells over 65535, .xcs over 65535 bytes, rows over 255, functions ACCalc lacks, non-Latin-1 text, IEEE versus BCD). The screen geometry is an assumption until ACCalc is specified.
* Files: open and save .xcs, CSV, TSV, XLSX, ODS; export HTML. Opening and saving show the loss report.
* Right-click menu: cut, copy, paste, clear, fill, style, charts, Clear undo history and Clear history (recent list, save format, undo; open documents and settings stay).
* Bundle: 
ode scripts/sync-xccalc-core.cjs builds web/js/xccalc/core/xcc-core.js and xcc-data.js from the engine (--check verifies; scripts/build-all.cjs runs it).
* Test: 
ode scripts/xccalc-test.cjs (Playwright and Chrome; uses out/xccalc/excel-saved.xlsx from the Excel test when present); screenshots go to out/xccalc/web-*.png.
