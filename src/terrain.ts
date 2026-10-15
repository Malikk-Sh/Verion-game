import * as THREE from 'three';
import { MIN, MAX, SIZE, gridHeight, FORMATIONS } from './world';

/**
 * Chunked terrain with three static levels of detail.
 * 80 m blocks: a coarse 4 m mesh everywhere, replaced near the viewer by four 40 m chunks on the exact
 * 1 m collision grid (FINE_R), and between that and the quality radius by four 2 m chunks (S4). All levels
 * are built lazily, one chunk per frame; their vertices lie on the same grid points; skirts hide the small
 * cracks between levels.
 */
/** `slope` (1 − n.y over 2 m) and `cavity` come from fixed 1 m-grid stencils in both levels of detail (no colour pop when a
 * block swaps); `surface` receives per-vertex surface weights (x: loose sand for wind ripples). */
export type GroundColor=(x:number,z:number,h:number,slope:number,out:THREE.Color,cavity?:number,surface?:Float32Array)=>THREE.Color;
const BLOCK=80,CHUNK=40,SKIRT=2.5;

function* patchSteps(x0:number,z0:number,len:number,step:number,color:GroundColor){
 const n=Math.round(len/step)+1,pos=new Float32Array((n*n+n*4)*3),nor=new Float32Array(pos.length),col=new Float32Array(pos.length),uv=new Float32Array((n*n+n*4)*2),surf=new Float32Array(uv.length);
 const c=new THREE.Color(),idx:number[]=[],w=new Float32Array(2);
 const H=(x:number,z:number)=>{const ix=Math.max(0,Math.min(SIZE,Math.round(x-MIN))),iz=Math.max(0,Math.min(SIZE,Math.round(z-MIN)));return gridHeight(ix,iz);};
 let k=0;
 // surface.y carries the same 2 m slope to the shader (rock projection and strata), so steep faces match across levels too.
 const put=(x:number,y:number,z:number,nx:number,ny:number,nz:number,slope:number,h:number,cavity=0)=>{
  pos[k*3]=x;pos[k*3+1]=y;pos[k*3+2]=z;nor[k*3]=nx;nor[k*3+1]=ny;nor[k*3+2]=nz;w.fill(0);color(x,z,h,slope,c,cavity,w);col[k*3]=c.r;col[k*3+1]=c.g;col[k*3+2]=c.b;uv[k*2]=x/2.6;uv[k*2+1]=z/2.6;surf[k*2]=w[0];surf[k*2+1]=slope;return k++;
 };
 const normal=(x:number,z:number)=>{const e=step>2?step:1,dx=H(x+e,z)-H(x-e,z),dz=H(x,z+e)-H(x,z-e),l=Math.hypot(dx,2*e,dz);return [-dx/l,2*e/l,-dz/l];};
 for(let j=0;j<n;j++){for(let i=0;i<n;i++){const x=x0+i*step,z=z0+j*step,h=H(x,z),[nx,ny,nz]=normal(x,z);put(x,h,z,nx,ny,nz,groundSlope(H,x,z),h,groundCavity(H,x,z,h));}yield;}
 for(let j=0;j<n-1;j++)for(let i=0;i<n-1;i++){const a=j*n+i;idx.push(a,a+n,a+1,a+1,a+n,a+n+1);}
 // Skirts: each border vertex duplicated downward (same colour and surface), stitched both windings (visible from either side).
 const edges=[[...Array(n).keys()].map(i=>i),[...Array(n).keys()].map(i=>(n-1)*n+i),[...Array(n).keys()].map(j=>j*n),[...Array(n).keys()].map(j=>j*n+n-1)];
 const drop=(v:number)=>{pos[k*3]=pos[v*3];pos[k*3+1]=pos[v*3+1]-SKIRT;pos[k*3+2]=pos[v*3+2];nor.copyWithin(k*3,v*3,v*3+3);col.copyWithin(k*3,v*3,v*3+3);uv.copyWithin(k*2,v*2,v*2+2);surf.copyWithin(k*2,v*2,v*2+2);return k++;};
 for(const e of edges){const low=e.map(drop);
  for(let i=0;i<e.length-1;i++){const a=e[i],b=e[i+1],c2=low[i],d=low[i+1];idx.push(a,c2,b,b,c2,d,a,b,c2,b,d,c2);}}
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('normal',new THREE.BufferAttribute(nor,3));
 g.setAttribute('color',new THREE.BufferAttribute(col,3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));g.setAttribute('surface',new THREE.BufferAttribute(surf,2));
 g.setIndex(idx);g.computeBoundingSphere();g.computeBoundingBox();return g;
}
type Heights=(x:number,z:number)=>number;
/** Colour slope (1 − n.y) over a fixed 2 m span, whatever the mesh step. */
export function groundSlope(H:Heights,x:number,z:number){const sx=(H(x+1,z)-H(x-1,z))/2,sz=(H(x,z+1)-H(x,z-1))/2;return 1-1/Math.hypot(sx,1,sz);}
/** Curvature: 1 m Laplacian plus a broader 4 m one; > 0 in hollows and gullies, < 0 on crests and rims. */
export function groundCavity(H:Heights,x:number,z:number,h=H(x,z)){const l1=H(x+1,z)+H(x-1,z)+H(x,z+1)+H(x,z-1)-4*h,l4=H(x+4,z)+H(x-4,z)+H(x,z+4)+H(x,z-4)-4*h;return Math.max(-1,Math.min(1,l1*2+l4*.5));}

