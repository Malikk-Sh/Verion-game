import { installTank } from '../game/backpack';
import { ITEMS, TANKS } from '../game/defs';
import { loadMachineSlot, takeSlot, packStation, moveTank, moveTankGap, wearSlot, type TankPlace } from '../game/worldActions';
import { addItems, countItem, transferSlot, type Slot } from '../game/inventory';
import { machine, RECIPES, RECIPE_BY_ID, cancelJob, connect, disconnect, linkOptions, linkLength, endpoint, gasRate, powerRate, supplyRate, telemetry, ELECTROLYZER_O2, FIBER_EU, GEN_BUFFER, O2_PER_WU, PORT_O2, type Building } from '../game/production';
import { stationStatus, structureStatus, type StationStatus } from '../game/stationStatus';
import { capacityOf, doorById, doorKeys, doorRooms, habitableQ, removeDoor, removeGlass, type RoomEdit } from '../game/rooms';
import { CHAMBER_Q, doorStatus } from '../game/airlock';
import { CAPSULE_CAPACITY, lastAirText } from '../game/survival';
import type { GameState } from '../game/state';
import type { GuideTarget } from '../game/guide';
import { ghostArt, itemArt } from './art';
import { captureTokens, pulseCraft, transferCraft } from './craftMotion';
import { dragFrom } from './dragDrop';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
const button = (label: string, fn: () => void, cls = 'st-btn', disabled = false) => { const b = h('button', label, cls); b.type = 'button'; b.onclick = fn; b.disabled = disabled; return b; };
const peerName = (g: GameState, id: string) => id === 'capsule' ? 'Капсула' : ITEMS[machine(g, id)?.kind ?? '']?.name ?? id;
/** Items each machine accepts from the backpack; everything else is dimmed. */
const ACCEPTS: Record<string, string[]> = { kiln: ['iron_raw', 'copper_raw', 'sand', 'ice', 'fiber'], biogenerator: ['fiber'], electrolyzer: ['water', ...Object.keys(TANKS)] };
type Say = (error: string, success?: string) => void;
/** Oxygen buffer of a gas station in GU: the electrolyzer holds more than the refill/distributor ports (D30). */
const o2Max = (b: Building) => (b.kind === 'electrolyzer' ? ELECTROLYZER_O2 : PORT_O2) / 1000;
const ELECTROLYSIS = RECIPE_BY_ID.get('electrolysis')!;
/** Meter scale of an empty tank connector: the basic tank. */
const EMPTY_TANK = TANKS.bottle_1.capacity / 1000;
/** What a machine window needs from its host; `caution` shows an amber chip that asks to repeat the action. */
export type MachineHost = { say: Say; caution: (text: string) => void; changed: () => void; draw: () => void; refill: (id: string | null) => void; nav?: (t: GuideTarget) => void; inside: () => boolean; room?: RoomHost };
/** World side of the room window: effects after a glass/door edit, the red tint before air leaves. */
export type RoomHost = { edited(r: RoomEdit): void; tint(key: number): void };
type Ctx = MachineHost & { g: GameState; id: string };

