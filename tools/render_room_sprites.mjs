// Renders the S4 glass-block and airlock sprites from the in-game models (design_rooms §5) and records them in
// docs/art/ui/CRAFT_SPRITE_MANIFEST.json ("rendered from in-game model"). Chromium headless, SwiftShader WebGL.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const server = await createServer({ server: { host: '127.0.0.1', port: 5193, strictPort: true }, logLevel: 'error' }); await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.VIREON_CHROMIUM_PATH, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
try {
 const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
 await page.goto('http://127.0.0.1:5193/tools/sprite-render.html');
 const manifestPath = 'docs/art/ui/CRAFT_SPRITE_MANIFEST.json', manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
 // Optional ids on the command line re-render only those sprites; the other manifest entries stay as they are.
 const only = process.argv.slice(2), rendered = (manifest.rendered ?? []).filter(r => only.length && !only.includes(r.id));
 for (const id of only.length ? only : ['window', 'airlock']) {
  const url = await page.evaluate(kind => import('/tools/sprite-render.ts').then(m => m.render(kind)), id);
  if (!url.startsWith('data:image/webp')) throw new Error('No WebP from the browser: ' + url.slice(0, 30));
  const bytes = Buffer.from(url.split(',')[1], 'base64'), path = `src/assets/items/${id}.webp`; writeFileSync(path, bytes);
  rendered.push({ id, generation_mode: 'rendered from in-game model', source: 'tools/render_room_sprites.mjs → tools/sprite-render.ts (' + (id === 'window' ? 'glass.ts chunkFaces + glassMaterial' : 'stationModels.ts buildDoor') + ')', game_path: path, game_dimensions: [512, 512], game_bytes: bytes.length, game_sha256: createHash('sha256').update(bytes).digest('hex'), transparent_background: true });
  console.log(id, bytes.length);
 }
 manifest.rendered = rendered.sort((a, b) => ['window', 'airlock'].indexOf(a.id) - ['window', 'airlock'].indexOf(b.id)); writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
 if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); await server.close(); }
