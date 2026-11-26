// The smugglers' strongbox (docs/planes/gta/PLAN-I-juntos.md §1.5): Inés found a map torn in two. Old smugglers hid an
// iron-bound box near a camp or a tower before the village existed; nobody is robbed (the law never hears of it: law.js is
// not called from here). The "heist" is getting it out from under its guards.
//
// The stages: 'map' (the halves together), 'site' (dig at the mark: 3 blocks down with the shovel, so 3 digs and 3 loads
// of earth dropped aside), 'carry' (to Bruno's anvil, beside his forge, where the lock is broken: 3 s). Joining closes once
// the box is out.
//   j.data: { halves: { a, b } (who holds each one: a player's id, or 'chest'), chest: { key, x, y, name } (the camp or the
//     tower where a half waits in its chest), joined (the two halves put together: the mark is on the crew's maps),
//     tile: [tx, ty] (the dig), posts: [[x, y, type]], down: [guards killed], depth, found?: { by, at, night, got } }
//   the items map_half_a / map_half_b are only its tokens: each game keeps them as the job says (tokens()).
// The guards: night only (they burn in the sun, mobs.js), 3 to 5 mobs of the job's (m.guard = its id) asleep round the
// mark; whoever decides wakes them with the noise it works out from what it already knows of each player (loud: a gait
// faster than walking and not crouched, a horse, a tool's blow, within 9 tiles; a bark or a thud within 6). A rattle
// thrown with the left button lands as an ordinary drop (extra.lure): for LURE_S it wakes the guards within 9 and pulls the
// woken ones (mobs.js lureFor). Peaceful: no guards. No marker in the world over the box: the mark is only the job's own (its
// gold mark and the maps, for its crew).
// Loot: the same for each one of the crew there at the end, rolled once by whoever decides when the lock breaks (done.loot):
// 300-600 coins (half as much more if it was dug up by night, with the guards there), 1-2 gems and an old coin; who started
// it also keeps the empty box (strongbox_open, a trophy).
import { B } from '../world/biomes.js';
import { WALK_NODES } from '../world/village.js';
import { wrapX, dxOf } from '../world/planet.js';
import { DIFF } from '../combat.js';
import { DARK } from '../mobs.js';
import { EVENT } from '../senses.js';
import { Profile } from '../accounts.js';
import { ihash } from '../util.js';
import { madridMs } from '../time.js';
import { Audio } from '../audio.js';
import { hud } from '../ui/hud.js';
import { t } from '../i18n.js';

export const WINDOW = 2 * 864e5, RING = [150, 300], DIGS = 3, LOOT = [300, 600], NIGHT_K = 1.5, GEMS = ['amatista', 'esmeralda', 'rubi'];
export const WAKE_R = 9, EVENT_R = 6, LURE_WAKE = 9;
export const JOIN_R = 4, CHEST_R = 3, FORGE_R = 2.6, BREAK_S = 3, HELP_R = 2.5, HELP_SLOW = 0.8, THROW = [3, 16];
export const ANVIL = [12.5, 56.3];   // (Bruno's anvil, before him at his forge: world/village.js)
const KINDS_AT = ['campamento', 'torre'], SPAWN_R = 40, FOUND_R = 8, HEAR_EVERY = 0.25, DIG_EVERY = 0.5, GOT_EVERY = 5;
const TOOLS = new Set(['pala', 'pico', 'hacha', 'azada', 'hammer']);
const SOIL = new Set([B.MEADOW, B.FOREST, B.PINES, B.SWAMP]), STEEP = 0.4;   // (where the shovel digs, as world/scenes.js digWhy: earth and grass, not too steep)
const FORGE = WALK_NODES.forge;
const me = () => Profile.id || 'me';
const r2 = v => Math.round(v * 100) / 100;
export const strHash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h | 0; };
const distVillage = (x, y) => Math.hypot(dxOf(x, FORGE[0]), y - FORGE[1]);
const states = new Map();   // job → (whoever decides) { ears: player → their last look (loud), hearT, digT, mySwing }
const stateOf = j => { let s = states.get(j.id); if (!s) { if (states.size > 6) states.clear(); states.set(j.id, (s = { hearT: 0, digT: 0, mySwing: null, ears: null })); } return s; };
const local = { breaking: null, gotT: -9, told: new Map() };   // (this player: the lock being broken; the last 'got' asked; what was said)
export const dbgLocal = local;   // (the tests)

