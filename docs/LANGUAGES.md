# Languages and compilers

Plan for programming languages across the systems Ataricraft covers. Everything must run offline in the browser, so any
toolchain has to be WebAssembly or plain JS. Status marks what exists today, not what is verified on real hardware.

## Status

| Language | Atari 8-bit | C64 | Apple IIe | TRS-80 | TI-99 | IBM PC | Browser / Windows |
|---|---|---|---|---|---|---|---|
| Native BASIC | interpreter (`web/js/basic.js`) | planned | planned | planned | planned | planned | - |
| Assembler | MADS-subset (`asm6502.js`) | 6502 reuse | 6502 reuse | Z80 needed | TMS9900 needed | 8086 needed | - |
| BASIC compiler | **done, subset** (`bcomp.js`) | - | - | - | - | - | - |
| FastBASIC | planned (WASM) | planned | planned | no | no | no | - |
| C (cc65 / z88dk / SDCC) | planned | cc65 | cc65 | z88dk | GCC TMS9900 port | OpenWatcom/GCC | - |
| Forth | planned | planned | planned | planned | planned | planned | JS |
| Pascal | later | later | later | later | later | later | - |
| GFA-style language (ours) | later | later | later | later | later | later | later |

## Toolchains
- **FastBASIC** (`dmsc/fastbasic`): cross-compiles to Atari, C64 and Apple II from one dialect. Needs a WASM build.
- **cc65**: C for 6502 (Atari, C64, Apple II). **z88dk / SDCC**: C for Z80 (TRS-80). TI-99 needs the TMS9900 GCC port.
- **EndBASIC** (`endbasic/endbasic`): Rust, WASM-ready; a candidate for the browser/Windows BASIC.
- **FreeBASIC / QB64**: IBM PC BASIC with native executables.
- **Forth**: cheapest to port, one small core per CPU.
- **C++**: only practical on IBM PC / Windows; not planned for 8-bit targets.

## Our own pieces
- `bcomp.js`: Atari BASIC to MADS asm / XEX. Design: 16-bit signed integers only, no strings or floats (compile errors),
  runtime routines included only when used, output through CIO. Cross-checked against MADS and run on the node 6502.
- GFA-style language: structured BASIC with procedures and a back end per CPU. Needs the assemblers first.
- `tools/tui/tui.inc`: text-mode UI (windows, menus, mouse) for Atari tools; a browser-side `tui.js` skin is planned.

## Suggested order
1. ~~Atari BASIC compiler~~ (done, see below). 2. FastBASIC and cc65 in the browser. 3. Forth. 4. Z80, TMS9900, 8086 back ends. 5. GFA-style language.

## Not verified
Nothing here beyond the existing interpreter and assembler has been built; WASM availability of each toolchain is unchecked.

## Atari BASIC compiler (web/js/bcomp.js)

Compiles an integer subset of Atari BASIC to MADS-style 6502 source and a runnable XEX. In the BASIC tab: Compile + run on Atari, Save .XEX, Save .ASM. Tests: `node tools/tests/bcomp.test.cjs` (runs the XEX on a node 6502, compares with the interpreter, cross-checks MADS) and `node scripts/bcomp-test.cjs` (boots a compiled program in the real emulator).

- **Supported:** LET, PRINT/?, IF/THEN, GOTO, GOSUB/RETURN/POP, FOR/NEXT (constant STEP), ON GOTO/GOSUB, POKE, INPUT (numbers), DIM (numeric arrays), GRAPHICS, COLOR, SETCOLOR, PLOT, DRAWTO, POSITION, SOUND, END/STOP, REM. PEEK, DPEEK, ABS, INT, STICK, STRIG, PADDLE, PTRIG, and `INT(RND(0)*N)`.
- **Not supported (compile error or missing):** floats (16-bit signed integers only; division truncates), string variables, DATA/READ/RESTORE, computed line numbers, `PRINT #`, non-constant STEP, array bounds checks, bare `RND`.
- Not yet run on real hardware.
