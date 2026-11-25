// The places the neighbours tell you about: Ask… › Know any places? Design: docs/planes/realismo/PLAN-R6-gente.md §3.6 (phase
// R6.4). Each one knows some kinds of places (SPECIALTY) and tells the nearest to the village that you have not been to: in
// words (which way, how far, what lies on the way) and as a rough circle on the maps, which can become a route. Once found,
// whoever told you hears of it at your next talk: friendship, reputation, a memory and news (gossip.js).
//
//   prepare(id)      looks for what that neighbour would tell you today, a little each frame (a talk starts: talk.js)
//   ask(id)          the same as a promise: { key, kind, x, y } or null; the same all day
//   tell(c)          their answer in a talk (c: talk.js ctx); wreck(T): Lía's beached boat, at her 6 hearts
//   offer(id)        what they would tell you if asked now, when it is known without looking any further, or null; tease(id): how
//                    its kind is called (talktopics.js)
//   offerAloud(id), overheard(id, p)   what they may tell another neighbour near you, and you heard it (chatter.js): one a day
//   foundLine(id)    at the next talk with who told you of a place you have found: what they say, and the reward
//   marks()          the circles: [{ key, kind, npc, x, y, r, to, … }] (the maps' source, below)
//
// Saved in the neighbours' flags and friends (saved whole: an older game keeps them): flags.rumours [[key, kind, npc, day,
// found]] (MAX; found: 1 until they hear of it), flags.wreck (the key of Lía's boat), flags.rumOver (the day of the last one
// overheard), and friends[id].told [key], .rumDay, .rum (the day's). Each player's are their own; nothing goes through the
// network. What a rumour points to is looked up every time (places.poiOf): a place that is no more takes its rumour with it.
// Nothing here explores the land or points at what is inside a place. ?rumores=0: nobody tells of any.
import { PEOPLE } from './neighbors.js';   // (a cycle, read only inside functions)
import { askOptions } from './talk.js';
import { Profile } from './accounts.js';
import { CHUNK } from './world/gen.js';
import { CENTER } from './world/village.js';
import { SITE_TIERS, TIER_OF, READY } from './world/sites.js';
import { dxOf, distOf, wrapX, W as PLANET_W } from './world/planet.js';
import { dirOf8 } from './lookout.js';
import { ihash } from './util.js';
import { apagada } from './opciones.js';
import { blips } from './ui/blips.js';
import { hud } from './ui/hud.js';
import { t, tList, has, formatMessage } from './i18n.js';

// What each neighbour knows of: kinds of places (those this world has not yet are simply never found). Whoever is not here
// knows none and sends you to HUB, who hears the travellers and knows of any
export const SPECIALTY = {
  ines: ['templo', 'torre', 'aldea', 'faro'], lia: ['barco', 'faro'], bruno: ['cueva'], paco: ['campamento'], rosa: ['aldea'],
  eusebio: ['torre', 'risco'], nilo: ['mina', 'torre'], dani: ['templo'], anselmo: null,
};
const HUB = 'anselmo', MAPS = 'ines', WRECK = { npc: 'lia', kind: 'barco' };
const ANY = Object.keys(TIER_OF);
export const kindsOf = id => (!Object.prototype.hasOwnProperty.call(SPECIALTY, id) ? [] : SPECIALTY[id] || ANY);
export const MAX = 12, TOLD_MAX = 8;       // rumours kept; told keys per neighbour
export const FAR = 3000, WRECK_FAR = 5000; // tiles from the village: how far they know of; how far Lía has rowed
export const BANDS = [[200, 'near', 24], [600, 'walk', 36], [1500, 'far', 48], [Infinity, 'very_far', 64]];   // [up to, words, the circle's radius]
export const LOOKUPS = 400;                // cells looked up in a frame, at most
const IDLE_MS = 1, WAIT_MS = 3;            // ms a frame looking: meanwhile, and with the answer awaited
const POINTS = 20, REP = 5, HEARTS = 1;    // what finding one gives its teller; from how many hearts they tell
const KEY = /^-?\d+,-?\d+$/, LEGACY_MAX = 3000;
const OFF_MIN = 0.4, OFF_MAX = 0.7;       // (the place is this far from the middle of its circle, in radii)
const band = d => BANDS.find(b => d < b[0]);
const bandIndex = d => BANDS.findIndex(b => d < b[0]);

