// The tools you carry, seen on your body (third person, and by the other players through the network): which ones and
// where they go. Only logic, no THREE: the tests can check it and the drawing (three/kit3d.js, actors.js) follows it.
// One of each kind (the first in slot order: the hotbar, then the backpack), at most four tools and the quiver (when you
// carry arrows). Each kind has its places and takes the first one free; the one you hold leaves its gap (you took the
// pickaxe off your back, so your back has no pickaxe) and nothing moves when you switch slots: the places are shared
// out with everything you carry, the one in hand too, and only change when you pick up, drop or move tools around, or
// put the backpack on or off.
import { ITEMS } from './items.js';

// The places: two diagonals across the back (A and B, crossed), the left and right hip, the quiver on the right shoulder
// blade and, with a backpack, its side (for the watering can)
export const KIT_SPOTS = {
  arco: ['backA', 'backB'],
  espada: ['hipL'],
  hacha: ['hipR', 'backA', 'backB'],
  pico: ['backA', 'backB'],
  guadana: ['backA', 'backB'],
  pala: ['backB', 'backA'],
  azada: ['backB', 'backA'],
  cana: ['backB', 'backA'],
  red: ['backB', 'backA'],
  regadera: ['hipR'],
  hammer: ['hipL', 'hipR'],
};
export const BACK_SPOTS = new Set(['backA', 'backB', 'quiver', 'bagSide']);   // (hang from the chest bone; the rest from the hip)
export const MAX_TOOLS = 4;
// Arms busy with something big (carry.js, with the weight inventory, the default; null otherwise): 'across' (a bundle over both shoulders)
// hides both diagonals, 'shoulder' (a log on the right shoulder) only the diagonal that rests there; both hide the
// quiver, which is on the right shoulder too (its arrows would come out through the bundle)
const BUSY_HIDES = { across: ['backA', 'backB', 'quiver'], shoulder: ['backB', 'quiver'] };
const ARROWS = 'flecha', MANY_ARROWS = 10;
const EMPTY = Object.freeze([]);

// The kind of a tool (null: it is not one). The shovel full of earth is a shovel
export function kindOf(id) {
  const d = id && ITEMS[id];
  return !d ? null : d.bow ? 'arco' : d.weapon ? 'espada' : KIT_SPOTS[d.tool] ? d.tool : null;
}
// Everything you carry that shows: one id per kind in slot order (the one in hand too, so nothing moves when you switch),
// and the arrows last ('flecha', or 'flecha:6' with ten or more: six feathers in the quiver instead of three). It only
// reads the slots you can use, never the one selected
export function kitOf(inv) {
  const out = [], seen = new Set(), cap = inv.cap;
  for (let i = 0; i < cap; i++) {
    const s = inv.slots[i], k = s && kindOf(s.id);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(ITEMS[s.id].empty || s.id);   // (the full shovel is shown empty: a heap of earth on the back makes no sense)
  }
  const n = inv.count(ARROWS);
  if (n > 0) out.push(n >= MANY_ARROWS ? `${ARROWS}:6` : ARROWS);
  return out;
}
export const kitKey = ids => ids.join(',');
// What travels by the network, back into ids (the ones this game does not know, from a newer version, are left out).
// Cached: the same text gives the same array, so nothing is rebuilt
const SPLIT = new Map();
export function splitKit(key) {
  if (!key) return EMPTY;
  let ids = SPLIT.get(key);
  if (!ids) {
    ids = key.slice(0, 160).split(',').slice(0, 12).filter(t => (t === ARROWS || t.startsWith(ARROWS + ':')) || kindOf(t));
    if (SPLIT.size > 200) SPLIT.clear();
    SPLIT.set(key, ids);
  }
  return ids;
}
// Where each goes: [{ id, kind, spot }], at most four tools and the quiver. Deterministic: who sends and who receives
// place the same with the same ids, so only the ids travel
export function placeKit(ids, { bag = false } = {}) {
  const out = [], used = new Set();
  // (the sword has only the left hip: the hammer leaves it)
  const sword = ids.some(id => kindOf(id) === 'espada');
  let arrows = null;
  for (const id of ids) {
    if (id === ARROWS || id.startsWith(ARROWS + ':')) { arrows = id; continue; }
    if (out.length >= MAX_TOOLS) continue;
    const kind = kindOf(id), spots = kind === 'regadera' && bag ? ['bagSide'] : KIT_SPOTS[kind];
    const spot = spots?.find(s => !used.has(s) && !(sword && kind === 'hammer' && s === 'hipL'));
    if (!spot) continue;
    used.add(spot);
    out.push({ id, kind, spot });
  }
  if (arrows) out.push({ id: arrows, kind: ARROWS, spot: 'quiver' });
  return out;
}
// What is drawn now: without the place of the kind in hand (swimming, the hand is empty and it goes back to its place),
// nothing lying down or sitting (through the bed, the backrest, the seat or the ground), and riding (a horse, a boat)
// nothing at the hips (through the saddle or the bench). The sword drawn leaves its scabbard hanging (SCABBARD).
// arms: see BUSY_HIDES (with the arms busy, the tool in hand hangs in its place too)
export const SCABBARD = 'espada:vaina';
const HIP_SPOTS = new Set(['hipL', 'hipR']);
export function shownOf(placed, held, { swimming = false, pose = null, arms = null } = {}) {
  if (pose === 'lie' || pose === 'floorLie' || pose === 'sit' || pose === 'floorSit') return EMPTY;
  const hk = swimming || arms ? null : kindOf(held), hide = BUSY_HIDES[arms] || EMPTY, ride = pose === 'ride';
  let out = null;
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i], gone = hide.includes(p.spot) || (ride && HIP_SPOTS.has(p.spot));
    const swap = !gone && p.kind === hk && hk === 'espada' ? { ...p, id: SCABBARD } : null;
    if (!gone && p.kind !== hk) { if (out) out.push(p); continue; }
    if (!out) out = placed.slice(0, i);
    if (swap) out.push(swap);
  }
  return out || placed;
}
// The kind of pose that changes what shows or where (for the key of what is drawn): lying, sitting, riding (a horse, a
// boat: the back ones go higher, over the saddle) and crouching (the hip ones tilt back, off the ground)
export const poseClass = (kind, { ride = false, crouch = false } = {}) => (kind === 'lie' || kind === 'floorLie' ? 'lie' : kind === 'sit' || kind === 'floorSit' ? 'sit' : ride ? 'ride' : crouch ? 'crouch' : '');
