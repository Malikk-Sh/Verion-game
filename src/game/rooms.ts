import { heightAt, boxes, EYE, type Box } from '../world';
import { ITEMS } from './defs';
import { isDay, phaseSeconds } from './daycycle';
import { addItems, countItem, removeItems } from './inventory';
import { dropItems } from './mining';
import type { BaseState, Building } from './production';
import type { GameState } from './state';
/**
 * S4 glass rooms (D31). One orthogonal 1 m grid: cell (i, k, j) spans x∈[i, i+1], y∈[cellY(k), cellY(k) + 1], z∈[j, j+1]. Glass
 * blocks, the cells of each airlock module (its chamber is never room air, D36) and ground cells are solid; air cells joined by faces (6 neighbours, never
 * edges or corners) and closed on every side form a room. A new room is born empty; air leaves at once when a room opens
 * (D32). No DOM and no three.js: the simulation, quests, station windows and tests share this module.
 * Derived data (rooms, cell → room) is rebuilt only on an edit or a load and cached per `world.base`.
 */
/** One door of an airlock module: the outer one on its front face (rot 0 = +z), the inner one on its back face. */
export type DoorFace = 'outer' | 'inner';
/** 'cycling': the door was asked to open and is equalising the chamber (3 s, when needed) or sliding open (0.8 s). */
export type DoorState = 'closed' | 'cycling' | 'open';
/**
 * S5 (D36) walk-through airlock module: `width` cells along the wall (2 when built; 1 only for a legacy module converted
 * from an older save) × `depth` cells deep (S5.1: 2 when built, the chamber stands out of the wall by one cell towards the
 * front; 1 for a module of an S5 save with no room for that) × 2 high. The anchor cell (x, y, z) is in the wall row; the
 * width runs along +x (rot 0/2) or +z (rot 1/3), the depth towards the front. Two sliding doors close its faces; the chamber
 * between them holds `pressure` milli-GU (0…4000) and is never room air. `cycleMs`: what is left of the cycle of the door
 * marked 'cycling' (airlock.ts).
 */
export type Door = { id: string; x: number; y: number; z: number; rot: number; width: 1 | 2; depth: 1 | 2; outer: DoorState; inner: DoorState; pressure: number; cycleMs: number };
/** A closed, depressurised module (a new one, or one converted from an older save). */
export const newDoor = (id: string, x: number, y: number, z: number, rot: number, width: 1 | 2 = 2, depth: 1 | 2 = 2): Door => ({ id, x, y, z, rot: ((rot % 4) + 4) % 4, width, depth, outer: 'closed', inner: 'closed', pressure: 0, cycleMs: 0 });
/** Air of one room; `cell` is the room's smallest cell key and is its identity. q in milli-GU. */
export type Zone = { cell: number; q: number; temperature: number; purity: number; lossRemainder: number };
export type Room = { index: number; cell: number; cells: number[]; volume: number };
export type RoomInfo = Room & { zone: Zone };
export type Side = 'front' | 'back';
export type RoomEdit = { error: string; needConfirm: boolean; ventGU: number; breached: boolean; at: { x: number; y: number; z: number } | null };
export const GLASS_LIMIT = 8192, DOOR_LIMIT = 32, ROOM_LIMIT = 64, ROOM_MAX = 1024, DISTRIBUTOR_M3 = 256;
/** Build reach from the eye to a cell centre. */
export const BUILD_REACH = 7;
/** Bounds of placeable cells: the map's building area; levels keep every neighbour key inside the grid. */
export const CELL_MIN = -195, CELL_MAX = 354, LEVEL_MIN = -31, LEVEL_MAX = 94;
/** Per cubic metre (milli-GU): capacity 20 GU, habitable from 8 GU; technical leak 0.002 GU/s. */
export const capacityOf = (volume: number) => 20000 * volume;
export const habitableQ = (volume: number) => 8000 * volume;
// ---------- Cells ----------
/** X = i+256, Z = j+256 (0…1023), Y = k+32 (0…127); key = (X·1024 + Z)·128 + Y < 2^27. */
/** S5 (D35): levels sit 0.5 m up, so level k spans y ∈ [k + 0.5, k + 1.5) and level 0 rests flush on the 0.5 m build
 *  pad. The only conversions between a level and world y: cellY (bottom of level k) and levelAt (level holding y). */
