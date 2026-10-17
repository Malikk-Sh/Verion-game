import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, cloneState, sanitizeState, type GameState } from '../src/game/state.ts';
import { NODE_BY_ID, VEIN_SPOTS, VEIN_SPOT_BY_ID, VEIN_MATERIALS, VEIN_LOOK, veinSizeRange, depositById, depositLeft, type VeinMaterial } from '../src/game/resources.ts';
import { natureTick, veinSpotBlocked, veinBlockers, roomBlockers, spawnVein, queueRespawn, nextVeinSeconds, VEIN_DELAY_RANGE, VEIN_RETRY_MS, VEIN_CAP, VEIN_PLAYER_CLEAR } from '../src/game/nature.ts';
import { mineTick, type Mining } from '../src/game/mining.ts';
import { makeBuilding } from '../src/game/production.ts';
import { bumpRooms, doorKeys, groundRoom, lowestAir, shellOf, allRooms, type Door } from '../src/game/rooms.ts';
import { nearestNode } from '../src/game/guide.ts';
import { resolveNav } from '../src/game/navigation.ts';
import { heightAt } from '../src/world.ts';
import { spotProblem, SPOT_GAP } from '../tools/vein_spot_rules.ts';

const fresh = (seed = 7) => { const g = newGame('w-veins', seed, 1, heightAt(40, 42)); g.player.x = -120; g.player.z = -120; return g; };
/** Mines blocks of a deposit to the end (tool in the first cell; a full inventory overflows to a pile, which is fine here). */
const mineOut = (g: GameState, id: string) => { const m: Mining = { nodeId: null, ticks: 0 }; let last; for (let i = 0; i < 100000 && depositLeft(g, id) > 0; i++) { g.player.inventory[0]!.durability = 160; last = mineTick(g, m, id, true); } return last; };
/** Active time in 50 ms ticks; returns the new veins (grass regrowth ids are left out). */
const tick = (g: GameState, ms: number) => { const out: string[] = []; for (let t = 0; t < ms; t += 50) { out.push(...natureTick(g, 50, g.meta.activeTicks).filter(id => id.startsWith('vein-'))); g.meta.activeTicks++; } return out; };
const roundTrip = (g: GameState) => sanitizeState(JSON.parse(JSON.stringify(g)));

test('D33: every fixed vein spot passes the static rules; 8–12 per material, about two thirds in the valley', () => {
 assert.equal(new Set(VEIN_SPOTS.map(s => s.id)).size, VEIN_SPOTS.length);
 for (const s of VEIN_SPOTS) assert.equal(spotProblem(s.x, s.z, s.material), '', s.id);
 for (let i = 0; i < VEIN_SPOTS.length; i++) for (let j = i + 1; j < VEIN_SPOTS.length; j++) { const a = VEIN_SPOTS[i], b = VEIN_SPOTS[j]; assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= SPOT_GAP, a.id + ' / ' + b.id); }
 for (const m of VEIN_MATERIALS) { const list = VEIN_SPOTS.filter(s => s.material === m); assert.ok(list.length >= 8 && list.length <= 12, m); assert.ok(list.some(s => s.far) && list.some(s => !s.far), m); }
 const valley = VEIN_SPOTS.filter(s => !s.far).length / VEIN_SPOTS.length; assert.ok(valley > .6 && valley < .75, String(valley));
 for (const s of VEIN_SPOTS.filter(s => !s.far)) assert.ok(s.x >= 0 && s.x <= 160 && s.z >= 0 && s.z <= 160, s.id);
});

