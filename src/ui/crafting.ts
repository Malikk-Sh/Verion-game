import { ITEMS } from '../game/defs';
import { countItem, type Slot } from '../game/inventory';
import { RECIPES, RECIPE_BY_ID, WORKBENCH_UPGRADE, cancelJob, clearQueue, collectInput, collectOutput, energyRate, loadRecipeInputs, machine, nearby, queueJob, startJob, upgradeBuilding, type Recipe } from '../game/production';
import type { GameState } from '../game/state';
import { itemArt } from './art';
const h=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',cls='')=>{const e=document.createElement(tag);e.textContent=text;e.className=cls;return e;};
const button=(text:string,fn:()=>void,cls='',disabled=false)=>{const b=h('button',text,'craft-button '+cls);b.type='button';b.onclick=fn;b.disabled=disabled;return b;};
const name=(id:string)=>ITEMS[id]?.name??({water:'Вода',oxygen:'Кислород',hydrogen:'Водород'} as Record<string,string>)[id]??id;
const itemCell=(id?:string,count?:string,cls='')=>{const c=h('div','','craft-cell '+cls);if(id){c.append(itemArt(id));c.title=name(id);if(count)c.append(h('span',count,'craft-count'));}return c;};
/** Persistent selection/search, while the view is rebuilt only after inventory/job transitions. */
export function createCraftingView(){
 let selected='grass_parts',query='',category='all',available=false,material='',quantity=1,upgrade=false,lastStation='';
 let progress:HTMLElement|null=null,status:HTMLElement|null=null,bar:HTMLElement|null=null;
 function open(id:string,isUpgrade=false){if(id!==lastStation){lastStation=id;selected=id==='hand'?'grass_parts':'craft_wrench';material='';quantity=1;}upgrade=isUpgrade;}
 function draw(g:GameState,id:string,notify:(reason:string,success?:string)=>void,changed:()=>void,redraw:()=>void){
  const b=machine(g,id),station=b?.kind??'hand',auto=b?.level===2,near=!b||nearby(g,b),job=b?b.job:g.world.base.hand;
  const root=h('div','','craft-layout');root.dataset.mode=upgrade?'upgrade':auto?'auto':b?'bench':'pocket';
  const catalogue=h('aside','','craft-catalogue');catalogue.append(h('b','Каталог','craft-section-title'));
  const cats=h('div','','craft-categories');for(const [value,label] of [['all','Все'],['resource','Мат.'],['tool','Снар.'],['building','База']]){const c=button(label,()=>{category=value;redraw();});c.setAttribute('aria-pressed',String(category===value));cats.append(c);}catalogue.append(cats);
  const search=h('input');search.type='search';search.id='craft-search';search.placeholder='Поиск…';search.value=query;search.setAttribute('aria-label','Поиск рецепта');search.oninput=()=>{query=search.value;refreshCatalogue();};catalogue.append(search);
  const filter=button(available?'✓ Доступные':'Все рецепты',()=>{available=!available;redraw();},'craft-filter');filter.setAttribute('aria-pressed',String(available));catalogue.append(filter);
  const materialButton=button(material?'Материал: '+name(material)+' ×':'По материалу: нажмите в рюкзаке',()=>{material='';redraw();},'craft-material-filter');materialButton.disabled=!material;catalogue.append(materialButton);
  const grid=h('div','','craft-recipe-grid');catalogue.append(grid);root.append(catalogue);
  const matches=(r:Recipe)=>{const out=Object.keys(r.outputs)[0],cat=ITEMS[out]?.category;return (!query||name(out).toLowerCase().includes(query.toLowerCase()))&&(category==='all'||category==='tool'&&(cat==='tool'||cat==='tank'||cat==='suit')||category===cat)&&(!material||material in r.inputs)&&(!available||(r.station===station&&Object.entries(r.inputs).every(([item,n])=>item==='water'?(b?.water??0)>=n*1000:countItem(g.player.inventory,item)+countItem(b?.input??[],item)>=n)));};
  function refreshCatalogue(){grid.replaceChildren();for(const r of RECIPES.filter(matches)){const out=Object.keys(r.outputs)[0],can=r.station===station,owned=can&&Object.entries(r.inputs).every(([item,n])=>countItem(g.player.inventory,item)+countItem(b?.input??[],item)>=n),cell=button('',()=>{selected=r.id;upgrade=false;quantity=1;redraw();},'craft-recipe'+(r.id===selected?' selected':'')+(can?'':' locked'));
    cell.dataset.recipe=r.id;cell.title=name(out)+(can?'':' · '+(r.station==='hand'?'Карманный крафт':'Нужна станция: '+name(r.station)));cell.setAttribute('aria-label',cell.title);cell.setAttribute('aria-pressed',String(r.id===selected));cell.append(itemArt(out),h('i',can?(owned?'●':'○'):'⌁','craft-availability'));grid.append(cell);
   }if(!grid.children.length)grid.append(h('p','Рецепты не найдены','craft-empty'));}
  refreshCatalogue();
  const center=h('main','','craft-center'),assembly=h('section','','craft-assembly');root.append(center);
  if(upgrade&&b){
   assembly.append(h('b',b.level===1?'Верстак I → II':'Верстак II','craft-section-title'),h('p','Автономная сборка · очередь 5 · 4 EU/с','craft-hint'));
   const cost=h('div','','craft-upgrade-cost');for(const [item,n] of Object.entries(WORKBENCH_UPGRADE.inputs))cost.append(itemCell(item,countItem(g.player.inventory,item)+' / '+n,countItem(g.player.inventory,item)<n?'missing':''));assembly.append(cost);
   assembly.append(h('p','Ключ остаётся у вас. Материалы списываются при улучшении.','craft-hint'),button(b.level===1?'Улучшить':'Уже улучшен',()=>notify(upgradeBuilding(g,id),'Верстак II: подключите кабель от генератора'),'craft-primary',!near||b.level===2),button('К сборке',()=>{upgrade=false;redraw();}));
  }else{
   const r=RECIPE_BY_ID.get(selected)??RECIPES[0],applicable=r.station===station;
   assembly.append(h('b',name(Object.keys(r.outputs)[0]),'craft-section-title'));
   const row=h('div','','craft-assembly-row'),inputs=h('div','','craft-inputs '+(b?'bench-inputs':'pocket-inputs'));
   const required=Object.entries(r.inputs),slots=b?4:2;
   const missingTypes=b?required.filter(([item])=>!b.input.some(s=>s?.itemId===item)):[];let ghostIndex=0;
   // Physical workbench buffer replaces the old duplicated stock/material sections.
   for(let i=0;i<slots;i++){
    const s=b?.input[i],item=b?s?.itemId:required[i]?.[0],need=item?r.inputs[item]:undefined,owned=item?(b?s!.count:countItem(g.player.inventory,item)):0;
    const cell=itemCell(item,item?owned+(need?' / '+need:''):'',need&&owned<need?'missing':'');
    if(!item&&b&&missingTypes[ghostIndex]){const [ghost,n]=missingTypes[ghostIndex++];cell.append(itemArt(ghost));cell.classList.add('ghost');cell.title=name(ghost)+' · нужно '+n;cell.append(h('span','0 / '+n,'craft-count'));}
    inputs.append(cell);
   }
   const result=h('div','','craft-result');for(const [out,n] of Object.entries(r.outputs))result.append(itemCell(out,String(n)));row.append(inputs,h('span','→','craft-arrow'),result);assembly.append(row);
   assembly.append(h('p',required.map(([item,n])=>name(item)+' ×'+n).join(' · '),'craft-requirements'));
   const actions=h('div','','craft-assembly-actions');
   if(b)actions.append(button('Дополнить',()=>notify(loadRecipeInputs(g,r.id,id),'Недостающие материалы загружены'),' ',!near||!applicable));
   if(auto){const amount=h('div','','craft-quantity');amount.append(button('−',()=>{quantity=Math.max(1,quantity-1);redraw();},'',quantity<=1),h('span',String(quantity)),button('+',()=>{quantity=Math.min(5,quantity+1);redraw();},'',quantity>=5));actions.append(amount);}
   const label=!applicable?'Нужна станция':auto?'В очередь':job?'Идёт сборка':'Создать';
   actions.append(button(label,()=>notify(auto?queueJob(g,r.id,id,quantity):startJob(g,r.id,id,!!b),auto?'Добавлено в очередь':'Работа начата'),'craft-primary',!near||!applicable||(!auto&&!!job)));
   const rate=b&&applicable?energyRate(b,r):r.EU_per_second;
   assembly.append(actions,h('small',r.seconds+' с'+(rate?' · '+rate+' EU/с':'')+(!applicable?' · Требуется: '+(r.station==='hand'?'карманный крафт':name(r.station)):id==='hand'?' · 2 типа материалов':b?' · 4 входных слота':''),'craft-hint'));
  }
  center.append(assembly);
  const backpack=h('section','','craft-backpack');backpack.append(h('b','Рюкзак '+g.player.inventory.filter(Boolean).length+' / 24','craft-section-title'));
  const inventory=h('div','','craft-inventory');g.player.inventory.forEach((s:Slot,i:number)=>{const cell=button('',()=>{if(s?.itemId==='wrench'){if(i>=6){const old=g.player.inventory[g.player.hotbar];g.player.inventory[g.player.hotbar]=s;g.player.inventory[i]=old;}else g.player.hotbar=i;changed();}else material=material===s?.itemId?'':s?.itemId??'';redraw();},'craft-inventory-cell'+(i<6?' quick':'')+(i===g.player.hotbar?' active':''));cell.dataset.inventory=String(i);cell.setAttribute('aria-label',s?name(s.itemId)+' ×'+s.count:'Пустой слот '+(i+1));if(s){cell.append(itemArt(s.itemId),h('span',String(s.count),'craft-count'));cell.title=name(s.itemId)+(s.itemId==='wrench'?' · выбрать в быстром доступе':' · найти рецепты');}inventory.append(cell);});backpack.append(inventory);center.append(backpack);
  const context=h('aside','','craft-context');root.append(context);
  context.append(h('b',auto?'Автосборка':b?'Ручная сборка':'В кармане','craft-section-title'));
  status=h('p','','craft-hint');status.id='production-status';context.append(status);
  progress=h('p','','craft-progress');progress.id='craft-progress';context.append(progress);const track=h('div','','craft-track');bar=h('i');track.append(bar);context.append(track);
  if(job)context.append(button('Отменить',()=>notify(cancelJob(g,id),'Материалы возвращены'),'',!near));
  if(b){const outputTitle=h('b','Готово','craft-section-title');context.append(outputTitle);const output=h('div','','craft-output');b.output.forEach(s=>output.append(itemCell(s?.itemId,s?String(s.count):undefined)));context.append(output,button('Забрать',()=>notify(collectOutput(g,id)?'':'Нет места или готовых предметов','Перенесено в рюкзак'),'',!near||!b.output.some(Boolean)),button('Вернуть входы',()=>notify(collectInput(g,id)?'':'Вход пуст или рюкзак полон','Материалы возвращены'),'',!near));
   if(auto){context.insertBefore(h('b','Очередь '+(b.queue.length+(b.job?1:0))+' / 5','craft-section-title'),outputTitle);const queue=h('div','','craft-queue');b.queue.forEach((rid,i)=>{const r=RECIPE_BY_ID.get(rid)!;const row=h('div','','craft-queue-row');row.append(itemArt(Object.keys(r.outputs)[0]),h('small',(i+1)+'. '+name(Object.keys(r.outputs)[0])));queue.append(row);});context.insertBefore(queue,outputTitle);if(b.queue.length)context.insertBefore(button('Очистить очередь',()=>{clearQueue(g,id);changed();redraw();}),outputTitle);
   }else context.append(button('Улучшить верстак',()=>{upgrade=true;redraw();},'craft-upgrade-link',!near));
   context.append(button(b.enabled?'Выключить':'Включить',()=>{b.enabled=!b.enabled;changed();redraw();},'',!near));
  }else context.append(h('p','Одна работа за раз. Результат попадает в рюкзак.','craft-hint'));
  tick(g,id);return root;
 }
 function tick(g:GameState,id:string){if(!status||!progress||!bar)return;const b=machine(g,id),job=b?.job??(id==='hand'?g.world.base.hand:null);
  let text=id==='hand'?'Без очереди':b?.level===1?'Работает рядом с вами · без очереди':'Работает без вашего присутствия';
  if(b&&!nearby(g,b))text=b.level===1?'Пауза · подойдите к верстаку':'Вы отошли · автоматизация работает';
  if(b?.level===1&&g.world.base.hand)text='Пауза · занят карманным крафтом';
  if(b&&!b.enabled)text='Пауза · верстак выключен';
  if(b?.level===2&&job&&job.workMs<RECIPE_BY_ID.get(job.recipeId)!.seconds*1000){const ids=new Set([b.id]);for(let i=0;i<g.world.base.buildings.length;i++)for(const l of g.world.base.links)if(l.kind==='cable'&&(ids.has(l.from)||ids.has(l.to))){ids.add(l.from);ids.add(l.to);}if(!g.world.base.buildings.some(v=>ids.has(v.id)&&v.kind==='biogenerator'&&v.enabled&&(v.energy>0||v.fuel>0||countItem(v.input,'fiber')>0)))text='Пауза · нет питания';}
  status.textContent=text;
  const r=job?RECIPE_BY_ID.get(job.recipeId)!:null,ratio=job&&r?Math.min(1,job.workMs/(r.seconds*1000)):0;bar.style.width=ratio*100+'%';
  progress.textContent=job&&r?name(Object.keys(r.outputs)[0])+' · '+Math.floor(ratio*100)+'%'+(ratio===1?' · освободите выход':' · '+((r.seconds*1000-job.workMs)/1000).toFixed(1)+' с'):'Нет активной работы';
 }
 return {open,draw,tick};
}
