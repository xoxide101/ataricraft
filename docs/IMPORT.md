# Importing documents into Craft Word

`node tools/craftimport.cjs INPUT [OUTPUT.CWD] [--format atascii|text|rtf|html|md] [--cols N]`

The format is auto-detected from content and extension. Output is a CRFT `.CWD` file (see CRAFT-FORMAT.md), wrapped at 64 columns with soft breaks (14) and hard ends (13).

| Format | Kept | Dropped |
|---|---|---|
| ATASCII text (EOL `$9B`; AtariWriter, TextPro and others) | text | the editors' own control codes and styles |
| ASCII / UTF-8 text (CR, LF, CRLF) | text | unmappable characters become `?` |
| RTF | bold, italic, underline, super/sub, centre/right, text | fonts, colours, pictures, tables |
| HTML | bold, italic, underline, super/sub, headings (bold), list bullets, centre/right | CSS, scripts, images, tables |
| Markdown | headings (bold), bold, italic, bullets | links, code styling |

Limits: payload is cut at 16383 bytes. Smart quotes and dashes are transliterated to ASCII.

Not yet decoded: AtariWriter(+) style codes (e.g. `1B 13`, `0E`, `0F` seen in samples) and the AtariWriter settings header. The samples were not enough to verify their meaning, so they are skipped rather than guessed.

`tools/lsdisk.cjs DISK.ATR [NAME [OUT]]` lists or extracts files from an ATR to feed the importer.
