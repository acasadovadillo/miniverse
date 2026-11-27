// The wedding (docs/planes/gta/PLAN-I-juntos.md §1.6), Nilo's job. Two kinds:
//   wedding      two players who are a couple (a child in common) or engaged with a ring (family.v.engaged); never done by one
//                alone: the bell needs both at the arch, and the vows both. Married, they count as a couple (social.js areCouple).
//   wedding_npc  the neighbours' wedding of Marta and Eusebio, who "have been not-dating for twenty years": the same preparations
//                for them, once per world (family.v.weddings holds the pair), 400 coins each.
//
// Engagement: Bruno makes a ring (trades.js). Hold it and press E on the other player: «Propose»; their game asks yes or no
// (the 'wed' message, live.js) and, on a yes, asks whoever decides the world (CLAIMS.wed) to write family.v.engaged
// [{ id, a: who proposed, b: who said yes, day }]. The ring then goes from one game to the other by that record, once
// (Missions.mine), so a reload never gives or takes it twice.
//
// The checklist (j.data), each part done by any of the crew, also while the other is offline:
//   arch    { tile, x, y, yaw }: E on a wedding arch (a B buildable, its plan sold by Dani): «Hold the wedding here»
//   gave    { [player]: { ring, estofado, pan, wedding_cake } }: the rings left with Nilo (talk; two in all, the couple's only)
//           and what Anselmo needs for the feast (talk: 3, 2 and 1). If it goes wrong, each one gets back what they gave; at the
//           end each one of the couple gets a ring: the ring of their wedding. recv { [request id]: what was taken of it }:
//           giving is one request with its id, the things out of the backpack first and kept in the save (Missions.mine) until the
//           answer is seen in the job, so a request lost, late or twice, or a reload, never loses nor makes anything
//   guests  [npc]: the neighbours invited in a talk («Come to our wedding»), 4 at least (2 hearts each)
// The ceremony: E on the arch with all of it done, «Ring the bell» (the couple: both there) writes ceremonyAt (45 s on). From
// the bell every game walks Nilo and the guests to their places before the arch, from that record alone (gatherAt, called by
// neighbors.js whereAt), with nothing sent. Nilo speaks (three bubbles), then each of the couple says «I do» (CLAIMS.job
// 'vow'); both vows → family.v.weddings gets the pair and the job is done: a kiss, petals and the bell. One vow alone does
// nothing; four minutes without the other's, and it is back to the preparations.
import { WALK_NODES, NILO, TAVERN } from '../world/village.js';
import { dxOf, nearX } from '../world/planet.js';
import { dirOf, sideOf } from '../world/fit.js';
import { wayTo } from '../world/walkways.js';
import { SPEED, slotAt, roadBetween, makeSpot, along } from '../routines.js';
import { PEOPLE } from '../neighbors.js';   // (a cycle, read only inside functions)
import { ITEMS } from '../items.js';
import { CLAIMS } from '../claims.js';
import { talkOptions } from '../talk.js';
import { Profile } from '../accounts.js';
import { ihash } from '../util.js';
import { madridMs } from '../time.js';
import { Audio } from '../audio.js';
import { reportFault } from '../faults.js';
import { hud } from '../ui/hud.js';
import { t, tList } from '../i18n.js';
import { apagada } from '../opciones.js';

export const ON = !apagada('boda') && !apagada('misiones');   // (?boda=0: no wedding offered here, nor the proposal; what the world has goes on)
export const WINDOW = 7 * 864e5, LEAD_S = 45, VOW_FROM_S = 13, VOW_S = 240, NPC_S = 24, LINGER_S = 75, PAY_NPC = 400;
export const RINGS = 2, FEAST = { estofado: 3, pan: 2, wedding_cake: 1 }, GUESTS_MIN = 4, GUESTS_MAX = 10, GUEST_HEARTS = 2;
export const PROPOSE_R = 3, ARCH_R = 6, BELL_R = 6, VOW_R = 8, SEE_R = 45, WATCH_R = 30, NPC_PAIR = ['marta', 'eusebio'];
export const RESEND_MS = 8000, LOST_MS = 10 * 6e4, ASK_S = 30, ENGAGE_DAYS = 7, REP_WED = 40, FRIEND_WED = 60, FAR_NODE = 60;
const SPEECH = [0, 4.5, 9], NPC_VOWS = [14, 17.5], HOP = 2.5;   // (s after ceremonyAt: Nilo's lines; Marta's and Eusebio's «I do»)
const me = () => Profile.id || 'me';
const now = () => madridMs();
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const r2 = v => Math.round(v * 100) / 100;
const isPeople = id => typeof id === 'string' && Object.prototype.hasOwnProperty.call(PEOPLE, id);

// ---------- the family's record (shared: every game and the world server read the same) ----------
const famOf = g => g.family?.v || {};
// The engagements, as a list (an old shape [a, b, day] is read too)
export function engagedList(fam) {
  const E = fam?.engaged;
  if (!Array.isArray(E)) return [];
  if (E.length >= 2 && typeof E[0] === 'string') return [{ id: `${E[0]}+${E[1]}`, a: E[0], b: E[1], day: E[2] | 0 }];
  return E.filter(e => isMap(e) && typeof e.a === 'string' && typeof e.b === 'string');
}
export const weddingsOf = fam => (Array.isArray(fam?.weddings) ? fam.weddings.filter(w => isMap(w) && typeof w.a === 'string' && typeof w.b === 'string') : []);
const pairIs = (w, x, y) => (w.a === x && w.b === y) || (w.a === y && w.b === x);
export const married = (fam, x, y) => weddingsOf(fam).some(w => pairIs(w, x, y));
export const marriedAny = (fam, x) => weddingsOf(fam).some(w => !w.npc && (w.a === x || w.b === x));
export const engagedTo = (fam, x) => { const e = engagedList(fam).find(q => q.a === x || q.b === x); return e ? (e.a === x ? e.b : e.a) : null; };
export const npcDone = fam => married(fam, ...NPC_PAIR);
// Who this player could marry: their fiancé(e), else the other parent of a child of theirs (or of the one on the way); never
// someone already married to them
export function partnerOf(fam, x) {
  if (!x || marriedAny(fam, x)) return null;
  const e = engagedTo(fam, x);
  if (e) return married(fam, x, e) ? null : e;
  const kids = Array.isArray(fam?.kids) ? fam.kids : [], other = ids => (Array.isArray(ids) && ids.includes(x) ? ids.find(i => typeof i === 'string' && i !== x) : null);
  for (const k of kids) { const o = other(k?.parents); if (o && !married(fam, x, o)) return o; }
  const p = fam?.expecting, o = p && typeof p.father === 'string' ? other([p.mother, p.father]) : null;
  return o && !married(fam, x, o) ? o : null;
}

