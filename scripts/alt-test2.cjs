const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
(async()=>{
const b = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const p = await b.newPage({viewport:{width:1366,height:900}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto('file:///C:/Users/raver/ataricraft/web/index.html');
await p.selectOption('#core','altirra');
await p.click('#boot'); await p.waitForTimeout(4000);
const atr = fs.readFileSync('C:/Users/raver/.copilot/session-state/0ad2035b-775f-49b7-a916-e9911bb0d5c3/files/apt_toolkit/toolkit.atr').toString('base64');
const r = await p.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  await ataricraft.mountDisk(1, 'toolkit.atr', bytes);
  await ataricraft.reset(true);
  await ataricraft.step(600);
  const t = ataricraft.screenText();
  const snap = ataricraft.snapshot();
  return { t, snapLen: snap && (snap.length || snap.byteLength) };
}, atr);
console.log(r);
await p.screenshot({path:'out/alt3.png'});
// core switch persists and back
await p.selectOption('#core','atari800'); await p.waitForTimeout(500);
console.log(await p.evaluate(()=>localStorage.getItem('ac.core')));
console.log(errs);
await b.close();})();