export const LEVEL_BASE = .5, cellY = (k: number) => k + LEVEL_BASE, levelAt = (y: number) => Math.floor(y - LEVEL_BASE);
export const cellKey = (i: number, k: number, j: number) => ((i + 256) * 1024 + (j + 256)) * 128 + (k + 32);
export function cellOf(key: number) { const y = key % 128, r = (key - y) / 128, z = r % 1024; return { i: (r - z) / 1024 - 256, k: y - 32, j: z - 256 }; }
/** A shelter large enough for the journal: at least 3×3×3 cells of air inside (the guide and the quest share it). */
export function roomy(r: Room) { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const key of r.cells) { const c = cellOf(key), v = [c.i, c.k, c.j]; for (let n = 0; n < 3; n++) { lo[n] = Math.min(lo[n], v[n]); hi[n] = Math.max(hi[n], v[n]); } } return hi.every((h, n) => h - lo[n] >= 2); }
export const cellCenter = (key: number) => { const c = cellOf(key); return { x: c.i + .5, y: cellY(c.k) + .5, z: c.j + .5 }; };
export const placeable = (i: number, k: number, j: number) => [i, k, j].every(Number.isInteger) && i >= CELL_MIN && i <= CELL_MAX && j >= CELL_MIN && j <= CELL_MAX && k >= LEVEL_MIN && k <= LEVEL_MAX;
/** Saved cells may lie a little past the building area: a v7 dome on its edge became a shell 3 cells wide. */
export const STORE_MARGIN = 5, storable = (i: number, k: number, j: number) => [i, k, j].every(Number.isInteger) && i >= CELL_MIN - STORE_MARGIN && i <= CELL_MAX + STORE_MARGIN && j >= CELL_MIN - STORE_MARGIN && j <= CELL_MAX + STORE_MARGIN && k >= LEVEL_MIN && k <= LEVEL_MAX;
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
export const isGround = (i: number, k: number, j: number) => columnFloor(i, j) > cellY(k) + .5;
/** Lowest air level of a column (`| 0` turns a −0 into 0). */
export const lowestAir = (i: number, j: number) => Math.ceil(columnFloor(i, j) - cellY(0) - .5) | 0;
export const groundKey = (key: number) => { const c = cellOf(key); return isGround(c.i, c.k, c.j); };
/** The v8 ground rule on the old integer levels (y ∈ [k, k+1]): only the v8 → v9 migration derives rooms with it. */
export const groundV8 = (key: number) => { const c = cellOf(key); return columnFloor(c.i, c.j) > c.k + .5; };
/** Cells of a box (w × h × d from its lowest corner cell). */
export function boxCells(i0: number, k0: number, j0: number, w: number, h: number, d: number) { const out: number[] = []; for (let i = i0; i < i0 + w; i++) for (let k = k0; k < k0 + h; k++) for (let j = j0; j < j0 + d; j++) out.push(cellKey(i, k, j)); return out; }
/** A room footprint w × d standing on the ground: each column from its lowest air level up to one common top `h` levels
 *  above the highest of those (the converted dome uses 4 × 4 × 3). */
export function groundRoom(i0: number, j0: number, w: number, d: number, h: number) {
 let top = -Infinity; for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + d; j++) top = Math.max(top, lowestAir(i, j) + h - 1);
 const out: number[] = []; for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + d; j++) for (let k = lowestAir(i, j); k <= top; k++) out.push(cellKey(i, k, j));
 return out;
}
/** Where a block aimed at the terrain of column (i, j) goes: the first free cell from the lowest air level up. `support`
 *  is the block it then rests on (−1 = the ground): a held F stacks only onto blocks that were there before the hold. */
