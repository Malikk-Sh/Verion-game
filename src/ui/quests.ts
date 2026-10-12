import './quests.css';
import { refreshQuestProgress, questStatus, questParents } from '../game/quests';
import { QUEST_BY_ID, type QuestId } from '../game/questCatalog';
import { CHAPTERS, GUIDE_ORDER, guideStep, currentStep, progressCount, type GuideStep, type GuideTask, type GuideTarget } from '../game/guide';
import { RECIPE_BY_ID, WORKBENCH_UPGRADE } from '../game/production';
import { countItem } from '../game/inventory';
import { ITEMS } from '../game/defs';
import type { GameState } from '../game/state';
import { itemArt } from './art';

type Host = { game: () => GameState | null; show: () => void; close: () => void; changed: () => void; tone: () => void; craft?: (recipeId: string) => void; navigate?: (target: GuideTarget | null) => void };
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
const STATUS = { done: 'Выполнено', ready: 'Доступно', locked: 'Позже' } as const;
const name = (id: string) => ITEMS[id]?.name ?? ({ water: 'Вода', oxygen: 'Кислород', hydrogen: 'Водород' } as Record<string, string>)[id] ?? id;
const plain = (id: QuestId) => QUEST_BY_ID.get(id)!.label.replace(/\n/g, ' ');

/**
 * Expedition journal (S3): chapters of concrete steps instead of a node graph. The list shows
 * what is done, current and later; the card explains why, what exactly to collect (live counters),
 * how to do it, the recipes involved, and can point the compass at the next place to go.
 */
