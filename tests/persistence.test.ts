import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { SaveStore, SaveError, LEASE_EXPIRY_MS } from '../src/persist/store.ts';
import { Saver } from '../src/persist/saver.ts';
import { buildExport, exportText, parseImport, ImportError } from '../src/persist/file.ts';
import { importSlot } from '../src/persist/import.ts';
import { openSavedSlot } from '../src/persist/open.ts';
import { newGame, cloneState, type GameState } from '../src/game/state.ts';
import { dropItems, mineTick, pickUp, type Mining } from '../src/game/mining.ts';

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
 const slot = await importSlot(store, text, 'w-import');
 assert.equal(slot.name, s.meta.name + ' · импорт');
 assert.equal(slot.lease, null, 'import does not invent a writer for a closed world');
 const r = await openSavedSlot(store, 'w-import', 'tok2', false, async () => {});
 assert.ok(r, 'the imported world opens immediately without forcing the lease');
 const loaded = r.state;
 assert.deepEqual({ ...loaded, meta: { ...loaded.meta, worldId: 'w-a', name: s.meta.name } }, s);
 assert.equal((await store.load('w-a')).state.meta.worldId, 'w-a', 'original slot untouched');
 // Same next result: mine one more block on both.
 const a = mine(cloneState(s), 'iron-a', 80), b = mine(cloneState(loaded), 'iron-a', 80);
 assert.deepEqual(a.player.inventory, b.player.inventory); assert.deepEqual(a.world.nodes, b.world.nodes);
 const saver = new Saver(store, 'w-import', 'tok2', r.revision, loaded.meta.activeTicks, () => cloneState(b), () => {}, r.baseRevision);
 await saver.save();
 assert.equal(saver.status.kind, 'saved'); assert.equal(saver.revision, 2);
 assert.deepEqual((await store.load('w-import')).state, b, 'an imported world remains writable');
 assert.deepEqual(parseImport(exportText(buildExport(b, 2, 6))).state, b, 'its final name survives another export/import');
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
 assert.equal(r.baseRevision, 6, 'the damaged head is still the expected base; reading does not mutate it');
 let recovered = mine(cloneState(r.state), 'ice-a', 30); recovered.meta.activeTicks += 600;
 const saver = new Saver(store, 'w-gc', 't', r.revision, r.state.meta.activeTicks, () => cloneState(recovered), () => {}, r.baseRevision);
 await saver.save();
 assert.equal(saver.halted, false); assert.equal(saver.status.kind, 'saved'); assert.equal(saver.revision, 7);
 assert.deepEqual((await store.load('w-gc')).state, recovered, 'recovered progress is saved as a new revision');
 await assert.rejects(store.readRevision('w-gc', 6), /повреждена/, 'the damaged revision is not overwritten');
 recovered = mine(cloneState(recovered), 'ice-a', 30); recovered.meta.activeTicks += 600;
 await saver.save(); assert.equal(saver.revision, 8, 'subsequent saves advance the expected base too');
 await assert.rejects(store.commit('w-gc', 't', r.baseRevision, r.state), (e: any) => e.code === 'conflict', 'a stale recovery cannot overwrite a newer commit');
 // Damage every kept revision: an explicit error, not a silent fresh world.
 await new Promise<void>(ok => { const t = db.transaction('statePages', 'readwrite'), st = t.objectStore('statePages'); st.openCursor().onsuccess = (e: any) => { const c = e.target.result; if (!c) return; if (c.value.kind === 'world') { c.value.data += ' '; c.update(c.value); } c.continue(); }; t.oncomplete = () => ok(); });
 db.close();
 await assert.rejects(store.load('w-gc'), (e: any) => e instanceof SaveError && e.code === 'corrupt');
});

test('V17: repeated imports and 48-character names remain valid; rejected imports leave no slot', async () => {
 const store = await open(new IDBFactory());
 const original = played(); original.meta.name = 'А'.repeat(48);
 await store.createSlot(original, 'A');
 await importSlot(store, exportText(buildExport(original, 1, 0)), 'w-long');
 const long = await store.load('w-long'); assert.equal(long.state.meta.name.length, 48);
 const normal = played('w-normal');
 await importSlot(store, exportText(buildExport(normal, 1, 0)), 'w-first');
 const first = await store.load('w-first');
 await importSlot(store, exportText(buildExport(first.state, first.revision, 0)), 'w-second');
 assert.equal((await store.load('w-second')).state.meta.name, normal.meta.name + ' · импорт · импорт');
 const before = await store.listSlots();
 await assert.rejects(importSlot(store, 'not-json', 'w-rejected'), ImportError);
 await assert.rejects(importSlot(store, exportText(buildExport(normal, 1, 0)), 'invalid/id'), /worldId/);
 assert.deepEqual(await store.listSlots(), before, 'validation completes before any new slot is written');
 assert.deepEqual((await store.load(original.meta.worldId)).state, original, 'source world remains untouched');
 store.close();
});

