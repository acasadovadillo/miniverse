// Vecinos del pueblo: cada uno con su casa, su horario (trabajan, pasean, duermen), su manera de hablar,
// lo que le gusta que le regalen y una amistad que sube hablando y regalando. Con los corazones llegan
// pequeños eventos y regalos. Nilo es el vecino de siempre: no se mueve de la plaza.
import { Person } from './entities.js';
import { ITEMS, CROPS, itemNoun } from './items.js';
import { NILO, STALL, hasProject, WALK_NODES, WALK_EDGES } from './world/village.js';
import { mendPrice, SHOPS } from './economy.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { t, tHtml, tList, has, fmt, formatMessage } from './i18n.js';
import { talkContext, pickTopic, moodOf, learn, thing, someOf, countOf, WISH_DAYS } from './talktopics.js';
import { levelIndex, recent } from './reputation.js';
import { tearStage, TEAR } from './clothing.js';
import { ROUTINES, SPEED, placeAt, slotAt, opensNext, leavesHome, shopHours, weekdayOf, setEnv, forget, tavernSpot, SEATS, BAR_FROM, hhmm } from './routines.js';   // (a cycle too, the same way)
import { wayRound } from './world/walkways.js';
import { RECALLS } from './remarks.js';   // (a cycle, read only inside functions: remarks.js reads PEOPLE the same way)

// Puntos del pueblo por los que se camina (sobre el camino, para no chocar con nada) y cómo se unen: village.js
const NODES = WALK_NODES, EDGES = WALK_EDGES;
const LINKS = {};
for (const [a, b] of EDGES) { (LINKS[a] ||= []).push(b); (LINKS[b] ||= []).push(a); }
function route(from, to) {
  const prev = { [from]: null }, todo = [from];
  while (todo.length) { const n = todo.shift(); if (n === to) break; for (const m of LINKS[n] || []) if (!(m in prev)) { prev[m] = n; todo.push(m); } }
  const out = [];
  for (let n = to; n && n !== from; n = prev[n]) out.unshift(n);
  return out;
}

