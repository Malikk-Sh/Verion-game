/** S2 integration: actual controls → simulation → IndexedDB → reload. Correctness, not FPS. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer, preview } from 'vite';
await mkdir('artifacts', { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5176, strictPort: true } });
await server.listen();
const report = { checks: [], errors: [], environment: 'Headless Chromium / SwiftShader; correctness only; no phone FPS measurement.' };
const check = name => { report.checks.push(name); console.log('PASS:', name); };
let browser, production;
try {
 let launch = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] };
 if (process.env.VIREON_CHROMIUM_PATH) launch.executablePath = process.env.VIREON_CHROMIUM_PATH;
 if (process.env.VIREON_CHROMIUM_MODULE) {
  const c = (await import(process.env.VIREON_CHROMIUM_MODULE)).default;
  launch = { ...launch, executablePath: await c.executablePath(), args: [...c.args.filter(x => !['--disable-web-security', '--allow-running-insecure-content'].includes(x)), ...launch.args] };
 }
 browser = await chromium.launch(launch);
 const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
 await context.addInitScript(() => {
  localStorage.setItem('vireon.settings', JSON.stringify({ quality: 'low', sound: false }));
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = fn => raf(t => setTimeout(() => fn(t), 150));
 });
 const page = await context.newPage(); page.setDefaultTimeout(60000);
 const watch = p => { p.on('pageerror', e => report.errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); }); };
 watch(page);
 const state = () => page.evaluate(() => window.__vireon.getState());
 const snapshot = () => page.evaluate(() => window.__vireon.snapshot());
 const click = sel => page.$eval(sel, e => e.click());
 const configure = async mutate => {
  await click('#pause-button');
  await page.evaluate(() => window.__vireon.save());
  await page.evaluate(mutate);
  await click('#resume');
 };
 const reopen = async () => {
  await page.reload(); await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await click('#continue');
  await page.waitForFunction(() => { const s = window.__vireon.getState(); return s.running || ['lease-panel', 'death-panel'].includes(s.dialog); });
  if ((await state()).dialog === 'lease-panel') await click('#lease-primary');
  await page.waitForFunction(() => { const s = window.__vireon.getState(); return s.running || s.dialog === 'death-panel'; });
 };
 await page.goto('http://127.0.0.1:5176'); await page.waitForFunction(() => document.body.dataset.ready === 'true');
 report.webgl = await page.evaluate(() => { const gl = document.getElementById('world').getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); });
 assert.match(report.webgl, /SwiftShader/i);
 await click('#start'); await page.waitForFunction(() => window.__vireon.getState().running);
 assert.equal((await state()).version, 'S2.7'); check('S2.2 starts with real WebGL rendering and a saved starting kit');

 await configure(() => { const s = window.__vireon.snapshot(); s.player.vitals = { health: 80, satiety: 50 }; s.player.hotbar = 1; window.__vireon.setState(s); });
 await page.waitForFunction(() => window.__vireon.getState().action === 'eat');
 await page.keyboard.press('KeyF');
 const eaten = await snapshot(); assert.equal(eaten.player.vitals.satiety, 58); assert.equal(eaten.player.inventory[1].count, 3);
 assert.equal(eaten.player.vitals.health, 81); check('Selected pulp is edible inside the capsule; landmark scanning cannot override food');

 await configure(() => { const s = window.__vireon.snapshot(); s.player.hotbar = 0; s.world.capsuleMilliGU = 1000000; window.__vireon.setState(s); });
 await page.waitForFunction(() => window.__vireon.getState().action === 'capsule');
 const before = await snapshot(); await page.keyboard.press('KeyF');await page.locator('.machine-process summary').click();await page.getByRole('button',{name:'Баллоны → капсула',exact:true}).click();
 await page.waitForFunction(n => window.__vireon.getState().capsuleMilliGU > n + 15000, before.world.capsuleMilliGU);
 await click('#close-production'); await click('#pause-button'); await page.evaluate(() => window.__vireon.save());
 const after = await snapshot();
 const total = s => s.world.capsuleMilliGU + s.player.bottles.reduce((n, b) => n + (b?.milliGU ?? 0), 0);
 assert.ok(after.world.capsuleMilliGU > before.world.capsuleMilliGU);
 assert.equal(total(before) - total(after), (after.meta.activeTicks - before.meta.activeTicks) * 50);
 check('Explicit capsule port transfers installed bottle gas into capsule; total oxygen only decreases by breathing');
 await click('#resume');

 await page.evaluate(() => window.__vireon.teleport(67, 61.6, 0, -.28));
 await page.waitForFunction(() => window.__vireon.getState().aimNode === 'iron-a');
 assert.equal(await page.locator('#aim').isVisible(), true);
 await page.evaluate(() => window.__vireon.teleport(58, 48, 0, 1.1));
 await page.waitForFunction(() => !window.__vireon.getState().aimNode && document.getElementById('aim').hidden);
 assert.equal(await page.locator('#aim-name').textContent(), ''); check('Leaving a resource target hides and clears the old reticle label');

 await configure(() => { const s = window.__vireon.snapshot(); s.player.bottles[0].milliGU = 24000; window.__vireon.setState(s); });
 await page.waitForFunction(() => document.getElementById('survival-alert-text').textContent === 'КИСЛОРОД КРИТИЧЕСКИ НИЗКИЙ');
 await page.evaluate(() => { window.alertMutations = 0; new MutationObserver(m => window.alertMutations += m.length).observe(document.getElementById('survival-alert-text'), { childList: true, characterData: true, subtree: true }); });
 const warningStart = await snapshot();
 await page.waitForFunction(n => window.__vireon.getState().activeTicks >= n + 20, warningStart.meta.activeTicks);
 const warningEnd = await snapshot();
 assert.equal(warningStart.player.bottles[0].milliGU - warningEnd.player.bottles[0].milliGU, (warningEnd.meta.activeTicks - warningStart.meta.activeTicks) * 50);
 assert.equal(await page.evaluate(() => window.alertMutations), 0);
 assert.equal(await page.locator('#g-oxygen').getAttribute('data-low'), 'true');
 check('Outside O₂ reflects only bottle capacity; repeated updates do not repeat assertive warning text');
 await page.screenshot({ path: 'artifacts/s2-critical-oxygen.png' });


 await configure(() => { const s = window.__vireon.snapshot(); s.player.vitals = { health: 80, satiety: 0 }; s.player.survival.starvationMs = 30000; s.player.bottles[0].milliGU = 240000; window.__vireon.setState(s); window.__vireon.teleport(58, 48, 0, 1.1); });
 const hungry = await state(); await page.keyboard.down('KeyW');
 await page.waitForFunction(n => window.__vireon.getState().activeTicks >= n + 20, hungry.activeTicks);
 await page.keyboard.up('KeyW'); const slower = await state();
 const hungrySeconds = (slower.activeTicks - hungry.activeTicks) * .05;
 assert.ok(Math.abs(hungry.vitals.health - slower.vitals.health - hungrySeconds * .5) < 1e-6);
 assert.ok(slower.position.z - hungry.position.z > 1);
 assert.ok(slower.position.z - hungry.position.z <= 3.5 * .8 * hungrySeconds + .01);
 check('Actual walking slows to 80% while starvation damages health at 0.5 HP/s');
 const rev = (await state()).revision;
 await configure(() => { const s = window.__vireon.snapshot(); s.player.vitals.health = .1; s.player.survival.suffocationMs = 6000; s.player.survival.recoveryMs = 0; s.player.survival.emergencyMs = 0; s.world.capsuleMilliGU = 0; s.player.bottles[0].milliGU = 0; window.__vireon.setState(s); });
 await page.waitForFunction(() => window.__vireon.getState().dialog === 'death-panel');
 await page.waitForFunction(n => { const s = window.__vireon.getState(); return s.saveStatus === 'saved' && s.revision > n; }, rev);
 const dead = await state(); assert.equal(dead.vitals.health, 0); assert.equal(dead.drops, 1); assert.equal(dead.visibleDrops, 1);
 assert.equal(dead.inventory.length, 0);
 await page.waitForTimeout(500); assert.equal((await state()).activeTicks, dead.activeTicks);
 check('Death drops cargo visibly, stops time, and commits immediately without waiting for autosave');
 for (const [width, height] of [[844, 390], [667, 320]]) {
  await page.setViewportSize({ width, height });
  await page.evaluate(async () => { await Promise.all(document.getElementById('death-panel').getAnimations().map(a => a.finished)); });
  const bounds = await page.locator('#respawn-capsule').boundingBox();
  assert.ok(bounds.width >= 32 && bounds.height >= 32 && bounds.x >= 0 && bounds.y >= 0 && bounds.y + bounds.height <= height);
 }
 await page.screenshot({ path: 'artifacts/s2-death.png' });
 await page.setViewportSize({ width: 844, height: 390 });
 await reopen(); assert.equal((await state()).dialog, 'death-panel'); assert.equal((await state()).drops, 1);
 check('Reload of the death revision remains on the death screen with the same cargo');
 await click('#respawn-capsule'); await page.waitForFunction(() => window.__vireon.getState().running);
 const respawn = await state(); assert.equal(respawn.vitals.health, 50); assert.equal(respawn.vitals.satiety, 40);
 assert.ok(respawn.survival.emergencyMs > 85000 && respawn.survival.emergencyMs <= 90000);
 assert.equal(respawn.oxygenGU, 0); assert.equal(respawn.capsuleMilliGU, 0); assert.equal(respawn.drops, 1);
 check('Explicit respawn gives 50 HP / 40 satiety and personal emergency air without creating gas or items');
 await page.waitForFunction(() => document.getElementById('g-oxygen').querySelector('small').textContent === 'с');
 await page.screenshot({ path: 'artifacts/s2-emergency.png' });
 await page.waitForFunction(n => window.__vireon.getState().survival.emergencyMs < n - 1000, respawn.survival.emergencyMs);
 await click('#pause-button'); await page.evaluate(() => window.__vireon.save());
 const reserve = (await snapshot()).player.survival.emergencyMs;
 await reopen(); assert.ok((await state()).survival.emergencyMs <= reserve);
 assert.ok((await state()).survival.emergencyMs > reserve - 3000);
 check('Reload preserves the reduced emergency reserve; it cannot reset to 90 seconds');
 const drop = (await snapshot()).world.drops[0];
 await page.evaluate(d => window.__vireon.teleport(d.x, d.z, 0, 1.1), drop);
 await page.waitForFunction(() => window.__vireon.getState().action === 'pickup'); await page.keyboard.press('KeyF');
 assert.equal((await state()).drops, 0); assert.equal((await state()).visibleDrops, 0);
 assert.ok((await state()).inventory.some(x => x.itemId === 'tool_stone')); check('Saved cargo can be recovered after death, respawn and reload');
 await page.close();

 production = await preview({ preview: { host: '127.0.0.1', port: 5177, strictPort: true } });
 const prod = await context.newPage(); watch(prod);
 await prod.goto('http://127.0.0.1:5177'); await prod.waitForFunction(() => document.body.dataset.ready === 'true');
 const helpers = await prod.evaluate(() => ({ teleport: typeof window.__vireon.teleport, setState: typeof window.__vireon.setState }));
 assert.deepEqual(helpers, { teleport: 'undefined', setState: 'undefined' }); check('Production omits test mutation and teleport helpers');
 assert.deepEqual(report.errors, []); check('No browser console errors');
} catch (e) { report.failure = String(e?.stack || e); console.error(e); process.exitCode = 1; }
finally {
 await writeFile('artifacts/s2-verification.json', JSON.stringify(report, null, 2) + '\n');
 await browser?.close(); await server.close();
 if (production) await new Promise(resolve => production.httpServer.close(resolve));
}
