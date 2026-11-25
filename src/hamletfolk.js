// The people of the places of now (docs/planes/realismo/PLAN-R7-mundo.md §3.6.3; R7-3): one to three residents in a hamlet, the keeper
// of a lighthouse where somebody lives, the shepherd of the fold. Always the same ones for the same place (their names and looks
// come from its id), each with a day of its own by the hour: at work by day, in the square at evening, home at night. Nothing of them is
// saved or sent: every game works out the same. They greet and tell of the land; they have no friendship.
import { ihash } from './util.js';
import { Person } from './entities.js';
import { dxOf } from './world/planet.js';
import { dirOf8 } from './lookout.js';
import { hud } from './ui/hud.js';
import { t } from './i18n.js';

const NAMES = { chico: ['Aurelio', 'Benito', 'Celso', 'Donato', 'Eladio', 'Fermín', 'Gaspar', 'Hilario', 'Isidro', 'Julián', 'Laureano', 'Matías', 'Nicasio', 'Pascual', 'Quintín', 'Ramiro', 'Saturnino', 'Teófilo', 'Valentín', 'Zacarías'], chica: ['Águeda', 'Benita', 'Casilda', 'Dorotea', 'Eulalia', 'Felisa', 'Gregoria', 'Herminia', 'Jacinta', 'Leonor', 'Martina', 'Nicolasa', 'Obdulia', 'Petra', 'Remedios', 'Sabina', 'Teodora', 'Úrsula', 'Vicenta', 'Zoila'] };
const SKIN = ['#f6c9a0', '#c98a5a', '#8a5234', '#e8b07a', '#f0c8a8'], HAIR = ['#2a1e1e', '#5a3a24', '#a8442a', '#c9a060', '#8a8480'], CLOTH = { fishing: ['#3f5f7a', '#6a7d86', '#8a8f86'], shepherds: ['#8a7458', '#6f5c48', '#9a8a70'], woodcutters: ['#8a4438', '#5c6b48', '#7a5a3c'], miners: ['#5a5a58', '#6f5f4c', '#4d5560'], farmers: ['#8a7a4c', '#a0664a', '#6c7a58'], keeper: ['#2e4460'] };
const WALK = 1.15, NEAR = 70;    // m/s; how far their walking is looked at
const LINES = 3;                 // lines of each trade; and any
const NIGHT = [21.5, 6.5];

