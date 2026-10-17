import { MIN, MAX, SIZE } from '../world';
/**
 * Pure geometry of the map viewport (S4, D34): projection, zoom about a point, hit-testing,
 * label culling, deposit clustering and the terrain raster. No DOM — unit-tested in tests/map.test.ts.
 * North is up and east is −x (as in the first-person view and the compass), so larger x is further left.
 * A view is the world point at the viewport centre and the scale in CSS px per metre.
 */
export type View = { cx: number; cz: number; zoom: number };
/** S5: 24 CSS px per metre at most — single 1 m glass blocks and station bodies read clearly. */
export const MAX_ZOOM = 24;
/** Zoom that shows the whole 560 m square with a small margin. */
export const fitZoom = (w: number, h: number) => Math.max(.05, Math.min(w, h) / (SIZE * 1.04));
/** «Долина»: 160 m fill the viewport height (the opening view), never below the whole-area zoom. */
export const valleyZoom = (w: number, h: number) => Math.min(MAX_ZOOM, Math.max(fitZoom(w, h), h / 160));
export const clampZoom = (z: number, w: number, h: number) => Math.max(fitZoom(w, h), Math.min(MAX_ZOOM, z));
export const toScreen = (v: View, w: number, h: number, x: number, z: number) => ({ x: w / 2 + (v.cx - x) * v.zoom, y: h / 2 - (z - v.cz) * v.zoom });
export const toWorld = (v: View, w: number, h: number, sx: number, sy: number) => ({ x: v.cx - (sx - w / 2) / v.zoom, z: v.cz + (h / 2 - sy) / v.zoom });
/** Keeps the centre over the walkable square (the whole square stays reachable at every zoom). */
export function clampView(v: View, w: number, h: number): View {
 const zoom = clampZoom(v.zoom, w, h), mx = Math.max(0, SIZE / 2 - w / 2 / zoom), mz = Math.max(0, SIZE / 2 - h / 2 / zoom), c = (MIN + MAX) / 2;
 return { zoom, cx: Math.max(c - mx, Math.min(c + mx, v.cx)), cz: Math.max(c - mz, Math.min(c + mz, v.cz)) };
}
/** Zooms by `factor` keeping the world point under (sx, sy) fixed (before the edge clamp). */
export function zoomAt(v: View, w: number, h: number, sx: number, sy: number, factor: number): View {
 const p = toWorld(v, w, h, sx, sy), zoom = clampZoom(v.zoom * factor, w, h);
 return { zoom, cx: p.x + (sx - w / 2) / zoom, cz: p.z - (h / 2 - sy) / zoom };
}
export const panBy = (v: View, dx: number, dy: number): View => ({ zoom: v.zoom, cx: v.cx + dx / v.zoom, cz: v.cz + dy / v.zoom });
export const fitView = (w: number, h: number): View => ({ cx: (MIN + MAX) / 2, cz: (MIN + MAX) / 2, zoom: fitZoom(w, h) });
/** A tappable marker in screen px; higher `priority` wins a tie in distance. */
export type Hit = { id: string; x: number; y: number; priority: number };
/** Tap radius ≥16 CSS px: the nearest marker wins, equal distances go to the higher priority. */
export const HIT_RADIUS = 18;
export function hitTest<T extends Hit>(items: readonly T[], sx: number, sy: number, radius = HIT_RADIUS): T | null {
 let best: T | null = null, bd = Infinity;
 for (const it of items) { const d = Math.hypot(it.x - sx, it.y - sy); if (d > radius) continue; if (d < bd - .5 || Math.abs(d - bd) <= .5 && best && it.priority > best.priority) { best = it; bd = Math.min(d, bd); } }
 return best;
}
/** Label boxes in screen px; kept greedily in priority order while they do not overlap a kept one. */
export type LabelBox = { id: string; x: number; y: number; w: number; h: number; priority: number };
export function cullLabels<T extends LabelBox>(labels: readonly T[], w = Infinity, h = Infinity): T[] {
 const kept: T[] = [];
 for (const l of [...labels].sort((a, b) => b.priority - a.priority)) {
  if (l.x < 0 || l.y < 0 || l.x + l.w > w || l.y + l.h > h) continue;
  if (kept.some(k => l.x < k.x + k.w && l.x + l.w > k.x && l.y < k.y + k.h && l.y + l.h > k.y)) continue;
  kept.push(l);
 }
 return kept;
}
/** Deposits of one material closer than `metres` merge into one marker (low zoom); stock adds up. */
export type DepositPoint = { id: string; material: string; x: number; z: number; left: number; amount: number };
export type DepositCluster = { ids: string[]; material: string; x: number; z: number; left: number; amount: number };
export function clusterDeposits(list: readonly DepositPoint[], metres: number): DepositCluster[] {
 const out: DepositCluster[] = [];
 for (const d of list) {
  const c = metres > 0 ? out.find(o => o.material === d.material && Math.hypot(o.x - d.x, o.z - d.z) < metres) : undefined;
  if (c) { const n = c.ids.length; c.x = (c.x * n + d.x) / (n + 1); c.z = (c.z * n + d.z) / (n + 1); c.ids.push(d.id); c.left += d.left; c.amount += d.amount; }
  else out.push({ ids: [d.id], material: d.material, x: d.x, z: d.z, left: d.left, amount: d.amount });
 }
 return out;
}
/** Compass direction from (dx, dz) with east = −x: С, СВ, В … (`DIR_NAMES` spells them out for cards). */
export const DIRS = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
export const DIR_NAMES = ['север', 'северо-восток', 'восток', 'юго-восток', 'юг', 'юго-запад', 'запад', 'северо-запад'];
const dirIndex = (dx: number, dz: number) => Math.round(((Math.atan2(-dx, dz) * 180 / Math.PI) + 360) % 360 / 45) % 8;
export const direction = (dx: number, dz: number) => DIRS[dirIndex(dx, dz)];
export const directionName = (dx: number, dz: number) => DIR_NAMES[dirIndex(dx, dz)];
function hsl(h: number, s: number, l: number): [number, number, number] {
 const a = s * Math.min(l, 1 - l), f = (n: number) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
 return [f(0), f(8), f(4)];
}
/** Relief raster of the square: one pixel per `cell` metres, column 0 at x = MAX (east is −x), row 0 at z = MAX
 *  (north up). Height tint, hill shading and 4 m contour bands. `rows` builds a slice so the work can be spread. */
