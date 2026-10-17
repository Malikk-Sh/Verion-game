import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { newGame, sanitizeState, toModules, STATE_VERSION, type GameState } from '../src/game/state.ts';
import { addItems, countItem } from '../src/game/inventory.ts';
import { makeBuilding, productionTick } from '../src/game/production.ts';
import { heightAt, EYE } from '../src/world.ts';
import { Character } from '../src/controller.ts';
import { createGlassView } from '../src/glass.ts';
import { createWorldInteraction } from '../src/worldInteraction.ts';
import { placementProblem } from '../src/buildings.ts';
import { survivalTick, accessibleOxygen, tankGap } from '../src/game/survival.ts';
import { refreshQuestProgress } from '../src/game/quests.ts';
import { roomBlockers } from '../src/game/nature.ts';
import { doorTarget } from '../src/game/navigation.ts';
import {
 airlockTick, breathingChamber, chamberAt, chamberRoom, doorBoxes, doorLamp, doorPhase, doorStatus, leafBlocked, shelteredAir, useDoor, CHAMBER_Q, EQUALIZE_MS, SLIDE_MS, SILL,
} from '../src/game/airlock.ts';
import {
 allRooms, bumpRooms, cellKey, cellY, doorById, doorKeys, doorProblem, landingCells, landingPoint, newDoor, placeDoor, placeGlass, predictRemove, removeDoor, removeGlass, roomsView, shellOf, boxCells, type Door,
} from '../src/game/rooms.ts';

/** S5 (D36) walk-through airlock: a module with two sliding doors and a chamber, worked by the player. The door logic is
 *  checked on a one-deep module (S5 saves keep it where the second row does not fit); S5.1 builds it two deep (below). */
const fresh = () => newGame('w-airlock', 7, 1, heightAt(40, 42));
/** The base pad (flat 0.5 m): a 3×3×3 room x 56…58, z 42…44, its front wall at z = 45. */
const CUBE = () => shellOf(boxCells(56, 0, 42, 3, 3, 3));
const MOD = () => newDoor('door-1', 57, 0, 45, 0, 2, 1);
function lay(g: GameState, keys: number[], doors: Door[] = []) { g.world.base.glass = [...new Set([...g.world.base.glass, ...keys])].sort((a, b) => a - b); g.world.base.doors.push(...doors); bumpRooms(g); return roomsView(g.world.base); }
/** A sealed room with a module in its front wall (outer door facing +z) and `q` milli-GU of breathable air. */
function room(q = 300000) {
 const g = fresh(), d = MOD(); lay(g, CUBE().filter(k => !doorKeys(d).includes(k)), [d]); g.world.base.nextId = 2;
 Object.assign(allRooms(g)[0].zone, { q, temperature: 20, purity: 1 }); return g;
}
const at = (g: GameState, x: number, z: number, y = heightAt(x, z)) => Object.assign(g.player, { x, y, z });
const FLOOR = cellY(0) + SILL, door = (g: GameState) => doorById(g, 'door-1')!, air = (g: GameState) => allRooms(g)[0].zone.q;
/** Runs the cycle for `ms` of active time (airlockTick alone: no room leak, so the gas is exact). */
const run = (g: GameState, ms: number) => { for (let n = 0; n < ms; n += 50) airlockTick(g, 50); };

test('D36: a one-deep module is 2 cells wide, 2 high; the chamber is never room air and its four cells seal the wall', () => {
 const g = room(), d = door(g);
 assert.deepEqual(doorKeys(d), [cellKey(57, 0, 45), cellKey(57, 1, 45), cellKey(58, 0, 45), cellKey(58, 1, 45)]);
 assert.deepEqual(allRooms(g).map(r => r.volume), [27], 'the room is sealed by the closed module');
 for (const k of doorKeys(d)) assert.equal(roomsView(g.world.base).tag.get(k), undefined, 'module cells are solid, never air');
 assert.equal(landingCells(d, 'front').length, 4); assert.equal(landingCells(d, 'back').length, 4);
 assert.deepEqual(doorTarget(d), { id: 'door-1', kind: 'station', name: 'Шлюз', x: 58, z: 45.5, radius: 3 }, 'map and compass target: the module centre');
 // Vein blockers cover both columns of the module and both landings across the whole width.
 const cols = roomBlockers(g).filter(b => b.why === 'шлюз' || b.why === 'выход шлюза').map(b => `${b.x},${b.z}:${b.why}`).sort();
 assert.deepEqual(cols, ['57.5,44.5:выход шлюза', '57.5,45.5:шлюз', '57.5,46.5:выход шлюза', '58.5,44.5:выход шлюза', '58.5,45.5:шлюз', '58.5,46.5:выход шлюза']);
 // Doors open and close the chamber only: the room keeps its seal whatever they do (interlock: never both open).
 at(g, 58, 47); assert.equal(useDoor(g, 'door-1', 'outer'), ''); run(g, SLIDE_MS); assert.equal(d.outer, 'open'); assert.deepEqual(allRooms(g).map(r => r.volume), [27]);
});

