import { canonical, sha256 } from './canonical';
import { decodePages, encodePages, PAGE_KINDS, type Page } from './pages';
import { CONTENT_VERSION, GENERATOR_VERSION, LEGACY_CONTENT_VERSIONS } from '../game/defs';
import type { GameState } from '../game/state';
/** `.vireon.json` export/import envelope (TECHNICAL §9). The hash detects damage; it is not anti-cheat. */
export const MAGIC = 'VIREON';
export const FORMAT_VERSION = 1;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export type ExportManifest = { worldId: string; name: string; revision: number; snapshotTick: number; pages: Record<string, string> };
export type Envelope = { magic: string; formatVersion: number; contentVersion: string; generatorVersion: number; exportedAt: number; manifest: ExportManifest; pages: Page[]; sha256: string };
export class ImportError extends Error { constructor(message: string) { super(message); this.name = 'ImportError'; } }
const body = (manifest: ExportManifest, pages: Page[]) => canonical({ manifest, pages });
export function buildExport(state: GameState, revision: number, exportedAt: number): Envelope {
 const pages = encodePages(state);
 const manifest: ExportManifest = { worldId: state.meta.worldId, name: state.meta.name, revision, snapshotTick: state.meta.activeTicks, pages: Object.fromEntries(pages.map(p => [p.kind, p.hash])) };
 return { magic: MAGIC, formatVersion: FORMAT_VERSION, contentVersion: CONTENT_VERSION, generatorVersion: GENERATOR_VERSION, exportedAt, manifest, pages, sha256: sha256(body(manifest, pages)) };
}
export const exportText = (e: Envelope) => JSON.stringify(e);
export const exportFileName = (state: GameState, at: Date) => `vireon-${state.meta.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() || 'world'}-${at.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.vireon.json`;
/** Validates a file and returns the contained state. Never writes anything. */
export function parseImport(text: string, byteLength = text.length): { state: GameState; envelope: Envelope } {
 if (byteLength > MAX_FILE_BYTES) throw new ImportError('Файл больше 64 МиБ');
 let raw: unknown;
 try { raw = JSON.parse(text); } catch { throw new ImportError('Это не JSON-файл сохранения Vireon'); }
 const e = raw as Envelope;
 if (!e || typeof e !== 'object' || e.magic !== MAGIC) throw new ImportError('Это не файл сохранения Vireon');
 if (typeof e.formatVersion !== 'number' || e.formatVersion > FORMAT_VERSION) throw new ImportError('Файл создан более новой версией игры; обновите игру. Файл не изменён');
 if (e.formatVersion !== FORMAT_VERSION) throw new ImportError('Неподдерживаемая версия формата');
 // Files of an older content version are accepted and migrated by sanitizeState (e.g. 1.0.0 → 1.1.0).
 if ((e.contentVersion !== CONTENT_VERSION && !(LEGACY_CONTENT_VERSIONS as readonly string[]).includes(e.contentVersion)) || e.generatorVersion !== GENERATOR_VERSION) throw new ImportError('Неподдерживаемая версия контента или генератора');
 if (!Array.isArray(e.pages) || e.pages.length !== PAGE_KINDS.length || !e.manifest || typeof e.manifest !== 'object') throw new ImportError('Повреждена структура файла');
 const pages: Page[] = e.pages.map(p => ({ kind: p?.kind, hash: p?.hash, data: p?.data }) as Page);
 const manifest: ExportManifest = { worldId: String(e.manifest.worldId), name: String(e.manifest.name), revision: Number(e.manifest.revision), snapshotTick: Number(e.manifest.snapshotTick), pages: { ...e.manifest.pages } };
 if (typeof e.sha256 !== 'string' || sha256(body(manifest, pages)) !== e.sha256) throw new ImportError('Контрольная сумма не совпадает: файл повреждён или изменён');
 if (new Set(pages.map(p => p.kind)).size !== PAGE_KINDS.length) throw new ImportError('Повторяющиеся страницы');
 try { return { state: decodePages(pages, manifest.pages), envelope: e }; }
 catch (err) { throw new ImportError('Данные не прошли проверку: ' + (err instanceof Error ? err.message : String(err))); }
}
