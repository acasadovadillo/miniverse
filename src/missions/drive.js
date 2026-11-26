// The cattle drive (docs/planes/gta/PLAN-I-juntos.md §1.4): Rosa has bought five cows far off; they are brought to the village's yard.
// The cows are animals of the ranch (a.drove: the job's id), moved here by whoever decides the world and by nobody else (ranch.js
// skips them); they travel to the others like the rest of the herd (live.js 'herd').
//
// How they move (herdStep, pure): away from whoever comes near (7 tiles on foot, 12 on a horse), all the same way and together, for a
// while after being pushed; behind a calm rider ahead of them (or going calmly away from them); off from a creature of the night, but for a torch.
// 10 times a second, a straight line between two; nothing at all with nobody near.
import { B } from '../world/biomes.js';
import { CHUNK } from '../world/gen.js';
import { YARD, inYard, inBounds } from '../world/village.js';
import { wrapIndex, wrapX, dxOf } from '../world/planet.js';
import { SWIM_IN } from '../entities.js';
import { collide } from '../physics.js';
import { areCouple } from '../social.js';
import { PEOPLE } from '../neighbors.js';   // (a cycle, read only inside functions)
import { Profile } from '../accounts.js';
import { ihash } from '../util.js';
import { madridMs } from '../time.js';
import { Audio } from '../audio.js';
import { hud } from '../ui/hud.js';
import { t } from '../i18n.js';

export const COWS = 5, NEED = 4, PAY = 260, PER_COW = 40, WINDOW = 2 * 36e5;
export const RING = [120, 250];                     // tiles from the village
export const PUSH = { foot: 7, horse: 12, dog: 5 }; // tiles
const CALM = 3.2, LEAD_R = 10, LEAD_BACK = 3;       // m/s and tiles: a rider they follow, and how far behind
const KEEP_GOING = 5, NEAR = 45, STRAY = 9, TOLD = 15, TORCH_R = 6, MOB_R = 6, STUCK_S = 6;
const STEP = 0.1, IDLE_WALK = 0.45, WALK = 0.95, RUSH = 1.15, SWIM_K = 0.5, DEEP = 2.6;
const GATHERED = 6, GATHER_S = 2, HAY = 15, SETTLE_S = 25, KEPT_MS = 864e5, LEFT_S = 40;
const GATE = [21, 20.9], IN = [21, 18.7];           // before the yard's gap, and inside
const TURNS = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8];
const me = () => Profile.id || 'me';
const r2 = v => Math.round(v * 100) / 100;
const states = new Map();                            // job → { t, mem: cow → its own, head: [x, y], at: player → [x, y, t], dog }
const stateOf = j => { let s = states.get(j.id); if (!s) { if (states.size > 6) states.clear(); states.set(j.id, (s = { t: 0, mem: new Map(), head: [0, 0], at: new Map(), dog: null, gather: 0, settle: 0 })); } return s; };
const cowsOf = (g, id) => g.ranch.animals.filter(a => a.drove === id);
const centre = L => { const x0 = L[0].x; let x = 0, y = 0; for (const a of L) { x += dxOf(a.x, x0); y += a.y; } return [x0 + x / L.length, y / L.length]; };
const penned = a => inYard(wrapX(a.x), a.y, -0.2) || Math.hypot(dxOf(a.x, GATE[0]), a.y - GATE[1]) < 1.6;