// Where somebody is now ([x, y]), or null (not in the world or not playing): yourself, or a peer
function posOf(g, id) {
  if (id === me() && !Profile.server) { const p = g.player; return p && g.scene === g.world ? [p.x, p.y] : null; }
  for (const q of g.live?.peers?.values() || []) if (q.id === id && q.playing && q.sc === 'world') { const e = q.entity, at = e ? e.to || [e.x, e.y] : q.at; return Array.isArray(at) ? [at[0], at[1]] : null; }
  return null;
}
const within = (a, x, y, r) => !!a && Math.hypot(dxOf(a[0], x), a[1] - y) <= r;
const peerOf = (g, id) => { for (const [conn, q] of g.live?.peers || []) if (q.id === id) return { conn, peer: q }; return null; };

// ---------- the arch: where its middle is and which way it faces ----------
export function archOf(o) {
  const yaw = o.yaw || 0, [ux, uy] = sideOf(yaw);
  return { tile: [o.tile[0], o.tile[1]], x: r2(o.x + ux * 0.5), y: r2(o.y + uy * 0.5), yaw: r2(yaw) };
}
const archAt = (g, tile) => (g.world?.placedNear?.(tile[0] + 0.5, tile[1] + 0.5, 2.2) || []).find(o => o.placed === 'wedding_arch' && o.tile && o.tile[0] === tile[0] && o.tile[1] === tile[1]) || null;
// The places before the arch: Nilo under it, facing out; the neighbours' couple in front of him, facing each other; the guests in
// rows further out, facing the arch. [x, y, yaw]
export function layout(A, n) {
  const [fx, fy] = dirOf(A.yaw), [ux, uy] = sideOf(A.yaw), at = (f, u) => [A.x + fx * f + ux * u, A.y + fy * f + uy * u];
  const face = (dx, dy) => Math.atan2(dx, dy);
  const out = { nilo: [...at(-0.15, 0), face(fx, fy)], bride: [...at(0.9, -0.42), face(ux, uy)], groom: [...at(0.9, 0.42), face(-ux, -uy)], guests: [] };
  for (let i = 0; i < n; i++) { const row = Math.floor(i / 5), col = i % 5; out.guests.push([...at(2.7 + row * 1.1, (col - 2) * 0.9 + (row % 2) * 0.45), face(-fx, -fy)]); }
  return out;
}

// ---------- the checklist ----------
const GIVE = ['ring', ...Object.keys(FEAST)];
const given = (D, k) => Object.values(isMap(D.gave) ? D.gave : {}).reduce((s, q) => s + (isMap(q) ? q[k] | 0 : 0), 0);
const ringsIn = D => given(D, 'ring');
const feastIn = D => Object.keys(FEAST).reduce((s, k) => s + Math.min(FEAST[k], given(D, k)), 0);
const needOf = (j, k) => (k === 'ring' ? (isNpc(j) ? 0 : RINGS) : FEAST[k] || 0) - given(j.data, k);
const FEAST_N = Object.values(FEAST).reduce((s, n) => s + n, 0);
const isNpc = j => j.kind === 'wedding_npc';
export function missing(j) {
  const D = j.data, out = [];
  if (!D.arch) out.push('arch');
  if (!isNpc(j) && ringsIn(D) < RINGS) out.push('rings');
  if (feastIn(D) < FEAST_N) out.push('feast');
  if ((D.guests || []).length < GUESTS_MIN) out.push('guests');
  return out;
}

