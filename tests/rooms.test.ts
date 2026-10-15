import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, cloneState, sanitizeState, STATE_VERSION, type GameState } from '../src/game/state.ts';
import { addItems, countItem, emptyInventory } from '../src/game/inventory.ts';
import { makeBuilding, productionTick, connect, startJob } from '../src/game/production.ts';
import { heightAt } from '../src/world.ts';
import { placementProblem } from '../src/buildings.ts';
import { survivalTick } from '../src/game/survival.ts';
import { stationStatus, roomStatus, structureStatus } from '../src/game/stationStatus.ts';
import { refreshQuestProgress } from '../src/game/quests.ts';
import {
 cellKey, cellOf, columnFloor, isGround, lowestAir, deriveRooms, roomsView, bumpRooms, allRooms, roomAt, roomAtCell, editRooms, predictRemove, leakAt,
 placeGlass, removeGlass, placeDoor, removeDoor, beginPassage, landingPoint, doorById, stationRoom, habitableRoom, breathingRoom, cyclingRoom,
 GLASS_LIMIT, DOOR_LIMIT, ROOM_LIMIT, shellOf, boxCells, groundRoom, type Door,
} from '../src/game/rooms.ts';

const fresh = () => newGame('w-rooms', 7, 1, heightAt(40, 42));
/** Glass around an interior box: every face neighbour that is not interior and not ground (the ground is the floor). */
const shell = (x0: number, k0: number, z0: number, w: number, h: number, d: number) => shellOf(boxCells(x0, k0, z0, w, h, d)), box = boxCells;
/** Sets the layout directly (test setup), then lets the cached rooms rebuild. */
function lay(g: GameState, keys: number[], doors: Door[] = []) { g.world.base.glass = [...new Set([...g.world.base.glass, ...keys])].sort((a, b) => a - b); g.world.base.doors.push(...doors); bumpRooms(g); return roomsView(g.world.base); }
const near = (g: GameState, x: number, z: number) => Object.assign(g.player, { x, y: heightAt(x, z), z });
const stock = (g: GameState, items: Record<string, number>) => { for (const [id, n] of Object.entries(items)) assert.equal(addItems(g.player.inventory, id, n), 0); };
const tick = (g: GameState, ms: number, outside = 10) => { let last = null; for (let n = 0; n < ms; n += 50) last = productionTick(g, 50, null, outside).passage ?? last; return last; };
/** The base pad: flat at y = 0.5, its lowest air level is k = 0 (the ground cell below is k = −1). */
const CUBE = () => shell(56, 0, 42, 3, 3, 3);

test('Rooms: the honest ground rule on a slope — a cell is ground only when all four base corners are above its middle', () => {
 let found = false;
 for (let i = 130; i < 160 && !found; i++) for (let j = 50; j < 95 && !found; j++) {
  const c = [heightAt(i, j), heightAt(i + 1, j), heightAt(i, j + 1), heightAt(i + 1, j + 1)], lo = Math.min(...c), hi = Math.max(...c);
  if (hi - lo < 1.2) continue; found = true;
  assert.equal(columnFloor(i, j), lo);
  for (let k = Math.floor(lo) - 2; k <= Math.ceil(hi) + 1; k++) assert.equal(isGround(i, k, j), lo > k + .5, `k ${k}`);
  const buried = Math.ceil(lo - .5); assert.ok(buried + .5 < hi, 'the lowest air cell is partly under the slope') ; assert.equal(isGround(i, buried, j), false); assert.equal(isGround(i, buried - 1, j), true); assert.equal(lowestAir(i, j), buried);
 }
 assert.ok(found, 'a steep column exists on the east hillside');
 // Air under a wall leaks: a pillar whose interior starts one level above the ground has open air below it.
 const g = fresh(), k = lowestAir(60, 40), v = lay(g, shell(60, k + 1, 40, 1, 3, 1).filter(key => cellOf(key).k > k));
 assert.equal(v.rooms.length, 0); const leak = structureStatus(g, cellKey(60, k + 4, 40)); assert.equal(leak.title, 'Утечка'); assert.ok(leak.leak.length >= 2);
 lay(g, [cellKey(60, k, 41), cellKey(60, k, 39), cellKey(61, k, 40), cellKey(59, k, 40)]); assert.equal(allRooms(g)[0].volume, 4, 'closing the gap under the walls seals the pillar down to the ground');
});

