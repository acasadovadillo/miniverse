// The rod rest (Plan R1-4, docs/planes/realismo/PLAN-R1-pesca.md §3.9): two forked sticks planted on the bank. With a rod in the
// hand and a bait for the bottom (fishing.js R), E lays the rod on them and casts ahead of them: the player is free to sit, eat
// or fish with another rod, up to LEASH m away. On a bite a small bell rings, the tip nods and there are BITE_S to come and take
// it (E): the fish is running, and the click that strikes is the usual one. Further off, in another place, or after IDLE_S with
// no bite, the rod goes back to the backpack by itself. One rod planted each.
//
// The rod is out of the backpack while it lies there (so nothing can sell it, drop it or draw it on the back), and is saved as
// if it were in it: a game closed meanwhile, or an older one, has it in the backpack.
//
//   s   null, or the planted rod: { key, tile, x, y, yaw, rod, slot, tier, bait, bx, by, water, ctx, rate, phase: 'wait' | 'bite',
//       t (s to the bite), bt (s into it), nib, next, age, id, find }: what three/rodrest3d.js draws
//   net()   st.rr: [x, y, yaw, bx, by, 0 waiting / 1 biting, the rod's tier], for the others (an older game ignores it)
import { ITEMS, FISH } from './items.js';
import { parsePlaced } from './pieces.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { Profile } from './accounts.js';
import { nearX } from './world/planet.js';
import { HOTBAR } from './inventory.js';
import { t } from './i18n.js';
import { REACH, BITES } from './fishing.js';
import * as FW from './fishwater.js';

export const LEASH = 25, BITE_S = 6, IDLE_S = 600;   // m from it; s to come; s without a bite
const MISS_LOSS = 0.5, STEAL = 0.06, NIB = 0.3, NIB_GAP = [4, 10], RING = 0.85, MIN = 2;
const TURN = [0, 0.14, -0.14, 0.28, -0.28, 0.45, -0.45];   // (rad off the way it faces that the cast may go)
const r2 = v => Math.round(v * 100) / 100;

export class RodRest {
  constructor(game) { this.game = game; this.s = null; }
  reset() { this.s = null; }
  // (as if it were in the backpack: in its slot of the bar, if it is free, or in keep, which goes wherever it fits on loading)
  save(out) {
    const s = this.s, I = out.inventory;
    if (!s || !I) return;
    if (s.slot < HOTBAR && I.slots && !I.slots[s.slot]) I.slots[s.slot] = { ...s.rod };
    else (I.keep ||= []).push({ ...s.rod });
  }

