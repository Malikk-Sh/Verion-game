import { heightAt, boxes, EYE } from '../world';
import { ITEMS } from './defs';
import { isDay, phaseSeconds } from './daycycle';
import { addItems, countItem, removeItems } from './inventory';
import { dropItems } from './mining';
import type { BaseState, Building } from './production';
import type { GameState } from './state';
/**
 * S4 glass rooms (D31). One orthogonal 1 m grid: cell (i, k, j) spans x∈[i, i+1], y∈[k, k+1], z∈[j, j+1]. Glass
 * blocks, the two cells of each airlock door and ground cells are solid; air cells joined by faces (6 neighbours, never
 * edges or corners) and closed on every side form a room. A new room is born empty; air leaves at once when a room opens
 * (D32). No DOM and no three.js: the simulation, quests, station windows and tests share this module.
 * Derived data (rooms, cell → room) is rebuilt only on an edit or a load and cached per `world.base`.
 */
export type Door = { id: string; x: number; y: number; z: number; rot: number };
/** Air of one room; `cell` is the room's smallest cell key and is its identity. q in milli-GU. */
export type Zone = { cell: number; q: number; temperature: number; purity: number; lossRemainder: number };
/** `direction` 'in' moves to the door's back side, 'out' to its front (rot 0 = +z, like the old dome); `paid`: the
 *  destination room charged the chamber with 4 GU, which carries the breath for the cycle (survival lock). */
export type Passage = { doorId: string; direction: 'in' | 'out'; remainingMs: number; paid: boolean };
export type Room = { index: number; cell: number; cells: number[]; volume: number };
export type RoomInfo = Room & { zone: Zone };
export type Side = 'front' | 'back';
export type RoomEdit = { error: string; needConfirm: boolean; ventGU: number; breached: boolean; at: { x: number; y: number; z: number } | null };
export const GLASS_LIMIT = 8192, DOOR_LIMIT = 32, ROOM_LIMIT = 64, ROOM_MAX = 1024, DISTRIBUTOR_M3 = 256;
/** Manual airlock cycle (SYSTEMS §5): 6 s, 4 GU. Build reach from the eye to a cell centre. */
export const PASSAGE_MS = 6000, PASSAGE_Q = 4000, BUILD_REACH = 7;
/** Bounds of placeable cells: the map's building area; levels keep every neighbour key inside the grid. */
export const CELL_MIN = -195, CELL_MAX = 354, LEVEL_MIN = -31, LEVEL_MAX = 94;
/** Per cubic metre (milli-GU): capacity 20 GU, habitable from 8 GU; technical leak 0.002 GU/s. */
export const capacityOf = (volume: number) => 20000 * volume;
export const habitableQ = (volume: number) => 8000 * volume;
// ---------- Cells ----------
/** X = i+256, Z = j+256 (0…1023), Y = k+32 (0…127); key = (X·1024 + Z)·128 + Y < 2^27. */
export const cellKey = (i: number, k: number, j: number) => ((i + 256) * 1024 + (j + 256)) * 128 + (k + 32);
export function cellOf(key: number) { const y = key % 128, r = (key - y) / 128, z = r % 1024; return { i: (r - z) / 1024 - 256, k: y - 32, j: z - 256 }; }
export const cellCenter = (key: number) => { const c = cellOf(key); return { x: c.i + .5, y: c.k + .5, z: c.j + .5 }; };
export const placeable = (i: number, k: number, j: number) => [i, k, j].every(Number.isInteger) && i >= CELL_MIN && i <= CELL_MAX && j >= CELL_MIN && j <= CELL_MAX && k >= LEVEL_MIN && k <= LEVEL_MAX;
const STEP_I = 131072, STEP_J = 128;
/** The 6 face neighbours of a cell key (gas never passes edges or corners). */
export const around = (key: number) => [key + 1, key - 1, key + STEP_J, key - STEP_J, key + STEP_I, key - STEP_I];
const column = (i: number, j: number) => (i + 256) * 1024 + (j + 256);
/** Lowest terrain corner of a cell column; the heightfield never changes at runtime. */
const FLOOR = new Map<number, number>();
export function columnFloor(i: number, j: number) {
 const c = column(i, j); let h = FLOOR.get(c);
 if (h === undefined) { h = Math.min(heightAt(i, j), heightAt(i + 1, j), heightAt(i, j + 1), heightAt(i + 1, j + 1)); FLOOR.set(c, h); }
 return h;
}
/** Honest ground rule: a cell is ground only when the terrain is above its middle at all four corners of its base. */
export const isGround = (i: number, k: number, j: number) => columnFloor(i, j) > k + .5;
/** Lowest air level of a column. */
export const lowestAir = (i: number, j: number) => Math.ceil(columnFloor(i, j) - .5);
const groundKey = (key: number) => { const c = cellOf(key); return isGround(c.i, c.k, c.j); };
/** Cells of a box (w × h × d from its lowest corner cell). */
export function boxCells(i0: number, k0: number, j0: number, w: number, h: number, d: number) { const out: number[] = []; for (let i = i0; i < i0 + w; i++) for (let k = k0; k < k0 + h; k++) for (let j = j0; j < j0 + d; j++) out.push(cellKey(i, k, j)); return out; }
/** A room footprint w × d standing on the ground: each column from its lowest air level up to one common top `h` levels
 *  above the highest of those (the converted dome uses 4 × 4 × 3). */