test('Rooms: a pillar, a cube and a tunnel are airtight; a hole in any face opens them; edges and corners pass no gas', () => {
 const g = fresh();
 assert.deepEqual(deriveRooms(shell(60, 0, 40, 1, 3, 1), []).rooms.map(r => r.volume), [3]);
 assert.deepEqual(deriveRooms(CUBE(), []).rooms.map(r => r.volume), [27]);
 const tunnel = deriveRooms(shell(-120, 60, -120, 8, 2, 1), []); assert.deepEqual(tunnel.rooms.map(r => r.volume), [16], 'a raised tunnel with a glass floor');
 const cube = CUBE(); assert.equal(cube.length, 45);
 for (const hole of cube) assert.equal(deriveRooms(cube.filter(k => k !== hole), []).rooms.length, 0, 'hole at ' + JSON.stringify(cellOf(hole)));
 // Two one-cell rooms that only share an edge stay two rooms: gas never passes edges or corners.
 const a = shell(60, 0, 40, 1, 1, 1), b = shell(61, 0, 41, 1, 1, 1), both = deriveRooms([...new Set([...a, ...b])], []);
 assert.deepEqual(both.rooms.map(r => r.volume), [1, 1]);
 const corner = deriveRooms([...new Set([...shell(-100, 60, -100, 1, 1, 1), ...shell(-99, 61, -99, 1, 1, 1)])], []); assert.deepEqual(corner.rooms.map(r => r.volume), [1, 1]);
 // The room of a point: the player is looked up by the chest cell.
 lay(g, CUBE()); near(g, 57.5, 43.5); assert.equal(roomAt(g, 57.5, g.player.y + 1, 43.5)?.volume, 27); assert.equal(roomAt(g, 57.5, 3.5, 43.5), null);
});

test('Rooms: a closed volume over 1024 m³ is not a room ("too big"), 1000 m³ is', () => {
 const g = fresh();
 assert.deepEqual(deriveRooms(shell(-150, 40, -150, 10, 10, 10), []).rooms.map(r => r.volume), [1000]);
 lay(g, shell(-150, 40, -150, 11, 10, 10)); assert.equal(allRooms(g).length, 0);
 const why = structureStatus(g, cellKey(-151, 45, -145)); assert.equal(why.title, 'Слишком большой объём'); assert.equal(leakAt(g, cellKey(-151, 45, -145))?.kind, 'big');
});

test('Rooms: a split shares the gas by volume, a merge sums it; nothing is created or lost on rounding', () => {
 const g = fresh(); lay(g, shell(56, 0, 42, 4, 3, 3)); const [room] = allRooms(g); assert.equal(room.volume, 36);
 Object.assign(room.zone, { q: 100000, temperature: 20, purity: .9 });
 const slab = box(57, 0, 42, 1, 3, 3), split = editRooms(g, { add: slab }, -10);
 assert.equal(split.error, ''); assert.equal(split.vented, 0); assert.equal(split.breached, false);
 const [left, right] = [roomAt(g, 56.5, 1.5, 43.5)!, roomAt(g, 58.5, 1.5, 43.5)!];
 assert.deepEqual([left.volume, right.volume], [9, 18]);
 assert.equal(left.zone.q, 33333); assert.equal(right.zone.q, 66667, 'the rounding remainder goes to the largest overlap');
 assert.equal(left.zone.q + right.zone.q, 100000); assert.equal(left.zone.temperature, 20); assert.equal(right.zone.purity, .9);
 right.zone.temperature = 10; right.zone.purity = .6;
 const merge = editRooms(g, { remove: [cellKey(57, 1, 43)] }, -10), [one] = allRooms(g);
 assert.equal(merge.vented, 0); assert.equal(one.volume, 28); assert.equal(one.zone.q, 100000);
 assert.ok(Math.abs(one.zone.temperature - (9 * 20 + 18 * 10 - 10) / 28) < 1e-9, 'volume-weighted T; the freed cell brings the outside T');
 assert.ok(Math.abs(one.zone.purity - (9 * .9 + 18 * .6) / 28) < 1e-9);
 // Glass placed into a room squeezes it: the gas over 20 GU/m³ is vented.
 one.zone.q = 20000 * 28; const squeeze = editRooms(g, { add: [cellKey(59, 1, 43)] });
 assert.equal(allRooms(g)[0].zone.q, 20000 * 27); assert.equal(squeeze.vented, 20);
 assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(g))), g);
});

