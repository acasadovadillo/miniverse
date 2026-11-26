// The pause's Progress tab (docs/planes/realismo/PLAN-R9-menus.md §3.4): Overview (how much of everything is done, with a
// bar for each part), Statistics, Achievements and Records. Built when it is shown.
//   progressParts  what the completion is made of: { id, label (its key), w (its weight), get(game) → [done, total] or null
//                  (not there), goto: 'tab:page' }. The completion is the mean of done/total, weighted
//   recordSources  functions of the game that give records: [{ group (a key), label, value, sub?, icon? (an item's) }]
import { t, fmt } from '../i18n.js';
import { FISH } from '../items.js';
import { RECIPES } from '../recipes.js';
import { ACH, COLLECTED_ALL } from '../progress.js';
import { fishName, kgText } from '../fishing.js';
import { levelOf } from '../horse.js';
import { itemIconUrl } from '../art/items.js';
import { reportFault } from '../faults.js';
import { esc } from './brief.js';

// The planet's places have no end one could count to: this many is "explored"
export const PLACES_GOAL = 30;
const recipesAll = () => RECIPES.filter(r => !r.variant && !r.more);
const knownFish = g => Object.keys(FISH).filter(id => g.collection.got.has(id) || g.fishing.records[id]).length;
export const progressParts = [
  { id: 'achievements', label: 'gui.progress.part.achievements', w: 3, get: g => [g.achievements.got.size, ACH.length], goto: 'progress:achievements' },
  { id: 'places', label: 'gui.progress.part.places', w: 2, get: g => [g.places.found.size, PLACES_GOAL], goto: 'map' },
  { id: 'collections', label: 'gui.progress.part.collections', w: 2, get: g => [g.collection.got.size, COLLECTED_ALL], goto: 'journal:colecciones' },
  { id: 'nature', label: 'gui.progress.part.nature', w: 2, get: g => { if (!g.nature || g.nature.off) return null; const c = g.nature.count(); return [c.n, c.total]; }, goto: 'journal:nature' },
  { id: 'fish', label: 'gui.progress.part.fish', w: 1, get: g => [knownFish(g), Object.keys(FISH).length], goto: 'journal:pesca' },
  { id: 'recipes', label: 'gui.progress.part.recipes', w: 1, get: g => { const all = recipesAll(); return [all.filter(r => g.craft.known.has(r.id)).length, all.length]; } },
];
// { parts: [{ id, label, goto, done, total, k }], pct } (pct: 0 to 100; 100 only when everything is done)
export function completion(game) {
  const parts = [];
  let sum = 0, w = 0;
  for (const p of progressParts) {
    let v = null;
    try { v = p.get(game); } catch (e) { reportFault(e, `Progress.${p.id}`); }
    if (!Array.isArray(v) || !(v[1] > 0)) continue;
    const total = v[1], done = Math.max(0, Math.min(total, v[0] || 0)), k = done / total, pw = p.w > 0 ? p.w : 1;
    parts.push({ id: p.id, label: p.label, goto: p.goto, done, total, k });
    sum += k * pw; w += pw;
  }
  const raw = w ? sum / w * 100 : 0;
  return { parts, pct: raw >= 100 - 1e-9 ? 100 : Math.min(99, Math.round(raw)) };
}

// The statistics, in groups (their names: stat.<id>; the ids are the save's)
export const STAT_GROUPS = [
  ['work', ['talados', 'picados', 'cosechas', 'piezas', 'cocinados', 'productos']],
  ['nature', ['peces', 'cazados', 'criaturas', 'trailsFollowed', 'mascotas']],
  ['village', ['encargos', 'regalos', 'proyectos', 'jobs_done', 'games_played', 'games_won', 'games_coins', 'ganado', 'donados']],
  ['travel', ['lugares', 'profundidad', 'tesoros', 'cofres', 'templos', 'faros']],
];
// (what no longer goes up: the village's projects, gone since the village is built from day one; shown only if a game has some)
const GONE_STATS = new Set(['proyectos']);
export function playedText(ms) { const m = Math.floor((ms || 0) / 60000); return t('gui.progress.played_for', { h: Math.floor(m / 60), m: m % 60 }); }

