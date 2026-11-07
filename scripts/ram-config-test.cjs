// RAM configuration test: Compy-Shop 192K, Axlon 2096K/4144K, the disabled ACX 8192K entry, per-core dropdown, persistence.
// Usage: node scripts/ram-config-test.cjs
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const ROOT = 'C:/Users/raver/ataricraft';
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };

// Tiny label-resolving byte builder: strings are labels, '>x' is a relative branch to label x, a bare 'x' is an absolute address of x.
function xex(items, org) {
  const L = {}, out = [], fix = [];
  for (const it of items) {
    if (typeof it === 'string') { L[it] = out.length; continue; }
    for (const b of it) {
      if (typeof b === 'string') { fix.push([out.length, b]); out.push(0); if (b[0] !== '>') out.push(0); } else out.push(b);
    }
  }
  for (const [pos, name] of fix) {
    if (name[0] === '>') out[pos] = (L[name.slice(1)] - (pos + 1)) & 255;
    else { const a = org + L[name]; out[pos] = a & 255; out[pos + 1] = a >> 8; }
  }
  const end = org + out.length - 1;
  return [0xFF, 0xFF, org & 255, org >> 8, end & 255, end >> 8, ...out, 0xE0, 0x02, 0xE1, 0x02, org & 255, org >> 8];
}
// Axlon bank register at $CFFF. Writes bank number r (and its complement at the window end) into every bank r=0..255,
// then reads every bank back: $600/$601 = number of banks that kept their own data (aliased banks overwrite each other).
const axlonProg = () => xex([
  [0x78, 0xA9, 0, 0x8D, 0x0E, 0xD4, 0x8D, 0, 6, 0x8D, 1, 6, 0x8D, 2, 6, 0xA2, 0], 'w',
  [0x8E, 0xFF, 0xCF, 0x8A, 0x8D, 0, 0x40, 0x49, 0xFF, 0x8D, 0xFF, 0x7F, 0xE8, 0xD0, '>w', 0xA2, 0], 'r',
  [0x8E, 0xFF, 0xCF, 0x8A, 0xCD, 0, 0x40, 0xD0, '>n', 0x49, 0xFF, 0xCD, 0xFF, 0x7F, 0xD0, '>n', 0xEE, 0, 6, 0xD0, '>n', 0xEE, 1, 6], 'n',
  [0xE8, 0xD0, '>r', 0xA9, 0, 0x8D, 0xFF, 0xCF, 0xA9, 1, 0x8D, 2, 6], 's', [0x4C, 's'],
], 0x2000);

async function open(b, core, model, rom, ram) {
  const p = await (await b.newContext()).newPage();
  p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/' + rom, ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.selectOption('#model', model); await p.selectOption('#core', core);
  if (ram) await p.selectOption('#ram', ram);
  return p;
}
const opts = (p) => p.evaluate(() => [...document.getElementById('ram').options].map((o) => ({ v: o.value, d: o.disabled, t: o.title, sel: o.selected })));
const OS800 = 'Atari 400_800 rev B ntsc.rom';

