import { countItem } from './inventory';
import { ITEMS, TANKS } from './defs';
import { RECIPES, RECIPE_BY_ID, poweredComponent, telemetry, powerRate, supplyRate, gasRate, roomRate, ELECTROLYZER_O2, FIBER_EU, GEN_BUFFER, O2_PER_WU, PORT_O2, nearby, type Building } from './production';
import type { GameState } from './state';
import { around, capacityOf, distributorsNeeded, habitableQ, habitableRoom, leakAt, roomAtCell, roomDistributors, stationRoom, DISTRIBUTOR_M3, type RoomInfo } from './rooms';
/**
 * Plain-language state of a station for its window, the aim label and the status lamp.
 * `tone`: ok (working), idle (fine, waiting), warn (needs the player), off (switched off).
 * `checks` lists the conditions of systems with several requirements (a glass room) with a fix each.
 */
export type Tone = 'ok' | 'idle' | 'warn' | 'off';
export type Check = { ok: boolean; label: string; fix: string };
export type StationStatus = { tone: Tone; title: string; hint: string; checks?: Check[] };
const generatorIn = (g: GameState, b: Building) => { const net = poweredComponent(g, b.id); return g.world.base.buildings.filter(v => v.kind === 'biogenerator' && net.has(v.id)); };
// A generator inside a room may still spend its stored energy, but never burns fuel there (productionTick).
const hasPower = (g: GameState, b: Building) => generatorIn(g, b).some(v => v.enabled && (v.energy > 0 || !stationRoom(g, v) && (v.fuel > 0 || countItem(v.input, 'fiber') > 0)));
export function stationStatus(g: GameState, b: Building): StationStatus {
 if (!b.enabled) return { tone: 'off', title: 'Выключено', hint: 'Нажмите «Включить», чтобы станция снова работала.' };
 const r = b.job ? RECIPE_BY_ID.get(b.job.recipeId) : undefined, running = !!b.job && !!r && b.job.workMs < r.seconds * 1000, pct = r && b.job ? Math.floor(Math.min(1, b.job.workMs / (r.seconds * 1000)) * 100) : 0;
 const outName = r ? ITEMS[Object.keys(r.outputs)[0]]?.name ?? 'Вода' : '';
 switch (b.kind) {
  case 'kiln': {
   const raw = b.input[0], fuel = b.input[1]?.count ?? 0;
   if (b.job && !running) return { tone: 'warn', title: 'Выход заполнен', hint: 'Заберите готовый результат — следующая плавка ждёт место.' };
   if (running) return { tone: 'ok', title: `Плавка ${pct}%`, hint: `${outName}: ${Math.max(0, (r!.seconds * 1000 - b.job!.workMs) / 1000).toFixed(1)} с` };
   if (!raw) return { tone: 'idle', title: 'Ждёт сырьё', hint: 'Положите руду, песок или лёд из рюкзака.' };
   const recipe = RECIPES.find(v => v.station === 'kiln' && v.inputs[raw.itemId]);
   if (!recipe) return { tone: 'warn', title: 'Не плавится', hint: 'Этот предмет печь не обрабатывает — заберите его.' };
   if (raw.count < recipe.inputs[raw.itemId]) return { tone: 'warn', title: 'Мало сырья', hint: `Нужно ${recipe.inputs[raw.itemId]} × ${ITEMS[raw.itemId].name} на одну плавку.` };
   if (fuel < (recipe.inputs.fiber ?? 0)) return { tone: 'warn', title: 'Нет топлива', hint: 'Добавьте растительное волокно в слот топлива.' };
   if (b.output[0] && b.output[0].itemId !== Object.keys(recipe.outputs)[0]) return { tone: 'warn', title: 'Выход занят', hint: 'Заберите прежний результат, чтобы начать новую плавку.' };
   return { tone: 'idle', title: 'Готова', hint: 'Плавка начнётся автоматически.' };
  }
  case 'biogenerator': {
   const out = supplyRate(b.id), fiber = countItem(b.input, 'fiber');
   if (out > 0) return { tone: 'ok', title: `Выдаёт ${out.toFixed(0)} EU/с`, hint: `Запас: ${Math.round(b.energy / 1000)} EU, волокна ${fiber}` + (b.fuel ? ` + ${Math.round(b.fuel / 1000)} EU в топке` : '') };
   if (!fiber && !b.fuel && b.energy < 1000) return { tone: 'warn', title: 'Нет топлива', hint: `Загрузите растительное волокно: 1 волокно = ${FIBER_EU / 1000} EU.` };
   if (stationRoom(g, b)) return { tone: 'warn', title: 'Внутри помещения', hint: 'Горение в помещении запрещено — перенесите генератор наружу.' };
   if (!g.world.base.links.some(l => l.kind === 'cable' && (l.from === b.id || l.to === b.id))) return { tone: 'idle', title: 'Не подключён', hint: 'Протяните кабель к станциям, которым нужна энергия.' };
   return { tone: 'idle', title: 'Ожидает нагрузку', hint: `Запас ${Math.round(b.energy / 1000)} / ${GEN_BUFFER / 1000} EU · волокна ${fiber}` };
  }
  case 'electrolyzer': {
   const water = (b.input[0]?.itemId === 'water' ? b.input[0].count : 0) + b.water / 1000, tank = b.input[1];
   const powered = hasPower(g, b), draw = powerRate(b.id);
   if (b.job && !running) return { tone: 'warn', title: 'Буфер O₂ полон', hint: 'Подключите трубу к капсуле, заправке или распределителю, либо заправьте баллон.' };
   if (running && draw > 0) return { tone: 'ok', title: `Электролиз ${pct}%`, hint: `Потребляет ${draw.toFixed(0)} EU/с · вода ${water} WU` };
   if ((running || water > 0) && !powered) return { tone: 'warn', title: 'Нет питания', hint: generatorIn(g, b).length ? 'В генераторе нет волокна — загрузите топливо.' : 'Соедините кабелем с биогенератором.' };
   if (running) return { tone: 'warn', title: 'Мало энергии', hint: 'Генератор не успевает — добавьте второй или уменьшите нагрузку.' };
   if (tank && TANKS[tank.itemId] && (tank.milliGU ?? 0) < TANKS[tank.itemId].capacity && b.oxygen > 0) return { tone: powered ? 'ok' : 'warn', title: powered ? 'Заправляет баллон' : 'Нет питания', hint: `Баллон ${Math.round((tank.milliGU ?? 0) / 1000)} / ${TANKS[tank.itemId].capacity / 1000} GU` };
   if (!water) return { tone: 'idle', title: 'Ждёт воду', hint: 'Вода — из печи: лёд + волокно. Положите её в слот воды.' };
   // A new batch starts only while its whole yield fits the buffer (production startJob).
   if (b.oxygen > ELECTROLYZER_O2 - O2_PER_WU) { const piped = g.world.base.links.some(l => l.kind === 'gas_pipe' && l.from === b.id); return { tone: piped ? 'idle' : 'warn', title: 'Буфер O₂ полон', hint: `Следующая партия начнётся, когда освободится место для ${O2_PER_WU / 1000} GU.` + (piped ? '' : ' Подключите трубу или заправьте баллон.') }; }
   return { tone: 'idle', title: 'Готов', hint: 'Электролиз начнётся автоматически.' };
  }
  case 'refill': {
   const piped = g.world.base.links.some(l => l.kind === 'gas_pipe' && l.to === b.id);
   if (!piped && b.oxygen <= 0) return { tone: 'warn', title: 'Нет подачи O₂', hint: 'Протяните трубу от генератора кислорода.' };
   if (!hasPower(g, b)) return { tone: 'warn', title: 'Нет питания', hint: 'Заправка расходует 2 EU/с — подключите кабель.' };
   return { tone: b.oxygen > 0 ? 'idle' : 'warn', title: b.oxygen > 0 ? 'Готова к заправке' : 'Буфер пуст', hint: `В буфере ${Math.round(b.oxygen / 1000)} / ${PORT_O2 / 1000} GU` };
  }
  case 'distributor': {
   const room = stationRoom(g, b), flow = gasRate(b.id);
   if (!room) return { tone: 'warn', title: 'Вне помещения', hint: 'Распределитель работает только в замкнутом стеклянном помещении.' };
   const need = distributorsNeeded(room); if (roomDistributors(g, room).filter(d => d.enabled).length < need) return { tone: 'warn', title: 'Нужен ещё распределитель', hint: `Помещение ${room.volume} м³: один распределитель обслуживает до ${DISTRIBUTOR_M3} м³, нужно ${need}.` };
   if (flow > 0) return { tone: 'ok', title: `Подаёт ${flow.toFixed(0)} GU/с`, hint: `Буфер ${Math.round(b.oxygen / 1000)} GU · питание ${powerRate(b.id).toFixed(0)} EU/с` };
   if (!g.world.base.links.some(l => l.kind === 'gas_pipe' && l.to === b.id)) return { tone: 'warn', title: 'Нет трубы O₂', hint: 'Соедините трубой с генератором кислорода (до 12 м).' };
   if (!hasPower(g, b)) return { tone: 'warn', title: 'Нет питания', hint: 'Подключите кабель от биогенератора с топливом.' };
   if (b.oxygen <= 0) return { tone: 'warn', title: 'Нет кислорода', hint: 'Генератор кислорода ещё не наполнил буфер — нужна вода и питание.' };
   if (room.zone.q >= capacityOf(room.volume)) return { tone: 'idle', title: 'Помещение заполнено', hint: 'Подача возобновится, когда воздух будет расходоваться.' };
   return { tone: 'idle', title: 'Ожидает', hint: '' };
  }
  case 'workbench': {
   if (b.job && !running) return { tone: 'warn', title: 'Выход заполнен', hint: 'Заберите готовые предметы.' };
   if (running && b.level === 1) return nearby(g, b) ? { tone: 'ok', title: `Сборка ${pct}%`, hint: outName } : { tone: 'warn', title: 'Пауза', hint: 'Верстак I работает, только когда вы рядом.' };
   if (running) return powerRate(b.id) > 0 ? { tone: 'ok', title: `Автосборка ${pct}%`, hint: outName + (b.queue.length ? ` · в очереди ${b.queue.length}` : '') } : { tone: 'warn', title: 'Нет питания', hint: 'Верстак II работает от кабеля: 4 EU/с.' };
   if (b.level === 2 && !generatorIn(g, b).length) return { tone: 'warn', title: 'Не подключён', hint: 'Протяните кабель от биогенератора: 4 EU/с во время сборки.' };
   if (b.level === 2 && !hasPower(g, b)) return { tone: 'warn', title: 'Нет питания', hint: 'Генератору в сети нужно волокно.' };
   return { tone: 'idle', title: b.level === 2 ? 'Питание есть · очередь пуста' : 'Свободен', hint: 'Выберите рецепт.' };
  }
 }
 void telemetry;
}
/** Habitability checklist of a closed glass room (its window): what is missing, with a fix for each. */
export function roomStatus(g: GameState, room: RoomInfo): StationStatus {
 const z = room.zone, inside = roomDistributors(g, room), need = distributorsNeeded(room), working = inside.filter(d => d.enabled).length;
 // Pipe and power must meet at one distributor: each one feeds the room with the power given to it.
 const piped = (d: Building) => g.world.base.links.some(l => l.kind === 'gas_pipe' && l.to === d.id);
 const best = inside.find(d => piped(d) && hasPower(g, d)) ?? inside.find(piped) ?? inside[0];
 const pipe = !!best && piped(best), power = !!best && hasPower(g, best), feed = roomRate('room-' + room.cell), min = habitableQ(room.volume) / 1000;
 const checks: Check[] = [
  { ok: inside.length > 0, label: 'Распределитель внутри', fix: 'Поставьте распределитель в помещение (можно целиться сквозь стекло).' },
  { ok: working >= need, label: `Распределителей: ${working} из ${need}`, fix: `Один распределитель обслуживает до ${DISTRIBUTOR_M3} м³ — поставьте ещё один или разделите помещение стеной.` },
  { ok: pipe, label: 'Труба O₂ к распределителю', fix: 'Труба от генератора кислорода к распределителю, до 12 м.' },
  { ok: power, label: 'Питание распределителя', fix: 'Кабель от биогенератора к распределителю.' },
  { ok: z.q >= habitableQ(room.volume), label: `Кислород ≥ ${min} GU (${Math.floor(z.q / 1000)})`, fix: feed > 0 ? `Наполняется: +${feed.toFixed(0)} GU/с` : 'Нужен работающий генератор кислорода с водой.' },
  { ok: z.purity >= .5, label: `Чистота ≥ 50% (${Math.round(z.purity * 100)}%)`, fix: 'Распределитель очищает воздух, пока у него есть питание.' },
  { ok: z.temperature >= -5 && z.temperature <= 40, label: `Температура −5…+40 °C (${Math.round(z.temperature)} °C)`, fix: 'Климат-блок распределителя греет воздух при питании.' },
 ];
 if (habitableRoom(room)) return { tone: 'ok', title: 'Воздух пригоден', hint: `Объём ${room.volume} м³ · можно дышать без баллонов · ${Math.floor(z.q / 1000)} / ${capacityOf(room.volume) / 1000} GU`, checks };
 return { tone: 'warn', title: 'Воздух непригоден', hint: checks.find(c => !c.ok)!.fix, checks };
}
/** Status of the structure a glass block or airlock belongs to: the room beside it, else why it is not closed. */
export function structureStatus(g: GameState, key: number): StationStatus & { room: RoomInfo | null; leak: number[] } {
 for (const n of around(key)) { const room = roomAtCell(g, n); if (room) return { ...roomStatus(g, room), room, leak: [] }; }
 const leak = leakAt(g, key);
 if (leak?.kind === 'big') return { tone: 'warn', title: 'Слишком большой объём', hint: 'Больше 1024 м³ — нужны перегородки.', room: null, leak: [] };
 return { tone: 'warn', title: 'Утечка', hint: 'Конструкция не замкнута: воздух уходит наружу. Закройте путь утечки стеклоблоками.', room: null, leak: leak?.path ?? [] };
}
