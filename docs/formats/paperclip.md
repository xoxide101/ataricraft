# PaperClip (Batteries Included, 1985) document format

Reverse-engineered from files saved by PaperClip 1.0 (Paperclip_10.ATR) running in the emulator. Only bytes seen in saved files are listed.

## Saving
Ctrl+Shift+W ("Write?") then a name such as `D1:NAME`. (The stock disk is full; free sectors first. A bare `NAME` gave error 144 on a read-only/flagged ATR.) The file is a normal DOS 2 file.

## Layout
- No header, no trailer. Plain ATASCII bytes.
- `$9B` = end of line = paragraph end (Enter). Soft word-wrap is not stored (a 100-char line stays one line). The last line may have no `$9B`.
- Code bytes are in-line and inserted by Ctrl-key commands; the S/E prompt answers are not stored.

## Verified codes
| Byte | Meaning | Keys |
|---|---|---|
| $82 / $81 | bold start / end | Ctrl-B, S / E |
| $95 / $80 | underline start / end | Ctrl-U, S / E |
| $85 | superscript start | Ctrl-S, P |
| $84 | subscript start | Ctrl-S, B |
| $86 | end of super/subscript | Ctrl-S, E |
| $83 / $9A | centre start / end (end sits just before the `$9B`) | Ctrl-C, S / E |
| $87 | block right (at line start) | Ctrl-R |
| $8E | new page | Ctrl-T |
| $8F | page number | Ctrl-N |
| $7E | printer tab | Ctrl-A |
| $8C n..n $9B | left margin, ASCII digits, EOL | Ctrl-M, L |
| $92 n..n $9B | right margin, ASCII digits, EOL | Ctrl-M, R |
| $94 c text $9B | special line (seen with `h` = header text) | Ctrl-Z |

## Unverified / not decoded
- $88 (Ctrl-P paragraph indent) and $90 (Ctrl-F pitch): code byte seen, operand format not understood.
- Top/bottom margins, italics (Ctrl-I inserted 4 spaces in the emulator, so italics not reached), other Ctrl-Z sub-codes, justification.
- Whether bold/underline state persists across lines.

Importer: `tools/import-paperclip.cjs`; test: `scripts/test-import-paperclip.cjs`.
