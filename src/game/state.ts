import { CONTENT_VERSION, GENERATOR_VERSION, ITEMS, TOOLS } from './defs';
import { emptyInventory, INVENTORY_SIZE, type Slot } from './inventory';
import { NODES, NODE_BY_ID } from './resources';
/**
 * Complete persistent game state of the first stage. Plain JSON only: no class instances,
 * GPU objects or functions (TECHNICAL §2). Revision numbers live in save manifests.
 */
export type ItemStack = { itemId: string; count: number };
export type Drop = { id: string; x: number; z: number; items: ItemStack[] };
export type GameState = {
 meta: { worldId: string; name: string; seed: number; planetId: 'verdana'; generatorVersion: number; contentVersion: string; createdAt: number; activeTicks: number };
 player: { x: number; y: number; z: number; yaw: number; pitch: number; suit: string; bottles: [Slot, Slot]; inventory: Slot[] };
 world: { nodes: Record<string, number>; drops: Drop[]; nextDropId: number };
 progress: { visited: string[]; discovered: string[]; selected: string };
};
export const SPAWN_POSE = { x: 40, z: 42, yaw: .38, pitch: -.035 };
export function newGame(worldId: string, seed: number, createdAt: number, y: number, name = 'Экспедиция'): GameState {
 const inventory = emptyInventory();
 inventory[0] = { itemId: 'tool_stone', count: 1, durability: TOOLS.tool_stone.durability };
 inventory[1] = { itemId: 'pulp', count: 4 };
 return {
  meta: { worldId, name, seed: seed >>> 0, planetId: 'verdana', generatorVersion: GENERATOR_VERSION, contentVersion: CONTENT_VERSION, createdAt, activeTicks: 0 },
  player: { x: SPAWN_POSE.x, y, z: SPAWN_POSE.z, yaw: SPAWN_POSE.yaw, pitch: SPAWN_POSE.pitch, suit: 'suit', bottles: [{ itemId: 'bottle_1', count: 1, milliGU: 240000 }, null], inventory },
  world: { nodes: Object.fromEntries(NODES.map(n => [n.id, n.amount])), drops: [], nextDropId: 1 },
  progress: { visited: [], discovered: [], selected: 'iron' },
 };
}
export const cloneState = (s: GameState): GameState => structuredClone(s);

