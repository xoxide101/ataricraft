const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
(async()=>{
const b = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const p = await b.newPage({viewport:{width:1366,height:900}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto('file:///C:/Users/raver/ataricraft/web/index.html');
await p.selectOption('#core','altirra');
await p.click('#boot'); await p.waitForTimeout(6000);
console.log(await p.evaluate(()=>[fps.textContent,efps.textContent,fc.textContent,document.title]));
await p.screenshot({path:'out/alt1.png'});
await p.keyboard.type('PRINT 6*7'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
await p.keyboard.type('10 PRINT "HI":GOTO 10'); await p.keyboard.press('Enter'); await p.keyboard.type('RUN'); await p.keyboard.press('Enter');await p.waitForTimeout(2000);
await p.screenshot({path:'out/alt2.png'});
console.log(errs);
await b.close();})();
