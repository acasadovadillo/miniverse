// The journal (J): its pages live in the pause's Journal tab (src/ui/pausehub.js), a list on the left (#j-tabs) and the page
// on the right (#j-body): first steps, story, neighbours, skills, farm, fishing, collections, nature, achievements, statistics.
import { itemIconUrl } from '../art/items.js';
import { itemNoun } from '../items.js';
import { PEOPLE } from '../neighbors.js';
import { warmthOf } from '../clothing.js';
import { t, tHtml, has, fmt } from '../i18n.js';
import { NatureBookUI } from './naturebook.js';
import { apagada } from '../opciones.js';

const $ = id => document.getElementById(id);
const DAY_MS = 86400000;

// The Body box on top of the statistics (Plan E §7.2): the felt temperature, the clothes' warmth, how clean you are and
// the days since the last haircut and shave. Survival only (in creative the body does not count)
function bodyBox(game) {
  const b = game.body;
  if (!b?.counts) return '';
  const parts = [`<h3>${t('journal.body.title')}</h3>`];
  if (b.weatherOn) {
    const c = Math.round(b.feelC), cls = b.cold >= 0.35 ? 'cold' : b.heat >= 0.35 ? 'hot' : '';
    parts.push(`<span class="${cls}">${t('journal.body.feels', { c: fmt.num(c) })}</span>`);
  }
  parts.push(`<span>${t('journal.body.warmth', { n: fmt.num(warmthOf(game.inv?.equip), { maximumFractionDigits: 1 }) })}</span>`);
  const dirty = typeof b.washable === 'function' && b.washable();
  parts.push(`<span class="${dirty ? 'dirty' : ''}">${t(dirty ? 'journal.body.dirty' : 'journal.body.clean')}</span>`);
  const now = Date.now(), days = at => Math.max(0, Math.floor((now - at) / DAY_MS));
  if (Number.isFinite(b.cutAt)) parts.push(`<span>${t('journal.body.hair', { n: days(b.cutAt) })}</span>`);
  if (Number.isFinite(b.shaveAt) && game.player?.look?.sex === 'chico') parts.push(`<span>${t('journal.body.shave', { n: days(b.shaveAt) })}</span>`);
  return `<div class="j-bodybox">${parts.join('')}</div>`;
}

// A neighbour's latest memory as the journal's line ("Remembers: the strawberries you gave them"), or ''. It reads
// neighbors.memories(id) (Plan E §4.5, Track C): entries [day, kind, item?, said?] (or { day, kind, item }), newest last
function memoryLine(game, id) {
  const list = game.neighbors?.memories?.(id);
  const m = list?.length ? list[list.length - 1] : null;
  if (!m) return '';
  const kind = Array.isArray(m) ? m[1] : m.kind, item = Array.isArray(m) ? m[2] : m.item;
  if (typeof kind !== 'string') return '';
  const gift = kind === 'gift_loved' || kind === 'gift_hated';
  const key = gift && !item ? 'journal.mem.gift' : `journal.mem.${kind}`;
  if (!has(key)) return '';   // (a kind from a newer game: say nothing rather than something wrong)
  return tHtml('journal.remembers', { what: t(key, item ? { item: itemNoun(item) } : undefined) });
}
// Under each friend in the Neighbours tab, the latest memory. The rows come from neighbors.journal() (Track C): a row
// says whose it is with data-npc; an older row without it is found by the name in its <b>
let byName = null;   // (made on first use: no work at import time)
function addMemories(game, box) {
  byName ||= new Map(Object.entries(PEOPLE).map(([id, d]) => [d.name, id]));
  for (const row of box.querySelectorAll('.j-row')) {
    const id = row.dataset.npc || byName.get(row.querySelector('b')?.textContent);
    if (!id || !PEOPLE[id]) continue;
    const html = memoryLine(game, id);
    if (!html) continue;
    const el = document.createElement('small');
    el.className = 'j-mem';
    el.innerHTML = html;
    row.append(el);
  }
}