test('D36: interlock — a door opens only while the other is closed; entering costs the room 4 GU, a charged chamber carries the breath', () => {
 const g = room(); at(g, 58, 47); const d = door(g);
 assert.equal(doorLamp(d, 'outer'), 'ready'); assert.equal(doorStatus(g, d, 'outer').action, 'Открыть'); assert.equal(doorStatus(g, d, 'outer').meta, 'Закрыта · в камере 0 GU');
 // Outer door towards the open outside, chamber at outside pressure: it only slides (0.8 s), no gas moves.
 assert.equal(useDoor(g, 'door-1', 'outer'), ''); assert.deepEqual([d.outer, d.inner, d.cycleMs, d.pressure], ['cycling', 'closed', SLIDE_MS, 0]);
 assert.equal(doorPhase(g, d)!.kind, 'slide'); assert.equal(doorLamp(d, 'inner'), 'locked'); assert.equal(doorLamp(d, 'outer'), 'cycling');
 assert.match(useDoor(g, 'door-1', 'outer'), /выравнивает/);
 run(g, SLIDE_MS); assert.deepEqual([d.outer, d.cycleMs], ['open', 0]); assert.equal(air(g), 300000);
 // The other door stays shut while this one is open.
 const held = structuredClone(d); assert.equal(useDoor(g, 'door-1', 'inner'), 'Сначала закройте другую дверь'); assert.deepEqual(d, held);
 assert.equal(doorStatus(g, d, 'inner').meta, 'Закрыта: открыта другая дверь'); assert.equal(doorLamp(d, 'inner'), 'locked');
 // In the outer doorway (the body in the leaf plane) the door cannot close; in the chamber it can.
 at(g, 58, 45.9, FLOOR); assert.equal(leafBlocked(d, 'outer', 58, FLOOR, 45.9), true); assert.equal(useDoor(g, 'door-1', 'outer'), 'Дверь заблокирована'); assert.equal(d.outer, 'open');
 at(g, 58, 45.5, FLOOR); assert.equal(chamberAt(g, 58, FLOOR + 1, 45.5)?.id, 'door-1'); assert.equal(useDoor(g, 'door-1', 'outer'), ''); assert.equal(d.outer, 'closed');
 // Inner door towards the room: the chamber fills from it first (4 GU at the request, 3 s), then the door slides.
 assert.equal(useDoor(g, 'door-1', 'inner'), ''); assert.deepEqual([d.inner, d.cycleMs, d.pressure, air(g)], ['cycling', EQUALIZE_MS + SLIDE_MS, CHAMBER_Q, 296000]);
 assert.equal(doorPhase(g, d)!.kind, 'fill'); assert.match(doorStatus(g, d, 'inner').meta, /^Наполнение камеры из помещения · 4 с$/);
 // The charged chamber is breathable and nothing is drawn while the player waits in it (no tanks worn).
 g.player.bottles = [null, null]; assert.equal(breathingChamber(g)?.id, 'door-1'); assert.equal(shelteredAir(g), true);
 assert.deepEqual(accessibleOxygen(g, false), { amount: 4, capacity: 4, unit: 'GU', emergency: false });
 for (let i = 0; i < 60; i++) survivalTick(g, .05, false); assert.equal(g.player.survival.suffocationMs, 0); assert.equal(d.pressure, CHAMBER_Q); assert.equal(air(g), 296000);
 run(g, EQUALIZE_MS); assert.equal(d.inner, 'cycling'); assert.equal(doorPhase(g, d)!.kind, 'slide');
 run(g, SLIDE_MS); assert.deepEqual([d.inner, d.outer, d.pressure], ['open', 'closed', CHAMBER_Q]);
 // With the inner door open the player breathes the room itself.
 assert.equal(chamberRoom(g)?.volume, 27); for (let i = 0; i < 20; i++) survivalTick(g, .05, false); assert.equal(air(g), 295000, 'one second of breath (1 GU/s) from the room');
 at(g, 58, 43.5); assert.equal(chamberAt(g, 58, g.player.y + 1, 43.5), null); assert.equal(useDoor(g, 'door-1', 'outer'), 'Сначала закройте другую дверь');
 // The inner door left open, the player outside again (another way out, or a respawn): the outer door can still be asked
 // for — the far inner door closes itself first (the chamber keeps its charge), then the outer one vents and opens.
 at(g, 58, 47); const q = air(g); assert.equal(doorStatus(g, d, 'outer').meta, 'Закрыта · внутренняя дверь закроется сама'); assert.equal(useDoor(g, 'door-1', 'outer'), ''); assert.deepEqual([d.inner, d.outer, d.pressure], ['closed', 'cycling', CHAMBER_Q]);
 assert.equal(doorPhase(g, d)!.kind, 'vent'); run(g, EQUALIZE_MS + SLIDE_MS); assert.deepEqual([d.inner, d.outer, d.pressure], ['closed', 'open', 0]); assert.equal(air(g), q);
});