test('Rooms: a breach empties only the opened part; expanding behind a second wall keeps every unit of air', () => {
 const g = fresh(); lay(g, shell(56, 0, 42, 4, 3, 3)); editRooms(g, { add: box(57, 0, 42, 1, 3, 3) });
 const left = roomAt(g, 56.5, 1.5, 43.5)!, right = roomAt(g, 58.5, 1.5, 43.5)!; left.zone.q = 70001; right.zone.q = 90000;
 near(g, 53, 43); const outer = cellKey(55, 1, 43), before = structuredClone(g);
 assert.equal(predictRemove(g, outer), 70.001); assert.deepEqual(g, before, 'prediction changes nothing');
 const ask = removeGlass(g, outer); assert.equal(ask.needConfirm, true); assert.match(ask.error, /Воздух уйдёт: 71 GU/); assert.deepEqual(g, before);
 const done = removeGlass(g, outer, true); assert.equal(done.error, ''); assert.equal(done.ventGU, 70.001); assert.equal(done.breached, true); assert.deepEqual(done.at, { x: 55.5, y: 1.5, z: 43.5 });
 assert.equal(roomAt(g, 56.5, 1.5, 43.5), null); assert.equal(roomAt(g, 58.5, 1.5, 43.5)!.zone.q, 90000); assert.equal(countItem(g.player.inventory, 'window'), 1);
 assert.equal(structureStatus(g, cellKey(55, 2, 43)).title, 'Утечка'); assert.deepEqual(cellOf(leakAt(g, cellKey(55, 2, 43))!.path.at(-1)!).i <= 55, true);
 // Expansion: the new shell is built outside first (a new, empty room), then the wall between them goes.
 const h = fresh(); lay(h, CUBE()); const a = allRooms(h)[0]; a.zone.q = 200000;
 const grow = editRooms(h, { add: shell(60, 0, 42, 3, 3, 3).filter(k => !h.world.base.glass.includes(k)) });
 assert.equal(grow.vented, 0); assert.deepEqual(allRooms(h).map(r => [r.volume, r.zone.q]).sort(), [[27, 0], [27, 200000]]);
 assert.equal(predictRemove(h, cellKey(59, 1, 43)), 0, 'removing the shared wall vents nothing');
 const merged = editRooms(h, { remove: [cellKey(59, 1, 43)] }); assert.equal(merged.vented, 0); assert.deepEqual(allRooms(h).map(r => [r.volume, r.zone.q]), [[55, 200000]]);
});

