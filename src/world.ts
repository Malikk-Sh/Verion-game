/** Hand-authored Verdana layout (B1 positions, B3 terrain detail). Metres; north is +z. No production-world generator. */
import { fbm, noise2 } from './noise';
export const SIZE = 160;
export const STEP = 1;
export const GRID = SIZE / STEP + 1;
export const EYE = 1.6;
export const FIXED_DT = 1 / 20;
export type Point = { x: number; z: number };
export type Landmark = Point & { id: string; name: string; short: string; kind: string; radius: number; description: string };
export const LANDMARKS: Landmark[] = [
 {id:'capsule', name:'Посадочная капсула',short:'КАПСУЛА',kind:'Убежище',x:40,z:40,radius:7,description:'Начало маршрута. Войдите внутрь и проверьте ширину прохода. Кислород и герметичность появятся на следующем игровом этапе.'},
 {id:'base',name:'Площадка будущей базы',short:'БАЗА',kind:'16 × 16 м',x:58,z:44,radius:11,description:'Ровный участок 16 × 16 метров. Угловые метки показывают место для строительства; база здесь ещё не построена.'},
 {id:'grass',name:'Местная трава',short:'ТРАВА',kind:'Растительность',x:44,z:57,radius:5,description:'Первый заметный ресурс. Пучки служат проверкой силуэта и масштаба. Сбор пищи в этом макете ещё не подключён.'},
 {id:'iron',name:'Железный выход',short:'ЖЕЛЕЗО',kind:'Поверхностная руда',x:67,z:65,radius:6,description:'Тёмные слоистые включения. Обойдите выход и оцените, узнаётся ли он без подписи; добычи пока нет.'},
 {id:'copper',name:'Медный выход',short:'МЕДЬ',kind:'Поверхностная руда',x:83,z:55,radius:6,description:'Медно-оранжевые узлы отличаются от железа формой. Это образец расположения, не окончательная модель руды.'},
 {id:'ice',name:'Ледяное углубление',short:'ЛЁД',kind:'Будущий источник воды',x:30,z:80,radius:8,description:'Светлые ледяные выходы у породы. Сюда ведёт пологий спуск; маршрут должен оставаться доступным без прыжков.'},
 {id:'spire',name:'Раздвоенная скала',short:'ОРИЕНТИР',kind:'Дальний ориентир',x:102,z:104,radius:15,description:'Узнаваемый силуэт для возвращения и исследования. Камни имеют упрощённые столкновения; на вершину идти не требуется.'},
 {id:'cave',name:'Вход в пещеру',short:'ПЕЩЕРА',kind:'Пробный проход',x:115,z:72,radius:9,description:'Внутрь можно войти. Короткий закрытый проход проверяет высоту и ширину; шахта, раскопки и враги появятся позже.'},
 {id:'basin',name:'Будущий водоём',short:'НИЗИНА',kind:'Сухая низина',x:100,z:132,radius:14,description:'Зарезервированная сухая область 24 × 20 метров. В макете воды нет; место не пересекается с пещерой или базой.'},
];
export const ROUTE = ['grass','iron','copper','ice','cave','capsule'];
export const SPAWN = { x: 40, z: 42.0, yaw: 0.38 };
export type Box = { id: string; minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
export const boxes: Box[] = [];
export function box(id: string,x: number,y: number,z: number,w: number,h: number,d: number): Box {
 return {id,minX:x-w/2,maxX:x+w/2,minY:y-h/2,maxY:y+h/2,minZ:z-d/2,maxZ:z+d/2};
}
export function smooth(a:number,b:number,t:number){const u=Math.max(0,Math.min(1,t));return a+(b-a)*(u*u*(3-2*u));}
const gaussian=(x:number,z:number,cx:number,cz:number,s:number)=>Math.exp(-((x-cx)**2+(z-cz)**2)/(s*s));
export function rawHeight(x:number,z:number){
 const edge=Math.max(0,(17-Math.min(x,z,SIZE-x,SIZE-z))/17);
 // Broad dunes and a little ground roughness; slopes stay walkable (tested at 1 m cells).
 let h=0.8*Math.sin(x*.056)*Math.cos(z*.049)+.32*Math.sin(x*.19+z*.12)+edge*edge*(10+5*(fbm(x*.03,z*.03,3,71)+.5));
 h+=.55*fbm(x*.028,z*.028,3,11)+.07*noise2(x*.45,z*.45,23);
 h+=3.4*gaussian(x,z,93,110,20)+2.8*gaussian(x,z,137,53,15);
 h-=1.5*gaussian(x,z,30,80,13)+1.6*gaussian(x,z,100,132,15);
 for(const p of [{x:40,z:40,r:6,h:.5},{x:58,z:44,r:13,h:.5},{x:44,z:57,r:4,h:.35},{x:67,z:65,r:5,h:.3},{x:83,z:55,r:5,h:.5}]){
  const d=Math.hypot(x-p.x,z-p.z); if(d<p.r+5)h=smooth(p.h,h,(d-p.r)/5);
 }
 // Same heightfield floor continues into the short cave; there is no invisible roof terrain.
 const dx=Math.max(0,113-x,x-135),dz=Math.max(0,65-z,z-79),d=Math.hypot(dx,dz);
 if(d<5)h=smooth(.35,h,d/5);
 return h;
}
export const heights = Float32Array.from({length:GRID*GRID},(_,i)=>rawHeight((i%GRID)*STEP,Math.floor(i/GRID)*STEP));
/** Exact same triangle split as the visible mesh, including on slopes. */
export function heightAt(x:number,z:number){
 const gx=Math.max(0,Math.min(SIZE-.0001,x))/STEP,gz=Math.max(0,Math.min(SIZE-.0001,z))/STEP;
 const ix=Math.floor(gx),iz=Math.floor(gz),u=gx-ix,v=gz-iz,i=iz*GRID+ix;
 const a=heights[i],b=heights[i+1],c=heights[i+GRID],d=heights[i+GRID+1];
 return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
}
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
 boxes.push(box('spire-a',100,heightAt(100,103)+8,103,5,16,6));
 boxes.push(box('spire-b',106,heightAt(106,104)+6.5,104,4,13,5));
 return boxes;
}
makeColliders();