function meter(key: string, label: string, value: number, max: number, unit: string, tone = '', mark?: number) {
 const box = h('div', '', 'st-meter ' + tone); box.dataset.meter = key;
 const top = h('div', '', 'st-meter-top'); top.append(h('span', label), h('b', `${Math.round(value)} / ${max} ${unit}`)); top.lastElementChild!.id = 'meter-' + key + '-value';
 const track = h('i', '', 'st-meter-track'), fill = h('b'); fill.id = 'meter-' + key; fill.style.transform = `scaleX(${Math.max(0, Math.min(1, value / max))})`; track.append(fill);
 if (mark !== undefined) { const m = h('span', '', 'st-meter-mark'); m.style.left = mark / max * 100 + '%'; track.append(m); }
 box.append(top, track); return box;
}
function setMeter(key: string, value: number, max: number, unit: string) {
 const f = document.getElementById('meter-' + key), v = document.getElementById('meter-' + key + '-value');
 if (f) f.style.transform = `scaleX(${Math.max(0, Math.min(1, value / max))})`;
 const t = `${Math.round(value)} / ${max} ${unit}`; if (v && v.textContent !== t) v.textContent = t;
}
function statusBlock(s: StationStatus) {
 const box = h('div', '', 'st-status'); box.dataset.tone = s.tone; box.id = 'st-status';
 const lamp = h('i', '', 'st-lamp'), text = h('div', '', 'st-status-text'), title = h('b', s.title), hint = h('span', s.hint);
 title.id = 'st-status-title'; hint.id = 'st-status-hint'; text.append(title, hint); box.append(lamp, text);
 if (s.checks) { const list = h('ul', '', 'st-checks'); list.id = 'st-checks'; for (const c of s.checks) { const li = h('li', '', c.ok ? 'ok' : ''); li.append(h('i', c.ok ? '✓' : '✕'), h('span', c.label)); li.title = c.ok ? '' : c.fix; list.append(li); } box.append(list); }
 return box;
}
function updateStatus(s: StationStatus) {
 const box = document.getElementById('st-status'); if (!box) return;
 if (box.dataset.tone !== s.tone) box.dataset.tone = s.tone;
 const t = document.getElementById('st-status-title'), hnt = document.getElementById('st-status-hint');
 if (t && t.textContent !== s.title) t.textContent = s.title; if (hnt && hnt.textContent !== s.hint) hnt.textContent = s.hint;
 const list = document.getElementById('st-checks'); if (list && s.checks) s.checks.forEach((c, i) => { const li = list.children[i] as HTMLElement | undefined; if (!li) return; li.classList.toggle('ok', c.ok); const mark = li.firstElementChild!, label = li.lastElementChild!; if (mark.textContent !== (c.ok ? '✓' : '✕')) mark.textContent = c.ok ? '✓' : '✕'; if (label.textContent !== c.label) label.textContent = c.label; li.title = c.ok ? '' : c.fix; });
}
/** One machine slot: tap to take the stack back into the backpack. */
function slotCell(ctx: Ctx, b: Building, label: string, index: number, placeholder: string, source: Slot[] = b.input) {
 const wrap = h('div', '', 'st-slot'), s = source[index];
 const cell = button('', () => {
  if (label === 'Вода' && b.water >= 1000 && !s) { const inv = structuredClone(ctx.g.player.inventory), n = Math.floor(b.water / 1000); if (addItems(inv, 'water', n)) { ctx.say('Рюкзак полон'); return; } ctx.g.player.inventory = inv; b.water -= n * 1000; ctx.changed(); ctx.draw(); return; }
  ctx.say(takeSlot(ctx.g, source, index), 'Забрано в рюкзак');
 }, 'st-slot-cell' + (s ? '' : ' empty'));
 cell.dataset.machineSlot = label; cell.setAttribute('aria-label', label + (s ? ' · ' + ITEMS[s.itemId].name + ' ×' + s.count : ' · пусто'));
 cell.append(itemArt(s?.itemId ?? placeholder));
 const count = h('small', s ? (s.milliGU !== undefined ? Math.round((s.milliGU ?? 0) / TANKS[s.itemId].capacity * 100) + '%' : String(s.count)) : label === 'Вода' && b.water ? String(b.water / 1000) : '');
 count.id = `st-slot-${index}-${label}`; cell.append(count);
 wrap.append(h('span', label), cell); return wrap;
}
// ---------- S4: worn tanks and the charging slot of the oxygen generator ----------
const isTank = (s: Slot): s is NonNullable<Slot> => !!s && Object.hasOwn(TANKS, s.itemId);
const code = (p: TankPlace) => p.kind === 'worn' ? 'worn:' + p.b : p.kind === 'pack' ? 'pack:' + p.i : 'station';
const place = (ctx: Ctx, v = ''): TankPlace | null => { const [k, n] = v.split(':'); return k === 'worn' && (n === '0' || n === '1') ? { kind: 'worn', b: Number(n) as 0 | 1 } : k === 'pack' && n ? { kind: 'pack', i: Number(n) } : k === 'station' ? { kind: 'station', id: ctx.id } : null; };
/** The last breathable gas leaves the suit only after the same action is repeated within 4 s. */
let pendingGap: { key: string; at: number } | null = null;
function tankMove(ctx: Ctx, from: TankPlace, to: TankPlace, dragged = false) {
 if (code(from) === code(to)) return;
 const key = ctx.id + '|' + code(from) + '>' + code(to), now = performance.now();
 if (moveTankGap(ctx.g, ctx.inside(), from, to) && (pendingGap?.key !== key || now - pendingGap.at > 4000)) { pendingGap = { key, at: now }; ctx.caution(lastAirText(ctx.g)); return; }
 pendingGap = null;
 const src = document.querySelector(`[data-drop="${code(from)}"]`), tokens = dragged || !src ? [] : captureTokens([src]);
 const e = moveTank(ctx.g, from, to); ctx.say(e, to.kind === 'worn' ? 'Баллон на костюме' : to.kind === 'station' ? 'Баллон заправляется' : 'Баллон в рюкзаке');
 if (!e) { const target = `[data-drop="${code(to)}"]`; if (tokens.length) transferCraft(tokens, target); else pulseCraft(target); }
}
/** A tank cell starts a drag; the drop target is read from `data-drop` when the pointer is released. */
function dragTank(ctx: Ctx, cell: HTMLElement, from: TankPlace) {
 cell.dataset.drag = code(from);
 cell.addEventListener('pointerdown', e => dragFrom(e, cell, target => { const to = place(ctx, target.dataset.drop); if (to) tankMove(ctx, from, to, true); }));
}
/** Tank art, its gas in GU and a gas bar; an empty connector shows the outline. */
function tankFace(cell: HTMLElement, t: Slot, key: string) {
 const gu = h('small', t ? String(Math.round((t.milliGU ?? 0) / 1000)) : ''), bar = h('i', '', 'st-gas');
 gu.id = key + '-gu'; bar.id = key + '-bar'; bar.style.transform = `scaleX(${isTank(t) ? Math.min(1, (t.milliGU ?? 0) / TANKS[t.itemId].capacity) : 0})`;
 cell.append(t ? itemArt(t.itemId) : ghostArt('tank'), gu, bar);
}
function tankLive(key: string, t: Slot) {
 const gu = document.getElementById(key + '-gu'), bar = document.getElementById(key + '-bar'), text = t ? String(Math.round((t.milliGU ?? 0) / 1000)) : '';
 if (gu && gu.textContent !== text) { gu.textContent = text; const cell = document.getElementById(key), label = cell?.getAttribute('aria-label'); if (label && text) cell!.setAttribute('aria-label', label.replace(/\d+( из \d+ GU)/, text + '$1')); } if (bar) bar.style.transform = `scaleX(${isTank(t) ? Math.min(1, (t.milliGU ?? 0) / TANKS[t.itemId].capacity) : 0})`;
}
/** The charging slot: tap wears the tank (first empty connector, otherwise instead of the emptier worn tank). */
function chargeCell(ctx: Ctx, b: Building) {
 const t = b.input[1]; if (t && !isTank(t)) return slotCell(ctx, b, 'Баллон', 1, 'bottle_1');
 const station: TankPlace = { kind: 'station', id: ctx.id }, wrap = h('div', '', 'st-slot');
 const cell = button('', () => { if (b.input[1]) tankMove(ctx, station, { kind: 'worn', b: wearSlot(ctx.g) }); else ctx.say('Нажмите на баллон костюма или перетащите его сюда'); }, 'st-slot-cell st-tank' + (t ? '' : ' empty'));
 cell.id = 'st-charge'; cell.dataset.machineSlot = 'Баллон'; cell.dataset.drop = 'station';
 cell.setAttribute('aria-label', 'Заправка баллона · ' + (t ? `${ITEMS[t.itemId].name}, ${Math.round((t.milliGU ?? 0) / 1000)} из ${TANKS[t.itemId].capacity / 1000} GU — нажмите, чтобы надеть` : 'пусто'));
 tankFace(cell, t, 'st-charge'); if (t) dragTank(ctx, cell, station);
 wrap.append(h('span', 'Заправка'), cell); return wrap;
}
/** Both worn connectors: tap sends the tank to charge (hot swap with a charging one); an empty one takes the charging tank.
 * Taps read the live state: a rebuild may wait while a finger is down (production.ts). */
