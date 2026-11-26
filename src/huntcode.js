// The hunter's code, Paco and the village (Plan R3-4, docs/planes/realismo/PLAN-R3-caza.md §3.9; Decision 3, the recommended
// one: never forbidden, but people talk). A system, game.huntcode. Each player's own: it reads the kills of its own game
// (hunt.js reward, from the host's preydead with mo and cl) and never goes through the network.
//
//   killed(k)        a wild animal you killed: { type, young, female, x, y, bled, placed, mo, cl, cq }
//                    - the code: a young one, a mother with her young by her (mo), a swan; and later a carcass of yours left to
//                      rot (waste). Each costs reputation (reputation.js, the day cap hunt), Paco remembers it (remarks.js
//                      RECALLS hunt_*) and the village hears of it (gossip.js hunt_code)
//                    - a clean kill (cl 1; cl 2, the liver: when you find it within LIVER_FOR): Paco's respect +1, more xp
//   used(cq)         a carcass sold or cut up: a clean one is +5 of reputation (day cap clean)
//   level()          Paco's respect: 1 at 3 clean kills, his tips ("Where's the game?", once a real day, pinned on the map);
//                    2 at 8, he sells you the deer call; 3 at 15 and no breach for BREACH_DAYS, Anselmo pays +15 % and Paco
//                    gives you his old hunting horn (and you can make another). A breach holds back level 3 and the call
//   the deer call    the item deer_call (a click: blow): in the rut a stag answers and comes; out of it a hind may come closer
//                    (wildlife.js called, on whoever runs the world: a guest sends 'call')
//   sheds            in spring (March to May) a cast antler near the bed of some herds in woods (herds.js shedOf): E picks it
//                    up (asta), one per herd and year each player (v.sheds); three/sheds3d.js draws them (this.sheds)
//   the dog          E on your dog with a trail locked: it searches along it (ranch.js search; a guest sends 'dsearch')
//   journal()        the line of the diary's Neighbours tab
// Saved: out.hunt = { v: 1, respect, clean, kills, breach: { young, mother, swan, waste }, lastBreach, lvl, tipDay, tip,
// horn, sheds: { year, cells }, left, pend }. Missing (an old save): zeros. ?codigo=0: nothing is counted or offered (the
// deer call, a sold one, still works); what is saved stays.
import { ANIMALS } from './art/farm.js';
import { BULKY, CARCASS_DAYS } from './carry-items.js';
import { F } from './quality.js';
import { CHUNK } from './world/gen.js';
import { CENTER, inBounds } from './world/village.js';
import { B } from './world/biomes.js';
import { distOf, dxOf, wrapIndex } from './world/planet.js';
import { dayOfYear, rutOn, shedsOn, winterOn, CELL } from './herds.js';
import { herdsOn } from './wildlife.js';
import { talkOptions } from './talk.js';
import { dirOf8 } from './lookout.js';
import { BANDS } from './rumours.js';
import { roll } from './xp.js';
import { Profile } from './accounts.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { apagada } from './opciones.js';
import { t } from './i18n.js';

export const CODE = { young: -15, mother: -20, swan: -30, waste: -10 };
export const CLEAN_REP = 5;
export const LEVELS = [0, 3, 8, 15];
export const BREACH_DAYS = 7;
export const CALL_PRICE = 250, CALL_EVERY = 30;   // coins; seconds between two blows
export const PRICE_K = 1.15;                      // what Anselmo pays more at level 3
export const LIVER_FOR = 5 * 60e3, FOUND_R = 4;   // ms to find a liver-shot one for it to be clean; how near
export const WASTE_PLAYED = 1800;                 // s you must have played since a kill for its rotting to be your waste
const SHED_NEAR = 34, SHED_REACH = 2.4, LEFT_MAX = 8, DAY = 864e5, TICK = 1;
export const HuntCode = { force: null };          // (the tests: on or off without the URL)
export const codeOn = () => HuntCode.force ?? !apagada('codigo');
const fresh = () => ({ v: 1, respect: 0, clean: 0, kills: 0, breach: { young: 0, mother: 0, swan: 0, waste: 0 }, lastBreach: null, lvl: 0, tipDay: null, tip: null, horn: 0, sheds: { year: 0, cells: [] }, left: [], pend: [] });
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
// Paco's respect level by the clean kills and the last breach (today, lastBreach: real days)
export function levelOf(v, today) {
  const r = v.respect, calm = !(typeof v.lastBreach === 'number' && today - v.lastBreach >= 0 && today - v.lastBreach < BREACH_DAYS);
  return r >= LEVELS[3] && calm ? 3 : r >= LEVELS[2] ? 2 : r >= LEVELS[1] ? 1 : 0;
}
export const calmOf = (v, today) => !(typeof v.lastBreach === 'number' && today - v.lastBreach >= 0 && today - v.lastBreach < BREACH_DAYS);
// The kind of land of a point, as Paco says it (hunt.land.*)
const LAND = { [B.FOREST]: 'forest', [B.PINES]: 'pines', [B.MEADOW]: 'meadow', [B.SWAMP]: 'swamp', [B.SNOW]: 'snow' };

