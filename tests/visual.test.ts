import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {assignLights,createLightPool,LIGHT_PRIORITY} from '../src/lights';

test('Light pool picks the nearest active emitters within reach, priority breaking ties',()=>{
 const src=(x:number,intensity:number,priority:number,distance=6)=>({x,y:0,z:0,intensity,distance,priority});
 const list=[src(30,3,LIGHT_PRIORITY.interior),src(10,0,LIGHT_PRIORITY.kiln),src(12,2,LIGHT_PRIORITY.door),src(12,2,LIGHT_PRIORITY.kiln),src(200,9,LIGHT_PRIORITY.dome),src(4,1,LIGHT_PRIORITY.dome)];
 // Inactive (index 1) and far beyond reach (index 4) are never chosen; equal gaps prefer the kiln.
 assert.deepEqual(assignLights(list,0,0,0,4),[5,3,2,0]);
 assert.deepEqual(assignLights(list,0,0,0,2),[5,3]);
 assert.deepEqual(assignLights(list,0,0,0,0),[]);
});

test('The pool keeps a fixed light count, hides real emitters and does not reshuffle kept slots',()=>{
 const scene=new THREE.Scene(),pool=createLightPool(scene,2),camera=new THREE.PerspectiveCamera();
 const lightCount=()=>{let n=0;scene.traverseVisible(o=>{if((o as THREE.Light).isLight)n++;});return n;};
 const station=new THREE.Group();scene.add(station);
 const a=new THREE.PointLight('#ff8a3a',3,3.2,2);a.position.set(2,0,0);const b=new THREE.PointLight('#cdf7f0',2,6,1.6);b.position.set(-3,0,0);station.add(a,b);
 const door=new THREE.PointLight('#ffb870',9,13,1.7);door.position.set(0,0,9);scene.add(door);pool.add(door,LIGHT_PRIORITY.door);
 scene.updateMatrixWorld();pool.update(camera,0,[station]);
 assert.equal(lightCount(),2);assert.equal(a.visible,false);assert.equal(b.visible,false);assert.equal(door.visible,false);assert.equal(pool.emitters,3);assert.equal(pool.active,2);
 const before=(pool as unknown as {count:number}).count;assert.equal(before,2);
 // Removing an emitter changes neither the number of scene lights nor the shader program key.
 station.remove(a);pool.update(camera,.1,[station]);assert.equal(lightCount(),2);
 pool.resize(4);pool.update(camera,0,[station]);assert.equal(lightCount(),4);
});
