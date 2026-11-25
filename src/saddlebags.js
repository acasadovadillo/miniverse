// The horse's saddlebags: 12 stacks shared with the couple, one writer at a time (the bagsBy lock the host confirms),
// their weight and fill, and paying B and C from them (Plan F phase 1, docs/planes/gta/PLAN-F-caballo.md §1.8, §2 and §3.2).
//   - The lock. a.bagsBy = [playerId, worldClockSec] says who may write a.bags now: whoever has the window open, or a guest
//     whose B or C pays from them. One rule for everybody, the rider included. Whoever decides the world (alone, the host or
//     the world server) takes it at once; a guest asks for it and the window opens only once the host has applied it
//     (CONFIRM_WAIT at most), so a refused change of the bags can never leave the items in two places. The holder refreshes
//     it every LOCK_REFRESH s; whoever decides clears it when it is stale (LOCK_STALE s, or its player is gone). Closing the
//     window, getting off, going indoors or leaving the world gives it back.
//   - The guard. The host checks every field a guest sends for a horse (horseGuard, through COLLECTIONS.animals.guard in
//     livesync.js): the rider, the lock, the bags, the bond fields, its care (horsecare.js) and the whistle fields, with horse.ours (owner or couple).
//   - ?alforjas=0 (opciones.js): no lock and no guard on the bags (last write wins, as before), new bags get 9 stacks, B and C
//     never pay from them and the window has its old title.
//
// API (the names are the F0 contract):
//   game.saddlebags = game.addSystem(new Saddlebags(game)), right after horse.
//   saddlebags.open(a)        X / the menu: the chest window on a's bags (a guest waits for the host's lock first)
//   saddlebags.canTouch(a)    may this game write a's bags now: B and C pay from them only then
//   saddlebags.kg(a)          what a's bags weigh (kg); fillOf(kg) is how full they look
//   saddlebags.holder(a)      the player id holding a's lock (a stale one does not count), or null
//   saddlebags.release(a)     give back this game's lock on a (and close its window)
//   saddlebags.waiting(a)     a guest waiting for the host's word on a's lock (the prompt says "…")
//   saddlebags.putOn(a), takeOff(a)   the horse menu's "Put on / Take off the saddlebags" (only when empty)
//   saddlebags.nearby(x, y, r)        ours horses with bags this game may touch within r m: carry.js chests()
//   saddlebags.changed(a)     after a's bags changed here (the window, B, C): tidy them and the rider's fill
//   padBags(bags), fillOf(kg), horseGuard(el, f, v, pid, ctx)   pure, for the tests
import { BARROW, stackKg } from './carry-items.js';
import { padStacks } from './barrow.js';
import { apagada } from './opciones.js';
import { Profile } from './accounts.js';
import { distOf } from './world/planet.js';
import { reportFault } from './faults.js';
import { t } from './i18n.js';
import { hud } from './ui/hud.js';
import { Audio } from './audio.js';

export const BAGS = { STACKS: 12, KG_FREE: 30, LOCK_STALE: 120, LOCK_REFRESH: 30, NEAR: 3 };
export const OLD_STACKS = 9;   // (bags from before Plan F, and new ones with ?alforjas=0)
export const FILL_HALF = 0, FILL_FULL = 20;   // kg from which the bags look half full (anything in them) and bulging
const CONFIRM_WAIT = 8;   // (a guest) seconds to wait for the host's word on the lock, as the wheelbarrow does
const SORE_MOST = 700;    // (the guard) s: the most a horse may be sore from now (horsecare.js SORE_S, and the clocks' drift)
const FUTURE = 60;        // (the guard) a lock's time may be ahead of the host's clock by this much (the clocks drift a little)
const QUIET_EVERY = 0.5, SWEEP_EVERY = 1, FILL_EVERY = 0.25;   // s between two looks: B/C's quiet lock, stale locks, the rider's fill
const REACH = 16;         // m: B and C pay from the bags of a horse this close (BUILD_STATION_REACH, as the chests)
const me = () => Profile.id || 'yo';   // (as ranch.js: a.owner and a.rider are written with it)

