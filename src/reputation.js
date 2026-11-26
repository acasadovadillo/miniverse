// The village's reputation (instead of GTA's "wanted level"): what Pueblo Brotes thinks of you, from -1000 to 1000, shown
// as one of six levels from «Outcast» to «Beloved». It goes up with errands, village projects, gifts, the first chat of
// the day with someone, friendship events, trades and greeting (social.js); it goes down with provoking people, taking
// things out of the neighbors' houses (B › Remove) and knocking on their doors at night. Each level makes the shops a
// little dearer or cheaper (ui/shop.js), changes how the neighbors greet you and, at the bottom, they stop chatting with
// you (neighbors.js talk; the shop and the trades stay open: closing them could block a game). Every day it forgives a
// little while it is below zero. It is each player's (it goes in their own save, never through the network), and in
// creative and as a spectator nothing changes it.
// Days: a guest plays with the host's calendar (livesync.js dayBase), so the day caps and the days kept are only ever
// compared with === and !== (as neighbors.js does with f.talk), and "recent" is 0 <= today - day <= n.
import { t, tHtml } from './i18n.js';
import { HOUSES, inTavern, inChapel, inLawOffice, hasProject } from './world/village.js';
import { ROUTINES } from './routines.js';
import { PEOPLE } from './neighbors.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';

// The levels, from the bottom (buy, sell: what the shops' prices are multiplied by)
export const REP_LEVELS = [
  { id: 'outcast', from: -1000, buy: 1.35, sell: 0.75 },
  { id: 'distrusted', from: -400, buy: 1.15, sell: 0.9 },
  { id: 'newcomer', from: -120, buy: 1, sell: 1 },
  { id: 'known', from: 100, buy: 1, sell: 1 },
  { id: 'liked', from: 300, buy: 0.95, sell: 1.05 },
  { id: 'beloved', from: 600, buy: 0.9, sell: 1.1 },
];
const MIN = -1000, MAX = 1000;
const LOG = 8;            // the last changes kept (the journal shows four)
const SEED_MAX = 400;     // an old game starts from what it did, «Liked» at most
const SEEN_R = 8, NILO_NIGHT = 4;   // tiles: a neighbor this close (and in sight) sees what you take from a house; Nilo, always in the square, by night
// Day caps of what can be repeated: the most a day can add up to (greet, insult, take) or how many times it counts (trade)
const CAP = { greet: 6, insult: -40, take: -150, hunt: -60, clean: 15 };   // (hunt: the hunter's code broken, clean: clean kills; huntcode.js)
const TRADES_A_DAY = 5;
export const levelOf = pts => { let L = REP_LEVELS[0]; for (const l of REP_LEVELS) if (pts >= l.from) L = l; return L; };
export const levelIndex = id => REP_LEVELS.findIndex(l => l.id === id);
// Was day at most n days ago (in this world's calendar)? A day "from the future" of another world is not recent
export const recent = (today, day, n) => typeof day === 'number' && today - day >= 0 && today - day <= n;

export class Reputation {
  constructor(game) {
    this.game = game;
    this.v = fresh();
  }
  get today() { return this.game.days.dayIndex; }
  get pts() { return this.v.pts; }
  get level() { return levelOf(this.v.pts); }
  get index() { return levelIndex(this.level.id); }
  // Only playing for real: in creative you take things apart and try things out without paying for it
  get counts() { const g = this.game; return !!g.player && g.gamemode === 'survival'; }

