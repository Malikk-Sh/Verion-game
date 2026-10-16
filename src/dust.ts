import * as THREE from 'three';
import type { WindState } from './wind';
/**
 * Wind-borne dust (S5, replaces the S4 streaks that read as worms). Two layers, both driven by the shared wind:
 * motes — one instanced draw call of soft round sprites of varied size and low alpha that drift with the wind, swirl
 * harder and lift in gusts, fade in and out over a short life (respawning elsewhere while invisible), are densest at
 * the feet and thin out with height; and drift — a few translucent ribbons of sand sliding low over the ground along
 * the wind near the player, only during gusts (one more draw call, hidden while none is alive). Everything advances
 * on the frozen scene step, so paused frames do not move; prefers-reduced-motion shows no dust at all.
 */
/** Motes live in a box around the camera (it divides WIND_WRAP, so the wrap never jumps) and fade out at half its size. */
export const MOTES = { low: { count: 72, box: 16 }, standard: { count: 200, box: 20 }, high: { count: 320, box: 20 } } as const;
/** Live sand ribbons at most (they count towards the Low particle budget with the motes and the fx pools). */
export const DRIFT = { low: 6, standard: 10, high: 14 } as const;
export type DustQuality = keyof typeof MOTES;
/** Eye height above the ground the motes are spread from (the camera follows the ground). */
const EYE = 1.65;
export function createMotes(max = MOTES.high.count) {
 const g = new THREE.InstancedBufferGeometry();
 g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
 // Deterministic seeds: the same motes in every session and every test.
 const seed = new Float32Array(max * 4); let r = 91813; const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; }; for (let i = 0; i < seed.length; i++) seed[i] = rnd();
 g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4)); g.instanceCount = MOTES.standard.count;
 const uniforms = { uOffset: { value: new THREE.Vector2() }, uBox: { value: 40 }, uTime: { value: 0 }, uWind: { value: new THREE.Vector3(1.5, 0, 0) }, uGust: { value: .55 }, uOrigin: { value: new THREE.Vector3() },
  uSun: { value: new THREE.Vector3(0, 1, 0) }, uNight: { value: 0 }, uTint: { value: new THREE.Color('#fff1d6') }, uOpacity: { value: .5 }, uPx: { value: 200 } };
 const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms,
  vertexShader: `attribute vec4 aSeed;uniform vec2 uOffset;uniform float uBox,uTime,uGust,uPx;uniform vec3 uWind,uOrigin;varying vec3 vView;varying vec2 vQ;varying float vA,vSoft;
  void main(){
   // A short life (3.5…8 s): each cycle the mote reappears at a new hashed spot, invisible at the seam.
   float life=3.5+4.5*aSeed.w,cyc=uTime/life+aSeed.y*7.,n=floor(cyc),ph=fract(cyc);
   vec2 j=fract(sin(vec2(n*12.9898+aSeed.x*78.233,n*39.346+aSeed.z*11.135))*43758.5453);
   vec3 p;p.xz=fract(aSeed.xz+j)*uBox+uOffset;
   // Lighter motes run ahead of the mean drift during their life; gusts swirl them harder.
   p.xz+=uWind.xz*ph*life*(.1+.4*aSeed.z)+vec2(sin(uTime*.9+aSeed.w*31.),cos(uTime*.7+aSeed.x*17.))*(.15+.45*uGust);
   p.xz=mod(p.xz-uOrigin.xz+uBox*.5,uBox)-uBox*.5+uOrigin.xz;
   // Densest at the feet, thinning with height; gusts lift them a little over their life.
   float hgt=pow(fract(aSeed.y*3.7+j.x),2.4)*3.4+ph*.5*uGust;
   p.y=uOrigin.y-${EYE.toFixed(2)}+.04+hgt+sin(uTime*1.3+aSeed.w*40.)*.06;
   vec4 hv=viewMatrix*vec4(p,1.);float dist=-hv.z;vView=p-cameraPosition;
   // Mostly fine grains (0.8…3.5 cm), one in eight a faint soft puff (8…20 cm); never thinner than 1.2 px (alpha compensates).
   bool puff=aSeed.w<.125;float rad=puff?mix(.08,.2,aSeed.z):mix(.008,.035,aSeed.z*aSeed.z),rp=max(rad,1.2*max(dist,.05)/uPx);
   hv.xy+=position.xy*rp;gl_Position=dist>.05?projectionMatrix*hv:vec4(0.,0.,2.,1.);vQ=position.xy;vSoft=puff?1.:0.;
   float fade=smoothstep(0.,.25,ph)*(1.-smoothstep(.65,1.,ph));
   float dens=smoothstep(aSeed.x-.15,aSeed.x,.3+.7*uGust); // more motes are aloft in a gust
   vA=pow(rad/rp,2.)*fade*dens*smoothstep(.5,1.6,dist)*(1.-smoothstep(uBox*.3,uBox*.5,dist))*(1.-.7*smoothstep(.4,3.4,hgt))*(puff?.12:.6+.4*aSeed.w);}`,
  fragmentShader: `uniform vec3 uSun,uTint;uniform float uNight,uOpacity;varying vec3 vView;varying vec2 vQ;varying float vA,vSoft;
  void main(){float r2=dot(vQ,vQ);if(r2>1.)discard;float a=vSoft>.5?exp(-r2*3.)*(1.-r2):1.-smoothstep(.35,1.,sqrt(r2));
   float scatter=pow(max(dot(normalize(vView),uSun),0.),8.)*(1.-uNight);
   gl_FragColor=vec4(uTint*(1.+2.2*scatter),min(1.,a*vA*uOpacity*(1.+scatter*1.4)));
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
  }` });
 const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.name = 'dust-motes';
 let quality: DustQuality = 'standard';
 return { mesh, uniforms,
  setQuality(q: DustQuality) { quality = q; g.instanceCount = Math.min(max, MOTES[q].count); uniforms.uBox.value = MOTES[q].box; },
  get count() { return mesh.visible ? g.instanceCount : 0; }, get quality() { return quality; } };
}

