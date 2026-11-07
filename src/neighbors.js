// Vecinos del pueblo: cada uno con su casa, su horario (trabajan, pasean, duermen), su manera de hablar,
// lo que le gusta que le regalen y una amistad que sube hablando y regalando. Con los corazones llegan
// pequeños eventos y regalos. Nilo es el vecino de siempre: no se mueve de la plaza.
import { Person } from './entities.js';
import { ITEMS, CROPS } from './items.js';
import { NILO, hasProject } from './world/village.js';
import { SHOPS } from './economy.js';
import { TRADES } from './trades.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { Profile } from './accounts.js';

// Puntos del pueblo por los que se camina (sobre el camino, para no chocar con nada) y cómo se unen
const NODES = {
  plaza: [20.4, 23.8], board: [17.6, 23.4], stall: [25.6, 22.1], pond_w: [26.8, 25.8], pond_s: [30.5, 30.6],
  p29: [19, 29], p34: [17.5, 34], p37: [17.3, 37], p46: [16.6, 46], p52: [16.2, 52.2],
  p43: [16.8, 43], p55: [16.1, 55], p57: [16.1, 57],
  door_rosa: [28.5, 42.9], door_bruno: [8.5, 55.1], forge: [12.5, 55.3], door_dani: [27.5, 56.9], easel: [23.2, 29.6],
};
const EDGES = [['plaza', 'board'], ['plaza', 'stall'], ['stall', 'pond_w'], ['plaza', 'p29'], ['p29', 'easel'], ['easel', 'pond_s'], ['pond_w', 'pond_s'],
  ['p29', 'p34'], ['p34', 'p37'], ['p37', 'p43'], ['p43', 'door_rosa'], ['p43', 'p46'], ['p46', 'p52'], ['p52', 'p55'], ['p55', 'door_bruno'], ['door_bruno', 'forge'],
  ['p55', 'p57'], ['p57', 'door_dani']];
const LINKS = {};
for (const [a, b] of EDGES) { (LINKS[a] ||= []).push(b); (LINKS[b] ||= []).push(a); }
function route(from, to) {
  const prev = { [from]: null }, todo = [from];
  while (todo.length) { const n = todo.shift(); if (n === to) break; for (const m of LINKS[n] || []) if (!(m in prev)) { prev[m] = n; todo.push(m); } }
  const out = [];
  for (let n = to; n && n !== from; n = prev[n]) out.unshift(n);
  return out;
}

