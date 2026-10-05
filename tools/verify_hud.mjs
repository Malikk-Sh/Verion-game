/** HUD DOM/CSS regression matrix plus real-game settings persistence and input checks. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
await mkdir('artifacts',{recursive:true});
const report={checks:[],screenshots:[],errors:[],environment:'Chromium / SwiftShader; UI correctness, not phone FPS'};
const check=name=>{report.checks.push(name);console.log('PASS:',name);};
const index=await readFile('index.html','utf8');
const server=await createServer({server:{host:'127.0.0.1',port:5177,strictPort:true},logLevel:'error',plugins:[{name:'hud-test-fixture',configureServer(server){server.middlewares.use('/__hud-check',(_req,res)=>{
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.end(index.replace('<script type="module" src="/src/main.ts"></script>',`<link rel="stylesheet" href="/src/style.css?direct"><link rel="stylesheet" href="/src/ui/hud.css?direct"><script type="module">
 import {applyHudSettings,defaultHudSettings} from '/src/ui/hud.ts';import{applyVisorSettings}from'/src/ui/visor.ts';import {cellContent} from '/src/ui/panels.ts';
 document.body.dataset.started='true';document.body.dataset.running='true';document.querySelector('#visor').hidden=false;document.querySelector('#veil').hidden=true;
 document.querySelector('#boot').hidden=true;document.querySelector('#target-marker').hidden=true;document.querySelector('#portrait').hidden=true;
 const slots=[{itemId:'tool_stone',count:1,durability:106},{itemId:'pulp',count:4},{itemId:'iron_raw',count:4},{itemId:'copper_raw',count:13},{itemId:'ice',count:24},{itemId:'stone',count:13}];
 slots.forEach((s,i)=>{const b=document.createElement('button');b.className='cell';cellContent(b,s,i,{number:false});document.querySelector('#hotbar-slots').append(b)});
 document.querySelector('#hotbar-name').textContent='Каменный мультитул';document.querySelector('#hotbar-meta').textContent='106 / 160';
 document.querySelector('#target-name').textContent='Железный выход';document.querySelector('#target-distance').textContent='180 м';
 document.querySelector('#aim').hidden=false;document.querySelector('#aim-name').textContent='Железная руда';document.querySelector('#aim-meta').textContent='Выберите мультитул';
 window.hudTest={apply:applyHudSettings,defaults:defaultHudSettings,cellContent,visor:applyVisorSettings};applyHudSettings(defaultHudSettings());
 </script>`));
});}}]});
await server.listen();let browser,debugPage;
const layout=page=>page.evaluate(()=>{
 const ids=['vitals','objective','compass-wrap','hud-buttons','aim','hotbar','joystick','actions','save-status'];
 const rs=ids.map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return{id,l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width};}).filter(r=>r.w>0);
 const overlap=[];for(let i=0;i<rs.length;i++)for(let j=i+1;j<rs.length;j++){const a=rs[i],b=rs[j];if(a.l<b.r-1&&a.r>b.l+1&&a.t<b.b-1&&a.b>b.t+1)overlap.push(`${a.id}×${b.id}`);}
 const out=rs.filter(r=>r.l<-.5||r.t<-.5||r.r>innerWidth+.5||r.b>innerHeight+.5).map(r=>r.id);
 const small=[...document.querySelectorAll('#hud button')].filter(e=>e.getClientRects().length&&(e.getBoundingClientRect().width<31.5||e.getBoundingClientRect().height<31.5)).map(e=>e.id||e.className);
 return{overlap,out,small};
});
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.VIREON_CHROMIUM_PATH,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true});
 const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:5177/__hud-check');await page.waitForFunction(()=>window.hudTest);
 report.layout=[];
 for(const [width,height] of [[568,320],[667,320],[760,390],[761,390],[800,360],[844,390],[915,412],[1366,768]]){
  await page.setViewportSize({width,height});
  for(const size of [80,100,150]){
   await page.evaluate(size=>window.hudTest.apply(Object.fromEntries(Object.keys(window.hudTest.defaults()).map(k=>[k,size]))),size);
   const r=await layout(page);if(r.overlap.length)console.log(await page.evaluate(()=>Object.fromEntries(['objective','aim','hotbar','compass-wrap'].map(id=>[id,document.getElementById(id).getBoundingClientRect().toJSON()]))));assert.ok(await page.locator('#compass-wrap').evaluate(e=>{const r=e.getBoundingClientRect();return Math.abs(r.left+r.width/2-innerWidth/2)<.1}),'Compass center');assert.deepEqual(r,{overlap:[],out:[],small:[]},`${width}×${height} ${size}%: ${JSON.stringify(r)}`);report.layout.push({width,height,size,...r});
  }
 }
 const compact=await page.evaluate(()=>({caption:!!document.querySelector('#hotbar-caption'),numbers:document.querySelectorAll('#hotbar .cell-n').length,actionText:document.querySelector('#actions').textContent.trim(),center:document.querySelector('#compass-wrap').getBoundingClientRect().left+document.querySelector('#compass-wrap').getBoundingClientRect().width/2-innerWidth/2}));
 assert.deepEqual(compact,{caption:false,numbers:0,actionText:'',center:0});check('Icon-only actions, unnumbered hotbar without caption and centered compass');
 check('Actual HUD CSS at eight viewports, 80/100/150%: no intersections, inside screen, buttons ≥32px');
 await page.setViewportSize({width:667,height:320});
 await page.evaluate(()=>{document.querySelector('#hud-safe-area').style.padding='10px 44px 21px';window.hudTest.apply(Object.fromEntries(Object.keys(window.hudTest.defaults()).map(k=>[k,150])))});
 assert.deepEqual(await layout(page),{overlap:[],out:[],small:[]});check('Simulated landscape safe areas with largest preferences');
 const cells=await page.evaluate(()=>{
  const c=document.querySelector('#hotbar-slots .cell'),render=window.hudTest.cellContent;
  render(c,{itemId:'tool_stone',count:1,durability:0},0);const broken=c.classList.contains('broken');
  render(c,{itemId:'bottle_1',count:1,milliGU:120000},0);const bottle={broken:c.classList.contains('broken'),bar:getComputedStyle(c.querySelector('.cell-bar')).backgroundImage};
  render(c,null,0);const empty=c.classList.contains('broken');render(c,{itemId:'tool_stone',count:1,durability:106},0);
  return{broken,bottle,empty,repaired:c.classList.contains('broken')};
 });
 assert.ok(cells.broken&&!cells.bottle.broken&&!cells.empty&&!cells.repaired);assert.match(cells.bottle.bar,/50%/);check('Broken → bottle → empty → healthy tool resets status and renders remaining gas');
 await page.setViewportSize({width:844,height:390});await page.evaluate(()=>window.hudTest.apply(window.hudTest.defaults()));
 const wings=await page.evaluate(()=>{
  const l=document.querySelector('#vitals').getBoundingClientRect(),r=document.querySelector('#hud-buttons').getBoundingClientRect();
  return{sameFrame:l.width===r.width&&l.height===r.height,controls:[...document.querySelectorAll('#hud-buttons button')].map(e=>({name:e.getAttribute('aria-label'),width:e.getBoundingClientRect().width})),rails:document.querySelectorAll('.visor-rail').length};
 });
 assert.ok(wings.sameFrame&&wings.controls.length===5&&wings.controls.every(c=>c.name&&c.width>=32)&&wings.rails===2);report.wings=wings;check('Mirrored visor frames have equal dimensions and five named controls; resizing does not duplicate artwork');
 const art=await page.evaluate(()=>({buttonBlur:getComputedStyle(document.querySelector('#suit-button')).backdropFilter,glassStroke:getComputedStyle(document.querySelector('.visor-glass')).stroke,segmentStroke:getComputedStyle(document.querySelector('.vital-fill path')).stroke,food:getComputedStyle(document.querySelector('#g-satiety .vital-fill path')).fill,oxygen:getComputedStyle(document.querySelector('#g-oxygen .vital-fill path')).fill}));
 assert.equal(art.buttonBlur,'none');assert.equal(art.glassStroke,'none');assert.equal(art.segmentStroke,'none');assert.notEqual(art.food,art.oxygen);report.art=art;check('Native visor artwork keeps translucent glass and distinct segment colors without inherited white strokes');
 const fills=await page.evaluate(()=>{
  const g=document.querySelector('#g-oxygen'),f=g.querySelector('.vital-fill');
  return[0,.5,1].map(ratio=>{g.style.setProperty('--v',String(ratio));f.style.transition='none';return getComputedStyle(f).clipPath});
 });
 assert.match(fills[0],/100%/);assert.match(fills[1],/50%/);assert.match(fills[2],/0%/);report.fills=fills;check('Segmented oxygen bar renders empty, half-full and full values');
 const menu=await page.evaluate(()=>({seams:document.querySelectorAll('.menu-seam').length,closed:document.querySelector('.menu-outline').getAttribute('d').endsWith('Z'),oldBrackets:document.querySelectorAll('#hud-buttons .tile').length&&getComputedStyle(document.querySelector('#suit-button'),'::after').content}));
 assert.equal(menu.seams,4);assert.ok(menu.closed);assert.equal(menu.oldBrackets,'none');check('Five fitted menu bays share a closed curved housing without hanging brackets');
 await page.evaluate(()=>{document.querySelector('#world').style.background='#b0b0b0';window.hudTest.visor({strength:0,spread:100})});
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('#visor')).opacity==='1');
 await page.screenshot({path:'artifacts/vignette-fixture-off.png'});
 for(const [strength,spread,name]of [[100,100,'default'],[150,140,'wide']]){await page.evaluate(p=>window.hudTest.visor(p),{strength,spread});await page.screenshot({path:'artifacts/vignette-fixture-'+name+'.png'});}
 const pixels=JSON.parse(execFileSync('python',['-c',`from PIL import Image
import json
frames={n:Image.open('artifacts/vignette-fixture-'+n+'.png').convert('RGB') for n in ['off','default','wide']}
points={'left':(1,1),'right':(842,1),'center':(422,136),'reach':(150,155),'glow':(9,18)}
print(json.dumps({n:{k:list(im.getpixel(p)) for k,p in points.items()} for n,im in frames.items()}))`],{encoding:'utf8'}));
 for(const key of ['left','right'])assert.ok(pixels.default[key].every((v,i)=>v<pixels.off[key][i]-70),'Upper corner shading must be visible');
 assert.deepEqual(pixels.default.center,pixels.off.center);assert.deepEqual(pixels.wide.center,pixels.off.center);
 assert.ok(pixels.wide.reach.every((v,i)=>v<pixels.default.reach[i]));
 assert.ok(Math.abs(pixels.default.left[0]-pixels.default.right[0])<=20,'Both upper corners are shaded');
 assert.ok(pixels.default.glow[1]>pixels.default.glow[0]+30&&pixels.default.glow[2]>pixels.default.glow[0]+30,'Cyan perimeter must be visible');
 assert.equal(await page.locator('#visor').evaluate(e=>getComputedStyle(e).pointerEvents),'none');
 const layers=await page.evaluate(()=>({hud:Number(getComputedStyle(document.querySelector('#hud')).zIndex),visor:Number(getComputedStyle(document.querySelector('#visor')).zIndex)}));assert.ok(layers.hud>layers.visor,'The visor must stay below readable HUD controls');
 const image=await page.evaluate(async()=>{const url=getComputedStyle(document.querySelector('#visor'),'::after').backgroundImage.match(/url\(["']?(.*?)["']?\)/)[1];const im=new Image();im.src=url;await im.decode();return {width:im.naturalWidth,height:im.naturalHeight}});assert.deepEqual(image,{width:1846,height:852});report.visorAsset=image;report.layers=layers;report.vignettePixels=pixels;check('Screenshots confirm holographic cyan rails, shaded upper corners, clear center, configurable reach and nonblocking overlay');
 await page.evaluate(()=>window.hudTest.visor({strength:100,spread:100}));
 if(process.argv.includes('--layout-only')){await page.close();await writeFile('artifacts/hud-layout-verification.json',JSON.stringify(report,null,2)+'\n');await browser.close();await server.close();process.exit(0);}
 await page.close();
 // Fresh isolated context: old settings remain intact. Throttle only this software-rendered test browser.
 await context.addInitScript(()=>{
  if(!localStorage.getItem('vireon.settings'))localStorage.setItem('vireon.settings',JSON.stringify({quality:'low',sound:false,bob:false,fov:76,hud:{joystick:110,action:115,movement:95,menu:90,compass:90,vitals:80,hotbar:90,info:80}}));
  const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=fn=>raf(t=>setTimeout(()=>fn(t),120));
 });
 const game=await context.newPage();debugPage=game;game.setDefaultTimeout(30000);game.on('pageerror',e=>report.errors.push(e.message));
 const ready=()=>game.waitForFunction(()=>document.body.dataset.ready==='true');
 const click=sel=>game.$eval(sel,e=>e.click());
 const continueAfterReload=async()=>{
  await click('#continue');await game.waitForFunction(()=>{const s=window.__vireon.getState();return s.running||s.dialog==='lease-panel';});
  // The previous document may leave an unexpired lease if unload cancels its release.
  if(await game.evaluate(()=>window.__vireon.getState().dialog==='lease-panel'))await click('#lease-primary');
  await game.waitForFunction(()=>window.__vireon.getState().running);
 };
 const shot=async name=>{await game.waitForFunction(()=>!document.body.classList.contains('booting'));await game.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));await game.waitForTimeout(300);const path=`artifacts/hud-new-${name}.png`;await game.screenshot({path,timeout:30000});report.screenshots.push(path);};
 await game.goto('http://127.0.0.1:5177');await ready();
 await game.evaluate(async()=>{
  const [{newGame},{SaveStore},{heightAt}]=await Promise.all([import('/src/game/state.ts'),import('/src/persist/store.ts'),import('/src/world.ts')]);
  const g=newGame('w-hud-settings',12345,Date.now(),heightAt(40,42),'HUD settings');g.player.inventory[0].durability=0;g.player.vitals.health=18;g.player.vitals.satiety=80;
  [['iron_raw',4],['copper_raw',13],['ice',24],['stone',13]].forEach(([itemId,count],i)=>g.player.inventory[i+2]={itemId,count});
  g.player.inventory[10]={itemId:'bottle_1',count:1,milliGU:120000};g.player.inventory[11]={itemId:'tool_stone',count:1,durability:106};
  const st=await SaveStore.open();await st.createSlot(g,null);st.close();
 });
 await game.reload();await ready();await continueAfterReload();await game.waitForFunction(()=>!document.body.classList.contains('booting'));
 assert.equal(await game.locator('#g-health').getAttribute('data-low'),'true');assert.equal(await game.locator('#g-health b').textContent(),'18');assert.equal(await game.locator('#g-satiety b').textContent(),'80');
 await game.locator('#suit-button').tap();assert.equal(await game.locator('#suit-panel').isVisible(),true);await click('#close-suit');
 await game.locator('#map-button').tap();assert.equal(await game.locator('#map-panel').isVisible(),true);await click('#close-map');
 const dayBefore=await game.evaluate(()=>window.__vireon.getState().dayOffsetTicks);await game.locator('#day').tap();assert.notEqual(await game.evaluate(()=>window.__vireon.getState().dayOffsetTicks),dayBefore);await game.locator('#day').tap();
 check('Live vital numbers and low-health warning; curved suit/map/day buttons respond to touch');
 await game.evaluate(()=>window.__vireon.teleport(67.3,61.6,.05,-.12));
 await click('#inventory-button');await click('#inventory-grid [data-cell="0"]');await click('#act-move');await click('#inventory-grid [data-cell="10"]');await click('#close-inventory');
 assert.equal(await game.locator('#hotbar-slots .cell.broken').count(),0);assert.match(await game.locator('#hotbar-slots .cell').first().locator('.cell-bar').evaluate(e=>getComputedStyle(e).backgroundImage),/50%/);
 await click('#inventory-button');await click('#inventory-grid [data-cell="0"]');await click('#act-move');await click('#inventory-grid [data-cell="11"]');await click('#close-inventory');
 check('Real inventory swaps replace broken tool with tank and healthy tool without stale flags');
 for(const [width,height] of [[761,390],[844,390]]){await game.setViewportSize({width,height});await game.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));await game.waitForFunction(()=>Number(getComputedStyle(document.querySelector('#hotbar')).opacity)>.99);assert.deepEqual(await layout(game),{overlap:[],out:[],small:[]});await shot(`${width}x${height}`);}
 await game.evaluate(()=>{document.querySelector('#toast').hidden=true});await game.setViewportSize({width:667,height:320});await click('#objective');assert.equal(await game.locator('#objective-panel').isVisible(),true);assert.equal(await game.evaluate(()=>window.__vireon.getState().running),false);await shot('667x320-quest');await click('#objective-back');
 assert.equal(await game.evaluate(()=>window.__vireon.getState().running),true);check('Task details open separately and close back to gameplay on short screen');
 await click('#pause-button');await click('#settings-button');await click('#hud-settings-button');
 assert.deepEqual(await game.locator('.hud-size-row input').evaluateAll(es=>es.map(e=>Number(e.value))),Array(8).fill(100));check('Approved legacy proportions migrate to 100% defaults');
 for(const [width,height] of [[568,320],[667,320],[844,390],[1366,768]]){await game.setViewportSize({width,height});const fits=await game.locator('#hud-settings-panel').evaluate(e=>{const p=e.getBoundingClientRect();return e.scrollHeight<=e.clientHeight+1&&[...e.querySelectorAll('input,button')].filter(c=>c.getClientRects().length).every(c=>{const r=c.getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom&&r.left>=p.left&&r.right<=p.right})});assert.ok(fits,`${width}x${height}: HUD settings need scrolling`);}
 check('Dedicated HUD settings fit without scrolling at four viewports');await game.setViewportSize({width:844,height:390});
 const keys=await game.locator('.hud-size-row input').evaluateAll(es=>es.map(e=>e.id));assert.equal(keys.length,8);
 const values=[150,120,85,80,135,110,95,125];
 for(let i=0;i<keys.length;i++)await game.locator(`#${keys[i]}`).evaluate((e,v)=>{e.value=String(v);e.dispatchEvent(new Event('input',{bubbles:true}))},values[i]);
 const saved=await game.evaluate(()=>JSON.parse(localStorage.getItem('vireon.settings')));
 assert.equal(saved.fov,76);assert.equal(saved.bob,false);assert.equal(saved.quality,'low');assert.equal(saved.sound,false);assert.deepEqual(Object.values(saved.hud),values);
 await game.locator('#hud-settings-panel').scrollIntoViewIfNeeded();await shot('settings');
 await game.reload();await ready();await click('#title-settings');await click('#hud-settings-button');
 assert.deepEqual(await game.locator('.hud-size-row input').evaluateAll(es=>es.map(e=>Number(e.value))),values);check('Eight independent preferences persist after reload without replacing previous graphics/audio settings');
 await click('#hud-reset');assert.deepEqual(await game.locator('.hud-size-row input').evaluateAll(es=>es.map(e=>Number(e.value))),Array(8).fill(100));assert.equal(await game.evaluate(()=>JSON.parse(localStorage.getItem('vireon.settings')).fov),76);check('Reset changes HUD sizes only');
 await click('#hud-settings-back');await click('#settings-back');await continueAfterReload();
 await game.setViewportSize({width:844,height:390});await game.evaluate(()=>window.__vireon.teleport(44,46,-.20,-.08));await game.waitForTimeout(1200);await shot('visor-default');
 const before=await game.evaluate(()=>window.__vireon.getState());await game.locator('#hotbar-slots .cell').nth(1).tap();await game.waitForFunction(()=>window.__vireon.getState().hotbar===1);
 const after=await game.evaluate(()=>window.__vireon.getState());assert.equal(after.hotbar,1);assert.equal(after.yaw,before.yaw);assert.equal(after.pitch,before.pitch);check('Smaller hotbar cells select items and do not rotate the camera');
 await click('#pause-button');await click('#settings-button');await click('#visor-settings-button');
 assert.deepEqual(await game.locator('.visor-size-row input').evaluateAll(es=>es.map(e=>Number(e.value))),[100,100]);
 const ticks=await game.evaluate(()=>window.__vireon.getState().activeTicks);await game.waitForTimeout(400);assert.equal(await game.evaluate(()=>window.__vireon.getState().activeTicks),ticks);
 for(const [width,height]of [[568,320],[667,320],[844,390],[1366,768]]){await game.setViewportSize({width,height});assert.ok(await game.locator('#visor-settings-panel').evaluate(e=>e.scrollHeight<=e.clientHeight+1&&[...e.querySelectorAll('input,button')].filter(c=>c.getClientRects().length).every(c=>{const p=e.getBoundingClientRect(),r=c.getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom&&r.left>=p.left&&r.right<=p.right})));}
 await game.setViewportSize({width:844,height:390});await shot('visor-settings');check('Separate visor settings fit four screens and pause expedition time');
 const setVisor=async(key,value)=>game.locator('#visor-'+key).evaluate((e,v)=>{e.value=String(v);e.dispatchEvent(new Event('input',{bubbles:true}))},value);
 const previous=await game.evaluate(()=>JSON.parse(localStorage.getItem('vireon.settings')));await setVisor('strength',0);await setVisor('spread',135);
 assert.equal(await game.locator('#visor').evaluate(e=>getComputedStyle(e).getPropertyValue('--visor-strength').trim()),'0');
 await game.reload();await ready();await click('#title-settings');await click('#visor-settings-button');assert.deepEqual(await game.locator('.visor-size-row input').evaluateAll(es=>es.map(e=>Number(e.value))),[0,135]);
 await setVisor('strength',120);await click('#visor-settings-back');await click('#hud-settings-button');await click('#hud-reset');
 assert.deepEqual(await game.evaluate(()=>JSON.parse(localStorage.getItem('vireon.settings')).visor),{strength:120,spread:135});
 await game.keyboard.press('Escape');assert.equal(await game.locator('#settings').isVisible(),true);await click('#visor-settings-button');await click('#visor-reset');
 const afterVisor=await game.evaluate(()=>JSON.parse(localStorage.getItem('vireon.settings')));assert.deepEqual(afterVisor.visor,{strength:100,spread:100});
 for(const key of ['quality','sound','bob','fov','hud'])assert.deepEqual(afterVisor[key],previous[key]);
 await game.keyboard.press('Escape');assert.equal(await game.locator('#settings').isVisible(),true);await click('#settings-back');await continueAfterReload();await click('#pause-button');await click('#settings-button');await click('#visor-settings-button');await click('#visor-preview');assert.equal(await game.evaluate(()=>window.__vireon.getState().running),true);
 check('Visor preferences persist including 0%; independent resets, Escape navigation and gameplay preview work');
 // Use the real suit controls: no helmet means no decorative visor; other parts must not affect it.
 await game.evaluate(()=>window.__vireon.teleport(40,40,-.2,-.08));await game.waitForTimeout(400);
 const prefsBeforeHelmet=await game.evaluate(()=>JSON.parse(localStorage.getItem('vireon.settings')).visor);
 await click('#suit-button');await click('#part-grid [data-part="boots"]');await click('#suit-remove');
 assert.equal(await game.locator('#visor').evaluate(e=>e.hidden),false);
 await click('#suit-replace');await click('#suit-detail .option');
 await click('#part-grid [data-part="helmet"]');await click('#suit-remove');
 assert.equal(await game.evaluate(()=>window.__vireon.getState().suit.helmet),null);assert.equal(await game.locator('#visor').evaluate(e=>e.hidden),true);
 await click('#close-suit');await game.evaluate(()=>window.__vireon.teleport(44,46,-.2,-.08));await shot('without-helmet');
 await game.evaluate(()=>window.__vireon.save());await game.reload();await ready();await continueAfterReload();
 assert.equal(await game.locator('#visor').evaluate(e=>e.hidden),true);assert.equal(await game.evaluate(()=>window.__vireon.getState().suit.helmet),null);
 await click('#suit-button');await click('#part-grid [data-part="helmet"]');await click('#suit-replace');await click('#suit-detail .option');
 assert.ok(await game.evaluate(()=>window.__vireon.getState().suit.helmet));assert.equal(await game.locator('#visor').evaluate(e=>e.hidden),false);
 await click('#close-suit');await shot('helmet-restored');
 assert.deepEqual(await game.evaluate(()=>JSON.parse(localStorage.getItem('vireon.settings')).visor),prefsBeforeHelmet);
 check('Removing helmet immediately hides the complete visor, saved bareheaded worlds reload without it, equipping restores it; boots and preferences are independent');

 assert.deepEqual(report.errors,[]);
}catch(e){report.failure=String(e.stack||e);if(debugPage){report.debug=await debugPage.evaluate(()=>({rects:Object.fromEntries(['vitals','hud-buttons','compass-wrap','compass','hotbar'].map(id=>[id,document.getElementById(id).getBoundingClientRect().toJSON()])),styles:[...document.querySelectorAll('style')].map(e=>e.getAttribute('data-vite-dev-id')),variables:document.documentElement.style.cssText}));console.log(report.debug);}console.error(e);process.exitCode=1;}
finally{await writeFile('artifacts/hud-verification.json',JSON.stringify(report,null,2)+'\n');await browser?.close();await server.close();}