// How a kind is called: 'a' («una atalaya»), 'the' («la atalaya de …», p: the place) and on the maps
const kindWord = (what, kind, P) => t(has(`rumour.${what}.${kind}`) ? `rumour.${what}.${kind}` : `rumour.${what}.other`, P);
export const aKind = kind => kindWord('a', kind);
export const kindName = kind => (has(`place.kind.${kind}`) ? t(`place.kind.${kind}`) : t('rumour.kind.other'));

export class Rumours {
  constructor(game) {
    this.game = game;
    this.off = apagada('rumores');
    this.today = new Map();    // neighbour → { day, key (or null) }: what they would tell today
    this.job = null; this.queue = [];
    this.acc = 0; this.n = 0;  // (n: how many cells the last search looked up)
    this.sig = null; this.list = [];
  }
  reset() {
    for (const j of [this.job, ...this.queue]) j?.done(null);
    this.job = null; this.queue.length = 0; this.today.clear();
    this.acc = 0; this.sig = null; this.list = [];
  }
  get places() { return this.game.places; }
  get flags() { return this.game.neighbors.flags; }
  get day() { return this.game.days.realDay; }
  // The rumours that are well formed (a newer game's other ones stay where they are)
  entries() { const l = this.flags.rumours; return Array.isArray(l) ? l.filter(e => Array.isArray(e) && typeof e[0] === 'string' && KEY.test(e[0]) && typeof e[1] === 'string' && Object.prototype.hasOwnProperty.call(PEOPLE, e[2])) : []; }
  // Is the list of this world's places here? (a guest waits for the host's: explore.js share)
  get settled() { const g = this.game; return !!this.places.places1 || !g.live?.joined || !g.live.guest; }
  // The place a rumour speaks of, or null (it is another one now, or none)
  placeOf(e) { const p = this.places.poiOf(e[0]); return p && p.kind === e[1] ? p : null; }