test('Rooms: placing and removing glass — every refusal has a reason and changes nothing', () => {
 const g = fresh(); near(g, 54, 47); stock(g, { window: 8 });
 const station = makeBuilding(g, 'workbench', 57, .62, 45);
 const tries: [number, RegExp][] = [
  [cellKey(57, -1, 44), /В грунт/], [cellKey(54, 0, 47), /персонажем/], [cellKey(57, 1, 45), /станцией/], [cellKey(40, 0, 44), /капсулы/], [cellKey(100, 0, 132), /водоём/],
  [cellKey(400, 0, 0), /границей/], [cellKey(70, 0, 60), /далеко/], [cellKey(56, 0, 47), /^$/],
 ];
 for (const [key, why] of tries) { const before = structuredClone(g), r = placeGlass(g, key); if (why.source === '^$') { assert.equal(r.error, ''); continue; } assert.match(r.error, why); assert.deepEqual(g, before); }
 assert.equal(countItem(g.player.inventory, 'window'), 7); assert.deepEqual(g.world.base.glass, [cellKey(56, 0, 47)]);
 assert.match(placeGlass(g, cellKey(56, 0, 47)).error, /занята/);
 g.player.inventory = emptyInventory(); const empty = structuredClone(g); assert.match(placeGlass(g, cellKey(56, 1, 47)).error, /нет: Стеклоблок/); assert.deepEqual(g, empty);
 // A full backpack sends the removed block to the ground.
 g.player.inventory = Array.from({ length: 24 }, () => ({ itemId: 'stone', count: 64 }));
 assert.equal(removeGlass(g, cellKey(56, 0, 47)).error, ''); assert.equal(g.world.drops.at(-1)!.items[0].itemId, 'window');
 assert.match(removeGlass(g, cellKey(56, 0, 47)).error, /нет стеклоблока/);
 void station;
});

test('Rooms: an airlock replaces wall glass without breaking the seal; its landings stay free; taking it out asks first', () => {
 const g = fresh(); lay(g, CUBE()); const room = allRooms(g)[0]; room.zone.q = 300000; near(g, 54, 47); stock(g, { airlock: 1, window: 2 });
 const at = cellKey(57, 0, 45), before = structuredClone(g);
 assert.match(placeDoor(g, cellKey(57, 2, 45), 0).error, /стекло/, 'its back landing would be the wall above'); assert.deepEqual(g, before);
 const r = placeDoor(g, at, 0); assert.equal(r.error, ''); assert.equal(r.ventGU, 0);
 assert.equal(g.world.base.glass.length, 43); assert.equal(countItem(g.player.inventory, 'window'), 4); assert.equal(countItem(g.player.inventory, 'airlock'), 0);
 const door = g.world.base.doors[0]; assert.deepEqual({ ...door, id: '' }, { id: '', x: 57, y: 0, z: 45, rot: 0 }); assert.equal(allRooms(g)[0].zone.q, 300000, 'sealing never broke');
 refreshQuestProgress(g); assert.ok(g.progress.quests.completed.includes('dome'), 'a room with an airlock is the shelter');
 assert.match(placeGlass(g, cellKey(57, 0, 46)).error, /посадка шлюза/); assert.match(placeGlass(g, cellKey(57, 1, 44)).error, /посадка шлюза/);
 assert.match(placementProblem(g, 'refill', 58, 47), /шлюза/); assert.match(placementProblem(g, 'biogenerator', 57, 43), /выхлоп/);
 // Removing the airlock opens the room: confirm first.
 near(g, 54, 47); const ask = removeDoor(g, door.id); assert.equal(ask.needConfirm, true); assert.equal(ask.ventGU, 300);
 const out = removeDoor(g, door.id, true); assert.equal(out.error, ''); assert.equal(allRooms(g).length, 0); assert.equal(countItem(g.player.inventory, 'airlock'), 1);
});

