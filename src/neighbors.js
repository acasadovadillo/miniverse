// Vecinos del pueblo: cada uno con su casa, su horario (trabajan, pasean, duermen), su manera de hablar,
// lo que le gusta que le regalen y una amistad que sube hablando y regalando. Con los corazones llegan
// pequeños eventos y regalos. Nilo es el vecino de siempre: no se mueve de la plaza.
import { Person } from './entities.js';
import { ITEMS, CROPS, itemNoun } from './items.js';
import { NILO, hasProject, WALK_NODES, WALK_EDGES } from './world/village.js';
import { SHOPS, mendPrice } from './economy.js';
import { TRADES } from './trades.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { Profile } from './accounts.js';
import { t, tHtml, tList, fmt, formatMessage } from './i18n.js';
import { talkContext, pickTopic, moodOf, learn, thing, someOf, countOf, WISH_DAYS } from './talktopics.js';
import { levelIndex, recent } from './reputation.js';
import { tearStage, TEAR } from './clothing.js';
import { openBarber } from './barber.js';
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
    schedule: [[0, 'door_rosa'], [8.5, 'stall'], [18, 'pond_w'], [20.5, 'door_rosa']], work: 'stall', shop: 'rosa',
    loves: ['fresa', 'mermelada_fresa', 'miel'], likes: ['tomate', 'zanahoria', 'huevo', 'flores'], hates: ['anguila', 'carbon'],
    events: {
      3: { flag: 'descuento' },
      6: { gift: [['cama', 1]] },
    },
  },
  lia: {
    name: 'Lía', temper: 'shy', weather: { likes: ['lluvia'], hates: ['tormenta'] }, home: 'rosa', look: { sex: 'chica', skin: '#e8b07a', hair: '#e8c060', eyes: '#3a6ab8', cloth: '#2e8a8a', pants: '#3a4a6a', hairStyle: 'largo', outfit: 'chaleco' },
    schedule: [[0, 'door_rosa'], [6, 'pond_s'], [12, 'plaza'], [15, 'pond_s'], [20, 'door_rosa']], work: 'pond_s', shop: 'lia',
    loves: ['pez_dorado', 'salmon', 'pescado_asado'], likes: ['trucha', 'carpa', 'lubina', 'coco'], hates: ['lana', 'calabaza'],
    events: {
      3: { flag: 'sedal' },
      6: { gift: [['cana', 1]], flag: 'pista_barco' },
    },
  },
  bruno: {
    name: 'Bruno', temper: 'gruff', home: 'bruno', look: { sex: 'chico', skin: '#8a5234', hair: '#2a1e1e', eyes: '#3a2a1e', cloth: '#4a4a5a', pants: '#3a3a3a', hairStyle: 'rapado', outfit: 'delantal', beard: true },
    schedule: [[0, 'door_bruno'], [7.5, 'forge'], [17, 'board'], [20, 'door_bruno']], work: 'forge', shop: 'bruno',
    loves: ['diamante', 'rubi', 'lingote_oro'], likes: ['lingote_hierro', 'carbon', 'cobre', 'hierro', 'queso'], hates: ['fresa', 'maceta'],
    events: {
      3: { gift: [['lingote_hierro', 3]] },
      6: { gift: [['espada', 1]] },
    },
  },
  dani: {
    name: 'Dani', temper: 'cheerful', weather: { likes: ['sol'], hates: ['lluvia'] }, home: 'dani', project: 'casa', look: { sex: 'chico', skin: '#c98a5a', hair: '#e86aa0', eyes: '#3a8a4a', cloth: '#6a4ab8', pants: '#2a2a3a', hairStyle: 'rizado', outfit: 'larga' },
    schedule: [[0, 'door_dani'], [10, 'easel'], [15, 'plaza'], [19, 'door_dani']], work: 'easel', shop: 'dani',
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
    look: { sex: 'chico', skin: '#f6c9a0', hair: '#a8a4ac', eyes: '#7a7a8a', cloth: '#5a6a4a', pants: '#3a3a3e', hairStyle: 'corto', outfit: 'chaleco', beard: 'bigote' },
    loves: ['pan_bellota', 'pinones'], likes: ['pan', 'queso'], hates: ['anguila'],
    events: { 3: { gift: [['manzana', 4]] } },
  },
  ines: {
    name: 'Inés', temper: 'shy', weather: { likes: ['sol'], hates: ['niebla'] }, seat: [7.5, 35.5, TO_N], sits: STOOL_H, hours: [12, 22],
    look: { sex: 'chica', skin: '#a86a42', hair: '#2a1e1e', eyes: '#3a2a1e', cloth: '#3a6ab8', pants: '#3a2c22', hairStyle: 'trenza', outfit: 'tunica' },
    loves: ['amatista', 'mapa_vacio'], likes: ['sidra', 'manzana'], hates: ['baba'],
    events: { 3: { gift: [['mapa_vacio', 1]] } },
  },
  marta: {
    // (the tailor, Plan E §4.4: her clothes in SHOPS.marta, seasonal, and mending for coins; shopOpt: her option's label)
    name: 'Marta', temper: 'kind', weather: { likes: ['nieve'] }, seat: [2.62, 37.5, TO_E], sits: CHAIR_H, hours: [17, 26], work: 'taberna', shop: 'marta', shopOpt: 'npc.opt.clothes', mends: true,
    look: { sex: 'chica', skin: '#ffe0c4', hair: '#a8442a', eyes: '#3a8a4a', cloth: '#7a4a8a', pants: '#2a2a3a', hairStyle: 'melena', outfit: 'tunica' },
    loves: ['fresa', 'mermelada_fresa'], likes: ['pan', 'hidromiel'], hates: ['carbon'],
    events: { 3: { gift: [['gorro', 1]] } },
  },
  paco: {
    name: 'Paco', temper: 'gruff', weather: { likes: ['nieve'], hates: ['tormenta'] }, seat: [7.62, 37.5, TO_E], sits: CHAIR_H, hours: [19, 26],
    look: { sex: 'chico', skin: '#c98a5a', hair: '#2a1e1e', eyes: '#7a4a24', cloth: '#a8442a', pants: '#4a3a2a', hairStyle: 'rizado', outfit: 'tunica', beard: 'perilla' },
    loves: ['filete', 'jabali_asado'], likes: ['cerveza', 'carpa'], hates: ['nabo'],
    events: { 3: { gift: [['venado_asado', 2]] } },
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

class Neighbor extends Person {
  constructor(id, def) {
    const [x, y] = def.seat || NODES[def.schedule[0][1]];
    super({ x, y, look: def.look });
    Object.assign(this, { id, def, node: def.seat ? def.work : def.schedule[0][1], path: [], hidden: true, hold: 0, talkWith: null });   // (hold: s stopped to answer a greeting; talkWith: the player talking with them)
    if (def.seat) { this.yaw = def.seat[2]; this.dir = [Math.sin(def.seat[2]), Math.cos(def.seat[2])]; if (def.sits) this.pose = { kind: 'sit', yaw: def.seat[2], h: def.sits }; }
  }
  // (los de la taberna) ¿Está a esta hora?
  isIn(hour) { const [a, b] = this.def.hours, h = hour < 6 ? hour + 24 : hour; return h >= a && h < b; }
  // A dónde le toca ir según la hora
  goal(hour) { let g = this.def.schedule[0][1]; for (const [h, n] of this.def.schedule) if (hour >= h) g = n; return g; }
  placeAt(hour) { if (this.def.seat) { this.hidden = !this.isIn(hour); return; } const g = this.goal(hour); this.node = g; [this.x, this.y] = NODES[g]; this.path = []; this.hidden = g.startsWith('door'); }
  update(dt, hour) {
    if (this.talkWith) { this.vx = this.vy = 0; return; }   // (in a talk they stay: they neither walk off nor leave the tavern)
    if (this.def.seat) { this.hidden = !this.isIn(hour); this.vx = this.vy = 0; return; }
    if (this.hold > 0) { this.hold -= dt; this.vx = this.vy = 0; return; }
    const g = this.goal(hour);
    if (g !== this.node && !this.path.length) { this.path = route(this.node, g); this.hidden = false; }
    if (!this.path.length) { this.vx = this.vy = 0; this.hidden = this.node.startsWith('door'); return; }
    const [tx, ty] = NODES[this.path[0]], dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy), sp = 2.2;
    if (d < 0.1) { this.node = this.path.shift(); return; }
    this.vx = (dx / d) * sp; this.vy = (dy / d) * sp;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.step += sp * dt * 3.2;
    // Dirección en pantalla (una casilla mide el doble de ancho que de alto) → una de las 8 vistas
    this.faceTo(dx, dy);
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
    this.people = Object.entries(PEOPLE).filter(([, d]) => !d.fixed && (!d.project || hasProject(d.project))).map(([id, d]) => new Neighbor(id, d));
    for (const n of this.people) n.placeAt(this.game.days.hour);
    this.world.reserved = new Set(this.people.filter(n => n.def.seat).map(n => `${Math.floor(n.def.seat[0])},${Math.floor(n.def.seat[1])}`));
  }
  save(out) { out.friends = this.friends; out.flags = this.flags; }
  friend(id) { return (this.friends[id] ||= { pts: 0, talk: -1, gift: -1, events: [] }); }
  hearts(id) { return Math.min(10, Math.floor(this.friend(id).pts / 100)); }
  addPoints(id, n) { const f = this.friend(id); f.pts = Math.max(0, Math.min(1000, f.pts + n)); }
  // Alguien nuevo se muda al pueblo (proyecto "Casa nueva")
  moveIn(id) { if (!this.people.some(p => p.id === id)) { const n = new Neighbor(id, PEOPLE[id]); n.placeAt(this.game.days.hour); this.people.push(n); } }

  update(dt) {
    const h = this.game.days.hour;
    for (const n of this.people) {
      if (n.talkWith && !this.game.busy && !hud.dialogOpen) n.talkWith = null;   // (a talk cut off from outside: the menu)
      n.update(dt, h);
      // (si le han quitado la silla o el taburete, de pie; si vuelve a haberlo, sentado)
      if (n.def.sits) { const has = !!this.world.at('placed', Math.floor(n.x), Math.floor(n.y)); if (has !== !!n.pose) n.pose = has ? { kind: 'sit', yaw: n.def.seat[2], h: n.def.sits } : null; }
    }
    this.world.extraColliders = this.people.filter(n => !n.hidden).map(n => ({ x: n.x, y: n.y, r: 0.3 }));
  }
  entities(scene) { return scene === this.world ? this.people.filter(n => !n.hidden) : null; }
  // Dónde está cada vecino (para el mapa y las pistas)
  isWorking(id) { const n = this.people.find(p => p.id === id); return n && !n.path.length && n.node === n.def.work; }

  interact(p, scene) {
    if (scene !== this.world) return null;
    if (Math.hypot(p.x - NILO.x, p.y - NILO.y) < 1.6 && scene.reaches(p.x, p.y, NILO.x, NILO.y)) return this.actionFor(null);
    for (const n of this.people) if (!n.hidden && Math.hypot(p.x - n.x, p.y - n.y) < 1.5 && scene.reaches(p.x, p.y, n.x, n.y)) return this.actionFor(n);
    return null;
  }
  // Lo que se hace con un vecino (null: Nilo)
  actionFor(n) { return { text: t('npc.action.talk', { name: n ? n.def.name : PEOPLE.nilo.name }), run: () => this.talk(n ? n.id : 'nilo', n || undefined) }; }
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

  // The opening of a talk, the first that applies: the introduction; how you look (remarks.js); what they remember; the
  // cold greeting of a village that distrusts you; their mood; the warm one; the hour and the weather
  greeting(id, met = this.introduced(id)) {
    const g = this.game, T = g.days, h = T.hour, f = this.friend(id), temper = PEOPLE[id].temper;
    if (!met) {
      f.intro = T.realDay;
      const own = tList(`npc.intro.${id}`), l = own.length ? own : tList(`npc.intro.${temper}`);
      if (l.length) return formatMessage(l[Math.floor(Math.random() * l.length)], this.params({ npc: PEOPLE[id].name }));
    }
    const rm = g.remarks?.forTalk(id);
    if (rm?.text) return rm.text;
    const rc = this.recall(id);
    if (rc) return rc;
    const R = g.rep;
    if (R?.counts && R.index <= levelIndex('distrusted') && tList('npc.greet.cold').length) return this.line('npc.greet.cold');
    const mood = moodOf(id, T.realDay, g, f);
    if (mood && Math.random() < MOOD_CHANCE) { const s = this.say(id, mood > 0 ? 'mood.high' : 'mood.low'); if (s) return s; }
    if (R?.counts && R.index >= levelIndex('liked') && Math.random() < WARM_CHANCE && tList('npc.greet.warm').length) return this.line('npc.greet.warm');
    const sky = T.weather === 'nieve' ? 'snow' : T.info.rain ? 'rain' : null;
    if (sky && Math.random() < 0.5) return this.say(id, `greet.${sky}`);
    return this.say(id, `greet.${h >= 21 || h < 6 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'day' : 'evening'}`);
  }

  async talk(id, npc) {
    if (npc) npc.talkWith = this.game.player;   // (they stop for the whole talk: Neighbor.update)
    try { await this.converse(id, npc); } finally { if (npc) npc.talkWith = null; }
  }
  async converse(id, npc) {
    const g = this.game, def = PEOPLE[id], f = this.friend(id), first = id === 'nilo' && !g.craft.taught.has('banco'), met = this.introduced(id);
    g.busy = true;
    g.player.stop();
    if (npc) { const dx = g.player.x - npc.x, dy = g.player.y - npc.y; npc.faceTo(dx, dy); }   // te mira
    if (first) { await g.talkNilo(); g.busy = false; return; }
    // The reputation (reputation.js): at «Outcast» (or provoked three times today) they do not chat with you, but the shop
    // (dearer), the trades and gifts stay; provoked today, they start with a reproach and the chat does not count
    const R = g.rep, cold = !R || R.canTalk(id) ? null : 'refuse', sore = f.insultedAt === this.today;
    // (filthy or with a carcass in the arms, the first chat of the day counts half; freshly bathed, +5 once a day: Plan E §4.5)
    // ('fresh' is the remark's condition: the half hour after a soap bath, not the whole soap spell)
    const Rm = g.remarks, messy = Rm && (Rm.holds('filthy') || Rm.holds('carcass'));
    if (!cold && !sore && f.talk !== this.today) { f.talk = this.today; this.addPoints(id, messy ? Math.ceil(CHAT_PTS / 2) : CHAT_PTS); R?.change(1, 'talk'); }
    if (!cold && !sore && Rm?.holds('fresh') && f.freshDay !== this.today) { f.freshDay = this.today; this.addPoints(id, FRESH_PTS); }
    // Eventos de amistad (they wait while the village distrusts you)
    for (const lvl of cold || R?.eventsWait() ? [] : [3, 6]) {
      const ev = def.events?.[lvl];
      if (ev && this.hearts(id) >= lvl && !f.events.includes(lvl)) {
        f.events.push(lvl);
        await hud.say(def.name, tList(`npc.events.${id}.${lvl}`).map(l => formatMessage(l, this.params())));
        for (const [item, n] of ev.gift || []) { const left = g.inv.add(item, n); if (left) g.gather.throwOut(item, left); g.gather.float(`+${n} ${ITEMS[item].name}`, '#fff3c0'); }
        if (ev.flag) this.flags[ev.flag] = true;
        R?.change(15, 'event');
        Audio.unlock();
        g.busy = false;
        return;
      }
    }
    const held = g.inv.held, giftable = held && !ITEMS[held.id].tool && f.gift !== this.today;
    const shop = def.shop && SHOPS[def.shop], now = shop && shop.hours[1] > 24 && g.days.hour < 6 ? g.days.hour + 24 : g.days.hour, open = shop && this.isWorking(id) && now >= shop.hours[0] && now < shop.hours[1];
    // (the options by id; their texts through t(). A tailor mends while she is in, even before her shop exists: Plan E §4.4)
    const opts = [], add = (k, text) => opts.push({ k, text });
    if (!cold) add('chat', t('npc.opt.chat'));
    const rq = g.board?.requestOf(id);   // (what they ask for on the board today, handed over in person)
    if (rq && g.board.canDeliver(rq)) add('deliver', t('talk.opt.deliver', { what: countOf(rq.item, rq.n) }));
    if (open) add('shop', t(def.shopOpt || 'npc.opt.shop'));
    if (def.mends && (open || !shop)) add('mend', t('npc.opt.mend'));
    if (def.service === 'barber') add('haircut', t('npc.opt.haircut'));
    if (open && TRADES[id]) add('trade', t('npc.opt.trade'));
    if (id === 'nilo') add('plans', t('npc.opt.plans'));   // (los de los muebles de siempre: economy.js, SHOPS.nilo)
    if (giftable) add('gift', t('npc.opt.gift', { item: itemNoun(held.id) }));
    if (id === 'nilo' && !g.house.family && Profile.admin && !g.live.guest) add('house', t('npc.opt.house'));   // (la casa es la del dueño del mundo)
    add('bye', t('npc.opt.bye'));
    const hearts = '♥'.repeat(this.hearts(id)) || '·';
    const said = cold ? this.line(open ? 'npc.refuse.shop' : 'npc.refuse') : sore ? this.line('npc.reproach') : this.greeting(id, met);
    const pick = opts[await hud.ask(`${def.name}  ${hearts}`, said, opts.map(o => o.text))]?.k;
    if (pick === 'chat') {
      await this.chat(id, npc);
    } else if (pick === 'deliver') {
      await this.deliver(id, npc, rq);
    } else if (pick === 'shop' || pick === 'plans') {
      g.busy = false;
      g.onShop?.(pick === 'plans' ? 'nilo' : def.shop);
      return;
    } else if (pick === 'haircut') {
      g.busy = false;
      openBarber(g);
      return;
    } else if (pick === 'mend') {
      await this.mend(id);
    } else if (pick === 'trade') {
      await this.trade(id);
    } else if (pick === 'gift') {
      await this.gift(id, held, npc);
    } else if (pick === 'house') {
      await (g.house.big ? g.offerFamily() : g.offerReform());
    }
    g.busy = false;
  }
  // ---------- chatting (talktopics.js: what about) ----------
  async chat(id, npc) {
    const g = this.game, def = PEOPLE[id], f = this.friend(id), ctx = talkContext(g, id, npc), x = pickTopic(ctx, f);
    if (!x) return;
    const lines = x.text.split(' | ');   // (the longer ones, in two boxes)
    if (ctx.mood > 0 && Math.random() < EXTRA_CHANCE) { const s = this.say(id, 'mood.extra'); if (s) lines.push(s); }
    await hud.say(def.name, lines);
    if (ctx.mood) this.gesture(id, npc, ctx.mood > 0 ? 'wave' : 'dismiss');
  }
  gesture(id, npc, kind) { const e = npc || (id === 'nilo' ? this.game.world?.nilo : null); if (e && !e.hidden) this.game.social?.emote(e, kind); }
  // Their request of the board, handed over to them: the board's reward (board.js deliver) and a little more friendship
  async deliver(id, npc, r) {
    const g = this.game, got = g.board.deliver(r);
    if (!got) { Audio.error(); await hud.say(t('board.name'), [g.inv.count(r.item) < r.n ? t('board.short', { what: countOf(r.item, r.n - g.inv.count(r.item)) }) : t('board.row.done', { name: PEOPLE[id].name })]); return; }   // (someone else handed it in meanwhile)
    this.addPoints(id, DELIVER_PTS);
    this.gesture(id, npc, 'nod');
    await hud.say(PEOPLE[id].name, [this.say(id, 'thanks'), t('board.reward', { n: got.reward })]);
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
  line(key) { const l = tList(key); return l.length ? formatMessage(l[Math.floor(Math.random() * l.length)], { name: this.game.player?.name || '' }) : ''; }
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
    else if (def.hates.includes(item)) { pts = -25; how = 'hated'; }
    const past = (Array.isArray(f.gifts) ? f.gifts : []).filter(x => Array.isArray(x) && recent(day, x[0], GIFT_REST - 1)), again = past.filter(x => x[1] === item).length;
    f.gifts = [...past, [day, item]].slice(-GIFTS_KEPT);
    const part = how === 'hated' || !again ? 1 : again === 1 ? 2 : 4, wish = Array.isArray(f.wish) && f.wish[0] === item && recent(day, f.wish[1], WISH_DAYS);
    this.addPoints(id, Math.floor(pts / part) + (wish ? WISH_PTS : 0));
    if (how === 'loved' || how === 'liked') learn(f, item);
    if (how === 'loved') f.giftMood = day;   // (a good mood for the rest of the day)
    if (pts >= 90) this.remember(id, 'gift_loved', item); else if (pts < 0) this.remember(id, 'gift_hated', item);
    if (wish) { delete f.wish; this.remember(id, 'wish_kept', item); }
    g.stats?.add('regalos', 1);
    // (the reputation too; while the village distrusts you, what is good counts double: it is how peace is made)
    const R = g.rep, rep = pts >= 90 ? [8, 'gift_loved'] : pts >= 50 ? [4, 'gift_liked'] : pts > 0 ? [2, 'gift'] : [-1, 'gift_hated'];
    if (R) { const n = rep[0] > 0 ? Math.floor(rep[0] / part) : rep[0]; R.change(n > 0 && R.index <= levelIndex('distrusted') ? n * 2 : n, rep[1]); }
    const gs = GIFT_GESTURE[how];
    this.gesture(id, npc, typeof gs === 'string' ? gs : gs[def.temper] || 'shrug');
    await hud.say(def.name, [this.say(id, wish ? 'wish.kept' : again && how !== 'hated' ? 'gift.again' : `gift.${how}`, { item: thing(item) })]);
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
