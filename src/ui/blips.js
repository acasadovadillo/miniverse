// What is on the maps (docs/planes/realismo/PLAN-R8-hud-mapa.md §3.7): the one registry both maps read (and, later, the
// compass strip, the quick places and the legend's filters). A part of the game that wants something on the maps registers a
// source in its own file; nobody edits map.js for a marker.
//
//   blips.source(id, fn)     fn(out, ctx): out.add(kind, x, y) gives a fresh blip to fill in (from a pool: nothing is made per
//                            turn), or out.push(blip) adds one of yours. At most four times a second, and when a map opens.
//                            ctx = { game, me (your player), time, partner(id) (your couple?), ours(owner) (yours or theirs) }
//   blips.static(id, list)   for what hardly changes: the list, put in as it is until it is replaced. null removes either
//   blips.refresh(game, now, force)   asks the sources; blips.list: the blips, higher pri first. blips.v: goes up when
//                            something in it changed (where things are, which, their names)
//   blips.hide               kinds not shown (the big map's filters will fill it)
//
// blip = { kind, x, y (tiles, x inside the planet or not), z? (metres over the ground there), r? (an area: metres), glyph, color, name?, sub?, track?, pri,
//   filter, legend, who? (the owner's id), mini (on the minimap too), to? (where a route to it goes: { x, y, kind, id }),
//   dim? (drawn faded: a closed shop), pin? ('route' | 'shared': drawn as a pin), conn? }
// KINDS gives what each kind has unless the source says otherwise: its glyph, colour, legend group (filter), legend row (a
// text key), pri (what wins when two overlap: the maps drop the lower one closer than a blip) and mini. track holds it on
// the minimap's edge while it is farther.
//
// The couple rule lives here once (players with a child together): your partner's horses, pets and boats are blips of yours
// too; of any other player you see only where they are. Nothing here tells of what is not known: places only once
// discovered (places.found), nobody's boat only where you have been, nothing that lies on the sea bed.
import { Profile } from '../accounts.js';
import { t, getLang } from '../i18n.js';
import { SHOPS } from '../economy.js';
import { HOUSE, HOUSES, TAVERN, DOOR, WALK_NODES, NILO, doorOf, hasProject } from '../world/village.js';
import { PEOPLE } from '../neighbors.js';
import { CHUNK } from '../world/gen.js';
import { wrapIndex, distOf } from '../world/planet.js';
import { ACCENTS, accent } from './skin.js';
import { reportFault } from '../faults.js';

