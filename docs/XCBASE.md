# xCBase: the Craft database

xCBase is the web database of the Craft family. Its Atari twin, ACBase, comes later (6502, not written yet). Both are meant to read and write the same file, `.xcd`. The engine is machine independent; the format is built so a 6502 can use it.

| Part | Where |
|---|---|
| Engine (tables, fields, indexes, query, forms, reports, merge) | `tools/dbcore.cjs` |
| `.xcd` binary and JSON twin | `tools/xcdformat.cjs` |
| DBF (dBase III), CSV, TSV import/export | `tools/xcdio.cjs` |
| SQLite import/export (Node only, `node:sqlite`) | `tools/xcdsqlite.cjs` |
| Container adapter (`database.json`) | `tools/craftcore/adapter-xcd.cjs` |
| SQL gateway (local relay) | `tools/sqlgate/` |
| Web app | `web/xcbase.html`, `web/js/xcbase/` |
| Browser bundle | `scripts/xcbase-sync-core.cjs` -> `web/js/xcbase/core/xcb-core.js` |
| Tests | `scripts/xcbase-core-test.cjs` (109), `xcbase-format-test.cjs` (232), `xcbase-sqlgate-test.cjs` (69), `xcbase-web-test.cjs` (43, Playwright) |

## Data model

A database holds up to 255 tables (the Atari assumption is 8). A table has up to 64 fields. Names are letters, digits and `_`, at most 10 characters, case-insensitive.

| Type | Holds | In `.xcd` |
|---|---|---|
| `text N` | 1..255 characters, Latin-1 | N bytes, zero padded |
| `int` | 32-bit integer | 4 bytes, little endian |
| `num` | decimal, 10 significant digits | 6 bytes Atari BCD (same as xCCalc) |
| `date` | ISO `YYYY-MM-DD` | 4 bytes: year u16, month, day |
| `bool` | yes/no | 1 byte |
| `memo` | long text (up to 32000) | 2-byte number; text kept in a memo area |

Every field can be null (a bitmap at the start of each record). Records keep their insert order. Indexes are sorted permutations: up to 4 fields each, ascending or descending, optionally unique; text compares case-insensitively, null sorts first.

## Query language

`db.query(sql, params)` runs a SELECT subset in our own executor (never sent to a server):

`SELECT [DISTINCT] cols FROM t [JOIN u ON a = b] [WHERE ...] [GROUP BY ...] [HAVING ...] [ORDER BY ... [DESC]] [LIMIT n [OFFSET m]]`, aggregates `count sum avg min max`, `AND OR NOT`, `= <> < <= > >= LIKE IN BETWEEN IS NULL`, and `?` parameters. Strings are single-quoted. Anything else (writes, subqueries, comments) is rejected with a clear error. The result carries a `plan` text that says when an index was used.

The grid filter box is a lighter form: plain text (any field), `Field=value`, `<>`, `<`, `<=`, `>`, `>=`, `Field~part`.

## Forms and reports (JSON)

Stored in the database (`forms`, `reports`) and in the `.xcd` as a small JSON blob.

```json
{ "forms": [{ "table": "customers", "title": "Customer card", "fields": [{ "field": "name", "label": "Name" }] }],
  "reports": [{ "name": "bycity", "table": "customers", "title": "By city", "groupBy": "city", "orderBy": ["name"],
                "columns": [{ "field": "name", "label": "Name" }, { "field": "balance", "label": "Balance", "sum": true }] }] }
```

A form on the Atari is at most 64 columns by 22 rows (`dbcore.FORM_COLS`, `FORM_ROWS`). `dbcore.checkForm` and `checkReport` validate; reports render to HTML (`reportHTML`) or text (`reportText`, 64 columns, for ACBase and printing).

## The `.xcd` file

Standard Craft header (see [CRAFT-FORMAT](CRAFT-FORMAT.md)): `CRFT`, version 1, type `D` (0x44). Bytes 8-9 payload length, 10-11 total records, 12 max fields, 13 tables, 14-15 sum16 of the payload. Payload (little endian):

```
u8 tables, u8 nameLen, name
per table:  u8 nameLen, name, u8 fields, u8 indexes, u16 records, u16 recordSize, u16 memoCount
            fields   10-byte name, u8 type, u8 size, u16 offset in record          (14 bytes each)
            indexes  10-byte name, u8 unique, u8 count, 4 x (column | 0x80 if desc) (16 bytes each)
            records  recordSize bytes each: u8 deleted(0), null bitmap, fields at their offsets
            index permutations: u16 record number per entry, per index
            memos: u16 length + bytes
u16 jsonLength, forms/reports JSON (ASCII)
u16 CRC-16/CCITT-FALSE of everything above in the payload
```

