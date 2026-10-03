/** Browser verification of S1/S1.1 (HUD layout, hotbar, inventory move/swap, suit parts, day cycle, mining, inventory, clock, IndexedDB saves, lease, export/import). Not a FPS test. */
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

 // HUD layout: no overlaps between HUD groups, everything inside the viewport, every visible HUD button ≥48 CSS px.
 const layout=()=>page.evaluate(()=>{const ids=['vitals','objective','compass-wrap','hud-buttons','aim','hotbar','joystick','actions','save-status'];
  const rs=ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return{id,l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width};}).filter(r=>r.w>0);
  const over=[];for(let i=0;i<rs.length;i++)for(let j=i+1;j<rs.length;j++){const a=rs[i],b=rs[j];if(a.l<b.r-1&&a.r>b.l+1&&a.t<b.b-1&&a.b>b.t+1)over.push(a.id+'×'+b.id);}
  const out=rs.filter(r=>r.l<0||r.t<0||r.r>innerWidth+.5||r.b>innerHeight+.5).map(r=>r.id);
  const small=[...document.querySelectorAll('#hud button')].filter(b=>b.getClientRects().length&&(b.getBoundingClientRect().height<47.5||b.getBoundingClientRect().width<47.5)).map(b=>b.id||b.className);
  return{over,out,small};});
 for(const [w,h] of [[844,390],[1366,768],[667,320]]){await page.setViewportSize({width:w,height:h});await page.waitForTimeout(400);const r=await layout();assert.deepEqual(r,{over:[],out:[],small:[]},`${w}×${h}: ${JSON.stringify(r)}`);await page.screenshot({path:`artifacts/s1-hud-${w}.png`});}
 await page.setViewportSize({width:844,height:390});check('HUD at 844×390, 1366×768 and 667×320: no overlapping groups, inside viewport, buttons ≥48 px');
 // Hotbar is the first backpack row; the context action follows the selected cell (no fake mining with food in hand).
 await click('[data-hot="1"]');s=await st();assert.equal(s.hotbar,1);assert.equal(s.cells[1].itemId,'pulp');
 await page.waitForFunction(()=>window.__vireon.getState().action==='none');assert.equal(s.handItem,false);
 await page.keyboard.press('Digit1');await page.waitForFunction(()=>window.__vireon.getState().action==='mine');assert.equal((await st()).handItem,true);
 check('Hotbar = backpack row 1: selecting food disables «Добыть», key 1 returns the multitool');
 // A finger on HUD controls never turns the camera or moves the player.
 {const cd=await ctx.newCDPSession(page),bb=await page.locator('[data-hot="2"]').boundingBox(),p0=await st(),x=bb.x+bb.width/2,y=bb.y+bb.height/2;
  await cd.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:7,x,y}]});await cd.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:7,x:x-60,y:y-40}]});await cd.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForTimeout(300);const p1=await st();assert.equal(p1.yaw,p0.yaw);assert.equal(p1.pitch,p0.pitch);assert.ok(Math.hypot(p1.position.x-p0.position.x,p1.position.z-p0.position.z)<.01);assert.equal(p1.input.lookPointer,null);
  await page.keyboard.press('Digit1');}
 check('Touch-drag across a hotbar cell does not rotate the camera or move the player');
 const t0=(await st()).activeTicks;await page.keyboard.press('KeyI');assert.equal((await st()).dialog,'inventory-panel');
 await page.waitForFunction(t=>window.__vireon.getState().activeTicks>t+3,t0);await page.screenshot({path:'artifacts/s1-inventory.png'});check('Inventory opens and game time keeps running inside it');

 // Phone move flow: select → «Переместить» → target. Empty target = move, occupied = swap, «Отмена» cancels.
 const cell=i=>click(`#inventory-grid [data-cell="${i}"]`);
 await cell(1);await click('#act-move');await cell(10);s=await st();assert.equal(s.cells[1],null);assert.equal(s.cells[10].itemId,'pulp');
 await cell(0);await click('#act-move');await cell(10);s=await st();assert.equal(s.cells[0].itemId,'pulp');assert.equal(s.cells[10].itemId,'tool_stone');
 await cell(10);await click('#act-move');await cell(0);s=await st();assert.equal(s.cells[0].itemId,'tool_stone');assert.equal(s.cells[10].itemId,'pulp');
 await cell(10);await click('#act-move');await page.getByRole('button',{name:'Отмена'}).click();assert.equal((await st()).panel.moveFrom,null);
 const row1=JSON.stringify((await st()).cells.slice(0,6));await click('#sort-rest');assert.equal(JSON.stringify((await st()).cells.slice(0,6)),row1);
 check('Inventory UI: move to empty cell, swap with occupied, cancel; «Сортировать остальное» keeps row 1');
 // Suit screen: four parts; outside the capsule removal needs a 1 s hold; the part goes to the backpack and can be put back.
 await click('#open-suit');assert.equal((await st()).dialog,'suit-panel');await click('#part-grid [data-part="helmet"]');
 assert.match(await page.locator('#suit-remove').innerText(),/удерживать/);await click('#suit-remove');assert.equal((await st()).worn,4);
 await page.locator('#suit-remove').hover();await page.mouse.down();await page.waitForFunction(()=>window.__vireon.getState().worn===3,null,{timeout:60000});await page.mouse.up();
 s=await st();assert.equal(s.suit.helmet,null);assert.ok(s.cells.some(c=>c?.itemId==='suit_helmet'));await page.screenshot({path:'artifacts/s1-suit-removed.png'});
 await click('#suit-replace');await page.locator('#suit-detail .option').first().click();s=await st();assert.equal(s.worn,4);assert.ok(!s.cells.some(c=>c?.itemId==='suit_helmet'));
 await click('#suit-back');assert.equal((await st()).dialog,'inventory-panel');
 check('Suit screen: tap does not remove in hazard, 1 s hold removes helmet to backpack, «Надеть» returns it, back to inventory');
 await page.keyboard.press('KeyI');
 // Day cycle: the day button jumps to evening/morning by shifting the world offset; the light really changes.
 {const d0=await st();await click('#day');const d1=await st();assert.equal(d1.night,true);assert.notEqual(d1.dayOffsetTicks,d0.dayOffsetTicks);
  await page.waitForFunction(()=>window.__vireon.getState().nightValue>.5,null,{timeout:120000});await page.screenshot({path:'artifacts/s1-night.png'});
  await page.keyboard.press('KeyN');assert.equal((await st()).night,false);await page.waitForFunction(()=>window.__vireon.getState().nightValue<.2,null,{timeout:120000});
  const ph=(await st()).dayPhase;await page.waitForFunction(p=>window.__vireon.getState().dayPhase>p+.5,ph);}
 check('Day/night: button and N shift the cycle, scene light follows, phase advances with game time');
 await page.keyboard.press('Digit3');assert.equal((await st()).hotbar,2);const off0=(await st()).dayOffsetTicks;
 await click('#pause-button');const tp=(await st()).activeTicks;
 await page.waitForFunction(()=>window.__vireon.getState().saveStatus==='saved'&&window.__vireon.getState().revision>=2);
 await page.waitForTimeout(800);assert.equal((await st()).activeTicks,tp);check('Pause freezes the clock and commits a new revision');
 await page.screenshot({path:'artifacts/s1-pause.png'});
 await page.reload();await page.waitForFunction(()=>document.body.dataset.ready==='true');
 assert.equal(await page.locator('#continue').isVisible(),true);await page.screenshot({path:'artifacts/s1-title-continue.png'});
 await click('#continue');await page.waitForFunction(()=>window.__vireon.getState().running);
 s=await st();assert.equal(s.nodes['iron-a'],31);assert.ok(s.inventory.some(i=>i.itemId==='iron_raw'));assert.ok(Math.abs(s.position.z-61.6)<1);assert.equal(s.hotbar,2);assert.equal(s.worn,4);assert.equal(s.dayOffsetTicks,off0);check('Reload → Продолжить restores deposits, inventory, position, hotbar, suit and day offset from IndexedDB');
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
 await page2.setInputFiles('#import-file',file);await page2.waitForFunction(()=>document.querySelectorAll('.slot-row').length===2,null,{timeout:900000});
 await page2.screenshot({path:'artifacts/s1-saves.png'});check('Import creates a second slot without touching the first');
 await page2.setInputFiles('#import-file',{name:'bad.vireon.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...env,sha256:'0'.repeat(64)}))});
 await page2.waitForFunction(()=>/отклонён/.test(document.getElementById('saves-status').textContent));assert.equal(await page2.locator('.slot-row').count(),2);check('Damaged file is rejected with a message');
 assert.deepEqual(report.errors,[]);check('No console errors');
}catch(e){report.failure=String(e?.stack||e);console.error(e);process.exitCode=1;}
finally{await writeFile('artifacts/s1-verification.json',JSON.stringify(report,null,2)+'\n');await browser?.close();await server.close();}
