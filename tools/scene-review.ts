// Isolated dev-only art review page. Not imported by the game or included in dist.
import * as THREE from 'three';
import {createWorld} from '../src/scene';
import type {Quality} from '../src/scene';
import {heightAt} from '../src/world';
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.append(renderer.domElement);
const scene=new THREE.Scene(),world=createWorld(scene),camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.07,1400);
const views:Record<string,{eye:number[];target:number[];label:string;rel?:boolean}>={
 capsule:{eye:[48,3.2,51],target:[40,2.3,40],label:'КАПСУЛА / B4'},
 interior:{eye:[40,2.1,42.3],target:[39.8,1.6,37.2],label:'ИНТЕРЬЕР / B4'},
 cave:{eye:[99,3.2,69],target:[119,3,72],label:'СКАЛЬНЫЙ ВХОД / B4'},
 grass:{eye:[40,1.5,62],target:[44,.3,56],label:'РАСТИТЕЛЬНОСТЬ / B4'},
 valley:{eye:[42,2.2,47],target:[100,6,103],label:'ДОЛИНА ПРИБЫТИЯ / B4'},
 ice:{eye:[36,2,72],target:[29,.2,81],label:'ЛЁД / B4'},
 ore:{eye:[74,2,61],target:[67,.8,65],label:'РУДА / B4'},
 door:{eye:[40,1.7,44.6],target:[45,1.2,58],label:'ВЫХОД / B4'},
 flank:{eye:[46.5,2.2,40.8],target:[40,2.2,40.3],label:'БОРТ КАПСУЛЫ / B4'},
 berth:{eye:[41.6,1.9,42.2],target:[37.8,1,39],label:'КОЙКА И СТЕЛЛАЖ / B4'},
 rack:{eye:[38.6,1.8,41.9],target:[42.1,1.1,39.6],label:'СНАРЯЖЕНИЕ / B4'},
 copper:{eye:[86.5,1.9,58.4],target:[83,.7,55],label:'МЕДЬ / B4'},
 vista:{eye:[-40,26,100],target:[-105,10,165],label:'СТОЛОВАЯ ГОРА / B4',rel:true},
 canyon:{eye:[95,2,-84],target:[125,0,-106],label:'СУХОЕ РУСЛО / B4',rel:true},
 crater:{eye:[236,6,226],target:[272,-6,262],label:'КРАТЕР / B4',rel:true},
};
const params=new URLSearchParams(location.search),view=views[params.get('view')??'capsule']??views.capsule;
if(view.rel){view.eye[1]+=heightAt(view.eye[0],view.eye[2]);view.target[1]+=heightAt(view.target[0],view.target[2]);}
camera.position.fromArray(view.eye);camera.lookAt(new THREE.Vector3().fromArray(view.target));world.setTime(params.has('night')?900:240,true);world.setQuality((params.get('q') as Quality)??'high');
document.getElementById('label')!.textContent=view.label;
world.terrain.update(camera.position,99);world.update(.016,camera,renderer);renderer.render(scene,camera);world.update(.016,camera,renderer);renderer.render(scene,camera);document.body.dataset.ready='true';
