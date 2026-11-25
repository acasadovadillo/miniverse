// The neighbours talking among themselves, and what you overhear. Design: docs/planes/realismo/PLAN-R6-gente.md §3.4 (phase
// R6.3). Who talks with whom, when and about what is a pure function of the village's clock, where everyone is at that moment
// (routines.js) and the world's seed: both players see the same two talking at the same time with nothing sent. Each game
// says it in its own language, and the news are each player's own (what they say of you, on your screen).
//
//   plan(kind, slot)   the exchanges of a slot ('tavern' or 'out'): [{ a, b, zone, at, topic, seed }] (pure: every game's)
//   current()          the ones going on here now
//   update(dt)         at 1 Hz: the lines that are due, as bubbles (social.js say), and the greetings of those who cross
//
// A pair of neighbours stopped near each other (in the tavern, anywhere in it) has its turn every few slots, so it rests at
// least REST; of the ones with their turn in a place, the best by lot talks, if the place's lot comes out (CHANCE). Two
// exchanges at once at most. Within HEAR tiles and in sight of them you overhear: what they tell of you is in the diary
// (gossip.js), with a notice now and then. Only drawn within SEE tiles; indoors, only from inside the same room.
// Nothing here costs or gives anything but that. ?chatter=0 turns it off.
import { PEOPLE } from './neighbors.js';
import { ROUTINES, placeAt, idNum } from './routines.js';
import { involved } from './gossip.js';
import { kindsOf } from './rumours.js';
import { tomorrowsWeather } from './talktopics.js';
import { madridMs, WEATHERS } from './time.js';
import { Profile } from './accounts.js';
import { apagada } from './opciones.js';
import { ihash } from './util.js';
import { nearX } from './world/planet.js';
import { hud } from './ui/hud.js';
import { t, tList, has, formatMessage } from './i18n.js';

export const SLOT = { tavern: 45e3, out: 75e3 }, CHANCE = { tavern: 0.6, out: 0.35 };
export const REST = 240e3;                // ms a pair rests between two exchanges
export const NEAR = 2.6, SEE = 16, HEAR = 5;   // tiles: how close a pair must be, how far it is drawn, how near it is overheard
export const PASS_R = 2.6, PASS_CHANCE = 0.4, PASS_MS = 600e3;   // a greeting of two who cross: at most one each PASS_MS
const START = 15e3, STEP = 3.5, MAX_ON = 2, CLOSE = 0.35, NEWS_CHANCE = 0.4, LATE_S = 2.5;
const TOAST_GAP = 600;                    // s between two notices of what you overheard
const TICK = 1;
const FRESH_MS = 3 * 864e5;               // (they talk among themselves of what is new)
const SAME = { lluvia: 'wet', tormenta: 'wet', nieve: 'snow', ventisca: 'snow', niebla: 'fog' };
const lifeOf = text => Math.min(6, 2.2 + text.length / 22);   // s a bubble stays
const pairNum = (a, b) => Math.min(a, b) * 64 + Math.max(a, b);

export class Chatter {
  constructor(game) {
    this.game = game;
    this.off = apagada('chatter');
    this.reset();
  }
  reset() {
    this.acc = 0;
    this.slots = { tavern: null, out: null };   // the slot whose plan is in `on`
    this.on = [];                               // the exchanges of this slot that have not ended: { …, said, next, lines }
    this.looks = [];                            // who turns their head to whom: { e, to, until }
    this.passed = new Map();                    // pair → the PASS_MS window of their last greeting
    this.toastAt = -Infinity;
    this.ids = Object.keys(PEOPLE);
    this._near = [];
  }
  // The clock the slots are counted with: the village's, or the real one while it is stopped
  clock() { return this.game.rules?.doDaylightCycle === false ? madridMs() : this.game.days.now; }
  entity(id) { return id === 'nilo' ? this.game.world?.nilo : this.game.neighbors.people.find(n => n.id === id); }
  // Where neighbour id is at that moment, stopped and awake, or null: { x, y, room, zone }
  where(id, ms) {
    if (id === 'nilo') { const e = this.game.world?.nilo; return e ? { x: e.x, y: e.y, room: null, zone: 'plaza' } : null; }
    if (!ROUTINES) { const n = this.entity(id); return !n || n.hidden || n.path.length ? null : { x: n.x, y: n.y, room: n.def.seat ? 'taberna' : null, zone: n.node }; }
    const a = placeAt(id, ms), s = a.spot;
    return a.moving || s.hidden || s.kind === 'asleep' || s.kind === 'away' ? null : { x: a.x, y: a.y, room: s.room, zone: s.room || s.kind };
  }
  people() { return ['nilo', ...this.game.neighbors.people.map(n => n.id)].sort((a, b) => this.ids.indexOf(a) - this.ids.indexOf(b)); }

