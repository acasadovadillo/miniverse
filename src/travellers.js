// The travellers of the roads, near you (docs/planes/realismo/PLAN-R7-mundo.md §3.9, phase R7-6): a pedlar with his pack, a pilgrim
// with her staff, a woodcutter with a log on his shoulder, a fisher with his rod. Who walks each road, where and when, is
// world/travel.js's: the world clock and the road, the same in every game and in the world server, with nothing sent. Here, what
// is drawn of it near the player only (at most MAX bodies, looked for every EVAL s within SCAN m; one comes out within SPAWN and
// goes beyond DROP): their bodies (three/travellers3d.js dresses them), the way they stop for you and step round you, or round what
// a player has built on the road (never in through a door: walkways.js strict), greeting them (Y: social.js), talking to them (E:
// talk.js stranger) and what they have: the pedlar's goods (a shop of five things, other ones each day), the woodcutter's
// firewood, the fisher's catch, the pilgrim's news of a place (rumours.js fromRoad) or what is told of where she goes. And the
// camps where one of them sleeps tonight: the fire lit and the tent shut (explore.js asks campState), cold ashes in the morning.
// What is drawn may fall behind the schedule (a talk, a detour) and catches it up; it never changes it. What you buy of one of
// them is yours (the save's travel). None of it on the world server; ?viajeros=0: nobody on the roads.
import { ihash } from './util.js';
import { Person } from './entities.js';
import { Profile } from './accounts.js';
import { SHOPS, buyPrice } from './economy.js';
import { ITEMS, CROPS, FISH } from './items.js';
import { seedOf } from './cropdata.js';
import { clothesFor, fullLook } from './looks.js';
import { countOf } from './talktopics.js';
import { TravelPlan, WALK, PAUSE_AT, OFF, CAMP_R, along, hoursAt } from './world/travel.js';
import { nearX, dxOf, wrapX } from './world/planet.js';
import { solid, wayTo } from './world/walkways.js';
import { dirOf8 } from './lookout.js';
import { dress } from './three/travellers3d.js';
import { apagada } from './opciones.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { t, tList, fmt, formatMessage } from './i18n.js';

export const OFF_SWITCH = apagada('viajeros');
export const EVAL = 0.5, SCAN = 120, SPAWN = 70, DROP = 90, MAX = 4;
const CAMPS_R = 200;                        // the camps whose fire is looked at
const CATCH_UP = 1.35, SNAP = 25, FAR_SNAP = 40;   // how much faster they walk to catch the schedule up; farther behind, they are put
                                                   // there, if you would not see it
