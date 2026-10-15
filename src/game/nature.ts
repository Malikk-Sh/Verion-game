import { NODES, nodeCovered, bodyHalf, PATCH_NODES, SHARED_PATCH_SPLIT, FINITE_NODES, VEIN_LOOK, VEIN_MATERIALS, VEIN_SPOTS, VEIN_SPOT_BY_ID, veinSizeRange, type ResourceNode, type VeinMaterial, type VeinSpot, type Vein } from './resources';
import type { GameState } from './state';
import { domeFront } from './production';
import { GRASS, random } from '../world';
/** Rendered tufts of each grass deposit: centre and horizontal reach (leaves 0.48 m × instance scale, plus wind sway). */
const TUFTS = new Map<string, { x: number; z: number; r: number }[]>();
for (const t of GRASS) if (t.patch >= 0) {
 const ids = PATCH_NODES.get(t.patch) ?? [], id = t.patch === 0 ? ids.find(id => (t.x < SHARED_PATCH_SPLIT) === (id === 'grass-a')) : ids[0];
 if (id) TUFTS.set(id, [...(TUFTS.get(id) ?? []), { x: t.x, z: t.z, r: .48 * t.s * 1.35 + .07 }]);
}
/** Whether a square body footprint (centre x, z, half-size h) covers part of a deposit as drawn: a grass tuft's leaves,
 *  else the deposit's collider or radius. */
export function covers(n: ResourceNode, x: number, z: number, h: number): boolean {
 const tufts = TUFTS.get(n.id);
 if (!tufts) return nodeCovered(n, x, z, h);
 return tufts.some(t => Math.hypot(Math.max(0, Math.abs(x - t.x) - h), Math.max(0, Math.abs(z - t.z) - h)) < t.r);
}
/**
 * Regrowth of local grass in *active* time only (WORLD §2). A patch below its amount gains one
 * plant per `regrowSeconds`; a full patch keeps no accumulated time, so a long idle period never
 * produces a burst. A patch under a body does not grow (WORLD §2: only while not built over).
 * Returns the ids of deposits whose stock changed.
 */
const builtOver = (g: GameState, n: ResourceNode) => g.world.base.buildings.some(b => covers(n, b.x, b.z, bodyHalf(b.kind)));
export function natureTick(g: GameState, ms: number, nowTicks = g.meta.activeTicks): string[] {
 const changed: string[] = [];
 for (const n of NODES) {
  if (!n.regrowSeconds) continue;
  const period = n.regrowSeconds * 1000;
  let left = g.world.nodes[n.id] ?? 0;
  if (left >= n.amount) { if (g.world.regrow[n.id]) delete g.world.regrow[n.id]; continue; }
  if (builtOver(g, n)) continue;
  let acc = (g.world.regrow[n.id] ?? 0) + Math.max(0, ms);
  while (acc >= period && left < n.amount) { acc -= period; left++; }
  if (left >= n.amount) { delete g.world.regrow[n.id]; } else g.world.regrow[n.id] = Math.min(acc, period);
  if (left !== g.world.nodes[n.id]) { g.world.nodes[n.id] = left; changed.push(n.id); }
 }
 respawnTick(g, ms, nowTicks, changed);
 return changed;
}
/** Seconds until the next plant of a regrowing deposit, or null when full / not renewable. */
export function nextRegrowSeconds(g: GameState, id: string): number | null {
 const n = NODES.find(v => v.id === id);
 if (!n?.regrowSeconds || (g.world.nodes[id] ?? 0) >= n.amount || builtOver(g, n)) return null;
 return Math.max(0, n.regrowSeconds - (g.world.regrow[id] ?? 0) / 1000);
}

