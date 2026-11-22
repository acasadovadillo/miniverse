// The weight inventory and carrying big things in the arms: the default for everybody since 2026-11-21.5 (see
// weightMode; it was a prototype behind ?inventario=peso, which still works). ?inventario=casillas is a temporary way
// back to the slot inventory (inventory.js): then Carry answers 1, false and nothing, and a save is the same as before.
// Design and reasons: docs/planes/gta/PLAN-C-peso.md.
//   - Everything weighs (carry-items.js, weightOf). What you carry comfortably: 25 kg, 70 with the backpack. The load
//     never refuses anything (every add() and room() stay as they were): it only changes how you move (speedMul, noRun,
//     jumpMul). The hotbar stays; the rest of the backpack is a list without a limit of stacks.
//   - The big things (a felled tree's log, a hunted deer…) are carried one at a time in the arms: Q puts it down, E on
//     the bench saws the log into planks, E on the kitchen butchers the carcass (more than in the field).
//   - Building (B) and crafting (C) also take what is missing from the chests within 16 tiles (have, spend).
// Only game.js imports this file (and the tests): inventory.js imports carry-items.js, never this one (a cycle with
// `extends Inventory` would stop the game from loading).
import { Inventory, HOTBAR, SLOTS } from './inventory.js';
import { ITEMS, LEGACY_ITEMS, CHESTS } from './items.js';
import { BULKY, BULKY_PARTS, CARCASS_OF, CARCASS_DAYS, BASE_CAP, BAG_CAP, HEAVY, weightOf } from './carry-items.js';
import { BUILD_STATION_REACH } from './build.js';
import { apagada } from './opciones.js';
import { Profile } from './accounts.js';
import { CHUNK } from './world/gen.js';
import { SWIM_IN } from './entities.js';
import { Audio } from './audio.js';
import { t, noun } from './i18n.js';
import { hud } from './ui/hud.js';
import { keys } from './input.js';

// The trees that leave a log when felled (cactus and bushes, as before)
const LOG_TREES = new Set(['oak', 'pine', 'snowPine', 'fruit', 'swampTree', 'palm']);
const SPLIT_HITS = 3;          // axe blows to split a log where it lies
const NO_RUN = 1.25;           // a load above this: no running
const SLOWEST = 0.45;          // the speed from HEAVY up, by the load alone
const FLOOR = 0.36;            // the load and something big in the arms together never go below this (out of anywhere, walking)
const JUMP_MIN = 0.86;         // the jump never goes below this (about 0.6 m: out of a hole of one block, DIG_H 0.5, with margin)
const SAY_EVERY = 3;           // seconds between two "your hands are full"
const ROT_EVERY = 2;           // seconds between two looks for carcasses that have rotted
const BONES_TTL = 900;         // seconds the bones of a rotted carcass stay on the ground (nobody may be near to pick them)
const SHOW_LOAD = 3;           // seconds the load meter stays after the load changes
const COOLDOWN = 0.32;         // (as gather.js: between two blows)
const SAY_RUN = 10;            // seconds between two "too loaded to run"
const MINE_FIRST = 3;          // seconds a felled log or a hunted carcass is only for whoever got it (as the drops: live.js)
const OLD_WARN_AFTER = 2.5;    // seconds of play with the world in sight before the notice of an old game carrying too much
const PICK_KEEP = 60;          // (seconds a note of who got it stays in its chunk: older ones go when another is written)

// On unless ?inventario=casillas (or =0: opciones.js), the temporary way back to the slot inventory; never on the world
// server (its player is a still spectator: it keeps the slot one, and what others carry goes by the network).
// ?inventario=peso, the prototype's switch, is simply the default now. Carry.force: the tests turn it on and off without
// the URL
export const weightMode = () => Carry.force ?? (!apagada('inventario') && !Profile.server);
// The backpack's description says what it does in the inventory there is (items.js has the old one, of the slots)
Object.defineProperty(ITEMS.mochila, 'desc', { configurable: true, enumerable: true, get: () => t(weightMode() ? 'item.mochila.desc' : 'item.mochila.desc_slots', { base: BASE_CAP, bag: BASE_CAP + BAG_CAP, n: ITEMS.mochila.bag }) });

