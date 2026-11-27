// The catch, day after day and at the kitchen (Plan R1-3; what a stack says of itself: catch.js). Fish is fresh for two real
// days, worth less for two more, and then it is rotten fish (the best bait for catfish, eel and crab, and it makes compost).
//   - Your backpack goes off in your game: on loading it and every OWN_EVERY s. What has no day (from an older game) starts
//     today. Changing to another world's clock (playing together, or coming back) is not time gone by: the days go along
//     (frame), so nothing is ever found rotten on the way in.
//   - Chests, the parked wheelbarrow and the saddlebags go off in the game that decides the world (as the carcasses:
//     carry.js rotsWorld), every WORLD_EVERY s, and only those nobody is near: a guest with that chest's window open would
//     otherwise write over it. What comes out of one already gone off turns in the backpack.
//   - Cleaning and salting at the kitchen (E on it: ui/crafting.js lists what there is, yours and, with the weight inventory,
//     of the chests that also pay for crafting). Salted fish never goes off.
import { ITEMS, itemNoun } from './items.js';
import { settle, perishes, sameStack, blend, unitG, canClean, canSalt, cleaned, salted, saltFor, hooks } from './catch.js';
import { stackPrice } from './economy.js';
import { BARROW, vehicleOf } from './carry-items.js';
import { Profile } from './accounts.js';
import { distOf } from './world/planet.js';
import { Audio } from './audio.js';
import { t } from './i18n.js';

const OWN_EVERY = 60, WORLD_EVERY = 30, NEAR = 8, SETTLE = 10;   // s; s; m; s after changing worlds in which the clock's jumps are not time gone by
const DAY_MS = 864e5, HOUR_MS = 36e5;

export class Freshness {
  constructor(game) {
    this.game = game;
    hooks.today = () => this.game.days?.realDay ?? 0;
    this.reset(null);
  }
  reset(save) {
    this.ownT = 0; this.worldT = 5;
    this.frame = Number.isFinite(save?.fishShift) ? save.fishShift : null;   // (hours the clock was shifted by when the days were written)
    this.key = null; this.settling = 0;
  }
  save(out) { if (this.frame !== null) out.fishShift = this.frame; }
  get shift() { const T = this.game.days; return T.remote?.sh ?? T.shift ?? 0; }

  update(dt) {
    const g = this.game;
    if (!g.inv || !g.days) return;
    this.follow(dt);
    if ((this.ownT -= dt) <= 0 && !(this.settling > 0)) { this.ownT = OWN_EVERY; this.own(); }
    if ((this.worldT -= dt) <= 0) { this.worldT = WORLD_EVERY; this.sweep(); }
  }
  // Another world's clock: each day carried moves by as many as the clock jumped, so every fish keeps its age
  follow(dt) {
    const now = this.shift, L = this.game.live, key = (L?.joined ? 1 : 0) + (L?.role === 'host' ? 2 : L?.role === 'guest' ? 4 : 0) + (this.game.days.remote?.sh !== undefined ? 8 : 0);
    if (key !== this.key) { this.key = key; this.settling = SETTLE; }
    if (this.settling > 0) {   // (who runs the world and its clock do not arrive at once)
      this.settling -= dt;
      if (this.frame !== null && this.frame !== now) this.rebase(this.frame, now);
    }
    this.frame = now;   // (the same world's clock put forward or back: that is time gone by, as for the carcasses)
  }
  rebase(from, to) {
    const T = this.game.days, was = Math.floor((T.now + (from - to) * HOUR_MS) / DAY_MS), k = T.realDay - was;
    if (k) for (const s of this.game.inv.slots) if (s && perishes(s.id) && Number.isFinite(s.day)) s.day += k;
  }
  // What you carry
  own() {
    const g = this.game, I = g.inv, S = I.slots;
    if (Profile.server) return 0;
    let n = 0, any = false;
    for (let i = 0; i < S.length; i++) {
      const s = S[i], r = s ? settle(s, !I.infinite) : 0;
      if (!r) continue;
      any = true;
      if (r === 2) { n += s.n; this.gather(S, i); }
    }
    if (any) I.changed();
    if (n && g.mode === 'play') g.gather?.float(t('fish.rotted', { n }), '#c8b060');
    return n;
  }
  // (what has just gone off, with the other rotten fish there is)
  gather(list, i) {
    const s = list[i], max = ITEMS.rotten_fish.stack;
    for (let j = 0; j < list.length && s.n > 0; j++) {
      const o = list[j];
      if (j === i || !o || o.n >= max || !sameStack(o, s)) continue;
      const k = Math.min(s.n, max - o.n);
      blend(o, s, k); s.n -= k;
    }
    if (s.n <= 0) list[i] = null;
  }
  // A chest, the bags. Returns whether something changed
  list(c) {
    let out = false;
    if (!Array.isArray(c)) return false;
    for (let i = 0; i < c.length; i++) {
      const s = c[i];
      if (!s || !perishes(s.id)) continue;
      const r = settle(s);
      if (r) out = true;
      if (r === 2) this.gather(c, i);
    }
    return out;
  }
  // The world's (whoever decides it), and the cave you are in, which is only yours
  sweep() {
    const g = this.game, w = g.world, sc = g.scene;
    if (sc?.state && sc !== w && sc.state.chest) { let any = false; for (const c of Object.values(sc.state.chest)) if (this.list(c)) any = true; if (any) sc.touched?.(); }
    if (!w?.deltas || !g.carry?.rotsWorld()) return;
    const L = g.live, near = [];
    if (L?.joined) for (const p of L.peers.values()) if (p.playing && p.entity) near.push(p.entity);
    const free = (x, y) => near.every(e => distOf(e.x, e.y, x, y) > NEAR);
    for (const [key, d] of w.deltas) {
      if (!d?.chest || key.startsWith('u:')) continue;
      for (const [tp, c] of Object.entries(d.chest)) {
        if (!Array.isArray(c) || !c.some(s => s && perishes(s.id))) continue;
        const [tx, ty] = tp.split(',').map(Number);
        if (!free(tx + 0.5, ty + 0.5) || !this.list(c)) continue;
        w.chestTouched(tx, ty);
        if (vehicleOf(d.placed?.[tp])) g.barrow?.stacksChanged([tx, ty]);
      }
    }
    for (const a of g.ranch?.animals || []) if (Array.isArray(a.bags) && g.saddlebags?.canTouch(a) && free(a.x, a.y) && this.list(a.bags)) g.saddlebags.changed(a);
  }

