const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
(async()=>{
const b = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const ctx = await b.newContext({viewport:{width:1366,height:900},permissions:['clipboard-read','clipboard-write']});
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file:///C:/Users/raver/ataricraft/web/index.html');
await p.setInputFiles('#romfiles',['C:/Users/raver/ataricraft/software_n_roms/ATARIXL.ROM','C:/Users/raver/ataricraft/software_n_roms/ATARIBAS.ROM']);
await p.click('#boot'); await p.waitForTimeout(3000);
const prog = '10 REM SQUARES\n20 GRAPHICS 3+16\n30 FOR I=0 TO 15\n40 COLOR 1+I-3*INT(I/3)\n50 PLOT I,I:DRAWTO 39-I,I:DRAWTO 39-I,23-I:DRAWTO I,23-I:DRAWTO I,I\n60 NEXT I\n70 GOTO 70\n';
await p.evaluate((t)=>navigator.clipboard.writeText(t), prog);
await p.fill('#hostname','SQ.BAS'); await p.click('#hostpaste');
await p.evaluate(()=>ataricraft.type('ENTER "H:SQ.BAS"\nRUN\n')); await p.waitForTimeout(6000);
await p.screenshot({path:'out/sq2.png'});
await p.keyboard.press('Pause'); await p.waitForTimeout(500);
await p.evaluate(()=>ataricraft.type('GRAPHICS 0\n10 REM SQUARES (edited)\nLIST "H:OUT.LST"\n')); await p.waitForTimeout(8000);
await p.evaluate(()=>{});
const row = p.locator('#hostlist .row', {hasText:'OUT.LST'}); await row.getByText('Copy').click();
console.log(await p.evaluate(()=>navigator.clipboard.readText()));
console.log(await p.textContent('#status'), errs); await b.close();})();