// ---------- the weight inventory ----------
// The same slots as Inventory, of variable length: 0-8 the hotbar (as always), 9… the list (with a backpack, without a
// limit of stacks). Taking something out leaves a hole (null), as always, because many places write inv.slots[i] = null
// or keep an index between two calls; add() fills the holes first and then adds at the end. Only toSave() compacts (the
// copy it saves): the first 36 positions go in slots and the rest in keep, which every Inventory, also an older one,
// already reads (and keeps aside if it has no room). What is carried in the arms goes in keep too, with arms: 1
export class WeightInventory extends Inventory {
  constructor(data) {
    // (with a backpack, what keep holds is the end of the list: it goes back to the end, not to the hotbar's holes, where
    // Inventory would put it, so nothing changes place from one load to the next. Without one, as Inventory does)
    const keep = Array.isArray(data?.keep) ? data.keep : [], bag = data?.equip?.espalda?.id;
    const later = bag && ITEMS[bag]?.bag ? keep.filter(s => s?.id && ITEMS[s.id] && !BULKY[s.id] && !LEGACY_ITEMS[s.id]) : [];
    super(later.length ? { ...data, keep: keep.filter(s => !later.includes(s)) } : data);
    for (const s of later) this.slots.push({ ...s });
    this.weight = true;
    this.armsFull = false;    // (Carry: with something in the arms, nothing is in the hand: held is null)
    this.armsItem = null;     // ({ id, day }: what the arms carry, for the save)
    this.kgV = -1; this.kgNow = 0;
    // (what waited aside because it did not fit, and is known: to the list, now that there is room)
    if (this.equip.espalda) this.kept = this.kept.filter(e => { if (e.i < 0 && ITEMS[e.s.id] && !LEGACY_ITEMS[e.s.id]) { this.slots.push({ ...e.s }); return false; } return true; });
  }
  get held() { return this.armsFull ? null : this.slots[this.selected]; }
  // With a backpack there is always room for one more stack (the list); without one, the hotbar
  get cap() { return this.equip.espalda ? this.slots.length + 1 : HOTBAR; }
  // What all of it weighs (kg, one decimal): the slots and the armour worn (the clothes and the backpack on, nothing).
  // Only counted again when the inventory changes (v)
  get kg() {
    if (this.kgV !== this.v) {
      let k = 0;
      for (const s of this.slots) if (s) k += weightOf(s.id) * s.n;
      for (const it of Object.values(this.equip)) if (it && ITEMS[it.id]?.armor) k += weightOf(it.id);
      this.kgNow = Math.round(k * 10) / 10; this.kgV = this.v;
    }
    return this.kgNow;
  }
  get capKg() { return this.infinite ? Infinity : BASE_CAP + (this.equip.espalda ? BAG_CAP : 0); }
  get load() { return this.kg / this.capKg; }
  // As Inventory.add, but nothing is refused by weight, and with a backpack what does not fit in the stacks and holes goes
  // at the end. A big thing never goes in (whoever gives it leaves it on the ground: Carry.place)
  add(id, n, extra) {
    const L = LEGACY_ITEMS[id];
    if (L) { let left = 0; for (const [m, k] of L) left += this.add(m, n * k); return left; }
    if (!ITEMS[id] || BULKY[id]) return n;
    const max = ITEMS[id].stack, S = this.slots, bag = !!this.equip.espalda, lim = bag ? S.length : HOTBAR, start = n;
    extra ||= ITEMS[id].wear ? { color: ITEMS[id].dye } : undefined;
    if (!extra) for (let i = 0; i < lim && n > 0; i++) { const s = S[i]; if (s && s.id === id && !s.color && s.n < max) { const k = Math.min(n, max - s.n); s.n += k; n -= k; } }
    for (let i = 0; i < lim && n > 0; i++) if (!S[i]) { const k = Math.min(n, max); S[i] = { id, n: k, ...extra }; n -= k; }
    while (bag && n > 0) { const k = Math.min(n, max); S.push({ id, n: k, ...extra }); n -= k; }
    if (n < start) this.changed();
    return n;
  }
  // With a backpack, everything fits (the weight only slows you down); without one, by slots, as always
  room(id) { return BULKY[id] ? 0 : this.equip.espalda && ITEMS[LEGACY_ITEMS[id]?.[0][0] || id] ? Infinity : super.room(id); }
  // Taking off clothes or armour: with a backpack the list has no limit, so there is always a hole for it (at the end)
  unwear(slot) {
    if (slot !== 'espalda' && this.equip.espalda && this.equip[slot] && !this.slots.includes(null)) this.slots.push(null);
    return super.unwear(slot);
  }
  remove(id, n) {
    if (this.infinite) { this.changed(); return; }
    for (let i = this.slots.length - 1; i >= 0 && n > 0; i--) {
      const s = this.slots[i];
      if (s?.id !== id) continue;
      const k = Math.min(n, s.n);
      s.n -= k; n -= k;
      if (s.n <= 0) this.slots[i] = null;
    }
    this.changed();
  }
  // The rows of the list: the slot of each stack after the hotbar (holes skipped)
  listSlots() { const out = []; for (let i = HOTBAR; i < this.slots.length; i++) if (this.slots[i]) out.push(i); return out; }
  toSave() {
    const S = this.slots, hot = Array.from({ length: HOTBAR }, (_, i) => (S[i] ? { ...S[i] } : null));
    const list = S.slice(HOTBAR).filter(Boolean).map(s => ({ ...s }));
    const slots = [...hot, ...list.slice(0, SLOTS - HOTBAR)];
    while (slots.length < SLOTS) slots.push(null);
    const keep = list.slice(SLOTS - HOTBAR), equip = { ...this.equip };
    // (what is kept aside from a newer version: back to its slot if it is free and usable; if not, in keep)
    for (const { i, s } of this.kept) { if (i >= 0 && i < SLOTS && !slots[i] && (i < HOTBAR || this.equip.espalda)) slots[i] = { ...s }; else keep.push({ ...s }); }
    for (const [k, it] of Object.entries(this.keptEquip)) { if (!equip[k]) equip[k] = { ...it }; else keep.push({ ...it, n: 1 }); }
    if (this.armsItem) keep.push({ id: this.armsItem.id, n: 1, arms: 1, ...(this.armsItem.day !== undefined && this.armsItem.day !== null && { day: this.armsItem.day }) });
    return { slots, selected: this.selected, equip, wardrobe: 2, ...(keep.length && { keep }), w: 1 };
  }
}