export function createQuestBook(host: Host) {
 const list = el('journal-list'), detail = el('journal-detail');
 let selected: QuestId | null = null, signature = '';
 function taskRow(g: GameState, t: GuideTask) {
  const row = h('li', '', 'journal-task' + (t.done ? ' done' : ''));
  row.append(h('i', t.done ? '✓' : '', 'journal-check'));
  const body = h('div', '', 'journal-task-body');
  const head = h('div', '', 'journal-task-head'); head.append(h('span', t.label, 'journal-task-label'));
  if (t.need > 1) head.append(h('b', `${t.have} / ${t.need}${t.unit ? ' ' + t.unit : ''}`, 'journal-count'));
  body.append(head);
  if (t.need > 1) { const bar = h('i', '', 'journal-bar'); const fill = h('b'); fill.style.transform = `scaleX(${Math.min(1, t.have / t.need)})`; bar.append(fill); body.append(bar); }
  row.append(body);
  if (!t.done && t.target) {
   const go = h('button', `${Math.round(Math.hypot(t.target.x - g.player.x, t.target.z - g.player.z))} м`, 'journal-go'); go.type = 'button';
   go.title = 'Показать на компасе: ' + t.target.name; go.setAttribute('aria-label', go.title);
   go.prepend(svgIcon('i-arrow'));
   go.onclick = () => { host.navigate?.(t.target!); host.tone(); host.close(); };
   row.append(go);
  }
  return row;
 }
 function recipeCard(g: GameState, recipeId: string) {
  const card = h('div', '', 'journal-recipe');
  if (recipeId === 'upgrade') {
   card.append(itemArt('workbench_2', 'art journal-recipe-art'));
   const ins = h('div', '', 'journal-ingredients');
   for (const [id, n] of Object.entries(WORKBENCH_UPGRADE.inputs)) ins.append(ingredient(g, id, n));
   card.append(h('span', 'Улучшение верстака', 'journal-recipe-name'), ins);
   return card;
  }
  const r = RECIPE_BY_ID.get(recipeId); if (!r) return card;
  const out = Object.keys(r.outputs)[0];
  card.append(itemArt(out, 'art journal-recipe-art'));
  const info = h('div', '', 'journal-recipe-info');
  info.append(h('span', `${name(out)}${r.outputs[out] > 1 ? ' ×' + r.outputs[out] : ''}`, 'journal-recipe-name'), h('small', r.station === 'hand' ? 'В кармане' : r.station === 'kiln' ? 'Плавильная печь' : r.station === 'electrolyzer' ? 'Генератор кислорода' : 'Верстак', 'journal-recipe-station'));
  const ins = h('div', '', 'journal-ingredients');
  for (const [id, n] of Object.entries(r.inputs)) ins.append(ingredient(g, id, n));
  info.append(ins); card.append(info);
  if (host.craft && (r.station === 'hand' || r.station === 'workbench')) { const b = h('button', 'Крафт', 'journal-craft'); b.type = 'button'; b.onclick = () => { host.tone(); host.craft!(recipeId); }; card.append(b); }
  return card;
 }
 function ingredient(g: GameState, id: string, n: number) {
  const have = id === 'water' ? countItem(g.player.inventory, 'water') : countItem(g.player.inventory, id), chip = h('span', '', 'journal-ingredient' + (have >= n ? ' ok' : ''));
  chip.append(itemArt(id), h('b', `${Math.min(have, 999)}/${n}`)); chip.title = name(id); return chip;
 }
 function svgIcon(id: string) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.append(u); return s; }
 function drawList(g: GameState, current: QuestId | null) {
  list.replaceChildren();
  CHAPTERS.forEach((title, chapter) => {
   const ids = GUIDE_ORDER.filter(id => guideStep(g, id).chapter === chapter); if (!ids.length) return;
   const group = h('section', '', 'journal-chapter');
   const doneCount = ids.filter(id => questStatus(g, id) === 'done').length;
   const head = h('header', '', 'journal-chapter-head'); head.append(h('span', chapter < 5 ? `${chapter + 1}. ${title}` : title), h('small', `${doneCount}/${ids.length}`)); group.append(head);
   for (const id of ids) {
    const status = questStatus(g, id), step = guideStep(g, id), b = h('button', '', 'journal-step');
    b.type = 'button'; b.dataset.quest = id; b.dataset.status = status; b.classList.toggle('current', id === current); b.setAttribute('aria-pressed', String(id === selected));
    const tasks = step.tasks.filter(t => t.done).length;
    b.append(h('i', status === 'done' ? '✓' : id === current ? '●' : '', 'journal-step-mark'), itemArt(step.item, 'art journal-step-art'));
    const text = h('span', '', 'journal-step-text'); text.append(h('b', step.title), h('small', status === 'done' ? 'Выполнено' : status === 'locked' ? 'Сначала: ' + questParents(id).filter(p => !g.progress.quests.completed.includes(p)).map(plain).join(', ') : `${tasks} / ${step.tasks.length}`));
    b.append(text);
    b.onclick = () => { selected = id; host.tone(); draw(true); detail.scrollTop = 0; };
    group.append(b);
   }
   list.append(group);
  });
 }
 function drawDetail(g: GameState, step: GuideStep, current: QuestId | null) {
  detail.replaceChildren();
  const status = questStatus(g, step.id);
  const head = h('header', '', 'journal-detail-head');
  head.append(itemArt(step.item, 'art journal-hero'));
  const titles = h('div'); titles.append(h('span', (step.chapter < 5 ? `Глава ${step.chapter + 1} · ` : '') + CHAPTERS[step.chapter], 'mono tiny kicker'), h('h3', step.title));
  const chip = h('span', step.id === current && status !== 'done' ? 'Текущая цель' : STATUS[status], 'journal-chip ' + (step.id === current && status !== 'done' ? 'current' : status));
  head.append(titles, chip); detail.append(head);
  detail.append(h('p', step.why, 'journal-why'));
  const tasks = h('ul', '', 'journal-tasks'); for (const t of step.tasks) tasks.append(taskRow(g, t)); detail.append(h('h4', 'Что нужно'), tasks);
  const how = h('ol', '', 'journal-how'); for (const line of step.how) how.append(h('li', line)); detail.append(h('h4', 'Как сделать'), how);
  if (step.recipes.length) { const recipes = h('div', '', 'journal-recipes'); for (const r of step.recipes) recipes.append(recipeCard(g, r)); detail.append(h('h4', 'Рецепты'), recipes); }
  const actions = h('div', '', 'journal-actions');
  if (status !== 'done') {
   const pinned = g.progress.quests.tracked === step.id;
   const pin = h('button', pinned ? 'Следовать рекомендации' : 'Сделать текущей', 'journal-pin'); pin.type = 'button';
   pin.onclick = () => { g.progress.quests.tracked = pinned ? null : step.id; host.tone(); host.changed(); draw(true); };
   actions.append(pin);
  }
  detail.append(actions);
 }
 function draw(force = false) {
  const g = host.game(); if (!g) return;
  const current = currentStep(g), sel = selected ?? current ?? GUIDE_ORDER[0];
  const sig = JSON.stringify([g.progress.quests, sel, g.player.inventory, g.world.base.buildings.length, g.world.base.links.length, Math.round(g.player.x / 4), Math.round(g.player.z / 4)]);
  if (!force && sig === signature) return; signature = sig;
  const { done, total } = progressCount(g);
  el('journal-count').textContent = String(done); el('journal-total').textContent = String(total); el('journal-fill').style.transform = `scaleX(${done / total})`;
  drawList(g, current); drawDetail(g, guideStep(g, sel), current);
  list.querySelector(`[data-quest="${sel}"]`)?.setAttribute('aria-pressed', 'true');
  el('quest-announcement').textContent = guideStep(g, sel).title + '. ' + STATUS[questStatus(g, sel)];
 }
 function open(id?: QuestId) {
  const g = host.game(); if (!g) return; if (refreshQuestProgress(g)) host.changed();
  selected = id ?? null; host.show(); draw(true);
  requestAnimationFrame(() => list.querySelector<HTMLElement>('.journal-step[aria-pressed=true], .journal-step.current')?.scrollIntoView({ block: 'center' }));
 }
 el('quest-close').onclick = () => { host.tone(); host.close(); };
 return { open, draw: () => draw(true), refresh: () => draw(false), escape: () => host.close(), reset: () => { selected = null; signature = ''; }, debug: () => ({ selected, current: host.game() ? currentStep(host.game()!) : null }) };
}
