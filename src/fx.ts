import * as THREE from 'three';
import { reducedMotion } from './motion';
import type { WindState } from './wind';
/**
 * Pooled world particles (S3 motion design, S4 materials): mining chips that bounce and settle on
 * the ground, dust and wisps carried by the shared wind, landing rings, smoke from chimneys and
 * exhausts, sparks along a new line. One draw call per blending mode; CPU update of a fixed ring
 * buffer, so emitting never allocates. Purely visual — never read by the game.
 */
/** Sprite cut-outs drawn by the fragment shader. */
export const SHAPE = { round: 0, soft: 1, shard: 2, flake: 3, grain: 4, leaf: 5, spark: 6, chunk: 7 } as const;
export type Emit = {
 x: number; y: number; z: number; vx?: number; vy?: number; vz?: number; spread?: number; up?: number;
 /** One colour, or a palette: each particle picks one. */
 color: THREE.ColorRepresentation | readonly THREE.ColorRepresentation[];
 size?: number; grow?: number; life?: number; gravity?: number; drag?: number; count?: number; alpha?: number;
 shape?: number; spin?: number;
 /** Restitution on the ground (needs the ground callback); negative: passes through (smoke, sparks). */
 bounce?: number;
 /** 0…1: how strongly horizontal velocity follows the wind. */
 wind?: number; flutter?: number;
 /** Fraction of life that stays fully opaque before fading (solids); 0: soft fade in and out. */
 hold?: number;
 /** Outward surface normal: random directions are mirrored into its hemisphere and pushed along it. */
 normal?: { x: number; y: number; z: number }; push?: number;
};
export type Ground = (x: number, z: number) => number;
const SUB = 1 / 30;
/** Pure particle state and integration (no WebGL): tested on its own. */
export class ParticleSim {
 pos: Float32Array; vel: Float32Array; col: Float32Array; size: Float32Array; alpha: Float32Array; rot: Float32Array; shape: Float32Array;
 life: Float32Array; age: Float32Array; grow: Float32Array; grav: Float32Array; drag: Float32Array; a0: Float32Array; s0: Float32Array;
 spin: Float32Array; bounce: Float32Array; wind: Float32Array; flutter: Float32Array; hold: Float32Array; rest: Uint8Array;
 next = 0; cap: number; alive = 0;
 /** Touched and live index ranges of the last step. */
 lo = 0; hi = -1; first = 0; last = -1;
 constructor(public n: number, private random: () => number = Math.random) {
  this.cap = n; this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
  this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.rot = new Float32Array(n); this.shape = new Float32Array(n);
  this.life = new Float32Array(n); this.age = new Float32Array(n).fill(1e9); this.grow = new Float32Array(n); this.grav = new Float32Array(n); this.drag = new Float32Array(n);
  this.a0 = new Float32Array(n); this.s0 = new Float32Array(n); this.spin = new Float32Array(n); this.bounce = new Float32Array(n).fill(-1); this.wind = new Float32Array(n);
  this.flutter = new Float32Array(n); this.hold = new Float32Array(n); this.rest = new Uint8Array(n);
 }
 private color = new THREE.Color();
 emit(e: Emit) {
  const count = e.count ?? 1, R = this.random, pal = Array.isArray(e.color) ? e.color as readonly THREE.ColorRepresentation[] : null;
  if (!pal) this.color.set(e.color as THREE.ColorRepresentation);
  const nx = e.normal?.x ?? 0, nz = e.normal?.z ?? 0, nh = Math.hypot(nx, nz), push = e.push ?? 0;
  for (let k = 0; k < count; k++) {
   const i = this.next; this.next = (this.next + 1) % this.cap;
   const s = e.spread ?? 0; let a = R() * Math.PI * 2; const r = R() * s;
   // Chips leave the struck face: a direction into the rock is mirrored out of it.
   if (nh > .01 && Math.cos(a) * nx + Math.sin(a) * nz < 0) { const dx = Math.cos(a), dz = Math.sin(a), d = 2 * (dx * nx + dz * nz) / (nh * nh); a = Math.atan2(dz - d * nz, dx - d * nx); }
   this.pos[i * 3] = e.x + Math.cos(a) * r * .15; this.pos[i * 3 + 1] = e.y; this.pos[i * 3 + 2] = e.z + Math.sin(a) * r * .15;
   this.vel[i * 3] = (e.vx ?? 0) + Math.cos(a) * r + nx * push; this.vel[i * 3 + 1] = (e.vy ?? 0) + (e.up ?? 0) * (.6 + R() * .8) + Math.max(0, e.normal?.y ?? 0) * push; this.vel[i * 3 + 2] = (e.vz ?? 0) + Math.sin(a) * r + nz * push;
   if (pal) this.color.set(pal[Math.floor(R() * pal.length) % pal.length]);
   const shade = .82 + R() * .3;
   this.col[i * 3] = Math.min(1, this.color.r * shade); this.col[i * 3 + 1] = Math.min(1, this.color.g * shade); this.col[i * 3 + 2] = Math.min(1, this.color.b * shade);
   this.s0[i] = (e.size ?? .08) * (.7 + R() * .6); this.size[i] = this.s0[i]; this.grow[i] = e.grow ?? 0;
   this.life[i] = (e.life ?? .8) * (.75 + R() * .5); this.age[i] = 0; this.grav[i] = e.gravity ?? 9; this.drag[i] = e.drag ?? .5;
   this.a0[i] = e.alpha ?? 1; this.alpha[i] = (e.hold ?? 0) > 0 ? this.a0[i] : 0; this.shape[i] = e.shape ?? SHAPE.round;
   this.rot[i] = R() * Math.PI * 2; this.spin[i] = (e.spin ?? 0) * (R() * 2 - 1); this.bounce[i] = e.bounce ?? -1; this.wind[i] = e.wind ?? 0;
   this.flutter[i] = e.flutter ?? 0; this.hold[i] = e.hold ?? 0; this.rest[i] = 0;
  }
 }
 /** Kill everything at or beyond `cap` (Low quality shrinks the ring). */
 setCap(cap: number) { this.cap = Math.max(1, Math.min(this.n, cap)); this.next %= this.cap; for (let i = this.cap; i < this.n; i++) if (this.age[i] < this.life[i]) this.age[i] = this.life[i]; }
 /** Advances by `dt` (sub-stepped at 30 Hz so 15 fps dialogs still bounce); `ground` enables terrain contact. */
 step(dt: number, ground?: Ground, wx = 0, wz = 0) {
  let alive = 0, lo = this.n, hi = -1, first = this.n, last = -1;
  const steps = dt > 0 ? Math.max(1, Math.ceil(dt / SUB - 1e-6)) : 0, h = steps ? dt / steps : 0, p = this.pos, v = this.vel;
  for (let i = 0; i < this.n; i++) {
   // A dead sprite gets size 0 once (no longer rasterised) and is then skipped.
   if (this.age[i] >= this.life[i]) { if (this.size[i] !== 0) { this.size[i] = 0; this.alpha[i] = 0; lo = Math.min(lo, i); hi = i; } continue; }
   alive++; lo = Math.min(lo, i); hi = i; first = Math.min(first, i); last = i;
   for (let s = 0; s < steps && !this.rest[i]; s++) {
    const k = Math.max(0, 1 - this.drag[i] * h), w = Math.min(1, this.wind[i] * 3 * h), j = i * 3;
    v[j] = v[j] * k + (wx - v[j]) * w; v[j + 2] = v[j + 2] * k + (wz - v[j + 2]) * w; v[j + 1] = v[j + 1] * k - this.grav[i] * h;
    if (this.flutter[i]) { const t = this.age[i] + s * h; v[j] += Math.sin(t * 9 + i) * this.flutter[i] * h; v[j + 2] += Math.cos(t * 7.3 + i * 1.7) * this.flutter[i] * h; }
    p[j] += v[j] * h; p[j + 1] += v[j + 1] * h; p[j + 2] += v[j + 2] * h; this.rot[i] += this.spin[i] * h;
    if (ground && this.bounce[i] >= 0) {
     const floor = ground(p[j], p[j + 2]) + this.s0[i] * .3;
     if (p[j + 1] < floor && v[j + 1] < 0) {
      p[j + 1] = floor; v[j + 1] = -v[j + 1] * this.bounce[i]; v[j] *= .6; v[j + 2] *= .6; this.spin[i] *= .7;
      // Settles once the rebound is small: it then lies still until it fades.
      if (Math.abs(v[j + 1]) < .35) { this.rest[i] = 1; v[j] = v[j + 1] = v[j + 2] = 0; this.spin[i] = 0; }
     }
    }
   }
   this.age[i] += dt;
   const t = Math.min(1, this.age[i] / this.life[i]), hold = this.hold[i];
   this.size[i] = this.s0[i] * (1 + this.grow[i] * t);
   this.alpha[i] = this.a0[i] * (hold > 0 ? (t < hold ? 1 : 1 - (t - hold) / (1 - hold)) : (t < .15 ? t / .15 : 1 - (t - .15) / .85));
  }
  this.alive = alive; this.lo = lo; this.hi = hi; this.first = first; this.last = last;
  return alive;
 }
}
// S4: sizes are in framebuffer pixels, clamped (a soft puff at the lens no longer covers the screen), faded near the camera,
// and never thinner than 1.5 px (alpha compensates). Solids are lit by the day/night level, so chips do not glow at night.
const VERT = `attribute float aSize;attribute float aAlpha;attribute vec3 aColor;attribute float aRot;attribute float aShape;
varying float vAlpha;varying vec3 vColor;varying float vRot;varying float vShape;uniform float uScale;uniform float uMaxSize;
void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;float px=aSize*uScale/max(.1,-mv.z);
 gl_PointSize=px<=0.?0.:clamp(px,1.5,uMaxSize);vAlpha=aAlpha*smoothstep(.2,.8,-mv.z)*min(1.,px/1.5);vColor=aColor;vRot=aRot;vShape=aShape;}`;
