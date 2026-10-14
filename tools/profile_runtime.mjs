/** Reproducible local CPU attribution, real RAF and finite craft; software GPU, not device FPS. */
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const tag=process.argv[2]||'sample';
if(!/^[a-zA-Z0-9_-]{1,40}$/.test(tag))throw new Error('Profile tag: use 1–40 letters, digits, underscores or hyphens');
await mkdir('artifacts',{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:5187,strictPort:true}});await server.listen();
let browser;const report={tag,environment:'844x390 Chromium SwiftShader, real RAF; not device GPU/FPS',errors:[],stages:[]};
try{
 let launch={headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']};
 if(process.env.VIREON_CHROMIUM_PATH)launch.executablePath=process.env.VIREON_CHROMIUM_PATH;
 if(process.env.VIREON_CHROMIUM_MODULE){const c=(await import(process.env.VIREON_CHROMIUM_MODULE)).default;launch={...launch,executablePath:await c.executablePath(),args:[...c.args.filter(x=>!['--disable-web-security','--allow-running-insecure-content'].includes(x)),...launch.args]};}
 browser=await chromium.launch(launch);
 const page=await browser.newPage({viewport:{width:844,height:390}});page.setDefaultTimeout(90000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('vireon.settings',JSON.stringify({quality:'low',sound:false,bob:false}));window.__probe={gaps:[],tasks:[]};let prev;function tick(now){if(prev)window.__probe.gaps.push(now-prev);prev=now;requestAnimationFrame(tick);}requestAnimationFrame(tick);if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(es=>es.getEntries().forEach(e=>window.__probe.tasks.push({at:e.startTime,ms:e.duration}))).observe({type:'longtask',buffered:true});});
 const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});
 async function profile(name,fn){await page.evaluate(()=>{if(window.__probe){window.__probe.gaps=[];window.__probe.tasks=[];}});await cdp.send('Profiler.start');const start=Date.now();await fn();const {profile}=await cdp.send('Profiler.stop');await writeFile(`artifacts/s27-${tag}-${name}.cpuprofile`,JSON.stringify(profile));const nodes=new Map(profile.nodes.map(n=>[n.id,n]));const totals=new Map();profile.samples?.forEach((id,i)=>{const n=nodes.get(id).callFrame,k=`${n.functionName||'(anon)'} ${n.url.replace(/http:\/\/127.0.0.1:5187/,'')}:${n.lineNumber+1}`;totals.set(k,(totals.get(k)||0)+(profile.timeDeltas[i]||0)/1000);});const probe=await page.evaluate(()=>window.__probe);const gaps=probe.gaps.sort((a,b)=>a-b);const data={name,elapsedMs:Date.now()-start,frames:gaps.length,p95:gaps[Math.floor(gaps.length*.95)],max:gaps.at(-1),tasks:probe.tasks,top:[...totals].sort((a,b)=>b[1]-a[1]).slice(0,18)};report.stages.push(data);console.log(JSON.stringify({...data,tasks:data.tasks.slice(-8)}));}
 await profile('cold',async()=>{await page.goto('http://127.0.0.1:5187');await page.waitForFunction(()=>document.body.dataset.ready==='true');await page.waitForTimeout(3500);});
 await page.locator('#start').click();await page.waitForFunction(()=>document.body.dataset.running==='true');
 await profile('idle',async()=>{await page.waitForTimeout(6500);});
 await page.locator('#pause-button').click();await page.evaluate(async()=>{const {addItems}=await import('/src/game/inventory.ts');const s=window.__vireon.snapshot();addItems(s.player.inventory,'grass',3);addItems(s.player.inventory,'stone',8);addItems(s.player.inventory,'fiber',5);window.__vireon.setState(s);});await page.locator('#resume').click();
 await profile('craft',async()=>{await page.keyboard.press('b');await page.locator('[data-recipe="craft_workbench"]').click();await page.locator('.craft-primary').click();await page.waitForFunction(()=>!window.__vireon.snapshot().world.base.hand);await page.waitForTimeout(1300);await page.screenshot({path:`artifacts/s27-${tag}-craft.png`});});
 await page.locator('#close-production').click();await page.evaluate(()=>window.__vireon.teleport(43,52,.08,-.55));
 await profile('grass',async()=>{await page.waitForTimeout(5000);await page.screenshot({path:`artifacts/s27-${tag}-grass.png`});});
 await page.keyboard.down('w');await profile('walk',async()=>{await page.waitForTimeout(4000);});await page.keyboard.up('w');
 report.final=await page.evaluate(()=>window.__vireon.getState());
} catch(e){report.failure=String(e.stack||e);throw e;} finally {await writeFile(`artifacts/s27-${tag}-profile.json`,JSON.stringify(report,null,2));await browser?.close();await server.close();}
