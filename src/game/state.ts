import { electricPort, runsOn } from './production';
import { heightAt, stationY, worldColliders, type Box } from '../world';
import { freshBase, RECIPE_BY_ID, LINK_RANGE, MAX_REPEAT, GEN_BUFFER, FIBER_EU, ELECTROLYZER_O2, PORT_O2, CAPSULE_CAPACITY, type BaseState, type Job, type Building, type Link } from './production';
import { BASIC_SUIT, BUILDABLE, CONTENT_VERSION, GENERATOR_VERSION, ITEMS, LEGACY_CONTENT_VERSIONS, SUIT_PARTS, TANKS, TOOLS, type SuitPart } from './defs';
import { addItems, emptyInventory, INVENTORY_SIZE, type Slot } from './inventory';
import { NODES, NODE_BY_ID, LATER_NODES, S3_NODES, nodeCovered, bodyHalf, VEIN_MATERIALS, VEIN_SPOT_BY_ID, veinSizeRange, type Vein, type Respawn, type VeinMaterial } from './resources';
import { covers, veinDelay, VEIN_CAP, VEIN_TOTAL, RESPAWN_MAX, VEIN_DELAY_RANGE } from './nature';
import { CYCLE_TICKS, START_OFFSET_TICKS, isDay, phaseSeconds } from './daycycle';
import { freshQuestProgress, QUEST_FACTS, type QuestProgress } from './questFacts';
import { QUEST_IDS, type QuestId } from './questCatalog';
import { bodyInSolid, carry, groundKey, moduleBox, overlaps, playerBox, groundV8, levelAt, doorFits, landingCells, stationBox, cellKey, cellOf, capacityOf, deriveRooms, doorAlong, doorCenter, doorFront, doorKeys, groundRoom, landingAt, newDoor, lowestAir, storable, STORE_MARGIN, shellOf, CELL_MAX, CELL_MIN, DOOR_LIMIT, GLASS_LIMIT, LEVEL_MAX, LEVEL_MIN, ROOM_LIMIT, ROOM_MAX, type Door, type DoorState, type Zone } from './rooms';
import { CHAMBER_Q, EQUALIZE_MS, SLIDE_MS } from './airlock';
/**
 * Complete persistent game state. Plain JSON only: no class instances, GPU objects or
 * functions (TECHNICAL §2). Revision numbers live in save manifests.
 *
 * State version 10 (S5.1): an airlock module is two cells deep, its chamber standing one cell out of the wall towards its
 * front; S5 modules get the second row where it fits by the rules of a new one, else stay one deep (toDeepModules).
 * State version 9 (S5) has two field-based steps:
 * - D35 raises the vertical cell lattice by 0.5 m (level k spans y ∈ [k + 0.5, k + 1.5)) so blocks rest flush on the
 *   build pad; keys stay, rooms are re-derived and their air carried over (toShiftedLevels);
 * - D36 turns every door into a walk-through airlock module with its own doors and chamber; the S4 passage retires (toModules).
 * State version 8 (S4) has two parts, each added by a field-based step so that every S4 preview file loads:
 * - glass rooms (D31) replace the prefab dome: `base.glass`, `base.doors`, `base.zones` and a passage through a door;
 *   buildings lose their per-body zone/shell (toGlassRooms);
 * - new veins (D33): `world.veins`, the `world.respawn` queue and `world.nextVeinId` (toVeins).
 * Version 7 (S3) adds regrowing grass, new deposits, building rotation, repeated crafting
 * and longer multi-segment links. Version 6 adds crates, packed bodies and portable water; paid legacy jobs survive.
 * State version 5 adds bounded quest facts and milestones. Version 4 adds workstation levels.
 * State version 3 adds persistent production and construction. Version 2 introduced four suit
 * parts, hotbar selection (an index into
 * the first inventory row — not a separate container), display-only vitals and the day-phase
 * offset. Version 1/2 saves (including content 1.0.0) are migrated by sanitizeState() without loss.
 */
