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
  tag 4 section:     p u16, then the section font name ('ROM' = standard face, empty = the document default); one record per section start,
                     the p=0 record carries the first section's font. Paragraph 0 always starts a section.
  tag 5 style:       role u8 (1 title, 2 h1, 3 h2, 4 h3, 5 cap), flags u8 (1 bold, 2 italic), align u8 (0 l, 1 c, 2 r, 3 j, 255 none),
                     size u8 (cell size 4/5/6/8/10/12, 0 = from the face), space u8 (blank lines before), then the face name (empty = follow the section)
  tag 6 paragraph:   p u16, role u8 (0 body), size u8 (0 = from the style), then the explicit paragraph font ('ROM' = standard, empty = none)
  tag 7 default font: the document default font name
```

Readers skip unknown tags and stop at a damaged record; a trailer that fails to parse gives the default page. Files without the flag have no page setup (`page: null` from `craftdoc.parse`; editors then use their defaults: the 64-column Atari screen layout).

**One font per line block.** A font change is a paragraph property: tag 3 names the paragraph index where a face starts and it stays in force until the next record, so a line never mixes fonts. xCWriter keeps `font` per paragraph (picker in the Page view bar); importing RTF/docx with several fonts in one paragraph picks the dominant font by character count and shows a warning. `ROM` returns to the standard face (an empty name would mean "keep the previous face" for ACWriter). Names are 8.3-safe ids (`[A-Z0-9_-]`, at most 8 characters) because ACWriter looks the file up as `NAME.FNT`. ACWriter limits: 4 loaded fonts and 8 changes.

**Sections and styles (tags 4-7).** Fonts are assigned at four levels. Precedence, lowest to highest: *document default* (tag 7) < *section font* (tag 4) < *style of the paragraph's role* (tag 5: face, size, bold/italic/align/space for Title, Heading 1-3, Caption; Body is the unstyled role) < *explicit paragraph font and size* (tag 6). A line has one face and one cell size, so nothing changes mid-line. The resolved face of every paragraph is always written as tags 2/3, so ACWriter and every older reader show the same faces without knowing about tags 4-7 (readers skip unknown tags). When tags 4-7 exist a reader rebuilds the structure from them and ignores tags 2/3; when only tags 2/3 exist (old files, ACWriter saves) each paragraph gets the face as an explicit paragraph font. Sizes exist only for the Craft family (craft4/5/6/8/10/12, ACF faces plus craft8 `.FNT`); other faces keep their own single size, so a size choice leaves them unchanged. ACWriter re-writes only tags 1-3 on Save, so structure edited in xCWriter (sections, roles, sizes, style table) is flattened to explicit faces when the file passes through ACWriter; faces stay identical. Test: `scripts/xcwriter-sections-test.cjs`, `scripts/acwriter-sections.cjs`, `scripts/test-craftsections.cjs`.

Print mapping (not built; print is a separate output process, not the editing screen): dots = inches x dpi (Letter at 300 dpi 2550x3300, at 150 dpi 1275x1650); dots per column = dpi / cpi (30 at 10 cpi, 25 at 12 cpi, about 17.6 at 17 cpi at 300 dpi); dots per line = dpi / 6. See [FONT.md](FONT.md).

ACWriter keeps the trailer on Save (it writes paper, pitch, margins, tabs and the font records again); the old "drops the trailer" limitation no longer applies.
