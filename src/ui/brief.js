// The pause's Brief tab (docs/planes/realismo/PLAN-R9-menus.md §3.4): what there is to do and what you were told.
//   Objective  the first step you are on, the marked route, the lighthouse keeper's pages, and what other systems add
//   Dialogue   the last lines said to you, with who said them (hud.log.said)
//   Notices    the last notices (hud.log.notes); the same one again counts ×n
//   Chat       the chat's last lines (chat.history)
// briefSources: functions of the game that give one objective, several or nothing (a job, a delivery…):
//   { title, text, hint?, done?: [n, total] (count: false, only its bar), goto?: 'tab:page' (what a click opens) }
// Built when it is shown; while it is in sight, a new line paints it again (pausehub.js).
import { t, fmt } from '../i18n.js';
import { portrait3D, portraitReady } from '../three/portrait.js';
import { nearX } from '../world/planet.js';
import { PAGES as STORY_PAGES } from '../progress.js';
import { STEPS } from '../steps.js';
import { reportFault } from '../faults.js';
import { hud } from './hud.js';

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// "just now", "3 min ago", "2 h ago"
export function ago(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return t('gui.brief.now');
  const [n, unit] = s < 5400 ? [Math.max(1, Math.round(s / 60)), 'minute'] : [Math.round(s / 3600), 'hour'];
  return t('gui.brief.ago', { t: fmt.num(n, { style: 'unit', unit, unitDisplay: 'short' }) });
}

// ---------- what there is to do ----------
export const briefSources = [
  // The first step they are on
  g => {
    const S = g.steps, st = S && !S.over ? S.step : null;
    if (!st) return null;
    return { title: t('steps.title', { n: S.i + 1, total: STEPS.length }), text: st.text, hint: S.hintOf(st), done: S.progress(st), goto: 'journal:pasos' };
  },
  // The marked route (straight: the way along the roads is the map's)
  g => {
    const R = g.route, p = g.player;
    if (!R?.active || !p || g.scene !== g.world) return null;
    const m = Math.round(Math.hypot(nearX(R.target.x, p.x) - p.x, R.target.y - p.y));
    return { title: t('gui.brief.way'), text: t('gui.brief.route', { place: R.target.name || `${Math.round(R.target.x)}, ${Math.round(R.target.y)}`, m: fmt.num(m) }), goto: 'map' };
  },
];
function objectives(game) {
  const out = [];
  for (const fn of briefSources) {
    try { for (const o of [fn(game)].flat()) if (o) out.push(o); } catch (e) { reportFault(e, 'Brief.source'); }
  }
  return out;
}
const bar = ([n, total]) => `<span class="pg-bar"><b style="width:${total > 0 ? Math.max(0, Math.min(100, n / total * 100)) : 0}%"></b></span>`;
function card(o) {
  const tag = o.goto ? `button type="button" data-goto="${esc(o.goto)}"` : 'div';
  const n = o.done && o.count !== false ? ` <em>${Math.max(0, o.done[0])}/${o.done[1]}</em>` : '';
  return `<${tag} class="pg-card"><small class="pg-kick">${esc(o.title)}</small><strong>${esc(o.text)}${n}</strong>${o.hint ? `<span>${esc(o.hint)}</span>` : ''}${o.done ? bar(o.done) : ''}</${o.goto ? 'button' : 'div'}>`;
}
function objectiveHtml(game) {
  const list = objectives(game), st = game.story, pages = st?.pages || 0;
  // (the story goes on in the background: it is not "something pending")
  const story = pages < STORY_PAGES ? card({ title: t('journal.tab.story'), text: t('gui.brief.story_pages', { n: pages, total: STORY_PAGES }), hint: t('story.goal'), done: [pages, STORY_PAGES], count: false, goto: 'journal:historia' }) : '';
  return `<h3>${t('gui.brief.objective')}</h3>${list.map(card).join('') || `<p class="j-note">${t('gui.brief.none')}</p>`}${story}`;
}

// ---------- what you were told ----------
// (the newest on top; what somebody said in a row goes together)
function dialogueHtml() {
  const said = hud.log.said;
  if (!said.length) return `<p class="j-note">${t('gui.brief.no_dialogue')}</p>`;
  const talks = [], now = Date.now();
  for (const s of said) {
    const last = talks[talks.length - 1];
    if (last && last.name === s.name && s.at - last.at < 60000) { last.lines.push(s.line); last.at = s.at; } else talks.push({ name: s.name, at: s.at, lines: [s.line] });
  }
  return talks.reverse().map(k => `<div class="pg-talk"><canvas width="96" height="96" data-face="${esc(k.name)}" aria-hidden="true"></canvas><div><b>${esc(k.name)}</b><small>${ago(k.at, now)}</small>${k.lines.map(l => `<p>${esc(l)}</p>`).join('')}</div></div>`).join('');
}
function noticesHtml() {
  const notes = hud.log.notes, now = Date.now();
  if (!notes.length) return `<p class="j-note">${t('gui.brief.no_notices')}</p>`;
  return [...notes].reverse().map(n => `<div class="pg-note k-${esc(n.kind || 'plain')}"><span>${esc(n.text)}${n.n > 1 ? ` <em>${t('gui.brief.times', { n: n.n })}</em>` : ''}</span><small>${ago(n.at, now)}</small></div>`).join('');
}
function chatHtml(game) {
  const lines = game.chat?.history || [], now = Date.now();
  if (!lines.length) return `<p class="j-note">${t('gui.brief.no_chat')}</p>`;
  return [...lines].reverse().map(l => `<div class="pg-note ${esc(l.kind)}"><span>${esc(l.text)}</span><small>${ago(l.at, now)}</small></div>`).join('');
}

const PAGE_LIST = [
  { id: 'objective', label: 'gui.brief.objective', html: objectiveHtml },
  { id: 'dialogue', label: 'gui.brief.dialogue', html: dialogueHtml, log: 'said' },
  { id: 'notices', label: 'gui.brief.notices', html: noticesHtml, log: 'notes' },
  { id: 'chat', label: 'gui.brief.chat', html: chatHtml, log: 'chat' },
];
// The faces: those the dialogues already painted, at once; the others, in idle time (one at a time: pausehub.js soon)
export function paintFaces(el, soon) {
  for (const cv of el.querySelectorAll('[data-face]')) {
    const look = hud.faces[cv.dataset.face];
    if (!look) { cv.classList.add('none'); continue; }
    const put = () => { try { const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height); c.drawImage(portrait3D(look), 0, 0, cv.width, cv.height); } catch (e) { reportFault(e, 'Brief.face'); } };
    if (portraitReady(look)) put(); else soon(() => { if (cv.isConnected) put(); });
  }
}
export function initBrief(game, { soon }) {
  let current = 'objective';
  return {
    get pages() { return PAGE_LIST; },
    get current() { return current; },
    open(id) { if (PAGE_LIST.some(p => p.id === id)) current = id; },
    fill(el) {
      const p = PAGE_LIST.find(q => q.id === current);
      el.innerHTML = p.html(game);
      if (p.id === 'dialogue') paintFaces(el, soon);
    },
    // Does what changed ('said', 'notes', 'chat') show on this page?
    shows: what => PAGE_LIST.find(q => q.id === current).log === what,
    hide() {},
  };
}