  // ---------- looking for one ----------
  told(id) { const l = this.game.neighbors.friends[id]?.told; return Array.isArray(l) ? l : []; }
  skipped(id) { return new Set([...this.told(id), ...this.entries().map(e => e[0])]); }
  // The kinds they would tell of today. Who knows of any has one in mind each day (the nearest would always be the same)
  asked(id) {
    const all = kindsOf(id);
    if (all !== ANY) return [all];
    return [...ANY].sort((a, b) => ihash(this.day, ANY.indexOf(a), 541) - ihash(this.day, ANY.indexOf(b), 541)).map(k => [k]);
  }
  // Looks for the nearest place to the village, of the first of these lists of kinds that has any; a step (yield) per cell
  *search(lists, skip, far) {
    const P = this.places, ok = p => !!p && !skip.has(p.key) && !P.known(p);
    for (const list of lists) {
      const kinds = list.filter(k => READY.has(k));
      if (!kinds.length) continue;
      let best = null, bd = far;
      const take = p => { const d = distOf(p.x, p.y, CENTER.x, CENTER.y); if (d < bd && kinds.includes(p.kind) && ok(p)) { bd = d; best = p; } };
      if (!P.places1) {   // (the places of before: chunk by chunk)
        const cx = Math.floor(CENTER.x / CHUNK), cy = Math.floor(CENTER.y / CHUNK);
        for (let q = 0, n = 0; n < LEGACY_MAX && (q - 1) * CHUNK <= bd; q++) for (let j = -q; j <= q; j++) for (let i = -q; i <= q; i += Math.abs(j) === q ? 1 : Math.max(1, 2 * q)) { const p = P.poi(cx + i, cy + j); if (p) take(p); n++; yield; }
        if (best) return best;
        continue;
      }
      for (const [k, mark] of Object.entries(P.marks)) if (mark !== '-') { const p = P.poiOf(k); if (p?.legacy) take(p); yield; }
      for (const tier of new Set(kinds.map(k => TIER_OF[k]).filter(Boolean))) {
        const n = SITE_TIERS[tier].cell * CHUNK, cols = Math.ceil(PLANET_W / n), ix0 = Math.floor(wrapX(CENTER.x) / n), iy0 = Math.floor(CENTER.y / n);
        for (let r = 0; (r - 1) * n <= bd && r <= cols; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i += Math.abs(j) === r ? 1 : Math.max(1, 2 * r)) {
          const s = P.sites.inCell(tier, Math.floor(wrapX((ix0 + i + 0.5) * n) / n), iy0 + j);
          yield;
          if (!s || !kinds.includes(s.kind) || distOf(s.x, s.y, CENTER.x, CENTER.y) >= bd) continue;
          const p = P.poiOf(s.key);   // (as it is in this world: not a kind still to come, nor where one of before stays)
          if (p && !p.legacy && p.kind === s.kind) take(p);
        }
      }
      if (best) return best;
    }
    return null;
  }
  // A search in the queue: its promise. Nothing is looked for twice a day
  look(id, what, lists, far) {
    const was = [this.job, ...this.queue].find(j => j && j.id === id && j.what === what);
    if (was) return was.promise;
    const j = { id, what, gen: this.search(lists, this.skipped(id), far), n: 0, v: this.places.version, far, lists };
    j.promise = new Promise(done => { j.done = done; });
    this.queue.push(j);
    return j.promise;
  }
  // What they would tell today, if it is known already: the place, null (none) or undefined (not looked for)
  ready(id) {
    const q = this.today.get(id);
    if (!q || q.day !== this.day) return undefined;
    if (q.key === null) return null;
    const p = this.places.poiOf(q.key);
    return p && p.kind === q.kind && !this.places.known(p) && !this.skipped(id).has(q.key) ? p : undefined;
  }
  ask(id) {
    if (this.off || !kindsOf(id).length || !this.places?.sites) return Promise.resolve(null);
    const p = this.ready(id);
    if (p !== undefined) return Promise.resolve(p);
    const q = this.look(id, 'ask', this.asked(id), FAR);
    if (this.game.talk?.auto) this.run(Infinity, Infinity);   // (the tests: there and then)
    return q;
  }
  prepare(id) { if (this.can(id)) this.ask(id); }
  // Would they tell you one now? (they know you, and have not told you one today)
  can(id) { const N = this.game.neighbors; return !this.off && kindsOf(id).length > 0 && N.introduced(id) && N.hearts(id) >= HEARTS && N.friends[id]?.rumDay !== this.day; }
  offer(id) { return this.can(id) ? this.ready(id) || null : null; }
  tease(id) { const p = this.offer(id); return p && aKind(p.kind); }
  // So long (or so many cells) of looking
  run(ms, max = LOOKUPS) {
    const t0 = performance.now();
    let n = 0;
    while (n < max && performance.now() - t0 < ms) {
      const j = (this.job ||= this.queue.shift() || null);
      if (!j) break;
      let r;
      if (j.v !== this.places.version) { j.gen = this.search(j.lists, this.skipped(j.id), j.far); j.v = this.places.version; }   // (the places changed meanwhile)
      try { r = j.gen.next(); } catch (e) { this.job = null; j.done(null); throw e; }
      n++; j.n++;
      if (!r.done) continue;
      this.job = null; this.n = j.n;
      if (j.what === 'ask') this.today.set(j.id, { day: this.day, key: r.value?.key ?? null, kind: r.value?.kind });
      j.done(r.value || null);
    }
    return n;
  }