  // Where the line of a rest goes: the furthest water ahead of it that the rod reaches, nothing solid in between
  spot(o, reach) {
    const w = this.game.world, yaw = o.yaw || 0;
    for (const a of TURN) {
      const dx = Math.sin(yaw + a), dy = Math.cos(yaw + a);
      for (let r = reach - 0.4; r >= MIN; r -= 0.4) {
        const x = o.x + dx * r, y = o.y + dy * r;
        if (!((w.waterDepth?.(x, y) || 0) > 0.3) || !FW.waterType(w, x, y)) continue;
        if (w.reaches && !w.reaches(o.x, o.y, x, y)) continue;
        return { x, y };
      }
    }
    return null;
  }
  isRod(held) { return ITEMS[held?.id]?.tool === 'cana'; }
  // Another player's rod on that rest
  taken(o) {
    for (const q of this.game.live?.peers?.values() || []) { const e = q.entity?.rr; if (e && Math.abs(nearX(e[0], o.x) - o.x) < 0.4 && Math.abs(e[1] - o.y) < 0.4) return q; }
    return null;
  }
  // E on a rest (game.js placedAction): pick, what picking it up is
  action(o, pick) {
    const g = this.game, s = this.s, key = String(o.tile), held = g.inv.held;
    if (s && s.key === key) return { text: t(s.phase === 'bite' ? 'rest.strike' : 'rest.take'), run: () => this.grab() };
    const who = this.taken(o);
    if (who) return { text: t('rest.busy', { name: String(who.name || '').slice(0, 24) }), run: () => Audio.error() };
    if (g.fishing.state) return null;   // (with a line out, E and X are not the rest's)
    if (!this.isRod(held)) return pick;
    if (s) return { text: t('rest.one'), run: () => Audio.error(), alt: pick };
    if (g.scene !== g.world) return pick;
    if (g.fishing.bait.rig !== 'bottom') return { text: t('rest.bottom'), run: () => { g.gather.float(t('rest.bottom'), '#ffb0a0'); Audio.error(); }, alt: pick };
    return { text: t('rest.plant'), run: () => this.plant(o), alt: pick };
  }
  plant(o) {
    const g = this.game, F = g.fishing, I = g.inv, i = I.selected;
    if (this.s || !this.isRod(I.held) || F.bait.rig !== 'bottom' || g.carry?.handsBusy?.()) return;
    const tier = F.tier, q = this.spot(o, REACH[tier]);
    if (!q) { g.gather.float(t('rest.no_water'), '#ffb0a0'); Audio.error(); return; }
    if (F.state?.phase === 'fight') return;
    F.state = null;
    g.gather.spend('cana');
    const rod = I.slots[i];
    if (!this.isRod(rod)) return;   // (it broke on this cast)
    const b = F.bait;
    F.prepare(b);
    I.slots[i] = null; I.changed();
    const ctx = FW.here(g, q.x, q.y, 1, 'bottom', b.id), rate = ctx ? FW.rates(ctx) : 0;
    this.s = { key: String(o.tile), tile: [...o.tile], x: o.x, y: o.y, yaw: o.yaw || 0, rod: { ...rod, n: 1 }, slot: i, tier, bait: b.id, bx: q.x, by: q.y, water: ctx?.water || '', ctx, rate, phase: 'wait', t: FW.waitFor(rate), bt: 0, nib: -9, next: this.gap(), age: 0, id: null, find: false, ring: 0, look: 0, fly: 0 };
    g.gather.swing = 0.25; g.gather.swingItem = rod.id;
    Audio.swish();
    if (!(rate > 0)) g.gather.float(t('fish.no_takers'), '#ffd0a0');
    g.onSave?.();
  }
  gap() { return NIB_GAP[0] + Math.random() * (NIB_GAP[1] - NIB_GAP[0]); }
  // E on it: the rod to the hand. Biting, the fish is running: a click strikes it (fishing.js strike)
  grab() {
    const g = this.game, F = g.fishing, s = this.s, p = g.player;
    if (!s) return;
    if (g.carry?.handsBusy?.()) { g.gather.float(t('rest.hands'), '#ffb0a0'); Audio.error(); return; }
    if (F.state) { if (F.state.phase === 'fight') F.snap(); else F.state = null; }
    this.s = null;
    const inHand = this.toHand(s);
    if (s.phase !== 'bite' || !inHand) { Audio.reel(0.5); g.gather.float(t(inHand ? 'rest.taken' : 'rest.back'), '#cfe8c0'); g.onSave?.(); return; }
    g.gather.cooldown = 0.05;
    F.state = { phase: 'bite', rig: 'bottom', bait: s.bait, t: 0, rate: s.rate, ctx: s.ctx, nib: -9, next: Infinity, bare: !s.bait, fly: 1, bx: s.bx, by: s.by, px: p.x, py: p.y, water: s.water,
      id: s.id, find: s.find, bite: 'run', bt: 0, pre: 0, taps: 0, win: BITES.run.win + (s.tier > 1 ? 0.15 : 0) + 0.02 * F.level, side: Math.random() < 0.5 ? -1 : 1, self: Infinity, sound: 1 };
    Audio.reel(0.9);
  }
  // The rod to its slot or another of the bar, in the hand. false: there was no room there (it went where it could)
  toHand(s) {
    const I = this.game.inv;
    const i = !I.slots[s.slot] && s.slot < HOTBAR ? s.slot : !I.slots[I.selected] ? I.selected : [...Array(HOTBAR).keys()].find(k => !I.slots[k]);
    if (i !== undefined) { I.slots[i] = { ...s.rod }; I.select?.(i, true); I.selected = i; I.changed(); return true; }
    // (a full bar: what was in the hand goes to the backpack, if it fits)
    const free = I.slots.findIndex((q, k) => !q && k >= HOTBAR && I.usable(k));
    if (free > 0) { I.slots[free] = I.slots[I.selected]; I.slots[I.selected] = { ...s.rod }; I.changed(); return true; }
    if (I.weight && I.held) {   // (the weight inventory has no slots to run out of)
      const { id, n, ...extra } = I.slots[I.selected];
      I.slots[I.selected] = { ...s.rod };
      const left = I.add(id, n, Object.keys(extra).length ? extra : undefined);
      if (left > 0) this.game.gather.throwOut(id, left, Object.keys(extra).length ? extra : undefined);
      I.changed();
      return true;
    }
    this.stow(s);
    return false;
  }
  // … to its slot or wherever it fits in the backpack; with no room, at the player's feet
  stow(s) {
    const g = this.game, I = g.inv, { id, n, ...extra } = s.rod;
    if (s.slot < HOTBAR && !I.slots[s.slot]) { I.slots[s.slot] = { ...s.rod }; I.changed(); return; }
    if (I.add(id, 1, Object.keys(extra).length ? extra : undefined)) g.gather?.throwOut?.(id, 1, Object.keys(extra).length ? extra : undefined);
  }
  // By itself, to the backpack
  back(say = true) {
    const s = this.s;
    if (!s || !this.game.inv) { this.s = null; return; }
    this.s = null;
    this.stow(s);
    if (say) { hud.toast(t('rest.back')); Audio.reel(0.4); }
    this.game.onSave?.();
  }