// routine: their day by the kind of day (routines.js), where CALL is when the bell calls; eatOut: the share of their meals
// in the tavern; evening: where they stroll; bed: the hour they go to bed. schedule: the day of before (?routines=0)
const CALL = 11 + 5 / 6 + 1 / 60;
// temper: their character, for how they answer a greeting or a provocation (social.js: kind, cheerful, shy, gruff, wry)
// weather: the weathers that cheer them up or put them in a bad mood (talktopics.js moodOf). Their lines are in the
// language files: npc.chat.<id>.misc and .personal, npc.events.<id>.<hearts>, npc.topic.… (talktopics.js)
const PEOPLE = {
  nilo: {
    name: 'Nilo', temper: 'kind', weather: { likes: ['sol'] }, fixed: true, loves: ['pan', 'tostada_miel', 'tarta_calabaza'], likes: ['manzana', 'miel', 'queso', 'pan_bellota'], hates: ['piedra', 'carbon'],
    events: {
      3: { gift: [['semilla_manzano', 2]] },
      6: { gift: [['tarta_calabaza', 3]] },
    },
  },
  rosa: {
    name: 'Rosa', temper: 'cheerful', weather: { likes: ['sol'], hates: ['lluvia', 'tormenta', 'nieve'] }, home: 'rosa', look: { sex: 'chica', skin: '#f6c9a0', hair: '#4a2c1c', eyes: '#6a3a1e', cloth: '#c83a3a', pants: '#4a3a2a', hairStyle: 'mono', outfit: 'delantal' },
    schedule: [[0, 'door_rosa'], [8.5, 'stall'], [18, 'pond_w'], [20.5, 'door_rosa']], work: 'stall', shop: 'rosa', eatOut: 0.25, evening: 'pond_w',
    routine: {
      work: [[0, '@home'], [8.25, 'stall'], [14, '@lunch'], [14.75, 'stall'], [18, 'pond_w'], [20, '@evening'], [21, '@dinner'], [22.5, '@home']],
      sat: [[0, '@home'], [8.25, 'stall'], [14, '@lunch'], [14.75, 'stall'], [18, 'plaza'], [21, '@dinner'], [23, '@home']],
      sun: [[0, '@home'], [9.75, 'stall'], [CALL, '@chapel'], [12.75, 'stall'], [14, '@lunch_long'], [16, 'pond_w'], [20.5, '@home']],
    },
    loves: ['fresa', 'mermelada_fresa', 'miel'], likes: ['tomate', 'zanahoria', 'huevo', 'flores'], hates: ['anguila', 'carbon'],
    events: {
      3: { flag: 'descuento' },
      6: { gift: [['cama', 1]] },
    },
  },
  lia: {
    name: 'Lía', temper: 'shy', weather: { likes: ['lluvia'], hates: ['tormenta'] }, home: 'rosa', look: { sex: 'chica', skin: '#e8b07a', hair: '#e8c060', eyes: '#3a6ab8', cloth: '#2e8a8a', pants: '#3a4a6a', hairStyle: 'largo', outfit: 'chaleco' },
    schedule: [[0, 'door_rosa'], [6, 'pond_s'], [12, 'plaza'], [15, 'pond_s'], [20, 'door_rosa']], work: 'pond_s', shop: 'lia', eatOut: 0.15, evening: 'plaza', bed: 22,
    routine: {
      work: [[0, '@home'], [6, 'pond_s'], [12, 'plaza'], [14, '@lunch'], [15, 'pond_s'], [20, '@evening'], [21, '@dinner'], [22, '@home']],
      sat: [[0, '@home'], [6, 'pond_s'], [9, '@market'], [14, '@lunch'], [15, 'pond_s'], [20, 'plaza'], [21, '@dinner'], [22.5, '@home']],
      sun: [[0, '@home'], [7.75, 'pond_s'], [CALL, '@chapel'], [12.75, 'pond_s'], [13, 'plaza'], [14, '@lunch_long'], [16, 'pond_w'], [20, '@home']],
    },
    loves: ['pez_dorado', 'salmon', 'pescado_asado'], likes: ['trucha', 'carpa', 'lubina', 'coco'], hates: ['lana', 'calabaza'],
    events: {
      3: { flag: 'sedal' },
      6: { gift: [['cana', 1]], flag: 'pista_barco' },
    },
  },
  bruno: {
    name: 'Bruno', temper: 'gruff', home: 'bruno', look: { sex: 'chico', skin: '#8a5234', hair: '#2a1e1e', eyes: '#3a2a1e', cloth: '#4a4a5a', pants: '#3a3a3a', hairStyle: 'rapado', outfit: 'delantal', beard: true },
    schedule: [[0, 'door_bruno'], [7.5, 'forge'], [17, 'board'], [20, 'door_bruno']], work: 'forge', shop: 'bruno', eatOut: 0.4, evening: 'board',
    routine: {
      work: [[0, '@home'], [7.5, 'forge'], [14, '@lunch'], [14.75, 'forge'], [17, 'board'], [18.5, '@errand'], [20, '@evening'], [21, '@dinner'], [22.5, '@home']],
      sat: [[0, '@home'], [7.5, 'forge'], [9, '@market'], [14, '@lunch'], [14.75, 'forge'], [17, 'board'], [19, 'plaza'], [21, '@dinner'], [23.5, '@home']],
      sun: [[0, '@home'], [9.75, 'forge'], [CALL, '@chapel'], [12.75, 'forge'], [14, '@lunch_long'], [16, 'board'], [18, '@errand'], [20.5, '@home']],
    },
    loves: ['diamante', 'rubi', 'lingote_oro'], likes: ['lingote_hierro', 'carbon', 'cobre', 'hierro', 'queso'], hates: ['fresa', 'maceta'],
    events: {
      3: { gift: [['lingote_hierro', 3]] },
      6: { gift: [['espada', 1]] },
    },
  },
  dani: {
    name: 'Dani', temper: 'cheerful', weather: { likes: ['sol'], hates: ['lluvia'] }, home: 'dani', project: 'casa', look: { sex: 'chico', skin: '#c98a5a', hair: '#e86aa0', eyes: '#3a8a4a', cloth: '#6a4ab8', pants: '#2a2a3a', hairStyle: 'rizado', outfit: 'larga' },
    schedule: [[0, 'door_dani'], [10, 'easel'], [15, 'plaza'], [19, 'door_dani']], work: 'easel', shop: 'dani', eatOut: 0.4, evening: 'plaza', bed: 23.5,
    routine: {
      work: [[0, '@home'], [9.75, 'easel'], [14, '@lunch'], [14.75, 'easel'], [17, 'plaza'], [18.5, '@errand'], [20, '@evening'], [21, '@dinner'], [23, '@home']],
      sat: [[0, '@home'], [9.75, 'easel'], [12, '@browse'], [13, 'easel'], [14, '@lunch'], [14.75, 'easel'], [17, 'plaza'], [21, '@dinner'], [23.5, '@home']],
      sun: [[0, '@home'], [9.75, 'easel'], [CALL, '@chapel'], [12.75, 'easel'], [14, '@lunch_long'], [16, 'pond_w'], [20.5, '@home']],
    },
    loves: ['amatista', 'esmeralda', 'tela'], likes: ['miel', 'lana', 'palomitas', 'maceta'], hates: ['carpa', 'piedra'],
    events: {
      3: { gift: [['maceta', 2]] },
      6: { gift: [['alfombra', 2]] },
    },
  },
};
// La gente de la taberna: Anselmo, tras la barra, y sus clientes. No pasean: están en su sitio a sus horas (hours: de
// cuándo a cuándo; más de 24, de madrugada). seat: dónde están y hacia dónde miran; sits: sentados en un taburete o una silla
const STOOL_H = 0.27, CHAIR_H = 0.14, TO_N = Math.PI, TO_E = Math.PI / 2, TO_W = -Math.PI / 2;
Object.assign(PEOPLE, {
  anselmo: {
    name: 'Anselmo', temper: 'wry', weather: { likes: ['lluvia'] }, seat: [6.5, 33.45, 0], hours: [10, 26], work: 'taberna', shop: 'anselmo',
    look: { sex: 'chico', skin: '#e8b07a', hair: '#7a4a2a', eyes: '#3a2a1e', cloth: '#efe6d4', pants: '#3a2c22', hairStyle: 'calvo', outfit: 'delantal', beard: 'completa' },
    loves: ['miel', 'filete', 'manzana_asada'], likes: ['trigo', 'manzana', 'queso'], hates: ['baba', 'calavera'],
    events: {
      3: { gift: [['hidromiel', 2]] },
      6: { gift: [['taburete', 2]] },
    },
  },
  eusebio: {
    // (the barber, Plan E §4.3: while he is in, 'Get a haircut'; a service, not a shop: he sells nothing)
    name: 'Eusebio', temper: 'gruff', weather: { likes: ['lluvia'] }, seat: [3.5, 35.5, TO_N], sits: STOOL_H, hours: [11, 23], service: 'barber',
    routine: { sun: [[0, '@away'], [11.5, '@chapel'], [12.75, 'seat'], [23, '@away']] },
    look: { sex: 'chico', skin: '#f6c9a0', hair: '#a8a4ac', eyes: '#7a7a8a', cloth: '#5a6a4a', pants: '#3a3a3e', hairStyle: 'corto', outfit: 'chaleco', beard: 'bigote' },
    loves: ['pan_bellota', 'pinones'], likes: ['pan', 'queso'], hates: ['anguila'],
    events: { 3: { gift: [['manzana', 4]] } },
  },
  ines: {
    name: 'Inés', temper: 'shy', weather: { likes: ['sol'], hates: ['niebla'] }, seat: [7.5, 35.5, TO_N], sits: STOOL_H, hours: [12, 22],
    routine: { sat: [[0, '@away'], [10.25, '@browse'], [12, 'seat'], [22, '@away']], sun: [[0, '@away'], [11.5, '@chapel'], [12.75, 'seat'], [22, '@away']] },
    look: { sex: 'chica', skin: '#a86a42', hair: '#2a1e1e', eyes: '#3a2a1e', cloth: '#3a6ab8', pants: '#3a2c22', hairStyle: 'trenza', outfit: 'tunica' },
    loves: ['amatista', 'mapa_vacio'], likes: ['sidra', 'manzana'], hates: ['baba'],
    events: { 3: { gift: [['mapa_vacio', 1]] } },
  },
  marta: {
    // (the tailor, Plan E §4.4: her clothes in SHOPS.marta, seasonal, and mending for coins; shopOpt: her option's label)
    name: 'Marta', temper: 'kind', weather: { likes: ['nieve'] }, seat: [2.62, 37.5, TO_E], sits: CHAIR_H, hours: [17, 26], work: 'taberna', shop: 'marta',
    routine: { sat: [[0, 'seat'], [2, '@away'], [10.5, '@browse'], [13, '@away'], [17, 'seat']], sun: [[0, 'seat'], [2, '@away'], [11.5, '@chapel'], [12.75, 'plaza'], [13.5, '@away'], [17, 'seat']] }, shopOpt: 'npc.opt.clothes', mends: true,
    look: { sex: 'chica', skin: '#ffe0c4', hair: '#a8442a', eyes: '#3a8a4a', cloth: '#7a4a8a', pants: '#2a2a3a', hairStyle: 'melena', outfit: 'tunica' },
    loves: ['fresa', 'mermelada_fresa'], likes: ['pan', 'hidromiel'], hates: ['carbon'],
    events: { 3: { gift: [['gorro', 1]] } },
  },
  paco: {
    name: 'Paco', temper: 'gruff', weather: { likes: ['nieve'], hates: ['tormenta'] }, seat: [7.62, 37.5, TO_E], sits: CHAIR_H, hours: [19, 26],
    routine: { sun: [[0, 'seat'], [2, '@away'], [13, 'seat'], [15.5, '@away'], [19, 'seat']] },
    look: { sex: 'chico', skin: '#c98a5a', hair: '#2a1e1e', eyes: '#7a4a24', cloth: '#a8442a', pants: '#4a3a2a', hairStyle: 'rizado', outfit: 'tunica', beard: 'perilla' },
    loves: ['filete', 'jabali_asado'], likes: ['cerveza', 'carpa'], hates: ['nabo'],
    events: { 3: { gift: [['venado_asado', 2]] } },
  },
});
// Ramiro, the constable (the project 'law_office'; law.js): his rounds, his desk and a night's sleep in the office's back room
Object.assign(PEOPLE, {
  ramiro: {
    name: 'Ramiro', temper: 'gruff', law: true, weather: { hates: ['niebla'] }, home: 'law_office', project: 'law_office', work: 'law_desk',
    look: { sex: 'chico', skin: '#d9a074', hair: '#4a4038', eyes: '#3a2a1e', cloth: '#26324a', pants: '#2e2a2a', hairStyle: 'corto', outfit: 'larga', beard: 'bigote', armband: true,
      wear: { interiorAbajo: { id: 'calzoncillos', color: '#f2efe8' }, torso: { id: 'camisa', color: '#d8d2c4' }, outer: { id: 'wool_coat', color: '#26324a' }, piernas: { id: 'pantalon', color: '#2e2c30' }, calcetines: { id: 'calcetines', color: '#ece6da' }, pies: { id: 'botas', color: '#2c2420' } } },
    schedule: [[0, 'door_law'], [7.5, 'plaza'], [11, 'p37'], [14, 'plaza'], [17, 'p46'], [20, 'plaza'], [23, 'door_law']], eatOut: 0.5, bed: 23,
    routine: {
      work: [[0, '@home'], [7.5, '@patrol'], [9, '@desk'], [12.5, '@patrol'], [14, '@lunch'], [14.75, '@desk'], [16, '@patrol'], [21, '@dinner'], [22, '@patrol'], [23, '@home']],
      sat: [[0, '@home'], [7.5, '@patrol'], [14, '@lunch'], [14.75, '@desk'], [16, '@patrol'], [21, '@dinner'], [22, '@patrol'], [23.5, '@home']],
      sun: [[0, '@home'], [9, '@desk'], [CALL, '@chapel'], [12.75, '@patrol'], [14, '@lunch_long'], [16, '@patrol'], [20.5, '@desk'], [22, '@home']],
    },
    loves: ['estofado', 'cerveza'], likes: ['pan', 'queso', 'carbon'], hates: ['baba', 'calavera'],
    events: { 3: { gift: [['estofado', 2]] } },
  },
});
for (const p of Object.values(PEOPLE)) hud.faces[p.name] = p.look;

