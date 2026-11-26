// What the village knows about you, and when: a log of your deeds (good and bad) and of the village's events, and who has
// heard of each. Design: docs/planes/realismo/PLAN-R6-gente.md §3.5 (phase R6.3). No DOM but the journal's box.
//
//   game.gossip.news(kind, src, item, val)   something happened: src, the neighbour who saw it or was in it, or '*' (a public
//                         event). Only playing for real (reputation.js counts). The same kind, src and item within a day is one
//   all()                 the news that still lives, newest last: the log's and the births (family.v, the same for everyone)
//   knowsAt(id, e)        ms (the village's clock) at which that neighbour knows it: a pure function of the entry and the ties
//                         below. Nobody learns anything asleep
//   knows(id, e), knowers(e)
//   fresh(id)             the newest thing they know and have not told you, or null (what you have not overheard goes first)
//   mention(id, e)        what they say of it ('line | who told them'), told once: friends[id].nsaid; a good one, +2 of friendship
//                         (once a day each neighbour)
//   opener(id), topic(id) it as the opening of a talk (neighbors.js greeting), or in the chat (chatLines)
//   lookedFor(id)         somebody told them you were asking for them (talk.js askWhere)
//   heardBad(id, days)    they heard something bad of you in the last days (social.js relation)
//   heard(conn, peer, m)  'nw': your partner did something good { t: 'nw', k: its kind's index, npc, it }; they tell you of it too
//   seenBy()              the neighbour who sees you now (who a big catch is first known by), or null
//   label(e), journal()   the diary, Neighbours: what people say about you, and who knows it
//
// Saved in the neighbours' flags and friends (saved whole: an older game keeps them): flags.news { v, seq, list } with
// list [[id, tMs, kind, src, item, val, heard]], MAX at most, and friends[id].nsaid [news id], .newsDay. Each player's are
// their own and never go through the network: what is said of you is said to you. The births come from the family, which is
// shared, and the village's works from the board (board.js share), so both players hear of them; what your partner did, from
// 'nw' (flags.news.partner, PARTNER_MAX at most).
// ?gossip=0: nothing is written or told; what is saved stays as it is.
import { PEOPLE } from './neighbors.js';   // (a cycle, read only inside functions)
import { ITEMS } from './items.js';
import { Profile } from './accounts.js';
import { DAY_MS } from './time.js';
import { nearX } from './world/planet.js';
import { apagada } from './opciones.js';
import { reportFault } from './faults.js';
import { thing, someOf } from './talktopics.js';
import { t, tHtml, has, noun, fmt } from './i18n.js';

const HOUR = 36e5, PARTNER_MAX = 6, PARTNER_GAP = 20;   // (what your partner did: entries kept; s between two 'nw')
// Append only. val: good (+1), bad (-1) or neither; days: how long it is talked about. (wedding: Plan I, which
// brings its lines: until then nobody says anything of it)
export const NEWS = {
  gift_loved: { val: 1, days: 3 }, helped: { val: 1, days: 5 }, project: { val: 1, days: 14 }, kid_born: { val: 1, days: 21 },
  wish_kept: { val: 1, days: 5 }, rumour_found: { val: 1, days: 4 }, take_seen: { val: -1, days: 7 }, insult: { val: -1, days: 3 },
  knock_night: { val: -1, days: 2 }, looked_for: { val: 0, days: 1 }, big_catch: { val: 1, days: 4 }, big_game: { val: 1, days: 4 },
  new_horse: { val: 1, days: 7 }, wedding: { val: 1, days: 30 },
  stall_seen: { val: -1, days: 5 }, jailed: { val: -1, days: 7 },   // (the law, law.js)
  hunt_code: { val: -1, days: 5 },   // (the hunter's code broken: item young, mother, swan or waste; huntcode.js)
};
export const NEWS_KINDS = Object.keys(NEWS);
// …and the kinds a couple tells each other (Plan R6.4)
export const SHARED_NEWS = ['gift_loved', 'helped', 'wish_kept', 'rumour_found', 'big_catch', 'big_game', 'new_horse'];
export const MAX = 24;             // entries kept
export const COLD_DAYS = 2;        // how long bad news makes who heard it cold (social.js, only lines)
export const GOOD_PTS = 2;         // friendship for a good one they bring up
const SAID_MAX = 48, PUBLIC_H = 1, SEEN_R = 12;   // told ids kept per neighbour; hours until everyone knows a public event; tiles
const OPEN_CHANCE = 0.4, TOPIC_CHANCE = 0.4, VIA_CHANCE = 0.7, LONG_H = 7;   // (LONG_H: from so many hours away, «everyone says»)
// Who tells whom, in hours. Any other neighbour hears it in the tavern; every other pair, a day
const TIES = [['rosa', 'lia', 1], ['marta', 'anselmo', 1], ['eusebio', 'anselmo', 2], ['paco', 'anselmo', 2], ['ines', 'anselmo', 2], ['nilo', 'eusebio', 3],
  ['rosa', 'marta', 3], ['nilo', 'rosa', 4], ['nilo', 'lia', 4], ['nilo', 'dani', 4], ['bruno', 'paco', 4], ['dani', 'marta', 4], ['bruno', 'anselmo', 5], ['lia', 'ines', 6]];
