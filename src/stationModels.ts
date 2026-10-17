import * as THREE from 'three';
import { reducedMotion } from './motion';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { BuildingKind } from './game/defs';
import { jambOf, LEAF_AT, LEAF_T, LINTEL, SILL } from './game/airlock';

/**
 * Procedural low-poly station models (S3). Static detail is merged per material and cached per
 * kind/level, so every placed station costs a handful of draw calls; moving parts (fans, flywheels,
 * fire, bubbles, status lamps, airlock door) are separate small meshes animated by `update`.
 * Style follows the capsule: off-white hull panels, dark frames, orange safety accents, teal light.
 */
export type StationStatus = 'work' | 'idle' | 'warn' | 'off';
export type StationLook = { status: StationStatus; working: number; habitable?: boolean; door?: number; level?: number };
/** `still` (prefers-reduced-motion): parts stop moving; lamps and glow still report the state. */
export type StationVisual = { group: THREE.Group; update(dt: number, look: StationLook, still?: boolean): void; dispose(): void };

const M = (() => {
 let cache: ReturnType<typeof make> | null = null;
 function make() {
  const std = (color: string, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  return {
   hull: std('#dfe1da', .55, .12), panel: std('#c9ccc4', .62, .1), frame: std('#2a3336', .55, .5), steel: std('#a3abad', .34, .82),
   orange: std('#e2702f', .5, .15), rubber: std('#1b1f21', .92), brick: std('#6f645b', .96, 0, { flatShading: true }), clay: std('#9c6a50', .9),
   soot: std('#2a2624', .95), copper: std('#b8703f', .36, .78), wood: std('#b89b7a', .9),
   glass: std('#a6dbe2', .06, .1, { transparent: true, opacity: .26, depthWrite: false, side: THREE.DoubleSide }),
   tankO2: std('#e8ebe6', .4, .2), blue: std('#4fa8c4', .45, .25), dark: std('#14191b', .5, .3),
   screen: std('#0f2a2c', .3, .1, { emissive: '#3fc4bb', emissiveIntensity: .9 }),
   floor: std('#3a4245', .7, .55),
  };
 }
 return () => (cache ??= make());
})();
type Mats = ReturnType<typeof M>;

/** Collects transformed pieces per material and merges them into one mesh per material. */
class Kit {
 private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
 private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private s = new THREE.Vector3(); private p = new THREE.Vector3();
 add(g: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const geo = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  if (!geo.attributes.normal) geo.computeVertexNormals();
  this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), this.s.set(sx, sy, sz)); geo.applyMatrix4(this.m);
  const list = this.parts.get(mat) ?? []; list.push(geo); this.parts.set(mat, list);
 }
 box(mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0, rx = 0, rz = 0) { this.add(BOX, mat, x, y, z, rx, ry, rz, w, h, d); }
 rbox(mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0) { this.add(RBOX, mat, x, y, z, 0, ry, 0, w, h, d); }
 cyl(mat: THREE.Material, x: number, y: number, z: number, r: number, h: number, rx = 0, rz = 0, seg = 12, top = 1) { this.add(seg === 8 ? CYL8 : top === 1 ? CYL : coneGeo(top), mat, x, y, z, rx, 0, rz, r, h, r); }
 finish(): THREE.Group {
  const group = new THREE.Group();
  for (const [mat, list] of this.parts) { const g = mergeGeometries(list); list.forEach(v => v.dispose()); if (!g) continue; g.computeBoundingSphere(); const mesh = new THREE.Mesh(g, mat); mesh.castShadow = !(mat as THREE.MeshStandardMaterial).transparent; mesh.receiveShadow = true; group.add(mesh); }
  this.parts.clear(); return group;
 }
}
const BOX = new THREE.BoxGeometry(1, 1, 1), RBOX = new RoundedBoxGeometry(1, 1, 1, 2, .12), CYL = new THREE.CylinderGeometry(1, 1, 1, 14), CYL8 = new THREE.CylinderGeometry(1, 1, 1, 8);
const CONES = new Map<number, THREE.CylinderGeometry>();
const coneGeo = (top: number) => { if (!CONES.has(top)) CONES.set(top, new THREE.CylinderGeometry(top, 1, 1, 14)); return CONES.get(top)!; };

