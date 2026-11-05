# Converting documents to and from Craft Word

## Import: `node tools/craftimport.cjs INPUT [OUTPUT.CWD] [--format F] [--cols N]`

`F` is one of `atascii text rtf html md doc docx`. It is auto-detected from content and extension. Output is a CRFT `.CWD` file (see CRAFT-FORMAT.md), wrapped at 64 columns with soft breaks (14) and hard ends (13).

| Format | Kept | Dropped |
|---|---|---|
| ATASCII text (line end `$9B`) incl. AtariWriter / AtariWriter+ and TextPro text files | text; AtariWriter inverse video as underline, Ctrl-C centre, Ctrl-C Ctrl-C flush right | format lines (margins, spacing, headers, footers, chaining), other control bytes |
| ASCII / UTF-8 text (CR, LF, CRLF) | text | unmappable characters become `?` |
| RTF | bold, italic, underline, super/sub, centre/right/justify, bullets | fonts, colours, pictures, tables |
| HTML | bold, italic, underline, super/sub, headings (bold), list bullets, alignment | CSS, scripts, images, tables |
| Markdown | headings (bold), bold, italic, bullets | links, code styling |
| `.docx` | bold, italic, underline, super/sub, alignment, bullets | fonts, colours, images, tables (cell text is kept) |
| `.doc` (Word 97-2003) | text only | all formatting; encrypted files are refused |

Smart quotes and dashes are transliterated to ASCII. The payload is cut at 16383 bytes.

AtariWriter rules come from its manual and from sample documents on the AtariWriter+ disks. Its bold, elongated and sub/superscript markers are not decoded, because no sample file shows how they are stored.

## Export: `node tools/craftexport.cjs FILE.CWD OUTPUT [--format text|atascii|rtf|html|md] [--eol crlf|lf|cr]`

The format defaults to the output extension (`.txt`, `.atx`, `.rtf`, `.htm`, `.md`).

- `text`: Latin-1 text, centre and right alignment done with spaces.
- `atascii`: printable ASCII, lines end in `$9B`, anything else becomes `?`.
- `rtf`: bold, italic, underline, super/sub, alignment, bullets. Word opens it.
- `html`, `md`: the same styles in their own markup.

## Atari word processors (decoded from documents saved by the real programs)

Use `--format letterperfect|paperclip|firstxlent|textwizard|bankstreet`. A Bank Street Writer disk image is detected automatically. Each format is documented in `docs/formats/`, with samples in `docs/samples/import/`. Only codes seen in saved files are decoded; unverified ones are listed in each format note and dropped.

- Letter Perfect: centre, bold, underline, super/subscript.
- PaperClip: bold, underline, super/subscript, centre, right.
- First XLEnt: centre, right. Bold and underline are printer-driver codes and are dropped.
- Text Wizard: centre, underline, super/subscript.
- Bank Street Writer: centre only.

## Not supported

Final Word, Indus Writer, the Atari Wordprocessor, TextPro, SpeedScript and others: no program or documents available yet. Point me at sample files and the importer can be extended.

`tools/lsdisk.cjs DISK.ATR [NAME [OUT]]` lists or extracts files from an ATR to feed the importer. `node scripts/craft-convert.cjs` runs the round-trip test.
