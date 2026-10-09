import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newGame,sanitizeState} from '../src/game/state';
import {addItems,transferSlot,countItem} from '../src/game/inventory';
import {makeBuilding,productionTick,connect,startJob} from '../src/game/production';
import {packStation,loadMachineSlot} from '../src/game/worldActions';
import {place} from '../src/buildings';
import {heightAt} from '../src/world';
import {Character} from '../src/controller';
import {readyWorldItem} from '../src/game/backpack';
const fresh=()=>newGame('w-actions',123,1,0);
const tick=(g:ReturnType<typeof fresh>,ms:number)=>{for(let i=0;i<ms;i+=50)productionTick(g,50);};
test('Packed workbench preserves II, paid WIP and containers; link refunds are atomic and placement restores it',()=>{
 const g=fresh();g.player.x=47;g.player.z=46;const b=makeBuilding(g,'workbench',46,0,45),gen=makeBuilding(g,'biogenerator',44,0,45);b.level=2;addItems(g.player.inventory,'copper',2);startJob(g,'craft_wire',b.id);b.job!.workMs=1700;b.output[0]={itemId:'iron',count:3};addItems(g.player.inventory,'cable',1);connect(g,'cable',gen.id,b.id);const expected=structuredClone(b);
 assert.equal(packStation(g,b.id),'');assert.equal(g.world.base.links.length,0);assert.equal(countItem(g.player.inventory,'cable'),1);const at=g.player.inventory.findIndex(s=>s?.packed);g.player.hotbar=at;assert.deepEqual(sanitizeState(g),g);assert.equal(place(g,'workbench',46,45),'');const restored=g.world.base.buildings.find(b=>b.kind==='workbench')!;assert.equal(restored.level,2);assert.deepEqual(restored.job,expected.job);assert.deepEqual(restored.output,expected.output);assert.equal(restored.id===expected.id,false);
 g.player.inventory=Array.from({length:24},()=>({itemId:'stone',count:64}));const before=structuredClone(g);assert.ok(packStation(g,restored.id));assert.deepEqual(g,before);
});
test('Storage preserves gas, packed station and counts; nested packed machines are rejected',()=>{
 const g=fresh();g.player.inventory[3]={itemId:'bottle_1',count:1,milliGU:123456};assert.ok(transferSlot(g.player.inventory,3,g.world.crates['crate-a']));assert.equal(g.world.crates['crate-a'][0]!.milliGU,123456);assert.deepEqual(sanitizeState(g),g);assert.ok(transferSlot(g.world.crates['crate-a'],0,g.player.inventory));assert.equal(g.player.inventory.find(s=>s?.itemId==='bottle_1')!.milliGU,123456);
 const b=makeBuilding(g,'workbench',40,0,42);packStation(g,b.id);const bad:any=structuredClone(g),packed=bad.player.inventory.find((s:any)=>s?.packed);packed.packed.input[0]=structuredClone(packed);assert.throws(()=>sanitizeState(bad),/упакованный/);
});
test('Mounted tank fills only with paid connected energy; processing and filling share one budget',()=>{
 const g=fresh(),gen=makeBuilding(g,'biogenerator',42,0,42),e=makeBuilding(g,'electrolyzer',44,0,42);g.player.x=44;g.player.z=43;addItems(g.player.inventory,'water',2);const index=g.player.inventory.findIndex(s=>s?.itemId==='water');assert.equal(loadMachineSlot(g,e.id,index),'');e.input[1]={itemId:'bottle_1',count:1,milliGU:0};e.oxygen=10000;tick(g,1000);assert.equal(e.input[1]!.milliGU,0);addItems(g.player.inventory,'cable',1);connect(g,'cable',gen.id,e.id);gen.energy=7000;tick(g,500);assert.equal(gen.energy,0);assert.equal(e.input[1]!.milliGU,10000);assert.equal(e.job!.workMs,500);assert.equal(e.oxygen,0);assert.deepEqual(sanitizeState(g),g);
});
test('v5 paid melting WIP migrates without losing gas, paid ice or work progress; current corrupt storage fails',()=>{
 const g:any=fresh();g.meta.stateVersion=5;delete g.world.crates;g.progress.quests.tracked='air';const e=makeBuilding(g,'electrolyzer',44,0,42);e.water=2000;e.oxygen=120000;e.job={recipeId:'melt_in_generator',reserved:[{itemId:'ice',count:1}],workMs:950,water:0};const migrated=sanitizeState(g),b=migrated.world.base.buildings[0];assert.equal(b.job!.recipeId,'legacy_melt');assert.equal(b.job!.workMs,950);assert.equal(b.water,2000);assert.equal(b.oxygen,120000);assert.equal(migrated.progress.quests.tracked,null);assert.equal(migrated.world.crates['crate-a'].filter(Boolean).length,0);const bad:any=structuredClone(migrated);delete bad.world.crates;assert.throws(()=>sanitizeState(bad));
});
test('Airborne takeoff speed survives release of run and movement buttons',()=>{
 const c=new Character([]);c.x=40;c.z=50;c.y=heightAt(c.x,c.z);c.yaw=0;c.step(.05,{forward:1,right:0,run:true,jump:true});assert.equal(c.grounded,false);const start=c.z;c.step(.05,{forward:0,right:0,run:false,jump:false});assert.ok(Math.abs(c.z-start-.25)<1e-6);assert.equal(c.airSpeed,5);
});
test('Mounted bottle reserves its missing gas from connected pipes; no gas or energy is duplicated',()=>{
 const g=fresh(),gen=makeBuilding(g,'biogenerator',42,0,42),e=makeBuilding(g,'electrolyzer',44,0,42),r=makeBuilding(g,'refill',44,0,40);addItems(g.player.inventory,'cable',1);addItems(g.player.inventory,'gas_pipe',1);connect(g,'cable',gen.id,e.id);connect(g,'gas_pipe',e.id,r.id);gen.energy=50000;e.oxygen=240000;e.input[1]={itemId:'bottle_1',count:1,milliGU:0};tick(g,12000);assert.equal(e.input[1]!.milliGU,240000);assert.equal(e.oxygen+r.oxygen,0);assert.equal(gen.energy,26000);
});
test('A single blocked furnace output keeps paid WIP until the actual output is collected',()=>{
 const g=fresh(),k=makeBuilding(g,'kiln',42,0,42);k.input[0]={itemId:'ice',count:1};k.input[1]={itemId:'fiber',count:1};k.output[0]={itemId:'iron',count:1};tick(g,2000);assert.equal(k.job!.workMs,2000);assert.equal(k.output[0]!.itemId,'iron');assert.equal(k.output.slice(1).filter(Boolean).length,0);assert.equal(countItem(k.input,'ice'),0);k.output[0]=null;tick(g,50);assert.equal(k.output[0]!.itemId,'water');assert.equal(k.job,null);
});
test('A nearly full mounted tank clamps the final fractional transfer to its exact capacity',()=>{
 const g=fresh(),gen=makeBuilding(g,'biogenerator',42,0,42),e=makeBuilding(g,'electrolyzer',44,0,42);e.input[1]={itemId:'bottle_1',count:1,milliGU:239999};e.oxygen=1000;gen.energy=1;addItems(g.player.inventory,'cable',1);connect(g,'cable',gen.id,e.id);tick(g,50);assert.equal(e.input[1]!.milliGU,240000);assert.equal(e.oxygen,999);assert.equal(gen.energy,0);assert.deepEqual(sanitizeState(g),g);
});
test('Inventory world action selects the exact packed body and preserves displaced hotbar items',()=>{
 const g=fresh(),b=makeBuilding(g,'workbench',40,0,42);b.level=2;packStation(g,b.id);
 const at=g.player.inventory.findIndex(s=>s?.packed),body=g.player.inventory[at];g.player.inventory[at]=null;g.player.inventory[12]=body;
 g.player.inventory[2]=null;assert.ok(readyWorldItem(g,12).ok);assert.equal(g.player.hotbar,2);assert.equal(g.player.inventory[2],body);assert.equal(g.player.inventory[12],null);
 g.player.inventory[12]={itemId:'gas_pipe',count:3};for(let i=0;i<6;i++)if(!g.player.inventory[i])g.player.inventory[i]={itemId:'stone',count:1};
 const displaced=g.player.inventory[2];assert.ok(readyWorldItem(g,12).ok);assert.equal(g.player.inventory[2]!.itemId,'gas_pipe');assert.equal(g.player.inventory[12],displaced);assert.deepEqual(sanitizeState(g),g);
});
test('Placing a fresh selected station never consumes another packed station with saved contents',()=>{
 const g=fresh();g.player.x=47;g.player.z=46;const b=makeBuilding(g,'workbench',46,0,45);b.level=2;b.output[0]={itemId:'iron',count:3};packStation(g,b.id);
 const at=g.player.inventory.findIndex(s=>s?.packed),packed=structuredClone(g.player.inventory[at]);g.player.inventory[5]={itemId:'workbench',count:1};g.player.hotbar=5;
 assert.equal(place(g,'workbench',46,45),'');assert.deepEqual(g.player.inventory[at],packed);assert.equal(g.player.inventory[5],null);assert.equal(g.world.base.buildings[0].level,1);assert.ok(g.world.base.buildings[0].output.every(s=>!s));assert.deepEqual(sanitizeState(g),g);
});
test('Legacy mixed machine inputs keep all stock and paid WIP, retire unpaid queues and isolate extra slots',()=>{
 const old:any=fresh();old.meta.stateVersion=5;delete old.world.crates;
 const k=makeBuilding(old,'kiln',42,0,42);k.input=[{itemId:'fiber',count:3},{itemId:'copper_raw',count:2},{itemId:'sand',count:4},null];k.queue=['smelt_copper_raw','glass'];
 k.job={recipeId:'smelt_iron_raw',workMs:1200,reserved:[{itemId:'iron_raw',count:1},{itemId:'fiber',count:2}],water:0};
 const e=makeBuilding(old,'electrolyzer',44,0,42);e.input=[{itemId:'ice',count:2},{itemId:'water',count:1},null,{itemId:'bottle_1',count:1,milliGU:17000}];e.queue=['electrolysis'];
 const g=sanitizeState(old),kiln=g.world.base.buildings[0],electro=g.world.base.buildings[1];
 assert.deepEqual(kiln.input,[{itemId:'copper_raw',count:2},{itemId:'fiber',count:3},{itemId:'sand',count:4},null]);assert.deepEqual(kiln.job,k.job);assert.deepEqual(kiln.queue,[]);
 assert.deepEqual(electro.input,[{itemId:'water',count:1},{itemId:'bottle_1',count:1,milliGU:17000},{itemId:'ice',count:2},null]);assert.deepEqual(electro.queue,[]);
 kiln.job=null;kiln.input[0]=null;tick(g,1000);assert.equal(kiln.job,null);assert.equal(countItem(kiln.input,'sand'),4);assert.equal(countItem(electro.input,'ice'),2);assert.deepEqual(sanitizeState(g),g);const corrupt=structuredClone(old);corrupt.world.base.buildings[0].input[2]=0;assert.throws(()=>sanitizeState(corrupt));
});
