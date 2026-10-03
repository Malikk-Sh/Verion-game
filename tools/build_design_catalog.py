"""Build the reviewable GDD recipe catalog. Not game implementation."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[1]
items={}; recipes=[]
def item(i,n,kind='item',stack=64,source=None):
 items[i]={'name':n,'kind':kind,'stack':stack}
 if source: items[i]['source']=source
names='''stone|Камень
sand|Песок
soil_a|Грунт Верданы
soil_b|Реголит Нивы
soil_c|Пепельный грунт Пирры
soil_asteroid|Астероидная крошка
grass|Съедобная трава
fiber|Растительные волокна
pulp|Пищевая масса
ice|Кусок льда
carbon|Углеродное сырьё
carbonate|Углеродсодержащая порода
volatile_rock|Газоносная порода
hydrocarbon_rock|Углеводородная порода
iron_raw|Железная руда
copper_raw|Медная руда
gold_raw|Золотая руда
velite_raw|Велитовая руда
astrite_raw|Астритовая руда
iron|Железный слиток
copper|Медный слиток
gold|Золотой слиток
velite|Велитовый слиток
astrite|Астритовый слиток
steel|Стальной слиток
glass|Стекло
plate_iron|Железная пластина
plate_steel|Стальная пластина
plate_velite|Велитовая пластина
plate_astrite|Астритовая пластина
wire|Медный провод
circuit|Базовая электроника
circuit_adv|Продвинутая электроника
motor|Привод
seal|Уплотнитель
cloth|Ткань
sorbent|Сорбент
spent_sorbent|Отработанный сорбент
mineral_residue|Минеральный остаток
compost|Компост
fertilizer|Удобрение
fertile_soil|Плодородный грунт
seed_reed|Семя тростника
seed_tuber|Семя клубнеплода
seed_bean|Семя бобов
seed_tree|Семя древовидной культуры
seed_potato|Картофель для посадки
reed|Сочный тростник
tuber|Клубнеплод
beans|Бобы
potato|Картофель
wood|Древесина
algae|Культура водорослей
biomass|Влажная биомасса
meal|Приготовленный клубнеплод
ration|Полевой рацион
fragment_a|Фрагмент панциря
fragment_b|Фрагмент криопанциря
fragment_c|Фрагмент термопанциря
shell|Панцирная пластина
cryo_shell|Криопластина
heat_shell|Термопластина
blueprint_rocket|Чертёж первой ракеты
blueprint_industry|Чертёж велитовой промышленности
blueprint_station|Чертёж станции
blueprint_heat|Чертёж термостойких сплавов
ore_core|Рудный керн
research_sample|Научный образец'''
for line in names.splitlines(): i,n=line.split('|');item(i,n)
for metal in ['iron','copper','gold','velite','astrite']:
 item(metal+'_dust',items[metal]['name'].replace('слиток','пыль'))
 item(metal+'_speck',items[metal]['name'].replace('слиток','пылинка'))
for i,n in [('water','Вода'),('oxygen','Кислород'),('hydrogen','Водород'),('co2','Газ CO₂'),('buffer_gas','Фоновый газ'),('oil','Нефть'),('fuel','Нефтяное горючее')]:item(i,n,'fluid',0)
base_sources={'stone':['verdana','niva','asteroid','pyra'],'sand':['verdana','niva','pyra'],'grass':['verdana'],'ice':['verdana','niva'],'carbon':['verdana','niva','asteroid','pyra'],'carbonate':['verdana','niva','pyra'],'volatile_rock':['verdana','niva','pyra'],'hydrocarbon_rock':['niva','pyra'],'oil':['verdana'],'soil_a':['verdana'],'soil_b':['niva'],'soil_c':['pyra'],'soil_asteroid':['asteroid'],'iron_raw':['verdana','niva','asteroid','pyra'],'copper_raw':['verdana','niva','asteroid','pyra'],'gold_raw':['verdana','niva','asteroid','pyra'],'velite_raw':['niva','asteroid'],'astrite_raw':['pyra'],'seed_reed':['verdana'],'seed_tuber':['verdana'],'seed_bean':['verdana'],'seed_tree':['verdana'],'seed_potato':['niva'],'fragment_a':['verdana'],'fragment_b':['niva','asteroid'],'fragment_c':['pyra'],'blueprint_rocket':['verdana'],'blueprint_industry':['niva'],'blueprint_station':['asteroid'],'blueprint_heat':['pyra'],'ore_core':['asteroid'],'research_sample':['pyra']}
base_sources['fiber']=['niva','pyra']
for i,worlds in base_sources.items():items[i]['source']={'worlds':worlds,'method':'See WORLD and SYSTEMS; source does not imply a free spawn'}
objects='''workbench|Верстак
kiln|Плавильная печь
arc_furnace|Электрическая сплавная печь
fabricator|Станция механизмов
spacebench|Ракетный ангар
biogenerator|Биогенератор
oil_generator|Топливный генератор
solar|Солнечная панель
solar_adv|Улучшенная солнечная панель
battery|Аккумулятор
battery_adv|Улучшенный аккумулятор
electrolyzer|Генератор кислорода
refill|Заправочная станция
distributor|Распределитель с климатическим блоком
autofill|Модуль автозаправки
climate_cold|Усилитель холодного климата
climate_heat|Усилитель жаркого климата
dome|Стартовый купол со шлюзом
room|Комнатный модуль
bulkhead|Герметичная переборка
airlock|Двухдверный шлюз
wall|Защитный блок
window|Прозрачный защитный блок
floor|Блок пола
vent|Вентиляционная решётка
bed|Кровать
chest|Контейнер
lamp|Автономный светильник
growlight|Агролампа
cable|Электрокабель
gas_pipe|Газовая труба
liquid_pipe|Жидкостная труба
item_link|Предметный передатчик
valve|Газовый клапан
water_tank|Бак жидкости
gas_tank|Газовый бак
pump|Водяная помпа
soil_press|Пресс грунта
plate_press|Пресс пластин
sieve_hand|Ручное сито
sieve_frame|Рамочное сито
sieve_electric|Электросито
sieve_auto|Автопросеиватель
mesh_fiber|Волоконная сетка
mesh_iron|Железная сетка
mesh_steel|Стальная сетка
mesh_velite|Велитовая сетка
extractor|Глубинный экстрактор грунта
composter|Компостница
composter_sealed|Герметичная компостница
bed_crop|Грядка-контейнер
farm_arm|Фермерский манипулятор
water_recovery|Экстрактор растительной воды
cleaner|Атмосферный очиститель
cleaner_adv|Улучшенный очиститель
gas_extractor|Газодобывающий термореактор
gas_extractor_adv|Улучшенный термореактор
greenhouse|Парниковая установка
ice_melter|Ледоплавильня
basin_intake|Узел наполнения водоёма
bioreactor|Закрытый фотобиореактор
spreader|Распространитель растений
cooler|Регулятор альбедо
refinery|Нефтепереработчик
oil_pump|Нефтяная помпа
hydrogen_collector|Модуль сбора водорода
landing_pad|Пусковая платформа 3×3
rocket_1|Ракета I
rocket_2|Ракета II
rocket_3|Ракета III
rover|Ровер
trailer|Грузовой модуль ровера
jetpack_1|Jetpack I
jetpack_2|Jetpack II
grapple|Крюк-кошка
claws|Когти
suit_helmet|Базовый шлем
suit_chest|Базовый нагрудник
suit_legs|Базовые поножи
suit_boots|Базовые ботинки
suit_pressure|Нагрудник с усилением давления
suit_heat|Нагрудник с усилением жары
suit_combined|Совмещённый нагрудник
underwear_1|Термобельё I
underwear_2|Термобельё II
bottle_1|Баллон I
bottle_2|Баллон II
bottle_3|Баллон III
canister|Канистра жидкости
gas_canister|Канистра газа
tool_stone|Каменный мультитул
pick_iron|Железная кирка
pick_steel|Стальная кирка
drill_1|Бур I
drill_2|Бур II
sword_1|Железный меч
sword_2|Стальной меч
sword_3|Велитовый меч
tablet|Планшет-справочник
repair_kit|Ремкомплект
station_kit|Комплект орбитальной станции
decor_panel|Декоративная панель
turret|Защитная турель
ammo|Боеприпасы турели
beacon|Навигационный маяк'''
for line in objects.splitlines():
 i,n=line.split('|'); item(i,n,'equipment' if i.startswith(('suit','bottle','underwear','pick','drill','sword','jetpack','tool_')) or i in ['grapple','claws','canister','gas_canister','rocket_1','rocket_2','rocket_3','rover','trailer'] else 'placeable',1 if i.startswith(('suit','bottle','underwear','pick','drill','sword','jetpack','tool_','rocket')) or i in ['grapple','claws','canister','gas_canister','rover','trailer'] else 16)

def R(id,station,inp,out,t=5,power=0,tech='start',scope='core',note=''):
 recipes.append(dict(id=id,station=station,inputs=inp,outputs=out,seconds=t,EU_per_second=power,tech=tech,scope=scope,note=note))
def C(out,station,inp,t=8,tech='start',scope='core',count=1,note=''):
 R('craft_'+out,station,inp,{out:count},t,0,tech,scope,note)
R('grass_parts','hand',{'grass':1},{'fiber':2,'pulp':1},1)
R('reed_fiber','hand',{'reed':1},{'fiber':2},1)
for metal in ['iron','copper','gold','velite','astrite']:
 scope='expansion2' if metal=='astrite' else 'core'
 R('pack_'+metal,'hand',{metal+'_speck':4},{metal+'_dust':1},1,scope=scope)
 for form in ['raw','dust']:
  R('smelt_'+metal+'_'+form,'kiln',{metal+'_'+form:1,'fiber':2},{metal:1},6,scope=scope,note='Печь сжигает волокна; снаружи в вакууме требует 2 GU O₂/с или пригодное помещение.')
  R('arc_'+metal+'_'+form,'arc_furnace',{metal+'_'+form:1},{metal:1},4,16,tech='steel',scope=scope)
R('glass','kiln',{'sand':2,'fiber':2},{'glass':1},6)
R('charcoal','kiln',{'fiber':8},{'carbon':1},10,note='Требует окислитель печи как другие операции kiln.')
R('steel','arc_furnace',{'iron':2,'carbon':1},{'steel':2},10,20,'power')
C('wire','workbench',{'copper':1},count=4)
C('cloth','hand',{'fiber':4})
C('seal','workbench',{'fiber':2,'carbon':1},count=2)
C('motor','workbench',{'iron':2,'copper':1})
C('circuit','workbench',{'iron':1,'copper':2,'glass':1})
C('circuit_adv','fabricator',{'circuit':2,'gold':1,'velite':1},tech='velite')
C('sorbent','workbench',{'carbon':1,'sand':1},count=4)
C('shell','workbench',{'fragment_a':4})
C('cryo_shell','workbench',{'fragment_b':4})
C('heat_shell','workbench',{'fragment_c':4},scope='expansion2')
for m in ['iron','steel','velite','astrite']:
 R('plate_'+m,'plate_press',{m:1},{'plate_'+m:1},3,8,'steel','expansion2' if m=='astrite' else 'core')
C('plate_iron','workbench',{'iron':1},t=10) # bootstrap slow manual plates
C('workbench','hand',{'stone':8,'fiber':4})
C('kiln','hand',{'stone':12,'fiber':4})
C('tool_stone','hand',{'stone':4,'fiber':2})
C('biogenerator','workbench',{'iron':6,'copper':2,'stone':4})
C('electrolyzer','workbench',{'iron':6,'copper':4,'glass':2})
C('refill','workbench',{'iron':2,'copper':1})
C('bottle_1','workbench',{'iron':2,'copper':1})
C('distributor','workbench',{'iron':4,'copper':2,'circuit':1})
C('dome','workbench',{'iron':8,'glass':12,'fiber':8},t=20)
C('bed','workbench',{'iron':2,'cloth':4})
C('chest','workbench',{'iron':2},count=1)
C('lamp','workbench',{'iron':1,'copper':1,'glass':1},count=2,note='Без обслуживания; условный автономный источник.')
C('cable','workbench',{'wire':1,'fiber':1},count=4)
C('gas_pipe','workbench',{'iron':1,'copper':1},count=4)
C('liquid_pipe','workbench',{'iron':1,'glass':1},count=4)
C('item_link','workbench',{'iron':1,'motor':1},count=2)
C('valve','workbench',{'iron':1,'copper':1})
C('water_tank','workbench',{'iron':4,'glass':2})
C('gas_tank','workbench',{'plate_iron':4,'copper':2})
C('canister','workbench',{'iron':2})
C('gas_canister','workbench',{'iron':2,'copper':1})
C('arc_furnace','workbench',{'iron':4,'plate_iron':4,'copper':4,'circuit':1,'stone':8},tech='power')
C('plate_press','workbench',{'iron':6,'motor':1,'circuit':1},tech='power')
C('fabricator','workbench',{'steel':6,'circuit':2,'motor':1},tech='steel')
C('spacebench','fabricator',{'steel':8,'iron':8,'circuit':2},tech='steel')
C('solar','fabricator',{'steel':2,'copper':4,'glass':4,'circuit':1},tech='steel')
C('battery','fabricator',{'iron':4,'copper':4,'carbon':2},tech='steel')
C('solar_adv','fabricator',{'solar':1,'velite':4,'circuit_adv':1},tech='velite')
C('battery_adv','fabricator',{'battery':1,'velite':4,'circuit_adv':1},tech='velite')
C('room','workbench',{'iron':8,'glass':4},t=20)
C('bulkhead','workbench',{'iron':2,'seal':1})
C('airlock','workbench',{'iron':4,'motor':1,'seal':2})
C('wall','workbench',{'iron':1},count=4)
C('floor','workbench',{'iron':1},count=4)
C('window','workbench',{'glass':1,'iron':1},count=4)
C('vent','workbench',{'iron':1},count=2)
C('growlight','fabricator',{'iron':2,'copper':2,'glass':2,'circuit':1},tech='steel')
C('autofill','fabricator',{'steel':2,'circuit':2,'motor':1},tech='steel')
C('climate_cold','fabricator',{'steel':4,'cloth':4,'circuit':1},tech='steel')
C('climate_heat','fabricator',{'astrite':4,'circuit_adv':2,'heat_shell':1},tech='pyra',scope='expansion2')
C('pump','fabricator',{'steel':2,'copper':2,'motor':1},tech='steel')
C('mesh_fiber','hand',{'fiber':4})
C('mesh_iron','workbench',{'iron':2,'fiber':2})
C('mesh_steel','fabricator',{'steel':2,'wire':2},tech='steel')
C('mesh_velite','fabricator',{'velite':2,'gold':1,'wire':2},tech='velite')
C('sieve_hand','hand',{'fiber':4,'stone':2},note='Сетка отдельная, корпус не включает её.')
C('sieve_frame','workbench',{'sieve_hand':1,'iron':2,'fiber':4},note='Перед улучшением вынуть сетку, она сохраняется.')
C('sieve_electric','fabricator',{'sieve_frame':1,'steel':2,'motor':1,'circuit':1},tech='steel')
C('sieve_auto','fabricator',{'sieve_electric':1,'velite':4,'circuit_adv':1},tech='velite')
C('soil_press','fabricator',{'steel':4,'motor':2,'circuit':1},tech='steel')
for world,suffix in [('verdana','a'),('niva','b'),('pyra','c'),('asteroid','asteroid')]:
 i='soil_'+suffix
 for n in [4,16]:
  item(i+'_x'+str(n),items[i]['name']+' ×'+str(n),'item',64)
  R('compress_'+i+'_'+str(n),'soil_press',{i:n},{i+'_x'+str(n):1},2 if n==4 else 6,12,'steel','expansion2' if suffix=='c' else 'core')
  R('unpack_'+i+'_'+str(n),'hand',{i+'_x'+str(n):1},{i:n},1,scope='expansion2' if suffix=='c' else 'core')
C('extractor','fabricator',{'steel':8,'velite':8,'motor':2,'circuit_adv':2},tech='velite')
C('composter','workbench',{'stone':4,'fiber':4})
C('composter_sealed','fabricator',{'composter':1,'steel':2,'seal':2,'circuit':1},tech='steel')
C('bed_crop','workbench',{'iron':2,'soil_a':4},count=2)
C('farm_arm','fabricator',{'steel':4,'velite':2,'motor':2,'circuit_adv':1},tech='velite')
C('water_recovery','fabricator',{'steel':4,'velite':4,'glass':2,'circuit_adv':1},tech='velite')
for organic,count in [('pulp',4),('grass',4),('fiber',8),('seed_reed',4),('seed_tuber',4),('seed_bean',4),('seed_tree',4),('seed_potato',4),('tuber',4),('beans',4),('potato',4),('biomass',4),('reed',4)]:
 R('compost_'+organic,'composter',{organic:count},{'compost':1},45)
 R('sealed_compost_'+organic,'composter_sealed',{organic:count},{'compost':1},30,4,'steel')
C('fertilizer','workbench',{'compost':1,'sand':1},count=2)
C('fertile_soil','workbench',{'soil_a':4,'compost':1},count=4,note='Искусственный грунт не просеивается.')
R('cook_tuber','kiln',{'tuber':1,'fiber':1},{'meal':1},4)
R('cook_potato','kiln',{'potato':1,'fiber':1},{'meal':1},4)
C('ration','workbench',{'meal':1,'beans':1})
C('algae','workbench',{'seed_reed':1,'compost':1,'water':2},t=15,tech='habitat')
for organic,water,count in [('reed',1,1),('biomass',1,1),('seed_reed',1,8),('seed_tuber',1,8),('seed_bean',1,8),('seed_tree',1,8),('seed_potato',1,8)]:
 R('recover_'+organic,'water_recovery',{organic:count},{'water':water,'fiber':1},10,15,'velite',note='Выход меньше водного вложения соответствующего выращивания; не бесконечная вода из сухих семян.')
C('cleaner','fabricator',{'iron':8,'copper':4,'circuit':1},tech='steel')
C('gas_extractor','fabricator',{'iron':10,'copper':4,'motor':2},tech='steel')
C('greenhouse','fabricator',{'iron':8,'copper':6,'circuit':1},tech='steel')
C('ice_melter','fabricator',{'iron':6,'copper':4},tech='steel')
C('basin_intake','fabricator',{'iron':4,'copper':2,'motor':1},tech='steel')
C('bioreactor','fabricator',{'iron':8,'copper':6,'glass':4,'circuit':1},tech='steel')
C('spreader','fabricator',{'iron':6,'copper':4,'motor':1},tech='steel')
C('cleaner_adv','fabricator',{'cleaner':1,'velite':4,'circuit_adv':1},tech='velite')
C('gas_extractor_adv','fabricator',{'gas_extractor':1,'velite':4,'circuit_adv':1},tech='velite')
C('cooler','fabricator',{'steel':6,'astrite':4,'glass':6,'circuit_adv':2},tech='pyra',scope='expansion2')
C('refinery','fabricator',{'steel':6,'iron':4,'motor':1,'circuit':1},tech='steel')
C('oil_pump','fabricator',{'steel':4,'motor':1,'copper':2},tech='steel')
C('oil_generator','fabricator',{'steel':6,'motor':2,'circuit':1},tech='steel')
C('hydrogen_collector','fabricator',{'steel':4,'velite':4,'gas_tank':1,'circuit_adv':1},tech='velite')
R('electrolysis','electrolyzer',{'water':1},{'oxygen':240,'hydrogen':480},10,12,'power',note='H₂ автоматически сбрасывается до установки модуля сбора; воду и газы учитывать разными игровыми единицами.')
R('melt_in_generator','electrolyzer',{'ice':1},{'water':1},2,6,'power')
R('melt_bulk','ice_melter',{'ice':4},{'water':4},4,20,'steel')
R('extract_co2','gas_extractor',{'carbonate':1},{'co2':40,'mineral_residue':1},10,30,'steel')
R('extract_buffer','gas_extractor',{'volatile_rock':1},{'buffer_gas':40,'mineral_residue':1},10,30,'steel')
R('extract_co2_adv','gas_extractor_adv',{'carbonate':1},{'co2':40,'mineral_residue':1},5,45,'velite')
R('extract_buffer_adv','gas_extractor_adv',{'volatile_rock':1},{'buffer_gas':40,'mineral_residue':1},5,45,'velite')
R('photosynthesis','bioreactor',{'co2':40,'water':1,'fertilizer':1},{'oxygen':40,'biomass':1},20,20,'steel',note='Культура algae установлена как катализатор; освещение встроено в потребление. Режим баллонов/атмосферы выбирается явно, выпуск не дублирует продукт.')
R('refine_oil','refinery',{'oil':2},{'fuel':2},5,16,'steel')
R('extract_oil_rock','refinery',{'hydrocarbon_rock':1},{'oil':4,'mineral_residue':1},10,20,'steel')
C('landing_pad','spacebench',{'plate_steel':6,'iron':6},t=20,tech='steel')
C('rocket_1','spacebench',{'plate_steel':48,'iron':24,'copper':12,'circuit':6,'motor':4,'seal':8},t=120,tech='flight')
C('rocket_2','spacebench',{'rocket_1':1,'plate_velite':24,'steel':16,'circuit_adv':4,'motor':4},t=120,tech='velite')
C('rocket_3','spacebench',{'rocket_2':1,'plate_astrite':24,'velite':12,'circuit_adv':6,'seal':8},t=180,tech='hydrogen',scope='expansion2')
C('rover','spacebench',{'steel':12,'motor':2,'circuit':2,'seal':4},t=30,tech='steel')
C('trailer','spacebench',{'steel':6,'iron':4},tech='steel')
C('jetpack_1','fabricator',{'velite':6,'steel':4,'motor':2,'circuit_adv':1,'gas_tank':1},t=25,tech='velite')
C('jetpack_2','fabricator',{'jetpack_1':1,'velite':8,'circuit_adv':2,'cryo_shell':1},t=30,tech='velite')
C('grapple','workbench',{'iron':4,'fiber':12,'motor':1},tech='power')
C('claws','fabricator',{'steel':4,'shell':1},tech='steel')
R('craft_suit','workbench',{'iron':6,'cloth':4,'seal':2},{'suit_helmet':1,'suit_chest':1,'suit_legs':1,'suit_boots':1},8,0,'start','core','Комплект из четырёх независимых частей костюма (D30); цена прежнего базового скафандра.')
C('underwear_1','workbench',{'cloth':6,'fiber':4})
C('underwear_2','fabricator',{'underwear_1':1,'cloth':4,'cryo_shell':1},tech='velite')
C('suit_pressure','fabricator',{'suit_chest':1,'steel':4,'velite':4,'shell':1},tech='velite')
C('suit_heat','fabricator',{'suit_chest':1,'steel':4,'velite':4,'cryo_shell':1},tech='velite')
C('suit_combined','fabricator',{'suit_pressure':1,'suit_heat':1},tech='velite',note='Потребляет два нагрудника; возвращает установленные баллоны/когти в инвентарь, свойства объединяет. Цена одинакова в любом порядке.')
C('bottle_2','fabricator',{'bottle_1':1,'steel':2,'seal':1},tech='steel')
C('bottle_3','fabricator',{'bottle_2':1,'velite':2,'seal':1},tech='velite')
C('pick_iron','workbench',{'iron':3,'fiber':2})
C('pick_steel','workbench',{'steel':3,'fiber':2},tech='steel')
C('drill_1','fabricator',{'velite':4,'steel':4,'motor':2,'circuit_adv':1},tech='velite')
C('drill_2','fabricator',{'drill_1':1,'velite':6,'circuit_adv':2},tech='velite')
C('sword_1','workbench',{'iron':3,'fiber':2})
C('sword_2','fabricator',{'steel':3,'shell':1},tech='steel')
C('sword_3','fabricator',{'velite':3,'cryo_shell':1,'steel':2},tech='velite')
C('repair_kit','workbench',{'iron':1,'fiber':2},count=2)
C('tablet','workbench',{'iron':1,'copper':1,'glass':1},note='Первая ачивка выдаёт первый экземпляр; рецепт для замены потерянного.')
C('beacon','workbench',{'iron':2,'copper':1,'glass':1},tech='power')
C('station_kit','spacebench',{'plate_steel':64,'iron':32,'velite':24,'glass':16,'solar':4,'battery':2,'landing_pad':1,'chest':1},t=180,tech='station',scope='expansion1',note='При создании списывается комплект из инвентаря персонажа. Содержит перечисленные установленные панели/батареи/площадку/сундук, без скрытого удвоения.')
C('decor_panel','workbench',{'wood':1,'iron':1},count=4,scope='expansion1')
C('turret','fabricator',{'velite':8,'astrite':4,'motor':2,'circuit_adv':2},tech='pyra',scope='expansion2')
C('ammo','fabricator',{'iron':1,'carbon':1},count=20,scope='expansion2')
R('regenerate_sorbent','arc_furnace',{'spent_sorbent':4,'carbon':1},{'sorbent':2,'mineral_residue':2},20,20,'steel')
for r in recipes:
 if r['id'] in ['craft_bed_crop','craft_fertile_soil']:
  r['inputAlternatives']={'soil_a':['soil_a','soil_b','soil_c']}
# All destructive/dismantling operations retain object state; they are not recipes duplicating outputs.
for r in recipes:
 for i in (*r['inputs'],*r['outputs']): assert i in items,(r['id'],i)
 assert r['station']=='hand' or r['station'] in items,r
assert len({r['id'] for r in recipes})==len(recipes)
data={'version':'1.1.0','status':'baseline_design_not_playtested','units':{'EU':'условная энергия','GU':'условная единица конкретного газа','WU':'условная единица воды','FU':'условная единица нефтепродукта'},'items':items,'recipes':recipes}
(ROOT/'docs/data/catalog.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
lines=['# Каталог предметов и рецептов — GDD 1.0','', '**Статус:** принятый по делегированию исходный баланс, не результат игрового теста. Единственный численный источник рецептов — [catalog.json](../data/catalog.json). Генератор таблицы: `tools/build_design_catalog.py`.','', 'Все новые баллоны, баки, аккумуляторы, ракеты и jetpack создаются пустыми. Улучшение переносит фактический остаток в пределах новой ёмкости; лишнее требует свободной тары, иначе крафт запрещён. Модифицированные предметы нельзя стакать. `hand` — ручной крафт. Время ручного крафта не ставит мир на паузу. Изготовление корпуса на верстаке/станции не расходует EU; рабочие операции машин расходуют указанную мощность. Помещение/свет/культура и природный источник являются дополнительными условиями, описанными в системной спецификации.','', 'Операции компоста, плавки и электролиза перечислены здесь; просеивание, выращивание, добыча, генерация энергии, ремонт и планетарные эффекты имеют формулы в соседних разделах. Нет скрытого рецепта получения любого предмета через универсальную валюту.','', '## Рецепты','', '| ID | Где | Вход | Выход | Секунды | EU/с | Технология / объём |','| --- | --- | --- | --- | ---: | ---: | --- |']
def desc(d):return ', '.join(f'{v} × {items[k]["name"]}' for k,v in d.items()) or '—'
for r in recipes:
 lines.append(f'| {r["id"]} | {items.get(r["station"],{}).get("name","Вручную")} | {desc(r["inputs"])} | {desc(r["outputs"])} | {r["seconds"]} | {r["EU_per_second"]} | {r["tech"]} / {r["scope"]} |')
lines+=['','## Уточнения к операциям','']
for r in recipes:
 if r['note']:lines.append(f'- **{r["id"]}:** {r["note"]}')
lines+=['','## Реестр предметов','', '| ID | Название | Тип | Стак |','| --- | --- | --- | ---: |']
for i,v in items.items():lines.append(f'| {i} | {v["name"]} | {v["kind"]} | {v["stack"]} |')
(ROOT/'docs/spec/04_RECIPES.md').write_text('\n'.join(lines)+'\n')
print(f'{len(items)} items; {len(recipes)} recipes')
