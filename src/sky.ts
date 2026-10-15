import * as THREE from 'three';
/** Procedural sky: warm low sun, layered haze, slow clouds; stars and a faint galactic band at night. */
export function createSky(){
 const uniforms={
  sunDir:{value:new THREE.Vector3(.93,.22,.3).normalize()},
  night:{value:0},time:{value:0},cloud:{value:new THREE.Vector2()},
 };
 const material=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,uniforms,
  vertexShader:`varying vec3 vDir;void main(){vDir=normalize(position);vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=p.xyww;}`,
  fragmentShader:`uniform vec3 sunDir;uniform float night;uniform float time;uniform vec2 cloud;varying vec3 vDir;
  float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
  float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=n(p)*a;p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
  void main(){
   vec3 d=normalize(vDir);float y=d.y;float sd=max(dot(d,sunDir),0.);
   // Day: dusty teal zenith, warm amber horizon, bright forward scattering round the sun.
   vec3 zen=vec3(.19,.34,.48),hor=vec3(.86,.72,.55),low=vec3(.70,.58,.45);
   vec3 day=mix(hor,zen,pow(clamp(y,0.,1.),.55));day=mix(day,low,smoothstep(.02,-.25,y));
   day+=vec3(1.,.72,.4)*pow(sd,6.)*.55+vec3(1.,.85,.6)*pow(sd,48.)*.8;
   day+=vec3(1.,.95,.82)*smoothstep(.9994,.9998,sd)*6.;
   // Night: deep blue, lighter haze near horizon.
   vec3 nz=vec3(.018,.035,.08),nh=vec3(.10,.15,.22);
   vec3 nig=mix(nh,nz,pow(clamp(y,0.,1.),.45));
   vec2 sp=vec2(atan(d.z,d.x)*80.,asin(clamp(y,-1.,1.))*80.);vec2 cell=floor(sp);float r=h(cell);
   float star=step(.985,r)*smoothstep(.5,.0,length(fract(sp)-.5))*(.5+.5*sin(time*2.+r*80.));
   float band=exp(-pow(dot(d,normalize(vec3(.3,.55,-.78))),2.)*14.)*fbm(d.xz*9.+d.y*3.);
   nig+=vec3(.9,.95,1.)*star*smoothstep(0.,.12,y)*1.4+vec3(.28,.32,.45)*band*.35*smoothstep(0.,.3,y);
   vec3 col=mix(day,nig,night);
   // Decorative gas giant: banded disc lit from the sun's side, thin atmosphere rim, faint at noon.
   {vec3 pd=normalize(vec3(-.42,.62,.83));float r=.13,c=dot(d,pd);float ang=acos(clamp(c,-1.,1.));
    if(ang<r*1.35){vec3 ax=normalize(cross(pd,vec3(0.,1.,0.))),ay=cross(ax,pd);vec2 q=vec2(dot(d-pd*c,ax),dot(d-pd*c,ay))/r;float rr=length(q);
     float disc=smoothstep(1.,.985,rr);float z=sqrt(max(0.,1.-rr*rr));vec3 nrm=normalize(ax*q.x+ay*q.y+pd*z*-1.);
     float lit=clamp(dot(-nrm,normalize(sunDir))*1.1+.12,0.,1.);float lat=q.y*.94+q.x*.34;
     vec3 band=mix(vec3(.80,.62,.46),vec3(.56,.40,.32),.5+.5*sin(lat*15.+fbm(q*3.)*2.6));band=mix(band,vec3(.92,.86,.74),smoothstep(.55,.95,sin(lat*7.3+1.)));
     float storm=smoothstep(.16,.0,length(q-vec2(.32,-.28)));band=mix(band,vec3(.86,.48,.3),storm*.8);
     vec3 pc=band*(lit*1.15+.05)+vec3(.35,.5,.75)*pow(1.-z,3.)*.35;
     float vis=mix(.62,1.,night)*smoothstep(-.02,.06,y);
     col=mix(col,pc,disc*vis);
     float rim=smoothstep(1.3,1.,rr)*smoothstep(.95,1.05,rr);col+=vec3(.55,.75,1.)*rim*.35*vis*(.35+lit);}}
   // Thin high clouds, lit by the sun during the day, faintly blue at night; they drift with the shared wind (S4).
   vec2 cp=d.xz/(y+.12)*1.6-cloud;
   float c=smoothstep(.55,.9,fbm(cp))*smoothstep(0.,.25,y);
   vec3 cc=mix(vec3(1.,.9,.78)+vec3(.35,.2,.05)*pow(sd,4.),vec3(.16,.2,.28),night);
   col=mix(col,cc,c*.42);
   gl_FragColor=vec4(col,1.);
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
  }`});
 const mesh=new THREE.Mesh(new THREE.SphereGeometry(900,48,24),material);mesh.renderOrder=-10;mesh.frustumCulled=false;
 return {mesh,uniforms};
}
/**
 * Wind-blown dust motes (S4): one instanced draw call of soft streaks stretched along the shared wind,
 * brighter towards the sun by day (forward scattering), faint and cool at night, denser in gusts. Seeds are
 * static; only uniforms change, and they advance on the frozen scene step, so paused frames do not move.
 */