export function groundRoom(i0: number, j0: number, w: number, d: number, h: number) {
 let top = -Infinity; for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + d; j++) top = Math.max(top, lowestAir(i, j) + h - 1);
 const out: number[] = []; for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + d; j++) for (let k = lowestAir(i, j); k <= top; k++) out.push(cellKey(i, k, j));
 return out;
}
// ---------- Doors ----------
export const doorFront = (rot: number) => ({ x: Math.round(Math.sin(rot * Math.PI / 2)), z: Math.round(Math.cos(rot * Math.PI / 2)) });
export const doorKeys = (d: { x: number; y: number; z: number }) => [cellKey(d.x, d.y, d.z), cellKey(d.x, d.y + 1, d.z)];
/** The landing column on one side of a door: the cell straight in front (or behind) at both door levels. */
export function landingCells(d: Door, side: Side) { const f = doorFront(d.rot), s = side === 'front' ? 1 : -1; return doorKeys({ x: d.x + f.x * s, y: d.y, z: d.z + f.z * s }); }
const other = (s: Side): Side => s === 'front' ? 'back' : 'front';
// ---------- Derived rooms ----------
/** The glass that closes a set of interior cells: every face neighbour that is neither interior nor ground. */
export function shellOf(interior: Iterable<number>) {
 const inside = new Set(interior), out = new Set<number>();
 for (const c of inside) for (const n of around(c)) if (!inside.has(n) && !groundKey(n)) out.add(n);
 return [...out].sort((a, b) => a - b);
}
const OPEN = -1, BIG = -2;
/** Rooms of one glass/door layout. `tag`: cell → room index (≥ 0) or an explored non-room region (OPEN / BIG). */
export type RoomsView = { glass: Set<number>; doorAt: Map<number, Door>; rooms: Room[]; tag: Map<number, number>; colTop: Map<number, number>; box: number[] };
const solidIn = (v: RoomsView, key: number) => v.glass.has(key) || v.doorAt.has(key) || groundKey(key);
/** Outside: beyond the glass/door bounding box grown by 1, or open to the sky (no glass or door above in its column).
 *  Terrain is a heightfield, so an air cell with nothing above can always rise past the box: the same verdict, sooner. */
