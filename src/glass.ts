import * as THREE from 'three';
import { reducedMotion } from './motion';
import { heightAt, type Box } from './world';
import { allRooms, around, cellCenter, cellY, levelAt, roomCenter, cellKey, cellOf, columnFloor, doorCenter, doorColumns, doorById, habitableRoom, isGround, roomAtCell, roomsRevision, roomsView, widthOf, type Door, type DoorFace } from './game/rooms';
import { CHAMBER_Q, LINTEL, doorBoxes, doorLamp, doorPhase, shownPressure, simOpen } from './game/airlock';
import type { GameState } from './game/state';
import { buildDoor, type DoorVisual } from './stationModels';
import type { Fx } from './fx';
/**
 * S4 glass rooms on screen (D31), frameless since S5 (D35): faces are built per 16 m chunk (only faces between glass and
 * air are drawn, a skirt hides the gap down to the terrain, a thin dark trim marks the structure's edges) and all chunks
 * are joined into ONE mesh with one material (one draw call, never in the shadow map); airlock door models, one lamp per
 * room, the red tint of a room about to vent, the leak path and the breach jet. Airlock modules (D36): their models, the
 * sliding leaves eased from the simulation, the lamps and screen, steam and sounds while cycling, and their colliders. Collision boxes live in a 4 m spatial hash, so the controller asks only
 * the blocks around the player. Purely visual apart from those boxes; the rooms themselves are game/rooms.ts.
 */
export const CHUNK = 16, HASH_CELL = 4;
// ---------- Ray through the 1 m grid ----------
export type CellHit = { i: number; k: number; j: number; distance: number; normal: [number, number, number] };
/** Amanatides–Woo walk from `o` along `d` (any length) up to `max` m over the cell lattice (levels from cellY): the first
 *  cell where `solid` holds, skipping the start cell. `normal` is the face entered, pointing back towards the origin
 *  (where a new block would go). */
