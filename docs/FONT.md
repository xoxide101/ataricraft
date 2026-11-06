# Craft font model

One font model for ACWriter (6502) and xCWriter / the font editor (browser). Code: `tools/craftfont.cjs` (re-exported as `XCW.Font` in the xCWriter bundle), tests `scripts/test-craftfont.cjs` and `scripts/fontedit-test.cjs`, tool `web/fontedit.html`, converters `tools/acwriter/ttf2acf.cjs` and `tools/acwriter/mkcraftfonts.cjs`.

## Cell and metrics

A glyph is a fixed-width bitmap in a **12-row cell**. Rows are numbered from the top of the cell:

| Rows | Name | Notes |
|---|---|---|
| 0-1 | headroom | 2 px above the capital line; empty for ordinary glyphs; superscript goes here |
| 2 | cap line | top of capitals (`head`) |
| 4 | x-height line | top of lower-case bodies (`xTop`) |
| 2-8 | capitals | 7 rows, baseline row = 8 (`base`) |
| 4-8 | lower case | 5 rows (x-height) |
| 9-11 | descender | 3 rows below the baseline (`desc`); `g j p q y , ;` descend here; the rows are also the space between lines; subscript goes here |

Line advance for single spacing = cell rows = **12 px** (2 headroom + 7 caps + 3 descender), so a descender never touches the next line's capitals and a superscript or subscript never leaves its line. Extra leading is added on top.

**Superscript / subscript**: `supUp` (default 2) shifts the glyph up that many rows (caps then occupy rows 0-6, inside the headroom); `subDown` (default 3) shifts it down (caps end on row 11). Both are automatic shifts of the normal glyph; a font may also carry **per-code variants** that replace the shift for one character.

**Width**: fixed. `adv` = advance in pixels (4, 5 or 6), `gw` = glyph columns (`adv - 1`: one blank column between characters). Pixels are stored MSB-left in one byte per row (bit 7 = leftmost).

| Built-in | adv / glyph | Intended pitch | Source |
|---|---|---|---|
| Craft 6 px | 6 / 5 | 10 cpi | Atari 8x8 font, columns 7 -> 5 |
| Craft 5 px | 5 / 4 | 12 cpi | the ACWriter 4x7 font (hand-tuned glyphs) |
| Craft 4 px | 4 / 3 | 17 cpi | Atari 8x8 font, columns 7 -> 3, m / w / M / W hand drawn |

The ACWriter descender glyphs have a one-row-shifted body; the Craft builds re-seat them on the baseline and stretch the descender to 3 rows (stem rows repeated).

## Code space and case locations

A font has 256 **slots** (glyph storage) and a 256-entry **map** `code -> slot`. Default is the identity map (`'A'` = slot 65, `'a'` = slot 97). The user can place the real upper-case A-Z and lower-case a-z glyphs anywhere (`upper`, `lower` base slots in the header; "Place" in the editor copies the 26 glyphs to the new location and updates the map), so a font can keep, say, small caps or alternate letters in other slots, or move the case ranges clear of the control/symbol area. Only the slot range `first .. first+count-1` is stored.

## ACF2 file (`.acf`)

```
"ACF2"
u8 adv, gw, rows(12), head(2), xTop(4), base(8), desc(3)
i8 supUp, i8 subDown
u8 first, u8 count (0 = 256)
u8 flags        bit0 = map table present, bit1 = variants present
u8 upper, u8 lower     base slots of A-Z / a-z
u8 nameLen, name (latin-1)
[256 x u8 map]  if bit0
count x rows bytes     glyph slots first.. (one byte per row)
[u8 n, n x (u8 code, u8 kind 1=sup 2=sub, rows bytes)]  if bit1
```

Old `ttf2acf` files (`"ACF1"`, several sizes, 96 glyphs each) still load: one size is chosen and metrics are inferred from the height (a sixth headroom, a quarter descender), identity map. `ttf2acf.cjs` without `--cell` still writes ACF1; `ttf2acf.cjs font.ttf out.acf --cell 5 [--name N]` writes ACF2 (supersampled 4x, glyph scaled so capitals fill rows 2-8, squeezed to `gw` columns, coverage >= 30 %). The font editor does the same conversion in the browser. A JSON form (`format: "craft-font"`, glyph rows as hex strings) is also read and written.

