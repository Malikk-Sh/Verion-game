import { BASIC_SUIT, CONTENT_VERSION, GENERATOR_VERSION, ITEMS, LEGACY_CONTENT_VERSIONS, SUIT_PARTS, TANKS, TOOLS, type SuitPart } from './defs';
import { emptyInventory, INVENTORY_SIZE, type Slot } from './inventory';
import { NODES, NODE_BY_ID } from './resources';
import { CYCLE_TICKS, START_OFFSET_TICKS } from './daycycle';
/**
 * Complete persistent game state. Plain JSON only: no class instances, GPU objects or
 * functions (TECHNICAL §2). Revision numbers live in save manifests.
 *
 * State version 2 (content 1.1.0): four independent suit parts, hotbar selection (an index into
 * the first inventory row — not a separate container), display-only vitals and the day-phase
 * offset. Version 1 saves (content 1.0.0) are migrated by sanitizeState() without loss.
 */
export const STATE_VERSION = 2;
export const HOTBAR_SIZE = 6;
export type ItemStack = NonNullable<Slot>;
export type Drop = { id: string; x: number; z: number; items: ItemStack[] };
export type Suit = Record<SuitPart, Slot>;
export type GameState = {
 meta: { worldId: string; name: string; seed: number; planetId: 'verdana'; generatorVersion: number; contentVersion: string; stateVersion: number; createdAt: number; activeTicks: number };
 player: {
  x: number; y: number; z: number; yaw: number; pitch: number;
  /** Shown on the HUD; not simulated before the «Выживание» stage. */
  vitals: { health: number; satiety: number };
  suit: Suit; bottles: [Slot, Slot]; inventory: Slot[];
  /** Selected cell of the first inventory row (0…5). */
  hotbar: number;
 };
 world: { nodes: Record<string, number>; drops: Drop[]; nextDropId: number; dayOffsetTicks: number };
 progress: { visited: string[]; discovered: string[]; selected: string };
};
export const SPAWN_POSE = { x: 40, z: 42, yaw: .38, pitch: -.035 };
const basicSuit = (): Suit => ({ helmet: { itemId: BASIC_SUIT.helmet, count: 1 }, chest: { itemId: BASIC_SUIT.chest, count: 1 }, legs: { itemId: BASIC_SUIT.legs, count: 1 }, boots: { itemId: BASIC_SUIT.boots, count: 1 } });
export function newGame(worldId: string, seed: number, createdAt: number, y: number, name = 'Экспедиция'): GameState {
 const inventory = emptyInventory();
 inventory[0] = { itemId: 'tool_stone', count: 1, durability: TOOLS.tool_stone.durability };
 inventory[1] = { itemId: 'pulp', count: 4 };
 return {
  meta: { worldId, name, seed: seed >>> 0, planetId: 'verdana', generatorVersion: GENERATOR_VERSION, contentVersion: CONTENT_VERSION, stateVersion: STATE_VERSION, createdAt, activeTicks: 0 },
  player: { x: SPAWN_POSE.x, y, z: SPAWN_POSE.z, yaw: SPAWN_POSE.yaw, pitch: SPAWN_POSE.pitch, vitals: { health: 100, satiety: 100 }, suit: basicSuit(), bottles: [{ itemId: 'bottle_1', count: 1, milliGU: TANKS.bottle_1.capacity }, null], inventory, hotbar: 0 },
  world: { nodes: Object.fromEntries(NODES.map(n => [n.id, n.amount])), drops: [], nextDropId: 1, dayOffsetTicks: START_OFFSET_TICKS },
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
function str(v: unknown, p: string, max = 64, re = /^[\p{L}\p{N} _.·:\-]*$/u) { if (typeof v !== 'string' || v.length > max || !re.test(v)) throw new InvalidState(p, 'недопустимая строка'); return v; }
function arr(v: unknown, p: string, max: number) { if (!Array.isArray(v) || v.length > max) throw new InvalidState(p, `ожидался массив ≤${max}`); return v; }
const ID = /^[a-z0-9_\-]+$/;
/** One item entry. Stateful items (tools with durability, tanks with gas) always have count 1. */
function entry(v: unknown, p: string, maxCount?: number): ItemStack {
 const o = obj(v, p), itemId = str(o.itemId, p + '.itemId', 40, ID), def = ITEMS[itemId];
 if (!def) throw new InvalidState(p + '.itemId', `неизвестный предмет ${itemId}`);
 const s: ItemStack = { itemId, count: int(o.count, p + '.count', 1, def.stack === 1 ? 1 : maxCount ?? def.stack) };
 if (o.durability !== undefined) { if (!TOOLS[itemId]) throw new InvalidState(p, 'прочность у не-инструмента'); s.durability = int(o.durability, p + '.durability', 0, TOOLS[itemId].durability); }
 if (o.milliGU !== undefined) { if (!TANKS[itemId]) throw new InvalidState(p, 'газ у не-баллона'); s.milliGU = int(o.milliGU, p + '.milliGU', 0, TANKS[itemId].capacity); }
 if (TOOLS[itemId] && s.durability === undefined) throw new InvalidState(p, 'нет прочности инструмента');
 if (TANKS[itemId] && s.milliGU === undefined) throw new InvalidState(p, 'нет остатка газа');
 return s;
}
const slot = (v: unknown, p: string): Slot => v === null ? null : entry(v, p);
function suitSlot(v: unknown, part: SuitPart): Slot {
 const s = slot(v, `player.suit.${part}`);
 if (s && ITEMS[s.itemId].part !== part) throw new InvalidState(`player.suit.${part}`, 'предмет не подходит к этому слоту');
 return s;
}
function bottleSlot(v: unknown, p: string): Slot { const s = slot(v, p); if (s && !TANKS[s.itemId]) throw new InvalidState(p, 'в слоте баллона не баллон'); return s; }

/**
 * v1 → v2 (content 1.0.0 → 1.1.0). The old single `suit: 'suit'` becomes the four basic parts;
 * inventory, tool durability and tank gas are copied untouched; new fields get start values.
 * Works on a copy; the original object is never modified.
 */
export function migrateRaw(raw: unknown): unknown {
 if (!isObj(raw) || !isObj(raw.meta)) return raw;
 const version = raw.meta.contentVersion;
 if (version === CONTENT_VERSION) return raw;
 if (!(LEGACY_CONTENT_VERSIONS as readonly unknown[]).includes(version)) throw new InvalidState('meta.contentVersion', 'неподдерживаемая версия контента');
 const r = structuredClone(raw) as Obj, m = r.meta as Obj, pl = obj(r.player, 'player'), w = obj(r.world, 'world');
 if (pl.suit !== 'suit') throw new InvalidState('player.suit', 'неизвестный костюм старого формата');
 pl.suit = basicSuit();
 pl.vitals = { health: 100, satiety: 100 };
 pl.hotbar = 0;
 w.dayOffsetTicks = START_OFFSET_TICKS;
 m.contentVersion = CONTENT_VERSION; m.stateVersion = STATE_VERSION;
 return r;
}
/** Rebuilds a fresh GameState from untrusted JSON (migrating older versions); unknown keys are dropped, bad values throw. */
export function sanitizeState(input: unknown): GameState {
 const r = obj(migrateRaw(input), 'state'), m = obj(r.meta, 'meta'), pl = obj(r.player, 'player'), w = obj(r.world, 'world'), pr = obj(r.progress, 'progress');
 if (m.planetId !== 'verdana') throw new InvalidState('meta.planetId', 'неизвестная планета');
 if (m.generatorVersion !== GENERATOR_VERSION) throw new InvalidState('meta.generatorVersion', 'неподдерживаемая версия генератора');
 if (m.contentVersion !== CONTENT_VERSION) throw new InvalidState('meta.contentVersion', 'неподдерживаемая версия контента');
 if (m.stateVersion !== STATE_VERSION) throw new InvalidState('meta.stateVersion', 'неподдерживаемая версия состояния');
 const inv = arr(pl.inventory, 'player.inventory', INVENTORY_SIZE);
 if (inv.length !== INVENTORY_SIZE) throw new InvalidState('player.inventory', `нужно ${INVENTORY_SIZE} слотов`);
 const bottles = arr(pl.bottles, 'player.bottles', 2);
 if (bottles.length !== 2) throw new InvalidState('player.bottles', 'нужно 2 слота');
 const suitRaw = obj(pl.suit, 'player.suit'), vit = obj(pl.vitals, 'player.vitals');
 const nodesRaw = obj(w.nodes, 'world.nodes'), nodes: Record<string, number> = {};
 for (const n of NODES) nodes[n.id] = int(nodesRaw[n.id], `world.nodes.${n.id}`, 0, n.amount);
 for (const k of Object.keys(nodesRaw)) if (!NODE_BY_ID.has(k)) throw new InvalidState('world.nodes', `неизвестный узел ${k}`);
 const dropIds = new Set<string>();
 const drops = arr(w.drops, 'world.drops', 4096).map((d, i) => { const o = obj(d, `world.drops[${i}]`), id = str(o.id, `world.drops[${i}].id`, 24, ID); if (dropIds.has(id)) throw new InvalidState('world.drops', 'повтор id'); dropIds.add(id);
  return { id, x: num(o.x, 'drop.x', -200, 360), z: num(o.z, 'drop.z', -200, 360), items: arr(o.items, 'drop.items', 64).map((s, j) => entry(s, `world.drops[${i}].items[${j}]`, 1e6)) }; });
 const ids = (v: unknown, p: string) => arr(v, p, 64).map((x, i) => str(x, `${p}[${i}]`, 32, ID));
 return {
  meta: { worldId: str(m.worldId, 'meta.worldId', 48, ID), name: str(m.name, 'meta.name', 48), seed: int(m.seed, 'meta.seed', 0, 0xffffffff), planetId: 'verdana', generatorVersion: GENERATOR_VERSION, contentVersion: CONTENT_VERSION, stateVersion: STATE_VERSION, createdAt: int(m.createdAt, 'meta.createdAt', 0, 8.64e15), activeTicks: int(m.activeTicks, 'meta.activeTicks', 0, Number.MAX_SAFE_INTEGER) },
  player: { x: num(pl.x, 'player.x', -200, 360), y: num(pl.y, 'player.y', -100, 200), z: num(pl.z, 'player.z', -200, 360), yaw: num(pl.yaw, 'player.yaw', -1e6, 1e6), pitch: num(pl.pitch, 'player.pitch', -2, 2),
   vitals: { health: num(vit.health, 'player.vitals.health', 0, 100), satiety: num(vit.satiety, 'player.vitals.satiety', 0, 100) },
   suit: Object.fromEntries(SUIT_PARTS.map(p => [p, suitSlot(suitRaw[p], p)])) as Suit,
   bottles: [bottleSlot(bottles[0], 'player.bottles[0]'), bottleSlot(bottles[1], 'player.bottles[1]')], inventory: inv.map((s, i) => slot(s, `player.inventory[${i}]`)),
   hotbar: int(pl.hotbar, 'player.hotbar', 0, HOTBAR_SIZE - 1) },
  world: { nodes, drops, nextDropId: int(w.nextDropId, 'world.nextDropId', 1, Number.MAX_SAFE_INTEGER), dayOffsetTicks: int(w.dayOffsetTicks, 'world.dayOffsetTicks', 0, CYCLE_TICKS - 1) },
  progress: { visited: ids(pr.visited, 'progress.visited'), discovered: ids(pr.discovered, 'progress.discovered'), selected: str(pr.selected, 'progress.selected', 32, ID) },
 };
}
