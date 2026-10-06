import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {newGame,cloneState,sanitizeState} from '../src/game/state.ts';
import {addItems,countItem} from '../src/game/inventory.ts';
import {mineTick,ticksFor,type Mining} from '../src/game/mining.ts';
import {NODES} from '../src/game/resources.ts';
import {RECIPES,RECIPE_BY_ID,makeBuilding,startJob,cancelJob,productionTick,collectOutput,queueJob,clearQueue,loadFuel,connect,sealCheck,domeFaces,habitable,beginPassage,releaseHandOnDeath} from '../src/game/production.ts';
import {survivalTick,refillFromCapsule,loseCargo,accessibleOxygen} from '../src/game/survival.ts';
import {place,placementProblem} from '../src/buildings.ts';
import {heightAt,makeColliders} from '../src/world.ts';
import {SaveStore} from '../src/persist/store.ts';
import {buildExport,exportText,parseImport} from '../src/persist/file.ts';
const fresh=()=>newGame('w-production',99,1,heightAt(40,42));
const advance=(g:ReturnType<typeof fresh>,ms:number,port:string|null=null)=>{for(let n=0;n<ms;n+=50){productionTick(g,50,port);g.meta.activeTicks++;}};
const near=(g:ReturnType<typeof fresh>,b:{x:number;y:number;z:number})=>Object.assign(g.player,{x:b.x+1,y:b.y,z:b.z});

