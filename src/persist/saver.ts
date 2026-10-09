import { SaveError, SaveStore, LEASE_HEARTBEAT_MS } from './store';
import type { GameState } from '../game/state';
/**
 * Autosave policy (TECHNICAL §9): every 30 active seconds plus on events and manual requests.
 * Requests coalesce; only one commit is in flight. A lost lease or a failed write stops
 * further writes and is reported honestly — it never deletes anything to make room.
 */
export const AUTOSAVE_TICKS = 600;
export type SaverStatus = { kind: 'idle' | 'saving' | 'saved' | 'error' | 'lease-lost'; revision: number; savedAt?: number; message?: string; code?: string };
export class Saver {
 private inflight: Promise<void> | null = null;
 private pending = false;
 private lastTicks: number;
 private timer: ReturnType<typeof setInterval> | null = null;
 halted = false;
 status: SaverStatus;
 constructor(private store: SaveStore, readonly slotId: string, readonly token: string, public revision: number, activeTicks: number, private snapshot: () => GameState, private onStatus: (s: SaverStatus) => void = () => {}, private baseRevision = revision, private measure?: (name:string,ms:number)=>void) {
  this.lastTicks = activeTicks; this.status = { kind: 'saved', revision };
 }
 startHeartbeat() {
  this.stopHeartbeat();
  this.timer = setInterval(() => { void this.store.heartbeat(this.slotId, this.token).then(ok => { if (!ok) this.leaseLost(); }).catch(() => { /* transient; the commit re-checks the token */ }); }, LEASE_HEARTBEAT_MS);
 }
 stopHeartbeat() { if (this.timer) clearInterval(this.timer); this.timer = null; }
 private set(s: SaverStatus) { this.status = s; this.onStatus(s); }
 private leaseLost() { if (this.halted && this.status.kind === 'lease-lost') return; this.halted = true; this.stopHeartbeat(); this.set({ kind: 'lease-lost', revision: this.revision, message: 'Мир открыт в другой вкладке. Изменения здесь остановлены' }); }
 /** Call every frame with the accepted active time. */
 tick(activeTicks: number) { if (!this.halted && activeTicks - this.lastTicks >= AUTOSAVE_TICKS) void this.save(); }
 /** Saves a snapshot taken now (between simulation ticks). Resolves when that snapshot is durable or failed. */
 save(): Promise<void> {
  if (this.halted) return Promise.resolve();
  if (this.inflight) { this.pending = true; return this.inflight.then(() => this.pending ? (this.pending = false, this.save()) : undefined); }
  const at=performance.now(),state = this.snapshot();this.measure?.('save:snapshot',performance.now()-at);
  this.lastTicks = state.meta.activeTicks;
  this.set({ kind: 'saving', revision: this.revision });
  this.inflight = this.store.commit(this.slotId, this.token, this.baseRevision, state).then(rev => {
   this.baseRevision = this.revision = rev; this.set({ kind: 'saved', revision: rev, savedAt: Date.now() });
  }, (e: unknown) => {
   const err = e instanceof SaveError ? e : new SaveError('unknown', String(e));
   if (err.code === 'lease') { this.leaseLost(); return; }
   this.halted = err.code === 'quota' || err.code === 'conflict';
   this.set({ kind: 'error', revision: this.revision, code: err.code, message: err.code === 'quota' ? 'Не удалось сохранить: мало места. Изменения приостановлены — сделайте экспорт' : 'Не удалось сохранить: ' + err.message });
  }).finally(() => { this.measure?.('save:commit-wall',performance.now()-at);this.inflight = null; });
  return this.inflight;
 }
 /** Retry after the player freed space; clears the halt for non-lease errors. */
 retry() { if (this.status.kind === 'lease-lost') return Promise.resolve(); this.halted = false; return this.save(); }
}
