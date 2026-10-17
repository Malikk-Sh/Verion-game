import { countItem } from './inventory';
import { dropItems, itemName } from './mining';
import { depositById, depositLeft, isVeinId } from './resources';
import { ITEMS, TANKS } from './defs';
import { ELECTROLYZER_O2, GEN_BUFFER, PORT_O2, RECIPE_BY_ID, type Building } from './production';
import { stationStatus } from './stationStatus';
import { stationName } from './navigation';
import { habitableQ, habitableRoom, type Door, type RoomInfo } from './rooms';
import { HOTBAR_SIZE, type GameState } from './state';
/**
 * Scanner (S5, D37): a starting tool that is never used up (stack 1). Scanning is no longer an always-present action:
 * only with the scanner selected does the action button read what the reticle or the nearby target is — a landmark
 * (its card, marks it scanned), a deposit or vein (material and stock — the numbers the mining label no longer shows),
 * a station (its status) or a glass room (volume, air, habitable). Readouts are plain data for the scan card.
 */
export const SCANNER = 'scanner';
/** Where the one-time scanner of an older save went (worlds started before S5 have no `progress.scanner`). */
export type ScannerGrant = 'none' | 'quick' | 'backpack' | 'capsule';
/** Next to the capsule hatch, where a drop is easy to find (SPAWN_POSE faces it). */
export const SCANNER_DROP = { x: 40, z: 43.2 };
const holds = (g: GameState) => countItem(g.player.inventory, SCANNER) > 0 || Object.values(g.world.crates).some(c => countItem(c, SCANNER) > 0) || g.world.drops.some(d => d.items.some(s => s.itemId === SCANNER));
/** Grants the scanner once to a save that never had it: into a free quick slot other than the selected one (it is used
 *  from there; the selected empty slot is the bare hand for gathering, so the player is never suddenly holding it), else
 *  the backpack rows, else as a drop at the capsule. A world that already holds one (backpack, crates, drops) is only
 *  marked. Returns where it went; 'none' when nothing was given. */
