# Build

There is no bundler: the web apps run straight from source. A few files are *derived* from other files; one command regenerates all of them.

```
node scripts/build-all.cjs           # regenerate everything
node scripts/build-all.cjs --check   # change nothing; exit 1 if any derived file differs from its sources
node scripts/build-all.cjs --list    # print every derived file, its sources, and committed/gitignored status
```

`--check` runs inside `node scripts/audit-run.cjs` (first entry), together with `node scripts/docs-check.cjs` (docs vs. code).

## Steps

| Step | What it does |
|---|---|
| `xcwriter` | `scripts/sync-xcwriter-core.cjs`: rebuilds the xCWriter browser bundle (`xcw-core.js`, `xcw-data.js`) from `tools/*.cjs` (including `sfnt`, `fontpipe`; `woff2.cjs` is Node-only and not bundled) |
| overrides | validates `font/overrides/*.acf` (the hand-drawn overrides read by the font pipeline) |
| `faces` | `tools/acwfaces.cjs` + `font/overrides`: `font/build/*.inc`, `web/js/fontedit/acw-faces.js`, `web/library/fonts/acw`; creates missing `font/craft*.acf` (existing ones are hand-edited and kept) |
| `fontlist` | `scripts/fontlist.cjs`: font manifests under `web/library/fonts/local` |
| `acwriter` | ACWriter build (`tools/acwriter/mk*.cjs`, MADS) **only if `tools/acwriter` is git-clean**; otherwise skipped with a message, so someone's uncommitted work is never overwritten or compared |

## Derived files: committed or ignored

| Files | Status |
|---|---|
| `web/js/xcwriter/core/xcw-core.js`, `xcw-data.js` | committed |
| `font/build/craft4.inc`, `craft5.inc`, `craft6.inc`, `zfont.inc`, `web/js/fontedit/acw-faces.js` | committed |
| `web/library/fonts/acw` | committed (force-added although `web/library/*` is ignored) |
| `web/library/fonts/local` | gitignored (built from `font/`, `font_personal/`, ROM charset) |
| `tools/acwriter/*.inc`, `web/js/fontedit/builtin-fonts.js`, `tools/acwriter/poc5.lst` | committed |
| `tools/acwriter/poc5.xex` | gitignored (`*.xex`) |
| `web/library/fonts/craft` | gitignored |
| `font/craft8.fnt`, `font/craft{4,5,6,10,12}.acf` | in place: created when missing, hand edits kept, not compared |

`node scripts/build-all.cjs --list` is authoritative. Personal fonts (`font_personal/`, `web/library/fonts/personal/`), ROMs and disk images are never committed.
