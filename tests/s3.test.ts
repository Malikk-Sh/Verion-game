import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, cloneState, sanitizeState, type GameState } from '../src/game/state.ts';
import { addItems, countItem } from '../src/game/inventory.ts';
import { NODES, NODE_BY_ID, PATCH_NODES } from '../src/game/resources.ts';
import { natureTick, nextRegrowSeconds, covers } from '../src/game/nature.ts';
import { RECIPES, RECIPE_BY_ID, WORKBENCH_UPGRADE, makeBuilding, startJob, productionTick, connect, linkSegments, insideDome, beginPassage, domeFront, telemetry, deliverPower, manualWork, queueJob } from '../src/game/production.ts';
import { packStation } from '../src/game/worldActions.ts';
import { TANKS } from '../src/game/defs.ts';
import { heightAt, GRASS } from '../src/world.ts';
import { placementProblem } from '../src/buildings.ts';
import { survivalTick } from '../src/game/survival.ts';
import { stationStatus } from '../src/game/stationStatus.ts';
import { nearestNode, guideStep } from '../src/game/guide.ts';
import { refreshQuestProgress } from '../src/game/quests.ts';

const fresh = () => newGame('w-s3', 7, 1, heightAt(40, 42));
const advance = (g: GameState, ms: number) => { for (let n = 0; n < ms; n += 50) { productionTick(g, 50); natureTick(g, 50); g.meta.activeTicks++; } };

test('S3: grass regrows one plant per period of active time, never in a burst and never above its amount', () => {
 const g = fresh(), n = NODE_BY_ID.get('grass-c')!;
 g.world.nodes[n.id] = n.amount - 3;
 advance(g, n.regrowSeconds! * 1000 - 50); assert.equal(g.world.nodes[n.id], n.amount - 3);
 advance(g, 50); assert.equal(g.world.nodes[n.id], n.amount - 2);
 // A huge step still adds at most what the elapsed periods allow, and stops at the amount.
 natureTick(g, n.regrowSeconds! * 1000 * 10); assert.equal(g.world.nodes[n.id], n.amount); assert.equal(g.world.regrow[n.id], undefined);
 // A static deposit never refills itself (S4, D33: a new vein appears at a fixed spot instead, tests/veins.test.ts).
 g.world.nodes['iron-a'] = 0; natureTick(g, 1e7); assert.equal(g.world.nodes['iron-a'], 0);
 assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(g))), g);
 const bad = cloneState(g) as any; bad.world.regrow['iron-a'] = 10; assert.throws(() => sanitizeState(bad), /не отрастает/);
});

test('S3: a version 6 save migrates to 7 (and on to 8) without losing anything; new deposits arrive full', () => {
 const g = fresh(), old: any = cloneState(g);
 old.meta.stateVersion = 6; delete old.world.regrow;
 for (const id of ['stone-b', 'iron-c', 'ice-crater', 'grass-g']) delete old.world.nodes[id];
 const k = makeBuilding(old, 'kiln', 46, 0, 46); delete k.rot; k.input = [{ itemId: 'sand', count: 3 }, { itemId: 'fiber', count: 64 }, null, null];
 k.job = { recipeId: 'glass', workMs: 3000, reserved: [{ itemId: 'sand', count: 2 }, { itemId: 'fiber', count: 2 }], water: 0 } as any;
 old.player.inventory[5] = { itemId: 'workbench', count: 1, packed: { kind: 'workbench', level: 1, input: [null, null, null, null], output: [null, null, null, null], job: null, queue: [], enabled: true, lowPriority: false, energy: 0, fuel: 0, water: 0, oxygen: 0, zone: k.zone } };
 const m = sanitizeState(old);
 assert.equal(m.meta.stateVersion, 8);
 for (const id of ['stone-b', 'iron-c', 'ice-crater', 'grass-g']) assert.equal(m.world.nodes[id], NODE_BY_ID.get(id)!.amount);
 const forged: any = cloneState(g); forged.meta.stateVersion = 6; delete forged.world.regrow; delete forged.world.nodes['iron-a'];
 assert.throws(() => sanitizeState(forged), 'A deleted pre-S3 deposit is not refilled by migration');
 assert.deepEqual(m.world.regrow, {});
 const kiln = m.world.base.buildings[0];
 assert.equal(kiln.rot, 0); assert.equal(kiln.job!.repeat, 0);
 assert.deepEqual(kiln.job!.reserved, [{ itemId: 'sand', count: 2 }, { itemId: 'fiber', count: 1 }]);
 // Fuel slot was full: the refunded fiber takes the first spare slot.
 assert.deepEqual(kiln.input, [{ itemId: 'sand', count: 3 }, { itemId: 'fiber', count: 64 }, { itemId: 'fiber', count: 1 }, null]);
 assert.equal(m.player.inventory[5]!.packed!.rot, 0);
});