test('D36: leaving vents the charged chamber outside (no room air); an empty room can always be left; nobody is trapped', () => {
 const g = room(); const d = door(g); Object.assign(d, { inner: 'open', pressure: CHAMBER_Q });
 // In the chamber: close the inner door, then the outer one vents the chamber (3 s) before it slides.
 at(g, 58, 45.5, FLOOR); assert.equal(useDoor(g, 'door-1', 'inner'), ''); assert.equal(d.inner, 'closed');
 assert.equal(useDoor(g, 'door-1', 'outer'), ''); assert.deepEqual([d.outer, d.cycleMs, d.pressure], ['cycling', EQUALIZE_MS + SLIDE_MS, CHAMBER_Q]);
 assert.equal(doorPhase(g, d)!.kind, 'vent'); assert.match(doorStatus(g, d, 'outer').meta, /^Сброс давления наружу/);
 run(g, EQUALIZE_MS - 50); assert.equal(d.pressure, CHAMBER_Q); run(g, 50); assert.equal(d.pressure, 0, 'the gas is lost when the slide begins');
 run(g, SLIDE_MS); assert.equal(d.outer, 'open'); assert.equal(air(g), 300000, 'leaving takes nothing from the room');
 // An empty room: the inner door still opens (nothing to take), so the room can always be left.
 const e = room(0), k = door(e); at(e, 58, 43.5);
 assert.equal(useDoor(e, 'door-1', 'inner'), ''); assert.deepEqual([k.cycleMs, k.pressure], [SLIDE_MS, 0]); run(e, SLIDE_MS); assert.equal(k.inner, 'open');
 at(e, 58, 45.5, FLOOR); assert.equal(useDoor(e, 'door-1', 'inner'), ''); assert.equal(useDoor(e, 'door-1', 'outer'), ''); assert.equal(k.cycleMs, SLIDE_MS, 'no vent at outside pressure');
 // Less than 4 GU in the room: the chamber takes what there is and is not breathable.
 const p = room(2500), c = door(p); at(p, 58, 45.5, FLOOR); assert.equal(useDoor(p, 'door-1', 'inner'), ''); assert.deepEqual([c.pressure, air(p)], [2500, 0]); assert.equal(breathingChamber(p), null);
 // From inside the chamber either door can always be asked for: asking for one cancels the other's cycle (the gas stays).
 const t = room(), m = door(t); at(t, 58, 45.5, FLOOR); assert.equal(useDoor(t, 'door-1', 'inner'), ''); run(t, 1000);
 assert.equal(useDoor(t, 'door-1', 'outer'), ''); assert.deepEqual([m.inner, m.outer, m.pressure, air(t)], ['closed', 'cycling', CHAMBER_Q, 296000]);
 assert.equal(m.cycleMs, EQUALIZE_MS + SLIDE_MS, 'the charge is vented before the outer door slides');
 // Too far away to work the door; nothing changes.
 const f = room(), fd = structuredClone(door(f)); at(f, 58, 52); assert.equal(useDoor(f, 'door-1', 'outer'), 'Подойдите к шлюзу'); assert.deepEqual(door(f), fd);
});

test('D36: a module between two rooms fills from the room behind the opening door; one with no room on either side just slides', () => {
 const g = fresh(), d = newDoor('door-1', 59, 0, 42, 1, 2, 1); assert.deepEqual(doorKeys(d).map(k => k % 128), [32, 33, 32, 33]);
 lay(g, [...new Set([...shellOf(boxCells(56, 0, 42, 3, 3, 3)), ...shellOf(boxCells(60, 0, 42, 3, 3, 3))])].filter(k => !doorKeys(d).includes(k)), [d]); g.world.base.nextId = 2;
 const [a, b] = allRooms(g); assert.deepEqual([a.volume, b.volume], [27, 27]); a.zone.q = 100000; b.zone.q = 3000; at(g, 57.5, 43);
 // rot 1: the outer door faces +x (room b), the inner one −x (room a).
 assert.equal(useDoor(g, 'door-1', 'inner'), ''); assert.deepEqual([d.pressure, allRooms(g)[0].zone.q], [CHAMBER_Q, 96000]); run(g, EQUALIZE_MS + SLIDE_MS);
 at(g, 59.5, 43, FLOOR); assert.equal(useDoor(g, 'door-1', 'inner'), ''); assert.equal(useDoor(g, 'door-1', 'outer'), ''); assert.equal(d.cycleMs, SLIDE_MS, 'already charged: no fill');
 assert.equal(allRooms(g)[1].zone.q, 3000);
 const h = fresh(), lone = newDoor('door-1', 70, 0, 50, 2, 2, 1); lay(h, [], [lone]); at(h, 71, 48.5);
 assert.equal(useDoor(h, 'door-1', 'outer'), ''); assert.equal(lone.cycleMs, SLIDE_MS); run(h, SLIDE_MS); assert.equal(lone.outer, 'open');
});