function buildPatch(x:number,z:number,len:number,step:number,color:GroundColor){const task=patchSteps(x,z,len,step,color);let r=task.next();while(!r.done)r=task.next();return r.value;}

type Level='fine'|'mid';
type TerrainBlock={x:number;z:number;coarse:THREE.Mesh;fine:THREE.Mesh[]|null;mid:THREE.Mesh[]|null;want:Level|null;used:number;midUsed:number};
/** S4: fine 1 m chunks within this distance of the viewer (80 m on High); a 2 m middle level from there to the quality radius. */
export const FINE_R=55;
const STEP={fine:1,mid:2} as const;
export class Terrain {
 readonly group=new THREE.Group();
 private blocks:TerrainBlock[]=[];
 private order:typeof this.blocks=[];private lastX=Infinity;private lastZ=Infinity;private generation=0;
 private pending:{block:TerrainBlock;level:Level;parts:THREE.Mesh[];task:ReturnType<typeof patchSteps>}|null=null;
 private radius=110;private fineR=FINE_R;
 constructor(private material:THREE.Material,private color:GroundColor){
  for(let z=MIN;z<MAX;z+=BLOCK)for(let x=MIN;x<MAX;x+=BLOCK){
   const coarse=new THREE.Mesh(buildPatch(x,z,BLOCK,4,color),material);coarse.receiveShadow=true;this.group.add(coarse);
   this.blocks.push({x,z,coarse,fine:null,mid:null,want:null,used:0,midUsed:0});
  }
 }
 setQuality(q:'low'|'standard'|'high'){this.radius=q==='low'?70:q==='standard'?110:140;this.fineR=q==='high'?80:FINE_R;this.lastX=Infinity;}
 private dist(b:{x:number;z:number},p:THREE.Vector3){const dx=Math.max(b.x-p.x,0,p.x-(b.x+BLOCK)),dz=Math.max(b.z-p.z,0,p.z-(b.z+BLOCK));return Math.hypot(dx,dz);}
 /** The level a block shows: the wanted one when complete, else the other built one (no drop to coarse while a level is
  * being built), else the coarse block. */
 private shown(b:TerrainBlock):Level|null{return b.want==='fine'?(b.fine?'fine':b.mid?'mid':null):b.want==='mid'?(b.mid?'mid':b.fine?'fine':null):null;}
 private show(b:TerrainBlock){const s=this.shown(b);b.coarse.visible=!s;if(b.fine)for(const m of b.fine)m.visible=s==='fine';if(b.mid)for(const m of b.mid)m.visible=s==='mid';}
 /** Fine and middle meshes are built row by row within a CPU budget; only complete blocks replace what is shown. */
 update(p:THREE.Vector3,budgetMs=2){
  if(Math.hypot(p.x-this.lastX,p.z-this.lastZ)>=2){this.lastX=p.x;this.lastZ=p.z;this.generation++;
   this.order=[...this.blocks].sort((a,b)=>this.dist(a,p)-this.dist(b,p));
   // Hysteresis: a shown level is kept 10 m (fine) or 15 m (any detail) beyond its threshold.
   for(const b of this.order){const d=this.dist(b,p),s=this.shown(b);
    b.want=d<this.fineR+(s==='fine'?10:0)?'fine':d<this.radius+(s?15:0)?'mid':null;if(b.want==='fine')b.used=this.generation;if(b.want)b.midUsed=this.generation;this.show(b);
   }
   this.evictHidden();
  }
  if(this.pending&&this.pending.block.want!==this.pending.level){for(const m of this.pending.parts){this.group.remove(m);m.geometry.dispose();}this.pending=null;}
  if(!this.pending){const block=this.order.find(b=>b.want&&!b[b.want]);if(!block)return;const level=block.want!;this.pending={block,level,parts:[],task:patchSteps(block.x,block.z,CHUNK,STEP[level],this.color)};}
  const deadline=performance.now()+budgetMs;
  while(this.pending&&performance.now()<deadline){const r=this.pending.task.next();if(!r.done)continue;
   const m=new THREE.Mesh(r.value,this.material);m.receiveShadow=true;m.visible=false;this.group.add(m);this.pending.parts.push(m);
   const {block:b,level,parts}=this.pending;
   if(parts.length===4){b[level]=parts;this.show(b);this.pending=null;this.evictHidden();}
   else{const i=parts.length;this.pending.task=patchSteps(b.x+(i%2)*CHUNK,b.z+Math.floor(i/2)*CHUNK,CHUNK,STEP[level],this.color);}
   break; // one upload-sized mesh per rendered frame
  }
 }
 /** Also prune on completion: waiting until the next movement lets a stationary cache exceed its limit. Shown meshes stay. */
 private evictHidden(){
  for(const level of ['fine','mid'] as const){const cached=this.blocks.filter(b=>b[level]),limit=(this.radius<=70?20:32)*(level==='mid'?1.5:1),key=level==='fine'?'used':'midUsed';let count=cached.length;
   for(const b of cached.filter(b=>b.want!==level&&this.shown(b)!==level).sort((a,b)=>a[key]-b[key])){if(count<=limit)break;for(const m of b[level]!){this.group.remove(m);m.geometry.dispose();}b[level]=null;count--;}}
 }
 /** Fine and middle blocks built so far (for the metrics overlay). */
 get fineBlocks(){return this.blocks.filter(b=>b.fine).length;}
 get midBlocks(){return this.blocks.filter(b=>b.mid).length;}
}

