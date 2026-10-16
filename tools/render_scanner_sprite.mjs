// Renders the S5 scanner sprite from its in-game hand model (src/viewmodel.ts HAND_MODELS.scanner) and records it in
// docs/art/ui/CRAFT_SPRITE_MANIFEST.json under `rendered_tools` ("rendered from in-game model"). Chromium headless, SwiftShader.
// VIREON_CHROMIUM_PATH=… node tools/render_scanner_sprite.mjs
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const server = await createServer({ server: { host: '127.0.0.1', port: 5194, strictPort: true }, logLevel: 'error' }); await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.VIREON_CHROMIUM_PATH, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
try {
 const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
 await page.goto('http://127.0.0.1:5194/tools/sprite-render.html');
 const url = await page.evaluate(() => import('/tools/scanner-sprite.ts').then(m => m.render()));
 if (!url.startsWith('data:image/webp')) throw new Error('No WebP from the browser: ' + url.slice(0, 30));
 const bytes = Buffer.from(url.split(',')[1], 'base64'), path = 'src/assets/items/scanner.webp'; writeFileSync(path, bytes);
 const manifestPath = 'docs/art/ui/CRAFT_SPRITE_MANIFEST.json', manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
 manifest.rendered_tools = [{ id: 'scanner', generation_mode: 'rendered from in-game model', source: 'tools/render_scanner_sprite.mjs → tools/scanner-sprite.ts (viewmodel.ts HAND_MODELS.scanner)', game_path: path, game_dimensions: [512, 512], game_bytes: bytes.length, game_sha256: createHash('sha256').update(bytes).digest('hex'), transparent_background: true }];
 writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n'); console.log('scanner', bytes.length);
 if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); await server.close(); }
