import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimClock, MAX_STEPS } from '../src/game/clock.ts';
import { ITEMS, TOOLS } from '../src/game/defs.ts';
import { addItems, removeItems, countItem, emptyInventory, capacityFor } from '../src/game/inventory.ts';
import { newGame, sanitizeState, cloneState } from '../src/game/state.ts';
import { mineTick, pickUp, ticksFor, type Mining } from '../src/game/mining.ts';
import { NODES } from '../src/game/resources.ts';
import { sha256, canonical } from '../src/persist/canonical.ts';
import { createHash } from 'node:crypto';

const fresh = () => newGame('w-test', 1234, 1, .5);
test('item definitions match docs/data/catalog.json', () => {
 const cat = JSON.parse(readFileSync('docs/data/catalog.json', 'utf8'));
 for (const [id, d] of Object.entries(ITEMS)) { assert.ok(cat.items[id], id); assert.equal(cat.items[id].name, d.name); assert.equal(cat.items[id].stack, d.stack); }
 for (const p of ['suit_helmet', 'suit_chest', 'suit_legs', 'suit_boots']) assert.equal(cat.items[p].kind, 'equipment', p);
 assert.equal(cat.items.suit, undefined, 'single suit item replaced by four parts (D30)'); assert.equal(cat.version, '1.1.0');
});
test('valley deposits match the WORLD §2 guarantee (48 Fe, 32 Cu, 48 stone, 24 ice)', () => {
 const sum = (id: string) => NODES.filter(n => n.itemId === id).reduce((a, n) => a + n.amount, 0);
 assert.deepEqual([sum('iron_raw'), sum('copper_raw'), sum('stone'), sum('ice')], [48, 32, 48, 24]);
 for (const n of NODES) assert.ok(Math.hypot(n.x - 40, n.z - 40) <= 120, n.id);
});
test('clock: fixed 50 ms ticks, ≤5 per frame, no catch-up after stop or long frames', () => {
 const c = new SimClock();
 assert.equal(c.advance(1000), 0, 'stopped clock does not advance');
 c.start(); assert.equal(c.advance(16), 0); assert.equal(c.advance(34), 1); assert.equal(c.activeTicks, 1);
 assert.equal(c.advance(10_000), MAX_STEPS, 'a 10 s hitch is not replayed'); assert.equal(c.advance(16), 0, 'surplus dropped');
 c.stop(); c.start(); assert.equal(c.advance(49), 0); assert.equal(c.activeTicks, 1 + MAX_STEPS);
});
test('inventory stacks to 64, overflow is reported, removal is exact', () => {
 const inv = emptyInventory(); assert.equal(capacityFor(inv, 'stone'), 24 * 64);
 assert.equal(addItems(inv, 'stone', 100), 0); assert.equal(inv[0]!.count, 64); assert.equal(inv[1]!.count, 36);
 assert.equal(addItems(inv, 'iron_raw', 23 * 64), 64, '22 free slots hold 22 stacks'); assert.equal(removeItems(inv, 'stone', 50), 50); assert.equal(countItem(inv, 'stone'), 50);
});
test('starting kit per SYSTEMS §1 and strict validation round trip', () => {
 const s = fresh();
 assert.equal(s.player.inventory[0]!.itemId, 'tool_stone'); assert.equal(s.player.inventory[0]!.durability, 160);
 assert.deepEqual(s.player.inventory[1], { itemId: 'pulp', count: 4 }); assert.equal(s.player.bottles[0]!.milliGU, 240000);
 assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(s))), s);
 const bad = cloneState(s) as any; bad.player.inventory[2] = { itemId: 'stone', count: 65 }; assert.throws(() => sanitizeState(bad), /count/);
 const evil = JSON.parse(JSON.stringify(s).replace('"meta":{', '"meta":{"__proto__":{"x":1},')); assert.equal((sanitizeState(evil).meta as any).x, undefined);
 const unk = cloneState(s) as any; unk.player.inventory[3] = { itemId: 'velite_raw', count: 1 }; assert.throws(() => sanitizeState(unk), /неизвестный предмет/);
 const node = cloneState(s) as any; node.world.nodes['iron-a'] = 33; assert.throws(() => sanitizeState(node));
});
test('mining: 4 s per iron block with the stone multitool, finite node, tool wear', () => {
 const s = fresh(), m: Mining = { nodeId: null, ticks: 0 };
 assert.equal(ticksFor('iron', 1), 80);
 for (let i = 0; i < 79; i++) assert.equal(mineTick(s, m, 'iron-b', true).kind, 'progress');
 const e = mineTick(s, m, 'iron-b', true); assert.equal(e.kind, 'block');
 assert.equal(countItem(s.player.inventory, 'iron_raw'), 1); assert.equal(s.world.nodes['iron-b'], 15); assert.equal(s.player.inventory[0]!.durability, 159);
 // Releasing or switching target resets progress and consumes nothing.
 for (let i = 0; i < 40; i++) mineTick(s, m, 'iron-b', true); mineTick(s, m, null, false); assert.equal(m.ticks, 0);
 for (let i = 0; i < 40; i++) mineTick(s, m, 'iron-b', true); mineTick(s, m, 'copper-b', true); assert.equal(m.ticks, 1); assert.equal(s.world.nodes['iron-b'], 15);
 s.world.nodes['ice-a'] = 1; for (let i = 0; i < 30; i++) mineTick(s, m, 'ice-a', true);
 assert.equal(s.world.nodes['ice-a'], 0); assert.equal(mineTick(s, m, 'ice-a', true).kind, 'blocked');
});
test('mining: full inventory spills into a persistent ground pile; broken tool stops mining', () => {
 const s = fresh(), m: Mining = { nodeId: null, ticks: 0 };
 for (let i = 2; i < 24; i++) s.player.inventory[i] = { itemId: 'ice', count: 64 };
 s.player.inventory[1] = { itemId: 'pulp', count: 64 };
 let ev; for (let i = 0; i < 60; i++) ev = mineTick(s, m, 'stone-a', true);
 assert.equal(ev!.kind, 'block'); assert.equal((ev as any).toGround, 1); assert.equal(s.world.drops.length, 1); assert.deepEqual(s.world.drops[0].items, [{ itemId: 'stone', count: 1 }]);
 s.player.inventory[5] = null; assert.equal(pickUp(s, s.world.drops[0].id), 1); assert.equal(s.world.drops.length, 0);
 s.player.inventory[0]!.durability = 1; for (let i = 0; i < 60; i++) ev = mineTick(s, m, 'stone-a', true);
 assert.equal((ev as any).toolBroke, true); assert.deepEqual(mineTick(s, m, 'stone-a', true), { kind: 'blocked', nodeId: 'stone-a', reason: 'Инструмент сломан' });
 assert.equal(TOOLS.tool_stone.durability, 160);
});
test('sha256 matches node:crypto and canonical JSON sorts keys', () => {
 for (const t of ['', 'abc', 'Вердана '.repeat(40), 'x'.repeat(1000)]) assert.equal(sha256(t), createHash('sha256').update(t, 'utf8').digest('hex'));
 assert.equal(canonical({ b: 1, a: [1, { d: 2, c: null }] }), '{"a":[1,{"c":null,"d":2}],"b":1}');
});
