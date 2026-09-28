import * as THREE from 'three';
import './style.css';
import { createWorld } from './scene';
import { Character, type Input } from './controller';
import { boxes, EYE, FIXED_DT, heightAt, LANDMARKS, ROUTE, SIZE, type Landmark } from './world';
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=el<HTMLCanvasElement>('world');
const error=(message:string)=>{el('error-text').textContent=message;el('error').hidden=false;document.body.dataset.ready='error';};
try { boot(); } catch(e){ console.error(e);error('Нужен браузер с WebGL 2. Попробуйте обновить браузер или открыть сцену на другом устройстве. '+(e instanceof Error?e.message:'')); }
function boot(){
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1));renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.03;
 const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(68,1,.07,290);
 const world=createWorld(scene),actor=new Character(boxes),viewDirection=new THREE.Vector3(),viewPos=new THREE.Vector3();
 const keys=new Set<string>(),input:Input={forward:0,right:0,run:false,jump:false};
 let joyX=0,joyY=0,runToggle=false,joyPointer:number|null=null,lookPointer:number|null=null,lastX=0,lastY=0;
 let started=false,running=false,night=false,selected='grass',nearest:Landmark|undefined,activeTime=0,accumulator=0,last=performance.now(),lastUI=0;
 let frames:number[]=[],showMetrics=false;
 const visited=new Set<string>();let dialog='welcome';
 const updateRun=()=>{input.run=runToggle||keys.has('ShiftLeft')||keys.has('ShiftRight');el('run').setAttribute('aria-pressed',String(input.run));};
 function clearInput(){keys.clear();joyX=joyY=0;input.forward=input.right=0;input.jump=false;runToggle=false;joyPointer=lookPointer=null;el('stick').style.transform='translate(0,0)';updateRun();}
 function setDialog(which:string|null){
  clearInput();accumulator=0;last=performance.now();running=which===null;dialog=which||'';
  el('veil').hidden=which===null;
  for(const id of ['welcome','paused','map-panel','info-panel'])el(id).hidden=id!==which;
  document.body.dataset.running=String(running);
  if(which==='map-panel')drawMap();
 }
 function pause(reason='Пауза'){if(!started)return;el('pause-title').textContent=reason;setDialog('paused');}
 function resume(){if(innerHeight>innerWidth||document.hidden)return;started=true;setDialog(null);el('start').blur();}
 function resize(){const portrait=innerHeight>innerWidth;el('portrait').hidden=!portrait;renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();if(portrait&&started)pause('Продолжим в горизонтальном режиме');}
 addEventListener('resize',resize);resize();
 addEventListener('blur',()=>pause('Осмотр приостановлен'));
 document.addEventListener('visibilitychange',()=>{clearInput();if(document.hidden)pause('Осмотр приостановлен');});
 canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();pause();error('Графический контекст был потерян. Перезагрузите сцену — в этом макете прогресс не сохраняется.');});
 el('start').onclick=resume;el('resume').onclick=resume;el('pause-button').onclick=()=>pause();
 el('reset').onclick=()=>{actor.reset();resume();};
 const setNight=(value:boolean)=>{night=value;world.setNight(night);el('light-text').textContent=night?'Ночь':'День';el('light-icon').textContent=night?'☾':'☀';el('day').setAttribute('aria-pressed',String(night));};
 el('day').onclick=()=>setNight(!night);
 el('map-button').onclick=()=>setDialog('map-panel');el('close-map').onclick=resume;
 el('close-info').onclick=resume;
 el('metrics-toggle').onclick=()=>{showMetrics=!showMetrics;el('metrics').hidden=!showMetrics;el('metrics-toggle').textContent=showMetrics?'Скрыть показатели сцены':'Показать показатели сцены';};
 el('run').onclick=()=>{if(!running)return;runToggle=!runToggle;updateRun();};
 el('jump').onpointerdown=event=>{event.preventDefault();if(running)input.jump=true;};
 function inspect(){
  if(!nearest||!running)return;
  visited.add(nearest.id);el('info-kind').textContent=nearest.kind;el('info-title').textContent=nearest.name;el('info-text').textContent=nearest.description;
  if(nearest.id===selected)selected=ROUTE.find(id=>!visited.has(id))??'capsule';
  setDialog('info-panel');updateUI();
 }
 el('inspect').onclick=inspect;
 addEventListener('keydown',event=>{
  if(event.code==='Escape'){event.preventDefault();if(started){if(running)pause();else resume();}return;}
  if(event.code==='KeyM'&&started&&!event.repeat){event.preventDefault();if(dialog==='map-panel')resume();else setDialog('map-panel');return;}
  if(!running)return;
  if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight','KeyE'].includes(event.code))event.preventDefault();
  keys.add(event.code);if(event.code==='Space'&&!event.repeat)input.jump=true;
  if(event.code==='KeyE'&&!event.repeat)inspect();updateRun();
 });
 addEventListener('keyup',event=>{keys.delete(event.code);updateRun();});
 const stick=el('joystick');
 const capture=(target:HTMLElement,event:PointerEvent)=>{try{target.setPointerCapture(event.pointerId);}catch{/* Synthetic pointer events have no OS capture; real pointers do. */}};
 function moveStick(event:PointerEvent){const r=stick.getBoundingClientRect();let x=event.clientX-(r.left+r.width/2),y=event.clientY-(r.top+r.height/2);const len=Math.hypot(x,y),max=39;if(len>max){x*=max/len;y*=max/len;}joyX=x/max;joyY=-y/max;if(Math.abs(joyX)<.1)joyX=0;if(Math.abs(joyY)<.1)joyY=0;el('stick').style.transform=`translate(${x}px,${y}px)`;}
 stick.addEventListener('pointerdown',event=>{if(!running||joyPointer!==null)return;event.preventDefault();joyPointer=event.pointerId;capture(stick,event);moveStick(event);});
 stick.addEventListener('pointermove',event=>{if(joyPointer===event.pointerId){event.preventDefault();moveStick(event);}});
 const releaseStick=(event:PointerEvent)=>{if(joyPointer===event.pointerId){joyPointer=null;joyX=joyY=0;el('stick').style.transform='translate(0,0)';}};
 for(const type of ['pointerup','pointercancel','lostpointercapture'])stick.addEventListener(type,releaseStick as EventListener);
 canvas.addEventListener('pointerdown',event=>{if(!running||lookPointer!==null)return;event.preventDefault();lookPointer=event.pointerId;lastX=event.clientX;lastY=event.clientY;capture(canvas,event);el('look-hint').hidden=true;});
 canvas.addEventListener('pointermove',event=>{if(lookPointer!==event.pointerId||!running)return;actor.yaw-=(event.clientX-lastX)*.004;actor.pitch=Math.max(-1.25,Math.min(1.25,actor.pitch-(event.clientY-lastY)*.003));lastX=event.clientX;lastY=event.clientY;});
 const releaseLook=(event:PointerEvent)=>{if(lookPointer===event.pointerId)lookPointer=null;};
 for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,releaseLook as EventListener);
 canvas.addEventListener('contextmenu',event=>event.preventDefault());
 function drawMap(){
  const m=el<HTMLCanvasElement>('map'),ctx=m.getContext('2d')!;ctx.fillStyle='#243536';ctx.fillRect(0,0,480,480);
  const margin=24,s=432/SIZE,px=(x:number)=>margin+x*s,py=(z:number)=>480-margin-z*s;
  for(let z=0;z<SIZE;z+=4)for(let x=0;x<SIZE;x+=4){const h=heightAt(x,z);ctx.fillStyle=`hsl(${100+h*2} 9% ${28+h*1.6}%)`;ctx.fillRect(px(x),py(z+4),4*s+1,4*s+1);}
  ctx.strokeStyle='#FFFFFF13';ctx.lineWidth=1;for(let i=0;i<=160;i+=40){ctx.beginPath();ctx.moveTo(px(i),py(0));ctx.lineTo(px(i),py(160));ctx.moveTo(px(0),py(i));ctx.lineTo(px(160),py(i));ctx.stroke();}
  ctx.strokeStyle='#DEB57588';ctx.setLineDash([4,6]);ctx.beginPath();['capsule',...ROUTE].forEach((id,i)=>{const p=LANDMARKS.find(x=>x.id===id)!;i?ctx.lineTo(px(p.x),py(p.z)):ctx.moveTo(px(p.x),py(p.z));});ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle='#DFB8781C';ctx.fillRect(px(50),py(52),16*s,16*s);
  ctx.font='bold 9px system-ui';ctx.textAlign='center';
  for(const p of LANDMARKS){ctx.beginPath();ctx.arc(px(p.x),py(p.z),p.id===selected?6:4,0,Math.PI*2);ctx.fillStyle=p.id===selected?'#F2C985':visited.has(p.id)?'#ABBFA9':'#D0D7CB';ctx.fill();ctx.fillStyle='#E4E9DC';ctx.fillText(p.short,px(p.x),py(p.z)-11);}
  const x=px(actor.x),y=py(actor.z);ctx.save();ctx.translate(x,y);ctx.rotate(actor.yaw);ctx.beginPath();ctx.moveTo(0,-10);ctx.lineTo(6,7);ctx.lineTo(0,4);ctx.lineTo(-6,7);ctx.closePath();ctx.fillStyle='#FFF8E7';ctx.fill();ctx.strokeStyle='#243536';ctx.lineWidth=2;ctx.stroke();ctx.restore();
  ctx.font='11px system-ui';ctx.fillStyle='#C6D0C5';ctx.textAlign='left';ctx.fillText('С ↑',27,17);ctx.fillText('0',24,475);ctx.textAlign='right';ctx.fillText('160 м',457,475);
  el('landmark-list').replaceChildren(...LANDMARKS.map(p=>{const button=document.createElement('button');button.textContent=p.name;button.setAttribute('aria-pressed',String(p.id===selected));const span=document.createElement('span');span.textContent=visited.has(p.id)?'✓':'↗';button.append(span);button.onclick=()=>{selected=p.id;resume();updateUI();};return button;}));
 }
 function updateUI(){
  const target=LANDMARKS.find(p=>p.id===selected)!;
  const d=Math.hypot(actor.x-target.x,actor.z-target.z);el('target-name').textContent=target.name;el('target-distance').textContent=`${Math.round(d)} м`;
  const angle=Math.atan2(target.x-actor.x,target.z-actor.z)-actor.yaw;(document.querySelector('.nav-arrow') as HTMLElement).style.transform=`rotate(${-angle}rad)`;
  nearest=LANDMARKS.filter(p=>Math.hypot(actor.x-p.x,actor.z-p.z)<=p.radius).sort((a,b)=>Math.hypot(actor.x-a.x,actor.z-a.z)-Math.hypot(actor.x-b.x,actor.z-b.z))[0];
  el('discovery').hidden=!nearest;if(nearest){el('discovery-kind').textContent=nearest.kind;el('discovery-title').textContent=nearest.name;}
  el('progress').textContent=`Осмотрено ${visited.size} / ${LANDMARKS.length}`;
 }
 function state(){const sorted=[...frames].sort((a,b)=>a-b);return {ready:true,running,dialog,night,selected,visited:[...visited],activeTime:Number(activeTime.toFixed(3)),position:{x:actor.x,y:actor.y,z:actor.z},yaw:actor.yaw,pitch:actor.pitch,grounded:actor.grounded,input:{...input,joyX,joyY,joyPointer,lookPointer},drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,frameP95Ms:sorted[Math.floor(sorted.length*.95)]??0,viewport:{width:innerWidth,height:innerHeight},renderer:renderer.getContext().getParameter(renderer.getContext().VERSION)};}
 Object.defineProperty(window,'__vireon',{value:{getState:state},writable:false});
 const draw=(now:number)=>{
  const actualFrameMs=now-last;const dt=Math.min(actualFrameMs/1000,.25);last=now;
  if(running){
   input.forward=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)+joyY;
   input.right=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+joyX;
   accumulator+=dt;while(accumulator>=FIXED_DT){actor.step(FIXED_DT,input);input.jump=false;activeTime+=FIXED_DT;accumulator-=FIXED_DT;}
  }
  if(!started){camera.position.set(57,5.8,22);camera.lookAt(67,2,78);}
  else{
   const a=running?accumulator/FIXED_DT:1;viewPos.set(THREE.MathUtils.lerp(actor.previous.x,actor.x,a),THREE.MathUtils.lerp(actor.previous.y,actor.y,a)+EYE,THREE.MathUtils.lerp(actor.previous.z,actor.z,a));camera.position.copy(viewPos);
   viewDirection.set(Math.sin(actor.yaw)*Math.cos(actor.pitch),Math.sin(actor.pitch),Math.cos(actor.yaw)*Math.cos(actor.pitch));camera.lookAt(viewPos.add(viewDirection));
  }
  world.followSky(camera.position);renderer.render(scene,camera);
  if(running&&dt>0){frames.push(actualFrameMs);if(frames.length>180)frames.shift();}
  if(now-lastUI>150){updateUI();lastUI=now;if(showMetrics){const s=state();el('metrics').textContent=`B1 / WebGL2 / DPR ${renderer.getPixelRatio()}\nВызовы: ${s.drawCalls} · треуг.: ${s.triangles}\nКадр p95: ${s.frameP95Ms.toFixed(1)} мс\nX ${actor.x.toFixed(1)} · Z ${actor.z.toFixed(1)}\nЭто замер текущего браузера`;}}
  requestAnimationFrame(draw);
 };
 setNight(false);updateUI();document.body.dataset.ready='true';document.body.dataset.running='false';requestAnimationFrame(draw);
}