function outsideIn(v: RoomsView, key: number) {
 const c = cellOf(key), b = v.box;
 if (c.i < b[0] - 1 || c.i > b[1] + 1 || c.k < b[2] - 1 || c.k > b[3] + 1 || c.j < b[4] - 1 || c.j > b[5] + 1) return true;
 return !((v.colTop.get(column(c.i, c.j)) ?? -Infinity) > c.k);
}
/** Breadth-first fill over air cells: closed and at most 1024 cells is a room, anything else is open (or too big). */
function explore(v: RoomsView, start: number) {
 const seen = [start], mark = new Set(seen);
 let found: number | undefined = outsideIn(v, start) ? OPEN : undefined;
 for (let h = 0; found === undefined && h < seen.length; h++) for (const n of around(seen[h])) {
  if (mark.has(n)) continue;
  const t = v.tag.get(n); if (t !== undefined && t < 0) { found = t; break; }
  if (solidIn(v, n)) continue;
  mark.add(n); seen.push(n);
  if (outsideIn(v, n)) { found = OPEN; break; }
  if (seen.length > ROOM_MAX) { found = BIG; break; }
 }
 if (found !== undefined) { for (const c of seen) v.tag.set(c, found); return; }
 const index = v.rooms.length; let cell = seen[0];
 for (const c of seen) { v.tag.set(c, index); if (c < cell) cell = c; }
 v.rooms.push({ index, cell, cells: seen, volume: seen.length });
}
/** Pure: rooms of a hypothetical layout (validation, prediction and migration use it without touching a game). */
export function deriveRooms(glassKeys: Iterable<number>, doors: readonly Door[]): RoomsView {
 const glass = new Set(glassKeys), doorAt = new Map<number, Door>(), colTop = new Map<number, number>(), box = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
 for (const d of doors) for (const key of doorKeys(d)) doorAt.set(key, d);
 const v: RoomsView = { glass, doorAt, rooms: [], tag: new Map(), colTop, box };
 const sources = [...glass, ...doorAt.keys()];
 for (const key of sources) {
  const c = cellOf(key), col = column(c.i, c.j);
  box[0] = Math.min(box[0], c.i); box[1] = Math.max(box[1], c.i); box[2] = Math.min(box[2], c.k); box[3] = Math.max(box[3], c.k); box[4] = Math.min(box[4], c.j); box[5] = Math.max(box[5], c.j);
  if (!((colTop.get(col) ?? -Infinity) >= c.k)) colTop.set(col, c.k);
 }
 for (const key of sources) for (const n of around(key)) if (!v.tag.has(n) && !solidIn(v, n)) explore(v, n);
 return v;
}
const CACHE = new WeakMap<BaseState, { glass: number[]; glassLen: number; doors: Door[]; doorsLen: number; view: RoomsView; rev: number }>();
let revision = 0;
function remember(base: BaseState, view: RoomsView) { CACHE.set(base, { glass: base.glass, glassLen: base.glass.length, doors: base.doors, doorsLen: base.doors.length, view, rev: ++revision }); }
const freshZone = (cell: number, temperature = 10): Zone => ({ cell, q: 0, temperature, purity: 0, lossRemainder: 0 });
/** Keeps exactly one zone per room (a layout changed outside editRooms: tests, a hand-made file). */
function reconcile(base: BaseState, view: RoomsView) {
 const cells = new Set(view.rooms.map(r => r.cell));
 if (base.zones.length === view.rooms.length && base.zones.every(z => cells.has(z.cell))) return;
 const kept = base.zones.filter(z => cells.has(z.cell));
 for (const r of view.rooms) if (!kept.some(z => z.cell === r.cell)) kept.push(freshZone(r.cell));
 base.zones = kept;
}
/** Cached rooms of a base; rebuilt when its glass or door list was replaced or resized (every edit goes through editRooms). */
export function roomsView(base: BaseState): RoomsView {
 const c = CACHE.get(base);
 if (c && c.glass === base.glass && c.glassLen === base.glass.length && c.doors === base.doors && c.doorsLen === base.doors.length) return c.view;
 const view = deriveRooms(base.glass, base.doors); remember(base, view); reconcile(base, view); return view;
}
/** Bumped on every edit and load: renderers rebuild glass only when it changes. */
export const roomsRevision = (g: GameState) => { roomsView(g.world.base); return CACHE.get(g.world.base)!.rev; };
/** Forget the cached rooms (after changing `world.base.glass` / `doors` in place). */
export const bumpRooms = (g: GameState) => { CACHE.delete(g.world.base); };
// ---------- Queries ----------
export const zoneOf = (base: BaseState, room: Room) => base.zones.find(z => z.cell === room.cell) ?? freshZone(room.cell);
const info = (g: GameState, r: Room): RoomInfo => ({ ...r, zone: zoneOf(g.world.base, r) });
export const allRooms = (g: GameState) => roomsView(g.world.base).rooms.map(r => info(g, r));
export function roomAtCell(g: GameState, key: number): RoomInfo | null { const v = roomsView(g.world.base), t = v.tag.get(key); return t !== undefined && t >= 0 ? info(g, v.rooms[t]) : null; }
/** Room containing a point (the player: the chest cell, y + 1.0). */
export const roomAt = (g: GameState, x: number, y: number, z: number) => roomAtCell(g, cellKey(Math.floor(x), Math.floor(y), Math.floor(z)));
export const playerRoom = (g: GameState) => roomAt(g, g.player.x, g.player.y + 1, g.player.z);
/** A station stands in the cell of its centre (floor(x), floor(y + 0.5), floor(z)); stations never affect sealing. */
export const stationCell = (b: { x: number; y: number; z: number }) => cellKey(Math.floor(b.x), Math.floor(b.y + .5), Math.floor(b.z));
export const stationRoom = (g: GameState, b: { x: number; y: number; z: number }) => roomAtCell(g, stationCell(b));
export const habitableRoom = (r: RoomInfo) => r.zone.q >= habitableQ(r.volume) && r.zone.purity >= .5 && r.zone.temperature >= -5 && r.zone.temperature <= 40;
export const anyHabitable = (g: GameState) => allRooms(g).some(habitableRoom);
export function breathingRoom(g: GameState) { const r = playerRoom(g); return r && habitableRoom(r) ? r : null; }
export const roomDistributors = (g: GameState, r: Room) => g.world.base.buildings.filter(b => b.kind === 'distributor' && stationRoom(g, b)?.index === r.index);
/** One distributor serves up to 256 m³ (SYSTEMS §5). */
export const distributorsNeeded = (r: Room) => Math.ceil(r.volume / DISTRIBUTOR_M3);
export const roomCenter = (r: Room) => { let x = 0, y = 0, z = 0; for (const c of r.cells) { const p = cellCenter(c); x += p.x; y += p.y; z += p.z; } return { x: x / r.volume, y: y / r.volume, z: z / r.volume }; };
export const isGlass = (g: GameState, key: number) => roomsView(g.world.base).glass.has(key);
export const doorAtCell = (g: GameState, key: number) => roomsView(g.world.base).doorAt.get(key);
export const doorById = (g: GameState, id: string) => g.world.base.doors.find(d => d.id === id);
/** Rooms on both sides of a door (its landing cell at the lower level). */
export function doorRooms(g: GameState, d: Door): Record<Side, RoomInfo | null> { return { front: roomAtCell(g, landingCells(d, 'front')[0]), back: roomAtCell(g, landingCells(d, 'back')[0]) }; }
/** A door on a room's boundary (quests: the shelter has a way in). */
export const roomDoors = (g: GameState, r: Room) => g.world.base.doors.filter(d => { const s = doorRooms(g, d); return s.front?.index === r.index || s.back?.index === r.index; });
/** Where a body stands in a cell column: on the first glass/door below, else on the terrain. */
function standY(view: RoomsView, i: number, k: number, j: number, x: number, z: number) {
 for (let kk = k - 1; kk >= LEVEL_MIN - 1; kk--) { const key = cellKey(i, kk, j); if (view.glass.has(key) || view.doorAt.has(key)) return Math.max(kk + 1, heightAt(x, z)); if (isGround(i, kk, j)) break; }
 return heightAt(x, z);
}
/** Landing point on one side: the centre of the landing cell, 1 m from the door axis — 1.5 m from the door's inner face,
 *  which for a converted dome is exactly its old exit (dome centre + front × 3.5). */
