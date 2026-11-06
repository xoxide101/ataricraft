# Craft Container (v1)

One object that holds a thing imported from anywhere: the **original bytes**, a **manifest**, **derived forms**, an optional **schema**, and a **loss report**. Code: `tools/craftcore/container.cjs`, `adapters.cjs`, `encodings.cjs`. Browser use: `AC.CraftCore.Container` (scripts load in the order util, encodings, container, adapters).

## Pipeline

```
existing data / database / file
   -> transport (fs / serial / fujinet / http / sql gateway)
   -> import adapter  (detect -> parse)
   -> CRAFT CONTAINER  [original | manifest | derived | schema | losses]
   -> export adapter  (rebuild from derived, then diff against original)
   -> transport
   -> target: Atari disk (ATR), SQL/MySQL via gateway, Windows file, CSV / XLSX / DBF / SQLite
```

## Manifest (JSON, canonical key order)

| Key | Meaning |
|---|---|
| `craft` | `{container: 1, created: ISO, tool: {name, version}}` |
| `type` / `name` | adapter type (`atr`, `cwd`, `acf`, `raw`, ...) and display name |
| `source` | `{kind, uri, transport, retrieved, size, sha256}` where it came from |
| `original` | blob id of the untouched bytes (always `original`) |
| `blobs` | `id -> {size, sha256, crc32, role: original|derived, kind, mediaType, lossy, from, name?}` |
| `derived` | ids of derived blobs (catalog.json, text.txt, font.json ...) |
| `schema` | optional table/record description (below) |
| `losses` | loss report (below) |
| `provenance` | list of `{at, step, tool, detail}` (import, convert, export) |

## Schema type map

Fields `{name, type, encoding?, length?, nullable?}`; `type` is one of `int, uint, float, decimal, bool, string, bytes, date, time, datetime, blob, json`. Text encodings: `craft` (Craft text), `atascii`, `petscii`, `ascii`, `latin1`, `utf8`. Mappings are **partial on purpose**: unmapped codes are reported as lost, never guessed. Target type maps (e.g. `decimal` -> MySQL `DECIMAL(p,s)`, DBF `N`, CSV text) live in the export adapter and are listed in the loss report when narrowing happens.

## Loss report

Entries `{code, severity: info|warn|lossy, where, count, detail, samples?}`. Examples: CWD -> text: `style-codes-dropped`, `paragraph-markers-dropped`, `atari-graphics-chars`, `checksum-mismatch`, `trailer-kept-opaque`; text -> CWD: unmappable characters. An empty list means "nothing lost" and is asserted by tests for fonts. Whatever is lossy is still recoverable because the original is kept.

## Round-trip diff discipline

`roundTrip(adapter, bytes)` = import -> container -> serialize -> parse -> verify -> export -> compare to the input byte for byte; any difference is reported with the first differing offset (`firstDiff`). Rule: an adapter may ship only when it round-trips its samples **identically**, or the difference is itself listed in `losses`. Exports rebuild from derived blobs (not the original), so a passing round trip proves the derived form is complete.

## Archive lane (folder form)

`toFiles()/fromFiles()`: `manifest.json`, `original/<name>`, `derived/<id>`. An unpacked disk becomes a Windows folder with a catalog (names, sizes, sha256 per file) and can be **rebuilt** to the identical image. The ATR adapter's DOS 2 catalog is heuristic (sectors 361-368, follows chains); disks it cannot read keep only the original and a note.

## Single-file form

```
"CCNT" | ver u8 | flags u8 | reserved u16 | manifestLen u32 | blobLen u32 | manifest JSON | blobs (sorted by id) | sha256 of everything before (32)
```
Little-endian, deterministic (same input and `created` => identical bytes). Suggested extension `.ccn` (*open question*). Any damage fails the trailing sha256 and `verify()` also checks each blob's size and sha256.

## Adapters now

ATR (header facts, DOS 2 catalog, per-file sha256), CWD (header/payload/trailer + lossy text), ACF fonts (JSON via `tools/craftfont.cjs`), raw (fallback). Next: CSV/DBF/SQLite/XLSX (Convert), SQL gateway rows -> container tables ([ARCH-SQL-GATEWAY](ARCH-SQL-GATEWAY.md)), tape images (CAS/TAP).
