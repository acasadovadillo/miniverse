// Looking after a horse (Plan R4-2, docs/planes/realismo/PLAN-R4-caballo.md §1.4, §3.4, §3.5): what it eats and drinks, its
// shoes and being sore. Only long rides are felt: below LOW the gallop's breath is capped (never under MIN_CAP of the bar),
// and drinking or grazing on the way puts it right at once. It never hurts the horse, and nothing is lost while nobody plays.
//
//   game.horsecare = game.addSystem(new HorseCare(game)), right after saddlebags.
//   Fields of the Animal (all optional: without them, fed, watered, sound and, if it is shod, newly shod): fed and water
//     (0..1), shoe (what is left of its shoes, 0..1; shod stays the flag), sore (world clock second it is over), ownDay (the
//     last day somebody of its family was in the world: whoever runs the world writes it). While it is ridden its rider's game
//     writes fed, water, shoe and sore (every WRITE_S at most, and on getting off); the rest, whoever runs the world.
//   care.on(a)            whether these rules are on now (?cuidado=0 and ?vinculo=0 turn them off; only in survival)
//   care.cap(a)           the share of the breath's bar it can fill now (horse.js stamina)
//   care.sore(a), care.bare(a)   no gallop; unshod (horseride.js groundK)
//   care.update(dt)       the ridden horse: hunger, thirst and wear, drinking and grazing by itself when it stops
//   care.sourceNear(x, y) what it can drink from within DRINK_R: { x, y, trough? } or null
//   care.letDrink(a), care.shoe(a)      the horse's menu and Bruno
//   care.overnight(a, day), care.dawn(day), care.books()   the world's side (ranch.js)
//   care.marks(a)         a bit mask of what the HUD says: MARK.* (ui/needsbar.js)
//   care.looks(a, out)    { thin, shine } 0..1: how it is drawn (three/actors.js)
import { apagada } from './opciones.js';
import { Profile } from './accounts.js';
import { t } from './i18n.js';
import { itemNoun, ITEMS } from './items.js';
import { Audio } from './audio.js';
import { CHUNK } from './world/gen.js';
import { B } from './world/biomes.js';
import { distOf, nearX } from './world/planet.js';
import { WALK_NODES, FOUNTAIN } from './world/village.js';
import { TROUGH_MAX, troughModel } from './troughs.js';
import * as FW from './fishwater.js';
import { CAN_MAX } from './farm.js';
import { careOf, gainFor } from './horse.js';
import { GRAZE_NEED } from './ranch.js';
import { GROUND } from './horseride.js';