// The neighbours' memory (Plan E §4.5): friends[id].mem, up to MEM entries [day, kind, item | null, said 0 | 1], newest
// last. Kinds: remarks.js RECALLS (gift_loved, gift_hated, insult, take_seen, helped, knock_night, project)
export const MEM = 6;
const RECALL_CHANCE = 0.35, RECALL_FROM = 1, RECALL_TO = 14;   // a talk: how often, and how many days old a memory can be
const CHAT_PTS = 15, FRESH_PTS = 5;
// The word for how worn a garment is (Marta's mend list)
const condKey = tear => (tear >= TEAR.rags ? 'item.cond.rags' : tearStage(tear) >= 2 ? 'item.cond.torn' : tearStage(tear) >= 1 ? 'item.cond.worn' : 'item.cond.used');

const GIFTS_KEPT = 12;      // gifts remembered for that
const GIFT_REST = 7;        // days: the same thing again gives half, then a quarter
const WISH_PTS = 40, DELIVER_PTS = 10;   // (a wish kept, on top of the gift; a request of the board handed over in person)
const MOOD_CHANCE = 0.4, WARM_CHANCE = 0.5, EXTRA_CHANCE = 0.5;   // a talk: how often the mood, or a good name in the village, is the greeting; a good mood adds a friendly line
// How they take a gift, as a gesture of the body (social.js): loved, liked, neutral, hated
const GIFT_GESTURE = { loved: 'wave', liked: 'nod', neutral: 'nod', hated: { kind: 'shrug', cheerful: 'shrug', shy: 'shrug', gruff: 'dismiss', wry: 'dismiss' } };