test('D33: an exhausted static deposit queues one vein of its material after 300 s ± 25 % of active time; grass only regrows', () => {
 const g = fresh(); g.world.nodes['iron-b'] = 2;
 const ev = mineOut(g, 'iron-b'); assert.equal(ev?.kind, 'block'); assert.equal(g.world.nodes['iron-b'], 0, 'a static deposit stays at 0');
 assert.equal(g.world.respawn.length, 1); const due = g.world.respawn[0]; assert.equal(due.material, 'iron');
 assert.ok(Number.isInteger(due.ms) && due.ms >= VEIN_DELAY_RANGE[0] && due.ms <= VEIN_DELAY_RANGE[1], String(due.ms));
 assert.equal(nextVeinSeconds(g, 'iron_raw'), Math.ceil(due.ms / 1000));
 g.world.nodes['grass-a'] = 1; mineOut(g, 'grass-a'); assert.equal(g.world.respawn.length, 1, 'grass is not queued');
 // Only active time counts: nothing appears one tick early, the vein appears on the due tick.
 const n = Math.ceil(due.ms / 50); assert.deepEqual(tick(g, (n - 1) * 50), []); assert.equal(g.world.veins.length, 0);
 const spawned = tick(g, 50); assert.deepEqual(spawned, ['vein-1']); assert.equal(g.world.respawn.length, 0); assert.equal(g.world.nextVeinId, 2);
 const v = g.world.veins[0], [lo, hi] = veinSizeRange('iron');
 assert.equal(v.material, 'iron'); assert.equal(VEIN_SPOT_BY_ID.get(v.spot)?.material, 'iron'); assert.ok(v.size >= lo && v.size <= hi && v.amount === v.size);
 assert.equal(v.spawnedAt, g.meta.activeTicks - 1);
 assert.equal(nextVeinSeconds(g, 'iron_raw'), null);
});

test('D33: spawn is deterministic for a seed and a replay; never Math.random', () => {
 const run = (seed: number) => { const g = fresh(seed); g.world.nodes['stone-a'] = 1; g.world.nodes['ice-a'] = 1; mineOut(g, 'stone-a'); mineOut(g, 'ice-a'); tick(g, VEIN_DELAY_RANGE[1]); return g; };
 const a = run(7), b = run(7);
 assert.deepEqual(a.world.veins, b.world.veins); assert.equal(a.world.veins.length, 2);
 const random = Math.random; Math.random = () => { throw new Error('Math.random used'); };
 try { const c = run(7); assert.deepEqual(c.world.veins, a.world.veins); } finally { Math.random = random; }
 // A clone replays the same future exactly.
 const x = cloneState(a), y = roundTrip(a); mineOut(x, x.world.veins[0].id); mineOut(y, y.world.veins[0].id); tick(x, VEIN_DELAY_RANGE[1]); tick(y, VEIN_DELAY_RANGE[1]);
 assert.deepEqual(x.world, y.world);
});

test('D33: a vein mines like a deposit; its last block removes it and queues the next one', () => {
 const g = fresh(); const v = spawnVein(g, 'copper', 0)!; assert.ok(v);
 const n = depositById(g, v.id)!; assert.equal(n.itemId, 'copper_raw'); assert.equal(n.amount, v.size); assert.ok(n.box);
 for (const id of ['copper-a', 'copper-b', 'copper-c', 'copper-mesa']) g.world.nodes[id] = 0;
 assert.equal(nearestNode(g, 'copper_raw')?.name, VEIN_LOOK.copper.name, 'the guide leads to the vein once the static copper is gone');
 assert.equal((resolveNav(g, v.id, null) as { kind: string }).kind, 'node');
 const m: Mining = { nodeId: null, ticks: 0 }; let ev; for (let i = 0; i < 80; i++) ev = mineTick(g, m, v.id, true);
 assert.equal(ev?.kind, 'block'); assert.equal(g.world.veins[0].amount, v.size - 1);
 const last = mineOut(g, v.id); assert.ok(last?.kind === 'block' && last.left === 0 && last.node.id === v.id && last.node.material === 'copper');
 assert.equal(g.world.veins.length, 0); assert.deepEqual(g.world.respawn.map(e => e.material), ['copper']);
 assert.equal(resolveNav(g, v.id, null), 'invalid'); assert.equal(depositById(g, v.id), undefined);
 assert.equal(mineTick(g, m, v.id, true).kind, 'idle');
});