function suitRow(ctx: Ctx, b: Building) {
 const row = h('div', '', 'st-suit'); row.append(h('span', 'Костюм', 'st-suit-label'));
 for (const n of [0, 1] as const) {
  const t = ctx.g.player.bottles[n], worn: TankPlace = { kind: 'worn', b: n }, wrap = h('div', '', 'st-slot');
  const cell = button('', () => { if (ctx.g.player.bottles[n]) tankMove(ctx, worn, { kind: 'station', id: ctx.id }); else if (isTank(b.input[1])) tankMove(ctx, { kind: 'station', id: ctx.id }, worn); else ctx.say('Разъём пуст: перетащите сюда баллон из рюкзака'); }, 'st-slot-cell st-tank' + (t ? '' : ' empty'));
  cell.id = 'st-worn-' + n; cell.dataset.drop = code(worn);
  cell.setAttribute('aria-label', `Баллон ${n + 1} на костюме · ` + (t ? `${Math.round((t.milliGU ?? 0) / 1000)} из ${TANKS[t.itemId].capacity / 1000} GU — нажмите, чтобы поставить на заправку` : 'пусто'));
  tankFace(cell, t, 'st-worn-' + n); if (t) dragTank(ctx, cell, worn);
  wrap.append(h('span', `Баллон ${n + 1}`), cell); row.append(wrap);
 }
 return row;
}
function arrow(job: Building['job']) {
 const r = job ? RECIPE_BY_ID.get(job.recipeId) : null, p = job && r ? Math.min(1, job.workMs / (r.seconds * 1000)) : 0;
 const a = h('div', '', 'st-arrow' + (job && p < 1 ? ' active' : '')); a.id = 'st-arrow';
 const ring = h('i', '', 'st-ring'); ring.style.setProperty('--p', String(p)); ring.id = 'st-ring'; a.append(ring, h('span', '→')); return a;
}
function connections(ctx: Ctx, b: Building) {
 const { g, id } = ctx, sec = h('section', '', 'st-links');
 const own = g.world.base.links.filter(l => l.from === id || l.to === id);
 const options = linkOptions(g, id);
 if (!own.length && !options.length && b.kind !== 'kiln') { sec.append(h('h4', 'Подключения'), h('p', 'Рядом нет станций для соединения (до 12 м).', 'st-note')); return sec; }
 if (b.kind === 'kiln' || (b.kind === 'workbench' && b.level === 1)) return sec;
 sec.append(h('h4', 'Подключения'));
 const list = h('ul', '', 'st-link-list');
 for (const l of own) {
  const peer = l.from === id ? l.to : l.from, live = l.kind === 'gas_pipe' ? (telemetry.gas.get(l.id) ?? 0) > 0 : powerRate(id) > 0 || supplyRate(id) > 0;
  const li = h('li', '', 'st-link ' + l.kind + (live ? ' live' : ''));
  li.append(itemArt(l.kind), h('span', `${l.kind === 'cable' ? 'Кабель' : 'Труба O₂'} ${l.kind === 'gas_pipe' ? (l.from === id ? '→' : '←') : '↔'} ${peerName(g, peer)}`), h('small', linkLength(g, l).toFixed(1) + ' м'));
  li.append(button('Снять', () => ctx.say(disconnect(g, l.id), 'Линия снята, сегменты в рюкзаке'), 'st-btn small ghost'));
  list.append(li);
 }
 for (const o of options.slice(0, 6)) {
  const have = countItem(g.player.inventory, o.kind), li = h('li', '', 'st-link suggest');
  li.append(itemArt(o.kind), h('span', `${o.kind === 'cable' ? 'Кабель' : 'Труба O₂'} ${o.kind === 'gas_pipe' ? (o.from === id ? '→' : '←') : '↔'} ${peerName(g, o.peer)}`), h('small', `${o.distance.toFixed(1)} м · ${o.cost} шт.`));
  const go = button(have >= o.cost ? 'Проложить' : `Нужно ${o.cost}`, () => { const tokens = captureTokens([li.querySelector('.art')!]); const e = connect(g, o.kind, o.from, o.to); ctx.say(e, 'Соединено'); if (!e) transferCraft(tokens, '.st-links'); }, 'st-btn small' + (have >= o.cost ? ' accent' : ''), have < o.cost);
  go.title = have >= o.cost ? '' : `В рюкзаке ${have} из ${o.cost}. ${o.kind === 'cable' ? 'Кабель' : 'Трубу'} собирают на верстаке.`;
  li.append(go); list.append(li);
 }
 sec.append(list); return sec;
}
function backpack(ctx: Ctx, kind: string, act: (i: number) => void, title = 'Рюкзак', decorate?: (cell: HTMLElement, i: number) => void) {
 const box = h('aside', '', 'st-bag'), grid = h('div', '', 'st-bag-grid'), accept = ACCEPTS[kind];
 box.append(h('h4', title + (accept ? ' · подходящее подсвечено' : '')));
 ctx.g.player.inventory.forEach((s, i) => {
  const ok = !accept || (s && accept.includes(s.itemId));
  const cell = button('', () => act(i), 'st-bag-cell' + (s ? '' : ' empty') + (s && accept && ok ? ' fits' : '') + (s && !ok ? ' dim' : ''));
  cell.dataset.inventory = String(i);
  cell.setAttribute('aria-label', s ? ITEMS[s.itemId].name + ' ×' + s.count : 'Пустая ячейка ' + (i + 1));
  if (s) { cell.append(itemArt(s.packed?.kind === 'workbench' && s.packed.level === 2 ? 'workbench_2' : s.itemId), h('small', s.milliGU !== undefined ? Math.round((s.milliGU ?? 0) / 1000) + '' : s.packed ? (s.packed.level === 2 ? 'II' : 'I') : String(s.count))); cell.title = ITEMS[s.itemId].name; }
  decorate?.(cell, i); grid.append(cell);
 });
 box.append(grid); return box;
}
function quickLoad(ctx: Ctx, kind: string, id: string, items: string[], label: string) {
 const has = ctx.g.player.inventory.some(s => s && items.includes(s.itemId));
 return button(label, () => {
  const g = ctx.g; let moved = 0, err = '';
  // One kind per press: a slot that already holds a kind is only topped up with it, an empty one takes the first kind
  // in the backpack. Swapping kinds stays a deliberate tap on a backpack stack.
  const held = machine(g, id)?.input.find(s => s && items.includes(s.itemId))?.itemId;
  const pick = held ?? g.player.inventory.find(s => s && items.includes(s.itemId))?.itemId;
  for (let i = 0; i < g.player.inventory.length; i++) { const s = g.player.inventory[i]; if (s && s.itemId === pick) { const before = s.count; err = loadMachineSlot(g, id, i); if (!err) moved += before - (g.player.inventory[i]?.itemId === s.itemId ? g.player.inventory[i]!.count : 0); else break; } }
  ctx.say(moved ? '' : err || (held && !g.player.inventory.some(s => s?.itemId === held) ? `В рюкзаке нет: ${ITEMS[held].name}. Сменить сырьё — нажмите на стак` : 'Нечего загрузить'), 'Загружено');
 }, 'st-btn small', !has);
}
/** Room window ids: 'glass:<cell key>' for a glass block, the airlock's own id ('door-N'). */
export const isStructure = (id: string) => id.startsWith('glass:') || id.startsWith('door-');
export function structureKey(g: GameState, id: string): number | null { if (id.startsWith('glass:')) { const k = Number(id.slice(6)); return g.world.base.glass.includes(k) ? k : null; } const d = doorById(g, id); return d ? doorKeys(d)[0] : null; }
let confirmKey = -1, confirmUntil = 0, structureTick = 0;
/** Glass block / airlock window (S4): the room beside it (volume, air, checklist) or why it is not closed; for an airlock
 *  (D36) the state of its two doors and the chamber charge; taking the block back (a second press within 3 s confirms
 *  when air would leave). */