  reset(save) {
    const r = save.rep;
    if (r && typeof r === 'object' && Number.isFinite(r.pts)) {
      this.v = { ...fresh(), ...r, pts: clamp(Math.round(r.pts)), log: Array.isArray(r.log) ? r.log.slice(-LOG) : [], cap: r.cap && typeof r.cap === 'object' ? r.cap : {}, taken: r.taken && typeof r.taken === 'object' ? r.taken : {}, knocks: r.knocks && typeof r.knocks === 'object' ? r.knocks : {} };
    } else {
      this.v = fresh();
      // A game from before the reputation (it has an inventory): it is born from what was done, never «Beloved» unearned
      if (save.inventory) {
        const st = this.game.stats, N = this.game.neighbors;
        const hearts = Object.keys(PEOPLE).reduce((s, id) => s + (N.friends[id] ? N.hearts(id) : 0), 0);
        this.v.pts = Math.min(SEED_MAX, Math.round(6 * st.get('encargos') + 40 * st.get('proyectos') + 2 * st.get('regalos') + 4 * hearts));
        this.v.seeded = 1; this.v.lvl = this.level.id;
      }
    }
    if (levelIndex(this.v.lvl) < 0) this.v.lvl = this.level.id;   // (an unknown level: the one it is now, without a notice)
  }
  save(out) { out.rep = this.v; }
  // Each morning, a little forgiven while it is below zero
  onDay(day) { if (this.v.pts < 0) this.change(10, 'forgive'); }   // (day: the hook gives it; once per day that passes)

  // Change it by n, for the reason why (rep.why.<why>). Applies the day caps and returns what really changed (0 in creative)
  change(n, why) {
    if (!this.counts || !n) return 0;
    const v = this.v, cap = this.dayCap();
    if (why === 'greet') n = Math.min(n, CAP.greet - (cap.greet || 0));
    if (why === 'insult') n = Math.max(n, CAP.insult - (cap.insult || 0));
    if (why === 'take' || why === 'take_seen') n = Math.max(n, CAP.take - (cap.take || 0));
    if (why === 'trade') { if ((cap.trade || 0) >= TRADES_A_DAY) return 0; cap.trade = (cap.trade || 0) + 1; }
    const hunt = why.startsWith('hunt_') && why !== 'hunt_clean';
    if (hunt) { n = Math.max(n, CAP.hunt - (cap.hunt || 0)); cap.hunt = (cap.hunt || 0) + n; }
    if (why === 'hunt_clean') { n = Math.min(n, CAP.clean - (cap.clean || 0)); cap.clean = (cap.clean || 0) + n; }
    if (why === 'greet' || why === 'insult') cap[why] = (cap[why] || 0) + n;
    if (why === 'take' || why === 'take_seen') cap.take = (cap.take || 0) + n;
    const was = v.pts;
    v.pts = clamp(v.pts + n);
    n = v.pts - was;
    if (!n) return 0;
    v.log.push([this.today, n, why]);
    if (v.log.length > LOG) v.log.splice(0, v.log.length - LOG);
    if (Math.abs(n) >= 10) this.game.gather?.float(t('rep.float', { n, sign: n > 0 ? '+' : '−', abs: Math.abs(n) }), n > 0 ? '#bdf0a0' : '#ffb0a0');
    const lv = this.level.id;
    if (lv !== v.lvl) {
      const up = levelIndex(lv) > levelIndex(v.lvl);
      v.lvl = lv;
      hud.toast(t(up ? 'rep.toast.up' : 'rep.toast.down', { level: t('rep.level.' + lv) }), up ? 'good' : 'social');
      if (up) Audio.unlock(); else Audio.error();
    }
    return n;   // (saved with the game, as the friendships: no save of its own for each change)
  }
  // The caps of today (they start again when the day is another one)
  dayCap() {
    if (this.v.cap.day !== this.today) this.v.cap = { day: this.today };
    return this.v.cap;
  }

  // ---------- the shops ----------
  buyFactor() { return this.counts ? this.level.buy : 1; }
  sellFactor() { return this.counts ? this.level.sell : 1; }
  // The line under the shop's title when the prices are not the usual ones: «Prices +15% · Distrusted»
  shopNote() {
    const f = this.buyFactor();
    if (f === 1) return '';
    const pct = Math.round((f - 1) * 100);
    return t('rep.shopnote', { sign: pct > 0 ? '+' : '−', n: Math.abs(pct), level: t('rep.level.' + this.level.id) });
  }

  // ---------- talking (neighbors.js) ----------
  // Do they chat with you? Not at «Outcast», nor the day you provoked them three times, unless you are good friends.
  // Nilo always talks (the story and the house go through him), and in creative the reputation has no effects
  canTalk(id) {
    if (!this.counts || id === 'nilo') return true;
    const N = this.game.neighbors, f = N.friend(id);
    if (N.hearts(id) >= 3) return true;
    return !(this.level.id === 'outcast' || f.snub === this.today);
  }
  // The friendship events wait while the village distrusts you (they are not lost)
  eventsWait() { return this.counts && this.index <= levelIndex('distrusted'); }

