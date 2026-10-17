import { LANDMARKS, MIN, MAX } from '../world';
import { depositById, depositLeft, bodyHalf, type ResourceNode } from './resources';
import { ITEMS } from './defs';
import { doorCenter, type Door } from './rooms';
import type { GameState } from './state';
/**
 * One navigation model (S4, D34). `progress.selected` names what the compass, the world marker and the
 * map lead to: 'guide' (the expedition journal), a landmark id, a deposit or new-vein id ('vein-N', D33), a station 'build-N', an
 * airlock of a glass room 'door-N' (D31), a cargo 'drop-N' or 'point' (the player's own map mark, `progress.waypoint`). A target
 * that stops existing — a station picked up, an airlock removed, a deposit exhausted, cargo collected, the mark removed — is invalid and the
 * caller falls back to the guide; reaching a target (distance < radius) also returns to the guide.
 */
export type NavKind = 'landmark' | 'node' | 'station' | 'drop' | 'point';
export type NavTarget = { id: string; kind: NavKind; name: string; x: number; z: number; radius: number };
export type Waypoint = { x: number; z: number };
export const stationName = (b: { kind: string; level: number }) => b.kind === 'workbench' ? 'Верстак ' + (b.level === 2 ? 'II' : 'I') : ITEMS[b.kind]?.name ?? b.kind;
/** Arrival radii: a deposit's working reach, a station's body plus a step; an airlock: its landing plus a step. */
export const nodeRadius = (n: ResourceNode) => Math.max(3, n.radius + 2);
export const stationRadius = (b: { kind: string }) => Math.max(3, bodyHalf(b.kind) + 2.5);
export const DOOR_RADIUS = 3;
/** An airlock module as a target: the centre of its footprint (D36: 2 m wide). */
export const doorTarget = (d: Door) => { const c = doorCenter(d); return { id: d.id, kind: 'station' as const, name: ITEMS.airlock.name, x: c.x, z: c.z, radius: DOOR_RADIUS }; };
/** Map mark («Метка») kept inside the walkable square. */
export const clampWaypoint = (x: number, z: number): Waypoint => ({ x: Math.max(MIN, Math.min(MAX, Math.round(x * 10) / 10)), z: Math.max(MIN, Math.min(MAX, Math.round(z * 10) / 10)) });
/** The selected target, null for the guide, or 'invalid' when the selection no longer exists. */
export function resolveNav(g: GameState, id: string, waypoint: Waypoint | null | undefined): NavTarget | null | 'invalid' {
 if (id === 'guide') return null;
 if (id === 'point') return waypoint ? { id, kind: 'point', name: 'Метка', x: waypoint.x, z: waypoint.z, radius: 3 } : 'invalid';
 const l = LANDMARKS.find(p => p.id === id);
 if (l) return { id, kind: 'landmark', name: l.name, x: l.x, z: l.z, radius: l.radius };
 const n = depositById(g, id);
 if (n) return depositLeft(g, id) > 0 ? { id, kind: 'node', name: n.name, x: n.x, z: n.z, radius: nodeRadius(n) } : 'invalid';
 const b = g.world.base.buildings.find(v => v.id === id);
 if (b) return { id, kind: 'station', name: stationName(b), x: b.x, z: b.z, radius: stationRadius(b) };
 const door = g.world.base.doors.find(v => v.id === id);
 if (door) return doorTarget(door);
 const d = g.world.drops.find(v => v.id === id);
 if (d) return { id, kind: 'drop', name: 'Груз', x: d.x, z: d.z, radius: 2.2 };
 return 'invalid';
}
/** Whether a target has just been reached: the auto-clear rule of the model. */
export const arrived = (t: { x: number; z: number; radius: number }, x: number, z: number) => Math.hypot(t.x - x, t.z - z) < t.radius;
