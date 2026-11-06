# File extensions

Rule (decided): `xcw` for write, `xcs` for spreadsheet, `xcd` for database; everything else uses its normal, standard name where one exists. All three fit Atari 8.3 names.

## Ours

| Extension | Meaning | Status |
|---|---|---|
| `.xcw` | Craft Word document (CRFT type `W`, [CRAFT-FORMAT.md](CRAFT-FORMAT.md)) | written by xCWriter, `craftimport`, EBookCraft; ACWriter reads and writes it when you type the name with the extension |
| `.cwd` | old name of the same format | still read everywhere; ACWriter (6502) still adds it when you type no extension; the demo sample keeps it |
| `.xcs` | Craft spreadsheet (type `S`) | format defined in `docs/XCCALC.md`; adapter `xcs` in the registry |
| `.xcd` | Craft database (type `D`) | reserved the same way; format not defined yet |
| `.acf`, `.xcf` | Craft font (ACF2, [FONT.md](FONT.md)) | in use, same format under both names |
| `.cdc`, `.dic` | spell-check dictionaries | in use |
| `.fnt`, `.ovl` | ACWriter font and overlay files | in use |
| `.zip` | Craft Container file: ZIP with `manifest.json`, `original/`, `derived/` ([ARCH-CONTAINER.md](ARCH-CONTAINER.md)) | in use; the old `.ccn` suggestion is dropped |

The extension is a hint only; the header or magic decides (`CRFT`, `ACF2`, ATR magic). Old `.CSP`/`.CDB` reservations were replaced by `.xcs`/`.xcd`.

## Standard names we read or write

| Group | Extensions |
|---|---|
| Atari disks, programs, tapes, cartridges | ATR, XFD, DCM, ATX, PRO, XEX, COM, OBX, CAS, CAR, ROM, BIN |
| Other machines | TAP, TZX, D64, NES, and the like, as profiles add them |
| Text and documents | TXT, RTF, HTML, MD, DOC, DOCX, EPUB, FB2, MOBI, PDF |
| Data, images, archives | JSON, CSV, PNG, BMP, PBM, PGM, PPM, ZIP, 7Z |
| Source | ASM, INC, BAS, LST |

## Code

`tools/craftcore/adapters.cjs` exports `EXTENSIONS` (xcw, cwd, xcs, xcd, acf, xcf with adapter and status); `tools/craftcore/profiles/atari8.json` lists the Craft document names under media. Detection never trusts an extension over a matching header.
