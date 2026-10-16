/** Hand-authored Verdana layout (B1 positions, B3 terrain detail). Metres; north is +z. No production-world generator. */
import { NODES, GRASS_PATCHES, NODE_BY_ID, VEIN_LOOK, VEIN_SPOT_BY_ID, depositScale, veinNode, type Vein } from './game/resources';
import { fbm, noise2, ridged } from './noise';
/** Walkable world bounds. B4: 560 × 560 m (3.5× B3 per side); the B1–B3 arrival valley keeps its 0…160 coordinates. */
export const MIN = -200;
export const MAX = 360;
export const SIZE = MAX - MIN;
export const STEP = 1;
export const GRID = SIZE / STEP + 1;
export const TILE = 40;
export const EYE = 1.6;
export const FIXED_DT = 1 / 20;
export type Point = { x: number; z: number };
export type Landmark = Point & { id: string; name: string; short: string; kind: string; radius: number; description: string };
export const LANDMARKS: Landmark[] = [
 {id:'capsule', name:'Посадочная капсула',short:'КАПСУЛА',kind:'Убежище',x:40,z:40,radius:7,description:'Убежище и точка сохранения. Слева от выхода — каменная осыпь (48 блоков камня), к юго-западу — ещё 60 в россыпи. В капсуле дышится и заправляются баллоны, пока в ней есть кислород.'},
 {id:'base',name:'Площадка будущей базы',short:'БАЗА',kind:'16 × 16 м',x:58,z:44,radius:11,description:'Ровный участок 16 × 16 метров. Угловые метки показывают место для строительства; база здесь ещё не построена.'},
 {id:'grass',name:'Местная трава',short:'ТРАВА',kind:'Растительность',x:44,z:57,radius:5,description:'Собирается рукой. В кармане разбирается на волокно для топлива и пищевую массу. Собранные растения отрастают в активное время; ещё пять участков разбросаны по долине.'},
 {id:'iron',name:'Железный выход',short:'ЖЕЛЕЗО',kind:'Поверхностная руда',x:67,z:65,radius:6,description:'Бурая порода с тёмными металлическими прожилками и ржавыми потёками. Два выхода: 32 и 16 блоков железной руды. Добыча мультитулом — 4 с на блок. Ещё 32 блока — в жиле у входа в пещеру. Выработанный выход сам не восстанавливается: примерно через 5 минут новая жила появляется в другом месте участка.'},
 {id:'copper',name:'Медный выход',short:'МЕДЬ',kind:'Поверхностная руда',x:83,z:55,radius:6,description:'Тёмно-зелёная порода с медными жилами и зелёной патиной. Два выхода: 22 и 10 блоков медной руды, 4 с на блок. Ещё 24 блока — в жиле у раздвоенной скалы. Когда выход выработан, новая медная жила со временем появляется в другом месте.'},
 {id:'ice',name:'Ледяное углубление',short:'ЛЁД',kind:'Источник воды',x:30,z:80,radius:8,description:'Вмёрзшие плиты и осколки в низине. Глыба чистого льда (24 куска) и две ледяные плиты по 40. Мультитулом быстрее, руками тоже можно. В печи лёд с волокном даёт воду для генератора кислорода.'},
 {id:'spire',name:'Раздвоенная скала',short:'ОРИЕНТИР',kind:'Дальний ориентир',x:102,z:104,radius:15,description:'Узнаваемый силуэт для возвращения и исследования. Камни имеют упрощённые столкновения; на вершину идти не требуется.'},
 {id:'cave',name:'Вход в пещеру',short:'ПЕЩЕРА',kind:'Пробный проход',x:115,z:72,radius:9,description:'Внутрь можно войти. Короткий закрытый проход проверяет высоту и ширину; шахта, раскопки и враги появятся позже.'},
 {id:'basin',name:'Будущий водоём',short:'НИЗИНА',kind:'Сухая низина',x:100,z:132,radius:14,description:'Зарезервированная сухая область 24 × 20 метров. В макете воды нет; место не пересекается с пещерой или базой.'},

 {id:'canyon',name:'Сухое русло',short:'РУСЛО',kind:'Каньон',x:110,z:-104,radius:16,description:'Длинный врез с отвесным южным берегом и пологим северным. Около 165 м от капсулы: пешком долго, для ровера — первый дальний маршрут. На дне — песчаное русло (120 песка) и богатая железная жила (64 блока).'},
 {id:'mesa',name:'Столовая гора',short:'ПЛАТО',kind:'Дальний ориентир',x:-105,z:165,radius:18,description:'Плоская вершина над долиной, подъём по пологому восточному склону. Около 190 м от капсулы. Отсюда виден весь запад участка. У подножия — медная жила на 56 блоков.'},
 {id:'crater',name:'Старый кратер',short:'КРАТЕР',kind:'Дальний ориентир',x:265,z:255,radius:24,description:'Размытый ударный кратер около 85 м в поперечнике. Самая дальняя точка участка — около 310 м от капсулы. На дне — большой ледник: 160 кусков льда.'},
];
/** Landmarks outside the B3 valley; they motivate a future rover. */
export const FAR_IDS = ['canyon','mesa','crater'];
export const SPAWN = { x: 40, z: 42.0, yaw: 0.38 };
export type Box = { id: string; minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
export const boxes: Box[] = [];
export function box(id: string,x: number,y: number,z: number,w: number,h: number,d: number): Box {
 return {id,minX:x-w/2,maxX:x+w/2,minY:y-h/2,maxY:y+h/2,minZ:z-d/2,maxZ:z+d/2};
}
export function smooth(a:number,b:number,t:number){const u=Math.max(0,Math.min(1,t));return a+(b-a)*(u*u*(3-2*u));}
const step01=(a:number,b:number,t:number)=>{const u=Math.max(0,Math.min(1,(t-a)/(b-a)));return u*u*(3-2*u);};
const gaussian=(x:number,z:number,cx:number,cz:number,s:number)=>Math.exp(-((x-cx)**2+(z-cz)**2)/(s*s));
export function segDist(px:number,pz:number,ax:number,az:number,bx:number,bz:number){const dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/(dx*dx+dz*dz)));return Math.hypot(px-ax-dx*t,pz-az-dz*t);}
export const CANYON:[number,number][]=[[-230,-40],[-150,-72],[-60,-58],[20,-92],[110,-108],[175,-78],[240,-102],[310,-62],[390,-78]];
export const MESA={x:-105,z:165,r:36,top:17};
export const CRATER={x:265,z:255,r:42};
/** Signed distance to the canyon centre line (positive = north bank). */
export function canyonDist(x:number,z:number){
 let best=Infinity,side=1;
 for(let i=0;i<CANYON.length-1;i++){const [ax,az]=CANYON[i],[bx,bz]=CANYON[i+1],d=segDist(x,z,ax,az,bx,bz);if(d<best){best=d;side=Math.sign((bx-ax)*(z-az)-(bz-az)*(x-ax))||1;}}
 return best*side;
}
/** Distance from the arrival valley; 0 inside, grows outward. Blends the gentle B3 valley into wilder terrain. */
export const coreBlend=(x:number,z:number)=>step01(88,160,Math.hypot(x-80,(z-78)*1.05)+fbm(x*.01,z*.01,2,5)*22);
export function rawHeight(x:number,z:number){
 // Arrival valley: broad dunes and low hills; walkable at 1 m cells (see tests).
 let h=0.8*Math.sin(x*.056)*Math.cos(z*.049)+.32*Math.sin(x*.19+z*.12)+.9*fbm(x*.028,z*.028,3,11)+.07*noise2(x*.45,z*.45,23);
 h+=3.4*gaussian(x,z,93,110,20)+2.8*gaussian(x,z,137,53,15)+3.2*gaussian(x,z,10,120,18)+2.4*gaussian(x,z,78,14,14)+2.6*gaussian(x,z,145,140,17)+1.8*gaussian(x,z,8,40,12);
 h-=1.5*gaussian(x,z,30,80,13)+1.6*gaussian(x,z,100,132,15);
 // East hillside the cave cuts into.
 h+=9*Math.exp(-(((x-152)/20)**2)-(((z-72)/34)**2));
 // Wild terrain: rolling hills, ridge lines and occasional broad basins.
 const k=coreBlend(x,z);
 if(k>0){
  // Domain-warped, rotated sampling hides the value-noise grid (no axis-aligned ridges).
  const wx=x+22*fbm(x*.008,z*.008,2,201),wz=z+22*fbm(x*.008+7,z*.008,2,203),rx=wx*.8-wz*.6,rz=wx*.6+wz*.8;
  const r=ridged(rx*.0046+1.7,rz*.0046-3.1,4,107);
  const wild=2+6*fbm(rz*.006,-rx*.006,4,101)+7*fbm(rx*.014+5,rz*.014,3,103)+30*r*r*r;
  h=h*(1-k)+wild*k;
 }
 // Mesa: steep scarps with one gentle eastern ramp towards the valley.
 {const dx=x-MESA.x,dz=z-MESA.z,d=Math.hypot(dx,dz)+fbm(x*.04,z*.04,3,61)*7,ramp=step01(.55,.92,(dx*.83+dz*-.56)/(Math.hypot(dx,dz)||1));
  const w=8+46*ramp,t=step01(MESA.r+w,MESA.r,d);h=h*(1-t)+(MESA.top+fbm(x*.08,z*.08,2,62)*.8)*t;}
 // Crater: raised rim, bowl and flat floor.
 {const d=Math.hypot(x-CRATER.x,z-CRATER.z)+fbm(x*.03,z*.03,3,71)*5;
  h+=7*Math.exp(-(((d-CRATER.r)/12)**2));h-=10*step01(CRATER.r+6,CRATER.r-30,d);}
 // Dry riverbed: steep south cliff, gentle north bank, flat floor.
 {const s=canyonDist(x,z)+fbm(x*.02,z*.02,3,81)*6,a=Math.abs(s),w=s>0?24:9;h-=8.5*step01(5+w,5,a);h+=.35*noise2(x*.2,z*.2,83)*step01(8,0,a);}
 // World edge: a steep mountain wall.
 const edge=Math.max(0,(46-Math.min(x-MIN,z-MIN,MAX-x,MAX-z))/46);h+=edge*edge*(38+14*(fbm(x*.03,z*.03,3,71)+.5));
 for(const p of [{x:40,z:40,r:6,h:.5},{x:58,z:44,r:13,h:.5},{x:44,z:57,r:4,h:.35},{x:67,z:65,r:5,h:.3},{x:83,z:55,r:5,h:.5}]){
  const d=Math.hypot(x-p.x,z-p.z); if(d<p.r+5)h=smooth(p.h,h,(d-p.r)/5);
 }
 // Same heightfield floor continues into the short cave; there is no invisible roof terrain.
 const dx=Math.max(0,113-x,x-135),dz=Math.max(0,65-z,z-79),d=Math.hypot(dx,dz);
 if(d<5)h=smooth(.35,h,d/5);
 return h;
}
/** Collision heights on a 1 m grid, computed lazily per 40 m tile (the whole grid is 561² samples). */
export const heights = new Float32Array(GRID*GRID).fill(NaN);
function fillTile(tx:number,tz:number){
 for(let iz=tz*TILE;iz<=Math.min(GRID-1,tz*TILE+TILE);iz++)for(let ix=tx*TILE;ix<=Math.min(GRID-1,tx*TILE+TILE);ix++){const i=iz*GRID+ix;if(heights[i]!==heights[i])heights[i]=rawHeight(MIN+ix*STEP,MIN+iz*STEP);}
}
export function gridHeight(ix:number,iz:number){
 const i=iz*GRID+ix;let h=heights[i];
 if(h!==h){fillTile(Math.min(SIZE/TILE-1,Math.floor(ix/TILE)),Math.min(SIZE/TILE-1,Math.floor(iz/TILE)));h=heights[i];}
 return h;
}
/** Exact same triangle split as the visible mesh, including on slopes. */
export function heightAt(x:number,z:number){
 const gx=(Math.max(MIN,Math.min(MAX-.0001,x))-MIN)/STEP,gz=(Math.max(MIN,Math.min(MAX-.0001,z))-MIN)/STEP;
 const ix=Math.floor(gx),iz=Math.floor(gz),u=gx-ix,v=gz-iz;
 const a=gridHeight(ix,iz),b=gridHeight(ix+1,iz),c=gridHeight(ix,iz+1),d=gridHeight(ix+1,iz+1);
 return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
}
/** Stations stand on the terrain under their 3×3 footprint samples (S4: glass blocks are not bodies). */
export const stationY=(x:number,z:number)=>Math.max(...[-.5,0,.5].flatMap(dx=>[-.5,0,.5].map(dz=>heightAt(x+dx,z+dz))))+.12;
export function random(seed=78191){let s=seed;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
export const ROCKS: {x:number;z:number;s:number;sy:number;rotation:number}[]=[];
const rand=random();
for(let i=0;i<150;i++){
 const x=8+rand()*144,z=8+rand()*144;
 // Protected breathing room around points and a wide walkable central valley.
 if(LANDMARKS.some(p=>Math.hypot(x-p.x,z-p.z)<p.radius+4))continue;
 const s=.6+rand()*2.5;
 ROCKS.push({x,z,s,sy:s*(.65+rand()*.5),rotation:rand()*Math.PI});
}
const wildRand=random(9127);
const nearLandmark=(x:number,z:number,pad:number)=>LANDMARKS.some(p=>Math.hypot(x-p.x,z-p.z)<p.radius+pad);
for(let i=0;i<520;i++){
 const x=MIN+30+wildRand()*(SIZE-60),z=MIN+30+wildRand()*(SIZE-60);
 if(x>0&&x<160&&z>0&&z<160)continue;if(nearLandmark(x,z,5))continue;
 const s=.5+wildRand()*wildRand()*3.2;
 ROCKS.push({x,z,s,sy:s*(.6+wildRand()*.5),rotation:wildRand()*Math.PI});
}
/** Large rock formations outside the valley: tapered buttresses and tors sitting on the lowest ground under them. */
export const FORMATIONS:{x:number;z:number;w:number;d:number;h:number;base:number;rotation:number;shape:number}[]=[];
{
 const fr=random(6203);let guard=0;
 while(FORMATIONS.length<84&&guard++<4000){
  const x=MIN+40+fr()*(SIZE-80),z=MIN+40+fr()*(SIZE-80);
  if(coreBlend(x,z)<.35||nearLandmark(x,z,16))continue;
  if(Math.hypot(x-MESA.x,z-MESA.z)<MESA.r-4)continue;
  if(Math.abs(canyonDist(x,z))<7)continue;
  if(FORMATIONS.some(f=>Math.hypot(f.x-x,f.z-z)<f.w+10))continue;
  const w=3+fr()*6,h=4+fr()*12;
  let base=Infinity;for(const [dx,dz] of [[0,0],[w,0],[-w,0],[0,w],[0,-w]])base=Math.min(base,heightAt(x+dx,z+dz));
  FORMATIONS.push({x,z,w,d:w*(.6+fr()*.5),h,base,rotation:fr()*6.28,shape:Math.floor(fr()*6)});
 }
}
export function makeColliders(){
 boxes.length=0;
 // Capsule floor, two side walls and back. +z faces the valley; a 1.7m door gap.
 const h=heightAt(40,40);
 boxes.push(box('capsule-floor',40,h+.07,40,5,.14,6));
 boxes.push(box('capsule-left',37.6,h+1.9,40,.35,3.8,6));
 boxes.push(box('capsule-right',42.4,h+1.9,40,.35,3.8,6));
 boxes.push(box('capsule-back',40,h+1.9,37.1,5,3.8,.35));
 boxes.push(box('capsule-front-left',38.3,h+1.9,42.9,1.55,3.8,.35));
 boxes.push(box('capsule-front-right',41.7,h+1.9,42.9,1.55,3.8,.35));
 boxes.push(box('capsule-lintel',40,h+3.1,42.9,1.85,1.6,.35));
 boxes.push(box('capsule-roof',40,h+4.18,40,4,.25,5));
 boxes.push(box('capsule-berth',38.12,h+.46,39.5,.8,.9,2.5));
 boxes.push(box('capsule-console',41.35,h+.87,37.7,1.3,1.6,.65));
 boxes.push(box('capsule-bottles',39.15,h+.73,37.55,1,.9,.42));
 boxes.push(box('capsule-rack',41.98,h+.95,40,.55,1.9,1.9));
 boxes.push(box('capsule-threshold',40,h+.085,43.48,2.1,.17,.8));
 // Two supply crates unloaded beside the capsule; clear of the doorway and ramp.
 boxes.push(box('crate-a',44.8,heightAt(44.8,41.4)+.4,41.4,1.2,.8,.85));
 boxes.push(box('crate-b',35.5,heightAt(35.5,43.6)+.35,43.6,.9,.7,.9));
 // Cave is a horizontal, 5m-wide, 4m-high dead-end passage. No excavating in B1.
 boxes.push(box('cave-south',123,4.1,67.6,20,7.5,3));
 boxes.push(box('cave-north',123,4.1,76.4,20,7.5,3));
 boxes.push(box('cave-roof',123,6.4,72,20,3.6,6));
 boxes.push(box('cave-end',132.4,2.6,72,1.2,4.5,6));
 for(const [i,r] of ROCKS.entries())boxes.push(box('rock-'+i,r.x,heightAt(r.x,r.z)+r.sy*.51,r.z,r.s*1.4,r.sy*1.02,r.s*1.4));
 boxes.push(box('iron-outcrop',67,heightAt(67,65)+.7,65,3.6,1.7,3));
 boxes.push(box('copper-outcrop',83,heightAt(83,55)+.7,55,3.6,1.7,3));
 // Mineable deposits: each main body loses its own collider when depleted.
 boxes.push(box('stone-outcrop',30,heightAt(30,52)+.45,52,2.2,.9,2.2));
 boxes.push(box('ice-outcrop',33,heightAt(33,76.5)+.5,76.5,1.8,1,1.8));
 for(const n of NODES)if(n.box){const [w,h,d]=n.box;boxes.push(box('node-'+n.id,n.x,heightAt(n.x,n.z)+h/2-.1,n.z,w,h,d));}
 // Footprint of the rotated formation (geometry spans ±w × ±d): axis-aligned bounds of its elliptical base.
 for(const [i,f] of FORMATIONS.entries()){const c=Math.cos(f.rotation),s=Math.sin(f.rotation),hx=Math.hypot(f.w*c,f.d*s),hz=Math.hypot(f.w*s,f.d*c);boxes.push(box('formation-'+i,f.x,f.base+f.h/2,f.z,hx*1.9,f.h,hz*1.9));}
 boxes.push(box('spire-a',100,heightAt(100,103)+8,103,5,16,6));
 boxes.push(box('spire-b',106,heightAt(106,104)+6.5,104,4,13,5));
 FIXED=boxes.map(b=>({...b}));
 return boxes;
}
let FIXED:Box[]=[];
/** Each mineral collider and its deposit: it squats with the stock (depositScale) and is gone at zero. */
const MINERALS=new Map<string,string>([['iron-outcrop','iron-a'],['copper-outcrop','copper-a'],['stone-outcrop','stone-a'],['ice-outcrop','ice-a'],...NODES.filter(n=>n.box).map(n=>['node-'+n.id,n.id] as [string,string])]);
/**
 * Static colliders of one saved world, pure (never the live `boxes`): the fixed ones (capsule, crates, cave, rocks),
 * every mineral squatting with its deposit's stock (none at zero) and each live vein (S4, D33). applyNodes in main lays
 * them into `boxes`; the v7 → v8 room migration checks airlock landings against the migrated save's own list.
 * `veins` may be raw save data: an entry without a known spot and material is skipped (strict validation comes later).
 */
export function worldColliders(nodes:Readonly<Record<string,unknown>>,veins:readonly unknown[]):Box[]{
 const out:Box[]=[];
 for(const b of FIXED){const id=MINERALS.get(b.id);if(!id){out.push({...b});continue;}
  const n=NODE_BY_ID.get(id)!,left=Number(nodes[id]??n.amount);if(!(left>0))continue;
  const {xz,y}=depositScale(left,n.amount),cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2;
  out.push({...b,minX:cx+(b.minX-cx)*xz,maxX:cx+(b.maxX-cx)*xz,minZ:cz+(b.minZ-cz)*xz,maxZ:cz+(b.maxZ-cz)*xz,maxY:b.minY+(b.maxY-b.minY)*y});}
 for(const raw of veins){
  const v=raw as Vein;if(!v||typeof v!=='object'||!VEIN_SPOT_BY_ID.has(v.spot)||!Object.hasOwn(VEIN_LOOK,v.material)||!(Number(v.amount)>0)||!(Number(v.size)>0))continue;
  const n=veinNode(v),[bw,bh,bd]=n.box!,{xz,y}=depositScale(v.amount,v.size),y0=heightAt(n.x,n.z)-.1;out.push(box(String(v.id),n.x,y0+bh*y/2,n.z,bw*xz,bh*y,bd*xz));}
 return out;
}
makeColliders();

/** B1 produced 1,218 accepted tufts; B2 uses 244 (one fifth), 84% in patches. */
export { GRASS_PATCHES };
export const GRASS: {x:number;z:number;s:number;rotation:number;patch:number}[]=[];
const grassRandom=random(4242);
for(let i=0;i<244;i++){
 const patch=i<204?Math.floor(i/34):-1;
 let x=0,z=0;
 for(let attempt=0;attempt<200;attempt++){
  if(patch>=0){const p=GRASS_PATCHES[patch],a=grassRandom()*Math.PI*2,r=Math.sqrt(grassRandom());x=p.x+Math.cos(a)*p.rx*r;z=p.z+Math.sin(a)*p.rz*r;}
  else{x=15+grassRandom()*130;z=15+grassRandom()*130;}
  if(Math.hypot(x-40,z-40)>8&&Math.hypot(x-58,z-44)>14&&!(x>108&&x<140&&z>60&&z<84)&&Math.hypot(x-30,z-80)>13&&heightAt(x,z)<4)break;
 }
 GRASS.push({x,z,s:.45+grassRandom()*.45,rotation:grassRandom()*Math.PI*2,patch});
}