export const STATE_VERSION = 10;
/** Last version produced by the pre-S3 migration chain, the S3 version and the S4 version (integer levels). */
const V6 = 6, V7 = 7, V8 = 8;
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
 world: { crates: Record<string,Slot[]>; base: BaseState; capsuleMilliGU: number; nodes: Record<string, number>; /** Active-time accumulators (ms) of regrowing deposits. */ regrow: Record<string, number>; drops: Drop[]; nextDropId: number; dayOffsetTicks: number;
  /** S4 (D33): live new veins, the queue of veins still to appear (active ms) and the next vein number. */ veins: Vein[]; respawn: Respawn[]; nextVeinId: number };
 progress: { visited: string[]; discovered: string[]; selected: string; quests: QuestProgress; /** S4 map mark («Метка», D34); optional: older pages drop it, sanitize defaults it to null. */ waypoint?: { x: number; z: number } | null;
  /** S5 (D37): the scanner was handed out (new worlds start with it; older saves get it once, scanner.ts). Optional: absent = not yet. */ scanner?: boolean };
};
export const SPAWN_POSE = { x: 40, z: 42, yaw: .38, pitch: -.035 };
const basicSuit = (): Suit => ({ helmet: { itemId: BASIC_SUIT.helmet, count: 1 }, chest: { itemId: BASIC_SUIT.chest, count: 1 }, legs: { itemId: BASIC_SUIT.legs, count: 1 }, boots: { itemId: BASIC_SUIT.boots, count: 1 } });
export function newGame(worldId: string, seed: number, createdAt: number, y: number, name = 'Экспедиция'): GameState {
 const inventory = emptyInventory();
 inventory[0] = { itemId: 'tool_stone', count: 1, durability: TOOLS.tool_stone.durability };
 inventory[1] = { itemId: 'pulp', count: 4 };
 inventory[2] = { itemId: 'scanner', count: 1 };
 return {
  meta: { worldId, name, seed: seed >>> 0, planetId: 'verdana', generatorVersion: GENERATOR_VERSION, contentVersion: CONTENT_VERSION, stateVersion: STATE_VERSION, createdAt, activeTicks: 0 },
  player: { x: SPAWN_POSE.x, y, z: SPAWN_POSE.z, yaw: SPAWN_POSE.yaw, pitch: SPAWN_POSE.pitch, vitals: { health: 100, satiety: 100 }, survival: freshSurvival(), suit: basicSuit(), bottles: [{ itemId: 'bottle_1', count: 1, milliGU: TANKS.bottle_1.capacity }, null], inventory, hotbar: 0 },
  world: { crates: {'crate-a':emptyInventory(),'crate-b':emptyInventory()}, base: freshBase(), capsuleMilliGU: CAPSULE_CAPACITY, nodes: Object.fromEntries(NODES.map(n => [n.id, n.amount])), regrow: {}, drops: [], nextDropId: 1, dayOffsetTicks: START_OFFSET_TICKS, veins: [], respawn: [], nextVeinId: 1 },
  progress: { visited: [], discovered: [], selected: 'guide', quests: freshQuestProgress(), waypoint: null, scanner: true },
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
function entry(v: unknown, p: string, maxCount?: number,allowPacked=true): ItemStack {
 const o = obj(v, p), itemId = str(o.itemId, p + '.itemId', 40, ID);
 if (!Object.hasOwn(ITEMS, itemId)) throw new InvalidState(p + '.itemId', `неизвестный предмет ${itemId}`);
 const def = ITEMS[itemId], tool = Object.hasOwn(TOOLS, itemId) ? TOOLS[itemId] : undefined, tank = Object.hasOwn(TANKS, itemId) ? TANKS[itemId] : undefined;
 const s: ItemStack = { itemId, count: int(o.count, p + '.count', 1, def.stack === 1 ? 1 : maxCount ?? def.stack) };
 if (o.durability !== undefined) { if (!tool) throw new InvalidState(p, 'прочность у не-инструмента'); s.durability = int(o.durability, p + '.durability', 0, tool.durability); }
 if (o.milliGU !== undefined) { if (!tank) throw new InvalidState(p, 'газ у не-баллона'); s.milliGU = int(o.milliGU, p + '.milliGU', 0, tank.capacity); }
 if (tool && s.durability === undefined) throw new InvalidState(p, 'нет прочности инструмента');
 if (tank && s.milliGU === undefined) throw new InvalidState(p, 'нет остатка газа');
 if(o.packed!==undefined){if(!allowPacked||!(BUILDABLE as readonly string[]).includes(itemId)||s.count!==1)throw new InvalidState(p,'неверный упакованный корпус');const body=obj(o.packed,p+'.packed');if(body.kind!==itemId)throw new InvalidState(p,'корпус не совпадает с предметом');const parsed=validateBase({buildings:[{...body,id:'build-1',x:0,y:0,z:0}],links:[],nextId:2,hand:null,handQueue:[],glass:[],doors:[],zones:[]}).buildings[0];const {id,x,y,z,...packed}=parsed;s.packed=packed;}
 return s;
}
const slot = (v: unknown, p: string,allowPacked=true): Slot => v === null ? null : entry(v, p,undefined,allowPacked);
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
function migratePrevious(raw: unknown): unknown {
 if (!isObj(raw) || !isObj(raw.meta)) return raw;
 const version = raw.meta.contentVersion;
 if (version === CONTENT_VERSION) {
  if(raw.meta.stateVersion===4){const r=structuredClone(raw);obj(r.progress,'progress').quests=freshQuestProgress();(r.meta as Obj).stateVersion=V6;return r;}
  if (raw.meta.stateVersion !== 2 && raw.meta.stateVersion !== 3) return raw;
  const r = structuredClone(raw);
  const player = obj(r.player, 'player'), world = obj(r.world, 'world');
  if(raw.meta.stateVersion===2){
  // S1 saves created before survival was wired have no new fields; never reset an
  // already-played survival state when it is loaded again.
  if (!('survival' in player)) player.survival = freshSurvival();
  else if (isObj(player.survival) && !('starvationMs' in player.survival)) player.survival.starvationMs = 0;
  if (!('base' in world)) world.base = freshBase();
  const existingNodes = obj(world.nodes, 'world.nodes');
  for (const n of NODES) if (!(n.id in existingNodes) && LATER_NODES.has(n.id)) existingNodes[n.id] = n.amount;
  if (!('capsuleMilliGU' in world)) world.capsuleMilliGU = CAPSULE_CAPACITY;
  }
  // v3 already required survival, capsule and base fields; never refill a corrupt v3 save.
  for(const b of arr(obj(world.base,'world.base').buildings,'buildings',64)){const body=obj(b,'building');kilnFuelFix(body,world);if(body.kind==='electrolyzer'&&isObj(body.job)&&body.job.recipeId==='melt_in_generator')body.job.recipeId='legacy_melt';if(body.kind==='electrolyzer')body.queue=arr(body.queue,'queue',5).filter(v=>v!=='melt_in_generator');}
  const base=validateBase(world.base,true);
  base.handQueue=[];for(const b of base.buildings)if(b.kind==='workbench')b.queue=[];
  world.base=base;
  obj(r.progress,'progress').quests=freshQuestProgress();
  (r.meta as Obj).stateVersion = V6;
  return r;
 }
 if (!(LEGACY_CONTENT_VERSIONS as readonly unknown[]).includes(version)) throw new InvalidState('meta.contentVersion', 'неподдерживаемая версия контента');
 const r = structuredClone(raw) as Obj, m = r.meta as Obj, pl = obj(r.player, 'player'), w = obj(r.world, 'world');
 if (pl.suit !== 'suit') throw new InvalidState('player.suit', 'неизвестный костюм старого формата');
 pl.suit = basicSuit();
 pl.vitals = { health: 100, satiety: 100 };
 pl.hotbar = 0; pl.survival = freshSurvival(); w.capsuleMilliGU = CAPSULE_CAPACITY;
 w.dayOffsetTicks = START_OFFSET_TICKS;
 m.contentVersion = CONTENT_VERSION; m.stateVersion = V6;
 w.base = freshBase();
 obj(r.progress,'progress').quests=freshQuestProgress();
 for (const n of NODES) if (!(n.id in obj(w.nodes, 'world.nodes')) && LATER_NODES.has(n.id)) (w.nodes as Obj)[n.id] = n.amount;
 return r;
}
export function migrateRaw(raw:unknown):unknown{
 const r=migratePrevious(raw);if(!isObj(r)||!isObj(r.meta))return r;
 const rawVersion=isObj(raw)&&isObj(raw.meta)?Number(raw.meta.stateVersion):NaN;
 const v6=rawVersion===V6||rawVersion===V7||rawVersion===STATE_VERSION||![5,6].includes(Number(r.meta.stateVersion))?r:toV6(r);
 const v7=isObj(v6)&&isObj(v6.meta)&&v6.meta.stateVersion===V6?toV7(v6):v6;
 // S4 steps key on the fields, not on the number: a v7 save, a rooms preview v8 file (no vein fields) and a veins
 // preview v8 file (still a dome, no glass fields) all reach the same v8 before strict validation.
 const rooms=isObj(v7)&&isObj(v7.meta)&&needsGlass(v7)?toGlassRooms(v7):v7;
 // The glass step builds on the raised levels and lifts the version past 8: only glass saved by S4 still needs the shift.
 const levels=isObj(rooms)&&isObj(rooms.meta)&&needsShift(rooms)?toShiftedLevels(rooms):rooms;
 // Then every door still without a `width` (S4, or just converted from a dome) becomes a module (D36).
 const modules=isObj(levels)&&isObj(levels.meta)&&needsModules(levels)?toModules(levels):levels;
 // S5.1: every module still without a `depth` (S5, or just made from an S4 door) gets its chamber's second row if it fits.
 const deep=isObj(modules)&&isObj(modules.meta)&&needsDepth(modules)?toDeepModules(modules):modules;
 return isObj(deep)&&isObj(deep.meta)&&(deep.meta.stateVersion===V7||lacksVeins(deep))?toVeins(deep):deep;
}
const needsDepth=(r:Obj)=>{const b=isObj(r.world)&&isObj(r.world.base)?r.world.base:null;return !!b&&Array.isArray(b.doors)&&b.doors.some(d=>isObj(d)&&!('depth' in d));};
/**
 * S5 modules → two cells deep (S5.1). A module two wide gets the row in front of its wall row when that row is free air
 * outside any room (no glass, other module, ground or room air) and the deeper module fits by the rules of a new one (doorFits: the new front landing
 * clear of glass, ground, stations, rocks, deposits and veins, the module off the other modules' landings and stations).
 * Otherwise (and for a legacy one-wide module) it stays one deep. Rooms keep every cell and their air: the new row was
 * outside air. A player standing in the new row (on the old front landing) is set down on the new front landing.
 * Idempotent; never lowers the version.
 */
export function toDeepModules(r:Obj):Obj{
 const next=structuredClone(r),world=obj(next.world,'world'),base=obj(world.base,'world.base'),m=obj(next.meta,'meta'),pl=obj(next.player,'player');
 const doors=Array.isArray(base.doors)?base.doors:[],num=(v:unknown)=>typeof v==='number'&&Number.isInteger(v);
 if(Array.isArray(base.glass)&&base.glass.every(num)&&doors.every(d=>isObj(d)&&['x','y','z','rot'].every(k=>num(d[k])))){
  const glass=new Set(base.glass as number[]),list=doors as Door[],colliders=worldColliders(isObj(world.nodes)?world.nodes:{},Array.isArray(world.veins)?world.veins:[]);
  const stations=(Array.isArray(base.buildings)?base.buildings:[]).filter(isObj).map(b=>stationBox({kind:String(b.kind),level:Number(b.level),x:Number(b.x),y:Number(b.y),z:Number(b.z)}));
  const view=deriveRooms(glass,list.map(o=>o.depth?o:{...o,depth:1 as const}));
  for(const d of list){if(Object.hasOwn(d,'depth'))continue;
   const shallow={...d,depth:1 as const},deep={...d,depth:2 as const},others=list.filter(o=>o!==d),taken=new Set(others.flatMap(o=>doorKeys(o.depth?o:{...o,depth:1}))),mine=new Set(doorKeys(deep));
   const reserved=new Set(others.flatMap(o=>{const v=o.depth?o:{...o,depth:1 as const};return [...landingCells(v,'front'),...landingCells(v,'back')];}));
   const row=doorKeys(deep).filter(k=>!doorKeys(shallow).includes(k));
   const fits=d.width===2&&row.every(k=>!glass.has(k)&&!taken.has(k)&&!groundKey(k)&&(view.tag.get(k)??-1)<0)&&doorFits(k=>(glass.has(k)&&!mine.has(k))||taken.has(k),deep,stations,reserved,colliders);
   Object.assign(d,{depth:fits?2:1});
   if(fits&&overlaps(moduleBox(deep,1,1),playerBox(Number(pl.x),Number(pl.y),Number(pl.z))))Object.assign(pl,landingAt(view,deep,'front'));
  }
 }
 m.stateVersion=Math.max(Number(m.stateVersion),STATE_VERSION);return next;
}
/** The module step: a door saved before D36 (no `width`) or the retired S4 passage field. */
const needsModules=(r:Obj)=>{const b=isObj(r.world)&&isObj(r.world.base)?r.world.base:null;return !!b&&('passage' in b||Array.isArray(b.doors)&&b.doors.some(d=>isObj(d)&&!('width' in d)));};
/**
 * S4 doors → S5 airlock modules (D36). A door becomes a module two cells wide when the wall cells beside it along the wall
 * (first the +x/+z side, then the other) are glass at both of its levels and the wider module fits by the rules of a new
 * one (doorFits: both landings clear of glass, modules, ground, stations, rocks, deposits and veins of this save, and off
 * the landings of other modules): that glass becomes the module's second column and returns to the backpack (a pile at
 * the module when the backpack is full). Otherwise it stays a legacy module one cell wide with the same doors. Glass and
 * module cells are both solid, so every room and its air stay exactly as they were. Both doors start closed with the
 * chamber at outside pressure. A passage still running in the save ends as it used to: the player stands on the landing
 * it was leading to. Idempotent; never lowers the version.
 */
export function toModules(r:Obj):Obj{
 const next=structuredClone(r),world=obj(next.world,'world'),base=obj(world.base,'world.base'),pl=obj(next.player,'player'),m=obj(next.meta,'meta');
 const pass=base.passage;delete base.passage;
 const doors=Array.isArray(base.doors)?base.doors:[],num=(v:unknown)=>typeof v==='number'&&Number.isInteger(v);
 // Malformed fields are left to strict validation (which rejects them).
 if(Array.isArray(base.glass)&&base.glass.every(num)&&doors.every(d=>isObj(d)&&['x','y','z','rot'].every(k=>num(d[k])))){
  const glass=new Set(base.glass as number[]),list=doors as Door[],colliders=worldColliders(isObj(world.nodes)?world.nodes:{},Array.isArray(world.veins)?world.veins:[]);
  const stations=(Array.isArray(base.buildings)?base.buildings:[]).filter(isObj).map(b=>stationBox({kind:String(b.kind),level:Number(b.level),x:Number(b.x),y:Number(b.y),z:Number(b.z)}));
  let returned=0,at:{x:number;z:number}|null=null;const moved:{d:Door;side:'front'|'back'}[]=[];
  for(const d of list){if(Object.hasOwn(d,'width'))continue;
   const rot=((Number(d.rot)%4)+4)%4,a=doorAlong(rot),others=list.filter(o=>o!==d),taken=new Set(others.flatMap(o=>doorKeys(o))),reserved=new Set(others.flatMap(o=>[...landingCells(o,'front'),...landingCells(o,'back')]));
   const wide=[newDoor(d.id,d.x,d.y,d.z,rot,2,1),newDoor(d.id,d.x-a.x,d.y,d.z-a.z,rot,2,1)].find(c=>{const mine=new Set(doorKeys(c)),extra=doorKeys(c).filter(k=>!doorKeys(d).includes(k));
    return extra.every(k=>glass.has(k))&&doorFits(k=>(glass.has(k)&&!mine.has(k))||taken.has(k),c,stations,reserved,colliders);});
   // A player the dome step set down on this door's landing (its centre) moves to the centre of the wider landing.
   const f=doorFront(rot),side=(['front','back'] as const).find(v=>{const s=v==='front'?1:-1;return Math.abs(Number(pl.x)-(d.x+.5+f.x*s))<1e-9&&Math.abs(Number(pl.z)-(d.z+.5+f.z*s))<1e-9;});
   if(wide){for(const k of doorKeys(wide))if(glass.delete(k))returned++;Object.assign(d,wide);at??=doorCenter(d);if(side)moved.push({d,side});}
   else Object.assign(d,newDoor(d.id,d.x,d.y,d.z,rot,1,1));
   // The depth step (S5.1) decides the chamber's second row after this one.
   delete (d as Partial<Door>).depth;
  }
  base.glass=[...glass].sort((p,q)=>p-q);
  if(returned&&Array.isArray(pl.inventory)){const left=addItems(pl.inventory as Slot[],'window',returned);if(left){const drops=Array.isArray(world.drops)?world.drops:(world.drops=[]),id=Number(world.nextDropId);(drops as unknown[]).push({id:'drop-'+id,x:at!.x,z:at!.z,items:[{itemId:'window',count:left}]});world.nextDropId=id+1;}}
  const view=deriveRooms(base.glass as number[],list);for(const v of moved)Object.assign(pl,landingAt(view,v.d,v.side));
  if(isObj(pass)&&typeof pass.doorId==='string'){const d=list.find(v=>v.id===pass.doorId);if(d)Object.assign(pl,landingAt(view,d,pass.direction==='in'?'back':'front'));}
 }
 m.stateVersion=Math.max(Number(m.stateVersion),STATE_VERSION);return next;
}
/** The level step: a v8 save that already holds the room fields (its keys are on the old integer levels). */
const needsShift=(r:Obj)=>{const b=isObj(r.world)&&isObj(r.world.base)?r.world.base:null;return Number(obj(r.meta,'meta').stateVersion)===V8&&!!b&&['glass','doors','zones'].every(k=>k in b);};
/**
 * v8 → v9 (S5, D35): the levels rise 0.5 m (cellY). Every key stays, so a structure on the flat 0.5 m pad keeps its rooms
 * exactly and now rests flush on it; the rooms are re-derived with the new ground rule (groundV8 → isGround). On a slope
 * a cell that was ground under the old rule may become air: the gas of every old zone is carried by cell overlap in whole
 * milli-GU like an edit (carry): a share reaching a room stays, only a share whose cells became outside leaves. A player
 * whose body now meets the raised glass (standing on a roof) rises with it. Idempotent on the version; never lowers it.
 */
export function toShiftedLevels(r:Obj):Obj{
 const next=structuredClone(r),world=obj(next.world,'world'),base=obj(world.base,'world.base'),pl=obj(next.player,'player'),m=obj(next.meta,'meta');
 const glass=base.glass,doors=base.doors,zones=base.zones,num=(v:unknown)=>typeof v==='number'&&Number.isInteger(v);
 // Malformed fields are left to strict validation (which rejects them); a well-formed layout is carried over.
 if(Array.isArray(glass)&&glass.every(num)&&Array.isArray(doors)&&doors.every(d=>isObj(d)&&['x','y','z','rot'].every(k=>num(d[k])))&&Array.isArray(zones)&&zones.every(z=>isObj(z)&&['cell','q'].every(k=>num(z[k])))){
  const list=doors as Door[],before=deriveRooms(glass as number[],list,groundV8),after=deriveRooms(glass as number[],list);
  const day=isDay(phaseSeconds(Number(m.activeTicks)||0,Number(world.dayOffsetTicks)||0));
  base.zones=carry(before,zones as Zone[],after,day?10:-10).zones;
  const x=Number(pl.x),y=Number(pl.y),z=Number(pl.z);if(bodyInSolid(after,x,y,z)&&!bodyInSolid(after,x,y+.5,z))pl.y=y+.5;
 }
 m.stateVersion=Math.max(Number(m.stateVersion),STATE_VERSION);return next;
}
/** The glass step: a v7 save, or any later save still without the room fields (a v8 file from a preview that kept the
 *  dome) converts; a save that has them is never touched again. */
function needsGlass(r:Obj){
 const v=Number(obj(r.meta,'meta').stateVersion),base=isObj(r.world)&&isObj(r.world.base)?r.world.base:null;
 return v===V7||v>V7&&!!base&&!('glass' in base&&'doors' in base&&'zones' in base);
}
/** The vein step: any save of version ≥7 that lacks one of the vein fields gains them; a full set is left untouched. */
const lacksVeins=(r:Obj)=>isObj(r.meta)&&Number(r.meta.stateVersion)>=V7&&isObj(r.world)&&!['veins','respawn','nextVeinId'].every(k=>k in (r.world as Obj));
/** v7 → v8 veins (S4, D33); idempotent, never lowers a newer version. */
export function toVeins(r:Obj):Obj{const next=structuredClone(r),m=obj(next.meta,'meta');addVeinState(obj(next.world,'world'),Number(m.seed)>>>0);m.stateVersion=Math.max(Number(m.stateVersion),STATE_VERSION);return next;}
/** S4 vein fields (D33): no veins yet; every non-grass deposit an older world already exhausted queues one, so it recovers too. */
function addVeinState(world:Obj,seed:number){
 if(!('veins' in world))world.veins=[];
 // A partial preview file may hold live veins but no counter: start past the highest saved id so validation accepts them.
 if(!('nextVeinId' in world))world.nextVeinId=1+(Array.isArray(world.veins)?world.veins:[]).reduce((m:number,v)=>{const n=isObj(v)&&typeof v.id==='string'&&/^vein-[1-9]\d*$/.test(v.id)?Number(v.id.slice(5)):0;return Math.max(m,n);},0);if('respawn' in world)return;
 const nodes=isObj(world.nodes)?world.nodes:{},q:Respawn[]=[];
 for(const n of NODES)if(n.material!=='grass'&&nodes[n.id]===0&&q.length<RESPAWN_MAX)q.push({material:n.material as VeinMaterial,ms:veinDelay(seed,q.length,n.material as VeinMaterial)});
 world.respawn=q;}
/** S3 halves kiln fuel: a paid batch keeps one fiber, the other returns to the fuel slot (or a spare slot / a pile). */
function kilnFuelFix(b:Obj,world:Obj,at?:{x:number;z:number}){
 const j=b.job,recipe=isObj(j)?RECIPE_BY_ID.get(String(j.recipeId)):undefined;
 if(b.kind!=='kiln'||!isObj(j)||!Array.isArray(j.reserved)||recipe?.station!=='kiln'||recipe.inputs.fiber!==1)return;
 const fiber=j.reserved.find(v=>isObj(v)&&v.itemId==='fiber'&&v.count===2) as Obj|undefined;if(!fiber)return;
 fiber.count=1;const input=Array.isArray(b.input)?b.input:[];
 const fit=[1,2,3].find(i=>input[i]===null||(isObj(input[i])&&input[i].itemId==='fiber'&&Number(input[i].count)<64));
 if(fit!==undefined){if(input[fit]===null)input[fit]={itemId:'fiber',count:1};else (input[fit] as Obj).count=Number((input[fit] as Obj).count)+1;return;}
 const drops=Array.isArray(world.drops)?world.drops:(world.drops=[]),id=Number(world.nextDropId);
 (drops as unknown[]).push({id:'drop-'+id,x:Number(at?.x??b.x??40),z:Number(at?.z??b.z??42),items:[{itemId:'fiber',count:1}]});world.nextDropId=id+1;
}
/** v6 → v7 (S3): new deposits arrive full, regrowth starts empty, bodies face north, jobs do not repeat. */
function toV7(r:Obj):Obj{
 const next=structuredClone(r),world=obj(next.world,'world'),nodes=obj(world.nodes,'world.nodes');
 const base=obj(world.base,'world.base'),pl=obj(next.player,'player'),bodies=arr(base.buildings,'buildings',64).filter(isObj);
 // The old world never saw these deposits. One that would appear under a body arrives empty (no collider, no stock);
 // a solid one also stays clear of the player and of each airlock's exit cells, where a collider would trap them.
 const blocks=(n:typeof NODES[number])=>bodies.some(b=>covers(n,Number(b.x),Number(b.z),bodyHalf(String(b.kind))))||!!n.box&&(nodeCovered(n,Number(pl.x),Number(pl.z),.4)||
  bodies.some(b=>{if(b.kind!=='dome')return false;const f=doorFront(Number(b.rot??0)),x=Number(b.x),z=Number(b.z);return nodeCovered(n,x+f.x,z+f.z,.45)||nodeCovered(n,x+f.x*3.5,z+f.z*3.5,.45);}));
 // Only deposits new in S3 arrive full; a missing older one stays missing and fails validation (no refill by deletion).
 for(const n of NODES)if(S3_NODES.has(n.id)&&!(n.id in nodes))nodes[n.id]=blocks(n)?0:n.amount;
 world.regrow={};
 const drops=Array.isArray(world.drops)?world.drops:[];
 const body=(b:unknown,at?:{x:number;z:number})=>{if(!isObj(b))return;if(!('rot' in b))b.rot=0;if(isObj(b.job)&&!('repeat' in b.job))b.job.repeat=0;
  kilnFuelFix(b,world,at);
 };
 for(const b of arr(base.buildings,'buildings',64))body(b);
 if(isObj(base.hand)&&!('repeat' in base.hand))base.hand.repeat=0;
 const here={x:Number(pl.x),z:Number(pl.z)};
 const packed=(slots:unknown)=>{if(Array.isArray(slots))for(const s of slots)if(isObj(s)&&isObj(s.packed))body(s.packed,here);};
 packed(pl.inventory);
 if(isObj(world.crates))for(const c of Object.values(world.crates))packed(c);
 for(const d of [...drops])if(isObj(d))packed(d.items);
 obj(next.meta,'meta').stateVersion=V7;return next;
}
/** v7 → v8 (S4): domes become glass rooms (domesToGlass); per-body zones retire; a packed dome is a plain dome item.
 *  Idempotent; the version only ever rises (a newer save keeps its own number). */
export function toGlassRooms(r:Obj):Obj{
 const next=structuredClone(r),world=obj(next.world,'world'),base=obj(world.base,'world.base'),pl=obj(next.player,'player');
 for(const k of ['glass','doors','zones'])if(!(k in base))base[k]=[];
 domesToGlass(base,pl,worldColliders(isObj(world.nodes)?world.nodes:{},Array.isArray(world.veins)?world.veins:[]));
 for(const b of arr(base.buildings,'buildings',64))if(isObj(b))delete b.zone;
 // The air never travels in a backpack: a packed dome becomes the legacy item, taken apart by the dismantle_dome recipe.
 const unpack=(slots:unknown)=>{if(Array.isArray(slots))for(const s of slots)if(isObj(s)&&isObj(s.packed)){if(s.itemId==='dome')delete s.packed;else delete s.packed.zone;}};
 unpack(pl.inventory);if(isObj(world.crates))for(const c of Object.values(world.crates))unpack(c);
 if(Array.isArray(world.drops))for(const d of world.drops)if(isObj(d))unpack(d.items);
 const m=obj(next.meta,'meta');m.stateVersion=Math.max(Number(m.stateVersion),STATE_VERSION);return next;
}
/**
 * S4 (D31): each placed dome becomes a glass shell with a built-in airlock and keeps its air. Interior: cells x−2…x+1 ×
 * z−2…z+1, three air levels above each column's lowest air level, one common top. Shell: every non-ground face neighbour
 * of the interior plus four corner columns for the look. The platform is gone: stations that stood on it go down to the
 * terrain (stationY), and so does the player. Stations stay where they stand otherwise (overlaps are allowed here).
 * The airlock takes the two lowest wall cells in the middle of a wall, at the level of the highest of its three columns.
 * It keeps the old front (same `rot`, middle column x/z, then x−1/z−1) when both landings are clear by the rules of a new
 * door (glass, doors, ground, stations, rocks, deposits and veins of this save: worldColliders, never the live `boxes`
 * of whatever world was loaded before); else the other walls are tried in turn; if none is clear the old front
 * stays. A passage through a dome ends at once, and a player left inside the new glass is set down on a landing: the
 * room side when the chest was inside the old dome, else the outer side.
 */
export function domesToGlass(base:Obj,player:Obj,colliders:readonly Box[]){
 const bodies=arr(base.buildings,'buildings',64),domes=bodies.filter((b):b is Obj=>isObj(b)&&b.kind==='dome'),rest=bodies.filter((b):b is Obj=>isObj(b)&&b.kind!=='dome');
 base.buildings=bodies.filter(b=>!(isObj(b)&&b.kind==='dome'));
 const glass=new Set((Array.isArray(base.glass)?base.glass:[]) as number[]),doors=(Array.isArray(base.doors)?base.doors:[]) as Door[];
 // The old dome volume (insideDome of S3): |dx|, |dz| < 2 above the platform.
 const onPlatform=(d:Obj,b:Obj)=>Math.abs(Number(b.x)-Number(d.x))<2&&Math.abs(Number(b.z)-Number(d.z))<2&&Number(b.y)>=Number(d.y)-.1&&Number(b.y)<Number(d.y)+3;
 const shells=domes.map(d=>{
  const x=Number(d.x),z=Number(d.z),rot=((Number(d.rot??0)%4)+4)%4,interior=groundRoom(x-2,z-2,4,4,3),top=Math.max(...interior.map(c=>cellOf(c).k));
  for(const c of shellOf(interior))glass.add(c);
  for(const [i,j] of [[x-3,z-3],[x-3,z+2],[x+2,z-3],[x+2,z+2]])for(let k=lowestAir(i,j);k<=top;k++)glass.add(cellKey(i,k,j));
  return {d,x,z,rot,interior:new Set(interior),inner:Math.min(...interior)};
 });
 for(const b of rest){const s=shells.find(m=>onPlatform(m.d,b));if(s)b.y=stationY(Number(b.x),Number(b.z));}
 if(shells.some(m=>onPlatform(m.d,player)))player.y=heightAt(Number(player.x),Number(player.z));
 const stations=rest.map(b=>stationBox({kind:String(b.kind),level:Number(b.level),x:Number(b.x),y:Number(b.y),z:Number(b.z)}));
 const taken=new Set<number>(),reserved=new Set<number>(),claim=(d:Door)=>{for(const k of doorKeys(d))taken.add(k);for(const s of ['front','back'] as const)for(const k of landingCells(d,s))reserved.add(k);};
 for(const d of doors)claim(d);
 let nextId=Number(base.nextId);const made:{id:string;door:Door;inner:number;interior:Set<number>;x:number;z:number;zone:Obj}[]=[];
 for(const m of shells){
  const own=(d:Door)=>new Set(doorKeys(d)),options=[0,1,2,3].flatMap(r=>{const rot=(m.rot+r)%4,f=doorFront(rot),i0=Math.floor(m.x+f.x*2.5),j0=Math.floor(m.z+f.z*2.5);
   return [0,-1].map(o=>{const i=i0+(f.x?0:o),j=j0+(f.z?0:o);return {id:'',x:i,y:Math.max(lowestAir(i,j),lowestAir(i-f.x,j-f.z),lowestAir(i+f.x,j+f.z)),z:j,rot} as Door;});});
  const pick=options.find(d=>{const mine=own(d);return doorFits(k=>(glass.has(k)&&!mine.has(k))||taken.has(k),d,stations,reserved,colliders);})??options[0];
  const door={...pick,id:'door-'+nextId++};claim(door);
  doors.push(door);made.push({id:String(m.d.id),door,inner:m.inner,interior:m.interior,x:m.x,z:m.z,zone:isObj(m.d.zone)?m.d.zone:{}});
 }
 for(const door of doors)for(const k of doorKeys(door))glass.delete(k);
 const sorted=[...glass].sort((a,b)=>a-b),view=deriveRooms(sorted,doors),zones=(Array.isArray(base.zones)?base.zones:[]) as unknown[];
 for(const m of made){const t=view.tag.get(m.inner);if(t===undefined||t<0)continue;const room=view.rooms[t],z=m.zone;
  const q=Math.min(Number(z.q??0),capacityOf(room.volume)),same=zones.find(v=>isObj(v)&&v.cell===room.cell) as Obj|undefined;
  // Two old domes never touched (bodies kept 5 m apart); should their shells still close one room, the air adds up.
  if(same){same.q=Math.min(Number(same.q)+q,capacityOf(room.volume));continue;}
  zones.push({cell:room.cell,q,temperature:Number(z.temperature??10),purity:Number(z.purity??0),lossRemainder:Number(z.lossRemainder??0)});}
 Object.assign(base,{glass:sorted,doors,zones,nextId});
 const pass=base.passage,px=Number(player.x),py=Number(player.y),pz=Number(player.z);
 if(isObj(pass)&&'domeId' in pass){const m=made.find(v=>v.id===pass.domeId);if(m)Object.assign(player,landingAt(view,m.door,pass.direction==='in'?'back':'front'));base.passage=null;}
 // The shell reaches 1 m past the old walls: a player saved beside the dome (often right at its airlock) would stand in glass.
 else if(made.length&&bodyInSolid(view,px,py,pz)){
  const m=made.reduce((a,b)=>Math.hypot(b.x-px,b.z-pz)<Math.hypot(a.x-px,a.z-pz)?b:a);
  Object.assign(player,landingAt(view,m.door,m.interior.has(cellKey(Math.floor(px),levelAt(py+1),Math.floor(pz)))?'back':'front'));
 }
}
function toV6(r:Obj):Obj{
 const next=structuredClone(r),world=obj(next.world,'world');
 if(!('crates' in world))world.crates={'crate-a':emptyInventory(),'crate-b':emptyInventory()};
 const base=obj(world.base,'world.base');for(const b of arr(base.buildings,'buildings',64)){
  const body=obj(b,'building');
  if(body.kind==='kiln'||body.kind==='electrolyzer'){
   // Old unpaid recipe lists retire. Preserve paid WIP and every loaded stack;
   // only the two visible inputs feed the new dedicated machine interface.
   arr(body.queue,'queue',5);body.queue=[];
   const pool=arr(body.input,'building.input',4).slice();
   if(pool.length===4){
    const types=body.kind==='kiln'?[['iron_raw','copper_raw','sand','ice'],['fiber']]:[['water'],Object.keys(TANKS)];
    const slots:unknown[]=Array(4).fill(null);
    types.forEach((ids,i)=>{const at=pool.findIndex(s=>isObj(s)&&ids.includes(String(s.itemId)));if(at>=0){slots[i]=pool[at];pool[at]=null;}});
    // Unrecognised old stock goes to the spare slots 2–3 only (0/1 are the dedicated inputs); any rest becomes a pile.
    for(const s of pool)if(s!==null){const at=[2,3].find(i=>slots[i]===null);if(at!==undefined){slots[at]=s;continue;}
     const drops=Array.isArray(world.drops)?world.drops:(world.drops=[]),id=Number(world.nextDropId);
     (drops as unknown[]).push({id:'drop-'+id,x:Number(body.x??40),z:Number(body.z??42),items:[s]});world.nextDropId=id+1;}
    body.input=slots;
   }
  }
  if(body.kind==='electrolyzer'){const j=body.job;if(isObj(j)&&j.recipeId==='melt_in_generator')j.recipeId='legacy_melt';}
 }
 obj(obj(next.progress,'progress').quests,'quests').tracked=null;obj(next.meta,'meta').stateVersion=V6;return next;
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
 const regrowRaw = obj(w.regrow, 'world.regrow'), regrow: Record<string, number> = {};
 for (const [k, v] of Object.entries(regrowRaw)) { const n = NODE_BY_ID.get(k); if (!n?.regrowSeconds) throw new InvalidState('world.regrow', `узел ${k} не отрастает`); regrow[k] = int(v, `world.regrow.${k}`, 0, n.regrowSeconds * 1000); }
 const dropIds = new Set<string>();
 const drops = arr(w.drops, 'world.drops', 4096).map((d, i) => { const o = obj(d, `world.drops[${i}]`), id = str(o.id, `world.drops[${i}].id`, 24, ID); if (dropIds.has(id)) throw new InvalidState('world.drops', 'повтор id'); dropIds.add(id);
  return { id, x: num(o.x, 'drop.x', -200, 360), z: num(o.z, 'drop.z', -200, 360), items: arr(o.items, 'drop.items', 64).map((s, j) => entry(s, `world.drops[${i}].items[${j}]`, 1e6)) }; });
 const nextDropId = int(w.nextDropId, 'world.nextDropId', 1, Number.MAX_SAFE_INTEGER);
 for (const d of drops) {
  const generatedId = /^drop-(\d+)$/.exec(d.id);
  if (generatedId && Number(generatedId[1]) >= nextDropId) throw new InvalidState('world.nextDropId', 'счётчик должен быть больше всех существующих идентификаторов куч');
 }
 const ids = (v: unknown, p: string) => arr(v, p, 64).map((x, i) => str(x, `${p}[${i}]`, 32, ID));
 const qp=obj(pr.quests,'progress.quests');
 const facts=arr(qp.facts,'quests.facts',QUEST_FACTS.size).map(v=>{if(typeof v!=='string'||!QUEST_FACTS.has(v))throw new InvalidState('quests.facts','неизвестный факт');return v;});
 const completed=arr(qp.completed,'quests.completed',QUEST_IDS.length).map(v=>{if(!(QUEST_IDS as readonly unknown[]).includes(v))throw new InvalidState('quests.completed','неизвестная цель');return v as QuestId;});
 if(new Set(facts).size!==facts.length||new Set(completed).size!==completed.length)throw new InvalidState('quests','повтор факта или цели');
 if(qp.tracked!==null&&!(QUEST_IDS as readonly unknown[]).includes(qp.tracked))throw new InvalidState('quests.tracked','неизвестная цель');
 if(pr.scanner!==undefined&&typeof pr.scanner!=='boolean')throw new InvalidState('progress.scanner','ожидался boolean');
 return {
  meta: { worldId: str(m.worldId, 'meta.worldId', 48, ID), name: str(m.name, 'meta.name', 48), seed: int(m.seed, 'meta.seed', 0, 0xffffffff), planetId: 'verdana', generatorVersion: GENERATOR_VERSION, contentVersion: CONTENT_VERSION, stateVersion: STATE_VERSION, createdAt: int(m.createdAt, 'meta.createdAt', 0, 8.64e15), activeTicks: int(m.activeTicks, 'meta.activeTicks', 0, Number.MAX_SAFE_INTEGER) },
  player: { x: num(pl.x, 'player.x', -200, 360), y: num(pl.y, 'player.y', -100, 200), z: num(pl.z, 'player.z', -200, 360), yaw: num(pl.yaw, 'player.yaw', -1e6, 1e6), pitch: num(pl.pitch, 'player.pitch', -2, 2),
   vitals: { health: num(vit.health, 'player.vitals.health', 0, 100), satiety: num(vit.satiety, 'player.vitals.satiety', 0, 100) },
   survival, suit: Object.fromEntries(SUIT_PARTS.map(p => [p, suitSlot(suitRaw[p], p)])) as Suit,
   bottles: [bottleSlot(bottles[0], 'player.bottles[0]'), bottleSlot(bottles[1], 'player.bottles[1]')], inventory: inv.map((s, i) => slot(s, `player.inventory[${i}]`)),
   hotbar: int(pl.hotbar, 'player.hotbar', 0, HOTBAR_SIZE - 1) },
  world: { crates:Object.fromEntries(['crate-a','crate-b'].map(id=>{const a=arr(obj(w.crates,'world.crates')[id],'crate.'+id,24);if(a.length!==24)throw new InvalidState('crate','нужно 24 слота');return [id,a.map((v,i)=>slot(v,'crate.'+id+'.'+i))];})), base: validateBase(w.base), capsuleMilliGU: int(w.capsuleMilliGU, 'world.capsuleMilliGU', 0, CAPSULE_CAPACITY), nodes, regrow, drops, nextDropId, dayOffsetTicks: int(w.dayOffsetTicks, 'world.dayOffsetTicks', 0, CYCLE_TICKS - 1), ...validateVeins(w) },
  progress: { visited: ids(pr.visited, 'progress.visited'), discovered: ids(pr.discovered, 'progress.discovered'), selected: str(pr.selected, 'progress.selected', 32, ID), quests:{facts,completed,tracked:qp.tracked as QuestId|null}, waypoint: pr.waypoint == null ? null : { x: num(obj(pr.waypoint, 'progress.waypoint').x, 'progress.waypoint.x', -200, 360), z: num(obj(pr.waypoint, 'progress.waypoint').z, 'progress.waypoint.z', -200, 360) }, ...(pr.scanner === true ? { scanner: true } : {}) },
 };
}

/** Production imports are validated as strictly as the player containers. `legacy` (v2/v3 mid-migration) still accepts
 *  domes with their air and a passage through a dome: toGlassRooms converts them. */
function validateBase(value: unknown, legacy = false): BaseState {
 const raw=obj(value,'world.base'), seen=new Set<string>(), generationIds:number[]=[];
 const register=(v:unknown,p:string,prefix:string)=>{const id=str(v,p,32,ID);if(!new RegExp('^'+prefix+'-[1-9][0-9]*$').test(id)||seen.has(id))throw new InvalidState(p,'неверный или повторный ID');seen.add(id);generationIds.push(Number(id.split('-')[1]));return id;};
 const container=(v:unknown,p:string)=>{const a=arr(v,p,4);if(a.length!==4)throw new InvalidState(p,'нужно 4 слота');return a.map((s,i)=>slot(s,p+'.'+i,false));};
 const job=(v:unknown,station:string,level=1):Job|null=>{
  if(v===null)return null;const o=obj(v,'job'),id=str(o.recipeId,'job.recipeId',40,ID),r=RECIPE_BY_ID.get(id);
  if(!r||!runsOn({kind:station,level},r))throw new InvalidState('job.recipeId','неподходящий рецепт');
  const reserved=arr(o.reserved,'job.reserved',8).map((s,i)=>entry(s,'job.reserved.'+i,undefined,false)),water=int(o.water,'job.water',0,1000),expected=Object.entries(r.inputs).filter(([id])=>id!=='water'||water===0);
  if(reserved.length!==expected.length||reserved.some(s=>s.durability!==undefined||s.milliGU!==undefined)||expected.some(([id,n])=>reserved.filter(s=>s.itemId===id&&s.count===n).length!==1))throw new InvalidState('job.reserved','входы не совпадают с рецептом');
  if(water!==0&&water!==(r.inputs.water??0)*1000)throw new InvalidState('job.water','неверный резерв воды');
  return {recipeId:id,workMs:num(o.workMs,'job.workMs',0,r.seconds*1000),reserved,water,repeat:legacy&&o.repeat===undefined?0:int(o.repeat,'job.repeat',0,MAX_REPEAT)};
 };
 const queue=(v:unknown,station:string,level=1)=>arr(v,'queue',5).map(v=>{const id=str(v,'queue.recipe',40,ID),r=RECIPE_BY_ID.get(id);if(!r||!runsOn({kind:station,level},r))throw new InvalidState('queue.recipe','неподходящий рецепт');return id;});
 const buildings=arr(raw.buildings,'base.buildings',64).map((v):Building=>{const o=obj(v,'building'),kind=str(o.kind,'building.kind',32,ID),dome=legacy&&kind==='dome';if(!dome&&!(BUILDABLE as readonly string[]).includes(kind))throw new InvalidState('building.kind','неизвестный корпус');
  if(typeof o.lowPriority!=='boolean')throw new InvalidState('building.lowPriority','ожидался boolean');
  if(typeof o.enabled!=='boolean')throw new InvalidState('building.enabled','ожидался boolean');
  const input=container(o.input,'building.input'),output=container(o.output,'building.output');
  if(kind==='biogenerator'&&input.some(s=>s&&s.itemId!=='fiber'))throw new InvalidState('building.input','генератор принимает только волокна');
  const level=legacy?1:int(o.level,'building.level',1,2) as 1|2;
  if(level===2&&kind!=='workbench')throw new InvalidState('building.level','нет такого улучшения');
  const b:Building={level,rot:legacy&&o.rot===undefined?0:int(o.rot,'building.rot',0,3),id:register(o.id,'building.id','build'),kind:kind as Building['kind'],x:int(o.x,'building.x',-195,355),y:num(o.y,'building.y',-100,200),z:int(o.z,'building.z',-195,355),input,output,job:job(o.job,kind,level),queue:queue(o.queue,kind,level),enabled:o.enabled,lowPriority:o.lowPriority,energy:int(o.energy,'building.energy',0,GEN_BUFFER),fuel:int(o.fuel,'building.fuel',0,FIBER_EU),water:int(o.water,'building.water',0,20000),oxygen:int(o.oxygen,'building.oxygen',0,kind==='electrolyzer'?ELECTROLYZER_O2:PORT_O2)};
  if(dome){const z=obj(o.zone,'building.zone');(b as Building&{zone:Obj}).zone={q:int(z.q,'zone.q',0,960000),temperature:num(z.temperature,'zone.temperature',-150,150),purity:num(z.purity,'zone.purity',0,1),lossRemainder:int(z.lossRemainder,'zone.lossRemainder',0,999)};}
  if(!legacy&&(kind==='workbench'&&level===1?b.queue.length>0:b.queue.length+(b.job?1:0)>5))throw new InvalidState('building.queue','очередь недоступна/переполнена');
  if(kind!=='biogenerator'&&(b.energy||b.fuel))throw new InvalidState('building','энергия/топливо не у генератора');if(kind!=='electrolyzer'&&b.water)throw new InvalidState('building.water','вода не у электролиза');if(!['electrolyzer','refill','distributor'].includes(kind)&&b.oxygen)throw new InvalidState('building.oxygen','нет газового буфера');return b;
 });
 const links=arr(raw.links,'base.links',128).map(v=>{const o=obj(v,'link'),kind=o.kind;if(kind!=='cable'&&kind!=='gas_pipe')throw new InvalidState('link.kind','неизвестная сеть');const from=str(o.from,'link.from',32,ID),to=str(o.to,'link.to',32,ID),a=buildings.find(b=>b.id===from),b=to==='capsule'?{x:40,y:heightAt(40,40)+.14,z:40,kind:'capsule'}:buildings.find(b=>b.id===to);
  if(!a||!b||from===to||Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)>LINK_RANGE+.001)throw new InvalidState('link','неверные порты/длина');
  if(kind==='gas_pipe'&&(a.kind!=='electrolyzer'||!['capsule','refill','distributor'].includes(b.kind)))throw new InvalidState('link','неверное направление O₂');
  if(kind==='cable'&&(!electricPort(a)||!electricPort(b)))throw new InvalidState('link','нет электрического порта');
  return {id:register(o.id,'link.id','link'),kind:kind as Link['kind'],from,to};
 });
 const pairs=new Set<string>();for(const l of links){const k=l.kind+':'+(l.kind==='cable'?[l.from,l.to].sort():[l.from,l.to]).join(':');if(pairs.has(k))throw new InvalidState('links','повтор сегмента');pairs.add(k);}
 // S4 glass rooms: sorted unique cells in the building area, doors clear of glass and of each other.
 const list=(k:string,max:number)=>legacy&&raw[k]===undefined?[]:arr(raw[k],'base.'+k,max);
 const glass=list('glass',GLASS_LIMIT).map(v=>{const k=int(v,'base.glass',0,2**27-1),c=cellOf(k);if(!storable(c.i,c.k,c.j))throw new InvalidState('base.glass','клетка вне участка');return k;});
 for(let i=1;i<glass.length;i++)if(glass[i]<=glass[i-1])throw new InvalidState('base.glass','ключи не упорядочены или повторяются');
 const face=(v:unknown,p:string)=>{if(v!=='closed'&&v!=='cycling'&&v!=='open')throw new InvalidState(p,'неверное состояние двери');return v as DoorState;};
 const solid=new Set(glass),doors=list('doors',DOOR_LIMIT).map((v):Door=>{const o=obj(v,'door'),width=o.width,depth=o.depth;if(width!==1&&width!==2)throw new InvalidState('door.width','ширина шлюза 1 или 2');if(depth!==1&&depth!==2)throw new InvalidState('door.depth','глубина шлюза 1 или 2');
  const d:Door={id:register(o.id,'door.id','door'),x:int(o.x,'door.x',CELL_MIN-STORE_MARGIN,CELL_MAX+STORE_MARGIN),y:int(o.y,'door.y',LEVEL_MIN,LEVEL_MAX-1),z:int(o.z,'door.z',CELL_MIN-STORE_MARGIN,CELL_MAX+STORE_MARGIN),rot:int(o.rot,'door.rot',0,3),width,depth,outer:face(o.outer,'door.outer'),inner:face(o.inner,'door.inner'),pressure:int(o.pressure,'door.pressure',0,CHAMBER_Q),cycleMs:int(o.cycleMs,'door.cycleMs',0,EQUALIZE_MS+SLIDE_MS)};
  // Interlock (D36): at most one door is not closed; a cycle runs exactly while one door is cycling.
  if(d.outer!=='closed'&&d.inner!=='closed')throw new InvalidState('base.doors','обе двери шлюза не закрыты');
  if((d.outer==='cycling'||d.inner==='cycling')!==(d.cycleMs>0))throw new InvalidState('door.cycleMs','неверный цикл шлюза');
  for(const k of doorKeys(d)){const c=cellOf(k);if(!storable(c.i,c.k,c.j))throw new InvalidState('base.doors','шлюз вне участка');if(solid.has(k))throw new InvalidState('base.doors','шлюз пересекает стекло или другой шлюз');solid.add(k);}return d;});
 const nextId=int(raw.nextId,'base.nextId',1,Number.MAX_SAFE_INTEGER);if(generationIds.some(n=>n>=nextId))throw new InvalidState('base.nextId','счётчик не больше существующих ID');
 const view=deriveRooms(glass,doors);if(view.rooms.length>ROOM_LIMIT)throw new InvalidState('base.zones','больше '+ROOM_LIMIT+' помещений');
 // A zone whose room no longer exists drops its gas (not an error); a room without a zone starts empty.
 const zoneCells=new Set<number>(),zones:Zone[]=[];
 for(const v of list('zones',ROOM_LIMIT)){const o=obj(v,'zone'),cell=int(o.cell,'zone.cell',0,2**27-1);if(zoneCells.has(cell))throw new InvalidState('base.zones','повтор помещения');zoneCells.add(cell);
  const z:Zone={cell,q:int(o.q,'zone.q',0,capacityOf(ROOM_MAX)),temperature:num(o.temperature,'zone.temperature',-150,150),purity:num(o.purity,'zone.purity',0,1),lossRemainder:int(o.lossRemainder,'zone.lossRemainder',0,999)};
  const room=view.rooms.find(r=>r.cell===cell);if(!room)continue;if(z.q>capacityOf(room.volume))throw new InvalidState('zone.q','воздуха больше вместимости помещения');zones.push(z);}
 for(const r of view.rooms)if(!zoneCells.has(r.cell))zones.push({cell:r.cell,q:0,temperature:10,purity:0,lossRemainder:0});
 // Only a v2/v3 save mid-migration still carries a passage through a dome (toGlassRooms ends it); S5 has no passage.
 let passage:unknown=null;if(legacy&&isObj(raw.passage)){const o=raw.passage,domeId=str(o.domeId,'passage.domeId',32,ID);if(!buildings.some(b=>b.id===domeId&&(b.kind as string)==='dome')||(o.direction!=='in'&&o.direction!=='out'))throw new InvalidState('passage','неверный шлюз');passage={domeId,direction:o.direction,remainingMs:int(o.remainingMs,'passage.remainingMs',0,6000)};}
 const handQueue=queue(raw.handQueue,'hand');if(!legacy&&handQueue.length)throw new InvalidState('handQueue','ручная очередь недоступна');
 const base:BaseState={buildings,links,nextId,hand:job(raw.hand,'hand'),handQueue,glass,doors,zones};if(legacy)(base as BaseState&{passage:unknown}).passage=passage;return base;
}

/** S4 veins (D33): only checked spots, the right material, unique ids below the counter, stock within the size range and the caps. */
function validateVeins(w: Obj): { veins: Vein[]; respawn: Respawn[]; nextVeinId: number } {
 const nextVeinId = int(w.nextVeinId, 'world.nextVeinId', 1, Number.MAX_SAFE_INTEGER), ids = new Set<string>(), spots = new Set<string>();
 const material = (v: unknown, p: string) => { if (!(VEIN_MATERIALS as readonly unknown[]).includes(v)) throw new InvalidState(p, 'неизвестный материал жилы'); return v as VeinMaterial; };
 const veins = arr(w.veins, 'world.veins', VEIN_TOTAL).map((x, i): Vein => {
  const p = `world.veins[${i}]`, o = obj(x, p), id = str(o.id, p + '.id', 24, ID), at = /^vein-([1-9][0-9]*)$/.exec(id);
  if (!at || ids.has(id)) throw new InvalidState(p + '.id', 'неверный или повторный ID жилы'); ids.add(id);
  if (Number(at[1]) >= nextVeinId) throw new InvalidState('world.nextVeinId', 'счётчик должен быть больше всех жил');
  const m = material(o.material, p + '.material'), spot = str(o.spot, p + '.spot', 24, ID), s = VEIN_SPOT_BY_ID.get(spot);
  if (!s || s.material !== m) throw new InvalidState(p + '.spot', 'нет такого места для жилы'); if (spots.has(spot)) throw new InvalidState(p + '.spot', 'две жилы в одном месте'); spots.add(spot);
  const [lo, hi] = veinSizeRange(m), size = int(o.size, p + '.size', lo, hi);
  return { id, spot, material: m, amount: int(o.amount, p + '.amount', 1, size), size, spawnedAt: int(o.spawnedAt, p + '.spawnedAt', 0, Number.MAX_SAFE_INTEGER) };
 });
 for (const m of VEIN_MATERIALS) if (veins.filter(v => v.material === m).length > VEIN_CAP) throw new InvalidState('world.veins', 'слишком много жил одного материала');
 const respawn = arr(w.respawn, 'world.respawn', RESPAWN_MAX).map((x, i): Respawn => { const p = `world.respawn[${i}]`, o = obj(x, p); return { material: material(o.material, p + '.material'), ms: int(o.ms, p + '.ms', 0, VEIN_DELAY_RANGE[1]) }; });
 return { veins, respawn, nextVeinId };
}