/** B1 produced 1,218 accepted tufts; B2 uses 244 (one fifth), 84% in patches. */
export const GRASS_PATCHES = [
 {x:44,z:57,rx:4.5,rz:3.4}, {x:28,z:76,rx:4.5,rz:2.6},
 {x:70,z:90,rx:6,rz:3.8}, {x:99,z:128,rx:5,rz:3},
 {x:136,z:104,rx:4,rz:5}, {x:59,z:114,rx:4.3,rz:3.5},
];
export const GRASS: {x:number;z:number;s:number;rotation:number;patch:number}[]=[];
const grassRandom=random(4242);
for(let i=0;i<244;i++){
 const patch=i<204?Math.floor(i/34):-1;
 let x=0,z=0;
 for(let attempt=0;attempt<200;attempt++){
  if(patch>=0){const p=GRASS_PATCHES[patch],a=grassRandom()*Math.PI*2,r=Math.sqrt(grassRandom());x=p.x+Math.cos(a)*p.rx*r;z=p.z+Math.sin(a)*p.rz*r;}
  else{x=15+grassRandom()*130;z=15+grassRandom()*130;}
  if(Math.hypot(x-40,z-40)>8&&Math.hypot(x-58,z-44)>14&&!(x>108&&x<140&&z>60&&z<84)&&heightAt(x,z)<4)break;
 }
 GRASS.push({x,z,s:.45+grassRandom()*.45,rotation:grassRandom()*Math.PI*2,patch});
}