export function grantScanner(g: GameState): ScannerGrant {
 if (g.progress.scanner) return 'none';
 g.progress.scanner = true;
 if (holds(g)) return 'none';
 const quick = g.player.inventory.slice(0, HOTBAR_SIZE).findIndex((s, i) => !s && i !== g.player.hotbar); if (quick >= 0) { g.player.inventory[quick] = { itemId: SCANNER, count: 1 }; return 'quick'; }
 const row = g.player.inventory.findIndex((s, i) => !s && i >= HOTBAR_SIZE); if (row >= 0) { g.player.inventory[row] = { itemId: SCANNER, count: 1 }; return 'backpack'; }
 dropItems(g, SCANNER_DROP.x, SCANNER_DROP.z, [{ itemId: SCANNER, count: 1 }]); return 'capsule';
}
export const scannerSelected = (g: GameState) => g.player.inventory[g.player.hotbar]?.itemId === SCANNER;
/** One readout: the scan card's kicker, title, a sentence and label/value rows. */
export type ScanReading = { kind: string; title: string; text: string; rows: [string, string][] };
const gu = (milli: number) => Math.floor(milli / 1000);
/** What a job makes: fluids (electrolysis oxygen, legacy melt water) are not items. */
const product = (id: string) => ITEMS[id]?.name ?? ({ water: 'Вода', oxygen: 'Кислород', hydrogen: 'Водород' } as Record<string, string>)[id] ?? id;
export function scanDeposit(g: GameState, id: string): ScanReading | null {
 const n = depositById(g, id); if (!n) return null;
 const left = depositLeft(g, id), grass = n.material === 'grass', vein = isVeinId(id), item = itemName(n.itemId);
 const rows: [string, string][] = [['Добыча', item], [grass ? 'Растений' : 'Запас', `${left} / ${n.amount}`], ['В рюкзаке', String(countItem(g.player.inventory, n.itemId))]];
 if (n.regrowSeconds) rows.push(['Отрастает', `1 растение за ${n.regrowSeconds} с`]);
 const text = left > 0 ? (grass ? `Можно собрать ещё ${left}.` : `Осталось ${left} ${left % 10 === 1 && left % 100 !== 11 ? 'блок' : left % 10 >= 2 && left % 10 <= 4 && (left % 100 < 12 || left % 100 > 14) ? 'блока' : 'блоков'} из ${n.amount}.`) : grass ? 'Всё собрано — растения отрастают в активное время.' : 'Запас исчерпан: новая жила поднимется в другом месте.';
 return { kind: (vein ? 'Жила' : 'Залежь') + ' · ' + n.name, title: item, text, rows };
}
export function scanStation(g: GameState, b: Building): ScanReading {
 const st = stationStatus(g, b), rows: [string, string][] = [['Состояние', st.title], ['Питание станции', b.enabled ? 'включена' : 'выключена']];
 if (b.kind === 'biogenerator') rows.push(['Энергия', `${gu(b.energy)} / ${GEN_BUFFER / 1000} EU`], ['Волокно', String(countItem(b.input, 'fiber'))]);
 if (b.kind === 'electrolyzer') rows.push(['Кислород', `${gu(b.oxygen)} / ${ELECTROLYZER_O2 / 1000} GU`], ['Вода', `${gu(b.water)} WU`]);
 if (b.kind === 'refill' || b.kind === 'distributor') rows.push(['Кислород', `${gu(b.oxygen)} / ${PORT_O2 / 1000} GU`]);
 const tank = b.input[1]; if (b.kind === 'electrolyzer' && tank && TANKS[tank.itemId]) rows.push(['Баллон', `${gu(tank.milliGU ?? 0)} / ${TANKS[tank.itemId].capacity / 1000} GU`]);
 const r = b.job ? RECIPE_BY_ID.get(b.job.recipeId) : undefined;
 if (b.job && r) rows.push(['Работа', `${product(Object.keys(r.outputs)[0])} · ${Math.floor(Math.min(1, b.job.workMs / (r.seconds * 1000)) * 100)} %`]);
 if (b.kind === 'workbench' && b.level === 2) rows.push(['Очередь', String(b.queue.length)]);
 return { kind: 'Станция', title: stationName(b), text: st.hint, rows };
}
/** A glass room (or a structure that does not close a room yet: `room` null); scanned at an airlock module (D36) the
 *  reading adds its chamber and both doors. */
export function scanRoom(room: RoomInfo | null, door?: Door): ScanReading {
 const doorRows: [string, string][] = door ? door.width === 2 ? [['Камера', `${gu(door.pressure)} GU`], ['Двери', `наружная ${doorWord(door.outer)}, внутренняя ${doorWord(door.inner)}`]] : [['Шлюз', 'прежней версии']] : [];
 if (!room) return { kind: door ? 'Шлюз' : 'Стеклоблок', title: 'Не замкнуто', text: 'Стены и крыша ещё не закрывают воздух: найдите щель или поставьте шлюз.', rows: doorRows };
 const ok = habitableRoom(room), z = room.zone;
 const rows: [string, string][] = [['Объём', `${room.volume} м³`], ['Воздух', `${gu(z.q)} GU · нужно ${habitableQ(room.volume) / 1000}`], ['Чистота', `${Math.round(z.purity * 100)} %`], ['Температура', `${Math.round(z.temperature)} °C`], ['Дышать', ok ? 'можно' : 'нельзя'], ...doorRows];
 return { kind: door ? 'Шлюз · помещение' : 'Помещение', title: 'Стеклянное помещение', text: ok ? 'Воздух пригоден: внутри можно дышать без баллона.' : 'Воздух непригоден: подключите распределитель кислорода и закройте щели.', rows };
}
const doorWord = (s: Door['outer']) => s === 'open' ? 'открыта' : s === 'cycling' ? 'в цикле' : 'закрыта';