**Row bytes (flag bit5, sizes above 16 px):** when the advance is wider than 16 px a `u8 bpr` byte follows the meta block (after `[u8 origin, u8 locked, u8 masterAdv]`; if flag bit3 is not set it follows the name) and every glyph row is `bpr` bytes (3 or 4: up to 32 px), high byte first, bit `8*bpr-1` leftmost. Files without flag bit5 keep their old layout (bpr 1 when not wide, 2 when wide), so every older `.acf` loads unchanged. Bit operations on 4-byte rows must be unsigned (`>>> 0`), a signed `1 << 31` bit breaks shifts.

## 6502 data (`.inc`)

`toInc(font, prefix)` writes constants (`prefix_ADV`, `_GW`, `_ROWS`, `_HEAD`, `_XTOP`, `_BASE`, `_DESC`, `_SUPUP`, `_SUBDN`, `_FIRST`, `_COUNT`), then one plane per cell row `prefix_0 .. prefix_11` (`count` bytes each, MSB-left) and `prefix_map` (256 bytes, slot minus `first`, 255 = not stored). `tools/acwriter/mkcraftfonts.cjs` emits `craft4.inc`, `craft5.inc`, `craft6.inc` (prefix `c4`, `c5`, `c6`) and `web/js/fontedit/builtin-fonts.js`. Per-code variants are not emitted: the 6502 uses the automatic shift.

## Font editor

