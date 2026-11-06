# SQL gateway

Lets ACBase/xCBase (and any tool) use real databases through the transport. Status: **SQLite gateway implemented** (`tools/sqlgate/`, see [XCBASE.md](XCBASE.md)); the transport `sql.*` mapping and other engines are still design; opcodes 64-67 are reserved ([ARCH-TRANSPORT](ARCH-TRANSPORT.md)).

## Shape

```
Atari/web app -> transport -> Gateway (Node service) -> adapter -> database
```
The Atari never sees SQL drivers; it sends small requests and receives pages of rows.

## Operations

| Op | Args | Reply |
|---|---|---|
| `sql.tables` | `{db}` | `{tables:[name...]}` (allow-listed only) |
| `sql.schema` | `{db, table}` | `{fields:[{name,type,nullable,length}]}` using the Container type map |
| `sql.query` | `{db, sql, params:[...], page, pageSize}` | meta `{fields, rows:n, more}`; body = rows packed (typed per schema) |
| `sql.exec` | `{db, sql, params}` | `{affected, lastId}`; a write op (`isWrite` true) |

Paging fits 8-bit buffers: `pageSize` defaults to what fits `maxChunk`; the client asks for page N+1 when `more`.

## Safety rules (enforced server-side)

1. **Parameterised queries only.** `params` are bound by the driver; the server rejects statements containing literals it cannot classify, and never concatenates client text into SQL. Multiple statements in one request are refused.
2. **Read-only mode is the default.** `sql.exec` and any non-SELECT statement answer `NotAllowed` unless the gateway config enables writes for that database.
3. **Table allow-list** per database (config); anything else is `NotAllowed`, also for joins/sub-selects referencing other tables.
4. **Credentials never in git.** Connection strings come from environment variables or a local file (`out/` or `%APPDATA%`, git-ignored); clients refer to databases by alias only.
5. Row and time limits per request (`TooLarge`, `Timeout`); audit log of statements (no parameter values by default).
6. Token (`BadToken`) required unless bound to loopback.

## Adapters

MySQL/MariaDB, PostgreSQL, SQLite (file), ODBC (Windows DSNs, covers many others). Each maps native column types to the Container type map (`int, uint, float, decimal, bool, string, bytes, date, time, datetime, blob, json`) and reports narrowing as loss entries.

## Pipeline fit

Import: `sql.query` -> rows -> Container table (original = result dump, schema = type map). Export: Container table -> parameterised `INSERT` batches -> `sql.exec`, after a diff against the existing table; encodings (ATASCII/PETSCII -> UTF-8) converted at the boundary and losses listed.

## Open questions

Decided: databases go in the order **SQLite first, then MySQL**. Open: row packing format for 8-bit clients; whether writes are ever enabled from the Atari side.
