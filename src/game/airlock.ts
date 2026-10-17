import type { Box } from '../world';
import { breathingRoom, cellY, depthOf, doorAlong, doorById, doorCenter, doorFront, doorRooms, habitableRoom, widthOf, type Door, type DoorFace, type RoomInfo } from './rooms';
import type { GameState } from './state';
/**
 * S5 (D36) walk-through airlock: two sliding doors and a small chamber between them (the module's own cells, never room
 * air). The player opens and closes each door himself and walks through. Interlock: a door opens only while the other one
 * is closed, so a room behind the module always stays sealed. The chamber's pressure follows the doors: opening a door
 * towards a room fills a chamber below 4 GU from that room first (3 s, min(4 GU − pressure, room air), taken at the
 * request), opening a door towards the open outside vents a charged chamber first (3 s, the gas is lost). Entering and
 * leaving therefore cost the room 4 GU each, an empty room can always be left and nobody is trapped: from inside the
 * chamber either door can be asked for (asking for one while the other is still cycling cancels that cycle). A charged
 * chamber is breathable and its charge carries the breath (no drain, like the S4 cycle). Pure game logic: no DOM, no three.js.
 */
export const CHAMBER_Q = 4000, EQUALIZE_MS = 3000, SLIDE_MS = 800;
/** Module frame in its own metres, shared by the colliders, the aim and the model (stationModels.ts): side jambs, the
 *  threshold top, the lintel bottom (body height 1.8 m + clearance), the leaf planes 5 cm inside each face, leaf thickness.
 *  A legacy one-wide module has slim jambs so its 0.8 m doorway still lets the 0.6 m body through. */
export const JAMB = .18, SILL = .04, LINTEL = 1.9, LEAF_AT = .05, LEAF_T = .05;
export const jambOf = (width: number) => width === 2 ? JAMB : .1;
/** Doors are worked from up to this distance (eye to the module centre, metres; the aim reaches 4.5 m). */
export const DOOR_REACH = 5;
export const otherFace = (f: DoorFace): DoorFace => f === 'outer' ? 'inner' : 'outer';
/** The room behind one door (null: the open outside). The front side is the outer door's. */
export const faceRoom = (g: GameState, d: Door, face: DoorFace) => doorRooms(g, d)[face === 'outer' ? 'front' : 'back'];
/** The door that is cycling, if any. */
export const cyclingFace = (d: Door): DoorFace | null => d.outer === 'cycling' ? 'outer' : d.inner === 'cycling' ? 'inner' : null;
/**
 * World box of a part of a module given in its own frame: `u` along the width (0…w), `v` in metres through the module
 * from the inner face (0) to the outer face (its depth, 1 or 2), `y` above the threshold level (cellY of the anchor).
 */
export function partBox(d: Door, u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, id = 'build-' + d.id): Box {
 const a = doorAlong(d.rot), f = doorFront(d.rot), base = cellY(d.y), flip = f.x + f.z < 0, lo = flip ? 1 - v1 : v0, hi = flip ? 1 - v0 : v1;
 return a.x ? { id, minX: d.x + u0, maxX: d.x + u1, minY: base + y0, maxY: base + y1, minZ: d.z + lo, maxZ: d.z + hi } : { id, minX: d.x + lo, maxX: d.x + hi, minY: base + y0, maxY: base + y1, minZ: d.z + u0, maxZ: d.z + u1 };
}
/** Colliders of a module: two side jambs, the lintel and the threshold (down 0.6 m into whatever it stands on), and the
 *  leaf of each door (it blocks unless that door is open). */
