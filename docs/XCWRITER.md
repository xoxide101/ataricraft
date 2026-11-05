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

## Page model

Paper size, pitch, margins and tab stops live in the shared page model: [PAGE.md](PAGE.md) (`tools/craftpage.cjs`, `XCW.Page`). ``.CWD`` files carry it as a trailer.

### Page view (third mode)

`Page view` draws the true page (`web/js/xcwriter/editor-page.js`): paper size and pitch from the page setup, text wrapped at the usable columns (80 for Letter at 10 cpi, not the 64-column screen), the ACWriter pixel font, 6 lpi lines, page breaks every `textLines` lines. One logical pixel grid: a column is 5 / 4 / 3 px at 10 / 12 / 17 cpi and a line is 8 px, so a Letter page is 425 x 528 px (about 50 px per inch; 12 and 17 cpi differ from true scale by up to 4%, because whole-pixel columns are used). 17 cpi draws only the left 3 columns of each 4 px glyph, so it is legible only roughly (the font work in stage 3 addresses this).

- **Zoom**: 50-400% (100% = 2 device px per logical px, close to life size), Fit width, Fit page, 1:1 pixels, Ctrl+wheel. Pixels are drawn as whole device pixels at every zoom (no canvas smoothing); 75% and 150% use uneven 1-2 px rows, so they are crisp but not perfectly regular.
- **Scroll**: native scrollbars in both directions; the caret scrolls into view.
- **Ruler**: inch labels, margin markers (blue, drag), page centre mark (red), left / centre / right tab stops (orange). Click to add a stop of the type chosen in the bar, drag to move, double-click or right-click to remove.
- **Navigator**: thumbnail of all pages with the viewport rectangle, bottom right; click or drag to move the view.
- **Page setup...**: paper (Letter, A4, Legal), pitch, margins, with a fit bar showing the usable columns, inches and lines per page, and whether the text width fits the 320 px Atari screen without scrolling. Changing the pitch resets margins to that pitch's defaults and clears tab stops.
- **Tab key** inserts spaces up to the next stop; centre and right stops act as left stops while typing (they are honoured as real centre/right alignment only when text with tab characters is imported or laid out through `Page.expandTabs`).
- The page (and its tab stops) is saved into the `.CWD` trailer from any mode once the document has one; opening a `.CWD` that has a trailer restores it. In Atari matching mode the view still wraps at 64 columns.

Test: `node scripts/xcwriter-page-test.cjs` (screenshots `out/xcwp-*.png`). Not verified: other browsers (only Chrome), high-DPI displays (devicePixelRatio is handled but only tested at 1).

## Tests

`node scripts/test-xcwcore.cjs` (core round trips for all formats), `node scripts/test-xcwriter-bundle.cjs` (browser bundle equals Node output for 21 inputs x 7 formats), `node scripts/xcwriter-test.cjs` (Playwright: samples, typing, spelling, undo, find, both modes, round trip, convert, screenshots in `out/xcw-*.png`). The older `craft-convert`, `test-dict` and `test-import-*` scripts still pass.

## Round-trip verification

Run: `node scripts/test-roundtrip.cjs` (Node: formats, RTF variants, Word fixtures, truncation), `node scripts/xcwriter-test.cjs` (in-page export->import, Word files), `node scripts/acwriter-roundtrip.cjs` (real emulator + xCWriter page, about 2 min; screenshots `out/rt-*.png`). Word fixtures: `scripts/mk-word-fixtures.ps1` (Word COM; run it as a background job), samples in `docs/samples/word/`. After changing `tools/craftimport.cjs`, `craftexport.cjs`, `officeread.cjs` or `xcwcore.cjs` run `node scripts/sync-xcwriter-core.cjs`.

Verified (evidence in the scripts above):

- ACWriter -> xCWriter: composed bold, italic, underline, centre, right, bullet, sub, sup in the emulator, File > Save As `h:acrt`, read the bytes from `hostFiles()`; xCWriter opens it in HQ and matching mode with an identical model. Pass.
- xCWriter -> ACWriter: Send to Atari (BroadcastChannel) reached the emulator; File > Open `h:xcrt` renders the text, styles and alignment (screenshot checked); ACWriter Save As and xCWriter re-read give the same model. Pass. Smart quotes become ASCII quotes on the Atari side; `é` survives in the file but draws as an odd glyph in ACWriter's font.
- Export then re-import in xCWriter: rtf, html, docx and cwd are lossless for text and styles (cwd transliterates quotes, dashes, euro); md loses underline, sub/sup and alignment; text and ATASCII keep plain lines only (ATASCII turns `é` into `?`). Partial for md/text/ATASCII, by design.
- Real Word (COM): xCWriter's exported RTF, docx and HTML open, export to PDF, and keep paragraphs, bold, italic, underline, sub/sup and centre/right/justify. docx bullets are real Word lists; RTF bullets arrive as literal "•<tab>" text.
- Word-made .doc/.docx/.rtf (headings, styles, bullets, alignment, table, smart quotes, symbols, long text) import into xCWriter and, through `craftimport.cjs`, open in ACWriter. `.docx`/`.rtf` keep styles, alignment and bullets; `.doc` is text only. Tables become ` | ` separated lines. Pictures, headers/footers, fonts, colours, sizes, hyperlink targets are dropped (link text kept). Non-Latin-1 symbols become look-alikes or `?` in Craft mode (euro -> E, trademark -> TM); xCWriter HQ keeps them.
- RTF reader bugs fixed: per-character runs, `\uN` with `\uc` fallback skipping, `\'xx` cp1252 bytes, `\pntext`/`\listtext` lists, tables (`\trowd..\cell..\row`), alignment persisting until `\pard`, `\plain`, skipped groups (fonttbl, colortbl, stylesheet, info, pict, fldinst, `\*`). Hand-written, WordPad-style and Word RTF are covered by tests.
- Atari limit: imports are cut to 11,264 bytes at a paragraph end, open styles closed, and flagged (`truncated`, `dropped`, CLI message). The 220-paragraph test RTF became 11,278 bytes (9,530 dropped); ACWriter opened it without hanging and showed "11262 ch, 0K free". Previously the cap was 16,383 and ACWriter refused such files.

Known losses: `.doc` formatting; Markdown underline/sub/sup/alignment; plain-text styles; Atari glyph coverage (accents draw badly, euro/trademark/emoji transliterated); Word RTF bullets are not Word lists; tables are flattened; images are skipped.

## Not done / known limits

Legacy .doc is text only; inverse video (code 4) round-trips as underline; docx/rtf/html exports verified in Word (see Round-trip verification); no print/PDF; no images; tables are flattened to  | b lines; matching-mode glyph styles are approximations; C64 profile not started.
