/** All HUD geometry uses the same 40px unit. Preferences are independent of world saves. */
export const HUD_GROUPS = {
 joystick: 'Джойстик', action: 'Основное действие', movement: 'Бег и прыжок',
 menu: 'Верхние кнопки', compass: 'Компас', vitals: 'Индикаторы',
 hotbar: 'Быстрый доступ', info: 'Задача и подписи',
} as const;
export type HudGroup = keyof typeof HUD_GROUPS;
export type HudSettings = Record<HudGroup, number>;
export const HUD_MIN = 80, HUD_MAX = 150, HUD_STEP = 5;
export const HUD_VERSION = 2;
/** User-approved proportions from the 4 October screenshot, now shown as 100%. */
export const HUD_BASE: HudSettings = { joystick: 110, action: 115, movement: 95, menu: 90, compass: 90, vitals: 80, hotbar: 90, info: 80 };
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
export function loadHudSettings(value: unknown, version: unknown): HudSettings {
 if (!value || typeof value !== 'object' || version === HUD_VERSION) return parseHudSettings(value);
 const old = parseHudSettings(value);
 return parseHudSettings(Object.fromEntries(Object.entries(old).map(([key, n]) => [key, n / HUD_BASE[key as HudGroup] * 100])));
}
export type HudInsets = { left: number; right: number; top: number; bottom: number };
/** Native, resolution-independent visor artwork. Built once, then filled by the live --v ratio. */
function installVisorWings() {
 if (document.querySelector('#vitals .visor-rail')) return;
 const rail = `<svg class="visor-rail" viewBox="0 0 300 80" preserveAspectRatio="none" aria-hidden="true"><path class="visor-glass" d="M1 25 Q100 2 299 2 L299 54 Q100 54 1 77Z"/><path class="visor-edge" d="M1 25 Q100 2 299 2"/><path class="visor-lip" d="M1 55 L1 77 Q100 54 299 54"/></svg>`;
 document.getElementById('vitals')!.insertAdjacentHTML('afterbegin',rail);
 // One closed menu housing with fitted bays, following the approved first concept.
 const curve=(x:number)=>2+22*(x/300)**2;
 let seams='';
 for(let i=1;i<5;i++) {
  const x=i*60,y=curve(x),bottom=y+52;
  seams+=`<path class="menu-seam" d="M${x-3} ${y} L${x+2} ${y+5} L${x+2} ${bottom-5} L${x+6} ${bottom}"/>`;
 }
 const outline='M5 2 Q200 2 295 23 L299 27 L299 73 L294 77 Q195 54 5 54 L1 50 L1 6Z';
 document.getElementById('hud-buttons')!.insertAdjacentHTML('afterbegin',`<svg class="visor-rail menu-rail" viewBox="0 0 300 80" preserveAspectRatio="none" aria-hidden="true"><path class="visor-glass" d="${outline}"/><path class="menu-outline" d="${outline}"/>${seams}</svg>`);
 document.querySelectorAll<HTMLElement>('#hud-buttons button').forEach((button,i)=>{
  const start=curve(i*60)/80*100,end=curve((i+1)*60)/80*100;
  button.style.clipPath=`polygon(0 ${start}%,100% ${end}%,100% ${end+65}%,0 ${start+65}%)`;
  button.style.setProperty('--button-center-y',`${(curve(i*60+30)+26)/80*100}%`);
 });
 document.querySelectorAll<HTMLElement>('#vitals .gauge').forEach((gauge,index)=>{
  const curve=(x:number)=>2+22*(1-x/300)**2;
  let segments='';
  for(let i=0;i<10;i++) {
   const x=5+i*9.1, end=x+7.1, y=curve(index*100+x)+9, ey=curve(index*100+end)+9;
   segments+=`<path d="M${x} ${y} L${end} ${ey} L${end} ${ey+7} L${x} ${y+7}Z"/>`;
  }
  const meter=`<svg viewBox="0 0 100 80" preserveAspectRatio="none" aria-hidden="true">${segments}</svg>`;
  gauge.insertAdjacentHTML('afterbegin',`<div class="vital-track">${meter}</div><div class="vital-fill">${meter}</div>`);
  gauge.style.setProperty('--readout-top',`${(curve(index*100+50)+27)/80*100}%`);
 });
}
export function hudLayout(width: number, height: number, inset: HudInsets, prefs: HudSettings) {
 const s = Object.fromEntries(Object.entries(parseHudSettings(prefs)).map(([k, v]) => [k, v * HUD_BASE[k as HudGroup] / 10000])) as Record<HudGroup, number>;
 const room = width - inset.left - inset.right, gap = 8;
 // Keep the compass on the screen center even with asymmetric safe areas or menu sizes.
 const center = width / 2;
 const minCompass = Math.min(128, Math.max(1,width - 2 * (Math.max(inset.left, inset.right) + 240 * .8 + gap)));
 const wingRoom = Math.max(1,center-Math.max(inset.left,inset.right)-gap-minCompass/2);
 s.vitals = Math.min(s.vitals,wingRoom/270);
 s.menu = Math.max(.8,Math.min(s.menu,wingRoom/240));
 // Same frame on both sides; content sizes still follow their independent preferences.
 const wingWidth = Math.max(270*s.vitals,240*s.menu);
 const wingHeight = 80*Math.max(s.vitals,s.menu);
 const vitalsWidth = wingWidth, menuWidth = wingWidth;
 const compassRoom = Math.max(1, 2 * Math.min(center - inset.left - vitalsWidth - gap, center - inset.right - menuWidth - gap));
 const compassWidth = Math.min(300 * s.compass, compassRoom);
 const compassLeft = center - compassWidth / 2;
 const topHeight = Math.max(wingHeight,56 * s.compass);
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
 const barUnits = 70;
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
 const aimBottom = aimTop + aimHeight;
 const aimLeftEdge = aimBottom > height - joyBottom - joyWidth && aimTop < height - joyBottom ? inset.left + joyWidth + gap : inset.left;
 const aimRightEdge = aimBottom > height - inset.bottom - actionHeight ? width - inset.right - actionWidth() - gap : width - inset.right;
 const aimWidth = aimRightEdge - aimLeftEdge, aimLeft = aimLeftEdge + aimWidth / 2;
 return { scales: s, wingWidth, wingHeight, compassLeft, compassWidth, objectiveTop, objectiveHeight, objectiveWidth,
  hotbarLeft, hotbarWidth: barWidth, hotbarHeight: barHeight, joystickBottom: joyBottom,
  joystickSize: joyWidth, actionWidth: actionWidth(), actionHeight, aimTop, aimWidth, aimLeft,
  toastTop: objectiveTop, toastWidth: Math.max(1, room - objectiveWidth - gap), saveHeight };
}

/** Read safe-area values from CSS; called on resize/settings changes, never in the render loop. */
export function applyHudSettings(prefs: HudSettings) {
 installVisorWings();
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
 const positions = { 'wing-width': layout.wingWidth, 'wing-height': layout.wingHeight,
  'compass-left': layout.compassLeft, 'compass-width': layout.compassWidth,
  'objective-top': layout.objectiveTop, 'objective-height': layout.objectiveHeight, 'objective-width': layout.objectiveWidth,
  'hotbar-left': layout.hotbarLeft, 'hotbar-width': layout.hotbarWidth, 'joystick-bottom': layout.joystickBottom,
  'aim-top': layout.aimTop, 'aim-width': layout.aimWidth, 'aim-left': layout.aimLeft,
  'toast-top': layout.toastTop, 'toast-width': layout.toastWidth, 'save-height': layout.saveHeight };
 for (const [key, value] of Object.entries(positions)) root.style.setProperty(`--hud-${key}`, `${value}px`);
 return layout;
}
