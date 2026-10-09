import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, sanitizeState, cloneState, HOTBAR_SIZE } from '../src/game/state.ts';
import { moveSlot, splitSlot, sortRest, dropSlot, equipPart, unequipPart, selectHotbar, selectedTool, wornParts, installTank, removeTank, oxygenGU } from '../src/game/backpack.ts';
import { mineTick, pickUp, type Mining } from '../src/game/mining.ts';
import { countItem } from '../src/game/inventory.ts';
import { phaseSeconds, offsetFor, isDay, nightAmount, sunDirection, DAY_S, CYCLE_TICKS, EVENING_S, MORNING_S } from '../src/game/daycycle.ts';
import { buildExport, exportText, parseImport } from '../src/persist/file.ts';
import { canonical, sha256 } from '../src/persist/canonical.ts';

const fresh = () => newGame('w-bp', 7, 1, .5);
const round = (s: unknown) => sanitizeState(JSON.parse(JSON.stringify(s)));

test('move: into an empty cell moves, onto an occupied cell swaps, onto the same stack merges', () => {
 const s = fresh(), inv = s.player.inventory;
 assert.ok(moveSlot(inv, 0, 10).ok); assert.equal(inv[0], null); assert.equal(inv[10]!.itemId, 'tool_stone');
 assert.ok(moveSlot(inv, 10, 1).ok); assert.equal(inv[1]!.itemId, 'tool_stone'); assert.deepEqual(inv[10], { itemId: 'pulp', count: 4 }, 'occupied target swaps');
 inv[11] = { itemId: 'stone', count: 60 }; inv[12] = { itemId: 'stone', count: 10 };
 assert.ok(moveSlot(inv, 12, 11).ok); assert.equal(inv[11]!.count, 64); assert.equal(inv[12]!.count, 6, 'merge keeps the remainder');
 assert.equal(moveSlot(inv, 5, 6).ok, false, 'empty source is refused');
 assert.equal(countItem(inv, 'stone'), 70, 'nothing is lost');
 const t = inv[1]!; inv[2] = { itemId: 'tool_stone', count: 1, durability: 3 }; moveSlot(inv, 2, 1); assert.equal(inv[1]!.durability, 3); assert.equal(inv[2], t, 'tools never merge, they swap');
});
test('hotbar is exactly the first inventory row: selection picks the active tool, reorder shows up immediately', () => {
 const s = fresh(), m: Mining = { nodeId: null, ticks: 0 };
 assert.equal(HOTBAR_SIZE, 6); assert.equal(s.player.inventory.length, 24);
 assert.equal(selectedTool(s)?.itemId, 'tool_stone');
 selectHotbar(s, 1); assert.equal(selectedTool(s), null, 'food selected: no tool');
 assert.deepEqual(mineTick(s, m, 'iron-a', true), { kind: 'blocked', nodeId: 'iron-a', reason: 'Выберите мультитул в быстром доступе' }, 'no fake mining without the tool in hand');
 assert.equal(s.world.nodes['iron-a'], 32); assert.equal(s.player.inventory[0]!.durability, 160);
 moveSlot(s.player.inventory, 0, 1); assert.equal(selectedTool(s)?.itemId, 'tool_stone', 'tool moved into the selected cell');
 moveSlot(s.player.inventory, 1, 8); assert.equal(selectedTool(s), null, 'tool moved out of the first row is not usable from the hotbar');
 selectHotbar(s, 9); assert.equal(s.player.hotbar, 1, 'selection is limited to cells 1–6');
 moveSlot(s.player.inventory, 8, 1); for (let i = 0; i < 80; i++) mineTick(s, m, 'iron-a', true); assert.equal(s.world.nodes['iron-a'], 31);
 assert.equal(round(s).player.hotbar, 1, 'selection is saved');
});
test('sort sorts cells 7–24 only, merges stacks and keeps the first row', () => {
 const s = fresh(), inv = s.player.inventory;
 inv[2] = { itemId: 'ice', count: 5 }; inv[5] = { itemId: 'stone', count: 3 };
 inv[20] = { itemId: 'stone', count: 40 }; inv[7] = { itemId: 'iron_raw', count: 2 }; inv[15] = { itemId: 'stone', count: 40 }; inv[9] = { itemId: 'tool_stone', count: 1, durability: 20 }; inv[23] = { itemId: 'suit_boots', count: 1 };
 const row = JSON.stringify(inv.slice(0, 6));
 sortRest(inv);
 assert.equal(JSON.stringify(inv.slice(0, 6)), row);
 assert.deepEqual(inv.slice(6, 12).map(x => x && `${x.itemId}:${x.count}`), ['tool_stone:1', 'suit_boots:1', 'iron_raw:2', 'stone:64', 'stone:16', null]);
 assert.equal(inv[6]!.durability, 20); assert.equal(countItem(inv, 'stone'), 83);
});
test('split halves a stack into a free cell; stateful items cannot split', () => {
 const s = fresh(), inv = s.player.inventory;
 const r = splitSlot(inv, 1); assert.ok(r.ok); assert.equal(inv[1]!.count, 2); assert.deepEqual(inv[6], { itemId: 'pulp', count: 2 });
 assert.equal(splitSlot(inv, 0).ok, false); assert.equal(splitSlot(inv, 1).ok, true); assert.equal(splitSlot(inv, 1).ok, false, 'a single item cannot split');
});
test('drop creates a real ground pile (with tool state) that can be picked up again', () => {
 const s = fresh(); s.player.inventory[0]!.durability = 77;
 assert.ok(dropSlot(s, 0).ok); assert.equal(s.player.inventory[0], null); assert.equal(s.world.drops.length, 1);
 assert.deepEqual(s.world.drops[0].items, [{ itemId: 'tool_stone', count: 1, durability: 77 }]);
 assert.ok(dropSlot(s, 1, 3).ok); assert.equal(s.player.inventory[1]!.count, 1); assert.equal(s.world.drops.length, 1, 'same spot: same pile');
 const back = round(s); assert.deepEqual(back.world.drops, s.world.drops, 'piles survive save/load');
 assert.equal(pickUp(s, s.world.drops[0].id), 4); assert.equal(s.player.inventory[0]!.durability, 77); assert.equal(countItem(s.player.inventory, 'pulp'), 4);
});
test('suit: four independent parts, swap from backpack, take off only with a free cell', () => {
 const s = fresh();
 assert.equal(wornParts(s), 4);
 assert.ok(unequipPart(s, 'helmet').ok); assert.equal(wornParts(s), 3); assert.equal(s.player.suit.helmet, null); assert.equal(countItem(s.player.inventory, 'suit_helmet'), 1);
 const at = s.player.inventory.findIndex(x => x?.itemId === 'suit_helmet'); assert.ok(at >= 6, 'goes into the backpack, not the hotbar row');
 assert.ok(equipPart(s, at).ok); assert.equal(s.player.suit.helmet!.itemId, 'suit_helmet'); assert.equal(s.player.inventory[at], null);
 s.player.inventory[3] = { itemId: 'suit_boots', count: 1 }; assert.ok(equipPart(s, 3).ok); assert.equal(s.player.inventory[3]!.itemId, 'suit_boots', 'replaced part returns into the same cell');
 assert.equal(equipPart(s, 1).ok, false, 'food is not a suit part');
 for (let i = 0; i < 24; i++) s.player.inventory[i] ??= { itemId: 'stone', count: 1 };
 const r = unequipPart(s, 'chest'); assert.equal(r.ok, false); assert.match((r as any).reason, /Нет места/); assert.equal(s.player.suit.chest!.itemId, 'suit_chest', 'refused: nothing changed');
 const bad = cloneState(s) as any; bad.player.suit.legs = { itemId: 'suit_boots', count: 1 }; assert.throws(() => round(bad), /не подходит/);
 assert.deepEqual(round(s).player.suit, s.player.suit);
});
test('tanks: install / remove keeps gas; oxygen on the HUD is the sum of installed tanks', () => {
 const s = fresh(); s.player.bottles[0]!.milliGU = 123456;
 assert.equal(oxygenGU(s), 123.456);
 assert.ok(removeTank(s, 0).ok); assert.equal(oxygenGU(s), 0);
 const i = s.player.inventory.findIndex(x => x?.itemId === 'bottle_1'); assert.equal(s.player.inventory[i]!.milliGU, 123456);
 assert.ok(installTank(s, i, 1).ok); assert.equal(s.player.bottles[1]!.milliGU, 123456); assert.equal(installTank(s, 0).ok, false);
 assert.deepEqual(round(s).player.bottles, s.player.bottles);
});
// A save made by S1 (content 1.0.0) exactly as the old newGame()/mining wrote it.
const legacy = () => ({
 meta: { worldId: 'w-old', name: 'Экспедиция 1', seed: 5, planetId: 'verdana', generatorVersion: 1, contentVersion: '1.0.0', createdAt: 1, activeTicks: 9000 },
 player: { x: 60, y: 1, z: 61, yaw: .2, pitch: 0, suit: 'suit', bottles: [{ itemId: 'bottle_1', count: 1, milliGU: 199000 }, null],
  inventory: [{ itemId: 'tool_stone', count: 1, durability: 101 }, { itemId: 'pulp', count: 4 }, { itemId: 'iron_raw', count: 13 }, ...Array(20).fill(null), { itemId: 'ice', count: 7 }] },
 world: { nodes: { 'iron-a': 19, 'iron-b': 16, 'copper-a': 22, 'copper-b': 10, 'stone-a': 48, 'ice-a': 17 }, drops: [{ id: 'drop-1', x: 60, z: 60, items: [{ itemId: 'stone', count: 3 }] }], nextDropId: 2 },
 progress: { visited: ['iron'], discovered: ['iron'], selected: 'copper' },
});
test('migration 1.0.0 → 1.1.0: old saves keep inventory, durability, gas, deposits; the suit becomes four worn parts', () => {
 const old = legacy(), before = JSON.stringify(old), s = sanitizeState(old);
 assert.equal(JSON.stringify(old), before, 'input object untouched');
 assert.equal(s.meta.contentVersion, '1.1.0'); assert.equal(s.meta.stateVersion, 6);
 assert.deepEqual(Object.values(s.player.suit).map(p => p?.itemId), ['suit_helmet', 'suit_chest', 'suit_legs', 'suit_boots']);
 assert.equal(s.player.inventory[0]!.durability, 101); assert.equal(s.player.bottles[0]!.milliGU, 199000); assert.deepEqual(s.player.inventory[23], { itemId: 'ice', count: 7 });
 assert.equal(s.world.nodes['iron-a'], 19); assert.equal(s.meta.activeTicks, 9000); assert.equal(s.player.hotbar, 0); assert.deepEqual(s.player.vitals, { health: 100, satiety: 100 });
 assert.deepEqual(round(s), s, 'migrated state is a valid v3 state');
 const odd = legacy() as any; odd.player.suit = 'suit_heat'; assert.throws(() => sanitizeState(odd), /костюм/);
 const future = legacy() as any; future.meta.contentVersion = '9.0.0'; assert.throws(() => sanitizeState(future), /версия контента/);
});
test('migration through an old .vireon.json export file (content 1.0.0)', () => {
 const old = legacy(), kinds = ['meta', 'player', 'world', 'progress'] as const;
 const pages = kinds.map(kind => { const data = canonical((old as any)[kind]); return { kind, hash: sha256(data), data }; });
 const manifest = { worldId: 'w-old', name: 'Экспедиция 1', revision: 4, snapshotTick: 9000, pages: Object.fromEntries(pages.map(p => [p.kind, p.hash])) };
 const file = { magic: 'VIREON', formatVersion: 1, contentVersion: '1.0.0', generatorVersion: 1, exportedAt: 1, manifest, pages, sha256: sha256(canonical({ manifest, pages })) };
 const { state } = parseImport(JSON.stringify(file));
 assert.equal(state.player.suit.chest!.itemId, 'suit_chest'); assert.equal(state.player.inventory[0]!.durability, 101);
 // And the new fields round-trip through a current export.
 state.player.hotbar = 2; state.player.suit.helmet = null; state.player.inventory[5] = { itemId: 'suit_helmet', count: 1 }; state.world.dayOffsetTicks = 777;
 const again = parseImport(exportText(buildExport(state, 5, 2))).state; assert.deepEqual(again, state);
});
test('day cycle: 600 s day + 360 s night of active time; the skip changes only the offset', () => {
 assert.equal(CYCLE_TICKS, 19200);
 const s = fresh(); assert.ok(isDay(phaseSeconds(0, s.world.dayOffsetTicks)));
 assert.equal(phaseSeconds(0, 0), 0); assert.equal(phaseSeconds(12000, 0), 600); assert.equal(phaseSeconds(19200, 0), 0);
 assert.ok(nightAmount(300) < .01, 'noon is day'); assert.ok(nightAmount(780) > .99, 'mid-night is night');
 const a = sunDirection(60), b = sunDirection(300), c = sunDirection(540);
 assert.ok(a[0] < 0 && c[0] > 0, 'rises in the east (−x), sets in the west (+x)'); assert.ok(b[1] > a[1] && b[1] > c[1], 'highest at noon');
 const ticks = 4321, off = offsetFor(ticks, EVENING_S); assert.equal(phaseSeconds(ticks, off), EVENING_S); assert.ok(!isDay(phaseSeconds(ticks, off)));
 assert.equal(phaseSeconds(ticks, offsetFor(ticks, MORNING_S)), MORNING_S); assert.ok(DAY_S === 600);
});