const BLOCK_A = 1.3, BLOCK_B = 0.7, WAIT = 0.9;   // (you in their way: so far ahead, so near the line; s they wait)
const AHEAD = [[0.45, 0], [0.9, 0], [0.6, 0.3], [0.6, -0.3]];   // (where in front of him he looks for what is built: ahead, to the side)
const WARM_MS = 2;                          // ms an evaluation may spend on the land along a road (travel.js warm)
const KEEP_DAYS = 2;                        // what you bought of them, kept so many days
const POOL = ['cuerda', 'tela', 'vela', 'salt', 'soap', 'lazo', 'horquillas', 'brujula', 'mapa_vacio', 'cepillo', 'antorcha'];
const RIVER = ['trucha', 'barbel', 'tench', 'carpa', 'perca', 'lucio', 'anguila'];
const TEMPERS = ['kind', 'cheerful', 'wry', 'gruff', 'shy'];
const NAMES = {
  chico: ['Baltasar', 'Ceferino', 'Demetrio', 'Evaristo', 'Fabián', 'Genaro', 'Higinio', 'Leandro', 'Macario', 'Nemesio', 'Olegario', 'Prudencio', 'Rufino', 'Severo', 'Tadeo', 'Venancio', 'Zenón', 'Abundio', 'Cosme', 'Feliciano'],
  chica: ['Amparo', 'Brígida', 'Candela', 'Dionisia', 'Filomena', 'Genoveva', 'Inocencia', 'Justa', 'Manuela', 'Nieves', 'Paz', 'Rosalía', 'Tomasa', 'Valeriana', 'Elvira', 'Socorro'],
};
const SKIN = ['#f6c9a0', '#e8b07a', '#c98a5a', '#a86a42', '#8a5234', '#f0c8a8'], HAIR = ['#2a1e1e', '#4a2c1c', '#5a3a24', '#7a4a2a', '#8a8480', '#a8a4ac'];
// How each trade dresses: men of a hundred, their clothes, outfit and what they have on the head and over everything
const DRESS = {
  pedlar: { men: 0.7, cloth: ['#8a6a48', '#7a6040', '#9a8466', '#6e5a48'], pants: ['#3e3428', '#4a3f33'], outfit: ['chaleco'], her: ['delantal', 'larga'], hat: [{ id: 'sombrero', color: '#5a4630' }, null, { id: 'gorro', color: '#4a3f33' }] },
  pilgrim: { men: 0.55, cloth: ['#5a4a3a', '#6a5a48', '#4a4038'], pants: ['#3a3128'], outfit: ['larga'], her: ['larga'], hat: [{ id: 'sombrero', color: '#4a3a2a' }], outer: { id: 'wool_coat', color: '#5a4836' } },
  woodcutter: { men: 0.9, cloth: ['#8a4438', '#5c6b48', '#7a5a3c', '#6a3a30'], pants: ['#3a3a3a', '#4a3f33'], outfit: ['chaleco'], her: ['chaleco'], hat: [{ id: 'gorro', color: '#5a4a3a' }, null] },
  fisher: { men: 0.8, cloth: ['#3f5f7a', '#6a7d86', '#4a5a66'], pants: ['#3a3a3a', '#4a4a52'], outfit: ['chaleco'], her: ['delantal'], hat: [{ id: 'gorro', color: '#3a4450' }, { id: 'sombrero', color: '#c8b080' }] },
};
// A traveller's one shop: what is in it is set when it is opened (travellers.js openGoods)
SHOPS.pedlar = { hours: [0, 24], stock: [] };

const seedOf_ = slot => Math.floor(slot.seed * 2147483647);
// Who someone of a slot is: their name, look and temper, always the same for the same slot
export function personOf(slot) {
  const r = k => ihash(seedOf_(slot), k, 7331), of = (l, k) => l[Math.floor(r(k) * l.length) % l.length], D = DRESS[slot.type];
  const sex = r(1) < D.men ? 'chico' : 'chica';
  const look = { sex, skin: of(SKIN, 2), hair: of(HAIR, 3), eyes: '#3a2a1e', cloth: of(D.cloth, 4), pants: of(D.pants, 5), outfit: of(sex === 'chico' ? D.outfit : D.her, 6),
    hairStyle: sex === 'chico' ? of(['corto', 'corto', 'rapado', 'rizado'], 7) : of(['mono', 'trenza', 'coleta'], 7), beard: sex === 'chico' ? of(['no', 'bigote', 'completa', 'candado', 'larga'], 8) : 'no' };
  const wear = clothesFor(fullLook(look)), hat = of(D.hat, 9);
  if (hat) wear.cabeza = { ...hat };
  if (D.outer) wear.outer = { ...D.outer };
  return { name: of(NAMES[sex], 10), look: { ...look, wear }, temper: of(TEMPERS, 11) };
}