export function doorBoxes(d: Door) {
 const w = widthOf(d), J = jambOf(w), D = depthOf(d);
 return { frame: [partBox(d, 0, J, 0, D, -.6, 2), partBox(d, w - J, w, 0, D, -.6, 2), partBox(d, 0, w, 0, D, LINTEL, 2), partBox(d, 0, w, 0, D, -.6, SILL)], outer: leafBox(d, 'outer'), inner: leafBox(d, 'inner') };
}
export const leafBox = (d: Door, face: DoorFace) => { const w = widthOf(d), J = jambOf(w), v = face === 'outer' ? depthOf(d) - LEAF_AT : LEAF_AT; return partBox(d, J, w - J, v - LEAF_T / 2, v + LEAF_T / 2, 0, LINTEL); };
const hits = (b: Box, x: number, y: number, z: number) => b.minX < x + .3 && b.maxX > x - .3 && b.minZ < z + .3 && b.maxZ > z - .3 && b.minY < y + 1.8 && b.maxY > y;
/** The standing body (feet at y, the controller's 0.6 m square) is in the plane of a door's leaf. */
export const leafBlocked = (d: Door, face: DoorFace, x: number, y: number, z: number) => hits(leafBox(d, face), x, y, z);
/** The module whose chamber contains the point (the player: the chest, y + 1). */
export function chamberAt(g: GameState, x: number, y: number, z: number) {
 for (const d of g.world.base.doors) { const b = partBox(d, 0, widthOf(d), 0, depthOf(d), 0, 2); if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && y >= b.minY && y <= b.maxY) return d; }
 return null;
}
/** The chamber the player breathes in: charged with the full 4 GU (its charge carries the breath, nothing is drawn). */
export function breathingChamber(g: GameState) { const d = chamberAt(g, g.player.x, g.player.y + 1, g.player.z); return d && d.pressure >= CHAMBER_Q ? d : null; }
/** A habitable room the player's chamber is open to (its door stands open): the player breathes that room. */
export function chamberRoom(g: GameState): RoomInfo | null {
 const d = chamberAt(g, g.player.x, g.player.y + 1, g.player.z); if (!d) return null;
 for (const f of ['outer', 'inner'] as const) if (d[f] === 'open') { const r = faceRoom(g, d, f); if (r && habitableRoom(r)) return r; }
 return null;
}
/** The player breathes without tanks here: a habitable room, a chamber open to one, or a charged chamber (survival, HUD). */
export const shelteredAir = (g: GameState) => !!(breathingRoom(g) ?? chamberRoom(g) ?? breathingChamber(g));
/** The player stands beyond this door, outside the module (the other door is then out of reach, past the chamber). */
export function beyondFace(g: GameState, d: Door, face: DoorFace) { const c = doorCenter(d), f = doorFront(d.rot), h = depthOf(d) / 2, side = (g.player.x - c.x) * f.x + (g.player.z - c.z) * f.z; return face === 'outer' ? side > h : side < -h; }
/**
 * The player asks a door to open (when closed) or to close (when open). Returns '' or why not. Opening: refused while
 * the other door stands open (interlock); a cycle of the other door is cancelled instead (from inside the chamber either
 * door can always be asked for). Then the chamber equalises with the side behind this door if needed, and the door slides.
 * Closing: refused while the body is in the leaf's plane. Asked from outside the module, a far door left open closes first.
 */
export function useDoor(g: GameState, id: string, face: DoorFace): string {
 const d = doorById(g, id); if (!d) return 'Нет такого шлюза';
 if (g.player.vitals.health <= 0) return 'Персонаж погиб';
 const p = g.player, other = otherFace(face), c = doorCenter(d);
 if (Math.hypot(p.x - c.x, p.z - c.z) > DOOR_REACH) return 'Подойдите к шлюзу';
 if (d[face] === 'open') { if (leafBlocked(d, face, p.x, p.y, p.z)) return 'Дверь заблокирована'; d[face] = 'closed'; return ''; }
 if (d[face] === 'cycling') return 'Шлюз выравнивает давление — подождите';
 // The other door, if it is in reach (from the chamber or its own side), must be closed by hand. Asked from beyond this
 // door, the other one stands past the chamber (e.g. left open on the way in): it closes itself first, so a room behind
 // the module is never locked out and the interlock still holds.
 if (d[other] === 'open') { if (!beyondFace(g, d, face) || leafBlocked(d, other, p.x, p.y, p.z)) return 'Сначала закройте другую дверь'; d[other] = 'closed'; }
 if (d[other] === 'cycling') { if (d.cycleMs <= SLIDE_MS && leafBlocked(d, other, p.x, p.y, p.z)) return 'Дверь заблокирована'; d[other] = 'closed'; d.cycleMs = 0; }
 const room = faceRoom(g, d, face); let ms = SLIDE_MS;
 if (room && d.pressure < CHAMBER_Q) { const take = Math.min(CHAMBER_Q - d.pressure, room.zone.q); if (take > 0) { room.zone.q -= take; d.pressure += take; ms += EQUALIZE_MS; } }
 else if (!room && d.pressure > 0) ms += EQUALIZE_MS;
 d[face] = 'cycling'; d.cycleMs = ms;
 return '';
}
/** Advances every running cycle by `ms` of active time. Venting ends when the slide begins; the door is open when the
 *  slide ends. Returns true when a door finished opening (worth a save). */
