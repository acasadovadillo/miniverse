// Weeds and pests (phase R2-F, docs/planes/realismo/PLAN-R2-huerto.md §3.7, Decision 3: light). farm.js owns the garden and
// asks here what came to it every morning (dawn), only in the game that runs the world. Every roll is ihash of the day, the
// tile and the seed: living a morning again gives the same. What a chunk keeps:
//   d.weeds[k]    the day weeds came up on a tilled tile (moved on a day for each one nobody played: they wait too)
//   d.crops[k]    pk: how many times birds have pecked it; pd, pb: the last day something got at it and what: 'b' birds, 'r'
//                 rabbits, 's' slugs; dead: 'eaten' (a seedling a rabbit ate)
//   d.pkt[key]    how many times birds have pecked the fruit of a planted cherry tree (until it is picked)
//   d.shoo        { b, r }: the day somebody scared the birds, the rabbits off this chunk (visitors.js): fewer come next morning
//   d.garb[k]     what a scarecrow wears: { id, color?, tear? } (a garment, as it was in the bag)
//   ranch.farm.pests   the day they began to count in this world: none in the first mornings (PEST.grace)
// Fair play: nothing grows nor comes for a day nobody played in the world; nor in peaceful, with /gamerule doGardenPests false,
// playing alone in creative or with ?pests=0 on the host. At most a quarter of a chunk's crops in a morning (so a garden of
// three plants, none), and nothing but a seedling is ever lost: the rest gives less or ripens later.
import { CROPS } from './items.js';
import { CHUNK } from './world/gen.js';
import { dxOf, wrapX } from './world/planet.js';
import { PIECES, parsePlaced } from './pieces.js';
import { ihash } from './util.js';
import { apagada } from './opciones.js';
import { Profile } from './accounts.js';
import { FAMILY_TIRED } from './soil.js';

// crop, bare: the chance a day by season of the place (spring to winter) with a crop and without; slow, health, thirst: growth, the
// day's health and drying under them; grass: days until a bare tile goes back to grass; stages: the days they look bigger from; seeds: by hand
export const WEEDS = { crop: [0.06, 0.06, 0.02, 0], bare: [0.15, 0.15, 0.05, 0], slow: 0.7, health: 0.85, thirst: 1.2, grass: 10, stages: [2, 6] };
// p: the chance a day for each crop they like; cap: the share of a chunk's crops hit in a morning; grace: mornings of peace;
// shoo: what is left of the chance where they were scared off the day before; tired: on soil tired of a family; mark: days
// what they did shows; max: pecks a plant gets at most
export const PEST = {
  cap: 0.25, grace: 3, shoo: 0.3, tired: 2, mark: 3,
  b: { p: 0.08, from: 0.8, max: 2, R: 7, dressed: 0.25, bare: 0.6 },   // (R: of the scarecrow; what is left of the chance near one, dressed or not)
  r: { p: 0.05, R: 24, dog: 0.3 },
  s: { p: 0.06, R: 12, back: 0.5, cold: 3 },   // (cold: no slugs under this mean)
};
export const HARD = { peaceful: 0, easy: 0.6, normal: 1, hard: 1.4 };
export const BIRD_FOOD = new Set(['trigo', 'maiz', 'fresa']);
export const RABBIT_FOOD = new Set(['nabo', 'zanahoria', 'potato', 'cabbage', 'broad_bean']), RABBIT_NOT = new Set(['garlic']);   // (and any seedling, except)
export const SLUG_FOOD = new Set(['cabbage', 'fresa', 'broad_bean', 'nabo']);
export const SCARECROW = 'scarecrow', SHIRTS = new Set(['torso', 'encima', 'outer']);   // (what a scarecrow can wear: ITEMS[id].wear)
const SALT = { weed: 611, b: 617, r: 619, s: 631, tree: 641 };
export const ENCLOSED_MAX = 900;   // tiles a closed bed may have inside its fence
const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// A plant just come up: what a rabbit eats whole and a slug likes (a seed still in the ground, no)
export const seedling = c => !c.dead && c.grow >= 1 && c.grow < CROPS[c.id].days / 2;
export const birdsLike = c => BIRD_FOOD.has(c.id) && !c.dead && c.bolt === undefined && c.grow >= PEST.b.from * CROPS[c.id].days;
export const rabbitsLike = c => !c.dead && c.bolt === undefined && c.grow >= 1 && !RABBIT_NOT.has(c.id) && (RABBIT_FOOD.has(c.id) || seedling(c));
export const slugsLike = c => SLUG_FOOD.has(c.id) && seedling(c);
// How big weeds look, 1 to 3
export const weedStage = age => (age >= WEEDS.stages[1] ? 3 : age >= WEEDS.stages[0] ? 2 : 1);
// Which weeds grow on a tile (0 to 2) and how they are turned
export const weedKind = (tx, ty) => Math.floor(ihash(tx, ty, 73) * 3);
export const weedYaw = (tx, ty) => ihash(tx, ty, 79) * Math.PI * 2;
// The scarecrow's model: what kind of garment (s shirt, l long, v sleeveless), its colour and whether it is torn
const KIND = { tunica_larga: 'l', tunica: 'l', wool_coat: 'l', chaleco: 'v', delantal: 'v', leather_apron: 'v' };
export const scarecrowModel = g => (g?.id ? `scarecrow:${KIND[g.id] || 's'}:${/^#[0-9a-f]{6}$/i.test(g.color || '') ? g.color : '#8a7b5c'}:${g.tear >= 40 ? 1 : 0}` : 'scarecrow:0');

