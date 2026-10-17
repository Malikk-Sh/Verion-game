import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newGame,sanitizeState} from '../src/game/state';
import {addItems,countItem} from '../src/game/inventory';
import {makeBuilding,queueJob,startJob,productionTick,upgradeBuilding,loadRecipeInputs,collectInput,collectOutput,connect,cancelJob,removeQueuedJob,craftOwner,RECIPE_BY_ID,GEN_BUFFER,WORKBENCH_UPGRADE} from '../src/game/production';
import {refreshQuestProgress} from '../src/game/quests';
const fresh=()=>newGame('w-crafting',123,1,0);
const stock=(g:ReturnType<typeof fresh>,items:Record<string,number>)=>{for(const [id,n] of Object.entries(items))assert.equal(addItems(g.player.inventory,id,n),0);};
const tick=(g:ReturnType<typeof fresh>,ms:number)=>{for(let i=0;i<ms;i+=50)productionTick(g,50);};
const setup=()=>{const g=fresh();g.player.x=42;g.player.z=42;const b=makeBuilding(g,'workbench',42,0,42);return {g,b};};
const equip=(g:ReturnType<typeof fresh>)=>{g.player.inventory[1]={itemId:'wrench',count:1};g.player.hotbar=1;};
test('Pocket and workbench I reject queues without taking any inputs',()=>{
 const {g,b}=setup();stock(g,{grass:5,copper:5});const before=structuredClone(g.player.inventory);assert.match(queueJob(g,'grass_parts'),/улучшения/);assert.match(queueJob(g,'craft_wire',b.id),/улучшения/);assert.deepEqual(g.player.inventory,before);assert.equal(startJob(g,'craft_wire'), 'Нужна подходящая станция');
 assert.equal(startJob(g,'grass_parts'),'');assert.match(startJob(g,'grass_parts'),/текущую/);tick(g,1000);assert.equal(countItem(g.player.inventory,'fiber'),2);assert.equal(countItem(g.player.inventory,'grass'),4);
});
test('Workbench I pauses away, resumes near; only one nearby bench uses the player hands',()=>{
 const {g,b}=setup();stock(g,{copper:3});assert.equal(startJob(g,'craft_wire',b.id),'');tick(g,1000);g.player.x=80;tick(g,8000);assert.equal(b.job?.workMs,1000);assert.match(startJob(g,'craft_wire',b.id,true),/текущую/);
 g.player.x=42;const second=makeBuilding(g,'workbench',44,0,42);assert.equal(startJob(g,'craft_wire',second.id),'');tick(g,1000);assert.equal(b.job!.workMs,2000);assert.equal(second.job!.workMs,0);tick(g,6000);assert.equal(countItem(b.output,'wire'),4);assert.equal(second.job!.workMs,0);tick(g,8000);assert.equal(countItem(second.output,'wire'),4);
});
test('A pocket recipe that does not fit the four bench II output slots (dismantle_dome) stays in the pocket',()=>{
 const {g,b}=setup();equip(g);stock(g,{...WORKBENCH_UPGRADE.inputs,cable:1});upgradeBuilding(g,b.id);const gen=makeBuilding(g,'biogenerator',44,0,42);gen.energy=GEN_BUFFER;connect(g,'cable',gen.id,b.id);
 // 64 glass blocks (stack 16 = 4 slots) + 1 airlock need 5 slots: on the bench the batch finished but could never be delivered.
 g.player.inventory[1]=null;stock(g,{dome:1});const r=RECIPE_BY_ID.get('dismantle_dome')!;assert.equal(craftOwner(g,b,r),'hand');assert.equal(craftOwner(g,b,RECIPE_BY_ID.get('grass_parts')!),b.id);
 assert.equal(queueJob(g,'dismantle_dome',b.id,1),'Неверная очередь');assert.equal(startJob(g,'dismantle_dome',b.id),'Нужна подходящая станция');assert.equal(countItem(g.player.inventory,'dome'),1);
 assert.equal(startJob(g,'dismantle_dome',craftOwner(g,b,r)),'');tick(g,2100);assert.equal(g.world.base.hand,null);assert.equal(b.job,null);
 assert.equal(countItem(g.player.inventory,'window'),64);assert.equal(countItem(g.player.inventory,'airlock'),1);assert.equal(countItem(g.player.inventory,'dome'),0);
 const bad:any=structuredClone(g);bad.world.base.buildings.find((v:any)=>v.id===b.id).queue=['dismantle_dome'];assert.throws(()=>sanitizeState(bad),/рецепт/);
});
test('Filling inputs is atomic and moves only deficits; cancellation and returning buffers conserve items',()=>{
 const {g,b}=setup();stock(g,{iron:4,copper:1});assert.equal(loadRecipeInputs(g,'craft_wrench',b.id),'');assert.equal(loadRecipeInputs(g,'craft_wrench',b.id),'');assert.equal(countItem(b.input,'iron'),4);assert.equal(startJob(g,'craft_wrench',b.id,true),'');tick(g,1500);assert.equal(cancelJob(g,b.id),'');assert.equal(countItem(g.player.inventory,'iron'),4);assert.equal(countItem(b.input,'iron'),0);
 b.input=Array.from({length:4},()=>({itemId:'stone',count:64}));const before=structuredClone(g);assert.match(loadRecipeInputs(g,'craft_wrench',b.id),/полон/);assert.deepEqual(g,before);b.input=[{itemId:'copper',count:1},null,null,null];assert.equal(collectInput(g,b.id),1);
});
test('Paid wrench is crafted on workbench I; upgrade needs selected reusable wrench and preserves buffers',()=>{
 const {g,b}=setup();stock(g,{iron:10,copper:1,wire:4,circuit:1});assert.equal(startJob(g,'craft_wrench',b.id),'');tick(g,8000);assert.equal(countItem(b.output,'wrench'),1);collectOutput(g,b.id);
 assert.match(upgradeBuilding(g,b.id),/Выберите/);const i=g.player.inventory.findIndex(s=>s?.itemId==='wrench');assert.ok(i<6);g.player.hotbar=i;b.input[0]={itemId:'copper',count:2};assert.equal(upgradeBuilding(g,b.id),'');assert.equal(b.level,2);assert.equal(countItem(g.player.inventory,'iron'),0);assert.equal(countItem(g.player.inventory,'wrench'),1);assert.equal(countItem(b.input,'copper'),2);const before=structuredClone(g);assert.match(upgradeBuilding(g,b.id),/уже/);assert.deepEqual(g,before);assert.deepEqual(sanitizeState(g),g);
});
test('Invalid upgrade (missing resources, distance or active job) never pays partly',()=>{
 const {g,b}=setup();equip(g);stock(g,{iron:6,wire:4});let before=structuredClone(g);assert.match(upgradeBuilding(g,b.id),/Не хватает/);assert.deepEqual(g,before);stock(g,{circuit:1,copper:1});startJob(g,'craft_wire',b.id);before=structuredClone(g);assert.match(upgradeBuilding(g,b.id),/работу/);assert.deepEqual(g,before);cancelJob(g,b.id);g.player.x=80;before=structuredClone(g);assert.match(upgradeBuilding(g,b.id),/Подойдите/);assert.deepEqual(g,before);
});
test('Workbench II queue counts active batch; uses finite 4 EU/s, stalls without power and works away',()=>{
 const {g,b}=setup();equip(g);stock(g,{...WORKBENCH_UPGRADE.inputs,copper:6,cable:1});assert.equal(upgradeBuilding(g,b.id),'');assert.equal(queueJob(g,'craft_wire',b.id,5),'');tick(g,1000);assert.equal(b.job?.workMs,0);assert.equal(b.queue.length,4);const before=structuredClone(g);assert.match(queueJob(g,'craft_wire',b.id,1),/максимум/);assert.deepEqual(g,before);
 const gen=makeBuilding(g,'biogenerator',44,0,42);gen.energy=400000;assert.equal(connect(g,'cable',gen.id,b.id),'');g.player.x=80;tick(g,8000);assert.equal(countItem(b.output,'wire'),4);assert.equal(gen.energy,368000);tick(g,32000);assert.equal(countItem(b.output,'wire'),20);assert.equal(b.job,null);assert.equal(gen.energy,240000);tick(g,1000);assert.equal(gen.energy,240000,'idle costs nothing');assert.deepEqual(sanitizeState(g),g);
});
test('Queue reuses buffered deficits but cannot pledge the same inputs to two batches',()=>{
 const {g,b}=setup();equip(g);stock(g,{...WORKBENCH_UPGRADE.inputs,copper:3});upgradeBuilding(g,b.id);loadRecipeInputs(g,'craft_wire',b.id);assert.equal(queueJob(g,'craft_wire',b.id,1),'');assert.equal(countItem(g.player.inventory,'copper'),2);assert.equal(queueJob(g,'craft_wire',b.id,2),'');assert.equal(countItem(b.input,'copper'),3);assert.equal(countItem(g.player.inventory,'copper'),0);
});
test('Removing one waiting batch retains paid stock and active work; invalid or distant removal changes nothing',()=>{
 const {g,b}=setup();equip(g);stock(g,{...WORKBENCH_UPGRADE.inputs,copper:3});upgradeBuilding(g,b.id);queueJob(g,'craft_wire',b.id,3);tick(g,50);
 const active=structuredClone(b.job),input=structuredClone(b.input),inventory=structuredClone(g.player.inventory);assert.equal(removeQueuedJob(g,b.id,1),'');assert.equal(b.queue.length,1);assert.deepEqual(b.job,active);assert.deepEqual(b.input,input);assert.deepEqual(g.player.inventory,inventory);assert.deepEqual(sanitizeState(g),g);
 for(const index of [-1,1,.5,NaN]){const before=structuredClone(g);assert.match(removeQueuedJob(g,b.id,index),/Нет такой партии/);assert.deepEqual(g,before);}
 g.player.x=80;const before=structuredClone(g);assert.match(removeQueuedJob(g,b.id,0),/Подойдите/);assert.deepEqual(g,before);g.player.x=42;assert.equal(removeQueuedJob(g,b.id,0),'');assert.equal(collectInput(g,b.id),2);assert.equal(countItem(g.player.inventory,'copper'),2);cancelJob(g,b.id);assert.equal(countItem(g.player.inventory,'copper'),3);
});
test('Version 3 migration retires manual queues without losing WIP, stock or outputs; current corruption fails',()=>{
 const {g,b}=setup();stock(g,{copper:2});startJob(g,'craft_wire',b.id);tick(g,2000);b.input[0]={itemId:'copper',count:3};b.output[0]={itemId:'wire',count:4};const old:any=structuredClone(g);old.meta.stateVersion=3;delete old.world.base.buildings[0].level;old.world.base.buildings[0].queue=['craft_wire','craft_wire'];old.world.base.handQueue=['grass_parts'];const migrated=sanitizeState(old);assert.equal(migrated.meta.stateVersion,10);const result=migrated.world.base.buildings[0];assert.equal(result.level,1);assert.deepEqual(result.job,b.job);assert.deepEqual(result.input,b.input);assert.deepEqual(result.output,b.output);assert.deepEqual(result.queue,[]);assert.deepEqual(migrated.world.base.handQueue,[]);assert.equal(old.world.base.buildings[0].queue.length,2);
 const missingGas:any=structuredClone(old);delete missingGas.world.capsuleMilliGU;assert.throws(()=>sanitizeState(missingGas),/capsuleMilliGU/);const missingBase:any=structuredClone(old);delete missingBase.world.base;assert.throws(()=>sanitizeState(missingBase),/world.base/);
 const bad:any=structuredClone(migrated);bad.world.base.buildings[0].queue=['craft_wire'];assert.throws(()=>sanitizeState(bad),/очередь/);bad.world.base.buildings[0].queue=[];delete bad.world.base.buildings[0].level;assert.throws(()=>sanitizeState(bad),/level/);bad.world.base.buildings[0].level=1;bad.world.base.handQueue=['grass_parts'];assert.throws(()=>sanitizeState(bad),/недоступна/);
});
test('Full output holds one completed batch through reload; removing power cannot add free progress',()=>{
 const {g,b}=setup();equip(g);stock(g,{...WORKBENCH_UPGRADE.inputs,copper:1,cable:1});upgradeBuilding(g,b.id);const gen=makeBuilding(g,'biogenerator',44,0,42);gen.energy=16000;connect(g,'cable',gen.id,b.id);startJob(g,'craft_wire',b.id);tick(g,4000);assert.equal(b.job!.workMs,4000);tick(g,4000);assert.equal(b.job!.workMs,4000);gen.energy=16000;b.output=Array.from({length:4},()=>({itemId:'stone',count:64}));tick(g,4000);assert.equal(b.job!.workMs,8000);const reloaded=sanitizeState(g);tick(reloaded,1000);assert.equal(reloaded.world.base.buildings[0].job!.workMs,8000);b.output[0]=null;tick(g,50);assert.equal(countItem(b.output,'wire'),4);assert.equal(b.job,null);assert.equal(gen.energy,0);
});
test('Workbench II runs pocket recipes (grass -> fiber) away from the player and counts the autonomous batch',()=>{
 const {g,b}=setup();equip(g);stock(g,{...WORKBENCH_UPGRADE.inputs,grass:30,cable:1});upgradeBuilding(g,b.id);const gen=makeBuilding(g,'biogenerator',44,0,42);gen.energy=GEN_BUFFER;connect(g,'cable',gen.id,b.id);
 // S4 bug: the bench II window sent the pocket recipe to the pocket (30 batches of fiber in the hands), so no batch was ever made "without you".
 const grass=RECIPE_BY_ID.get('grass_parts')!;assert.equal(craftOwner(g,b,grass),b.id);assert.equal(craftOwner(g,undefined,grass),'hand');assert.equal(queueJob(g,'grass_parts',b.id,5),'');assert.equal(g.world.base.hand,null);assert.equal(countItem(b.input,'grass'),5);
 g.player.x=80;tick(g,1100);refreshQuestProgress(g);assert.ok(g.progress.quests.facts.includes('system:auto'));assert.equal(countItem(b.output,'fiber'),2);assert.equal(countItem(b.output,'pulp'),1);assert.deepEqual(sanitizeState(g),g);
 tick(g,5000);assert.equal(countItem(b.output,'fiber'),10);assert.equal(b.queue.length,0);assert.equal(b.job,null);
 // Bench I keeps pocket recipes in the pocket; no other station accepts them.
 const one=makeBuilding(g,'workbench',46,0,42),kiln=makeBuilding(g,'kiln',48,0,42);assert.equal(craftOwner(g,one,grass),'hand');assert.equal(craftOwner(g,one,RECIPE_BY_ID.get('craft_wire')!),one.id);assert.equal(craftOwner(g,kiln,grass),'hand');
 g.player.x=46;assert.equal(startJob(g,'grass_parts',one.id),'Нужна подходящая станция');g.player.x=48;assert.equal(startJob(g,'grass_parts',kiln.id),'Нужна подходящая станция');
 const bad:any=structuredClone(g);bad.world.base.buildings.find((v:any)=>v.id===one.id).queue=['grass_parts'];assert.throws(()=>sanitizeState(bad),/рецепт/);
});
test('Next to an unpowered (or switched-off) bench II, pocket recipes stay in the pocket; power sends them to the queue',()=>{
 const {g,b}=setup();equip(g);stock(g,{...WORKBENCH_UPGRADE.inputs,grass:6,cable:1});upgradeBuilding(g,b.id);const grass=RECIPE_BY_ID.get('grass_parts')!;
 // No cable: the queue could never run, so the window keeps the pocket (S5 review: grass went into the bench and fiber never came).
 assert.equal(craftOwner(g,b,grass),'hand');assert.equal(craftOwner(g,b,RECIPE_BY_ID.get('craft_wire')!),b.id);assert.equal(startJob(g,'grass_parts',craftOwner(g,b,grass)),'');tick(g,1100);assert.equal(countItem(g.player.inventory,'fiber'),2);assert.equal(countItem(b.input,'grass'),0);
 // A cable to an empty generator is still no power; fiber in its input is (it burns it on the next tick).
 const gen=makeBuilding(g,'biogenerator',44,0,42);connect(g,'cable',gen.id,b.id);assert.equal(craftOwner(g,b,grass),'hand');
 gen.input[0]={itemId:'fiber',count:1};assert.equal(craftOwner(g,b,grass),b.id);gen.input[0]=null;gen.energy=GEN_BUFFER;assert.equal(craftOwner(g,b,grass),b.id);
 // A leftover too small for one batch (and nothing to burn) keeps the recipe in the pocket: the batch would stall holding the fiber.
 const need=WORKBENCH_UPGRADE.EU_per_second*grass.seconds*1000;gen.energy=need-1;assert.equal(craftOwner(g,b,grass),'hand');gen.energy=need;assert.equal(craftOwner(g,b,grass),b.id);gen.energy=GEN_BUFFER;
 b.enabled=false;assert.equal(craftOwner(g,b,grass),'hand');gen.enabled=false;b.enabled=true;assert.equal(craftOwner(g,b,grass),'hand');
});