export class Code {
  constructor(game) { this.game = game; this.v = fresh(); this.t = 0; this.sheds = []; this.shedsV = 0; this.callAt = -99; this.search = null; this.searchT = 0; }
  get on() { return codeOn(); }
  get counts() { return codeOn() && !!this.game.rep?.counts; }
  get today() { return this.game.days.realDay; }
  get now() { return this.game.days.now; }
  reset(save) {
    const h = save?.hunt, v = fresh();
    if (h && typeof h === 'object') {
      for (const k of ['respect', 'clean', 'kills', 'lvl', 'horn']) v[k] = Math.max(0, Math.floor(num(h[k])));
      for (const k of Object.keys(v.breach)) v.breach[k] = Math.max(0, Math.floor(num(h.breach?.[k])));
      v.lastBreach = Number.isFinite(h.lastBreach) ? h.lastBreach : null;
      v.tipDay = Number.isFinite(h.tipDay) ? h.tipDay : null;
      v.tip = Array.isArray(h.tip) && h.tip.length >= 2 && h.tip.every(Number.isFinite) ? h.tip.slice(0, 3) : null;
      if (h.sheds && Number.isInteger(h.sheds.year) && Array.isArray(h.sheds.cells)) v.sheds = { year: h.sheds.year, cells: h.sheds.cells.filter(c => typeof c === 'string').slice(-200) };
      v.left = (Array.isArray(h.left) ? h.left : []).filter(e => Array.isArray(e) && e.length >= 5 && e.slice(0, 5).every(Number.isFinite)).slice(-LEFT_MAX);
      v.pend = (Array.isArray(h.pend) ? h.pend : []).filter(e => Array.isArray(e) && e.length >= 3 && e.slice(0, 3).every(Number.isFinite)).slice(-4);
    }
    this.v = v; this.t = 0; this.sheds = []; this.shedsV++; this.callAt = -99; this.search = null;
  }
  save(out) { out.hunt = this.v; }
  level() { return levelOf(this.v, this.today); }
  calm() { return calmOf(this.v, this.today); }
  // What Anselmo pays for your carcasses (quality.js carcassOffer)
  priceK() { return this.counts && this.level() >= 3 ? PRICE_K : 1; }