export const MOTES={low:{count:96,box:32},standard:{count:320,box:40},high:{count:640,box:50}} as const;
export function createMotes(max=640){
 const g=new THREE.InstancedBufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));g.setIndex([0,1,2,0,2,3]);
 // Deterministic seeds: the same motes in every session and every test.
 const seed=new Float32Array(max*4);let r=91813;const rnd=()=>{r=(Math.imul(r,1664525)+1013904223)>>>0;return r/4294967296;};for(let i=0;i<seed.length;i++)seed[i]=rnd();
 g.setAttribute('aSeed',new THREE.InstancedBufferAttribute(seed,4));g.instanceCount=MOTES.standard.count;
 const uniforms={uOffset:{value:new THREE.Vector2()},uBox:{value:40},uTime:{value:0},uWind:{value:new THREE.Vector3(1.5,0,0)},uGust:{value:.55},uOrigin:{value:new THREE.Vector3()},
  uSun:{value:new THREE.Vector3(0,1,0)},uNight:{value:0},uTint:{value:new THREE.Color('#fff1d6')},uOpacity:{value:.5},uPx:{value:200}};
 const m=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms,
  vertexShader:`attribute vec4 aSeed;uniform vec2 uOffset;uniform float uBox,uTime,uGust,uPx;uniform vec3 uWind,uOrigin;varying vec3 vView;varying vec2 vQ;varying float vLen,vA;
  void main(){
   vec3 p;p.xz=aSeed.xz*uBox+uOffset+vec2(sin(uTime*.6+aSeed.w*31.),cos(uTime*.45+aSeed.w*17.))*1.1;
   p.xz=mod(p.xz-uOrigin.xz+uBox*.5,uBox)-uBox*.5+uOrigin.xz;p.y=uOrigin.y-1.8+aSeed.y*4.5+sin(uTime*.7+aSeed.w*40.)*.3;
   vec4 hv=viewMatrix*vec4(p,1.),tv=viewMatrix*vec4(p-uWind*(.07+.09*uGust),1.);float dist=-hv.z;
   vView=p-cameraPosition;
   // Screen-space streak from the tail to the head, at least 1.5 px wide (alpha compensates for the widening).
   vec2 hs=hv.xy/max(dist,.05),ts=tv.xy/max(-tv.z,.05),d=(hs-ts)*uPx;float len=length(d);vec2 dir=len>.3?d/len:vec2(1.,0.);if(len>48.){ts=hs-dir*48./uPx;len=48.;}
   float rw=(.014+.02*aSeed.w)/max(dist,.05)*uPx,rp=max(rw,1.5);
   vec2 s=(position.x<0.?ts:hs)*uPx+(dir*position.x+vec2(-dir.y,dir.x)*position.y)*rp;
   gl_Position=dist>.05?projectionMatrix*vec4(s/uPx*dist,-dist,1.):vec4(0.,0.,2.,1.);
   vQ=vec2((position.x+1.)*.5*(len+2.*rp)-rp,position.y*rp);vLen=len;
   vA=min(1.,rw/1.5)*smoothstep(.8,2.4,dist)*(1.-smoothstep(13.,uBox*.5,dist))*(.45+.55*aSeed.w)*(.5+.5*uGust)/(1.+len/(24.*rp));
   vQ/=rp;vLen/=rp;}`,
  fragmentShader:`uniform vec3 uSun,uTint;uniform float uNight,uOpacity;varying vec3 vView;varying vec2 vQ;varying float vLen,vA;
  void main(){float dx=max(-vQ.x,0.)+max(vQ.x-vLen,0.);float r=length(vec2(dx,vQ.y));float a=(1.-smoothstep(.3,1.,r))*mix(.55,1.,clamp(vQ.x/max(vLen,.01),0.,1.));
   float scatter=pow(max(dot(normalize(vView),uSun),0.),8.)*(1.-uNight);
   gl_FragColor=vec4(uTint*(1.05+2.6*scatter),min(1.,a*vA*uOpacity*(1.+scatter*1.5)));
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
  }`});
 const mesh=new THREE.Mesh(g,m);mesh.frustumCulled=false;mesh.renderOrder=5;mesh.name='dust-motes';
 let quality:keyof typeof MOTES='standard';
 return {mesh,uniforms,
  setQuality(q:keyof typeof MOTES){quality=q;g.instanceCount=Math.min(max,MOTES[q].count);uniforms.uBox.value=MOTES[q].box;},
  get count(){return mesh.visible?g.instanceCount:0;},get quality(){return quality;}};
}
