# Atari-native companions

**Rule:** every web or Windows tool has an Atari-native companion that reads and writes the **same file format** and speaks the **same transport** (see [ARCH-TRANSPORT](ARCH-TRANSPORT.md)). A web FujiNet Explorer exists, so files can also move to and from a real Atari via FujiNet. A tool is not "done" until its companion has at least a documented plan and the format spec is shared.

Naming: web/Windows `xC<Name>`, Atari `AC<Name>` (existing ACWriter/xCWriter). "Same format" means the Atari app opens what the web app saves, byte for byte, and vice versa; format specs live in `docs/`.

| Web / Windows tool | Atari-native companion | Shared format | Transport use | Status |
|---|---|---|---|---|
| xCWriter (word processor) | ACWriter | CWD ([CRAFT-FORMAT](CRAFT-FORMAT.md)) | file via fs/disk ops | both exist |
| Font editor | ACWriter font loader, other apps | ACF ([FONT](FONT.md)) | file | exists |
| FujiNet Explorer (web) | Atari `N:` browser / CONFIG-style picker | Container catalog JSON | `net.*`, `fs.*` | web exists; Atari planned |
| Disk/Archive tool | Atari disk utility (DOS-level copy) | ATR + Container folder form | `disk.*` | Container exists |
| xCCalc (spreadsheet) | ACCalc | Craft sheet (`.csh`, planned) | file; `sql.*` import | planned |
| xCBase (database) | ACBase | Craft table in Container (schema type map) | `sql.*` via gateway ([ARCH-SQL-GATEWAY](ARCH-SQL-GATEWAY.md)) | planned |
| Slides | ACSlides | Craft slides (text + page layout) | file | planned |
| Paint | ACPaint | Atari picture formats + Container | file | planned |
| Terminal | ACTerm | line protocol over serial / `N:` | serial P:/R:, net | planned |
| Calendar | ACCal | Craft calendar (records, dates) | file / sql | planned |
| Document manager shell | ACShell | Container catalog | `fs.*`, `container.*` | planned |

## Constraints for the Atari side

- 8-bit buffers: transport `maxChunk` 64-256, stop-and-wait, CRC-16.
- Text in ATASCII on the Atari, converted at the Container boundary; losses reported.
- Formats avoid features the Atari app cannot parse (fixed headers, little-endian, explicit lengths).

## Checklist for a new tool

1. Format spec in `docs/` with a round-trip test fixture. 2. Import/export adapter in the Container. 3. Transport ops it needs. 4. Companion plan (memory budget, UI) with the same file. 5. Row added to this table.
