// Granja: animales que viven en su casa (gallinero, establo, conejera, cuadra), salen de día a pastar si la
// puerta está abierta, vuelven a dormir de noche (y con lluvia o en invierno se quedan dentro, comiendo del
// comedero o del heno del silo) y cada mañana tienen su producto; los muy felices, a veces, uno especial.
// Los herbívoros pastan de verdad: buscan una casilla con hierba cerca, se paran, bajan la cabeza a comer y la casilla
// queda comida (como segada, para todos; vuelve a salir a los 7 días). Con 5 al día quedan alimentados; si no llegan,
// tiran del comedero o del heno del silo.
// Tienen crías: dos adultos contentos en la misma casa (las aves, con la incubadora) o, como en Minecraft, dos adultos
// a los que se da a mano lo que más les gusta (trigo, semillas o zanahorias), que se buscan y la tienen al momento. El caballo se monta y
// corre más cuanto más te quiere; el perro te sigue, escarba, avisa y va a por la pelota; el gato duerme en su
// cojín, espanta a los ratones del silo y te deja regalos. Y el palomar, para enviarle cosas a otra persona.
// Jugando juntos todo esto es del mundo del anfitrión: lo lleva su juego y los demás lo ven y lo tocan igual.
import { CHUNK } from './world/gen.js';
import { ITEMS, UNKNOWN_NAME, itemNoun } from './items.js';
import { ANIMALS, BREED_NAMES, animalSprite } from './art/farm.js';
import { SPAWN, inBounds, inYard } from './world/village.js';
import { collide } from './physics.js';
import { sideOf, dirOf } from './world/fit.js';
import { toView, fromView } from './iso.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { Profile } from './accounts.js';
import { SWIM_IN } from './entities.js';
import { t as tr, noun } from './i18n.js';
import { HALF, distOf, dxOf, nearX, wrapX } from './world/planet.js';
import { dropSprint } from './input.js';
import { levelOf, settle, BX_AFTER_LOSS, TREATS } from './horse.js';
import { padBags } from './saddlebags.js';

const PER_HOME = { gallinero: 4, establo: 4, conejera: 4, cuadra: 2, caseta: 1, cojin: 1 };
const FRONT = { gallinero: 2.15, establo: 2.25 };   // las casas grandes: del centro a donde se entra (delante de la puerta)
const STALLS = [[-1.5, -0.45], [1.5, -0.45], [-0.5, -0.55], [0.5, -0.55]];   // dónde se ponen dentro del establo
const DOORS = new Set(['gallinero', 'establo', 'conejera']), MENU_PAGE = 5;   // (las casas con puerta y cuántos animales enseña el menú de una vez)
const ROAM = 4.5, HONEY_EVERY = 3, GROW = 5, WAIT_BIRTH = 3, HATCH = 4, SILO_CAP = 240, STRAY_EVERY = 7;
const FEED = ['heno', 'fibra', 'trigo'];
// Los que pastan (los demás de granja picotean o hozan: con salir les basta) y lo que hace falta para eso: GRAZE_NEED
// casillas al día; las buscan a menos de GRAZE_R de su casa, mirando GRAZE_TRY casillas al azar cada vez (no todas: es
// por intervalos, y lo que cuesta no depende de cuánto campo haya). Comer una casilla les lleva EAT segundos y luego
// descansan GRAZE_REST (unas 5 casillas en 6 minutos fuera); los que quedan lejos de todos, sin moverse, cada FAR_EVERY.
// MOUTH: del centro del cuerpo al morro, para pararse con el morro encima de la casilla
export const GRAZERS = new Set(['vaca', 'oveja', 'cabra', 'conejo', 'caballo']);
export const GRAZE_NEED = 5;
// STAY_R: los que no tienen casa (y el caballo que se deja suelto) no se apartan más de eso de donde se quedaron
const STAY_GRAZE = 1, STAY_ROAM = 0.6;   // (the horse's Stay trick: it grazes within 1 m of where it was left, Plan F §1.6)
const GRAZE_R = 8, STAY_R = 2.5, GRAZE_TRY = 14, EAT = [6, 10], GRAZE_REST = [40, 80], FAR_EVERY = [50, 90];
const MOUTH = { vaca: 0.8, caballo: 0.85, oveja: 0.55, cabra: 0.6, conejo: 0.2 };
const within = ([a, b]) => a + Math.random() * (b - a);
// Lo que se les da a mano para que busquen pareja (las aves, cualquier semilla), cuánto dura y cuánto descansan luego
const LOVE_FOOD = { gallina: ['trigo'], pato: ['trigo'], vaca: ['trigo'], oveja: ['trigo'], cabra: ['trigo'], cerdo: ['zanahoria'], conejo: ['zanahoria'] };
const HEAT_MS = 30000, REST_MS = 5 * 60000, MATE_NEAR = 8;
const SPEED = { gallina: 1.1, pato: 0.9, conejo: 1.3, cerdo: 0.8, cabra: 1, caballo: 1.3, perro: 1.6, gato: 1.2 };
const RUN = { perro: 4.2, gato: 2.6, caballo: 5 };   // corriendo (siguiendo a su dueño o al llamarlo)
// A called horse (Plan F §1.3): its speed by level (always faster than a player who walks, 3.2, so it catches up), slower for
// the last COME_SLOW m. Cut off by something (a rock, a wall) for STUCK s, it goes around it (goAround): up to COME_TRIES
// tries without getting any closer; then, farther than COME_NEAR m, it starts again once from out of sight, and nearer (a
// fence, the water) it waits where it got to. Never a jump in plain view
const COME = [3.8, 4.6, 6.2, 6.2], COME_SLOW = 5, COME_END = 3.4, STUCK = 0.3, COME_TRIES = 8, COME_NEAR = 12;
const AROUND = [0.9, 1.25, 1.6, 2, 2.5];   // (rad off the straight line, tried to either side)
const BACK = [0, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75];   // (and off straight back)
const DRAWN = 30, DRAWN_HORSE = 60;        // m (Manhattan): how far animals are drawn (a horse, farther: you watch it come)
const DIGS = [['bellota', 0.25], ['fibra', 0.2], ['pina', 0.15], ['semillas', 0.15], ['fosil_hueso', 0.08], ['moneda_antigua', 0.07], ['amatista', 0.05], ['fosil_concha', 0.05]];
const GIFTS = ['sardina', 'plumas', 'bellota', 'fibra', 'bayas', 'carpa'];
// Lo que se guarda de cada animal (lo demás es de paso: adónde va, si está dentro, si duerme…)
const KEEP = ['id', 'type', 'name', 'home', 'love', 'ready', 'days', 'petDay', 'fedDay', 'born', 'breed', 'owner', 'expecting', 'bredDay', 'outDay', 'named', 'brushDay', 'carrotDay', 'shod', 'bags', 'rider', 'at', 'call', 'stray', 'sit', 'heat', 'bredAt', 'grazeDay', 'grazeN',
  // (the horse, Plan F §2.1: bond progress, today's care, dirt, the Stay trick, who called it and from where, who has its
  // saddlebags open. callBy, callAt and bagsBy never survive a reload: see reset)
  // halt: until when (world clock) it stands still because its menu is open or it is being looked after
  'bx', 'care', 'dirt', 'stay', 'callBy', 'callAt', 'bagsBy', 'halt'];
// Lo de una versión más nueva del juego: un animal de una clase que esta no conoce no se mueve ni se dibuja, pero se
// guarda y se reparte tal cual (unknown); y de los demás, lo guardado que esta no conoce (unknownFields) se conserva
const KNOWN_FIELDS = new Set([...KEEP, 'x', 'y']);
const knownAnimal = s => !!s && !!ANIMALS[s.type];
const unknownFields = s => { const o = {}; for (const k in s) if (!KNOWN_FIELDS.has(k)) o[k] = s[k]; return o; };
const pick = list => list[Math.floor(Math.random() * list.length)];
const me = () => Profile.id || 'yo';
const hearts = n => '♥'.repeat(Math.ceil(n / 2)) || '·';
const horseHearts = n => `${'♥'.repeat(Math.ceil((n || 0) / 2))} ${Math.round(n || 0)}/10`.trim();   // (a horse's: the number too, as its level goes by single hearts)
const mineNow = m => m.to === me() && !!ITEMS[m.id];   // (lo enviado a ti que este juego conoce: lo de una versión más nueva, espera)

class Animal {
  constructor(data) {
    Object.assign(this, { love: 0, ready: false, days: 0, petDay: -1, fedDay: -1, flip: false, step: 0, vx: 0, vy: 0, wait: Math.random() * 3, named: true }, data);
    this.more = unknownFields(data);   // (lo de una versión más nueva: se vuelve a guardar tal cual)
    this.id ||= `${this.type}-${this.name}-${Math.random().toString(36).slice(2, 7)}`;
    this.breed ||= ANIMALS[this.type].breeds?.[0];
    const at = this.home2;   // (sin sitio guardado: delante de su casa)
    this.x ??= at ? at[0] : SPAWN.x; this.y ??= at ? at[1] : SPAWN.y;
    this.tx = this.x; this.ty = this.y;
  }
  get def() { return ANIMALS[this.type]; }
  // Delante de su casa (el gato, encima de su cojín). Si la casa se colocó libre, delante de donde de verdad está y
  // mirando hacia donde mira (Animal.spot lo sabe)
  get home2() {
    if (!this.home) return null;
    const cushion = this.def.home === 'cojin';
    return Animal.spot?.(this.home, cushion) || [this.home[0] + 0.5, this.home[1] + (cushion ? 0.5 : 1.5)];
  }
  toSave() {
    const o = { ...this.more, x: +this.x.toFixed(2), y: +this.y.toFixed(2) };
    for (const k of KEEP) if (this[k] !== undefined && this[k] !== null) o[k] = this[k];
    return o;
  }
  // Andar hacia (tx, ty) a una velocidad; al llegar, se para un rato. Devuelve si ha llegado
  walk(dt, world, sp) {
    const dx = this.tx - this.x, dy = this.ty - this.y, d = Math.hypot(dx, dy);
    if (d < 0.15) { this.vx = this.vy = 0; return true; }
    const s = Math.min(d, sp * dt), p = { x: this.x + (dx / d) * s, y: this.y + (dy / d) * s };
    collide(p, world.collidersNear(p.x, p.y), 0.22);
    if (this.deep(world, p.x, p.y) || Math.hypot(p.x - this.x, p.y - this.y) < s * 0.3) { this.stuck = (this.stuck || 0) + dt; this.vx = this.vy = 0; return this.stuck > 1.5; }
    this.stuck = 0;
    this.faceTo(dx, dy);
    this.vx = (p.x - this.x) / dt; this.vy = (p.y - this.y) / dt;
    this.x = p.x; this.y = p.y;
    this.step += dt * 6;
    return false;
  }
  // Si no puede pasar por (x, y): el agua que le cubre (blocked). Si ya está en ella (el caballo que vadea más hondo, al
  // bajarse de él en un río, o uno de una partida de antes, cuando los ríos eran menos hondos), sí hacia lo menos hondo,
  // para que salga y no se quede quieto para siempre
  deep(world, x, y) {
    if (!world.blocked(x, y)) return false;
    return !world.waterDepth || !world.blocked(this.x, this.y) || world.waterDepth(x, y) > world.waterDepth(this.x, this.y);
  }
  // Pasear cerca de un sitio
  roam(dt, world, cx, cy, r = ROAM) {
    this.wait -= dt;
    if (this.wait > 0) { this.vx = this.vy = 0; return; }
    if (this.walk(dt, world, SPEED[this.type] || 1)) {
      const a = Math.random() * Math.PI * 2, d = 0.6 + Math.random() * r;
      this.tx = cx + Math.cos(a) * d; this.ty = cy + Math.sin(a) * d;
      this.wait = 2 + Math.random() * 5;
      this.stuck = 0;
    }
  }
  go(x, y) { this.tx = x; this.ty = y; this.wait = 0; }
  // Hacia dónde mira en el mundo (de lado: a la derecha o a la izquierda de la pantalla); al girar la cámara, igual
  worldDir() { return this.dir || fromView(this.flip ? -0.5 : 0.5, this.flip ? 0.5 : -0.5); }
  faceTo(dx, dy) {
    const [vx, vy] = toView(dx, dy);   // hacia dónde, visto desde la cámara
    if (Math.abs(vx - vy) > 0.05) { this.flip = vx - vy < 0; this.dir = [dx, dy]; }
  }
}