export function landingAt(view: RoomsView, d: Door, side: Side) {
 const f = doorFront(d.rot), s = side === 'front' ? 1 : -1, i = d.x + f.x * s, j = d.z + f.z * s, x = i + .5, z = j + .5;
 return { x, y: standY(view, i, d.y, j, x, z), z };
}
export const landingPoint = (g: GameState, d: Door, side: Side) => landingAt(roomsView(g.world.base), d, side);
export const sideOf = (d: Door, x: number, z: number): Side => { const f = doorFront(d.rot); return (x - d.x - .5) * f.x + (z - d.z - .5) * f.z >= 0 ? 'front' : 'back'; };
// ---------- Leak path (UI) ----------
/** Why a glass/door cell is not part of a closed room: the escape path from the air beside it (prefers the side under a
 *  roof), or 'big' for a closed volume over 1024 m³. Null when it borders a room on some side or has no air beside it. */
export function leakAt(g: GameState, key: number): { kind: 'open' | 'big'; path: number[] } | null {
 const v = roomsView(g.world.base); if (!v.glass.has(key) && !v.doorAt.has(key)) return null;
 const air = around(key).filter(n => !solidIn(v, n));
 if (!air.length || air.some(n => (v.tag.get(n) ?? -1) >= 0)) return null;
 const start = air.find(n => !outsideIn(v, n)) ?? air[0];
 if (v.tag.get(start) === BIG) return { kind: 'big', path: [] };
 const seen = [start], parent = new Map<number, number>([[start, start]]);
 for (let h = 0; h < seen.length && seen.length <= ROOM_MAX; h++) {
  const c = seen[h];
  if (outsideIn(v, c)) { const path = [c]; while (parent.get(path[0]) !== path[0]) path.unshift(parent.get(path[0])!); return { kind: 'open', path }; }
  for (const n of around(c)) if (!parent.has(n) && !solidIn(v, n)) { parent.set(n, c); seen.push(n); }
 }
 return { kind: 'big', path: [] };
}
// ---------- Editing with conserved gas ----------
export const outsideTemp = (g: GameState) => isDay(phaseSeconds(g.meta.activeTicks, g.world.dayOffsetTicks)) ? 10 : -10;
export type RoomChange = { add?: number[]; remove?: number[]; door?: Door; undoor?: string };
/**
 * Moves each old room's gas onto the new layout in whole milli-GU: a new region C gets q·|R∩C|/|R| of an old room A
 * (R = A's cells still air), the remainder goes to the largest overlap, a share reaching open air vanishes (D32), the
 * clamp to 20·V vents a squeezed room. T and purity are volume averages; new empty volume brings 0 GU, outside T and
 * purity 0. Nothing is created or lost on rounding. An unchanged room keeps its zone as it was.
 */
