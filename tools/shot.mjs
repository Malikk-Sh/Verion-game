// Dev screenshots of the S1.1 UI at a given viewport: node tools/shot.mjs 844 390 prefix
import { chromium } from 'playwright';
import { createServer } from 'vite';
const [W='844',H='390',P='ui']=process.argv.slice(2);
const server=await createServer({server:{host:'127.0.0.1',port:5175,strictPort:true},logLevel:'error'});await server.listen();
const browser=await chromium.launch({headless:true,executablePath:process.env.VIREON_CHROMIUM_PATH,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try{
 const ctx=await browser.newContext({viewport:{width:+W,height:+H},hasTouch:true,deviceScaleFactor:2});
 await ctx.addInitScript(()=>localStorage.setItem('vireon.settings',JSON.stringify({quality:'low',sound:false})));
 const page=await ctx.newPage();page.setDefaultTimeout(240000);
 const errs=[];page.on('pageerror',e=>errs.push(e.message));page.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
 await page.goto('http://127.0.0.1:5175/');await page.waitForFunction(()=>document.body.dataset.ready==='true');
 await page.$eval('#start',e=>e.click());await page.waitForFunction(()=>window.__vireon.getState().running);
 await page.waitForTimeout(3500);
 await page.evaluate(()=>window.__vireon.teleport(67.3,61.6,0.05,-0.12));await page.waitForTimeout(1500);
 await page.screenshot({path:`artifacts/${P}-hud.png`});
 await page.keyboard.press('KeyI');await page.waitForTimeout(600);await page.screenshot({path:`artifacts/${P}-inventory.png`});
 await page.$eval('#open-suit',e=>e.click());await page.waitForTimeout(3000);await page.screenshot({path:`artifacts/${P}-suit.png`});
 console.log('errors',JSON.stringify(errs));
}finally{await browser.close();await server.close();}