// ---------- what this game shows of a ceremony (any in the world: everybody sees the neighbours go) ----------
// G: { jid, at (ceremonyAt), off (village clock − Madrid's), end, by: npc → { spot, R, leave }, nilo: { R, leave, spot }, A }
let G = null;
const ticks = new Map();   // (whoever decides: job → s to its next look)
const local = { told: new Map(), asked: null, kissed: new Set(), bells: new Set(), lines: new Map(), wait: false };
export const dbg = { get G() { return G; }, local };   // (the tests)
export const petals = [];   // (fx: the petals that fall, three/wedding3d.js draws them: { x, y, z, vx, vy, t, life, ph, c })
const ceremonyOf = g => {
  const M = g.missions;
  for (const j of M.jobs()) {
    if ((j.kind !== 'wedding' && j.kind !== 'wedding_npc') || !j.data?.arch || !Number.isFinite(j.data.ceremonyAt)) continue;
    const end = (j.done ? (j.done.outcome === 'ok' ? j.done.at : 0) : j.data.ceremonyAt + VOW_S * 1000) + LINGER_S * 1000;
    if (now() < end && (j.done ? j.done.outcome === 'ok' : j.stage === 'ceremony')) return [j, end];
  }
  return null;
};
// The neighbours who walk there: the guests (and the couple of the neighbours' wedding) that live in this village now
function walkers(g, j) {
  const here = new Set((g.neighbors?.people || []).map(n => n.id)), out = [];
  if (isNpc(j)) for (const id of NPC_PAIR) if (here.has(id)) out.push(id);
  for (const id of j.data.guests || []) if (here.has(id) && !out.includes(id) && id !== 'nilo') out.push(id);
  return out;
}
// The last leg, from a point of the village's paths to the place before the arch (round what is built), or null: too far
function legTo(g, A) {
  const [fx, fy] = dirOf(A.yaw), goal = [A.x + fx * 3.6, A.y + fy * 3.6];
  const L = Object.entries(WALK_NODES).map(([n, [x, y]]) => [Math.hypot(dxOf(x, goal[0]), y - goal[1]), n]).filter(q => q[0] < FAR_NODE).sort((a, b) => a[0] - b[0]).slice(0, 3);
  for (const [, n] of L) { const way = g.world ? wayTo(g.world, WALK_NODES[n], goal) : [goal]; if (way) return { node: n, via: way }; }
  return null;
}
function gathering(g) {
  const c = ceremonyOf(g);
  if (!c) { if (G) { G = null; restoreNilo(g); } return; }
  const [j, end] = c, D = j.data;
  if (G && G.jid === j.id && G.at === D.ceremonyAt) { G.end = end; return; }
  const off = (g.days?.now ?? now()) - now(), leave = D.ceremonyAt - LEAD_S * 1000, A = D.arch, P = layout(A, GUESTS_MAX + 2), leg = legTo(g, A);
  G = { jid: j.id, at: D.ceremonyAt, off, end, by: new Map(), nilo: null, A, far: !leg };
  const mk = (key, [x, y, yaw]) => makeSpot({ key: `wed:${j.id}:${key}`, kind: 'wedding', goal: 'wedding', node: leg?.node || 'plaza', via: [...(leg?.via || []), [x, y]], yaw });
  const route = (from, spot) => { try { return leg ? roadBetween(from, spot) : null; } catch (e) { reportFault(e, 'wedding.route'); return null; } };
  let gi = 0;
  for (const id of walkers(g, j)) {
    const pos = isNpc(j) && id === NPC_PAIR[0] ? P.bride : isNpc(j) && id === NPC_PAIR[1] ? P.groom : P.guests[gi++];
    if (!pos) continue;
    // (an arch far from the paths: only the couple of the neighbours comes, put there; the guests send their best)
    if (!leg && !NPC_PAIR.includes(id)) continue;
    const spot = mk(id, pos), from = slotAt(id, leave + off).spot;
    G.by.set(id, { spot, R: route(from, spot), leave: leave + (G.by.size % 4) * 600 });
  }
  const ns = mk('nilo', P.nilo), home = makeSpot({ key: 'wed:nilo:home', kind: 'nilo', node: 'plaza', via: [[NILO.x, NILO.y]] });
  G.nilo = { spot: ns, R: route(home, ns), leave };
}
// (neighbors.js whereAt) Where a neighbour is during a ceremony (village ms), or null: as their routine says
export function gatherAt(id, ms) {
  const e = G?.by.get(id);
  if (!e) return null;
  const T = ms - G.off;
  if (T < e.leave || T > G.end) return null;
  return walkAt(e, T);
}
function walkAt(e, T) {
  const s = e.spot;
  if (e.R) { const d = (T - e.leave) / 1000 * SPEED; if (d < e.R.len) { const [x, y, dx, dy] = along(e.R, d); return { x, y, dx, dy, spot: s, moving: true, yaw: null }; } }
  else if (T < G.at - 10000) return null;   // (put there, not walked: a little before it begins)
  return { x: s.x, y: s.y, dx: 0, dy: 0, spot: s, moving: false, yaw: s.yaw };
}
// Nilo is no neighbour of the routines: his body (world.nilo) is walked here, each frame, and put back at the end
function niloFrame(g, dt) {
  const n = g.world?.nilo;
  if (!G || !n || !G.nilo) return;
  const T = now();
  if (T < G.nilo.leave || T > G.end) { restoreNilo(g); return; }
  const a = walkAt(G.nilo, T);
  if (!a) return;
  if (!G.niloOut) G.niloOut = { x: n.x, y: n.y, dir: n.dir };
  const dx = a.x - n.x, dy = a.y - n.y, d = Math.hypot(dx, dy);
  n.x = a.x; n.y = a.y;
  if (a.moving && dt > 0) { n.vx = dx / dt; n.vy = dy / dt; n.step = (n.step || 0) + d * 3.2; if (d > 1e-4) n.faceTo(dx, dy); }
  else { n.vx = n.vy = 0; n.faceTo(Math.sin(a.yaw), Math.cos(a.yaw)); }
}
function restoreNilo(g) {
  const n = g.world?.nilo;
  if (!n || !G?.niloOut) { if (n && (n.x !== NILO.x || n.y !== NILO.y) && !G) { n.x = NILO.x; n.y = NILO.y; n.vx = n.vy = 0; } return; }
  n.x = NILO.x; n.y = NILO.y; n.vx = n.vy = 0; if (G.niloOut.dir) n.faceTo(...G.niloOut.dir);
  G.niloOut = null;
}
// The petals: a burst over the arch, falling slowly and swaying (200 at most, 4-6 s)
export function burst(A, n = 160) {
  const COL = ['#f6f1ea', '#f2d4dc', '#e9a9b8', '#f4e7b0', '#ffffff'];
  for (let i = 0; i < n && petals.length < 200; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 1.6;
    petals.push({ x: A.x + Math.cos(a) * r, y: A.y + Math.sin(a) * r, z: 2.3 + Math.random() * 1.4, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5, t: 0, life: 4 + Math.random() * 2, ph: Math.random() * 6.3, c: COL[i % COL.length] });
  }
}
function bells(n, gap = 1.1, v = 0.8) { for (let i = 0; i < n; i++) setTimeout(() => (Audio.bell ? Audio.bell(v, i % 2) : Audio.clink()), i * gap * 1000); }

