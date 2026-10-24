# Large disks: formats, tools and limits

What Ataricraft can read and write on big disk images, what was checked and against what, and what is still open.

## Recommended format for big files

**SDFS (SpartaDOS / BW-DOS / RealDOS file system) in a 256-byte-sector ATR, packed layout, at most 65,535 sectors (about 16 MB).**

- SDFS handles big files well (a file is a short list of sector maps, so deleting is cheap), has subdirectories and date stamps.
- MyDOS 16 MB images work, but copy tools are reported to corrupt files on them (Tom's Navigator). Prefer SDFS for anything you write.
- 512-byte sectors (about 32 MB) are supported by SpartaDOS X only. The generator can write them, but they are **not verified** against a real DOS. The sector-size code written (`1`) is a guess.
- Beyond 16 MB you need APT/IDE partition images (`tools/apt/apt.cjs`). Mounting those in the emulator (FDISK, `$A0` SIO device) is **not done**.

## ATR layouts

| Layout | Sectors 1-3 | Rest | Size |
|---|---|---|---|
| Packed (standard, SDrive, sio2bsd, fixed BW-DOS) | 128 bytes | 256 | 16 + 384 + (n-3) x 256 |
| Uniform (mkatr 1.x output, original BW-DOS 16 MB image) | 256 bytes, data in the first 128 | 256 | 16 + n x 256 |

`dosfs.js` reads both (size divisible by the sector size means uniform). Ataricraft writes the packed layout. Real hardware through sio2bsd boots only the packed one.

## What the UI does (Disk panel)

- **Pre-format as SDFS** (blank disk): empty SDFS volume, 256-byte sectors.
- **Browse files / Save all .zip / per-file download**: DOS 2.x, MyDOS (with subdirectories) and SDFS.
- **Add files...**: writes into an SDFS disk (names converted to 8.3 upper case), reads each file back to verify, remounts. Press Reset so the DOS rereads the disk.
- **Mount folder...** (Chromium only): builds an SDFS disk from a host folder (up to 16 MB) with spare space (default 4 MB) and mounts it. Names are mapped to 8.3, duplicates get `_1`, `_2`. Hidden files (leading `.`) are skipped.
- **Sync back**: copies files that changed or are new on the disk into the folder. Files deleted on the disk are left in the folder and reported. It is a manual, one-way (disk to folder) step; changes made in the folder afterwards are not picked up until you mount again.

Writing to DOS 2 / MyDOS disks is **not implemented** (read only).

## SDFS format notes (as implemented in `web/js/dosfs.js`)

Boot sector (sector 1, first 128 bytes):

| Offset | Meaning |
|---|---|
| 1 | boot sector count (3) |
| 7 | **must be `$80`** - BW-DOS rejects the disk with Error 148 otherwise (from BW-DOS `XBWCIO1.ICL`) |
| 9-10 | root directory sector map |
| 11-12 / 13-14 | total sectors / free sectors |
| 15 | number of bitmap sectors; 16-17 first bitmap sector (4) |
| 18-19, 20-21 | next-free hint, directory hint |
| 22-29 | volume name |
| 30 | `$28`; 31 sector-size code (0 = 256, `$80` = 128); 32 version, must be above `$1F` (`$20`) |
| 40-41 | sector map of the boot file (0 = not bootable) |

- Bitmap: bit 7 of byte 0 is sector 0; a set bit means free.
- Sector map: bytes 0-1 next map, 2-3 previous map, then 16-bit data sector numbers (126 per 256-byte map).
- Directory: a file read through its map; 23-byte entries (flag, map sector, 24-bit length, 8+3 name, day, month, year, hour, minute, second). Flags: `$08` in use, `$10` deleted, `$20` directory. The first entry is the directory's own header (parent map in its map field, 0 for root). **A directory is limited to 32,768 bytes** (about 1,424 entries).
- Generated volumes are **not bootable**; boot another disk (e.g. BW-DOS) and use the SDFS disk as D2.

## DOS 2 / MyDOS notes

- Directory at sector 361, 8 sectors, 16-byte entries. **With 256-byte sectors only the first 128 bytes of each directory sector hold entries (8 per sector).**
- Sector links: volumes of 1023 sectors or fewer use a 10-bit link; larger volumes use a full 16-bit link (`s[len-3]<<8 | s[len-2]`), byte `len-1` is the byte count.

## How this was checked

| Check | Result |
|---|---|
| `scripts/dosfs-test.cjs` (writer vs reader, 256 x 65535, 256 x 1440, 512 x 20000, subdirs, big files, disk full) | pass (these only test my writer against my reader) |
| `scripts/lsatr-compare.cjs` vs dmsc `lsatr` 1.4 on 17 real images (BW-DOS x2, APT toolkit, MyDOS 16 MB, 11 SDrive game images with ~550-900 files each) | all file lists and contents identical, except `Koalaview.atr` (below) |
| `scripts/buildsdfs-test.cjs` (folder to SDFS, name mapping, 17 MB rejected) + `lsatr` listing | pass |
| BW-DOS 1.30 in the emulator on a generated 16 MB SDFS disk: `DIR`, `TYPE`, `COPY` to it; my reader reads the copied file | pass |
| Mount folder + BW-DOS `COPY` + Sync back (mock directory handle) | pass |

`Koalaview.atr`: for 78 files `lsatr` stops with "file too long in disk" because the directory's sector count is smaller than the real sector chain. Ataricraft follows the chain and returns the longer data. Which is right was not checked on a real DOS.

Mount folder was tested with an in-memory stand-in for the browser's directory handle, **not** a real folder picker. Nothing here has been run on real Atari hardware.

## Tools used (not redistributed)

- `lsatr` / `mkatr` by Daniel Serpell (dmsc/mkatr, GPL): listing and extraction used as an independent check, source read only for format details. A Windows build must be downloaded separately; `scripts/lsatr-compare.cjs` expects it at `out/mkatr14/mkatr-1.4/win32/lsatr.exe`. Note the Windows build writes extracted files in text mode (LF becomes CRLF); the script compensates.
- BW-DOS source (HolgerJanz/BW-DOS) for the boot-sector check.

## Open items

- Real hardware test of generated images (sio2bsd / SDrive).
- 512-byte-sector SDFS verification.
- DOS 2 / MyDOS writing.
- APT/IDE device emulation (FDISK finds no device).
- Bootable generated SDFS images (needs a boot loader; mkatr's loader is GPL and not copied).
