import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { strikeCount, impactAt, impactsBy, impactTick, strikePhase, swingPose, hitStopFraction, crackStage, kickEnvelope, STRIKE_S, REDUCED_SWING } from '../src/strikes.ts';
import { HAPTICS, hapticPattern, createHaptics } from '../src/haptics.ts';
import { mineTick, ticksFor, stockText, wearText, type Mining } from '../src/game/mining.ts';
import { depositScale } from '../src/game/resources.ts';
import { HAND_MINING, MATERIALS } from '../src/game/defs.ts';
import { newGame } from '../src/game/state.ts';
import { StaticBatch } from '../src/geometry.ts';
import { createDepositFeel, CRUMBLE_S } from '../src/depositFeel.ts';

const needs = () => [...new Set(Object.keys(MATERIALS).flatMap(m => [ticksFor(m as keyof typeof MATERIALS, 1), ...(HAND_MINING[m as keyof typeof MATERIALS] ? [ticksFor(m as keyof typeof MATERIALS, HAND_MINING[m as keyof typeof MATERIALS]!)] : [])]))];

test('Strike schedule: about one impact per 0.45 s, the last one on the break tick, none before the first tick', () => {
 assert.deepEqual(needs().sort((a, b) => a - b), [20, 30, 60, 75, 80, 150]);
 for (const need of needs()) {
  const n = strikeCount(need), hits = Array.from({ length: need }, (_, i) => i + 1).filter(t => impactAt(t, need));
  assert.equal(hits.length, n, `${need} ticks: ${n} impacts`); assert.equal(hits.at(-1), need, 'the break is the last impact');
  assert.deepEqual(hits, Array.from({ length: n }, (_, k) => impactTick(k + 1, need, n)));
  assert.equal(impactAt(0, need), false); assert.equal(impactAt(need + 1, need), false);
  // Even spacing: every interval is within one tick of the ideal, which is within 25% of 0.45 s.
  const ideal = need / n; let prev = 0;
  for (const h of hits) { assert.ok(Math.abs(h - prev - ideal) <= 1, `${need}: interval ${h - prev} vs ${ideal}`); prev = h; }
  assert.ok(Math.abs(ideal * .05 - STRIKE_S) <= STRIKE_S * .25 || n === 1, `${need}: ${ideal * .05} s per impact`);
  for (let t = 0; t <= need; t++) assert.equal(impactsBy(t, need), hits.filter(h => h <= t).length);
 }
 assert.equal(strikeCount(80), 9); assert.equal(strikeCount(60), 7); assert.equal(strikeCount(30), 3); assert.equal(strikeCount(20), 2); assert.equal(strikeCount(1), 1);
});

test('Mining through two iron blocks: impacts and breaks come from one timeline, no strike right after a break', () => {
 const s = newGame('w-feel', 1, 0, 0), m: Mining = { nodeId: null, ticks: 0 }, log: string[] = [];
 for (let i = 0; i < 160; i++) { const ev = mineTick(s, m, 'iron-b', true); if (ev.kind === 'progress') { assert.equal(ev.need, 80); assert.equal(ev.tick, m.ticks); if (impactAt(ev.tick, ev.need)) log.push('hit@' + ev.tick); } else if (ev.kind === 'block') { assert.equal(ev.need, 80); log.push('break'); } }
 const block = [9, 18, 27, 36, 45, 54, 63, 72].map(t => 'hit@' + t).concat('break');
 assert.deepEqual(log, [...block, ...block]);
});

test('Swing pose follows the timeline: the head meets the face at each impact, holds, recovers and winds up', () => {
 const need = 80, n = strikeCount(need);
 // Approaching impact 1: from rest (no impact yet) through wind-up to the face exactly at the impact tick.
 assert.equal(swingPose(strikePhase(0, need).q, false), 0);
 assert.equal(swingPose(strikePhase(impactTick(1, need, n) * .8, need).q, false), 1);
 const before = strikePhase(8.999, need), after = strikePhase(9.001, need);
 assert.equal(before.k, 0); assert.equal(after.k, 1); assert.ok(swingPose(before.q, false) < -.99); assert.equal(swingPose(after.q, true), -1);
 // Hit-stop of 40 ms on a 9-tick interval, then a continuous recovery to rest and wind-up.
 assert.ok(Math.abs(hitStopFraction(9) - 40 / 450) < 1e-12); assert.equal(hitStopFraction(1), .25);
 let last = swingPose(0, true, hitStopFraction(9));
 for (let q = .01; q <= 1.0001; q += .01) { const p = swingPose(Math.min(1, q), true, hitStopFraction(9)); assert.ok(Math.abs(p - last) <= (q > .8 ? .21 : .12), `continuous at ${q}`); assert.ok(p >= -1 && p <= 1); last = p; }
 assert.equal(swingPose(.35, true), 0); assert.equal(swingPose(.8, true), 1); assert.equal(swingPose(1, true), -1);
 // Across a block boundary the swing goes on: mining.ticks resets to 0 right after the break impact.
 assert.equal(swingPose(strikePhase(.3, need).q, true, hitStopFraction(strikePhase(.3, need).span)), -1);
 assert.ok(REDUCED_SWING > 0 && REDUCED_SWING < 1, 'reduced motion keeps a smaller swing');
});