  // ---------- what is said ----------
  // Where it is, in words, from a point
  words(p, from = CENTER, shy = 0) {
    const dx = dxOf(p.x, from.x), dy = p.y - from.y, d = Math.hypot(dx, dy), name = this.places.nameOf(p);
    return { a: aKind(p.kind), place: kindWord('the', p.kind, { name }), dir: t(`place.dir.${dirOf8(dx, dy)}`), dist: t(`npc.rumour.dist.${BANDS[Math.max(0, bandIndex(d) - shy)][1]}`), past: t(`npc.rumour.past.${this.way(from, p, dx, dy)}`) };
  }
  // What lies on the way: water, if there is a good deal of it, or the land half way
  way(from, p, dx, dy) {
    const S = this.places.sites;
    let wet = 0;
    for (let i = 1; i < 12; i++) if (S.wet(from.x + dx * i / 12, from.y + dy * i / 12)) wet++;
    if (wet >= 4) return 'water';
    const key = ['', '', 'beach', 'meadow', 'forest', 'pines', 'swamp', 'desert', 'snow', 'rocky', 'ice'][this.game.world.gen.biomeAt(from.x + dx / 2, from.y + dy / 2)];
    return key || (wet ? 'river' : 'meadow');
  }
  // Their line about a place: their own words for that kind, and the ones of their temper and of everybody
  line(id, p, from) {
    const P = this.game.neighbors.params(this.words(p, from, id === 'eusebio' ? 1 : 0)), own = [...tList(`npc.rumour.${p.kind}.${id}`), ...tList(`npc.rumour.any.${id}`)];
    const list = own.length && (id === 'eusebio' || Math.random() < 0.7) ? own : [...tList(`npc.rumour.any.${PEOPLE[id].temper}`), ...tList('npc.rumour.any')];   // (Eusebio's distances are only his)
    return formatMessage(list[Math.floor(Math.random() * list.length)] || '', P);
  }
  legend(id, p) {
    const l = [...tList(`npc.rumour.legend.${p.kind}.${id}`), ...(has(`npc.rumour.legend.${p.kind}`) ? tList(`npc.rumour.legend.${p.kind}`) : tList('npc.rumour.legend.other'))];
    return formatMessage(l[Math.floor(Math.random() * l.length)] || '', this.game.neighbors.params());
  }
  // Ask… › Know any places?
  async tell(c) {
    const { T, N, id, f, talk } = c;
    await talk.mine(N.line('talk.you.places'));
    if (!T.live) return;
    if (!kindsOf(id).length) { await talk.say(id, [N.say(id, 'rumour.refer', { who: PEOPLE[HUB].name })]); return; }
    if (!N.introduced(id) || N.hearts(id) < HEARTS) { await talk.say(id, [N.say(id, 'rumour.stranger', { who: PEOPLE[id === MAPS ? HUB : MAPS].name })]); return; }
    // (one a day: the same again, or until tomorrow if you have been there already)
    if (f.rumDay === this.day) {
      const e = this.entries().find(q => q[0] === f.rum && q[2] === id && !q[4]), p = e && this.placeOf(e);
      if (!p) { await talk.say(id, [N.say(id, f.rum ? 'rumour.tomorrow' : 'rumour.none')]); return; }
      const said = talk.say(id, [N.say(id, 'rumour.again', this.words(p, T.e))]);
      talk.point(T, p.x, p.y);
      await said;
      return;
    }
    this.waiting = true;
    let p = null;
    try { [p] = await Promise.all([this.ask(id), talk.think(T)]); } finally { this.waiting = false; }
    if (!T.live) return;
    if (!p) { f.rumDay = this.day; delete f.rum; await talk.say(id, [N.say(id, 'rumour.none')]); return; }
    f.rumDay = this.day; f.rum = p.key;
    await this.say(T, p);
  }
  // Lía, at her 6 hearts: the nearest beached boat you have not seen, wherever it is
  async wreck(T) {
    if (this.off || this.flags.wreck || !this.places?.sites) return;
    this.waiting = true;
    let p = null;
    try { p = await this.findWreck(); } finally { this.waiting = false; }
    if (!p || !T.live || this.flags.wreck) return;   // (cut short: it goes on the map in update)
    this.flags.wreck = p.key;
    await this.say(T, p, { wait: true });
  }
  findWreck() { const q = this.look(WRECK.npc, 'wreck', [[WRECK.kind]], WRECK_FAR); if (this.game.talk?.auto) this.run(Infinity, Infinity); return q; }
  async say(T, p, opts) {
    const talk = this.game.talk, id = T.id, text = this.line(id, p, T.e);
    this.add(p, id);
    const said = talk.say(id, [text, this.legend(id, p)], opts);
    talk.point(T, p.x, p.y);
    await said;
    this.noted(p, id);
  }
  noted(p, id) { hud.toast(t('talk.rumour.marked', { kind: kindName(p.kind), who: PEOPLE[id].name }), 'place'); this.game.onSave?.(); }
  add(p, id) {
    const F = this.flags, f = this.game.neighbors.friend(id), l = Array.isArray(F.rumours) ? F.rumours : (F.rumours = []);
    if (!l.some(e => e?.[0] === p.key)) l.push([p.key, p.kind, id, this.day, 0]);
    if (l.length > MAX) l.splice(0, l.length - MAX);
    f.told = [...this.told(id).filter(k => k !== p.key), p.key].slice(-TOLD_MAX);
  }
  // Two of them were talking (chatter.js) and you were near enough: it is on your map too
  overheard(id, p) {
    if (this.off || this.flags.rumOver === this.day || this.placeOf([p.key, p.kind]) !== p || this.places.known(p) || this.skipped(id).has(p.key)) return false;
    this.flags.rumOver = this.day;
    this.add(p, id);
    return true;
  }
  offerAloud(id) {
    if (this.off || this.flags.rumOver === this.day || !kindsOf(id).length || !this.settled) return null;
    const p = this.ready(id);
    if (p === undefined) this.ask(id);   // (for the next time)
    return p || null;
  }

