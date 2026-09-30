import * as THREE from 'three';
import { fbm, noise2 } from './noise';
import { random } from './world';

const canvas=(w:number,h:number)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return [c,c.getContext('2d')!] as const;};
/** Height field → tangent-space normal map. */
function normalFrom(height:Float32Array,w:number,h:number,strength:number){
 const data=new Uint8Array(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const l=height[y*w+(x+w-1)%w],r=height[y*w+(x+1)%w],u=height[((y+h-1)%h)*w+x],d=height[((y+1)%h)*w+x];
  let nx=(l-r)*strength,ny=(u-d)*strength,nz=1;const len=Math.hypot(nx,ny,nz);nx/=len;ny/=len;nz/=len;
  const i=(y*w+x)*4;data[i]=(nx*.5+.5)*255;data[i+1]=(ny*.5+.5)*255;data[i+2]=(nz*.5+.5)*255;data[i+3]=255;
 }
 const t=new THREE.DataTexture(data,w,h);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.needsUpdate=true;return t;
}
/** Tileable ground detail: grit, pebbles and soft wind ripples (grey, tinted by vertex colour). */
export function groundTextures(){
 const S=256,rng=random(9151),height=new Float32Array(S*S),col=new Uint8Array(S*S*4);
 const tile=(x:number,y:number,f:number,seed:number)=>{ // periodic noise via 4-corner blend
  const u=x/S,v=y/S;
  return noise2(x*f/S*8,y*f/S*8,seed)*(1-u)*(1-v)+noise2((x-S)*f/S*8,y*f/S*8,seed)*u*(1-v)+noise2(x*f/S*8,(y-S)*f/S*8,seed)*(1-u)*v+noise2((x-S)*f/S*8,(y-S)*f/S*8,seed)*u*v;
 };
 for(let y=0;y<S;y++)for(let x=0;x<S;x++){
  const n=tile(x,y,1,3)*.5+tile(x,y,2,7)*.3+tile(x,y,4,9)*.2;
  height[y*S+x]=n*.6+(rng()-.5)*.35;
 }
 // Pebbles: small raised discs with a darker rim.
 for(let i=0;i<340;i++){
  const cx=rng()*S,cy=rng()*S,r=1+rng()*rng()*4.5,shade=rng();
  for(let y=-6;y<=6;y++)for(let x=-6;x<=6;x++){const d=Math.hypot(x,y)/r;if(d>1)continue;const px=((Math.floor(cx)+x)%S+S)%S,py=((Math.floor(cy)+y)%S+S)%S;height[py*S+px]+=(1-d*d)*1.2;col[(py*S+px)*4+3]=Math.max(col[(py*S+px)*4+3],Math.round(40+shade*120));}
 }
 for(let i=0;i<S*S;i++){
  const h=height[i],peb=col[i*4+3]/255;
  const v=Math.max(0,Math.min(255,208+h*26-peb*55));
  col[i*4]=v;col[i*4+1]=Math.max(0,v-4-peb*6);col[i*4+2]=Math.max(0,v-10-peb*8);col[i*4+3]=255;
 }
 const map=new THREE.DataTexture(col,S,S);map.wrapS=map.wrapT=THREE.RepeatWrapping;map.generateMipmaps=true;map.minFilter=THREE.LinearMipmapLinearFilter;map.magFilter=THREE.LinearFilter;map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;map.needsUpdate=true;
 return {map,normalMap:normalFrom(height,S,S,1.6)};
}
/**
 * Hull panels: seams, rivets, grime, burnt skirt and markings.
 * `faces` gives each octagon face's U range (perimeter-proportional) so every decal is laid out
 * inside one face, clear of the corner ribs, the door and the portholes (B3 text crossed ribs).
 */
