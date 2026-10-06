import { ITEMS, MATERIALS, TOOLS } from './defs';
import { addItems, firstEmpty, stateful } from './inventory';
import { NODE_BY_ID } from './resources';
import type { GameState, ItemStack } from './state';
import { TICK_MS } from './clock';
/**
 * Hold-to-mine (SYSTEMS §3). Progress is transient: releasing or moving the aim resets it and
 * consumes nothing. A finished block removes one unit from the node, wears the tool by 1 and
 * yields one item. Inventory overflow goes into a real ground pile — never deleted.
 */
export type Mining = { nodeId: string | null; ticks: number };
export type MineEvent =
 | { kind: 'idle' }
 | { kind: 'progress'; nodeId: string; ratio: number }
 | { kind: 'blocked'; nodeId: string; reason: string }
 | { kind: 'block'; nodeId: string; itemId: string; toInventory: number; toGround: number; left: number; toolBroke: boolean };
export const REACH = 3.2;
/** The active tool is the one in the selected hotbar cell (S1 UI): −1 when that cell holds no usable tool. */
export function toolSlot(state: GameState): number {
 const i = state.player.hotbar, s = state.player.inventory[i];
 return s && TOOLS[s.itemId] && (s.durability ?? 0) > 0 ? i : -1;
}
export const ticksFor = (material: keyof typeof MATERIALS, timeMul: number) => Math.round(MATERIALS[material].seconds * timeMul * 1000 / TICK_MS);
/** One 50 ms tick of mining. Mutates `state` and `mining`. */
export function mineTick(state: GameState, mining: Mining, aimNodeId: string | null, holding: boolean): MineEvent {
 if (!holding || !aimNodeId) { mining.nodeId = null; mining.ticks = 0; return { kind: 'idle' }; }
 if (mining.nodeId !== aimNodeId) { mining.nodeId = aimNodeId; mining.ticks = 0; }
 const node = NODE_BY_ID.get(aimNodeId);
 if (!node) { mining.nodeId = null; mining.ticks = 0; return { kind: 'idle' }; }
 if ((state.world.nodes[node.id] ?? 0) <= 0) { mining.ticks = 0; return { kind: 'blocked', nodeId: node.id, reason: 'Запас исчерпан' }; }
 const inv = state.player.inventory, ti = toolSlot(state);
 if (ti < 0 && node.material !== 'grass') { mining.ticks = 0; const sel = inv[state.player.hotbar]; return { kind: 'blocked', nodeId: node.id, reason: sel && TOOLS[sel.itemId] ? 'Инструмент сломан' : inv.some(s => s && TOOLS[s.itemId]) ? 'Выберите мультитул в быстром доступе' : 'Нужен инструмент' }; }
 const tool = ti >= 0 && node.material !== 'grass' ? inv[ti]! : null, def = tool ? TOOLS[tool.itemId] : { tier: 0, timeMul: 1 };
 if (def.tier < MATERIALS[node.material].tier) { mining.ticks = 0; return { kind: 'blocked', nodeId: node.id, reason: 'Нужен инструмент выше уровнем' }; }
 const need = ticksFor(node.material, def.timeMul);
 mining.ticks++;
 if (mining.ticks < need) return { kind: 'progress', nodeId: node.id, ratio: mining.ticks / need };
 // Complete: one logical transaction.
 mining.ticks = 0;
 state.world.nodes[node.id]--;
 if (tool) tool.durability = (tool.durability ?? 0) - 1;
 const ground = addItems(inv, node.itemId, 1);
 if (ground) dropItems(state, state.player.x, state.player.z, [{ itemId: node.itemId, count: ground }]);
 return { kind: 'block', nodeId: node.id, itemId: node.itemId, toInventory: 1 - ground, toGround: ground, left: state.world.nodes[node.id], toolBroke: tool?.durability === 0 };
}
/** Adds items to the nearest pile within 2 m (≤64 entries) or creates a new one. Stateful items keep their state and never merge. */
export function dropItems(state: GameState, x: number, z: number, items: ItemStack[]) {
 let pile = state.world.drops.find(d => Math.hypot(d.x - x, d.z - z) < 2 && d.items.length + items.length <= 64);
 if (!pile) { pile = { id: 'drop-' + state.world.nextDropId++, x, z, items: [] }; state.world.drops.push(pile); }
 for (const it of items) { const s = stateful(it) ? undefined : pile.items.find(p => p.itemId === it.itemId && !stateful(p)); if (s) s.count += it.count; else pile.items.push({ ...it }); }
 return pile;
}
/** Moves whatever fits from a pile into the inventory; empty piles disappear. Returns moved count. */
export function pickUp(state: GameState, dropId: string): number {
 const i = state.world.drops.findIndex(d => d.id === dropId); if (i < 0) return 0;
 const pile = state.world.drops[i], inv = state.player.inventory; let moved = 0;
 for (const it of pile.items) {
  if (stateful(it)) { const to = firstEmpty(inv); if (to >= 0) { inv[to] = { ...it }; it.count = 0; moved++; } continue; }
  const left = addItems(inv, it.itemId, it.count); moved += it.count - left; it.count = left;
 }
 pile.items = pile.items.filter(it => it.count > 0);
 if (!pile.items.length) state.world.drops.splice(i, 1);
 return moved;
}
export const itemName = (id: string) => ITEMS[id]?.name ?? id;
