const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
(async()=>{
const b = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const p = await b.newPage({viewport:{width:1366,height:900}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file:///C:/Users/raver/ataricraft/web/index.html');
await p.click('#mapbtn');
await p.click('#mapbox button >> nth=0'); await p.keyboard.press('F9');
console.log(await p.evaluate(()=>[mapdlg.open, mapbox.children[0].textContent, localStorage.getItem('ac.keymap')]));
await p.screenshot({path:'out/dialog.png'});
console.log(errs); await b.close();})();