test('S2 production uses canonical recipes and the finite grass/sand guarantee',()=>{
 const design=JSON.parse(readFileSync(new URL('../docs/data/catalog.json',import.meta.url),'utf8'));for(const r of RECIPES)assert.deepEqual(r,design.recipes.find((v:any)=>v.id===r.id));
 assert.equal(RECIPES.length,19);assert.deepEqual(RECIPE_BY_ID.get('craft_dome')!.inputs,{iron:8,glass:12,fiber:8});
 for(const [id,n] of [['grass',100],['sand',32]] as const)assert.equal(NODES.filter(a=>a.itemId===id).reduce((s,a)=>s+a.amount,0),n);
 const g=fresh(),m:Mining={nodeId:null,ticks:0},tool=g.player.inventory[0]!.durability;
 for(let i=0;i<20;i++)mineTick(g,m,'grass-a',true);assert.equal(countItem(g.player.inventory,'grass'),1);assert.equal(g.player.inventory[0]!.durability,tool);
});
test('Reserved hand inputs, cancellation and tool/tank output have no free gas or duplication',()=>{
 const g=fresh();addItems(g.player.inventory,'stone',4);addItems(g.player.inventory,'fiber',2);assert.equal(startJob(g,'craft_tool_stone'),'');advance(g,3000);assert.equal(countItem(g.player.inventory,'stone'),0);
 const copy=sanitizeState(g);assert.deepEqual(copy,g);assert.equal(cancelJob(copy),'');assert.equal(countItem(copy.player.inventory,'stone'),4);assert.equal(cancelJob(copy),'Нет работы');
 const b=makeBuilding(g,'workbench',42,0,42);near(g,b);addItems(g.player.inventory,'iron',2);addItems(g.player.inventory,'copper',1);assert.equal(startJob(g,'craft_bottle_1',b.id),'');advance(g,8000);collectOutput(g,b.id);assert.equal(g.player.inventory.find(s=>s?.itemId==='bottle_1')!.milliGU,0);
});
test('Full hand output keeps a completed batch and death drops its output once',()=>{
 const g=fresh();g.player.inventory=Array.from({length:24},()=>({itemId:'stone',count:64}));g.player.inventory[2]={itemId:'grass',count:2};assert.equal(startJob(g,'grass_parts'),'');advance(g,1000);assert.equal(g.world.base.hand?.workMs,1000);
 releaseHandOnDeath(g);loseCargo(g);assert.equal(g.world.drops.flatMap(d=>d.items).filter(i=>i.itemId==='fiber').reduce((n,s)=>n+s.count,0),2);releaseHandOnDeath(g);assert.equal(g.world.base.hand,null);
});
test('Queued machine resources stay in normal buffers; only active inputs are reserved',()=>{
 const g=fresh(),b=makeBuilding(g,'kiln',41,0,42);near(g,b);addItems(g.player.inventory,'iron_raw',5);addItems(g.player.inventory,'fiber',10);assert.equal(queueJob(g,'smelt_iron_raw',b.id),'');assert.equal(countItem(b.input,'iron_raw'),5);assert.equal(b.job,null);
 advance(g,50);assert.equal(b.job?.reserved[0].count,1);assert.equal(countItem(b.input,'iron_raw'),4);assert.equal(b.queue.length,4);clearQueue(g,b.id);cancelJob(g,b.id);assert.equal(countItem(g.player.inventory,'iron_raw'),1);assert.equal(countItem(b.input,'iron_raw'),4);
});
test('Electrolysis requires paid water and connected power and conserves 1 WU → 240 GU',()=>{
 const g=fresh(),gen=makeBuilding(g,'biogenerator',44,0,40),e=makeBuilding(g,'electrolyzer',46,0,40);near(g,e);addItems(g.player.inventory,'ice',1);assert.equal(startJob(g,'melt_in_generator',e.id),'');advance(g,1000);assert.equal(e.job!.workMs,0);
 addItems(g.player.inventory,'fiber',1);loadFuel(g,gen.id);advance(g,10000);assert.equal(e.job!.workMs,0,'no wireless energy');addItems(g.player.inventory,'cable',1);assert.equal(connect(g,'cable',gen.id,e.id),'');advance(g,2000);assert.equal(e.water,1000);assert.equal(startJob(g,'electrolysis',e.id),'');assert.equal(e.water,0);advance(g,10000);assert.equal(e.oxygen,240000);assert.equal(e.job,null);
 assert.equal(gen.energy+gen.fuel,68000,'200 EU fiber minus 12 EU melting and 120 EU electrolysis');assert.equal(g.player.bottles[0]!.milliGU,240000);
});
test('Two consumers share one finite power budget; disconnect and pause cannot invent work',()=>{
 const g=fresh(),gen=makeBuilding(g,'biogenerator',44,0,40),a=makeBuilding(g,'electrolyzer',46,0,40),b=makeBuilding(g,'electrolyzer',44,0,42);gen.energy=6000;for(const e of [a,b]){near(g,e);e.water=1000;startJob(g,'electrolysis',e.id);addItems(g.player.inventory,'cable',1);connect(g,'cable',gen.id,e.id);}advance(g,1000);assert.equal(a.job!.workMs+b.job!.workMs,500);assert.equal(gen.energy,0);const before=cloneState(g);advance(g,1000);assert.equal(a.job!.workMs,before.world.base.buildings[1].job!.workMs);
});
test('Gas links and two-tank refill conserve gas and require a powered paid port',()=>{
 const g=fresh(),gen=makeBuilding(g,'biogenerator',44,0,40),e=makeBuilding(g,'electrolyzer',46,0,40),r=makeBuilding(g,'refill',44,0,42);near(g,r);g.player.bottles=[{itemId:'bottle_1',count:1,milliGU:239500},{itemId:'bottle_1',count:1,milliGU:230000}];e.oxygen=100000;addItems(g.player.inventory,'gas_pipe',1);connect(g,'gas_pipe',e.id,r.id);advance(g,1000,r.id);assert.equal(g.player.bottles[0]!.milliGU,239500);
 gen.energy=100000;addItems(g.player.inventory,'cable',1);connect(g,'cable',gen.id,r.id);const gas=e.oxygen+r.oxygen+469500;advance(g,1000,r.id);assert.equal(e.oxygen+r.oxygen+g.player.bottles.reduce((n,b)=>n+b!.milliGU!,0),gas);assert.equal(g.player.bottles[0]!.milliGU,240000);assert.equal(g.player.bottles[1]!.milliGU,240000);
});
test('Flood fill proves 48 m³ and gives an escape path when a face breaks',()=>{
 const shell=Array(domeFaces().length).fill(180);assert.equal(shell.length,80);assert.deepEqual(sealCheck(shell),{sealed:true,volume:48,path:[]});shell[7]=0;const result=sealCheck(shell);assert.equal(result.sealed,false);assert.ok(result.path.length>=2);shell[7]=180;assert.equal(sealCheck(shell).volume,48);
});
test('A powered distributor fills a sealed dome; outage preserves air, breach leaks it',()=>{
 const g=fresh(),d=makeBuilding(g,'dome',48,0,40),r=makeBuilding(g,'distributor',47,0,40),gen=makeBuilding(g,'biogenerator',44,0,38);gen.energy=400000;r.oxygen=480000;addItems(g.player.inventory,'cable',1);connect(g,'cable',gen.id,r.id);advance(g,20000);assert.ok(d.zone.q>=384000);assert.ok(habitable(d));
 Object.assign(g.player,{x:48,y:.2,z:40});g.player.suit.helmet=null;const bottle=g.player.bottles[0]!.milliGU!;assert.equal(survivalTick(g,.05,false),'none');assert.equal(g.player.bottles[0]!.milliGU,bottle);assert.equal(accessibleOxygen(g,false).amount,d.zone.q/1000);
 gen.enabled=false;gen.energy=0;const q=d.zone.q;advance(g,1000);assert.equal(d.zone.q,q-96);assert.ok(habitable(d));d.zone.shell[0]=0;advance(g,1000);assert.ok(d.zone.q<q);assert.equal(habitable(d),false);
});
test('Manual airlock charges finite air and survives a saved mid-cycle',()=>{
 const g=fresh(),d=makeBuilding(g,'dome',48,0,40);d.zone.q=500000;d.zone.purity=1;Object.assign(g.player,{x:48,y:0,z:43});assert.equal(beginPassage(g,d.id),'');assert.equal(d.zone.q,496000);advance(g,3000);const copy=sanitizeState(g);advance(copy,2950);assert.ok(copy.world.base.passage);const done=productionTick(copy,50);assert.deepEqual(done.passage,{x:48,y:.12,z:41});assert.equal(copy.world.base.passage,null);assert.equal(copy.world.base.buildings[0].zone.q,496000);
});
test('Old saves migrate only missing S2 fields; invalid network or WIP is rejected',()=>{
 const g=fresh(),old:any=cloneState(g);old.meta.stateVersion=2;delete old.world.base;delete old.world.nodes['grass-a'];delete old.world.nodes['grass-b'];delete old.world.nodes['sand-a'];old.world.capsuleMilliGU=123;assert.equal(sanitizeState(old).world.capsuleMilliGU,123);assert.equal(sanitizeState(old).world.nodes['grass-a'],50);
 const raw:any=cloneState(g);raw.world.base.hand={recipeId:'grass_parts',workMs:0,water:0,reserved:[{itemId:'iron',count:64}]};assert.throws(()=>sanitizeState(raw),/входы/);
 raw.world.base.hand=null;const b=makeBuilding(raw,'workbench',40,0,42);b.output[0]={itemId:'bottle_1',count:1,milliGU:999999};assert.throws(()=>sanitizeState(raw),/число вне/);
});
test('Saved production WIP, buffers and the next output round-trip through IndexedDB and export',async()=>{
 const g=fresh(),b=makeBuilding(g,'kiln',41,0,42);near(g,b);addItems(g.player.inventory,'iron_raw',5);addItems(g.player.inventory,'fiber',10);queueJob(g,'smelt_iron_raw',b.id);advance(g,3500);
 const store=await SaveStore.open(new IDBFactory(),'s2-production',()=>1000);await store.createSlot(g,'token');const loaded=(await store.load(g.meta.worldId)).state;assert.deepEqual(loaded,g);const imported=parseImport(exportText(buildExport(g,1,5))).state;assert.deepEqual(imported,g);advance(loaded,2500);advance(imported,2500);assert.deepEqual(loaded,imported);assert.equal(countItem(loaded.world.base.buildings[0].output,'iron'),1);store.close();
});
test('Natural resources alone pay the complete early path from harvest to breathable dome',()=>{
 makeColliders();const g=fresh();let time=0;
 const tick=(ms:number,inside=true)=>{for(let i=0;i<ms;i+=50){productionTick(g,50);survivalTick(g,.05,inside);g.meta.activeTicks++;time+=50;}assert.ok(g.player.vitals.health>0);};
 const topUp=()=>{Object.assign(g.player,{x:40,y:heightAt(40,42),z:42});while(g.player.bottles[0]!.milliGU!<240000){refillFromCapsule(g,.05);tick(50);}};
 const harvest=(item:string,count:number)=>{for(const node of NODES.filter(n=>n.itemId===item)){const m:Mining={nodeId:null,ticks:0};while(count>0&&g.world.nodes[node.id]>0){if(g.player.bottles[0]!.milliGU!<10000)topUp();Object.assign(g.player,{x:node.x,y:heightAt(node.x,node.z),z:node.z});for(let i=0;i<ticksFor(node.material,1);i++){mineTick(g,m,node.id,true);tick(50,false);}count--;}}assert.equal(count,0);};
 for(const [id,n] of [['grass',80],['stone',24],['iron_raw',30],['copper_raw',14],['sand',30],['ice',6]] as const)harvest(id,n);
 topUp();const craft=(id:string,b?:ReturnType<typeof makeBuilding>)=>{if(b)near(g,b);assert.equal(startJob(g,id,b?.id), '',id);Object.assign(g.player,{x:40,y:heightAt(40,42),z:42});tick(RECIPE_BY_ID.get(id)!.seconds*1000);if(b)collectOutput(g,b.id);};
 for(let i=0;i<80;i++)craft('grass_parts');craft('craft_workbench');craft('craft_kiln');Object.assign(g.player,{x:47,y:heightAt(47,46),z:46});assert.equal(place(g,'workbench',46,45),'');assert.equal(place(g,'kiln',48,45),'');const w=g.world.base.buildings[0],k=g.world.base.buildings[1];
 for(const [r,n] of [['smelt_iron_raw',30],['smelt_copper_raw',14],['glass',15]] as const)for(let i=0;i<n;i++)craft(r,k);
 for(const r of ['craft_biogenerator','craft_electrolyzer','craft_refill','craft_bottle_1','craft_circuit','craft_distributor','craft_dome','craft_wire','craft_cable','craft_gas_pipe'])craft(r,w);
 Object.assign(g.player,{x:47,y:heightAt(47,46),z:46});for(const [kind,x,z] of [['dome',48,40],['biogenerator',44,38],['electrolyzer',44,40],['refill',44,36],['distributor',47,40]] as const)assert.equal(place(g,kind,x,z),'',kind);
 const gen=g.world.base.buildings.find(b=>b.kind==='biogenerator')!,e=g.world.base.buildings.find(b=>b.kind==='electrolyzer')!,r=g.world.base.buildings.find(b=>b.kind==='refill')!,d=g.world.base.buildings.find(b=>b.kind==='distributor')!,dome=g.world.base.buildings.find(b=>b.kind==='dome')!;
 for(const b of [e,r,d])assert.equal(connect(g,'cable',gen.id,b.id),'');assert.equal(connect(g,'gas_pipe',e.id,d.id),'');for(let i=0;i<15;i++)assert.equal(loadFuel(g,gen.id),'');
 // Fill the room before opening the paid branch to personal refilling.
 for(let i=0;i<6;i++){craft('melt_in_generator',e);craft('electrolysis',e);}tick(15000);assert.ok(habitable(dome));assert.equal(connect(g,'gas_pipe',e.id,r.id),'');assert.equal(sealCheck(dome.zone.shell).volume,48);assert.ok(g.world.nodes['grass-a']+g.world.nodes['grass-b']===20);assert.ok(g.player.inventory[0]!.durability!>0);assert.ok(time<35*60000);assert.deepEqual(sanitizeState(g),g);assert.ok(g.world.capsuleMilliGU<2400000,'survival consumed actual initial gas');
});

