// Sites, the crew and the upkeep contract (docs/planes/realismo/PLAN-R5-construccion.md §1.5 and §3.6, phase P4). Nilo's crew
// works from 8:00 to 20:00, Madrid time (the game's clock); nights do not count.
//   - The reform of your house in the village (game.js offerReform, offerFamily): paid as always, then one working day (REFORM_H)
//     of scaffolding round it, and then it is bigger. You can sleep in it meanwhile.
//   - Helping: the hammer swung at a reform site takes HELP_MIN work minutes off each time (100 swings, about 1.5 h), up to half
//     of it; HELP_THANKS minutes of help and Nilo remembers it, and the village thinks better of you (once per site).
//   - Hiring the crew for your blueprints (Nilo's talk option): he quotes the labour of the plans you or your partner drew (the
//     biggest group of them, LABOUR per piece), you pay it, and the crew builds CREW_RATE pieces per work hour, floors first, then
//     posts and walls, then doors and windows, then roofs, the nearest to the middle first, paying each from the chests within
//     BUILD_STATION_REACH of it. When a chest runs dry the site stops ("Site stopped: 12 planks missing") and goes on by itself
//     once the material is there. They never build on the village's land, nor on the plot of the house in the village if the
//     site is not its owner's (an op's), nor anybody else's plans.
//   - The upkeep contract: UPKEEP_FEE coins a month (your game pays it when the month turns, or the contract ends); while it is
//     paid, once a month everything built within UPKEEP_R of your bed is as new (wear.js aged).
// Two hired hands are seen at work during the work hours within WORKERS_R of a site (local only, the same in every game).
//
// The records are world data: d.site["<id>"] in the chunk of the middle of the site, saved and synced like the rest, ignored by
// an old game (which only sees the pieces appear). Only whoever decides the world (alone, you; together, the host or the world
// server, which runs with nobody online) writes them and builds: a guest asks with claims (claims.js): site_new, site_help,
// upkeep_new, upkeep_pay, upkeep_end. A guest's own changes of d.site are put back (arbitrate).
//   reform: { kind, t0, by, nm, rect, need (minutes), help (minutes), hp: { who: minutes }, to: 'big' | 'family' }
//   crew:   { kind, t0, at, by, nm, rect, keys (what is left, in order), n, done, credit, stop: [[m, n]] | null, coins }
//   upkeep: { kind, t0, by, nm, rect, paid (month), done (month) }
// ?cuadrilla=0: no crew, no upkeep and no house plans offered here, and the reforms are at once as before; what there is in the
// world goes on with whoever decides it.
import { PIECES, parsePlaced, layerOf } from './pieces.js';
import { ITEMS, CHESTS } from './items.js';
import { CHUNK } from './world/gen.js';
import { wrapIndex, nearX, dxOf } from './world/planet.js';
import { inPlot, villageLand, HOUSE, HOUSE_BIG, HOUSE_FAMILY } from './world/village.js';
import { planKey, parseKey, planned, HAMMER } from './plans.js';
import { ruleOf } from './wearrules.js';
import { BUILD_STATION_REACH, matText } from './build.js';
import { WORKS_ON } from './houseplans.js';
import { CLAIMS } from './claims.js';
import { talkOptions } from './talk.js';
import { areCouple } from './social.js';
import { madridMs } from './time.js';
import { randomId } from './carry-items.js';
import { Person } from './entities.js';
import { ihash } from './util.js';
import { Profile } from './accounts.js';
import { Audio } from './audio.js';
import { reportFault } from './faults.js';
import { hud } from './ui/hud.js';
import { t } from './i18n.js';

const MIN = 6e4, HOUR = 36e5, DAY = 864e5;
export const WORK_FROM = 8, WORK_TO = 20;          // Madrid hours
export const CREW_RATE = 30;                        // pieces per work hour
export const REFORM_H = 12;                         // work hours of a reform
export const HELP_MIN = 0.9;                        // work minutes a swing of help takes off
export const HELP_THANKS = 30;                      // minutes of help that are remembered
export const UPKEEP_FEE = 40, UPKEEP_R = 12;        // coins a month; tiles round your bed
export const WORKERS_R = 60, LINE_R = 60;           // tiles
export const QUOTE_GAP = 4;                         // tiles between two plans of the same building
const CHECK_S = 600, CHECK_NEAR_S = 40, CATCH_UP_S = 0.5;   // s between two looks at the sites (whoever decides); near one; with work behind
const BATCH = 60;                                   // pieces a site builds at most in one look
const PAY_S = 30;                                   // s between two looks at the upkeep month
const HELP_SEND_S = 4;                              // s a guest gathers its swings of help before asking
const SWING_S = 0.6;
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const me = () => Profile.id || 'me';
const chunkKey = (tx, ty) => `${wrapIndex(Math.floor(tx / CHUNK), CHUNK)},${Math.floor(ty / CHUNK)}`;
const KINDS = new Set(['reform', 'crew', 'upkeep']);
const sound = s => isMap(s) && KINDS.has(s.kind) && typeof s.by === 'string' && Array.isArray(s.rect) && s.rect.length === 4 && s.rect.every(Number.isFinite);
const centre = r => [(r[0] + r[2] + 1) / 2, (r[1] + r[3] + 1) / 2];
const STONE_WALL = new Set(['muro_piedra', 'ashlar_wall', 'stone_column', 'bell_gable', 'limewash_wall']);
// What the crew asks for building each piece, in coins
export function labourOf(id) {
  const p = PIECES[id];
  if (!p) return 0;
  if (p.layer === 'floor' || p.kind === 'fence' || p.kind === 'gate') return 2;
  if (p.layer === 'roof') return 3;
  if (p.kind === 'post') return 3;
  return STONE_WALL.has(id) ? 8 : 6;
}
// The order the crew builds in: floors, posts and walls, doors and windows, roofs
const rankOf = id => { const p = PIECES[id]; return p.layer === 'floor' ? 0 : p.layer === 'roof' ? 3 : p.kind === 'door' || p.kind === 'gate' || id.startsWith('ventana') ? 2 : 1; };
// The calendar month of a moment (Madrid)
export const monthOf = (ms = Date.now()) => { const d = new Date(madridMs(ms)); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };

// ---------- the work hours ----------
// Minutes of work between two moments (real ms): those between WORK_FROM and WORK_TO, Madrid time
export function workMinutes(from, to) {
  if (!(to > from)) return 0;
  const a = madridMs(from), b = madridMs(to), d0 = Math.floor(a / DAY), d1 = Math.min(Math.floor(b / DAY), d0 + 4000);
  let m = 0;
  for (let d = d0; d <= d1; d++) { const o = Math.min(d * DAY + WORK_TO * HOUR, b) - Math.max(d * DAY + WORK_FROM * HOUR, a); if (o > 0) m += o; }
  return m / MIN;
}
// When (real ms) so many minutes of work from a moment are done
export function finishAt(from, minutes) {
  let a = madridMs(from), left = Math.max(0, minutes) * MIN;
  const off = a - from;
  for (let i = 0; i < 4000 && left > 0; i++) {
    const d = Math.floor(a / DAY), s = d * DAY + WORK_FROM * HOUR, e = d * DAY + WORK_TO * HOUR;
    if (a < s) a = s;
    if (a >= e) { a = (d + 1) * DAY + WORK_FROM * HOUR; continue; }
    const k = Math.min(left, e - a);
    a += k; left -= k;
  }
  return a - off;
}
// "today at 14:20", "tomorrow at 10:00", "in 3 days"
export function whenText(ms, now = Date.now()) {
  const a = madridMs(ms), b = madridMs(now), days = Math.floor(a / DAY) - Math.floor(b / DAY), h = Math.floor((a % DAY) / HOUR), m = Math.floor((a % HOUR) / MIN);
  const time = `${h}:${String(m).padStart(2, '0')}`;
  return days <= 0 ? t('site.when.today', { time }) : days === 1 ? t('site.when.tomorrow', { time }) : t('site.when.days', { n: days, time });
}
export const workingNow = (ms = Date.now()) => { const h = (madridMs(ms) % DAY) / HOUR; return h >= WORK_FROM && h < WORK_TO; };

// ---------- the host's word (claims.js) ----------
CLAIMS.site_new = (g, c, d, k, extra) => {
  const W = g.works;
  if (!W) return false;
  const q = W.quote(c.by);
  if (!q || q.n !== c.n || chunkKey(...centre(q.rect).map(Math.floor)) !== k || W.crewOf(c.by)) { extra.n = q?.n || 0; return false; }
  extra.id = W.newCrew(d, q, c.by, c.nm, c.coins | 0);
  return true;
};
CLAIMS.site_help = (g, c, d, k, extra) => {
  const s = isMap(d.site) && d.site[c.id];
  if (!sound(s) || s.kind !== 'reform' || !g.works) return false;
  return g.works.addHelp(s, c.by, Math.max(0, Math.min(40, c.n | 0)), extra);
};
CLAIMS.upkeep_new = (g, c, d, k, extra) => {
  const W = g.works, r = c.rect;
  if (!W || !Array.isArray(r) || r.length !== 4 || !r.every(Number.isInteger) || r[2] - r[0] > UPKEEP_R * 2 || r[3] - r[1] > UPKEEP_R * 2 || r[2] < r[0] || r[3] < r[1] || chunkKey(...centre(r).map(Math.floor)) !== k || W.upkeepOf(c.by)) return false;
  extra.id = W.newUpkeep(d, r, c.by, c.nm);
  return true;
};
CLAIMS.upkeep_pay = (g, c, d) => {
  const s = isMap(d.site) && d.site[c.id], m = c.month | 0;
  if (!sound(s) || s.kind !== 'upkeep' || !(s.by === c.by || areCouple(g.family?.v, s.by, c.by)) || m <= s.paid || m > monthOf() + 1) return false;
  s.paid = m;
  g.works?.later();
  return true;
};
CLAIMS.upkeep_end = (g, c, d) => {
  const s = isMap(d.site) && d.site[c.id];
  if (!sound(s) || s.kind !== 'upkeep' || !(s.by === c.by || areCouple(g.family?.v, s.by, c.by))) return false;
  delete d.site[c.id];
  g.works?.scan();
  return true;
};

