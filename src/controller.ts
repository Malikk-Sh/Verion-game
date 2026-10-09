import { EYE, MIN, MAX, SPAWN, heightAt, type Box } from './world';
/** Max drop per 50 ms tick that still counts as walking down a slope (≈ 60° at running speed). Ledges higher than this are a fall. */
const SNAP=.45;
export type Input = { forward: number; right: number; run: boolean; jump: boolean };
export class Character {
 x=SPAWN.x; z=SPAWN.z; y=heightAt(this.x,this.z)+.14; yaw=SPAWN.yaw; pitch=-.035;
 vy=0; vx=0; vz=0; airSpeed=0; grounded=true; previous={x:this.x,y:this.y,z:this.z}; radius=.3; height=1.8;
 constructor(public colliders:Box[]){}
 reset(){this.x=SPAWN.x;this.z=SPAWN.z;this.y=heightAt(this.x,this.z)+.14;this.yaw=SPAWN.yaw;this.pitch=-.035;this.vy=this.vx=this.vz=this.airSpeed=0;this.grounded=true;this.previous={x:this.x,y:this.y,z:this.z};}
 private overlaps(x:number,z:number,b:Box){const cx=Math.max(b.minX,Math.min(b.maxX,x)),cz=Math.max(b.minZ,Math.min(b.maxZ,z));return (x-cx)**2+(z-cz)**2<this.radius**2;}
 private moveAxis(dx:number,dz:number){
  const x=Math.max(MIN+2,Math.min(MAX-2,this.x+dx)),z=Math.max(MIN+2,Math.min(MAX-2,this.z+dz));
  let support=heightAt(x,z);
  if(support>this.y+.5)return;
  for(const b of this.colliders){
   if(!this.overlaps(x,z,b)||this.y+this.height<=b.minY+.001||this.y>=b.maxY-.001)continue;
   if(this.grounded&&b.maxY<=this.y+.5&&b.maxY>=support){support=b.maxY;}
   else return;
  }
  if(support>this.y){
   // A low ledge is not climbable if the standing body would intersect a ceiling.
   if(this.colliders.some(b=>this.overlaps(x,z,b)&&b.minY<support+this.height&&b.maxY>support+.01&&b.minY>=this.y+this.height-.01))return;
   this.y=support;
  }
  this.x=x;this.z=z;
 }
 step(dt:number,input:Input,speedMultiplier=1){
  this.previous={x:this.x,y:this.y,z:this.z};
  const length=Math.hypot(input.forward,input.right),scale=length>1?1/length:1;
  const speed=this.grounded?(input.run?5:3.5)*speedMultiplier:this.airSpeed,f=input.forward*scale,r=input.right*scale;
  if(this.grounded||length>.01){this.vx=(Math.sin(this.yaw)*f-Math.cos(this.yaw)*r)*speed;this.vz=(Math.cos(this.yaw)*f+Math.sin(this.yaw)*r)*speed;}
  if(this.grounded)this.airSpeed=speed;
  const dx=this.vx*dt,dz=this.vz*dt;
  // Substeps avoid tunnelling even when moving diagonally past a narrow jamb.
  const n=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.12));
  for(let i=0;i<n;i++){this.moveAxis(dx/n,0);this.moveAxis(0,dz/n);}
  // Stay glued to the ground when walking or running downhill instead of hopping every tick
  // (B3 left the body airborne for a step, which toggled bob/FOV and made the camera shake).
  let stick=this.grounded;
  if(input.jump&&this.grounded){this.vy=4.5;this.grounded=false;stick=false;}
  const oldY=this.y;this.vy-=9*dt;let next=this.y+this.vy*dt;
  let ground=heightAt(this.x,this.z);
  for(const b of this.colliders){
   if(!this.overlaps(this.x,this.z,b))continue;
   if(this.vy<=0&&b.maxY<=oldY+.01)ground=Math.max(ground,b.maxY);
   if(this.vy>0&&oldY+this.height<=b.minY+.01&&next+this.height>b.minY){next=b.minY-this.height;this.vy=0;}
  }
  if(next<=ground||(stick&&oldY-ground<=SNAP)){this.y=ground;this.vy=0;this.grounded=true;}else{this.y=next;this.grounded=false;}
 }
 get eye(){return this.y+EYE;}
}
