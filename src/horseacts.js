// What a horse nobody rides plays for everybody to see (Plan F phase 2, docs/planes/gta/PLAN-F-caballo.md §1.5, §1.6,
// §3.3 and §5.2): the Bow (a bonded horse, level 4: E on it › Bow) and the shy of a spook (a monster within 5 m, a boar
// within 4 m, a wolf within 15 m (Plan R3-5) or a thunderbolt: it starts, throws its head up and sidesteps, and below level 4 it trots off to 6-10 m from
// what scared it). Whoever runs the world decides and plays them (alone, the host or the world server) and sends them in
// the 'herd' message; a guest only asks for the Bow, through the horse's `trick` field.
//
//   game.horseacts = game.addSystem(new HorseActs(game)), after horselead.
//   horseacts.bow(a)        the menu's Bow: played here (whoever runs the world) or asked of the host (a guest)
//   horseacts.asked(a, v)   (whoever runs the world) a guest's `trick` came in (ranch.js netField)
//   horseacts.play(a, kind) (whoever runs the world) plays one now: a.act for this game's art, a.actNet for the others
//   horseacts.canBow(a)     what the menu asks before it offers the Bow
//   herdTail(a, now)        the end of a's 'herd' entry: [dogK] as before, or [dogK || 0, act] while an act plays
//   heardAct(a, v)          (a guest) the act in a 'herd' entry: a.act, once per new value
//   packAct(n, kind), unpackAct(v) → [n, kind]   pure: the herd's small int (its count, and which one)
//
// Fields: `trick` = [kind, n] (kept and shared like the other horse fields: a guest's ask, its n one more than the last;
// only owner or couple may write it, saddlebags.js GUARDED). Transient, never saved: a.actN (how many it has played),
// a.actNet (the last one, packed), a.actEnd (game time it ends, for the herd), a.actHold (game time until which it stands
// still: ranch.js moveHorse), a.shyAt (its last spook), a.mobNear / a.boarNear (the rising edges of what is near).
// ?vinculo=0: none of it (no Bow in the menu, no unridden spooks).
import { apagada } from './opciones.js';
import { t } from './i18n.js';
import { levelOf, SPOOK } from './horse.js';
import { statsOf } from './horsebreeds.js';
import { distOf, dxOf, wrapX } from './world/planet.js';

export const ACT_KINDS = ['', 'bow', 'shy'];   // (the codes in the herd: append only)
export const BOW_S = 2.5, SHY_S = 0.6;          // s each one plays (three/animals.js HORSE_ACTS has the same)
export const SHY_M = [6, 10];                   // m from what scared it, where it stops (below level 4)
const TICK = 0.25, SHY_EVERY = 20, MOB_R = 5, BOAR_R = 4, WOLF_R = 15, THUNDER_K = 0.25, BOW_LEVEL = 4, SEND_PAD = 0.4;
const NONE = Object.freeze([]);

export const packAct = (n, kind) => ((Math.max(0, n | 0) % 1e6) * 4) + Math.max(0, ACT_KINDS.indexOf(kind));
export const unpackAct = v => (Number.isInteger(v) && v > 0 ? [v >> 2, ACT_KINDS[v & 3] || ''] : [0, '']);
// (which way it shies: by its count, so every game draws it to the same side)
export const sideOf = n => (n & 1 ? 1 : -1);
export const herdTail = (a, now) => (a.actNet && now < a.actEnd ? [a.dogK || 0, a.actNet] : a.dogK ? [a.dogK] : NONE);
export function heardAct(a, v) {
  if (v === a.actNet) return;
  a.actNet = v;
  const [n, kind] = unpackAct(v);
  if (kind) a.act = { kind, side: sideOf(n) };   // (no start time: three/actors.js plays it from when it is first seen)
}