export class Works {
  constructor(game) {
    this.game = game;
    this.on = WORKS_ON;
    this.sites = new Map();      // id → { id, k }
    this.v = 0;                  // goes up when a site changes (three/works3d.js)
    this.checkT = 2; this.payT = 5; this.helpT = 0; this.evalT = 0;
    this.skew = 0;               // (the tests: ms added to the clock)
    this.seen = {};              // (saved) id → pieces built the last time you saw it: what was done while you were away
    this.looked = false;
    this.workers = [];           // the hired hands in sight (Persons)
    this.crewAt = null;          // … of this site
    this.toHelp = null;          // (a guest) swings of help not asked for yet: { id, k, n }
    this.strike = null;
    this.tg = { use: () => this.use(), auto: true, still: true, label: '', s: null };
    this.lineMemo = { t: -1e9, text: '' };
  }
  get world() { return this.game.world; }
  now() { return Date.now() + this.skew; }
  decides() { const b = this.game.barrow; return !b || b.decides(); }
  ours(by, who = me()) { return by === who || areCouple(this.game.family?.v, by, who); }
  reset(save) {
    this.seen = isMap(save?.works?.seen) ? { ...save.works.seen } : {};
    this.looked = false; this.workers.length = 0; this.crewAt = null; this.toHelp = null; this.strike = null;
    this.checkT = 2; this.payT = 5; this.lineMemo.t = -1e9;
    this.scan();
  }
  save(out) {
    const seen = {};
    for (const { id } of this.sites.values()) { const s = this.at(id); if (s?.kind === 'crew' && this.ours(s.by)) seen[id] = this.looked ? s.done | 0 : this.seen[id] ?? (s.done | 0); }   // (not looked at yet since loading: what was seen before)
    if (Object.keys(seen).length) out.works = { seen };
  }
  // ---------- the records ----------
  scan() {
    const w = this.world, was = this.sites;
    this.sites = new Map();
    if (w?.deltas) for (const [k, d] of w.deltas) if (isMap(d?.site) && !k.startsWith('u:')) for (const id in d.site) if (sound(d.site[id])) this.sites.set(id, { id, k });
    this.v++; this.lineMemo.t = -1e9;
    if (this.looked && !Profile.server && this.game.player) this.notice(was);
  }
  at(id) { const e = this.sites.get(id), s = e && this.world?.deltas.get(e.k)?.site?.[id]; return sound(s) ? s : null; }
  list(kind) { const out = []; for (const { id, k } of this.sites.values()) { const s = this.at(id); if (s && (!kind || s.kind === kind)) out.push({ id, k, s }); } return out; }
  crewOf(by) { return this.list('crew').find(e => this.ours(e.s.by, by)) || null; }
  upkeepOf(by) { return this.list('upkeep').find(e => this.ours(e.s.by, by)) || null; }
  reformOf() { return this.list('reform').find(e => e.s.by === me()) || null; }
  touched(k) { const [cx, cy] = k.split(',').map(Number); this.world.note(cx, cy); this.v++; this.lineMemo.t = -1e9; }
  later() { this.checkT = Math.min(this.checkT, CATCH_UP_S); }
  // (live.js applyChunk) Changes of a chunk have come
  onOps(k, ops) { if (ops.some(([f]) => f === 'site')) this.scan(); }
  // (whoever decides) A guest's changes of a chunk: the sites are never theirs to write. → { ok, back }
  arbitrate(k, ops) {
    let ok = null, back = null;
    const cur = this.world?.deltas.get(k)?.site || {};
    for (let i = 0; i < ops.length; i++) {
      const [f, id] = ops[i];
      if (f !== 'site') { ok?.push(ops[i]); continue; }
      ok ||= ops.slice(0, i); back ||= [];
      back.push(typeof id !== 'string' ? ['site', null, structuredClone(cur)] : cur[id] === undefined ? ['site', id] : ['site', id, structuredClone(cur[id])]);
    }
    return ok ? { ok, back } : null;
  }

  // ---------- the reform ----------
  // (the house's owner, deciding) The crew starts on the house: to 'big' or 'family'. → the site's id
  startReform(to) {
    const H = this.game.houseRect(), rect = [H.x0, H.y0, H.x1 - 1, H.y1 - 1], [cx, cy] = centre(rect).map(Math.floor), d = this.world.delta(Math.floor(cx / CHUNK), Math.floor(cy / CHUNK), true), id = 'r' + randomId();
    (d.site ||= {})[id] = { kind: 'reform', t0: this.now(), by: me(), nm: this.game.player?.name || '', rect, need: REFORM_H * 60, help: 0, hp: {}, to };
    this.touched(chunkKey(cx, cy)); this.scan();
    return id;
  }
  doneAt(s) { return finishAt(this.now(), s.need - (s.help || 0) - workMinutes(s.t0, this.now())); }
  whenOf(s) { return s ? whenText(this.doneAt(s), this.now()) : ''; }
  // (whoever decides) Help on a reform: n swings by `by`. extra.thanks: the helper has given enough to be remembered
  addHelp(s, by, n, extra = {}) {
    const cap = s.need / 2, add = Math.min(n * HELP_MIN, cap - (s.help || 0));
    if (!(add > 0)) { extra.full = 1; return true; }
    s.help = Math.round(((s.help || 0) + add) * 10) / 10;
    const hp = isMap(s.hp) ? s.hp : (s.hp = {}), was = hp[by] || 0;
    hp[by] = Math.round((was + add) * 10) / 10;
    if (was < HELP_THANKS && hp[by] >= HELP_THANKS) extra.thanks = 1;
    this.later();
    return true;
  }
  // (the owner) It is done: the house is bigger
  finishReform(id, k, s) {
    const g = this.game, d = this.world.deltas.get(k);
    delete d.site[id];
    this.touched(k); this.scan();
    g.applyReform?.(s.to);
    if (!Profile.server) { hud.toast(t('reform.done'), 'good'); Audio.unlock(); }
  }

