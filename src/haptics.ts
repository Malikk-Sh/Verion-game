/**
 * Short vibration cues for mining (S4). Optional and never required for control (UX §6): the
 * «Вибрация» setting (on by default) switches them off, a hidden page never vibrates, and browsers
 * without `navigator.vibrate` (iOS Safari) simply get nothing. Patterns are milliseconds.
 */
export const HAPTICS = { strike: 10, block: 30, deplete: [30, 40, 60], broke: [60, 40, 60] } as const;
export type HapticKind = keyof typeof HAPTICS;
/** The pattern to play, or null when the cue is off (setting, unsupported browser, hidden page). */
export function hapticPattern(kind: HapticKind, o: { enabled: boolean; supported: boolean; hidden: boolean }): number | number[] | null {
 if (!o.enabled || !o.supported || o.hidden) return null;
 const p = HAPTICS[kind]; return typeof p === 'number' ? p : [...p];
}
type Vibrator = { vibrate?: (pattern: number | number[]) => boolean };
export function createHaptics(nav: Vibrator | undefined = typeof navigator === 'undefined' ? undefined : navigator, doc: { hidden: boolean } | undefined = typeof document === 'undefined' ? undefined : document) {
 const supported = typeof nav?.vibrate === 'function';
 let enabled = true, played = 0;
 return {
  supported,
  get enabled() { return enabled; }, set enabled(v: boolean) { enabled = v; },
  /** Cues accepted by the browser (test hook). */
  get played() { return played; },
  play(kind: HapticKind) {
   const p = hapticPattern(kind, { enabled, supported, hidden: !!doc?.hidden }); if (p === null) return false;
   try { const ok = nav!.vibrate!.call(nav, p) !== false; if (ok) played++; return ok; } catch { return false; }
  },
 };
}
