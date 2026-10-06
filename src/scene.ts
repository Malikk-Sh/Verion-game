import * as THREE from 'three';
import { MIN, MAX, SIZE, heightAt, rawHeight, LANDMARKS, ROCKS, GRASS, FORMATIONS, MESA, CRATER, canyonDist, segDist, random } from './world';
import { StaticBatch, surface, quad, beam, rod } from './geometry';
import { chiseledRock, oreOutcrop } from './rocks';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { fbm, ridged, noise2 } from './noise';
import { groundTextures, hullTextures, gratingTexture, consoleScreen, panelTexture } from './textures';
import { createSky, createDust } from './sky';
import { Terrain, createShadeBaker, useBakedShade } from './terrain';
import { CYCLE_S, nightAmount, sunDirection } from './game/daycycle';

export type Quality = 'low'|'standard'|'high';
const lin=(r:number,g:number,b:number)=>new THREE.Color().setRGB(r,g,b,THREE.LinearSRGBColorSpace);
const smooth=(a:number,b:number,t:number)=>{const u=Math.max(0,Math.min(1,(t-a)/(b-a)));return u*u*(3-2*u);};
/** Beyond the walkable 560 m square: a rising ring of ridged, snow-capped mountains. */
export function outerHeight(x:number,z:number){
 const cx=Math.max(MIN,Math.min(MAX,x)),cz=Math.max(MIN,Math.min(MAX,z)),d=Math.hypot(x-cx,z-cz);
 if(d<=0)return rawHeight(cx,cz)-3;
 const ramp=smooth(0,160,d),r=ridged(x*.0045+3,z*.0045-2,5,41);
 return rawHeight(cx,cz)-.8+d*.25+ramp*(r*r*190+fbm(x*.015,z*.015,3,5)*18)+smooth(0,50,d)*fbm(x*.04,z*.04,3,9)*8;
}
/** Hull faces: octagon ring, perimeter-proportional U so decals never straddle a corner rib. */
export const HULL_RING=[[-1.86,3],[1.86,3],[2.5,2.34],[2.5,-2.34],[1.86,-3],[-1.86,-3],[-2.5,-2.34],[-2.5,2.34]];
export const HULL_U=(()=>{const len=HULL_RING.map((a,i)=>{const b=HULL_RING[(i+1)%8];return Math.hypot(b[0]-a[0],b[1]-a[1]);}),total=len.reduce((x,y)=>x+y,0);let u=0;return len.map(l=>{const r=[u/total,(u+l)/total,l] as [number,number,number];u+=l;return r;});})();