// Pure: the bags padded to their size (BARROW.STACKS and BAGS.STACKS are both 12: padStacks is reused as the plan asks)
export const padBags = bags => {
  if (apagada('alforjas')) { const out = Array.isArray(bags) ? bags.map(s => (s ? { ...s } : null)) : []; while (out.length < OLD_STACKS) out.push(null); return out; }
  return BAGS.STACKS === BARROW.STACKS ? padStacks(bags) : padStacks(bags).slice(0, BAGS.STACKS);
};
// Pure: how full they look (0 flat, 1 half, 2 bulging: the model and st.hb = 1 + fill)
export const fillOf = kg => (!(kg > 0) ? 0 : kg < FILL_FULL ? 1 : 2);
// Pure: nothing in them (no bags at all counts as empty)
export const bagsEmpty = b => !Array.isArray(b) || !b.some(Boolean);
const lockOk = (v, pid) => Array.isArray(v) && v.length === 2 && v[0] === pid && Number.isFinite(v[1]);

// The fields of a horse the host checks when a guest changes them (§3.2)
export const GUARDED = new Set(['rider', 'bagsBy', 'bags', 'bx', 'love', 'care', 'dirt', 'brushDay', 'carrotDay', 'callBy', 'callAt', 'stay', 'act', 'halt', 'fed', 'water', 'shoe', 'shod', 'sore', 'ownDay']);
const CARE01 = new Set(['fed', 'water', 'shoe']);
const BOND = new Set(['bx', 'love', 'care', 'dirt', 'brushDay', 'carrotDay']);
// Pure: may guest pid set field f of animal el (as this batch of ops leaves it so far) to v (undefined: delete it)?
// ctx: { ours(el, pid), present(id), clock, bagsOff, bondOff }. Every other field and animal passes
export function horseGuard(el, f, v, pid, ctx) {
  if (!el || el.type !== 'caballo' || !GUARDED.has(f) || !pid) return true;
  const lock = Array.isArray(el.bagsBy) ? el.bagsBy : null;
  const stale = L => !L || !Number.isFinite(L[1]) || !(ctx.clock - L[1] <= BAGS.LOCK_STALE) || !ctx.present(L[0]);
  const lockFree = () => ctx.bagsOff || !lock || lock[0] === pid || stale(lock);
  const riderGone = () => !el.rider || el.rider === pid || !ctx.present(el.rider);
  switch (f) {
    case 'rider':   // (fixes the double mount: one rider, ours, and never while another has the bags open)
      if (v === undefined || v === null) return riderGone();
      return v === pid && ctx.ours(el, pid) && riderGone() && lockFree();
    case 'bagsBy':
      if (ctx.bagsOff) return true;
      if (v === undefined || v === null) return !lock || lock[0] === pid;   // (only your own lock: stale ones are the host's to clear)
      return lockOk(v, pid) && v[1] <= ctx.clock + FUTURE && ctx.ours(el, pid) && lockFree();
    case 'bags':
      if (ctx.bagsOff) return true;
      if (lock && lock[0] === pid) return true;   // (the one lock rule, rider included)
      // (putting them on or taking them off with no lock: none before and empty ones now, or the other way round; ours)
      if (lock || !ctx.ours(el, pid)) return false;
      return Array.isArray(el.bags) ? bagsEmpty(el.bags) && (v === undefined || v === null) : Array.isArray(v) && bagsEmpty(v);
    case 'ownDay': return v === el.ownDay;   // (who runs the world keeps it: horsecare.js books)
    case 'sore':   // (a stumble: minutes of the world's clock, never more)
      return ctx.ours(el, pid) && (v === undefined || (Number.isFinite(v) && v <= ctx.clock + SORE_MOST));
    default:
      if (CARE01.has(f) && v !== undefined && !(v >= 0 && v <= 1)) return false;
      if (BOND.has(f) && ctx.bondOff) return true;   // (?vinculo=0: the bond as before, a pat by anyone counts)
      return ctx.ours(el, pid);   // (the bond, and callBy, callAt, stay, act, halt: owner or couple)
  }
}