function carry(before: RoomsView, zones: Zone[], after: RoomsView, outside: number) {
 const old = new Map(zones.map(z => [z.cell, z])), acc = after.rooms.map(() => ({ q: 0, t: 0, p: 0, from: 0, same: undefined as Zone | undefined, only: undefined as Zone | null | undefined }));
 let vented = 0, breached = false;
 for (const a of before.rooms) {
  const z = old.get(a.cell) ?? freshZone(a.cell, outside), counts = new Map<number, number>(); let n = 0;
  for (const c of a.cells) { if (after.glass.has(c) || after.doorAt.has(c)) continue; n++; const t = after.tag.get(c), d = t !== undefined && t >= 0 ? t : OPEN; counts.set(d, (counts.get(d) ?? 0) + 1); }
  if (!n) { vented += z.q; continue; }
  let given = 0, best = OPEN, bestN = 0;
  for (const [d, m] of counts) {
   const share = Math.floor(z.q * m / n); given += share;
   if (m > bestN || (m === bestN && (best === OPEN || (d >= 0 && d < best)))) { best = d; bestN = m; }
   if (d < 0) { vented += share; breached = true; } else { const x = acc[d]; x.q += share; x.t += m * z.temperature; x.p += m * z.purity; x.from += m; x.only = x.only === undefined ? z : null; }
  }
  if (best < 0) vented += z.q - given; else acc[best].q += z.q - given;
  if (counts.size === 1 && best >= 0 && n === a.volume && after.rooms[best].volume === n) acc[best].same = z;
 }
 const next = after.rooms.map((r, i): Zone => {
  const x = acc[i]; if (x.same) return { ...x.same, cell: r.cell };
  const fresh = r.volume - x.from, cap = capacityOf(r.volume), q = Math.min(x.q, cap), one = !fresh && x.only; vented += x.q - q;
  // One source and no new volume keeps its T and purity exactly (no float drift on a plain split).
  return { cell: r.cell, q, temperature: one ? one.temperature : (x.t + fresh * outside) / r.volume, purity: one ? one.purity : x.p / r.volume, lossRemainder: 0 };
 });
 return { zones: next, vented, breached };
}
function layout(base: BaseState, change: RoomChange) {
 const glass = new Set(base.glass); for (const k of change.remove ?? []) glass.delete(k); for (const k of change.add ?? []) glass.add(k);
 const doors = base.doors.filter(d => d.id !== change.undoor); if (change.door) doors.push(change.door);
 return { glass: [...glass].sort((a, b) => a - b), doors };
}
/** Applies one glass/door edit and carries the air over; refuses (nothing changes) past the room limit. */
export function editRooms(g: GameState, change: RoomChange, outside = outsideTemp(g)): { error: string; vented: number; breached: boolean; at: { x: number; y: number; z: number } | null } {
 const base = g.world.base, before = roomsView(base), next = layout(base, change), after = deriveRooms(next.glass, next.doors);
 if (after.rooms.length > ROOM_LIMIT) return { error: `Достигнут предел ${ROOM_LIMIT} помещений`, vented: 0, breached: false, at: null };
 const gone = base.doors.find(d => d.id === change.undoor), first = change.remove?.[0] ?? change.add?.[0] ?? (change.door ?? gone ? doorKeys((change.door ?? gone)!)[0] : undefined);
 const moved = carry(before, base.zones, after, outside);
 base.glass = next.glass; base.doors = next.doors; base.zones = moved.zones; remember(base, after);
 return { error: '', vented: moved.vented / 1000, breached: moved.breached, at: first === undefined ? null : cellCenter(first) };
}
const PREDICT = new WeakMap<RoomsView, Map<number, number>>();
/** GU that would leave if the glass block or door at `key` were removed; the state is not touched. */
export function predictRemove(g: GameState, key: number): number {
 const base = g.world.base, v = roomsView(base), memo = PREDICT.get(v) ?? new Map<number, number>(); PREDICT.set(v, memo);
 const known = memo.get(key); if (known !== undefined) return known;
 const d = v.doorAt.get(key), change: RoomChange = d ? { undoor: d.id } : v.glass.has(key) ? { remove: [key] } : {};
 const next = layout(base, change), gu = carry(v, base.zones, deriveRooms(next.glass, next.doors), 10).vented / 1000;
 memo.set(key, gu); return gu;
}
// ---------- Placement rules ----------
const overlaps = (a: number[], b: number[]) => a[0] < b[1] - 1e-6 && a[1] > b[0] + 1e-6 && a[2] < b[3] - 1e-6 && a[3] > b[2] + 1e-6 && a[4] < b[5] - 1e-6 && a[5] > b[4] + 1e-6;
/** [minX, maxX, minY, maxY, minZ, maxZ] of `n` stacked cells from `key` up. */
const cellBox = (key: number, n = 1) => { const c = cellOf(key); return [c.i, c.i + 1, c.k, c.k + n, c.j, c.j + 1]; };
const playerBox = (x: number, y: number, z: number) => [x - .3, x + .3, y, y + 1.8, z - .3, z + .3];
/** Station body heights (buildings.ts colliders): a footprint of ±0.48 m around the integer centre. */
export const STATION_HEIGHT: Record<string, number> = { workbench: 1.1, kiln: 1.35, biogenerator: 1.25, electrolyzer: 1.25, refill: 1.45, distributor: .95 };
export const stationBox = (b: { kind: string; level?: number; x: number; y: number; z: number }) => [b.x - .48, b.x + .48, b.y, b.y + (b.kind === 'workbench' && b.level === 2 ? 1.55 : STATION_HEIGHT[b.kind] ?? 1.5), b.z - .48, b.z + .48];
/** Cells kept free in front of and behind every door, both door levels: the player is set down there. */
export function reservedCells(g: GameState, except?: string) { const out = new Set<number>(); for (const d of g.world.base.doors) if (d.id !== except) for (const s of ['front', 'back'] as const) for (const k of landingCells(d, s)) out.add(k); return out; }
/** Capsule doorway, future basin and the map edge (the old body rules, on cells). */
function areaProblem(key: number) {
 const c = cellOf(key);
 if (!placeable(c.i, c.k, c.j)) return 'За границей участка';
 if (c.i + 1 > 36.7 && c.i < 43.3 && c.j + 1 > 36.5 && c.j < 47) return 'Оставьте вход капсулы свободным';
 if (Math.abs(c.i + .5 - 100) < 12.5 && Math.abs(c.j + .5 - 132) < 10.5) return 'Здесь зарезервирован будущий водоём';
 return '';
}
function reach(g: GameState, key: number) { const p = cellCenter(key); return Math.hypot(p.x - g.player.x, p.y - g.player.y - EYE, p.z - g.player.z) <= BUILD_REACH; }
/** Why a glass block cannot go into this cell ('' = it can). Read-only: the ghost asks every frame. */
export function glassProblem(g: GameState, key: number): string {
 if (g.player.vitals.health <= 0) return 'Персонаж погиб';
 const area = areaProblem(key); if (area) return area;
 const v = roomsView(g.world.base), c = cellOf(key);
 if (v.glass.has(key) || v.doorAt.has(key)) return 'Клетка уже занята';
 if (isGround(c.i, c.k, c.j)) return 'В грунт ставить нельзя';
 if (!reach(g, key)) return 'Слишком далеко — подойдите ближе';
 if (v.glass.size >= GLASS_LIMIT) return `Достигнут предел ${GLASS_LIMIT} стеклоблоков`;
 const box = cellBox(key);
 if (overlaps(box, playerBox(g.player.x, g.player.y, g.player.z))) return 'Место занято персонажем';
 if (g.world.base.buildings.some(b => overlaps(box, stationBox(b)))) return 'Место занято станцией';
 if (reservedCells(g).has(key)) return 'Здесь посадка шлюза — оставьте её свободной';
 return '';
}
/** Why an airlock (lower cell `key`, turned `rot`) cannot stand here ('' = it can). Glass in its two cells is fine:
 *  the door replaces it and the blocks return to the backpack. */
