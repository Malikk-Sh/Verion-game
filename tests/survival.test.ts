import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, sanitizeState } from '../src/game/state.ts';
import { oxygenGU } from '../src/game/backpack.ts';
import { eatPulp, survivalTick, survivalSpeed, refillCapsule, loseCargo, respawnAtCapsule, accessibleOxygen } from '../src/game/survival.ts';

test('survival consumes the active bottle outside and never duplicates oxygen', () => {
  const s = newGame('survival', 1, 1, .5);
  const start = oxygenGU(s);
  assert.equal(survivalTick(s, 1, false), 'none');
  assert.equal(oxygenGU(s), start - 1);
  assert.equal(s.world.capsuleMilliGU, 2400000);
});

test('capsule oxygen is finite and takes priority inside the capsule', () => {
  const s = newGame('survival', 1, 1, .5);
  s.world.capsuleMilliGU = 1000;
  s.player.bottles[0]!.milliGU = 2000;
  survivalTick(s, 1, true);
  assert.equal(s.world.capsuleMilliGU, 0);
  // Only one GU was available in the capsule; the installed tank remains untouched.
  assert.equal(oxygenGU(s), 2);
});

test('empty air warns first, then damages and eventually kills', () => {
  const s = newGame('survival', 1, 1, .5);
  s.player.bottles[0]!.milliGU = 0;
  s.world.capsuleMilliGU = 0;
  assert.equal(survivalTick(s, 5, false), 'warning');
  const hp = s.player.vitals.health;
  assert.equal(survivalTick(s, 1, false), 'damage');
  assert.ok(s.player.vitals.health < hp);
  for (let i = 0; i < 30; i++) survivalTick(s, 1, false);
  assert.equal(s.player.vitals.health, 0);
});

test('survival fields migrate for old saves and existing survival progress is preserved', () => {
  const old = newGame('old-survival', 1, 1, .5) as unknown as Record<string, any>;
  old.meta.stateVersion = 2;
  delete old.player.survival;
  delete old.world.capsuleMilliGU;
  const migrated = sanitizeState(old);
  assert.equal(migrated.player.survival.suffocationMs, 0);
  assert.equal(migrated.world.capsuleMilliGU, 2400000);
  migrated.player.survival.hungerMs = 12000;
  migrated.world.capsuleMilliGU = 123456;
  const reopened = sanitizeState(migrated);
  assert.equal(reopened.player.survival.hungerMs, 12000);
  assert.equal(reopened.world.capsuleMilliGU, 123456);
});
test('pulp restores hunger and health, respects cooldown, and is never free', () => {
  const s = newGame('survival', 1, 1, .5);
  s.player.vitals.satiety = 40; s.player.vitals.health = 80;
  assert.equal(eatPulp(s), 'ate');
  assert.equal(s.player.vitals.satiety, 48); assert.equal(s.player.vitals.health, 81);
  assert.equal(eatPulp(s), 'none');
});

// Review regressions: test gameplay outcomes rather than the implementation structure.
test('a short breath cannot repeatedly erase the five-second suffocation grace', () => {
  const s = newGame('breath', 1, 1, .5); s.player.bottles[0]!.milliGU = 0;
  survivalTick(s, 4.9, false);
  survivalTick(s, .05, true);
  assert.equal(s.player.survival.suffocationMs, 4900);
  survivalTick(s, .2, false);
  assert.ok(Math.abs(s.player.vitals.health - 99.6) < 1e-8);
  survivalTick(s, 1.95, true);
  assert.equal(s.player.survival.suffocationMs, 5100);
  survivalTick(s, .05, true);
  assert.equal(s.player.survival.suffocationMs, 0);
});

test('oxygen exhaustion splits a tick across capsule, both bottles and missing air', () => {
  const s = newGame('split-air', 1, 1, .5);
  s.world.capsuleMilliGU = 10; s.player.bottles[0]!.milliGU = 10;
  s.player.bottles[1] = { itemId: 'bottle_1', count: 1, milliGU: 10 };
  assert.equal(survivalTick(s, .05, true), 'warning');
  assert.equal(s.world.capsuleMilliGU + oxygenGU(s) * 1000, 0);
  assert.equal(s.player.survival.suffocationMs, 20);
});

test('removing any suit part stops bottle breathing, but capsule air still protects', () => {
  for (const part of ['helmet', 'chest', 'legs', 'boots'] as const) {
    const s = newGame('unsealed', 1, 1, .5); s.player.suit[part] = null;
    assert.equal(survivalTick(s, 1, false), 'warning');
    assert.equal(oxygenGU(s), 240);
    survivalTick(s, 2, true);
    assert.equal(s.player.survival.suffocationMs, 0);
    assert.equal(s.world.capsuleMilliGU, 2398000);
  }
});

test('starvation has a 30-second grace, then damage and slow movement; food clears it', () => {
  const s = newGame('starve', 1, 1, .5); s.player.vitals.satiety = 0;
  survivalTick(s, 30, true); assert.equal(s.player.vitals.health, 100);
  survivalTick(s, 2, true); assert.equal(s.player.vitals.health, 99);
  assert.equal(survivalSpeed(s), .8);
  assert.equal(eatPulp(s), 'ate');
  assert.equal(s.player.survival.starvationMs, 0); assert.equal(survivalSpeed(s), 1);
  survivalTick(s, 1, true); assert.equal(s.player.vitals.health, 100);
});

test('starvation grace starts when the last satiety unit is actually spent', () => {
  const s = newGame('last-food', 1, 1, .5); s.player.vitals.satiety = 1;
  s.player.survival.hungerMs = 19000;
  survivalTick(s, 2, true);
  assert.equal(s.player.survival.starvationMs, 1000);
  assert.equal(s.player.vitals.health, 100);
});