  // ---------- a kill ----------
  killed(k) {
    const g = this.game;
    if (!this.counts || !k || !ANIMALS[k.type]?.wild) return;
    const v = this.v;
    v.kills++;
    const breach = k.type === 'cisne' ? 'swan' : k.young ? 'young' : k.mo ? 'mother' : null;
    if (breach) this.breach(breach, k.x, k.y);
    else if (k.cl === 1 || (k.cl === 2 && !k.bled)) this.clean();
    else if (k.cl === 2) { v.pend.push([Math.round(k.x * 10) / 10, Math.round(k.y * 10) / 10, Math.round(this.now)]); if (v.pend.length > 4) v.pend.shift(); }
    // (a carcass of yours on the ground: if it rots there, it was a waste)
    if (k.placed && !k.young && Number.isFinite(k.x) && Number.isFinite(k.y)) { v.left.push([Math.floor(k.x), Math.floor(k.y), Math.round(this.now), 0, 0]); if (v.left.length > LEFT_MAX) v.left.shift(); }
  }
  // The code broken: reputation, Paco's memory and the village's talk, once per animal (kind: young, mother, swan, waste)
  breach(kind, x, y) {
    const g = this.game, v = this.v;
    v.breach[kind] = (v.breach[kind] || 0) + 1;
    v.lastBreach = this.today;
    g.rep?.change(CODE[kind], 'hunt_' + kind);
    g.neighbors?.remember?.('paco', 'hunt_' + kind);
    g.gossip?.news('hunt_code', (Number.isFinite(x) && g.gossip.seenBy?.()) || 'paco', kind);   // (whoever saw it, or Paco, who reads the signs)
    g.gather?.float(t('hunt.code.' + kind), '#ffb0a0');
    Audio.error?.();
    g.onSave?.();
  }
  clean() {
    const g = this.game, v = this.v, was = this.level();
    v.respect++; v.clean++;
    g.stats?.add('cleanKills', 1);
    g.xp?.add(roll(1, 3));   // (xp twice for it: hunt.js gave the first)
    g.neighbors?.remember?.('paco', 'hunt_clean');
    g.gather?.float(t('hunt.clean'), '#d6f0a8');
    this.levelUp(was);
  }
  levelUp(was = this.v.lvl) {
    const L = this.level();
    if (L > Math.max(was, this.v.lvl)) { hud.toast(t('hunt.respect.' + L), 'good'); Audio.unlock?.(); }
    this.v.lvl = Math.max(this.v.lvl, L);
  }
  // A carcass sold or cut up (carry.js): a clean one, and the village likes it
  used(cq) { if (this.counts && Array.isArray(cq) && cq[6] & F.CLEAN) this.game.rep?.change(CLEAN_REP, 'hunt_clean'); }

