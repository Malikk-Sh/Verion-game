import { countItem } from './inventory';
import { ITEMS, TANKS } from './defs';
import { RECIPES, RECIPE_BY_ID, habitable, insideDome, sealCheck, poweredComponent, telemetry, powerRate, supplyRate, gasRate, roomRate, DOME_CAPACITY, nearby, type Building } from './production';
import type { GameState } from './state';
/**
 * Plain-language state of a station for its window, the aim label and the status lamp.
 * `tone`: ok (working), idle (fine, waiting), warn (needs the player), off (switched off).
 * `checks` lists the conditions of systems with several requirements (the dome) with a fix each.
 */
export type Tone = 'ok' | 'idle' | 'warn' | 'off';
export type Check = { ok: boolean; label: string; fix: string };
export type StationStatus = { tone: Tone; title: string; hint: string; checks?: Check[] };
const generatorIn = (g: GameState, b: Building) => { const net = poweredComponent(g, b.id); return g.world.base.buildings.filter(v => v.kind === 'biogenerator' && net.has(v.id)); };
const hasPower = (g: GameState, b: Building) => generatorIn(g, b).some(v => v.enabled && (v.energy > 0 || v.fuel > 0 || countItem(v.input, 'fiber') > 0));
const roomOf = (g: GameState, b: Building) => g.world.base.buildings.find(d => d.kind === 'dome' && insideDome(d, b.x, b.y, b.z));
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
   if (!fiber && !b.fuel && b.energy < 1000) return { tone: 'warn', title: 'Нет топлива', hint: 'Загрузите растительное волокно: 1 волокно = 200 EU.' };
   if (!g.world.base.links.some(l => l.kind === 'cable' && (l.from === b.id || l.to === b.id))) return { tone: 'idle', title: 'Не подключён', hint: 'Протяните кабель к станциям, которым нужна энергия.' };
   if (roomOf(g, b)) return { tone: 'warn', title: 'Внутри купола', hint: 'Горение внутри купола запрещено — перенесите генератор наружу.' };
   return { tone: 'idle', title: 'Ожидает нагрузку', hint: `Запас ${Math.round(b.energy / 1000)} / 400 EU · волокна ${fiber}` };
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
   return { tone: 'idle', title: 'Готов', hint: 'Электролиз начнётся автоматически.' };
  }
  case 'refill': {
   const piped = g.world.base.links.some(l => l.kind === 'gas_pipe' && l.to === b.id);
   if (!piped && b.oxygen <= 0) return { tone: 'warn', title: 'Нет подачи O₂', hint: 'Протяните трубу от генератора кислорода.' };
   if (!hasPower(g, b)) return { tone: 'warn', title: 'Нет питания', hint: 'Заправка расходует 2 EU/с — подключите кабель.' };
   return { tone: b.oxygen > 0 ? 'idle' : 'warn', title: b.oxygen > 0 ? 'Готова к заправке' : 'Буфер пуст', hint: `В буфере ${Math.round(b.oxygen / 1000)} / 480 GU` };
  }
  case 'distributor': {
   const room = roomOf(g, b), flow = gasRate(b.id);
   if (!room) return { tone: 'warn', title: 'Вне купола', hint: 'Распределитель работает только внутри герметичного купола.' };
   if (flow > 0) return { tone: 'ok', title: `Подаёт ${flow.toFixed(0)} GU/с`, hint: `Буфер ${Math.round(b.oxygen / 1000)} GU · питание ${powerRate(b.id).toFixed(0)} EU/с` };
   if (!g.world.base.links.some(l => l.kind === 'gas_pipe' && l.to === b.id)) return { tone: 'warn', title: 'Нет трубы O₂', hint: 'Соедините трубой с генератором кислорода (до 12 м).' };
   if (!hasPower(g, b)) return { tone: 'warn', title: 'Нет питания', hint: 'Подключите кабель от биогенератора с топливом.' };
   if (b.oxygen <= 0) return { tone: 'warn', title: 'Нет кислорода', hint: 'Генератор кислорода ещё не наполнил буфер — нужна вода и питание.' };
   if (room.zone.q >= DOME_CAPACITY) return { tone: 'idle', title: 'Купол заполнен', hint: 'Подача возобновится, когда воздух будет расходоваться.' };
   return { tone: 'idle', title: 'Ожидает', hint: '' };
  }
  case 'dome': {
   const seal = sealCheck(b.zone.shell), inside = g.world.base.buildings.filter(d => d.kind === 'distributor' && insideDome(b, d.x, d.y, d.z));
   const pipe = inside.some(d => g.world.base.links.some(l => l.kind === 'gas_pipe' && l.to === d.id)), power = inside.some(d => hasPower(g, d)), feed = roomRate(b.id);
   const checks: Check[] = [
    { ok: seal.sealed, label: 'Оболочка герметична', fix: 'Пробита панель — ремонт пока недоступен, переставьте купол.' },
    { ok: inside.length > 0, label: 'Распределитель внутри', fix: 'Поставьте распределитель внутри купола (можно целиться сквозь стекло).' },
    { ok: pipe, label: 'Труба O₂ к распределителю', fix: 'Труба от генератора кислорода к распределителю, до 12 м.' },
    { ok: power, label: 'Питание распределителя', fix: 'Кабель от биогенератора к распределителю.' },
    { ok: b.zone.q >= 384000, label: `Кислород ≥ 384 GU (${Math.round(b.zone.q / 1000)})`, fix: feed > 0 ? `Наполняется: +${feed.toFixed(0)} GU/с` : 'Нужен работающий генератор кислорода с водой.' },
    { ok: b.zone.purity >= .5, label: `Чистота ≥ 50% (${Math.round(b.zone.purity * 100)}%)`, fix: 'Распределитель очищает воздух, пока у него есть питание.' },
    { ok: b.zone.temperature >= -5 && b.zone.temperature <= 40, label: `Температура −5…+40 °C (${Math.round(b.zone.temperature)} °C)`, fix: 'Климат-блок распределителя греет воздух при питании.' },
   ];
   if (habitable(b)) return { tone: 'ok', title: 'Воздух пригоден', hint: `Внутри можно дышать без баллонов · ${Math.round(b.zone.q / 1000)} GU`, checks };
   const first = checks.find(c => !c.ok)!;
   return { tone: 'warn', title: 'Воздух непригоден', hint: first.fix, checks };
  }
  case 'workbench': {
   if (b.job && !running) return { tone: 'warn', title: 'Выход заполнен', hint: 'Заберите готовые предметы.' };
   if (running && b.level === 1) return nearby(g, b) ? { tone: 'ok', title: `Сборка ${pct}%`, hint: outName } : { tone: 'warn', title: 'Пауза', hint: 'Верстак I работает, только когда вы рядом.' };
   if (running) return powerRate(b.id) > 0 ? { tone: 'ok', title: `Автосборка ${pct}%`, hint: outName + (b.queue.length ? ` · в очереди ${b.queue.length}` : '') } : { tone: 'warn', title: 'Нет питания', hint: 'Верстак II работает от кабеля: 4 EU/с.' };
   return { tone: 'idle', title: b.level === 2 ? 'Очередь пуста' : 'Свободен', hint: 'Откройте и выберите рецепт.' };
  }
 }
 void telemetry;
}
