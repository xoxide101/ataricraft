// Real 6502 SIO calls (JSR $E459, DCB at $0300) to N1: on both cores. Needs FujiNet enabled; N:TEST:// needs no relay.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const ROOT = 'C:/Users/raver/ataricraft';
const dcb = (dev, cmd, stats, buf, len, aux) => [0xa9, dev, 0x8d, 0, 3, 0xa9, 1, 0x8d, 1, 3, 0xa9, cmd, 0x8d, 2, 3, 0xa9, stats, 0x8d, 3, 3,
  0xa9, buf & 255, 0x8d, 4, 3, 0xa9, buf >> 8, 0x8d, 5, 3, 0xa9, 0x0f, 0x8d, 6, 3, 0xa9, len & 255, 0x8d, 8, 3, 0xa9, len >> 8, 0x8d, 9, 3,
  0xa9, aux & 255, 0x8d, 10, 3, 0xa9, aux >> 8, 0x8d, 11, 3, 0x20, 0x59, 0xe4];
const sty = (a) => [0x8c, a & 255, a >> 8];
const D = +(process.env.DEV || 0x71);
const code = [...dcb(D, 0x4f, 0x80, 0x800, 256, 4), ...sty(0x930), ...dcb(D, 0x53, 0x40, 0x900, 4, 0), ...sty(0x931),
  ...dcb(D, 0x52, 0x40, 0x910, 12, 12), ...sty(0x932), ...dcb(D, 0x43, 0, 0x900, 0, 0), ...sty(0x933), 0x60];
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  let bad = 0;
  for (const core of ['atari800', 'altirra']) {
    const p = await (await b.newContext()).newPage();
    p.on('console', (m) => console.log('  [page]', m.text())); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('file:///' + ROOT + '/web/index.html');
    await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
    await p.selectOption('#core', core);
    await p.click('#boot'); await p.waitForTimeout(3500);
    const r = await p.evaluate(async ({ code, core }) => {
      FujiNet.enabled = true;
      const e = FujiNet.emu;
      if (e.fnDevice) e.fnDevice(true);
      await new Promise((r) => setTimeout(r, 4000));
      const seg = (a, b) => [a & 255, a >> 8, (a + b.length - 1) & 255, (a + b.length - 1) >> 8, ...b];
      const spec = Array.from('N:TEST://').map((c) => c.charCodeAt(0)).concat(0x9b);
      const xex = [0xff, 0xff, ...seg(0x600, code), ...seg(0x800, spec), ...seg(0x930, [0xee, 0xee, 0xee, 0xee]), ...seg(0x2e0, [0x00, 0x06])];
      ataricraft.bootFile('nsio.xex', new Uint8Array(xex));
      await new Promise((r) => setTimeout(r, 2000));
      console.log('fn dev present?', (e.aw ? 'aw' : 'n/a'), 'devs', e.peek(0x930, 4));
      await new Promise((r) => setTimeout(r, 3000));
      return { y: e.peek(0x930, 4), status: e.peek(0x900, 4), data: String.fromCharCode(...e.peek(0x910, 12)) };
    }, { code, core });
    const ok = r.y[0] === 1 && r.y[1] === 1 && r.y[2] === 1 && r.y[3] === 1 && r.status[0] > 90 && r.status[3] === 1 && r.data === 'This is test';
    console.log(core, JSON.stringify(r), errs, ok ? 'OK' : 'FAILED');
    if (!ok) bad++;
    await p.close();
  }
  await b.close();
  process.exit(bad ? 1 : 0);
})();