export function groundCell(view: { glass: Set<number>; doorAt: Map<number, unknown> }, i: number, j: number) {
 let k = lowestAir(i, j), support = -1;
 while ((view.glass.has(cellKey(i, k, j)) || view.doorAt.has(cellKey(i, k, j))) && k < LEVEL_MAX) support = cellKey(i, k++, j);
 return { cell: cellKey(i, k, j), support };
}
// ---------- Airlock modules ----------
export const doorFront = (rot: number) => ({ x: Math.round(Math.sin(rot * Math.PI / 2)), z: Math.round(Math.cos(rot * Math.PI / 2)) });
/** The width axis of a module: +x for rot 0/2, +z for rot 1/3 (always the positive axis, so rot 0 and 2 share cells). */
export const doorAlong = (rot: number) => rot % 2 ? { x: 0, z: 1 } : { x: 1, z: 0 };
/** Width of a module; an unconverted door of an older save (no `width`, migration only) is one cell wide. */
export const widthOf = (d: { width?: number }) => d.width === 2 ? 2 : 1;
/** Depth of a module (S5.1); a module saved before it (no `depth`, migration only) is one cell deep. */
export const depthOf = (d: { depth?: number }) => d.depth === 2 ? 2 : 1;
type Shape = { x: number; y: number; z: number; rot?: number; width?: number; depth?: number };
/** Cell columns of a module, from the anchor along its width and towards its front through its depth. */
export const doorColumns = (d: Shape) => { const a = doorAlong(d.rot ?? 0), f = doorFront(d.rot ?? 0); return Array.from({ length: depthOf(d) }, (_, r) => Array.from({ length: widthOf(d) }, (_, c) => ({ i: d.x + a.x * c + f.x * r, j: d.z + a.z * c + f.z * r }))).flat(); };
/** Every cell of a module (both levels of each column); [0] is the anchor's lower cell, the key a module is aimed by. */
export const doorKeys = (d: Shape) => doorColumns(d).flatMap(c => [cellKey(c.i, d.y, c.j), cellKey(c.i, d.y + 1, c.j)]);
/** The landing on one side of a module: the cells straight in front (or behind) of every column, at both levels. */
export function landingCells(d: Door, side: Side) { const f = doorFront(d.rot), s = side === 'front' ? depthOf(d) : -1; return doorKeys({ ...d, depth: 1, x: d.x + f.x * s, z: d.z + f.z * s }); }
/** Centre of a module's footprint (the map target and the leading point, D34). */
export const doorCenter = (d: Door) => { const a = doorAlong(d.rot), f = doorFront(d.rot), w = widthOf(d), o = (depthOf(d) - 1) / 2; return { x: d.x + (a.x ? w / 2 : .5) + f.x * o, z: d.z + (a.z ? w / 2 : .5) + f.z * o }; };
/** [minX, maxX, minY, maxY, minZ, maxZ] of a whole module (`rows` cells deep from row `from`, default all of it). */
export const moduleBox = (d: Door, from = 0, rows = depthOf(d)) => {
 const a = doorAlong(d.rot), f = doorFront(d.rot), w = widthOf(d), y = cellY(d.y), x0 = d.x + f.x * from, z0 = d.z + f.z * from;
 const x1 = x0 + f.x * (rows - 1), z1 = z0 + f.z * (rows - 1);
 return [Math.min(x0, x1), Math.max(x0, x1) + (a.x ? w : 1), y, y + 2, Math.min(z0, z1), Math.max(z0, z1) + (a.z ? w : 1)];
};
// ---------- Derived rooms ----------
/** The glass that closes a set of interior cells: every face neighbour that is neither interior nor ground. */
export function shellOf(interior: Iterable<number>) {
 const inside = new Set(interior), out = new Set<number>();
 for (const c of inside) for (const n of around(c)) if (!inside.has(n) && !groundKey(n)) out.add(n);
 return [...out].sort((a, b) => a - b);
}
const OPEN = -1, BIG = -2;
/** Rooms of one glass/door layout. `tag`: cell → room index (≥ 0) or an explored non-room region (OPEN / BIG). */
export type RoomsView = { glass: Set<number>; doorAt: Map<number, Door>; rooms: Room[]; tag: Map<number, number>; colTop: Map<number, number>; box: number[]; ground: (key: number) => boolean };
const solidIn = (v: RoomsView, key: number) => v.glass.has(key) || v.doorAt.has(key) || v.ground(key);
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
/** Pure: rooms of a hypothetical layout (validation, prediction and migration use it without touching a game). `ground`:
 *  the ground rule (the v8 → v9 migration passes groundV8 for the layout as it was saved). */
