// The places an old world keeps (docs/planes/realismo/PLAN-R7-mundo.md §3.3). Until 2026-11-24 every chunk rolled its own
// place (sites.js, LegacyPlaces); now they are few and sited. So that nothing the players made, used or know is moved or
// covered, whoever runs the world (the host, or the game alone) writes this list once, the first time it opens it:
//   places1 = { v: 2, k: { "cx,cy": mark } }, shared by all (livesync.js), by the key of the place's chunk
//     'torre'    the place of before of that kind stays there as it was: it is next to something built, or its chest was opened
//     'torre*'   the same, only because somebody had found it (KEEP_FOUND: without it, these are no more)
//     'ruinas'   the ruins are gone, but what was built by them keeps its flat ground: a clearing
//     '-'        no new place here: something the players made is there
// With R7-3 the sites of now got their art (hamlets of five trades, camps, temples of columns…) and the ones that had no art yet
// appeared (springs, great trees…). A list of before that is looked at once more, by whoever runs the world (extend), and gets
//   s = { "cx,cy": 'o' | '-' }: the site that keeps the shape it had ('o': something is built in or by what the new one takes up), and
//   the one that does not appear ('-': something is there); and r = 3, that it has been looked at. Without r, every site is as before.
// Pure: the same data give the same list.
import { CHUNK } from './gen.js';
import { wrapIndex, dxOf } from './planet.js';
import { LEGACY_KINDS, READY, LATER, SITE_SIZE, HAMLET_BOX, HAMLET_MAX } from './sites.js';