(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });

  // ---- Axlon 2096 / 4144 on the Atari800 core: bank register $CFFF, count banks that keep distinct data
  for (const [ram, want] of [['ax2096', 128], ['ax4144', 256], ['48', 1]]) {
    const p = await open(b, 'atari800', '800', OS800, ram);
    await p.click('#boot'); await p.waitForTimeout(3500);
    await p.evaluate(async (by) => { await ataricraft.bootFile('AXL.XEX', Uint8Array.from(by)); }, axlonProg());
    await p.waitForTimeout(3000);
    const r = await p.evaluate(() => ataricraft.peek(0x600, 3));
    ok(r[2] === 1 && r[0] + (r[1] << 8) === want, `atari800 800 ${ram}: ${want} distinct 16K banks behind $CFFF`, r);
    ok(p.errs.length === 0, `atari800 ${ram}: no page errors`, p.errs);
    await p.context().close();
  }

  // ---- Compy-Shop 192K: in-guest PORTB bank test (finds the banks, fills/verifies each with its own pattern)
  for (const [ram, want] of [['192', 8], ['128', 4]]) {
    const p = await open(b, 'atari800', '800xl', 'ATARIXL.ROM', ram);
    await p.click('#boot'); await p.waitForTimeout(3500);
    await p.evaluate(async () => { await ataricraft.bootFile('MEMTEST.XEX', AC.MemTest.program()); });
    let st = null;
    for (let i = 0; i < 240; i++) { await p.waitForTimeout(1000); st = await p.evaluate(() => AC.MemTest.read(FujiNet.emu)); if (st.done) break; }
    ok(st && st.done && st.errors === 0 && st.found === want && st.mainIntact, `atari800 800xl ${ram}K: PORTB test finds ${want} banks, 0 errors, main window intact`, st);
    await p.context().close();
  }

  // ---- dropdown per core, and ACX 8192 refuses to boot
  {
    const p = await open(b, 'atari800', '800xl', 'ATARIXL.ROM', '192');
    let o = await opts(p);
    const by = (v) => o.find((x) => x.v === v);
    ok(by('192') && !by('192').d && by('192').sel, 'atari800: 192 enabled and selected');
    ok(by('acx8192') && by('acx8192').d && /4 MB/.test(by('acx8192').t), 'atari800: ACX 8192 listed but disabled with a tooltip', by('acx8192'));
    ok(!by('ax2096'), 'XL machines do not list Axlon');
    await p.selectOption('#core', 'altirra'); o = await opts(p);
    ok(by('192').d && /192/.test(by('192').t), 'altirra: 192 disabled with a reason', by('192'));
    ok(by('acx8192').d && by('1088') && !by('1088').d && !by('128').d && !by('320c').d, 'altirra: ACX disabled; 128/320/1088 enabled');
    ok(!by('192').sel && by('64').sel, 'altirra: selection fell back to the model default', o.filter((x) => x.sel));
    await p.selectOption('#core', 'atari800'); o = await opts(p);
    ok(by('192').sel && !by('192').d, 'back on atari800: 192 selection restored');
    // persistence of the choice
    await p.reload(); await p.waitForTimeout(500);
    ok(await p.evaluate(() => document.getElementById('ram').value) === '192', 'RAM choice 192 persists across a reload');
    // ACX refuses to boot (forced past the disabled state)
    await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
        await p.waitForTimeout(2500);
        await p.evaluate(() => { const s = document.getElementById('ram'); s.value = 'acx8192'; });
        await p.click('#boot'); await p.waitForTimeout(2500);
    const msg = await p.evaluate(() => document.getElementById('status').textContent);
    ok(/ACX 8192/.test(msg) && /cannot|no 8 MB/.test(msg), 'ACX 8192 boot gives a clear message', msg);
    await p.context().close();
  }
  {
    const p = await open(b, 'atari800', '800', OS800, 'ax4144');
    let o = await opts(p);
    ok(o.some((x) => x.v === 'ax2096' && !x.d) && o.some((x) => x.v === 'ax4144' && !x.d && x.sel), 'atari800 800: Axlon 2096/4144 enabled');
    await p.selectOption('#core', 'altirra'); o = await opts(p);
    ok(o.filter((x) => /^ax|^acx/.test(x.v)).every((x) => x.d && x.t), 'altirra 800: Axlon and ACX disabled with tooltips');
    ok(o.find((x) => x.v === '48').sel, 'altirra 800: fell back to 48 KB');
    await p.selectOption('#core', 'atari800'); o = await opts(p);
    ok(o.find((x) => x.v === 'ax4144').sel, 'back on atari800: Axlon 4144 restored');
    await p.context().close();
  }
  // ---- Altirra still boots its supported sizes
  for (const ram of ['128', '1088']) {
    const p = await open(b, 'altirra', '800xl', 'ATARIXL.ROM', ram);
    await p.click('#boot'); await p.waitForTimeout(4000);
    const f0 = await p.evaluate(() => FujiNet.emu.frames); await p.waitForTimeout(1000);
    const f1 = await p.evaluate(() => FujiNet.emu.frames);
    ok(f1 > f0 + 10 && p.errs.length === 0, `altirra ${ram}K boots and runs`, { f0, f1, e: p.errs });
    await p.context().close();
  }
  await b.close();
  console.log(bad ? `RAM CONFIG FAIL (${bad})` : 'RAM CONFIG PASS');
  process.exit(bad ? 1 : 0);
})();
