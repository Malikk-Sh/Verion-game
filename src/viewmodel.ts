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
export const HAND_MODELS: Record<string, Builder> = { tool_stone: stoneMultitool, wrench };

export function createViewModel() {
 const scene = new THREE.Scene();
 const hemi = new THREE.HemisphereLight('#bcd3dc', '#8a7358', 1.1), sun = new THREE.DirectionalLight('#ffd9a8', 2.6);
 scene.add(hemi, sun, sun.target);
 const rig = new THREE.Group(), holder = new THREE.Group(); rig.add(holder); scene.add(rig);
 const built = new Map<string, THREE.Object3D>();
 let current: string | null = null, show = 0, swing = 0, swingSpeed = 0;
 const base = new THREE.Vector3(.36, -.36, -.62);
 /** Selects the model for the active hotbar item (null hides the hand). */
 function setItem(id: string | null) {
  const want = id && HAND_MODELS[id] ? id : null;
  if (want === current) return;
  current = want; show = 0; holder.clear(); holder.scale.setScalar(.72);
  if (want) { let m = built.get(want); if (!m) { m = HAND_MODELS[want](); built.set(want, m); } holder.add(m); }
 }
 /** `mining` 0…1 is the progress of the current block; strikes swing the tool. */
 function update(dt: number, camera: THREE.Camera, light: { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight }, mining: boolean, bobX: number, bobY: number) {
  rig.position.copy(camera.position); rig.quaternion.copy(camera.quaternion);
  show = Math.min(1, show + dt * 4);
  swingSpeed = mining ? 9 : 0; swing = mining ? swing + dt * swingSpeed : Math.max(0, swing - dt * 3) % (Math.PI * 2);
  const s = mining ? Math.max(0, Math.sin(swing)) : 0, e = 1 - (1 - show) ** 3;
  holder.position.set(base.x + bobX * .6, base.y - (1 - e) * .35 + bobY * .5 - s * .05, base.z + s * .06);
  holder.rotation.set(-.35 - s * .9, .55, .25 + s * .2);
  hemi.color.copy(light.hemi.color); hemi.groundColor.copy(light.hemi.groundColor); hemi.intensity = light.hemi.intensity;
  sun.color.copy(light.sun.color); sun.intensity = light.sun.intensity * .75;
  sun.position.copy(camera.position).add(light.sun.position).sub(light.sun.target.position); sun.target.position.copy(camera.position);
 }
 return { scene, setItem, update, get visible() { return current !== null; } };
}
