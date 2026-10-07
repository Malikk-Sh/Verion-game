import { electricPort } from './production';
import { heightAt } from '../world';
import { freshBase, RECIPE_BY_ID, domeFaces, type BaseState, type Job, type Building, type Link } from './production';
import { BASIC_SUIT, BUILDABLE, CONTENT_VERSION, GENERATOR_VERSION, ITEMS, LEGACY_CONTENT_VERSIONS, SUIT_PARTS, TANKS, TOOLS, type SuitPart } from './defs';
import { emptyInventory, INVENTORY_SIZE, type Slot } from './inventory';
import { NODES, NODE_BY_ID } from './resources';
import { CYCLE_TICKS, START_OFFSET_TICKS } from './daycycle';
/**
 * Complete persistent game state. Plain JSON only: no class instances, GPU objects or
 * functions (TECHNICAL §2). Revision numbers live in save manifests.
 *
 * State version 3 adds persistent production and construction. Version 2 introduced four suit
 * parts, hotbar selection (an index into
 * the first inventory row — not a separate container), display-only vitals and the day-phase
 * offset. Version 1/2 saves (including content 1.0.0) are migrated by sanitizeState() without loss.
 */
export const STATE_VERSION = 4;
export const HOTBAR_SIZE = 6;
export type ItemStack = NonNullable<Slot>;
export type Drop = { id: string; x: number; z: number; items: ItemStack[] };
export type Suit = Record<SuitPart, Slot>;
export type Survival = { suffocationMs: number; recoveryMs: number; hungerMs: number; starvationMs: number; sinceDamageMs: number; foodCooldownMs: number; emergencyMs: number };
export const freshSurvival = (): Survival => ({ suffocationMs: 0, recoveryMs: 0, hungerMs: 0, starvationMs: 0, sinceDamageMs: 0, foodCooldownMs: 0, emergencyMs: 0 });
export type GameState = {
 meta: { worldId: string; name: string; seed: number; planetId: 'verdana'; generatorVersion: number; contentVersion: string; stateVersion: number; createdAt: number; activeTicks: number };
 player: {
  x: number; y: number; z: number; yaw: number; pitch: number;
  /** Simulated in active time; zero health is a persistent death awaiting respawn. */
  vitals: { health: number; satiety: number };
  survival: Survival;
  suit: Suit; bottles: [Slot, Slot]; inventory: Slot[];
  /** Selected cell of the first inventory row (0…5). */
  hotbar: number;
 };
 world: { base: BaseState; capsuleMilliGU: number; nodes: Record<string, number>; drops: Drop[]; nextDropId: number; dayOffsetTicks: number };
 progress: { visited: string[]; discovered: string[]; selected: string };
};
export const SPAWN_POSE = { x: 40, z: 42, yaw: .38, pitch: -.035 };
const basicSuit = (): Suit => ({ helmet: { itemId: BASIC_SUIT.helmet, count: 1 }, chest: { itemId: BASIC_SUIT.chest, count: 1 }, legs: { itemId: BASIC_SUIT.legs, count: 1 }, boots: { itemId: BASIC_SUIT.boots, count: 1 } });
export function newGame(worldId: string, seed: number, createdAt: number, y: number, name = 'Экспедиция'): GameState {
 const inventory = emptyInventory();
 inventory[0] = { itemId: 'tool_stone', count: 1, durability: TOOLS.tool_stone.durability };
 inventory[1] = { itemId: 'pulp', count: 4 };
 return {
  meta: { worldId, name, seed: seed >>> 0, planetId: 'verdana', generatorVersion: GENERATOR_VERSION, contentVersion: CONTENT_VERSION, stateVersion: STATE_VERSION, createdAt, activeTicks: 0 },
  player: { x: SPAWN_POSE.x, y, z: SPAWN_POSE.z, yaw: SPAWN_POSE.yaw, pitch: SPAWN_POSE.pitch, vitals: { health: 100, satiety: 100 }, survival: freshSurvival(), suit: basicSuit(), bottles: [{ itemId: 'bottle_1', count: 1, milliGU: TANKS.bottle_1.capacity }, null], inventory, hotbar: 0 },
  world: { base: freshBase(), capsuleMilliGU: 2400000, nodes: Object.fromEntries(NODES.map(n => [n.id, n.amount])), drops: [], nextDropId: 1, dayOffsetTicks: START_OFFSET_TICKS },
  progress: { visited: [], discovered: [], selected: 'iron' },
 };
}
export const cloneState = (s: GameState): GameState => structuredClone(s);