test('D33: spawn rules — bodies, an airlock landing, the player within 24 m, another vein or a stocked deposit within 8 m', () => {
 const g = fresh(), s = VEIN_SPOTS.find(s => s.id === 'stone-s1')!;
 assert.equal(veinSpotBlocked(g, s), '');
 g.player.x = s.x + VEIN_PLAYER_CLEAR - 1; g.player.z = s.z; assert.equal(veinSpotBlocked(g, s), 'игрок рядом');
 g.player.x = -120;
 const body = makeBuilding(g, 'workbench', Math.round(s.x) + 1, 0, Math.round(s.z)); assert.equal(veinSpotBlocked(g, s), 'постройка');
 g.world.base.buildings = [];
 // A lone airlock (rot 0, front +z) just past the vein's reach: its own column is clear, its back landing is not.
 const hz = VEIN_LOOK.stone.box[2] / 2 * 1.08 + .5, i = Math.floor(s.x), j = Math.ceil(s.z + hz + .5), door: Door = { id: 'door-1', x: i, y: lowestAir(i, j), z: j, rot: 0 };
 g.world.base.doors.push(door); g.world.base.nextId = 2; bumpRooms(g); assert.equal(veinSpotBlocked(g, s), 'выход шлюза');
 g.world.base.doors = []; bumpRooms(g); assert.equal(veinSpotBlocked(g, s), ''); void body;
 const near = VEIN_SPOTS.find(o => o.id === 'stone-s5')!; g.world.veins.push({ id: 'vein-1', spot: 'stone-s1', material: 'stone', amount: 5, size: 24, spawnedAt: 0 }); g.world.nextVeinId = 2;
 assert.equal(veinSpotBlocked(g, s), 'другая жила'); assert.equal(veinSpotBlocked(g, near), '');
 // Static spots keep 8 m from static deposits, so the stocked-deposit rule is checked with a synthetic spot.
 assert.equal(veinSpotBlocked(g, { id: 'x', material: 'iron', x: 67, z: 72 }), 'залежь рядом');
 g.world.nodes['iron-a'] = 0; assert.equal(veinSpotBlocked(g, { id: 'x', material: 'iron', x: 67, z: 72 }), '');
});

test('D33: footprints registered by other structures (glass rooms, D31) keep new veins out as well', () => {
 const g = fresh(), s = VEIN_SPOTS.find(s => s.id === 'stone-s5')!, src = (h: GameState) => h === g ? [{ x: s.x + 3, z: s.z, hx: 2, hz: 2, why: 'стеклянное помещение' }] : [];
 assert.equal(veinSpotBlocked(g, s), '');
 veinBlockers.push(src);
 try {
  assert.equal(veinSpotBlocked(g, s), 'стеклянное помещение');
  assert.equal(veinSpotBlocked(g, VEIN_SPOTS.find(o => o.id === 'stone-s1')!), '', 'a far spot stays free');
  g.world.respawn.push({ material: 'stone', ms: 50 }); const ids = tick(g, 50);
  assert.equal(ids.length, 1); assert.notEqual(g.world.veins[0].spot, 'stone-s5', 'the spawn never picks the covered spot');
 } finally { veinBlockers.splice(veinBlockers.indexOf(src), 1); }
});

test('D33 × D31: a real glass room keeps veins out — its walls, its interior and its airlock', () => {
 const g = fresh(), s = VEIN_SPOTS.find(s => s.id === 'stone-s5')!, i = Math.floor(s.x), j = Math.floor(s.z);
 const lay = (interior: number[]) => { g.world.base.glass = [...shellOf(interior)].sort((a, b) => a - b); bumpRooms(g); };
 // A 3×3×3 shelter around the spot: the walls are within the vein's reach.
 lay(groundRoom(i - 1, j - 1, 3, 3, 3)); assert.equal(allRooms(g).length, 1); assert.equal(veinSpotBlocked(g, s), 'стеклоблок');
 // A wide 13×13 hall: the walls are far, but the roof and the room's own bounds still cover the spot.
 lay(groundRoom(i - 6, j - 6, 13, 13, 3)); assert.equal(allRooms(g).length, 1); assert.equal(veinSpotBlocked(g, s), 'стеклоблок');
 assert.deepEqual(roomBlockers(g).filter(b => b.why === 'помещение'), [{ x: i + .5, z: j + .5, hx: 6.5, hz: 6.5, why: 'помещение' }]);
 // An airlock in the south wall: its column and both landings are registered.
 g.world.base.doors.push({ id: 'door-1', x: i, y: lowestAir(i, j - 7), z: j - 7, rot: 2 }); g.world.base.glass = g.world.base.glass.filter(k => !doorKeys(g.world.base.doors[0]).includes(k)); g.world.base.nextId = 2; bumpRooms(g);
 assert.equal(allRooms(g).length, 1, 'the airlock keeps the hall sealed');
 assert.deepEqual(roomBlockers(g).filter(b => b.why !== 'стеклоблок' && b.why !== 'помещение').map(b => [b.why, b.x, b.z]), [['шлюз', i + .5, j - 6.5], ['выход шлюза', i + .5, j - 7.5], ['выход шлюза', i + .5, j - 5.5]]);
 assert.equal(veinSpotBlocked(g, VEIN_SPOTS.find(o => o.id === 'stone-s1')!), '', 'a far spot stays free');
 g.world.respawn.push({ material: 'stone', ms: 50 }); const ids = tick(g, 50);
 assert.equal(ids.length, 1); assert.notEqual(g.world.veins[0].spot, 'stone-s5', 'the spawn never picks a spot in a room');
});