export class HorseActs {
  constructor(game) {
    this.game = game;
    this.off = apagada('vinculo');
    this.t = 0;
  }
  reset() { this.t = 0; this.bolts = undefined; }
  get decides() { return !this.game.live?.guest; }
  // (mine: asked here, so it must be yours or your partner's; a guest's ask was checked by the host's guard)
  canBow(a, mine = true) {
    const g = this.game;
    return !this.off && !!a?.def?.ride && levelOf(a.love) >= BOW_LEVEL && !a.rider && !a.lead && !a.cart && !a.calling && !a.bolt && !a.inside && !g.ranch?.young?.(a)
      && !(a.actHold > g.time) && (!mine || !g.horse?.ours || g.horse.ours(a));
  }
  // The menu's Bow (yours or your partner's)
  bow(a) {
    if (!this.canBow(a)) return false;
    this.game.gather?.float?.(t('horse.bows', { name: a.name }), '#fff3c0');
    if (this.decides) return this.play(a, 'bow');
    a.trick = ['bow', ((Array.isArray(a.trick) ? a.trick[1] : 0) | 0) + 1];   // (livesync sends it; the host plays it for everybody)
    this.game.onSave?.();
    return true;
  }
  // (whoever runs the world) A guest asked: one more than the last it asked
  asked(a, v) {
    if (!this.decides || !Array.isArray(v) || v[0] !== 'bow') return;
    const was = Array.isArray(a.trick) ? a.trick[1] | 0 : 0;
    if ((v[1] | 0) > was && this.canBow(a, false)) this.play(a, 'bow');
  }
  play(a, kind) {
    const g = this.game, now = g.time;
    a.actN = ((a.actN | 0) + 1) % 1e6;
    a.actNet = packAct(a.actN, kind);
    a.act = { kind, t: now, side: sideOf(a.actN) };
    const dur = kind === 'bow' ? BOW_S : SHY_S;
    a.actEnd = now + dur + SEND_PAD;
    if (kind === 'bow') { a.actHold = now + BOW_S; g.ranch?.stopGrazing?.(a); a.vx = a.vy = 0; a.tx = a.x; a.ty = a.y; }
    else a.actHold = now + SHY_S * 0.5;   // (it starts on the spot, then trots off)
    return true;
  }

  // ---------- the spooks of a horse nobody rides (whoever runs the world) ----------
  update(dt) {
    if (this.off || !this.decides || (this.t += dt) < TICK) return;
    this.t = 0;
    const g = this.game, R = g.ranch, w = g.world;
    if (!R?.animals?.length || !w) return;
    const ok = g.gamemode !== 'creative' && g.gamemode !== 'spectator' && g.difficulty !== 'peaceful';
    const bolts = g.days?.bolts || 0, bolt = bolts > (this.bolts ?? bolts);
    this.bolts = bolts;
    for (const a of R.animals) {
      if (!a.def?.ride || a.rider || a.inside || a.drove) continue;
      const mob = ok ? this.mobAt(a) : null, boar = ok ? this.boarAt(a) : null;
      const src = (mob && !a.mobNear) ? mob : (boar && !a.boarNear) ? boar : (ok && bolt) ? 'thunder' : null;
      a.mobNear = !!mob; a.boarNear = !!boar;
      if (!src || g.time - (a.shyAt ?? -Infinity) < SHY_EVERY || a.actHold > g.time) continue;
      const k = SPOOK[levelOf(a.love) - 1] * statsOf(a).courage * (src === 'thunder' ? THUNDER_K : 1);
      if (Math.random() < k) this.shy(a, src === 'thunder' ? null : src);
    }
  }
  // It shies: the start for everybody, and (below level 4, loose) a trot to SHY_M from what scared it (src: { x, y } or
  // null for a thunderbolt: any way)
  shy(a, src) {
    const g = this.game;
    a.shyAt = g.time;
    this.play(a, 'shy');
    if (levelOf(a.love) >= BOW_LEVEL || a.tie || a.lead || a.cart || a.calling) return true;   // (bonded, or held: only the start)
    const ang = src ? Math.atan2(a.y - src.y, dxOf(a.x, src.x)) : Math.random() * Math.PI * 2;
    const from = src ? distOf(a.x, a.y, src.x, src.y) : 0, D = SHY_M[0] + Math.random() * (SHY_M[1] - SHY_M[0]);
    const r = Math.max(D - from, 3), x = a.x + Math.cos(ang) * r, y = a.y + Math.sin(ang) * r, W = g.world;
    if (W.blocked?.(x, y) || a.deep?.(W, x, y)) return true;   // (no room that way: it stays where it started)
    a.bolt = [wrapX(x), y];
    g.ranch?.stopGrazing?.(a);
    return true;
  }
  mobAt(a) {
    let best = null, bd = MOB_R;
    for (const m of this.game.mobs?.list || []) { const d = distOf(m.x, m.y, a.x, a.y); if (d < bd) { bd = d; best = m; } }
    return best;
  }
  boarAt(a) {
    for (const w of this.game.wildlife?.list || []) if (((w.type === 'jabali' && distOf(w.x, w.y, a.x, a.y) < BOAR_R) || (w.type === 'lobo' && distOf(w.x, w.y, a.x, a.y) < WOLF_R)) && !w.dead) return w;
    return null;
  }
}
