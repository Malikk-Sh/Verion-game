import { TICK_MS } from './clock';
/**
 * Verdana day cycle (WORLD §1): 600 s day + 360 s night of *active* game time. The phase is
 * derived from the single SimClock (meta.activeTicks) plus a persistent offset, so it stops
 * in pause/background exactly like every other simulation. The Sun/Moon button only shifts the
 * offset (a convenience skip of the light phase); it never changes activeTicks.
 */
export const DAY_S = 600, NIGHT_S = 360, CYCLE_S = DAY_S + NIGHT_S;
export const CYCLE_TICKS = CYCLE_S * 1000 / TICK_MS;
const S = 1000 / TICK_MS;
/** A new world starts in the late morning (200 s into the day). */
export const START_OFFSET_TICKS = 200 * S;
/** Where the Sun/Moon button jumps: soon after sunrise or soon after sunset. */
export const MORNING_S = 45, EVENING_S = DAY_S + 25;
export function phaseSeconds(activeTicks: number, offsetTicks: number) {
 const t = ((activeTicks + offsetTicks) % CYCLE_TICKS + CYCLE_TICKS) % CYCLE_TICKS;
 return t / S;
}
export const isDay = (t: number) => t < DAY_S;
/** Returns the new offset that puts the phase at `targetS` without touching activeTicks. */
export function offsetFor(activeTicks: number, targetS: number) {
 return ((Math.round(targetS * S) - activeTicks) % CYCLE_TICKS + CYCLE_TICKS) % CYCLE_TICKS;
}
/** Sun direction for a phase: rises in the east (−x), crosses the southern sky, sets in the west (+x). */
export function sunDirection(t: number): [number, number, number] {
 const theta = t < DAY_S ? Math.PI * t / DAY_S : Math.PI + Math.PI * (t - DAY_S) / NIGHT_S;
 const elev = .84 * Math.sin(theta);
 let hx = -Math.cos(theta), hz = .3 - .45 * Math.sin(theta); const hl = Math.hypot(hx, hz); hx /= hl; hz /= hl;
 return [hx * Math.cos(elev), Math.sin(elev), hz * Math.cos(elev)];
}
/** 0 in full day, 1 in full night; smooth around the horizon (≈30 s twilight). */
export function nightAmount(t: number) {
 const y = sunDirection(t)[1], a = Math.min(1, Math.max(0, (y + .1) / .2));
 return 1 - a * a * (3 - 2 * a);
}
