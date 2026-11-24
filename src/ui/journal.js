// Diario (tecla J): la historia, los vecinos, las habilidades, las colecciones, los logros y las estadísticas.
import { itemIconUrl } from '../art/items.js';
import { itemNoun } from '../items.js';
import { PEOPLE } from '../neighbors.js';
import { warmthOf } from '../clothing.js';
import { t, tHtml, has, fmt } from '../i18n.js';

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

export function initJournalUI(game, { onClose }) {
  const TABS = {
    pasos: ['Primeros pasos', () => game.steps.journal()],
    historia: ['Historia', () => game.story.journal()],
    vecinos: ['Vecinos', () => game.rep.journal() + game.neighbors.journal()],   // (the village's reputation on top: reputation.js)
    habilidades: ['Habilidades', () => game.skills.journal()],
    granja: ['Granja', () => game.farm.journal() + game.ranch.journal()],
    pesca: ['Pesca', () => game.fishing.journal()],
    colecciones: ['Colecciones', () => game.collection.journal()],
    logros: ['Logros', () => game.achievements.journal()],
    datos: ['Estadísticas', () => bodyBox(game) + `<p class="j-note">Día ${game.days.dayIndex + 1} · ${game.money} monedas</p>` + Object.entries(STAT_NAMES).map(([k, n]) => `<div class="j-row"><b>${n}</b><span class="lvl">${Math.round(game.stats.get(k))}</span></div>`).join('')],
  };
  let tab = 'historia';
  $('j-body').addEventListener('click', e => { if (e.target.closest?.('[data-steps-restart]')) { game.steps.restart(); render(); } });
  for (const [k, [name]] of Object.entries(TABS)) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = name; b.dataset.jtab = k;
    b.onclick = () => { tab = k; render(); };
    $('j-tabs').append(b);
  }
  function render() {
    document.querySelectorAll('[data-jtab]').forEach(b => b.classList.toggle('on', b.dataset.jtab === tab));
    $('j-body').innerHTML = TABS[tab][1]();
    if (tab === 'vecinos') addMemories(game, $('j-body'));
    $('j-body').querySelectorAll('[data-icon]').forEach(img => { img.src = itemIconUrl(img.dataset.icon); });
  }
  $('j-close').onclick = () => onClose();
  return { open() { render(); } };
}