// ---------- Strict validation for imports and loaded pages ----------
export class InvalidState extends Error { constructor(path: string, why: string) { super(`${path}: ${why}`); this.name = 'InvalidState'; } }
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
function obj(v: unknown, p: string): Obj { if (!isObj(v)) throw new InvalidState(p, 'ожидался объект'); return v; }
function num(v: unknown, p: string, min: number, max: number) { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new InvalidState(p, `число вне ${min}…${max}`); return v; }
function int(v: unknown, p: string, min: number, max: number) { const n = num(v, p, min, max); if (!Number.isInteger(n)) throw new InvalidState(p, 'ожидалось целое'); return n; }
function str(v: unknown, p: string, max = 64, re = /^[\p{L}\p{N} _.·:\-]*$/u) { if (typeof v !== 'string' || v.length > max || !re.test(v)) throw new InvalidState(p, 'недопустимая строка'); return v; }
function arr(v: unknown, p: string, max: number) { if (!Array.isArray(v) || v.length > max) throw new InvalidState(p, `ожидался массив ≤${max}`); return v; }
const ID = /^[a-z0-9_\-]+$/;
/** One item entry. Stateful items (tools with durability, tanks with gas) always have count 1. */
function entry(v: unknown, p: string, maxCount?: number): ItemStack {
 const o = obj(v, p), itemId = str(o.itemId, p + '.itemId', 40, ID);
 if (!Object.hasOwn(ITEMS, itemId)) throw new InvalidState(p + '.itemId', `неизвестный предмет ${itemId}`);
 const def = ITEMS[itemId], tool = Object.hasOwn(TOOLS, itemId) ? TOOLS[itemId] : undefined, tank = Object.hasOwn(TANKS, itemId) ? TANKS[itemId] : undefined;
 const s: ItemStack = { itemId, count: int(o.count, p + '.count', 1, def.stack === 1 ? 1 : maxCount ?? def.stack) };
 if (o.durability !== undefined) { if (!tool) throw new InvalidState(p, 'прочность у не-инструмента'); s.durability = int(o.durability, p + '.durability', 0, tool.durability); }
 if (o.milliGU !== undefined) { if (!tank) throw new InvalidState(p, 'газ у не-баллона'); s.milliGU = int(o.milliGU, p + '.milliGU', 0, tank.capacity); }
 if (tool && s.durability === undefined) throw new InvalidState(p, 'нет прочности инструмента');
 if (tank && s.milliGU === undefined) throw new InvalidState(p, 'нет остатка газа');
 return s;
}
const slot = (v: unknown, p: string): Slot => v === null ? null : entry(v, p);
function suitSlot(v: unknown, part: SuitPart): Slot {
 const s = slot(v, `player.suit.${part}`);
 if (s && ITEMS[s.itemId].part !== part) throw new InvalidState(`player.suit.${part}`, 'предмет не подходит к этому слоту');
 return s;
}
function bottleSlot(v: unknown, p: string): Slot { const s = slot(v, p); if (s && !Object.hasOwn(TANKS, s.itemId)) throw new InvalidState(p, 'в слоте баллона не баллон'); return s; }

/**
 * v1/v2/v3 → v4 (content 1.0.0 → 1.1.0). The old single `suit: 'suit'` becomes the four basic parts;
 * inventory, tool durability and tank gas are copied untouched; new fields get start values. v3 manual queues retire with all paid stock/WIP intact.
 * Works on a copy; the original object is never modified.
 */
