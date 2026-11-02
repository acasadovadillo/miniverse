// La familia: tener hijos y que hagan vida en casa. Con los dos en casa, uno lo propone en la cama doble y el
// otro acepta (jugando juntos en directo); a los 7 días nace el bebé, si hay una cuna libre, y se le pone
// nombre. Duerme en su cuna y, 7 días después, ya es un niño: de día pasea por casa y por el jardín, de noche
// duerme en su cama de niño, y se puede hablar con él. Como mucho, dos. Se parecen a los dos (ver childLook).
// Es parte del mundo: lo lleva el juego del anfitrión y los demás lo ven igual (ver livesync.js).
import { childLook, clothesFor, dressed } from './looks.js';
import { collide } from './physics.js';
import { hud } from './ui/hud.js';
import { Audio } from './audio.js';

const WAIT = 7, GROW = 7, MAX = 2;   // días hasta que nace, días de bebé y cuántos hijos como mucho
const NIGHT = [21, 7];               // de qué hora a qué hora duermen los niños
const NAMES = { chico: ['Omar', 'Leo', 'Adam', 'Hugo', 'Yusuf', 'Mateo', 'Ilyas', 'Nico'], chica: ['Lina', 'Sara', 'Maryam', 'Alba', 'Noor', 'Inés', 'Amira', 'Vega'] };
const KID_LINES = [
  p => `¡Hola, ${p}! ¿Jugamos al escondite?`,
  () => 'Hoy he visto una mariposa enorme en el jardín. Era azul.',
  p => `${p}, ¿cuándo me haces una espada de madera?`,
  () => 'Nilo me ha enseñado a hacer nudos con cuerda. ¡Mira!',
  () => 'Tengo hambre… ¿Hay manzanas?',
  p => `Te quiero mucho, ${p}.`,
  () => 'Cuando sea mayor quiero ir más allá del bosque.',
];
const BABY_LINES = ['Duerme como un tronco.', 'Te agarra el dedo y no lo suelta.', 'Hace pompas y se ríe.', 'Bosteza enorme y vuelve a dormirse.'];
const pick = list => list[Math.floor(Math.random() * list.length)];

export class Family {
  constructor(game) {
    this.game = game;
    this.v = { kids: [], expecting: null };   // los hijos ({ id, name, sex, look, born }) y si se espera uno ({ since, looks })
    this.ents = new Map();                    // hijo → cómo se ve (dónde está, si está tumbado…)
    this.naming = null;                       // (el bebé que acaba de nacer y está esperando nombre)
  }
  get world() { return this.game.world; }
  get today() { return this.game.days.dayIndex; }
  reset(save) { this.v = structuredClone(save.family || { kids: [], expecting: null }); this.ents.clear(); this.naming = null; }
  save(out) { out.family = this.v; }
  baby(k) { return this.today - k.born < GROW; }
  // Jugando juntos en directo, como lo tiene el anfitrión (con un aviso cuando ha nacido alguien y ya tiene nombre)
  share(v) {
    const had = new Set(this.v.kids.filter(k => k.named !== false).map(k => k.id));
    this.v = structuredClone(v);
    for (const k of this.v.kids) if (k.named !== false && !had.has(k.id) && this.game.player) hud.toast(`¡Ha nacido ${k.name}!`, 'good');
    for (const id of [...this.ents.keys()]) if (!this.v.kids.some(k => k.id === id)) this.ents.delete(id);
  }