test('S3: lines chain up to 12 m, cost one item per started 4 m, and packing refunds every segment', () => {
 const g = fresh(), gen = makeBuilding(g, 'biogenerator', 44, 0, 40), e = makeBuilding(g, 'electrolyzer', 53, 0, 40);
 assert.equal(linkSegments(4), 1); assert.equal(linkSegments(4.2), 2); assert.equal(linkSegments(9), 3);
 addItems(g.player.inventory, 'cable', 3); assert.equal(connect(g, 'cable', gen.id, e.id), ''); assert.equal(countItem(g.player.inventory, 'cable'), 0);
 Object.assign(g.player, { x: 53, z: 41.5 }); assert.equal(packStation(g, e.id), '');
 assert.equal(countItem(g.player.inventory, 'cable'), 3); assert.equal(g.world.base.links.length, 0);
});

test('S3: a repeated batch keeps crafting while inputs last, then stops without debt', () => {
 const g = fresh(); addItems(g.player.inventory, 'grass', 3);
 assert.equal(startJob(g, 'grass_parts'), ''); g.world.base.hand!.repeat = 5;
 advance(g, 6000);
 assert.equal(countItem(g.player.inventory, 'grass'), 0); assert.equal(countItem(g.player.inventory, 'fiber'), 6); assert.equal(g.world.base.hand, null);
});