export class Saddlebags {
  constructor(game) {
    this.game = game;
    this.off = apagada('alforjas');   // (?alforjas=0: no lock or guard, last write wins as before)
    this.lock = null;   // this game's lock: { id, ok (confirmed), since (g.time), at (world clock of the last write), open (open the window once confirmed), quiet (for B and C), act ('on' | 'off': put them on or take them off once confirmed) }
    this.win = null;    // the horse id whose window is open
    this.wasMount = false;
    this.quietAt = 0; this.sweepAt = 0; this.fillAt = 0;
  }
  get clock() { return this.game.world?.clock || 0; }
  decides() { const L = this.game.live; return !L?.joined || L.role === 'host'; }
  guest() { const L = this.game.live; return !!L?.joined && L.role === 'guest'; }
  sync() { return this.game.live?.items?.animals || null; }
  horse(id) { if (!id) return null; for (const a of this.game.ranch?.animals || []) if (a.id === id) return a; return null; }
  ours(a, pid = me()) { const H = this.game.horse; return H?.ours ? H.ours(a, pid) : !!a && a.owner === pid; }
  // Is that player in the world now (riding or on foot)? This game's own player too, while it is outdoors
  present(id) {
    if (!id) return false;
    if (id === me()) return !!this.game.player && this.game.scene === this.game.world;
    return !!this.game.ranch?.player?.(id);
  }
  nameOf(id) { return (id && this.game.live?.nameOf?.(id)) || t('horse.someone'); }   // (never a raw account id on screen)
  say(text) { hud.toast(text, 'warn'); Audio.error(); }

  reset() {
    this.lock = null; this.win = null; this.wasMount = false;
    // (a lock never survives a reload, but entering a world somebody else runs it is true and stays: menus.js play; old
    // 9-stack bags grow to 12)
    const guest = this.game.live?.entering === 'guest';
    for (const a of this.game.ranch?.animals || []) {
      if (a.type !== 'caballo') continue;
      if (!guest) delete a.bagsBy;
      if (Array.isArray(a.bags) && !this.off && a.bags.length < BAGS.STACKS) a.bags = padBags(a.bags);
    }
  }
  // (leaving the shared world: the lock stays there, and whoever decides it clears it as its player is gone)
  left() { this.closeWindow(); this.lock = null; }

  // ---------- reading ----------
  kg(a) { const b = a?.bags; if (!Array.isArray(b)) return 0; let k = 0; for (let i = 0; i < b.length; i++) k += stackKg(b[i]); return k; }
  holder(a) {
    const L = a?.bagsBy;
    if (!Array.isArray(L) || typeof L[0] !== 'string') return null;
    if (!(this.clock - L[1] <= BAGS.LOCK_STALE) || !this.present(L[0])) return null;   // (stale: as good as free)
    return L[0];
  }
  canTouch(a) {
    if (this.off || !a || !Array.isArray(a.bags)) return false;
    const who = this.holder(a);
    if (this.decides()) return !who || who === me();
    const L = this.lock;
    return !!L && L.ok && L.id === a.id && who === me();
  }
  waiting(a) { const L = this.lock; return !!L && !L.ok && (!a || L.id === a.id); }
  // The guard of COLLECTIONS.animals (livesync.js): may guest pid set field f of animal el to v?
  guard(id, f, v, pid, el) {
    const H = this.game.horse, bondOff = !!H?.off;
    if (this.off && bondOff && f !== 'rider') return true;
    return horseGuard(el, f, v, pid, { ours: (e, p) => this.ours(e, p), present: x => this.present(x), clock: this.clock, bagsOff: this.off, bondOff });
  }
  // Ours horses with bags this game may touch, within r m of (x, y): [{ a, d }], the nearest first (carry.js chests)
  nearby(x, y, r = REACH) {
    const g = this.game, p = g.player, out = [];
    if (this.off || g.scene !== g.world) return out;
    for (const a of g.ranch?.animals || []) {
      if (a.type !== 'caballo' || !Array.isArray(a.bags) || !this.ours(a)) continue;
      const mine = !!p?.mount && p.horseId === a.id;
      if (a.rider && !mine) continue;   // (someone else rides it: where it is, this game does not know)
      const d = mine ? 0 : distOf(x, y, a.x, a.y);
      if (d <= r && this.canTouch(a)) out.push({ a, d });
    }
    return out.sort((u, v) => u.d - v.d);
  }

