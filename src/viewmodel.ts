import * as THREE from 'three';
/**
 * First-person hand tool. Rendered in its own small scene after the world with a cleared depth
 * buffer, so it never clips into rocks. Models are procedural placeholders built per tool ID;
 * a future GLB can be registered in HAND_MODELS under the same ID without touching game code.
 */
type Builder = () => THREE.Object3D;
function stoneMultitool(): THREE.Object3D {
 const g = new THREE.Group();
 const dark = new THREE.MeshStandardMaterial({ color: '#23292b', roughness: .55, metalness: .45 });
 const orange = new THREE.MeshStandardMaterial({ color: '#e8742a', roughness: .45, metalness: .2, emissive: '#5a2008', emissiveIntensity: .25 });
 const stone = new THREE.MeshStandardMaterial({ color: '#a7a196', roughness: .92, metalness: 0, flatShading: true });
 const steel = new THREE.MeshStandardMaterial({ color: '#8d979a', roughness: .35, metalness: .85 });
 const handle = new THREE.Mesh(new THREE.CylinderGeometry(.022, .026, .46, 10), dark); handle.position.y = .0; g.add(handle);
 for (const y of [-.12, .02, .12]) { const band = new THREE.Mesh(new THREE.CylinderGeometry(.027, .027, .03, 10), orange); band.position.y = y; g.add(band); }
 const grip = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .1, 10), dark); grip.position.y = -.19; g.add(grip);
 const collar = new THREE.Mesh(new THREE.BoxGeometry(.07, .07, .07), steel); collar.position.y = .23; g.add(collar);
 // Stone head: a chipped wedge on one side, a blunt hammer face on the other.
 const headGeo = new THREE.DodecahedronGeometry(.075, 0); headGeo.scale(1.9, .8, .9);
 const head = new THREE.Mesh(headGeo, stone); head.position.set(.05, .25, 0); head.rotation.z = -.12; g.add(head);
 const strap = new THREE.Mesh(new THREE.BoxGeometry(.03, .1, .095), orange); strap.position.set(0, .25, 0); g.add(strap);
 return g;
}
function wrench():THREE.Group{const g=new THREE.Group(),metal=new THREE.MeshStandardMaterial({color:0xaac0c7,metalness:.7,roughness:.35});const part=(x:number,y:number,w:number,h:number)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,.035),metal);m.position.set(x,y,0);g.add(m);};part(0,0,.065,.48);part(-.055,.26,.045,.14);part(.055,.26,.045,.14);part(0,.20,.14,.055);g.rotation.z=-.15;return g;}
/** S4: a suit glove for bare-hand gathering; `userData.curl(v)` closes the fingers (0 open … 1 fist). */
function glove(): THREE.Object3D {
 const g = new THREE.Group(), cloth = new THREE.MeshStandardMaterial({ color: '#4a5256', roughness: .8, metalness: .05 }), pad = new THREE.MeshStandardMaterial({ color: '#7d8589', roughness: .9 });
 const orange = new THREE.MeshStandardMaterial({ color: '#e8742a', roughness: .5, metalness: .15 }), steel = new THREE.MeshStandardMaterial({ color: '#8d979a', roughness: .35, metalness: .85 });
 // Right hand, palm down, fingers along −z; the knuckle plate and the cuff carry the suit's colours.
 const palm = new THREE.Mesh(new THREE.BoxGeometry(.11, .036, .115), cloth); g.add(palm);
 const plate = new THREE.Mesh(new THREE.BoxGeometry(.085, .012, .06), steel); plate.position.set(0, .022, -.012); g.add(plate);
 const under = new THREE.Mesh(new THREE.BoxGeometry(.096, .008, .1), pad); under.position.y = -.021; g.add(under);
 const cuff = new THREE.Mesh(new THREE.CylinderGeometry(.05, .056, .075, 10), orange); cuff.rotation.x = Math.PI / 2; cuff.position.z = .1; g.add(cuff);
 const ring = new THREE.Mesh(new THREE.CylinderGeometry(.054, .054, .014, 10), steel); ring.rotation.x = Math.PI / 2; ring.position.z = .064; g.add(ring);
 const fingers: THREE.Object3D[] = [];
 for (let i = 0; i < 4; i++) {
  const pivot = new THREE.Group(); pivot.position.set(.04 - i * .027, 0, -.057); g.add(pivot); fingers.push(pivot);
  const len = i === 1 || i === 2 ? .066 : .055, f = new THREE.Mesh(new THREE.BoxGeometry(.023, .025, len), cloth); f.position.z = -len / 2; pivot.add(f);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(.02, .014, .02), pad); tip.position.set(0, -.009, -len + .008); pivot.add(tip);
 }
 const thumb = new THREE.Group(); thumb.position.set(-.058, -.006, -.012); thumb.rotation.y = .75; g.add(thumb);
 const t = new THREE.Mesh(new THREE.BoxGeometry(.025, .024, .055), cloth); t.position.z = -.026; thumb.add(t);
 g.userData.curl = (v: number) => { for (const f of fingers) f.rotation.x = -.12 - v * 1.3; thumb.rotation.x = -v * .5; thumb.rotation.y = .75 - v * .45; };
 g.userData.curl(.15); return g;
}
export const HAND_MODELS: Record<string, Builder> = { tool_stone: stoneMultitool, wrench, hand: glove };