  // ---------- who, when and about what (pure) ----------
  plan(kind, slot) {
    const len = SLOT[kind], start = slot * len, seed = this.game.world.seed, rest = Math.ceil((REST + START) / len);
    const shown = this.game.rules?.doDaylightCycle === false ? this.clock() - this.game.neighbors.clock() : 0, at = this.people().map(id => [id, this.where(id, start - shown)]).filter(([, w]) => w && (w.room === 'taberna') === (kind === 'tavern'));
    const best = new Map();   // zone → its pair
    for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) {
      const [a, p] = at[i], [b, q] = at[j], n = pairNum(this.ids.indexOf(a), this.ids.indexOf(b));
      if (p.room !== q.room || (kind !== 'tavern' && Math.hypot(p.x - q.x, p.y - q.y) > NEAR)) continue;
      if ((slot + Math.floor(ihash(n, 3, 811) * rest)) % rest) continue;   // (not their turn: so they rest)
      const score = ihash(slot, n, seed + 811), zone = p.zone, was = best.get(zone);
      if (!was || score < was.score) best.set(zone, { a, b, zone, score, n });
    }
    const out = [];
    for (const x of best.values()) {
      const z = idNum(x.zone), r = k => ihash(slot, x.n + k * 7919, seed + 823);
      if (ihash(slot, z, seed + 817) >= CHANCE[kind]) continue;
      const [a, b] = r(1) < 0.5 ? [x.a, x.b] : [x.b, x.a];
      out.push({ a, b, zone: x.zone, at: start + r(2) * START, news: r(3) < NEWS_CHANCE, topic: this.topicOf(a, b, x.zone, r(4), r(5), start - shown), close: r(6) < CLOSE, seed: Math.floor(r(7) * 1e6), slot, kind });
    }
    return out.sort((x, y) => x.seed - y.seed);
  }
  // What else they could talk about: { topic, ... } by weight, the same in every game
  topicOf(a, b, zone, r, r2, ms) {
    const g = this.game, wx = tomorrowsWeather(g), tie = this.tieOf(a, b), list = [['weather', 1], ['work', 1]];
    if (tie) list.push(['tie', 4]);
    if (zone === 'taberna') list.push(['tavern', 1.5]);
    if ((a === 'eusebio' || b === 'eusebio') && wx && g.days.hour >= 5) list.push(['forecast', 2]);
    const here = [a, b], others = this.people().filter(o => !here.includes(o) && has(`npc.opinion.${a}.${o}`) && this.where(o, ms)?.zone !== zone);   // (not of somebody who is right there)
    if (others.length) list.push(['third', 1.5]);
    if (kindsOf(a).length) list.push(['rumour', 0.5]);   // (with no place to tell of, or one overheard today already: their work)
    let left = r * list.reduce((s, x) => s + x[1], 0), k = 0;
    while (k < list.length - 1 && (left -= list[k][1]) >= 0) k++;
    const topic = list[k][0];
    return { topic, ...(topic === 'third' && { of: others[Math.floor(r2 * others.length)] }), ...(topic === 'tie' && { key: tie }), ...(topic === 'forecast' && { w: wx }) };
  }
  tieOf(a, b) { for (const k of [`${a}_${b}`, `${b}_${a}`]) if (has(`npc.pair.tie.${k}`)) return k; return null; }

  // ---------- the words (each game's) ----------
  // The lines of an exchange: { who: [id…], text: […], news }, or null
  lines(x) {
    const g = this.game, N = g.neighbors, name = id => PEOPLE[id].name, at = (list, k) => (list.length ? list[Math.floor(ihash(x.seed, k, 829) * list.length) % list.length] : '');
    const say = (list, k, P) => formatMessage(at(list, k), { ...N.params(), ...P }), own = (key, id) => [...tList(`${key}.${id}`), ...tList(`${key}.${PEOPLE[id].temper}`)], all = (key, id) => { const l = own(key, id); return l.length ? l : tList(key); };
    const { a, b } = x, T = x.topic, P = { a: name(a), b: name(b) };
    let who = [a, b, a], text = null, news = null, rumour = null;
    if (x.news && (news = this.common(a, b, x))) {
      const key = g.gossip.key(news), Q = { ...P, ...g.gossip.params(news) };
      text = [say(tList(`npc.pair.news.${key}`), 1, Q), say(all(`npc.pair.re.${news[5] > 0 ? 'good' : news[5] < 0 ? 'bad' : 'plain'}`, b), 2, Q)];
      if (!text[0]) { news = null; text = null; }
    }
    if (!text) switch (T.topic) {
      case 'tie': {   // (the whole exchange is written: the first of the key speaks first)
        const [p, q] = T.key.split('_'), l = say(tList(`npc.pair.tie.${T.key}`), 1, P).split(' | ');
        return { who: l.map((s, i) => (i % 2 ? q : p)), text: l, news: null };
      }
      case 'forecast': {
        const other = a === 'eusebio' ? b : a, right = SAME[T.w] === 'wet';
        who = ['eusebio', other, 'eusebio'];
        text = [say(tList('npc.pair.forecast.a'), 1, P), say(WEATHERS.includes(T.w) && has(`npc.pair.forecast.b.${T.w}`) ? tList(`npc.pair.forecast.b.${T.w}`) : [], 2, P), say(tList(right ? 'npc.pair.forecast.right' : 'npc.pair.forecast.wrong'), 3, P)];
        break;
      }
      case 'weather': { const w = SAME[g.days.weather] || 'fair'; text = [say(all(`npc.pair.weather.${w}.a`, a), 1, P), say(all('npc.pair.weather.b', b), 2, P)]; break; }
      case 'work': text = [say(all('npc.pair.work.a', a), 1, P), say(all('npc.pair.work.b', b), 2, P)]; break;
      case 'tavern': text = [say(all('npc.pair.tavern.a', a), 1, P), say(all('npc.pair.tavern.b', b), 2, P)]; break;
      case 'rumour':
        if ((rumour = g.rumours?.offerAloud(a) || null)) { const W = g.rumours.words(rumour, this.entity(a) || undefined); text = [say(tList('npc.pair.rumour.a'), 1, { ...P, ...W }), say(all('npc.pair.rumour.b', b), 2, { ...P, ...W })]; } else text = [say(all('npc.pair.work.a', a), 1, P), say(all('npc.pair.work.b', b), 2, P)];
        break;
      case 'third': text = [say(tList(`npc.opinion.${a}.${T.of}`), 1, P), say(all('npc.pair.third.b', b), 2, { ...P, who: name(T.of) })]; break;
    }
    if (!text?.[0] || !text[1]) return null;
    if (text.length < 3 && x.close) { const c = say(all('npc.pair.close', a), 3, P); if (c) text.push(c); }
    return { who, text, news, rumour };
  }
  // Something new of yours (or of the village) that both know and neither was in, and the first one can call you by your name
  common(a, b, x) {
    const g = this.game, G = g.gossip;
    if (!G || G.off || !g.neighbors.introduced(a)) return null;
    const now = G.now, l = G.all().filter(e => now - e[1] < FRESH_MS && has(`npc.pair.news.${G.key(e)}`) && !involved(e).some(q => q === a || q === b) && G.knows(a, e) && G.knows(b, e) && G.params(e)).slice(-4);
    return l.length ? l[Math.floor(ihash(x.seed, 5, 839) * l.length)] : null;
  }

  // ---------- each second ----------
  can() { const g = this.game; return !this.off && !Profile.server && !!g.player && !!g.world && g.scene === g.world && g.mode === 'play' && !g.windowsOpen && !hud.dialogOpen && !g.busy; }
  current() { return this.on.filter(x => x.lines && x.next > 0 && x.next < x.lines.text.length); }
  update(dt) {
    if ((this.acc += dt) < TICK) return;
    this.acc %= TICK;
    const g = this.game;
    if (this.looks.length) this.turnBack();
    if (!this.can()) return;
    const near = this.near();
    if (near.length < 2) { this.slots.tavern = this.slots.out = null; this.on.length = 0; return; }
    const now = this.clock();
    for (const kind of ['tavern', 'out']) {
      const slot = Math.floor(now / SLOT[kind]);
      if (this.slots[kind] === slot) continue;
      this.slots[kind] = slot;
      this.on = this.on.filter(x => x.kind !== kind || (x.lines && x.next < x.lines.text.length));
      for (const x of this.plan(kind, slot)) this.on.push({ ...x, next: 0, due: x.at, lines: null });
    }
    for (const x of this.on) this.step(x, now);
    if (this.on.some(x => x.dead)) this.on = this.on.filter(x => !x.dead);
    this.passing(near, now);
  }
  // The neighbours that can be seen from here
  near() {
    const g = this.game, p = g.player, out = this._near;
    out.length = 0;
    const add = (id, e) => { if (e && !e.hidden && !e.asleep && Math.abs(nearX(e.x, p.x) - p.x) <= SEE && Math.abs(e.y - p.y) <= SEE && Math.hypot(nearX(e.x, p.x) - p.x, e.y - p.y) <= SEE) out.push([id, e]); };
    add('nilo', g.world.nilo);
    for (const n of g.neighbors.people) add(n.id, n);
    return out;
  }
  // Free to talk now: in sight, stopped, with nobody else and nothing said
  free(e, id) {
    const g = this.game;
    return !!e && !e.hidden && !e.asleep && !e.talkWith && !(e.hold > 0 && e.hold < 100) && !e.path?.length && !(Math.hypot(e.vx || 0, e.vy || 0) > 0.05) && !g.talk.has(id) && !g.talk.peerWith(id, e) && !g.social.bubbles.some(b => b.e === e);
  }
  // Is what they say drawn here? Within SEE tiles and, indoors, from the same room
  seen(e, r = SEE) {
    const g = this.game, p = g.player, d = Math.hypot(nearX(e.x, p.x) - p.x, e.y - p.y);
    if (d > r) return false;
    const roofed = q => !!g.world.roofAt?.(Math.floor(q.x), Math.floor(q.y));
    return (!roofed(e) && roofed(p) === roofed(e)) || !g.world.reaches || g.world.reaches(p.x, p.y, e.x, e.y);
  }
  step(x, now) {
    if (now < x.due) return;
    if (now - x.due > LATE_S * 1000) { x.dead = true; return; }   // (too late: you come in the middle of it, or the game was paused)
    const g = this.game, first = x.next === 0, A = this.entity(x.a), B = this.entity(x.b);
    if (first) {
      if (!this.free(A, x.a) || !this.free(B, x.b) || !this.seen(A) || !this.seen(B) || this.current().length >= MAX_ON) { x.dead = true; return; }
      x.lines = this.lines(x);
      if (!x.lines) { x.dead = true; return; }
      this.look(A, B, x.lines.text.length * 5); this.look(B, A, x.lines.text.length * 5);
    }
    const id = x.lines.who[x.next], e = this.entity(id), other = e === A ? B : A, text = x.lines.text[x.next];
    // (somebody else took one of them away, or they left: it ends there)
    if (!e || !other || !first && (e.hidden || other.hidden || e.talkWith || other.talkWith || e.path?.length || other.path?.length || g.talk.has(x.a) || g.talk.has(x.b))) { x.dead = true; return; }
    const life = lifeOf(text);
    g.social.say(e, text, { name: PEOPLE[id].name, life });
    g.social.emote(e, 'talk', { amp: PEOPLE[id].temper === 'cheerful' ? 1 : 0.6 });
    const nod = x.seed % 3 ? 'nod' : 'shrug';
    if (!first || x.lines.news) g.social.later(() => { if (!other.hidden && !other.talkWith && !other.emote) g.social.emote(other, nod); }, 1.2);
    if (first && x.lines.news) this.overheard(e, x.lines.news, id, text);
    if (first && x.lines.rumour) this.overheardPlace(e, x.lines.rumour, id, text);
    x.next++;
    x.due = now + Math.max(STEP, life - 1) * 1000;
    if (x.next >= x.lines.text.length) x.dead = true;
  }
  // Near enough to make it out, and not talking with somebody yourself
  overheard(e, n, id, text) {
    const g = this.game;
    if (g.talk.on || g.gamemode === 'spectator' || !this.seen(e, HEAR)) return;
    n[6] = 1;
    hud.log.say(PEOPLE[id].name, text);   // (the pause's Brief keeps it)
    const what = g.gossip.label(n);
    if (what && g.time - this.toastAt >= TOAST_GAP) { this.toastAt = g.time; hud.toast(t('talk.overheard', { what }), 'social'); }
  }
  // …of a place: it goes on your map, as if they had told you (rumours.js: one a day)
  overheardPlace(e, p, id, text) {
    const g = this.game;
    if (g.talk.on || g.gamemode === 'spectator' || !g.neighbors.introduced(id) || !this.seen(e, HEAR) || !g.rumours.overheard(id, p)) return;
    hud.log.say(PEOPLE[id].name, text);
    g.rumours.noted(p, id);
  }
  look(e, to, s) {
    if (e.lookTarget && e.lookTarget !== to) return;
    e.lookTarget = to;
    this.looks.push({ e, to, until: this.game.time + s });
    if (!e.pose && e.faceTo && (e.spot ? e.spot.yaw === null : !e.def?.seat)) e.faceTo(nearX(to.x, e.x) - e.x, to.y - e.y);   // (who is not at a place of theirs turns round; the rest, only the head)
  }
  turnBack() {
    const now = this.game.time;
    this.looks = this.looks.filter(l => {
      if (now < l.until && !l.e.talkWith && !l.e.hidden) return true;
      if (l.e.lookTarget === l.to) delete l.e.lookTarget;
      return false;
    });
  }

  // ---------- those who cross ----------
  passing(near, now) {
    const g = this.game, win = Math.floor(now / PASS_MS), moves = e => Math.hypot(e.vx || 0, e.vy || 0) > 0.5;
    for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
      const [ai, a] = near[i], [bi, b] = near[j], ma = moves(a), mb = moves(b);
      if ((!ma && !mb) || Math.hypot(a.x - b.x, a.y - b.y) > PASS_R) continue;
      const n = pairNum(this.ids.indexOf(ai), this.ids.indexOf(bi));
      if (this.passed.get(n) === win) continue;
      // (side by side the same way is no crossing)
      if (ma && mb && a.vx * b.vx + a.vy * b.vy > 0) continue;
      this.passed.set(n, win);
      if (ihash(win, n, g.world.seed + 853) >= PASS_CHANCE) continue;
      const ok = (e, id) => !e.talkWith && !g.talk.has(id) && !g.talk.peerWith(id, e) && !g.social.bubbles.some(q => q.e === e);
      if (!ok(a, ai) || !ok(b, bi) || !this.seen(a) || !this.seen(b) || (g.world.reaches && !g.world.reaches(a.x, a.y, b.x, b.y))) continue;
      const [p, q, pi, qi] = ma ? [a, b, ai, bi] : [b, a, bi, ai];
      this.hail(p, pi, q, qi, ihash(win, n, 857));
      g.social.later(() => { if (!q.hidden && !q.talkWith && !g.talk.has(qi)) this.hail(q, qi, p, pi, ihash(win, n, 859)); }, 1);
    }
  }
  hail(e, id, to, toId, r) {
    const g = this.game, l = [...tList(`npc.pair.pass.${PEOPLE[id].temper}`), ...tList('npc.pair.pass')], text = l.length ? formatMessage(l[Math.floor(r * l.length)], g.neighbors.params({ other: PEOPLE[toId].name })) : '';
    if (!text || g.windowsOpen) return;
    g.social.say(e, text, { name: PEOPLE[id].name, life: 2.6 });
    g.social.emote(e, ['gruff', 'shy'].includes(PEOPLE[id].temper) ? 'nod' : 'wave');
    if (!e.lookTarget) { e.lookTarget = to; this.looks.push({ e, to, until: g.time + 2.5 }); }
  }
}