export class Ranch {
  constructor(game) {
    this.game = game;
    this.animals = [];
    this.unknown = [];   // (los de una clase que este juego no conoce: ver knownAnimal)
    this.farm = { hay: 0, mail: [] };   // lo de la granja que no es de un animal: el heno del silo y el correo
    this.crowed = -1;
    Animal.spot = (home, on) => {
      const [tx, ty] = home, d = this.world?.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)), [kind, rot] = (d?.placed?.[`${tx},${ty}`] || '').split('@'), front = FRONT[kind];
      // (donde de verdad está; las casas grandes de antes de crecer, puestas por casillas, en el centro de la suya)
      const p = d?.pos?.[`placed:${tx},${ty}`] || (front && [tx + 0.5, ty + 0.5, ((+rot || 0) % 4) * Math.PI / 2]);
      return p && (on ? [p[0], p[1]] : [p[0] + Math.sin(p[2]) * (front || 1), p[1] + Math.cos(p[2]) * (front || 1)]);
    };
  }
  get world() { return this.game.world; }
  get days() { return this.game.days; }
  get today() { return this.game.days.dayIndex; }
  reset(save) {
    this.animals = (save.animals || []).filter(knownAnimal).map(a => new Animal(a));
    this.unknown = (save.animals || []).filter(a => a && !knownAnimal(a));
    // (the horses: a lock, a call or its jump-in spot never survive a reload; bags of 9 stacks from before Plan F, to 12)
    // (entering a world somebody else runs, the lock stays: it is theirs, and true)
    const guest = this.game.live?.entering === 'guest';
    for (const a of this.animals) if (a.def.ride) { if (!guest) { delete a.bagsBy; delete a.callBy; delete a.callAt; delete a.halt; } if (Array.isArray(a.bags)) a.bags = padBags(a.bags); }
    this.farm = { hay: 0, mail: [], ...save.farm };
    this.mailSeen = 0;
    this.ball = null;
    this.gone = new Set();
    this.notifyMail();
  }
  save(out) { out.animals = [...this.animals.map(a => a.toSave()), ...this.unknown]; out.farm = this.farm; }
  // Uno que ha muerto (gone: para que una lista de antes de saberlo no lo resucite, jugando juntos)
  remove(a) {
    const i = this.animals.indexOf(a);
    if (i >= 0) this.animals.splice(i, 1);
    this.gone.add(a.id);
  }
  // Jugando juntos con un juego de antes, que los manda enteros (ver syncMode en live.js): como los tiene quien lleva el
  // mundo (sin dónde están: eso llega aparte). Si alguien bajó de un caballo (at) se pone ahí; si alguien lo llamó (call),
  // quien lleva el mundo lo hace venir. Con los de ahora van uno a uno: ver netApply
  share(list) {
    const old = new Map(this.animals.map(a => [a.id, a]));
    this.unknown = list.filter(s => s && !knownAnimal(s) && !this.gone.has(s.id));
    this.animals = list.filter(s => knownAnimal(s) && !this.gone.has(s.id)).map(s => {
      const a = old.get(s.id);
      if (!a) {
        const n = new Animal({ ...s, x: s.at?.[0], y: s.at?.[1] });
        this.bornNews(n);
        return n;
      }
      if (s.at && String(s.at) !== String(a.at)) { a.x = a.tx = s.at[0]; a.y = a.ty = s.at[1]; }
      if ((s.call || 0) > (a.call || 0) && !this.game.live.guest) this.called(a);
      for (const k of KEEP) if (!(k in s)) delete a[k];
      a.more = unknownFields(s);
      return Object.assign(a, s);
    });
  }
  shareFarm(v) { this.farm = { hay: 0, mail: [], ...v }; this.notifyMail(); }

  // ---------- jugando juntos, animal a animal (ver COLLECTIONS en livesync.js) ----------
  // Cada animal por su id, con lo que se guarda y sin dónde está (eso va aparte y a menudo: herd en live.js). Los de una
  // clase que este juego no conoce, tal cual
  netItems() {
    const out = new Map();
    for (const a of this.animals) { const { x, y, ...s } = a.toSave(); out.set(a.id, s); }
    for (const s of this.unknown) if (typeof s?.id === 'string') out.set(s.id, s);
    return out;
  }
  // Lo que llega de cada uno: uno nuevo (nacido o comprado en el otro juego), un campo que cambia o uno que ya no está
  netApply(ops) {
    for (const [kind, id, f, v] of ops) {
      const a = this.animals.find(x => x.id === id), u = a ? null : this.unknown.find(x => x?.id === id);
      if (kind === 'drop') { if (a) this.remove(a); else if (u) { this.unknown.splice(this.unknown.indexOf(u), 1); this.gone.add(id); } continue; }
      if (kind === 'put') {
        this.gone.delete(id);
        if (!knownAnimal(f)) { if (!u) this.unknown.push({ ...f, id }); continue; }
        const n = new Animal({ ...f, id, x: f.at?.[0], y: f.at?.[1] });
        this.animals.push(n);
        if (!this.game.live.guest) this.roomFor(n);
        this.bornNews(n);
        continue;
      }
      if (u) { if (kind === 'set') u[f] = v; else delete u[f]; continue; }
      if (a) this.netField(a, f, kind === 'set' ? v : undefined);
    }
  }
  // (un aviso cuando llega una cría que ha nacido en otro juego: no por un callejero, que no nace, ni por uno sin cría)
  bornNews(n) { if (!n.named && !n.stray && n.def.baby && this.game.player) hud.toast(`¡Ha nacido ${an(n.def.baby)} en la granja!`, 'good'); }
  // (quien lleva el mundo) Uno nuevo de un invitado en una casa que ya está llena (los dos compraron a la vez para el
  // último sitio): a otra del mismo tipo con sitio, o sin casa. El cambio se reparte en la vuelta siguiente
  roomFor(n) {
    const kind = n.def.home, list = kind && n.home ? this.homes(kind) : [], h = list.find(x => x.tile[0] === n.home[0] && x.tile[1] === n.home[1]);
    if (!h || h.free >= 0) return;
    n.home = list.find(x => x.free > 0)?.tile || null;
  }
  // Un campo de un animal: si alguien se bajó de un caballo o lo puso en una casa (at), se pone ahí; si alguien lo llamó
  // (call), quien lleva el mundo lo hace venir. Lo que esta versión no conoce va con lo de una más nueva (more)
  netField(a, f, v) {
    if (f === 'id' || f === 'type' || f === 'x' || f === 'y') return;   // (eso no cambia, y dónde está llega aparte)
    if (!KNOWN_FIELDS.has(f)) { if (v === undefined) delete a.more[f]; else a.more[f] = v; return; }
    if (f === 'at' && Array.isArray(v) && String(v) !== String(a.at)) { a.x = a.tx = v[0]; a.y = a.ty = v[1]; }
    if (f === 'call' && (v || 0) > (a.call || 0) && !this.game.live.guest) this.called(a);
    if (v === undefined) delete a[f]; else a[f] = v;
  }
  // La granja: lo que no es de ningún animal ('@': el heno del silo, cuándo vino el último callejero…) y cada envío del
  // palomar por su id (los de antes de que lo llevaran, por lo que son: dos iguales, el primero y el segundo)
  farmItems(farm = this.farm) {   // (farm: la granja entera que se mandó a un juego de antes)
    const { mail, ...rest } = farm, out = new Map([['@', rest]]), seen = new Map();
    for (const m of Array.isArray(mail) ? mail : []) out.set(mailKey(m, seen), m);
    return out;
  }
  farmApply(ops) {
    for (const [kind, id, f, v] of ops) {
      if (id === '@') {
        if (kind === 'put') this.farm = { hay: 0, ...f, mail: this.farm.mail };
        else if (f !== 'mail') { if (kind === 'set') this.farm[f] = v; else if (kind === 'del') delete this.farm[f]; }
        continue;
      }
      const seen = new Map(), i = (this.farm.mail || []).findIndex(m => mailKey(m, seen) === id);
      if (kind === 'put') { if (i < 0) this.farm.mail = [...(this.farm.mail || []), f]; }
      else if (i < 0) continue;
      else if (kind === 'drop') this.farm.mail = this.farm.mail.filter((_, j) => j !== i);
      else if (kind === 'set') this.farm.mail[i] = { ...this.farm.mail[i], [f]: v };
      else { const { [f]: _, ...m } = this.farm.mail[i]; this.farm.mail[i] = m; }
    }
    this.notifyMail();
  }

  // ---------- casas, puertas y silos ----------
  // Lo colocado en el mundo de un tipo: [{ tile, d (su trozo), k }]
  placed(kind) {
    const out = [];
    for (const [ck, d] of this.world.deltas) {
      if (ck.startsWith('u:')) continue;
      for (const [k, raw] of Object.entries(d.placed || {})) if (raw.split('@')[0] === kind) out.push({ tile: k.split(',').map(Number), d, k });
    }
    return out;
  }
  homes(kind) {
    return this.placed(kind).map(h => ({ ...h, free: (PER_HOME[kind] || 4) - this.animals.filter(a => a.home && a.home[0] === h.tile[0] && a.home[1] === h.tile[1]).length }));
  }
  homeOf(a) { return a.home && this.placed(a.def.home).find(h => h.tile[0] === a.home[0] && h.tile[1] === a.home[1]); }
  // (mirando solo su trozo: se pregunta cada paso por cada animal)
  doorOpen(a) {
    const k = `${a.home?.[0]},${a.home?.[1]}`, d = a.home && this.world.delta(Math.floor(a.home[0] / CHUNK), Math.floor(a.home[1] / CHUNK));
    return !d?.placed?.[k] || d.door?.[k] !== 0;
  }
  get siloCap() { return this.placed('silo').length * SILO_CAP; }
  // Al segar con un silo puesto, el heno se guarda solo
  mowed() {
    const cap = this.siloCap;
    if (!cap || this.farm.hay >= cap) return;
    this.farm.hay++;
    this.game.gather.float(`+1 heno (silo: ${this.farm.hay})`, '#e8d890');
  }

  // Traer un animal nuevo (de la tienda). Devuelve el motivo si no se puede.
  add(type, name) {
    const def = ANIMALS[type], home = this.homes(def.home).find(h => h.free > 0);
    if (!home) return `Necesitas ${ITEMS[def.home].name.toLowerCase()} con sitio libre`;
    this.animals.push(new Animal({ type, name: name || this.freeName(type), owner: me(), home: home.tile, born: this.today - GROW, outDay: this.today, breed: this.randomBreed(type) }));
    return null;
  }
  // /summon: uno de granja, sin casa (pasea por donde aparece), adulto y con nombre
  summon(type, x, y) {
    if (!ANIMALS[type] || ANIMALS[type].wild || ANIMALS[type].pet || ANIMALS[type].ride) return null;
    const a = new Animal({ type, name: this.freeName(type), x, y, born: this.today - GROW - 1, outDay: this.today, breed: this.randomBreed(type) });
    this.animals.push(a);
    this.game.onSave?.();
    return a;
  }
  freeName(type) {
    const def = ANIMALS[type], used = new Set(this.animals.map(a => a.name));
    return def.names.find(n => !used.has(n)) || `${def.name} ${this.animals.length + 1}`;
  }
  // La raza de un animal comprado o nacido (el gallo y la gallina dorada, solo de la incubadora)
  randomBreed(type, hatched = false) {
    const b = ANIMALS[type].breeds;
    if (!b) return undefined;
    if (type === 'gallina') return hatched && Math.random() < 0.3 ? 'gallo' : hatched && Math.random() < 0.04 ? 'dorada' : pick(['blanca', 'parda', 'negra']);
    return pick(b);
  }
  young(a) { const age = this.today - a.born; return a.born !== undefined && age >= 0 && age < (a.def.grow || GROW); }
  mine(type) { return this.animals.filter(a => a.type === type && a.owner === me()); }

  // ---------- cada paso ----------
  update(dt) {
    const g = this.game, p = g.player;
    if (g.live.guest) return;   // (en el mundo de otro, pasean donde dice su juego)
    if ((this.booksT = (this.booksT || 0) + dt) >= 1) { this.booksT = 0; this.horseBooks(); }   // (once a second, wherever you are)
    const T = this.days, h = T.hour, night = h >= 19.5 || h < 6.5, bad = !!T.info.rain || T.season === 3, day = !night && !bad;
    if (g.scene !== this.world) { if (day) this.awayDay(dt); return; }   // (dentro de una casa o en una cueva: ver awayDay)
    this.looked = false;   // (una búsqueda de hierba por fotograma para todo el rebaño: ver graze)
    // El gallo canta al amanecer
    if (h >= 6 && h < 6.5 && this.crowed !== this.today && this.animals.some(a => a.breed === 'gallo' && Math.hypot(a.x - p.x, a.y - p.y) < 30)) { this.crowed = this.today; Audio.crow(); }
    this.mate(Date.now());
    // (lejos: de todos los que juegan, también los de los demás; el servidor sin pantalla no tiene a nadie suyo)
    const players = g.mobs.players();
    for (const a of this.animals) {
      const def = a.def, far = !players.some(q => Math.abs(a.x - q.x) + Math.abs(a.y - q.y) <= 60), grazer = GRAZERS.has(a.type);
      a.young = this.young(a);
      if (def.pet) { this.updatePet(a, dt, night); continue; }
      if (def.ride) { this.updateHorse(a, dt, day); continue; }
      // De granja: fuera de día con la puerta abierta; dentro de noche, con lluvia, en invierno o con la puerta cerrada
      const out = day && this.doorOpen(a) && !!a.home;
      if (out) a.outDay = this.today;
      if (far) {   // (lejos: si tiene que estar dentro, ya lo está; si está fuera, pasta sin moverse)
        if (!out && a.home) { a.inside = true; this.stopGrazing(a); } else if (out && grazer) this.grazeFar(a, dt);
        continue;
      }
      if (!out && a.inside) continue;                               // (dentro no hace nada ni se dibuja: no gasta)
      if (a.panic > g.time) { this.stopGrazing(a); a.walk(dt, this.world, (SPEED[a.type] || 1) * 3); continue; }   // (le han pegado: sale corriendo)
      if (!a.home) {   // (sin casa: pasta poco a poco cerca de donde está, sin irse lejos)
        a.inside = false;
        if (!day) this.stopGrazing(a);
        if (!(grazer && day && this.graze(a, dt, ...(a.grazeHome ??= [a.x, a.y]), STAY_R))) a.roam(dt, this.world, a.x, a.y, 1);
        continue;
      }
      a.grazeHome = null;
      const [hx, hy] = a.home2;
      if (out) {
        if (a.inside) { a.inside = false; a.x = a.tx = hx; a.y = a.ty = hy; }
        if (!(grazer && this.graze(a, dt, hx, hy, GRAZE_R, inYard(hx, hy)))) a.roam(dt, this.world, hx, hy);
        a.digging = def.truffle && !a.vx && !a.vy && Math.sin(g.time * 0.7 + a.x) > 0.6;
      } else if (!a.inside) {
        // Vuelve a casa y entra
        this.stopGrazing(a);
        if (Math.hypot(a.tx - hx, a.ty - hy) > 0.1) a.go(hx, hy);
        if (a.walk(dt, this.world, (SPEED[a.type] || 1) * 1.4) || Math.hypot(a.x - hx, a.y - hy) < 0.4) { a.inside = true; a.x = hx; a.y = hy; }
      }
    }
    this.updateBall();
  }

  // ---------- pastar ----------
  // Las casillas que ha pastado hoy (o el día que se diga: la cuenta de la mañana mira la de ayer)
  grazedOn(a, day = this.today) { return a.grazeDay === day ? a.grazeN || 0 : 0; }
  // Uno que pasta, cerca de quien juega: si está comiendo, sigue (y al acabar, la casilla queda comida); si va hacia
  // una casilla, anda; si le hace falta comer y toca mirar, busca una a menos de R de (cx, cy) (yard: vive en tu jardín,
  // y ahí sí come). Devuelve si se ha ocupado de él (si no, pasea como siempre). Mirar si una casilla tiene hierba cuesta
  // (grassAt): se mira al elegirla, al llegar y al acabar, nunca por el camino, y solo uno del rebaño busca en cada fotograma
  graze(a, dt, cx, cy, R = GRAZE_R, yard = false) {
    const g = this.game, w = this.world, today = this.today;
    if (a.heat > Date.now() || a.sit) { this.stopGrazing(a); return false; }   // (buscando pareja, va a lo suyo)
    if (a.eating > 0) {
      a.vx = a.vy = 0;
      if ((a.eating -= dt) > 0) return true;
      const [tx, ty] = a.grazeAt;
      if (w.pasture(tx, ty, today, yard)) this.ate(a, tx, ty);   // (si nadie la ha segado mientras)
      this.stopGrazing(a);
      a.grazeNext = g.time + within(GRAZE_REST);
      a.wait = 2 + Math.random() * 4;   // (se queda un rato quieto, rumiando)
      return true;
    }
    if (a.grazeAt) {
      const [tx, ty] = a.grazeAt, [mx, my] = a.grazeSpot;
      a.tx = mx; a.ty = my;
      if (!a.walk(dt, w, (SPEED[a.type] || 1) * 0.8)) return true;
      if (Math.hypot(a.x - mx, a.y - my) > 0.45) { this.stopGrazing(a); a.grazeNext = g.time + 4; return false; }   // (no ha podido llegar)
      if (!w.pasture(tx, ty, today, yard)) { this.stopGrazing(a); a.grazeNext = g.time + 2; return false; }   // (alguien se la ha comido o la ha segado antes)
      a.faceTo(tx + 0.5 - a.x, ty + 0.5 - a.y);
      a.eating = within(EAT); a.grazing = true;
      return true;
    }
    // (busca cuando le toca echar a andar: si está parado un rato, se queda parado)
    if (a.wait > 0 || g.time < (a.grazeNext || 0) || this.grazedOn(a) >= GRAZE_NEED || this.looked) return false;
    this.looked = true;
    a.grazeNext = g.time + 3 + Math.random() * 3;   // (si no encuentra, vuelve a mirar al rato)
    const t = this.findGrass(a, a.x, a.y, cx, cy, R, yard);
    if (!t) return false;
    // (se para con el morro encima: un poco antes del centro de la casilla, viniendo desde donde está)
    const ex = t[0] + 0.5, ey = t[1] + 0.5, d = Math.hypot(ex - a.x, ey - a.y), reach = (MOUTH[a.type] || 0.5) * (a.young ? 0.55 : 1);
    const [fx, fy] = d > 0.05 ? [ex - a.x, ey - a.y] : a.worldDir(), fl = Math.hypot(fx, fy) || 1, ux = fx / fl, uy = fy / fl;
    a.grazeAt = t; a.grazeSpot = [ex - ux * reach, ey - uy * reach];
    if (w.blocked(...a.grazeSpot)) { a.grazeAt = null; return false; }
    a.wait = 0;
    return true;
  }
  // Una casilla con hierba para pastar, buscando desde (x, y) (primero cerca, luego más lejos) y, si no, alrededor de
  // (cx, cy); a menos de R de ese sitio, sin muros ni vallas por medio (en un corral, la de dentro) y que no vaya a
  // comérsela otro. O null
  findGrass(a, x, y, cx, cy, R = GRAZE_R, yard = false) {
    const w = this.world, today = this.today, taken = new Set();
    for (const b of this.animals) if (b !== a && b.grazeAt) taken.add(`${b.grazeAt[0]},${b.grazeAt[1]}`);
    for (let i = 0; i < GRAZE_TRY; i++) {
      const near = i < GRAZE_TRY * 0.65, r = near ? 0.7 + (i / GRAZE_TRY) * R * 0.8 : Math.random() * R, ang = Math.random() * Math.PI * 2;
      const px = (near ? x : cx) + Math.cos(ang) * r, py = (near ? y : cy) + Math.sin(ang) * r, tx = Math.floor(px), ty = Math.floor(py);
      if (Math.hypot(tx + 0.5 - cx, ty + 0.5 - cy) > R || taken.has(`${tx},${ty}`)) continue;
      if (w.pasture(tx, ty, today, yard) && w.reaches(x, y, tx + 0.5, ty + 0.5, true)) return [tx, ty];
    }
    return null;
  }
  // Lejos de todos (no se le ve): pasta cada poco una casilla de cerca de su casa, sin moverse
  grazeFar(a, dt) {
    if (this.grazedOn(a) >= GRAZE_NEED) return;
    a.farT ??= Math.random() * FAR_EVERY[0];
    if ((a.farT += dt) < FAR_EVERY[0] || this.looked) return;
    this.looked = true;
    a.farT = FAR_EVERY[0] - within(FAR_EVERY);
    const [hx, hy] = a.home2 || [a.x, a.y], t = this.findGrass(a, hx, hy, hx, hy, GRAZE_R, !!a.home2 && inYard(hx, hy));
    if (t) this.ate(a, ...t);
  }
  // Quien lleva el mundo está dentro de una casa, en una cueva o en un interior: los de fuera siguen su día igual (han
  // salido y pastan sin moverse, como los de lejos), que el día va con la hora de verdad
  awayDay(dt) {
    this.looked = false;
    for (const a of this.animals) {
      if (a.def.pet || a.rider || a.calling) continue;
      if (a.def.ride) { if (GRAZERS.has(a.type)) this.grazeFar(a, dt); continue; }
      if (!a.home || !this.doorOpen(a)) continue;
      a.outDay = this.today;
      if (GRAZERS.has(a.type)) this.grazeFar(a, dt);
    }
  }
  // Se la ha comido: la casilla queda como segada (en el trozo: lo ven todos) y le cuenta para hoy
  ate(a, tx, ty) {
    const today = this.today;
    this.world.mow(tx, ty, today);
    if (a.grazeDay !== today) { a.grazeDay = today; a.grazeN = 0; }
    a.grazeN++;
    if (a.grazeN === GRAZE_NEED && this.game.player && !Profile.server && Math.hypot(a.x - this.game.player.x, a.y - this.game.player.y) < 10) this.game.gather.float(`${a.name} ya ha pastado lo suyo`, '#c8f0a0');
  }
  stopGrazing(a) { a.eating = 0; a.grazing = false; a.grazeAt = null; }

  // The horse (whoever runs the world moves it), in this order (Plan F §6.4): ridden, it is not drawn and its rider moves it;
  // thrown, it trots off a few metres and stops; called, it goes to whoever whistled (callBy; before Plan F, its owner) at
  // the gait of its level, from the jump-in spot the caller picked (callAt, once: never a blind pop-in where it could be
  // seen); told to stay, it grazes where it was left (a.at) instead of walking home; else it grazes as always
  updateHorse(a, dt, day) {
    this.moveHorse(a, dt, day);
    if (a.x >= HALF || a.x < -HALF) { const x = wrapX(a.x); a.tx += x - a.x; a.x = x; }   // (across the planet's seam)
  }
  moveHorse(a, dt, day) {
    a.inside = false;
    if (a.rider || a.calling) { this.stopGrazing(a); a.grazeHome = null; }   // (luego pasta donde se quede)
    if (a.rider) {
      if (a.rider !== me() && !this.player(a.rider)) a.rider = null;   // (si su jinete se fue, se queda ahí)
      else {   // (whoever rides it, a call or a bolt under way is over: it must not go on when they get off)
        if (a.calling) { a.calling = false; delete a.callBy; delete a.callAt; }
        a.bolt = null;
        return;
      }
    }
    if (a.bolt) {
      a.go(nearX(a.bolt[0], a.x), a.bolt[1]);
      if (a.walk(dt, this.world, SPEED.caballo * 2)) { a.bolt = null; a.vx = a.vy = 0; a.wait = 8; }
      return;
    }
    if (a.calling) {
      const o = this.player(a.callBy || a.owner);
      if (!o) { a.calling = false; delete a.callBy; delete a.callAt; return; }
      const at = a.callAt;
      if (at) {
        delete a.callAt;
        if (Array.isArray(at) && Number.isFinite(at[0]) && Number.isFinite(at[1]) && !this.world.blocked(at[0], at[1])) { a.x = a.tx = at[0]; a.y = a.ty = at[1]; a.vx = a.vy = 0; }
      }
      this.comeTo(a, dt, o);
      return;
    }
    if (a.halt !== undefined) {   // (its menu is open, or it is being brushed, fed or patted: it stands still)
      const left = a.halt - (this.world.clock || 0);
      if (left > 0 && left < 60) { this.stopGrazing(a); a.vx = a.vy = 0; a.tx = a.x; a.ty = a.y; return; }
      delete a.halt;
    }
    if (!day) this.stopGrazing(a);   // (si anochece o llueve comiendo, lo deja)
    if (a.stay && a.at) {   // (Stay: around where it was left, not at home)
      const cx = nearX(a.at[0], a.x), cy = a.at[1];
      if (!(day && this.graze(a, dt, cx, cy, STAY_GRAZE))) a.roam(dt, this.world, cx, cy, STAY_ROAM);
      return;
    }
    const spot = a.home2 || a.at || (a.grazeHome ??= [a.x, a.y]), cx = nearX(spot[0], a.x), cy = spot[1];
    if (!(day && this.graze(a, dt, cx, cy, a.home2 ? GRAZE_R : STAY_R, !!a.home2 && inYard(cx, cy)))) a.roam(dt, this.world, cx, cy, a.home ? ROAM : 2);
  }
  // Called (whoever runs the world): its way starts now, with nothing left of the one before
  called(a) { a.calling = true; a.stuck = 0; a.around = null; a.swing = undefined; a.tries = 0; a.best = undefined; a.replaced = false; }
  // On its way to whoever whistled (o), at the gait of its level (level 1 trots, level 2 canters, from level 3 it gallops;
  // ?vinculo=0, the gallop of before)
  comeTo(a, dt, o) {
    const g = this.game, off = g.horse?.off, ox = nearX(o.x, a.x), d = Math.hypot(ox - a.x, o.y - a.y), R = a.around;
    let sp = off ? RUN.caballo : COME[levelOf(a.love) - 1];
    if (!off && d < COME_SLOW) sp = Math.max(COME_END, sp * 0.7);
    if (R) a.go(R[0], R[1]); else a.go(ox + 1, o.y + 0.5);
    const there = a.walk(dt, this.world, sp);
    if (distOf(a.x, a.y, o.x, o.y) < 1.8) { this.callDone(a); return; }
    if (R && (there || g.time > R[2])) {
      a.around = null; a.stuck = 0;
      if (a.swing !== undefined) { const s = a.swing; a.swing = undefined; this.sideRun(a, s, 5 + a.tries, sp); }   // (out of a pocket: now to the side of it)
      return;
    }
    if (a.stuck > STUCK) this.goAround(a, o, ox, d, sp);
  }
  callDone(a) { a.calling = false; a.vx = a.vy = 0; a.around = null; a.swing = undefined; a.stuck = 0; a.wait = 6; delete a.callBy; }
  // Something cuts its way: to one side of the straight line, the first direction with room to run (the same side as the
  // last time first, and farther each time, so it follows a long wall), and then straight again. Every third try it backs out
  // and goes wide of it (a pocket open towards it)
  goAround(a, o, ox, d, sp) {
    const g = this.game;
    a.stuck = 0; a.swing = undefined;
    if (!(a.best - d < 1.5)) { a.best = d; a.tries = 0; }   // (getting closer: it starts counting again)
    if (++a.tries > COME_TRIES) {
      if (d <= COME_NEAR || a.replaced) { this.callDone(a); return; }
      // (the last resort: from behind the camera of whoever called, as the jump-in; of another player only their facing is known)
      const at = g.horse?.jumpSpot?.(o, o === g.player ? undefined : Math.atan2(-Math.cos(o.yaw || 0), -Math.sin(o.yaw || 0)));
      if (!at) { this.callDone(a); return; }
      a.x = a.tx = at[0]; a.y = a.ty = at[1]; a.vx = a.vy = 0;
      a.replaced = true; a.around = null; a.tries = 0; a.best = undefined;
      return;
    }
    const base = Math.atan2(o.y + 0.5 - a.y, ox + 1 - a.x), reach = Math.min(10, 2.5 + a.tries * 1.2);
    a.side ||= Math.random() < 0.5 ? 1 : -1;
    if (a.tries % 3 === 0) {
      let back = 0, far = 0;
      for (const off of BACK) { const n = this.clearRun(a, base + Math.PI + off, 3 + a.tries); if (n > far) { far = n; back = off; } }
      if (this.sideRun(a, base + Math.PI + back, far, sp)) { a.swing = base + a.side * Math.PI / 2; a.side = -a.side; return; }
    }
    for (const s of [a.side, -a.side]) for (const off of AROUND) if (this.sideRun(a, base + off * s, reach, sp)) { a.side = s; return; }
  }
  // A run that way, if there is room for one: its next stretch, instead of straight to whoever called
  sideRun(a, ang, reach, sp) {
    const n = this.clearRun(a, ang, reach);
    if (n < 1.5) return false;
    a.around = [a.x + Math.cos(ang) * n, a.y + Math.sin(ang) * n, this.game.time + n / sp + 0.5];
    return true;
  }
  // How far it could run that way (m, up to reach) with nothing in between
  clearRun(a, ang, reach) {
    const w = this.world, dx = Math.cos(ang), dy = Math.sin(ang), q = { x: 0, y: 0 };
    for (let r = 0.5; r <= reach; r += 0.5) {
      const x = q.x = a.x + dx * r, y = q.y = a.y + dy * r;
      if (a.deep(w, x, y)) return r - 0.5;
      collide(q, w.collidersNear(x, y), 0.26);
      if (Math.abs(q.x - x) + Math.abs(q.y - y) > 0.03) return r - 0.5;
    }
    return reach;
  }
  // (whoever runs the world, once a second) The horses' books (Plan F §3.1): progress (bx, a counter every partner adds to)
  // turned into hearts here only, so none is counted twice. (The saddlebags' stale locks: Saddlebags.sweep)
  horseBooks() {
    for (const a of this.animals) {
      if (!a.def.ride) continue;
      if (a.bx !== undefined) {
        const s = settle(a.love, a.bx);
        if (s.love !== a.love) { a.love = s.love; this.game.gather?.chips?.(a.x, a.y, 'heart', 10); }
        if (s.bx !== a.bx) a.bx = s.bx;
      }
    }
  }

  // Perro y gato: el perro sigue a su dueño cuando está jugando (y escarba, ladra y va a por la pelota); el gato,
  // en casa, cerca de su cojín. De noche, los dos duermen en su sitio. Los callejeros pasean por la plaza.
  updatePet(a, dt, night) {
    const g = this.game, owner = a.owner && this.player(a.owner), home = a.home2 || (a.stray ? [SPAWN.x + (a.type === 'gato' ? 3 : -3), SPAWN.y + 1.5] : null);
    a.inside = false;
    // Sentado (con clic derecho o con X): se queda ahí, también de noche, hasta que se le levanta
    if (a.sit) { a.vx = a.vy = 0; a.tx = a.x; a.ty = a.y; a.fetch = null; a.sleep = false; return; }
    if (a.type === 'perro' && a.fetch) return this.fetch(a, dt, owner);
    const follow = owner && a.type === 'perro' && !night;
    if (follow) {
      a.sleep = false;
      const d = Math.hypot(owner.x - a.x, owner.y - a.y);
      // (se había quedado atrás: aparece corriendo; si su dueño nada, no: los perros no nadan, lo espera en la orilla)
      if (d > 16) { if (!owner.swim && !this.world.blocked(owner.x - 1, owner.y - 1)) { a.x = a.tx = owner.x - 1; a.y = a.ty = owner.y - 1; } else a.vx = a.vy = 0; return; }
      if (d > 2.2) { a.go(owner.x - 0.8, owner.y - 0.8); a.walk(dt, this.world, d > 5 ? RUN.perro * (owner.mount ? 1.4 : 1) : SPEED.perro * 1.8); }
      else { a.vx = a.vy = 0; if (Math.random() < dt * 0.3) a.faceTo(owner.x - a.x, owner.y - a.y); }
      this.dogChores(a, owner, dt);
      return;
    }
    if (!home) { a.sleep = night; if (!night) a.roam(dt, this.world, a.x, a.y, 1.5); return; }
    // El gato se acerca a su dueño si anda cerca
    if (a.type === 'gato' && owner && !night && Math.hypot(owner.x - a.x, owner.y - a.y) < 4) { a.sleep = false; a.go(owner.x - 0.5, owner.y - 0.5); a.walk(dt, this.world, SPEED.gato); return; }
    if (night) {
      const d = Math.hypot(a.x - home[0], a.y - home[1]), seen = Math.hypot(a.x - g.player.x, a.y - g.player.y) < 10;
      if (d < 1 || (d > 10 && !seen)) { a.x = a.tx = home[0]; a.y = a.ty = home[1]; a.vx = a.vy = 0; a.sleep = true; }   // (a su sitio, y a dormir)
      else { a.go(home[0], home[1]); if (a.walk(dt, this.world, SPEED[a.type] * 1.5)) { a.x = home[0]; a.y = home[1]; } a.sleep = false; }
      return;
    }
    a.sleep = false;
    a.roam(dt, this.world, home[0], home[1], a.type === 'gato' ? 2 : 3);
  }
  // Lo que hace el perro de paseo: escarbar una vez al día (sale algo), y ladrar a los animales salvajes
  dogChores(a, owner, dt) {
    const g = this.game;
    if (a.digDay !== this.today && Math.random() < dt / 90 && !inBounds(a.x, a.y)) {
      a.digDay = this.today;
      g.gather.chips(a.x, a.y, 'dirt', 12);
      Audio.till();
      let r = Math.random(), id = DIGS[0][0];
      for (const [k, c] of DIGS) { if ((r -= c) <= 0) { id = k; break; } }
      if (id === 'semillas') id = 'semilla_nabo';
      g.gather.addDrop({ id, x: a.x, y: a.y, z: 4, vz: 50, t: -1, scene: this.world });
      if (owner === g.player) g.gather.float(`¡${a.name} ha encontrado algo!`, '#fff3c0');
    }
    const wild = g.wildlife?.near(a.x, a.y, 6);
    if (wild && (this.barked || 0) < g.time) { this.barked = g.time + 6; wild.scared = g.time + 5; if (Math.hypot(g.player.x - a.x, g.player.y - a.y) < 20) Audio.bark(); }
  }
  // Ir a por la pelota y traérsela a su dueño (la deja a sus pies)
  fetch(a, dt, owner) {
    const g = this.game, ball = g.gather.drops.find(d => d.id === 'pelota' && !d.back && d.scene === this.world);
    a.sleep = false;
    if (a.fetch === 'go') {
      if (!ball) { a.fetch = owner ? 'back' : null; return; }
      if (ball.z > 0) return;
      a.go(ball.x, ball.y);
      if (a.walk(dt, this.world, RUN.perro) || Math.hypot(a.x - ball.x, a.y - ball.y) < 0.5) { g.gather.drops.splice(g.gather.drops.indexOf(ball), 1); g.live.taken(ball); a.fetch = 'back'; }
      return;
    }
    if (!owner) { a.fetch = null; return; }
    a.go(owner.x, owner.y);
    if (a.walk(dt, this.world, RUN.perro) || Math.hypot(a.x - owner.x, a.y - owner.y) < 1.1) {
      a.fetch = null;
      const d = Math.hypot(a.x - owner.x, a.y - owner.y) || 1, k = Math.min(1, 0.7 / d);   // (a los pies de su dueño, aunque se haya atascado)
      g.gather.addDrop({ id: 'pelota', back: true, x: owner.x + (a.x - owner.x) * k, y: owner.y + (a.y - owner.y) * k, z: 2, vz: 20, t: -1, scene: this.world });
      if (a.petDay !== this.today) { a.petDay = this.today; a.love = Math.min(10, a.love + 1); }
      Audio.bark();
    }
  }
  // Si alguien ha tirado una pelota, su perro va a por ella
  updateBall() {
    const ball = this.game.gather.drops.find(d => d.id === 'pelota' && !d.back && d.scene === this.world);
    if (!ball) return;
    const dog = this.animals.find(a => a.type === 'perro' && a.owner === (ball.owner || me()) && !a.fetch && !a.sit);
    if (dog && Math.hypot(dog.x - ball.x, dog.y - ball.y) < 20) dog.fetch = 'go';
  }
  // Un jugador (yo o alguien jugando conmigo en el mundo) por su cuenta: { x, y, mount }
  player(id) {
    const g = this.game;
    if (id === me()) return g.player && g.scene === this.world ? g.player : null;
    for (const peer of g.live.peers?.values() || []) if (peer.id === id && peer.entity && peer.sc === 'world') return peer.entity;
    return null;
  }

  entities(scene) {
    if (scene !== this.world) return null;
    const p = this.game.player;
    return this.animals.filter(a => {
      a.young = this.young(a);
      if (a.rider) return false;
      if (a.inside) { const s = this.stall(a); if (!s) return false; a.x = s[0]; a.y = s[1]; a.dir = s[2]; a.vx = a.vy = 0; }
      return Math.abs(dxOf(a.x, p.x)) + Math.abs(a.y - p.y) < (a.def.ride ? DRAWN_HORSE : DRAWN);   // (a called horse is seen coming from afar)
    });
  }

  // ---------- cada mañana ----------
  // Comen (pastando, del comedero o del heno del silo) y dan su producto; si nadie les hace caso, se ponen
  // tristes. Nacen las crías, salen los polluelos de la incubadora; el zorro ronda las casas abiertas, los
  // ratones roen el heno si no hay gato, y alguna vez aparece un perro o un gato callejero en la plaza.
  onDay(day) {
    if (this.game.live.guest) return;   // (en el mundo de otro, de los animales se ocupa su juego)
    const winter = this.days.season === 3, news = [];
    for (const a of this.animals) {
      const def = a.def;
      a.young = this.young(a);
      if (def.pet || def.ride) {
        if (a.petDay < day - 3 && a.brushDay !== day - 1 && a.carrotDay !== day - 1 && a.love > 0) {
          a.love--;
          if (def.ride && !this.game.horse?.off) a.bx = BX_AFTER_LOSS;   // (one bad week does not wipe out a level: Plan F §1.2)
        }
        if (def.ride && this.grazedOn(a, day - 1) >= GRAZE_NEED) a.fedDay = day;   // (el caballo pasta, pero no le hace falta)
        continue;
      }
      // (los que pastan, con sus casillas de ayer; los demás, con haber salido. Los de una partida de antes de pastar, la
      // primera mañana, aún con haber salido: ayer no llevaban la cuenta)
      const old = a.grazeDay === undefined, grazed = GRAZERS.has(a.type) && !old ? this.grazedOn(a, day - 1) >= GRAZE_NEED : !winter && a.outDay >= day - 1;
      if (old && GRAZERS.has(a.type)) a.grazeDay = -1;
      const fed = grazed || this.eatFromFeeder(a) || this.eatHay();
      if (a.petDay < day - 2) a.love = Math.max(0, a.love - 1);
      if (!fed) continue;
      a.fedDay = day;
      a.days++;
      if (!a.young && a.breed !== 'gallo' && a.days % def.every === 0 && (!def.truffle || grazed)) a.ready = true;
    }
    this.breed(day, news);
    this.hatch(day, news);
    this.nightVisits(day, news);
    this.strays(day);
    for (const n of news) hud.toast(n, 'good');
  }
  breed(day, news) {
    for (const a of [...this.animals]) {
      const def = a.def;
      if (a.expecting !== undefined && a.expecting !== null && day - a.expecting >= WAIT_BIRTH) {
        a.expecting = null; a.bredDay = day;
        const h = this.homeOf(a), room = h && this.homes(def.home).find(x => x.k === h.k)?.free > 0;
        if (!room) continue;
        const mate = this.animals.find(b => b !== a && b.type === a.type && String(b.home) === String(a.home) && !this.young(b));
        this.animals.push(new Animal({ type: a.type, name: def.baby, named: false, home: a.home, owner: a.owner, x: a.x, y: a.y, born: day, outDay: day, breed: pick([a.breed, mate?.breed || a.breed]) }));
        news.push(`¡${a.name} ha tenido ${an(def.baby)}! Ve a ponerle nombre.`);
      }
    }
    // Parejas: dos adultos contentos de la misma especie en la misma casa, con sitio para una cría
    const groups = new Map();
    for (const a of this.animals) {
      if (a.def.bird || a.def.pet || !a.home || this.young(a) || a.love < 6) continue;
      const k = `${a.type}@${a.home}`;
      groups.set(k, [...(groups.get(k) || []), a]);
    }
    for (const list of groups.values()) {
      if (list.length < 2 || list.some(a => a.expecting !== undefined && a.expecting !== null) || list.some(a => a.bredDay > day - 6)) continue;
      const h = this.homeOf(list[0]);
      if (!h || this.homes(list[0].def.home).find(x => x.k === h.k)?.free <= 0 || Math.random() > 0.25) continue;
      const mom = pick(list);
      mom.expecting = day;
      news.push(`${mom.name} va a tener ${an(mom.def.baby)} dentro de ${WAIT_BIRTH} días.`);
    }
  }
  hatch(day, news) {
    for (const inc of this.placed('incubadora')) {
      const e = inc.d.incub?.[inc.k];
      if (!e || day - e.day < HATCH || !ITEMS[e.id]) continue;   // (un huevo de una versión más nueva: espera, tal cual)
      const type = e.id === 'huevo_pato' ? 'pato' : 'gallina', home = this.homes('gallinero').find(h => h.free > 0);
      if (!home) { news.push('Hay un polluelo a punto de salir, pero no cabe en ningún gallinero.'); continue; }
      delete inc.d.incub[inc.k];
      this.world.chestTouched(...inc.tile);
      this.animals.push(new Animal({ type, name: ANIMALS[type].baby, named: false, home: home.tile, born: day, outDay: day, breed: this.randomBreed(type, true) }));
      news.push(`¡Ha salido ${an(ANIMALS[type].baby)} de la incubadora! Ya está en el gallinero: ponle nombre.`);
    }
  }
  nightVisits(day, news) {
    const dog = this.animals.some(a => a.type === 'perro' && !a.stray), cat = this.animals.some(a => a.type === 'gato' && !a.stray);
    if (!dog) for (const kind of ['gallinero', 'conejera', 'establo']) for (const h of this.placed(kind)) {
      const list = this.animals.filter(a => a.home && a.home[0] === h.tile[0] && a.home[1] === h.tile[1]);
      if (!list.length || h.d.door?.[h.k] === 0 || Math.random() > 0.1) continue;
      for (const a of list) a.love = Math.max(0, a.love - 1);
      news.push(`Esta noche un zorro ha rondado ${kind === 'establo' ? 'el establo' : kind === 'conejera' ? 'la conejera' : 'el gallinero'} con la puerta abierta y los animales están asustados. Ciérrala por la noche, o ten un perro.`);
    }
    if (!cat && this.farm.hay > 0 && Math.random() < 0.3) {
      const n = Math.min(this.farm.hay, 1 + Math.floor(Math.random() * 3));
      this.farm.hay -= n;
      news.push(`Los ratones se han comido ${n} de heno del silo. Un gato los espantaría.`);
    }
    // Los regalos del gato, junto a su cojín
    for (const a of this.animals) if (a.type === 'gato' && a.owner && a.love >= 3 && Math.random() < 0.25) {
      const [x, y] = a.home2 || [a.x, a.y];
      this.game.gather.addDrop({ id: pick(GIFTS), x, y: y - 0.6, z: 0, vz: 0, t: -1, scene: this.world });
      if (a.owner === me()) news.push(`${a.name} te ha dejado un regalo junto a su cojín.`);
    }
  }
  // Un perro o un gato callejero en la plaza, para adoptar (si no hay ya uno, y cada pocos días)
  strays(day) {
    for (const type of ['perro', 'gato']) {
      const k = type === 'perro' ? 'strayDog' : 'strayCat';
      if (this.animals.some(a => a.type === type && a.stray) || (this.farm[k] ?? -STRAY_EVERY) > day - STRAY_EVERY) continue;
      this.farm[k] = day;
      this.animals.push(new Animal({ type, stray: true, name: type === 'perro' ? 'Perro callejero' : 'Gato callejero', named: false, x: SPAWN.x + (type === 'perro' ? -3 : 3), y: SPAWN.y + 1.5, born: day - 30, breed: this.randomBreed(type) }));
    }
  }
  eatFromFeeder(a) {
    for (const [, d] of this.world.deltas) {
      for (const [k, n] of Object.entries(d.feed || {})) {
        const [tx, ty] = k.split(',').map(Number);
        if (n > 0 && a.home && Math.hypot(tx - a.home[0], ty - a.home[1]) < 12) { d.feed[k]--; this.world.chestTouched(tx, ty); return true; }
      }
    }
    return false;
  }
  eatHay() { if (this.farm.hay > 0) { this.farm.hay--; return true; } return false; }

  // ---------- con E ----------
  interact(p, scene) {
    if (scene !== this.world) return null;
    let best = null, bd = 1.4;
    for (const a of this.animals) { if (a.inside || a.rider) continue; const d = distOf(a.x, a.y, p.x, p.y); if (d < bd && scene.reaches(p.x, p.y, nearX(a.x, p.x), a.y)) { bd = d; best = a; } }
    if (best) return this.talk(best);
    const o = this.world.placedNear(p.x, p.y, 1.3).find(o => !o.fixed && scene.reaches(p.x, p.y, o.x, o.y));
    return o ? this.objectAction(o) : null;
  }
  // El establo abierto en el que está alguien (o null)
  houseAround(p) {
    for (const o of this.world.placedNear?.(p.x, p.y, 3) || []) {
      if (o.placed !== 'establo' || o.model === 'establo:shut' || o.yaw === undefined) continue;
      const [ux, uy] = sideOf(o.yaw), [vx, vy] = dirOf(o.yaw), dx = p.x - o.x, dy = p.y - o.y;
      if (Math.abs(dx * ux + dy * uy) < 2 && Math.abs(dx * vx + dy * vy) < 1.5) return o;
    }
    return null;
  }
  // Dónde está dentro del establo, si se puede ver (con la puerta abierta se entra a verlos): [x, y, hacia dónde mira]
  stall(a) {
    if (!a.inside || a.def.home !== 'establo' || !a.home || !this.doorOpen(a)) return null;
    const [tx, ty] = a.home, k = `${tx},${ty}`, d = this.world.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)), raw = d?.placed?.[k];
    if (!raw) return null;
    const pos = d.pos?.[`placed:${k}`] || [tx + 0.5, ty + 0.5, ((+raw.split('@')[1] || 0) % 4) * Math.PI / 2];
    const [lx, lz] = STALLS[Math.max(0, this.livingIn(a.home).indexOf(a)) % STALLS.length], [ux, uy] = sideOf(pos[2]), [vx, vy] = dirOf(pos[2]);
    return [pos[0] + ux * lx + vx * lz, pos[1] + uy * lx + vy * lz, [vx, vy]];
  }
  // Los animales que viven en una casa
  livingIn(tile) { return this.animals.filter(a => a.home && a.home[0] === tile[0] && a.home[1] === tile[1]); }
  // Los animales tuyos que podrían vivir en esta casa y no viven en ella, primero los que no tienen casa. Tuyos: los que
  // llevan tu nombre y los que no son de nadie (los comprados antes de que llevaran dueño, que son de la granja)
  assignable(kind, tile) {
    const here = a => a.home && a.home[0] === tile[0] && a.home[1] === tile[1];
    return this.animals.filter(a => a.def.home === kind && !a.stray && !a.rider && !here(a) && (!a.owner || a.owner === me())).sort((a, b) => !!this.homeOf(a) - !!this.homeOf(b));
  }
  // Que un animal pase a vivir en una casa: aparece delante de ella (no saben buscar el camino desde lejos). at: para
  // que, jugando juntos, el anfitrión también lo ponga ahí
  assign(a, tile) {
    a.home = [tile[0], tile[1]];
    a.inside = false; a.sleep = false; a.sit = false;
    const [x, y] = a.home2;
    a.x = a.tx = x; a.y = a.ty = y; a.vx = a.vy = 0; a.wait = 1;
    a.at = [+x.toFixed(2), +y.toFixed(2)];
    this.game.onSave?.();
  }
  // Por qué no salen aunque la puerta esté abierta (o nada)
  stayIn() {
    const T = this.days, h = T.hour;
    if (T.season === 3) return 'Puerta abierta: en invierno se quedan dentro';
    if (T.info.rain) return 'Puerta abierta: saldrán cuando pare de llover';
    return h >= 19.5 || h < 6.5 ? 'Puerta abierta: saldrán por la mañana' : '';
  }
  // El menú de una casa: quién vive en ella, abrir o cerrar la puerta (las que tienen) y asignarle uno de tus animales
  async houseMenu(o) {
    const g = this.game, kind = o.placed, house = ITEMS[kind].name, list = this.livingIn(o.tile), cap = PER_HOME[kind] || 4, who = this.assignable(kind, o.tile), opts = [];
    const d = this.world.delta(Math.floor(o.tile[0] / 16), Math.floor(o.tile[1] / 16), true), k = `${o.tile[0]},${o.tile[1]}`, open = d.door?.[k] !== 0;
    if (DOORS.has(kind)) opts.push([`${open ? 'Cerrar' : 'Abrir'} la puerta`, () => { d.door ||= {}; if (open) d.door[k] = 0; else delete d.door[k]; this.world.touch(Math.floor(o.tile[0] / 16), Math.floor(o.tile[1] / 16)); Audio.door(); g.gather.float(open ? 'Puerta cerrada: entran y se quedan dentro' : this.stayIn() || 'Puerta abierta: ya salen', '#fff3c0'); }]);
    if (who.length && list.length < cap) opts.push(['Asignar un animal', () => this.assignMenu(o, who)]);
    opts.push(['Nada', null]);
    const note = list.length >= cap ? ' Está llena.' : who.length ? '' : ' No tienes más animales que puedan vivir aquí.';
    g.busy = true;
    const i = await hud.ask(house, `${list.length ? list.map(a => a.name).join(', ') : 'No vive nadie'} (${list.length} de ${cap}).${note}`, opts.map(x => x[0]));
    g.busy = false;
    opts[i]?.[1]?.();
  }
  // Elegir a quién: de MENU_PAGE en MENU_PAGE, para que la lista quepa en la pantalla
  async assignMenu(o, who) {
    const g = this.game, house = ITEMS[o.placed].name.toLowerCase();
    for (let page = 0; ;) {
      const some = who.slice(page, page + MENU_PAGE), more = who.length > MENU_PAGE;
      const labels = some.map(a => { const h = this.homeOf(a); return `${a.name} (${a.def.name.toLowerCase()}${this.young(a) ? ', cría' : ''}, ${h ? 'en otra casa' : 'sin casa'})`; });
      g.busy = true;
      const i = await hud.ask(`Asignar a ${house}`, '¿Quién va a vivir aquí?', [...labels, ...(more ? ['Ver más'] : []), 'Nada']);
      g.busy = false;
      if (i < some.length) { const a = some[i]; this.assign(a, o.tile); Audio.place(); hud.toast(`${a.name} ya vive en esta casa`, 'good'); return; }
      if (!more || i > some.length) return;
      page = page + MENU_PAGE >= who.length ? 0 : page + MENU_PAGE;
    }
  }
  // Lo que se hace con algo de la granja puesto en el mundo (colmena, comedero, corrales, silo…), o null
  objectAction(o) {
    const d = this.world.delta(Math.floor(o.tile[0] / 16), Math.floor(o.tile[1] / 16), true), k = `${o.tile[0]},${o.tile[1]}`, inv = this.game.inv;
    const touched = () => this.world.chestTouched(...o.tile);
    switch (o.placed) {
      case 'colmena': {
        d.hive ||= {};
        d.hive[k] ??= this.today;
        if (this.today - d.hive[k] >= HONEY_EVERY && this.days.season !== 3) return { text: 'Recoger miel', run: () => { d.hive[k] = this.today; touched(); this.game.gather.spawnDrops(o, { drops: [['miel', 1, 2]] }); Audio.pickup(); } };
        return null;
      }
      case 'comedero': {
        d.feed ||= {};
        const food = FEED.find(id => inv.count(id) > 0), n = d.feed[k] || 0;
        if (!food) return { text: `Comedero: ${n} raciones (pon heno, fibra o trigo)`, run: () => Audio.error() };
        return { text: `Llenar el comedero (${n} raciones)`, run: () => { const k2 = Math.min(10, inv.count(food)); inv.remove(food, k2); d.feed[k] = n + k2; touched(); Audio.place(); } };
      }
      case 'gallinero': case 'establo': case 'conejera': case 'cuadra': {
        const list = this.livingIn(o.tile);
        return { text: `${ITEMS[o.placed].name}: ${list.length ? list.map(a => a.name).join(', ') : 'vacío'}`, run: () => this.houseMenu(o) };
      }
      case 'caseta': case 'cojin': {   // (se usan con E; se recogen con X)
        const list = this.livingIn(o.tile);
        return { text: `${ITEMS[o.placed].name}: ${list.length ? list[0].name : 'vacío'}`, run: () => this.houseMenu(o), alt: { text: `Recoger ${ITEMS[o.placed].name.toLowerCase()}`, run: () => this.game.pickUp(o) } };
      }
      case 'silo': {
        const cap = this.siloCap, hay = this.farm.hay, have = inv.count('heno');
        if (have && hay < cap) return { text: `Guardar ${Math.min(have, cap - hay)} de heno en el silo (${hay}/${cap})`, run: () => { const n = Math.min(have, cap - hay); inv.remove('heno', n); this.farm.hay += n; Audio.place(); } };
        if (hay) return { text: `Silo: ${hay}/${cap} de heno · Sacar heno`, run: () => { const n = Math.min(hay, 20); const left = inv.add('heno', n); this.farm.hay -= n - left; Audio.pickup(); } };
        return { text: `Silo vacío (0/${cap}): siega con la guadaña y el heno se guarda solo`, run: () => Audio.blip() };
      }
      case 'incubadora': {
        d.incub ||= {};
        const e = d.incub[k];
        if (e && !ITEMS[e.id]) return { text: `Incubadora: ${UNKNOWN_NAME.toLowerCase()}`, run: () => Audio.error() };
        if (e) { const left = Math.max(0, HATCH - (this.today - e.day)); return { text: `Incubadora: ${ITEMS[e.id].name.toLowerCase()}, sale en ${left || 'menos de un'} día${left === 1 ? '' : 's'}`, run: () => Audio.blip() }; }
        const egg = ['huevo', 'huevo_pato'].find(id => inv.count(id) > 0);
        if (!egg) return { text: 'Incubadora (trae un huevo de gallina o de pato)', run: () => Audio.error() };
        return { text: `Poner ${ITEMS[egg].name.toLowerCase()} a incubar`, run: () => { inv.remove(egg, 1); d.incub[k] = { id: egg, day: this.today }; touched(); Audio.place(); } };
      }
      case 'palomar': return this.dovecote();
    }
    return null;
  }
  // Los que están en celo buscan a otro igual en celo cerca y van hacia él; al juntarse (o en la misma casa), nace
  // una cría, que va a la casa de uno de los dos si cabe
  mate(now) {
    const hot = this.animals.filter(a => a.heat > now && !this.young(a));
    for (const a of hot) {
      const b = hot.find(b => b !== a && b.type === a.type && b.heat > now && Math.hypot(b.x - a.x, b.y - a.y) < MATE_NEAR);
      if (!b) continue;
      if (Math.hypot(b.x - a.x, b.y - a.y) > 1 && !(a.inside && b.inside)) { a.go(b.x, b.y); b.go(a.x, a.y); continue; }
      const room = h => h && this.homes(a.def.home).some(x => x.tile[0] === h[0] && x.tile[1] === h[1] && x.free > 0);
      const baby = new Animal({ type: a.type, name: a.def.baby, named: false, home: room(a.home) ? a.home : room(b.home) ? b.home : null, owner: a.owner || b.owner, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, born: this.today, outDay: this.today, breed: pick([a.breed, b.breed].filter(Boolean)) });
      if (a.inside) baby.inside = true;
      this.animals.push(baby);
      for (const x of [a, b]) { delete x.heat; x.bredAt = now; }
      this.game.gather.chips(baby.x, baby.y, 'heart', 10);
      if (this.game.player) hud.toast(`¡Ha nacido ${an(a.def.baby)} en la granja! Ve a ponerle nombre.`, 'good');
      this.game.onSave?.();
    }
  }
  // Lo que tienes en la mano y le encanta a este animal (para que busque pareja), o null
  loveFood(a) {
    const held = this.game.inv.held?.id, foods = LOVE_FOOD[a.type];
    if (!held || !foods || this.young(a)) return null;
    return foods.includes(held) || (a.def.bird && held.startsWith('semilla_')) ? held : null;
  }
  // Dárselo: se pone en celo un rato (salvo si ya lo está o acaba de tener una cría)
  court(a, food) {
    const g = this.game, now = Date.now();
    if (a.heat > now) { g.gather.float(`${a.name} ya está buscando pareja`, '#ffb0c8'); return; }
    if (a.bredAt && now - a.bredAt < REST_MS) { g.gather.float(`${a.name} acaba de tener una cría: tiene que descansar`, '#fff3c0'); return; }
    g.inv.remove(food, 1);
    a.heat = now + HEAT_MS;
    g.xp?.add(1 + Math.random() * 2);
    g.gather.chips(a.x, a.y, 'heart', 8);
    g.skills?.gain('granja', 1);
    Audio.blip();
    g.onSave?.();
  }
  // Hablar con un animal: ponerle nombre, recoger lo suyo, acariciarlo; al caballo propio, su menú
  talk(a) {
    const def = a.def, mine = a.owner === me(), g = this.game;
    if (a.stray) return { text: `Adoptar ${a.type === 'perro' ? 'al perro' : 'al gato'}`, run: () => this.adopt(a) };
    if (!a.named && (!a.owner || mine)) return { text: `Ponerle nombre ${a.def.baby ? 'a la cría' : ''}`.trim(), run: () => this.name(a) };
    const grass = GRAZERS.has(a.type) ? `ha pastado ${Math.min(GRAZE_NEED, this.grazedOn(a))}/${GRAZE_NEED}` : '';   // (lo que lleva hoy)
    if (def.ride) { const h = this.horseTalk(a); if (h) return h; }
    if (a.ready) return { text: `${def.verb} (${a.name})`, run: () => this.collect(a) };
    const food = this.loveFood(a);
    if (food) return { text: `Darle ${ITEMS[food].name.toLowerCase()} a ${a.name} (para que tenga una cría)`, run: () => this.court(a, food) };
    const whose = a.owner && !mine ? `, de ${g.live.nameOf?.(a.owner) || 'otra persona'}` : '';
    const sit = def.pet && mine ? { text: a.sit ? 'Que se levante' : 'Que se siente', run: () => this.toggleSit(a) } : null;   // (el perro y el gato propios)
    if (a.petDay !== this.today) return { text: `Acariciar a ${a.name}${whose}${grass ? ` (${grass})` : ''}`, run: () => this.pet(a), alt: sit };
    // (si han comido esta mañana y, los que pastan, lo que llevan hoy, que es lo que cuenta para mañana)
    const fed = (a.fedDay === this.today ? 'ha comido' : 'tiene hambre') + (grass ? ` · ${grass}` : '');
    const state = def.pet ? (a.sit ? ' (sentado)' : '') : def.ride ? ` (${grass})` : ` (${a.young ? 'cría · ' : ''}${fed}${a.expecting !== undefined && a.expecting !== null ? ' · espera una cría' : ''})`;
    return { text: `${a.name} ${hearts(a.love)}${state}`, run: () => this.pet(a), alt: sit };
  }
  // Sentarse y quedarse ahí, o levantarse (y el perro, volver a seguirte), como en Minecraft
  toggleSit(a) {
    a.sit = !a.sit;
    if (a.sit) { a.fetch = null; a.vx = a.vy = 0; a.tx = a.x; a.ty = a.y; }
    this.game.gather.float(a.sit ? `${a.name} se sienta y espera` : a.type === 'perro' ? `${a.name} vuelve a seguirte` : `${a.name} se levanta`, '#fff3c0');
    if (a.type === 'perro') Audio.bark(); else Audio.meow();
    this.game.onSave?.();
  }
  // Clic derecho: tu perro o tu gato bajo el ratón (si no, el más cercano, a un par de pasos) se sienta o se levanta
  sitAt(tile) {
    const p = this.game.player;
    if (!p || this.game.scene !== this.world) return false;
    const pets = this.animals.filter(a => a.def.pet && a.owner === me() && !a.stray && Math.hypot(a.x - p.x, a.y - p.y) < 10), dist = (a, x, y) => Math.hypot(a.x - x, a.y - y);
    const at = tile && pets.filter(a => dist(a, tile[0] + 0.5, tile[1] + 0.5) < 1.2).sort((a, b) => dist(a, tile[0] + 0.5, tile[1] + 0.5) - dist(b, tile[0] + 0.5, tile[1] + 0.5))[0];
    const a = at || pets.filter(a => dist(a, p.x, p.y) < 2.5).sort((a, b) => dist(a, p.x, p.y) - dist(b, p.x, p.y))[0];
    if (!a) return false;
    this.toggleSit(a);
    return true;
  }
  pet(a) {
    if (a.def.ride && this.game.horse && !this.game.horse.off) { this.game.horse.care(a, 'pat'); return; }   // (the horse's bond: horse.js)
    this.petAsBefore(a);
  }
  petAsBefore(a) {
    if (a.petDay !== this.today) { a.petDay = this.today; a.love = Math.min(10, a.love + 1); this.game.skills?.gain('granja', 1); this.game.nature?.petted(a.type); }   // (the nature book: petted on 5 days, Known)
    this.game.gather.chips(a.x, a.y, 'heart', 6);
    a.wait = 1.5;
    if (a.type === 'perro') Audio.bark(); else if (a.type === 'gato') Audio.meow(); else if (a.type === 'caballo') Audio.neigh(); else Audio.blip();
  }
  async name(a) {
    const g = this.game;
    g.busy = true;
    const n = await hud.askText(a.def.name, `¿Cómo se va a llamar ${a.stray ? 'tu nuevo amigo' : `${a.young ? `${an(a.def.baby)} ` : ''}${a.breed && BREED_NAMES[a.breed] ? `(${BREED_NAMES[a.breed]})` : ''}`}?`.replace(/\s+\?/, '?'), this.freeName(a.type));
    g.busy = false;
    a.name = (n || '').trim().slice(0, 18) || this.freeName(a.type);
    a.named = true;
    Audio.unlock();
    hud.toast(`${a.name} ya tiene nombre`, 'good');
  }
  // Adoptar un perro o un gato callejero: es tuyo, duerme en tu caseta o tu cojín (si tienes)
  async adopt(a) {
    const kind = a.def.home, home = this.homes(kind).find(h => h.free > 0);
    a.stray = false; a.owner = me(); a.home = home?.tile || null;
    await this.name(a);
    this.game.stats?.add('mascotas', 1);
    hud.toast(home ? `${a.name} ya vive contigo` : `${a.name} ya es tuyo. Hazle ${kind === 'caseta' ? 'una caseta' : 'un cojín'} en el ${kind === 'caseta' ? 'banco' : 'telar'} para que tenga su sitio.`, 'good');
  }
  collect(a) {
    const def = a.def, g = this.game, drops = [[def.product, 1, 1]];
    a.ready = false;
    if (a.love >= 5 && Math.random() < 0.5) drops[0] = [def.product, 2, 2];   // los felices dan más
    if (def.special && a.love >= 8 && Math.random() < (a.breed === 'dorada' ? 0.3 : 0.12)) { drops.push([def.special, 1, 1]); g.gather.float(`¡${ITEMS[def.special].name}!`, '#ffd77a'); }
    if (def.also && Math.random() < def.also[1]) drops.push([def.also[0], 1, 1]);
    g.gather.spawnDrops(a, { drops });
    Audio.pickup();
    g.skills?.gain('granja', 2);
    g.stats?.add('productos', 1);
    g.nature?.harvested(a.type);   // (its product collected: Known in the nature book)
  }

  // ---------- el caballo ----------
  // E on a horse (Plan F): yours or your partner's opens its menu (X: its saddlebags); anyone else's, only a pat. null:
  // ?vinculo=0 and not yours (as before: the farm animals' prompt)
  horseTalk(a) {
    const H = this.game.horse, g = this.game;
    if (H?.ours(a)) {
      const bits = [a.young && tr('horse.foal'), GRAZERS.has(a.type) && tr('horse.grazed', { g: Math.min(GRAZE_NEED, this.grazedOn(a)), max: GRAZE_NEED })].filter(Boolean).join(' · ');
      const alt = a.bags ? { text: tr('horse.alt_bags'), run: () => g.saddlebags?.open(a) } : null;
      return { text: `${tr('horse.prompt', { name: a.name, hearts: horseHearts(a.love) })}${bits ? ` (${bits})` : ''}`, run: () => this.horseMenu(a), alt };
    }
    if (!H || H.off) return null;
    return { text: tr('horse.prompt_other', { name: a.name, who: g.live.nameOf?.(a.owner) || tr('horse.someone') }), run: () => H.care(a, 'pat') };
  }
  // El silbato en la mano: si no tienes caballo aún, lo eliges; si está cerca, montas; si no, viene; montado, bajas
  whistle(p) {
    const horse = this.myHorse(), own = this.animals.some(a => a.def.ride && a.owner === me() && !this.young(a));
    if (p.mount) return { tile: null, ok: true, label: tr('horse.item.get_off'), use: () => this.dismount() };
    // (a whistle of your own and no horse of your own yet: it is yours now, even if your partner has one)
    if (!horse || !own) return { tile: null, ok: true, label: tr('horse.item.blow'), use: () => this.newHorse() };
    if (distOf(horse.x, horse.y, p.x, p.y) < 2.6 && !horse.rider) return { tile: null, ok: true, label: tr('horse.item.mount', { name: horse.name }), use: () => this.mount(horse) };
    return { tile: null, ok: true, label: tr('horse.item.call', { name: horse.name }), use: () => this.callHorse(horse) };
  }
  // The horse the whistle is for: the last ridden, else your own, else your partner's (never a foal: horse.js pick)
  myHorse() { return this.game.horse?.pick() || null; }
  async newHorse() {
    const g = this.game, p = g.player, B = ANIMALS.caballo.breeds, coat = b => { const s = tr('horse.coat.' + b); return s[0].toUpperCase() + s.slice(1); };
    g.busy = true;
    const i = await hud.ask(tr('horse.new.title'), tr('horse.new.coat_q'), B.map(coat));
    const name = (await hud.askText(tr('horse.new.title'), tr('horse.new.name_q'), this.freeName('caballo')) || '').trim().slice(0, 18) || this.freeName('caballo');
    g.busy = false;
    const home = this.homes('cuadra').find(h => h.free > 0);
    const a = new Animal({ type: 'caballo', name, owner: me(), breed: B[i] || B[0], home: home?.tile || null, x: p.x + 1.2, y: p.y + 0.4, born: this.today - 7, at: [+(p.x + 1.2).toFixed(2), +(p.y + 0.4).toFixed(2)] });
    this.animals.push(a);
    Audio.neigh();
    hud.toast(tr(home ? 'horse.new.home' : 'horse.new.no_home', { name }), 'good');
  }
  mount(a) {
    const g = this.game, p = g.player, H = g.horse;
    if (g.carry?.refuse('mount')) return;   // (pushing the wheelbarrow, no; with a big thing in the arms, yes: it rides behind the saddle, carry.js)
    if (a.rider && a.rider !== me()) { g.gather.float(tr('horse.whistle.ridden', { who: g.live.nameOf?.(a.rider) || tr('horse.someone'), name: a.name }), '#fff3c0'); Audio.error(); return; }
    // (one writer for the saddlebags, the rider too: not while someone else has them open, Plan F §1.8)
    const holder = g.saddlebags?.holder?.(a);
    if (holder && holder !== me()) { g.gather.float(tr('horse.bags.busy', { who: g.live.nameOf?.(holder) || tr('horse.someone') }), '#fff3c0'); Audio.error(); return; }
    if (p.pose) g.rest?.stand();   // (sitting where it threw you)
    a.rider = me(); a.calling = false;
    delete a.stay; delete a.callBy; delete a.callAt; delete a.halt; a.bolt = null;   // (riding it ends Stay and a call)
    Object.assign(p, { mount: true, horseId: a.id, horseCoat: a.breed, horseBags: !!a.bags, horseFill: 0, horseDirt: +a.dirt || 0, horseAct: null, horseWinded: false, x: a.x, y: a.y });
    g.carry?.syncArms();   // (the hands on the reins: the tool works)
    g.gather.cooldown = 0.4;
    H?.update?.(0);   // (the horse under you now: its stamina, dirt and bags, before the first step)
    Audio.neigh();
  }
  dismount() {
    const g = this.game, p = g.player, a = this.animals.find(x => x.id === p.horseId);   // (no horse of that id: never another one)
    // (with a big thing behind the saddle, not into deep water: it comes back to the arms, and nobody swims with it)
    if (g.carry?.held && g.scene === this.world && this.world.waterDepth(p.x, p.y) >= SWIM_IN) { g.carry.say(tr('carry.no_dismount_water', { item: noun('item', g.carry.held) })); Audio.error(); return; }
    g.horse?.onDismount?.(a);   // (its dirt, written now)
    p.mount = false;
    p.horseAct = null; p.horseWinded = false;
    dropSprint();   // (never off a gallop straight into a sprint on foot)
    g.carry?.syncArms();
    this.game.gather.cooldown = 0.4;
    Audio.door();
    this.leave(a);
  }
  // Dying in the saddle (combat.die, before going home): the horse stays where you fell. (Without it, it kept you as its
  // rider for good: seen by nobody, and its saddlebags with it)
  onDeath() {
    const g = this.game, p = g.player;
    if (!p?.mount) return;
    const a = this.animals.find(x => x.id === p.horseId);
    g.horse?.onDismount?.(a);
    p.mount = false;
    p.horseAct = null; p.horseWinded = false;
    g.carry?.syncArms();
    this.leave(a);
  }
  // The horse under this player is left: nobody's to ride now, beside the player (or at the mouth of the cave they are in)
  leave(a) {
    const g = this.game, p = g.player;
    if (!a) return;
    g.saddlebags?.release?.(a);   // (the saddlebags' lock goes with the saddle)
    if (a.rider && a.rider !== me()) return;   // (someone else rides it now: nothing is written)
    a.rider = null;
    if (g.scene !== this.world) {
      const e = g.scene?.exitTo;
      if (e) { const x = e.x + (this.world.blocked(e.x + 1.2, e.y) ? 0 : 1.2); a.x = a.tx = x; a.y = a.ty = e.y; }
      a.at = [+a.x.toFixed(2), +a.y.toFixed(2)]; a.wait = 4;
      return;
    }
    // (a un lado, al que no sea agua honda; si los dos lo son, en un río, donde estaba, y se va solo a lo seco más cerca: de
    // ahí sale, ver deep, y luego pasta allí y no en el agua)
    const w = this.world, sides = [1, -1].map(s => [p.x + p.face.y * 0.9 * s, p.y - p.face.x * 0.9 * s]), side = sides.find(([x, y]) => !w.blocked(x, y));
    a.x = a.tx = side ? side[0] : p.x; a.y = a.ty = side ? side[1] : p.y;
    const dry = side ? null : this.dryNear(p.x, p.y);
    a.at = (dry || [a.x, a.y]).map(v => +v.toFixed(2));
    a.wait = dry ? 0 : 4;
    if (dry) a.go(dry[0], dry[1]);
  }
  // Lo seco (por donde andan los animales) más cerca de (x, y), a 12 m como mucho
  dryNear(x, y) {
    for (let r = 1; r <= 12; r++) for (let i = 0; i < 16; i++) { const ax = x + Math.cos(i * 0.3927) * r, ay = y + Math.sin(i * 0.3927) * r; if (!this.world.blocked(ax, ay)) return [ax, ay]; }
    return null;
  }
  // Call it with the held whistle: as N (horse.js whistle) but from any distance, as it always did; ?vinculo=0, as before
  callHorse(a) {
    const H = this.game.horse;
    if (H && !H.off) { H.whistle(a, true); return; }
    const p = this.game.player, spot = H && p && distOf(a.x, a.y, p.x, p.y) > 30 ? H.jumpSpot(p) : null;   // (far: it comes in from out of sight)
    a.call = (a.call || 0) + 1;
    a.callBy = me();
    if (spot) a.callAt = spot; else delete a.callAt;
    if (!this.game.live.guest) this.called(a);
    this.game.gather.float(tr('horse.whistle.come', { name: a.name }), '#fff3c0');
    Audio.whistle();
  }
  // The horse's menu (Plan F §4.3): what you have and what it knows. Yours or your partner's (horseTalk)
  async horseMenu(a) {
    const g = this.game, inv = g.inv, H = g.horse, opts = [], off = !H || H.off, L = levelOf(a.love);
    const treat = TREATS.find(id => inv.count(id) && (!off || id === 'zanahoria'));
    if (!this.young(a)) opts.push([tr('horse.ride'), () => this.mount(a)]);
    if (inv.count('cepillo') && (!off || a.brushDay !== this.today)) opts.push([tr('horse.brush'), () => H.care(a, 'brush')]);
    if (treat && (!off || a.carrotDay !== this.today)) opts.push([tr('horse.feed', { item: itemNoun(treat) }), () => H.care(a, 'feed', treat)]);
    if (!off) opts.push([tr('horse.pat'), () => H.care(a, 'pat')]);
    if (!off && a.stay) opts.push([tr('horse.graze'), () => H.trick('graze', a)]);
    else if (!off && L >= 2) opts.push([tr('horse.stay'), () => H.trick('stay', a)]);
    // (putting them on and taking them off: saddlebags.js when it has them, the one place that knows the lock)
    if (inv.count('alforjas') && !a.bags) opts.push([tr('horse.bags.on'), () => { if (g.saddlebags?.putOn) g.saddlebags.putOn(a); else { inv.remove('alforjas', 1); a.bags = padBags([]); Audio.place(); } g.onSave?.(); }]);
    if (a.bags) opts.push([tr('horse.bags.open'), () => g.saddlebags?.open(a)]);
    if (a.bags) opts.push([tr('horse.bags.off'), () => { if (g.saddlebags?.takeOff) g.saddlebags.takeOff(a); else this.bagsOff(a); g.onSave?.(); }]);
    if (inv.count('herraduras') && !a.shod) opts.push([tr('horse.shoes'), () => { inv.remove('herraduras', 1); a.shod = true; Audio.clink(); g.gather.float(tr('horse.shoes_on'), '#a8f07a'); }]);
    opts.push([tr('horse.nothing'), () => { if (off) this.petAsBefore(a); }]);
    g.busy = true;
    H?.halt(a, 25);   // (it stands still while you choose)
    const pct = a.love >= 10 ? 100 : Math.max(0, Math.min(99, Math.floor(+a.bx || 0)));
    const head = tr('horse.menu.head', { name: a.name, coat: tr('horse.coat.' + (ANIMALS.caballo.breeds.includes(a.breed) ? a.breed : 'castano')), n: L, level: tr('horse.level.' + L), hearts: horseHearts(a.love), pct, g: Math.min(GRAZE_NEED, this.grazedOn(a)), max: GRAZE_NEED });
    const tail = [tr(a.shod ? 'horse.menu.shod' : 'horse.menu.unshod'), tr(a.bags ? 'horse.menu.bags' : 'horse.menu.no_bags')].join(' · ');
    const i = await hud.ask(a.name, `${head} · ${tail}. ${tr('horse.menu.q')}`, opts.map(o => o[0]));
    g.busy = false;
    delete a.halt;
    opts[i]?.[1]();
  }
  // Take the saddlebags off (when saddlebags.js has no takeOff): only empty, and only when nobody else has them open; the item comes back
  bagsOff(a) {
    const g = this.game, holder = g.saddlebags?.holder?.(a);
    if (holder && holder !== me()) { g.gather.float(tr('horse.bags.busy', { who: g.live.nameOf?.(holder) || tr('horse.someone') }), '#fff3c0'); Audio.error(); return; }
    if (!Array.isArray(a.bags) || a.bags.some(Boolean)) { g.gather.float(tr('horse.bags.not_empty'), '#ffb0a0'); Audio.error(); return; }
    delete a.bags;
    const left = g.inv.add('alforjas', 1);
    if (left) g.gather.throwOut('alforjas', left);
    Audio.pickup();
    g.onSave?.();
  }
  bond(a, text) {
    a.love = Math.min(10, a.love + 1);
    this.game.gather.chips(a.x, a.y, 'heart', 8);
    this.game.gather.float(text, '#ff9ac8');
    this.game.skills?.gain('granja', 1);
    Audio.neigh();
  }
  bagsChanged(a) { a.bags.forEach((s, i) => { a.bags[i] = s || null; }); }   // (en su sitio: la ventana sigue leyéndolo; a los demás les llega al comparar la lista)

  // ---------- la pelota ----------
  target(p, held, def) {
    if (held?.id !== 'pelota' || this.game.scene !== this.world) return null;
    const dog = this.mine('perro').find(a => Math.hypot(a.x - p.x, a.y - p.y) < 10);
    if (!dog) return { tile: null, ok: false, label: 'Lánzala cerca de tu perro' };
    return { tile: null, ok: true, label: `Lanzar la pelota a ${dog.name}`, use: () => this.throwBall() };
  }
  throwBall() {
    const g = this.game, p = g.player;
    if (!g.inv.count('pelota')) return;
    g.inv.remove('pelota', 1);
    g.gather.cooldown = 0.5; g.gather.swing = 0.3; g.gather.swingItem = null;
    const d = 3.5 + Math.random() * 2.5;
    g.gather.addDrop({ id: 'pelota', x: p.x + p.face.x * d, y: p.y + p.face.y * d, z: 16, vz: 55, t: 0, scene: this.world });
    Audio.swish();
  }

  // ---------- el palomar ----------
  dovecote() {
    const g = this.game, mail = this.farm.mail.filter(mineNow), held = g.inv.held;
    if (mail.length) return { text: `Recoger lo que te han enviado (${mail.length})`, run: () => this.takeMail() };
    if (!held) return { text: 'Palomar (lleva en la mano lo que quieras enviar)', run: () => Audio.blip() };
    return { text: `Enviar con la paloma: ${held.n > 1 ? held.n + ' × ' : ''}${ITEMS[held.id].name.toLowerCase()}`, run: () => this.send() };
  }
  async send() {
    const g = this.game, held = g.inv.held, list = (Profile.players?.() || []).filter(x => x.id !== me());
    if (!held) return;
    if (!list.length) { hud.toast('No hay nadie más a quien enviar nada'); return; }
    g.busy = true;
    const i = await hud.ask('Palomar', `¿A quién le envías ${held.n > 1 ? held.n + ' × ' : ''}${ITEMS[held.id].name.toLowerCase()}?`, [...list.map(x => x.name), 'A nadie']);
    g.busy = false;
    const to = list[i];
    if (!to || g.inv.held !== held) return;
    const { id, n, ...extra } = held;
    g.inv.take(g.inv.selected, n, true);
    // (mid: el id del envío, para repartirlo jugando juntos: ver farmItems)
    this.farm.mail = [...this.farm.mail, { mid: `${me()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, to: to.id, from: g.player.name, id, n, extra: Object.keys(extra).length ? extra : undefined, day: this.today }];
    g.gather.chips(g.player.x, g.player.y, 'feather', 10);
    Audio.swish();
    hud.toast(`La paloma ha salido volando hacia ${to.name}`, 'good');
  }
  takeMail() {
    const g = this.game, mine = this.farm.mail.filter(mineNow);
    this.farm.mail = this.farm.mail.filter(m => !mineNow(m));   // (lo de una versión más nueva se queda en el palomar)
    for (const m of mine) { const left = g.inv.add(m.id, m.n, m.extra); if (left) g.gather.throwOut(m.id, left, m.extra); }
    Audio.unlock();
    hud.toast(mine.map(m => `${m.from}: ${m.n > 1 ? m.n + ' × ' : ''}${ITEMS[m.id].name.toLowerCase()}`).join(' · '), 'good');
    this.mailSeen = 0;
  }
  // Si te ha llegado algo, se avisa (una vez por cada envío nuevo)
  notifyMail() {
    const n = this.farm.mail.filter(mineNow).length;
    if (n > (this.mailSeen || 0) && this.game.player) hud.toast(`Te ha llegado una paloma con ${n} envío${n > 1 ? 's' : ''}: recógelo en un palomar`, 'good');
    this.mailSeen = n;
  }

  // ---------- el diario ----------
  journal() {
    const list = this.animals.filter(a => !a.stray), icon = a => (a.def.w ? animalSprite(a.type, 0).toDataURL() : null);
    const rows = list.map(a => {
      const age = this.young(a) ? ` · ${a.def.baby || 'cría'} de ${this.today - a.born} días` : '', who = a.owner ? ` · de ${a.owner === me() ? 'ti' : this.game.live.nameOf?.(a.owner) || 'otra persona'}` : '';
      const img = icon(a);
      // (a horse: its bond level and a thin line of the progress to the next heart, under the hearts; Plan F §4.3, the look
      // is index.html .j-hlv / .j-bx)
      const bond = a.def.ride && this.game.horse && !this.game.horse.off ? `<small class="j-hlv">${tr('journal.horse.level', { n: levelOf(a.love) })}</small><i class="j-bx" style="--p:${a.love >= 10 ? 100 : Math.max(0, Math.min(99, Math.floor(+a.bx || 0)))}%"></i>` : '';
      return `<div class="j-fish"><span class="j-cell done">${img ? `<img alt="" src="${img}">` : `<img alt="" data-icon="${a.def.home}">`}</span><span><b>${a.name}</b><small>${a.breed === 'gallo' ? 'Gallo' : `${a.def.name}${a.breed ? ' ' + BREED_NAMES[a.breed] : ''}`}${age}${who}${GRAZERS.has(a.type) ? ` · ha pastado ${Math.min(GRAZE_NEED, this.grazedOn(a))}/${GRAZE_NEED}` : ''}${a.expecting !== undefined && a.expecting !== null ? ' · espera una cría' : ''}</small></span><span class="lvl">${hearts(a.love)}${bond}</span></div>`;
    }).join('');
    const mail = this.farm.mail.filter(m => m.to === me()).length;
    return `<p class="j-note">Heno en el silo: ${this.farm.hay}${this.siloCap ? ` de ${this.siloCap}` : ' (aún no tienes silo)'}${mail ? ` · ${mail} envío${mail > 1 ? 's' : ''} esperando en el palomar` : ''}. Los animales contentos (caricias cada día) dan más y, a veces, algo especial; dos adultos muy contentos en la misma casa tienen crías. Las vacas, ovejas, cabras, conejos y caballos pastan: con ${GRAZE_NEED} casillas de hierba al día quedan alimentados (si no, comen del comedero o del heno del silo).</p>` + (rows || '<p class="j-note">Aún no tienes animales: Rosa los vende en su puesto.</p>');
  }
}

// El id de un envío del palomar para repartirlo: el suyo (mid) o, en los de antes de que lo llevaran, lo que es y cuántos
// iguales van delante (así es el mismo en todos los juegos)
function mailKey(m, seen) {
  if (typeof m?.mid === 'string') return `mail:${m.mid}`;
  const c = JSON.stringify(m), n = seen.get(c) || 0;
  seen.set(c, n + 1);
  return `mail:${c}#${n}`;
}

// "un cordero", "una cría"…
function an(word) { return /^(cría)$/.test(word) ? `una ${word}` : `un ${word}`; }
