import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { newGame, sanitizeState, toShiftedLevels, STATE_VERSION, type GameState } from '../src/game/state.ts';
import { heightAt, EYE, type Box } from '../src/world.ts';
import { createWorldInteraction } from '../src/worldInteraction.ts';
import { chunkFaces, createGlassView, joinChunks, TRIM } from '../src/glass.ts';
import {
 around, cellKey, cellOf, cellCenter, cellY, levelAt, columnFloor, isGround, lowestAir, deriveRooms, groundV8, roomsView, bumpRooms, allRooms, groundCell, shellOf, boxCells, bodyInSolid, doorKeys, newDoor, type Door,
} from '../src/game/rooms.ts';

/** S5 (D35): the vertical lattice sits 0.5 m up — level k spans y ∈ [k + 0.5, k + 1.5) — so blocks rest flush on the pad. */
const fresh = () => newGame('w-levels', 7, 1, heightAt(40, 42));
function lay(g: GameState, keys: number[], doors: Door[] = []) { g.world.base.glass = [...new Set([...g.world.base.glass, ...keys])].sort((a, b) => a - b); g.world.base.doors.push(...doors); bumpRooms(g); return roomsView(g.world.base); }
const CUBE = () => shellOf(boxCells(56, 0, 42, 3, 3, 3));
const DOOR: Door = newDoor('door-1', 57, 0, 45, 0);
const ys = (f: { position: Float32Array }) => Array.from(f.position).filter((_, n) => n % 3 === 1);

test('D35: one helper pair converts levels and heights; on the flat 0.5 m pad level 0 rests flush on the ground', () => {
 assert.deepEqual([cellY(0), cellY(-1), cellY(3)], [.5, -.5, 3.5]);
 assert.deepEqual([levelAt(.5), levelAt(1.4999), levelAt(1.5), levelAt(.4999), levelAt(-.5)], [0, 0, 1, -1, -1]);
 for (let k = -3; k < 6; k++) assert.equal(levelAt(cellY(k) + .5), k);
 for (const [i, j] of [[56, 42], [57, 45], [58, 44], [52, 40], [64, 48]]) {
  assert.equal(columnFloor(i, j), .5, `pad column ${i},${j}`);
  assert.ok(Object.is(lowestAir(i, j), 0), 'level 0 (not −0) is the lowest air level on the pad');
  assert.equal(cellY(lowestAir(i, j)), columnFloor(i, j), 'its bottom is the pad surface');
  assert.equal(isGround(i, -1, j), true); assert.equal(isGround(i, 0, j), false);
 }
 assert.deepEqual(cellCenter(cellKey(57, 0, 45)), { x: 57.5, y: 1, z: 45.5 });
});

test('D35: the ground rule follows the raised cell — ground only when all four base corners are above its middle', () => {
 let slopes = 0;
 for (let i = 120; i < 170; i += 3) for (let j = 50; j < 95; j += 3) {
  const c = [heightAt(i, j), heightAt(i + 1, j), heightAt(i, j + 1), heightAt(i + 1, j + 1)], lo = Math.min(...c);
  for (let k = Math.floor(lo) - 3; k <= Math.ceil(lo) + 2; k++) assert.equal(isGround(i, k, j), lo > cellY(k) + .5, `${i},${k},${j}`);
  const a = lowestAir(i, j); assert.equal(isGround(i, a, j), false); assert.equal(isGround(i, a - 1, j), true);
  assert.ok(cellY(a) + .5 >= lo && cellY(a) - .5 < lo, 'the lowest air cell holds the lowest corner in its lower half');
  if (Math.max(...c) - lo > 1) slopes++;
 }
 assert.ok(slopes > 10, 'the sample crosses the hillside');
});