// ---------- the rules ----------
// What a second in the saddle takes, by gait (walk or standing, trot, canter, gallop: horseride.js GAITS): about an hour of
// mixed riding to be thirsty, twice that to be hungry. HOT and COLD: the desert or a summer midday; winter, snow or ice
export const WATER_S = [0.00012, 0.00025, 0.00025, 0.0006], FED_S = WATER_S.map(v => v / 2);
export const HOT = 1.5, COLD = 0.6;
export const LOW = 0.3, WELL = 0.7, MIN_CAP = 0.6, WELL_REGEN = 1.25;   // under LOW it is thirsty or hungry (the cap); both from WELL up, it gets its breath back faster
export const capOf = v => (v >= LOW ? 1 : MIN_CAP + Math.max(0, v) * (1 - MIN_CAP) / LOW);
const clamp01 = v => (v > 0 ? (v < 1 ? v : 1) : 0), num = (v, d) => (Number.isFinite(v) ? clamp01(v) : d);
export const fedOf = a => num(a?.fed, 1), waterOf = a => num(a?.water, 1);
export const shoeOf = a => (a?.shod ? num(a.shoe, 1) : 0);
export const capFor = a => Math.min(capOf(fedOf(a)), capOf(waterOf(a)));
// A treat feeds it too (horse.js TREATS)
export const TREAT_FED = { zanahoria: 0.1, manzana: 0.1, trigo: 0.25, heno: 0.4 };
// Shoes: what a km takes, on hard ground (paths, floors, rock) and elsewhere (about 9 hours of riding); loose under LOOSE
export const WEAR_HARD = 1 / 120, WEAR_SOFT = 1 / 400, LOOSE = 0.1, WORN = 0.35;
export const hardGround = G => G === GROUND.hard || G === GROUND.rocky;
export const SHOE_PRICE = 140, FORGE_R = 12, FORGE_AT = 6, RESHOE = 0.95;   // (Bruno, at his forge; a horse with shoes as new needs none)
// Sore: two bad moments (a stumble, a throw) within SORE_WINDOW leave it without a gallop for SORE_S of the world's clock
export const SORE_WINDOW = 300, SORE_S = 600;
export const soreAfter = (bads, now) => bads.filter(b => now - b <= SORE_WINDOW).length >= 2;
// Drinking and grazing: it starts by itself this long after stopping, and takes this long
export const DRINK_R = 2.5, DRINK_AFTER = 1.5, DRINK_S = 4, DRINK_UNDER = 0.9, GRAZE_AFTER = 3, GRAZE_S = 6, GRAZE_UNDER = 0.9, GRAZE_FED = 0.2;
const DRY = 0.15, STILL = 0.3, GULP_EVERY = 0.55, MUNCH_EVERY = 0.8;
// Overnight: fed if it grazed what it needs (or ate from a feeder or the silo), else as much as it grazed; watered in its
// stable, by a trough with water or by natural water
// (tied, only what it reaches: horselead.js)
export const NIGHT = { home: 12, trough: 16, water: 20, tied: 3, hungry: 0.2, tile: 0.16 };
export const nightFed = (fed, ate, tiles) => (ate ? 1 : Math.min(fed, NIGHT.hungry + NIGHT.tile * Math.max(0, tiles)));
// The trough: the drinks it holds. A full watering can fills it; a sip of a canteen or a jug, half a drink
export const TROUGH = { MAX: TROUGH_MAX, CAN: CAN_MAX / TROUGH_MAX, SIP: 2 };
// What the HUD marks by the horse's bar
export const MARK = { thirst: 1, hunger: 2, shoe: 4, sore: 8 };
export function marksOf(a, clock) {
  let m = 0;
  if (waterOf(a) < LOW) m |= MARK.thirst;
  if (fedOf(a) < LOW) m |= MARK.hunger;
  if (a?.shod && shoeOf(a) < LOOSE) m |= MARK.shoe;
  if (soreLeft(a, clock) > 0) m |= MARK.sore;
  return m;
}
export const soreLeft = (a, clock) => { const s = Number.isFinite(a?.sore) ? a.sore - clock : 0; return s > 0 && s <= SORE_S + 60 ? s : 0; };
// The words of the horse's card (lang horse.cond.word.*)
export const fedWord = v => (v < LOW ? 'hungry' : v < WELL ? 'peckish' : 'full');
export const waterWord = v => (v < LOW ? 'thirsty' : v < WELL ? 'dry' : 'watered');
export const shoeWord = a => (!a?.shod ? 'none' : shoeOf(a) < LOOSE ? 'loose' : shoeOf(a) < WORN ? 'worn' : shoeOf(a) > 0.9 ? 'new' : 'good');
export const cleanWord = d => (d > 0.6 ? 'muddy' : d > 0.2 ? 'dusty' : 'clean');
// How it is drawn: thin as it goes hungry; its coat shines when it is clean, fed and was brushed today or yesterday
export function looksOf(a, dirt, today, out = {}) {
  out.thin = clamp01((LOW - fedOf(a)) / LOW);
  out.shine = a?.brushDay >= today - 1 && fedOf(a) >= WELL ? clamp01(1 - dirt * 2.5) : 0;
  return out;
}

const WRITE_S = 10, STEP = 0.05, HEAT_T = 2, MOVED = 5;
const me = () => Profile.id || 'yo';
const r2 = v => Math.round(v * 100) / 100, r4 = v => Math.round(v * 1e4) / 1e4;
const FIELDS = ['fed', 'water', 'shoe'];
const RING = [[0, 0]];
for (const r of [1.2, 2.4]) for (let i = 0; i < 8; i++) RING.push([Math.cos(i * Math.PI / 4) * r, Math.sin(i * Math.PI / 4) * r]);

