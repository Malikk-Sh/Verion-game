import { heightAt } from '../world';
import catalog from './catalog.generated.json';
import { recordQuestFact } from './questFacts';
import { BUILDABLE, ITEMS, TANKS, TOOLS, type BuildingKind } from './defs';
import { addItems, countItem, emptyInventory, firstEmpty, removeItems, type Slot } from './inventory';
import { dropItems } from './mining';
import type { GameState, ItemStack } from './state';
export type Recipe = { id: string; station: string; inputs: Record<string, number>; outputs: Record<string, number>; seconds: number; EU_per_second: number };
export const RECIPES: Recipe[] = catalog.recipes as unknown as Recipe[];
export const RECIPE_BY_ID = new Map(RECIPES.map(r => [r.id, r]));
export type Job = { recipeId: string; workMs: number; reserved: ItemStack[]; water: number };
export type Building = { id: string; kind: BuildingKind; level: 1 | 2; x: number; y: number; z: number; input: Slot[]; output: Slot[]; job: Job | null; queue: string[]; enabled: boolean; lowPriority: boolean; energy: number; fuel: number; water: number; oxygen: number; zone: { q: number; temperature: number; purity: number; lossRemainder: number; breachMs: number; shell: number[] } };
export type Link = { id: string; kind: 'cable' | 'gas_pipe'; from: string; to: string };
export type BaseState = { buildings: Building[]; links: Link[]; nextId: number; hand: Job | null; handQueue: string[]; passage: { domeId: string; direction: 'in' | 'out'; remainingMs: number } | null };
export const freshBase = (): BaseState => ({ buildings: [], links: [], nextId: 1, hand: null, handQueue: [], passage: null });
export const machine = (g: GameState, id: string) => g.world.base.buildings.find(b => b.id === id);
export const DOME_VOLUME = 48;
export const DOME_CAPACITY = 960000;
export const endpoint = (g: GameState, id: string) => id === 'capsule' ? { x: 40, y: heightAt(40,40)+.14, z: 40 } : machine(g, id);
export const insideDome = (b: Building, x: number, y: number, z: number) => b.kind === 'dome' && Math.abs(x - b.x) < 2 && Math.abs(z - b.z) < 2 && y >= b.y - .1 && y < b.y + 3;
/** 4×4×3 air cells, panels occupy faces. Each of 80 exterior faces owns HP. */
export function domeFaces() {
 const faces: { cell: number[]; next: number[] }[] = [];
 for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) for (let y = 0; y < 3; y++) for (const d of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
  const n = [x+d[0], y+d[1], z+d[2]]; if (n[0]<0 || n[0]>=4 || n[1]<0 || n[1]>=3 || n[2]<0 || n[2]>=4) faces.push({ cell: [x,y,z], next: n });
 }
 return faces;
}
const FACES = domeFaces();
const FACE_INDEX = new Map(FACES.map((f,i)=>[f.cell.join(',')+'>'+f.next.join(','),i]));
const SEALS = new WeakMap<number[], { signature: string; result: { sealed: boolean; volume: number; path: string[] } }>();
/** Flood fill visits actual air cells; a missing panel reports the escape path. */
export function sealCheck(shell: number[]) {
 const signature=shell.join(',');const cached=SEALS.get(shell);if(cached?.signature===signature)return cached.result;
 const remember=(result:{sealed:boolean;volume:number;path:string[]})=>{SEALS.set(shell,{signature,result});return result;};
 const key = (p: number[]) => p.join(','), seen = new Set<string>(), queue = [[1,1,1]], parent = new Map<string, string>();
 while (queue.length) {
  const p = queue.shift()!, k = key(p); if (seen.has(k)) continue; seen.add(k);
  for (const d of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
   const n = [p[0]+d[0],p[1]+d[1],p[2]+d[2]], nk = key(n), edge = FACE_INDEX.get(k+'>'+nk) ?? -1;
   if (edge >= 0) { if (shell[edge] > 0) continue; const path = [nk,k]; while (parent.has(path.at(-1)!)) path.push(parent.get(path.at(-1)!)!); return remember({ sealed: false, volume: seen.size, path: path.reverse() }); }
   if (!seen.has(nk)) { if (!parent.has(nk)) parent.set(nk,k); queue.push(n); }
  }
 }
 return remember({ sealed: true, volume: seen.size, path: [] as string[] });
}
export const habitable = (b: Building) => b.kind === 'dome' && sealCheck(b.zone.shell).sealed && b.zone.q >= 384000 && b.zone.purity >= .5 && b.zone.temperature >= -5 && b.zone.temperature <= 40;
export const breathingDome = (g: GameState) => g.world.base.buildings.find(b => insideDome(b,g.player.x,g.player.y,g.player.z) && habitable(b));
function outputSlots(r: Recipe): ItemStack[] {
 const out: ItemStack[] = [];
 for (const [itemId, count] of Object.entries(r.outputs)) if (ITEMS[itemId]) {
  if (TOOLS[itemId] || TANKS[itemId]) for (let n=0;n<count;n++) out.push({ itemId, count: 1, ...(TOOLS[itemId] ? { durability: TOOLS[itemId].durability } : { milliGU: 0 }) });
  else out.push({ itemId, count });
 }
 return out;
}
function insert(slots: Slot[], items: ItemStack[]): boolean {
 const copy = structuredClone(slots);
 for (const s of items) {
  if (s.durability !== undefined || s.milliGU !== undefined) { const i=firstEmpty(copy); if(i<0)return false; copy[i]={...s}; }
  else if(addItems(copy,s.itemId,s.count))return false;
 }
 slots.splice(0,slots.length,...copy); return true;
}
export const WORKBENCH_UPGRADE = catalog.upgrades.workbench;
export const nearby = (g: GameState, b: Building) => Math.hypot(b.x-g.player.x,b.z-g.player.z)<=3.2;
export const hasQueue = (b?: Building) => !!b && (b.kind !== 'workbench' || b.level === 2);
export const manualWork = (g: GameState) => g.world.base.buildings.filter(b=>b.kind==='workbench'&&b.level===1&&b.job&&b.enabled&&nearby(g,b)).sort((a,b)=>Math.hypot(a.x-g.player.x,a.z-g.player.z)-Math.hypot(b.x-g.player.x,b.z-g.player.z))[0];
export const energyRate = (b: Building, r: Recipe) => b.kind === 'workbench' && b.level === 2 ? WORKBENCH_UPGRADE.EU_per_second : r.EU_per_second;
export const electricPort = (b: {kind:string;level?:number}) => !['capsule','dome','kiln'].includes(b.kind) && (b.kind !== 'workbench' || b.level === 2);
export function upgradeBuilding(g: GameState, id: string): string {
 const b=machine(g,id);if(!b || b.kind!=='workbench')return 'Для этой постройки пока нет улучшения';
 if(!nearby(g,b))return 'Подойдите к станции';
 if(g.player.vitals.health<=0)return 'Персонаж погиб';
 if(g.player.inventory[g.player.hotbar]?.itemId!==WORKBENCH_UPGRADE.tool)return 'Выберите гаечный ключ в быстром доступе';
 if(b.level!==1)return 'Верстак уже улучшен';
 if(b.job || b.queue.length)return 'Сначала завершите или отмените работу';
 for(const [item,n] of Object.entries(WORKBENCH_UPGRADE.inputs))if(countItem(g.player.inventory,item)<n)return 'Не хватает: '+ITEMS[item].name;
 for(const [item,n] of Object.entries(WORKBENCH_UPGRADE.inputs))removeItems(g.player.inventory,item,n);
 b.level=2;return '';
}
/** Move just the missing recipe inputs; selection never spends materials. */
export function loadRecipeInputs(g: GameState, recipeId: string, id: string): string {
 const b=machine(g,id),r=RECIPE_BY_ID.get(recipeId);
 if(!b || !r || r.station!==b.kind)return 'Нужна подходящая станция';
 if(!nearby(g,b))return 'Подойдите к станции';
 const inv=structuredClone(g.player.inventory),input=structuredClone(b.input);
 for(const [item,n] of Object.entries(r.inputs))if(item!=='water'){
  const missing=Math.max(0,n-countItem(input,item));if(countItem(inv,item)<missing)return 'Не хватает: '+ITEMS[item].name;
  if(addItems(input,item,missing))return 'Входной буфер полон';removeItems(inv,item,missing);
 }
 g.player.inventory=inv;b.input=input;return '';
}
export function startJob(g: GameState, recipeId: string, id = 'hand', buffered = false): string {
 const r = RECIPE_BY_ID.get(recipeId), b = id === 'hand' ? undefined : machine(g,id);
 if (!r || (id === 'hand' ? r.station !== 'hand' : !b || r.station !== b.kind)) return 'Нужна подходящая станция';
 if (id==='hand' && Object.keys(r.inputs).length>2)return 'В кармане доступны два типа материалов';
 if (g.player.vitals.health <= 0) return 'Персонаж погиб';
 if (id === 'hand' ? g.world.base.hand : b!.job) return 'Сначала завершите или отмените текущую работу';
 if (b && (!buffered || (b.kind==='workbench' && b.level===1)) && !nearby(g,b)) return 'Подойдите к станции';
 const inv = buffered && b ? b.input : g.player.inventory;
 for (const [item,n] of Object.entries(r.inputs)) if (item === 'water' ? (b?.water ?? 0)<n*1000 : countItem(inv,item)<n) return 'Не хватает: '+(ITEMS[item]?.name ?? 'Вода');
 if (r.id === 'melt_in_generator' && b!.water > 19000) return 'Буфер воды полон';
 if (r.id === 'electrolysis' && b!.oxygen > 240000) return 'Буфер O₂ полон';
 const reserved: ItemStack[] = [];
 for (const [item,n] of Object.entries(r.inputs)) if (item !== 'water') { removeItems(inv,item,n); reserved.push({itemId:item,count:n}); } else b!.water-=n*1000;
 const job: Job = {recipeId,workMs:0,reserved,water:(r.inputs.water??0)*1000};
 if(id==='hand')g.world.base.hand=job;else b!.job=job;
 return '';
}
/** Future machine inputs live in ordinary four-slot buffers, not WIP. */
export function queueJob(g: GameState, recipeId: string, id = 'hand', count = 5): string {
 const r=RECIPE_BY_ID.get(recipeId),b=id==='hand'?undefined:machine(g,id),queue=id==='hand'?g.world.base.handQueue:b?.queue;
 if(!hasQueue(b))return 'Очередь открывается после улучшения верстака';
 if(!r||!queue||r.station!==(b?.kind??'hand')||!Number.isInteger(count)||count<1||count>5)return 'Неверная очередь';
 if(queue.length+count+(b?.kind==='workbench'&&b.job?1:0)>5)return 'В очереди максимум 5 рецептов';
 if(g.player.vitals.health<=0)return 'Персонаж погиб';
 if(b&&Math.hypot(b.x-g.player.x,b.z-g.player.z)>3.2)return 'Подойдите к станции';
 if(b){const inv=structuredClone(g.player.inventory),input=structuredClone(b.input),needed:Record<string,number>={};for(const rid of [...queue,...Array(count).fill(recipeId)])for(const [item,n] of Object.entries(RECIPE_BY_ID.get(rid)!.inputs))if(item!=='water')needed[item]=(needed[item]??0)+n;for(const [item,n] of Object.entries(needed)){const missing=Math.max(0,n-countItem(input,item));if(countItem(inv,item)<missing)return 'Не хватает: '+ITEMS[item].name;if(addItems(input,item,missing))return 'Входной буфер полон';removeItems(inv,item,missing);}g.player.inventory=inv;b.input=input;}
 else if(Object.entries(r.inputs).some(([id,n])=>countItem(g.player.inventory,id)<n))return 'Нет входов для первой партии';
 queue.push(...Array(count).fill(recipeId));return '';
}
export function clearQueue(g:GameState,id='hand'){if(id==='hand')g.world.base.handQueue=[];else{const b=machine(g,id);if(b)b.queue=[];}}
/** Remove one waiting job; its preloaded stock stays in the normal input buffer. */
export function removeQueuedJob(g:GameState,id:string,index:number):string {
 const b=machine(g,id);
 if(!b||!hasQueue(b)||!Number.isInteger(index)||index<0||index>=b.queue.length)return 'Нет такой партии';
 if(!nearby(g,b)||g.player.vitals.health<=0)return 'Подойдите к станции';
 b.queue.splice(index,1);return '';
}
export function collectInput(g:GameState,id:string):number{const b=machine(g,id);if(!b||!nearby(g,b))return 0;let n=0;for(let i=0;i<b.input.length;i++){const s=b.input[i];if(s){const left=addItems(g.player.inventory,s.itemId,s.count);n+=s.count-left;s.count=left;if(!left)b.input[i]=null;}}return n;}
export function cancelJob(g: GameState, id = 'hand'): string {
 const b = id === 'hand' ? undefined : machine(g,id), job=id==='hand'?g.world.base.hand:b?.job;
 if(b&&!nearby(g,b))return 'Подойдите к станции';
 if(!job)return 'Нет работы';
 const r=RECIPE_BY_ID.get(job.recipeId)!;
 if(job.workMs>=r.seconds*1000)return 'Партия готова: освободите выход';
 for (const s of job.reserved) { const left=addItems(g.player.inventory,s.itemId,s.count);if(left)dropItems(g,g.player.x,g.player.z,[{...s,count:left}]); }
 if(b)b.water+=job.water;
 if(id==='hand')g.world.base.hand=null;else b!.job=null;return '';
}
export function collectOutput(g: GameState, id: string): number {
 const b=machine(g,id);if(!b||!nearby(g,b))return 0;let n=0;
 for(let i=0;i<b.output.length;i++){const s=b.output[i];if(!s)continue;if(s.durability!==undefined||s.milliGU!==undefined){if(insert(g.player.inventory,[s])){b.output[i]=null;n++;}}else{const left=addItems(g.player.inventory,s.itemId,s.count);n+=s.count-left;s.count=left;if(!left)b.output[i]=null;}}
 return n;
}
export function loadFuel(g: GameState, id: string): string {
 const b=machine(g,id);if(!b||b.kind!=='biogenerator')return 'Нужен биогенератор';
 if(countItem(b.input,'fiber')>=64)return 'Топливный вход полон';if(!removeItems(g.player.inventory,'fiber',1))return 'Нужны растительные волокна';addItems(b.input,'fiber',1);return '';
}
export function makeBuilding(g: GameState, kind: BuildingKind, x: number, y: number, z: number): Building {
 const b:Building={id:'build-'+g.world.base.nextId++,kind,level:1,x,y,z,input:Array(4).fill(null),output:Array(4).fill(null),job:null,queue:[],enabled:true,lowPriority:false,energy:0,fuel:0,water:0,oxygen:0,zone:{q:0,temperature:10,purity:0,lossRemainder:0,breachMs:0,shell:Array(FACES.length).fill(180)}};
 g.world.base.buildings.push(b);return b;
}
export function connect(g: GameState, kind: Link['kind'], from: string, to: string): string {
 const a=endpoint(g,from),b=endpoint(g,to);
 if(!a||!b||from===to)return 'Выберите два разных порта';
 if(g.world.base.links.length>=128)return 'Достигнут предел соединений';
 if(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)>4.001)return 'Сегмент длиннее 4 м';
 if(g.world.base.links.some(l=>l.kind===kind&&((l.from===from&&l.to===to)||(kind==='cable'&&l.to===from&&l.from===to))))return 'Соединение уже есть';
 const source=machine(g,from),target=machine(g,to);
 if(kind==='cable' && (!source||!target||!electricPort(source)||!electricPort(target)))return 'У этих корпусов нет электрического порта';
 if(kind==='gas_pipe' && (!source||source.kind!=='electrolyzer'||(to!=='capsule'&&(!target||!['refill','distributor'].includes(target.kind)))))return 'O₂: выход электролиза → вход капсулы, заправки или распределителя';
 if(!removeItems(g.player.inventory,kind,1))return 'Нужен '+ITEMS[kind].name;
 g.world.base.links.push({id:'link-'+g.world.base.nextId++,kind,from,to});return '';
}
function poweredComponent(g: GameState, id: string) {
 const seen=new Set([id]),q=[id];while(q.length){const v=q.shift()!;for(const l of g.world.base.links)if(l.kind==='cable'){const n=l.from===v?l.to:l.to===v?l.from:null;if(n&&!seen.has(n)){seen.add(n);q.push(n);}}}return seen;
}
export function beginPassage(g: GameState, id: string): string {
 const b=machine(g,id);if(!b||b.kind!=='dome')return 'Нужен купол';if(g.world.base.passage)return 'Шлюз занят';
 const inside=insideDome(b,g.player.x,g.player.y,g.player.z);
 if(!inside&&Math.hypot(g.player.x-b.x,g.player.z-(b.z+2.8))>3)return 'Подойдите к переднему шлюзу';
 const cost=Math.min(b.zone.q,4000);b.zone.q-=cost;
 g.world.base.passage={domeId:id,direction:inside?'out':'in',remainingMs:6000};
 return ''; 
}
export type ProductionTick = { changed: boolean; passage: {x:number;y:number;z:number} | null };
/** Finite sources, explicit paid links, one shared budget per component. No wall-clock catch-up. */
export function productionTick(g: GameState, ms: number, refillId: string | null = null, outside = 10): ProductionTick {
 const base=g.world.base;let changed=false;
 for(const b of base.buildings)if(hasQueue(b)&&b.enabled&&!b.job&&b.queue.length&&!startJob(g,b.queue[0],b.id,true)){b.queue.shift();changed=true;}const power=new Map<string,number>();
 // A running outside generator may charge its finite 400 EU buffer. Fiber is paid per 200 EU.
 for(const b of base.buildings)if(b.kind==='biogenerator'&&b.enabled&&!base.buildings.some(d=>insideDome(d,b.x,b.y,b.z))){
  let demand=Math.min(40*ms,400000-b.energy);
  while(demand>0){if(!b.fuel){if(!removeItems(b.input,'fiber',1))break;b.fuel=200000;}const n=Math.min(demand,b.fuel);b.fuel-=n;b.energy+=n;demand-=n;}
 }
 const seen=new Set<string>();
 for(const root of base.buildings){if(seen.has(root.id))continue;const ids=poweredComponent(g,root.id);ids.forEach(id=>seen.add(id));const group=base.buildings.filter(b=>ids.has(b.id));
  for(const e of group)if(e.kind==='electrolyzer'){
   const targets=base.links.filter(l=>l.kind==='gas_pipe'&&l.from===e.id).map(l=>l.to);let reserve=e.oxygen,capacity=480000;const rooms=new Set<string>();
   for(const id of new Set(targets)){if(id==='capsule'){reserve+=g.world.capsuleMilliGU;capacity+=2400000;}else{const b=machine(g,id)!;reserve+=b.oxygen;capacity+=480000;if(b.kind==='distributor')for(const d of base.buildings)if(insideDome(d,b.x,b.y,b.z))rooms.add(d.id);}}
   for(const id of rooms){reserve+=machine(g,id)!.zone.q;capacity+=DOME_CAPACITY;}
   if(reserve/capacity>=.8)e.lowPriority=true;else if(reserve/capacity<.5)e.lowPriority=false;
  }
  const requests=group.map(b=>{let need=0;if(b.enabled){if(b.job && b.job.workMs < RECIPE_BY_ID.get(b.job.recipeId)!.seconds*1000)need=Math.ceil(energyRate(b,RECIPE_BY_ID.get(b.job.recipeId)!)*Math.min(ms,RECIPE_BY_ID.get(b.job.recipeId)!.seconds*1000-b.job.workMs));if(b.kind==='distributor'&&base.buildings.some(d=>insideDome(d,b.x,b.y,b.z)))need=Math.round((10+Math.min(8,Math.abs(outside-20)/20))*ms);if(b.id===refillId&&b.kind==='refill'&&b.oxygen>0&&g.player.bottles.some(t=>t&&(t.milliGU??0)<TANKS[t.itemId].capacity))need=Math.ceil(Math.min(b.oxygen,20*ms,g.player.bottles.reduce((n,t)=>n+(t?TANKS[t.itemId].capacity-(t.milliGU??0):0),0))/10);}return {b,need,priority:b.kind==='electrolyzer'&&b.lowPriority?2:0};}).filter(r=>r.need>0);
  const supply=group.filter(b=>b.kind==='biogenerator'&&b.enabled),available=Math.min(120*ms,supply.reduce((n,b)=>n+Math.min(b.energy,40*ms),0));let remaining=available;
  for(const priority of [0,1,2]){const rs=requests.filter(r=>r.priority===priority),total=rs.reduce((n,r)=>n+r.need,0),accepted=Math.min(remaining,total);let allocated=0;rs.forEach((r,i)=>{const n=i===rs.length-1?accepted-allocated:Math.floor(accepted*r.need/total);power.set(r.b.id,n);allocated+=n;});remaining-=accepted;}
  let left=available-remaining;for(const b of supply){const n=Math.min(left,b.energy,40*ms);b.energy-=n;left-=n;}

 }
 if([...power.values()].some(n=>n>0))changed=recordQuestFact(g,'system:power')||changed;
 const finish=(job:Job,slots:Slot[],b?:Building)=>{const r=RECIPE_BY_ID.get(job.recipeId)!;if(job.workMs<r.seconds*1000)return false;if(r.id==='melt_in_generator'){if(b!.water>19000)return false;b!.water+=1000;}else if(r.id==='electrolysis'){if(b!.oxygen>240000)return false;b!.oxygen+=240000;}else if(!insert(slots,outputSlots(r)))return false;recordQuestFact(g,'craft:'+r.id);for(const id of Object.keys(r.outputs))if(Object.hasOwn(ITEMS,id))recordQuestFact(g,'item:'+id);if(b?.kind==='workbench'&&b.level===2&&!nearby(g,b))recordQuestFact(g,'system:auto');changed=true;return true;};
 if(base.hand){base.hand.workMs=Math.min(base.hand.workMs+ms,RECIPE_BY_ID.get(base.hand.recipeId)!.seconds*1000);if(finish(base.hand,g.player.inventory))base.hand=null;}
 const manual=base.hand?undefined:manualWork(g);
 let automaticWork=false;
 for(const b of base.buildings)if(b.job&&b.enabled){const r=RECIPE_BY_ID.get(b.job.recipeId)!,rate=energyRate(b,r);if(b.kind==='workbench'&&b.level===1&&b!==manual)continue;const before=b.job.workMs;b.job.workMs=Math.min(r.seconds*1000,b.job.workMs+(rate?(power.get(b.id)??0)/rate:ms));if(b.kind==='workbench'&&b.level===2&&b.job.workMs>before)automaticWork=true;if(finish(b.job,b.output,b))b.job=null;}
 for(const l of base.links)if(l.kind==='gas_pipe'){const a=machine(g,l.from)!,b=machine(g,l.to),cap=b?480000:2400000,stored=b?b.oxygen:g.world.capsuleMilliGU;const n=Math.min(a.oxygen,cap-stored,40*ms);a.oxygen-=n;if(b)b.oxygen+=n;else g.world.capsuleMilliGU+=n;}
 for(const b of base.buildings)if(b.kind==='dome'){
  const sealed=sealCheck(b.zone.shell).sealed,occupied=insideDome(b,g.player.x,g.player.y,g.player.z);
  const installed=base.buildings.filter(d=>d.kind==='distributor'&&insideDome(b,d.x,d.y,d.z)),distributors=installed.filter(d=>d.enabled);
  b.zone.breachMs=sealed?0:Math.min(1000,b.zone.breachMs+ms);
  let powered=0;for(const d of distributors){const ratio=(power.get(d.id)??0)/Math.round((10+Math.min(8,Math.abs(outside-20)/20))*ms);powered+=ratio;if(sealed||b.zone.breachMs<1000){const n=Math.min(d.oxygen,DOME_CAPACITY-b.zone.q,Math.round(20*ms*ratio));d.oxygen-=n;b.zone.q+=n;}}
  if(sealed){if(installed.length){b.zone.lossRemainder+=Math.round(.096*ms*1000);const loss=Math.floor(b.zone.lossRemainder/1000);b.zone.lossRemainder%=1000;b.zone.q=Math.max(0,b.zone.q-loss);}if(powered>0){b.zone.purity=Math.min(1,b.zone.purity+ms/30000*powered);const step=.0005*ms*powered;b.zone.temperature+=Math.sign(20-b.zone.temperature)*Math.min(step,Math.abs(20-b.zone.temperature));}else{if(occupied)b.zone.purity=Math.max(0,b.zone.purity-ms/360000);b.zone.temperature=outside+(b.zone.temperature-outside)*Math.exp(-ms/300000);}}
  else {b.zone.q=Math.floor(b.zone.q*Math.exp(-ms/30000));b.zone.purity*=Math.exp(-ms/15000);b.zone.temperature=outside+(b.zone.temperature-outside)*Math.exp(-ms/60000);}
 }
 const refill=refillId&&machine(g,refillId);if(refill&&Math.hypot(refill.x-g.player.x,refill.z-g.player.z)<=3.2){let budget=Math.min(refill.oxygen,(power.get(refill.id)??0)*10);for(const t of g.player.bottles)if(t){const n=Math.min(budget,TANKS[t.itemId].capacity-(t.milliGU??0));t.milliGU=(t.milliGU??0)+n;refill.oxygen-=n;budget-=n;if(n>0)changed=recordQuestFact(g,'system:refill')||changed;}}
 if(automaticWork&&g.progress.quests.facts.includes('system:auto')&&base.buildings.some(habitable))changed=recordQuestFact(g,'system:base')||changed;
 let passage:ProductionTick['passage']=null;
 if(base.passage){base.passage.remainingMs=Math.max(0,base.passage.remainingMs-ms);if(!base.passage.remainingMs){const d=machine(g,base.passage.domeId)!;passage={x:d.x,y:d.y+.12,z:d.z+(base.passage.direction==='in'?1:3.5)};base.passage=null;changed=true;}}
 return {changed,passage};
}

/** Death preserves WIP: incomplete hand inputs, or a finished output, join the cargo. */
export function releaseHandOnDeath(g:GameState) {
 const job=g.world.base.hand;g.world.base.handQueue=[];if(!job)return;const r=RECIPE_BY_ID.get(job.recipeId)!;
 if(job.workMs>=r.seconds*1000)recordQuestFact(g,'craft:'+r.id);
 dropItems(g,g.player.x,g.player.z,job.workMs>=r.seconds*1000?outputSlots(r):job.reserved);g.world.base.hand=null;g.world.base.handQueue=[];g.world.base.passage=null;
}
