// The Nature tab of the journal (docs/planes/gta/PLAN-G-caza.md §5.2): a list on the left (Animals, Fish, Insects,
// Plants, with counts, and the next reward of the book on top) and a page on the right (the plate, the name, three
// level dots and the facts unlocked so far; an unseen species shows its silhouette, "Not seen yet" and how to find it).
// Its CSS is injected here, so index.html is not touched.
//
// Contract:
//   journal.js makes it once: const natureBook = new NatureBookUI(game); the tab renders natureBook.html() and, after
//   the journal writes it with innerHTML, calls natureBook.bind(body) (clicks, plates arriving, the pump while visible).
//   page(id) chooses the page shown next (journal.open('nature', id) uses it; Collections cells carry data-nature="<id>").
//   hide() stops its plate pump (the journal calls it when another tab opens; closing the pause stops it by itself).
//   Reads game.nature (level, count, knowsTracks), SPECIES (group, facts, tracks) and three/plates.js (plateUrl,
//   pumpPlates, onPlate). It writes nothing outside its own elements.
//
// Facts: SPECIES[id].facts(g) gives [[key, params, minLevel?]]. Each one shows from the level its key belongs to
// (FACT_LEVEL below: habitat at Seen, behaviour at Studied, what it gives at Known) unless it brings its own minLevel.
// A param can be a number, a text, a language key ('nature.biome.3'), a noun ({ noun: 'item.x' }) or an array of those
// (a list: "meadow, forest and swamp").
import { t, tHtml, has, fmt, onLangChange } from '../i18n.js';
import { SPECIES, SPECIES_IDS, GROUPS, REWARDS } from '../nature.js';
import { plateUrl, pumpPlates, onPlate } from '../three/plates.js';
import { itemNoun } from '../items.js';
import { reportFault } from '../faults.js';

const PUMP_EVERY = 2;   // frames between two steps of a plate (three/plates.js draws each one in several short steps)
const PREFETCH = 1;     // pages either side of the one shown whose plates are queued too, so browsing does not wait
// The level from which each fact shows (Plan G §1.2: Seen gives the habitat and the note; Studied the hours, the
// behaviour and the tracks; Known what it gives and the sizes)
const FACT_LEVEL = {
  habitat: 1, seasons: 1, crop_seasons: 1, waters: 1, near_water: 1, in_forest: 1,
  hours: 2, shy: 2, grazes: 2, drinks: 2, rain: 2, tracks: 2, stride: 2, grows: 2, regrows: 2,
  gives: 3, size: 3, size_none: 3,
};
// How to find an unseen one, by group
const HOW = { animal: 'nature.how.look', plant: 'nature.how.look', fish: 'nature.how.catch', bug: 'nature.how.net', sea: 'nature.how.dive' };
const KEYISH = /^[a-z][a-z0-9_]*(\.[\w-]+)+$/;

// The tracks drawings, in the plate's ink: a pair of prints, the left one behind (deer: two slim cloven halves, tips
// forward; boar: rounder halves and the two dew-claw dots behind)
const PRINT = {
  deer: '<path d="M11 2C7 5 5.5 13 6.5 19c.8 3.6 4.3 3.6 4.5.2L11.6 3.4ZM15 2c4 3 5.5 11 4.5 17-.8 3.6-4.3 3.6-4.5.2L14.4 3.4Z"/>',
  boar: '<path d="M11 4C5.5 6.5 4.5 14 6 18.5c1.2 3.3 5.4 2.8 5.6-.4L11.8 5ZM15 4c5.5 2.5 6.5 10 5 14.5-1.2 3.3-5.4 2.8-5.6-.4L14.2 5Z"/><circle cx="6" cy="25" r="1.7"/><circle cx="20" cy="25" r="1.7"/>',
};
const trackSvg = kind => (!PRINT[kind] ? '' : `<svg class="nb-prints" viewBox="0 0 64 56" aria-hidden="true"><g transform="translate(6 24) rotate(-8 13 14)">${PRINT[kind]}</g><g transform="translate(34 2) rotate(-8 13 14)">${PRINT[kind]}</g></svg>`);
// The placeholder while a plate is being drawn (or for good on a game without a view): a faint mark on the paper
const WAIT = '<svg class="nb-wait" viewBox="0 0 40 40" aria-hidden="true"><path d="M8 32c6-2 14-9 20-22 1-2 3-3 4-2s0 3-1 4C25 24 16 30 8 32Zm0 0 4-6"/></svg>';