export class HorseCare {
  constructor(game) {
    this.game = game;
    this.off = apagada('cuidado') || apagada('vinculo');
    this.bads = []; this.badId = null;
    this.thirsts = 0;   // (every time a ridden horse gets thirsty: ui/smarthud.js shows the tip on the first one)
    this.forget();
  }
  get clock() { return this.game.world?.clock || 0; }
  on() { return !this.off && this.game.gamemode === 'survival'; }
  get drains() { return this.on() && this.game.difficulty !== 'peaceful'; }
  reset() {
    this.forget();
    this.bads = []; this.badId = null;
    const guest = this.game.live?.entering === 'guest';
    if (!guest) for (const a of this.game.ranch?.animals || []) if (a.sore !== undefined && !soreLeft(a, this.clock)) delete a.sore;
  }
  // Nothing in hand (the rider's side): a refused seat writes nothing (horse.js refused)
  forget() {
    this.a = null; this.v = null; this.was = null;
    this.writeT = 0; this.heatT = 0; this.heat = 1; this.lx = null; this.ly = null;
    this.stillT = 0; this.doing = null; this.lookT = 0;
  }

  // ---------- reading ----------
  // (the ridden horse's, as they are now; any other's, its fields)
  fed(a) { return a && a === this.a && this.v ? this.v.fed : fedOf(a); }
  water(a) { return a && a === this.a && this.v ? this.v.water : waterOf(a); }
  shoes(a) { return a && a === this.a && this.v ? (a.shod ? this.v.shoe : 0) : shoeOf(a); }
  cap(a) { return this.on() && a ? Math.min(capOf(this.fed(a)), capOf(this.water(a))) : 1; }
  regen(a) { return this.on() && a && this.fed(a) >= WELL && this.water(a) >= WELL ? WELL_REGEN : 1; }
  sore(a) { return this.on() && soreLeft(a, this.clock) > 0; }
  bare(a) { return this.on() && !!a && !a.shod; }
  marks(a) {
    if (!a || !this.on()) return 0;
    if (a !== this.a || !this.v) return marksOf(a, this.clock);
    const v = this.v;
    return (v.water < LOW ? MARK.thirst : 0) | (v.fed < LOW ? MARK.hunger : 0) | (a.shod && v.shoe < LOOSE ? MARK.shoe : 0) | (soreLeft(a, this.clock) > 0 ? MARK.sore : 0);
  }
  looks(a, dirt, out) {
    if (!a || this.off) { out.thin = 0; out.shine = 0; return out; }
    return looksOf(a, dirt, this.game.days?.dayIndex ?? 0, out);
  }

