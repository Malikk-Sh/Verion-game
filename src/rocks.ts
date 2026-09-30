import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { noise3 } from './noise';
import { random } from './world';

export type RockStyle = { cuts?: number; detail?: number; lumpy?: number; flatTop?: number; dust?: string; base?: string; dark?: string; strata?: number; taper?: number };
/**
 * Chiselled boulder: a noisy sphere sliced by random planes. Planar cuts give the broad
 * matte facets of the Verdana art direction; vertex colours carry dust on top faces,
 * darker undersides and faint strata, so every rock can share one material.
 * Result is non-indexed, sits on y=0, spans roughly x,z∈[-1,1], y∈[0,1].
 */
export function chiseledRock(seed:number,style:RockStyle={}){
 const rng=random(seed*7919+13);
 let g:THREE.BufferGeometry=new THREE.IcosahedronGeometry(1,style.detail??2);
 g.deleteAttribute('normal');g.deleteAttribute('uv');g=mergeVertices(g);
 const pos=g.attributes.position as THREE.BufferAttribute,v=new THREE.Vector3();
 const planes:{n:THREE.Vector3;d:number}[]=[];
 for(let i=0;i<(style.cuts??8);i++){
  const n=new THREE.Vector3(rng()*2-1,(rng()*2-1)*.8,rng()*2-1).normalize();
  planes.push({n,d:.52+rng()*.34});
 }
 planes.push({n:new THREE.Vector3(0,1,0),d:style.flatTop??(.62+rng()*.3)});
 for(let i=0;i<pos.count;i++){
  v.fromBufferAttribute(pos,i);
  v.multiplyScalar(1+noise3(v.x*1.6+seed,v.y*1.6,v.z*1.6,seed)*(style.lumpy??.22));
  for(const p of planes){const d=v.dot(p.n);if(d>p.d)v.addScaledVector(p.n,p.d-d);}
  if(v.y<-.25)v.y=-.25;
  pos.setXYZ(i,v.x,v.y,v.z);
 }
 g.computeBoundingBox();const b=g.boundingBox!;
 const sx=2/Math.max(b.max.x-b.min.x,1e-3),sy=1/Math.max(b.max.y-b.min.y,1e-3),sz=2/Math.max(b.max.z-b.min.z,1e-3);
 g.translate(-(b.max.x+b.min.x)/2,-b.min.y,-(b.max.z+b.min.z)/2);g.scale(sx,sy,sz);
 if(style.taper){const q=g.attributes.position as THREE.BufferAttribute;for(let i=0;i<q.count;i++){const k=1-style.taper*q.getY(i);q.setX(i,q.getX(i)*k);q.setZ(i,q.getZ(i)*k);}}
 g=g.toNonIndexed();g.computeVertexNormals();
 const p2=g.attributes.position,n2=g.attributes.normal,colors=new Float32Array(p2.count*3);
 const base=new THREE.Color(style.base??'#3b4042'),dust=new THREE.Color(style.dust??'#9a8266'),dark=new THREE.Color(style.dark??'#23282a'),c=new THREE.Color();
 for(let f=0;f<p2.count;f+=3){
  const ny=n2.getY(f),faceShade=.9+rng()*.2;
  for(let k=0;k<3;k++){
   const i=f+k,y=p2.getY(i);
   c.copy(base).multiplyScalar(faceShade);
   if(style.strata)c.lerp(dark,Math.max(0,Math.sin(y*style.strata*6.28+seed))*.25);
   if(ny>.55)c.lerp(dust,Math.min(1,(ny-.55)*2.2)*.55);
   if(ny<-.2)c.lerp(dark,.55);
   c.multiplyScalar(.66+.34*Math.min(1,y*1.6));
   colors.set([c.r,c.g,c.b],i*3);
  }
 }
 g.setAttribute('color',new THREE.BufferAttribute(colors,3));
 return g;
}