function structureView(g: GameState, id: string, host: MachineHost): HTMLElement {
 const { say, caution } = host, root = h('div', '', 'st-layout'), left = h('div', '', 'st-main'); root.append(left);
 const key = structureKey(g, id); if (key === null) return root;
 root.dataset.kind = 'room'; const door = doorById(g, id), st = structureStatus(g, key);
 // Left: status and the habitability checklist; right: air, the airlock and taking the block back.
 const side = h('aside', '', 'st-bag st-room'); root.append(side);
 left.append(statusBlock(st));
 if (st.room) { const r = st.room; side.append(h('h4', `Помещение · ${r.volume} м³`), meter('room-air', 'Воздух', r.zone.q / 1000, capacityOf(r.volume) / 1000, 'GU', 'o2', habitableQ(r.volume) / 1000), meter('room-purity', 'Чистота', r.zone.purity * 100, 100, '%', 'clean', 50), h('p', `Дышать можно от ${habitableQ(r.volume) / 1000} GU (8 GU на м³).`, 'st-note')); }
 else { side.append(h('h4', 'Конструкция')); if (st.leak.length) side.append(h('p', 'Путь утечки подсвечен красным в мире на 6 с.', 'st-note')); }
 if (door) {
  const sides = doorRooms(g, door);
  side.append(h('h4', door.width === 2 ? 'Шлюз' : 'Шлюз прежней версии · 1 клетка'), meter('chamber', 'Камера', door.pressure / 1000, CHAMBER_Q / 1000, 'GU', 'o2'), h('p', `${doorStatus(g, door, 'outer').name}: ${doorStatus(g, door, 'outer').meta}. ${doorStatus(g, door, 'inner').name}: ${doorStatus(g, door, 'inner').meta}.`, 'st-note'),
   h('p', sides.front || sides.back ? 'Двери открываются по очереди (кнопка действия на двери). Перед дверью в помещение камера наполняется из него (4 GU, 3 с), перед дверью наружу — сбрасывает давление (3 с).' : 'Шлюз не граничит с помещением: двери открываются сразу, без наполнения.', 'st-note'));
 }
 const footer = h('div', '', 'st-actions st-foot');
 footer.append(button(door ? 'Забрать шлюз' : 'Забрать стеклоблок', () => {
  const confirmed = confirmKey === key && performance.now() < confirmUntil, r = door ? removeDoor(g, door.id, confirmed) : removeGlass(g, key, confirmed);
  if (r.needConfirm) { confirmKey = key; confirmUntil = performance.now() + 3000; host.room?.tint(key); caution(r.error); return; }
  confirmKey = -1; if (!r.error) host.room?.edited(r); say(r.error, 'Возвращено в рюкзак');
 }, 'st-btn small ghost'));
 side.append(footer);
 return root;
}
export function machineView(g: GameState, id: string, host: MachineHost): HTMLElement {
 if (isStructure(id)) return structureView(g, id, host);
 const ctx: Ctx = { ...host, g, id }, { say, changed, draw, refill } = host;
 const root = h('div', '', 'st-layout'), left = h('div', '', 'st-main'); root.append(left);
 const change = () => { changed(); draw(); };
 // ---------- Storage crates ----------
 if (id.startsWith('crate-')) {
  root.dataset.storage = 'true';
  const crate = h('aside', '', 'st-bag'), grid = h('div', '', 'st-bag-grid'); crate.append(h('h4', 'Ящик · нажмите, чтобы взять'));
  g.world.crates[id].forEach((s, i) => { const c = button('', () => { if (transferSlot(g.world.crates[id], i, g.player.inventory)) change(); else say('Рюкзак полон'); }, 'st-bag-cell' + (s ? '' : ' empty')); if (s) { c.append(itemArt(s.itemId), h('small', String(s.count))); c.title = ITEMS[s.itemId].name; } c.setAttribute('aria-label', s ? ITEMS[s.itemId].name : 'Пусто'); grid.append(c); });
  crate.append(grid);
  const actions = h('div', '', 'st-actions');
  actions.append(button('Сложить всё, кроме первой строки', () => { let n = 0; for (let i = 6; i < g.player.inventory.length; i++) if (g.player.inventory[i] && transferSlot(g.player.inventory, i, g.world.crates[id])) n++; say(n ? '' : 'Нечего сложить или ящик полон', 'Сложено в ящик'); }, 'st-btn small'),
   button('Забрать всё', () => { let n = 0; for (let i = 0; i < g.world.crates[id].length; i++) if (g.world.crates[id][i] && transferSlot(g.world.crates[id], i, g.player.inventory)) n++; say(n ? '' : 'Ящик пуст или рюкзак полон', 'Забрано'); }, 'st-btn small'));
  left.append(crate, actions);
  root.append(backpack(ctx, '', i => { if (transferSlot(g.player.inventory, i, g.world.crates[id])) change(); else say('Ящик полон'); }, 'Рюкзак · нажмите, чтобы положить'));
  return root;
 }
 // ---------- Capsule oxygen port ----------
 if (id === 'capsule') {
  root.dataset.kind = 'capsule';
  const status = h('div', '', 'st-status'); status.id = 'st-status'; status.dataset.tone = 'idle'; status.append(h('i', '', 'st-lamp'), (() => { const t = h('div', '', 'st-status-text'), a = h('b', 'Кислородный порт'), b2 = h('span', 'Запас капсулы конечен: она не производит газ.'); a.id = 'st-status-title'; b2.id = 'st-status-hint'; t.append(a, b2); return t; })());
  left.append(status, meter('capsule', 'Капсула', g.world.capsuleMilliGU / 1000, CAPSULE_CAPACITY / 1000, 'GU', 'o2'));
  g.player.bottles.forEach((t, i) => left.append(meter('bottle-' + i, t ? `Баллон ${i + 1}` : `Слот ${i + 1} пуст`, (t?.milliGU ?? 0) / 1000, t ? TANKS[t.itemId].capacity / 1000 : EMPTY_TANK, 'GU', 'o2')));
  const actions = h('div', '', 'st-actions');
  const fill = button('Заправить баллоны', () => { refill('capsule-out'); say('', 'Заправка идёт'); }, 'st-btn accent'); fill.id = 'capsule-start';
  actions.append(fill, button('Остановить', () => { refill(null); say('', 'Остановлено'); }, 'st-btn'), button('Баллоны → капсула', () => { refill('capsule-in'); say('', 'Газ передаётся в капсулу'); }, 'st-btn ghost'));
  left.append(actions, h('p', 'Запасной баллон из рюкзака можно установить нажатием. Кислород можно вернуть в капсулу трубой от генератора кислорода.', 'st-note'));
  root.append(backpack(ctx, 'capsule', i => { const r = installTank(g, i); say(r.ok ? '' : r.reason, 'Баллон установлен'); }));
  return root;
 }
 const b = machine(g, id); if (!b) return root; root.dataset.kind = b.kind;
 const s = stationStatus(g, b); left.append(statusBlock(s));
 if (b.kind === 'kiln') {
  const proc = h('div', '', 'st-process'), ins = h('div', '', 'st-inputs');
  ins.append(slotCell(ctx, b, 'Сырьё', 0, 'iron_raw'), slotCell(ctx, b, 'Топливо', 1, 'fiber'));
  const recipe = b.job ? RECIPE_BY_ID.get(b.job.recipeId) : RECIPES.find(r => r.station === 'kiln' && b.input[0] && r.inputs[b.input[0].itemId]);
  proc.append(ins, arrow(b.job), slotCell(ctx, b, 'Результат', 0, recipe ? Object.keys(recipe.outputs)[0] : 'iron', b.output));
  left.append(proc);
  const quick = h('div', '', 'st-actions');
  quick.append(quickLoad(ctx, 'kiln', id, ['iron_raw', 'copper_raw', 'sand', 'ice'], 'Загрузить сырьё'), quickLoad(ctx, 'kiln', id, ['fiber'], 'Добавить волокно'), button('Забрать результат', () => { const tokens = captureTokens(left.querySelectorAll('[data-machine-slot="Результат"]')); const e = takeSlot(g, b.output, 0); say(e, 'Забрано в рюкзак'); if (!e) transferCraft(tokens, '.st-bag'); }, 'st-btn small', !b.output[0]));
  left.append(quick);
  const guide = h('div', '', 'st-recipes'); guide.append(h('h4', 'Что умеет печь'));
  for (const r of RECIPES.filter(r => r.station === 'kiln')) { const row = h('div', '', 'st-recipe'); for (const [i, n] of Object.entries(r.inputs)) { const c = h('span', '', 'st-mini'); c.append(itemArt(i), h('b', String(n))); row.append(c); } row.append(h('span', '→', 'st-recipe-arrow')); const o = Object.keys(r.outputs)[0], c = h('span', '', 'st-mini'); c.append(itemArt(o), h('b', String(r.outputs[o]))); row.append(c, h('small', r.seconds + ' с')); guide.append(row); }
  left.append(guide);
 } else if (b.kind === 'electrolyzer') {
  const proc = h('div', '', 'st-process'), ins = h('div', '', 'st-inputs');
  ins.append(slotCell(ctx, b, 'Вода', 0, 'water'));
  proc.append(ins, arrow(b.job), chargeCell(ctx, b));
  left.append(proc, suitRow(ctx, b), meter('oxygen', 'Буфер O₂', b.oxygen / 1000, o2Max(b), 'GU', 'o2'));
  const quick = h('div', '', 'st-actions'); quick.append(quickLoad(ctx, 'electrolyzer', id, ['water'], 'Загрузить воду'));
  left.append(quick, h('p', `1 вода → ${O2_PER_WU / 1000} GU кислорода за ${ELECTROLYSIS.seconds} с при ${ELECTROLYSIS.EU_per_second} EU/с. Перетащите баллон костюма в слот заправки или нажмите на него — он заправится. Заправленный верните так же: прямо на костюм.`, 'st-note'));
 } else if (b.kind === 'biogenerator') {
  const proc = h('div', '', 'st-process'), ins = h('div', '', 'st-inputs'); ins.append(slotCell(ctx, b, 'Топливо', 0, 'fiber'));
  const out = h('div', '', 'st-slot'); out.append(h('span', 'Энергия'), (() => { const c = h('div', '', 'st-slot-cell power'); c.append(h('b', '⚡')); return c; })());
  proc.append(ins, arrow(null), out); left.append(proc, meter('energy', 'Накопитель', b.energy / 1000, GEN_BUFFER / 1000, 'EU', 'power'));
  const quick = h('div', '', 'st-actions'); quick.append(quickLoad(ctx, 'biogenerator', id, ['fiber'], 'Загрузить волокно')); left.append(quick, h('p', `1 волокно = ${FIBER_EU / 1000} EU. Выдача до 40 EU/с по кабелю. Ставьте снаружи помещений.`, 'st-note'));
 } else if (b.kind === 'refill') {
  left.append(meter('oxygen', 'Буфер O₂', b.oxygen / 1000, o2Max(b), 'GU', 'o2'));
  g.player.bottles.forEach((t, i) => left.append(meter('bottle-' + i, t ? `Баллон ${i + 1}` : `Слот ${i + 1} пуст`, (t?.milliGU ?? 0) / 1000, t ? TANKS[t.itemId].capacity / 1000 : EMPTY_TANK, 'GU', 'o2')));
  const quick = h('div', '', 'st-actions'); quick.append(button('Заправить баллоны', () => { refill(id); say('', 'Заправка идёт'); }, 'st-btn accent'), button('Стоп', () => { refill(null); say('', 'Остановлено'); }, 'st-btn')); left.append(quick);
 } else if (b.kind === 'distributor') {
  left.append(meter('oxygen', 'Буфер O₂', b.oxygen / 1000, o2Max(b), 'GU', 'o2'), h('p', 'Наполняет помещение до 20 GU/с, очищает воздух и держит +20 °C. Один обслуживает до 256 м³. Нужны труба O₂ и кабель питания.', 'st-note'));
 }
 left.append(connections(ctx, b));
 const footer = h('div', '', 'st-actions st-foot');
 footer.append(button(b.enabled ? 'Выключить' : 'Включить', () => { b.enabled = !b.enabled; change(); }, 'st-btn small ghost'));
 if (b.job && b.kind !== 'workbench') footer.append(button('Отменить обработку', () => say(cancelJob(g, id), 'Оплаченное сырьё возвращено'), 'st-btn small ghost'));
 footer.append(button('Забрать станцию', () => { const e = packStation(g, id); say(e, 'Станция в рюкзаке'); }, 'st-btn small ghost'));
 if (b.input.slice(2).some(Boolean) || b.output.slice(1).some(Boolean)) { const legacy = h('details', '', 'st-legacy'); legacy.append(h('summary', 'Другие сохранённые ячейки')); for (const [source, from] of [[b.input, 2], [b.output, 1]] as const) source.forEach((v, i) => { if (v && i >= from) legacy.append(button(ITEMS[v.itemId].name + ' ×' + v.count, () => say(takeSlot(g, source, i), 'Предмет забран'), 'st-btn small')); }); footer.append(legacy); }
 left.append(footer);
 if (ACCEPTS[b.kind]) root.append(backpack(ctx, b.kind, i => say(loadMachineSlot(g, id, i), 'Загружено'), 'Рюкзак', b.kind !== 'electrolyzer' ? undefined : (cell, i) => { cell.dataset.drop = 'pack:' + i; if (isTank(g.player.inventory[i])) dragTank(ctx, cell, { kind: 'pack', i }); }));
 else root.classList.add('single');
 return root;
}
export function tickMachine(g: GameState, id: string) {
 // Room windows: status and meters 4 times a second (the leak search is not free).
 if (isStructure(id)) {
  if (performance.now() - structureTick < 250) return; structureTick = performance.now();
  const key = structureKey(g, id); if (key === null) return; const st = structureStatus(g, key); updateStatus(st);
  if (st.room) { setMeter('room-air', st.room.zone.q / 1000, capacityOf(st.room.volume) / 1000, 'GU'); setMeter('room-purity', st.room.zone.purity * 100, 100, '%'); }
  return;
 }
 if (id === 'capsule') {
  setMeter('capsule', g.world.capsuleMilliGU / 1000, CAPSULE_CAPACITY / 1000, 'GU');
  g.player.bottles.forEach((t, i) => setMeter('bottle-' + i, (t?.milliGU ?? 0) / 1000, t ? TANKS[t.itemId].capacity / 1000 : EMPTY_TANK, 'GU'));
  const fill = document.getElementById('capsule-start') as HTMLButtonElement | null, has = g.player.bottles.some(Boolean), full = has && g.player.bottles.every(t => !t || (t.milliGU ?? 0) >= TANKS[t.itemId].capacity);
  if (fill) { fill.disabled = !has || full || g.world.capsuleMilliGU <= 0; const label = !has ? 'Установите баллон' : full ? 'Баллоны заполнены' : g.world.capsuleMilliGU <= 0 ? 'В капсуле нет O₂' : 'Заправить баллоны'; if (fill.textContent !== label && !fill.dataset.busy) fill.textContent = label; }
  return;
 }
 if (id.startsWith('crate-')) return;
 const b = machine(g, id); if (!b) return;
 updateStatus(stationStatus(g, b));
 const r = b.job ? RECIPE_BY_ID.get(b.job.recipeId) : null, p = r && b.job ? Math.min(1, b.job.workMs / (r.seconds * 1000)) : 0;
 const ring = document.getElementById('st-ring'); if (ring) ring.style.setProperty('--p', String(p)); document.getElementById('st-arrow')?.classList.toggle('active', !!b.job && p < 1 || (b.kind === 'biogenerator' && supplyRate(b.id) > 0));
 if (b.kind === 'electrolyzer' || b.kind === 'refill' || b.kind === 'distributor') setMeter('oxygen', b.oxygen / 1000, o2Max(b), 'GU');
 if (b.kind === 'electrolyzer') { tankLive('st-charge', isTank(b.input[1]) ? b.input[1] : null); g.player.bottles.forEach((t, i) => tankLive('st-worn-' + i, t)); const w = document.getElementById('st-slot-0-Вода'); if (w) { const n = (b.input[0]?.itemId === 'water' ? b.input[0].count : 0) + b.water / 1000; w.textContent = n ? String(n) : ''; } }
 if (b.kind === 'refill') g.player.bottles.forEach((t, i) => setMeter('bottle-' + i, (t?.milliGU ?? 0) / 1000, t ? TANKS[t.itemId].capacity / 1000 : EMPTY_TANK, 'GU'));
 if (b.kind === 'biogenerator') { setMeter('energy', b.energy / 1000, GEN_BUFFER / 1000, 'EU'); const f = document.getElementById('st-slot-0-Топливо'); if (f) f.textContent = String(countItem(b.input, 'fiber') || ''); }
 if (b.kind === 'kiln') { const f = document.getElementById('st-slot-1-Топливо'); if (f) f.textContent = String(b.input[1]?.count ?? ''); const raw = document.getElementById('st-slot-0-Сырьё'); if (raw) raw.textContent = String(b.input[0]?.count ?? ''); }
 void endpoint; void gasRate;
}