  // ---------- la casa ----------
  // Muebles de un tipo dentro de tu casa: [{ x, y, rot, tile }] (x, y: donde está de verdad, arrimado a su pared)
  furniture(id) {
    const H = this.game.houseRect(), out = [];
    for (let cy = Math.floor(H.y0 / 16); cy <= Math.floor((H.y1 - 1) / 16); cy++) for (let cx = Math.floor(H.x0 / 16); cx <= Math.floor((H.x1 - 1) / 16); cx++) {
      for (const o of this.world.contentFor(cx, cy).objects) {
        if (o.placed !== id || !o.tile) continue;
        const [tx, ty] = o.tile;
        if (tx >= H.x0 && tx < H.x1 && ty >= H.y0 && ty < H.y1) out.push({ x: o.x, y: o.y, rot: o.rot || 0, tile: o.tile });
      }
    }
    return out.sort((a, b) => a.tile[1] - b.tile[1] || a.tile[0] - b.tile[0]);
  }
  // A cada bebé, una cuna; a cada niño, una cama de niño (en orden)
  beds() {
    const cribs = this.furniture('cuna'), beds = this.furniture('cama_nino'), out = new Map();
    for (const k of this.v.kids) out.set(k.id, (this.baby(k) ? cribs : beds).shift() || null);
    return out;
  }
  inHouse(x, y) { const H = this.game.houseRect(); return x > H.x0 && x < H.x1 && y > H.y0 && y < H.y1; }

  // ---------- tener un bebé ----------
  // En la cama doble: dormir o, si se puede, proponer tener un bebé
  async bed(o) {
    const g = this.game;
    g.busy = true;
    const pickN = await hud.ask(g.player.name, '¿Qué hacemos?', ['Tumbarse un rato', 'Dormir', 'Tener un bebé', 'Nada']);
    g.busy = false;
    if (pickN === 0 && o) return g.rest.lie(o);
    if (pickN === 1) return g.sleep();
    if (pickN === 2) return this.propose();
  }
  // Lo que impide tener un bebé ahora (o null)
  why() {
    const v = this.v;
    if (v.expecting) return `Ya estáis esperando un bebé: nacerá dentro de ${Math.max(1, WAIT - (this.today - v.expecting.since))} días.`;
    if (v.kids.length >= MAX) return 'Ya tenéis dos hijos: la casa está completa.';
    const babies = v.kids.filter(k => this.baby(k)).length;
    if (this.furniture('cuna').length <= babies) return 'Hace falta una cuna libre en casa (se fabrica en el banco de carpintero).';
    return null;
  }
  async propose() {
    const g = this.game, no = this.why();
    if (no) { await hud.say(g.player.name, [no]); return; }
    const partner = g.live.partner(p => this.inHouse(p.x, p.y));
    if (!partner) { await hud.say(g.player.name, ['Para tener un bebé tenéis que estar los dos en casa.']); return; }
    hud.toast(`Esperando a ${partner.peer.name}…`);
    const answer = await g.live.propose(partner.conn);
    if (!answer?.ok) { hud.toast(answer ? `${partner.peer.name} prefiere esperar` : `${partner.peer.name} no contesta`); return; }
    if (g.live.role === 'host') this.conceive([g.player.look, answer.look]);
    this.expectingNews();
  }
  // Te lo proponen: contestar (y, si eres el anfitrión, empieza la espera)
  async asked(peer) {
    const g = this.game;
    if (!g.player || g.busy || hud.dialogOpen || this.why()) return false;
    g.busy = true;
    const yes = (await hud.ask(peer.name, `${peer.name} quiere tener un bebé contigo. ¿Aceptas?`, ['Sí, ¡qué ilusión!', 'Ahora no'])) === 0;
    g.busy = false;
    if (yes && g.live.role === 'host') this.conceive([peer.look, g.player.look]);
    if (yes) this.expectingNews();
    return yes;
  }
  conceive(looks) { this.v.expecting = { since: this.today, looks: looks.map(l => { const { wear, ...rest } = l || {}; return rest; }) }; this.game.onSave?.(); }
  expectingNews() { Audio.unlock(); hud.toast(`¡Vais a tener un bebé! Nacerá dentro de ${WAIT} días.`, 'good'); }