test('D33: when every spot is blocked the queue retries every 10 s; capped materials wait for a free place', () => {
 const g = fresh(); g.world.respawn.push({ material: 'sand', ms: 50 });
 const blockers = VEIN_SPOTS.filter(s => s.material === 'sand');
 g.world.base.buildings = []; for (const s of blockers) makeBuilding(g, 'refill', Math.round(s.x), 0, Math.round(s.z));
 assert.ok(blockers.every(s => veinSpotBlocked(g, s) === 'постройка'));
 assert.deepEqual(tick(g, 50), []); assert.equal(g.world.respawn[0].ms, VEIN_RETRY_MS);
 g.world.base.buildings = [];
 assert.deepEqual(tick(g, VEIN_RETRY_MS - 50), []); assert.equal(tick(g, 50).length, 1, 'retried after 10 s of active time');
 // Cap: three live veins of one material; a fourth due entry waits at 0 and appears once one is mined out.
 const h = fresh(); for (let i = 0; i < 4; i++) h.world.respawn.push({ material: 'ice', ms: 50 });
 tick(h, 50); assert.equal(h.world.veins.length, VEIN_CAP); assert.deepEqual(h.world.respawn, [{ material: 'ice', ms: 0 }]);
 tick(h, 60000); assert.equal(h.world.veins.length, VEIN_CAP, 'still capped');
 mineOut(h, h.world.veins[0].id); assert.equal(h.world.veins.length, VEIN_CAP - 1);
 assert.equal(tick(h, 50).length, 1, 'the waiting entry takes the freed place'); assert.equal(h.world.veins.length, VEIN_CAP); assert.equal(h.world.respawn.length, 1);
 // The queue never outgrows the finite static deposits.
 const q = fresh(); for (let i = 0; i < 40; i++) queueRespawn(q, 'stone'); assert.equal(q.world.respawn.length, 17); queueRespawn(fresh(), 'grass');
});

