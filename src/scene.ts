import * as THREE from 'three';
import { GRID, SIZE, heights, heightAt, rawHeight, LANDMARKS, ROCKS, GRASS, random } from './world';
import { StaticBatch, surface, quad, beam, rod } from './geometry';
import { chiseledRock } from './rocks';
import { fbm, ridged, noise2 } from './noise';
import { groundTextures, hullTextures, linerTexture, gratingTexture, consoleScreen } from './textures';
import { createSky, createDust } from './sky';

export type Quality = 'low'|'standard'|'high';
const lin=(r:number,g:number,b:number)=>new THREE.Color().setRGB(r,g,b,THREE.LinearSRGBColorSpace);
const smooth=(a:number,b:number,t:number)=>{const u=Math.max(0,Math.min(1,(t-a)/(b-a)));return u*u*(3-2*u);};
function segDist(px:number,pz:number,ax:number,az:number,bx:number,bz:number){const dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/(dx*dx+dz*dz)));return Math.hypot(px-ax-dx*t,pz-az-dz*t);}
/** Terrain outside the walkable 160 m square: a rising ring of ridged, snow-capped mountains. */
export function outerHeight(x:number,z:number){
 const cx=Math.max(0,Math.min(SIZE,x)),cz=Math.max(0,Math.min(SIZE,z)),d=Math.hypot(x-cx,z-cz);
 if(d<=0)return x<=0||z<=0||x>=SIZE||z>=SIZE?rawHeight(cx,cz)-.8:rawHeight(cx,cz)-3;
 const ramp=smooth(0,110,d),r=ridged(x*.0065+3,z*.0065-2,5,41);
 return rawHeight(cx,cz)-.8+d*.22+ramp*(r*r*150+fbm(x*.02,z*.02,3,5)*14)+smooth(0,40,d)*fbm(x*.05,z*.05,3,9)*6;
}

