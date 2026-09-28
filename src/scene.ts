import * as THREE from 'three';
import { GRID, STEP, SIZE, heights, heightAt, LANDMARKS, ROCKS, boxes, random } from './world';
export function createWorld(scene:THREE.Scene){
 const materials=new Map<string,THREE.MeshStandardMaterial>();
 const mat=(color:string,extra:THREE.MeshStandardMaterialParameters={})=>{
  const key=color+JSON.stringify(extra);if(!materials.has(key))materials.set(key,new THREE.MeshStandardMaterial({color,roughness:.92,flatShading:true,...extra}));return materials.get(key)!;
 };
 const terrainGeo=new THREE.BufferGeometry(),positions:number[]=[],colors:number[]=[],indices:number[]=[];
 const c=new THREE.Color();
 for(let z=0;z<GRID;z++)for(let x=0;x<GRID;x++){
  const h=heights[z*GRID+x];positions.push(x*STEP,h,z*STEP);
  const variation=(Math.sin(x*1.47+z*.89)+Math.cos(x*.48-z*.67))*.025;
  c.set(((x*STEP-100)/12)**2+((z*STEP-132)/10)**2<1?'#7F8276':'#948575').offsetHSL(0,variation*.35,variation+Math.max(0,h-4)*-.012);colors.push(c.r,c.g,c.b);
 }
 for(let z=0;z<GRID-1;z++)for(let x=0;x<GRID-1;x++){const a=z*GRID+x;indices.push(a,a+GRID,a+1,a+1,a+GRID,a+GRID+1);}
 terrainGeo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));terrainGeo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));terrainGeo.setIndex(indices);terrainGeo.computeVertexNormals();
 const terrain=new THREE.Mesh(terrainGeo,mat('#ffffff',{vertexColors:true}));scene.add(terrain);
 const cube=new THREE.BoxGeometry(1,1,1),stoneGeo=new THREE.DodecahedronGeometry(1,0);
 function solid(geometry:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number,sx=1,sy=1,sz=1){const o=new THREE.Mesh(geometry,material);o.position.set(x,y,z);o.scale.set(sx,sy,sz);scene.add(o);return o;}
 const rockmat=mat('#505958');
 const rockMesh=new THREE.InstancedMesh(stoneGeo,rockmat,ROCKS.length),dummy=new THREE.Object3D();
 for(const [i,r]of ROCKS.entries()){
  dummy.position.set(r.x,heightAt(r.x,r.z)+r.sy*.3,r.z);dummy.scale.set(r.s*.68,r.sy*.72,r.s*.65);dummy.rotation.set(.13,r.rotation,.07);dummy.updateMatrix();rockMesh.setMatrixAt(i,dummy.matrix);
 }scene.add(rockMesh);
 // Broad rocks define the horizon; they are scenery outside the walkable blockout.
 const randomH=random(919);const backdrops=new THREE.InstancedMesh(new THREE.ConeGeometry(1,1,5),mat('#727D7C'),22);
 for(let i=0;i<22;i++){
  const a=i/22*Math.PI*2,r=140+randomH()*25;
  dummy.position.set(80+Math.cos(a)*r,7,80+Math.sin(a)*r);dummy.scale.set(24+randomH()*25,22+randomH()*48,18+randomH()*20);dummy.rotation.set(0,randomH()*6,0);dummy.updateMatrix();backdrops.setMatrixAt(i,dummy.matrix);
 }scene.add(backdrops);
 for(const b of boxes){
  if(b.id.startsWith('rock')||b.id.startsWith('spire')||b.id.endsWith('outcrop'))continue;
  const cave=b.id.startsWith('cave'),floor=b.id.endsWith('floor');
  solid(cube,mat(cave?'#414C50':floor?'#858E89':'#D8D9CE'),(b.minX+b.maxX)/2,(b.minY+b.maxY)/2,(b.minZ+b.maxZ)/2,b.maxX-b.minX,b.maxY-b.minY,b.maxZ-b.minZ);
 }
 const capY=heightAt(40,40);
 // A few structural accents communicate scale; these are blockout primitives, not final assets.
 for(const x of [37.36,42.64]){
  solid(cube,mat('#343A3D'),x,capY+1.8,40,.12,3.6,6.2);
  solid(cube,mat('#D48842'),x,capY+2.9,40,.14,.28,5.7);
 }
 solid(cube,mat('#343A3D'),40,capY+4.1,40,5.3,.22,6.3);
 solid(cube,mat('#D48842'),40,capY+2.4,43.14,1.75,.14,.12);
 const lampMat=mat('#FFCA7A',{emissive:'#FFA43E',emissiveIntensity:1.3});
 solid(cube,lampMat,40,capY+2.22,43.19,1.4,.1,.06);
 solid(cube,mat('#788480'),40.8,capY+.65,38.0,1.2,1.2,.4);
 const capsuleLight=new THREE.PointLight('#FFBE71',12,13,1.5);capsuleLight.position.set(40,capY+2,43);scene.add(capsuleLight);
 const interiorLight=new THREE.PointLight('#FFCF96',7,7,1.7);interiorLight.position.set(40,capY+2.8,39.8);scene.add(interiorLight);
 // Flat ground markers, no ghost of a fully-built base.
 const padPoints:number[]=[];
 for(const [x,z,sx,sz]of[[50,36,1,1],[66,36,-1,1],[50,52,1,-1],[66,52,-1,-1]]){
  const y=heightAt(x,z)+.04;padPoints.push(x,y,z,x+sx*2,y,z,x,y,z,x,y,z+sz*2);
 }
 const pg=new THREE.BufferGeometry();pg.setAttribute('position',new THREE.Float32BufferAttribute(padPoints,3));scene.add(new THREE.LineSegments(pg,new THREE.LineBasicMaterial({color:'#DCB36C'})));
 for(const [x,z,h,w,tilt]of[[100,103,18,3.3,-.12],[106,104,14,2.7,.10]]){
  const p=solid(new THREE.CylinderGeometry(.15,1,1,4),mat('#555D5C'),x,heightAt(x,z)+h/2,z,w,h,w*.78);p.rotation.z=tilt;
 }
 const rng=random(558);const iceMat=mat('#ABC6CD',{roughness:.48});
 for(let i=0;i<14;i++){const x=30+(rng()-.5)*9,z=80+(rng()-.5)*9;const m=solid(stoneGeo,iceMat,x,heightAt(x,z)+.12,z,.6+rng(),.15+rng()*.6,.7+rng());m.rotation.y=rng()*6;}
 for(const [x,z,type]of[[67,65,0],[83,55,1]]){
  const base=solid(stoneGeo,mat('#565B56'),x,heightAt(x,z)+.7,z,2.3,1.1,1.9);base.rotation.y=.3;
  for(let i=0;i<7;i++){
   const a=i/7*Math.PI*2,px=x+Math.cos(a)*1.35,pz=z+Math.sin(a)*1.15;
   const r=solid(type?stoneGeo:cube,mat(type?'#B87643':'#292F36'),px,heightAt(px,pz)+.83,pz,type?.42:.65,type?.4:.16,.28);r.rotation.y=a;
  }
 }
 // Solid triangular leaves avoid alpha overdraw. A handful of broad fans, reused by instancing.
 const grassGeo=new THREE.BufferGeometry();grassGeo.setAttribute('position',new THREE.Float32BufferAttribute([-.18,0,0,.02,.65,0,.18,0,0,0,0,-.18,0,.5,.04,0,0,.18,-.15,0,-.12,.22,.42,.2,.12,0,.15],3));grassGeo.computeVertexNormals();
 const tufts:{x:number,z:number,s:number}[]=[];
 for(let i=0;i<1300;i++){
  let x=12+rng()*136,z=12+rng()*136;
  if(i<100){x=44+(rng()-.5)*7;z=57+(rng()-.5)*6;}
  if((Math.hypot(x-58,z-44)<13)||(Math.hypot(x-40,z-40)<7)||(x>110&&x<138&&z>63&&z<81)||heightAt(x,z)>4)continue;
  tufts.push({x,z,s:.35+rng()*.55});
 }
 const grass=new THREE.InstancedMesh(grassGeo,mat('#69745F',{side:THREE.DoubleSide}),tufts.length);
 tufts.forEach((p,i)=>{dummy.position.set(p.x,heightAt(p.x,p.z)+.01,p.z);dummy.scale.setScalar(p.s);dummy.rotation.set(0,rng()*6,0);dummy.updateMatrix();grass.setMatrixAt(i,dummy.matrix);});scene.add(grass);
 // Sky dome follows the camera, with only a two-colour gradient. No image backgrounds.
 const skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{top:{value:new THREE.Color('#8FAAAF')},bottom:{value:new THREE.Color('#D9C5A8')}},vertexShader:'varying vec3 vP; void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'uniform vec3 top;uniform vec3 bottom;varying vec3 vP;void main(){float h=clamp(normalize(vP).y*.9+.18,0.,1.);gl_FragColor=vec4(mix(bottom,top,h),1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'});
 const sky=new THREE.Mesh(new THREE.SphereGeometry(240,24,12),skyMat);sky.renderOrder=-10;scene.add(sky);
 const hemi=new THREE.HemisphereLight('#BFD6D8','#74664F',2.1);scene.add(hemi);
 const sun=new THREE.DirectionalLight('#FFE4BD',2.5);sun.position.set(-50,70,30);scene.add(sun);
 const fog=new THREE.Fog('#CEC2AC',65,185);scene.fog=fog;
 function setNight(night:boolean){
  skyMat.uniforms.top.value.set(night?'#101D34':'#8FAAAF');skyMat.uniforms.bottom.value.set(night?'#36465C':'#D9C5A8');
  fog.color.set(night?'#29394C':'#CEC2AC');fog.near=night?48:65;fog.far=night?140:185;
  hemi.color.set(night?'#98B0CC':'#BFD6D8');hemi.groundColor.set(night?'#65788E':'#74664F');hemi.intensity=night?1.25:2.1;
  sun.color.set(night?'#91A9C9':'#FFE4BD');sun.intensity=night?.55:2.5;capsuleLight.intensity=night?18:12;
 }
 return{setNight,followSky:(position:THREE.Vector3)=>sky.position.copy(position),landmarks:LANDMARKS};
}