const PEOPLE = {
  nilo: {
    name: 'Nilo', fixed: true, loves: ['pan', 'tostada_miel', 'tarta_calabaza'], likes: ['manzana', 'miel', 'queso', 'pan_bellota'], hates: ['piedra', 'carbon'],
    chat: ['Cuando yo era joven, este pueblo tenía hasta panadería. Y un perro que se llamaba Pan.', 'El secreto de una buena vida: dormir la siesta y no discutir con las gallinas.', '¿Has visto qué cielo? Mañana lloverá, o no. Ochenta años y sigo sin acertar.', 'Me alegra ver humo en tu chimenea. Una casa vacía se pone triste.'],
    events: {
      3: { lines: ['¿Sabes? Mi abuelo decía que si andas siempre hacia el oeste, acabas volviendo por el este. Que el mundo da la vuelta.', 'Nadie lo ha comprobado nunca. Pero si alguien puede, eres tú. Toma, era suyo.'], gift: [['semilla_manzano', 2]] },
      6: { lines: ['Te has convertido en alguien importante para este pueblo. Y para este viejo.', 'Ten esta tarta. La hice yo. Bueno, la hizo Rosa, pero yo la miré mucho.'], gift: [['tarta_calabaza', 3]] },
    },
  },
  rosa: {
    name: 'Rosa', home: 'rosa', look: { sex: 'chica', skin: '#f6c9a0', hair: '#4a2c1c', eyes: '#6a3a1e', cloth: '#c83a3a', pants: '#4a3a2a', hairStyle: 'mono', outfit: 'delantal' },
    schedule: [[0, 'door_rosa'], [8.5, 'stall'], [18, 'pond_w'], [20.5, 'door_rosa']], work: 'stall', shop: 'rosa',
    loves: ['fresa', 'mermelada_fresa', 'miel'], likes: ['tomate', 'zanahoria', 'huevo', 'flores'], hates: ['anguila', 'carbon'],
    chat: ['¡Semillas frescas, oiga! Bueno, frescas… de este año. Casi todas.', 'Mi hermana Lía se pasa el día pescando. Yo me paso el día vendiendo lo que ella no pesca.', 'Si plantas en la estación equivocada, la planta se enfada y se seca. Como yo sin café.', 'Dicen que si riegas cantando, crece más rápido. Yo no lo he probado: canto fatal.'],
    events: {
      3: { lines: ['Oye, que eres de mis mejores clientes. A partir de hoy, todo un poco más barato para ti.', '¡Y no se lo digas a Bruno, que luego todos quieren descuento!'], flag: 'descuento' },
      6: { lines: ['Toma, la cama de invitados. Ya no tengo invitados: Lía ronca.'], gift: [['cama', 1]] },
    },
  },
  lia: {
    name: 'Lía', home: 'rosa', look: { sex: 'chica', skin: '#e8b07a', hair: '#e8c060', eyes: '#3a6ab8', cloth: '#2e8a8a', pants: '#3a4a6a', hairStyle: 'largo', outfit: 'chaleco' },
    schedule: [[0, 'door_rosa'], [6, 'pond_s'], [12, 'plaza'], [15, 'pond_s'], [20, 'door_rosa']], work: 'pond_s', shop: 'lia',
    loves: ['pez_dorado', 'salmon', 'pescado_asado'], likes: ['trucha', 'carpa', 'lubina', 'coco'], hates: ['lana', 'calabaza'],
    chat: ['¿Sabías que las anguilas solo salen de noche? Como los búhos. Y como mi hermana cuando hay tarta.', 'El pez dorado existe. Lo vi una vez. Bueno, lo soñé. Pero muy fuerte.', 'En el mar hay sardinas y lubinas; en los ríos, truchas y salmones en otoño.', 'Con una barca podrías llegar a islas que nadie ha pisado. Yo vendo barcas, por cierto.'],
    events: {
      3: { lines: ['Toma, unos sedales de los buenos. Pescarás más deprisa.'], flag: 'sedal' },
      6: { lines: ['Vi un barco hundido en la costa, muy al sur. Dicen que lleva un cofre dentro. ¿Te atreves?'], gift: [['cana', 1]], flag: 'pista_barco' },
    },
  },
  bruno: {
    name: 'Bruno', home: 'bruno', look: { sex: 'chico', skin: '#8a5234', hair: '#2a1e1e', eyes: '#3a2a1e', cloth: '#4a4a5a', pants: '#3a3a3a', hairStyle: 'rapado', outfit: 'delantal', beard: true },
    schedule: [[0, 'door_bruno'], [7.5, 'forge'], [17, 'board'], [20, 'door_bruno']], work: 'forge', shop: 'bruno',
    loves: ['diamante', 'rubi', 'lingote_oro'], likes: ['lingote_hierro', 'carbon', 'cobre', 'hierro', 'queso'], hates: ['fresa', 'maceta'],
    chat: ['Golpear metal caliente es lo más relajante del mundo. Después de dormir.', 'En las cuevas, cuanto más bajas, mejores piedras. Y más bichos. Lleva antorchas.', 'Una espada no es para pelear: es para que los bichos lo piensen dos veces.', 'El hierro sale con pico de cobre. El oro, con pico de hierro. Es lo que hay.'],
    events: {
      3: { lines: ['Toma, unos lingotes que me sobraban. Sobrarme no me sobraban, pero te los doy igual.'], gift: [['lingote_hierro', 3]] },
      6: { lines: ['Esta espada la forjé hace años para mí. Ahora es tuya. Cuídala.'], gift: [['espada', 1]] },
    },
  },
  dani: {
    name: 'Dani', home: 'dani', project: 'casa', look: { sex: 'chico', skin: '#c98a5a', hair: '#e86aa0', eyes: '#3a8a4a', cloth: '#6a4ab8', pants: '#2a2a3a', hairStyle: 'rizado', outfit: 'larga' },
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
    name: 'Anselmo', seat: [6.5, 33.45, 0], hours: [10, 26], work: 'taberna', shop: 'anselmo',
    look: { sex: 'chico', skin: '#e8b07a', hair: '#7a4a2a', eyes: '#3a2a1e', cloth: '#efe6d4', pants: '#3a2c22', hairStyle: 'calvo', outfit: 'delantal', beard: 'completa' },
    loves: ['miel', 'filete', 'manzana_asada'], likes: ['trigo', 'manzana', 'queso'], hates: ['baba', 'calavera'],
    chat: ['¿Lo de siempre? Da igual lo que digas, te voy a poner lo de siempre.', 'Aquí se sabe todo antes de que pase. Rosa ya me ha contado lo que vas a hacer mañana.', 'La receta de la cerveza era de mi abuela. La de la sopa, también. Mi abuela no cocinaba bien.', 'Si no pagas hoy, pagas mañana. Y si no, le digo a Bruno que me debes dinero.', 'En esta barra se han arreglado más líos que en todo el ayuntamiento. Bueno, no hay ayuntamiento.'],
    events: {
      3: { lines: ['Ya eres de la casa. Toma, esta la pago yo. No se lo digas a nadie, que tengo una reputación.'], gift: [['hidromiel', 2]] },
      6: { lines: ['Toma este taburete. Era el de mi padre. Ya no lo usa: dice que le han crecido las piernas.'], gift: [['taburete', 2]] },
    },
  },
  eusebio: {
    name: 'Eusebio', seat: [3.5, 35.5, TO_N], sits: STOOL_H, hours: [11, 23],
    look: { sex: 'chico', skin: '#f6c9a0', hair: '#a8a4ac', eyes: '#7a7a8a', cloth: '#5a6a4a', pants: '#3a3a3e', hairStyle: 'corto', outfit: 'chaleco', beard: 'bigote' },
    loves: ['pan_bellota', 'pinones'], likes: ['pan', 'queso'], hates: ['anguila'],
    chat: ['Yo llevo en este taburete desde antes de que hubiera taberna.', '¿Tú crees que va a llover? Yo creo que sí. Lo digo todos los días y a veces acierto.', 'Nilo y yo fuimos a la escuela juntos. Él ya era viejo entonces.', 'Dicen que al norte hay hielo que no se acaba nunca. Yo no he ido a mirar: me queda lejos del taburete.'],
    events: { 3: { lines: ['Toma, de mi huerto. Bueno, del huerto de mi cuñada. Bueno, ella no lo sabe.'], gift: [['manzana', 4]] } },
  },
  ines: {
    name: 'Inés', seat: [7.5, 35.5, TO_N], sits: STOOL_H, hours: [12, 22],
    look: { sex: 'chica', skin: '#a86a42', hair: '#2a1e1e', eyes: '#3a2a1e', cloth: '#3a6ab8', pants: '#3a2c22', hairStyle: 'trenza', outfit: 'tunica' },
    loves: ['amatista', 'mapa_vacio'], likes: ['sidra', 'manzana'], hates: ['baba'],
    chat: ['Soy cartógrafa. Bueno, pinto cosas y digo que es el mundo.', 'He estado en un templo que no sale en ningún mapa. Tampoco en los míos: se me olvidó el papel.', 'Si vas de viaje, lleva antorchas. Y un mapa. Y antorchas.', 'Dicen que si andas siempre recto, vuelves aquí. Por eso paro antes: aquí ya estoy.'],
    events: { 3: { lines: ['Toma, un mapa en blanco. Lo importante es lo que le pongas.'], gift: [['mapa_vacio', 1]] } },
  },
  marta: {
    name: 'Marta', seat: [2.62, 37.5, TO_E], sits: CHAIR_H, hours: [17, 26],
    look: { sex: 'chica', skin: '#ffe0c4', hair: '#a8442a', eyes: '#3a8a4a', cloth: '#7a4a8a', pants: '#2a2a3a', hairStyle: 'melena', outfit: 'tunica' },
    loves: ['fresa', 'mermelada_fresa'], likes: ['pan', 'hidromiel'], hates: ['carbon'],
    chat: ['Vengo a que me cuenten cosas. Anselmo las inventa, pero las cuenta muy bien.', 'Me paso el día tejiendo. Por la tarde, a descansar las manos y a mover la lengua.', '¿Has visto a Dani pintar? Lleva tres días con el mismo pato. Es un pato muy guapo.', 'La sidra de aquí quita las penas. Luego vuelven, pero ya se han cansado.'],
    events: { 3: { lines: ['Te he hecho un gorro. Ya sé que no lo has pedido. Por eso es un regalo.'], gift: [['gorro', 1]] } },
  },
  paco: {
    name: 'Paco', seat: [7.62, 37.5, TO_E], sits: CHAIR_H, hours: [19, 26],
    look: { sex: 'chico', skin: '#c98a5a', hair: '#2a1e1e', eyes: '#7a4a24', cloth: '#a8442a', pants: '#4a3a2a', hairStyle: 'rizado', outfit: 'tunica', beard: 'perilla' },
    loves: ['filete', 'jabali_asado'], likes: ['cerveza', 'carpa'], hates: ['nabo'],
    chat: ['Yo cazo. Bueno, yo voy al bosque y a veces vuelvo con algo.', 'Al ciervo hay que acercarse agachado. Si vas de pie, se entera hasta el del pueblo de al lado.', 'El jabalí es listo. Más que mi cuñado, que tampoco es difícil.', 'Con la piel haces cuero y con el cuero, botas. Con las botas, a cazar otra vez.'],
    events: { 3: { lines: ['Toma, de lo último que cacé. Asado por Anselmo, que yo lo quemo todo.'], gift: [['venado_asado', 2]] } },
  },
});
for (const p of Object.values(PEOPLE)) hud.faces[p.name] = p.look;

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
    Object.assign(this, { id, def, node: def.seat ? def.work : def.schedule[0][1], path: [], hidden: true });
    if (def.seat) { this.yaw = def.seat[2]; this.dir = [Math.sin(def.seat[2]), Math.cos(def.seat[2])]; if (def.sits) this.pose = { kind: 'sit', yaw: def.seat[2], h: def.sits }; }
  }
  // (los de la taberna) ¿Está a esta hora?
  isIn(hour) { const [a, b] = this.def.hours, h = hour < 6 ? hour + 24 : hour; return h >= a && h < b; }
  // A dónde le toca ir según la hora
  goal(hour) { let g = this.def.schedule[0][1]; for (const [h, n] of this.def.schedule) if (hour >= h) g = n; return g; }
  placeAt(hour) { if (this.def.seat) { this.hidden = !this.isIn(hour); return; } const g = this.goal(hour); this.node = g; [this.x, this.y] = NODES[g]; this.path = []; this.hidden = g.startsWith('door'); }
  update(dt, hour) {
    if (this.def.seat) { this.hidden = !this.isIn(hour); this.vx = this.vy = 0; return; }
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
    const base = T.info.snow ? GREET.snow : T.info.rain ? GREET.rain : h < 11 ? GREET.morning : h < 18 ? GREET.day : GREET.evening;
    return pick(base).replace('{n}', name);
  }

  async talk(id, npc) {
    const g = this.game, def = PEOPLE[id], f = this.friend(id), first = id === 'nilo' && !g.craft.taught.has('banco');
    g.busy = true;
    g.player.stop();
    if (npc) { const dx = g.player.x - npc.x, dy = g.player.y - npc.y; npc.faceTo(dx, dy); }   // te mira
    if (first) { await g.talkNilo(); g.busy = false; return; }
    if (f.talk !== this.today) { f.talk = this.today; this.addPoints(id, 15); }
    // Eventos de amistad
    for (const lvl of [3, 6]) {
      const ev = def.events?.[lvl];
      if (ev && this.hearts(id) >= lvl && !f.events.includes(lvl)) {
        f.events.push(lvl);
        await hud.say(def.name, ev.lines);
        for (const [item, n] of ev.gift || []) { const left = g.inv.add(item, n); if (left) g.gather.throwOut(item, left); g.gather.float(`+${n} ${ITEMS[item].name}`, '#fff3c0'); }
        if (ev.flag) this.flags[ev.flag] = true;
        Audio.unlock();
        g.busy = false;
        return;
      }
    }
    const held = g.inv.held, giftable = held && !ITEMS[held.id].tool && f.gift !== this.today;
    const shop = def.shop && SHOPS[def.shop], now = shop && shop.hours[1] > 24 && g.days.hour < 6 ? g.days.hour + 24 : g.days.hour, open = shop && this.isWorking(id) && now >= shop.hours[0] && now < shop.hours[1];
    const opts = ['Charlar'];
    if (open) opts.push('Ver la tienda');
    if (open && TRADES[id]) opts.push('Hacer tratos');
    if (giftable) opts.push(`Regalar: ${ITEMS[held.id].name.toLowerCase()}`);
    if (id === 'nilo' && !g.house.family && Profile.admin && !g.live.guest) opts.push('Hablar de la casa');   // (la casa es la del dueño del mundo)
    opts.push('Adiós');
    const hearts = '♥'.repeat(this.hearts(id)) || '·';
    const pick = opts[await hud.ask(`${def.name}  ${hearts}`, this.greeting(id), opts)];
    if (pick === 'Charlar') {
      const line = id === 'nilo' ? this.niloLine() : def.chat[Math.floor(Math.random() * def.chat.length)];
      await hud.say(def.name, [line]);
    } else if (pick === 'Ver la tienda') {
      g.busy = false;
      g.onShop?.(def.shop);
      return;
    } else if (pick === 'Hacer tratos') {
      await this.trade(id);
    } else if (pick?.startsWith('Regalar')) {
      await this.gift(id, held);
    } else if (pick === 'Hablar de la casa') {
      await (g.house.big ? g.offerFamily() : g.offerReform());
    }
    g.busy = false;
  }
  // Tratos (trades.js): los que ofrece, uno detrás de otro, hasta que te despides
  async trade(id) {
    const g = this.game, def = PEOPLE[id], f = this.friend(id), T = g.trades;
    for (;;) {
      const offers = T.offers(id, f), opts = [...offers.map(o => o.text), 'Adiós'];
      const k = await hud.ask(T.title(id, f, def.name), '¿Qué te interesa? Cada trato se puede hacer unas veces al día.', opts);
      if (!(k >= 0 && k < offers.length)) return;
      const o = offers[k], said = T.make(id, f, o, def.name);
      if (o.why) Audio.error(); else { Audio.craft(); g.onSave?.(); }
      await hud.say(def.name, [said]);
    }
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
    g.stats?.add('regalos', 1);
    await hud.say(def.name, [line]);
  }

  // Pestaña del diario: amistades
  journal() {
    const all = Object.entries(PEOPLE).filter(([id, d]) => d.fixed || this.people.some(p => p.id === id));
    return all.map(([id, d]) => {
      const h = this.hearts(id), love = d.loves.map(i => ITEMS[i]?.name).filter(Boolean).slice(0, 2).join(', ');
      return `<div class="j-row"><b>${d.name}</b><span class="hearts">${'♥'.repeat(h)}<i>${'♥'.repeat(10 - h)}</i></span><small>${this.friend(id).events.length ? 'Le encanta: ' + love : 'Regálale cosas para descubrir lo que le gusta'}</small></div>`;
    }).join('');
  }
}