const HUB = 'anselmo', HUB_H = 6, FAR_H = 24;
const AWAKE = [7.5, 23], LATE = [9, 26];   // (the hours they are up: the tavern's people, until two)

// All the shortest ways of that graph: { hours[from][to], via[from][to]: who tells them }. Made once
let graph = null;
export function ties(people = Object.keys(PEOPLE)) {
  const key = people.join();
  if (graph?.key === key) return graph;
  const h = {}, via = {};
  for (const a of people) { h[a] = {}; via[a] = {}; for (const b of people) { h[a][b] = a === b ? 0 : FAR_H; via[a][b] = a; } }
  const tie = (a, b, n) => { if (h[a] && h[b] && a !== b) h[a][b] = h[b][a] = n; };
  const named = new Set(TIES.flatMap(([a, b]) => [a, b]));
  for (const a of people) if (!named.has(a)) tie(a, HUB, HUB_H);
  for (const [a, b, n] of TIES) tie(a, b, n);
  for (const k of people) for (const a of people) for (const b of people) if (h[a][k] + h[k][b] < h[a][b]) { h[a][b] = h[a][k] + h[k][b]; via[a][b] = via[k][b]; }
  return (graph = { key, h, via });
}
// The same moment, or when they get up
export function wake(id, ms) {
  const [a, b] = PEOPLE[id]?.seat ? LATE : AWAKE, day = Math.floor(ms / DAY_MS), h = (ms - day * DAY_MS) / HOUR;
  if (b > 24 ? h >= a || h < b - 24 : h >= a && h < b) return ms;
  return (h < a ? day : day + 1) * DAY_MS + a * HOUR;
}
export const delayOf = (src, id) => ties().h[src]?.[id] ?? FAR_H;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const homeOf = item => String(item ?? '').split('/')[0];
// Who was in it, and knows it from the start
export function involved(e) {
  const [, , kind, src, item] = e;
  if (kind !== 'take_seen' && kind !== 'knock_night') return [src];
  const house = homeOf(item);
  return [src, ...(house === 'taberna' ? ['anselmo'] : Object.keys(PEOPLE).filter(id => PEOPLE[id].home === house && id !== src))];
}
export function knowsAt(id, e) {
  const [, at, , src] = e;
  if (involved(e).includes(id)) return at;
  return wake(id, at + (src === '*' ? PUBLIC_H : delayOf(src, id)) * HOUR);
}