export function rayCells(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, max: number, solid: (i: number, k: number, j: number) => boolean): CellHit | null {
 const l = Math.hypot(d.x, d.y, d.z); if (!(l > 0)) return null;
 const dx = d.x / l, dy = d.y / l, dz = d.z / l, si = Math.sign(dx), sk = Math.sign(dy), sj = Math.sign(dz);
 let i = Math.floor(o.x), k = levelAt(o.y), j = Math.floor(o.z);
 const ti = si ? Math.abs(1 / dx) : Infinity, tk = sk ? Math.abs(1 / dy) : Infinity, tj = sj ? Math.abs(1 / dz) : Infinity;
 let ni = si > 0 ? (i + 1 - o.x) / dx : si < 0 ? (o.x - i) / -dx : Infinity, nk = sk > 0 ? (cellY(k + 1) - o.y) / dy : sk < 0 ? (o.y - cellY(k)) / -dy : Infinity, nj = sj > 0 ? (j + 1 - o.z) / dz : sj < 0 ? (o.z - j) / -dz : Infinity;
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
/** `trim` per vertex: 0 = clear glass, 1 = dark metal (edge trim and skirt), read by the one glass material. */
export type ChunkGeometry = { position: Float32Array; normal: Float32Array; trim: Float32Array; index: Uint32Array; faces: number; skirts: number; trims: number };
/** Skirt input: is a cell ground, and the terrain height at a grid corner. */
export type Skirt = { ground: (i: number, k: number, j: number) => boolean; height: (x: number, z: number) => number };
/** Trim input: glass or door cells (`solid`) and door cells alone; ground and air are neither. */
export type Edges = { solid: (key: number) => boolean; door: (key: number) => boolean };
/** Half width of the edge trim (6 cm square bars on the edge lines). */
export const TRIM = .03;
const AXES: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
/** Continuous inverse of cellY for vertex heights given in world metres (quad() takes levels). */
const levelOfY = (y: number) => y - cellY(0);
/**
 * Faces of one chunk's glass cells: a quad wherever the neighbour is not `closed`, so a wall shows only its two surfaces
 * and blocks never draw faces against each other. With `skirt`, every block resting on ground gets side strips down to
 * the terrain on its open sides (visual only: the honest ground rule does not change). With `edges`, a thin bar marks
 * each edge of a drawn face where the structure ends (D35): the cell beside it in the face's plane is not solid (outer
 * corners, the top rim, wall ends, the line on the ground) or is an airlock (its frame). Between two blocks of one wall
 * and along inner corners (where the glass folds inwards) there is no line. Edges are deduplicated within the chunk.
 */
export function chunkFaces(cells: Iterable<number>, closed: (key: number) => boolean, skirt?: Skirt, edges?: Edges): ChunkGeometry {
 const pos: number[] = [], nor: number[] = [], tr: number[] = [], idx: number[] = []; let faces = 0, skirts = 0, trims = 0;
 // Corners in (x, level, z); the level coordinate becomes world y through cellY.
 const quad = (p: number[][], n: readonly number[], t: number) => { const b = pos.length / 3; for (let q = 0; q < 4; q++) { pos.push(p[q][0], cellY(p[q][1]), p[q][2]); nor.push(n[0], n[1], n[2]); tr.push(t); } idx.push(b, b + 1, b + 2, b, b + 2, b + 3); };
 const seen = new Set<number>();
 // One bar along `axis` from lattice point p, 1 m long plus the half width at both ends (corners overlap, no caps).
 const bar = (p: number[], axis: number) => {
  const id = (((p[0] + 300) * 1024 + (p[2] + 300)) * 256 + (p[1] + 64)) * 3 + axis; if (seen.has(id)) return; seen.add(id); trims++;
  const a = AXES[axis], L = 1 + 2 * TRIM;
  for (const n of AXES.filter((_, m) => m !== axis).flatMap(v => [v, v.map(x => -x)])) {
   // U = a·L, V = t·2w with t = n × a, so U × V points along n (outwards).
   const t = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]], q0 = [0, 1, 2].map(m => p[m] - a[m] * TRIM + n[m] * TRIM - t[m] * TRIM);
   const q1 = q0.map((v, m) => v + a[m] * L), q3 = q0.map((v, m) => v + t[m] * 2 * TRIM), q2 = q1.map((v, m) => v + t[m] * 2 * TRIM);
   quad([q0, q1, q2, q3], n, 1);
  }
 };
 for (const key of cells) {
  const c = cellOf(key), sides: number[] = [];
  for (let f = 0; f < 6; f++) {
   const F = FACES[f], n = cellKey(c.i + F.d[0], c.k + F.d[1], c.j + F.d[2]); if (closed(n)) continue;
   const p0 = [c.i + F.o[0], c.k + F.o[1], c.j + F.o[2]], p1 = p0.map((v, a) => v + F.u[a]), p3 = p0.map((v, a) => v + F.v[a]), p2 = p1.map((v, a) => v + F.v[a]);
   quad([p0, p1, p2, p3], F.d, 0); faces++; if (F.d[1] === 0) sides.push(f);
   if (!edges) continue;
   // The four edges of this face: the in-plane step e that crosses it, the edge's start corner and its direction.
   for (const [e, along] of [[F.u, F.v], [F.u.map(x => -x), F.v], [F.v, F.u], [F.v.map(x => -x), F.u]] as number[][][]) {
    const side = cellKey(c.i + e[0], c.k + e[1], c.j + e[2]); if (edges.solid(side) && !edges.door(side)) continue;
    bar(e.some(x => x > 0) ? p0.map((v, m) => v + e[m]) : p0, along.findIndex(x => x !== 0));
   }
  }
  if (!skirt || !skirt.ground(c.i, c.k - 1, c.j)) continue;
  // Bottom edge of each open side, down to the terrain at its two corners (only where the terrain is below the block).
  const bottom = cellY(c.k);
  for (const f of sides) {
   const F = FACES[f], a = [c.i + F.o[0], c.j + F.o[2]], b = F.d[0] ? [a[0], a[1] + 1] : [a[0] + 1, a[1]];
   const ha = skirt.height(a[0], a[1]), hb = skirt.height(b[0], b[1]); if (ha >= bottom - .001 && hb >= bottom - .001) continue;
   // The strip reaches 4 cm under the terrain and up to the block's bottom; dark metal like the trim (a plinth).
   const lo = (h: number) => levelOfY(Math.min(bottom, h) - .04), top = c.k;
   // Corners ordered so the strip faces outwards like the side above it.
   const flip = F.d[0] > 0 || F.d[2] < 0, A = flip ? b : a, B = flip ? a : b, hA = flip ? hb : ha, hB = flip ? ha : hb;
   quad([[A[0], lo(hA), A[1]], [B[0], lo(hB), B[1]], [B[0], top, B[1]], [A[0], top, A[1]]], F.d, 1); skirts++;
  }
 }
 return { position: new Float32Array(pos), normal: new Float32Array(nor), trim: new Float32Array(tr), index: new Uint32Array(idx), faces, skirts, trims };
}
// ---------- Renderer ----------
/**
 * Frameless glass (D35): one transparent material for every pane, trim and skirt. Clear glass with a light blue-green
 * tint; alpha rises with the fresnel term at grazing angles and with the reflected sky/sun light, so the surface reads as
 * glass without frames; very faint large smudges vary roughness and alpha. Vertices with `trim` = 1 are dark metal and
 * opaque. FrontSide: from inside a room only the inner surface of a wall is drawn (one layer of glass, half the fill of
 * the old double-sided panes). No depth writes, never in the shadow map; one program ('vireon-glass-s5').
 */
