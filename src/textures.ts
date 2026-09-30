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
/** Hull panels: seams, rivets, grime from dust storms and a burnt skirt. */
export function hullTextures(){
 const W=1024,H=512,[c,x]=canvas(W,H),rng=random(333);
 x.fillStyle='#d9d8cf';x.fillRect(0,0,W,H);
 for(let i=0;i<9000;i++){x.fillStyle=`rgba(${rng()<.5?'60,55,45':'255,255,250'},${rng()*.05})`;x.fillRect(rng()*W,rng()*H,1+rng()*3,1+rng()*3);}
 // Dust accumulates low; rain-like streaks run down from seams.
 const g=x.createLinearGradient(0,H,0,H*.45);g.addColorStop(0,'rgba(132,104,70,.55)');g.addColorStop(.35,'rgba(150,120,85,.2)');g.addColorStop(1,'rgba(150,120,85,0)');x.fillStyle=g;x.fillRect(0,0,W,H);
 const burn=x.createLinearGradient(0,H,0,H*.86);burn.addColorStop(0,'rgba(38,32,28,.85)');burn.addColorStop(1,'rgba(38,32,28,0)');x.fillStyle=burn;x.fillRect(0,0,W,H);
 for(let i=0;i<70;i++){const sx=rng()*W,sy=rng()*H*.6,len=40+rng()*160;const s=x.createLinearGradient(0,sy,0,sy+len);s.addColorStop(0,'rgba(95,80,60,.16)');s.addColorStop(1,'rgba(95,80,60,0)');x.fillStyle=s;x.fillRect(sx,sy,1+rng()*2.5,len);}
 const hgt=new Float32Array(W*H).fill(1);
 const seam=(x0:number,y0:number,x1:number,y1:number)=>{x.strokeStyle='rgba(40,48,50,.75)';x.lineWidth=2.2;x.beginPath();x.moveTo(x0,y0);x.lineTo(x1,y1);x.stroke();x.strokeStyle='rgba(255,255,255,.35)';x.lineWidth=1;x.beginPath();x.moveTo(x0+1.5,y0+1.5);x.lineTo(x1+1.5,y1+1.5);x.stroke();
  const n=Math.hypot(x1-x0,y1-y0);for(let t=0;t<=n;t++){const px=Math.round(x0+(x1-x0)*t/n),py=Math.round(y0+(y1-y0)*t/n);for(let o=-1;o<=1;o++){const qx=Math.min(W-1,Math.max(0,px+(y0===y1?0:o))),qy=Math.min(H-1,Math.max(0,py+(y0===y1?o:0)));hgt[qy*W+qx]=0;}}};
 for(const v of [0,128,300,420])seam(0,v,W,v);
 for(const u of [0,340,690])seam(u,0,u,H);seam(170,128,170,300);seam(520,300,520,420);seam(860,128,860,300);
 x.fillStyle='rgba(40,46,48,.7)';
 for(const v of [10,118,138,290,310,410,430])for(let u=12;u<W;u+=36){x.beginPath();x.arc(u,v,2.2,0,6.28);x.fill();const i=Math.round(v)*W+u;if(i<hgt.length)hgt[i]=1.6;}
 // Orange service band and small chevrons.
 x.fillStyle='#c96a2c';x.fillRect(0,146,W,20);x.fillStyle='rgba(255,255,255,.18)';x.fillRect(0,146,W,3);
 for(let u=380;u<640;u+=26){x.fillStyle='#2b3538';x.beginPath();x.moveTo(u,440);x.lineTo(u+12,440);x.lineTo(u+24,470);x.lineTo(u+12,470);x.fill();x.fillStyle='#d98a3a';x.beginPath();x.moveTo(u+12,440);x.lineTo(u+24,440);x.lineTo(u+36,470);x.lineTo(u+24,470);x.fill();}
 x.fillStyle='rgba(43,53,56,.85)';x.font='bold 30px sans-serif';x.fillText('VE—01',720,220);x.font='13px sans-serif';x.fillText('VIREON · LANDING MODULE · O₂ 2400',720,244);
 x.fillText('▲ ОСТОРОЖНО: ГОРЯЧИЙ КОЖУХ',40,392);
 const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;map.wrapS=map.wrapT=THREE.RepeatWrapping;
 // Normal map on a quarter-resolution copy of the seam relief keeps start-up cheap.
 const w=W/2,h=H/2,small=new Float32Array(w*h);for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++)small[yy*w+xx]=Math.min(hgt[yy*2*W+xx*2],hgt[yy*2*W+xx*2+1],hgt[(yy*2+1)*W+xx*2]);
 return {map,normalMap:normalFrom(small,w,h,2.2)};
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
