import { ITEMS } from '../game/defs';
import { countItem } from '../game/inventory';
import { RECIPES, RECIPE_BY_ID, WORKBENCH_UPGRADE, cancelJob, clearQueue, collectOutput, energyRate, loadRecipeInputs, machine, nearby, queueJob, removeQueuedJob, startJob, upgradeBuilding, powerRate, MAX_REPEAT, type Recipe, type Building } from '../game/production';
import { readyWorldItem } from '../game/backpack';
import { nearestNode, nearestStation, type GuideTarget } from '../game/guide';
import type { GameState } from '../game/state';
import { itemArt } from './art';
import { captureTokens, transferCraft, pulseCraft } from './craftMotion';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
const button = (text: string, fn: () => void, cls = '', disabled = false) => { const b = h('button', text, cls); b.type = 'button'; b.onclick = fn; b.disabled = disabled; return b; };
const name = (id: string) => ITEMS[id]?.name ?? ({ water: 'Вода', oxygen: 'Кислород', hydrogen: 'Водород' } as Record<string, string>)[id] ?? id;
export const STATION_NAME: Record<string, string> = { hand: 'В кармане', workbench: 'Верстак', kiln: 'Плавильная печь', electrolyzer: 'Генератор кислорода' };
const RAW = new Set(['stone', 'iron_raw', 'copper_raw', 'sand', 'ice', 'grass']);
/** Stable progression order; the list never jumps around while the player crafts. */
const ORDER = ['grass_parts', 'craft_tool_stone', 'craft_workbench', 'craft_kiln', 'smelt_iron_raw', 'smelt_copper_raw', 'glass', 'melt_in_generator', 'craft_wire', 'craft_cable', 'craft_circuit', 'craft_biogenerator', 'craft_electrolyzer', 'craft_gas_pipe', 'craft_bottle_1', 'craft_refill', 'craft_dome', 'craft_distributor', 'craft_wrench', 'electrolysis'];
const rank = (id: string) => { const i = ORDER.indexOf(id); return i < 0 ? 99 : i; };
export type CraftCategory = 'all' | 'material' | 'gear' | 'station' | 'line';
const CATEGORIES: [CraftCategory, string][] = [['all', 'Все'], ['material', 'Материалы'], ['gear', 'Снаряжение'], ['station', 'Станции'], ['line', 'Линии']];
export function recipeCategory(r: Recipe): CraftCategory {
 const out = Object.keys(r.outputs)[0];
 if (out === 'cable' || out === 'gas_pipe') return 'line';
 const c = ITEMS[out]?.category;
 return c === 'building' ? 'station' : c === 'tool' || c === 'tank' || c === 'suit' ? 'gear' : 'material';
}
const VISIBLE = RECIPES.filter(r => r.id !== 'legacy_melt').sort((a, b) => rank(a.id) - rank(b.id));
/** How many batches the player can pay for now (backpack plus what is already loaded). */
export function affordable(g: GameState, r: Recipe, b?: Building): number {
 let n = Infinity;
 for (const [id, k] of Object.entries(r.inputs)) n = Math.min(n, Math.floor((countItem(g.player.inventory, id) + countItem(b?.input ?? [], id) + (id === 'water' && b ? Math.floor(b.water / 1000) : 0)) / k));
 return Number.isFinite(n) ? n : 0;
}
type Notify = (reason: string, success?: string) => void;
type Nav = (target: GuideTarget) => void;
/**
 * Workshop (S3). Left: every recipe with its ingredients (have/need) and how many can be made now.
 * Right: what the item is for, where each ingredient comes from, quantity and one big action.
 * Pocket and workbench I take the materials straight from the backpack; the selected count runs
 * as repeated batches. Workbench II queues batches and works unattended with power.
 */
