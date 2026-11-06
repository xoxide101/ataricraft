# Machine profiles

A **profile** is a JSON data file describing a machine so one core interface ([ARCH-MACHINE-CORE](ARCH-MACHINE-CORE.md)) and the shared apps can serve many systems. Files: `tools/craftcore/profiles/*.json`. Validator: `tools/craftcore/profile.cjs` (`validate(p) -> {ok, errors, warnings}`), tested by `node scripts/craftcore-test.cjs`.

| Profile | File | Status |
|---|---|---|
| Atari 8-bit (400/800/XL/XE) | `atari8.json` | **complete** (only `video.palette.rgb` unknown) |
| ZX Spectrum | `zx-spectrum.json` | stub |
| Commodore 64 | `c64.json` | stub |
| NES / Famicom | `nes.json` | stub |

## Schema (top level)

| Key | Content |
|---|---|
| `profile` | schema version (1) |
| `id`, `name`, `family`, `status` | `status` is `complete` or `stub`; `family` e.g. `6502`, `z80` |
| `variants` | models and differences (RAM size, PAL/NTSC, OS) |
| `cpu` | `{arch, chip, clockHz, clockHzPal, endianness, addressBits, notes}` |
| `memory` | `{addressBits, regions:[{name,start,end,type,layer?,notes}]}`; `type` ram, rom, io, unmapped, bank. Layers describe bank/ROM switching; regions in the same layer must not overlap; a complete profile's base layer must cover the whole address space (warning otherwise) |
| `video` | `{chip, native:{width,height}, overscan, frame, modes, palette, sprites}` |
| `audio` | `{chip, channels, notes}` |
| `charset` | `{name, encoding, glyph, glyphs, rom, lineEnd}`; `encoding` from the Container list (`atascii`, `petscii`, ...) |
| `keyboard` | `{kind, layout, consoleKeys, extraKeys, implementation}` |
| `controllers` | joystick/paddle types |
| `media` | disk/tape/cartridge types accepted, with extensions and sizes |
| `roms` | `{policy:"local-only", list:[{name, size, sha256?}], note}` - hashes identify files; **ROM bytes are never stored** (validator rejects long strings) |
| `testMaterial` | free/redistributable test programs only |
| `implementations` | cores available (e.g. `libatari800`, `altirra`) |
| `sources` | public references |
| `unknown` | list of JSON paths whose value is `null` |

## The unknown rule

No guessing. A fact we do not know is `null` **and** its path is listed in `unknown`; the validator fails if a `null` is not listed or a listed path is not null. Stubs list everything still to be filled in, so gaps are visible and searchable.

## Atari 8-bit (excerpt; full file in `profiles/atari8.json`)

```json
{ "profile": 1, "id": "atari8", "name": "Atari 8-bit (400/800/XL/XE)", "family": "6502", "status": "complete",
  "cpu": { "chip": "6502C (SALLY)", "clockHz": 1789773, "clockHzPal": 1773447, "endianness": "little", "addressBits": 16 },
  "memory": { "addressBits": 16, "regions": [
    { "name": "RAM (user, 40 KB)", "start": 0, "end": 40959, "type": "ram" },
    { "name": "BASIC ROM / right cartridge", "start": 40960, "end": 49151, "type": "rom" },
    { "name": "GTIA", "start": 53248, "end": 53503, "type": "io" } ] },
  "charset": { "name": "ATASCII", "encoding": "atascii", "lineEnd": "0x9B" },
  "roms": { "policy": "local-only" },
  "unknown": ["video.palette.rgb"] }
```
Layers in the full file: base (OS + BASIC on), basic-off, os-off, self-test, ext-bank (130XE PORTB banking), cart-left. Chips: ANTIC, GTIA, POKEY, PIA. Palette RGB is TV/emulator-defined, hence unknown.

## Stubs

Spectrum (Z80, 48K/128K: 16K ROM + RAM, ULA, 256x192 with attribute colour, 1-bit beeper / AY on 128K), C64 (6510, 64K RAM with ROM/IO banking by $01, VIC-II, SID, PETSCII), NES (2A03/2A07 6502 variant without decimal mode, PPU 256x240, APU, iNES cartridges with mappers). Only widely documented public facts are recorded; the rest are `unknown`.

## Roadmap order

Z80 family first: ZX Spectrum, Amstrad CPC/PCW, MSX; then SMS/SG-1000/ColecoVision/Game Gear/GX4000. Then 6502 family: C64, VIC-20, PET, Apple II, BBC/Acorn, NES, Atari 2600/5200/7800, Lynx. Then 6809 (CoCo, FM-7), TMS9900 (TI-99/4A), SC/MP, 6800, SM83 (Game Boy), NEC PC-6000/8000/8800. A profile stub is added when work on that machine starts.

## Adding a machine

Copy a stub, fill what is known, list the rest in `unknown`, run the tests, add free test material (public homebrew/test ROMs, kept local), keep ROM files local with names/hashes only.
