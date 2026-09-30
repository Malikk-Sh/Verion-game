import * as THREE from 'three';
import './style.css';
import { installFullscreen } from './fullscreen';
import { createWorld, type Quality } from './scene';
import { Character, type Input } from './controller';
import { Ambience } from './audio';
import { boxes, EYE, FIXED_DT, heightAt, LANDMARKS, ROUTE, MIN, MAX, SIZE, type Landmark } from './world';
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=el<HTMLCanvasElement>('world');
const error=(message:string)=>{el('error-text').textContent=message;el('error').hidden=false;document.body.dataset.ready='error';};

type Settings={quality:Quality;sound:boolean;bob:boolean;fov:number};
function loadSettings():Settings{
 const fallback:Settings={quality:'standard',sound:true,bob:true,fov:70};
 try{const s=JSON.parse(localStorage.getItem('vireon.settings')||'{}');return {quality:['low','standard','high'].includes(s.quality)?s.quality:fallback.quality,sound:typeof s.sound==='boolean'?s.sound:fallback.sound,bob:typeof s.bob==='boolean'?s.bob:fallback.bob,fov:typeof s.fov==='number'&&s.fov>=60&&s.fov<=95?Math.round(s.fov):fallback.fov};}catch{return fallback;}
}
const saveSettings=(s:Settings)=>{try{localStorage.setItem('vireon.settings',JSON.stringify(s));}catch{/* settings are optional */}};
const QUALITY_LABEL:Record<Quality,string>={low:'Графика: экономная',standard:'Графика: стандарт',high:'Графика: высокая'};
/** East is −x: facing +z (north), the camera's right-hand side is −x. */
const bearing=(dx:number,dz:number)=>Math.atan2(-dx,dz);
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));

