import test from 'node:test';
import assert from 'node:assert/strict';
import {toScreen,toWorld,zoomAt,clampView,clampZoom,fitZoom,valleyZoom,MAX_ZOOM,hitTest,cullLabels,clusterDeposits,direction,buildRasterRows,rasterSize,panBy} from '../src/ui/mapView';
import {resolveNav,arrived,clampWaypoint} from '../src/game/navigation';
import {newGame,sanitizeState,cloneState} from '../src/game/state';
import {makeBuilding} from '../src/game/production';
import {packStation} from '../src/game/worldActions';
import {sceneInterval} from '../src/renderPolicy';
import {MIN,MAX} from '../src/world';
const W=600,H=300,fresh=()=>newGame('w-map',1,1,.5);

test('Map projection: north is up, east (−x) is right, and screen ↔ world round-trips',()=>{
 const v={cx:40,cz:40,zoom:2},c=toScreen(v,W,H,40,40);assert.deepEqual(c,{x:300,y:150});
 assert.ok(toScreen(v,W,H,30,40).x>c.x,'smaller x (east) is to the right');assert.ok(toScreen(v,W,H,40,50).y<c.y,'larger z (north) is up');
 for(const [x,z] of [[0,0],[-150,300],[355,-190]]){const s=toScreen(v,W,H,x,z),b=toWorld(v,W,H,s.x,s.y);assert.ok(Math.abs(b.x-x)<1e-9&&Math.abs(b.z-z)<1e-9);}
 assert.equal(direction(-10,0),'В');assert.equal(direction(0,10),'С');assert.equal(direction(10,-10),'ЮЗ');
});

test('Zoom about a point keeps that world point under the finger and is clamped to the whole-area … 6 px/m range',()=>{
 const v={cx:60,cz:50,zoom:2},before=toWorld(v,W,H,123,77),z=zoomAt(v,W,H,123,77,1.7),after=toWorld(z,W,H,123,77);
 assert.ok(Math.abs(before.x-after.x)<1e-9&&Math.abs(before.z-after.z)<1e-9);assert.equal(z.zoom,3.4);
 assert.equal(zoomAt(v,W,H,0,0,100).zoom,MAX_ZOOM);assert.equal(zoomAt(v,W,H,0,0,1e-4).zoom,fitZoom(W,H));assert.equal(clampZoom(.001,W,H),fitZoom(W,H));
 assert.ok(valleyZoom(844,390)>=390/160-1e-9&&valleyZoom(844,390)<=MAX_ZOOM);
 const far=clampView(panBy({cx:40,cz:40,zoom:2},1e5,-1e5),W,H),edge=toScreen(far,W,H,MAX,MIN);assert.ok(edge.x<=1e-6&&edge.y>=H-1e-6,'panning stops with the edge of the square at the viewport edge');
 const all=clampView({cx:999,cz:-999,zoom:fitZoom(W,H)},W,H);assert.equal(all.cx,80);assert.equal(all.cz,80);
});

test('Hit-testing: the nearest marker within the radius wins, ties go to the higher priority',()=>{
 const items=[{id:'node',x:100,y:100,priority:20},{id:'place',x:110,y:100,priority:60},{id:'far',x:200,y:200,priority:100}];
 assert.equal(hitTest(items,102,100)?.id,'node');assert.equal(hitTest(items,108,100)?.id,'place');
 assert.equal(hitTest(items,105,100)?.id,'place','equal distance: higher priority');assert.equal(hitTest(items,150,150),null,'nothing within 18 px');
 assert.equal(hitTest(items,185,200,16)?.id,'far');assert.equal(hitTest(items,183,200,16),null,'radius is respected');
});

test('Label culling keeps higher priorities and drops overlapping or off-screen labels',()=>{
 const kept=cullLabels([{id:'a',x:0,y:0,w:50,h:16,priority:10},{id:'target',x:20,y:5,w:50,h:16,priority:100},{id:'b',x:80,y:0,w:30,h:16,priority:5},{id:'out',x:590,y:0,w:30,h:16,priority:99}],W,H).map(l=>l.id);
 assert.deepEqual(kept,['target','b']);
});

