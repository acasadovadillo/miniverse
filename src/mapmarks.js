// Your own marks on the map (docs/planes/realismo/PLAN-R8-hud-mapa.md §3.8, §3.10): up to MARKS_MAX, each with one of eight drawings
// and, if you want, a name. They are yours (your save, mapMarks: [{ x, y, g, n? }]; an older game does not know them), and your
// couple (a child together: social.js isPartner) sees them, smaller and in your colour. Interface only: nothing is put in the world.
//
//   marks.list               [{ x, y, g, n?, id }], the oldest first;  marks.full
//   marks.add(x, y, g)       the mark, or null (out of the planet). With MARKS_MAX of them, the oldest goes
//   marks.cycle(m), rename(m, name), remove(m)
//   marks.theirs             conn → { by, id, list }: those other players sent
// Network: { t: 'mk', m: [[x, y, g, n], …] } to your couple only, when they change and to whoever comes in (or becomes your couple); an
// older game ignores it. What arrives is checked, and drawn only while they are your couple (blips.js partner).
import { Profile } from './accounts.js';
import { inPlanet, wrapX } from './world/planet.js';
import { t } from './i18n.js';
import { reportFault } from './faults.js';
import { blips } from './ui/blips.js';
import { accent, ACCENTS } from './ui/skin.js';

export const MARK_GLYPHS = ['star', 'flag', 'tent', 'fish', 'deer', 'ore', 'flower', 'question'];
export const MARKS_MAX = 10, MARK_NAME = 24;
const EVERY = 1, GAP = 0.2;   // (s between two looks at who should have them; s between two messages of a player that are taken)
const r2 = v => Math.round(v * 100) / 100;
const now = () => performance.now() / 1000;
const nameOf = n => (typeof n === 'string' ? n.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MARK_NAME) : '');
let seq = 0;
// A list from a save or from another player: what is right in it
function clean(list) {
  const out = [];
  for (const q of Array.isArray(list) ? list : []) {
    const [x, y, g, n] = Array.isArray(q) ? q : q && typeof q === 'object' ? [q.x, q.y, q.g, q.n] : [];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !inPlanet(x, y)) continue;
    const m = { x, y, g: MARK_GLYPHS.includes(g) ? g : MARK_GLYPHS[0], id: ++seq }, name = nameOf(n);
    if (name) m.n = name;
    out.push(m);
    if (out.length >= MARKS_MAX) break;
  }
  return out;
}

export class MapMarks {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.last = MARK_GLYPHS[0];   // (the drawing of the next one: that of the last you chose)
    this.v = 0;
    this.theirs = new Map();
    this.told = new Map();        // conn → the version it has
    this.at = -Infinity;
  }
  get full() { return this.list.length >= MARKS_MAX; }
  reset(save) { this.list = clean(save?.mapMarks); this.last = MARK_GLYPHS[0]; this.theirs.clear(); this.told.clear(); this.v++; }
  save(out) { if (this.list.length) out.mapMarks = this.list.map(m => ({ x: r2(m.x), y: r2(m.y), g: m.g, ...(m.n ? { n: m.n } : {}) })); }

  add(x, y, g = this.last) {
    x = wrapX(x);
    if (Profile.server || !Number.isFinite(x) || !Number.isFinite(y) || !inPlanet(x, y)) return null;
    while (this.full) this.list.shift();
    const m = { x, y, g: MARK_GLYPHS.includes(g) ? g : MARK_GLYPHS[0], id: ++seq };
    this.list.push(m);
    this.changed();
    return m;
  }
  cycle(m) { m.g = this.last = MARK_GLYPHS[(MARK_GLYPHS.indexOf(m.g) + 1) % MARK_GLYPHS.length]; this.changed(); }
  rename(m, name) { const n = nameOf(name); if (n === (m.n || '')) return; if (n) m.n = n; else delete m.n; this.changed(); }
  remove(m) { const i = this.list.indexOf(m); if (i < 0) return; this.list.splice(i, 1); this.changed(); }
  byId(id) { return this.list.find(m => m.id === id) || null; }
  changed() { this.v++; this.at = -Infinity; }

  // ---------- your couple ----------
  // (game.update, and the map's screen while it is open: src/ui/mapscreen.js)
  update() {
    const T = now();
    if (T - this.at < EVERY) return;
    this.at = T;
    const g = this.game, L = g.live;
    for (const conn of this.theirs.keys()) { const p = L?.peers?.get(conn); if (!p || !p.playing) this.theirs.delete(conn); }
    for (const conn of this.told.keys()) if (!L?.peers?.has(conn)) this.told.delete(conn);
    if (!L?.joined || !L.net || Profile.server) return;
    for (const [conn, peer] of L.peers) {
      if (!peer.playing) { this.told.delete(conn); continue; }   // (back in the menu: told again when they play)
      if (peer.server || this.told.get(conn) === this.v || !g.social?.isPartner?.(peer) || (!this.list.length && !this.told.has(conn))) continue;
      try { L.net.send({ t: 'mk', m: this.list.map(m => (m.n ? [r2(m.x), r2(m.y), m.g, m.n] : [r2(m.x), r2(m.y), m.g])) }, conn); this.told.set(conn, this.v); } catch (e) { reportFault(e, 'MapMarks.update'); }
    }
  }
  heard(conn, peer, m) {
    if (Profile.server || !peer || !m || !Array.isArray(m.m)) return;
    const was = this.theirs.get(conn), T = now();
    if (was && T - was.at < GAP) { was.next = m; clearTimeout(was.timer); was.timer = setTimeout(() => { if (this.theirs.get(conn) === was) this.heard(conn, peer, was.next); }, GAP * 1000 + 20); return; }   // (the last of a burst is the one that counts)
    this.theirs.set(conn, { by: String(peer.name || '').slice(0, 40), id: peer.id || '', list: clean(m.m), at: T });
  }
}

const label = m => m.n || t(`map.marker.${m.g}`);
blips.source('mapmarks', (out, { game, partner }) => {
  const M = game.marks;
  if (!M) return;
  for (const m of M.list) {
    const b = out.add('mark', m.x, m.y);
    b.glyph = m.g; b.color = accent.color; b.name = label(m); b.sub = t('map.card.mark_mine'); b.mark = m.id; b.quick = true;
    b.to = { x: m.x, y: m.y, kind: 'point' };
  }
  for (const [conn, q] of M.theirs) {
    const peer = game.live?.peers?.get(conn);
    if (!peer?.playing || !(partner(q.id) || game.social?.isPartner?.(peer))) continue;
    for (const m of q.list) {
      const b = out.add('mark', m.x, m.y), a = peer.entity?.accent;
      b.glyph = m.g; b.color = Number.isInteger(a) ? ACCENTS[a] || b.color : b.color; b.name = m.n ? `${q.by}: ${m.n}` : q.by; b.sub = t('map.card.mark_of', { name: q.by }); b.who = q.id; b.small = true; b.quick = true;
      b.to = { x: m.x, y: m.y, kind: 'point' };
    }
  }
});
