import * as THREE from 'three';
import { MIN, MAX, SIZE, heightAt, rawHeight, LANDMARKS, ROCKS, GRASS, FORMATIONS, MESA, CRATER, canyonDist, segDist, random } from './world';
import { StaticBatch, surface, quad, beam, rod } from './geometry';
import { chiseledRock, oreOutcrop } from './rocks';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { fbm, ridged, noise2 } from './noise';
import { groundTextures, hullTextures, gratingTexture, consoleScreen, panelTexture, macroNoiseTexture } from './textures';
import { createSky } from './sky';
import { createMotes, createDrift, SandDrift } from './dust';
import { Wind } from './wind';
import { reducedMotion } from './motion';
import { Terrain, createShadeBaker, useBakedShade } from './terrain';
import { CYCLE_S, nightAmount, sunDirection } from './game/daycycle';
import { PATCH_NODES, SHARED_PATCH_SPLIT, VEIN_SPOT_BY_ID, VEIN_LOOK, veinScale, type Vein } from './game/resources';
import { createLightPool, LIGHT_PRIORITY } from './lights';
import { createDepositFeel } from './depositFeel';

export type Quality = 'low'|'standard'|'high';
// S4: sun shadows fade out over the outer 10% of the shadow frustum instead of ending at a hard line (no extra taps).
THREE.ShaderChunk.shadowmap_pars_fragment=THREE.ShaderChunk.shadowmap_pars_fragment.replace('\t\treturn mix( 1.0, shadow, shadowIntensity );','\t\tfloat edgeFade=smoothstep(0.,.1,min(min(shadowCoord.x,1.-shadowCoord.x),min(shadowCoord.y,1.-shadowCoord.y)));\n\t\treturn mix( 1.0, shadow, shadowIntensity*edgeFade );');
const lin=(r:number,g:number,b:number)=>new THREE.Color().setRGB(r,g,b,THREE.LinearSRGBColorSpace);
const smooth=(a:number,b:number,t:number)=>{const u=Math.max(0,Math.min(1,(t-a)/(b-a)));return u*u*(3-2*u);};
/** Beyond the walkable 560 m square: a rising ring of ridged, snow-capped mountains. S4: a second, finer ridge layer
 * and eroded gullies give a sharper silhouette (purely visual: nothing out here is walkable, collided with or saved). */
export function outerHeight(x:number,z:number){
 const cx=Math.max(MIN,Math.min(MAX,x)),cz=Math.max(MIN,Math.min(MAX,z)),d=Math.hypot(x-cx,z-cz);
 if(d<=0)return rawHeight(cx,cz)-3;
 const ramp=smooth(0,160,d),r=ridged(x*.0045+3,z*.0045-2,5,41);
 // The sharper layer comes and goes along the ring (a broad mask), so the skyline alternates jagged and rounded ranges.
 const far=smooth(25,220,d)*(.35+.65*smooth(-.3,.35,fbm(x*.0032+9,z*.0032,2,88))),r2=ridged(x*.011-7+fbm(x*.006,z*.006,2,63)*1.5,z*.011+4,4,61),gully=Math.abs(noise2(x*.015+fbm(x*.008,z*.008,2,77)*2.2,z*.015,73));
 return rawHeight(cx,cz)-.8+d*.25+ramp*(r*r*190+fbm(x*.015,z*.015,3,5)*18)+smooth(0,50,d)*fbm(x*.04,z*.04,3,9)*8+far*(r2*r2*r2*62-smooth(.2,0,gully)*12*(.4+r2));
}
/** Hull faces: octagon ring, perimeter-proportional U so decals never straddle a corner rib. */
export const HULL_RING=[[-1.86,3],[1.86,3],[2.5,2.34],[2.5,-2.34],[1.86,-3],[-1.86,-3],[-2.5,-2.34],[-2.5,2.34]];
export const HULL_U=(()=>{const len=HULL_RING.map((a,i)=>{const b=HULL_RING[(i+1)%8];return Math.hypot(b[0]-a[0],b[1]-a[1]);}),total=len.reduce((x,y)=>x+y,0);let u=0;return len.map(l=>{const r=[u/total,(u+l)/total,l] as [number,number,number];u+=l;return r;});})();