  // ---------- in the saddle ----------
  update(dt) {
    const g = this.game, p = g.player, a = p?.mount ? g.horse?.ridden || null : null;
    if (a !== this.a) this.switchTo(a, p);
    if (!a || !(dt > 0) || this.off) return;
    this.adopt(a);
    const R = p.ride, V = this.v, still = !R.on || (R.v < STILL && !R.going && !p.airborne);
    const d = this.lx === null ? 0 : distOf(p.x, p.y, this.lx, this.ly);
    this.lx = p.x; this.ly = p.y;
    if (this.on()) {
      if (this.drains) {
        if ((this.heatT -= dt) <= 0) { this.heatT = HEAT_T; this.heat = this.heatAt(p); }
        const i = R.on && R.v >= STILL ? R.gait : 0, fed = V.fed, water = V.water;
        V.water = Math.max(0, water - (WATER_S[i] || 0) * this.heat * dt);
        V.fed = Math.max(0, fed - (FED_S[i] || 0) * this.heat * dt);
        if (water >= LOW && V.water < LOW) { this.thirsts++; this.tell(a, 'horse.thirsty'); }
        if (fed >= LOW && V.fed < LOW) this.tell(a, 'horse.hungry');
      }
      if (a.shod && d > 0 && d < MOVED) this.wear(a, d / 1000 * (hardGround(R.ground) ? WEAR_HARD : WEAR_SOFT));
      this.stops(dt, a, p, still);
    } else if (this.doing) this.stopDoing();
    if ((this.writeT += dt) >= WRITE_S) { this.writeT = 0; this.write(a); }
  }
  // Another horse under you, or none: what this one's fields say (and what the last one's should)
  switchTo(a, p) {
    if (this.a && this.v) this.write(this.a, true);
    this.forget();
    this.a = a;
    if (!a) return;
    this.v = { fed: fedOf(a), water: waterOf(a), shoe: shoeOf(a) };
    this.was = { fed: a.fed, water: a.water, shoe: a.shoe, shod: !!a.shod };
    this.lx = p.x; this.ly = p.y;
  }
  // Somebody else wrote one of its fields meanwhile (Bruno, its menu, whoever runs the world): theirs is taken
  adopt(a) {
    const W = this.was, V = this.v;
    if (a.fed !== W.fed) { W.fed = a.fed; V.fed = fedOf(a); }
    if (a.water !== W.water) { W.water = a.water; V.water = waterOf(a); }
    if (a.shoe !== W.shoe || !!a.shod !== W.shod) { W.shoe = a.shoe; W.shod = !!a.shod; V.shoe = shoeOf(a); }
  }
  // Its fields, when they have moved by STEP (the shoes wear by thousandths: only when forced, or worth it)
  write(a, force = false) {
    if (this.off || !a || a !== this.a || !this.v) return;
    this.adopt(a);
    for (const f of FIELDS) {
      if (f === 'shoe' && !a.shod) continue;
      const now = f === 'fed' ? fedOf(a) : f === 'water' ? waterOf(a) : shoeOf(a), v = this.v[f];
      if (Math.abs(v - now) < (force ? (f === 'shoe' ? 1e-4 : 0.01) : f === 'shoe' ? 0.01 : STEP)) continue;
      a[f] = this.was[f] = f === 'shoe' ? r4(v) : r2(v);
    }
  }
  onDismount(a) { if (a && a === this.a) { this.write(a, true); this.stopDoing(); } }
  heatAt(p) {
    const g = this.game, T = g.days;
    if (g.scene !== g.world) return 1;
    const b = g.world.gen?.biomeAt?.(p.x, p.y), h = T?.localHour ?? 12, season = T?.localSeason;
    if (b === B.SNOW || b === B.ICE || season === 3) return COLD;
    return b === B.DESERT || (g.needs?.heat || 1) > 1 || (season === 1 && h >= 11 && h < 17 && !T?.info?.rain) ? HOT : 1;
  }
  wear(a, n) {
    const V = this.v, was = V.shoe;
    V.shoe = Math.max(0, was - n);
    if (was >= LOOSE && V.shoe < LOOSE) { this.tell(a, 'horse.shoe.loose', '#ffd890'); Audio.clink?.(); }
    if (V.shoe > 0) return;
    a.shod = false; delete a.shoe;
    this.was.shoe = undefined; this.was.shod = false;
    this.tell(a, 'horse.shoe.lost', '#ffb0a0');
    Audio.clink?.();
    this.game.onSave?.();
  }
  tell(a, key, color = '#fff3c0') { this.game.gather?.float?.(t(key, { name: a.name }), color); }
  // A stumble or a throw (horse.js): the second one within SORE_WINDOW leaves it sore
  bad(a) {
    if (!a || !this.on()) return;
    const now = this.game.time;
    if (a.id !== this.badId) { this.badId = a.id; this.bads = []; }   // (getting off and on again does not forget)
    this.bads = this.bads.filter(b => now - b <= SORE_WINDOW);
    this.bads.push(now);
    if (!soreAfter(this.bads, now)) return;
    this.bads = [];
    a.sore = Math.round(this.clock + SORE_S);
    this.tell(a, 'horse.sore', '#ffb0a0');
    this.game.onSave?.();
  }