test('Crack stages pop on impacts; kick and punch envelope peaks then settles', () => {
 assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => crackStage(i, 9)), [0, 1, 1, 1, 2, 2, 2, 3, 3].map(v => v / 3));
 assert.deepEqual([0, 1, 2].map(i => crackStage(i, 3)), [0, 1 / 3, 2 / 3]);
 assert.equal(crackStage(1, 2), 2 / 3); assert.equal(crackStage(9, 9), 1);
 assert.equal(kickEnvelope(0), 0); assert.ok(Math.abs(kickEnvelope(.035) - 1) < 1e-12);
 assert.ok(kickEnvelope(.12) < .35 && kickEnvelope(.4) < .001);
 for (let t = .04; t < .4; t += .01) assert.ok(kickEnvelope(t + .01) < kickEnvelope(t));
});

test('Haptic patterns are gated by the setting, support and a hidden page; failures never throw', () => {
 assert.deepEqual(HAPTICS, { strike: 10, block: 30, deplete: [30, 40, 60], broke: [60, 40, 60] });
 const on = { enabled: true, supported: true, hidden: false };
 assert.equal(hapticPattern('strike', on), 10); assert.deepEqual(hapticPattern('deplete', on), [30, 40, 60]);
 assert.notEqual(hapticPattern('broke', on), HAPTICS.broke, 'a mutable copy for navigator.vibrate');
 for (const off of [{ ...on, enabled: false }, { ...on, supported: false }, { ...on, hidden: true }]) assert.equal(hapticPattern('block', off), null);
 const calls: (number | number[])[] = [], doc = { hidden: false }, h = createHaptics({ vibrate: p => { calls.push(p); return true; } }, doc);
 assert.equal(h.supported, true); assert.equal(h.play('strike'), true); h.enabled = false; assert.equal(h.play('block'), false); h.enabled = true; doc.hidden = true; assert.equal(h.play('block'), false); doc.hidden = false;
 assert.equal(h.play('deplete'), true); assert.deepEqual(calls, [10, [30, 40, 60]]); assert.equal(h.played, 2);
 assert.equal(createHaptics({}, doc).supported, false); assert.equal(createHaptics({}, doc).play('strike'), false); assert.equal(createHaptics(undefined, doc).play('strike'), false);
 const throws = createHaptics({ vibrate: () => { throw new Error('blocked'); } }, doc); assert.equal(throws.play('strike'), false); assert.equal(throws.played, 0);
 const refused = createHaptics({ vibrate: () => false }, doc); assert.equal(refused.play('strike'), false); assert.equal(refused.played, 0);
});

test('Aim label shows stock and carried count; durability warning at 10% or less', () => {
 assert.equal(stockText(31, 32, 5), 'Запас 31/32 · в рюкзаке 5');
 assert.equal(wearText(16, 160), 'Прочность 16/160'); assert.equal(wearText(1, 160), 'Прочность 1/160');
 assert.equal(wearText(17, 160), ''); assert.equal(wearText(0, 160), '', 'a broken tool has its own message'); assert.equal(wearText(undefined, 160), ''); assert.equal(wearText(5, undefined), '');
});

