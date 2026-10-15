import * as THREE from 'three';
/**
 * Boot prints in loose ground (S4): a ring buffer of instanced decals that lie on the terrain (each
 * corner takes its own height, so a print follows the ground exactly) and fade with the frozen scene
 * time. Multiply blending darkens whatever lighting the ground has, day or night. Static, so they stay
 * under reduced motion. Never saved and never read by the game.
 */
export const FOOTPRINTS = { low: { count: 48, life: 30 }, standard: { count: 96, life: 60 }, high: { count: 160, life: 90 } } as const;
export type Quality = keyof typeof FOOTPRINTS;
export const PRINT_W = .14, PRINT_L = .3, MAX_SLOPE = .45;
type Ground = (x: number, z: number) => number;
/** May a print be left at this body position? Not in the capsule, not on colliders/floors (crates, dome, capsule deck), not on steep rock. */
export function printAllowed(x: number, y: number, z: number, ground: Ground, inside: boolean) {
 if (inside || Math.abs(y - ground(x, z)) > 1e-3) return false;
 const e = .5, gx = (ground(x + e, z) - ground(x - e, z)) / (2 * e), gz = (ground(x, z + e) - ground(x, z - e)) / (2 * e);
 return Math.hypot(gx, gz) <= MAX_SLOPE;
}
/** Ring-buffer bookkeeping: the oldest print is overwritten. */
export class PrintRing {
 next = 0; count = 0;
 constructor(public size: number) {}
 write() { const i = this.next; this.next = (this.next + 1) % this.size; this.count = Math.min(this.size, this.count + 1); return i; }
 clear() { this.next = 0; this.count = 0; }
 resize(size: number) { this.size = size; this.clear(); }
}
/** Corner order shared with the vertex shader: heel-left, heel-right, toe-right, toe-left (local x across, y along). */
const CORNERS = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]] as const;
export function printCorners(x: number, z: number, yaw: number) {
 const c = Math.cos(yaw), s = Math.sin(yaw);
 // Forward (sin yaw, cos yaw), right (−cos yaw, sin yaw): the game's convention (controller.ts).
 return CORNERS.map(([u, v]) => [x - c * u * PRINT_W + s * v * PRINT_L, z + s * u * PRINT_W + c * v * PRINT_L] as const);
}
const MAX = FOOTPRINTS.high.count;
export function createFootprints(scene: THREE.Scene, ground: Ground) {
 const g = new THREE.InstancedBufferGeometry();
 g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
 const pose = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage), heights = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage), side = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
 g.setAttribute('aPose', pose); g.setAttribute('aH', heights); g.setAttribute('aSide', side); g.instanceCount = 0;
 const uniforms = { uTime: { value: 0 }, uLife: { value: 60 }, uTint: { value: new THREE.Vector3(.7, .66, .62) } };
 const m = new THREE.ShaderMaterial({
  uniforms, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
  vertexShader: `attribute vec4 aPose;attribute vec4 aH;attribute float aSide;uniform float uTime,uLife;varying vec2 vUv;varying float vFade;
  void main(){float k=position.x;vec2 l=vec2(k==1.||k==2.?.5:-.5,k>=2.?.5:-.5);float c=cos(aPose.z),s=sin(aPose.z);
   vec2 xz=aPose.xy+vec2(-c,s)*l.x*${PRINT_W}+vec2(s,c)*l.y*${PRINT_L};float h=k<.5?aH.x:k<1.5?aH.y:k<2.5?aH.z:aH.w;
   vec4 mv=viewMatrix*vec4(xz.x,h+.012,xz.y,1.);gl_Position=projectionMatrix*mv;
   vUv=l+.5;if(aSide<0.)vUv.x=1.-vUv.x;
   vFade=(1.-smoothstep(.55*uLife,uLife,uTime-aPose.w))*(1.-smoothstep(24.,34.,-mv.z));}`,
  // Procedural right sole (the left one is mirrored): forefoot, arch and heel, cross lugs pressed deeper than the gaps; a soft rim of pushed-up dust is left untouched.
  fragmentShader: `uniform vec3 uTint;varying vec2 vUv;varying float vFade;
  void main(){vec2 u=vUv;float fore=length(vec2((u.x-.47)/.44,(u.y-.71)/.27)),heel=length(vec2((u.x-.5)/.37,(u.y-.19)/.18)),arch=length(vec2((u.x-.42)/.3,(u.y-.45)/.22));
   float d=min(min(fore,heel),arch),m=1.-smoothstep(.7,1.,d);
   float lug=.72+.28*smoothstep(.3,.6,abs(fract(u.y*8.5)-.5)*2.);float mid=mix(.7,1.,smoothstep(.05,.14,abs(u.y-.42)));
   float k=m*lug*mid*vFade;if(k<.01)discard;gl_FragColor=vec4(mix(vec3(1.),uTint,k),1.);}`,
 });
 const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 1; mesh.name = 'footprints'; scene.add(mesh);
 const ring = new PrintRing(FOOTPRINTS.standard.count); let time = 0, quality: Quality = 'standard';
 const touch = (a: THREE.InstancedBufferAttribute, i: number) => { a.addUpdateRange(i * a.itemSize, a.itemSize); a.needsUpdate = true; };
 return {
  mesh,
  /** One print centred at (x, z), toes along `yaw`; `foot` −1 left, +1 right (mirrors the sole). */
  add(x: number, z: number, yaw: number, foot: number) {
   const i = ring.write(); pose.setXYZW(i, x, z, yaw, time);
   const c = printCorners(x, z, yaw); heights.setXYZW(i, ground(c[0][0], c[0][1]), ground(c[1][0], c[1][1]), ground(c[2][0], c[2][1]), ground(c[3][0], c[3][1])); side.setX(i, foot);
   touch(pose, i); touch(heights, i); touch(side, i); g.instanceCount = ring.count;
  },
  /** `dt`: the frozen scene step. */
  update(dt: number) { time += dt; uniforms.uTime.value = time; },
  clear() { ring.clear(); g.instanceCount = 0; },
  setQuality(q: Quality) { if (q === quality) return; quality = q; ring.resize(FOOTPRINTS[q].count); uniforms.uLife.value = FOOTPRINTS[q].life; g.instanceCount = 0; },
  /** Prints still visible (younger than their fade-out). */
  get visible() { let n = 0; for (let i = 0; i < ring.count; i++) if (time - pose.getW(i) < uniforms.uLife.value) n++; return n; },
  get count() { return ring.count; },
 };
}
export type Footprints = ReturnType<typeof createFootprints>;
