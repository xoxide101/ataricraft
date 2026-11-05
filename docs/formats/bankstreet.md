# The Bank Street Writer (Atari 8-bit, Broderbund 1982)

Verified against a document saved by the real program (`docs/samples/import/bankstreet-sample.bin`).

- A document is an ordinary DOS 2 file on a data disk that BSW initialised itself.
- Text is ATASCII with no header.
- `$9B` ends a paragraph. Long lines are not wrapped in the file.
- `$03` at the start of a line centres it.
- `$8E` is a soft word-wrap break; BSW loads it as a space.
- `$09` is an indent; the importer turns it into spaces.
- BSW has no bold, underline or other style codes.

Unverified: the password, stored as a 3-character cipher in the file-name extension, is not decoded.

Importer: `tools/import-bankstreet.cjs` (`read`, `extractFromAtr`). Test: `node scripts/test-import-bankstreet.cjs`.
