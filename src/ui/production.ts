import { createCraftingView } from './crafting';
import { machine } from '../game/production';
import { ITEMS } from '../game/defs';
import type { GameState } from '../game/state';
import { machineView,tickMachine } from './machines';
import './production.css';
import './crafting-layout.css';
type Host = { game(): GameState|null; show(): void; close(): void; changed():void; refill(id:string|null):void; tone(ok:boolean):void };
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
export function createProductionPanel(host:Host){
 const crafting=createCraftingView();let station='hand',message='';
 const say=(reason:string,success='Готово')=>{message=reason||success;host.tone(!reason);if(!reason)host.changed();draw();};
 function open(id='hand',upgrade=false){station=id;host.refill(null);crafting.open(id,upgrade);message='';host.show();draw();}
 el('close-production').onclick=()=>{host.refill(null);host.close();};
 function draw(){const g=host.game();if(!g)return;const focus=document.activeElement as HTMLInputElement|null,search=focus?.id==='craft-search',cursor=search?[focus.selectionStart,focus.selectionEnd]:null;
  const b=machine(g,station),craft=station==='hand'||b?.kind==='workbench',panel=el('production-panel'),content=el('production-content');content.replaceChildren();panel.classList.toggle('crafting-panel',craft);panel.classList.toggle('machine-panel',!craft);panel.classList.remove('craft-upgrade-panel');el('production-message').textContent=message;
  panel.querySelector('h2')!.textContent=station==='hand'?'Крафт · В кармане':b?.kind==='workbench'?'Крафт · Верстак '+(b.level===2?'II':'I'):station==='capsule'?'Капсула · Заправка':station.startsWith('crate-')?'Хранилище':b?ITEMS[b.kind].name:'Станция';
  if(craft){const view=crafting.draw(g,station,say,host.changed,draw);content.append(view);panel.classList.toggle('craft-upgrade-panel',view.dataset.mode==='upgrade');if(view.dataset.mode==='upgrade')panel.querySelector('h2')!.textContent='Улучшение · Верстак';if(search){const input=el<HTMLInputElement>('craft-search');if(input){input.focus({preventScroll:true});input.setSelectionRange(cursor![0]??0,cursor![1]??0);}}}
  else content.append(machineView(g,station,say,host.changed,draw,host.refill));tick();
 }
 function tick(){const g=host.game();if(!g)return;const b=machine(g,station);if(station==='hand'||b?.kind==='workbench')crafting.tick(g,station);else tickMachine(g,station);}
 return {open,openUpgrade:(id:string)=>open(id,true),draw,tick,clear:()=>host.refill(null)};
}
