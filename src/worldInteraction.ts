import * as THREE from 'three';
import { BUILDABLE, type BuildingKind } from './game/defs';
import { electricPort, endpoint, connect, machine } from './game/production';
import { place, placementProblem } from './buildings';
import { heightAt, boxes } from './world';
import type { GameState } from './game/state';
export function createWorldInteraction(scene:THREE.Scene,camera:THREE.Camera){
 const material=new THREE.MeshBasicMaterial({color:0x64e6bd,transparent:true,opacity:.32,depthWrite:false}),ghost=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material);scene.add(ghost);ghost.visible=false;
 const wire=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x68daeb}));scene.add(wire);wire.visible=false;
 const ray=new THREE.Raycaster(),direction=new THREE.Vector3();let x=0,z=0,problem='',source:string|null=null,selection='',target:string|null=null;
 function aim(g:GameState){camera.getWorldDirection(direction);ray.set(camera.position,direction);let best=3.7;target=null;
  for(const b of g.world.base.buildings){const r=b.kind==='dome'?2.5:.55,h=b.kind==='dome'?3:1.6,box=new THREE.Box3(new THREE.Vector3(b.x-r,b.y,b.z-r),new THREE.Vector3(b.x+r,b.y+h,b.z+r)),hit=ray.ray.intersectBox(box,new THREE.Vector3());if(hit){const d=hit.distanceTo(camera.position);if(d<best){best=d;target=b.id;}}}
  for(const b of boxes.filter(b=>b.id.startsWith('crate-'))){const hit=ray.ray.intersectBox(new THREE.Box3(new THREE.Vector3(b.minX,b.minY,b.minZ),new THREE.Vector3(b.maxX,b.maxY,b.maxZ)),new THREE.Vector3());if(hit&&hit.distanceTo(camera.position)<best){best=hit.distanceTo(camera.position);target=b.id;}}
  if(!target&&g.player.x>37.5&&g.player.x<42.5&&g.player.z>37&&g.player.z<43.1)target='capsule';
 }
 function update(g:GameState|null,active:boolean){ghost.visible=wire.visible=false;if(!g||!active){target=null;return;}aim(g);const id=g.player.inventory[g.player.hotbar]?.itemId??'';if(selection!==id){source=null;selection=id;}
  if((BUILDABLE as readonly string[]).includes(id)){
   let hit:THREE.Vector3|undefined;for(let d=.5;d<=12;d+=.1){const p=ray.ray.at(d,new THREE.Vector3());if(p.y<=heightAt(p.x,p.z)+.12){hit=p;break;}}
   if(hit){x=Math.round(hit.x);z=Math.round(hit.z);problem=placementProblem(g,id as BuildingKind,x,z);const r=id==='dome'?5:1,h=id==='dome'?3:1.4;ghost.position.set(x,heightAt(x,z)+h/2+.12,z);ghost.scale.set(r,h,r);material.color.set(problem?0xe76d62:0x64e6bd);ghost.visible=true;}else problem='Наведите на землю в пределах 12 м';
  }else if(source&&(id==='cable'||id==='gas_pipe')){const a=endpoint(g,source);if(!a){source=null;return;}const b=target?endpoint(g,target):null;const to=b?new THREE.Vector3(b.x,b.y+.25,b.z):ray.ray.at(3,new THREE.Vector3());wire.geometry.dispose();wire.geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.x,a.y+.25,a.z),to]);wire.visible=true;}
 }
 function action(g:GameState):string|null{const id=g.player.inventory[g.player.hotbar]?.itemId??'';
  if((BUILDABLE as readonly string[]).includes(id))return problem||place(g,id as BuildingKind,x,z);
  if(id==='cable'||id==='gas_pipe'){
   const b=target?endpoint(g,target):null;if(!b)return 'Наведите на порт станции';const body=target?machine(g,target):null;
   if(id==='cable'&&(!body||!electricPort(body)))return 'У станции нет электрического порта';
   if(id==='gas_pipe'&&target!=='capsule'&&!body?.kind.match(/^(electrolyzer|refill|distributor)$/))return 'Нужен кислородный порт';
   if(!source){source=target;return 'Первый порт выбран. Наведите на второй';}
   let from=source,to=target!;if(id==='gas_pipe'&&machine(g,from)?.kind!=='electrolyzer')[from,to]=[to,from];const error=connect(g,id,from,to);if(!error)source=null;return error;
  }return null;
 }
 return {update,action,cancel:()=>{source=null;},get target(){return target;},get building(){return (BUILDABLE as readonly string[]).includes(selection);},get linking(){return selection==='cable'||selection==='gas_pipe';},get hint(){return source?'Выберите второй порт · Esc отмена':'Выберите первый порт';},get problem(){return problem;}};
}
