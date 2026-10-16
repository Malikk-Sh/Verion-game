import { LANDMARKS, MIN, MAX, SIZE } from '../world';
import { NODES, GRASS_PATCHES, bodyHalf, depositById, depositLeft, isVeinId, veinNode } from '../game/resources';
import { stationStatus, type Tone } from '../game/stationStatus';
import { endpoint } from '../game/production';
import { stationName, stationRadius, nodeRadius, clampWaypoint, doorTarget, type Waypoint } from '../game/navigation';
import { allRooms, cellKey, cellOf, doorRooms, habitableQ, habitableRoom, roomsView, type RoomInfo } from '../game/rooms';
import { reducedMotion } from '../motion';
import { itemName } from '../game/mining';
import type { GameState } from '../game/state';
import { toScreen, toWorld, clampView, zoomAt, panBy, fitView, valleyZoom, hitTest, cullLabels, clusterDeposits, directionName, rasterSize, buildRasterRows, type View, type Hit, type DepositCluster } from './mapView';
/**
 * Full-screen live map (S4, D34). The clock keeps running (SYSTEMS §1), so the header repeats O₂ and health.
 * Pan by dragging, pinch / wheel / double-tap to zoom, «+», «−», «Ко мне», «Весь участок»; a tap opens a card with
 * «Вести»; a long press on empty ground sets the player's «Метка». Markers keep a constant screen size and labels are
 * culled. The overlay redraws on interaction and at ~4 Hz while open; the relief raster is built once in slices.
 */
export type MapFootprint = { x: number; z: number; w: number; d: number; rot: number; tone: Tone; label?: string; id?: string };
/** Extra outlines drawn under the stations layer (glass rooms register below). A print with an id opens a card. */
export const mapFootprintSources: ((g: GameState) => MapFootprint[])[] = [];
/** Glass structures (D31) as outlines: glass and airlock columns joined by sides or corners, one box per group with the
 *  rooms its own blocks enclose (a face of one of its cells borders the room's air; a box merely overlapping another
 *  shell's rooms does not borrow their air). The geometry is cached per glass layout; the tone is read live (the air changes every tick). */
