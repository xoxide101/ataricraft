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

## In-app import and start menu (ACWriter)

The 6502 app (`tools/acwriter`) opens on a start menu: N new, O open, S save, A save as, C convert/import, H help (also F1 or the Help key), E or Esc back to the document (kept in memory), Q quit to the OS. Up/Down + Return also pick an entry. The help page lists the keys and the import notes.

Convert / import reads a plain text or ATASCII file through CIO and replaces the document: lines end at $9B/$0D/$0A, long lines wrap at 64 columns with soft breaks (14), inverse video becomes underline, Ctrl-C at the start of a line centres (two = right-aligns), other control bytes are dropped. File > Open uses the same path for any file without a CRFT header. It does not yet drop the command lines of foreign word processors; convert Letter Perfect, PaperClip, Text Wizard, Bank Street, RTF and Word files on the PC with `tools/craftimport.cjs` first. Test: `node scripts/acwriter-home.cjs`.

## Document size limit

ACWriter holds the document in RAM at $6400-$8FFF, so a document (and therefore an import) is limited to about 11 KB (11,264 bytes). Longer imports are truncated.