// Where somebody of the crew is now ([x, y]), or null (not in the world, or not playing)
export function posOf(g, id) {
  if (id === me() && !Profile.server) { const p = g.player; return p && g.scene === g.world ? [p.x, p.y] : null; }
  for (const q of g.live?.peers?.values() || []) if (q.id === id && q.playing && q.sc === 'world') { const e = q.entity, at = e ? e.to || [e.x, e.y] : q.at; return Array.isArray(at) ? [at[0], at[1]] : null; }
  return null;
}
const within = (a, x, y, r) => !!a && Math.hypot(dxOf(a[0], x), a[1] - y) <= r;
// Guards on in this world: survival rules with creatures (not peaceful, not with /gamerule doMobSpawning false)
export const guardsOn = g => !!g.rules?.doMobSpawning && (DIFF[g.difficulty] || DIFF.normal).cap > 0;
const nightAt = (g, x) => g.mobs.sky(x) <= DARK;
export const guardsOf = (g, j) => g.mobs.list.filter(m => m.guard === j.id);
// Do you hold the strongbox? In the arms (the weight inventory) or in the backpack (the slot inventory)
export const hasBox = g => g.carry?.held === 'strongbox' || (!g.inv?.weight && (g.inv?.count('strongbox') || 0) > 0);
function takeBox(g) {
  if (g.carry?.held === 'strongbox') g.carry.set(null);
  else if (!g.inv.weight) g.inv.remove('strongbox', 1);
  g.onSave?.();
}

// The camp or tower: a known one with its chest (the asker's), else the nearest to the village
function pickChest(g, keys, seed) {
  const ok = [];
  for (const k of Array.isArray(keys) ? keys.slice(0, 24) : []) { const p = typeof k === 'string' && /^-?\d+,-?\d+$/.test(k) ? g.places.poiOf(k) : null; if (p && KINDS_AT.includes(p.kind) && distVillage(p.x, p.y) < 900) ok.push(p); }
  if (!ok.length) { const p = g.places.nearest(FORGE[0], FORGE[1], KINDS_AT, 700); if (p) ok.push(p); }
  return ok.length ? ok[Math.floor(ihash(seed, ok.length, 6101) * ok.length)] : null;
}
// The site: a camp or a tower 150-300 tiles off (wider if none), not the chest's
function pickSite(g, seed, skip) {
  for (const far of [RING[1], 450, 650]) {
    const L = g.places.sites.near(FORGE[0], FORGE[1], far, KINDS_AT).filter(s => s.key !== skip && distVillage(s.x, s.y) >= RING[0]).sort((a, b) => (a.key < b.key ? -1 : 1));
    const from = Math.floor(ihash(seed, far, 6103) * L.length);
    for (let i = 0; i < L.length; i++) { const p = g.places.poiOf(L[(from + i) % L.length].key); if (p && KINDS_AT.includes(p.kind)) return p; }
  }
  return null;
}
// The tile to dig: 9-16 tiles from the place, on dry earth or grass the shovel may dig (not water, rock, a steep slope, a
// hamlet or what the place keeps clear)
function pickTile(g, p, seed) {
  const w = g.world, ok = (tx, ty) => {
    const x = tx + 0.5, y = ty + 0.5;
    if (w.natWater(x, y) || !SOIL.has(w.gen.biomeAt(x, y)) || g.places.inAldea?.(x, y, 4) || g.places.blocks?.(tx, ty)) return false;
    if ([[2, 0], [-2, 0], [0, 2], [0, -2]].some(([i, k]) => w.natWater(x + i, y + k))) return false;
    const c = [w.cornerH(tx, ty), w.cornerH(tx + 1, ty), w.cornerH(tx, ty + 1), w.cornerH(tx + 1, ty + 1)];
    if (Math.max(...c) - Math.min(...c) > STEEP) return false;
    // (nothing growing or lying on it: a tree, a bush, a rock. Its chunk is made for that, once, when the job is taken)
    return !w.harvestablesNear(x, y).some(o => !o.flower && Math.abs(o.x - x) < 1.2 && Math.abs(o.y - y) < 1.2);
  };
  for (let i = 0; i < 64; i++) {
    const a = ihash(seed, i, 6107) * Math.PI * 2, r = 9 + ihash(seed, i, 6109) * 7, tx = Math.floor(wrapX(p.x + Math.cos(a) * r)), ty = Math.floor(p.y + Math.sin(a) * r);
    if (ok(tx, ty) && [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([i2, k]) => ok(tx + i2, ty + k)).length >= 3) return [tx, ty];
  }
  return null;
}