export class Travellers {
  constructor(game) {
    this.game = game;
    this.off = OFF_SWITCH;
    this.plan = null;
    this.people = [];          // the bodies out now (Persons), at most MAX
    this.found = [];           // (what the last look found: reused)
    this.at = {};              // (where one is by the schedule: reused)
    this.p2 = { x: 0, y: 0, ux: 0, uy: 0, i: 0 };
    this.evalT = 0; this.after = null;
    this.camps = new Map();    // a camp's key → [state, until (game time)]
    this.bought = new Map();   // 'slot id:what' → the real day
    this.stats = { evals: 0, ms: 0, worst: 0, frame: 0 };
  }
  get world() { return this.game.world; }
  get roads() { return this.world?.gen?.roads || null; }
  get now() { return this.game.days.now; }
  reset(save) {
    this.clear(); this.plan = null; this.camps.clear(); this.after = null;
    this.bought = new Map();
    const v = save?.travel, today = this.game.days?.realDay ?? 0;
    if (v && Array.isArray(v.b)) for (const q of v.b) if (Array.isArray(q) && typeof q[0] === 'string' && Number.isFinite(q[1]) && today - q[1] <= KEEP_DAYS) this.bought.set(q[0].slice(0, 120), q[1]);
  }
  save(out) {
    const today = this.game.days?.realDay ?? 0, b = [...this.bought].filter(q => today - q[1] <= KEEP_DAYS).slice(-60);
    if (b.length) out.travel = { b };
  }
  clear() { this.people.length = 0; }
  // The plan of this world's roads (its lines as they come: none is traced here in a frame)
  planNow() {
    const R = this.roads;
    if (!R) return null;
    if (this.plan?.roads !== R) this.plan = new TravelPlan(R, { lazy: true, line: e => readyLine(R, e) });
    return this.plan;
  }