// ---------- records ----------
export const recordSources = [
  // The biggest of each fish (the angler's log), the heaviest first
  g => {
    const T = g.fishing;
    return Object.entries(T.records || {}).filter(([id, cm]) => FISH[id] && cm > 0).map(([id, cm]) => {
      const r = T.log?.rec?.[id], kg = r?.[1] > 0 ? r[1] / 1000 : 0;
      const when = r?.[2] > 0 ? fmt.date(r[2] * 86400000, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
      return { group: 'gui.progress.record.fish', label: fishName(id), icon: id, value: `${fmt.num(cm)} cm`, sub: [kg ? `${kgText(kg)} kg` : '', when].filter(Boolean).join(' · '), kg };
    }).sort((a, b) => b.kg - a.kg);
  },
  // The deepest cave
  g => { const n = g.stats.get('profundidad'); return n > 0 ? [{ group: 'gui.progress.record.more', label: t('gui.progress.record.cave'), value: t('gui.progress.record.cave_level', { n }) }] : []; },
  // Your horse with the closest bond
  g => {
    if (!g.horse || g.horse.off) return [];
    const best = (g.ranch?.animals || []).filter(a => a.def?.ride && !a.stray && g.ranch.mine(a.type).includes(a)).sort((a, b) => b.love - a.love)[0];
    return best ? [{ group: 'gui.progress.record.more', label: t('gui.progress.record.horse', { name: best.name }), value: t('skill.level', { n: levelOf(best.love) }) }] : [];
  },
];
function records(game) {
  const out = new Map();
  for (const fn of recordSources) {
    let list = [];
    try { list = fn(game) || []; } catch (e) { reportFault(e, 'Progress.record'); }
    for (const r of list) { const k = r.group || 'gui.progress.record.more'; if (!out.has(k)) out.set(k, []); out.get(k).push(r); }
  }
  return out;
}

// ---------- the pages ----------
function overviewHtml(game) {
  const C = completion(game);
  const rows = C.parts.map(p => {
    const tag = p.goto ? `button type="button" data-goto="${esc(p.goto)}"` : 'div';
    return `<${tag} class="pg-part${p.k >= 1 ? ' full' : ''}" data-part="${esc(p.id)}"><span>${esc(t(p.label))}</span><b>${fmt.num(p.done)}<small> / ${fmt.num(p.total)}</small></b><span class="pg-bar"><b style="width:${p.k * 100}%"></b></span></${p.goto ? 'button' : 'div'}>`;
  }).join('');
  const fact = (k, v) => `<div><small>${t(k)}</small><b>${v}</b></div>`;
  const pct = esc(t('gui.progress.complete', { n: '\u0001' })).split('\u0001');   // (the number in its own size, wherever the language puts it)
  return `<div class="pg-total"><p><strong>${fmt.num(C.pct)}</strong><span>${pct.join(' ').trim()}</span></p><span class="pg-bar seg"><b style="width:${C.pct}%"></b></span></div>${rows}` +
    `<div class="pg-facts">${fact('gui.progress.days', fmt.num(game.days.dayIndex + 1))}${fact('gui.progress.played', playedText(game.playTime?.ms))}${fact('stat.ganado', fmt.num(Math.round(game.stats.get('ganado'))))}</div>`;
}
function statsHtml(game) {
  const row = (name, v) => `<div class="j-row"><b>${name}</b><span class="lvl">${v}</span></div>`;
  const groups = STAT_GROUPS.map(([g, ids]) => `<section><h3>${t(`gui.progress.group.${g}`)}</h3>${ids.filter(k => !GONE_STATS.has(k) || game.stats.get(k) > 0).map(k => row(t(`stat.${k}`), fmt.num(Math.round(game.stats.get(k))))).join('')}</section>`);
  return `<div class="pg-cols">${groups.join('')}</div><div class="pg-facts"><div><small>${t('gui.progress.days')}</small><b>${fmt.num(game.days.dayIndex + 1)}</b></div><div><small>${t('gui.progress.played')}</small><b>${playedText(game.playTime?.ms)}</b></div></div>`;
}
function recordsHtml(game) {
  const all = records(game);
  if (!all.size) return `<p class="j-note">${t('gui.progress.record.none')}</p>`;
  return [...all].map(([key, list]) => `<h3>${t(key)}</h3>` + list.map(r => `<div class="j-fish pg-rec"><span class="j-cell done">${r.icon ? `<img alt="" data-icon="${esc(r.icon)}">` : '★'}</span><span><b>${esc(r.label)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span><span class="lvl">${esc(r.value)}</span></div>`).join('')).join('');
}
const PAGE_LIST = [
  { id: 'overview', label: 'gui.progress.overview', html: overviewHtml },
  { id: 'stats', label: 'gui.progress.stats', html: statsHtml },
  { id: 'achievements', label: 'gui.progress.achievements', html: g => `<div class="pg-cols ach">${g.achievements.journal()}</div>` },
  { id: 'records', label: 'gui.progress.records', html: recordsHtml },
];
export function initProgressPage(game) {
  let current = 'overview';
  return {
    get pages() { return PAGE_LIST; },
    get current() { return current; },
    open(id) { if (PAGE_LIST.some(p => p.id === id)) current = id; },
    fill(el) {
      el.innerHTML = PAGE_LIST.find(p => p.id === current).html(game);
      el.querySelectorAll('[data-icon]').forEach(img => { img.src = itemIconUrl(img.dataset.icon); });
    },
    hide() {},
  };
}