export function doorProblem(g: GameState, key: number, rot: number, except?: string): string {
 if (g.player.vitals.health <= 0) return 'Персонаж погиб';
 const c = cellOf(key), cells = doorKeys({ x: c.i, y: c.k, z: c.j }), v = roomsView(g.world.base);
 for (const k of cells) { const area = areaProblem(k); if (area) return area; }
 if (!reach(g, key)) return 'Слишком далеко — подойдите ближе';
 if (g.world.base.doors.filter(d => d.id !== except).length >= DOOR_LIMIT) return `Достигнут предел ${DOOR_LIMIT} шлюзов`;
 for (const k of cells) { const d = v.doorAt.get(k); if (d && d.id !== except) return 'Здесь уже стоит шлюз'; const p = cellOf(k); if (isGround(p.i, p.k, p.j)) return 'Шлюз не ставится в грунт'; }
 const box = cellBox(key, 2);
 if (overlaps(box, playerBox(g.player.x, g.player.y, g.player.z))) return 'Место занято персонажем';
 if (g.world.base.buildings.some(b => overlaps(box, stationBox(b)))) return 'Место занято станцией';
 const reserved = reservedCells(g, except); if (cells.some(k => reserved.has(k))) return 'Здесь проход другого шлюза';
 const d: Door = { id: '', x: c.i, y: c.k, z: c.j, rot: ((rot % 4) + 4) % 4 };
 for (const side of ['front', 'back'] as const) {
  const land = landingCells(d, side), low = cellOf(land[0]);
  if (land.some(k => v.glass.has(k) || v.doorAt.has(k))) return side === 'front' ? 'Перед шлюзом стекло — освободите проход' : 'За шлюзом стекло — освободите проход';
  if (isGround(low.i, low.k, low.j)) return 'Шлюз упирается в грунт — поставьте его выше';
  if (land.some(k => areaProblem(k))) return 'Шлюзу нужен проход с обеих сторон';
  if (g.world.base.buildings.some(b => overlaps(cellBox(land[0], 2), stationBox(b)))) return 'У шлюза стоит станция — оставьте проход свободным';
 }
 const front = cellBox(landingCells(d, 'front')[0], 2);
 if (boxes.some(b => !b.id.startsWith('build-') && overlaps(front, [b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ]))) return 'Перед шлюзом препятствие — поверните шлюз';
 return '';
}
/** Why a station footprint cannot stand here ('' = it can): glass, doors, airlock landings, a generator inside a room. */
export function stationProblem(g: GameState, kind: string, x: number, y: number, z: number): string {
 const v = roomsView(g.world.base), box = stationBox({ kind, x, y, z }), reserved = reservedCells(g);
 for (let i = Math.floor(box[0]); i < box[1]; i++) for (let j = Math.floor(box[4]); j < box[5]; j++) for (let k = Math.floor(box[2]); k < box[3]; k++) {
  const key = cellKey(i, k, j);
  if (v.glass.has(key) || v.doorAt.has(key)) return 'Место занято стеклом';
  if (reserved.has(key)) return 'Здесь проход шлюза — оставьте его свободным';
 }
 // Combustion needs the outside air and an exhaust: a generator in a room would never burn its fuel.
 if (kind === 'biogenerator' && v.tag.get(stationCell({ x, y, z }))! >= 0) return 'Генератору нужен выхлоп — ставьте его снаружи помещения';
 return '';
}
// ---------- Actions ----------
const refuse = (error: string, needConfirm = false, ventGU = 0): RoomEdit => ({ error, needConfirm, ventGU, breached: false, at: null });
/** Takes one item, preferring the selected hotbar cell. */
function takeOne(g: GameState, itemId: string) {
 const inv = g.player.inventory, s = inv[g.player.hotbar];
 if (s?.itemId === itemId && !s.packed) { if (--s.count === 0) inv[g.player.hotbar] = null; return true; }
 return removeItems(inv, itemId, 1) === 1;
}
/** Returns blocks to the backpack; what does not fit lands on the ground at the cell. */
function giveBack(g: GameState, itemId: string, n: number, key: number) { const left = addItems(g.player.inventory, itemId, n); if (left) { const p = cellCenter(key); dropItems(g, p.x, p.z, [{ itemId, count: left }]); } }
const confirmText = (gu: number) => `Воздух уйдёт: ${Math.ceil(gu)} GU — нажмите ещё раз`;
/** Places one glass block from the backpack. */
export function placeGlass(g: GameState, key: number): RoomEdit {
 const problem = glassProblem(g, key); if (problem) return refuse(problem);
 if (countItem(g.player.inventory, 'window') < 1) return refuse('В рюкзаке нет: ' + ITEMS.window.name);
 const r = editRooms(g, { add: [key] }); if (r.error) return refuse(r.error);
 takeOne(g, 'window'); return { error: '', needConfirm: false, ventGU: r.vented, breached: r.breached, at: r.at };
}
/** Removes one glass block into the backpack. If air would leave, the first call only asks (`needConfirm`). */
export function removeGlass(g: GameState, key: number, confirmed = false): RoomEdit {
 if (g.player.vitals.health <= 0) return refuse('Персонаж погиб');
 if (!isGlass(g, key)) return refuse('Здесь нет стеклоблока');
 if (!reach(g, key)) return refuse('Слишком далеко — подойдите ближе');
 const gu = predictRemove(g, key); if (gu > 0 && !confirmed) return refuse(confirmText(gu), true, gu);
 const r = editRooms(g, { remove: [key] }); if (r.error) return refuse(r.error);
 giveBack(g, 'window', 1, key); return { error: '', needConfirm: false, ventGU: r.vented, breached: r.breached, at: r.at };
}
/** Builds an airlock into the two cells from `key` up: glass there returns to the backpack, sealing never breaks. */
export function placeDoor(g: GameState, key: number, rot: number): RoomEdit {
 const problem = doorProblem(g, key, rot); if (problem) return refuse(problem);
 if (countItem(g.player.inventory, 'airlock') < 1) return refuse('В рюкзаке нет: ' + ITEMS.airlock.name);
 const c = cellOf(key), cells = doorKeys({ x: c.i, y: c.k, z: c.j }), glass = cells.filter(k => isGlass(g, k));
 const door: Door = { id: 'door-' + g.world.base.nextId, x: c.i, y: c.k, z: c.j, rot: ((rot % 4) + 4) % 4 };
 const r = editRooms(g, { remove: glass, door }); if (r.error) return refuse(r.error);
 g.world.base.nextId++; takeOne(g, 'airlock'); if (glass.length) giveBack(g, 'window', glass.length, key);
 return { error: '', needConfirm: false, ventGU: r.vented, breached: r.breached, at: r.at };
}
/** Takes an airlock back into the backpack; asks first when air would leave. */
export function removeDoor(g: GameState, id: string, confirmed = false): RoomEdit {
 const d = doorById(g, id); if (!d) return refuse('Нет такого шлюза');
 if (g.player.vitals.health <= 0) return refuse('Персонаж погиб');
 if (g.world.base.passage?.doorId === id) return refuse('Шлюз занят');
 const key = doorKeys(d)[0]; if (!reach(g, key)) return refuse('Слишком далеко — подойдите ближе');
 const gu = predictRemove(g, key); if (gu > 0 && !confirmed) return refuse(confirmText(gu), true, gu);
 const r = editRooms(g, { undoor: id }); if (r.error) return refuse(r.error);
 giveBack(g, 'airlock', 1, key); return { error: '', needConfirm: false, ventGU: r.vented, breached: r.breached, at: r.at };
}
// ---------- Airlock passage ----------
/** Clear landing: the standing body there meets no glass, door or station. */
function landingClear(g: GameState, d: Door, side: Side) {
 const p = landingPoint(g, d, side), body = playerBox(p.x, p.y, p.z), v = roomsView(g.world.base);
 for (let i = Math.floor(body[0]); i < body[1]; i++) for (let j = Math.floor(body[4]); j < body[5]; j++) for (let k = Math.floor(body[2]); k < body[3]; k++) { const key = cellKey(i, k, j); if (v.glass.has(key) || v.doorAt.has(key)) return false; }
 return !g.world.base.buildings.some(b => overlaps(body, stationBox(b)));
}
/**
 * Starts a passage through door `id` from the player's side. From a room: anywhere in it within 2.5 m of the door. From
 * outside: within 3 m of that side's landing point. Entering a room needs its full 4 GU (they carry the breath of the 6 s
 * cycle); leaving is always possible and pays what is left (≤ 4 GU); an inner door (rooms on both sides) charges 4 GU from
 * the destination when it has them. A door with no room on either side is a plain doorway: free and instant.
 */
