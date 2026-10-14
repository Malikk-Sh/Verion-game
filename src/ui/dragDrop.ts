/**
 * Pointer drag & drop shared by the inventory and the station windows (S4), for mouse and touch alike. A press becomes a
 * drag after 10 px: a copy of the cell follows the pointer on <body>, and on release the nearest `[data-drop]` element
 * under the pointer receives the drop. Drops are resolved from data attributes only, so a window redrawn in between still
 * works. pointercancel (the browser took the gesture over, the system interrupted it) and a lost window focus abort
 * without a drop. The click that ends a drag is swallowed: a drag never also counts as a tap. One drag at a time; a
 * second finger only taps, and a new primary press clears a drag whose release never arrived.
 */
let active: { abort: () => void; at: number } | null = null;
/** True from the 10 px threshold until the drop or abort; station windows hold their rebuilds meanwhile. */
export const isDragging = () => !!active && performance.now() - active.at < 10000;
export function dragFrom(e: PointerEvent, cell: HTMLElement, drop: (target: HTMLElement) => void) {
 if (e.button !== 0) return;
 if (active) { if (!e.isPrimary) return; active.abort(); }
 const id = e.pointerId, x0 = e.clientX, y0 = e.clientY; let ghost: HTMLElement | null = null, half = 28;
 const listen = (on: boolean) => {
  if (on) { addEventListener('pointermove', move, { passive: false }); addEventListener('pointerup', end); addEventListener('pointercancel', end); addEventListener('blur', abort); }
  else { removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end); removeEventListener('blur', abort); }
 };
 const finish = () => { listen(false); if (!ghost) return false; ghost.remove(); ghost = null; document.body.classList.remove('dragging'); cell.classList.remove('source'); active = null; return true; };
 const abort = () => { finish(); };
 const move = (ev: PointerEvent) => {
  if (ev.pointerId !== id) return;
  if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) {
   if (active) { listen(false); return; }
   const r = cell.getBoundingClientRect(); half = (r.width || 56) / 2;
   ghost = cell.cloneNode(true) as HTMLElement; ghost.classList.add('drag-ghost'); ghost.removeAttribute('id'); delete ghost.dataset.drop; delete ghost.dataset.drag;
   for (const n of ghost.querySelectorAll('[id]')) n.removeAttribute('id');
   // Inline, so no cell class (position:relative, transitions) can pull the copy back into the page flow.
   Object.assign(ghost.style, { position: 'fixed', left: '0', top: '0', margin: '0', zIndex: '50', pointerEvents: 'none', transition: 'none', width: half * 2 + 'px', height: half * 2 + 'px' });
   ghost.setAttribute('aria-hidden', 'true'); document.body.append(ghost); document.body.classList.add('dragging'); cell.classList.add('source'); active = { abort, at: 0 };
  }
  if (ghost) { ev.preventDefault(); active!.at = performance.now(); ghost.style.transform = `translate(${ev.clientX - half}px,${ev.clientY - half}px)`; }
 };
 const end = (ev: PointerEvent) => {
  if (ev.pointerId !== id || !finish()) return;
  const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
  addEventListener('click', swallow, true); setTimeout(() => removeEventListener('click', swallow, true), 0);
  if (ev.type === 'pointercancel') return;
  const target = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-drop]');
  if (target) drop(target);
 };
 listen(true);
}
