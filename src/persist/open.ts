import type { SaveStore, LoadedSlot } from './store';

/** A failed/cancelled open must leave the current world's writer and lease intact. */
export async function openSavedSlot(store: SaveStore, id: string, token: string, force: boolean, leaveCurrent: () => Promise<void>): Promise<LoadedSlot | null> {
 // A missing BroadcastChannel response cannot prove that a background tab is dead.
 // Only a free/expired lease or the player's explicit take-over permits a new writer.
 const lease = await store.acquireLease(id, token, force);
 if (!lease.ok) return null;
 try {
  const loaded = await store.load(id);
  // The target is readable and writable before we detach the previous session.
  await leaveCurrent();
  return loaded;
 } catch (e) {
  await store.releaseLease(id, token).catch(() => {});
  throw e;
 }
}
