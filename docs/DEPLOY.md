# Deploying to the private test server

The server (`[private-deploy-target]\`, live at [private-server]) is **private web testing**.
**Git is the only restricted channel:** gitignored and personal material (personal fonts, ROMs/OS images, disk images, samples,
generated manifests) stays out of commits and pushes, but it may be copied to the server because the apps need it there.

## Script

`scripts\deploy-server.ps1` (PowerShell 5.1+/7):

| Switch | Effect |
|---|---|
| `-WhatIf` | Dry run: lists every file that would be copied, the size total, and writes `out\deploy-excluded.txt`. Nothing is copied. |
| *(none)* | Real copy. |
| `-Target <path>` | Another web folder (default is the share above). |
| `-NoPersonal` | Optional: skip `font_personal\`, `web\library\fonts\personal\` and the Personal group of the manifest. Personal fonts are deployed by default. |
| `-IncludeSoftware` | Also copy `software_n_roms\` to `<server root>\software_n_roms\` (not needed at run time). |
| `-Quiet` | Print only the summary. |

Always run `-WhatIf` first and review the list.

## What is copied (copy-newer, never delete, no `/MIR`)

- the whole `web\` tree: `index.html`, `tools.html` (Craft Tools hub, stamped like the other pages), `xcwriter.html`, `ebookcraft.html`, `fontedit.html`, `workbench.html`, `js\`, `js\xcwriter\*` (incl. `core\`), `js\fontedit\*`, `img\`, `ref\`, `library\` (disk images, craftapps, samples, fonts incl. `fonts\personal\`);
- `web\library\fonts\local\` regenerated first by `node scripts\fontlist.cjs`: `manifest.json` (groups Craft faces / Shipped / Atari ROM / Personal), the shipped fonts from `font\`, the ROM charset extracted from the OS ROM, and `font_personal\` (Atari8bit.ttf, FONT.FNT, ...). Manifest URLs are relative, so the picker and the font editor find them under the subfolder;
- ACWriter: the built `tools\acwriter\poc5.xex` as `library\craftapps\ACWriter\POC5.XEX`, `font\*` as `...\ACWriter\FONTS\`, personal fonts as `...\FONTS\PERSONAL\`, any `.cwd/.dic/.ovl/.fnt/.acf` next to the source, and the spell-check dictionaries `docs\samples\EN.CDC`, `EN8.CDC` and the demo `ACWRITER-DEMO.CWD` into the same `ACWriter\` folder (the main app lists `library\craftapps\*` by folder; xCWriter itself embeds the dictionary and demo in `xcw-data.js`, so it needs no extra files);
- `roms\` (Altirra OS/BASIC) to `<server root>\roms\`, where the app probes `../roms/`.

A file is copied only when it is missing on the server, differs in size, or is older there. Files on the server that are not ours are never touched.
`server.html` is left alone.

## What is excluded (listed in `out\deploy-excluded.txt`)

`out\`, `node_modules\`, `.git\`, `target\`, build dirs, `local\`, `books\`, temp/log/`.lab`/`.lst` scratch files, `Thumbs.db`, and `web\server.html`.

## Page requirements (checked)

`xcwriter.html`, `ebookcraft.html` and `fontedit.html` use only relative URLs (no `/web/...`, no localhost, no `showDirectoryPicker`); fonts load through `fetch` of the manifest over http.
On deploy both pages get `?v=<sha1 of the file>` appended to each local `.js`/`.css` link (the source files are unchanged), so changed scripts bypass browser caches.
The xCWriter bundle (`web\js\xcwriter\core\xcw-core.js`) must be current: the script runs `sync-xcwriter-core.cjs --check` and stops if not.

## Last dry run (`-WhatIf`, nothing copied)

2041 of 4378 candidates would be copied, 67.6 MB (all candidates 509.9 MB; the rest, incl. the 6 ROM files in `<server root>\roms\`, is already current on the server). Groups: `library\fonts\personal` 1948 files / 58.8 MB, `ref` 2 / 6.7 MB, `js` 43 / 1.2 MB (incl. `js\fontedit\validate.js`), `library\craftapps\ACWriter` 12 files (POC5.XEX, FONTS\, EN.CDC, EN8.CDC, ACWRITER-DEMO.CWD, FONTS\PERSONAL\), `library\fonts` manifests and Craft/Atari/local fonts ~0.4 MB, web root pages 6 files.

## Not verified

The dry run is the only thing executed. The real copy, and loading the pages from http://[private-server]/, are unverified until run.