export const strongbox = {
  id: 'strongbox', giver: 'ines', pay: LOOT[0], ms: WINDOW,
  stages: ['map', 'site', 'carry'],
  closed: j => j.stage === 'carry',
  params: (g, j) => ({ place: j.data.chest?.name || '', site: j.site?.name || '', n: Math.min(DIGS, j.data.depth || 0), m: DIGS }),
  // (the asker's) The camps and towers they know, the nearest first
  propose(g) {
    const L = g.places.knownPlaces().filter(p => KINDS_AT.includes(p.kind)).map(p => [p.key, distVillage(p.x, p.y)]).filter(q => q[1] < 900).sort((a, b) => a[1] - b[1]);
    return { chests: L.slice(0, 12).map(q => q[0]) };
  },
  start(g, j, c) {
    const seed = ((g.world.seed | 0) ^ strHash(j.id)) | 0, chest = pickChest(g, c.chests, seed);
    if (!chest) return false;
    const p = pickSite(g, seed, chest.key), tile = p && pickTile(g, p, seed);
    if (!tile) return false;
    const n = 3 + Math.floor(ihash(seed, 1, 6113) * 3), posts = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + ihash(seed, i, 6117), r = 2.6 + ihash(seed, i, 6119) * 1.6; posts.push([r2(wrapX(tile[0] + 0.5 + Math.cos(a) * r)), r2(tile[1] + 0.5 + Math.sin(a) * r), ihash(seed, i, 6121) < 0.5 ? 'limo' : 'esqueleto']); }
    j.site = { x: tile[0] + 0.5, y: tile[1] + 0.5, poi: p.key, name: g.places.nameOf(p) };
    j.data = { halves: { a: c.by, b: 'chest' }, chest: { key: chest.key, x: r2(chest.x), y: r2(chest.y), name: g.places.nameOf(chest) }, tile, posts, down: [], depth: 0 };
    states.delete(j.id);
    return true;
  },
  // (whoever decides) Somebody joins: with the halves still apart, the one in the chest is theirs
  entered(g, j, by) {
    const H = j.data.halves;
    if (j.stage === 'map' && !j.data.joined && H && H.a !== by && H.b === 'chest') j.data = { ...j.data, halves: { ...H, b: by } };
  },
  quitted(g, j, by) { this.halvesBack(g, j, id => id === by); },
  // A half held by somebody gone (or away for a while) goes back to the chest
  halvesBack(g, j, gone) {
    const H = j.data.halves;
    if (!H || j.data.joined) return false;
    const a = gone(H.a) ? 'chest' : H.a, b = gone(H.b) ? 'chest' : H.b;
    if (a === H.a && b === H.b) return false;
    j.data = { ...j.data, halves: { a, b } };
    return true;
  },
  // ---------- each step, whoever decides ----------
  update(g, j, dt) {
    const M = g.missions, D = j.data, S = stateOf(j);
    if (j.stage === 'map') {
      if (this.halvesBack(g, j, id => id !== 'chest' && (!j.crew.includes(id) || M.isAway(j, id)))) M.changed();
      return;
    }
    if (j.stage === 'carry') {
      // (the finder went away before the box reached their game: it is for whoever of the crew is near the hole)
      const F = D.found;
      if (F && !F.got && (M.isAway(j, F.by) || !j.crew.includes(F.by))) { const by = this.nearest(g, j, FOUND_R * 3); if (by && by !== F.by) { j.data = { ...D, found: { ...F, by } }; M.changed(); } }
      return;
    }
    // 'site': the guards at night, what they hear, and the hole
    const [tx, ty] = D.tile, x = j.site.x, y = j.site.y, ps = g.mobs.players().filter(q => q.gm !== 'spectator'), near = ps.some(q => Math.hypot(dxOf(q.x, x), q.y - y) < SPAWN_R);
    if (near && guardsOn(g) && nightAt(g, x)) this.post(g, j);
    if (near) this.hear(g, j, S, ps, dt);
    if ((S.digT -= dt) > 0) return;
    S.digT = DIG_EVERY;
    const depth = Math.max(0, Math.min(DIGS, Math.round(g.world.digDepth(tx, ty))));
    if (depth !== (D.depth || 0)) { j.data = { ...j.data, depth }; M.changed(); }
    if (depth < DIGS) return;
    const by = this.nearest(g, j, FOUND_R);
    if (!by) return;
    const night = guardsOn(g) && nightAt(g, x) && D.posts.length > (D.down || []).length;
    j.data = { ...j.data, found: { by, at: madridMs(), night, got: false } };
    M.stage(j, 'carry');
  },
  // Who of the crew (not away) is nearest the hole, within r
  nearest(g, j, r) {
    let best = null, bd = r;
    for (const id of g.missions.here(j)) { const a = posOf(g, id), d = a ? Math.hypot(dxOf(a[0], j.site.x), a[1] - j.site.y) : Infinity; if (d <= bd) { bd = d; best = id; } }
    return best;
  },
  // The guards that are missing, back at their posts, asleep (those killed stay dead)
  post(g, j) {
    const D = j.data, have = new Set(guardsOf(g, j).map(m => m.gi));
    D.posts.forEach(([x, y, type], i) => {
      if (have.has(i) || (D.down || []).includes(i)) return;
      const m = g.mobs.summon(type, x, y);
      Object.assign(m, { guard: j.id, gi: i, post: [x, y], sleep: true, calm: 0 });
    });
  },
  // 4 times a second: noise near a sleeping guard wakes it
  hear(g, j, S, ps, dt) {
    const G = guardsOf(g, j);
    // (your own blows, as the host: each swing that starts)
    const sw = g.gather?.swing || 0, mine = S.mySwing !== null && sw > S.mySwing + 0.1 && !!g.player && !Profile.server;   // (a blow begins: the swing jumps up)
    S.mySwing = sw;
    if (mine && G.length && TOOLS.has(String(g.gather.swingItem || '').split('_')[0])) { const q = ps.find(o => o.me); if (q) for (const m of G) if (m.sleep && Math.hypot(dxOf(q.x, m.x), q.y - m.y) < WAKE_R) { m.woke = 'blow'; g.mobs.wake(m); } }
    if ((S.hearT -= dt) > 0) return;
    S.hearT = HEAR_EVERY;
    const Z = G.filter(m => m.sleep);
    if (!Z.length) return;
    // (only who is within earshot of one asleep is looked at: the rest cost nothing)
    const now = g.time, loud = [], R = (S.ears ||= new Map());
    for (const q of ps) if (Z.some(m => Math.abs(dxOf(q.x, m.x)) + Math.abs(q.y - m.y) < WAKE_R * 1.5) && this.loud(q, R, now)) loud.push(q);
    const E = g.wildlife?.presence?.events || [], lures = g.mobs.lures();
    for (const m of Z) {
      // (why it woke, m.woke: for the tests)
      const wake = (loud.some(q => Math.hypot(dxOf(q.x, m.x), q.y - m.y) < WAKE_R) && 'noise') || (E.some(v => now - v.t < 0.6 && v.n >= EVENT.drop && Math.hypot(dxOf(v.x, m.x), v.y - m.y) < EVENT_R) && 'event') || (lures.some(d => Math.hypot(dxOf(d.x, m.x), d.y - m.y) < LURE_WAKE) && 'lure');
      if (wake) { m.woke = wake; g.mobs.wake(m); }
    }
  },
  // Is this player making noise now? Faster than walking and not crouched (by their gait, or by how far they went since
  // the last look), on a horse or swimming hard; another's tool blow (their swings, already in their messages). R: key → the last look
  loud(q, R, now) {
    const e = q.e || q, key = q.me ? 'me' : q.conn, r = R.get(key) || {}, dt = now - (r.t ?? -9);
    const speed = dt > 0.01 && dt < 1.5 ? Math.hypot(dxOf(q.x, r.x), q.y - r.y) / dt : 0;
    let noisy = !e.crouch && !e.pose && speed > 0.35 && speed < 15 && (!!e.mount || (e.gait ?? (speed > 4 ? 1 : 0)) >= 1);
    if (!q.me) { const s = e.swing || 0; if (r.sw !== undefined && s > r.sw && TOOLS.has(String(e.swingItem || e.held || '').split('_')[0])) noisy = true; r.sw = s; }
    r.x = q.x; r.y = q.y; r.t = now;
    if (R.size > 16) R.clear();
    R.set(key, r);
    return noisy;
  },
  // ---------- what the players ask for ----------
  onEvent(g, j, ev, by) {
    const M = g.missions, D = j.data, at = posOf(g, by);
    if (ev === 'chest') {
      const H = D.halves;
      if (j.stage !== 'map' || D.joined || !H || !within(at, D.chest.x, D.chest.y, CHEST_R + 5)) return false;
      if (H.a !== 'chest' && H.b !== 'chest') return H.a === by || H.b === by;   // (asked twice: already theirs)
      const a = H.a === 'chest' ? by : H.a, b = H.b === 'chest' ? by : H.b;
      j.data = { ...D, halves: { a, b } };
      if (a === b) this.joinUp(g, j);
      return true;
    }
    if (ev === 'join_halves') {
      const H = D.halves;
      if (D.joined) return j.stage !== 'map';
      if (j.stage !== 'map' || !H || (H.a !== by && H.b !== by)) return false;
      const other = H.a === by ? H.b : H.a;
      if (other === 'chest' || M.isAway(j, other)) return false;
      const b = posOf(g, other);
      if (!at || !b || Math.hypot(dxOf(at[0], b[0]), at[1] - b[1]) > JOIN_R + 1) return false;
      this.joinUp(g, j);
      return true;
    }
    if (ev === 'got') {
      const F = D.found;
      if (!F || F.by !== by) return false;
      if (!F.got) j.data = { ...D, found: { ...F, got: true } };
      return true;
    }
    if (ev === 'open') {
      if (j.stage !== 'carry' || j.done) return !!j.done && j.done.by === by;
      if (!within(at, ANVIL[0], ANVIL[1], FORGE_R + 1.5)) return false;
      M.finish(j, 'ok', { by, night: !!D.found?.night, loot: this.roll(g, j) });
      return true;
    }
    return false;
  },
  joinUp(g, j) { j.data = { ...j.data, joined: true }; g.missions.stage(j, 'site'); },
  // The loot, rolled once (the same list for each one of the crew)
  roll(g, j) {
    const s = ((g.world.seed | 0) ^ strHash(j.id)) | 0, night = !!j.data.found?.night;
    const coins = Math.round((LOOT[0] + Math.floor(ihash(s, 7, 6131) * (LOOT[1] - LOOT[0] + 1))) * (night ? NIGHT_K : 1));
    const items = [];
    for (let i = 0, n = ihash(s, 8, 6133) < 0.5 ? 1 : 2; i < n; i++) items.push([GEMS[Math.floor(ihash(s, 9 + i, 6137) * GEMS.length)], 1]);
    items.push(['moneda_antigua', 1]);
    return { coins, items };
  },
  reward(j) {
    const L = j.done?.loot, items = Array.isArray(L?.items) ? L.items.filter(q => Array.isArray(q) && typeof q[0] === 'string' && q[1] > 0 && q[1] <= 3).map(q => [q[0], q[1] | 0]) : [];
    if (j.by === me()) items.push(['strongbox_open', 1]);
    return { coins: Math.max(0, Math.min(LOOT[1] * NIGHT_K, L?.coins | 0)), items };
  },
  finished(g, j) { this.end(g, j); },
  end(g, j) { if (g.missions.decides()) for (const m of guardsOf(g, j)) { if (m.sleep) g.mobs.remove(m); else { m.guard = null; m.post = null; } } states.delete(j.id); },
  load(g, j) { states.delete(j.id); },

  // ---------- this player ----------
  goal(g, j) {
    const D = j.data;
    if (j.stage === 'map') { const H = D.halves || {}; return H.a === 'chest' || H.b === 'chest' ? { x: D.chest.x, y: D.chest.y } : null; }
    if (j.stage === 'site') return { x: j.site.x, y: j.site.y };
    return hasBox(g) ? { x: ANVIL[0], y: ANVIL[1] } : null;
  },
  line(g, j) {
    const D = j.data, P = this.params(g, j);
    if (j.stage === 'map') {
      const H = D.halves || {}, mine = H.a === me() || H.b === me();
      if (H.a === 'chest' || H.b === 'chest') return t('job.strongbox.stage.chest_at', P);
      return t(mine ? 'job.strongbox.stage.join' : 'job.strongbox.stage.wait', P);
    }
    if (j.stage === 'site') {
      const n = this.sleepersNear(g, j);
      return `${t('job.strongbox.stage.site_at', P)} · ${t('job.strongbox.dug', P)}${n ? ` · ${t('job.strongbox.guards', { n })}` : ''}`;
    }
    return t(hasBox(g) ? 'job.strongbox.stage.carry' : 'job.strongbox.stage.carry_other', P);
  },
  sleepersNear(g, j) { let n = 0; for (const m of g.mobs.list) if (m.sleep && Math.hypot(dxOf(m.x, j.site.x), m.y - j.site.y) < 8) n++; return n; },
  // (twice a second, for the job you are in) The box once dug up; guards waking; asking again what was lost on the way
  tell(g, j) {
    const D = j.data, M = g.missions;
    if (j.stage === 'carry' && D.found?.by === me()) {
      if (!M.mineOf(j.id).box) this.giveBox(g, j);
      else if (!D.found.got && g.time - local.gotT > GOT_EVERY) { local.gotT = g.time; M.event('got'); }
    }
    if (j.stage === 'site') {
      const n = this.sleepersNear(g, j), was = local.told.get(j.id);
      if (was !== undefined && n < was && g.player && Math.hypot(dxOf(j.site.x, g.player.x), j.site.y - g.player.y) < 30) { hud.feed?.push?.({ kind: 'world', key: 'guard', text: t('job.strongbox.woke') }); Audio.error(); }
      local.told.set(j.id, n);
    }
  },
  // The box comes out of the hole: into your arms (with the weight inventory), into the backpack (the slot one) or on the
  // ground beside the hole. Once (mineOf: kept in the save)
  giveBox(g, j) {
    const M = g.missions, mine = M.mineOf(j.id), C = g.carry, p = g.player;
    if (!p || mine.box) return;
    mine.box = g.days.realDay;
    let ok = false;
    if (C?.bigNow && !C.held && !g.barrow?.pushing) { C.set('strongbox'); ok = true; }
    else if (!g.inv.weight) ok = g.inv.add('strongbox', 1) === 0;
    if (!ok) {
      const [tx, ty] = j.data.tile, w = g.world;
      const at = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]].map(([i, k]) => [tx + i, ty + k]).find(([a, b]) => w.canPlace?.(a, b, 'strongbox', null));
      if (at) w.place(at[0], at[1], 'strongbox', 0);
    }
    hud.toast(t('job.strongbox.found'), 'good');
    Audio.unlock();
    g.gather?.chips?.(j.site.x, j.site.y, 'dirt', 16);
    local.gotT = g.time;
    M.event('got');
    g.onSave?.();
  },
  // (twice a second, with or without a job) The map halves as the jobs say; the end, seen by the one who broke the lock (the
  // box goes, once, even if the answer got lost on the way); the lock being broken. true: call again soon
  each(g) {
    const M = g.missions;
    this.tokens(g);
    for (const j of M.jobs()) {
      if (j.kind !== 'strongbox' || !j.done || j.done.outcome !== 'ok' || j.done.by !== me()) continue;
      const mine = M.mineOf(j.id);
      if (!mine.opened && hasBox(g)) { mine.opened = g.days.realDay; takeBox(g); }
    }
    const L = local.breaking;
    if (!L) return false;
    const p = g.player;
    if (!p || !hasBox(g) || Math.hypot(dxOf(ANVIL[0], p.x), ANVIL[1] - p.y) > FORGE_R + 0.6 || g.scene !== g.world) { local.breaking = null; return false; }
    if (g.time - L.t0 < BREAK_S) { Audio.clink(); g.gather?.chips?.(ANVIL[0], ANVIL[1], 'stone', 4); return true; }
    local.breaking = null;
    if (!L.jid) { takeBox(g); hud.toast(t('job.strongbox.empty'), 'warn'); return false; }
    M.event('open', {}, ok => {
      if (!ok) { Audio.error(); hud.toast(t('job.strongbox.no_open'), 'warn'); return; }
      const mine = M.mineOf(L.jid);
      if (!mine.opened && hasBox(g)) { mine.opened = g.days.realDay; takeBox(g); }
      Audio.unlock();
    });
    return false;
  },
  // What the cursor offers: the partner (putting the halves together) and the anvil (breaking the lock)
  aimables(g, p, box) {
    const M = g.missions, j = M.active, out = [];
    if (j?.kind === 'strongbox' && j.stage === 'map' && !j.data.joined) {
      const H = j.data.halves || {}, held = g.inv?.held?.id, other = H.a === me() ? H.b : H.b === me() ? H.a : null;
      if (other && other !== 'chest' && (held === 'map_half_a' || held === 'map_half_b')) {
        for (const q of g.live?.peers?.values() || []) if (q.id === other && q.entity && q.sc === 'world' && Math.hypot(dxOf(q.entity.x, p.x), q.entity.y - p.y) <= JOIN_R) {
          const e = q.entity;
          out.push({ kind: 'sys', e: null, join: true, box: box(e.x, e.y, 0.4, 0.4, 0, 1.75), act: () => this.joinAct(g) });
        }
      }
    }
    if (hasBox(g) && Math.hypot(dxOf(ANVIL[0], p.x), ANVIL[1] - p.y) <= FORGE_R + 1) out.push({ kind: 'sys', e: null, box: box(ANVIL[0], ANVIL[1], 0.45, 0.3, 0, 0.9), act: () => this.anvilAct(g) });
    return out;
  },
  joinAct(g) { return { text: t('job.strongbox.join_halves'), run: () => g.missions.event('join_halves', {}, ok => { if (ok) { Audio.unlock(); hud.toast(t('job.strongbox.joined'), 'good'); } else Audio.error(); }) }; },
  // (without a cursor: the anvil, or the partner with the other half within reach)
  interact(g, p) {
    if (hasBox(g) && Math.hypot(dxOf(ANVIL[0], p.x), ANVIL[1] - p.y) <= FORGE_R) return this.anvilAct(g);
    return this.aimables(g, p, () => null).find(a => a.join)?.act() || null;
  },
  anvilAct(g) {
    const M = g.missions, j = M.active, ours = j?.kind === 'strongbox' && j.stage === 'carry';
    // (somebody else's box, of a job going on: give it back to them)
    if (!ours && M.running().some(q => q.kind === 'strongbox' && q.stage === 'carry')) return { text: t('job.strongbox.not_yours'), run: () => Audio.error() };
    if (local.breaking) return { text: t('job.strongbox.breaking'), run: () => {} };
    return { text: t('job.strongbox.break'), run: () => { local.breaking = { t0: g.time, jid: ours ? j.id : null }; Audio.clink(); } };
  },
  // E on the chest of the camp or the tower with a half in it (before its own loot)
  chestAct(g, j, poi) {
    if (j?.kind !== 'strongbox' || j.stage !== 'map' || j.data.chest?.key !== poi.key) return null;
    const H = j.data.halves || {};
    if (H.a !== 'chest' && H.b !== 'chest') return null;
    return { text: t('job.strongbox.chest_take'), run: () => g.missions.event('chest', {}, ok => { if (ok) { Audio.pickup(); hud.toast(t('job.strongbox.half_found'), 'good'); } else Audio.error(); }) };
  },
  // The map halves you hold as the jobs say: given, or taken away (a token of a job that is no more, or not yours now)
  tokens(g) {
    const inv = g.inv, M = g.missions;
    if (!inv || !g.player) return;
    const want = new Set();
    for (const j of M.running()) if (j.kind === 'strongbox' && j.crew.includes(me())) { const H = j.data.halves || {}; if (H.a === me()) want.add(`map_half_a|${j.id}`); if (H.b === me()) want.add(`map_half_b|${j.id}`); }
    const have = new Set();
    let changed = false;
    inv.slots.forEach((s, i) => {
      if (s?.id !== 'map_half_a' && s?.id !== 'map_half_b') return;
      const k = `${s.id}|${s.job}`;
      if (!want.has(k) || have.has(k)) { inv.slots[i] = null; changed = true; } else have.add(k);
    });
    for (const k of want) if (!have.has(k)) { const [id, job] = k.split('|'); if (inv.add(id, 1, { job }) === 0) changed = true; }
    if (changed) inv.changed();
  },
  // The rattle in the hand: the left button throws it where the cursor points (or ahead)
  rattleTarget(g) { return { tile: null, ok: true, label: t('job.strongbox.throw'), use: () => this.throwRattle(g) }; },
  throwRattle(g) {
    const p = g.player, inv = g.inv, held = inv.held;
    if (!p || held?.id !== 'rattle' || g.scene !== g.world) return;
    const mp = g.mousePoint?.();   // (null without a cursor over the game: ahead)
    let dx = mp ? dxOf(mp[0], p.x) : p.face.x * 10, dy = mp ? mp[1] - p.y : p.face.y * 10;
    const d = Math.hypot(dx, dy) || 1, k = Math.max(THROW[0], Math.min(THROW[1], d)) / d;
    dx *= k; dy *= k;
    inv.take(inv.selected, 1, true);
    g.gather.addDrop({ id: 'rattle', extra: { lure: madridMs() }, x: wrapX(p.x + dx), y: p.y + dy, z: 8, vz: 24, t: -1.5, scene: g.world });   // (it falls where it was aimed: up and down in about half a second)
    g.gather.swing = 0.25; g.gather.swingItem = null;
    g.wildlife?.noise?.(p.x + dx, p.y + dy, EVENT.drop);
    Audio.swish();
  },
  // (carry.js speedMul) With the box in the arms and somebody of the crew within 2.5 tiles: a helping hand
  helpSlow(g) {
    const j = g.missions.active, p = g.player;
    if (j?.kind !== 'strongbox' || !p) return 0;
    for (const id of g.missions.here(j)) if (id !== me()) { const a = posOf(g, id); if (a && Math.hypot(dxOf(a[0], p.x), a[1] - p.y) <= HELP_R) return HELP_SLOW; }
    return 0;
  },
  // (leaving the job) The box in your arms stays on the ground, for the others
  leaving(g, j) { if (j.kind === 'strongbox' && g.carry?.held === 'strongbox') g.carry.drop(); },
};
