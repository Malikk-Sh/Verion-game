import type { Material } from './defs';
/**
 * Finite surface deposits of the arrival valley (WORLD §2: within 120 m of the capsule there
 * are 48 iron ore, 32 copper ore, 48 stone, 24 ice). Each node holds a fixed number of blocks;
 * one finished block gives one item. Nodes never regrow (GDD §3: ores are finite).
 * Sand and grass complete the early S2 resource path; all deposits are finite.
 */
export type ResourceNode = { id: string; name: string; material: Material; itemId: string; x: number; z: number; amount: number; radius: number; height: number; outcrop: string };
export const NODES: ResourceNode[] = [
 { id: 'iron-a', name: 'Железный выход', material: 'iron', itemId: 'iron_raw', x: 67, z: 65, amount: 32, radius: 1.7, height: 1.5, outcrop: 'iron' },
 { id: 'iron-b', name: 'Малый железный выход', material: 'iron', itemId: 'iron_raw', x: 69.1, z: 63.8, amount: 16, radius: .85, height: .7, outcrop: 'iron' },
 { id: 'copper-a', name: 'Медный выход', material: 'copper', itemId: 'copper_raw', x: 83, z: 55, amount: 22, radius: 1.7, height: 1.4, outcrop: 'copper' },
 { id: 'copper-b', name: 'Малый медный выход', material: 'copper', itemId: 'copper_raw', x: 81.1, z: 56.1, amount: 10, radius: .9, height: .6, outcrop: 'copper' },
 { id: 'stone-a', name: 'Каменная осыпь', material: 'stone', itemId: 'stone', x: 30, z: 52, amount: 48, radius: 1.5, height: 1.1, outcrop: 'stone' },
 { id: 'ice-a', name: 'Ледяная глыба', material: 'ice', itemId: 'ice', x: 33, z: 76.5, amount: 24, radius: 1.2, height: 1.2, outcrop: 'ice' },
 { id: 'sand-a', name: 'Песчаная осыпь', material: 'sand', itemId: 'sand', x: 49, z: 59, amount: 32, radius: 1.4, height: .6, outcrop: 'sand' },
 { id: 'grass-a', name: 'Местная трава', material: 'grass', itemId: 'grass', x: 42, z: 56, amount: 50, radius: 1.7, height: .8, outcrop: 'grass' },
 { id: 'grass-b', name: 'Местная трава', material: 'grass', itemId: 'grass', x: 46, z: 58, amount: 50, radius: 1.7, height: .8, outcrop: 'grass' },
];
export const NODE_BY_ID = new Map(NODES.map(n => [n.id, n]));
