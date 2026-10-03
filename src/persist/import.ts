import { parseImport } from './file';
import { sanitizeState } from '../game/state';
import type { SaveStore } from './store';

/** Validates a copy with its final ID/name, then creates an unleased slot atomically. */
export async function importSlot(store: SaveStore, text: string, worldId: string, byteLength?: number) {
 const { state } = parseImport(text, byteLength);
 state.meta.worldId = worldId;
 state.meta.name = (state.meta.name + ' · импорт').slice(0, 48);
 return store.createSlot(sanitizeState(state), null);
}