  // ---------- the kitchen ----------
  // Each stack that can be cleaned or salted: [{ s, i } of the backpack, or { s, c, j, o } of a chest nearby (carry.js chests)],
  // trophies last
  stacks() {
    const g = this.game, out = [];
    g.inv.slots.forEach((s, i) => { if (canClean(s) || canSalt(s)) out.push({ s, i }); });
    if (g.carry?.on && !g.admin && !g.inv.infinite) for (const { c, o } of g.carry.chests()) c.forEach((s, j) => { if (s && ITEMS[s.id] && (canClean(s) || canSalt(s))) out.push({ s, c, j, o }); });
    return out.sort((a, b) => (a.s.tr || 0) - (b.s.tr || 0));
  }
  // 'clean' or 'salt' one of it. Returns why not, or null when done
  work(kind, e) {
    const g = this.game, I = g.inv, at = e.c ? e.c[e.j] : I.slots[e.i];
    if (!g.craft.stationsNear().cocina) return t('kitchen.far');
    if (!at || at !== e.s || !(kind === 'clean' ? canClean : canSalt)(at)) return t('kitchen.gone');
    const price = stackPrice(at), out = kind === 'clean' ? cleaned(at, price) : salted(at, price), need = kind === 'salt' ? saltFor(unitG(at)) : 0;
    if (need && !I.infinite && g.craft.have('salt') < need) return t('kitchen.need_salt', { n: need, item: itemNoun('salt') });
    if (need) { if (g.carry) { if (!g.carry.spend([['salt', need]])) return t('kitchen.need_salt', { n: need, item: itemNoun('salt') }); } else I.remove('salt', need); }
    if (e.c) {
      if (e.o.horse && !g.saddlebags?.canTouch(e.o.horse)) return t('kitchen.gone');
      at.n--;
      if (at.n <= 0) e.c[e.j] = null;
      if (e.o.horse) g.saddlebags.changed(e.o.horse);
      else { g.scene.chestTouched(...e.o.tile); if (vehicleOf(e.o.placed)) g.barrow?.stacksChanged(e.o.tile); }
      g.carry.near = null;
    } else I.take(e.i, 1);
    const got = [];
    for (const [id, n, extra] of out) {
      const left = I.add(id, n, extra);
      if (left) g.gather.throwOut(id, left, extra);
      got.push(`+${n} ${ITEMS[id].name}`);
    }
    g.skills?.gain('cocina', 3); g.stats?.add('cocinados', 1); g.xp?.add(0.35);
    Audio.craft();
    g.craft.say(got.join(' · '), '#fff3c0');
    return null;
  }
}
