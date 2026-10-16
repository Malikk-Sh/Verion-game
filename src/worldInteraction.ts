import * as THREE from 'three';
import { BUILDABLE, ITEMS, type BuildingKind } from './game/defs';
import { electricPort, endpoint, connect, machine, nearby, gasDirection, linkSegments, LINK_RANGE } from './game/production';
import { countItem } from './game/inventory';
import { placementProblem, place, stationY } from './buildings';
import { heightAt, boxes } from './world';
import type { GameState } from './game/state';
import { createGhost } from './stationModels';
import { rayCells } from './glass';
import { allDeposits, depositLeft, depositScale } from './game/resources';
import { REACH } from './game/mining';
import { cellKey, cellOf, doorFront, doorProblem, glassProblem, groundCell, placeDoor, placeGlass, roomsView, type RoomEdit } from './game/rooms';

const OPEN_REACH = 3.7, LINK_REACH = LINK_RANGE + 2;
/** Glass building: the aim ray walks the block grid up to 6 m; a room window opens from up to 4.5 m. */
export const GLASS_AIM = 6, ROOM_REACH = 4.5;
/** Quarter turn whose front (rot 0 = +z) points along a horizontal direction. */
const rotOf = (x: number, z: number) => Math.abs(x) > Math.abs(z) ? (x > 0 ? 1 : 3) : (z >= 0 ? 0 : 2);
/** The block (or airlock) the reticle rests on: `key` its cell, `normal` the struck face. */
export type Struck = { key: number; door: string | null; distance: number; normal: [number, number, number] };
const CAPSULE_BOX = (h: number) => new THREE.Box3(new THREE.Vector3(37.4, h, 36.9), new THREE.Vector3(42.6, h + 4.4, 43.2));
const toNode = new THREE.Vector3();
/**
 * The deposit under the reticle within reach and the distance to its near side (0 when the player stands at it):
 * the ray meets its bounding sphere within REACH, or the player stands right next to it facing it (easier on touch).
 * The nearer of it and a glass block wins (update's `nearer`), so a deposit walled into a room stays mineable.
 */
export function aimDeposit(g: GameState, from: THREE.Vector3, dir: THREE.Vector3, px: number, pz: number): { id: string; near: number } | null {
 let best = Infinity, out: { id: string; near: number } | null = null;
 for (const n of allDeposits(g)) {
  const left = depositLeft(g, n.id); if (left <= 0) continue; const k = depositScale(left, n.amount), r = n.radius * k.xz;
  toNode.set(n.x, heightAt(n.x, n.z) + n.height * k.y * .5, n.z).sub(from);
  const along = toNode.dot(dir), perp = Math.sqrt(Math.max(0, toNode.lengthSq() - along * along)), horiz = Math.hypot(px - n.x, pz - n.z) - r;
  const hit = along > 0 && perp < r + .25 && along - r <= REACH, close = horiz < 1.3 && along > 0 && perp < r + 1.1;
  if ((hit || close) && along < best) { best = along; out = { id: n.id, near: Math.max(0, along - r) }; }
 }
 return out;
}
const portName = (g: GameState, id: string) => id === 'capsule' ? 'Капсула' : ITEMS[machine(g, id)?.kind ?? '']?.name ?? 'Порт';
/**
 * World actions under the reticle: aim at stations (glass never hides the machines behind it),
 * place a selected body on the 1 m grid with a rotatable model preview, draw cables/pipes between
 * two ports with a live length/cost preview, and build glass blocks and airlocks cell by cell (S4).
 */
