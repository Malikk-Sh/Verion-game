import * as THREE from 'three';
import { GRID, STEP, heights, heightAt, LANDMARKS, ROCKS, GRASS, random } from './world';
import { StaticBatch, surface, quad, beam, stratifiedRock } from './geometry';

export function createWorld(scene:THREE.Scene){
 const cache=new Map<string,THREE.MeshStandardMaterial>();
 const mat=(color:string,extra:THREE.MeshStandardMaterialParameters={})=>{
  const key=color+JSON.stringify(extra);if(!cache.has(key))cache.set(key,new THREE.MeshStandardMaterial({color,roughness:.86,flatShading:true,...extra}));return cache.get(key)!;
 };
 const batch=new StaticBatch(), cube=new THREE.BoxGeometry(1,1,1);
 const box=(m:THREE.Material,x:number,y:number,z:number,w:number,h:number,d:number,ry=0,rz=0)=>batch.add(cube,m,x,y,z,w,h,d,0,ry,rz);
 const metal=mat('#D4D8CC',{metalness:.25,roughness:.5,side:THREE.DoubleSide});
 const dark=mat('#293C40',{metalness:.4,roughness:.58,side:THREE.DoubleSide});
 const orange=mat('#CF753B',{metalness:.25,roughness:.5});
 const warm=mat('#FFE0A5',{emissive:'#FFB963',emissiveIntensity:1.9});
 const cool=mat('#81C8CD',{emissive:'#60B9C5',emissiveIntensity:.8});
 const stone=mat('#617273'),stoneDark=mat('#465859'),stoneLight=mat('#83928B');
 const rocks=[0,1,2].map(i=>stratifiedRock(5+i*13));
 const rng=random(558),dummy=new THREE.Object3D();

 // Smooth terrain, broad sediment bands, dark silt in the dry basin and wind streaks.
 const positions:number[]=[],colors:number[]=[],indices:number[]=[],color=new THREE.Color();
 for(let z=0;z<GRID;z++)for(let x=0;x<GRID;x++){
  const wx=x*STEP,wz=z*STEP,h=heights[z*GRID+x];positions.push(wx,h,wz);
  const silt=((wx-100)/14)**2+((wz-132)/12)**2<1;
  const streak=Math.sin(wx*.16+wz*.29+Math.sin(wx*.055)*3)*.018;
  const broad=Math.sin(wx*.047-wz*.031)*Math.cos(wz*.081)*.055;
  color.set(silt?'#84958A':'#969986').offsetHSL(0,0,streak+broad-Math.max(0,h-4)*.011);
  colors.push(color.r,color.g,color.b);
 }
 for(let z=0;z<GRID-1;z++)for(let x=0;x<GRID-1;x++){const a=z*GRID+x;indices.push(a,a+GRID,a+1,a+1,a+GRID,a+GRID+1);}
 const terrain=surface(positions,indices);terrain.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
 const uvs:number[]=[];for(let z=0;z<GRID;z++)for(let x=0;x<GRID;x++)uvs.push(x*STEP/5,z*STEP/5);
 terrain.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
 const grainRandom=random(9151),grain=new Uint8Array(128*128*4);
 for(let z=0;z<128;z++)for(let x=0;x<128;x++){
  const index=(z*128+x)*4,v=221+grainRandom()*25;
  grain[index]=grain[index+1]=grain[index+2]=v;grain[index+3]=255;
 }
 const groundTexture=new THREE.DataTexture(grain,128,128);groundTexture.wrapS=groundTexture.wrapT=THREE.RepeatWrapping;groundTexture.magFilter=THREE.LinearFilter;groundTexture.minFilter=THREE.LinearMipmapLinearFilter;groundTexture.generateMipmaps=true;groundTexture.needsUpdate=true;
 scene.add(new THREE.Mesh(terrain,mat('#FFFFFF',{vertexColors:true,flatShading:false,map:groundTexture})));


 // Reusable contact decals, no dynamic shadow maps or transparent grass layers.
 const pixels=new Uint8Array(32*32*4);
 for(let y=0;y<32;y++)for(let x=0;x<32;x++){const i=(y*32+x)*4,r=Math.hypot((x-15.5)/15.5,(y-15.5)/15.5);pixels[i]=23;pixels[i+1]=35;pixels[i+2]=35;pixels[i+3]=Math.round(Math.max(0,1-r)**2*120);}
 const tex=new THREE.DataTexture(pixels,32,32);tex.needsUpdate=true;
 const shadowMat=new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
 const shadowGeo=new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2);
 const shadows=new THREE.InstancedMesh(shadowGeo,shadowMat,ROCKS.length+1);
 ROCKS.forEach((r,i)=>{
  const shape=rocks[i%3];batch.add(shape,i%4===0?stoneLight:stone,r.x,heightAt(r.x,r.z)-.1,r.z,r.s*.68,r.sy,r.s*.65,0,r.rotation,0);
  dummy.position.set(r.x,heightAt(r.x,r.z)+.025,r.z);dummy.rotation.set(0,r.rotation,0);dummy.scale.set(r.s*2.5,1,r.s*2.3);dummy.updateMatrix();shadows.setMatrixAt(i,dummy.matrix);
 });
 dummy.position.set(40,heightAt(40,40)+.018,40);dummy.rotation.set(0,0,0);dummy.scale.set(12,1,13);dummy.updateMatrix();shadows.setMatrixAt(ROCKS.length,dummy.matrix);scene.add(shadows);
 // Broad overlapping mesas, deliberately outside the walkable sample.
 for(let i=0;i<34;i++){
  const a=i/34*Math.PI*2,r=137+rng()*20;
  batch.add(rocks[i%3],mat('#708989'),80+Math.cos(a)*r,-9,80+Math.sin(a)*r,24+rng()*22,20+rng()*25,17+rng()*17,0,a,0);
 }

 const h=heightAt(40,40),cy=(y:number)=>h+y;
 // Eight-sided pressure shell. The open front is a real traversable doorway.
 const ring=[[-1.86,3],[1.86,3],[2.5,2.34],[2.5,-2.34],[1.86,-3],[-1.86,-3],[-2.5,-2.34],[-2.5,2.34]];
 const v=(p:number[],y:number,inset=1)=>[40+p[0]*inset,cy(y),40+p[1]*inset];
 for(let i=0;i<8;i++){
  const a=ring[i],b=ring[(i+1)%8];
  if(i!==0)batch.add(quad(v(a,.15),v(b,.15),v(b,3.15),v(a,3.15)),metal);
  batch.add(quad(v(a,3.15),v(b,3.15),v(b,4.3,.78),v(a,4.3,.78)),metal);
  batch.add(quad(v(a,2.75,1.005),v(b,2.75,1.005),v(b,2.95,1.005),v(a,2.95,1.005)),orange);
  batch.add(beam(new THREE.Vector3(...v(a,.12)),new THREE.Vector3(...v(a,3.18)),.1),dark);
  batch.add(beam(new THREE.Vector3(...v(a,3.15)),new THREE.Vector3(...v(a,4.34,.78)),.095),dark);
  batch.add(quad(v(a,4.31,.79),v(b,4.31,.79),[40,cy(4.31),40],[40,cy(4.31),40]),dark);
 }
 box(dark,40,cy(.06),40,5.15,.17,6.1);
 // Faceted front panels and thick hatch reveals.
 for(const s of [-1,1]){
  box(metal,40+s*1.42,cy(1.55),42.97,.95,3.05,.15);
  box(dark,40+s*1.02,cy(1.22),43.07,.15,2.35,.35);
  box(orange,40+s*1.13,cy(1.36),43.17,.095,1.9,.055);
  for(let i=0;i<4;i++)box(dark,40+s*1.53,cy(.48+i*.13),43.07,.43,.045,.04);
  for(const z of [37.9,42.1]){
   const a=new THREE.Vector3(40+s*2.47,cy(1.65),z),b=new THREE.Vector3(40+s*3.28,cy(.11),z+.24);
   batch.add(beam(a,b,.2),dark);batch.add(beam(a.clone().lerp(b,.3),a.clone().lerp(b,.75),.27),metal);
   box(dark,b.x,cy(.07),b.z,.78,.16,.85);box(orange,b.x,cy(.18),b.z,.42,.09,.45);
  }
  // Recessed side service panels, warning stripe and exposed cable runs.
  box(dark,40+s*2.53,cy(1.75),39.3,.055,1.05,1.8);
  for(let i=0;i<6;i++)box(metal,40+s*2.57,cy(1.35+i*.15),39.3,.04,.035,1.5);
  box(orange,40+s*2.55,cy(.47),40,.035,.2,4.2);
  for(const z of [38.1,41.8])batch.add(new THREE.CylinderGeometry(.065,.065,.07,8),dark,40+s*2.56,cy(2.53),z,1,1,1,0,0,Math.PI/2);
 }
 box(metal,40,cy(2.77),43,2.0,.7,.18);box(dark,40,cy(2.35),43.07,2.16,.18,.38);
 box(warm,40,cy(2.26),43.21,1.6,.065,.06);
 // Fuselage identity and maintenance markings on one tiny local texture.
 const labelCanvas=document.createElement('canvas');labelCanvas.width=512;labelCanvas.height=128;
 const ctx=labelCanvas.getContext('2d')!;ctx.fillStyle='#d4d8cc';ctx.fillRect(0,0,512,128);ctx.fillStyle='#293c40';
 ctx.font='bold 62px sans-serif';ctx.fillText('VE—01',16,65);ctx.font='17px sans-serif';ctx.fillText('VIREON  /  LANDING MODULE',18,102);
 const labelTexture=new THREE.CanvasTexture(labelCanvas);labelTexture.colorSpace=THREE.SRGBColorSpace;
 const label=new THREE.Mesh(new THREE.PlaneGeometry(1.55,.3875),new THREE.MeshStandardMaterial({map:labelTexture,roughness:.65}));label.position.set(40,cy(2.88),43.105);scene.add(label);
 // Low threshold and patterned anti-slip landing step.
 box(dark,40,cy(.085),43.48,2.1,.17,.8);
 for(let i=0;i<9;i++)box(metal,39.13+i*.217,cy(.181),43.48,.055,.02,.65);
 // Roof: thermal radiator, hatch, communication mast.
 batch.add(new THREE.CylinderGeometry(.78,.89,.16,12),metal,40,cy(4.42),40);
 for(let i=0;i<6;i++)box(metal,40,cy(4.39),38.55+i*.16,2.5,.08,.055);
 batch.add(new THREE.CylinderGeometry(.035,.06,1.6,8),dark,38.7,cy(4.9),38.5);
 box(cool,38.7,cy(5.71),38.5,.13,.09,.13);
 batch.add(beam(new THREE.Vector3(38.7,cy(5.28),38.5),new THREE.Vector3(39.28,cy(5.28),38.5),.055),metal);
 // Interior: sleeping berth, restrained utility console, gas bottle rack and ceiling ribs.
 box(dark,38.12,cy(.39),39.5,.78,.62,2.5);box(mat('#667C73'),38.12,cy(.77),39.5,.74,.18,2.42);
 box(metal,38.12,cy(.89),38.65,.68,.12,.52);
 box(dark,41.35,cy(.87),37.7,1.3,1.6,.65);
 box(cool,41.35,cy(1.31),38.055,.96,.5,.03);
 for(let i=0;i<4;i++)box(dark,41.02+i*.22,cy(1.34),38.08,.13,.055,.018);
 box(orange,41.36,cy(.9),38.06,.85,.08,.05);
 // Sloping control shelf, tactile keys, recessed lower access panel.
 box(metal,41.35,cy(.81),38.21,1.25,.07,.46);
 for(let i=0;i<5;i++)box(i===4?orange:dark,40.9+i*.2,cy(.86),38.28,.09,.04,.1);
 box(metal,41.35,cy(.37),38.04,.9,.47,.035);box(dark,41.35,cy(.5),38.075,.29,.035,.02);
 for(const z of [38.7,39.5,40.3])box(mat('#8B9A86'),38.12,cy(.875),z,.72,.016,.055);
 for(let i=0;i<5;i++)box(metal,40,cy(.154),38+i*.82,3.2,.013,.025);

 for(let i=0;i<2;i++){
  const bx=38.9+i*.49;
  batch.add(new THREE.CylinderGeometry(.19,.19,.98,12),metal,bx,cy(.72),37.55);
  batch.add(new THREE.SphereGeometry(.19,12,8),metal,bx,cy(1.21),37.55);
  batch.add(new THREE.SphereGeometry(.19,12,8),metal,bx,cy(.23),37.55);
  batch.add(new THREE.CylinderGeometry(.055,.055,.15,8),dark,bx,cy(1.43),37.55);
  box(orange,bx,cy(1.51),37.55,.17,.04,.09);
  box(dark,bx,cy(.32),37.56,.43,.07,.45);
  box(orange,38.9+i*.49,cy(.99),37.76,.29,.13,.035);
 }
 for(const z of [38.2,39.9,41.6]){
  box(dark,40,cy(3.86),z,3.65,.09,.08);box(warm,40,cy(3.79),z,1.2,.035,.07);
 }
 // Ground survey beacons identify the future build area without granting a built base.
 for(const [x,z,sx,sz]of[[50,36,1,1],[66,36,-1,1],[50,52,1,-1],[66,52,-1,-1]]){
  const y=heightAt(x,z);box(dark,x,y+.19,z,.12,.38,.12);box(orange,x,y+.41,z,.2,.08,.2);
  box(metal,x+sx*.7,y+.026,z,1.4,.025,.07);box(metal,x,y+.028,z+sz*.7,.07,.025,1.4);
 }

 // Cave: irregular arch swept into rock, keeping the tested 5m walkable tunnel.
 // Continuous outer skin encloses the mound; no square collision boxes are rendered.
 const cv:number[]=[],ci:number[]=[],sections=7,arc=12;
 for(let j=0;j<sections;j++)for(let k=0;k<=arc;k++){
  const a=k/arc*Math.PI;const bump=Math.sin(j*2.7+k*1.91)*.14;
  const x=113+j*3.2+(j===0?Math.cos(k*2.6)*.35:0);
  const radius=3.0+Math.sin(j*1.3)*.12;
  cv.push(x,.35+Math.sin(a)*(4.3+bump),72+Math.cos(a)*(radius+bump));
 }
 for(let j=0;j<sections-1;j++)for(let k=0;k<arc;k++){const a=j*(arc+1)+k,b=a+arc+1;ci.push(a,a+1,b,a+1,b+1,b);}
 batch.add(surface(cv,ci),mat('#3E4D4F',{side:THREE.DoubleSide}));
 // Arch mouth joins the tunnel to a low natural outcrop, each wedge is nonuniform.
 for(let k=0;k<arc;k++){
  const a=k/arc*Math.PI,b=(k+1)/arc*Math.PI;
  const inner=(t:number)=>[112.85+Math.sin(t*5)*.26,.28+Math.sin(t)*(4.45+Math.sin(t*5)*.14),72+Math.cos(t)*3.05];
  const outer=(t:number)=>[113.4+Math.cos(t*3)*.35,.05+Math.sin(t)*(6.5+Math.sin(t*7)*.45),72+Math.cos(t)*6.1];
  batch.add(quad(inner(a),outer(a),outer(b),inner(b)),stone);
  for(let j=0;j<5;j++){
   const ridge=(t:number,n:number)=>{if(n===0)return outer(t);const rough=Math.sin(t*7+n*1.7)*.28;return[113.5+n*4.05,.12+Math.sin(t)*(6.9-n*.38+rough),72+Math.cos(t)*(6.2-n*.25+rough)];};
   batch.add(quad(ridge(a,j),ridge(a,j+1),ridge(b,j+1),ridge(b,j)),(k+j)%4===0?stoneLight:stone);
  }
 }
 batch.add(rocks[1],stoneDark,132,.1,72,1.7,5.1,3.3);
 // Broken upper strata interrupt the regular sweep of the cave mouth.
 for(const [x,y,z,w,hh,d] of [[114.5,5.2,70.2,2.2,1.4,1.7],[115.8,5.55,73,2.6,.9,2],[121,5.4,71,2.9,1.3,2.4]])batch.add(rocks[1],stone,x,y,z,w,hh,d,0,.17,0);
 // Slumped strata around the entrance; always outside the clear opening.
 for(const s of [-1,1])for(let i=0;i<7;i++){
  const x=112+i*3.5,z=72+s*(5.9+Math.sin(i)*.6);
  batch.add(rocks[i%3],i%2?stone:stoneLight,x,heightAt(x,z)-.22,z,2.9,2.4+rng()*2.3,2.6,0,rng(),0);
 }
 for(let i=0;i<8;i++){
  const x=116+rng()*15,z=72+(rng()-.5)*2.2;
  batch.add(rocks[i%3],stoneDark,x,heightAt(x,z)-.02,z,.2+rng()*.25,.1+rng()*.12,.18+rng()*.2,0,rng()*6,0);
 }
 // Landmark spires are stacked, split strata with a broken cap, not perfect cones.
 for(const [x,z,hh,ww] of [[100,103,18,3.3],[106,104,14,2.7]]){
  for(let j=0;j<4;j++)batch.add(rocks[j%3],j%2?stoneDark:stone,x+j*.18,heightAt(x,z)+j*hh*.21,z,ww*(1-j*.16),hh*.32,ww*.83*(1-j*.12),0,j*.16,0);
 }
 const ice=mat('#A2C8CC',{roughness:.38,metalness:.1});
 for(let i=0;i<14;i++){
  const x=30+(rng()-.5)*9,z=80+(rng()-.5)*9;
  batch.add(rocks[i%3],ice,x,heightAt(x,z)-.025,z,.55+rng(),.25+rng()*.75,.5+rng(),0,rng()*6,0);
 }
 for(const [x,z,type] of [[67,65,0],[83,55,1]]){
  batch.add(rocks[type],stoneDark,x,heightAt(x,z)-.02,z,2,1.65,1.6,0,.3,0);
  const ore=mat(type?'#C48251':'#394E5B',{roughness:.45,metalness:.5});
  for(let i=0;i<10;i++){
   const a=i/10*Math.PI*2;batch.add(rocks[i%3],ore,x+Math.cos(a)*1.23,heightAt(x,z)+.52,z+Math.sin(a)*1.1,.23+rng()*.32,.25+rng()*.42,.27,0,a,.25);
  }
 }
 // Bent, folded blades with lighter tips: 28 triangles per tuft, one instanced draw.
 const gv:number[]=[],gc:number[]=[];
 for(let i=0;i<7;i++){
  const a=i*2.399,h=.36+(i%3)*.12,w=.05+(i%2)*.012,lean=.16+(i%3)*.045;
  const point=(r:number,y:number,side:number)=>[Math.cos(a)*r+Math.sin(a)*side,y,Math.sin(a)*r-Math.cos(a)*side];
  const p0=point(.02,0,-w),p1=point(.02,0,w),p2=point(lean*.35,h*.6,-w*.65),p3=point(lean*.35,h*.6,w*.65),tip=point(lean,h,0);
  gv.push(...p0,...p1,...p2,...p1,...p3,...p2,...p2,...p3,...tip);
  for(let k=0;k<9;k++){color.set(k===8?'#B4B785':k<3?'#485E51':'#829B70');gc.push(color.r,color.g,color.b);}
 }
 const grassGeo=surface(gv);grassGeo.setAttribute('color',new THREE.Float32BufferAttribute(gc,3));
 const grass=new THREE.InstancedMesh(grassGeo,mat('#FFFFFF',{vertexColors:true,side:THREE.DoubleSide}),GRASS.length);
 GRASS.forEach((p,i)=>{dummy.position.set(p.x,heightAt(p.x,p.z),p.z);dummy.scale.setScalar(p.s);dummy.rotation.set(0,p.rotation,0);dummy.updateMatrix();grass.setMatrixAt(i,dummy.matrix);});scene.add(grass);
 batch.finish(scene);

 const skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{top:{value:new THREE.Color('#6E9DAA')},bottom:{value:new THREE.Color('#E4C69D')}},vertexShader:'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'uniform vec3 top;uniform vec3 bottom;varying vec3 vP;void main(){float h=clamp(normalize(vP).y*.95+.1,0.,1.);gl_FragColor=vec4(mix(bottom,top,h),1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'});
 const sky=new THREE.Mesh(new THREE.SphereGeometry(250,24,12),skyMat);sky.renderOrder=-10;scene.add(sky);
 const hemi=new THREE.HemisphereLight('#C5DEDF','#8D8870',2.25);scene.add(hemi);
 const sun=new THREE.DirectionalLight('#FFE3B4',2.6);sun.position.set(-40,55,25);scene.add(sun);
 const light=new THREE.PointLight('#FFCB87',14,11,1.8);light.position.set(40,cy(2),42);scene.add(light);
 const interior=new THREE.PointLight('#D7E7DF',8,7,1.5);interior.position.set(40,cy(2.9),39.5);scene.add(interior);
 const fog=new THREE.Fog('#CBBE9D',70,195);scene.fog=fog;
 function setNight(night:boolean){
  skyMat.uniforms.top.value.set(night?'#0C1A31':'#6E9DAA');skyMat.uniforms.bottom.value.set(night?'#344959':'#E4C69D');
  fog.color.set(night?'#2A3E50':'#CBBE9D');fog.near=night?50:70;fog.far=night?150:195;
  hemi.color.set(night?'#94B8D5':'#C5DEDF');hemi.groundColor.set(night?'#607984':'#8D8870');hemi.intensity=night?1.3:2.25;
  sun.color.set(night?'#91ACCF':'#FFE3B4');sun.intensity=night?.6:2.6;light.intensity=night?22:14;
 }
 return{setNight,followSky:(position:THREE.Vector3)=>sky.position.copy(position),landmarks:LANDMARKS,grassCount:GRASS.length};
}