// ---------- Static bodies per kind ----------
function workbenchBody(k: Kit, m: Mats, level: number) {
 for (const x of [-.39, .39]) for (const z of [-.27, .27]) { k.box(m.steel, x, .42, z, .085, .8, .085); k.box(m.frame, x, .02, z, .14, .06, .14); }
 k.box(m.steel, 0, .24, 0, .85, .05, .64); k.box(m.wood, 0, .275, 0, .77, .03, .56);
 k.box(m.frame, 0, .82, -.30, .85, .07, .06); k.box(m.frame, -.39, .8, 0, .06, .07, .62); k.box(m.frame, .39, .8, 0, .06, .07, .62);
 k.rbox(m.hull, 0, .9, 0, .98, .09, .78); k.box(m.wood, 0, .952, 0, .92, .02, .72); k.box(m.orange, 0, .89, .395, .9, .035, .02);
 // Vise, hammer and a drawer block.
 k.box(m.steel, -.25, .99, .02, .2, .035, .23); k.box(m.frame, -.25, 1.025, .02, .1, .05, .16);
 k.box(m.steel, -.31, 1.05, .02, .045, .08, .17); k.box(m.steel, -.19, 1.05, .02, .045, .08, .17); k.cyl(m.steel, -.25, 1.035, .17, .014, .2, Math.PI / 2);
 k.box(m.panel, .22, .62, .05, .34, .3, .5); k.box(m.orange, .22, .7, .305, .14, .025, .012); k.box(m.orange, .22, .56, .305, .14, .025, .012);
 k.box(m.wood, .18, .985, -.12, .22, .035, .05, .4); k.box(m.frame, .27, 1, -.08, .06, .05, .08, .4);
 if (level === 2) {
  for (const x of [-.4, .4]) k.box(m.steel, x, 1.2, -.3, .06, .52, .06);
  k.rbox(m.hull, 0, 1.47, -.3, .92, .11, .2); k.box(m.frame, 0, 1.4, -.28, .74, .03, .08);
  k.rbox(m.orange, .2, 1.32, -.25, .22, .16, .2); k.cyl(m.frame, .2, 1.22, -.22, .04, .12);
  k.box(m.frame, -.22, 1.2, -.36, .32, .22, .02); // screen backplate
  k.box(m.frame, .34, .45, -.22, .18, .24, .2); k.box(m.copper, .34, .45, -.11, .1, .08, .02);
 }
}
function kilnBody(k: Kit, m: Mats) {
 k.box(m.frame, 0, .06, 0, 1, .12, 1);
 // Brick firebox: staggered courses on four walls, an open fire mouth at the front.
 for (let row = 0; row < 5; row++) {
  const y = .19 + row * .145, off = row % 2 ? .1 : 0;
  for (let i = -2; i <= 2; i++) {
   const u = i * .2 + off; if (Math.abs(u) > .39) continue;
   k.box(m.brick, u, y, -.4, .19, .13, .12);
   if (!(Math.abs(u) < .22 && row < 3)) k.box(m.brick, u, y, .4, .19, .13, .12);
   k.box(m.brick, -.4, y, u, .12, .13, .19); k.box(m.brick, .4, y, u, .12, .13, .19);
  }
 }
 k.box(m.soot, 0, .4, 0, .66, .62, .66);
 k.rbox(m.clay, 0, .98, 0, .94, .2, .94);
 k.cyl(m.clay, 0, 1.18, 0, .32, .22, 0, 0, 14, .78);
 k.cyl(m.frame, .2, 1.56, -.18, .085, .9); k.cyl(m.frame, .2, 2.03, -.18, .13, .05); k.cyl(m.soot, .2, 2.07, -.18, .07, .06);
 k.box(m.orange, 0, .88, .475, .74, .04, .02);
 // Front door frame and an ore hopper on top.
 k.box(m.frame, -.23, .35, .47, .05, .38, .04); k.box(m.frame, .23, .35, .47, .05, .38, .04); k.box(m.frame, 0, .56, .47, .52, .05, .04);
 k.box(m.steel, -.22, 1.22, .18, .26, .14, .26); k.box(m.frame, -.22, 1.31, .18, .3, .03, .3);
}
function generatorBody(k: Kit, m: Mats) {
 k.box(m.frame, 0, .07, 0, 1, .1, .94);
 for (const x of [-.42, .42]) for (const z of [-.38, .38]) k.box(m.frame, x, .2, z, .06, .26, .06);
 // Fuel hopper drum lying on cradles.
 k.cyl(m.hull, -.12, .66, 0, .32, .78, 0, Math.PI / 2, 16);
 for (const x of [-.48, .25]) k.cyl(m.frame, x, .66, 0, .335, .04, 0, Math.PI / 2, 16);
 k.box(m.orange, -.12, .66, .33, .5, .06, .02); k.cyl(m.panel, -.12, 1.02, 0, .14, .1);
 // Engine block with radiator fins.
 k.rbox(m.panel, .36, .5, 0, .34, .62, .7);
 for (let i = 0; i < 6; i++) k.box(m.frame, .54, .3 + i * .08, 0, .02, .04, .6);
 k.cyl(m.frame, .3, 1.02, -.24, .05, .55); k.cyl(m.soot, .3, 1.31, -.24, .07, .04);
 k.box(m.dark, .36, .62, .355, .2, .14, .015);
 k.box(m.orange, .38, .33, .36, .05, .08, .03); // power socket
}
function electrolyzerBody(k: Kit, m: Mats) {
 k.box(m.frame, 0, .06, 0, 1, .1, .96);
 // Two gas columns: O₂ (white, blue band) and H₂ vent (grey).
 k.cyl(m.tankO2, -.3, .7, -.22, .18, 1.08); k.cyl(m.tankO2, -.3, 1.26, -.22, .12, .06, 0, 0, 14, .66);
 k.cyl(m.blue, -.3, .9, -.22, .185, .08); k.cyl(m.steel, -.3, 1.33, -.22, .05, .08);
 k.cyl(m.panel, .3, .55, -.24, .14, .8); k.cyl(m.frame, .3, 1.02, -.24, .03, .2); k.cyl(m.frame, .3, 1.14, -.24, .06, .04);
 // Cell housing with a glass front.
 k.rbox(m.hull, 0, .52, .18, .82, .82, .52);
 k.box(m.frame, 0, .52, .445, .6, .55, .02);
 k.box(m.blue, 0, .965, .18, .7, .05, .44); k.box(m.orange, .33, .2, .45, .1, .05, .02);
 // Pipes from the cell to the columns.
 k.cyl(m.steel, -.3, 1.0, -.02, .03, .34, Math.PI / 2); k.cyl(m.steel, .3, .82, -.04, .03, .3, Math.PI / 2);
 k.box(m.screen, .28, .78, .445, .14, .1, .012);
}
function refillBody(k: Kit, m: Mats) {
 k.box(m.frame, 0, .05, 0, .7, .1, .6);
 k.rbox(m.hull, 0, .72, -.05, .44, 1.3, .34);
 k.box(m.blue, 0, 1.2, .125, .44, .06, .02); k.box(m.screen, 0, 1.0, .125, .26, .16, .012);
 k.box(m.frame, 0, 1.42, -.05, .48, .06, .38);
 // Hose coil and nozzle holder.
 k.add(new THREE.TorusGeometry(.13, .028, 6, 18), m.rubber, .25, .66, .05, 0, Math.PI / 2, 0);
 k.box(m.frame, .25, .86, .05, .06, .12, .1); k.cyl(m.steel, .25, .9, .14, .025, .14, Math.PI / 2);
 k.box(m.orange, -.17, .3, .125, .06, .2, .02);
}
function distributorBody(k: Kit, m: Mats) {
 k.box(m.frame, 0, .05, 0, .9, .1, .9);
 k.rbox(m.hull, 0, .48, 0, .82, .76, .82);
 // Side vents.
 for (const s of [-1, 1]) for (let i = 0; i < 5; i++) { k.box(m.frame, s * .415, .3 + i * .1, 0, .02, .035, .6); k.box(m.frame, 0, .3 + i * .1, s * .415, .6, .035, .02); }
 k.cyl(m.frame, 0, .9, 0, .36, .06); k.cyl(m.dark, 0, .93, 0, .32, .02);
 k.box(m.blue, 0, .78, .415, .5, .04, .012); k.box(m.screen, -.2, .62, .418, .16, .1, .01);
 k.cyl(m.steel, -.3, .25, .42, .045, .12, Math.PI / 2);
}
/**
 * S5 (D36) walk-through airlock module, `width` cells wide × 1 deep × 2 high, industrial and readable: chunky dark frame
 * with chamfered jambs and lintel, bolts, hazard stripes on the threshold and the jambs, a floor grate, a pipe and a
 * control panel inside the chamber, and two doors of two horizontal sliding leaves each with round portholes. Lamp strips
 * above each door (outside and inside the chamber) and the panel screen are instances of one unlit mesh: green — the
 * door can be used, amber — cycling, red — locked by the other door. Four draw calls per module: frame, leaves,
 * portholes, lights (one vertex-coloured material for the first three). Origin: the centre of the footprint at the
 * threshold level; +z is the outer face, x runs along the width.
 */
