# Craft document format (CRFT), version 1

One container for every Craft office app, so a file written on an Atari 8-bit can be read on a PC, a C64 or the web editions, and the other way round. ACWriter (word processor) is defined here. ACSpread and ACDBase reserve their type codes and use the same header.

Reference implementations: `tools/acwriter/word/file.inc` (6502 writer and reader, via CIO) and `tools/craftdoc.cjs` (JavaScript reader and validator). A real sample is `docs/samples/ACWRITER-DEMO.CWD`.

## Rules for every machine

- **Byte order:** all multi-byte numbers are little-endian, 16-bit unless stated.
- **Alignment:** none. The file is a plain byte stream; nothing is padded.
- **Size:** a document is at most 16,383 payload bytes in version 1 (it must fit a stock 64K Atari). Readers on bigger machines may accept more, up to 65,535, which is the 16-bit limit.
- **Unknown data:** readers ignore header bytes marked reserved and must not reject a file for them. Readers reject a different major `version` or a different magic.
- **Text encoding:** *Craft text*, below. It is not ATASCII, PETSCII, or UTF-8, so no machine owns it.

## File names

| App | Type byte | Extension | Meaning |
|---|---|---|---|
| ACWriter, xCWriter | `W` (0x57) | `.XCW` (old name `.CWD`, still read) | Craft Word document |
| ACSpread | `S` (0x53) | `.XCS` | Craft spreadsheet: name reserved, format not defined yet |
| ACDBase | `D` (0x44) | `.XCD` | Craft database: name reserved, format not defined yet |

The extension is a convention only. The type byte in the header decides. 8.3 names work on every DOS, C64 disk and modern OS. Decision: `xcw` for write, `xcs` for spreadsheet, `xcd` for database; everything else keeps its normal name (full list: [FILE-EXTENSIONS.md](FILE-EXTENSIONS.md)). `.XCW` fits the Atari 8.3 limit. xCWriter, `craftimport` and EBookCraft write `.xcw`; every reader accepts `.cwd` too. ACWriter itself (6502) still adds `.CWD` when you type a name without a dot (changing the assembly is deferred; type `H:NAME.XCW` to use the new name), and `D1:` when you type no device (`H:` and any other CIO device work too).

## Header (16 bytes, offset 0)

| Offset | Size | Field | Value |
|---|---|---|---|
| 0 | 4 | magic | ASCII `CRFT` |
| 4 | 1 | version | `1` |
| 5 | 1 | type | `W`, `S` or `D` |
| 6 | 1 | flags | `0`. Bit 1 (`0x02`): a page-setup trailer follows the payload (see [PAGE.md](PAGE.md)). Reserved: bit 0 will mean compressed payload |
| 7 | 1 | charset | `0` = Craft text |
| 8 | 2 | length | payload bytes that follow the header |
| 10 | 2 | aux | Word: number of lines (paragraph lines, soft and hard). Others: app-defined |
| 12 | 1 | cols | Word: page width in text columns (64; the usable page columns, e.g. 80, when the page trailer is present) |
| 13 | 1 | rows | Word: text lines per page (20) |
| 14 | 2 | checksum | sum of all payload bytes, modulo 65536 |

The payload starts at offset 16 and runs for `length` bytes. A file shorter than `16 + length` is truncated and must be rejected. Extra bytes after the payload are ignored.

The checksum is deliberately weak and cheap so a 1 MHz 6502 can compute it while saving. It catches truncation and sector damage, not malice. A mismatch means "damaged"; a reader may still offer to open the text.

Example (the start of `ACWRITER-DEMO.CWD`, the sample keeps its old name):

```
43 52 46 54  01  57  00  00   D2 05  2D 00  40  14  32 F2
 C  R  F  T  v1  'W' fl  cs   1490   45     64  20  0xF232
```

## Craft text

One byte per character.

| Codes | Meaning |
|---|---|
| 0 | not used in a file (the Atari editor appends one as an end mark in memory; it is never stored) |
| 1-31 | markers and style toggles (see Word payload) |
| 32-126 | ASCII printable |
| 127 | reserved |
| 128-159 | Atari graphics characters: the Atari graphics block (hearts, line-drawing pieces and similar). Other machines map them to the nearest symbol or to U+FFFD |
| 160 | no-break space |
| 161-255 | Latin-1 (ISO 8859-1), except 173 |
| 173 | no-break hyphen (Latin-1 has a soft hyphen here, Craft text does not) |