// ---------- Strict validation for imports and loaded pages ----------
export class InvalidState extends Error { constructor(path: string, why: string) { super(`${path}: ${why}`); this.name = 'InvalidState'; } }
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
function obj(v: unknown, p: string): Obj { if (!isObj(v)) throw new InvalidState(p, 'ожидался объект'); return v; }
function num(v: unknown, p: string, min: number, max: number) { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new InvalidState(p, `число вне ${min}…${max}`); return v; }
function int(v: unknown, p: string, min: number, max: number) { const n = num(v, p, min, max); if (!Number.isInteger(n)) throw new InvalidState(p, 'ожидалось целое'); return n; }
function str(v: unknown, p: string, max = 64, re = /^[\p{L}\p{N} _.:\-]*$/u) { if (typeof v !== 'string' || v.length > max || !re.test(v)) throw new InvalidState(p, 'недопустимая строка'); return v; }
function arr(v: unknown, p: string, max: number) { if (!Array.isArray(v) || v.length > max) throw new InvalidState(p, `ожидался массив ≤${max}`); return v; }
const ID = /^[a-z0-9_\-]+$/;
function slot(v: unknown, p: string): Slot {
 if (v === null) return null;
 const o = obj(v, p), itemId = str(o.itemId, p + '.itemId', 40, ID), def = ITEMS[itemId];
 if (!def) throw new InvalidState(p + '.itemId', `неизвестный предмет ${itemId}`);
 const s: NonNullable<Slot> = { itemId, count: int(o.count, p + '.count', 1, def.stack) };
 if (o.durability !== undefined) { if (!TOOLS[itemId]) throw new InvalidState(p, 'прочность у не-инструмента'); s.durability = int(o.durability, p + '.durability', 0, TOOLS[itemId].durability); }
 if (o.milliGU !== undefined) { if (itemId !== 'bottle_1') throw new InvalidState(p, 'газ у не-баллона'); s.milliGU = int(o.milliGU, p + '.milliGU', 0, 240000); }
 if (TOOLS[itemId] && s.durability === undefined) throw new InvalidState(p, 'нет прочности инструмента');
 return s;
}
const stack = (v: unknown, p: string): ItemStack => { const o = obj(v, p), itemId = str(o.itemId, p + '.itemId', 40, ID); if (!ITEMS[itemId] || TOOLS[itemId] || itemId === 'bottle_1') throw new InvalidState(p, 'недопустимый предмет кучи'); return { itemId, count: int(o.count, p + '.count', 1, 1e6) }; };
/** Rebuilds a fresh GameState from untrusted JSON; unknown keys are dropped, bad values throw. */
export function sanitizeState(raw: unknown): GameState {
 const r = obj(raw, 'state'), m = obj(r.meta, 'meta'), pl = obj(r.player, 'player'), w = obj(r.world, 'world'), pr = obj(r.progress, 'progress');
 if (m.planetId !== 'verdana') throw new InvalidState('meta.planetId', 'неизвестная планета');
 if (m.generatorVersion !== GENERATOR_VERSION) throw new InvalidState('meta.generatorVersion', 'неподдерживаемая версия генератора');
 if (m.contentVersion !== CONTENT_VERSION) throw new InvalidState('meta.contentVersion', 'неподдерживаемая версия контента');
 const inv = arr(pl.inventory, 'player.inventory', INVENTORY_SIZE);
 if (inv.length !== INVENTORY_SIZE) throw new InvalidState('player.inventory', `нужно ${INVENTORY_SIZE} слотов`);
 const bottles = arr(pl.bottles, 'player.bottles', 2);
 if (bottles.length !== 2) throw new InvalidState('player.bottles', 'нужно 2 слота');
 const nodesRaw = obj(w.nodes, 'world.nodes'), nodes: Record<string, number> = {};
 for (const n of NODES) nodes[n.id] = int(nodesRaw[n.id], `world.nodes.${n.id}`, 0, n.amount);
 for (const k of Object.keys(nodesRaw)) if (!NODE_BY_ID.has(k)) throw new InvalidState('world.nodes', `неизвестный узел ${k}`);
 const dropIds = new Set<string>();
 const drops = arr(w.drops, 'world.drops', 4096).map((d, i) => { const o = obj(d, `world.drops[${i}]`), id = str(o.id, `world.drops[${i}].id`, 24, ID); if (dropIds.has(id)) throw new InvalidState('world.drops', 'повтор id'); dropIds.add(id);
  return { id, x: num(o.x, 'drop.x', -200, 360), z: num(o.z, 'drop.z', -200, 360), items: arr(o.items, 'drop.items', 64).map((s, j) => stack(s, `world.drops[${i}].items[${j}]`)) }; });
 const ids = (v: unknown, p: string) => arr(v, p, 64).map((x, i) => str(x, `${p}[${i}]`, 32, ID));
 return {
  meta: { worldId: str(m.worldId, 'meta.worldId', 48, ID), name: str(m.name, 'meta.name', 48), seed: int(m.seed, 'meta.seed', 0, 0xffffffff), planetId: 'verdana', generatorVersion: GENERATOR_VERSION, contentVersion: CONTENT_VERSION, createdAt: int(m.createdAt, 'meta.createdAt', 0, 8.64e15), activeTicks: int(m.activeTicks, 'meta.activeTicks', 0, Number.MAX_SAFE_INTEGER) },
  player: { x: num(pl.x, 'player.x', -200, 360), y: num(pl.y, 'player.y', -100, 200), z: num(pl.z, 'player.z', -200, 360), yaw: num(pl.yaw, 'player.yaw', -1e6, 1e6), pitch: num(pl.pitch, 'player.pitch', -2, 2), suit: str(pl.suit, 'player.suit', 16, ID),
   bottles: [slot(bottles[0], 'player.bottles[0]'), slot(bottles[1], 'player.bottles[1]')], inventory: inv.map((s, i) => slot(s, `player.inventory[${i}]`)) },
  world: { nodes, drops, nextDropId: int(w.nextDropId, 'world.nextDropId', 1, Number.MAX_SAFE_INTEGER) },
  progress: { visited: ids(pr.visited, 'progress.visited'), discovered: ids(pr.discovered, 'progress.discovered'), selected: str(pr.selected, 'progress.selected', 32, ID) },
 };
}
