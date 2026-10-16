import { ITEMS } from '../game/defs';
import { itemArt } from './art';
import { reducedMotion as reduced } from '../motion';
/**
 * Pickup feed (S3 motion): gained items stack near the hotbar as "+N Камень · 12", while the icon
 * flies from the struck point (S4; the reticle without one) into the hotbar cell that now holds it
 * (or the backpack button). S4 also shows a short «+1» label anchored at the struck point in the
 * world — rising 0.4 m and fading over 0.6 s, repeats merging — amber «→ на землю» when the item
 * went to a ground pile. Visual only; never touches the game state. Honours prefers-reduced-motion.
 */
type Entry = { item: string; count: number; el: HTMLElement; num: HTMLElement; total: HTMLElement; timer: number };
type Pop = { item: string; count: number; ground: boolean; el: HTMLElement; num: HTMLElement; x: number; y: number; z: number; age: number };
export type Project = (x: number, y: number, z: number) => { x: number; y: number } | null;
/** Life of the world label (s) and how far it rises (m). */
export const POP_S = .6, POP_RISE = .4;
export function createFeed() {
 const box = document.getElementById('pickup-feed')!, layer = box.parentElement ?? document.body;
 const entries: Entry[] = [], pops: Pop[] = [];
 function remove(e: Entry) { e.el.classList.add('out'); setTimeout(() => e.el.remove(), 320); const i = entries.indexOf(e); if (i >= 0) entries.splice(i, 1); }
 function fly(item: string, target: HTMLElement | null, from?: { x: number; y: number } | null) {
  if (reduced() || !target) return;
  const r = target.getBoundingClientRect(); if (!r.width) return;
  const token = itemArt(item, 'art feed-token'); document.body.append(token);
  const sx = from?.x ?? innerWidth / 2, sy = from?.y ?? innerHeight / 2, ex = r.left + r.width / 2, ey = r.top + r.height / 2;
  token.style.left = sx - 18 + 'px'; token.style.top = sy - 18 + 'px';
  const a = token.animate([{ transform: 'translate(0,0) scale(.6)', opacity: 0 }, { transform: `translate(${(ex - sx) * .35}px,${(ey - sy) * .2 - 40}px) scale(1.1)`, opacity: 1, offset: .35 }, { transform: `translate(${ex - sx}px,${ey - sy}px) scale(.5)`, opacity: .2 }], { duration: 560, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'both' });
  a.finished.then(() => { token.remove(); target.classList.remove('bump'); void target.offsetWidth; target.classList.add('bump'); }, () => token.remove());
 }
 return {
  /** `total` — how many the player now carries; `target` — where the icon should land; `from` — screen point it leaves. */
  add(item: string, count: number, total: number, target: HTMLElement | null, from?: { x: number; y: number } | null) {
   fly(item, target, from);
   let e = entries.find(v => v.item === item);
   if (e) { e.count += count; clearTimeout(e.timer); e.el.classList.remove('bump'); void e.el.offsetWidth; e.el.classList.add('bump'); }
   else {
    const el = document.createElement('div'); el.className = 'feed-entry';
    const num = document.createElement('b'), name = document.createElement('span'), tot = document.createElement('small');
    name.textContent = ITEMS[item]?.name ?? item; el.append(itemArt(item), num, name, tot); box.prepend(el);
    e = { item, count, el, num, total: tot, timer: 0 }; entries.unshift(e);
    while (entries.length > 4) remove(entries[entries.length - 1]);
   }
   e.num.textContent = '+' + e.count; e.total.textContent = String(total);
   const cur = e; cur.timer = window.setTimeout(() => remove(cur), 2600);
  },
  /** «+N» at world point `at`; `ground`: the item went to a pile on the ground (amber «→ на землю»). */
  pop(item: string, count: number, at: { x: number; y: number; z: number }, ground: boolean) {
   const same = pops.find(p => p.item === item && p.ground === ground && p.age < POP_S * .75);
   if (same) { same.count += count; same.age = 0; Object.assign(same, { x: at.x, y: at.y, z: at.z }); same.num.textContent = '+' + same.count; return; }
   const el = document.createElement('div'); el.className = 'world-pop' + (ground ? ' ground' : ''); el.setAttribute('aria-hidden', 'true');
   const num = document.createElement('b'); num.textContent = '+' + count; el.append(num, itemArt(item));
   if (ground) { const note = document.createElement('span'); note.textContent = '→ на землю'; el.append(note); }
   layer.append(el); pops.push({ item, count, ground, el, num, x: at.x, y: at.y, z: at.z, age: 0 });
   while (pops.length > 4) { const old = pops.shift()!; old.el.remove(); }
  },
  /** Per frame: ages the labels (`dt` 0 holds them, as in a pause) and places them over their world points. */
  tick(dt: number, project: Project) {
   for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i]; p.age += dt;
    // A ground label stays a little longer: it carries the warning.
    const life = p.ground ? POP_S * 2 : POP_S; if (p.age >= life) { p.el.remove(); pops.splice(i, 1); continue; }
    const u = p.age / life, s = project(p.x, p.y + (reduced() ? 0 : POP_RISE * (1 - (1 - u) ** 2)), p.z);
    if (!s) { p.el.style.opacity = '0'; continue; }
    p.el.style.transform = `translate(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px) translate(-50%,-100%)`; p.el.style.opacity = String(Math.min(1, (1 - u) / .4));
   }
  },
  get pops() { return pops.length; },
  clear() { for (const e of [...entries]) remove(e); for (const p of pops.splice(0)) p.el.remove(); },
 };
}