test('Rooms: the airlock cycle — in needs the full 4 GU and locks breathing, out is always possible, landings follow the ground', () => {
 const g = fresh(); lay(g, CUBE().filter(k => k !== cellKey(57, 0, 45) && k !== cellKey(57, 1, 45)), [{ id: 'door-1', x: 57, y: 0, z: 45, rot: 0 }]); g.world.base.nextId = 2;
 const room = allRooms(g)[0], door = doorById(g, 'door-1')!; assert.equal(room.volume, 27);
 near(g, 57.5, 49); assert.match(beginPassage(g, 'door-1'), /меньше 4 GU/); assert.equal(g.world.base.passage, null);
 near(g, 57.5, 50.5); room.zone.q = 8000; assert.match(beginPassage(g, 'door-1'), /Подойдите/);
 near(g, 57.5, 49); assert.equal(beginPassage(g, 'door-1'), ''); assert.equal(allRooms(g)[0].zone.q, 4000);
 assert.deepEqual(g.world.base.passage, { doorId: 'door-1', direction: 'in', remainingMs: 6000, paid: true });
 assert.equal(cyclingRoom(g)?.volume, 27); assert.match(beginPassage(g, 'door-1'), /занят/);
 g.player.bottles = [null, null]; for (let i = 0; i < 100; i++) survivalTick(g, .05, false); assert.equal(g.player.survival.suffocationMs, 0, 'the paid 4 GU carry the cycle');
 const copy = sanitizeState(JSON.parse(JSON.stringify(g))); assert.deepEqual(copy, g, 'a cycle survives a save');
 const inside = tick(g, 6000)!; assert.deepEqual(inside, landingPoint(g, door, 'back')); assert.equal(inside.x, 57.5); assert.equal(inside.z, 44.5); assert.equal(inside.y, heightAt(57.5, 44.5));
 Object.assign(g.player, inside); assert.equal(roomAt(g, inside.x, inside.y + 1, inside.z)?.volume, 27);
 // Leaving an empty room is always possible; the player lands on the terrain outside.
 allRooms(g)[0].zone.q = 0; assert.equal(beginPassage(g, 'door-1'), ''); assert.equal(g.world.base.passage!.direction, 'out'); assert.equal(cyclingRoom(g), null);
 const outside = tick(g, 6000)!; assert.deepEqual(outside, { x: 57.5, y: heightAt(57.5, 45.5 + 1), z: 46.5 });
 // Off the pad the landing follows the ground under it.
 const h = fresh(); lay(h, [], [{ id: 'door-1', x: 140, y: lowestAir(140, 70) + 1, z: 70, rot: 1 }]); h.world.base.nextId = 2; bumpRooms(h);
 const d = doorById(h, 'door-1')!, back = landingPoint(h, d, 'back'), front = landingPoint(h, d, 'front');
 assert.equal(back.y, heightAt(139.5, 70.5)); assert.equal(front.y, heightAt(141.5, 70.5)); assert.notEqual(back.y, front.y);
 // A door with no room on either side is a plain doorway: free and instant.
 near(h, front.x, front.z + .5); assert.equal(beginPassage(h, 'door-1'), ''); assert.equal(h.world.base.passage!.remainingMs, 0); assert.deepEqual(tick(h, 50), back);
});

test('Rooms: an inner door charges 4 GU from the destination when it has them; otherwise it is free', () => {
 const g = fresh(); lay(g, [...new Set([...shell(56, 0, 42, 3, 3, 3), ...shell(60, 0, 42, 3, 3, 3)])].filter(k => k !== cellKey(59, 0, 43) && k !== cellKey(59, 1, 43)), [{ id: 'door-1', x: 59, y: 0, z: 43, rot: 1 }]); g.world.base.nextId = 2; bumpRooms(g);
 const a = roomAt(g, 57.5, 1.5, 43.5)!, b = roomAt(g, 61.5, 1.5, 43.5)!; a.zone.q = 100000; b.zone.q = 3000;
 near(g, 57.5, 43.5); assert.equal(beginPassage(g, 'door-1'), ''); assert.deepEqual(g.world.base.passage, { doorId: 'door-1', direction: 'out', remainingMs: 6000, paid: false });
 assert.equal(roomAt(g, 61.5, 1.5, 43.5)!.zone.q, 3000); const there = tick(g, 6000)!; assert.deepEqual([there.x, there.z], [60.5, 43.5]);
 Object.assign(g.player, there); roomAt(g, 57.5, 1.5, 43.5)!.zone.q = 100000;
 assert.equal(beginPassage(g, 'door-1'), ''); assert.equal(roomAt(g, 57.5, 1.5, 43.5)!.zone.q, 96000); assert.equal(g.world.base.passage!.paid, true); assert.equal(cyclingRoom(g)?.volume, 27);
 assert.deepEqual([tick(g, 6000)!.x, b.volume], [58.5, 27]);
});