export const wedding = {
  id: 'wedding', giver: 'nilo', pay: 0, ms: WINDOW, patient: true,
  stages: ['prepare', 'ceremony'],
  closed: (j, by = me()) => j.stage !== 'prepare' || (!isNpc(j) && !(j.data.pair || []).includes(by)),
  params: (g, j) => ({ ...counts(j), name: nameOf(g, otherOf(j)) }),
  payText: () => t('job.wed.reward'),
  // The board and Nilo: the couple's wedding only for whoever has somebody to marry; the neighbours' one for the rest
  hidden: g => !ON || !partnerOf(famOf(g), me()),
  why: g => (partnerOf(famOf(g), me()) ? null : 'nopair'),
  propose: g => ({ partner: partnerOf(famOf(g), me()) }),
  start(g, j, c) {
    const fam = famOf(g), P = typeof c.partner === 'string' ? c.partner : null;
    if (!P || P === c.by || partnerOf(fam, c.by) !== P || married(fam, c.by, P) || marriedAny(fam, c.by) || marriedAny(fam, P)) return false;
    j.site = { x: NILO.x, y: NILO.y };
    j.data = { pair: [c.by, P], gave: {}, guests: [] };
    // (the other one is in from the start, if they are on no other job; else they join from J › Jobs)
    if (!g.missions.running().some(q => q.crew.includes(P))) j.crew = [c.by, P];
    return true;
  },
  // Who leaves takes back what they gave (it no longer counts); without one of the couple there is no wedding
  quitted(g, j, by) {
    const D = j.data, mine = D.gave?.[by];
    if (isMap(mine)) { const { [by]: _, ...rest } = D.gave, B = { ...((D.back || {})[by] || {}) }; for (const k of GIVE) if (mine[k] > 0) B[k] = (B[k] | 0) + mine[k]; j.data = { ...D, gave: rest, back: { ...(D.back || {}), [by]: B } }; }
    if (!isNpc(j) && (j.data.pair || []).includes(by)) g.missions.finish(j, 'fail', { why: 'left' });
  },
  // ---------- whoever decides ----------
  update(g, j, dt) {
    const S = (ticks.get(j.id) ?? 0) - dt;
    if (ticks.size > 8) ticks.clear();
    ticks.set(j.id, S > 0 ? S : 1);
    if (S > 0) return;
    const M = g.missions, D = j.data;
    if (D.arch && (j.stage === 'prepare' || j.stage === 'ceremony') && g.world && !archAt(g, D.arch.tile)) { const { arch: _, ceremonyAt: __, vows: ___, ...rest } = D; j.data = rest; if (j.stage !== 'prepare') M.stage(j, 'prepare'); else M.changed(); return; }
    if (j.stage !== 'ceremony') return;
    const T = now(), back = () => { const { ceremonyAt: _, vows: __, ...rest } = j.data; j.data = rest; M.stage(j, 'prepare'); };
    if (!isNpc(j)) {
      const pair = D.pair || [];
      if (T > D.ceremonyAt + VOW_S * 1000 || pair.some(id => !j.crew.includes(id) || M.isAway(j, id))) back();
      return;
    }
    if (T < D.ceremonyAt + NPC_S * 1000) return;
    if (M.here(j).some(id => within(posOf(g, id), D.arch.x, D.arch.y, WATCH_R))) this.wed(g, j); else back();
  },
  onEvent(g, j, ev, by, c, extra = {}) {
    const M = g.missions, D = j.data, at = posOf(g, by), T = now();
    if (ev === 'vow') {
      if (j.done) return j.done.outcome === 'ok' && (D.pair || []).includes(by);
      if (isNpc(j) || j.stage !== 'ceremony' || T < D.ceremonyAt || !(D.pair || []).includes(by) || !within(at, D.arch.x, D.arch.y, VOW_R)) return false;
      const vows = [...new Set([...(D.vows || []), by])];
      j.data = { ...D, vows };
      if (D.pair.every(id => vows.includes(id))) this.wed(g, j);
      return true;
    }
    if (j.stage !== 'prepare' || j.done) return false;
    if (ev === 'arch') {
      const tile = Array.isArray(c.tile) ? c.tile.map(v => v | 0) : null, o = tile && archAt(g, tile);
      if (!o) return false;
      const A = archOf(o);
      if (!within(at, A.x, A.y, ARCH_R)) return false;
      j.data = { ...D, arch: A };
      return true;
    }
    if (ev === 'give') {
      const rid = typeof c.rid === 'string' ? c.rid.slice(0, 24) : null, what = isMap(c.what) ? c.what : {};
      if (!rid) return false;
      if (D.recv && Object.prototype.hasOwnProperty.call(D.recv, rid)) { extra.took = D.recv[rid]; return true; }   // (asked twice: the same answer)
      const took = {};
      for (const k of GIVE) { const n = Math.max(0, Math.min(needOf(j, k), what[k] | 0)); if (n) took[k] = n; }
      const mine = { ...((D.gave || {})[by] || {}) };
      for (const [k, n] of Object.entries(took)) mine[k] = (mine[k] | 0) + n;
      const recv = Object.fromEntries([...Object.entries(D.recv || {}).slice(-15), [rid, took]]);
      j.data = { ...D, gave: { ...(D.gave || {}), [by]: mine }, recv };
      extra.took = took;
      return true;
    }
    if (ev === 'invite') {
      const L = D.guests || [];
      if (!isPeople(c.npc) || c.npc === 'nilo' || (isNpc(j) && NPC_PAIR.includes(c.npc))) return false;
      if (L.includes(c.npc)) return true;
      if (L.length >= GUESTS_MAX) return false;
      j.data = { ...D, guests: [...L, c.npc] };
      return true;
    }
    if (ev === 'bell') {
      if (missing(j).length || !within(at, D.arch.x, D.arch.y, BELL_R)) return false;
      // (the couple's: both of them there, now)
      if (!isNpc(j) && !(D.pair || []).every(id => j.crew.includes(id) && !M.isAway(j, id) && within(posOf(g, id), D.arch.x, D.arch.y, BELL_R))) { extra.why = 'both'; return false; }
      j.data = { ...D, ceremonyAt: T + LEAD_S * 1000, vows: [] };
      M.stage(j, 'ceremony');
      return true;
    }
    return false;
  },
  // Married: in the family's record (shared), the engagement gone; the job done
  wed(g, j) {
    const D = j.data, F = g.family?.v, pair = isNpc(j) ? NPC_PAIR : D.pair;
    if (!F || !pair || married(F, ...pair)) { g.missions.finish(j, 'fail', { why: 'left' }); return; }   // (married already: never twice)
    F.weddings = [...weddingsOf(F), { a: pair[0], b: pair[1], day: g.days.realDay, at: now(), ...(isNpc(j) && { npc: 1 }) }];
    const E = engagedList(F).filter(e => !pairIs(e, pair[0], pair[1]));
    if (E.length) F.engaged = E; else delete F.engaged;
    g.missions.finish(j, 'ok', { pair: [...pair], guests: [...(D.guests || [])] });
    g.onSave?.();
  },
  reward(j, g) {
    if (isNpc(j)) return { coins: PAY_NPC, items: [] };
    const items = [['ring', 1]], s = Math.abs(ihash(j.id.length, (j.done?.at | 0) % 99991, 7301) * 1e6) | 0;
    (j.done?.guests || []).filter(isPeople).forEach((id, i) => { const L = (PEOPLE[id].likes || []).filter(x => ITEMS[x]); if (L.length) items.push([L[(s + i * 7) % L.length], 1]); });
    return { coins: 0, items };
  },
  // (missions.js settle) What a wedding adds to the job's own: the reputation, and each guest's friendship
  settled(g, j, paid) {
    if (!paid) return;
    g.rep?.change(REP_WED, 'wedding');
    for (const id of [...(j.done?.guests || []), ...(isNpc(j) ? NPC_PAIR : [])]) if (isPeople(id) && id !== 'nilo') g.neighbors.addPoints(id, FRIEND_WED);
    g.stats?.add('weddings', 1);
    if (!isNpc(j)) hud.toast(t('job.wed.married', { name: nameOf(g, otherOf(j)) }), 'good');
  },

  // ---------- this player ----------
  goal(g, j) {
    const D = j.data;
    if (j.stage === 'ceremony') return { x: D.arch.x, y: D.arch.y };
    const m = missing(j);
    if (!m.length) return { x: D.arch.x, y: D.arch.y };
    if (m.includes('rings') && g.inv?.count('ring')) return { x: NILO.x, y: NILO.y };
    if (m.includes('feast') && Object.keys(FEAST).some(k => needOf(j, k) > 0 && g.inv?.count(k))) return { x: TAVERN.x0 + 6.5, y: TAVERN.y0 + 2.6 };
    return null;
  },
  line(g, j) {
    const D = j.data, P = this.params(g, j);
    if (j.stage === 'ceremony') {
      const s = (now() - D.ceremonyAt) / 1000;
      if (s < 0) return t('job.wed.stage.coming', { n: Math.ceil(-s) });
      return t(isNpc(j) ? 'job.wed.stage.watch' : (D.vows || []).includes(me()) ? 'job.wed.stage.wait_vow' : 'job.wed.stage.vow', P);
    }
    const m = missing(j);
    if (!m.length) return t(isNpc(j) ? 'job.wed.stage.bell_npc' : 'job.wed.stage.bell', P);
    return t(`job.wed.need.${m[0]}`, P);
  },
  checklist(g, j) {
    const D = j.data, P = counts(j), rows = [[!!D.arch, t('job.wed.check.arch')]];
    if (!isNpc(j)) rows.push([P.rings >= RINGS, t('job.wed.check.rings', P)]);
    rows.push([P.feast >= FEAST_N, t('job.wed.check.feast', P)], [P.guests >= GUESTS_MIN, t('job.wed.check.guests', P)]);
    return rows;
  },
  // (twice a second, for the job you are in) Where it goes now
  tell(g, j) {
    const was = local.told.get(j.id);
    if (was !== j.stage) { local.told.set(j.id, j.stage); if (j.stage === 'ceremony' && was !== undefined && G?.far) hud.toast(t('job.wed.far'), 'social'); }
  },
  // (twice a second, with or without a job) The ring of an engagement, given and taken once; the rings back from a wedding that
  // went wrong; what this game shows of a ceremony
  each(g) {
    const M = g.missions, F = famOf(g), id = me(), day = g.days?.realDay ?? 0;
    for (const e of engagedList(F)) {
      if ((e.a !== id && e.b !== id) || day - (e.day | 0) > ENGAGE_DAYS) continue;
      const mine = M.mineOf(`eng:${e.id}`);
      if (mine.ring) continue;
      mine.ring = day;
      if (e.a === id) { if (g.inv.count('ring')) g.inv.remove('ring', 1); }
      else { const left = g.inv.add('ring', 1); if (left) g.gather.throwOut('ring', left); hud.toast(t('job.wed.ring_got', { name: g.live?.nameOf?.(e.a) || '?' }), 'good'); }
      g.onSave?.();
    }
    // (what you gave, back from a wedding that went wrong, or that you left: once)
    // (back: what each one who left had given, all of it in the end; got: how much of it this game already took)
    for (const j of M.jobs()) {
      if (j.kind !== 'wedding' && j.kind !== 'wedding_npc') continue;
      const B = j.data?.back?.[id], F2 = j.done && j.done.outcome !== 'ok' ? j.data?.gave?.[id] : null;
      if (!isMap(B) && !isMap(F2)) continue;
      const mine = M.mineOf(j.id), got = (mine.got ||= {}), L = [];
      if (isMap(B)) for (const k of GIVE) { const n = (B[k] | 0) - (got[k] | 0); if (n > 0) { L.push([k, n]); got[k] = (got[k] | 0) + n; } }
      if (isMap(F2) && !mine.back) { mine.back = day; for (const k of GIVE) if ((F2[k] | 0) > 0) L.push([k, F2[k] | 0]); }
      if (!L.length) continue;
      backTo(g, L);
      hud.toast(t('job.wed.given_back'), 'social');
      g.onSave?.();
    }
    this.pending(g);
    gathering(g);
    if (G) this.show(g);
    return !!G;
  },
  // The ceremony as this game sees it: the bell, Nilo's words, the couple's «I do», the kiss and the petals
  show(g) {
    const M = g.missions, j = M.get(G.jid), p = g.player;
    if (!j || !p || g.scene !== g.world) return;
    const D = j.data, A = D.arch || G.A, near = Math.hypot(nearX(A.x, p.x) - p.x, A.y - p.y), s = (now() - G.at) / 1000, key = `${j.id}:${G.at}`;
    if (near > SEE_R) return;
    if (!local.bells.has(key) && s < 5) { local.bells.add(key); bells(3); }
    const said = local.lines.get(key) || 0, n = g.world.nilo;
    const lines = tList(isNpc(j) ? 'job.wed.speech_npc' : 'job.wed.speech');
    for (let i = said; i < SPEECH.length && s >= SPEECH[i] && !j.done; i++) {
      local.lines.set(key, i + 1);
      if (s < SPEECH[i] + HOP * 2 && n && lines[i]) g.social?.say(n, lines[i], { name: 'Nilo', life: 4.4 });
    }
    if (isNpc(j) && !j.done) {
      const L = local.lines.get(key + ':npc') || 0;
      NPC_VOWS.forEach((at, i) => { if (L <= i && s >= at && s < at + HOP * 2) { local.lines.set(key + ':npc', i + 1); const who = g.neighbors.people.find(q => q.id === NPC_PAIR[i]); if (who && !who.hidden) g.social?.say(who, t(`job.wed.npc_vow.${NPC_PAIR[i]}`), { name: PEOPLE[NPC_PAIR[i]].name, life: 3.4 }); } });
    }
    // (yours, of the couple: «I do» once Nilo has spoken, if you are there)
    if (!isNpc(j) && !j.done && j.stage === 'ceremony' && (D.pair || []).includes(me()) && !(D.vows || []).includes(me()) && s >= VOW_FROM_S && local.asked !== key && near <= VOW_R && !g.windowsOpen) {
      local.asked = key;
      this.askVow(g, j);
    }
    if (j.done?.outcome === 'ok' && !local.kissed.has(j.id) && now() - j.done.at < LINGER_S * 1000) {
      local.kissed.add(j.id);
      burst(A); bells(5, 0.9, 1); Audio.love?.();
      if (isNpc(j)) for (const [i, id] of NPC_PAIR.entries()) { const who = g.neighbors.people.find(q => q.id === id), other = g.neighbors.people.find(q => q.id === NPC_PAIR[1 - i]); if (who && other) { who.faceTo(other.x - who.x, other.y - who.y); g.social?.emote(who, 'kiss', { local: true }); } }
      else if ((j.done.pair || []).includes(me())) {
        const o = peerOf(g, j.done.pair.find(x => x !== me()))?.peer?.entity;
        if (o && Math.hypot(nearX(o.x, p.x) - p.x, o.y - p.y) < 6) { p.faceTo(nearX(o.x, p.x) - p.x, o.y - p.y); g.social?.emote(p, 'kiss'); }
      }
      hud.toast(t(isNpc(j) ? 'job.wed.just_npc' : 'job.wed.just'), 'good');
    }
  },
  async askVow(g, j) {
    const other = nameOf(g, otherOf(j));
    const k = await hud.ask('Nilo', t('job.wed.vow_q', { name: other }), [t('job.wed.vows'), t('job.wed.wait')], { timeout: 90, pick: 1 });
    if (k === 0) this.vow(g);
  },
  vow(g) { g.missions.event('vow', {}, ok => { if (ok) { Audio.unlock(); hud.toast(t('job.wed.vowed'), 'good'); } else Audio.error(); }); },
  // Give things to the wedding (the rings to Nilo, the feast to Anselmo): out of the backpack now, asked for with an id and kept
  // in the save until the answer is in the job (pending)
  give(g, what) {
    const M = g.missions, j = M.active, out = {};
    if (!j || (j.kind !== 'wedding' && j.kind !== 'wedding_npc')) return false;
    for (const k of GIVE) { const n = Math.min(what[k] | 0, needOf(j, k), g.inv.count(k)); if (n > 0) { g.inv.remove(k, n); out[k] = n; } }
    if (!Object.keys(out).length) return false;
    const rid = Math.random().toString(36).slice(2, 12), mine = M.mineOf(j.id);
    mine.pend = [...(Array.isArray(mine.pend) ? mine.pend : []), { rid, what: out, at: now() }];
    g.onSave?.();
    this.send(g, j, mine.pend.at(-1));
    return true;
  },
  send(g, j, P) { P.sent = now(); g.missions.ask({ ev: 'give', jid: j.id, rid: P.rid, what: P.what }, () => { this.pending(g); }); },
  // Each request given and not yet seen answered: settled from the job (what was not taken comes back), sent again after a while,
  // or all back if the job is no more or is over without it
  pending(g) {
    const M = g.missions;
    for (const [jid, mine] of Object.entries(M.mine)) {
      if (!Array.isArray(mine?.pend) || !mine.pend.length) continue;
      const j = M.get(jid), keep = [];
      for (const P of mine.pend) {
        const took = j?.data?.recv?.[P.rid];
        if (isMap(took)) { backTo(g, GIVE.map(k => [k, (P.what[k] | 0) - (took[k] | 0)])); continue; }
        // (a job not here yet may only be on its way to this game: given up for lost after ten minutes)
        if (j ? j.done || j.stage !== 'prepare' || !j.crew.includes(me()) : now() - (P.at || 0) > LOST_MS) { backTo(g, GIVE.map(k => [k, P.what[k] | 0])); continue; }
        if (!j) { keep.push(P); continue; }
        if (now() - (P.sent || 0) > RESEND_MS) this.send(g, j, P);
        keep.push(P);
      }
      if (keep.length !== mine.pend.length) { mine.pend = keep; g.onSave?.(); }
    }
  },
  frame(g, dt) { if (G) niloFrame(g, dt); },

  // ---------- the arch (game.js placedAction) ----------
  archAction(g, o, pick) {
    if (!ON || g.scene !== g.world || !o.tile) return pick;
    const M = g.missions, j = M.active;
    if (!j || (j.kind !== 'wedding' && j.kind !== 'wedding_npc')) return pick || { text: t('job.wed.arch_idle'), run: () => {} };
    const D = j.data, A = archOf(o), ours = D.arch && D.arch.tile[0] === o.tile[0] && D.arch.tile[1] === o.tile[1];
    if (j.stage === 'ceremony') {
      if (ours && !isNpc(j) && (D.pair || []).includes(me()) && !(D.vows || []).includes(me()) && now() >= D.ceremonyAt) return { text: t('job.wed.vows_act'), run: () => this.vow(g), alt: pick };
      return pick || { text: t('job.wed.arch_now'), run: () => {} };
    }
    if (!ours) return { text: t('job.wed.arch_here'), run: () => M.event('arch', { tile: A.tile }, ok => { if (ok) { Audio.unlock(); hud.toast(t('job.wed.arch_set'), 'good'); } else Audio.error(); }), alt: pick };
    const m = missing(j);
    if (m.length) return { text: t('job.wed.arch_missing', { what: m.map(k => t(`job.wed.short.${k}`)).join(', ') }), run: () => { Audio.error(); hud.toast(t(`job.wed.need.${m[0]}`, this.params(g, j)), 'warn'); }, alt: pick };
    return { text: t('job.wed.bell'), run: () => M.event('bell', {}, (ok, extra) => { if (ok) Audio.unlock(); else { Audio.error(); hud.toast(t(extra?.why === 'both' ? 'job.wed.need_both' : 'job.no'), 'warn'); } }), alt: pick };
  },

  // ---------- the proposal: the ring in the hand, E on the other player ----------
  aimables(g, p, box) {
    if (!ON || g.inv?.held?.id !== 'ring' || !g.live?.joined) return null;
    const F = famOf(g), out = [];
    for (const [conn, q] of g.live.peers) {
      const e = q.entity;
      if (!e || !q.playing || q.server || q.sc !== 'world' || !q.id || Math.hypot(nearX(e.x, p.x) - p.x, e.y - p.y) > PROPOSE_R) continue;
      if (married(F, me(), q.id) || engagedTo(F, me()) === q.id) continue;
      out.push({ kind: 'sys', e: null, box: box(e.x, e.y, 0.4, 0.4, 0, 1.75), act: () => ({ text: t('job.wed.propose', { name: q.name }), run: () => this.askHand(g, conn, q) }) });
    }
    return out;
  },
  interact(g, p) { return this.aimables(g, p, () => null)?.[0]?.act() || null; },
  askHand(g, conn, q) {
    const F = famOf(g);
    if (!g.inv.count('ring')) return;
    if (marriedAny(F, me()) || marriedAny(F, q.id) || engagedTo(F, me()) || engagedTo(F, q.id)) { Audio.error(); hud.toast(t('job.wed.no_propose'), 'warn'); return; }
    g.live.net?.send({ t: 'wed', ev: 'ask' }, conn);
    local.proposedTo = { id: q.id, at: g.time };
    Audio.blip();
    hud.toast(t('job.wed.proposed', { name: q.name }), 'social');
  },
  // (live.js 'wed') The other player's game: { ev: 'ask' | 'yes' | 'no' }. Texts never travel: each game says its own
  async heard(g, conn, peer, m) {
    if (!ON || !peer?.id || !g.player) return;
    if (m.ev === 'ask') {
      if (local.wait) return;
      local.wait = true;
      try {
        const k = await hud.ask(peer.name, t('job.wed.asked', { name: peer.name }), [t('job.wed.yes'), t('job.wed.no')], { timeout: ASK_S, pick: 1 });
        if (k !== 0) { g.live.net?.send({ t: 'wed', ev: 'no' }, conn); return; }
        this.engage(g, peer.id, ok => {
          g.live.net?.send({ t: 'wed', ev: ok ? 'yes' : 'no' }, conn);
          if (ok) { Audio.love?.(); hud.toast(t('job.wed.engaged', { name: peer.name }), 'good'); this.hearts(g, peer.entity); } else Audio.error();
        });
      } finally { local.wait = false; }
      return;
    }
    if ((m.ev === 'yes' || m.ev === 'no') && local.proposedTo?.id === peer.id) {
      local.proposedTo = null;
      if (m.ev === 'yes') { Audio.love?.(); hud.toast(t('job.wed.engaged', { name: peer.name }), 'good'); this.hearts(g, peer.entity); }
      else hud.toast(t('job.wed.said_no', { name: peer.name }), 'social');
    }
  },
  hearts(g, e) { const p = g.player, F = g.family; if (!p || !F) return; const x = e ? (p.x + nearX(e.x, p.x)) / 2 : p.x, y = e ? (p.y + e.y) / 2 : p.y; F.hearts.push({ x, y, z: 2.1, t: 0, life: 3.5, s: 0.3, big: true, ph: 0 }); },
  // Ask whoever decides to write the engagement (who said yes asks: by = them, to = who proposed)
  engage(g, to, done) {
    const M = g.missions, c = { k: 'wed', ev: 'engage', to };
    if (M.decides()) { let ok = false; try { ok = CLAIMS.wed(g, { by: me(), ...c }, null, '', {}); } catch (e) { reportFault(e, 'wedding.engage'); } done(!!ok); return; }
    g.barrow.claim('wed', boardKey(g), c, v => done(!!v?.ok));
  },
};
const boardKey = g => g.missions.boardKey();
function backTo(g, L) { for (const [k, n] of L) if (n > 0 && ITEMS[k]) { const left = g.inv.add(k, n); if (left) g.gather?.throwOut?.(k, left); } }
const counts = j => ({ rings: ringsIn(j.data), m: RINGS, feast: feastIn(j.data), f: FEAST_N, guests: (j.data.guests || []).length, g: GUESTS_MIN });
const otherOf = j => (j.data.pair || []).find(x => x !== me()) || null;
const nameOf = (g, id) => (!id ? '' : id === me() ? g.player?.name || '' : g.live?.nameOf?.(id) || '?');