test('Capsule manual supply fills both installed tanks with one conserved 20 GU/s budget',()=>{
 const g=fresh();g.player.bottles=[{itemId:'bottle_1',count:1,milliGU:239500},{itemId:'bottle_1',count:1,milliGU:238000}];g.world.capsuleMilliGU=1800;const total=g.world.capsuleMilliGU+477500;
 assert.equal(refillFromCapsule(g,.05),1000);assert.equal(g.player.bottles[0]!.milliGU,240000);assert.equal(g.player.bottles[1]!.milliGU,238500);assert.equal(refillFromCapsule(g,.05),800);assert.equal(refillFromCapsule(g,.05),0);assert.equal(g.world.capsuleMilliGU+g.player.bottles.reduce((n,b)=>n+b!.milliGU!,0),total);
});

test('A saturated electrical network respects 40 EU/s per source and oxygen priority hysteresis',()=>{
 const g=fresh(),gen=makeBuilding(g,'biogenerator',44,0,38),dome=makeBuilding(g,'dome',48,0,40),dist=makeBuilding(g,'distributor',47,0,40);gen.energy=400000;
 addItems(g.player.inventory,'cable',5);assert.equal(connect(g,'cable',gen.id,dist.id),'');
 for(const [x,z] of [[44,40],[46,38],[42,38],[44,36]]){const e=makeBuilding(g,'electrolyzer',x,0,z);near(g,e);e.water=1000;startJob(g,'electrolysis',e.id);e.oxygen=400000;assert.equal(connect(g,'cable',gen.id,e.id),'');}
 advance(g,1000);assert.equal(gen.energy,360000);assert.ok(Math.abs(dome.zone.purity-1/30)<1e-9,'life support receives its full priority budget');
 const es=g.world.base.buildings.filter(b=>b.kind==='electrolyzer');assert.ok(es.every(b=>b.lowPriority));es[0].oxygen=270000;advance(g,50);assert.equal(es[0].lowPriority,true,'50–80% keeps the previous class');es[0].oxygen=100000;advance(g,50);assert.equal(es[0].lowPriority,false);
});


