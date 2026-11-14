# Consoles

| System | Status |
|---|---|
| Atari 2600 | `web/console.html` + `web/js/a2600.js` (own core) |
| Atari 5200 | Main emulator (atari800 core, needs 5200 BIOS) |
| Atari 7800 | Not implemented |

## 2600

- CPU: `web/js/cpu6502.js` (`step()` returns cycles).
- `Console2600`: TIA rendered per colour clock, RIOT timer/ports, 262-line NTSC frames.
- Mappers (auto-detected by size/signature, overridable): 2K, 4K, F8, F6, F4, FA, EF, E0, 3F.
- Not covered: paddles/keypads, PAL palette selection UI, many exotic mappers, exact audio.
- Controls: arrows + Space (P1), WASD + G (P2), Enter reset, Shift select, C colour/B&W, gamepad 0.
- Right-click the display (or press Fill) to stretch ignoring aspect ratio.

## File extensions

Canonical names: `.a26` (2600), `.a52` (5200), `.a78` (7800), `.atr/.xex/.car/.cas` (Atari 8-bit), `.lnx`, `.j64`, `.nes`, `.gb/.gbc/.gba`, `.sms/.gg`, `.md`, `.sfc`.
`node tools/rom-namer/romname.cjs <file|folder> [--apply]` identifies files by header, extension alias (`.vcs`, `.xfd`, `.smd`...) or, for bare `.bin/.rom`, a size/vector guess. Dry run by default; guesses are reported but never auto-renamed. Test: `node tools/rom-namer/romname-test.cjs`. This is detection and renaming only, not format conversion (e.g. headerless to `.a78`).

## Tests

`node scripts/a2600-test.cjs` (25 checks). `A2600_ROM=<file>` adds ROM checks (27).
ROMs are not shipped; supply your own.