export function createViewModel() {
 const scene = new THREE.Scene();
 const hemi = new THREE.HemisphereLight('#bcd3dc', '#8a7358', 1.1), sun = new THREE.DirectionalLight('#ffd9a8', 2.6);
 scene.add(hemi, sun, sun.target);
 const rig = new THREE.Group(), holder = new THREE.Group(); rig.add(holder); scene.add(rig);
 const built = new Map<string, THREE.Object3D>();
 // `want` is the selected model; `current` is the one drawn (it stays while lowering out of view).
 let current: string | null = null, want: string | null = null, show = 0;
 const base = new THREE.Vector3(.36, -.36, -.62);
 function mount(id: string | null) {
  current = id; show = 0; holder.clear(); holder.scale.setScalar(.72);
  if (id) { let m = built.get(id); if (!m) { m = HAND_MODELS[id](); built.set(id, m); } holder.add(m); }
 }
 /** Selects the model for the active hotbar item, or the glove while gathering by hand (null lowers it away). */
 function setItem(id: string | null) {
  want = id && HAND_MODELS[id] ? id : null;
  if (want && want !== current) mount(want);
 }
 /** `pose`: −1 on the struck face … 0 rest … 1 raised (strikes.ts); the glove reaches and closes instead of chopping. */
 function update(dt: number, camera: THREE.Camera, light: { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight }, pose: number, bobX: number, bobY: number) {
  rig.position.copy(camera.position); rig.quaternion.copy(camera.quaternion);
  show = want ? Math.min(1, show + dt * 4) : Math.max(0, show - dt * 5);
  if (!want && show <= 0) { mount(null); return; }
  const e = 1 - (1 - show) ** 3, hit = Math.max(0, -pose), raise = Math.max(0, pose), m = holder.children[0];
  if (current === 'hand') {
   // Fingers tipped up so the back of the hand faces the viewer; the reach pushes forward and down and closes the fist.
   holder.position.set(base.x + bobX * .6, base.y + .13 - (1 - e) * .35 + bobY * .5 - hit * .08 + raise * .03, base.z + .02 - hit * .17 + raise * .06);
   holder.rotation.set(.55 - hit * .75 + raise * .2, .38, .3 - hit * .1);
   (m?.userData.curl as ((v: number) => void) | undefined)?.(.15 + hit * .85 - raise * .15);
  } else {
   const s = hit - .55 * raise;
   holder.position.set(base.x + bobX * .6, base.y - (1 - e) * .35 + bobY * .5 - s * .05, base.z + s * .06);
   holder.rotation.set(-.35 - s * .9, .55, .25 + s * .2);
  }
  hemi.color.copy(light.hemi.color); hemi.groundColor.copy(light.hemi.groundColor); hemi.intensity = light.hemi.intensity;
  sun.color.copy(light.sun.color); sun.intensity = light.sun.intensity * .75;
  sun.position.copy(camera.position).add(light.sun.position).sub(light.sun.target.position); sun.target.position.copy(camera.position);
 }
 async function prewarm(renderer:THREE.WebGLRenderer,camera:THREE.Camera,light:{sun:THREE.DirectionalLight;hemi:THREE.HemisphereLight}){
  const previous=want;for(const id of Object.keys(HAND_MODELS))if(!built.has(id))built.set(id,HAND_MODELS[id]());
  holder.clear();for(const model of built.values())holder.add(model);want='prewarm';update(1,camera,light,0,0,0);await renderer.compileAsync(scene,camera);renderer.render(scene,camera);holder.clear();current=want=null;setItem(previous);
 }
 return { scene, setItem, update, prewarm, get visible() { return current !== null; }, get item() { return want; } };
}
