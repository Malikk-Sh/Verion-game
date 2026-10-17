import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rayCells, SpatialHash, chunkFaces, chunkOf, joinChunks, CHUNK, TRIM } from '../src/glass.ts';
import { cellKey, cellOf, cellY, levelAt } from '../src/game/rooms.ts';
import { Character } from '../src/controller.ts';
import { box, heightAt, FIXED_DT } from '../src/world.ts';

const key = (i: number, k: number, j: number) => cellKey(i, k, j);
const set = (cells: [number, number, number][]) => new Set(cells.map(c => key(...c)));
const solidIn = (s: Set<number>) => (i: number, k: number, j: number) => s.has(key(i, k, j));

test('S4 glass: the DDA ray finds the first solid cell, the entered face and respects the reach', () => {
 const s = set([[3, 0, 0], [5, 0, 0]]);
 const hit = rayCells({ x: .5, y: .5, z: .5 }, { x: 1, y: 0, z: 0 }, 6, solidIn(s))!;
 assert.deepEqual([hit.i, hit.k, hit.j, hit.normal], [3, 0, 0, [-1, 0, 0]]);
 assert.ok(Math.abs(hit.distance - 2.5) < 1e-9);
 assert.equal(rayCells({ x: .5, y: .5, z: .5 }, { x: 1, y: 0, z: 0 }, 2, solidIn(s)), null, 'beyond the reach');
 // The start cell never counts (the camera inside a block still aims past it); any direction length works.
 assert.equal(rayCells({ x: 3.5, y: .5, z: .5 }, { x: 4, y: 0, z: 0 }, 6, solidIn(s))!.i, 5);
 const down = rayCells({ x: .2, y: 5.7, z: .9 }, { x: 0, y: -2, z: 0 }, 10, solidIn(set([[0, 1, 0]])))!;
 assert.deepEqual([down.k, down.normal], [1, [0, 1, 0]]);
 assert.equal(rayCells({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 5, () => true), null);
});

test('S4 glass: the DDA agrees with a fine ray-march on random rays and blocks', () => {
 let seed = 12345; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
 for (let n = 0; n < 60; n++) {
  const cells: [number, number, number][] = []; for (let c = 0; c < 40; c++) cells.push([Math.floor(rnd() * 8) - 4, Math.floor(rnd() * 8) - 4, Math.floor(rnd() * 8) - 4]);
  const s = set(cells), o = { x: rnd() * 2 - 1, y: rnd() * 2 - 1, z: rnd() * 2 - 1 }, d = { x: rnd() * 2 - 1, y: rnd() * 2 - 1, z: rnd() * 2 - 1 }, l = Math.hypot(d.x, d.y, d.z);
  const start = key(Math.floor(o.x), levelAt(o.y), Math.floor(o.z));
  let march: number | null = null;
  for (let t = 0; t <= 6; t += .0005) { const k = key(Math.floor(o.x + d.x / l * t), levelAt(o.y + d.y / l * t), Math.floor(o.z + d.z / l * t)); if (k !== start && s.has(k)) { march = k; break; } }
  const hit = rayCells(o, d, 6, solidIn(s)), got = hit ? key(hit.i, hit.k, hit.j) : null;
  if (march !== got) {
   // Only a grazing pass through an edge or corner may differ, and then the hit lies within a hair of the march.
   assert.ok(hit && march !== null, `ray ${n}: ${got} vs ${march}`);
   const a = cellOf(got!), b = cellOf(march!); assert.ok(Math.abs(a.i - b.i) + Math.abs(a.k - b.k) + Math.abs(a.j - b.j) <= 2, `ray ${n}`);
  }
  if (hit) { const p = [o.x + d.x / l * hit.distance, o.y + d.y / l * hit.distance, o.z + d.z / l * hit.distance], c = cellOf(got!); [c.i, cellY(c.k), c.j].forEach((v, a) => assert.ok(p[a] >= v - 1e-6 && p[a] <= v + 1 + 1e-6, 'the hit point lies on the struck cell')); }
 }
});

test('S4 glass: the spatial hash returns exactly the boxes under a rectangle, once each, and forgets removed ones', () => {
 const h = new SpatialHash(4), all = [];
 for (let i = -20; i < 20; i += 1) for (let j = -20; j < 20; j += 3) { const b = { id: `g${i},${j}`, minX: i, maxX: i + 1, minY: 0, maxY: 1, minZ: j, maxZ: j + 1 }; all.push(b); h.insert(b); }
 const wide = { id: 'wide', minX: -3.5, maxX: 6.5, minY: 0, maxY: 2, minZ: -1, maxZ: 1 }; all.push(wide); h.insert(wide);
 assert.equal(h.count, all.length);
 for (const [x0, z0, x1, z1] of [[-.4, -.4, .4, .4], [5.1, 7, 9.7, 12.2], [-30, -30, 30, 30], [1, 1, 1, 1]]) {
  const got = h.query(x0, z0, x1, z1, []);
  assert.equal(new Set(got).size, got.length, 'no duplicates');
  // Everything that overlaps is there; nothing far outside the touched 4 m buckets is.
  for (const b of all) if (b.maxX > x0 && b.minX < x1 && b.maxZ > z0 && b.minZ < z1) assert.ok(got.includes(b), b.id);
  for (const b of got) assert.ok(b.maxX > Math.floor(x0 / 4) * 4 && b.minX < (Math.floor(x1 / 4) + 1) * 4 && b.maxZ > Math.floor(z0 / 4) * 4 && b.minZ < (Math.floor(z1 / 4) + 1) * 4);
  if (x1 - x0 < 1) assert.ok(got.length < 20, 'a small query reads a handful of blocks, not all of them');
 }
 h.remove(wide); h.remove(all[0]); assert.equal(h.count, all.length - 2);
 assert.ok(!h.query(-30, -30, 30, 30, []).includes(wide));
 h.clear(); assert.equal(h.query(-30, -30, 30, 30, []).length, 0);
});

/** Every quad's triangles wind counter-clockwise around its stored outward normal. */
function checkWinding(f: ReturnType<typeof chunkFaces>) {
 for (let t = 0; t < f.index.length; t += 3) {
  const v = [0, 1, 2].map(n => Array.from(f.position.subarray(f.index[t + n] * 3, f.index[t + n] * 3 + 3))), n = Array.from(f.normal.subarray(f.index[t] * 3, f.index[t] * 3 + 3));
  const e1 = v[1].map((x, a) => x - v[0][a]), e2 = v[2].map((x, a) => x - v[0][a]), c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  assert.ok(c[0] * n[0] + c[1] * n[1] + c[2] * n[2] > 0, `triangle ${t / 3} winds against its normal`);
 }
}
test('S4 glass: chunk faces are only those between glass and air, outward and wound for the normal', () => {
 const one = set([[0, 0, 0]]), f1 = chunkFaces(one, k => one.has(k));
 assert.equal(f1.faces, 6); assert.equal(f1.index.length, 36); checkWinding(f1);
 // Each face sits on the cube's surface with its normal pointing away from the centre.
 for (let q = 0; q < 6; q++) { let c = [0, 0, 0]; for (let v = 0; v < 4; v++) c = c.map((x, a) => x + f1.position[(q * 4 + v) * 3 + a] / 4); const n = f1.normal.subarray(q * 12, q * 12 + 3); assert.ok(c.every((x, a) => Math.abs(x - (a === 1 ? cellY(0) : 0) - .5 - n[a] * .5) < 1e-9)); }
 const two = set([[0, 0, 0], [1, 0, 0]]); assert.equal(chunkFaces(two, k => two.has(k)).faces, 10);
 const cube: [number, number, number][] = []; for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) cube.push([i, k, j]);
 const solid = set(cube), f3 = chunkFaces(solid, k => solid.has(k)); assert.equal(f3.faces, 54); checkWinding(f3);
 // A door beside a block closes that face too (no glass drawn against the airlock frame).
 const door = key(1, 0, 0); assert.equal(chunkFaces(one, k => one.has(k) || k === door).faces, 5);
});

