// ACWriter document segments (banks above 3): a CRFT file longer than DOC (11264 bytes) opens as segments kept in
// banks 4+, ^N / ^O move between them, Save writes them back to one file. Run on 128K (must refuse), 320K and 1088K.
// State: sg_n $07E6, sg_c $07E7, cmsg $AC.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/raver/ataricraft';
const CASES = [['128', 0], ['320r', 3], ['1088', 3]];

const lines = []; for (let i = 0; i < 440; i++) lines.push('L' + String(i).padStart(3, '0') + ' the quick brown fox jumps over the lazy dog again and again');
const body = Buffer.from(lines.join('\r') + '\r', 'latin1');
const cwd = (payload) => {
  const h = Buffer.alloc(16); h.write('CRFT', 0, 'latin1'); h[4] = 1; h[5] = 0x57; h[6] = 0;
  h.writeUInt16LE(payload.length, 8); h[12] = 64; h[13] = 20;
  let s = 0; for (const b of payload) s = (s + b) & 0xFFFF; h.writeUInt16LE(s, 14);
  return Buffer.concat([h, payload]);
};
// same cut as the 6502: pieces of at most 10240 bytes, ending after the last hard return
const cuts = (buf) => {
  const out = []; let rest = buf;
  while (rest.length) {
    if (rest.length <= 10240) { out.push(rest); break; }
    const k = rest.subarray(0, 10240).lastIndexOf(13) + 1; out.push(rest.subarray(0, k)); rest = rest.subarray(k);
  }
  return out;
};

