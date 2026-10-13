import { NODES, nodeCovered, bodyHalf, type ResourceNode } from './resources';
import type { GameState } from './state';
/**
 * Regrowth of local grass in *active* time only (WORLD §2). A patch below its amount gains one
 * plant per `regrowSeconds`; a full patch keeps no accumulated time, so a long idle period never
 * produces a burst. A patch under a body does not grow (WORLD §2: only while not built over).
 * Returns the ids of deposits whose stock changed.
 */
const builtOver = (g: GameState, n: ResourceNode) => g.world.base.buildings.some(b => nodeCovered(n, b.x, b.z, bodyHalf(b.kind)));
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
