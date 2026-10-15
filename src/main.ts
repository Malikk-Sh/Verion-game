import { Diagnostics, observeDiagnostics } from './diagnostics';
import { sceneInterval } from './renderPolicy';
import { createWorldInteraction } from './worldInteraction';
import { stationStatus } from './game/stationStatus';
import { createFx } from './fx';
import { createFootprints, printAllowed } from './footprints';
import { reducedMotion } from './motion';
import { createFeed } from './ui/feed';
import { packStation } from './game/worldActions';
import { countItem } from './game/inventory';
import { createQuestBook } from './ui/quests';
import { refreshQuestProgress } from './game/quests';
import { QUEST_BY_ID, type QuestId } from './game/questCatalog';
import { currentStep, guideStep, stepTarget, progressCount, type GuideTarget } from './game/guide';
import { itemArt } from './ui/art';
import { createProductionPanel } from './ui/production';
import { createBuildings } from './buildings';
import { productionTick, manualWork, releaseHandOnDeath, machine } from './game/production';
import { allRooms, around, breathingRoom, doorById, doorKeys, habitableRoom, removeDoor, removeGlass, roomAtCell, roomDoors, structureRoom, type RoomEdit } from './game/rooms';
import { structureStatus } from './game/stationStatus';
import * as THREE from 'three';
import './style.css';
import './ui/hud.css';
import './ui/motion.css';
import { HUD_GROUPS, HUD_MIN, HUD_MAX, HUD_STEP, HUD_VERSION, loadHudSettings, defaultHudSettings, applyHudSettings, type HudSettings, type HudGroup } from './ui/hud';
import { VISOR_CONTROLS, defaultVisorSettings, parseVisorSettings, applyVisorSettings, type VisorGroup, type VisorSettings } from './ui/visor';
import { installFullscreen } from './fullscreen';
import { createWorld, type Quality } from './scene';
import { Character, type Input } from './controller';
import { Ambience } from './audio';
import { boxes, EYE, FIXED_DT, heightAt, LANDMARKS, ROUTE, MIN, MAX, SIZE, type Landmark } from './world';
import { SimClock } from './game/clock';
import { ITEMS, MATERIALS, TANKS, TOOLS } from './game/defs';
import { phaseSeconds, isDay, offsetFor, MORNING_S, EVENING_S } from './game/daycycle';
import { selectHotbar, oxygenGU, wornParts } from './game/backpack';
import { survivalTick, survivalSpeed, eatPulp, refillCapsule, refillFromCapsule, loseCargo, respawnAtCapsule, accessibleOxygen, CAPSULE_CAPACITY } from './game/survival';
import { createPanels, cellContent, cellAria } from './ui/panels';
import { createViewModel } from './viewmodel';
import { NODES, NODE_BY_ID } from './game/resources';
import { newGame, cloneState, sanitizeState, SPAWN_POSE, HOTBAR_SIZE, type GameState } from './game/state';
import { mineTick, pickUp, toolSlot, itemName, REACH, mineSeconds, type Mining } from './game/mining';
import { natureTick } from './game/nature';
import { SaveStore, SaveError, type SlotRecord } from './persist/store';
import { Saver, type SaverStatus } from './persist/saver';
import { buildExport, exportText, exportFileName, MAX_FILE_BYTES } from './persist/file';
import { importSlot } from './persist/import';
import { openSavedSlot } from './persist/open';
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=el<HTMLCanvasElement>('world');
const error=(message:string)=>{el('error-text').textContent=message;el('error').hidden=false;document.body.dataset.ready='error';};

type Settings={quality:Quality;sound:boolean;bob:boolean;fov:number;hud:HudSettings;hudVersion:number;visor:VisorSettings};
function loadSettings():Settings{
 const fallback:Settings={quality:'standard',sound:true,bob:true,fov:70,hud:defaultHudSettings(),hudVersion:HUD_VERSION,visor:defaultVisorSettings()};
 try{const s=JSON.parse(localStorage.getItem('vireon.settings')||'{}');return {quality:['low','standard','high'].includes(s?.quality)?s.quality:fallback.quality,sound:typeof s?.sound==='boolean'?s.sound:fallback.sound,bob:typeof s?.bob==='boolean'?s.bob:fallback.bob,fov:typeof s?.fov==='number'&&s.fov>=60&&s.fov<=95?Math.round(s.fov):fallback.fov,hud:loadHudSettings(s?.hud,s?.hudVersion),hudVersion:HUD_VERSION,visor:parseVisorSettings(s?.visor)};}catch{return fallback;}
}
const saveSettings=(s:Settings)=>{try{localStorage.setItem('vireon.settings',JSON.stringify(s));}catch{/* settings are optional */}};
const QUALITY_LABEL:Record<Quality,string>={low:'Графика: экономная',standard:'Графика: стандарт',high:'Графика: высокая'};
/** East is −x: facing +z (north), the camera's right-hand side is −x. */
const bearing=(dx:number,dz:number)=>Math.atan2(-dx,dz);
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));

