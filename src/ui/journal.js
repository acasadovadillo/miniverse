// The journal (J): its pages, in the pause's Journal tab (src/ui/pausehub.js): a list on the left (#j-tabs) and the page
// on the right (#j-body): story, first steps, neighbours, farm and animals, fishing, nature, places and collections. The skills
// are in the Character tab, and the achievements and the statistics in Progress: MOVED says where, for who still opens them
// by their old page.
// JOURNAL_PAGES is the registry: another system adds its page with JOURNAL_PAGES.push({ id, label, html, … }):
//   id       what game.openJournal(id) opens       label    its key, for the list
//   html(game) → the page                           bind(el, game)   after it is written (listeners, canvases)
//   hide(game)  when another page or tab is shown, or the pause closes
//   open(game, sub)  before it is written, when a part of it was asked for (game.openJournal(id, sub))
//   when(game)  false: not in the list now
import { itemIconUrl } from '../art/items.js';
import { itemNoun } from '../items.js';
import { PEOPLE } from '../neighbors.js';
import { t, tHtml, has } from '../i18n.js';
import { NatureBookUI } from './naturebook.js';
import { placesHtml } from './placespage.js';
import { bizJournal } from './shopadmin.js';
import { apagada } from '../opciones.js';
import { reportFault } from '../faults.js';

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

let book = null;   // (the nature book's screen: made with the journal, below)
export const JOURNAL_PAGES = [
  { id: 'historia', label: 'journal.tab.story', html: g => g.story.journal() },
  { id: 'pasos', label: 'journal.tab.steps', html: g => g.steps.journal() },
  { id: 'vecinos', label: 'journal.tab.neighbors', html: g => g.rep.journal() + (g.huntcode?.journal() || '') + (g.gossip?.journal() || '') + g.neighbors.journal(), bind: (el, g) => addMemories(g, el) },   // (the village's reputation on top: reputation.js; what people say about you: gossip.js)
  { id: 'granja', label: 'journal.tab.farm', html: g => g.farm.journal() + g.ranch.journal() },
  { id: 'pesca', label: 'journal.tab.fishing', html: g => g.fishing.journal() },
  // (the nature book, Plan G: src/ui/naturebook.js)
  { id: 'nature', label: 'journal.tab.nature', when: () => !!book, open: (g, id) => book.page(id), html: () => book.html(), bind: el => book.bind(el), hide: () => book?.hide() },
  { id: 'places', label: 'journal.tab.places', html: g => placesHtml(g) },   // (Plan R7-1: src/ui/placespage.js)
  { id: 'business', label: 'biz.tab.journal', when: g => !!g.business?.list().some(e => g.business.mine(e.rec)), html: g => bizJournal(g) },   // (Plan H2: your shop and your tavern)
  { id: 'colecciones', label: 'gui.progress.part.collections', html: g => g.collection.journal() },
];
// The pages that are somewhere else in the pause: [tab, page]
export const MOVED = { habilidades: ['char'], logros: ['progress', 'achievements'], datos: ['progress', 'stats'] };

export function initJournalUI(game) {
  book = apagada('naturebook') ? null : new NatureBookUI(game);
  const body = document.getElementById('j-body'), pages = () => JOURNAL_PAGES.filter(p => !p.when || p.when(game));
  let current = 'historia', shown = null;   // (shown: the page written, whose hide is due)
  const page = () => { const all = pages(); return all.find(p => p.id === current) || all[0]; };
  body.addEventListener('click', e => {
    if (e.target.closest?.('[data-steps-restart]')) { game.steps.restart(); fill(body); return; }
    // (a fish, insect or flower cell of Collections opens its page of the nature book: progress.js data-nature)
    const cell = book && current !== 'nature' && e.target.closest?.('[data-nature]');
    if (cell) game.openJournal?.('nature', cell.dataset.nature);
  });
  function hide() {
    const p = shown;
    shown = null;
    try { p?.hide?.(game); } catch (e) { reportFault(e, `Journal.${p.id}`); }
  }
  function fill(el) {
    const p = page();
    if (shown && shown !== p) hide();
    el.innerHTML = p.html(game);
    el.querySelectorAll('[data-icon]').forEach(img => { img.src = itemIconUrl(img.dataset.icon); });
    shown = p;
    p.bind?.(el, game);
  }
  return {
    get pages() { return pages(); },
    get current() { return page().id; },
    // open(page, sub): that one will be shown (and, for 'nature', that species): pausehub.js writes it with fill()
    open(id, sub) {
      const p = pages().find(q => q.id === id);
      if (!p) return false;
      current = p.id;
      if (sub !== undefined && sub !== null) { try { p.open?.(game, sub); } catch (e) { reportFault(e, `Journal.${p.id}`); } }
      return true;
    },
    fill, hide,
  };
}