const STAT_NAMES = { talados: 'Árboles talados', picados: 'Rocas picadas', cosechas: 'Cosechas', peces: 'Peces', tesoros: 'Tesoros del agua', criaturas: 'Criaturas derrotadas', cofres: 'Cofres abiertos', lugares: 'Lugares descubiertos', profundidad: 'Nivel más hondo de cueva', encargos: 'Encargos cumplidos', regalos: 'Regalos hechos', piezas: 'Piezas construidas', cocinados: 'Platos cocinados', productos: 'Productos de la granja', mascotas: 'Mascotas adoptadas', ganado: 'Monedas ganadas', donados: 'Piezas donadas' };

export function initJournalUI(game) {
  const natureBook = apagada('naturebook') ? null : new NatureBookUI(game);   // (the Nature tab, Plan G: src/ui/naturebook.js)
  const TABS = {
    pasos: ['journal.tab.steps', () => game.steps.journal()],
    historia: ['journal.tab.story', () => game.story.journal()],
    vecinos: ['journal.tab.neighbors', () => game.rep.journal() + game.neighbors.journal()],   // (the village's reputation on top: reputation.js)
    habilidades: ['gui.char.skills', () => game.skills.journal()],
    granja: ['journal.tab.farm', () => game.farm.journal() + game.ranch.journal()],
    pesca: ['journal.tab.fishing', () => game.fishing.journal()],
    colecciones: ['gui.progress.part.collections', () => game.collection.journal()],
    ...(natureBook ? { nature: ['journal.tab.nature', () => natureBook.html()] } : {}),
    logros: ['gui.progress.achievements', () => game.achievements.journal()],
    datos: ['gui.progress.stats', () => bodyBox(game) + `<p class="j-note">Día ${game.days.dayIndex + 1} · ${game.money} monedas</p>` + Object.entries(STAT_NAMES).map(([k, n]) => `<div class="j-row"><b>${n}</b><span class="lvl">${Math.round(game.stats.get(k))}</span></div>`).join('')],
  };
  let tab = 'historia';
  $('j-body').addEventListener('click', e => {
    if (e.target.closest?.('[data-steps-restart]')) { game.steps.restart(); render(); return; }
    // (a fish, insect or flower cell of Collections opens its page of the nature book: progress.js data-nature)
    const cell = natureBook && tab !== 'nature' && e.target.closest?.('[data-nature]');
    if (cell) game.openJournal?.('nature', cell.dataset.nature);
  });
  // (the rows of the list: pausehub.js makes the list of them, which moves and picks)
  for (const [k, [key]] of Object.entries(TABS)) {
    const row = document.createElement('div'), name = document.createElement('span');
    name.dataset.i18n = key; name.textContent = t(key);
    row.dataset.jtab = row.dataset.page = k;
    row.append(name);
    $('j-tabs').append(row);
  }
  // A page in any element (the pause's Character and Progress tabs show some too, with something before it)
  function fill(el, id, before = '') {
    el.innerHTML = before + TABS[id][1]();
    if (id === 'vecinos') addMemories(game, el);
    el.querySelectorAll('[data-icon]').forEach(img => { img.src = itemIconUrl(img.dataset.icon); });
  }
  function render() {
    document.querySelectorAll('[data-jtab]').forEach(b => b.classList.toggle('on', b.dataset.jtab === tab));
    fill($('j-body'), tab);
    if (natureBook) { if (tab === 'nature') natureBook.bind($('j-body')); else natureBook.hide(); }
  }
  // open(): the page shown last; open(page, id): that one (and, for 'nature', that species' page). It only renders the
  // body: the caller shows the tab (game.openJournal, menus.js)
  function open(to, id) {
    if (to && TABS[to] && to !== tab) { tab = to; $('j-body').scrollTop = 0; }
    if (to === 'nature' && id) natureBook?.page(id);
    render();
  }
  return { open, fill, pages: Object.keys(TABS), bodyBox: () => bodyBox(game), hide: () => natureBook?.hide(), get current() { return tab; } };
}