  // ---------- the window ----------
  open(a) {
    const g = this.game;
    if (!a?.bags || g.mode !== 'play') return false;
    if (this.off) { this.showWindow(a); return this.win === a.id; }
    const who = this.holder(a);
    if (who && who !== me()) { this.say(t('horse.bags.busy', { who: this.nameOf(who) })); return false; }
    const L = this.lock;
    if (L && L.id === a.id) {
      if (L.ok) { this.showWindow(a); return this.win === a.id; }
      L.open = true; g.gather?.float?.(t('barrow.wait'), '#fff3c0'); return false;
    }
    if (L) this.release(this.horse(L.id));   // (one lock at a time: another horse's, from B or C)
    this.take(a, { open: true });
    if (this.lock?.ok) { this.showWindow(a); return this.win === a.id; }
    g.gather?.float?.(t('barrow.wait'), '#fff3c0');
    return false;
  }
  // Ask for (a guest) or take (whoever decides) a's lock
  take(a, { open = false, quiet = false, act = null } = {}) {
    const g = this.game, at = Math.round(this.clock);
    a.bagsBy = [me(), at];
    this.lock = { id: a.id, ok: this.decides(), since: g.time, at, open, quiet, act };
    if (this.lock.ok && Array.isArray(a.bags) && a.bags.length < BAGS.STACKS) a.bags = padBags(a.bags);
  }
  showWindow(a) {
    const g = this.game, p = g.player;
    if (!g.onChest || !a?.bags) return;
    if (!this.off && Array.isArray(a.bags) && a.bags.length < BAGS.STACKS) a.bags = padBags(a.bags);   // (ours to write now)
    const id = a.id, d0 = p ? distOf(p.x, p.y, a.x, a.y) : 0, reach = Math.max(BAGS.NEAR, d0 + 0.5);
    this.win = null;
    g.onChest(() => (Array.isArray(a.bags) ? a.bags : null), null, () => this.changed(a), {
      title: this.off ? null : () => t('gui.chest.saddlebags_kg', { kg: Math.round(this.kg(a)) }),
      may: this.off ? null : () => this.canTouch(a),
      // (it follows the horse: riding it, it stays open; on foot, it closes when you walk away from it)
      keep: () => {
        const q = g.player;
        if (!q || g.scene !== g.world || this.horse(id) !== a) return false;
        if (q.mount && q.horseId === id) return true;
        return !a.rider && distOf(q.x, q.y, a.x, a.y) <= reach;
      },
      onClose: () => { if (this.win === id) this.win = null; },
    });
    if (g.windows?.isOpen?.('s-chest')) { this.win = id; if (this.lock?.id === id) this.lock.open = false; }
  }
  closeWindow() { if (this.win !== null) { const w = this.game.windows; this.win = null; w?.close?.('s-chest'); } }
  changed(a) {
    if (!Array.isArray(a?.bags)) return;
    for (let i = 0; i < a.bags.length; i++) if (!a.bags[i]) a.bags[i] = null;   // (in place: the window keeps reading it; the others get it in the next diff)
    this.fillAt = 0;   // (the rider's fill: at once)
  }
  release(a) {
    if (!a) { this.lock = null; return; }
    if (this.win === a.id) this.closeWindow();
    if (Array.isArray(a.bagsBy) && a.bagsBy[0] === me()) delete a.bagsBy;
    if (this.lock?.id === a.id) this.lock = null;
  }