function lookOf(id, i, trade, named) {
  const r = k => ihash(id, 60 + i * 20 + k, 7177), sex = named || r(1) < 0.5 ? 'chico' : 'chica', of = (l, k) => l[Math.floor(r(k) * l.length)];
  return { name: of(NAMES[sex], 2), look: { sex, skin: of(SKIN, 3), hair: of(HAIR, 4), eyes: '#3a2a1e', cloth: of(CLOTH[trade] || CLOTH.farmers, 5), pants: r(6) < 0.5 ? '#3a3a3a' : '#4a3f33', hairStyle: sex === 'chico' ? 'corto' : of(['largo', 'mono'], 7), outfit: 'larga' } };
}
// Those of a place (made the first time), or null. here: is it outdoors now?
export function residentsOf(places, poi) {
  const F = (places.folk ||= new Map());
  let list = F.get(poi.key);
  if (list !== undefined) return list;
  const L = places.planOf(poi);
  list = null;
  const make = (i, trade, stops, name) => { const q = lookOf(poi.id, i, trade, name), who = new Person({ x: stops.work[0], y: stops.work[1], look: q.look }); return Object.assign(who, { name: name || q.name, trade, stops, here: false, resident: true, place: poi.key, at: null, path: [] }); };
  if (poi.kind === 'aldea' && poi.form && L) {
    const homes = L.homes.filter(h => !h.empty), n = Math.min(3, homes.length, L.work.length, 1 + Math.floor(ihash(poi.id, 51, 7177) * 3));
    list = [];
    for (let i = 0; i < n; i++) {
      const sq = [[-2.4, 1.6], [3.2, 1.2], [0.4, 3.2]][i], q = L.q || 0, [a, b] = q === 1 ? [sq[1], -sq[0]] : q === 2 ? [-sq[0], -sq[1]] : q === 3 ? [-sq[1], sq[0]] : sq;
      list.push(make(i, L.specialty, { work: L.work[i], home: homes[i].door, square: [Math.floor(poi.x) + a, Math.floor(poi.y) + b, 0], mid: [Math.floor(poi.x) + 0.5, Math.floor(poi.y)] }));
    }
  } else if (poi.kind === 'faro' && poi.form && poi.lived) {
    const door = [poi.x + 2.2, poi.y + 3.5, 0], home = L?.homes?.[0]?.door || [poi.x, poi.y + 1.9];
    list = [make(0, 'keeper', { work: door, home, square: [poi.x - 1.6, poi.y + 3.2, 2.6], mid: null }, poi.hito ? 'Tomás' : null)];
  } else if (poi.hito === 'majada' && L) list = [make(0, 'shepherds', { work: L.work[0], home: [poi.x - 5.5, poi.y + 1.2], square: [poi.x - 3.4, poi.y + 2.4, 0.4], mid: null })];
  F.set(poi.key, list);
  return list;
}
// Where one is at this hour: 'work', 'square' or 'home' (indoors)
export function stopAt(h, i = 0) { h -= i * 0.4; return h >= NIGHT[0] || h < NIGHT[1] ? 'home' : h < 13 ? 'work' : h < 14.5 ? 'home' : h < 19 ? 'work' : 'square'; }
export function updateResidents(places, dt) {
  const g = places.game, p = g.player, h = g.days?.localHour ?? 12;
  for (const list of places.folk?.values() || []) for (const [i, who] of (list || []).entries()) {
    const far = Math.hypot(dxOf(who.x, p.x), who.y - p.y) > NEAR, want = stopAt(h, i), to = who.stops[want];
    if (who.at === null || (far && who.at !== want)) { who.x = to[0]; who.y = to[1]; who.at = want; who.path.length = 0; who.here = want !== 'home'; who.vx = who.vy = 0; if (to[2] !== undefined) who.faceTo(Math.sin(to[2]), Math.cos(to[2])); continue; }
    if (who.at !== want) { who.at = want; who.here = true; who.path = who.stops.mid && Math.hypot(who.x - to[0], who.y - to[1]) > 9 ? [who.stops.mid, to] : [to]; }
    if (!who.path.length) { who.vx = who.vy = 0; continue; }
    const q = who.path[0], dx = q[0] - who.x, dy = q[1] - who.y, d = Math.hypot(dx, dy), step = WALK * dt;
    if (who.talking || Math.hypot(p.x - who.x - dx / (d || 1) * 0.6, p.y - who.y - dy / (d || 1) * 0.6) < 0.5) { who.vx = who.vy = 0; continue; }   // (one does not walk through you)
    if (d <= Math.max(0.05, step)) {
      who.x = q[0]; who.y = q[1]; who.path.shift();
      if (!who.path.length) { who.vx = who.vy = 0; if (want === 'home') who.here = false; else if (q[2] !== undefined) who.faceTo(Math.sin(q[2]), Math.cos(q[2])); }
      continue;
    }
    who.vx = dx / d * WALK; who.vy = dy / d * WALK; who.x += who.vx * dt; who.y += who.vy * dt; who.faceTo(dx, dy);
    who.step += step * 3.2;
  }
}
// A few words with one of them: of their trade, of anything or of a place they know (the nearest you have not been to)
export async function talkTo(places, poi, who) {
  const g = places.game, p = g.player, n = (who.said = (who.said ?? Math.floor(ihash(poi.id, Math.floor(p.x * 3), 9) * 3)) + 1), old = who.dir;
  who.talking = true;
  who.faceTo(p.x - who.x, p.y - who.y);
  let line = null;
  if (n % 3 === 0) {
    const q = places.nearest(poi.x, poi.y, ['torre', 'faro', 'templo', 'cueva', 'campamento', 'manantial', 'arbol', 'mina', 'barco'], 1200, new Set([...places.found, poi.key]));
    if (q) line = t('folk.rumour', { place: places.title(q), dir: t(`place.dir.${dirOf8(dxOf(q.x, poi.x), q.y - poi.y)}`) });
  }
  line ||= n % 2 ? t(`folk.${who.trade}.${1 + (n >> 1) % LINES}`) : t(`folk.any.${1 + (n >> 1) % LINES}`);
  g.busy = true;
  await hud.say(who.name, [line]);
  g.busy = false;
  who.talking = false;
  if (old && !who.path.length) who.faceTo(...old);
}