export const FORM = 3;            // (what the sites look like: R7-3)
export const KEEP_FOUND = false;   // (true: the places somebody had found stay too; false: only those built by or used)
export const NEAR_FROZEN = 48;    // no new place this near one that stays
const COVER = 9;                  // nor with its flattened ground (7 m) this near something made by the players
// What in a chunk's changes is not somebody's work to keep: what was felled, picked, mown, opened or fished there
const NATURE = new Set(['v', 'removed', 'picked', 'frostYear', 'mown', 'opened', 'dived', 'fished', 'firstPick', 'wet', 'moist']);
const full = v => v !== null && v !== undefined && (typeof v !== 'object' || Object.keys(v).length > 0);
// Has somebody made something in this chunk (built, dug, sown, moored, left…)?
export const touched = d => !!d && Object.keys(d).some(k => !NATURE.has(k) && full(d[k]));
export const kindOf = mark => (typeof mark === 'string' ? (mark.endsWith('*') ? (KEEP_FOUND ? mark.slice(0, -1) : null) : mark) : null);
// A places1 as it came from a save or from the network, or null if it is none
export function readPlaces(v) {
  if (!v || typeof v !== 'object' || v.v !== 2 || !v.k || typeof v.k !== 'object') return null;
  const k = {};
  for (const [key, mark] of Object.entries(v.k)) if (/^-?\d{1,5},-?\d{1,5}$/.test(key) && typeof mark === 'string' && (mark === '-' || LEGACY_KINDS.has(mark.replace(/\*$/, '')))) k[key] = mark;
  const out = { v: 2, k };
  if (v.r === FORM) {
    out.r = FORM; out.s = {};
    if (v.s && typeof v.s === 'object') for (const [key, mark] of Object.entries(v.s)) if (/^-?\d{1,5},-?\d{1,5}$/.test(key) && (mark === 'o' || mark === '-')) out.s[key] = mark;
    if (v.b === 0 || v.b === 1) out.b = v.b;   // (is there the stone bridge of the first river? not decided, if absent: bridgeRoom)
  }
  return out;
}
// What a place takes up: [x0, y0, x1, y1]
export function boxOf(p) {
  if (p.kind === 'aldea') { const x = Math.floor(p.x), y = Math.floor(p.y); return [x + HAMLET_BOX[0], y + HAMLET_BOX[1], x + HAMLET_BOX[2], y + HAMLET_BOX[3]]; }
  const r = SITE_SIZE[p.kind] || 2;
  return [p.x - r, p.y - r, p.x + r, p.y + r];
}
export function gap(a, b) {
  const w = dxOf(b[0], a[0]), ex = Math.max(0, w - (a[2] - a[0]), -w - (b[2] - b[0])), ey = Math.max(0, b[1] - a[3], a[1] - b[3]);
  return Math.hypot(ex, ey);
}
// Is this new site too near a place that stays? place(cx, cy, kind): that of the marks (LegacyPlaces.place)
export function nearFrozen(site, marks, legacy) {
  const b = boxOf(site), m = NEAR_FROZEN + 16;
  for (let cy = Math.floor((b[1] - m) / CHUNK); cy <= Math.floor((b[3] + m) / CHUNK); cy++) for (let x = Math.floor((b[0] - m) / CHUNK); x <= Math.floor((b[2] + m) / CHUNK); x++) {
    const cx = wrapIndex(x, CHUNK), kind = kindOf(marks[`${cx},${cy}`]);
    if (kind && kind !== '-' && gap(boxOf(legacy.place(cx, cy, kind)), b) < NEAR_FROZEN) return true;
  }
  return false;
}
// The list of a world. deltas: its changes by chunk; found: the keys of the places its player knew; points: [x, y] that a
// new place may not cover (where the player, the animals and the spawn are)
export function freeze({ sites, legacy, deltas, found = [], points = [] }) {
  const k = {}, busy = new Set();
  for (const [key, d] of deltas) {
    if (key.startsWith('u:')) continue;
    const [cx, cy] = key.split(',').map(Number);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    if (touched(d)) {
      busy.add(`${cx},${cy}`);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const p = legacy.at(cx + i, cy + j); if (p) k[p.key] = p.kind; }
    }
    // (used: its chest was opened. The ruins, only if something was built by them)
    if (full(d?.opened)) { const p = legacy.at(cx, cy); if (p && p.kind !== 'ruinas' && d.opened[p.key]) k[p.key] = p.kind; }
  }
  for (const key of found) {
    if (typeof key !== 'string' || k[key]) continue;
    const [cx, cy] = key.split(',').map(Number), p = Number.isInteger(cx) && Number.isInteger(cy) ? legacy.at(cx, cy) : null;
    if (p && p.kind !== 'ruinas') k[p.key] = p.kind + '*';
  }
  for (const [x, y] of points) if (Number.isFinite(x) && Number.isFinite(y)) busy.add(`${wrapIndex(Math.floor(x / CHUNK), CHUNK)},${Math.floor(y / CHUNK)}`);
  for (const key of busy) {
    const [cx, cy] = key.split(',').map(Number), box = [cx * CHUNK, cy * CHUNK, (cx + 1) * CHUNK, (cy + 1) * CHUNK];
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
      const s = sites.at(cx + i, cy + j);
      if (s && READY.has(s.kind) && !kindOf(k[s.key]) && gap(box, boxOf(s)) < COVER) k[s.key] = '-';   // (also over a 'torre*' that does not stay)
    }
  }
  return { v: 2, k };
}
// Adds the places another player had found before (found: their keys) to a list already made. Not those where a new place
// is by now (somebody may have found it), nor where something has been built since. → the list, or null if nothing changes
export function freezeMore(list, { legacy, deltas, found, siteNear }) {
  const k = { ...list.k };
  let n = 0;
  for (const key of found) {
    if (typeof key !== 'string' || !/^-?\d{1,5},-?\d{1,5}$/.test(key) || (k[key] && (k[key] !== '-' || !KEEP_FOUND))) continue;
    const [cx, cy] = key.split(',').map(Number), p = legacy.at(cx, cy);
    if (!p || p.kind === 'ruinas') continue;
    let busy = false;
    for (let j = -1; j <= 1 && !busy; j++) for (let i = -1; i <= 1; i++) if (touched(deltas.get(`${wrapIndex(cx + i, CHUNK)},${cy + j}`))) { busy = true; break; }
    if (busy || siteNear(p)) continue;
    k[p.key] = p.kind + '*'; n++;
  }
  return n ? { ...list, k } : null;
}
// What a site of now may take up, its ground with it: [x0, y0, x1, y1]
const NEW_R = { campamento: 6, barco: 5, templo: 10, torre: 5, faro: 14, manantial: 3, arbol: 13, risco: 4, salegar: 13, mina: 7 };   // (a spring, a tree or a salt lick may be a landmark's spot)
export function newBox(s) {
  if (s.kind === 'aldea') { const x = Math.floor(s.x), y = Math.floor(s.y); return [x + HAMLET_MAX[0], y + HAMLET_MAX[1], x + HAMLET_MAX[2], y + HAMLET_MAX[3]]; }
  const r = s.kind === 'manantial' ? 13 : NEW_R[s.kind] || 4;
  return [s.x - r, s.y - r, s.x + r, s.y + r];
}
// The list, looked at once more (see above). Nothing of what it said changes
// Is there room for the bridge? (nothing made by anybody where it would go)
export function bridgeRoom(bridge, deltas) {
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const cx = wrapIndex(Math.floor(bridge.x / CHUNK) + i, CHUNK), cy = Math.floor(bridge.y / CHUNK) + j; if (touched(deltas.get(`${cx},${cy}`)) && gap([cx * CHUNK, cy * CHUNK, (cx + 1) * CHUNK, (cy + 1) * CHUNK], [bridge.x - 6, bridge.y - 6, bridge.x + 6, bridge.y + 6]) < COVER) return false; }
  return true;
}
export function extend(list, { sites, deltas, points = [] }) {
  const s = {}, busy = new Set();
  for (const [key, d] of deltas) {
    if (key.startsWith('u:')) continue;
    const [cx, cy] = key.split(',').map(Number);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    if (touched(d)) busy.add(`${cx},${cy}`);
    if (full(d?.opened)) { const q = sites.at(cx, cy); if (q && READY.has(q.kind) && d.opened[q.key] && !list.k[q.key]) s[q.key] = 'o'; }   // (used: its chest was opened)
  }
  for (const [x, y] of points) if (Number.isFinite(x) && Number.isFinite(y)) busy.add(`${wrapIndex(Math.floor(x / CHUNK), CHUNK)},${Math.floor(y / CHUNK)}`);
  for (const key of busy) {
    const [cx, cy] = key.split(',').map(Number), box = [cx * CHUNK, cy * CHUNK, (cx + 1) * CHUNK, (cy + 1) * CHUNK];
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
      const q = sites.at(cx + i, cy + j);
      if (!q || (!READY.has(q.kind) && !LATER.has(q.kind)) || list.k[q.key] || gap(box, newBox(q)) >= COVER) continue;
      s[q.key] = READY.has(q.kind) ? 'o' : '-';
    }
  }
  return { ...list, r: FORM, s };
}