/**
 * Baked sun visibility on a 4 m grid: terrain self-shadowing plus large rock formations.
 * Replaces shadow-map shadows from mountains, which popped in and out at the edge of the
 * moving shadow frustum (B3 video). Small objects still use the real shadow map.
 * S1: the sun moves with the day cycle, so the bake is incremental — `step(rows)` computes a
 * few rows per frame into a back texture; the material cross-fades between two textures.
 */
export function createShadeBaker(extra:{x:number;z:number;r:number;top:number}[]=[]){
 const S=4,N=SIZE/S+1,occ=new Float32Array(N*N);
 for(let j=0;j<N;j++)for(let i=0;i<N;i++)occ[j*N+i]=gridHeight(i*S,j*S);
 const stamp=(x:number,z:number,r:number,top:number)=>{for(let j=Math.max(0,Math.floor((z-r-MIN)/S));j<=Math.min(N-1,Math.ceil((z+r-MIN)/S));j++)for(let i=Math.max(0,Math.floor((x-r-MIN)/S));i<=Math.min(N-1,Math.ceil((x+r-MIN)/S));i++){
  const d=Math.hypot(MIN+i*S-x,MIN+j*S-z)/r;if(d<1)occ[j*N+i]=Math.max(occ[j*N+i],top-(top-occ[j*N+i])*d*d*.6);}};
 for(const f of FORMATIONS)stamp(f.x,f.z,f.w*1.1,f.base+f.h*.92);
 for(const e of extra)stamp(e.x,e.z,e.r,e.top);
 const O=(x:number,z:number)=>{const gx=Math.max(0,Math.min(N-1.001,(x-MIN)/S)),gz=Math.max(0,Math.min(N-1.001,(z-MIN)/S)),ix=Math.floor(gx),iz=Math.floor(gz),u=gx-ix,v=gz-iz,a=occ[iz*N+ix],b=occ[iz*N+ix+1],c=occ[(iz+1)*N+ix],d=occ[(iz+1)*N+ix+1];return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;};
 const make=()=>{const t=new THREE.DataTexture(new Uint8Array(N*N*4),N,N);t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearFilter;t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;return t;};
 const textures=[make(),make()];for(const t of textures){(t.image.data as Uint8Array).fill(255);t.needsUpdate=true;}
 let back=0,row=N,column=0,dx=0,dz=0,tan=0;
 const sun=new THREE.Vector3();
 function begin(dir:THREE.Vector3){sun.copy(dir);if(sun.y<.04)sun.y=.04;const hl=Math.hypot(sun.x,sun.z)||1;dx=sun.x/hl;dz=sun.z/hl;tan=sun.y/hl;row=0;column=0;}
 /** Computes up to `rows` grid rows; returns true when the back texture is complete. */
 function step(rows:number,budgetMs=Infinity){
  const deadline=performance.now()+budgetMs;
  const data=textures[back].image.data as Uint8Array;
  for(const end=Math.min(N,row+rows);row<end;row++){const j=row;
   for(;column<N;column++){const i=column;
    if(i%8===0&&performance.now()>=deadline)return false;
    const x=MIN+i*S,z=MIN+j*S,h0=occ[j*N+i]+.4;let res=1;
    for(let t=3;t<260;t+=t<40?3:6){const ox=x+dx*t,oz=z+dz*t;if(ox<MIN-300||ox>MAX+300||oz<MIN-300||oz>MAX+300)break;const ray=h0+t*tan,o=ox<MIN||ox>MAX||oz<MIN||oz>MAX?O(ox,oz)+Math.max(0,Math.max(MIN-ox,ox-MAX,MIN-oz,oz-MAX))*.3:O(ox,oz);
     res=Math.min(res,(ray-o)/(t*.07)+.5);if(res<=0)break;}
    const v=Math.max(0,Math.min(1,res));data[(j*N+i)*4]=Math.round(v*v*(3-2*v)*255);data[(j*N+i)*4+3]=255;
   }column=0;}
  if(row>=N){textures[back].needsUpdate=true;return true;}
  return false;
 }
 /** After a completed bake: the finished texture becomes the target of the cross-fade; the other one is next to be written. */
 function flip(){const done=textures[back];back=1-back;return done;}
 return {N,textures,begin,step,flip,get busy(){return row<N;},min:new THREE.Vector2(MIN-S/2,MIN-S/2),size:new THREE.Vector2(N*S,N*S)};
}
export type ShadeUniforms={uBake:{value:THREE.Texture};uBake2:{value:THREE.Texture};uBakeMix:{value:number};uBakeMin:{value:THREE.Vector2};uBakeSize:{value:THREE.Vector2};uBakeAmount:{value:number}};

