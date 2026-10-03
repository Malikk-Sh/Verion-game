/** Browser verification of S1 (mining, inventory, clock, IndexedDB saves, lease, export/import). Not a FPS test. */
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { chromium as playwright } from 'playwright';
import { createServer } from 'vite';
await mkdir('artifacts',{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:5174,strictPort:true}});await server.listen();
const report={checks:[],errors:[],environment:'Headless Chromium, software WebGL (SwiftShader), economy preset. Correctness only.'};
const check=n=>{report.checks.push(n);console.log('PASS:',n);};
let browser;
try{
 const launch={headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']};
 if(process.env.VIREON_CHROMIUM_PATH)launch.executablePath=process.env.VIREON_CHROMIUM_PATH;
 browser=await playwright.launch(launch);
 const ctx=await browser.newContext({viewport:{width:844,height:390},hasTouch:true,acceptDownloads:true});
 await ctx.addInitScript(()=>{if(!localStorage.getItem('vireon.settings'))localStorage.setItem('vireon.settings',JSON.stringify({quality:'low',sound:false}));});
 const page=await ctx.newPage();page.setDefaultTimeout(300000);
 const watch=p=>{p.on('pageerror',e=>report.errors.push(e.message));p.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});};watch(page);
 const st=(p=page)=>p.evaluate(()=>window.__vireon.getState());
 const click=(sel,p=page)=>p.$eval(sel,e=>e.click());
 await page.goto('http://127.0.0.1:5174');await page.waitForFunction(()=>document.body.dataset.ready==='true');
 assert.equal(await page.locator('#continue').isHidden(),true);check('Fresh browser: no saves, "Новая экспедиция" only');
 await click('#start');await page.waitForFunction(()=>window.__vireon.getState().running);
 let s=await st();assert.ok(s.slotId);assert.equal(s.revision,1);assert.equal(s.inventory[0].itemId,'tool_stone');check('New expedition creates a saved slot (revision 1) with the starting kit');
 await page.evaluate(()=>window.__vireon.teleport(67,61.6,0,-.28));
 await page.waitForFunction(()=>window.__vireon.getState().aimNode==='iron-a');await page.waitForTimeout(500);await page.screenshot({path:'artifacts/s1-aim.png'});check('Aiming at the iron outcrop shows the mining prompt');
 await page.keyboard.down('KeyF');await page.waitForFunction(()=>window.__vireon.getState().mineRatio>0.2);await page.screenshot({path:'artifacts/s1-mining.png'});
 await page.waitForFunction(()=>window.__vireon.getState().inventory.some(i=>i.itemId==='iron_raw'));await page.keyboard.up('KeyF');
 s=await st();assert.equal(s.nodes['iron-a'],31);assert.equal(s.inventory.find(i=>i.itemId==='tool_stone').durability,159);check('Holding F mines one block: node 32→31, ore in inventory, tool wear 1');
 const t0=(await st()).activeTicks;await page.keyboard.press('KeyI');assert.equal((await st()).dialog,'inventory-panel');
 await page.waitForFunction(t=>window.__vireon.getState().activeTicks>t+3,t0);await page.screenshot({path:'artifacts/s1-inventory.png'});check('Inventory opens and game time keeps running inside it');
 await page.keyboard.press('KeyI');await click('#pause-button');const tp=(await st()).activeTicks;
 await page.waitForFunction(()=>window.__vireon.getState().saveStatus==='saved'&&window.__vireon.getState().revision>=2);
 await page.waitForTimeout(800);assert.equal((await st()).activeTicks,tp);check('Pause freezes the clock and commits a new revision');
 await page.screenshot({path:'artifacts/s1-pause.png'});
 await page.reload();await page.waitForFunction(()=>document.body.dataset.ready==='true');
 assert.equal(await page.locator('#continue').isVisible(),true);await page.screenshot({path:'artifacts/s1-title-continue.png'});
 await click('#continue');await page.waitForFunction(()=>window.__vireon.getState().running);
 s=await st();assert.equal(s.nodes['iron-a'],31);assert.ok(s.inventory.some(i=>i.itemId==='iron_raw'));assert.ok(Math.abs(s.position.z-61.6)<1);check('Reload → Продолжить restores deposits, inventory and position from IndexedDB');
 // Second tab: lease is held; explicit take-over revokes the first tab.
 const page2=await ctx.newPage();page2.setDefaultTimeout(300000);watch(page2);
 await page2.goto('http://127.0.0.1:5174');await page2.waitForFunction(()=>document.body.dataset.ready==='true');
 await click('#continue',page2);await page2.waitForFunction(()=>window.__vireon.getState().dialog==='lease-panel');await page2.screenshot({path:'artifacts/s1-lease.png'});check('Second tab is told the world is open elsewhere');
 await click('#lease-primary',page2);await page2.waitForFunction(()=>window.__vireon.getState().running);
 await page.evaluate(()=>window.__vireon.save());await page.waitForFunction(()=>window.__vireon.getState().halted&&window.__vireon.getState().dialog==='lease-panel');
 assert.equal((await st(page)).saveStatus,'lease-lost');check('Take-over: new tab writes, old tab stops and offers export');
 // Export from tab 2, import as a new slot.
 await click('#pause-button',page2);await click('#saves-button',page2);await page2.waitForFunction(()=>document.querySelectorAll('.slot-row').length===1);
 const [dl]=await Promise.all([page2.waitForEvent('download'),click('#export-current',page2)]);const file='artifacts/'+dl.suggestedFilename();await dl.saveAs(file);
 const env=JSON.parse(await readFile(file,'utf8'));assert.equal(env.magic,'VIREON');assert.equal(env.pages.length,4);check('Export downloads a .vireon.json envelope');
 await page2.setInputFiles('#import-file',file);await page2.waitForFunction(()=>document.querySelectorAll('.slot-row').length===2);
 await page2.screenshot({path:'artifacts/s1-saves.png'});check('Import creates a second slot without touching the first');
 await page2.setInputFiles('#import-file',{name:'bad.vireon.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...env,sha256:'0'.repeat(64)}))});
 await page2.waitForFunction(()=>/отклонён/.test(document.getElementById('saves-status').textContent));assert.equal(await page2.locator('.slot-row').count(),2);check('Damaged file is rejected with a message');
 assert.deepEqual(report.errors,[]);check('No console errors');
}catch(e){report.failure=String(e?.stack||e);console.error(e);process.exitCode=1;}
finally{await writeFile('artifacts/s1-verification.json',JSON.stringify(report,null,2)+'\n');await browser?.close();await server.close();}
