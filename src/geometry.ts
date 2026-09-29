import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Static model pieces are merged by material; detail need not mean a draw call per bolt. */
export class StaticBatch {
 private groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
 add(geometry: THREE.BufferGeometry, material: THREE.Material, x=0,y=0,z=0,sx=1,sy=1,sz=1,rx=0,ry=0,rz=0) {
  const g=geometry.index?geometry.toNonIndexed():geometry.clone();
  for(const name of Object.keys(g.attributes))if(name!=='position'&&name!=='normal')g.deleteAttribute(name);
  const m=new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz)),new THREE.Vector3(sx,sy,sz));
  g.applyMatrix4(m); const list=this.groups.get(material)??[];list.push(g);this.groups.set(material,list);
 }
 finish(scene:THREE.Scene){
  for(const [material,geometries] of this.groups){
   const geometry=mergeGeometries(geometries);if(!geometry)throw new Error('Static geometry merge failed');
   geometry.computeBoundingSphere();scene.add(new THREE.Mesh(geometry,material));geometries.forEach(g=>g.dispose());
  }
  this.groups.clear();
 }
}
export function surface(vertices:number[],indices?:number[]){
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));if(indices)g.setIndex(indices);g.computeVertexNormals();return g;
}
export function quad(a:number[],b:number[],c:number[],d:number[]){return surface([...a,...b,...c,...a,...c,...d]);}
export function beam(a:THREE.Vector3,b:THREE.Vector3,width:number,depth=width){
 const g=new THREE.BoxGeometry(width,a.distanceTo(b),depth);
 const m=new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(.5),new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize()),new THREE.Vector3(1,1,1));return g.applyMatrix4(m);
}
/** Grounded, asymmetrical strata; the bottom plane is always y=0. */
export function stratifiedRock(seed:number){
 const n=9,vs:number[]=[],ix:number[]=[];
 const radii=[.72,1,.81,.36],levels=[0,.22,.69,1];
 for(let j=0;j<4;j++)for(let i=0;i<n;i++){
  const a=i/n*Math.PI*2;const irregular=1+Math.sin(i*7.3+seed)*.16+Math.cos(i*3.7+seed*2)*.09;
  vs.push(Math.cos(a)*radii[j]*irregular+(j*.06),levels[j]+(j===0?0:Math.sin(i*4.7+seed)*.055),Math.sin(a)*radii[j]*irregular);
 }
 for(let j=0;j<3;j++)for(let i=0;i<n;i++){const a=j*n+i,b=j*n+(i+1)%n,c=b+n,d=a+n;ix.push(a,d,b,b,d,c);}
 for(let i=1;i<n-1;i++)ix.push(3*n,3*n+i+1,3*n+i);
 return surface(vs,ix).toNonIndexed();
}
