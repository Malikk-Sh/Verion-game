import { ITEMS, SUIT_PARTS, TANKS, TOOLS, type SuitPart } from './defs';
import { firstEmpty, stackOf, stateful, type Slot } from './inventory';
import { HOTBAR_SIZE, type GameState } from './state';
import { dropItems } from './mining';
/**
 * Inventory operations of the S1 UI (SYSTEMS §1). Every function is a single logical
 * transaction on GameState: it either completes fully or changes nothing and returns a reason.
 * The hotbar is not a container: it is the first row (cells 0…5) of the 24-cell backpack.
 */
export type Result = { ok: true; index?: number } | { ok: false; reason: string };
const fail = (reason: string): Result => ({ ok: false, reason });
const inRange = (i: number, n: number) => Number.isInteger(i) && i >= 0 && i < n;

/** Move `from` → `to`: into an empty cell it moves, onto the same stackable item it merges, otherwise the two cells swap. */
export function moveSlot(inv: Slot[], from: number, to: number): Result {
 if (!inRange(from, inv.length) || !inRange(to, inv.length)) return fail('Нет такой ячейки');
 const a = inv[from], b = inv[to];
 if (!a) return fail('Ячейка пуста');
 if (from === to) return { ok: true, index: to };
 if (b && b.itemId === a.itemId && !stateful(a) && !stateful(b) && b.count < stackOf(b.itemId)) {
  const k = Math.min(stackOf(b.itemId) - b.count, a.count); b.count += k; a.count -= k; if (!a.count) inv[from] = null;
  return { ok: true, index: to };
 }
 inv[to] = a; inv[from] = b; return { ok: true, index: to };
}
/** Splits half of a stack into the first empty cell (backpack rows first, then the hotbar row). */
export function splitSlot(inv: Slot[], i: number): Result {
 const s = inv[i];
 if (!s || stateful(s) || s.count < 2) return fail('Этот предмет нельзя разделить');
 const to = firstEmpty(inv, HOTBAR_SIZE);
 if (to < 0) return fail('Нет свободной ячейки');
 const half = Math.floor(s.count / 2); s.count -= half; inv[to] = { itemId: s.itemId, count: half };
 return { ok: true, index: to };
}
const ORDER = { tool: 0, tank: 1, suit: 2, food: 3, resource: 4 } as const;
/** Sorts cells 7…24 only: merges equal stacks, then orders by category and name. The first row is untouched. */
export function sortRest(inv: Slot[]) {
 const rest = inv.slice(HOTBAR_SIZE).filter((s): s is NonNullable<Slot> => !!s);
 const plain = new Map<string, number>(), keep: NonNullable<Slot>[] = [];
 for (const s of rest) { if (stateful(s)) keep.push(s); else plain.set(s.itemId, (plain.get(s.itemId) ?? 0) + s.count); }
 for (const [itemId, total] of plain) { let left = total; while (left > 0) { const k = Math.min(stackOf(itemId), left); keep.push({ itemId, count: k }); left -= k; } }
 keep.sort((a, b) => ORDER[ITEMS[a.itemId].category] - ORDER[ITEMS[b.itemId].category] || ITEMS[a.itemId].name.localeCompare(ITEMS[b.itemId].name, 'ru') || b.count - a.count || (b.durability ?? 0) - (a.durability ?? 0) || (b.milliGU ?? 0) - (a.milliGU ?? 0));
 for (let i = HOTBAR_SIZE; i < inv.length; i++) inv[i] = keep[i - HOTBAR_SIZE] ?? null;
}
/** Drops a whole cell (or `count` of a plain stack) into a real ground pile in front of the player. */
export function dropSlot(state: GameState, i: number, count?: number): Result {
 const inv = state.player.inventory, s = inv[i];
 if (!s) return fail('Ячейка пуста');
 const n = stateful(s) ? 1 : Math.max(1, Math.min(s.count, Math.floor(count ?? s.count)));
 const p = state.player, x = p.x + Math.sin(p.yaw) * 1.1, z = p.z + Math.cos(p.yaw) * 1.1;
 const item = n === s.count ? s : { itemId: s.itemId, count: n };
 dropItems(state, x, z, [{ ...item }]);
 if (n === s.count) inv[i] = null; else s.count -= n;
 return { ok: true };
}
export const selectHotbar = (state: GameState, i: number) => { if (inRange(i, HOTBAR_SIZE)) state.player.hotbar = i; };
/** The tool in the selected hotbar cell, or null — the active tool is defined by the selection, not by search. */
export function selectedTool(state: GameState) {
 const s = state.player.inventory[state.player.hotbar];
 return s && TOOLS[s.itemId] ? s : null;
}
export const wornParts = (state: GameState) => SUIT_PARTS.filter(p => !!state.player.suit[p]).length;
/** Puts a suit part from the backpack on; the part it replaces goes into the same cell. */
export function equipPart(state: GameState, invIndex: number): Result {
 const inv = state.player.inventory, s = inv[invIndex];
 const part = s ? ITEMS[s.itemId].part : undefined;
 if (!s || !part) return fail('Это не часть костюма');
 inv[invIndex] = state.player.suit[part]; state.player.suit[part] = s;
 return { ok: true, index: invIndex };
}
/** Takes a part off into the backpack; refused (nothing changes) when there is no free cell. */
export function unequipPart(state: GameState, part: SuitPart): Result {
 const s = state.player.suit[part];
 if (!s) return fail('Эта часть не надета');
 const to = firstEmpty(state.player.inventory, HOTBAR_SIZE);
 if (to < 0) return fail('Нет места в рюкзаке — освободите ячейку, чтобы снять часть');
 state.player.inventory[to] = s; state.player.suit[part] = null;
 return { ok: true, index: to };
}
/** Installs a tank from the backpack into tank slot `b` (swapping with what is there). */
export function installTank(state: GameState, invIndex: number, b?: 0 | 1): Result {
 const inv = state.player.inventory, s = inv[invIndex];
 if (!s || !TANKS[s.itemId]) return fail('Это не баллон');
 const slotIdx = b ?? (state.player.bottles[0] ? state.player.bottles[1] ? 0 : 1 : 0);
 inv[invIndex] = state.player.bottles[slotIdx]; state.player.bottles[slotIdx] = s;
 return { ok: true, index: slotIdx };
}
export function removeTank(state: GameState, b: 0 | 1): Result {
 const s = state.player.bottles[b];
 if (!s) return fail('Слот баллона пуст');
 const to = firstEmpty(state.player.inventory, HOTBAR_SIZE);
 if (to < 0) return fail('Нет места в рюкзаке');
 state.player.inventory[to] = s; state.player.bottles[b] = null;
 return { ok: true, index: to };
}
/** Oxygen carried in installed tanks, in GU. */
export const oxygenGU = (state: GameState) => state.player.bottles.reduce((n, b) => n + (b?.milliGU ?? 0), 0) / 1000;
export const oxygenCapacityGU = (state: GameState) => state.player.bottles.reduce((n, b) => n + (b ? TANKS[b.itemId].capacity : 0), 0) / 1000;