test('running costs 1.5 times hunger while breathing stays at 1 GU/s', () => {
  const walking = newGame('walk-food', 1, 1, .5), running = newGame('run-food', 1, 1, .5);
  survivalTick(walking, 40, false); survivalTick(running, 40, false, true);
  assert.equal(walking.player.vitals.satiety, 98); assert.equal(running.player.vitals.satiety, 97);
  assert.equal(oxygenGU(walking), 200); assert.equal(oxygenGU(running), 200);
});

test('manual refill shares one 20 GU/s rate across two bottles and never creates gas', () => {
  const s = newGame('refill', 1, 1, .5); s.world.capsuleMilliGU = 100000;
  s.player.bottles[0]!.milliGU = 10000;
  s.player.bottles[1] = { itemId: 'bottle_1', count: 1, milliGU: 100000 };
  const total = s.world.capsuleMilliGU + oxygenGU(s) * 1000;
  assert.equal(refillCapsule(s, 1), true);
  assert.equal(s.world.capsuleMilliGU, 120000); assert.equal(oxygenGU(s), 90);
  assert.equal(s.world.capsuleMilliGU + oxygenGU(s) * 1000, total);
  s.world.capsuleMilliGU = 2399500;
  refillCapsule(s, 1); assert.equal(s.world.capsuleMilliGU, 2400000); assert.equal(oxygenGU(s), 89.5);
  assert.equal(refillCapsule(s, 1), false);
});

test('death keeps worn gear and bottle gas, drops cargo once, and respawns with 50 HP', () => {
  const s = newGame('death', 1, 1, .5), suit = structuredClone(s.player.suit);
  s.player.x = 60; s.player.z = 60; s.player.bottles[0]!.milliGU = 12345;
  s.player.inventory[0]!.durability = 71;
  loseCargo(s); loseCargo(s);
  assert.equal(s.world.drops.length, 1);
  assert.equal(s.world.drops[0].items.find(x => x.itemId === 'tool_stone')!.durability, 71);
  assert.equal(s.player.inventory.filter(Boolean).length, 0);
  assert.equal(respawnAtCapsule(s, .64), true);
  assert.deepEqual(s.player.suit, suit); assert.equal(oxygenGU(s), 12.345);
  assert.deepEqual(s.player.vitals, { health: 50, satiety: 40 });
  assert.equal(s.player.survival.emergencyMs, 0);
  assert.equal(respawnAtCapsule(s, .64), false, 'living players cannot request a free refill of health');
});

test('exhausted capsule grants only a 90-second personal reserve that survives reload', () => {
  const s = newGame('emergency', 1, 1, .5); s.world.capsuleMilliGU = 0;
  s.player.bottles[0]!.milliGU = 0; loseCargo(s); respawnAtCapsule(s, .64);
  assert.equal(s.player.survival.emergencyMs, 90000);
  survivalTick(s, 10, false);
  const loaded = sanitizeState(s);
  assert.equal(loaded.player.survival.emergencyMs, 80000);
  assert.equal(refillCapsule(loaded, 1), false);
  survivalTick(loaded, 80, false);
  assert.equal(loaded.player.vitals.health, 50);
  assert.equal(loaded.player.survival.emergencyMs, 0);
  assert.equal(oxygenGU(loaded), 0); assert.equal(loaded.world.capsuleMilliGU, 0);
  assert.equal(survivalTick(loaded, 5, false), 'warning');
  assert.equal(survivalTick(loaded, 1, false), 'damage');
  assert.equal(loaded.player.vitals.health, 46);
});

test('personal emergency air takes priority and leaves transferable gas untouched', () => {
  const s = newGame('reserve-priority', 1, 1, .5);
  s.player.survival.emergencyMs = 1000;
  survivalTick(s, 1, true);
  assert.equal(oxygenGU(s), 240); assert.equal(s.world.capsuleMilliGU, 2400000);
  survivalTick(s, .05, true); assert.equal(s.world.capsuleMilliGU, 2399950);
});

test('HUD uses nominal capacity and only breathable sources, including personal reserve seconds', () => {
  const s = newGame('hud-air', 1, 1, .5); s.player.bottles[0]!.milliGU = 24000;
  assert.deepEqual(accessibleOxygen(s, false), { amount: 24, capacity: 240, unit: 'GU', emergency: false });
  assert.deepEqual(accessibleOxygen(s, true), { amount: 2424, capacity: 2640, unit: 'GU', emergency: false });
  s.player.suit.helmet = null;
  assert.equal(accessibleOxygen(s, false).amount, 0); assert.equal(accessibleOxygen(s, true).amount, 2400);
  s.player.survival.emergencyMs = 17000;
  assert.deepEqual(accessibleOxygen(s, false), { amount: 17, capacity: 90, unit: 'с', emergency: true });
});

test('old survival saves get the new starvation timer without resetting existing timers or gas', () => {
  const old = newGame('old-timer', 1, 1, .5) as any;
  old.meta.stateVersion = 2;
  delete old.player.survival.starvationMs;
  old.player.survival.emergencyMs = 17000; old.player.survival.suffocationMs = 4100;
  old.world.capsuleMilliGU = 123;
  const s = sanitizeState(old);
  assert.equal(s.player.survival.starvationMs, 0); assert.equal(s.player.survival.emergencyMs, 17000);
  assert.equal(s.player.survival.suffocationMs, 4100); assert.equal(s.world.capsuleMilliGU, 123);
  old.player.survival.starvationMs = -1; assert.throws(() => sanitizeState(old), /starvationMs/);
});