export function createWorld(scene:THREE.Scene){
 const rng=random(558),dummy=new THREE.Object3D(),color=new THREE.Color();
 const cache=new Map<string,THREE.MeshStandardMaterial>();
 const mat=(key:string,params:THREE.MeshStandardMaterialParameters)=>{if(!cache.has(key))cache.set(key,new THREE.MeshStandardMaterial(params));return cache.get(key)!;};
 const batch=new StaticBatch(),cube=new THREE.BoxGeometry(1,1,1);
 const box=(m:THREE.Material,x:number,y:number,z:number,w:number,h:number,d:number,ry=0,rz=0,rx=0)=>batch.add(cube,m,x,y,z,w,h,d,rx,ry,rz);
 const noShadow=new Set<THREE.Material>();

 // ---------- Materials ----------
 const hullTex=hullTextures(HULL_U);
 const hull=mat('hull',{map:hullTex.map,normalMap:hullTex.normalMap,normalScale:new THREE.Vector2(.7,.7),roughness:.55,metalness:.18});
 const linerMap=panelTexture();linerMap.repeat.set(9,2);
 const liner=mat('liner',{map:linerMap,color:'#858d89',roughness:.9,envMapIntensity:.2});liner.side=THREE.BackSide;
 const frame=mat('frame',{color:'#2a3336',roughness:.5,metalness:.55});
 const steel=mat('steel',{color:'#a9b0b0',roughness:.32,metalness:.85});
 const burnt=mat('burnt',{color:'#3a3531',roughness:.7,metalness:.5});
 const orange=mat('orange',{color:'#c9682c',roughness:.45,metalness:.2});
 const grateTex=gratingTexture();grateTex.repeat.set(3.5,4.2);
 const grate=mat('grate',{map:grateTex,roughness:.6,metalness:.6});
 const floorTex=grateTex.clone();floorTex.repeat.set(1,1);floorTex.needsUpdate=true;const floorGrate=mat('floorGrate',{map:floorTex,roughness:.55,metalness:.6});
 const warm=mat('warm',{color:'#ffe2b0',emissive:'#ffb866',emissiveIntensity:2.6});noShadow.add(warm);
 const cool=mat('cool',{color:'#7fd6d0',emissive:'#5cc9c2',emissiveIntensity:1.4});noShadow.add(cool);
 const beacon=mat('beacon',{color:'#ff9a4a',emissive:'#ff7a2a',emissiveIntensity:2});noShadow.add(beacon);
 const redLight=mat('red',{color:'#ff5040',emissive:'#ff2a1a',emissiveIntensity:3});noShadow.add(redLight);
 const holo=mat('holo',{color:'#6fd8d0',emissive:'#3fc4bb',emissiveIntensity:1.4,transparent:true,opacity:.6,depthWrite:false});noShadow.add(holo);
 const glass=mat('glass',{color:'#1b2a2e',roughness:.08,metalness:.4,emissive:'#6b4a22',emissiveIntensity:.5});
 const fabric=mat('fabric',{color:'#6f8472',roughness:.95});
 const rock=mat('rock',{vertexColors:true,flatShading:true,roughness:.93});
 const cliffRock=mat('cliffRock',{vertexColors:true,flatShading:true,roughness:.95});
 const ice=mat('ice',{vertexColors:true,flatShading:true,color:'#cfe6ec',roughness:.14,metalness:0,envMapIntensity:1.6});
 const iron=mat('iron',{color:'#4a5763',roughness:.34,metalness:.8,flatShading:true});
 const copper=mat('copper',{color:'#b8703f',roughness:.36,metalness:.78,flatShading:true});
 const caveInner=mat('caveInner',{color:'#1d2224',roughness:1,side:THREE.DoubleSide,flatShading:true});
 const screen=consoleScreen();
 const screenMat=mat('screen',{map:screen.texture,emissiveMap:screen.texture,emissive:'#ffffff',emissiveIntensity:1.1,roughness:.3});noShadow.add(screenMat);

 // ---------- Terrain: chunked, 1 m collision grid near the viewer ----------
 const ground=groundTextures();ground.map.repeat.set(1,1);
 const terrainMat=new THREE.MeshStandardMaterial({vertexColors:true,map:ground.map,normalMap:ground.normalMap,normalScale:new THREE.Vector2(.9,.9),roughness:.96});
 const antiTile=(s:THREE.WebGLProgramParametersWithUniforms)=>{s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>',`#ifdef USE_MAP
  vec4 t1=texture2D(map,vMapUv);vec4 t2=texture2D(map,vMapUv*.23+vec2(.31,.17));diffuseColor.rgb*=mix(t1.rgb,t2.rgb,.45)*1.18;
 #endif`);};
 const P=[['#9b7a58','dust'],['#86694d','earth'],['#6e655c','gravel'],['#b1946f','path'],['#8a7d6c','silt'],['#e7ecee','snow'],['#4d4642','rock'],['#6a4a3a','redrock'],['#b9a583','sand']] as const;
 const C=Object.fromEntries(P.map(([h,k])=>[k,new THREE.Color(h)])) as Record<string,THREE.Color>;
 const paths=[[40,44,43,56],[43,56,62,63],[62,63,80,56],[40,44,56,45],[62,63,30,79],[80,56,110,72],[80,56,104,-40],[30,79,-40,140]];
 const tmpC=new THREE.Color();
 const groundColor=(x:number,z:number,h:number,slope:number,out:THREE.Color)=>{
  out.copy(C.dust).lerp(C.earth,smooth(-.3,.4,fbm(x*.035,z*.035,3,2)));
  out.lerp(C.gravel,smooth(.18,.5,fbm(x*.09+4,z*.09,3,6))*.8);
  let p=Infinity;for(const q of paths)p=Math.min(p,segDist(x,z,q[0],q[1],q[2],q[3]));
  out.lerp(C.path,smooth(2.4,.6,p+noise2(x*.5,z*.5,3)*.6)*.5);
  const silt=smooth(16,10,Math.hypot((x-100)*.9,z-132));out.lerp(C.silt,silt);
  if(silt>0)out.lerp(tmpC.set('#cbbfa8'),smooth(.3,0,Math.abs(silt-.35))*.5);
  const cf=smooth(CRATER.r-14,CRATER.r-26,Math.hypot(x-CRATER.x,z-CRATER.z));out.lerp(tmpC.set('#b39c7b'),cf*.7);
  const cn=Math.abs(canyonDist(x,z));out.lerp(C.sand,smooth(7,3,cn)*.75);
  out.multiplyScalar(1-smooth(8,3,Math.hypot(x-40,z-40.5))*.32*(0.7+.3*noise2(x,z,5)));
  // Exposed rock on steep ground, with strata on scarps (mesa, canyon, crater rim).
  const steep=smooth(.22,.55,slope);
  if(steep>0){tmpC.copy(C.rock).lerp(C.redrock,smooth(-.2,.6,Math.sin(h*1.4+fbm(x*.05,z*.05,2,9)*3))*.55);out.lerp(tmpC,steep*.85);}
  // Snow: high ground and gentle north-facing hollows; ice pocket in the valley.
  const snow=Math.max(smooth(15,8,Math.hypot(x-30,z-80)+fbm(x*.15,z*.15,2,4)*6),smooth(38,60,h+fbm(x*.03,z*.03,3,3)*14)*smooth(.6,.25,slope)*.55);
  out.lerp(C.snow,snow);
  out.multiplyScalar(.93+noise2(x*.7,z*.7,19)*.07);
  return out;
 };
 const bakeUniforms={uBake:{value:null as unknown as THREE.Texture},uBake2:{value:null as unknown as THREE.Texture},uBakeMix:{value:0},uBakeMin:{value:new THREE.Vector2()},uBakeSize:{value:new THREE.Vector2(1,1)},uBakeAmount:{value:1}};
 useBakedShade(terrainMat,bakeUniforms,antiTile);
 const terrain=new Terrain(terrainMat,groundColor);scene.add(terrain.group);
 // ---------- Outer mountains beyond the walkable square ----------
 {
  const step=12,min=MIN-480,max=MAX+480,n=Math.round((max-min)/step)+1,pos:number[]=[],col:number[]=[],uv:number[]=[],idx:number[]=[],hh:number[]=[];
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const x=min+i*step,z=min+j*step;hh.push(outerHeight(x,z));}
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
   const x=min+i*step,z=min+j*step,h=hh[j*n+i];
   const sx=(hh[j*n+Math.min(n-1,i+1)]-hh[j*n+Math.max(0,i-1)])/(2*step),sz=(hh[Math.min(n-1,j+1)*n+i]-hh[Math.max(0,j-1)*n+i])/(2*step),slope=Math.hypot(sx,sz);
   pos.push(x,h,z);uv.push(x/2.6,z/2.6);
   color.copy(C.dust).lerp(C.rock,smooth(.15,.6,slope)).lerp(tmpC.set('#403c3a'),smooth(.7,1.3,slope)*.7);
   color.lerp(C.snow,smooth(95,150,h+fbm(x*.02,z*.02,3,3)*40)*smooth(1.1,.5,slope)*.75);
   color.multiplyScalar(.9+noise2(x*.08,z*.08,7)*.1);col.push(color.r,color.g,color.b);
  }
  const inside=(x:number,z:number)=>x>MIN+step&&x<MAX-step&&z>MIN+step&&z<MAX-step;
  for(let j=0;j<n-1;j++)for(let i=0;i<n-1;i++){const a=j*n+i,x=min+i*step,z=min+j*step;if(inside(x,z)&&inside(x+step,z+step))continue;idx.push(a,a+n,a+1,a+1,a+n,a+n+1);}
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
 // Large formations outside the valley (colliders in world.ts). They do not cast shadow-map shadows:
 // their shadows are baked into the ground (createShadeBaker), so they never pop at the frustum edge.
 for(const [i,f] of FORMATIONS.entries())batch.add(cliffs[f.shape],cliffRock,f.x,f.base-1.2,f.z,f.w,f.h+1.2,f.d,0,f.rotation,0,i%2?'#d4d2cf':'#ffffff');
 // Twin spires — the valley's signature landmark: two leaning slabs with rubble.
 for(const [x,z,hh,w,lean,ry] of [[100,103,19,2.7,.07,.3],[106.5,104.2,14.5,2.2,-.1,1.2]]){
  batch.add(tall,rock,x,heightAt(x,z)-.4,z,w,hh,w*.8,lean*.5,ry,lean,'#e6e0d6');
  for(let k=0;k<7;k++){const a=rng()*6.28,d=2+rng()*2.5,px=x+Math.cos(a)*d,pz=z+Math.sin(a)*d;batch.add(boulders[k%6],rock,px,heightAt(px,pz)-.1,pz,.5+rng()*.9,.4+rng()*.8,.5+rng()*.8,0,rng()*6,0);}
 }
 // Pebbles: instanced, receive shadows only.
 {
  const peb=chiseledRock(7,{detail:0,cuts:5});const count=2600;
  const inst=new THREE.InstancedMesh(peb,rock,count);let k=0;const pr=random(77);
  while(k<count){
   const near=pr()<.55&&ROCKS.length?ROCKS[Math.floor(pr()*ROCKS.length)]:null;
   const wide=pr()<.45,x=near?near.x+(pr()-.5)*near.s*4:wide?MIN+10+pr()*(SIZE-20):6+pr()*148,z=near?near.z+(pr()-.5)*near.s*4:wide?MIN+10+pr()*(SIZE-20):6+pr()*148;
   if(x>36.5&&x<43.5&&z>36.5&&z<44.2)continue;if(x>112&&x<134&&z>68&&z<76)continue;
   const s=.04+pr()*pr()*.32;dummy.position.set(x,heightAt(x,z)-s*.25,z);dummy.rotation.set(pr(),pr()*6,pr());dummy.scale.set(s*(1+pr()),s*(.6+pr()*.6),s*(1+pr()));dummy.updateMatrix();inst.setMatrixAt(k,dummy.matrix);
   inst.setColorAt(k,color.set(tones[k%4]).multiplyScalar(.8+pr()*.3));k++;
  }
  inst.receiveShadow=true;scene.add(inst);
 }

 // ---------- Landing capsule ----------
 const h=heightAt(40,40),cy=(y:number)=>h+y,X=40,Z=40;
 const ring=HULL_RING;
 const levels=[[.15,1],[1.4,.985],[2.3,.955],[2.9,.93],[3.55,.84],[4.05,.66],[4.35,.46]];
 const pt=(p:number[],y:number,inset:number,s=1)=>[X+p[0]*inset*s,cy(y),Z+p[1]*inset*s];
 const DOOR=.95;
 for(const [material,scale] of [[hull,1],[liner,.965]] as const){
  for(let i=0;i<8;i++){
   const a=ring[i],b=ring[(i+1)%8],u0=HULL_U[i][0],uw=HULL_U[i][1]-u0,u1=u0+uw;
   for(let l=0;l<levels.length-1;l++){
    const [y0,k0]=levels[l],[y1,k1]=levels[l+1],v0=y0/4.35,v1=y1/4.35;
    const lerp=(p:number[],q:number[],t:number)=>[p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t];
    if(i===0&&y1<=2.3){
     // Door opening in the front face: left and right jambs only.
     for(const [s0,s1] of [[0,(1-DOOR/(1.86*k0))/2],[(1+DOOR/(1.86*k0))/2,1]]){
      const s0b=s0===0?0:(1+DOOR/(1.86*k1))/2,s1b=s1===1?1:(1-DOOR/(1.86*k1))/2;
      batch.add(quad(pt(lerp(a,b,s0),y0,k0,scale),pt(lerp(a,b,s1),y0,k0,scale),pt(lerp(a,b,s1b),y1,k1,scale),pt(lerp(a,b,s0b),y1,k1,scale),[[u0+uw*s0,v0],[u0+uw*s1,v0],[u0+uw*s1b,v1],[u0+uw*s0b,v1]]),material);
     }
     continue;
    }
    batch.add(quad(pt(a,y0,k0,scale),pt(b,y0,k0,scale),pt(b,y1,k1,scale),pt(a,y1,k1,scale),[[u0,v0],[u1,v0],[u1,v1],[u0,v1]]),material);
   }
   if(material===hull){
    // Ribs at the corners follow the tapering shell.
    for(let l=0;l<levels.length-1;l++){const [y0,k0]=levels[l],[y1,k1]=levels[l+1];batch.add(beam(new THREE.Vector3(...pt(a,y0,k0,1.012)),new THREE.Vector3(...pt(a,y1,k1,1.012)),.09),frame);}
    batch.add(quad(pt(a,-.05,1.05),pt(b,-.05,1.05),pt(b,.5,1.02),pt(a,.5,1.02)),burnt);
   }
  }
  // Close the roof over the whole top octagon (both sides, so it is solid from outside and from the cabin).
 const top=levels[levels.length-1],c=[X,cy(top[0]),Z];
 for(let i=0;i<8;i++){const pa=pt(ring[i],top[0],top[1],scale),pb=pt(ring[(i+1)%8],top[0],top[1],scale);batch.add(quad(pa,pb,c,c),material);batch.add(quad(c,c,pb,pa),material);}
 }
 // Door frame, warm light strip.
 for(const s of [-1,1]){box(frame,X+s*1.0,cy(1.22),Z+2.98,.14,2.2,.32);box(orange,X+s*1.09,cy(1.25),Z+3.1,.05,1.9,.04);box(frame,X+s*1.0,cy(1.22),Z+2.74,.18,2.2,.12);}
 box(frame,X,cy(2.36),Z+2.98,2.14,.16,.34);box(warm,X,cy(2.25),Z+3.1,1.7,.05,.05);box(frame,X,cy(2.36),Z+2.74,2.1,.14,.12);
 // Ramp with grating and rails.
 {
  const r0=new THREE.Vector3(X,cy(.2),Z+3.3),r1=new THREE.Vector3(X,heightAt(X,Z+5.6)+.03,Z+5.6);
  const len=r0.distanceTo(r1),ang=Math.atan2(r0.y-r1.y,r1.z-r0.z);
  batch.add(new THREE.BoxGeometry(1.9,.06,len),grate,X,(r0.y+r1.y)/2,(r0.z+r1.z)/2,1,1,1,ang,0,0);
  for(const s of [-1,1]){batch.add(beam(new THREE.Vector3(X+s*.98,r0.y+.02,r0.z),new THREE.Vector3(X+s*.98,r1.y+.02,r1.z),.07,.12),orange);}
  box(frame,X,cy(.09),Z+3.45,2.1,.18,.4);
 }
 // Landing legs: strut, polished piston, pad. Upper mounts sit on the hull skin, never inside the cabin.
 for(const sx of [-1,1])for(const zz of [-2.1,2.1]){
  const top=new THREE.Vector3(X+sx*2.56,cy(1.7),Z+zz),foot=new THREE.Vector3(X+sx*3.35,heightAt(X+sx*3.35,Z+zz*1.12)+.14,Z+zz*1.12);
  const mid=top.clone().lerp(foot,.45);
  batch.add(rod(top,mid,.13),frame);batch.add(rod(mid,foot,.08),steel);
  batch.add(rod(new THREE.Vector3(X+sx*2.6,cy(.6),Z+zz),mid,.05),steel);box(frame,X+sx*2.55,cy(1.7),Z+zz,.12,.36,.36);
  batch.add(new THREE.CylinderGeometry(.42,.5,.14,14),frame,foot.x,foot.y-.05,foot.z);box(orange,foot.x,foot.y+.04,foot.z,.3,.05,.3);
 }
 // Portholes on both flanks (outer bezel + inner trim ring).
 for(const s of [-1,1]){
  batch.add(new THREE.TorusGeometry(.34,.07,8,20),frame,X+s*2.46,cy(2.25),Z-.2,1,1,1,0,Math.PI/2,0);
  batch.add(new THREE.CircleGeometry(.33,20),glass,X+s*2.44,cy(2.25),Z-.2,1,1,1,0,s*Math.PI/2,0);
  batch.add(new THREE.TorusGeometry(.36,.06,8,20),frame,X+s*2.29,cy(2.25),Z-.2,1,1,1,0,Math.PI/2,0);
  batch.add(new THREE.CircleGeometry(.33,20),glass,X+s*2.31,cy(2.25),Z-.2,1,1,1,0,-s*Math.PI/2,0);
  box(frame,X+s*2.47,cy(1.05),Z+1.2,.04,.8,1.1);for(let i=0;i<5;i++)box(steel,X+s*2.5,cy(.78+i*.13),Z+1.2,.03,.05,.95);
  // RCS thruster blocks sit proud of the shoulder skin.
  box(frame,X+s*2.29,cy(3.55),Z-1.6,.26,.3,.4);batch.add(new THREE.CylinderGeometry(.05,.09,.18,8),burnt,X+s*2.47,cy(3.55),Z-1.6,1,1,1,0,0,s*Math.PI/2);
 }
 // Roof: hatch, radiator, antenna mast with blinking light and a small dish.
 batch.add(new THREE.CylinderGeometry(.48,.52,.18,16),frame,X,cy(4.45),Z);batch.add(new THREE.CylinderGeometry(.34,.34,.08,16),steel,X,cy(4.57),Z);
 for(let i=0;i<7;i++)box(steel,X-.9,cy(4.12),Z-.9+i*.3,.05,.12,.22,0,.5);
 batch.add(rod(new THREE.Vector3(X+.9,cy(3.9),Z-.9),new THREE.Vector3(X+.9,cy(6.1),Z-.9),.035,6),frame);
 box(redLight,X+.9,cy(6.15),Z-.9,.09,.09,.09);
 batch.add(new THREE.SphereGeometry(.28,12,6,0,Math.PI*2,0,Math.PI/2.4),steel,X+.9,cy(5.2),Z-.9,1,1,1,Math.PI*.6,0,0);

 // ---------- Capsule interior ----------
 {
  const rb=(w:number,hh:number,d:number,r:number)=>new RoundedBoxGeometry(w,hh,d,2,r);
  const panelDark=mat('panelDark',{color:'#2c3538',roughness:.6,metalness:.4});
  const rubber=mat('rubber',{color:'#1d2224',roughness:.9});
  const white=mat('whitePlastic',{color:'#d7d9d3',roughness:.55});
  const strap=mat('strap',{color:'#b8622c',roughness:.8});
  const cushion=mat('cushion',{color:'#5f6f66',roughness:.95});
  // Floor: octagonal grating that meets the walls everywhere (B3 showed sand at the corners).
  {const fv:number[]=[],fu:number[]=[],k=.955;for(let i=0;i<8;i++){const a=ring[i],b=ring[(i+1)%8];for(const p of [[0,0],a,b]){const x=X+p[0]*k,z=Z+p[1]*k;fv.push(x,cy(.16),z);fu.push(x/1.1,z/1.1);}}
   const g=surface(fv,undefined,fu);batch.add(g,floorGrate);}
  // Kick plate and a handrail band around the cabin.
  for(let i=0;i<8;i++){const a=ring[i],b=ring[(i+1)%8];if(i===0)continue;
   batch.add(quad(pt(a,.16,.95),pt(b,.16,.95),pt(b,.5,.945),pt(a,.5,.945)),panelDark);
   batch.add(quad(pt(a,.5,.947),pt(b,.5,.947),pt(b,.53,.946),pt(a,.53,.946)),steel);}
  // Ceiling: service beams, light panel and cable runs.
  for(const z of [38.2,39.9,41.6])box(frame,X,cy(3.9),z,3.1,.08,.1);
  box(frame,X,cy(3.97),Z,.9,.05,2.4);box(warm,X,cy(3.93),Z,.7,.02,2.1);
  batch.add(new THREE.TorusGeometry(1.15,.035,6,40),cool,X,cy(3.72),Z,1,1,1,Math.PI/2,0,0);
  for(const s of [-1,1])batch.add(rod(new THREE.Vector3(X+s*1.55,cy(3.62),37.6),new THREE.Vector3(X+s*1.55,cy(3.62),42.3),.035,6),rubber);
  // Berth on the left wall: frame, drawers, mattress, pillow, folded blanket, straps, shelf and lamp.
  box(frame,38.12,cy(.42),39.5,.8,.52,2.5);
  for(let i=0;i<2;i++){box(panelDark,38.53,cy(.42),38.85+i*1.3,.02,.38,1.1);box(steel,38.55,cy(.46),38.85+i*1.3,.03,.04,.4);}
  batch.add(rb(.76,.18,2.42,.06),cushion,38.12,cy(.77),39.5);
  batch.add(rb(.58,.12,.4,.05),white,38.12,cy(.92),38.52);
  batch.add(rb(.74,.07,.9,.03),mat('blanket',{color:'#9a6b45',roughness:.95}),38.12,cy(.89),40.35);
  for(const z of [39.2,40.0])box(strap,38.12,cy(.87),z,.8,.02,.07);
  box(frame,37.84,cy(1.5),39.1,.3,.04,1.5);box(frame,37.84,cy(1.44),38.4,.3,.12,.03);box(frame,37.84,cy(1.44),39.8,.3,.12,.03);
  box(white,37.84,cy(1.6),38.7,.22,.16,.26);batch.add(new THREE.CylinderGeometry(.06,.06,.2,10),steel,37.84,cy(1.62),39.2);box(mat('book',{color:'#35505a',roughness:.8}),37.84,cy(1.58),39.55,.2,.12,.08);
  box(warm,37.72,cy(1.32),40.55,.04,.08,.22);box(frame,37.7,cy(1.32),40.55,.04,.14,.3);
  // Back wall: console with bezel, keyboard deck, status lights and cable loom.
  box(frame,41.35,cy(.66),37.75,1.3,1.1,.6);
  batch.add(rb(1.3,.7,.12,.03),panelDark,41.35,cy(1.55),37.5,1,1,1,-.12,0,0);
  batch.add(new THREE.PlaneGeometry(1.02,.51),screenMat,41.35,cy(1.56),37.575,1,1,1,-.12,0,0);
  box(steel,41.35,cy(1.22),38.02,1.28,.05,.42,0,0,-.1);
  for(let r=0;r<2;r++)for(let i=0;i<8;i++)box(i===7&&r===0?orange:rubber,40.88+i*.135,cy(1.26),37.93+r*.13,.1,.03,.08,0,0,-.1);
  for(let i=0;i<3;i++)box(i===1?beacon:cool,41.96,cy(1.0-i*.14),38.06,.05,.05,.02);
  box(panelDark,41.35,cy(.55),38.06,1.1,.6,.02);for(let i=0;i<4;i++)box(steel,41.35,cy(.35+i*.12),38.075,.9,.02,.01);
  for(const dx of [-.4,-.33,.35])batch.add(rod(new THREE.Vector3(41.35+dx,cy(1.9),37.45),new THREE.Vector3(41.35+dx,cy(3.6),37.6),.025,6),rubber);
  // Oxygen bottle rack with clamps and regulators (visual only; no simulated oxygen).
  box(frame,39.15,cy(.2),37.55,1.02,.08,.46);
  for(let i=0;i<2;i++){
   const bx=38.9+i*.49;
   batch.add(new THREE.CylinderGeometry(.19,.19,.98,20),steel,bx,cy(.72),37.55);batch.add(new THREE.SphereGeometry(.19,20,10,0,Math.PI*2,0,Math.PI/2),steel,bx,cy(1.21),37.55);
   batch.add(new THREE.CylinderGeometry(.055,.055,.15,8),frame,bx,cy(1.43),37.55);box(orange,bx,cy(1.51),37.55,.17,.04,.09);batch.add(new THREE.CylinderGeometry(.05,.05,.04,10),steel,bx,cy(1.36),37.72,1,1,1,Math.PI/2,0,0);
   for(const y of [.5,1.0])batch.add(new THREE.TorusGeometry(.2,.025,6,20),frame,bx,cy(y),37.55,1,1,1,Math.PI/2,0,0);
   box(orange,bx,cy(.85),37.745,.22,.1,.01);
  }
  box(frame,39.15,cy(1.0),37.3,1.02,.08,.06);
  // Tall locker between bottles and console.
  box(panelDark,40.2,cy(1.3),37.42,.62,2.2,.28);box(white,40.2,cy(1.3),37.565,.54,2.08,.02);
  for(let i=0;i<6;i++)box(frame,40.2,cy(2.05+i*.05),37.58,.36,.015,.01);
  box(steel,40.42,cy(1.25),37.59,.03,.34,.03);box(orange,40.2,cy(.4),37.58,.54,.05,.01);
  // Right wall: equipment rack with cases, first-aid kit and the EVA helmet.
  for(const z of [39.1,40.9])box(frame,41.98,cy(1.0),z,.06,1.7,.06);
  for(const y of [.35,.95,1.55])box(frame,41.98,cy(y),40,.5,.04,1.86);
  box(mat('caseA',{color:'#5d6b62',roughness:.7,metalness:.3}),41.98,cy(.52),39.55,.42,.3,.7);box(mat('caseB',{color:'#3f4a4e',roughness:.6,metalness:.3}),41.98,cy(.5),40.45,.42,.26,.6);
  box(white,41.98,cy(1.1),39.5,.36,.26,.46);box(strap,41.79,cy(1.1),39.5,.01,.18,.06);box(strap,41.79,cy(1.1),39.5,.01,.06,.18);
  box(mat('caseC',{color:'#6c5b44',roughness:.8}),41.98,cy(1.08),40.4,.4,.22,.7);
  batch.add(new THREE.SphereGeometry(.18,20,14),white,41.95,cy(1.76),39.8);
  batch.add(new THREE.SphereGeometry(.17,20,10,-Math.PI*.35,Math.PI*.7,Math.PI*.3,Math.PI*.38),mat('visor',{color:'#2a2f33',roughness:.05,metalness:.9,emissive:'#3a2a12',emissiveIntensity:.25}),41.95,cy(1.77),39.8,1.03,1.03,1.03,0,0,0);
  batch.add(new THREE.TorusGeometry(.14,.03,8,18),frame,41.95,cy(1.6),39.8,1,1,1,Math.PI/2,0,0);
  // Handrails by the door.
  for(const s of [-1,1])batch.add(rod(new THREE.Vector3(X+s*1.25,cy(.9),42.55),new THREE.Vector3(X+s*1.25,cy(2.0),42.55),.025,8),steel);
 }
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
 // ---------- Ice pocket: buried slabs, leaning shards and frost rubble ----------
 {
  const slab=(i:number)=>chiseledRock(300+i,{detail:2,base:'#ffffff',dust:'#f4fbff',dark:'#6f98a8',cuts:7,flatTop:.45,lumpy:.12});
  const shard=(i:number)=>chiseledRock(340+i,{detail:1,base:'#ffffff',dust:'#ffffff',dark:'#7fa6b4',cuts:6,taper:.72,lumpy:.06});
  for(let i=0;i<9;i++){const a=i/9*6.28+rng()*.5,d=1.5+rng()*4.5,x=30+Math.cos(a)*d,z=80+Math.sin(a)*d;
   batch.add(slab(i),ice,x,heightAt(x,z)-.25,z,.8+rng()*1.3,.35+rng()*.5,.7+rng()*1.1,(rng()-.5)*.25,rng()*6,(rng()-.5)*.25);}
  for(let i=0;i<7;i++){const a=rng()*6.28,d=2+rng()*5,x=30+Math.cos(a)*d,z=80+Math.sin(a)*d,lean=.18+rng()*.25;
   batch.add(shard(i),ice,x,heightAt(x,z)-.2,z,.28+rng()*.3,1+rng()*1.4,.25+rng()*.25,Math.cos(a)*lean,rng()*6,-Math.sin(a)*lean);}
  for(let i=0;i<26;i++){const a=rng()*6.28,d=rng()*8,x=30+Math.cos(a)*d,z=80+Math.sin(a)*d,s=.08+rng()*.18;
   batch.add(boulders[i%6],ice,x,heightAt(x,z)-s*.3,z,s,s*.6,s,0,rng()*6,0,'#e8f4f8');}
 }
 // ---------- Mineable deposits (S1): each node is its own group so it shrinks as it is mined ----------
 const nodeGroups=new Map<string,THREE.Group>();
 const deposit=(id:string,x:number,z:number,build:(b:StaticBatch)=>void)=>{const b=new StaticBatch();build(b);const g=new THREE.Group();g.name='node-'+id;g.position.set(x,heightAt(x,z),z);b.finish(g);scene.add(g);nodeGroups.set(id,g);};
 {
  const I=oreOutcrop(610,{strata:3,base:'#4a4038',dust:'#8a6a50',dark:'#2a2320'},{freq:2.2,width:.05,blobs:.74,lift:.018,crystals:.12,stain:'#7a3f22'});
  deposit('iron-a',67,65,b=>{b.add(I.host,rock,0,-.1,0,1.8,1.7,1.5,0,.3,0);b.add(I.veins,iron,0,-.1,0,1.8,1.7,1.5,0,.3,0);});
  const I2=oreOutcrop(611,{strata:2,base:'#4a4038',dust:'#8a6a50',dark:'#2a2320'},{freq:2.6,width:.045,blobs:.76,lift:.018,crystals:.1,stain:'#7a3f22'});
  deposit('iron-b',69.1,63.8,b=>{b.add(I2.host,rock,0,-.08,0,.8,.7,.7,0,1.9,0);b.add(I2.veins,iron,0,-.08,0,.8,.7,.7,0,1.9,0);});
  const C=oreOutcrop(620,{strata:2,base:'#3c4640',dust:'#6f8f7c',dark:'#232a27'},{freq:1.8,width:.045,blobs:.72,lift:.02,crystals:.22,stain:'#3f8f78'});
  deposit('copper-a',83,55,b=>{b.add(C.host,rock,0,-.1,0,1.8,1.6,1.5,0,.9,0);b.add(C.veins,copper,0,-.1,0,1.8,1.6,1.5,0,.9,0);});
  const C2=oreOutcrop(622,{strata:2,base:'#3c4640',dust:'#6f8f7c',dark:'#232a27'},{freq:2.4,width:.05,blobs:.74,lift:.02,crystals:.2,stain:'#3f8f78'});
  deposit('copper-b',81.1,56.1,b=>{b.add(C2.host,rock,0,-.08,0,.9,.6,.8,0,2.4,0);b.add(C2.veins,copper,0,-.08,0,.9,.6,.8,0,2.4,0);});
  // Scree heap of loose blocks beside the capsule: the guaranteed stone.
  deposit('stone-a',30,52,b=>{const pr=random(5203);b.add(boulders[2],rock,0,-.12,0,1.15,.95,1.05,0,.4,0,'#b9ad9c');
   for(let i=0;i<9;i++){const a=i/9*6.28+pr()*.5,d=.8+pr()*.6,s=.28+pr()*.3;b.add(boulders[i%6],rock,Math.cos(a)*d,-.08,Math.sin(a)*d,s*1.2,s,s*1.1,0,pr()*6,0,i%2?'#a89c8c':'#c2b6a4');}});
  // A free-standing block of clear ice at the rim of the frozen hollow.
  deposit('ice-a',33,76.5,b=>{const pr=random(7310);
   for(let i=0;i<5;i++){const g=chiseledRock(330+i,{detail:2,base:'#ffffff',dust:'#f4fbff',dark:'#6f98a8',cuts:7,flatTop:.7,lumpy:.1}),a=i*1.3,d=i?.55:0,s=i?.45+pr()*.2:.9;b.add(g,ice,Math.cos(a)*d,-.15,Math.sin(a)*d,s,s*(i?1.1:1.25),s*.9,(pr()-.5)*.3,pr()*6,(pr()-.5)*.3);}});
 }
 deposit('sand-a',49,59,b=>{b.add(boulders[2],rock,0,-.12,0,1.5,.45,1.3,0,.2,0,'#d3bb82');});
 for(const [id,x,z] of [['grass-a',52,67],['grass-b',54,70]] as const)deposit(id,x,z,b=>{const pr=random(x*100+z);for(let i=0;i<24;i++){const a=pr()*6.28,r=pr()*1.3;b.add(boulders[0],rock,Math.cos(a)*r,.28,Math.sin(a)*r,.12,.45+pr()*.3,.12,0,a,0,i%2?'#879a4f':'#abb95a');}});
 const setNodeAmount=(id:string,left:number,amount:number)=>{const g=nodeGroups.get(id);if(!g)return;g.visible=left>0;g.scale.setScalar(.42+.58*Math.max(0,left)/amount);};
 {
 // Loose weathered pieces resting on the ground (sunk slightly, never hovering).
  for(const [ox,oz,m] of [[67,65,iron],[83,55,copper]] as const)for(let i=0;i<7;i++){const a=rng()*6.28,d=1.6+rng()*1.8,px=ox+Math.cos(a)*d,pz=oz+Math.sin(a)*d,s=.1+rng()*.14;
   const piece=oreOutcrop(900+i+(m===iron?0:20),{detail:1,cuts:7},{freq:3,width:.1,blobs:.6,lift:.01,crystals:0}),ry=rng()*6,py=heightAt(px,pz)-s*.35;batch.add(piece.host,rock,px,py,pz,s,s*.8,s,0,ry,0,m===iron?'#8a7466':'#6f8a80');batch.add(piece.veins,m,px,py,pz,s,s*.8,s,0,ry,0);}
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
  const grassMat=m;grassMat.onBeforeCompile=s=>{s.uniforms.uWind=windUniform;s.vertexShader='attribute float sway;uniform float uWind;\n'+s.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
   vec3 ip=instanceMatrix[3].xyz;float w=sway*sway;transformed.x+=sin(uWind*1.6+ip.x*.35+ip.z*.2)*.07*w;transformed.z+=cos(uWind*1.2+ip.x*.2)*.05*w;`);};
  useBakedShade(grassMat,bakeUniforms,grassMat.onBeforeCompile);
  const inst=new THREE.InstancedMesh(g,m,GRASS.length);
  GRASS.forEach((p,i)=>{dummy.position.set(p.x,heightAt(p.x,p.z)-.02,p.z);dummy.scale.setScalar(p.s*1.35);dummy.rotation.set(0,p.rotation,0);dummy.updateMatrix();inst.setMatrixAt(i,dummy.matrix);inst.setColorAt(i,color.setHSL(.2+rng()*.06,.12+rng()*.1,.62+rng()*.3));});
  inst.receiveShadow=true;inst.castShadow=true;scene.add(inst);
 }
 const meshes=batch.finish(scene,m=>({cast:!noShadow.has(m)&&m!==caveInner&&m!==cliffRock,receive:!noShadow.has(m)}));
 for(const m of cache.values())if(!noShadow.has(m))useBakedShade(m,bakeUniforms);

 // ---------- Sky, light, fog, atmosphere ----------
 const sky=createSky();scene.add(sky.mesh);
 const dust=createDust(260);scene.add(dust.points);
 const hemi=new THREE.HemisphereLight('#bcd3dc','#8a7358',1.15);scene.add(hemi);
 const sun=new THREE.DirectionalLight('#ffd9a8',3.4);sun.castShadow=true;scene.add(sun,sun.target);
 const sc=sun.shadow.camera;sc.left=-42;sc.right=42;sc.top=42;sc.bottom=-42;sc.near=1;sc.far=260;sun.shadow.bias=-.0004;sun.shadow.normalBias=.04;
 const doorLight=new THREE.PointLight('#ffb870',9,13,1.7);doorLight.position.set(40,cy(1.8),43.8);scene.add(doorLight);
 const interior=new THREE.PointLight('#ffd3a0',3.2,6.5,1.6);interior.position.set(40,cy(3.3),39.8);scene.add(interior);
 const fog=new THREE.FogExp2(lin(.8,.68,.53),.0022);scene.fog=fog;
 const D={sun:new THREE.Color('#ffd9a8'),hemiSky:new THREE.Color('#bcd3dc'),hemiGround:new THREE.Color('#8a7358'),fog:lin(.8,.68,.53),dust:new THREE.Color('#fff1d6')};
 const N={sun:new THREE.Color('#8fa9d6'),hemiSky:new THREE.Color('#5f7896'),hemiGround:new THREE.Color('#2b2f36'),fog:lin(.07,.1,.15),dust:new THREE.Color('#a9c4e6')};
 const moon=new THREE.Vector3(.5,.55,.67).normalize(),sunTrue=new THREE.Vector3(),lightDir=new THREE.Vector3(),lastBake=new THREE.Vector3(),lastEnv=new THREE.Vector3();
 // Baked terrain/formation shade follows the moving sun: rebuilt a few rows per frame, then cross-faded.
 const baker=createShadeBaker([{x:100,z:103,r:3.2,top:heightAt(100,103)+18},{x:106.5,z:104.2,r:2.6,top:heightAt(106.5,104.2)+14},...[115,120,125,130,135].map(x=>({x,z:72,r:8,top:9.5}))]);
 bakeUniforms.uBakeMin.value.copy(baker.min);bakeUniforms.uBakeSize.value.copy(baker.size);
 let fading=false;
 /** Synchronous full bake (start-up and time skips). */
 function bakeNow(dir:THREE.Vector3){baker.begin(dir);baker.step(baker.N);const t=baker.flip();bakeUniforms.uBake.value=t;bakeUniforms.uBake2.value=t;bakeUniforms.uBakeMix.value=0;fading=false;lastBake.copy(dir);}
 let k=0,phase=-1,targetPhase=0,time=0,screenClock=0,envDirty=true,quality:Quality='standard';
 const pmremTarget:{rt:THREE.WebGLRenderTarget|null}={rt:null};
 const envScene=new THREE.Scene();const envSky=createSky();envScene.add(envSky.mesh);
 const warmNoon=new THREE.Color('#fff1dc');
 /** Applies the light of a day phase `t` (seconds in the 960 s Verdana cycle). */
 function applyPhase(t:number){
  const [x,y,z]=sunDirection(t);sunTrue.set(x,y,z);const v=nightAmount(t);k=v;
  // Directional light: the sun (kept just above the horizon in twilight), the moon at night.
  lightDir.copy(sunTrue);if(lightDir.y<.06){lightDir.y=.06;lightDir.normalize();}
  lightDir.lerp(moon,v).normalize();
  sky.uniforms.night.value=v;sky.uniforms.sunDir.value.copy(lightDir);
  const high=THREE.MathUtils.smoothstep(sunTrue.y,.15,.7);
  sun.color.copy(D.sun).lerp(warmNoon,high*.6).lerp(N.sun,v);sun.intensity=THREE.MathUtils.lerp(3.4*(.82+.18*high),.5,v);
  hemi.color.copy(D.hemiSky).lerp(N.hemiSky,v);hemi.groundColor.copy(D.hemiGround).lerp(N.hemiGround,v);hemi.intensity=THREE.MathUtils.lerp(1.15,.6,v);
  bakeUniforms.uBakeAmount.value=1-v;
  fog.color.copy(D.fog).lerp(N.fog,v);fog.density=THREE.MathUtils.lerp(.0022,.0038,v);
  dust.uniforms.tint.value.copy(D.dust).lerp(N.dust,v);dust.uniforms.opacity.value=THREE.MathUtils.lerp(.28,.22,v);
  doorLight.intensity=THREE.MathUtils.lerp(9,16,v);interior.intensity=THREE.MathUtils.lerp(3.2,4.2,v);
  warm.emissiveIntensity=THREE.MathUtils.lerp(2.6,3.4,v);glass.emissiveIntensity=THREE.MathUtils.lerp(.5,1.8,v);
  if(lightDir.angleTo(lastEnv)>.05){lastEnv.copy(lightDir);envDirty=true;}
 }
 const wrapS=(d:number)=>((d%CYCLE_S)+CYCLE_S*1.5)%CYCLE_S-CYCLE_S/2;
 /** Sets the day phase. Small steps follow the clock; a large jump (Sun/Moon skip, load) is animated over ≈1.5 s unless `instant`. */
 function setTime(t:number,instant=false){targetPhase=((t%CYCLE_S)+CYCLE_S)%CYCLE_S;if(instant||phase<0){phase=targetPhase;applyPhase(phase);bakeNow(lightDir);envDirty=true;}}
 function setQuality(q:Quality){quality=q;sun.castShadow=q!=='low';const size=q==='high'?2048:1024,ext=q==='high'?60:42;
  if(sun.shadow.mapSize.x!==size||sc.right!==ext){sun.shadow.mapSize.set(size,size);sc.left=sc.bottom=-ext;sc.right=sc.top=ext;sc.updateProjectionMatrix();sun.shadow.map?.dispose();sun.shadow.map=null as unknown as THREE.WebGLRenderTarget;}
  dust.points.visible=q!=='low';terrain.setQuality(q);}
 const snapped=new THREE.Vector3(),lx=new THREE.Vector3(),ly=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),fwd=new THREE.Vector3(),center=new THREE.Vector3();let terrainBudget=24;
 function update(dt:number,camera:THREE.Camera,renderer:THREE.WebGLRenderer){
  sky.mesh.position.copy(camera.position);time+=dt;windUniform.value=time;sky.uniforms.time.value=time;dust.uniforms.time.value=time;dust.uniforms.origin.value.copy(camera.position);
  if(phase!==targetPhase){const d=wrapS(targetPhase-phase);phase=Math.abs(d)<=Math.max(2,dt*320)?targetPhase:((phase+Math.sign(d)*dt*320)%CYCLE_S+CYCLE_S)%CYCLE_S;applyPhase(phase);}
  // Incremental re-bake when the light has turned by more than ~1.5°; then a 1.5 s cross-fade.
  if(fading){bakeUniforms.uBakeMix.value=Math.min(1,bakeUniforms.uBakeMix.value+dt/1.5);if(bakeUniforms.uBakeMix.value>=1){bakeUniforms.uBake.value=bakeUniforms.uBake2.value;bakeUniforms.uBakeMix.value=0;fading=false;}}
  else if(baker.busy){if(baker.step(10)){bakeUniforms.uBake2.value=baker.flip();bakeUniforms.uBakeMix.value=0;fading=true;}}
  else if(k<.98&&lightDir.angleTo(lastBake)>.026){lastBake.copy(lightDir);baker.begin(lightDir);}
  if(envDirty){envDirty=false;envSky.uniforms.night.value=sky.uniforms.night.value;envSky.uniforms.sunDir.value.copy(sky.uniforms.sunDir.value);const gen=new THREE.PMREMGenerator(renderer);const rt=gen.fromScene(envScene,0,.1,1000);gen.dispose();pmremTarget.rt?.dispose();pmremTarget.rt=rt;scene.environment=rt.texture;scene.environmentIntensity=THREE.MathUtils.lerp(.55,.25,k);}
  // Shadow frustum follows the viewer, shifted ahead of it and snapped to whole texels
  // *in light space* (B3 snapped world axes, which still shimmered while walking).
  const L=sky.uniforms.sunDir.value as THREE.Vector3;lx.crossVectors(up,L).normalize();ly.crossVectors(L,lx);
  camera.getWorldDirection(fwd);fwd.y=0;if(fwd.lengthSq()>1e-6)fwd.normalize();
  center.copy(camera.position).addScaledVector(fwd,sc.right*.45);
  const texel=(sc.right-sc.left)/sun.shadow.mapSize.x,px=Math.round(center.dot(lx)/texel)*texel,py=Math.round(center.dot(ly)/texel)*texel,pz=center.dot(L);
  snapped.copy(lx).multiplyScalar(px).addScaledVector(ly,py).addScaledVector(L,pz);
  sun.target.position.copy(snapped);sun.position.copy(snapped).addScaledVector(L,130);sun.target.updateMatrixWorld();
  terrain.update(camera.position,terrainBudget);terrainBudget=1;
  const blink=(Math.sin(time*3)>.6?1:0);redLight.emissiveIntensity=.3+blink*3.5;beacon.emissiveIntensity=1.2+Math.sin(time*2.2)*.8;holo.opacity=.55+Math.sin(time*1.7)*.2;
  screenClock-=dt;if(screenClock<=0&&camera.position.distanceTo(interior.position)<14){screenClock=.25;screen.draw(time,k>.5);}
 }
 setQuality('standard');
 return{setTime,setQuality,sunLight:sun,hemiLight:hemi,get sunDirection(){return sunTrue;},update,setNodeAmount,nodeGroups,followSky:(_p:THREE.Vector3)=>{},landmarks:LANDMARKS,grassCount:GRASS.length,meshes,terrain,get quality(){return quality;},get nightValue(){return k;}};
}