export function deriveRooms(glassKeys: Iterable<number>, doors: readonly Door[], ground: (key: number) => boolean = groundKey): RoomsView {
 const glass = new Set(glassKeys), doorAt = new Map<number, Door>(), colTop = new Map<number, number>(), box = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
 for (const d of doors) for (const key of doorKeys(d)) doorAt.set(key, d);
 const v: RoomsView = { glass, doorAt, rooms: [], tag: new Map(), colTop, box, ground };
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
export const roomAt = (g: GameState, x: number, y: number, z: number) => roomAtCell(g, cellKey(Math.floor(x), levelAt(y), Math.floor(z)));
export const playerRoom = (g: GameState) => roomAt(g, g.player.x, g.player.y + 1, g.player.z);
/** A station stands in the cell of its centre (floor(x), levelAt(y + 0.5), floor(z)); stations never affect sealing. */
export const stationCell = (b: { x: number; y: number; z: number }) => cellKey(Math.floor(b.x), levelAt(b.y + .5), Math.floor(b.z));
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
/** The room a glass block or airlock belongs to: a room beside it, else — for a block that faces only the open outside —
 *  one beside the blocks joined to it by faces (a corner column or a parapet is part of the box it stands on).
 *  Breadth-first over at most `limit` blocks. */
export function structureRoom(g: GameState, key: number, limit = 256): RoomInfo | null {
 const v = roomsView(g.world.base), solid = (k: number) => v.glass.has(k) || v.doorAt.has(k); if (!solid(key)) return null;
 // A block facing sheltered air (under a roof, inside the box) that is no room belongs to a leaking volume, not to its neighbour.
 if (around(key).some(n => !solidIn(v, n) && !outsideIn(v, n) && !((v.tag.get(n) ?? -1) >= 0))) return null;
 const seen = [key], mark = new Set(seen);
 for (let h = 0; h < seen.length; h++) for (const n of around(seen[h])) {
  const t = v.tag.get(n); if (t !== undefined && t >= 0) return info(g, v.rooms[t]);
  if (!mark.has(n) && solid(n) && seen.length < limit) { mark.add(n); seen.push(n); }
 }
 return null;
}
/** Where a body stands in a cell column: on the first glass/door below, else on the terrain. */
function standY(view: RoomsView, i: number, k: number, j: number, x: number, z: number) {
 for (let kk = k - 1; kk >= LEVEL_MIN - 1; kk--) { const key = cellKey(i, kk, j); if (view.glass.has(key) || view.doorAt.has(key)) return Math.max(cellY(kk + 1), heightAt(x, z)); if (isGround(i, kk, j)) break; }
 return heightAt(x, z);
}
/** Landing point on one side: the centre of the landing cell, 1 m from the door axis — 1.5 m from the door's inner face,
 *  which for a converted dome is exactly its old exit (dome centre + front × 3.5). */
export function landingAt(view: RoomsView, d: Door, side: Side) {
 const f = doorFront(d.rot), s = side === 'front' ? depthOf(d) : -1, c = doorCenter({ ...d, depth: 1 }), i = d.x + f.x * s, j = d.z + f.z * s, x = c.x + f.x * s, z = c.z + f.z * s;
 return { x, y: standY(view, i, d.y, j, x, z), z };
}
export const landingPoint = (g: GameState, d: Door, side: Side) => landingAt(roomsView(g.world.base), d, side);
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
  if (outsideIn(v, c)) {
   const path = [c]; while (parent.get(path[0]) !== path[0]) path.unshift(parent.get(path[0])!);
   // Open to the sky: show the way up past the highest glass, where the air really leaves.
   const e = cellOf(c), b = v.box; if (e.i >= b[0] - 1 && e.i <= b[1] + 1 && e.j >= b[4] - 1 && e.j <= b[5] + 1) for (let top = c; cellOf(top).k <= b[3]; ) path.push(++top);
   return { kind: 'open', path };
  }
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
export function carry(before: RoomsView, zones: Zone[], after: RoomsView, outside: number) {
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
/** Layouts after removing one cell, per current layout: the aim asks every frame, the air changes every tick. */
const PREDICT = new WeakMap<RoomsView, Map<number, RoomsView>>();
/** GU that would leave if the glass block or door at `key` were removed; the state is not touched. */
export function predictRemove(g: GameState, key: number): number {
 const base = g.world.base, v = roomsView(base), memo = PREDICT.get(v) ?? new Map<number, RoomsView>(); PREDICT.set(v, memo);
 let after = memo.get(key);
 if (!after) {
  const d = v.doorAt.get(key), change: RoomChange = d ? { undoor: d.id } : v.glass.has(key) ? { remove: [key] } : {}, next = layout(base, change);
  after = deriveRooms(next.glass, next.doors); if (memo.size >= 8) memo.delete(memo.keys().next().value!); memo.set(key, after);
 }
 return carry(v, base.zones, after, 10).vented / 1000;
}
// ---------- Placement rules ----------
export const overlaps = (a: number[], b: number[]) => a[0] < b[1] - 1e-6 && a[1] > b[0] + 1e-6 && a[2] < b[3] - 1e-6 && a[3] > b[2] + 1e-6 && a[4] < b[5] - 1e-6 && a[5] > b[4] + 1e-6;
/** [minX, maxX, minY, maxY, minZ, maxZ] of `n` stacked cells from `key` up. */
const cellBox = (key: number, n = 1) => { const c = cellOf(key); return [c.i, c.i + 1, cellY(c.k), cellY(c.k) + n, c.j, c.j + 1]; };
export const playerBox = (x: number, y: number, z: number) => [x - .3, x + .3, y, y + 1.8, z - .3, z + .3];
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
/** Why an airlock module (anchor cell `key`, turned `rot`) cannot stand here ('' = it can). Its wall row fills either an
 *  empty gap or a straight 2×2 run of wall glass, which it replaces (the blocks return to the backpack), so sealing never
 *  breaks; S5.1: the chamber's second row stands in front of the wall and needs free air there. */
export function doorProblem(g: GameState, key: number, rot: number, except?: string, width: 1 | 2 = 2, depth: 1 | 2 = 2): string {
 if (g.player.vitals.health <= 0) return 'Персонаж погиб';
 const c = cellOf(key), d = newDoor('', c.i, c.k, c.j, rot, width, depth), cells = doorKeys(d), wall = doorKeys({ ...d, depth: 1 }), v = roomsView(g.world.base);
 for (const k of cells) { const area = areaProblem(k); if (area) return area; }
 if (!reach(g, key)) return 'Слишком далеко — подойдите ближе';
 if (g.world.base.doors.filter(d => d.id !== except).length >= DOOR_LIMIT) return `Достигнут предел ${DOOR_LIMIT} шлюзов`;
 for (const k of cells) { const o = v.doorAt.get(k); if (o && o.id !== except) return 'Здесь уже стоит шлюз'; const p = cellOf(k); if (isGround(p.i, p.k, p.j)) return 'Шлюз не ставится в грунт'; }
 // Part glass, part air: the module would stick out of the wall (or leave half a wall standing beside its chamber).
 const glassIn = wall.filter(k => v.glass.has(k)).length; if (glassIn && glassIn < wall.length) return `Шлюзу нужен ровный участок стены ${width}×2 — наведите на середину стены`;
 if (cells.some(k => !wall.includes(k) && v.glass.has(k))) return 'Перед стеной нужно место под камеру шлюза — уберите стекло';
 const box = moduleBox(d);
 if (overlaps(box, playerBox(g.player.x, g.player.y, g.player.z))) return 'Место занято персонажем';
 if (g.world.base.buildings.some(b => overlaps(box, stationBox(b)))) return 'Место занято станцией';
 const reserved = reservedCells(g, except); if (cells.some(k => reserved.has(k))) return 'Здесь проход другого шлюза';
 const solid = (k: number) => v.glass.has(k) || v.doorAt.has(k), stations = g.world.base.buildings.map(stationBox);
 for (const side of ['front', 'back'] as const) { const p = landingProblem(solid, d, side, stations, null); if (p) return p; }
 for (const side of ['front', 'back'] as const) { const p = landingProblem(solid, d, side, stations, boxes); if (p) return p; }
 return '';
}
/** Rocks, deposits, veins and the capsule (static colliders; stations are 'build-' boxes) meeting a box. `list`: the live
 *  `boxes` of the loaded world, or worldColliders() of a save being migrated. */
const staticHit = (box: number[], list: readonly Box[] = boxes) => list.some(b => !b.id.startsWith('build-') && overlaps(box, [b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ]));
/** Why one landing of a module would block the walk through it ('' = clear): the whole width, both levels. Pure on the
 *  given layout (`solid` cells, station boxes): new modules and the v7 → v8 migration share it. `statics` (a collider
 *  list): only the rock/deposit/capsule check against it; null: the glass, ground and station checks. */
export function landingProblem(solid: (key: number) => boolean, d: Door, side: Side, stations: readonly number[][], statics: readonly Box[] | null): string {
 const land = landingCells(d, side), front = side === 'front', box = moduleBox(d, front ? depthOf(d) : -1, 1);
 if (statics) return staticHit(box, statics) ? front ? 'Перед шлюзом препятствие — поверните шлюз' : 'За шлюзом препятствие — поверните шлюз' : '';
 if (land.some(solid)) return front ? 'Перед шлюзом стекло — освободите проход' : 'За шлюзом стекло — освободите проход';
 if (land.some(k => { const c = cellOf(k); return c.k === d.y && isGround(c.i, c.k, c.j); })) return 'Шлюз упирается в грунт — поставьте его выше';
 if (land.some(k => areaProblem(k))) return 'Шлюзу нужен проход с обеих сторон';
 if (stations.some(b => overlaps(box, b))) return 'У шлюза стоит станция — оставьте проход свободным';
 return '';
}
/** Both landings clear and the module's cells free of stations and of other modules' landings (`reserved`); `colliders`:
 *  the static colliders of the world the module stands in (worldColliders() of the save in the v7 → v8 migration). */
export const doorFits = (solid: (key: number) => boolean, d: Door, stations: readonly number[][], reserved: ReadonlySet<number>, colliders: readonly Box[]) =>
 !doorKeys(d).some(k => reserved.has(k)) && !stations.some(b => overlaps(moduleBox(d), b)) && (['front', 'back'] as const).every(s => !landingProblem(solid, d, s, stations, null) && !landingProblem(solid, d, s, stations, colliders));
/** A standing body (feet at y) meets glass or a module cell (the migrations: a saved player is never left inside). */
export function bodyInSolid(view: RoomsView, x: number, y: number, z: number) {
 const body = playerBox(x, y, z);
 for (let i = Math.floor(body[0]); i < body[1]; i++) for (let j = Math.floor(body[4]); j < body[5]; j++) for (let k = levelAt(body[2]); cellY(k) < body[3]; k++) { const key = cellKey(i, k, j); if (view.glass.has(key) || view.doorAt.has(key)) return true; }
 return false;
}
/** Why a station footprint cannot stand here ('' = it can): glass, doors, airlock landings, a generator inside a room. */
export function stationProblem(g: GameState, kind: string, x: number, y: number, z: number): string {
 const v = roomsView(g.world.base), box = stationBox({ kind, x, y, z }), reserved = reservedCells(g);
 for (let i = Math.floor(box[0]); i < box[1]; i++) for (let j = Math.floor(box[4]); j < box[5]; j++) for (let k = levelAt(box[2]); cellY(k) < box[3]; k++) {
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
/** Builds an airlock module (2 wide) at anchor `key`: glass in its cells returns to the backpack, sealing never breaks. */
export function placeDoor(g: GameState, key: number, rot: number): RoomEdit {
 const problem = doorProblem(g, key, rot); if (problem) return refuse(problem);
 if (countItem(g.player.inventory, 'airlock') < 1) return refuse('В рюкзаке нет: ' + ITEMS.airlock.name);
 const c = cellOf(key), door = newDoor('door-' + g.world.base.nextId, c.i, c.k, c.j, rot), glass = doorKeys(door).filter(k => isGlass(g, k));
 const r = editRooms(g, { remove: glass, door }); if (r.error) return refuse(r.error);
 g.world.base.nextId++; takeOne(g, 'airlock'); if (glass.length) giveBack(g, 'window', glass.length, key);
 return { error: '', needConfirm: false, ventGU: r.vented, breached: r.breached, at: r.at };
}
/** A standing body (feet at y) overlaps a module (it is in the chamber or in one of its doorways). */
export const bodyInModule = (d: Door, x: number, y: number, z: number) => overlaps(moduleBox(d), playerBox(x, y, z));
/** A legacy one-wide module (never crafted) gives back what the S4 airlock cost. */
export const LEGACY_REFUND: Record<string, number> = { iron: 4, glass: 2, fiber: 4 };
/** Takes an airlock module back: both doors closed and nobody inside; asks first when air would leave. The chamber's own
 *  charge (≤ 4 GU) is not room air and leaves with it. */
export function removeDoor(g: GameState, id: string, confirmed = false): RoomEdit {
 const d = doorById(g, id); if (!d) return refuse('Нет такого шлюза');
 if (g.player.vitals.health <= 0) return refuse('Персонаж погиб');
 if (d.outer !== 'closed' || d.inner !== 'closed') return refuse('Сначала закройте обе двери шлюза');
 if (bodyInModule(d, g.player.x, g.player.y, g.player.z)) return refuse('Выйдите из шлюза');
 const key = doorKeys(d)[0]; if (!reach(g, key)) return refuse('Слишком далеко — подойдите ближе');
 const gu = predictRemove(g, key); if (gu > 0 && !confirmed) return refuse(confirmText(gu), true, gu);
 const r = editRooms(g, { undoor: id }); if (r.error) return refuse(r.error);
 if (widthOf(d) === 2) giveBack(g, 'airlock', 1, key); else for (const [item, n] of Object.entries(LEGACY_REFUND)) giveBack(g, item, n, key);
 return { error: '', needConfirm: false, ventGU: r.vented, breached: r.breached, at: r.at };
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
