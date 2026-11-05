# The First XLEnt Word Processor (Polish edition) document format

Source: disk "First XLent Wordprocessor (Po).atr". Documents were created in the program (booted in the
emulator) and saved with Ctrl+Shift+U, 3 (SAVE), Y (entire file), filename, drive number.

## Layout
Plain ATASCII text. **No header, no trailer.** Every line ends with `$9B`; the last line also ends with `$9B`.
Hard returns are the only line breaks stored: word-wrapped lines carry no extra bytes. Tab is stored as
literal spaces. (The 32-byte-header `aw-FOX.bin` sample is NOT this format.)

## Verified codes (checked in saved files)
| Bytes | Meaning (typed as) |
|---|---|
| `C3` at line start | centre line (Option+C) |
| `C3 C3` at line start | flush-right line (Option+C twice) |
| `C6` + text at line start | format line (Option+F), e.g. `C6 "ju1"`; directives separated by `:` |
| `BC` | soft hyphen (Option+-) |
| `A0` | protected space (Option+Space) |
| `B1`..`B9` | user-defined chars (Option+1..9) |
| `01`..`1A` | special/Polish chars (Ctrl+A..Z) |
| `C2`, `D5` | Option+B, Option+U: inverse letters = *printer-driver functions* |

## Unverified
* Meaning of Option+letter functions (`C2`/`D5`/...): defined by DRIVER.SYS (not on the disk). The importer
  drops them unless `read(buf, {printerCodes:true})`, which guesses B=bold, I=italic (`C9`), U=underline toggles.
* Format-line directive semantics come from the on-disk HELP file (lm, rm, cn, ra, ju, sp, ...); the importer
  only applies `cn`/`ra`/`ju` 0/1 as persistent alignment for following lines.
* Option+Insert (mail merge), file links (`^NX` etc.), page/header directives: not tested.
* No sub/superscript support exists in the program.
