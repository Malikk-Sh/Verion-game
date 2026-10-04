/** All HUD geometry uses the same 40px unit. Preferences are independent of world saves. */
export const HUD_GROUPS = {
 joystick: 'Джойстик', action: 'Основное действие', movement: 'Бег и прыжок',
 menu: 'Верхние кнопки', compass: 'Компас', vitals: 'Индикаторы состояния',
 hotbar: 'Быстрый доступ', info: 'Задача и подписи',
} as const;
export type HudGroup = keyof typeof HUD_GROUPS;
export type HudSettings = Record<HudGroup, number>;
export const HUD_MIN = 80, HUD_MAX = 150, HUD_STEP = 5;
export const defaultHudSettings = (): HudSettings => Object.fromEntries(Object.keys(HUD_GROUPS).map(k => [k, 100])) as HudSettings;
export function parseHudSettings(value: unknown): HudSettings {
 const result = defaultHudSettings();
 if (!value || typeof value !== 'object') return result;
 for (const key of Object.keys(HUD_GROUPS) as HudGroup[]) {
  const n = (value as Record<string, unknown>)[key];
  if (typeof n === 'number' && Number.isFinite(n)) result[key] = Math.round(Math.max(HUD_MIN, Math.min(HUD_MAX, n)) / HUD_STEP) * HUD_STEP;
 }
 return result;
}
export type HudInsets = { left: number; right: number; top: number; bottom: number };
export function hudLayout(width: number, height: number, inset: HudInsets, prefs: HudSettings) {
 const s = Object.fromEntries(Object.entries(parseHudSettings(prefs)).map(([k, v]) => [k, v / 100])) as Record<HudGroup, number>;
 const room = width - inset.left - inset.right, gap = 8;
 // Reserve a readable compass between the two top groups, rather than rely on a device breakpoint.
 const topFit = Math.max(.3, Math.min(1, (room - 128 - gap * 2) / (164 * s.vitals + 256 * s.menu)));
 s.vitals *= topFit; s.menu = Math.max(.8, s.menu * topFit);
 const vitalsWidth = 164 * s.vitals, menuWidth = 256 * s.menu;
 const compassRoom = Math.max(1, room - vitalsWidth - menuWidth - gap * 2);
 const compassWidth = Math.min(300 * s.compass, compassRoom);
 const compassLeft = inset.left + vitalsWidth + gap + (compassRoom - compassWidth) / 2;
 const topHeight = Math.max(52 * s.vitals, 48 * s.menu, 56 * s.compass);
 const objectiveTop = inset.top + topHeight + gap;
 // Keep the bottom groups in three lanes even with independently enlarged controls.
 const actionWidth = () => Math.max(80 * s.action, 102 * s.movement);
 const wanted = { ...s };
 const fitBottom = (factor: number) => {
  s.joystick = Math.max(.6, wanted.joystick * factor); s.action = Math.max(.4, wanted.action * factor);
  s.movement = Math.max(.8, wanted.movement * factor); s.hotbar = Math.max(.8, wanted.hotbar * factor);
  return 100 * s.joystick + 270 * s.hotbar + actionWidth() <= room - gap * 2;
 };
 if (!fitBottom(1)) {
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) { const mid = (low + high) / 2; if (fitBottom(mid)) low = mid; else high = mid; }
  fitBottom(low);
 }
 const barUnits = width <= 760 ? 70 : 86;
 // Reserve the band under the reticle for the aim label, even with a large hotbar on a short screen.
 s.hotbar = Math.min(s.hotbar, Math.max(.8, (height / 2 - inset.bottom - 36 - 32 * .8) / barUnits));
 const aimRoom = height / 2 - inset.bottom - barUnits * s.hotbar;
 s.info = Math.min(s.info, Math.max(.8, aimRoom >= 68 ? (aimRoom - 16) / 52 : (aimRoom - 36) / 32));
 const objectiveHeight = Math.max(32, 36 * s.info), objectiveWidth = Math.min(200 * s.info, room * .44);
 const saveHeight = Math.max(16, 16 * s.info), joyBottom = inset.bottom + saveHeight + gap;
 s.joystick = Math.min(s.joystick, Math.max(.6, (height - joyBottom - objectiveTop - objectiveHeight - gap) / 100));
 const joyWidth = 100 * s.joystick, barWidth = 270 * s.hotbar;
 const actionHeight = 80 * s.action + 6 + 44 * s.movement;
 const barHeight = barUnits * s.hotbar;
 const hotbarLeft = inset.left + joyWidth + gap + (room - joyWidth - actionWidth() - gap * 2 - barWidth) / 2;
 const barTop = height - inset.bottom - barHeight, aimHeight = 32 * s.info;
 const aimBelow = height / 2 + Math.max(28, 20 * s.info + gap);
 const aimTop = aimBelow + aimHeight + gap <= barTop + .1 ? aimBelow : height / 2 - 26 - aimHeight;
 return { scales: s, compassLeft, compassWidth, objectiveTop, objectiveHeight, objectiveWidth,
  hotbarLeft, hotbarWidth: barWidth, hotbarHeight: barHeight, joystickBottom: joyBottom,
  joystickSize: joyWidth, actionWidth: actionWidth(), actionHeight, aimTop,
  toastTop: objectiveTop, toastWidth: Math.max(1, room - objectiveWidth - gap), saveHeight };
}

/** Read safe-area values from CSS; called on resize/settings changes, never in the render loop. */
export function applyHudSettings(prefs: HudSettings) {
 const root = document.documentElement, style = getComputedStyle(root);
 const inset = (side: string) => parseFloat(style.getPropertyValue(`--hud-inset-${side}`)) || (side === 'top' || side === 'bottom' ? 10 : 16);
 // CSS max()/env() are resolved by layout, rather than parsed as strings.
 const probe = document.getElementById('hud-safe-area')!;
 const safe = getComputedStyle(probe);
 const layout = hudLayout(innerWidth, innerHeight, {
  left: parseFloat(safe.paddingLeft) || inset('left'), right: parseFloat(safe.paddingRight) || inset('right'),
  top: parseFloat(safe.paddingTop) || inset('top'), bottom: parseFloat(safe.paddingBottom) || inset('bottom'),
 }, prefs);
 for (const [key, scale] of Object.entries(layout.scales)) root.style.setProperty(`--hud-${key}`, String(scale));
 root.dataset.compactHudMenu = String(layout.scales.menu < 1);
 const positions = { 'compass-left': layout.compassLeft, 'compass-width': layout.compassWidth,
  'objective-top': layout.objectiveTop, 'objective-height': layout.objectiveHeight, 'objective-width': layout.objectiveWidth,
  'hotbar-left': layout.hotbarLeft, 'hotbar-width': layout.hotbarWidth, 'joystick-bottom': layout.joystickBottom,
  'aim-top': layout.aimTop, 'toast-top': layout.toastTop, 'toast-width': layout.toastWidth, 'save-height': layout.saveHeight };
 for (const [key, value] of Object.entries(positions)) root.style.setProperty(`--hud-${key}`, `${value}px`);
 return layout;
}