export class Gossip {
  constructor(game) {
    this.game = game;
    this.off = apagada('gossip');
  }
  get now() { return this.game.days.now; }
  // The log, inside the neighbours' flags
  get v() {
    const F = this.game.neighbors.flags, v = F.news;
    return v && typeof v === 'object' && Array.isArray(v.list) ? v : (F.news = { v: 1, seq: 0, list: [] });
  }
  reset() { this.prune(); }
  onDay(day) { this.prune(); }   // (day: the hook's parameter)
  // Out with what is no longer talked about (kinds of a newer game stay: they are theirs) and with what came too many
  prune() {
    const F = this.game.neighbors.flags;
    if (this.off || !F.news) return;
    const v = this.v, now = this.now;
    v.list = v.list.filter(e => Array.isArray(e) && (!own(NEWS, e[2]) || (Number.isFinite(e[1]) && now - e[1] < NEWS[e[2]].days * DAY_MS))).slice(-MAX);
    if (v.partner) v.partner = (Array.isArray(v.partner) ? v.partner : []).filter(e => this.lives(e, now)).slice(-PARTNER_MAX);
    if (!Number.isFinite(v.seq)) v.seq = v.list.length;
  }
  news(kind, src, item = null, val = NEWS[kind]?.val) {
    const g = this.game;
    if (this.off || !own(NEWS, kind) || !g.player || !g.rep?.counts || Profile.server || (src !== '*' && !own(PEOPLE, src))) return null;
    const v = this.v, now = this.now, it = item === null || item === undefined ? null : String(item).slice(0, 48);
    if (v.list.some(e => Array.isArray(e) && e[2] === kind && e[3] === src && (e[4] ?? null) === it && Math.abs(now - e[1]) < DAY_MS)) return null;
    v.seq = (Number.isFinite(v.seq) ? v.seq : 0) + 1;
    const e = [v.seq, now, kind, src, it, val, 0];
    v.list.push(e);
    if (v.list.length > MAX) v.list.splice(0, v.list.length - MAX);
    this.toPartner(kind, src, it);
    return e;
  }
  // Something good of yours: your partner's game hears of it too
  toPartner(kind, src, it) {
    const g = this.game, L = g.live;
    if (!L?.joined || !L.net || !SHARED_NEWS.includes(kind) || Math.abs(g.time - (this.sentAt ?? -Infinity)) < PARTNER_GAP) return;
    for (const [conn, peer] of L.peers) {
      if (!peer.playing || peer.server || !g.social?.isPartner(peer)) continue;
      this.sentAt = g.time;
      try { L.net.send({ t: 'nw', k: NEWS_KINDS.indexOf(kind), npc: src, it }, conn); } catch (e) { reportFault(e, 'Gossip.toPartner'); }
    }
  }
  heard(conn, peer, m) {
    const g = this.game, kind = NEWS_KINDS[m?.k], it = m?.it;
    if (this.off || !g.player || !peer || Profile.server || !SHARED_NEWS.includes(kind) || (m.npc !== '*' && !(typeof m.npc === 'string' && own(PEOPLE, m.npc))) || !g.social?.isPartner(peer)) return;
    if (typeof it !== 'string' || !it || it.length > 48) return;
    if (Math.abs(g.time - (peer.nwAt ?? -Infinity)) < PARTNER_GAP / 2) return;
    peer.nwAt = g.time;
    const v = this.v, now = this.now, e = [`p:${Math.floor(now)}`, now, kind, m.npc, it, 0, 0, String(peer.name || '').slice(0, 24)];
    if (!e[7] || !this.params(e)) return;
    v.partner = [...(Array.isArray(v.partner) ? v.partner : []), e].slice(-PARTNER_MAX);
  }
  // The births: in the family, shared, so both players hear of them. Yours are good news; another couple's, news
  births() {
    const g = this.game, F = g.family?.v, me = Profile.id || 'yo', out = [];
    if (!g.rep?.counts) return out;   // (as the log: in creative, nothing)
    for (const k of Array.isArray(F?.kids) ? F.kids : []) {
      if (!k?.name || k.named === false || !Number.isFinite(k.born)) continue;
      const mine = Array.isArray(k.parents) ? k.parents.includes(me) : !g.live?.guest;
      out.push([`k:${k.id}`, (k.born + g.days.base) * DAY_MS + 8 * HOUR, 'kid_born', '*', k.name, mine ? 1 : 0, 0, k.sex]);
    }
    return out;
  }
  all() {
    if (this.off) return [];
    const now = this.now, F = this.game.neighbors.flags, list = F.news ? [...this.v.list, ...(Array.isArray(this.v.partner) ? this.v.partner : [])] : [];
    return [...list, ...this.births()].filter(e => this.lives(e, now)).sort((a, b) => a[1] - b[1]);
  }
  lives(e, now) { return Array.isArray(e) && own(NEWS, e[2]) && Number.isFinite(e[1]) && now >= e[1] && now - e[1] < NEWS[e[2]].days * DAY_MS; }
  knowsAt(id, e) { return knowsAt(id, e); }
  knows(id, e) { return knowsAt(id, e) <= this.now; }
  people() { return ['nilo', ...this.game.neighbors.people.map(n => n.id)]; }
  knowers(e) { return this.people().filter(id => this.knows(id, e)); }