test('S4 glass: blocks resting on ground get skirts down to lower terrain only, wound outwards', () => {
 const one = set([[4, 2, 4]]), closed = (k: number) => one.has(k), ground = (_i: number, k: number) => k <= 1;
 const low = chunkFaces(one, closed, { ground, height: () => 1.6 }); assert.equal(low.skirts, 4); checkWinding(low);
 // The strip reaches just below the terrain and up to the block's bottom.
 const ys = Array.from(low.position).filter((_, n) => n % 3 === 1); assert.ok(Math.min(...ys) < 1.6 && Math.min(...ys) > 1.5); assert.equal(Math.max(...ys), cellY(3), 'the top of the block (level 2)');
 assert.ok(Array.from(low.trim).slice(-16).every(t => t === 1) && Array.from(low.trim).slice(0, 24).every(t => t === 0), 'panes are clear glass, the skirt is dark metal');
 assert.equal(chunkFaces(one, closed, { ground, height: () => 2.55 }).skirts, 0, 'terrain above the block bottom (y 2.5): nothing to hide');
 assert.equal(chunkFaces(one, closed, { ground: () => false, height: () => 0 }).skirts, 0, 'a floating block has no skirt');
 // Slope: only the corners below the block pull the strip down; a neighbouring block hides the shared side.
 const pair = set([[4, 2, 4], [5, 2, 4]]), slope = chunkFaces(pair, k => pair.has(k), { ground, height: (x: number) => x < 5 ? 2.2 : 2.9 });
 assert.equal(slope.skirts, 3); checkWinding(slope);
});