test('D35: a 3-high wall on the pad shows three whole blocks above the ground and an airlock 2 m of clear height', () => {
 const g = fresh(); lay(g, boxCells(55, 0, 45, 5, 3, 1).filter(k => !doorKeys(DOOR).includes(k)), [DOOR]);
 const glass = new Set(g.world.base.glass), doors = new Set(doorKeys(DOOR)), ground = (k: number) => { const c = cellOf(k); return isGround(c.i, c.k, c.j); };
 const f = chunkFaces(glass, k => glass.has(k) || doors.has(k) || ground(k), { ground: isGround, height: heightAt }, { solid: k => glass.has(k) || doors.has(k), door: k => doors.has(k) });
 const pane = ys(f).filter((_, n) => f.trim[n] === 0);
 assert.equal(f.skirts, 0, 'flush on the pad: no skirt to hide a gap');
 assert.equal(Math.min(...pane), .5, 'the panes start on the pad surface (0.5 m)'); assert.equal(Math.max(...pane), 3.5, 'and end three whole metres higher');
 assert.ok(Math.min(...ys(f)) >= .5 - TRIM - 1e-6, 'only the ground-line trim dips its half width into the pad');
 // No pane faces the ground: the old half-sunk bottom faces are gone.
 assert.ok(!Array.from(f.normal).some((v, n) => n % 3 === 1 && v < 0 && f.trim[n / 3 | 0] === 0), 'no downward panes on the ground');
 // The door: threshold on the pad, lintel 2 m above it; collision boxes match the drawn blocks.
 assert.equal(cellY(DOOR.y), heightAt(57.5, 45.5)); assert.equal(cellY(DOOR.y + 2) - cellY(DOOR.y), 2);
 const view = createGlassView(new THREE.Group()); view.sync(g); const out: Box[] = []; view.query(54, 44, 61, 47, out);
 const door = out.filter(b => b.id === 'build-door-1'), low = out.find(b => b.id === 'glass-' + cellKey(56, 0, 45))!, top = out.find(b => b.id === 'glass-' + cellKey(56, 2, 45))!;
 assert.deepEqual(door.map(b => [+b.minY.toFixed(3), +b.maxY.toFixed(3)]).sort((p, q) => p[0] - q[0] || p[1] - q[1]), [[-.1, .54], [-.1, 2.5], [-.1, 2.5], [.5, 2.4], [.5, 2.4], [2.4, 2.5]], 'threshold and jambs reach 0.6 m into the pad, the two leaves stand on it, the lintel tops out 2 m above it'); assert.deepEqual([low.minY, low.maxY], [.5, 1.5]); assert.deepEqual([top.minY, top.maxY], [2.5, 3.5]);
 assert.equal(view.stats().meshes, 1, 'all glass is one mesh'); assert.equal(view.stats().castShadow, false);
 const drawn = view.group.children.find(o => o.name === 'glass') as THREE.Mesh; assert.equal(drawn.castShadow, false); assert.equal((drawn.material as THREE.Material).depthWrite, false);
 // A standing body beside the wall is clear of it; one stepped into it is not.
 assert.equal(bodyInSolid(roomsView(g.world.base), 57.5, .5, 47.5), false, 'in front of the two-deep module'); assert.equal(bodyInSolid(roomsView(g.world.base), 56.5, .5, 45.4), true);
 assert.equal(bodyInSolid(roomsView(g.world.base), 56.5, 3.5, 45.5), false, 'standing on top of the wall (3.5 m)');
});

test('D35: the reticle places the cell it shows — on the pad, on top of a block and against its side', () => {
 const g = fresh(); g.player.inventory[0] = { itemId: 'window', count: 9 }; g.player.hotbar = 0;
 const cam = new THREE.PerspectiveCamera(), w = createWorldInteraction(new THREE.Scene(), cam);
 const look = (x: number, z: number, p: [number, number, number]) => { Object.assign(g.player, { x, y: heightAt(x, z), z }); cam.position.set(x, g.player.y + EYE, z); cam.lookAt(...p); cam.updateMatrixWorld(); w.update(g, true, 0); return w.cell; };
 assert.equal(look(57.5, 49, [57.5, .5, 46.5]), cellKey(57, 0, 46), 'aimed at the pad: level 0');
 lay(g, [cellKey(57, 0, 46)]);
 assert.equal(look(57.5, 49, [57.5, 1.5, 46.4]), cellKey(57, 1, 46), 'aimed at the top face (y 1.5): the cell above');
 // y 1.2 is inside level 0 now (it was level 1 on the old integer lattice): the side face is struck and the new cell is in front of it.
 assert.equal(look(57.5, 49.5, [57.5, 1.2, 47]), cellKey(57, 0, 47)); assert.equal(w.struck?.key, cellKey(57, 0, 46)); assert.deepEqual(w.struck?.normal, [0, 0, 1]);
 // The second row tops out at 2.5 m, above the eyes (2.1 m): its top face is out of sight from the ground, so aiming up at the
 // top 25 cm of its side face stacks the third row on it; lower on that face the block still goes in front.
 lay(g, [cellKey(57, 1, 46)]);
 assert.equal(look(57.5, 48.45, [57.5, 2.4, 47]), cellKey(57, 2, 46), 'top band of a side face above the eyes: on top'); assert.equal(w.struck?.key, cellKey(57, 1, 46));
 assert.equal(look(57.5, 48.45, [57.5, 2.1, 47]), cellKey(57, 1, 47), 'lower on the face: in front');
 assert.equal(look(57.5, 49.5, [57.5, 1.4, 47]), cellKey(57, 0, 47), 'a face whose top is below the eyes (seen from above): in front');
});

