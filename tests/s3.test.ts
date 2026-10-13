import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, cloneState, sanitizeState, type GameState } from '../src/game/state.ts';
import { addItems, countItem } from '../src/game/inventory.ts';
import { NODES, NODE_BY_ID } from '../src/game/resources.ts';
import { natureTick } from '../src/game/nature.ts';
import { RECIPES, RECIPE_BY_ID, WORKBENCH_UPGRADE, makeBuilding, startJob, productionTick, connect, linkSegments, insideDome, beginPassage, domeFront, telemetry } from '../src/game/production.ts';
import { packStation } from '../src/game/worldActions.ts';
import { TANKS } from '../src/game/defs.ts';
import { heightAt } from '../src/world.ts';
import { placementProblem } from '../src/buildings.ts';
import { survivalTick } from '../src/game/survival.ts';

const fresh = () => newGame('w-s3', 7, 1, heightAt(40, 42));
const advance = (g: GameState, ms: number) => { for (let n = 0; n < ms; n += 50) { productionTick(g, 50); natureTick(g, 50); g.meta.activeTicks++; } };

test('S3: grass regrows one plant per period of active time, never in a burst and never above its amount', () => {
 const g = fresh(), n = NODE_BY_ID.get('grass-c')!;
 g.world.nodes[n.id] = n.amount - 3;
 advance(g, n.regrowSeconds! * 1000 - 50); assert.equal(g.world.nodes[n.id], n.amount - 3);
 advance(g, 50); assert.equal(g.world.nodes[n.id], n.amount - 2);
 // A huge step still adds at most what the elapsed periods allow, and stops at the amount.
 natureTick(g, n.regrowSeconds! * 1000 * 10); assert.equal(g.world.nodes[n.id], n.amount); assert.equal(g.world.regrow[n.id], undefined);
 // Finite deposits never regrow.
 g.world.nodes['iron-a'] = 0; natureTick(g, 1e7); assert.equal(g.world.nodes['iron-a'], 0);
 assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(g))), g);
 const bad = cloneState(g) as any; bad.world.regrow['iron-a'] = 10; assert.throws(() => sanitizeState(bad), /не отрастает/);
});

test('S3: a version 6 save migrates to 7 without losing anything; new deposits arrive full', () => {
 const g = fresh(), old: any = cloneState(g);
 old.meta.stateVersion = 6; delete old.world.regrow;
 for (const id of ['stone-b', 'iron-c', 'ice-crater', 'grass-g']) delete old.world.nodes[id];
 const k = makeBuilding(old, 'kiln', 46, 0, 46); delete k.rot; k.input = [{ itemId: 'sand', count: 3 }, { itemId: 'fiber', count: 64 }, null, null];
 k.job = { recipeId: 'glass', workMs: 3000, reserved: [{ itemId: 'sand', count: 2 }, { itemId: 'fiber', count: 2 }], water: 0 } as any;
 old.player.inventory[5] = { itemId: 'workbench', count: 1, packed: { kind: 'workbench', level: 1, input: [null, null, null, null], output: [null, null, null, null], job: null, queue: [], enabled: true, lowPriority: false, energy: 0, fuel: 0, water: 0, oxygen: 0, zone: k.zone } };
 const m = sanitizeState(old);
 assert.equal(m.meta.stateVersion, 7);
 for (const id of ['stone-b', 'iron-c', 'ice-crater', 'grass-g']) assert.equal(m.world.nodes[id], NODE_BY_ID.get(id)!.amount);
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
 assert.equal(beginPassage(g, d.id), '');
 const enter = productionTick(g, 6000).passage!;
 assert.ok(insideDome(d, enter.x, enter.y, enter.z)); assert.equal(Math.round(enter.x), 61); assert.equal(enter.z, 40);
 Object.assign(g.player, { x: enter.x, y: enter.y, z: enter.z });
 assert.equal(beginPassage(g, d.id), '');
 const leave = productionTick(g, 6000).passage!;
 assert.ok(!insideDome(d, leave.x, leave.y, leave.z)); assert.ok(leave.x > 63); assert.equal(leave.z, 40);
});
test('S3: the airlock landing spots stay free and its 6 s cycle is breathable', () => {
 const g = fresh(), y = heightAt(60, 40), d = makeBuilding(g, 'dome', 60, y, 40, 1);
 Object.assign(g.player, { x: 58, y, z: 37 });
 assert.match(placementProblem(g, 'distributor', 61, 40), /шлюза/);
 assert.equal(placementProblem(g, 'distributor', 59, 40), '');
 Object.assign(g.player, { x: 66, y, z: 37 });
 assert.match(placementProblem(g, 'kiln', 64, 40), /шлюза/);
 const g2 = fresh(); makeBuilding(g2, 'kiln', 64, heightAt(64, 40), 40); Object.assign(g2.player, { x: 58, y, z: 35 });
 assert.match(placementProblem(g2, 'dome', 60, 40, 1), /Перед шлюзом/);
 // Entering from outside with empty tanks: the chamber's dome air carries the player through the cycle.
 Object.assign(g.player, { x: 62.8, y: d.y, z: 40 }); for (const t of g.player.bottles) if (t) t.milliGU = 0;
 d.zone.q = 20000; assert.equal(beginPassage(g, d.id), '');
 const before = d.zone.q;
 for (let i = 0; i < 100; i++) survivalTick(g, .05, false);
 assert.equal(g.player.survival.suffocationMs, 0); assert.ok(d.zone.q < before);
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
