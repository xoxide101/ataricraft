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

## 6502 data (`.inc`)

`toInc(font, prefix)` writes constants (`prefix_ADV`, `_GW`, `_ROWS`, `_HEAD`, `_XTOP`, `_BASE`, `_DESC`, `_SUPUP`, `_SUBDN`, `_FIRST`, `_COUNT`), then one plane per cell row `prefix_0 .. prefix_11` (`count` bytes each, MSB-left) and `prefix_map` (256 bytes, slot minus `first`, 255 = not stored). `tools/acwriter/mkcraftfonts.cjs` emits `craft4.inc`, `craft5.inc`, `craft6.inc` (prefix `c4`, `c5`, `c6`) and `web/js/fontedit/builtin-fonts.js`. Per-code variants are not emitted: the 6502 uses the automatic shift.

## Font editor

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

## Font library (fontedit)

`node scripts/fontlist.cjs` writes `web/library/fonts/local/manifest.json` for the font editor's *Font library* list: **Shipped** (`font/` plus `web/library/fonts`), **Atari ROM** (the OS charset, extracted from `software_n_roms/ATARIXL.ROM` at $2000; generated, never committed) and **Personal** (`font_personal/`, gitignored with `web/library/fonts/local/`). `.fnt` files (1 KB/2 KB Atari charsets) import as 8 px Craft fonts through `Font.fromFnt`; TTF/OTF go through the rasteriser (up to 8 px; the 12x12 master with 2-byte rows is not implemented yet). Test: `scripts/fontlist-test.cjs`.