test('D36: placement — a straight 2×2 wall run (or a gap) returns its glass; partial walls, ground, landings and limits are refused', () => {
 const g = fresh(); lay(g, CUBE()); allRooms(g)[0].zone.q = 300000; at(g, 54, 47); addItems(g.player.inventory, 'airlock', 1); addItems(g.player.inventory, 'window', 2);
 const before = structuredClone(g);
 assert.match(placeDoor(g, cellKey(57, 2, 45), 0).error, /ровный участок стены 2×2/, 'the roof row would stick out');
 assert.match(placeDoor(g, cellKey(58, 0, 45), 0).error, /ровный участок/, 'one column beyond the wall end');
 assert.match(placeDoor(g, cellKey(57, -1, 45), 0).error, /грунт/);
 assert.match(placeDoor(g, cellKey(56, 0, 41), 1).error, /стекло|ровный/, 'turned across the wall');
 assert.deepEqual(g, before, 'refusals change nothing');
 const r = placeDoor(g, cellKey(57, 0, 45), 0); assert.equal(r.error, ''); assert.equal(r.ventGU, 0);
 assert.equal(g.world.base.glass.length, 41); assert.equal(countItem(g.player.inventory, 'window'), 6); assert.equal(countItem(g.player.inventory, 'airlock'), 0);
 assert.deepEqual({ ...g.world.base.doors[0], id: '' }, { id: '', x: 57, y: 0, z: 45, rot: 0, width: 2, depth: 2, outer: 'closed', inner: 'closed', pressure: 0, cycleMs: 0 });
 assert.equal(allRooms(g)[0].zone.q, 300000, 'sealing never broke'); refreshQuestProgress(g); assert.ok(g.progress.quests.completed.includes('dome'));
 // S5.1: two deep, the chamber stands in front of the wall (row z = 46); the landings are z = 47 and z = 44.
 for (const k of [cellKey(57, 0, 47), cellKey(58, 1, 47), cellKey(58, 0, 44), cellKey(57, 1, 44)]) assert.match(placeGlass(g, k).error, /посадка шлюза/);
 assert.match(placeGlass(g, cellKey(57, 0, 46)).error, /занята/, 'the chamber row is the module');
 for (const x of [57, 58]) assert.match(placementProblem(g, 'refill', x, 48), /шлюза/, 'stations keep both columns of the landing free');
 // A module in open air (no wall) is allowed; next to another module's landing it is not.
 at(g, 66, 48); assert.equal(doorProblem(g, cellKey(66, 0, 50), 0), '');
 at(g, 61, 49); assert.match(doorProblem(g, cellKey(57, 0, 47), 0), /^Здесь проход другого шлюза$/);
});

test('D36: taking a module back — refused while a door is open or cycling or the player is in it; asks before air leaves', () => {
 const g = room(), d = door(g); at(g, 54, 47);
 assert.equal(useDoor(g, 'door-1', 'outer'), ''); const cyc = structuredClone(g.world.base);
 assert.equal(removeDoor(g, 'door-1', true).error, 'Сначала закройте обе двери шлюза'); assert.deepEqual(g.world.base, cyc);
 run(g, SLIDE_MS); assert.equal(removeDoor(g, 'door-1', true).error, 'Сначала закройте обе двери шлюза');
 at(g, 58, 45.5, FLOOR); assert.equal(useDoor(g, 'door-1', 'outer'), ''); assert.equal(removeDoor(g, 'door-1', true).error, 'Выйдите из шлюза');
 at(g, 54, 47); assert.equal(predictRemove(g, doorKeys(d)[0]), 300);
 const ask = removeDoor(g, 'door-1'); assert.equal(ask.needConfirm, true); assert.equal(ask.ventGU, 300);
 const out = removeDoor(g, 'door-1', true); assert.equal(out.error, ''); assert.equal(allRooms(g).length, 0); assert.equal(countItem(g.player.inventory, 'airlock'), 1);
 // A legacy one-wide module (from an old save) gives back what the S4 airlock cost; it is never crafted.
 const h = fresh(), legacy = newDoor('door-1', 70, 0, 50, 0, 1); lay(h, [], [legacy]); h.world.base.nextId = 2; at(h, 70.5, 48);
 assert.equal(removeDoor(h, 'door-1').error, ''); assert.deepEqual(['iron', 'glass', 'fiber', 'airlock'].map(i => countItem(h.player.inventory, i)), [4, 2, 4, 0]);
 // Glass may come down while a door cycles: the chamber is not room air, so the edit is an ordinary one.
 const k = room(), kd = door(k); at(k, 54, 47); assert.equal(useDoor(k, 'door-1', 'outer'), ''); assert.equal(removeGlass(k, cellKey(56, 0, 45), true).error, ''); assert.equal(kd.outer, 'cycling');
});