const PLACE_GLYPH = { cueva: 'cave', ruinas: 'ruins', campamento: 'camp', torre: 'tower', barco: 'wreck', templo: 'temple', aldea: 'village', faro: 'lighthouse' };
const PLACE_COL = { cueva: '#cfcbd6', ruinas: '#d8d2c4', campamento: '#ffa860', torre: '#e6dfce', barco: '#d2a273', templo: '#f0cf86', aldea: '#9db8ee', faro: '#ff8a80' };
export const KINDS = {
  home: { glyph: 'home', color: '#ff9a72', filter: 'places', legend: 'gui.map.home', pri: 90, mini: true },
  tavern: { glyph: 'tavern', color: '#ffc46a', filter: 'village', legend: 'gui.map.tavern', pri: 62, mini: true },
  shop: { glyph: 'shop', color: '#9fd8a4', filter: 'village', legend: 'map.legend.shops', pri: 50, mini: true },
  house: { glyph: 'house', color: '#dcc59c', filter: 'village', legend: 'map.legend.houses', pri: 55, mini: false },
  place: { glyph: 'place', color: '#ffffff', filter: 'places', legend: null, pri: 60, mini: true },
  neighbor: { glyph: 'person', color: '#bfe3ff', filter: 'people', legend: 'gui.map.neighbors', pri: 20, mini: false },
  player: { glyph: 'player', color: '#8fb2ff', filter: 'people', legend: 'gui.players.title', pri: 75, mini: true },
  partner: { glyph: 'partner', color: '#ff8fbd', filter: 'people', legend: 'map.legend.partner', pri: 85, mini: true },
  horse: { glyph: 'horse', color: '#e0b27c', filter: 'animals', legend: 'map.legend.horse', pri: 70, mini: true },
  dog: { glyph: 'dog', color: '#e6cfa4', filter: 'animals', legend: 'map.legend.pets', pri: 40, mini: true },
  cat: { glyph: 'cat', color: '#e6cfa4', filter: 'animals', legend: 'map.legend.pets', pri: 39, mini: true },
  boat: { glyph: 'boat', color: '#7fd6d0', filter: 'boats', legend: 'map.legend.group.boats', pri: 45, mini: true },
  goal: { glyph: 'goal', color: '#ffd77a', filter: 'jobs', legend: null, pri: 95, mini: true, track: true },
  route: { glyph: 'pin', color: ACCENTS[0], filter: 'markers', legend: 'map.legend.route', pri: 100, mini: true, track: true, pin: 'route' },
  pin: { glyph: 'pin', color: '#5a8cff', filter: 'markers', legend: 'map.legend.pins', pri: 80, mini: true, pin: 'shared' },
};
const OTHER = { glyph: 'place', color: '#ffffff', filter: 'markers', legend: null, pri: 50, mini: true };
const EVERY = 0.25, BOATS_S = 2;
// The texts, made once per language (they are asked for four times a second)
let texts = new Map(), textsLang = '';
function say(key, what = '', params) {
  if (textsLang !== getLang()) { textsLang = getLang(); texts = new Map(); }
  const k = what ? `${key}|${what}` : key;
  let v = texts.get(k);
  if (v === undefined) texts.set(k, v = t(key, params));
  return v;
}

// (a text's number, remembered: they are the same ones every time)
const hashes = new Map();
function hashOf(s) {
  let h = hashes.get(s);
  if (h === undefined) { h = 17; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; if (hashes.size > 2000) hashes.clear(); hashes.set(s, h); }
  return h;
}

// The list the sources fill: its blips are kept and used again
class Out extends Array {
  pool = []; n = 0;
  start() { this.length = 0; this.n = 0; }
  add(kind, x, y) {
    const b = this.pool[this.n] || (this.pool[this.n] = {}), K = KINDS[kind] || OTHER;
    this.n++;
    b.kind = kind; b.x = x; b.y = y; b.z = undefined; b.r = 0; b.glyph = K.glyph; b.color = K.color; b.name = ''; b.sub = ''; b.track = !!K.track; b.pri = K.pri;
    b.filter = K.filter; b.legend = K.legend; b.who = ''; b.mini = K.mini; b.to = null; b.dim = false; b.pin = K.pin || ''; b.conn = undefined;
    this.push(b);
    return b;
  }
}

export class Blips {
  constructor() {
    this.sources = new Map();
    this.statics = new Map();
    this.out = new Out();
    this.list = [];
    this.hide = new Set();
    this.v = 0; this.key = 0; this.at = -Infinity; this.game = null;
    this.ctx = { game: null, me: null, time: 0, partner: id => this.partner(id), ours: id => this.ours(id) };
    this.stats = { n: 0, ms: 0, max: 0 };
  }
  source(id, fn) { if (fn) this.sources.set(id, fn); else this.sources.delete(id); this.at = -Infinity; }
  static(id, list) { if (list) this.statics.set(id, list); else this.statics.delete(id); this.at = -Infinity; }
  // Your couple, by their id (a child together: social.js); yours or theirs, by the owner's id
  partner(id) { const S = this.game?.social; return !!id && id !== Profile.id && !!(S?.areCouple?.(id, Profile.id) || S?.isPartnerId?.(id)); }
  ours(id) { return !!id && (id === (Profile.id || 'yo') || this.partner(id)); }
  refresh(game, now, force = false) {
    if (!force && game === this.game && Math.abs(now - this.at) < EVERY) return this.list;
    const t0 = performance.now(), O = this.out, C = this.ctx;
    this.game = game; this.at = now;
    O.start();
    C.game = game; C.me = game.player; C.time = game.time;
    for (const [id, fn] of this.sources) { try { fn(O, C); } catch (e) { reportFault(e, `blips.${id}`); } }
    for (const l of this.statics.values()) for (const b of l) O.push(b);
    const L = this.list;
    L.length = 0;
    for (const b of O) if (Number.isFinite(b.x) && Number.isFinite(b.y)) L.push(b);
    L.sort((a, b) => b.pri - a.pri);
    let h = 17;
    const mix = v => { h = (Math.imul(h, 31) + (v | 0)) | 0; }, text = s => mix(hashOf(s));
    for (const b of L) { mix(b.x * 2); mix(b.y * 2); mix(b.dim ? 3 : b.track ? 2 : 1); text(b.kind); text(b.name || ''); text(b.glyph); text(b.color); }
    text(getLang());
    if (h !== this.key) { this.key = h; this.v++; }
    const ms = performance.now() - t0;
    this.stats.n++; this.stats.ms += ms; this.stats.max = Math.max(this.stats.max, ms);
    return L;
  }
  shown(b) { return !this.hide.has(b.kind); }
}
export const blips = new Blips();