  // Cada mañana (en el mundo de otro, lo hace su juego): nace el bebé o deja de serlo
  onDay(day) {
    if (this.game.live.guest) return;
    const e = this.v.expecting;
    if (e && day - e.since >= WAIT) {
      const sex = Math.random() < 0.5 ? 'chico' : 'chica', used = new Set(this.v.kids.map(k => k.name));
      const name = NAMES[sex].find(n => !used.has(n)) || NAMES[sex][0];
      const kid = { id: `h${day}${Math.random().toString(36).slice(2, 6)}`, name, sex, look: childLook(e.looks[0] || {}, e.looks[1] || e.looks[0] || {}, sex), born: day, named: false };
      this.v.kids.push(kid);
      this.v.expecting = null;
      this.naming = kid.id;
      hud.toast(`¡Ha nacido ${name}! ${sex === 'chica' ? 'Es una niña' : 'Es un niño'}.`, 'good');
    }
    for (const k of this.v.kids) if (day - k.born === GROW) hud.toast(`${k.name} ya no es un bebé: necesita una cama de niño.`);
  }
  // Ponerle nombre al que acaba de nacer (en cuanto se pueda, sin interrumpir nada)
  async name(kid) {
    const g = this.game;
    g.busy = true;
    const name = await hud.askText(g.player.name, `¡Ha nacido ${kid.sex === 'chica' ? 'una niña' : 'un niño'}! ¿Cómo se llamará?`, kid.name);
    kid.name = name.slice(0, 16);
    kid.named = true;
    g.busy = false;
    hud.toast(`Bienvenido al mundo, ${kid.name}.`, 'good');
    g.onSave?.();
  }

  // ---------- en casa ----------
  update(dt) {
    const g = this.game, p = g.player;
    if (!p || g.scene !== this.world) return;
    if (this.naming && !g.busy && !hud.dialogOpen && g.mode === 'play') { const k = this.v.kids.find(k => k.id === this.naming); this.naming = null; if (k) this.name(k); }
    const beds = this.beds(), h = g.days.hour, night = h >= NIGHT[0] || h < NIGHT[1];
    for (const k of this.v.kids) {
      let e = this.ents.get(k.id);
      const baby = this.baby(k);
      if (!e || e.baby !== baby) {   // (al crecer, es otro: de bebé en la cuna a niño con su ropa)
        const [hx, hy] = g.homeSpot();
        e = { kid: true, baby, look: baby ? k.look : dressed(k.look, clothesFor(k.look)), name: k.name, x: hx, y: hy - 1, vx: 0, vy: 0, yaw: 0, h: 0, lying: false, walking: false, to: null, wait: 0, stuck: 0 };
        this.ents.set(k.id, e);
      }
      e.name = k.name;
      if (g.live.guest) { this.follow(e, dt); continue; }   // (en el mundo de otro, donde diga su juego)
      const bed = beds.get(k.id);
      if (baby) this.lie(e, bed, 0.4, 0);
      else if (night && bed) this.lie(e, bed, 0.55, 0.62);
      else this.wander(e, dt);
    }
  }
  // Tumbado en su cuna o en su cama (con la cabeza en la almohada)
  lie(e, bed, y, along) {
    Object.assign(e, { vx: 0, vy: 0, lying: true, walking: false });
    if (!bed) { const [hx, hy] = this.game.homeSpot(); Object.assign(e, { x: hx, y: hy - 1, h: 0.05, yaw: 0 }); return; }   // (un bebé sin cuna: en el suelo, junto a la puerta)
    const [dx, dy] = bed.rot ? [1, 0] : [0, 1];
    Object.assign(e, { x: bed.x + dx * along, y: bed.y + dy * along, h: y, yaw: bed.rot ? Math.PI / 2 : 0 });
  }
  // Las puertas de tu casa (el centro de su casilla)
  doors() {
    const H = this.game.houseRect(), out = [];
    for (let ty = H.y0; ty < H.y1; ty++) for (let tx = H.x0; tx < H.x1; tx++) if (this.world.pieceAt(tx, ty)?.kind === 'door') out.push([tx + 0.5, ty + 0.5]);
    return out;
  }
  // De día: pasear por casa y por el jardín, parándose de vez en cuando. Si un muro no le deja llegar, va
  // antes a la puerta más cercana (así pasa de un cuarto a otro y sale al jardín)
  wander(e, dt) {
    e.lying = false; e.h = 0;
    if (!e.walking) {
      e.vx = e.vy = 0;
      if ((e.wait -= dt) > 0) return;
      const H = this.game.houseRect(), r = (a, b) => a + Math.random() * (b - a);
      e.to = Math.random() < 0.3 ? [r(H.x0 + 1, H.x1 - 1), r(H.y1 + 0.6, H.y1 + 1.8)] : [r(H.x0 + 1.5, H.x1 - 1.5), r(H.y0 + 1.5, H.y1 - 1.5)];
      e.walking = true; e.stuck = 0; e.via = null; e.tries = 0;
    }
    if (e.stuck > 1) {
      e.stuck = 0;
      if (++e.tries > 3) { e.walking = false; e.wait = 1 + Math.random() * 3; return; }
      const doors = this.doors().filter(d => !e.via || d[0] !== e.via[0] || d[1] !== e.via[1]);
      e.via = doors.sort((a, b) => Math.hypot(a[0] - e.x, a[1] - e.y) - Math.hypot(b[0] - e.x, b[1] - e.y))[0] || null;
    }
    const goal = e.via || e.to, dx = goal[0] - e.x, dy = goal[1] - e.y, d = Math.hypot(dx, dy), sp = 1.4;
    if (d < 0.2) {
      if (e.via) { e.via = null; return; }
      e.walking = false; e.wait = 1.5 + Math.random() * 4; e.vx = e.vy = 0; return;
    }
    const q = { x: e.x + (dx / d) * sp * dt, y: e.y + (dy / d) * sp * dt };
    collide(q, this.world.collidersNear(q.x, q.y), 0.2);
    const moved = Math.hypot(q.x - e.x, q.y - e.y);
    e.stuck = moved < sp * dt * 0.3 ? e.stuck + dt : 0;
    e.vx = (q.x - e.x) / dt; e.vy = (q.y - e.y) / dt;
    e.x = q.x; e.y = q.y;
    e.yaw = Math.atan2(e.vx, e.vy);
  }
  // (invitado) hacia donde lo pone el anfitrión
  follow(e, dt) {
    if (!e.netTo) return;
    const [x, y, lying, yaw, h] = e.netTo, k = 1 - Math.exp(-dt * 10);
    if (Math.hypot(x - e.x, y - e.y) > 3) { e.x = x; e.y = y; }
    const ox = e.x, oy = e.y;
    e.x += (x - e.x) * k; e.y += (y - e.y) * k;
    e.vx = (e.x - ox) / dt; e.vy = (e.y - oy) / dt;
    Object.assign(e, { lying: !!lying, yaw, h });
  }
  entities(scene) { return scene === this.world && this.game.player ? [...this.ents.values()] : null; }