// ---------- S4 (D33): exhausted deposits come back as new veins at fixed spots ----------
/** B0: 300 s of active time ±25 % until a queued vein appears; a blocked spawn retries every 10 s. */
export const VEIN_DELAY_MS = 300000, VEIN_JITTER = .25, VEIN_RETRY_MS = 10000;
export const VEIN_DELAY_RANGE = [Math.round(VEIN_DELAY_MS * (1 - VEIN_JITTER)), Math.round(VEIN_DELAY_MS * (1 + VEIN_JITTER))] as const;
/** At most 3 live veins of a material and 15 in all; the queue never outgrows the finite static deposits. */
export const VEIN_CAP = 3, VEIN_TOTAL = 15, RESPAWN_MAX = FINITE_NODES.length;
/** A spawn keeps 24 m from the player and 8 m from another vein or a deposit with stock. */
export const VEIN_PLAYER_CLEAR = 24, VEIN_GAP = 8;
/** Deterministic roll in [0, 1): the world seed, a counter and a salt (never Math.random, so replays match). */
export const veinRoll = (seed: number, counter: number, salt: number) => random((seed ^ Math.imul(counter * 97 + salt + 1, 2654435761)) >>> 0)();
/** Seeded delay of a queued vein (integer ms inside VEIN_DELAY_RANGE). */
export const veinDelay = (seed: number, counter: number, material: VeinMaterial) => Math.round(VEIN_DELAY_MS * (1 - VEIN_JITTER + 2 * VEIN_JITTER * veinRoll(seed, counter, 11 + VEIN_MATERIALS.indexOf(material))));
/** Queues one new vein of a material (a deposit just ran out). Grass regrows instead. */
export function queueRespawn(g: GameState, material: string) {
 const m = material as VeinMaterial; if (!VEIN_MATERIALS.includes(m) || g.world.respawn.length >= RESPAWN_MAX) return;
 g.world.respawn.push({ material: m, ms: veinDelay(g.meta.seed, g.world.nextVeinId * 32 + g.world.respawn.length, m) });
}
/** Why a fixed spot cannot take a new vein right now ('' when free): a body or an airlock landing on it, the player
 *  close by, another vein or a stocked deposit within 8 m. The static checks (slope, colliders, zones) are done in the data. */
export function veinSpotBlocked(g: GameState, s: VeinSpot): string {
 const [w, , d] = VEIN_LOOK[s.material].box, hx = w / 2 * 1.08 + .5, hz = d / 2 * 1.08 + .5;
 const over = (x: number, z: number, h: number) => Math.abs(x - s.x) < hx + h && Math.abs(z - s.z) < hz + h;
 for (const b of g.world.base.buildings) {
  if (over(b.x, b.z, bodyHalf(b.kind))) return 'постройка';
  if (b.kind === 'dome') { const f = domeFront(b); if (over(b.x + f.x, b.z + f.z, .45) || over(b.x + f.x * 3.5, b.z + f.z * 3.5, .45)) return 'выход шлюза'; }
 }
 if (Math.hypot(g.player.x - s.x, g.player.z - s.z) < VEIN_PLAYER_CLEAR) return 'игрок рядом';
 for (const v of g.world.veins) { const o = VEIN_SPOT_BY_ID.get(v.spot); if (o && Math.hypot(o.x - s.x, o.z - s.z) < VEIN_GAP) return 'другая жила'; }
 for (const n of NODES) if ((g.world.nodes[n.id] ?? 0) > 0 && Math.hypot(n.x - s.x, n.z - s.z) < VEIN_GAP) return 'залежь рядом';
 return '';
}
/** Places one vein of `m` at a seeded free spot; null when every spot is blocked. */
export function spawnVein(g: GameState, m: VeinMaterial, nowTicks: number): Vein | null {
 const free = VEIN_SPOTS.filter(s => s.material === m && !veinSpotBlocked(g, s)); if (!free.length) return null;
 const n = g.world.nextVeinId, spot = free[Math.floor(veinRoll(g.meta.seed, n, 1) * free.length)], [lo, hi] = veinSizeRange(m);
 const size = Math.min(hi, Math.max(lo, Math.round(VEIN_LOOK[m].size * (.75 + .5 * veinRoll(g.meta.seed, n, 2)))));
 const v: Vein = { id: 'vein-' + n, spot: spot.id, material: m, amount: size, size, spawnedAt: Math.max(0, Math.floor(nowTicks)) };
 g.world.nextVeinId = n + 1; g.world.veins.push(v); return v;
}
/** Counts the queue down in active time; a due entry spawns, waits at 0 while its material is capped, or retries in 10 s. */
function respawnTick(g: GameState, ms: number, nowTicks: number, changed: string[]) {
 const q = g.world.respawn; if (!q.length) return;
 for (let i = 0; i < q.length; i++) {
  const e = q[i]; e.ms = Math.max(0, e.ms - Math.max(0, Math.round(ms))); if (e.ms > 0) continue;
  if (g.world.veins.length >= VEIN_TOTAL || g.world.veins.filter(v => v.material === e.material).length >= VEIN_CAP) continue;
  const v = spawnVein(g, e.material, nowTicks);
  if (!v) { e.ms = VEIN_RETRY_MS; continue; }
  q.splice(i--, 1); changed.push(v.id);
 }
}
/** Seconds until the next queued vein of an item's material (null when none is queued); the workshop hint uses it. */
export function nextVeinSeconds(g: GameState, itemId: string): number | null {
 const m = VEIN_MATERIALS.find(m => VEIN_LOOK[m].itemId === itemId); if (!m) return null;
 const due = g.world.respawn.filter(e => e.material === m).map(e => e.ms); return due.length ? Math.ceil(Math.min(...due) / 1000) : null;
}