test('D35: v8 → v9 keeps the keys; a room with an airlock on the pad keeps its rooms and every milli-GU', () => {
 const g = fresh(); lay(g, CUBE().filter(k => !doorKeys(DOOR).includes(k)), [DOOR]); g.world.base.nextId = 2;
 const room = allRooms(g)[0]; Object.assign(room.zone, { q: 321987, temperature: 18.5, purity: .73, lossRemainder: 412 });
 const raw = JSON.parse(JSON.stringify(g)); raw.meta.stateVersion = 8;
 const m = sanitizeState(raw); assert.equal(m.meta.stateVersion, STATE_VERSION); assert.equal(STATE_VERSION, 10);
 assert.deepEqual(m.world.base.glass, g.world.base.glass); assert.deepEqual(m.world.base.doors, g.world.base.doors);
 assert.deepEqual(m.world.base.zones, g.world.base.zones, 'the zone is kept exactly (q, T, purity, loss remainder)');
 assert.deepEqual(allRooms(m).map(r => [r.cell, r.volume, r.zone.q]), [[room.cell, 27, 321987]]);
 const again = toShiftedLevels(JSON.parse(JSON.stringify(m))); assert.deepEqual((again.world as any).base, JSON.parse(JSON.stringify(m.world.base)), 'a v9 save is never shifted again');
 const newer = JSON.parse(JSON.stringify(raw)); newer.meta.stateVersion = 11; assert.equal((toShiftedLevels(newer).meta as any).stateVersion, 11, 'the version is never lowered');
 // A player standing on the roof (old top y 4) rises with it; one on the floor inside stays.
 const roof = JSON.parse(JSON.stringify(raw)); Object.assign(roof.player, { x: 57.5, y: 4, z: 43.5 }); assert.equal((toShiftedLevels(roof).player as any).y, 4.5);
 const floor = JSON.parse(JSON.stringify(raw)); Object.assign(floor.player, { x: 57.5, y: .5, z: 43.5 }); assert.equal((toShiftedLevels(floor).player as any).y, .5);
});

/** A v8 layout built by the old rules: a 3×3×3 interior from each column's old lowest air level, its shell by groundV8. */
function oldBox(i0: number, j0: number) {
 const interior: number[] = []; for (let i = i0; i < i0 + 3; i++) for (let j = j0; j < j0 + 3; j++) { const k0 = Math.ceil(columnFloor(i, j) - .5); for (let k = k0; k < k0 + 3; k++) interior.push(cellKey(i, k, j)); }
 const inside = new Set(interior), shell = new Set<number>(); for (const c of inside) for (const n of around(c)) if (!inside.has(n) && !groundV8(n)) shell.add(n);
 return [...shell].sort((a, b) => a - b);
}
test('D35: the shift carries each zone by cell overlap — never lost on the pad, lost on a slope only where cells became outside', () => {
 const base = JSON.parse(JSON.stringify(fresh())); base.meta.stateVersion = 8;
 const migrate = (glass: number[]) => {
  const before = deriveRooms(glass, [], groundV8); if (before.rooms.length !== 1) return null;
  const r = structuredClone(base); r.world.base.glass = glass; r.world.base.zones = [{ cell: before.rooms[0].cell, q: 100000, temperature: 20, purity: .8, lossRemainder: 0 }];
  const out = toShiftedLevels(r) as any, after = deriveRooms(glass, []); return { before: before.rooms[0], after, zones: out.world.base.zones as { cell: number; q: number }[] };
 };
 let pad = 0;
 for (let i0 = 47; i0 <= 66; i0++) for (let j0 = 33; j0 <= 52; j0++) {
  let flat = true; for (let i = i0 - 1; i <= i0 + 3; i++) for (let j = j0 - 1; j <= j0 + 3; j++) if (columnFloor(i, j) !== .5) flat = false;
  if (!flat) continue; const m = migrate(oldBox(i0, j0))!; pad++;
  assert.deepEqual(m.after.rooms.map(r => r.cells.slice().sort()), [m.before.cells.slice().sort()], 'the same room');
  assert.deepEqual(m.zones.map(z => [z.cell, z.q]), [[m.before.cell, 100000]], 'every milli-GU stays');
 }
 assert.ok(pad >= 30, `pad boxes checked: ${pad}`);
 // Slopes: the gas that stays is exactly the share of old cells inside a new room; nothing is created.
 let changed = 0, slopes = 0;
 for (let i0 = 120; i0 < 170; i0 += 2) for (let j0 = 50; j0 < 95; j0 += 2) {
  const m = migrate(oldBox(i0, j0)); if (!m) continue; slopes++;
  const kept = m.before.cells.filter(c => (m.after.tag.get(c) ?? -1) >= 0).length, total = m.zones.reduce((a, z) => a + z.q, 0);
  assert.ok(total <= 100000);
  if (kept === m.before.volume) assert.equal(total, 100000, 'all old cells in rooms: nothing leaves'); else { changed++; assert.ok(total <= Math.ceil(100000 * kept / m.before.volume), 'only the share of cells that became outside leaves'); }
  for (const z of m.zones) assert.ok(m.after.rooms.some(r => r.cell === z.cell), 'zones belong to rooms of the new layout');
 }
 assert.ok(slopes > 50, `slope boxes checked: ${slopes}`); assert.ok(changed > 0, 'some slope boxes open after the shift (cells under them became air)');
});

