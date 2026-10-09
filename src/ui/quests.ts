import './quests.css';
import { QUESTS, QUEST_BY_ID, QUEST_ROUTES, QUEST_HUBS, QUEST_MAP, type QuestId } from '../game/questCatalog';
import { questStatus, questParents, refreshQuestProgress } from '../game/quests';
import type { GameState } from '../game/state';
import { itemArt } from './art';

type Host={game:()=>GameState|null;show:()=>void;close:()=>void;changed:()=>void;tone:()=>void};
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const text=(tag:string,value:string,cls='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=value;return e;};
const ns='http://www.w3.org/2000/svg';
const svg=(tag:string,attrs:Record<string,string|number>)=>{const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
const label=(id:QuestId)=>QUEST_BY_ID.get(id)!.label.replace(/\n/g,' ');
const states={done:'Выполнено',ready:'Доступная цель',locked:'Позже'};

export function createQuestBook(host:Host){
 const panel=el('quest-panel'),viewport=el('quest-viewport'),extent=el('quest-extent'),canvas=el('quest-canvas'),detail=el('quest-detail');
 const routeLayer=document.getElementById('quest-route-layer')!,hubLayer=document.getElementById('quest-hub-layer')!;
 const nodeLayer=el('quest-nodes');
 let selected:QuestId|null=null,zoom=1,initialized=false,autoFit=false,offsetX=0;
 const buttons=new Map<QuestId,HTMLButtonElement>();
 const paths=QUEST_ROUTES.map(r=>{const e=svg('path',{d:r.d,class:'quest-path','data-from':r.from,'data-to':r.to});if(r.arrow)e.setAttribute('marker-end','url(#quest-arrow)');routeLayer.append(e);return {e,...r};});
 for(const h of QUEST_HUBS){const g=svg('g',{class:'quest-hub','data-to':h.id});g.append(svg('circle',{cx:h.x,cy:h.y,r:8}));const t=svg('text',{x:h.x,y:h.y});t.textContent='И';g.append(t);hubLayer.append(g);}
 for(const q of QUESTS){const b=document.createElement('button');b.type='button';b.className='quest-node';b.dataset.quest=q.id;b.style.left=(q.x-50)+'px';b.style.top=(q.y-27)+'px';const disc=text('span','','quest-disc');disc.append(itemArt(q.item));disc.append(text('span','','quest-status'));b.append(disc,text('span',q.label,'quest-label'));b.onclick=()=>select(q.id);nodeLayer.append(b);buttons.set(q.id,b);}
 function applyZoom(next:number,anchor={x:(viewport.scrollLeft+viewport.clientWidth/2-offsetX)/zoom,y:(viewport.scrollTop+viewport.clientHeight/2)/zoom}){
  zoom=Math.max(.4,Math.min(1.5,next));canvas.style.transform=`scale(${zoom})`;canvas.style.setProperty('--quest-label-size',`${12/zoom}px`);canvas.style.setProperty('--quest-badge-size',`${10/zoom}px`);panel.classList.toggle('quest-overview',zoom<.72);
  offsetX=Math.max(0,(viewport.clientWidth-QUEST_MAP.width*zoom)/2);canvas.style.left=offsetX+'px';
  extent.style.width=QUEST_MAP.width*zoom+'px';extent.style.height=(QUEST_MAP.height*zoom)+'px';
  viewport.scrollLeft=anchor.x*zoom+offsetX-viewport.clientWidth/2;viewport.scrollTop=anchor.y*zoom-viewport.clientHeight/2;
  el<HTMLButtonElement>('quest-zoom-out').disabled=zoom<=.4;el<HTMLButtonElement>('quest-zoom-in').disabled=zoom>=1.5;positionDetail();
 }
 function focusNode(id:QuestId){const q=QUEST_BY_ID.get(id)!;const available=viewport.clientHeight;viewport.scrollLeft=q.x*zoom+offsetX-viewport.clientWidth/2;viewport.scrollTop=q.y*zoom-available/2;}
 function fit(){autoFit=true;applyZoom(Math.min(viewport.clientWidth/QUEST_MAP.width,viewport.clientHeight/QUEST_MAP.height));viewport.scrollLeft=viewport.scrollTop=0;}
 function select(id:QuestId){selected=id;host.tone();draw();positionDetail();el('quest-announcement').textContent=label(id)+'. '+states[questStatus(host.game()!,id)];}
 function closeDetail(){const focus=selected;selected=null;draw();if(focus)buttons.get(focus)?.focus({preventScroll:true});}
 function draw(){
  const g=host.game();if(!g)return;
  const parents=new Set(selected?questParents(selected):[]),children=new Set(selected?QUESTS.filter(q=>questParents(q.id).includes(selected!)).map(q=>q.id):[]);
  for(const q of QUESTS){const b=buttons.get(q.id)!,status=questStatus(g,q.id);b.dataset.status=status;b.setAttribute('aria-pressed',String(q.id===selected));b.setAttribute('aria-label',label(q.id)+', '+states[status]);b.title=label(q.id)+' · '+states[status];b.classList.toggle('quest-parent',parents.has(q.id));b.classList.toggle('quest-unrelated',!!selected&&q.id!==selected&&!parents.has(q.id)&&!children.has(q.id));const badge=b.querySelector('.quest-status')!;badge.textContent=status==='done'?'✓':status==='locked'?questParents(q.id).filter(p=>g.progress.quests.completed.includes(p)).length+'/'+questParents(q.id).length:'';}
  for(const r of paths){const incoming=!!selected&&r.to===selected&&(parents.has(r.from as QuestId)||r.from==='join'),outgoing=r.from===selected&&children.has(r.to as QuestId),station=r.context&&(selected==='bench'||parents.has('bench'));const relevant=incoming||outgoing||station;r.e.classList.toggle('quest-met',g.progress.quests.completed.includes(r.from as QuestId));r.e.classList.toggle('quest-context',r.context);r.e.classList.toggle('quest-focus',relevant);r.e.classList.toggle('quest-missing',relevant&&r.from!=='join'&&!g.progress.quests.completed.includes(r.from as QuestId));r.e.classList.toggle('quest-dim',!!selected&&!relevant);if(relevant)routeLayer.append(r.e);}
  for(const e of hubLayer.children){e.classList.toggle('quest-hub-focus',e.getAttribute('data-to')===selected);e.classList.toggle('quest-hub-dim',!!selected&&e.getAttribute('data-to')!==selected&&!children.has(e.getAttribute('data-to') as QuestId));}
  const benchDone=g.progress.quests.completed.includes('bench');el('quest-station').textContent=(benchDone?'✓ ':'')+'Верстак I';
  detail.replaceChildren();detail.hidden=!selected;
  if(selected){const q=QUEST_BY_ID.get(selected)!;const head=text('div','','quest-detail-head'),title=text('h3',label(selected));title.id='quest-detail-title';head.append(itemArt(q.item),title,text('span',states[questStatus(g,selected)],'quest-detail-state'));const close=document.createElement('button');close.type='button';close.className='ui-close';close.textContent='×';close.setAttribute('aria-label','Закрыть карточку цели');close.onclick=closeDetail;head.append(close);detail.append(head);
   const body=text('div','','quest-detail-body');body.append(text('p',q.objective));
   if(parents.size){const row=text('div','','quest-conditions');row.append(text('span','Нужно всё:'));for(const id of parents){const b=document.createElement('button');b.type='button';b.className='quest-condition';b.textContent=(g.progress.quests.completed.includes(id)?'✓ ':'○ ')+label(id);b.onclick=()=>select(id);row.append(b);}body.append(row);}
   detail.append(body);

  }
  extent.style.height=(QUEST_MAP.height*zoom)+'px';positionDetail();
 }
 function positionDetail(){if(!selected||detail.hidden)return;const workspace=detail.parentElement!,area=workspace.getBoundingClientRect(),node=buttons.get(selected)!.getBoundingClientRect();
  const width=Math.min(280,area.width-16);detail.style.width=width+'px';const x=node.left-area.left+node.width/2,y=node.top-area.top;
  const right=x+node.width/2+12;detail.style.left=Math.max(8,Math.min(area.width-width-8,right+width<=area.width?right:x-node.width/2-width-12))+'px';detail.style.top=Math.max(8,Math.min(area.height-detail.offsetHeight-8,y))+'px';
 }
 viewport.addEventListener('scroll',positionDetail);viewport.addEventListener('pointerdown',e=>{if(e.target===viewport||e.target===extent)closeDetail();});
 function open(){const g=host.game();if(!g)return;if(refreshQuestProgress(g))host.changed();host.show();draw();if(!initialized){initialized=true;autoFit=false;applyZoom(Math.max(.8,Math.min(1,viewport.clientWidth/QUEST_MAP.width,viewport.clientHeight/QUEST_MAP.height)),{x:QUEST_MAP.width/2,y:QUEST_MAP.height/2});focusNode(QUESTS.find(q=>questStatus(g,q.id)==='ready')?.id??'materials');}}
 el('quest-close').onclick=()=>{host.tone();host.close();};el('quest-fit').onclick=()=>{selected=null;draw();fit();};
 el('quest-zoom-out').onclick=()=>{autoFit=false;applyZoom(zoom-.15);};el('quest-zoom-in').onclick=()=>{autoFit=false;applyZoom(zoom+.15);};
 new ResizeObserver(()=>{if(panel.hidden||!initialized)return;if(autoFit)fit();else applyZoom(zoom);}).observe(viewport);
 return {open,draw,escape:()=>{if(selected)closeDetail();else host.close();},reset:()=>{selected=null;initialized=false;detail.hidden=true;},debug:()=>({selected,zoom,overview:zoom<.72})};
}