  // ---------- the horse menu ----------
  // A guest asks for the lock first (as the window does) and only then changes anything: a refused change can never leave
  // two pairs, or none
  ask(a, act) {
    const g = this.game, L = this.lock;
    if (L && L.id === a.id) {
      if (L.ok) return true;
      L.act = act;
    } else {
      if (L) this.release(this.horse(L.id));
      this.take(a, { act });
      if (this.lock?.ok) return true;
    }
    g.gather?.float?.(t('barrow.wait'), '#fff3c0');
    return false;
  }
  busy(a) {
    const who = this.off ? null : this.holder(a);
    if (!who || who === me()) return false;
    this.say(t('horse.bags.busy', { who: this.nameOf(who) }));
    return true;
  }
  putOn(a) {
    const g = this.game;
    if (!a || a.bags || !g.inv?.count('alforjas') || this.busy(a)) return false;
    if (!this.off && this.guest() && !this.ask(a, 'on')) return false;
    g.inv.remove('alforjas', 1);
    a.bags = padBags(null);
    if (g.player?.mount && g.player.horseId === a.id) g.player.horseBags = true;
    this.release(a);
    Audio.place?.();
    return true;
  }
  takeOff(a) {
    const g = this.game;
    if (!a?.bags) return false;
    if (!bagsEmpty(a.bags)) { this.say(t('horse.bags.not_empty')); return false; }
    if (this.busy(a)) return false;
    if (!this.off && this.guest() && !this.ask(a, 'off')) return false;
    this.release(a);
    delete a.bags;
    const left = g.inv?.add('alforjas', 1);
    if (left) g.gather?.throwOut?.('alforjas', left);   // (a full backpack: on the ground, as ranch.bagsOff)
    if (g.player?.mount && g.player.horseId === a.id) { g.player.horseBags = false; g.player.horseFill = 0; }
    Audio.pickup?.();
    return true;
  }