// The neighbours' wedding: the same, for Marta and Eusebio, once per world, 400 coins each
export const weddingNpc = {
  ...wedding, id: 'wedding_npc', pay: PAY_NPC, payText: null,
  each: null, frame: null, aimables: null, interact: null,   // (the couple's kind does those for both)
  closed: j => j.stage !== 'prepare',
  hidden: g => !ON || !!partnerOf(famOf(g), me()),
  why: g => (npcDone(famOf(g)) ? 'once' : null),
  propose: () => ({}),
  start(g, j) {
    if (npcDone(famOf(g))) return false;
    j.site = { x: NILO.x, y: NILO.y };
    j.data = { gave: {}, guests: [] };
    return true;
  },
  quitted() {},
};

// (whoever decides) The engagement: both online, near each other, neither married nor engaged
CLAIMS.wed = (g, c) => {
  if (c.ev !== 'engage' || typeof c.by !== 'string' || typeof c.to !== 'string' || !c.by || c.by === c.to) return false;
  const F = g.family?.v;
  if (!F) return false;
  if (engagedList(F).some(e => pairIs(e, c.by, c.to))) return true;
  if (marriedAny(F, c.by) || marriedAny(F, c.to) || engagedTo(F, c.by) || engagedTo(F, c.to)) return false;
  const a = posOf(g, c.by), b = posOf(g, c.to);
  if (!a || !b || Math.hypot(dxOf(a[0], b[0]), a[1] - b[1]) > PROPOSE_R + 2) return false;
  F.engaged = [...engagedList(F), { id: Math.random().toString(36).slice(2, 10), a: c.to, b: c.by, day: g.days.realDay }];
  g.onSave?.();
  return true;
};

