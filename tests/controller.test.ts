import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Character} from '../src/controller.ts';
import {boxes,box,heightAt,FIXED_DT,STEP,MIN,MAX,gridHeight,rawHeight,LANDMARKS,FAR_IDS} from '../src/world.ts';
const idle={forward:0,right:0,run:false,jump:false};
const walk=(p:Character,seconds:number,input={...idle,forward:1})=>{for(let i=0;i<seconds/FIXED_DT;i++)p.step(FIXED_DT,input);};

test('height sampling uses exactly the terrain triangle split',()=>{
 for(const [x,z]of[[4.6,10.8],[58.7,87.6],[151.7,141.6],[-150.3,-120.8],[300.2,299.9]]){
  const ix=Math.floor((x-MIN)/STEP),iz=Math.floor((z-MIN)/STEP),u=(x-MIN)/STEP-ix,v=(z-MIN)/STEP-iz;
  const a=gridHeight(ix,iz),b=gridHeight(ix+1,iz),c=gridHeight(ix,iz+1),d=gridHeight(ix+1,iz+1);
  const expected=u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
  assert.ok(Math.abs(heightAt(x,z)-expected)<1e-6);
  assert.ok(Math.abs(a-rawHeight(MIN+ix*STEP,MIN+iz*STEP))<1e-4);
 }
});
test('running downhill stays grounded every tick (no hop, no camera shake)',()=>{
 // Find a steady descent near the valley rim and run down it.
 const p=new Character([]);let worst=0,airborne=0;
 for(const [x,z,yaw] of [[10,120,Math.PI*.75],[93,110,0],[145,140,-Math.PI*.6]] as const){
  p.x=x;p.z=z;p.y=heightAt(x,z);p.vy=0;p.grounded=true;p.yaw=yaw;
  for(let i=0;i<60;i++){const y0=p.y;p.step(FIXED_DT,{...idle,forward:1,run:true});if(!p.grounded)airborne++;worst=Math.max(worst,y0-p.y);}
 }
 assert.equal(airborne,0,`airborne ticks: ${airborne}`);assert.ok(worst>.03,'test path must actually descend');
});
test('spawn can walk out of capsule doorway at its initial heading',()=>{
 const p=new Character(boxes);walk(p,3);assert.ok(p.z>49,JSON.stringify(p));
 assert.ok(Math.abs(p.y-heightAt(p.x,p.z))<.05);
});
test('capsule wall blocks the body and diagonal speed is normalized',()=>{
 const p=new Character(boxes);p.x=40;p.z=40;p.y=.64;p.yaw=Math.PI/2;walk(p,4);
 assert.ok(p.x<42,`wall crossed: ${p.x}`);
 const a=new Character([]),b=new Character([]);for(const p of[a,b]){p.x=57;p.z=43;p.y=heightAt(57,43);p.yaw=0;}
 walk(a,1);walk(b,1,{...idle,forward:1,right:1});
 assert.ok(Math.abs(Math.hypot(a.x-57,a.z-43)-Math.hypot(b.x-57,b.z-43))<.01);
});
test('jump respects a low ceiling and returns to floor',()=>{
 const h=heightAt(58,44),p=new Character([box('ceiling',58,h+2.3,44,5,.3,5)]);
 p.x=58;p.z=44;p.y=h;p.step(FIXED_DT,{...idle,jump:true});let top=0;
 for(let i=0;i<60;i++){top=Math.max(top,p.y+p.height);p.step(FIXED_DT,idle);}
 assert.ok(top<=h+2.15+.001,`head penetrated: ${top}`);assert.ok(p.grounded);assert.ok(Math.abs(p.y-h)<.001);
});
test('cave passage is enterable, capped at end, and can be exited',()=>{
 const p=new Character(boxes);p.x=109;p.z=72;p.y=heightAt(109,72);p.yaw=Math.PI/2;
 walk(p,8);assert.ok(p.x>130&&p.x<132,`cave end: ${p.x}`);
 p.yaw=-Math.PI/2;walk(p,8);assert.ok(p.x<110,`cave exit: ${p.x}`);
});

