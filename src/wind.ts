import { reducedMotion } from './motion';
/**
 * One shared world wind (S4). Blows towards +x (west) with a slow ±15° wander; gusts follow the
 * same formula the ambience used. It runs on the scene's own frozen time — nothing moves while the
 * game is paused — and prefers-reduced-motion freezes it entirely. Grass, clouds, dust motes,
 * smoke, chips, wisps and the wind sound all read this one state, so every cue agrees.
 */
export const WIND_WANDER = .26; // ±15°
/** Drift is wrapped at 800 m: a common multiple of the mote boxes (32, 40, 50 m), so the wrap never jumps. */
export const WIND_WRAP = 800;
export function windAt(t: number) {
 const gust = .55 + .45 * Math.sin(t * .23) * Math.sin(t * .071 + 1.3);
 const angle = WIND_WANDER * Math.sin(t * .029 + .7) * (.65 + .35 * Math.cos(t * .0113));
 const speed = .7 + 1.5 * gust;
 return { gust, angle, speed, dirX: Math.cos(angle), dirZ: Math.sin(angle) };
}
export class Wind {
 time = 0; gust = .55; angle = 0; speed = 1.5; dirX = 1; dirZ = 0; vx = 1.5; vz = 0;
 /** Integrated drift (m), wrapped at WIND_WRAP; clouds use their own unwrapped offset. */
 driftX = 0; driftZ = 0; cloudX = 0; cloudZ = 0;
 constructor(private still: () => boolean = reducedMotion) { this.apply(); }
 private apply() { const w = windAt(this.time); this.gust = w.gust; this.angle = w.angle; this.speed = w.speed; this.dirX = w.dirX; this.dirZ = w.dirZ; this.vx = w.dirX * w.speed; this.vz = w.dirZ * w.speed; }
 /** `dt` is the frozen scene step (0 while paused). */
 update(dt: number) {
  if (!(dt > 0) || this.still()) return;
  this.time += dt; this.apply();
  this.driftX = (this.driftX + this.vx * dt) % WIND_WRAP; this.driftZ = (this.driftZ + this.vz * dt) % WIND_WRAP;
  this.cloudX += this.vx * dt * .0026; this.cloudZ += this.vz * dt * .0026;
 }
}
export type WindState = Pick<Wind, 'time' | 'gust' | 'dirX' | 'dirZ' | 'vx' | 'vz' | 'speed'>;