test('S3: the whole start-to-base path fits the valley deposits with margin', () => {
 // Build list of the Verdana milestones: every station once, a second tank, the upgrade, lines.
 const want: Record<string, number> = { workbench: 1, kiln: 1, tool_stone: 1, wrench: 1, biogenerator: 1, electrolyzer: 1, refill: 1, bottle_1: 1, distributor: 1, dome: 1, cable: 12, gas_pipe: 8 };
 const raw: Record<string, number> = {}, made: Record<string, number> = {};
 const produce = (id: string, n: number) => {
  const r = RECIPES.find(r => r.outputs[id] && r.station !== 'electrolyzer');
  if (!r || ['iron_raw', 'copper_raw', 'stone', 'sand', 'ice', 'grass'].includes(id)) { raw[id] = (raw[id] ?? 0) + n; return; }
  const have = made[id] ?? 0, use = Math.min(have, n); made[id] = have - use; n -= use; if (!n) return;
  const batches = Math.ceil(n / r.outputs[id]); made[id] = (made[id] ?? 0) + batches * r.outputs[id] - n;
  for (const [input, k] of Object.entries(r.inputs)) produce(input, k * batches);
 };
 for (const [id, n] of Object.entries(want)) produce(id, n);
 for (const [id, n] of Object.entries(WORKBENCH_UPGRADE.inputs)) produce(id, n);
 const valley = (id: string) => NODES.filter(v => v.itemId === id && !v.far).reduce((a, v) => a + v.amount, 0);
 for (const id of ['iron_raw', 'copper_raw', 'stone', 'sand']) assert.ok(raw[id] <= valley(id) * .75, `${id}: need ${raw[id]} of ${valley(id)}`);
 // Grass covers the fibre of this list from the start patches alone; regrowth pays for fuel.
 assert.ok((raw.grass ?? 0) <= 100, 'grass ' + raw.grass);
 assert.ok(TANKS.bottle_1.capacity >= 600000);
 assert.ok(RECIPE_BY_ID.get('electrolysis'));
 assert.equal(insideDome({ kind: 'dome', x: 0, y: 0, z: 0 } as any, 1, .5, 1), true);
});
test('S3: a turned dome keeps its airlock on the turned side, in and out', () => {
 const g = fresh(), d = makeBuilding(g, 'dome', 60, 0, 40, 1);
 assert.deepEqual(domeFront(d), { x: 1, z: 0 });
 Object.assign(g.player, { x: 60, y: 0, z: 42.8 });
 assert.equal(beginPassage(g, d.id), 'Подойдите к шлюзу купола');
 Object.assign(g.player, { x: 62.8, z: 40 });
 d.zone.q = 3999; assert.match(beginPassage(g, d.id), /4 GU/, 'Entry needs the full 4 GU charge');
 d.zone.q = 8000; assert.equal(beginPassage(g, d.id), ''); assert.equal(d.zone.q, 4000);
 const enter = productionTick(g, 6000).passage!;
 assert.ok(insideDome(d, enter.x, enter.y, enter.z)); assert.equal(Math.round(enter.x), 61); assert.equal(enter.z, 40);
 Object.assign(g.player, { x: enter.x, y: enter.y, z: enter.z });
 d.zone.q = 0; assert.equal(beginPassage(g, d.id), '', 'Leaving an empty dome is always possible');
 const leave = productionTick(g, 6000).passage!;
 assert.ok(!insideDome(d, leave.x, leave.y, leave.z)); assert.ok(leave.x > 63); assert.equal(leave.z, 40);
});
test('S3: the airlock landing spots stay free and its 6 s cycle is breathable', () => {
 const g = fresh(), y = heightAt(60, 40), d = makeBuilding(g, 'dome', 60, y, 40, 1);
 Object.assign(g.player, { x: 58, y, z: 37 });
 assert.match(placementProblem(g, 'distributor', 61, 40), /шлюза/);
 assert.equal(placementProblem(g, 'distributor', 59, 40), '');
 assert.match(placementProblem(g, 'biogenerator', 59, 40), /выхлоп/, 'A generator never burns inside a dome');
 Object.assign(g.player, { x: 66, y, z: 37 });
 assert.match(placementProblem(g, 'kiln', 64, 40), /шлюза/);
 const g2 = fresh(); makeBuilding(g2, 'kiln', 64, heightAt(64, 40), 40); Object.assign(g2.player, { x: 58, y, z: 35 });
 assert.match(placementProblem(g2, 'dome', 60, 40, 1), /Перед шлюзом/);
 // A rock or deposit in front of the door counts too: the stone pile X24/Z25 blocks a dome at X24/Z21 facing it.
 Object.assign(g2.player, { x: 18, z: 15 }); assert.match(placementProblem(g2, 'dome', 24, 21, 0), /препятствие/); assert.equal(placementProblem(g2, 'dome', 24, 21, 1), '');
 // Entering from outside with empty tanks: the paid chamber air carries the player through the cycle.
 Object.assign(g.player, { x: 62.8, y: d.y, z: 40 }); for (const t of g.player.bottles) if (t) t.milliGU = 0;
 d.zone.q = 20000; assert.equal(beginPassage(g, d.id), ''); assert.equal(d.zone.q, 16000);
 for (let i = 0; i < 100; i++) survivalTick(g, .05, false);
 // The 4 GU paid at the start carry the cycle: no suffocation and no second charge from the dome.
 assert.equal(g.player.survival.suffocationMs, 0); assert.equal(d.zone.q, 16000);
});
test('S3: in a power shortage the dome distributor is served before workbench II (SYSTEMS energy classes)', () => {
 const g = fresh(), gen = makeBuilding(g, 'biogenerator', 44, 0, 40), dist = makeBuilding(g, 'distributor', 52, 0, 40), bench = makeBuilding(g, 'workbench', 46, 0, 44);
 makeBuilding(g, 'dome', 52, 0, 40); bench.level = 2;
 addItems(g.player.inventory, 'cable', 9); assert.equal(connect(g, 'cable', gen.id, dist.id), ''); assert.equal(connect(g, 'cable', gen.id, bench.id), '');
 Object.assign(g.player, { x: 46, z: 45 }); addItems(g.player.inventory, 'copper', 4); assert.equal(startJob(g, 'craft_wire', bench.id), '');
 gen.energy = 600; productionTick(g, 50, null, 10);
 assert.equal(telemetry.power.get(dist.id), Math.round((10 + Math.abs(10 - 20) / 20) * 50));
 assert.equal(telemetry.power.get(bench.id), 600 - Math.round((10 + Math.abs(10 - 20) / 20) * 50));
});
test('S3: the dome checklist wants pipe and power at the same distributor; an idle workbench II reports its power', () => {
 const g = fresh(), gen = makeBuilding(g, 'biogenerator', 44, 0, 40), electro = makeBuilding(g, 'electrolyzer', 48, 0, 36), dome = makeBuilding(g, 'dome', 52, 0, 40);
 const piped = makeBuilding(g, 'distributor', 51, 0, 40), powered = makeBuilding(g, 'distributor', 53, 0, 40);
 addItems(g.player.inventory, 'cable', 9); addItems(g.player.inventory, 'gas_pipe', 9);
 assert.equal(connect(g, 'gas_pipe', electro.id, piped.id), ''); assert.equal(connect(g, 'cable', gen.id, powered.id), '');
 gen.energy = 400000; productionTick(g, 50, null, 10);
 const checks = stationStatus(g, dome).checks!, check = (label: RegExp) => checks.find(c => label.test(c.label))!.ok;
 assert.equal(check(/Труба/), true); assert.equal(check(/Питание/), false);
 const bench = makeBuilding(g, 'workbench', 46, 0, 44); bench.level = 2;
 assert.equal(stationStatus(g, bench).title, 'Не подключён');
 assert.equal(connect(g, 'cable', gen.id, bench.id), ''); assert.match(stationStatus(g, bench).title, /Питание есть/);
 // A generator inside a dome burns nothing there: fuel alone is no power for the network.
 const g2 = fresh(), d2 = makeBuilding(g2, 'dome', 52, 0, 40), inGen = makeBuilding(g2, 'biogenerator', 51, 0, 40), b2 = makeBuilding(g2, 'workbench', 46, 0, 44);
 b2.level = 2; addItems(inGen.input, 'fiber', 5); addItems(g2.player.inventory, 'cable', 9); assert.equal(connect(g2, 'cable', inGen.id, b2.id), '');
 void d2; assert.equal(stationStatus(g2, b2).title, 'Нет питания');
});
test('S3: beside a far deposit the compass points at it, not back to the valley', () => {
 const g = fresh(), far = NODE_BY_ID.get('iron-canyon')!;
 assert.notEqual(nearestNode(g, 'iron_raw')!.name, far.name);
 Object.assign(g.player, { x: far.x + 3, z: far.z });
 assert.equal(nearestNode(g, 'iron_raw')!.name, far.name);
});
test('S3: the distributor step needs a distributor inside a dome, not just anywhere', () => {
 const g = fresh(); makeBuilding(g, 'distributor', 46, 0, 46); makeBuilding(g, 'dome', 56, 0, 40);
 refreshQuestProgress(g); assert.ok(!g.progress.quests.completed.includes('distributor'));
 makeBuilding(g, 'distributor', 56, 0, 40); refreshQuestProgress(g); assert.ok(g.progress.quests.completed.includes('distributor'));
});
test('S3: each cable carries 120 EU/s, the network as a whole is not capped; classes fill in order', () => {
 const ms = 50, g = fresh(); addItems(g.player.inventory, 'cable', 40);
 const sink = makeBuilding(g, 'distributor', 50, 0, 50), gens = [[46, 50], [54, 50], [50, 46], [50, 54]].map(([x, z]) => makeBuilding(g, 'biogenerator', x, 0, z));
 for (const gen of gens) { gen.energy = 400000; assert.equal(connect(g, 'cable', gen.id, sink.id), ''); }
 const all = [sink, ...gens], want = (need: number) => [{ b: sink, need, priority: 0 }];
 // Four separate cables: 4 × 40 EU/s reach the station (the old network cap stopped at 120).
 assert.equal(deliverPower(g, all, gens, want(160 * ms), ms).delivered.get(sink.id), 160 * ms);
 // Through one shared cable only 120 EU/s pass.
 const h = fresh(); addItems(h.player.inventory, 'cable', 40);
 const hub = makeBuilding(h, 'distributor', 50, 0, 50), far = makeBuilding(h, 'distributor', 50, 0, 58), hg = [[46, 50], [54, 50], [50, 46], [47, 47]].map(([x, z]) => makeBuilding(h, 'biogenerator', x, 0, z));
 for (const gen of hg) { gen.energy = 400000; assert.equal(connect(h, 'cable', gen.id, hub.id), ''); }
 assert.equal(connect(h, 'cable', hub.id, far.id), '');
 const one = deliverPower(h, [hub, far, ...hg], hg, [{ b: far, need: 160 * ms, priority: 0 }], ms);
 assert.equal(one.delivered.get(far.id), 120 * ms); assert.equal([...one.drawn.values()].reduce((a, b) => a + b, 0), 120 * ms);
 // One 40 EU/s generator: class 0 is served first, class 2 gets the rest.
 const k = fresh(); addItems(k.player.inventory, 'cable', 10);
 const kg = makeBuilding(k, 'biogenerator', 50, 0, 50), c0 = makeBuilding(k, 'distributor', 54, 0, 50), c2 = makeBuilding(k, 'distributor', 46, 0, 50); kg.energy = 400000;
 assert.equal(connect(k, 'cable', kg.id, c0.id), ''); assert.equal(connect(k, 'cable', kg.id, c2.id), '');
 const split = deliverPower(k, [kg, c0, c2], [kg], [{ b: c0, need: 30 * ms, priority: 0 }, { b: c2, need: 30 * ms, priority: 2 }], ms).delivered;
 assert.equal(split.get(c0.id), 30 * ms); assert.equal(split.get(c2.id), 10 * ms);
});
test('S3: a finished but blocked bench I frees the hands; every queue counts its active batch', () => {
 const g = fresh(), a = makeBuilding(g, 'workbench', 46, 0, 44), b = makeBuilding(g, 'workbench', 48, 0, 44);
 Object.assign(g.player, { x: 47, z: 45 }); const wire = RECIPE_BY_ID.get('craft_wire')!;
 a.job = { recipeId: 'craft_wire', workMs: wire.seconds * 1000, reserved: [], water: 0, repeat: 0 } as any; a.output = a.output.map(() => ({ itemId: 'stone', count: 64 }));
 b.job = { recipeId: 'craft_wire', workMs: 0, reserved: [], water: 0, repeat: 0 } as any;
 assert.equal(manualWork(g)?.id, b.id);
 productionTick(g, 1000); assert.ok(b.job!.workMs > 0 || !b.job, 'The second bench works while the first waits for space');
 const k = makeBuilding(g, 'kiln', 50, 0, 46); k.job = { recipeId: 'smelt_iron_raw', workMs: 0, reserved: [], water: 0, repeat: 0 } as any; k.queue = Array(4).fill('smelt_iron_raw');
 Object.assign(g.player, { x: 50, z: 47 }); assert.match(queueJob(g, 'smelt_iron_raw', k.id, 1), /максимум 5/);
 const v = fresh(), vk = makeBuilding(v, 'kiln', 50, 0, 46);
 vk.job = { recipeId: 'smelt_iron_raw', workMs: 0, reserved: [{ itemId: 'iron_raw', count: 1 }, { itemId: 'fiber', count: 1 }], water: 0, repeat: 0 } as any; vk.queue = Array(5).fill('smelt_iron_raw');
 assert.throws(() => sanitizeState(JSON.parse(JSON.stringify(v))), /очередь/, 'Five queued plus the active batch is six');
});