  // ---------- stopping to drink or graze, in the saddle ----------
  stops(dt, a, p, still) {
    const g = this.game, H = g.horse, D = this.doing;
    if (!still || H.held() || g.scene !== g.world) { this.stillT = 0; this.lookT = 0; if (D) this.stopDoing(); return; }
    if (D) { this.doStep(dt, a, p, D); return; }
    this.stillT += dt;
    if (this.stillT < DRINK_AFTER || (this.lookT -= dt) > 0) return;
    this.lookT = 1;
    if (this.v.water < DRINK_UNDER) {
      const s = this.sourceNear(p.x, p.y);
      if (s && this.useTrough(s, false)) { this.begin('drink', a, p, DRINK_S, s); return; }
    }
    if (this.stillT >= GRAZE_AFTER && this.v.fed < GRAZE_UNDER) {
      const tile = this.grassAhead(p);
      if (tile) this.begin('graze', a, p, GRAZE_S, { x: tile[0] + 0.5, y: tile[1] + 0.5, tile });
    }
  }
  begin(kind, a, p, s, at) {
    this.doing = { kind, left: s, at, soundT: 0.6, from: this.v.water };
    this.game.horse.act(kind, s);
    this.tell(a, kind === 'drink' ? 'horse.drinks' : 'horse.grazing');
  }
  doStep(dt, a, p, D) {
    const g = this.game, V = this.v;
    D.left -= dt;
    if ((D.soundT -= dt) <= 0) {
      D.soundT = D.kind === 'drink' ? GULP_EVERY : MUNCH_EVERY;
      if (D.kind === 'drink') { Audio.gulp?.(); g.gather?.chips?.(p.x + p.face.x * 1.1, p.y + p.face.y * 1.1, 'water', 2); } else { Audio.munch?.(); }
    }
    if (D.kind === 'drink') V.water = Math.min(1, V.water + (1 - D.from) * dt / DRINK_S);
    if (D.left > 0) return;
    this.doing = null; this.stillT = DRINK_AFTER; this.lookT = 0.5;
    if (D.kind === 'drink') { V.water = 1; this.useTrough(D.at, true); this.gain(a, 'drink'); }
    else {
      // (the tile is eaten for everybody, as when it grazes by itself; unless somebody cut it meanwhile)
      const [tx, ty] = D.at.tile, r = g.ranch;
      if (!this.pasture(tx, ty)) return;
      r.ate(a, tx, ty);
      V.fed = Math.min(1, V.fed + GRAZE_FED);
      this.gain(a, 'graze');
    }
    this.write(a, true);
  }
  // Riding on: it lifts its head at once
  stopDoing() {
    const D = this.doing;
    this.doing = null;
    if (!D) return;
    this.game.horse.endAct(D.kind);
    if (this.a) this.write(this.a, true);
  }
  // The day's first drink and the day's first grass on the way are care too (bond)
  gain(a, kind) {
    const g = this.game, today = g.ranch.today;
    if (g.horse.off || !g.horse.ours(a)) return;
    const n = gainFor(a, kind, today);
    if (!n) return;
    const c = careOf(a, today);
    c[kind === 'drink' ? 'w' : 'g']++;
    a.care = c;
    a.bx = (+a.bx || 0) + n;
    g.gather?.chips?.(a === g.horse.ridden ? g.player.x : a.x, a === g.horse.ridden ? g.player.y : a.y, 'heart', 4);
  }
  pasture(tx, ty) { const g = this.game; return !!g.world.pasture?.(tx, ty, g.ranch.today, false); }
  // A grass tile its mouth reaches without a step: ahead, a little to each side, or under its neck
  grassAhead(p) {
    const fx = p.face.x, fy = p.face.y;
    for (const [f, s] of [[0.95, 0], [0.8, 0.6], [0.8, -0.6], [1.5, 0], [0.3, 0]]) {
      const tx = Math.floor(p.x + fx * f - fy * s), ty = Math.floor(p.y + fy * f + fx * s);
      if (this.pasture(tx, ty)) return [tx, ty];
    }
    return null;
  }

