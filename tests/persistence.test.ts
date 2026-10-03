import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { SaveStore, SaveError, LEASE_EXPIRY_MS } from '../src/persist/store.ts';
import { Saver } from '../src/persist/saver.ts';
import { buildExport, exportText, parseImport, ImportError } from '../src/persist/file.ts';
import { newGame, cloneState, type GameState } from '../src/game/state.ts';
import { mineTick, type Mining } from '../src/game/mining.ts';

const mine = (s: GameState, node: string, ticks: number) => { const m: Mining = { nodeId: null, ticks: 0 }; for (let i = 0; i < ticks; i++) mineTick(s, m, node, true); return s; };
const played = (id = 'w-a') => { const s = newGame(id, 99, 1, .5); mine(s, 'iron-a', 80 * 5); mine(s, 'ice-a', 30 * 3); s.player.x = 61.25; s.meta.activeTicks = 4321; s.progress.visited.push('iron'); s.world.drops.push({ id: 'drop-1', x: 60, z: 60, items: [{ itemId: 'stone', count: 3 }] }); s.world.nextDropId = 2; return s; };
let clock = 1_000_000;
const open = (f: IDBFactory) => SaveStore.open(f, 'vireon', () => clock);

test('V17: export → import into a new slot preserves state and the next production result', async () => {
 const f = new IDBFactory(), store = await open(f), s = played();
 await store.createSlot(s, 'tok');
 const text = exportText(buildExport(s, 1, 5));
 const { state } = parseImport(text);
 assert.deepEqual(state, s);
 const imported = cloneState(state); imported.meta.worldId = 'w-import'; imported.meta.name = 'Копия';
 await store.createSlot(imported, 'tok2');
 const loaded = (await store.load('w-import')).state;
 assert.deepEqual({ ...loaded, meta: { ...loaded.meta, worldId: 'w-a', name: s.meta.name } }, s);
 assert.equal((await store.load('w-a')).state.meta.worldId, 'w-a', 'original slot untouched');
 // Same next result: mine one more block on both.
 const a = mine(cloneState(s), 'iron-a', 80), b = mine(cloneState(loaded), 'iron-a', 80);
 assert.deepEqual(a.player.inventory, b.player.inventory); assert.deepEqual(a.world.nodes, b.world.nodes);
 // Damaged or future files are rejected without side effects.
 assert.throws(() => parseImport(text.replace('\\"count\\":3', '\\"count\\":4')), ImportError);
 assert.throws(() => parseImport(text.replace('"formatVersion":1', '"formatVersion":2')), /более новой/);
 assert.throws(() => parseImport('{"magic":"NOPE"}'), /не файл/);
 assert.throws(() => parseImport('x', 65 * 1024 * 1024), /64/);
 assert.equal((await store.listSlots()).length, 2);
});
test('V18: a crash at every write phase leaves the old or the new complete revision', async () => {
 const phases = ['encode', 'page', 'manifest', 'gc'] as const;
 for (const phase of phases) for (let nth = 1; nth <= (phase === 'page' ? 4 : 1); nth++) {
  const f = new IDBFactory(), store = await open(f), s0 = played('w-crash');
  await store.createSlot(s0, 'tok');
  const s1 = mine(cloneState(s0), 'copper-a', 80); s1.meta.activeTicks += 600;
  let count = 0; store.faults = p => { if (p === phase && ++count === nth) throw new Error('killed at ' + p); };
  let committed = false;
  try { await store.commit('w-crash', 'tok', 1, s1); committed = true; } catch (e) { assert.match(String(e), /killed/); }
  store.close();
  const reopened = await open(f), r = await reopened.load('w-crash');
  if (phase === 'gc') { assert.equal(committed, true, 'gc failure does not undo a commit'); assert.deepEqual(r.state, s1); assert.equal(r.revision, 2); }
  else { assert.equal(committed, false); assert.deepEqual(r.state, s0, `${phase}#${nth} must leave revision 1`); assert.equal(r.revision, 1); }
  // The store keeps working after the crash.
  const next = await reopened.commit('w-crash', 'tok', r.revision, s1); assert.equal(next, r.revision + 1);
 }
});
test('V18: keeps three revisions, garbage-collects the rest, recovers from a damaged active revision', async () => {
 const f = new IDBFactory(), store = await open(f); let s = played('w-gc'); await store.createSlot(s, 't');
 for (let i = 0; i < 5; i++) { s = mine(cloneState(s), 'stone-a', 60); s.meta.activeTicks += 600; await store.commit('w-gc', 't', i + 1, s); }
 const slot = await store.getSlot('w-gc'); assert.deepEqual(slot!.revisions, [6, 5, 4]);
 // Damage only the active revision's world page: the previous revision is offered, never an empty world.
 const db: IDBDatabase = await new Promise(ok => { const r = f.open('vireon', 1); r.onsuccess = () => ok(r.result); });
 const active = await new Promise<any>(ok => { const g = db.transaction('revisionManifests').objectStore('revisionManifests').get('w-gc#6'); g.onsuccess = () => ok(g.result); });
 await new Promise<void>(ok => { const t = db.transaction('statePages', 'readwrite'), st = t.objectStore('statePages'), key = 'w-gc:world:' + active.pages.world; st.get(key).onsuccess = (e: any) => { const v = e.target.result; v.data = v.data.replace('"stone-a":', '"stone-a":1,"x":'); st.put(v); }; t.oncomplete = () => ok(); });
 const r = await store.load('w-gc'); assert.equal(r.revision, 5); assert.equal(r.recoveredFrom, 6); assert.match(r.error!, /повреждена/);
 // Damage every kept revision: an explicit error, not a silent fresh world.
 await new Promise<void>(ok => { const t = db.transaction('statePages', 'readwrite'), st = t.objectStore('statePages'); st.openCursor().onsuccess = (e: any) => { const c = e.target.result; if (!c) return; if (c.value.kind === 'world') { c.value.data += ' '; c.update(c.value); } c.continue(); }; t.oncomplete = () => ok(); });
 db.close();
 await assert.rejects(store.load('w-gc'), (e: any) => e instanceof SaveError && e.code === 'corrupt');
});
test('V19: quota failure is honest: no data lost, writes halted, export still possible', async () => {
 const f = new IDBFactory(), store = await open(f), s0 = played('w-q'); await store.createSlot(s0, 'tok');
 store.faults = p => { if (p === 'page') throw new DOMException('full', 'QuotaExceededError'); };
 const statuses: string[] = []; let current = mine(cloneState(s0), 'iron-a', 80);
 const saver = new Saver(store, 'w-q', 'tok', 1, 0, () => cloneState(current), st => statuses.push(st.kind + ':' + (st.code ?? '')));
 await saver.save();
 assert.equal(saver.status.kind, 'error'); assert.equal(saver.status.code, 'quota'); assert.equal(saver.halted, true); assert.match(saver.status.message!, /экспорт/);
 assert.deepEqual((await store.load('w-q')).state, s0, 'previous revision intact');
 assert.equal((await store.listSlots()).length, 1, 'nothing deleted to make room');
 assert.deepEqual(parseImport(exportText(buildExport(current, 1, 0))).state, current, 'export of the unsaved state works');
 store.faults = undefined; await saver.retry(); assert.equal(saver.status.kind, 'saved'); assert.equal(saver.revision, 2);
});
test('V20: two tabs — only the lease holder writes; a revoked tab cannot overwrite the new commit', async () => {
 const f = new IDBFactory(), a = await open(f), b = await open(f), s = played('w-tabs');
 await a.createSlot(s, 'A');
 assert.deepEqual(await b.acquireLease('w-tabs', 'B'), { ok: false, heldFor: 0 }, 'second tab sees the live lease');
 assert.deepEqual(await b.acquireLease('w-tabs', 'B', true), { ok: true }, 'explicit take-over');
 assert.equal(await a.heartbeat('w-tabs', 'A'), false, 'old tab learns it lost the lease');
 const sb = mine(cloneState(s), 'copper-b', 80); assert.equal(await b.commit('w-tabs', 'B', 1, sb), 2);
 await assert.rejects(a.commit('w-tabs', 'A', 1, mine(cloneState(s), 'iron-b', 80)), (e: any) => e.code === 'lease');
 await assert.rejects(a.commit('w-tabs', 'A', 2, s), (e: any) => e.code === 'lease', 'even with the right base revision');
 assert.deepEqual((await b.load('w-tabs')).state, sb);
 // Stale base revision is rejected for the holder too.
 await assert.rejects(b.commit('w-tabs', 'B', 1, s), (e: any) => e.code === 'conflict');
 // An expired lease (closed tab) can be taken without force.
 clock += LEASE_EXPIRY_MS + 1; assert.deepEqual(await a.acquireLease('w-tabs', 'A2'), { ok: true });
 const saver = new Saver(b, 'w-tabs', 'B', 2, 0, () => sb); await saver.save(); assert.equal(saver.status.kind, 'lease-lost'); assert.equal(saver.halted, true);
});

test('V20: a released lease (pagehide → back/forward cache) is re-taken by the same tab', async () => {
 const f = new IDBFactory(), a = await open(f), b = await open(f), s = played('w-bf');
 await a.createSlot(s, 'A'); await a.releaseLease('w-bf', 'A');
 assert.equal(await a.heartbeat('w-bf', 'A'), true, 'heartbeat re-takes a free lease');
 assert.deepEqual(await b.acquireLease('w-bf', 'B'), { ok: false, heldFor: 0 }, 'and other tabs see it as held again');
 await a.releaseLease('w-bf', 'A'); assert.equal(await a.commit('w-bf', 'A', 1, s), 2, 'commit on a free lease takes it');
 assert.deepEqual(await b.acquireLease('w-bf', 'B', true), { ok: true });
 assert.equal(await a.heartbeat('w-bf', 'A'), false, 'a lease held by another token is never re-taken');
});
