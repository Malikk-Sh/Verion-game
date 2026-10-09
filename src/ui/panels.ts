import { CATEGORY_LABEL, ITEMS, SUIT_PARTS, SUIT_PART_LABEL, TANKS, TOOLS, type SuitPart } from '../game/defs';
import { INVENTORY_SIZE, stateful, type Slot } from '../game/inventory';
import { HOTBAR_SIZE, type GameState } from '../game/state';
import { dropSlot, equipPart, installTank, moveSlot, readyWorldItem, removeTank, sortRest, splitSlot, unequipPart, wornParts, type Result } from '../game/backpack';
import { figureArt, ghostArt, itemArt } from './art';
/**
 * Inventory and suit screens (approved mock-ups «Инвентарь» and «Костюм»). Pure DOM over the
 * game state; every change goes through a backpack.ts transaction and then host.changed().
 * Phone-first moving: select → «Переместить» → tap the destination (empty: move, occupied: swap,
 * same stack: merge). Dragging a cell is an additional way to do the same.
 */
export type PanelHost = {
 game(): GameState | null;
 changed(what: 'inventory' | 'suit' | 'drop'): void;
 hazard(): boolean;
 tone(kind: 'ui' | 'item' | 'warn'): void;
 show(which: 'inventory-panel' | 'suit-panel'): void;
 close(): void;
};
type Sel = { kind: 'cell'; i: number } | { kind: 'tank'; b: 0 | 1 };
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const icon = (id: string) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.innerHTML = `<use href="#${id}"/>`; return s; };
function button(label: string, iconId: string, cls = 'ui-btn'): HTMLButtonElement { const b = h('button', cls); b.append(icon(iconId), h('span', '', label)); return b; }
const gu = (m: number) => Math.round(m / 1000);
export function itemState(s: NonNullable<Slot>) {
 if (s.durability !== undefined) return { label: 'Прочность', value: `${s.durability} / ${TOOLS[s.itemId].durability}`, ratio: s.durability / TOOLS[s.itemId].durability, kind: 'durability' };
 if (s.milliGU !== undefined) return { label: 'Кислород', value: `${gu(s.milliGU)} / ${gu(TANKS[s.itemId].capacity)} GU`, ratio: s.milliGU / TANKS[s.itemId].capacity, kind: 'gas' };
 if (ITEMS[s.itemId].stack > 1) return { label: 'Количество', value: `${s.count} / ${ITEMS[s.itemId].stack}`, ratio: s.count / ITEMS[s.itemId].stack, kind: 'count' };
 return null;
}
/** One cell: number, art, count, durability bar (shared by the hotbar and the backpack grid). */
export function cellContent(cell: HTMLElement, s: Slot, index: number, opts: { label?: boolean; number?: boolean } = {}) {
 cell.replaceChildren(...(opts.number === false ? [] : [h('span', 'cell-n', String(index + 1))]));
 cell.classList.remove('broken');
 if (!s) { cell.classList.add('empty'); return; }
 cell.classList.remove('empty');
 cell.append(itemArt(s.packed?.kind==='workbench'&&s.packed.level===2?'workbench_2':s.itemId));
 if(s.packed)cell.append(h('b','cell-count',s.packed.level===2?'II':'I'));
 if (s.durability !== undefined) { const bar = h('i', 'cell-bar'); bar.style.setProperty('--r', String(s.durability / TOOLS[s.itemId].durability)); if (!s.durability) cell.classList.add('broken'); cell.append(bar); }
 else if (s.milliGU !== undefined) { const bar = h('i', 'cell-bar gas'); bar.style.setProperty('--r', String(s.milliGU / TANKS[s.itemId].capacity)); cell.append(bar); }
 else if (!s.packed && (s.count > 1 || ITEMS[s.itemId].stack > 1)) cell.append(h('b', 'cell-count', String(s.count)));
 if (opts.label) cell.append(h('span', 'cell-label', ITEMS[s.itemId].short));
}
export const cellAria = (s: Slot, i: number) => !s ? `Ячейка ${i + 1}: пусто` : `Ячейка ${i + 1}: ${ITEMS[s.itemId].name}${s.packed?', упакована, уровень '+s.packed.level:''}${s.durability !== undefined ? `, прочность ${s.durability} из ${TOOLS[s.itemId].durability}` : s.milliGU !== undefined ? `, ${gu(s.milliGU)} GU` : `, ${s.count} шт.`}`;

