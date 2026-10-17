import {chromium} from 'playwright';
import {createServer} from 'vite';
import {writeFile} from 'node:fs/promises';
const OUT=process.env.OUT;
const server=await createServer({server:{host:'127.0.0.1',port:5197,strictPort:true}});await server.listen();
const browser=await chromium.launch({headless:true,executablePath:process.env.VIREON_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
const ctx=await browser.newContext({viewport:{width:960,height:540}});await ctx.addInitScript(()=>localStorage.setItem('vireon.settings',JSON.stringify({quality:'high',sound:false,bob:false})));
const page=await ctx.newPage();page.setDefaultTimeout(300000);
await page.goto('http://127.0.0.1:5197');await page.waitForFunction(()=>document.body.dataset.ready==='true');await page.click('#start');await page.waitForFunction(()=>document.body.dataset.running==='true');
await page.evaluate(async()=>{const R=await import('/src/game/rooms.ts');const s=window.__vireon.snapshot(),door=R.newDoor('door-'+s.world.base.nextId,57,0,45,0),keys=R.doorKeys(door);
 s.world.base.glass=R.shellOf(R.boxCells(56,0,42,3,3,3)).filter(k=>!keys.includes(k)).sort((a,b)=>a-b);s.world.base.doors=[door];s.world.base.zones=[];s.world.base.nextId++;window.__vireon.setState(s);});
await page.waitForFunction(()=>window.__vireon.getState().terrainSettled===true,null,{timeout:500000});
const views=[['out-front',58,48.5,Math.PI,-.1],['out-side',61,48,Math.atan2(58-61,45.5-48)+Math.PI,-.15],['in-chamber',58,45.5,0,0],['in-room',57.6,43,Math.PI,-.05]];
for(const [name,x,z,yaw,pitch] of views){
 await page.evaluate(([x,z,yaw,pitch])=>window.__vireon.teleport(x,z,yaw,pitch),[x,z,yaw,pitch]);
 await page.waitForTimeout(1500);
 for(let i=0;i<2;i++){await page.evaluate(([x,z,yaw,pitch,i])=>window.__vireon.teleport(x+i*.003,z,yaw+i*.0015,pitch),[x,z,yaw,pitch,i]);await page.waitForTimeout(700);await page.screenshot({path:`${OUT}/${name}-${i}.png`});}
}
await browser.close();await server.close();
