// Raster art review: real persisted fixture, UI interactions, responsive screenshots and separate equipment layers.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
await mkdir('artifacts', { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5176, strictPort: true }, logLevel: 'error' });
await server.listen();
const report = { checks: [], errors: [], screenshots: [], environment: 'Chromium, SwiftShader; visual correctness, not phone FPS' };
let browser;
const check = name => { report.checks.push(name); console.log('PASS:', name); };
const compactOnly = process.argv.includes('--compact');
const viewports = compactOnly ? [[667, 320]] : [[844, 390], [1366, 768], [667, 320]];
try {
 browser = await chromium.launch({ headless: true, executablePath: process.env.VIREON_CHROMIUM_PATH, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
 const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, deviceScaleFactor: 1 });
 await ctx.addInitScript(() => localStorage.setItem('vireon.settings', JSON.stringify({ quality: 'low', sound: false })));
 const page = await ctx.newPage(); page.setDefaultTimeout(30000);
 const watch = p => { p.on('pageerror', e => report.errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); }); };
 watch(page);
 const ready = () => page.waitForFunction(() => document.body.dataset.ready === 'true');
 const click = sel => page.$eval(sel, e => e.click());
 const loaded = () => page.waitForFunction(() => [...document.querySelectorAll('img')].filter(e => e.getClientRects().length).every(e => e.complete && e.naturalWidth > 0));
 const shot = async name => {
  await loaded();
  await page.waitForFunction(() => window.__vireon.getState().dialog || Number(getComputedStyle(document.getElementById('hud')).opacity) > .99);
  await page.evaluate(async () => { await Promise.all([...document.querySelectorAll('.panel:not([hidden])')].flatMap(e => e.getAnimations()).map(a => a.finished.catch(() => {}))); });
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.art img')].filter(e => e.getClientRects().length).filter(e => { const r = e.getBoundingClientRect(), p = e.parentElement.getBoundingClientRect(); return r.left < p.left - 1 || r.top < p.top - 1 || r.right > p.right + 1 || r.bottom > p.bottom + 1; }).map(e => e.parentElement.dataset.item));
  assert.deepEqual(overflow, [], 'Sprites overflow their containers');
  const path = `artifacts/sprites-${name}.png`; await page.screenshot({ path }); report.screenshots.push(path);
 };
 await page.goto('http://127.0.0.1:5176'); await ready();
 await page.evaluate(async () => {
  const [{ newGame }, { SaveStore }, { heightAt }] = await Promise.all([import('/src/game/state.ts'), import('/src/persist/store.ts'), import('/src/world.ts')]);
  const g = newGame('w-art-review', 12345, Date.now(), heightAt(40, 42), 'Проверка спрайтов');
  g.player.inventory[0].durability = 106;
  [['iron_raw', 4], ['copper_raw', 13], ['ice', 24], ['stone', 13]].forEach(([itemId, count], i) => g.player.inventory[i + 2] = { itemId, count });
  ['suit_helmet', 'suit_chest', 'suit_legs', 'suit_boots'].forEach((itemId, i) => g.player.inventory[i + 6] = { itemId, count: 1 });
  g.player.inventory[10] = { itemId: 'bottle_1', count: 1, milliGU: 120000 };
  const store = await SaveStore.open(); await store.createSlot(g, null); store.close();
 });
 await page.reload(); await ready(); await click('#continue'); await page.waitForFunction(() => window.__vireon.getState().running);
 await page.evaluate(() => window.__vireon.teleport(67.3, 61.6, 0.05, -0.12));
 await page.waitForTimeout(1500);
 await loaded();
 assert.equal(await page.locator('#hotbar .art img').count(), 6); check('Six hotbar slots use loaded raster sprites from backpack row 1');
 await click('#inventory-button'); await loaded();
 const art = await page.evaluate(async () => {
  const { ITEM_ART } = await import('/src/ui/art.ts');
  const { ITEMS } = await import('/src/game/defs.ts');
  return await Promise.all(Object.keys(ITEMS).map(async id => {
   const img = new Image(); img.src = ITEM_ART[id] || ''; await img.decode();
   const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
   const a = x.getImageData(0, 0, 512, 512).data;
   return { id, width: img.naturalWidth, cornerAlpha: a[3], opaque: a.some((n, i) => i % 4 === 3 && n > 250) };
  }));
 });
 assert.equal(art.length, 11); assert.ok(art.every(a => a.width === 512 && a.cornerAlpha < 3 && a.opaque));
 report.assets = art; check('All 11 current items load at 512px with transparent margins and solid object pixels');
 await page.keyboard.press('KeyI');
 for (const [w, h] of viewports) {
  await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(300);
  await shot(`${w}-hud`); await page.keyboard.press('KeyI'); await shot(`${w}-inventory`);
  const cells = await page.locator('#inventory-grid .cell').evaluateAll(es => es.map(e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }));
  assert.ok(cells.every(c => c.w >= 47.5 && c.h >= 47.5), 'Inventory cells must stay ≥48px');
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) { const a = cells[i], b = cells[j]; assert.ok(!(a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1), 'Inventory cells overlap'); }
  if (h <= 360) {
   await page.locator('#inventory-grid').evaluate(e => e.scrollTop = e.scrollHeight);
   await page.locator('#inv-detail').evaluate(e => e.scrollTop = e.scrollHeight);
   const reachable = await page.evaluate(() => ['#inventory-grid [data-cell="23"]', '#act-drop'].every(sel => { const e = document.querySelector(sel), r = e.getBoundingClientRect(), p = e.closest(sel.startsWith('#inventory-grid') ? '#inventory-grid' : '#inv-detail').getBoundingClientRect(); return r.top >= p.top - 1 && r.bottom <= p.bottom + 1; }));
   assert.ok(reachable, 'Scrolling must reveal the last backpack row and drop action');
   await shot(`${w}-inventory-scrolled`);
  }
  await click('#open-suit'); await shot(`${w}-suit`);
  const legs = await page.evaluate(() => {
   const figure = document.querySelector('#suit-figure .fig-legs img');
   const slot = document.querySelector('#part-grid [data-part="legs"] img');
   const r = figure.getBoundingClientRect();
   return { sameSprite: figure.src === slot.src, aspectError: Math.abs(r.width / r.height - figure.naturalWidth / figure.naturalHeight) };
  });
  assert.ok(legs.sameSprite && legs.aspectError < .01, 'Figure pants must match the equipment sprite without stretching');
  const boxes = await page.evaluate(() => [...document.querySelectorAll('#suit-figure .fig-part img, #part-grid .art img, #suit-detail .art img')].map(e => { const r = e.getBoundingClientRect(); return { width: r.width, height: r.height, inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; }));
  assert.ok(boxes.every(b => b.width > 0 && b.height > 0 && b.inside), JSON.stringify(boxes));
  await click('#close-suit');
 }
 check('HUD, inventory and suit raster layers fit at ' + viewports.map(([w,h]) => `${w}×${h}`).join(', '));
 await page.setViewportSize({ width: 844, height: 390 }); await click('#suit-button');
 await click('#part-grid [data-part="boots"]');
 assert.equal(await page.locator('.fig-boots.sel').count(), 1); assert.equal(await page.locator('.fig-helmet.sel').count(), 0);
 for (const part of ['helmet', 'legs', 'boots']) {
  await click(`#part-grid [data-part="${part}"]`);
  await page.locator('#suit-remove').hover(); await page.mouse.down();
  await page.waitForFunction(() => window.__vireon.getState().worn === 3, null, { timeout: 10000 }); await page.mouse.up();
  assert.equal(await page.locator(`.fig-${part}.off[data-worn="false"]`).count(), 1);
  if (part === 'legs') await shot('844-suit-removed');
  await click('#suit-replace'); await page.locator('#suit-detail .option').first().click();
  assert.equal(await page.locator(`.fig-${part}.off`).count(), 0);
 }
 check('Helmet, legs and boots remain independently selectable, removable and equipable');
 await ctx.close();
 assert.deepEqual(report.errors, []); check('No browser console or runtime errors');
} catch (e) { report.failure = String(e.stack || e); console.error(e); process.exitCode = 1; }
finally { await writeFile(`artifacts/sprite-${compactOnly ? 'compact-' : ''}verification.json`, JSON.stringify(report, null, 2) + '\n'); await browser?.close(); await server.close(); }