test('D36: walking through — the closed leaf stops the body, the open doorway lets it into the chamber and on into the room', () => {
 const g = room(), d = door(g), view = createGlassView(new THREE.Group()); view.sync(g);
 const actor = new Character([], (a, b, c, e, out) => view.query(a, b, c, e, out)); Object.assign(actor, { x: 58, y: heightAt(58, 47.5), z: 47.5, yaw: Math.PI });
 const walk = (s: number) => { for (let t = 0; t < s; t += .05) { actor.step(.05, { forward: 1, right: 0, run: false, jump: false }); view.update(g, .05); } };
 at(g, 58, 47.5); view.update(g, 0); walk(1.5); assert.ok(actor.z > 46.2 && actor.z < 46.3, `stopped by the closed outer leaf at ${actor.z}`);
 assert.equal(useDoor(g, 'door-1', 'outer'), ''); run(g, SLIDE_MS); view.update(g, 1); walk(1.5);
 assert.ok(actor.z > 45.35 && actor.z < 45.42, `in the chamber, stopped by the inner leaf at ${actor.z}`); assert.ok(Math.abs(actor.y - FLOOR) < 1e-9, 'standing on the threshold');
 Object.assign(g.player, { x: actor.x, y: actor.y, z: actor.z }); assert.equal(chamberAt(g, actor.x, actor.y + 1, actor.z)?.id, 'door-1');
 assert.equal(useDoor(g, 'door-1', 'outer'), ''); assert.equal(useDoor(g, 'door-1', 'inner'), ''); run(g, EQUALIZE_MS + SLIDE_MS); view.update(g, 1); walk(1.2);
 assert.ok(actor.z < 44.3, `walked into the room: ${actor.z}`); Object.assign(g.player, { x: actor.x, y: actor.y, z: actor.z }); assert.equal(allRooms(g)[0].volume, 27); assert.equal(chamberAt(g, actor.x, actor.y + 1, actor.z), null);
 // Colliders: two jambs, a lintel, a threshold and two leaves; an open leaf drops out of the way, a closed one blocks.
 const b = doorBoxes(d); assert.equal(b.frame.length, 4); assert.ok(b.outer.maxZ <= 46 && b.inner.minZ >= 45); assert.equal(b.frame[3].maxY, FLOOR);
 assert.deepEqual(view.doorOpen('door-1'), { outer: 0, inner: 1 }, 'the outer door eased shut, the inner one is open');
 assert.equal(view.stats().doors, 1);
});

test('D36: aim — the leaf the ray meets first is the door; from inside the chamber both doors are within reach', () => {
 const g = room(), cam = new THREE.PerspectiveCamera(), w = createWorldInteraction(new THREE.Scene(), cam);
 const look = (x: number, z: number, y: number, p: [number, number, number]) => { Object.assign(g.player, { x, y, z }); cam.position.set(x, y + EYE, z); cam.lookAt(...p); cam.updateMatrixWorld(); w.update(g, true, 0); return w.struck; };
 assert.deepEqual([look(58, 47.3, heightAt(58, 47.3), [58, 1.6, 46])?.face, w.target], ['outer', 'door-1']);
 assert.deepEqual([look(58, 45.45, FLOOR, [58, 1.7, 45])?.face, w.target], ['inner', 'door-1']);
 assert.deepEqual([look(58, 45.45, FLOOR, [58, 1.7, 46])?.face, w.target], ['outer', 'door-1']);
 assert.deepEqual([look(58, 43.4, heightAt(58, 43.4), [58, 1.6, 45])?.face, w.target], ['inner', 'door-1']);
 // A station behind the door does not take the reticle from it.
 makeBuilding(g, 'distributor', 58, .62, 43); assert.equal(look(58, 47.3, heightAt(58, 47.3), [58, 1.3, 46])?.face, 'outer'); assert.equal(w.target, 'door-1');
});