  // ---------- words ----------
  // What goes in a line about it: names, the thing, the place… or null when this game does not know what it is about
  params(e) {
    const [, , kind, src, item] = e, P = { who: src === '*' ? '' : PEOPLE[src]?.name || '', other: this.theirs(e) ? e[7] : '' };
    switch (kind) {
      case 'gift_loved': case 'helped': case 'wish_kept': case 'big_catch': case 'stall_seen':
        if (!ITEMS[item]) return null;
        return { ...P, item: thing(item), some: someOf(item) };
      case 'big_game': return has(`nature.name.${item}`) ? { ...P, item: noun('nature.name', item) } : null;
      case 'hunt_code': return has(`gossip.hunt.${item}`) ? { ...P, deed: t(`gossip.hunt.${item}`) } : null;
      case 'project': return null;   // (the village's projects are gone: old news of them is not told)
      case 'kid_born': return { ...P, kid: item, ksex: e[7] === 'chica' ? 'girl' : 'boy' };
      case 'new_horse': return { ...P, animal: item };
      case 'rumour_found': return (place => place && { ...P, place })(this.game.rumours?.called(item));
      case 'take_seen': case 'knock_night': {
        const [house, what] = String(item ?? '').split('/');
        const place = t(has(`gossip.house.${house}`) ? `gossip.house.${house}` : 'gossip.house.other');
        return { ...P, place, theirs: PEOPLE[src]?.home === house ? t('gossip.house.own') : place, what: what && ITEMS[what] && (has(`item.${what}`) || has(`thing.${what}`)) ? t('gossip.the', { item: thing(what) }) : t('gossip.something') };
      }
    }
    return P;
  }
  // The keys of a line: someone else's work or child is not yours
  theirs(e) { return typeof e[0] === 'string' && e[0].startsWith('p:'); }   // (your partner's, not yours)
  key(e) { return this.theirs(e) ? `partner_${e[2]}` : e[5] === 0 && (e[2] === 'project' || e[2] === 'kid_born') ? `${e[2]}_other` : e[2]; }
  label(e) { const k = `journal.news.${this.key(e)}`, P = has(k) ? this.params(e) : null; return P ? t(k, P) : ''; }

