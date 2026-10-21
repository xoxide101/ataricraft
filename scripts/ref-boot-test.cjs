// Boots the libatari800 reference in Node with user-supplied ROMs and reports a few frames.
// Usage: node scripts/ref-boot-test.cjs [romDir]
const fs = require('fs');
const path = require('path');

const romDir = process.argv[2] || path.join(__dirname, '..', 'software_n_roms');
const AtariRef = require('../web/ref/atari-ref.js');

function cstr(m, s) {
  const b = Buffer.from(s + '\0', 'utf8');
  const p = m._malloc(b.length);
  m.HEAPU8.set(b, p);
  return p;
}

AtariRef().then((m) => {
  m.FS.writeFile('/ATARIXL.ROM', fs.readFileSync(path.join(romDir, 'ATARIXL.ROM')));
  m.FS.writeFile('/ATARIBAS.ROM', fs.readFileSync(path.join(romDir, 'ATARIBAS.ROM')));

  const args = ['atari800', '-atari', '-xl', '-xlxe_rom', '/ATARIXL.ROM', '-basic_rom', '/ATARIBAS.ROM', '-basic'];
  const argv = m._malloc(args.length * 4);
  args.forEach((a, i) => m.HEAPU32 ? m.HEAPU32[(argv >> 2) + i] = cstr(m, a) : new DataView(m.HEAPU8.buffer).setUint32(argv + i * 4, cstr(m, a), true));

  const ok = m.ccall('libatari800_init', 'number', ['number', 'number'], [args.length, argv]);
  console.log('init ->', ok, '|', m.ccall('libatari800_error_message', 'string', [], []));

  const input = m._malloc(64);
  m.HEAPU8.fill(0, input, input + 64);
  m.ccall('libatari800_clear_input_array', null, ['number'], [input]);

  for (let i = 0; i < 180; i++) m.ccall('libatari800_next_frame', 'number', ['number'], [input]);

  const scr = m.ccall('libatari800_get_screen_ptr', 'number', [], []);
  const frame = m.ccall('libatari800_get_frame_number', 'number', [], []);
  const px = m.HEAPU8.slice(scr, scr + 384 * 240);
  const hist = {};
  px.forEach((v) => { hist[v] = (hist[v] || 0) + 1; });
  const colours = Object.keys(hist).length;
  console.log('frame', frame, '| distinct palette indices on screen:', colours);
  console.log('PASS =', ok && colours > 1);
});