To convert to Unicode: 32-126 and 161-255 are the same code points (173 becomes U+2011), 160 becomes U+00A0, 128-159 follow the Atari table in `tools/acwriter/mksym.cjs`. To convert from Unicode, anything outside Latin-1 has no code in version 1.

## ACWriter payload

The payload is a stream of **lines** in document order. There is no table of lines; the end of each line is a byte in the stream.

| Byte | Meaning |
|---|---|
| 13 | hard line end: ends a paragraph |
| 14 | soft line end: the editor wrapped here, the paragraph continues. A reader may treat it as a space |

There is no terminating byte. The Atari editor adds a 0 in memory after the last byte it loads.

### Inline codes (anywhere in a line)

Toggles: the first occurrence turns the style on, the next turns it off. Zero width. State carries across soft line ends and resets at a hard line end.

| Code | Style |
|---|---|
| 1 | bold |
| 2 | italic |
| 3 | underline |
| 4 | inverse |
| 11 | superscript (one size, raised) |
| 12 | subscript (one size, lowered) |

### Paragraph markers

Invisible bytes at the start of a paragraph's first line. They apply to the whole paragraph. Order is free; a reader reads markers until the first byte that is 32 or above, or a different code.

| Code | Meaning |
|---|---|
| 15 | centre |
| 16 | right align |
| 17 | justify (all lines but the last) |
| 18 | indent |
| 19 / 20 | bullet, drawn as `*` (19) or `-` (20) on the first line; the text is indented two columns |
| 22 / 23 | light / heavy font weight |
| 24 | spacer: the paragraph is a blank hatched frame, not text |
| 25-30 | width step, 0.5x to 3x |
| 5-10 | height step, 4 to 24 pixel lines |

Codes 21 and 31 are free. Unknown codes below 32 must be skipped, not shown, so newer files open in older readers.

Meaning of the pixel sizes is ACWriter's screen model (5 px wide characters, a 320x192 page). Other machines should treat a width step as "this paragraph is larger" and map it to their nearest size.

## Reading and writing checklist

Writer: build the payload, compute the checksum, write the 16-byte header then the payload. Set `aux` to the line count, `cols`/`rows` to the page model (64 x 20).

Reader: check magic, version, type, `length`; read `length` bytes; verify the checksum; then interpret the stream. Never assume the end of file equals the end of the payload.

JavaScript reference: `node tools/craftdoc.cjs FILE.XCW` prints the plain text, `--json` prints header, paragraphs, markers and style runs.

## Other machines

- **Atari 8-bit:** DOS 2.x, MyDOS, SpartaDOS and BW-DOS all store it as an ordinary file. Block `put` of the 16-byte header, then the payload. No device assumptions.
- **PC and web:** open with any hex viewer or `craftdoc.cjs`; the web editions will read and write the same bytes. Use `.xcw` and treat the file as binary (no newline conversion).
- **C64 (planned):** a PRG/SEQ file with the same bytes. Convert Craft text to PETSCII on import and back on export; keep the stream layout unchanged.
- **Line endings:** Craft text has its own (13/14). Never rewrite them to CR LF in the stored file; convert on export only.

## Known limits of version 1

- No object list yet (only text paragraphs). Art, lines and boxes will arrive as a new section after the text stream, flagged in `flags`.
- Page setup (paper, pitch, margins, tab stops, font name) is an optional trailer after the payload, flagged by `flags` bit 1; see [PAGE.md](PAGE.md). Trailer tags: 1 page setup, 2/3 resolved faces (read by ACWriter), 4 section starts and fonts, 5 style table (Title, Heading 1-3, Caption), 6 per-paragraph role/size/font, 7 document default font. Readers skip unknown tags, so tags 4-7 are invisible to older readers and to ACWriter. Without it the editor uses its defaults.
- The Atari build keeps its low-memory tables at 0x0500-0x14FF, so a disk DOS that lives there will clash. The emulator's `H:` device and bare-metal CIO work; relocating the tables for stock DOS is planned.
- The checksum is a plain sum. Version 2 may move to CRC-16.

## Versioning

`version` is the major format version. Additions that older readers can safely ignore (new markers, reserved header bytes) do not change it. Anything else bumps it, and this document keeps every version.

## Type S: spreadsheet (.xcs)

A CRFT file with type byte `S` (0x53). Header: `aux` = cell count, `cols` = widest column, `rows` = last row (both capped at 255), `length` = payload bytes including the trailing CRC-16/CCITT-FALSE. The payload (mode, string pool, names, charts, sheets, cell records) is defined in `docs/XCCALC.md`. Reader: `tools/xccalc/xcsformat.cjs`; container adapter `xcs`.
