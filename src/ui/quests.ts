import './quests.css';
import { QUESTS, QUEST_BY_ID, QUEST_ROUTES, QUEST_HUBS, QUEST_MAP, type QuestId } from '../game/questCatalog';
import { questStatus, questParents, refreshQuestProgress } from '../game/quests';
import { RECIPE_BY_ID, WORKBENCH_UPGRADE } from '../game/production';
import { ITEMS } from '../game/defs';
import type { GameState } from '../game/state';
import { itemArt } from './art';

type Host={game:()=>GameState|null;show:()=>void;close:()=>void;changed:()=>void;tone:()=>void};
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const text=(tag:string,value:string,cls='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=value;return e;};
const name=(id:string)=>ITEMS[id]?.name??({water:'Вода',oxygen:'O₂',hydrogen:'H₂'}[id]??id);
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
  extent.style.width=QUEST_MAP.width*zoom+'px';extent.style.height=(QUEST_MAP.height*zoom+(detail.hidden?0:detail.offsetHeight))+'px';
  viewport.scrollLeft=anchor.x*zoom+offsetX-viewport.clientWidth/2;viewport.scrollTop=anchor.y*zoom-viewport.clientHeight/2;
  el<HTMLButtonElement>('quest-zoom-out').disabled=zoom<=.4;el<HTMLButtonElement>('quest-zoom-in').disabled=zoom>=1.5;
 }
 function focusNode(id:QuestId){const q=QUEST_BY_ID.get(id)!;const available=Math.max(50,viewport.clientHeight-(detail.hidden?0:detail.offsetHeight));viewport.scrollLeft=q.x*zoom+offsetX-viewport.clientWidth/2;viewport.scrollTop=q.y*zoom-available/2;}
 function fit(){autoFit=true;applyZoom(Math.min(viewport.clientWidth/QUEST_MAP.width,viewport.clientHeight/QUEST_MAP.height));viewport.scrollLeft=viewport.scrollTop=0;}
 function select(id:QuestId){selected=id;host.tone();draw();focusNode(id);el('quest-announcement').textContent=label(id)+'. '+states[questStatus(host.game()!,id)];}
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
   const recipes=text('div','','quest-costs');for(const rid of q.recipes){const r=rid==='upgrade'?{inputs:WORKBENCH_UPGRADE.inputs,outputs:{workbench_2:1},seconds:0,station:'workbench'}:RECIPE_BY_ID.get(rid)!;const row=text('div','','quest-recipe');row.append(text('span',rid==='upgrade'?'Улучшение:':name(Object.keys(r.outputs)[0])+':','quest-recipe-label'));
    for(const [id,n] of Object.entries(r.inputs)){const cost=text('span','','quest-ingredient');cost.setAttribute('aria-label',name(id)+' '+n);cost.title=name(id)+' ×'+n;cost.append(itemArt(id),text('span',String(n)));row.append(cost);}const result=Object.entries(r.outputs).map(([id,n])=>id==='workbench_2'?'Верстак II · ключ сохранён':id==='hydrogen'?`${n} GU H₂ (сброс)`:id==='oxygen'?`${n} GU O₂`:id==='water'?`${n} WU воды`:`${n} ${name(id)}`).join(' + ');row.append(text('span','→ '+result+(r.seconds?' · '+r.seconds+' с':'')));recipes.append(row);}
   body.append(recipes);detail.append(body);
   const track=document.createElement('button');track.type='button';track.className='quest-track ui-btn';track.setAttribute('aria-pressed',String(g.progress.quests.tracked===selected));track.textContent=g.progress.quests.tracked===selected?'Убрать из HUD':'Отслеживать в HUD';track.onclick=()=>{g.progress.quests.tracked=g.progress.quests.tracked===selected?null:selected;host.changed();draw();};detail.append(track);
  }
  extent.style.height=(QUEST_MAP.height*zoom+(detail.hidden?0:detail.offsetHeight))+'px';
 }
 function open(){const g=host.game();if(!g)return;if(refreshQuestProgress(g))host.changed();host.show();draw();if(!initialized){initialized=true;autoFit=false;applyZoom(Math.max(.8,Math.min(1,viewport.clientWidth/QUEST_MAP.width,viewport.clientHeight/QUEST_MAP.height)),{x:QUEST_MAP.width/2,y:QUEST_MAP.height/2});focusNode(g.progress.quests.tracked??QUESTS.find(q=>questStatus(g,q.id)==='ready')?.id??'materials');}}
 el('quest-close').onclick=()=>{host.tone();host.close();};el('quest-fit').onclick=()=>{selected=null;draw();fit();};
 el('quest-zoom-out').onclick=()=>{autoFit=false;applyZoom(zoom-.15);};el('quest-zoom-in').onclick=()=>{autoFit=false;applyZoom(zoom+.15);};
 new ResizeObserver(()=>{if(panel.hidden||!initialized)return;if(autoFit)fit();else applyZoom(zoom);}).observe(viewport);
 return {open,draw,escape:()=>{if(selected)closeDetail();else host.close();},reset:()=>{selected=null;initialized=false;detail.hidden=true;},debug:()=>({selected,zoom,overview:zoom<.72})};
}
