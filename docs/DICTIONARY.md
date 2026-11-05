# Craft dictionary format (CDIC)

A compact, machine-independent spelling dictionary: a **Bloom filter** (a bit table that answers "probably a word" or
"definitely not a word") with a 24-byte header, plus an optional exact word list for machines with more memory.
The Atari 8-bit ACWriter reads it (Search > Spell check, see [SPELL.md](SPELL.md)); the same file is meant for a C64
port and the web "xCWriter". Library and builder: `tools/cdict.cjs`, `tools/mkdict.cjs`; desktop checker:
`tools/spellcheck.cjs`; tests: `scripts/test-dict.cjs`, `scripts/dict-fp.cjs`.

## Byte layout (all numbers little-endian)

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | magic `CDIC` |
| 4 | 1 | version = 1 |
| 5 | 1 | hash id = 1 (the hash below) |
| 6 | 1 | k, number of probes per word (1..15) |
| 7 | 1 | flags: bit 0 = an exact tier follows the bit table |
| 8 | 4 | bit count m, a power of two (8192 .. 2^32) |
| 12 | 4 | word count |
| 16 | 4 | language, ASCII, zero padded (`en`) |
| 20 | 4 | offset of the exact tier from the file start, 0 = none |
| 24 | m/8 | bit table. Bit i is bit (i AND 7) of byte (i >> 3) |
| ... | | exact tier (optional) |

`m` is a power of two so a probe index is reduced with a mask; no division is needed on a 6502.
The shipped ACWriter limit is a 16 KB table (m = 131072) because that is one 130XE bank.

## Words

A word is the letters a-z (case folded) and apostrophes. Letters have code 1..26 (`a`=1), the apostrophe has code 27.
Leading and trailing apostrophes are dropped when building. Other characters (digits, accents, hyphens) are not part of a
word; version 1 is English/ASCII only. Contractions are stored as words (`don't`).
Possessives are *not* stored: when a word is not found and ends in `'s`, the word without it is tried (`dog's` -> `dog`);
a word ending in `s'` is tried without the final apostrophe (`dogs'` -> `dogs`).

## Hash (id 1)

32-bit unsigned arithmetic, wrapping:

```
x = 0x9E3779B9
for each letter: x = rotl32(x, 5) XOR code
x = x XOR (x << 16)                  // the low half is mixed into the high half
h1 = x,  h2 = (x >> 16) OR 1          // h2 is odd 16 bits
probe[i] = (h1 + i*h2) AND (m-1),  i = 0 .. k-1      (each probe = previous + h2)
```

A word is "known" when all k bits are set. On a 6502 `rotl32(x,5)` is five ROL passes over four bytes
(carry fed back into bit 0), the XOR is `x2 ^= x0; x3 ^= x1`, and each probe is one 24-bit add of h2.
`tools/cdict.cjs` and `tools/acwriter/word/spell.inc` implement exactly this.

### Test vectors (m = 131072, k = 5)

| word | x (hex) | probes |
|---|---|---|
| `ab` | 3bbce65a | 58970 74263 89556 104849 120142 |
| `cat` (and `CAT`) | 7ff3c32f | 115503 17186 49941 82696 115451 |
| `the` | 22c29e1e | 40478 49377 58276 67175 76074 |
| `dont` | 4538dea3 | 56995 74716 92437 110158 127879 |
| `a's` | 74b4c868 | 51304 81181 111058 9863 39740 |
| `Atari` | 1b9c68ba | 26810 33879 40948 48017 55086 |
| `zzzzzzzzzzzz` | 67324617 | 17943 44362 70781 97200 123619 |

`scripts/test-dict.cjs` checks these.

## Exact tier (optional, `--exact`)

For machines that can hold a word list (the web version). Sorted words, each as
`[shared prefix length][suffix length][suffix bytes]`, ended by `FF FF`. Lookup is a plain set test, no false positives.
The 15k-word list is about 67 KB, too big for an Atari, so the shipped samples have no exact tier.

## Building

```
node tools/mkdict.cjs WORDLIST.txt OUT.CDC [--bytes N] [--k N] [--lang en] [--exact] [--only RANKLIST] [--extra LIST]
```

`--bytes` is the table size (power of two, default 16384). `--only` keeps only words also in another list (used as a
frequency filter), `--extra` adds words. The expected false-positive rate printed is `fill^k`; the real one is measured
by `node scripts/dict-fp.cjs DICT.CDC enable1.txt`.

## The shipped dictionaries

`docs/samples/EN.CDC` (16,408 bytes: 24 header + 16,384 table) and `EN8.CDC` (8,216 bytes, for a stock 64K machine,
see SPELL.md). Built with:

```
curl -L -o enable1.txt https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt
curl -L -o 20k.txt https://raw.githubusercontent.com/first20hours/google-10000-english/master/20k.txt
curl -L -o 10k.txt https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt
node tools/mkdict.cjs enable1.txt docs/samples/EN.CDC  --only 20k.txt --extra tools/dict-en-extra.txt --k 5
node tools/mkdict.cjs enable1.txt docs/samples/EN8.CDC --only 10k.txt --extra tools/dict-en-extra.txt --bytes 8192 --k 5
```

Sources and licences:

* **ENABLE** (`enable1.txt`, 172,823 words): public domain. Every word in the dictionaries comes from it.
* **google-10000-english** by Josh Kaufman (`20k.txt`, `google-10000-english-no-swears.txt`): derived from the Google
  Web Trillion Word Corpus (LDC); its repository says educational and personal/research use is permitted and recommends
  licensing for commercial use. It is used here only as a *frequency ranking* to choose which ENABLE words fit; no word
  outside ENABLE (plus the extras) is taken from it. Anyone redistributing commercially should substitute their own ranking.
* `tools/dict-en-extra.txt`: about 60 contractions and a few modern words, written for this project (public domain).

So the dictionary holds the 15,181 most common English words that ENABLE knows (plus contractions). Rarer words, proper
names and words ENABLE lacks (for example `deletes`, `bitmaps`, `Ctrl`) are reported as unknown; the Add key
in ACWriter ignores them for the session.

## Measured accuracy (`scripts/dict-fp.cjs`)

Words in the dictionary are always accepted (no false negatives). A **false positive** is a non-word that passes.

| File | Words | Random 3-10 letter strings accepted | Single-letter misspellings accepted |
|---|---|---|---|
| EN.CDC (16 KB table, k=5) | 15,181 | 1.58% (3143 of 198,364) | 1.89% (19,816 of 1,046,718) |
| EN8.CDC (8 KB table, k=5) | 8,183 | 2.00% | 2.74% |

Misspellings are all deletes, swaps, replacements and insertions of 3000 random dictionary words that ENABLE does not
contain. The measured rate is above the textbook `fill^k` (1.13%) because probes of one word share the step h2, so they
are not fully independent. Roughly: about 1 misspelling in 50 is not caught.
The other error is on the dictionary side: a correct word outside the 15k most common ones is flagged.
