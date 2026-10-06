import { TANKS } from './defs';
import { removeItems, type Slot } from './inventory';
import { oxygenGU } from './backpack';
import type { GameState as WorldState } from './state';

export type SurvivalEvent = 'none' | 'warning' | 'damage' | 'death' | 'ate' | 'refilled';
const GU = 1000;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Advances the active survival simulation by one fixed step. Returns only a UI event. */
export function survivalTick(state: WorldState, dt: number, insideCapsule: boolean): SurvivalEvent {
  const s = state.player.survival;
  s.hungerMs += dt * 1000;
  s.foodCooldownMs = Math.max(0, s.foodCooldownMs - dt * 1000);
  if (s.hungerMs >= 20000) { const n = Math.floor(s.hungerMs / 20000); s.hungerMs -= n * 20000; state.player.vitals.satiety = clamp(state.player.vitals.satiety - n, 0, 100); }
  const bottleO2 = oxygenGU(state);
  let usingCapsule = false;
  if (insideCapsule && state.world.capsuleMilliGU > 0) {
    const used = Math.min(state.world.capsuleMilliGU, Math.round(dt * GU)); state.world.capsuleMilliGU -= used; usingCapsule = true;
  } else if (bottleO2 > 0) {
    let left = Math.round(dt * GU);
    for (const b of state.player.bottles) if (b && left > 0) { const used = Math.min(b.milliGU ?? 0, left); b.milliGU = (b.milliGU ?? 0) - used; left -= used; }
  }
  const breathing = usingCapsule || oxygenGU(state) > 0;
  if (breathing) { s.suffocationMs = 0; s.recoveryMs = Math.min(5000, s.recoveryMs + dt * 1000); }
  else { s.suffocationMs += dt * 1000; s.recoveryMs = 0; }
  if (!breathing && s.suffocationMs > 5000) { state.player.vitals.health = clamp(state.player.vitals.health - 4 * dt, 0, 100); return state.player.vitals.health <= 0 ? 'death' : 'damage'; }
  return breathing ? 'none' : 'warning';
}

/** Consumes one pulp without creating food or health when the action is invalid. */
export function eatPulp(state: WorldState): SurvivalEvent {
  const s = state.player.survival;
  if (s.foodCooldownMs > 0 || state.player.vitals.satiety >= 100) return 'none';
  if (!removeItems(state.player.inventory, 'pulp', 1)) return 'none';
  state.player.vitals.satiety = clamp(state.player.vitals.satiety + 8, 0, 100);
  state.player.vitals.health = clamp(state.player.vitals.health + 1, 0, 100);
  s.foodCooldownMs = 5000; return 'ate';
}

export function refillCapsule(state: WorldState, dt: number): boolean {
  if (state.world.capsuleMilliGU >= 2400000) return false;
  let moved = 0;
  for (const b of state.player.bottles) if (b && (b.milliGU ?? 0) > 0) { const n = Math.min(b.milliGU!, Math.round(dt * 20000), 2400000 - state.world.capsuleMilliGU); b.milliGU! -= n; state.world.capsuleMilliGU += n; moved += n; if (!n) break; }
  return moved > 0;
}

export function oxygenCapacityGUWithCapsule(state: WorldState) { return oxygenGU(state) + state.world.capsuleMilliGU / GU; }
export const tankCapacity = (slot: NonNullable<Slot>) => TANKS[slot.itemId].capacity / GU;