// ---------- carrying in the arms, the load and the chests nearby ----------
export class Carry {
  static force = null;
  constructor(game) {
    this.game = game;
    this.held = null;        // the id of what the arms carry (a key of BULKY), or null
    this.day = null;         // (a carcass: the day it was hunted, so it keeps rotting on the ground: see today)
    this.owner = null;       // (the player it belongs to: a new game does not get the last one's)
    this.splits = new Map(); // the axe blows each log on the ground has had
    this.saidAt = -1e9; this.rotAt = 0; this.oldWarn = false; this.oldWarnIn = 0; this.level = 0; this.shownKg = 0; this.shownUntil = 0; this.runSaidAt = -1e9; this.runWas = false;
  }
  // On with the weight inventory in this game (the default; not with ?inventario=casillas)
  get on() { return !!this.game.inv?.weight; }
  get survival() { return this.game.gamemode === 'survival'; }
  get bigNow() { return this.on && this.survival; }   // (only then do the big things exist as such: in creative, their parts)
  // Why not (hands full, put it down first…): a notice fixed on the screen, not a floating one (those rise fast, out of the
  // top with the camera close, and are hard to read over the body)
  say(text) { hud.toast(text); }

  // What the arms carry: the inventory (held is null meanwhile, and it goes in the save) and the player (the drawing and
  // the network: carrying, armsBusy; entities.js does not hop fences or swim with it)
  set(id, day = null) {
    const g = this.game, inv = g.inv, p = g.player;
    this.held = id || null; this.day = id ? day : null; this.owner = p;
    if (inv.weight) { inv.armsFull = !!id; inv.armsItem = id ? { id, day } : null; }
    if (p) { p.carrying = this.held; p.armsBusy = id ? BULKY[id].hold : null; }
    inv.changed();
  }
  reset(save) {
    const g = this.game, inv = g.inv, saved = inv.armsSaved;
    this.held = null; this.day = null; this.owner = g.player; this.splits.clear(); this.saidAt = -1e9;
    if (g.player) { g.player.carrying = null; g.player.armsBusy = null; }
    if (inv.weight) { inv.armsFull = false; inv.armsItem = null; }
    if (saved) { inv.armsSaved = null; if (this.bigNow && BULKY[saved.id]) this.set(saved.id, saved.day == null ? null : this.dayOf(saved.day)); else this.giveParts(saved.id); }
    // (a game of slots opened for the first time with the weight inventory may carry far too much: nothing is thrown away,
    // it is only said once. Its save has no w until this game saves it, so it is said again only if it is not saved, or
    // after playing it with ?inventario=casillas. Said by update, once the world is in sight and the notices of the start,
    // the collections', have gone: said now, it would go by under the dark of the way in)
    this.oldWarn = !!(this.bigNow && save?.inventory && !save.inventory.w && inv.load > HEAVY && !Profile.server); this.oldWarnIn = OLD_WARN_AFTER;
    this.level = this.levelOf(); this.shownKg = this.on ? inv.kg : 0;
  }
  // What a big thing is worth, into the backpack (what does not fit, at your feet)
  giveParts(id) {
    const g = this.game;
    for (const [m, n] of BULKY_PARTS[id] || []) { const left = g.inv.add(m, n); if (left) g.gather.throwOut(m, left); }
  }

  // ---------- the load ----------
  levelOf() { const r = this.on && this.survival ? this.game.inv.load : 0; return r <= 1 ? 0 : r <= HEAVY ? 1 : 2; }
  // Not on a horse, in a boat or as a passenger (the horse and the boat carry it), nor in creative or as a spectator
  free() { const p = this.game.player; return !this.on || !p || !this.survival || p.mount || p.boat || p.aboard; }
  speedMul() {
    if (this.free()) return 1;
    const r = this.game.inv.load;
    const k = r <= 1 ? 1 : r <= HEAVY ? 1 - (1 - 0.6) * (r - 1) / (HEAVY - 1) : SLOWEST;
    return Math.max(FLOOR, k * (this.held ? BULKY[this.held].slow : 1));
  }
  noRun() { return !this.free() && (!!this.held || this.game.inv.load > NO_RUN); }
  jumpMul() {
    if (this.free()) return 1;
    const r = this.game.inv.load;
    return this.held ? JUMP_MIN : r <= 1 ? 1 : Math.max(JUMP_MIN, 1 - 0.18 * Math.min(1, (r - 1) / (HEAVY - 1)));
  }
  // For the meter (ui/loadmeter.js) and the minimal interface: { kg, cap, r, bulky }
  hud() { const inv = this.game.inv; return { kg: inv.kg, cap: inv.capKg, r: inv.load, bulky: this.held, arms: this.armsKg() }; }
  // What the arms carry weighs (kg; 0 with nothing): the meter shows it apart, the speed rules do not add it to the load
  armsKg() { return this.held ? BULKY[this.held].kg : 0; }
  // Should the load show now (the minimal interface)? For a while after it changes, and while it is near the limit
  showLoad() { return this.on && this.survival && (performance.now() < this.shownUntil || this.game.inv.load > 0.9 || !!this.held); }

