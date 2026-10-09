import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newGame,sanitizeState,STATE_VERSION} from '../src/game/state';
import {addItems,removeItems,countItem} from '../src/game/inventory';
import {makeBuilding,startJob,productionTick,connect,cancelJob,WORKBENCH_UPGRADE,RECIPE_BY_ID,releaseHandOnDeath} from '../src/game/production';
import {refreshQuestProgress,questStatus} from '../src/game/quests';
import {QUESTS,QUEST_IDS,QUEST_ROUTES} from '../src/game/questCatalog';
import {QUEST_FACTS,recordQuestFact} from '../src/game/questFacts';
import {encodePages,decodePages} from '../src/persist/pages';
const fresh=()=>newGame('w-quests',123,1,0);
const stock=(g:ReturnType<typeof fresh>,items:Record<string,number>)=>{for(const [id,n] of Object.entries(items))assert.equal(addItems(g.player.inventory,id,n),0);};
const tick=(g:ReturnType<typeof fresh>,ms:number,id:string|null=null)=>{for(let i=0;i<ms;i+=50)productionTick(g,50,id);refreshQuestProgress(g);};
function powered(){const g=fresh();g.player.x=42;g.player.z=42;const b=makeBuilding(g,'workbench',42,0,42);b.level=2;const gen=makeBuilding(g,'biogenerator',44,0,42);stock(g,{copper:4,cable:1});connect(g,'cable',gen.id,b.id);return {g,b,gen};}
test('Quest DAG covers every current recipe and has forward links, no fictitious recipes or cycles',()=>{
 assert.equal(new Set(QUESTS.map(q=>q.id)).size,QUEST_IDS.length);const byId=new Map(QUESTS.map(q=>[q.id,q]));
 for(const q of QUESTS){for(const p of [...q.parents,...q.context]){assert.ok(byId.has(p));assert.ok(byId.get(p)!.x<q.x);}for(const rid of q.recipes)assert.ok(rid==='upgrade'||RECIPE_BY_ID.has(rid));for(const p of q.parents)assert.ok(QUEST_ROUTES.some(r=>r.from===p&&r.to===q.id));}
 for(const rid of RECIPE_BY_ID.keys())if(rid!=='legacy_melt')assert.ok(QUESTS.some(q=>q.recipes.includes(rid)),rid);
 assert.equal(WORKBENCH_UPGRADE.queueCapacity,5);
});
test('Fresh expedition has no completed spare-tool/refill achievement from starter equipment',()=>{
 const g=fresh();refreshQuestProgress(g);assert.deepEqual(g.progress.quests.completed,[]);assert.equal(questStatus(g,'materials'),'ready');assert.equal(questStatus(g,'tool'),'locked');assert.equal(questStatus(g,'refill'),'locked');assert.equal(g.progress.quests.tracked,null);
});
test('Observed materials remain credited after spending, death, page save and reopening the book',()=>{
 const g=fresh();stock(g,{stone:8,grass:1});refreshQuestProgress(g);startJob(g,'grass_parts');tick(g,1000);assert.ok(g.progress.quests.completed.includes('materials'));removeItems(g.player.inventory,'stone',8);removeItems(g.player.inventory,'fiber',2);g.player.vitals.health=0;const reloaded=decodePages(encodePages(g));refreshQuestProgress(reloaded);assert.equal(questStatus(reloaded,'materials'),'done');const before=structuredClone(reloaded);assert.equal(refreshQuestProgress(reloaded),false);assert.deepEqual(reloaded,before);
});
test('Cancelled or blocked crafts never count as a manufactured spare tool; finished death cargo does',()=>{
 const g=fresh();stock(g,{stone:4,fiber:2});startJob(g,'craft_tool_stone');tick(g,1000);cancelJob(g);assert.ok(!g.progress.quests.facts.includes('craft:craft_tool_stone'));startJob(g,'craft_tool_stone');g.player.inventory=Array.from({length:24},()=>({itemId:'stone',count:64}));tick(g,8000);assert.ok(g.world.base.hand);assert.ok(!g.progress.quests.completed.includes('tool'));releaseHandOnDeath(g);refreshQuestProgress(g);assert.ok(g.progress.quests.completed.includes('tool'));assert.equal(g.world.drops[0].items[0].itemId,'tool_stone');
});
test('Old placed machines reconstruct spent prerequisites without inventing unattended work or refill',()=>{
 const {g,b}=powered();g.meta.stateVersion=4;g.world.base.buildings[1].energy=12000;const old=structuredClone(g);delete (old.progress as any).quests;const migrated=sanitizeState(old);assert.deepEqual(migrated.world.base,old.world.base);refreshQuestProgress(migrated);for(const id of ['materials','bench','metals','glass','wrench','circuit','bench2','generator'] as const)assert.ok(migrated.progress.quests.completed.includes(id),id);
 assert.ok(!migrated.progress.quests.completed.includes('auto'));assert.ok(!migrated.progress.quests.completed.includes('refill'));assert.equal(migrated.meta.stateVersion,STATE_VERSION);assert.equal(old.meta.stateVersion,4);assert.equal(b.level,2);
});
test('Fuelled isolated generator and idle cable do not count as a working energy network',()=>{
 const {g,b,gen}=powered();gen.energy=400000;tick(g,1000);assert.ok(!g.progress.quests.completed.includes('power'));startJob(g,'craft_wire',b.id);g.world.base.links=[];tick(g,1000);assert.equal(b.job!.workMs,0);assert.ok(!g.progress.quests.completed.includes('power'));stock(g,{cable:1});connect(g,'cable',gen.id,b.id);tick(g,50);assert.ok(g.progress.quests.completed.includes('power'));
});
test('Unattended automation requires actual output; blocked or unpowered work never completes it',()=>{
 const {g,b,gen}=powered();g.player.x=80;startJob(g,'craft_wire',b.id,true); // buffered start without inputs is rejected
 g.player.x=42;assert.equal(startJob(g,'craft_wire',b.id),'');g.player.x=80;tick(g,1000);assert.ok(!g.progress.quests.completed.includes('auto'));gen.energy=400000;b.output=Array.from({length:4},()=>({itemId:'stone',count:64}));tick(g,8000);assert.ok(!g.progress.quests.completed.includes('auto'));b.output[0]=null;tick(g,50);assert.equal(countItem(b.output,'wire'),4);assert.ok(g.progress.quests.completed.includes('auto'));
});
test('A nearby automated craft does not satisfy the away-from-station goal',()=>{
 const {g,b,gen}=powered();gen.energy=400000;startJob(g,'craft_wire',b.id);tick(g,8000);assert.ok(!g.progress.quests.completed.includes('auto'));assert.ok(g.progress.quests.completed.includes('power'));
});
test('Electrolysis credits actual production without requiring workbench II',()=>{
 const g=fresh();g.player.x=42;g.player.z=42;const e=makeBuilding(g,'electrolyzer',42,0,42),gen=makeBuilding(g,'biogenerator',44,0,42);e.water=1000;stock(g,{cable:1});connect(g,'cable',gen.id,e.id);startJob(g,'electrolysis',e.id);tick(g,1000);assert.ok(!g.progress.quests.completed.includes('oxygen'));gen.energy=400000;tick(g,10000);assert.ok(g.progress.quests.completed.includes('oxygen'));assert.ok(!g.progress.quests.completed.includes('bench2'));
});
test('Refill achievement requires station gas, power and real tank transfer; starter/full tank does not count',()=>{
 const g=fresh();g.player.x=42;g.player.z=42;const r=makeBuilding(g,'refill',42,0,42),gen=makeBuilding(g,'biogenerator',44,0,42);r.oxygen=240000;stock(g,{cable:1});connect(g,'cable',gen.id,r.id);gen.energy=400000;tick(g,50,r.id);assert.ok(!g.progress.quests.completed.includes('refill'));g.player.bottles[0]!.milliGU=0;gen.energy=0;tick(g,50,r.id);assert.ok(!g.progress.quests.completed.includes('refill'));gen.energy=400000;tick(g,50,r.id);assert.ok(g.progress.quests.completed.includes('refill'));
});
test('Breathable shelter checks seal, gas, purity and temperature; completed goal survives a later breach',()=>{
 for(const field of ['gas','purity','temperature','seal']){const g=fresh(),d=makeBuilding(g,'dome',50,0,50);d.zone.q=384000;d.zone.purity=.5;d.zone.temperature=20;if(field==='gas')d.zone.q=383999;if(field==='purity')d.zone.purity=.49;if(field==='temperature')d.zone.temperature=41;if(field==='seal')d.zone.shell[0]=0;refreshQuestProgress(g);assert.ok(!g.progress.quests.completed.includes('air'),field);}
 const g=fresh(),d=makeBuilding(g,'dome',50,0,50);d.zone.q=384000;d.zone.purity=.5;d.zone.temperature=20;refreshQuestProgress(g);assert.ok(g.progress.quests.completed.includes('air'));d.zone.shell[0]=0;refreshQuestProgress(g);assert.equal(questStatus(g,'air'),'done');
});
test('Final milestone checks simultaneous real work, rather than two historical checkmarks',()=>{
 const {g,b,gen}=powered();g.player.x=80;gen.energy=400000;startJob(g,'craft_wire',b.id,true);g.player.x=42;startJob(g,'craft_wire',b.id);g.player.x=80;tick(g,8000);const d=makeBuilding(g,'dome',50,0,50);d.zone.q=500000;d.zone.purity=1;d.zone.temperature=20;refreshQuestProgress(g);assert.ok(g.progress.quests.completed.includes('auto'));assert.ok(g.progress.quests.completed.includes('air'));assert.ok(!g.progress.quests.completed.includes('base'));g.player.x=42;startJob(g,'craft_wire',b.id);g.player.x=80;gen.energy=0;tick(g,50);assert.ok(!g.progress.quests.completed.includes('base'));gen.energy=400000;tick(g,50);assert.ok(g.progress.quests.completed.includes('base'));
});
test('v4 queues, WIP, tank gas and quest evidence survive current round trip; untrusted quest data is strict',()=>{
 const {g,b}=powered();startJob(g,'craft_wire',b.id);const old:any=structuredClone(g);old.meta.stateVersion=4;delete old.progress.quests;const migrated=sanitizeState(old);assert.deepEqual(migrated.world.base,g.world.base);assert.deepEqual(migrated.player,g.player);recordQuestFact(migrated,'item:stone');refreshQuestProgress(migrated);assert.deepEqual(decodePages(encodePages(migrated)),migrated);
 for(const patch of [{tracked:'constructor'},{completed:['air','air']},{facts:['system:free_power']},{facts:['item:stone','item:stone']},{facts:Array(QUEST_FACTS.size+1).fill('item:stone')}]){const bad:any=structuredClone(migrated);Object.assign(bad.progress.quests,patch);assert.throws(()=>sanitizeState(bad),/quests/);}
 const bad:any=structuredClone(migrated);delete bad.progress.quests;assert.throws(()=>sanitizeState(bad),/quests/);
});
