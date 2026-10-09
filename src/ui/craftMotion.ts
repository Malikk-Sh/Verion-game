/** Short visual feedback; simulation, payment and saving never depend on animation. */
type Token = { src: string; x: number; y: number; size: number };
export function captureTokens(elements: Iterable<Element>,fallback?:Element|null): Token[] {
 return [...elements].slice(0,4).flatMap(e=>{const img=e.querySelector('img');if(!img)return [];const imageRect=img.getBoundingClientRect(),r=imageRect.width&&imageRect.height?imageRect:fallback?.getBoundingClientRect();if(!r?.width||!r.height)return [];return [{src:img.src,x:r.x+r.width/2,y:r.y+r.height/2,size:Math.max(24,Math.min(imageRect.width?48:36,r.width))}];});
}
const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function visibleTarget(selector:string,fallback?:string){const e=document.querySelector<HTMLElement>(selector),r=e?.getBoundingClientRect();if(r?.width&&r.height)return e;const other=fallback?document.querySelector<HTMLElement>(fallback):null,rect=other?.getBoundingClientRect();return rect?.width&&rect.height?other:null;}
export function pulseCraft(selector:string,fallback?:string){
 if(reduced())return;const e=visibleTarget(selector,fallback);if(!e)return;
 e.animate([{filter:'brightness(1)',transform:'scale(1)'},{filter:'brightness(1.5)',transform:'scale(1.035)'},{filter:'brightness(1)',transform:'scale(1)'}],{duration:420,easing:'ease-out'});
}
export function transferCraft(tokens:Token[],selector:string,fallback?:string){
 if(reduced())return;const target=visibleTarget(selector,fallback);if(!target)return;const r=target.getBoundingClientRect();
 tokens.forEach((t,i)=>{const e=document.createElement('img');e.src=t.src;e.className='craft-motion-token';e.alt='';e.setAttribute('aria-hidden','true');e.style.cssText=`left:${t.x-t.size/2}px;top:${t.y-t.size/2}px;width:${t.size}px;height:${t.size}px`;document.body.append(e);
  const dx=r.x+r.width/2-t.x,dy=r.y+r.height/2-t.y;
  const animation=e.animate([{transform:'translate(0,0) scale(1)',opacity:.9},{transform:`translate(${dx*.45}px,${dy*.4-14}px) scale(.9)`,opacity:1,offset:.45},{transform:`translate(${dx}px,${dy}px) scale(.35)`,opacity:0}],{duration:430,delay:i*35,easing:'cubic-bezier(.2,.7,.2,1)',fill:'both'});
  animation.finished.then(()=>e.remove(),()=>e.remove());
 });
 pulseCraft(selector,fallback);
}
