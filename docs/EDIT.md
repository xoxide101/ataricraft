# ACWriter editing: select, clipboard, find, replace, goto

Keys (also in the Help page and the Edit/Search menus):

| Key | Action |
|---|---|
| ^S | Mark / clear selection (arrows then extend it; Esc clears) |
| ^Y | Copy (no selection = current line) |
| ^D | Cut |
| ^P | Paste at cursor (reflows) |
| ^F | Find (case-insensitive, wraps, "Not found.") |
| ^G | Find next |
| ^R | Replace: find text, replacement, then Y replace / N skip / A all / Esc stop |
| ^L | Goto line |
| ^A / ^E | Line start / line end |

Selection is drawn with the engine's inverse style (code 4 inserted at both ends temporarily).

Clipboard: 384 bytes at $9C80-$9DFF, raw bytes including style codes; larger copies give "Too big". Find/replace text: 32 bytes each. Document area is $6400-$8FFF (~11 KB).

Limitations: no undo; find cannot match across style codes; replace searches forward from the cursor only (go to line 1 first); selection moves redraw the whole page (slow in the emulator).

Test: `node scripts\acwriter-edit.cjs [130xe|800xl]` (15 checks, screenshots in out\).