const CSS = `
#j-body { height: min(62vh, 480px); }
#j-body [data-nature] { cursor: pointer; }
#j-body [data-nature]:hover { border-color: var(--tab-on-line); }
.nb { display: grid; grid-template-columns: minmax(208px, 1fr) 324px; gap: 12px; height: 100%; }
.nb-side { display: flex; flex-direction: column; min-height: 0; }
.nb-head { padding: 6px 8px 7px; margin-bottom: 6px; background: var(--tab-bg); border-radius: var(--r-s); }
.nb-head b { display: block; font: 500 16px/1.25 var(--font-title); letter-spacing: .02em; color: var(--gold); }
.nb-head small { display: block; margin-top: 2px; font-size: 13px; line-height: 1.3; color: var(--dim); }
.nb-list { flex: 1; min-height: 0; overflow-y: auto; padding-right: 4px; }
.nb-list h4 { display: flex; justify-content: space-between; margin: 8px 0 3px; padding: 0 4px; font: 500 15px/1.3 var(--font-title); letter-spacing: .03em; color: var(--gold); }
.nb-list h4:first-child { margin-top: 0; }
.nb-list h4 span { font: 500 13px/1.6 var(--font-ui); color: var(--dim); font-variant-numeric: tabular-nums; }
.nb-it { display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; padding: 3px 6px; font: 500 15px/1.3 var(--font-ui); text-align: left; color: var(--cream); background: none; border: 0; border-radius: var(--r-s); cursor: pointer; transition: background-color var(--t-sel), color var(--t-sel); }
.nb-it:hover { background: rgba(255, 255, 255, .1); }
.nb-it.on { background: var(--tab-on-bg); color: var(--tab-on-ink); box-shadow: inset 0 0 0 1px var(--tab-on-line); }
.nb-it.lv0 { color: var(--dim); opacity: .6; }
.nb-it.lv0.on { opacity: 1; color: var(--tab-on-ink); }
.nb-dots { display: inline-flex; flex: none; gap: 3px; }
.nb-dots b { width: 7px; height: 7px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px currentColor; opacity: .55; }
.nb-dots b.on { background: currentColor; opacity: 1; }
.nb-page { min-height: 0; overflow-y: auto; padding: 10px 14px 12px; color: #3a2414; background: #f4ecd8; border-radius: 3px; box-shadow: inset 0 0 0 1px #d8c8a4, inset 0 0 24px rgba(120, 90, 40, .14); }
.nb-plate { position: relative; display: grid; place-items: center; width: 100%; aspect-ratio: 288 / 208; margin-bottom: 8px; background: #efe3c8; border-radius: 2px; box-shadow: inset 0 0 0 1px #cdb78e; overflow: hidden; }
.nb-plate img { width: 100%; height: 100%; object-fit: contain; }
.nb-wait { width: 34%; height: 34%; fill: none; stroke: #8a7a62; stroke-width: 1.6; stroke-linecap: round; opacity: .35; }
.nb-plate.sil .nb-wait { opacity: .22; }
#j-body .nb-page .nb-name { margin: 0; font: 500 21px/1.2 var(--font-title); letter-spacing: .02em; color: #3a2414; }
.nb-lv { display: flex; align-items: center; gap: 8px; margin: 3px 0 6px; font-size: 14px; color: #7a5a34; }
.nb-lv .nb-dots { color: #8a5a24; }
.nb-note { margin: 0 0 6px; font-style: italic; font-size: 15px; line-height: 1.35; }
.nb-how { margin: 4px 0 0; font-size: 15px; line-height: 1.35; }
.nb-facts { margin: 0; padding: 0; list-style: none; }
.nb-facts li { padding: 4px 0; font-size: 15px; line-height: 1.3; border-top: 1px solid rgba(90, 60, 30, .16); }
.nb-facts li.nb-tr { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.nb-prints { width: 64px; height: 56px; flex: none; fill: #3a2a1a; opacity: .85; }
.nb-more { margin: 8px 0 0; font-size: 13px; color: #8a6a44; }
`;

let styled = false;
function injectCss() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const st = document.createElement('style');
  st.id = 'naturebook-css';
  st.textContent = CSS;
  document.head.append(st);
}