export function createWorld(scene:THREE.Scene,wind=new Wind()){
 const lowDecoration:THREE.Object3D[]=[];
 const rng=random(558),dummy=new THREE.Object3D(),color=new THREE.Color();
 const cache=new Map<string,THREE.MeshStandardMaterial>();
 const mat=(key:string,params:THREE.MeshStandardMaterialParameters)=>{if(!cache.has(key))cache.set(key,new THREE.MeshStandardMaterial(params));cache.get(key)!.name=key;return cache.get(key)!;};
 const batch=new StaticBatch(40,m=>['rock','cliffRock','ice','iron','copper','caveInner'].includes(m.name)),cube=new THREE.BoxGeometry(1,1,1);
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
 const ground=groundTextures();ground.map.repeat.set(1,1);ground.normalMap.anisotropy=4;
 const terrainMat=new THREE.MeshStandardMaterial({vertexColors:true,map:ground.map,normalMap:ground.normalMap,normalScale:new THREE.Vector2(.45,.45),roughness:1,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
 terrainMat.name='terrain';
 // S4 look (point 9 without touching heights): the texture is projected from the side on steep faces (no stretching), thin
 // strata follow world height there, a macro noise breaks the repeat at distance, and loose sand shows ripples across the wind.
 const macro=macroNoiseTexture();
 const antiTile=(s:THREE.WebGLProgramParametersWithUniforms)=>{s.uniforms.uMacro={value:macro};
  s.vertexShader='attribute vec2 surface;varying vec3 vTerrW;varying vec3 vTerrN;varying vec2 vSurf;\n'+s.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
  vTerrW=(modelMatrix*vec4(transformed,1.)).xyz;vTerrN=normalize(mat3(modelMatrix)*objectNormal);vSurf=surface;`);
  s.fragmentShader='uniform sampler2D uMacro;varying vec3 vTerrW;varying vec3 vTerrN;varying vec2 vSurf;\n'+s.fragmentShader.replace('#include <map_fragment>',`float ripple=0.,ripplePh=0.;
 #ifdef USE_MAP
  vec3 tn=normalize(vTerrN);float steep=smoothstep(.3,.62,vSurf.y);
  vec4 t1=texture2D(map,vMapUv),t2=texture2D(map,vMapUv*.23+vec2(.31,.17));vec3 side=texture2D(map,(abs(tn.x)>abs(tn.z)?vTerrW.zy:vTerrW.xy)*vec2(.38,.7)).rgb;
  diffuseColor.rgb*=mix(mix(t1.rgb,t2.rgb,.45),side,steep)*1.18;
  vec4 mc=texture2D(uMacro,vTerrW.xz*.023),mf=texture2D(uMacro,vTerrW.xz*.0061+vec2(.37,.11));
  diffuseColor.rgb*=mix(.9,1.08,mc.r*.55+mf.r*.45);
  diffuseColor.rgb*=1.+steep*(sin(vTerrW.y*5.2+mc.g*4.+mf.r*6.)*.08-.02);
  ripplePh=(vTerrW.x+sin(vTerrW.z*.37)*.55+mc.g*1.8)*13.;
  ripple=vSurf.x*(1.-smoothstep(9.,22.,length(vTerrW-cameraPosition)))*(1.-smoothstep(.7,1.8,fwidth(ripplePh)));
  diffuseColor.rgb*=1.-.035*ripple*sin(ripplePh);
 #endif`).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
  if(ripple>.01)normal=normalize(normal-(viewMatrix*vec4(cos(ripplePh)*.3*ripple,0.,0.,0.)).xyz);`);};
 const P=[['#9b7a58','dust'],['#86694d','earth'],['#6e655c','gravel'],['#b1946f','path'],['#8a7d6c','silt'],['#e7ecee','snow'],['#4d4642','rock'],['#6a4a3a','redrock'],['#b9a583','sand']] as const;
 const C=Object.fromEntries(P.map(([h,k])=>[k,new THREE.Color(h)])) as Record<string,THREE.Color>;
 const paths=[[40,44,43,56],[43,56,62,63],[62,63,80,56],[40,44,56,45],[62,63,30,79],[80,56,110,72],[80,56,104,-40],[30,79,-40,140]];
 const tmpC=new THREE.Color();
 const groundColor=(x:number,z:number,h:number,slope:number,out:THREE.Color,cavity=0,surf?:Float32Array)=>{
  const earth=smooth(-.3,.4,fbm(x*.035,z*.035,3,2));out.copy(C.dust).lerp(C.earth,earth);
  const gravel=smooth(.18,.5,fbm(x*.09+4,z*.09,3,6))*.8;out.lerp(C.gravel,gravel);
  let p=Infinity;for(const q of paths)p=Math.min(p,segDist(x,z,q[0],q[1],q[2],q[3]));
  const path=smooth(2.4,.6,p+noise2(x*.5,z*.5,3)*.6)*.5;out.lerp(C.path,path);
  const silt=smooth(16,10,Math.hypot((x-100)*.9,z-132));out.lerp(C.silt,silt);
  if(silt>0)out.lerp(tmpC.set('#cbbfa8'),smooth(.3,0,Math.abs(silt-.35))*.5);
  const cf=smooth(CRATER.r-14,CRATER.r-26,Math.hypot(x-CRATER.x,z-CRATER.z));out.lerp(tmpC.set('#b39c7b'),cf*.7);
  const cn=Math.abs(canyonDist(x,z)),bed=smooth(7,3,cn)*.75;out.lerp(C.sand,bed);
  out.multiplyScalar(1-smooth(8,3,Math.hypot(x-40,z-40.5))*.32*(0.7+.3*noise2(x,z,5)));
  // Exposed rock on steep ground, with strata on scarps (mesa, canyon, crater rim).
  const steep=smooth(.22,.55,slope);
  if(steep>0){tmpC.copy(C.rock).lerp(C.redrock,smooth(-.2,.6,Math.sin(h*1.4+fbm(x*.05,z*.05,2,9)*3))*.55);out.lerp(tmpC,steep*.85);}
  // Snow: high ground and gentle north-facing hollows; ice pocket in the valley.
  const snow=Math.max(smooth(15,8,Math.hypot(x-30,z-80)+fbm(x*.15,z*.15,2,4)*6),smooth(38,60,h+fbm(x*.03,z*.03,3,3)*14)*smooth(.6,.25,slope)*.55);
  out.lerp(C.snow,snow);
  // S4: hollows and gullies collect darker fines; crests and rims are wind-scoured and paler.
  out.multiplyScalar((.93+noise2(x*.7,z*.7,19)*.07)*(1-.16*Math.max(0,cavity)+.07*Math.max(0,-cavity)));
  // Loose sand (ripples in the shader): the riverbed, dusty flats and the crater floor; not on gravel, paths, rock or snow.
  if(surf)surf[0]=Math.max(bed,(1-earth)*.85,cf*.7)*(1-gravel)*(1-path*2)*(1-steep)*(1-snow)*smooth(.12,.04,slope);
  return out;
 };
 /** Ground colour under a point (dust from footsteps and landings takes it on). */
 function groundColorAt(x:number,z:number,out=new THREE.Color()){const e=1,h=heightAt(x,z),sx=(heightAt(x+e,z)-heightAt(x-e,z))/(2*e),sz=(heightAt(x,z+e)-heightAt(x,z-e))/(2*e);return groundColor(x,z,h,1-1/Math.hypot(sx,1,sz),out);}
 const bakeUniforms={uBake:{value:null as unknown as THREE.Texture},uBake2:{value:null as unknown as THREE.Texture},uBakeMix:{value:0},uBakeMin:{value:new THREE.Vector2()},uBakeSize:{value:new THREE.Vector2(1,1)},uBakeAmount:{value:1}};
 useBakedShade(terrainMat,bakeUniforms,antiTile);
 const terrain=new Terrain(terrainMat,groundColor);scene.add(terrain.group);
 // ---------- Outer mountains beyond the walkable square ----------
 // S4: a 10 m grid split into 8 sectors around the valley, so those behind the camera are culled; they lie outside the shadow
 // frustum, so they do not receive the shadow map (a cheaper shader for a large part of the screen).
 {
  const step=10,min=MIN-480,max=MAX+480,n=Math.round((max-min)/step)+1,hh=new Float32Array(n*n),col=new Float32Array(n*n*3),nrm=new Float32Array(n*n*3),srf=new Float32Array(n*n*2),H=(i:number,j:number)=>hh[Math.max(0,Math.min(n-1,j))*n+Math.max(0,Math.min(n-1,i))];
  for(let j=0;j<n;j++)for(let i=0;i<n;i++)hh[j*n+i]=outerHeight(min+i*step,min+j*step);
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
   const x=min+i*step,z=min+j*step,h=H(i,j),sx=(H(i+1,j)-H(i-1,j))/(2*step),sz=(H(i,j+1)-H(i,j-1))/(2*step),slope=Math.hypot(sx,sz),cav=(H(i+1,j)+H(i-1,j)+H(i,j+1)+H(i,j-1)-4*h)/step;
   color.copy(C.dust).lerp(C.rock,smooth(.15,.6,slope)).lerp(tmpC.set('#403c3a'),smooth(.7,1.3,slope)*.7);
   // Layered scarps, dust settled in gullies, snow on high ground that holds it: crests and north faces.
   color.lerp(C.redrock,smooth(.45,.9,slope)*smooth(-.1,.7,Math.sin(h*.35+fbm(x*.01,z*.01,2,9)*3))*.45);
   color.lerp(C.dust,smooth(.1,.6,cav)*.35);
   color.lerp(C.snow,smooth(95,150,h+fbm(x*.02,z*.02,3,3)*40-cav*20+sz*25)*smooth(1.1,.5,slope)*.8);
   color.multiplyScalar((.9+noise2(x*.08,z*.08,7)*.1)*(1-.12*smooth(0,.8,cav)));col.set([color.r,color.g,color.b],(j*n+i)*3);
   const l=Math.hypot(sx,1,sz);nrm.set([-sx/l,1/l,-sz/l],(j*n+i)*3);srf[(j*n+i)*2+1]=1-1/l; // grid normals: no shading seams between sectors
  }
  const inside=(x:number,z:number)=>x>MIN+step&&x<MAX-step&&z>MIN+step&&z<MAX-step,sectors:number[][]=[[],[],[],[],[],[],[],[]];
  for(let j=0;j<n-1;j++)for(let i=0;i<n-1;i++){const x=min+i*step,z=min+j*step;if(inside(x,z)&&inside(x+step,z+step))continue;sectors[Math.floor((Math.atan2(z+step/2-80,x+step/2-80)/Math.PI+1)*4)%8].push(j*n+i);}
  for(const [k,cells] of sectors.entries()){
   const map=new Map<number,number>(),pos:number[]=[],c:number[]=[],uv:number[]=[],nv:number[]=[],sv:number[]=[],idx:number[]=[];
   const v=(a:number)=>{let r=map.get(a);if(r===undefined){r=map.size;map.set(a,r);const i=a%n,j=(a-i)/n,x=min+i*step,z=min+j*step;pos.push(x,hh[a],z);uv.push(x/2.6,z/2.6);c.push(col[a*3],col[a*3+1],col[a*3+2]);nv.push(nrm[a*3],nrm[a*3+1],nrm[a*3+2]);sv.push(0,srf[a*2+1]);}return r;};
   for(const a of cells)idx.push(v(a),v(a+n),v(a+1),v(a+1),v(a+n),v(a+n+1));
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(nv,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
   g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));g.setAttribute('surface',new THREE.Float32BufferAttribute(sv,2));g.setIndex(idx);g.computeBoundingSphere();
   const m=new THREE.Mesh(g,terrainMat);m.name='outer-mountains-'+k;m.receiveShadow=false;scene.add(m);
  }
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
 // Pebbles: instanced, receive shadows only. S4: only those within PEBBLE_R of the viewer are drawn
 // (the list is rebuilt every 8 m of travel; ~45% lie scattered over the whole map and were all drawn).
 const PEBBLE_R=70,pebbleAt=new THREE.Vector3(Infinity,0,Infinity);let updatePebbles=(_p:THREE.Vector3)=>{};
 {
  const peb=chiseledRock(7,{detail:0,cuts:5});const count=2600;
  const inst=new THREE.InstancedMesh(peb,rock,count);lowDecoration.push(inst);inst.name='decorative-pebbles';let k=0;const pr=random(77);
  while(k<count){
   const near=pr()<.55&&ROCKS.length?ROCKS[Math.floor(pr()*ROCKS.length)]:null;
   const wide=pr()<.45,x=near?near.x+(pr()-.5)*near.s*4:wide?MIN+10+pr()*(SIZE-20):6+pr()*148,z=near?near.z+(pr()-.5)*near.s*4:wide?MIN+10+pr()*(SIZE-20):6+pr()*148;
   if(x>36.5&&x<43.5&&z>36.5&&z<44.2)continue;if(x>112&&x<134&&z>68&&z<76)continue;
   const s=.04+pr()*pr()*.32;dummy.position.set(x,heightAt(x,z)-s*.25,z);dummy.rotation.set(pr(),pr()*6,pr());dummy.scale.set(s*(1+pr()),s*(.6+pr()*.6),s*(1+pr()));dummy.updateMatrix();inst.setMatrixAt(k,dummy.matrix);
   inst.setColorAt(k,color.set(tones[k%4]).multiplyScalar(.8+pr()*.3));k++;
  }
  inst.receiveShadow=true;scene.add(inst);
  const all=inst.instanceMatrix.array.slice(),tint=inst.instanceColor!.array.slice(),xs=new Float32Array(count),zs=new Float32Array(count);
  for(let i=0;i<count;i++){xs[i]=all[i*16+12];zs[i]=all[i*16+14];}
  inst.boundingSphere=new THREE.Sphere(new THREE.Vector3(),PEBBLE_R+2);
  updatePebbles=p=>{if(Math.hypot(p.x-pebbleAt.x,p.z-pebbleAt.z)<8)return;pebbleAt.copy(p);let n=0;const m=inst.instanceMatrix.array as Float32Array,c=inst.instanceColor!.array as Float32Array;
   for(let i=0;i<count;i++)if((xs[i]-p.x)**2+(zs[i]-p.z)**2<PEBBLE_R*PEBBLE_R){m.set(all.subarray(i*16,i*16+16),n*16);c.set(tint.subarray(i*3,i*3+3),n*3);n++;}
   inst.count=n;inst.boundingSphere!.center.set(p.x,heightAt(p.x,p.z),p.z);for(const a of [inst.instanceMatrix,inst.instanceColor!]){a.clearUpdateRanges();a.addUpdateRange(0,n*a.itemSize);a.needsUpdate=true;}};
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
 // S4: the batch keeps piece ranges, so loose blocks can disappear one by one (depositFeel.ts).
 const nodeGroups=new Map<string,THREE.Group>();
 const deposit=(id:string,x:number,z:number,build:(b:StaticBatch)=>void)=>{const b=new StaticBatch(0,undefined,true);build(b);const g=new THREE.Group();g.name='node-'+id;g.position.set(x,heightAt(x,z),z);g.userData.y0=g.position.y;b.finish(g);scene.add(g);nodeGroups.set(id,g);};
 const deposits=createDepositFeel(nodeGroups,()=>{if(!sun.shadow.needsUpdate)shadowRedraws++;sun.shadow.needsUpdate=true;});
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
 // Deposit builders shared by the S3 deposits and the S4 new veins (D33).
 const sandHeap=(b:StaticBatch,s:number,seed:number)=>{const pr=random(seed);b.add(boulders[2],rock,0,-.12,0,1.5*s,.45*s,1.3*s,0,pr()*6,0,'#d3bb82');for(let i=0;i<5;i++){const a=pr()*6.28,d=(.7+pr()*.5)*s;b.add(boulders[i%6],rock,Math.cos(a)*d,-.1,Math.sin(a)*d,.5*s,.18*s,.45*s,0,pr()*6,0,i%2?'#cdb67f':'#dcc58f');}};
 const scree=(b:StaticBatch,s:number,seed:number)=>{const pr=random(seed);b.add(boulders[3],rock,0,-.12,0,1.2*s,1*s,1.1*s,0,pr()*6,0,'#b5a998');for(let i=0;i<10;i++){const a=i/10*6.28+pr()*.5,d=(.8+pr()*.7)*s,k=(.25+pr()*.3)*s;b.add(boulders[i%6],rock,Math.cos(a)*d,-.08,Math.sin(a)*d,k*1.2,k,k*1.1,0,pr()*6,0,i%2?'#a89c8c':'#c2b6a4');}};
 const iceSlab=(b:StaticBatch,s:number,seed:number)=>{const pr=random(seed);for(let i=0;i<4;i++){const g=chiseledRock(seed+i,{detail:2,base:'#ffffff',dust:'#f4fbff',dark:'#6f98a8',cuts:7,flatTop:.6,lumpy:.1}),a=i*1.6,d=i?.6*s:0,k=(i?.5+pr()*.2:.95)*s;b.add(g,ice,Math.cos(a)*d,-.15,Math.sin(a)*d,k*1.1,k*(i?1:1.1),k*.95,(pr()-.5)*.3,pr()*6,(pr()-.5)*.3);}};
 const vein=(b:StaticBatch,metal:'iron'|'copper',s:number,seed:number,ry:number)=>{const host=metal==='iron'?{strata:3,base:'#4a4038',dust:'#8a6a50',dark:'#2a2320'}:{strata:2,base:'#3c4640',dust:'#6f8f7c',dark:'#232a27'},o=oreOutcrop(seed,host,metal==='iron'?{freq:2.3,width:.05,blobs:.74,lift:.018,crystals:.12,stain:'#7a3f22'}:{freq:1.9,width:.045,blobs:.72,lift:.02,crystals:.22,stain:'#3f8f78'});b.add(o.host,rock,0,-.1,0,1.7*s,1.5*s,1.4*s,0,ry,0);b.add(o.veins,metal==='iron'?iron:copper,0,-.1,0,1.7*s,1.5*s,1.4*s,0,ry,0);};
 // ---------- S3 deposits: a second source of every early material, and rich far veins ----------
 {
  deposit('stone-b',24,25,b=>scree(b,1.05,5301));
  deposit('sand-b',58,100,b=>sandHeap(b,1.1,5311));
  deposit('iron-c',98,63,b=>vein(b,'iron',.9,640,1.2));
  deposit('copper-c',92,92,b=>vein(b,'copper',.85,650,2.1));
  deposit('ice-b',26,82,b=>iceSlab(b,1,360));
  deposit('ice-c',35,82,b=>iceSlab(b,1,370));
  deposit('sand-canyon',90,-100,b=>sandHeap(b,1.5,5321));
  deposit('iron-canyon',75,-96,b=>vein(b,'iron',1.15,660,.4));
  deposit('copper-mesa',-70,140,b=>vein(b,'copper',1.15,670,2.7));
  deposit('ice-crater',266,262,b=>iceSlab(b,1.6,380));
 }
 // ---------- S4 (D33): new veins. Each is built when it appears (its own geometry, so the draw ranges of its loose
 // pieces stay its own) and removed once its crumble has finished. Materials are the shared deposit ones (already compiled).
 const veinKeys=new Map<string,string>(),retired=new Set<string>(),redrawShadows=()=>{if(!sun.shadow.needsUpdate)shadowRedraws++;sun.shadow.needsUpdate=true;};
 function buildVein(v:Vein){
  const s=VEIN_SPOT_BY_ID.get(v.spot)!,k=veinScale(v),n=Number(v.id.slice(5))||1,seed=7000+n*13,ry=(n*2.399)%6.283;
  deposit(v.id,s.x,s.z,b=>{if(v.material==='iron'||v.material==='copper')vein(b,v.material,.9*k,seed,ry);else if(v.material==='stone')scree(b,k,seed);else if(v.material==='sand')sandHeap(b,k,seed);else iceSlab(b,k,seed);});
 }
 function dropVein(id:string){
  const g=nodeGroups.get(id);veinKeys.delete(id);retired.delete(id);if(!g)return;deposits.forget(id);
  g.traverse(o=>{const m=o as THREE.Mesh;if(m.isMesh&&m!==deposits.shell)m.geometry.dispose();});scene.remove(g);nodeGroups.delete(id);redrawShadows();
 }
 /** Live veins → groups: new ones are built (and rise when `fresh`), changed ones rebuilt, gone ones retire after their crumble. */
 function syncVeins(veins:readonly Vein[],fresh:readonly string[]=[]){
  const live=new Set<string>();
  for(const v of veins){const key=v.spot+':'+v.material+':'+v.size,have=veinKeys.get(v.id);live.add(v.id);retired.delete(v.id);if(have===key)continue;if(have!==undefined)dropVein(v.id);
   veinKeys.set(v.id,key);buildVein(v);redrawShadows();if(fresh.includes(v.id))deposits.emerge(v.id,VEIN_LOOK[v.material].height*veinScale(v)+.2);}
  for(const id of veinKeys.keys())if(!live.has(id)&&!retired.has(id)){retired.add(id);deposits.setAmount(id,0,1);}
 }
 const grassHarvest=new Map<string,()=>void>();
 const grassRemaining=new Map<string,number>();
 const setNodeAmount=(id:string,left:number,amount:number)=>{grassRemaining.set(id,left/amount);grassHarvest.get(id)?.();deposits.setAmount(id,left,amount);};
 {
 // Loose weathered pieces resting on the ground (sunk slightly, never hovering).
  for(const [ox,oz,m] of [[67,65,iron],[83,55,copper]] as const)for(let i=0;i<7;i++){const a=rng()*6.28,d=1.6+rng()*1.8,px=ox+Math.cos(a)*d,pz=oz+Math.sin(a)*d,s=.1+rng()*.14;
   const piece=oreOutcrop(900+i+(m===iron?0:20),{detail:1,cuts:7},{freq:3,width:.1,blobs:.6,lift:.01,crystals:0}),ry=rng()*6,py=heightAt(px,pz)-s*.35;batch.add(piece.host,rock,px,py,pz,s,s*.8,s,0,ry,0,m===iron?'#8a7466':'#6f8a80');batch.add(piece.veins,m,px,py,pz,s,s*.8,s,0,ry,0);}
 }

 // ---------- Local vegetation: low rosettes, 5–9 folded leaves, swaying in the wind ----------
 const windUniform={value:0},windDir={value:new THREE.Vector2(1,0)},windGust={value:.55};
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
  // S4: the bend is a world-space vector along the shared wind (moved into each tuft's rotated, scaled frame),
  // with a wave travelling downwind across the meadow and a gust-driven flutter.
  const grassMat=m;grassMat.onBeforeCompile=s=>{Object.assign(s.uniforms,{uWind:windUniform,uWindDir:windDir,uGust:windGust});s.vertexShader='attribute float sway;uniform float uWind,uGust;uniform vec2 uWindDir;\n'+s.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
   vec3 ip=instanceMatrix[3].xyz;float w=sway*sway;float wave=uWind*1.8-dot(ip.xz,uWindDir)*.3;
   float bend=(.3+.7*uGust)*(.6+.4*sin(wave))+.18*uGust*sin(uWind*5.1+ip.x*1.7+ip.z*1.3);
   vec2 side=vec2(-uWindDir.y,uWindDir.x)*sin(uWind*2.3+ip.z*.8+ip.x*.3)*.025;
   vec3 wd=vec3(uWindDir.x*bend*.13+side.x,-.05*bend,uWindDir.y*bend*.13+side.y)*w;
   mat3 sw=mat3(instanceMatrix);transformed+=transpose(sw)*wd/dot(sw[0],sw[0]);`);};
  useBakedShade(grassMat,bakeUniforms,grassMat.onBeforeCompile);
  const inst=new THREE.InstancedMesh(g,m,GRASS.length);
  GRASS.forEach((p,i)=>{dummy.position.set(p.x,heightAt(p.x,p.z)-.02,p.z);dummy.scale.setScalar(p.s*1.35);dummy.rotation.set(0,p.rotation,0);dummy.updateMatrix();inst.setMatrixAt(i,dummy.matrix);inst.setColorAt(i,color.setHSL(.2+rng()*.06,.12+rng()*.1,.62+rng()*.3));});
  const originals=GRASS.map((_,i)=>{const matrix=new THREE.Matrix4();inst.getMatrixAt(i,matrix);return matrix;});
  for(const [patch,ids] of PATCH_NODES)for(const id of ids){const indices=GRASS.flatMap((p,i)=>p.patch===patch&&(patch!==0||(p.x<SHARED_PATCH_SPLIT)===(id==='grass-a'))?[i]:[]);grassHarvest.set(id,()=>{const visible=Math.ceil(indices.length*(grassRemaining.get(id)??1));indices.forEach((i,j)=>inst.setMatrixAt(i,j<visible?originals[i]:new THREE.Matrix4().makeScale(0,0,0)));inst.instanceMatrix.needsUpdate=true;});}
  inst.name='local-grass';inst.receiveShadow=true;inst.castShadow=false;scene.add(inst);
 }
 const meshes=batch.finish(scene,m=>({cast:!noShadow.has(m)&&m!==caveInner&&m!==cliffRock,receive:!noShadow.has(m)}));
 // S5: on Low the scattered rocks (one batch per 40 m cell, about a hundred down the valley) are drawn only within
 // FAR_ROCKS m of the camera (nearest point of the batch's bounding sphere; checked every 8 m of travel). Cliffs, deposits
 // and the terrain stay. Standard and High draw every batch as before.
 const FAR_ROCKS=120,farRocks=meshes.filter(m=>m.name.startsWith('rock:')),farAt=new THREE.Vector3(Infinity,0,Infinity);
 const updateFarRocks=(p:THREE.Vector3,force=false)=>{if(!force&&Math.hypot(p.x-farAt.x,p.z-farAt.z)<8)return;farAt.copy(p);for(const m of farRocks){const b=m.geometry.boundingSphere!;m.visible=quality!=='low'||Math.hypot(b.center.x-p.x,b.center.z-p.z)-b.radius<=FAR_ROCKS;}};
 for(const m of cache.values())if(!noShadow.has(m))useBakedShade(m,bakeUniforms);

 // ---------- Sky, light, fog, atmosphere ----------
 const sky=createSky();scene.add(sky.mesh);
 const motes=createMotes();scene.add(motes.mesh);
 // S5: low ribbons of blowing sand in gusts (CPU: a few per frame; one draw call while any is visible).
 const drift=createDrift(),sand=new SandDrift(),look=new THREE.Vector3();scene.add(drift.mesh);
 const hemi=new THREE.HemisphereLight('#bcd3dc','#8a7358',1.15);scene.add(hemi);
 const sun=new THREE.DirectionalLight('#ffd9a8',3.4);sun.castShadow=true;scene.add(sun,sun.target);
 const sc=sun.shadow.camera;sc.left=-42;sc.right=42;sc.top=42;sc.bottom=-42;sc.near=1;sc.far=260;sun.shadow.bias=-.00008;sun.shadow.normalBias=.08;sun.shadow.radius=1.5;sun.shadow.autoUpdate=false;sun.shadow.needsUpdate=true;
 // Capsule lamps are hidden emitters: the fixed pool (lights.ts) lends them real lights when they are near.
 const lights=createLightPool(scene,4),lightRoots:THREE.Object3D[]=[];
 const doorLight=new THREE.PointLight('#ffb870',9,13,1.7);doorLight.position.set(40,cy(1.8),43.8);scene.add(doorLight);lights.add(doorLight,LIGHT_PRIORITY.door);
 const interior=new THREE.PointLight('#ffd3a0',3.2,6.5,1.6);interior.position.set(40,cy(3.3),39.8);scene.add(interior);lights.add(interior,LIGHT_PRIORITY.interior);
 const fog=new THREE.FogExp2(lin(.8,.68,.53),.0022);scene.fog=fog;
 const D={sun:new THREE.Color('#ffd9a8'),hemiSky:new THREE.Color('#bcd3dc'),hemiGround:new THREE.Color('#8a7358'),fog:lin(.8,.68,.53),dust:new THREE.Color('#f6e2bd')};
 const N={sun:new THREE.Color('#8fa9d6'),hemiSky:new THREE.Color('#5f7896'),hemiGround:new THREE.Color('#2b2f36'),fog:lin(.07,.1,.15),dust:new THREE.Color('#5d6f86')};
 const moon=new THREE.Vector3(.5,.55,.67).normalize(),sunTrue=new THREE.Vector3(),lightDir=new THREE.Vector3(),lastBake=new THREE.Vector3();
 // Baked terrain/formation shade follows the moving sun: rebuilt a few rows per frame, then cross-faded.
 const baker=createShadeBaker([{x:100,z:103,r:3.2,top:heightAt(100,103)+18},{x:106.5,z:104.2,r:2.6,top:heightAt(106.5,104.2)+14},...[115,120,125,130,135].map(x=>({x,z:72,r:8,top:9.5}))]);
 bakeUniforms.uBakeMin.value.copy(baker.min);bakeUniforms.uBakeSize.value.copy(baker.size);
 let fading=false;
 /** Loading and time skips schedule a new bake without blocking input. */
 function bakeNow(dir:THREE.Vector3){baker.begin(dir);if(!bakeUniforms.uBake.value){bakeUniforms.uBake.value=baker.textures[1];bakeUniforms.uBake2.value=baker.textures[1];}bakeUniforms.uBakeMix.value=0;fading=false;lastBake.copy(dir);}
 let k=0,phase=-1,targetPhase=0,time=0,screenClock=0,quality:Quality='standard';
 const environments:{low:THREE.WebGLRenderTarget[];full:THREE.WebGLRenderTarget[]}={low:[],full:[]};
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
  motes.uniforms.uTint.value.copy(D.dust).lerp(N.dust,v);motes.uniforms.uOpacity.value=THREE.MathUtils.lerp(1.25,.6,v);motes.uniforms.uNight.value=v;motes.uniforms.uSun.value.copy(lightDir);drift.uniforms.uNight.value=v;
  doorLight.intensity=THREE.MathUtils.lerp(9,16,v);interior.intensity=THREE.MathUtils.lerp(3.2,4.2,v);
  warm.emissiveIntensity=THREE.MathUtils.lerp(2.6,3.4,v);glass.emissiveIntensity=THREE.MathUtils.lerp(.5,1.8,v);

 }
 const wrapS=(d:number)=>((d%CYCLE_S)+CYCLE_S*1.5)%CYCLE_S-CYCLE_S/2;
 /** Sets the day phase. Small steps follow the clock; a large jump (Sun/Moon skip, load) is animated over ≈1.5 s unless `instant`. */
 function setTime(t:number,instant=false){targetPhase=((t%CYCLE_S)+CYCLE_S)%CYCLE_S;if(instant||phase<0){phase=targetPhase;applyPhase(phase);bakeNow(lightDir);}}
 function setQuality(q:Quality){quality=q;sun.castShadow=q!=='low';const size=q==='high'?2048:1024,ext=q==='high'?60:42;
  sun.shadow.normalBias=2*ext/size; // about one texel (8.2 cm Standard, 5.9 cm High)
  if(sun.shadow.mapSize.x!==size||sc.right!==ext){sun.shadow.mapSize.set(size,size);sc.left=sc.bottom=-ext;sc.right=sc.top=ext;sc.updateProjectionMatrix();sun.shadow.map?.dispose();sun.shadow.map=null as unknown as THREE.WebGLRenderTarget;}
  motes.setQuality(q);sand.setQuality(q);for(const m of lowDecoration)m.visible=q!=='low';updateFarRocks(farAt,true);terrain.setQuality(q);lights.resize(q==='low'?2:4);shadowAt.set(Infinity,0,0);sun.shadow.needsUpdate=true;const environment=(q==='low'?environments.low:environments.full)[k<.5?0:1];if(environment)scene.environment=environment.texture;}
 const snapped=new THREE.Vector3(),lx=new THREE.Vector3(),ly=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),center=new THREE.Vector3(),shadowDir=new THREE.Vector3(),shadowCenter=new THREE.Vector3(Infinity,Infinity,Infinity);
 // S4: the shadow map follows its own light direction (updated after a 0.25° turn) and its own centre
 // (moved after 3 m of travel, texel-snapped), so it is redrawn about twice a second, not every frame.
 const shadowL=new THREE.Vector3(),shadowAt=new THREE.Vector3(Infinity,0,0);let shadowRedraws=0;
 /** Capture stable day/night reflections during loading, never during active play. */
 function prepare(renderer:THREE.WebGLRenderer){
  deposits.prewarm();
  if(environments.low.length)return;
  const gen=new THREE.PMREMGenerator(renderer);
  for(const [targets,size] of [[environments.low,64],[environments.full,128]] as const)for(const night of [0,1]){
   envSky.uniforms.night.value=night;envSky.uniforms.sunDir.value.copy(night?moon:new THREE.Vector3().fromArray(sunDirection(240)).normalize());
   targets.push(gen.fromScene(envScene,0,.1,1000,{size}));
  }
  gen.dispose();scene.environment=(quality==='low'?environments.low:environments.full)[k<.5?0:1].texture;
 }
 function update(dt:number,camera:THREE.Camera,renderer:THREE.WebGLRenderer,allowMaintenance=true,measure?:(name:string,ms:number)=>void,anchor?:THREE.Vector3){
  let at=performance.now();
  sky.mesh.position.copy(camera.position);time+=dt;sky.uniforms.time.value=time;
  // Shared wind (frozen with the scene; still under reduced motion): grass, clouds, motes, sand drift; fx and audio read it too.
  wind.update(dt);windUniform.value=wind.time;windDir.value.set(wind.dirX,wind.dirZ);windGust.value=wind.gust;sky.uniforms.cloud.value.set(wind.cloudX,wind.cloudZ);
  const mu=motes.uniforms;motes.mesh.visible=!reducedMotion();mu.uOffset.value.set(wind.driftX,wind.driftZ);mu.uTime.value=wind.time;mu.uWind.value.set(wind.vx,0,wind.vz);mu.uGust.value=wind.gust;mu.uOrigin.value.copy(camera.position);
  camera.getWorldDirection(look);look.y=0;if(look.lengthSq()<1e-6)look.set(0,0,1);look.normalize();sand.update(dt,wind,camera.position.x,camera.position.z,heightAt,groundColorAt,reducedMotion(),look.x,look.z);drift.uniforms.uTime.value=wind.time;drift.sync(sand.sheets,wind);
  mu.uPx.value=(camera as THREE.PerspectiveCamera).projectionMatrix.elements[5]*renderer.domElement.height/2;
  if(phase!==targetPhase){const d=wrapS(targetPhase-phase);phase=Math.abs(d)<=Math.max(2,dt*320)?targetPhase:((phase+Math.sign(d)*dt*320)%CYCLE_S+CYCLE_S)%CYCLE_S;applyPhase(phase);}
  // Incremental re-bake when the light has turned by more than ~3° (S4; was 1.5°); then a 1.5 s cross-fade.
  if(fading){bakeUniforms.uBakeMix.value=Math.min(1,bakeUniforms.uBakeMix.value+dt/1.5);if(bakeUniforms.uBakeMix.value>=1){bakeUniforms.uBake.value=bakeUniforms.uBake2.value;bakeUniforms.uBakeMix.value=0;fading=false;}}
  else if(baker.busy&&allowMaintenance){if(baker.step(10,2)){bakeUniforms.uBake2.value=baker.flip();bakeUniforms.uBakeMix.value=0;fading=true;}}
  else if(k<.98&&lightDir.angleTo(lastBake)>.05){lastBake.copy(lightDir);baker.begin(lightDir);}
  measure?.('shade',performance.now()-at);at=performance.now();
  const environment=(quality==='low'?environments.low:environments.full)[k<.5?0:1];if(environment)scene.environment=environment.texture;
  // Fade reflection intensity to zero at the palette switch: no capture cost or sudden flash.
  scene.environmentIntensity=THREE.MathUtils.lerp(.55,.25,k)*THREE.MathUtils.smoothstep(Math.abs(k-.5),0,.12);
  measure?.('environment',performance.now()-at);at=performance.now();
  // Ground-anchored frustum: camera bob and turning cannot move the shadow projection.
  center.copy(anchor??camera.position);center.y=heightAt(center.x,center.z);
  const turned=shadowL.angleTo(lightDir)>.0044;
  if(turned||center.distanceToSquared(shadowAt)>9){
   if(turned)shadowL.copy(lightDir);shadowAt.copy(center);const L=shadowL;lx.crossVectors(up,L).normalize();ly.crossVectors(L,lx);
   const texel=(sc.right-sc.left)/sun.shadow.mapSize.x,px=Math.round(center.dot(lx)/texel)*texel,py=Math.round(center.dot(ly)/texel)*texel,pz=Math.round(center.dot(L)/texel)*texel;
   snapped.copy(lx).multiplyScalar(px).addScaledVector(ly,py).addScaledVector(L,pz);
   if(!shadowCenter.equals(snapped)||!shadowDir.equals(L)){shadowCenter.copy(snapped);shadowDir.copy(L);sun.shadow.needsUpdate=true;shadowRedraws++;}
   sun.target.position.copy(snapped);sun.position.copy(snapped).addScaledVector(L,130);sun.target.updateMatrixWorld();
  }
  updatePebbles(camera.position);updateFarRocks(camera.position);
  if(allowMaintenance)terrain.update(camera.position,2);
  measure?.('terrain',performance.now()-at);at=performance.now();
  const blink=(Math.sin(time*3)>.6?1:0);redLight.emissiveIntensity=.3+blink*3.5;beacon.emissiveIntensity=1.2+Math.sin(time*2.2)*.8;holo.opacity=.55+Math.sin(time*1.7)*.2;
  screenClock-=dt;if(screenClock<=0&&camera.position.distanceTo(interior.position)<14){screenClock=.25;screen.draw(time,k>.5);}
  lights.update(camera,dt,lightRoots);deposits.update(dt);for(const id of retired)if(!deposits.isCrumbling(id))dropVein(id);
  measure?.('animation',performance.now()-at);
 }
 setQuality('standard');
 return{setTime,setQuality,prepare,invalidateShadows:()=>{if(!sun.shadow.needsUpdate)shadowRedraws++;sun.shadow.needsUpdate=true;},get shadowRedraws(){return shadowRedraws;},lights,lightRoots,wind,motes,drift:{get live(){return drift.live;},get cap(){return sand.cap;},get born(){return sand.born;}},groundColorAt,sunLight:sun,hemiLight:hemi,get sunDirection(){return sunTrue;},update,setNodeAmount,syncVeins,nodeGroups,deposits,followSky:(_p:THREE.Vector3)=>{},landmarks:LANDMARKS,grassCount:GRASS.length,meshes,terrain,get quality(){return quality;},get nightValue(){return k;}};
}
