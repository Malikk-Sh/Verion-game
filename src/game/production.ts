import { heightAt } from '../world';
import catalog from './catalog.generated.json';
import { recordQuestFact } from './questFacts';
import { BUILDABLE, ITEMS, TANKS, TOOLS, type BuildingKind } from './defs';
import { addItems, countItem, emptyInventory, firstEmpty, removeItems, type Slot } from './inventory';
import { dropItems } from './mining';
import type { GameState, ItemStack } from './state';
import { advancePassage, anyHabitable, capacityOf, distributorDemand, roomsTick, stationRoom, type Door, type Passage, type Zone } from './rooms';
export type Recipe = { id: string; station: string; inputs: Record<string, number>; outputs: Record<string, number>; seconds: number; EU_per_second: number };
export const RECIPES: Recipe[] = catalog.recipes as unknown as Recipe[];
export const RECIPE_BY_ID = new Map(RECIPES.map(r => [r.id, r]));
// Import-only recipe: finish old paid melts without giving the old operation a new UI entry.
RECIPE_BY_ID.set('legacy_melt',{id:'legacy_melt',station:'electrolyzer',inputs:{ice:1},outputs:{water:1},seconds:2,EU_per_second:6});
/** Recipes kept only for old saves: no quest teaches them; the workshop lists them only to someone holding the input. */
export const LEGACY_RECIPES = new Set(['legacy_melt', 'dismantle_dome']);
/** Oxygen of one electrolysis batch (1 WU) in milli-GU, straight from the catalog recipe (D30: 500 GU). */
export const O2_PER_WU = RECIPE_BY_ID.get('electrolysis')!.outputs.oxygen * 1000;
/** `repeat` more identical batches follow this one while inputs last (S3 batch crafting). */
export type Job = { recipeId: string; workMs: number; reserved: ItemStack[]; water: number; repeat: number };
export const MAX_REPEAT = 99;
/** `rot`: quarter turns around +y (0 = facing +z). */
export type Building = { id: string; kind: BuildingKind; level: 1 | 2; rot: number; x: number; y: number; z: number; input: Slot[]; output: Slot[]; job: Job | null; queue: string[]; enabled: boolean; lowPriority: boolean; energy: number; fuel: number; water: number; oxygen: number };
export type Link = { id: string; kind: 'cable' | 'gas_pipe'; from: string; to: string };
/** S4 (D31): `glass` — sorted unique cell keys of glass blocks; `doors` — airlocks (1×2 cells); `zones` — the air of each
 * closed room (rooms.ts); `passage` — an airlock cycle in progress. */
export type BaseState = { buildings: Building[]; links: Link[]; nextId: number; hand: Job | null; handQueue: string[]; glass: number[]; doors: Door[]; zones: Zone[]; passage: Passage | null };
export const freshBase = (): BaseState => ({ buildings: [], links: [], nextId: 1, hand: null, handQueue: [], glass: [], doors: [], zones: [], passage: null });
export const machine = (g: GameState, id: string) => g.world.base.buildings.find(b => b.id === id);
/** Buffers in milli-units (D30, S4): generator 2000 EU and 300 EU per fiber, electrolyzer 2000 GU; refill and
 * distributor ports keep 480 GU; the capsule holds 2400 GU. */
