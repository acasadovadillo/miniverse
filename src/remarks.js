// What the neighbours say about how you look, as you walk past them, when you talk to them and when you greet them.
// Design: docs/planes/gta/PLAN-E-cuerpo-aspecto.md §4.5 and §6 (the 'rmk' message). Owner: Track C. Phase E2.
//
// Contract (plan §10; keep the names):
//   REMARKS            the condition ids, in priority order. APPEND-ONLY, never reorder or remove: the network sends the
//                      index (rmk.rc, and the Y-greet reply's rc), and old clients must read the same id
//   GOOD_REMARKS       the good-news ids: when one of them holds it is picked first
//   RECALLS            the neighbours' memory kinds (friends[id].mem, neighbors.remember): keys npc.recall.<kind>
//   remarks.update(dt) passing remarks at 1 Hz (a bubble through social.reply, once per neighbour per condition per day)
//   remarks.forTalk(id) the line that replaces neighbour id's greeting in a talk ({ key, cond, text } or null), 60 % of the
//                      time when a condition holds that this neighbour has not remarked today
//   remarks.forGreet(id, rel) the remark that answers a Y-greet ({ cond, rc, key, li, text, gesture } or null), 40 %
//   remarks.heard(msg, peer, conn) a received { t: 'rmk', npc, rc, li } (live.js routes it): the same bubble over that
//                      neighbour, and that neighbour's own remarks wait NPC_GAP s
//   remarks.holding()  the REMARKS ids that hold now, good news first (reused array: read it, do not keep it)
//   remarks.holds(id)  one of them holds
//   remarkKey(cond, temper) the language key of a remark: npc.remark.<cond>.<temper> when that list exists, else
//                      npc.remark.<cond> (both games build the same key from the condition and the neighbour's temper)
//   remarkLines(cond, temper) the lines a remark is picked from: the temper's own list, then the general one (both
//                      games index li into this same joined list)
//   remarkLife(text)   how long a remark's bubble stays: longer lines stay longer (it was not asked for: it must be read)
//
// Where the conditions come from: Body alone (body.conditions: surface, carried things, clothes, temperature, the bath,
// the haircut, new clothes and your partner near), good news first. In creative, as a spectator and on the world server
// nothing is remarked (Body's conditions are survival only).
// Caps (plan §4.5, §14.4): one remark per neighbour per condition per day (friends[id].rem[cond] = day), GAP s between
// two passing remarks anywhere, PER_HOUR an hour, never in a dialogue or with a window open, never while that
// neighbour's bubble is on, never within NPC_GAP s of that neighbour remarking another player, OWN_GAP s between two
// passing remarks of the same neighbour, BAD_GAP s between two passing remarks of the same bad condition by the whole
// village (four neighbours in a row telling you that you are filthy is too much; good news keeps the shorter gaps), and
// `log` once a day by the whole village. Passing remarks change no points;
// the talk effects are in neighbors.js (talk).
// Saved (out.remarks): { v, logDay } (the per-neighbour days are in their friend objects: friends[id].rem).
// Switch: ?comentarios=0 turns every remark off.
// Perf (§11): 1 Hz, at most ~10 neighbours, the arrays are reused.
import { PEOPLE } from './neighbors.js';
import { tList, formatMessage } from './i18n.js';
import { Profile } from './accounts.js';
import { nearX } from './world/planet.js';
import { apagada } from './opciones.js';
import { hud } from './ui/hud.js';

export const REMARKS = [
  'carcass', 'log', 'blood', 'soaked', 'snowy', 'muddy', 'filthy', 'torn', 'underwear', 'barefoot',
  'underdressed', 'overdressed', 'fresh', 'haircut', 'new_clothes', 'couple', 'wrapped_up',
];
export const GOOD_REMARKS = new Set(['fresh', 'haircut', 'new_clothes', 'couple', 'wrapped_up']);
export const RECALLS = ['gift_loved', 'gift_hated', 'insult', 'take_seen', 'helped', 'knock_night', 'project'];

