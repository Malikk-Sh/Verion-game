/** Opt-in, bounded recording. Never reads the world save, WebGL state, or writes storage per frame. */
export type DiagnosticContext = {quality:string;dialog:string;running:boolean;visible:boolean;calls:number;triangles:number;geometries:number;textures:number;fineBlocks:number;buildings:number;links:number;activeTicks:number};
type Detail=Record<string,string|number|boolean>;
export class Ring<T>{private data:T[]=[];private next=0;constructor(readonly limit:number){}push(v:T){if(this.data.length<this.limit)this.data.push(v);else{this.data[this.next]=v;this.next=(this.next+1)%this.limit;}}values(){return this.data.length<this.limit?[...this.data]:[...this.data.slice(this.next),...this.data.slice(0,this.next)];}clear(){this.data=[];this.next=0;}}
const round=(v:number)=>Math.round(v*100)/100;
export class Diagnostics {
 enabled=false;private start=0;private stopped=0;private lastSample=-Infinity;private count=0;private over100=0;private total=0;private maximum=0;
 private frames=new Ring<number>(600);private events=new Ring<{at:number;name:string;ms:number;detail:Detail}>(240);
 private samples=new Ring<{at:number;gap:number;work:number;stages:Detail;context:DiagnosticContext}>(600);
 private spikes=new Ring<{at:number;gap:number;work:number;stages:Detail;context:DiagnosticContext}>(240);
 private stages:Detail={};private totals=new Map<string,{count:number;total:number;max:number}>();
 constructor(private now:()=>number=()=>performance.now()){}
 startRecording(){this.clear();this.enabled=true;this.start=this.now();}
 stop(){this.stopped=this.now();this.enabled=false;}
 clear(){this.frames.clear();this.events.clear();this.samples.clear();this.spikes.clear();this.count=this.total=this.maximum=this.over100=0;this.start=this.now();this.stopped=0;this.lastSample=-Infinity;this.stages={};this.totals.clear();}
 span(name:string,ms:number){if(!this.enabled)return;this.aggregate(name,ms);if(ms>=8)this.event(name,ms);}
 stamp(){return this.enabled?this.now():0;}
 stage(name:string,since:number){if(!this.enabled)return 0;const at=this.now(),ms=Math.max(0,at-since);this.stages[name]=round(ms);this.aggregate(name,ms);return at;}
 private aggregate(name:string,ms:number){const t=this.totals.get(name)??{count:0,total:0,max:0};t.count++;t.total+=ms;t.max=Math.max(t.max,ms);this.totals.set(name,t);}
 event(name:string,ms=0,detail:Detail={}){if(this.enabled){this.events.push({at:round(this.now()-this.start),name:name.slice(0,80),ms:round(ms),detail});}}
 frame(gap:number,start:number,context:DiagnosticContext){if(!this.enabled)return;const at=this.now(),work=at-start;this.count++;this.total+=gap;this.maximum=Math.max(this.maximum,gap);if(gap>100)this.over100++;this.frames.push(gap);
  if(gap>50||at-this.lastSample>=500){const sample={at:round(at-this.start),gap:round(gap),work:round(work),stages:{...this.stages},context:{...context}};if(gap>50)this.spikes.push(sample);if(at-this.lastSample>=500){this.samples.push(sample);this.lastSample=at;}}this.stages={};}
 report(metadata:Record<string,unknown>={}){const sorted=this.frames.values().sort((a,b)=>a-b);return {format:'vireon-performance',version:1,gameVersion:'S2.7',createdAt:new Date().toISOString(),recording:this.enabled,recordingStartMs:round(this.start),durationMs:round((this.enabled?this.now():this.stopped||this.now())-this.start),metadata,
  summary:{frames:this.count,averageGapMs:round(this.total/(this.count||1)),recentP95GapMs:round(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]??0),maxGapMs:round(this.maximum),gapsOver100Ms:this.over100},stages:Object.fromEntries([...this.totals].map(([k,v])=>[k,{count:v.count,averageMs:round(v.total/v.count),maxMs:round(v.max)}])),samples:this.samples.values(),spikes:this.spikes.values(),events:this.events.values(),limits:{recentFrames:600,samples:600,spikes:240,events:240},timingNote:'RAF gap and CPU submission timings; not GPU execution time. save:commit-wall is asynchronous wall time, not CPU. Hidden pages and menu rendering are identified in context.'};}
}
/** Browser APIs are supplementary; stage and frame recording also works without them. */
export function observeDiagnostics(d:Diagnostics,context:()=>Detail){
 const observers:PerformanceObserver[]=[];
 if(typeof PerformanceObserver!=='undefined')for(const type of ['longtask','long-animation-frame','event']){
  if(!PerformanceObserver.supportedEntryTypes?.includes(type))continue;
  try{const o=new PerformanceObserver(list=>{if(!d.enabled)return;for(const entry of list.getEntries()){
   const e=entry as PerformanceEntry&{processingStart?:number;processingEnd?:number;blockingDuration?:number;scripts?:{duration:number;forcedStyleAndLayoutDuration:number;sourceURL:string;sourceFunctionName:string}[]};
   if(type==='event'){d.event('event:'+e.name,e.duration,{...context(),inputDelayMs:round((e.processingStart??e.startTime)-e.startTime),handlerMs:round((e.processingEnd??0)-(e.processingStart??0))});continue;}
   d.event(type,e.duration,{...context(),startTime:round(e.startTime),blockingMs:round(e.blockingDuration??0)});
   for(const s of e.scripts?.slice(0,4)??[]){let file='';try{file=new URL(s.sourceURL,location.href).pathname.split('/').pop()??'';}catch{/* missing attribution */}d.event('script',s.duration,{file:file.slice(0,100),function:(s.sourceFunctionName??'').slice(0,100),layoutMs:round(s.forcedStyleAndLayoutDuration??0)});}
  }});const options:PerformanceObserverInit&{durationThreshold?:number}=type==='event'?{type,durationThreshold:40}:{type};o.observe(options);observers.push(o);}catch{/* optional API */}
 }
 const input=(e:Event)=>{if(!d.enabled)return;const target=e.target as HTMLElement|null,id=target?.closest('button')?.id||target?.tagName||'';d.event('input:'+e.type,Math.max(0,performance.now()-e.timeStamp),{...context(),target:id.slice(0,80)});};
 for(const type of ['pointerdown','click','keydown'])document.addEventListener(type,input,{capture:true,passive:true});
 document.addEventListener('visibilitychange',()=>d.event('visibility',0,{visible:!document.hidden}));
 window.addEventListener('error',e=>d.event('error',0,{message:e.message.slice(0,180)}));
 window.addEventListener('unhandledrejection',e=>d.event('rejection',0,{message:String(e.reason instanceof Error?e.reason.message:e.reason).slice(0,180)}));
 return {supported:observers.map(o=>o),disconnect:()=>{observers.forEach(o=>o.disconnect());for(const type of ['pointerdown','click','keydown'])document.removeEventListener(type,input,true);}};
}
