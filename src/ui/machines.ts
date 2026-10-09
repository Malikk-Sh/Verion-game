import { installTank } from '../game/backpack';
import { ITEMS,TANKS } from '../game/defs';
import { loadMachineSlot,takeSlot } from '../game/worldActions';
import { addItems,transferSlot,type Slot } from '../game/inventory';
import { machine,RECIPES,poweredComponent,RECIPE_BY_ID,loadFuel,beginPassage,habitable,sealCheck,cancelJob } from '../game/production';
import type { GameState } from '../game/state';
import { itemArt } from './art';
import './machines.css';
const h=(tag:string,value='',cls='')=>{const e=document.createElement(tag);e.textContent=value;e.className=cls;return e;};
const button=(label:string,fn:()=>void)=>{const b=document.createElement('button');b.className='ui-btn';b.textContent=label;b.onclick=fn;return b;};
export function machineView(g:GameState,id:string,say:(error:string,success?:string)=>void,changed:()=>void,draw:()=>void,refill:(id:string|null)=>void){
 const root=h('div','','machine-layout'),left=h('div','','machine-process'),right=h('div','','machine-backpack');root.dataset.storage=String(id.startsWith('crate-'));root.append(left,right);const b=machine(g,id);
 const grid=(slots:Slot[],act:(index:number)=>void)=>{const grid=h('div','','machine-grid');slots.forEach((s,i)=>{const cell=button('',()=>act(i));cell.className='machine-cell';cell.setAttribute('aria-label',s?ITEMS[s.itemId].name+' ×'+s.count:'Пустая ячейка');if(s){cell.title=ITEMS[s.itemId].name+(s.milliGU!==undefined?' · '+Math.round(s.milliGU/1000)+' GU':'');cell.append(itemArt(s.packed?.kind==='workbench'&&s.packed.level===2?'workbench_2':s.itemId),h('small',s.packed?.level===2?'II':String(s.count)));if(s.packed)cell.title='Станция '+s.packed.level+' · содержимое сохранено';}grid.append(cell);});return grid;};
 const change=()=>{changed();draw();};
 right.append(h('h3','Рюкзак'),grid(g.player.inventory,i=>{
  if(id.startsWith('crate-')){if(transferSlot(g.player.inventory,i,g.world.crates[id]))change();else say('Ящик полон');}
  else if(id==='capsule'){say(installTank(g,i).ok?'':'Выберите баллон','Баллон установлен');}
  else if(b)say(loadMachineSlot(g,id,i),'Предмет загружен');
 }));
 if(id.startsWith('crate-')){left.append(h('h3','Ящик · 24 ячейки'),grid(g.world.crates[id],i=>{if(transferSlot(g.world.crates[id],i,g.player.inventory))change();else say('Рюкзак полон');}));return root;}
 function bar(label:string,value:number,max:number,key:string){const caption=h('p',label,'machine-caption');caption.id=key+'-label';const track=h('div','','machine-bar'),fill=h('i');fill.id=key+'-fill';fill.style.width=Math.min(100,value/max*100)+'%';track.append(fill);left.append(caption,track);}
 if(id==='capsule'){
  bar('Кислород капсулы',g.world.capsuleMilliGU,2400000,'capsule');
  g.player.bottles.forEach((t,i)=>{const row=h('div','','capsule-bottle');row.append(itemArt('bottle_1'),h('span',t?'Баллон '+(i+1):'Слот '+(i+1)+' пуст'));const value=h('b');value.id='capsule-bottle-'+i;row.append(value);left.append(row);});
  const fill=button('Заправить баллоны',()=>{refill('capsule-out');fill.textContent='Заправка идёт';});fill.id='capsule-start';left.append(fill,button('Остановить',()=>{refill(null);fill.textContent='Заправить баллоны';}));
  const reverse=h('details');reverse.append(h('summary','Передать газ в капсулу'),button('Баллоны → капсула',()=>{refill('capsule-in');fill.textContent='Газ передаётся в капсулу';}));left.append(reverse,h('p','Выберите запасной баллон в рюкзаке для установки. Заправка работает, пока открыт порт; запас капсулы конечный.','machine-note'));return root;
 }
 if(!b)return root;
 const slots=h('div','','machine-slots');
 const slot=(label:string,source:Slot[],index:number,empty:string)=>{const wrap=h('div','','machine-slot-wrap'),s=source[index],cell=button('',()=>{if(label==='Вода'&&b!.water>=1000){const inv=structuredClone(g.player.inventory),n=Math.floor(b!.water/1000);if(addItems(inv,'water',n)){say('Рюкзак полон');return;}g.player.inventory=inv;b!.water-=n*1000;changed();draw();return;}say(takeSlot(g,source,index),'Предмет забран');});cell.className='machine-cell machine-slot';cell.dataset.machineSlot=label;cell.setAttribute('aria-label',label+(s?' · '+ITEMS[s.itemId].name:' · пусто'));cell.append(itemArt(s?.itemId??empty));if(!s&&!(label==='Вода'&&b!.water))cell.classList.add('empty');const count=h('small',s?String(s.count):'');count.id='machine-slot-count-'+index+'-'+label;cell.append(count);wrap.append(h('span',label),cell);slots.append(wrap);};
 if(b.kind==='kiln'){
  const inputs=h('div','','kiln-inputs');slot('Сырьё',b.input,0,'iron_raw');slot('Топливо',b.input,1,'fiber');inputs.append(...Array.from(slots.children));slots.append(inputs);const arrow=h('div','→','machine-arrow');arrow.id='machine-progress';slots.append(arrow);const recipe=b.job?RECIPE_BY_ID.get(b.job.recipeId):RECIPES.find(r=>r.station==='kiln'&&b.input[0]&&r.inputs[b.input[0].itemId]);slot('Результат',b.output,0,recipe?Object.keys(recipe.outputs)[0]:'iron');left.append(slots,h('p','Выберите сырьё и волокна в рюкзаке. Нажмите готовый результат, чтобы забрать.','machine-note'));
 }else if(b.kind==='electrolyzer'){
  slot('Вода',b.input,0,'water');slot('Баллон',b.input,1,'bottle_1');left.append(slots);bar('Внутренний буфер O₂',b.oxygen,480000,'oxygen');
  const status=h('p','','machine-note');status.id='machine-status';left.append(status);
  g.player.bottles.forEach((t,i)=>{if(t)left.append(button('Установить баллон '+(i+1)+' из костюма',()=>{const old=b.input[1];if(old&&old.itemId!=='bottle_1'){say('Освободите слот баллона');return;}b.input[1]=t;g.player.bottles[i]=old;change();}));});
  left.append(h('p','Вода из печи. Подключите кабель питания. Загруженный баллон заполняется автоматически.','machine-note'));
 }else{
  const status=h('p');status.id='machine-status';left.append(status);
  if(b.kind==='biogenerator')left.append(button('Загрузить волокно',()=>say(loadFuel(g,id),'Топливо загружено')));
  if(b.kind==='refill')left.append(button('Заправить баллоны',()=>refill(id)),button('Остановить',()=>refill(null)));
  if(b.kind==='dome')left.append(button('Пройти шлюз',()=>say(beginPassage(g,id),'Цикл шлюза начат')));
  if(b.kind==='distributor')left.append(h('p','Кабель питания и кислородная труба. Размещается внутри купола.','machine-note'));
 }
 left.append(button(b.enabled?'Выключить':'Включить',()=>{b.enabled=!b.enabled;change();}));
 if(b.job)left.append(button('Отменить текущую обработку',()=>say(cancelJob(g,id),'Оплаченное сырьё возвращено')));
 if(b.input.slice(2).some(Boolean)||b.output.slice(1).some(Boolean)){const legacy=h('details');legacy.append(h('summary','Другие сохранённые ячейки'));for(const [source,from] of [[b.input,2],[b.output,1]] as const)source.forEach((s,i)=>{if(s&&i>=from)legacy.append(button(ITEMS[s.itemId].name+' ×'+s.count,()=>say(takeSlot(g,source,i),'Предмет забран')));});left.append(legacy);}
 return root;
}
export function tickMachine(g:GameState,id:string){
 const set=(key:string,value:string)=>{const e=document.getElementById(key);if(e)e.textContent=value;};const bar=(key:string,value:number,max:number,text:string)=>{set(key+'-label',text);const e=document.getElementById(key+'-fill');if(e)e.style.width=Math.min(100,value/max*100)+'%';};
 if(id==='capsule'){bar('capsule',g.world.capsuleMilliGU,2400000,`Капсула · ${Math.round(g.world.capsuleMilliGU/1000)} / 2400 GU`);g.player.bottles.forEach((t,i)=>set('capsule-bottle-'+i,t?Math.round((t.milliGU??0)/1000)+' / 240 GU':'—'));const fill=document.getElementById('capsule-start') as HTMLButtonElement|null,has=g.player.bottles.some(Boolean),full=has&&g.player.bottles.every(t=>!t||(t.milliGU??0)>=TANKS[t.itemId].capacity);if(fill){fill.disabled=!has||full||g.world.capsuleMilliGU<=0;if(!has)fill.textContent='Установите баллон';else if(full)fill.textContent='Баллоны заполнены';else if(g.world.capsuleMilliGU<=0)fill.textContent='В капсуле нет O₂';}return;}
 const b=machine(g,id);if(!b)return;const r=b.job?RECIPE_BY_ID.get(b.job.recipeId):null,percent=r?Math.min(100,Math.floor(b.job!.workMs/(r.seconds*10))):0;
 const status=!b.enabled?'Выключен':r?`${percent}% · ${r.seconds} с`:'Ожидает сырьё';set('machine-progress',r?percent+'% →':'→');
 if(b.kind==='electrolyzer'){bar('oxygen',b.oxygen,480000,`Буфер O₂ · ${Math.round(b.oxygen/1000)} / 480 GU`);set('machine-status',status+(b.water?' · запас воды '+(b.water/1000)+' WU':''));const t=b.input[1];set('machine-slot-count-1-Баллон',t&&TANKS[t.itemId]?Math.round((t.milliGU??0)/TANKS[t.itemId].capacity*100)+'%':t?String(t.count):'');set('machine-slot-count-0-Вода',String((b.input[0]?.itemId==='water'?b.input[0].count:0)+b.water/1000||''));const network=poweredComponent(g,id),powered=g.world.base.buildings.some(v=>network.has(v.id)&&v.kind==='biogenerator'&&v.enabled&&(v.energy>0||v.fuel>0||v.input.some(Boolean)));if(b.enabled&&!powered)set('machine-status','Нет питания · подключите работающий генератор');else if(b.enabled&&powered&&t&&TANKS[t.itemId]&&(t.milliGU??0)<TANKS[t.itemId].capacity&&b.oxygen>0)set('machine-status','Заправка баллона · 20 GU/с');else if(b.enabled&&!b.job&&b.oxygen>240000)set('machine-status','Освободите буфер O₂');else if(b.enabled&&!b.job)set('machine-status','Электролиз: ожидает воду');}
 if(b.kind==='kiln'&&!b.job&&b.enabled&&b.input[0]){const recipe=RECIPES.find(r=>r.station==='kiln'&&r.inputs[b.input[0]!.itemId]);if(recipe)set('machine-progress',b.input[0].count<(recipe.inputs[b.input[0].itemId]??0)?'Мало сырья':(b.input[1]?.count??0)<recipe.inputs.fiber?'Топливо':'→');}
 if(b.kind==='biogenerator')set('machine-status',`Энергия ${Math.round(b.energy/1000)} / 400 EU · топливо ${b.input.reduce((n,s)=>n+(s?.count??0),0)}`);
 if(b.kind==='refill')set('machine-status',`Буфер O₂ · ${Math.round(b.oxygen/1000)} / 480 GU`);
 if(b.kind==='dome')set('machine-status',`${sealCheck(b.zone.shell).sealed?'Герметичен':'Утечка'} · ${Math.round(b.zone.q/1000)} GU · ${habitable(b)?'Воздух пригоден':'Воздух непригоден'}`);
}