export function hullTextures(faces:[number,number,number][]){
 const W=2048,H=512,HM=4.35,[c,x]=canvas(W,H),rng=random(333);
 const Y=(m:number)=>(1-m/HM)*H;                   // metres above the skirt → canvas y
 const U=(face:number,f:number)=>(faces[face][0]+(faces[face][1]-faces[face][0])*f)*W;
 const pxPerM=(face:number)=>(faces[face][1]-faces[face][0])*W/faces[face][2],sy=H/HM;
 x.fillStyle='#d9d8cf';x.fillRect(0,0,W,H);
 for(let i=0;i<16000;i++){x.fillStyle=`rgba(${rng()<.5?'60,55,45':'255,255,250'},${rng()*.05})`;x.fillRect(rng()*W,rng()*H,1+rng()*3,1+rng()*3);}
 const g=x.createLinearGradient(0,H,0,H*.45);g.addColorStop(0,'rgba(132,104,70,.55)');g.addColorStop(.35,'rgba(150,120,85,.2)');g.addColorStop(1,'rgba(150,120,85,0)');x.fillStyle=g;x.fillRect(0,0,W,H);
 const burn=x.createLinearGradient(0,H,0,H*.86);burn.addColorStop(0,'rgba(38,32,28,.85)');burn.addColorStop(1,'rgba(38,32,28,0)');x.fillStyle=burn;x.fillRect(0,0,W,H);
 for(let i=0;i<120;i++){const sx=rng()*W,sy0=rng()*H*.6,len=40+rng()*160;const s=x.createLinearGradient(0,sy0,0,sy0+len);s.addColorStop(0,'rgba(95,80,60,.14)');s.addColorStop(1,'rgba(95,80,60,0)');x.fillStyle=s;x.fillRect(sx,sy0,1+rng()*2.5,len);}
 const hgt=new Float32Array(W*H).fill(1);
 const seam=(x0:number,y0:number,x1:number,y1:number)=>{x.strokeStyle='rgba(40,48,50,.7)';x.lineWidth=2.2;x.beginPath();x.moveTo(x0,y0);x.lineTo(x1,y1);x.stroke();x.strokeStyle='rgba(255,255,255,.32)';x.lineWidth=1;x.beginPath();x.moveTo(x0+1.5,y0+1.5);x.lineTo(x1+1.5,y1+1.5);x.stroke();
  const n=Math.max(1,Math.hypot(x1-x0,y1-y0));for(let t=0;t<=n;t++){const px=Math.round(x0+(x1-x0)*t/n),py=Math.round(y0+(y1-y0)*t/n);for(let o=-1;o<=1;o++){const qx=Math.min(W-1,Math.max(0,px+(y0===y1?0:o))),qy=Math.min(H-1,Math.max(0,py+(y0===y1?o:0)));hgt[qy*W+qx]=0;}}};
 const rivets=(x0:number,x1:number,y:number)=>{x.fillStyle='rgba(40,46,48,.65)';for(let u=x0+10;u<x1-6;u+=32){x.beginPath();x.arc(u,y,2.1,0,6.28);x.fill();const i=Math.round(y)*W+Math.round(u);if(i>=0&&i<hgt.length)hgt[i]=1.6;}};
 const levels=[1.4,2.3,2.9,3.55,4.05];
 for(const m of levels){seam(0,Y(m),W,Y(m));rivets(0,W,Y(m)-9);rivets(0,W,Y(m)+9);}
 for(let f=0;f<8;f++){
  const u0=U(f,0),u1=U(f,1);seam(u0+1,0,u0+1,H);
  // Wide faces get staggered panel joints; door/porthole areas stay plain.
  if(faces[f][2]>4){seam(U(f,.34),Y(2.3),U(f,.34),Y(1.4));seam(U(f,.72),Y(3.55),U(f,.72),Y(2.9));seam(U(f,.5),Y(1.4),U(f,.5),Y(.2));}
  if(faces[f][2]>3&&faces[f][2]<4&&f!==0){seam(U(f,.5),Y(2.9),U(f,.5),Y(.2));}
  rivets(u0,u1,Y(.25));
 }
 // Continuous orange service band just under the shoulder.
 x.fillStyle='#c96a2c';x.fillRect(0,Y(3.4),W,.16*sy);x.fillStyle='rgba(255,255,255,.18)';x.fillRect(0,Y(3.4),W,3);
 // Decal helper: draws text centred at (face, f, metres) with correct metric aspect.
 const text=(face:number,f:number,m:number,str:string,sizeM:number,weight='bold',color='rgba(43,53,56,.88)',maxM=9)=>{
  const k=pxPerM(face);x.save();x.translate(U(face,f),Y(m));x.scale(1,sy/k);x.font=`${weight} ${Math.round(sizeM*k)}px sans-serif`;x.textAlign='center';x.textBaseline='middle';x.fillStyle=color;
  const w=x.measureText(str).width,lim=maxM*k;if(w>lim)x.scale(lim/w,1);x.fillText(str,0,0);x.restore();};
 const chevrons=(face:number,f0:number,f1:number,m0:number,m1:number)=>{const a=U(face,f0),b=U(face,f1),y0=Y(m1),y1=Y(m0),hh=y1-y0;x.save();x.beginPath();x.rect(a,y0,b-a,hh);x.clip();x.fillStyle='#2b3538';x.fillRect(a,y0,b-a,hh);x.fillStyle='#d98a3a';for(let u=a-hh;u<b+hh;u+=hh*1.1){x.beginPath();x.moveTo(u,y1);x.lineTo(u+hh*.55,y1);x.lineTo(u+hh*1.1,y0);x.lineTo(u+hh*.55,y0);x.fill();}x.restore();};
 // Flanks: +x side (face 2) porthole at f≈.54, service panel at f≈.24 below 1.45 m; −x side (face 6) porthole f≈.46, panel f≈.76.
 for(const [face,f] of [[2,.23],[6,.2]] as const){
  text(face,f,2.62,'VE—01',.38,'800','rgba(38,48,52,.92)',1.5);
  text(face,f,2.25,'VIREON · LANDING MODULE',.085,'600','rgba(43,53,56,.8)',1.55);
  text(face,f,2.1,'ЭКСПЕДИЦИЯ 01 · ВЕРДАНА',.075,'500','rgba(43,53,56,.7)',1.55);
 }
 // Back: heat warning above the scorched skirt, fully inside the face.
 text(4,.5,.95,'▲ ОСТОРОЖНО: ГОРЯЧИЙ КОЖУХ',.11,'700','rgba(40,44,46,.85)',2.8);
 text(4,.5,2.62,'VE—01',.3,'800','rgba(38,48,52,.9)',1.2);
 // Door face: hazard chevrons on both jambs, small ID above the lintel.
 chevrons(0,.03,.2,.28,.5);chevrons(0,.8,.97,.28,.5);
 text(0,.5,2.65,'VE—01 · ШЛЮЗ',.1,'700','rgba(43,53,56,.8)',1.4);
 const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=8;map.wrapS=map.wrapT=THREE.ClampToEdgeWrapping;
 const w=W/2,h=H/2,small=new Float32Array(w*h);for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++)small[yy*w+xx]=Math.min(hgt[yy*2*W+xx*2],hgt[yy*2*W+xx*2+1],hgt[(yy*2+1)*W+xx*2]);
 const normalMap=normalFrom(small,w,h,2.2);normalMap.wrapS=normalMap.wrapT=THREE.ClampToEdgeWrapping;
 return {map,normalMap};
}
/** Interior wall panels: padded insulation squares, grey frame, stencil labels. Tiles horizontally. */
export function panelTexture(){
 const W=512,H=512,[c,x]=canvas(W,H),rng=random(71);
 x.fillStyle='#8d9695';x.fillRect(0,0,W,H);
 for(let u=0;u<2;u++)for(let v=0;v<2;v++){const px=u*256,py=v*256;
  const g=x.createLinearGradient(px,py,px,py+256);g.addColorStop(0,'#c8cdc9');g.addColorStop(1,'#a9b0ad');x.fillStyle=g;x.fillRect(px+8,py+8,240,240);
  x.strokeStyle='rgba(255,255,255,.35)';x.lineWidth=2;x.strokeRect(px+10,py+10,236,236);
  // Quilting stitches.
  x.strokeStyle='rgba(70,78,78,.28)';x.lineWidth=1.5;for(let i=1;i<4;i++){x.beginPath();x.moveTo(px+8+i*60,py+14);x.lineTo(px+8+i*60,py+242);x.stroke();}
 }
 x.fillStyle='#3b474a';x.fillRect(0,0,W,6);x.fillRect(0,250,W,12);x.fillRect(0,0,6,H);x.fillRect(250,0,12,H);
 for(let i=0;i<60;i++){x.fillStyle=`rgba(60,50,40,${rng()*.06})`;x.fillRect(rng()*W,rng()*H,2+rng()*20,2+rng()*6);}
 x.fillStyle='rgba(60,70,72,.75)';x.font='bold 13px monospace';x.fillText('VE-01 / 04',24,238);x.fillText('▲ 12 V',280,238);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=4;return t;
}
/** Soft interior liner: quilted panels with warm light pooling. */
export function linerTexture(){
 const W=512,H=256,[c,x]=canvas(W,H);x.fillStyle='#c9cdc4';x.fillRect(0,0,W,H);
 for(let u=0;u<W;u+=128)for(let v=0;v<H;v+=128){const g=x.createRadialGradient(u+64,v+64,8,u+64,v+64,90);g.addColorStop(0,'#dfe2d8');g.addColorStop(1,'#aeb4ab');x.fillStyle=g;x.fillRect(u+3,v+3,122,122);}
 x.fillStyle='#3a474a';for(let u=0;u<W;u+=128)x.fillRect(u,0,3,H);for(let v=0;v<H;v+=128)x.fillRect(0,v,W,3);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;
}
/** Anti-slip grating for floor and ramp. */
export function gratingTexture(){
 const S=256,[c,x]=canvas(S,S);x.fillStyle='#2f3a3d';x.fillRect(0,0,S,S);
 for(let i=0;i<S;i+=32)for(let j=0;j<S;j+=32){x.fillStyle='#56636a';x.fillRect(i+3,j+3,26,26);x.fillStyle='#1d2527';x.fillRect(i+7,j+7,18,18);x.fillStyle='#6f7c80';x.fillRect(i+3,j+3,26,2);}
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;
}
/** Console screen, redrawn on demand with honest status lines (no simulated resources). */
export function consoleScreen(){
 const [c,x]=canvas(512,256),t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
 const draw=(time:number,night:boolean)=>{
  const g=x.createLinearGradient(0,0,0,256);g.addColorStop(0,'#0c2a2e');g.addColorStop(1,'#071619');x.fillStyle=g;x.fillRect(0,0,512,256);
  x.strokeStyle='rgba(120,230,215,.14)';for(let i=0;i<512;i+=16){x.beginPath();x.moveTo(i,0);x.lineTo(i,256);x.stroke();}
  x.fillStyle='#8ff0de';x.font='bold 22px monospace';x.fillText('VE-01 · КАПСУЛА',22,38);
  x.font='16px monospace';x.fillStyle='#b8f5ea';
  const lines=['ГЕРМЕТИЧНОСТЬ ....... НОРМА','НАРУЖНАЯ СРЕДА ... НЕПРИГОДНА','ЛОКАЛЬНОЕ ВРЕМЯ ....... '+(night?'НОЧЬ':'ДЕНЬ'),'НАВИГАЦИЯ .... ДОЛИНА ПРИБЫТИЯ'];
  lines.forEach((l,i)=>x.fillText(l,22,78+i*28));
  x.strokeStyle='#e7a456';x.lineWidth=2;x.beginPath();for(let i=0;i<=200;i++){const px=22+i*2.3,py=222+Math.sin(i*.19+time*2)*9*Math.sin(i*.03+time*.4);i?x.lineTo(px,py):x.moveTo(px,py);}x.stroke();
  x.fillStyle=Math.floor(time*2)%2?'#e7a456':'#6b4a26';x.fillRect(480,24,12,12);
  t.needsUpdate=true;
 };
 draw(0,false);return {texture:t,draw};
}
export { fbm };