function free(x:number,z:number){
 const y=heightAt(x,z);
 return !boxes.some(b=>b.maxY>y+.5&&b.minY<y+1.8&&(x-Math.max(b.minX,Math.min(b.maxX,x)))**2+(z-Math.max(b.minZ,Math.min(b.maxZ,z)))**2<.36**2);
}
function findPath(start:{x:number,z:number},end:{x:number,z:number}){
 const key=(x:number,z:number)=>z*161+x,from=key(Math.round(start.x),Math.round(start.z)),to=key(end.x,end.z);
 const q=[from],parents=new Map<number,number>();parents.set(from,-1);
 for(let i=0;i<q.length&&!parents.has(to);i++){
  const k=q[i],x=k%161,z=Math.floor(k/161);
  for(const[dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,zz=z+dz,n=key(xx,zz);if(xx<3||zz<3||xx>157||zz>157||parents.has(n)||!free(xx,zz))continue;if(Math.abs(heightAt(xx,zz)-heightAt(x,z))>.45)continue;parents.set(n,k);q.push(n);}
 }
 assert.ok(parents.has(to),`no path to ${JSON.stringify(end)}`);const path=[];
 for(let at=to;at!==from;at=parents.get(at)!){path.push({x:at%161,z:Math.floor(at/161)});}return path.reverse();
}
test('all nine inspection areas reachable on foot; controller follows route without jumping',()=>{
 const p=new Character(boxes);let steps=0;
 for(const target of[{x:44,z:57},{x:67,z:62},{x:80,z:55},{x:30,z:80},{x:128,z:72},{x:95,z:104},{x:100,z:132},{x:58,z:44},{x:40,z:40}]){
  const path=findPath(p,target);
  for(const goal of path){let guard=0;while(Math.hypot(p.x-goal.x,p.z-goal.z)>.17&&guard++<160){p.yaw=Math.atan2(goal.x-p.x,goal.z-p.z);p.step(FIXED_DT,{...idle,forward:1});steps++;}assert.ok(guard<160,`stuck at ${p.x},${p.z}; next ${goal.x},${goal.z}`);}
  assert.ok(Math.hypot(p.x-target.x,p.z-target.z)<.3);
 }
 console.log(`Walked all areas in ${(steps*FIXED_DT).toFixed(1)} simulated seconds; this is a controller test, not a player timing result.`);
});

test('far landmarks are reachable on foot over a 2 m grid without cliffs',()=>{
 const S=2,N=Math.floor((MAX-MIN-8)/S),o=MIN+4,key=(i:number,j:number)=>j*N+i;
 const blocked=(x:number,z:number)=>{const y=heightAt(x,z);return boxes.some(b=>b.maxY>y+.5&&b.minY<y+1.8&&x>b.minX-.3&&x<b.maxX+.3&&z>b.minZ-.3&&z<b.maxZ+.3);};
 const start=key(Math.round((40-o)/S),Math.round((46-o)/S)),seen=new Uint8Array(N*N),q=[start];seen[start]=1;
 for(let k=0;k<q.length;k++){const i=q[k]%N,j=Math.floor(q[k]/N),h=heightAt(o+i*S,o+j*S);
  for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){const a=i+di,b=j+dj;if(a<0||b<0||a>=N||b>=N)continue;const n=key(a,b);if(seen[n])continue;const x=o+a*S,z=o+b*S;
   if(Math.abs(heightAt(x,z)-h)>1.1||blocked(x,z))continue;seen[n]=1;q.push(n);}}
 for(const id of FAR_IDS){const p=LANDMARKS.find(l=>l.id===id)!;assert.ok(seen[key(Math.round((p.x-o)/S),Math.round((p.z-o)/S))],`no gentle route to ${id}`);}
});