function boot(){
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
 renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(68,1,.07,1400);
 const world=createWorld(scene),actor=new Character(boxes),audio=new Ambience(),settings=loadSettings();
 const viewDirection=new THREE.Vector3(),viewPos=new THREE.Vector3(),tmp=new THREE.Vector3();
 const keys=new Set<string>(),input:Input={forward:0,right:0,run:false,jump:false};
 let joyX=0,joyY=0,runToggle=false,joyPointer:number|null=null,lookPointer:number|null=null,lastX=0,lastY=0;
 let started=false,running=false,night=false,selected='grass',nearest:Landmark|undefined,activeTime=0,accumulator=0,last=performance.now(),lastUI=0;
 const TITLE_OFFSET=-.42;
 let frames:number[]=[],showMetrics=false,wake=0,bob=0,stride=0,fov=70,titleTime=0,lastObjective='',settingsReturn='welcome';
 const visited=new Set<string>(),discovered=new Set<string>();let dialog='welcome';
 const insideCapsule=(x=actor.x,z=actor.z)=>x>37.5&&x<42.5&&z>37&&z<43.1;

 // ---------- Settings ----------
 function applyQuality(q:Quality){
  settings.quality=q;saveSettings(settings);world.setQuality(q);renderer.shadowMap.enabled=q!=='low';
  renderer.setPixelRatio(q==='high'?Math.min(devicePixelRatio,1.5):1);resize();
  el('quality-label').textContent=QUALITY_LABEL[q];
 }
 function applyBob(on:boolean){settings.bob=on;saveSettings(settings);el('bob-label').textContent=on?'Покачивание: вкл.':'Покачивание: выкл.';el('bob-toggle').setAttribute('aria-pressed',String(on));}
 function applyFov(v:number){settings.fov=Math.max(60,Math.min(95,Math.round(v)));saveSettings(settings);el<HTMLInputElement>('fov-range').value=String(settings.fov);el('fov-value').textContent=`${settings.fov}°`;}
 function applySound(on:boolean){settings.sound=on;saveSettings(settings);audio.setEnabled(on);el('sound-label').textContent=on?'Звук: вкл.':'Звук: выкл.';el('sound-toggle').setAttribute('aria-pressed',String(on));}

 const updateRun=()=>{input.run=runToggle||keys.has('ShiftLeft')||keys.has('ShiftRight');el('run').setAttribute('aria-pressed',String(input.run));};
 function clearInput(){keys.clear();joyX=joyY=0;input.forward=input.right=0;input.jump=false;runToggle=false;joyPointer=lookPointer=null;el('stick').style.transform='translate(0,0)';updateRun();}
 function setDialog(which:string|null){
  clearInput();accumulator=0;last=performance.now();running=which===null;dialog=which||'';
  el('veil').hidden=which===null;
  for(const id of ['welcome','paused','settings','map-panel','info-panel'])el(id).hidden=id!==which;
  document.body.dataset.dialog=which??'';
  document.body.dataset.running=String(running);
  if(which==='map-panel')drawMap();
  if(running)audio.resume();else if(started&&(which==='paused'||which==='settings'))audio.suspend();
 }
 function pause(reason='Пауза'){if(!started)return;el('pause-title').textContent=reason;setDialog('paused');}
 function bootSequence(){
  const lines:[string,string][]=[['Связь с капсулой VE-01','ОК'],['Герметичность шлема','ОК'],['Навигация','ДОЛИНА'],['Сканер местности','АКТИВЕН']];
  const box=el('boot');box.className='';box.replaceChildren(...lines.map(([a,b],i)=>{const d=document.createElement('div');d.style.animationDelay=`${.25+i*.32}s`;d.innerHTML=`${a}<b>${b}</b>`;return d;}));
  document.body.classList.add('booting');audio.tone('boot');
  setTimeout(()=>{box.classList.add('out');document.body.classList.remove('booting');},1900);
  setTimeout(()=>{box.replaceChildren();box.className='';},2800);
 }
 function resume(){
  if(innerHeight>innerWidth||document.hidden)return;
  const first=!started;started=true;document.body.dataset.started='true';setDialog(null);el('start').blur();
  if(first){audio.start();audio.setEnabled(settings.sound);wake=2.6;bootSequence();}
 }
 function resize(){const portrait=innerHeight>innerWidth;el('portrait').hidden=!portrait;renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
  const c=el<HTMLCanvasElement>('compass'),r=c.getBoundingClientRect();c.width=Math.max(1,Math.round(r.width*devicePixelRatio));c.height=Math.max(1,Math.round(r.height*devicePixelRatio));
  if(portrait&&started)pause('Продолжим в горизонтальном режиме');}
 addEventListener('resize',resize);
 addEventListener('blur',()=>pause('Экспедиция приостановлена'));
 document.addEventListener('visibilitychange',()=>{clearInput();if(document.hidden){pause('Экспедиция приостановлена');audio.suspend();}});
 canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();pause();error('Графический контекст был потерян. Перезагрузите сцену — в этом образце прогресс не сохраняется.');});
 installFullscreen(el<HTMLButtonElement>('fullscreen-toggle'),el('fullscreen-status'));
 el('start').onclick=()=>{audio.start();audio.setEnabled(settings.sound);audio.tone('ui');const f=el('fade');f.classList.add('on');setTimeout(()=>{resume();f.classList.remove('on');},550);};
 el('resume').onclick=resume;el('pause-button').onclick=()=>{audio.tone('ui');pause();};
 el('reset').onclick=()=>{actor.reset();resume();};
 el('quality-toggle').onclick=()=>{const order:Quality[]=['low','standard','high'];applyQuality(order[(order.indexOf(settings.quality)+1)%3]);};
 el('sound-toggle').onclick=()=>applySound(!settings.sound);
 el('bob-toggle').onclick=()=>applyBob(!settings.bob);
 el<HTMLInputElement>('fov-range').addEventListener('input',e=>applyFov(Number((e.target as HTMLInputElement).value)));
 const openSettings=()=>{audio.tone('ui');settingsReturn=started?'paused':'welcome';setDialog('settings');};
 el('title-settings').onclick=openSettings;el('settings-button').onclick=openSettings;
 el('settings-back').onclick=()=>{audio.tone('ui');setDialog(settingsReturn);};
 const setNight=(value:boolean,instant=false)=>{night=value;world.setNight(night,instant);el('light-text').textContent=night?'Ночь':'День';el('light-icon').innerHTML=`<svg><use href="#i-${night?'moon':'sun'}"/></svg>`;el('day').setAttribute('aria-pressed',String(night));};
 el('day').onclick=()=>{audio.tone('ui');setNight(!night);};
 el('map-button').onclick=()=>{audio.tone('ui');setDialog('map-panel');};el('close-map').onclick=resume;
 el('close-info').onclick=resume;
 el('metrics-toggle').onclick=()=>{showMetrics=!showMetrics;el('metrics').hidden=!showMetrics;el('metrics-toggle').textContent=showMetrics?'Скрыть показатели сцены':'Показать показатели сцены';};
 el('run').onclick=()=>{if(!running)return;runToggle=!runToggle;updateRun();};
 el('jump').onpointerdown=event=>{event.preventDefault();if(running)input.jump=true;};
 el('progress-bar').replaceChildren(...LANDMARKS.map(()=>document.createElement('i')));

 function toast(kind:string,text:string){const t=el('toast');t.hidden=true;void t.offsetWidth;el('toast-kind').textContent=kind;el('toast-text').textContent=text;t.hidden=false;}
 function inspect(){
  if(!nearest||!running)return;
  visited.add(nearest.id);audio.tone('scan');
  el('info-kind').textContent=nearest.kind;el('info-title').textContent=nearest.name;el('info-text').textContent=nearest.description;
  const y=heightAt(nearest.x,nearest.z),fromCapsule=Math.hypot(nearest.x-40,nearest.z-40);
  const rows:[string,string][]=[['Координаты',`${Math.round(nearest.x)} · ${Math.round(nearest.z)}`],['Высота',`${y>=0?'+':''}${y.toFixed(1)} м`],['От капсулы',`${Math.round(fromCapsule)} м`]];
  el('info-data').replaceChildren(...rows.map(([k,v])=>{const d=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v;d.append(dt,dd);return d;}));
  if(nearest.id===selected)selected=ROUTE.find(id=>!visited.has(id))??'capsule';
  setDialog('info-panel');updateUI();
 }
 el('inspect').onclick=inspect;
 addEventListener('keydown',event=>{
  if(event.code==='Escape'){event.preventDefault();if(dialog==='settings'){setDialog(settingsReturn);return;}if(started){if(running)pause();else resume();}return;}
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

 // ---------- Holographic map (mirrored x so it matches the first-person view: east = −x) ----------
 let mapBase:HTMLCanvasElement|null=null;
 const MAP=480,MARGIN=18,MS=(MAP-2*MARGIN)/SIZE,mpx=(x:number)=>MARGIN+(MAX-x)*MS,mpy=(z:number)=>MAP-MARGIN-(z-MIN)*MS;
 function mapTerrain(){
  // Rendered once: relief shading, height tint and 4 m contours for the whole 560 m square.
  const c=document.createElement('canvas');c.width=c.height=MAP;const ctx=c.getContext('2d')!;ctx.fillStyle='#061518';ctx.fillRect(0,0,MAP,MAP);
  const S=2,N=SIZE/S;
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){const x=MIN+i*S,z=MIN+j*S,h=heightAt(x,z),e=heightAt(x+S,z)-heightAt(x-S,z)-(heightAt(x,z+S)-heightAt(x,z-S)),shade=Math.max(-10,Math.min(14,e*6));
   const band=Math.floor(h/4)!==Math.floor(heightAt(x+S,z)/4)||Math.floor(h/4)!==Math.floor(heightAt(x,z+S)/4);
   ctx.fillStyle=band?`rgba(127,230,218,${h>30?.28:.4})`:`hsl(${182-Math.min(40,h)*.8} ${20+Math.min(30,Math.max(0,h))}% ${Math.max(4,10+Math.min(40,h)*.55+shade)}%)`;
   ctx.fillRect(mpx(x+S),mpy(z+S),S*MS+.6,S*MS+.6);}
  ctx.strokeStyle='rgba(127,230,218,.09)';ctx.lineWidth=1;for(let v=MIN;v<=MAX;v+=80){ctx.beginPath();ctx.moveTo(mpx(v),mpy(MIN));ctx.lineTo(mpx(v),mpy(MAX));ctx.moveTo(mpx(MIN),mpy(v));ctx.lineTo(mpx(MAX),mpy(v));ctx.stroke();}
  ctx.strokeStyle='rgba(242,180,96,.35)';ctx.setLineDash([2,4]);ctx.strokeRect(mpx(160),mpy(160),160*MS,160*MS);ctx.setLineDash([]);
  ctx.font='600 8px ui-monospace,monospace';ctx.fillStyle='rgba(242,180,96,.6)';ctx.textAlign='left';ctx.fillText('ДОЛИНА ПРИБЫТИЯ',mpx(160)+3,mpy(160)+10);
  return c;
 }
 function drawMap(){
  const m=el<HTMLCanvasElement>('map'),ctx=m.getContext('2d')!;mapBase??=mapTerrain();ctx.drawImage(mapBase,0,0);
  ctx.strokeStyle='rgba(242,180,96,.55)';ctx.setLineDash([4,6]);ctx.beginPath();['capsule',...ROUTE].forEach((id,i)=>{const p=LANDMARKS.find(x=>x.id===id)!;i?ctx.lineTo(mpx(p.x),mpy(p.z)):ctx.moveTo(mpx(p.x),mpy(p.z));});ctx.stroke();ctx.setLineDash([]);
  ctx.font='600 9px ui-monospace,monospace';ctx.textAlign='center';
  for(const p of LANDMARKS){const sel=p.id===selected;ctx.save();ctx.translate(mpx(p.x),mpy(p.z));ctx.rotate(Math.PI/4);ctx.fillStyle=sel?'#f2b460':visited.has(p.id)?'rgba(127,230,218,.5)':'#bfeee6';const r=sel?5:3;ctx.fillRect(-r,-r,r*2,r*2);ctx.restore();
   if(sel){ctx.strokeStyle='rgba(242,180,96,.5)';ctx.beginPath();ctx.arc(mpx(p.x),mpy(p.z),11,0,Math.PI*2);ctx.stroke();}
   const far=Math.hypot(p.x-80,p.z-80)>100;if(far||sel){ctx.fillStyle=sel?'#f2b460':'#d7f3ee';ctx.fillText(p.short,mpx(p.x),mpy(p.z)-11);}}
  const x=mpx(actor.x),y=mpy(actor.z);ctx.save();ctx.translate(x,y);ctx.rotate(-actor.yaw);
  ctx.fillStyle='rgba(127,230,218,.16)';ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,34,-Math.PI/2-.6,-Math.PI/2+.6);ctx.fill();
  ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(5.5,6);ctx.lineTo(0,3.5);ctx.lineTo(-5.5,6);ctx.closePath();ctx.fillStyle='#ffffff';ctx.fill();ctx.restore();
  ctx.font='600 10px ui-monospace,monospace';ctx.fillStyle='rgba(215,236,230,.75)';ctx.textAlign='left';ctx.fillText('С ↑',MARGIN+2,MARGIN+10);
  // Scale bar: 100 m.
  ctx.fillRect(MAP-MARGIN-100*MS,MAP-MARGIN+6,100*MS,2);ctx.textAlign='right';ctx.fillText('100 м',MAP-MARGIN,MAP-MARGIN+2);
  el('landmark-list').replaceChildren(...LANDMARKS.map(p=>{const button=document.createElement('button');const d=Math.round(Math.hypot(p.x-actor.x,p.z-actor.z));button.innerHTML='';const name=document.createElement('b');name.textContent=p.name;const meta=document.createElement('small');meta.textContent=`${d} м`;button.append(name,meta);button.setAttribute('aria-label',p.name);button.setAttribute('aria-pressed',String(p.id===selected));const span=document.createElement('span');span.textContent=visited.has(p.id)?'✓':'◇';button.append(span);button.onclick=()=>{selected=p.id;audio.tone('ui');resume();updateUI();};return button;}));
 }
 // ---------- Compass strip ----------
 const compass=el<HTMLCanvasElement>('compass'),cctx=compass.getContext('2d')!;
 const DIRS=['С','СВ','В','ЮВ','Ю','ЮЗ','З','СЗ'];
 function drawCompass(heading:number){
  const w=compass.width,h=compass.height,dpr=devicePixelRatio,span=Math.PI*.95;if(!w)return;
  cctx.clearRect(0,0,w,h);const X=(a:number)=>w/2+wrap(a-heading)/span*w;
  const grad=cctx.createLinearGradient(0,0,w,0);grad.addColorStop(0,'rgba(233,245,241,0)');grad.addColorStop(.2,'rgba(233,245,241,.85)');grad.addColorStop(.8,'rgba(233,245,241,.85)');grad.addColorStop(1,'rgba(233,245,241,0)');
  cctx.fillStyle=grad;cctx.strokeStyle=grad;cctx.lineWidth=dpr;
  cctx.beginPath();cctx.moveTo(0,h*.62);cctx.lineTo(w,h*.62);cctx.globalAlpha=.25;cctx.stroke();cctx.globalAlpha=1;
  for(let d=0;d<360;d+=5){const a=d*Math.PI/180,x=X(a);if(Math.abs(wrap(a-heading))>span/2)continue;const major=d%45===0;cctx.fillRect(x-dpr/2,h*(major?.44:d%15===0?.5:.55),dpr,h*(major?.18:d%15===0?.12:.07));
   if(major){cctx.font=`600 ${9*dpr}px ui-monospace,monospace`;cctx.textAlign='center';cctx.fillText(DIRS[d/45],x,h*.36);}}
  for(const p of LANDMARKS){const a=bearing(p.x-actor.x,p.z-actor.z),rel=wrap(a-heading);if(Math.abs(rel)>span/2)continue;const x=X(a),sel=p.id===selected;
   cctx.save();cctx.translate(x,h*.82);cctx.rotate(Math.PI/4);cctx.fillStyle=sel?'#f2b460':visited.has(p.id)?'rgba(127,230,218,.45)':'rgba(191,238,230,.9)';const r=(sel?4:2.5)*dpr;cctx.fillRect(-r,-r,r*2,r*2);cctx.restore();}
  cctx.fillStyle='#f2b460';cctx.beginPath();cctx.moveTo(w/2-4*dpr,0);cctx.lineTo(w/2+4*dpr,0);cctx.lineTo(w/2,5*dpr);cctx.fill();
 }
 const marker=el('target-marker');
 function updateMarker(){
  const t=LANDMARKS.find(p=>p.id===selected)!;const d=Math.hypot(actor.x-t.x,actor.z-t.z);
  tmp.set(t.x,heightAt(t.x,t.z)+2.4,t.z).project(camera);
  const visible=started&&running&&d>t.radius*.6&&tmp.z<1&&Math.abs(tmp.x)<1.1&&Math.abs(tmp.y)<1.1;
  marker.style.opacity=visible?'1':'0';
  if(visible){marker.style.transform=`translate(${(tmp.x*.5+.5)*innerWidth}px,${Math.max(innerHeight<500?92:118,(-tmp.y*.5+.5)*innerHeight)}px) translate(-50%,-50%)`;el('marker-distance').textContent=`${Math.round(d)} м`;}
 }
 function objective(){
  if(visited.size>=LANDMARKS.length)return insideCapsule()||Math.hypot(actor.x-40,actor.z-40)<8?'Маршрут завершён: все места осмотрены. Спасибо, что прошли B4':'Участок изучен. Возвращайтесь к капсуле';
  if(insideCapsule())return 'Выйдите из капсулы и осмотритесь';
  if(visited.size===0)return 'Отсканируйте капсулу или ближайшее место — кнопка «Сканировать»';
  if(visited.size<LANDMARKS.length)return `Исследуйте окрестности: следуйте метке на компасе (${visited.size} из ${LANDMARKS.length})`;
  return 'Участок изучен. Возвращайтесь к капсуле';
 }
 function updateUI(){
  const target=LANDMARKS.find(p=>p.id===selected)!;
  const d=Math.hypot(actor.x-target.x,actor.z-target.z);el('target-name').textContent=target.name;el('target-distance').textContent=`${Math.round(d)} м`;
  const angle=Math.atan2(target.x-actor.x,target.z-actor.z)-actor.yaw;(document.querySelector('.nav-arrow') as HTMLElement).style.transform=`rotate(${-angle}rad)`;
  nearest=LANDMARKS.filter(p=>Math.hypot(actor.x-p.x,actor.z-p.z)<=p.radius).sort((a,b)=>Math.hypot(actor.x-a.x,actor.z-a.z)-Math.hypot(actor.x-b.x,actor.z-b.z))[0];
  el('discovery').hidden=!nearest;document.body.dataset.near=String(!!nearest);
  if(nearest){el('discovery-kind').textContent=nearest.kind;el('discovery-title').textContent=nearest.name;
   if(started&&!discovered.has(nearest.id)){discovered.add(nearest.id);if(nearest.id!=='capsule'){toast('Новое место',nearest.name);audio.tone('discover');}}}
  el('progress').textContent=`ОСМОТРЕНО ${visited.size} / ${LANDMARKS.length}`;
  [...el('progress-bar').children].forEach((c,i)=>c.classList.toggle('on',i<visited.size));
  el('coords').textContent=`X ${String(Math.round(actor.x)).padStart(3,'0')} · Z ${String(Math.round(actor.z)).padStart(3,'0')}`;
  const o=objective();if(o!==lastObjective){lastObjective=o;el('objective-text').textContent=o;const ob=el('objective');ob.classList.remove('pulse');void ob.offsetWidth;ob.classList.add('pulse');}
 }
 function state(){const sorted=[...frames].sort((a,b)=>a-b);return {ready:true,version:'B4',grassCount:world.grassCount,fullscreen:!!document.fullscreenElement,running,dialog,night,selected,visited:[...visited],activeTime:Number(activeTime.toFixed(3)),position:{x:actor.x,y:actor.y,z:actor.z},yaw:actor.yaw,pitch:actor.pitch,grounded:actor.grounded,input:{...input,joyX,joyY,joyPointer,lookPointer},quality:settings.quality,sound:settings.sound,bob:settings.bob,fov:settings.fov,fineTerrainBlocks:world.terrain.fineBlocks,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,frameP95Ms:sorted[Math.floor(sorted.length*.95)]??0,viewport:{width:innerWidth,height:innerHeight},renderer:renderer.getContext().getParameter(renderer.getContext().VERSION)};}
 Object.defineProperty(window,'__vireon',{value:{getState:state},writable:false});

 const draw=(now:number)=>{
  const actualFrameMs=now-last;const dt=Math.min(actualFrameMs/1000,.25);last=now;
  if(running){
   input.forward=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)+joyY;
   input.right=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+joyX;
   accumulator+=dt;while(accumulator>=FIXED_DT){const px=actor.x,pz=actor.z;actor.step(FIXED_DT,input);input.jump=false;activeTime+=FIXED_DT;accumulator-=FIXED_DT;
    const moved=Math.hypot(actor.x-px,actor.z-pz);if(actor.grounded&&moved>0){stride+=moved;bob+=moved*(input.run?2.4:2.9);if(stride>(input.run?.82:.68)){stride=0;audio.step(input.run,insideCapsule());}}}
  }
  if(!started){
   // Title cinematic: a slow arc around the capsule with the spires behind.
   // Title shot: low, slow orbit; capsule sits in the right third, horizon and sky stay in frame.
   titleTime+=dt;const a=1.05+Math.sin(titleTime*.02)*.18,r=17+Math.sin(titleTime*.05)*1.2,cx=40+Math.cos(a)*r,cz=40+Math.sin(a)*r;
   const h0=heightAt(cx,cz),ya=Math.atan2(40-cz,40-cx)+TITLE_OFFSET;
   camera.position.set(cx,h0+1.9+Math.sin(titleTime*.07)*.25,cz);camera.lookAt(cx+Math.cos(ya)*30,h0+5.2,cz+Math.sin(ya)*30);
  }else{
   const a=running?accumulator/FIXED_DT:1;
   wake=Math.max(0,wake-(running?dt:0));const w=wake/2.6,ease=w*w*(3-2*w);
   const moving=running&&(Math.abs(input.forward)+Math.abs(input.right))>.1&&actor.grounded;
   const bobOn=moving&&settings.bob,bobY=bobOn?Math.sin(bob*2)*.028:0,bobX=bobOn?Math.cos(bob)*.018:0;
   viewPos.set(THREE.MathUtils.lerp(actor.previous.x,actor.x,a),THREE.MathUtils.lerp(actor.previous.y,actor.y,a)+EYE+bobY-ease*.25,THREE.MathUtils.lerp(actor.previous.z,actor.z,a));
   viewPos.x+=Math.cos(actor.yaw)*bobX;viewPos.z-=Math.sin(actor.yaw)*bobX;camera.position.copy(viewPos);
   const pitch=actor.pitch-ease*.45;
   viewDirection.set(Math.sin(actor.yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(actor.yaw)*Math.cos(pitch));camera.lookAt(tmp.copy(viewPos).add(viewDirection));
   if(ease>0)camera.rotateZ(Math.sin(ease*3)*.06*ease);
   const targetFov=settings.fov+(input.run&&moving&&settings.bob?6:0);fov+=(targetFov-fov)*Math.min(1,dt*6);if(Math.abs(camera.fov-fov)>.01){camera.fov=fov;camera.updateProjectionMatrix();}
  }
  // Explicit pause (and settings opened from it) freezes the whole scene, not only the controller.
  const frozen=started&&(dialog==='paused'||dialog==='settings');
  world.update(frozen?0:dt,camera,renderer);renderer.render(scene,camera);
  if(!frozen)audio.update(dt,started&&insideCapsule()?1:0,world.nightValue);
  if(started){drawCompass(bearing(Math.sin(actor.yaw),Math.cos(actor.yaw)));updateMarker();}
  if(running&&dt>0){frames.push(actualFrameMs);if(frames.length>180)frames.shift();}
  if(now-lastUI>150){updateUI();lastUI=now;if(showMetrics){const s=state();const ob=el('objective').getBoundingClientRect();el('metrics').style.top=`${Math.round(ob.bottom+8)}px`;el('metrics').textContent=`B4 / WebGL2 / DPR ${renderer.getPixelRatio()} / ${settings.quality}\nВызовы: ${s.drawCalls} · треуг.: ${s.triangles}\nКадр p95: ${s.frameP95Ms.toFixed(1)} мс\nX ${actor.x.toFixed(1)} · Z ${actor.z.toFixed(1)}\nЭто замер текущего браузера`;}}
  requestAnimationFrame(draw);
 };
 document.body.dataset.started='false';applyQuality(settings.quality);applySound(settings.sound);applyBob(settings.bob);applyFov(settings.fov);fov=settings.fov;setNight(false,true);updateUI();
 document.body.dataset.ready='true';document.body.dataset.running='false';requestAnimationFrame(draw);
}
try { boot(); } catch(e){ console.error(e);error('Нужен браузер с WebGL 2. Попробуйте обновить браузер или открыть сцену на другом устройстве. '+(e instanceof Error?e.message:'')); }
