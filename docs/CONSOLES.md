# Consoles

| System | Status |
|---|---|
| Atari 2600 | `web/console.html` + `web/js/a2600.js` (own core) |
| Atari 5200 | Main emulator (atari800 core, needs 5200 BIOS) |
| Atari 7800 | Not implemented (console.html recognises `.a78` and says so) |
| Atari Lynx / Jaguar | Not implemented (recognised by `.lnx` / `.j64`) |
| Atari ST / Falcon / TT / Mega | Not implemented; planned next (68000 core first) |

## 2600

- CPU: `web/js/cpu6502.js` (`step()` returns cycles).
- `Console2600`: TIA rendered per colour clock, RIOT timer/ports, 262-line NTSC frames.
- Mappers (auto-detected by size/signature, overridable): 2K, 4K, F8, F6, F4, FA, EF, E0, 3F.
- Not covered: paddles/keypads, PAL palette selection UI, many exotic mappers, exact audio.
- Controls: arrows + Space (P1), WASD + G (P2), Enter reset, Shift select, C colour/B&W, gamepad 0.
- Right-click the display (or press Fill) to stretch ignoring aspect ratio.

### Core features and the dev kit

Every core declares a `features` list in `web/console.html`; the page enables or hides controls (mapper, fill, colour/B&W, gamepad, dev kit) to match the active core. The goal is that every system gets the same set of tools in its own flavour. For the 2600 the dev kit is `web/js/a2600dev.js` (DOM-free, so scripts and AI agents can call it as well as the page):

- `assemble(src)`: 6502 assembler with TIA/RIOT register names predefined, labels, `EQU`/`=`, `ORG`, `.byte`/`.word`/`DS`, `<`/`>` operators, zero page vs absolute chosen automatically. Returns `{ok, errors[{line,message}], rom, symbols, listing}`.
- `disasm(read, pc, count)`, `inspect(con)` (CPU, beam position, both players, missiles, ball, playfield, RAM as plain data).
- `spriteAsm(rows)` and `playfieldAsm(cells)` turn bitmaps into `.byte` lines (PF0/PF1/PF2 bit order handled).
- Console debugging: `con.breakpoints` (a `Set` of addresses; `runFrame()` stops with `bpHit` set) and `con.stepInstruction()`.
- Page: **New 2600 program** loads a starter kernel; edit, **Assemble & Run**, Step / Step frame, breakpoints, live registers/objects/RAM, clickable sprite and playfield editors that insert code, and **Download .a26**.

Not yet: a 2600 kernel/macros library, a TIA object timing view, cycle counting in the assembler, and the same kit for other systems (each core will add its own).

## File extensions

Canonical names: `.a26` (2600), `.a52` (5200), `.a78` (7800), `.atr/.xex/.car/.cas` (Atari 8-bit), `.lnx`, `.j64`, `.nes`, `.gb/.gbc/.gba`, `.sms/.gg`, `.md`, `.sfc`.
`node tools/rom-namer/romname.cjs <file|folder> [--apply]` identifies files by header, extension alias (`.vcs`, `.xfd`, `.smd`...) or, for bare `.bin/.rom`, a size/vector guess. Dry run by default; guesses are reported but never auto-renamed. Test: `node tools/rom-namer/romname-test.cjs`. This is detection and renaming only, not format conversion (e.g. headerless to `.a78`).

## Tests

`node scripts/a2600-test.cjs` (25 checks). `A2600_ROM=<file>` adds ROM checks (27).
ROMs are not shipped; supply your own.