test('Rooms: a distributor fills only a room it stands in; one serves 256 m³; a generator never burns in a room', () => {
 const g = fresh(); near(g, 50, 47); lay(g, shell(56, 0, 40, 9, 5, 6)); const room = allRooms(g)[0]; assert.equal(room.volume, 270);
 const gen = makeBuilding(g, 'biogenerator', 52, .62, 44), d1 = makeBuilding(g, 'distributor', 60, .62, 42); gen.energy = 1000000; d1.oxygen = 480000;
 stock(g, { cable: 6 }); assert.equal(connect(g, 'cable', gen.id, d1.id), '');
 assert.equal(stationRoom(g, d1)?.volume, 270); tick(g, 2000); assert.equal(allRooms(g)[0].zone.q, 0, 'one distributor for 270 m³ does not fill');
 assert.equal(stationStatus(g, d1).title, 'Нужен ещё распределитель'); assert.match(roomStatus(g, allRooms(g)[0]).checks![1].label, /1 из 2/);
 const d2 = makeBuilding(g, 'distributor', 62, .62, 43); d2.oxygen = 480000; assert.equal(connect(g, 'cable', gen.id, d2.id), '');
 tick(g, 1000); const q = allRooms(g)[0].zone.q; assert.ok(q > 30000, String(q)); assert.ok(allRooms(g)[0].zone.purity > 0);
 // Outside a room a distributor asks for no power and fills nothing.
 const h = fresh(), lone = makeBuilding(h, 'distributor', 60, .62, 42); lone.oxygen = 480000; tick(h, 1000); assert.equal(lone.oxygen, 480000); assert.equal(stationStatus(h, lone).title, 'Вне помещения');
 // A room built around a burning generator stops its fire; placing one inside is refused.
 const k = fresh(), fire = makeBuilding(k, 'biogenerator', 57, .62, 43); fire.input[0] = { itemId: 'fiber', count: 5 }; tick(k, 1000); assert.ok(fire.energy > 0);
 lay(k, CUBE()); const e = fire.energy; tick(k, 1000); assert.equal(fire.energy, e); assert.equal(countItem(fire.input, 'fiber'), 4); assert.equal(stationStatus(k, fire).title, 'Внутри помещения');
 near(k, 54, 47); k.world.base.buildings = []; assert.match(placementProblem(k, 'biogenerator', 57, 43), /выхлоп/); assert.equal(placementProblem(k, 'distributor', 57, 43), '');
 // Leak 0.002·V GU/s, habitability at 8 GU/m³.
 const z = allRooms(k)[0]; Object.assign(z.zone, { q: 216000, purity: .5, temperature: 20 }); assert.equal(habitableRoom(allRooms(k)[0]), true); near(k, 57.5, 43.5); assert.equal(breathingRoom(k)?.volume, 27);
 tick(k, 1000); assert.equal(allRooms(k)[0].zone.q, 216000 - 54, 'technical leak 0.054 GU/s for 27 m³'); assert.equal(habitableRoom(allRooms(k)[0]), false);
});

test('Rooms: limits — 8192 glass blocks, 32 airlocks, 64 rooms', () => {
 const g = fresh(), plane: number[] = []; for (let i = 0; i < 91 && plane.length < GLASS_LIMIT; i++) for (let j = 0; j < 91 && plane.length < GLASS_LIMIT; j++) plane.push(cellKey(-100 + i, 80, -100 + j));
 lay(g, plane); Object.assign(g.player, { x: -60, y: 78.5, z: -60 }); stock(g, { window: 1, airlock: 1 });
 assert.match(placeGlass(g, cellKey(-60, 82, -58)).error, /8192/);
 const doors: Door[] = Array.from({ length: DOOR_LIMIT }, (_, n) => ({ id: 'door-' + (n + 1), x: -150 + n * 3, y: 40, z: -150, rot: 0 }));
 const h = fresh(); lay(h, [], doors); h.world.base.nextId = 100; Object.assign(h.player, { x: -60, y: 39, z: -150 });
 assert.match(placeDoor(h, cellKey(-60, 40, -146), 0).error, /32 шлюзов/);
 // A row of one-cell rooms high above the ground (glass floor and roof), then one more.
 const k = fresh(), row: number[] = []; for (let n = 0; n < ROOM_LIMIT; n++) row.push(...shell(-180 + n * 2, 60, -120, 1, 1, 1));
 lay(k, row); assert.equal(allRooms(k).length, ROOM_LIMIT);
 const before = structuredClone(k.world.base), more = editRooms(k, { add: shell(-180 + ROOM_LIMIT * 2, 60, -120, 1, 1, 1) });
 assert.match(more.error, /64 помещений/); assert.deepEqual(k.world.base, before);
 assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(k))), k);
});

