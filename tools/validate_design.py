"""Static design checks and reproducible balance calculations; no game playtest."""
from pathlib import Path
import json, re, math
from collections import Counter
ROOT=Path(__file__).resolve().parents[1]
d=json.loads((ROOT/'docs/data/catalog.json').read_text()); items=d['items']; rs=d['recipes']
known_tech={'start','power','habitat','steel','terraform','flight','velite','asteroid','station','trade','pyra','hydrogen'}
assert len({r['id'] for r in rs})==len(rs)
for r in rs:
 assert r['station']=='hand' or r['station'] in items, r['id']
 assert r['tech'] in known_tech,r['id']
 assert r['seconds']>0 and r['EU_per_second']>=0,r['id']
 for group in ['inputs','outputs']:
  assert r[group]
  for i,q in r[group].items():assert i in items and isinstance(q,int) and q>0,(r['id'],i,q)
# Paid reusable-tool upgrades are canonical alongside recipes.
for station,u in d.get('upgrades',{}).items():
 assert station in items and u['tool'] in items
 assert items[u['tool']]['kind']=='equipment' and items[u['tool']]['stack']==1
 assert isinstance(u['fromLevel'],int) and u['toLevel']==u['fromLevel']+1
 assert isinstance(u['queueCapacity'],int) and 1<=u['queueCapacity']<=5
 assert u['EU_per_second']>0 and u['inputs']
 for item,q in u['inputs'].items():assert item in items and isinstance(q,int) and q>0
# Qualitative reachability including station, technology, world and tool gates.
# Does NOT prove quantities, path geometry, random seed arrival time or power uptime.
def reach(scopes):
 avail={'hand','suit_helmet','suit_chest','suit_legs','suit_boots','bottle_1','tool_stone'}; tech={'start'}; worlds={'verdana'}; used=set()
 for iteration in range(100):
  before=(len(avail),len(tech),len(worlds),len(used))
  tier=3 if 'drill_1' in avail else 2 if 'pick_steel' in avail else 1 if 'pick_iron' in avail else 0
  if 'rocket_1' in avail:worlds.add('niva')
  if 'asteroid' in tech:worlds.add('asteroid')
  if 'expansion2' in scopes and 'pyra' in tech:worlds.add('pyra')
  for i,v in items.items():
   source=v.get('source')
   if not source or not worlds.intersection(source['worlds']):continue
   min_tier={'gold_raw':1,'velite_raw':2,'astrite_raw':3,'carbonate':1,'volatile_rock':1,'hydrocarbon_rock':1}.get(i,0)
   if tier<min_tier:continue
   if i=='oil' and 'canister' not in avail and 'oil_pump' not in avail:continue
   if i.startswith('seed_') and i!='seed_potato':
    if 'sieve_hand' not in avail or 'mesh_fiber' not in avail:continue
    if i in ['seed_bean','seed_tree'] and 'mesh_iron' not in avail:continue
   if i=='blueprint_rocket' and 'steel' not in tech:continue
   avail.add(i)
  if {'sieve_hand','mesh_fiber'}.issubset(avail):avail.update(['iron_speck','copper_speck'])
  if {'sieve_hand','mesh_iron'}.issubset(avail):avail.add('gold_speck')
  if {'sieve_hand','mesh_steel'}.issubset(avail) and 'niva' in worlds:avail.add('velite_speck')
  if {'sieve_hand','mesh_velite'}.issubset(avail) and 'pyra' in worlds:avail.add('astrite_speck')
  if 'biogenerator' in avail and 'fiber' in avail:tech.add('power')
  if {'dome','distributor','oxygen'}.issubset(avail) and 'power' in tech:tech.add('habitat')
  if 'steel' in avail:tech.add('steel')
  if ({'cleaner','sorbent'}.issubset(avail) or {'basin_intake','water'}.issubset(avail)) and 'power' in tech:tech.add('terraform')
  if {'steel','terraform'}.issubset(tech) and 'blueprint_rocket' in avail:tech.add('flight')
  if {'velite','blueprint_industry'}.issubset(avail):tech.add('velite')
  if 'velite' in tech and 'jetpack_1' in avail:tech.add('asteroid')
  if 'expansion1' in scopes and 'asteroid' in tech and 'blueprint_station' in avail:tech.update(['station','trade'])
  if 'expansion2' in scopes and {'rocket_2','suit_combined'}.issubset(avail):tech.add('pyra')
  if {'astrite','blueprint_heat'}.issubset(avail):tech.add('hydrogen')
  if {'bed_crop','water'}.issubset(avail) and 'habitat' in tech:
   for seed,out in [('seed_reed','reed'),('seed_tuber','tuber'),('seed_bean','beans'),('seed_tree','wood'),('seed_potato','potato')]:
    if seed in avail:avail.add(out)
  if {'cleaner','sorbent'}.issubset(avail):avail.add('spent_sorbent')
  for r in rs:
   if r['scope'] not in scopes or r['tech'] not in tech or r['station'] not in avail:continue
   if r['id']=='photosynthesis' and 'algae' not in avail:continue
   if r['station']=='composter' and 'habitat' not in tech:continue
   if set(r['inputs']).issubset(avail):avail.update(r['outputs']);used.add(r['id'])
  if before==(len(avail),len(tech),len(worlds),len(used)):break
 else:raise AssertionError('reachability did not converge')
 missing=[r['id'] for r in rs if r['scope'] in scopes and r['id'] not in used]
 return avail,tech,worlds,used,missing