  // ---------- found ----------
  update(dt) {
    if (this.off || !this.game.player || Profile.server) return;
    if (this.job || this.queue.length) this.run(this.waiting ? WAIT_MS : IDLE_MS);
    if ((this.acc += dt) < 1) return;
    this.acc = 0;
    this.check();
  }
  // Once a second: the ones you have found, those whose place is no more, and Lía's boat if she told you of it (or did, in an
  // older game) and it is not on the map yet
  check() {
    const F = this.flags, P = this.places, all = this.entries();
    if (!P?.sites) return;
    let gone = null;
    for (const e of all) {
      if (e[4]) continue;
      const p = this.placeOf(e);
      if (!p) { if (this.settled) (gone ||= new Set()).add(e); continue; }
      if (!P.known(p)) continue;
      e[4] = 1;
      hud.toast(t('talk.rumour.right', { who: PEOPLE[e[2]].name, place: P.title(p) }), 'place');
    }
    if (gone) F.rumours = F.rumours.filter(e => !gone.has(e));
    if (F.pista_barco && !F.wreck && !this.wreckAt && !this.game.talk?.on && this.settled && F.wreckDay !== this.day) {
      this.wreckAt = true;
      this.findWreck().then(p => {
        this.wreckAt = false;
        if (F !== this.flags || F.wreck) return;
        if (!p) { F.wreckDay = this.day; return; }   // (none near: another day)
        F.wreck = p.key;
        this.add(p, WRECK.npc);
        this.noted(p, WRECK.npc);
      });
    }
  }
  // «kind/key», as the news of a place found keeps it: how that place is called, or null (there is none now)
  called(item) {
    const [kind, key] = String(item ?? '').split('/'), p = KEY.test(key || '') ? this.placeOf([key, kind]) : null;
    return p && kindWord('the', p.kind, { name: this.places.nameOf(p) });
  }
  // They told you of a place and you have been there: they hear of it now
  foundLine(id) {
    const g = this.game, N = g.neighbors, e = this.off ? null : this.entries().find(q => q[4] && q[2] === id);
    if (!e) return '';
    const p = this.placeOf(e);
    this.flags.rumours = this.flags.rumours.filter(q => q !== e);
    N.addPoints(id, POINTS);
    g.rep?.change(REP, 'rumour');
    N.remember(id, 'rumour_found');
    g.gossip?.news('rumour_found', id, `${e[1]}/${e[0]}`);
    this.sig = null;
    return N.say(id, 'rumour.found', { place: p ? kindWord('the', p.kind, { name: this.places.nameOf(p) }) : t('rumour.the.lost') });
  }

  // ---------- the maps ----------
  // The circle of a place: not round it, but with it inside, always the same one, and with its middle on dry land if it can be
  circle(p) {
    const P = this.places, r = band(distOf(p.x, p.y, CENTER.x, CENTER.y))[2], n = Number.isFinite(p.id) ? p.id : 0;
    let at = null;
    for (let k = 0; k < 12; k++) {
      const a = ihash(n, k, 547) * Math.PI * 2, d = r * (OFF_MIN + (OFF_MAX - OFF_MIN) * ihash(n, k, 557)), x = wrapX(p.x + Math.cos(a) * d), y = p.y + Math.sin(a) * d;
      at ||= [x, y];
      if (!P.sites.wet(x, y)) { at = [x, y]; break; }
    }
    return { x: at[0], y: at[1], r };
  }
  marks() {
    if (this.off) return this.list;
    const l = this.flags.rumours, sig = Array.isArray(l) ? `${this.places.version}|${l.map(e => `${e?.[0]}${e?.[4] ? '+' : ''}`).join(' ')}` : '';
    if (sig !== this.sig) {
      this.sig = sig;
      this.list = [];
      for (const e of this.entries()) {
        const p = e[4] ? null : this.placeOf(e);
        if (!p || this.places.known(p)) continue;
        const c = this.circle(p);
        this.list.push({ key: e[0], kind: e[1], npc: e[2], ...c, to: { x: c.x, y: c.y, kind: 'point' } });
      }
    }
    return this.list;
  }
}

askOptions.add({ id: 'places', order: 35, when: c => !!c.game.rumours && !c.game.rumours.off, label: () => t('talk.ask.places'), run: c => c.game.rumours.tell(c) });
blips.source('rumours', (out, { game }) => {
  for (const m of game.rumours?.marks() || []) {
    const b = out.add('rumour', m.x, m.y);
    b.r = m.r;
    b.name = t('map.rumour', { kind: kindName(m.kind), who: PEOPLE[m.npc].name }); b.sub = t('map.card.rumour'); b.to = m.to;
  }
});