/** One ribbon of blowing sand: centre (x, z), ground under both ends, size, speed factor and life. */
export type Sheet = { x: number; z: number; y0: number; y1: number; len: number; height: number; speed: number; age: number; life: number; seed: number; r: number; g: number; b: number };
/**
 * Ribbons of sand skimming the ground in gusts (CPU part, testable without WebGL). Above a gust of 0.6 new ribbons are
 * born in front of the player (`fx`, `fz`: the horizontal view direction), upwind of where they cross the view, slide
 * downwind faster than the mean wind, follow the ground and fade in and out over 2.5…4.5 s; their strength follows the
 * gust. `update` with dt 0 changes nothing.
 */
export class SandDrift {
 sheets: Sheet[] = []; cap: number = DRIFT.standard; private clock = 0; private rnd: () => number;
 /** Ribbons born so far (diagnostics: the gust check counts births, not ribbons left from an earlier gust). */
 born = 0;
 constructor(seed = 4242) { let r = seed >>> 0; this.rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; }; }
 setQuality(q: DustQuality) { this.cap = DRIFT[q]; if (this.sheets.length > this.cap) this.sheets.length = this.cap; }
 clear() { this.sheets.length = 0; this.clock = 0; }
 /** Strength 0…1 of a ribbon now: in and out over its life, scaled by the gust. */
 static strength(s: Sheet, gust: number) { const k = s.age / s.life; return Math.max(0, Math.sin(Math.PI * Math.min(1, k))) * Math.min(1, Math.max(0, (gust - .45) / .35)); }
 update(dt: number, wind: Pick<WindState, 'gust' | 'vx' | 'vz' | 'dirX' | 'dirZ' | 'speed'>, ox: number, oz: number, ground: (x: number, z: number) => number, color?: (x: number, z: number) => THREE.Color, still = false, fx = 0, fz = 1) {
  if (still) { this.clear(); return; }
  if (!(dt > 0)) return;
  for (const s of this.sheets) { s.age += dt; s.x += wind.vx * s.speed * dt; s.z += wind.vz * s.speed * dt; const hx = wind.dirX * s.len / 2, hz = wind.dirZ * s.len / 2; s.y0 = ground(s.x - hx, s.z - hz); s.y1 = ground(s.x + hx, s.z + hz); }
  this.sheets = this.sheets.filter(s => s.age < s.life && Math.hypot(s.x - ox, s.z - oz) < 30);
  if (wind.gust <= .6) { this.clock = 0; return; }
  this.clock += dt * (wind.gust - .6) / .4 * this.cap * .45; // up to ~0.45 × cap new ribbons a second in the strongest gust
  while (this.clock >= 1) {
   this.clock -= 1; if (this.sheets.length >= this.cap) continue;
   // Born where the player looks (4…14 m ahead, ±7 m aside), moved upwind by half of the way it will travel, so it slides through the view.
   const life = 2.5 + this.rnd() * 2, speed = 1.4 + this.rnd() * .7, ahead = 4 + this.rnd() * 10, side = (this.rnd() - .5) * 14, half = wind.speed * speed * life / 2;
   const x = ox + fx * ahead - fz * side - wind.dirX * half, z = oz + fz * ahead + fx * side - wind.dirZ * half;
   const len = 3 + this.rnd() * 4, hx = wind.dirX * len / 2, hz = wind.dirZ * len / 2, c = color?.(x, z);
   this.born++; this.sheets.push({ x, z, y0: ground(x - hx, z - hz), y1: ground(x + hx, z + hz), len, height: .25 + this.rnd() * .4, speed, age: 0, life, seed: this.rnd(), r: c?.r ?? .85, g: c?.g ?? .74, b: c?.b ?? .56 });
  }
 }
}
/** The ribbons' draw call: each one faces the camera around its own (wind) axis, rests on the ground at both ends and
 * shows streaks that run along the wind, densest at the bottom. All ribbons share the wind direction (a uniform). */
