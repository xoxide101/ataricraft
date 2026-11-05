# Letter Perfect (LJK) document format

Verified by saving documents from Letter Perfect (LetterPerfect.ATR, run on the emulator with the Atari 800 OS-B ROM — the XL OS hangs the program) and diffing/decoding the saved sectors, plus the 10 documents already on the disk. Samples: `docs/samples/import/letterperfect-*.bin`. Importer: `tools/import-letterperfect.cjs`.

## On disk
Not a standard DOS 2 file system for LP files: the directory is sectors 361-368 (16-byte entries: flag, sector count (2), header sector (2), 8+3 name, ext `LP`; flag is `$4C` for new files, `$6C`/`$CC` on older ones). `lsdisk.cjs` cannot mount the disk because of this.
The entry points to a **header sector**: `4C 00 00 01 vv LL LL 00` followed by a list of 16-bit little-endian data sector numbers ended by `00 00`. `vv` is `$2A` (old files) or `$2B` (files saved here); `LL LL` = text length (verified: equals the offset of the `$1B` terminator). Data sectors are plain 128-byte blocks (no link bytes), a document is their concatenation. Bytes after the `$1B` are stale buffer garbage/zeros.

## Text stream (all verified from saved files)
- Text is ATASCII, ends with `$1B` (ESC). `$9B` ends a line = paragraph (there is no hard wrap; long lines are stored whole and wrapped at print time). Indentation/right alignment are literal spaces.
- `$03` Ctrl-C: centre this line (written at line start).
- `$02` Ctrl-B: bold toggle (pairs). `$15` Ctrl-U: underline toggle (pairs). Can nest.
- `$16 $5E` (Ctrl-V ^): superscript toggle; `$16 $2A` (Ctrl-V *): subscript toggle (each seen as an on/off pair).
- `$06` Ctrl-F: format line, text `j1m5w60` then `$9B` (letters from the on-screen help: j justify 0/1, m left margin, w width, t top, b bottom, l line spacing, p lines/page, s stop, f font, a margin adjust, n page number, d defaults, r reset). Stored as text; j0/j1 verified as stored, effect on layout not observed.
- `$08` Ctrl-H header line, `$07` Ctrl-G footer line: code + text + `$9B`.
- `$10` Ctrl-P: forced end of page (single byte, followed directly by the next text).

## Unverified
Ctrl-D delimiter, `$n`/`#n` print string/number (Ctrl-V `$`/`#`), whether toggles persist across paragraph ends, other Ctrl-codes in the key list (Ctrl-I improve, etc. are editor commands, not stored). Importer treats unknown control bytes as ignorable.

## How saved
Editor ESC -> menu, `>` x3 to SAVE, Return, type filename, Return. The ATR header flag byte 15 (value 1) makes the emulator drive write-protect the image; clear it to save.