  // ---------- the neighbors' houses ----------
  // Whose house is this tile in: 'rosa', 'bruno', 'dani', 'taberna' or null (your own house and the hamlets do not count)
  houseAt(tx, ty) {
    for (const [id, h] of Object.entries(HOUSES)) if ((!h.project || hasProject(h.project)) && tx >= h.x0 && tx < h.x1 && ty >= h.y0 && ty < h.y1) return id;
    return inTavern(tx + 0.5, ty + 0.5) ? 'taberna' : inChapel(tx + 0.5, ty + 0.5) ? 'chapel' : inLawOffice(tx + 0.5, ty + 0.5) ? 'law_office' : null;
  }
  // Who sees you take something from that house: its owner if they are in (even hidden indoors, as when you knock: they
  // speak from inside), in the tavern Anselmo at his place; if not, any neighbor in sight within SEEN_R. { n, inside } or null
  witness(x, y, house) {
    const N = this.game.neighbors, w = this.game.world;
    if (house === 'taberna') { const a = N.people.find(n => n.id === 'anselmo' && !n.hidden && (n.spot?.room === 'taberna' || !ROUTINES)); if (a) return { n: a, inside: false }; }
    else { const owner = N.people.find(n => n.def.home === house && n.atHome); if (owner) return { n: owner, inside: owner.hidden }; }
    const dark = !!this.game.days?.isNight?.(), near = [w.nilo, ...N.people.filter(n => !n.hidden && !n.asleep)].filter(n => n && Math.hypot(n.x - x, n.y - y) <= (dark && n === w.nilo ? NILO_NIGHT : SEEN_R) && (!w.reaches || w.reaches(n.x, n.y, x, y)));
    near.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
    return near[0] ? { n: near[0], inside: false } : null;
  }
  // Something was just removed (B › Remove, or picked up with X or B › Move: game.js pickUp) from a tile of the world: from a neighbor's house, what came with it is taken
  // (take, or take_seen with a witness); what you had put back there yourself, taken again (retake). Per tile, so putting
  // the same wall back and taking it again always adds up to 0
  taken(layer, tx, ty, own, what = '') {
    if (!this.counts) return;
    const house = this.houseAt(tx, ty);
    if (!house) return;
    const k = `${layer}:${tx},${ty}`, T = this.v.taken;
    if (own) {
      const e = T[k];
      const again = !!what && this.game.law?.wasReturned(layer, tx, ty, what);   // (the very thing taken before and put back)
      if (e?.[1] === 1) { this.change(-Math.round(e[0] / 2), 'retake'); e[1] = 0; }
      if (again && this.witness(tx + 0.5, ty + 0.5, house)) this.game.law.tookFromHouse(layer, tx, ty, what);
      return;
    }
    const x = tx + 0.5, y = ty + 0.5, seen = this.witness(x, y, house);
    const n = -this.change(seen ? -25 : -12, seen ? 'take_seen' : 'take');
    if (n > 0) T[k] = [n, 0];
    if (!seen) return;
    const id = seen.n === this.game.world.nilo ? 'nilo' : seen.n.id, name = PEOPLE[id]?.name || '', theirs = seen.inside || seen.n.def?.home === house || (house === 'taberna' && id === 'anselmo');
    // (they remember it, and so do the owners of the house: the village talks. Plan E §4.5: cold to you for 3 days)
    const N = this.game.neighbors;
    N.remember?.(id, 'take_seen');
    for (const o of this.ownersOf(house)) if (o !== id) N.remember?.(o, 'take_seen');
    this.game.gossip?.news('take_seen', id, `${house}/${what}`);   // (and from them it goes round: gossip.js)
    const crime = what && this.game.law?.tookFromHouse(layer, tx, ty, what);   // (with a constable in the village: law.js)
    const lines = this.game.social?.lines(theirs ? 'npc.witness.take.own' : 'npc.witness.take') || [];
    const line = crime ? this.game.law.witnessLine(id) : lines.length ? lines[Math.floor(Math.random() * lines.length)] : '';
    this.game.neighbors.addPoints(id, -10);
    // (from inside, as when you knock: the bubble over what was taken, «Rosa (from inside)»; if not, over who saw it)
    this.game.social?.say(seen.inside ? { x, y } : seen.n, line, { name: seen.inside ? t('npc.witness.inside', { name }) : name });
  }
  // Something was just put on a tile of the world: on a tile you had taken from, half of what it cost comes back, once
  placed(layer, tx, ty) {
    if (!this.counts) return;
    const e = this.v.taken[`${layer}:${tx},${ty}`];
    if (e?.[1] === 0 && this.game.world.ownAt?.(layer, tx, ty)) { this.change(Math.round(e[0] / 2), 'return'); e[1] = 1; this.game.law?.putBack(layer, tx, ty); }
  }
  // The ids of who lives in that house ('taberna': Anselmo)
  ownersOf(house) {
    if (house === 'taberna') return ['anselmo'];
    return house ? Object.keys(PEOPLE).filter(id => PEOPLE[id].home === house) : [];
  }
  // Knocking at a neighbor's door at night, with them in: once per door and night (the night of 1 a.m. is the day before's).
  // Who is in remembers it (the house found from the door's tile, as witness does)
  knockNight(door, hour) {
    const night = hour < 7 ? this.today - 1 : this.today, k = String(door);
    if (this.v.knocks[k] === night) return;
    this.v.knocks[k] = night;
    this.change(-3, 'knock_night');
    const N = this.game.neighbors, house = Array.isArray(door) ? this.houseAt(Math.floor(door[0]), Math.floor(door[1])) : null;
    const woken = house && this.counts ? N.people.filter(n => n.def.home === house && n.atHome) : [];
    for (const n of woken) N.remember?.(n.id, 'knock_night');
    if (woken.length) this.game.gossip?.news('knock_night', woken[0].id, house);
  }