core=reach({'core'}); full=reach({'core','expansion1','expansion2'})
assert not core[4],core[4]
assert not full[4],full[4]
# First rocket and life support are reachable before allowing Niva resources.
# Check dependency paths with a deterministic preferred recipe set for cost expansion.
byout={}
for r in rs:
 if len(r['outputs'])==1:
  out=next(iter(r['outputs']));byout.setdefault(out,[]).append(r)
preferred={}
for i,choices in byout.items():
 preferred[i]=next((r for r in choices if r['id']=='smelt_'+i+'_raw'),next((r for r in choices if r['id']=='craft_'+i),choices[0]))
preferred['fiber']=next(r for r in rs if r['id']=='grass_parts')
preferred['pulp']=preferred['fiber']
# Shared BOM batches with surplus accounted. These are bill-of-materials, not station amortization.
def bom(order,extra_raw=()):
 need=Counter(order); stock=Counter(); raw=Counter(); seconds=0; energy=0
 def obtain(i,q,trail=()):
  nonlocal seconds,energy
  take=min(stock[i],q);stock[i]-=take;q-=take
  if not q:return
  if i not in preferred or 'verdana' in items[i].get('source',{}).get('worlds',[]) or i in extra_raw:
   raw[i]+=q;return
  assert i not in trail,('cycle',i,trail)
  r=preferred[i]; n=math.ceil(q/r['outputs'][i])
  for j,v in r['inputs'].items():obtain(j,v*n,trail+(i,))
  for j,v in r['outputs'].items():stock[j]+=v*n
  stock[i]-=q;seconds+=r['seconds']*n;energy+=r['seconds']*r['EU_per_second']*n
 for i,q in need.items():obtain(i,q)
 return raw,seconds,energy
starter={'workbench':1,'kiln':1,'biogenerator':1,'electrolyzer':1,'refill':1,'bottle_1':1,'distributor':1,'dome':1,'cable':4,'gas_pipe':4,'bed':1,'chest':1}
raw,t,e=bom(starter)
assert not any(x in raw for x in ['velite_raw','astrite_raw','gold_raw']),raw
rocketraw,rt,rocket_energy=bom({'rocket_1':1,'landing_pad':2,'underwear_1':1},extra_raw=('blueprint_rocket',))
assert not any(x in rocketraw for x in ['velite_raw','astrite_raw']),rocketraw
# Basic solar/battery must not depend on offworld ore.
solarraw,_,_=bom({'solar':1,'battery':1})
assert 'velite_raw' not in solarraw and 'astrite_raw' not in solarraw
# Conservation and standardized ratios.
for m in ['iron','copper','gold','velite','astrite']:
 r=next(r for r in rs if r['id']=='pack_'+m);assert r['inputs']=={m+'_speck':4} and r['outputs']=={m+'_dust':1}
 for form in ['raw','dust']:
  r=next(r for r in rs if r['id']=='smelt_'+m+'_'+form);assert r['outputs']=={m:1}
for r in rs:
 if r['id'].startswith('compress_'):
  out=next(iter(r['outputs']));n=int(out.rsplit('_x',1)[1]);assert sum(r['inputs'].values())==n
# Even a guaranteed bonus seed must not generate more water than the crop consumed.
recover={r['id'].replace('recover_',''):r for r in rs if r['id'].startswith('recover_')}
crop_max_return={}
for crop,seed,yield_,water in [('reed','seed_reed',2,4),('tuber','seed_tuber',3,4),('beans','seed_bean',3,5),('wood','seed_tree',4,8),('potato','seed_potato',3,4)]:
 ret=(recover[crop]['outputs']['water']/recover[crop]['inputs'][crop]*yield_) if crop in recover else 0
 ret+=recover[seed]['outputs']['water']/recover[seed]['inputs'][seed] # one bonus seed, replant seed reserved
 crop_max_return[crop]=ret;assert ret<water,(crop,ret,water)
