import { NODES } from './resources';
import { RECIPES, WORKBENCH_UPGRADE } from './production';
import { allRooms, habitableRoom, roomDoors, stationRoom } from './rooms';
import { recordQuestFact } from './questFacts';
import { countItem } from './inventory';
import { QUESTS, QUEST_BY_ID, type QuestId } from './questCatalog';
import type { GameState } from './state';

export const questParents = (id: QuestId) => { const q=QUEST_BY_ID.get(id)!;return [...q.parents,...q.context]; };
export function questStatus(g: GameState, id: QuestId): 'done' | 'ready' | 'locked' {
 const done=g.progress.quests.completed;
 return done.includes(id)?'done':questParents(id).every(p=>done.includes(p))?'ready':'locked';
}
/** Reconstruct only evidence still present in old worlds; opening the book is never required. */
export function refreshQuestProgress(g: GameState): boolean {
 let changed=false;
 const observed=new Set<string>();
 const starterItems=new Set(['tool_stone','bottle_1','pulp']);
 const see=(id:string)=>{if(observed.has(id))return;observed.add(id);changed=recordQuestFact(g,'item:'+id)||changed;
  // A component proves its necessary materials. Starter equipment does not.
  if(!starterItems.has(id)){const source=RECIPES.find(r=>r.outputs[id]);if(source)for(const input of Object.keys(source.inputs))if(input!=='water')see(input);}
 };
 const slots=[...g.player.inventory,...g.player.bottles,...g.world.drops.flatMap(d=>d.items),...g.world.base.buildings.flatMap(b=>[...b.input,...b.output,...(b.job?.reserved??[])]),...(g.world.base.hand?.reserved??[])];
 for(const s of slots)if(s)see(s.itemId);
 for(const n of NODES)if(g.world.nodes[n.id]<n.amount)see(n.itemId);
 for(const b of g.world.base.buildings){
  // A placed body proves that its canonical construction inputs were paid.
  const recipe=RECIPES.find(r=>r.outputs[b.kind]);
  if(recipe)for(const id of Object.keys(recipe.inputs))see(id);
  if(b.kind==='workbench'&&b.level===2){see('wrench');for(const id of Object.keys(WORKBENCH_UPGRADE.inputs))see(id);}
 }
 // Placed glass blocks and airlocks are paid pieces too (S4).
 if(g.world.base.glass.length)see('window');if(g.world.base.doors.length)see('airlock');
 const has=(kind:string)=>g.world.base.buildings.some(b=>b.kind===kind);
 const fact=(f:string)=>g.progress.quests.facts.includes(f);
 const item=(id:string)=>fact('item:'+id);
 const oxygenEvidence=g.world.base.buildings.some(b=>b.oxygen>0)||g.world.base.zones.some(z=>z.q>0),rooms=allRooms(g);
 const waterEvidence=g.world.base.buildings.some(b=>b.kind==='electrolyzer'&&b.water>0);
 if(oxygenEvidence)changed=recordQuestFact(g,'craft:electrolysis')||changed;
 if(oxygenEvidence||waterEvidence||g.world.base.zones.some(z=>z.purity>0))changed=recordQuestFact(g,'system:power')||changed;
 if(slots.filter(s=>s?.itemId==='tool_stone').length>=2)changed=recordQuestFact(g,'craft:craft_tool_stone')||changed;
 const achieved: Record<QuestId, boolean> = {
  // The first step asks for exactly what the workbench costs (the journal's counters), or a bench already standing.
  materials:has('workbench')||item('stone')&&item('fiber')&&countItem(g.player.inventory,'stone')>=8&&countItem(g.player.inventory,'fiber')>=4, bench:has('workbench'), tool:fact('craft:craft_tool_stone'), kiln:has('kiln'),
  metals:item('iron')&&item('copper'),glass:item('glass'),wrench:item('wrench'),circuit:item('circuit'),
  generator:has('biogenerator'),electrolyzer:has('electrolyzer'),
  // S4: the shelter is a closed glass room with an airlock on its boundary.
  dome:rooms.some(r=>roomDoors(g,r).length>0),
  bench2:g.world.base.buildings.some(b=>b.kind==='workbench'&&b.level===2),
  power:fact('system:power'),distributor:g.world.base.buildings.some(b=>b.kind==='distributor'&&!!stationRoom(g,b)),auto:fact('system:auto'),
  oxygen:fact('craft:electrolysis'),refill:fact('system:refill'),air:rooms.some(habitableRoom),
  base:fact('system:base'),
 };
 // Actual achievements count independently of the suggested order. Costs never gate quests.
 for(const q of QUESTS)if(achieved[q.id]&&!g.progress.quests.completed.includes(q.id)){g.progress.quests.completed.push(q.id);changed=true;}
 return changed;
}
