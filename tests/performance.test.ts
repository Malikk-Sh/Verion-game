import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Diagnostics,Ring} from '../src/diagnostics';
import {Terrain,createShadeBaker} from '../src/terrain';
import {heightAt} from '../src/world';
import {StaticBatch} from '../src/geometry';
import {sceneInterval} from '../src/renderPolicy';
const context={quality:'low',dialog:'',running:true,visible:true,calls:40,triangles:90000,geometries:60,textures:12,fineBlocks:3,buildings:0,links:0,activeTicks:100};

test('A long device session retains bounded, chronological diagnostic data without a world snapshot',()=>{
 let now=0;const d=new Diagnostics(()=>now);d.frame(500,0,context);assert.equal(d.report().summary.frames,0);d.startRecording();
 for(let i=0;i<10000;i++){const start=now;now+=110;d.stage('simulation',start);d.frame(110,start,context);d.event('craft',2,{recipe:'craft_workbench'});}
 const r=d.report();assert.equal(r.summary.frames,10000);assert.equal(r.samples.length,600);assert.equal(r.spikes.length,240);assert.equal(r.events.length,240);assert.equal(r.stages.simulation.maxMs,110);assert.ok(r.samples[0].at<r.samples.at(-1)!.at);assert.ok(!JSON.stringify(r).includes('inventory'));assert.ok(JSON.stringify(r).length<400000);
 d.stop();const stopped=d.report();now+=500;d.frame(500,now,context);d.event('after-stop');assert.deepEqual(d.report().summary,stopped.summary);d.clear();assert.equal(d.report().events.length,0);assert.equal(d.report().summary.frames,0);
});
test('Ring wraps more than once without reversing the recent history',()=>{const r=new Ring<number>(3);for(let i=0;i<11;i++)r.push(i);assert.deepEqual(r.values(),[8,9,10]);r.clear();r.push(12);assert.deepEqual(r.values(),[12]);});
test('Cooperative shade baking can resume in the middle of a row and produces the same completed texture',()=>{
 const a=createShadeBaker(),b=createShadeBaker(),dir=new THREE.Vector3(.6,.42,.4).normalize();a.begin(dir);a.step(a.N);const expected=a.flip().image.data;
 b.begin(dir);const original=performance.now;let time=0;Object.defineProperty(performance,'now',{configurable:true,value:()=>time+=.1});
 try{assert.equal(b.step(b.N,1),false);assert.equal(b.busy,true);let calls=1;while(b.busy&&calls++<10000)b.step(b.N,1);assert.equal(b.busy,false);assert.ok(calls>10);assert.deepEqual(b.flip().image.data,expected);}finally{Object.defineProperty(performance,'now',{configurable:true,value:original});}
});
test('Terrain swaps only after a complete block and keeps the exact collision surface',()=>{
 const t=new Terrain(new THREE.MeshBasicMaterial(),(_x,_z,_h,_s,c)=>c.setRGB(.3,.2,.1)),p=new THREE.Vector3(40,2,40);
 const baseCount=t.group.children.length;t.update(p,0);assert.equal(t.fineBlocks,0);
 for(let i=0;i<3;i++){t.update(p,1000);assert.equal(t.fineBlocks,0);assert.equal(t.group.children.filter(m=>m.visible).length,baseCount);}
 t.update(p,1000);assert.equal(t.fineBlocks,1);const fine=t.group.children.filter(m=>m.visible&&(m as THREE.Mesh).geometry.attributes.position.count>1000) as THREE.Mesh[];assert.equal(fine.length,4);
 for(const m of fine){const pos=m.geometry.attributes.position;for(let i=0;i<41*41;i+=37)assert.ok(Math.abs(pos.getY(i)-heightAt(pos.getX(i),pos.getZ(i)))<.00002);}
 // Abandoning a partly built block cannot replace or hide its original ground.
 t.update(p,1000);t.update(new THREE.Vector3(270,2,270),0);assert.equal(t.fineBlocks,1);assert.equal(t.group.children.filter(m=>m.visible).length,baseCount);
});
test('Live UI reduces only scene presentation, explicit pause is separate, active high quality stays uncapped',()=>{
 assert.equal(sceneInterval(true,true,'production-panel','low'),100);assert.equal(sceneInterval(true,false,'paused','high'),250);assert.equal(sceneInterval(true,true,'','high'),0);assert.equal(sceneInterval(true,true,'','low'),1000/30);
});

test('Exploring then standing still cannot grow the fine terrain cache beyond the low limit',()=>{
 const t=new Terrain(new THREE.MeshBasicMaterial(),(_x,_z,_h,_s,c)=>c.setRGB(.3,.2,.1));t.setQuality('low');
 for(const [x,z] of [[-150,-150],[20,-150],[290,-150],[290,20],[290,290],[20,290],[-150,290],[-150,20],[40,40]])for(let i=0;i<70;i++){t.update(new THREE.Vector3(x,3,z),1000);assert.ok(t.fineBlocks<=20);}
});

test('Spatial scenery batches exclude distant rocks without moving or dropping any model triangles',()=>{
 const material=new THREE.MeshStandardMaterial();material.name='rock';const source=new THREE.BoxGeometry(1,1,1),batch=new StaticBatch(40,m=>m.name==='rock');
 batch.add(source,material,5,1,5);batch.add(source,material,105,1,5);const scene=new THREE.Scene(),meshes=batch.finish(scene);assert.equal(meshes.length,2);
 assert.equal(meshes.reduce((n,m)=>n+m.geometry.attributes.position.count,0),72);const xs=meshes.map(m=>m.geometry.boundingSphere!.center.x).sort((a,b)=>a-b);assert.deepEqual(xs,[5,105]);
 const camera=new THREE.PerspectiveCamera(60,1,.15,25);camera.position.set(5,2,12);camera.lookAt(5,1,5);camera.updateMatrixWorld();scene.updateMatrixWorld();
 const f=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));assert.equal(meshes.filter(m=>f.intersectsObject(m)).length,1);
});
