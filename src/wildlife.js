// Animales salvajes: ciervos y jabalíes en los bosques y los prados, y cisnes en los lagos. Aparecen lejos del
// jugador, pasean despacio y huyen si se acerca (o si les ladra un perro); al quedar muy lejos, se van. Nunca en
// lo construido: ni aparecen ni entran bajo un tejado o sobre un suelo, y chocan con los muros con todo su cuerpo.
// Se pueden cazar (hunt.js): para llegar a ellos hay que acercarse agachado o, a los más lentos, correr.
// Son los mismos para todos, como en Minecraft: jugando juntos los lleva quien lleva el mundo, que los hace aparecer
// alrededor de cada jugador, los mueve y les dice a los demás dónde están (y si pastan). No se guardan.
// Los ciervos pastan: al pararse, si tienen hierba delante, bajan la cabeza y se la comen (queda como segada, para todos;
// ver scenes.js, pasture). Pocas veces y unas pocas casillas cada uno, para que no se coman el campo. Solo la dejan
// comida en los trozos que ya tienen algo cambiado (lo que se apunta de un trozo se guarda y se manda a quien entra: un
// trozo que nadie ha tocado no se apunta por un ciervo que pasa); en los demás, bajan la cabeza igual y la hierba sigue.
import { B } from './world/biomes.js';
import { inBounds } from './world/village.js';
import { CHUNK } from './world/gen.js';
import { collide } from './physics.js';
import { wrapX, dxOf, distOf } from './world/planet.js';

const MAX = 6, SPAWN_EVERY = 4, NEAR = [14, 26], GONE = 42, CREEP = 0.3, SEND_EVERY = 0.15, RESEND = 2;
const KINDS = {
  ciervo: { biomes: [B.FOREST, B.PINES, B.MEADOW], hours: [6, 20], speed: 0.8, flee: 5.5, fear: 7, r: 0.55 },
  jabali: { biomes: [B.FOREST, B.PINES], hours: [5, 23], speed: 0.9, flee: 4.8, fear: 4.5, r: 0.45 },
  cisne: { water: true, biomes: [B.LAKE], hours: [6, 21], speed: 0.4, flee: 1.2, fear: 4, r: 0.35 },
};

// Los que pastan: hasta dónde llega el morro, cuántas casillas se comen como mucho, cada cuánto (segundos) y cuánto tardan
const GRAZE = { ciervo: { mouth: 0.75, max: 5, every: [25, 60], eat: [6, 11] } };

const r2 = v => Math.round(v * 100) / 100;
const within = ([a, b]) => a + Math.random() * (b - a);

class Wild {
  constructor(type, x, y, id) { Object.assign(this, { id, type, x, y, tx: x, ty: y, wait: Math.random() * 3, vx: 0, vy: 0, scared: 0 }); }
  faceTo(dx, dy) { this.dir = [dx, dy]; }
}

export class Wildlife {
  constructor(game) { this.game = game; this.list = []; this.t = 0; this.n = 0; this.sendT = 0; this.resend = 0; this.lastSent = ''; }
  reset() { this.list = []; this.lastSent = ''; }
  get world() { return this.game.world; }