export function createPanels(host: PanelHost) {
 let sel: Sel | null = null, moveFrom: number | null = null, part: SuitPart = 'helmet', replacing = false, message = '', suitMessage = '';
 const say = (r: Result, ok?: string) => { message = r.ok ? ok ?? '' : r.reason; if (!r.ok) host.tone('warn'); else host.tone('item'); };

 // ---------- Inventory ----------
 function selectCell(i: number) {
  const g = host.game(); if (!g) return;
  if (moveFrom !== null) { // destination tap
   const from = moveFrom; moveFrom = null;
   if (from !== i) { const r = moveSlot(g.player.inventory, from, i); say(r, g.player.inventory[from] ? 'Предметы поменялись местами' : 'Перемещено'); if (r.ok) { sel = { kind: 'cell', i }; host.changed('inventory'); } }
   else message = 'Перемещение отменено';
   drawInventory(); return;
  }
  sel = { kind: 'cell', i }; message = ''; host.tone('ui'); drawInventory();
 }
 function drawInventory() {
  const g = host.game(); if (!g) return;
  const inv = g.player.inventory;
  sel ??= { kind: 'cell', i: g.player.hotbar };
  // Gear column.
  const worn = Object.fromEntries(SUIT_PARTS.map(p => [p, !!g.player.suit[p]])) as Record<SuitPart, boolean>;
  el('suit-thumb').innerHTML = figureArt(worn);
  el('suit-minis').replaceChildren(...SUIT_PARTS.map(p => { const s = g.player.suit[p], m = h('span', 'mini' + (s ? '' : ' off')); m.append(s ? itemArt(s.itemId) : ghostArt(p)); m.title = `${SUIT_PART_LABEL[p]}: ${s ? ITEMS[s.itemId].name : 'не надето'}`; return m; }));
  for (const b of [0, 1] as const) {
   const card = el(`tank-${b}`), s = g.player.bottles[b];
   card.replaceChildren(h('span', 'card-label', `Баллон ${b + 1}`));
   card.classList.toggle('selected', sel.kind === 'tank' && sel.b === b); card.classList.toggle('empty', !s);
   if (s) { card.append(itemArt(s.itemId, 'art tank-art')); const bar = h('i', 'tank-bar'); bar.style.setProperty('--r', String((s.milliGU ?? 0) / TANKS[s.itemId].capacity)); card.append(bar, h('span', 'tank-value', `${gu(s.milliGU ?? 0)} / ${gu(TANKS[s.itemId].capacity)} GU`)); }
   else card.append(ghostArt('tank', 'art ghost tank-art'), h('span', 'tank-value muted', 'Пусто'));
   card.setAttribute('aria-label', `Баллон ${b + 1}: ${s ? `${ITEMS[s.itemId].name}, ${gu(s.milliGU ?? 0)} GU` : 'пусто'}`);
   card.onclick = () => { if (moveFrom !== null) { const g2 = host.game()!, src = moveFrom; moveFrom = null; const it = g2.player.inventory[src]; if (it && TANKS[it.itemId]) { say(installTank(g2, src, b), 'Баллон установлен'); host.changed('inventory'); } else { message = 'Сюда можно поставить только баллон'; host.tone('warn'); } drawInventory(); return; } sel = { kind: 'tank', b }; message = ''; host.tone('ui'); drawInventory(); };
  }
  // Grid.
  const used = inv.filter(Boolean).length;
  el('pack-count').textContent = `${used} / ${INVENTORY_SIZE}`;
  const grid = el('inventory-grid'); grid.classList.toggle('moving', moveFrom !== null);
  const frame = h('i', 'row-frame'); frame.setAttribute('aria-hidden', 'true');
  grid.replaceChildren(frame, ...inv.map((s, i) => {
   const c = h('button', 'cell'); c.dataset.cell = String(i); c.setAttribute('role', 'gridcell'); cellContent(c, s, i, { label: true });
   if (i < HOTBAR_SIZE) c.classList.add('row0');
   if (i === g.player.hotbar) c.classList.add('active');
   if (sel?.kind === 'cell' && sel.i === i) c.classList.add('selected');
   if (moveFrom === i) c.classList.add('source');
   c.setAttribute('aria-label', cellAria(s, i) + (i < HOTBAR_SIZE ? ', быстрый доступ' : ''));
   c.onclick = () => { if (dragged) { dragged = false; return; } selectCell(i); };
   c.addEventListener('pointerdown', e => startDrag(e, i, c));
   return c;
  }));
  el('pack-hint').textContent = moveFrom !== null ? `Выберите ячейку назначения для «${ITEMS[inv[moveFrom]!.itemId].short}». Пустая — перенос, занятая — обмен.` : message || 'Первая строка — быстрый доступ. Время идёт.';
  drawDetail(g);
 }
 function drawDetail(g: GameState) {
  const box = el('inv-detail'); box.replaceChildren(h('span', 'tag', 'Выбранный предмет'));
  const s = sel?.kind === 'cell' ? g.player.inventory[sel.i] : sel?.kind === 'tank' ? g.player.bottles[sel.b] : null;
  if (!s) { box.append(h('strong', 'd-name', sel?.kind === 'tank' ? `Баллон ${sel.b + 1}` : `Ячейка ${(sel?.kind === 'cell' ? sel.i : 0) + 1}`), h('span', 'd-cat', 'Пусто'), h('p', 'd-desc', sel?.kind === 'tank' ? 'Выберите баллон в рюкзаке и нажмите «Установить».' : 'Выберите предмет, чтобы увидеть его состояние и действия.')); return; }
  const d = ITEMS[s.itemId], st = itemState(s);
  box.append(h('strong', 'd-name', d.name), h('span', 'd-cat', CATEGORY_LABEL[d.category] + (sel?.kind === 'cell' && sel.i < HOTBAR_SIZE ? ` · быстрый доступ ${sel.i + 1}` : '')), itemArt(s.itemId, 'art d-art'));
  if (st) { const row = h('div', 'd-state'); row.append(h('span', '', st.label + ':'), h('b', '', st.value)); const bar = h('i', 'd-bar ' + st.kind); bar.style.setProperty('--r', String(st.ratio)); box.append(row, bar); }
  box.append(h('p', 'd-desc', d.description));
  const acts = h('div', 'd-actions');
  if (sel?.kind === 'tank') {
   const b = sel.b, rm = button('Снять в рюкзак', 'i-download'); rm.onclick = () => { const r = removeTank(g, b); say(r, 'Баллон перенесён в рюкзак'); if (r.ok) host.changed('inventory'); drawInventory(); }; acts.append(rm);
  } else if (sel?.kind === 'cell') {
   const i = sel.i;
   if(d.category==='building'||s.itemId==='cable'||s.itemId==='gas_pipe'){
    const use=button(d.category==='building'?'Разместить':'Соединить','i-plug');use.id='act-world';
    use.onclick=()=>{const r=readyWorldItem(g,i);say(r);if(r.ok){moveFrom=null;host.changed('inventory');host.close();}else drawInventory();};acts.append(use);
   }
   if (moveFrom === i) { const cancel = button('Отмена', 'i-close'); cancel.onclick = () => { moveFrom = null; message = 'Перемещение отменено'; host.tone('ui'); drawInventory(); }; acts.append(cancel); }
   else { const mv = button('Переместить', 'i-swap'); mv.id = 'act-move'; mv.onclick = () => { moveFrom = i; message = ''; host.tone('ui'); drawInventory(); }; acts.append(mv); }
   if (!stateful(s) && s.count > 1) { const sp = button('Разделить', 'i-split'); sp.id = 'act-split'; sp.onclick = () => { const r = splitSlot(g.player.inventory, i); say(r, 'Стак разделён'); if (r.ok) host.changed('inventory'); drawInventory(); }; acts.append(sp); }
   if (d.part) { const on = button(g.player.suit[d.part] ? 'Заменить надетое' : 'Надеть', 'i-helmet'); on.onclick = () => { const r = equipPart(g, i); say(r, 'Часть костюма надета'); if (r.ok) host.changed('suit'); drawInventory(); }; acts.append(on); }
   if (TANKS[s.itemId]) { const on = button('Установить', 'i-plug'); on.onclick = () => { const r = installTank(g, i); say(r, 'Баллон установлен'); if (r.ok) host.changed('inventory'); drawInventory(); }; acts.append(on); }
   const drop = button(s.count > 1 ? `Выбросить ×${s.count}` : 'Выбросить', 'i-trash', 'ui-btn amber'); drop.id = 'act-drop';
   drop.onclick = () => { moveFrom = null; const r = dropSlot(g, i); say(r, `${d.short} оставлен${s.count > 1 ? 'ы' : ''} на земле`); if (r.ok) host.changed('drop'); drawInventory(); };
   acts.append(drop);
  }
  acts.classList.toggle('two', acts.childElementCount > 2);
  box.append(acts);
 }
 // Optional drag & drop (mouse or finger): same transaction as «Переместить».
 let dragged = false, drag: { i: number; x: number; y: number; id: number; ghost?: HTMLElement } | null = null;
 function startDrag(e: PointerEvent, i: number, cell: HTMLElement) {
  const g = host.game(); if (!g?.player.inventory[i] || moveFrom !== null) return;
  drag = { i, x: e.clientX, y: e.clientY, id: e.pointerId }; dragged = false;
  const move = (ev: PointerEvent) => {
   if (!drag || ev.pointerId !== drag.id) return;
   if (!drag.ghost && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 10) { drag.ghost = cell.cloneNode(true) as HTMLElement; drag.ghost.classList.add('drag-ghost'); document.body.append(drag.ghost); cell.classList.add('source'); }
   if (drag.ghost) { ev.preventDefault(); drag.ghost.style.transform = `translate(${ev.clientX - 28}px,${ev.clientY - 28}px)`; }
  };
  const up = (ev: PointerEvent) => {
   if (!drag || ev.pointerId !== drag.id) return;
   removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
   const d = drag; drag = null;
   if (!d.ghost) return;
   d.ghost.remove(); dragged = true;
   const target = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-cell]');
   if (target) { const to = Number(target.dataset.cell), g2 = host.game()!; const r = moveSlot(g2.player.inventory, d.i, to); say(r, 'Перемещено'); if (r.ok) { sel = { kind: 'cell', i: to }; host.changed('inventory'); } }
   drawInventory(); setTimeout(() => { dragged = false; }, 0);
  };
  addEventListener('pointermove', move, { passive: false }); addEventListener('pointerup', up); addEventListener('pointercancel', up);
 }
 el('sort-rest').onclick = () => { const g = host.game(); if (!g) return; moveFrom = null; sortRest(g.player.inventory); message = 'Ячейки 7–24 отсортированы; первая строка не изменилась'; host.tone('item'); host.changed('inventory'); drawInventory(); };
 el('open-suit').onclick = () => { host.tone('ui'); replacing = false; suitMessage = ''; host.show('suit-panel'); };

 // ---------- Suit ----------
 let hold: { start: number; raf: number } | null = null;
 function drawSuit() {
  const g = host.game(); if (!g) return;
  const worn = Object.fromEntries(SUIT_PARTS.map(p => [p, !!g.player.suit[p]])) as Record<SuitPart, boolean>;
  el('worn-count').textContent = `${wornParts(g)} / 4 надето`;
  el('part-grid').replaceChildren(...SUIT_PARTS.map(p => {
   const s = g.player.suit[p], c = h('button', 'part-card' + (p === part ? ' selected' : '') + (s ? '' : ' off')); c.dataset.part = p;
   c.append(s ? itemArt(s.itemId, 'art part-art') : ghostArt(p, 'art ghost part-art'), h('b', '', SUIT_PART_LABEL[p]), h('small', '', s ? ITEMS[s.itemId].tier ?? '' : 'Не надето'));
   c.setAttribute('aria-label', `${SUIT_PART_LABEL[p]}: ${s ? ITEMS[s.itemId].name : 'не надето'}`);
   c.onclick = () => { part = p; replacing = false; suitMessage = ''; host.tone('ui'); drawSuit(); };
   return c;
  }));
  el('suit-figure').innerHTML = figureArt(worn, part);
  const box = el('suit-detail'), s = g.player.suit[part];
  box.replaceChildren(h('strong', 'd-name', s ? ITEMS[s.itemId].name : SUIT_PART_LABEL[part]), h('span', 'd-cat', s ? 'Часть костюма' : 'Слот пуст'));
  box.append(s ? itemArt(s.itemId, 'art d-art') : ghostArt(part, 'art ghost d-art'));
  if (replacing) {
   const options = g.player.inventory.map((it, i) => ({ it, i })).filter(o => o.it && ITEMS[o.it.itemId].part === part);
   const list = h('div', 'replace-list'); list.append(h('span', 'tag', 'Выберите из рюкзака'));
   if (!options.length) list.append(h('p', 'd-desc', `В рюкзаке нет подходящих частей («${SUIT_PART_LABEL[part]}»).`));
   for (const o of options) { const b = h('button', 'ui-btn option'); b.append(itemArt(o.it!.itemId), h('span', '', `${ITEMS[o.it!.itemId].name} · ячейка ${o.i + 1}`)); b.onclick = () => { const r = equipPart(g, o.i); suitMessage = r.ok ? (s ? 'Часть заменена; прежняя — в рюкзаке' : 'Часть надета') : r.reason; host.tone(r.ok ? 'item' : 'warn'); replacing = false; if (r.ok) host.changed('suit'); drawSuit(); }; list.append(b); }
   const cancel = button('Отмена', 'i-close'); cancel.onclick = () => { replacing = false; host.tone('ui'); drawSuit(); };
   list.append(cancel); box.append(list);
  } else {
   box.append(h('p', 'd-desc', s ? ITEMS[s.itemId].description : 'Часть не надета. Наденьте подходящую часть из рюкзака.'));
   const acts = h('div', 'd-actions');
   const rep = button(s ? 'Заменить' : 'Надеть', 'i-swap'); rep.id = 'suit-replace'; rep.onclick = () => { replacing = true; suitMessage = ''; host.tone('ui'); drawSuit(); }; acts.append(rep);
   if (s) {
    const danger = host.hazard();
    const off = button(danger ? 'Снять · удерживать' : 'Снять', 'i-trash', 'ui-btn amber hold'); off.id = 'suit-remove';
    const finish = () => { cancelHold(off); const r = unequipPart(g, part); suitMessage = r.ok ? 'Часть снята и лежит в рюкзаке' : r.reason; host.tone(r.ok ? 'item' : 'warn'); if (r.ok) host.changed('suit'); drawSuit(); };
    if (danger) {
     const begin = (e: Event) => { e.preventDefault(); if (hold) return; const start = performance.now(); const tick = () => { const p = Math.min(1, (performance.now() - start) / 1000); off.style.setProperty('--hold', String(p)); if (p >= 1) finish(); else if (hold) hold.raf = requestAnimationFrame(tick); }; hold = { start, raf: requestAnimationFrame(tick) }; };
     off.addEventListener('pointerdown', begin); for (const t of ['pointerup', 'pointerleave', 'pointercancel']) off.addEventListener(t, () => cancelHold(off));
     off.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) begin(e); }); off.addEventListener('keyup', () => cancelHold(off));
     off.onclick = e => e.preventDefault();
    } else off.onclick = finish;
    acts.append(off);
   }
   box.append(acts);
   const note = h('p', 'd-warn' + (suitMessage ? ' msg' : ''));
   note.append(icon('i-warn'), h('span', '', suitMessage || (host.hazard() ? 'В опасной среде' : 'Внутри капсулы')));
   box.append(note);
  }
 }
 function cancelHold(b: HTMLElement) { if (hold) { cancelAnimationFrame(hold.raf); hold = null; } b.style.setProperty('--hold', '0'); }
 el('suit-back').onclick = () => { host.tone('ui'); replacing = false; host.show('inventory-panel'); };
 el('close-suit').onclick = () => { host.tone('ui'); host.close(); };
 return {
  drawInventory, drawSuit,
  /** Called when the inventory opens: selection starts at the active hotbar cell, move mode off. */
  reset() { sel = null; moveFrom = null; message = ''; replacing = false; suitMessage = ''; },
  get debug() { return { sel, moveFrom, part, replacing }; },
 };
}