const DOOR_LAMP = { ready: '#5df2a0', cycling: '#ffb347', locked: '#ff4d3d' } as const;
export type DoorLamp = keyof typeof DOOR_LAMP;
/** `outer`/`inner`: open fraction of each door (0…1); `pressure` 0…1 of the chamber charge for the panel screen. */
export type DoorLook = { outer: number; inner: number; lamps: [DoorLamp, DoorLamp]; pressure: number; busy: boolean };
export type DoorVisual = { group: THREE.Group; update(dt: number, look: DoorLook, still?: boolean): void; dispose(): void };
let DOOR_MAT: THREE.MeshStandardMaterial | null = null, LIGHT_MAT: THREE.MeshBasicMaterial | null = null;
const DOOR_GEO = new Map<string, THREE.BufferGeometry>();
/** Pieces with a vertex colour each, merged into one geometry. */
class Paint {
 private parts: THREE.BufferGeometry[] = []; private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private c = new THREE.Color();
 add(g: THREE.BufferGeometry, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) {
  const geo = (g.index ? g.toNonIndexed() : g.clone()); for (const k of Object.keys(geo.attributes)) if (!['position', 'normal'].includes(k)) geo.deleteAttribute(k);
  this.m.compose(new THREE.Vector3(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)); geo.applyMatrix4(this.m);
  this.c.set(color).convertSRGBToLinear(); const n = geo.attributes.position.count, col = new Float32Array(n * 3); for (let i = 0; i < n; i++) col.set([this.c.r, this.c.g, this.c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); this.parts.push(geo);
 }
 box(color: string, x: number, y: number, z: number, w: number, h: number, d: number, rz = 0) { this.add(BOX, color, x, y, z, w, h, d, 0, 0, rz); }
 bevel(color: string, x: number, y: number, z: number, w: number, h: number, d: number) { this.add(CHAMFER, color, x, y, z, w, h, d); }
 finish() { const g = mergeGeometries(this.parts)!; this.parts.forEach(p => p.dispose()); this.parts = []; g.computeBoundingSphere(); return g; }
}
/** A box with every edge chamfered (one bevel segment): the chunky frame members. */
const CHAMFER = new RoundedBoxGeometry(1, 1, 1, 1, .09);
const C = { frame: '#2c3539', face: '#3a4549', steel: '#9ea8ab', bolt: '#c3cacb', hazard: '#f0a020', dark: '#15191b', hull: '#d9dcd4', seal: '#1c2022', glass: '#24495a', grate: '#20272a', pipe: '#7d8a8f', panel: '#232b2e', green: '#3fae6a', red: '#c4483d' };
/** Static frame of a module `w` wide; `drop`: a plinth under the threshold down to the terrain (0: none). */
/**
 * The fixed body of a module, centred on its own origin, `D` metres deep (front = +z). S5.1: no two parts share a face
 * plane any more (the lintel and the sill sit between the jambs, the plates, bolts, chevrons, grates and stripes stand
 * a few millimetres clear of what they are fixed to) — overlapping coplanar faces flickered on phones as the view moved.
 */
function doorFrame(w: number, D: number, drop: number) {
 const p = new Paint(), h = w / 2, J = jambOf(w), iw = w - 2 * J, Z = D / 2, mid = (LINTEL + 2) / 2, F = .03;
 for (const s of [-1, 1]) {
  const x = s * (h - J / 2);
  p.bevel(C.frame, x, 1, 0, J, 2, D);
  // Face plates around both openings, bolted, with hazard chevrons at the foot of each jamb.
  for (const z of [-1, 1]) {
   p.box(C.face, x, 1, z * (Z + F / 2), J, 1.96, F);
   for (const y of [.32, 1, 1.62]) p.add(CYL8, C.bolt, x, y, z * (Z + F + .008), .022, .02, .022, Math.PI / 2);
   for (let i = 0; i < 3; i++) p.box(i % 2 ? C.dark : C.hazard, x, .1 + i * .085, z * (Z + F + .008), J - .03, .07, .012, s * .55);
  }
  // Chamber walls: steel ribs every half metre and a low kick plate along the floor.
  for (let v = -Z + .25; v < Z - .2; v += .5) p.box(C.steel, s * (h - J - .016), 1, v, .03, 1.76, .06);
  p.box(C.dark, s * (h - J - .012), .16, 0, .02, .22, D - .12);
  // Outer side walls: three bolted stiffeners, a vertical hazard strip at each corner and a stencilled number plate.
  for (const y of [.35, 1, 1.65]) { p.box(C.face, s * (h + .012), y, 0, .024, .1, D - .16); for (let v = -Z + .3; v < Z - .25; v += .5) p.add(CYL8, C.bolt, s * (h + .028), y, v, .014, .016, .014, 0, 0, Math.PI / 2); }
  for (const z of [-1, 1]) for (let i = 0; i < 6; i++) p.box(i % 2 ? C.dark : C.hazard, s * (h + .008), .2 + i * .3, z * (Z - .06), .016, .3, .05);
  p.box(C.panel, s * (h + .014), 1.32, 0, .02, .16, .36);
 }
 p.bevel(C.frame, 0, mid, 0, iw, 2 - LINTEL, D);
 // Roof: two raised rails and a vent housing with louvres (the pressure line runs out of it).
 for (const x of [-h + J / 2, h - J / 2]) p.box(C.steel, x, 2.025, 0, .1, .05, D - .1);
 p.box(C.frame, 0, 2.06, 0, Math.min(.7, iw * .5), .12, Math.min(.6, D * .35)); for (let i = 0; i < 4; i++) p.box(C.dark, 0, 2.125, -Math.min(.6, D * .35) / 2 + .08 + i * .14, Math.min(.66, iw * .48), .01, .04);
 p.add(CYL8, C.pipe, Math.min(.35, iw * .25) + .05, 2.05, 0, .03, Math.min(.6, D * .35) + .3, .03, Math.PI / 2);
 for (const z of [-1, 1]) { p.box(C.face, 0, mid, z * (Z + F / 2), iw, .1, F); for (let x = -h + .35; x <= h - .34; x += .45) p.add(CYL8, C.bolt, x, mid + .02, z * (Z + F + .008), .016, .02, .016, Math.PI / 2); }
 // Threshold: a dark sill, grates in the chamber and hazard stripes along both doorways.
 p.box(C.frame, 0, SILL / 2, 0, iw, SILL, D);
 for (let x = -h + J + .08; x < h - J - .04; x += .12) p.box(C.grate, x, SILL + .005, 0, .05, .008, D - .3);
 const n = Math.max(2, Math.round(iw / .16));
 for (const z of [-1, 1]) for (let i = 0; i < n; i++) { const u = -h + J + (i + .5) * iw / n; p.box(i % 2 ? C.dark : C.hazard, u, SILL + .007, z * (Z - .08), iw / n, .012, .12); }
 // Chamber fittings: a vertical pipe with brackets, vent grilles under the lintel, the control panel housing and buttons.
 p.add(CYL8, C.pipe, h - J - .06, 1, -.3, .028, 1.8, .028); for (const y of [.4, 1.6]) p.box(C.steel, h - J - .04, y, -.3, .04, .04, .08);
 for (const v of D > 1 ? [-.5, .5] : [0]) for (const x of [-.25, .25]) { p.box(C.grate, x * (w / 2), LINTEL - .008, v, .3, .012, .22); for (let i = 0; i < 4; i++) p.box(C.dark, x * (w / 2), LINTEL - .017, v - .09 + i * .06, .28, .006, .02); }
 p.box(C.panel, -h + J + .016, 1.25, 0, .03, .36, .28); p.box(C.steel, -h + J + .017, 1.25, 0, .018, .38, .3);
 p.box(C.green, -h + J + .036, 1.1, -.06, .02, .04, .05); p.box(C.red, -h + J + .036, 1.1, .06, .02, .04, .05);
 if (drop > .02) p.box(C.frame, 0, -drop / 2, 0, w - .02, drop, D - .02);
 return p.finish();
}
/** One leaf, centred on its own origin: panel with dark bands, an orange stripe and a rubber seal on its meeting edge. */
function leafGeometry(lw: number) {
 const p = new Paint(), hgt = LINTEL - SILL;
 p.box(C.hull, 0, 0, 0, lw, hgt, LEAF_T);
 for (const y of [-hgt / 2 + .05, hgt / 2 - .04]) p.box(C.frame, 0, y, 0, lw, y < 0 ? .1 : .08, LEAF_T + .01);
 p.box(C.hazard, 0, -.12, 0, lw, .045, LEAF_T + .012); p.box(C.seal, lw / 2 - .015, 0, 0, .03, hgt, LEAF_T + .014);
 return p.finish();
}
function portholeGeometry() {
 const p = new Paint(); p.add(new THREE.TorusGeometry(1, .2, 6, 16), C.steel, 0, 0, 0, .12, .12, .5); p.add(new THREE.CylinderGeometry(1, 1, 1, 16), C.glass, 0, 0, 0, .11, .06, .11, Math.PI / 2); return p.finish();
}
/** One placed module: its own frame copy (or a cached one), four leaves, four portholes and the lights. */
export function buildDoor(width: 1 | 2 = 2, drop = 0, depth: 1 | 2 = 2): DoorVisual {
 DOOR_MAT ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: .45 });
 LIGHT_MAT ??= new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
 const w = width, D = depth, Z = D / 2, h = w / 2, JAMB = jambOf(w), lw = h - JAMB, key = w + 'x' + D + ':' + (drop > .02 ? drop.toFixed(2) : '0'), own = drop > .02;
 const frameGeo = own ? doorFrame(w, D, drop) : DOOR_GEO.get(key) ?? (DOOR_GEO.set(key, doorFrame(w, D, 0)), DOOR_GEO.get(key)!);
 const leafKey = 'leaf' + w, leafGeo = DOOR_GEO.get(leafKey) ?? (DOOR_GEO.set(leafKey, leafGeometry(lw)), DOOR_GEO.get(leafKey)!), holeGeo = DOOR_GEO.get('hole') ?? (DOOR_GEO.set('hole', portholeGeometry()), DOOR_GEO.get('hole')!);
 const group = new THREE.Group(), frame = new THREE.Mesh(frameGeo, DOOR_MAT); frame.castShadow = frame.receiveShadow = true; group.add(frame);
 const leaves = new THREE.InstancedMesh(leafGeo, DOOR_MAT, 4), holes = new THREE.InstancedMesh(holeGeo, DOOR_MAT, 4), lights = new THREE.InstancedMesh(BOX, LIGHT_MAT, 8);
 // The leaves cast no shadow: the frame's shadow already outlines the doorway, moving leaves never force a shadow redraw,
 // and an instanced shadow caster would compile its own depth program on the first airlock in view.
 leaves.receiveShadow = true; group.add(leaves, holes, lights);
 for (const m of [leaves, holes, lights]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
 const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color(), hr = Math.min(1, lw / .5);
 const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
 // `turn`: the right leaf is the left one turned half round, so its seal also meets the middle.
 const put = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, turn = false) => mesh.setMatrixAt(i, mx.compose(v.set(x, y, z), turn ? flip : q, sc.set(sx, sy, sz)));
 // Lights: 0/1 strips over the outer/inner doorway outside, 2/3 the same doors seen from the chamber, 4 screen, 5 its bar,
 // 6 its status dot, 7 the chamber's ceiling light (a long cold strip between the grilles).
 const strips = [[0, mid(), Z + .052, w - .5, .035, .02], [0, mid(), -Z - .052, w - .5, .035, .02], [0, LINTEL - .022, Z - .1, w - 2 * JAMB - .1, .02, .03], [0, LINTEL - .022, -Z + .1, w - 2 * JAMB - .1, .02, .03], [-h + JAMB + .033, 1.29, 0, .004, .14, .22], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, LINTEL - .006, 0, .12, .008, D - .5]];
 strips.forEach((s, i) => put(lights, i, s[0], s[1], s[2], s[3], s[4], s[5]));
 lights.setColorAt(4, col.set('#0b3a3d')); lights.setColorAt(7, col.set('#cfeef0'));
 let t = Math.random() * 10;
 function update(dt: number, look: DoorLook, still = false) {
  t += still ? 0 : dt;
  // Leaves slide sideways into the jambs: the part inside is hidden, so each leaf shrinks towards its jamb as it opens.
  ([look.outer, look.inner] as const).forEach((open, d) => {
   const z = (d ? -1 : 1) * (Z - LEAF_AT), o = Math.min(1, Math.max(0, open));
   for (const s of [-1, 1]) {
    const i = d * 2 + (s > 0 ? 1 : 0), e1 = o * lw, cx = s * (lw + e1) / 2, k = Math.max(.001, 1 - o);
    put(leaves, i, cx, (SILL + LINTEL) / 2, z, k, 1, 1, s > 0);
    const hx = s * (lw / 2 + e1), hs = Math.max(0, Math.min(1, (lw - Math.abs(hx)) / (.13 * hr))) * hr;
    put(holes, i, hx, 1.35, z, hs || .001, hs || .001, hr);
   }
  });
  leaves.instanceMatrix.needsUpdate = holes.instanceMatrix.needsUpdate = true;
  // Amber blinks while cycling (steady with reduced motion); the screen bar shows the chamber charge.
  const lamp = (l: DoorLamp) => col.set(DOOR_LAMP[l]).multiplyScalar(l === 'cycling' && !still ? .55 + .45 * Math.max(0, Math.sin(t * 7)) : 1);
  look.lamps.forEach((l, d) => { lights.setColorAt(d, lamp(l)); lights.setColorAt(d + 2, lamp(l)); });
  const p = Math.min(1, Math.max(0, look.pressure));
  put(lights, 5, -h + JAMB + .037, 1.24, -.1 + .1 * p, .004, .035, Math.max(.001, .2 * p)); lights.setColorAt(5, col.set(look.busy ? '#ffb347' : '#6ff0e6'));
  put(lights, 6, -h + JAMB + .037, 1.34, .08, .004, .025, .025); lights.setColorAt(6, col.set(look.busy ? DOOR_LAMP.cycling : p >= 1 ? DOOR_LAMP.ready : '#3a4448'));
  lights.instanceMatrix.needsUpdate = true; lights.instanceColor!.needsUpdate = true;
 }
 function mid() { return (LINTEL + 2) / 2; }
 update(0, { outer: 0, inner: 0, lamps: ['ready', 'ready'], pressure: 0, busy: false }, true);
 return { group, update, dispose: () => { leaves.dispose(); holes.dispose(); lights.dispose(); if (own) frameGeo.dispose(); } };
}
type Animated = { kind: BuildingKind; parts: Record<string, THREE.Object3D>; mats: Record<string, THREE.MeshStandardMaterial> };
const STATIC = new Map<string, THREE.Group>();
function staticGroup(kind: BuildingKind, level: number): THREE.Group {
 const key = kind + level;
 if (!STATIC.has(key)) {
  const k = new Kit(), m = M();
  ({ workbench: () => workbenchBody(k, m, level), kiln: () => kilnBody(k, m), biogenerator: () => generatorBody(k, m), electrolyzer: () => electrolyzerBody(k, m), refill: () => refillBody(k, m), distributor: () => distributorBody(k, m) } as Record<BuildingKind, () => void>)[kind]();
  STATIC.set(key, k.finish());
 }
 return STATIC.get(key)!;
}
const LAMP_COLOR: Record<StationStatus, string> = { work: '#5df2a0', idle: '#f2b460', warn: '#ff5a4a', off: '#3a4448' };
const lampGeo = new THREE.SphereGeometry(.035, 10, 8), discGeo = new THREE.CylinderGeometry(1, 1, 1, 18), bubbleGeo = new THREE.SphereGeometry(.018, 6, 4);
function lamp(parent: THREE.Object3D, x: number, y: number, z: number) {
 const mat = new THREE.MeshStandardMaterial({ color: '#202628', emissive: LAMP_COLOR.idle, emissiveIntensity: 2.2, roughness: .3 });
 const mesh = new THREE.Mesh(lampGeo, mat); mesh.position.set(x, y, z); parent.add(mesh); return { mesh, mat };
}
/** Builds one placed station: cached static body + its own animated parts. */
export function buildStation(kind: BuildingKind, level: number): StationVisual {
 const group = new THREE.Group(), m = M();
 const body = staticGroup(kind, level);
 for (const child of body.children) { const mesh = child as THREE.Mesh, copy = new THREE.Mesh(mesh.geometry, mesh.material); copy.castShadow = mesh.castShadow; copy.receiveShadow = true; group.add(copy); }
 const a: Animated = { kind, parts: {}, mats: {} };
 const own: THREE.Material[] = [];
 const status = kind === 'workbench' ? lamp(group, .36, .92, .4) : kind === 'kiln' ? lamp(group, .36, .85, .47) : kind === 'biogenerator' ? lamp(group, .44, .74, .36) : kind === 'electrolyzer' ? lamp(group, .38, .78, .45) : kind === 'refill' ? lamp(group, 0, 1.3, .13) : lamp(group, .2, .62, .42);
 a.mats.lamp = status.mat; own.push(status.mat);
 if (kind === 'kiln') {
  const fire = new THREE.MeshStandardMaterial({ color: '#2a1a12', emissive: '#ff7a2a', emissiveIntensity: 0, roughness: .8 }); own.push(fire);
  const mouth = new THREE.Mesh(BOX, fire); mouth.position.set(0, .3, .41); mouth.scale.set(.34, .28, .02); group.add(mouth);
  const light = new THREE.PointLight('#ff8a3a', 0, 3.2, 2); light.position.set(0, .45, .75); group.add(light);
  a.mats.fire = fire; a.parts.light = light;
 }
 if (kind === 'biogenerator') {
  const wheel = new THREE.Group(); wheel.position.set(.56, .78, .2);
  const disc = new THREE.Mesh(discGeo, m.steel); disc.rotation.z = Math.PI / 2; disc.scale.set(.15, .04, .15); wheel.add(disc);
  for (let i = 0; i < 3; i++) { const spoke = new THREE.Mesh(BOX, m.orange); spoke.scale.set(.05, .26, .03); spoke.position.x = .025; spoke.rotation.x = i * Math.PI / 3; wheel.add(spoke); }
  group.add(wheel); a.parts.wheel = wheel;
 }
 if (kind === 'electrolyzer') {
  const glow = new THREE.MeshStandardMaterial({ color: '#0f2a33', emissive: '#4fd6ff', emissiveIntensity: .15, transparent: true, opacity: .85, roughness: .1 }); own.push(glow);
  const cell = new THREE.Mesh(BOX, glow); cell.position.set(-.05, .52, .45); cell.scale.set(.4, .45, .02); group.add(cell); a.mats.glow = glow;
  const bubbles = new THREE.Group(); bubbles.position.set(-.05, .3, .462);
  const bubbleMat = new THREE.MeshStandardMaterial({ color: '#dff8ff', emissive: '#9fefff', emissiveIntensity: .8, transparent: true, opacity: .8 }); own.push(bubbleMat);
  for (let i = 0; i < 9; i++) { const b = new THREE.Mesh(bubbleGeo, bubbleMat); b.position.set((i % 3 - 1) * .11 + (i * .37 % .05), (i * .113) % .42, 0); b.userData.speed = .18 + (i % 4) * .05; bubbles.add(b); }
  group.add(bubbles); a.parts.bubbles = bubbles;
 }
 if (kind === 'distributor') {
  const fan = new THREE.Group(); fan.position.set(0, .945, 0);
  for (let i = 0; i < 5; i++) { const blade = new THREE.Mesh(BOX, m.steel); blade.scale.set(.27, .012, .08); blade.position.set(.14, 0, 0); const pivot = new THREE.Group(); pivot.rotation.y = i * Math.PI * 2 / 5; blade.rotation.x = .35; pivot.add(blade); fan.add(pivot); }
  const hub = new THREE.Mesh(discGeo, m.orange); hub.scale.set(.06, .03, .06); fan.add(hub);
  group.add(fan); a.parts.fan = fan;
 }
 if (kind === 'workbench' && level === 2) {
  const scr = new THREE.MeshStandardMaterial({ color: '#0f2a2c', emissive: '#3fc4bb', emissiveIntensity: .4, roughness: .3 }); own.push(scr);
  const s = new THREE.Mesh(BOX, scr); s.position.set(-.22, 1.2, -.345); s.scale.set(.28, .18, .01); group.add(s); a.mats.screen = scr;
  const head = new THREE.Group(); head.position.set(.2, 1.15, -.22); const tip = new THREE.Mesh(discGeo, m.steel); tip.scale.set(.02, .1, .02); head.add(tip); group.add(head); a.parts.head = head;
 }
 let t = Math.random() * 10, spin = 0, heat = 0;
 function update(dt: number, look: StationLook, still = false) {
  const m = still ? 0 : dt; t += m; const w = look.working;
  status.mat.emissive.set(LAMP_COLOR[look.status]); status.mat.emissiveIntensity = look.status === 'warn' ? 1.2 + Math.max(0, Math.sin(t * 6)) * 2.4 : look.status === 'off' ? .2 : 2.2;
  if (a.mats.fire) { heat = still ? (w ? 1 : 0) : THREE.MathUtils.clamp(heat + (w ? dt * 1.5 : -dt * .6), 0, 1); const f = heat * (.9 + Math.sin(t * 13) * .25 + Math.sin(t * 7.3) * .2); a.mats.fire.emissiveIntensity = f * 2.2; (a.parts.light as THREE.PointLight).intensity = f * 3.2; }
  if (a.parts.wheel) { spin = THREE.MathUtils.lerp(spin, w ? 9 : 0, Math.min(1, dt * 1.5)); a.parts.wheel.rotation.x += spin * m; }
  if (a.parts.fan) { spin = THREE.MathUtils.lerp(spin, w ? 14 : 0, Math.min(1, dt * 1.2)); a.parts.fan.rotation.y += spin * m; }
  if (a.parts.bubbles) { a.mats.glow.emissiveIntensity = THREE.MathUtils.lerp(a.mats.glow.emissiveIntensity, w ? 1.4 + Math.sin(t * 5) * .2 : .12, Math.min(1, dt * 3)); a.parts.bubbles.visible = w > 0; if (w) for (const b of a.parts.bubbles.children) { b.position.y += b.userData.speed * m; if (b.position.y > .43) b.position.y = 0; } }
  if (a.mats.screen) a.mats.screen.emissiveIntensity = w ? .9 + Math.sin(t * 2) * .15 : .25;
  if (a.parts.head) a.parts.head.position.x = .2 + (w ? Math.sin(t * 3.1) * .22 : 0);
  if (a.parts.door) { const open = look.door ?? 0; a.parts.door.position.x = open * 1.0; a.parts.door.visible = open < .99; }
  if (a.mats.room) { const on = look.habitable ? 1 : 0; a.mats.room.emissiveIntensity = THREE.MathUtils.lerp(a.mats.room.emissiveIntensity, on * 2.4, Math.min(1, dt * 2)); (a.parts.light as THREE.PointLight).intensity = a.mats.room.emissiveIntensity * 1.6; }
 }
 return { group, update, dispose: () => own.forEach(v => v.dispose()) };
}
/** Translucent placement preview using the real model silhouette, plus a ground footprint ring. */
export function createGhost(scene: THREE.Scene) {
 const ok = new THREE.MeshBasicMaterial({ color: 0x64e6bd, transparent: true, opacity: .38, depthWrite: false });
 const bad = new THREE.MeshBasicMaterial({ color: 0xe76d62, transparent: true, opacity: .38, depthWrite: false });
 const ringMat = new THREE.MeshBasicMaterial({ color: 0x64e6bd, transparent: true, opacity: .55, depthWrite: false, side: THREE.DoubleSide });
 const root = new THREE.Group(); root.visible = false; scene.add(root);
 const ring = new THREE.Mesh(new THREE.RingGeometry(.92, 1, 4, 1), ringMat); ring.rotation.x = -Math.PI / 2; ring.rotation.z = Math.PI / 4; root.add(ring);
 const arrow = new THREE.Mesh(new THREE.ConeGeometry(.12, .3, 3), ringMat); arrow.rotation.x = Math.PI / 2; root.add(arrow);
 const models = new Map<string, THREE.Group>();
 let current: THREE.Group | null = null, pulse = 0;
 function model(kind: BuildingKind) {
  if (!models.has(kind)) { const g = new THREE.Group(); for (const c of staticGroup(kind, 1).children) { const mesh = new THREE.Mesh((c as THREE.Mesh).geometry, ok); mesh.renderOrder = 5; g.add(mesh); } root.add(g); models.set(kind, g); }
  return models.get(kind)!;
 }
 return {
  show(kind: BuildingKind, x: number, y: number, z: number, rot: number, valid: boolean, dt: number) {
   const g = model(kind); if (current && current !== g) current.visible = false; current = g; g.visible = true;
   for (const c of g.children) (c as THREE.Mesh).material = valid ? ok : bad;
   if (!reducedMotion()) pulse += dt; const a = .3 + Math.sin(pulse * 4) * .08; ok.opacity = bad.opacity = a;
   ringMat.color.set(valid ? 0x64e6bd : 0xe76d62);
   root.position.set(x, y, z); root.visible = true; g.rotation.y = rot * Math.PI / 2;
   const size = .62; ring.scale.setScalar(size * 1.414); ring.position.y = .03;
   arrow.position.set(Math.sin(rot * Math.PI / 2) * (size + .35), .05, Math.cos(rot * Math.PI / 2) * (size + .35)); arrow.rotation.set(Math.PI / 2, 0, -rot * Math.PI / 2 + Math.PI);
  },
  hide() { root.visible = false; },
 };
}
/** Local port height used for cable/pipe attachment (top of the body). */
export const PORT_HEIGHT: Record<BuildingKind, number> = { workbench: 1.0, kiln: 1.0, biogenerator: .9, electrolyzer: 1.05, refill: 1.1, distributor: .85 };