  // ---------- what they tell you ----------
  told(id) { const l = this.game.neighbors.friends[id]?.nsaid; return Array.isArray(l) ? l : []; }
  mark(id, e) { const f = this.game.neighbors.friend(id); f.nsaid = [...this.told(id).filter(x => x !== e[0]), e[0]].slice(-SAID_MAX); }
  // Told before to you by them? (a deed of theirs they remember themselves: neighbors.js recall)
  fresh(id) {
    if (this.off || !own(PEOPLE, id)) return null;
    const told = this.told(id), list = this.all().filter(e => e[2] !== 'looked_for' && !told.includes(e[0]) && has(`npc.news.${this.key(e)}`) && !involved(e).includes(id) && this.knows(id, e) && this.params(e));
    return list.filter(e => !e[6]).pop() || list.pop() || null;
  }
  mention(id, e) {
    const g = this.game, N = g.neighbors, f = N.friend(id), P = this.params(e);
    if (!P) return '';
    this.mark(id, e);
    if (e[5] > 0 && g.rep?.counts && f.newsDay !== g.days.realDay) { f.newsDay = g.days.realDay; N.addPoints(id, GOOD_PTS); }
    const line = N.say(id, `news.${this.key(e)}`, P), src = e[3];
    if (!line || src === '*' || Math.random() >= VIA_CHANCE) return line;
    const prev = ties().via[src]?.[id] || src, kind = delayOf(src, id) >= LONG_H ? 'everyone' : prev === src ? 'self' : 'told';
    const via = N.say(id, `news.via.${kind}`, { who: PEOPLE[prev]?.name || '' });
    return via ? `${line} | ${via}` : line;
  }
  lookedFor(id) {
    if (this.off || !this.game.neighbors.flags.news) return '';
    const told = this.told(id), mine = this.all().filter(e => e[2] === 'looked_for' && e[4] === id && !told.includes(e[0])), e = mine.find(x => this.knows(id, x));
    for (const x of mine) this.mark(id, x);   // (now you have met: nothing to be told later)
    return e ? this.game.neighbors.say(id, 'news.looked_for', this.params(e)) : '';
  }
  opener(id) { const e = this.fresh(id); return e && Math.random() < OPEN_CHANCE ? this.mention(id, e) : ''; }
  // In the chat: not two in a row
  topic(id) {
    const e = this.fresh(id), f = e && this.game.neighbors.friend(id);
    if (!e || f.tops?.at?.(-1) === 'news' || Math.random() >= TOPIC_CHANCE) return '';
    f.tops = [...(Array.isArray(f.tops) ? f.tops : []), 'news'].slice(-2);
    return this.mention(id, e);
  }
  heardBad(id, days = COLD_DAYS) {
    if (this.off || !this.game.neighbors.flags.news) return false;
    const now = this.now;
    return this.v.list.some(e => this.lives(e, now) && e[5] < 0 && !involved(e).includes(id) && (k => k <= now && now - k < days * DAY_MS)(knowsAt(id, e)));
  }
  seenBy(r = SEEN_R) {
    const g = this.game, w = g.world, p = g.player;
    let best = null, bd = r;
    if (p && w && g.scene === w) for (const [id, e] of [['nilo', w.nilo], ...g.neighbors.people.map(n => [n.id, n])]) {
      if (!e || e.hidden || e.asleep) continue;
      const d = Math.hypot(nearX(e.x, p.x) - p.x, e.y - p.y);
      if (d < bd && (!w.reaches || w.reaches(p.x, p.y, e.x, e.y))) { bd = d; best = id; }
    }
    return best;
  }

  // ---------- the diary (Neighbours) ----------
  journal() {
    const list = this.all().filter(e => e[5] !== 0 && this.label(e) && this.knowers(e).length).slice(-4).reverse(), all = this.people().length;
    if (this.off || !list.length) return '';
    const rows = list.map(e => {
      const k = this.knowers(e), who = k.length >= all ? t('journal.news.everyone') : fmt.list(k.map(id => PEOPLE[id].name));
      return `<li><span>${tHtml('journal.news.row', { what: this.label(e).replace(/^./u, c => c.toLocaleUpperCase()) })}<small>${tHtml('journal.news.known', { who })}</small></span><b class="${e[5] > 0 ? 'up' : 'down'}">${tHtml(e[5] > 0 ? 'journal.news.good' : 'journal.news.bad')}</b></li>`;
    }).join('');
    return `<div class="rep-box gossip-box"><div class="rep-head"><span>${tHtml('journal.news.title')}</span></div><ul class="rep-log">${rows}</ul></div>`;
  }
}