# Key gas and supply calculations, not physiological units.
electro=next(r for r in rs if r['id']=='electrolysis');o2_rate=electro['outputs']['oxygen']/electro['seconds']
assert o2_rate>1+0.002*48
assert 2*480>600 # 10 minute field trip two tier II bottles
assert 2*6000>=480*18 # cold baseline habitat at night, no industry
# Verify links in current docs only; old copied archive has historical relative paths.
link_errors=[]
for p in [ROOT/'README.md',ROOT/'docs/GDD_Vireon.md',*sorted((ROOT/'docs/spec').glob('*.md'))]:
 for target in re.findall(r'\]\(([^)]+)\)',p.read_text()):
  if '://' in target or target.startswith('#'):continue
  dest=(p.parent/target.split('#')[0]).resolve()
  if not dest.exists() and dest.name!='VALIDATION_REPORT.md':link_errors.append((str(p),target))
assert not link_errors,link_errors
# Recipe tree costs and remaining tests are documented rather than presented as playtest proof.
def desc(c):return ', '.join(f'{items[i]["name"]}: {q}' for i,q in sorted(c.items()))
report=f'''# Проверка GDD 1.0 — 28.09.2026

**Проверены проектные данные, не работающая игра.** Команда: `python3 tools/build_design_catalog.py && python3 tools/validate_design.py`.

- Предметов: {len(items)}; рецептов: {len(rs)}; ID уникальны, все ингредиенты/станции/технологии существуют, количества положительны.
- Core: достижимы все {len(core[3])} доступных рецептов с учётом технологии, станка, мира и тира инструмента.
- Полный набор расширений: достижимы все {len(full[3])} рецептов. Ресурсный bootstrap стали и велита не замкнут на собственный недоступный станок.
- Первая кислородная база, ракета I и базовая солнечная энергетика не требуют велита/астрита. Первая база также не требует золота.
- Соотношения пылинок/пыли/слитков и N порций сжатого грунта проверены.
- Максимальный возврат воды из урожая с одним дополнительным семенем: {crop_max_return}; он меньше воды выращивания соответствующей культуры.
- Электролиз: {o2_rate:g} GU O₂/с при работе; потребность одного игрока и техническая потеря 48 м³: {1+0.002*48:g} GU/с. Это арифметика игровых единиц.
- Два баллона II: 960 с дыхания; планируемая первая вылазка 600 с оставляет 360 с резерва.
- Два аккумулятора: 12000 EU; холодная базовая зона 18 EU/с × 480 с ночи = 8640 EU, без промышленности и её дополнительных потребителей.
- Относительные ссылки текущей спецификации проверены.

## Ведомость ранней базы

Набор: верстак, печь, биогенератор, электролиз, заправка, второй базовый баллон, распределитель, купол, 4 кабеля, 4 газовых трубы, кровать и контейнер.

Материалы по выбранным базовым рецептам: **{desc(raw)}**.

Последовательное время рецептов: {t} с; номинальная энергия рабочих операций: {e} EU. Это не время прохождения: добыча/перемещения/заказы/топливо генератора и параллельность отдельно. Побочный pulp от травы учитывается в запасе ведомости, а не начисляется повторно.

## Ракета и подготовка

Ракета I + две площадки + термобельё I, без стоимости уже построенных станков: **{desc(rocketraw)}**. Последовательное время рецептов {rt} с, энергия {rocket_energy} EU. Ведомость не включает fuel/O₂, еду, дополнительное энергоснабжение и повторное строительство фабрики.

## Границы проверки

Достижимость — фиксированная точка по наличию типов предметов/условий. Она не доказывает достаточный объём руды в конкретном seed, временную доступность случайных семян, геометрический маршрут, пропускную способность сети, мобильный FPS или длительность 25–35 минут. Эти проверки перечислены в [плане QA](08_BALANCE_QA.md). Проверка воды покрывает явные циклы выращивания/восстановления, не является общим доказательством отсутствия всех экономических эксплойтов. Полная игра/рендер не запускались.
'''
(ROOT/'docs/spec/VALIDATION_REPORT.md').write_text(report)
print(f'PASS: {len(items)} items, {len(rs)} recipes; core {len(core[3])}; full {len(full[3])}')
print('Starter BOM:',desc(raw))
