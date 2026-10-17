import { countItem } from './inventory';
import { allDeposits, depositLeft } from './resources';
import { RECIPE_BY_ID, WORKBENCH_UPGRADE, type Building } from './production';
import { allRooms, cellOf, doorCenter, habitableQ, habitableRoom, roomCenter, roomDoors, roomy, stationRoom, type Room, type RoomInfo } from './rooms';
export { roomy };
import { ITEMS } from './defs';
import { questStatus } from './quests';
import type { QuestId } from './questCatalog';
import type { GameState } from './state';
/**
 * Expedition guide (S3). Every development milestone is a short, concrete step with live counters
 * ("Камень 7 / 12"), plain instructions and a place in the world to go to. The guide never grants
 * items and never gates actions: it only reads the game state. Completion stays the milestone
 * logic of quests.ts, so the order is a recommendation and any path the player takes counts.
 */
export type GuideTarget = { name: string; x: number; z: number; kind: 'node' | 'station' | 'capsule' | 'area' };
export type GuideTask = { label: string; have: number; need: number; done: boolean; unit?: string; target?: GuideTarget | null; recipe?: string; item?: string };
export type GuideStep = { id: QuestId; chapter: number; title: string; why: string; how: string[]; item: string; tasks: GuideTask[]; optional?: boolean; recipes: string[] };
export const CHAPTERS = ['Высадка', 'Металл и стекло', 'Энергия и кислород', 'Убежище', 'Автоматизация', 'Дополнительно'];
/** Recommended order; a later step may already be done. */
export const GUIDE_ORDER: QuestId[] = ['materials', 'bench', 'kiln', 'metals', 'glass', 'generator', 'electrolyzer', 'power', 'oxygen', 'refill', 'circuit', 'dome', 'distributor', 'air', 'wrench', 'bench2', 'auto', 'base', 'tool'];
const BASE_AREA: GuideTarget = { name: 'Площадка базы', x: 58, z: 44, kind: 'area' };
const CAPSULE: GuideTarget = { name: 'Капсула', x: 40, z: 42, kind: 'capsule' };
const dist = (g: GameState, x: number, z: number) => Math.hypot(g.player.x - x, g.player.z - z);
/** Nearest deposit with stock of an item (a static deposit or a new vein, D33): in the valley that is a valley deposit, beside a far one it is that one. */
export function nearestNode(g: GameState, itemId: string): GuideTarget | null {
 const live = allDeposits(g).filter(n => n.itemId === itemId && depositLeft(g, n.id) > 0);
 const n = live.sort((a, b) => dist(g, a.x, a.z) - dist(g, b.x, b.z))[0];
 return n ? { name: n.name, x: n.x, z: n.z, kind: 'node' } : null;
}
export function nearestStation(g: GameState, kind: string, level?: number): GuideTarget | null {
 const b = g.world.base.buildings.filter(b => b.kind === kind && (level === undefined || b.level === level)).sort((a, c) => dist(g, a.x, a.z) - dist(g, c.x, c.z))[0];
 return b ? { name: ITEMS[b.kind]?.name ?? kind, x: b.x, z: b.z, kind: 'station' } : null;
}
const has = (g: GameState, kind: string) => g.world.base.buildings.some(b => b.kind === kind);
/** The compass goes to the nearest airlock or glass room (S4). */
export function nearestShelter(g: GameState, rooms: RoomInfo[] = allRooms(g)): GuideTarget | null {
 const spots: GuideTarget[] = [...g.world.base.doors.map(d => ({ name: ITEMS.airlock.name, ...doorCenter(d), kind: 'station' as const })), ...rooms.map(r => { const c = roomCenter(r); return { name: 'Помещение', x: c.x, z: c.z, kind: 'area' as const }; })];
 return spots.sort((a, b) => dist(g, a.x, a.z) - dist(g, b.x, b.z))[0] ?? null;
}
/** A room at least 3 × 3 inside and 3 high (the journal's box; any closed room still counts for the milestone). */
const fact = (g: GameState, f: string) => g.progress.quests.facts.includes(f);
const inv = (g: GameState, id: string) => countItem(g.player.inventory, id);
const done = (g: GameState, id: QuestId) => g.progress.quests.completed.includes(id);
/** A material counter that points at where the material comes from. */
function material(g: GameState, id: string, need: number, satisfied = false): GuideTask {
 const have = inv(g, id), ok = satisfied || have >= need;
 const raw = ['stone', 'iron_raw', 'copper_raw', 'sand', 'ice', 'grass'].includes(id);
 const recipe = !raw ? [...RECIPE_BY_ID.values()].find(r => r.outputs[id] && r.id !== 'legacy_melt')?.id : undefined;
 const station = recipe ? RECIPE_BY_ID.get(recipe)!.station : '';
 const target = ok ? null : raw ? nearestNode(g, id) : station === 'kiln' ? nearestStation(g, 'kiln') : station === 'workbench' ? nearestStation(g, 'workbench') : null;
 return { label: ITEMS[id]?.name ?? id, have: Math.min(have, need), need, done: ok, target, recipe, item: id };
}
const flag = (label: string, ok: boolean, target: GuideTarget | null = null, recipe?: string): GuideTask => ({ label, have: ok ? 1 : 0, need: 1, done: ok, target: ok ? null : target, recipe });
/** Inputs of a recipe as counters; `satisfied` when the result already exists. */
function inputs(g: GameState, recipeId: string, satisfied: boolean) { return Object.entries(RECIPE_BY_ID.get(recipeId)!.inputs).map(([id, n]) => material(g, id, n, satisfied)); }
function bodyTasks(g: GameState, kind: string, recipe: string, where: GuideTarget | null, placeLabel = 'Установить') {
 const placed = has(g, kind), carried = placed || inv(g, kind) > 0;
 const station = RECIPE_BY_ID.get(recipe)!.station;
 const at = station === 'workbench' ? nearestStation(g, 'workbench') : null;
 return [...inputs(g, recipe, carried), flag('Создать: ' + ITEMS[kind].name, carried, at, recipe), flag(placeLabel, placed, where)];
}
export function guideStep(g: GameState, id: QuestId): GuideStep {
 const D = done(g, id);
 const rooms = allRooms(g), shelter = nearestShelter(g, rooms);
 const steps: Record<QuestId, () => Omit<GuideStep, 'id'>> = {
  materials: () => ({ chapter: 0, title: 'Камень и волокно', item: 'fiber', recipes: ['grass_parts'],
   why: 'Камень и растительное волокно — основа первых станций. Трава отрастает, камня в долине много.',
   how: ['Подойдите к каменной осыпи слева от капсулы и удерживайте «Добыть».', 'Соберите местную траву — её можно рвать руками.', 'Откройте мастерскую: 1 трава → 2 волокна и 1 пища.'],
   tasks: [material(g, 'stone', 8, D), material(g, 'grass', 2, D || inv(g, 'fiber') >= 4), material(g, 'fiber', 4, D)] }),
  bench: () => ({ chapter: 0, title: 'Верстак', item: 'workbench', recipes: ['craft_workbench'],
   why: 'На верстаке собираются металлические детали, генераторы и баллоны.',
   how: ['В мастерской выберите «Верстак» и нажмите «Создать».', 'Выберите верстак в быстром доступе, наведите на ровную землю у базы и нажмите кнопку действия.'],
   tasks: bodyTasks(g, 'workbench', 'craft_workbench', BASE_AREA) }),
  kiln: () => ({ chapter: 0, title: 'Плавильная печь', item: 'kiln', recipes: ['craft_kiln'],
   why: 'Печь превращает руду в слитки, песок в стекло, а лёд — в воду. Топливо — волокно.',
   how: ['Создайте печь в мастерской и установите рядом с верстаком.'],
   tasks: bodyTasks(g, 'kiln', 'craft_kiln', BASE_AREA) }),
  metals: () => ({ chapter: 1, title: 'Железо и медь', item: 'iron', recipes: ['smelt_iron_raw', 'smelt_copper_raw'],
   why: 'Слитки нужны почти для всех станций. Руду добывают мультитулом.',
   how: ['Добудьте руду на железном и медном выходах (компас ведёт к ближайшему).', 'Откройте печь, положите руду в слот сырья и волокно в слот топлива — плавка пойдёт сама.', 'Заберите слитки из выхода печи.'],
   tasks: [material(g, 'iron_raw', 6, D || inv(g, 'iron') >= 6), material(g, 'copper_raw', 3, D || inv(g, 'copper') >= 3), flag('Выплавить железо', fact(g, 'item:iron'), nearestStation(g, 'kiln'), 'smelt_iron_raw'), flag('Выплавить медь', fact(g, 'item:copper'), nearestStation(g, 'kiln'), 'smelt_copper_raw')] }),
  glass: () => ({ chapter: 1, title: 'Стекло', item: 'glass', recipes: ['glass'],
   why: 'Стекло идёт на электронику, генератор кислорода и стеклоблоки убежища.',
   how: ['Наберите песка на песчаной осыпи (можно руками).', 'В печи: 2 песка + 1 волокно → 1 стекло.'],
   tasks: [material(g, 'sand', 4, D), flag('Выплавить стекло', fact(g, 'item:glass'), nearestStation(g, 'kiln'), 'glass')] }),
  generator: () => ({ chapter: 2, title: 'Биогенератор', item: 'biogenerator', recipes: ['craft_biogenerator'],
   why: 'Генератор сжигает волокно и даёт электричество станциям по кабелю.',
   how: ['Соберите генератор на верстаке.', 'Установите его снаружи помещений и загрузите волокно.'],
   tasks: [...bodyTasks(g, 'biogenerator', 'craft_biogenerator', BASE_AREA), flag('Загрузить волокно', g.world.base.buildings.some(b => b.kind === 'biogenerator' && (b.fuel > 0 || b.energy > 0 || countItem(b.input, 'fiber') > 0)) || D && fact(g, 'system:power'), nearestStation(g, 'biogenerator'))] }),
  electrolyzer: () => ({ chapter: 2, title: 'Генератор кислорода', item: 'electrolyzer', recipes: ['craft_electrolyzer'],
   why: 'Электролиз делает кислород из воды — так база перестаёт зависеть от запаса капсулы.',
   how: ['Соберите генератор кислорода на верстаке и установите рядом с биогенератором.'],
   tasks: bodyTasks(g, 'electrolyzer', 'craft_electrolyzer', nearestStation(g, 'biogenerator') ?? BASE_AREA) }),
  power: () => ({ chapter: 2, title: 'Энергосеть', item: 'cable', recipes: ['craft_wire', 'craft_cable'],
   why: 'Кабель передаёт энергию. Один кабель — до 4 м линии; длинная линия до 12 м тратит несколько.',
   how: ['На верстаке: медь → провод, провод + волокно → 4 кабеля.', 'Выберите кабель в быстром доступе и нажмите кнопку действия, наведя на генератор, затем на потребитель.', 'Подсказка у прицела покажет длину и сколько кабелей уйдёт.'],
   tasks: [material(g, 'cable', 2, D || g.world.base.links.some(l => l.kind === 'cable')), flag('Соединить станции кабелем', g.world.base.links.some(l => l.kind === 'cable') || D, nearestStation(g, 'biogenerator')), flag('Подать энергию', fact(g, 'system:power'), nearestStation(g, 'biogenerator'))] }),
  oxygen: () => ({ chapter: 2, title: 'Свой кислород', item: 'oxygen', recipes: ['melt_in_generator', 'electrolysis'],
   why: 'Лёд → вода в печи → кислород в генераторе. Это главный путь к безопасности.',
   how: ['Добудьте лёд в ледяной низине (можно руками, но медленнее).', 'Растопите лёд в печи: лёд + волокно → вода.', 'Положите воду в генератор кислорода — с питанием он заполнит буфер O₂.'],
   tasks: [material(g, 'ice', 2, D || inv(g, 'water') > 0 || fact(g, 'craft:melt_in_generator')), flag('Растопить лёд в воду', fact(g, 'craft:melt_in_generator') || D, nearestStation(g, 'kiln'), 'melt_in_generator'), flag('Получить кислород электролизом', fact(g, 'craft:electrolysis'), nearestStation(g, 'electrolyzer'))] }),
  refill: () => ({ chapter: 2, title: 'Заправленный баллон', item: 'bottle_1', recipes: ['craft_bottle_1', 'craft_refill', 'craft_gas_pipe'],
   why: 'Свой газ в баллонах — это свобода дальних вылазок. Второй баллон удваивает запас.',
   how: ['Откройте генератор кислорода и перетащите баллон костюма в слот заправки (или нажмите на него) — он заправится. Заправленный верните так же: прямо на костюм.', 'Или поставьте заправочную станцию, протяните к ней трубу O₂ и подключите кабель.'],
   tasks: [flag('Заправить баллон своим кислородом', fact(g, 'system:refill'), nearestStation(g, 'electrolyzer')), material(g, 'bottle_1', 1, D || g.player.bottles.filter(Boolean).length >= 2)] }),
  circuit: () => ({ chapter: 1, title: 'Электроника', item: 'circuit', recipes: ['craft_circuit'],
   why: 'Электроника нужна распределителю воздуха и улучшенному верстаку.',
   how: ['Соберите на верстаке: железо, 2 меди и стекло.'],
   tasks: [...inputs(g, 'craft_circuit', D || inv(g, 'circuit') > 0), flag('Создать электронику', fact(g, 'item:circuit'), nearestStation(g, 'workbench'), 'craft_circuit')] }),
  dome: () => {
   // S4: the shelter is built, not placed — a closed glass box on the ground with an airlock in its wall.
   // Blocks already in the walls count as made.
   const made = inv(g, 'window') + g.world.base.glass.length, closed = rooms.some(roomy), door = D || rooms.some(r => roomy(r) && roomDoors(g, r).length > 0);
   return { chapter: 3, title: 'Стеклянное убежище', item: 'window', recipes: ['craft_window', 'craft_airlock'],
    why: 'Убежище строят сами: замкнутая коробка из стеклоблоков со шлюзом — дом, где можно дышать без баллонов. Убрали блок — воздух ушёл.',
    how: ['На верстаке: 1 стекло + 1 железо → 4 стеклоблока; шлюз — 6 железа, 4 стекла и 4 волокна.', 'Выберите стеклоблок, наведите на грунт или на блок и нажмите кнопку действия (удержание ставит ряд). Стены и крыша — стекло, пол — грунт.', 'До крыши прицел достаёт сверху: сложите у стены ступеньку из блоков, встаньте на неё и ставьте блоки на верх стены, затем крышу от края.', 'Шлюз 2×2 встаёт прямо на четыре нижних блока ровной стены: они вернутся в рюкзак. Двери открывайте сами (кнопка действия на двери): наружную, войдите в камеру, закройте её, затем внутреннюю — камера наполнится из помещения.'],
    tasks: [{ ...material(g, 'window', 48, D || closed || made >= 48), have: Math.min(48, made), label: 'Наделайте стеклоблоков (1 стекло + 1 железо → 4)' }, flag('Постройте замкнутую стеклянную коробку на земле, хотя бы 3×3 внутри и высотой 3', closed || D, shelter ?? BASE_AREA), flag('Встройте шлюз в стену', door, shelter ?? BASE_AREA, 'craft_airlock')] };
  },
  distributor: () => ({ chapter: 3, title: 'Распределитель', item: 'distributor', recipes: ['craft_distributor'],
   why: 'Распределитель наполняет помещение кислородом, очищает и греет воздух. Один обслуживает до 256 м³.',
   how: ['Соберите распределитель на верстаке.', 'Поставьте его внутри помещения — можно целиться сквозь стекло снаружи.'],
   tasks: [...inputs(g, 'craft_distributor', has(g, 'distributor') || inv(g, 'distributor') > 0), flag('Создать распределитель', has(g, 'distributor') || inv(g, 'distributor') > 0, nearestStation(g, 'workbench'), 'craft_distributor'), flag('Установить внутри помещения', g.world.base.buildings.some(b => b.kind === 'distributor' && !!stationRoom(g, b)), shelter ?? BASE_AREA)] }),
  air: () => {
   // Like the room checklist: prefer a distributor inside a room where the pipe and the cable meet.
   const piped = (d: Building) => g.world.base.links.some(l => l.kind === 'gas_pipe' && l.to === d.id), wired = (d: Building) => g.world.base.links.some(l => l.kind === 'cable' && (l.to === d.id || l.from === d.id));
   const all = g.world.base.buildings.filter(b => b.kind === 'distributor'), inside = all.filter(b => !!stationRoom(g, b));
   const dist = inside.find(d => piped(d) && wired(d)) ?? inside.find(piped) ?? inside.find(wired) ?? inside[0] ?? all[0];
   const pipe = !!dist && piped(dist), cable = !!dist && wired(dist);
   // The air target is 8 GU per m³ of that room (a 3×3×3 box: 216 GU).
   const room = (dist && stationRoom(g, dist)) ?? rooms[0], need = room ? habitableQ(room.volume) / 1000 : 216, have = room ? Math.floor(room.zone.q / 1000) : 0;
   return { chapter: 3, title: 'Дышащее убежище', item: 'airlock', recipes: ['craft_gas_pipe'],
    why: 'Нужно не меньше 8 GU кислорода на каждый м³ объёма, чистота воздуха ≥50% и температура −5…+40 °C. Тогда в помещении дышат без баллонов.',
    how: ['Трубой O₂ соедините генератор кислорода с распределителем (до 12 м).', 'Кабелем подайте питание на распределитель.', 'Следите за воздухом: выберите сканер и просканируйте стеклоблок или шлюз, либо откройте окно помещения кнопкой действия.'],
    tasks: [flag('Труба: генератор кислорода → распределитель', pipe || D, nearestStation(g, 'electrolyzer'), 'craft_gas_pipe'), flag('Кабель к распределителю', cable || D, nearestStation(g, 'biogenerator')), { label: 'Воздух в помещении', have: Math.min(need, have), need, unit: 'GU', done: D || rooms.some(habitableRoom), target: D ? null : shelter }] };
  },
  wrench: () => ({ chapter: 4, title: 'Гаечный ключ', item: 'wrench', recipes: ['craft_wrench'],
   why: 'Многоразовый ключ улучшает станции и не расходуется.',
   how: ['Соберите ключ на верстаке.'],
   tasks: [...inputs(g, 'craft_wrench', D), flag('Создать ключ', fact(g, 'item:wrench'), nearestStation(g, 'workbench'), 'craft_wrench')] }),
  bench2: () => ({ chapter: 4, title: 'Верстак II', item: 'workbench_2', recipes: ['upgrade'],
   why: 'Улучшенный верстак собирает очередь из 5 партий сам, если подключён к энергии.',
   how: ['Выберите ключ в быстром доступе и нажмите кнопку действия у верстака.', 'Проверьте материалы улучшения и нажмите «Улучшить».'],
   tasks: [...Object.entries(WORKBENCH_UPGRADE.inputs).map(([id, n]) => material(g, id, n, D)), flag('Ключ в руке', D || g.player.inventory[g.player.hotbar]?.itemId === 'wrench'), flag('Улучшить верстак', D, nearestStation(g, 'workbench', 1))] }),
  auto: () => ({ chapter: 4, title: 'Автосборка', item: 'workbench_2', recipes: [],
   why: 'Верстак II работает без вас: поставьте партии в очередь и займитесь делами.',
   how: ['Протяните кабель от генератора к верстаку II.', 'Поставьте партию в очередь и отойдите дальше 3 м — работа продолжится.'],
   tasks: [flag('Кабель к верстаку II', D || g.world.base.links.some(l => l.kind === 'cable' && [l.from, l.to].some(id => g.world.base.buildings.some(b => b.id === id && b.kind === 'workbench' && b.level === 2))), nearestStation(g, 'workbench', 2)), flag('Партия собрана без вас', fact(g, 'system:auto'), nearestStation(g, 'workbench', 2))] }),
  base: () => ({ chapter: 4, title: 'База работает', item: 'window', recipes: [],
   why: 'Финал первой главы: убежище дышит, а мастерская работает сама.',
   how: ['Пока в помещении пригодный воздух, завершите любую автосборку вдали от верстака.'],
   tasks: [flag('Пригодный воздух в помещении', rooms.some(habitableRoom) || D, shelter), flag('Автосборка при живом убежище', fact(g, 'system:base'), nearestStation(g, 'workbench', 2))] }),
  tool: () => ({ chapter: 5, title: 'Запасной мультитул', item: 'tool_stone', recipes: ['craft_tool_stone'], optional: true,
   why: 'Мультитул изнашивается. Запасной лучше сделать заранее; камень и песок можно собирать и руками.',
   how: ['В мастерской (карман): 4 камня + 2 волокна.'],
   tasks: [...inputs(g, 'craft_tool_stone', D), flag('Создать мультитул', fact(g, 'craft:craft_tool_stone'), null, 'craft_tool_stone')] }),
 };
 return { id, ...steps[id]() };
}
export const stepDone = (g: GameState, id: QuestId) => done(g, id);
/** The step the HUD follows: the pinned one, else the first unfinished ready step in order. */
export function currentStep(g: GameState): QuestId | null {
 const pinned = g.progress.quests.tracked;
 if (pinned && !done(g, pinned)) return pinned;
 const open = GUIDE_ORDER.filter(id => !done(g, id) && id !== 'tool');
 return open.find(id => questStatus(g, id) === 'ready') ?? open[0] ?? (done(g, 'tool') ? null : 'tool');
}
/** First unfinished task with a place to go; the step's own place otherwise. */
export function stepTarget(g: GameState, step: GuideStep): GuideTarget | null {
 for (const t of step.tasks) if (!t.done && t.target) return t.target;
 return step.tasks.every(t => t.done) ? null : step.chapter === 0 && step.id === 'materials' ? nearestNode(g, 'stone') : null;
}
export function progressCount(g: GameState) { const main = GUIDE_ORDER.filter(id => id !== 'tool'); return { done: main.filter(id => done(g, id)).length, total: main.length }; }
export { CAPSULE as CAPSULE_TARGET };