test('Deposits of one material merge at low zoom and keep their total stock; an exhausted one stays visible',()=>{
 const list=[{id:'iron-a',material:'iron',x:67,z:65,left:30,amount:32},{id:'iron-b',material:'iron',x:69.1,z:63.8,left:0,amount:16},{id:'copper-a',material:'copper',x:68,z:64,left:5,amount:22}];
 const low=clusterDeposits(list,9);assert.equal(low.length,2);assert.deepEqual(low[0].ids,['iron-a','iron-b']);assert.equal(low[0].left,30);assert.equal(low[0].amount,48);
 assert.equal(clusterDeposits(list,1).length,3);assert.equal(clusterDeposits(list,1)[1].left,0);
});

test('The relief raster is one opaque pixel per 2 m, east column first',()=>{
 const n=rasterSize(2),data=new Uint8ClampedArray(n*n*4);assert.equal(n,280);assert.equal(rasterSize(1),560);
 buildRasterRows(data,(x)=>x>0?30:0,2,0,2);assert.equal(data[3],255);assert.equal(data[(n*2)*4+3],0,'rows after the slice are untouched');
 assert.notDeepEqual([...data.slice(0,3)],[...data.slice((n-1)*4,(n-1)*4+3)],'column 0 is x = MAX (high ground here), the last column is x = MIN');
});

test('One navigation model: a target that disappears falls back to the guide; arrival is within the radius',()=>{
 const g=fresh();
 assert.equal(resolveNav(g,'guide',null),null);assert.equal((resolveNav(g,'cave',null) as {name:string}).name,'Вход в пещеру');
 const node=resolveNav(g,'iron-a',null);assert.ok(node&&node!=='invalid'&&node.kind==='node');g.world.nodes['iron-a']=0;assert.equal(resolveNav(g,'iron-a',null),'invalid','exhausted deposit');
 assert.equal(resolveNav(g,'point',null),'invalid','no mark');const p=resolveNav(g,'point',{x:10,z:20});assert.ok(p&&p!=='invalid'&&p.name==='Метка');
 g.player.x=47;g.player.z=46;const b=makeBuilding(g,'workbench',46,0,45);assert.equal((resolveNav(g,b.id,null) as {name:string}).name,'Верстак I');
 assert.equal(packStation(g,b.id),'');assert.equal(resolveNav(g,b.id,null),'invalid','station picked up');
 g.world.drops.push({id:'drop-7',x:5,z:5,items:[{itemId:'stone',count:2}]});assert.equal((resolveNav(g,'drop-7',null) as {kind:string}).kind,'drop');g.world.drops=[];assert.equal(resolveNav(g,'drop-7',null),'invalid','cargo collected');
 assert.equal(resolveNav(g,'nonsense',null),'invalid');
 assert.equal(arrived({x:0,z:0,radius:3},2,2),true);assert.equal(arrived({x:0,z:0,radius:3},3,0),false);
 assert.deepEqual(clampWaypoint(999,-999.04),{x:MAX,z:MIN});
});

test('The map mark is optional in saves: older worlds load with null, a mark round-trips, a bad one is rejected',()=>{
 const g=fresh();assert.equal(g.progress.waypoint,null);assert.deepEqual(sanitizeState(g),g);
 const old=cloneState(g) as unknown as {progress:Record<string,unknown>};delete old.progress.waypoint;assert.equal(sanitizeState(old).progress.waypoint,null,'no field: defaults to null without a version bump');
 g.progress.waypoint={x:12.5,z:-40};g.progress.selected='point';const back=sanitizeState(JSON.parse(JSON.stringify(g)));assert.deepEqual(back.progress.waypoint,{x:12.5,z:-40});assert.equal(back.progress.selected,'point');
 assert.throws(()=>sanitizeState({...g,progress:{...g.progress,waypoint:{x:9999,z:0}}}));assert.throws(()=>sanitizeState({...g,progress:{...g.progress,waypoint:'here'}}));
});

test('The full-screen map renders the covered 3D scene at 4 Hz',()=>{
 assert.equal(sceneInterval(true,true,'map-panel','high'),250);assert.equal(sceneInterval(true,true,'map-panel','low'),250);assert.equal(sceneInterval(true,true,'inventory-panel','high'),1000/15);
});