test('D36: a door state and its cycle survive a save; strict validation rejects broken modules', () => {
 const g = room(); at(g, 58, 45.5, FLOOR); const d = door(g); assert.equal(useDoor(g, 'door-1', 'inner'), ''); run(g, 1200);
 const copy = sanitizeState(JSON.parse(JSON.stringify(g))); assert.deepEqual(copy, g); assert.equal(copy.meta.stateVersion, STATE_VERSION);
 run(copy, EQUALIZE_MS + SLIDE_MS); assert.equal(doorById(copy, 'door-1')!.inner, 'open'); void d;
 const bad = (patch: (s: any) => void, why: RegExp) => { const s: any = JSON.parse(JSON.stringify(g)); patch(s); assert.throws(() => sanitizeState(s), why); };
 bad(s => { Object.assign(s.world.base.doors[0], { outer: 'open', inner: 'open', cycleMs: 0 }); }, /обе двери/);
 bad(s => { s.world.base.doors[0].cycleMs = 0; }, /цикл/);
 bad(s => { Object.assign(s.world.base.doors[0], { inner: 'closed' }); }, /цикл/);
 bad(s => { s.world.base.doors[0].width = 3; }, /ширина/);
 bad(s => { s.world.base.doors[0].pressure = CHAMBER_Q + 1; }, /pressure/);
 bad(s => { s.world.base.doors[0].outer = 'ajar'; }, /состояние двери/);
 bad(s => { s.world.base.doors[0].cycleMs = EQUALIZE_MS + SLIDE_MS + 1; }, /cycleMs/);
 bad(s => { s.world.base.glass = [...s.world.base.glass, cellKey(58, 1, 45)].sort((a: number, b: number) => a - b); }, /шлюз/);
});

/** An S4 save (v8 → v9 by A1's level step, or a v9 written before D36): a 1-wide door in the middle of the front wall. */
function s4(g: GameState, keep: (k: number) => boolean = () => true, door: any = { id: 'door-1', x: 57, y: 0, z: 45, rot: 0 }) {
 const d1 = newDoor('door-1', door.x, door.y, door.z, door.rot, 1), shell = CUBE().filter(k => !doorKeys(d1).includes(k) && keep(k));
 g.world.base.glass = shell; g.world.base.doors = [d1]; g.world.base.nextId = 2; bumpRooms(g); if (allRooms(g)[0]) Object.assign(allRooms(g)[0].zone, { q: 321987, temperature: 18.5, purity: .73, lossRemainder: 412 });
 const raw: any = JSON.parse(JSON.stringify(g)); raw.world.base.doors = [door]; raw.world.base.passage = null; return raw;
}
test('D36 migration: a 1-wide door with wall glass beside it becomes a 2-wide module; its glass returns; rooms and air stay exact', () => {
 const g = fresh(), raw = s4(g), rooms = allRooms(g).map(r => ({ ...r.zone })), m = sanitizeState(raw);
 assert.equal(m.meta.stateVersion, STATE_VERSION); assert.equal('passage' in m.world.base, false);
 assert.deepEqual(m.world.base.doors, [{ id: 'door-1', x: 57, y: 0, z: 45, rot: 0, width: 2, outer: 'closed', inner: 'closed', pressure: 0, cycleMs: 0, depth: 2 }], 'the +x side first, two deep (S5.1: the row in front is free)');
 assert.equal(m.world.base.glass.length, raw.world.base.glass.length - 2); assert.ok(!m.world.base.glass.includes(cellKey(58, 0, 45)) && !m.world.base.glass.includes(cellKey(58, 1, 45)));
 assert.equal(countItem(m.player.inventory, 'window'), 2, 'the two blocks are in the backpack');
 assert.deepEqual(m.world.base.zones, rooms, 'every zone exactly (cell, q, T, purity, remainder)'); assert.deepEqual(allRooms(m).map(r => r.volume), [27]);
 assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(m))), m, 'idempotent');
 assert.deepEqual(toModules(JSON.parse(JSON.stringify(m))).world, JSON.parse(JSON.stringify(m.world)), 'the step changes nothing twice');
 // A v8 file (S4 levels and doors): the level shift (D35) and then the module step (D36) give the same layout and air.
 const v8 = s4(fresh()); v8.meta.stateVersion = 8; const both = sanitizeState(v8); assert.deepEqual(both.world.base.doors, m.world.base.doors); assert.deepEqual(both.world.base.glass, m.world.base.glass); assert.deepEqual(both.world.base.zones, rooms);
 // The other side when the +x side is no glass (here: the wall end beyond the door), and its backpack is full: a pile at the module.
 const h = fresh(); h.player.inventory = h.player.inventory.map(() => ({ itemId: 'stone', count: 64 }));
 const left = sanitizeState(s4(h, () => true, { id: 'door-1', x: 58, y: 0, z: 45, rot: 0 }));
 assert.deepEqual([left.world.base.doors[0].x, left.world.base.doors[0].width], [57, 2]); assert.deepEqual(left.world.drops.at(-1)!.items, [{ itemId: 'window', count: 2 }]);
 assert.deepEqual([left.world.drops.at(-1)!.x, left.world.drops.at(-1)!.z], [58, 45.5]);
 // No glass on either side (a door standing alone): a legacy one-wide module with the same door mechanics.
 const k = fresh(), lone = sanitizeState(s4(k, key => ![56, 58].some(i => [0, 1].some(l => key === cellKey(i, l, 45)))));
 assert.deepEqual({ ...lone.world.base.doors[0] }, { id: 'door-1', x: 57, y: 0, z: 45, rot: 0, width: 1, outer: 'closed', inner: 'closed', pressure: 0, cycleMs: 0, depth: 1 });
 assert.equal(countItem(lone.player.inventory, 'window'), 0); at(lone, 57.5, 47); assert.equal(useDoor(lone, 'door-1', 'outer'), '');
});