  // ---------- each frame ----------
  update(dt) {
    const g = this.game, p = g.player;
    if (this.off || Profile.server || !p || g.scene !== this.world) { if (this.people.length) this.clear(); return; }
    const P = this.planNow();
    if (!P) { if (this.people.length) this.clear(); return; }
    if ((this.evalT -= dt) <= 0) { this.evalT = EVAL; this.look(P, p); }
    if (this.after && !g.windowsOpen && g.time > this.afterT) this.after = null;   // (the pedlar waits while you look at his goods)
    const t0 = performance.now(), now = this.now;
    for (const e of this.people) this.move(P, e, Math.min(0.1, dt || 0), now);
    this.stats.frame = performance.now() - t0;
  }
  // Every EVAL s: who is out near you, who comes out and who goes; and the camps near
  look(P, p) {
    const t0 = performance.now(), now = this.now, until = t0 + WARM_MS, R = this.roads;
    // (until explore.js has worked out the roads' graph round here, as it does ahead of you, nobody: after a jump, nothing is
    // worked out at once for them)
    const ck = `${Math.floor(p.x / 16)},${Math.floor(p.y / 16)}`;
    if (this.knownAt !== ck && !P.known(wrapX(p.x), p.y, CAMPS_R + CAMP_R)) {
      this.stats.waits = (this.stats.waits || 0) + 1;
      this.people = this.people.filter(e => this.game.talk?.cur?.e === e || Math.hypot(dxOf(e.x, p.x), e.y - p.y) <= DROP);   // (left behind: gone all the same)
      return;
    }
    this.knownAt = ck;   // (once known round here, it stays: the cells are not forgotten)
    const t1 = performance.now(), edges = R.edgesBy(wrapX(p.x), p.y, CAMPS_R + CAMP_R);
    for (const [e] of edges) { const r = readyLine(R, e); if (r && !P.warm(e, r, until)) break; }
    const t2 = performance.now(), n = P.near(p.x, p.y, now, SCAN, this.found, edges), keep = new Set(), t3 = performance.now();
    // (the nearest first; those already out stay out until DROP)
    const list = this.found.slice(0, n).sort((a, b) => a.d - b.d);
    for (const o of list) {
      const had = this.people.find(e => e.tid === o.slot.id);
      if (had) { if (o.d <= DROP && keep.size < MAX) keep.add(had); continue; }
      if (o.d > SPAWN || keep.size >= MAX) continue;
      const e = this.make(o.slot, o);
      this.people.push(e); keep.add(e);
    }
    this.people = this.people.filter(e => keep.has(e) || this.game.talk?.cur?.e === e);
    const t4 = performance.now();
    this.campsNear(P, p);
    const ms = performance.now() - t0, W = (this.stats.parts ||= [0, 0, 0, 0, 0]);
    [t1 - t0, t2 - t1, t3 - t2, t4 - t3, performance.now() - t4].forEach((v, i) => { W[i] = Math.max(W[i], +v.toFixed(1)); });
    this.stats.evals++; this.stats.ms += ms; this.stats.worst = Math.max(this.stats.worst, ms);
  }
  // The bodies to draw (actors.js): those out and in sight
  entities(scene) {
    if (scene !== this.world || !this.people.length) return null;
    const out = (this.shown ||= []);
    out.length = 0;
    for (const e of this.people) if (!e.hidden) out.push(e);
    return out;
  }
  make(slot, o) {
    const q = personOf(slot), e = new Person({ x: o.x, y: o.y, look: q.look });
    return Object.assign(e, { tid: slot.id, slot, type: slot.type, name: q.name, temper: q.temper, traveller: true, hold: 0, wait: 0, side: 0, sideT: 0, way: null, hidden: false, said: 0,
      carrying: null, gear: P => dress(P, e) });
  }
  // A traveller drawn: towards where the schedule has them, at their pace (faster if behind); stopped while they talk or a
  // moment after a greeting; waiting for you if you stand in their way and then stepping round you; round what is built on the road
  move(P, e, dt, now) {
    const g = this.game, p = g.player, o = P.where(e.slot, now, this.at);
    if (!o.vis) { e.hidden = true; e.vx = e.vy = 0; return; }
    let tx = nearX(o.x, e.x), ty = o.y;
    if (o.k === OFF) [tx, ty] = this.offPath(e, o, tx, ty);
    e.carrying = e.type === 'woodcutter' && o.leg % 2 === 0 && o.k !== OFF && !this.bought.has(`${e.tid}:wood`) ? 'log' : null;
    this.load(e);
    const talking = g.talk?.cur?.e === e || this.after === e;
    if (e.hold > 0) e.hold -= dt;
    if ((talking || e.hold > 0) && !e.hidden) { e.vx = e.vy = 0; if (talking) e.faceTo(dxOf(p.x, e.x), p.y - e.y); return; }
    // (gone round what is built by the fields, out of sight: back when the schedule has him past it)
    if (e.lostUntil) { if (g.time < e.lostUntil || this.blocked(tx, ty)) { e.hidden = true; e.vx = e.vy = 0; return; } e.lostUntil = 0; }
    const gap = Math.hypot(tx - e.x, ty - e.y);
    // (out of sight, or far behind where you do not see it, as after the clock is moved: there now. Near you he walks it up)
    if (e.hidden || (gap > SNAP && Math.hypot(dxOf(p.x, e.x), p.y - e.y) > FAR_SNAP && Math.hypot(dxOf(p.x, tx), p.y - ty) > FAR_SNAP)) {
      e.hidden = false; e.way = null; e.x = wrapX(tx); e.y = ty; e.vx = e.vy = 0;
      if (o.moving) e.faceTo(o.ux, o.uy);
      return;
    }
    if (gap < 0.05) { e.vx = e.vy = 0; e.wait = 0; if (!o.moving && o.k === PAUSE_AT) this.idleFace(e, o, p); return; }
    // (the way round what is built in front of them, point by point)
    let wx = tx, wy = ty;
    if (e.way?.length) { const q = e.way[0]; wx = nearX(q[0], e.x); wy = q[1]; if (Math.hypot(wx - e.x, wy - e.y) < 0.3) { e.way.shift(); if (!e.way.length) e.way = null; } }
    let dx = wx - e.x, dy = wy - e.y, d = Math.hypot(dx, dy) || 1;
    let ux = dx / d, uy = dy / d;
    // You in their way: they wait, then go round you on the side away from you
    const ax = dxOf(p.x, e.x), ay = p.y - e.y, along1 = ax * ux + ay * uy, across = ax * uy - ay * ux;
    if (along1 > 0 && along1 < BLOCK_A && Math.abs(across) < BLOCK_B) {
      if ((e.wait += dt) < WAIT) { e.vx = e.vy = 0; e.faceTo(ux, uy); return; }
      // (you are on the side -across of the way he goes: he leans to the other one)
      if (!e.sideT) e.side = across >= 0 ? 1 : -1;
      e.sideT = 2.5;
    } else e.wait = Math.max(0, e.wait - dt);
    if (e.sideT > 0) { e.sideT = Math.max(0, e.sideT - dt); const sx = ux * 0.55 + -uy * e.side * 0.84, sy = uy * 0.55 + ux * e.side * 0.84, l = Math.hypot(sx, sy); ux = sx / l; uy = sy / l; if (along1 < -0.4) e.sideT = Math.min(e.sideT, 0.4); }
    // What a player built in the road ahead: the way round it (once); with none, he is not drawn until he is past it
    if (!e.way && this.ahead(e, ux, uy)) {
      let ahead = null;
      for (const m of [9, 14, 20]) { ahead = this.beyond(e, o, m); if (!ahead || !this.blocked(ahead[0], ahead[1])) break; }
      const way = ahead && wayTo(g.world, [e.x, e.y], ahead, true);
      if (way?.length) e.way = way.slice(0, 40); else { e.lostUntil = g.time + 3; e.hidden = true; e.vx = e.vy = 0; return; }
    }
    const v = e.slot.speed * (gap > 1.2 && !e.way ? CATCH_UP : 1), step = Math.min(v * dt, d);
    e.x = wrapX(e.x + ux * step); e.y += uy * step;
    e.vx = ux * v; e.vy = uy * v; e.step += step * 3.2;
    e.faceTo(ux, uy);
  }
  // Resting at the end of the road: towards you if you are near, else back along the road
  idleFace(e, o, p) { const dx = dxOf(p.x, e.x), dy = p.y - e.y; if (Math.hypot(dx, dy) < 4) e.faceTo(dx, dy); else e.faceTo(o.ux, o.uy); }
  // The woodcutter's log, while he has it (three/travellers3d.js)
  load(e) {
    const m = this.game.view3d?.actors?.models?.get(e), L = m?.person?.tvLoad;
    if (L && L.visible !== !!e.carrying) L.visible = !!e.carrying;
  }
  // Is anything built in the next steps (a little to each side too: a corner is not cut)?
  ahead(e, ux, uy) { for (const [a, b] of AHEAD) if (this.blocked(e.x + ux * a - uy * b, e.y + uy * a + ux * b)) return true; return false; }
  // Is a tile taken by something a player built (walls, fences, furniture, doors and gates too)?
  blocked(x, y) { const w = this.world; return !!w?.at && solid(w, Math.floor(x), Math.floor(y), true); }
  // The point m metres further on along the road from where the schedule has them, or null
  beyond(e, o, m) {
    const r = e.slot.r, q = o.q;
    if (!q || o.k === OFF) return null;
    const dir = q.s1 >= q.s0 ? 1 : -1, p = along(r, o.s + dir * m, this.p2);
    return [nearX(p.x, e.x), p.y];
  }
  // Off the road, to the camp or from it: along its track (roads.js) when the track leaves his road; else the straight line
  offPath(e, o, tx, ty) {
    const c = e.slot.camp, R = this.roads, tr = R?.lines.get(`t${c.s.key}`);
    if (!tr || tr.parent?.id !== e.slot.e.id) return [tx, ty];
    const q = o.q, f = Math.max(0, Math.min(1, (hoursAt(this.now, e.slot.r.pts[0]) - q.t0) / (q.t1 - q.t0))), k = q.out ? f : 1 - f, p = along(tr, k * tr.len, this.p2);
    if (k >= 0.999) return [tx, ty];
    return [nearX(p.x, e.x), p.y];
  }

