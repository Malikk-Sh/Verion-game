// Static rules for the fixed new-vein spots (S4, D33). Shared by tools/gen_vein_spots.ts, which wrote
// src/game/veinSpots.ts once, and by tests/veins.test.ts, which checks every committed spot.
import { heightAt, makeColliders, boxes, CRATER } from '../src/world';
import { NODES, GRASS_PATCHES, VEIN_LOOK, type VeinMaterial } from '../src/game/resources';
export const SLOPE = .5, CRATER_ICE_SLOPE = .7, LOW = -150, HIGH = 310, NODE_GAP = 8, SPOT_GAP = 10, COLLIDER_PAD = 1, GRASS_PAD = 2;
/** Largest vein body (×1.25 stock → ∛1.25 ≈ 1.08 scale). */
export const halfOf = (m: VeinMaterial) => Math.max(VEIN_LOOK[m].box[0], VEIN_LOOK[m].box[2]) / 2 * 1.08;
/** Kept-free areas: capsule and its door, the base plot, the future basin, the cave passage. */
export const RESERVED = [
 { name: 'капсула', minX: 33, maxX: 47, minZ: 33, maxZ: 49 },
 { name: 'площадка базы', minX: 44, maxX: 72, minZ: 30, maxZ: 58 },
 { name: 'водоём', minX: 88, maxX: 112, minZ: 122, maxZ: 142 },
 { name: 'проход пещеры', minX: 106, maxX: 142, minZ: 58, maxZ: 86 },
];
let ready = false;
const statics = () => { if (!ready) { makeColliders(); ready = true; } return boxes; };
export const inCrater = (x: number, z: number) => Math.hypot(x - CRATER.x, z - CRATER.z) < CRATER.r;
/** Why a spot is not allowed for `m` ('' when it is). */
export function spotProblem(x: number, z: number, m: VeinMaterial): string {
 const r = halfOf(m);
 if (x - r < LOW || x + r > HIGH || z - r < LOW || z + r > HIGH) return 'за границей';
 const d = r + .5, hs: number[] = []; for (const dx of [-d, 0, d]) for (const dz of [-d, 0, d]) hs.push(heightAt(x + dx, z + dz));
 if (Math.max(...hs) - Math.min(...hs) > (m === 'ice' && inCrater(x, z) ? CRATER_ICE_SLOPE : SLOPE)) return 'склон';
 for (const q of RESERVED) if (x + r > q.minX && x - r < q.maxX && z + r > q.minZ && z - r < q.maxZ) return 'зарезервировано: ' + q.name;
 for (const b of statics()) if (x + r + COLLIDER_PAD > b.minX && x - r - COLLIDER_PAD < b.maxX && z + r + COLLIDER_PAD > b.minZ && z - r - COLLIDER_PAD < b.maxZ) return 'столкновение ' + b.id;
 for (const p of GRASS_PATCHES) if (((x - p.x) / (p.rx + GRASS_PAD + r)) ** 2 + ((z - p.z) / (p.rz + GRASS_PAD + r)) ** 2 < 1) return 'трава';
 for (const n of NODES) if (Math.hypot(x - n.x, z - n.z) < NODE_GAP) return 'рядом залежь ' + n.id;
 return '';
}
