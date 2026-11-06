# DOS boot records (`dosboot.json`)

A boot record says: *this machine, with this media in these drives, boots this target, and should look like this when ready.*
The format is deliberately generic (`machine` / `media` / `boot`) so other craft machines can reuse it; only `kind` and the `machine.system` value are Atari-specific.

## Workflow

1. Keep your DOS disk images (`.atr`/`.xfd`, or `.zip` containing one) in any local folder.
2. Scan it: `node scripts\dosboot-scan.cjs "C:\path\to\DOS"` (flags: `--all` include data disks, `--dry`, `--verbose`, `--machine`, `--ram`, `--no-register`, `--out FILE`).
   It detects the DOS family from boot-sector headers and directory signatures, writes `dosboot.json` into the folder and registers the folder in `%USERPROFILE%\.ataricraft-dosboot.json`.
   Re-scanning keeps records you edited (`userEdited`) or added by hand (`manual`).
3. Start the relay: `node tools\tnfs-bridge\bridge.cjs 8787` (optionally `--dos DIR`), open `http://127.0.0.1:8787/`, load ROMs, press **DOS**, pick a record, **Boot**.

## Ways the browser reads the folder

| Mode | Where it works | Notes |
|---|---|---|
| Relay `/dosboot/roots`, `/dosboot/media` | local relay (same-origin, localhost only) | writes (`POST /dosboot/record`, `/rescan`) need the relay token, as for other relay writes |
| `showDirectoryPicker` (**Folder…**) | localhost / https | folder must contain `dosboot.json` (zip members are inflated in-browser) |
| **Records file…** | anywhere | JSON file; media paths are fetched relative to the page |

The deployed plain-http site has no folder picker; use a records file or the local relay.

## Schema (version 1)

```json
{ "format": "ataricraft.bootrecords", "version": 1, "title": "...", "root": "C:\\DOS", "generated": "ISO date",
  "records": [{
    "id": "bw-dos-1.30", "name": "BW-DOS 1.30", "kind": "dos", "family": "bw-dos", "version": "1.30",
    "machine": { "system": "atari8", "model": "130xe", "ram": "128", "tv": "ntsc", "basic": false, "fastSio": true },
    "media": [ { "slot": "D1", "role": "boot", "format": "atr", "path": "BW-DOS.zip", "member": "bw.atr", "sizeBytes": 92176, "sha1": "..." } ],
    "boot": { "target": "D1", "autorun": null, "expect": { "anyText": ["BW-DOS"], "afterFrames": 600 } },
    "detect": { "confidence": 90, "bootHeader": "...", "files": ["..."], "evidence": ["..."] },
    "notes": "" }] }
```

- `media[].slot` is `D1`..`D8` (unique); `path` is relative to the folder and may not contain `..`; `member` selects a file inside a zip.
- Reserved (not yet implemented): `media[].folder` (synthesise a disk from a host folder) and `blank`.
- `boot.autorun` is text typed after boot; `boot.expect.anyText` is what the test checks on screen.
- Validation: `AC.DosBoot.validateRecord(rec)`.

## Tests

`node scripts\dosboot-test.cjs [id-substring ...]` starts the relay, boots records through the UI path and asserts the expected prompt text; screenshots go to `out\dosboot\`. Default set: Atari DOS 2.5, BW-DOS 1.30, DOS XL 2.30, MyDOS 4.55b4, TOP-DOS 1.5a, SpartaDOS 4.43 16M, Turbo-DOS.

## Privacy

Images, `dosboot.json` files (they hold local paths) and the registry stay local; `*.atr`, `software_n_roms/` and `archive/` are gitignored. Only the tooling is committed.

## Files

`web/js/dosboot.js` (format, detection, validation), `web/js/dosbootui.js` (picker), `tools/dosboot/{scan,api,zipread}.cjs`, `scripts/dosboot-scan.cjs`, `ataricraft.bootRecord(rec, images)` in `app.js`.
