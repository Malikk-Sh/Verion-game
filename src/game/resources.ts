import type { Material } from './defs';
/**
 * Natural deposits of Verdana. The arrival valley keeps its guaranteed start set (WORLD §2:
 * within 120 m of the capsule 48 iron ore, 32 copper ore, 48 stone, 32 sand, 24 ice, 100 grass)
 * and S3 adds secondary deposits in the valley plus richer far deposits that reward exploration.
 * Ores, stone, sand and ice are finite and never regrow (GDD §3). Local grass regrows one plant
 * per `regrowSeconds` of *active* time while the patch is below its amount (WORLD §2: a plant
 * regrows in 1800 s) — the renewable fuel/food source of the early game.
 * `box` is the collision footprint of a deposit body (w, h, d); it shrinks with the stock.
 */
export type ResourceNode = { id: string; name: string; material: Material; itemId: string; x: number; z: number; amount: number; radius: number; height: number; outcrop: string; regrowSeconds?: number; box?: [number, number, number]; far?: boolean; patch?: number };
/** One plant in a 40-plant patch regrows in 1800 s → one unit per 45 s per patch. */
export const GRASS_REGROW_S = 45;
export const NODES: ResourceNode[] = [
 { id: 'iron-a', name: 'Железный выход', material: 'iron', itemId: 'iron_raw', x: 67, z: 65, amount: 32, radius: 1.7, height: 1.5, outcrop: 'iron' },
 { id: 'iron-b', name: 'Малый железный выход', material: 'iron', itemId: 'iron_raw', x: 69.1, z: 63.8, amount: 16, radius: .85, height: .7, outcrop: 'iron' },
 { id: 'copper-a', name: 'Медный выход', material: 'copper', itemId: 'copper_raw', x: 83, z: 55, amount: 22, radius: 1.7, height: 1.4, outcrop: 'copper' },
 { id: 'copper-b', name: 'Малый медный выход', material: 'copper', itemId: 'copper_raw', x: 81.1, z: 56.1, amount: 10, radius: .9, height: .6, outcrop: 'copper' },
 { id: 'stone-a', name: 'Каменная осыпь', material: 'stone', itemId: 'stone', x: 30, z: 52, amount: 48, radius: 1.5, height: 1.1, outcrop: 'stone' },
 { id: 'ice-a', name: 'Ледяная глыба', material: 'ice', itemId: 'ice', x: 33, z: 76.5, amount: 24, radius: 1.2, height: 1.2, outcrop: 'ice' },
 { id: 'sand-a', name: 'Песчаная осыпь', material: 'sand', itemId: 'sand', x: 49, z: 59, amount: 32, radius: 1.4, height: .6, outcrop: 'sand' },
 { id: 'grass-a', name: 'Местная трава', material: 'grass', itemId: 'grass', x: 42, z: 56, amount: 50, radius: 1.7, height: .8, outcrop: 'grass', regrowSeconds: 36, patch: 0 },
 { id: 'grass-b', name: 'Местная трава', material: 'grass', itemId: 'grass', x: 46, z: 58, amount: 50, radius: 1.7, height: .8, outcrop: 'grass', regrowSeconds: 36, patch: 0 },
 // S3 valley additions: a second deposit of every early material within a short walk.
 { id: 'stone-b', name: 'Каменная россыпь', material: 'stone', itemId: 'stone', x: 24, z: 25, amount: 60, radius: 1.6, height: 1.1, outcrop: 'stone', box: [2.4, .9, 2.4] },
 { id: 'sand-b', name: 'Песчаный нанос', material: 'sand', itemId: 'sand', x: 58, z: 100, amount: 48, radius: 1.6, height: .6, outcrop: 'sand' },
 { id: 'iron-c', name: 'Железная жила у пещеры', material: 'iron', itemId: 'iron_raw', x: 98, z: 63, amount: 32, radius: 1.5, height: 1.3, outcrop: 'iron', box: [3, 1.4, 2.6] },
 { id: 'copper-c', name: 'Медная жила у скал', material: 'copper', itemId: 'copper_raw', x: 92, z: 92, amount: 24, radius: 1.4, height: 1.2, outcrop: 'copper', box: [2.8, 1.3, 2.4] },
 { id: 'ice-b', name: 'Ледяная плита', material: 'ice', itemId: 'ice', x: 26, z: 82, amount: 40, radius: 1.3, height: 1, outcrop: 'ice', box: [2, .9, 2] },
 { id: 'ice-c', name: 'Ледяная плита', material: 'ice', itemId: 'ice', x: 35, z: 82, amount: 40, radius: 1.3, height: 1, outcrop: 'ice', box: [2, .9, 2] },
 { id: 'grass-c', name: 'Местная трава', material: 'grass', itemId: 'grass', x: 16, z: 66, amount: 40, radius: 3, height: .8, outcrop: 'grass', regrowSeconds: GRASS_REGROW_S, patch: 1 },
 { id: 'grass-d', name: 'Местная трава', material: 'grass', itemId: 'grass', x: 70, z: 90, amount: 40, radius: 3.4, height: .8, outcrop: 'grass', regrowSeconds: GRASS_REGROW_S, patch: 2 },
 { id: 'grass-e', name: 'Местная трава', material: 'grass', itemId: 'grass', x: 99, z: 128, amount: 40, radius: 3, height: .8, outcrop: 'grass', regrowSeconds: GRASS_REGROW_S, patch: 3 },
 { id: 'grass-f', name: 'Местная трава', material: 'grass', itemId: 'grass', x: 136, z: 104, amount: 40, radius: 3, height: .8, outcrop: 'grass', regrowSeconds: GRASS_REGROW_S, patch: 4 },
 { id: 'grass-g', name: 'Местная трава', material: 'grass', itemId: 'grass', x: 59, z: 114, amount: 40, radius: 3, height: .8, outcrop: 'grass', regrowSeconds: GRASS_REGROW_S, patch: 5 },
 // Far deposits: rich, finite, worth an expedition with a spare tank.
 { id: 'sand-canyon', name: 'Песчаное русло', material: 'sand', itemId: 'sand', x: 90, z: -100, amount: 120, radius: 2, height: .7, outcrop: 'sand', far: true },
 { id: 'iron-canyon', name: 'Богатая железная жила', material: 'iron', itemId: 'iron_raw', x: 75, z: -96, amount: 64, radius: 1.8, height: 1.7, outcrop: 'iron', box: [3.6, 1.8, 3], far: true },
 { id: 'copper-mesa', name: 'Медная жила плато', material: 'copper', itemId: 'copper_raw', x: -70, z: 140, amount: 56, radius: 1.8, height: 1.6, outcrop: 'copper', box: [3.6, 1.7, 3], far: true },
 { id: 'ice-crater', name: 'Ледяное дно кратера', material: 'ice', itemId: 'ice', x: 266, z: 262, amount: 160, radius: 2, height: 1.4, outcrop: 'ice', box: [3.4, 1.4, 3.4], far: true },
];
export const NODE_BY_ID = new Map(NODES.map(n => [n.id, n]));
/** Rendered grass patches (ellipses of tufts, `world.ts`). Patch 0 is shared: tufts with x < 44 belong to grass-a. */
export const GRASS_PATCHES = [
 {x:44,z:57,rx:4.5,rz:3.4}, {x:16,z:66,rx:4.5,rz:2.6},
 {x:70,z:90,rx:6,rz:3.8}, {x:99,z:128,rx:5,rz:3},
 {x:136,z:104,rx:4,rz:5}, {x:59,z:114,rx:4.3,rz:3.5},
];
export const SHARED_PATCH_SPLIT = 44;
/** Whether a square footprint (centre x, z, half-size h) covers part of a deposit: its collider box, else its radius.
 *  Grass is drawn as tufts: `covers` in nature.ts checks those. */