// ---------- what there is at launch ----------
blips.source('home', out => {
  const b = out.add('home', (HOUSE.x0 + HOUSE.x1) / 2, (HOUSE.y0 + HOUSE.y1) / 2);
  b.name = say('gui.map.home'); b.to = HOME_TO;
});
const HOME_TO = { ...DOOR, kind: 'place', id: 'home' }, TAVERN_TO = { x: TAVERN.x0 + 5.5, y: TAVERN.y1 + 1, kind: 'place', id: 'tavern' };
blips.source('village', (out, { game }) => {
  const T = out.add('tavern', (TAVERN.x0 + TAVERN.x1) / 2, (TAVERN.y0 + TAVERN.y1) / 2);
  T.name = say('gui.map.tavern'); T.to = TAVERN_TO;
  for (const k in HOUSES) {
    const q = HOUSES[k];
    if (q.project && !hasProject(q.project)) continue;
    const b = out.add('house', (q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2);
    b.name = say('gui.map.house_of', q.name, q); b.to = (q.mapTo ||= { ...doorOf(q), kind: 'place', id: 'house:' + k });
  }
  // The shops, where their keeper works (not those inside the tavern: it has its own), faded while they are closed
  const hour = game.days?.hour ?? 12;
  for (const id in PEOPLE) {
    const def = PEOPLE[id], S = def.shop && SHOPS[def.shop], at = id === 'nilo' ? [NILO.x, NILO.y] : WALK_NODES[def.work];
    if (!S || !at || (def.project && !hasProject(def.project))) continue;
    const b = out.add('shop', at[0], at[1]), h = S.hours[1] > 24 && hour < 6 ? hour + 24 : hour, open = h >= S.hours[0] && h < S.hours[1];
    b.name = say('map.shop_of', def.name, def); b.dim = !open;
    if (S.hours[1] - S.hours[0] < 24) b.sub = open ? say('map.card.open_until', `${S.hours[1] % 24}:00`, { h: `${S.hours[1] % 24}:00` }) : say('map.card.closed', `${S.hours[0]}:00`, { h: `${S.hours[0]}:00` });
    b.to = (def.mapTo ||= { x: at[0], y: at[1], kind: 'point' });
  }
});
// The discovered places (their list is made again only when there is another one)
const found = { of: null, n: -1, lang: '', list: [] };
blips.source('places', (out, { game }) => {
  const F = game.places?.found;
  if (!F) return;
  if (F !== found.of || F.size !== found.n || getLang() !== found.lang) { found.of = F; found.n = F.size; found.lang = getLang(); found.list = game.places.markers(); for (const m of found.list) m.to = { x: m.x, y: m.y, kind: 'place', id: `poi:${Math.floor(m.x / CHUNK)},${Math.floor(m.y / CHUNK)}` }; }
  for (const m of found.list) {
    const b = out.add('place', m.x, m.y);
    b.glyph = PLACE_GLYPH[m.kind] || 'place'; b.color = PLACE_COL[m.kind] || '#ffffff'; b.name = m.name; b.legend = m.legend ||= 'poi:' + m.name; b.sub = say('map.card.explored');
    b.to = m.to;
  }
});
// The other players in the world (not who watches as a spectator, nor who is in a cave), and the neighbours in sight
blips.source('players', (out, { game, partner }) => {
  const L = game.live;
  if (L?.joined) for (const q of L.peers?.values() || []) {
    if (!q.playing || q.server || !q.entity || q.sc !== 'world' || q.entity.gm === 3) continue;
    const mine = partner(q.id), b = out.add(mine ? 'partner' : 'player', q.entity.x, q.entity.y);
    b.name = q.name || ''; b.who = q.id || ''; b.track = mine; b.z = q.entity.z || 0;
    if (Number.isInteger(q.entity.accent)) b.color = ACCENTS[q.entity.accent] || b.color;
    b.to = { x: q.entity.x, y: q.entity.y, kind: 'point' };
  }
  for (const q of game.map?.people || []) { const b = out.add('neighbor', q.x, q.y); b.name = q.name; b.to = { x: q.x, y: q.y, kind: 'point' }; }
});
// Horses, dogs and cats: yours and your partner's (a horse held on the edge while it comes to a whistle, or just out of earshot)
blips.source('animals', (out, { game, me, ours }) => {
  for (const m of game.horse?.marks?.() || []) { const b = out.add('horse', m.x, m.y); b.name = m.name; b.track = !!m.mini; b.to = { x: m.x, y: m.y, kind: 'point' }; }
  for (const a of game.ranch?.animals || []) {
    if ((a.type !== 'perro' && a.type !== 'gato') || !ours(a.owner)) continue;
    const b = out.add(a.type === 'perro' ? 'dog' : 'cat', a.x, a.y);
    b.name = a.name || ''; b.who = a.owner; b.to = { x: a.x, y: a.y, kind: 'point' };
    b.mini = !me || distOf(a.x, a.y, me.x, me.y) > 10;   // (at your feet it would only cover you)
  }
});
// Moored boats: yours and your partner's, and nobody's (from before boats had an owner) only where you have been
const boats = { at: -Infinity, world: null, list: [] };
blips.source('boats', (out, { game, time, ours, partner }) => {
  const w = game.world;
  if (!w?.deltas) return;
  if (w !== boats.world || Math.abs(time - boats.at) > BOATS_S || boats.touches !== w.touches) {
    boats.at = time; boats.world = w; boats.touches = w.touches; boats.list.length = 0;
    for (const d of w.deltas.values()) if (d?.boats) for (const id in d.boats) { const q = d.boats[id]; if (Array.isArray(q)) boats.list.push(q); }
  }
  for (const q of boats.list) {
    const who = typeof q[4] === 'string' ? q[4] : '';
    if (who ? !ours(who) : !game.explored.has(`${wrapIndex(Math.floor(q[0] / CHUNK), CHUNK)},${Math.floor(q[1] / CHUNK)}`)) continue;
    const b = out.add('boat', q[0], q[1]);
    b.who = who; b.name = !who ? say('map.boat.any') : partner(who) ? say('map.boat.partner') : say('map.boat.mine'); b.to = { x: q[0], y: q[1], kind: 'point' };
  }
});
// Where a first step sends you (smarthud.js puts it in map.goal), the marked route's target and the pins others shared
blips.source('marks', (out, { game }) => {
  const R = game.route, G = game.map?.goal;
  if (G) out.add('goal', G.x, G.y);
  if (R?.active) { const b = out.add('route', R.target.x, R.target.y); b.name = R.target.name || ''; b.color = accent.color; }   // (in your colour, like its line)
  if (R?.pins) for (const [conn, q] of R.pins) { const b = out.add('pin', q.x, q.y); b.name = q.own ? q.name : q.name ? `${q.by}: ${q.name}` : q.by; b.conn = conn; }
});