// One step of the herd: cows [{ x, y, m: { vx, vy, walk, panic, stuck, side } }]; pushers [{ x, y, R, lead }]; env { free(x, y) → 0
// closed, 1 open, less: slower; head: [x, y] (the way they go, changed here); mobs: [{ x, y }]; torches: [{ x, y }]; gate: pull to the
// yard; now }. It leaves the velocities in m (and where each one is, moved)
export function herdStep(cows, pushers, dt, env) {
  if (!cows.length) return;
  const [cx, cy] = centre(cows), H = env.head;
  let px = 0, py = 0;
  for (const c of cows) {
    const m = c.m;
    m.fx = m.fy = 0; m.press = 0;
    for (const q of pushers) {
      const dx = dxOf(c.x, q.x), dy = c.y - q.y, d = Math.hypot(dx, dy) || 0.01;
      if (q.lead) {
        if (d > LEAD_R) continue;
        const bx = dxOf(q.x, c.x) - q.lead[0] * LEAD_BACK, by = q.y - c.y - q.lead[1] * LEAD_BACK, b = Math.hypot(bx, by) || 0.01;
        if (b > 0.8) { m.fx += (bx / b) * 1.1; m.fy += (by / b) * 1.1; m.press = Math.max(m.press, Math.min(0.55, b / 8)); px += q.lead[0]; py += q.lead[1]; }
        continue;
      }
      if (d >= q.R) continue;
      const w = 1 - d / q.R;
      m.fx += (dx / d) * w * 1.7; m.fy += (dy / d) * w * 1.7; m.press = Math.max(m.press, w);
      px += (dx / d) * w; py += (dy / d) * w;
    }
    for (const q of env.mobs || []) {
      const dx = dxOf(c.x, q.x), dy = c.y - q.y, d = Math.hypot(dx, dy) || 0.01;
      if (d > MOB_R || (env.torches || []).some(o => Math.hypot(dxOf(c.x, o.x), c.y - o.y) < TORCH_R)) continue;
      m.fx += (dx / d) * 3; m.fy += (dy / d) * 3; m.press = 1.3; m.panic = env.now + 2.5;
    }
    if (m.press > 0) m.walk = KEEP_GOING; else m.walk = Math.max(0, (m.walk || 0) - dt);
  }
  const P = Math.hypot(px, py);
  if (P > 0.05) { const k = Math.min(1, dt * 1.6); H[0] += (px / P - H[0]) * k; H[1] += (py / P - H[1]) * k; }
  const hl = Math.hypot(H[0], H[1]);
  for (const c of cows) {
    const m = c.m, moving = m.walk > 0, dx = dxOf(cx, c.x), dy = cy - c.y, d = Math.hypot(dx, dy), panic = m.panic > env.now;
    if (moving && hl > 0.2 && !panic) { m.fx += (H[0] / hl) * 0.55; m.fy += (H[1] / hl) * 0.55; }
    // (together: the farther from the rest, the more it wants back)
    if (!panic && d > (moving ? 2.6 : 6)) { const k = Math.min(1.5, (d - (moving ? 2.6 : 6)) / 3.2) * (moving ? 1.15 : 0.6); m.fx += (dx / d) * k; m.fy += (dy / d) * k; }
    for (const o of cows) if (o !== c) { const ox = dxOf(c.x, o.x), oy = c.y - o.y, q = Math.hypot(ox, oy) || 0.01; if (q < 1.7) { m.fx += (ox / q) * (1.7 - q) * 1.2; m.fy += (oy / q) * (1.7 - q) * 1.2; } }
    if (m.side && m.side[2] > env.now) { m.fx += m.side[0]; m.fy += m.side[1]; }   // (one that fancies a bit of grass)
    if (env.gate) {   // (near the yard they smell the hay: they go in by themselves)
      const inside = env.penned(c);
      const [gx, gy] = inside || Math.hypot(dxOf(c.x, GATE[0]), c.y - GATE[1]) < 1.7 ? IN : GATE, ax = dxOf(gx, c.x), ay = gy - c.y, a = Math.hypot(ax, ay) || 0.01;
      if (inside && a < 4) { m.fx = m.fy = 0; m.walk = 0; m.press = 0; }
      else if (a < HAY) { m.fx += (ax / a) * 2.1; m.fy += (ay / a) * 2.1; m.walk = Math.max(m.walk, 1); }
    }
    const f = Math.hypot(m.fx, m.fy), sp = m.walk > 0 ? (f > 0.12 ? WALK + RUSH * Math.min(1.2, m.press) : 0) : f > 0.3 ? IDLE_WALK : 0, k = Math.min(1, dt * 4);
    m.vx = (m.vx || 0) + ((f ? m.fx / f : 0) * sp - (m.vx || 0)) * k; m.vy = (m.vy || 0) + ((f ? m.fy / f : 0) * sp - (m.vy || 0)) * k;
    let v = Math.hypot(m.vx, m.vy);
    if (v < 0.12) { m.vx = m.vy = 0; m.stuck = 0; continue; }
    // (what is in the way is gone round)
    let done = false;
    for (const a of TURNS) {
      const n = Math.sin(a), q = Math.cos(a), ux = (m.vx * q - m.vy * n) / v, uy = (m.vx * n + m.vy * q) / v, k1 = env.free(c.x + ux * v * dt, c.y + uy * v * dt, ux, uy);
      if (k1 <= 0) continue;
      m.vx = ux * v * k1; m.vy = uy * v * k1; m.slow = k1;
      c.x += m.vx * dt; c.y += m.vy * dt;
      m.vx /= k1; m.vy /= k1;
      done = true; m.stuck = a ? Math.max(0, (m.stuck || 0) - dt * 0.3) : 0;
      break;
    }
    if (!done) { m.vx = m.vy = 0; m.stuck = (m.stuck || 0) + dt; if (m.stuck > STUCK_S && d > 0.5) { m.stuck = 0; c.x += dx / d; c.y += dy / d; } }   // (a fence or a tree never ends a drive)
  }
}
// May a cow stand there? (1; in deep water, slower; 0: no). Where nothing of the land is made yet, only its water is asked for
export function freeAt(g) {
  const w = g.world, from = { x: 0, y: 0 }, near = new Map();   // (what stands near, looked for once a step for each tile: clear() it each step)
  const f = (x, y, ux, uy) => {
    const dep = w.waterDepth(x, y);
    if (dep > DEEP || (w.digChunks.size > 0 && w.digH(Math.floor(x), Math.floor(y)) !== null)) return 0;
    from.x = x + ux * 0.25; from.y = y + uy * 0.25;
    if (w.merged.has(`${wrapIndex(Math.floor(x / CHUNK), CHUNK)},${Math.floor(y / CHUNK)}`) || (f.ps || []).some(q => Math.abs(dxOf(q.x, x)) + Math.abs(q.y - y) < NEAR)) {
      const p = { x: from.x, y: from.y }, k = `${Math.floor(p.x)},${Math.floor(p.y)}`;
      let L = near.get(k);
      if (!L) near.set(k, (L = w.collidersNear(p.x, p.y)));
      collide(p, L, 0.3);
      if (Math.hypot(p.x - from.x, p.y - from.y) > 0.07) return 0;
    }
    return dep >= SWIM_IN ? SWIM_K : 1;
  };
  f.clear = () => near.clear();
  return f;
}