export function glassMaterial() {
 const m = new THREE.MeshStandardMaterial({ color: 0xcdeee8, transparent: true, opacity: .13, roughness: .05, metalness: .1, depthWrite: false, side: THREE.FrontSide, envMapIntensity: 1.35 });
 m.onBeforeCompile = s => {
  s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float trim;\nvarying float vTrim;\nvarying vec3 vGlassW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvTrim = trim;\nvGlassW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
  s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vTrim;\nvarying vec3 vGlassW;\nfloat glassHash( vec3 p ) { return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }\nfloat glassNoise( vec3 p ) { vec3 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f ); return mix( mix( mix( glassHash( i ), glassHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( glassHash( i + vec3( 0, 1, 0 ) ), glassHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ), mix( mix( glassHash( i + vec3( 0, 0, 1 ) ), glassHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( glassHash( i + vec3( 0, 1, 1 ) ), glassHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z ); }')
   .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix( diffuseColor.rgb, vec3( .05, .06, .065 ), vTrim );')
   .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nfloat glassSmudge = smoothstep( .58, .95, glassNoise( vGlassW * .55 ) * .7 + glassNoise( vGlassW * 2.1 ) * .3 ) * ( 1.0 - vTrim );\nroughnessFactor = mix( roughnessFactor + glassSmudge * .2, .42, vTrim );')
   .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix( metalnessFactor, .7, vTrim );')
   .replace('#include <opaque_fragment>', 'float vFres = pow( 1.0 - clamp( abs( dot( normalize( vViewPosition ), normal ) ), 0.0, 1.0 ), 3.0 );\nfloat glassSpec = dot( reflectedLight.directSpecular + reflectedLight.indirectSpecular, vec3( .3333 ) );\ndiffuseColor.a = mix( clamp( diffuseColor.a + vFres * .45 + glassSpec * .5 + glassSmudge * .035, 0.0, .9 ), 1.0, vTrim );\n#include <opaque_fragment>');
 };
 m.customProgramCacheKey = () => 'vireon-glass-s5'; return m;
}
/** The glass geometry of several chunks: one buffer, one draw call. */
export function joinChunks(parts: Iterable<ChunkGeometry>) {
 const list = [...parts], n = list.reduce((a, f) => a + f.position.length, 0), m = list.reduce((a, f) => a + f.index.length, 0);
 const position = new Float32Array(n), normal = new Float32Array(n), trim = new Float32Array(n / 3), index = new Uint32Array(m); let v = 0, t = 0;
 for (const f of list) { position.set(f.position, v * 3); normal.set(f.normal, v * 3); trim.set(f.trim, v); for (let q = 0; q < f.index.length; q++) index[t + q] = f.index[q] + v; v += f.position.length / 3; t += f.index.length; }
 const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(position, 3)); g.setAttribute('normal', new THREE.BufferAttribute(normal, 3)); g.setAttribute('trim', new THREE.BufferAttribute(trim, 1)); g.setIndex(new THREE.BufferAttribute(index, 1)); g.computeBoundingSphere(); return g;
}
const ROOM_LIGHT = '#cdf7f0', UP = new THREE.Vector3(0, 1, 0);
export function createGlassView(root: THREE.Group, fx?: Fx) {
 const group = new THREE.Group(); group.name = 'glass'; root.add(group);
 const mat = glassMaterial();
 // An empty mesh puts the glass program into the boot-time compile, then hides itself after the first frame (a draw of
 // zero vertices still counts as a call).
 const warm = new THREE.Mesh(joinChunks([{ position: new Float32Array([0, -999, 0, 0, -999, 0, 0, -999, 0]), normal: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), trim: new Float32Array(3), index: new Uint32Array([0, 1, 2]), faces: 0, skirts: 0, trims: 0 }]), mat);
 warm.geometry.setDrawRange(0, 0); warm.frustumCulled = false; warm.onAfterRender = () => { warm.visible = false; }; group.add(warm);
 // Likewise one airlock model far below the world for the boot-time compile (its two-pass station glass would otherwise
 // compile on the first airlock in view); hidden on the first game frame and kept, so its programs stay referenced.
 const warmDoor = buildDoor(2); warmDoor.group.position.y = -999; warmDoor.group.name = 'warm-door'; group.add(warmDoor.group);
 // Chunks keep their cells and built faces; the one drawn mesh joins every chunk (rebuilt only after an edit).
 const chunks = new Map<number, { cells: Set<number>; faces: ChunkGeometry | null }>();
 let mesh: THREE.Mesh | null = null;
 const hash = new SpatialHash(), solids = new Map<number, Box>();
 /** Per module: the model, the frame colliders, the two leaf colliders (collapsed while that door is open), the shown open
  *  fraction of each door, the last state (for sounds) and the steam timer. */
 type Shown = { d: Door; v: DoorVisual; frame: Box[]; leaf: Record<DoorFace, Box & { y0: number; y1: number }>; open: Record<DoorFace, number>; last: string; puff: number };
 const doors = new Map<string, Shown>();
 let sound: ((kind: 'hiss' | 'slide' | 'clunk', at: { x: number; y: number; z: number }) => void) | null = null, moving = false;
 const skirt: Skirt = { ground: isGround, height: heightAt };
 let rev = -1, glass = new Set<number>(), doorCells = new Set<number>();
 const groundAt = (k: number) => { const c = cellOf(k); return isGround(c.i, c.k, c.j); };
 const edges: Edges = { solid: k => glass.has(k) || doorCells.has(k), door: k => doorCells.has(k) };
 const cube = (id: string, x0: number, k: number, z0: number, h = 1): Box => ({ id, minX: x0, maxX: x0 + 1, minY: cellY(k), maxY: cellY(k) + h, minZ: z0, maxZ: z0 + 1 });
 function rebuild(id: number) {
  const c = chunks.get(id); if (!c) return;
  if (!c.cells.size) { chunks.delete(id); return; }
  // Faces against glass, doors and ground are never seen (a face lying on the terrain would also flicker with it).
  c.faces = chunkFaces(c.cells, k => glass.has(k) || doorCells.has(k) || groundAt(k), skirt, edges);
 }
 function join() {
  if (mesh) { group.remove(mesh); mesh.geometry.dispose(); mesh = null; }
  const parts = [...chunks.values()].map(c => c.faces).filter((f): f is ChunkGeometry => !!f && f.index.length > 0); if (!parts.length) return;
  mesh = new THREE.Mesh(joinChunks(parts), mat); mesh.renderOrder = 2; mesh.name = 'glass'; mesh.castShadow = mesh.receiveShadow = false; group.add(mesh);
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
   const px = top.i + .5, py = cellY(k + 1) - .03, pz = top.j + .5; m.makeTranslation(px, py, pz); lamps!.setMatrixAt(n, m);
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
  // A block changes the faces and edge trim of the blocks around it, diagonal ones included (inner corners).
  const touch = (key: number) => { const c = cellOf(key); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let e = -1; e <= 1; e++) dirty.add(chunkOf(cellKey(c.i + a, c.k + b, c.j + e))); };
  for (const k of glass) if (!view.glass.has(k)) { touch(k); chunks.get(chunkOf(k))?.cells.delete(k); const b = solids.get(k); if (b) { hash.remove(b); solids.delete(k); } }
  for (const k of view.glass) if (!glass.has(k)) { touch(k); const id = chunkOf(k); let c = chunks.get(id); if (!c) chunks.set(id, c = { cells: new Set(), faces: null }); c.cells.add(k); const p = cellOf(k), b = cube('glass-' + k, p.i, p.k, p.j); solids.set(k, b); hash.insert(b); }
  for (const k of doorCells) if (!nextDoorCells.has(k)) touch(k);
  for (const k of nextDoorCells) if (!doorCells.has(k)) touch(k);
  glass = new Set(view.glass); doorCells = nextDoorCells;
  for (const [id, s] of doors) { const d = nextDoors.get(id); if (!d || d.x !== s.d.x || d.y !== s.d.y || d.z !== s.d.z || d.rot !== s.d.rot || d.width !== s.d.width) { dropDoor(s); doors.delete(id); } }
  for (const d of g.world.base.doors) if (!doors.has(d.id)) {
   // A plinth under the threshold down to the lowest terrain corner of its columns (visual only, like the glass skirt).
   const drop = cellY(d.y) - Math.min(...doorColumns(d).map(c => columnFloor(c.i, c.j))), v = buildDoor(widthOf(d), drop), c = doorCenter(d);
   v.group.position.set(c.x, cellY(d.y), c.z); v.group.rotation.y = d.rot * Math.PI / 2; v.group.name = d.id;
   const b = doorBoxes(d), leaf = { outer: { ...b.outer, y0: b.outer.minY, y1: b.outer.maxY }, inner: { ...b.inner, y0: b.inner.minY, y1: b.inner.maxY } };
   for (const x of [...b.frame, leaf.outer, leaf.inner]) hash.insert(x);
   doors.set(d.id, { d: { ...d }, v, frame: b.frame, leaf, open: { outer: simOpen(d, 'outer'), inner: simOpen(d, 'inner') }, last: '', puff: 0 }); group.add(v.group);
  }
  for (const id of dirty) if (chunks.has(id)) rebuild(id);
  if (dirty.size) join();
  syncLamps(g);
  return true;
 }
 function dropDoor(s: Shown) { group.remove(s.v.group); s.v.dispose(); for (const x of [...s.frame, s.leaf.outer, s.leaf.inner]) hash.remove(x); }
 function reset() { chunks.clear(); join(); for (const s of doors.values()) dropDoor(s); doors.clear(); hash.clear(); solids.clear(); glass = new Set(); doorCells = new Set(); rev = -1; clearTint(); showLeak([]); vent = null; }
 /** Leaf colliders follow the doors: a leaf blocks unless its door is open (it closes at once: the body was checked out of
  *  its plane). Also run right after the player works a door, before the next movement step. */
 function syncLeaves(g: GameState) {
  for (const s of doors.values()) { const d = doorById(g, s.d.id); if (!d) continue;
   for (const f of ['outer', 'inner'] as const) { const l = s.leaf[f], block = d[f] !== 'open'; if ((l.maxY > l.minY) !== block) { l.minY = block ? l.y0 : -1e4; l.maxY = block ? l.y1 : -1e4; } } }
 }
 /** `dt` is real frame time (0 while frozen). */
 function update(g: GameState, dt: number) {
  const still = reducedMotion(); warmDoor.group.visible = false; moving = false;
  syncLeaves(g);
  for (const s of doors.values()) {
   const d = doorById(g, s.d.id); if (!d) continue;
   const ph = doorPhase(g, d), c = doorCenter(d), at = { x: c.x, y: cellY(d.y) + 1, z: c.z };
   for (const f of ['outer', 'inner'] as const) {
    // Opening follows the simulation (the slide is the end of the cycle); closing eases shut in 0.8 s. Reduced motion snaps.
    const target = still ? d[f] === 'open' ? 1 : 0 : simOpen(d, f), was = s.open[f];
    s.open[f] = still || target >= was ? target : Math.max(target, was - dt / .8); if (s.open[f] !== was || s.open[f] !== target) moving = true;
   }
   s.v.update(dt, { outer: s.open.outer, inner: s.open.inner, lamps: [doorLamp(d, 'outer'), doorLamp(d, 'inner')], pressure: shownPressure(g, d) / CHAMBER_Q, busy: !!ph && ph.kind !== 'slide' }, still);
   // Sounds on each change of state: hiss while equalising, a hum as the leaves slide, a clunk when a door seals or stops.
   const state = d.outer + d.inner + (ph?.kind ?? ''); if (state !== s.last) { const near = Math.hypot(g.player.x - at.x, g.player.z - at.z) < 25;
    if (s.last && near) sound?.(ph?.kind === 'fill' || ph?.kind === 'vent' ? 'hiss' : ph?.kind === 'slide' ? 'slide' : 'clunk', at); s.last = state; }
   if (ph) moving = true;
   // Steam puffs in the chamber while it fills or vents (out of the grilles under the lintel, and out of the outer doorway when venting).
   if (fx && dt > 0 && !still && (ph?.kind === 'fill' || ph?.kind === 'vent') && (s.puff -= dt) <= 0) {
    s.puff = .12; const a = s.v.group, side = (Math.random() - .5) * widthOf(d) * .6, y = cellY(d.y) + LINTEL - .1;
    const p = new THREE.Vector3(side, 0, (Math.random() - .5) * .3).applyAxisAngle(UP, a.rotation.y); fx.steam(c.x + p.x, y, c.z + p.z);
    if (ph.kind === 'vent') { const q = new THREE.Vector3(side, 0, .55).applyAxisAngle(UP, a.rotation.y); fx.steam(c.x + q.x, cellY(d.y) + .3, c.z + q.z); }
   }
  }
  lampClock -= dt; if (lampClock <= 0 && lamps) { lampClock = .25; const rooms = allRooms(g); glow = roomCells.map(c => { const r = rooms.find(v => v.cell === c); return r && habitableRoom(r) ? 1 : 0; }); }
  // Lamp plates and lights ease towards the room's state (habitable: lit); reduced motion switches at once.
  if (lamps && (dt > 0 || still)) { const k = still ? 1 : Math.min(1, dt * 2); lights.forEach((l, i) => { l.intensity = THREE.MathUtils.lerp(l.intensity, (glow[i] ?? 0) * 3.2, k); lamps!.setColorAt(i, lampColor.copy(lampOff).lerp(lampOn, l.intensity / 3.2)); }); lamps.instanceColor!.needsUpdate = true; }
  if (tint && (tint.left -= dt) <= 0) clearTint();
  if (tint) red.opacity = .22 + (still ? .1 : Math.abs(Math.sin(performance.now() / 160)) * .14);
  if (leak && (leak.left -= dt) <= 0) showLeak([]);
  if (vent && fx && dt > 0) { vent.left -= dt; vent.next -= dt; if (vent.next <= 0) { vent.next = .1; fx.vent(vent.x, vent.y, vent.z, vent.n, vent.left / 2); } if (vent.left <= 0) vent = null; }
 }
 return {
  sync, reset, update, tintRooms, clearTint, showLeak, breach, group,
  /** Glass and door boxes overlapping the XZ rectangle (the controller's neighbourhood). */
  query: (minX: number, minZ: number, maxX: number, maxZ: number, out: Box[]) => hash.query(minX, minZ, maxX, maxZ, out),
  /** A breach jet is playing. */
  get venting() { return !!vent; },
  /** An airlock door is moving or cycling (its shadow must follow). */
  get animating() { return moving; },
  /** Called on each change of an airlock's state near the player: 'hiss' (equalising), 'slide' (leaves move), 'clunk' (sealed). */
  setSound(fn: typeof sound) { sound = fn; },
  /** Shown open fraction of each door of a module (tests and the debug state). */
  doorOpen: (id: string) => { const s = doors.get(id); return s ? { ...s.open } : null; },
  /** Shows the hidden warm-up meshes for one renderer.compile (a quality change recompiles the lit programs). */
  warmup(on: boolean) { warm.visible = warmDoor.group.visible = on; },
  syncLeaves,
  stats: () => ({ chunks: [...chunks.values()].filter(c => c.faces).length, meshes: mesh ? 1 : 0, castShadow: !!mesh?.castShadow, faces: [...chunks.values()].reduce((a, c) => a + (c.faces?.faces ?? 0), 0), trims: [...chunks.values()].reduce((a, c) => a + (c.faces?.trims ?? 0), 0), doors: doors.size, lamps: lamps?.count ?? 0, boxes: hash.count, leak: leak?.mesh.count ?? 0, tint: !!tint }),
  };
}
export type GlassView = ReturnType<typeof createGlassView>;