test('Cable and gas segment limits include height, and a rejected segment spends nothing',()=>{
 const g=fresh(),a=makeBuilding(g,'electrolyzer',44,8,40),b=makeBuilding(g,'refill',46,0,40);addItems(g.player.inventory,'gas_pipe',1);assert.match(connect(g,'gas_pipe',a.id,b.id),/4 м/);assert.equal(countItem(g.player.inventory,'gas_pipe'),1);assert.equal(g.world.base.links.length,0);
 const invalid:any=cloneState(g);invalid.world.base.links=[{id:'link-3',kind:'gas_pipe',from:a.id,to:b.id}];invalid.world.base.nextId=4;assert.throws(()=>sanitizeState(invalid),/порты\/длина/);
});


test('Production has its own state version: old saves migrate, corrupt current saves cannot gain gas',()=>{
 const g=fresh();assert.equal(g.meta.stateVersion,3);const old:any=cloneState(g);old.meta.stateVersion=2;delete old.world.base;delete old.world.nodes['grass-a'];delete old.world.nodes['grass-b'];delete old.world.nodes['sand-a'];old.world.capsuleMilliGU=12345;old.player.survival.emergencyMs=1234;
 const migrated=sanitizeState(old);assert.equal(migrated.meta.stateVersion,3);assert.equal(migrated.world.capsuleMilliGU,12345);assert.equal(migrated.player.survival.emergencyMs,1234);assert.equal(migrated.world.base.buildings.length,0);
 const corrupt:any=cloneState(g);delete corrupt.world.capsuleMilliGU;assert.throws(()=>sanitizeState(corrupt),/capsuleMilliGU/);delete corrupt.world.base;assert.throws(()=>sanitizeState(corrupt),/world.base/);
});
