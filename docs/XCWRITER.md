# xCWriter - eXtreme Craft Writer

A browser word processor (`web/xcwriter.html`) for the Craft family. One document model, every format, two modes. It runs offline with no build step; open it from the main app's **xCWriter** tab or directly as a file.

## Modes

| | High quality | Atari matching |
|---|---|---|
| Page | contenteditable page, system fonts (Georgia, Calibri, Consolas...), 10-20 pt, line spacing | 320x192 canvas, 64 columns x 20 lines, ACWriter 4x7 pixel font (font4 + symbol set), 5 px pitch, themes paper/blue/amber/green |
| Wrap | browser | `craftimport.layout()` through `XCW.atariLines`, soft break 14, hard end 13 |
| Limits | none | live meter: bytes of the CRFT payload against the 11264 byte document area ($6400-$8FFF) |
| Characters | anything | non-Atari characters become look-alikes or `?` on entering the mode (undoable); typing is mapped the same way |

Switching keeps the document. The side panel lists what the Atari cannot show. A `.CWD` exported from matching mode reopens to the same payload and the same screen lines (checked by `scripts/xcwriter-test.cjs`). Bold, italic and underline are drawn approximately (smear, shear, underline row); the file stores exact style codes. Justify and centring are drawn from the alignment marker, not read back from ACWriter. The round trip is proven at file level (export, import, export), not by running the file in ACWriter.

## Formats

Open: .CWD, text, ATASCII (EOL $9B), RTF, HTML, Markdown, .docx, .doc (text only), Letter Perfect, PaperClip, First XLEnt, Text Wizard, Bank Street (file or .ATR image). Unknown extensions ask for the format; Shift+Open always asks. Save: .CWD, text, ATASCII, RTF, HTML, Markdown, .docx. Every save and the **Convert** dialog list what the target drops ("bold dropped for ATASCII (12 characters)").

The .docx writer uses stored (uncompressed) zip parts with styles and bullet numbering; it is re-read by our own reader, but has not been opened in Microsoft Word. The .docx reader handles deflate through `tools/inflate.cjs`.

## Editor

Toolbar: bold, italic, underline, sub/sup, align L/C/R/J, bullets, undo/redo (own model snapshots), find and replace (with match case, replace all), spell check. Spell check uses the compact Bloom-filter dictionary `docs/samples/EN.CDC` (`tools/cdict.cjs`, `docs/DICTIONARY.md`): red squiggles, right-click for suggestions (transpositions first), ignore, add. About 2% of misspellings slip through. Word and character count and the fit meter are in the status bar. The home screen has New, Open, Convert, the demo, Help and recent documents (localStorage, last 8).

## Send to Atari

`Send to Atari` posts the .CWD over a `BroadcastChannel('xcwriter')` to the main app tab (index.html), which calls `FujiNet.emu.hostWrite(name, bytes)`. In ACWriter use File > Open and type `H:NAME.CWD`. The emulator must be booted in the same browser; otherwise the toast says so. Fallback: save the .CWD and use the H: panel import.

## Architecture (for Electron and C64 later)

```
tools/*.cjs                 one source of truth, run in Node and wrapped for the browser
  craftimport / craftexport  importers, exporters, layout()
  officeread, import-*.cjs   docx/doc and Atari word processor readers
  inflate.cjs                 sync raw inflate (replaces zlib in the browser)
  cdict.cjs                   dictionary
  xcwcore.cjs                 DOM-free core: model edits, Atari layout/fit, formats, docx writer, spelling
scripts/sync-xcwriter-core.cjs   bundles the above into web/js/xcwriter/core/xcw-core.js (+ shim.js: Buffer/fs/zlib)
                                  and xcw-data.js (font, symbols, EN.CDC, demo). Run after changing tools/; --check verifies.
web/js/xcwriter/editor-hq.js, editor-atari.js, app.js   the only DOM code
```

The core takes a profile (`XCW.PROFILES.atari`: columns, rows, document limit, pixel size). A C64 profile means a new profile plus its own importer/exporter pair; the UI reads sizes from the profile. Electron can `require('tools/xcwcore.cjs')` directly and reuse the same UI files.

## Tests

`node scripts/test-xcwcore.cjs` (core round trips for all formats), `node scripts/test-xcwriter-bundle.cjs` (browser bundle equals Node output for 21 inputs x 7 formats), `node scripts/xcwriter-test.cjs` (Playwright: samples, typing, spelling, undo, find, both modes, round trip, convert, screenshots in `out/xcw-*.png`). The older `craft-convert`, `test-dict` and `test-import-*` scripts still pass.

## Not done / known limits

Legacy .doc is text only; inverse video (code 4) round-trips as underline; docx not verified in Word; no print/PDF; no images or tables; matching-mode glyph styles are approximations; C64 profile not started.