test('V18: reproducing the damaged page after recovery writes readable progress', async () => {
 const f = new IDBFactory(), store = await open(f), initial = played('w-repeat');
 await store.createSlot(initial, 'A');
 const next = mine(cloneState(initial), 'copper-a', 80); next.meta.activeTicks += 600;
 await store.commit('w-repeat', 'A', 1, next);
 const db: IDBDatabase = await new Promise(ok => { const r = f.open('vireon', 1); r.onsuccess = () => ok(r.result); });
 const manifest = await new Promise<any>(ok => { const r = db.transaction('revisionManifests').objectStore('revisionManifests').get('w-repeat#2'); r.onsuccess = () => ok(r.result); });
 await new Promise<void>((ok, fail) => {
  const t = db.transaction('statePages', 'readwrite'), pages = t.objectStore('statePages');
  const request = pages.get('w-repeat:world:' + manifest.pages.world);
  request.onsuccess = () => { const p = request.result; p.data += ' '; pages.put(p); };
  t.oncomplete = () => ok(); t.onabort = () => fail(t.error);
 });
 db.close();
 const loaded = await store.load('w-repeat'); assert.equal(loaded.revision, 1); assert.equal(loaded.baseRevision, 2);
 const repeated = mine(cloneState(loaded.state), 'copper-a', 80); repeated.meta.activeTicks += 600;
 assert.deepEqual(repeated, next, 'repeating the action produces the same content hash as the damaged page');
 const saver = new Saver(store, 'w-repeat', 'A', loaded.revision, loaded.state.meta.activeTicks, () => repeated, () => {}, loaded.baseRevision);
 await saver.save(); assert.equal(saver.status.kind, 'saved');
 const reopened = await store.load('w-repeat'); assert.equal(reopened.revision, 3); assert.deepEqual(reopened.state, repeated);
 store.close();
});

for (const failure of ['busy', 'missing', 'corrupt'] as const) test(`V20: ${failure} target leaves the current world attached and writable`, async () => {
 const f = new IDBFactory(), store = await open(f), original = played('w-current');
 await store.createSlot(original, 'A');
 if (failure !== 'missing') await store.createSlot(played('w-target'), failure === 'busy' ? 'B' : null);
 if (failure === 'corrupt') {
  const db: IDBDatabase = await new Promise(ok => { const r = f.open('vireon', 1); r.onsuccess = () => ok(r.result); });
  await new Promise<void>((ok, fail) => {
   const t = db.transaction('statePages', 'readwrite'), pages = t.objectStore('statePages');
   pages.index('slotId').openCursor('w-target').onsuccess = (e: any) => { const c = e.target.result; if (!c) return; c.value.data += ' '; c.update(c.value); c.continue(); };
   t.oncomplete = () => ok(); t.onabort = () => fail(t.error);
  });
  db.close();
 }
 let current = cloneState(original), saver: Saver | null = new Saver(store, 'w-current', 'A', 1, original.meta.activeTicks, () => cloneState(current));
 const attached = saver; let detached = false;
 const leave = async () => { detached = true; await saver!.save(); saver!.stopHeartbeat(); await store.releaseLease('w-current', 'A'); saver = null; };
 if (failure === 'busy') assert.equal(await openSavedSlot(store, 'w-target', 'A', false, leave), null);
 else await assert.rejects(openSavedSlot(store, 'w-target', 'A', false, leave), (e: any) => e.code === failure);
 assert.equal(detached, false); assert.equal(saver, attached, 'Back → resume keeps the same autosaver');
 assert.equal((await store.getSlot('w-current'))!.lease!.token, 'A');
 if (failure === 'corrupt') assert.equal((await store.getSlot('w-target'))!.lease, null, 'failed loading releases only the target');
 if (failure === 'busy') assert.equal((await store.getSlot('w-target'))!.lease!.token, 'B', 'cancellation does not steal the target');
 current = mine(cloneState(current), 'copper-a', 80); current.meta.activeTicks += 600;
 await saver!.save(); assert.equal(saver!.status.kind, 'saved');
 assert.deepEqual((await store.load('w-current')).state, current, 'progress after returning to the original world is durable');
 store.close();
});