test('Save v8: strict glass, doors and zones; a vanished room drops its gas; too much air or overlaps fail', () => {
 const g = fresh(); lay(g, CUBE()); allRooms(g)[0].zone.q = 400000; g.world.base.doors.push({ id: 'door-1', x: 70, y: 0, z: 50, rot: 2 }); g.world.base.nextId = 2; bumpRooms(g);
 const ok = sanitizeState(JSON.parse(JSON.stringify(g))); assert.deepEqual(ok, g); assert.equal(ok.meta.stateVersion, STATE_VERSION);
 const bad = (patch: (s: any) => void, why: RegExp) => { const s: any = JSON.parse(JSON.stringify(g)); patch(s); assert.throws(() => sanitizeState(s), why); };
 bad(s => s.world.base.glass.push(s.world.base.glass[0]), /glass/);
 bad(s => s.world.base.glass.reverse(), /glass/);
 bad(s => { s.world.base.glass = [...s.world.base.glass, cellKey(400, 0, 0)]; }, /glass/);
 bad(s => { s.world.base.doors[0].x = 57; s.world.base.doors[0].z = 45; }, /шлюз/);
 bad(s => { s.world.base.doors[0].id = 'door-2'; }, /nextId/);
 bad(s => { s.world.base.zones[0].q = 27 * 20000 + 1; }, /вместимости/);
 bad(s => { s.world.base.passage = { doorId: 'door-9', direction: 'in', remainingMs: 10, paid: true }; }, /шлюз/);
 bad(s => { s.world.base.glass = Array(GLASS_LIMIT + 1).fill(0); }, /glass/);
 const gone: any = JSON.parse(JSON.stringify(g)); gone.world.base.glass = gone.world.base.glass.slice(1);
 const loaded = sanitizeState(gone); assert.deepEqual(loaded.world.base.zones, [], 'the opened room lost its air; no error');
 const fresh2: any = JSON.parse(JSON.stringify(g)); fresh2.world.base.zones = []; assert.deepEqual(sanitizeState(fresh2).world.base.zones.map((z: any) => z.q), [0]);
});

/** A v7 save as S3 wrote it: a dome (80-face shell, zone), its passage and packed bodies with zones. */
function v7(g: GameState, dome: { x: number; z: number; rot: number; q: number }) {
 const old: any = JSON.parse(JSON.stringify(g)); old.meta.stateVersion = 7;
 const zone = (q: number) => ({ q, temperature: 18, purity: .8, lossRemainder: 5, breachMs: 0, shell: Array(80).fill(180) });
 const body = (id: string, kind: string, x: number, y: number, z: number, rot = 0) => ({ id, kind, level: 1, rot, x, y, z, input: [null, null, null, null], output: [null, null, null, null], job: null, queue: [], enabled: true, lowPriority: false, energy: 0, fuel: 0, water: 0, oxygen: 0, zone: zone(0) });
 const b = old.world.base; delete b.glass; delete b.doors; delete b.zones;
 b.buildings = [{ ...body('build-1', 'dome', dome.x, .62, dome.z, dome.rot), zone: zone(dome.q) }, body('build-2', 'distributor', dome.x - 1, .62, dome.z), body('build-3', 'workbench', dome.x - 6, .62, dome.z)];
 b.nextId = 4; b.passage = null;
 const strip = ({ id, x, y, z, ...rest }: any) => (void [id, x, y, z], rest);
 old.player.inventory[3] = { itemId: 'dome', count: 1, packed: { ...strip(body('x', 'dome', 0, 0, 0)), zone: zone(300000) } };
 old.player.inventory[4] = { itemId: 'workbench', count: 1, packed: strip(body('x', 'workbench', 0, 0, 0)) };
 return old;
}

