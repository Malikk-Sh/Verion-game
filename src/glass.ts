import * as THREE from 'three';
import { reducedMotion } from './motion';
import { heightAt, type Box } from './world';
import { allRooms, around, cellCenter, roomCenter, cellKey, cellOf, columnFloor, doorFront, habitableRoom, isGround, roomAtCell, roomsRevision, roomsView, type Door } from './game/rooms';
import type { GameState } from './game/state';
import { buildDoor, type DoorVisual } from './stationModels';
import type { Fx } from './fx';
/**
 * S4 glass rooms on screen (D31): merged face meshes per 16 m chunk (only faces between glass and air are drawn, a
 * skirt hides the gap down to the terrain), airlock door models, one lamp per room, the red tint of a room about to
 * vent, the leak path and the breach jet. Collision boxes live in a 4 m spatial hash, so the controller asks only
 * the blocks around the player. Purely visual apart from those boxes; the rooms themselves are game/rooms.ts.
 */
export const CHUNK = 16, HASH_CELL = 4;
// ---------- Ray through the 1 m grid ----------
export type CellHit = { i: number; k: number; j: number; distance: number; normal: [number, number, number] };
/** Amanatides–Woo walk from `o` along `d` (any length) up to `max` m: the first cell where `solid` holds, skipping the
 *  start cell. `normal` is the face entered, pointing back towards the origin (where a new block would go). */
export function rayCells(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, max: number, solid: (i: number, k: number, j: number) => boolean): CellHit | null {
 const l = Math.hypot(d.x, d.y, d.z); if (!(l > 0)) return null;
 const dx = d.x / l, dy = d.y / l, dz = d.z / l, si = Math.sign(dx), sk = Math.sign(dy), sj = Math.sign(dz);
 let i = Math.floor(o.x), k = Math.floor(o.y), j = Math.floor(o.z);
 const ti = si ? Math.abs(1 / dx) : Infinity, tk = sk ? Math.abs(1 / dy) : Infinity, tj = sj ? Math.abs(1 / dz) : Infinity;
 let ni = si > 0 ? (i + 1 - o.x) / dx : si < 0 ? (o.x - i) / -dx : Infinity, nk = sk > 0 ? (k + 1 - o.y) / dy : sk < 0 ? (o.y - k) / -dy : Infinity, nj = sj > 0 ? (j + 1 - o.z) / dz : sj < 0 ? (o.z - j) / -dz : Infinity;
 for (let guard = 0; guard < 4096; guard++) {
  let t: number, n: [number, number, number];
  if (ni <= nk && ni <= nj) { i += si; t = ni; ni += ti; n = [-si, 0, 0]; } else if (nk <= nj) { k += sk; t = nk; nk += tk; n = [0, -sk, 0]; } else { j += sj; t = nj; nj += tj; n = [0, 0, -sj]; }
  if (t > max) return null;
  if (solid(i, k, j)) return { i, k, j, distance: t, normal: n };
 }
 return null;
}
// ---------- Spatial hash of collision boxes ----------
/** Boxes bucketed on a 4 m XZ grid: a query touches only the buckets under its rectangle (never every block). */
export class SpatialHash {
 private buckets = new Map<number, Box[]>(); private size: number; count = 0;
 constructor(size = HASH_CELL) { this.size = size; }
 private key(bx: number, bz: number) { return (bx + 4096) * 8192 + (bz + 4096); }
 private span(b: Box) { const s = this.size, e = 1e-6; return [Math.floor(b.minX / s), Math.floor((b.maxX - e) / s), Math.floor(b.minZ / s), Math.floor((b.maxZ - e) / s)]; }
 insert(b: Box) { const [x0, x1, z0, z1] = this.span(b); for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const k = this.key(x, z), list = this.buckets.get(k); if (list) list.push(b); else this.buckets.set(k, [b]); } this.count++; }
 remove(b: Box) { const [x0, x1, z0, z1] = this.span(b); let found = false; for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const k = this.key(x, z), list = this.buckets.get(k); if (!list) continue; const at = list.indexOf(b); if (at >= 0) { list.splice(at, 1); found = true; } if (!list.length) this.buckets.delete(k); } if (found) this.count--; }
 clear() { this.buckets.clear(); this.count = 0; }
 /** Boxes whose bucket overlaps [minX, maxX] × [minZ, maxZ], each once, appended to `out`. */
 query(minX: number, minZ: number, maxX: number, maxZ: number, out: Box[] = []) {
  const s = this.size, x0 = Math.floor(minX / s), x1 = Math.floor(maxX / s), z0 = Math.floor(minZ / s), z1 = Math.floor(maxZ / s), start = out.length;
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const list = this.buckets.get(this.key(x, z)); if (list) for (const b of list) if (out.indexOf(b, start) < 0) out.push(b); }
  return out;
 }
}
// ---------- Chunk faces ----------
/** Face table: direction, corner origin offset and edge vectors u, v with u × v = outward normal (CCW from outside). */
const FACES: { d: [number, number, number]; o: [number, number, number]; u: [number, number, number]; v: [number, number, number] }[] = [
 { d: [1, 0, 0], o: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] }, { d: [-1, 0, 0], o: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
 { d: [0, 1, 0], o: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] }, { d: [0, -1, 0], o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] },
 { d: [0, 0, 1], o: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { d: [0, 0, -1], o: [0, 0, 0], u: [0, 1, 0], v: [1, 0, 0] },
];
export const chunkOf = (key: number) => { const c = cellOf(key); return ((Math.floor(c.i / CHUNK) + 64) * 128 + (Math.floor(c.j / CHUNK) + 64)) * 16 + (Math.floor(c.k / CHUNK) + 8); };
export type ChunkGeometry = { position: Float32Array; normal: Float32Array; uv: Float32Array; index: Uint32Array; faces: number; skirts: number };
/** Skirt input: is a cell ground, and the terrain height at a grid corner. */
export type Skirt = { ground: (i: number, k: number, j: number) => boolean; height: (x: number, z: number) => number };
/**
 * Faces of one chunk's glass cells: a quad wherever the neighbour is not `closed` (glass or door), so a wall shows
 * only its two surfaces and blocks never draw faces against each other. With `skirt`, every block resting on ground
 * gets side strips down to the terrain on its open sides (visual only: the honest ground rule does not change).
 */