  // ---------- the journal (the Neighbors tab, above the friendships) ----------
  journal() {
    const L = this.level, i = this.index, next = REP_LEVELS[i + 1], v = this.v;
    const pos = p => ((p - MIN) / (MAX - MIN) * 100).toFixed(1);
    const marks = REP_LEVELS.slice(1).map(l => `<s style="left:${pos(l.from)}%"></s>`).join('');
    const f = this.buyFactor(), pct = Math.round((f - 1) * 100);
    const prices = pct ? tHtml('rep.prices', { sign: pct > 0 ? '+' : '−', n: Math.abs(pct) }) : tHtml('rep.prices.same');
    const lines = v.log.slice(-4).reverse().map(([, n, why]) => `<li><span>${tHtml('rep.why.' + why)}</span><b class="${n > 0 ? 'up' : 'down'}">${n > 0 ? '+' : '−'}${Math.abs(n)}</b></li>`).join('');
    return `<div class="rep-box rep-${L.id}"><div class="rep-head"><span>${tHtml('rep.title')}</span><b>${tHtml('rep.level.' + L.id)}</b></div>` +
      `<div class="rep-bar"><i style="width:${pos(v.pts)}%"></i>${marks}</div>` +
      `<small class="rep-desc">${tHtml('rep.level.' + L.id + '.desc')}</small>` +
      (next ? `<small>${tHtml('rep.next', { n: next.from - v.pts, level: t('rep.level.' + next.id) })}</small>` : '') +
      `<small>${prices}</small>` +
      (this.game.law?.bounty() && this.game.law.active ? `<small class="rep-law">${tHtml('law.journal', { n: this.game.law.bounty(), level: t('law.level.' + this.game.law.level()) })}</small>` : '') +
      (lines ? `<h4>${tHtml('rep.recent')}</h4><ul class="rep-log">${lines}</ul>` : '') +
      (this.game.gamemode !== 'survival' ? `<small class="rep-creative">${tHtml('rep.creative')}</small>` : '') + '</div>';
  }
}

const clamp = n => Math.max(MIN, Math.min(MAX, n));
function fresh() { return { v: 1, pts: 0, lvl: 'newcomer', log: [], cap: {}, taken: {}, knocks: {} }; }