/** Patch any standard material so directional light is attenuated by the baked sun shade. */
export function useBakedShade(m:THREE.Material,uniforms:ShadeUniforms,previous?:(s:THREE.WebGLProgramParametersWithUniforms,r:THREE.WebGLRenderer)=>void){
 m.onBeforeCompile=(s,r)=>{
  previous?.(s,r);Object.assign(s.uniforms,uniforms);
  s.vertexShader='varying vec2 vBakeXZ;\n'+s.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
  vec4 bakeW=vec4(transformed,1.0);
  #ifdef USE_INSTANCING
   bakeW=instanceMatrix*bakeW;
  #endif
  vBakeXZ=(modelMatrix*bakeW).xz;`);
  s.fragmentShader='varying vec2 vBakeXZ;uniform sampler2D uBake,uBake2;uniform vec2 uBakeMin,uBakeSize;uniform float uBakeAmount,uBakeMix;\n'+s.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
  vec2 bakeUV=(vBakeXZ-uBakeMin)/uBakeSize;float bakeV=mix(1.0,mix(texture2D(uBake,bakeUV).r,texture2D(uBake2,bakeUV).r,uBakeMix),uBakeAmount);
  reflectedLight.directDiffuse*=bakeV;reflectedLight.directSpecular*=bakeV;`);
 };
 const key=previous?'baked-'+m.uuid:'baked-shade';m.customProgramCacheKey=()=>key;m.needsUpdate=true;
}