export function chunkFaces(cells: Iterable<number>, closed: (key: number) => boolean, skirt?: Skirt): ChunkGeometry {
 const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = []; let faces = 0, skirts = 0;
 const quad = (p: number[][], n: readonly number[], t: number[][]) => { const b = pos.length / 3; for (let q = 0; q < 4; q++) { pos.push(...p[q]); nor.push(...n); uv.push(...t[q]); } idx.push(b, b + 1, b + 2, b, b + 2, b + 3); };
 const T = [[0, 0], [1, 0], [1, 1], [0, 1]];
 for (const key of cells) {
  const c = cellOf(key), sides: number[] = [];
  for (let f = 0; f < 6; f++) {
   const F = FACES[f], n = cellKey(c.i + F.d[0], c.k + F.d[1], c.j + F.d[2]); if (closed(n)) continue;
   const p0 = [c.i + F.o[0], c.k + F.o[1], c.j + F.o[2]], p1 = p0.map((v, a) => v + F.u[a]), p3 = p0.map((v, a) => v + F.v[a]), p2 = p1.map((v, a) => v + F.v[a]);
   quad([p0, p1, p2, p3], F.d, T); faces++; if (F.d[1] === 0) sides.push(f);
  }
  if (!skirt || !skirt.ground(c.i, c.k - 1, c.j)) continue;
  // Bottom edge of each open side, down to the terrain at its two corners (only where the terrain is below the block).
  for (const f of sides) {
   const F = FACES[f], a = [c.i + F.o[0], c.j + F.o[2]], b = F.d[0] ? [a[0], a[1] + 1] : [a[0] + 1, a[1]];
   const ha = skirt.height(a[0], a[1]), hb = skirt.height(b[0], b[1]); if (ha >= c.k - .001 && hb >= c.k - .001) continue;
   const lo = (h: number) => Math.min(c.k, h) - .04, top = c.k;
   // Corners ordered so the strip faces outwards like the side above it.
   const flip = F.d[0] > 0 || F.d[2] < 0, A = flip ? b : a, B = flip ? a : b, hA = flip ? hb : ha, hB = flip ? ha : hb;
   quad([[A[0], lo(hA), A[1]], [B[0], lo(hB), B[1]], [B[0], top, B[1]], [A[0], top, A[1]]], F.d, [[0, .5], [1, .5], [1, .5], [0, .5]]); skirts++;
  }
 }
 return { position: new Float32Array(pos), normal: new Float32Array(nor), uv: new Float32Array(uv), index: new Uint32Array(idx), faces, skirts };
}
// ---------- Renderer ----------
/** 6 cm dark frame round each block face over clear blue-tinted glass (alpha in the texture, mipmapped). */
export function frameTexture() {
 const n = 128, b = Math.round(n * .06), c = document.createElement('canvas'); c.width = c.height = n; const x = c.getContext('2d')!;
 x.fillStyle = 'rgba(30,38,42,.88)'; x.fillRect(0, 0, n, n); x.clearRect(b, b, n - 2 * b, n - 2 * b);
 x.fillStyle = 'rgba(196,232,240,.13)'; x.fillRect(b, b, n - 2 * b, n - 2 * b);
 x.strokeStyle = 'rgba(235,252,255,.42)'; x.lineWidth = 1.5; x.strokeRect(b + 1, b + 1, n - 2 * b - 2, n - 2 * b - 2);
 const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
/** Transparent glass: no depth writes, slightly blue, the frame from the texture and a fresnel rim at grazing angles. */
export function glassMaterial(map: THREE.Texture | null = null) {
 const m = new THREE.MeshStandardMaterial({ color: 0xdcf4f8, map, transparent: true, opacity: 1, roughness: .06, metalness: .15, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.2 });
 m.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>', 'float vFres = pow( 1.0 - clamp( abs( dot( normalize( vViewPosition ), normal ) ), 0.0, 1.0 ), 3.0 );\ndiffuseColor.a = clamp( diffuseColor.a + vFres * 0.5, 0.0, 0.92 );\n#include <opaque_fragment>'); };
 m.customProgramCacheKey = () => 'vireon-glass'; return m;
}
const ROOM_LIGHT = '#cdf7f0';
export function createGlassView(root: THREE.Group, fx?: Fx) {
 const group = new THREE.Group(); group.name = 'glass'; root.add(group);
 const mat = glassMaterial(frameTexture());
 // An empty mesh puts the glass program into the boot-time compile, then hides itself after the first frame (a draw of
 // zero vertices still counts as a call).
 const warm = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, -999, 0, 0, -999, 0, 0, -999, 0], 3)).setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3)).setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2)), mat);
 warm.geometry.setDrawRange(0, 0); warm.frustumCulled = false; warm.onAfterRender = () => { warm.visible = false; }; group.add(warm);
 const chunks = new Map<number, { cells: Set<number>; mesh: THREE.Mesh | null }>();
 const hash = new SpatialHash(), solids = new Map<number, Box>(), doors = new Map<string, { d: Door; v: DoorVisual; box: Box }>();
 const skirt: Skirt = { ground: isGround, height: heightAt };
 let rev = -1, glass = new Set<number>(), doorCells = new Set<number>();
 const cube = (id: string, x0: number, y0: number, z0: number, h = 1): Box => ({ id, minX: x0, maxX: x0 + 1, minY: y0, maxY: y0 + h, minZ: z0, maxZ: z0 + 1 });
 function rebuild(id: number) {
  const c = chunks.get(id); if (!c) return;
  if (c.mesh) { group.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; }
  if (!c.cells.size) { chunks.delete(id); return; }
  const f = chunkFaces(c.cells, k => glass.has(k) || doorCells.has(k), skirt);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(f.position, 3)); g.setAttribute('normal', new THREE.BufferAttribute(f.normal, 3)); g.setAttribute('uv', new THREE.BufferAttribute(f.uv, 2)); g.setIndex(new THREE.BufferAttribute(f.index, 1)); g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, mat); mesh.renderOrder = 2; mesh.name = 'glass-chunk'; c.mesh = mesh; group.add(mesh);
 }
 // ---------- Room lamps: one emissive ceiling plate per room (one draw call) and one pooled point light each ----------
 const lampMat = new THREE.MeshBasicMaterial({ color: '#ffffff' }), lampOn = new THREE.Color('#d6fff8'), lampOff = new THREE.Color('#2c3638'), lampColor = new THREE.Color();
 const lampGeo = new THREE.BoxGeometry(.5, .03, .5);
 let lamps: THREE.InstancedMesh | null = null; const lights: THREE.PointLight[] = []; let roomCells: number[] = [], glow: number[] = [], lampClock = 0, centers: { x: number; y: number; z: number }[] = [];
 function syncLamps(g: GameState) {
  const rooms = allRooms(g); if (lamps) { group.remove(lamps); lamps.dispose(); lamps = null; }
  while (lights.length > rooms.length) group.remove(lights.pop()!);
  roomCells = rooms.map(r => r.cell); glow = rooms.map((_, i) => glow[i] ?? 0); centers = rooms.map(roomCenter);
  if (!rooms.length) return;
  lamps = new THREE.InstancedMesh(lampGeo, lampMat, rooms.length); lamps.name = 'room-lamps'; const m = new THREE.Matrix4(); for (let i = 0; i < rooms.length; i++) lamps.setColorAt(i, lampOff);
  rooms.forEach((r, n) => {
   // Under the ceiling of the room column nearest its centre.
   let x = 0, z = 0; for (const c of r.cells) { const p = cellCenter(c); x += p.x; z += p.z; } x /= r.volume; z /= r.volume;
   let best = r.cells[0], d = Infinity; for (const c of r.cells) { const p = cellCenter(c), e = Math.hypot(p.x - x, p.z - z) - p.y * 1e-3; if (e < d - 1e-6) { d = e; best = c; } }
   const top = cellOf(best); let k = top.k; for (const c of r.cells) { const q = cellOf(c); if (q.i === top.i && q.j === top.j) k = Math.max(k, q.k); }
   const px = top.i + .5, py = k + 1 - .03, pz = top.j + .5; m.makeTranslation(px, py, pz); lamps!.setMatrixAt(n, m);
   const light = lights[n] ?? new THREE.PointLight(ROOM_LIGHT, 0, 6, 1.6); light.userData.emitter = 'room'; light.distance = Math.min(12, 4 + Math.sqrt(r.volume)); light.position.set(px, py - .25, pz); if (!lights[n]) { lights[n] = light; group.add(light); }
  });
  group.add(lamps);
 }
 // ---------- Highlights: a room about to vent (red shell), the leak path (red cubes) ----------
 const red = new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: .32, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 });
 let tint: { mesh: THREE.Mesh; left: number } | null = null, leak: { mesh: THREE.InstancedMesh; left: number } | null = null;
 const leakGeo = new THREE.BoxGeometry(.5, .5, .5);
 function clearTint() { if (tint) { group.remove(tint.mesh); tint.mesh.geometry.dispose(); tint = null; } }
 /** Tints the inside of the rooms beside `key` red for `seconds` (the confirmation before air leaves). */
 function tintRooms(g: GameState, key: number, seconds = 3) {
  clearTint(); const cells = new Set<number>(); for (const n of around(key)) { const r = roomAtCell(g, n); if (r) for (const c of r.cells) cells.add(c); }
  if (!cells.size) return;
  const f = chunkFaces(cells, k => cells.has(k) || isGround(cellOf(k).i, cellOf(k).k, cellOf(k).j));
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(f.position, 3)); geo.setIndex(new THREE.BufferAttribute(f.index, 1));
  // Inner surfaces: the faces of the air cells, pulled 3 cm inwards so they sit inside the glass.
  const p = geo.attributes.position as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) { const n = f.normal.subarray(i * 3, i * 3 + 3); p.setXYZ(i, p.getX(i) - n[0] * .03, p.getY(i) - n[1] * .03, p.getZ(i) - n[2] * .03); }
  geo.computeBoundingSphere(); const mesh = new THREE.Mesh(geo, red); mesh.renderOrder = 3; group.add(mesh); tint = { mesh, left: seconds };
 }
 /** Marks the leak path (cells from the structure to open air) for `seconds`. */
 function showLeak(path: number[], seconds = 6) {
  if (leak) { group.remove(leak.mesh); leak.mesh.dispose(); leak = null; } if (!path.length) return;
  const mesh = new THREE.InstancedMesh(leakGeo, red, path.length), m = new THREE.Matrix4(); path.forEach((c, i) => { const p = cellCenter(c); mesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)); });
  mesh.renderOrder = 3; group.add(mesh); leak = { mesh, left: seconds };
 }
 // ---------- Breach: 2 s of hiss and steam/dust out of the opening ----------
 let vent: { x: number; y: number; z: number; n: { x: number; y: number; z: number }; left: number; next: number } | null = null;
 /** Call before the edit is synced: the jet points away from the centre of the room that was there (the air leaves outwards). */
 function breach(at: { x: number; y: number; z: number }) {
  const c = centers.reduce<{ x: number; y: number; z: number } | null>((b, v) => !b || Math.hypot(v.x - at.x, v.y - at.y, v.z - at.z) < Math.hypot(b.x - at.x, b.y - at.y, b.z - at.z) ? v : b, null);
  const dx = c ? at.x - c.x : 0, dy = c ? at.y - c.y : 1, dz = c ? at.z - c.z : 0, l = Math.hypot(dx, dy, dz) || 1;
  vent = { ...at, n: { x: dx / l, y: dy / l + .1, z: dz / l }, left: 2, next: 0 };
 }
 function sync(g: GameState) {
  const r = roomsRevision(g); if (r === rev) return false; rev = r;
  const view = roomsView(g.world.base), nextDoors = new Map(g.world.base.doors.map(d => [d.id, d])), nextDoorCells = new Set(view.doorAt.keys()), dirty = new Set<number>();
  const touch = (key: number) => { dirty.add(chunkOf(key)); for (const n of around(key)) dirty.add(chunkOf(n)); };
  for (const k of glass) if (!view.glass.has(k)) { touch(k); chunks.get(chunkOf(k))?.cells.delete(k); const b = solids.get(k); if (b) { hash.remove(b); solids.delete(k); } }
  for (const k of view.glass) if (!glass.has(k)) { touch(k); const id = chunkOf(k); let c = chunks.get(id); if (!c) chunks.set(id, c = { cells: new Set(), mesh: null }); c.cells.add(k); const p = cellOf(k), b = cube('glass-' + k, p.i, p.k, p.j); solids.set(k, b); hash.insert(b); }
  for (const k of doorCells) if (!nextDoorCells.has(k)) touch(k);
  for (const k of nextDoorCells) if (!doorCells.has(k)) touch(k);
  glass = new Set(view.glass); doorCells = nextDoorCells;
  for (const [id, s] of doors) { const d = nextDoors.get(id); if (!d || d.x !== s.d.x || d.y !== s.d.y || d.z !== s.d.z || d.rot !== s.d.rot) { group.remove(s.v.group); s.v.dispose(); hash.remove(s.box); doors.delete(id); } }
  for (const d of g.world.base.doors) if (!doors.has(d.id)) {
   const v = buildDoor(); v.group.position.set(d.x + .5, d.y, d.z + .5); v.group.rotation.y = d.rot * Math.PI / 2; v.group.name = d.id;
   // A plinth under the threshold down to the lowest terrain corner (visual only, like the glass skirt).
   const drop = d.y - columnFloor(d.x, d.z); if (drop > .02) { const base = v.group.children[0] as THREE.Mesh, plinth = new THREE.Mesh(new THREE.BoxGeometry(.96, drop + .06, .96), base.material); plinth.position.y = -(drop + .06) / 2 + .02; plinth.receiveShadow = true; v.group.add(plinth); }
   const box = cube('build-' + d.id, d.x, d.y, d.z, 2); hash.insert(box); doors.set(d.id, { d: { ...d }, v, box }); group.add(v.group);
  }
  for (const id of dirty) if (chunks.has(id)) rebuild(id);
  syncLamps(g);
  return true;
 }
 function reset() { for (const c of chunks.values()) if (c.mesh) { group.remove(c.mesh); c.mesh.geometry.dispose(); } chunks.clear(); for (const s of doors.values()) { group.remove(s.v.group); s.v.dispose(); } doors.clear(); hash.clear(); solids.clear(); glass = new Set(); doorCells = new Set(); rev = -1; clearTint(); showLeak([]); vent = null; }
 /** `dt` is real frame time (0 while frozen). */
 function update(g: GameState, dt: number) {
  const still = reducedMotion(), p = g.world.base.passage;
  for (const s of doors.values()) {
   // Outer shutter opens early in an inbound cycle and late in an outbound one; the inner one the other way round.
   const cycle = p?.doorId === s.d.id && p.remainingMs > 0, t = cycle ? 1 - p!.remainingMs / 6000 : 0, open = (a: number) => cycle ? Math.max(0, Math.sin(Math.PI * THREE.MathUtils.clamp((t - a) / .35, 0, 1))) : 0;
   const first = open(.02), last = open(.6), outer = p?.direction === 'out' ? last : first, inner = p?.direction === 'out' ? first : last;
   const room = roomBeside(g, s.d); s.v.update(dt, { status: cycle ? 'warn' : room && habitableRoom(room) ? 'work' : room ? 'idle' : 'off', outer, inner }, still);
  }
  lampClock -= dt; if (lampClock <= 0 && lamps) { lampClock = .25; const rooms = allRooms(g); glow = roomCells.map(c => { const r = rooms.find(v => v.cell === c); return r && habitableRoom(r) ? 1 : 0; }); }
  // Lamp plates and lights ease towards the room's state (habitable: lit); reduced motion switches at once.
  if (lamps && (dt > 0 || still)) { const k = still ? 1 : Math.min(1, dt * 2); lights.forEach((l, i) => { l.intensity = THREE.MathUtils.lerp(l.intensity, (glow[i] ?? 0) * 3.2, k); lamps!.setColorAt(i, lampColor.copy(lampOff).lerp(lampOn, l.intensity / 3.2)); }); lamps.instanceColor!.needsUpdate = true; }
  if (tint && (tint.left -= dt) <= 0) clearTint();
  if (tint) red.opacity = .22 + (still ? .1 : Math.abs(Math.sin(performance.now() / 160)) * .14);
  if (leak && (leak.left -= dt) <= 0) showLeak([]);
  if (vent && fx && dt > 0) { vent.left -= dt; vent.next -= dt; if (vent.next <= 0) { vent.next = .1; fx.vent(vent.x, vent.y, vent.z, vent.n, vent.left / 2); } if (vent.left <= 0) vent = null; }
 }
 const roomBeside = (g: GameState, d: Door) => { const f = doorFront(d.rot), a = roomAtCell(g, cellKey(d.x + f.x, d.y, d.z + f.z)), b = roomAtCell(g, cellKey(d.x - f.x, d.y, d.z - f.z)); return a && habitableRoom(a) ? a : b ?? a; };
 return {
  sync, reset, update, tintRooms, clearTint, showLeak, breach, group,
  /** Glass and door boxes overlapping the XZ rectangle (the controller's neighbourhood). */
  query: (minX: number, minZ: number, maxX: number, maxZ: number, out: Box[]) => hash.query(minX, minZ, maxX, maxZ, out),
  /** A breach jet is playing. */
  get venting() { return !!vent; },
  stats: () => ({ chunks: [...chunks.values()].filter(c => c.mesh).length, faces: [...chunks.values()].reduce((a, c) => a + ((c.mesh?.geometry.index?.count ?? 0) / 6), 0), doors: doors.size, lamps: lamps?.count ?? 0, boxes: hash.count }),
  };
}
export type GlassView = ReturnType<typeof createGlassView>;