  // ---------- water ----------
  // What a horse at (x, y) can drink from: a trough with water, a well, the fountain, or a river, a lake or a pond (the sea,
  // no). reach: how far. Asked only when it has stopped, or its menu is open
  sourceNear(x, y, reach = DRINK_R) {
    const g = this.game, w = g.world;
    if (!w || g.scene !== w) return null;
    for (const o of w.placedNear?.(x, y, reach) || []) {
      if (o.placed === 'trough') { const n = this.troughAt(o.tile); if (n >= 1) return { x: o.x, y: o.y, trough: o.tile }; }
      else if (o.placed === 'pozo' || o.placed === 'big_well') return { x: o.x, y: o.y };
    }
    if (w.wellAt?.(x, y)) return { x, y };
    if (g.board?.projects?.fuente && distOf(x, y, FOUNTAIN.x, FOUNTAIN.y) < reach + 1) return { x: FOUNTAIN.x, y: FOUNTAIN.y };
    for (const [dx, dy] of RING) if (this.freshAt(x + dx, y + dy)) return { x: x + dx, y: y + dy };
    return null;
  }
  freshAt(x, y) {
    const w = this.game.world;
    if (!(w.waterDepth(x, y) >= DRY)) return false;
    const k = FW.waterType(w, x, y);
    return !!k && k !== 'mar' && k !== 'hielo';
  }
  deltaOf([tx, ty], make = false) { return this.game.world.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK), make); }
  troughAt(tile) { return Math.max(0, +this.deltaOf(tile)?.trough?.[`${tile[0]},${tile[1]}`] || 0); }
  // Drinking takes one drink from a trough. take: now; else only whether there is one
  useTrough(s, take) {
    if (!s?.trough) return true;
    const n = this.troughAt(s.trough);
    if (n < 1) return false;
    if (take) this.setTrough(s.trough, n - 1);
    return true;
  }
  setTrough(tile, n) {
    const d = this.deltaOf(tile, true), k = `${tile[0]},${tile[1]}`, was = +d.trough?.[k] || 0, w = this.game.world;
    n = Math.max(0, Math.min(TROUGH.MAX, r2(n)));
    if (n === was) return;
    if (n > 0) (d.trough ||= {})[k] = n; else if (d.trough) delete d.trough[k];
    if (troughModel(n) !== troughModel(was)) w.touch(Math.floor(tile[0] / CHUNK), Math.floor(tile[1] / CHUNK)); else w.chestTouched(tile[0], tile[1]);
  }
  // E on a trough: fill it with the watering can (in the hand or the bag) or a canteen or jug in the hand
  troughAction(o) {
    const g = this.game, n = this.troughAt(o.tile), max = TROUGH.MAX, held = g.inv.held, hd = held && ITEMS[held.id];
    const says = { n: Math.floor(n), max }, splash = () => { g.gather.chips(o.x, o.y, 'water', 10); Audio.noiseHit(700, 0.35, 0.18); };
    if (n >= max - 0.5) return { text: t('trough.full', says), run: () => Audio.blip() };
    if (hd?.canteen && held.sips >= TROUGH.SIP) return { text: t('trough.fill', { item: itemNoun(held.id), ...says }), run: () => {
      const it = g.inv.held, room = Math.ceil(max - this.troughAt(o.tile)), some = it === held ? Math.min(room, Math.floor((it.sips || 0) / TROUGH.SIP)) : 0;
      if (some < 1) return;
      it.sips -= some * TROUGH.SIP;
      g.inv.changed?.();
      this.setTrough(o.tile, this.troughAt(o.tile) + some); splash();
    } };
    if (held?.id === 'regadera' || g.inv.count('regadera') > 0) {
      if (!(g.farm.can >= TROUGH.CAN)) return { text: t('trough.can_empty', says), run: () => { g.gather.float(t('farm.can.empty'), '#ffb0a0'); Audio.error(); } };
      return { text: t('trough.fill', { item: itemNoun('regadera'), ...says }), run: () => {
        const room = Math.ceil(max - this.troughAt(o.tile)), some = Math.min(room, Math.floor(g.farm.can / TROUGH.CAN));
        if (some < 1) return;
        g.farm.can -= some * TROUGH.CAN;
        this.setTrough(o.tile, this.troughAt(o.tile) + some); splash();
      } };
    }
    return { text: t('trough.empty_hand', says), run: () => Audio.error() };
  }
  // A treat feeds it too (horse.js care)
  treat(a, item) {
    if (this.off || !(TREAT_FED[item] > 0)) return;
    const v = r2(Math.min(1, this.fed(a) + TREAT_FED[item]));
    a.fed = v;
    if (a === this.a && this.v) { this.v.fed = v; this.was.fed = v; }
  }
  // The menu's "Let it drink": on foot, by the water
  canDrink(a) { return !this.off && !!a && this.water(a) < 0.95 ? this.sourceNear(a.x, a.y) : null; }
  letDrink(a) {
    const g = this.game, s = this.canDrink(a);
    if (!s || a.rider) return false;
    if (!this.useTrough(s, true)) return false;
    a.water = 1;
    // (it turns to the water and lowers its head for a while: whoever runs the world keeps it still meanwhile)
    g.horse.halt(a, DRINK_S + 1);
    a.faceTo?.(nearX(s.x, a.x) - a.x, s.y - a.y);
    a.act = { kind: 'drink', t: g.time };
    this.tell(a, 'horse.drinks');
    for (let i = 0; i < 4; i++) setTimeout(() => { if (g.mode === 'play' && g.scene === g.world) Audio.gulp?.(); }, 700 + i * 650);
    this.gain(a, 'drink');
    g.skills?.gain('granja', 1);
    g.onSave?.();
    return true;
  }

  // ---------- shoes ----------
  // New shoes (the herraduras item, or Bruno: trim, the hooves too, which is care once a day)
  shoe(a, trim = false) {
    if (!a) return false;
    const g = this.game;
    a.shod = true;
    if (this.off) return true;
    a.shoe = 1;
    if (a === this.a && this.v) { this.v.shoe = 1; this.was.shoe = 1; this.was.shod = true; }
    if (trim && !g.horse.off) {
      const today = g.ranch.today, n = gainFor(a, 'trim', today);
      if (n) { const c = careOf(a, today); c.h++; a.care = c; a.bx = (+a.bx || 0) + n; }
    }
    g.onSave?.();
    return true;
  }
  wantsShoes(a) { return !!a && (this.off ? !a.shod : !a.shod || this.shoes(a) < RESHOE); }
  // Where a horse is now (the one you ride is where you are)
  at(a) { const p = this.game.player; return a === this.game.horse?.ridden && p?.mount ? p : a; }
  // The horse Bruno would shoe now: yours or your partner's, grown, within FORGE_R of his forge, with him there; the most worn first
  toShoe(npc) {
    const g = this.game, F = WALK_NODES.forge;
    if (this.off || !npc || !F || Math.hypot(npc.x - F[0], npc.y - F[1]) > FORGE_AT) return null;
    let best = null;
    for (const a of g.ranch?.animals || []) {
      if (!a.def?.ride || g.ranch.young(a) || !g.horse.ours(a) || (a.rider && a !== g.horse.ridden) || !this.wantsShoes(a)) continue;
      const q = this.at(a);
      if (distOf(q.x, q.y, F[0], F[1]) > FORGE_R) continue;
      if (!best || this.shoes(a) < this.shoes(best)) best = a;
    }
    return best;
  }
  shoePrice() { return Math.max(1, Math.round(SHOE_PRICE * (this.game.rep?.buyFactor() ?? 1))); }
  // Bruno shoes it: the coins, a few blows on the anvil, the new shoes. Returns whether he did
  farrier(npc) {
    const g = this.game, a = this.toShoe(npc), price = this.shoePrice();
    if (!a) return false;
    if (g.money < price) { g.gather.float(t('horse.shoe.poor', { n: price }), '#ffb0a0'); Audio.error(); return false; }
    g.money -= price;
    this.shoe(a, true);
    g.horse.halt(a, 4);
    for (let i = 0; i < 4; i++) setTimeout(() => { if (g.mode === 'play') Audio.clink?.(); }, 250 + i * 420);
    const q = this.at(a);
    g.gather.chips(q.x, q.y, 'heart', 5);
    this.tell(a, 'horse.shod_done', '#a8f07a');
    g.onSave?.();
    return true;
  }

  // ---------- the world's side (whoever runs it) ----------
  // Once a second (ranch.horseBooks): which horses have somebody of their family in the world today. Back after days away,
  // the neglect of those days is forgotten: nobody loses a heart for what happened while they did not play
  books() {
    const g = this.game, r = g.ranch, today = r.today, H = g.horse;
    if (g.days && g.days.day !== g.days.realDay) return;   // (the days missed, first)
    for (const a of r.animals) {
      if (!a.def?.ride || a.ownDay === today || !this.familyHere(a, H)) continue;
      if (!(today - a.ownDay <= 1) && Number.isFinite(a.petDay)) a.petDay = Math.max(a.petDay, today - 1);
      a.ownDay = today;
    }
  }
  familyHere(a, H) {
    const g = this.game;
    if (!Profile.server && g.player && H.ours(a, me())) return true;
    for (const peer of g.live?.peers?.values?.() || []) if (peer.id && peer.entity && H.ours(a, peer.id)) return true;
    return false;
  }
  // May a horse lose a heart this morning? Only if somebody of its family played yesterday (a game from before: no)
  kept(a, day) { return !(a.def?.ride) || a.ownDay >= day - 1; }
  // Before the animals' morning: the rain of yesterday or of the night fills the troughs
  dawn(day) {
    const g = this.game, T = g.days;
    if (![day - 1, day].some(d => { const k = T.weatherFor?.(d); return k === 'lluvia' || k === 'tormenta'; })) return;
    for (const h of g.ranch.placed('trough')) this.setTrough(h.tile, TROUGH.MAX);
  }
  // Its night: what it ate, drank and rested. Ridden across the dawn, its rider's game has it
  overnight(a, day) {
    const g = this.game, r = g.ranch, tiles = r.grazedOn(a, day - 1), need = r.needOf(a), grazed = tiles >= need;
    if (grazed) a.fedDay = day;
    if (this.off || a.rider) return;
    const home = a.home2, tied = !!a.tie && !g.horselead?.off, inStable = !!home && !a.stay && distOf(a.x, a.y, home[0], home[1]) < (tied ? NIGHT.tied : NIGHT.home);
    // (a day nobody played: it fends for itself, and nothing of the farm is eaten)
    const played = g.farm?.playedOn(day - 1) !== false, fed = fedOf(a);
    const ate = grazed || !played || (inStable && (r.eatFromFeeder(a) || r.eatHay()));
    if (ate) a.fedDay = day;
    const now = nightFed(fed, ate, tiles * GRAZE_NEED / need);
    if (now !== fed) a.fed = r2(now);
    if (waterOf(a) < 1 && (inStable || !played || this.troughNight(a) || this.waterAround(a))) a.water = 1;
    if (a.sore !== undefined && (inStable || !soreLeft(a, this.clock))) delete a.sore;
  }
  troughNight(a) {
    for (const h of this.game.ranch.placed('trough')) {
      const x = nearX(h.tile[0] + 0.5, a.x), y = h.tile[1] + 0.5;
      if (Math.hypot(x - a.x, y - a.y) <= (a.tie && !this.game.horselead?.off ? NIGHT.tied : NIGHT.trough) && this.useTrough({ trough: h.tile }, true)) return true;
    }
    return false;
  }
  waterAround(a) {
    for (const r of a.tie && !this.game.horselead?.off ? [0, 1.5, NIGHT.tied - 0.5] : [0, 4, 8, 12, 16, 20]) for (let i = 0, n = r ? 12 : 1; i < n; i++) if (this.freshAt(a.x + Math.cos(i * Math.PI / 6) * r, a.y + Math.sin(i * Math.PI / 6) * r)) return true;
    return false;
  }
  // A tile grazed by itself, whoever runs the world (ranch.ate): a little fuller
  grazedTile(a) { if (!this.off && a.def?.ride && a !== this.a && fedOf(a) < 1) a.fed = r2(Math.min(1, fedOf(a) + GRAZE_FED)); }
}
