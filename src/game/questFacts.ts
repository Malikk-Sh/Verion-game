import catalog from './catalog.generated.json';
import { ITEMS } from './defs';
import type { GameState } from './state';
import type { QuestId } from './questCatalog';

/** Bounded, sticky evidence; no counters grow with playtime. */
export type QuestProgress = { facts: string[]; completed: QuestId[]; tracked: QuestId | null };
export const freshQuestProgress = (): QuestProgress => ({ facts: [], completed: [], tracked: null });
export const QUEST_FACTS = new Set([
 ...Object.keys(ITEMS).map(id => 'item:'+id),
 ...catalog.recipes.map(r => 'craft:'+r.id),
 'system:power','system:auto','system:refill','system:base',
]);
/** Called by simulation only after a successful action or actual transfer. */
export function recordQuestFact(g: GameState, fact: string): boolean {
 if (!QUEST_FACTS.has(fact)) throw new Error('Unknown quest fact: '+fact);
 const facts=g.progress.quests.facts;
 if(facts.includes(fact))return false;
 facts.push(fact);return true;
}