test('A deposit squats as it is mined, drops loose pieces from the end and crumbles on the scene clock', () => {
 assert.deepEqual(depositScale(32, 32), { xz: 1, y: 1 }); assert.deepEqual(depositScale(0, 32), { xz: .5, y: .34 });
 for (let l = 1; l <= 32; l++) { const a = depositScale(l - 1, 32), b = depositScale(l, 32); assert.ok(a.xz < b.xz && a.y < b.y); assert.ok(1 - b.y >= 1 - b.xz, 'height falls faster than width'); }
 // Three pieces: a main block and two loose ones; the batch records the running vertex counts.
 const mat = new THREE.MeshStandardMaterial(), box = new THREE.BoxGeometry(1, 1, 1), b = new StaticBatch(0, undefined, true);
 b.add(box, mat); b.add(box, mat, 2); b.add(box, mat, -2); const g = new THREE.Group(); g.userData.y0 = 0; b.finish(g);
 const mesh = g.children[0] as THREE.Mesh; assert.deepEqual(mesh.userData.pieces, [36, 72, 108]);
 assert.equal(new StaticBatch().finish(new THREE.Group()).length, 0);
 let shadows = 0, reduced = false; const feel = createDepositFeel(new Map([['stone-x', g]]), () => shadows++, () => reduced);
 feel.setAmount('stone-x', 10, 10); assert.equal(mesh.geometry.drawRange.count, 108); assert.deepEqual(g.scale.toArray(), [1, 1, 1]);
 feel.setAmount('stone-x', 6, 10); assert.equal(mesh.geometry.drawRange.count, 108);
 feel.setAmount('stone-x', 5, 10); assert.equal(mesh.geometry.drawRange.count, 72, 'half the stock: one loose piece gone');
 feel.setAmount('stone-x', 1, 10); assert.equal(mesh.geometry.drawRange.count, 72); const one = depositScale(1, 10); assert.deepEqual(g.scale.toArray(), [one.xz, one.y, one.xz]); assert.ok(Math.abs(one.xz - .55) < 1e-12 && Math.abs(one.y - .406) < 1e-12);
 // A strike punches the group; a paused scene (dt 0) does not move it; it settles back to its shape.
 feel.impact('stone-x', 1); feel.update(.03); assert.ok(g.scale.y < depositScale(1, 10).y && g.quaternion.w < 1); const held = g.scale.toArray(); feel.update(0); assert.deepEqual(g.scale.toArray(), held);
 feel.update(.5); assert.equal(feel.punching, 0); assert.deepEqual(g.scale.toArray(), [depositScale(1, 10).xz, depositScale(1, 10).y, depositScale(1, 10).xz]); assert.equal(g.quaternion.w, 1);
 // The last block: the stock is 0 at once (no collider), the model collapses for CRUMBLE_S, then hides and redraws the shadow once.
 feel.setAmount('stone-x', 0, 10); assert.equal(g.visible, false); feel.crumble('stone-x'); assert.equal(g.visible, true); assert.equal(mesh.geometry.drawRange.count, 36);
 feel.update(CRUMBLE_S / 2); assert.ok(g.scale.y < depositScale(0, 10).y && g.position.y < 0); feel.setAmount('stone-x', 0, 10); assert.equal(g.visible, true, 'a refresh during the collapse keeps it');
 assert.equal(shadows, 0); feel.update(CRUMBLE_S); assert.equal(g.visible, false); assert.equal(shadows, 1); assert.equal(g.position.y, 0); assert.equal(feel.crumbling, 0);
 // Reduced motion: no punch, the crumble is instant.
 reduced = true; feel.setAmount('stone-x', 3, 10); feel.impact('stone-x', 1); assert.equal(feel.punching, 0); feel.setAmount('stone-x', 0, 10); feel.crumble('stone-x'); assert.equal(g.visible, false); assert.equal(feel.crumbling, 0);
});

test('One crack shell: attaches to the aimed deposit, shares its geometry, eases between stages and hides on idle', () => {
 const mat = new THREE.MeshStandardMaterial(), b = new StaticBatch(0, undefined, true), ore = new THREE.MeshStandardMaterial();
 b.add(new THREE.IcosahedronGeometry(1, 2), mat); b.add(new THREE.BoxGeometry(.2, .2, .2), ore); const g = new THREE.Group(); b.finish(g);
 const host = g.children.find(c => (c as THREE.Mesh).material === mat) as THREE.Mesh;
 const feel = createDepositFeel(new Map([['iron-x', g]]), () => {}, () => false);
 feel.prewarm(); assert.equal(feel.shell.visible, true, 'compiled during loading'); feel.update(.016); assert.equal(feel.shell.visible, false);
 feel.setCrack('iron-x', 1 / 3, new THREE.Vector3(1, 0, 0)); assert.equal(feel.shell.parent, g); assert.equal(feel.shell.geometry, host.geometry, 'the largest mesh, no copy');
 feel.update(0); assert.equal(feel.crackLevel, 0, 'frozen in pause'); for (let i = 0; i < 20; i++) feel.update(.016); assert.ok(Math.abs(feel.crackLevel - 1 / 3) < .01);
 const raycaster = new THREE.Raycaster(new THREE.Vector3(5, 0, 0), new THREE.Vector3(-1, 0, 0)); g.updateMatrixWorld(true);
 assert.ok(raycaster.intersectObject(g, true).every(h => h.object !== feel.shell), 'the shell is never hit by the strike raycast');
 feel.setCrack(null); assert.equal(feel.shell.visible, false); assert.equal(feel.crackLevel, 0);
});
