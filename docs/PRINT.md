# ACWriter printing (P:)

File > Print (Esc, F, R) writes the document to the Atari `P:` device (a real printer, a FujiNet printer, or the
emulator's virtual printer). Type one letter at the prompt and press Return:

| Key | Mode | Output |
|---|---|---|
| `T` | plain text | ASCII lines, EOL `$9B`, no control codes, form feed after each page |
| `E` | Epson ESC/P text | `ESC @`, page length, pitch, and style codes (bold, italic, underline, superscript, subscript) |
| `B` | bitmap 60 dpi | Craft face as `ESC * 0` graphics, 8-pin rows |
| `D` | bitmap 120 dpi | Craft face as `ESC * 1` graphics |

Anything else shows the "not understood" message. On success the status line says "Done."; a CIO error shows
"Disk error N" with the code.

## Page setup
The printer uses the PAGE settings (Esc, P: Paper, pitch, Left, Right): paper letter/A4/legal (66/70/84 lines per
page, sent as `ESC C n`), pitch 10/12/17 cpi (text: `ESC P`, `ESC M`, `ESC P`+`SI`), left margin, and the usable
width `pwwid`. A one inch (6 line) top margin is added to each page; the body is `pwlpp` lines (paper lines - 12).
Lines are printed as they are wrapped in the document and cut at the page width, so print from a document laid out
for that width (PAGE view) to get the page-width layout.

Paragraph markers are honoured: centre and right alignment (padding), indent (4 columns on the first line) and
bullets (`*` or `-` followed by a space). Justify, heights, widths and weights are ignored. Latin-1 non-breaking
space becomes a space, soft hyphen `-`, other codes above 126 print `?`.

## Epson ESC/P text
Style toggles in the document are turned into: bold `ESC E`/`ESC F`, italic `ESC 4`/`ESC 5`, underline
`ESC - 1`/`ESC - 0`, superscript `ESC S 0`, subscript `ESC S 1`, off `ESC T`. Styles are switched off at the end of
each line. Inverse is not printed.

## Bitmap printing
Each text line is 12 pin rows at 1/72 inch: the Craft face cell (3 glyph columns plus a gap, 8 rows plus 3 tail rows)
is printed in two passes, `ESC * m n1 n2` with 8 pins each (rows 0-7, then rows 8-11), separated by `ESC J 24` and
closed by `ESC J 12`; line spacing is `ESC 3 0`. Graphics data never contains `$9B` (the OS handler would end the
frame there): such a byte is changed to `$9A`, and a row length of `$9B` is padded by one blank column.

Horizontal scaling repeats each source pixel column 1-3 times by a Bresenham table so that a cell is the pitch's width:

| Pitch | 60 dpi (`m`=0) dots per cell | 120 dpi (`m`=1) dots per cell |
|---|---|---|
| 10 cpi | 6 | 12 |
| 12 cpi | 5 | 10 |
| 17 cpi | 4 (3.5 avg) | 7 |

The 150/300 dpi request is mapped to the nearest standard Epson 8-pin densities, 60 and 120 dpi (`m`=0, 1). The
24-pin 180/360 dpi and `m`=3 (240 dpi) modes are not used because many printers and emulations mishandle them with
8-pin rows. Styles: bold ORs each column with the previous one, italic shifts the top four pins by one column,
superscript/subscript move the glyph up 2 / down 3 pin rows, underline sets row 10. Only the Craft face is printed
(characters 32-126); other faces and sizes are not.

## Memory
The printer code is overlay image R (id 5, 10 pages), assembled at the overlay slot, stored in bank 2 and staged at
`$B500` at startup, so the resident cost is the command stubs only. It does not touch the 11264-byte document area:
output goes through a 200-byte buffer in LDB (`$9F00`), flushed with CIO put-chars on IOCB `$40`. Printing replaces
the slot contents, so E/S commands are refused in PAGE view afterwards exactly as for the other page overlays.

## Test
`node scripts/acwriter-print.cjs` loads a styled document, prints in the four modes into the emulator's P: capture
(`Printer.lines`, each frame has `e` = EOL seen), rebuilds the byte stream, checks the ESC sequences and renders the
bitmap captures to `out/acw-print-b.png` and `out/acw-print-d.png`. Not verified on real printer hardware.
