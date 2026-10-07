import * as THREE from 'three';
import { boxes, box, heightAt, type Box } from './world';
import { BUILDABLE, ITEMS, type BuildingKind } from './game/defs';
import { removeItems } from './game/inventory';
import { insideDome, makeBuilding, domeFaces, type Building } from './game/production';
import type { GameState } from './game/state';
export function placementProblem(g: GameState, kind: BuildingKind, x: number, z: number): string {
 if(!(BUILDABLE as readonly string[]).includes(kind)||!Number.isInteger(x)||!Number.isInteger(z))return 'Выберите корпус и клетку';
 if(g.world.base.buildings.length>=64)return 'Достигнут предел 64 корпусов';
 if(x < -195 || x > 355 || z < -195 || z > 355)return 'За границей участка';
 if(Math.hypot(x-g.player.x,z-g.player.z)>12)return 'Место дальше 12 м: подойдите ближе';
 const r=kind==='dome'?2.5:.48;
 if(Math.abs(x-g.player.x)<r+.4&&Math.abs(z-g.player.z)<r+.4)return 'Место занято персонажем';
 if(x+r>36.7&&x-r<43.3&&z+r>36.5&&z-r<47)return 'Оставьте вход капсулы свободным';
 if(Math.abs(x-100)<12+r&&Math.abs(z-132)<10+r)return 'Здесь зарезервирован будущий водоём';
 const y=heightAt(x,z),heights=[];for(const dx of [-r,0,r])for(const dz of [-r,0,r])heights.push(heightAt(x+dx,z+dz));
 if(Math.max(...heights)-Math.min(...heights)>.5)return 'Неровное основание: перепад больше 0,5 м';
 for(const b of g.world.base.buildings){const br=b.kind==='dome'?2.5:.48;
  if(b.kind==='dome'&&kind!=='dome'&&insideDome(b,x,b.y+.1,z))continue;
  if(Math.abs(x-b.x)<r+br+.1&&Math.abs(z-b.z)<r+br+.1)return 'Место занято постройкой';
 }
 for(const b of boxes)if(!b.id.startsWith('build-')&&x+r>b.minX&&x-r<b.maxX&&z+r>b.minZ&&z-r<b.maxZ&&y+3>b.minY&&y<b.maxY)return 'Место занято объектом';
 return '';
}
export function place(g: GameState, kind: BuildingKind, x: number, z: number): string {
 const problem=placementProblem(g,kind,x,z);if(problem)return problem;
 if(!removeItems(g.player.inventory,kind,1))return 'В рюкзаке нет: '+ITEMS[kind].name;
 const dome=g.world.base.buildings.find(b=>insideDome(b,x,b.y+.1,z)),y=dome?dome.y:Math.max(...[-2.5,0,2.5].flatMap(dx=>[-2.5,0,2.5].map(dz=>heightAt(x+(kind==='dome'?dx:dx*.2),z+(kind==='dome'?dz:dz*.2)))))+.12;
 makeBuilding(g,kind,x,y,z);return '';
}
/** Procedural low-poly shells and visible explicit links; shared materials. */
export function createBuildings(scene: THREE.Scene) {
 const root=new THREE.Group();scene.add(root);
 const hull=new THREE.MeshStandardMaterial({color:0xd5d8ce,roughness:.78}),dark=new THREE.MeshStandardMaterial({color:0x203a3d,roughness:.85}),orange=new THREE.MeshStandardMaterial({color:0xe97632,roughness:.7}),blue=new THREE.MeshStandardMaterial({color:0x55aebb,roughness:.55});
 const glass=new THREE.MeshStandardMaterial({color:0x83c6ce,transparent:true,opacity:.22,roughness:.2,depthWrite:false,side:THREE.DoubleSide});
 const wood=new THREE.MeshStandardMaterial({color:0xc1a383,roughness:.92}),steel=new THREE.MeshStandardMaterial({color:0x747b7f,roughness:.68,metalness:.25});
 const geometry=new THREE.BoxGeometry(1,1,1);let key='';
 const cube=(parent:THREE.Group,mat:THREE.Material,x:number,y:number,z:number,w:number,h:number,d:number)=>{const m=new THREE.Mesh(geometry,mat);m.position.set(x,y,z);m.scale.set(w,h,d);m.castShadow=m.receiveShadow=true;parent.add(m);};
 function workbench(group:THREE.Group,level:number){
  const batches=new Map<THREE.Material,THREE.Matrix4[]>();
  const part=(mat:THREE.Material,x:number,y:number,z:number,w:number,h:number,d:number)=>{const matrix=new THREE.Matrix4().makeScale(w,h,d);matrix.setPosition(x,y,z);if(!batches.has(mat))batches.set(mat,[]);batches.get(mat)!.push(matrix);};
  // Open legs, a lower shelf, an orange rim and a small vise match the item portraits.
  for(const x of [-.39,.39])for(const z of [-.27,.27]){part(steel,x,.42,z,.085,.8,.085);part(dark,x,-.025,z,.13,.22,.13);}
  part(steel,0,.24,0,.85,.055,.64);part(wood,0,.28,0,.77,.04,.56);
  part(steel,0,.82,-.30,.85,.07,.06);part(steel,-.39,.8,0,.06,.07,.62);part(steel,.39,.8,0,.06,.07,.62);
  part(hull,0,.90,0,.98,.09,.78);part(wood,0,.955,0,.92,.025,.72);part(orange,0,.89,.395,.90,.035,.02);
  part(steel,-.25,.99,.02,.20,.035,.23);part(dark,-.25,1.025,.02,.10,.05,.16);
  part(steel,-.31,1.05,.02,.045,.08,.17);part(steel,-.19,1.05,.02,.045,.08,.17);part(steel,-.25,1.035,.15,.035,.035,.18);
  if(level===2){
   for(const x of [-.36,.36])part(steel,x,1.18,-.25,.09,.50,.09);
   part(hull,0,1.435,-.25,.88,.12,.17);part(steel,0,1.385,-.23,.72,.035,.075);
   part(orange,.20,1.35,-.22,.22,.18,.20);part(dark,.20,1.26,-.18,.085,.10,.085);
   part(blue,-.27,1.438,-.15,.09,.035,.012);part(dark,.34,.65,-.22,.18,.24,.20);
   part(orange,.34,.65,-.105,.12,.10,.015);part(steel,.11,.988,.03,.36,.04,.34);
  }
  for(const [mat,matrices] of batches){const mesh=new THREE.InstancedMesh(geometry,mat,matrices.length);matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));mesh.instanceMatrix.needsUpdate=true;mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);}
 }
 function sync(g:GameState){const next=JSON.stringify([g.world.base.buildings.map(b=>[b.id,b.kind,b.level,b.x,b.y,b.z,b.zone.shell]),g.world.base.links]);if(next===key)return;key=next;root.traverse(o=>{if(o instanceof THREE.InstancedMesh)o.dispose();});root.clear();for(let i=boxes.length-1;i>=0;i--)if(boxes[i].id.startsWith('build-'))boxes.splice(i,1);
  for(const b of g.world.base.buildings){const group=new THREE.Group();group.name=b.id;group.position.set(b.x,b.y,b.z);root.add(group);
   if(b.kind==='dome'){
    const faces=domeFaces(),wallMatrices:THREE.Matrix4[]=[],panelMatrices:THREE.Matrix4[]=[];
    for(let i=0;i<faces.length;i++)if(b.zone.shell[i]>0){const f=faces[i],d=f.next.map((n,j)=>n-f.cell[j]),cx=f.cell[0]-1.5+d[0]*.53,cy=f.cell[1]+.5+d[1]*.53,cz=f.cell[2]-1.5+d[2]*.53,w=d[0]?.06:1,h=d[1]?.06:1,depth=d[2]?.06:1;
     const matrix=new THREE.Matrix4().makeScale(w,h,depth);matrix.setPosition(cx,cy,cz);(d[1]?panelMatrices:wallMatrices).push(matrix);
     boxes.push(box(b.id+'-face-'+i,b.x+cx,b.y+cy,b.z+cz,w,h,depth));
    }
    for(const [mat,matrices] of [[glass,wallMatrices],[hull,panelMatrices]] as const){const mesh=new THREE.InstancedMesh(geometry,mat,matrices.length);matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);}
    for(const x of [-2.425,2.425])for(const z of [-2.425,2.425])cube(group,hull,x,1.85,z,.15,4,.15);
    cube(group,orange,0,2.6,2.3,1.2,.2,.6);cube(group,dark,0,1.15,2.06,1,2.3,.06);
   }else if(b.kind==='workbench'){
    workbench(group,b.level);const h=b.level===2?1.5:1.1;boxes.push(box(b.id,b.x,b.y+h/2,b.z,.98,h,.78));
   }else{
    const h=b.kind==='kiln'?1.3:1.4;
    cube(group,dark,0,h/2,0,.9,h,.9);cube(group,hull,0,h*.65,0,.94,h*.38,.94);cube(group,b.kind==='electrolyzer'||b.kind==='refill'?blue:orange,0,h*.5,.48,.6,.16,.06);
    if(b.kind==='biogenerator'||b.kind==='kiln')cube(group,orange,.24,h+.2,0,.18,.45,.18);
    boxes.push(box(b.id,b.x,b.y+h/2,b.z,.92,h,.92));
   }
  }
  for(const l of g.world.base.links){const a=g.world.base.buildings.find(b=>b.id===l.from)!,b=l.to==='capsule'?{x:40,y:heightAt(40,40),z:40}:g.world.base.buildings.find(b=>b.id===l.to)!;
   const from=new THREE.Vector3(a.x,a.y+.22,a.z),to=new THREE.Vector3(b.x,b.y+.22,b.z),delta=to.clone().sub(from),m=new THREE.Mesh(geometry,l.kind==='cable'?orange:blue);m.position.copy(from.add(to).multiplyScalar(.5));m.scale.set(.06,delta.length(),.06);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());root.add(m);
  }
 }
 return {sync,root};
}
