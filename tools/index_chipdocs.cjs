// Walks the archive and indexes hardware/chip-document candidates. Output: out/chipdocs_index.csv + summary.
const fs = require('fs'), path = require('path');
const root = process.argv[2] || 'I:\\Online_Archives_A-Z';
const docExt = new Set(['.pdf', '.txt', '.doc', '.docx', '.htm', '.html', '.rtf', '.ps', '.md', '.djvu', '.tif', '.tiff', '.chm']);
const chips = /\b(antic|gtia|ctia|pokey|pia|6502|65c02|65c816|6510|6522|6532|6551|sally|fgtia|mmu|freddie|rapidus|u1mb|vbxe|covox|xep80|corvus|mcs65|mos|tia|riot|maria|tia|mikey|suzy|lynx|jaguar|tom|jerry|blitter|shifter|glue|mmu|mfp|68901|68000|68030|68881|68882|ym2149|ay-3-8910|wd1772|wd177|wd279|1770|1772|2793|mc6850|6850|acia|midi|yamaha|ste|falcon|videl|dsp|56001|lisa|blossom|dma|fdc|rom|schematic|service ?manual|field ?service|hardware ?manual|technical ?reference|tech(nical)? ?ref|datasheet|data ?sheet|pinout|memory ?map|os ?listing|source ?listing|de ?re ?atari|cio|sio|pbi|ecI|xl|xe|800|1200|130|5200|7800|2600|520|1040|mega|tt030|tt|stacy|stbook|portfolio)\b/i;
const strong = /(antic|gtia|ctia|pokey|schematic|service ?manual|field ?service|hardware ?manual|technical ?ref|datasheet|data ?sheet|pinout|mcs65|6502|65c816|68000|68030|56001|videl|shifter|blitter|jaguar|mikey|suzy|maria|de ?re ?atari|os ?listing|memory ?map|ym2149|wd17|1772|68901|mfp)/i;
const rows = []; const stats = { dirs: 0, files: 0, docs: 0, cand: 0, strong: 0, errors: 0 };
const byExt = {};
function walk(d) {
  let ents;
  try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { stats.errors++; return; }
  stats.dirs++;
  for (const e of ents) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    stats.files++;
    const ext = path.extname(e.name).toLowerCase();
    byExt[ext] = (byExt[ext] || 0) + 1;
    if (!docExt.has(ext)) continue;
    stats.docs++;
    const hay = p.slice(root.length);
    const s = strong.test(hay), c = chips.test(hay);
    if (!c && !s) continue;
    if (s) stats.strong++; else stats.cand++;
    let size = 0; try { size = fs.statSync(p).size; } catch (_) {}
    rows.push([s ? 'strong' : 'maybe', ext, size, p]);
    if (stats.files % 50000 === 0) console.error(JSON.stringify(stats));
  }
}
walk(root);
fs.mkdirSync(path.join(__dirname, '..', 'out'), { recursive: true });
const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
fs.writeFileSync(path.join(__dirname, '..', 'out', 'chipdocs_index.csv'), 'confidence,ext,size,path\n' + rows.map((r) => r.map(q).join(',')).join('\n'));
const top = Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 25);
console.log(JSON.stringify({ stats, topExt: top }, null, 1));
