/**
 * Item definitions used by the first playable stage. Names, stack sizes and IDs are copied
 * from docs/data/catalog.json (contentVersion 1.0.0); tests check they stay identical.
 * Stable IDs are save keys; localised names never are.
 */
export const CONTENT_VERSION = '1.0.0';
export const GENERATOR_VERSION = 1;
export type ItemDef = { id: string; name: string; stack: number; kind: 'item' | 'equipment' };
export const ITEMS: Record<string, ItemDef> = {
 tool_stone: { id: 'tool_stone', name: 'Каменный мультитул', stack: 1, kind: 'equipment' },
 bottle_1: { id: 'bottle_1', name: 'Баллон I', stack: 1, kind: 'equipment' },
 pulp: { id: 'pulp', name: 'Пищевая масса', stack: 64, kind: 'item' },
 iron_raw: { id: 'iron_raw', name: 'Железная руда', stack: 64, kind: 'item' },
 copper_raw: { id: 'copper_raw', name: 'Медная руда', stack: 64, kind: 'item' },
 ice: { id: 'ice', name: 'Кусок льда', stack: 64, kind: 'item' },
 stone: { id: 'stone', name: 'Камень', stack: 64, kind: 'item' },
};
/** Mining tools (SYSTEMS §3): tier, time multiplier, durability in blocks. */
export const TOOLS: Record<string, { tier: number; timeMul: number; durability: number }> = {
 tool_stone: { tier: 0, timeMul: 1, durability: 160 },
};
/** Base block time in seconds and the tier needed (SYSTEMS §3). */
export const MATERIALS = {
 ice: { seconds: 1.5, tier: 0, label: 'Лёд' },
 stone: { seconds: 3, tier: 0, label: 'Камень' },
 iron: { seconds: 4, tier: 0, label: 'Железо' },
 copper: { seconds: 4, tier: 0, label: 'Медь' },
} as const;
export type Material = keyof typeof MATERIALS;