Records are fixed width, so record n is at `start + n * recordSize`. Limits: 65535 payload bytes, 65535 records per table. Errors (all `DBError` with a code): `xcd-truncated`, `xcd-bad-magic`, `xcd-bad-version`, `xcd-bad-type`, `xcd-checksum`, `xcd-crc`, `xcd-corrupt`, `xcd-too-big`. The binary is Latin-1; the JSON twin (`toJSON`/`fromJSON`) keeps full Unicode and is lossless.

### Atari limits (assumptions)

ACBase does not exist yet, so these are design assumptions that the Atari view and `dbcore.atariCheck` warn about, and that ACBase must meet or revise: 8 tables, 32 fields per table, 254-byte records, 4 indexes per table, 65535 records, 65535-byte file, 8 forms, 8 reports. Memo fields are stored apart; ACBase would show the first line.

## Import and export

| Format | Import | Export | Notes |
|---|---|---|---|
| `.xcd` / JSON | yes | yes | |
| DBF (dBase III, with `.dbt`) | yes | yes | types mapped C/N/F/D/L/M; deleted records skipped; every loss reported |
| CSV, TSV | yes | yes | delimiter and header detection, quotes, BOM; types inferred on import |
| SQLite | Node (`xcdsqlite.cjs`) | Node | not in the browser; the browser reads SQLite through the gateway |

Every conversion returns a `loss` list (`{code, severity, count, detail}`); the app shows it after open or export.

## SQL gateway

`node tools/sqlgate/server.cjs <config.json> [port]` (default port 8766, 127.0.0.1 only). SQLite first; `mysql`, `mariadb`, `postgres`, `odbc` engines are later and today fail with `bad-config`. Config: see `tools/sqlgate/config.example.json`. **Never commit a real config**: it holds paths, and later credentials. Clients name a database by alias only.

Security model:

- Token: `X-AC-Token` (from `AC_TOKEN` or printed random one), timing-safe compare, 403 on mismatch.
- Read-only by default; writes need `"readOnly": false` and the `/sql/exec` route, on allow-listed tables only.
- Table allow-list enforced by the SQLite authorizer, not by text matching. Reads of other tables, `ATTACH`, `PRAGMA`, `load_extension`, and non-whitelisted functions are denied.
- Parameterised queries only: SQL with comments, string literals, backticks, `;`, non-ASCII, or named/numbered parameters is refused before it reaches SQLite. Values (null, number, boolean, string up to 10000, max 100) are bound with `?`.
- Limits: `maxRows` (default 1000; a client can only lower it), `maxBytes`, `timeoutMs` (the worker process is killed).
- Audit log of what ran (never the values).

Routes: `/sql/caps`, `/sql/tables`, `/sql/schema`, `/sql/query`, `/sql/exec`; arguments in `X-AC-Args` (URL-encoded JSON), meta in `X-AC-Meta`, errors in `X-AC-Err`.

Not done: `web/js/transport.js` has no `sql.*` mapping yet; xCBase calls the relay directly with the same header convention. Adding `sql.*` (opcodes 64-67) to the transport and the relay is future work ([ARCH-SQL-GATEWAY](ARCH-SQL-GATEWAY.md)).

## The web app

`web/xcbase.html`: Grid (virtual scrolling, tested with 20000 records), Form, Query, and Atari view (64-column 1-bit screen using the ACWriter 4x7 font, record layout with offsets, file-size meter, warnings). Edit, add, delete, schema changes: all undoable. Design (fields, indexes), Import, Export, Report (HTML, print), Merge, SQL gateway panel (token kept in memory only). Right-click: Clear undo history and Clear history (recent databases, gateway address, last query). One home entry (xCBase) opens it in a new tab.

## Mail merge into xCWriter

xCWriter has **no merge feature today** (it opens text, RTF, HTML, Markdown and docx) and its files were not changed. xCBase therefore writes three files and xCWriter needs a small addition to consume them:

1. `<table>-letters.txt`: the finished letters, one per record in view order, separated by `\n\f\n` (a form feed). Open it in xCWriter today; each letter starts a page if the form feed is honoured.
2. `<table>-merge.xcmerge.json`: `{ "format": "xcmerge", "version": 1, "table", "fields", "template", "records": [ {field: value} ] }`. Template markers are `<<Field>>` (case-insensitive; unknown fields are warned about and merge as empty).
3. `<table>-merge.csv`: the data only.

What xCWriter needs: (a) a "Merge..." command that picks an `.xcmerge.json` or CSV data file, (b) `<<Field>>` substitution in the open document using `dbcore.mergeText`-style rules, keeping character formatting around the marker, (c) a page break after each merged letter, (d) optionally a field-chip insert menu. Until then, use the `.txt`.

## Open items

ACBase itself (Atari); `sql.*` in `transport.js`; MySQL/MariaDB/Postgres/ODBC gateway engines; SQLite import in the browser (needs a WASM SQLite or the gateway); xCWriter merge hook (above); ACBase limits above are assumptions.
