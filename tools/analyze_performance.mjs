/** Read an exported device log: node tools/analyze_performance.mjs file.json */
import {readFile} from 'node:fs/promises';
const file=process.argv[2];if(!file)throw Error('Укажите путь к vireon-performance-*.json');
const log=JSON.parse(await readFile(file,'utf8'));if(log.format!=='vireon-performance'||log.version!==1)throw Error('Неподдерживаемый формат диагностического лога');
console.log(JSON.stringify({version:log.gameVersion,asset:log.metadata?.asset,durationMs:log.durationMs,device:{gpu:log.metadata?.gpu,viewport:log.metadata?.viewport,cores:log.metadata?.cores},summary:log.summary},null,2));
const groups=new Map();for(const s of log.samples??[]){const key=JSON.stringify([s.context.quality,s.context.dialog||'игра',s.context.visible]);const g=groups.get(key)??{samples:0,gapTotal:0,maxGap:0,maxWork:0};g.samples++;g.gapTotal+=s.gap;g.maxGap=Math.max(g.maxGap,s.gap);g.maxWork=Math.max(g.maxWork,s.work);groups.set(key,g);}
console.table([...groups].map(([k,v])=>({context:k,samples:v.samples,averageSampleGapMs:Math.round(v.gapTotal/v.samples),maxSampleGapMs:v.maxGap,maxSampleCpuSubmitMs:v.maxWork})));
console.table(Object.entries(log.stages??{}).map(([operation,s])=>({operation,count:s.count,averageMs:s.averageMs,maxMs:s.maxMs})).sort((a,b)=>b.maxMs-a.maxMs));
console.log('Последние длинные операции браузера:',JSON.stringify((log.events??[]).filter(e=>['longtask','long-animation-frame','script'].includes(e.name)).slice(-12),null,2));
console.log('RAF — интервал между кадрами, не время GPU. save:commit-wall — время асинхронной записи. Группы используют редкие образцы; частота фризов и p95 оцениваются отдельно от явной загрузки, паузы и скрытой вкладки.');
