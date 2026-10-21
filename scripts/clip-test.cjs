const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
(async()=>{
const b = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const ctx = await b.newContext({viewport:{width:1366,height:900},permissions:['clipboard-read','clipboard-write']});
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file:///C:/Users/raver/ataricraft/web/index.html');
await p.setInputFiles('#romfiles',['C:/Users/raver/ataricraft/software_n_roms/ATARIXL.ROM','C:/Users/raver/ataricraft/software_n_roms/ATARIBAS.ROM']);
await p.click('#boot'); await p.waitForTimeout(3000);
await p.evaluate(()=>navigator.clipboard.writeText('10 PRINT "PASTED"\n20 PRINT 2+2\nRUN\n'));
await p.click('body',{position:{x:700,y:10}});
await p.keyboard.press('Control+V'); await p.waitForTimeout(9000);
console.log(await p.evaluate(()=>ataricraft.screenText()));
await p.click('#copytxt'); 
console.log(JSON.stringify(await p.evaluate(()=>navigator.clipboard.readText())));
await p.click('#copyimg'); await p.waitForTimeout(500); console.log(await p.textContent('#status'));
console.log(await p.evaluate(async()=>{const i=await navigator.clipboard.read();return i[0].types}));
console.log(errs); await b.close();})();

