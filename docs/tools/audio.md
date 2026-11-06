# Audio tools

| Tool | What it does |
|---|---|
| `tools/tests/midiplay.asm` (MIDIPLAY.COM) | Plays a converted MIDI file on POKEY (uses `pitch.inc`, `player.inc`, `midread.inc`) |
| `tools/tests/mp3play.asm` (MP3PLAY.COM) | Plays pre-converted audio data from disk (sample player) |
| `tools/midiconv.cjs` | Converts `.mid` to the Atari music format |
| `tools/audioconv.cjs` | Converts audio (WAV etc.) to Atari sample data |
| `tools/make-audio-disk.cjs` | Builds a disk image of converted audio (output disks are not committed) |
| `tools/tests/mkaudio.cjs`, `mkdemo.cjs`, `mksample.cjs` | Generate synthetic test tones/demo data |

Usage: run each `.cjs` with no arguments for its usage line. Code structure: converters are single-file Node scripts, no dependencies; the players are assembly with shared include files. Verification: `scripts/*audio*`/sound tests in `scripts/`; real-hardware playback is untested.
