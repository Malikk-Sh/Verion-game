import * as THREE from 'three';
import { MIN, MAX, SIZE, gridHeight, rawHeight, FORMATIONS } from './world';

/**
 * Chunked terrain with two static levels of detail.
 * 80 m blocks: a coarse 4 m mesh everywhere, replaced near the viewer by four 40 m chunks
 * on the exact 1 m collision grid (built lazily, a couple per frame). Coarse vertices lie on
 * the same grid points; skirts hide the small cracks between levels.
 */
export type GroundColor=(x:number,z:number,h:number,slope:number,out:THREE.Color)=>THREE.Color;
const BLOCK=80,CHUNK=40,SKIRT=2.5;

function buildPatch(x0:number,z0:number,len:number,step:number,color:GroundColor){
 const n=Math.round(len/step)+1,pos=new Float32Array((n*n+n*4)*3),nor=new Float32Array(pos.length),col=new Float32Array(pos.length),uv=new Float32Array((n*n+n*4)*2);
 const c=new THREE.Color(),idx:number[]=[];
 const H=(x:number,z:number)=>{const ix=Math.max(0,Math.min(SIZE,Math.round(x-MIN))),iz=Math.max(0,Math.min(SIZE,Math.round(z-MIN)));return gridHeight(ix,iz);};
 let k=0;
 const put=(x:number,y:number,z:number,nx:number,ny:number,nz:number,slope:number,h:number)=>{
  pos[k*3]=x;pos[k*3+1]=y;pos[k*3+2]=z;nor[k*3]=nx;nor[k*3+1]=ny;nor[k*3+2]=nz;color(x,z,h,slope,c);col[k*3]=c.r;col[k*3+1]=c.g;col[k*3+2]=c.b;uv[k*2]=x/2.6;uv[k*2+1]=z/2.6;return k++;
 };
 const normal=(x:number,z:number)=>{const e=step,dx=H(x+e,z)-H(x-e,z),dz=H(x,z+e)-H(x,z-e),l=Math.hypot(dx,2*e,dz);return [-dx/l,2*e/l,-dz/l];};
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){const x=x0+i*step,z=z0+j*step,h=H(x,z),[nx,ny,nz]=normal(x,z);put(x,h,z,nx,ny,nz,1-ny,h);}
 for(let j=0;j<n-1;j++)for(let i=0;i<n-1;i++){const a=j*n+i;idx.push(a,a+n,a+1,a+1,a+n,a+n+1);}
 // Skirts: each border vertex duplicated downward, stitched both windings (visible from either side).
 const edges=[[...Array(n).keys()].map(i=>i),[...Array(n).keys()].map(i=>(n-1)*n+i),[...Array(n).keys()].map(j=>j*n),[...Array(n).keys()].map(j=>j*n+n-1)];
 for(const e of edges){const low=e.map(v=>put(pos[v*3],pos[v*3+1]-SKIRT,pos[v*3+2],nor[v*3],nor[v*3+1],nor[v*3+2],0,pos[v*3+1]));
  for(let i=0;i<e.length-1;i++){const a=e[i],b=e[i+1],c2=low[i],d=low[i+1];idx.push(a,c2,b,b,c2,d,a,b,c2,b,d,c2);}}
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('normal',new THREE.BufferAttribute(nor,3));
 g.setAttribute('color',new THREE.BufferAttribute(col,3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
 g.setIndex(idx);g.computeBoundingSphere();g.computeBoundingBox();return g;
}

export class Terrain {
 readonly group=new THREE.Group();
 private blocks:{x:number;z:number;coarse:THREE.Mesh;fine:THREE.Mesh[]|null;wantFine:boolean}[]=[];
 private radius=110;
 constructor(private material:THREE.Material,private color:GroundColor){
  for(let z=MIN;z<MAX;z+=BLOCK)for(let x=MIN;x<MAX;x+=BLOCK){
   const coarse=new THREE.Mesh(buildPatch(x,z,BLOCK,4,color),material);coarse.receiveShadow=true;this.group.add(coarse);
   this.blocks.push({x,z,coarse,fine:null,wantFine:false});
  }
 }
 setQuality(q:'low'|'standard'|'high'){this.radius=q==='low'?70:q==='standard'?110:140;}
 private dist(b:{x:number;z:number},p:THREE.Vector3){const dx=Math.max(b.x-p.x,0,p.x-(b.x+BLOCK)),dz=Math.max(b.z-p.z,0,p.z-(b.z+BLOCK));return Math.hypot(dx,dz);}
 private buildFine(b:typeof this.blocks[number]){
  b.fine=[];for(const [ox,oz] of [[0,0],[CHUNK,0],[0,CHUNK],[CHUNK,CHUNK]]){const m=new THREE.Mesh(buildPatch(b.x+ox,b.z+oz,CHUNK,1,this.color),this.material);m.receiveShadow=true;m.visible=false;this.group.add(m);b.fine.push(m);}
 }
 /** Swap levels around the viewer; builds at most `budget` blocks of fine chunks per call. */
 update(p:THREE.Vector3,budget=1){
  const order=[...this.blocks].sort((a,b)=>this.dist(a,p)-this.dist(b,p));
  for(const b of order){
   const d=this.dist(b,p);b.wantFine=d<(b.fine&&b.fine[0].visible?this.radius+15:this.radius);
   if(b.wantFine&&!b.fine&&budget>0){this.buildFine(b);budget--;}
   const fine=b.wantFine&&!!b.fine;b.coarse.visible=!fine;if(b.fine)for(const m of b.fine)m.visible=fine;
  }
 }
 /** Fine chunks built so far (for the metrics overlay). */
 get fineBlocks(){return this.blocks.filter(b=>b.fine).length;}
}

/**
 * Baked sun visibility on a 4 m grid: terrain self-shadowing plus large rock formations.
 * Replaces shadow-map shadows from mountains, which popped in and out at the edge of the
 * moving shadow frustum (B3 video). Small objects still use the real shadow map.
 */
export function bakeSunShade(sun:THREE.Vector3,extra:{x:number;z:number;r:number;top:number}[]=[]){
 const S=4,N=SIZE/S+1,occ=new Float32Array(N*N);
 for(let j=0;j<N;j++)for(let i=0;i<N;i++)occ[j*N+i]=gridHeight(i*S,j*S);
 const stamp=(x:number,z:number,r:number,top:number)=>{for(let j=Math.max(0,Math.floor((z-r-MIN)/S));j<=Math.min(N-1,Math.ceil((z+r-MIN)/S));j++)for(let i=Math.max(0,Math.floor((x-r-MIN)/S));i<=Math.min(N-1,Math.ceil((x+r-MIN)/S));i++){
  const d=Math.hypot(MIN+i*S-x,MIN+j*S-z)/r;if(d<1)occ[j*N+i]=Math.max(occ[j*N+i],top-(top-occ[j*N+i])*d*d*.6);}};
 for(const f of FORMATIONS)stamp(f.x,f.z,f.w*1.1,f.base+f.h*.92);
 for(const e of extra)stamp(e.x,e.z,e.r,e.top);
 const O=(x:number,z:number)=>{const gx=Math.max(0,Math.min(N-1.001,(x-MIN)/S)),gz=Math.max(0,Math.min(N-1.001,(z-MIN)/S)),ix=Math.floor(gx),iz=Math.floor(gz),u=gx-ix,v=gz-iz,a=occ[iz*N+ix],b=occ[iz*N+ix+1],c=occ[(iz+1)*N+ix],d=occ[(iz+1)*N+ix+1];return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;};
 const hl=Math.hypot(sun.x,sun.z),dx=sun.x/hl,dz=sun.z/hl,tan=sun.y/hl,data=new Uint8Array(N*N*4);
 for(let j=0;j<N;j++)for(let i=0;i<N;i++){
  const x=MIN+i*S,z=MIN+j*S,h0=occ[j*N+i]+.4;let res=1;
  for(let t=3;t<260;t+=t<40?3:6){const ox=x+dx*t,oz=z+dz*t;if(ox<MIN-300||ox>MAX+300||oz<MIN-300||oz>MAX+300)break;const ray=h0+t*tan,o=ox<MIN||ox>MAX||oz<MIN||oz>MAX?rawHeight(Math.max(MIN,Math.min(MAX,ox)),Math.max(MIN,Math.min(MAX,oz)))+Math.max(0,Math.max(MIN-ox,ox-MAX,MIN-oz,oz-MAX))*.3:O(ox,oz);
   res=Math.min(res,(ray-o)/(t*.07)+.5);if(res<=0)break;}
  const v=Math.max(0,Math.min(1,res));data[(j*N+i)*4]=Math.round(v*v*(3-2*v)*255);data[(j*N+i)*4+3]=255;
 }
 const tex=new THREE.DataTexture(data,N,N);tex.magFilter=THREE.LinearFilter;tex.minFilter=THREE.LinearFilter;tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;tex.needsUpdate=true;
 return {texture:tex,min:new THREE.Vector2(MIN-S/2,MIN-S/2),size:new THREE.Vector2(N*S,N*S)};
}

/** Patch any standard material so directional light is attenuated by the baked sun shade. */
export function useBakedShade(m:THREE.Material,uniforms:{uBake:{value:THREE.Texture};uBakeMin:{value:THREE.Vector2};uBakeSize:{value:THREE.Vector2};uBakeAmount:{value:number}},previous?:(s:THREE.WebGLProgramParametersWithUniforms,r:THREE.WebGLRenderer)=>void){
 m.onBeforeCompile=(s,r)=>{
  previous?.(s,r);Object.assign(s.uniforms,uniforms);
  s.vertexShader='varying vec2 vBakeXZ;\n'+s.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
  vec4 bakeW=vec4(transformed,1.0);
  #ifdef USE_INSTANCING
   bakeW=instanceMatrix*bakeW;
  #endif
  vBakeXZ=(modelMatrix*bakeW).xz;`);
  s.fragmentShader='varying vec2 vBakeXZ;uniform sampler2D uBake;uniform vec2 uBakeMin,uBakeSize;uniform float uBakeAmount;\n'+s.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
  float bakeV=mix(1.0,texture2D(uBake,(vBakeXZ-uBakeMin)/uBakeSize).r,uBakeAmount);
  reflectedLight.directDiffuse*=bakeV;reflectedLight.directSpecular*=bakeV;`);
 };
 const key=previous?'baked-'+m.uuid:'baked-shade';m.customProgramCacheKey=()=>key;m.needsUpdate=true;
}
