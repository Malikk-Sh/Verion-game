import { ITEMS } from '../game/defs';
import { itemArt } from './art';
/**
 * Pickup feed (S3 motion): gained items stack near the hotbar as "+N Камень · 12", while the icon
 * flies from the reticle into the hotbar cell that now holds it (or the backpack button).
 * Visual only; never touches the game state. Honours prefers-reduced-motion.
 */
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
type Entry = { item: string; count: number; el: HTMLElement; num: HTMLElement; total: HTMLElement; timer: number };
export function createFeed() {
 const box = document.getElementById('pickup-feed')!;
 const entries: Entry[] = [];
 function remove(e: Entry) { e.el.classList.add('out'); setTimeout(() => e.el.remove(), 320); const i = entries.indexOf(e); if (i >= 0) entries.splice(i, 1); }
 function fly(item: string, target: HTMLElement | null) {
  if (reduced() || !target) return;
  const r = target.getBoundingClientRect(); if (!r.width) return;
  const token = itemArt(item, 'art feed-token'); document.body.append(token);
  const sx = innerWidth / 2, sy = innerHeight / 2, ex = r.left + r.width / 2, ey = r.top + r.height / 2;
  token.style.left = sx - 18 + 'px'; token.style.top = sy - 18 + 'px';
  const a = token.animate([{ transform: 'translate(0,0) scale(.6)', opacity: 0 }, { transform: `translate(${(ex - sx) * .35}px,${(ey - sy) * .2 - 40}px) scale(1.1)`, opacity: 1, offset: .35 }, { transform: `translate(${ex - sx}px,${ey - sy}px) scale(.5)`, opacity: .2 }], { duration: 560, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'both' });
  a.finished.then(() => { token.remove(); target.classList.remove('bump'); void target.offsetWidth; target.classList.add('bump'); }, () => token.remove());
 }
 return {
  /** `total` — how many the player now carries; `target` — where the icon should land. */
  add(item: string, count: number, total: number, target: HTMLElement | null) {
   fly(item, target);
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
  clear() { for (const e of [...entries]) remove(e); },
 };
}
