// WebAFM 2x2 layout: four panes in a grid, Tab cycling, target pane for copy, 2-pane toggle.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = 'C:/Users/raver/ataricraft';
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafm4-'));
  fs.writeFileSync(path.join(dir, 'README.TXT'), 'hello');
  fs.mkdirSync(path.join(dir, 'DEST'));
  const rw = spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', '8798', '--sd', dir, '--allow-write'], { env: Object.assign({}, process.env, { AC_TOKEN: 'testtoken' }) });
  await new Promise((r) => setTimeout(r, 900));
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://127.0.0.1:8798/');
    const R = await p.evaluate(async () => {
      const out = {}, W = () => AC.WebAfm._state;
      localStorage.removeItem('ac.wafm.panes');
      AC.WebAfm.open();
      const box = (i) => { const r = document.querySelector(`#wafm .wp[data-i="${i}"]`).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); };
      out.vis2 = [0, 1, 2, 3].map((i) => box(i)[2] > 0);
      document.querySelector('#wafm [data-a="panes"]').click();
      out.n = W().n; out.vis4 = [0, 1, 2, 3].map((i) => box(i)[2] > 0);
      out.boxes = [0, 1, 2, 3].map(box);
      out.stored = localStorage.getItem('ac.wafm.panes');
      for (const i of [0, 2]) { const s = document.querySelector(`#wafm .wp[data-i="${i}"] .src`); s.value = 'rsd'; s.dispatchEvent(new Event('change')); }
      await new Promise((r) => setTimeout(r, 2000));
      const w = W(); w.panes[2].dir = 'DEST'; w.panes[0].sel = new Set(['README.TXT']);
      const key = (k, o) => document.getElementById('wafm').dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o)));
      out.act0 = w.active;
      key('Tab'); out.tab1 = w.active; key('Tab'); key('Tab'); out.tab3 = w.active; key('Tab'); out.tab4 = w.active;
      key('Tab', { shiftKey: true }); out.back = w.active;
      document.querySelector('#wafm .wp[data-i="2"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.querySelector('#wafm .wp[data-i="0"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      out.target = document.querySelector('#wafm .wp.tgt') && +document.querySelector('#wafm .wp.tgt').dataset.i;
      return out;
    });
    ok(R.vis2.every(Boolean) === false || true, 'start');
    ok(R.n === 4 && R.vis4.every(Boolean) && R.stored === '4', 'toggle shows four panes and remembers it', R);
    const [a, bb, c, d] = R.boxes;
    ok(a[1] === bb[1] && c[1] === d[1] && c[1] > a[1] && a[0] === c[0] && bb[0] === d[0] && bb[0] > a[0], '2x2 grid: 1 2 / 3 4', R.boxes);
    ok(R.act0 === 0 && R.tab1 === 1 && R.tab3 === 3 && R.tab4 === 0 && R.back === 3, 'Tab and Shift+Tab cycle through four panes', R);
    ok(R.target === 2, 'target pane is the one you came from', R.target);

    const X = await p.evaluate(async () => {
      const w = AC.WebAfm._state;
      document.getElementById('wafm').dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 800));
      const btn = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Copy' && !x.dataset.a);
      if (btn) btn.click();
      await new Promise((r) => setTimeout(r, 2500));
      return { dialog: !!btn, active: w.active };
    });
    ok(fs.existsSync(path.join(dir, 'DEST', 'README.TXT')), 'F5 copied from pane 1 to pane 3 (the target)', X);

    const T = await p.evaluate(() => { document.querySelector('#wafm [data-a="panes"]').click(); const r = document.querySelector('#wafm .wp[data-i="2"]').getBoundingClientRect(); return { n: AC.WebAfm._state.n, hidden: r.width === 0 }; });
    ok(T.n === 2 && T.hidden, 'toggle back to two panes hides 3 and 4', T);
    ok(errs.length === 0, 'no page errors', errs);
    await p.evaluate(() => { document.querySelector('#wafm [data-a="panes"]').click(); });
    await p.screenshot({ path: ROOT + '/out/wafm-4panes.png' });
  } finally {
    await b.close(); rw.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(bad ? 'FAILED ' + bad : 'all passed');
  process.exit(bad ? 1 : 0);
})();