export function createWorld(scene:THREE.Scene){
 const rng=random(558),dummy=new THREE.Object3D(),color=new THREE.Color();
 const cache=new Map<string,THREE.MeshStandardMaterial>();
 const mat=(key:string,params:THREE.MeshStandardMaterialParameters)=>{if(!cache.has(key))cache.set(key,new THREE.MeshStandardMaterial(params));return cache.get(key)!;};
 const batch=new StaticBatch(),cube=new THREE.BoxGeometry(1,1,1);
 const box=(m:THREE.Material,x:number,y:number,z:number,w:number,h:number,d:number,ry=0,rz=0,rx=0)=>batch.add(cube,m,x,y,z,w,h,d,rx,ry,rz);
 const noShadow=new Set<THREE.Material>();

 // ---------- Materials ----------
 const hullTex=hullTextures();
 const hull=mat('hull',{map:hullTex.map,normalMap:hullTex.normalMap,normalScale:new THREE.Vector2(.7,.7),roughness:.55,metalness:.18});
 const liner=mat('liner',{map:linerTexture(),color:'#6c736e',roughness:.94,envMapIntensity:.15});liner.side=THREE.BackSide;
 const frame=mat('frame',{color:'#2a3336',roughness:.5,metalness:.55});
 const steel=mat('steel',{color:'#a9b0b0',roughness:.32,metalness:.85});
 const burnt=mat('burnt',{color:'#3a3531',roughness:.7,metalness:.5});
 const orange=mat('orange',{color:'#c9682c',roughness:.45,metalness:.2});
 const grateTex=gratingTexture();grateTex.repeat.set(3.5,4.2);
 const grate=mat('grate',{map:grateTex,roughness:.6,metalness:.6});
 const warm=mat('warm',{color:'#ffe2b0',emissive:'#ffb866',emissiveIntensity:2.6});noShadow.add(warm);
 const cool=mat('cool',{color:'#7fd6d0',emissive:'#5cc9c2',emissiveIntensity:1.4});noShadow.add(cool);
 const beacon=mat('beacon',{color:'#ff9a4a',emissive:'#ff7a2a',emissiveIntensity:2});noShadow.add(beacon);
 const redLight=mat('red',{color:'#ff5040',emissive:'#ff2a1a',emissiveIntensity:3});noShadow.add(redLight);
 const holo=mat('holo',{color:'#6fd8d0',emissive:'#3fc4bb',emissiveIntensity:1.4,transparent:true,opacity:.6,depthWrite:false});noShadow.add(holo);
 const glass=mat('glass',{color:'#1b2a2e',roughness:.08,metalness:.4,emissive:'#6b4a22',emissiveIntensity:.5});
 const fabric=mat('fabric',{color:'#6f8472',roughness:.95});
 const rock=mat('rock',{vertexColors:true,flatShading:true,roughness:.93});
 const ice=mat('ice',{vertexColors:true,flatShading:true,color:'#cfe6ec',roughness:.14,metalness:0,envMapIntensity:1.6});
 const iron=mat('iron',{color:'#4a5763',roughness:.34,metalness:.8,flatShading:true});
 const copper=mat('copper',{color:'#b8703f',roughness:.36,metalness:.78,flatShading:true});
 const caveInner=mat('caveInner',{color:'#1d2224',roughness:1,side:THREE.DoubleSide,flatShading:true});
 const screen=consoleScreen();
 const screenMat=mat('screen',{map:screen.texture,emissiveMap:screen.texture,emissive:'#ffffff',emissiveIntensity:1.1,roughness:.3});noShadow.add(screenMat);

 // ---------- Terrain (walkable square, 1 m grid, identical to collision heights) ----------
 const ground=groundTextures();ground.map.repeat.set(1,1);
 const terrainMat=new THREE.MeshStandardMaterial({vertexColors:true,map:ground.map,normalMap:ground.normalMap,normalScale:new THREE.Vector2(.9,.9),roughness:.96});
 terrainMat.onBeforeCompile=s=>{s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>',`#ifdef USE_MAP
  vec4 t1=texture2D(map,vMapUv);vec4 t2=texture2D(map,vMapUv*.23+vec2(.31,.17));diffuseColor.rgb*=mix(t1.rgb,t2.rgb,.45)*1.18;
 #endif`);};
 const P=[['#9b7a58','dust'],['#86694d','earth'],['#6e655c','gravel'],['#b1946f','path'],['#8a7d6c','silt'],['#e7ecee','snow'],['#4d4642','rock']] as const;
 const C=Object.fromEntries(P.map(([h,k])=>[k,new THREE.Color(h)])) as Record<string,THREE.Color>;
 const paths=[[40,44,43,56],[43,56,62,63],[62,63,80,56],[40,44,56,45],[62,63,30,79],[80,56,110,72]];
 const snowAt=(x:number,z:number,h:number)=>{
  const ice=smooth(15,8,Math.hypot(x-30,z-80)+fbm(x*.15,z*.15,2,4)*6);
  const edge=smooth(4,9,h)*smooth(.12,.34,fbm(x*.07,z*.07,3,8))*.85;
  const hollow=smooth(.42,.62,fbm(x*.08,z*.08,3,13))*smooth(-.2,-.9,h-rawHeight(x,z)*0-(.3*Math.sin(x*.056)*Math.cos(z*.049)));
  return Math.max(ice,edge,hollow*.9);
 };
 const groundColor=(x:number,z:number,h:number,out:THREE.Color)=>{
  out.copy(C.dust).lerp(C.earth,smooth(-.3,.4,fbm(x*.035,z*.035,3,2)));
  out.lerp(C.gravel,smooth(.18,.5,fbm(x*.09+4,z*.09,3,6))*.8);
  const p=Math.min(...paths.map(q=>segDist(x,z,q[0],q[1],q[2],q[3])));
  out.lerp(C.path,smooth(2.4,.6,p+noise2(x*.5,z*.5,3)*.6)*.55);
  const silt=smooth(16,10,Math.hypot((x-100)*.9,z-132));out.lerp(C.silt,silt);
  if(silt>0)out.lerp(new THREE.Color('#cbbfa8'),smooth(.3,0,Math.abs(silt-.35))*.5);
  out.multiplyScalar(1-smooth(8,3,Math.hypot(x-40,z-40.5))*.32*(0.7+.3*noise2(x,z,5)));
  out.lerp(C.rock,smooth(4,10,h)*.55);
  out.lerp(C.snow,snowAt(x,z,h));
  out.multiplyScalar(.93+noise2(x*.7,z*.7,19)*.07);
  return out;
 };
 {
  const pos:number[]=[],col:number[]=[],uv:number[]=[],idx:number[]=[];
  for(let z=0;z<GRID;z++)for(let x=0;x<GRID;x++){const h=heights[z*GRID+x];pos.push(x,h,z);groundColor(x,z,h,color);col.push(color.r,color.g,color.b);uv.push(x/2.6,z/2.6);}
  for(let z=0;z<GRID-1;z++)for(let x=0;x<GRID-1;x++){const a=z*GRID+x;idx.push(a,a+GRID,a+1,a+1,a+GRID,a+GRID+1);}
  const g=surface(pos,idx,uv);g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  const m=new THREE.Mesh(g,terrainMat);m.receiveShadow=true;scene.add(m);
 }
 // ---------- Outer mountains ----------
 {
  const step=10,min=-520,max=680,n=(max-min)/step+1,pos:number[]=[],col:number[]=[],uv:number[]=[],idx:number[]=[],hh:number[]=[];
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const x=min+i*step,z=min+j*step;hh.push(outerHeight(x,z));}
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
   const x=min+i*step,z=min+j*step,h=hh[j*n+i];
   const sx=(hh[j*n+Math.min(n-1,i+1)]-hh[j*n+Math.max(0,i-1)])/(2*step),sz=(hh[Math.min(n-1,j+1)*n+i]-hh[Math.max(0,j-1)*n+i])/(2*step),slope=Math.hypot(sx,sz);
   pos.push(x,h,z);uv.push(x/2.6,z/2.6);
   color.copy(C.dust).lerp(C.rock,smooth(.15,.6,slope)).lerp(new THREE.Color('#403c3a'),smooth(.7,1.3,slope)*.7);
   const snow=smooth(38,70,h+fbm(x*.02,z*.02,3,3)*30)*smooth(1.25,.55,slope);
   color.lerp(C.snow,Math.max(snow,snowAt(Math.max(0,Math.min(SIZE,x)),Math.max(0,Math.min(SIZE,z)),h)*smooth(40,0,h)*.0));
   color.multiplyScalar(.9+noise2(x*.08,z*.08,7)*.1);col.push(color.r,color.g,color.b);
  }
  for(let j=0;j<n-1;j++)for(let i=0;i<n-1;i++){const a=j*n+i;idx.push(a,a+n,a+1,a+1,a+n,a+n+1);}
  const g=surface(pos,idx,uv);g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  const m=new THREE.Mesh(g,terrainMat);m.receiveShadow=true;scene.add(m);
 }

 // ---------- Rocks ----------
 const boulders=[0,1,2,3,4,5].map(i=>chiseledRock(11+i*7,{strata:i%2?2.5:0}));
 const snowy=[0,1,2].map(i=>chiseledRock(90+i*5,{dust:'#e2e8ea',strata:3,cuts:9}));
 const tall=chiseledRock(501,{cuts:7,lumpy:.1,strata:4,flatTop:.9,taper:.38});
 // Rim cliffs taper upward so tall scaled copies read as buttresses, not overhanging blobs.
 const cliffs=[0,1,2,3,4,5].map(i=>chiseledRock(41+i*9,{strata:3,cuts:9,taper:.42,dust:i%3?undefined:'#e2e8ea'}));
 const tones=['#ffffff','#e9e4dc','#d8dcdc','#f2e8da'];
 ROCKS.forEach((r,i)=>{const h=heightAt(r.x,r.z);batch.add(boulders[i%6],rock,r.x,h-.12,r.z,r.s*.72,r.sy*1.02,r.s*.66,(rng()-.5)*.12,r.rotation,(rng()-.5)*.12,tones[i%4]);});
 // Cliffs and screes along the valley rim, on the rising edge, never inside the walkable centre.
 for(let i=0;i<64;i++){
  const t=i/64,side=Math.floor(t*4),u=(t*4-side)*(SIZE+40)-20,off=-10-rng()*26;
  const [x,z]=side===0?[u,off]:side===1?[SIZE-off,u]:side===2?[SIZE-u,SIZE-off]:[off,SIZE-u];
  const w=7+rng()*11,hh=6+rng()*14;
  // Sit on the lowest ground under the footprint so no cliff hovers over the inward slope.
  let base=Infinity;for(const [dx,dz] of [[0,0],[w,0],[-w,0],[0,w],[0,-w]])base=Math.min(base,outerHeight(x+dx,z+dz));
  batch.add(cliffs[i%6],rock,x,base-1.5,z,w,hh+(outerHeight(x,z)-base),w*(.6+rng()*.5),0,rng()*6,0,i%2?'#d4d2cf':'#ffffff');
 }
 // Twin spires — the valley's signature landmark: two leaning slabs with rubble.
 for(const [x,z,hh,w,lean,ry] of [[100,103,19,2.7,.07,.3],[106.5,104.2,14.5,2.2,-.1,1.2]]){
  batch.add(tall,rock,x,heightAt(x,z)-.4,z,w,hh,w*.8,lean*.5,ry,lean,'#e6e0d6');
  for(let k=0;k<7;k++){const a=rng()*6.28,d=2+rng()*2.5,px=x+Math.cos(a)*d,pz=z+Math.sin(a)*d;batch.add(boulders[k%6],rock,px,heightAt(px,pz)-.1,pz,.5+rng()*.9,.4+rng()*.8,.5+rng()*.8,0,rng()*6,0);}
 }
 // Pebbles: instanced, receive shadows only.
 {
  const peb=chiseledRock(7,{detail:0,cuts:5});const count=1300;
  const inst=new THREE.InstancedMesh(peb,rock,count);let k=0;const pr=random(77);
  while(k<count){
   const near=pr()<.55&&ROCKS.length?ROCKS[Math.floor(pr()*ROCKS.length)]:null;
   const x=near?near.x+(pr()-.5)*near.s*4:6+pr()*148,z=near?near.z+(pr()-.5)*near.s*4:6+pr()*148;
   if(x>36.5&&x<43.5&&z>36.5&&z<44.2)continue;if(x>112&&x<134&&z>68&&z<76)continue;
   const s=.04+pr()*pr()*.32;dummy.position.set(x,heightAt(x,z)-s*.25,z);dummy.rotation.set(pr(),pr()*6,pr());dummy.scale.set(s*(1+pr()),s*(.6+pr()*.6),s*(1+pr()));dummy.updateMatrix();inst.setMatrixAt(k,dummy.matrix);
   inst.setColorAt(k,color.set(tones[k%4]).multiplyScalar(.8+pr()*.3));k++;
  }
  inst.receiveShadow=true;scene.add(inst);
 }

 // ---------- Landing capsule ----------
 const h=heightAt(40,40),cy=(y:number)=>h+y,X=40,Z=40;
 const ring=[[-1.86,3],[1.86,3],[2.5,2.34],[2.5,-2.34],[1.86,-3],[-1.86,-3],[-2.5,-2.34],[-2.5,2.34]];
 const levels=[[.15,1],[1.4,.985],[2.3,.955],[2.9,.93],[3.55,.84],[4.05,.66],[4.35,.46]];
 const pt=(p:number[],y:number,inset:number,s=1)=>[X+p[0]*inset*s,cy(y),Z+p[1]*inset*s];
 const DOOR=.95;
 for(const [material,scale] of [[hull,1],[liner,.965]] as const){
  for(let i=0;i<8;i++){
   const a=ring[i],b=ring[(i+1)%8];
   for(let l=0;l<levels.length-1;l++){
    const [y0,k0]=levels[l],[y1,k1]=levels[l+1],v0=y0/4.35,v1=y1/4.35,u0=(i*.37)%1,u1=u0+.37;
    const lerp=(p:number[],q:number[],t:number)=>[p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t];
    if(i===0&&y1<=2.3){
     // Door opening in the front face: left and right jambs only.
     for(const [s0,s1] of [[0,(1-DOOR/(1.86*k0))/2],[(1+DOOR/(1.86*k0))/2,1]]){
      const s0b=s0===0?0:(1+DOOR/(1.86*k1))/2,s1b=s1===1?1:(1-DOOR/(1.86*k1))/2;
      batch.add(quad(pt(lerp(a,b,s0),y0,k0,scale),pt(lerp(a,b,s1),y0,k0,scale),pt(lerp(a,b,s1b),y1,k1,scale),pt(lerp(a,b,s0b),y1,k1,scale),[[u0+.37*s0,v0],[u0+.37*s1,v0],[u0+.37*s1b,v1],[u0+.37*s0b,v1]]),material);
     }
     continue;
    }
    batch.add(quad(pt(a,y0,k0,scale),pt(b,y0,k0,scale),pt(b,y1,k1,scale),pt(a,y1,k1,scale),[[u0,v0],[u1,v0],[u1,v1],[u0,v1]]),material);
   }
   // Ribs at the corners follow the tapering shell.
   for(let l=0;l<levels.length-1;l++){const [y0,k0]=levels[l],[y1,k1]=levels[l+1];batch.add(beam(new THREE.Vector3(...pt(a,y0,k0,1.012)),new THREE.Vector3(...pt(a,y1,k1,1.012)),.09),frame);}
   // Burnt heat-shield skirt.
   batch.add(quad(pt(a,-.05,1.05),pt(b,-.05,1.05),pt(b,.5,1.02),pt(a,.5,1.02)),burnt);
  }
  batch.add(new THREE.CylinderGeometry(1.25*.46*scale,1.25*.46*scale,.02,16),material,X,cy(4.35),Z);
 }
 // Door frame, warm light strip and interior glow.
 for(const s of [-1,1]){box(frame,X+s*1.0,cy(1.22),Z+2.98,.14,2.2,.32);box(orange,X+s*1.09,cy(1.25),Z+3.1,.05,1.9,.04);}
 box(frame,X,cy(2.36),Z+2.98,2.14,.16,.34);box(warm,X,cy(2.25),Z+3.1,1.7,.05,.05);
 // Ramp with grating and rails.
 {
  const r0=new THREE.Vector3(X,cy(.2),Z+3.3),r1=new THREE.Vector3(X,heightAt(X,Z+5.6)+.03,Z+5.6);
  const len=r0.distanceTo(r1),ang=Math.atan2(r0.y-r1.y,r1.z-r0.z);
  batch.add(new THREE.BoxGeometry(1.9,.06,len),grate,X,(r0.y+r1.y)/2,(r0.z+r1.z)/2,1,1,1,ang,0,0);
  for(const s of [-1,1]){batch.add(beam(new THREE.Vector3(X+s*.98,r0.y+.02,r0.z),new THREE.Vector3(X+s*.98,r1.y+.02,r1.z),.07,.12),orange);}
  box(frame,X,cy(.09),Z+3.45,2.1,.18,.4);
 }
 // Landing legs: strut, polished piston, pad.
 for(const sx of [-1,1])for(const zz of [-2.1,2.1]){
  const top=new THREE.Vector3(X+sx*2.35,cy(1.7),Z+zz),foot=new THREE.Vector3(X+sx*3.35,heightAt(X+sx*3.35,Z+zz*1.12)+.14,Z+zz*1.12);
  const mid=top.clone().lerp(foot,.45);
  batch.add(rod(top,mid,.13),frame);batch.add(rod(mid,foot,.08),steel);
  batch.add(rod(top.clone().setY(cy(.6)),mid,.05),steel);
  batch.add(new THREE.CylinderGeometry(.42,.5,.14,14),frame,foot.x,foot.y-.05,foot.z);box(orange,foot.x,foot.y+.04,foot.z,.3,.05,.3);
 }
 // Portholes on both flanks with warm interior light.
 for(const s of [-1,1]){
  batch.add(new THREE.TorusGeometry(.34,.07,8,20),frame,X+s*2.46,cy(2.25),Z-.2,1,1,1,0,Math.PI/2,0);
  batch.add(new THREE.CircleGeometry(.33,20),glass,X+s*2.44,cy(2.25),Z-.2,1,1,1,0,s*Math.PI/2,0);
  // Side service panel and vents.
  box(frame,X+s*2.47,cy(1.05),Z+1.2,.04,.8,1.1);for(let i=0;i<5;i++)box(steel,X+s*2.5,cy(.78+i*.13),Z+1.2,.03,.05,.95);
  // RCS thruster blocks at the shoulder.
  box(frame,X+s*2.18,cy(3.55),Z-1.6,.3,.3,.4);batch.add(new THREE.CylinderGeometry(.05,.09,.18,8),burnt,X+s*2.36,cy(3.55),Z-1.6,1,1,1,0,0,s*Math.PI/2);
 }
 // Roof: hatch, radiator, antenna mast with blinking light and a small dish.
 batch.add(new THREE.CylinderGeometry(.48,.52,.18,16),frame,X,cy(4.45),Z);batch.add(new THREE.CylinderGeometry(.34,.34,.08,16),steel,X,cy(4.57),Z);
 for(let i=0;i<7;i++)box(steel,X-.9,cy(4.12),Z-.9+i*.3,.05,.12,.22,0,.5);
 batch.add(rod(new THREE.Vector3(X+.9,cy(3.9),Z-.9),new THREE.Vector3(X+.9,cy(6.1),Z-.9),.035,6),frame);
 box(redLight,X+.9,cy(6.15),Z-.9,.09,.09,.09);
 batch.add(new THREE.SphereGeometry(.28,12,6,0,Math.PI*2,0,Math.PI/2.4),steel,X+.9,cy(5.2),Z-.9,1,1,1,Math.PI*.6,0,0);
 // Interior: floor grating, berth, console, bottles, lockers, ceiling light ring.
 batch.add(new THREE.PlaneGeometry(4.4,5.4),grate,X,cy(.16),Z,1,1,1,-Math.PI/2,0,0);
 box(frame,38.12,cy(.39),39.5,.78,.62,2.5);box(fabric,38.12,cy(.77),39.5,.74,.16,2.42);
 box(mat('pillow',{color:'#c9cbc0',roughness:.95}),38.12,cy(.9),38.55,.62,.12,.42);box(mat('blanket',{color:'#9a6b45',roughness:.95}),38.12,cy(.87),40.1,.76,.06,1.1);
 box(frame,41.35,cy(.87),37.7,1.3,1.6,.65);
 batch.add(new THREE.PlaneGeometry(1.02,.51),screenMat,41.35,cy(1.31),38.035);
 box(steel,41.35,cy(.81),38.21,1.25,.07,.46);
 for(let i=0;i<5;i++)box(i===4?orange:frame,40.9+i*.2,cy(.86),38.3,.09,.04,.1);
 box(cool,41.35,cy(1.62),38.04,1,.03,.02);
 for(let i=0;i<2;i++){
  const bx=38.9+i*.49;
  batch.add(new THREE.CylinderGeometry(.19,.19,.98,16),steel,bx,cy(.72),37.55);batch.add(new THREE.SphereGeometry(.19,16,8),steel,bx,cy(1.21),37.55);batch.add(new THREE.SphereGeometry(.19,16,8),steel,bx,cy(.23),37.55);
  batch.add(new THREE.CylinderGeometry(.055,.055,.15,8),frame,bx,cy(1.43),37.55);box(orange,bx,cy(1.51),37.55,.17,.04,.09);box(orange,bx,cy(.99),37.745,.29,.13,.02);
  box(frame,bx,cy(.9),37.4,.43,.06,.12);
 }
 box(frame,40.2,cy(1.3),37.42,.62,2.2,.28);box(steel,40.2,cy(1.3),37.57,.56,2.1,.02);box(orange,40.4,cy(1.3),37.585,.03,.3,.02);
 batch.add(new THREE.TorusGeometry(1.1,.05,6,32),warm,X,cy(3.8),Z,1,1,1,Math.PI/2,0,0);
 for(const z of [38.2,39.9,41.6])box(frame,X,cy(3.86),z,3.65,.07,.08);
 // Supply crates (colliders in world.ts).
 for(const [x,z,w,hh,d] of [[44.8,41.4,1.2,.8,.85],[35.5,43.6,.9,.7,.9]]){
  const y=heightAt(x,z);box(mat('crate',{color:'#5d6b62',roughness:.7,metalness:.3}),x,y+hh/2,z,w,hh,d);
  for(const s of [-1,1])box(orange,x+s*w*.32,y+hh/2,z,.07,hh+.02,d+.02);box(frame,x,y+hh+.01,z,w*.9,.02,d*.3);
 }
 // Scorch fan from landing is painted into terrain colour. Future base plot: survey posts + holographic outline.
 for(const [x,z] of [[50,36],[66,36],[50,52],[66,52]]){const y=heightAt(x,z);batch.add(rod(new THREE.Vector3(x,y,z),new THREE.Vector3(x,y+.9,z),.05,8),frame);box(beacon,x,y+.95,z,.12,.12,.12);box(burnt,x,y+.05,z,.35,.1,.35);}
 for(const [x0,z0,x1,z1] of [[50,36,66,36],[66,36,66,52],[66,52,50,52],[50,52,50,36]]){
  const n=16;for(let i=0;i<n;i+=1){if(i%2)continue;const ax=x0+(x1-x0)*i/n,az=z0+(z1-z0)*i/n,bx=x0+(x1-x0)*(i+1)/n,bz=z0+(z1-z0)*(i+1)/n,mx=(ax+bx)/2,mz=(az+bz)/2;
   box(holo,mx,heightAt(mx,mz)+.03,mz,Math.abs(bx-ax)+.025,.012,Math.abs(bz-az)+.025);}
 }

 // ---------- Cave ----------
 {
  const cv:number[]=[],ci:number[]=[],sections=9,arc=14;
  for(let j=0;j<sections;j++)for(let k=0;k<=arc;k++){
   const a=k/arc*Math.PI,bump=noise2(j*.9,k*.8,3)*.22;const x=113+j*2.4;const radius=3.0+Math.sin(j*1.3)*.1;
   cv.push(x,.3+Math.sin(a)*(4.3+bump),72+Math.cos(a)*(radius+bump));
  }
  for(let j=0;j<sections-1;j++)for(let k=0;k<arc;k++){const a=j*(arc+1)+k,b=a+arc+1;ci.push(a,a+1,b,a+1,b+1,b);}
  const tunnel=surface(cv,ci).toNonIndexed();tunnel.computeVertexNormals();batch.add(tunnel,caveInner);
  batch.add(boulders[2],rock,132.2,.1,72,1.4,5,3.4,0,0,0,'#6a6a6a');
  // Mouth frame from the tunnel lip to the cliff face.
  for(let k=0;k<arc;k++){
   const a=k/arc*Math.PI,b=(k+1)/arc*Math.PI;
   const inner=(t:number)=>[112.9+noise2(t*3,1,2)*.2,.28+Math.sin(t)*(4.45+noise2(t*4,2,2)*.15),72+Math.cos(t)*3.05];
   const outer=(t:number)=>[113.9+noise2(t*3,5,2)*.6,.05+Math.sin(t)*(6.2+noise2(t*6,3,2)*1.1),72+Math.cos(t)*(5.6+noise2(t*6,8,2)*.8)];
   batch.add(quad(inner(a),outer(a),outer(b),inner(b)),rock,0,0,0,1,1,1,0,0,0,'#2e3233');
  }
  // Cliff mass hiding the tunnel skin; all rocks stay outside the passage envelope.
  const place=(x:number,y:number,z:number,w:number,hh:number,d:number,ry:number,shape=boulders[(Math.abs(x*7+z)|0)%6],tint='#ffffff')=>batch.add(shape,rock,x,y,z,w,hh,d,0,ry,0,tint);
  place(114,-.3,66.2,3.2,8.2,2.6,.3);place(114.2,-.3,77.8,3.4,7.6,2.7,1.1);place(115,5.2,72,3.4,3.4,5.8,.2,snowy[0]);
  for(let i=0;i<6;i++){const x=117+i*3.4;place(x,-.4,64.8-rng(),3.1,8+rng()*2.5,2.5,rng()*6);place(x,-.4,79.2+rng(),3.1,8+rng()*2.5,2.5,rng()*6);place(x,4.9,72+(rng()-.5)*2,2.8,3+rng()*2.2,5.4,rng()*6,i%2?snowy[i%3]:boulders[i%6]);}
  place(136,-.4,72,4,9,7,.4,snowy[1]);
  for(let i=0;i<9;i++){const x=109+rng()*6,z=72+(rng()<.5?-1:1)*(4+rng()*3);place(x,heightAt(x,z)-.1,z,.4+rng()*1.1,.3+rng()*.9,.4+rng()*1,rng()*6);}
 }
 // ---------- Ice pocket ----------
 for(let i=0;i<16;i++){
  const a=rng()*6.28,d=Math.sqrt(rng())*6,x=30+Math.cos(a)*d,z=80+Math.sin(a)*d;
  batch.add(chiseledRock(300+i,{detail:1,base:'#ffffff',dust:'#ffffff',dark:'#8fb0ba',cuts:6}),ice,x,heightAt(x,z)-.08,z,.5+rng()*1.1,.18+rng()*.6,.5+rng()*.9,0,rng()*6,0);
 }
 // ---------- Ore outcrops ----------
 {
  const hostI=chiseledRock(610,{strata:3}),hostC=chiseledRock(620,{dust:'#6f8f7c',strata:2});
  let x=67,z=65,y=heightAt(x,z);batch.add(hostI,rock,x,y-.05,z,1.8,1.7,1.5,0,.3,0,'#cfd3d6');
  for(let i=0;i<9;i++){const a=i/9*6.28+rng()*.4;batch.add(chiseledRock(700+i,{detail:1,cuts:10,lumpy:.05}),iron,x+Math.cos(a)*1.25,y+.35+rng()*.9,z+Math.sin(a)*1.05,.35+rng()*.25,.1+rng()*.08,.22,rng()*.8,a,.5+rng()*.5);}
  x=83;z=55;y=heightAt(x,z);batch.add(hostC,rock,x,y-.05,z,1.8,1.6,1.5,0,.9,0,'#d6d0c8');
  for(let i=0;i<11;i++){const a=rng()*6.28,r=.9+rng()*.5;batch.add(chiseledRock(800+i,{detail:1,cuts:2,lumpy:.35}),copper,x+Math.cos(a)*r,y+.25+rng()*1.1,z+Math.sin(a)*r*.85,.14+rng()*.18,.12+rng()*.16,.14+rng()*.16,rng(),rng()*6,rng());}
 }

 // ---------- Local vegetation: low rosettes, 5–9 folded leaves, swaying in the wind ----------
 const windUniform={value:0};
 {
  const gv:number[]=[],gc:number[]=[],gs:number[]=[],leaves=8,segs=4,base=new THREE.Color('#3c4a39'),mid=new THREE.Color('#6d7c5d'),tip=new THREE.Color('#b8ae80');
  for(let l=0;l<leaves;l++){
   const a=l/leaves*6.283+(l%2)*.3,len=.55+(l%3)*.14,w=.08+(l%2)*.02,out=.35+(l%3)*.1;
   const P=(t:number,side:number)=>{const r=out*len*t*t+.02,y=len*(t*.95-t*t*.35),ww=w*(1-t)*side;const fold=Math.abs(side)*.03*(1-t);return [Math.cos(a)*r-Math.sin(a)*ww,y+fold,Math.sin(a)*r+Math.cos(a)*ww];};
   for(let s=0;s<segs;s++){
    const t0=s/segs,t1=(s+1)/segs;
    for(const side of [-1,1]){
     const q=[P(t0,0),P(t0,side),P(t1,side),P(t1,0)];
     const tri=[[q[0],q[1],q[2],t0,t0,t1],[q[0],q[2],q[3],t0,t1,t1]] as const;
     for(const [A,B,Cc,ta,tb,tc] of tri){gv.push(...A,...B,...Cc);for(const tt of [ta,tb,tc]){color.copy(base).lerp(mid,Math.min(1,tt*2)).lerp(tip,Math.max(0,tt*2-1)*.8);gc.push(color.r,color.g,color.b);gs.push(tt);}}
    }
   }
  }
  const g=surface(gv);g.setAttribute('color',new THREE.Float32BufferAttribute(gc,3));g.setAttribute('sway',new THREE.Float32BufferAttribute(gs,1));
  const m=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.82});
  m.onBeforeCompile=s=>{s.uniforms.uWind=windUniform;s.vertexShader='attribute float sway;uniform float uWind;\n'+s.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
   vec3 ip=instanceMatrix[3].xyz;float w=sway*sway;transformed.x+=sin(uWind*1.6+ip.x*.35+ip.z*.2)*.07*w;transformed.z+=cos(uWind*1.2+ip.x*.2)*.05*w;`);};
  const inst=new THREE.InstancedMesh(g,m,GRASS.length);
  GRASS.forEach((p,i)=>{dummy.position.set(p.x,heightAt(p.x,p.z)-.02,p.z);dummy.scale.setScalar(p.s*1.35);dummy.rotation.set(0,p.rotation,0);dummy.updateMatrix();inst.setMatrixAt(i,dummy.matrix);inst.setColorAt(i,color.setHSL(.2+rng()*.06,.12+rng()*.1,.62+rng()*.3));});
  inst.receiveShadow=true;inst.castShadow=true;scene.add(inst);
 }
 const meshes=batch.finish(scene,m=>({cast:!noShadow.has(m)&&m!==caveInner,receive:!noShadow.has(m)}));

 // ---------- Sky, light, fog, atmosphere ----------
 const sky=createSky();scene.add(sky.mesh);
 const dust=createDust(260);scene.add(dust.points);
 const hemi=new THREE.HemisphereLight('#bcd3dc','#8a7358',1.15);scene.add(hemi);
 const sun=new THREE.DirectionalLight('#ffd9a8',3.4);sun.castShadow=true;scene.add(sun,sun.target);
 const sc=sun.shadow.camera;sc.left=-42;sc.right=42;sc.top=42;sc.bottom=-42;sc.near=1;sc.far=260;sun.shadow.bias=-.0004;sun.shadow.normalBias=.04;
 const doorLight=new THREE.PointLight('#ffb870',9,13,1.7);doorLight.position.set(40,cy(1.8),43.8);scene.add(doorLight);
 const interior=new THREE.PointLight('#ffd3a0',3.2,6.5,1.6);interior.position.set(40,cy(3.3),39.8);scene.add(interior);
 const fog=new THREE.FogExp2(lin(.8,.68,.53),.0026);scene.fog=fog;
 const D={sun:new THREE.Color('#ffd9a8'),hemiSky:new THREE.Color('#bcd3dc'),hemiGround:new THREE.Color('#8a7358'),fog:lin(.8,.68,.53),dust:new THREE.Color('#fff1d6')};
 const N={sun:new THREE.Color('#8fa9d6'),hemiSky:new THREE.Color('#5f7896'),hemiGround:new THREE.Color('#2b2f36'),fog:lin(.07,.1,.15),dust:new THREE.Color('#a9c4e6')};
 const sunDay=new THREE.Vector3(.93,.22,.3).normalize(),moon=new THREE.Vector3(.5,.55,.67).normalize();
 let nightTarget=0,k=-1,time=0,screenClock=0,envDirty=true,quality:Quality='standard';
 const pmremTarget:{rt:THREE.WebGLRenderTarget|null}={rt:null};
 const envScene=new THREE.Scene();const envSky=createSky();envScene.add(envSky.mesh);
 function applyNight(v:number){
  sky.uniforms.night.value=v;sky.uniforms.sunDir.value.copy(sunDay).lerp(moon,v).normalize();
  sun.color.copy(D.sun).lerp(N.sun,v);sun.intensity=THREE.MathUtils.lerp(3.4,.5,v);
  hemi.color.copy(D.hemiSky).lerp(N.hemiSky,v);hemi.groundColor.copy(D.hemiGround).lerp(N.hemiGround,v);hemi.intensity=THREE.MathUtils.lerp(1.15,.6,v);
  fog.color.copy(D.fog).lerp(N.fog,v);fog.density=THREE.MathUtils.lerp(.0028,.0042,v);
  dust.uniforms.tint.value.copy(D.dust).lerp(N.dust,v);dust.uniforms.opacity.value=THREE.MathUtils.lerp(.28,.22,v);
  doorLight.intensity=THREE.MathUtils.lerp(9,16,v);interior.intensity=THREE.MathUtils.lerp(3.2,4.2,v);
  warm.emissiveIntensity=THREE.MathUtils.lerp(2.6,3.4,v);glass.emissiveIntensity=THREE.MathUtils.lerp(.5,1.8,v);
 }
 function setNight(night:boolean,instant=false){nightTarget=night?1:0;if(instant){k=nightTarget;applyNight(k);envDirty=true;}}
 function setQuality(q:Quality){quality=q;sun.castShadow=q!=='low';const size=q==='high'?2048:1024;if(sun.shadow.mapSize.x!==size){sun.shadow.mapSize.set(size,size);sun.shadow.map?.dispose();sun.shadow.map=null as unknown as THREE.WebGLRenderTarget;}dust.points.visible=q!=='low';}
 const snapped=new THREE.Vector3();
 function update(dt:number,camera:THREE.Camera,renderer:THREE.WebGLRenderer){
  time+=dt;windUniform.value=time;sky.uniforms.time.value=time;dust.uniforms.time.value=time;dust.uniforms.origin.value.copy(camera.position);
  if(k!==nightTarget){const step=dt*.55;k=Math.abs(nightTarget-k)<=step?nightTarget:k+Math.sign(nightTarget-k)*step;applyNight(k);if(k===nightTarget)envDirty=true;}
  if(envDirty){envDirty=false;envSky.uniforms.night.value=sky.uniforms.night.value;envSky.uniforms.sunDir.value.copy(sky.uniforms.sunDir.value);const gen=new THREE.PMREMGenerator(renderer);const rt=gen.fromScene(envScene,0,.1,1000);gen.dispose();pmremTarget.rt?.dispose();pmremTarget.rt=rt;scene.environment=rt.texture;scene.environmentIntensity=THREE.MathUtils.lerp(.55,.25,k);}
  // Shadow frustum follows the viewer, snapped to texels to avoid shimmering.
  const texel=84/sun.shadow.mapSize.x;snapped.set(Math.round(camera.position.x/texel)*texel,Math.round(camera.position.y/texel)*texel,Math.round(camera.position.z/texel)*texel);
  sun.target.position.copy(snapped);sun.position.copy(snapped).addScaledVector(sky.uniforms.sunDir.value,130);
  const blink=(Math.sin(time*3)>.6?1:0);redLight.emissiveIntensity=.3+blink*3.5;beacon.emissiveIntensity=1.2+Math.sin(time*2.2)*.8;holo.opacity=.55+Math.sin(time*1.7)*.2;
  screenClock-=dt;if(screenClock<=0&&camera.position.distanceTo(interior.position)<14){screenClock=.25;screen.draw(time,k>.5);}
 }
 applyNight(0);setQuality('standard');
 return{setNight,setQuality,update,followSky:(_p:THREE.Vector3)=>{},landmarks:LANDMARKS,grassCount:GRASS.length,meshes,get quality(){return quality;},get nightValue(){return k;}};
}
