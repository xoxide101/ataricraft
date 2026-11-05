# ACWriter spell checker

Search > Spell check (or ^K) walks the document from the cursor and tests each
word against a CDIC dictionary (see DICTIONARY.md). The 6502 hash and probe
match `tools\cdict.cjs` exactly; `node tools\spellcheck.cjs FILE` gives the
same unknown words as the in-app checker.

## Prompt keys
- I / N / Return: ignore, next word
- A: add to the session ignore list (32 words, lost on reboot)
- 1-5: replace with a suggestion (initial capital kept)
- Esc: stop (cursor stays at the word)

Suggestions are single-letter deletes and adjacent transpositions only;
inserts and substitutions are not implemented. Suggestions can be valid but
unwanted words.

## Dictionary
Default file is `D1:EN.CDC`, then `H:EN.CDC`. Search > Dictionary (D) sets
another name. Samples: `docs/samples/EN.CDC` (16 KB, ~1.6% false positives
on random strings) and `EN8.CDC` (8 KB, ~2%).

## Memory (honest constraints)
- 130XE: the table goes into an extended bank (bank detected at start).
- Stock 64K: the table sits just below $9000 and is freed after the check;
  it fits only if the document is small (EN8 with a doc under ~5 KB).
- To make room the document area moved from $5000 to $6000: the maximum
  document is now 12 KB.
- Bank detection was only tested in the emulator, not on real hardware.

Words checked: letters and inner apostrophes; numbers, 1-letter words and
words over 24 letters are skipped; `'s` and `s'` possessives accepted.