// How they follow the clock (routines.js placeAt): held up (a talk, a greeting) they fall behind (lag, s) and make up for it
// walking faster, so a few seconds later every game has them in the same place again
const CATCH = 1.5, SNAP = 12, JUMP_MS = 8000;   // × their pace; tiles away, they are just put there; a clock that jumps
// (those of the tavern eat at meal times, at their place)
const mealHour = ms => { const h = (ms % DAY) / HOUR_MS; return (h >= 13.5 && h < 15.5) || (h >= 20.5 && h < 22.5); };
const NEAR_IN = 30;             // tiles: at home they are drawn only when the player is this near
const DAY = 864e5, HOUR_MS = 36e5;
class Neighbor extends Person {
  constructor(id, def) {
    const [x, y] = def.seat || NODES[def.schedule[0][1]];
    super({ x, y, look: def.look });
    Object.assign(this, { id, def, node: def.seat ? def.work : def.schedule[0][1], path: [], hidden: true, atHome: false, asleep: false, meal: false, hold: 0, lag: 0, spot: null, talkWith: null, game: null });   // (hold: s stopped to answer a greeting; talkWith: the player talking with them; node: where they are; path: [where they go], walking)
    if (def.seat) { this.yaw = def.seat[2]; this.dir = [Math.sin(def.seat[2]), Math.cos(def.seat[2])]; if (def.sits) this.pose = { kind: 'sit', yaw: def.seat[2], h: def.sits }; }
  }
  // An hour of today, or a moment, as the village's ms
  ms(v) { return v > 1000 ? v : Math.floor((this.game?.days.now ?? 0) / DAY) * DAY + v * HOUR_MS; }
  // ---------- by the clock of before (?routines=0) ----------
  // (los de la taberna) ¿Está a esta hora?
  isIn(hour) { const [a, b] = this.def.hours, h = hour < 6 ? hour + 24 : hour; return h >= a && h < b; }
  // A dónde le toca ir según la hora
  goal(hour) { let g = this.def.schedule[0][1]; for (const [h, n] of this.def.schedule) if (hour >= h) g = n; return g; }
  oldPlaceAt(hour) { if (this.def.seat) { this.hidden = !this.isIn(hour); return; } const g = this.goal(hour); this.node = g; [this.x, this.y] = NODES[g]; this.path = []; this.hidden = this.atHome = g.startsWith('door'); }
  oldUpdate(dt, hour) {
    if (this.def.seat) { this.hidden = !this.isIn(hour); this.vx = this.vy = 0; return; }
    if (this.hold > 0) { this.hold -= dt; this.vx = this.vy = 0; return; }
    const g = this.goal(hour);
    if (g !== this.node && !this.path.length) { this.path = route(this.node, g); this.hidden = this.atHome = false; }
    if (!this.path.length) { this.vx = this.vy = 0; this.hidden = this.atHome = this.node.startsWith('door'); return; }
    const [tx, ty] = NODES[this.path[0]], dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy), sp = 2.2;
    if (d < 0.1) { this.node = this.path.shift(); return; }
    this.vx = (dx / d) * sp; this.vy = (dy / d) * sp;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.step += sp * dt * 3.2;
    this.faceTo(dx, dy);
  }
  // ---------- by their routine ----------
  // Where they are at that moment, already there: not on the way
  placeAt(v) {
    if (!ROUTINES) { this.oldPlaceAt(v); return; }
    this.lag = 0; this.now = null;
    const s = slotAt(this.id, this.ms(v)).spot;
    this.settle(s); this.drawAt(s);
    this.path = [];
  }
  // Where they are at a moment: gone to a player's shop or tavern (business.js), or what their routine says
  whereAt(ms) { return this.game?.business?.errandAt(this.id, ms) || placeAt(this.id, ms, (R, s) => this.way(R, s)); }
  // The way of a slot round what players have built on it (only drawn: world/walkways.js). Looked at once per walk
  way(R, s) {
    const k = `${s.day}:${s.i}`;
    if (this.wayOf !== k) { this.wayOf = k; this.wayNow = this.game?.world ? wayRound(this.game.world, R) : R; }
    return this.wayNow;
  }
  update(dt, v) {
    if (!ROUTINES) { if (this.talkWith) { this.vx = this.vy = 0; return; } this.oldUpdate(dt, v > 1000 ? this.game.days.hour : v); return; }
    const now = this.ms(v), jumped = !(Math.abs(now - (this.now ?? -1e15)) < JUMP_MS);
    this.now = now;
    if (jumped) this.lag = 0;
    // (in a talk they stay: they neither walk off nor leave the tavern)
    if (this.talkWith || this.hold > 0) { if (!jumped || this.talkWith || this.hold > 100) {
      this.hold = Math.max(0, this.hold - dt); this.lag += dt; this.vx = this.vy = 0;
      if (this.asleep && slotAt(this.id, now).spot.kind !== 'asleep') this.asleep = false;
      return;
    } }
    if (this.lag > 0) {
      const at = this.whereAt(now - this.lag * 1000);
      if (at.moving) this.lag = Math.max(0, this.lag - dt * (CATCH - 1));
      else { const s = slotAt(this.id, now); this.lag = s.start <= now - this.lag * 1000 ? 0 : Math.max(0, Math.min(this.lag, (now - s.start) / 1000 - 0.001)); }
    }
    const at = this.whereAt(now - this.lag * 1000), s = at.spot;
    if (!at.moving) {
      this.settle(s);
      if (this.hidden) { this.x = s.x; this.y = s.y; this.vx = this.vy = 0; this.still = true; return; }
      const d = Math.hypot(this.x - s.x, this.y - s.y);
      if (jumped || d < 0.06 || d > SNAP || this.still) { this.drawAt(s); return; }
      this.head(s.x, s.y, dt);   // (put somewhere else: they walk to their place)
      return;
    }
    this.still = false; this.path = [s.goal]; this.node = s.kind; this.spot = null; this.pose = null; this.meal = false; this.asleep = false; this.atHome = false; this.hidden = false; delete this.yaw;
    if (jumped || Math.hypot(this.x - at.x, this.y - at.y) > SNAP) { this.x = at.x; this.y = at.y; this.faceTo(at.dx, at.dy); return; }
    this.head(at.x, at.y, dt);
  }
  // A step towards a point, at their pace (a little more if they are behind)
  head(x, y, dt) {
    const dx = x - this.x, dy = y - this.y, d = Math.hypot(dx, dy), go = Math.min(d, SPEED * CATCH * dt);
    if (d < 1e-4 || !(dt > 0)) { this.vx = this.vy = 0; return; }
    this.pose = null; delete this.yaw; this.still = false;
    this.vx = (dx / d) * go / dt; this.vy = (dy / d) * go / dt;
    this.x += (dx / d) * go; this.y += (dy / d) * go;
    this.step += go * 3.2;
    this.faceTo(dx, dy);
  }
  // They are at their place: what that is
  settle(s) {
    this.path = []; this.spot = s; this.node = s.work ? this.def.work : s.seat ? 'taberna' : s.room ? s.kind : s.node;
    this.atHome = !!s.home; this.meal = s.meal && (!s.seat || mealHour(this.now ?? 0));
    this.hidden = s.hidden || (this.atHome && !this.seenIn());
    this.asleep = s.kind === 'asleep';
  }
  // At home, is the player near enough to see them through a window (with the bed or the chair where it was)?
  seenIn() {
    const g = this.game, p = g?.player, s = this.spot;
    if (!p || g.scene !== g.world || !s || Math.hypot(p.x - s.x, p.y - s.y) > NEAR_IN) return false;
    return !s.tile || !!this.furniture(s);
  }
  // The piece of furniture of a spot, as it is placed now (looked for every half second), or null
  furniture(s) {
    const g = this.game, t = g.time || 0;
    if (this.fur?.s === s && Math.abs(t - this.fur.t) < 0.5) return this.fur.o;
    const raw = g.world.at('placed', ...s.tile), o = raw ? g.world.placedNear?.(s.tile[0] + 0.5, s.tile[1] + 0.5, 1.6).find(q => q.tile && q.tile[0] === s.tile[0] && q.tile[1] === s.tile[1] && q.layer !== 'hang' && q.layer !== 'rug') || { none: true } : null;
    this.fur = { s, t, o };
    return o;
  }
  // Drawn at their place: seated or lying if the furniture is there (standing if it was taken away)
  drawAt(s) {
    this.vx = this.vy = 0; this.still = true;
    let { x, y, pose, yaw } = s;
    const g = this.game, w = g?.world;
    if (s.tile && w) {
      const o = this.furniture(s);
      if (!o) { pose = null; yaw = s.pose ? s.pose.yaw : yaw; }
      else if (pose?.kind === 'lie') { if (o.none) pose = null; else { x = o.x + Math.sin(o.yaw || 0) * 1.05; y = o.y + Math.cos(o.yaw || 0) * 1.05; } }
    }
    // (a player in their seat of the tavern: they stand at the bar)
    if (pose?.kind === 'sit' && s.room === 'taberna' && this.taken(x, y)) {
      for (let i = BAR_FROM; i < SEATS; i++) { const q = tavernSpot(i); if (!this.taken(q.x, q.y, 0.6)) { ({ x, y, yaw } = q); pose = null; break; } }
    }
    this.x = x; this.y = y;
    if (this.pose?.kind !== pose?.kind || this.pose?.yaw !== pose?.yaw) this.pose = pose ? { ...pose } : null;
    if (pose) this.yaw = pose.yaw;
    else if (yaw !== null && yaw !== undefined) { delete this.yaw; if (!this.lookedAt) { const dx = Math.sin(yaw), dy = Math.cos(yaw); if (!this.dir || Math.abs(this.dir[0] - dx) + Math.abs(this.dir[1] - dy) > 0.02) this.faceTo(dx, dy); } }
    else delete this.yaw;
  }
  taken(x, y, r = 0.45) {
    const g = this.game, at = e => e && Math.hypot(e.x - x, e.y - y) < r;
    if (g.player && g.scene === g.world && at(g.player)) return true;
    if (g.live?.joined) for (const q of g.live.peers.values()) if (q.entity && q.sc === 'world' && at(q.entity)) return true;
    return r > 0.5 && g.neighbors.people.some(n => n !== this && !n.hidden && at(n));
  }
}