export function airlockTick(g: GameState, ms: number) {
 let changed = false;
 for (const d of g.world.base.doors) {
  const face = cyclingFace(d); if (!face) continue;
  d.cycleMs = Math.max(0, d.cycleMs - ms);
  if (d.cycleMs <= SLIDE_MS && d.pressure > 0 && !faceRoom(g, d, face)) d.pressure = 0;
  if (!d.cycleMs) { d[face] = 'open'; changed = true; }
 }
 return changed;
}
/** Lamp of one door: green — it can be used, amber — it is cycling, red — locked because the other door is not closed. */
export function doorLamp(d: Door, face: DoorFace): 'ready' | 'cycling' | 'locked' { return d[face] === 'cycling' ? 'cycling' : d[otherFace(face)] !== 'closed' ? 'locked' : 'ready'; }
/** The running cycle for screens: equalising (filling from a room or venting outside) or sliding, and seconds left. */
export function doorPhase(g: GameState, d: Door) {
 const face = cyclingFace(d); if (!face) return null;
 const equalizing = d.cycleMs > SLIDE_MS, fill = !!faceRoom(g, d, face);
 return { face, kind: equalizing ? fill ? 'fill' as const : 'vent' as const : 'slide' as const, seconds: Math.ceil(d.cycleMs / 1000), progress: equalizing ? 1 - (d.cycleMs - SLIDE_MS) / EQUALIZE_MS : 1 - d.cycleMs / SLIDE_MS };
}
/** Chamber pressure as the screens show it (milli-GU): ramps up while filling and down while venting. */
export function shownPressure(g: GameState, d: Door) { const p = doorPhase(g, d); return p?.kind === 'fill' ? d.pressure * p.progress : p?.kind === 'vent' ? d.pressure * (1 - p.progress) : d.pressure; }
/** Open fraction of a door's leaves from the simulation alone (0 closed, 1 open): the slide is the last 0.8 s of a cycle. */
export const simOpen = (d: Door, face: DoorFace) => d[face] === 'open' ? 1 : d[face] === 'cycling' && d.cycleMs <= SLIDE_MS ? 1 - d.cycleMs / SLIDE_MS : 0;
/** The door a ray (origin `o`, direction `dir`) meets first within `max` m: the leaf planes over the whole face. */
export function faceHit(d: Door, o: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, max: number): { face: DoorFace; distance: number } | null {
 const w = widthOf(d); let best: { face: DoorFace; distance: number } | null = null;
 for (const face of ['outer', 'inner'] as const) {
  const b = leafBox(d, face), xPlane = b.maxX - b.minX < b.maxZ - b.minZ, p = xPlane ? (b.minX + b.maxX) / 2 : (b.minZ + b.maxZ) / 2, od = xPlane ? o.x : o.z, dd = xPlane ? dir.x : dir.z;
  if (Math.abs(dd) < 1e-6) continue; const t = (p - od) / dd; if (t <= 0 || t > max || (best && t >= best.distance)) continue;
  const all = partBox(d, 0, w, 0, depthOf(d), 0, 2), x = o.x + dir.x * t, y = o.y + dir.y * t, z = o.z + dir.z * t;
  if ((xPlane ? z >= all.minZ && z <= all.maxZ : x >= all.minX && x <= all.maxX) && y >= all.minY && y <= all.maxY) best = { face, distance: t };
 }
 return best;
}
/** Aim label of a door: its name, the action, the state in words and whether the interlock holds it (key hints live in
 *  the settings help, D38). */
export function doorStatus(g: GameState, d: Door, face: DoorFace) {
 const name = face === 'outer' ? 'Внешняя дверь шлюза' : 'Внутренняя дверь шлюза', ph = doorPhase(g, d), gu = Math.round(shownPressure(g, d) / 100) / 10, lamp = doorLamp(d, face);
 const meta = d[face] === 'open' ? 'Открыта' : d[face] === 'cycling' ? ph!.kind === 'fill' ? `Наполнение камеры из помещения · ${ph!.seconds} с` : ph!.kind === 'vent' ? `Сброс давления наружу · ${ph!.seconds} с` : 'Открывается'
  : lamp === 'locked' ? d[otherFace(face)] === 'open' && beyondFace(g, d, face) ? `Закрыта · ${face === 'outer' ? 'внутренняя' : 'наружная'} дверь закроется сама` : 'Закрыта: открыта другая дверь' : `Закрыта · в камере ${String(gu).replace('.', ',')} GU`;
 return { name, meta, action: d[face] === 'open' ? 'Закрыть' : 'Открыть', lamp };
}
