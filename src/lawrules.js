// The law's numbers (docs/planes/gta/PLAN-H-pueblo-vivo.md §4), with nothing of the game in them: what each crime costs, the levels,
// how a bounty goes down by itself and how long the cell is. And what a player's record may hold: anything else is left out
//   law[playerId] = { name, look, bounty, crimes: [[ms, kind, n, key?]], since, clean (the day of the last crime), cut (the last day it
//     went down), jail: { until (real ms), mins } | null, chases }
export const FINES = { theft_house: 40, theft_stall: 30, shove: 60, shove_constable: 150, evade: 0 };
// The most one of them can cost (what a guest asks for is capped: live.js 'crime')
const MOST = { theft_house: 140, theft_stall: 30, shove: 60, shove_constable: 150, evade: 500 };
export const KINDS = Object.keys(FINES);
export const REPORTED = ['theft_house', 'theft_stall', 'shove', 'shove_constable'];   // (what each game says of itself; evade is the host's)
export const WANTED = 100, HUNTED = 400, BOUNTY_MAX = 2000, CRIMES_KEPT = 12;
export const SIGHT = { fined: 6, wanted: 14, hunted: 24 };       // tiles: how far Ramiro sees you
export const SPEEDS = { walk: 2.6, wanted: 4.3, hunted: 4.6 };   // tiles/s (the player: 3.2 walking, 5.3 sprinting)
export const EVADE = 0.25, SURRENDER = 0.2, MINS_MAX = 5, COINS_A_MIN = 60;
export const DECAY = 0.1, DECAY_MIN = 10, CLEAN_DAYS = 2;

export const levelOf = n => (!(n > 0) ? null : n >= HUNTED ? 'hunted' : n >= WANTED ? 'wanted' : 'fined');
export const fineOf = (kind, n) => { const k = KINDS.includes(kind) ? kind : null, v = Math.round(Number.isFinite(n) ? n : 0); return !k ? 0 : Math.max(FINES[k], Math.min(MOST[k], v)); };
export const minsOf = bounty => Math.max(1, Math.min(MINS_MAX, Math.ceil(bounty / COINS_A_MIN)));
export const surrendered = bounty => Math.max(1, Math.round(bounty * (1 - SURRENDER)));
export const evadeOf = bounty => Math.max(10, Math.round(bounty * EVADE));
// A record as of that day, after what it has gone down since (10 % a day, at least 10 coins, from the second clean day on)
export function decayed(rec, today) {
  const clean = Math.min(rec.clean, today), from = Math.max(Number.isFinite(rec.cut) ? Math.min(rec.cut, today) : -Infinity, clean + CLEAN_DAYS - 1);
  let b = rec.bounty, n = Math.min(400, today - from);
  if (!(n > 0)) return { bounty: b, clean, cut: Number.isFinite(rec.cut) ? Math.min(rec.cut, today) : null, changed: false };
  for (; n > 0 && b > 0; n--) b -= Math.max(DECAY_MIN, Math.round(b * DECAY));
  return { bounty: Math.max(0, b), clean, cut: today, changed: true };
}
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v, a, b, d) => (Number.isFinite(v) ? Math.max(a, Math.min(b, Math.round(v))) : d);
const text = (s, n) => String(typeof s === 'string' ? s : '').replace(/[\u0000-\u001f<>]/g, '').slice(0, n);
export const cleanName = s => text(s, 24);
// A record from outside (a save, the network), whole and within its limits; null if it is not one
export function cleanRecord(r, now = Date.now()) {
  if (!isMap(r) || !(Number.isFinite(r.bounty) && r.bounty > 0)) return null;
  const out = { name: text(r.name, 24), look: isMap(r.look) ? r.look : null, bounty: int(r.bounty, 1, BOUNTY_MAX, 1), crimes: [], since: int(r.since, 0, 1e14, now), clean: int(r.clean, 0, 1e6, 0), jail: null, chases: int(r.chases, 0, 999, 0) };
  if (Number.isFinite(r.cut)) out.cut = int(r.cut, 0, 1e6, 0);
  for (const c of Array.isArray(r.crimes) ? r.crimes.slice(-CRIMES_KEPT) : []) if (Array.isArray(c) && KINDS.includes(c[1]) && Number.isFinite(c[2])) { const q = [int(c[0], 0, 1e14, now), c[1], int(c[2], 0, BOUNTY_MAX, 0)]; if (typeof c[3] === 'string') q.push(text(c[3], 40)); out.crimes.push(q); }
  // (a sentence never runs longer than the longest one, whatever the clock it was written with)
  if (isMap(r.jail) && Number.isFinite(r.jail.until)) { const mins = int(r.jail.mins, 1, MINS_MAX, 1); out.jail = { until: Math.min(Math.round(r.jail.until), now + mins * 6e4), mins }; }
  return out;
}
