// Dev-only: renders the glass block and the airlock inventory sprites from their in-game models (tools/render_room_sprites.mjs).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { chunkFaces, glassMaterial, joinChunks } from '../src/glass';
import { buildDoor } from '../src/stationModels';
import { cellKey, cellY } from '../src/game/rooms';
/** One 512×512 transparent WebP data URL of `kind`, three-quarter view, light from the upper left (the sprite style). */
export async function render(kind: 'window' | 'airlock', size = 512): Promise<string> {
 const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
 const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
 renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
 const scene = new THREE.Scene(), pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
 scene.add(new THREE.HemisphereLight('#f4fbff', '#5a4a3c', 1.1)); const sun = new THREE.DirectionalLight('#fff4e6', 2.6); sun.position.set(-3, 5, 4); scene.add(sun);
 const root = new THREE.Group(); scene.add(root);
 if (kind === 'window') {
  // The very mesh the game draws for a lone block (D35): six clear faces and the edge trim of the glass material.
  const one = new Set([cellKey(0, 0, 0)]), f = chunkFaces(one, k => one.has(k), undefined, { solid: k => one.has(k), door: () => false });
  const mesh = new THREE.Mesh(joinChunks([f]), glassMaterial()); mesh.position.set(-.5, -cellY(0) - .5, -.5); root.add(mesh);
 } else {
  // S5 (D36): the 2-wide walk-through module, its outer door half open on the hazard threshold, lamps green, chamber charged.
  const d = buildDoor(2); d.update(0, { outer: .22, inner: 0, lamps: ['ready', 'locked'], pressure: 1, busy: false }, true); d.group.position.y = -1; d.group.rotation.y = .05; root.add(d.group);
 }
 const camera = new THREE.PerspectiveCamera(24, 1, .1, 50), dir = new THREE.Vector3(1.05, .78, 1.35).normalize();
 // Three-quarter view from the front right, framed so the model fills about 80% of the square.
 camera.position.copy(dir.multiplyScalar(kind === 'window' ? 4.6 : 7.4)); camera.lookAt(0, kind === 'window' ? 0 : -.05, 0);
 renderer.render(scene, camera); const url = canvas.toDataURL('image/webp', .9);
 renderer.dispose(); pmrem.dispose(); return url;
}