function boot(){
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
 renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
 const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(68,1,.15,1400);
 const fx=createFx(scene,{ground:heightAt}),built=createBuildings(scene,fx),interaction=createWorldInteraction(scene,camera);
 const world=createWorld(scene),actor=new Character(boxes,(a,b,c,d,out)=>built.glass.query(a,b,c,d,out)),audio=new Ambience(),settings=loadSettings();
 world.lightRoots.push(built.root);const prints=createFootprints(scene,heightAt);
 const diagnostics=new Diagnostics(),gl=renderer.getContext(),rendererVersion=String(gl.getParameter(gl.VERSION));
 const gpuExtension=gl.getExtension('WEBGL_debug_renderer_info');
 const deviceInfo={renderer:rendererVersion,gpu:gpuExtension?String(gl.getParameter(gpuExtension.UNMASKED_RENDERER_WEBGL)):'unavailable',cores:navigator.hardwareConcurrency,deviceMemory:(navigator as Navigator&{deviceMemory?:number}).deviceMemory??null,userAgent:navigator.userAgent,parallelShaderCompile:!!gl.getExtension('KHR_parallel_shader_compile'),browserTimings:typeof PerformanceObserver==='undefined'?[]:PerformanceObserver.supportedEntryTypes.filter(t=>['event','longtask','long-animation-frame'].includes(t))};
 applyVisorSettings(settings.visor);
 const viewDirection=new THREE.Vector3(),viewPos=new THREE.Vector3(),shadowAnchor=new THREE.Vector3(),tmp=new THREE.Vector3();
 const keys=new Set<string>(),input:Input={forward:0,right:0,run:false,jump:false};
 let joyX=0,joyY=0,runToggle=false,joyPointer:number|null=null,lookPointer:number|null=null,lastX=0,lastY=0;
 let started=false,running=false,selected='guide',nearest:Landmark|undefined,last=performance.now(),lastDiagnosticFrame=last,hiddenSinceFrame=false,lastUI=0;
 // ---------- S1 game state: one clock, finite deposits, inventory, saves ----------
 const clock=new SimClock(),mining:Mining={nodeId:null,ticks:0};
 let lastSurvivalEvent='none';
 const token=(globalThis.crypto?.randomUUID?.()??Math.random().toString(36).slice(2)+Date.now().toString(36));
 let game:GameState|null=null,store:SaveStore|null=null,saver:Saver|null=null,storeError='',slotId:string|null=null;
 let holdMine=false,holdRefill=false,aimNode:string|null=null,aimReason='',mineRatio=0,strikeClock=0,nearDrop:string|null=null,slots:SlotRecord[]=[],actionKind='none',hudKey='';
 let refillTanks=false;
 let refillMachine:string|null=null,nearMachine:string|null=null;
 // SYSTEMS §1: inventory, crafting, the map and the landmark card keep breathing and hunger running.
 // The journal pauses on purpose (S2.5: reading stops the clock).
 const liveDialogs=new Set(['inventory-panel','suit-panel','production-panel','map-panel','info-panel']);
 // Where the workshop returns when it was opened from the paused journal (null: back to play).
 let workshopReturn:string|null=null;
 const hand=createViewModel();
 const TITLE_OFFSET=-.42;
 let captureRequested:((data:string)=>void)|null=null;
 let sceneReady=false,lastRender=-Infinity,renderElapsed=0,lastRenderedDialog='',renderCalls=0,renderTriangles=0;
 let exported=false,frames:number[]=[],showMetrics=false,wake=0,bob=0,stride=0,fov=70,titleTime=0,lastObjective='',settingsReturn='welcome';
 const visited=new Set<string>(),discovered=new Set<string>();let dialog='welcome';const ALL_DIALOGS=['welcome','paused','settings','hud-settings-panel','visor-settings-panel','quest-panel','map-panel','info-panel','inventory-panel','suit-panel','saves-panel','lease-panel','death-panel','production-panel','diagnostics-panel'];
 const insideCapsule=(x=actor.x,z=actor.z)=>x>37.5&&x<42.5&&z>37&&z<43.1;

 // ---------- Settings ----------
 function applyQuality(q:Quality){
  settings.quality=q;saveSettings(settings);world.setQuality(q);fx.setQuality(q);prints.setQuality(q);renderer.shadowMap.enabled=q!=='low';lastRender=-Infinity;diagnostics.event('quality',0,{quality:q});
  renderer.setPixelRatio(q==='high'?Math.min(devicePixelRatio,1.5):q==='low'?.75:1);resize();
  el('quality-label').textContent=QUALITY_LABEL[q];
 }
 function applyBob(on:boolean){settings.bob=on;saveSettings(settings);el('bob-label').textContent=on?'Покачивание: вкл.':'Покачивание: выкл.';el('bob-toggle').setAttribute('aria-pressed',String(on));}
 function applyFov(v:number){settings.fov=Math.max(60,Math.min(95,Math.round(v)));saveSettings(settings);el<HTMLInputElement>('fov-range').value=String(settings.fov);el('fov-value').textContent=`${settings.fov}°`;}
 function applySound(on:boolean){settings.sound=on;saveSettings(settings);audio.setEnabled(on);el('sound-label').textContent=on?'Звук: вкл.':'Звук: выкл.';el('sound-toggle').setAttribute('aria-pressed',String(on));}

 const updateRun=()=>{input.run=runToggle||keys.has('ShiftLeft')||keys.has('ShiftRight');el('run').setAttribute('aria-pressed',String(input.run));};
 function clearInput(){interaction.cancel();keys.clear();joyX=joyY=0;holdMine=holdRefill=false;refillMachine=null;input.forward=input.right=0;input.jump=false;runToggle=false;joyPointer=lookPointer=null;el('stick').style.transform='translate(0,0)';updateRun();}
 function setDialog(which:string|null){
  if(game?.player.vitals.health===0&&(which===null||liveDialogs.has(which)||['map-panel','info-panel','quest-panel'].includes(which)))which='death-panel';
  clearInput();if(which)el('target-marker').hidden=true;last=performance.now();running=which===null;dialog=which||'';
  if(which!=='production-panel')workshopReturn=null;
  // The clock runs in play and in the inventory (time does not stop there, SYSTEMS §1); every other dialog freezes it.
  // A workshop opened from the paused journal stays frozen and closes back into the pause.
  if(started&&(running||(liveDialogs.has(dialog)&&!workshopReturn))&&!saver?.halted)clock.start();else clock.stop();
  el('veil').hidden=which===null;
  for(const id of ALL_DIALOGS)el(id).hidden=id!==which;
  el('veil').classList.toggle('live',liveDialogs.has(dialog));
  document.body.dataset.dialog=which??'';
  document.body.dataset.running=String(running);
  el('objective').setAttribute('aria-expanded',String(which==='quest-panel'));
  if(which==='quest-panel')questBook.draw();
  if(which==='production-panel')production.draw();if(which==='map-panel')drawMap();if(which==='inventory-panel')panels.drawInventory();if(which==='suit-panel')panels.drawSuit();if(which==='saves-panel')void refreshSlots();if(which==='paused')updatePauseInfo();
  if(running)audio.resume();else if(started&&(which==='paused'||which==='settings'||which==='hud-settings-panel'||which==='visor-settings-panel'))audio.suspend();
 }
 function pause(reason='Пауза'){if(!started)return;el('pause-title').textContent=reason;setDialog('paused');void saver?.save();}
 function bootSequence(){
  const lines:[string,string][]=[['Связь с капсулой VE-01','ОК'],['Герметичность шлема','ОК'],['Навигация','ДОЛИНА'],['Сканер местности','АКТИВЕН']];
  const box=el('boot');box.className='';box.replaceChildren(...lines.map(([a,b],i)=>{const d=document.createElement('div');d.style.animationDelay=`${.25+i*.32}s`;d.innerHTML=`${a}<b>${b}</b>`;return d;}));
  document.body.classList.add('booting');audio.tone('boot');
  setTimeout(()=>{box.classList.add('out');document.body.classList.remove('booting');},1900);
  setTimeout(()=>{box.replaceChildren();box.className='';},2800);
 }
 function resume(){
  if(innerHeight>innerWidth||document.hidden||!game)return;
  if(saver?.halted){showHalt();return;}
  if(game.player.vitals.health<=0){started=true;document.body.dataset.started='true';setDialog('death-panel');return;}
  const first=!started;started=true;document.body.dataset.started='true';setDialog(null);el('start').blur();
  if(first){audio.start();audio.setEnabled(settings.sound);wake=2.6;bootSequence();}
 }
 function refreshHud(){applyHudSettings(settings.hud);
  const c=el<HTMLCanvasElement>('compass'),r=c.getBoundingClientRect();c.width=Math.max(1,Math.round(r.width*devicePixelRatio));c.height=Math.max(1,Math.round(r.height*devicePixelRatio));
 }
 function resize(){lastRender=-Infinity;const portrait=innerHeight>innerWidth;el('portrait').hidden=!portrait;renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();refreshHud();
  if(portrait&&started)pause('Продолжим в горизонтальном режиме');}
 addEventListener('resize',resize);
 addEventListener('blur',()=>pause('Экспедиция приостановлена'));
 document.addEventListener('visibilitychange',()=>{clearInput();if(document.hidden){hiddenSinceFrame=true;clock.stop();pause('Экспедиция приостановлена');audio.suspend();}});
 addEventListener('pagehide',()=>{if(slotId&&store&&!saver?.halted){const id=slotId,st=store;void (saver?saver.save():Promise.resolve()).finally(()=>st.releaseLease(id,token)).catch(()=>{});}});
 canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();pause();error('Графический контекст был потерян. Перезагрузите страницу — мир сохранён на момент последнего автосохранения.');});
 installFullscreen(el<HTMLButtonElement>('fullscreen-toggle'),el('fullscreen-status'));
 const enter=()=>{audio.start();audio.setEnabled(settings.sound);audio.tone('ui');const f=el('fade');f.classList.add('on');setTimeout(()=>{resume();f.classList.remove('on');},550);};
 el('start').onclick=()=>{audio.start();void newExpedition().then(ok=>{if(ok)enter();});};
 el('continue').onclick=()=>{audio.start();if(slots[0])void openSlot(slots[0].id).then(ok=>{if(ok)enter();});};
 el('title-saves').onclick=()=>{audio.tone('ui');setDialog('saves-panel');};
 el('saves-button').onclick=()=>{audio.tone('ui');setDialog('saves-panel');};
 el('close-saves').onclick=()=>{audio.tone('ui');if(started)setDialog('paused');else setDialog('welcome');};
 el('save-now').onclick=()=>{audio.tone('ui');if(!saver){updatePauseInfo('Хранилище недоступно — используйте экспорт');return;}void saver.save().then(()=>updatePauseInfo());};
 el('export-current').onclick=()=>{if(game)downloadExport(snapshot(),saver?.revision??0);else el('saves-status').textContent='Нет открытого мира';};
 el('import-button').onclick=()=>el<HTMLInputElement>('import-file').click();
 el<HTMLInputElement>('import-file').addEventListener('change',e=>{const input=e.target as HTMLInputElement,file=input.files?.[0];input.value='';if(file)void importFile(file);});
 // ---------- Inventory / suit screens (live: game time keeps running) ----------
 const panels=createPanels({game:()=>game,insideCapsule:()=>insideCapsule(),hazard:()=>!insideCapsule()&&!(game&&breathingRoom(game)),tone:k=>audio.tone(k),recipe:id=>production.openRecipe(id),
  changed:what=>{if(what==='drop')syncDrops();hudKey='';updateHotbar();updateVisor();},
  show:which=>{if(started&&(running||liveDialogs.has(dialog)))setDialog(which);},close:()=>{void saver?.save();resume();}});
 const openPanel=(which:'inventory-panel'|'suit-panel')=>{audio.tone('ui');if(dialog===which){void saver?.save();resume();return;}if(running||liveDialogs.has(dialog)){if(which==='inventory-panel'&&dialog!=='suit-panel')panels.reset();setDialog(which);}};
 el('inventory-button').onclick=()=>openPanel('inventory-panel');
 el('close-inventory').onclick=()=>{audio.tone('ui');void saver?.save();resume();};
 let questReturn:string|null=null;
 const questBook=createQuestBook({game:()=>game,show:()=>{questReturn=dialog==='paused'?'paused':null;setDialog('quest-panel');},close:()=>{void saver?.save();if(questReturn)setDialog(questReturn);else resume();},changed:()=>{lastObjective='';updateUI();void saver?.save();},tone:()=>audio.tone('ui'),
  craft:recipeId=>{workshopReturn=questReturn;production.openRecipe(recipeId);},
  navigate:target=>{guideOverride=target;selected='guide';updateUI();}});
 const openQuests=()=>{if(!started||!game||game.player.vitals.health<=0||saver?.halted)return;if(dialog==='quest-panel'){questBook.escape();return;}if(running||liveDialogs.has(dialog)||dialog==='paused')questBook.open();};
 el('quests-button').onclick=openQuests;
 const production=createProductionPanel({game:()=>game,room:{edited:r=>afterEdit(r,false),tint:key=>{if(game)built.glass.tintRooms(game,key,3);}},show:()=>setDialog('production-panel'),close:()=>{void saver?.save();const back=workshopReturn;if(back)setDialog(back);else resume();},changed:()=>{if(game)built.sync(game);world.invalidateShadows();syncDrops();hudKey='';updateHotbar();void saver?.save();},measure:(name,ms)=>{diagnostics.span(name,ms);diagnostics.event(name,ms,{dialog,quality:settings.quality});},refill:id=>{const wasRefilling=refillMachine!==null;refillMachine=id;if(wasRefilling&&!id)void saver?.save();},tone:ok=>audio.tone(ok?'item':'warn'),insideCapsule:()=>insideCapsule(),
  navigate:t=>{guideOverride=t;selected='guide';audio.tone('ui');void saver?.save();resume();updateUI();}});
 el('craft-button').onclick=()=>production.open();

 // ---------- Context action: mine (hold) / pick up / scan, decided by the aim and the selected item ----------
 const actionBtn=el('action');
 const respawnBtn=el<HTMLButtonElement>('respawn-capsule');
 respawnBtn.onclick=()=>{
  if(!game||game.player.vitals.health>0||saver?.halted||respawnBtn.disabled)return;
  respawnBtn.disabled=true;
  respawnAtCapsule(game,heightAt(SPAWN_POSE.x,SPAWN_POSE.z)+.14);actor.reset();
  lastSurvivalEvent='none';hudKey='';updateUI();updateAimUI();
  void (saver?.save()??Promise.resolve()).finally(()=>{respawnBtn.disabled=false;resume();});
 };
 // ---------- Glass blocks and airlocks (S4): place with F (hold for a row), take back with R, confirm venting ----------
 let holdPlace=false,lastPlace=0,pendingRemove:{key:number;until:number;text:string}|null=null;const placedInHold=new Set<number>();
 /** Rebuild, effects and save after a glass/door edit. */
 function afterEdit(r:RoomEdit,save=true){
  if(!game)return;
  if(r.breached&&r.at){built.glass.breach(r.at);audio.hiss();toast('Разгерметизация',`Воздух ушёл: ${Math.ceil(r.ventGU)} GU`);}
  built.sync(game);world.invalidateShadows();hudKey='';updateHotbar();
  if(save)void saver?.save();
 }
 /** One placement from the cell tool; quiet on success (a held F places a row), the reason otherwise. */
 function placeCell(){
  if(!game||!running)return;const r=interaction.placeCell(game);if(!r)return;
  if(r.error){if(!holdPlace||!placedInHold.size){toast('Строительство',r.error);audio.tone('warn');}return;}
  placedInHold.add(r.key);lastPlace=performance.now();audio.tone('ui');afterEdit(r,!holdPlace);interaction.update(game,true);updateAimUI();
 }
 function endHold(){if(holdPlace&&placedInHold.size)void saver?.save();holdPlace=false;placedInHold.clear();}
 /** Takes back the aimed block or airlock; a removal that lets air out asks for a second press within 3 s. */
 function removeStructure(){
  const s=interaction.struck;if(!game||!running||!s)return;
  const confirmed=!!pendingRemove&&pendingRemove.key===s.key&&performance.now()<pendingRemove.until;
  const r=s.door?removeDoor(game,s.door,confirmed):removeGlass(game,s.key,confirmed);
  if(r.needConfirm){pendingRemove={key:s.key,until:performance.now()+3000,text:r.error};built.glass.tintRooms(game,s.key,3);audio.tone('warn');toast('Внимание',r.error);updateAimUI();return;}
  pendingRemove=null;built.glass.clearTint();
  if(r.error){toast('Не удалось забрать',r.error);audio.tone('warn');return;}
  audio.tone('item');if(!r.breached)toast(s.door?'Шлюз в рюкзаке':'Стеклоблок в рюкзаке','Возвращено в рюкзак');afterEdit(r);interaction.update(game,true);updateAimUI();
 }
 /** The room window of the aimed block or airlock; a leaking structure shows its leak path for 6 s. */
 function openStructure(id:string){
  if(!game)return;const key=id.startsWith('glass:')?Number(id.slice(6)):doorKeys(doorById(game,id)!)[0],st=structureStatus(game,key);
  if(st.leak.length)built.glass.showLeak(st.leak,6);production.open(id);
 }
 function retrieveStation(){if(!game||!running)return;if(!nearMachine){removeStructure();return;}const error=packStation(game,nearMachine);toast(error?'Не удалось забрать':'Станция в рюкзаке',error||'Содержимое сохранено');if(!error){built.sync(game);world.invalidateShadows();hudKey='';updateHotbar();void saver?.save();}}
 el('retrieve-station').onclick=retrieveStation;
 const rotateBuild=()=>{if(!running||!(interaction.building||interaction.cellTool))return;interaction.rotate();audio.tone('ui');};
 el('rotate-build').onclick=rotateBuild;
 let lastAction='';
 function doAction(){
  lastAction=`${actionKind}:${running}:${nearMachine??''}`;
  if(!running||!game)return;
  if(interaction.cellTool){placeCell();return;}
  if(actionKind==='room'&&interaction.target){openStructure(interaction.target);return;}
  const before=game.world.base.buildings.length,linksBefore=game.world.base.links.length;
  const result=interaction.action(game);if(result!==null){toast(result?'Действие в мире':'Готово',result||(game.world.base.links.length>linksBefore?'Соединено':'Установлено'));if(!result&&game.world.base.buildings.length>before)audio.tone('discover');
   if(!result&&game.world.base.links.length>linksBefore)audio.tone('item');built.sync(game);world.invalidateShadows();hudKey='';updateHotbar();interaction.update(game,true);updateAimUI();void saver?.save();return;}
  if(actionKind==='capsule')production.open('capsule');
  else if(actionKind==='crate'&&interaction.target)production.open(interaction.target);
  else if(actionKind==='pickup'&&nearDrop){const moved=pickUp(game,nearDrop);audio.tone(moved?'item':'warn');toast(moved?'Поднято':'Рюкзак полон',moved?`${moved} предм.`:'Освободите ячейку');syncDrops();hudKey='';updateHotbar();}
  else if(actionKind==='upgrade'&&nearMachine)production.openUpgrade(nearMachine);
  else if(actionKind==='machine'&&nearMachine)production.open(nearMachine);
  else if(actionKind==='scan')inspect();
  else if(actionKind==='eat' && game && eatPulp(game)==='ate'){ audio.tone('item'); toast('Питание','Пульпа использована · +8 сытости'); hudKey=''; updateVitals(); updateHotbar(); updateAimUI(); }
 }
 actionBtn.addEventListener('pointerdown',e=>{e.preventDefault();if(!running)return;if(interaction.cellTool){holdPlace=game?.player.inventory[game.player.hotbar]?.itemId==='window';placedInHold.clear();capture(actionBtn,e);placeCell();return;}if(actionKind==='mine'||actionKind==='refill'){holdMine=actionKind==='mine';holdRefill=actionKind==='refill';capture(actionBtn,e);}else doAction();});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])actionBtn.addEventListener(type,()=>{if(holdRefill)void saver?.save();holdMine=holdRefill=false;endHold();});
 actionBtn.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&!e.repeat){e.preventDefault();if(actionKind==='mine'||actionKind==='refill'){holdMine=actionKind==='mine';holdRefill=actionKind==='refill';}else doAction();}});
 actionBtn.addEventListener('keyup',()=>{if(holdRefill)void saver?.save();holdMine=holdRefill=false;});
 // ---------- Hotbar: the first six cells of the backpack ----------
 const hotbarSlots=el('hotbar-slots');
 const hotCells=Array.from({length:HOTBAR_SIZE},(_,i)=>{const b=document.createElement('button');b.className='cell hot';b.dataset.hot=String(i);b.onclick=()=>selectSlot(i);hotbarSlots.append(b);return b;});
 function selectSlot(i:number){if(!game||!started)return;if(game.player.hotbar!==i)audio.tone('ui');selectHotbar(game,i);mining.nodeId=null;mining.ticks=0;hudKey='';updateHotbar();}
 function updateHotbar(){
  if(!game)return;const inv=game.player.inventory,key=JSON.stringify([game.player.hotbar,inv.slice(0,HOTBAR_SIZE)]);
  if(key===hudKey)return;hudKey=key;
  hotCells.forEach((c,i)=>{cellContent(c,inv[i],i,{number:false});c.classList.toggle('active',i===game!.player.hotbar);c.setAttribute('aria-label',cellAria(inv[i],i));c.setAttribute('aria-pressed',String(i===game!.player.hotbar));});
  const s=inv[game.player.hotbar];
  el('hotbar-name').textContent=s?ITEMS[s.itemId].name:`Ячейка ${game.player.hotbar+1} пуста`;
  el('hotbar-meta').textContent=!s?'':s.durability!==undefined?`${s.durability} / ${TOOLS[s.itemId].durability}`:s.milliGU!==undefined?`${Math.round(s.milliGU/1000)} GU`:ITEMS[s.itemId].stack>1?`×${s.count}`:'';
  hand.setItem(s?.itemId==='wrench'?'wrench':s&&TOOLS[s.itemId]&&(s.durability??0)>0?s.itemId:null);
  if(dialog==='inventory-panel')panels.drawInventory();
 }
 el('objective').onclick=openQuests;
 el('resume').onclick=resume;el('pause-button').onclick=()=>{audio.tone('ui');pause();};
 el('reset').onclick=()=>{if(saver?.halted)return;actor.reset();resume();};
 el('quality-toggle').onclick=()=>{const order:Quality[]=['low','standard','high'];applyQuality(order[(order.indexOf(settings.quality)+1)%3]);};
 el('sound-toggle').onclick=()=>applySound(!settings.sound);
 el('bob-toggle').onclick=()=>applyBob(!settings.bob);
 el<HTMLInputElement>('fov-range').addEventListener('input',e=>applyFov(Number((e.target as HTMLInputElement).value)));
 const openSettings=()=>{audio.tone('ui');settingsReturn=started?'paused':'welcome';el('hud-preview').hidden=!started;el('visor-preview').hidden=!started;setDialog('settings');};
 el('title-settings').onclick=openSettings;el('settings-button').onclick=openSettings;
 el('settings-back').onclick=()=>{audio.tone('ui');setDialog(settingsReturn);};
 el('hud-settings-button').onclick=()=>{audio.tone('ui');setDialog('hud-settings-panel');};
 el('hud-settings-back').onclick=()=>{audio.tone('ui');setDialog('settings');};
 const hudRanges=new Map<HudGroup,{input:HTMLInputElement;output:HTMLOutputElement}>();
 for(const [key,label] of Object.entries(HUD_GROUPS) as [HudGroup,string][]){
  const row=document.createElement('label'),name=document.createElement('span'),range=document.createElement('input'),output=document.createElement('output');
  row.className='hud-size-row';range.type='range';range.id=`hud-size-${key}`;range.min=String(HUD_MIN);range.max=String(HUD_MAX);range.step=String(HUD_STEP);range.value=String(settings.hud[key]);
  row.htmlFor=range.id;name.textContent=label;output.htmlFor=range.id;output.value=`${settings.hud[key]}%`;
  range.oninput=()=>{settings.hud[key]=Number(range.value);output.value=`${range.value}%`;saveSettings(settings);refreshHud();};
  row.append(name,output,range);el('hud-settings-grid').append(row);hudRanges.set(key,{input:range,output});
 }
 el('hud-reset').onclick=()=>{settings.hud=defaultHudSettings();for(const [key,{input,output}] of hudRanges){input.value=String(settings.hud[key]);output.value=`${settings.hud[key]}%`;}saveSettings(settings);refreshHud();};
 el('hud-preview').onclick=resume;
 el('visor-settings-button').onclick=()=>{audio.tone('ui');setDialog('visor-settings-panel');};
 el('visor-settings-back').onclick=()=>{audio.tone('ui');setDialog('settings');};
 const visorRanges=new Map<VisorGroup,{input:HTMLInputElement;output:HTMLOutputElement}>();
 for(const [key,{label,min,max}] of Object.entries(VISOR_CONTROLS) as [VisorGroup,{label:string;min:number;max:number}][]) {
  const row=document.createElement('label'),name=document.createElement('span'),range=document.createElement('input'),output=document.createElement('output');
  row.className='visor-size-row';range.type='range';range.id=`visor-${key}`;range.min=String(min);range.max=String(max);range.step='5';range.value=String(settings.visor[key]);
  row.htmlFor=range.id;name.textContent=label;output.htmlFor=range.id;output.value=`${settings.visor[key]}%`;
  range.oninput=()=>{settings.visor[key]=Number(range.value);output.value=`${range.value}%`;applyVisorSettings(settings.visor);saveSettings(settings);};
  row.append(name,output,range);el('visor-settings-grid').append(row);visorRanges.set(key,{input:range,output});
 }
 el('visor-reset').onclick=()=>{settings.visor=defaultVisorSettings();for(const [key,{input,output}] of visorRanges){input.value=String(settings.visor[key]);output.value=`${settings.visor[key]}%`;}applyVisorSettings(settings.visor);saveSettings(settings);};
 el('visor-preview').onclick=resume;
 // Day/night follows the game clock (600 s day + 360 s night). The Sun/Moon button skips the light phase only.
 let shownDay:boolean|null=null;
 const dayPhase=()=>game?phaseSeconds(clock.activeTicks,game.world.dayOffsetTicks):516;
 function updateDayButton(){const day=isDay(dayPhase());if(day===shownDay)return;shownDay=day;el('light-text').textContent=day?'День':'Ночь';el('light-icon').innerHTML=`<svg><use href="#i-${day?'sun':'moon'}"/></svg>`;el('day').setAttribute('aria-pressed',String(!day));}
 function toggleDay(){if(!game||!started||saver?.halted)return;audio.tone('ui');const toNight=isDay(dayPhase());game.world.dayOffsetTicks=offsetFor(clock.activeTicks,toNight?EVENING_S:MORNING_S);world.setTime(dayPhase());updateDayButton();toast(toNight?'Ночь':'Утро',toNight?'Солнце зашло':'Рассвет');}
 el('day').onclick=toggleDay;
 // The map keeps time running, so it opens from play or another live panel — never out of the pause.
 const openMap=()=>{if(started&&(running||liveDialogs.has(dialog)))setDialog('map-panel');};
 el('map-button').onclick=()=>{audio.tone('ui');openMap();};el('close-map').onclick=resume;
 el('close-info').onclick=resume;
 function diagnosticContext(){return {quality:settings.quality,dialog,running,visible:!document.hidden,calls:renderCalls,triangles:renderTriangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,fineBlocks:world.terrain.fineBlocks,buildings:game?.world.base.buildings.length??0,links:game?.world.base.links.length??0,activeTicks:clock.activeTicks};}
 function sceneGeometry(){const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)),data:{name:string;material:string;triangles:number;instances:number}[]=[];
  scene.traverseVisible(o=>{const m=o as THREE.Mesh;if(!m.isMesh||!m.geometry||m.frustumCulled&&!frustum.intersectsObject(m))return;const instances=(m as THREE.InstancedMesh).isInstancedMesh?(m as THREE.InstancedMesh).count:1,material=Array.isArray(m.material)?m.material.map(v=>v.name||v.type).join(','):m.material.name||m.material.type;data.push({name:m.name||material,material,instances,triangles:(m.geometry.index?.count??m.geometry.attributes.position.count)/3*instances});});return data.sort((a,b)=>b.triangles-a.triangles);
 }
 function diagnosticReport(){return diagnostics.report({...deviceInfo,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,renderDpr:renderer.getPixelRatio()},context:diagnosticContext(),sceneGeometry:sceneGeometry(),asset:[...document.querySelectorAll<HTMLScriptElement>('script[type=module][src]')].find(e=>!e.src.includes('/@vite/'))?.getAttribute('src')?.split('/').pop()??''});}
 observeDiagnostics(diagnostics,()=>({dialog,quality:settings.quality}));
 const statusDiagnostics=()=>{el('diagnostics-toggle').textContent=diagnostics.enabled?'Остановить запись':'Начать новую запись';el('diagnostics-status').textContent=diagnostics.enabled?'Запись идёт. Закройте меню и повторите зависание.':'Запись остановлена. Лог можно сохранить в файл.';};
 el('diagnostics-button').onclick=()=>{setDialog('diagnostics-panel');statusDiagnostics();};
 el('diagnostics-back').onclick=()=>setDialog('settings');
 el('diagnostics-toggle').onclick=()=>{if(diagnostics.enabled)diagnostics.stop();else diagnostics.startRecording();statusDiagnostics();};
 el('diagnostics-export').onclick=()=>{const blob=new Blob([JSON.stringify(diagnosticReport(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='vireon-performance-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 el('diagnostics-clear').onclick=()=>{diagnostics.stop();diagnostics.clear();statusDiagnostics();};
 canvas.addEventListener('webglcontextlost',()=>diagnostics.event('webglcontextlost'));
 canvas.addEventListener('webglcontextrestored',()=>{diagnostics.event('webglcontextrestored');lastRender=-Infinity;world.invalidateShadows();});
 el('metrics-toggle').onclick=()=>{showMetrics=!showMetrics;el('metrics').hidden=!showMetrics;el('metrics-toggle').textContent=showMetrics?'Скрыть показатели сцены':'Показать показатели сцены';};
 const toggleRun=()=>{if(!running)return;runToggle=!runToggle;updateRun();};el('run').onpointerdown=e=>{e.preventDefault();toggleRun();};el('run').onclick=e=>{if(e.detail===0)toggleRun();};
 el('jump').onpointerdown=event=>{event.preventDefault();if(running)input.jump=true;};

 function toast(kind:string,text:string){const t=el('toast');t.hidden=true;void t.offsetWidth;el('toast-kind').textContent=kind;el('toast-text').textContent=text;t.hidden=false;}
 function inspect(){
  if(!nearest||!running)return;
  visited.add(nearest.id);audio.tone('scan');
  el('info-kind').textContent=nearest.kind;el('info-title').textContent=nearest.name;el('info-text').textContent=nearest.description;
  const y=heightAt(nearest.x,nearest.z),fromCapsule=Math.hypot(nearest.x-40,nearest.z-40);
  const rows:[string,string][]=[['Координаты',`${Math.round(nearest.x)} · ${Math.round(nearest.z)}`],['Высота',`${y>=0?'+':''}${y.toFixed(1)} м`],['От капсулы',`${Math.round(fromCapsule)} м`]];
  el('info-data').replaceChildren(...rows.map(([k,v])=>{const d=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v;d.append(dt,dd);return d;}));
  if(nearest.id===selected)selected='guide';
  setDialog('info-panel');updateUI();
 }
 addEventListener('keydown',event=>{
  if(event.code==='Escape'){event.preventDefault();if(dialog==='quest-panel'){questBook.escape();return;}if((dialog==='hud-settings-panel'||dialog==='visor-settings-panel'||dialog==='diagnostics-panel')){setDialog('settings');return;}if(dialog==='settings'){setDialog(settingsReturn);return;}if(dialog==='production-panel'){el('close-production').click();return;}if(started){if(running)pause();else resume();}return;}
  if(event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest('input,textarea,select')))return;
  if(event.code==='KeyJ'&&started&&!event.repeat){event.preventDefault();openQuests();return;}
  if(event.code==='KeyM'&&started&&!event.repeat){event.preventDefault();if(dialog==='map-panel')resume();else openMap();return;}
  if(event.code==='KeyI'&&started&&!event.repeat){event.preventDefault();openPanel('inventory-panel');return;}
  if(event.code==='KeyB'&&started&&!event.repeat){event.preventDefault();if(running||liveDialogs.has(dialog))production.open();return;}
  if(event.code==='KeyC'&&started&&!event.repeat){event.preventDefault();openPanel('suit-panel');return;}
  if(!running)return;
  if(/^Digit[1-6]$/.test(event.code)){event.preventDefault();selectSlot(Number(event.code.slice(5))-1);return;}
  if(event.code==='KeyR'&&!event.repeat){event.preventDefault();retrieveStation();return;}
  if(event.code==='KeyQ'&&!event.repeat){event.preventDefault();rotateBuild();return;}
  if(event.code==='KeyN'&&!event.repeat){event.preventDefault();toggleDay();return;}
  if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight','KeyE','KeyF'].includes(event.code))event.preventDefault();
  if(event.code==='KeyF'&&!event.repeat&&interaction.cellTool){holdPlace=game?.player.inventory[game.player.hotbar]?.itemId==='window';placedInHold.clear();placeCell();}
  else if(event.code==='KeyF'&&!event.repeat){if(actionKind==='mine'||actionKind==='refill'){holdMine=actionKind==='mine';holdRefill=actionKind==='refill';}else doAction();}
  keys.add(event.code);if(event.code==='Space'&&!event.repeat)input.jump=true;
  if(event.code==='KeyE'&&!event.repeat)inspect();updateRun();
 });
 addEventListener('keyup',event=>{keys.delete(event.code);if(event.code==='KeyF'){if(holdRefill)void saver?.save();holdMine=holdRefill=false;endHold();}updateRun();});
 const stick=el('joystick');
 const capture=(target:HTMLElement,event:PointerEvent)=>{try{target.setPointerCapture(event.pointerId);}catch{/* Synthetic pointer events have no OS capture; real pointers do. */}};
 function moveStick(event:PointerEvent){const r=stick.getBoundingClientRect();let x=event.clientX-(r.left+r.width/2),y=event.clientY-(r.top+r.height/2);const len=Math.hypot(x,y),max=Math.max(1,(r.width-el('stick').getBoundingClientRect().width)/2-r.width*.06);if(len>max){x*=max/len;y*=max/len;}joyX=x/max;joyY=-y/max;if(Math.abs(joyX)<.1)joyX=0;if(Math.abs(joyY)<.1)joyY=0;el('stick').style.transform=`translate(${x}px,${y}px)`;}
 stick.addEventListener('pointerdown',event=>{if(!running||joyPointer!==null)return;event.preventDefault();joyPointer=event.pointerId;capture(stick,event);moveStick(event);});
 stick.addEventListener('pointermove',event=>{if(joyPointer===event.pointerId){event.preventDefault();moveStick(event);}});
 const releaseStick=(event:PointerEvent)=>{if(joyPointer===event.pointerId){joyPointer=null;joyX=joyY=0;el('stick').style.transform='translate(0,0)';}};
 for(const type of ['pointerup','pointercancel','lostpointercapture'])stick.addEventListener(type,releaseStick as EventListener);
 canvas.addEventListener('pointerdown',event=>{if(!running||lookPointer!==null)return;event.preventDefault();lookPointer=event.pointerId;lastX=event.clientX;lastY=event.clientY;capture(canvas,event);});
 canvas.addEventListener('pointermove',event=>{if(lookPointer!==event.pointerId||!running)return;actor.yaw-=(event.clientX-lastX)*.004;actor.pitch=Math.max(-1.25,Math.min(1.25,actor.pitch-(event.clientY-lastY)*.003));lastX=event.clientX;lastY=event.clientY;});
 const releaseLook=(event:PointerEvent)=>{if(lookPointer===event.pointerId)lookPointer=null;};
 for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,releaseLook as EventListener);
 canvas.addEventListener('contextmenu',event=>event.preventDefault());


 // ---------- S1: world session, deposits, inventory and saves ----------
 const fmtTime=(ticks:number)=>{const m=Math.floor(ticks/1200),h=Math.floor(m/60);return h?`${h} ч ${m%60} мин`:`${m} мин`;};
 const fmtDate=(t:number)=>new Date(t).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
 const dropGroup=new THREE.Group();scene.add(dropGroup);
 const crateGeo=new THREE.BoxGeometry(.55,.38,.42),crateMat=new THREE.MeshStandardMaterial({color:'#c9682c',roughness:.55,metalness:.2}),strapMat=new THREE.MeshStandardMaterial({color:'#2a3336',roughness:.5,metalness:.5}),strapGeo=new THREE.BoxGeometry(.58,.06,.45);
 function syncDrops(){
  dropGroup.clear();if(!game)return;
  for(const d of game.world.drops){const g=new THREE.Group(),y=heightAt(d.x,d.z);const c=new THREE.Mesh(crateGeo,crateMat);c.position.y=.19;c.castShadow=true;const st=new THREE.Mesh(strapGeo,strapMat);st.position.y=.3;g.add(c,st);g.position.set(d.x,y,d.z);g.rotation.y=(d.x*7+d.z*3)%6.28;dropGroup.add(g);}
 }
 function applyNodes(){
  if(!game)return;
  for(const n of NODES)world.setNodeAmount(n.id,game.world.nodes[n.id],n.amount);
  for(const [id,nodeId] of [['iron-outcrop','iron-a'],['copper-outcrop','copper-a'],['stone-outcrop','stone-a'],['ice-outcrop','ice-a'],...NODES.filter(n=>n.box).map(n=>['node-'+n.id,n.id])]){
   const original=mineralBoxes.get(id);if(!original)continue;const i=boxes.findIndex(b=>b.id===id);if(i>=0)boxes.splice(i,1);
   const n=NODE_BY_ID.get(nodeId)!,left=game.world.nodes[nodeId];if(left<=0)continue;
   const k=.42+.58*left/n.amount,cx=(original.minX+original.maxX)/2,cz=(original.minZ+original.maxZ)/2;
   boxes.push({...original,minX:cx+(original.minX-cx)*k,maxX:cx+(original.maxX-cx)*k,minZ:cz+(original.minZ-cz)*k,maxZ:cz+(original.maxZ-cz)*k,maxY:original.minY+(original.maxY-original.minY)*k});
  }
 }
 const mineralBoxes=new Map(boxes.filter(b=>b.id.endsWith('-outcrop')||b.id.startsWith('node-')).map(b=>[b.id,{...b}]));
 function snapshot():GameState{
  const g=game!;g.meta.activeTicks=clock.activeTicks;
  Object.assign(g.player,{x:actor.x,y:actor.y,z:actor.z,yaw:actor.yaw,pitch:actor.pitch});
  refreshQuestProgress(g);
  Object.assign(g.progress,{visited:[...visited],discovered:[...discovered],selected});
  return cloneState(g);
 }
 function setSaveStatus(st:SaverStatus|{kind:'none'|'idle';message?:string}){
  diagnostics.event('save:'+st.kind,0,{revision:'revision' in st?st.revision:0});
  const e=el('save-status');e.dataset.kind=st.kind;
  el('save-text').textContent=st.kind==='saving'?'Сохранение…':st.kind==='saved'?'Сохранено':st.kind==='error'?'Ошибка сохранения':st.kind==='lease-lost'?'Запись остановлена':st.kind==='none'?'Без сохранения':'Без мира';
  e.title=st.kind==='saved'?`Ревизия ${(st as SaverStatus).revision}`:'';
  if(st.kind==='error'||st.kind==='lease-lost'){audio.tone('warn');if(saver?.halted)showHalt();else toast('Сохранение',st.message??'Ошибка');}
 }
 function updatePauseInfo(msg?:string){
  const st=saver?.status;el('pause-save-info').textContent=msg??(!store?`Хранилище недоступно: ${storeError}. Прогресс не сохраняется — используйте экспорт.`:st?.kind==='saved'?`Сохранено: ревизия ${st.revision}${st.savedAt?' · '+fmtDate(st.savedAt):''} · активное время ${fmtTime(clock.activeTicks)}`:st?.message??'');
 }
 /** Quota error or a lost lease: the world stops changing until the player exports or retries. */
 function showHalt(){
  const st=saver?.status;if(!st)return;const lost=st.kind==='lease-lost';
  el('lease-title').textContent=lost?'Мир открыт в другой вкладке':'Не удалось сохранить';
  el('lease-text').textContent=lost?'Другая вкладка взяла запись этого мира. Здесь изменения остановлены, чтобы не перезаписать её прогресс. Можно скачать копию текущего состояния этой вкладки.':(st.message??'')+' Ничего не удалено. Освободите место (например, удалите ненужные миры через «Сохранения») и повторите.';
  el('lease-primary').innerHTML=lost?'Перезагрузить <span aria-hidden="true">↻</span>':'Повторить сохранение <span aria-hidden="true">→</span>';
  el('lease-primary').onclick=lost?()=>location.reload():()=>{void saver?.retry().then(()=>{if(!saver?.halted)setDialog('paused');});};
  el('lease-export').hidden=false;el('lease-export').onclick=()=>downloadExport(snapshot(),saver?.revision??0);
  el('lease-back').hidden=lost;el('lease-back').onclick=()=>setDialog('saves-panel');el('lease-back').querySelector('span')!.textContent='Сохранения';
  setDialog('lease-panel');
 }
 function downloadExport(state:GameState,revision:number){
  try{const blob=new Blob([exportText(buildExport(state,revision,Date.now()))],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=exportFileName(state,new Date());document.body.append(a);a.click();a.remove();exported=true;setTimeout(()=>URL.revokeObjectURL(a.href),20000);
   el('saves-status').textContent=`Экспорт: ${a.download}`;}catch(e){el('saves-status').textContent='Экспорт не удался: '+(e instanceof Error?e.message:String(e));}
 }
 const newId=()=>'w-'+Date.now().toString(36)+'-'+Math.floor(Math.random()*1e9).toString(36);
 async function initStore(){
  try{store=await SaveStore.open();store.measure=(name,ms)=>diagnostics.span(name,ms);}catch(e){store=null;storeError=e instanceof Error?e.message:String(e);}
  await refreshSlots();
 }
 async function refreshSlots(){
  slots=store?await store.listSlots().catch(()=>[]):[];
  const has=slots.length>0;el('continue').hidden=!has;el('start').className=has?'secondary':'primary';
  el('start').innerHTML=has?'<svg><use href="#i-home"/></svg><span>Новая экспедиция</span>':'Новая экспедиция <span aria-hidden="true">→</span>';
  const info=el('title-continue-info');info.hidden=!has&&!!store;info.textContent=!store?`Хранилище браузера недоступно (${storeError}). Можно играть, но прогресс не сохранится — только экспорт файла.`:has?`${slots[0].name} · ${fmtTime(slots[0].activeTicks)} · ${fmtDate(slots[0].updatedAt)}`:'';
  const list=el('slot-list');
  if(!store){list.replaceChildren(Object.assign(document.createElement('p'),{className:'help',textContent:'IndexedDB недоступна: сохранения в браузере выключены. Импорт тоже недоступен; экспорт текущего мира работает.'}));return;}
  if(!has){list.replaceChildren(Object.assign(document.createElement('p'),{className:'help',textContent:'Сохранённых миров пока нет.'}));return;}
  list.replaceChildren(...slots.map(sl=>{const row=document.createElement('div');row.className='slot-row';const cur=sl.id===slotId;
   const info=document.createElement('div');const b=document.createElement('b');b.textContent=sl.name+(cur?' · сейчас':'');const sm=document.createElement('small');sm.textContent=`${fmtTime(sl.activeTicks)} · ревизия ${sl.activeRevision} · ${fmtDate(sl.updatedAt)}`;info.append(b,sm);
   const play=document.createElement('button');play.className='secondary';play.textContent=cur?'Играть':'Открыть';play.onclick=()=>{if(cur){resume();return;}void openSlot(sl.id).then(ok=>{if(ok)enterOrResume();});};
   const exp=document.createElement('button');exp.className='secondary';exp.setAttribute('aria-label','Экспорт '+sl.name);exp.innerHTML='<svg><use href="#i-download"/></svg>';exp.onclick=()=>{if(cur&&game){downloadExport(snapshot(),saver?.revision??0);return;}void store!.load(sl.id).then(r=>downloadExport(r.state,r.revision)).catch(e=>{el('saves-status').textContent='Не удалось прочитать мир: '+e.message;});};
   const del=document.createElement('button');del.className='ghost';del.textContent='Удалить';del.disabled=cur;del.onclick=()=>{if(confirm(`Удалить «${sl.name}» из браузера? Это нельзя отменить. Экспортированные файлы не затрагиваются.`))void store!.deleteSlot(sl.id).then(refreshSlots);};
   row.append(info,play,exp,del);return row;}));
 }
 /** Leaves the current world cleanly: final save, heartbeat off, lease released. */
 async function closeCurrent(){
  if(!saver||!store||!slotId)return;
  if(!saver.halted)await saver.save();saver.stopHeartbeat();await store.releaseLease(slotId,token).catch(()=>{});saver=null;slotId=null;
 }
 function startGame(state:GameState,id:string|null,revision:number,baseRevision=revision){
  game=state;refreshQuestProgress(state);questBook.reset();prints.clear();slotId=id;clock.stop();clock.activeTicks=state.meta.activeTicks;mining.nodeId=null;mining.ticks=0;
  actor.reset();Object.assign(actor,{x:state.player.x,y:state.player.y,z:state.player.z,yaw:state.player.yaw,pitch:state.player.pitch});actor.previous={x:actor.x,y:actor.y,z:actor.z};lastSurvivalEvent='none';holdMine=holdRefill=false;
  visited.clear();discovered.clear();state.progress.visited.forEach(v=>visited.add(v));state.progress.discovered.forEach(v=>discovered.add(v));selected=LANDMARKS.some(l=>l.id===state.progress.selected)?state.progress.selected:'guide';guideOverride=null;lastCompleted=-1;lastStep=null;lastTaskKey='';
  applyNodes();built.reset();built.sync(state);world.invalidateShadows();syncDrops();hudKey='';updateHotbar();shownDay=null;world.setTime(phaseSeconds(state.meta.activeTicks,state.world.dayOffsetTicks),true);updateDayButton();panels.reset();
  if(id&&store){saver=new Saver(store,id,token,revision,state.meta.activeTicks,snapshot,setSaveStatus,baseRevision,(name,ms)=>diagnostics.span(name,ms));saver.startHeartbeat();setSaveStatus(saver.status);}else{saver=null;setSaveStatus({kind:'none'});}
  updateUI();
 }
 async function newExpedition():Promise<boolean>{
  await closeCurrent();
  const state=newGame(newId(),(Math.random()*2**32)>>>0,Date.now(),heightAt(SPAWN_POSE.x,SPAWN_POSE.z)+.14,`Экспедиция ${slots.length+1}`);
  if(!store){startGame(state,null,0);return true;}
  try{await store.createSlot(state,token);startGame(state,state.meta.worldId,1);await refreshSlots();return true;}
  catch(e){const err=e instanceof SaveError?e:null;el('title-continue-info').hidden=false;el('title-continue-info').textContent=(err?.code==='quota'?'Недостаточно места для нового мира. ':'Не удалось создать мир: ')+(e instanceof Error?e.message:String(e))+' Игра без сохранения.';startGame(state,null,0);return true;}
 }
 async function openSlot(id:string,force=false):Promise<boolean>{
  if(!store)return false;
  if(slotId===id&&game)return true;
  try{
   const r=await openSavedSlot(store,id,token,force,closeCurrent);
   if(!r){
    el('lease-title').textContent='Мир открыт в другой вкладке';
    el('lease-text').textContent=`Этот мир сейчас записывает другая вкладка (или она закрыта меньше 15 секунд назад). Если открыть его здесь, другая вкладка перестанет сохранять изменения.`;
    el('lease-primary').innerHTML='Открыть здесь <span aria-hidden="true">→</span>';el('lease-primary').onclick=()=>{void openSlot(id,true).then(ok=>{if(ok)enterOrResume();});};
    el('lease-export').hidden=true;el('lease-back').hidden=false;el('lease-back').querySelector('span')!.textContent='Назад';el('lease-back').onclick=()=>setDialog(started?'paused':'welcome');
    setDialog('lease-panel');return false;
   }
   startGame(r.state,id,r.revision,r.baseRevision);
   if(r.recoveredFrom)toast('Восстановлено',`Ревизия ${r.recoveredFrom} повреждена — загружена ${r.revision}`);
   return true;
  }catch(e){el('saves-status').textContent='Не удалось загрузить: '+(e instanceof Error?e.message:String(e))+'. Мир не изменён; его можно экспортировать для диагностики.';setDialog('saves-panel');return false;}
 }
 const enterOrResume=()=>{if(started)resume();else enter();};
 async function importFile(file:File){
  const status=el('saves-status');
  if(!store){status.textContent='Импорт недоступен без хранилища браузера';return;}
  if(file.size>MAX_FILE_BYTES){status.textContent='Файл больше 64 МиБ — импорт отклонён';return;}
  try{
   const slot=await importSlot(store,await file.text(),newId(),file.size);await refreshSlots();
   status.textContent=`Импортировано как новый мир «${slot.name}». Существующие миры не изменены.`;audio.tone('item');
  }catch(e){status.textContent='Импорт отклонён: '+(e instanceof Error?e.message:String(e));audio.tone('warn');}
 }
 const feed=createFeed();let shake=0;
 /** Point on a deposit facing the camera: where chips fly from. */
 // S4: `hitNormal` is the struck face's outward direction: chips fly out of it, towards the player.
 const hitNormal=new THREE.Vector3();
 function nodeHitPoint(id:string){const n=NODE_BY_ID.get(id)!,k=.42+.58*(game?game.world.nodes[id]:n.amount)/n.amount,c=new THREE.Vector3(n.x,heightAt(n.x,n.z)+n.height*k*.55,n.z),d=camera.position.clone().sub(c);d.y*=.4;hitNormal.copy(d.normalize());return c.add(d.multiplyScalar(n.radius*k*.75));}
 // ---------- Aim: which deposit is under the reticle and within reach ----------
 const nodeCenter=new THREE.Vector3(),toNode=new THREE.Vector3();
 function computeAim(){
  aimNode=null;if(!game||!started)return;let best=Infinity;
  for(const n of NODES){if(game.world.nodes[n.id]<=0)continue;const k=.42+.58*game.world.nodes[n.id]/n.amount,r=n.radius*k;
   nodeCenter.set(n.x,heightAt(n.x,n.z)+n.height*k*.5,n.z);toNode.copy(nodeCenter).sub(camera.position);
   const along=toNode.dot(viewDirection),perp=Math.sqrt(Math.max(0,toNode.lengthSq()-along*along)),horiz=Math.hypot(actor.x-n.x,actor.z-n.z)-r;
   // Ray hits the deposit's bounding sphere within reach, or the player stands right next to it facing it (easier on touch).
   const hit=along>0&&perp<r+.25&&along-r<=REACH,close=horiz<1.3&&along>0&&perp<r+1.1;
   if((hit||close)&&along<best){best=along;aimNode=n.id;}}
 }
 /** Aim label under the reticle and the context action button (mine / pick up / scan / none). */
 function updateAimUI(){
  nearMachine=game&&interaction.target&&machine(game,interaction.target)?interaction.target:null;
  const box=el('aim'),n=aimNode&&game&&!interaction.target?NODE_BY_ID.get(aimNode):undefined;
  el('aim-name').textContent='';el('aim-meta').textContent='';box.hidden=true;document.body.dataset.aim='false';
  let kind='none',label='Действие',iconId='i-hand',blocked='';
  const selected=game?.player.inventory[game.player.hotbar];
  if(game && selected?.itemId==='pulp' && !n && !nearDrop && game.player.vitals.satiety<100){kind='eat';label='Есть';iconId='i-food';}
  if(n&&game){
   const ti=toolSlot(game),sel=game.player.inventory[game.player.hotbar],secs=mineSeconds(game,n.material);
   blocked=game.world.base.hand||manualWork(game)?'Ручная работа: завершите или отмените':secs===null?(sel&&TOOLS[sel.itemId]?'Инструмент сломан':game.player.inventory.some(x=>x&&TOOLS[x.itemId])?'Выберите мультитул':'Нужен инструмент'):'';
   el('aim-name').textContent=itemName(n.itemId)+(secs!==null?` · ${secs%1?secs.toFixed(1):secs} с${ti<0&&n.material!=='grass'?' · руками':''}`:'');
   el('aim-meta').textContent=aimReason||blocked||`В рюкзаке: ${countItem(game.player.inventory,n.itemId)}`;box.classList.toggle('blocked',!!(aimReason||blocked));
   (el('aim-bar').firstElementChild as HTMLElement).style.transform=`scaleX(${mineRatio})`;
   kind='mine';label='Добыть';iconId='i-pick';
  }else if(nearDrop){kind='pickup';label='Поднять';iconId='i-pack';}
  else if(kind!=='eat'&&nearMachine){kind='machine';label='Открыть станцию';iconId='i-plug';const b=game&&machine(game,nearMachine);if(b){if(selected?.itemId==='wrench'&&b.kind==='workbench'&&b.level===1){kind='upgrade';label='Улучшить';iconId='i-gear';}box.hidden=!running;const st=stationStatus(game!,b);el('aim-name').textContent=b.kind==='workbench'?'Верстак '+(b.level===2?'II':'I'):ITEMS[b.kind].name;el('aim-meta').textContent=kind==='upgrade'?'Ключ · улучшение до II · F':st.title+' · F';box.classList.toggle('blocked',st.tone==='warn');(el('aim-bar').firstElementChild as HTMLElement).style.transform='scaleX(0)';document.body.dataset.aim='true';}}
  else if(kind==='eat'){blocked=game!.player.survival.foodCooldownMs>0?'Подождите перед следующей порцией':'';}
  else if(nearest){kind='scan';label='Сканировать';iconId='i-scan';}
  if(game&&interaction.cellTool){const id=selected?.itemId;kind='cell';label=id==='airlock'?'Встроить шлюз':'Поставить';iconId='i-pack';el('aim-name').textContent=(selected?ITEMS[selected.itemId].name:'')+(id==='airlock'?' · Q — поворот':'');el('aim-meta').textContent=interaction.problem||(id==='window'?'Поставить · F, удерживать — ряд':'Встроить · F');blocked=interaction.problem;box.classList.toggle('blocked',!!blocked);}
  else if(game&&!nearMachine&&(interaction.target?.startsWith('glass:')||interaction.target?.startsWith('door-'))){
   const door=interaction.target.startsWith('door-')?doorById(game,interaction.target):undefined,key=door?doorKeys(door)[0]:Number(interaction.target.slice(6));
   // Cheap caption (no leak search every frame): the room beside the block or the box it belongs to (≤ 64 blocks).
   const room=around(key).map(n=>roomAtCell(game!,n)).find(Boolean)??structureRoom(game,key,64);kind='room';label=door?'Открыть шлюз':'Открыть помещение';iconId='i-plug';
   el('aim-name').textContent=door?'Шлюз':room?`Помещение · ${room.volume} м³`:'Стеклоблок';el('aim-meta').textContent=(room?(habitableRoom(room)?'Воздух пригоден':`Воздух ${Math.floor(room.zone.q/1000)} GU · непригоден`):'Не замкнуто')+' · F · R — забрать';box.classList.toggle('blocked',!room||!habitableRoom(room));(el('aim-bar').firstElementChild as HTMLElement).style.transform='scaleX(0)';}
  else if(game&&interaction.building){kind='place';label='Установить';iconId='i-pack';el('aim-name').textContent=selected?ITEMS[selected.itemId].name:'';el('aim-meta').textContent=interaction.problem||'Установить · F';blocked=interaction.problem;}
  else if(game&&interaction.linking){kind='link';label='Соединить';iconId='i-plug';el('aim-name').textContent=selected?ITEMS[selected.itemId].name:'';el('aim-meta').textContent=interaction.hint;box.classList.toggle('blocked',!interaction.linkOk);}
  else if(game&&interaction.target?.startsWith('crate-')){kind='crate';label='Открыть ящик';iconId='i-pack';el('aim-name').textContent='Ящик';el('aim-meta').textContent='Открыть · F';}
  else if(game&&interaction.target==='capsule'&&kind!=='eat'){kind='capsule';label='Открыть заправку';iconId='i-plug';el('aim-name').textContent='Капсула · кислородный порт';el('aim-meta').textContent='Заправить баллоны · F';}
  if(pendingRemove&&performance.now()<pendingRemove.until&&interaction.struck?.key===pendingRemove.key){if(!el('aim-name').textContent)el('aim-name').textContent=interaction.struck.door?'Шлюз':'Стеклоблок';el('aim-meta').textContent=pendingRemove.text;box.classList.add('blocked');}
  box.hidden=!running||!el('aim-name').textContent;document.body.dataset.aim=String(!box.hidden);
  if(box.hidden){el('aim-name').textContent='';el('aim-meta').textContent='';box.classList.remove('blocked');(el('aim-bar').firstElementChild as HTMLElement).style.transform='scaleX(0)';}
  el('retrieve-station').hidden=!running||!(nearMachine||interaction.struck)||interaction.building||interaction.linking;
  el('rotate-build').hidden=!running||!(interaction.building||interaction.cellTool&&selected?.itemId==='airlock');
  const disabled=kind==='none' ||!!blocked||!running;
  actionKind=disabled?'none':kind;if(disabled||kind!=='mine')holdMine=false;if(kind!=='cell'&&holdPlace)endHold();if(disabled||kind!=='refill')holdRefill=false;
  actionBtn.dataset.kind=kind;actionBtn.setAttribute('aria-disabled',String(disabled));actionBtn.style.setProperty('--p',String(mineRatio));
  const actionLabel=kind==='mine'?'Добыть (удерживать)':kind==='refill'?label+' (удерживать)':label;
  if(actionBtn.getAttribute('aria-label')!==actionLabel){el('action-icon').innerHTML=`<use href="#${iconId}"/>`;actionBtn.setAttribute('aria-label',actionLabel);}
  actionBtn.title=blocked||actionLabel;
 }
 function onMined(ev:Extract<ReturnType<typeof mineTick>,{kind:'block'}>){
  world.invalidateShadows();
  const n=NODE_BY_ID.get(ev.nodeId)!;audio.tone('item');applyNodes();
  if(ev.toGround){syncDrops();toast('Рюкзак полон',`${itemName(ev.itemId)} оставлена на земле`);}
  else{const inv=game!.player.inventory,cell=inv.slice(0,HOTBAR_SIZE).findIndex(v=>v?.itemId===ev.itemId);feed.add(ev.itemId,ev.toInventory,countItem(inv,ev.itemId),cell>=0?hotCells[cell]:el('inventory-button'));}
  {const p=nodeHitPoint(n.id);fx.block(p.x,p.y,p.z,n.material,hitNormal);shake=Math.max(shake,.09);}
  if(!ev.left){toast('Запас исчерпан',n.name);}
  if(ev.toolBroke){audio.tone('warn');toast('Инструмент сломан',itemName('tool_stone')+' · новый мультитул: 4 камня + 2 волокна в мастерской');}
  hudKey='';updateHotbar();
 }
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
  const guide=navTarget(),follow=selected==='guide';
  if(follow&&guide){ctx.save();ctx.translate(mpx(guide.x),mpy(guide.z));ctx.rotate(Math.PI/4);ctx.fillStyle='#ffb43c';ctx.fillRect(-5,-5,10,10);ctx.restore();ctx.strokeStyle='rgba(255,180,60,.6)';ctx.beginPath();ctx.arc(mpx(guide.x),mpy(guide.z),12,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#ffb43c';ctx.textAlign='center';ctx.fillText(guide.name.toUpperCase(),mpx(guide.x),mpy(guide.z)-15);}
  const journal=document.createElement('button');journal.setAttribute('aria-pressed',String(follow));journal.className='landmark-guide';
  {const b=document.createElement('b');b.textContent='Цель журнала';const m=document.createElement('small');m.textContent=guide&&follow?`${guide.name} · ${Math.round(Math.hypot(guide.x-actor.x,guide.z-actor.z))} м`:'Вести по текущему шагу';const sp=document.createElement('span');sp.textContent='◆';journal.append(b,m,sp);}
  journal.onclick=()=>{selected='guide';guideOverride=null;audio.tone('ui');resume();updateUI();};
  el('landmark-list').replaceChildren(journal,...LANDMARKS.map(p=>{const button=document.createElement('button');const d=Math.round(Math.hypot(p.x-actor.x,p.z-actor.z));button.innerHTML='';const name=document.createElement('b');name.textContent=p.name;const meta=document.createElement('small');meta.textContent=`${d} м`;button.append(name,meta);button.setAttribute('aria-label',p.name);button.setAttribute('aria-pressed',String(p.id===selected));const span=document.createElement('span');span.textContent=visited.has(p.id)?'✓':'◇';button.append(span);button.onclick=()=>{selected=p.id;audio.tone('ui');resume();updateUI();};return button;}));
 }
 // ---------- Compass strip ----------
 const compass=el<HTMLCanvasElement>('compass'),cctx=compass.getContext('2d')!;
 const DIRS=['С','СВ','В','ЮВ','Ю','ЮЗ','З','СЗ'];
 function drawCompass(heading:number){
  const w=compass.width,h=compass.height,dpr=devicePixelRatio,scale=h/(28*dpr),span=Math.PI*.95;if(!w)return;
  cctx.clearRect(0,0,w,h);const X=(a:number)=>w/2+wrap(a-heading)/span*w;
  const grad=cctx.createLinearGradient(0,0,w,0);grad.addColorStop(0,'rgba(233,245,241,0)');grad.addColorStop(.2,'rgba(233,245,241,.85)');grad.addColorStop(.8,'rgba(233,245,241,.85)');grad.addColorStop(1,'rgba(233,245,241,0)');
  cctx.fillStyle=grad;cctx.strokeStyle=grad;cctx.lineWidth=dpr;
  cctx.beginPath();cctx.moveTo(0,h*.62);cctx.lineTo(w,h*.62);cctx.globalAlpha=.25;cctx.stroke();cctx.globalAlpha=1;
  for(let d=0;d<360;d+=5){const a=d*Math.PI/180,x=X(a);if(Math.abs(wrap(a-heading))>span/2)continue;const major=d%45===0;cctx.fillRect(x-dpr/2,h*(major?.44:d%15===0?.5:.55),dpr,h*(major?.18:d%15===0?.12:.07));
   if(major){cctx.font=`600 ${Math.max(10,11*scale)*dpr}px system-ui,sans-serif`;cctx.textAlign='center';cctx.fillText(DIRS[d/45],x,h*.36);}}
  for(const p of LANDMARKS){const a=bearing(p.x-actor.x,p.z-actor.z),rel=wrap(a-heading);if(Math.abs(rel)>span/2)continue;const x=X(a),sel=p.id===selected;
   cctx.save();cctx.translate(x,h*.82);cctx.rotate(Math.PI/4);cctx.fillStyle=sel?'#f2b460':visited.has(p.id)?'rgba(127,230,218,.45)':'rgba(191,238,230,.9)';const r=(sel?4:2.5)*dpr*scale;cctx.fillRect(-r,-r,r*2,r*2);cctx.restore();}
  {const t=navTarget();if(t&&!t.landmark){const a=bearing(t.x-actor.x,t.z-actor.z),rel=wrap(a-heading);if(Math.abs(rel)<span/2){const x=X(a);cctx.save();cctx.translate(x,h*.82);cctx.rotate(Math.PI/4);cctx.fillStyle='#ffb43c';const r=4.5*dpr*scale;cctx.fillRect(-r,-r,r*2,r*2);cctx.restore();}}}
  // Sun (day) or moon (night) on the strip at its real bearing — the light moves with the game clock.
  {const sd=world.sunDirection,day=sd.y>-.02,a=day?bearing(sd.x,sd.z):bearing(-sd.x,-sd.z),rel=wrap(a-heading);
   if(Math.abs(rel)<span/2){const x=X(a),y=h*.36,r=5*dpr*scale;cctx.save();cctx.strokeStyle=cctx.fillStyle=day?'#ffb43c':'#cfe3ff';cctx.lineWidth=1.4*dpr;cctx.beginPath();cctx.arc(x,y,r*.7,0,Math.PI*2);if(day){cctx.stroke();for(let i=0;i<8;i++){const q=i*Math.PI/4;cctx.beginPath();cctx.moveTo(x+Math.cos(q)*r*1.05,y+Math.sin(q)*r*1.05);cctx.lineTo(x+Math.cos(q)*r*1.5,y+Math.sin(q)*r*1.5);cctx.stroke();}}else cctx.fill();cctx.restore();}}
  cctx.fillStyle='#f2b460';cctx.beginPath();cctx.moveTo(w/2-4*dpr*scale,0);cctx.lineTo(w/2+4*dpr*scale,0);cctx.lineTo(w/2,5*dpr*scale);cctx.fill();
 }
 const marker=el('target-marker');
 function updateMarker(){
  const t=navTarget();if(!t){marker.hidden=true;return;}const d=Math.hypot(actor.x-t.x,actor.z-t.z);
  tmp.set(t.x,heightAt(t.x,t.z)+2.4,t.z).project(camera);
  const visible=started&&running&&d>t.radius*.6&&tmp.z<1&&Math.abs(tmp.x)<1.1&&Math.abs(tmp.y)<1.1;
  marker.hidden=!visible;marker.style.opacity=visible?'1':'0';
  if(visible){marker.style.transform=`translate(${Math.max(26,Math.min(innerWidth-26,(tmp.x*.5+.5)*innerWidth))}px,${Math.max(innerHeight<500?92:118,Math.min(innerHeight-30,(-tmp.y*.5+.5)*innerHeight))}px) translate(-50%,-50%)`;el('marker-distance').textContent=`${Math.round(d)} м`;}
 }
 /** Guide target the player chose in the journal; cleared when reached or when the step changes. */
 let guideOverride:GuideTarget|null=null,lastStep:QuestId|null=null,lastCompleted=-1,lastTaskKey='',guideCache:{at:number;target:GuideTarget|null}={at:-1,target:null};
 /** Where the compass and world marker lead: a landmark chosen on the map, or the current guide target. */
 function navTarget():{name:string;x:number;z:number;radius:number;landmark:boolean}|null{
  const l=LANDMARKS.find(p=>p.id===selected);if(l)return {name:l.name,x:l.x,z:l.z,radius:l.radius,landmark:true};
  if(!game)return null;
  if(guideOverride)return {...guideOverride,radius:3,landmark:false};
  const now=performance.now();if(now-guideCache.at>500){const id=currentStep(game);guideCache={at:now,target:id?stepTarget(game,guideStep(game,id)):null};}
  const t=guideCache.target;return t?{...t,radius:t.kind==='area'?8:3,landmark:false}:null;
 }
 function showBanner(title:string,next:string){const b=el('step-banner');b.hidden=true;void b.offsetWidth;el('step-banner-title').textContent=title;el('step-banner-next').textContent=next;b.hidden=false;audio.tone('discover');setTimeout(()=>{if(el('step-banner-title').textContent===title)b.hidden=true;},3700);}
 /** HUD tracker: current step, its next unfinished task with a counter, and overall progress. */
 function objective():string{
  if(!game)return '';
  const done=game.progress.quests.completed;
  if(lastCompleted>=0&&done.length>lastCompleted){const id=done[done.length-1],step=guideStep(game,id),next=currentStep(game);showBanner(step.title,next?'Дальше: '+guideStep(game,next).title:'Глава завершена');guideOverride=null;}
  lastCompleted=done.length;
  const id=currentStep(game);
  if(id!==lastStep){lastStep=id;guideOverride=null;guideCache.at=-1;}
  if(!id){el('objective-kicker').textContent='Глава завершена';el('objective-task').textContent='Исследуйте Вердану';el('objective-icon').replaceChildren(itemArt('window'));return 'База работает';}
  const step=guideStep(game,id),task=step.tasks.find(t=>!t.done),{done:n,total}=progressCount(game);
  // The optional chapter has no place in the main count (18 steps): it is labelled instead of showing 19 / 18.
  el('objective-kicker').textContent=(game.progress.quests.tracked===id?'Выбрано · ':step.optional?'':'Цель ')+(step.optional?'Дополнительно':Math.min(n+1,total)+' / '+total);
  const taskEl=el('objective-task'),key=task?task.label+task.have:'';
  if(task){taskEl.replaceChildren(document.createTextNode(task.label+(task.need>1?' ':'')));if(task.need>1){const b=document.createElement('b');b.textContent=`${task.have}/${task.need}`;taskEl.append(b);}}else taskEl.textContent='Готово — проверьте журнал';
  if(key!==lastTaskKey){if(lastTaskKey){const ob=el('objective');ob.classList.remove('tick');void ob.offsetWidth;ob.classList.add('tick');}lastTaskKey=key;}
  const ratio=step.tasks.filter(t=>t.done).length/Math.max(1,step.tasks.length);el('objective').style.setProperty('--p',String(ratio));
  const icon=el('objective-icon');if(icon.dataset.item!==step.item){icon.dataset.item=step.item;icon.replaceChildren(itemArt(step.item));}
  return step.title;
 }
 function updateVitals(){
  if(!game)return;const g=game,inCapsule=insideCapsule(actor.x,actor.z);
  const source=accessibleOxygen(g,inCapsule),o2=source.amount,cap=source.capacity;
  const unit=el('g-oxygen').querySelector('small')!;if(unit.textContent!==source.unit)unit.textContent=source.unit;
  const ratio=cap>0?o2/cap:0;
  const set=(id:string,v:number,fill:number)=>{const e=el(id);e.dataset.low=String(fill<=.2);e.style.setProperty('--v',String(Math.max(0,Math.min(1,fill))));const b=e.querySelector('b')!;const t=String(Math.round(v));if(b.textContent!==t)b.textContent=t;};
  set('g-health',g.player.vitals.health,g.player.vitals.health/100);set('g-satiety',g.player.vitals.satiety,g.player.vitals.satiety/100);set('g-oxygen',o2,ratio);
  el('g-oxygen').setAttribute('aria-label',source.emergency?`Аварийное дыхание ${Math.ceil(o2)} секунд`:`Кислород ${Math.round(o2)} GU`);el('g-health').setAttribute('aria-label',`Здоровье ${Math.round(g.player.vitals.health)}`);el('g-satiety').setAttribute('aria-label',`Сытость ${Math.round(g.player.vitals.satiety)}`);
  const alert=el('survival-alert');
  const critical=started&&g.player.vitals.health>0&&(ratio<=.2||g.player.vitals.health<=20||g.player.vitals.satiety===0);
  alert.setAttribute('aria-hidden',String(!critical));document.body.dataset.hazard=critical?'critical':'safe';
  const text=!critical?'':ratio<=.2?(source.emergency?'АВАРИЙНЫЙ РЕЗЕРВ ЗАКАНЧИВАЕТСЯ':!inCapsule&&!breathingRoom(g)&&wornParts(g)<4?'КОСТЮМ НЕГЕРМЕТИЧЕН':'КИСЛОРОД КРИТИЧЕСКИ НИЗКИЙ'):g.player.vitals.health<=20?'ЗДОРОВЬЕ КРИТИЧЕСКИ НИЗКО':'СЫТОСТЬ ИСЧЕРПАНА';
  const textNode=el('survival-alert-text');if(textNode.textContent!==text)textNode.textContent=text;
 }
 function updateVisor(){el('visor').hidden=!game?.player.suit.helmet;}
 function updateUI(){
  updateVisor();
  nearMachine=game&&interaction.target&&machine(game,interaction.target)?interaction.target:null;
  nearDrop=null;if(game)for(const d of game.world.drops)if(Math.hypot(d.x-actor.x,d.z-actor.z)<2.2){nearDrop=d.id;break;}
  const target=navTarget();el('navigation').hidden=!target;
  if(target){const d=Math.hypot(actor.x-target.x,actor.z-target.z);el('target-name').textContent=target.name;el('target-distance').textContent=`${Math.round(d)} м`;
   const angle=Math.atan2(target.x-actor.x,target.z-actor.z)-actor.yaw;(document.querySelector('.nav-arrow') as HTMLElement).style.transform=`rotate(${-angle}rad)`;
   if(!target.landmark&&guideOverride&&d<target.radius)guideOverride=null;}
  nearest=LANDMARKS.filter(p=>Math.hypot(actor.x-p.x,actor.z-p.z)<=p.radius).sort((a,b)=>Math.hypot(actor.x-a.x,actor.z-a.z)-Math.hypot(actor.x-b.x,actor.z-b.z))[0];
  document.body.dataset.near=String(!!nearest);
  if(nearest&&started&&!discovered.has(nearest.id)){discovered.add(nearest.id);if(nearest.id!=='capsule'){toast('Новое место',nearest.name);audio.tone('discover');}}
  const o=objective();if(o!==lastObjective){lastObjective=o;el('objective-text').textContent=o;const ob=el('objective');ob.classList.remove('advance');void ob.offsetWidth;ob.classList.add('advance');}
  updateVitals();updateHotbar();updateDayButton();
 }
 function state(){const sorted=[...frames].sort((a,b)=>a-b);return {ready:true,version:'S3',linkSource:interaction.source,lastAction,fx:fx.stats(),guide:game?{current:currentStep(game),objective:el('objective-text').textContent,task:el('objective-task').textContent,nav:navTarget(),selected}:null,station:production.station,worldTarget:interaction.target,quests:game?structuredClone(game.progress.quests):null,questBook:questBook.debug(),vitals:game?{...game.player.vitals}:null,survival:game?{...game.player.survival}:null,capsuleMilliGU:game?.world.capsuleMilliGU??0,base:game?structuredClone(game.world.base):null,rooms:game?allRooms(game).map(r=>({cell:r.cell,volume:r.volume,q:r.zone.q/1000,purity:r.zone.purity,temperature:r.zone.temperature,habitable:habitableRoom(r),doors:roomDoors(game!,r).map(d=>d.id)})):[],glass:game?{count:game.world.base.glass.length,...built.glass.stats()}:null,cellTarget:interaction.cell,cellProblem:interaction.cellTool?interaction.problem:'',struck:interaction.struck,pendingRemove:pendingRemove&&performance.now()<pendingRemove.until?pendingRemove.text:'',visibleDrops:dropGroup.children.length,slotId,revision:saver?.revision??0,saveStatus:saver?.status.kind??(game?'none':'idle'),halted:!!saver?.halted,activeTicks:clock.activeTicks,clockRunning:clock.running,hotbar:game?.player.hotbar??0,cells:game?game.player.inventory.map(s=>s?{...s}:null):[],suit:game?Object.fromEntries(Object.entries(game.player.suit).map(([k,v])=>[k,v?.itemId??null])):null,worn:game?wornParts(game):0,bottles:game?game.player.bottles.map(b=>b?{...b}:null):[],oxygenGU:game?oxygenGU(game):0,dayPhase:dayPhase(),dayOffsetTicks:game?.world.dayOffsetTicks??0,nightValue:world.nightValue,action:actionKind,handItem:hand.visible,panel:panels.debug,aimNode,mineRatio,nodes:game?{...game.world.nodes}:null,inventory:game?game.player.inventory.filter(Boolean).map(s=>({...s})):[],drops:game?game.world.drops.length:0,storage:!!store,grassCount:world.grassCount,fullscreen:!!document.fullscreenElement,running,dialog,night:!isDay(dayPhase()),selected,visited:[...visited],activeTime:clock.activeSeconds,position:{x:actor.x,y:actor.y,z:actor.z},yaw:actor.yaw,pitch:actor.pitch,grounded:actor.grounded,input:{...input,joyX,joyY,joyPointer,lookPointer},quality:settings.quality,sound:settings.sound,bob:settings.bob,fov:settings.fov,fineTerrainBlocks:world.terrain.fineBlocks,midTerrainBlocks:world.terrain.midBlocks,drawCalls:renderCalls,triangles:renderTriangles,frameP95Ms:sorted[Math.floor(sorted.length*.95)]??0,viewport:{width:innerWidth,height:innerHeight},renderer:rendererVersion,diagnostics:diagnostics.enabled,shadowTarget:world.sunLight.target.position.toArray(),shadowRedraws:world.shadowRedraws,footprints:{count:prints.count,visible:prints.visible},motes:world.motes.count,wind:{gust:world.wind.gust,angle:world.wind.angle,time:world.wind.time},pointLights:{pool:world.lights.count,active:world.lights.active,emitters:world.lights.emitters},shadowBias:world.sunLight.shadow.bias};}
 const dev=!!(import.meta as unknown as {env?:{DEV?:boolean}}).env?.DEV;
 Object.defineProperty(window,'__vireon',{value:{getState:state,save:()=>saver?.save(),snapshot:()=>game?snapshot():null,diagnostics:()=>diagnosticReport(),
  // Development-only verification helpers; absent from production builds.
  ...(dev?{captureFrame:()=>new Promise<string>(resolve=>{if(captureRequested)throw new Error('Capture already pending');captureRequested=resolve;}),setState:(raw:unknown)=>{if(!game)return;const next=sanitizeState(raw);if(next.meta.worldId!==game.meta.worldId)throw new Error('Test state belongs to another world');game=next;Object.assign(actor,{x:next.player.x,y:next.player.y,z:next.player.z,yaw:next.player.yaw,pitch:next.player.pitch});actor.vy=actor.vx=actor.vz=actor.airSpeed=0;actor.grounded=true;actor.previous={x:actor.x,y:actor.y,z:actor.z};clock.activeTicks=next.meta.activeTicks;built.sync(next);world.invalidateShadows();applyNodes();syncDrops();hudKey='';updateUI();updateAimUI();},agePrints:(seconds:number)=>prints.update(seconds),teleport:(x:number,z:number,yaw:number,pitch=-.2,y?:number)=>{prints.clear();actor.x=x;actor.z=z;actor.y=y??heightAt(x,z);actor.yaw=yaw;actor.pitch=pitch;actor.vy=actor.vx=actor.vz=actor.airSpeed=0;actor.grounded=true;actor.previous={x,y:actor.y,z};}}:{})},writable:false});

 let handBobX=0,handBobY=0,airTime=0,foot=1;
 // S4: boot prints and a puff of the ground's own dust per stride; both feet and a dust ring on landing. Not in the
 // capsule, on floors or crates (the body is not on the terrain surface) or on steep rock.
 const groundTint=new THREE.Color();
 function footstep(run:boolean,landing=false){
  if(!started||!printAllowed(actor.x,actor.y,actor.z,heightAt,insideCapsule()))return;
  const yaw=Math.hypot(actor.vx,actor.vz)>.1?Math.atan2(actor.vx,actor.vz):actor.yaw,rx=-Math.cos(yaw),rz=Math.sin(yaw);
  world.groundColorAt(actor.x,actor.z,groundTint).multiplyScalar(1.12);
  if(landing){for(const s of [-1,1])prints.add(actor.x+rx*s*.13,actor.z+rz*s*.13,yaw,s);fx.landing(actor.x,actor.y,actor.z,groundTint);return;}
  foot=-foot;const x=actor.x+rx*foot*.13,z=actor.z+rz*foot*.13;prints.add(x,z,yaw,foot);fx.footDust(x,actor.y,z,groundTint,run,-Math.sin(yaw),-Math.cos(yaw));
 }
 const draw=(now:number)=>{
  const workStart=diagnostics.stamp();let measured=workStart;
  // The first frame after a hidden tab spans the background time: it is not a freeze and is not recorded.
  const diagnosticGapMs=now-lastDiagnosticFrame,afterHidden=hiddenSinceFrame;lastDiagnosticFrame=now;hiddenSinceFrame=false;
  const actualFrameMs=now-last;const dt=Math.min(actualFrameMs/1000,.25);last=now;
  if(running){
   input.forward=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)+joyY;
   input.right=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+joyX;
  }else{input.forward=input.right=0;input.jump=false;}
  // One accepted clock drives everything: ≤5 fixed 50 ms steps per frame, nothing while paused/hidden.
  const steps=clock.advance(actualFrameMs);let productionChanged=false,regrown=false;
  for(let i=0;i<steps;i++){const px=actor.x,pz=actor.z,wasAir=!actor.grounded;if(game?.world.base.passage){input.forward=input.right=0;input.run=false;input.jump=false;}actor.step(FIXED_DT,input,game?survivalSpeed(game):1);input.jump=false;
   if(wasAir&&actor.grounded){if(airTime>.25)footstep(false,true);airTime=0;}else if(!actor.grounded)airTime+=FIXED_DT;
   const moved=Math.hypot(actor.x-px,actor.z-pz);if(actor.grounded&&moved>0){stride+=moved;bob+=moved*(input.run?2.4:2.9);if(stride>(input.run?.82:.68)){stride=0;audio.step(input.run,insideCapsule());footstep(input.run);}}
   if(game){
    Object.assign(game.player,{x:actor.x,y:actor.y,z:actor.z});
    const produced=productionTick(game,50,refillMachine,isDay(dayPhase())?10:-10);
    if(natureTick(game,50).length)regrown=true;
    // A finished transfer ends its mode: a tank installed later never starts filling (or draining) without a new press.
    const port=dialog==='production-panel'&&insideCapsule();
    if(port&&refillMachine==='capsule-out'&&!refillFromCapsule(game,FIXED_DT)||port&&refillMachine==='capsule-in'&&!refillCapsule(game,FIXED_DT)||refillMachine&&!refillMachine.startsWith('capsule')&&(game.player.bottles.every(t=>!t||(t.milliGU??0)>=TANKS[t.itemId].capacity)||(machine(game,refillMachine)?.oxygen??0)<=0)){refillMachine=null;void saver?.save();}
    if(produced.passage){Object.assign(actor,produced.passage);actor.previous={x:actor.x,y:actor.y,z:actor.z};Object.assign(game.player,produced.passage);}
    if(produced.changed)productionChanged=true;
    const survival=survivalTick(game,FIXED_DT,insideCapsule(),(input.run||(!actor.grounded&&actor.airSpeed>3.5*survivalSpeed(game)+.01))&&moved>0);
    if(survival!==lastSurvivalEvent){lastSurvivalEvent=survival;if(survival==='warning')toast('ВНИМАНИЕ','Проверьте кислород');if(survival==='damage')audio.tone('warn');}
    if(survival==='death'){
     clock.activeTicks-=steps-i-1;releaseHandOnDeath(game);loseCargo(game);game.world.base.passage=null;mining.nodeId=null;mining.ticks=0;aimReason='';mineRatio=0;strikeClock=0;
     syncDrops();hudKey='';updateHotbar();updateVitals();setDialog('death-panel');void saver?.save();break;
    }
    if(running&&holdRefill&&actionKind==='refill'&&insideCapsule()&&(refillTanks?refillFromCapsule(game,FIXED_DT):refillCapsule(game,FIXED_DT))){hudKey='';updateHotbar();}
    const ev=mineTick(game,mining,running?aimNode:null,running&&holdMine&&!game.world.base.hand&&!manualWork(game)&&!game.world.base.passage);
    aimReason=ev.kind==='blocked'?ev.reason:'';mineRatio=ev.kind==='progress'?ev.ratio:0;
    if(ev.kind==='progress'){strikeClock-=FIXED_DT;if(strikeClock<=0){strikeClock=.45;const n=NODE_BY_ID.get(ev.nodeId)!;audio.strike(n.material==='ice');const p=nodeHitPoint(n.id);fx.strike(p.x,p.y,p.z,n.material,hitNormal);shake=Math.max(shake,.04);}}else strikeClock=0;
    if(ev.kind==='block')onMined(ev);}
  }
  if(regrown)applyNodes();
  if(game&&steps>0&&refreshQuestProgress(game))productionChanged=true;
  if(productionChanged&&game&&game.player.vitals.health>0){hudKey='';updateHotbar();if(dialog==='production-panel')production.draw();void saver?.save();}
  if(game&&saver)saver.tick(clock.activeTicks);measured=diagnostics.stage('simulation',measured);if(dialog==='production-panel')production.tick();measured=diagnostics.stage('production-ui',measured);
  if(!started){
   // Title cinematic: a slow arc around the capsule with the spires behind.
   // Title shot: low, slow orbit; capsule sits in the right third, horizon and sky stay in frame.
   titleTime+=dt;const a=1.05+Math.sin(titleTime*.02)*.18,r=17+Math.sin(titleTime*.05)*1.2,cx=40+Math.cos(a)*r,cz=40+Math.sin(a)*r;
   const h0=heightAt(cx,cz),ya=Math.atan2(40-cz,40-cx)+TITLE_OFFSET;
   camera.position.set(cx,h0+1.9+Math.sin(titleTime*.07)*.25,cz);camera.lookAt(cx+Math.cos(ya)*30,h0+5.2,cz+Math.sin(ya)*30);
  }else{
   const a=clock.running?clock.alpha:1;
   wake=Math.max(0,wake-(running?dt:0));const w=wake/2.6,ease=w*w*(3-2*w);
   const moving=running&&(Math.abs(input.forward)+Math.abs(input.right))>.1&&actor.grounded;
   const bobOn=moving&&settings.bob,bobY=bobOn?Math.sin(bob*2)*.028:0,bobX=bobOn?Math.cos(bob)*.018:0;handBobX=bobX;handBobY=bobY;
   viewPos.set(THREE.MathUtils.lerp(actor.previous.x,actor.x,a),THREE.MathUtils.lerp(actor.previous.y,actor.y,a)+EYE+bobY-ease*.25,THREE.MathUtils.lerp(actor.previous.z,actor.z,a));
   viewPos.x+=Math.cos(actor.yaw)*bobX;viewPos.z-=Math.sin(actor.yaw)*bobX;camera.position.copy(viewPos);
   const pitch=actor.pitch-ease*.45;
   viewDirection.set(Math.sin(actor.yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(actor.yaw)*Math.cos(pitch));camera.lookAt(tmp.copy(viewPos).add(viewDirection));
   if(ease>0)camera.rotateZ(Math.sin(ease*3)*.06*ease);
   // Short tool-impact shake; decays in ~0.2 s and respects the camera-bob setting.
   if(shake>0&&settings.bob&&!reducedMotion()){camera.rotateX((Math.random()-.5)*shake*.06);camera.rotateY((Math.random()-.5)*shake*.06);}shake=Math.max(0,shake-dt*.5);
   const targetFov=settings.fov+(Math.hypot(actor.vx,actor.vz)>4&&running&&settings.bob?6:0);fov+=(targetFov-fov)*Math.min(1,dt*6);if(Math.abs(camera.fov-fov)>.01){camera.fov=fov;camera.updateProjectionMatrix();}
  }
  // Explicit pause (and settings opened from it) freezes the whole scene, not only the controller.
  const frozen=started&&(dialog==='paused'||dialog==='settings'||(dialog==='hud-settings-panel'||dialog==='visor-settings-panel'||dialog==='diagnostics-panel'));
  if(game&&started)world.setTime(dayPhase());
  measured=diagnostics.stage('camera',measured);
  renderElapsed+=dt;
  const renderScene=sceneReady&&!document.hidden&&(now-lastRender>=sceneInterval(started,running||liveDialogs.has(dialog),dialog,settings.quality)-.5||dialog!==lastRenderedDialog);
  if(renderScene){
   shadowAnchor.set(actor.x,actor.y,actor.z);
   world.update(frozen?0:renderElapsed,camera,renderer,!started||(!frozen&&!dialog),diagnostics.enabled?(name,ms)=>diagnostics.span('world:'+name,ms):undefined,started?shadowAnchor:undefined);
   fx.update(frozen?0:renderElapsed,camera,renderer.domElement.height,{night:world.nightValue,wind:world.wind});prints.update(frozen?0:renderElapsed);
   measured=diagnostics.stage('world',measured);renderer.render(scene,camera);renderCalls=renderer.info.render.calls;renderTriangles=renderer.info.render.triangles;
   if(started&&hand.visible&&dialog!=='suit-panel'){hand.update(frozen?0:renderElapsed,camera,{sun:world.sunLight,hemi:world.hemiLight},holdMine&&mineRatio>0,handBobX,handBobY);renderer.autoClear=false;renderer.clearDepth();renderer.render(hand.scene,camera);renderer.autoClear=true;renderCalls+=renderer.info.render.calls;renderTriangles+=renderer.info.render.triangles;}
   if(captureRequested){const resolve=captureRequested;captureRequested=null;resolve(canvas.toDataURL('image/png'));}
   lastRender=now;lastRenderedDialog=dialog;renderElapsed=0;
  }
  measured=diagnostics.stage('render-submit',measured);
  if(!frozen)audio.update(dt,started&&insideCapsule()?1:0,world.nightValue,world.wind.gust);
  if(started){drawCompass(bearing(Math.sin(actor.yaw),Math.cos(actor.yaw)));updateMarker();interaction.update(game,running,dt);computeAim();updateAimUI();
   // Held F: one more block every 0.25 s as the aim moves to a new cell resting on something that was there before the hold.
   if(holdPlace&&running&&game&&interaction.cellTool&&performance.now()-lastPlace>=250&&interaction.cell!==null&&!interaction.problem&&!placedInHold.has(interaction.cell)&&!placedInHold.has(interaction.support))placeCell();}
  if(game&&started){built.update(game,frozen?0:dt);if(built.animating||game.world.base.passage)world.invalidateShadows();}
  if(running&&dt>0){frames.push(actualFrameMs);if(frames.length>180)frames.shift();}
  if(now-lastUI>150){updateUI();lastUI=now;if(showMetrics){const sorted=[...frames].sort((a,b)=>a-b),s={drawCalls:renderCalls,triangles:renderTriangles,frameP95Ms:sorted[Math.floor(sorted.length*.95)]??0};const ob=el('objective').getBoundingClientRect();el('metrics').style.top=`${Math.round(ob.bottom+8)}px`;el('metrics').textContent=`S3 / WebGL2 / DPR ${renderer.getPixelRatio()} / ${settings.quality}\nВызовы: ${s.drawCalls} · треуг.: ${s.triangles}\nКадр p95: ${s.frameP95Ms.toFixed(1)} мс\nX ${actor.x.toFixed(1)} · Z ${actor.z.toFixed(1)}\nЭто замер текущего браузера`;}}
  diagnostics.stage('hud',measured);if(diagnostics.enabled&&!afterHidden)diagnostics.frame(diagnosticGapMs,workStart,diagnosticContext());
  requestAnimationFrame(draw);
 };
 document.body.dataset.started='false';applyQuality(settings.quality);applySound(settings.sound);applyBob(settings.bob);applyFov(settings.fov);fov=settings.fov;world.setTime(516,true);updateUI();
 document.body.dataset.running='false';el<HTMLButtonElement>('start').disabled=true;requestAnimationFrame(draw);
 void (async()=>{world.prepare(renderer);await renderer.compileAsync(scene,camera);await hand.prewarm(renderer,camera,{sun:world.sunLight,hemi:world.hemiLight});renderer.render(scene,camera);sceneReady=true;last=performance.now();await initStore();el<HTMLButtonElement>('start').disabled=false;document.body.dataset.ready='true';})().catch(e=>{console.error(e);error('Не удалось подготовить сцену: '+String(e));});
}
try { boot(); } catch(e){ console.error(e);error('Нужен браузер с WebGL 2. Попробуйте обновить браузер или открыть сцену на другом устройстве. '+(e instanceof Error?e.message:'')); }
