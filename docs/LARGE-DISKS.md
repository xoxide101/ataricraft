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

- **Pre-format as SDFS** (blank disk): empty SDFS volume, 256-byte sectors. For SpartaDOS / BW-DOS / RealDOS. **MyDOS cannot read it** (it shows a wrong free count and no files).
- **Pre-format as MyDOS** (blank disk): empty MyDOS volume, 256-byte sectors from 720 up to 65535, or 90K single density. Use this one for MyDOS; SpartaDOS-family DOSes are not guaranteed to read it.
- **Browse files / Save all .zip / per-file download**: DOS 2.x, MyDOS (with subdirectories) and SDFS.
- **Add files...**: writes into an SDFS or MyDOS/DOS 2 disk (names converted to 8.3 upper case), reads each file back to verify, remounts. Press Reset so the DOS rereads the disk.
- **Mount folder...** (Chromium only): builds an SDFS disk from a host folder (up to 16 MB) with spare space (default 4 MB) and mounts it. Names are mapped to 8.3, duplicates get `_1`, `_2`. Hidden files (leading `.`) are skipped.
- **Sync back**: copies files that changed or are new on the disk into the folder. Files deleted on the disk are left in the folder and reported. It is a manual, one-way (disk to folder) step; changes made in the folder afterwards are not picked up until you mount again.

DOS 2 / MyDOS writing (add, overwrite, delete, MyDOS subdirectories) is implemented for 256-byte-sector volumes and 90K single density. Enhanced-density (DOS 2.5, 1040 sectors) and other 128-byte geometries stay read-only. Mount folder still builds SDFS only.

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

MyDOS layout as written: VTOC at sector 360 growing downward (1 + (sectors+80)/(sectorsize*8) sectors; code byte 2, or 2 + VTOC count above 1023 sectors), 'free' bit set per sector, directory at 361-368 (64 entries), subdirectories are 8 contiguous sectors (flag $10), files $42 (10-bit links) or $46 (16-bit links above 1023 sectors). Layout cross-checked against grzegorzzyla/NG-atariATR (MIT) docs.

## How this was checked

| Check | Result |
|---|---|
| `scripts/dosfs-test.cjs` (writer vs reader, 256 x 65535, 256 x 1440, 512 x 20000, subdirs, big files, disk full) | pass (these only test my writer against my reader) |
| `scripts/lsatr-compare.cjs` vs dmsc `lsatr` 1.4 on 17 real images (BW-DOS x2, APT toolkit, MyDOS 16 MB, 11 SDrive game images with ~550-900 files each) | all file lists and contents identical, except `Koalaview.atr` (below) |
| `scripts/buildsdfs-test.cjs` (folder to SDFS, name mapping, 17 MB rejected) + `lsatr` listing | pass |
| scripts/sdfs-matrix-test.cjs: SDFS create/write/read/delete at 720 to 65535 sectors (256 B) and 512 B volumes, compared with lsatr | pass |
| scripts/mydos-matrix-test.cjs: same matrix for MyDOS (90K, 180K to 16 MB), compared with lsatr | pass |
| MyDOS 4.55 beta 4 in the emulator on a generated 16 MB MyDOS image: directory, subdirectory, free-sector count, Copy of a small file onto it; my reader and lsatr read the result, and my writer still adds files afterwards | pass |
| SpartaDOS X 4.51 (cart) on generated SDFS images (90K, 720K, 16 MB): DIR, TYPE, subdirectories | pass |
| BW-DOS 1.30 in the emulator on a generated 16 MB SDFS disk: `DIR`, `TYPE`, `COPY` to it; my reader reads the copied file | pass |
| Mount folder + BW-DOS `COPY` + Sync back (mock directory handle) | pass |

`Koalaview.atr`: for 78 files `lsatr` stops with "file too long in disk" because the directory's sector count is smaller than the real sector chain. Ataricraft follows the chain and returns the longer data. Which is right was not checked on a real DOS.

Mount folder was tested with an in-memory stand-in for the browser's directory handle, **not** a real folder picker. Nothing here has been run on real Atari hardware.

## Tools used (not redistributed)

- `lsatr` / `mkatr` by Daniel Serpell (dmsc/mkatr, GPL): listing and extraction used as an independent check, source read only for format details. A Windows build must be downloaded separately; `scripts/lsatr-compare.cjs` expects it at `out/mkatr14/mkatr-1.4/win32/lsatr.exe`. Note the Windows build writes extracted files in text mode (bytes 0x0A/0x9B are altered), so byte-exact checks must avoid those values; -X takes the output directory before the image name.
- BW-DOS source (HolgerJanz/BW-DOS) for the boot-sector check.

## Open items

- Real hardware test of generated images (sio2bsd / SDrive).
- 512-byte-sector SDFS verification.
- DOS 2 / MyDOS writing.
- APT/IDE device emulation (FDISK finds no device).
- Bootable generated SDFS images (needs a boot loader; mkatr's loader is GPL and not copied).

## APT / FDISK virtual device (experimental)

scripts\apt-fdisk-virtual.cjs runs Fujiware FDISK.COM (not redistributable; place it in out\apt_apps\FDISK\) against a virtual APT device implemented with ataricraft.sioTap (device $9F/$A0, commands $53, $6E, $EC, $52, $57, 512-byte LBA via DAUX1-4). The OS ROM is patched so the $D803/$D80B ID probe passes.

- An image from tools/apt/apt.cjs shows in FDISK with its partitions, drive mapping, sector sizes and names. FDISK requires the header sector to hold only the mapping slots and the partition entries to sit in a chained table sector; the builder now does this.
- Run with blank: FDISK Initialize writes a protective MBR and an APT header that apt.cjs parses.
- Not verified against real hardware. The $6E info block and $53 status bytes are guesses that FDISK accepts. A DOS mounting the partitions is untested. The device is listed 5 times because of the ROM patch.

