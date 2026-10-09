import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Static model pieces are merged by material; detail need not mean a draw call per bolt.
 * Every piece is normalised to position/normal/uv/color so different sources merge,
 * and an optional tint multiplies vertex colour (one rock material, many rock tones).
 */
export class StaticBatch {
 private groups = new Map<string, {material:THREE.Material;geometries:THREE.BufferGeometry[]}>();
 constructor(private cellSize=0,private spatial:(material:THREE.Material)=>boolean=()=>true){}
 add(geometry: THREE.BufferGeometry, material: THREE.Material, x=0,y=0,z=0,sx=1,sy=1,sz=1,rx=0,ry=0,rz=0,tint?:THREE.ColorRepresentation) {
  const g=geometry.index?geometry.toNonIndexed():geometry.clone();
  for(const name of Object.keys(g.attributes))if(!['position','normal','uv','color'].includes(name))g.deleteAttribute(name);
  const n=g.attributes.position.count;
  if(!g.attributes.normal)g.computeVertexNormals();
  if(!g.attributes.uv)g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(n*2),2));
  if(!g.attributes.color)g.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(n*3).fill(1),3));
  if(tint!==undefined){const c=new THREE.Color(tint),col=g.attributes.color as THREE.BufferAttribute;for(let i=0;i<n;i++)col.setXYZ(i,col.getX(i)*c.r,col.getY(i)*c.g,col.getZ(i)*c.b);}
  const m=new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz)),new THREE.Vector3(sx,sy,sz));
  g.applyMatrix4(m);let key=material.uuid;
  if(this.cellSize&&this.spatial(material)){if(!g.boundingBox)g.computeBoundingBox();const b=g.boundingBox!;key+=':'+Math.floor((b.min.x+b.max.x)/2/this.cellSize)+','+Math.floor((b.min.z+b.max.z)/2/this.cellSize);}
  const group=this.groups.get(key)??{material,geometries:[]};group.geometries.push(g);this.groups.set(key,group);
 }
 finish(scene:THREE.Object3D,shadow:(m:THREE.Material)=>{cast:boolean;receive:boolean}=()=>({cast:true,receive:true})){
  const meshes:THREE.Mesh[]=[];
  for(const [key,{material,geometries}] of this.groups){
   const geometry=mergeGeometries(geometries);if(!geometry)throw new Error('Static geometry merge failed');
   geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,material);mesh.name=(material.name||material.type)+(key.includes(':')?':'+key.split(':')[1]:'');const s=shadow(material);mesh.castShadow=s.cast;mesh.receiveShadow=s.receive;scene.add(mesh);meshes.push(mesh);geometries.forEach(g=>g.dispose());
  }
  this.groups.clear();return meshes;
 }
}
/** Triangle soup (or indexed) surface. Optional UVs are two floats per vertex. */
export function surface(vertices:number[],indices?:number[],uvs?:number[]){
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));if(uvs)g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));if(indices)g.setIndex(indices);g.computeVertexNormals();return g;
}
export function quad(a:number[],b:number[],c:number[],d:number[],uv?:number[][]){
 return surface([...a,...b,...c,...a,...c,...d],undefined,uv?[...uv[0],...uv[1],...uv[2],...uv[0],...uv[2],...uv[3]]:undefined);
}
export function beam(a:THREE.Vector3,b:THREE.Vector3,width:number,depth=width){
 const g=new THREE.BoxGeometry(width,a.distanceTo(b),depth);
 const m=new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(.5),new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize()),new THREE.Vector3(1,1,1));return g.applyMatrix4(m);
}
/** Cylinder between two points (struts, pistons, pipes). */
export function rod(a:THREE.Vector3,b:THREE.Vector3,radius:number,segments=10){
 const g=new THREE.CylinderGeometry(radius,radius,a.distanceTo(b),segments);
 const m=new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(.5),new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize()),new THREE.Vector3(1,1,1));return g.applyMatrix4(m);
}