export const NEAR = 6;            // tiles: how close a neighbour must be to remark as you pass
export const GAP = 40;            // s (game time) between two passing remarks anywhere
export const PER_HOUR = 6;        // passing remarks per real hour at most
export const NPC_GAP = 40;        // s a neighbour stays quiet after remarking another player (a received rmk)
export const OWN_GAP = 180;       // s between two passing remarks of the same neighbour (a second condition waits)
export const BAD_GAP = 600;       // s between two passing remarks of the same bad condition, whoever says it
export const HEAR_R = 25;         // tiles: a remark about another player is seen only this near (as a knock is heard)
export const TALK_CHANCE = 0.6;   // a talk: how often a condition replaces the greeting
export const GREET_CHANCE = 0.4;  // a Y-greet: how often the answer is a remark
const NET_GAP = 10;               // s: a second 'rmk' of the same player sooner than this is ignored
const TICK = 1;                   // s between two looks (1 Hz)
const HOUR_MS = 3600 * 1000;
const STATE_V = 1;
const NO_FRIEND = {};   // (a neighbour you never spoke to: no friend entry is made just by walking past)
// The gesture that goes with a remark, by the neighbour's character: a scolding one and a praising one
export const REMARK_GESTURE = {
  bad: { kind: 'nod', cheerful: 'wave', shy: 'flinch', gruff: 'point', wry: 'shrug' },
  good: { kind: 'nod', cheerful: 'wave', shy: 'nod', gruff: 'nod', wry: 'shrug' },
};
export const remarkKey = (cond, temper) => { const k = `npc.remark.${cond}.${temper}`; return tList(k).length ? k : `npc.remark.${cond}`; };
// The temper's lines and the general ones together (a neighbour with only two lines of their own repeated them at once).
// Made once per condition, temper and language list (tList hands back the same arrays until the language changes)
const joined = new Map();
export function remarkLines(cond, temper) {
  const own = tList(`npc.remark.${cond}.${temper}`), all = tList(`npc.remark.${cond}`), k = `${cond}.${temper}`;
  if (!own.length) return all;
  const c = joined.get(k);
  if (c && c.own === own && c.all === all) return c.list;
  const list = own.concat(all);
  joined.set(k, { own, all, list });
  return list;
}
export const remarkLife = text => Math.min(5, 2 + (text?.length || 0) / 20);
export const remarkGesture = (cond, temper) => (GOOD_REMARKS.has(cond) ? REMARK_GESTURE.good : REMARK_GESTURE.bad)[temper] || 'nod';
const temperOf = id => PEOPLE[id]?.temper || 'kind';
const rnd = n => Math.floor(Math.random() * n);
const fresh = () => ({ v: STATE_V, logDay: null });
const day = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ---------- the system (game.remarks, registered right after game.social) ----------
export class Remarks {
  constructor(game) {
    this.game = game;
    this.off = apagada('comentarios');
    this.v = fresh();
    this.acc = 0;
    this.lastAt = -Infinity;   // (game.time of the last passing remark of this player)
    this.stamps = [];          // (Date.now() of the passing remarks of the last real hour, PER_HOUR at most)
    this.npcSaidAt = {};       // neighbour id → game.time of their last remark about another player
    this.ownAt = {};           // neighbour id → game.time of their last passing remark about you
    this.condAt = {};          // bad condition → game.time of its last passing remark (BAD_GAP)
    this._held = []; this._body = [];   // (reused every look)
  }
  get today() { return this.game.days.dayIndex; }

  reset(save) {
    const r = save?.remarks, v = fresh();
    if (r && typeof r === 'object') v.logDay = day(r.logDay);
    this.v = v;
    this.acc = 0; this.lastAt = -Infinity; this.stamps.length = 0; this.npcSaidAt = {}; this.ownAt = {}; this.condAt = {};
  }
  save(out) { out.remarks = this.v; }

  // ---------- what holds ----------
  // The REMARKS ids that hold now, good news first (Body's list, into a reused array)
  holding() {
    const out = this._held, g = this.game, B = g.body;
    out.length = 0;
    if (this.off || Profile.server || !g.player || !B?.counts || typeof B.conditions !== 'function') return out;
    const body = B.conditions(this._body);
    for (const c of body) if (GOOD_REMARKS.has(c)) out.push(c);   // (Body already puts them first: kept in case it stops)
    for (const c of body) if (!GOOD_REMARKS.has(c)) out.push(c);
    return out;
  }
  holds(cond) { return this.holding().includes(cond); }
  // The first condition in held that neighbour f has not remarked today (log: once a day for the whole village; passing:
  // a bad condition some neighbour remarked less than BAD_GAP s ago waits)
  pickFor(f, held, passing = false) {
    const today = this.today, rem = f.rem && typeof f.rem === 'object' ? f.rem : null, now = this.game.time;
    for (const c of held) {
      if (rem && rem[c] === today) continue;
      if (c === 'log' && this.v.logDay === today) continue;
      if (passing && !GOOD_REMARKS.has(c) && now - (this.condAt[c] ?? -Infinity) < BAD_GAP) continue;
      return c;
    }
    return null;
  }
  // Neighbour f has remarked cond today
  mark(f, cond) {
    if (!f.rem || typeof f.rem !== 'object') f.rem = {};
    f.rem[cond] = this.today;
    if (cond === 'log') this.v.logDay = this.today;
  }
  // A line of that remark for that neighbour: { key, li, text } (li into remarkLines)
  line(id, cond, name) {
    const temper = temperOf(id), key = remarkKey(cond, temper), list = remarkLines(cond, temper), li = rnd(Math.max(1, list.length));
    return { key, li, text: list.length ? formatMessage(list[li], { name }) : '' };
  }

