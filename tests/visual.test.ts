import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {assignLights,createLightPool,LIGHT_PRIORITY} from '../src/lights';
import {windAt,Wind,WIND_WANDER,WIND_WRAP} from '../src/wind';
import {printAllowed,PrintRing,printCorners,PRINT_W,PRINT_L,FOOTPRINTS} from '../src/footprints';
import {ParticleSim,SHAPE,FX_CAPS} from '../src/fx';
import {MOTES,DRIFT,SandDrift} from '../src/dust';
import {Terrain,groundSlope,groundCavity} from '../src/terrain';
import {heightAt} from '../src/world';

test('Light pool picks the nearest active emitters within reach, priority breaking ties',()=>{
 const src=(x:number,intensity:number,priority:number,distance=6)=>({x,y:0,z:0,intensity,distance,priority});
 const list=[src(30,3,LIGHT_PRIORITY.interior),src(10,0,LIGHT_PRIORITY.kiln),src(12,2,LIGHT_PRIORITY.door),src(12,2,LIGHT_PRIORITY.kiln),src(200,9,LIGHT_PRIORITY.room),src(4,1,LIGHT_PRIORITY.room)];
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
 assert.equal(pool.count,2);
 // Removing an emitter changes neither the number of scene lights nor the shader program key.
 station.remove(a);pool.update(camera,.1,[station]);assert.equal(lightCount(),2);
 pool.resize(4);pool.update(camera,0,[station]);assert.equal(lightCount(),4);
});

test('Shared wind is deterministic, bounded, frozen at dt 0 and under reduced motion',()=>{
 for(let t=0;t<3000;t+=7.3){const a=windAt(t),b=windAt(t);assert.deepEqual(a,b);assert.ok(Math.abs(a.angle)<=WIND_WANDER+1e-9);assert.ok(a.gust>=.1-1e-9&&a.gust<=1+1e-9);assert.ok(a.dirX>.96);}
 const w=new Wind(()=>false),still=new Wind(()=>true);
 w.update(0);assert.equal(w.time,0);w.update(1.5);w.update(.25);assert.equal(w.time,1.75);assert.deepEqual([w.gust,w.angle],[windAt(1.75).gust,windAt(1.75).angle]);
 const frozen={...w};w.update(0);w.update(-1);w.update(NaN);assert.deepEqual({...w},frozen);
 still.update(5);assert.equal(still.time,0);assert.equal(still.driftX,0);
 for(let i=0;i<4000;i++)w.update(.5);assert.ok(Math.abs(w.driftX)<WIND_WRAP&&w.driftX>0);
 // Mote boxes divide the drift wrap, so wrapping never makes motes jump.
 for(const q of Object.values(MOTES))assert.equal(WIND_WRAP%q.box,0);
 assert.ok(MOTES.low.count+DRIFT.low+FX_CAPS.low.solid+FX_CAPS.low.soft+FX_CAPS.low.glow<=512,'Low particle budget');
});

test('Sand drift: ribbons only in gusts, upwind and near the player, on the ground, bounded, frozen at dt 0 and gone under reduced motion',()=>{
 const ground=(x:number,z:number)=>.05*x-.02*z,calm={gust:.5,vx:1.2,vz:0,dirX:1,dirZ:0,speed:1.2},gust={gust:.95,vx:2.1,vz:.4,dirX:.982,dirZ:.188,speed:2.14};
 const d=new SandDrift(7);d.setQuality('low');for(let i=0;i<200;i++)d.update(.05,calm,100,100,ground);assert.equal(d.sheets.length,0,'no ribbons in a calm');
 for(let i=0;i<400;i++){d.update(.05,gust,100,100,ground);assert.ok(d.sheets.length<=DRIFT.low);}
 assert.ok(d.sheets.length>0&&d.born>=d.sheets.length,'a strong gust raises ribbons (and counts them as born)');
 for(const s of d.sheets){assert.ok(Math.hypot(s.x-100,s.z-100)<30);assert.ok(Math.abs(s.y0-ground(s.x-gust.dirX*s.len/2,s.z-gust.dirZ*s.len/2))<1e-9&&Math.abs(s.y1-ground(s.x+gust.dirX*s.len/2,s.z+gust.dirZ*s.len/2))<1e-9,'both ends rest on the ground');assert.ok(s.height<=.65&&s.len<=7);assert.ok(SandDrift.strength(s,gust.gust)>=0&&SandDrift.strength(s,gust.gust)<=1);assert.equal(SandDrift.strength(s,.4),0,'no visible ribbon below a gust of 0.45');}
 // A fresh ribbon crosses the view: at mid-life it is 4…14 m in front of the player (looking −z here), then it moves downwind.
 const born=new SandDrift(3);for(let i=0;i<40&&!born.sheets.length;i++)born.update(.05,gust,0,0,ground,undefined,false,0,-1);const s0={...born.sheets[0]},mid=[s0.x+gust.vx*s0.speed*s0.life/2,s0.z+gust.vz*s0.speed*s0.life/2];assert.ok(-mid[1]>=3.9&&-mid[1]<=14.6&&Math.abs(mid[0])<=7.1,'crosses the view ahead: '+mid);born.update(.1,gust,0,0,ground,undefined,false,0,-1);assert.ok(born.sheets[0].x>s0.x);
 const frozen=structuredClone(d.sheets);d.update(0,gust,100,100,ground);assert.deepEqual(d.sheets,frozen);
 d.setQuality('high');assert.equal(d.cap,DRIFT.high);d.update(.05,gust,100,100,ground,undefined,true);assert.equal(d.sheets.length,0,'reduced motion: no drift');
 // Over a long run of wind (all gust levels) the population never exceeds the cap and every ribbon ends.
 const w=new SandDrift(11);w.setQuality('standard');let max=0;for(let t=0;t<600;t+=.05){const k=windAt(t);w.update(.05,{...k,vx:k.dirX*k.speed,vz:k.dirZ*k.speed},0,0,ground);max=Math.max(max,w.sheets.length);for(const s of w.sheets)assert.ok(s.age<s.life);}
 assert.ok(max>0&&max<=DRIFT.standard);
});