const dots = lvl => `<i class="nb-dots">${[1, 2, 3].map(i => `<b class="${i <= lvl ? 'on' : ''}"></b>`).join('')}</i>`;
const nameOf = id => t(`nature.name.${id}`);
// A fact's param, ready for t(): a language key becomes its text, a list becomes "a, b and c" (nouns by their name)
function param(v) {
  if (Array.isArray(v)) return fmt.list(v.map(nounText));
  return one(v);
}
// (in a list a noun goes by its bare name: a language noun { noun }, an old one { name, g } as itemNoun gives it)
const nounText = x => (x && typeof x === 'object' ? (x.noun ? t(x.noun) : String(x.name ?? '')) : one(x));
const one = v => (typeof v === 'string' && KEYISH.test(v) && has(v) ? t(v) : v);
function params(p) {
  if (!p || typeof p !== 'object') return undefined;
  const out = {};
  for (const k in p) out[k] = param(p[k]);
  return out;
}

export class NatureBookUI {
  constructor(game) {
    this.game = game;
    this.id = null;     // the page shown (a species id) or null: the first one seen
    this.root = null;   // the tab's element while it is in the journal
    this.raf = 0;
    this.frameN = 0;
    this.broken = false;   // (the pump failed once: plates stay placeholders, the book still works)
    this.shown = null;     // [id, level] of the plate on the page, to swap it when it arrives
    injectCss();   // (now, not with the tab: the Collections cells that open a page show a hand from the start)
    onPlate((id, level) => this.plateReady(id, level));
    onLangChange(() => { if (this.visible()) this.repaint(); });
  }

  get book() { return this.game.nature; }
  level(id) {
    try { return Math.max(0, Math.min(3, this.book?.level(id) | 0)); } catch { return 0; }
  }

  // ---------- the tab ----------
  html() {
    injectCss();
    const lv = Object.create(null);
    for (const id of SPECIES_IDS) lv[id] = this.level(id);
    if (!SPECIES[this.id]) this.id = SPECIES_IDS.find(id => lv[id] > 0) || SPECIES_IDS[0];
    return `<div class="nb" data-nb><div class="nb-side">${this.headHtml(lv)}<div class="nb-list">${this.listHtml(lv)}</div></div><article class="nb-page">${this.pageHtml(this.id, lv[this.id])}</article></div>`;
  }
  headHtml(lv) {
    let n = 0;
    for (const id of SPECIES_IDS) if (lv[id] > 0) n++;
    const next = REWARDS.find(r => r[0] > n);
    const reward = next ? tHtml('nature.next_reward', { n: next[0], money: next[1], k: next[3], item: itemNoun(next[2]) }) : t('nature.all_rewards');
    return `<div class="nb-head"><b>${t('nature.head', { n, total: SPECIES_IDS.length })}</b><small>${reward}</small></div>`;
  }
  listHtml(lv) {
    const out = [];
    for (const gr of GROUPS) {
      const ids = SPECIES_IDS.filter(id => SPECIES[id].group === gr);
      if (!ids.length) continue;
      const got = ids.reduce((s, id) => s + (lv[id] > 0), 0);
      out.push(`<h4>${t(`nature.group.${gr}`)}<span>${got}/${ids.length}</span></h4>`);
      for (const id of ids) {
        const l = lv[id], on = id === this.id;
        out.push(`<button type="button" class="nb-it lv${l}${on ? ' on' : ''}" data-nb-id="${id}"${on ? ' aria-current="true"' : ''} title="${l ? t(`nature.level.${l}`) : t('nature.unknown')}"><span>${nameOf(id)}</span>${dots(l)}</button>`);
      }
    }
    return out.join('');
  }
  pageHtml(id, lvl) {
    const sp = SPECIES[id];
    if (!sp) return '';
    const parts = [this.plateHtml(id, lvl), `<h3 class="nb-name">${nameOf(id)}</h3>`,
      `<div class="nb-lv">${dots(lvl)}<span>${lvl ? t(`nature.level.${lvl}`) : t('nature.unknown')}</span></div>`];
    if (!lvl) {
      parts.push(`<p class="nb-how">${t(HOW[sp.group] || 'nature.how.look')}</p>`);
      return parts.join('');
    }
    if (has(`nature.note.${id}`)) parts.push(`<p class="nb-note">${t(`nature.note.${id}`)}</p>`);
    parts.push(`<ul class="nb-facts">${this.factsHtml(id, sp, lvl)}</ul>`);
    if (lvl < 3) parts.push(`<p class="nb-more">${t('nature.locked')}</p>`);
    return parts.join('');
  }
  factsHtml(id, sp, lvl) {
    let list = [];
    try { list = sp.facts?.(this.game) || []; } catch (e) { reportFault(e, 'NatureBook.facts'); }
    let knowsTracks = false;
    try { knowsTracks = !!this.book?.knowsTracks?.(id); } catch { /* (as unknown) */ }
    const out = [];
    for (const f of list) {
      if (!Array.isArray(f) || typeof f[0] !== 'string' || !has(f[0])) continue;
      const [key, p, own] = f, short = key.startsWith('nature.fact.') ? key.slice(12) : key;
      const from = Number.isFinite(own) ? own : FACT_LEVEL[short] ?? 1;
      const tracks = short === 'tracks' || short === 'stride';
      if (lvl < from && !(tracks && knowsTracks)) continue;   // (studying its tracks shows them before the level does)
      if (short === 'tracks') { out.push(`<li class="nb-tr"><span>${t(key)}</span>${trackSvg(sp.tracks)}</li>`); continue; }
      let text;
      try { text = tHtml(key, params(p)); } catch (e) { reportFault(e, 'NatureBook.fact'); continue; }
      out.push(`<li>${text}</li>`);
    }
    return out.join('');
  }
  plateHtml(id, lvl) {
    let url = null;
    try { url = this.broken ? null : plateUrl(id, lvl); } catch (e) { this.broken = true; reportFault(e, 'plateUrl'); }
    this.shown = [id, lvl];
    return `<div class="nb-plate${lvl ? '' : ' sil'}">${url ? `<img alt="" src="${url}">` : WAIT}</div>`;
  }