  interact(p, scene) {
    if (scene !== this.world) return null;
    for (const [id, e] of this.ents) {
      if (Math.hypot(e.x - p.x, e.y - p.y) > 1.3) continue;
      return { text: e.baby ? `Mirar a ${e.name}` : e.lying ? `${e.name} duerme` : `Hablar con ${e.name}`, run: () => this.talk(id, e) };
    }
    return null;
  }
  async talk(id, e) {
    const g = this.game, parent = (g.player.look?.sex || 'chico') === 'chica' ? 'mamá' : 'papá';
    g.busy = true;
    if (e.baby) await hud.say(e.name, [pick(BABY_LINES)]);
    else if (e.lying) await hud.say(e.name, ['Zzz… (está dormido: mejor no despertarle)']);
    else { e.wait = 3; e.vx = e.vy = 0; await hud.say(e.name, [pick(KID_LINES)(parent)]); }
    g.busy = false;
  }
  // Para mandar a los demás dónde está cada uno (lo lleva el anfitrión)
  positions() { return [...this.ents].map(([id, e]) => [id, Math.round(e.x * 100) / 100, Math.round(e.y * 100) / 100, e.lying ? 1 : 0, Math.round(e.yaw * 100) / 100, e.h || 0]); }
  place(list) { for (const [id, ...pos] of list) { const e = this.ents.get(id); if (e) e.netTo = pos; } }
}