  update(dt) {
    const g = this.game;
    if (!g.world) return;
    if (g.live.guest) { this.follow(dt); return; }   // (en el mundo de otro, donde dice su juego)
    const players = g.mobs.players(), walkers = players.filter(q => q.gm !== 'spectator');
    // (el que se queda lejos de todos, o dentro de algo construido, se va)
    this.list = this.list.filter(w => players.some(q => distOf(q.x, q.y, w.x, w.y) < GONE) && (KINDS[w.type].water || !this.built(w.x, w.y, 0)));
    if ((this.t += dt) > SPAWN_EVERY) { this.t = 0; for (const q of walkers) if (this.list.filter(w => distOf(q.x, q.y, w.x, w.y) < GONE).length < MAX) this.spawn(q, walkers); }
    for (const w of this.list) this.move(w, dt, walkers);
    if (g.live.joined && (this.sendT += dt) >= SEND_EVERY) {
      const m = this.list.map(w => [w.id, w.type, r2(w.x), r2(w.y), w.hurt > 0 ? 1 : 0, w.grazing ? 1 : 0]), s = JSON.stringify(m);
      this.resend += this.sendT; this.sendT = 0;
      if (s !== this.lastSent || this.resend >= RESEND) { this.lastSent = s; this.resend = 0; g.live.net?.send({ t: 'wild', w: m }); }   // (de vez en cuando, aunque no cambie: por quien acaba de entrar)
    }
  }
  // Uno nuevo en un sitio que le vaya, a cierta distancia de quien juega (y de los demás) y fuera del pueblo
  spawn(q, walkers) {
    const a = Math.random() * Math.PI * 2, r = NEAR[0] + Math.random() * (NEAR[1] - NEAR[0]);
    const x = wrapX(q.x + Math.cos(a) * r), y = q.y + Math.sin(a) * r, h = this.game.days.hourAt(x);
    if (inBounds(x, y) || walkers.some(o => distOf(o.x, o.y, x, y) < NEAR[0])) return;
    const biome = this.world.gen.biomeAt(x, y), water = !!this.world.water(x, y);
    const ok = Object.entries(KINDS).filter(([, k]) => k.biomes.includes(biome) && !!k.water === water && h >= k.hours[0] && h < k.hours[1]);
    if (!ok.length || this.world.blocked?.(x, y)) return;
    const [type] = ok[Math.floor(Math.random() * ok.length)];
    if (this.built(x, y, KINDS[type].r + 0.5)) return;   // (ni dentro de una casa ni pegado a ella)
    const at = { x, y };
    if (!KINDS[type].water) { collide(at, this.world.collidersNear(x, y), KINDS[type].r); if (Math.hypot(at.x - x, at.y - y) > 0.05) return; }
    const n = type === 'jabali' && Math.random() < 0.4 ? 2 : 1;   // (los jabalíes, a veces en pareja)
    for (let i = 0; i < n; i++) this.summon(type, x + i * 0.8, y + i * 0.5);
  }
  move(w, dt, walkers) {
    const k = KINDS[w.type], g = this.game;
    if (!(w.eating > 0)) w.grazing = false;   // (lo que llegó por red, si ahora los mueve este juego)
    let sp = k.speed, q = null, d = Infinity;
    for (const o of walkers) { const od = distOf(o.x, o.y, w.x, w.y); if (od < d) { d = od; q = o; } }
    if (q && (d < k.fear * (q.crouch ? CREEP : 1) || w.scared > g.time)) {   // huye, alejándose de quien tiene más cerca (agachado, se deja acercar)
      const ax = dxOf(w.x, q.x), ay = w.y - q.y, l = Math.hypot(ax, ay) || 1;
      w.tx = w.x + (ax / l) * 6; w.ty = w.y + (ay / l) * 6; w.wait = 0; sp = k.flee;
      w.eating = 0; w.grazing = false;   // (si estaba comiendo, lo deja)
    } else if (w.eating > 0) { w.vx = w.vy = 0; if ((w.eating -= dt) <= 0) this.ate(w); return; }
    else if ((w.wait -= dt) > 0) { w.vx = w.vy = 0; return; }
    const dx = w.tx - w.x, dy = w.ty - w.y, dist = Math.hypot(dx, dy);
    if (dist < 0.2) { const a = Math.random() * Math.PI * 2; w.tx = w.x + Math.cos(a) * 3; w.ty = w.y + Math.sin(a) * 3; w.wait = 2 + Math.random() * 6; w.vx = w.vy = 0; this.tryGraze(w); return; }
    const s = Math.min(dist, sp * dt), p = { x: w.x + (dx / dist) * s, y: w.y + (dy / dist) * s };
    if (!k.water) collide(p, this.world.collidersNear(p.x, p.y), k.r);
    if (!!this.world.water(p.x, p.y) !== !!k.water || inBounds(p.x, p.y) || this.built(p.x, p.y, k.r)) { w.tx = w.x; w.ty = w.y; w.wait = 1; return; }   // (cada uno en su medio, fuera del pueblo y de lo construido)
    w.faceTo(dx, dy);
    w.vx = (p.x - w.x) / dt; w.vy = (p.y - w.y) / dt;
    w.x = wrapX(p.x); w.y = p.y;
  }
  // Al pararse: si le toca comer y tiene hierba delante del morro, se pone a pastar (si no, lo vuelve a mirar en la
  // próxima parada)
  tryGraze(w) {
    const k = GRAZE[w.type], g = this.game;
    if (!k || (w.ate || 0) >= k.max || g.time < (w.grazeNext || 0)) return;
    const [dx, dy] = w.dir || [1, 0], l = Math.hypot(dx, dy) || 1, tx = Math.floor(wrapX(w.x + (dx / l) * k.mouth)), ty = Math.floor(w.y + (dy / l) * k.mouth);
    if (!this.world.pasture(tx, ty, g.days.dayIndex)) return;
    w.grazeAt = [tx, ty]; w.eating = within(k.eat); w.grazing = true;
    w.grazeNext = g.time + within(k.every);
  }
  // Se la ha comido: queda como segada (si nadie la ha segado mientras)
  ate(w) {
    const [tx, ty] = w.grazeAt, today = this.game.days.dayIndex;
    const touched = !!this.world.delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));   // (sin crearlo: ver arriba)
    if (touched && this.world.pasture(tx, ty, today)) this.world.mow(tx, ty, today);
    w.ate = (w.ate || 0) + 1;
    w.eating = 0; w.grazing = false; w.grazeAt = null;
    w.wait = 1 + Math.random() * 3;
  }
  // (invitado) Donde los tiene quien lleva el mundo: [[id, tipo, x, y, herido, pastando]]
  netList(arr) {
    const old = new Map(this.list.map(w => [w.id, w]));
    this.list = arr.filter(([, type]) => KINDS[type]).map(([id, type, x, y, hurt, grazing]) => {
      const w = old.get(id) || new Wild(type, x, y, id);
      w.netTo = [x, y]; w.grazing = !!grazing;
      if (hurt && !(w.hurt > 0)) w.hurt = 0.4;
      return w;
    });
  }
  follow(dt) {
    const k = 1 - Math.exp(-dt * 8);
    for (const w of this.list) {
      if (!w.netTo) continue;
      const dx = dxOf(w.netTo[0], w.x) * k, dy = (w.netTo[1] - w.y) * k, moving = Math.abs(dx) + Math.abs(dy) > 1e-3;
      if (moving) w.faceTo(dx, dy);
      w.vx = moving ? dx / dt : 0; w.vy = moving ? dy / dt : 0;
      w.x = wrapX(w.x + dx); w.y += dy;
    }
  }
  // ¿Hay algo construido (un tejado o un suelo) a menos de r de este punto?
  built(x, y, r) {
    const w = this.world;
    for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const tx = Math.floor(x + dx), ty = Math.floor(y + dy);
      if (w.roofAt(tx, ty) || w.at('floor', tx, ty)) return true;
    }
    return false;
  }
  // Uno nuevo (también con /summon: lo hace quien lleva el mundo)
  summon(type, x, y) { const w = new Wild(type, wrapX(x), y, `w${++this.n}`); this.list.push(w); return w; }
  entities(scene) { return scene === this.world ? this.list : null; }
  // El salvaje más cercano a un punto (para que el perro le ladre)
  near(x, y, r) { return this.list.find(w => w.type !== 'cisne' && Math.hypot(w.x - x, w.y - y) < r) || null; }
}
