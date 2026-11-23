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
import { t, tHtml, tList, formatMessage } from './i18n.js';
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
const PEOPLE = {
  nilo: {
    name: 'Nilo', temper: 'kind', fixed: true, loves: ['pan', 'tostada_miel', 'tarta_calabaza'], likes: ['manzana', 'miel', 'queso', 'pan_bellota'], hates: ['piedra', 'carbon'],
    chat: ['Cuando yo era joven, este pueblo tenía hasta panadería. Y un perro que se llamaba Pan.', 'El secreto de una buena vida: dormir la siesta y no discutir con las gallinas.', '¿Has visto qué cielo? Mañana lloverá, o no. Ochenta años y sigo sin acertar.', 'Me alegra ver humo en tu chimenea. Una casa vacía se pone triste.'],
    events: {
      3: { lines: ['¿Sabes? Mi abuelo decía que si andas siempre hacia el oeste, acabas volviendo por el este. Que el mundo da la vuelta.', 'Nadie lo ha comprobado nunca. Pero si alguien puede, eres tú. Toma, era suyo.'], gift: [['semilla_manzano', 2]] },
      6: { lines: ['Te has convertido en alguien importante para este pueblo. Y para este viejo.', 'Ten esta tarta. La hice yo. Bueno, la hizo Rosa, pero yo la miré mucho.'], gift: [['tarta_calabaza', 3]] },
    },
  },
  rosa: {
    name: 'Rosa', temper: 'cheerful', home: 'rosa', look: { sex: 'chica', skin: '#f6c9a0', hair: '#4a2c1c', eyes: '#6a3a1e', cloth: '#c83a3a', pants: '#4a3a2a', hairStyle: 'mono', outfit: 'delantal' },
    schedule: [[0, 'door_rosa'], [8.5, 'stall'], [18, 'pond_w'], [20.5, 'door_rosa']], work: 'stall', shop: 'rosa',
    loves: ['fresa', 'mermelada_fresa', 'miel'], likes: ['tomate', 'zanahoria', 'huevo', 'flores'], hates: ['anguila', 'carbon'],
    chat: ['¡Semillas frescas, oiga! Bueno, frescas… de este año. Casi todas.', 'Mi hermana Lía se pasa el día pescando. Yo me paso el día vendiendo lo que ella no pesca.', 'Si plantas en la estación equivocada, la planta se enfada y se seca. Como yo sin café.', 'Dicen que si riegas cantando, crece más rápido. Yo no lo he probado: canto fatal.'],
    events: {
      3: { lines: ['Oye, que eres de mis mejores clientes. A partir de hoy, todo un poco más barato para ti.', '¡Y no se lo digas a Bruno, que luego todos quieren descuento!'], flag: 'descuento' },
      6: { lines: ['Toma, la cama de invitados. Ya no tengo invitados: Lía ronca.'], gift: [['cama', 1]] },
    },
  },
  lia: {
    name: 'Lía', temper: 'shy', home: 'rosa', look: { sex: 'chica', skin: '#e8b07a', hair: '#e8c060', eyes: '#3a6ab8', cloth: '#2e8a8a', pants: '#3a4a6a', hairStyle: 'largo', outfit: 'chaleco' },
    schedule: [[0, 'door_rosa'], [6, 'pond_s'], [12, 'plaza'], [15, 'pond_s'], [20, 'door_rosa']], work: 'pond_s', shop: 'lia',
    loves: ['pez_dorado', 'salmon', 'pescado_asado'], likes: ['trucha', 'carpa', 'lubina', 'coco'], hates: ['lana', 'calabaza'],
    chat: ['¿Sabías que las anguilas solo salen de noche? Como los búhos. Y como mi hermana cuando hay tarta.', 'El pez dorado existe. Lo vi una vez. Bueno, lo soñé. Pero muy fuerte.', 'En el mar hay sardinas y lubinas; en los ríos, truchas y salmones en otoño.', 'Con una barca podrías llegar a islas que nadie ha pisado. Yo vendo barcas, por cierto.'],
    events: {
      3: { lines: ['Toma, unos sedales de los buenos. Pescarás más deprisa.'], flag: 'sedal' },
      6: { lines: ['Vi un barco hundido en la costa, muy al sur. Dicen que lleva un cofre dentro. ¿Te atreves?'], gift: [['cana', 1]], flag: 'pista_barco' },
    },
  },
  bruno: {
    name: 'Bruno', temper: 'gruff', home: 'bruno', look: { sex: 'chico', skin: '#8a5234', hair: '#2a1e1e', eyes: '#3a2a1e', cloth: '#4a4a5a', pants: '#3a3a3a', hairStyle: 'rapado', outfit: 'delantal', beard: true },
    schedule: [[0, 'door_bruno'], [7.5, 'forge'], [17, 'board'], [20, 'door_bruno']], work: 'forge', shop: 'bruno',
    loves: ['diamante', 'rubi', 'lingote_oro'], likes: ['lingote_hierro', 'carbon', 'cobre', 'hierro', 'queso'], hates: ['fresa', 'maceta'],
    chat: ['Golpear metal caliente es lo más relajante del mundo. Después de dormir.', 'En las cuevas, cuanto más bajas, mejores piedras. Y más bichos. Lleva antorchas.', 'Una espada no es para pelear: es para que los bichos lo piensen dos veces.', 'El hierro sale con pico de cobre. El oro, con pico de hierro. Es lo que hay.'],
    events: {
      3: { lines: ['Toma, unos lingotes que me sobraban. Sobrarme no me sobraban, pero te los doy igual.'], gift: [['lingote_hierro', 3]] },
      6: { lines: ['Esta espada la forjé hace años para mí. Ahora es tuya. Cuídala.'], gift: [['espada', 1]] },
    },
  },
  dani: {
    name: 'Dani', temper: 'cheerful', home: 'dani', project: 'casa', look: { sex: 'chico', skin: '#c98a5a', hair: '#e86aa0', eyes: '#3a8a4a', cloth: '#6a4ab8', pants: '#2a2a3a', hairStyle: 'rizado', outfit: 'larga' },
    schedule: [[0, 'door_dani'], [10, 'easel'], [15, 'plaza'], [19, 'door_dani']], work: 'easel', shop: 'dani',
    loves: ['amatista', 'esmeralda', 'tela'], likes: ['miel', 'lana', 'palomitas', 'maceta'], hates: ['carpa', 'piedra'],
    chat: ['Estoy pintando el estanque. Llevo tres días con el mismo pato.', 'El color favorito de este pueblo es el verde. Lo he contado.', 'Gracias por la casa nueva. Huele a madera y a futuro.', 'Si encuentras piedras preciosas en las cuevas, tráemelas: hago pintura con ellas.'],
    events: {
      3: { lines: ['Te he pintado. Bueno, he pintado tu sombrero. Toma una maceta, que me sobran.'], gift: [['maceta', 2]] },
      6: { lines: ['Eres mi musa. No es broma. Toma, una alfombra tejida a mano por mí.'], gift: [['alfombra', 2]] },
    },
  },
};
// La gente de la taberna: Anselmo, tras la barra, y sus clientes. No pasean: están en su sitio a sus horas (hours: de
// cuándo a cuándo; más de 24, de madrugada). seat: dónde están y hacia dónde miran; sits: sentados en un taburete o una silla
const STOOL_H = 0.27, CHAIR_H = 0.14, TO_N = Math.PI, TO_E = Math.PI / 2, TO_W = -Math.PI / 2;
Object.assign(PEOPLE, {
  anselmo: {
    name: 'Anselmo', temper: 'wry', seat: [6.5, 33.45, 0], hours: [10, 26], work: 'taberna', shop: 'anselmo',
    look: { sex: 'chico', skin: '#e8b07a', hair: '#7a4a2a', eyes: '#3a2a1e', cloth: '#efe6d4', pants: '#3a2c22', hairStyle: 'calvo', outfit: 'delantal', beard: 'completa' },
    loves: ['miel', 'filete', 'manzana_asada'], likes: ['trigo', 'manzana', 'queso'], hates: ['baba', 'calavera'],
    chat: ['¿Lo de siempre? Da igual lo que digas, te voy a poner lo de siempre.', 'Aquí se sabe todo antes de que pase. Rosa ya me ha contado lo que vas a hacer mañana.', 'La receta de la cerveza era de mi abuela. La de la sopa, también. Mi abuela no cocinaba bien.', 'Si no pagas hoy, pagas mañana. Y si no, le digo a Bruno que me debes dinero.', 'En esta barra se han arreglado más líos que en todo el ayuntamiento. Bueno, no hay ayuntamiento.'],
    events: {
      3: { lines: ['Ya eres de la casa. Toma, esta la pago yo. No se lo digas a nadie, que tengo una reputación.'], gift: [['hidromiel', 2]] },
      6: { lines: ['Toma este taburete. Era el de mi padre. Ya no lo usa: dice que le han crecido las piernas.'], gift: [['taburete', 2]] },
    },
  },
  eusebio: {
    // (the barber, Plan E §4.3: while he is in, 'Get a haircut'; a service, not a shop: he sells nothing)
    name: 'Eusebio', temper: 'gruff', seat: [3.5, 35.5, TO_N], sits: STOOL_H, hours: [11, 23], service: 'barber',
    look: { sex: 'chico', skin: '#f6c9a0', hair: '#a8a4ac', eyes: '#7a7a8a', cloth: '#5a6a4a', pants: '#3a3a3e', hairStyle: 'corto', outfit: 'chaleco', beard: 'bigote' },
    loves: ['pan_bellota', 'pinones'], likes: ['pan', 'queso'], hates: ['anguila'],
    chat: ['Yo llevo en este taburete desde antes de que hubiera taberna.', '¿Tú crees que va a llover? Yo creo que sí. Lo digo todos los días y a veces acierto.', 'Nilo y yo fuimos a la escuela juntos. Él ya era viejo entonces.', 'Dicen que al norte hay hielo que no se acaba nunca. Yo no he ido a mirar: me queda lejos del taburete.'],
    events: { 3: { lines: ['Toma, de mi huerto. Bueno, del huerto de mi cuñada. Bueno, ella no lo sabe.'], gift: [['manzana', 4]] } },
  },
  ines: {
    name: 'Inés', temper: 'shy', seat: [7.5, 35.5, TO_N], sits: STOOL_H, hours: [12, 22],
    look: { sex: 'chica', skin: '#a86a42', hair: '#2a1e1e', eyes: '#3a2a1e', cloth: '#3a6ab8', pants: '#3a2c22', hairStyle: 'trenza', outfit: 'tunica' },
    loves: ['amatista', 'mapa_vacio'], likes: ['sidra', 'manzana'], hates: ['baba'],
    chat: ['Soy cartógrafa. Bueno, pinto cosas y digo que es el mundo.', 'He estado en un templo que no sale en ningún mapa. Tampoco en los míos: se me olvidó el papel.', 'Si vas de viaje, lleva antorchas. Y un mapa. Y antorchas.', 'Dicen que si andas siempre recto, vuelves aquí. Por eso paro antes: aquí ya estoy.'],
    events: { 3: { lines: ['Toma, un mapa en blanco. Lo importante es lo que le pongas.'], gift: [['mapa_vacio', 1]] } },
  },
  marta: {
    // (the tailor, Plan E §4.4: her clothes in SHOPS.marta, seasonal, and mending for coins; shopOpt: her option's label)
    name: 'Marta', temper: 'kind', seat: [2.62, 37.5, TO_E], sits: CHAIR_H, hours: [17, 26], work: 'taberna', shop: 'marta', shopOpt: 'npc.opt.clothes', mends: true,
    look: { sex: 'chica', skin: '#ffe0c4', hair: '#a8442a', eyes: '#3a8a4a', cloth: '#7a4a8a', pants: '#2a2a3a', hairStyle: 'melena', outfit: 'tunica' },
    loves: ['fresa', 'mermelada_fresa'], likes: ['pan', 'hidromiel'], hates: ['carbon'],
    chat: ['Vengo a que me cuenten cosas. Anselmo las inventa, pero las cuenta muy bien.', 'Me paso el día tejiendo. Por la tarde, a descansar las manos y a mover la lengua.', '¿Has visto a Dani pintar? Lleva tres días con el mismo pato. Es un pato muy guapo.', 'La sidra de aquí quita las penas. Luego vuelven, pero ya se han cansado.'],
    events: { 3: { lines: ['Te he hecho un gorro. Ya sé que no lo has pedido. Por eso es un regalo.'], gift: [['gorro', 1]] } },
  },
  paco: {
    name: 'Paco', temper: 'gruff', seat: [7.62, 37.5, TO_E], sits: CHAIR_H, hours: [19, 26],
    look: { sex: 'chico', skin: '#c98a5a', hair: '#2a1e1e', eyes: '#7a4a24', cloth: '#a8442a', pants: '#4a3a2a', hairStyle: 'rizado', outfit: 'tunica', beard: 'perilla' },
    loves: ['filete', 'jabali_asado'], likes: ['cerveza', 'carpa'], hates: ['nabo'],
    chat: ['Yo cazo. Bueno, yo voy al bosque y a veces vuelvo con algo.', 'Al ciervo hay que acercarse agachado. Si vas de pie, se entera hasta el del pueblo de al lado.', 'El jabalí es listo. Más que mi cuñado, que tampoco es difícil.', 'Con la piel haces cuero y con el cuero, botas. Con las botas, a cazar otra vez.'],
    events: { 3: { lines: ['Toma, de lo último que cacé. Asado por Anselmo, que yo lo quemo todo.'], gift: [['venado_asado', 2]] } },
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

const GREET = {
  morning: ['¡Buenos días, {n}!', 'Hola, {n}. ¿Has desayunado?', '¡Qué madrugador!'],
  day: ['¡Hola, {n}!', 'Hombre, {n}. ¿Qué tal todo?', '¡Ey, {n}!'],
  evening: ['Buenas tardes, {n}.', 'Ya va cayendo el sol, ¿eh?', 'Hola, {n}. Qué día más largo.'],
  rain: ['Vaya tiempecito… pero el huerto lo agradece.', '¡Qué manera de llover!'],
  snow: ['¡Brrr! Ponte algo, que hace un frío…', 'Me encanta cómo cruje la nieve.'],
};

class Neighbor extends Person {
  constructor(id, def) {
    const [x, y] = def.seat || NODES[def.schedule[0][1]];
    super({ x, y, look: def.look });
    Object.assign(this, { id, def, node: def.seat ? def.work : def.schedule[0][1], path: [], hidden: true, hold: 0 });   // (hold: s stopped to answer a greeting)
    if (def.seat) { this.yaw = def.seat[2]; this.dir = [Math.sin(def.seat[2]), Math.cos(def.seat[2])]; if (def.sits) this.pose = { kind: 'sit', yaw: def.seat[2], h: def.sits }; }
  }
  // (los de la taberna) ¿Está a esta hora?
  isIn(hour) { const [a, b] = this.def.hours, h = hour < 6 ? hour + 24 : hour; return h >= a && h < b; }
  // A dónde le toca ir según la hora
  goal(hour) { let g = this.def.schedule[0][1]; for (const [h, n] of this.def.schedule) if (hour >= h) g = n; return g; }
  placeAt(hour) { if (this.def.seat) { this.hidden = !this.isIn(hour); return; } const g = this.goal(hour); this.node = g; [this.x, this.y] = NODES[g]; this.path = []; this.hidden = g.startsWith('door'); }
  update(dt, hour) {
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
    this.niloTip = 0;
  }
  get world() { return this.game.world; }
  get today() { return this.game.days.dayIndex; }
  reset(save) {
    this.friends = save.friends || {};
    this.flags = save.flags || {};
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
  actionFor(n) { return n ? { text: `Hablar con ${n.def.name}`, run: () => this.talk(n.id, n) } : { text: 'Hablar con Nilo', run: () => this.talk('nilo') }; }

  greeting(id) {
    const T = this.game.days, h = T.hour, name = this.game.player.name, pick = a => a[Math.floor(Math.random() * a.length)];
    // (how you look, then what they remember: remarks.js, Plan E §4.5)
    const rm = this.game.remarks?.forTalk(id);
    if (rm?.text) return rm.text;
    const rc = this.recall(id);
    if (rc) return rc;
    // (how the village sees you: a cold or a warm greeting; Nilo too)
    const R = this.game.rep, mood = R?.counts ? (R.index <= levelIndex('distrusted') ? 'npc.greet.cold' : R.index >= levelIndex('liked') ? 'npc.greet.warm' : null) : null;
    if (mood && tList(mood).length) return formatMessage(pick(tList(mood)), { name });
    const base = T.info.snow ? GREET.snow : T.info.rain ? GREET.rain : h < 11 ? GREET.morning : h < 18 ? GREET.day : GREET.evening;
    return pick(base).replace('{n}', name);
  }

  async talk(id, npc) {
    const g = this.game, def = PEOPLE[id], f = this.friend(id), first = id === 'nilo' && !g.craft.taught.has('banco');
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
        await hud.say(def.name, ev.lines);
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
    if (open) add('shop', t(def.shopOpt || 'npc.opt.shop'));
    if (def.mends && (open || !shop)) add('mend', t('npc.opt.mend'));
    if (def.service === 'barber') add('haircut', t('npc.opt.haircut'));
    if (open && TRADES[id]) add('trade', t('npc.opt.trade'));
    if (id === 'nilo') add('plans', t('npc.opt.plans'));   // (los de los muebles de siempre: economy.js, SHOPS.nilo)
    if (giftable) add('gift', t('npc.opt.gift', { item: itemNoun(held.id) }));
    if (id === 'nilo' && !g.house.family && Profile.admin && !g.live.guest) add('house', t('npc.opt.house'));   // (la casa es la del dueño del mundo)
    add('bye', t('npc.opt.bye'));
    const hearts = '♥'.repeat(this.hearts(id)) || '·';
    const said = cold ? this.line(open ? 'npc.refuse.shop' : 'npc.refuse') : sore ? this.line('npc.reproach') : this.greeting(id);
    const pick = opts[await hud.ask(`${def.name}  ${hearts}`, said, opts.map(o => o.text))]?.k;
    if (pick === 'chat') {
      const line = id === 'nilo' ? this.niloLine() : def.chat[Math.floor(Math.random() * def.chat.length)];
      await hud.say(def.name, [line]);
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
      await this.gift(id, held);
    } else if (pick === 'house') {
      await (g.house.big ? g.offerFamily() : g.offerReform());
    }
    g.busy = false;
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
      const offers = T.offers(id, f), opts = [...offers.map(o => o.text), 'Adiós'];
      const k = await hud.ask(T.title(id, f, def.name), '¿Qué te interesa? Cada trato se puede hacer unas veces al día.', opts);
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
  niloLine() {
    const tips = [...PEOPLE.nilo.chat, ...this.game.niloTips];
    return tips[this.niloTip++ % tips.length];
  }
  async gift(id, held) {
    const g = this.game, def = PEOPLE[id], f = this.friend(id), item = held.id;
    f.gift = this.today;
    g.inv.take(g.inv.selected, 1);
    const isFlower = item === 'maceta';
    let pts = 25, line = '¡Gracias! Muy amable.';
    if (def.loves.includes(item)) { pts = 90; line = `¡¿${ITEMS[item].name}?! ¡Es mi cosa favorita del mundo entero!`; }
    else if (def.likes.includes(item) || (isFlower && def.likes.includes('flores')) || (CROPS[item] && def.likes.includes('cultivos'))) { pts = 50; line = '¡Oh, me encanta! Gracias de verdad.'; }
    else if (def.hates.includes(item)) { pts = -25; line = '¿Esto es… para mí? Ah. Vale. Gracias… supongo.'; }
    this.addPoints(id, pts);
    if (pts >= 90) this.remember(id, 'gift_loved', item); else if (pts < 0) this.remember(id, 'gift_hated', item);
    g.stats?.add('regalos', 1);
    // (the reputation too; while the village distrusts you, what is good counts double: it is how peace is made)
    const R = g.rep, rep = pts >= 90 ? [8, 'gift_loved'] : pts >= 50 ? [4, 'gift_liked'] : pts > 0 ? [2, 'gift'] : [-1, 'gift_hated'];
    if (R) R.change(rep[0] > 0 && R.index <= levelIndex('distrusted') ? rep[0] * 2 : rep[0], rep[1]);
    await hud.say(def.name, [line]);
  }

  // Pestaña del diario: amistades
  journal() {
    const all = Object.entries(PEOPLE).filter(([id, d]) => d.fixed || this.people.some(p => p.id === id));
    return all.map(([id, d]) => {
      const h = this.hearts(id), love = d.loves.map(i => ITEMS[i]?.name).filter(Boolean).slice(0, 2).join(', ');
      // (data-npc: ui/journal.js adds the line of their latest memory under it, from memories(id))
      return `<div class="j-row" data-npc="${id}"><b>${d.name}</b><span class="hearts">${'♥'.repeat(h)}<i>${'♥'.repeat(10 - h)}</i></span><small>${this.friend(id).events.length ? tHtml('journal.loves', { list: love }) : tHtml('journal.loves.unknown')}</small></div>`;
    }).join('');
  }
}
