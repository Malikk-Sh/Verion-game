// Isolated dev-only art review page. Not imported by the game or included in dist.
import * as THREE from 'three';
import {createWorld} from '../src/scene';
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.03;document.body.append(renderer.domElement);
const scene=new THREE.Scene(),world=createWorld(scene),camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.07,290);
const views:Record<string,{eye:number[];target:number[];label:string}>={
 capsule:{eye:[49,4.1,53],target:[40,2.5,40],label:'КАПСУЛА / B2'},
 interior:{eye:[40,2.1,42],target:[39.8,1.9,37.2],label:'ИНТЕРЬЕР / B2'},
 cave:{eye:[98,3.6,69],target:[119,2.8,72],label:'СКАЛЬНЫЙ ВХОД / B2'},
 grass:{eye:[40,1.6,62],target:[44,.4,56],label:'РЕДКАЯ РАСТИТЕЛЬНОСТЬ / B2'},
 valley:{eye:[53,3.4,64],target:[100,4,103],label:'ДОЛИНА ПРИБЫТИЯ / B2'},
};
const params=new URLSearchParams(location.search),view=views[params.get('view')??'capsule']??views.capsule;
camera.position.fromArray(view.eye);camera.lookAt(new THREE.Vector3().fromArray(view.target));world.followSky(camera.position);world.setNight(params.has('night'));
document.getElementById('label')!.textContent=view.label;
renderer.render(scene,camera);document.body.dataset.ready='true';