test('S4 glass: chunk ids group 16 m cubes and separate neighbours across a border', () => {
 assert.equal(chunkOf(key(0, 0, 0)), chunkOf(key(CHUNK - 1, CHUNK - 1, CHUNK - 1)));
 assert.notEqual(chunkOf(key(-1, 0, 0)), chunkOf(key(0, 0, 0)));
 assert.notEqual(chunkOf(key(0, -1, 0)), chunkOf(key(0, 0, 0)));
 assert.notEqual(chunkOf(key(0, 0, CHUNK)), chunkOf(key(0, 0, 0)));
});

test('S4 glass: the controller collides with blocks from the hash around it, not only static boxes', () => {
 const h = new SpatialHash(4), x = 60, z = 60, y = heightAt(x, z);
 // A wall of glass 2 m in front (along +z), plus a far block the step must never read.
 for (let i = -3; i <= 3; i++) for (let k = 0; k < 3; k++) h.insert(box(`w${i}${k}`, x + i + .5, Math.floor(y) + k + .5 - 1, z + 2.5, 1, 1, 1));
 for (let i = 0; i < 200; i++) h.insert(box(`far${i}`, x + 20 + i % 20, y + .5, z + 20 + Math.floor(i / 20), 1, 1, 1));
 let reads = 0; const p = new Character([], (a, b, c, d, out) => { reads = Math.max(reads, h.query(a, b, c, d, out).length); return out; });
 p.x = x; p.z = z; p.y = y; p.yaw = 0;
 for (let i = 0; i < 60; i++) p.step(FIXED_DT, { forward: 1, right: 0, run: false, jump: false });
 assert.ok(p.z < z + 2 - .29 && p.z > z + 1.5, `stopped at the wall, z=${p.z}`);
 assert.ok(reads > 0 && reads <= 21, `only the wall under the step was read (${reads})`);
 const free = new Character([]); free.x = x; free.z = z; free.y = y; free.yaw = 0; for (let i = 0; i < 60; i++) free.step(FIXED_DT, { forward: 1, right: 0, run: false, jump: false });
 assert.ok(free.z > z + 5, 'without blocks the same walk passes');
});
