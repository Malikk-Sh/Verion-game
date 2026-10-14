/** Single source of the player's reduced-motion preference for DOM and WebGL animation (S3). */
const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
let reduced = !!query?.matches;
query?.addEventListener?.('change', e => { reduced = e.matches; });
export const reducedMotion = () => reduced;
