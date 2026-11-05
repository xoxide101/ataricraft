# ACWriter modules - plan for the later memory pass

Status: **plan only, nothing here is built yet.** Priority order set by the project: get every feature working first with the
simplest memory layout, then restructure. An overlay attempt (edit/spell/page images swapped through bank 2) assembled and
mapped fine but was shelved before it was run; the notes below keep what it taught.

## Product frame

The **document manager** is the core: home/start screen, open/save/convert, recent files, a document list (type, size, page
setup, font) and the handoff block. Everything else is an *app* that creates or edits a document and is loaded on demand:
Editor, Page layout/PAGE view, Spell check (+ dictionary), Font manager, Convert/Import, Help, Page setup. Today's home/start
menu (`word/home.inc`) is the seed of the shell; a full file browser is not built yet.

## Memory tiers

| Tier | RAM | What it holds |
|---|---|---|
| 64K | main only | message only; document ~7.5 KB today; no spell table (it needs a bank) |
| 128K (130XE baseline) | + 4 banks of 16 KB | spell table in bank 1, app images in bank 2, more banks for glyph planes of larger sizes |
| Expanded (256K Rambo, 320K Compy-Shop, 576K, 1 MB) | 16+ banks | banked document, glyph planes for every size, dictionary + fonts resident |

The emulator (Altirra core, `web/js/emu-altirra.js`) already offers 128K, 320K (Rambo and Compy-Shop), 576K and 1088K, so
bank-count detection can be tested there. Detection is a PORTB bank-bit probe, counting distinct banks.

## Mechanism

* App images are assembled to run at one shared slot in main RAM and stored in a bank; a stub in the resident core copies
  the image in (bank -> `$9F00` buffer -> slot, interrupts masked) and jumps to the entry through a fixed jump table.
* The `$4000-$7FFF` window overlaps main code, so bank-touching code must live outside it (`$96A0`).
* A shared **handoff block** (document pointers, cursor, page setup, active font) keeps the document in place while apps swap.
* Glyph planes per size live in their own banks and are selected by PORTB.
* Option: switch the OS ROM off for `$C000-$FFFF` RAM (needs own NMI/IRQ vectors).

Constraint found: page code and edit/spell code cannot share one slot, so edit commands would be refused while PAGE mode is
running unless the slot is split or a bank-resident document frees the space.

## Verification rule for the pass

Before/after on 64K-class and 128K: `acwriter-{file,home,edit,spell,roundtrip,page,cap}`, `mfull`/`mkey` (baseline 77/6).