export const GEN_BUFFER = 2000000, FIBER_EU = 300000, ELECTROLYZER_O2 = 2000000, PORT_O2 = 480000, CAPSULE_CAPACITY = 2400000;
export const endpoint = (g: GameState, id: string) => id === 'capsule' ? { x: 40, y: heightAt(40,40)+.14, z: 40 } : machine(g, id);
/** A line is paid per started 4 m segment (SYSTEMS §6) and may chain up to LINK_RANGE. */
export const SEGMENT = 4, LINK_RANGE = 12;
export const linkSegments = (d: number) => Math.max(1, Math.ceil((d - .001) / SEGMENT));
export const linkLength = (g: GameState, l: { from: string; to: string }) => { const a=endpoint(g,l.from),b=endpoint(g,l.to);return a&&b?Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z):0; };
/** Gas pipes always run from an electrolyzer output into a consumer; order of selection does not matter. */
export function gasDirection(g: GameState, a: string, b: string): [string, string] { return machine(g,a)?.kind==='electrolyzer'&&machine(g,b)?.kind!=='electrolyzer'?[a,b]:machine(g,b)?.kind==='electrolyzer'?[b,a]:[a,b]; }
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
// A bench I whose batch is complete but blocked by a full output does not hold the hands (nor other benches).
export const manualWork = (g: GameState) => g.world.base.buildings.filter(b=>b.kind==='workbench'&&b.level===1&&b.job&&b.enabled&&nearby(g,b)&&b.job.workMs<(RECIPE_BY_ID.get(b.job.recipeId)?.seconds??0)*1000).sort((a,b)=>Math.hypot(a.x-g.player.x,a.z-g.player.z)-Math.hypot(b.x-g.player.x,b.z-g.player.z))[0];
export const energyRate = (b: Building, r: Recipe) => b.kind === 'workbench' && b.level === 2 ? WORKBENCH_UPGRADE.EU_per_second : r.EU_per_second;
export const electricPort = (b: {kind:string;level?:number}) => !['capsule','kiln'].includes(b.kind) && (b.kind !== 'workbench' || b.level === 2);
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
 for(const [item,n] of Object.entries(r.inputs))if(item!=='water'||b.water<n*1000){
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
 const dedicated=buffered&&b&&(b.kind==='kiln'||b.kind==='electrolyzer');
 const inv = buffered && b ? dedicated?b.input.slice(0,2):b.input : g.player.inventory;
 if(dedicated)for(const [item,n] of Object.entries(r.inputs)){
  if(item==='water'&&b!.water>=n*1000)continue;
  const s=inv[b!.kind==='kiln'&&item==='fiber'?1:0];
  if(!s||s.itemId!==item||s.count<n)return 'Не хватает: '+(ITEMS[item]?.name??'Вода');
 }
 for (const [item,n] of Object.entries(r.inputs)) if (item === 'water' && (b?.water??0)>=n*1000 ? false : countItem(inv,item)<n) return 'Не хватает: '+(ITEMS[item]?.name ?? 'Вода');
 if (r.id === 'legacy_melt' && b!.water > 19000) return 'Буфер воды полон';
 if (r.id === 'electrolysis' && b!.oxygen > ELECTROLYZER_O2 - O2_PER_WU) return 'Буфер O₂ полон';
 const reserved: ItemStack[] = [];
 for (const [item,n] of Object.entries(r.inputs)) if (item !== 'water'||(b?.water??0)<n*1000) { removeItems(inv,item,n); reserved.push({itemId:item,count:n}); } else b!.water-=n*1000;
 if(dedicated)b!.input.splice(0,2,...inv);
 const job: Job = {recipeId,workMs:0,reserved,water:reserved.some(s=>s.itemId==='water')?0:(r.inputs.water??0)*1000,repeat:0};
 if(id==='hand')g.world.base.hand=job;else b!.job=job;
 return '';
}
/** Future machine inputs live in ordinary four-slot buffers, not WIP. */
export function queueJob(g: GameState, recipeId: string, id = 'hand', count = 5): string {
 const r=RECIPE_BY_ID.get(recipeId),b=id==='hand'?undefined:machine(g,id),queue=id==='hand'?g.world.base.handQueue:b?.queue;
 if(!hasQueue(b))return 'Очередь открывается после улучшения верстака';
 if(!r||!queue||r.station!==(b?.kind??'hand')||!Number.isInteger(count)||count<1||count>5)return 'Неверная очередь';
 if(queue.length+count+(b?.job?1:0)>5)return 'В очереди максимум 5 рецептов';
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
export function makeBuilding(g: GameState, kind: BuildingKind, x: number, y: number, z: number, rot = 0): Building {
 const b:Building={id:'build-'+g.world.base.nextId++,kind,level:1,rot:((rot%4)+4)%4,x,y,z,input:Array(4).fill(null),output:Array(4).fill(null),job:null,queue:[],enabled:true,lowPriority:false,energy:0,fuel:0,water:0,oxygen:0};
 g.world.base.buildings.push(b);return b;
}
export function connect(g: GameState, kind: Link['kind'], from: string, to: string): string {
 const a=endpoint(g,from),b=endpoint(g,to);
 if(!a||!b||from===to)return 'Выберите два разных порта';
 if(g.world.base.links.length>=128)return 'Достигнут предел соединений';
 const d=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);if(d>LINK_RANGE+.001)return 'Слишком далеко: до '+LINK_RANGE+' м';
 if(g.world.base.links.some(l=>l.kind===kind&&((l.from===from&&l.to===to)||(kind==='cable'&&l.to===from&&l.from===to))))return 'Соединение уже есть';
 const source=machine(g,from),target=machine(g,to);
 if(kind==='cable' && (!source||!target||!electricPort(source)||!electricPort(target)))return 'У этих корпусов нет электрического порта';
 if(kind==='gas_pipe' && (!source||source.kind!=='electrolyzer'||(to!=='capsule'&&(!target||!['refill','distributor'].includes(target.kind)))))return 'O₂: выход электролиза → вход капсулы, заправки или распределителя';
 const cost=linkSegments(d);if(countItem(g.player.inventory,kind)<cost)return 'Нужно '+cost+' × '+ITEMS[kind].name;
 removeItems(g.player.inventory,kind,cost);
 g.world.base.links.push({id:'link-'+g.world.base.nextId++,kind,from,to});return '';
}
/** Removes one line and returns every paid segment; refused (nothing changes) without backpack room. */
export function disconnect(g: GameState, linkId: string): string {
 const l=g.world.base.links.find(v=>v.id===linkId);if(!l)return 'Нет такой линии';
 const inv=structuredClone(g.player.inventory);if(addItems(inv,l.kind,linkSegments(linkLength(g,l))))return 'Освободите место в рюкзаке';
 g.player.inventory=inv;g.world.base.links=g.world.base.links.filter(v=>v!==l);return '';
}
/** Valid new lines from a station to its neighbours within range, cheapest first. */
export function linkOptions(g: GameState, id: string) {
 const out:{kind:Link['kind'];from:string;to:string;peer:string;distance:number;cost:number}[]=[];
 const self=endpoint(g,id);if(!self)return out;
 const peers=[...g.world.base.buildings.map(b=>b.id),'capsule'].filter(p=>p!==id);
 for(const peer of peers){const p=endpoint(g,peer)!;const d=Math.hypot(p.x-self.x,p.y-self.y,p.z-self.z);if(d>LINK_RANGE+.001)continue;
  const a=id==='capsule'?null:machine(g,id),b=peer==='capsule'?null:machine(g,peer);
  if(a&&b&&electricPort(a)&&electricPort(b)&&!g.world.base.links.some(l=>l.kind==='cable'&&((l.from===id&&l.to===peer)||(l.to===id&&l.from===peer))))out.push({kind:'cable',from:id,to:peer,peer,distance:d,cost:linkSegments(d)});
  const [from,to]=gasDirection(g,id,peer),src=machine(g,from),dst=to==='capsule'?{kind:'capsule'}:machine(g,to);
  if(src?.kind==='electrolyzer'&&dst&&['capsule','refill','distributor'].includes(dst.kind)&&!g.world.base.links.some(l=>l.kind==='gas_pipe'&&l.from===from&&l.to===to))out.push({kind:'gas_pipe',from,to,peer,distance:d,cost:linkSegments(d)});
 }
 return out.sort((x,y)=>x.distance-y.distance);
}
export function poweredComponent(g: GameState, id: string) {
 const seen=new Set([id]),q=[id];while(q.length){const v=q.shift()!;for(const l of g.world.base.links)if(l.kind==='cable'){const n=l.from===v?l.to:l.to===v?l.from:null;if(n&&!seen.has(n)){seen.add(n);q.push(n);}}}return seen;
}
export type ProductionTick = { changed: boolean; passage: {x:number;y:number;z:number} | null };
/**
 * Read-only view of the last simulated tick for visuals and station screens: accepted energy per
 * building and gas moved per link/room (milli-units in `ms`). Never read by the simulation itself.
 */
