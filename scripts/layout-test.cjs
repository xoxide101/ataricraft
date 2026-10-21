const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
(async()=>{
const b = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const p = await b.newPage({viewport:{width:1366,height:900}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto('file:///C:/Users/raver/ataricraft/web/index.html');
await p.setInputFiles('#romfiles',['C:/Users/raver/ataricraft/software_n_roms/ATARIXL.ROM','C:/Users/raver/ataricraft/software_n_roms/ATARIBAS.ROM'].filter(f=>require('fs').existsSync(f)));
await p.click('#boot'); await p.waitForTimeout(3500);
console.log(await p.evaluate(()=>[fps.textContent,efps.textContent,fc.textContent,mapbox.children.length,document.body.scrollHeight,innerHeight]));
await p.keyboard.press('F8'); await p.keyboard.type('PRINT 1');
await p.screenshot({path:'out/layout.png'});
console.log(errs);
await b.close();})();
