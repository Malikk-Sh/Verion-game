import { createCraftingView } from './crafting';
import { BUILDABLE, ITEMS, type BuildingKind } from '../game/defs';
import { countItem } from '../game/inventory';
import { RECIPES, RECIPE_BY_ID, queueJob, clearQueue, collectInput, beginPassage, cancelJob, collectOutput, connect, habitable, loadFuel, machine, sealCheck, startJob, type Link } from '../game/production';
import { place, placementProblem } from '../buildings';
import { heightAt } from '../world';
import type { GameState } from '../game/state';
import { itemArt } from './art';
import './production.css';
type Host = { game(): GameState|null; show(): void; close(): void; changed():void; refill(id:string|null):void; tone(ok:boolean):void };
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const h=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',cls='')=>{const e=document.createElement(tag);e.textContent=text;e.className=cls;return e;};
const btn=(label:string,fn:()=>void,disabled=false)=>{const b=h('button',label,'ui-btn');b.disabled=disabled;b.onclick=fn;return b;};
export function createProductionPanel(host:Host){
 const crafting=createCraftingView();
 let tab='recipes',station='hand',kind:BuildingKind='workbench',x=46,z=48,message='',lastStatus='';
 const say=(reason:string,success='Готово')=>{message=reason||success;host.tone(!reason);if(!reason)host.changed();draw();};
 function open(id='hand',upgrade=false){station=id;crafting.open(id,upgrade);tab='recipes';message='';host.show();draw();}
 el('close-production').onclick=()=>{host.refill(null);host.close();};
 for(const t of ['recipes','build','links'])el('production-'+t).onclick=()=>{host.refill(null);tab=t;message='';draw();};
 function choices(g:GameState){const select=h('select');select.setAttribute('aria-label','Станция');select.append(new Option('Ручной крафт','hand'));if(g.player.x>37.5&&g.player.x<42.5&&g.player.z>37&&g.player.z<43.1)select.append(new Option('Капсула · ручной порт','capsule'));for(const b of g.world.base.buildings)if(Math.hypot(b.x-g.player.x,b.z-g.player.z)<=3.2)select.append(new Option(ITEMS[b.kind].name+(b.kind==='workbench'?(b.level===2?' II':' I'):'')+' · '+b.id,b.id));if(station!=='hand'&&station!=='capsule'&&!machine(g,station))station='hand';select.value=station;select.onchange=()=>{host.refill(null);station=select.value;crafting.open(station);message='';draw();};return select;}
 function draw(){const focus=document.activeElement as HTMLInputElement|null,keepSearch=focus?.id==='craft-search',cursor=keepSearch?[focus.selectionStart,focus.selectionEnd]:null;const g=host.game();if(!g)return;el('production-message').textContent=message;
  for(const t of ['recipes','build','links'])el('production-'+t).setAttribute('aria-pressed',String(tab===t));
  const content=el('production-content');content.replaceChildren();
  el('production-panel').classList.toggle('crafting-panel',tab==='recipes'&&(station==='hand'||machine(g,station)?.kind==='workbench'));
  el('production-panel').querySelector('h2')!.textContent=tab==='build'?'Строительство':tab==='links'?'Соединения':station==='hand'?'Крафт · В кармане':machine(g,station)?.kind==='workbench'?'Крафт · Верстак '+(machine(g,station)!.level===2?'II':'I'):'Мастерская';
  if(tab==='recipes'){
   content.append(choices(g));if(station==='capsule'){const status=h('p','Ручной порт · '+Math.round(g.world.capsuleMilliGU/1000)+'/2400 GU · 20 GU/с');status.id='production-status';content.append(status);for(const [id,label] of [['capsule-out','Капсула → баллоны'],['capsule-in','Баллоны → капсула']]){const fill=btn(label+' · удерживать',()=>{});fill.onpointerdown=e=>{e.preventDefault();fill.setPointerCapture(e.pointerId);host.refill(id);};for(const type of ['pointerup','pointercancel','lostpointercapture'])fill.addEventListener(type,()=>host.refill(null));fill.onkeydown=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();host.refill(id);}};fill.onkeyup=()=>host.refill(null);content.append(fill);}return;}const b=machine(g,station),s=b?.kind??'hand',job=b?.job??(station==='hand'?g.world.base.hand:null);
   if(s==='hand'||s==='workbench'){content.append(crafting.draw(g,station,say,host.changed,draw));if(keepSearch){const search=el<HTMLInputElement>('craft-search');search.focus({preventScroll:true});search.setSelectionRange(cursor![0]??0,cursor![1]??0);}lastStatus='';return;}
   const status=h('p','','production-status');status.id='production-status';content.append(status);
   if(b){const actions=h('div','','production-actions');actions.append(btn('Вернуть входы',()=>say(collectInput(g,station)>0?'':'Вход пуст или рюкзак полон','Входы возвращены')));actions.append(btn('Забрать выход',()=>say(collectOutput(g,station)>0?'':'Нет готового выхода или рюкзак полон','Перенесено в рюкзак')));
    if(b.kind==='biogenerator')actions.append(btn('Загрузить 1 волокно',()=>say(loadFuel(g,station),'Топливо загружено')));
    if(b.kind==='refill'){
     const fill=btn('Заправить баллоны · удерживать',()=>{});fill.id='production-refill';fill.onpointerdown=e=>{e.preventDefault();fill.setPointerCapture(e.pointerId);host.refill(station);};for(const type of ['pointerup','pointercancel','lostpointercapture'])fill.addEventListener(type,()=>host.refill(null));fill.onkeydown=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();host.refill(station);}};fill.onkeyup=()=>host.refill(null);actions.append(fill);
    }
    if(b.kind==='dome')actions.append(btn('Пройти шлюз · 6 с',()=>say(beginPassage(g,station),'Ручной шлюз: двери закрыты, идёт цикл')));
    actions.append(btn(b.enabled?'Выключить':'Включить',()=>{b.enabled=!b.enabled;host.changed();draw();}));content.append(actions);
   }
   const list=h('div','','recipe-list');for(const r of RECIPES.filter(r=>r.station===s)){
    const out=Object.entries(r.outputs).map(([id,n])=>`${ITEMS[id]?.name??(id==='water'?'Вода':id==='oxygen'?'O₂':'H₂ (сброс)')} ×${n}`).join(', '),row=h('div','','recipe-row');row.dataset.recipe=r.id;row.append(itemArt(Object.keys(r.outputs)[0]));const text=h('div');text.append(h('b',out),h('small',Object.entries(r.inputs).map(([id,n])=>`${ITEMS[id]?.name??'Вода'} ${id==='water'?((b?.water??0)/1000):countItem(g.player.inventory,id)}/${n}`).join(' · ')),h('small',`${r.seconds} с${r.EU_per_second?' · '+r.EU_per_second+' EU/с':''}`));row.append(text,btn('Создать',()=>say(startJob(g,r.id,station),'Работа начата'),!!job),btn('×5',()=>say(queueJob(g,r.id,station),'Очередь из 5 партий; сырьё машин загружено во входной буфер')));list.append(row);
   }content.append(list);if((b?.queue??g.world.base.handQueue).length)content.append(btn('Очистить очередь',()=>{clearQueue(g,station);host.changed();draw();}));if(job)content.append(btn('Отменить текущую работу',()=>say(cancelJob(g,station),'Входы возвращены; потраченная энергия не возвращается')));
   if(b?.output.some(Boolean))content.append(h('p',b.output.filter(Boolean).map(s=>ITEMS[s!.itemId].name+' ×'+s!.count).join(' · '),'production-output'));
   if(b?.kind==='distributor')content.append(h('p','Разместите внутри купола. Нужны кабель от генератора и O₂-труба от электролиза.'));

  }else if(tab==='build'){
   const select=h('select');select.setAttribute('aria-label','Корпус для размещения');for(const id of BUILDABLE)select.append(new Option(`${ITEMS[id].name} · ${countItem(g.player.inventory,id)} шт.`,id));select.value=kind;select.onchange=()=>{kind=select.value as BuildingKind;draw();};content.append(select);
   const layout=h('div','','build-layout'),canvas=h('canvas');canvas.id='build-map';canvas.width=288;canvas.height=208;canvas.setAttribute('aria-label','План строительства: нажмите клетку. Координаты доступны справа.');
   const cx=Math.round(g.player.x),cz=Math.round(g.player.z),scale=8,px=(v:number)=>144+(v-cx)*scale,pz=(v:number)=>104-(v-cz)*scale,ctx=canvas.getContext('2d')!;ctx.fillStyle='#071c21';ctx.fillRect(0,0,288,208);ctx.strokeStyle='#24494b';for(let i=0;i<288;i+=8){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,208);ctx.stroke();}for(let i=0;i<208;i+=8){ctx.beginPath();ctx.moveTo(0,i);ctx.lineTo(288,i);ctx.stroke();}
   const rectangle=(bx:number,bz:number,r:number,color:string)=>{ctx.fillStyle=color;ctx.fillRect(px(bx)-r*scale,pz(bz)-r*scale,2*r*scale,2*r*scale);};rectangle(40,40,3,'#b98e60');for(const b of g.world.base.buildings)rectangle(b.x,b.z,b.kind==='dome'?2.5:.5,'#58abb5');rectangle(x,z,kind==='dome'?2.5:.5,placementProblem(g,kind,x,z)?'#c65c50':'#c8e489');ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(px(g.player.x),pz(g.player.z),3,0,7);ctx.fill();
   canvas.onclick=e=>{const r=canvas.getBoundingClientRect();x=Math.round(cx+((e.clientX-r.left)*288/r.width-144)/scale);z=Math.round(cz-((e.clientY-r.top)*208/r.height-104)/scale);draw();};layout.append(canvas);
   const controls=h('div','','build-controls');for(const axis of ['x','z']){const label=h('label',axis.toUpperCase()),input=h('input');input.type='number';input.value=String(axis==='x'?x:z);input.id='build-'+axis;input.onchange=()=>{const n=Number(input.value);if(Number.isFinite(n)){if(axis==='x')x=Math.round(n);else z=Math.round(n);}draw();};label.append(input);controls.append(label);}const problem=placementProblem(g,kind,x,z);controls.append(h('p',problem||'Свободная ровная клетка'),btn('Разместить',()=>say(place(g,kind,x,z),'Корпус установлен пустым'),!!problem||countItem(g.player.inventory,kind)<1));layout.append(controls);content.append(layout,h('p','Сетка 1 м · дальность 12 м · купол 5×5 м. Для распределителя выберите свободную внутреннюю клетку.','help'));
  }else{
   content.append(h('p','Каждый сегмент ≤4 м расходует один кабель или трубу. Кабель соединяет сеть; труба направлена от электролиза к приёмнику.','help'));
   const form=h('div','','production-links');const type=h('select');type.setAttribute('aria-label','Тип соединения');type.id='link-kind';type.append(new Option('Кабель · '+countItem(g.player.inventory,'cable'),'cable'),new Option('Труба O₂ · '+countItem(g.player.inventory,'gas_pipe'),'gas_pipe'));
   const source=h('select'),target=h('select');source.id='link-from';target.id='link-to';source.setAttribute('aria-label','Источник');target.setAttribute('aria-label','Приёмник');for(const b of g.world.base.buildings){source.append(new Option(ITEMS[b.kind].name+(b.kind==='workbench'?(b.level===2?' II':' I'):'')+' · '+b.id,b.id));target.append(new Option(ITEMS[b.kind].name+(b.kind==='workbench'?(b.level===2?' II':' I'):'')+' · '+b.id,b.id));}target.append(new Option('Капсула','capsule'));form.append(type,source,target,btn('Соединить',()=>say(connect(g,type.value as Link['kind'],source.value,target.value),'Соединение оплачено и подключено')));content.append(form);
   for(const l of g.world.base.links)content.append(h('p',`${l.kind==='cable'?'EU':'O₂'}: ${l.from} → ${l.to}`));
  }
  lastStatus='';tick();
 }
 function tick(){const g=host.game();if(!g||tab!=='recipes')return;if(station==='hand'||machine(g,station)?.kind==='workbench'){crafting.tick(g,station);return;}if(station==='capsule'){const text=`Капсула ${(g.world.capsuleMilliGU/1000).toFixed(0)}/2400 GU · баллоны ${(g.player.bottles.reduce((n,b)=>n+(b?.milliGU??0),0)/1000).toFixed(0)} GU · 20 GU/с`;if(text!==lastStatus){el('production-status').textContent=text;lastStatus=text;}return;}const b=machine(g,station),job=b?.job??(station==='hand'?g.world.base.hand:null);let status=job?`${RECIPE_BY_ID.get(job.recipeId)!.seconds} с · ${Math.min(100,Math.floor(job.workMs/(RECIPE_BY_ID.get(job.recipeId)!.seconds*10)))}%${job.workMs>=RECIPE_BY_ID.get(job.recipeId)!.seconds*1000?' · выход заблокирован':''}`:'Нет активной работы';
  status+=` · очередь ${(b?.queue??g.world.base.handQueue).length}/5`;
  if(b?.kind==='biogenerator')status+=` · буфер ${(b.energy/1000).toFixed(0)}/400 EU · волокна ${countItem(b.input,'fiber')}`;
  if(b&&['electrolyzer','refill','distributor'].includes(b.kind))status+=` · O₂ ${(b.oxygen/1000).toFixed(0)}/480 GU${b.kind==='electrolyzer'?' · вода '+(b.water/1000).toFixed(0)+'/20 WU':''}`;
  if(b?.kind==='dome'){const seal=sealCheck(b.zone.shell);status=`${seal.sealed?'Герметичен · 48 м³':'Утечка: '+seal.path.join(' → ')} · ${(b.zone.q/1000).toFixed(0)}/960 GU · ${b.zone.temperature.toFixed(0)}°C · чистота ${(b.zone.purity*100).toFixed(0)}% · ${habitable(b)?'воздух пригоден':'воздух пока непригоден'}`;}
  if(g.world.base.passage)status+=` · шлюз ${(g.world.base.passage.remainingMs/1000).toFixed(1)} с`;
  if(status!==lastStatus){el('production-status').textContent=status;lastStatus=status;}
 }
 return {open,openUpgrade:(id:string)=>open(id,true),draw,tick,clear:()=>host.refill(null)};
}