test('D36 migration: a passage still running ends on its landing; a station on the wider landing keeps the door one wide', () => {
 for (const direction of ['in', 'out'] as const) {
  const raw = s4(fresh()); raw.world.base.passage = { doorId: 'door-1', direction, remainingMs: 2500, paid: true }; Object.assign(raw.player, { x: 57.5, y: 1, z: 47 });
  const m = sanitizeState(raw), d = m.world.base.doors[0], p = landingPoint(m, d, direction === 'in' ? 'back' : 'front');
  assert.deepEqual([m.player.x, m.player.y, m.player.z], [p.x, p.y, p.z]); assert.equal(d.width, 2); assert.equal(m.world.base.zones[0].q, 321987);
 }
 // A station on the outer landing of the +x column: the module takes the −x side instead; on both sides: it stays one wide.
 const station = (x: number, z: number) => { const raw = s4(fresh()), b = makeBuilding(fresh(), 'refill', x, heightAt(x, z), z); raw.world.base.buildings = [JSON.parse(JSON.stringify({ ...b, id: 'build-2' }))]; raw.world.base.nextId = 3; return sanitizeState(raw).world.base.doors[0]; };
 assert.deepEqual([station(59, 47).x, station(59, 47).width], [56, 2]);
 assert.deepEqual([station(58, 47).x, station(58, 47).width], [57, 1]);
});

test('D36: survival and HUD — a sealed suit needs no tank in a charged chamber; production ticks advance the cycle', () => {
 const g = room(); at(g, 58, 45.5, FLOOR); g.player.bottles = [{ itemId: 'bottle_1', count: 1, milliGU: 1000 }, null];
 assert.equal(tankGap(g, false, 0), true, 'outside of any air the last tank is a gap');
 assert.equal(useDoor(g, 'door-1', 'inner'), ''); assert.equal(tankGap(g, false, 0), false, 'the charged chamber covers the swap');
 for (let n = 0; n < EQUALIZE_MS + SLIDE_MS; n += 50) productionTick(g, 50, null, 10); assert.equal(door(g).inner, 'open');
});

