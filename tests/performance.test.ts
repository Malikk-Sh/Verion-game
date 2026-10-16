import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Diagnostics,Ring} from '../src/diagnostics';
import {Terrain,createShadeBaker,FINE_R} from '../src/terrain';
import {heightAt} from '../src/world';
import {StaticBatch} from '../src/geometry';
import {sceneInterval} from '../src/renderPolicy';
/** Vertices of one 40 m chunk with its skirts (fine 1 m, middle 2 m); a merged block holds four in a row. */
const FINE_V=41*41+41*4,MID_V=21*21+21*4;
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
 t.update(p,1000);assert.equal(t.fineBlocks,1);const fine=t.group.children.filter(m=>m.visible&&(m as THREE.Mesh).geometry.attributes.position.count>1000) as THREE.Mesh[];assert.equal(fine.length,1,'a finished block is one merged mesh (one draw call)');
 for(const m of fine){const pos=m.geometry.attributes.position;for(let part=0;part<4;part++)for(let i=part*FINE_V;i<part*FINE_V+41*41;i+=37)assert.ok(Math.abs(pos.getY(i)-heightAt(pos.getX(i),pos.getZ(i)))<.00002);}
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

test('Middle terrain level: 2 m chunks beyond 55 m lie on the collision grid and give way to fine chunks up close',()=>{
 const t=new Terrain(new THREE.MeshBasicMaterial(),(_x,_z,_h,_s,c)=>c.setRGB(.3,.2,.1));t.setQuality('standard');assert.equal(FINE_R,55);
 // Centre of the block 40…120: four edge neighbours are 40 m away (fine), the four diagonal ones 56.6 m (middle).
 const p=new THREE.Vector3(80,2,80);for(let i=0;i<60;i++)t.update(p,1000);assert.equal(t.fineBlocks,5);assert.equal(t.midBlocks,4);
 // A middle chunk: 40 m wide with 21 × 21 vertices (a coarse block has as many over 80 m).
 const isMid=(m:THREE.Object3D)=>{const g=(m as THREE.Mesh).geometry;return g.attributes.position.count===4*MID_V&&g.boundingBox!.max.x-g.boundingBox!.min.x===80;};
 const visible=t.group.children.filter(m=>m.visible) as THREE.Mesh[],mid=visible.filter(isMid);assert.equal(mid.length,4);
 for(const m of mid){const pos=m.geometry.attributes.position;for(let part=0;part<4;part++)for(let i=part*MID_V;i<part*MID_V+21*21;i+=7){assert.ok(pos.getX(i)%2===0);assert.ok(Math.abs(pos.getY(i)-heightAt(pos.getX(i),pos.getZ(i)))<.00002);}}
 // Walking into a diagonal block: its middle level stays until the fine one is complete, then hides.
 const q=new THREE.Vector3(150,2,150);t.update(q,0);assert.ok(t.group.children.filter(m=>m.visible&&isMid(m)).length>=1);
 for(let i=0;i<80;i++)t.update(q,1000);const near=t.group.children.filter(m=>m.visible&&(m as THREE.Mesh).geometry.boundingBox!.min.x>=120&&(m as THREE.Mesh).geometry.boundingBox!.max.x<=200&&(m as THREE.Mesh).geometry.boundingBox!.min.z>=120&&(m as THREE.Mesh).geometry.boundingBox!.max.z<=200) as THREE.Mesh[];
 assert.equal(near.length,1);assert.ok(near.every(m=>m.geometry.attributes.position.count===4*FINE_V));
 // Its middle level stays cached (hidden): at shared even grid points both levels have the same normal and colour, so the swap does not flash.
 const fineAt=new Map<string,number[]>();for(const m of near){const a=m.geometry.attributes;for(let part=0;part<4;part++)for(let i=part*FINE_V;i<part*FINE_V+41*41;i++)fineAt.set(a.position.getX(i)+','+a.position.getZ(i),[a.normal.getX(i),a.normal.getY(i),a.normal.getZ(i)]);}
 const hidden=t.group.children.filter(m=>!m.visible&&isMid(m)&&(m as THREE.Mesh).geometry.boundingBox!.min.x>=120&&(m as THREE.Mesh).geometry.boundingBox!.max.x<=200&&(m as THREE.Mesh).geometry.boundingBox!.min.z>=120&&(m as THREE.Mesh).geometry.boundingBox!.max.z<=200) as THREE.Mesh[];
 assert.equal(hidden.length,1);let shared=0;
 for(const m of hidden){const a=m.geometry.attributes;for(let part=0;part<4;part++)for(let i=part*MID_V;i<part*MID_V+21*21;i++){const f=fineAt.get(a.position.getX(i)+','+a.position.getZ(i))!;assert.ok(f);for(let k=0;k<3;k++)assert.ok(Math.abs(a.normal.getComponent(i,k)-f[k])<1e-6);shared++;}}
 assert.equal(shared,4*441);
});
test('High keeps 1 m terrain to 80 m; Low ends the middle level at 70 m',()=>{
 const count=(q:'low'|'high')=>{const t=new Terrain(new THREE.MeshBasicMaterial(),(_x,_z,_h,_s,c)=>c.setRGB(.3,.2,.1));t.setQuality(q);const p=new THREE.Vector3(80,2,80);for(let i=0;i<120;i++)t.update(p,1000);return [t.fineBlocks,t.midBlocks];};
 // From the centre of a block, the diagonal neighbours lie 56.6 m away: fine on High, middle on Low; the next ring
 // (12 blocks at 120–127 m) is middle on High and coarse on Low.
 assert.deepEqual(count('high'),[9,12]);assert.deepEqual(count('low'),[5,4]);
});
