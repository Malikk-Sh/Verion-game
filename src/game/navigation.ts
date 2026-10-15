import { LANDMARKS, MIN, MAX } from '../world';
import { NODE_BY_ID, bodyHalf, type ResourceNode } from './resources';
import { ITEMS } from './defs';
import type { GameState } from './state';
/**
 * One navigation model (S4, D34). `progress.selected` names what the compass, the world marker and the
 * map lead to: 'guide' (the expedition journal), a landmark id, a deposit id, a station 'build-N', a cargo
 * 'drop-N' or 'point' (the player's own map mark, `progress.waypoint`). A target that stops existing —
 * a station picked up, a deposit exhausted, cargo collected, the mark removed — is invalid and the
 * caller falls back to the guide; reaching a target (distance < radius) also returns to the guide.
 */
export type NavKind = 'landmark' | 'node' | 'station' | 'drop' | 'point';
export type NavTarget = { id: string; kind: NavKind; name: string; x: number; z: number; radius: number };
export type Waypoint = { x: number; z: number };
export const stationName = (b: { kind: string; level: number }) => b.kind === 'workbench' ? 'Верстак ' + (b.level === 2 ? 'II' : 'I') : ITEMS[b.kind]?.name ?? b.kind;
/** Arrival radii: a deposit's working reach, a station's body plus a step (a dome or room is larger). */
export const nodeRadius = (n: ResourceNode) => Math.max(3, n.radius + 2);
export const stationRadius = (b: { kind: string }) => Math.max(3, bodyHalf(b.kind) + 2.5);
/** Map mark («Метка») kept inside the walkable square. */
export const clampWaypoint = (x: number, z: number): Waypoint => ({ x: Math.max(MIN, Math.min(MAX, Math.round(x * 10) / 10)), z: Math.max(MIN, Math.min(MAX, Math.round(z * 10) / 10)) });
/** The selected target, null for the guide, or 'invalid' when the selection no longer exists. */
export function resolveNav(g: GameState, id: string, waypoint: Waypoint | null | undefined): NavTarget | null | 'invalid' {
 if (id === 'guide') return null;
 if (id === 'point') return waypoint ? { id, kind: 'point', name: 'Метка', x: waypoint.x, z: waypoint.z, radius: 3 } : 'invalid';
 const l = LANDMARKS.find(p => p.id === id);
 if (l) return { id, kind: 'landmark', name: l.name, x: l.x, z: l.z, radius: l.radius };
 const n = NODE_BY_ID.get(id);
 if (n) return (g.world.nodes[id] ?? 0) > 0 ? { id, kind: 'node', name: n.name, x: n.x, z: n.z, radius: nodeRadius(n) } : 'invalid';
 const b = g.world.base.buildings.find(v => v.id === id);
 if (b) return { id, kind: 'station', name: stationName(b), x: b.x, z: b.z, radius: stationRadius(b) };
 const d = g.world.drops.find(v => v.id === id);
 if (d) return { id, kind: 'drop', name: 'Груз', x: d.x, z: d.z, radius: 2.2 };
 return 'invalid';
}
/** Whether a target has just been reached: the auto-clear rule of the model. */
export const arrived = (t: { x: number; z: number; radius: number }, x: number, z: number) => Math.hypot(t.x - x, t.z - z) < t.radius;
