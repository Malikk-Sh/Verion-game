import { createCraftingView } from './crafting';
import { machine, nearby, RECIPES } from '../game/production';
import { ITEMS } from '../game/defs';
import type { GameState } from '../game/state';
import type { GuideTarget } from '../game/guide';
import { machineView, tickMachine } from './machines';
import { itemArt } from './art';
import { isDragging } from './dragDrop';
import './station.css';
type Host = { game(): GameState | null; show(): void; close(): void; changed(): void; refill(id: string | null): void; tone(ok: boolean): void; measure?(name: string, ms: number): void; navigate?(t: GuideTarget): void; insideCapsule?(): boolean };
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const KICKER: Record<string, string> = { workbench: 'Сборка деталей и станций', kiln: 'Плавка · топливо — волокно', biogenerator: 'Энергия для станций', electrolyzer: 'Вода → кислород', refill: 'Заправка баллонов', distributor: 'Климат и воздух купола', dome: 'Герметичное убежище' };
/**
 * Station window host (S3): one header with the station icon and purpose, a station switcher for
 * crafting, a floating feedback chip and either the workshop or a machine view.
 */
export function createProductionPanel(host: Host) {
 const crafting = createCraftingView(); let station = 'hand', message = '', messageTone: 'ok' | 'warn' | 'amber' = 'ok', messageAt = 0, fresh = true;
 const say = (reason: string, success = 'Готово') => { message = reason || success; messageTone = reason ? 'warn' : 'ok'; messageAt = performance.now(); host.tone(!reason); if (!reason) host.changed(); draw(); };
 /** A caution that asks to repeat the action (amber chip), nothing changed yet. */
 const caution = (text: string) => { message = text; messageTone = 'amber'; messageAt = performance.now(); host.tone(false); draw(); };
 // A rebuild between pointerdown and pointerup replaces the pressed button and swallows the tap (seen in CI on «Пройти
 // шлюз»); a drag needs its cells too. While a pointer is held in the window, rebuilds wait and run once after release —
 // a little later, so the click that ends the press still reaches the button it started on.
 // A primary pointerdown means no other pointer is still down, so a release that never arrived cannot hold rebuilds; the
 // 5 s cap covers a finger simply resting on the window. Listeners capture, so no handler can hide the release.
 const held = new Set<number>(); let heldAt = 0, deferred = false;
 const holding = () => isDragging() || (held.size > 0 && performance.now() - heldAt < 5000);
 el('production-panel').addEventListener('pointerdown', e => { if (e.isPrimary) held.clear(); held.add(e.pointerId); heldAt = performance.now(); }, true);
 const release = (e: PointerEvent) => { if (!held.delete(e.pointerId) || !deferred) return; setTimeout(() => { if (deferred && !holding() && !el('production-panel').hidden) draw(); }, 150); };
 addEventListener('pointerup', release, true); addEventListener('pointercancel', release, true);
 function open(id = 'hand', upgrade = false) {
  const g = host.game();
  // B near a workbench opens that workbench: the most useful station is the one in reach.
  if (id === 'hand' && g) { const b = g.world.base.buildings.filter(b => b.kind === 'workbench' && nearby(g, b)).sort((a, c) => Math.hypot(a.x - g.player.x, a.z - g.player.z) - Math.hypot(c.x - g.player.x, c.z - g.player.z))[0]; if (b) id = b.id; }
  station = id; host.refill(null); crafting.open(id, upgrade); message = ''; fresh = true; host.show();
 }
 function openRecipe(recipeId: string) {
  const g = host.game(); if (!g) return; const r = RECIPES.find(r => r.id === recipeId); let id = 'hand';
  if (r && r.station !== 'hand') { const b = g.world.base.buildings.filter(b => b.kind === r.station && nearby(g, b))[0]; if (b) id = b.id; }
  station = id; host.refill(null); crafting.open(id, false, recipeId); message = ''; fresh = true; host.show();
 }
 el('close-production').onclick = () => { host.refill(null); host.close(); };
 function tabs(g: GameState, craft: boolean) {
  const box = el('production-tabs'); box.replaceChildren(); if (!craft) return;
  const options: [string, string][] = [['hand', 'Карман']];
  for (const b of g.world.base.buildings) if (b.kind === 'workbench' && nearby(g, b)) options.push([b.id, 'Верстак ' + (b.level === 2 ? 'II' : 'I')]);
  if (options.length < 2) return;
  for (const [id, label] of options) { const t = document.createElement('button'); t.type = 'button'; t.className = 'st-tab'; t.textContent = label; t.setAttribute('role', 'tab'); t.setAttribute('aria-selected', String(id === station)); t.onclick = () => { if (id === station) return; station = id; crafting.open(id); fresh = true; host.tone(true); draw(); }; box.append(t); }
 }
 function draw() {
  const at = performance.now(); const g = host.game(); if (!g) return;
  if (holding() && !el('production-panel').hidden) { deferred = true; return; }
  deferred = false;
  const focus = document.activeElement as HTMLInputElement | null, search = focus?.id === 'craft-search', cursor = search ? [focus.selectionStart, focus.selectionEnd] : null;
  const b = machine(g, station), craft = station === 'hand' || b?.kind === 'workbench', panel = el('production-panel'), content = el('production-content');
  // The station was packed into the backpack ("Забрать"): nothing left to show, close the window.
  if (!b && station !== 'hand' && station !== 'capsule' && !station.startsWith('crate-')) { host.refill(null); if (!panel.hidden) host.close(); return; }
  panel.classList.toggle('crafting-panel', craft); panel.classList.toggle('machine-panel', !craft);
  // Entrance motion plays once per opening, not on every live redraw.
  panel.classList.toggle('redraw', !fresh); fresh = false;
  const title = station === 'hand' ? 'Мастерская' : b?.kind === 'workbench' ? 'Верстак ' + (b.level === 2 ? 'II' : 'I') : station === 'capsule' ? 'Капсула' : station.startsWith('crate-') ? 'Ящик снабжения' : b ? ITEMS[b.kind].name : 'Станция';
  panel.querySelector('h2')!.textContent = title;
  el('production-kicker').textContent = station === 'hand' ? 'Карманный крафт · где угодно' : station === 'capsule' ? 'Кислородный порт' : station.startsWith('crate-') ? '24 ячейки · хранение' : b ? KICKER[b.kind] ?? '' : '';
  const icon = el('production-icon'), iconId = station === 'hand' ? 'fiber' : station === 'capsule' ? 'oxygen' : station.startsWith('crate-') ? 'stone' : b ? (b.kind === 'workbench' && b.level === 2 ? 'workbench_2' : b.kind) : 'workbench';
  if (icon.dataset.item !== iconId) { icon.dataset.item = iconId; icon.replaceChildren(itemArt(iconId)); }
  tabs(g, craft);
  const chip = el('production-message'); chip.textContent = message; chip.dataset.tone = messageTone; chip.hidden = !message || performance.now() - messageAt > 2600;
  if (message && !chip.hidden) { chip.classList.remove('show'); void chip.offsetWidth; chip.classList.add('show'); }
  content.replaceChildren();
  if (craft) {
   const view = crafting.draw(g, station, say, host.changed, draw, t => { host.navigate?.(t); });
   content.append(view); panel.classList.toggle('craft-upgrade-panel', view.dataset.mode === 'upgrade'); if (view.dataset.mode === 'upgrade') panel.querySelector('h2')!.textContent = 'Улучшение верстака';
   if (search) { const input = el<HTMLInputElement>('craft-search'); if (input) { input.focus({ preventScroll: true }); input.setSelectionRange(cursor![0] ?? 0, cursor![1] ?? 0); } }
  } else { panel.classList.remove('craft-upgrade-panel'); content.append(machineView(g, station, { say, caution, changed: host.changed, draw, refill: host.refill, nav: t => host.navigate?.(t), inside: () => host.insideCapsule?.() ?? false })); tick(); }
  message = performance.now() - messageAt > 2600 ? '' : message;
  host.measure?.('production:draw', performance.now() - at);
 }
 function tick() { const g = host.game(); if (!g) return; const b = machine(g, station); if (station === 'hand' || b?.kind === 'workbench') crafting.tick(g, station); else tickMachine(g, station); const chip = el('production-message'); if (!chip.hidden && performance.now() - messageAt > 2600) chip.hidden = true; }
 return { open, openRecipe, openUpgrade: (id: string) => open(id, true), draw, tick, clear: () => host.refill(null), get station() { return station; } };
}