const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
const SHAPES = new WeakMap<object, { x: number; z: number; w: number; d: number; rooms: number[] }[]>();
function glassShapes(g: GameState) {
 const v = roomsView(g.world.base), hit = SHAPES.get(v); if (hit) return hit;
 const cols = new Map<string, number[]>(), add = (key: number) => { const c = cellOf(key), k = c.i + ',' + c.j; let l = cols.get(k); if (!l) cols.set(k, l = []); l.push(key); };
 for (const key of v.glass) add(key);
 for (const key of v.doorAt.keys()) add(key);
 const out: { x: number; z: number; w: number; d: number; rooms: number[] }[] = [], seen = new Set<string>();
 for (const start of cols.keys()) {
  if (seen.has(start)) continue; seen.add(start); const todo = [start]; let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity; const near = new Set<number>();
  while (todo.length) { const col = todo.pop()!, [i, j] = col.split(',').map(Number);
   for (const key of cols.get(col)!) { const c = cellOf(key); for (const [a, k, b] of FACES) { const r = v.tag.get(cellKey(c.i + a, c.k + k, c.j + b)); if (r !== undefined && r >= 0) near.add(r); } } i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
   for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const k = (i + a) + ',' + (j + b); if (cols.has(k) && !seen.has(k)) { seen.add(k); todo.push(k); } } }
  const rooms = [...near].sort((a, b) => a - b);
  out.push({ x: (i0 + i1 + 1) / 2, z: (j0 + j1 + 1) / 2, w: i1 - i0 + 1, d: j1 - j0 + 1, rooms });
 }
 SHAPES.set(v, out); return out;
}
/** Habitable air → «работает», a closed room still short of air → «нужна помощь», open glass → «выключена». */
const roomTone = (rooms: (RoomInfo | null | undefined)[]): Tone => rooms.some(r => r && habitableRoom(r)) ? 'ok' : rooms.some(r => r) ? 'warn' : 'off';
/** A structure is «работает» only when every room it encloses is habitable: a new empty shell next to a full room shows «нужна помощь». */
const groupTone = (rooms: (RoomInfo | null | undefined)[]): Tone => { const r = rooms.filter(Boolean) as RoomInfo[]; return !r.length ? 'off' : r.every(habitableRoom) ? 'ok' : 'warn'; };
export function glassPrints(g: GameState): MapFootprint[] {
 const shapes = glassShapes(g); if (!shapes.length) return [];
 const info = allRooms(g), out: MapFootprint[] = shapes.map(s => ({ x: s.x, z: s.z, w: s.w, d: s.d, rot: 0, tone: groupTone(s.rooms.map(i => info[i])) }));
 for (const d of g.world.base.doors) { const r = doorRooms(g, d), t = doorTarget(d); out.push({ id: d.id, x: t.x, z: t.z, w: 1, d: 1, rot: 0, tone: roomTone([r.front, r.back]), label: t.name }); }
 return out;
}
mapFootprintSources.push(glassPrints);
type Layer = 'places' | 'resources' | 'stations';
type Card = { kind: 'landmark' | 'node' | 'station' | 'drop' | 'point'; id: string; ids?: string[] };
type Deps = {
 game: () => GameState | null;
 player: () => { x: number; z: number; yaw: number };
 selected: () => string; waypoint: () => Waypoint | null;
 target: () => { name: string; x: number; z: number; radius: number } | null;
 guide: () => { title: string; task: string; target: { name: string; x: number; z: number } | null };
 visited: ReadonlySet<string>; discovered: ReadonlySet<string>;
 vitals: () => { o2: number; unit: string; o2Low: boolean; hp: number; hpLow: boolean };
 lead: (id: string) => void; leadGuide: () => void; setWaypoint: (p: Waypoint | null) => void; tone: () => void;
};
const MAT: Record<string, { glyph: string; color: string; name: string }> = {
 iron: { glyph: 'Fe', color: '#d39462', name: 'Железная руда' }, copper: { glyph: 'Cu', color: '#53cfa4', name: 'Медная руда' }, stone: { glyph: 'К', color: '#c3bfb2', name: 'Камень' },
 sand: { glyph: 'П', color: '#e6c97c', name: 'Песок' }, ice: { glyph: 'Л', color: '#a6dcff', name: 'Лёд' }, grass: { glyph: 'Т', color: '#93d86c', name: 'Трава' },
};
const TONE: Record<Tone, string> = { ok: '#5fe3a1', idle: '#a9c2bd', warn: '#ffb43c', off: '#6b7877' };
const TONE_NAME: Record<Tone, string> = { ok: 'работает', idle: 'ждёт', warn: 'нужна помощь', off: 'выключена' };
const LAYERS: Layer[] = ['places', 'resources', 'stations'];
const CELL = 1, LONG_MS = 550, TICK_MS = 250, MONO = '600 10px ui-monospace,monospace';
type Lbl = { id: string; text: string; sub?: string; color: string; priority: number; cx: number; y: number; small?: boolean };
const font = (l: Lbl) => l.small ? MONO : l.sub ? '700 11px system-ui,sans-serif' : '600 11px system-ui,sans-serif';
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (m: number) => `${Math.round(m)} м`;
function loadLayers(): Record<Layer, boolean> {
 const all = { places: true, resources: true, stations: true };
 try { const s = JSON.parse(localStorage.getItem('vireon.settings.map') || '{}'); for (const k of LAYERS) if (typeof s?.[k] === 'boolean') all[k] = s[k]; } catch { /* optional */ }
 return all;
}
export function createMap(d: Deps) {
 const host = el('map-view'), canvas = el<HTMLCanvasElement>('map'), ctx = canvas.getContext('2d')!;
 const layers = loadLayers();
 let w = 0, h = 0, dpr = 1, view: View = { cx: 40, cz: 40, zoom: 2 }, chosenZoom: number | null = null, card: Card | null = null, dirty = true, lastDraw = -Infinity, open = false;
 let anim: { from: View; to: View; t0: number } | null = null, hits: (Hit & { card: Card })[] = [], labelCount = 0, markerCount = 0, draws = 0, veinMarks = 0, glassMarks: Tone[] = [];
 // ---------- Relief raster: built in slices at idle, drawn under a transform ----------
 const N = rasterSize(CELL), raster = document.createElement('canvas'); raster.width = raster.height = N;
 const rctx = raster.getContext('2d')!, image = rctx.createImageData(N, N);
 let rows = 0, heightFn: ((x: number, z: number) => number) | null = null;
 function buildSlice(budgetMs: number) {
  if (!heightFn || rows >= N) return; const t0 = performance.now(), from = rows;
  while (rows < N && performance.now() - t0 < budgetMs) { buildRasterRows(image.data, heightFn, CELL, rows, rows + 8); rows = Math.min(N, rows + 8); }
  rctx.putImageData(image, 0, 0, 0, from, N, rows - from); dirty = true;
 }
 function prepare(heightAt: (x: number, z: number) => number) {
  heightFn = heightAt; const step = () => { buildSlice(8); if (rows < N) setTimeout(step, 30); }; setTimeout(step, 0);
 }
 // ---------- Layout and view ----------
 function resize() {
  // Layout size, not the bounding box: the panel opens at scale(.98), and pointer positions are rescaled in `local`.
  if (host.clientWidth < 2 || host.clientHeight < 2) return;
  w = host.clientWidth; h = host.clientHeight; dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); view = clampView(view, w, h); dirty = true;
 }
 const setView = (v: View, animate = false) => {
  const to = clampView(v, w, h); chosenZoom = to.zoom;
  if (animate && !reducedMotion()) anim = { from: { ...view }, to, t0: performance.now() }; else { anim = null; view = to; }
  dirty = true;
 };
 const centre = () => { const p = d.player(); setView({ cx: p.x, cz: p.z, zoom: view.zoom }, true); };
 const zoomBy = (f: number, sx = w / 2, sy = h / 2) => setView(zoomAt(view, w, h, sx, sy, f));
 // ---------- Cards and the drawer list ----------
 const drawer = el('map-drawer'), card$ = el('map-card'), list$ = el('landmark-list'), go = el<HTMLButtonElement>('map-go'), remove = el<HTMLButtonElement>('map-remove');
 function cardTarget(c: Card): { name: string; x: number; z: number; radius: number } | null {
  const g = d.game(); if (!g) return null;
  if (c.kind === 'point') { const p = d.waypoint(); return p ? { name: 'Метка', x: p.x, z: p.z, radius: 3 } : null; }
  if (c.kind === 'landmark') { const l = LANDMARKS.find(v => v.id === c.id); return l ? { name: l.name, x: l.x, z: l.z, radius: l.radius } : null; }
  if (c.kind === 'node') { const n = depositById(g, c.id); return n ? { name: n.name, x: n.x, z: n.z, radius: nodeRadius(n) } : null; }
  if (c.kind === 'station') { const b = g.world.base.buildings.find(v => v.id === c.id), door = b ? null : g.world.base.doors.find(v => v.id === c.id); return b ? { name: stationName(b), x: b.x, z: b.z, radius: stationRadius(b) } : door ? doorTarget(door) : null; }
  const dr = g.world.drops.find(v => v.id === c.id); return dr ? { name: 'Груз', x: dr.x, z: dr.z, radius: 2.2 } : null;
 }
 function showCard(c: Card | null, focusMap = false) {
  card = c; card$.hidden = !c; list$.hidden = !!c; el('map-legend').hidden = !!c; drawer.scrollTop = 0; dirty = true;
  if (c) { const t = cardTarget(c); if (t && focusMap) setView({ cx: t.x, cz: t.z, zoom: view.zoom }, true); updateCard(); }
  else updateList(true);
 }
 function row(k: string, v: string) { const div = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; div.append(dt, dd); return div; }
 function updateCard() {
  const g = d.game(); if (!card || !g) return;
  const p = d.player(), t = cardTarget(card);
  if (!t) { showCard(null); return; }
  const dist = Math.hypot(t.x - p.x, t.z - p.z), data: [string, string][] = [['Расстояние', fmt(dist)], ['Направление', directionName(t.x - p.x, t.z - p.z)]];
  let kind = '', title = t.name, text = '', canGo = true;
  if (card.kind === 'landmark') {
   const l = LANDMARKS.find(v => v.id === card!.id)!; kind = l.kind; text = l.description;
   data.push(['Состояние', d.visited.has(l.id) ? 'Просканировано' : d.discovered.has(l.id) ? 'Найдено' : 'Не найдено']);
  } else if (card.kind === 'node') {
   const ids = card.ids ?? [card.id], n = depositById(g, card.id)!, left = ids.reduce((s, id) => s + depositLeft(g, id), 0), amount = ids.reduce((s, id) => s + (depositById(g, id)?.amount ?? 0), 0);
   kind = (isVeinId(n.id) ? 'Новая жила · ' : 'Залежь · ') + MAT[n.material].name.toLowerCase(); text = left > 0 ? `Осталось ${left} / ${amount}${ids.length > 1 ? ` · ${ids.length} выхода рядом` : ''}` : n.regrowSeconds ? 'Всё собрано — растения отрастают в активное время.' : 'Запас исчерпан.';
   if (n.regrowSeconds) data.push(['Отрастает', `1 растение за ${n.regrowSeconds} с`]);
   data.push(['Добыча', itemName(n.itemId)]); canGo = left > 0;
  } else if (card.kind === 'station' && card.id.startsWith('door-')) {
   // An airlock stands for its glass room: the room behind it (or in front), its volume and air.
   const door = g.world.base.doors.find(v => v.id === card!.id)!, sides = doorRooms(g, door), r = sides.back ?? sides.front;
   kind = 'Помещение · ' + (r ? habitableRoom(r) ? 'пригодно для дыхания' : 'мало воздуха' : 'не замкнуто');
   text = r ? `Стеклянное помещение со шлюзом. Пройти: наведите на шлюз и нажмите F.` : 'Шлюз стоит в стене, но помещение за ним не замкнуто.';
   if (r) data.push(['Объём', `${r.volume} м³`], ['Воздух', `${Math.floor(r.zone.q / 1000)} / ${habitableQ(r.volume) / 1000} GU`]);
  } else if (card.kind === 'station') {
   const b = g.world.base.buildings.find(v => v.id === card!.id)!, st = stationStatus(g, b); kind = 'Станция · ' + TONE_NAME[st.tone]; text = `${st.title}. ${st.hint}`;
  } else if (card.kind === 'drop') {
   const dr = g.world.drops.find(v => v.id === card!.id)!, n = dr.items.reduce((s, v) => s + v.count, 0); kind = 'Груз на земле'; text = `${n} предм. Подойдите и нажмите «Поднять».`;
  } else { kind = 'Ваша метка'; text = 'Метка ставится долгим нажатием на карту.'; data.push(['Координаты', `${Math.round(t.x)} · ${Math.round(t.z)}`]); }
  const here = dist < t.radius, leading = d.selected() === (card.kind === 'point' ? 'point' : card.id);
  el('map-card-kind').textContent = kind; el('map-card-title').textContent = title; el('map-card-text').textContent = text;
  const dl = el('map-card-data'), key = JSON.stringify(data); if (dl.dataset.key !== key) { dl.dataset.key = key; dl.replaceChildren(...data.map(([k, v]) => row(k, v))); }
  go.disabled = !canGo || here; const label = here ? 'Вы здесь' : !canGo ? 'Нечего вести' : leading ? 'Ведём · закрыть' : 'Вести';
  if (go.textContent !== label) go.textContent = label; go.setAttribute('aria-label', `${label}: ${title}`);
  remove.hidden = card.kind !== 'point';
 }
 let listKey = '';
 function updateList(force = false) {
  const p = d.player(), gd = d.guide(), sel = d.selected(), wp = d.waypoint();
  const key = [sel, !!wp, LANDMARKS.map(l => (d.visited.has(l.id) ? 2 : d.discovered.has(l.id) ? 1 : 0)).join('')].join('|');
  if (force || key !== listKey) {
   listKey = key;
   const guide = document.createElement('button'); guide.className = 'landmark-guide'; guide.id = 'map-guide-row'; guide.setAttribute('aria-pressed', String(sel === 'guide'));
   guide.innerHTML = '<b>Цель журнала</b><small data-guide></small><span aria-hidden="true">◆</span>'; guide.onclick = () => d.leadGuide();
   const items: HTMLElement[] = [guide];
   if (wp) { const b = document.createElement('button'); b.className = 'map-row-point'; b.setAttribute('aria-label', 'Метка'); b.setAttribute('aria-pressed', String(sel === 'point')); b.innerHTML = '<b>Метка</b><small data-x="' + wp.x + '" data-z="' + wp.z + '"></small><span aria-hidden="true">⌖</span>'; b.onclick = () => { d.tone(); showCard({ kind: 'point', id: 'point' }, true); }; items.push(b); }
   const head = document.createElement('p'); head.className = 'map-list-head mono tiny'; head.textContent = 'Места'; items.push(head);
   // Sorted by distance when the list is built; distances update in place so rows never move under a finger.
   for (const l of [...LANDMARKS].sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))) {
    const b = document.createElement('button'), name = document.createElement('b'), meta = document.createElement('small'), mark = document.createElement('span');
    name.textContent = l.name; meta.dataset.x = String(l.x); meta.dataset.z = String(l.z); mark.textContent = d.visited.has(l.id) ? '✓' : d.discovered.has(l.id) ? '◆' : '◇'; mark.setAttribute('aria-hidden', 'true');
    b.append(name, meta, mark); b.setAttribute('aria-label', l.name); b.setAttribute('aria-pressed', String(l.id === sel)); b.dataset.landmark = l.id;
    b.onclick = () => { d.tone(); showCard({ kind: 'landmark', id: l.id }, true); }; items.push(b);
   }
   list$.replaceChildren(...items);
  }
  for (const s of list$.querySelectorAll<HTMLElement>('small[data-x]')) { const t = fmt(Math.hypot(Number(s.dataset.x) - p.x, Number(s.dataset.z) - p.z)); if (s.textContent !== t) s.textContent = t; }
  const gs = list$.querySelector<HTMLElement>('[data-guide]'); if (gs) { const t = gd.target ? `${gd.title} · ${gd.target.name} · ${fmt(Math.hypot(gd.target.x - p.x, gd.target.z - p.z))}` : gd.title || 'Вести по текущему шагу'; if (gs.textContent !== t) gs.textContent = t; }
 }
 // ---------- Drawing ----------
 const scaleStep = (z: number) => [10, 20, 50, 100, 200].find(m => m * z >= 48) ?? 200;
 function diamond(x: number, y: number, r: number, fill: string | null, stroke: string) { ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
 function clusters(g: GameState): DepositCluster[] {
  // A worked-out finite deposit is gone from the world and never refills (a new vein replaces it, D33): it leaves the map too;
  // grass stays, it grows back.
  return clusterDeposits(NODES.map(n => ({ id: n.id, material: n.material, x: n.x, z: n.z, left: g.world.nodes[n.id] ?? 0, amount: n.amount })).filter(n => n.material === 'grass' || n.left > 0), Math.max(3, 18 / view.zoom));
 }
 function draw(now: number) {
  const g = d.game(); if (!g || !w) return;
  if (anim) { const k = Math.min(1, (now - anim.t0) / 300), e = k * k * (3 - 2 * k); view = { cx: anim.from.cx + (anim.to.cx - anim.from.cx) * e, cz: anim.from.cz + (anim.to.cz - anim.from.cz) * e, zoom: anim.from.zoom + (anim.to.zoom - anim.from.zoom) * e }; if (k >= 1) anim = null; }
  draws++; dirty = false; lastDraw = now; hits = []; veinMarks = 0; glassMarks = []; const labels: Lbl[] = [];
  const S = (x: number, z: number) => toScreen(view, w, h, x, z), z = view.zoom, p = d.player(), pp = S(p.x, p.z);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#061518'; ctx.fillRect(0, 0, w, h);
  const tl = S(MAX, MAX); ctx.imageSmoothingEnabled = true; ctx.drawImage(raster, tl.x, tl.y, SIZE * z, SIZE * z);
  ctx.strokeStyle = 'rgba(127,230,218,.12)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let v = MIN; v <= MAX; v += 80) { const a = S(v, MIN), b = S(v, MAX), c = S(MIN, v), e = S(MAX, v); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.moveTo(c.x, c.y); ctx.lineTo(e.x, e.y); }
  ctx.stroke();
  if (z < 2.4) { const a = S(160, 160); ctx.strokeStyle = 'rgba(242,180,96,.4)'; ctx.setLineDash([3, 5]); ctx.strokeRect(a.x, a.y, 160 * z, 160 * z); ctx.setLineDash([]); ctx.font = '600 10px ui-monospace,monospace'; ctx.fillStyle = 'rgba(242,180,96,.75)'; ctx.textAlign = 'left'; ctx.fillText('ДОЛИНА ПРИБЫТИЯ', a.x + 4, a.y + 13); }
  let markers = 0;
  // Stations: real footprints tinted by status, links as thin lines; extra outlines (glass rooms) from the hook.
  if (layers.stations) {
   const base = g.world.base;
   for (const l of base.links) { const a = endpoint(g, l.from), b = endpoint(g, l.to); if (!a || !b) continue; const s = S(a.x, a.z), e = S(b.x, b.z); ctx.strokeStyle = l.kind === 'cable' ? 'rgba(255,196,110,.75)' : 'rgba(127,230,218,.8)'; ctx.lineWidth = 1.5; ctx.setLineDash(l.kind === 'cable' ? [] : [4, 3]); ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke(); }
   ctx.setLineDash([]);
   const prints: MapFootprint[] = [...mapFootprintSources.flatMap(f => f(g))]; glassMarks = prints.map(f => f.tone);
   for (const b of base.buildings) { const half = bodyHalf(b.kind); prints.push({ id: b.id, x: b.x, z: b.z, w: half * 2, d: half * 2, rot: b.rot, tone: stationStatus(g, b).tone, label: stationName(b) }); }
   for (const f of prints) {
    const s = S(f.x, f.z), fw = Math.max(10, f.w * z), fd = Math.max(10, f.d * z), c = TONE[f.tone]; markers++;
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(-f.rot * Math.PI / 2); ctx.fillStyle = c + '55'; ctx.fillRect(-fw / 2, -fd / 2, fw, fd); ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.strokeRect(-fw / 2, -fd / 2, fw, fd); ctx.restore();
    if (f.id) { hits.push({ id: f.id, x: s.x, y: s.y, priority: 40, card: { kind: 'station', id: f.id } }); if (f.label) labels.push({ id: f.id, text: f.label, color: '#d7f3ee', priority: 40 + (f.tone === 'warn' ? 5 : 0), cx: s.x, y: s.y + Math.max(fd / 2, 6) + 2 }); }
   }
  }
  if (layers.resources) {
   ctx.fillStyle = 'rgba(147,216,108,.28)'; ctx.strokeStyle = 'rgba(147,216,108,.6)'; ctx.lineWidth = 1;
   for (const gp of GRASS_PATCHES) { const s = S(gp.x, gp.z); ctx.beginPath(); ctx.ellipse(s.x, s.y, Math.max(3, gp.rx * z), Math.max(3, gp.rz * z), 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
   ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
   for (const c of clusters(g)) {
    const s = S(c.x, c.z), m = MAT[c.material], empty = c.left <= 0, r = 8; markers++;
    if (s.x < -20 || s.y < -20 || s.x > w + 20 || s.y > h + 20) continue;
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fillStyle = empty ? 'rgba(6,21,24,.85)' : m.color; ctx.fill(); ctx.strokeStyle = empty ? 'rgba(170,185,182,.8)' : 'rgba(6,21,24,.9)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = '700 9px system-ui,sans-serif'; ctx.fillStyle = empty ? 'rgba(170,185,182,.9)' : '#0a1a1c'; ctx.fillText(m.glyph, s.x, s.y + .5);
    const lead = c.ids.slice().sort((a, b) => (g.world.nodes[b] ?? 0) - (g.world.nodes[a] ?? 0))[0];
    hits.push({ id: lead, x: s.x, y: s.y, priority: 20, card: { kind: 'node', id: lead, ids: c.ids } });
    if (z >= 2.2) labels.push({ id: lead, text: empty ? 'пусто' : String(c.left), color: empty ? '#9aa9a6' : m.color, priority: 20, cx: s.x, y: s.y + r + 2, small: true });
   }
   // S4 (D33): new veins stand apart from the clusters, with a halo and the «Новая жила» label.
   for (const v of g.world.veins) {
    const n = veinNode(v), s = S(n.x, n.z), m = MAT[v.material], r = 8; markers++; veinMarks++;
    if (s.x < -20 || s.y < -20 || s.x > w + 20 || s.y > h + 20) continue;
    ctx.beginPath(); ctx.arc(s.x, s.y, r + 4, 0, Math.PI * 2); ctx.strokeStyle = m.color; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fillStyle = m.color; ctx.fill(); ctx.strokeStyle = 'rgba(6,21,24,.9)'; ctx.stroke();
    ctx.font = '700 9px system-ui,sans-serif'; ctx.fillStyle = '#0a1a1c'; ctx.fillText(m.glyph, s.x, s.y + .5);
    hits.push({ id: v.id, x: s.x, y: s.y, priority: 30, card: { kind: 'node', id: v.id } });
    labels.push({ id: v.id, text: 'Новая жила', sub: z >= 2.2 ? String(v.amount) : undefined, color: m.color, priority: 30, cx: s.x, y: s.y + r + 6 });
   }
   ctx.textBaseline = 'alphabetic';
  }
  if (layers.places) for (const l of LANDMARKS) {
   const s = S(l.x, l.z), seen = d.discovered.has(l.id), scanned = d.visited.has(l.id); markers++;
   if (l.id === 'capsule') { ctx.beginPath(); ctx.moveTo(s.x, s.y - 8); ctx.lineTo(s.x + 7, s.y - 1); ctx.lineTo(s.x + 5, s.y - 1); ctx.lineTo(s.x + 5, s.y + 6); ctx.lineTo(s.x - 5, s.y + 6); ctx.lineTo(s.x - 5, s.y - 1); ctx.lineTo(s.x - 7, s.y - 1); ctx.closePath(); ctx.fillStyle = '#f7e2bd'; ctx.fill(); ctx.strokeStyle = '#061518'; ctx.lineWidth = 1.2; ctx.stroke(); }
   else { diamond(s.x, s.y, 6, seen ? '#7fe6da' : 'rgba(6,21,24,.7)', seen ? '#061518' : '#bfeee6'); if (scanned) { ctx.strokeStyle = '#061518'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(s.x - 3, s.y); ctx.lineTo(s.x - 1, s.y + 2.2); ctx.lineTo(s.x + 3, s.y - 2); ctx.stroke(); } }
   hits.push({ id: l.id, x: s.x, y: s.y, priority: l.id === 'capsule' ? 80 : 60, card: { kind: 'landmark', id: l.id } });
   labels.push({ id: l.id, text: l.name, color: l.id === 'capsule' ? '#f7e2bd' : seen ? '#d7f3ee' : 'rgba(215,236,230,.7)', priority: l.id === 'capsule' ? 80 : seen ? 60 : 50, cx: s.x, y: s.y - 22 });
  }
  // Cargo, the player's mark, the target and the player are drawn on every layer setting.
  for (const dr of g.world.drops) { const s = S(dr.x, dr.z); markers++; ctx.fillStyle = '#e58a3a'; ctx.strokeStyle = '#061518'; ctx.lineWidth = 1.5; ctx.fillRect(s.x - 5, s.y - 5, 10, 10); ctx.strokeRect(s.x - 5, s.y - 5, 10, 10); hits.push({ id: dr.id, x: s.x, y: s.y, priority: 45, card: { kind: 'drop', id: dr.id } }); labels.push({ id: dr.id, text: 'Груз', color: '#ffc58a', priority: 45, cx: s.x, y: s.y + 8 }); }
  const wp = d.waypoint();
  if (wp) { const s = S(wp.x, wp.z); markers++; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, Math.PI * 2); ctx.moveTo(s.x - 11, s.y); ctx.lineTo(s.x - 4, s.y); ctx.moveTo(s.x + 4, s.y); ctx.lineTo(s.x + 11, s.y); ctx.moveTo(s.x, s.y - 11); ctx.lineTo(s.x, s.y - 4); ctx.moveTo(s.x, s.y + 4); ctx.lineTo(s.x, s.y + 11); ctx.stroke(); hits.push({ id: 'point', x: s.x, y: s.y, priority: 70, card: { kind: 'point', id: 'point' } }); labels.push({ id: 'point', text: 'Метка', color: '#ffffff', priority: 70, cx: s.x, y: s.y + 13 }); }
  const t = d.target();
  if (t) {
   const s = S(t.x, t.z), pulse = reducedMotion() ? 0 : (now % 2000) / 2000;
   ctx.strokeStyle = 'rgba(255,180,60,.85)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(pp.x, pp.y); ctx.lineTo(s.x, s.y); ctx.stroke(); ctx.setLineDash([]);
   ctx.beginPath(); ctx.arc(s.x, s.y, 13, 0, Math.PI * 2); ctx.stroke();
   if (pulse) { ctx.strokeStyle = `rgba(255,180,60,${(1 - pulse) * .7})`; ctx.beginPath(); ctx.arc(s.x, s.y, 13 + pulse * 12, 0, Math.PI * 2); ctx.stroke(); }
   labels.push({ id: 'target', text: t.name, sub: fmt(Math.hypot(t.x - p.x, t.z - p.z)), color: '#ffb43c', priority: 100, cx: s.x, y: s.y - 40 });
  }
  if (card) { const c = cardTarget(card); if (c) { const s = S(c.x, c.z); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(s.x, s.y, 16, 0, Math.PI * 2); ctx.stroke(); for (const l of labels) if (l.id === card.id) l.priority = 90; } }
  ctx.save(); ctx.translate(pp.x, pp.y); ctx.rotate(-p.yaw);
  ctx.fillStyle = 'rgba(127,230,218,.2)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 38, -Math.PI / 2 - .6, -Math.PI / 2 + .6); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(6.5, 7); ctx.lineTo(0, 4); ctx.lineTo(-6.5, 7); ctx.closePath(); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = '#061518'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.restore();
  // Labels: target, selection and capsule first; a label that would overlap a kept one is dropped.
  const boxes = labels.map(l => { ctx.font = font(l); let bw = ctx.measureText(l.text).width; if (l.sub) { ctx.font = MONO; bw = Math.max(bw, ctx.measureText(l.sub).width); } bw += 8; return { ...l, x: l.cx - bw / 2, w: bw, h: l.sub ? 28 : l.small ? 14 : 16 }; });
  const kept = cullLabels(boxes, w, h); labelCount = kept.length;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const l of kept) {
   ctx.fillStyle = 'rgba(4,14,16,.72)'; ctx.fillRect(l.x, l.y, l.w, l.h);
   ctx.font = font(l); ctx.fillStyle = l.color; ctx.fillText(l.text, l.x + l.w / 2, l.y + 2);
   if (l.sub) { ctx.font = MONO; ctx.fillText(l.sub, l.x + l.w / 2, l.y + 15); }
  }
  ctx.textBaseline = 'alphabetic';
  // North and the scale bar.
  ctx.font = '600 11px ui-monospace,monospace'; ctx.fillStyle = 'rgba(215,236,230,.85)'; ctx.textAlign = 'left'; ctx.fillText('С ↑', 10, 18);
  const m = scaleStep(z), bw = m * z; ctx.fillRect(10, h - 12, bw, 2); ctx.fillRect(10, h - 16, 1.5, 6); ctx.fillRect(10 + bw - 1.5, h - 16, 1.5, 6); ctx.fillText(`${m} м`, 14 + bw, h - 8);
  markerCount = markers;
 }
 // ---------- Pointer gestures on the map ----------
 const pts = new Map<number, { x: number; y: number }>();
 let start: { x: number; y: number; t: number } | null = null, moved = false, longFired = false, longTimer = 0, pinch: { dist: number; mid: { x: number; y: number }; view: View } | null = null, lastTap = { t: -1e9, x: 0, y: 0 }, multi = false;
 const local = (e: PointerEvent | WheelEvent) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (w / (r.width || 1)), y: (e.clientY - r.top) * (h / (r.height || 1)) }; };
 const pinchState = () => { const [a, b] = [...pts.values()]; return { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; };
 function longPress() {
  if (!start || moved || pts.size !== 1) return; longFired = true;
  const hit = hitTest(hits, start.x, start.y); if (hit) { d.tone(); showCard(hit.card); return; }
  const q = toWorld(view, w, h, start.x, start.y); d.setWaypoint(clampWaypoint(q.x, q.z)); d.tone(); showCard({ kind: 'point', id: 'point' });
 }
 canvas.addEventListener('pointerdown', e => {
  e.preventDefault(); try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
  const q = local(e); pts.set(e.pointerId, q); anim = null;
  if (pts.size === 1) { start = { ...q, t: performance.now() }; moved = longFired = multi = false; clearTimeout(longTimer); longTimer = window.setTimeout(longPress, LONG_MS); }
  else if (pts.size === 2) { clearTimeout(longTimer); multi = true; pinch = { ...pinchState(), view: { ...view } }; }
 });
 canvas.addEventListener('pointermove', e => {
  const prev = pts.get(e.pointerId); if (!prev) return; const q = local(e); pts.set(e.pointerId, q);
  if (pts.size >= 2 && pinch) { const s = pinchState(); view = clampView(panBy(zoomAt(pinch.view, w, h, pinch.mid.x, pinch.mid.y, s.dist / pinch.dist), s.mid.x - pinch.mid.x, s.mid.y - pinch.mid.y), w, h); chosenZoom = view.zoom; dirty = true; return; }
  if (!start) return;
  if (!moved && Math.hypot(q.x - start.x, q.y - start.y) > 6) { moved = true; clearTimeout(longTimer); }
  if (moved && !multi) { view = clampView(panBy(view, q.x - prev.x, q.y - prev.y), w, h); dirty = true; }
 });
 const end = (e: PointerEvent) => {
  if (!pts.has(e.pointerId)) return; const q = pts.get(e.pointerId)!; pts.delete(e.pointerId); clearTimeout(longTimer);
  if (pts.size === 1) { pinch = null; const [o] = [...pts.values()]; start = { ...o, t: performance.now() }; moved = true; return; }
  if (pts.size) return;
  pinch = null;
  if (e.type === 'pointerup' && start && !moved && !longFired && !multi) tap(q.x, q.y);
  start = null;
 };
 for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, end as EventListener);
 function tap(x: number, y: number) {
  const now = performance.now(), double = now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 24; lastTap = { t: double ? -1e9 : now, x, y };
  if (double) { zoomBy(2, x, y); return; }
  const hit = hitTest(hits, x, y); if (hit) { d.tone(); showCard(hit.card); } else if (card) showCard(null);
 }
 // A long press must not open the browser's context menu or text callout over the map.
 canvas.addEventListener('contextmenu', e => e.preventDefault());
 canvas.addEventListener('wheel', e => { e.preventDefault(); const q = local(e); zoomBy(Math.exp(-e.deltaY * .0015), q.x, q.y); }, { passive: false });
 el('map-zoom-in').onclick = () => { d.tone(); zoomBy(1.6); };
 el('map-zoom-out').onclick = () => { d.tone(); zoomBy(1 / 1.6); };
 el('map-center').onclick = () => { d.tone(); centre(); };
 el('map-fit').onclick = () => { d.tone(); setView(fitView(w, h), true); };
 for (const k of LAYERS) { const b = el(`map-layer-${k}`); b.setAttribute('aria-pressed', String(layers[k])); b.onclick = () => { layers[k] = !layers[k]; b.setAttribute('aria-pressed', String(layers[k])); try { localStorage.setItem('vireon.settings.map', JSON.stringify(layers)); } catch { /* optional */ } d.tone(); dirty = true; }; }
 go.onclick = () => { if (!card || go.disabled) return; d.lead(card.kind === 'point' ? 'point' : card.kind === 'node' ? firstLive(card) : card.id); };
 el('map-guide').onclick = () => d.leadGuide();
 remove.onclick = () => { d.setWaypoint(null); d.tone(); showCard(null); };
 el('map-back').onclick = () => { d.tone(); showCard(null); };
 function firstLive(c: Card) { const g = d.game()!, p = d.player(); return (c.ids ?? [c.id]).filter(id => depositLeft(g, id) > 0).sort((a, b) => { const A = depositById(g, a)!, B = depositById(g, b)!; return Math.hypot(A.x - p.x, A.z - p.z) - Math.hypot(B.x - p.x, B.z - p.z); })[0] ?? c.id; }
 return {
  prepare,
  open() {
   open = true; card = null; card$.hidden = true; list$.hidden = false; el('map-legend').hidden = false; drawer.scrollTop = 0; resize();
   // The relief is normally ready long before; if not, it keeps filling in (no long first-open stall).
   if (rows < N) buildSlice(24);
   const p = d.player(); view = clampView({ cx: p.x, cz: p.z, zoom: chosenZoom ?? valleyZoom(w, h) }, w, h); anim = null;
   updateList(true); updateVitals(); dirty = true; draw(performance.now());
  },
  close() { open = false; pts.clear(); clearTimeout(longTimer); anim = null; },
  resize() { if (open) { resize(); draw(performance.now()); } },
  /** Called every animation frame while the map is open: redraws on change, during a glide, or every 250 ms. */
  tick(now: number) {
   if (!open) return;
   if (rows < N && heightFn) buildSlice(6);
   if (dirty || anim || now - lastDraw >= TICK_MS) { if (now - lastDraw >= TICK_MS) { updateVitals(); updateList(); if (card) updateCard(); } draw(now); }
  },
  /** Keyboard: arrows pan, + / − zoom, 0 centres on the player. Returns whether the key was used. */
  key(e: KeyboardEvent) {
   const step = 60;
   if (e.code === 'ArrowLeft') setView(panBy(view, step, 0)); else if (e.code === 'ArrowRight') setView(panBy(view, -step, 0));
   else if (e.code === 'ArrowUp') setView(panBy(view, 0, step)); else if (e.code === 'ArrowDown') setView(panBy(view, 0, -step));
   else if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') zoomBy(1.6); else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') zoomBy(1 / 1.6);
   else if (e.code === 'Digit0' || e.code === 'Numpad0') centre(); else return false;
   return true;
  },
  showCard: (c: Card | null) => showCard(c),
  debug: () => ({ zoom: (anim?.to ?? view).zoom, center: { x: (anim?.to ?? view).cx, z: (anim?.to ?? view).cz }, layers: { ...layers }, card: card ? { kind: card.kind, id: card.id } : null, raster: rows / N, draws, markers: markerCount, veins: veinMarks, structures: glassMarks, labels: labelCount, size: { w, h, dpr, backing: canvas.width } }),
 };
 function updateVitals() {
  const v = d.vitals(), o2 = el('map-o2'), hp = el('map-hp');
  o2.querySelector('b')!.textContent = String(Math.round(v.o2)); o2.querySelector('small')!.textContent = v.unit; o2.dataset.low = String(v.o2Low);
  hp.querySelector('b')!.textContent = String(Math.round(v.hp)); hp.dataset.low = String(v.hpLow);
  o2.setAttribute('aria-label', `Кислород ${Math.round(v.o2)} ${v.unit}`); hp.setAttribute('aria-label', `Здоровье ${Math.round(v.hp)}`);
 }
}