// Where the herd waits: near the hamlet that was named, or a meadow of its own (the same one for a week, by the world's seed)
const distVillage = (x, y) => Math.hypot(dxOf(x, GATE[0]), y - GATE[1]);
function hamletAt(g, key) {
  if (typeof key !== 'string' || !/^-?\d+,-?\d+$/.test(key)) return null;
  const p = g.places.poiOf(key);
  if (p?.kind !== 'aldea') return null;
  const d = distVillage(p.x, p.y);
  return d >= RING[0] && d <= RING[1] ? p : null;
}
function pasture(g, seed) {
  const gen = g.world.gen, w = g.world;
  let best = null, bs = -1;
  for (let i = 0; i < 72; i++) {
    const a = (i + ihash(seed, i, 5101)) / 72 * Math.PI * 2, r = RING[0] + 8 + ihash(seed, i, 5103) * (RING[1] - RING[0] - 16), x = GATE[0] + Math.cos(a) * r, y = GATE[1] + Math.sin(a) * r;
    if (gen.biomeAt(x, y) !== B.MEADOW || w.natWater(x, y)) continue;
    let s = 0;
    for (let k = 0; k < 20; k++) { const q = k / 20, bx = GATE[0] + (x - GATE[0]) * q, by = GATE[1] + (y - GATE[1]) * q, b = gen.biomeAt(bx, by); s += b === B.MEADOW ? 1 : b === B.FOREST || b === B.PINES ? 0.5 : b === B.BEACH || b === B.ROCKY || b === B.SNOW || b === B.DESERT ? 0.35 : b === B.OCEAN || b === B.LAKE ? -3 : b === B.SHALLOW ? -1.2 : 0; }
    for (const [i2, j2] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) if (w.natWater(x + i2, y + j2)) s -= 2;
    if (g.places.inAldea?.(x, y, 12)) s -= 8;
    if (s > bs) { bs = s; best = [x, y]; }
  }
  return best;
}
const openAt = (g, x, y) => !g.world.natWater(x, y) && g.world.waterDepth(x, y) < 0.15 && !g.places.inAldea?.(x, y, 1) && !g.world.collidersNear(x, y).some(c => { const p = { x, y }; collide(p, [c], 0.45); return p.x !== x || p.y !== y; });

