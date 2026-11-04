# The WOW series: ACWord, ACSpread, ACDBase

Status: **draft spec**. Nothing in this document is built yet. It records the decisions so far so the first piece (ACWord) and the shared shell can be built against them.

## Goal

Show what an Atari 8-bit can do if you go outside the box: real WYSIWYG documents, spreadsheets and databases on a stock 64K machine, with a web twin of each that gives the same result. The intent is surprise: "that runs on an Atari?"

| App | What it is |
|---|---|
| **ACWord** | WYSIWYG page editor: text, fonts, styles, borders, art. Features of Atari Writer, The Last Word, MS Write and Word. |
| **ACSpread** | Cell grid, formulas, formats. |
| **ACDBase** | Records, fields, sort, find, reports. |

Build order: shared shell, then ACWord, then ACSpread and ACDBase on the same shell.

## Hard rules

1. **Runs on a stock 64K XL/XE and in the emulator.** Banked RAM (130XE, 320K, 576K, 1088K) may add extras (more fonts, more art), but the core must not depend on it.
2. **1 or 2 pages per document.** Most documents are small; this keeps the memory budget honest.
3. **Parity.** The Atari and the web version both edit, render and print. Neither is a superset. A document that opens in the web editor must fit and open on the Atari.
4. **The Atari renderer is the reference.** The web version runs the same layout and drawing logic with the same fonts. Test: render the same document on both and compare the bitmaps pixel for pixel (the emulator makes this easy).
5. **Not a GUI, not a TUI.** A nano-style editor: the document is always in front and typing always goes into it. Commands come from a changeable ribbon and keys, never a pointer-driven menu.
6. **WYSIWYG** on screen, redrawn in chunks as you move down the page.

## Screen

- ANTIC mode F (BASIC graphics 8): 320x192, 1 bit per pixel, 40 bytes per line, about 7.7K. A custom display list may extend this toward 320x240 with overscan.
- White page, black text; colour registers are set explicitly so the result does not depend on the monitor.
- The screen is a window onto the page. The document is laid out in **page units** (inches, 10 or 12 cpi), so line breaks match paper regardless of the view. The working view is **fit-to-margins**: the text area between the margins is scaled to fill the full 320 pixels using the largest whole-pixel character cell that fits, with fractional cell positions so breaks match the paper (1" margins on Letter: about 5 px cells, 64 columns; 0.5" margins: 4 px cells, 80 columns). The **full page is shown only in a read-only preview**.
- Layout of the 24 character rows: ribbon (top), 21 text lines, status row, command bar (bottom).
- Redraw is by dirty lines and bands: typing draws only the new glyph. Heavy work (reflow, line table, lines below, pagination, spell check, counts) is deferred to the sentence end (period, space, space), Return, cursor moves and idle pauses.

## Document model

The page is **never stored as a bitmap**: 8.5x11 at 72 dpi is about 60K. A document is a list of **objects**:

| Object | Content |
|---|---|
| Text box | Rectangle, text stream with style runs, alignment, margins |
| Line / rectangle / border | A few bytes each, drawn into the bitmap |
| Art | Compact 1-bit bitmap (converted from clip art by the web tools) |

Styles: font, size, bold, italic, underline, underscore, superscript, subscript. Alignment: left, centre, right, justify; top, middle, bottom. Page sizes: 8.5x11, 8.5x14, 11x17. Margins and borders per page.

Only the objects that are visible are laid out and drawn.

## Memory budget (stock 64K, rough, to be measured)

| Item | Size |
|---|---|
| Screen (mode F) | ~8K |
| Display list, system | ~1K |
| Editor code incl. shell | 16-20K |
| Font data, two faces | 4-6K |
| Document (text, boxes, styles) | 10-15K |
| Art | the remainder |

Two pages of mostly text is about 8K. Art is the pressure: keep it compressed and keep few pieces resident.

## The shared shell (`ribbon.inc`)

A MADS include linked into each app (like `tools/tui/tui.inc`), so an app pays only for the routines it uses. It provides:

- **Command table.** Each app registers commands (name, key, handler, ribbon label). The ribbon, help screen and key handling all read from it.
- **Ribbon.** One row at the top showing the mode tabs and the basic tools of the current mode (Tab cycles modes); nano-style, not a GUI or TUI.
- **Command bar.** A bottom prompt (Ctrl-X) taking typed commands with Tab completion; ribbon tools and typed commands run through the same command table.
- **Status line.** Position, mode, selection, file name, in the same place in every app.
- **Pick list and prompt.** One routine to choose from a list and one to type a value, used by font pickers, cell formats and field types alike.
- **File open/save.** D1: to D8: and N: (FujiNet).
- **Clipboard and undo.** A small shared clipboard; an undo stack sized per app.
- **Key map.** Save, find, cut, copy, paste and the like are the same keys in every app.

The same command names and keys are used by the web ribbon.

## File format family

One small header shared by all three apps, then app-specific data:

- Magic and app id, format version, flags.
- Page size and margins (ACWord), grid size (ACSpread), field table (ACDBase).
- Object list / cell data / records.
- Fonts and art are referenced by id and stored in shared, compact 1-bit formats.

The 6502 code and the JavaScript each have a reader and writer. They are tested against each other with the same sample files, as the existing format tests do. The exact byte layout is the first thing to write once the shell commands are settled.

## Web companion

Each app has a web twin that:

- edits the same files with the same ribbon and the same renderer;
- converts clip art and fonts into the Atari formats (the existing FONT editor, font library and image converter are the starting point);
- writes a file straight into the running emulator (disk mount or memory injection through the Inspector) and reads files back out;
- enforces the Atari limits, so a document that opens in the web editor also opens on the Atari;
- prints through the same objects and print routine as the Atari.

The Inspector and `tools/ctl.cjs` already provide the injection path. For real hardware the same files go to SD, a FujiNet host or N: through the relay.

## Printing

Both sides render the document objects to printer raster data with one routine. On hardware this goes out through FujiNet P: or a real printer. The existing P: printer path handles text today; raster data is new work.

## Proof of concept (first build)

Before committing the file formats, measure the thing that decides feasibility:

1. A hi-res page in mode F with a bitmap font, proportional text and bold/italic, drawn in chunks.
2. Scrolling through a two-page document with a timing readout (frames per redraw).
3. Typing into a line, measuring the redraw latency.

Pass criterion: typing a character updates the line within a few frames, and a page scroll redraws a band without a visible wait. If it does not pass, fixed-width faces become the default and proportional text becomes a mode.

### Measured so far (`tools/acword/`, emulator, 50 Hz frames)

| Build | Full redraw | Scroll 1 line | Type 1 char |
|---|---|---|---|
| `poc.asm` 6 px cells, 53 cols, ROM font | 56 | 9 | 10 |
| `poc80.asm` 4 px cells, 80 cols, AFM80 3x7 font | 41 | 7 | 4 |

Findings: typing cost was dominated by rescanning and shifting the whole document on every insert; keeping a document-end pointer and adjusting line pointers cut it from 9 to 6 frames, and a page-wise block move for the tail shift brought it to 4. A gap buffer is only needed if documents grow well beyond the PoC's ~1.7K. The remaining cost is the key read through CIO, the one-glyph draw and the status redraw. At 4 px cells bold merges letters into blobs; the 5 px cell (4 px glyph plus 1 px smear) is needed. `poc80.asm` also has the ribbon (Tab cycles Edit/Format/Insert/File) and the command bar (Ctrl-X, Tab completes, Enter runs); only the Edit commands act so far.

## Open questions

- Screen scale: 1:1 scrolling view of the text column versus a reduced page view, and how zoom switches.
- Font storage: separate faces for bold and italic, or generated from a base face.
- Style storage: inline control codes or a separate style layer.
- Printer raster output and resolution on a real printer (what a real printer driver needs).
- ACSpread formula engine size on a 64K machine.
- ACDBase record limits and sort method in 64K.
- Whether any further apps join the series.

## Existing pieces to reuse

| Piece | Use |
|---|---|
| `tools/tui/tui.inc` | Pattern for a linkable shared include; mouse and pointer code is not needed |
| `tools/cmd/nano.asm` | A full text editor already on the Atari; the editing model to read first |
| `web/js/fontlib.js`, FONT editor | Font import and conversion |
| `web/js/imgconv.js` | Image to Atari bitmap conversion, basis for the art converter |
| Inspector, `tools/ctl.cjs`, the relay | Moving files into and out of the emulator |
| `web/js/printer.js`, P: handler | Printing path |
