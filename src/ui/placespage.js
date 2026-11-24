// The journal's Places page (journal.js, JOURNAL_PAGES; Plan R7-1): a card per discovered place with its name, its state,
// its history and the day it was found, grouped by kind. Where they are and what they are called: explore.js (describe)
import { CENTER } from '../world/village.js';
import { distOf } from '../world/planet.js';
import { placeKind } from '../explore.js';
import { t, tHtml, fmt } from '../i18n.js';

const ORDER = ['aldea', 'torre', 'faro', 'templo', 'cueva', 'campamento', 'barco'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const away = m => (m >= 1000 ? `${fmt.num(m / 1000, { maximumFractionDigits: 1 })} km` : `${fmt.num(Math.round(m / 10) * 10)} m`);

export function placesHtml(game) {
  const P = game.places, list = P.knownPlaces().map(p => ({ p, d: distOf(p.x, p.y, CENTER.x, CENTER.y), ...P.describe(p) }));
  const gone = P.found.size - list.length;
  const note = gone > 0 ? `<p class="j-note">${tHtml('journal.places.gone', { n: gone })}</p>` : '';
  if (!list.length) return `<p class="j-note">${tHtml('journal.places.none')}</p>${note}`;
  const card = q => {
    const line = [q.state, t('journal.places.away', { dist: away(q.d) }), q.at > 0 ? t('journal.places.found', { date: fmt.date(q.at * 86400000, { day: 'numeric', month: 'short', timeZone: 'UTC' }) }) : ''].filter(Boolean).join(' · ');
    return `<div class="j-row j-place" data-place="${esc(q.p.key)}"><b>${esc(q.title)}</b><small>${esc(q.story)}</small><small>${esc(line)}</small></div>`;
  };
  return `<p class="j-note">${tHtml('journal.places.count', { n: list.length })}</p>` + ORDER.map(kind => {
    const some = list.filter(q => q.p.kind === kind).sort((a, b) => (b.at || 0) - (a.at || 0) || a.d - b.d);
    return some.length ? `<h3>${tHtml('journal.places.group', { kind: placeKind(kind), n: some.length })}</h3>${some.map(card).join('')}` : '';
  }).join('') + note;
}
