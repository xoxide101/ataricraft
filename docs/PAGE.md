# Craft page model

Shared by xCWriter (matching/page view), `tools/craftimport.cjs`, `tools/craftdoc.cjs` and, from stage 4, ACWriter. Reference code: `tools/craftpage.cjs` (re-exported as `XCW.Page`), tests `scripts/test-craftpage.cjs`.

## Model

| Field | Values | Default |
|---|---|---|
| `paper` | `letter` 8.5 x 11 in, `a4` 210 x 297 mm, `legal` 8.5 x 14 in | letter |
| `pitch` | characters per inch: 10, 12, 17 (compressed) | 10 |
| `left`, `right` | margins in columns | `round(0.3 * pitch)`, `round(0.2 * pitch)` |
| `top`, `bottom` | margins in lines (6 lpi) | 6, 6 |
| `tabs` | list of `{ pos, kind }`, `pos` = absolute column from the paper's left edge, `kind` = `l`, `c`, `r` | none |
| `font` | font file name (stage 5), empty = built-in | empty |

Derived (`Page.info(page)`):

- `paperCols = floor(paper width in inches * pitch)`: Letter 85 / 102 / 144, A4 82 / 99 / 140 at 10 / 12 / 17 cpi.
- `usable = paperCols - left - right`: Letter at 10 cpi with the default margins is **80 columns = 8.0 in**.
- `paperLines = floor(height * 6)` (66 Letter, 70 A4, 84 Legal); `textLines = paperLines - top - bottom`.
- `centre = paperCols / 2`, the page centre mark drawn on the ruler. Tab stops are absolute, so a centre stop at the page centre centres text on the paper, not on the margins.
- Margins are clamped so at least 8 columns remain usable; at most 24 tab stops; positions are unique.

## Wrapping

`craftimport.layout(paras, cols)` takes either a number (the old 64 screen columns, unchanged) or a page setup, in which case it wraps at `Page.usableCols(page)`. `convert(buf, name, { page })` and `node tools/craftimport.cjs IN OUT --paper a4 --pitch 12` do the same. In xCWriter, `XCW.atariLines`, `craftPayload`, `fit` and `toCwd` accept the page as their last argument.

Tab characters are expanded to spaces before wrapping (Craft text has no tab code) by `Page.expandTabs`: the text after a left stop starts at the stop, after a centre stop the segment up to the next tab is centred on it, after a right stop it ends on it. Past the last stop a tab goes to the next multiple of 8 columns from the left margin. Limit: this is computed for the first line of a paragraph; stops are not re-applied to wrapped continuation lines.

## Storage in a CRFT file (backward compatible)

Version stays 1. Header `flags` bit 1 (`0x02`) says "page trailer present". The trailer sits **after** the payload, where the format already says readers ignore extra bytes, so old readers (including the 6502 ACWriter, which reads exactly `length` payload bytes and checks the checksum over them) load the text and ignore the setup. The header `cols` byte holds the usable columns of the page (80), `rows` is unchanged.

```
'CPG1'                         trailer magic
records, until end of file:    [tag u8][len u8][data]
  tag 1 page setup:  paper u8 (0 letter, 1 a4, 2 legal), pitch u8 (cpi), left u8, right u8, top u8, bottom u8,
                     ntabs u8, ntabs x ( pos u8, kind u8: 0 left, 1 centre, 2 right )
  tag 2 font name:   ASCII bytes, the font of paragraph 0 ('ROM' = the standard face)
  tag 3 font change: p u16 (paragraph index, lo/hi), then the name; one record per change after paragraph 0
```

Readers skip unknown tags and stop at a damaged record; a trailer that fails to parse gives the default page. Files without the flag have no page setup (`page: null` from `craftdoc.parse`; editors then use their defaults: the 64-column Atari screen layout).

**One font per line block.** A font change is a paragraph property: tag 3 names the paragraph index where a face starts and it stays in force until the next record, so a line never mixes fonts. xCWriter keeps `font` per paragraph (picker in the Page view bar); importing RTF/docx with several fonts in one paragraph picks the dominant font by character count and shows a warning. `ROM` returns to the standard face (an empty name would mean "keep the previous face" for ACWriter). Names are 8.3-safe ids (`[A-Z0-9_-]`, at most 8 characters) because ACWriter looks the file up as `NAME.FNT`. ACWriter limits: 4 loaded fonts and 8 changes.

Print mapping (not built; print is a separate output process, not the editing screen): dots = inches x dpi (Letter at 300 dpi 2550x3300, at 150 dpi 1275x1650); dots per column = dpi / cpi (30 at 10 cpi, 25 at 12 cpi, about 17.6 at 17 cpi at 300 dpi); dots per line = dpi / 6. See [FONT.md](FONT.md).

ACWriter keeps the trailer on Save (it writes paper, pitch, margins, tabs and the font records again); the old "drops the trailer" limitation no longer applies.