export function beginPassage(g: GameState, id: string): string {
 const d = doorById(g, id); if (!d) return 'Нужен шлюз';
 if (g.world.base.passage) return 'Шлюз занят';
 if (g.player.vitals.health <= 0) return 'Персонаж погиб';
 const p = g.player, sides = doorRooms(g, d), here = playerRoom(g);
 const from: Side = here && sides.front?.index === here.index ? 'front' : here && sides.back?.index === here.index ? 'back' : sideOf(d, p.x, p.z), to = other(from), src = sides[from], dst = sides[to];
 if (src) { if (here?.index !== src.index || Math.hypot(p.x - d.x - .5, p.z - d.z - .5) > 2.5) return 'Подойдите к шлюзу'; }
 else { const at = landingPoint(g, d, from); if (here || Math.hypot(p.x - at.x, p.z - at.z) > 3) return 'Подойдите к шлюзу'; }
 if (!landingClear(g, d, to)) return 'Проход загорожен — освободите место за шлюзом';
 const direction = to === 'back' ? 'in' : 'out';
 if (!src && !dst) { g.world.base.passage = { doorId: id, direction, remainingMs: 0, paid: false }; return ''; }
 let paid = false;
 if (dst && !src) { if (dst.zone.q < PASSAGE_Q) return 'В помещении меньше 4 GU воздуха — сначала наполните его'; dst.zone.q -= PASSAGE_Q; paid = true; }
 else if (src && !dst) { const cost = Math.min(src.zone.q, PASSAGE_Q); src.zone.q -= cost; paid = cost > 0; }
 else if (dst!.zone.q >= PASSAGE_Q) { dst!.zone.q -= PASSAGE_Q; paid = true; }
 g.world.base.passage = { doorId: id, direction, remainingMs: PASSAGE_MS, paid };
 return '';
}
/** The room whose 4 GU carry the player through a paid inbound cycle: no breathing is taken meanwhile. */
export function cyclingRoom(g: GameState) { const p = g.world.base.passage, d = p?.paid ? doorById(g, p.doorId) : undefined; return d ? doorRooms(g, d)[p!.direction === 'in' ? 'back' : 'front'] : null; }
/** Advances the cycle; returns where to put the player when it ends (null otherwise). */
export function advancePassage(g: GameState, ms: number) {
 const p = g.world.base.passage; if (!p) return null;
 p.remainingMs = Math.max(0, p.remainingMs - ms); if (p.remainingMs) return null;
 const d = doorById(g, p.doorId); g.world.base.passage = null;
 return d ? landingPoint(g, d, p.direction === 'in' ? 'back' : 'front') : null;
}
// ---------- Simulation ----------
/** Distributor power request in milli-EU for one tick (climate grows with the outside difference, SYSTEMS §5). */
export const distributorDemand = (ms: number, outside: number) => Math.round((10 + Math.min(8, Math.abs(outside - 20) / 20)) * ms);
/** Leak, fill and climate of every room for one tick (the old dome formulas with the room's own V). `power`: milli-EU
 *  given to each building this tick. Returns gas moved per distributor (milli-GU). */
