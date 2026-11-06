// Builds the extended glyph table (codes 128..255, 8 bytes each, 4-bit rows with bit 3 = leftmost pixel)
// and writes sym.inc. 128..159 are the Atari graphics (5-bit rows, see below), 160..255 are Latin-1 (160 and 173 are handled in code).
// Usage: node tools/acwriter/mksym.cjs [dump]
const fs = require('fs');
const base = require('./font4.json');

const parse = (rows) => {
  const r = rows.map((s) => parseInt(s.replace(/#/g, '1').replace(/\./g, '0'), 2));
  while (r.length < 8) r.push(0);
  return r;
};
const ch = (c) => base[c.charCodeAt(0) - 32].slice();

const glyphs = new Array(128).fill(null).map(() => [0, 0, 0, 0, 0, 0, 0, 0]);

// Atari graphics 128..159 = ATASCII 0..31, taken from the Craft 5 px face (tools/atarigfx.cjs, drawn from scratch, no ROM data).
// Unlike the letters these rows are 5 bits wide: bit 4 = leftmost pixel .. bit 0 = the gap column, so lines and blocks touch the next cell.
// drawchar (word/text.inc) does not shift rows of codes 128..159 (they sit in page $0C of the SYM table).
const c5 = require('../acwfaces.cjs').load('craft5'), CF = require('../craftfont.cjs');
for (let a = 0; a < 32; a++) {
  const g = c5.glyphs[a], r = [];
  for (let y = 0; y < 8; y++) { let v = 0; for (let q = 0; q < 5; q++) if (CF.hasPx(c5, g[c5.head + y] || 0, q)) v |= 16 >> q; r.push(v); }
  glyphs[a] = r;
}
const acc2 = { acute: [2, 4], grave: [4, 2], circ: [6, 9], diaer: [9, 0], tilde: [5, 10], ring: [6, 6] };
const acc1 = { acute: 2, grave: 4, circ: 6, diaer: 9, tilde: 5, ring: 6 };
function accented(b, kind) {
  const g = ch(b);
  if (b >= 'A' && b <= 'Z') return [acc1[kind]].concat(g.slice(0, 7));
  if (g[1] !== 0 && b !== 'i') { g[0] = acc1[kind]; return g; }
  g[0] = acc2[kind][0];
  g[1] = acc2[kind][1];
  return g;
}

const L = {};
const put = (code, g) => { L[code] = g; };
const set = (str, b, kind, start) => { for (let i = 0; i < str.length; i++) put(start + i, accented(b[i], kind)); };
const accSet = (code, b, kind) => put(code, accented(b, kind));

// Latin-1 letters
[['À', 'A', 'grave'], ['Á', 'A', 'acute'], ['Â', 'A', 'circ'], ['Ã', 'A', 'tilde'], ['Ä', 'A', 'diaer'], ['Å', 'A', 'ring'],
 ['È', 'E', 'grave'], ['É', 'E', 'acute'], ['Ê', 'E', 'circ'], ['Ë', 'E', 'diaer'],
 ['Ì', 'I', 'grave'], ['Í', 'I', 'acute'], ['Î', 'I', 'circ'], ['Ï', 'I', 'diaer'], ['Ñ', 'N', 'tilde'],
 ['Ò', 'O', 'grave'], ['Ó', 'O', 'acute'], ['Ô', 'O', 'circ'], ['Õ', 'O', 'tilde'], ['Ö', 'O', 'diaer'],
 ['Ù', 'U', 'grave'], ['Ú', 'U', 'acute'], ['Û', 'U', 'circ'], ['Ü', 'U', 'diaer'], ['Ý', 'Y', 'acute'],
 ['à', 'a', 'grave'], ['á', 'a', 'acute'], ['â', 'a', 'circ'], ['ã', 'a', 'tilde'], ['ä', 'a', 'diaer'], ['å', 'a', 'ring'],
 ['è', 'e', 'grave'], ['é', 'e', 'acute'], ['ê', 'e', 'circ'], ['ë', 'e', 'diaer'],
 ['ì', 'i', 'grave'], ['í', 'i', 'acute'], ['î', 'i', 'circ'], ['ï', 'i', 'diaer'], ['ñ', 'n', 'tilde'],
 ['ò', 'o', 'grave'], ['ó', 'o', 'acute'], ['ô', 'o', 'circ'], ['õ', 'o', 'tilde'], ['ö', 'o', 'diaer'],
 ['ù', 'u', 'grave'], ['ú', 'u', 'acute'], ['û', 'u', 'circ'], ['ü', 'u', 'diaer'], ['ý', 'y', 'acute'], ['ÿ', 'y', 'diaer'],
].forEach(([c, b, k]) => accSet(c.charCodeAt(0), b, k));
{
  const c1 = ch('C'); c1[7] = 4; put(199, c1);
  const c2 = ch('c'); c2[7] = 4; put(231, c2);
}

const H = {
  161: ['.##.', '....', '.##.', '.##.', '.##.', '.##.', '.##.'],
  162: ['..#.', '.###', '#.#.', '#.#.', '#.#.', '.###', '..#.'],
  163: ['.##.', '#..#', '.#..', '###.', '.#..', '#..#', '####'],
  164: ['....', '#..#', '.##.', '.##.', '#..#', '....', '....'],
  165: ['#..#', '#..#', '.##.', '####', '.##.', '.##.', '.##.'],
  166: ['.##.', '.##.', '.##.', '....', '.##.', '.##.', '.##.'],
  167: ['.###', '#...', '.##.', '#..#', '.##.', '...#', '###.'],
  168: ['#..#', '....', '....', '....', '....', '....', '....'],
  169: ['.##.', '#..#', '#.##', '#.##', '#..#', '.##.', '....'],
  170: ['###.', '#.#.', '###.', '....', '###.', '....', '....'],
  171: ['....', '....', '.#.#', '#.#.', '.#.#', '....', '....'],
  172: ['....', '....', '####', '...#', '....', '....', '....'],
  174: ['.##.', '#.#.', '#.#.', '##..', '#.#.', '.##.', '....'],
  175: ['####', '....', '....', '....', '....', '....', '....'],
  176: ['.##.', '#..#', '.##.', '....', '....', '....', '....'],
  177: ['.##.', '.##.', '####', '.##.', '.##.', '....', '####'],
  178: ['##..', '..#.', '.#..', '###.', '....', '....', '....'],
  179: ['##..', '.##.', '..#.', '##..', '....', '....', '....'],
  180: ['..#.', '.#..', '....', '....', '....', '....', '....'],
  181: ['....', '....', '#..#', '#..#', '#..#', '###.', '#...'],
  182: ['.###', '####', '####', '.###', '..#.', '..#.', '..#.'],
  183: ['....', '....', '.##.', '.##.', '....', '....', '....'],
  184: ['....', '....', '....', '....', '....', '.#..', '.##.'],
  185: ['.#..', '##..', '.#..', '.#..', '###.', '....', '....'],
  186: ['.##.', '#..#', '.##.', '....', '###.', '....', '....'],
  187: ['....', '....', '#.#.', '.#.#', '#.#.', '....', '....'],
  188: ['#..#', '#.#.', '.#..', '.#.#', '##.#', '..##', '...#'],
  189: ['#..#', '#.#.', '.#..', '.#.#', '#..#', '..#.', '.###'],
  190: ['##.#', '.###', '.#..', '#.#.', '###.', '..#.', '..##'],
  191: ['..#.', '....', '..#.', '.#..', '#...', '#..#', '.##.'],
  198: ['.###', '#.#.', '#.##', '####', '#.#.', '#.#.', '#.##'],
  208: ['###.', '#.#.', '####', '#.#.', '#.#.', '#.#.', '###.'],
  215: ['....', '....', '#..#', '.##.', '#..#', '....', '....'],
  216: ['####', '#.##', '#.##', '##.#', '##.#', '#..#', '####'],
  222: ['#...', '####', '#..#', '#..#', '####', '#...', '#...'],
  223: ['.##.', '#..#', '#.#.', '#..#', '#..#', '#.#.', '#...'],
  230: ['....', '....', '####', '..##', '####', '#..#', '####'],
  240: ['.#.#', '..#.', '.###', '#..#', '#..#', '#..#', '.##.'],
  247: ['....', '.##.', '....', '####', '....', '.##.', '....'],
  248: ['....', '....', '####', '#.##', '##.#', '#..#', '####'],
  254: ['#...', '#...', '###.', '#..#', '#..#', '###.', '#...'],
};
for (const k of Object.keys(H)) put(+k, parse(H[k]));

for (let c = 160; c < 256; c++) if (L[c]) glyphs[c - 128] = L[c];

let out = '; generated by mksym.cjs - do not edit (codes 128..255, 8 bytes each)\n';
for (let i = 0; i < 128; i += 2) out += ' dta b(' + glyphs[i].concat(glyphs[i + 1]).join('),b(') + ')\n';
fs.writeFileSync(__dirname + '/sym.inc', out.replace(/\n/g, '\r\n'));
// padded to 8 rows per glyph, for the web editor (sym.inc keeps the 7-row glyphs as they are, which shifts the table)
fs.writeFileSync(__dirname + '/sym.json', JSON.stringify(glyphs.map((g) => g.concat([0, 0, 0, 0, 0, 0, 0, 0]).slice(0, 8))));
if (process.argv[2] === 'dump') {
  for (let c = 128; c < 256; c++) {
    if (c === 160 || c === 173) continue;
    console.log(c, glyphs[c - 128].map((b) => b.toString(2).padStart(4, '0').replace(/0/g, '.').replace(/1/g, '#')).join(' '));
  }
}
console.log('ok');
