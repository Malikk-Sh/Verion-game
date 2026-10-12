import * as THREE from 'three';
import { boxes, box, heightAt } from './world';
import { BUILDABLE, ITEMS, TANKS, type BuildingKind } from './game/defs';
import { insideDome, makeBuilding, domeFaces, habitable, telemetry, RECIPE_BY_ID, nearby, poweredComponent, type Building } from './game/production';
import { countItem } from './game/inventory';
import type { GameState } from './game/state';
import { buildStation, PORT_HEIGHT, type StationLook, type StationVisual } from './stationModels';
import type { Fx } from './fx';
export function placementProblem(g: GameState, kind: BuildingKind, x: number, z: number): string {
 if(!(BUILDABLE as readonly string[]).includes(kind)||!Number.isInteger(x)||!Number.isInteger(z))return 'Выберите корпус и клетку';
 if(g.world.base.buildings.length>=64)return 'Достигнут предел 64 корпусов';
 if(x < -195 || x > 355 || z < -195 || z > 355)return 'За границей участка';
 if(Math.hypot(x-g.player.x,z-g.player.z)>12)return 'Место дальше 12 м: подойдите ближе';
 const r=kind==='dome'?2.5:.48;
 if(Math.abs(x-g.player.x)<r+.4&&Math.abs(z-g.player.z)<r+.4)return 'Место занято персонажем';
 if(x+r>36.7&&x-r<43.3&&z+r>36.5&&z-r<47)return 'Оставьте вход капсулы свободным';
 if(Math.abs(x-100)<12+r&&Math.abs(z-132)<10+r)return 'Здесь зарезервирован будущий водоём';
 const y=heightAt(x,z),heights=[];for(const dx of [-r,0,r])for(const dz of [-r,0,r])heights.push(heightAt(x+dx,z+dz));
 if(Math.max(...heights)-Math.min(...heights)>.5)return 'Неровное основание: перепад больше 0,5 м';
 for(const b of g.world.base.buildings){const br=b.kind==='dome'?2.5:.48;
  if(b.kind==='dome'&&kind!=='dome'&&insideDome(b,x,b.y+.1,z))continue;
  if(Math.abs(x-b.x)<r+br+.1&&Math.abs(z-b.z)<r+br+.1)return 'Место занято постройкой';
 }
 for(const b of boxes)if(!b.id.startsWith('build-')&&x+r>b.minX&&x-r<b.maxX&&z+r>b.minZ&&z-r<b.maxZ&&y+3>b.minY&&y<b.maxY)return 'Место занято объектом';
 return '';
}
export function place(g: GameState, kind: BuildingKind, x: number, z: number, rot = 0): string {
 const problem=placementProblem(g,kind,x,z);if(problem)return problem;
 const inv=g.player.inventory,index=inv[g.player.hotbar]?.itemId===kind?g.player.hotbar:inv.findIndex(s=>s?.itemId===kind&&!s.packed);
 const selected=inv[index];if(!selected)return 'В рюкзаке нет: '+ITEMS[kind].name;
 const packed=selected.packed;if(--selected.count===0)inv[index]=null;
 const dome=g.world.base.buildings.find(b=>insideDome(b,x,b.y+.1,z)),y=dome?dome.y:Math.max(...[-2.5,0,2.5].flatMap(dx=>[-2.5,0,2.5].map(dz=>heightAt(x+(kind==='dome'?dx:dx*.2),z+(kind==='dome'?dz:dz*.2)))))+.12;
 const body=makeBuilding(g,kind,x,y,z,rot);if(packed)Object.assign(body,structuredClone(packed),{rot:((rot%4)+4)%4});return '';
}
/** Visual state of one station: never feeds back into the simulation. */
export function stationLook(g: GameState, b: Building): StationLook {
 const pw = (telemetry.power.get(b.id) ?? 0) > 0, r = b.job ? RECIPE_BY_ID.get(b.job.recipeId) : undefined, running = !!b.job && !!r && b.job.workMs < r.seconds * 1000;
 if (!b.enabled) return { status: 'off', working: 0 };
 switch (b.kind) {
  case 'workbench': {
   const work = running && (b.level === 2 ? pw : nearby(g, b));
   return { status: work ? 'work' : running || (b.job && !running) ? 'warn' : 'idle', working: work ? 1 : 0, level: b.level };
  }
  case 'kiln': { const ready = !!b.input[0]; const fuel = (b.input[1]?.count ?? 0) > 0; return { status: running ? 'work' : ready && !fuel ? 'warn' : b.output[0] && !ready ? 'idle' : 'idle', working: running ? 1 : 0 }; }
  case 'biogenerator': { const out = (telemetry.supply.get(b.id) ?? 0) > 0; const empty = !b.fuel && !countItem(b.input, 'fiber') && b.energy < 1000; return { status: out ? 'work' : empty ? 'warn' : 'idle', working: out ? 1 : 0 }; }
  case 'electrolyzer': { const water = !!b.input[0] || b.water > 0 || running; return { status: running && pw ? 'work' : water && !pw ? 'warn' : 'idle', working: running && pw ? 1 : 0 }; }
  case 'refill': return { status: b.oxygen > 0 ? 'idle' : 'warn', working: 0 };
  case 'distributor': { const room = g.world.base.buildings.some(d => d.kind === 'dome' && insideDome(d, b.x, b.y, b.z)); return { status: !room ? 'warn' : pw ? 'work' : 'warn', working: pw ? 1 : 0 }; }
  case 'dome': { const pass = g.world.base.passage?.domeId === b.id ? 1 - g.world.base.passage.remainingMs / 6000 : 0; const door = pass > 0 ? Math.min(1, Math.sin(Math.PI * pass) * 1.6) : 0; const ok = habitable(b); return { status: ok ? 'work' : 'warn', working: ok ? 1 : 0, habitable: ok, door }; }
 }
}
/** Where a line attaches to a station: on top of the body, pulled towards the other end. */
export function portPoint(g: GameState, id: string, toward?: { x: number; z: number }): THREE.Vector3 {
 if (id === 'capsule') { const dx = (toward?.x ?? 40) - 40, dz = (toward?.z ?? 37) - 40, l = Math.max(Math.abs(dx), Math.abs(dz)) || 1; return new THREE.Vector3(40 + dx / l * 2.6, heightAt(40, 40) + .8, 40 + dz / l * 3); }
 const b = g.world.base.buildings.find(v => v.id === id)!;
 const p = new THREE.Vector3(b.x, b.y + PORT_HEIGHT[b.kind], b.z);
 if (toward && b.kind !== 'dome') { const dx = toward.x - b.x, dz = toward.z - b.z, l = Math.hypot(dx, dz) || 1; p.x += dx / l * .3; p.z += dz / l * .3; }
 if (b.kind === 'dome' && toward) { const dx = toward.x - b.x, dz = toward.z - b.z, l = Math.max(Math.abs(dx), Math.abs(dz)) || 1; p.x += dx / l * 2.05; p.z += dz / l * 2.05; }
 return p;
}
function stripeTexture(color: string) {
 const c = document.createElement('canvas'); c.width = 64; c.height = 4; const x = c.getContext('2d')!;
 x.fillStyle = '#000'; x.fillRect(0, 0, 64, 4); const g = x.createLinearGradient(0, 0, 64, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.45, color); g.addColorStop(.55, color); g.addColorStop(1, 'rgba(0,0,0,0)');
 x.fillStyle = g; x.fillRect(0, 0, 64, 4); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** Placed stations, cables and pipes; rebuilt only when the layout changes, animated every frame. */
const UP = new THREE.Vector3(0, 1, 0);
export function createBuildings(scene: THREE.Scene, fx?: Fx) {
 const root = new THREE.Group(); scene.add(root);
 const glass = new THREE.MeshStandardMaterial({ color: 0x9fd6dd, transparent: true, opacity: .2, roughness: .05, metalness: .1, depthWrite: false, side: THREE.DoubleSide });
 const roofGlass = new THREE.MeshStandardMaterial({ color: 0xb6e2e6, transparent: true, opacity: .28, roughness: .08, metalness: .1, depthWrite: false, side: THREE.DoubleSide });
 const cableFlow = stripeTexture('#ffb070'), pipeFlow = stripeTexture('#9ff1ff');
 const cableMat = new THREE.MeshStandardMaterial({ color: 0x23282a, roughness: .7, metalness: .2 });
 const cableLive = new THREE.MeshStandardMaterial({ color: 0x23282a, roughness: .7, metalness: .2, emissive: 0xffffff, emissiveMap: cableFlow, emissiveIntensity: 1.4 });
 const pipeMat = new THREE.MeshStandardMaterial({ color: 0xdfe4e2, roughness: .4, metalness: .35 });
 const pipeLive = new THREE.MeshStandardMaterial({ color: 0xdfe4e2, roughness: .4, metalness: .35, emissive: 0xffffff, emissiveMap: pipeFlow, emissiveIntensity: 1.2 });
 const flange = new THREE.MeshStandardMaterial({ color: 0x4fa8c4, roughness: .45, metalness: .3 }), post = new THREE.MeshStandardMaterial({ color: 0x2a3336, roughness: .6, metalness: .5 });
 const cube = new THREE.BoxGeometry(1, 1, 1), ringGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
 const stations = new Map<string, { b: Building; v: StationVisual; group: THREE.Group }>();
 const lines: { id: string; kind: 'cable' | 'gas_pipe'; mesh: THREE.Mesh; extra: THREE.Object3D[]; curve: THREE.Curve<THREE.Vector3>; grow: number }[] = [];
 const knownLinks = new Set<string>(), puff = new Map<string, number>();
 const born = new Map<string, number>();
 let key = '', time = 0, initial = true;
 function clearLines() { for (const l of lines) { l.mesh.geometry.dispose(); root.remove(l.mesh); for (const e of l.extra) root.remove(e); } lines.length = 0; }
 function sync(g: GameState) {
  const next = JSON.stringify([g.world.base.buildings.map(b => [b.id, b.kind, b.level, b.rot, b.x, b.y, b.z, b.kind === 'dome' ? b.zone.shell : 0]), g.world.base.links]);
  if (next === key) return; key = next;
  for (let i = boxes.length - 1; i >= 0; i--) if (boxes[i].id.startsWith('build-')) boxes.splice(i, 1);
  const alive = new Set(g.world.base.buildings.map(b => b.id));
  for (const [id, s] of stations) if (!alive.has(id) || s.b.kind !== g.world.base.buildings.find(b => b.id === id)?.kind || s.b.level !== g.world.base.buildings.find(b => b.id === id)?.level || s.b.rot !== g.world.base.buildings.find(b => b.id === id)?.rot || s.b.kind === 'dome') { root.remove(s.group); s.v.dispose(); stations.delete(id); }
  for (const b of g.world.base.buildings) {
   let s = stations.get(b.id);
   if (!s) {
    const v = buildStation(b.kind, b.level), group = new THREE.Group(); group.name = b.id; group.add(v.group); v.group.rotation.y = b.rot * Math.PI / 2;
    if (!initial) born.set(b.id, 0);
    s = { b: { ...b, rot: b.rot }, v, group }; stations.set(b.id, s); root.add(group);
    if (b.kind === 'dome') {
     const faces = domeFaces(), walls: THREE.Matrix4[] = [], roof: THREE.Matrix4[] = [];
     for (let i = 0; i < faces.length; i++) if (b.zone.shell[i] > 0) {
      const f = faces[i], d = f.next.map((n, j) => n - f.cell[j]), cx = f.cell[0] - 1.5 + d[0] * .5, cy = f.cell[1] + .5 + d[1] * .5 + .02, cz = f.cell[2] - 1.5 + d[2] * .5, w = d[0] ? .03 : .96, h = d[1] ? .03 : .96, depth = d[2] ? .03 : .96;
      const m = new THREE.Matrix4().makeScale(w, h, depth); m.setPosition(cx, cy, cz); (d[1] ? roof : walls).push(m);
      boxes.push(box(b.id + '-face-' + i, b.x + cx, b.y + cy, b.z + cz, d[0] ? .1 : 1, d[1] ? .1 : 1, d[2] ? .1 : 1));
     }
     for (const [mat, list] of [[glass, walls], [roofGlass, roof]] as const) { if (!list.length) continue; const mesh = new THREE.InstancedMesh(cube, mat, list.length); list.forEach((m, i) => mesh.setMatrixAt(i, m)); mesh.receiveShadow = true; mesh.renderOrder = 2; group.add(mesh); }
    }
   }
   s.b = { ...b }; s.group.position.set(b.x, b.y, b.z);
   if (b.kind === 'workbench') { const h = b.level === 2 ? 1.55 : 1.1; boxes.push(box(b.id, b.x, b.y + h / 2, b.z, .98, h, .82)); }
   else if (b.kind !== 'dome') { const h = b.kind === 'kiln' ? 1.35 : b.kind === 'refill' ? 1.45 : b.kind === 'distributor' ? .95 : 1.25; const w = b.kind === 'refill' ? .7 : .94; boxes.push(box(b.id, b.x, b.y + h / 2, b.z, w, h, w)); }
  }
  clearLines();
  for (const l of g.world.base.links) {
   const ta = l.to === 'capsule' ? { x: 40, z: 40 } : g.world.base.buildings.find(b => b.id === l.to)!, fa = g.world.base.buildings.find(b => b.id === l.from)!;
   if (!fa || !ta) continue;
   const a = portPoint(g, l.from, ta), b = portPoint(g, l.to, fa), extra: THREE.Object3D[] = [];
   const len = a.distanceTo(b), pts: THREE.Vector3[] = [];
   if (l.kind === 'cable') {
    const sag = Math.min(.7, len * .07);
    for (let i = 0; i <= 20; i++) { const t = i / 20, p = a.clone().lerp(b, t); p.y -= Math.sin(Math.PI * t) * sag; pts.push(p); }
   } else {
    // Pipes drop to a low run on posts, then rise into the next port.
    const lowA = a.clone(), lowB = b.clone(); const run = Math.min(a.y, b.y) - .35;
    lowA.y = Math.max(heightAt(a.x, a.z) + .3, run); lowB.y = Math.max(heightAt(b.x, b.z) + .3, run);
    const dir = b.clone().sub(a).setY(0).normalize().multiplyScalar(Math.min(.35, len * .2));
    lowA.add(dir); lowB.sub(dir);
    pts.push(a, lowA);
    const n = Math.max(2, Math.ceil(lowA.distanceTo(lowB) / 1.5));
    for (let i = 1; i < n; i++) { const p = lowA.clone().lerp(lowB, i / n); p.y = Math.max(heightAt(p.x, p.z) + .3, p.y); pts.push(p); const pole = new THREE.Mesh(cube, post); const hh = p.y - heightAt(p.x, p.z); pole.scale.set(.05, hh, .05); pole.position.set(p.x, p.y - hh / 2, p.z); pole.castShadow = true; root.add(pole); extra.push(pole); }
    pts.push(lowB, b);
    for (const p of [a, b]) { const r = new THREE.Mesh(ringGeo, flange); r.scale.set(.075, .06, .075); r.position.copy(p); root.add(r); extra.push(r); }
   }
   const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', l.kind === 'cable' ? .5 : .05);
   const geo = new THREE.TubeGeometry(curve, Math.max(12, Math.ceil(curve.getLength() * 6)), l.kind === 'cable' ? .022 : .045, 6, false);
   const uv = geo.attributes.uv as THREE.BufferAttribute, total = curve.getLength(); for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * total / .9);
   const mesh = new THREE.Mesh(geo, l.kind === 'cable' ? cableMat : pipeMat); mesh.castShadow = true; mesh.name = l.id; root.add(mesh);
   // A new line draws itself from the source to the target and sparks along its length.
   const fresh = !initial && !knownLinks.has(l.id); knownLinks.add(l.id);
   if (fresh) { geo.setDrawRange(0, 0); for (const e of extra) e.visible = false; fx?.connect(curve.getSpacedPoints(16), l.kind); }
   lines.push({ id: l.id, kind: l.kind, mesh, extra, curve, grow: fresh ? 0 : 1 });
  }
  if (initial) for (const l of g.world.base.links) knownLinks.add(l.id);
  initial = false;
 }
 /** A newly loaded world appears as saved; only later placements animate. */
 function reset() { key = ''; initial = true; knownLinks.clear(); puff.clear(); for (const s of stations.values()) { root.remove(s.group); s.v.dispose(); } stations.clear(); clearLines(); born.clear(); }
 /** Animates stations and flow; `dt` is real frame time (0 while frozen). */
 function update(g: GameState | null, dt: number) {
  if (!g) return; time += dt;
  cableFlow.offset.x -= dt * 1.6; pipeFlow.offset.x -= dt * 1.2;
  for (const s of stations.values()) {
   const b = g.world.base.buildings.find(v => v.id === s.b.id); if (!b) continue;
   s.v.update(dt, stationLook(g, b));
   const t = born.get(b.id);
   if (t !== undefined) { const k = Math.min(1, t + dt * 2.4); born.set(b.id, k); const e = 1 - Math.pow(1 - k, 3), over = Math.sin(k * Math.PI) * .08; s.v.group.scale.set(1 + over, e + over * .5, 1 + over); s.v.group.position.y = (1 - e) * .6; if (t < .55 && k >= .55) fx?.land(b.x, b.y, b.z, b.kind === 'dome' ? 2.3 : .6); if (k >= 1) { born.delete(b.id); s.v.group.scale.setScalar(1); s.v.group.position.y = 0; } }
   if (fx && dt > 0) emitFrom(g, b, dt);
  }
  for (const l of lines) if (l.grow < 1) { l.grow = Math.min(1, l.grow + dt * 1.8); const idx = l.mesh.geometry.index; l.mesh.geometry.setDrawRange(0, Math.floor((idx ? idx.count : l.mesh.geometry.attributes.position.count) * l.grow / 3) * 3); if (l.grow >= 1) for (const e of l.extra) e.visible = true; }
 const powered = new Set<string>();
  for (const b of g.world.base.buildings) if ((telemetry.supply.get(b.id) ?? 0) > 0) for (const id of poweredComponent(g, b.id)) powered.add(id);
  for (const l of lines) {
   const link = g.world.base.links.find(v => v.id === l.id); if (!link) continue;
   const live = l.kind === 'cable' ? powered.has(link.from) && powered.has(link.to) : (telemetry.gas.get(l.id) ?? 0) > 0;
   l.mesh.material = l.kind === 'cable' ? (live ? cableLive : cableMat) : (live ? pipeLive : pipeMat);
  }
 }
 /** Smoke, exhaust, steam and airlock hiss from working stations, rate-limited per station. */
 const local = new THREE.Vector3();
 function emitFrom(g: GameState, b: Building, dt: number) {
  const left = (puff.get(b.id) ?? Math.random() * .3) - dt; if (left > 0) { puff.set(b.id, left); return; }
  const look = stationLook(g, b), world = (x: number, y: number, z: number) => { local.set(x, y, z).applyAxisAngle(UP, b.rot * Math.PI / 2); return [b.x + local.x, b.y + local.y, b.z + local.z] as const; };
  let next = .35;
  if (b.kind === 'kiln' && look.working) { const [x, y, z] = world(.2, 2.12, -.18); fx!.smoke(x, y, z); if (Math.random() < .5) { const [ex, ey, ez] = world(0, .45, .48); fx!.ember(ex, ey, ez); } next = .28; }
  else if (b.kind === 'biogenerator' && look.working) { const [x, y, z] = world(.3, 1.36, -.24); fx!.smoke(x, y, z, true); next = .32; }
  else if (b.kind === 'electrolyzer' && look.working) { const [x, y, z] = world(.3, 1.2, -.24); fx!.steam(x, y, z); next = .45; }
  else if (b.kind === 'dome' && g.world.base.passage?.domeId === b.id) { const [x, y, z] = world(0, 1.2, 2.75); fx!.hiss(x, y, z); next = .25; }
  else next = .6;
  puff.set(b.id, next);
 }
 /** Newly placed station drops in with a short settle animation. */
 function celebrate(id: string) { born.set(id, 0); }
 return { sync, reset, update, celebrate, root, tankFull: (t: { itemId: string; milliGU?: number }) => (t.milliGU ?? 0) >= TANKS[t.itemId].capacity };
}