  // ---------- hiring the crew ----------
  // The plans `by` or their partner drew that no crew is on: the biggest group of them (plans within QUOTE_GAP of each other).
  // → { keys (in the order they are built), n, coins, rect, cost } or null
  quote(by = me()) {
    const w = this.world, taken = new Set();
    for (const { s } of this.list('crew')) for (const key of s.keys || []) taken.add(key);
    const pts = [];
    for (const [k, d] of w.deltas) if (isMap(d?.plan) && !k.startsWith('u:')) for (const key in d.plan) {
      const r = d.plan[key], at = parseKey(key);
      if (!at || !isMap(r) || !planned(r.id) || layerOf(r.id) !== at[0] || taken.has(key) || !(r.by === by || areCouple(this.game.family?.v, r.by, by))) continue;
      if (chunkKey(at[1], at[2]) !== k || w.at(...at)) continue;
      pts.push({ key, id: r.id, x: at[1], y: at[2], paid: !!r.p });
    }
    if (!pts.length) return null;
    // (groups: by tiles, joined within the gap)
    const byTile = new Map();
    for (const p of pts) { const tk = `${p.x},${p.y}`; if (!byTile.has(tk)) byTile.set(tk, []); byTile.get(tk).push(p); }
    const seen = new Set();
    let best = null;
    for (const tk of byTile.keys()) {
      if (seen.has(tk)) continue;
      const group = [], go = [tk];
      seen.add(tk);
      while (go.length && group.length < 5000) {
        const q = go.pop(), [x, y] = q.split(',').map(Number);
        group.push(...byTile.get(q));
        for (let j = -QUOTE_GAP; j <= QUOTE_GAP; j++) for (let i = -QUOTE_GAP; i <= QUOTE_GAP; i++) { const n = `${x + i},${y + j}`; if (!seen.has(n) && byTile.has(n)) { seen.add(n); go.push(n); } }
      }
      if (!best || group.length > best.length) best = group;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of best) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const rect = [x0, y0, x1, y1], [mx, my] = centre(rect);
    best.sort((a, b) => rankOf(a.id) - rankOf(b.id) || Math.hypot(a.x + 0.5 - mx, a.y + 0.5 - my) - Math.hypot(b.x + 0.5 - mx, b.y + 0.5 - my) || (a.key < b.key ? -1 : 1));
    const cost = new Map();
    let coins = 0;
    for (const p of best) { coins += labourOf(p.id); if (!p.paid) for (const [m, n] of PIECES[p.id].cost) cost.set(m, (cost.get(m) || 0) + n); }
    return { keys: best.map(p => p.key), n: best.length, coins: Math.max(1, Math.round(coins * (this.game.rep?.buyFactor() ?? 1))), rect, cost: [...cost] };
  }
  // (whoever decides) The record of a crew site, in d (the chunk of its middle). → its id
  newCrew(d, q, by, nm, coins) {
    const id = 'c' + randomId(), now = this.now();
    (d.site ||= {})[id] = { kind: 'crew', t0: now, at: now, by, nm: String(nm || '').slice(0, 24), rect: q.rect, keys: q.keys, n: q.n, done: 0, credit: 0, stop: null, coins };
    this.scan(); this.later();
    return id;
  }
  // Nilo's talk option: the quote, and paying it
  async offerCrew() {
    const g = this.game, q = this.quote();
    const busy = this.crewOf(me());
    if (busy) { await hud.say('Nilo', [t('crew.busy', { done: busy.s.done, n: busy.s.n, when: whenText(this.crewDoneAt(busy.s)) })]); return; }
    if (!q) { await hud.say('Nilo', [t('crew.none')]); return; }
    const ok = g.money >= q.coins;
    const pick = await hud.ask('Nilo', `${t('crew.quote', { n: q.n, coins: q.coins })} ${q.cost.length ? t('crew.materials', { what: matText(q.cost) }) : ''}`.trim(), ok ? [t('crew.yes', { coins: q.coins }), t('npc.nilo.not_now')] : [t('crew.cant', { coins: q.coins })]);
    if (!ok || pick !== 0) return;
    const [cx, cy] = centre(q.rect).map(Math.floor), k = chunkKey(cx, cy), nm = g.player?.name || '';
    const paid = () => { g.addMoney(-q.coins); Audio.unlock(); hud.say('Nilo', [t('crew.hired', { when: whenText(finishAt(this.now(), q.n / CREW_RATE * 60)) })]); g.onSave?.(); };
    if (this.decides()) { this.newCrew(this.world.delta(Math.floor(cx / CHUNK), Math.floor(cy / CHUNK), true), q, me(), nm, q.coins); this.touched(k); paid(); return; }
    g.barrow.claim('site_new', k, { n: q.n, coins: q.coins, nm }, v => { if (v?.ok) paid(); else hud.toast(t('crew.changed'), 'warn'); });
  }
  crewDoneAt(s) { return finishAt(this.now(), Math.max(0, (s.keys?.length || 0) - (s.credit || 0)) / CREW_RATE * 60); }
  // (whoever decides) The crew works: what the hours since the last look give, one piece after another
  workCrew(id, k, s, now) {
    const g = this.game, w = this.world, P = g.plans, mins = workMinutes(Number.isFinite(s.at) ? s.at : s.t0, now);
    s.at = now;
    const gain = mins / 60 * CREW_RATE;
    if (!Array.isArray(s.keys)) s.keys = [];
    // (stopped, the hours count again from the look that finds the material there; till then they are lost)
    if (s.stop && this.canResume(s)) s.stop = null;
    s.credit = s.stop ? Math.min((s.credit || 0) + gain, 1) : (s.credit || 0) + gain;
    let built = 0, tries = 0;
    const V = P?.view;
    while (s.credit >= 1 && s.keys.length && built < BATCH && tries < BATCH * 3) {
      tries++;
      const key = s.keys[0], at = parseKey(key), d = at && w.deltas.get(chunkKey(at[1], at[2])), r = d?.plan?.[key];
      // (erased, someone else's, built meanwhile, or where the crew may not build: it goes from the list)
      if (!at || !isMap(r) || !planned(r.id) || !this.ours(s.by, r.by) || w.at(...at) || villageLand(at[1], at[2]) || (inPlot(at[1], at[2]) && !this.plotOk(s.by))) { s.keys.shift(); continue; }
      const [layer, tx, ty] = at;
      let fits = true;
      if (V) { V.skip = key; try { fits = (layer === 'roof' ? w : V).canPlace(tx, ty, r.id, null); } finally { V.skip = null; } }
      else fits = w.canPlace(tx, ty, r.id, null);
      if (!fits || (layer === 'placed' && P?.someone(tx, ty))) { s.keys.push(s.keys.shift()); if (tries > s.keys.length) { s.stop = []; break; } continue; }
      if (!r.p && !this.payNear(tx, ty, PIECES[r.id].cost)) { s.stop = this.missing(s); break; }
      delete d.plan[key];
      w.planNote(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
      w.place(tx, ty, r.id, r.r || 0);
      s.keys.shift(); s.done = (s.done | 0) + 1; s.credit -= 1; s.stop = null; built++; tries = 0;
    }
    if (s.stop) s.credit = Math.min(s.credit, 1);   // (held up, the hours are not saved up)
    if (built || tries) this.touched(k);
    if (!s.keys.length) { delete w.deltas.get(k).site[id]; this.touched(k); return 'done'; }
    return s.credit >= 1 && !s.stop && built >= BATCH ? 'more' : '';
  }
  // Can the next piece be paid now (or, held up by something in the way, be tried again)?
  canResume(s) {
    if (!s.stop?.length) return true;
    const key = s.keys[0], at = parseKey(key), r = at && this.world.deltas.get(chunkKey(at[1], at[2]))?.plan?.[key];
    if (!isMap(r) || r.p || !PIECES[r.id]) return true;
    const there = new Map();
    for (const { c } of this.chestsNear(at[1] + 0.5, at[2] + 0.5)) for (const q of c) if (q && !q.trophy) there.set(q.id, (there.get(q.id) || 0) + q.n);
    return PIECES[r.id].cost.every(([m, n]) => (there.get(m) || 0) >= n);
  }
  // (the site's own: an op, or whoever decides here)
  plotOk(by) { const L = this.game.live; return !L?.joined || by === me() || !!L.isOp?.(by); }
  // The chests a crew takes from near a tile: the players' (not the village's), not a wheelbarrow nor a cart
  chestsNear(x, y, r = BUILD_STATION_REACH) {
    const w = this.world, out = [];
    for (const o of w.placedNear(x, y, r)) {
      if (!CHESTS[o.placed] || o.fixed || o.unknown || o.placed === 'wheelbarrow' || o.placed === 'cart' || !o.tile) continue;
      const c = w.chestAt(...o.tile);
      if (c) out.push({ o, c });
    }
    return out;
  }
  // Pay a piece from them, all or nothing
  payNear(tx, ty, cost) {
    const w = this.world, chests = this.chestsNear(tx + 0.5, ty + 0.5), there = new Map();
    for (const { c } of chests) for (const s of c) if (s && ITEMS[s.id] && !s.trophy) there.set(s.id, (there.get(s.id) || 0) + s.n);
    for (const [m, n] of cost) if ((there.get(m) || 0) < n) return false;
    for (const [m, total] of cost) {
      let n = total;
      for (const { o, c } of chests) {
        let got = 0;
        for (let j = 0; j < c.length && n > 0; j++) { const s = c[j]; if (!s || s.id !== m || s.trophy) continue; const q = Math.min(n, s.n); s.n -= q; n -= q; got += q; if (s.n <= 0) c[j] = null; }
        if (got) w.chestTouched(...o.tile);
        if (n <= 0) break;
      }
    }
    return true;
  }
  // What is missing for the rest of a site: [[m, n]]
  missing(s) {
    const need = new Map(), w = this.world;
    for (const key of s.keys) { const at = parseKey(key), r = at && w.deltas.get(chunkKey(at[1], at[2]))?.plan?.[key]; if (isMap(r) && !r.p && PIECES[r.id]) for (const [m, n] of PIECES[r.id].cost) need.set(m, (need.get(m) || 0) + n); }
    const R = s.rect, [mx, my] = centre(R), reach = BUILD_STATION_REACH + Math.hypot(R[2] - R[0], R[3] - R[1]) / 2, there = new Map(), seen = new Set();
    for (const { o, c } of this.chestsNear(mx, my, reach)) {
      if (seen.has(c)) continue; seen.add(c);
      const dx = Math.max(R[0] - o.tile[0], 0, o.tile[0] - R[2]), dy = Math.max(R[1] - o.tile[1], 0, o.tile[1] - R[3]);
      if (Math.hypot(dx, dy) > BUILD_STATION_REACH) continue;
      for (const q of c) if (q && !q.trophy) there.set(q.id, (there.get(q.id) || 0) + q.n);
    }
    const out = [...need].map(([m, n]) => [m, n - (there.get(m) || 0)]).filter(([, n]) => n > 0);
    // (enough round the site, but not round that piece: what that one lacks)
    if (!out.length) { const at = parseKey(s.keys[0]), r = at && w.deltas.get(chunkKey(at[1], at[2]))?.plan?.[s.keys[0]]; if (r && PIECES[r.id]) return PIECES[r.id].cost.slice(0, 1).map(([m, n]) => [m, n]); }
    return out;
  }

  // ---------- the upkeep ----------
  // Where it would be: round your bed. [x0, y0, x1, y1] or null
  upkeepRect() {
    const s = this.game.player?.spawn;
    if (!(s?.length === 4)) return null;
    return [s[2] - UPKEEP_R, s[3] - UPKEEP_R, s[2] + UPKEEP_R, s[3] + UPKEEP_R];
  }
  newUpkeep(d, rect, by, nm) {
    const id = 'u' + randomId(), m = monthOf(this.now());
    (d.site ||= {})[id] = { kind: 'upkeep', t0: this.now(), by, nm: String(nm || '').slice(0, 24), rect, paid: m, done: m - 1 };
    this.scan(); this.later();
    return id;
  }
  async offerUpkeep() {
    const g = this.game, has = this.upkeepOf(me());
    if (has) {
      const pick = await hud.ask('Nilo', t('crew.upkeep_on', { coins: UPKEEP_FEE }), [t('crew.upkeep_end'), t('crew.upkeep_keep')]);
      if (pick !== 0) return;
      if (this.decides()) { delete this.world.deltas.get(has.k).site[has.id]; this.touched(has.k); this.scan(); }
      else g.barrow.claim('upkeep_end', has.k, { id: has.id }, () => {});
      await hud.say('Nilo', [t('crew.upkeep_ended')]);
      return;
    }
    const rect = this.upkeepRect();
    if (!rect) { await hud.say('Nilo', [t('crew.upkeep_where')]); return; }
    const ok = g.money >= UPKEEP_FEE, pick = await hud.ask('Nilo', t('crew.upkeep_offer', { coins: UPKEEP_FEE }), ok ? [t('crew.yes', { coins: UPKEEP_FEE }), t('npc.nilo.not_now')] : [t('crew.cant', { coins: UPKEEP_FEE })]);
    if (!ok || pick !== 0) return;
    const [cx, cy] = centre(rect).map(Math.floor), k = chunkKey(cx, cy), nm = g.player?.name || '';
    const paid = () => { g.addMoney(-UPKEEP_FEE); Audio.unlock(); hud.say('Nilo', [t('crew.upkeep_signed')]); g.onSave?.(); };
    if (this.decides()) { this.newUpkeep(this.world.delta(Math.floor(cx / CHUNK), Math.floor(cy / CHUNK), true), rect, me(), nm); this.touched(k); paid(); return; }
    g.barrow.claim('upkeep_new', k, { rect, nm }, v => { if (v?.ok) paid(); });
  }
  // (your game) The month has turned: its fee, or the contract ends
  payMonth() {
    const g = this.game, e = this.upkeepOf(me()), m = monthOf(this.now());
    if (!e || e.s.paid >= m || (e.s.by !== me() && !this.payer(e.s))) return;
    if (g.money < UPKEEP_FEE) {
      if (this.decides()) { delete this.world.deltas.get(e.k).site[e.id]; this.touched(e.k); this.scan(); } else g.barrow.claim('upkeep_end', e.k, { id: e.id }, () => {});
      hud.toast(t('crew.upkeep_lapsed', { coins: UPKEEP_FEE }), 'warn');
      return;
    }
    if (this.paying === m) return;
    this.paying = m;
    const done = () => { g.addMoney(-UPKEEP_FEE); hud.toast(t('crew.upkeep_paid', { coins: UPKEEP_FEE }), 'info'); g.onSave?.(); };
    if (this.decides()) { e.s.paid = m; this.touched(e.k); this.later(); done(); return; }
    g.barrow.claim('upkeep_pay', e.k, { id: e.id, month: m }, v => { if (v?.ok) done(); else this.paying = null; });
  }
  // (a couple: the one who signed pays; the other only when they are not here)
  payer(s) { const L = this.game.live; return !L?.joined || ![...L.peers.values()].some(q => q.playing && q.id === s.by); }
  // (whoever decides) A paid month not yet applied: everything built in its rect, as new
  keep(id, k, s) {
    const w = this.world, wear = this.game.wear, n = wear?.now || 0;
    if (!(s.done < s.paid)) return;
    s.done = s.paid;
    if (n > 0) {
      const R = s.rect;
      for (let cy = Math.floor(R[1] / CHUNK); cy <= Math.floor(R[3] / CHUNK); cy++) for (let cx = Math.floor(R[0] / CHUNK); cx <= Math.floor(R[2] / CHUNK); cx++) {
        const d = w.deltas.get(`${wrapIndex(cx, CHUNK)},${cy}`);
        if (!d) continue;
        let any = false;
        for (const L of ['floor', 'placed', 'roof']) for (const key in d[L] || {}) {
          const [x, y] = key.split(',').map(Number);
          if (x < R[0] || x > R[2] || y < R[1] || y > R[3] || !ruleOf(parsePlaced(d[L][key])[0])) continue;
          (d.aged ||= {})[`${L}:${key}`] = n; any = true;
        }
        if (any) w.touch(cx, cy);
      }
    }
    this.touched(k);
  }

  // ---------- whoever decides: the look at the sites ----------
  settle(now = this.now()) {
    if (!this.world) return;
    let more = false;
    for (const { id, k, s } of this.list()) {
      try {
        if (s.kind === 'reform') { if (s.by === me() && !this.game.live?.guest && workMinutes(s.t0, now) + (s.help || 0) >= s.need) this.finishReform(id, k, s); }
        else if (s.kind === 'crew') { if (this.workCrew(id, k, s, now) === 'more') more = true; }
        else if (s.kind === 'upkeep') this.keep(id, k, s);
      } catch (e) { reportFault(e, 'Works.settle'); }
    }
    this.scan();
    return more;
  }

  // ---------- each frame ----------
  update(dt) {
    const g = this.game, p = g.player;
    if (!this.world) return;
    if (this.strike && g.time >= this.strike.at) { const S = this.strike; this.strike = null; this.land(S); }
    if ((this.checkT -= dt) <= 0) {
      const near = p && this.sites.size && this.list().some(({ s }) => s.kind !== 'upkeep' && this.dist(s.rect, p) < WORKERS_R);
      const more = this.decides() && this.sites.size ? this.settle() : false;
      this.checkT = more ? CATCH_UP_S : near ? CHECK_NEAR_S : CHECK_S;
      if (!this.looked && !Profile.server && p) { this.looked = true; this.notice(null); }
    }
    if (this.on && !Profile.server && p && (this.payT -= dt) <= 0) { this.payT = PAY_S; try { this.payMonth(); } catch (e) { reportFault(e, 'Works.payMonth'); } }
    if (this.toHelp && (this.helpT -= dt) <= 0) this.sendHelp();
    if (!Profile.server && p) this.crew(dt, p);
  }
  dist(R, p) { const x = nearX(Math.max(R[0], Math.min(R[2] + 1, p.x)), p.x), y = Math.max(R[1], Math.min(R[3] + 1, p.y)); return Math.hypot(x - p.x, y - p.y); }
  // What has happened at your sites since you last looked (a guest: what the host sent): a line, once
  notice(was) {
    for (const { id, s } of this.list('crew')) {
      if (!this.ours(s.by)) continue;
      const before = this.seen[id];
      if (was === null && Number.isFinite(before) && s.done > before) hud.toast(t('crew.while_away', { n: s.done - before }), 'info');
      if (was && s.stop && !this.stopSaid?.has(id)) { (this.stopSaid ||= new Set()).add(id); hud.toast(s.stop.length ? t('site.stopped', { missing: matText(s.stop) }) : t('site.blocked'), 'warn'); }
      if (!s.stop) this.stopSaid?.delete(id);
      this.seen[id] = s.done | 0;
    }
    for (const id of Object.keys(this.seen)) if (!this.sites.has(id) && (was === null || was.has(id))) { delete this.seen[id]; hud.toast(t('crew.finished'), 'good'); Audio.unlock?.(); }
  }
  // The line top left (steps.js), near a site of yours
  line() {
    const g = this.game, p = g.player, M = this.lineMemo, now = performance.now();
    if (now - M.t < 500) return M.text;
    M.t = now; M.text = '';
    if (!p || g.scene !== this.world || !this.sites.size) return '';
    for (const { s } of this.list()) {
      if (s.kind === 'upkeep' || !this.ours(s.by) || this.dist(s.rect, p) > LINE_R) continue;
      if (s.kind === 'reform') return (M.text = t('reform.line', { when: whenText(this.doneAt(s)) }));
      return (M.text = s.stop ? (s.stop.length ? t('site.stopped', { missing: matText(s.stop) }) : t('site.blocked')) : t('crew.line', { done: s.done | 0, n: s.n | 0 }));
    }
    return '';
  }

  // ---------- helping, with the hammer ----------
  // The reform site whose walls are aimed at (or that one stands by), with help still to give
  helpSite(p) {
    const g = this.game, mt = g.mouseTile?.() || [Math.floor(p.x + p.face.x), Math.floor(p.y + p.face.y)];
    for (const { id, k, s } of this.list('reform')) {
      const R = s.rect, out = (x, y) => x >= R[0] - 2 && x <= R[2] + 2 && y >= R[1] - 2 && y <= R[3] + 2;
      if (this.dist(R, p) <= 3 && out(...mt) && (s.help || 0) < s.need / 2) return { id, k, s };
    }
    return null;
  }
  // What gather.js asks every system (after plans and wear): with the hammer in hand, at a reform site
  target(p, held, def) {
    const g = this.game;
    if (def?.tool !== HAMMER || g.scene !== this.world || g.build.on || !this.sites.size) return null;
    const e = this.helpSite(p);
    if (!e) return null;
    this.tg.s = e; this.tg.label = t('site.help_hint');
    return this.tg;
  }
  use() {
    const g = this.game, G = g.gather, e = this.tg.s;
    if (!e || this.strike || G.cooldown > 0) return;
    const T = SWING_S * (G.tired?.() ? 1.5 : 1);
    G.cooldown = T; G.swing = 0.25; G.swingItem = HAMMER;
    this.strike = { e, at: g.time + T * 0.55 };
  }
  land(S) {
    const g = this.game, { id, k, s } = S.e, R = s.rect, p = g.player;
    const x = Math.max(R[0], Math.min(R[2] + 1, p.x)), y = Math.max(R[1], Math.min(R[3] + 1, p.y));
    g.gather.chips(x, y, 'wood', 4); Audio.hammer('wood');
    g.skills?.gain('construccion', 0.2);
    if (this.decides()) { const extra = {}; this.addHelp(s, me(), 1, extra); this.touched(k); this.helped(extra); return; }
    const H = (this.toHelp ||= { id, k, n: 0 });
    if (H.id !== id) { this.sendHelp(); this.toHelp = { id, k, n: 0 }; }
    this.toHelp.n++;
    if (this.helpT <= 0) this.helpT = HELP_SEND_S;
  }
  sendHelp() {
    const H = this.toHelp;
    this.toHelp = null; this.helpT = 0;
    if (H?.n) this.game.barrow.claim('site_help', H.k, { id: H.id, n: H.n }, v => this.helped(v || {}));
  }
  // The help has been counted: enough of it, Nilo remembers and the village notices
  helped(v) {
    const g = this.game;
    if (v.full && !this.fullSaid) { this.fullSaid = true; g.gather.float(t('site.help_full'), '#fff3c0'); }
    if (!v.thanks) return;
    g.neighbors?.remember('nilo', 'helped_site');
    g.rep?.change(5, 'helped_site');
    g.gather.float(t('site.help_thanks'), '#bdf0a0');
  }

  // ---------- the hired hands ----------
  crew(dt, p) {
    const g = this.game;
    if ((this.evalT -= dt) <= 0) {
      this.evalT = 1;
      let best = null, bd = WORKERS_R;
      if (g.scene === this.world && this.sites.size && workingNow(this.now())) for (const e of this.list()) {
        if (e.s.kind === 'upkeep' || (e.s.kind === 'crew' && e.s.stop)) continue;
        const d = this.dist(e.s.rect, p);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) { this.workers.length = 0; this.crewAt = null; }
      else if (this.crewAt !== best.id) { this.crewAt = best.id; this.workers = [0, 1].map(i => this.hand(best, i)); }
    }
    if (!this.workers.length) return;
    const e = this.sites.get(this.crewAt), s = e && this.at(this.crewAt);
    if (!s) { this.workers.length = 0; this.crewAt = null; return; }
    for (const w of this.workers) this.work(w, s, Math.min(0.1, dt), p);
  }
  // One of the two: always the same look for the same site
  hand(e, i) {
    const r = k => ihash(e.id.length * 7 + e.id.charCodeAt(1) * 31 + e.id.charCodeAt(2) * 131, k + i * 17, 9131), of = (l, k) => l[Math.floor(r(k) * l.length) % l.length];
    const sex = i === 0 || r(1) < 0.75 ? 'chico' : 'chica';
    const look = { sex, skin: of(['#f6c9a0', '#e8b07a', '#c98a5a', '#a86a42', '#f0c8a8'], 2), hair: of(['#2a1e1e', '#4a2c1c', '#5a3a24', '#8a8480'], 3), eyes: '#3a2a1e', cloth: of(['#7a5a3c', '#5c6b48', '#8a6a48', '#6a3a30', '#5a6470'], 4), pants: of(['#3a3a3a', '#4a3f33', '#3e3428'], 5), outfit: 'chaleco', hairStyle: sex === 'chico' ? of(['corto', 'rapado', 'rizado'], 6) : of(['mono', 'trenza'], 6), beard: sex === 'chico' ? of(['no', 'bigote', 'completa'], 7) : 'no' };
    const R = e.s.rect, [mx, my] = centre(R);
    const w = new Person({ x: R[0] - 1.2 + i * (R[2] - R[0] + 3.4), y: my + 0.3, look });
    const names = sex === 'chico' ? ['Anselmo', 'Braulio', 'Cirilo', 'Dámaso', 'Eusterio', 'Fulgencio', 'Gumersindo', 'Hermenegildo'] : ['Adela', 'Bernarda', 'Clotilde', 'Dolores'];
    return Object.assign(w, { name: of(names, 8), hired: true, wid: `${e.id}:${i}`, slot: { seed: r(9) }, said: 0, i, state: 'go', to: null, until: 0, tool: { held: HAMMER, swing: 0, swingItem: HAMMER, cooldown: SWING_S } });
  }
  // Where one goes next: beside one of the next pieces (a crew site) or along the walls outside (a reform), on open ground
  spot(w, s) {
    const W = this.world, R = s.rect;
    for (let n = 0; n < 6; n++) {
      let x, y, fx, fy;
      if (s.kind === 'crew' && s.keys?.length) {
        const key = s.keys[Math.min(s.keys.length - 1, (w.i + n * 2 + Math.floor(Math.random() * 3)) % Math.max(1, Math.min(s.keys.length, 8)))], at = parseKey(key);
        if (!at) continue;
        const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]], [i, j] = dirs[Math.floor(Math.random() * 4)];
        fx = at[1] + 0.5; fy = at[2] + 0.5; x = fx + i * 0.95; y = fy + j * 0.95;
      } else {
        const side = Math.floor(Math.random() * 4), u = Math.random();
        if (side === 0) { x = R[0] + u * (R[2] - R[0] + 1); y = R[1] - 0.9; fx = x; fy = R[1] + 0.5; }
        else if (side === 1) { x = R[0] + u * (R[2] - R[0] + 1); y = R[3] + 1.9; fx = x; fy = R[3] + 0.5; }
        else if (side === 2) { x = R[0] - 0.9; y = R[1] + u * (R[3] - R[1] + 1); fx = R[0] + 0.5; fy = y; }
        else { x = R[2] + 1.9; y = R[1] + u * (R[3] - R[1] + 1); fx = R[2] + 0.5; fy = y; }
      }
      const tx = Math.floor(x), ty = Math.floor(y), k = W.pieceAt?.(tx, ty)?.kind;
      if (k === 'wall' || k === 'door' || k === 'post' || W.water?.(x, y) || !this.clear(w.x, w.y, x, y)) continue;
      return { x, y, fx, fy };
    }
    return null;
  }
  // Nothing that stands in the way, walking straight there
  clear(ax, ay, bx, by) {
    const W = this.world, n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.5);
    for (let i = 1; i <= n; i++) { const x = ax + (bx - ax) * i / n, y = ay + (by - ay) * i / n, k = W.pieceAt?.(Math.floor(x), Math.floor(y))?.kind; if (k === 'wall' || k === 'post' || k === 'fence') return false; }
    return true;
  }
  work(w, s, dt, p) {
    const g = this.game;
    if (w.state === 'go') {
      if (!w.to) { w.to = this.spot(w, s); if (!w.to) { w.state = 'work'; w.until = g.time + 3; return; } }
      const dx = w.to.x - w.x, dy = w.to.y - w.y, d = Math.hypot(dx, dy), step = 1.1 * dt;
      if (Math.hypot(dxOf(p.x, w.x + dx / (d || 1) * 0.6), p.y - w.y - dy / (d || 1) * 0.6) < 0.5) { w.vx = w.vy = 0; return; }   // (one does not walk through you)
      if (d <= Math.max(0.05, step)) { w.x = w.to.x; w.y = w.to.y; w.vx = w.vy = 0; w.faceTo(w.to.fx - w.x, w.to.fy - w.y); w.state = 'work'; w.until = g.time + 5 + Math.random() * 6; w.next = g.time + 0.4; return; }
      w.vx = dx / d * 1.1; w.vy = dy / d * 1.1; w.x += w.vx * dt; w.y += w.vy * dt; w.faceTo(dx, dy); w.step += step * 3.2;
      return;
    }
    if (g.time >= w.until) { w.state = 'go'; w.to = null; return; }
    if (w.to && g.time >= (w.next || 0)) {
      w.next = g.time + 1.05 + Math.random() * 0.3;
      w.tool.swing += 1;
      const near = Math.hypot(dxOf(w.x, p.x), w.y - p.y);
      if (near < 14) { g.gather.chips(w.to.fx, w.to.fy, 'wood', 2); if (near < 9) Audio.hammer('wood'); }
    }
  }
  entities(scene) { return scene === this.world && this.workers.length ? this.workers : null; }
}

// Nilo's talk options (talk.js): hiring the crew, and the upkeep
if (WORKS_ON) {
  talkOptions.add({ id: 'crew', order: 59, when: c => c.id === 'nilo', label: () => t('crew.ask'), run: c => ({ modal: true, open: () => c.game.works.offerCrew() }) });
  talkOptions.add({ id: 'upkeep', order: 61, when: c => c.id === 'nilo' && (!!c.game.works.upkeepOf(me()) || !!c.game.works.upkeepRect()), label: c => t(c.game.works.upkeepOf(me()) ? 'crew.upkeep_now' : 'crew.upkeep', { coins: UPKEEP_FEE }), run: c => ({ modal: true, open: () => c.game.works.offerUpkeep() }) });
}
// (the house as it will be after a reform: game.js houseRect asks the village's)
export const reformRect = to => (to === 'family' ? HOUSE_FAMILY : to ? HOUSE_BIG : HOUSE);
