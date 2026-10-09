import { encodePages, decodePages, PAGE_KINDS, CorruptSave, type Page, type PageKind } from './pages';
import type { GameState } from '../game/state';
/**
 * IndexedDB persistence (TECHNICAL §9). Immutable content-addressed pages are written first;
 * one readwrite transaction then checks the lease token and base revision, writes the complete
 * manifest and switches `worldSlots.activeRevision`. A crash before that switch leaves the
 * previous revision active; the latest three revisions are kept.
 */
export const DB_NAME = 'vireon';
export const SCHEMA_VERSION = 1;
export const KEEP_REVISIONS = 3;
export const LEASE_HEARTBEAT_MS = 5000;
export const LEASE_EXPIRY_MS = 15000;
export type Lease = { token: string; heartbeatAt: number };
export type SlotRecord = { id: string; name: string; createdAt: number; updatedAt: number; activeTicks: number; activeRevision: number; revisions: number[]; lease: Lease | null };
export type Manifest = { key: string; slotId: string; revision: number; baseRevision: number; snapshotTick: number; savedAt: number; formatVersion: 1; pages: Record<PageKind, string> };
/** `revision` identifies the loaded snapshot; `baseRevision` is the head the next commit must check. */
export type LoadedSlot = { state: GameState; revision: number; baseRevision: number; savedAt: number; recoveredFrom?: number; error?: string };
type StoredPage = Page & { key: string; slotId: string };
export type SaveErrorCode = 'quota' | 'lease' | 'conflict' | 'unavailable' | 'corrupt' | 'missing' | 'unknown';
export class SaveError extends Error { constructor(public code: SaveErrorCode, message: string) { super(message); this.name = 'SaveError'; } }
/** Test hook: throw from here to simulate the process dying at that phase. */
export type FaultHook = (phase: 'encode' | 'page' | 'manifest' | 'gc') => void;
const req = <T>(r: IDBRequest<T>) => new Promise<T>((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
const done = (t: IDBTransaction) => new Promise<void>((ok, fail) => { t.oncomplete = () => ok(); t.onabort = () => fail(t.error ?? new DOMException('Transaction aborted', 'AbortError')); t.onerror = () => fail(t.error); });
const isQuota = (e: unknown) => e instanceof DOMException ? e.name === 'QuotaExceededError' || (e as DOMException).code === 22 : (e as { name?: string })?.name === 'QuotaExceededError';
function wrap(e: unknown): SaveError {
 if (e instanceof SaveError) return e;
 if (isQuota(e)) return new SaveError('quota', 'Недостаточно места в хранилище браузера');
 return new SaveError('unknown', e instanceof Error ? e.message : String(e));
}
const manifestKey = (slotId: string, revision: number) => `${slotId}#${revision}`;
const pageKey = (slotId: string, p: Page) => `${slotId}:${p.kind}:${p.hash}`;
export class SaveStore {
 faults?: FaultHook;
 measure?: (name:string,ms:number)=>void;
 private constructor(private db: IDBDatabase, private now: () => number) {}
 static async open(factory: IDBFactory | undefined = globalThis.indexedDB, name = DB_NAME, now: () => number = Date.now): Promise<SaveStore> {
  if (!factory) throw new SaveError('unavailable', 'IndexedDB недоступна в этом браузере');
  const open = factory.open(name, SCHEMA_VERSION);
  open.onupgradeneeded = () => {
   const db = open.result;
   if (!db.objectStoreNames.contains('worldSlots')) db.createObjectStore('worldSlots', { keyPath: 'id' });
   if (!db.objectStoreNames.contains('revisionManifests')) db.createObjectStore('revisionManifests', { keyPath: 'key' }).createIndex('slotId', 'slotId');
   if (!db.objectStoreNames.contains('statePages')) db.createObjectStore('statePages', { keyPath: 'key' }).createIndex('slotId', 'slotId');
   // Reserved by the schema for later stages (dig-zone chunks, definitions, settings copy).
   for (const s of ['chunkPages', 'definitionsVersions', 'settingsBackup']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'key' });
  };
  try { return new SaveStore(await req(open), now); } catch (e) { throw new SaveError('unavailable', 'Не удалось открыть хранилище: ' + (e instanceof Error ? e.message : String(e))); }
 }
 close() { this.db.close(); }
 private tx(stores: string[], mode: IDBTransactionMode) { return mode === 'readwrite' ? this.db.transaction(stores, mode, { durability: 'strict' }) : this.db.transaction(stores, mode); }
 async listSlots(): Promise<SlotRecord[]> { const t = this.tx(['worldSlots'], 'readonly'); const all = await req(t.objectStore('worldSlots').getAll()) as SlotRecord[]; return all.sort((a, b) => b.updatedAt - a.updatedAt); }
 async getSlot(id: string): Promise<SlotRecord | undefined> { return await req(this.tx(['worldSlots'], 'readonly').objectStore('worldSlots').get(id)) as SlotRecord | undefined; }

 // ---------- Single-writer lease ----------
 /** Takes the writable lease. Fails if another live token holds it, unless `force`. */
 async acquireLease(slotId: string, token: string, force = false): Promise<{ ok: true } | { ok: false; heldFor: number }> {
  const t = this.tx(['worldSlots'], 'readwrite'), s = t.objectStore('worldSlots');
  const slot = await req(s.get(slotId)) as SlotRecord | undefined;
  if (!slot) { t.abort(); throw new SaveError('missing', 'Мир не найден'); }
  const now = this.now(), l = slot.lease;
  if (l && l.token !== token && now - l.heartbeatAt < LEASE_EXPIRY_MS && !force) { await done(t); return { ok: false, heldFor: now - l.heartbeatAt }; }
  slot.lease = { token, heartbeatAt: now }; s.put(slot); await done(t); return { ok: true };
 }
 /** Refreshes our lease; false means another tab took it and this instance must stop writing. */
 async heartbeat(slotId: string, token: string): Promise<boolean> {
  const t = this.tx(['worldSlots'], 'readwrite'), s = t.objectStore('worldSlots');
  const slot = await req(s.get(slotId)) as SlotRecord | undefined;
  // A released lease (pagehide → bfcache restore) is re-taken; another tab's token means we lost it.
  if (!slot || (slot.lease && slot.lease.token !== token)) { await done(t); return false; }
  slot.lease = { token, heartbeatAt: this.now() }; s.put(slot); await done(t); return true;
 }
 async releaseLease(slotId: string, token: string) {
  const t = this.tx(['worldSlots'], 'readwrite'), s = t.objectStore('worldSlots');
  const slot = await req(s.get(slotId)) as SlotRecord | undefined;
  if (slot?.lease?.token === token) { slot.lease = null; s.put(slot); }
  await done(t);
 }

 // ---------- Writing ----------
 /** Creates revision 1; `null` leaves an imported slot free until somebody opens it. The id must be new. */
 async createSlot(state: GameState, token: string | null): Promise<SlotRecord> {
  const id = state.meta.worldId;
  if (await this.getSlot(id)) throw new SaveError('conflict', 'Мир с таким идентификатором уже существует');
  const pages = this.encode(state);
  await this.writePages(id, pages);
  const t = this.tx(['worldSlots', 'revisionManifests'], 'readwrite');
  const now = this.now(), slot: SlotRecord = { id, name: state.meta.name, createdAt: now, updatedAt: now, activeTicks: state.meta.activeTicks, activeRevision: 1, revisions: [1], lease: token === null ? null : { token, heartbeatAt: now } };
  try {
   if (await req(t.objectStore('worldSlots').get(id))) { t.abort(); throw new SaveError('conflict', 'Мир с таким идентификатором уже существует'); }
   t.objectStore('revisionManifests').put(this.manifest(id, 1, 0, state, pages));
   t.objectStore('worldSlots').put(slot); await done(t);
  } catch (e) { throw wrap(e); }
  return slot;
 }
 /** Atomic revision commit. Returns the new revision number. */
 async commit(slotId: string, token: string, baseRevision: number, state: GameState): Promise<number> {
  const pages = this.encode(state);
  await this.writePages(slotId, pages);
  this.faults?.('manifest');
  const t = this.tx(['worldSlots', 'revisionManifests'], 'readwrite'), slots = t.objectStore('worldSlots');
  let revision = 0;
  try {
   const slot = await req(slots.get(slotId)) as SlotRecord | undefined;
   if (!slot) { t.abort(); throw new SaveError('missing', 'Мир не найден'); }
   if (slot.lease && slot.lease.token !== token) { t.abort(); throw new SaveError('lease', 'Мир открыт в другой вкладке'); }
   if (slot.activeRevision !== baseRevision) { t.abort(); throw new SaveError('conflict', `Ревизия изменилась: ожидалась ${baseRevision}, сейчас ${slot.activeRevision}`); }
   revision = baseRevision + 1;
   t.objectStore('revisionManifests').put(this.manifest(slotId, revision, baseRevision, state, pages));
   slot.activeRevision = revision; slot.revisions = [revision, ...slot.revisions].slice(0, KEEP_REVISIONS);
   slot.updatedAt = this.now(); slot.activeTicks = state.meta.activeTicks; slot.name = state.meta.name; slot.lease = { token, heartbeatAt: slot.updatedAt };
   slots.put(slot); await done(t);
  } catch (e) { throw wrap(e); }
  await this.gc(slotId).catch(() => { /* Unreachable pages are retried on the next commit. */ });
  return revision;
 }
 private encode(state: GameState) { this.faults?.('encode');const at=performance.now(),pages=encodePages(state);this.measure?.('save:encode',performance.now()-at);return pages; }
 private manifest(slotId: string, revision: number, baseRevision: number, state: GameState, pages: Page[]): Manifest {
  return { key: manifestKey(slotId, revision), slotId, revision, baseRevision, snapshotTick: state.meta.activeTicks, savedAt: this.now(), formatVersion: 1, pages: Object.fromEntries(pages.map(p => [p.kind, p.hash])) as Record<PageKind, string> };
 }
 /** Short transactions; pages are inert until a manifest references them. */
 private async writePages(slotId: string, pages: Page[]) {
  for (const p of pages) {
   try {
    this.faults?.('page');
    const t = this.tx(['statePages'], 'readwrite'), s = t.objectStore('statePages'), key = pageKey(slotId, p);
    const existing = await req(s.get(key)) as StoredPage | undefined;
    // A key alone is insufficient after corruption. Reuse only the exact encoded content;
    // a new valid snapshot can restore bytes that belong to this hash without losing state.
    if (!existing || existing.data !== p.data || existing.hash !== p.hash || existing.kind !== p.kind) s.put({ ...p, key, slotId } satisfies StoredPage);
    await done(t);
   } catch (e) { throw wrap(e); }
  }
 }
 /** Deletes manifests outside the kept revisions and pages no kept manifest references. */
 private async gc(slotId: string) {
  this.faults?.('gc');
  const t = this.tx(['worldSlots', 'revisionManifests', 'statePages'], 'readwrite');
  const slot = await req(t.objectStore('worldSlots').get(slotId)) as SlotRecord | undefined;
  if (!slot) { await done(t); return; }
  const keep = new Set(slot.revisions), live = new Set<string>();
  const manifests = await req(t.objectStore('revisionManifests').index('slotId').getAll(slotId)) as Manifest[];
  for (const m of manifests) { if (keep.has(m.revision)) for (const k of PAGE_KINDS) live.add(`${slotId}:${k}:${m.pages[k]}`); else t.objectStore('revisionManifests').delete(m.key); }
  const keys = await req(t.objectStore('statePages').index('slotId').getAllKeys(slotId)) as string[];
  for (const k of keys) if (!live.has(k)) t.objectStore('statePages').delete(k);
  await done(t);
 }
 /** Deletes a whole slot. Only on an explicit player choice. */
 async deleteSlot(slotId: string) {
  const t = this.tx(['worldSlots', 'revisionManifests', 'statePages'], 'readwrite');
  for (const store of ['revisionManifests', 'statePages']) for (const k of await req(t.objectStore(store).index('slotId').getAllKeys(slotId))) t.objectStore(store).delete(k);
  t.objectStore('worldSlots').delete(slotId); await done(t);
 }

 // ---------- Reading ----------
 async readRevision(slotId: string, revision: number): Promise<{ state: GameState; manifest: Manifest; pages: Page[] }> {
  const t = this.tx(['revisionManifests', 'statePages'], 'readonly');
  const manifest = await req(t.objectStore('revisionManifests').get(manifestKey(slotId, revision))) as Manifest | undefined;
  if (!manifest) throw new CorruptSave(`нет манифеста ревизии ${revision}`);
  const pages: Page[] = [];
  for (const kind of PAGE_KINDS) { const p = await req(t.objectStore('statePages').get(`${slotId}:${kind}:${manifest.pages[kind]}`)) as StoredPage | undefined; if (p) pages.push({ kind: p.kind, hash: p.hash, data: p.data }); }
  return { state: decodePages(pages, manifest.pages), manifest, pages };
 }
 /** Loads the active revision; if it is damaged, falls back to an older kept one and says so. */
 async load(slotId: string): Promise<LoadedSlot> {
  const slot = await this.getSlot(slotId);
  if (!slot) throw new SaveError('missing', 'Мир не найден');
  let firstError = '';
  for (const rev of slot.revisions) {
   try { const r = await this.readRevision(slotId, rev); return { state: r.state, revision: rev, baseRevision: slot.activeRevision, savedAt: r.manifest.savedAt, ...(rev !== slot.activeRevision ? { recoveredFrom: slot.activeRevision, error: firstError } : {}) }; }
   catch (e) { firstError ||= e instanceof Error ? e.message : String(e); }
  }
  throw new SaveError('corrupt', 'Все сохранённые ревизии повреждены: ' + firstError);
 }
}