export { PEOPLE };
export class Neighbors {
  constructor(game) {
    this.game = game;
    this.people = [];
    this.friends = {};
    this.flags = {};
    this.lastSaid = {};   // neighbour id → their last greeting, thanks… (not saved)
  }
  get world() { return this.game.world; }
  get today() { return this.game.days.dayIndex; }
  reset(save) {
    this.friends = save.friends || {};
    this.flags = save.flags || {};
    // (a game from before the introductions: whoever you already get along with knows you)
    if (!this.flags.met) { for (const f of Object.values(this.friends)) if (f && f.intro === undefined && (f.pts > 0 || (f.talk ?? -1) !== -1 || (f.gift ?? -1) !== -1 || f.events?.length)) f.intro = -1; this.flags.met = 1; }
    forget(); this.sync();
    this.people = Object.entries(PEOPLE).filter(([, d]) => !d.fixed && (!d.project || hasProject(d.project))).map(([id, d]) => this.make(id));
    for (const n of this.people) n.placeAt(this.game.days.hour);
    this.world.reserved = new Set(this.people.filter(n => n.def.seat).map(n => `${Math.floor(n.def.seat[0])},${Math.floor(n.def.seat[1])}`));
  }
  save(out) { out.friends = this.friends; out.flags = this.flags; }
  make(id) { const n = new Neighbor(id, PEOPLE[id]); n.game = this.game; return n; }
  // What their days depend on besides the clock and the projects: this world's weather (the host's day 0, its seed)
  sync() { const T = this.game.days; setEnv(`${T.base}:${this.world.seed}`, day => T.weatherFor(day - T.base)); }
  friend(id) { return (this.friends[id] ||= { pts: 0, talk: -1, gift: -1, events: [] }); }
  hearts(id) { return Math.min(10, Math.floor(this.friend(id).pts / 100)); }
  addPoints(id, n) { const f = this.friend(id); f.pts = Math.max(0, Math.min(1000, f.pts + n)); }
  // Alguien nuevo se muda al pueblo (proyecto "Casa nueva")
  moveIn(id) { if (!this.people.some(p => p.id === id)) { const n = this.make(id); n.placeAt(this.game.days.hour); this.people.push(n); } }

  // The clock they follow. With the clock stopped (/gamerule doDaylightCycle false), the hour it stopped at and the few minutes
  // after it: whoever was on the way gets there, and nothing else happens
  clock(dt = 0) {
    const now = this.game.days.now, C = this.stopped;
    if (this.game.rules?.doDaylightCycle !== false) { this.stopped = null; return now; }
    if (!C || Math.abs(now - C.at) > 6e4) { this.stopped = { at: now, t: 0 }; return now; }
    C.t = Math.min(240, C.t + dt);
    return C.at + C.t * 1000;
  }
  update(dt) {
    const now = this.clock(dt);
    this.sync();
    for (const n of this.people) {
      const who = this.game.talk?.holder(n) || null;   // (you, or another player, talking with them: talk.js)
      if (n.talkWith !== who) n.talkWith = who;
      n.lookedAt = !!who || n.hold > 0;
      if (n.def.law && this.game.law?.drive(n, dt)) continue;   // (after somebody: law.js moves him)
      n.update(dt, now);
      // (si le han quitado la silla o el taburete, de pie; si vuelve a haberlo, sentado)
      if (!ROUTINES && n.def.sits) { const has = !!this.world.at('placed', Math.floor(n.x), Math.floor(n.y)); if (has !== !!n.pose) n.pose = has ? { kind: 'sit', yaw: n.def.seat[2], h: n.def.sits } : null; }
    }
    this.world.extraColliders = this.people.filter(n => !n.hidden && !n.asleep).map(n => ({ x: n.x, y: n.y, r: 0.3, npc: n.id }));
  }
  entities(scene) { return scene === this.world ? this.people.filter(n => !n.hidden) : null; }
  // At their counter (not on the way to it)
  isWorking(id) {
    const n = this.people.find(p => p.id === id);
    return !!n && (ROUTINES ? !!n.spot?.work : !n.path.length && n.node === n.def.work);
  }
  // Is their shop open now (routines.js: the day's hours and them at the counter)
  isOpen(id) {
    const S = PEOPLE[id]?.shop && SHOPS[PEOPLE[id].shop], T = this.game.days;
    if (!S) return false;
    const now = S.hours[1] > 24 && T.hour < 6 ? T.hour + 24 : T.hour, [a, b] = shopHours(PEOPLE[id].shop, T.realDay);
    return this.isWorking(id) && now >= a && now < b;
  }
  // Seated (or standing) in their own place of the tavern: the barber works there
  inSeat(id) { const n = this.people.find(p => p.id === id); return !!n && (ROUTINES ? !!n.spot?.seat : !n.hidden); }
  // The same, as they say it (talk.js)
  whenText(id) {
    const def = PEOPLE[id], T = this.game.days, next = def?.shop && opensNext(id, def.shop, T.now);
    if (!next) return this.awayText(id);
    const P = { time: hhmm(next.hour), day: t(`time.weekday.long.${weekdayOf(T.realDay + next.day)}`) };
    return next.day > 0 ? this.line(next.day === 1 ? 'npc.when.tomorrow' : 'npc.when.later', P) : this.say(id, 'when', P);
  }
  // Why their shop is shut and when it opens, in words ('' if it is open)
  awayText(id) {
    const def = PEOPLE[id], S = def?.shop && SHOPS[def.shop], T = this.game.days;
    if (!S || this.isOpen(id)) return '';
    const next = opensNext(id, def.shop, T.now), n = this.people.find(p => p.id === id), hm = h => hhmm(h);
    if (!next) return t('routine.closed', { name: def.name });
    if (next.day > 0) return t(next.day === 1 ? 'routine.closed_until_tomorrow' : 'routine.closed_until', { name: def.name, time: hm(next.hour), day: t(`time.weekday.long.${weekdayOf(T.realDay + next.day)}`) });
    const kind = n ? (n.path.length ? 'road' : n.spot?.meal ? (n.spot.room === 'taberna' ? 'lunch_tavern' : 'lunch') : n.spot?.kind) : 'away';
    return t(has(`routine.away.${kind}`) ? `routine.away.${kind}` : 'routine.away', { name: def.name, time: hm(next.hour) });
  }