export function roomsTick(g: GameState, ms: number, power: Map<string, number>, outside: number, flow: (room: RoomInfo, d: Building, n: number) => void) {
 const here = playerRoom(g);
 for (const r of allRooms(g)) {
  const z = r.zone, installed = roomDistributors(g, r), distributors = installed.filter(d => d.enabled), cap = capacityOf(r.volume);
  // One distributor serves 256 m³: with fewer than ceil(V/256) the room is not filled (climate still runs).
  const fill = distributors.length >= distributorsNeeded(r);
  let powered = 0;
  for (const d of distributors) {
   const ratio = (power.get(d.id) ?? 0) / distributorDemand(ms, outside); powered += ratio;
   if (fill) { const n = Math.min(d.oxygen, cap - z.q, Math.round(20 * ms * ratio)); if (n > 0) { d.oxygen -= n; z.q += n; flow(r, d, n); } }
  }
  // Technical loss belongs to the sealed shell (0.002·V GU/s): packing the distributor away does not freeze the air.
  if (z.q > 0) { z.lossRemainder += Math.round(2 * r.volume * ms); const loss = Math.floor(z.lossRemainder / 1000); z.lossRemainder %= 1000; z.q = Math.max(0, z.q - loss); }
  if (powered > 0) { z.purity = Math.min(1, z.purity + ms / 30000 * powered); const step = .0005 * ms * powered; z.temperature += Math.sign(20 - z.temperature) * Math.min(step, Math.abs(20 - z.temperature)); }
  else { if (here?.index === r.index) z.purity = Math.max(0, z.purity - ms / 360000); z.temperature = outside + (z.temperature - outside) * Math.exp(-ms / 300000); }
 }
}
