import catalog from './catalog.generated.json';
/**
 * Item definitions used by the playable stages. Names, stack sizes and IDs are copied
 * from docs/data/catalog.json; tests check they stay identical.
 * Stable IDs are save keys; localised names never are.
 * contentVersion 1.1.0: the single `suit` item was replaced by four independent parts
 * (helmet, chest, legs, boots). Saves of 1.0.0 are migrated in state.ts.
 */
export const CONTENT_VERSION = '1.1.0';
/** Older content versions that sanitizeState() can migrate. */
export const LEGACY_CONTENT_VERSIONS = ['1.0.0'] as const;
export const GENERATOR_VERSION = 1;
export const SUIT_PARTS = ['helmet', 'chest', 'legs', 'boots'] as const;
export type SuitPart = typeof SUIT_PARTS[number];
export const SUIT_PART_LABEL: Record<SuitPart, string> = { helmet: 'Шлем', chest: 'Нагрудник', legs: 'Поножи', boots: 'Ботинки' };
export type Category = 'tool' | 'tank' | 'suit' | 'food' | 'resource' | 'building';
export const CATEGORY_LABEL: Record<Category, string> = { tool: 'Инструмент', tank: 'Баллон', suit: 'Часть костюма', food: 'Пища', resource: 'Ресурс', building: 'Постройка' };
export type ItemDef = { id: string; name: string; short: string; stack: number; kind: 'item' | 'equipment' | 'placeable'; category: Category; description: string; part?: SuitPart; tier?: string };
const def = (d: ItemDef) => d;
export const ITEMS: Record<string, ItemDef> = {
 tool_stone: def({ id: 'tool_stone', name: 'Каменный мультитул', short: 'Мультитул', stack: 1, kind: 'equipment', category: 'tool', description: 'Для добычи камня, руды и льда.' }),
 bottle_1: def({ id: 'bottle_1', name: 'Баллон I', short: 'Баллон', stack: 1, kind: 'equipment', category: 'tank', description: 'Баллон кислорода на 240 GU. Работает, когда установлен в слот баллона.' }),
 suit_helmet: def({ id: 'suit_helmet', name: 'Базовый шлем', short: 'Шлем', stack: 1, kind: 'equipment', category: 'suit', part: 'helmet', tier: 'Базовый', description: 'Закрытый шлем с герметичным визором.' }),
 suit_chest: def({ id: 'suit_chest', name: 'Базовый нагрудник', short: 'Нагрудник', stack: 1, kind: 'equipment', category: 'suit', part: 'chest', tier: 'Базовый', description: 'Герметичный корпус костюма с разъёмами для двух баллонов.' }),
 suit_legs: def({ id: 'suit_legs', name: 'Базовые поножи', short: 'Поножи', stack: 1, kind: 'equipment', category: 'suit', part: 'legs', tier: 'Базовый', description: 'Герметичные поножи с усиленными коленями.' }),
 suit_boots: def({ id: 'suit_boots', name: 'Базовые ботинки', short: 'Ботинки', stack: 1, kind: 'equipment', category: 'suit', part: 'boots', tier: 'Базовый', description: 'Герметичные ботинки с рифлёной подошвой.' }),
 pulp: def({ id: 'pulp', name: 'Пищевая масса', short: 'Пища', stack: 64, kind: 'item', category: 'food', description: 'Простая пища из растительной массы. +8 сытости и +1 HP; перерыв между порциями 5 с.' }),
 iron_raw: def({ id: 'iron_raw', name: 'Железная руда', short: 'Железо', stack: 64, kind: 'item', category: 'resource', description: 'Сырьё для плавки железа.' }),
 copper_raw: def({ id: 'copper_raw', name: 'Медная руда', short: 'Медь', stack: 64, kind: 'item', category: 'resource', description: 'Сырьё для плавки меди.' }),
 ice: def({ id: 'ice', name: 'Кусок льда', short: 'Лёд', stack: 64, kind: 'item', category: 'resource', description: 'В электролизёре: 2 с × 6 EU/с → 1 WU воды.' }),
 stone: def({ id: 'stone', name: 'Камень', short: 'Камень', stack: 64, kind: 'item', category: 'resource', description: 'Строительное сырьё.' }),
};
/** Early production items use the canonical design catalog directly. */
export const BUILDABLE = ['workbench', 'kiln', 'biogenerator', 'electrolyzer', 'refill', 'distributor', 'dome'] as const;
export type BuildingKind = typeof BUILDABLE[number];
for (const id of ['grass', 'fiber', 'sand', 'iron', 'copper', 'glass', 'wire', 'circuit', ...BUILDABLE, 'cable', 'gas_pipe']) {
 const d = catalog.items[id as keyof typeof catalog.items];
 ITEMS[id] = def({ id, name: d.name, short: d.name, stack: d.stack, kind: d.kind as ItemDef['kind'], category: d.kind === 'placeable' ? 'building' : 'resource', description: d.kind === 'placeable' ? 'Размещение и соединение — в панели строительства. Новый корпус не содержит топлива, воды или кислорода.' : 'Материал для ранних рецептов производства.' });
}
/** Basic suit set worn at start (SYSTEMS §1). */
export const BASIC_SUIT: Record<SuitPart, string> = { helmet: 'suit_helmet', chest: 'suit_chest', legs: 'suit_legs', boots: 'suit_boots' };
/** Mining tools (SYSTEMS §3): tier, time multiplier, durability in blocks. */
export const TOOLS: Record<string, { tier: number; timeMul: number; durability: number }> = {
 tool_stone: { tier: 0, timeMul: 1, durability: 160 },
};
/** Gas tanks: capacity in milli-GU. */
export const TANKS: Record<string, { capacity: number }> = { bottle_1: { capacity: 240000 } };
/** Base block time in seconds and the tier needed (SYSTEMS §3). */
export const MATERIALS = {
 grass: { seconds: 1, tier: 0, label: 'Трава' },
 sand: { seconds: 1.5, tier: 0, label: 'Песок' },
 ice: { seconds: 1.5, tier: 0, label: 'Лёд' },
 stone: { seconds: 3, tier: 0, label: 'Камень' },
 iron: { seconds: 4, tier: 0, label: 'Железо' },
 copper: { seconds: 4, tier: 0, label: 'Медь' },
} as const;
export type Material = keyof typeof MATERIALS;