  update(dt) {
    const g = this.game, p = g.player;
    if ((this.t += dt) < TICK || !p || Profile.server) return;
    const s = this.t; this.t = 0;
    if (this.counts) { this.pending(p); this.waste(s); if (this.v.respect >= LEVELS[1]) this.levelUp(); }   // (level 3 may come when a week without breaches is over)
    this.findSheds(p);
    this.searching();
  }
  // (a liver-shot one: found in time, it was clean)
  pending(p) {
    const v = this.v, now = this.now, g = this.game;
    if (!v.pend.length) return;
    v.pend = v.pend.filter(([x, y, at]) => {
      if (!(now - at < LIVER_FOR) || now < at) return false;
      if (g.scene === g.world && distOf(p.x, p.y, x, y) < FOUND_R) { this.clean(); return false; }
      return true;
    });
  }
  // (the carcasses you left: one gone before its time was taken; one that rotted while you played, a waste)
  waste(s) {
    const g = this.game, w = g.world, v = this.v;
    if (!v.left.length || !w) return;
    const now = this.now;
    v.left = v.left.filter(e => {
      if (e[4] === 0) {   // (where it lies: by the kill)
        for (let j = -1; j <= 1 && !e[4]; j++) for (let i = -1; i <= 1 && !e[4]; i++) if (this.carcassAt(e[0] + i, e[1] + j)) { e[0] += i; e[1] += j; e[4] = 1; }
        e[3] += s;
        return e[4] === 1 || e[3] < 60;
      }
      if (this.carcassAt(e[0], e[1])) { e[3] += s; return now - e[2] < (CARCASS_DAYS + 2) * DAY; }
      if (now - e[2] >= CARCASS_DAYS * DAY - 2 * 36e5 && e[3] >= WASTE_PLAYED) this.breach('waste');
      return false;
    });
  }
  carcassAt(tx, ty) {
    const w = this.game.world, raw = w.ownAt?.('placed', tx, ty), id = raw && String(raw).split('@')[0];
    return !!BULKY[id]?.prey && !!w.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))?.carcass?.[`${tx},${ty}`];
  }

  // ---------- Paco's tip ----------
  // The best place to hunt in the next hours, round the village: the biggest herd of deer or boar, not on edge, nearer
  // better. A promise (a few cells a frame: talk.think meanwhile): { x, y, kind, when, land } or null
  async bestGame() {
    const g = this.game, H = g.wildlife?.herdsOf?.();
    if (!H || !herdsOn()) return null;
    const ms = this.now, cx0 = Math.floor(CENTER.x / CELL), cy0 = Math.floor(CENTER.y / CELL);
    let best = null, bs = 0, n = 0;
    for (let r = 1; r <= 5; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      if (!H.has(cx0 + i, cy0 + j) && ++n % 3 === 0) await new Promise(ok => setTimeout(ok, 0));
      for (const G of H.cell(cx0 + i, cy0 + j)) {
        if (G.kind === 'swan') continue;
        const md = dayOfYear(ms, G.bed[1]);
        if (G.kind === 'deer' && winterOn(md) && H.pairOf(G)?.to) continue;
        const k = H.members(G, md, ms).length, P = G.kind === 'deer' && winterOn(md) ? H.winterOf(G) : G, d = distOf(P.feed[0], P.feed[1], CENTER.x, CENTER.y);
        const sc = k * (H.isWary(G, ms) ? 0.25 : 1) * (G.kind === 'deer' ? 1.2 : 1) * (rutOn(md) && G.kind === 'deer' ? 1.3 : 1) / (1 + d / 400);
        if (sc > bs) { bs = sc; best = { x: P.feed[0], y: P.feed[1], kind: G.kind, rut: rutOn(md) && G.kind === 'deer' }; }
      }
    }
    if (!best) return null;
    const h = g.days.hourAt(best.x);
    best.when = best.kind === 'boar' ? 'night' : h >= 5 && h < 8 ? 'now' : h >= 17 && h < 21 ? 'now' : h < 17 && h >= 8 ? 'dusk' : 'dawn';
    best.land = LAND[g.world.gen.biomeAt(best.x, best.y)] || 'forest';
    return best;
  }
  // Has somebody taken many from a herd round the village lately? (Paco says so: talktopics.js; only cells already known)
  overhunted() {
    const H = this.game.wildlife?.herds, ms = this.now;
    let hit = false;
    H?.around(CENTER.x, CENTER.y, 0, G => { if (!hit && G.kind !== 'swan' && H.missing(G, ms) >= 3) hit = true; }, 4);
    return hit;
  }
  // Its words: «the pines to the north-west, a walk away»
  placeWords(tip) {
    const dx = dxOf(tip.x, CENTER.x), dy = tip.y - CENTER.y, d = Math.hypot(dx, dy), band = BANDS.find(b => d < b[0]) || BANDS[BANDS.length - 1];
    return t('npc.paco.place', { land: t('hunt.land.' + (tip.land || 'forest')), dir: t(`place.dir.${dirOf8(dx, dy)}`), dist: t(`npc.rumour.dist.${band[1]}`) });
  }
  async tell(c) {
    const { T, N, talk } = c, g = this.game, v = this.v;
    await talk.mine(t('npc.paco.ask_game'));
    if (!T.live) return;
    let tip = v.tipDay === this.today && v.tip ? { x: v.tip[0], y: v.tip[1], kind: v.tip[2] === 1 ? 'boar' : 'deer', land: LAND[g.world.gen.biomeAt(v.tip[0], v.tip[1])] || 'forest', when: v.tip[2] === 1 ? 'night' : 'dawn', again: true } : null;
    if (!tip) {
      let r = null;
      try { [r] = await Promise.all([this.bestGame(), talk.think(T)]); } catch { r = null; }
      if (!T.live) return;
      tip = r;
    }
    if (!tip) { await talk.say(c.id, [N.say('paco', 'paco.no_game')]); return; }
    v.tipDay = this.today; v.tip = [Math.round(tip.x), Math.round(tip.y), tip.kind === 'boar' ? 1 : 0];
    const line = N.say('paco', tip.again ? 'paco.tip_again' : 'paco.tip', { place: this.placeWords(tip), when: t('hunt.when.' + tip.when), animal: t('hunt.game.' + tip.kind) });
    g.route?.set?.({ x: tip.x, y: tip.y, kind: 'point', name: t('hunt.pin') });
    const said = talk.say(c.id, [line, ...(tip.rut ? [N.say('paco', 'paco.tip_rut')] : [])]);
    talk.point(T, tip.x, tip.y);
    await said;
    g.onSave?.();
  }
  // Bought from Paco: the deer call (and you learn to make one)
  buyCall(c) {
    const g = this.game;
    if (g.money < CALL_PRICE) { Audio.error?.(); return c.talk.say(c.id, [c.N.say('paco', 'paco.call_poor', { n: CALL_PRICE })]); }
    const left = g.inv.add('deer_call', 1);
    if (left) { Audio.error?.(); return c.talk.say(c.id, [t('hunt.bag_full')]); }
    g.addMoney(-CALL_PRICE);
    g.craft?.learnPlan?.('deer_call');
    Audio.pickup?.();
    g.onSave?.();
    return c.talk.say(c.id, [c.N.say('paco', 'paco.call_sold')]);
  }
  giveHorn(c) {
    const g = this.game, v = this.v;
    if (v.horn) return null;
    const left = g.inv.add('hunting_horn', 1);
    if (left) g.gather.throwOut('hunting_horn', left);
    v.horn = 1;
    g.craft?.learnPlan?.('hunting_horn');
    Audio.unlock?.();
    g.onSave?.();
    return c.talk.say(c.id, [c.N.say('paco', 'paco.horn')]);
  }

  // ---------- the deer call ----------
  target(p, held, def) {   // (the hook of gather.js: three parameters, as the others)
    const g = this.game;
    if (held?.id !== 'deer_call' || g.scene !== g.world || !p) return null;
    const wait = Math.ceil(CALL_EVERY - (g.time - this.callAt));
    return wait > 0 ? { tile: null, ok: false, label: t('hunt.call.wait', { n: wait }) } : { tile: null, ok: true, label: t('hunt.call.use'), use: () => this.blow() };
  }
  blow() {
    const g = this.game, p = g.player;
    if (!p || g.time - this.callAt < CALL_EVERY) return;
    this.callAt = g.time;
    g.gather.swing = 0.3; g.gather.swingItem = 'deer_call';
    Audio.deerCall?.();
    if (inBounds(p.x, p.y)) return;
    if (g.live?.guest) { g.live.net?.send({ t: 'call', x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }, g.live.hostConn); return; }
    g.wildlife.called(p.x, p.y);
  }
  // (whoever runs the world) A guest blew one where they are
  calledBy(peer, m) {
    const g = this.game, e = peer?.entity;
    if (!e || !Number.isFinite(m.x) || !Number.isFinite(m.y) || distOf(e.x, e.y, m.x, m.y) > 6 || g.time - (peer.callAt ?? -99) < CALL_EVERY * 0.8 || inBounds(m.x, m.y)) return;
    peer.callAt = g.time;
    g.wildlife.called(m.x, m.y);
  }

  // ---------- the cast antlers ----------
  // (once a second: the ones of the herds round you, this spring, that you have not picked up)
  findSheds(p) {
    const g = this.game, ms = this.now, md = dayOfYear(ms, p.y), year = new Date(ms).getUTCFullYear();
    const H = g.scene === g.world && shedsOn(md) && herdsOn() ? g.wildlife?.herdsOf?.() : null, out = [];
    if (this.v.sheds.year !== year) this.v.sheds = { year, cells: [] };
    if (H) H.around(p.x, p.y, 1, G => {
      const s = H.shedOf(G, year);
      if (!s || this.v.sheds.cells.includes(s.key) || distOf(s.x, s.y, p.x, p.y) > SHED_NEAR || g.world.blocked?.(s.x, s.y) || g.wildlife.built(s.x, s.y, 0.3)) return;
      out.push(s);
    }, 1);
    const sig = out.map(s => s.key).join();
    if (sig !== this.shedSig) { this.shedSig = sig; this.sheds = out; this.shedsV++; }
  }
  aimables(p, sc, box) {
    const g = this.game;
    if (!this.sheds.length || !p || sc !== g.world || g.gamemode === 'spectator') return null;
    const out = [];
    for (const s of this.sheds) if (distOf(s.x, s.y, p.x, p.y) < SHED_REACH + 3) out.push({ kind: 'sys', shed: s.key, box: box(s.x, s.y, 0.35, 0.35, 0, 0.3), act: () => (distOf(s.x, s.y, p.x, p.y) <= SHED_REACH ? { text: t('hunt.shed.take'), run: () => this.takeShed(s) } : null) });
    return out.length ? out : null;
  }
  takeShed(s) {
    const g = this.game;
    if (this.v.sheds.cells.includes(s.key)) return;
    const left = g.inv.add('asta', 1);
    if (left) { Audio.error?.(); g.gather.float(t('hunt.bag_full'), '#ffb0a0'); return; }
    this.v.sheds.cells.push(s.key);
    this.sheds = this.sheds.filter(o => o !== s); this.shedsV++; this.shedSig = null;
    g.nature?.saw?.('ciervo', 3, true);   // (the nature book: what the stags leave)
    g.stats?.add('sheds', 1);
    g.gather.float(t('hunt.shed'), '#fff3c0');
    Audio.pickup?.();
    g.onSave?.();
  }

  // ---------- the dog ----------
  // E on your dog with a trail locked: «Search!» (ranch.js asks; it follows what tracks.js has ahead)
  canSearch(a) { const T = this.game.tracks; return !!T?.locked && a?.type === 'perro'; }
  startSearch(a) {
    const g = this.game;
    this.search = { id: a.id, till: g.time + 180 };
    g.gather.float(t('dog.search', { name: a.name || '' }), '#fff3c0');
    Audio.bark?.();
    this.searching(true);
  }
  // (once a second while it searches: the next mark of the trail for it, to whoever moves the dog)
  searching(now = false) {
    const g = this.game, S = this.search, T = g.tracks, p = g.player;
    if (!S) return;
    const a = g.ranch?.animals.find(o => o.id === S.id);
    if (!a || !T?.locked || g.time > S.till || !p || distOf(a.x, a.y, p.x, p.y) > 40) { this.search = null; if (a && !g.live?.guest) a.search = null; else if (a) this.sendSearch(a, null); return; }
    const pt = T.scentAhead?.(a.x, a.y, p.x, p.y);
    if (pt) T.keep?.();
    if (g.live?.guest) this.sendSearch(a, pt);
    else a.search = pt ? { x: pt[0], y: pt[1], till: g.time + 3, owner: 'me' } : a.search && g.time < a.search.till ? a.search : null;
  }
  sendSearch(a, pt) { const L = this.game.live; L.net?.send({ t: 'dsearch', id: a.id, ...(pt ? { x: Math.round(pt[0] * 10) / 10, y: Math.round(pt[1] * 10) / 10 } : {}) }, L.hostConn); }

  // ---------- the diary ----------
  journal() {
    if (!codeOn()) return '';
    const v = this.v, L = this.level();
    if (!v.kills && !v.respect) return '';
    const next = LEVELS[L + 1], frozen = L === 2 && v.respect >= LEVELS[3] && !this.calm();
    return `<div class="rep-box hunt-box"><div class="rep-head"><span>${t('hunt.journal.title')}</span><b>${t('hunt.journal.level.' + L)}</b></div>` +
      `<small>${t('hunt.journal.clean', { n: v.clean, kills: v.kills })}</small>` +
      (next ? `<small>${t(frozen ? 'hunt.journal.frozen' : 'hunt.journal.next', { n: Math.max(0, next - v.respect) })}</small>` : '') + '</div>';
  }
}

// ---------- Paco, in a talk ----------
const paco = c => c.id === 'paco' && !c.cold && codeOn() && !!c.game.huntcode;
talkOptions.add({ id: 'paco_game', order: 22, when: c => paco(c) && c.game.huntcode.level() >= 1, label: () => t('npc.paco.ask_game'), run: c => c.game.huntcode.tell(c) });
talkOptions.add({ id: 'paco_call', order: 46, when: c => paco(c) && c.game.huntcode.level() >= 2 && c.game.huntcode.calm(), label: () => t('hunt.buy_call', { price: CALL_PRICE }), run: c => c.game.huntcode.buyCall(c) });
talkOptions.add({ id: 'paco_horn', order: 21, when: c => paco(c) && c.game.huntcode.level() >= 3 && !c.game.huntcode.v.horn, label: () => t('npc.paco.horn_opt'), run: c => c.game.huntcode.giveHorn(c) });