export function migrateRaw(raw: unknown): unknown {
 if (!isObj(raw) || !isObj(raw.meta)) return raw;
 const version = raw.meta.contentVersion;
 if (version === CONTENT_VERSION) {
  if (raw.meta.stateVersion !== 2 && raw.meta.stateVersion !== 3) return raw;
  const r = structuredClone(raw);
  const player = obj(r.player, 'player'), world = obj(r.world, 'world');
  // S1 saves created before survival was wired have no new fields; never reset an
  // already-played survival state when it is loaded again.
  if (!('survival' in player)) player.survival = freshSurvival();
  else if (isObj(player.survival) && !('starvationMs' in player.survival)) player.survival.starvationMs = 0;
  if (!('base' in world)) world.base = freshBase();
  const existingNodes = obj(world.nodes, 'world.nodes');
  for (const n of NODES) if (!(n.id in existingNodes) && ['sand-a','grass-a','grass-b'].includes(n.id)) existingNodes[n.id] = n.amount;
  if (!('capsuleMilliGU' in world)) world.capsuleMilliGU = 2400000;
  const base=validateBase(world.base,true);
  base.handQueue=[];for(const b of base.buildings)if(b.kind==='workbench')b.queue=[];
  world.base=base;
  (r.meta as Obj).stateVersion = STATE_VERSION;
  return r;
 }
 if (!(LEGACY_CONTENT_VERSIONS as readonly unknown[]).includes(version)) throw new InvalidState('meta.contentVersion', 'неподдерживаемая версия контента');
 const r = structuredClone(raw) as Obj, m = r.meta as Obj, pl = obj(r.player, 'player'), w = obj(r.world, 'world');
 if (pl.suit !== 'suit') throw new InvalidState('player.suit', 'неизвестный костюм старого формата');
 pl.suit = basicSuit();
 pl.vitals = { health: 100, satiety: 100 };
 pl.hotbar = 0; pl.survival = freshSurvival(); w.capsuleMilliGU = 2400000;
 w.dayOffsetTicks = START_OFFSET_TICKS;
 m.contentVersion = CONTENT_VERSION; m.stateVersion = STATE_VERSION;
 w.base = freshBase();
 for (const n of NODES) if (!(n.id in obj(w.nodes, 'world.nodes')) && ['sand-a','grass-a','grass-b'].includes(n.id)) (w.nodes as Obj)[n.id] = n.amount;
 return r;
}
/** Rebuilds a fresh GameState from untrusted JSON (migrating older versions); unknown keys are dropped, bad values throw. */
export function sanitizeState(input: unknown): GameState {
 const r = obj(migrateRaw(input), 'state'), m = obj(r.meta, 'meta'), pl = obj(r.player, 'player'), w = obj(r.world, 'world'), pr = obj(r.progress, 'progress');
 if (m.planetId !== 'verdana') throw new InvalidState('meta.planetId', 'неизвестная планета');
 if (m.generatorVersion !== GENERATOR_VERSION) throw new InvalidState('meta.generatorVersion', 'неподдерживаемая версия генератора');
 if (m.contentVersion !== CONTENT_VERSION) throw new InvalidState('meta.contentVersion', 'неподдерживаемая версия контента');
 if (m.stateVersion !== STATE_VERSION) throw new InvalidState('meta.stateVersion', 'неподдерживаемая версия состояния');
 const inv = arr(pl.inventory, 'player.inventory', INVENTORY_SIZE);
 if (inv.length !== INVENTORY_SIZE) throw new InvalidState('player.inventory', `нужно ${INVENTORY_SIZE} слотов`);
 const bottles = arr(pl.bottles, 'player.bottles', 2);
 if (bottles.length !== 2) throw new InvalidState('player.bottles', 'нужно 2 слота');
 const suitRaw = obj(pl.suit, 'player.suit'), vit = obj(pl.vitals, 'player.vitals');
 const sv = obj(pl.survival, 'player.survival');
 const survival = Object.fromEntries(Object.keys(freshSurvival()).map(k => [k, int(sv[k], 'player.survival.' + k, 0, 86400000)])) as Survival;
 const nodesRaw = obj(w.nodes, 'world.nodes'), nodes: Record<string, number> = {};
 for (const n of NODES) nodes[n.id] = int(nodesRaw[n.id], `world.nodes.${n.id}`, 0, n.amount);
 for (const k of Object.keys(nodesRaw)) if (!NODE_BY_ID.has(k)) throw new InvalidState('world.nodes', `неизвестный узел ${k}`);
 const dropIds = new Set<string>();
 const drops = arr(w.drops, 'world.drops', 4096).map((d, i) => { const o = obj(d, `world.drops[${i}]`), id = str(o.id, `world.drops[${i}].id`, 24, ID); if (dropIds.has(id)) throw new InvalidState('world.drops', 'повтор id'); dropIds.add(id);
  return { id, x: num(o.x, 'drop.x', -200, 360), z: num(o.z, 'drop.z', -200, 360), items: arr(o.items, 'drop.items', 64).map((s, j) => entry(s, `world.drops[${i}].items[${j}]`, 1e6)) }; });
 const nextDropId = int(w.nextDropId, 'world.nextDropId', 1, Number.MAX_SAFE_INTEGER);
 for (const d of drops) {
  const generatedId = /^drop-(\d+)$/.exec(d.id);
  if (generatedId && Number(generatedId[1]) >= nextDropId) throw new InvalidState('world.nextDropId', 'счётчик должен быть больше всех существующих идентификаторов куч');
 }
 const ids = (v: unknown, p: string) => arr(v, p, 64).map((x, i) => str(x, `${p}[${i}]`, 32, ID));
 return {
  meta: { worldId: str(m.worldId, 'meta.worldId', 48, ID), name: str(m.name, 'meta.name', 48), seed: int(m.seed, 'meta.seed', 0, 0xffffffff), planetId: 'verdana', generatorVersion: GENERATOR_VERSION, contentVersion: CONTENT_VERSION, stateVersion: STATE_VERSION, createdAt: int(m.createdAt, 'meta.createdAt', 0, 8.64e15), activeTicks: int(m.activeTicks, 'meta.activeTicks', 0, Number.MAX_SAFE_INTEGER) },
  player: { x: num(pl.x, 'player.x', -200, 360), y: num(pl.y, 'player.y', -100, 200), z: num(pl.z, 'player.z', -200, 360), yaw: num(pl.yaw, 'player.yaw', -1e6, 1e6), pitch: num(pl.pitch, 'player.pitch', -2, 2),
   vitals: { health: num(vit.health, 'player.vitals.health', 0, 100), satiety: num(vit.satiety, 'player.vitals.satiety', 0, 100) },
   survival, suit: Object.fromEntries(SUIT_PARTS.map(p => [p, suitSlot(suitRaw[p], p)])) as Suit,
   bottles: [bottleSlot(bottles[0], 'player.bottles[0]'), bottleSlot(bottles[1], 'player.bottles[1]')], inventory: inv.map((s, i) => slot(s, `player.inventory[${i}]`)),
   hotbar: int(pl.hotbar, 'player.hotbar', 0, HOTBAR_SIZE - 1) },
  world: { base: validateBase(w.base), capsuleMilliGU: int(w.capsuleMilliGU, 'world.capsuleMilliGU', 0, 2400000), nodes, drops, nextDropId, dayOffsetTicks: int(w.dayOffsetTicks, 'world.dayOffsetTicks', 0, CYCLE_TICKS - 1) },
  progress: { visited: ids(pr.visited, 'progress.visited'), discovered: ids(pr.discovered, 'progress.discovered'), selected: str(pr.selected, 'progress.selected', 32, ID) },
 };
}