export function createCraftingView() {
 let selected = 'grass_parts', query = '', category: CraftCategory = 'all', onlyReady = false, quantity = 1, upgrade = false, lastStation = '';
 let listScroll = 0, detailScroll = 0, root: HTMLElement | null = null;
 let progress: HTMLElement | null = null, bar: HTMLElement | null = null, status: HTMLElement | null = null, previousJob: unknown = undefined, outputSig = '';
 let navigate: Nav | null = null;
 function open(id: string, isUpgrade = false, recipe?: string) {
  if (id !== lastStation) { lastStation = id; quantity = 1; if (!recipe) selected = id === 'hand' ? 'grass_parts' : 'craft_wire'; }
  if (recipe) { selected = recipe; query = ''; category = 'all'; onlyReady = false; quantity = 1; listScroll = -1; }
  upgrade = isUpgrade; previousJob = undefined; outputSig = '';
 }
 function sourceHint(g: GameState, id: string, need: number, stationKind: string) {
  const box = h('span', '', 'cr-source');
  if (RAW.has(id)) {
   const t = nearestNode(g, id);
   if (t) { const go = button(`${t.name} · ${Math.round(Math.hypot(t.x - g.player.x, t.z - g.player.z))} м`, () => navigate?.(t), 'cr-go'); go.title = 'Показать на компасе'; box.append(go); }
   else box.textContent = 'Запасы исчерпаны — ищите дальние залежи на карте';
   return box;
  }
  const r = VISIBLE.find(v => v.outputs[id]);
  if (r) { const go = button(`${STATION_NAME[r.station] ?? r.station}: ${name(Object.keys(r.outputs)[0])}`, () => { selected = r.id; quantity = Math.max(1, Math.ceil(need / r.outputs[id])); detailScroll = 0; listScroll = -1; redrawHook?.(); }, 'cr-link'); go.title = 'Открыть рецепт'; box.append(go); }
  else if (id === 'water') box.textContent = 'Печь: лёд + волокно → вода';
  void stationKind; return box;
 }
 let redrawHook: (() => void) | null = null;
 function jobCard(g: GameState, id: string, b: Building | undefined, notify: Notify, changed: () => void, redraw: () => void) {
  const job = b ? b.job : g.world.base.hand, auto = b?.level === 2, near = !b || nearby(g, b);
  const card = h('section', '', 'cr-work');
  const r = job ? RECIPE_BY_ID.get(job.recipeId) : null;
  const head = h('div', '', 'cr-work-head');
  if (r) head.append(itemArt(Object.keys(r.outputs)[0], 'art cr-work-art'));
  const text = h('div', '', 'cr-work-text');
  progress = h('b', r ? name(Object.keys(r.outputs)[0]) : 'Нет работы'); status = h('small', '');
  const track = h('i', '', 'cr-track'); bar = h('b'); track.append(bar); text.append(progress, status, track); head.append(text);
  if (job) { const x = button('Отменить', () => notify(cancelJob(g, id), 'Материалы возвращены'), 'cr-cancel', !near); x.title = 'Отменить: материалы вернутся в рюкзак'; head.append(x); }
  card.append(head);
  if (auto && b && b.queue.length) {
   const q = h('div', '', 'cr-queue');
   b.queue.forEach((rid, i) => { const chip = h('span', '', 'cr-queue-item'); chip.append(itemArt(Object.keys(RECIPE_BY_ID.get(rid)!.outputs)[0])); const rm = button('×', () => notify(removeQueuedJob(g, id, i), 'Партия убрана; материалы во входе'), 'cr-queue-x', !near); rm.setAttribute('aria-label', 'Убрать партию ' + (i + 2)); chip.append(rm); q.append(chip); });
   q.append(button('Очистить', () => { clearQueue(g, id); changed(); redraw(); }, 'cr-queue-clear', !near));
   card.append(q);
  }
  if (b && b.output.some(Boolean)) {
   const out = h('div', '', 'cr-output'); out.append(h('span', 'Готово:'));
   b.output.forEach(s => { if (s) { const c = h('span', '', 'cr-out-cell'); c.append(itemArt(s.itemId), h('b', String(s.count))); out.append(c); } });
   out.append(button('В рюкзак', () => { const tokens = captureTokens(out.querySelectorAll('.cr-out-cell')); const n = collectOutput(g, id); notify(n ? '' : 'Освободите место в рюкзаке', 'Перенесено в рюкзак'); if (n) transferCraft(tokens, '#production-panel .st-head'); }, 'cr-collect', !near));
   card.append(out);
  }
  return card;
 }
 function upgradeView(g: GameState, id: string, b: Building, notify: Notify) {
  const view = h('div', '', 'cr-upgrade'); view.dataset.mode = 'upgrade';
  const done = b.level === 2, near = nearby(g, b);
  const compare = h('div', '', 'cr-upgrade-compare');
  for (const [lvl, art] of [[1, 'workbench'], [2, 'workbench_2']] as const) { const c = h('div', '', 'cr-upgrade-card' + (lvl === 2 ? ' next' : '')); c.append(itemArt(art), h('b', 'Верстак ' + (lvl === 1 ? 'I' : 'II'))); compare.append(c); if (lvl === 1) compare.append(h('span', '→', 'cr-upgrade-arrow')); }
  const info = h('div', '', 'cr-upgrade-info');
  info.append(h('h3', done ? 'Верстак улучшен' : 'Улучшение до уровня II'));
  const perks = h('ul', '', 'cr-perks'); for (const t of ['Очередь до 5 партий', 'Работает без вас, если подключён кабелем', 'Потребляет 4 EU/с во время сборки']) perks.append(h('li', t)); info.append(perks);
  const cost = h('div', '', 'cr-ings-inline');
  for (const [item, n] of Object.entries(WORKBENCH_UPGRADE.inputs)) { const have = countItem(g.player.inventory, item), c = h('span', '', 'cr-chip' + (have >= n || done ? ' ok' : '')); c.append(itemArt(item), h('b', done ? '✓' : `${have}/${n}`)); c.title = name(item); cost.append(c); }
  const wrench = g.player.inventory.findIndex(s => s?.itemId === 'wrench'), key = h('span', '', 'cr-chip' + (wrench >= 0 || done ? ' ok' : '')); key.append(itemArt('wrench'), h('b', done ? '✓' : wrench >= 0 ? 'Ключ есть' : 'Нужен ключ')); cost.append(key);
  info.append(cost);
  const lack = Object.entries(WORKBENCH_UPGRADE.inputs).filter(([item, n]) => countItem(g.player.inventory, item) < n);
  const reason = done ? '' : !near ? 'Подойдите к верстаку' : wrench < 0 ? 'Соберите гаечный ключ (4 железа + 1 медь)' : b.job || b.queue.length ? 'Сначала завершите текущую работу' : lack.length ? 'Не хватает: ' + lack.map(([item, n]) => name(item) + ' ×' + (n - countItem(g.player.inventory, item))).join(', ') : '';
  const act = button(done ? 'К сборке' : 'Улучшить', () => {
   if (done) { upgrade = false; selected = 'craft_wire'; redrawHook?.(); return; }
   if (g.player.inventory[g.player.hotbar]?.itemId !== 'wrench' && wrench >= 0) readyWorldItem(g, wrench);
   const tokens = captureTokens(cost.querySelectorAll('.cr-chip')); const error = upgradeBuilding(g, id); notify(error, 'Верстак II готов'); if (!error) transferCraft(tokens, '.cr-upgrade-card.next');
  }, 'cr-create', !!reason);
  info.append(h('p', reason || (done ? 'Подключите питание кабелем и ставьте партии в очередь.' : 'Ключ не расходуется.'), 'cr-reason' + (reason ? ' warn' : '')), act);
  if (!done) info.append(button('Назад к рецептам', () => { upgrade = false; redrawHook?.(); }, 'cr-secondary'));
  view.append(compare, info); return view;
 }
 function draw(g: GameState, id: string, notify: Notify, changed: () => void, redraw: () => void, nav?: Nav): HTMLElement {
  redrawHook = redraw; if (nav) navigate = nav;
  if (root) { const l = root.querySelector('.cr-list'), d = root.querySelector('.cr-detail-scroll'); if (l && listScroll >= 0) listScroll = l.scrollTop; if (d) detailScroll = d.scrollTop; }
  const b = machine(g, id), kind = b?.kind ?? 'hand', auto = b?.level === 2, near = !b || nearby(g, b);
  if (upgrade && b) { root = upgradeView(g, id, b, notify); return root; }
  const view = h('div', '', 'cr-layout'); view.dataset.mode = auto ? 'auto' : b ? 'bench' : 'pocket'; root = view;
  // ---------- Catalogue ----------
  const side = h('aside', '', 'cr-side');
  const tools = h('div', '', 'cr-tools');
  const search = h('input'); search.type = 'search'; search.id = 'craft-search'; search.placeholder = 'Поиск'; search.value = query; search.setAttribute('aria-label', 'Поиск рецепта');
  search.oninput = () => { query = search.value; fill(); };
  const ready = button('Можно', () => { onlyReady = !onlyReady; redraw(); }, 'cr-filter'); ready.setAttribute('aria-pressed', String(onlyReady)); ready.title = 'Только то, что можно собрать сейчас';
  tools.append(search, ready);
  const cats = h('div', '', 'cr-cats'); for (const [value, label] of CATEGORIES) { const c = button(label, () => { category = value; listScroll = 0; redraw(); }, 'cr-cat'); c.setAttribute('aria-pressed', String(category === value)); cats.append(c); }
  const list = h('div', '', 'cr-list'); list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Рецепты');
  side.append(tools, cats, list);
  // Pocket recipes work everywhere; station recipes need that station.
  const usable = (r: Recipe) => r.station === kind || r.station === 'hand';
  function fill() {
   list.replaceChildren();
   if (b?.kind === 'workbench' && b.level === 1) { const up = button('', () => { upgrade = true; redraw(); }, 'cr-row cr-row-upgrade'); up.append(itemArt('workbench_2'), (() => { const t = h('span', '', 'cr-row-text'); t.append(h('b', 'Улучшить до Верстака II'), h('small', 'Очередь и автосборка')); return t; })(), h('span', '›', 'cr-badge')); list.append(up); }
   let index = 0;
   for (const r of VISIBLE) {
    const out = Object.keys(r.outputs)[0];
    if (query && !name(out).toLowerCase().includes(query.toLowerCase())) continue;
    if (category !== 'all' && recipeCategory(r) !== category) continue;
    const can = affordable(g, r, b), here = usable(r);
    if (onlyReady && (!here || can < 1)) continue;
    const row = button('', () => { selected = r.id; quantity = 1; detailScroll = 0; redraw(); }, 'cr-row' + (r.id === selected ? ' selected' : '') + (here ? '' : ' elsewhere'));
    row.dataset.recipe = r.id; row.style.setProperty('--i', String(index++)); row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(r.id === selected));
    const text = h('span', '', 'cr-row-text'); text.append(h('b', name(out) + (r.outputs[out] > 1 ? ' ×' + r.outputs[out] : '')));
    const chips = h('span', '', 'cr-row-chips');
    for (const [id, k] of Object.entries(r.inputs)) { const have = countItem(g.player.inventory, id) + countItem(b?.input ?? [], id), c = h('span', '', 'cr-mini' + (have >= k ? ' ok' : '')); c.append(itemArt(id), h('i', String(k))); c.title = `${name(id)}: ${have} / ${k}`; chips.append(c); }
    text.append(chips);
    const canHere = r.station === 'hand' ? affordable(g, r) : can;
    row.append(itemArt(out, 'art cr-row-art'), text, here ? h('span', canHere > 0 ? '×' + Math.min(canHere, 99) : '—', 'cr-badge' + (canHere > 0 ? ' ok' : '')) : h('span', STATION_NAME[r.station] ?? r.station, 'cr-badge station'));
    row.title = here ? (can > 0 ? `Можно собрать: ${can}` : 'Не хватает материалов') : 'Делается: ' + (STATION_NAME[r.station] ?? r.station);
    list.append(row);
   }
   if (!list.children.length) list.append(h('p', onlyReady ? 'Пока нечего собрать — проверьте журнал (J)' : 'Ничего не найдено', 'cr-empty'));
  }
  fill();
  // ---------- Recipe card ----------
  const r = RECIPE_BY_ID.get(selected) ?? VISIBLE[0], out = Object.keys(r.outputs)[0], here = usable(r), can = affordable(g, r, b);
  const main = h('main', '', 'cr-main'), scroll = h('div', '', 'cr-detail-scroll');
  const head = h('header', '', 'cr-card-head');
  head.append(itemArt(out, 'art cr-hero'));
  const titles = h('div', '', 'cr-titles'); titles.append(h('span', (STATION_NAME[r.station] ?? r.station) + ' · ' + r.seconds + ' с' + (b && here && energyRate(b, r) ? ' · ' + energyRate(b, r) + ' EU/с' : ''), 'cr-kicker'), h('h3', name(out) + (r.outputs[out] > 1 ? ' ×' + r.outputs[out] : '')));
  head.append(titles);
  scroll.append(head);
  const desc = ITEMS[out]?.description ?? (out === 'water' ? 'Переносимая вода для генератора кислорода.' : out === 'oxygen' ? 'Кислород для дыхания, баллонов и купола.' : '');
  if (desc) scroll.append(h('p', desc, 'cr-desc'));
  // Where this is made.
  const req = h('div', '', 'cr-req');
  if (here) req.append(h('span', '✓', 'cr-req-mark ok'), h('span', b ? (b.level === 2 ? 'Верстак II: очередь до 5 партий, работает без вас при питании' : near ? 'Верстак рядом: работает, пока вы рядом' : 'Подойдите к верстаку ближе 3 м') : 'Собирается в кармане, где угодно'));
  else {
   const st = r.station === 'hand' ? null : nearestStation(g, r.station);
   req.classList.add('warn'); req.append(h('span', '!', 'cr-req-mark'), h('span', r.station === 'hand' ? 'Это карманный рецепт: откройте крафт без станции (B вдали от верстака)' : st ? `Делается: ${STATION_NAME[r.station]} — ${Math.round(Math.hypot(st.x - g.player.x, st.z - g.player.z))} м` : `Нужна станция: ${STATION_NAME[r.station]}. Сначала создайте и установите её`));
   if (st) req.append(button('Показать', () => navigate?.(st), 'cr-go'));
  }
  scroll.append(req);
  const ings = h('ul', '', 'cr-ings');
  for (const [id, k] of Object.entries(r.inputs)) {
   const total = k * quantity, have = countItem(g.player.inventory, id) + countItem(b?.input ?? [], id) + (id === 'water' && b ? Math.floor(b.water / 1000) : 0);
   const li = h('li', '', 'cr-ing' + (have >= total ? ' ok' : ''));
   li.append(itemArt(id, 'art cr-ing-art'));
   const t = h('div', '', 'cr-ing-text'); t.append(h('span', name(id)), sourceHint(g, id, total - have, kind)); li.append(t, h('b', `${Math.min(have, 9999)} / ${total}`, 'cr-ing-count'));
   ings.append(li);
  }
  scroll.append(h('h4', 'Ингредиенты' + (quantity > 1 ? ` на ${quantity} партии` : '')), ings);
  const outs = Object.entries(r.outputs).filter(([id]) => id !== 'hydrogen');
  if (outs.length > 1 || r.outputs[out] > 1) { const res = h('div', '', 'cr-ings-inline'); for (const [id, k] of outs) { const c = h('span', '', 'cr-chip ok'); c.append(itemArt(id), h('b', '×' + k * quantity)); c.title = name(id); res.append(c); } scroll.append(h('h4', 'Результат'), res); }
  main.append(scroll);
  // ---------- Action bar ----------
  const pocket = r.station === 'hand', owner = pocket ? 'hand' : id, ob = pocket ? undefined : b, obAuto = !pocket && auto;
  const job = ob ? ob.job : g.world.base.hand, queueFree = obAuto ? 5 - ob!.queue.length - (ob!.job ? 1 : 0) : MAX_REPEAT + 1;
  const max = Math.max(1, Math.min(can, queueFree));
  quantity = Math.max(1, Math.min(quantity, obAuto ? Math.max(1, queueFree) : 99));
  const make = h('footer', '', 'cr-make');
  if (here) {
   const qty = h('div', '', 'cr-qty');
   const out2 = h('output', String(quantity)); out2.setAttribute('aria-label', 'Количество партий');
   qty.append(button('−', () => { quantity = Math.max(1, quantity - 1); redraw(); }, 'cr-step', quantity <= 1), out2, button('+', () => { quantity = Math.min(obAuto ? queueFree : 99, quantity + 1); redraw(); }, 'cr-step', quantity >= (obAuto ? queueFree : 99)), button('Макс', () => { quantity = max; redraw(); }, 'cr-max', can < 2));
   const missing = Object.entries(r.inputs).filter(([id, k]) => countItem(g.player.inventory, id) + countItem(ob?.input ?? [], id) < k);
   const reason = ob && !near ? 'Подойдите к верстаку' : !obAuto && job ? 'Идёт работа — дождитесь или отмените' : obAuto && queueFree < 1 ? 'Очередь заполнена' : missing.length ? 'Не хватает: ' + missing.map(([id]) => name(id)).join(', ') : '';
   const create = button(obAuto ? `В очередь ×${quantity}` : quantity > 1 ? `Создать ×${quantity}` : 'Создать', () => {
    const ins = [...ings.querySelectorAll('.cr-ing-art')];
    const tokens = captureTokens(ins, root?.querySelector('.cr-hero'));
    let error = '';
    if (obAuto) error = queueJob(g, r.id, owner, Math.min(quantity, queueFree));
    else {
     if (ob) error = loadRecipeInputs(g, r.id, owner);
     if (!error) error = startJob(g, r.id, owner, !!ob);
     if (!error) { const j = ob ? ob.job : g.world.base.hand; if (j) j.repeat = Math.max(0, Math.min(MAX_REPEAT, quantity - 1, affordable(g, r, ob))); }
    }
    notify(error, obAuto ? 'Добавлено в очередь' : 'Сборка начата');
    if (!error) transferCraft(tokens, '.cr-work');
   }, 'cr-create', !!reason);
   make.append(qty, create);
   if (reason) make.append(h('p', reason, 'cr-reason warn'));
  } else make.append(h('p', r.station === 'kiln' ? 'Откройте печь: положите сырьё в верхний слот и волокно в слот топлива — плавка пойдёт сама.' : r.station === 'electrolyzer' ? 'Положите воду в генератор кислорода и подайте питание.' : 'Этот рецепт собирается в другом месте.', 'cr-reason'));
  main.append(make);
  // Show the work that matters for this recipe: the pocket job, or the bench (with its queue and output).
  const showHand = pocket || (!!g.world.base.hand && !b?.job), card = showHand ? (g.world.base.hand ? jobCard(g, 'hand', undefined, notify, changed, redraw) : null) : (b && (b.job || b.queue.length || b.output.some(Boolean)) ? jobCard(g, id, b, notify, changed, redraw) : null);
  if (card) main.append(card); else { progress = bar = status = null; }
  tickOwner = card ? (showHand ? 'hand' : id) : '';
  view.append(side, main);
  queueMicrotask(() => { const l = view.querySelector('.cr-list'), d = view.querySelector('.cr-detail-scroll'); if (l) { if (listScroll < 0) { view.querySelector('.cr-row.selected')?.scrollIntoView({ block: 'center' }); listScroll = l.scrollTop; } else l.scrollTop = listScroll; } if (d) d.scrollTop = detailScroll; });
  tick(g, id);
  return view;
 }
 let tickOwner = '';
 function tick(g: GameState, stationId: string) {
  const bench = machine(g, stationId);
  // Finished workbench batches go straight to the backpack while the player stands at the bench.
  // A full backpack is retried only after the output or the backpack changes.
  if (bench && nearby(g, bench) && bench.output.some(Boolean)) { const sig = JSON.stringify([bench.output, g.player.inventory]); if (sig !== outputSig) { const n = collectOutput(g, stationId); outputSig = n ? '' : sig; if (n) queueMicrotask(() => { pulseCraft('#production-panel .st-head'); redrawHook?.(); }); } }
  if (!progress || !bar || !status || !tickOwner) return;
  const id = tickOwner, b = machine(g, id), job = b ? b.job : g.world.base.hand, r = job ? RECIPE_BY_ID.get(job.recipeId) : null;
  const ratio = job && r ? Math.min(1, job.workMs / (r.seconds * 1000)) : 0;
  bar.style.transform = `scaleX(${ratio})`;
  let text = '';
  if (job && r) {
   const left = Math.max(0, (r.seconds * 1000 - job.workMs) / 1000);
   text = ratio >= 1 ? (b ? 'Готово — освободите выход' : 'Готово — освободите место в рюкзаке') : `${Math.floor(ratio * 100)}% · ${left.toFixed(1)} с` + (job.repeat ? ` · ещё ${job.repeat}` : '') + (b?.level === 2 ? ` · очередь ${b.queue.length}` : '');
   if (b && !nearby(g, b) && b.level === 1) text = 'Пауза — подойдите к верстаку';
   if (b?.level === 2 && energyRate(b, r) && powerRate(b.id) <= 0 && ratio < 1) text = 'Пауза — нет питания (подключите кабель к генератору)';
   if (!b && g.world.base.hand && ratio < 1 && job.repeat) text += '';
  } else text = b ? (b.level === 2 ? 'Очередь пуста' : 'Выберите рецепт и нажмите «Создать»') : 'Выберите рецепт и нажмите «Создать»';
  if (status.textContent !== text) status.textContent = text;
  if (previousJob !== undefined && job && previousJob !== job) queueMicrotask(() => pulseCraft('.cr-work'));
  if (previousJob && !job) queueMicrotask(() => redrawHook?.());
  previousJob = job;
 }
 return { open, draw, tick, select: (id: string) => { selected = id; }, get mode() { return upgrade ? 'upgrade' : 'craft'; } };
}
