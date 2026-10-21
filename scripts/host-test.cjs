const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
(async()=>{
const b = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const ctx = await b.newContext({viewport:{width:1366,height:900},permissions:['clipboard-read','clipboard-write']});
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file:///C:/Users/raver/ataricraft/web/index.html');
await p.setInputFiles('#romfiles',['C:/Users/raver/ataricraft/software_n_roms/ATARIXL.ROM','C:/Users/raver/ataricraft/software_n_roms/ATARIBAS.ROM']);
await p.click('#boot'); await p.waitForTimeout(3000);
const w=async(ms)=>{await p.waitForTimeout(ms)};
await p.evaluate(()=>ataricraft.type('10 PRINT "HI"\n20 GOTO 10\nLIST "H:T.LST"\n')); await w(7000);
console.log(await p.evaluate(()=>ataricraft.screenText()));
await w(1200);
console.log(await p.textContent('#hostlist'));
console.log(await p.evaluate(()=>{const f=ataricraft; return 0}));
await p.evaluate(()=>ataricraft.type('NEW\nENTER "H:T.LST"\nLIST\n')); await w(7000);
console.log(await p.evaluate(()=>ataricraft.screenText()));
await p.screenshot({path:'out/host.png'});
console.log(errs); await b.close();})();