export const telemetry = { ms: 50, power: new Map<string, number>(), supply: new Map<string, number>(), gas: new Map<string, number>(), room: new Map<string, number>() };
export const powerRate = (id: string) => (telemetry.power.get(id) ?? 0) / telemetry.ms;
export const supplyRate = (id: string) => (telemetry.supply.get(id) ?? 0) / telemetry.ms;
export const gasRate = (id: string) => (telemetry.gas.get(id) ?? 0) / telemetry.ms;
export const roomRate = (id: string) => (telemetry.room.get(id) ?? 0) / telemetry.ms;
/** Finite sources, explicit paid links, one shared budget per component. No wall-clock catch-up. */
/** Power delivery limited per cable, not per network (SYSTEMS: a segment carries 120 EU/s). A max-flow from the
 * generators (each up to 40 EU/s of its buffer) through the cable graph is filled class by class (0 → 1 → 2) on the
 * residual graph, so a lower class never takes what a higher one can still receive. Returns what each consumer
 * receives and what each generator gives, in milli-EU for this tick. */
/** Unit fractions each consumer is still owed (+) or got ahead (−) from earlier shared deficits, per base. Whole-unit
 *  shares then stay proportional over time, also across full ticks in between; nothing is saved (a reload restarts
 *  from zero, off by less than a unit per consumer). */
