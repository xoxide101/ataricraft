// P: printer through the real OS handler (libatari800 core): BASIC LPRINT/LIST "P:" lands on the paper window.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const ROOT = 'C:/Users/raver/ataricraft';
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.click('#boot'); await p.waitForTimeout(2500);

  // direct hook calls: status, a normal line, a double-width line, a full 40-byte frame
  const D = await p.evaluate(() => {
    Printer.clear(); Printer.cfg.auto = false;
    const m = FujiNet.emu.mem(), A = 0x600, hook = FujiNet.emu.m.acSio, out = {};
    const frame = (s, mode) => { m.fill(0x20, A, A + 40); for (let i = 0; i < s.length; i++) m[A + i] = s === null ? 0 : s.charCodeAt(i); if (s.length < 40) m[A + s.length] = 0x9b; return hook(0x40, 0x57, 0x80, mode.charCodeAt(0), A, 40); };
    out.status = hook(0x40, 0x53, 0x40, 0, A, 4); out.st = Array.from(m.subarray(A, A + 4));
    out.w1 = frame('HELLO PAPER', 'N'); out.w2 = frame('WIDE', 'D'); out.w3 = frame('X'.repeat(40), 'N');
    out.unk = hook(0x40, 0x99, 0, 0, A, 0);
    out.lines = Printer.lines.length; out.text = Printer.text();
    return out;
  });
  ok(D.status === 0x43 && D.st[2] === 0x1e, 'status command answered', D);
  ok(D.w1 === 0x43 && D.w2 === 0x43 && D.w3 === 0x43 && D.unk === 0x4e, 'write frames complete, unknown command NAKs', D);
  ok(D.lines === 3 && D.text === 'HELLO PAPER\r\nWIDE\r\n' + 'X'.repeat(40) + '\r\n', 'text captured up to EOL, full frame kept', D.text);

  // real OS handler from BASIC
  await p.evaluate(() => { Printer.clear(); });
  await p.evaluate(() => ataricraft.type('LPRINT "FROM BASIC"\nLPRINT "LINE TWO"\nLIST "P:"\n'));
  await p.waitForTimeout(6000);
  const B = await p.evaluate(() => Printer.text());
  ok(/FROM BASIC/.test(B) && /LINE TWO/.test(B), 'BASIC LPRINT reaches the paper through the OS P: handler', B);
  await p.evaluate(() => ataricraft.type('NEW\n10 PRINT 1\n20 PRINT 2\nLIST "P:"\n'));
  await p.waitForFunction(() => ataricraft.typing() === 0, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(5000);
  const B2 = await p.evaluate(() => Printer.text());
  ok(/10 PRINT 1/.test(B2) && /20 PRINT 2/.test(B2), 'LIST "P:" prints the program', B2);

  // paper window renders ink
  const R = await p.evaluate(() => {
    Printer.cfg.auto = true; Printer.cfg.font = 'text'; Printer.show();
    const cv = document.querySelector('#paperwin canvas'), g = cv.getContext('2d'), d = g.getImageData(0, 0, cv.width, cv.height).data;
    let ink = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 80 && d[i + 1] < 80) ink++;
    const t = ataricraft.printer.lines();
    Printer.cfg.font = 'atari'; Printer.paint();
    const d2 = g.getImageData(0, 0, cv.width, cv.height).data; let ink2 = 0; for (let i = 0; i < d2.length; i += 4) if (d2[i] < 80 && d2[i + 1] < 80) ink2++;
    Printer.cfg.paper = 'sheet'; Printer.paint();
    return { ink, ink2, t, shown: Printer.shown(), info: document.querySelector('#paperwin .pinfo').textContent, rom: !!Printer.rom };
  });
  ok(R.shown && R.ink > 40 && R.ink2 > 200 && R.rom, 'paper window shows ink in text and Atari fonts', R);
  ok(/page/.test(R.info), 'sheet mode counts pages', R.info);
  await p.evaluate(() => { Printer.cfg.paper = 'roll'; Printer.cfg.font = 'atari'; Printer.paint(); });
  await p.screenshot({ path: ROOT + '/out/printer.png' });

  // device bar entry
  const dv = await p.evaluate(() => { const e = [...document.querySelectorAll('#devbar .dv')].find((x) => /^P:/.test(x.textContent)); e.click(); const t = document.querySelector('#devdlg').textContent; document.querySelector('#devdlg').close(); return t; });
  ok(/line/.test(dv), 'P: device card reports the captured lines', dv);
  ok(errs.length === 0, 'no page errors', errs);
  await b.close();
  console.log(bad ? 'FAILED ' + bad : 'all passed');
  process.exit(bad ? 1 : 0);
})();