// Which tiles are closed in: the walk of a rabbit, from a bed outwards, over tiles with no fence, wall, closed gate, closed
// door, water nor hole. Everything one walk reaches shares its answer; made anew each morning (and each look of visitors.js).
// It goes between two fences that only touch at their corners: those leave a gap
export class Enclosure {
  constructor(world) { this.w = world; this.known = new Map(); this.bars = new Map(); this.chunks = new Map(); this.steps = 0; }
  key(tx, ty) { return (tx + 65536) * 131072 + (ty + 65536); }
  barred(tx, ty) {
    const id = this.key(tx, ty);
    let v = this.bars.get(id);
    if (v === undefined) this.bars.set(id, v = this.look(tx, ty));
    return v;
  }
  look(tx, ty) {
    const w = this.w, d = this.chunk(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)), k = `${tx},${ty}`, v = d?.placed?.[k] ?? w.baseAt?.('placed', tx, ty), p = v && PIECES[parsePlaced(v)[0]];
    if (p && (p.kind === 'fence' || p.kind === 'wall' || p.kind === 'post')) return true;
    if (p && (p.kind === 'gate' || p.kind === 'door')) return !!d?.closed?.[k];
    if (d?.dig?.[k] !== undefined) return true;
    return !!w.water?.(tx + 0.5, ty + 0.5);
  }
  chunk(cx, cy) {
    const id = this.key(cx, cy);
    let d = this.chunks.get(id);
    if (d === undefined) this.chunks.set(id, d = this.w.delta(cx, cy) || null);
    return d;
  }
  // Is this tile closed in?
  enclosed(tx0, ty0) {
    const seen = new Set(), list = [[tx0, ty0]];
    let shut = true;
    seen.add(this.key(tx0, ty0));
    for (let i = 0; i < list.length; i++) {
      const k = this.known.get(this.key(...list[i]));
      if (k !== undefined) { shut = k; break; }
      if (list.length > ENCLOSED_MAX) { shut = false; break; }
      for (const [dx, dy] of DIR8) {
        const tx = wrapX(list[i][0] + dx), ty = list[i][1] + dy, id = this.key(tx, ty);
        if (seen.has(id) || this.barred(tx, ty)) continue;
        seen.add(id); list.push([tx, ty]);
      }
    }
    this.steps += list.length;
    for (const id of seen) this.known.set(id, shut);
    return shut;
  }
  // The way in of a rabbit: tiles from far steps outside to this one, through a gap if there is a fence; null: closed in, or
  // nowhere to come from. way: the first direction it looks in (0..7); free(tx, ty): can it stand there?
  path(tx0, ty0, far, way, free) {
    const from = new Map(), list = [[tx0, ty0, 0]];
    from.set(this.key(tx0, ty0), null);
    for (let i = 0; i < list.length && list.length < 3000; i++) {
      const [x, y, n] = list[i];
      if (n >= far) {
        const out = [];
        for (let at = [x, y]; at; at = from.get(this.key(...at))) out.push(at);
        return out;
      }
      for (let q = 0; q < 8; q++) {
        const [dx, dy] = DIR8[(q + way) % 8], tx = wrapX(x + dx), ty = y + dy, id = this.key(tx, ty);
        if (from.has(id) || this.barred(tx, ty) || !free(tx, ty)) continue;
        from.set(id, [x, y]); list.push([tx, ty, n + 1]);
      }
    }
    return null;
  }
}

