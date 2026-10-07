import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newGame,sanitizeState} from '../src/game/state';
import {addItems,countItem} from '../src/game/inventory';
import {makeBuilding,queueJob,startJob,productionTick,upgradeBuilding,loadRecipeInputs,collectInput,collectOutput,connect,cancelJob,WORKBENCH_UPGRADE} from '../src/game/production';
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
test('Version 3 migration retires manual queues without losing WIP, stock or outputs; current corruption fails',()=>{
 const {g,b}=setup();stock(g,{copper:2});startJob(g,'craft_wire',b.id);tick(g,2000);b.input[0]={itemId:'copper',count:3};b.output[0]={itemId:'wire',count:4};const old:any=structuredClone(g);old.meta.stateVersion=3;delete old.world.base.buildings[0].level;old.world.base.buildings[0].queue=['craft_wire','craft_wire'];old.world.base.handQueue=['grass_parts'];const migrated=sanitizeState(old);assert.equal(migrated.meta.stateVersion,4);const result=migrated.world.base.buildings[0];assert.equal(result.level,1);assert.deepEqual(result.job,b.job);assert.deepEqual(result.input,b.input);assert.deepEqual(result.output,b.output);assert.deepEqual(result.queue,[]);assert.deepEqual(migrated.world.base.handQueue,[]);assert.equal(old.world.base.buildings[0].queue.length,2);
 const missingGas:any=structuredClone(old);delete missingGas.world.capsuleMilliGU;assert.throws(()=>sanitizeState(missingGas),/capsuleMilliGU/);const missingBase:any=structuredClone(old);delete missingBase.world.base;assert.throws(()=>sanitizeState(missingBase),/world.base/);
 const bad:any=structuredClone(migrated);bad.world.base.buildings[0].queue=['craft_wire'];assert.throws(()=>sanitizeState(bad),/очередь/);bad.world.base.buildings[0].queue=[];delete bad.world.base.buildings[0].level;assert.throws(()=>sanitizeState(bad),/level/);bad.world.base.buildings[0].level=1;bad.world.base.handQueue=['grass_parts'];assert.throws(()=>sanitizeState(bad),/недоступна/);
});
test('Full output holds one completed batch through reload; removing power cannot add free progress',()=>{
 const {g,b}=setup();equip(g);stock(g,{...WORKBENCH_UPGRADE.inputs,copper:1,cable:1});upgradeBuilding(g,b.id);const gen=makeBuilding(g,'biogenerator',44,0,42);gen.energy=16000;connect(g,'cable',gen.id,b.id);startJob(g,'craft_wire',b.id);tick(g,4000);assert.equal(b.job!.workMs,4000);tick(g,4000);assert.equal(b.job!.workMs,4000);gen.energy=16000;b.output=Array.from({length:4},()=>({itemId:'stone',count:64}));tick(g,4000);assert.equal(b.job!.workMs,8000);const reloaded=sanitizeState(g);tick(reloaded,1000);assert.equal(reloaded.world.base.buildings[0].job!.workMs,8000);b.output[0]=null;tick(g,50);assert.equal(countItem(b.output,'wire'),4);assert.equal(b.job,null);assert.equal(gen.energy,0);
});