const powerDebt = new WeakMap<object, Map<string, number>>();
export function deliverPower(g: GameState, group: Building[], supply: Building[], requests: { b: Building; need: number; priority: number }[], ms: number) {
 const at = new Map(group.map((b, i) => [b.id, i + 2])), n = group.length + 2, cap = Array.from({ length: n }, () => new Array<number>(n).fill(0));
 for (const l of g.world.base.links) if (l.kind === 'cable') { const a = at.get(l.from), b = at.get(l.to); if (a !== undefined && b !== undefined) { cap[a][b] += 120 * ms; cap[b][a] += 120 * ms; } }
 const offered = new Map(supply.map(b => [b.id, Math.min(b.energy, 40 * ms)])), debt = powerDebt.get(g.world.base) ?? new Map<string, number>();
 powerDebt.set(g.world.base, debt);
 for (const [id, v] of offered) cap[0][at.get(id)!] += v;
 const maxflow = (c: number[][]) => {
  let total = 0;
  for (;;) {
   const prev = new Array<number>(n).fill(-1), queue = [0]; prev[0] = 0;
   while (queue.length && prev[1] < 0) { const u = queue.shift()!; for (let v = 1; v < n; v++) if (prev[v] < 0 && c[u][v] > 0) { prev[v] = u; queue.push(v); } }
   if (prev[1] < 0) return total;
   let push = Infinity; for (let v = 1; v !== 0; v = prev[v]) push = Math.min(push, c[prev[v]][v]);
   for (let v = 1; v !== 0; v = prev[v]) { c[prev[v]][v] -= push; c[v][prev[v]] += push; }
   total += push;
  }
 };
 for (const p of [0, 1, 2]) {
  const cls = requests.filter(r => r.priority === p && r.need > 0), want = cls.reduce((s, r) => s + r.need, 0), sinks = cls.map(r => at.get(r.b.id)!);
  if (!want) continue;
  const route = (targets: number[]) => { const c = cap.map(row => row.slice()); sinks.forEach((v, i) => { c[v][1] += targets[i]; }); return { c, flow: maxflow(c), targets }; };
  let best = route(cls.map(r => r.need));
  if (best.flow < want) {
   // A deficit inside one class is shared in proportion to the requests (SYSTEMS): every consumer slows down
   // instead of the first ones found taking it all. Whole units (gas amounts stay integer) by largest remainder,
   // with each consumer's carried fraction, so the split stays proportional over many ticks.
   const share = (k: number) => {
    const raw = cls.map(r => Math.min(r.need, Math.max(0, r.need * k / want + (debt.get(r.b.id) ?? 0)))), t = raw.map(Math.floor);
    let rest = k - t.reduce((s, v) => s + v, 0); const order = raw.map((_, i) => i).sort((a, b) => (raw[b] - t[b]) - (raw[a] - t[a]));
    while (rest > 0 && order.some(i => t[i] < cls[i].need)) for (const i of order) if (rest > 0 && t[i] < cls[i].need) { t[i]++; rest--; }
    while (rest < 0 && order.some(i => t[i] > 0)) for (const i of [...order].reverse()) if (rest < 0 && t[i] > 0) { t[i]--; rest++; }
    return t; };
   let fair = route(share(best.flow));
   if (fair.flow < best.flow) { // a cable bottleneck: the largest fair share that the cables can carry
    let lo = 0, hi = best.flow - 1; fair = route(share(0));
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2), tried = route(share(mid)); if (tried.flow === mid) { lo = mid; fair = tried; } else hi = mid - 1; }
    sinks.forEach((v, i) => { fair.c[v][1] += cls[i].need - fair.targets[i]; }); maxflow(fair.c); // what only some consumers can reach still goes to them
   }
   best = fair;
   const given = sinks.map(v => best.c[1][v]), total = given.reduce((s, v) => s + v, 0);
   cls.forEach((r, i) => debt.set(r.b.id, Math.max(-1, Math.min(1, r.need * total / want + (debt.get(r.b.id) ?? 0) - given[i]))));
  } // a full tick serves the requests without touching the carried fractions: only a later shared deficit settles them
  for (let i = 0; i < n; i++) cap[i] = best.c[i];
  for (const v of sinks) cap[v][1] = 0; // this class is served; its unmet need is not offered to the next one
 }
 const delivered = new Map(requests.map(r => [r.b.id, cap[1][at.get(r.b.id)!]])), drawn = new Map([...offered].map(([id, v]) => [id, v - cap[0][at.get(id)!]]));
 return { delivered, drawn };
}
export function productionTick(g: GameState, ms: number, refillId: string | null = null, outside = 10): ProductionTick {
 const base=g.world.base;let changed=false;
 telemetry.ms=Math.max(1,ms);telemetry.power.clear();telemetry.supply.clear();telemetry.gas.clear();telemetry.room.clear();

 const bottleNeed=(b:Building)=>b.kind==='electrolyzer'&&b.enabled&&b.input[1]&&TANKS[b.input[1].itemId]?Math.min(b.oxygen,20*ms,TANKS[b.input[1].itemId].capacity-(b.input[1].milliGU??0))/10:0;
 for(const b of base.buildings)if(hasQueue(b)&&b.enabled&&!b.job&&b.queue.length&&!startJob(g,b.queue[0],b.id,true)){b.queue.shift();changed=true;}const power=new Map<string,number>();
 for(const b of base.buildings)if(b.enabled&&!b.job){const r=b.kind==='kiln'?RECIPES.find(r=>r.station==='kiln'&&Object.entries(r.inputs).every(([id,n])=>{const s=b.input[id==='fiber'?1:0];return s?.itemId===id&&s.count>=n;})):b.kind==='electrolyzer'?RECIPE_BY_ID.get('electrolysis'):undefined;if(r&&!startJob(g,r.id,b.id,true))changed=true;}
 // A running outside generator may charge its finite GEN_BUFFER (2000 EU). Fiber is paid per FIBER_EU (300 EU).
 for(const b of base.buildings)if(b.kind==='biogenerator'&&b.enabled&&!stationRoom(g,b)){
  let demand=Math.min(40*ms,GEN_BUFFER-b.energy);
  while(demand>0){if(!b.fuel){if(!removeItems(b.input,'fiber',1))break;b.fuel=FIBER_EU;}const n=Math.min(demand,b.fuel);b.fuel-=n;b.energy+=n;demand-=n;}
 }
 const tankDemand=new Map(base.buildings.map(b=>[b.id,Math.ceil(bottleNeed(b))]));
 const seen=new Set<string>();
 for(const root of base.buildings){if(seen.has(root.id))continue;const ids=poweredComponent(g,root.id);ids.forEach(id=>seen.add(id));const group=base.buildings.filter(b=>ids.has(b.id));
  for(const e of group)if(e.kind==='electrolyzer'){
   const targets=base.links.filter(l=>l.kind==='gas_pipe'&&l.from===e.id).map(l=>l.to);let reserve=e.oxygen,capacity=ELECTROLYZER_O2;const rooms=new Map<number,{q:number;cap:number}>();
   for(const id of new Set(targets)){if(id==='capsule'){reserve+=g.world.capsuleMilliGU;capacity+=CAPSULE_CAPACITY;}else{const b=machine(g,id)!;reserve+=b.oxygen;capacity+=PORT_O2;const r=b.kind==='distributor'?stationRoom(g,b):null;if(r)rooms.set(r.cell,{q:r.zone.q,cap:capacityOf(r.volume)});}}
   for(const r of rooms.values()){reserve+=r.q;capacity+=r.cap;}
   if(reserve/capacity>=.8)e.lowPriority=true;else if(reserve/capacity<.5)e.lowPriority=false;
  }
  const requests=group.map(b=>{let need=0;if(b.enabled){if(b.job && b.job.workMs < RECIPE_BY_ID.get(b.job.recipeId)!.seconds*1000)need=Math.ceil(energyRate(b,RECIPE_BY_ID.get(b.job.recipeId)!)*Math.min(ms,RECIPE_BY_ID.get(b.job.recipeId)!.seconds*1000-b.job.workMs));if(b.kind==='distributor'&&stationRoom(g,b))need=distributorDemand(ms,outside);if(b.id===refillId&&b.kind==='refill'&&b.oxygen>0&&g.player.bottles.some(t=>t&&(t.milliGU??0)<TANKS[t.itemId].capacity))need=Math.ceil(Math.min(b.oxygen,20*ms,g.player.bottles.reduce((n,t)=>n+(t?TANKS[t.itemId].capacity-(t.milliGU??0):0),0))/10);}need+=(tankDemand.get(b.id)??0);return {b,need,priority:b.kind==='workbench'?2:b.kind==='refill'?1:b.kind==='electrolyzer'&&b.lowPriority?2:0};}).filter(r=>r.need>0);
  const supply=group.filter(b=>b.kind==='biogenerator'&&b.enabled),{delivered,drawn}=deliverPower(g,group,supply,requests,ms);
  for(const r of requests)power.set(r.b.id,delivered.get(r.b.id)??0);
  for(const b of supply){const n=drawn.get(b.id)??0;b.energy-=n;if(n>0)telemetry.supply.set(b.id,n);}

 }
 for(const [id,n] of power)if(n>0)telemetry.power.set(id,n);
 if([...power.values()].some(n=>n>0))changed=recordQuestFact(g,'system:power')||changed;
 const finish=(job:Job,slots:Slot[],b?:Building)=>{const r=RECIPE_BY_ID.get(job.recipeId)!;if(job.workMs<r.seconds*1000)return false;if(r.id==='legacy_melt'){if(b!.water>19000)return false;b!.water+=1000;}else if(r.id==='electrolysis'){if(b!.oxygen>ELECTROLYZER_O2-O2_PER_WU)return false;b!.oxygen+=O2_PER_WU;}else if(b?.kind==='kiln'){const output=[b.output[0]];if(!insert(output,outputSlots(r)))return false;b.output[0]=output[0];}else if(!insert(slots,outputSlots(r)))return false;recordQuestFact(g,'craft:'+(r.id==='legacy_melt'?'melt_in_generator':r.id));for(const id of Object.keys(r.outputs))if(Object.hasOwn(ITEMS,id))recordQuestFact(g,'item:'+id);if(b?.kind==='workbench'&&b.level===2&&!nearby(g,b)){recordQuestFact(g,'system:auto');if(anyHabitable(g))recordQuestFact(g,'system:base');}changed=true;return true;};
 if(base.hand){base.hand.workMs=Math.min(base.hand.workMs+ms,RECIPE_BY_ID.get(base.hand.recipeId)!.seconds*1000);if(finish(base.hand,g.player.inventory)){const {repeat,recipeId}=base.hand;base.hand=null;if(repeat>0&&!startJob(g,recipeId,'hand'))base.hand!.repeat=repeat-1;}}
 const manual=base.hand?undefined:manualWork(g);
 for(const b of base.buildings)if(b.job&&b.enabled){const r=RECIPE_BY_ID.get(b.job.recipeId)!,rate=energyRate(b,r);if(b.kind==='workbench'&&b.level===1&&b!==manual&&b.job.workMs<r.seconds*1000)continue;b.job.workMs=Math.min(r.seconds*1000,b.job.workMs+(rate?Math.max(0,(power.get(b.id)??0)-(tankDemand.get(b.id)??0))/rate:ms));if(finish(b.job,b.output,b)){const {repeat,recipeId}=b.job;b.job=null;if(repeat>0&&b.kind==='workbench'){if(nearby(g,b))loadRecipeInputs(g,recipeId,b.id);if(!startJob(g,recipeId,b.id,true))b.job!.repeat=repeat-1;}}}
 for(const b of base.buildings){const t=b.input[1],need=(tankDemand.get(b.id)??0);if(need>0&&t){const n=Math.min(need*10,(power.get(b.id)??0)*10,b.oxygen,TANKS[t.itemId].capacity-(t.milliGU??0));b.oxygen-=n;t.milliGU=(t.milliGU??0)+n;if(n>0){changed=recordQuestFact(g,'system:refill')||changed;}}}
 for(const l of base.links)if(l.kind==='gas_pipe'){const a=machine(g,l.from)!,b=machine(g,l.to),cap=b?PORT_O2:CAPSULE_CAPACITY,stored=b?b.oxygen:g.world.capsuleMilliGU;const mounted=a.input[1],reserved=mounted&&TANKS[mounted.itemId]?TANKS[mounted.itemId].capacity-(mounted.milliGU??0):0;const n=Math.min(Math.max(0,a.oxygen-reserved),cap-stored,40*ms);a.oxygen-=n;if(b)b.oxygen+=n;else g.world.capsuleMilliGU+=n;if(n>0)telemetry.gas.set(l.id,n);}
 roomsTick(g,ms,power,outside,(r,d,n)=>{const key='room-'+r.cell;telemetry.room.set(key,(telemetry.room.get(key)??0)+n);telemetry.gas.set(d.id,(telemetry.gas.get(d.id)??0)+n);});
 const refill=refillId&&machine(g,refillId);if(refill&&Math.hypot(refill.x-g.player.x,refill.z-g.player.z)<=3.2){let budget=Math.min(refill.oxygen,(power.get(refill.id)??0)*10);for(const t of g.player.bottles)if(t){const n=Math.min(budget,TANKS[t.itemId].capacity-(t.milliGU??0));t.milliGU=(t.milliGU??0)+n;refill.oxygen-=n;budget-=n;if(n>0)changed=recordQuestFact(g,'system:refill')||changed;}}
 const passage=advancePassage(g,ms);if(passage)changed=true;
 return {changed,passage};
}

/** Death preserves WIP: incomplete hand inputs, or a finished output, join the cargo. */
export function releaseHandOnDeath(g:GameState) {
 const job=g.world.base.hand;g.world.base.handQueue=[];if(!job)return;const r=RECIPE_BY_ID.get(job.recipeId)!;
 if(job.workMs>=r.seconds*1000)recordQuestFact(g,'craft:'+(r.id==='legacy_melt'?'melt_in_generator':r.id));
 dropItems(g,g.player.x,g.player.z,job.workMs>=r.seconds*1000?outputSlots(r):job.reserved);g.world.base.hand=null;g.world.base.handQueue=[];g.world.base.passage=null;
}
