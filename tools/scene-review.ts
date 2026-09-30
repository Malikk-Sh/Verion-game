// Isolated dev-only art review page. Not imported by the game or included in dist.
import * as THREE from 'three';
import {createWorld} from '../src/scene';
import type {Quality} from '../src/scene';
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.append(renderer.domElement);
const scene=new THREE.Scene(),world=createWorld(scene),camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.07,1400);
const views:Record<string,{eye:number[];target:number[];label:string}>={
 capsule:{eye:[48,3.2,51],target:[40,2.3,40],label:'КАПСУЛА / B3'},
 interior:{eye:[40,2.1,42.3],target:[39.8,1.6,37.2],label:'ИНТЕРЬЕР / B3'},
 cave:{eye:[99,3.2,69],target:[119,3,72],label:'СКАЛЬНЫЙ ВХОД / B3'},
 grass:{eye:[40,1.5,62],target:[44,.3,56],label:'РАСТИТЕЛЬНОСТЬ / B3'},
 valley:{eye:[42,2.2,47],target:[100,6,103],label:'ДОЛИНА ПРИБЫТИЯ / B3'},
 ice:{eye:[36,2,72],target:[29,.2,81],label:'ЛЁД / B3'},
 ore:{eye:[74,2,61],target:[67,.8,65],label:'РУДА / B3'},
 door:{eye:[40,1.7,44.6],target:[45,1.2,58],label:'ВЫХОД / B3'},
};
const params=new URLSearchParams(location.search),view=views[params.get('view')??'capsule']??views.capsule;
camera.position.fromArray(view.eye);camera.lookAt(new THREE.Vector3().fromArray(view.target));world.setNight(params.has('night'),true);world.setQuality((params.get('q') as Quality)??'high');
document.getElementById('label')!.textContent=view.label;
world.update(.016,camera,renderer);renderer.render(scene,camera);world.update(.016,camera,renderer);renderer.render(scene,camera);document.body.dataset.ready='true';
