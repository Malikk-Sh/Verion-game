/**
 * Mining feel (S4, Malik's point 7): one strike timeline shared by the tool swing, the sound, chips,
 * haptics, the camera kick, the model punch and the cracks. Pure functions of the mining progress
 * (no WebGL, no DOM), so the schedule is tested on its own. About one impact per 0.45 s; the last
 * impact of a block lands on the break tick itself, so nothing strikes again right after a break.
 */
export const STRIKE_S = .45;
/** Hit-stop: the tool rests on the struck face this long after each impact. */
export const HIT_STOP_MS = 40;
/** Impacts per block of `need` fixed ticks (50 ms). */
export const strikeCount = (need: number, tickMs = 50) => Math.max(1, Math.round(need * tickMs / 1000 / STRIKE_S));
/** Progress tick of impact `k` (impact 0 → tick 0, impact n → the break tick `need`). */
export const impactTick = (k: number, need: number, n = strikeCount(need)) => Math.ceil(k * need / n - 1e-9);
/** Impacts landed once progress tick `t` has run (fractional render time counts only whole ticks). */
export const impactsBy = (t: number, need: number, n = strikeCount(need)) => Math.min(n, Math.floor(Math.max(0, Math.floor(t + 1e-9)) * n / need + 1e-9));
/** Whether progress tick `t` (1…need) lands an impact; the break tick always does. */
export const impactAt = (t: number, need: number, n = strikeCount(need)) => t >= 1 && t <= need && impactsBy(t, need, n) > impactsBy(t - 1, need, n);
/** Swing phase between impacts: `q` 0 right after impact `k`, 1 at the next; `span` is that interval in ticks. */
export function strikePhase(t: number, need: number, n = strikeCount(need)) {
 const k = impactsBy(t, need, n); if (k >= n) return { k, q: 1, span: 1 };
 const a = impactTick(k, need, n), b = impactTick(k + 1, need, n);
 return { k, q: Math.min(1, Math.max(0, (t - a) / (b - a))), span: b - a };
}
const ease = (x: number) => x * x * (3 - 2 * x);
/**
 * Tool pose for phase `q`: 0 rest, 1 raised (wind-up), −1 on the struck face. After an impact the tool
 * holds (`hold`, the hit-stop as a fraction of the interval) and recovers; it then winds up and comes
 * down fast, reaching the face exactly at q = 1. Before the first impact of a hold it starts at rest.
 */
export function swingPose(q: number, struck: boolean, hold = .09) {
 const h = Math.min(.25, Math.max(0, hold)); if (q >= 1) return -1;
 if (q < .35) return !struck ? 0 : q < h ? -1 : -1 + ease((q - h) / (.35 - h));
 if (q < .8) return ease((q - .35) / .45);
 const d = (q - .8) / .2; return 1 - 2 * d * d;
}
/** Hit-stop as a fraction of an interval of `span` ticks. */
export const hitStopFraction = (span: number, tickMs = 50) => Math.min(.25, HIT_STOP_MS / (Math.max(1, span) * tickMs));
/** Crack level after `impacts` of `n` in the current block: three stages that pop on impacts (0 before the first). */
export const crackStage = (impacts: number, n: number) => impacts <= 0 ? 0 : Math.min(3, Math.ceil(3 * impacts / n - 1e-9)) / 3;
/** Camera kick and model punch envelope: rises to 1 at `tau`, then settles (mostly gone after ~4 tau). */
export const kickEnvelope = (t: number, tau = .035) => t <= 0 ? 0 : t / tau * Math.exp(1 - t / tau);
/** How hard a strike lands per material (camera kick, model punch): rock and metal 1, ice .8, loose ground .4. */
export const STRIKE_WEIGHT: Record<string, number> = { stone: 1, iron: 1, copper: 1, ice: .8, sand: .4, grass: .4 };
/** Reduced motion keeps a smaller swing: it is functional feedback, not decoration. */
export const REDUCED_SWING = .35;