test('Footprints skip the capsule, floors, crates and steep rock; the ring overwrites the oldest print',()=>{
 const flat=()=>1,steep=(x:number)=>x*.6;
 assert.equal(printAllowed(3,1,3,flat,false),true);
 assert.equal(printAllowed(3,1,3,flat,true),false,'inside the capsule');
 assert.equal(printAllowed(3,1.2,3,flat,false),false,'standing on a crate or floor');
 assert.equal(printAllowed(3,1.8,3,steep,false),false,'steep rock');
 const r=new PrintRing(3);assert.deepEqual([r.write(),r.write(),r.write(),r.write(),r.write()],[0,1,2,0,1]);assert.equal(r.count,3);r.clear();assert.equal(r.count,0);assert.equal(r.write(),0);r.resize(5);assert.equal(r.count,0);
 assert.deepEqual(Object.values(FOOTPRINTS).map(q=>[q.count,q.life]),[[48,30],[96,60],[160,90]]);
 // Corners: heel-left, heel-right, toe-right, toe-left; the toe edge lies ahead along the yaw.
 const yaw=.7,c=printCorners(10,20,yaw),toe=[(c[2][0]+c[3][0])/2,(c[2][1]+c[3][1])/2],heel=[(c[0][0]+c[1][0])/2,(c[0][1]+c[1][1])/2];
 assert.ok(Math.abs(Math.hypot(c[0][0]-c[1][0],c[0][1]-c[1][1])-PRINT_W)<1e-9);assert.ok(Math.abs(Math.hypot(toe[0]-heel[0],toe[1]-heel[1])-PRINT_L)<1e-9);
 assert.ok(Math.abs(Math.atan2(toe[0]-heel[0],toe[1]-heel[1])-yaw)<1e-9);
});

test('Chips bounce on the ground, come to rest, stay opaque, then fade and are hidden when dead',()=>{
 let seed=7;const rng=()=>(seed=(seed*16807)%2147483647)/2147483647,ground=(x:number)=>.5+x*.05;
 const p=new ParticleSim(8,rng);p.emit({x:0,y:2,z:0,color:['#b9ad9c','#a89c8c'],count:1,up:3,spread:2,size:.1,life:2,gravity:9.5,drag:.5,bounce:.3,hold:.75,shape:SHAPE.shard,spin:9,normal:{x:1,y:0,z:0},push:.5});
 assert.ok(p.vel[0]>=0,'a chip leaves the struck face');
 let bounced=false,rested=-1,minGap=Infinity;
 for(let f=0;f<120;f++){const vy=p.vel[1];p.step(1/60,ground);const gap=p.pos[1]-(ground(p.pos[0])+p.s0[0]*.3);minGap=Math.min(minGap,gap);if(vy<0&&p.vel[1]>0)bounced=true;if(p.rest[0]&&rested<0)rested=f;
  if(p.age[0]/p.life[0]<.75)assert.equal(p.alpha[0],1);}
 assert.ok(bounced,'bounced at least once');assert.ok(rested>0,'came to rest');assert.ok(minGap>-1e-5,'never below the ground');
 const at=[p.pos[0],p.pos[1],p.pos[2]];p.step(1/60,ground);assert.deepEqual([p.pos[0],p.pos[1],p.pos[2]],at,'a resting chip does not move');
 // Sub-stepping: one long dialog frame cannot push a chip through the terrain.
 const q=new ParticleSim(2,rng);q.emit({x:0,y:1,z:0,color:'#fff',vy:-20,bounce:.3,life:2,size:.1});q.step(.25,()=>0);assert.ok(q.pos[1]>=0);
 for(let i=0;i<10;i++)p.step(.25,ground);assert.equal(p.size[0],0);assert.equal(p.alpha[0],0);assert.equal(p.alive,0);
 // A frozen step (pause) changes nothing.
 const z=new ParticleSim(2,rng);z.emit({x:0,y:1,z:0,color:'#fff',up:2,life:2});z.step(.1);const snap=[...z.pos,...z.vel,z.alpha[0],z.size[0]];z.step(0,()=>0);assert.deepEqual([...z.pos,...z.vel,z.alpha[0],z.size[0]],snap);
 // Low quality: the ring shrinks and nothing lives beyond it.
 const r=new ParticleSim(10,rng);r.setCap(4);r.emit({x:0,y:0,z:0,color:'#fff',count:9,life:5});r.step(.1);assert.equal(r.alive,4);assert.ok(r.last<4);
});

