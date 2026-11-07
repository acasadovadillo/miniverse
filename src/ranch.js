// Granja: animales que viven en su casa (gallinero, establo, conejera, cuadra), salen de día a pastar si la
// puerta está abierta, vuelven a dormir de noche (y con lluvia o en invierno se quedan dentro, comiendo del
// comedero o del heno del silo) y cada mañana tienen su producto; los muy felices, a veces, uno especial.
// Tienen crías: dos adultos contentos en la misma casa (las aves, con la incubadora) o, como en Minecraft, dos adultos
// a los que se da a mano lo que más les gusta (trigo, semillas o zanahorias), que se buscan y la tienen al momento. El caballo se monta y
// corre más cuanto más te quiere; el perro te sigue, escarba, avisa y va a por la pelota; el gato duerme en su
// cojín, espanta a los ratones del silo y te deja regalos. Y el palomar, para enviarle cosas a otra persona.
// Jugando juntos todo esto es del mundo del anfitrión: lo lleva su juego y los demás lo ven y lo tocan igual.
import { CHUNK } from './world/gen.js';
import { ITEMS } from './items.js';
import { ANIMALS, BREED_NAMES, animalSprite } from './art/farm.js';
import { SPAWN, inBounds } from './world/village.js';
import { collide } from './physics.js';
import { sideOf, dirOf } from './world/fit.js';
import { toView, fromView } from './iso.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { Profile } from './accounts.js';

const PER_HOME = { gallinero: 4, establo: 4, conejera: 4, cuadra: 2, caseta: 1, cojin: 1 };
const FRONT = { gallinero: 2.15, establo: 2.25 };   // las casas grandes: del centro a donde se entra (delante de la puerta)
const STALLS = [[-1.5, -0.45], [1.5, -0.45], [-0.5, -0.55], [0.5, -0.55]];   // dónde se ponen dentro del establo
const DOORS = new Set(['gallinero', 'establo', 'conejera']), MENU_PAGE = 5;   // (las casas con puerta y cuántos animales enseña el menú de una vez)
const ROAM = 4.5, HONEY_EVERY = 3, GROW = 5, WAIT_BIRTH = 3, HATCH = 4, SILO_CAP = 240, STRAY_EVERY = 7;
const FEED = ['heno', 'fibra', 'trigo'];
// Lo que se les da a mano para que busquen pareja (las aves, cualquier semilla), cuánto dura y cuánto descansan luego
const LOVE_FOOD = { gallina: ['trigo'], pato: ['trigo'], vaca: ['trigo'], oveja: ['trigo'], cabra: ['trigo'], cerdo: ['zanahoria'], conejo: ['zanahoria'] };
const HEAT_MS = 30000, REST_MS = 5 * 60000, MATE_NEAR = 8;
const SPEED = { gallina: 1.1, pato: 0.9, conejo: 1.3, cerdo: 0.8, cabra: 1, caballo: 1.3, perro: 1.6, gato: 1.2 };
const RUN = { perro: 4.2, gato: 2.6, caballo: 5 };   // corriendo (siguiendo a su dueño o al llamarlo)
const DIGS = [['bellota', 0.25], ['fibra', 0.2], ['pina', 0.15], ['semillas', 0.15], ['fosil_hueso', 0.08], ['moneda_antigua', 0.07], ['amatista', 0.05], ['fosil_concha', 0.05]];
const GIFTS = ['sardina', 'plumas', 'bellota', 'fibra', 'bayas', 'carpa'];
// Lo que se guarda de cada animal (lo demás es de paso: adónde va, si está dentro, si duerme…)
const KEEP = ['id', 'type', 'name', 'home', 'love', 'ready', 'days', 'petDay', 'fedDay', 'born', 'breed', 'owner', 'expecting', 'bredDay', 'outDay', 'named', 'brushDay', 'carrotDay', 'shod', 'bags', 'rider', 'at', 'call', 'stray', 'sit', 'heat', 'bredAt'];
const pick = list => list[Math.floor(Math.random() * list.length)];
const me = () => Profile.id || 'yo';
const hearts = n => '♥'.repeat(Math.ceil(n / 2)) || '·';