test('S3: a patch under a body does not regrow; it resumes once the body is gone', () => {
 const g = fresh(), n = NODE_BY_ID.get('grass-c')!, period = n.regrowSeconds! * 1000;
 g.world.nodes[n.id] = n.amount - 2;
 const b = makeBuilding(g, 'workbench', 17, 0, 66);
 natureTick(g, period * 5); assert.equal(g.world.nodes[n.id], n.amount - 2); assert.equal(nextRegrowSeconds(g, n.id), null);
 b.x = 20; // tufts reach 4.5 m and more along X from the patch centre: still built over
 natureTick(g, period); assert.equal(g.world.nodes[n.id], n.amount - 2);
 // The leaves count, not only tuft centres: a tuft at (20.28, 65.48) reaches into a body standing at (21, 65).
 assert.ok(covers(n, 21, 65, .48));
 b.x = 22; // clear of every tuft's leaves: it grows again
 natureTick(g, period); assert.equal(g.world.nodes[n.id], n.amount - 1);
 // A body touching any rendered tuft's leaves covers that tuft's deposit.
 for (const t of GRASS) if (t.patch >= 0) {
  const id = PATCH_NODES.get(t.patch)!.find(id => t.patch !== 0 || (t.x < 44) === (id === 'grass-a'))!, reach = .48 * t.s * 1.35;
  assert.ok(covers(NODE_BY_ID.get(id)!, t.x + reach + .47, t.z, .48), `${id} tuft ${t.x.toFixed(2)}, ${t.z.toFixed(2)}`);
 }
});
test('S3: a v6 world gets no new deposit under a body, the player or an airlock exit', () => {
 const g = fresh(), old: any = cloneState(g);
 old.meta.stateVersion = 6; delete old.world.regrow;
 for (const id of ['stone-b', 'grass-c', 'iron-c', 'ice-crater']) delete old.world.nodes[id];
 const d = makeBuilding(old, 'dome', 24, 0, 21); delete d.rot; // door north: its outer exit (24, 24.5) is inside stone-b
 makeBuilding(old, 'workbench', 16, 0, 66); // on grass-c
 Object.assign(old.player, { x: 98, z: 63 }); // inside iron-c
 const m = sanitizeState(old);
 for (const id of ['stone-b', 'grass-c', 'iron-c']) assert.equal(m.world.nodes[id], 0, id);
 assert.equal(m.world.nodes['ice-crater'], NODE_BY_ID.get('ice-crater')!.amount);
});
test('S3: a power deficit inside one class is shared in proportion to the requests', () => {
 const g = fresh(), ms = 50; addItems(g.player.inventory, 'cable', 40);
 const gen = makeBuilding(g, 'biogenerator', 50, 0, 50); gen.energy = 400000;
 const sinks = [...Array(11)].map((_, i) => makeBuilding(g, 'distributor', Math.round(50 + 5 * Math.cos(i / 11 * 2 * Math.PI)), 0, Math.round(50 + 5 * Math.sin(i / 11 * 2 * Math.PI))));
 for (const s of sinks) assert.equal(connect(g, 'cable', gen.id, s.id), '');
 const out = deliverPower(g, [gen, ...sinks], [gen], sinks.map(b => ({ b, need: 4 * ms, priority: 2 })), ms).delivered;
 const got = sinks.map(s => out.get(s.id)!);
 assert.equal(got.reduce((a, b) => a + b, 0), 40 * ms, 'The whole supply is used');
 for (const v of got) { assert.ok(Number.isInteger(v)); assert.ok(v >= 181 && v <= 182, String(v)); }
 // Carried fractions: over 11 shortage ticks every consumer receives exactly the same total.
 const total = new Map(sinks.map(s => [s.id, out.get(s.id)!]));
 for (let i = 1; i < 11; i++) { const d = deliverPower(g, [gen, ...sinks], [gen], sinks.map(b => ({ b, need: 4 * ms, priority: 2 })), ms).delivered; for (const s of sinks) total.set(s.id, total.get(s.id)! + d.get(s.id)!); }
 assert.deepEqual(new Set(total.values()), new Set([40 * ms]));
 // Unequal requests stay proportional over time too: 600 and 3 × 525 from 2000 per tick, 50 ticks.
 const u = fresh(); addItems(u.player.inventory, 'cable', 20);
 const ug = makeBuilding(u, 'biogenerator', 50, 0, 50); ug.energy = 400000;
 const us = [[54, 50], [46, 50], [50, 54], [50, 46]].map(([x, z]) => makeBuilding(u, 'distributor', x, 0, z)), needs = [600, 525, 525, 525];
 for (const s of us) assert.equal(connect(u, 'cable', ug.id, s.id), '');
 const sum = us.map(() => 0);
 for (let i = 0; i < 50; i++) { const d = deliverPower(u, [ug, ...us], [ug], us.map((b, j) => ({ b, need: needs[j], priority: 0 })), ms).delivered; us.forEach((b, j) => { sum[j] += d.get(b.id)!; }); }
 needs.forEach((n, j) => assert.ok(Math.abs(sum[j] - 50 * 2000 * n / 2175) < 1, `${n}: ${sum[j]}`));
 // Full ticks in between keep what a deficit still owes: 3 × 900 from 2000, then from 4000, repeated.
 const w = fresh(); addItems(w.player.inventory, 'cable', 20);
 const [w1, w2] = [[50, 50], [50, 54]].map(([x, z]) => makeBuilding(w, 'biogenerator', x, 0, z)), ws = [[54, 50], [46, 50], [50, 46]].map(([x, z]) => makeBuilding(w, 'distributor', x, 0, z));
 for (const gen of [w1, w2]) gen.energy = 400000;
 for (const s of ws) assert.equal(connect(w, 'cable', w1.id, s.id), ''); assert.equal(connect(w, 'cable', w1.id, w2.id), '');
 const got3 = ws.map(() => 0);
 for (let i = 0; i < 60; i++) { const d = deliverPower(w, [w1, w2, ...ws], i % 2 ? [w1, w2] : [w1], ws.map(b => ({ b, need: 900, priority: 0 })), ms).delivered; ws.forEach((b, j) => { got3[j] += d.get(b.id)!; }); }
 assert.ok(Math.max(...got3) - Math.min(...got3) <= 1, String(got3));
 // Unequal requests keep their ratio: 30 vs 10 EU/s from 20 EU/s → 15 and 5.
 const h = fresh(); addItems(h.player.inventory, 'cable', 10);
 const hg = makeBuilding(h, 'biogenerator', 50, 0, 50), a = makeBuilding(h, 'distributor', 54, 0, 50), b = makeBuilding(h, 'distributor', 46, 0, 50); hg.energy = 20 * ms;
 assert.equal(connect(h, 'cable', hg.id, a.id), ''); assert.equal(connect(h, 'cable', hg.id, b.id), '');
 const r = deliverPower(h, [hg, a, b], [hg], [{ b: a, need: 30 * ms, priority: 0 }, { b, need: 10 * ms, priority: 0 }], ms).delivered;
 assert.equal(r.get(a.id), 15 * ms); assert.equal(r.get(b.id), 5 * ms);
});