(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  let fails = 0;
  const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, extra); };
  for (const [ram, wantSeg] of CASES) {
    console.log('--- RAM ' + ram);
    const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('file:///' + ROOT + '/web/index.html');
    await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
    await p.selectOption('#model', '130xe').catch(() => {});
    await p.selectOption('#ram', ram).catch(() => {});
    await p.click('#boot'); await p.waitForTimeout(3000);
    const bytes = Array.from(fs.readFileSync(ROOT + '/tools/acwriter/poc5.xex'));
    await p.evaluate((a) => FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)), bytes);
    await p.waitForTimeout(3000);
    await p.locator('canvas').first().click();
    await p.waitForTimeout(10000); await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
    const big = cwd(body);
    await p.evaluate((a) => FujiNet.emu.hostWrite('SEG.CWD', new Uint8Array(a)), Array.from(big));
    const key = async (k, w = 900) => { await p.keyboard.press(k); await p.waitForTimeout(w); if (k.startsWith('Control+')) { await p.keyboard.press('Shift'); await p.waitForTimeout(400); } };
    const type = async (s) => { for (const ch of s) await key(ch === ' ' ? 'Space' : ch === ':' ? 'Shift+Semicolon' : ch === '.' ? 'Period' : ch, 2500); await p.waitForTimeout(3000); };
    const menu = async (...ks) => { await key('Escape'); for (const k of ks) await key(k, 700); await p.waitForTimeout(1200); };
    const peek = (a, n = 1) => p.evaluate(([x, m]) => Array.from(ataricraft.peek(x, m)), [a, n]);
    const state = async () => { const [n, c] = await peek(0x07E6, 2); return { n, c, msg: (await peek(0xAC))[0], dend: (await peek(0xA6, 2)) }; };
    const docHead = async () => Buffer.from(await peek(0x6400, 10)).toString('latin1');

    const waitMsg = async (ms = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await peek(0xAC))[0]) return; await p.waitForTimeout(500); } };
    const go = async () => { await p.evaluate(() => ataricraft.poke(0xAC, 0)); await key('Enter', 500); await waitMsg(); await p.waitForTimeout(800); };

    await key('ArrowDown', 900);
    await menu('f', 'o'); await type('h:seg'); await go();
    let s = await state();
    const parts = cuts(body);
    if (wantSeg === 0) {
      check('128K: big file refused, no segments', s.n === 0, 'sg_n=' + s.n + ' msg=' + s.msg);
      await key('Control+n', 1200); s = await state();
      check('128K: ^N says no banks (msg 46)', s.msg === 46, 'msg=' + s.msg);
    } else {
      check('opens as ' + parts.length + ' segments', s.n === parts.length && s.c === 0, 'sg_n=' + s.n + ' sg_c=' + s.c + ' msg=' + s.msg);
      check('segment 1 starts with the first line', (await docHead()).startsWith('L000 the'), JSON.stringify(await docHead()));
      await key('Control+n', 2500); s = await state();
      check('^N moves to segment 2', s.c === 1, 'sg_c=' + s.c + ' msg=' + s.msg);
      const first2 = parts[1].subarray(0, 4).toString('latin1');
      check('segment 2 starts where segment 1 ended', (await docHead()).startsWith(first2), JSON.stringify(await docHead()) + ' want ' + first2);
      await type('ab'); await p.screenshot({ path: ROOT + '/out/shots/segty-' + ram + '.png' }); console.log('  after typing', JSON.stringify(await docHead()), JSON.stringify(await peek(0x07E6,2)));
      await key('Control+n', 2500); s = await state();
      check('^N moves to segment 3', s.c === 2, 'sg_c=' + s.c);
      await key('Control+n', 1500); s = await state();
      check(parts.length === 3 ? '^N at the last asks for a fourth (new empty segment)' : '^N past the end', s.n === parts.length + 1 && s.c === parts.length, 'sg_n=' + s.n + ' sg_c=' + s.c);
      await key('Control+o', 2500); s = await state();
      check('^O goes back', s.c === parts.length - 1, 'sg_c=' + s.c);
      await key('Control+o', 2500); s = await state();
      check('^O to segment 2 keeps the typed text', s.c === 1 && (await docHead()).toLowerCase().startsWith('ab' + first2.toLowerCase()), JSON.stringify(await docHead()));

      await menu('f', 'a'); await type('h:segout'); await go();
      const files = await p.evaluate(() => Object.fromEntries(Object.entries(FujiNet.emu.hostFiles()).map(([k, v]) => [k, Array.from(v)])));
      const key2 = Object.keys(files).find((k) => /^SEGOUT/i.test(k));
      if (!key2) check('saved file exists', false, Object.keys(files).join());
      else {
        const out = Buffer.from(files[key2]);
        const exp = Buffer.concat([parts[0], Buffer.from('AB'), ...parts.slice(1)]);
        let want = exp; while (want.length && want[want.length - 1] === 0) want = want.subarray(0, -1);
        const len = out.readUInt16LE(8);
        const payload = Buffer.from(out.subarray(16, 16 + len)).map((x) => (x === 14 ? 32 : x)); // soft wrap marks
        // the empty fourth segment adds nothing, so the payload is the original with 'ab' inserted
        check('saved payload = original + typed text', payload.equals(exp), 'len=' + len + ' want ' + exp.length);
        if (!payload.equals(exp)) { let d = 0; while (d < payload.length && payload[d] === exp[d]) d++; console.log('  first diff at', d, JSON.stringify(payload.subarray(Math.max(0, d - 6), d + 12).toString('latin1')), 'want', JSON.stringify(exp.subarray(Math.max(0, d - 6), d + 12).toString('latin1'))); }
        console.log('  AB at', payload.indexOf('AB'), payload.indexOf('ab'), payload.indexOf('abA')); let sum = 0; for (const x of out.subarray(16, 16 + len)) sum = (sum + x) & 0xFFFF;
        check('header checksum matches', out.readUInt16LE(14) === sum);
      }
      await key('Control+o', 2500); await key('Control+o', 2500);
      await menu('f', 'o'); await type('h:segout'); await go();
      s = await state();
      check('saved file reopens as ' + parts.length + ' segments', s.n === parts.length && s.c === 0, 'sg_n=' + s.n + ' sg_c=' + s.c);
      await key('Control+n', 2500);
      check('reopened segment 2 holds the typed text', (await docHead()).startsWith('AB' + parts[1].subarray(0, 4).toString('latin1')), JSON.stringify(await docHead()));
    }
    await p.screenshot({ path: ROOT + '/out/shots/seg-' + ram + '.png' });
    check('no page errors', errs.length === 0, errs.join(';'));
    await p.close();
  }
  await b.close(); process.exit(fails ? 1 : 0);
})();
