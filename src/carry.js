// The weight inventory and carrying big things in the arms: a PROTOTYPE, only with ?inventario=peso (see weightMode).
// Without it nothing here changes the game: the slot inventory stays (inventory.js), Carry answers 1, false and nothing,
// and a save is the same as always. Design and reasons: docs/planes/gta/PLAN-C-peso.md.
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
import { opcion } from './opciones.js';
import { Profile } from './accounts.js';
import { CHUNK } from './world/gen.js';
import { SWIM_IN } from './entities.js';
import { Audio } from './audio.js';
import { t } from './i18n.js';
import { hud } from './ui/hud.js';

// The trees that leave a log when felled (cactus and bushes, as before)
const LOG_TREES = new Set(['oak', 'pine', 'snowPine', 'fruit', 'swampTree', 'palm']);
const SPLIT_HITS = 3;          // axe blows to split a log where it lies
const NO_RUN = 1.25;           // a load above this: no running
const SLOWEST = 0.45;          // the speed from HEAVY up (never slower: you can always walk out of anywhere)
const JUMP_MIN = 0.82;         // the jump never goes below this (0.56 m: out of a hole of one block, DIG_H 0.5)
const SAY_EVERY = 3;           // seconds between two "your hands are full"
const ROT_EVERY = 2;           // seconds between two looks for carcasses that have rotted
const SHOW_LOAD = 3;           // seconds the load meter stays after the load changes
const COOLDOWN = 0.32;         // (as gather.js: between two blows)

// The prototype: ?inventario=peso, never on the world server (it has no player). Carry.force: the tests turn it on and
// off without the URL
export const weightMode = () => Carry.force ?? (opcion('inventario') === 'peso' && !Profile.server);

// ---------- the weight inventory ----------
// The same slots as Inventory, of variable length: 0-8 the hotbar (as always), 9… the list (with a backpack, without a
// limit of stacks). Taking something out leaves a hole (null), as always, because many places write inv.slots[i] = null
// or keep an index between two calls; add() fills the holes first and then adds at the end. Only toSave() compacts (the
// copy it saves): the first 36 positions go in slots and the rest in keep, which every Inventory, also an older one,
// already reads (and keeps aside if it has no room). What is carried in the arms goes in keep too, with arms: 1
export class WeightInventory extends Inventory {
  constructor(data) {
    super(data);
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
  room(id) { return this.equip.espalda && ITEMS[LEGACY_ITEMS[id]?.[0][0] || id] ? Infinity : super.room(id); }
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
    this.day = null;         // (a carcass: the day it was hunted, so it keeps rotting on the ground)
    this.owner = null;       // (the player it belongs to: a new game does not get the last one's)
    this.splits = new Map(); // the axe blows each log on the ground has had
    this.saidAt = -1e9; this.rotAt = 0; this.level = 0; this.shownKg = 0; this.shownUntil = 0;
  }
  // On with the weight inventory (the prototype) in this game
  get on() { return !!this.game.inv?.weight; }
  get survival() { return this.game.gamemode === 'survival'; }
  get bigNow() { return this.on && this.survival; }   // (only then do the big things exist as such: in creative, their parts)
  say(text) { this.game.gather.float(text, '#ffb0a0'); }

  // What the arms carry: the inventory (held is null meanwhile, and it goes in the save) and the player (the drawing and
  // the network: carrying, armsBusy; entities.js does not hop fences or swim with it)
  set(id, day = null) {
    const g = this.game, inv = g.inv, p = g.player;
    this.held = id || null; this.day = id ? day : null; this.owner = p;
    if (inv.weight) { inv.armsFull = !!id; inv.armsItem = id ? { id, day } : null; }
    if (p) { p.carrying = this.held; p.armsBusy = id ? BULKY[id].hold : null; }
    inv.changed();
  }
  reset() {
    const g = this.game, inv = g.inv, saved = inv.armsSaved;
    this.held = null; this.day = null; this.owner = g.player; this.splits.clear(); this.saidAt = -1e9;
    if (g.player) { g.player.carrying = null; g.player.armsBusy = null; }
    if (inv.weight) { inv.armsFull = false; inv.armsItem = null; }
    if (saved) { inv.armsSaved = null; if (this.bigNow && BULKY[saved.id]) this.set(saved.id, saved.day ?? null); else this.giveParts(saved.id); }
    // (an old game of slots, opened with the prototype, may carry far too much: nothing is thrown away, it is only said once)
    if (this.bigNow && inv.load > HEAVY && !Profile.server) hud.toast(t('hud.load.too_heavy_old'));
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
    return k * (this.held ? BULKY[this.held].slow : 1);
  }
  noRun() { return !this.free() && (!!this.held || this.game.inv.load > NO_RUN); }
  jumpMul() {
    if (this.free()) return 1;
    const r = this.game.inv.load;
    return this.held ? JUMP_MIN : r <= 1 ? 1 : Math.max(JUMP_MIN, 1 - 0.18 * Math.min(1, (r - 1) / (HEAVY - 1)));
  }
  // For the meter (ui/loadmeter.js) and the minimal interface: { kg, cap, r, bulky }
  hud() { const inv = this.game.inv; return { kg: inv.kg, cap: inv.capKg, r: inv.load, bulky: this.held }; }
  // Should the load show now (the minimal interface)? For a while after it changes, and while it is near the limit
  showLoad() { return this.on && this.survival && (performance.now() < this.shownUntil || this.game.inv.load > 0.9 || !!this.held); }