  interact(p, scene) {
    if (scene !== this.world) return null;
    if (Math.hypot(p.x - NILO.x, p.y - NILO.y) < 1.6 && scene.reaches(p.x, p.y, NILO.x, NILO.y)) return this.actionFor(null);
    for (const n of this.people) if (!n.hidden && Math.hypot(p.x - n.x, p.y - n.y) < 1.5 && scene.reaches(p.x, p.y, n.x, n.y)) return this.actionFor(n);
    return null;
  }
  // Rosa's stall while she is away: E reads her card
  aimables(p, scene, box) {
    if (scene !== this.world || !ROUTINES || !this.people.some(n => n.id === 'rosa') || this.isOpen('rosa')) return null;
    return [{ kind: 'sys', box: box(STALL.x0 + 1, STALL.y0 + 0.5, 1, 0.5, 0, 1.3), act: () => ({ text: t('routine.card.read'), run: () => { Audio.blip(); hud.toast(this.awayText('rosa')); }, alt: this.game.law?.stallAlt('rosa') || undefined }) }];
  }
  // Lo que se hace con un vecino (null: Nilo)
  // (npc, n: whose tag goes over the prompt's rows, and row: what its E says under it; ui/prompts.js)
  actionFor(n) { const law = n?.def.law && this.game.law?.ramiroAction(); if (law) return law; const id = n ? n.id : 'nilo'; return { text: t('npc.action.talk', { name: PEOPLE[id].name }), row: t('talk.row.talk'), npc: id, n, run: () => this.talk(id, n || undefined) }; }
  // Have they met you? (the first talk is an introduction; until then they do not call you by your name). Nilo met you
  // when you arrived: talkNilo
  introduced(id) {
    const f = this.friends[id];
    return id === 'nilo' || (!!f && (f.intro !== undefined || (f.talk ?? -1) !== -1 || (f.gift ?? -1) !== -1 || f.events?.length > 0 || f.pts >= 100));
  }
  // The lines of a list they may say to you: before you are introduced, the ones without your name (the indexes of the
  // list, which the network sends, stay the same: lineOf gives one)
  lineOf(id, list) {
    const all = list.length;
    if (this.introduced(id)) return Math.floor(Math.random() * Math.max(1, all));
    const ok = []; for (let i = 0; i < all; i++) if (!list[i].includes('{name}')) ok.push(i);
    return ok.length ? ok[Math.floor(Math.random() * ok.length)] : Math.floor(Math.random() * Math.max(1, all));
  }
  // What goes in every line: your name and whether you are a woman or a man ({sex, select, girl {…} other {…}})
  params(more) { const p = this.game.player; return { name: p?.name || '', sex: p?.look?.sex === 'chica' ? 'girl' : 'boy', ...more }; }
  // A line of theirs on some occasion (npc.<what>.<temper>, the general npc.<what> and their own npc.<what>.<id>)
  say(id, what, more) {
    const list = [...tList(`npc.${what}.${id}`), ...tList(`npc.${what}.${PEOPLE[id]?.temper}`), ...tList(`npc.${what}`)];
    if (!list.length) return '';
    let i = this.lineOf(id, list);
    if (list.length > 1 && this.lastSaid[id] === list[i]) i = this.lineOf(id, list);   // (the same as last time: another try)
    this.lastSaid[id] = list[i];
    return formatMessage(list[i], this.params(more));
  }

  // The opening of a talk ('|' between two lines), the first that applies: the introduction; that you found the place
  // they told you of (rumours.js); that you were looking for them;
  // how you look (remarks.js); what they remember; what they have heard (gossip.js); the cold greeting of a village that distrusts you; their mood; the warm one; the hour and the weather
  greeting(id, met = this.introduced(id)) {
    const g = this.game, T = g.days, h = T.hour, f = this.friend(id), temper = PEOPLE[id].temper;
    if (!met) {
      f.intro = T.realDay;
      const own = tList(`npc.intro.${id}`), l = own.length ? own : tList(`npc.intro.${temper}`);
      if (l.length) return formatMessage(l[Math.floor(Math.random() * l.length)], this.params({ npc: PEOPLE[id].name }));
    }
    const right = g.rumours?.foundLine(id);   // (you found what they told you of)
    if (right) return right;
    const looked = g.gossip?.lookedFor(id);   // (somebody told them you were asking for them)
    if (looked) return looked;
    const rm = g.remarks?.forTalk(id);
    if (rm?.text) return rm.text;
    const rc = this.recall(id);
    if (rc) return rc;
    const nw = g.gossip?.opener(id);
    if (nw) return nw;
    const R = g.rep;
    if (R?.counts && R.index <= levelIndex('distrusted') && tList('npc.greet.cold').length) return this.line('npc.greet.cold');
    const mood = moodOf(id, T.realDay, g, f);
    if (mood && Math.random() < MOOD_CHANCE) { const s = this.say(id, mood > 0 ? 'mood.high' : 'mood.low'); if (s) return s; }
    if (R?.counts && R.index >= levelIndex('liked') && Math.random() < WARM_CHANCE && tList('npc.greet.warm').length) return this.line('npc.greet.warm');
    const sky = T.weather === 'nieve' ? 'snow' : T.info.rain ? 'rain' : null;
    if (sky && Math.random() < 0.5) return this.say(id, `greet.${sky}`);
    return this.say(id, `greet.${h >= 21 || h < 6 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'day' : 'evening'}`);
  }

