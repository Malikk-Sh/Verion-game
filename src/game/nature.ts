import { NODES, nodeCovered, bodyHalf, PATCH_NODES, SHARED_PATCH_SPLIT, type ResourceNode } from './resources';
import type { GameState } from './state';
import { GRASS } from '../world';
import { cellKey, lowestAir, roomsView } from './rooms';
/** Rendered tufts of each grass deposit: centre and horizontal reach (leaves 0.48 m × instance scale, plus wind sway). */
const TUFTS = new Map<string, { x: number; z: number; r: number }[]>();
for (const t of GRASS) if (t.patch >= 0) {
 const ids = PATCH_NODES.get(t.patch) ?? [], id = t.patch === 0 ? ids.find(id => (t.x < SHARED_PATCH_SPLIT) === (id === 'grass-a')) : ids[0];
 if (id) TUFTS.set(id, [...(TUFTS.get(id) ?? []), { x: t.x, z: t.z, r: .48 * t.s * 1.35 + .07 }]);
}
/** Whether a square body footprint (centre x, z, half-size h) covers part of a deposit as drawn: a grass tuft's leaves,
 *  else the deposit's collider or radius. */
export function covers(n: ResourceNode, x: number, z: number, h: number): boolean {
 const tufts = TUFTS.get(n.id);
 if (!tufts) return nodeCovered(n, x, z, h);
 return tufts.some(t => Math.hypot(Math.max(0, Math.abs(x - t.x) - h), Math.max(0, Math.abs(z - t.z) - h)) < t.r);
}
/**
 * Regrowth of local grass in *active* time only (WORLD §2). A patch below its amount gains one
 * plant per `regrowSeconds`; a full patch keeps no accumulated time, so a long idle period never
 * produces a burst. A patch under a body does not grow (WORLD §2: only while not built over).
 * Returns the ids of deposits whose stock changed.
 */
/** A glass block resting on the ground over a tuft (its column's lowest air cell) covers it too; cached per glass layout. */
const UNDER_GLASS = new WeakMap<object, Map<string, boolean>>();
function underGlass(g: GameState, n: ResourceNode) {
 const v = roomsView(g.world.base); if (!v.glass.size) return false;
 let known = UNDER_GLASS.get(v); if (!known) UNDER_GLASS.set(v, known = new Map());
 let hit = known.get(n.id);
 if (hit === undefined) { hit = (TUFTS.get(n.id) ?? [{ x: n.x, z: n.z }]).some(t => { const i = Math.floor(t.x), j = Math.floor(t.z); return v.glass.has(cellKey(i, lowestAir(i, j), j)); }); known.set(n.id, hit); }
 return hit;
}
const builtOver = (g: GameState, n: ResourceNode) => g.world.base.buildings.some(b => covers(n, b.x, b.z, bodyHalf(b.kind))) || underGlass(g, n);
export function natureTick(g: GameState, ms: number): string[] {
 const changed: string[] = [];
 for (const n of NODES) {
  if (!n.regrowSeconds) continue;
  const period = n.regrowSeconds * 1000;
  let left = g.world.nodes[n.id] ?? 0;
  if (left >= n.amount) { if (g.world.regrow[n.id]) delete g.world.regrow[n.id]; continue; }
  if (builtOver(g, n)) continue;
  let acc = (g.world.regrow[n.id] ?? 0) + Math.max(0, ms);
  while (acc >= period && left < n.amount) { acc -= period; left++; }
  if (left >= n.amount) { delete g.world.regrow[n.id]; } else g.world.regrow[n.id] = Math.min(acc, period);
  if (left !== g.world.nodes[n.id]) { g.world.nodes[n.id] = left; changed.push(n.id); }
 }
 return changed;
}
/** Seconds until the next plant of a regrowing deposit, or null when full / not renewable. */
export function nextRegrowSeconds(g: GameState, id: string): number | null {
 const n = NODES.find(v => v.id === id);
 if (!n?.regrowSeconds || (g.world.nodes[id] ?? 0) >= n.amount || builtOver(g, n)) return null;
 return Math.max(0, n.regrowSeconds - (g.world.regrow[id] ?? 0) / 1000);
}
