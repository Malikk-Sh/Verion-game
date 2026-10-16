import * as THREE from 'three';
import { reducedMotion } from './motion';
import { depositScale } from './game/resources';
import { kickEnvelope } from './strikes';
/**
 * How a deposit model answers the pick (S4, Malik's point 7). A mined deposit squats (`depositScale`)
 * and drops its loose pieces from the end of each merged mesh (draw range, no extra draw calls);
 * every strike punches the group (short squash and wobble about its base); the last block crumbles
 * over 0.5 s with its collider already gone. One shared crack shell — a transparent copy of the aimed
 * group's largest mesh — grows a crack network from the first hit point in three stages: at most one
 * extra draw call. Animation lives only on the struck or crumbling group, runs on the scene's own
 * (frozen in pause) time, and reduced motion skips the punch and the crumble. Visual only.
 * A new vein (D33) rises out of the ground over EMERGE_S (instant under reduced motion).
 */
export const CRUMBLE_S = .5, EMERGE_S = 1.2;
// World-position Voronoi edges on the dominant axis plane (StaticBatch meshes carry zero UVs), masked by
// a jagged radius around the hit point that grows with the level; drawn 4 mm above the surface.
const VERT = `varying vec3 vW;varying vec3 vN;
void main(){vec4 w=modelMatrix*vec4(position+normal*.004,1.);vW=w.xyz;vN=mat3(modelMatrix)*normal;gl_Position=projectionMatrix*viewMatrix*w;}`;
const FRAG = `uniform vec3 uHit;uniform float uLevel;uniform float uSize;varying vec3 vW;varying vec3 vN;
vec2 h2(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return fract(sin(p)*43758.5453);}
float edge(vec2 p){vec2 i=floor(p),f=fract(p);float a=8.,b=8.;for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 g=vec2(float(x),float(y)),r=g+h2(i+g)-f;float d=dot(r,r);if(d<a){b=a;a=d;}else if(d<b)b=d;}return sqrt(b)-sqrt(a);}
void main(){vec3 n=abs(normalize(vN));vec2 p=n.x>n.y&&n.x>n.z?vW.zy:n.y>n.z?vW.xz:vW.xy;
 float d=length(vW-uHit)/uSize,reach=uLevel*(.3+.22*h2(floor(p*4.)).x),m=1.-smoothstep(reach*.7,reach,d);
 float w=(.07+.07*uLevel)*(1.-.5*min(1.,d/max(reach,.001))),e=edge(p*7.),a=(1.-smoothstep(w*.45,w,e))*m;
 a=max(a,(1.-smoothstep(.025,.05,edge(p*17.+3.7)))*m*smoothstep(.5,.7,uLevel)*.55);
 if(a<.02)discard;gl_FragColor=vec4(.045,.038,.032,min(1.,a)*.88);}`;