class Animal {
  constructor(data) {
    Object.assign(this, { love: 0, ready: false, days: 0, petDay: -1, fedDay: -1, flip: false, step: 0, vx: 0, vy: 0, wait: Math.random() * 3, named: true }, data);
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
    const o = { x: +this.x.toFixed(2), y: +this.y.toFixed(2) };
    for (const k of KEEP) if (this[k] !== undefined && this[k] !== null) o[k] = this[k];
    return o;
  }
  // Andar hacia (tx, ty) a una velocidad; al llegar, se para un rato. Devuelve si ha llegado
  walk(dt, world, sp) {
    const dx = this.tx - this.x, dy = this.ty - this.y, d = Math.hypot(dx, dy);
    if (d < 0.15) { this.vx = this.vy = 0; return true; }
    const s = Math.min(d, sp * dt), p = { x: this.x + (dx / d) * s, y: this.y + (dy / d) * s };
    collide(p, world.collidersNear(p.x, p.y), 0.22);
    if (world.water(p.x, p.y) === 'deep' || Math.hypot(p.x - this.x, p.y - this.y) < s * 0.3) { this.stuck = (this.stuck || 0) + dt; this.vx = this.vy = 0; return this.stuck > 1.5; }
    this.stuck = 0;
    this.faceTo(dx, dy);
    this.vx = (p.x - this.x) / dt; this.vy = (p.y - this.y) / dt;
    this.x = p.x; this.y = p.y;
    this.step += dt * 6;
    return false;
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
    this.animals = (save.animals || []).map(a => new Animal(a));
    this.farm = { hay: 0, mail: [], ...save.farm };
    this.mailSeen = 0;
    this.ball = null;
    this.gone = new Set();
    this.notifyMail();
  }
  save(out) { out.animals = this.animals.map(a => a.toSave()); out.farm = this.farm; }
  // Uno que ha muerto (gone: para que una lista de antes de saberlo no lo resucite, jugando juntos)
  remove(a) {
    const i = this.animals.indexOf(a);
    if (i >= 0) this.animals.splice(i, 1);
    this.gone.add(a.id);
  }
  // Jugando juntos en directo, como los tiene el anfitrión (sin dónde están: eso llega aparte). Si alguien
  // bajó de un caballo (at) se pone ahí; si alguien lo llamó (call), el anfitrión lo hace venir.
  share(list) {
    const old = new Map(this.animals.map(a => [a.id, a]));
    this.animals = list.filter(s => !this.gone.has(s.id)).map(s => {
      const a = old.get(s.id);
      if (!a) {
        const n = new Animal({ ...s, x: s.at?.[0], y: s.at?.[1] });
        if (!n.named && this.game.player) hud.toast(`¡Ha nacido ${an(n.def.baby)} en la granja!`, 'good');
        return n;
      }
      if (s.at && String(s.at) !== String(a.at)) { a.x = a.tx = s.at[0]; a.y = a.ty = s.at[1]; }
      if ((s.call || 0) > (a.call || 0) && !this.game.live.guest) a.calling = true;
      for (const k of KEEP) if (!(k in s)) delete a[k];
      return Object.assign(a, s);
    });
  }
  shareFarm(v) { this.farm = { hay: 0, mail: [], ...v }; this.notifyMail(); }

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
    if (g.scene !== this.world || g.live.guest) return;   // (en el mundo de otro, pasean donde dice su juego)
    const T = this.days, h = T.hour, night = h >= 19.5 || h < 6.5, bad = !!T.info.rain || T.season === 3;
    // El gallo canta al amanecer
    if (h >= 6 && h < 6.5 && this.crowed !== this.today && this.animals.some(a => a.breed === 'gallo' && Math.hypot(a.x - p.x, a.y - p.y) < 30)) { this.crowed = this.today; Audio.crow(); }
    this.mate(Date.now());
    for (const a of this.animals) {
      const def = a.def, far = Math.abs(a.x - p.x) + Math.abs(a.y - p.y) > 60;
      a.young = this.young(a);
      if (def.pet) { this.updatePet(a, dt, night); continue; }
      if (def.ride) { this.updateHorse(a, dt); continue; }
      // De granja: fuera de día con la puerta abierta; dentro de noche, con lluvia, en invierno o con la puerta cerrada
      const out = !night && !bad && this.doorOpen(a) && !!a.home;
      if (out) a.outDay = this.today;
      if (far) { if (!out && a.home) a.inside = true; continue; }   // (lejos: si tiene que estar dentro, ya lo está)
      if (!out && a.inside) continue;                               // (dentro no hace nada ni se dibuja: no gasta)
      if (a.panic > g.time) { a.walk(dt, this.world, (SPEED[a.type] || 1) * 3); continue; }   // (le han pegado: sale corriendo)
      if (!a.home) { a.inside = false; a.roam(dt, this.world, a.x, a.y, 1); continue; }
      const [hx, hy] = a.home2;
      if (out) {
        if (a.inside) { a.inside = false; a.x = a.tx = hx; a.y = a.ty = hy; }
        a.roam(dt, this.world, hx, hy);
        a.digging = def.truffle && !a.vx && !a.vy && Math.sin(g.time * 0.7 + a.x) > 0.6;
      } else if (!a.inside) {
        // Vuelve a casa y entra
        if (Math.hypot(a.tx - hx, a.ty - hy) > 0.1) a.go(hx, hy);
        if (a.walk(dt, this.world, (SPEED[a.type] || 1) * 1.4) || Math.hypot(a.x - hx, a.y - hy) < 0.4) { a.inside = true; a.x = hx; a.y = hy; }
      }
    }
    this.updateBall();
  }

  // El caballo: si lo monta alguien no se ve; si lo llaman, va al galope hasta su dueño; si no, pasta
  updateHorse(a, dt) {
    a.inside = false;
    if (a.rider) { if (a.rider !== me() && !this.player(a.rider)) a.rider = null; else return; }   // (si su jinete se fue, se queda ahí)
    if (a.calling) {
      const o = this.player(a.owner);
      if (!o) { a.calling = false; return; }
      if (Math.hypot(a.x - o.x, a.y - o.y) > 30) { const ang = Math.random() * Math.PI * 2; a.x = o.x + Math.cos(ang) * 14; a.y = o.y + Math.sin(ang) * 14; }   // (llega de lejos, al galope)
      a.go(o.x + 1, o.y + 0.5);
      if (a.walk(dt, this.world, RUN.caballo) || Math.hypot(a.x - o.x, a.y - o.y) < 1.8) {
        if (Math.hypot(a.x - o.x, a.y - o.y) > 2.6) { a.x = a.tx = o.x + 1.2; a.y = a.ty = o.y + 0.6; }   // (si algo le cortaba el paso, llega por otro lado)
        a.calling = false; a.vx = a.vy = 0; a.wait = 6;
      }
      return;
    }
    const [cx, cy] = a.home2 || a.at || [a.x, a.y];
    a.roam(dt, this.world, cx, cy, a.home ? ROAM : 2);
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
      if (d > 16) { a.x = a.tx = owner.x - 1; a.y = a.ty = owner.y - 1; return; }   // (se había quedado atrás: aparece corriendo)
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
      return Math.abs(a.x - p.x) + Math.abs(a.y - p.y) < 30;
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
      if (def.pet || def.ride) { if (a.petDay < day - 3 && a.brushDay !== day - 1 && a.carrotDay !== day - 1) a.love = Math.max(0, a.love - 1); continue; }
      const grazed = !winter && a.outDay >= day - 1, fed = grazed || this.eatFromFeeder(a) || this.eatHay();
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
      if (!e || day - e.day < HATCH) continue;
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
    for (const a of this.animals) { if (a.inside || a.rider) continue; const d = Math.hypot(a.x - p.x, a.y - p.y); if (d < bd && scene.reaches(p.x, p.y, a.x, a.y)) { bd = d; best = a; } }
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
    if (def.ride && mine) return { text: `${a.name} ${hearts(a.love)}${a.young ? ' (potro)' : ''}`, run: () => this.horseMenu(a) };
    if (a.ready) return { text: `${def.verb} (${a.name})`, run: () => this.collect(a) };
    const food = this.loveFood(a);
    if (food) return { text: `Darle ${ITEMS[food].name.toLowerCase()} a ${a.name} (para que tenga una cría)`, run: () => this.court(a, food) };
    const whose = a.owner && !mine ? `, de ${g.live.nameOf?.(a.owner) || 'otra persona'}` : '';
    const sit = def.pet && mine ? { text: a.sit ? 'Que se levante' : 'Que se siente', run: () => this.toggleSit(a) } : null;   // (el perro y el gato propios)
    if (a.petDay !== this.today) return { text: `Acariciar a ${a.name}${whose}`, run: () => this.pet(a), alt: sit };
    const state = def.pet || def.ride ? (a.sit ? ' (sentado)' : '') : ` (${a.young ? 'cría · ' : ''}${a.fedDay === this.today ? 'ha comido' : 'tiene hambre'}${a.expecting !== undefined && a.expecting !== null ? ' · espera una cría' : ''})`;
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
    if (a.petDay !== this.today) { a.petDay = this.today; a.love = Math.min(10, a.love + 1); this.game.skills?.gain('granja', 1); }
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
  }

  // ---------- el caballo ----------
  // El silbato: si no tienes caballo aún, lo eliges; si está cerca, montas; si no, viene; montado, bajas
  whistle(p) {
    const horse = this.myHorse();
    if (p.mount) return { tile: null, ok: true, label: 'Bajar del caballo', use: () => this.dismount() };
    if (!horse) return { tile: null, ok: true, label: 'Tocar el silbato', use: () => this.newHorse() };
    if (Math.hypot(horse.x - p.x, horse.y - p.y) < 2.6 && !horse.rider) return { tile: null, ok: true, label: `Montar a ${horse.name}`, use: () => this.mount(horse) };
    return { tile: null, ok: true, label: `Llamar a ${horse.name}`, use: () => this.callHorse(horse) };
  }
  myHorse() {
    const list = this.mine('caballo').filter(a => !this.young(a));
    return list.find(a => a.id === this.game.player?.horseId) || list.sort((a, b) => b.love - a.love)[0];
  }
  async newHorse() {
    const g = this.game, p = g.player, B = ANIMALS.caballo.breeds;
    g.busy = true;
    const i = await hud.ask('Tu caballo', 'Con este silbato tienes un caballo. ¿De qué pelaje es?', B.map(b => BREED_NAMES[b][0].toUpperCase() + BREED_NAMES[b].slice(1)));
    const name = (await hud.askText('Tu caballo', '¿Cómo se llama?', this.freeName('caballo')) || '').trim().slice(0, 18) || this.freeName('caballo');
    g.busy = false;
    const home = this.homes('cuadra').find(h => h.free > 0);
    const a = new Animal({ type: 'caballo', name, owner: me(), breed: B[i] || B[0], home: home?.tile || null, x: p.x + 1.2, y: p.y + 0.4, born: this.today - 7, at: [+(p.x + 1.2).toFixed(2), +(p.y + 0.4).toFixed(2)] });
    this.animals.push(a);
    Audio.neigh();
    hud.toast(home ? `${name} vive en tu cuadra. Úsalo con el silbato: cepíllalo y dale zanahorias y correrá más.` : `${name} ya es tuyo. Hazle una cuadra en el banco para que tenga dónde dormir.`, 'good');
  }
  mount(a) {
    const p = this.game.player;
    a.rider = me(); a.calling = false;
    Object.assign(p, { mount: true, horseId: a.id, horseCoat: a.breed, horseBags: !!a.bags, x: a.x, y: a.y });
    this.game.gather.cooldown = 0.4;
    Audio.neigh();
  }
  dismount() {
    const p = this.game.player, a = this.animals.find(x => x.id === p.horseId) || this.myHorse();
    p.mount = false;
    this.game.gather.cooldown = 0.4;
    Audio.door();
    if (!a) return;
    a.rider = null;
    a.x = a.tx = p.x + p.face.y * 0.9; a.y = a.ty = p.y - p.face.x * 0.9;   // (a un lado)
    a.at = [+a.x.toFixed(2), +a.y.toFixed(2)];
    a.wait = 4;
  }
  callHorse(a) {
    a.call = (a.call || 0) + 1;
    if (!this.game.live.guest) a.calling = true;
    this.game.gather.float(`¡Fiuuu! ${a.name} viene al galope`, '#fff3c0');
    Audio.whistle();
  }
  // Cuánto corre montado: más cuanto más te quiere, y con herraduras
  rideSpeed() {
    const a = this.animals.find(x => x.id === this.game.player?.horseId);
    return a ? 1.6 + a.love * 0.035 + (a.shod ? 0.15 : 0) : 1.8;
  }
  async horseMenu(a) {
    const g = this.game, inv = g.inv, opts = [];
    if (!this.young(a)) opts.push(['Montar', () => this.mount(a)]);
    if (inv.count('cepillo') && a.brushDay !== this.today) opts.push(['Cepillarlo', () => { a.brushDay = this.today; this.bond(a, 'Le encanta que lo cepilles'); }]);
    if (inv.count('zanahoria') && a.carrotDay !== this.today) opts.push(['Darle una zanahoria', () => { inv.remove('zanahoria', 1); a.carrotDay = this.today; this.bond(a, '¡Ñam!'); }]);
    if (inv.count('herraduras') && !a.shod) opts.push(['Ponerle las herraduras', () => { inv.remove('herraduras', 1); a.shod = true; Audio.clink(); g.gather.float('Ahora corre más', '#a8f07a'); }]);
    if (inv.count('alforjas') && !a.bags) opts.push(['Ponerle las alforjas', () => { inv.remove('alforjas', 1); a.bags = Array(9).fill(null); Audio.place(); }]);
    if (a.bags) opts.push(['Abrir las alforjas', () => g.onChest?.(() => a.bags, null, () => this.bagsChanged(a))]);
    opts.push(['Nada', () => this.pet(a)]);
    g.busy = true;
    const bits = [a.shod ? 'con herraduras' : 'sin herraduras', a.bags ? 'con alforjas' : 'sin alforjas', `vínculo ${a.love}/10`];
    const i = await hud.ask(a.name, `${a.name} (${BREED_NAMES[a.breed]}, ${bits.join(', ')}). ¿Qué quieres hacer?`, opts.map(o => o[0]));
    g.busy = false;
    opts[i]?.[1]();
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
    const g = this.game, mail = this.farm.mail.filter(m => m.to === me()), held = g.inv.held;
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
    this.farm.mail = [...this.farm.mail, { to: to.id, from: g.player.name, id, n, extra: Object.keys(extra).length ? extra : undefined, day: this.today }];
    g.gather.chips(g.player.x, g.player.y, 'feather', 10);
    Audio.swish();
    hud.toast(`La paloma ha salido volando hacia ${to.name}`, 'good');
  }
  takeMail() {
    const g = this.game, mine = this.farm.mail.filter(m => m.to === me());
    this.farm.mail = this.farm.mail.filter(m => m.to !== me());
    for (const m of mine) { const left = g.inv.add(m.id, m.n, m.extra); if (left) g.gather.throwOut(m.id, left, m.extra); }
    Audio.unlock();
    hud.toast(mine.map(m => `${m.from}: ${m.n > 1 ? m.n + ' × ' : ''}${ITEMS[m.id].name.toLowerCase()}`).join(' · '), 'good');
    this.mailSeen = 0;
  }
  // Si te ha llegado algo, se avisa (una vez por cada envío nuevo)
  notifyMail() {
    const n = this.farm.mail.filter(m => m.to === me()).length;
    if (n > (this.mailSeen || 0) && this.game.player) hud.toast(`Te ha llegado una paloma con ${n} envío${n > 1 ? 's' : ''}: recógelo en un palomar`, 'good');
    this.mailSeen = n;
  }

  // ---------- el diario ----------
  journal() {
    const list = this.animals.filter(a => !a.stray), icon = a => (a.def.w ? animalSprite(a.type, 0).toDataURL() : null);
    const rows = list.map(a => {
      const age = this.young(a) ? ` · ${a.def.baby || 'cría'} de ${this.today - a.born} días` : '', who = a.owner ? ` · de ${a.owner === me() ? 'ti' : this.game.live.nameOf?.(a.owner) || 'otra persona'}` : '';
      const img = icon(a);
      return `<div class="j-fish"><span class="j-cell done">${img ? `<img alt="" src="${img}">` : `<img alt="" data-icon="${a.def.home}">`}</span><span><b>${a.name}</b><small>${a.breed === 'gallo' ? 'Gallo' : `${a.def.name}${a.breed ? ' ' + BREED_NAMES[a.breed] : ''}`}${age}${who}${a.expecting !== undefined && a.expecting !== null ? ' · espera una cría' : ''}</small></span><span class="lvl">${hearts(a.love)}</span></div>`;
    }).join('');
    const mail = this.farm.mail.filter(m => m.to === me()).length;
    return `<p class="j-note">Heno en el silo: ${this.farm.hay}${this.siloCap ? ` de ${this.siloCap}` : ' (aún no tienes silo)'}${mail ? ` · ${mail} envío${mail > 1 ? 's' : ''} esperando en el palomar` : ''}. Los animales contentos (caricias cada día) dan más y, a veces, algo especial; dos adultos muy contentos en la misma casa tienen crías.</p>` + (rows || '<p class="j-note">Aún no tienes animales: Rosa los vende en su puesto.</p>');
  }
}

// "un cordero", "una cría"…
function an(word) { return /^(cría)$/.test(word) ? `una ${word}` : `un ${word}`; }
