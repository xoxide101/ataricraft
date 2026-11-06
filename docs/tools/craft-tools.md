# Craft documents, fonts, dictionaries and importers

Existing docs cover the formats and apps in depth: [../formats/](../formats), [../FONT.md](../FONT.md), [../IMPORT.md](../IMPORT.md), [../XCWRITER.md](../XCWRITER.md), [../EBOOKCRAFT.md](../EBOOKCRAFT.md), [../PDFVIEW.md](../PDFVIEW.md).

| Tool | Purpose |
|---|---|
| `craftdoc`, `craftimport`, `craftexport`, `craftpage`, `craftmaster`, `craft8art`, `craftfont` | Craft document format reading/writing, page layout, import/export, graphics and font handling |
| `acwfaces.cjs` | Face/font tables for ACWord |
| `cdict`, `mkdict`, `spellcheck` | Dictionary build and spell check |
| `fontpipe.cjs`, `sfnt.cjs` | Convert TrueType/OpenType into Atari fonts |
| `officeread.cjs`, `inflate.cjs` | Read office formats; deflate decoder |
| `xcwcore.cjs` | Shared xCWriter core |
| `import-bankstreet`, `-firstxlent`, `-letterperfect`, `-paperclip`, `-textwizard` | Importers for old word-processor files |
| `tools/ebookcraft/` | `build-viewer.cjs`, `viewer.asm`: Atari-side e-book viewer |
| `web/pdfview.html` | PDF viewer, reusable module `web/js/pdfjs/pdfengine.js` |
| Web apps | `workbench.html`, `fontedit.html`, `xcwriter.html`, `ebookcraft.html`, `server.html`, `pdfview.html` in `web/` |

Run any `.cjs` without arguments for usage; header comments describe formats.
