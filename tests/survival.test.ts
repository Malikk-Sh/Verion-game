import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/game/state.ts';
import { oxygenGU } from '../src/game/backpack.ts';
import { eatPulp, survivalTick } from '../src/game/survival.ts';

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

test('pulp restores hunger and health, respects cooldown, and is never free', () => {
  const s = newGame('survival', 1, 1, .5);
  s.player.vitals.satiety = 40; s.player.vitals.health = 80;
  assert.equal(eatPulp(s), 'ate');
  assert.equal(s.player.vitals.satiety, 48); assert.equal(s.player.vitals.health, 81);
  assert.equal(eatPulp(s), 'none');
});
