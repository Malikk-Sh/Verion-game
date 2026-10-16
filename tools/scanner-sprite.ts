// Dev-only: renders the scanner inventory sprite from its in-game hand model (tools/render_scanner_sprite.mjs).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HAND_MODELS } from '../src/viewmodel';
/** One 512×512 transparent WebP data URL of the scanner, three-quarter view, light from the upper left (the sprite style). */
export async function render(size = 512): Promise<string> {
 const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
 const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
 renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
 const scene = new THREE.Scene(), pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
 scene.add(new THREE.HemisphereLight('#f4fbff', '#5a4a3c', 1.1)); const sun = new THREE.DirectionalLight('#fff4e6', 2.6); sun.position.set(-3, 5, 4); scene.add(sun);
 // The very model held in the hand, tilted a little so the screen and the lens both read.
 const model = HAND_MODELS.scanner(); model.rotation.set(-.12, -.35, .18); scene.add(model);
 const camera = new THREE.PerspectiveCamera(24, 1, .05, 20), dir = new THREE.Vector3(.75, .55, 1.4).normalize();
 camera.position.copy(dir.multiplyScalar(1.3)).add(new THREE.Vector3(0, -.02, 0)); camera.lookAt(0, -.02, 0);
 renderer.render(scene, camera); const url = canvas.toDataURL('image/webp', .9);
 renderer.dispose(); pmrem.dispose(); return url;
}
