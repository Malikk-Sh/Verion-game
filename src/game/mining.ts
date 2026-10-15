import { HAND_MINING, ITEMS, MATERIALS, TOOLS } from './defs';
import { addItems, firstEmpty, stateful } from './inventory';
import { depositById, depositLeft, isVeinId, type ResourceNode } from './resources';
import { queueRespawn } from './nature';
import type { GameState, ItemStack } from './state';
import { TICK_MS } from './clock';
/**
 * Hold-to-mine (SYSTEMS §3). Progress is transient: releasing or moving the aim resets it and
 * consumes nothing. A finished block removes one unit from the node, wears the tool by 1 and
 * yields one item. Inventory overflow goes into a real ground pile — never deleted. A deposit that runs out
 * (a static one stays at 0, a vein is removed) queues one new vein of its material (S4, D33); grass regrows instead.
 */
export type Mining = { nodeId: string | null; ticks: number };
export type MineEvent =
 | { kind: 'idle' }
 | { kind: 'progress'; nodeId: string; ratio: number; tick: number; need: number }
 | { kind: 'blocked'; nodeId: string; reason: string }
 | { kind: 'block'; nodeId: string; itemId: string; toInventory: number; toGround: number; left: number; toolBroke: boolean; need: number; /** The deposit as it was mined (a finished vein is already gone from the state). */ node: ResourceNode };
export const REACH = 3.2;
/** The active tool is the one in the selected hotbar cell (S1 UI): −1 when that cell holds no usable tool. */
export function toolSlot(state: GameState): number {
 const i = state.player.hotbar, s = state.player.inventory[i];
 return s && TOOLS[s.itemId] && (s.durability ?? 0) > 0 ? i : -1;
}
export const ticksFor = (material: keyof typeof MATERIALS, timeMul: number) => Math.round(MATERIALS[material].seconds * timeMul * 1000 / TICK_MS);
/** Seconds per block for the current selection: tool speed, or the slower bare-hand rate; null if impossible. */
export function mineSeconds(state: GameState, material: keyof typeof MATERIALS): number | null {
 const ti = toolSlot(state);
 if (material !== 'grass' && ti >= 0) return ticksFor(material, TOOLS[state.player.inventory[ti]!.itemId].timeMul) * TICK_MS / 1000;
 const hand = HAND_MINING[material];
 return hand === undefined ? null : ticksFor(material, hand) * TICK_MS / 1000;
}
/** One 50 ms tick of mining. Mutates `state` and `mining`. */
export function mineTick(state: GameState, mining: Mining, aimNodeId: string | null, holding: boolean): MineEvent {
 if (!holding || !aimNodeId) { mining.nodeId = null; mining.ticks = 0; return { kind: 'idle' }; }
 if (mining.nodeId !== aimNodeId) { mining.nodeId = aimNodeId; mining.ticks = 0; }
 const node = depositById(state, aimNodeId);
 if (!node) { mining.nodeId = null; mining.ticks = 0; return { kind: 'idle' }; }
 if (depositLeft(state, node.id) <= 0) { mining.ticks = 0; return { kind: 'blocked', nodeId: node.id, reason: 'Запас исчерпан' }; }
 const inv = state.player.inventory, ti = toolSlot(state), hand = HAND_MINING[node.material];
 if (ti < 0 && hand === undefined) { mining.ticks = 0; const sel = inv[state.player.hotbar]; return { kind: 'blocked', nodeId: node.id, reason: sel && TOOLS[sel.itemId] ? 'Инструмент сломан' : inv.some(s => s && TOOLS[s.itemId]) ? 'Выберите мультитул в быстром доступе' : 'Нужен инструмент' }; }
 const tool = ti >= 0 && node.material !== 'grass' ? inv[ti]! : null, def = tool ? TOOLS[tool.itemId] : { tier: 0, timeMul: hand ?? 1 };
 if (def.tier < MATERIALS[node.material].tier) { mining.ticks = 0; return { kind: 'blocked', nodeId: node.id, reason: 'Нужен инструмент выше уровнем' }; }
 const need = ticksFor(node.material, def.timeMul);
 mining.ticks++;
 if (mining.ticks < need) return { kind: 'progress', nodeId: node.id, ratio: mining.ticks / need, tick: mining.ticks, need };
 // Complete: one logical transaction.
 mining.ticks = 0;
 let left: number;
 if (isVeinId(node.id)) { const vi = state.world.veins.findIndex(v => v.id === node.id), v = state.world.veins[vi]; left = --v.amount; if (!left) state.world.veins.splice(vi, 1); }
 else left = --state.world.nodes[node.id];
 if (!left && node.material !== 'grass') queueRespawn(state, node.material);
 if (tool) tool.durability = (tool.durability ?? 0) - 1;
 const ground = addItems(inv, node.itemId, 1);
 if (ground) dropItems(state, state.player.x, state.player.z, [{ itemId: node.itemId, count: ground }]);
 return { kind: 'block', nodeId: node.id, itemId: node.itemId, toInventory: 1 - ground, toGround: ground, left, toolBroke: tool?.durability === 0, need, node };
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
/** Aim label under the reticle (S4): what is left in the deposit and how many the player carries. */
export const stockText = (left: number, amount: number, carried: number) => `Запас ${left}/${amount} · в рюкзаке ${carried}`;
/** Durability warning for a tool at or below 10% of its maximum (a broken tool has its own message); '' otherwise. */
export const wearText = (durability: number | undefined, max: number | undefined) => durability !== undefined && !!max && durability > 0 && durability <= max * .1 ? `Прочность ${durability}/${max}` : '';
