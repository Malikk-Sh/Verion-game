// Portable review artifact: inline the same bundled code and CSS, no runtime CDN requests.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
const result=await build({entryPoints:['src/main.ts'],bundle:true,minify:true,format:'iife',target:'es2022',write:false,outdir:'artifacts',legalComments:'eof'});
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=result.outputFiles.find(f=>f.path.endsWith('.css')).text;
let html=await readFile('index.html','utf8');
html=html.replace('<script type="module" src="/src/main.ts"></script>',()=>`<style>${css}</style><script>${js.replaceAll('</script','<\\/script')}</script>`);
const license=await readFile('node_modules/three/LICENSE','utf8');
html=html.replace('</head>',()=>`<!-- Three.js license\n${license}\n--></head>`);
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/vireon-verdana-b4.html',html);
await mkdir('preview',{recursive:true});
await writeFile('preview/vireon-verdana-b4.html',html);
await copyFile('node_modules/three/LICENSE','artifacts/THREE-LICENSE.txt');
console.log('Standalone artifact: artifacts/vireon-verdana-b4.html');