test('D35: frameless glass — no line between blocks of one wall or along inner corners; trim on outer edges, the ground line and around an airlock', () => {
 const key = cellKey, set = (c: [number, number, number][]) => new Set(c.map(v => key(...v)));
 const trims = (s: Set<number>, door = new Set<number>(), extra = new Set<number>()): ReturnType<typeof chunkFaces> => chunkFaces(s, k => s.has(k) || door.has(k) || extra.has(k), undefined, { solid: k => s.has(k) || door.has(k), door: k => door.has(k) });
 assert.equal(trims(set([[0, 0, 0]])).trims, 12, 'a lone block: its 12 edges');
 assert.equal(trims(set([[0, 0, 0], [1, 0, 0]])).trims, 16, 'two blocks read as one 2 m pane: no line between them (two cubes would make 20)');
 const wall: [number, number, number][] = []; for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) wall.push([i, k, 0]);
 assert.equal(trims(set(wall)).trims, 28, 'a 3×3 wall: only the box edges of its slab');
 // Beside a door the edge gets a frame; beside glass it does not.
 assert.equal(trims(set([[0, 0, 0]]), set([[1, 0, 0]])).trims, 12); assert.equal(chunkFaces(set([[0, 0, 0]]), k => k === key(0, 0, 0) || k === key(1, 0, 0), undefined, { solid: k => k === key(0, 0, 0) || k === key(1, 0, 0), door: () => false }).trims, 8);
 // An L of three blocks: its outer corner (x = 2, z = 0) is trimmed, its inner corner (x = 1, z = 1) is not.
 const L = trims(set([[0, 0, 0], [1, 0, 0], [1, 0, 1]])), bars: number[][] = [];
 // Panes are 4 vertices, bars 16 (four sides), in build order.
 for (let v = 0; v < L.trim.length; v += L.trim[v] ? 16 : 4) if (L.trim[v]) { const c = [0, 0, 0]; for (let n = 0; n < 16; n++) for (let a = 0; a < 3; a++) c[a] += L.position[(v + n) * 3 + a] / 16; bars.push(c); }
 const vertical = (x: number, z: number) => bars.some(c => Math.abs(c[0] - x) < 1e-6 && Math.abs(c[2] - z) < 1e-6 && Math.abs(c[1] - cellY(0) - .5) < 1e-6);
 assert.ok(vertical(2, 0), 'outer corner'); assert.ok(!vertical(1, 1), 'no line along the inner corner'); assert.equal(bars.length, L.trims);
 // Ground: faces against ground cells are not drawn, and the line where the block meets them is trimmed.
 const one = set([[0, 0, 0]]), ground = set([[0, -1, 0]]), g = trims(one, new Set(), ground); assert.equal(g.faces, 5); assert.equal(g.trims, 12);
 // One geometry for many chunks: indices are offset and the triangles are kept.
 const a = trims(set([[0, 0, 0]])), b = trims(set([[40, 0, 0]])), j = joinChunks([a, b]);
 assert.equal(j.index!.count, a.index.length + b.index.length); assert.equal(j.attributes.position.count, (a.position.length + b.position.length) / 3); assert.equal(Math.max(...Array.from(j.index!.array)), j.attributes.position.count - 1); assert.equal(j.attributes.trim.count, j.attributes.position.count);
});