  // ---------- the camps ----------
  // 1: someone sleeps at this camp now (its fire lit, its tent shut), 2: the morning after (cold ashes), 0: neither. Asked when the
  // camp's chunk is drawn (explore.js): what campsNear found the last time, nothing worked out
  campState(p) {
    if (this.off || Profile.server || p.kind !== 'campamento') return 0;
    return this.camps.get(p.key)?.[0] ?? 0;
  }
  // Every few seconds, the camps round you (the land there known already: nothing is worked out for this): who sleeps at them now
  campsNear(P, p) {
    if ((this.campT = (this.campT || 0) - EVAL) > 0) return;
    this.campT = 2;
    const g = this.game, list = P.sites.known(wrapX(p.x), p.y, CAMPS_R, ['minor'], (this.knownTmp ||= []));
    this.near = [];
    for (const s of list) {
      if (s.kind !== 'campamento' || !g.places?.cache?.has(s.key)) continue;   // (one explore.js has not looked at yet: later)
      const poi = g.places.poiOf(s.key);
      if (poi?.kind !== 'campamento' || g.places.deserted(poi)) continue;
      const v = P.campState(poi, this.now);
      this.camps.set(s.key, [v]);
      if (v === 1 && Math.hypot(dxOf(s.x, p.x), s.y - p.y) < 90) this.near.push(poi);
    }
    if (this.camps.size > 200) this.camps.delete(this.camps.keys().next().value);
  }
  // The tent of a camp where someone sleeps: where it is, or null
  tentOf(poi) { const L = this.game.places?.planOf(poi), o = L?.props?.find(q => q.m.startsWith('tent:')); return o ? o : null; }