const FRAG = `varying float vAlpha;varying vec3 vColor;varying float vRot;varying float vShape;uniform vec3 uLight;
void main(){vec2 p=gl_PointCoord-.5;float c=cos(vRot),s=sin(vRot);vec2 q=vec2(c*p.x-s*p.y,s*p.x+c*p.y);float a;vec3 col=vColor;int k=int(vShape+.5);
 if(k==0)a=smoothstep(.5,.38,length(p));
 else if(k==1)a=smoothstep(.5,0.,length(p));
 else if(k==2){float d=max(max(dot(q,vec2(.94,.34))-.31,dot(q,vec2(-.62,.78))-.25),max(dot(q,vec2(-.45,-.89))-.2,dot(q,vec2(.55,-.83))-.3));a=1.-smoothstep(-.04,.0,d);col*=q.x+q.y*.6>0.?1.2:.7;}
 else if(k==3){float d=abs(q.x)/.47+abs(q.y)/.17;a=1.-smoothstep(.8,1.,d);col=mix(col*(q.y>0.?1.25:.72),vec3(1.,.97,.9),pow(abs(sin(vRot*1.5)),18.)*.85);}
 else if(k==4){a=smoothstep(.5,.3,length(p));col*=p.x+p.y<0.?1.12:.8;}
 else if(k==5){float d=length(vec2(q.x/.48,q.y/(.2-abs(q.x)*.2)));a=1.-smoothstep(.75,1.,d);col*=(q.y>0.?1.1:.82)+.25*smoothstep(.025,.0,abs(q.y));}
 else if(k==7){float d=max(max(abs(q.x)*.87+q.y*.5,abs(q.x)*.87-q.y*.5)*(1.+.14*sin(vRot*3.)),abs(q.y)*1.06)-.38;a=1.-smoothstep(-.035,0.,d);col*=(q.y>.06?1.3:q.x>.0?.9:.6)*(1.-.4*smoothstep(-.09,0.,d));}
 else{float d=length(q);a=(exp(-abs(q.x)*22.)*exp(-abs(q.y)*5.)+exp(-abs(q.y)*22.)*exp(-abs(q.x)*5.))*smoothstep(.5,.1,d)+smoothstep(.16,.0,d);}
 if(a<.01)discard;gl_FragColor=vec4(col*uLight,min(1.,a)*vAlpha);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
class Pool extends ParticleSim {
 readonly points: THREE.Points;
 private live = 0; readonly uniforms: { uScale: { value: number }; uMaxSize: { value: number }; uLight: { value: THREE.Color } };
 constructor(n: number, blending: THREE.Blending) {
  super(n);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aShape', new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage));
  this.uniforms = { uScale: { value: 400 }, uMaxSize: { value: 80 }, uLight: { value: new THREE.Color(1, 1, 1) } };
  const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, blending });
  this.points = new THREE.Points(g, m); this.points.frustumCulled = false; this.points.renderOrder = 6; this.points.visible = false;
 }
 emit(e: Emit) { super.emit(e); this.live = this.n; this.points.visible = true; }
 update(dt: number, camera: THREE.PerspectiveCamera, height: number, ground?: Ground, wx = 0, wz = 0) {
  if (!this.live) return;
  this.uniforms.uScale.value = height / (2 * Math.tan(camera.fov * Math.PI / 360)); this.uniforms.uMaxSize.value = Math.max(8, height * .2);
  const alive = this.step(dt, ground, wx, wz);
  // Upload only the touched index range; draw only the live one.
  const g = this.points.geometry;
  if (this.hi >= this.lo) for (const name of ['position', 'aColor', 'aSize', 'aAlpha', 'aRot', 'aShape']) { const a = g.attributes[name] as THREE.BufferAttribute; a.clearUpdateRanges(); a.addUpdateRange(this.lo * a.itemSize, (this.hi - this.lo + 1) * a.itemSize); a.needsUpdate = true; }
  g.setDrawRange(alive ? this.first : 0, alive ? this.last - this.first + 1 : 0);
  if (!alive) { this.live = 0; this.points.visible = false; }
 }
}
/** Chip palettes from the scene's own deposit colours (scene.ts): host rock, ore flakes, stains. */
const P = {
 stone: ['#b9ad9c', '#a89c8c', '#c2b6a4', '#9d9284'], ironHost: ['#4a4038', '#8a6a50', '#5a4a3e'], ironFlake: ['#4a5763', '#5f6e7a'], rust: ['#7a3f22', '#8e5030'],
 copperHost: ['#3c4640', '#6f8f7c', '#4a5650'], copperFlake: ['#b8703f', '#c98450'], patina: ['#3f8f78', '#4fa088'], ice: ['#ffffff', '#e8f4f8', '#cfe6ec', '#9cc0cc'],
 sand: ['#d3bb82', '#cdb67f', '#dcc58f', '#c4a874'], grass: ['#3c4a39', '#6d7c5d', '#b8ae80', '#56664a'],
} as const;
/** Solid chunks: the deposit's host rock and, for ores, a share of the metal. */
const CHUNK: Record<string, readonly string[]> = { stone: P.stone, iron: [...P.ironHost, ...P.ironHost, '#5f6e7a'], copper: [...P.copperHost, ...P.copperHost, '#c98450'], ice: ['#f4fbff', '#d8ecf2', '#b5d6e0'] };
export const MATERIAL_FX: Record<string, string> = { stone: '#b9b0a2', iron: '#5a4c44', copper: '#b8703f', ice: '#e8f6fb', sand: '#d8c08a', grass: '#8a9a5e' };
const DUST: Record<string, string> = { stone: '#c9b79c', iron: '#9a8270', copper: '#8f9a88', ice: '#f4fbff', sand: '#dcc79a', grass: '#a7b07a' };
type V3 = { x: number; y: number; z: number };
/** Low quality: half the emission and at most 416 live particles in the pools (the other 96 of the 512 budget are dust motes). */
export const FX_CAPS = { low: { solid: 200, soft: 160, glow: 56, emission: .5 }, standard: { solid: 700, soft: 500, glow: 240, emission: 1 }, high: { solid: 700, soft: 500, glow: 240, emission: 1 } } as const;
export type FxEnv = { night?: number; wind?: WindState };
export function createFx(scene: THREE.Scene, opts: { ground?: Ground } = {}) {
 const solid = new Pool(700, THREE.NormalBlending), soft = new Pool(500, THREE.NormalBlending), glow = new Pool(240, THREE.AdditiveBlending);
 scene.add(solid.points, soft.points, glow.points);
 let enabled = true, emission = 1, quality: keyof typeof FX_CAPS = 'standard', wisp = 0;
 const ground = opts.ground, wind = { vx: 0, vz: 0, gust: .55, dirX: 1, dirZ: 0 };
 // Particles are pure motion: prefers-reduced-motion switches every emitter off.
 const on = () => enabled && !reducedMotion();
 // Emission scale with probabilistic rounding, so single-particle emitters still fire on Low.
 const scaled = (pool: Pool, e: Emit) => { const c = (e.count ?? 1) * emission, n = Math.floor(c) + (Math.random() < c % 1 ? 1 : 0); if (n) pool.emit(n === e.count ? e : { ...e, count: n }); };
 const out = (n?: V3) => n ? { normal: n } : {};
 const day = new THREE.Color(1, 1, 1), night = new THREE.Color(.13, .15, .21), lit = new THREE.Color();
 const api = {
  set enabled(v: boolean) { enabled = v; }, get enabled() { return enabled; },
  setQuality(q: keyof typeof FX_CAPS) { const c = FX_CAPS[q]; quality = q; solid.setCap(c.solid); soft.setCap(c.soft); glow.setCap(c.glow); emission = c.emission; },
  /** Chips off a deposit at each tool strike, flying out of the struck face (`normal`) and settling on the ground. */
  strike(x: number, y: number, z: number, material: string, normal?: V3) {
   if (!on()) return; const n = out(normal), base = { x, y, z, ...n, hold: .75, bounce: .28, life: 1.9, gravity: 9.5, drag: .5 };
   // S4: a few solid chunks of the material (faceted, lit top) with every strike, besides the small chips.
   if (material !== 'grass' && material !== 'sand') scaled(solid, { ...base, color: CHUNK[material] ?? CHUNK.stone, count: 4, spread: 1.5, up: 2.6, push: .6, size: .15, shape: SHAPE.chunk, spin: 7, bounce: .22 });
   switch (material) {
    case 'iron': case 'copper': {
     const iron = material === 'iron';
     // Metal on metal: short hot sparks off the struck face.
     scaled(glow, { x, y, z, ...n, color: ['#ffd28a', '#ffb45a', '#fff1c8'], count: 3, spread: 2.6, up: 1.5, push: 1.2, size: .05, life: .25, gravity: 6, drag: .4, shape: SHAPE.spark, spin: 3 });
     scaled(solid, { ...base, color: iron ? P.ironHost : P.copperHost, count: 6, spread: 1.6, up: 2.8, push: .55, size: .1, shape: SHAPE.shard, spin: 9 });
     scaled(solid, { ...base, color: iron ? P.ironFlake : P.copperFlake, count: 5, spread: 1.8, up: 2.4, push: .6, size: .08, shape: SHAPE.flake, spin: 14, bounce: .2 });
     scaled(solid, { ...base, color: iron ? P.rust : P.patina, count: 3, spread: 1.4, up: 2, push: .5, size: .05, shape: SHAPE.grain });
     break; }
    case 'ice':
     scaled(solid, { ...base, color: P.ice, count: 9, spread: 1.8, up: 3, push: .6, size: .1, shape: SHAPE.shard, spin: 10, bounce: .45 });
     scaled(glow, { x, y, z, ...n, color: '#bff6ff', count: 4, spread: 1.8, up: 1.6, push: .8, size: .07, life: .5, gravity: 4, shape: SHAPE.spark, spin: 4 });
     break;
    case 'sand':
     scaled(solid, { ...base, color: P.sand, count: 16, spread: 1.4, up: 2.2, push: .5, size: .04, shape: SHAPE.grain, bounce: .1, life: 1.6 });
     scaled(soft, { x, y, z, ...n, color: DUST.sand, count: 4, spread: .9, up: .5, push: .4, size: .45, grow: 2.2, life: 1.6, gravity: -.1, drag: 1.2, alpha: .32, shape: SHAPE.soft, wind: .45 });
     return;
    case 'grass':
     scaled(solid, { x, y, z, ...n, color: P.grass, count: 6, spread: 1.5, up: 1.8, push: .7, size: .1, shape: SHAPE.leaf, spin: 6, gravity: 2.5, drag: 2.2, wind: .7, flutter: 3, bounce: .05, hold: .75, life: 2.2 });
     return;
    default:
     scaled(solid, { ...base, color: P.stone, count: 10, spread: 1.7, up: 2.9, push: .55, size: .1, shape: SHAPE.shard, spin: 9 });
   }
   scaled(soft, { x, y, z, ...n, color: DUST[material] ?? DUST.stone, count: 3, spread: .7, up: .5, push: .3, size: .4, grow: 1.8, life: .9, gravity: -.2, drag: 1.4, alpha: .4, shape: SHAPE.soft, wind: .35 });
  },
  /** A finished block: a heavier burst and a dust cloud. */
  block(x: number, y: number, z: number, material: string, normal?: V3) {
   if (!on()) return; const n = out(normal);
   const pal = material === 'iron' ? [...P.ironHost, ...P.ironFlake] : material === 'copper' ? [...P.copperHost, ...P.copperFlake] : material === 'ice' ? P.ice : material === 'sand' ? P.sand : material === 'grass' ? P.grass : P.stone;
   const shape = material === 'sand' ? SHAPE.grain : material === 'grass' ? SHAPE.leaf : SHAPE.shard;
   scaled(solid, { x, y, z, ...n, color: pal, count: material === 'sand' ? 26 : 18, spread: 3, up: 3.4, push: 1.4, size: material === 'sand' ? .045 : .12, life: 2.2, gravity: material === 'grass' ? 3 : 10, drag: material === 'grass' ? 2 : .4, shape, spin: 10, bounce: material === 'ice' ? .4 : .25, hold: .75, wind: material === 'grass' ? .7 : 0, flutter: material === 'grass' ? 3 : 0 });
   scaled(soft, { x, y: y - .2, z, ...n, color: DUST[material] ?? DUST.stone, count: 8, spread: 1.4, up: .7, push: .4, size: .55, grow: 2.2, life: 1.4, gravity: -.15, drag: 1.2, alpha: .4, shape: SHAPE.soft, wind: .4 });
   if (material !== 'grass' && material !== 'sand') scaled(solid, { x, y, z, ...n, color: CHUNK[material] ?? CHUNK.stone, count: 12, spread: 2.4, up: 3.2, push: 1.1, size: .17, life: 2.2, gravity: 10, drag: .4, shape: SHAPE.chunk, spin: 8, bounce: .25, hold: .75 });
  },
  /** The last block: the deposit collapses (0.5 s) — heavy chunks over its footprint and a low ring of dust. */
  crumble(x: number, y: number, z: number, radius: number, material: string) {
   if (!on()) return; const loose = material === 'sand' || material === 'grass';
   for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2 + Math.random() * .3, r = radius * (.2 + Math.random() * .6); scaled(solid, { x: x + Math.cos(a) * r, y: y + .25 + Math.random() * .5, z: z + Math.sin(a) * r, vx: Math.cos(a) * 1.2, vz: Math.sin(a) * 1.2, color: loose ? P.sand : CHUNK[material] ?? CHUNK.stone, size: loose ? .05 : .2, up: 1.6, life: 2.4, gravity: 10, drag: .4, shape: loose ? SHAPE.grain : SHAPE.chunk, spin: 6, bounce: .2, hold: .8 }); }
   for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; scaled(soft, { x: x + Math.cos(a) * radius * .6, y: y + .15, z: z + Math.sin(a) * radius * .6, vx: Math.cos(a) * 1.5, vz: Math.sin(a) * 1.5, color: DUST[material] ?? DUST.stone, size: .6, grow: 2.4, life: 1.8, gravity: -.1, drag: 1.4, alpha: .42, shape: SHAPE.soft, wind: .4 }); }
   if (material === 'ice') scaled(glow, { x, y: y + .4, z, color: '#bff6ff', count: 8, spread: 2, up: 1.4, size: .07, life: .6, gravity: 3, shape: SHAPE.spark, spin: 4 });
  },
  /** Loading: shows the pools so compileAsync builds their programs (no first-strike shader compile). */
  prewarm(on: boolean) { for (const p of [solid, soft, glow]) p.points.visible = on || p.points.visible && p.alive > 0; },
  /** A placed station settles: a ring of dust at its footprint. */
  land(x: number, y: number, z: number, radius: number) {
   if (!on()) return;
   for (let i = 0; i < 26; i++) { const a = i / 26 * Math.PI * 2; scaled(soft, { x: x + Math.cos(a) * radius, y: y + .08, z: z + Math.sin(a) * radius, vx: Math.cos(a) * 1.8, vz: Math.sin(a) * 1.8, color: '#cdb796', size: .45, grow: 2, life: 1.2, gravity: -.1, drag: 1.6, alpha: .45, shape: SHAPE.soft, wind: .2 }); }
   scaled(glow, { x, y: y + .2, z, color: '#7fe6da', count: 14, spread: 2.4, up: 2, size: .06, life: .7, gravity: 3 });
  },
  /** A footstep on loose ground: a low puff in the ground's own colour (1 walking, 2 running), carried by the wind. */
  footDust(x: number, y: number, z: number, color: THREE.ColorRepresentation, run: boolean, backX = 0, backZ = 0) {
   if (!on()) return;
   scaled(soft, { x, y: y + .05, z, vx: wind.vx * .3 + backX * .5, vz: wind.vz * .3 + backZ * .5, color, count: run ? 2 : 1, spread: .35, up: .25, size: .24, grow: 1.6, life: 1.1, gravity: -.05, drag: 1.6, alpha: run ? .22 : .16, shape: SHAPE.soft, wind: .3 });
  },
  /** Landing after a jump or a drop: a ring of dust around the feet. */
  landing(x: number, y: number, z: number, color: THREE.ColorRepresentation) {
   if (!on()) return;
   for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; scaled(soft, { x: x + Math.cos(a) * .25, y: y + .05, z: z + Math.sin(a) * .25, vx: Math.cos(a) * 1.4, vz: Math.sin(a) * 1.4, color, size: .26, grow: 1.8, life: 1, gravity: -.05, drag: 2.2, alpha: .2, shape: SHAPE.soft, wind: .25 }); }
  },
  /** Sparks travelling along a new cable or pipe. */
  connect(points: THREE.Vector3[], kind: 'cable' | 'gas_pipe') {
   if (!on()) return; const c = kind === 'cable' ? '#ffb46a' : '#9ff1ff';
   points.forEach((p, i) => { if (i % 2) return; scaled(glow, { x: p.x, y: p.y, z: p.z, color: c, count: 3, spread: .8, up: .8, size: .07, life: .5 + i * .02, gravity: 2 }); });
  },
  smoke(x: number, y: number, z: number, dark = false) { if (on()) scaled(soft, { x, y, z, color: dark ? '#35312e' : '#625c56', count: 2, spread: .3, up: .9, size: .42, grow: 3.2, life: 2.6, gravity: -.35, drag: .8, alpha: dark ? .75 : .68, vx: .25, shape: SHAPE.soft, wind: .5 }); },
  steam(x: number, y: number, z: number) { if (on()) scaled(soft, { x, y, z, color: '#f2fbff', count: 1, spread: .2, up: .7, size: .18, grow: 2.4, life: 1.4, gravity: -.3, drag: 1, alpha: .28, shape: SHAPE.soft, wind: .5 }); },
  ember(x: number, y: number, z: number) { if (on()) scaled(glow, { x, y, z, color: '#ff9a4a', count: 1, spread: .5, up: 1.4, size: .04, life: .9, gravity: -.4, drag: .9, wind: .2 }); },
  /** Air leaving a breached room: a steam jet along `n` (out of the opening) and dust lifted at its foot; `k` 0…1 fades it. */
  vent(x: number, y: number, z: number, n: { x: number; y: number; z: number }, k = 1) {
   if (!on()) return; const s = Math.max(.25, k);
   scaled(soft, { x, y, z, normal: n, push: 3.2 * s, color: '#eef8f8', count: 3, spread: .5, up: .2, size: .3, grow: 3, life: 1.1, gravity: -.2, drag: 1.6, alpha: .34 * s, shape: SHAPE.soft, wind: .3 });
   scaled(soft, { x, y: y - .4, z, normal: n, push: 1.6 * s, color: '#cdb796', count: 2, spread: .9, up: .4, size: .4, grow: 2.2, life: 1.3, gravity: -.1, drag: 1.4, alpha: .26 * s, shape: SHAPE.soft, wind: .5 });
  },
  hiss(x: number, y: number, z: number) { if (on()) scaled(soft, { x, y, z, color: '#e9f3f2', count: 3, spread: 1.4, up: .3, size: .25, grow: 2.5, life: .9, gravity: 0, drag: 1.8, alpha: .3, shape: SHAPE.soft }); },
  /** `height`: framebuffer pixels. `env`: day/night level and the shared wind (dt is the frozen scene step). */
  update(dt: number, camera: THREE.PerspectiveCamera, height: number, env: FxEnv = {}) {
   if (env.wind) Object.assign(wind, { vx: env.wind.vx, vz: env.wind.vz, gust: env.wind.gust, dirX: env.wind.dirX, dirZ: env.wind.dirZ });
   lit.copy(day).lerp(night, env.night ?? 0); solid.uniforms.uLight.value.copy(lit); soft.uniforms.uLight.value.copy(lit);
   // Gust wisps: large faint sheets of dust skimming the ground upwind of the viewer, only in strong gusts (not on Low).
   if (dt > 0 && quality !== 'low' && wind.gust > .75 && on() && ground) {
    wisp -= dt * (wind.gust - .7) * 6;
    if (wisp <= 0) {
     wisp = 1; const back = 6 + Math.random() * 10, side = (Math.random() - .5) * 22, px = camera.position.x - wind.dirX * back - wind.dirZ * side, pz = camera.position.z - wind.dirZ * back + wind.dirX * side;
     scaled(soft, { x: px, y: ground(px, pz) + .25 + Math.random() * .5, z: pz, vx: wind.vx * 1.1, vz: wind.vz * 1.1, color: '#d9c4a0', size: 2, grow: .8, life: 4, gravity: 0, drag: 0, alpha: .1 + (wind.gust - .75) * .3, shape: SHAPE.soft, wind: 1, count: 1 });
    }
   }
   solid.update(dt, camera, height, ground, wind.vx, wind.vz); soft.update(dt, camera, height, ground, wind.vx, wind.vz); glow.update(dt, camera, height, ground, wind.vx, wind.vz);
  },
  stats: () => ({ solid: solid.alive, soft: soft.alive, glow: glow.alive, live: solid.alive + soft.alive + glow.alive, cap: solid.cap + soft.cap + glow.cap }),
 };
 return api;
}
export type Fx = ReturnType<typeof createFx>;