  // ---------- each step ----------
  update(dt) {
    const g = this.game, p = g.player, now = g.time;
    if (this.off) { if (this.win !== null && this.wasMount && !p?.mount) this.closeWindow(); this.wasMount = !!p?.mount; this.fill(p, now); return; }
    // Getting off or going indoors: the window closes (and the lock is given back below, when nothing needs it)
    const mounted = !!p?.mount;
    if ((this.wasMount && !mounted) || (this.win !== null && g.scene !== g.world)) this.closeWindow();
    this.wasMount = mounted;
    if (this.lock) this.follow(now);
    if (this.guest() && now - this.quietAt >= QUIET_EVERY) { this.quietAt = now; this.quiet(); }
    if (this.decides() && now - this.sweepAt >= SWEEP_EVERY) { this.sweepAt = now; this.sweep(); }
    this.fill(p, now);
  }
  // This game's lock: its answer (a guest), keeping it fresh, losing it, and giving it back when nothing needs it
  follow(now) {
    const g = this.game, L = this.lock, a = this.horse(L.id), mine = me();
    if (!a || (!Array.isArray(a.bags) && L.act !== 'on')) { if (a) this.release(a); else { if (this.win === L.id) this.closeWindow(); this.lock = null; } return; }   // (gone, or its bags taken off)
    const S = this.guest() ? this.sync() : null, pending = !!S?.pending?.(a.id, 'bagsBy');
    if (!L.ok) {
      if (this.decides()) L.ok = true;   // (this game decides the world now)
      else if (!pending && a.bagsBy?.[0] !== mine) {   // (refused: only the host's answer changes it while it is ours here)
        this.lock = null;
        if (L.open || L.act) this.say(t('horse.bags.busy', { who: this.nameOf(a.bagsBy?.[0]) }));
        return;
      } else if (!pending && S?.synced?.(a.id, 'bagsBy', a.bagsBy)) L.ok = true;   // (sent and applied by the host)
      else if (now - L.since > CONFIRM_WAIT) {   // (no word from the host: give up, and take the request back: a late yes is undone)
        if (a.bagsBy?.[0] === mine) delete a.bagsBy;
        this.lock = null;
        if (L.open || L.act) this.say(t('horse.bags.no_answer'));
        return;
      }
      if (!L.ok) return;
      if (L.act) { const act = L.act; L.act = null; if (act === 'on') this.putOn(a); else this.takeOff(a); if (this.lock === L && !L.open) this.release(a); g.onSave?.(); if (this.lock !== L) return; }
      if (L.open) { L.open = false; this.showWindow(a); }
    }
    // Lost (the host gave it to another, or cleared it as stale): the window closes at once and nothing more is written
    if (a.bagsBy?.[0] !== mine && !pending) {
      const had = this.win === a.id || L.open;
      this.closeWindow();
      this.lock = null;
      if (S?.pending?.(a.id, 'bags')) reportFault('saddlebags-lost-lock', 'Saddlebags');   // (the accepted leftover case, §3.2)
      if (had) this.say(t('horse.bags.busy', { who: this.nameOf(a.bagsBy?.[0]) }));
      return;
    }
    // Nothing needs it any more: the window is shut and B and C are closed (or far away)
    if (this.win !== a.id && !(L.quiet && this.wantsQuiet(a))) { this.release(a); return; }
    const clock = this.clock;
    if (clock - L.at >= BAGS.LOCK_REFRESH) { L.at = Math.round(clock); a.bagsBy = [mine, L.at]; }
  }
  // (a guest) B or C open: they pay from an ours horse's bags nearby once this game holds its lock, so it is asked for quietly
  buildOpen() { const g = this.game; return !!g.build?.on || !!g.windows?.isOpen?.('s-craft'); }
  wantsQuiet(a) {
    const g = this.game, p = g.player;
    if (!p || g.scene !== g.world || !this.buildOpen()) return false;
    return (p.mount && p.horseId === a.id) || (!a.rider && distOf(p.x, p.y, a.x, a.y) <= REACH);
  }
  quiet() {
    const g = this.game, p = g.player;
    if (this.lock || !p || g.scene !== g.world || !this.buildOpen()) return;
    let best = null, bd = Infinity;
    for (const a of g.ranch?.animals || []) {
      const who = a.type === 'caballo' ? this.holder(a) : null;
      if (a.type !== 'caballo' || !Array.isArray(a.bags) || bagsEmpty(a.bags) || !this.ours(a) || (who && who !== me())) continue;
      const d = p.mount && p.horseId === a.id ? 0 : a.rider ? Infinity : distOf(p.x, p.y, a.x, a.y);
      if (d <= REACH && d < bd) { bd = d; best = a; }
    }
    if (best) this.take(best, { quiet: true });
  }
  // (whoever decides) Stale locks are cleared: too old, or their player has gone
  sweep() {
    const mine = me();
    for (const a of this.game.ranch?.animals || []) {
      const L = a.bagsBy;
      if (L === undefined) continue;
      if (!Array.isArray(L) || typeof L[0] !== 'string') { delete a.bagsBy; continue; }
      if (L[0] === mine && this.lock?.id === a.id) continue;   // (this game's own: kept fresh by follow)
      if (!(this.clock - L[1] <= BAGS.LOCK_STALE) || !this.present(L[0])) delete a.bagsBy;
    }
  }
  // The rider's own horse: whether it has bags and how full they look (st.hb, the model), when they change
  fill(p, now) {
    if (!p?.mount || now - this.fillAt < FILL_EVERY) return;
    this.fillAt = now;
    const a = this.horse(p.horseId);
    if (!a) return;
    const has = Array.isArray(a.bags), f = has ? fillOf(this.kg(a)) : 0;
    if (p.horseBags !== has) p.horseBags = has;
    if (p.horseFill !== f) p.horseFill = f;
  }
}
