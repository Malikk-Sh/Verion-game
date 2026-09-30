import * as THREE from 'three';
/** Procedural sky: warm low sun, layered haze, slow clouds; stars and a faint galactic band at night. */
export function createSky(){
 const uniforms={
  sunDir:{value:new THREE.Vector3(.93,.22,.3).normalize()},
  night:{value:0},time:{value:0},
 };
 const material=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,uniforms,
  vertexShader:`varying vec3 vDir;void main(){vDir=normalize(position);vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=p.xyww;}`,
  fragmentShader:`uniform vec3 sunDir;uniform float night;uniform float time;varying vec3 vDir;
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
   // Thin high clouds, lit by the sun during the day, faintly blue at night.
   vec2 cp=d.xz/(y+.12)*1.6+vec2(time*.004,time*.0015);
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
/** Drifting dust motes near the camera: sells scale and wind. */
export function createDust(count=420){
 const g=new THREE.BufferGeometry(),p=new Float32Array(count*3),seed=new Float32Array(count);
 for(let i=0;i<count;i++){p[i*3]=(Math.random()-.5)*50;p[i*3+1]=Math.random()*4.5;p[i*3+2]=(Math.random()-.5)*50;seed[i]=Math.random();}
 g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('seed',new THREE.BufferAttribute(seed,1));
 const uniforms={time:{value:0},origin:{value:new THREE.Vector3()},tint:{value:new THREE.Color('#fff1d6')},opacity:{value:.55}};
 const m=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms,
  vertexShader:`attribute float seed;uniform float time;uniform vec3 origin;varying float vA;
  void main(){vec3 p=position;p.x+=time*(.9+seed*.8);p.z+=sin(time*.3+seed*20.)*1.5;p.y+=sin(time*.7+seed*40.)*.4;
   p.xz=mod(p.xz-origin.xz+25.,50.)-25.+origin.xz;p.y+=origin.y-2.;
   vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;float dist=-mv.z;
   gl_PointSize=clamp(26./dist,1.,3.5);vA=smoothstep(22.,3.,dist)*smoothstep(.3,1.5,dist)*(.35+seed*.65);}`,
  fragmentShader:`uniform vec3 tint;uniform float opacity;varying float vA;void main(){float r=length(gl_PointCoord-.5);gl_FragColor=vec4(tint,(1.-smoothstep(.2,.5,r))*vA*opacity);}`});
 const points=new THREE.Points(g,m);points.frustumCulled=false;return {points,uniforms};
}
