import { ITEMS, type SuitPart } from '../game/defs';
import tool from '../assets/items/tool_stone.webp';
import tank from '../assets/items/bottle_1.webp';
import food from '../assets/items/pulp.webp';
import iron from '../assets/items/iron_raw.webp';
import copper from '../assets/items/copper_raw.webp';
import ice from '../assets/items/ice.webp';
import stone from '../assets/items/stone.webp';
import helmet from '../assets/items/suit_helmet.webp';
import chest from '../assets/items/suit_chest.webp';
import legs from '../assets/items/suit_legs.webp';
import boots from '../assets/items/suit_boots.webp';
import figureBoots from '../assets/figure/suit_boots.webp';
/**
 * Shared local raster sprites: one asset for hotbar, inventory, equipment and inspection.
 * Static imports give Vite hashed URLs and the portable build embedded data URLs.
 * Stable item IDs and save data are independent of the visual assets.
 */
export const ITEM_ART: Partial<Record<string, string>> = {
 tool_stone: tool, bottle_1: tank, pulp: food, iron_raw: iron, copper_raw: copper,
 ice, stone, suit_helmet: helmet, suit_chest: chest, suit_legs: legs, suit_boots: boots,
};
/** Boots use a stance-specific sprite; removed parts become faint placement guides. */
export const FIGURE_ART: { parts: Record<SuitPart, string> } = { parts: { helmet, chest, legs, boots: figureBoots } };

const P: Record<string, string> = {
 wrench: '<path d="M16 43 32 23c-9-2-9-12-3-17l1 9 7 3 7-7c3 8-2 16-10 15L22 46Z" fill="#a9c3ce" stroke="#394d58" stroke-width="2"/><circle cx="20" cy="40" r="2" fill="#20313b"/>',
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
// Native vector fallbacks for the newly playable production items.
P.grass='<path d="M24 41 10 9l12 20 4-23 3 23L40 13 27 41Z" fill="#a5b867" stroke="#617b45"/><path d="M24 41V22" stroke="#dbe5a4"/>';
P.fiber='<path d="m10 39 8-29 9-3 10 6-10 30Z" fill="#cbbb8a"/><path d="m16 35 8-21m-2 25 7-23m-1 20 5-15" stroke="#f1dfab" stroke-width="2"/>';
P.sand='<path d="m6 37 12-13 10-7 14 20Z" fill="#d3bb82"/><path d="m18 24 4 13m6-20 5 20" stroke="#e9d49f" stroke-width="2"/>';
for(const [id,color] of [['iron','#bac1bd'],['copper','#d39159'],['glass','#9bd4d8']] as const)P[id]=`<path d="m8 32 5-16 25-3 3 15-9 10H14Z" fill="${color}" stroke="#567174"/><path d="m13 16 8 15 20-3M21 31l-7 7" fill="none" stroke="#e4eeea"/>`;
P.wire='<path d="M10 31C4 9 38 3 39 23c2 16-28 24-27 6 0-15 23-17 23-6 0 7-14 13-14 5" fill="none" stroke="#d89b66" stroke-width="3"/>';
P.circuit='<path d="M8 9h32v31H8Z" fill="#356b59" stroke="#83a89a"/><path d="M17 17h14v14H17ZM11 13h8m14 0h5M11 35h8m11 0h8" fill="none" stroke="#dec886" stroke-width="2"/>';
P.workbench='<path d="M6 15h36v7H6Z" fill="#d5d8ce"/><path d="M11 22v19m26-19v19m-26-8h26" stroke="#6f8988" stroke-width="5"/>';
P.kiln='<path d="M10 10h28v31H10Z" fill="#a2aca2"/><path d="M16 20h16v15H16Z" fill="#203a3d"/><path d="m19 32 5-9 5 9" fill="#e97632"/>';
for(const [id,color] of [['biogenerator','#e97632'],['electrolyzer','#55aebb'],['refill','#80cfd3'],['distributor','#a6c67b']] as const)P[id]=`<path d="M10 12h28v28H10Z" fill="#d5d8ce" stroke="#617778"/><path d="M15 19h18v13H15Z" fill="#203a3d"/><path d="M16 36h16" stroke="${color}" stroke-width="4"/><circle cx="24" cy="25" r="4" fill="${color}"/>`;
P.dome='<path d="M7 38V22L15 9h18l8 13v16Z" fill="#609fa4" stroke="#d5d8ce" stroke-width="2"/><path d="M15 9v29m18-29v29M7 22h34M20 38V27h8v11" fill="none" stroke="#c9ddd4" stroke-width="2"/>';
P.cable='<path d="M8 12c30-11 30 12 16 12-22 0-21 19 16 12" fill="none" stroke="#e97632" stroke-width="4"/>';
P.gas_pipe='<path d="M10 8v16h28v17" fill="none" stroke="#55aebb" stroke-width="6"/><path d="M6 12h8m20 24h8M18 20v8" stroke="#d5d8ce" stroke-width="3"/>';
const PART_ITEM: Record<SuitPart, string> = { helmet: 'suit_helmet', chest: 'suit_chest', legs: 'suit_legs', boots: 'suit_boots' };
/** Registered item sprite; unknown future items retain a vector fallback. */
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
/** Four independent raster layers preserve selection and all combinations of worn parts. */
export function figureArt(worn: Record<SuitPart, boolean>, selected?: SuitPart): string {
 return `<div class="raster-figure" aria-hidden="true"><div class="figure-canvas"><i class="figure-platform"></i>${(['legs', 'boots', 'chest', 'helmet'] as SuitPart[]).map(p =>
  `<span class="fig-part fig-${p}${worn[p] ? '' : ' off'}${selected === p ? ' sel' : ''}" data-figure-part="${p}" data-worn="${worn[p]}">${p === 'boots'
   ? `<span class="fig-boot fig-boot-left"><img src="${figureBoots}" alt="" draggable="false"></span><span class="fig-boot fig-boot-right"><img src="${figureBoots}" alt="" draggable="false"></span>`
   : `<img src="${FIGURE_ART.parts[p]}" alt="" draggable="false">`}</span>`
 ).join('')}</div></div>`;
}