  update(dt) {
    const g = this.game, p = g.player;
    // (the carcasses rot also in a game without the weight inventory, like the world server's: see rot)
    if ((this.rotAt += dt) >= ROT_EVERY) { this.rotAt = 0; this.rot(); }
    if (!this.on || !p) return;
    const inv = g.inv;
    if (this.oldWarn && g.mode === 'play' && !globalThis.document?.getElementById('fade')?.classList.contains('on') && (this.oldWarnIn -= dt) <= 0) {
      this.oldWarn = false;
      if (inv.load > HEAVY) { hud.toast(t('hud.load.too_heavy_old')); this.shownUntil = performance.now() + SHOW_LOAD * 2000; }   // (and the meter, a while)
    }
    if (this.survival && !p.mount && !p.boat && !p.aboard) {
      // Walking loaded tires you (hunger), more the more you carry; and with something in the arms, a bit always
      const moved = Math.hypot(p.vx, p.vy) * dt, r = inv.load;
      let n = 0;
      if (r > 1) n += moved * 0.04 * Math.min(1, (r - 1) / (HEAVY - 1));
      if (this.held) n += moved * 0.05;
      if (n > 0) g.combat?.exert(n);
    }
    // When the load goes from one level to another, a small notice; the meter shows a while when it changes
    const lv = this.levelOf();
    if (lv !== this.level) { this.level = lv; g.gather.float(t(['hud.load.normal', 'hud.load.heavy', 'hud.load.overloaded'][lv]), lv ? '#ffd07a' : '#d8f0c0'); this.shownUntil = performance.now() + SHOW_LOAD * 1000; }
    if (Math.abs(inv.kg - this.shownKg) >= 1) { this.shownKg = inv.kg; this.shownUntil = performance.now() + SHOW_LOAD * 1000; }
    // (trying to run when it cannot be: said once in a while, when the key goes down)
    const run = !!keys.run;
    if (run && !this.runWas && this.noRun() && g.time - this.runSaidAt > SAY_RUN) { this.runSaidAt = g.time; this.say(t(this.held ? 'carry.no_run_arms' : 'carry.no_run_heavy')); }
    this.runWas = run;
  }
  // The carcasses left on the ground for CARCASS_DAYS days: only bones are left. Playing together, the world's ones are
  // rotted by one game only, the one that decides the world (rotsWorld): alone, yours; with others, the host's game or
  // the world server's, which has every chunk and rots them wherever they are. A guest never does it: two guests near the
  // same carcass would each turn it into bones (the drops go by the network, so the bones would be doubled); the host's
  // change reaches everybody as any other change of the chunk (d.placed and d.carcass, livesync.js). A cave is always
  // the player's own (its state is not shared): its carcasses rot in the game of whoever is in it
  rotsWorld() { const L = this.game.live; return !L?.joined || L.role === 'host'; }
  // The days of the carcasses are real days (TimeSystem.realDay, with the world's shift of the clock), not the world's day
  // number: your own world and the shared one have different calendars (dayBase), and what the arms carry and the caves
  // go from one to the other with you. dayOf: a day as noted (a number below 1e4 is a day number of the prototype, of
  // this world's calendar), never in the future
  today() { return this.game.days?.realDay ?? 0; }
  dayOf(v) { const d = this.game.days; return Math.min(this.today(), v < 1e4 ? v + (d?.base ?? 0) : v); }
  rot() {
    const g = this.game, w = g.world, sc = g.scene, today = this.today();
    if (sc?.state && sc !== w && g.player) {
      const C = sc.state.carcass;
      for (const [k, day] of Object.entries(C || {})) {
        if (!(today - this.dayOf(day) >= CARCASS_DAYS)) continue;
        const [tx, ty] = k.split(',').map(Number), id = sc.at?.('placed', tx, ty);
        delete C[k];
        if (BULKY[id]?.prey) { sc.unplace({ tile: [tx, ty], layer: 'placed', placed: id }); this.bones(tx, ty, sc); }
        sc.touched?.();
      }
    }
    if (!w?.deltas || !this.rotsWorld()) return;
    for (const [key, d] of w.deltas) {
      const C = d?.carcass;
      if (!C || key.startsWith('u:')) continue;   // (u:… are the caves' states)
      let stale = false;
      for (const [k, day] of Object.entries(C)) {
        if (!(today - this.dayOf(day) >= CARCASS_DAYS)) continue;   // (also skips a day that is not a number)
        const [tx, ty] = k.split(',').map(Number), raw = w.ownAt('placed', tx, ty), id = raw && raw.split('@')[0];
        delete C[k];
        if (BULKY[id]?.prey) { w.unplace({ tile: [tx, ty], layer: 'placed', placed: id }); this.bones(tx, ty, w); }
        else stale = true;   // (its carcass was taken some other way: only the note goes)
      }
      if (stale) { const [cx, cy] = key.split(',').map(Number); w.touch(cx, cy); }
    }
  }
  bones(tx, ty, sc) {
    const n = 1 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) this.game.gather.addDrop({ id: 'hueso', x: tx + 0.3 + Math.random() * 0.4, y: ty + 0.3 + Math.random() * 0.4, z: 2, vz: 20, t: 0, ttl: BONES_TTL, scene: sc });
  }

  // ---------- what the hands can do ----------
  // The hint below: { text, key } (the key on its label: Q, or none). In build mode, B's own hint (what it costs, why not)
  hint() {
    const g = this.game;
    if (!this.held || g.build?.on) return '';
    const p = g.player, sc = g.scene;
    if (p && sc?.waterDepth && [0.6, 1, 1.4].some(d => sc.waterDepth(p.x + p.face.x * d, p.y + p.face.y * d) >= SWIM_IN)) return { text: t('carry.no_swim'), key: '' };
    return { text: t('hud.tip.carry', { item: noun('item', this.held) }), key: 'Q' };
  }
  // A click with something in the arms: nothing (no punches, no picking by hand), and now and then it says why
  handsFull(auto = false) {
    const now = this.game.time;
    if (!auto || now - this.saidAt > SAY_EVERY) { this.saidAt = now; this.say(t('carry.hands_full')); if (!auto) Audio.error(); }
  }
  // Mounting, getting in a boat, sitting, lying down or sleeping with it: first put it down (true: refused). dropFirst: what
  // the hint of those says meanwhile ('' with nothing in the arms)
  dropFirst() { return this.held ? t('carry.drop_first', { item: noun('item', this.held) }) : ''; }
  refuse() {
    if (!this.held) return false;
    this.say(this.dropFirst());
    Audio.error();
    return true;
  }
  // E on a big thing on the ground: on the shoulder (X on a carcass: butcher it there). With the slot inventory
  // (?inventario=casillas), or in creative, picking it up gives its parts
  placedAction(o) {
    const id = o.placed, item = noun('item', id);   // (a noun: "the log", "la pieza de ciervo")
    const wait = this.notYours(o);
    if (wait) return { text: wait, run: () => { this.say(wait); Audio.error(); } };
    if (!this.bigNow) return { text: t('carry.take', { item }), run: () => this.take(o) };
    const why = this.cantTake();
    if (why) return { text: why, run: () => { this.say(why); Audio.error(); } };
    return { text: t('carry.shoulder', { item }), run: () => this.take(o), alt: BULKY[id].prey ? { text: t('carry.butcher'), run: () => this.butcher(o) } : null };
  }
  // E on a station with something in the arms: the bench saws the log, the kitchen butchers the carcass (null: nothing)
  stationAction(o) {
    const id = this.held, B = id && BULKY[id];
    if (!B) return null;
    if (B.saw && o.placed === 'banco') return { text: t('carry.saw'), run: () => this.convert(B.saw) };
    if (B.prey && o.placed === 'cocina') return { text: t('carry.butcher_here'), run: () => this.convert([...B.drops.map(([m, , max]) => [m, max]), [B.extra, 1]]) };
    return null;
  }
  // Why it cannot go in the arms here ('' if it can): riding, rowing, as a passenger, swimming, sitting or lying down
  cantTake() {
    const p = this.game.player;
    if (!p) return '';
    if (p.mount || p.boat || p.aboard) return t('carry.not_riding');
    return p.swim || p.pose ? t('carry.cant_take_here') : '';
  }
  take(o) {
    const g = this.game, p = g.player, sc = g.scene;
    if (!p || g.gamemode === 'spectator') return;
    if (this.held) { this.say(t('carry.hands_full')); Audio.error(); return; }
    const why = this.notYours(o) || (this.bigNow && this.cantTake());
    if (why) { this.say(why); Audio.error(); return; }
    const day = this.dayAt(o.tile);
    if (sc.unplace(o) === false) { Audio.error(); return; }
    this.forget(o.tile);
    if (this.bigNow) this.set(o.placed, Number.isFinite(day) ? this.dayOf(day) : BULKY[o.placed].prey ? this.today() : null);
    else this.giveParts(o.placed);
    Audio.pickup();
    g.onSave?.();
  }
  // What it becomes at the station, into the backpack
  convert(list) {
    const g = this.game, id = this.held;
    if (!id) return;
    this.set(null);
    const sum = new Map();   // (the same thing twice, the most and the extra: one notice, "+3 Bone")
    for (const [m, n] of list) sum.set(m, (sum.get(m) || 0) + n);
    const got = [];   // (all of it in one notice: four at a time at most, and a new recipe would push one out)
    for (const [m, n] of sum) { const left = g.inv.add(m, n); if (left) g.gather.throwOut(m, left); got.push(`+${n} ${ITEMS[m].name}`); }
    g.gather.float(got.join(' · '), '#fff3c0');
    if (BULKY[id].saw) g.gather.chips(g.player.x + g.player.face.x, g.player.y + g.player.face.y, 'wood', 14);
    Audio.craft();
    g.onSave?.();
  }
  // X on a carcass on the ground: butchered there, the least of each
  butcher(o) {
    const g = this.game, B = BULKY[o.placed], wait = this.notYours(o);
    if (wait) { this.say(wait); Audio.error(); return; }
    if (!B?.prey || g.scene.unplace(o) === false) return;
    this.forget(o.tile);
    g.gather.spawnDrops(o, { drops: B.drops.map(([m, min, , chance]) => [m, min, min, chance]) });
    g.gather.chips(o.x, o.y, 'dirt', 14);
    Audio.noiseHit(180, 0.2, 0.35);
    g.onSave?.();
  }
  // Q (only Q: E always does what it says, never drops it): put it down in front, or on the tile the cursor points at if
  // it is close
  drop() {
    const g = this.game, p = g.player;
    if (!this.held || !p || g.busy || g.mode !== 'play') return false;
    const tile = this.dropTile();
    if (!tile) { this.say(t('carry.cant_here')); Audio.error(); return false; }
    this.putAt(tile);
    Audio.place();
    g.onSave?.();
    return true;
  }
  // Where it goes down: the tile pointed at (if close), the one in front and, only if that one is in reach, its sides.
  // Never where you stand, behind a wall or a closed door (reached), or in a doorway or right before or after one (it
  // would block the way in)
  dropTile(player = this.game.player) {
    const g = this.game, p = g.player, sc = g.scene, id = this.held, px = Math.floor(p.x), py = Math.floor(p.y);
    const seen = ([x, y]) => this.reached(p, x + 0.5, y + 0.5);
    const door = ([x, y]) => !!sc.doorNear?.(x + 0.5, y + 0.5, 1.05);
    const ok = q => !(player && q[0] === px && q[1] === py) && seen(q) && !door(q) && !!sc.canPlace?.(q[0], q[1], id, player);
    const out = [], mt = g.mouse?.in ? g.mouseTile() : null, fx = Math.floor(p.x + p.face.x * 1.1), fy = Math.floor(p.y + p.face.y * 1.1);
    if (mt && Math.hypot(mt[0] + 0.5 - p.x, mt[1] + 0.5 - p.y) <= 2.5) out.push(mt);
    out.push([fx, fy]);
    if (seen([fx, fy]) && !sc.wall?.(fx, fy)) for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) out.push([fx + i, fy + j]);
    return out.find(ok) || null;
  }
  // Is a point reached from the player without a wall or a closed door between? (the world says it; a cave, its walls)
  reached(p, x, y) {
    const sc = this.game.scene;
    if (sc.reaches) return sc.reaches(p.x, p.y, x, y);
    if (!sc.blocked) return true;
    for (let i = 1; i <= 6; i++) { const k = i / 6; if (sc.blocked(p.x + (x - p.x) * k, p.y + (y - p.y) * k)) return false; }
    return true;
  }
  putAt([tx, ty]) {
    const g = this.game, p = g.player, sc = g.scene, id = this.held;
    if (BULKY[id].prey) this.setDay([tx, ty], this.day ?? this.today());
    sc.place(tx, ty, id, Math.abs(p.face.x) > Math.abs(p.face.y) ? 0 : 1);
    this.set(null);
  }
  // (the day of a carcass: in the world by the chunk, d.carcass, which goes by the network and in the save like d.mown;
  // in a cave, in its own state, saved with it)
  daysOf([tx, ty], create) {
    const g = this.game, w = g.world, sc = g.scene;
    if (sc === w) { const d = w.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK), create); return d && (create ? (d.carcass ||= {}) : d.carcass); }
    const st = sc?.state;
    return st && (create ? (st.carcass ||= {}) : st.carcass);
  }
  dayAt(tile) { return this.daysOf(tile, false)?.[String(tile)] ?? null; }
  setDay(tile, day) {
    const C = this.daysOf(tile, day !== null);
    if (!C) return;
    if (day === null) delete C[String(tile)]; else C[String(tile)] = day;
    if (this.game.scene !== this.game.world) this.game.scene.touched?.();
  }
  // A big thing gone from a tile: its day, its axe blows and who got it
  forget(tile) {
    this.setDay(tile, null); this.splits.delete(String(tile));
    const P = this.picks(tile, false);
    if (P) delete P[String(tile)];
  }
  // Playing together, a felled log or a hunted carcass is only for whoever got it for MINE_FIRST seconds, as what breaks
  // leaves (live.js mayTake): its chunk notes who and when (d.firstPick: { "x,y": [player, world clock] }), which goes by
  // the network with the chunk. Two pressing E at the same moment is the same race as with the drops. Alone: nothing
  picks(tile, create) {
    const w = this.game.world, d = w?.delta?.(Math.floor(tile[0] / CHUNK), Math.floor(tile[1] / CHUNK), create);
    return d && (create ? (d.firstPick ||= {}) : d.firstPick);
  }
  markMine(tile) {
    const g = this.game, w = g.world;
    if (!g.live?.joined || g.scene !== w || !Profile.id) return;
    const P = this.picks(tile, true), now = w.clock || 0;
    for (const [k, [, at]] of Object.entries(P)) if (!(now - at < PICK_KEEP)) delete P[k];
    P[String(tile)] = [Profile.id, Math.round(now * 10) / 10];
  }
  // '' if you may take it; if not, why (for the hint and the notice)
  notYours(o) {
    const g = this.game, w = g.world;
    if (!g.live?.joined || g.scene !== w || !o?.tile) return '';
    const m = this.picks(o.tile, false)?.[String(o.tile)];
    if (!Array.isArray(m) || m[0] === Profile.id) return '';
    const age = (w.clock || 0) - m[1];
    if (!(age >= -MINE_FIRST && age < MINE_FIRST)) return '';   // (also a clock far off: it is free)
    const name = g.live.nameOf?.(m[0]);
    return name ? t('carry.first_pick', { name }) : t('carry.first_pick_anon');
  }

  // ---------- where they come from ----------
  // A tree felled with the weight inventory: its log, lying where the tree falls (away from you), instead of the wood; the
  // fruit and the seeds as always. Tried: one tile on in that direction, the tree's own, and the two to the sides (never
  // where you stand). Playing together, the game of whoever fells it places it (a change of the chunk, as any other).
  // false: as before (no room, the slot inventory, or creative)
  felled(o, rule) {
    const g = this.game, p = g.player, sc = g.scene;
    if (!this.bigNow || sc !== g.world || !p || !LOG_TREES.has(o.kind)) return false;
    let dx = o.x - p.x, dy = o.y - p.y;
    const l = Math.hypot(dx, dy);
    if (l < 0.05) { dx = p.face.x; dy = p.face.y; } else { dx /= l; dy /= l; }
    const sx = Math.round(dx), sy = Math.round(dy), ox = Math.floor(o.x), oy = Math.floor(o.y);
    const tile = [[ox + sx, oy + sy], [ox, oy], [ox - sy, oy + sx], [ox + sy, oy - sx]].find(([x, y]) => sc.canPlace(x, y, 'log', p));
    if (!tile) return false;
    this.markMine(tile);
    sc.place(...tile, 'log', Math.abs(dx) > Math.abs(dy) ? 0 : 1);
    const rest = rule.drops.filter(([id]) => id !== 'madera');
    if (rest.length) g.gather.spawnDrops(o, { ...rule, drops: rest });
    return true;
  }
  // A hunted adult deer, boar, cow, sheep, goat or pig leaves its carcass where it fell (or next to it). Playing together,
  // it is placed by the game of whoever hunted it (hunt.js reward: the host tells the hunter). false: as before
  hunted(type, x, y) {
    const g = this.game, w = g.world, id = CARCASS_OF[type];
    if (!id || !this.bigNow || g.scene !== w || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const tx = Math.floor(x), ty = Math.floor(y);
    const tile = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([i, j]) => [tx + i, ty + j]).find(([a, b]) => w.canPlace(a, b, id, g.player));
    if (!tile) return false;
    this.setDay(tile, this.today());
    this.markMine(tile);
    w.place(...tile, id, Math.floor(Math.random() * 4));
    return true;
  }
  // Splitting a log on the ground with the axe (a target of gather.js: a click, SPLIT_HITS blows)
  target(p, held, def) {
    if (!this.bigNow || this.held || def?.tool !== 'hacha') return null;
    const o = this.aimedLog(p);
    return o ? { label: t('carry.split'), ok: true, auto: true, use: () => this.split(o) } : null;
  }
  aimedLog(p) {
    const g = this.game;
    if (g.mouse) { const a = g.aimed(); return a?.kind === 'placed' && a.o.placed === 'log' ? a.o : null; }
    return (g.scene.placedNear?.(p.x, p.y, 1.7) || []).find(o => o.placed === 'log') || null;
  }
  split(o) {
    const g = this.game, k = String(o.tile), wait = this.notYours(o);
    g.gather.cooldown = COOLDOWN;
    if (wait) { if (g.time - this.saidAt > SAY_EVERY) { this.saidAt = g.time; this.say(wait); Audio.error(); } return; }
    if (!g.gather.spend('hacha')) return;
    const n = (this.splits.get(k) || 0) + 1;
    g.gather.chips(o.x, o.y, 'wood');
    Audio.chop();
    if (n < SPLIT_HITS) { this.splits.set(k, n); return; }
    this.splits.delete(k);
    if (g.scene.unplace(o) === false) return;
    // (the felling skill's extra, rolled here: the log does not keep it)
    g.gather.spawnDrops(o, { drops: BULKY.log.field.map(([m, q]) => [m, q, q]) }, Math.random() < (g.skills?.bonus('tala') || 0));
    g.gather.chips(o.x, o.y, 'wood', 16);
    g.skills?.gain('tala', 1);
    Audio.fell();
    g.onSave?.();
  }

  // ---------- other moments ----------
  // Dying: what the arms carry stays where you fell (on your tile or one next to it; if none, its parts, as the rest)
  onDeath(ttl) {
    if (!this.held) return;
    const g = this.game, p = g.player, sc = g.scene, id = this.held, tx = Math.floor(p.x), ty = Math.floor(p.y);
    const tile = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([i, j]) => [tx + i, ty + j]).find(([a, b]) => sc.canPlace?.(a, b, id, null));
    if (tile) { this.putAt(tile); return; }
    this.set(null);
    for (const [m, n] of BULKY_PARTS[id]) g.gather.addDrop({ id: m, count: n, x: p.x, y: p.y, z: 4, vz: 30, t: 0, scene: sc, sceneKey: g.sceneKey?.(sc), ttl });
  }
  // Creative or spectator with something in the arms: creative has no big things (its parts, to the backpack); the
  // spectator touches nothing (put down, or its parts)
  onMode(gm) {
    if (!this.held || this.owner !== this.game.player || gm === 'survival') return;
    const id = this.held, tile = gm === 'spectator' ? this.dropTile() : null;
    if (tile) { this.putAt(tile); return; }
    this.set(null);
    this.giveParts(id);
  }
  // For the network (live.js, st.ca): only when carrying something
  state() { return this.held && this.game.gamemode !== 'spectator' ? this.held : undefined; }

  // ---------- building and crafting from the chests nearby ----------
  // The chests you would open with E (never a neighbor's), within BUILD_STATION_REACH: [{ o, c }], the nearest first
  chests() {
    const g = this.game, p = g.player, sc = g.scene, out = [];
    if (!p || !sc?.placedNear) return out;
    for (const o of sc.placedNear(p.x, p.y, BUILD_STATION_REACH)) {
      if (!CHESTS[o.placed] || o.fixed || o.unknown) continue;
      const c = sc.chestAt?.(...o.tile);
      if (c) out.push({ o, c, d: Math.hypot(o.x - p.x, o.y - p.y) });
    }
    return out.sort((a, b) => a.d - b.d);   // (placedNear does not sort them)
  }
  // How many of a thing there are to build or craft with: in the backpack and, with the weight inventory, in the chests nearby.
  // Asked every frame, so the chests are counted again at most twice a second, or at once when the backpack changes (a
  // chest window moves things both ways) or you move; fresh: counted now (to pay: what another player took meanwhile)
  have(id, fresh = false) {
    const g = this.game, inv = g.inv, own = inv.count(id), p = g.player;
    if (!this.on || g.admin || inv.infinite || !p) return own;
    const now = performance.now(), N = this.near;
    if (fresh || !N || now - N.t > 500 || N.v !== inv.v || N.sc !== g.scene || Math.hypot(N.x - p.x, N.y - p.y) > 1) this.near = { t: now, x: p.x, y: p.y, sc: g.scene, v: inv.v, n: this.inChests() };
    return own + (this.near.n.get(id) || 0);
  }
  inChests() {
    const n = new Map();
    for (const { c } of this.chests()) for (const s of c) if (s && ITEMS[s.id]) n.set(s.id, (n.get(s.id) || 0) + s.n);
    return n;
  }
  // Pay a cost ([[id, n]…]): the backpack first, then the chests, the nearest first. All or nothing: if, counted now,
  // something is missing, nothing is taken and it answers false (whoever builds or crafts does not go on). It says what
  // came from where
  spend(cost) {
    const g = this.game, inv = g.inv;
    if (!this.on || g.admin || inv.infinite) { for (const [m, n] of cost) inv.remove(m, n); return true; }
    const need = new Map();
    for (const [m, n] of cost) need.set(m, (need.get(m) || 0) + n);
    const chests = this.chests(), there = new Map();
    for (const { c } of chests) for (const s of c) if (s && ITEMS[s.id]) there.set(s.id, (there.get(s.id) || 0) + s.n);
    this.near = null;
    for (const [m, n] of need) if (inv.count(m) + (there.get(m) || 0) < n) return false;
    const from = [];
    for (const [m, total] of need) {
      let n = total;
      const k = Math.min(n, inv.count(m));
      if (k) inv.remove(m, k);
      n -= k;
      if (n <= 0) continue;
      for (const { o, c } of chests) {
        let took = 0;
        for (let j = 0; j < c.length && n > 0; j++) {
          const s = c[j];
          if (s?.id !== m) continue;
          const q = Math.min(n, s.n);
          s.n -= q; n -= q; took += q;
          if (s.n <= 0) c[j] = null;
        }
        if (took) { g.scene.chestTouched(...o.tile); from.push(t('carry.from_chest', { n: took, item: ITEMS[m], chest: { name: ITEMS[o.placed].name, g: CHESTS[o.placed][1].startsWith('la ') ? 'f' : 'm' } })); }
        if (n <= 0) break;
      }
    }
    if (from.length) g.gather.float(from.join(' · '), '#fff3c0');
    return true;
  }
}