// ---------- the talks: the rings to Nilo, the feast to Anselmo, the invitations ----------
const wedJob = c => { const j = c.game.missions?.active; return ON && j && (j.kind === 'wedding' || j.kind === 'wedding_npc') && j.stage === 'prepare' ? j : null; };
const ringsFor = c => { const j = wedJob(c); return j && !isNpc(j) ? Math.min(needOf(j, 'ring'), c.game.inv.count('ring')) : 0; };
const feastFor = c => { const j = wedJob(c), out = {}; if (!j) return out; for (const k of Object.keys(FEAST)) { const n = Math.min(needOf(j, k), c.game.inv.count(k)); if (n > 0) out[k] = n; } return out; };
talkOptions.add({ id: 'wed_rings', order: 44, when: c => c.id === 'nilo' && ringsFor(c) > 0, label: c => t('job.wed.give_rings', { n: ringsFor(c) }),
  run: c => { wedding.give(c.game, { ring: ringsFor(c) }); return c.talk.say(c.id, [t('job.wed.rings_taken')]); } });
talkOptions.add({ id: 'wed_feast', order: 44, when: c => c.id === 'anselmo' && !c.cold && Object.keys(feastFor(c)).length > 0, label: () => t('job.wed.give_feast'),
  run: c => { wedding.give(c.game, feastFor(c)); return c.talk.say(c.id, [t('job.wed.feast_taken')]); } });
talkOptions.add({ id: 'wed_invite', order: 43, when: c => { const j = wedJob(c); return !!j && !c.cold && c.id !== 'nilo' && !(isNpc(j) && NPC_PAIR.includes(c.id)) && !(j.data.guests || []).includes(c.id) && (j.data.guests || []).length < GUESTS_MAX && c.game.neighbors.hearts(c.id) >= GUEST_HEARTS; },
  label: c => t(isNpc(wedJob(c)) ? 'job.wed.invite_npc' : 'job.wed.invite'),
  run: c => { c.game.missions.event('invite', { npc: c.id }, ok => { if (!ok) { Audio.error(); hud.toast(t('job.no'), 'warn'); } }); const L = tList('job.wed.invited'); return c.talk.say(c.id, [L[Math.floor(Math.random() * L.length)] || '']); } });
