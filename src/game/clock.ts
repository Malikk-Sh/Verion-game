/**
 * The single game clock (TECHNICAL §3). Active time is an integer count of 50 ms ticks;
 * frames only feed an accumulator. At most five ticks run per frame; a frame gap larger than
 * 250 ms is not "caught up" — the surplus is dropped, so the game never fast-forwards.
 * stop() (pause, hidden tab, portrait) clears the accumulator: a resumed frame never
 * replays the time spent away. There is no wall-clock catch-up anywhere.
 */
export const TICK_MS = 50;
export const MAX_STEPS = 5;
export const MAX_LAG_MS = 250;
export class SimClock {
 activeTicks = 0;
 private accumulator = 0;
 private stopped = true;
 constructor(activeTicks = 0) { this.activeTicks = activeTicks; }
 get running() { return !this.stopped; }
 get alpha() { return this.accumulator / TICK_MS; }
 start() { this.stopped = false; this.accumulator = 0; }
 stop() { this.stopped = true; this.accumulator = 0; }
 /** Returns how many fixed ticks to simulate for this frame. */
 advance(frameMs: number): number {
  if (this.stopped || !(frameMs > 0)) return 0;
  this.accumulator += Math.min(frameMs, MAX_LAG_MS);
  let steps = Math.floor(this.accumulator / TICK_MS);
  if (steps > MAX_STEPS) { steps = MAX_STEPS; this.accumulator = 0; } else this.accumulator -= steps * TICK_MS;
  this.activeTicks += steps;
  return steps;
 }
 get activeSeconds() { return this.activeTicks * TICK_MS / 1000; }
}
