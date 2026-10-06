/** Install the pinned headless shell; install OS libraries only if the runner needs them. */
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

function install(...args) {
 const result=spawnSync('npx',['--no-install','playwright',...args],{stdio:['inherit','inherit','pipe'],encoding:'utf8'});
 if(result.stderr)process.stderr.write(result.stderr);
 if(result.error)throw result.error;
 if(result.status!==0)throw new Error(`Playwright ${args.join(' ')} failed (${result.status}): ${result.stderr}`);
}
async function smoke() {
 const browser=await chromium.launch({headless:true,executablePath:process.env.VIREON_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
 await browser.close();
}
try {
 if(!process.env.VIREON_CHROMIUM_PATH)install('install','--only-shell','chromium');
 await smoke();
 console.log('Chromium ready; system dependencies already available');
} catch(error) {
 if(!/missing dependencies|error while loading shared libraries|cannot open shared object file/i.test(String(error)))throw error;
 console.log('Installing missing Chromium system dependencies');
 install('install-deps','chromium');
 if(!process.env.VIREON_CHROMIUM_PATH)install('install','--only-shell','chromium');
 await smoke();
}