export function nodeCovered(n: ResourceNode, x: number, z: number, h: number): boolean {
 if (n.box) return Math.abs(x - n.x) < h + n.box[0] / 2 && Math.abs(z - n.z) < h + n.box[2] / 2;
 return Math.hypot(Math.max(0, Math.abs(x - n.x) - h), Math.max(0, Math.abs(z - n.z) - h)) < n.radius;
}
/** Half-size of a placed body's footprint (as in placement). */
export const bodyHalf = (kind: string) => kind === 'dome' ? 2.5 : .48;
/** Grass patch index of the vegetation instances → its harvestable nodes. */
export const PATCH_NODES = new Map<number, string[]>();
for (const n of NODES) if (n.patch !== undefined) PATCH_NODES.set(n.patch, [...(PATCH_NODES.get(n.patch) ?? []), n.id]);
/** Deposits introduced after the save format was created; older worlds receive them full. */
export const LATER_NODES = new Set(['sand-a', 'grass-a', 'grass-b']);
/** Deposits that S3 (state v7) adds; a v6 world receives exactly these full, never a missing older one. */
export const BASE_NODES = new Set(['iron-a', 'iron-b', 'copper-a', 'copper-b', 'stone-a', 'ice-a', 'sand-a', 'grass-a', 'grass-b']);
export const S3_NODES = new Set(NODES.filter(n => !BASE_NODES.has(n.id)).map(n => n.id));
