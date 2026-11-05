# Text Wizard / Letter Wizard document format (Datasoft, 1981, Atari 8-bit)

Source: Text Wizard V1.3 (ATX side A booted in the emulator with an OS-B 400/800 ROM; the ATX has no
copy protection and converts to a plain ATR via `AC.DiskConv.atxToAtr`). Files were created by typing in
the real program and saving with Option+S (save writes from the cursor to the end of text, so move to the top
with Option+T first). Command keys are from Datasoft's Command Reference Card.

## Container
Plain ATASCII text file written through DOS (CIO). No header, no footer. Lines end in `$9B`; the last line has
no EOL. Soft wrap is not stored (a 77-char line typed without Enter is one line). Tab key = `$7F`.

## Verified (bytes seen in saved files)
| Byte | Key | Meaning |
|---|---|---|
| `$9B` | Return | end of line |
| `$03` | Ctrl-C | centre (line start). Two (`03 03`) at line start: "block text right" per the card |
| `$15` | Ctrl-U | underline toggle (`61 15 75 6e 64 15`) |
| `$02` | Ctrl-B | superscript toggle |
| `$06` | Ctrl-F | subscript toggle |
| `$0C` `$12` | Ctrl-L / Ctrl-R | left / right margin, followed by ASCII digits (`0c 31 30` = 10; `12 37 30` = 70) |
| `$0D` `$0E` | Ctrl-M / Ctrl-N | second left / right margin + ASCII digits (`0d 35`, `0e 36 30`) |
| `$10` | Ctrl-P | stored as one byte (meaning per card: "@ symbol"/page control; unverified) |

Bold: none exists in this program (verified absent from the key list).

## Unverified (from the reference card only; the harness could not produce the bytes)
- Ctrl-J(1)/(0) justify on/off: the editor converted Ctrl-J into an EOL (`$9B`) in our tests.
- Ctrl-H / Ctrl-G header / footer (Ctrl-H did nothing when typed), Ctrl-Q page number, Ctrl-V chain,
  Ctrl-I/D/Y/A/S (top/bottom margin, form length, line spacing, character spacing) argument digit counts.
- Ctrl-E elongated, Ctrl-T condensed (stored as one byte presumably).
- Inverse-video characters are "remarks" per the card (not printed); the importer drops them.

## Importer
`tools/import-textwizard.cjs` `read(buf)`: per line, leading Ctrl-C -> centre / right; Ctrl-U/B/F toggle the
underline/sup/sub state; margin/layout codes plus their digits are consumed; layout-only lines are dropped,
empty lines kept.