export function rasterSize(cell: number) { return Math.round(SIZE / cell); }
export function buildRasterRows(data: Uint8ClampedArray, heightAt: (x: number, z: number) => number, cell: number, from: number, to: number) {
 const n = rasterSize(cell);
 for (let j = from; j < Math.min(n, to); j++) for (let i = 0; i < n; i++) {
  const x = MAX - (i + .5) * cell, z = MAX - (j + .5) * cell, h = heightAt(x, z), hx = heightAt(x + cell, z), hz = heightAt(x, z + cell);
  const e = hx - heightAt(x - cell, z) - (hz - heightAt(x, z - cell)), shade = Math.max(-10, Math.min(14, e * 6));
  const band = Math.floor(h / 4) !== Math.floor(hx / 4) || Math.floor(h / 4) !== Math.floor(hz / 4);
  const [r, g, b] = hsl(182 - Math.min(40, h) * .8, (20 + Math.min(30, Math.max(0, h))) / 100, Math.max(4, 10 + Math.min(40, h) * .55 + shade) / 100), k = band ? (h > 30 ? .22 : .32) : 0;
  const o = (j * n + i) * 4; data[o] = r + (127 - r) * k; data[o + 1] = g + (230 - g) * k; data[o + 2] = b + (218 - b) * k; data[o + 3] = 255;
 }
}
