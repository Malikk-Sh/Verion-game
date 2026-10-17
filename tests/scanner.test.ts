import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newGame,sanitizeState,HOTBAR_SIZE} from '../src/game/state';
import {addItems,countItem} from '../src/game/inventory';
import {ITEMS,TOOLS} from '../src/game/defs';
import {toolSlot,mineSeconds} from '../src/game/mining';
import {NODE_BY_ID} from '../src/game/resources';
import {spawnVein} from '../src/game/nature';
import {makeBuilding,connect,GEN_BUFFER,ELECTROLYZER_O2} from '../src/game/production';
import {allRooms,boxCells,bumpRooms,newDoor,shellOf} from '../src/game/rooms';
import {grantScanner,scanDeposit,scanRoom,scanStation,scannerSelected,SCANNER,SCANNER_DROP} from '../src/game/scanner';
import catalog from '../src/game/catalog.generated.json';
const fresh=()=>newGame('w-scanner',5,1,0);
/** A save from before S5: no scanner anywhere and no `progress.scanner`. */
const old=()=>{const g=fresh();g.player.inventory[2]=null;delete g.progress.scanner;return sanitizeState(JSON.parse(JSON.stringify(g)));};

test('Scanner: catalog tool (stack 1, not a mining tool), in the starting kit on a quick slot, flagged as given',()=>{
 assert.deepEqual([catalog.items.scanner.name,catalog.items.scanner.kind,catalog.items.scanner.stack],['Сканер','equipment',1]);assert.equal(ITEMS.scanner.category,'tool');assert.equal(TOOLS.scanner,undefined,'never a mining tool');
 const g=fresh();assert.equal(g.player.inventory[2]?.itemId,SCANNER);assert.equal(g.progress.scanner,true);assert.deepEqual(sanitizeState(g),g);
 g.player.hotbar=2;assert.equal(scannerSelected(g),true);assert.equal(toolSlot(g),-1);assert.equal(mineSeconds(g,'iron'),null,'the scanner does not mine ore');
 assert.equal(grantScanner(g),'none');assert.equal(countItem(g.player.inventory,SCANNER),1,'a new world is never given a second one');
});
test('Older saves get the scanner once: a free quick slot, else the backpack rows, else a drop at the capsule; a held one is only marked',()=>{
 const a=old();assert.equal(a.progress.scanner,undefined,'sanitize does not invent the flag');assert.equal(countItem(a.player.inventory,SCANNER),0);
 assert.equal(grantScanner(a),'quick');assert.equal(a.player.inventory[2]?.itemId,SCANNER,'the first free quick slot');assert.equal(countItem(a.player.inventory,SCANNER),1);assert.equal(a.progress.scanner,true);
 // Malik's S4 save: all six quick slots taken, so it goes to the backpack rows (the toast asks to drag it to quick access).
 const rows=old();for(let i=0;i<HOTBAR_SIZE;i++)rows.player.inventory[i]??={itemId:'stone',count:1};const before=structuredClone(rows.player.inventory.slice(0,HOTBAR_SIZE));assert.equal(grantScanner(rows),'backpack');
 assert.deepEqual(rows.player.inventory.slice(0,HOTBAR_SIZE),before,'quick slots untouched');assert.ok(rows.player.inventory.findIndex(s=>s?.itemId===SCANNER)>=HOTBAR_SIZE);assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(rows))),rows);
 const once=structuredClone(a);assert.equal(grantScanner(a),'none');assert.deepEqual(a,once);assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(a))),a,'the flag round-trips');
 // Thrown away after the grant: it does not come back.
 a.player.inventory[a.player.inventory.findIndex(s=>s?.itemId===SCANNER)]=null;assert.equal(grantScanner(a),'none');assert.equal(countItem(a.player.inventory,SCANNER),0);
 const full=old();full.player.inventory=full.player.inventory.map(()=>({itemId:'stone',count:64}));assert.equal(grantScanner(full),'capsule');
 const pile=full.world.drops.find(d=>d.items.some(s=>s.itemId===SCANNER))!;assert.deepEqual([pile.x,pile.z],[SCANNER_DROP.x,SCANNER_DROP.z]);assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(full))),full);
 // The selected empty quick slot is the bare hand: the grant skips it (S5 review), and with no other free quick slot uses the rows.
 const hand=old();hand.player.hotbar=2;assert.equal(grantScanner(hand),'quick');assert.notEqual(hand.player.inventory[2]?.itemId,SCANNER);assert.equal(scannerSelected(hand),false);assert.ok(hand.player.inventory.findIndex(s=>s?.itemId===SCANNER)<HOTBAR_SIZE);
 const only=old();only.player.hotbar=2;for(let i=0;i<HOTBAR_SIZE;i++)if(i!==only.player.hotbar)only.player.inventory[i]??={itemId:'stone',count:1};assert.equal(only.player.inventory[only.player.hotbar],null);assert.equal(grantScanner(only),'backpack');assert.equal(scannerSelected(only),false);assert.equal(only.player.inventory[only.player.hotbar],null);
 const crate=old();crate.world.crates['crate-a'][0]={itemId:SCANNER,count:1};assert.equal(grantScanner(crate),'none');assert.equal(crate.progress.scanner,true);assert.equal(countItem(crate.player.inventory,SCANNER),0);
 const bad:any=JSON.parse(JSON.stringify(fresh()));bad.progress.scanner='yes';assert.throws(()=>sanitizeState(bad),/scanner/);
});
test('Scanner readouts: deposit stock (moved from the aim label), vein, grass, station status and buffers, glass room air',()=>{
 const g=fresh(),iron=NODE_BY_ID.get('iron-a')!;g.world.nodes['iron-a']=iron.amount-3;addItems(g.player.inventory,'iron_raw',3);
 let r=scanDeposit(g,'iron-a')!;assert.equal(r.title,'Железная руда');assert.match(r.kind,/^Залежь · /);assert.deepEqual(r.rows.slice(0,3),[['Добыча','Железная руда'],['Запас',`${iron.amount-3} / ${iron.amount}`],['В рюкзаке','3']]);assert.match(r.text,/^Осталось \d+ блок/);
 g.world.nodes['iron-a']=0;assert.match(scanDeposit(g,'iron-a')!.text,/исчерпан/);
 const grass=[...NODE_BY_ID.values()].find(n=>n.material==='grass')!;r=scanDeposit(g,grass.id)!;assert.equal(r.rows[1][0],'Растений');assert.ok(r.rows.some(([k])=>k==='Отрастает'));
 g.player.x=-120;g.player.z=-120;const v=spawnVein(g,'stone',0)!;r=scanDeposit(g,v.id)!;assert.match(r.kind,/^Жила · /);assert.deepEqual(r.rows[1],['Запас',`${v.amount} / ${v.size}`]);assert.equal(scanDeposit(g,'vein-999'),null);
 const gen=makeBuilding(g,'biogenerator',44,0,42);gen.energy=GEN_BUFFER/2;gen.input[0]={itemId:'fiber',count:7};r=scanStation(g,gen);assert.equal(r.title,ITEMS.biogenerator.name);assert.ok(r.rows.some(([k,v])=>k==='Энергия'&&v==='1000 / 2000 EU'));assert.ok(r.rows.some(([k,v])=>k==='Волокно'&&v==='7'));
 const bench=makeBuilding(g,'workbench',42,0,42);bench.level=2;bench.queue=['craft_wire'];connect(g,'cable',gen.id,bench.id);r=scanStation(g,bench);assert.equal(r.title,'Верстак II');assert.ok(r.rows.some(([k,v])=>k==='Очередь'&&v==='1'));
 // The job row names the product: an electrolysis job makes oxygen (a fluid, not an item), never "Вода" (its input).
 const el=makeBuilding(g,'electrolyzer',46,0,46);el.oxygen=ELECTROLYZER_O2/4;el.job={recipeId:'electrolysis',workMs:5000,reserved:[],water:1000,repeat:0};r=scanStation(g,el);assert.deepEqual(r.rows.find(([k])=>k==='Работа'),['Работа','Кислород · 50 %']);assert.ok(r.rows.some(([k,v])=>k==='Кислород'&&v==='500 / 2000 GU'));
 bench.job={recipeId:'craft_wire',workMs:0,reserved:[],water:0,repeat:0};assert.deepEqual(scanStation(g,bench).rows.find(([k])=>k==='Работа'),['Работа',ITEMS.wire.name+' · 0 %']);
 g.world.base.glass=shellOf(boxCells(56,0,42,4,3,4));bumpRooms(g);const room=allRooms(g)[0];Object.assign(room.zone,{q:0,purity:1,temperature:18});
 r=scanRoom(room);assert.deepEqual(r.rows[0],['Объём',`${room.volume} м³`]);assert.deepEqual(r.rows.at(-1),['Дышать','нельзя']);
 Object.assign(room.zone,{q:8000*room.volume});r=scanRoom(room);assert.deepEqual(r.rows.at(-1),['Дышать','можно']);assert.match(r.text,/пригоден/);
 assert.equal(scanRoom(null).title,'Не замкнуто');const d=newDoor('door-1',0,0,0,0);d.pressure=4000;d.inner='open';const rd=scanRoom(null,d);assert.equal(rd.kind,'Шлюз');assert.deepEqual(rd.rows,[['Камера','4 GU'],['Двери','наружная закрыта, внутренняя открыта']]);
 r=scanRoom(room,d);assert.equal(r.kind,'Шлюз · помещение');assert.deepEqual(r.rows.at(-1),['Двери','наружная закрыта, внутренняя открыта']);
});