test('V20: a successful switch loads the target before closing the current writer', async () => {
 const store = await open(new IDBFactory()), original = played('w-current'), target = played('w-target');
 await store.createSlot(original, 'A'); await store.createSlot(target, null);
 const next = mine(cloneState(original), 'copper-a', 80);
 const saver = new Saver(store, 'w-current', 'A', 1, original.meta.activeTicks, () => next);
 let detached = false;
 const loaded = await openSavedSlot(store, 'w-target', 'A', false, async () => {
  assert.equal((await store.getSlot('w-target'))!.lease!.token, 'A');
  assert.deepEqual((await store.load('w-target')).state, target);
  await saver.save(); saver.stopHeartbeat(); await store.releaseLease('w-current', 'A'); detached = true;
 });
 assert.ok(loaded); assert.equal(detached, true); assert.deepEqual(loaded.state, target);
 assert.equal((await store.getSlot('w-current'))!.lease, null);
 assert.deepEqual((await store.load('w-current')).state, next, 'final current-world progress is saved before switching');
 store.close();
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

test('V20: a silent background tab keeps its fresh lease until explicit take-over', async () => {
 const f = new IDBFactory(); let now = 1000;
 const a = await SaveStore.open(f, 'silent-tab', () => now), b = await SaveStore.open(f, 'silent-tab', () => now);
 const original = played('w-silent'); await a.createSlot(original, 'A');
 let leftCurrent = false;
 for (const elapsed of [401, 5000, LEASE_EXPIRY_MS - 1]) {
  now = 1000 + elapsed;
  const loaded = await openSavedSlot(b, 'w-silent', 'B', false, async () => { leftCurrent = true; });
  assert.equal(loaded, null, 'silence must not revoke an unexpired lease');
  assert.equal((await a.getSlot('w-silent'))!.lease!.token, 'A');
 }
 assert.equal(leftCurrent, false, 'the other current world remains attached while confirmation is pending');
 const loaded = await openSavedSlot(b, 'w-silent', 'B', true, async () => { leftCurrent = true; });
 assert.ok(loaded); assert.equal(leftCurrent, true);
 const updated = mine(cloneState(loaded.state), 'copper-b', 80);
 assert.equal(await b.commit('w-silent', 'B', loaded.baseRevision, updated), 2);
 await assert.rejects(a.commit('w-silent', 'A', 1, original), (e: any) => e.code === 'lease');
 assert.deepEqual((await b.load('w-silent')).state, updated);
 a.close(); b.close();
});

test('V20: an expired lease opens without force or a BroadcastChannel probe', async () => {
 const f = new IDBFactory(); let now = 1000;
 const a = await SaveStore.open(f, 'expired-tab', () => now), b = await SaveStore.open(f, 'expired-tab', () => now);
 await a.createSlot(played('w-expired'), 'A'); now += LEASE_EXPIRY_MS;
 let leftCurrent = false;
 const loaded = await openSavedSlot(b, 'w-expired', 'B', false, async () => { leftCurrent = true; });
 assert.ok(loaded); assert.equal(leftCurrent, true);
 assert.equal((await b.getSlot('w-expired'))!.lease!.token, 'B');
 a.close(); b.close();
});

test('V17: correctly hashed imports reject inherited item names in every item container', async () => {
 const store = await open(new IDBFactory()), original = played('w-valid');
 await store.createSlot(original, 'A');
 for (const itemId of ['constructor', '__proto__']) for (const container of ['inventory', 'bottles', 'drops']) {
  const bad = cloneState(original), item = { itemId, count: 1, durability: 0, milliGU: 0 };
  if (container === 'inventory') bad.player.inventory[2] = item;
  else if (container === 'bottles') bad.player.bottles[1] = item;
  else bad.world.drops[0].items.push(item);
  const text = exportText(buildExport(bad, 1, 0));
  await assert.rejects(importSlot(store, text, 'w-invalid'), /неизвестный предмет/);
  assert.equal((await store.listSlots()).length, 1, 'invalid imports must not create a slot');
 }
 assert.deepEqual((await store.load('w-valid')).state, original);
 store.close();
});

test('V17: a colliding drop counter is rejected before an imported slot is created', async () => {
 const store = await open(new IDBFactory()), original = played('w-valid');
 await store.createSlot(original, 'A');
 for (const [id, nextDropId] of [['drop-1', 1], ['drop-20', 19], ['drop-9007199254740992', Number.MAX_SAFE_INTEGER]] as const) {
  const bad = cloneState(original); bad.world.drops[0].id = id; bad.world.nextDropId = nextDropId;
  await assert.rejects(importSlot(store, exportText(buildExport(bad, 1, 0)), 'w-invalid'), /world.nextDropId/);
  assert.equal((await store.listSlots()).length, 1);
 }
 assert.deepEqual((await store.load('w-valid')).state, original);
 store.close();
});

test('V17: imported drop IDs remain unique and both separate piles can be picked up', async () => {
 const store = await open(new IDBFactory()), original = played('w-valid');
 await importSlot(store, exportText(buildExport(original, 1, 0)), 'w-import');
 const imported = (await store.load('w-import')).state;
 dropItems(imported, 100, 100, [{ itemId: 'stone', count: 2 }]);
 assert.deepEqual(imported.world.drops.map(d => d.id), ['drop-1', 'drop-2']);
 assert.equal(imported.world.nextDropId, 3);
 const next = parseImport(exportText(buildExport(imported, 1, 0))).state;
 assert.equal(pickUp(next, 'drop-2'), 2); assert.equal(pickUp(next, 'drop-1'), 3);
 assert.equal(next.world.drops.length, 0);
 store.close();
});
