// WebAFM printing: directory listing, label and catalog text over a relay SD folder, plus the Print… dialog.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = 'C:/Users/raver/ataricraft';
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wprint-'));
  fs.writeFileSync(path.join(dir, 'README.TXT'), 'hello');
  fs.mkdirSync(path.join(dir, 'GAMES'));
  fs.writeFileSync(path.join(dir, 'GAMES', 'PACMAN.COM'), Buffer.alloc(3000, 1));
  const rw = spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', '8799', '--sd', dir], { env: Object.assign({}, process.env, { AC_TOKEN: 'testtoken' }) });
  await new Promise((r) => setTimeout(r, 900));
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true })).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://127.0.0.1:8799/');
    const R = await p.evaluate(async () => {
      const out = {};
      AC.WebAfm.open();
      const s = document.querySelector('#wafm .wp[data-i="0"] .src'); s.value = 'rsd'; s.dispatchEvent(new Event('change'));
      await new Promise((r) => setTimeout(r, 2000));
      const W = AC.WebAfm._state, r = W.mounts.get(W.panes[0].src), C = AC.AfmCore, PR = AC.AfmPrint;
      out.dir = PR.listing(C, r, {});
      out.tree = PR.listing(C, r, { recursive: true });
      out.cat = PR.catalog(C, [...W.mounts.values()]);
      out.label = PR.labelPage(C, r, {});
      document.querySelector('#wafm [data-a="print"]').click();
      await new Promise((x) => setTimeout(x, 300));
      out.dlg = !!document.querySelector('#wafm .wdlg');
      document.querySelector('#wafm .wdlg input[value="cat"]').click();
      [...document.querySelectorAll('#wafm .wdlg button')].find((x) => x.textContent === 'Print').click();
      await new Promise((x) => setTimeout(x, 600));
      out.pages = ['letter', 'legal', 'tabloid'].map((k) => PR.textPage('t', 'x', { paper: k, landscape: k === 'tabloid' })).map((h) => (h.match(/@page\{size:([^;]*);/) || [])[1] + ' / cols ' + (h.match(/column-count:(\d)/) || [])[1]);
      out.iframe = !!document.querySelector('iframe[srcdoc]') && document.querySelector('iframe[srcdoc]').srcdoc.includes('FILE INDEX');
      return out;
    });
    console.log(R.tree);
    ok(/README\.TXT/.test(R.dir) && /GAMES/.test(R.dir) && !/PACMAN/.test(R.dir), 'directory lists the root only', R.dir);
    ok(/PACMAN\.COM\s+\d+\s+3000/.test(R.tree), 'tree lists nested file with its size', R.tree);
    ok(/FILE INDEX/.test(R.cat) && /PACMAN\.COM/.test(R.cat.split('FILE INDEX')[1]), 'catalog has the A-Z index', R.cat);
    ok(/class="card"/.test(R.label) && /README\.TXT/.test(R.label), 'label page has the card and file names');
    ok(R.pages[0] === '8.5in 11in portrait / cols 1' && R.pages[1] === '8.5in 14in portrait / cols 1' && R.pages[2] === '11in 17in landscape / cols 3', 'page size and columns for Letter, Legal, Tabloid', R.pages);
    ok(R.dlg, 'Print dialog opens');
    ok(R.iframe, 'Print builds the catalog page');
    ok(!errs.length, 'no page errors', errs);
  } finally { await b.close(); rw.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
  console.log(bad ? 'FAILED ' + bad : 'all passed');
  process.exit(bad ? 1 : 0);
})();