  // ---------- passing remarks ----------
  update(dt) {
    if ((this.acc += dt) < TICK) return;
    this.acc = 0;
    const g = this.game, p = g.player, w = g.world;
    if (this.off || Profile.server || !p || !w) return;
    if (g.mode !== 'play' || g.busy || hud.dialogOpen || g.windowsOpen || g.scene !== w || g.gamemode === 'spectator') return;
    if (g.time - this.lastAt < GAP) return;
    const now = Date.now();
    while (this.stamps.length && now - this.stamps[0] > HOUR_MS) this.stamps.shift();
    if (this.stamps.length >= PER_HOUR) return;
    const held = this.holding();
    if (!held.length) return;
    // (the nearest neighbour in sight with something to say)
    let best = null, bestId = null, bestCond = null, bd = NEAR;
    const N = g.neighbors, consider = (id, e) => {
      if (!e || e.hidden || (e.hold > 0)) return;
      const d = Math.hypot(nearX(e.x, p.x) - p.x, e.y - p.y);
      if (d > bd) return;
      if (g.time - (this.npcSaidAt[id] ?? -Infinity) < NPC_GAP || g.time - (this.ownAt[id] ?? -Infinity) < OWN_GAP) return;
      if (g.social?.bubbles.some(b => b.e === e)) return;
      const cond = this.pickFor(N.friends[id] || NO_FRIEND, held, true);
      if (!cond || (w.reaches && !w.reaches(p.x, p.y, e.x, e.y))) return;
      bd = d; best = e; bestId = id; bestCond = cond;
    };
    consider('nilo', w.nilo);
    for (const n of N.people) consider(n.id, n);
    if (!best) return;
    this.say(bestId, best, bestCond, now);
  }
  // Neighbour id (entity e) remarks cond about you, and the others near see it ('rmk')
  say(id, e, cond, now = Date.now()) {
    const g = this.game, f = g.neighbors.friend(id), { li, text } = this.line(id, cond, g.player.name);
    this.mark(f, cond);
    this.lastAt = g.time; this.ownAt[id] = g.time;
    if (!GOOD_REMARKS.has(cond)) this.condAt[cond] = g.time;
    this.stamps.push(now);
    if (!text) return;
    g.social?.reply(e, text, remarkGesture(cond, temperOf(id)), PEOPLE[id]?.name || '', true, null, remarkLife(text));
    const L = g.live;
    if (L?.joined && !Profile.server) L.net?.send({ t: 'rmk', npc: id, rc: REMARKS.indexOf(cond), li });
  }
  // A remark another player's game made about them: the same bubble (they are named in it), and that neighbour waits.
  // Only when that neighbour is within HEAR_R tiles of you, and not while you are in a dialogue or busy (a talk with that
  // same neighbour, a window: it would turn away or go to the subtitle from across the map)
  heard(m, peer, conn) {   // (the order live.js calls it with)
    const g = this.game;
    if (this.off || Profile.server || !g.player || !g.world || g.scene !== g.world || !m) return;
    const id = typeof m.npc === 'string' && Object.prototype.hasOwnProperty.call(PEOPLE, m.npc) ? m.npc : null;
    const cond = Number.isInteger(m.rc) && m.rc >= 0 ? REMARKS[m.rc] : undefined;
    if (!id || !cond || !Number.isInteger(m.li) || m.li < 0 || m.li >= 1000) return;
    if (peer) { if (g.time - (peer.rmkAt ?? -Infinity) < NET_GAP) return; peer.rmkAt = g.time; }   // (a game sends one every GAP s at most)
    this.npcSaidAt[id] = g.time;
    const e = id === 'nilo' ? g.world.nilo : g.neighbors.people.find(n => n.id === id && !n.hidden);
    if (!e || e.hidden) return;
    const p = g.player;
    if (g.busy || hud.dialogOpen || Math.hypot(nearX(e.x, p.x) - p.x, e.y - p.y) > HEAR_R) return;
    const temper = temperOf(id), list = remarkLines(cond, temper);
    if (!list.length) return;
    const text = formatMessage(list[m.li % list.length], { name: peer?.name || '' });
    g.social?.reply(e, text, remarkGesture(cond, temper), PEOPLE[id].name, false, peer?.entity || null, remarkLife(text));
  }

  // ---------- in a talk and on a greeting ----------
  forTalk(id) {
    const g = this.game, held = this.holding();
    if (!held.length || !Object.prototype.hasOwnProperty.call(PEOPLE, id)) return null;
    const f = g.neighbors.friend(id), cond = this.pickFor(f, held);
    if (!cond || Math.random() >= TALK_CHANCE) return null;
    this.mark(f, cond);
    if (cond === 'new_clothes' || cond === 'haircut') g.neighbors.addPoints(id, 3);   // (a compliment, once: they noticed)
    const { key, text } = this.line(id, cond, g.player.name);
    return text ? { key, cond, text } : null;
  }
  // The answer to a Y-greet as a remark (rel: social.relation; a cold neighbour does not pay compliments)
  forGreet(id, rel) {
    const g = this.game, held = this.holding();
    if (!held.length || !Object.prototype.hasOwnProperty.call(PEOPLE, id)) return null;
    const f = g.neighbors.friend(id), cond = this.pickFor(f, held);
    if (!cond || (rel === 'cold' && GOOD_REMARKS.has(cond)) || Math.random() >= GREET_CHANCE) return null;
    this.mark(f, cond);
    const { key, li, text } = this.line(id, cond, g.player.name);
    return text ? { cond, rc: REMARKS.indexOf(cond), key, li, text, gesture: remarkGesture(cond, temperOf(id)) } : null;
  }
}
