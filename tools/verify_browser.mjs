/** Browser verification of the B4 scene and UI, still valid for S1 (see verify_s1.mjs for S1 systems). Starts its own server, so no shared daemon is required. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

import { chromium as playwright } from 'playwright';
import { createServer, preview } from 'vite';
await mkdir('artifacts',{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:5173,strictPort:true}});
await server.listen();
let browser, production;
const startedAt=performance.now();
const frameDelay=Math.max(0,Math.min(1000,Number(process.env.VIREON_TEST_FRAME_DELAY_MS??1000)||0));
const report={checks:[],errors:[],measurements:[],timings:[],reviewViews:[],frameDelayMs:frameDelay,environment:'Headless Chromium; software rendering (SwiftShader) in this verification environment, economy preset for gameplay checks. Not a phone FPS test.'};
const check=(name)=>{const elapsedMs=Math.round(performance.now()-startedAt);report.checks.push(name);report.timings.push({name,elapsedMs});console.log('PASS:',name,`[${elapsedMs} ms]`);};
try {
 let launch={headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']};
 if(process.env.VIREON_CHROMIUM_PATH)launch.executablePath=process.env.VIREON_CHROMIUM_PATH;
 if(process.env.VIREON_CHROMIUM_MODULE){const c=(await import(process.env.VIREON_CHROMIUM_MODULE)).default;launch={...launch,executablePath:await c.executablePath(),args:[...c.args.filter(x=>!['--disable-web-security','--allow-running-insecure-content'].includes(x)),'--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']};}
 browser=await playwright.launch(launch);
 const page=await browser.newPage({viewport:{width:844,height:390},hasTouch:true});
 page.setDefaultTimeout(240000);
 // Give software GL idle time between frames so it cannot starve input and DOM checks.
 // A one-second gap is faster overall than continuous rendering on a CPU-only runner.
 // Only this test page is throttled; production game code and all three quality presets are unchanged.
 await page.addInitScript(delay=>{
  if(!localStorage.getItem('vireon.settings'))localStorage.setItem('vireon.settings',JSON.stringify({quality:'low',sound:true}));
  if(delay){const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=fn=>raf(t=>setTimeout(()=>fn(t),delay));}
 },frameDelay);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 const state=()=>page.evaluate(()=>window.__vireon.getState());
 await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>document.body.dataset.ready==='true');
 report.webgl=await page.evaluate(()=>{const gl=document.getElementById('world').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return{version:gl.getParameter(gl.VERSION),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};});assert.match(report.webgl.renderer,/SwiftShader/i,'CI uses the pinned software renderer');
 assert.equal(await page.locator('vite-error-overlay').count(),0);await page.waitForTimeout(1500);assert.ok((await state()).drawCalls>0,'Gameplay must perform real WebGL draw calls');await page.screenshot({path:'artifacts/b4-welcome.png'});check('Development page loads, WebGL2 initializes, no error overlay');
 await page.click('#title-settings');assert.equal((await state()).dialog,'settings');assert.equal(await page.locator('#settings').isVisible(),true);await page.screenshot({path:'artifacts/b4-title-settings.png'});await page.click('#settings-back');assert.equal((await state()).dialog,'welcome');check('Settings open from the title screen and return to it');
 await page.click('#start');await page.waitForFunction(()=>window.__vireon.getState().running);assert.equal((await state()).version,'S3');
 // S5 (D37): no scan action without the scanner; the starting scanner on quick slot 3 scans the place with the action button.
 assert.notEqual((await state()).action,'scan');await page.keyboard.press('KeyE');assert.equal((await state()).dialog,'','E does nothing without the scanner');assert.equal((await state()).visited.includes('capsule'),false);
 await page.locator('#hotbar-slots .cell').nth(2).click();await page.waitForFunction(()=>window.__vireon.getState().hotbar===2&&window.__vireon.getState().action==='scan');assert.equal(await page.locator('#hotbar-name').textContent(),'Сканер');
 await page.click('#action');let s0=await state();assert.equal(s0.dialog,'info-panel');assert.ok(s0.visited.includes('capsule'));assert.equal(await page.locator('#info-title').textContent(),'Посадочная капсула');assert.equal(await page.locator('#scan-sweep').isHidden(),false,'the scan sweep plays');
 await page.screenshot({path:'artifacts/s5-scan-landmark.png'});await page.click('#close-info');await page.locator('#hotbar-slots .cell').nth(0).click();await page.waitForFunction(()=>window.__vireon.getState().hotbar===0);check('Scanner: the place is scanned only with the scanner selected (action button), with a sweep; the card records the visit');
 assert.equal((await state()).grassCount,244);check('Scene contains 244 tufts, versus 1218 in B1');
 const before=await state();await page.keyboard.down('KeyW');await page.waitForFunction(z=>window.__vireon.getState().position.z>z+5,before.position.z,{timeout:240000});await page.keyboard.up('KeyW');
 await page.screenshot({path:'artifacts/b4-day.png'});check('Keyboard movement exits capsule into valley');
 await page.mouse.move(548,195);await page.mouse.down();await page.mouse.move(598,185,{steps:4});await page.mouse.up();assert.ok(Math.abs((await state()).yaw-before.yaw)>.1);check('Drag-to-look changes heading');
 await page.click('#day');assert.equal((await state()).night,true);await page.screenshot({path:'artifacts/b4-night.png'});report.measurements.push(await state());check('Day/night switch changes scene state');
 await page.click('#pause-button');const t=(await state()).activeTime;
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal((await state()).activeTime,t);check('Pause freezes active simulation time');
 await page.click('#settings-button');assert.equal((await state()).dialog,'settings');
 await page.click('#fullscreen-toggle');await page.waitForFunction(()=>!!document.fullscreenElement);assert.equal((await state()).fullscreen,true);assert.match(await page.locator('#fullscreen-toggle').innerText(),/Выйти/);
 await page.click('#fullscreen-toggle');await page.waitForFunction(()=>!document.fullscreenElement);assert.equal((await state()).fullscreen,false);check('Fullscreen enters and exits from a real menu click, button tracks browser state');
 const q0=(await state()).quality;await page.click('#quality-toggle');const q1=(await state()).quality;assert.notEqual(q0,q1);assert.match(await page.locator('#quality-label').innerText(),/Графика/);await page.click('#quality-toggle');await page.click('#quality-toggle');assert.equal((await state()).quality,q0);check('Graphics quality cycles through three presets and returns');
 await page.click('#sound-toggle');assert.equal((await state()).sound,false);await page.click('#sound-toggle');assert.equal((await state()).sound,true);check('Sound toggle switches procedural ambience');
 const bob0=(await state()).bob;await page.click('#bob-toggle');assert.equal((await state()).bob,!bob0);await page.click('#bob-toggle');assert.equal((await state()).bob,bob0);check('Camera bob toggle switches and restores');
 // S4: «Вибрация» is on by default, switches with one click, persists and restores.
 assert.equal((await state()).haptics,true);await page.click('#haptics-toggle');assert.equal((await state()).haptics,false);assert.match(await page.locator('#haptics-label').innerText(),/выкл/);assert.equal(await page.locator('#haptics-toggle').getAttribute('aria-pressed'),'false');assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('vireon.settings'))).haptics,false);
 await page.click('#haptics-toggle');assert.equal((await state()).haptics,true);assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('vireon.settings'))).haptics,true);check('Vibration toggle is on by default, switches, persists and restores');
 await page.locator('#fov-range').fill('85');assert.equal((await state()).fov,85);assert.match(await page.locator('#fov-value').innerText(),/85/);await page.locator('#fov-range').fill('70');assert.equal((await state()).fov,70);check('Field of view slider updates the setting');
 await page.screenshot({path:'artifacts/b4-menu.png'});await page.click('#settings-back');assert.equal((await state()).dialog,'paused');await page.click('#resume');
 // S4 (D34): full-screen live map. Every control is one real click; each result is asserted once, without retries.
 await page.click('#map-button');assert.equal((await state()).dialog,'map-panel');const pos=(await state()).position;
 await page.waitForFunction(()=>window.__vireon.getState().map.raster===1);
 const near=(a,b,eps=1e-3)=>Math.abs(a-b)<=eps;let m=(await state()).map;
 assert.ok(near(m.center.x,pos.x)&&near(m.center.z,pos.z),'the map opens centred on the player');assert.ok(near(m.zoom,m.size.h/160),'opening zoom: 160 m fill the map height');
 assert.equal(m.size.backing,Math.round(m.size.w*m.size.dpr),'canvas backing store follows the device pixel ratio');assert.ok(m.markers>=30&&m.labels>=3,'places, deposits and labels are drawn');
 assert.match(await page.locator('#map-o2').getAttribute('aria-label'),/^Кислород \d+/);assert.match(await page.locator('#map-hp').getAttribute('aria-label'),/^Здоровье \d+/);
 await page.evaluate(async()=>{await Promise.all(document.getElementById('map-panel').getAnimations().map(a=>a.finished.catch(()=>{})));});await page.screenshot({path:'artifacts/b4-map.png'});check('Map opens full screen on the player at valley zoom, with live O₂/HP and a DPR-scaled canvas');
 const z0=m.zoom;await page.click('#map-zoom-in');assert.ok(near((await state()).map.zoom,z0*1.6,1e-6));await page.click('#map-zoom-out');assert.ok(near((await state()).map.zoom,z0,1e-6));
 await page.keyboard.press('ArrowLeft');m=(await state()).map;assert.ok(near(m.center.x,pos.x+60/z0,1e-6),'arrow keys pan');await page.click('#map-center');m=(await state()).map;assert.ok(near(m.center.x,pos.x)&&near(m.center.z,pos.z),'«Ко мне» recentres');
 const box=await page.locator('#map').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-400);assert.ok((await state()).map.zoom>z0*1.5,'the wheel zooms in');
 // S5: «+» goes on to 24 px per metre (single glass blocks and station bodies), each click ×1.6 up to the cap, then stays.
 {let zk=(await state()).map.zoom;while(zk<24){await page.click('#map-zoom-in');zk=Math.min(24,zk*1.6);assert.ok(near((await state()).map.zoom,zk,1e-6),'zoom step '+zk);}await page.click('#map-zoom-in');m=(await state()).map;assert.equal(m.zoom,24,'the maximum zoom is 24 px/m');const d0=m.draws;await page.waitForFunction(k=>window.__vireon.getState().map.draws>k,d0);await page.screenshot({path:'artifacts/s5-map-max.png'});}
 await page.click('#map-fit');m=(await state()).map;assert.ok(near(m.center.x,80)&&near(m.center.z,80)&&near(m.zoom,Math.min(m.size.w,m.size.h)/(560*1.04),1e-6),'«Весь участок» shows the whole square');
 const draws=async()=>(await state()).map.draws,nextDraw=async n=>page.waitForFunction(k=>window.__vireon.getState().map.draws>k,n);
 await nextDraw(await draws());const allMarkers=(await state()).map.markers;
 await page.click('#map-layer-resources');assert.equal(await page.locator('#map-layer-resources').getAttribute('aria-pressed'),'false');assert.equal((await state()).map.layers.resources,false);
 await nextDraw(await draws());assert.ok((await state()).map.markers<allMarkers,'hiding «Ресурсы» removes deposit markers');await page.click('#map-layer-resources');assert.equal((await state()).map.layers.resources,true);
 check('Map zoom buttons, arrow keys, «Ко мне», wheel, «Весь участок» and layer toggles respond to single clicks');
 await nextDraw(await draws());m=(await state()).map;const at=(x,z)=>({x:box.x+(m.size.w/2+(m.center.x-x)*m.zoom)*box.width/m.size.w,y:box.y+(m.size.h/2-(z-m.center.z)*m.zoom)*box.height/m.size.h});
 let q=at(40,40);await page.mouse.click(q.x,q.y);assert.deepEqual((await state()).map.card,{kind:'landmark',id:'capsule'});assert.equal(await page.locator('#map-card-title').innerText(),'Посадочная капсула');
 assert.match(await page.locator('#map-card-data').textContent(),/Расстояние\d+ м/);await page.click('#map-back');assert.equal((await state()).map.card,null);
 q=at(-150,-150);await page.mouse.move(q.x,q.y);await page.mouse.down();await page.waitForTimeout(800);await page.mouse.up();
 let w=(await state()).waypoint;assert.ok(w&&Math.abs(w.x+150)<2&&Math.abs(w.z+150)<2,'a long press sets the mark where it was pressed');assert.deepEqual((await state()).map.card,{kind:'point',id:'point'});
 await page.click('#map-go');let s=await state();assert.equal(s.selected,'point');assert.equal(s.dialog,'');assert.equal(s.running,true);assert.equal(s.guide.nav.name,'Метка');
 await page.click('#map-button');await page.getByRole('button',{name:'Метка',exact:true}).click();assert.deepEqual((await state()).map.card,{kind:'point',id:'point'});await page.click('#map-remove');s=await state();assert.equal(s.waypoint,null);assert.equal(s.selected,'guide');
 check('Tapping a marker opens its card; a long press sets «Метка», «Вести» leads to it and «Убрать метку» returns to the journal');
 await page.getByRole('button',{name:'Вход в пещеру',exact:true}).click();assert.deepEqual((await state()).map.card,{kind:'landmark',id:'cave'});assert.equal((await state()).dialog,'map-panel');
 await page.click('#map-go');s=await state();assert.equal(s.selected,'cave');assert.equal(s.dialog,'');assert.deepEqual(s.position,pos);assert.equal(s.guide.nav.name,'Вход в пещеру');check('Map selects target without teleporting');
 await page.setViewportSize({width:844,height:390});
 const cd=await page.context().newCDPSession(page),rect=await page.locator('#joystick').boundingBox();
 const a={id:1,x:rect.x+rect.width/2,y:rect.y+rect.height/2-30,radiusX:5,radiusY:5,force:1};
 const b={id:2,x:630,y:165,radiusX:5,radiusY:5,force:1};
 const start=await state();await cd.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a,b]});
 await cd.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[a,{...b,x:590,y:150}]});
 await page.waitForFunction(p=>Math.hypot(window.__vireon.getState().position.x-p.x,window.__vireon.getState().position.z-p.z)>.4,start.position,{timeout:240000});
 assert.ok(Math.abs((await state()).yaw-start.yaw)>.1);
 await cd.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForFunction(()=>window.__vireon.getState().input.joyY===0&&window.__vireon.getState().input.lookPointer===null,{},{timeout:15000});
 assert.equal((await state()).input.joyY,0);assert.equal((await state()).input.lookPointer,null);check('Two simultaneous real touch contacts move and look independently, then release');
 await cd.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]});await page.waitForFunction(()=>window.__vireon.getState().input.joyY!==0,{},{timeout:15000});await cd.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await page.waitForFunction(()=>window.__vireon.getState().input.joyY===0&&window.__vireon.getState().input.joyPointer===null,{},{timeout:15000});assert.equal((await state()).input.joyY,0);check('Touch cancellation clears joystick');
 await page.click('#day');await page.screenshot({path:'artifacts/b4-mobile.png'});report.measurements.push(await state());
 // Accepted minimum for every button is 32×32 CSS px (6 October).
 const checkButtonTargets=async(label)=>{
  // Opening panels start at scale(.98); measure their final geometry, not an animation frame.
  await page.evaluate(async()=>{await Promise.all([...document.querySelectorAll('.panel:not([hidden])')].flatMap(panel=>panel.getAnimations()).map(animation=>animation.finished.catch(()=>{})));});
  const targets=await page.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>b.getClientRects().length).map(b=>{const r=b.getBoundingClientRect();return{name:b.id||b.getAttribute('aria-label')||b.className,width:r.width,height:r.height};}));
  assert.ok(targets.length>0,`${label}: buttons must be visible`);
  assert.deepEqual(targets.filter(b=>b.width<31.5||b.height<31.5),[],`${label}: buttons must be ≥32px in both dimensions`);
  check(`${label}: all visible buttons are at least 32 CSS pixels wide and tall`);
 };
 await checkButtonTargets('844×390 gameplay');
 await page.keyboard.press('KeyM');assert.equal((await state()).dialog,'map-panel');await checkButtonTargets('844×390 map');
 {const r=await page.locator('#map').boundingBox(),cx=r.x+r.width/2,cy=r.y+r.height/2,z=(await state()).map.zoom,p=(id,dx)=>({id,x:cx+dx,y:cy,radiusX:5,radiusY:5,force:1});
  await cd.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p(11,-40),p(12,40)]});await cd.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[p(11,-100),p(12,100)]});await cd.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok((await state()).map.zoom>z*2,'a two-finger spread zooms the map in');}
 await page.click('#close-map');assert.equal((await state()).running,true);check('844×390: two-finger pinch zooms the map; the map closes back to play');
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>!document.getElementById('portrait').hidden);assert.equal((await state()).running,false);await page.screenshot({path:'artifacts/b4-portrait.png'});
 await page.setViewportSize({width:844,height:390});await page.waitForFunction(()=>document.getElementById('portrait').hidden);assert.equal((await state()).running,false);await page.click('#resume');check('Portrait pauses; landscape return requires explicit resume');
 await page.setViewportSize({width:667,height:320});await page.screenshot({path:'artifacts/b4-compact.png'});await checkButtonTargets('667×320 gameplay');
 const overlap=await page.evaluate(()=>{const rs=['hotbar','joystick','actions'].map(id=>document.getElementById(id).getBoundingClientRect());return [[0,1],[0,2],[1,2]].some(([i,j])=>rs[i].left<rs[j].right&&rs[i].right>rs[j].left&&rs[i].top<rs[j].bottom&&rs[i].bottom>rs[j].top);});assert.equal(overlap,false);check('Compact 667×320 landscape keeps hotbar clear of movement controls');
 await page.keyboard.press('KeyM');assert.equal((await state()).dialog,'map-panel');await checkButtonTargets('667×320 map');await page.screenshot({path:'artifacts/b4-compact-map.png'});
 await page.getByRole('button',{name:'Вход в пещеру',exact:true}).click();assert.deepEqual((await state()).map.card,{kind:'landmark',id:'cave'});await checkButtonTargets('667×320 map card');await page.keyboard.press('Escape');assert.equal((await state()).running,true);
 await page.click('#pause-button');await checkButtonTargets('667×320 pause');
 await page.click('#settings-button');await checkButtonTargets('667×320 settings');
 assert.ok(await page.locator('#settings').evaluate(e=>{const p=e.getBoundingClientRect();return e.scrollHeight<=e.clientHeight+1&&[...e.querySelectorAll('input,button')].filter(c=>c.getClientRects().length).every(c=>{const r=c.getBoundingClientRect();return r.top>=p.top-.5&&r.bottom<=p.bottom+.5&&r.left>=p.left-.5&&r.right<=p.right+.5;});}),'667×320: the settings screen needs scrolling');check('667×320 settings fit without scrolling');
 const smallRanges=await page.evaluate(()=>[...document.querySelectorAll('#settings .range-row')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().height<47).map(e=>e.className));assert.deepEqual(smallRanges,[],'Settings range rows retain their 48px height');
 await page.screenshot({path:'artifacts/b4-compact-settings.png'});
 await page.click('#hud-settings-button');await checkButtonTargets('667×320 HUD settings');await page.click('#hud-settings-back');
 await page.click('#visor-settings-button');await checkButtonTargets('667×320 visor settings');await page.click('#visor-settings-back');
 await page.click('#settings-back');await page.click('#saves-button');await checkButtonTargets('667×320 saves');await page.click('#close-saves');await page.click('#resume');
 await page.click('#inventory-button');await checkButtonTargets('667×320 inventory');await page.click('#close-inventory');
 await page.keyboard.press('c');await checkButtonTargets('667×320 suit');await page.click('#close-suit');
 // Vercel serves the Vite production build; standalone HTML is no longer maintained.
 production=await preview({preview:{host:'127.0.0.1',port:5174,strictPort:true}});
 await page.goto('http://127.0.0.1:5174');await page.waitForFunction(()=>document.body.dataset.ready==='true');await page.click('#start');await page.waitForFunction(()=>window.__vireon.getState().running);check('Production Vite build initializes and starts (Vercel deployment format)');
 const requests=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>r.name).filter(n=>/^https?:/.test(n)&&new URL(n).origin!==location.origin));assert.deepEqual(requests,[]);check('Production build requires no external runtime resources');
 // Rejected and unavailable fullscreen are explicit UI states, never false success.
 await page.click('#pause-button');await page.click('#settings-button');await page.evaluate(()=>{document.documentElement.requestFullscreen=()=>Promise.reject(new Error('test denial'));});await page.click('#fullscreen-toggle');await page.waitForFunction(()=>document.getElementById('fullscreen-status').textContent.includes('не разрешил'));assert.equal((await state()).fullscreen,false);check('Fullscreen denial leaves scene usable and displays a clear message');
 await page.addInitScript(()=>{Object.defineProperty(document,'fullscreenEnabled',{get:()=>false});});await page.reload();await page.waitForFunction(()=>document.body.dataset.ready==='true');await page.click('#start');await page.waitForFunction(()=>window.__vireon.getState().running);await page.click('#pause-button');await page.click('#settings-button');assert.equal(await page.locator('#fullscreen-toggle').isDisabled(),true);check('Unsupported fullscreen is disabled with an explanation');
 // The live game must stop consuming CPU while the static model review runs.
 await page.close();
 const art=await browser.newPage({viewport:{width:960,height:540}});art.setDefaultTimeout(240000);art.on('pageerror',e=>report.errors.push(e.message));art.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await art.goto('http://127.0.0.1:5173/tools/scene-review.html?view=capsule');await art.waitForFunction(()=>document.body.dataset.ready==='true');
 // Reuse geometry, textures and compiled shaders across the same thirteen views and night variant.
 for(const view of ['capsule','interior','cave','grass','valley','ice','ore','door','flank','berth','copper','canyon','crater']){
  const rendered=await art.evaluate(view=>window.__vireonReview.show(view,false),view);assert.ok(rendered.drawCalls>0,`${view}: real WebGL draw calls required`);report.reviewViews.push(rendered);
  await art.screenshot({path:'artifacts/b4-model-'+view+'.png'});
 }
 const nightRendered=await art.evaluate(()=>window.__vireonReview.show('capsule',true));assert.ok(nightRendered.drawCalls>0);report.reviewViews.push(nightRendered);await art.screenshot({path:'artifacts/b4-model-night.png'});await art.close();check('All thirteen close-up model views and night variant render');
 assert.deepEqual(report.errors,[]);check('No browser console errors or uncaught exceptions');
 report.durationMs=Math.round(performance.now()-startedAt);
 await writeFile('artifacts/browser-verification.json',JSON.stringify(report,null,2)+'\n');
} finally {await browser?.close();if(production)await new Promise((resolve,reject)=>production.httpServer.close(e=>e?reject(e):resolve()));await server.close();}