export function createWorldInteraction(scene: THREE.Scene, camera: THREE.Camera) {
 const ghost = createGhost(scene);
 const wireMat = new THREE.LineDashedMaterial({ color: 0x68daeb, dashSize: .35, gapSize: .18, transparent: true, opacity: .95, depthTest: false });
 const wire = new THREE.Line(new THREE.BufferGeometry(), wireMat); wire.renderOrder = 10; scene.add(wire); wire.visible = false;
 const ray = new THREE.Raycaster(), direction = new THREE.Vector3(), hitPoint = new THREE.Vector3(), box = new THREE.Box3(), lo = new THREE.Vector3(), hi = new THREE.Vector3();
 let x = 0, z = 0, rot = 0, problem = '', source: string | null = null, selection = '', target: string | null = null, link = { valid: false, cost: 0, distance: 0, reason: '' };
 const isBody = (id: string) => (BUILDABLE as readonly string[]).includes(id), isCell = (id: string) => id === 'window' || id === 'airlock';
 // ---------- Glass building: the struck block, the target cell and its ghost ----------
 let struck: Struck | null = null, cell: number | null = null, cellRot = 0, support = -1;
 const okMat = new THREE.MeshBasicMaterial({ color: 0x64e6bd, transparent: true, opacity: .26, depthWrite: false }), badMat = new THREE.MeshBasicMaterial({ color: 0xe76d62, transparent: true, opacity: .26, depthWrite: false });
 const okLine = new THREE.LineBasicMaterial({ color: 0x64e6bd, transparent: true, opacity: .95 }), badLine = new THREE.LineBasicMaterial({ color: 0xe76d62, transparent: true, opacity: .95 });
 const cellGhost = (h: number) => { const geo = new THREE.BoxGeometry(1.02, h + .02, 1.02), g = new THREE.Group(), fill = new THREE.Mesh(geo, okMat), edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), okLine); fill.renderOrder = edges.renderOrder = 6; g.add(fill, edges); g.visible = false; scene.add(g); return { g, fill, edges }; };
 const blockGhost = cellGhost(1), doorGhost = cellGhost(2), doorArrow = new THREE.Mesh(new THREE.ConeGeometry(.14, .32, 3), okMat);
 doorArrow.rotation.x = Math.PI / 2; doorArrow.position.set(0, -.92, .72); doorGhost.g.add(doorArrow);
 function showCell(id: string, key: number, valid: boolean) {
  const gh = id === 'airlock' ? doorGhost : blockGhost, { i, k, j } = cellOf(key);
  gh.fill.material = valid ? okMat : badMat; gh.edges.material = valid ? okLine : badLine; doorArrow.material = valid ? okMat : badMat;
  gh.g.position.set(i + .5, k + (id === 'airlock' ? 1 : .5), j + .5); gh.g.rotation.y = id === 'airlock' ? cellRot * Math.PI / 2 : 0; gh.g.visible = true;
 }
 /** DDA over glass/door cells and the terrain ray-march; the nearer hit wins. */
 function strike(g: GameState, max: number) {
  const v = roomsView(g.world.base), hit = rayCells(camera.position, direction, max, (i, k, j) => { const key = cellKey(i, k, j); return v.glass.has(key) || v.doorAt.has(key); });
  let ground: THREE.Vector3 | null = null; const far = hit ? hit.distance : max;
  for (let d = .3; d <= far; d += .1) { const q = ray.ray.at(d, new THREE.Vector3()); if (q.y <= heightAt(q.x, q.z)) { ground = q; break; } }
  struck = hit && !ground ? { key: cellKey(hit.i, hit.k, hit.j), door: v.doorAt.get(cellKey(hit.i, hit.k, hit.j))?.id ?? null, distance: hit.distance, normal: hit.normal } : null;
  return ground;
 }
 function aimCell(g: GameState, id: string) {
  const ground = strike(g, GLASS_AIM), v = roomsView(g.world.base);
  cell = null; support = -1;
  // Facing the struck face (side faces), else facing the viewer; Q adds quarter turns.
  const face = struck && struck.normal[1] === 0 ? rotOf(struck.normal[0], struck.normal[2]) : rotOf(-direction.x, -direction.z); cellRot = (face + rot) % 4;
  if (struck) {
   const n = struck.normal; support = struck.key;
   // An airlock aimed at a wall block replaces it (and the one above or below): the lower of the two stays on the floor.
   if (id === 'airlock' && !struck.door && n[1] === 0) cell = v.glass.has(struck.key - 1) ? struck.key - 1 : struck.key;
   else { const c = cellOf(struck.key); cell = cellKey(c.i + n[0], c.k + n[1], c.j + n[2]); }
  } else if (ground) {
   const at = groundCell(v, Math.floor(ground.x), Math.floor(ground.z)); cell = at.cell; support = at.support;
  }
  if (cell === null) { problem = 'Наведите на грунт или стеклоблок в пределах 6 м'; return; }
  problem = id === 'window' ? glassProblem(g, cell) : doorProblem(g, cell, cellRot);
  showCell(id, cell, !problem);
 }
 function aim(g: GameState, reach: number) {
  camera.getWorldDirection(direction); ray.set(camera.position, direction);
  let best = reach; target = null;
  const p = g.player;
  for (const b of g.world.base.buildings) {
   // A window opens only where its actions work (nearby(): 3.2 m to the centre); line ends may be farther.
   if (reach <= OPEN_REACH && !nearby(g, b)) continue;
   const r = .6, h = b.kind === 'workbench' && b.level === 2 ? 1.6 : 1.5;
   box.set(lo.set(b.x - r, b.y, b.z - r), hi.set(b.x + r, b.y + h, b.z + r));
   const hit = ray.ray.intersectBox(box, hitPoint); if (!hit) continue;
   const d = hit.distanceTo(camera.position);
   if (d < best) { best = d; target = b.id; }
  }
  for (const b of boxes) if (b.id.startsWith('crate-')) {
   box.set(lo.set(b.minX, b.minY, b.minZ), hi.set(b.maxX, b.maxY, b.maxZ));
   const hit = ray.ray.intersectBox(box, hitPoint); if (hit && hit.distanceTo(camera.position) < Math.min(best, OPEN_REACH)) { best = hit.distanceTo(camera.position); target = b.id; }
  }
  if (!target) {
   const inside = p.x > 37.5 && p.x < 42.5 && p.z > 37 && p.z < 43.1;
   const hit = ray.ray.intersectBox(CAPSULE_BOX(heightAt(40, 40)), hitPoint);
   // Its port window works only from inside (refill needs insideCapsule()); from outside the hull is just a line end.
   if (inside || (reach > OPEN_REACH && hit && hit.distanceTo(camera.position) < Math.min(reach, 6))) target = 'capsule';
  }
 }
 function linkCheck(g: GameState, kind: 'cable' | 'gas_pipe', from: string, to: string | null) {
  if (!to || to === from) return { valid: false, cost: 0, distance: 0, reason: 'Наведите на второй порт' };
  const a = endpoint(g, from), b = endpoint(g, to);
  if (!a || !b) return { valid: false, cost: 0, distance: 0, reason: 'Нет порта' };
  const distance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), cost = linkSegments(distance);
  const body = to === 'capsule' ? null : machine(g, to);
  let reason = '';
  if (kind === 'cable' && (!body || !electricPort(body))) reason = 'У станции нет электрического порта';
  else if (kind === 'gas_pipe') { const [f, t] = gasDirection(g, from, to); if (machine(g, f)?.kind !== 'electrolyzer' || (t !== 'capsule' && !['refill', 'distributor'].includes(machine(g, t)?.kind ?? ''))) reason = 'Труба O₂: генератор кислорода → капсула, заправка или распределитель'; }
  if (!reason && distance > LINK_RANGE + .001) reason = `Слишком далеко: ${distance.toFixed(1)} м из ${LINK_RANGE}`;
  if (!reason && countItem(g.player.inventory, kind) < cost) reason = `Нужно ${cost} × ${ITEMS[kind].name}`;
  return { valid: !reason, cost, distance, reason };
 }
 /** `nearer`: distance to the aimed deposit (aimDeposit); a block or airlock behind it is neither a target nor struck. */
 function update(g: GameState | null, active: boolean, dt = 0, nearer = Infinity) {
  ghost.hide(); wire.visible = false; blockGhost.g.visible = doorGhost.g.visible = false;
  if (!g || !active) { target = null; struck = null; cell = null; return; }
  const id = g.player.inventory[g.player.hotbar]?.itemId ?? '';
  if (selection !== id) { source = null; selection = id; }
  const linking = id === 'cable' || id === 'gas_pipe';
  aim(g, linking ? LINK_REACH : OPEN_REACH);
  if (isCell(id)) { aimCell(g, id); return; }
  // Blocks under the reticle: removal (R) from 6 m, the room window from 4.5 m; a station seen through the glass wins, and so does a nearer deposit.
  strike(g, GLASS_AIM); if (struck && struck.distance >= nearer) struck = null;
  if (!target && !linking && struck && struck.distance <= ROOM_REACH) target = struck.door ?? 'glass:' + struck.key;
  if (isBody(id)) {
   let hit: THREE.Vector3 | undefined;
   for (let d = .5; d <= 12; d += .1) { const q = ray.ray.at(d, new THREE.Vector3()); if (q.y <= heightAt(q.x, q.z) + .12) { hit = q; break; } }
   if (hit) {
    x = Math.round(hit.x); z = Math.round(hit.z); problem = placementProblem(g, id as BuildingKind, x, z, rot);
    ghost.show(id as BuildingKind, x, stationY(x, z), z, rot, !problem, dt);
   } else problem = 'Наведите на землю в пределах 12 м';
  } else if (source && linking) {
   const a = endpoint(g, source); if (!a) { source = null; return; }
   link = linkCheck(g, id as 'cable' | 'gas_pipe', source, target);
   const b = target && target !== source ? endpoint(g, target) : null;
   const to = b ? new THREE.Vector3(b.x, b.y + 1.05, b.z) : ray.ray.at(3, new THREE.Vector3());
   const from = new THREE.Vector3(a.x, a.y + 1.05, a.z);
   const points: THREE.Vector3[] = [];
   const sag = id === 'cable' ? Math.min(.6, from.distanceTo(to) * .06) : 0;
   for (let i = 0; i <= 16; i++) { const t = i / 16, q = from.clone().lerp(to, t); q.y -= Math.sin(Math.PI * t) * sag; points.push(q); }
   wire.geometry.dispose(); wire.geometry = new THREE.BufferGeometry().setFromPoints(points); wire.computeLineDistances();
   wireMat.color.set(!b ? 0x68daeb : link.valid ? 0x64e6bd : 0xe76d62); wire.visible = true;
  }
 }
 /** Places the selected glass block or airlock into the target cell (null: no cell tool selected). */
 function placeCell(g: GameState): (RoomEdit & { key: number }) | null {
  const id = g.player.inventory[g.player.hotbar]?.itemId ?? ''; if (!isCell(id)) return null;
  if (cell === null) return { error: problem || 'Наведите на грунт или стеклоблок', needConfirm: false, ventGU: 0, breached: false, at: null, key: -1 };
  const key = cell, r = id === 'window' ? placeGlass(g, key) : placeDoor(g, key, cellRot); return { ...r, key };
 }
 function action(g: GameState): string | null {
  const id = g.player.inventory[g.player.hotbar]?.itemId ?? '';
  if (isBody(id)) return problem || place(g, id as BuildingKind, x, z, rot);
  if (id === 'cable' || id === 'gas_pipe') {
   const b = target ? endpoint(g, target) : null; if (!b) return 'Наведите на станцию';
   const body = target && target !== 'capsule' ? machine(g, target) : null;
   if (id === 'cable' && (!body || !electricPort(body))) return 'У станции нет электрического порта';
   if (id === 'gas_pipe' && target !== 'capsule' && !body?.kind.match(/^(electrolyzer|refill|distributor)$/)) return 'Нужен кислородный порт';
   if (!source) { source = target; return 'Первый порт выбран. Наведите на второй'; }
   if (source === target) return 'Выберите другую станцию';
   const check = linkCheck(g, id, source, target); if (!check.valid) return check.reason;
   const [from, to] = id === 'gas_pipe' ? gasDirection(g, source, target!) : [source, target!];
   const error = connect(g, id, from, to); if (!error) source = null; return error;
  }
  return null;
 }
 return {
  update, action, placeCell, cancel: () => { source = null; },
  /** Glass block or airlock selected: the cell tool owns the reticle. */
  get cellTool() { return isCell(selection); },
  /** Target cell of the cell tool (null: nothing aimed), the block it rests on (-1: terrain) and the airlock's turn. */
  get cell() { return cell; }, get support() { return support; }, get cellRot() { return cellRot; },
  get struck() { return struck; },
  /** Front of the airlock ghost, for captions. */
  get cellFront() { return doorFront(cellRot); },
  rotate: () => { rot = (rot + 1) % 4; return rot; },
  get rotation() { return rot; },
  get target() { return target; }, get building() { return isBody(selection); }, get linking() { return selection === 'cable' || selection === 'gas_pipe'; },
  get source() { return source; },
  get linkOk() { return !source || link.valid; },
  get hint() { return !source ? 'Наведите на первую станцию · F' : link.reason ? link.reason : `${link.distance.toFixed(1)} м · ${link.cost} × ${ITEMS[selection]?.name ?? ''} · F`; },
  get sourceName() { return source ? '' : ''; },
  portName,
  get problem() { return problem; },
 };
}
