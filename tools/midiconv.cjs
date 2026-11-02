// Convert a Standard MIDI File (format 0 or 1) to a POKEY music file for MIDIPLAY.COM.
//   node tools/midiconv.cjs <in.mid> [--out NAME.PMD] [--pal] [--drums] [--nodrums]
// 4 voices (one POKEY, pure tones, 64 kHz clock). Notes below about B2 are moved up octaves, too high ones down.
// The player routes the same data to the left POKEY, the right POKEY, or both.
// The conversion lives in web/js/pmd.js, shared with the browser workbench (web/workbench.html).
const fs = require('fs'), path = require('path');
const { convert } = require('../web/js/pmd.js');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const input = args[0];
if (!input || input.startsWith('--')) { console.log('usage: node tools/midiconv.cjs <in.mid> [--out NAME.PMD] [--pal] [--nodrums]'); process.exit(1); }
let r;
try { r = convert(new Uint8Array(fs.readFileSync(input)), { pal: args.includes('--pal'), drums: !args.includes('--nodrums') }); } catch (e) { console.log(e.message); process.exit(1); }
const dest = opt('--out', path.basename(input, path.extname(input)).replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() + '.PMD');
fs.writeFileSync(dest, r.pmd);
console.log(`${dest}: ${r.seconds.toFixed(1)} s, ${r.notes} notes (${r.dropped} stolen or dropped for the 4-voice limit), ${r.records} records, ${r.pmd.length} bytes${r.tooBig ? '  TOO BIG for the player (30720 max)' : ''}`);