export function createDrift(max = DRIFT.high) {
 const g = new THREE.InstancedBufferGeometry();
 g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
 // aA: upwind end x, ground y, z, strength; aB: ground y under the downwind end, seed, length, height; aC: ground colour.
 const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4), b = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4), c = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
 for (const v of [a, b, c]) v.setUsage(THREE.DynamicDrawUsage);
 g.setAttribute('aA', a); g.setAttribute('aB', b); g.setAttribute('aC', c); g.instanceCount = 0;
 const uniforms = { uTime: { value: 0 }, uWindDir: { value: new THREE.Vector2(1, 0) }, uNight: { value: 0 } };
 const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms,
  vertexShader: `attribute vec4 aA,aB;attribute vec3 aC;uniform vec2 uWindDir;varying vec2 vUv;varying float vS,vSeed,vLen;varying vec3 vCol;
  void main(){
   vec3 d=vec3(uWindDir.x,(aB.x-aA.y)/max(aB.z,.01),uWindDir.y),along=aA.xyz+vec3(0.,.02,0.)+d*aB.z*position.x;
   vec3 axis=normalize(d),toCam=cameraPosition-along,n=toCam-axis*dot(toCam,axis);n=length(n)>1e-3?normalize(n):vec3(0.,1.,0.);
   vec3 up=normalize(cross(axis,n));if(up.y<0.)up=-up;up=normalize(mix(up,vec3(0.,1.,0.),.35));
   gl_Position=projectionMatrix*viewMatrix*vec4(along+up*aB.w*position.y,1.);vUv=position.xy;vS=aA.w;vSeed=aB.y;vLen=aB.z;vCol=aC;}`,
  fragmentShader: `uniform float uTime,uNight;varying vec2 vUv;varying float vS,vSeed,vLen;varying vec3 vCol;
  void main(){float u=vUv.x,v=vUv.y,t=uTime*1.7+vSeed*40.;
   // Streaks along the wind that crawl downwind and waver; dense at the sand, thin at the top, soft ends.
   float band=.5+.5*sin(v*11.+vSeed*20.+sin(u*vLen*1.1-t*2.3)*1.6),fine=.5+.5*sin(u*vLen*4.7-t*5.+v*6.+vSeed*9.);
   float a=smoothstep(.15,1.,band)*(.55+.45*fine)*pow(1.-v,1.3)*smoothstep(0.,.3,u)*(1.-smoothstep(.65,1.,u))*smoothstep(0.,.08,v);
   // Airborne sand is lit through: lighter and paler than the ground it comes from.
   gl_FragColor=vec4(mix(vCol*1.3,vec3(1.,.94,.84),.45)*mix(1.,.4,uNight),min(.7,a*vS*2.));
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
  }` });
 const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.name = 'sand-drift'; mesh.visible = false;
 return { mesh, uniforms,
  /** Writes the visible ribbons (from their upwind end); hides the mesh when none is visible. */
  sync(sheets: readonly Sheet[], wind: Pick<WindState, 'gust' | 'dirX' | 'dirZ'>) {
   let n = 0; uniforms.uWindDir.value.set(wind.dirX, wind.dirZ);
   for (const s of sheets) { if (n >= max) break; const k = SandDrift.strength(s, wind.gust); if (k <= .01) continue;
    a.setXYZW(n, s.x - wind.dirX * s.len / 2, s.y0, s.z - wind.dirZ * s.len / 2, k); b.setXYZW(n, s.y1, s.seed, s.len, s.height); c.setXYZ(n, s.r, s.g, s.b); n++; }
   if (n) a.needsUpdate = b.needsUpdate = c.needsUpdate = true;
   g.instanceCount = n; mesh.visible = n > 0; return n;
  },
  get live() { return mesh.visible ? g.instanceCount : 0; } };
}