  update(dt) {
    const g = this.game, p = g.player;
    if (!this.on || !p) return;
    const inv = g.inv;
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
    if ((this.rotAt += dt) >= ROT_EVERY) { this.rotAt = 0; this.rot(); }
  }
  // The carcasses left on the ground for CARCASS_DAYS days, around you: only bones are left
  rot() {
    const g = this.game, w = g.world, p = g.player, today = g.days?.dayIndex ?? 0;
    if (!w || g.scene !== w) return;
    const cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const d = w.delta(cx + dx, cy + dy), C = d?.carcass;
      if (!C) continue;
      for (const [k, day] of Object.entries(C)) {
        if (today - day < CARCASS_DAYS) continue;
        const [tx, ty] = k.split(',').map(Number), raw = w.ownAt('placed', tx, ty), id = raw && raw.split('@')[0];
        delete C[k];
        if (BULKY[id]?.prey) {
          w.unplace({ tile: [tx, ty], layer: 'placed', placed: id });
          const n = 1 + (Math.random() < 0.5 ? 1 : 0);
          for (let i = 0; i < n; i++) g.gather.addDrop({ id: 'hueso', x: tx + 0.3 + Math.random() * 0.4, y: ty + 0.3 + Math.random() * 0.4, z: 2, vz: 20, t: 0, scene: w });
        } else w.touch(cx + dx, cy + dy);
      }
    }
  }

  // ---------- what the hands can do ----------
  hint() {
    if (!this.held) return '';
    const g = this.game, p = g.player, sc = g.scene;
    if (p && sc?.waterDepth && [0.6, 1, 1.4].some(d => sc.waterDepth(p.x + p.face.x * d, p.y + p.face.y * d) >= SWIM_IN)) return t('carry.no_swim');
    return t('hud.tip.carry');
  }
  // A click with something in the arms: nothing (no punches, no picking by hand), and now and then it says why
  handsFull(auto = false) {
    const now = this.game.time;
    if (!auto || now - this.saidAt > SAY_EVERY) { this.saidAt = now; this.say(t('carry.hands_full')); if (!auto) Audio.error(); }
  }
  // Mounting, getting in a boat, sitting, lying down or sleeping with it: first put it down (true: refused)
  refuse() {
    if (!this.held) return false;
    this.say(t('carry.drop_first', { item: ITEMS[this.held] }));
    Audio.error();
    return true;
  }
  // E on a big thing on the ground: on the shoulder (X on a carcass: butcher it there). Without the prototype, or in
  // creative, picking it up gives its parts
  placedAction(o) {
    const id = o.placed, item = ITEMS[id];
    if (!this.bigNow) return { text: t('carry.take', { item }), run: () => this.take(o) };
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
  take(o) {
    const g = this.game, p = g.player, sc = g.scene;
    if (!p || g.gamemode === 'spectator') return;
    if (this.held) { this.say(t('carry.hands_full')); Audio.error(); return; }
    const day = this.dayAt(o.tile);
    if (sc.unplace(o) === false) { Audio.error(); return; }
    this.setDay(o.tile, null);
    if (this.bigNow) this.set(o.placed, day ?? (BULKY[o.placed].prey ? g.days?.dayIndex ?? 0 : null));
    else this.giveParts(o.placed);
    this.splits.delete(String(o.tile));
    Audio.pickup();
    g.onSave?.();
  }
  // What it becomes at the station, into the backpack
  convert(list) {
    const g = this.game, id = this.held;
    if (!id) return;
    this.set(null);
    for (const [m, n] of list) { const left = g.inv.add(m, n); if (left) g.gather.throwOut(m, left); g.gather.float(`+${n} ${ITEMS[m].name}`, '#fff3c0'); }
    if (BULKY[id].saw) g.gather.chips(g.player.x + g.player.face.x, g.player.y + g.player.face.y, 'wood', 14);
    Audio.craft();
    g.onSave?.();
  }
  // X on a carcass on the ground: butchered there, the least of each
  butcher(o) {
    const g = this.game, B = BULKY[o.placed];
    if (!B?.prey || g.scene.unplace(o) === false) return;
    this.setDay(o.tile, null);
    g.gather.spawnDrops(o, { drops: B.drops.map(([m, min, , chance]) => [m, min, min, chance]) });
    g.gather.chips(o.x, o.y, 'dirt', 14);
    Audio.noiseHit(180, 0.2, 0.35);
    g.onSave?.();
  }
  // Q (or E with nothing to do): put it down in front, or on the tile the cursor points at if it is close
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
  dropTile(player = this.game.player) {
    const g = this.game, p = g.player, sc = g.scene, id = this.held, px = Math.floor(p.x), py = Math.floor(p.y);
    // (never where you stand: a cave does not look at that by itself)
    const ok = ([x, y]) => !(player && x === px && y === py) && !!sc.canPlace?.(x, y, id, player);
    const out = [], mt = g.mouse?.in ? g.mouseTile() : null, fx = Math.floor(p.x + p.face.x * 1.1), fy = Math.floor(p.y + p.face.y * 1.1);
    if (mt && Math.hypot(mt[0] + 0.5 - p.x, mt[1] + 0.5 - p.y) <= 2.5) out.push(mt);
    out.push([fx, fy]);
    for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) out.push([fx + i, fy + j]);
    return out.find(ok) || null;
  }
  putAt([tx, ty]) {
    const g = this.game, p = g.player, sc = g.scene, id = this.held;
    if (BULKY[id].prey) this.setDay([tx, ty], this.day ?? g.days?.dayIndex ?? 0);
    sc.place(tx, ty, id, Math.abs(p.face.x) > Math.abs(p.face.y) ? 0 : 1);
    this.set(null);
  }
  // (the day of a carcass, by the chunk: d.carcass, which goes by the network and in the save like d.mown)
  dayAt([tx, ty]) { const w = this.game.world; return this.game.scene === w ? w.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))?.carcass?.[`${tx},${ty}`] ?? null : null; }
  setDay([tx, ty], day) {
    const w = this.game.world;
    if (this.game.scene !== w) return;
    const d = w.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK), day !== null);
    if (!d) return;
    if (day === null) { if (d.carcass) delete d.carcass[`${tx},${ty}`]; return; }
    (d.carcass ||= {})[`${tx},${ty}`] = day;
  }

  // ---------- where they come from ----------
  // A tree felled with the prototype: its log, lying where the tree falls (away from you), instead of the wood; the fruit
  // and the seeds as always. Tried: one tile on in that direction, the tree's own, and the two to the sides (never where
  // you stand). false: as before (no room, or no prototype)
  felled(o, rule) {
    const g = this.game, p = g.player, sc = g.scene;
    if (!this.bigNow || sc !== g.world || !p || !LOG_TREES.has(o.kind)) return false;
    let dx = o.x - p.x, dy = o.y - p.y;
    const l = Math.hypot(dx, dy);
    if (l < 0.05) { dx = p.face.x; dy = p.face.y; } else { dx /= l; dy /= l; }
    const sx = Math.round(dx), sy = Math.round(dy), ox = Math.floor(o.x), oy = Math.floor(o.y);
    const tile = [[ox + sx, oy + sy], [ox, oy], [ox - sy, oy + sx], [ox + sy, oy - sx]].find(([x, y]) => sc.canPlace(x, y, 'log', p));
    if (!tile) return false;
    sc.place(...tile, 'log', Math.abs(dx) > Math.abs(dy) ? 0 : 1);
    const rest = rule.drops.filter(([id]) => id !== 'madera');
    if (rest.length) g.gather.spawnDrops(o, { ...rule, drops: rest });
    return true;
  }
  // A hunted adult deer, boar, cow, sheep, goat or pig leaves its carcass where it fell (or next to it). false: as before
  hunted(type, x, y) {
    const g = this.game, w = g.world, id = CARCASS_OF[type];
    if (!id || !this.bigNow || g.scene !== w || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const tx = Math.floor(x), ty = Math.floor(y);
    const tile = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([i, j]) => [tx + i, ty + j]).find(([a, b]) => w.canPlace(a, b, id, g.player));
    if (!tile) return false;
    this.setDay(tile, g.days?.dayIndex ?? 0);
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
    const g = this.game, k = String(o.tile);
    g.gather.cooldown = COOLDOWN;
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
      if (c) out.push({ o, c });
    }
    return out;
  }
  // How many of a thing there are to build or craft with: in the backpack and, with the prototype, in the chests nearby
  // (looked at again at most twice a second: this is asked every frame)
  have(id) {
    const inv = this.game.inv, own = inv.count(id), p = this.game.player;
    if (!this.on || this.game.admin || inv.infinite || !p) return own;
    const now = performance.now();
    if (!this.near || now - this.near.t > 500 || this.near.sc !== this.game.scene || Math.hypot(this.near.x - p.x, this.near.y - p.y) > 1) {
      const n = new Map();
      for (const { c } of this.chests()) for (const s of c) if (s && ITEMS[s.id]) n.set(s.id, (n.get(s.id) || 0) + s.n);
      this.near = { t: now, x: p.x, y: p.y, sc: this.game.scene, n };
    }
    return own + (this.near.n.get(id) || 0);
  }
  // Pay a cost ([[id, n]…]): the backpack first, then the chests, the nearest first. It says what came from where
  spend(cost) {
    const g = this.game, inv = g.inv;
    if (!this.on || g.admin || inv.infinite) { for (const [m, n] of cost) inv.remove(m, n); return; }
    let chests = null;
    const from = [];
    for (const [m, need] of cost) {
      let n = need;
      const k = Math.min(n, inv.count(m));
      if (k) inv.remove(m, k);
      n -= k;
      if (n <= 0) continue;
      chests ||= this.chests();
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
    this.near = null;
    if (from.length) g.gather.float(from.join(' · '), '#fff3c0');
  }
}
