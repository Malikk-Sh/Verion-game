import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultHudSettings, parseHudSettings, loadHudSettings, HUD_BASE, HUD_VERSION, hudLayout, HUD_GROUPS, type HudGroup } from '../src/ui/hud';
const safe = { left: 16, right: 16, top: 10, bottom: 10 };
test('Approved HUD sizes become 100%; old preferences migrate once', () => {
 assert.deepEqual(loadHudSettings(HUD_BASE, undefined), defaultHudSettings());
 assert.deepEqual(loadHudSettings(undefined, undefined), defaultHudSettings());
 const custom = {...defaultHudSettings(),joystick:120};
 assert.deepEqual(loadHudSettings(custom,HUD_VERSION),custom);
 const r=hudLayout(1366,768,safe,defaultHudSettings());
 for(const key of Object.keys(HUD_GROUPS) as HudGroup[])assert.equal(r.scales[key],HUD_BASE[key]/100);
});
test('HUD preferences accept old settings and independently repair invalid values', () => {
 assert.deepEqual(parseHudSettings(undefined), defaultHudSettings());
 assert.deepEqual(parseHudSettings(null), defaultHudSettings());
 const p = parseHudSettings({ joystick: 200, action: -1, movement: NaN, menu: '120', compass: 122, info: Infinity, hotbar: 85, extra: 150 });
 assert.equal(p.joystick, 150); assert.equal(p.action, 80); assert.equal(p.movement, 100);
 assert.equal(p.menu, 100); assert.equal(p.compass, 120); assert.equal(p.info, 100); assert.equal(p.hotbar, 85);
 assert.equal('extra' in p, false);
});
test('HUD lanes remain separated for all combinations of smallest/largest group preferences', () => {
 const keys = Object.keys(HUD_GROUPS) as HudGroup[];
 for (const [w,h] of [[568,320],[667,320],[761,390],[800,360],[844,390],[1366,768]]) {
  for (let mask = 0; mask < 256; mask++) {
   const prefs = Object.fromEntries(keys.map((k,i) => [k, mask & (1 << i) ? 150 : 80])) as ReturnType<typeof defaultHudSettings>;
   const r = hudLayout(w,h,safe,prefs), s = r.scales, tag = `${w}x${h} ${mask}`;
   assert.ok(Math.abs(r.compassLeft+r.compassWidth/2-w/2)<.01,tag);
   assert.equal(r.wingWidth,Math.max(270*s.vitals,240*s.menu),tag);
   assert.ok(r.compassLeft >= safe.left + r.wingWidth + 7.9, tag);
   assert.ok(r.compassLeft+r.compassWidth <= w-safe.right-r.wingWidth-7.9, tag);
   assert.ok(r.hotbarLeft >= safe.left + r.joystickSize + 7.9, tag);
   assert.ok(r.hotbarLeft+r.hotbarWidth <= w-safe.right-r.actionWidth-7.9, tag);
   assert.ok(h-r.joystickBottom-r.joystickSize >= r.objectiveTop+r.objectiveHeight+7.9, tag);
   assert.ok(40*s.menu >= 31.99 && 40*s.hotbar >= 31.99 && 44*s.movement >= 31.99 && 80*s.action >= 31.99, tag);
   assert.ok(r.aimTop+32*s.info <= h-safe.bottom-r.hotbarHeight-7.9, tag);
   if(r.aimTop+32*s.info>h-r.joystickBottom-r.joystickSize)assert.ok(r.aimLeft-r.aimWidth/2>=safe.left+r.joystickSize+7.9,tag);
   if(r.aimTop+32*s.info>h-safe.bottom-r.actionHeight)assert.ok(r.aimLeft+r.aimWidth/2<=w-safe.right-r.actionWidth-7.9,tag);
  }
 }
});
test('HUD layout respects landscape safe areas', () => {
 const inset = { left: 44, right: 16, top: 10, bottom: 21 };
 const r = hudLayout(667,320,inset,parseHudSettings(Object.fromEntries(Object.keys(HUD_GROUPS).map(k=>[k,150]))));
 assert.equal(r.compassLeft+r.compassWidth/2,667/2);
 assert.ok(r.hotbarLeft >= inset.left+r.joystickSize+7.9);
 assert.ok(r.hotbarLeft+r.hotbarWidth <= 667-inset.right-r.actionWidth-7.9);
 assert.ok(r.compassLeft+r.compassWidth <= 667-inset.right-r.wingWidth-7.9);
});