/** Production imports are validated as strictly as the player containers. */
function validateBase(value: unknown, legacy = false): BaseState {
 const raw=obj(value,'world.base'), seen=new Set<string>(), generationIds:number[]=[];
 const register=(v:unknown,p:string,prefix:string)=>{const id=str(v,p,32,ID);if(!new RegExp('^'+prefix+'-[1-9][0-9]*$').test(id)||seen.has(id))throw new InvalidState(p,'неверный или повторный ID');seen.add(id);generationIds.push(Number(id.split('-')[1]));return id;};
 const container=(v:unknown,p:string)=>{const a=arr(v,p,4);if(a.length!==4)throw new InvalidState(p,'нужно 4 слота');return a.map((s,i)=>slot(s,p+'.'+i));};
 const job=(v:unknown,station:string):Job|null=>{
  if(v===null)return null;const o=obj(v,'job'),id=str(o.recipeId,'job.recipeId',40,ID),r=RECIPE_BY_ID.get(id);
  if(!r||r.station!==station)throw new InvalidState('job.recipeId','неподходящий рецепт');
  const reserved=arr(o.reserved,'job.reserved',8).map((s,i)=>entry(s,'job.reserved.'+i)),expected=Object.entries(r.inputs).filter(([id])=>id!=='water');
  if(reserved.length!==expected.length||reserved.some(s=>s.durability!==undefined||s.milliGU!==undefined)||expected.some(([id,n])=>reserved.filter(s=>s.itemId===id&&s.count===n).length!==1))throw new InvalidState('job.reserved','входы не совпадают с рецептом');
  const water=int(o.water,'job.water',0,1000);if(water!==(r.inputs.water??0)*1000)throw new InvalidState('job.water','неверный резерв воды');
  return {recipeId:id,workMs:num(o.workMs,'job.workMs',0,r.seconds*1000),reserved,water};
 };
 const queue=(v:unknown,station:string)=>arr(v,'queue',5).map(v=>{const id=str(v,'queue.recipe',40,ID);if(RECIPE_BY_ID.get(id)?.station!==station)throw new InvalidState('queue.recipe','неподходящий рецепт');return id;});
 const buildings=arr(raw.buildings,'base.buildings',64).map((v):Building=>{const o=obj(v,'building'),kind=str(o.kind,'building.kind',32,ID);if(!(BUILDABLE as readonly string[]).includes(kind))throw new InvalidState('building.kind','неизвестный корпус');const z=obj(o.zone,'building.zone');
  if(typeof o.lowPriority!=='boolean')throw new InvalidState('building.lowPriority','ожидался boolean');
  if(typeof o.enabled!=='boolean')throw new InvalidState('building.enabled','ожидался boolean');
  const shell=arr(z.shell,'zone.shell',domeFaces().length);if(shell.length!==domeFaces().length)throw new InvalidState('zone.shell','неполная оболочка');
  const input=container(o.input,'building.input'),output=container(o.output,'building.output');
  if(kind==='biogenerator'&&input.some(s=>s&&s.itemId!=='fiber'))throw new InvalidState('building.input','генератор принимает только волокна');
  const level=legacy?1:int(o.level,'building.level',1,2) as 1|2;
  if(level===2&&kind!=='workbench')throw new InvalidState('building.level','нет такого улучшения');
  const b:Building={level,id:register(o.id,'building.id','build'),kind:kind as Building['kind'],x:int(o.x,'building.x',-195,355),y:num(o.y,'building.y',-100,200),z:int(o.z,'building.z',-195,355),input,output,job:job(o.job,kind),queue:queue(o.queue,kind),enabled:o.enabled,lowPriority:o.lowPriority,energy:int(o.energy,'building.energy',0,400000),fuel:int(o.fuel,'building.fuel',0,200000),water:int(o.water,'building.water',0,20000),oxygen:int(o.oxygen,'building.oxygen',0,480000),zone:{q:int(z.q,'zone.q',0,960000),temperature:num(z.temperature,'zone.temperature',-150,150),purity:num(z.purity,'zone.purity',0,1),lossRemainder:int(z.lossRemainder,'zone.lossRemainder',0,999),breachMs:int(z.breachMs,'zone.breachMs',0,1000),shell:shell.map(v=>int(v,'zone.shell.HP',0,180))}};
  if(!legacy&&kind==='workbench'&&(level===1?b.queue.length>0:b.queue.length+(b.job?1:0)>5))throw new InvalidState('building.queue','очередь недоступна/переполнена');
  if(kind!=='biogenerator'&&(b.energy||b.fuel))throw new InvalidState('building','энергия/топливо не у генератора');if(kind!=='electrolyzer'&&b.water)throw new InvalidState('building.water','вода не у электролиза');if(!['electrolyzer','refill','distributor'].includes(kind)&&b.oxygen)throw new InvalidState('building.oxygen','нет газового буфера');if(kind!=='dome'&&b.zone.q)throw new InvalidState('zone.q','газ не у купола');return b;
 });
 const links=arr(raw.links,'base.links',128).map(v=>{const o=obj(v,'link'),kind=o.kind;if(kind!=='cable'&&kind!=='gas_pipe')throw new InvalidState('link.kind','неизвестная сеть');const from=str(o.from,'link.from',32,ID),to=str(o.to,'link.to',32,ID),a=buildings.find(b=>b.id===from),b=to==='capsule'?{x:40,y:heightAt(40,40)+.14,z:40,kind:'capsule'}:buildings.find(b=>b.id===to);
  if(!a||!b||from===to||Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)>4.001)throw new InvalidState('link','неверные порты/длина');
  if(kind==='gas_pipe'&&(a.kind!=='electrolyzer'||!['capsule','refill','distributor'].includes(b.kind)))throw new InvalidState('link','неверное направление O₂');
  if(kind==='cable'&&(!electricPort(a)||!electricPort(b)))throw new InvalidState('link','нет электрического порта');
  return {id:register(o.id,'link.id','link'),kind:kind as Link['kind'],from,to};
 });
 const pairs=new Set<string>();for(const l of links){const k=l.kind+':'+(l.kind==='cable'?[l.from,l.to].sort():[l.from,l.to]).join(':');if(pairs.has(k))throw new InvalidState('links','повтор сегмента');pairs.add(k);}
 const nextId=int(raw.nextId,'base.nextId',1,Number.MAX_SAFE_INTEGER);if(generationIds.some(n=>n>=nextId))throw new InvalidState('base.nextId','счётчик не больше существующих ID');
 let passage:BaseState['passage']=null;if(raw.passage!==null){const o=obj(raw.passage,'base.passage'),domeId=str(o.domeId,'passage.domeId',32,ID);if(!buildings.some(b=>b.id===domeId&&b.kind==='dome')||(o.direction!=='in'&&o.direction!=='out'))throw new InvalidState('passage','неверный шлюз');passage={domeId,direction:o.direction,remainingMs:int(o.remainingMs,'passage.remainingMs',0,6000)};}
 const handQueue=queue(raw.handQueue,'hand');if(!legacy&&handQueue.length)throw new InvalidState('handQueue','ручная очередь недоступна');
 return {buildings,links,nextId,hand:job(raw.hand,'hand'),handQueue,passage};
}
