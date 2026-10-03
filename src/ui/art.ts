import { ITEMS, type SuitPart } from '../game/defs';
/**
 * Item art. Final sprites are not made yet: every item uses a vector placeholder in the
 * palette of the approved mock-ups. To plug in a finished asset, add its URL here
 * (e.g. `tool_stone: new URL('../assets/items/tool_stone.webp', import.meta.url).href`);
 * the UI then shows the image instead of the placeholder. IDs are the stable item IDs.
 */
export const ITEM_ART: Partial<Record<string, string>> = {};
/** Optional character render for the suit screen; the placeholder figure is used until set. */
export const FIGURE_ART: { url?: string } = {};

const P: Record<string, string> = {
 tool_stone: '<path d="M13 41 31 19" stroke="#0d1214" stroke-width="7" stroke-linecap="round"/><path d="M13 41 31 19" stroke="#46525a" stroke-width="4.4" stroke-linecap="round"/><path d="m17 36.4 2.4 2M22.5 29.8l2.4 2" stroke="#e8742a" stroke-width="5.5"/><path d="M24 10l11-3 8 7-3 9-9 1-6-5Z" fill="#b3ada2" stroke="#6f6a62" stroke-width="1.2"/><path d="M30 14l6 5" stroke="#e8742a" stroke-width="3"/>',
 bottle_1: '<rect x="14" y="12" width="20" height="30" rx="9" fill="#ecebe6" stroke="#5d6466" stroke-width="1.2"/><rect x="20" y="6" width="8" height="7" rx="2" fill="#2b3234"/><path d="M14 20h20M14 34h20" stroke="#e8742a" stroke-width="3.5"/><path d="m21 25 3 4 3-4" stroke="#e8742a" stroke-width="2" fill="none"/>',
 pulp: '<path d="M12 12h24l3 28H9Z" fill="#efefea" stroke="#9aa0a0" stroke-width="1.2"/><path d="M12 12l2-4h20l2 4" fill="#d9d9d3"/><path d="M12 18h24" stroke="#e8742a" stroke-width="3"/><path d="m19 24 5 8 5-8" stroke="#e8742a" stroke-width="2.6" fill="none"/>',
 iron_raw: '<path d="m8 30 6-14 12-5 13 6 2 14-10 9H16Z" fill="#4a4442" stroke="#2c2826" stroke-width="1.2"/><path d="m14 26 5-3m6 8 4-5m-9-9 3 2m10 3 3 4" stroke="#d9772f" stroke-width="2.6" stroke-linecap="round"/>',
 copper_raw: '<path d="m9 28 7-14 12-4 11 8 1 13-11 9H17Z" fill="#b8612e" stroke="#7a3a18" stroke-width="1.2"/><path d="m16 18 8 6 12-6M24 24l-2 15M24 24l12 7" stroke="#e89a5f" stroke-width="1.6" fill="none"/>',
 ice: '<path d="m10 30 5-16 10-6 10 7 4 14-9 10H17Z" fill="#bfe6f2" stroke="#7fb8cc" stroke-width="1.2"/><path d="m15 14 10 9 10-8M25 23v16M25 23l14 6M25 23 10 30" stroke="#f4fcff" stroke-width="1.4" fill="none"/>',
 stone: '<path d="m8 31 5-13 11-6 12 4 5 13-8 9H15Z" fill="#9b968e" stroke="#5f5b55" stroke-width="1.2"/><path d="m13 18 10 6 13-8M23 24l-3 15" stroke="#c7c2b9" stroke-width="1.3" fill="none"/>',
 suit_helmet: '<path d="M8 29a16 16 0 1 1 32 0v6a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3Z" fill="#ecebe6" stroke="#5d6466" stroke-width="1.2"/><path d="M13 27a11 9 0 0 1 22 0v4H13Z" fill="#14191b"/><path d="M15 23a8 6 0 0 1 8-4" stroke="#56707a" stroke-width="1.6" fill="none"/><path d="M8 31h4M36 31h4" stroke="#e8742a" stroke-width="3"/>',
 suit_chest: '<path d="M14 9h20l7 7-3 6-4-2v20H14V20l-4 2-3-6Z" fill="#ecebe6" stroke="#5d6466" stroke-width="1.2"/><path d="M19 9l5 6 5-6" stroke="#2b3234" stroke-width="2.4" fill="none"/><path d="m20 20 4 6 4-6Z" fill="#e8742a"/><path d="M14 33h20" stroke="#2b3234" stroke-width="2.6"/>',
 suit_legs: '<path d="M14 8h20l2 31h-8l-4-22-4 22h-8Z" fill="#ecebe6" stroke="#5d6466" stroke-width="1.2"/><path d="M14 12h20" stroke="#2b3234" stroke-width="3"/><path d="M14 26h6M28 26h6" stroke="#e8742a" stroke-width="3.2"/>',
 suit_boots: '<path d="M10 14h9v16l5 4v6H8Z" fill="#ecebe6" stroke="#5d6466" stroke-width="1.2"/><path d="M27 14h9v16l5 4v6H25Z" fill="#ecebe6" stroke="#5d6466" stroke-width="1.2"/><path d="M8 37h16M25 37h16" stroke="#2b3234" stroke-width="3"/><path d="M10 20h9M27 20h9" stroke="#e8742a" stroke-width="2.6"/>',
};
const PART_ITEM: Record<SuitPart, string> = { helmet: 'suit_helmet', chest: 'suit_chest', legs: 'suit_legs', boots: 'suit_boots' };
/** An element showing the item: the registered sprite or the placeholder vector. */
export function itemArt(id: string, cls = 'art'): HTMLElement {
 const box = document.createElement('span'); box.className = cls; box.dataset.item = id;
 const url = ITEM_ART[id];
 if (url) { const img = document.createElement('img'); img.src = url; img.alt = ''; img.draggable = false; box.append(img); }
 else box.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true">${P[id] ?? '<circle cx="24" cy="24" r="12" fill="#3a5a5c"/>'}</svg>`;
 box.title = ITEMS[id]?.name ?? id;
 return box;
}
/** Empty-slot outline of a suit part or tank. */
export function ghostArt(kind: SuitPart | 'tank', cls = 'art ghost'): HTMLElement {
 const box = document.createElement('span'); box.className = cls;
 box.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="3 2">${(P[kind === 'tank' ? 'bottle_1' : PART_ITEM[kind]] ?? '').replace(/fill="[^"]*"/g, 'fill="none"').replace(/stroke="#[^"]*"/g, '')}</g></svg>`;
 return box;
}
/** Placeholder full-body figure; parts that are not worn are drawn as dashed outlines. */
export function figureArt(worn: Record<SuitPart, boolean>, selected?: SuitPart): string {
 if (FIGURE_ART.url) return `<img src="${FIGURE_ART.url}" alt="">`;
 const c = (p: SuitPart) => `class="fig-part${worn[p] ? '' : ' off'}${selected === p ? ' sel' : ''}"`;
 return `<svg viewBox="0 0 120 220" aria-hidden="true">
  <ellipse cx="60" cy="210" rx="44" ry="7" class="fig-base"/>
  <g ${c('legs')}><path d="M42 112h36l3 58H66l-6-40-6 40H39Z"/><path d="M41 140h12M67 140h12" class="fig-accent"/></g>
  <g ${c('boots')}><path d="M38 170h16v26H32v-8Z"/><path d="M66 170h16l6 18v8H66Z"/><path d="M34 192h20M66 192h22" class="fig-dark"/></g>
  <g ${c('chest')}><path d="M40 48h40l14 10 6 42-9 3-6-30v39H35V73l-6 30-9-3 6-42Z"/><path d="m54 58 6 9 6-9Z" class="fig-accent"/><path d="M36 106h48" class="fig-dark"/></g>
  <g ${c('helmet')}><circle cx="60" cy="30" r="19"/><path d="M47 29a13 10 0 0 1 26 0v5H47Z" class="fig-visor"/></g>
 </svg>`;
}