// ---------- S5.1: the module is two cells deep ----------
/** A room with a module built today: two deep, its chamber standing one cell out of the front wall (rows z = 45, 46). */
function deepRoom(q = 300000) {
 const g = fresh(), d = newDoor('door-1', 57, 0, 45, 0); lay(g, CUBE().filter(k => !doorKeys({ ...d, depth: 1 }).includes(k)), [d]); g.world.base.nextId = 2;
 Object.assign(allRooms(g)[0].zone, { q, temperature: 20, purity: 1 }); return g;
}
test('S5.1: a module two deep — eight cells, the chamber out of the wall, landings beyond it, the target at its middle', () => {
 const g = deepRoom(), d = door(g);
 assert.equal(d.depth, 2); assert.equal(doorKeys(d).length, 8);
 assert.deepEqual(doorKeys(d).slice(4), [cellKey(57, 0, 46), cellKey(57, 1, 46), cellKey(58, 0, 46), cellKey(58, 1, 46)], 'the second row is in front of the wall');
 assert.deepEqual(allRooms(g).map(r => r.volume), [27], 'the room keeps its 27 m³: the chamber is outside it');
 assert.deepEqual(landingCells(d, 'front'), [cellKey(57, 0, 47), cellKey(57, 1, 47), cellKey(58, 0, 47), cellKey(58, 1, 47)]);
 assert.deepEqual(landingCells(d, 'back'), [cellKey(57, 0, 44), cellKey(57, 1, 44), cellKey(58, 0, 44), cellKey(58, 1, 44)]);
 assert.deepEqual(doorTarget(d), { id: 'door-1', kind: 'station', name: 'Шлюз', x: 58, z: 46, radius: 3 });
 assert.deepEqual([landingPoint(g, d, 'front').z, landingPoint(g, d, 'back').z], [47.5, 44.5]);
 const b = doorBoxes(d); assert.ok(b.outer.minZ > 46.9 && b.outer.maxZ < 47, 'the outer leaf just inside the outer face (z = 47)'); assert.ok(b.inner.minZ >= 45 && b.inner.maxZ < 45.1);
 assert.equal(chamberAt(g, 58, FLOOR + 1, 46.6)?.id, 'door-1'); assert.equal(chamberAt(g, 58, FLOOR + 1, 45.3)?.id, 'door-1'); assert.equal(chamberAt(g, 58, FLOOR + 1, 47.2), null);
});
test('S5.1: walking through a two-deep module — into the long chamber, both doors in reach, on into the room', () => {
 const g = deepRoom(), d = door(g), view = createGlassView(new THREE.Group()); view.sync(g);
 const actor = new Character([], (a, b, c, e, out) => view.query(a, b, c, e, out)); Object.assign(actor, { x: 58, y: heightAt(58, 48.5), z: 48.5, yaw: Math.PI });
 const walk = (s: number) => { for (let t = 0; t < s; t += .05) { actor.step(.05, { forward: 1, right: 0, run: false, jump: false }); view.update(g, .05); } };
 at(g, 58, 48.5); view.update(g, 0); walk(1.5); assert.ok(actor.z > 47.2 && actor.z < 47.35, `stopped by the closed outer leaf at ${actor.z}`);
 assert.equal(useDoor(g, 'door-1', 'outer'), ''); run(g, SLIDE_MS); view.update(g, 1); walk(4);
 assert.ok(actor.z > 45.35 && actor.z < 45.45, `through the 2 m chamber to the inner leaf: ${actor.z}`); Object.assign(g.player, { x: actor.x, y: actor.y, z: actor.z });
 assert.equal(chamberAt(g, actor.x, actor.y + 1, actor.z)?.id, 'door-1'); assert.equal(useDoor(g, 'door-1', 'outer'), '', 'the outer door 1.6 m behind is in reach');
 assert.equal(useDoor(g, 'door-1', 'inner'), ''); run(g, EQUALIZE_MS + SLIDE_MS); view.update(g, 1); walk(1.2);
 assert.ok(actor.z < 44.3, `walked into the room: ${actor.z}`); assert.equal(allRooms(g)[0].zone.q, 296000, 'entering cost the room 4 GU');
});
test('S5.1: placement — the chamber row needs free air in front of the wall; glass there refuses the module', () => {
 const g = fresh(); lay(g, [...CUBE(), cellKey(57, 0, 46)]); at(g, 54, 48); addItems(g.player.inventory, 'airlock', 1);
 assert.match(doorProblem(g, cellKey(57, 0, 45), 0), /место под камеру/);
});
test('S5.1 migration: an S5 module gets the second row where it fits; glass or a station in front keeps it one deep', () => {
 const v9 = (patch?: (raw: any) => void) => { const g = fresh(), d = MOD(); lay(g, CUBE().filter(k => !doorKeys(d).includes(k)), [d]); g.world.base.nextId = 2; Object.assign(allRooms(g)[0].zone, { q: 123456, temperature: 20, purity: 1 });
  const raw: any = JSON.parse(JSON.stringify(g)); raw.meta.stateVersion = 9; delete raw.world.base.doors[0].depth; patch?.(raw); return raw; };
 const m = sanitizeState(v9()); assert.equal(m.meta.stateVersion, STATE_VERSION); assert.equal(m.world.base.doors[0].depth, 2); assert.deepEqual(allRooms(m).map(r => [r.volume, r.zone.q]), [[27, 123456]]);
 // A player on the old front landing stands where the new row is: set down on the new landing.
 const p = sanitizeState(v9(raw => Object.assign(raw.player, { x: 58, y: heightAt(58, 46.5), z: 46.5 }))); assert.equal(p.player.z, 47.5);
 // Glass in front of the module, or a station on the new landing: one deep, as before.
 const glass = sanitizeState(v9(raw => { raw.world.base.glass = [...raw.world.base.glass, cellKey(58, 1, 46)].sort((a: number, b: number) => a - b); }));
 assert.equal(glass.world.base.doors[0].depth, 1);
 const st = sanitizeState(v9(raw => { const b = makeBuilding(fresh(), 'refill', 57, heightAt(57, 48), 48); raw.world.base.buildings = [JSON.parse(JSON.stringify({ ...b, id: 'build-2' }))]; raw.world.base.nextId = 3; }));
 assert.equal(st.world.base.doors[0].depth, 1);
 assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(m))), m, 'idempotent');
 const bad: any = JSON.parse(JSON.stringify(m)); bad.world.base.doors[0].depth = 3; assert.throws(() => sanitizeState(bad), /глубина/);
});
