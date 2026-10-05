import { canonical, sha256 } from './canonical';
import { sanitizeState, type GameState } from '../game/state';
/** A game state is stored as a few immutable, content-addressed pages (TECHNICAL §9). */
export const PAGE_KINDS = ['meta', 'player', 'world', 'progress'] as const;
export type PageKind = typeof PAGE_KINDS[number];
export type Page = { kind: PageKind; hash: string; data: string };
export const MAX_PAGE_BYTES = 256 * 1024;
export function encodePages(state: GameState): Page[] {
 return PAGE_KINDS.map(kind => {
  const data = canonical(state[kind]);
  if (data.length * 3 > MAX_PAGE_BYTES && new TextEncoder().encode(data).length > MAX_PAGE_BYTES) throw new Error(`Страница ${kind} больше 256 КиБ`);
  return { kind, hash: sha256(data), data };
 });
}
export class CorruptSave extends Error { constructor(why: string) { super(why); this.name = 'CorruptSave'; } }
/** Verifies page hashes and rebuilds a validated state. */
export function decodePages(pages: Page[], expected?: Record<string, string>): GameState {
 const raw: Record<string, unknown> = {};
 for (const kind of PAGE_KINDS) {
  const p = pages.find(x => x.kind === kind);
  if (!p) throw new CorruptSave(`нет страницы ${kind}`);
  if (typeof p.data !== 'string' || sha256(p.data) !== p.hash) throw new CorruptSave(`страница ${kind} повреждена`);
  if (expected && expected[kind] !== p.hash) throw new CorruptSave(`страница ${kind} не совпадает с манифестом`);
  raw[kind] = JSON.parse(p.data);
 }
 return sanitizeState(raw);
}