  // A talk (talk.js): it is over when the promise is
  talk(id, npc) { return this.game.talk.start(id, npc); }
  // What a talk does to the friendship and the reputation, at its start. { cold: they do not chat with you ('refuse', or null),
  // sore: provoked today, they start with a reproach and the chat does not count }
  meet(id) {
    // (at «Outcast», or provoked three times today, they do not chat with you, but the shop, dearer, the trades and gifts stay)
    const R = this.game.rep, f = this.friend(id), cold = !R || R.canTalk(id) ? null : 'refuse', sore = f.insultedAt === this.today;
    // (filthy or with a carcass in the arms, the first chat of the day counts half; freshly bathed, +5 once a day: Plan E §4.5)
    // ('fresh' is the remark's condition: the half hour after a soap bath, not the whole soap spell)
    const Rm = this.game.remarks, messy = Rm && (Rm.holds('filthy') || Rm.holds('carcass'));
    if (!cold && !sore && f.talk !== this.today) { f.talk = this.today; this.addPoints(id, messy ? Math.ceil(CHAT_PTS / 2) : CHAT_PTS); R?.change(1, 'talk'); }
    if (!cold && !sore && Rm?.holds('fresh') && f.freshDay !== this.today) { f.freshDay = this.today; this.addPoints(id, FRESH_PTS); }
    return { cold, sore };
  }
  // The friendship's moment that is due, 3 hearts before 6 (one a talk; they wait while the village distrusts you): [{ lines,
  // give() }], or none. give(): it is lived, and what comes with it is handed over (its lines may have been cut)
  dueEvents(id) {
    const g = this.game, f = this.friend(id), def = PEOPLE[id];
    if (g.rep?.eventsWait()) return [];
    const lvl = [3, 6].find(l => def.events?.[l] && this.hearts(id) >= l && !f.events.includes(l));
    if (!lvl) return [];
    const ev = def.events[lvl];
    return [{ flag: ev.flag, lines: tList(`npc.events.${id}.${lvl}`).map(l => formatMessage(l, this.params())), give: () => {
      f.events.push(lvl);
      for (const [item, n] of ev.gift || []) { const left = g.inv.add(item, n); if (left) g.gather.throwOut(item, left); g.gather.float(`+${n} ${ITEMS[item].name}`, '#fff3c0'); }
      if (ev.flag) this.flags[ev.flag] = true;
      g.rep?.change(15, 'event');
      Audio.unlock();
    } }];
  }
  // ---------- chatting (talktopics.js: what about) ----------
  chatLines(id, npc, mood = 0) {
    const f = this.friend(id), heard = this.game.gossip?.topic(id);   // (what they have heard: gossip.js)
    if (heard) return heard.split(' | ');
    const x = pickTopic(talkContext(this.game, id, npc), f);
    const lines = x ? x.text.split(' | ') : [];   // (the longer ones, in two)
    if (lines.length && mood > 0 && Math.random() < EXTRA_CHANCE) { const s = this.say(id, 'mood.extra'); if (s) lines.push(s); }
    return lines;
  }
  // What they say, in their talk (as subtitles), or in the box if there is none
  tell(id, lines) { const T = this.game.talk; return T?.has(id) ? T.say(id, lines) : hud.say(PEOPLE[id].name, lines); }
  // Where neighbour id is now, by their routine: { kind (npc.where.<kind>), until (the hour it ends, or when they come, or
  // null), goal (where they go: npc.goal.<goal>), at: [x, y] to point at, or null, who (whom they visit) }
  whereIs(id) {
    const n = this.people.find(p => p.id === id), T = this.game.days, h = T.hour;
    if (id === 'nilo') return { kind: 'nilo', until: null, at: [NILO.x, NILO.y] };
    if (!n) return { kind: 'away', until: null, at: null };
    if (ROUTINES) {
      if (n.def.law && this.game.law?.driven) return { kind: 'patrol', until: null, at: [n.x, n.y] };
      const er = this.game.business?.errandAt(id, this.clock());   // (at a player's business)
      if (er) return { kind: er.moving ? 'road' : 'shopping', until: ((er.trip.to / HOUR_MS) % 24), goal: 'shopping', at: [er.x, er.y] };
      const a = placeAt(id, this.clock()), s = a.slot, until = s.untilHour, at = [a.x, a.y], k = a.spot.kind;
      if (a.moving) return { kind: 'road', until, goal: a.spot.goal, at };
      if (k === 'away') return { kind: 'away', until, at: null };
      if (a.spot.home && !a.spot.work) return { kind: k === 'asleep' ? k : a.spot.meal ? 'meal_home' : 'home', until: leavesHome(id, T.now) ?? until, at: k === 'asleep' ? null : at };
      return { kind: k, until, at, who: a.spot.who };
    }
    const S = n.def.schedule, at = [n.x, n.y];
    if (n.def.seat) { const [from, to] = n.def.hours; return n.hidden ? { kind: 'away', until: from, at: null } : { kind: 'taberna', until: to, at }; }
    const next = S.find(s => s[0] > h), until = next ? next[0] : S[1][0];   // (after the last one of the day, the first of tomorrow's)
    if (n.path.length) return { kind: 'road', until, goal: n.path[n.path.length - 1], at };
    if (n.hidden || n.node.startsWith('door')) return { kind: h >= 22 || h < 6 ? 'asleep' : 'home', until, at: h >= 22 || h < 6 ? null : at };
    return { kind: n.node.startsWith('pond') ? 'pond' : n.node, until, at };
  }
  gesture(id, npc, kind) { const e = npc || (id === 'nilo' ? this.game.world?.nilo : null); if (e && !e.hidden) this.game.social?.emote(e, kind); }
  // Their request of the board, handed over to them: the board's reward (board.js deliver) and a little more friendship
  async deliver(id, npc, r) {
    const g = this.game, got = g.board.deliver(r);
    if (!got) { Audio.error(); hud.toast(g.inv.count(r.item) < r.n ? t('board.short', { what: countOf(r.item, r.n - g.inv.count(r.item)) }) : t('board.row.done', { name: PEOPLE[id].name }), 'warn'); return; }   // (someone else handed it in meanwhile)
    this.addPoints(id, DELIVER_PTS);
    hud.toast(t('board.reward', { n: got.reward }), 'money');
    await this.tell(id, [this.say(id, 'thanks')]);
    this.gesture(id, npc, 'nod');
    g.onSave?.();
  }
  // ---------- mending (Marta, Plan E §4.4) ----------
  // One piece per choice, until goodbye (like the trades). What can be mended and the mending itself are crafting.js's
  // (mendable, mend with coins); the price, economy.js mendPrice × the reputation's buy factor
  async mend(id) {
    const g = this.game, def = PEOPLE[id], C = g.craft;
    for (;;) {
      const list = C?.mendable?.() || [], factor = g.rep?.buyFactor() ?? 1, prices = list.map(r => mendPrice(r.it.id, factor));
      if (!list.length) { await hud.say(def.name, [t('npc.mend.none')]); return; }
      const opts = [...list.map((r, i) => t('npc.mend.row', { item: itemNoun(r.it.id), cond: t(condKey(r.it.tear)).toLocaleLowerCase(), n: prices[i] })), t('npc.opt.bye')];
      const k = await hud.ask(def.name, t('npc.mend.ask'), opts);
      if (!(k >= 0 && k < list.length)) return;
      const r = list[k], price = prices[k];
      if (g.money < price) { Audio.error(); await hud.say(def.name, [t('npc.mend.poor', { n: price })]); continue; }
      const why = C.mend(r, price);
      if (why) { Audio.error(); await hud.say(def.name, [why]); continue; }
      g.onSave?.();
      await hud.say(def.name, [t('npc.mend.done', { item: itemNoun(r.it.id) })]);
    }
  }
  // Tratos (trades.js): los que ofrece, uno detrás de otro, hasta que te despides
  async trade(id) {
    const g = this.game, def = PEOPLE[id], f = this.friend(id), T = g.trades;
    for (;;) {
      const offers = T.offers(id, f), opts = [...offers.map(o => o.text), t('npc.opt.bye')];
      const k = await hud.ask(T.title(id, f, def.name), t('npc.trade.ask'), opts);
      if (!(k >= 0 && k < offers.length)) return;
      const o = offers[k], said = T.make(id, f, o, def.name);
      if (o.why) Audio.error(); else { Audio.craft(); g.rep?.change(1, 'trade'); g.onSave?.(); }
      await hud.say(def.name, [said]);
    }
  }
  // A random line of a list in the language files (npc.refuse…), with the player's name
  line(key, more) { const l = tList(key); return l.length ? formatMessage(l[Math.floor(Math.random() * l.length)], this.params(more)) : ''; }
  // ---------- memory (Plan E §4.5) ----------
  // Neighbour id remembers something you did today (kind: remarks.js RECALLS; item: an item id, a project id or nothing).
  // The same thing twice in a day is one memory, moved to the end; the oldest go first
  remember(id, kind, item = null) {
    if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(PEOPLE, id) || !RECALLS.includes(kind)) return;
    const f = this.friend(id), mem = Array.isArray(f.mem) ? f.mem : (f.mem = []), today = this.today, it = item ?? null;
    const same = mem.findIndex(m => Array.isArray(m) && m[0] === today && m[1] === kind && (m[2] ?? null) === it);
    if (same >= 0) mem.splice(same, 1);
    mem.push([today, kind, it, 0]);
    if (mem.length > MEM) mem.splice(0, mem.length - MEM);
  }
  // What neighbour id remembers, oldest first (newest last): [{ day, kind, item, said }] (a copy: ui/journal.js shows the
  // newest; batch H's law reads the witnessed ones)
  memories(id) {
    const mem = this.friends[id]?.mem;
    return Array.isArray(mem) ? mem.filter(m => Array.isArray(m) && typeof m[1] === 'string').map(([day, kind, item, said]) => ({ day, kind, item: item ?? null, said: !!said })) : [];
  }
  // Where in the memory is the newest `kind` of the last days + 1 days (0: only today), or -1 (social.relation compares them)
  memIndex(id, kind, days) {
    const mem = this.friends[id]?.mem;
    if (!Array.isArray(mem)) return -1;
    for (let i = mem.length - 1; i >= 0; i--) { const m = mem[i]; if (Array.isArray(m) && m[1] === kind && recent(this.today, m[0], days)) return i; }
    return -1;
  }
  // A talk's greeting from memory, RECALL_CHANCE of the time: the newest thing from RECALL_FROM to RECALL_TO days ago not
  // brought up yet (then it is marked said). null: nothing to recall
  recall(id) {
    const f = this.friends[id], mem = f?.mem;
    if (!Array.isArray(mem) || !mem.length || Math.random() >= RECALL_CHANCE) return null;
    for (let i = mem.length - 1; i >= 0; i--) {
      const m = mem[i];
      if (!Array.isArray(m) || m[3] || !RECALLS.includes(m[1])) continue;
      const age = this.today - m[0];
      if (!(age >= RECALL_FROM && age <= RECALL_TO)) continue;
      const list = tList('npc.recall.' + m[1]);
      if (!list.length) continue;
      m[3] = 1;
      return formatMessage(list[Math.floor(Math.random() * list.length)], { name: this.game.player?.name || '', item: m[2] && ITEMS[m[2]] ? itemNoun(m[2]) : '' });
    }
    return null;
  }
  // A gift: how they take it, by their tastes. The same thing again within GIFT_REST days counts half, then a quarter
  // (in the friendship and the reputation; a hated one always counts whole). The thing they told you they wish for pays
  // WISH_PTS more, once. What they love or like, you know from then on (the journal)
  async gift(id, held, npc = null) {
    const g = this.game, def = PEOPLE[id], f = this.friend(id), item = held.id, day = g.days.realDay;
    f.gift = this.today;
    g.inv.take(g.inv.selected, 1);
    const isFlower = item === 'maceta';
    let pts = 25, how = 'neutral';
    if (def.loves.includes(item)) { pts = 90; how = 'loved'; }
    else if (def.likes.includes(item) || (isFlower && def.likes.includes('flores')) || (CROPS[item] && def.likes.includes('cultivos'))) { pts = 50; how = 'liked'; }
    else if (def.hates.includes(item) || item === 'rotten_fish') { pts = -25; how = 'hated'; }
    const past = (Array.isArray(f.gifts) ? f.gifts : []).filter(x => Array.isArray(x) && recent(day, x[0], GIFT_REST - 1)), again = past.filter(x => x[1] === item).length;
    f.gifts = [...past, [day, item]].slice(-GIFTS_KEPT);
    const part = how === 'hated' || !again ? 1 : again === 1 ? 2 : 4, wish = Array.isArray(f.wish) && f.wish[0] === item && recent(day, f.wish[1], WISH_DAYS);
    this.addPoints(id, Math.floor(pts / part) + (wish ? WISH_PTS : 0));
    if (how === 'loved' || how === 'liked') learn(f, item);
    if (how === 'loved') f.giftMood = day;   // (a good mood for the rest of the day)
    if (pts >= 90) { this.remember(id, 'gift_loved', item); if (!wish) g.gossip?.news('gift_loved', id, item); } else if (pts < 0) this.remember(id, 'gift_hated', item);
    if (wish) { delete f.wish; this.remember(id, 'wish_kept', item); g.gossip?.news('wish_kept', id, item); }
    g.stats?.add('regalos', 1);
    // (the reputation too; while the village distrusts you, what is good counts double: it is how peace is made)
    const R = g.rep, rep = pts >= 90 ? [8, 'gift_loved'] : pts >= 50 ? [4, 'gift_liked'] : pts > 0 ? [2, 'gift'] : [-1, 'gift_hated'];
    if (R) { const n = rep[0] > 0 ? Math.floor(rep[0] / part) : rep[0]; R.change(n > 0 && R.index <= levelIndex('distrusted') ? n * 2 : n, rep[1]); }
    const gs = GIFT_GESTURE[how];
    await this.tell(id, [this.say(id, wish ? 'wish.kept' : again && how !== 'hated' ? 'gift.again' : `gift.${how}`, { item: thing(item) })]);
    this.gesture(id, npc, typeof gs === 'string' ? gs : gs[def.temper] || 'shrug');
  }

  // Pestaña del diario: amistades
  journal() {
    const all = Object.entries(PEOPLE).filter(([id, d]) => d.fixed || this.people.some(p => p.id === id)), day = this.game.days.realDay;
    return all.map(([id, d]) => {
      // (what you know they love and like: from a friendship event, what they told you and your gifts; and their wish)
      const h = this.hearts(id), f = this.friends[id] || {}, known = Array.isArray(f.known) ? f.known : [];
      const wish = Array.isArray(f.wish) && ITEMS[f.wish[0]] && recent(day, f.wish[1], WISH_DAYS) ? f.wish[0] : null;
      const loves = d.loves.filter((i, k) => ITEMS[i] && i !== wish && (known.includes(i) || (f.events?.length && k < 2))), likes = known.filter(i => ITEMS[i] && !d.loves.includes(i));
      const list = l => fmt.list(l.map(i => t('journal.thing', { item: someOf(i) }))), parts = [];
      if (loves.length) parts.push(tHtml('journal.loves', { list: list(loves) }));
      if (likes.length) parts.push(tHtml('journal.likes', { list: list(likes) }));
      if (wish) parts.push(tHtml('journal.wish', { item: thing(wish) }));
      // (data-npc: ui/journal.js adds the line of their latest memory under it, from memories(id))
      return `<div class="j-row" data-npc="${id}"><b>${d.name}</b><span class="hearts">${'♥'.repeat(h)}<i>${'♥'.repeat(10 - h)}</i></span><small>${parts.length ? parts.join(' · ') : tHtml('journal.loves.unknown')}</small></div>`;
    }).join('');
  }
}
