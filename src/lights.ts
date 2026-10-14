import * as THREE from 'three';
/**
 * Fixed point-light pool (S4, 07 §8): 2 lights on Low, 4 otherwise, created at boot and always
 * visible, so the scene's light count — part of every lit shader's program key — never changes
 * when a kiln or dome is placed, packed or loaded (no synchronous recompiles). Real emitters
 * (station PointLights, capsule lamps) stay hidden and only lend position, colour and intensity
 * to the nearest active pool slots each frame.
 */
export type LightSource = { x: number; y: number; z: number; intensity: number; distance: number; priority: number };
/** Emitter priority: kiln fire, dome light, capsule door, cabin interior. */
export const LIGHT_PRIORITY: Record<string, number> = { kiln: 3, dome: 2, door: 1, interior: 0 };
/** Indices of at most `slots` sources that light the area around the viewer: active, reach within `near` m, nearest edge first, higher priority on ties. */
export function assignLights(sources: readonly LightSource[], x: number, y: number, z: number, slots: number, near = 40): number[] {
 const c: [number, number, number][] = [];
 sources.forEach((s, i) => { if (!(s.intensity > .001)) return; const gap = Math.max(0, Math.hypot(s.x - x, s.y - y, s.z - z) - (s.distance || 60)); if (gap <= near) c.push([i, gap, s.priority]); });
 return c.sort((a, b) => a[1] - b[1] || b[2] - a[2] || a[0] - b[0]).slice(0, Math.max(0, slots)).map(v => v[0]);
}
type Emitter = { light: THREE.PointLight; priority: number };
export function createLightPool(scene: THREE.Scene, count = 4) {
 const pool: { light: THREE.PointLight; source: THREE.PointLight | null; fade: number }[] = [];
 const root = new THREE.Group(); root.name = 'light-pool'; scene.add(root);
 const resize = (n: number) => { while (pool.length < n) { const light = new THREE.PointLight('#ffffff', 0, 1, 2); light.name = 'pool-light'; root.add(light); pool.push({ light, source: null, fade: 0 }); } while (pool.length > n) root.remove(pool.pop()!.light); };
 resize(count);
 const fixed: Emitter[] = [], found: Emitter[] = [], world = new THREE.Vector3(), sources: (LightSource & { e: Emitter })[] = [];
 /** Registers a hidden emitter that is always part of the scene (capsule lamps). */
 function add(light: THREE.PointLight, priority: number) { light.visible = false; fixed.push({ light, priority }); }
 /** `roots`: groups scanned every frame for station PointLights (hidden here, before the frame is drawn). Untagged
  * station lights are told apart by reach: the kiln's fire glow is short (3.2 m), the dome lamp wide (6 m). */
 function update(camera: THREE.Camera, dt: number, roots: THREE.Object3D[] = []) {
  found.length = 0;
  for (const r of roots) r.traverse(o => { const l = o as THREE.PointLight; if (!l.isPointLight) return; l.visible = false; found.push({ light: l, priority: LIGHT_PRIORITY[l.userData.emitter as string] ?? (l.distance > 4 ? LIGHT_PRIORITY.dome : LIGHT_PRIORITY.kiln) }); });
  sources.length = 0;
  for (const list of [fixed, found]) for (const e of list) { e.light.getWorldPosition(world); sources.push({ x: world.x, y: world.y, z: world.z, intensity: e.light.intensity, distance: e.light.distance, priority: e.priority, e }); }
  const p = camera.position, pick = assignLights(sources, p.x, p.y, p.z, pool.length).map(i => sources[i]);
  // Slots keep the emitter they already show; only the newly chosen ones move into freed slots (no swap flicker).
  const kept = new Set(pool.map(slot => pick.find(s => s.e.light === slot.source)).filter(Boolean)), fresh = pick.filter(s => !kept.has(s));
  for (const slot of pool) {
   const s = pick.find(v => v.e.light === slot.source) ?? fresh.shift() ?? null, src = s?.e.light ?? null;
   // A slot that changes emitter fades in (frozen dt: instantly, so paused frames stay identical).
   if (src !== slot.source) { slot.source = src; slot.fade = dt > 0 ? 0 : 1; } else slot.fade = Math.min(1, slot.fade + dt * 4);
   const l = slot.light;
   if (!src || !s) { l.intensity = 0; continue; }
   l.position.set(s.x, s.y, s.z); l.color.copy(src.color); l.distance = src.distance; l.decay = src.decay; l.intensity = src.intensity * slot.fade;
  }
 }
 return { add, update, resize, get count() { return pool.length; }, get active() { return pool.filter(s => s.light.intensity > 0).length; }, get emitters() { return fixed.length + found.length; } };
}
export type LightPool = ReturnType<typeof createLightPool>;