test('Ground colour inputs (2 m slope, cavity, surface weights) match in both terrain levels, so a block swap does not pop',()=>{
 // A colour that encodes every input: any level-dependent slope or cavity would change it.
 const t=new Terrain(new THREE.MeshBasicMaterial(),(x,_z,h,s,c,cav=0,surf)=>{if(surf)surf[0]=(x*.37)%1;return c.setRGB(s,cav*.5+.5,h*.01);});
 // The block 120…200 × 40…120 holds the valley's eastern slopes (2 m slope up to ≈ 0.4).
 const p=new THREE.Vector3(160,2,80);for(let i=0;i<8&&!t.fineBlocks;i++)t.update(p,1000);assert.equal(t.fineBlocks,1);
 const at=new Map<string,number[]>(),meshes=t.group.children as THREE.Mesh[];
 for(const m of meshes.filter(m=>m.visible&&m.geometry.attributes.position.count>1000)){const g=m.geometry.attributes,n=g.position.count;for(let i=0;i<n;i++)at.set(g.position.getX(i)+','+g.position.getZ(i),[g.color.getX(i),g.color.getY(i),g.color.getZ(i),g.surface.getX(i),g.surface.getY(i)]);}
 const coarse=meshes.find(m=>!m.visible&&m.geometry.boundingBox!.min.x===120&&m.geometry.boundingBox!.min.z===40&&m.geometry.attributes.position.count<1000)!;assert.ok(coarse);
 const g=coarse.geometry.attributes;let compared=0,steep=0;
 for(let i=0;i<21*21;i++){const f=at.get(g.position.getX(i)+','+g.position.getZ(i));assert.ok(f);const c=[g.color.getX(i),g.color.getY(i),g.color.getZ(i),g.surface.getX(i),g.surface.getY(i)];
  for(let k=0;k<5;k++)assert.ok(Math.abs(c[k]-f[k])<1e-6,`vertex ${i} channel ${k}: ${c[k]} vs ${f[k]}`);compared++;if(c[0]>.1)steep++;}
 assert.equal(compared,441);assert.ok(steep>5,'the block must contain sloped ground for the check to mean anything');
 // The 2 m middle level (diagonal neighbours) gets the very same inputs at its vertices.
 for(let i=0;i<60&&!t.midBlocks;i++)t.update(p,1000);assert.ok(t.midBlocks>0);
 const mids=(t.group.children as THREE.Mesh[]).filter(m=>m.visible&&m.geometry.attributes.position.count===4*(21*21+21*4)&&m.geometry.boundingBox!.max.x-m.geometry.boundingBox!.min.x===80);assert.equal(mids.length,1,'a finished middle block is one merged mesh');
 for(const m of mids){const a=m.geometry.attributes;
  for(let i=0;i<a.position.count;i+=5){const x=a.position.getX(i),z=a.position.getZ(i);assert.ok(Math.abs(a.color.getX(i)-groundSlope(heightAt,x,z))<1e-6);assert.ok(Math.abs(a.color.getY(i)-(groundCavity(heightAt,x,z)*.5+.5))<1e-6);}}
 // The stencils themselves: a plane has no cavity; a bowl is a hollow (> 0), a dome a crest (< 0).
 const plane=(x:number,z:number)=>x*.3+z*.1,bowl=(x:number,z:number)=>(x*x+z*z)*.02;
 assert.ok(Math.abs(groundSlope(plane,5,5)-(1-1/Math.hypot(.3,1,.1)))<1e-12);assert.equal(groundCavity(plane,5,5),0);
 assert.ok(groundCavity(bowl,0,0)>0);assert.ok(groundCavity((x,z)=>-bowl(x,z),0,0)<0);
});

test('Sun shadows fade out at the shadow frustum edge (the patched shader chunk is in place)',async()=>{
 await import('../src/scene');const chunk=THREE.ShaderChunk.shadowmap_pars_fragment;
 assert.ok(chunk.includes('float edgeFade=smoothstep(0.,.1,'),'three.js changed the shadow chunk: re-check the edge-fade patch in scene.ts');
 assert.ok(chunk.includes('shadowIntensity*edgeFade'));
});
