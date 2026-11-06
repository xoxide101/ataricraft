# Hardware test programs and shared libraries (`tools/tests/`)

Atari programs written in the repo's 6502 assembler, built to `tools/tests/bin/*.COM` (our own builds of the `.asm` sources here) and bundled into the emulator's Tools disk / `web/js/progs.js`.

| Program | Source | Purpose |
|---|---|---|
| CPUTEST | `cputest.asm` | 6502 instruction/flag self-test; host twin `cpu6502.cjs` is a reference CPU used by the JS tests |
| GFXTEST | `gfxtest.asm` | Graphics modes, colours, player/missile display |
| KEYTEST | `keytest.asm` | Keyboard scan and key-code display |
| MEMTEST | `memtest.asm` | RAM test patterns, incl. banked memory |
| SNDTEST | `sndtest.asm` | POKEY channel/tone test |
| MIDIPLAY, MP3PLAY | `midiplay.asm`, `mp3play.asm` | See [audio.md](audio.md) |
| network apps | `wget`, `wput`, `lynx`, `curl`, `jq`, `nc`, `mail`, `nhtest` | See [net-apps.md](net-apps.md) |

Include files: `common.inc` (equates, helpers), `cscreen.inc` (screen output), `nlib.inc`/`ntok.inc`/`nhead.inc` (N: device and command-line), `pitch.inc`, `player.inc`, `midread.inc` (audio). Builders: `build.cjs` (all), `buildapp.cjs NAME` (one; pastes includes at `; @head/@tok/@lib`).

JS tests (`node tools/tests/<name>.test.cjs`): `netapi`, `ndev`, `ftp`, plus mocks `mockftp.cjs`, `mocktnfs.cjs`. Browser tests live in `scripts/*-test.cjs` and need Playwright, Chrome and ROMs from the (untracked) `software_n_roms/`.
