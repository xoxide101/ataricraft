// Font library: import .FNT/.TTF/.OTF/.ZIP, load a set into the FONT editor, embed a TTF in the WebAFM print page. node scripts/fontlib-test.cjs
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = 'C:/Users/raver/ataricraft';
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-'));
  const fnt = Buffer.alloc(1024); for (let i = 0; i < 1024; i++) fnt[i] = (i * 7) & 255;
  fs.writeFileSync(path.join(tmp, 'Test Set.fnt'), fnt);
  fs.writeFileSync(path.join(tmp, 'Short.fnt'), Buffer.alloc(512));
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await (await b.newContext()).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.evaluate(() => indexedDB.deleteDatabase('ac-fonts'));
  const res = await p.evaluate(async ([fb, tb, ob]) => {
    const u = (a) => new File([new Uint8Array(a)], 'x');
    const mk = (a, n) => new File([new Uint8Array(a)], n);
    const r1 = await AC.FontLib.importFiles([mk(fb, 'Test Set.fnt'), mk([1, 2, 3], 'Short.fnt'), mk(tb, 'Press.ttf'), mk(ob, 'Conn.otf')]);
    const r2 = await AC.FontLib.importFiles([mk(fb, 'Test Set.fnt')]);
    const L = await AC.FontLib.list();
    const ttf = L.find((f) => f.kind === 'ttf');
    const fam = await AC.FontLib.face(ttf.id);
    const css = await AC.FontLib.css(ttf.id, 'ACPrint');
    const html = AC.AfmPrint.textPage('t', 'hello', { fontFamily: 'ACPrint', fontCss: css, fontSize: 9 });
    return { r1, r2, kinds: L.map((f) => f.kind).sort(), fam, cssOk: css.startsWith("@font-face{font-family:'ACPrint'"), htmlOk: html.includes('@font-face') && html.includes("9px/1.25 'ACPrint'") };
  }, [[...fnt], [...fs.readFileSync(ROOT + '/web/library/fonts/PressStart2P.ttf')], [...fs.readFileSync(ROOT + '/web/library/fonts/Connection.otf')]]);
  console.log(JSON.stringify(res));
  await p.evaluate(() => AC.FontPanel.open()); await p.waitForTimeout(800);
  const n = await p.evaluate(() => [...document.querySelectorAll('select')].map((s) => s.options[0] && (s.options[0]||{}).textContent).filter((t) => /Font library/.test(t || '')));
  await p.evaluate(async () => { const s = [...document.querySelectorAll('select')].find((x) => /Font library/.test(((x.options[0]||{}).textContent||''))); s.value = s.querySelector('option[value]:not([value=""])').value; s.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(500);
  const msg = await p.evaluate(() => document.body.innerText.match(/Loaded "[^"]+" from the library/));
  await b.close();
  const pass = res.r1.added === 3 && res.r1.skipped === 1 && res.r2.added === 0 && res.kinds.join() === 'fnt,ttf,ttf' && /^ACLib/.test(res.fam) && res.cssOk && res.htmlOk && n.length === 1 && n[0] === 'Font library (1)' && msg && !errs.length;
  console.log(pass ? 'FONTLIB PASS' : 'FONTLIB FAIL ' + JSON.stringify({ n, msg, errs }));
  process.exit(pass ? 0 : 1);
})();