export class Pests {
  constructor(farm) { this.farm = farm; }
  get game() { return this.farm.game; }
  get world() { return this.farm.world; }
  get hard() { return HARD[this.game.difficulty] ?? 1; }
  // Can weeds grow and animals come on the morning of this day, in this world?
  on(day) {
    const g = this.game, from = g.ranch?.farm?.pests;
    return !apagada('pests') && this.hard > 0 && g.rules?.doGardenPests !== false && !(g.gamemode === 'creative' && !g.live?.joined && !Profile.server) && Number.isFinite(from) && day >= from + PEST.grace;
  }
  roll(salt, day, tx, ty) { return ihash(tx, ty, (this.world.seed | 0) + salt + day * 1009); }

  // ---------- weeds ----------
  // One tilled tile, one morning (grown: with a live crop on it). true: they have come up now
  weedUp(day, tx, ty, season, grown) { return this.roll(SALT.weed, day, tx, ty) < (grown ? WEEDS.crop : WEEDS.bare)[season]; }

  // ---------- the guards ----------
  // Something placed near a tile: the first that has(id, tile key, delta) says yes to, within R tiles (the chunks round it)
  near(tx, ty, R, has) {
    const c0 = Math.floor((tx - R) / CHUNK), c1 = Math.floor((tx + R) / CHUNK), r0 = Math.floor((ty - R) / CHUNK), r1 = Math.floor((ty + R) / CHUNK);
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const d = this.world.delta(cx, cy);
      for (const k in d?.placed) {
        if (!d.placed[k].startsWith(SCARECROW) || parsePlaced(d.placed[k])[0] !== SCARECROW) continue;
        const i = k.indexOf(','), x = +k.slice(0, i), y = +k.slice(i + 1);
        if (Math.hypot(dxOf(x, tx), y - ty) <= R && has(k, d)) return true;
      }
    }
    return false;
  }
  // What is left of the birds' chance by the scarecrows near
  scare(tx, ty) {
    const P = PEST.b;
    if (this.near(tx, ty, P.R, (k, d) => !!d.garb?.[k])) return P.dressed;
    return this.near(tx, ty, P.R, () => true) ? P.bare : 1;
  }
  // An animal of the ranch that lives near: the dog for the rabbits, the ducks for the slugs
  lives(type, tx, ty, R) {
    for (const a of this.game.ranch?.animals || []) if (a.type === type && a.home && !a.stray && Math.hypot(dxOf(a.home[0], tx), a.home[1] - ty) <= R) return true;
    return false;
  }
  dog(tx, ty) { return this.lives('perro', tx, ty, PEST.r.R); }
  ducks(tx, ty) { return this.lives('pato', tx, ty, PEST.s.R); }
  roofed(tx, ty) { return !!this.world.roofAt?.(tx, ty); }

  // ---------- the morning ----------
  // What came to the gardens in the night before day. wet: did it rain on the day before at a chunk; its season and mean
  dawn(day) {
    if (!this.on(day) || !this.farm.playedOn(day - 1)) return;
    const w = this.world, fence = new Enclosure(w), F = {};
    for (const [ck, d] of w.deltas) {
      if (ck.startsWith('u:') || !(d.crops || d.trees)) continue;
      const [cx, cy] = ck.split(',').map(Number);
      let n = 0, hits = null, field = false;
      for (const k in d.crops) {
        const c = d.crops[k];
        if (!c || c.dead || !CROPS[c.id]) continue;
        n++;
        const by = this.who(d, c, k, day);
        if (!by) continue;
        if (!field) { this.farm.fieldAt(day - 1, cx * CHUNK, cy * CHUNK, F); field = true; }
        if (this.stopped(by, d, k, day, F, fence)) continue;
        (hits ||= []).push(by);
      }
      const cap = Math.floor(n * PEST.cap);
      if (hits && cap) {
        hits.sort((a, b) => a.roll - b.roll || (a.k < b.k ? -1 : 1));
        for (const h of hits.slice(0, cap)) this.hit(h.c, h.by, day);
        w.touch(cx, cy);
      }
      if (d.trees) this.cherries(d, cx, cy, day);
      if (d.shoo && !(d.shoo.b >= day - 1) && !(d.shoo.r >= day - 1)) delete d.shoo;
    }
  }
  // Who would come for this crop, by its own roll alone (the cheap part): { by, k, c, tx, ty, roll, k2 }, or null
  who(d, c, k, day) {
    const b = birdsLike(c) && (c.pk || 0) < PEST.b.max, r = rabbitsLike(c), s = slugsLike(c);
    if (!b && !r && !s) return null;
    const i = k.indexOf(','), tx = +k.slice(0, i), ty = +k.slice(i + 1), soil = d.soil?.[k], K = this.hard * (soil && soil[2] >= FAMILY_TIRED ? PEST.tired : 1);
    if (r) { const roll = this.roll(SALT.r, day, tx, ty); if (roll < PEST.r.p * K) return { by: 'r', k, c, tx, ty, roll, p: PEST.r.p * K }; }
    if (b) { const roll = this.roll(SALT.b, day, tx, ty); if (roll < PEST.b.p * K) return { by: 'b', k, c, tx, ty, roll, p: PEST.b.p * K }; }
    if (s) { const roll = this.roll(SALT.s, day, tx, ty); if (roll < PEST.s.p * K) return { by: 's', k, c, tx, ty, roll, p: PEST.s.p * K }; }
    return null;
  }
  // And what keeps it off: the same roll against what is left of its chance
  stopped(h, d, k, day, F, fence) {
    let p = h.p;
    if (h.by === 'b') {
      if (this.roofed(h.tx, h.ty)) return true;
      if (d.shoo?.b === day - 1) p *= PEST.shoo;
      if (h.roll < p) p *= this.scare(h.tx, h.ty);
    } else if (h.by === 'r') {
      if (d.shoo?.r === day - 1) p *= PEST.shoo;
      if (h.roll < p && this.dog(h.tx, h.ty)) p *= PEST.r.dog;
      if (h.roll < p && fence.enclosed(h.tx, h.ty)) return true;
    } else {
      if (F.season === 3 || F.mean < PEST.s.cold || !this.farm.rained(F.weather) || this.roofed(h.tx, h.ty)) return true;
      if (this.ducks(h.tx, h.ty)) return true;
    }
    return h.roll >= p;
  }
  hit(c, by, day) {
    const days = CROPS[c.id].days, back = n => { c.grow = Math.round(Math.max(1, c.grow - n) * 1000) / 1000; if (c.grow < days) delete c.ripe; };
    if (by === 'b') c.pk = (c.pk || 0) + 1;
    else if (by === 'r') { if (seedling(c)) c.dead = 'eaten'; else back(1); }
    else back(PEST.s.back);
    c.pd = day; c.pb = by;
  }
  // The birds on the fruit of the cherry trees somebody planted
  cherries(d, cx, cy, day) {
    let any = false;
    for (const k in d.trees) {
      const t = d.trees[k];
      if (t?.kind !== 'cherry') continue;
      const i = k.indexOf(','), tx = +k.slice(0, i), ty = +k.slice(i + 1), tk = 'tree:' + k, at = d.pkt?.[tk] || 0;
      const p = PEST.b.p * this.hard * (d.shoo?.b === day - 1 ? PEST.shoo : 1), roll = this.roll(SALT.tree, day, tx, ty);
      if (at >= PEST.b.max || roll >= p || !this.farm.fruitOn(d, t, tk, tx, ty, day) || roll >= p * this.scare(tx, ty)) continue;
      (d.pkt ||= {})[tk] = at + 1;
      any = true;
    }
    if (any) this.world.touch(cx, cy);
  }

  // ---------- what it says ----------
  // Round a place: how many tiles have weeds and how many plants something got at this morning
  count(x, y, R, day) {
    let weeds = 0;
    for (const [ck, d] of this.world.deltas) {
      if (!d.weeds || ck.startsWith('u:')) continue;
      const i = ck.indexOf(',');
      if (Math.abs(dxOf((+ck.slice(0, i) + 0.5) * CHUNK, x)) > R || Math.abs((+ck.slice(i + 1) + 0.5) * CHUNK - y) > R) continue;
      for (const k in d.weeds) if (d.tilled?.[k] !== undefined) weeds++;
    }
    return { weeds, hits: this.news([[x, y]], R, day).n };
  }
  // What came this morning to the gardens within R of any of these places ([x, y]…): { b, r, s: Map crop → how many, n }
  news(places, R, day) {
    const out = { b: new Map(), r: new Map(), s: new Map(), n: 0, at: null };
    for (const [ck, d] of this.world.deltas) {
      if (!d.crops || ck.startsWith('u:')) continue;
      const i = ck.indexOf(','), x = (+ck.slice(0, i) + 0.5) * CHUNK, y = (+ck.slice(i + 1) + 0.5) * CHUNK;
      if (!places.some(([px, py]) => Math.abs(dxOf(x, px)) <= R && Math.abs(y - py) <= R)) continue;
      for (const k in d.crops) {
        const c = d.crops[k];
        if (c?.pd !== day || !out[c.pb] || !CROPS[c.id]) continue;
        out[c.pb].set(c.id, (out[c.pb].get(c.id) || 0) + 1);
        out.n++;
        (out.at ||= {})[c.pb] = k.split(',').map(Number);
      }
    }
    return out;
  }
}