  // ---------- each step ----------
  update(dt) {
    const s = this.s, g = this.game, p = g.player;
    if (!s || !p) return;
    const w = g.world;
    if (g.scene !== w || g.gamemode === 'spectator' || Math.hypot(nearX(s.x, p.x) - p.x, s.y - p.y) > LEASH || ((s.look -= dt) <= 0 && !this.there(s))) return this.back();
    s.x = nearX(s.x, p.x); s.bx = nearX(s.bx, s.x);
    if (g.busy) return;   // (with a dialog or a scene on, the fish waits)
    if (s.fly < 1) {
      s.fly = Math.min(1, s.fly + dt / 0.5);
      if (s.fly === 1) { Audio.plop(); g.gather.chips(s.bx, s.by, 'water', 5); g.view3d?.fx?.rippleAt?.(s.bx, s.by, 0.5, 0.4); }
      return;
    }
    s.age += dt;
    if (s.phase === 'wait') {
      if (s.age > IDLE_S) return this.back();
      s.t -= dt; s.nib -= dt;
      if ((s.next -= dt) <= 0 && s.t > 1.5) {
        s.next = this.gap();
        if (s.rate > 0) { s.nib = NIB; if (s.bait && Math.random() < STEAL) this.bare(s, 'fish.stolen'); }
      }
      if (s.t <= 0) this.bite(s);
      return;
    }
    s.bt += dt;
    if ((s.ring -= dt) <= 0) { s.ring = RING; this.ringBell(s, p); }
    if (s.bt > BITE_S) this.gone(s);
  }
  // (its rest is still there, and the water: looked at twice a second)
  there(s) { s.look = 0.5; return this.stands(s) && !!FW.waterType(this.game.world, s.bx, s.by); }
  stands(s) { const v = this.game.world.ownAt('placed', ...s.tile); return !!v && parsePlaced(v)[0] === 'rod_rest'; }
  bite(s) {
    const id = this.game.fishing.pick(s.ctx);
    if (!id || !FISH[id]) { s.t = Infinity; return; }
    Object.assign(s, { phase: 'bite', bt: 0, id, find: Math.random() < 0.03, age: 0, ring: 0, nib: -9 });
  }
  ringBell(s, p) {
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    Audio.fishBell(Math.max(0.15, 1 - d / (LEASH * 1.1)));
    this.game.gather.chips(s.bx, s.by, 'water', 3);
    this.game.view3d?.fx?.rippleAt?.(s.bx, s.by, 0.6, 0.45);
  }
  // Nobody came: it has let go, half the times with the bait
  gone(s) {
    const g = this.game;
    hud.toast(t('rest.gone'), 'warn');
    s.phase = 'wait'; s.id = null; s.nib = -9; s.next = this.gap();
    if (s.bait && Math.random() < MISS_LOSS) this.bare(s, 'rest.bare');
    else s.t = FW.waitFor(s.rate);
    g.view3d?.fx?.rippleAt?.(s.bx, s.by, 0.8, 0.5);
  }
  // A bare hook from here on
  bare(s, text) {
    const g = this.game;
    g.fishing.spendBait(s.bait);
    s.bait = '';
    if (s.ctx) s.ctx.bait = '';
    s.rate = s.ctx ? FW.rates(s.ctx) : 0;
    s.t = FW.waitFor(s.rate);
    hud.toast(t(text), 'warn');
  }
  net() { const s = this.s; return s && !Profile.server ? [r2(s.x), r2(s.y), r2(s.yaw), r2(s.bx), r2(s.by), s.phase === 'bite' ? 1 : 0, s.tier] : undefined; }
}
// Another's (live.js), or null if it is not that
export const cleanRr = v => (Array.isArray(v) && v.length === 7 && v.every(Number.isFinite) && Math.hypot(v[3] - v[0], v[4] - v[1]) < 14 && (v[5] === 0 || v[5] === 1) && (v[6] === 1 || v[6] === 2) ? v : null);