**Unified layout (current).** One **Fonts** list (Craft Sans, ACWriter faces, shipped, personal, converted, ROM reference, imported "Mine") with badges and search/filters -> pick a **family** -> a **size strip** with every Craft size 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26 px (existing sizes filled, missing ones dashed: click creates it from the family master) -> glyph grid and pixel editor for the selected size. The master (a TTF/OTF/WOFF outline or the 12 px pixel master), threshold, baseline and re-render controls are the **Family source** panel, not a separate mode. Import adds a family to the same list. All exports are in one **Export** menu. The Craft sizes 14-26 and the Atari 8x8 view are embedded (`web/js/fontedit/craft-big.js`, written by `scripts/acw-faces.cjs`), so `file://` needs no server and no node script; the 8x8 Atari view derives itself. Tabs: Glyphs, Family, Specimen, Atari, Kerning, Quality; right panel: Glyph, Selection (batch), Reference ghost, Metrics, Preview, History. Code is split into modules in `web/js/fontedit/` (core, glyphs, editor, library, export, views, kern, quality, validate). Tests: `scripts/fontedit-test.cjs`, `-tools-test`, `-ui-test`, `-ui2-test` (file:// size strip 4-26).

Limits today: kerning is editor-side (autosave and `kerning.json` in the zip), ascender/descender guides are not draggable on their own, WOFF2 import is the Node pipeline only. Planned (not implemented yet): outline layer with contour editing, font manager panel, extra retro formats, family manifest with per-app flags.

`web/fontedit.html` (no build, works from `file://`): open a built-in font, `.acf` (ACF2 or legacy ACF1, which asks which size), `.json` or a TTF/OTF/WOFF (converted in the browser to the chosen advance); glyph-slot grid; pixel editor with the guide lines (headroom, cap, x-height, baseline, descender), shift/clear/invert/mirror/copy/paste/undo; Normal / Super / Sub target (a first edit of Super or Sub creates a variant, "Use auto shift" removes it); upper/lower case placement and a per-code slot field; `supUp` / `subDown`; preview text at 1-4x with real line spacing (`^{..}` super, `_{..}` sub, optional guide lines and extra leading); save `.acf`, `.json`, `.inc`.

## Size family, 12x12 master and derived sizes

Screen sizes are chosen for legibility: anything under 10 px is hard to read on a monitor, so 12x12 is the minimum *viewing* cell and the **master** of a family. The 4/5/6 px faces are overview and navigator faces only. The screen is a representation (a pixel font, not dot-matrix emulation); printing is a separate output process (see below).

| size | adv x rows | ink (gw) | head / cap..baseline / desc | use |
|---|---|---|---|---|
| 12 (master) | 12 x 12 | 10 | 2 / rows 2..9 (8 body) / 2 | default editing/viewing size, TTF target |
| 10 | 10 x 12 | 8 | 2 / 8 / 2 | narrower tall face |
| 8 | 8 x 12 | 8 | 2 / rows 2..8 (7) / 3 | native Atari size (8x8 body) |
| 6, 5, 4 | 6/5/4 x 12 | 5/4/3 | 2 / 7 / 3 | overview, navigator, 17 cpi |

Tall sizes (12, 10) use 2 rows above, an 8-row body and 2 below; the small faces and 8 keep the earlier 2/7/3 cell (the 6502 planes). Sup goes into the headroom and sub into the descender rows, scaled per size (`supUp`/`subDown` in `SIZES`).

**ACF2 additions (backward compatible):** header flag bit2 = *wide* (`gw > 8`): each glyph row is two bytes, high byte first, bit 15 leftmost (so 10-12 px ink fits). Flag bit3 = meta block `[u8 origin, u8 locked, u8 masterAdv]` after the name; origin 0 master, 1 derived, 2 hand-edited. Variants use the same row width. `.inc` output for wide fonts adds an `_<row>L` low-byte plane per row. A family is saved as one JSON file (`format: "craft-family"`, one font per size) or as one `.acf` per size.

**TTF/OTF/BDF/PNG -> 12x12:** `rasterTtf(b64, {size:12, threshold, weight, hint})` renders at 4x supersampling, scales capitals to the 8 cap rows, squeezes the width into the ink columns; `weight` thickens (+) or thins (-); `hint` stretches vertically so the x-height is a whole number of rows; a glyph that would vanish (thin underscore) keeps its strongest pixels.

**Derive smaller:** `derive(master, size, {threshold, keepStems})` maps the head, cap-to-baseline and descender bands onto the target bands and the ink columns onto the target ink columns by area coverage; a pixel is on at `threshold` (0.4), and with `keepStems` a pixel with >= 25 % coverage and no inked horizontal neighbour is kept so thin stems survive. Map, case locations and sup/sub variants are carried over. `familyDerive` skips any size that is locked or hand-edited unless `force`; editing a glyph of a derived size marks it hand-edited. The editor shows the origin and lock per size.

**150/300 dpi (print, not built):** the page maps as paper inches x dpi (Letter 8.5x11 at 300 dpi = 2550x3300 dots; at 150 dpi 1275x1650). Pitch gives dots per column: 300/10 cpi = 30 dots, 25 at 12 cpi, ~17.6 at 17 cpi; line pitch 300/6 = 50 dots. A font cell is scaled so its advance equals the column pitch (12 px cell -> 2.5x at 10 cpi/300 dpi) and rows by the line pitch. A print engine would rasterise the layout this way; none is implemented. xCWriter's PDF/RTF/docx exports are unchanged.

## Status

Verified: model and file round-trips, built-in metrics, ACF1 load, `.inc` plane count (Node); editor flows and a TTF conversion (Playwright, `out/fe-*.png` viewed). Not yet verified: the 6502 consuming these files (stages 4-5). Known quality limits: the 3 px face is a compromise (several glyphs such as `0 $ 5` are crude, fixable in the editor); TTF conversion at 4-6 px needs hand tuning; sup/sub use shifts, so a subscript descender can be clipped by the cell bottom.

Note: web/library/fonts/craft/*.acf is gitignored and regenerated by tools/acwriter/mkcraftfonts.cjs; the committed copies are craft{4,5,6}.inc and web/js/fontedit/builtin-fonts.js.

## Styles and sections (xCWriter, ACWriter)

Fonts are assigned at four levels and may be mixed. Precedence, lowest to highest:

1. **Document default** font (`page.dfont`, Styles... dialog).
2. **Section font** (a section is a run of paragraphs from a *section break* to the next one; paragraph 0 starts the first). Set with *Section font*, *Section break* and the *Section* list in the Page view bar.
3. **Style of the role** (Body, Title, Heading 1-3, Caption): face (empty = follow the section), cell size (4/5/6/8/10/12), bold, italic, alignment, space before. Edited per document in *Styles...*, applied with *Style*. Face and size follow the style live; bold/italic/alignment are copied into the paragraph when the style is applied.
4. **Explicit paragraph font and size** (the *Typeface* and *Size* controls).

A line has one face and one size: the unit is the paragraph, never a run. Sizes exist for the Craft family only (craft4/5/6/8 = `.fnt`/`.acf`, craft10/12 = `.acf`); a size choice on any other face (Atari ROM, shipped `.fnt`, personal fonts) leaves the face unchanged, and the size note under the bar says which sizes the current face has. Storage: CPG1 tags 4-7, plus the resolved faces as tags 2/3 so ACWriter and old readers need nothing new ([PAGE.md](PAGE.md)). docx: Title/Heading1-3/Normal/Caption styles with face and size, a continuous `w:sectPr` before every section, `w:rFonts` (with the exact face id in `w:cs="xcw:ID"`) and `w:sz` per run; import maps sans fonts to CRAFT8, serif to the standard face, monospace to the Atari ROM face (override with `fontMap`), point sizes to the nearest cell size, and a body-font change without section breaks starts a new section. ACWriter renders the resolved faces in the 2x view (8x8 `.FNT` faces only; `.acf` sizes and style spacing are not read on the Atari). Tests: `scripts/test-craftsections.cjs`, `scripts/xcwriter-sections-test.cjs`, `scripts/acwriter-sections.cjs` (pixel-identical against xCWriter's Atari 2x view).
## Font library (fontedit)

`node scripts/fontlist.cjs` writes `web/library/fonts/local/manifest.json` for the font editor's *Font library* list: **Shipped** (`font/` plus `web/library/fonts`), **Atari ROM** (the OS charset, extracted from `software_n_roms/ATARIXL.ROM` at $2000; generated, never committed) and **Personal** (`font_personal/`, gitignored with `web/library/fonts/local/`). `.fnt` files (1 KB/2 KB Atari charsets) import as 8 px Craft fonts through `Font.fromFnt`; TTF/OTF go through the rasteriser (default target the 12x12 master with 2-byte rows; any size from 12 down to 4 can be chosen). Test: `scripts/fontlist-test.cjs`.

### Editor tools and converters (`web/fontedit.html`, `tools/craftfont.cjs`)

* Drawing: pencil (left draws, right erases), line, rect (outline or filled), flood fill; shift, clear, invert, mirror, **Flip V**, **Rotate** (the ink square), copy/paste, undo and **redo** (Ctrl+Z / Ctrl+Y); **New** blank font at the size picked in the TTF list.
* Import: `.acf`/`.json`/family JSON, TTF/OTF/WOFF (threshold, weight, hint), **BDF** (`fromBdf`: baseline lands on the font's baseline row; size 12 for tall BDFs, 8 otherwise, or the size chosen), Atari `.fnt` (1K/2K), **PNG sheet** (`fromSheet`: 16 x 16 cells of `adv x 12` px, dark = ink). **PCF** bitmap fonts (`fromPcf`: either byte/bit order, glyph pad 1/2/4/8, compressed or full metrics; gzip `.pcf.gz` is unpacked in the browser) are imported through the BDF path.
* Export: `.acf`, `.json`, 6502 `.inc`, Atari `.fnt` (`toFnt`, 8 px fonts only), **PNG sheet** (`toSheet`, re-importable) and a PNG of the preview.
* `deriveGlyph` never turns a glyph that has ink into an empty one (the cell with the most coverage is kept).
* Tests: `scripts/fontedit-tools-test.cjs` (sheet, .fnt, BDF round trips; flip/rotate identities; derived sizes have no empty glyphs; tool, undo/redo and import/export flows in the browser; screenshot `out/fe-tools.png`), `fontedit-test.cjs`, `fontlist-test.cjs`, `fontlib-test.cjs`, `test-craftfont.cjs`, `test-craftfonts.cjs`.

### Fonts on the machines

ACWriter (Character > Font) loads `.FNT` 8x8 charsets into bank 3; xCWriter's Page view has a font picker fed by `library/fonts/local/manifest.json` (served over http only) and draws a face by folding each 8x8 glyph to the 4 px cell. The two renderings are therefore not pixel-identical (ACWriter's 2x view draws the true 8x8 glyphs); `scripts/xcwriter-font-test.cjs` proves the glyph rows equal the `.FNT` bytes and `scripts/acwriter-typeface.cjs` proves the emulator side. xCWriter's Atari matching mode has no per-paragraph font.

## Validation tools (font editor)

* **Validation panes** (`web/js/fontedit/validate.js`) draw the preview text as ACWriter PAGE view 1x (64 x 20 cells of 5x8, 4x8 fold) and 2x (20 x 9 cells of 16x16, 8x8 glyph: 8 px fonts verbatim, other sizes folded like xCWriter's 2x view) on the 320x192 screen, and as xCWriter's Page view (zoom 1-4, 10/12/17 cpi). Overlays: pixel grid, metric bands (2 headroom / cap / x-height / baseline / descender) and highlighting of differing glyphs.
* **Diff view:** each glyph (33..126) is rastered as Page view draws it (red) and as the 8x8 ACWriter glyph (blue), grey = both; glyphs differing by at least the threshold (default 10 %) are outlined and listed. `FE.val.diff()` returns the list and per-glyph fractions.
* **Per-glyph metrics:** ink width, left/right bearing and advance. An advance override is stored in `advs` (ACF2 flag 16: trailing `u8 n, n x (slot, adv)`; JSON `advs`); proportional preview uses it.
* **Send to ACWriter** writes `NAME.FNT` (8 px) or `NAME.ACF` to H: through `FujiNet.emu.hostWrite`, or over BroadcastChannel `xcwriter` to an open emulator tab. **Use in xCWriter** stores the font in `craft.userfonts`. **Set as master** makes the current size the master for **Derive smaller** (locked and hand-edited sizes are kept).


## Font pipeline (down and up)

One shared module, `tools/fontpipe.cjs` (+ `tools/sfnt.cjs`, a TrueType/OpenType/WOFF reader, rasteriser and TTF writer). Plain bytes in and out, no
fs/DOM, no build step: Node requires it, and the xCWriter bundle exposes it as `XCW.FontPipe` (`scripts/sync-xcwriter-core.cjs`).

**DOWN** (high-res to Atari): TTF / OTF (TrueType and CFF) / WOFF -> a size family 12x12 (master), 10x12, 8x8, 6, 5, 4 px. The master is rasterised by the
same rules as the editor (`CF.rasterTtf`: caps fill the cap rows, baseline = bottom of H, glyph squeezed to the cell, threshold/weight/hint); proportional
advances are kept in `advs`. The other sizes are `CF.familyDerive`. Pixel fonts (an em of 6-10 whole pixels, e.g. Atari8bit.ttf, PressStart2P) are
detected and sampled on their own grid for the 8x8 size, so they come out bit-exact. WOFF2 is not supported (Brotli): convert to WOFF/TTF first.

**UP** (Atari to general): ROM charset (`ATARIXL.ROM` 16 KB at $2000, 10 KB OS-B ROM at $0800, screen-code order, sanity-checked), 1 KB `.fnt`, `.acf`
(ACF2), BDF, PCF, JSON, XCF, or a TTF we wrote. Output: `.acf` per size, `.xcf`, `.bdf`, `.ttf`, `.fnt` (8 px). Sizes below the source's own are derived.

**XCF** (`.xcf`, JSON, a superset of `craft-family`): `{format:'xcf', version:1, name, family, style, master, source, hires, sizes:{"12":{...craft-font JSON...,
info:{"<code>":{n,u,adv,lsb,rsb,ink}}, metrics:{cap,xHeight,baseline,descender,headroom}}}}`. `info` carries the glyph name, Unicode, advance, left/right bearing
and ink box per code; bearings are derived (measured for fixed-pitch glyphs, centred for proportional ones). Readers that only know `craft-family` ignore the extras.

**Export that survives**: BDF carries a `COMMENT ACFM {json}` line, TTF carries an `ACFM` table with the same model; ink is drawn as pixel-square contours
(100 units per pixel; ASCII at its Unicode, other codes at U+E000+code) and DWIDTH/advance hold the proportional advance. Re-importing our own BDF/TTF is
exact; foreign BDF/TTF files go through the normal import.

**CLI**: `node scripts/fontpipe.cjs down|up|roundtrip <file> [--size 12,8|all] [--out DIR|file.ext] [--formats acf,xcf,bdf,ttf,fnt,json] [--threshold n] [--weight n] [--hint] [--direct] [--name N] [--install]`.
`--install` writes into `web/library/fonts/local/converted/` (gitignored) and rebuilds the manifest: the font then shows under **Converted** in xCWriter's picker
and the editor's Font library. `roundtrip` prints per size the pixel and advance diff of every export path (exit 1 over `--max`, default 0.5%).

**Font editor** (`web/fontedit.html`): Open handles XCF, ROM images and our BDF/TTF through the pipeline; **Export XCF / BDF / TTF** use `XCW.FontPipe.files`.

**Test**: `node scripts/fontpipe-test.cjs [--all]` runs every font in `font/`, `font_personal/`, `web/library/fonts(+atari)` and every ROM charset through
down/up and each export, asserting: glyph count (every source glyph with ink has ink), case, sub/superscripts, cap/x-height/baseline/descender rows,
advances preserved and a round-trip pixel diff <= 0.5% of cells (the exports are lossless, so 0 is expected). Report: `out/fontpipe-report.txt`
(score table, fail list, notes). The glyph checks are **source-relative** (`srcFacts` in the test measures the source outlines): case, x-height, descender and sup/sub are only required where the source has them (no-descender sources such as the EightBit Atari TTFs, caps-only fonts whose lowercase = capitals, fonts lacking some letters, fonts whose x-height exceeds the cap height). Documented waivers: sup/sub are not required when the source cap height is >= 0.7 em (the glyph fills the cell, so a 2-3 px shift clips it; also Atari-Russian, Poppkorn), up to 2 sub-pixel punctuation glyphs may rasterise to nothing, descenders are only required from 8 px up. Every source-side limit is printed in the report notes. `--all` also covers `web/library/fonts/personal/` (581 fonts, 3,245 size rows) and passes with 0 failures (before the source-relative rewrite: 1,209, almost all no-descender / caps-only / missing-letter sources, the rest the clipping and tiny-glyph cases above); no pipeline bug was found.
`node scripts/fontpipe-sheet.cjs` renders `out/fontpipe-sheet.png`.

**WOFF2**: `tools/woff2.cjs` decodes WOFF2 in **Node** (Brotli via `zlib.brotliDecompressSync`, plus the glyf/loca and hmtx table transforms, rebuilt as plain sfnt tables), so `fontpipe`, `fontpipe-test` and the scripts accept `.woff2`. Browsers cannot: `DecompressionStream` only knows gzip/deflate (no Brotli) and a pure-JS Brotli decoder (~120 KB dictionary) was judged too heavy for the no-build bundle, so the font editor and xCWriter report "WOFF2 is only supported in Node; convert to WOFF or TTF". `node scripts/woff2-test.cjs` decodes all 45 local `.woff2` and compares 18 of them glyph by glyph (1,782 glyphs, outlines and advances) with the TTF/OTF twin next to them: identical (two further twins are a different build of the font).`n`n**Known limits**: WOFF2 in the browser; BDF/PCF cells larger than 12x12 are clipped (warning); smaller sources cannot be enlarged (only derived downward); bearings are
derived, not stored per glyph; source glyphs that do not exist stay blank (Kidpixies.ttf lacks `% + < = > ^ _ ` { | } ~`); Kidpixies12.fnt has no descenders.
## Font editor: pipeline, Atari workflows, ACWriter faces

All import/export in `web/fontedit.html` goes through `XCW.FontPipe` (xcf, bdf, pcf, ttf/woff, 1K/2K `.fnt`, ROM images, ACF, family JSON); only PNG sheets, gz, ACF1/2 and json use the legacy loader.

**TTF -> Atari.** Opening a TTF converts it at once (name = file name) and shows a panel with a per-size preview. Controls re-convert live: size (`TTF -> ...` select), threshold, weight, hint, **baseline** (rows shifted), **native 8x8 grid** (pixel-grid fonts such as Atari8bit.ttf are sampled natively), **each size from outline**. Converted fonts are stored in "My fonts (this browser)" (localStorage `craft.myfonts`, XCF text) and appear in the picker; "Keep in My fonts" stores the current one explicitly.

**Atari originals.** "Atari ROM charset" loads the 1K charset of the ATARIXL ROM; ROM images and `.fnt` (1024 bytes) open via Open font. The *Atari charset view* shows the 8x8 glyphs in screen-code (ROM / .fnt) or ATASCII order with an inverse-video half; click a cell to edit that glyph. `Export .fnt` writes 1024 bytes (screen-code order) from the 8x8 size of the family.

**ACWriter / Craft fonts** (first picker group): craft4 (Standard/PAGE), craft5, craft6, craft8, craft10, craft12 (master) and zfont (zoom). Opening one loads the family with sizes 4/5/6/8/10/12 (zfont is single); craft4 shows its super/sub variants. "Save to ACWriter source" POSTs to `node scripts/fontedit-server.cjs [port]` (serves `web/` and the write-back API, `/__acwface`): craft8/10/12 are written in place (`font/craft8.fnt`, `font/craft10.acf`, `font/craft12.acf`); craft4/5/6/zfont go to `font/overrides/<id>.acf`. `font/build/*.inc` and `web/js/fontedit/acw-faces.js` are regenerated (`node scripts/acw-faces.cjs`). Without the server the file is downloaded instead. "Reset to built face" removes the override. Registry: `tools/acwfaces.cjs`.

**Integration still needed in `tools/acwriter/*` (not touched):** in `mkcraftfonts.cjs` wrap each built face for adv 4/5/6 with `require('../acwfaces.cjs').override('craft' + adv, f)` before serialize/toInc; in `mkzoomfont.cjs` use `acwfaces.zfontInc(acwfaces.override('zfont', face))`. `mkpgfont.cjs` follows via craft4.inc. Or copy the generated `font/build/*.inc`; with no overrides they are byte-identical to `tools/acwriter/*.inc`.

Tests: `node scripts/fontedit-ui-test.cjs` (real Chrome clicks, screenshots `out/fe-ui-*.png`).

## Atari graphics characters, sizes 14-26 (`tools/atarigfx.cjs`)

Every Craft face (4, 5, 6, 8, 10, 12 and the large 14, 16, 18, 20, 22, 24, 26) holds the Atari graphics, **drawn procedurally** (box lines, suits, blocks, triangles and arrows are plain shapes generated from the cell geometry; no ROM data is read, stored or committed). The Atari ROM charset is used only as a visual reference and for the existing "Atari ROM" font entry.

| Slot | Unicode | Slot | Unicode | Slot | Unicode | Slot | Unicode |
|---|---|---|---|---|---|---|---|
| 0 ♥ | U+2665 | 8 ◢ | U+25E2 | 16 ♣ | U+2663 | 24 ┴ | U+2534 |
| 1 ├ | U+251C | 9 ▗ | U+2597 | 17 ┌ | U+250C | 25 ▌ | U+258C |
| 2 ▕ | U+2595 | 10 ◣ | U+25E3 | 18 ─ | U+2500 | 26 └ | U+2514 |
| 3 ┘ | U+2518 | 11 ▝ | U+259D | 19 ┼ | U+253C | 27 ⎋ | U+238B |
| 4 ┤ | U+2524 | 12 ▘ | U+2598 | 20 ● | U+25CF | 28 ↑ | U+2191 |
| 5 ┐ | U+2510 | 13 ▔ | U+2594 | 21 ▄ | U+2584 | 29 ↓ | U+2193 |
| 6 ╱ | U+2571 | 14 ▂ | U+2582 | 22 ▎ | U+258E | 30 ← | U+2190 |
| 7 ╲ | U+2572 | 15 ▖ | U+2596 | 23 ┬ | U+252C | 31 → | U+2192 |

Slots 0-31 are the ATASCII / internal-set graphics (code = slot). Five more symbols have no ACWriter code and live in slots 128-132: ♦ U+2666, ♠ U+2660, ↰ U+21B0, ◀ U+25C0, ▶ U+25B6. The printable ASCII specials stay where they are (96 backtick, 123 `{`, 125 `}`, 126 `~`, 127 DEL), so a face now spans slots 0-132 (`first` 0, `count` 133); the map is identity for codes 0-31, and `map[128..132]` points at the extra slots.

* **Cells.** Graphics are stored over the whole advance (glyph columns plus the gap), so `CF.colsOf(f, slot)` (not `gw`) is the width to draw or edit. Faces with an advance up to 8 use the 8-row Atari cell (rows `head..head+7`), larger faces the full cell. Every box and line piece reaches the cell edges, so lines join seamlessly cell to cell and row to row.
* **Inverse video.** ATASCII 128-255 is not stored: it is the full-cell complement of the normal glyph, computed at draw time (`AG.inverse`, `CF.cellMask`; ACWriter style bit 8 does `eor #$1F`).
* **Derivation.** Sizes below the 12x12 master use `derive()` for text, the graphics come from the procedure at the target cell size (hand-fixed so lines connect). Sizes 14-26 are derived up from the master scale-aware (`upGlyph`), graphics generated at that size; check them with `node scripts/craft-gfx-sheet.cjs` (writes `out/shots/fonts/craft-gfx-sheet.png`).
* **Build.** `scripts/mkcraftfaces.cjs` writes `font/craft*.acf` (4-12 via the ACWriter set, 14-26 directly), `tools/acwriter/mkcraftfonts.cjs` the `.inc` files, `mkpgfont.cjs` the PAGE font; `node scripts/build-all.cjs` regenerates all of them and `--check` verifies them.
* **TTF and other conversions.** `fontpipe.down()` installs the Craft graphics into every size of a converted font (a TTF has no Atari graphics), so a TTF-derived family keeps slots 0-31 and 128-132 from the Craft base. Pass `{ graphics: false }` to turn this off. XCF, BDF, TTF (our own export) and ACF round trips keep the slots.
* **fontedit.** The slot grid shows slots 0-255 (graphics at 0-31 and 128-132); the editor grid, drawing, flood fill, mirror and preview use the slot's own column count (`NC()`), so a graphics glyph can be edited over its full advance. The size list contains 14-26 for a Craft family.

### Which sizes the Atari app can load

ACWriter (6502) builds in only the 4, 5, 6 faces (and the 8x8 `.FNT` / zfont for 2x zoom); 10 and 12 are xCWriter / print / web faces. **14-26 are not in the ACWriter build** (a 26 px face is 4 bytes x 26 rows x 133 glyphs = 13.8 KB, more than its RAM allows); they exist as `font/craft14.acf` ... `craft26.acf` for xCWriter, print and the web. The ACWriter memory budget is unchanged: the glyphs for codes 128-159 are the existing 1 KB SYM page (`tools/acwriter/sym.inc`, rows 5 bits wide, bit 4 leftmost), and `drawchar` (`word/text.inc`, label `dc6`) skips the 1-bit left shift for glyphs read from the SYM page so they use all five columns (the gap column too, which is what makes the bars touch).

Limits: in ACWriter's 2x zoom and PAGE views only codes 32-127 are drawn (zfont / craftpg), so graphics show in the normal 1x view and print, not in zoom. The five extra symbols (slots 128-132) have no ACWriter code.

### Mapping: CRFT, text, ATASCII, docx

| Format | Graphics |
|---|---|
| ACWriter / CRFT document | graphic n (0-31) is byte 128+n; extra symbols map to `?` |
| xCWriter document (Unicode) | the Unicode characters of the table above; the **Symbols...** button (next to the mode buttons) opens a picker that inserts them |
| text, Markdown, RTF, HTML, docx | real Unicode (UTF-8 for text and md; docx/html/rtf as Unicode text); `craftexport` option `{ graphics: 'pua' }` keeps U+E080..U+E09F instead |
| ATASCII export | the slot number (0-31) as the ATASCII byte |
| import (text / docx / html ...) | the Unicode characters above become byte 128+n; U+E080..U+E09F also; any other character outside Latin-1 becomes `?` |

Tests: `node scripts/craft-gfx-test.cjs` (set, all sizes, ACF2 row bytes, XCF/BDF/TTF round trips, TTF keeping the graphics, mapping), `node scripts/acwriter-gfx-diff.cjs` (pixel diff of a line of graphics: ACWriter in the emulator vs the xCWriter Atari view, 0 mismatching pixels).