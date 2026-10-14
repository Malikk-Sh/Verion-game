import { addItems, firstEmpty, type Slot } from './inventory';
import { insideDome, linkLength, linkSegments, machine, nearby, type Building } from './production';
import { TANKS } from './defs';
import { tankGap } from './survival';
import { HOTBAR_SIZE, type GameState } from './state';
const isTank = (s: Slot) => !!s && Object.hasOwn(TANKS, s.itemId);
/** Packing and all link refunds are atomic: a full backpack leaves the world unchanged. */
export function packStation(g:GameState,id:string):string{
 const b=machine(g,id);if(!b||Math.hypot(g.player.x-b.x,g.player.z-b.z)>3.2)return 'Подойдите к станции';
 if(g.world.base.passage?.domeId===id||insideDome(b,g.player.x,g.player.y,g.player.z))return 'Сначала выйдите из купола';
 if(b.kind==='dome'&&g.world.base.buildings.some(v=>v!==b&&insideDome(b,v.x,v.y,v.z)))return 'Сначала заберите станции внутри купола';
 const inv=structuredClone(g.player.inventory),at=firstEmpty(inv);if(at<0)return 'Освободите ячейку в рюкзаке';
 const {id:oldId,x,y,z,...packed}=structuredClone(b);inv[at]={itemId:b.kind,count:1,packed};
 const links=g.world.base.links.filter(l=>l.from===id||l.to===id);for(const l of links)if(addItems(inv,l.kind,linkSegments(linkLength(g,l))))return 'Нет места для кабелей и труб';
 g.player.inventory=inv;g.world.base.links=g.world.base.links.filter(l=>!links.includes(l));g.world.base.buildings=g.world.base.buildings.filter(v=>v!==b);return '';
}
/** Loading a dedicated machine transfers a real stack, never makes an extra bottle. */
export function loadMachineSlot(g:GameState,id:string,index:number):string{
 const b=machine(g,id),s=g.player.inventory[index];if(!b||!s||Math.hypot(b.x-g.player.x,b.z-g.player.z)>3.2)return 'Подойдите к станции';
 let target=-1;
 if(b.kind==='biogenerator')target=s.itemId==='fiber'?0:-1;
 if(b.kind==='kiln')target=s.itemId==='fiber'?1:['iron_raw','copper_raw','sand','ice'].includes(s.itemId)?0:-1;
 if(b.kind==='electrolyzer')target=s.itemId==='water'?0:isTank(s)?1:-1;
 if(target<0)return 'Этот предмет сюда не подходит';const old=b.input[target];
 if(old&&old.itemId===s.itemId&&s.milliGU===undefined){const n=Math.min(64-old.count,s.count);if(!n)return 'Слот полон';old.count+=n;s.count-=n;if(!s.count)g.player.inventory[index]=null;}else{b.input[target]=s;g.player.inventory[index]=old;}
 return '';
}
export function takeSlot(g:GameState,slots:Slot[],index:number):string{
 const s=slots[index];if(!s)return 'Слот пуст';const inv=structuredClone(g.player.inventory);
 if(s.milliGU!==undefined||s.durability!==undefined||s.packed){const at=firstEmpty(inv,HOTBAR_SIZE);if(at<0)return 'Рюкзак полон';inv[at]=structuredClone(s);}else if(addItems(inv,s.itemId,s.count))return 'Рюкзак полон';
 g.player.inventory=inv;slots[index]=null;return '';
}
/** Where one real tank can be: a worn suit connector, a backpack cell, or an oxygen generator's charging slot. */
export type TankPlace = { kind: 'worn'; b: 0 | 1 } | { kind: 'pack'; i: number } | { kind: 'station'; id: string };
function tankCell(g:GameState,p:TankPlace):{slots:Slot[];i:number}|string{
 if(p.kind==='worn')return p.b===0||p.b===1?{slots:g.player.bottles,i:p.b}:'Нет такой ячейки';
 if(p.kind==='pack')return Number.isInteger(p.i)&&p.i>=0&&p.i<g.player.inventory.length?{slots:g.player.inventory,i:p.i}:'Нет такой ячейки';
 const b=machine(g,p.id);if(!b||b.kind!=='electrolyzer')return 'Баллоны заправляет генератор кислорода';if(!nearby(g,b))return 'Подойдите к станции';
 return {slots:b.input,i:1};
}
const tankAt=(g:GameState,p:TankPlace)=>{const c=tankCell(g,p);return typeof c==='string'?null:c.slots[c.i];};
/**
 * Moves one real tank between the suit, the backpack and an oxygen generator's charging slot (S4). An empty target takes
 * it, a tank there swaps by reference, so the gas travels with the object; anything else, a station out of reach or a dead
 * player is refused and nothing changes. The station holds the suit connector: a tank moved between it and the suit is
 * worn at once (D08).
 */
export function moveTank(g:GameState,from:TankPlace,to:TankPlace):string{
 if(g.player.vitals.health<=0)return 'Персонаж погиб';
 const a=tankCell(g,from),b=tankCell(g,to);if(typeof a==='string')return a;if(typeof b==='string')return b;
 const s=a.slots[a.i],t=b.slots[b.i];if(!s)return 'Слот пуст';if(!isTank(s))return 'Это не баллон';if(t&&!isTank(t))return 'Освободите ячейку';
 a.slots[a.i]=t;b.slots[b.i]=s;return '';
}
/** Tap on a worn tank in the generator window: into the charging slot, swapping with a tank that is charging there. */
export const chargeWornTank=(g:GameState,id:string,b:0|1)=>moveTank(g,{kind:'worn',b},{kind:'station',id});
/** The worn slot a charged tank goes to: the first empty one, otherwise the worn tank holding less gas. */
export const wearSlot=(g:GameState):0|1=>{const [a,c]=g.player.bottles;return !a?0:!c?1:(c.milliGU??0)<(a.milliGU??0)?1:0;};
/** Tap on the charging slot: the tank goes straight onto the suit (see wearSlot). */
export const wearStationTank=(g:GameState,id:string)=>moveTank(g,{kind:'station',id},{kind:'worn',b:wearSlot(g)});
/** True when this move would take the player's last breathable gas off the suit right now (survival tankGap). */
export function moveTankGap(g:GameState,insideCapsule:boolean,from:TankPlace,to:TankPlace):boolean{
 if(from.kind==='worn'&&to.kind==='worn')return false;
 const worn=from.kind==='worn'?from:to.kind==='worn'?to:null;if(!worn)return false;
 return tankGap(g,insideCapsule,worn.b,tankAt(g,worn===from?to:from));
}