  // ---------- after the journal writes it ----------
  bind(body) {
    const root = body?.querySelector?.('[data-nb]');
    if (!root) { this.hide(); return; }
    this.root = root;
    root.addEventListener('click', e => {
      const b = e.target.closest?.('[data-nb-id]');
      if (b && root.contains(b)) this.show(b.dataset.nbId);
    });
    const sel = root.querySelector('.nb-it.on'), list = root.querySelector('.nb-list');
    if (sel && list) list.scrollTop = Math.max(0, sel.offsetTop - list.offsetTop - list.clientHeight / 3);
    this.prefetch();
    this.start();
  }
  // Another page, from the list: only the page and the selection change
  show(id) {
    if (!SPECIES[id] || !this.root) return;
    this.id = id;
    for (const b of this.root.querySelectorAll('.nb-it')) {
      const on = b.dataset.nbId === id;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    }
    const page = this.root.querySelector('.nb-page');
    if (page) { page.innerHTML = this.pageHtml(id, this.level(id)); page.scrollTop = 0; }
    this.prefetch();
    this.start();
  }
  // The whole tab again in place (the language changed while it was open)
  repaint() {
    const body = this.root?.parentNode;
    if (!body) return;
    body.innerHTML = this.html();
    this.bind(body);
  }
  page(id) { if (SPECIES[id]) this.id = id; }
  hide() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.root = null;
  }

  // ---------- the plates ----------
  // The pages next to this one in the list get their plates queued too (only while the tab shows)
  prefetch() {
    if (this.broken) return;
    const i = SPECIES_IDS.indexOf(this.id);
    try {
      for (let d = 1; d <= PREFETCH; d++) for (const j of [i + d, i - d]) {
        const id = SPECIES_IDS[j];
        if (id) plateUrl(id, this.level(id));
      }
      if (SPECIES[this.id]) plateUrl(this.id, this.level(this.id));   // (the last asked is drawn first: the page in sight)
    } catch (e) { this.broken = true; reportFault(e, 'plateUrl'); }
  }
  visible() {
    return !!this.root?.isConnected && this.root.offsetParent !== null && !document.hidden;   // (offsetParent: none in a pane that is not the one shown)
  }
  // One step of a plate every PUMP_EVERY frames while the tab is in sight; it stops by itself when it is not (the pause
  // closed, another tab) and starts again with the next bind
  start() {
    if (this.raf || this.broken || typeof requestAnimationFrame !== 'function') return;
    const tick = () => {
      this.raf = 0;
      if (!this.visible()) return;
      if (++this.frameN % PUMP_EVERY === 0) {
        try { pumpPlates(); } catch (e) { this.broken = true; reportFault(e, 'pumpPlates'); return; }
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  plateReady(id, level) {
    const s = this.shown;
    if (!s || s[0] !== id || !this.root?.isConnected) return;
    if (level !== undefined && (level > 0) !== (s[1] > 0)) return;   // (the silhouette is not the drawing)
    let url = null;
    try { url = plateUrl(id, s[1]); } catch { return; }
    const box = url && this.root.querySelector('.nb-plate');
    if (!box) return;
    const img = box.querySelector('img') || document.createElement('img');
    img.alt = '';
    img.src = url;
    if (!img.parentNode) box.replaceChildren(img);
  }
}
