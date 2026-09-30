/** Deterministic value noise shared by terrain, collision heights and decoration. */
const hash=(x:number,y:number,s=0)=>{let h=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^Math.imul(s|0,2246822519);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;};
const fade=(t:number)=>t*t*(3-2*t);
export function noise2(x:number,y:number,seed=0){
 const ix=Math.floor(x),iy=Math.floor(y),fx=fade(x-ix),fy=fade(y-iy);
 const a=hash(ix,iy,seed),b=hash(ix+1,iy,seed),c=hash(ix,iy+1,seed),d=hash(ix+1,iy+1,seed);
 return (a+(b-a)*fx+(c-a)*fy+(a-b-c+d)*fx*fy)*2-1;
}
export function fbm(x:number,y:number,octaves=4,seed=0){let sum=0,amp=.5,f=1,norm=0;for(let i=0;i<octaves;i++){sum+=noise2(x*f,y*f,seed+i*17)*amp;norm+=amp;amp*=.5;f*=2.03;}return sum/norm;}
export function ridged(x:number,y:number,octaves=5,seed=0){let sum=0,amp=.5,f=1,norm=0;for(let i=0;i<octaves;i++){const n=1-Math.abs(noise2(x*f,y*f,seed+i*31));sum+=n*n*amp;norm+=amp;amp*=.5;f*=2.1;}return sum/norm;}
export function noise3(x:number,y:number,z:number,seed=0){return (noise2(x+z*.71,y-z*.37,seed)+noise2(y+x*.53,z+x*.29,seed+5)+noise2(z-y*.61,x+y*.43,seed+9))/3;}
