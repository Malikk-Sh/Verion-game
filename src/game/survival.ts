import { TANKS } from './defs';
import { emptyInventory, removeItems, type Slot } from './inventory';
import { oxygenGU, oxygenCapacityGU, wornParts } from './backpack';
import { dropItems } from './mining';
import { freshSurvival, SPAWN_POSE, type GameState } from './state';

export type SurvivalEvent = 'none' | 'warning' | 'damage' | 'death' | 'ate';
export const CAPSULE_CAPACITY = 2400000;
export const EMERGENCY_MS = 90000;
const TIMER_MAX = 86400000;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const elapsedAfter = (before: number, elapsed: number, grace: number) => Math.max(0, before + elapsed - grace) - Math.max(0, before - grace);

/** Advances only accepted active time. Oxygen is conserved even across source exhaustion. */
export function survivalTick(state: GameState, dt: number, insideCapsule: boolean, running = false): SurvivalEvent {
  if (state.player.vitals.health <= 0) return 'death';
  const ms = Math.max(0, Math.round(dt * 1000));
  if (!ms) return 'none';
  const s = state.player.survival, v = state.player.vitals;
  s.foodCooldownMs = Math.max(0, s.foodCooldownMs - ms);

  const hungerRate = running ? 1.5 : 1;
  const untilEmpty = Math.max(0, (v.satiety * 20000 - s.hungerMs) / hungerRate);
  const hunger = s.hungerMs + Math.round(ms * hungerRate);
  v.satiety = clamp(v.satiety - Math.floor(hunger / 20000), 0, 100);
  s.hungerMs = v.satiety > 0 ? hunger % 20000 : 0;
  const starving = v.satiety === 0 ? Math.max(0, ms - Math.ceil(untilEmpty)) : 0;
  let damage = elapsedAfter(s.starvationMs, starving, 30000) * .5 / 1000;
  s.starvationMs = v.satiety === 0 ? Math.min(TIMER_MAX, s.starvationMs + starving) : 0;

  // Personal emergency air replaces consumption; it cannot refill any transferable source.
  const emergency = Math.min(ms, s.emergencyMs);
  s.emergencyMs -= emergency;
  let missing = ms - emergency;
  if (insideCapsule) {
    const used = Math.min(state.world.capsuleMilliGU, missing);
    state.world.capsuleMilliGU -= used; missing -= used;
  }
  if (wornParts(state) === 4) {
    for (const b of state.player.bottles) if (b && missing > 0) {
      const used = Math.min(b.milliGU ?? 0, missing);
      b.milliGU = (b.milliGU ?? 0) - used; missing -= used;
    }
  }
  const breathing = ms - missing;
  if (breathing > 0) {
    s.recoveryMs = Math.min(2000, s.recoveryMs + breathing);
    if (s.recoveryMs >= 2000) s.suffocationMs = 0;
  }
  if (missing > 0) {
    damage += elapsedAfter(s.suffocationMs, missing, 5000) * 4 / 1000;
    s.suffocationMs = Math.min(TIMER_MAX, s.suffocationMs + missing);
    s.recoveryMs = 0;
  }
  v.health = clamp(v.health - damage, 0, 100);
  s.sinceDamageMs = damage > 0 ? 0 : Math.min(TIMER_MAX, s.sinceDamageMs + ms);
  if (v.health <= 0) return 'death';
  if (damage > 0) return 'damage';
  return missing > 0 ? 'warning' : 'none';
}

export function survivalSpeed(state: GameState): number {
  const s = state.player.survival;
  return (s.suffocationMs > 5000 ? .7 : 1) * (state.player.vitals.satiety === 0 && s.starvationMs >= 30000 ? .8 : 1);
}

/** Consumes an existing pulp; a full stomach or cooldown leaves the inventory unchanged. */
export function eatPulp(state: GameState): SurvivalEvent {
  const s = state.player.survival;
  if (state.player.vitals.health <= 0 || s.foodCooldownMs > 0 || state.player.vitals.satiety >= 100) return 'none';
  if (!removeItems(state.player.inventory, 'pulp', 1)) return 'none';
  state.player.vitals.satiety = clamp(state.player.vitals.satiety + 8, 0, 100);
  state.player.vitals.health = clamp(state.player.vitals.health + 1, 0, 100);
  s.starvationMs = 0; s.foodCooldownMs = 5000; return 'ate';
}

/** One shared 20 GU/s budget across installed tanks, bounded by source gas and capsule space. */
export function refillCapsule(state: GameState, dt: number): boolean {
  if (state.player.vitals.health <= 0) return false;
  let left = Math.max(0, Math.min(Math.round(dt * 20000), CAPSULE_CAPACITY - state.world.capsuleMilliGU));
  let moved = 0;
  for (const b of state.player.bottles) if (b && left > 0) {
    const n = Math.min(b.milliGU ?? 0, left);
    b.milliGU = (b.milliGU ?? 0) - n; state.world.capsuleMilliGU += n;
    moved += n; left -= n;
  }
  return moved > 0;
}

/** Transfer cargo once, preserving equipment, gas and the state of every dropped item. */
export function loseCargo(state: GameState) {
  const lost = state.player.inventory.filter((s): s is NonNullable<Slot> => !!s);
  if (lost.length) dropItems(state, state.player.x, state.player.z, lost);
  state.player.inventory = emptyInventory();
  state.player.vitals.health = 0; state.player.survival.emergencyMs = 0;
}

/** Respawn is an explicit transaction; no capsule/tank oxygen or starter items are granted. */
export function respawnAtCapsule(state: GameState, y: number) {
  if (state.player.vitals.health > 0) return false;
  Object.assign(state.player, SPAWN_POSE, { y });
  state.player.vitals = { health: 50, satiety: 40 };
  state.player.survival = freshSurvival();
  if (state.world.capsuleMilliGU === 0) state.player.survival.emergencyMs = EMERGENCY_MS;
  return true;
}

/** HUD reports breathable gas, or the remaining seconds of the personal emergency circuit. */
export function accessibleOxygen(state: GameState, insideCapsule: boolean) {
  const emergency = state.player.survival.emergencyMs;
  if (emergency > 0) return { amount: emergency / 1000, capacity: EMERGENCY_MS / 1000, unit: 'с', emergency: true };
  const sealed = wornParts(state) === 4;
  return {
    amount: (sealed ? oxygenGU(state) : 0) + (insideCapsule ? state.world.capsuleMilliGU / 1000 : 0),
    capacity: (sealed ? oxygenCapacityGU(state) : 0) + (insideCapsule ? CAPSULE_CAPACITY / 1000 : 0),
    unit: 'GU', emergency: false,
  };
}
export const tankCapacity = (slot: NonNullable<Slot>) => TANKS[slot.itemId].capacity / 1000;