export type DepositShape = { xz: number; y: number };
export function createDepositFeel(groups: Map<string, THREE.Group>, invalidateShadows: () => void, reduced: () => boolean = reducedMotion) {
 const punch = new Map<string, { t: number; amp: number; ax: number; az: number }>(), crumbling = new Map<string, number>(), rising = new Map<string, { t: number; depth: number }>(), axis = new THREE.Vector3();
 const uniforms = { uHit: { value: new THREE.Vector3() }, uLevel: { value: 0 }, uSize: { value: 1 } };
 const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
 const shell = new THREE.Mesh(new THREE.BufferGeometry(), material); shell.name = 'crack-shell'; shell.visible = false; shell.renderOrder = 3; shell.raycast = () => {};
 let target = 0;
 const shape = (g: THREE.Object3D): DepositShape => g.userData.shape ?? { xz: 1, y: 1 };
 const rest = (g: THREE.Object3D) => { const s = shape(g); g.scale.set(s.xz, s.y, s.xz); g.quaternion.identity(); };
 /** Stock changed (mining, load, import): squat and drop loose pieces; 0 hides the deposit unless it is crumbling. */
 function setAmount(id: string, left: number, amount: number) {
  const g = groups.get(id); if (!g) return;
  if (left > 0 && crumbling.has(id)) { crumbling.delete(id); g.position.y = g.userData.y0 ?? g.position.y; }
  if (left <= 0 && rising.delete(id)) g.position.y = g.userData.y0 ?? g.position.y;
  const f = Math.max(0, Math.min(1, left / amount)); g.userData.shape = depositScale(left, amount); g.visible = left > 0 || crumbling.has(id);
  if (!crumbling.has(id) && !punch.has(id)) rest(g);
  // Pieces after the first are loose blocks: the last ones go first as the stock falls.
  for (const c of g.children) { const p = c.userData.pieces as number[] | undefined; if (p && p.length > 1) (c as THREE.Mesh).geometry.setDrawRange(0, p[Math.min(p.length, 1 + Math.ceil((p.length - 1) * f)) - 1]); }
 }
 /** A strike landed: short squash and wobble about a random horizontal axis (`amp` 1 for rock and metal). */
 function impact(id: string, amp: number) {
  const g = groups.get(id); if (!g || reduced() || crumbling.has(id)) return;
  const a = Math.random() * Math.PI * 2; punch.set(id, { t: 0, amp, ax: Math.cos(a), az: Math.sin(a) });
 }
 /** The last block is gone: collapse over CRUMBLE_S (instant under reduced motion), then hide and redraw the shadow. */
 function crumble(id: string) {
  const g = groups.get(id); if (!g) return; punch.delete(id); rest(g);
  if (rising.delete(id)) g.position.y = g.userData.y0 ?? g.position.y;
  if (reduced()) return; g.visible = true; crumbling.set(id, 0);
 }
 /** A new vein appeared: it rises `depth` metres out of the ground with an ease-out (nothing under reduced motion). */
 function emerge(id: string, depth: number) {
  const g = groups.get(id); if (!g || reduced()) return; rising.set(id, { t: 0, depth }); g.position.y = (g.userData.y0 ?? g.position.y) - depth;
 }
 /** The group is about to be removed (a finished vein): drop every animation that refers to it. */
 function forget(id: string) { punch.delete(id); crumbling.delete(id); rising.delete(id); const g = groups.get(id); if (g && shell.parent === g) { g.remove(shell); shell.visible = false; target = 0; uniforms.uLevel.value = 0; } }
 /** Crack level 0…1 on deposit `id`, centred on `hit` (world); null or 0 hides the shell. */
 function setCrack(id: string | null, level = 0, hit?: THREE.Vector3) {
  const g = id ? groups.get(id) : undefined;
  if (!g || level <= 0) { target = 0; uniforms.uLevel.value = 0; shell.visible = false; return; }
  if (shell.parent !== g) {
   let host: THREE.Mesh | null = null;
   for (const c of g.children) { const m = c as THREE.Mesh; if (m !== shell && m.isMesh && (!host || m.geometry.attributes.position.count > host.geometry.attributes.position.count)) host = m; }
   if (!host) return; shell.geometry = host.geometry; g.add(shell); uniforms.uLevel.value = 0;
  }
  if (hit) uniforms.uHit.value.copy(hit);
  uniforms.uSize.value = Math.max(.3, (shell.geometry.boundingSphere?.radius ?? 1) * shape(g).xz); target = level; shell.visible = true;
 }
 function update(dt: number) {
  for (const [id, p] of punch) {
   const g = groups.get(id); if (!g) { punch.delete(id); continue; }
   p.t += dt; if (p.t >= .4) { punch.delete(id); rest(g); continue; }
   const s = shape(g), k = 1 - .035 * p.amp * kickEnvelope(p.t, .03), w = .026 * p.amp * Math.sin(p.t * 42) * Math.exp(-p.t * 9);
   g.scale.set(s.xz * k, s.y * k, s.xz * k); g.quaternion.setFromAxisAngle(axis.set(p.ax, 0, p.az), w);
  }
  for (const [id, t0] of crumbling) {
   const g = groups.get(id)!, s = shape(g), t = t0 + dt;
   if (t >= CRUMBLE_S) { crumbling.delete(id); g.visible = false; rest(g); g.position.y = g.userData.y0 ?? g.position.y; invalidateShadows(); continue; }
   crumbling.set(id, t); const e = (t / CRUMBLE_S) ** 2, w = 1 + .2 * e;
   g.scale.set(s.xz * w, Math.max(.02, s.y * (1 - e)), s.xz * w); g.position.y = (g.userData.y0 ?? g.position.y) - .15 * e;
  }
  for (const [id, r] of rising) {
   const g = groups.get(id); if (!g) { rising.delete(id); continue; }
   r.t += dt; const k = Math.min(1, r.t / EMERGE_S), e = 1 - (1 - k) ** 3; g.position.y = (g.userData.y0 ?? g.position.y) - r.depth * (1 - e);
   if (k >= 1) { rising.delete(id); invalidateShadows(); }
  }
  // Stage pops ease in over ~60 ms; a new block or idle resets at once.
  const l = uniforms.uLevel; l.value = target < l.value || reduced() ? target : l.value + (target - l.value) * Math.min(1, dt * 16);
  if (shell.visible && target <= 0 && l.value <= 0) shell.visible = false;
 }
 /** Loading: show the shell on the first deposit so compileAsync builds its program (hidden again by the first update). */
 function prewarm() { const g = groups.values().next().value; if (!g) return; setCrack([...groups.keys()][0], 1e-3, g.position); target = 0; uniforms.uLevel.value = 0; shell.visible = true; }
 return { setAmount, impact, crumble, emerge, forget, isCrumbling: (id: string) => crumbling.has(id), setCrack, update, prewarm, shell, get rising() { return rising.size; }, get crumbling() { return crumbling.size; }, get punching() { return punch.size; }, get crackLevel() { return uniforms.uLevel.value; } };
}
export type DepositFeel = ReturnType<typeof createDepositFeel>;
