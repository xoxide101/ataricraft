const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const R='C:/Users/raver/ataricraft/';
(async()=>{const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const p=await b.newPage({viewport:{width:1366,height:1000}});p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('file:///'+R+'web/index.html');
await p.setInputFiles('#romfiles',[R+'software_n_roms/8bit/Bios/ATARIXL.ROM',R+'software_n_roms/8bit/Bios/ATARIBAS.ROM']);await p.waitForTimeout(800);
await p.click('#boot');await p.waitForTimeout(1500);
await p.setInputFiles('#f1',R+'out/t_new.atr');await p.setInputFiles('#f2',R+'out/afm_d2.atr');await p.waitForTimeout(1500);
await p.click('[data-t=drv]');
const st=()=>p.evaluate(()=>JSON.stringify(Object.entries(ataricraft.diskState()).map(([k,v])=>k+':'+(v.name||JSON.stringify(v)))));
console.log('before',await st());
const menu=async(n,label)=>{await p.locator('#drvviz .xf').nth(n-1).click({button:'right'});await p.locator('.pickmenu div',{hasText:label}).first().click();await p.waitForTimeout(800);};
await menu(1,'Move to D3');console.log('D1->D3',await st());
await menu(3,'Move to D2');console.log('D3->D2 swap',await st());
console.log(await p.evaluate(()=>[1,2,3].map(n=>document.getElementById('d'+n).textContent)));
await b.close()})()
