import { installTank } from '../game/backpack';
import { ITEMS, TANKS } from '../game/defs';
import { loadMachineSlot, takeSlot, packStation } from '../game/worldActions';
import { addItems, countItem, transferSlot, type Slot } from '../game/inventory';
import { machine, RECIPES, RECIPE_BY_ID, beginPassage, cancelJob, connect, disconnect, linkOptions, linkLength, endpoint, gasRate, powerRate, supplyRate, telemetry, DOME_CAPACITY, ELECTROLYZER_O2, FIBER_EU, GEN_BUFFER, O2_PER_WU, PORT_O2, type Building } from '../game/production';
import { stationStatus, type StationStatus } from '../game/stationStatus';
import { CAPSULE_CAPACITY } from '../game/survival';
import type { GameState } from '../game/state';
import type { GuideTarget } from '../game/guide';
import { itemArt } from './art';
import { captureTokens, transferCraft } from './craftMotion';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
const button = (label: string, fn: () => void, cls = 'st-btn', disabled = false) => { const b = h('button', label, cls); b.type = 'button'; b.onclick = fn; b.disabled = disabled; return b; };
const peerName = (g: GameState, id: string) => id === 'capsule' ? 'Капсула' : ITEMS[machine(g, id)?.kind ?? '']?.name ?? id;
/** Items each machine accepts from the backpack; everything else is dimmed. */
const ACCEPTS: Record<string, string[]> = { kiln: ['iron_raw', 'copper_raw', 'sand', 'ice', 'fiber'], biogenerator: ['fiber'], electrolyzer: ['water', 'bottle_1'] };
type Say = (error: string, success?: string) => void;
/** Oxygen buffer of a gas station in GU: the electrolyzer holds more than the refill/distributor ports (D30). */
const o2Max = (b: Building) => (b.kind === 'electrolyzer' ? ELECTROLYZER_O2 : PORT_O2) / 1000;
const ELECTROLYSIS = RECIPE_BY_ID.get('electrolysis')!;
type Ctx = { g: GameState; id: string; say: Say; changed: () => void; draw: () => void; refill: (id: string | null) => void; nav?: (t: GuideTarget) => void };

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
function arrow(job: Building['job']) {
 const r = job ? RECIPE_BY_ID.get(job.recipeId) : null, p = job && r ? Math.min(1, job.workMs / (r.seconds * 1000)) : 0;
 const a = h('div', '', 'st-arrow' + (job && p < 1 ? ' active' : '')); a.id = 'st-arrow';
 const ring = h('i', '', 'st-ring'); ring.style.setProperty('--p', String(p)); ring.id = 'st-ring'; a.append(ring, h('span', '→')); return a;
}
function connections(ctx: Ctx, b: Building) {
 const { g, id } = ctx, sec = h('section', '', 'st-links');
 const own = g.world.base.links.filter(l => l.from === id || l.to === id);
 const options = linkOptions(g, id);
 if (!own.length && !options.length && b.kind !== 'dome' && b.kind !== 'kiln') { sec.append(h('h4', 'Подключения'), h('p', 'Рядом нет станций для соединения (до 12 м).', 'st-note')); return sec; }
 if (b.kind === 'dome' || b.kind === 'kiln' || (b.kind === 'workbench' && b.level === 1)) return sec;
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
function backpack(ctx: Ctx, kind: string, act: (i: number) => void, title = 'Рюкзак') {
 const box = h('aside', '', 'st-bag'), grid = h('div', '', 'st-bag-grid'), accept = ACCEPTS[kind];
 box.append(h('h4', title + (accept ? ' · подходящее подсвечено' : '')));
 ctx.g.player.inventory.forEach((s, i) => {
  const ok = !accept || (s && accept.includes(s.itemId));
  const cell = button('', () => act(i), 'st-bag-cell' + (s ? '' : ' empty') + (s && accept && ok ? ' fits' : '') + (s && !ok ? ' dim' : ''));
  cell.dataset.inventory = String(i);
  cell.setAttribute('aria-label', s ? ITEMS[s.itemId].name + ' ×' + s.count : 'Пустая ячейка ' + (i + 1));
  if (s) { cell.append(itemArt(s.packed?.kind === 'workbench' && s.packed.level === 2 ? 'workbench_2' : s.itemId), h('small', s.milliGU !== undefined ? Math.round((s.milliGU ?? 0) / 1000) + '' : s.packed ? (s.packed.level === 2 ? 'II' : 'I') : String(s.count))); cell.title = ITEMS[s.itemId].name; }
  grid.append(cell);
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
export function machineView(g: GameState, id: string, say: Say, changed: () => void, draw: () => void, refill: (id: string | null) => void, nav?: (t: GuideTarget) => void): HTMLElement {
 const ctx: Ctx = { g, id, say, changed, draw, refill, nav };
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
  g.player.bottles.forEach((t, i) => left.append(meter('bottle-' + i, t ? `Баллон ${i + 1}` : `Слот ${i + 1} пуст`, (t?.milliGU ?? 0) / 1000, t ? TANKS[t.itemId].capacity / 1000 : 600, 'GU', 'o2')));
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
  proc.append(ins, arrow(b.job), slotCell(ctx, b, 'Баллон', 1, 'bottle_1'));
  left.append(proc, meter('oxygen', 'Буфер O₂', b.oxygen / 1000, o2Max(b), 'GU', 'o2'));
  const quick = h('div', '', 'st-actions'); quick.append(quickLoad(ctx, 'electrolyzer', id, ['water'], 'Загрузить воду'));
  g.player.bottles.forEach((t, i) => { if (t) quick.append(button(`Баллон ${i + 1} из костюма`, () => { const old = b.input[1]; if (old && !TANKS[old.itemId]) { say('Освободите слот баллона'); return; } b.input[1] = t; g.player.bottles[i] = old; change(); }, 'st-btn small')); });
  if (b.input[1]) quick.append(button('Баллон в костюм', () => { const free = g.player.bottles.findIndex(v => !v); if (free < 0) { say('Оба слота костюма заняты'); return; } g.player.bottles[free as 0 | 1] = b.input[1]; b.input[1] = null; change(); }, 'st-btn small'));
  left.append(quick, h('p', `1 вода → ${O2_PER_WU / 1000} GU кислорода за ${ELECTROLYSIS.seconds} с при ${ELECTROLYSIS.EU_per_second} EU/с. Установленный баллон заправляется сам.`, 'st-note'));
 } else if (b.kind === 'biogenerator') {
  const proc = h('div', '', 'st-process'), ins = h('div', '', 'st-inputs'); ins.append(slotCell(ctx, b, 'Топливо', 0, 'fiber'));
  const out = h('div', '', 'st-slot'); out.append(h('span', 'Энергия'), (() => { const c = h('div', '', 'st-slot-cell power'); c.append(h('b', '⚡')); return c; })());
  proc.append(ins, arrow(null), out); left.append(proc, meter('energy', 'Накопитель', b.energy / 1000, GEN_BUFFER / 1000, 'EU', 'power'));
  const quick = h('div', '', 'st-actions'); quick.append(quickLoad(ctx, 'biogenerator', id, ['fiber'], 'Загрузить волокно')); left.append(quick, h('p', `1 волокно = ${FIBER_EU / 1000} EU. Выдача до 40 EU/с по кабелю. Ставьте снаружи купола.`, 'st-note'));
 } else if (b.kind === 'refill') {
  left.append(meter('oxygen', 'Буфер O₂', b.oxygen / 1000, o2Max(b), 'GU', 'o2'));
  g.player.bottles.forEach((t, i) => left.append(meter('bottle-' + i, t ? `Баллон ${i + 1}` : `Слот ${i + 1} пуст`, (t?.milliGU ?? 0) / 1000, t ? TANKS[t.itemId].capacity / 1000 : 600, 'GU', 'o2')));
  const quick = h('div', '', 'st-actions'); quick.append(button('Заправить баллоны', () => { refill(id); say('', 'Заправка идёт'); }, 'st-btn accent'), button('Стоп', () => { refill(null); say('', 'Остановлено'); }, 'st-btn')); left.append(quick);
 } else if (b.kind === 'distributor') {
  left.append(meter('oxygen', 'Буфер O₂', b.oxygen / 1000, o2Max(b), 'GU', 'o2'), h('p', 'Наполняет купол до 20 GU/с, очищает воздух и держит +20 °C. Нужны труба O₂ и кабель питания.', 'st-note'));
 } else if (b.kind === 'dome') {
  left.append(meter('air', 'Воздух', b.zone.q / 1000, DOME_CAPACITY / 1000, 'GU', 'o2', 384), meter('purity', 'Чистота', b.zone.purity * 100, 100, '%', 'clean', 50));
  const quick = h('div', '', 'st-actions'); quick.append(button('Пройти шлюз', () => say(beginPassage(g, id), 'Шлюз: 6 с'), 'st-btn accent')); left.append(quick, h('p', 'Шлюз тратит до 4 GU воздуха за проход. Внутри пригодного купола баллоны не расходуются.', 'st-note'));
 }
 left.append(connections(ctx, b));
 const footer = h('div', '', 'st-actions st-foot');
 footer.append(button(b.enabled ? 'Выключить' : 'Включить', () => { b.enabled = !b.enabled; change(); }, 'st-btn small ghost'));
 if (b.job && b.kind !== 'workbench') footer.append(button('Отменить обработку', () => say(cancelJob(g, id), 'Оплаченное сырьё возвращено'), 'st-btn small ghost'));
 footer.append(button('Забрать станцию', () => { const e = packStation(g, id); say(e, 'Станция в рюкзаке'); }, 'st-btn small ghost'));
 if (b.input.slice(2).some(Boolean) || b.output.slice(1).some(Boolean)) { const legacy = h('details', '', 'st-legacy'); legacy.append(h('summary', 'Другие сохранённые ячейки')); for (const [source, from] of [[b.input, 2], [b.output, 1]] as const) source.forEach((v, i) => { if (v && i >= from) legacy.append(button(ITEMS[v.itemId].name + ' ×' + v.count, () => say(takeSlot(g, source, i), 'Предмет забран'), 'st-btn small')); }); footer.append(legacy); }
 left.append(footer);
 if (ACCEPTS[b.kind]) root.append(backpack(ctx, b.kind, i => say(loadMachineSlot(g, id, i), 'Загружено')));
 else root.classList.add('single');
 return root;
}
export function tickMachine(g: GameState, id: string) {
 if (id === 'capsule') {
  setMeter('capsule', g.world.capsuleMilliGU / 1000, CAPSULE_CAPACITY / 1000, 'GU');
  g.player.bottles.forEach((t, i) => setMeter('bottle-' + i, (t?.milliGU ?? 0) / 1000, t ? TANKS[t.itemId].capacity / 1000 : 600, 'GU'));
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
 if (b.kind === 'electrolyzer') { const t = b.input[1], e = document.getElementById('st-slot-1-Баллон'); if (e && t && TANKS[t.itemId]) e.textContent = Math.round((t.milliGU ?? 0) / TANKS[t.itemId].capacity * 100) + '%'; const w = document.getElementById('st-slot-0-Вода'); if (w) { const n = (b.input[0]?.itemId === 'water' ? b.input[0].count : 0) + b.water / 1000; w.textContent = n ? String(n) : ''; } }
 if (b.kind === 'refill') g.player.bottles.forEach((t, i) => setMeter('bottle-' + i, (t?.milliGU ?? 0) / 1000, t ? TANKS[t.itemId].capacity / 1000 : 600, 'GU'));
 if (b.kind === 'biogenerator') { setMeter('energy', b.energy / 1000, GEN_BUFFER / 1000, 'EU'); const f = document.getElementById('st-slot-0-Топливо'); if (f) f.textContent = String(countItem(b.input, 'fiber') || ''); }
 if (b.kind === 'kiln') { const f = document.getElementById('st-slot-1-Топливо'); if (f) f.textContent = String(b.input[1]?.count ?? ''); const raw = document.getElementById('st-slot-0-Сырьё'); if (raw) raw.textContent = String(b.input[0]?.count ?? ''); }
 if (b.kind === 'dome') { setMeter('air', b.zone.q / 1000, DOME_CAPACITY / 1000, 'GU'); setMeter('purity', b.zone.purity * 100, 100, '%'); }
 void endpoint; void gasRate;
}
