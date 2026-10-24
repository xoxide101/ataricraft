# Roadmap notes: beyond 32 MB (planning only, nothing here is implemented)

## Where we are
- SDFS and MyDOS volumes: 256-byte sectors up to 65535 (16 MB), SDFS 512-byte up to 65535 (32 MB, SDX only).
- Per-volume ceiling is the 16-bit sector number in the classic DCB and the SIO RAM handler. It is a software limit, not the ATR header (24-bit paragraph count = 256 MB).
- APT: virtual device (`sioTap`, device `$A0` unit 1) verified with FDISK and BW-DOS `APT.COM` (list/mount/dir/type/copy) for 256-byte partitions. Mounted drives are served as device `$30+n`.
- Source images are raw files; no VHD yet.

## Facts to keep in mind (from forum/maintainer notes, not tested by us)
- XDCB (Drac030): 32-bit sector number in DAUX1-4; used by all APT firmwares. DracOS 65C816 also has a 24-bit buffer address.
- Max addressable hard disk for APT is 28-bit LBA = 137.4 GB; physical/logical disks have no ATR-style limit.
- Modern devices (SIDE2/3, Ultimate 1MB, Incognito, IDE Plus 2.0, MyIDE2 maybe) use raw partitions; most can also mount ATRs (even 512-byte) stored inside partitions.
- SDFS 2.1 has a "cluster" concept for bigger volumes with a 16-bit map; no driver implements it.
- Past 32 MB per volume needs a different handler type (PC-LINK / RespeQt style, read-only FAT driver, or SCSI-style as on ICD adapters).

## Possible work, in priority order
1. **APT in the UI**: create/open a raw APT image, list partitions, add/remove 256-byte (and 128-byte) DOS partitions, browse/add files via dosfs.js, export raw. Needs: partition size picker (<=65535 sectors), name, drive mapping slots.
2. **APT mount inside the emulator for any DOS**: finish the virtual device so SDX/MyDOS can use it (SDX has its own APT driver; BW-DOS `APT.COM` already works). Remove the "listed 5 times" artifact by faking `$D803/$D80B` per PBI bit only.
3. **ATRs inside APT partitions** (devices do this): allow a partition to hold an ATR container; low priority.
4. **VHD support (our own wrapper)**: fixed VHD = raw data + 512-byte footer ("conectix", big-endian fields, CHS geometry, checksum, type 2). Fixed VHD is trivial and lets PC tools (Windows Disk Management, 7-zip) mount it; contents = raw APT image. Dynamic VHD only if needed. Real Ataris see only the APT partitions, so VHD is an export/convenience format.
5. **Bigger sector counts**: only through APT multi-partition. Do not extend ATR for >65535 sectors (no DOS could mount it).
6. **SIO2SD / SDrive / sio2bsd hardware**: generated ATRs should be tested there (still untested). Check each device's limits: sector size support (128/256/512), max image size, ATR vs raw, APT support. Record results in LARGE-DISKS.md.
7. **Bootable generated SDFS**: own small boot loader (do not copy GPL mkatr loader). Boot sector: flags, count=3, load addr, init addr, then code that loads DOS.SYS from the root directory.
8. **Mount folder as MyDOS** (`buildMyDos`) plus a format dropdown.
9. **Read-only geometries** (DOS 2.5 enhanced density, 128-byte multi-VTOC) and MyDOS directories over 64 entries.
10. **Reference tools to compare against**: NG-atariATR (atrtool, Total Commander plugins), lsatr/mkatr, BW-DOS APT.COM, FDISK, Altirra.

## Cautions
- Always verify with a real DOS plus an independent tool (lsatr, atrtool) before claiming a format works.
- 512-byte SDFS is SDX only; BW-DOS needs 128/256.
- Windows lsatr mangles bytes 0x0A/0x9B/0x0D on extract (text mode); avoid in test data.
- Do not redistribute FDISK, SDX ROMs, or copyrighted pages (e.g. Sedory's article).
