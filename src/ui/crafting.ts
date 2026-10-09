import { ITEMS } from '../game/defs';
import { countItem, type Slot } from '../game/inventory';
import { RECIPES, RECIPE_BY_ID, WORKBENCH_UPGRADE, cancelJob, clearQueue, collectInput, collectOutput, energyRate, loadRecipeInputs, machine, nearby, queueJob, removeQueuedJob, startJob, upgradeBuilding, type Recipe, type Job, type Building } from '../game/production';
import type { GameState } from '../game/state';
import { itemArt } from './art';
import { captureTokens, transferCraft, pulseCraft } from './craftMotion';
const h=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',cls='')=>{const e=document.createElement(tag);e.textContent=text;e.className=cls;return e;};
const button=(text:string,fn:()=>void,cls='',disabled=false)=>{const b=h('button',text,'craft-button '+cls);b.type='button';b.onclick=fn;b.disabled=disabled;return b;};
const name=(id:string)=>ITEMS[id]?.name??({water:'Вода',oxygen:'Кислород',hydrogen:'Водород'} as Record<string,string>)[id]??id;
const itemCell=(id?:string,count?:string,cls='')=>{const c=h('div','','craft-cell '+cls);if(id){c.append(itemArt(id));c.title=name(id);if(count)c.append(h('span',count,'craft-count'));}return c;};
function power(g:GameState,b:Building){
 const ids=new Set([b.id]);for(let i=0;i<g.world.base.buildings.length;i++)for(const l of g.world.base.links)if(l.kind==='cable'&&(ids.has(l.from)||ids.has(l.to))){ids.add(l.from);ids.add(l.to);}
 const generators=g.world.base.buildings.filter(v=>ids.has(v.id)&&v.kind==='biogenerator');
 return {connected:generators.length>0,available:generators.some(v=>v.enabled&&(v.energy>0||v.fuel>0||countItem(v.input,'fiber')>0))};
}
/** Persistent selection and filters; station jobs remain independent of the view. */
export function createCraftingView(){
 let selected='grass_parts',query='',category='all',available=false,material='',quantity=1,upgrade=false,lastStation='',inventoryView='assembly';
 let progress:HTMLElement|null=null,status:HTMLElement|null=null,bar:HTMLElement|null=null,powerBadge:HTMLElement|null=null;
 let viewRoot:HTMLElement|null=null;
 let previousJob:Job|null|undefined,outputSignature:string|undefined,queueExpanded:boolean|undefined;
 function open(id:string,isUpgrade=false){if(id!==lastStation){lastStation=id;selected=id==='hand'?'grass_parts':'craft_wrench';material='';quantity=1;}previousJob=undefined;outputSignature=undefined;queueExpanded=undefined;inventoryView='assembly';upgrade=isUpgrade;}
 function draw(g:GameState,id:string,notify:(reason:string,success?:string)=>void,changed:()=>void,redraw:()=>void){
  const b=machine(g,id),station=b?.kind??'hand',auto=b?.level===2,near=!b||nearby(g,b),job=b?b.job:g.world.base.hand;
  const root=h('div','','craft-layout');viewRoot=root;root.dataset.mode=upgrade?'upgrade':auto?'auto':b?'bench':'pocket';powerBadge=null;progress=null;bar=null;status=null;
  function action(fn:()=>string,success:string,from:Element[],target:string){const tokens=captureTokens(from,root.querySelector('[data-craft-view="bag"]'));const reason=fn();notify(reason,success);if(!reason)transferCraft(tokens,target);}
  function inventorySwitch(holder:HTMLElement,label='Сборка'){
   holder.dataset.view=inventoryView;const tabs=h('div','','craft-inventory-switch');
   for(const [view,text] of [['assembly',label],['bag','Рюкзак '+g.player.inventory.filter(Boolean).length+'/24']]){
    const tab=button(text,()=>{inventoryView=view;redraw();document.querySelector<HTMLButtonElement>(`[data-craft-view="${view}"]`)?.focus({preventScroll:true});});
    tab.dataset.craftView=view;tab.setAttribute('aria-pressed',String(inventoryView===view));tabs.append(tab);
   }holder.append(tabs);
  }
  function backpack(){const pack=h('section','','craft-backpack');pack.append(h('b','Рюкзак '+g.player.inventory.filter(Boolean).length+' / 24','craft-section-title'));const notice=h('p','Освободите место для готового предмета.','craft-bag-notice');notice.hidden=true;pack.append(notice);const grid=h('div','','craft-inventory');g.player.inventory.forEach((s:Slot,i:number)=>{const cell=button('',()=>{if(s?.itemId==='wrench'){if(i>=6){const old=g.player.inventory[g.player.hotbar];g.player.inventory[g.player.hotbar]=s;g.player.inventory[i]=old;}else g.player.hotbar=i;changed();}else material=material===s?.itemId?'':s?.itemId??'';redraw();},'craft-inventory-cell'+(i<6?' quick':'')+(i===g.player.hotbar?' active':''));cell.dataset.inventory=String(i);cell.setAttribute('aria-label',s?name(s.itemId)+' ×'+s.count:'Пустой слот '+(i+1));if(s){cell.append(itemArt(s.itemId),h('span',String(s.count),'craft-count'));cell.title=name(s.itemId)+(s.itemId==='wrench'?' · выбрать в быстром доступе':' · найти рецепты');}grid.append(cell);});pack.append(grid);return pack;}
  if(upgrade&&b){
   const preview=h('aside','','craft-upgrade-preview'),comparison=h('div','','craft-station-comparison');
   for(const level of [1,2]){const card=h('div','','craft-station-card');card.append(itemArt(level===1?'workbench':'workbench_2'),h('b','Верстак '+(level===1?'I':'II')));comparison.append(card);if(level===1)comparison.append(h('span','→','craft-arrow'));}
   inventorySwitch(preview,'Верстаки');preview.append(comparison,backpack());root.append(preview);
   const center=h('main','','craft-center'),assembly=h('section','','craft-assembly');center.append(assembly);root.append(center);
   const complete=b.level===2;assembly.append(h('b',complete?'Улучшение завершено':'Улучшение до уровня II','craft-section-title'));
   if(complete)assembly.append(h('p','Потрачено','craft-upgrade-paid'));
   const cost=h('div','','craft-upgrade-cost');for(const [item,n] of Object.entries(WORKBENCH_UPGRADE.inputs)){const group=h('div');group.append(itemCell(item,complete?'−'+n:countItem(g.player.inventory,item)+' / '+n,!complete&&countItem(g.player.inventory,item)<n?'missing':''),h('small',name(item)));cost.append(group);}assembly.append(cost);
   const hasKey=g.player.inventory[g.player.hotbar]?.itemId==='wrench',key=h('div','','craft-tool-check '+(complete||hasKey?'ready':'missing'));key.append(itemArt('wrench'),h('span',complete?'Ключ сохранён':hasKey?'Ключ выбран · сохранится':'Выберите ключ в быстром доступе'));assembly.append(key);
   const lack=Object.entries(WORKBENCH_UPGRADE.inputs).filter(([item,n])=>countItem(g.player.inventory,item)<n);
   const reason=b.level===2?'':!near?'Подойдите к верстаку':!hasKey?'Нужен ключ в руке':job?'Завершите текущую работу':lack.length?'Не хватает: '+lack.map(([item,n])=>name(item)+' ×'+(n-countItem(g.player.inventory,item))).join(', '):'';
   const back=()=>{upgrade=false;inventoryView='assembly';redraw();};
   if(complete)assembly.append(h('p','Верстак II готов. Подключите питание и начните сборку.','craft-hint'),button('К сборке',back,'craft-primary craft-upgrade-action'));
   else assembly.append(h('p',reason||'Материалы будут списаны из рюкзака.','craft-hint'),button('Улучшить',()=>action(()=>{const error=upgradeBuilding(g,id);if(!error)inventoryView='assembly';return error;},'Улучшение завершено',[...cost.querySelectorAll('.craft-cell')],'.craft-station-card:last-child'),'craft-primary craft-upgrade-action',!!reason),button('К сборке',back,'craft-upgrade-back'));
   const benefits=h('aside','','craft-upgrade-benefits');benefits.append(h('b','Новые возможности','craft-section-title'));for(const [symbol,text] of [['⚙','Автоматическая сборка'],['≡','Очередь: 5 партий'],['↗','Работает без игрока'],['ϟ','Нужно питание: 4 EU/с']]){const row=h('p','','craft-benefit');row.append(h('b',symbol),h('span',text));benefits.append(row);}benefits.append(h('p','После улучшения соедините верстак с генератором кабелем.','craft-hint'));root.append(benefits);return root;
  }
  const catalogue=h('aside','','craft-catalogue');catalogue.append(h('b','Каталог','craft-section-title'));
  const cats=h('div','','craft-categories');for(const [value,label] of [['all','Все'],['resource','Мат.'],['tool','Снар.'],['building','База']]){const c=button(label,()=>{category=value;redraw();});c.setAttribute('aria-pressed',String(category===value));cats.append(c);}catalogue.append(cats);
  const searchRow=h('div','','craft-search-row'),search=h('input');search.type='search';search.id='craft-search';search.placeholder='Поиск…';search.value=query;search.setAttribute('aria-label','Поиск рецепта');search.oninput=()=>{query=search.value;refreshCatalogue();};
  const filter=button('Доступные',()=>{available=!available;redraw();},'craft-filter');filter.title='Только доступные рецепты';filter.setAttribute('aria-label',filter.title);filter.setAttribute('aria-pressed',String(available));searchRow.append(search,filter);catalogue.append(searchRow);
  const materialButton=button('Материал: '+name(material)+' ×',()=>{material='';redraw();},'craft-material-filter');materialButton.hidden=!material;catalogue.append(materialButton);if(!material)catalogue.append(h('small','Материал — нажмите в рюкзаке','craft-material-help'));
  const legend=h('div','','craft-legend');legend.append(h('span','● Есть'),h('span','○ Не хватает'),h('span','Станция','craft-lock-label'));catalogue.append(legend);
  const grid=h('div','','craft-recipe-grid');catalogue.append(grid);root.append(catalogue);
  const owned=(r:Recipe)=>Object.entries(r.inputs).every(([item,n])=>countItem(g.player.inventory,item)+countItem(b?.input??[],item)>=n);
  const matches=(r:Recipe)=>{const out=Object.keys(r.outputs)[0],cat=ITEMS[out]?.category;return (!query||name(out).toLowerCase().includes(query.toLowerCase()))&&(category==='all'||category==='tool'&&(cat==='tool'||cat==='tank'||cat==='suit')||category===cat)&&(!material||material in r.inputs)&&(!available||(r.station===station&&owned(r)));};
  function refreshCatalogue(){grid.replaceChildren();for(const r of RECIPES.filter(matches)){const out=Object.keys(r.outputs)[0],can=r.station===station,cell=button('',()=>{selected=r.id;quantity=1;inventoryView='assembly';redraw();},'craft-recipe'+(r.id===selected?' selected':'')+(can?'':' locked'));cell.dataset.recipe=r.id;cell.title=name(out)+(can?(owned(r)?' · Есть материалы':' · Не хватает материалов'):' · '+(r.station==='hand'?'Карманный крафт':'Нужна станция: '+name(r.station)));cell.setAttribute('aria-label',cell.title);cell.setAttribute('aria-pressed',String(r.id===selected));cell.append(itemArt(out),h('i',can?(owned(r)?'●':'○'):'','craft-availability'+(can?'':' craft-lock')));grid.append(cell);}if(!grid.children.length)grid.append(h('p','Рецепты не найдены','craft-empty'));}
  refreshCatalogue();
  const center=h('main','','craft-center'),assembly=h('section','','craft-assembly');inventorySwitch(center);root.append(center);
  const r=RECIPE_BY_ID.get(selected)??RECIPES[0],applicable=r.station===station;assembly.append(h('b',name(Object.keys(r.outputs)[0]),'craft-section-title'));
  const row=h('div','','craft-assembly-row'),inputs=h('div','','craft-inputs '+(b?'bench-inputs':'pocket-inputs')),required=Object.entries(r.inputs),slots=b?4:2;
  const missingTypes=b?required.filter(([item])=>!b.input.some(s=>s?.itemId===item)):[];let ghostIndex=0;
  for(let i=0;i<slots;i++){const s=b?.input[i],item=b?s?.itemId:required[i]?.[0],need=item?r.inputs[item]:undefined,have=item?(b?s!.count:countItem(g.player.inventory,item)):0,cell=itemCell(item,item?have+(need?' / '+need:''):'',need&&have<need?'missing':'');if(!item&&b&&missingTypes[ghostIndex]){const [ghost,n]=missingTypes[ghostIndex++];cell.append(itemArt(ghost));cell.classList.add('ghost');cell.title=name(ghost)+' · нужно '+n;cell.append(h('span','0 / '+n,'craft-count'));}inputs.append(cell);}
  const result=h('div','','craft-result');for(const [out,n] of Object.entries(r.outputs))result.append(itemCell(out,String(n)));row.append(inputs,h('span','→','craft-arrow'),result);assembly.append(row,h('p',required.map(([item,n])=>name(item)+' ×'+n).join(' · '),'craft-requirements'));
  const pledged:Record<string,number>={};if(auto)for(const rid of b.queue)for(const [item,n] of Object.entries(RECIPE_BY_ID.get(rid)!.inputs))pledged[item]=(pledged[item]??0)+n;
  const missing=required.filter(([item,n])=>countItem(g.player.inventory,item)+countItem(b?.input??[],item)<n*(auto?quantity:1)+(pledged[item]??0));
  const loaded=!b||required.every(([item,n])=>countItem(b.input,item)>=n);
  const full=auto&&b.queue.length+(b.job?1:0)+quantity>5;
  const reason=!near?'Подойдите к верстаку':!applicable?'Нужна станция: '+(r.station==='hand'?'карманный крафт':name(r.station)):!auto&&job?'':full?'В очереди максимум 5 партий':missing.length?'Не хватает: '+missing.map(([item])=>name(item)).join(', '):!auto&&!loaded?'Нажмите «Дополнить»':'';
  let bufferTools:HTMLElement|undefined;const actions=h('div','','craft-assembly-actions');
  if(b)actions.append(button('Дополнить',()=>action(()=>loadRecipeInputs(g,r.id,id),'Недостающие материалы загружены',[...root.querySelectorAll('.craft-inventory-cell')].filter(e=>required.some(([item])=>!!e.querySelector(`[data-item="${item}"]`))),'.craft-inputs'),'',!near||!applicable||!owned(r)));
  if(auto){const amount=h('div','','craft-quantity');amount.append(button('−',()=>{quantity=Math.max(1,quantity-1);redraw();},'',quantity<=1),h('span',String(quantity)),button('+',()=>{quantity=Math.min(5,quantity+1);redraw();},'',quantity>=5));actions.append(amount);}
  actions.append(button(!applicable?'Нужна станция':auto?'В очередь':job?'Идёт сборка':'Создать',()=>action(()=>auto?queueJob(g,r.id,id,quantity):startJob(g,r.id,id,!!b),auto?'Добавлено в очередь':'Работа начата',[...inputs.querySelectorAll('.craft-cell')],'.craft-result'),'craft-primary',!!reason||(!auto&&!!job)));
  const rate=b&&applicable?energyRate(b,r):r.EU_per_second;assembly.append(actions,h('small',r.seconds+' с'+(rate?' · '+rate+' EU/с':'')+' · '+(b?'4 входных слота':'2 типа материалов'),'craft-hint'));if(reason)assembly.append(h('p',reason,'craft-action-reason'));
  if(b){const tools=h('details','','craft-buffer-tools');tools.append(h('summary','Управление верстаком'));tools.append(button('Вернуть входы',()=>notify(collectInput(g,id)?'':'Вход пуст или рюкзак полон','Материалы возвращены'),'',!near),button(b.enabled?'Выключить':'Включить',()=>{b.enabled=!b.enabled;changed();redraw();},'',!near));if(!auto)tools.append(button('Улучшить верстак',()=>{upgrade=true;redraw();},'craft-upgrade-link',!near));bufferTools=tools;}
  center.append(assembly,backpack());
  const context=h('aside','','craft-context'),fixed=h('div','','craft-work-status'),work=h('div','','craft-work');context.append(fixed,work);root.append(context);
  fixed.append(h('b',auto?'Очередь '+(b.queue.length+(job?1:0))+' / 5':b?'Ручная сборка':'В кармане','craft-section-title'));
  status=h('p','','craft-hint');status.id='production-status';fixed.append(status);
  if(auto){powerBadge=h('p','','craft-power');powerBadge.id='craft-power';fixed.append(powerBadge);}
  const active=h('div','','craft-active');if(job)active.append(itemArt(Object.keys(RECIPE_BY_ID.get(job.recipeId)!.outputs)[0]));const activeText=h('div');progress=h('p','','craft-progress');progress.id='craft-progress';activeText.append(progress);const track=h('div','','craft-track');bar=h('i');track.append(bar);activeText.append(track);active.append(activeText);if(job)active.append(button('×',()=>notify(cancelJob(g,id),'Материалы возвращены'),'craft-cancel',!near));if(job){active.lastElementChild!.setAttribute('aria-label','Отменить');active.lastElementChild!.setAttribute('title','Отменить текущую работу');}fixed.append(active);
  if(auto&&b.queue.length){
   const queue=h('section','','craft-queue'),expanded=queueExpanded??window.innerHeight>430;queue.dataset.expanded=String(expanded);
   const toggle=button('Ожидают: '+b.queue.length,()=>{queueExpanded=!expanded;redraw();document.querySelector<HTMLButtonElement>('.craft-queue-toggle')?.focus({preventScroll:true});},'craft-queue-toggle');toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-controls','craft-waiting');
   const items=h('div','','craft-queue-items');items.id='craft-waiting';items.hidden=!expanded;queue.append(toggle,items);
   b.queue.forEach((rid,i)=>{const recipe=RECIPE_BY_ID.get(rid)!,qr=h('div','','craft-queue-row');qr.dataset.queueIndex=String(i);qr.append(itemArt(Object.keys(recipe.outputs)[0]),h('small',(i+(job?2:1))+'. '+name(Object.keys(recipe.outputs)[0])));const remove=button('×',()=>notify(removeQueuedJob(g,id,i),'Партия убрана; материалы во входе'),'craft-cancel',!near);remove.setAttribute('aria-label','Убрать партию '+(i+(job?2:1)));qr.append(remove);items.append(qr);});
   items.append(button('Очистить очередь',()=>{clearQueue(g,id);changed();redraw();},'',!near));work.append(queue);
  }
  if(bufferTools)work.append(bufferTools);
  if(b){const outputPanel=h('section','','craft-output-panel'),head=h('div','','craft-output-head');head.append(h('b','Готово','craft-section-title'),button('Забрать',()=>{const tokens=captureTokens(outputPanel.querySelectorAll('.craft-cell'));const n=collectOutput(g,id);notify(n?'':'Нет места или готовых предметов','Перенесено в рюкзак');if(n)transferCraft(tokens,'.craft-inventory','[data-craft-view="bag"]');},'',!near||!b.output.some(Boolean)));const output=h('div','','craft-output');b.output.forEach(s=>output.append(itemCell(s?.itemId,s?String(s.count):undefined)));outputPanel.append(head,output);context.append(outputPanel);}
  else work.append(h('p','Одна работа. Готовое → рюкзак.','craft-hint'));
  tick(g,id);return root;
 }
 function tick(g:GameState,id:string){if(!status||!progress||!bar)return;const b=machine(g,id),job=b?.job??(id==='hand'?g.world.base.hand:null),p=b?.level===2?power(g,b):null;
  let text=id==='hand'?'Без очереди':b?.level===1?'Рядом с вами · без очереди':'Без присутствия игрока';
  if(b&&!nearby(g,b))text=b.level===1?'Пауза · подойдите к верстаку':'Автоматизация работает вдали';
  if(b?.level===1&&g.world.base.hand)text='Пауза · занят карманным крафтом';if(b&&!b.enabled)text='Пауза · верстак выключен';
  if(b?.level===2&&!p!.available)text='Пауза · нет питания';if(status.textContent!==text)status.textContent=text;
  if(powerBadge&&p){powerBadge.textContent=!b!.enabled?'ϟ Верстак выключен':p.available?'ϟ Питание подключено':p.connected?'ϟ Генератор: нет энергии':'ϟ Подключите генератор кабелем';powerBadge.dataset.power=p.available?'ready':'missing';}
  const r=job?RECIPE_BY_ID.get(job.recipeId)!:null,ratio=job&&r?Math.min(1,job.workMs/(r.seconds*1000)):0;const width=ratio*100+'%';if(bar.style.width!==width)bar.style.width=width;
  const progressText=job&&r?(b?.level===2?'1. ':'')+name(Object.keys(r.outputs)[0])+' · '+Math.floor(ratio*100)+'%'+(ratio===1?(b?' · освободите выход':' · освободите место в рюкзаке'):' · '+((r.seconds*1000-job.workMs)/1000).toFixed(1)+' с'):'Нет активной работы';if(progress.textContent!==progressText)progress.textContent=progressText;
  const blocked=!b&&!!job&&ratio===1,pack=viewRoot?.querySelector('.craft-backpack'),bag=viewRoot?.querySelector<HTMLButtonElement>('[data-craft-view="bag"]'),notice=pack?.querySelector<HTMLElement>('.craft-bag-notice');pack?.classList.toggle('craft-bag-blocked',blocked);bag?.classList.toggle('craft-bag-blocked',blocked);if(notice)notice.hidden=!blocked;
  if(previousJob!==undefined&&job&&previousJob!==job){queueMicrotask(()=>{pulseCraft('.craft-result');pulseCraft('.craft-active');});}previousJob=job;
  const sig=b?JSON.stringify(b.output):JSON.stringify(g.player.inventory);if(outputSignature!==undefined&&outputSignature!==sig)queueMicrotask(()=>pulseCraft(b?'.craft-output':'.craft-backpack','[data-craft-view="bag"]'));outputSignature=sig;
 }
 return {open,draw,tick};
}
