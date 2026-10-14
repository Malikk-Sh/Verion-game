import * as THREE from 'three';
import { reducedMotion } from './motion';
/**
 * Pooled world particles (S3 motion design): mining chips and dust, landing rings, smoke from
 * chimneys and exhausts, sparks along a new line. One draw call per blending mode; CPU update
 * of a fixed ring buffer, so emitting never allocates. Purely visual — never read by the game.
 */
type Emit = { x: number; y: number; z: number; vx?: number; vy?: number; vz?: number; spread?: number; up?: number; color: THREE.ColorRepresentation; size?: number; grow?: number; life?: number; gravity?: number; drag?: number; count?: number; alpha?: number };
// S4: sizes are in framebuffer pixels, clamped (a soft puff at the lens no longer covers the screen) and faded near the camera.
const VERT = `attribute float aSize;attribute float aAlpha;attribute vec3 aColor;varying float vAlpha;varying vec3 vColor;uniform float uScale;uniform float uMaxSize;
void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=min(aSize*uScale/max(.1,-mv.z),uMaxSize);vAlpha=aAlpha*smoothstep(.2,.8,-mv.z);vColor=aColor;}`;
const FRAG = `varying float vAlpha;varying vec3 vColor;uniform float uSoft;
void main(){vec2 p=gl_PointCoord-.5;float d=length(p);if(d>.5)discard;float a=uSoft>.5?smoothstep(.5,.0,d):smoothstep(.5,.38,d);gl_FragColor=vec4(vColor,a*vAlpha);
#include <colorspace_fragment>
}`;
class Pool {
 readonly points: THREE.Points;
 private pos: Float32Array; private vel: Float32Array; private col: Float32Array; private size: Float32Array; private alpha: Float32Array;
 private life: Float32Array; private age: Float32Array; private grow: Float32Array; private grav: Float32Array; private drag: Float32Array; private a0: Float32Array; private s0: Float32Array;
 private next = 0; private live = 0; private uniforms: { uScale: { value: number }; uSoft: { value: number }; uMaxSize: { value: number } };
 /** Ring capacity in use (≤ n): Low quality caps the live particle count. */
 cap: number;
 constructor(private n: number, blending: THREE.Blending, soft: boolean) {
  const g = new THREE.BufferGeometry();
  this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n);
  this.life = new Float32Array(n); this.age = new Float32Array(n).fill(1e9); this.grow = new Float32Array(n); this.grav = new Float32Array(n); this.drag = new Float32Array(n); this.a0 = new Float32Array(n); this.s0 = new Float32Array(n);
  g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
  this.cap = n; this.uniforms = { uScale: { value: 400 }, uSoft: { value: soft ? 1 : 0 }, uMaxSize: { value: 80 } };
  const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, blending });
  this.points = new THREE.Points(g, m); this.points.frustumCulled = false; this.points.renderOrder = 6; this.points.visible = false;
 }
 private color = new THREE.Color();
 emit(e: Emit) {
  const count = e.count ?? 1; this.color.set(e.color);
  for (let k = 0; k < count; k++) {
   const i = this.next; this.next = (this.next + 1) % this.cap;
   const s = e.spread ?? 0, a = Math.random() * Math.PI * 2, r = Math.random() * s;
   this.pos[i * 3] = e.x + Math.cos(a) * r * .15; this.pos[i * 3 + 1] = e.y; this.pos[i * 3 + 2] = e.z + Math.sin(a) * r * .15;
   this.vel[i * 3] = (e.vx ?? 0) + Math.cos(a) * r; this.vel[i * 3 + 1] = (e.vy ?? 0) + (e.up ?? 0) * (.6 + Math.random() * .8); this.vel[i * 3 + 2] = (e.vz ?? 0) + Math.sin(a) * r;
   const shade = .82 + Math.random() * .3;
   this.col[i * 3] = Math.min(1, this.color.r * shade); this.col[i * 3 + 1] = Math.min(1, this.color.g * shade); this.col[i * 3 + 2] = Math.min(1, this.color.b * shade);
   this.s0[i] = (e.size ?? .08) * (.7 + Math.random() * .6); this.size[i] = this.s0[i]; this.grow[i] = e.grow ?? 0;
   this.life[i] = (e.life ?? .8) * (.75 + Math.random() * .5); this.age[i] = 0; this.grav[i] = e.gravity ?? 9; this.drag[i] = e.drag ?? .5;
   this.a0[i] = e.alpha ?? 1; this.alpha[i] = this.a0[i];
  }
  this.live = this.n; this.points.visible = true;
 }
 setCap(cap: number) { this.cap = Math.max(1, Math.min(this.n, cap)); this.next %= this.cap; for (let i = this.cap; i < this.n; i++) if (this.age[i] < this.life[i]) { this.age[i] = this.life[i]; this.size[i] = 0; this.alpha[i] = 0; } }
 update(dt: number, camera: THREE.PerspectiveCamera, height: number) {
  if (!this.live) return;
  this.uniforms.uScale.value = height / (2 * Math.tan(camera.fov * Math.PI / 360)); this.uniforms.uMaxSize.value = Math.max(8, height * .2);
  let alive = 0, lo = this.n, hi = -1, first = this.n, last = -1;
  for (let i = 0; i < this.n; i++) {
   // A dead sprite gets size 0 once (no longer rasterised at alpha 0) and is then skipped.
   if (this.age[i] >= this.life[i]) { if (this.size[i] !== 0) { this.size[i] = 0; this.alpha[i] = 0; lo = Math.min(lo, i); hi = i; } continue; }
   alive++; lo = Math.min(lo, i); hi = i; first = Math.min(first, i); last = i; this.age[i] += dt; const t = Math.min(1, this.age[i] / this.life[i]), k = Math.max(0, 1 - this.drag[i] * dt);
   this.vel[i * 3] *= k; this.vel[i * 3 + 2] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
   this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
   this.size[i] = this.s0[i] * (1 + this.grow[i] * t); this.alpha[i] = this.a0[i] * (t < .15 ? t / .15 : 1 - (t - .15) / .85);
  }
  // Upload only the touched index range; draw only the live one.
  const g = this.points.geometry;
  if (hi >= lo) for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) { const a = g.attributes[name] as THREE.BufferAttribute; a.clearUpdateRanges(); a.addUpdateRange(lo * a.itemSize, (hi - lo + 1) * a.itemSize); a.needsUpdate = true; }
  g.setDrawRange(alive ? first : 0, alive ? last - first + 1 : 0);
  if (!alive) { this.live = 0; this.points.visible = false; }
  this.alive = alive;
 }
 alive = 0;
}
export const MATERIAL_FX: Record<string, string> = { stone: '#b9b0a2', iron: '#5a4c44', copper: '#b8703f', ice: '#e8f6fb', sand: '#d8c08a', grass: '#8a9a5e' };
/** Low quality: half the emission and at most 416 live particles in the pools (the other 96 of the 512 budget are dust motes). */
export const FX_CAPS = { low: { solid: 200, soft: 160, glow: 56, emission: .5 }, standard: { solid: 700, soft: 500, glow: 240, emission: 1 }, high: { solid: 700, soft: 500, glow: 240, emission: 1 } } as const;
export function createFx(scene: THREE.Scene) {
 const solid = new Pool(700, THREE.NormalBlending, false), soft = new Pool(500, THREE.NormalBlending, true), glow = new Pool(240, THREE.AdditiveBlending, true);
 scene.add(solid.points, soft.points, glow.points);
 let enabled = true, emission = 1;
 // Particles are pure motion: prefers-reduced-motion switches every emitter off.
 const on = () => enabled && !reducedMotion();
 // Emission scale with probabilistic rounding, so single-particle emitters still fire on Low.
 const scaled = (e: Emit) => { const c = (e.count ?? 1) * emission, n = Math.floor(c) + (Math.random() < c % 1 ? 1 : 0); return n ? { ...e, count: n } : null; };
 for (const p of [solid, soft, glow]) { const emit = p.emit.bind(p); p.emit = (e: Emit) => { const v = scaled(e); if (v) emit(v); }; }
 const api = {
  set enabled(v: boolean) { enabled = v; }, get enabled() { return enabled; },
  setQuality(q: keyof typeof FX_CAPS) { const c = FX_CAPS[q]; solid.setCap(c.solid); soft.setCap(c.soft); glow.setCap(c.glow); emission = c.emission; },
  /** Small chips off a deposit at each tool strike. */
  strike(x: number, y: number, z: number, material: string) {
   if (!on()) return; const c = MATERIAL_FX[material] ?? '#b9b0a2';
   solid.emit({ x, y, z, color: c, count: material === 'grass' ? 5 : 9, spread: 2.4, up: 2.8, size: material === 'ice' ? .1 : .09, life: .6, gravity: 9, drag: .6 });
   soft.emit({ x, y, z, color: material === 'ice' ? '#ffffff' : '#c9b79c', count: 3, spread: .7, up: .5, size: .4, grow: 1.8, life: .8, gravity: -.2, drag: 1.4, alpha: .45 });
   if (material === 'ice') glow.emit({ x, y, z, color: '#bff6ff', count: 3, spread: 1.6, up: 1.4, size: .05, life: .4, gravity: 4 });
  },
  /** A finished block: a heavier burst and a dust cloud. */
  block(x: number, y: number, z: number, material: string) {
   if (!on()) return; const c = MATERIAL_FX[material] ?? '#b9b0a2';
   solid.emit({ x, y, z, color: c, count: 22, spread: 3.2, up: 3.6, size: .11, life: .95, gravity: 10, drag: .4 });
   soft.emit({ x, y: y - .2, z, color: material === 'ice' ? '#f4fbff' : material === 'grass' ? '#a7b07a' : '#cbb89a', count: 8, spread: 1.4, up: .7, size: .55, grow: 2.2, life: 1.3, gravity: -.15, drag: 1.2, alpha: .4 });
  },
  /** A placed station settles: a ring of dust at its footprint. */
  land(x: number, y: number, z: number, radius: number) {
   if (!on()) return;
   for (let i = 0; i < 26; i++) { const a = i / 26 * Math.PI * 2; soft.emit({ x: x + Math.cos(a) * radius, y: y + .08, z: z + Math.sin(a) * radius, vx: Math.cos(a) * 1.8, vz: Math.sin(a) * 1.8, color: '#cdb796', size: .45, grow: 2, life: 1.2, gravity: -.1, drag: 1.6, alpha: .45 }); }
   glow.emit({ x, y: y + .2, z, color: '#7fe6da', count: 14, spread: 2.4, up: 2, size: .06, life: .7, gravity: 3 });
  },
  /** Sparks travelling along a new cable or pipe. */
  connect(points: THREE.Vector3[], kind: 'cable' | 'gas_pipe') {
   if (!on()) return; const c = kind === 'cable' ? '#ffb46a' : '#9ff1ff';
   points.forEach((p, i) => { if (i % 2) return; glow.emit({ x: p.x, y: p.y, z: p.z, color: c, count: 3, spread: .8, up: .8, size: .07, life: .5 + i * .02, gravity: 2 }); });
  },
  smoke(x: number, y: number, z: number, dark = false) { if (on()) soft.emit({ x, y, z, color: dark ? '#35312e' : '#625c56', count: 2, spread: .3, up: .9, size: .42, grow: 3.2, life: 2.6, gravity: -.35, drag: .8, alpha: dark ? .75 : .68, vx: .25 }); },
  steam(x: number, y: number, z: number) { if (on()) soft.emit({ x, y, z, color: '#f2fbff', count: 1, spread: .2, up: .7, size: .18, grow: 2.4, life: 1.4, gravity: -.3, drag: 1, alpha: .28 }); },
  ember(x: number, y: number, z: number) { if (on()) glow.emit({ x, y, z, color: '#ff9a4a', count: 1, spread: .5, up: 1.4, size: .04, life: .9, gravity: -.4, drag: .9 }); },
  hiss(x: number, y: number, z: number) { if (on()) soft.emit({ x, y, z, color: '#e9f3f2', count: 3, spread: 1.4, up: .3, size: .25, grow: 2.5, life: .9, gravity: 0, drag: 1.8, alpha: .3 }); },
  update(dt: number, camera: THREE.PerspectiveCamera, height: number) { solid.update(dt, camera, height); soft.update(dt, camera, height); glow.update(dt, camera, height); },
  stats: () => ({ solid: solid.alive, soft: soft.alive, glow: glow.alive, live: solid.alive + soft.alive + glow.alive, cap: solid.cap + soft.cap + glow.cap }),
 };
 return api;
}
export type Fx = ReturnType<typeof createFx>;