test('S3: leaving through the airlock lands on the ground in front of the door, not at the dome floor height', () => {
 const g = fresh(), x = 70, z = 44, d = makeBuilding(g, 'dome', x, heightAt(x, z) + .12, z, 0), f = domeFront(d), out = { x: x + f.x * 3.5, z: z + f.z * 3.5 };
 assert.ok(Math.abs(heightAt(out.x, out.z) - (d.y + .12)) > .05, 'the outer pad must sit at another height for this check');
 Object.assign(g.player, { x: x + 1, y: d.y + .1, z: z + .5 });
 assert.equal(beginPassage(g, d.id), '');
 const leave = productionTick(g, 6000).passage!;
 assert.deepEqual([leave.x, leave.z], [out.x, out.z]); assert.equal(leave.y, heightAt(out.x, out.z));
});

test('S3: the dome is passive — no on/off switch, an old "off" flag changes nothing', async () => {
 const g = fresh(), d = makeBuilding(g, 'dome', 58, heightAt(58, 42) + .12, 42, 0); d.enabled = false;
 const { stationStatus } = await import('../src/game/stationStatus.ts');
 assert.notEqual(stationStatus(g, d).title, 'Выключено');
});

test('S3: the journal follows the distributor inside the dome where the pipe and the cable meet', () => {
 const g = fresh(), y = heightAt(58, 42) + .12, dome = makeBuilding(g, 'dome', 58, y, 42, 0);
 const outside = makeBuilding(g, 'distributor', 46, heightAt(46, 46) + .12, 46, 0), inside = makeBuilding(g, 'distributor', 57, y, 42, 0);
 const gen = makeBuilding(g, 'biogenerator', 51, heightAt(51, 40) + .12, 40, 0), el = makeBuilding(g, 'electrolyzer', 51, heightAt(51, 43) + .12, 43, 0);
 assert.ok(g.world.base.buildings.indexOf(outside) < g.world.base.buildings.indexOf(inside) && insideDome(dome, inside.x, inside.y, inside.z) && !insideDome(dome, outside.x, outside.y, outside.z));
 g.world.base.links.push({ id: 'l-pipe', kind: 'gas_pipe', from: el.id, to: inside.id }, { id: 'l-cable', kind: 'cable', from: inside.id, to: gen.id });
 const tasks = guideStep(g, 'air').tasks;
 assert.equal(tasks[0].done, true, 'pipe to the distributor in the dome'); assert.equal(tasks[1].done, true, 'cable to the same distributor');
});