export const dbgState = j => states.get(j.id);   // (the tests)
export const drive = {
  id: 'drive', giver: 'rosa', pay: PAY, ms: WINDOW,
  stages: ['go', 'gather', 'road'],
  open: true,   // (its last event, keeping the cow, may also come from the starter's couple)
  closed: j => j.stage === 'road',
  params: (g, j) => ({ place: j.site.name || '', n: j.data.n ?? COWS, m: COWS }),
  // (the asker's) The hamlet they know that is in the ring, if any
  propose(g) {
    let best = null;
    for (const p of g.places.knownPlaces()) if (p.kind === 'aldea') { const d = distVillage(p.x, p.y); if (d >= RING[0] && d <= RING[1] && (!best || d < best.d)) best = { key: p.key, d }; }
    return best ? { poi: best.key } : {};
  },
  start(g, j, c) {
    const p = hamletAt(g, c.poi), week = g.missions.week(), seed = ((g.world.seed | 0) ^ (week * 7919)) | 0;
    let at = null;
    if (p) { const a = Math.atan2(GATE[1] - p.y, dxOf(GATE[0], p.x)); for (const o of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4, 3.1]) { const q = [p.x + Math.cos(a + o) * 24, p.y + Math.sin(a + o) * 24]; if (!g.world.natWater(...q)) { at = q; break; } } }
    at ||= pasture(g, seed);
    if (!at) return false;
    j.site = { x: r2(wrapX(at[0])), y: r2(at[1]), ...(p && { poi: p.key, name: g.places.nameOf(p) }) };
    let n = 0;
    for (let i = 0; i < 160 && n < COWS; i++) {
      const a = i * 2.4 + ihash(seed, i, 5107), r = 2 + Math.sqrt(i % 20) * 2, x = wrapX(at[0] + Math.cos(a) * r), y = at[1] + Math.sin(a) * r;
      if (!openAt(g, x, y) || cowsOf(g, j.id).some(q => Math.hypot(dxOf(q.x, x), q.y - y) < 2)) continue;
      g.ranch.addDrove(j.id, 'vaca', x, y); n++;
    }
    if (n < COWS) { for (const a of cowsOf(g, j.id)) g.ranch.remove(a); return false; }
    j.data = { n: COWS };
    states.delete(j.id);
    return true;
  },
  // Each step, whoever decides the world
  update(g, j, dt) {
    const S = stateOf(j), L = cowsOf(g, j.id);
    if (L.length < NEED) { if ((S.gone = (S.gone || 0) + dt) > 3) g.missions.finish(j, 'fail', { why: 'herd' }); return; }
    S.gone = 0;
    // (who is about, looked at only when a step is due: 10 times a second)
    if (S.t + dt >= STEP || !S.ps) {
      S.ps = g.mobs.players().filter(q => q.gm !== 'spectator');
      S.near = S.ps.some(q => L.some(a => Math.abs(dxOf(q.x, a.x)) + Math.abs(q.y - a.y) < NEAR));
    }
    const ps = S.ps;
    if (!S.near) { for (const a of L) { a.vx = a.vy = 0; a.grazing = false; } S.t = 0; S.dog = null; S.at.clear(); S.ps = null; return; }
    S.t += dt;
    let first = true;
    while (S.t >= STEP) { S.t -= STEP; if (first) this.look(g, j, S, L, ps); first = false; this.step(g, j, S, L, STEP); }
    for (const a of L) {   // (a straight line between two steps)
      const m = S.mem.get(a.id);
      if (!m) continue;
      const k = Math.min(1, dt * 9);
      a.x = wrapX(a.x + dxOf(m.x, a.x) * k); a.y += (m.y - a.y) * k;
      const moving = Math.hypot(m.vx || 0, m.vy || 0) > 0.1;
      a.vx = moving ? m.vx : 0; a.vy = moving ? m.vy : 0;
      if (moving) { a.step += dt * 6; a.faceTo(m.vx, m.vy); a.grazing = false; m.eat = 2; }
      else if ((m.eat = (m.eat ?? 2) - dt) < 0) a.grazing = ((g.time + L.indexOf(a) * 3.7) % 9) < 6;
      a.inside = false; a.tx = a.x; a.ty = a.y;
    }
    this.advance(g, j, S, L, ps, dt);
  },
  // Who is about: where each one goes, whether they lead
  look(g, j, S, L, ps) {
    const [cx, cy] = centre(L), now = g.time;
    S.pushers = []; S.torches = []; S.mobs = [];
    for (const q of ps) {
      const id = q.e?.id || q.conn || 'me', was = S.at.get(id), e = q.e || {}, fresh = !was || now - was[2] >= 0.08, dtm = was ? Math.max(0.08, now - was[2]) : 1;
      const vx = was && fresh ? dxOf(q.x, was[0]) / dtm : 0, vy = was && fresh ? (q.y - was[1]) / dtm : 0;
      if (fresh) S.at.set(id, [q.x, q.y, now]);
      const d = Math.hypot(dxOf(q.x, cx), q.y - cy);
      if (d > NEAR) continue;
      const sp = fresh ? Math.hypot(vx, vy) : Math.hypot(...(S.vel?.get(id) || [0, 0])), ox = dxOf(q.x, cx), oy = q.y - cy;
      const m = S.vel ||= new Map(), v = m.get(id) || [0, 0];
      if (fresh) { v[0] += (vx - v[0]) * 0.25; v[1] += (vy - v[1]) * 0.25; m.set(id, v); }
      // (a calm rider ahead of the herd, by the way it goes or by the way the rider goes off, is followed; one behind or at a gallop pushes)
      const vs = Math.hypot(v[0], v[1]), away = vs > 0.3 ? (v[0] * ox + v[1] * oy) / (vs * (d || 1)) : 0, H = S.head, hl = Math.hypot(H[0], H[1]);
      const ahead = hl > 0.2 && (ox * H[0] + oy * H[1]) / ((d || 1) * hl) > 0.35, calm = vs < CALM && sp < CALM * 1.4;
      const lead = e.mount && calm && d > 2.5 ? (ahead ? [H[0] / hl, H[1] / hl] : vs > 0.35 && away > 0.5 ? [v[0] / vs, v[1] / vs] : null) : null;
      // (a horse coming at them or fast is felt from 12 tiles; one that stands or walks off, as somebody on foot)
      const coming = vs > 0.3 && away < -0.3;
      S.pushers.push({ x: q.x, y: q.y, R: e.mount && (coming || !calm) ? PUSH.horse : PUSH.foot, lead });
      const held = q.me ? g.inv?.held?.id : e.held;
      if (held === 'antorcha' || held?.id === 'antorcha') S.torches.push({ x: q.x, y: q.y });
    }
    if (S.dog && g.time - S.dog.at < 0.5) S.pushers.push({ x: S.dog.x, y: S.dog.y, R: PUSH.dog, lead: null });
    for (const q of g.mobs.list) if (L.some(a => Math.abs(dxOf(q.x, a.x)) + Math.abs(q.y - a.y) < 14)) S.mobs.push(q);
    // (on the road, now and then one goes off to the side after a tuft)
    if (j.stage === 'road' && now > (S.nextSide ?? now + 25)) { S.nextSide = now + 35 + Math.random() * 30; const a = L[Math.floor(Math.random() * L.length)], k = S.mem.get(a.id), h = Math.hypot(...S.head) || 1; if (k && !penned(a)) { const s = Math.random() < 0.5 ? 1 : -1; k.side = [-S.head[1] / h * s * 1.7, S.head[0] / h * s * 1.7, now + 4.5]; } }
    else if (S.nextSide === undefined) S.nextSide = now + 25;
  },
  step(g, j, S, L, dt) {
    const cows = L.map(a => { let m = S.mem.get(a.id); if (!m || Math.hypot(dxOf(m.x, a.x), m.y - a.y) > 4) S.mem.set(a.id, (m = { x: a.x, y: a.y, vx: 0, vy: 0, walk: 0 })); return { x: m.x, y: m.y, m }; });
    const free = (S.free ||= freeAt(g)), road = j.stage === 'road';
    if ((S.freeT = (S.freeT || 0) + 1) % 5 === 0) free.clear();
    free.ps = S.ps;   // (things change: the cache lasts half a second)
    herdStep(cows, S.pushers || [], dt, { free, head: S.head, mobs: S.mobs, torches: S.torches, now: g.time, gate: road, penned: c => penned(c) });
    for (const c of cows) { c.m.x = wrapX(c.x); c.m.y = c.y; }
  },
  // The stages
  advance(g, j, S, L, ps, dt) {
    const [cx, cy] = centre(L);
    if (j.stage === 'go') { if (j.crew.some(id => g.missions.near(id, cx, cy, 16))) g.missions.stage(j, 'gather'); return; }
    if (j.stage === 'gather') {
      const all = L.every(a => Math.hypot(dxOf(a.x, cx), a.y - cy) < GATHERED);
      S.gather = all && L.some(a => S.mem.get(a.id)?.walk > 0) ? S.gather + dt : all ? S.gather : 0;
      if (S.gather > GATHER_S) g.missions.stage(j, 'road');
      return;
    }
    const inside = L.filter(penned), n = inside.length;
    if (j.data.in !== n) { j.data = { ...j.data, in: n }; g.missions.changed(); }
    if (n < NEED) { S.settle = 0; return; }
    S.settle += dt;
    const rest = L.filter(a => !penned(a));
    if (rest.length && S.settle < SETTLE_S && rest.some(a => distVillage(a.x, a.y) < 60)) return;
    g.missions.finish(j, 'ok', { n, keep: inside[0].id });
  },
  reward: j => ({ coins: PAY + PER_COW * Math.max(0, Math.min(COWS, j.done?.n || NEED) - NEED) }),
  finished(g, j, outcome) { if (outcome !== 'ok') this.end(g, j); else { const S = stateOf(j); S.over = 0; } },
  // Once it is over: those that were sold on go when nobody looks (or after a while); the one that may be kept waits a day
  after(g, j, dt) {
    const L = cowsOf(g, j.id);
    if (!L.length) return;
    if (j.done.outcome !== 'ok') { this.end(g, j); return; }
    const S = stateOf(j), ps = g.mobs.players();
    S.over = (S.over || 0) + dt;
    for (const a of L) {
      a.vx = a.vy = 0; a.grazing = ((g.time + a.x * 3) % 9) < 6;
      if (a.id === j.done.keep) { if (madridMs() - j.done.at > KEPT_MS) this.off(g, a); continue; }
      const seen = ps.some(q => Math.hypot(dxOf(q.x, a.x), q.y - a.y) < 24);
      if ((!seen && S.over > 8) || S.over > LEFT_S) { this.off(g, a); return; }   // (one at a time)
    }
  },
  off(g, a) { if (g.player) g.gather?.chips?.(a.x, a.y, 'dirt', 6); g.ranch.remove(a); },
  end(g, j) { if (g.missions.decides()) for (const a of cowsOf(g, j.id)) g.ranch.remove(a); states.delete(j.id); },
  // The cow that may be kept, asked for by who started it (or their couple)
  onEvent(g, j, ev, by, c) {
    if (ev !== 'keep' || j.done?.outcome !== 'ok' || !this.mayKeep(g, j, by)) return false;
    const a = g.ranch.animals.find(q => q.id === j.done.keep && q.drove === j.id);
    if (!a || !g.missions.near(by, a.x, a.y, 4) || !g.ranch.keepDrove(a, by)) return false;
    j.done = { ...j.done, kept: by };
    return true;
  },
  mayKeep: (g, j, id) => j.by === id || areCouple(g.family?.v, j.by, id) || (id === me() && !!g.social?.isPartnerId?.(j.by)),
  // E on a cow of it
  animalAct(g, j, a) {
    if (j?.done?.keep === a.id && !j.done.kept && this.mayKeep(g, j, me())) {
      const room = g.ranch.homes('establo').some(h => h.free > 0);
      return { text: t(room ? 'job.drive.keep' : 'job.drive.keep_room', { name: a.name }), run: () => { if (!room) { Audio.error(); return; } g.missions.ask({ ev: 'keep', jid: j.id }, ok => { if (ok) { Audio.unlock(); hud.toast(t('job.drive.kept', { name: a.name }), 'good'); } else Audio.error(); }); } };
    }
    return { text: t('job.drive.cow', { name: a.name }), run: () => Audio.blip() };
  },
  // Your dog, out with you: it runs behind a stray and brings it back
  dog(g, j, dog, owner, dt) {
    if (j.stage === 'go' || dog.sit) return false;
    const S = stateOf(j), L = cowsOf(g, j.id);
    if (L.length < 2 || owner.swim) return false;
    const [cx, cy] = centre(L);
    let far = null, fd = STRAY;
    for (const a of L) { const d = Math.hypot(dxOf(a.x, cx), a.y - cy); if (d > fd && !penned(a) && Math.hypot(dxOf(a.x, owner.x), a.y - owner.y) < 32) { fd = d; far = a; } }
    if (!far) return false;
    const k = 2.4 / fd, x = far.x + dxOf(far.x, cx) * k, y = far.y + (far.y - cy) * k;
    dog.go(x, y);
    dog.walk(dt, g.world, 4.4);
    S.dog = { x: dog.x, y: dog.y, at: g.time };
    if ((S.bark || 0) < g.time) { S.bark = g.time + 4; const p = g.player; if (p && Math.hypot(dxOf(dog.x, p.x), dog.y - p.y) < 25) Audio.bark(); }
    return true;
  },
  // ---------- this player ----------
  herd(g, j) { const L = cowsOf(g, j.id); return L.length ? { L, at: centre(L) } : null; },
  strayOf(g, j, H) { let far = null, fd = TOLD; for (const a of H.L) { const d = Math.hypot(dxOf(a.x, H.at[0]), a.y - H.at[1]); if (d > fd && !penned(a)) { fd = d; far = a; } } return far; },
  goal(g, j) {
    const H = this.herd(g, j);
    if (j.stage === 'go') return H ? { x: wrapX(H.at[0]), y: H.at[1] } : { x: j.site.x, y: j.site.y };
    if (!H) return null;
    if (j.stage === 'gather') return { x: wrapX(H.at[0]), y: H.at[1] };
    const s = this.strayOf(g, j, H);
    return s ? { x: s.x, y: s.y } : { x: GATE[0], y: GATE[1] };
  },
  line(g, j) {
    const H = this.herd(g, j), together = H ? H.L.filter(a => Math.hypot(dxOf(a.x, H.at[0]), a.y - H.at[1]) < TOLD).length : 0;
    const text = t(`job.drive.stage.${j.stage}${j.stage === 'go' && j.site.name ? '_at' : ''}`, { place: j.site.name || '', n: together, m: COWS });
    return j.stage === 'go' ? text : `${text} · ${t('job.drive.cows', { n: j.stage === 'road' && j.data.in ? j.data.in : together, m: COWS })}`;
  },
  // (twice a second) How many are together, when it changes
  tell(g, j) {
    const H = this.herd(g, j), p = g.player;
    if (!H || j.stage === 'go' || Math.hypot(dxOf(H.at[0], p.x), H.at[1] - p.y) > 40) return;
    const n = H.L.filter(a => Math.hypot(dxOf(a.x, H.at[0]), a.y - H.at[1]) < TOLD).length;
    if (this.told?.id === j.id && this.told.n === n) return;
    if (this.told?.id === j.id) hud.feed.push({ kind: 'world', key: 'cows', text: t('job.drive.cows', { n, m: COWS }) });
    this.told = { id: j.id, n };
  },
  load(g, j) { states.delete(j.id); },
};