test('D33: veins survive a save round trip; forged veins and queue entries are rejected', () => {
 const g = fresh(); spawnVein(g, 'iron', 12); spawnVein(g, 'ice', 40); g.world.veins[0].amount = 3; g.world.respawn.push({ material: 'sand', ms: 1234 });
 assert.deepEqual(roundTrip(g), g);
 const bad = (f: (o: any) => void, re: RegExp) => { const o: any = JSON.parse(JSON.stringify(g)); f(o); assert.throws(() => sanitizeState(o), re); };
 bad(o => { o.world.veins[0].spot = 'nowhere'; }, /нет такого места/);
 bad(o => { o.world.veins[0].spot = 'copper-s1'; }, /нет такого места/);
 bad(o => { o.world.veins[1].spot = o.world.veins[0].spot; o.world.veins[1].material = 'iron'; }, /одном месте/);
 bad(o => { o.world.veins[1].id = o.world.veins[0].id; }, /повторный ID/);
 bad(o => { o.world.veins[0].id = 'vein-9'; }, /счётчик/);
 bad(o => { o.world.veins[0].id = 'vein-0'; }, /ID/);
 bad(o => { o.world.veins[0].amount = o.world.veins[0].size + 1; }, /число вне/);
 bad(o => { o.world.veins[0].amount = 0; }, /число вне/);
 bad(o => { o.world.veins[0].size = 999; o.world.veins[0].amount = 999; }, /число вне/);
 bad(o => { o.world.veins[0].material = 'grass'; }, /материал/);
 { const o: any = JSON.parse(JSON.stringify(g)); o.world.veins[0].x = 40; assert.equal('x' in sanitizeState(o).world.veins[0], false, 'x/z come from the spot, a stored position is dropped'); }
 bad(o => { o.world.respawn[0].ms = VEIN_DELAY_RANGE[1] + 1; }, /число вне/);
 bad(o => { o.world.respawn[0].material = 'gold'; }, /материал/);
 bad(o => { o.world.respawn = Array(18).fill({ material: 'iron', ms: 1 }); }, /массив/);
 bad(o => { const spots = VEIN_SPOTS.filter(s => s.material === 'ice').slice(0, 4); o.world.veins = spots.map((s, i) => ({ id: 'vein-' + (i + 1), spot: s.id, material: 'ice', amount: 20, size: 20, spawnedAt: 0 })); o.world.nextVeinId = 5; }, /одного материала/);
 bad(o => { o.world.veins = null; }, /массив/);
});

test('D33: a v7 save gains empty vein fields; deposits it already exhausted are queued deterministically', () => {
 const g = fresh(), old: any = cloneState(g);
 old.meta.stateVersion = 7; delete old.world.veins; delete old.world.respawn; delete old.world.nextVeinId;
 old.world.nodes['iron-a'] = 0; old.world.nodes['ice-crater'] = 0; old.world.nodes['grass-c'] = 0;
 const m = sanitizeState(old), again = sanitizeState(structuredClone(old));
 assert.equal(m.meta.stateVersion, 10); assert.deepEqual(m.world.veins, []); assert.equal(m.world.nextVeinId, 1);
 assert.deepEqual(m.world.respawn.map(e => e.material), ['iron', 'ice']); assert.deepEqual(m.world.respawn, again.world.respawn);
 for (const e of m.world.respawn) assert.ok(e.ms >= VEIN_DELAY_RANGE[0] && e.ms <= VEIN_DELAY_RANGE[1]);
 assert.equal(m.world.nodes['iron-a'], 0, 'the static deposit itself is not refilled');
 assert.equal(old.world.veins, undefined, 'the source object is untouched');
 // A save of the same number from the parallel rooms lane (v8 without vein fields) gains them before validation.
 const rooms: any = cloneState(g); delete rooms.world.veins; delete rooms.world.respawn; delete rooms.world.nextVeinId; rooms.world.nodes['sand-a'] = 0;
 const r = sanitizeState(rooms); assert.equal(r.meta.stateVersion, 10); assert.deepEqual(r.world.veins, []); assert.equal(r.world.nextVeinId, 1); assert.deepEqual(r.world.respawn.map(e => e.material), ['sand']);
 // A partial preview file with live veins but no counter starts past the highest saved id.
 { const h = fresh(); assert.ok(spawnVein(h, 'iron', 0)); assert.ok(spawnVein(h, 'ice', 0)); const p: any = cloneState(h); delete p.world.nextVeinId; const s = sanitizeState(p); assert.equal(s.world.veins.length, 2); assert.equal(s.world.nextVeinId, h.world.nextVeinId); assert.equal(s.world.nextVeinId, 3); }
 const full = sanitizeState(JSON.parse(JSON.stringify(m))); assert.deepEqual(full.world.respawn, m.world.respawn, 'a full v8 save is not migrated again');
 const none: any = cloneState(g); none.meta.stateVersion = 7; delete none.world.veins; delete none.world.respawn; delete none.world.nextVeinId;
 assert.deepEqual(sanitizeState(none).world.respawn, []);
 const mats: VeinMaterial[] = [...VEIN_MATERIALS]; assert.equal(mats.length, 5); assert.ok(NODE_BY_ID.get('iron-a'));
});
