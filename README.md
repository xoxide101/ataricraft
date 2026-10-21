# ataricraft

A web-based Atari 8-bit emulator in the Craft family: humans and agents drive the same engine.

Status: **working browser emulator** on the libatari800 reference core (see `NOTES.md` for done / to-do). Open `web/index.html` directly from disk; no server needed.

## Using it

- Pick a model and memory size, scan your ROM folder (OS and BASIC), choose the ROMs, then **Boot**. Scanned ROMs and your selection are kept in the browser (IndexedDB / localStorage); **Reset ROMs** clears them.
- On-screen keyboard shows Atari glyphs; **Show: Lower / Caps / Special** toggles which legends appear. It scales to the available width.
- Physical and on-screen keys can be mixed (Shift/Control latch). Sound and key-click are optional.
- **FujiNet** (header toggle): a virtual device `$70` on SIO. **Boot FujiNet CONFIG** loads the CONFIG boot disk, lists hosts, browses the folder you picked, and mounts disks into slots. Hosts and slots persist; **Reset config** clears them.
- The side panel collapses (☰); phone and tablet layouts are supported (tested at Pixel 6 Pro XL and Galaxy Tab S sizes).

## Building the WASM core

`web/ref/` and `vendor/` are git-ignored. Clone upstream, apply the SIO hook, then build:

```
git clone --depth 1 https://github.com/atari800/atari800 vendor/atari800
git -C vendor/atari800 apply ..\..\build\atari800-sio-hook.patch
powershell -File scripts\build-reference.ps1
```

## Goals (from Jeff, 2026-10-21)

- All 8-bit models: 400, 800, 600XL, 800XL, 65XE, 130XE (later XEGS).
- Two (eventually more) floppy drives, cassette emulation.
- On-screen keyboard showing the Atari glyphs and special characters on the keys, with Ctrl / Shift / Inverse layers, so they are easy to type.
- FujiNet support.
- Headless, agent-drivable (craftapi style: describe / state / apply / snapshot / restore / score / render).
- Long term: a cycle-exact core usable as a spec for an FPGA implementation.
- Adjustable clocks. (a) Emulation speed vs wall time, from 1:1 to as fast as the host allows: the core steps by cycles/frames and never reads the host clock. (b) CPU clock ratio vs the Atari bus (accelerated CPUs while ANTIC/POKEY keep stock timing): CPU and bus are separate clock domains with a configurable ratio.
- Enhanced hardware, as swappable chip modules (names to be confirmed with Jeff): Ultimate1MB (U1MB), PokeyMAX (POKEY replacement, SID mode), VBXE / Sophia-style video replacements. Core design: CPU, ANTIC, GTIA, POKEY, PIA and the memory map sit behind interfaces, with a stock implementation and enhanced replacements for each.
- ROMs are user-supplied and never committed. Public builds should use freely distributable replacement OS ROMs.

## Plan

1. **Reference core**: libatari800 (from atari800, GPL-2.0) built to WASM. Gives a working oracle and snapshot support (`libatari800_get_current_state` / `restore_state`).
2. **Own core in Rust** (`core-rs/`, wasm32 + wasm-bindgen), written as a cycle-exact state machine from the Altirra Hardware Reference Manual. One chip at a time: 6502, ANTIC, GTIA, POKEY, PIA, then memory models.
3. **Differential testing**: same media and inputs through both cores, compare CPU/memory/frame state per frame. That is the score signal.
4. **Web shell** (`web/`): screen, keyboard, drives, tape, craftapi layer.
5. **FujiNet**: JS-emulated device on SIO first (disk mounts from URL, N: over fetch/WebSocket); then a bridge to FujiNet-PC (NetSIO); WebSerial to real hardware later.

## Layout

| Path | Purpose |
|---|---|
| `scripts/build-reference.ps1` | Build libatari800 to `web/ref/` with Emscripten |
| `build/config.h` | Hand-written config for the Emscripten build (no autotools) |
| `core-rs/` | Rust core (not started) |
| `web/` | Browser shell (not started) |
| `roms/` | Your ROMs. Git-ignored. |
| `vendor/` | Upstream sources (git-ignored): `git clone --depth 1 https://github.com/atari800/atari800 vendor/atari800` |

## Build the reference

Needs Emscripten (`C:\Users\raver\tools\emsdk`, or set `EMSDK_DIR`).

```
powershell -File scripts\build-reference.ps1
```

## References and licences (verify before reusing code)

- atari800 (GPL-2.0), including `libatari800` and `netsio.c` (FujiNet NetSIO).
- A8E / jsA8E (GPL-2.0), 800XL only; has a browser automation surface worth studying.
- Altirra Hardware Reference Manual (timing spec) and Altirra OS (replacement ROMs).
- MAME Atari 8-bit drivers; RetroArch atari800 libretro core.
- Existing FPGA cores (e.g. MiSTer Atari 800): check licences.

Anything derived from GPL code must be GPL. A clean-room Rust core written from the hardware manual can use any licence.
