import { addItems, firstEmpty, type Slot } from './inventory';
import { insideDome, machine, type Building } from './production';
import type { GameState } from './state';
/** Packing and all link refunds are atomic: a full backpack leaves the world unchanged. */
export function packStation(g:GameState,id:string):string{
 const b=machine(g,id);if(!b||Math.hypot(g.player.x-b.x,g.player.z-b.z)>3.2)return 'Подойдите к станции';
 if(g.world.base.passage?.domeId===id||insideDome(b,g.player.x,g.player.y,g.player.z))return 'Сначала выйдите из купола';
 if(b.kind==='dome'&&g.world.base.buildings.some(v=>v!==b&&insideDome(b,v.x,v.y,v.z)))return 'Сначала заберите станции внутри купола';
 const inv=structuredClone(g.player.inventory),at=firstEmpty(inv);if(at<0)return 'Освободите ячейку в рюкзаке';
 const {id:oldId,x,y,z,...packed}=structuredClone(b);inv[at]={itemId:b.kind,count:1,packed};
 const links=g.world.base.links.filter(l=>l.from===id||l.to===id);for(const l of links)if(addItems(inv,l.kind,1))return 'Нет места для кабелей и труб';
 g.player.inventory=inv;g.world.base.links=g.world.base.links.filter(l=>!links.includes(l));g.world.base.buildings=g.world.base.buildings.filter(v=>v!==b);return '';
}
/** Loading a dedicated machine transfers a real stack, never makes an extra bottle. */
export function loadMachineSlot(g:GameState,id:string,index:number):string{
 const b=machine(g,id),s=g.player.inventory[index];if(!b||!s||Math.hypot(b.x-g.player.x,b.z-g.player.z)>3.2)return 'Подойдите к станции';
 let target=-1;
 if(b.kind==='biogenerator')target=s.itemId==='fiber'?0:-1;
 if(b.kind==='kiln')target=s.itemId==='fiber'?1:['iron_raw','copper_raw','sand','ice'].includes(s.itemId)?0:-1;
 if(b.kind==='electrolyzer')target=s.itemId==='water'?0:s.itemId==='bottle_1'?1:-1;
 if(target<0)return 'Этот предмет сюда не подходит';const old=b.input[target];
 if(old&&old.itemId===s.itemId&&s.milliGU===undefined){const n=Math.min(64-old.count,s.count);if(!n)return 'Слот полон';old.count+=n;s.count-=n;if(!s.count)g.player.inventory[index]=null;}else{b.input[target]=s;g.player.inventory[index]=old;}
 return '';
}
export function takeSlot(g:GameState,slots:Slot[],index:number):string{
 const s=slots[index];if(!s)return 'Слот пуст';const inv=structuredClone(g.player.inventory);
 if(s.milliGU!==undefined||s.durability!==undefined||s.packed){const at=firstEmpty(inv);if(at<0)return 'Рюкзак полон';inv[at]=structuredClone(s);}else if(addItems(inv,s.itemId,s.count))return 'Рюкзак полон';
 g.player.inventory=inv;slots[index]=null;return '';
}
