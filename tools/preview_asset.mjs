// In-game check of a generated sprite: decodes it in Chromium through Vite and renders it with the
// game's own itemArt() container (.art, object-fit: contain) at HUD/inventory/inspection sizes.
// Usage: node tools/preview_asset.mjs <image> [more images...]  →  artifacts/asset-preview.png + .json
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node tools/preview_asset.mjs <image>...'); process.exit(2); }
await mkdir('artifacts', { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5179, strictPort: true }, logLevel: 'error' });
await server.listen();
const errors = [];
let browser;
try {
 browser = await chromium.launch({ headless: true, executablePath: process.env.VIREON_CHROMIUM_PATH, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
 const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
 page.on('pageerror', e => errors.push(e.message));
 page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
 await page.addInitScript(() => localStorage.setItem('vireon.settings', JSON.stringify({ quality: 'low', sound: false })));
 await page.goto('http://127.0.0.1:5179');
 await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 60000 });
 const urls = files.map(f => `/@fs${resolve(f)}`);
 const result = await page.evaluate(async urls => {
  const { itemArt } = await import('/src/ui/art.ts');
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;gap:10px;justify-content:center;align-items:center;background:rgba(6,14,16,.72)';
  document.body.append(wrap);
  const out = [];
  for (const url of urls) {
   const row = document.createElement('div');
   row.style.cssText = 'display:flex;gap:14px;align-items:end';
   for (const px of [32, 48, 96, 200]) {
    const slot = document.createElement('div');
    slot.style.cssText = `width:${px}px;height:${px}px;border:1px solid rgba(110,230,220,.45);border-radius:6px;background:rgba(18,30,34,.6);display:grid`;
    const art = itemArt('stone'); art.style.cssText = 'width:100%;height:100%';
    const img = art.querySelector('img'); img.src = url;
    slot.append(art); row.append(slot);
   }
   wrap.append(row);
   const imgs = [...row.querySelectorAll('img')];
   await Promise.all(imgs.map(i => i.decode()));
   out.push({ url, natural: [imgs[0].naturalWidth, imgs[0].naturalHeight], contained: imgs.every(i => { const r = i.getBoundingClientRect(), p = i.parentElement.getBoundingClientRect(); return r.width <= p.width + 1 && r.height <= p.height + 1; }) });
  }
  return out;
 }, urls);
 for (const r of result) { assert.ok(r.natural[0] > 0, `${r.url} did not decode`); assert.ok(r.contained, `${r.url} overflows its slot`); }
 assert.deepEqual(errors, [], 'Console errors');
 await page.screenshot({ path: 'artifacts/asset-preview.png' });
 await writeFile('artifacts/asset-preview.json', JSON.stringify({ files, result, errors }, null, 2));
 console.log(JSON.stringify(result, null, 1), '\nPASS: decoded and rendered in game UI → artifacts/asset-preview.png');
} finally {
 await browser?.close();
 await server.close();
}
