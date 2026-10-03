import { ITEMS } from './defs';
/** One inventory slot. Items with state (tools, bottles) always have count 1. */
export type Slot = { itemId: string; count: number; durability?: number; milliGU?: number } | null;
export const INVENTORY_SIZE = 24;
export const emptyInventory = (): Slot[] => Array.from({ length: INVENTORY_SIZE }, () => null);
const stackOf = (id: string) => ITEMS[id]?.stack ?? 1;
const stateful = (s: NonNullable<Slot>) => s.durability !== undefined || s.milliGU !== undefined;
/** How many of `itemId` would fit. */
export function capacityFor(slots: Slot[], itemId: string) {
 const max = stackOf(itemId); let n = 0;
 for (const s of slots) { if (!s) n += max; else if (s.itemId === itemId && !stateful(s)) n += max - s.count; }
 return n;
}
/**
 * Adds plain stackable items (fills existing stacks first, then empty slots).
 * Returns the count that did not fit; the caller must place the rest somewhere real
 * (a ground pile) — SYSTEMS §1: overflow is never deleted.
 */
export function addItems(slots: Slot[], itemId: string, count: number): number {
 const max = stackOf(itemId); let left = Math.max(0, Math.floor(count));
 for (const s of slots) { if (!left) break; if (s && s.itemId === itemId && !stateful(s) && s.count < max) { const k = Math.min(max - s.count, left); s.count += k; left -= k; } }
 for (let i = 0; i < slots.length && left; i++) if (!slots[i]) { const k = Math.min(max, left); slots[i] = { itemId, count: k }; left -= k; }
 return left;
}
/** Removes up to `count`; returns how many were removed. */
export function removeItems(slots: Slot[], itemId: string, count: number): number {
 let left = count;
 for (let i = slots.length - 1; i >= 0 && left; i--) { const s = slots[i]; if (s && s.itemId === itemId && !stateful(s)) { const k = Math.min(s.count, left); s.count -= k; left -= k; if (!s.count) slots[i] = null; } }
 return count - left;
}
export const countItem = (slots: Slot[], itemId: string) => slots.reduce((n, s) => n + (s && s.itemId === itemId ? s.count : 0), 0);
