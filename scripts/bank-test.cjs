// Extended-RAM bank viewer end to end. For each core and RAM size: run the in-guest bank test (it leaves every bank filled with a known
// address/bank pattern), then use AC.Inspect.banks (resident monitor + VBI hook) to find, read, write and search the banks from the page.
// Usage: node scripts/bank-test.cjs [quick]    ("quick" runs 128K and 1088K only)
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const ROOT = 'C:/Users/raver/ataricraft';
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
const CASES = [['atari800', '128', 4], ['atari800', '320r', 16], ['atari800', '576', 32], ['atari800', '1088', 64], ['altirra', '128', 0]]
  .filter((c) => process.argv[2] !== 'quick' || c[1] === '128' || c[1] === '1088');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  for (const [core, ram, want] of CASES) {
    const tag = `${core} ${ram}K`;
    const p = await (await b.newContext()).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('file:///' + ROOT + '/web/index.html');
    await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
    await p.selectOption('#model', '130xe'); await p.selectOption('#core', core); await p.selectOption('#ram', ram);
    await p.click('#boot'); await p.waitForTimeout(3500);
    if (core === 'altirra') {
      const msg = await p.evaluate(() => { try { AC.Inspect.banks.probe(); return ''; } catch (e) { return e.message; } });
      ok(/libatari800/.test(msg), `${tag}: clear error that banks need the libatari800 core`, msg);
      await p.context().close(); continue;
    }
    await p.evaluate(async () => { await ataricraft.bootFile('MEMTEST.XEX', AC.MemTest.program()); });
    let st = null;
    for (let i = 0; i < 240; i++) { await p.waitForTimeout(1000); st = await p.evaluate(() => AC.MemTest.read(FujiNet.emu)); if (st.done) break; }
    ok(st && st.done && st.errors === 0 && st.found === want, `${tag}: in-guest bank test finished clean with ${want} banks`, st);
    if (!(st && st.done)) { await p.context().close(); continue; }
    const r = await p.evaluate(() => {
      const I = AC.Inspect.banks, emu = FujiNet.emu, out = {};
      const win0 = Array.from(emu.mem().slice(0x4000, 0x8000));
      const f0 = emu.frames;
      const list = I.probe(); out.n = list.length; out.page = I.page();
      // pattern written by the memtest: byte = y ^ page ^ bank ^ $FF for pages $40-$7F except $50-$57
      let badBytes = 0, checked = 0;
      for (const bk of list) {
        const d = I.read(bk.n);
        for (let pg = 0x40; pg < 0x80; pg++) { if (pg >= 0x50 && pg < 0x58) continue; for (let y = 0; y < 256; y++) { checked++; if (d[(pg - 0x40) * 256 + y] !== ((y ^ pg ^ bk.n ^ 0xFF) & 255)) badBytes++; } }
      }
      out.checked = checked; out.bad = badBytes;
      out.winSame = Array.from(emu.mem().slice(0x4000, 0x8000)).every((v, i) => v === win0[i]);
      out.frames = emu.frames - f0;
      // write / read back / persistence, then restore
      const last = list.length - 1, orig = I.read(1, 0x100, 4), orig0 = I.read(0, 0x100, 4);
      I.write(1, 0x100, [0xDE, 0xAD, 0xBE, 0xEF]);
      out.wr = Array.from(I.read(1, 0x100, 4)); out.b0 = Array.from(I.read(0, 0x100, 4)); out.b0same = out.b0.join() === Array.from(orig0).join();
      out.found = I.find('DE AD BE EF', 8); out.findText = I.find('\u00ff\u00ff', 1).length;
      I.write(1, 0x100, orig); out.restored = Array.from(I.read(1, 0x100, 4)).join() === Array.from(orig).join();
      const sc = I.scan(); out.scan = sc.length; out.scanPages = sc[last].pages.length;
      out.alive = emu.frames > f0 + 10;
      return out;
    });
    ok(r.n === want, `${tag}: monitor finds ${want} banks`, { n: r.n, page: r.page });
    ok(r.checked > 0 && r.bad === 0, `${tag}: every byte of every bank matches the pattern (${r.checked} bytes)`, { bad: r.bad });
    ok(r.winSame, `${tag}: the normal $4000-$7FFF window is untouched after reading all banks`);
    ok(r.wr && r.wr.join() === '222,173,190,239', `${tag}: write then read back`, r.wr);
    ok(r.b0same, `${tag}: writing bank 1 leaves bank 0 alone`);
    ok(r.found.length === 1 && r.found[0].bank === 1 && r.found[0].offset === 0x100, `${tag}: find locates the written bytes`, r.found);
    ok(r.restored, `${tag}: original bytes restored`);
    ok(r.scan === want && r.scanPages === 64, `${tag}: scan covers every bank`, { scan: r.scan });
    ok(r.alive, `${tag}: emulator still running`);
    ok(errs.length === 0, `${tag}: no page errors`, errs.slice(0, 2));
    await p.context().close();
  }
  await b.close();
  console.log(bad ? `BANKS FAIL (${bad})` : 'BANKS PASS');
  process.exit(bad ? 1 : 0);
})();