test('Save v7 → v8: a dome becomes a 4×4×3 glass room with its air, airlock (turned), stations and the packed dome as an item', () => {
 const g = fresh(); g.progress.quests.facts.push('item:dome', 'craft:craft_dome');
 const old = v7(g, { x: 58, z: 44, rot: 1, q: 500000 }), m = sanitizeState(old);
 assert.equal(m.meta.stateVersion, STATE_VERSION); assert.equal(old.meta.stateVersion, 7);
 assert.deepEqual(m.world.base.buildings.map(b => b.kind), ['distributor', 'workbench']); assert.ok(m.world.base.buildings.every(b => !('zone' in b)));
 const rooms = allRooms(m); assert.equal(rooms.length, 1); assert.equal(rooms[0].volume, 48);
 assert.deepEqual(rooms[0].zone, { cell: cellKey(56, 0, 42), q: 500000, temperature: 18, purity: .8, lossRemainder: 5 });
 // Shell: 48 wall + 16 roof + 12 corner blocks, two of them replaced by the airlock in the middle of the old +x front.
 assert.equal(m.world.base.glass.length, 74); assert.deepEqual(m.world.base.doors, [{ id: 'door-4', x: 60, y: 0, z: 44, rot: 1 }]); assert.equal(m.world.base.nextId, 5);
 assert.equal(stationRoom(m, m.world.base.buildings[0])?.volume, 48, 'the distributor stays inside'); assert.equal(stationRoom(m, m.world.base.buildings[1]), null);
 assert.deepEqual(m.player.inventory[3], { itemId: 'dome', count: 1 }); assert.equal('zone' in m.player.inventory[4]!.packed!, false);
 assert.ok(m.progress.quests.facts.includes('item:dome') && m.progress.quests.facts.includes('craft:craft_dome'), 'old facts stay valid');
 refreshQuestProgress(m); assert.ok(m.progress.quests.completed.includes('dome') && m.progress.quests.completed.includes('distributor'));
 assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(m))), m, 'round trip');
 // The old exit spot (dome + front × 3.5) is exactly the new outer landing.
 assert.deepEqual([landingPoint(m, m.world.base.doors[0], 'front').x, landingPoint(m, m.world.base.doors[0], 'front').z], [61.5, 44.5]);
 // Every rotation keeps the airlock on its turned side.
 for (const [rot, door] of [[0, { x: 58, z: 46 }], [2, { x: 58, z: 41 }], [3, { x: 55, z: 44 }]] as const) { const r = sanitizeState(v7(fresh(), { x: 58, z: 44, rot, q: 0 })); assert.deepEqual([r.world.base.doors[0].x, r.world.base.doors[0].z, r.world.base.doors[0].rot], [door.x, door.z, rot]); assert.equal(allRooms(r)[0].volume, 48); }
});

test('Save v7 → v8: a passage through a dome ends at once at its landing point; the pocket recipe takes an old dome apart', () => {
 for (const direction of ['in', 'out'] as const) {
  const old = v7(fresh(), { x: 58, z: 44, rot: 0, q: 4000 }); old.world.base.passage = { domeId: 'build-1', direction, remainingMs: 3000 }; Object.assign(old.player, { x: 58, z: 47.5 });
  const m = sanitizeState(old), door = m.world.base.doors[0]; assert.equal(m.world.base.passage, null);
  const at = landingPoint(m, door, direction === 'in' ? 'back' : 'front'); assert.deepEqual([m.player.x, m.player.y, m.player.z], [at.x, at.y, at.z]);
  assert.equal(!!roomAt(m, m.player.x, m.player.y + 1, m.player.z), direction === 'in');
 }
 const g = fresh(); stock(g, { dome: 1 }); assert.equal(startJob(g, 'dismantle_dome'), ''); tick(g, 2000); assert.equal(countItem(g.player.inventory, 'window'), 64); assert.equal(countItem(g.player.inventory, 'airlock'), 1); assert.equal(countItem(g.player.inventory, 'dome'), 0);
 void cloneState; void roomAtCell;
});