  // ---------- aiming and E ----------
  aimables(p, sc, box) {
    if (this.off || sc !== this.world) return null;
    const out = [], g = this.game;
    for (const e of this.people) {
      if (e.hidden || Math.hypot(dxOf(e.x, p.x), e.y - p.y) > 4) continue;
      out.push({ kind: 'sys', e, box: box(nearX(e.x, p.x), e.y, 0.35, 0.35, 0, g.view3d?.personHeight?.(e, 1.6) ?? 1.6), act: () => this.action(e) });
    }
    for (const poi of this.near || []) {
      const o = this.tentOf(poi);
      if (o && Math.hypot(dxOf(o.x, p.x), o.y - p.y) < 5) out.push({ kind: 'sys', e: null, box: box(nearX(o.x, p.x), o.y, 1.1, 1.1, 0, 1.4), act: () => ({ text: t('place.camp.sleeping'), run: () => { hud.toast(t('place.camp.let_sleep')); Audio.blip(); } }) });
    }
    return out.length ? out : null;
  }
  // Without a mouse: who is nearest, within reach
  interact(p, sc) {
    if (this.off || sc !== this.world) return null;
    let best = null, bd = 1.7;
    for (const e of this.people) { const d = Math.hypot(dxOf(e.x, p.x), e.y - p.y); if (!e.hidden && d < bd) { bd = d; best = e; } }
    return best ? this.action(best) : null;
  }
  action(e) { return { text: t('traveller.talk', { name: e.name, trade: this.trade(e) }), run: () => this.talk(e) }; }
  trade(e) { return t(`traveller.${e.type}`, { sex: e.look.sex === 'chica' ? 'girl' : 'boy' }); }

  // ---------- greeting (social.js) ----------
  // Their answer to a greeting (a 0) or to being provoked (a 1): { text, gesture }
  answer(e, a) {
    return { text: this.pick(e, a ? 'traveller.insulted' : this.game.days.info?.rain ? 'traveller.greet.rain' : 'traveller.greet'), gesture: a ? 'dismiss' : 'wave' };
  }

