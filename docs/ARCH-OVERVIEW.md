# Architecture overview

ataricraft is the **blueprint** for a family of retro-computer "Craft" systems. Only the **core/engine** changes per machine; the apps, file formats, transport and ideas stay the same. Status: draft v1 (proposals marked *Proposed*). Code: `tools/craftcore/`, tests: `node scripts/craftcore-test.cjs`.

Specs: [ARCH-TRANSPORT](ARCH-TRANSPORT.md) · [ARCH-CONTAINER](ARCH-CONTAINER.md) · [ARCH-MACHINE-CORE](ARCH-MACHINE-CORE.md) · [MACHINE-PROFILE](MACHINE-PROFILE.md) · [ARCH-COMPANIONS](ARCH-COMPANIONS.md) · [ARCH-SQL-GATEWAY](ARCH-SQL-GATEWAY.md) · existing [TRANSPORT](TRANSPORT.md), [CRAFT-FORMAT](CRAFT-FORMAT.md), [FONT](FONT.md).

## Principles

1. **Transport mentality.** Everything that crosses a boundary (emulator, serial line, FujiNet, HTTP, a file, a database) is one `open/send/receive/close/status/events` call shape with versioned framing, chunking and checksums.
2. **Originals are sacred.** Imports keep the original bytes; derived forms and a *loss report* sit beside them. Exports are checked by round-trip diff, as in the word processor.
3. **Data, not code, describes a machine.** A machine is a core (code) plus a *profile* (JSON).
4. **Every tool has an Atari-native companion** using the same file format and transport.
5. **Free test material only.** ROMs stay local and are never committed.

## Lanes

| Lane | Purpose | Examples | Status |
|---|---|---|---|
| **Archive** | Old disks/tapes unpacked to Windows folders with catalog + checksums, rebuildable to the original image | ATR -> folder -> ATR | Container + ATR catalog exist |
| **Convert** | Data and documents between formats via the Container | CWD <-> text, DBF/CSV/XLSX/SQLite <-> Atari tables | CWD, ACF, ATR adapters exist |
| **Port** | Move programs across CPUs/targets | 6502 -> C / WASM; disassembler, later a lifter | Planned |
| **Understand** | See what a program does | memory map, symbols, debugger, trace | Emulator has debug hooks; formalised later |

All lanes share the Container (data) and Transport (movement).

## Layers and dependency rules

```
L5  apps            web/*, tools/* (xCWriter, ACWriter, FujiNet Explorer, ACCalc, ACBase ...)
L4  lanes           archive / convert / port / understand   (use adapters + container)
L3  adapters        tools/craftcore/adapters.cjs and per-format adapters
L2  container, profile, encodings, framing   (pure, no I/O, no DOM)
L1  transport backends (emulator, serial, fujinet, http/ws, pipe/file, loopback)
L0  machine cores   (emu.js libatari800, emu-altirra.js, future Z80/6502 cores)
```

Rules:
- A layer imports only from layers **below** it, never above. L2 modules are pure (bytes in, bytes out) and load both in Node (`require`) and the browser (`AC.CraftCore.*`).
- Apps never call a core or a device directly; they go through a transport (even in-process: `emulator` backend).
- Machine-specific knowledge lives only in L0 and in profile JSON. An app asks the profile, not `if (machine == ...)`.
- No credentials, ROMs or personal media in git.

## Repo layout

| Path | Contents |
|---|---|
| `web/` | browser apps and `web/js/` (emu, transport) |
| `tools/craftcore/` | container, encodings, adapters, framing, loopback, profile validator, `profiles/*.json` |
| `tools/` | Node tools (craftfont, acwriter ...) |
| `scripts/` | build and test scripts (`craftcore-test.cjs`) |
| `docs/` | specs (`ARCH-*.md`, `MACHINE-PROFILE.md`, ...) |
| `archive/` | blank/sample images (only `archive/blank/*.atr` tracked) |
| `out/` | scratch, ignored |

## Working in parallel (agents and people)

- Each agent **owns paths** (declared at the start of the task). Do not edit other owners' paths.
- Use a separate **git worktree** per agent when more than one works at once: `git worktree add ..\ataricraft-<topic> -b <topic>`; merge to `main` through small commits.
- Commit **only your own files** (`git add <paths>`, never `-A`); push; if `pull --rebase` is blocked by someone else's unstaged files, skip it rather than stash or discard their work.
- Commit identity: `git -c user.name=xoxide101 -c user.email=xoxide101@users.noreply.github.com commit ...` with the `Co-authored-by` trailer.
- Scratch goes in `out/`; Node scripts are files, not one-liners.
- Every change to a spec bumps nothing silently: protocol/container/profile versions change only with a note in the spec's changelog.

## Roadmap (machines)

Z80 family first (ZX Spectrum, Amstrad CPC/PCW, MSX; then SMS/SG-1000/ColecoVision/Game Gear/GX4000), then 6502 family (C64, VIC-20, PET, Apple II, BBC/Acorn, NES, Atari 2600/5200/7800, Lynx), then 6809 (CoCo, FM-7), TMS9900 (TI-99/4A), SC/MP, 6800, SM83 (Game Boy), NEC PC-6000/8000/8800. Atari 8-bit remains the reference.
