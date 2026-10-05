/** Visual preferences belong to the browser, not the expedition save. */
export const VISOR_CONTROLS = {
 strength: { label: 'Сила затемнения', min: 0, max: 150 },
 spread: { label: 'Размер затемнения', min: 60, max: 140 },
} as const;
export type VisorGroup = keyof typeof VISOR_CONTROLS;
export type VisorSettings = Record<VisorGroup,number>;
export const defaultVisorSettings = ():VisorSettings => ({ strength:100,spread:100 });
export function parseVisorSettings(value:unknown):VisorSettings {
 const result=defaultVisorSettings();
 if(!value||typeof value!=='object')return result;
 for(const [key,{min,max}] of Object.entries(VISOR_CONTROLS) as [VisorGroup,{min:number;max:number}][]) {
  const n=(value as Record<string,unknown>)[key];
  if(typeof n==='number'&&Number.isFinite(n))result[key]=Math.round(Math.max(min,Math.min(max,n))/5)*5;
 }
 return result;
}
export function applyVisorSettings(value:VisorSettings) {
 const prefs=parseVisorSettings(value),root=document.documentElement;
 root.style.setProperty('--visor-strength',String(prefs.strength/100));
 root.style.setProperty('--visor-spread',String(prefs.spread/100));
}