  // ---------- talking (talk.js stranger) ----------
  talk(e) {
    const g = this.game;
    if (!g.talk?.stranger) return;
    g.talk.stranger({ id: `tv:${e.tid}`, e, name: e.name, temper: e.temper, say: key => this.word(e, key), run: T => this.chat(T, e) });
  }
  // Their words for what the talk itself says (talk.js: 'so', 'bye', 'cut.…')
  word(e, key) {
    const k = key === 'so' ? 'traveller.so' : key.startsWith('bye') ? 'traveller.bye' : key === 'cut.bow' ? 'traveller.cut.bow' : 'traveller.cut';
    return this.pick(e, k);
  }
  pick(e, key, P) { const l = tList(key), v = l.length ? l[(e.said++ + (e.slot.seed * 1000 | 0)) % l.length] : ''; return P && v ? formatMessage(v, P) : v; }
  async chat(T, e) {
    const g = this.game, talk = g.talk, id = T.id;
    await talk.say(id, [this.pick(e, `traveller.hello.${e.type}`)]);
    while (T.live) {
      const rows = this.rows(e);
      const k = await talk.menu(T, rows);
      if (!T.live) return;
      if (!k || k === 'bye') { talk.bye(T); return; }
      if (k === 'where') await talk.say(id, [this.whereLine(e)]);
      else if (k === 'road') await talk.say(id, [this.roadLine(e)]);
      else if (k === 'goods') { await talk.say(id, [this.pick(e, 'traveller.goods')], { wait: true, dur: 1.1 }); if (!T.live) return; talk.close(T, 'handoff'); this.openGoods(e); return; }
      else if (k === 'wood') await this.sellWood(T, e);
      else if (k === 'catch') await this.sellCatch(T, e);
      else if (k === 'news') await this.news(T, e);
      if (talk.auto && ++T.rounds > 8) { talk.bye(T); return; }
    }
  }
  rows(e) {
    const rows = [{ id: 'where', text: t('traveller.opt.where') }];
    if (e.type === 'pedlar') rows.push({ id: 'goods', text: t('traveller.opt.goods') });
    if (e.type === 'woodcutter' && e.carrying) rows.push({ id: 'wood', text: t('traveller.opt.wood', { n: 4, price: this.woodPrice() }) });
    if (e.type === 'fisher' && !this.bought.has(`${e.tid}:catch`)) { const c = this.catchOf(e); rows.push({ id: 'catch', text: t('traveller.opt.catch', { what: c.text, price: c.price }) }); }
    if (e.type === 'pilgrim') rows.push({ id: 'news', text: t('traveller.opt.news') });
    rows.push({ id: 'road', text: t('traveller.opt.road') }, { id: 'bye', text: t('npc.opt.bye') });
    return rows;
  }
  // The end of his road he goes to, in words
  endTitle(slot, end) {
    const n = end ? slot.e.b : slot.e.a, P = this.game.places;
    if (n.kind === 'home') return t('traveller.village');
    const poi = P?.poiOf(n.id);
    return poi ? P.title(poi) : t('traveller.somewhere');
  }
  whereLine(e) {
    const o = this.plan.where(e.slot, this.now, this.at), last = o.q && e.slot.legs[e.slot.legs.length - 1];
    if (!o.vis) return this.pick(e, 'traveller.cut');
    const camp = e.slot.camp, toCamp = camp && o.q && (o.k === OFF ? o.q.out : o.k === WALK && o.q.s1 === camp.sj && o.q !== last);
    if (toCamp) return this.pick(e, 'traveller.to_camp');
    if (o.k === OFF || (camp && o.q === last)) return this.pick(e, 'traveller.from_camp', { title: this.endTitle(e.slot, o.q.s1 > 0 ? 1 : 0) });
    if (o.k === PAUSE_AT) return this.pick(e, 'traveller.resting', { title: this.endTitle(e.slot, o.s > 0 ? 0 : 1) });
    const km = Math.max(0.1, Math.round(Math.abs(o.q.s1 - o.s) / 100) / 10);
    return this.pick(e, 'traveller.going', { title: this.endTitle(e.slot, o.toward), km });
  }
  roadLine(e) {
    const c = this.plan.night(e.slot) ? e.slot.camp : null, p = this.game.player;
    if (c) return this.pick(e, 'traveller.road.camp', { dir: t(`place.dir.${dirOf8(dxOf(c.s.x, p.x), c.s.y - p.y)}`) });
    if (e.slot.r.bridges?.length) return this.pick(e, 'traveller.road.bridge');
    return this.pick(e, 'traveller.road.any');
  }
  // The pedlar's goods today: five things of his pool, and a seed of what is not in season (from far away), dearer
  goodsOf(e) {
    const r = k => ihash(seedOf_(e.slot), k, 7349), pool = POOL.filter(id => ITEMS[id] && buyPrice(id) > 0), out = [];
    while (out.length < 4 && pool.length) out.push(...pool.splice(Math.floor(r(out.length) * pool.length) % pool.length, 1));
    const season = this.game.days.season, seeds = Object.keys(CROPS).filter(c => ITEMS[seedOf(c)] && !(CROPS[c].seasons || []).includes(season));
    const stock = out.map(id => ({ id, price: Math.max(2, Math.round(buyPrice(id) * 1.15)) }));
    if (seeds.length) { const id = seedOf(seeds[Math.floor(r(9) * seeds.length) % seeds.length]); stock.push({ id, price: Math.max(4, Math.round((buyPrice(id) || 20) * 1.6)) }); }
    return stock;
  }
  openGoods(e) { SHOPS.pedlar.stock = this.goodsOf(e); this.after = e; this.afterT = this.game.time + 1; this.game.onShop?.('pedlar'); }
  woodPrice() { return Math.max(4, Math.round(4 * buyPrice('madera') * 0.9)); }
  async sellWood(T, e) {
    const g = this.game, price = this.woodPrice();
    if (g.money < price) { await g.talk.say(T.id, [this.pick(e, 'traveller.no_money')]); return; }
    if (g.inv.room('madera') < 4) { await g.talk.say(T.id, [this.pick(e, 'traveller.no_room')]); return; }
    g.addMoney(-price); g.inv.add('madera', 4); this.bought.set(`${e.tid}:wood`, g.days.realDay); e.carrying = null; this.load(e);
    Audio.pickup?.();
    await g.talk.say(T.id, [this.pick(e, 'traveller.wood.sold')]);
  }
  // The fisher's catch today: one or two kinds of the river in season, one to three of each
  catchOf(e) {
    const r = k => ihash(seedOf_(e.slot), k, 7351), season = this.game.days.season, kinds = RIVER.filter(id => FISH[id] && ITEMS[id] && (!FISH[id].seasons || FISH[id].seasons.includes(season)));
    const list = [];
    for (let i = 0; i < (r(1) < 0.5 ? 1 : 2) && kinds.length; i++) list.push([kinds.splice(Math.floor(r(2 + i) * kinds.length) % kinds.length, 1)[0], 1 + Math.floor(r(5 + i) * 3)]);
    const price = Math.max(5, Math.round(list.reduce((s, [id, n]) => s + buyPrice(id) * n, 0) * 0.8));
    return { list, price, text: fmt.list(list.map(([id, n]) => countOf(id, n))) };
  }
  async sellCatch(T, e) {
    const g = this.game, c = this.catchOf(e);
    if (g.money < c.price) { await g.talk.say(T.id, [this.pick(e, 'traveller.no_money')]); return; }
    if (c.list.some(([id, n]) => g.inv.room(id) < n)) { await g.talk.say(T.id, [this.pick(e, 'traveller.no_room')]); return; }
    g.addMoney(-c.price);
    for (const [id, n] of c.list) g.inv.add(id, n);
    this.bought.set(`${e.tid}:catch`, g.days.realDay);
    Audio.pickup?.();
    await g.talk.say(T.id, [this.pick(e, 'traveller.catch.sold')]);
  }
  // The pilgrim's news: a place you have not been to that is talked of on the roads (one a day: rumours.js fromRoad), else what is
  // told of where she goes
  async news(T, e) {
    const g = this.game, talk = g.talk, R = g.rumours;
    const [p] = await Promise.all([R?.fromRoad ? R.fromRoad() : null, talk.think(T)]);
    if (!T.live) return;
    if (p && p !== 'told') {
      const w = R.words(p, e);
      const said = talk.say(T.id, [this.pick(e, 'traveller.rumour', w)]);
      talk.point(T, p.x, p.y);
      await said;
      R.notedRoad(p, e.name);
      return;
    }
    const o = this.plan.where(e.slot, this.now, this.at), n = (o.toward ?? 1) ? e.slot.e.b : e.slot.e.a, P = g.places, poi = n.kind !== 'home' && P?.poiOf(n.id);
    if (poi) { const d = P.describe(poi); await talk.say(T.id, [this.pick(e, 'traveller.story', { title: d.title, story: d.story })]); return; }
    await talk.say(T.id, [this.pick(e, p === 'told' ? 'traveller.news.told' : 'traveller.news.none')]);
  }
}
// A road's line if it is known here already (the worker's, or one of those round the village, packed), else undefined: none
// is traced on the main thread for this
function readyLine(R, e) {
  const had = R.lines.get(e.id);
  if (had !== undefined) return had;
  return R.homeLeft?.[e.id] !== undefined ? R.line(e) : undefined;
}
