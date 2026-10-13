import * as THREE from 'three';
import { BUILDABLE, ITEMS, type BuildingKind } from './game/defs';
import { electricPort, endpoint, connect, machine, insideDome, gasDirection, linkSegments, LINK_RANGE } from './game/production';
import { countItem } from './game/inventory';
import { placementProblem, place } from './buildings';
import { heightAt, boxes } from './world';
import type { GameState } from './game/state';
import { createGhost } from './stationModels';

const OPEN_REACH = 3.7, LINK_REACH = LINK_RANGE + 2;
const CAPSULE_BOX = (h: number) => new THREE.Box3(new THREE.Vector3(37.4, h, 36.9), new THREE.Vector3(42.6, h + 4.4, 43.2));
const portName = (g: GameState, id: string) => id === 'capsule' ? 'Капсула' : ITEMS[machine(g, id)?.kind ?? '']?.name ?? 'Порт';
/**
 * World actions under the reticle: aim at stations (the glass dome never hides the machines
 * inside it), place a selected body on the 1 m grid with a rotatable model preview, and draw
 * cables/pipes between two ports with a live length/cost preview.
 */
export function createWorldInteraction(scene: THREE.Scene, camera: THREE.Camera) {
 const ghost = createGhost(scene);
 const wireMat = new THREE.LineDashedMaterial({ color: 0x68daeb, dashSize: .35, gapSize: .18, transparent: true, opacity: .95, depthTest: false });
 const wire = new THREE.Line(new THREE.BufferGeometry(), wireMat); wire.renderOrder = 10; scene.add(wire); wire.visible = false;
 const ray = new THREE.Raycaster(), direction = new THREE.Vector3(), hitPoint = new THREE.Vector3(), box = new THREE.Box3(), lo = new THREE.Vector3(), hi = new THREE.Vector3();
 let x = 0, z = 0, rot = 0, problem = '', source: string | null = null, selection = '', target: string | null = null, link = { valid: false, cost: 0, distance: 0, reason: '' };
 const isBody = (id: string) => (BUILDABLE as readonly string[]).includes(id);
 function aim(g: GameState, reach: number) {
  camera.getWorldDirection(direction); ray.set(camera.position, direction);
  let best = reach, dome: string | null = null, domeDist = reach, around: string | null = null; target = null;
  const p = g.player;
  for (const b of g.world.base.buildings) {
   const isDome = b.kind === 'dome';
   // Inside a dome its glass never blocks the machines; the dome itself stays the fallback target (to exit).
   if (isDome && insideDome(b, p.x, p.y + .1, p.z)) { around = b.id; continue; }
   const r = isDome ? 2.5 : .6, h = isDome ? 3.1 : b.kind === 'workbench' && b.level === 2 ? 1.6 : 1.5;
   box.set(lo.set(b.x - r, b.y, b.z - r), hi.set(b.x + r, b.y + h, b.z + r));
   // Standing in the airlock vestibule (inside the dome's aim box, outside its cells) faces the dome directly.
   const near = isDome && box.containsPoint(camera.position);
   const hit = near ? camera.position : ray.ray.intersectBox(box, hitPoint); if (!hit) continue;
   const d = near ? 0 : hit.distanceTo(camera.position);
   if (isDome) { if (d < domeDist) { domeDist = d; dome = b.id; } }
   else if (d < best) { best = d; target = b.id; }
  }
  for (const b of boxes) if (b.id.startsWith('crate-')) {
   box.set(lo.set(b.minX, b.minY, b.minZ), hi.set(b.maxX, b.maxY, b.maxZ));
   const hit = ray.ray.intersectBox(box, hitPoint); if (hit && hit.distanceTo(camera.position) < Math.min(best, OPEN_REACH)) { best = hit.distanceTo(camera.position); target = b.id; }
  }
  // Glass: the dome is a target only when no machine is seen through or in front of it.
  if (!target && dome) target = dome;
  if (!target && around) target = around;
  if (!target) {
   const inside = p.x > 37.5 && p.x < 42.5 && p.z > 37 && p.z < 43.1;
   const hit = ray.ray.intersectBox(CAPSULE_BOX(heightAt(40, 40)), hitPoint);
   if (inside || (hit && hit.distanceTo(camera.position) < Math.min(reach, 6))) target = 'capsule';
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
 function update(g: GameState | null, active: boolean, dt = 0) {
  ghost.hide(); wire.visible = false;
  if (!g || !active) { target = null; return; }
  const id = g.player.inventory[g.player.hotbar]?.itemId ?? '';
  if (selection !== id) { source = null; selection = id; }
  const linking = id === 'cable' || id === 'gas_pipe';
  aim(g, linking ? LINK_REACH : OPEN_REACH);
  if (isBody(id)) {
   let hit: THREE.Vector3 | undefined;
   for (let d = .5; d <= 12; d += .1) { const q = ray.ray.at(d, new THREE.Vector3()); if (q.y <= heightAt(q.x, q.z) + .12) { hit = q; break; } }
   if (hit) {
    x = Math.round(hit.x); z = Math.round(hit.z); problem = placementProblem(g, id as BuildingKind, x, z);
    const inDome = g.world.base.buildings.find(b => b.kind === 'dome' && id !== 'dome' && insideDome(b, x, b.y + .1, z));
    ghost.show(id as BuildingKind, x, inDome ? inDome.y : heightAt(x, z) + .12, z, rot, !problem, dt);
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
  update, action, cancel: () => { source = null; },
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
