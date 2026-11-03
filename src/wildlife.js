// Animales salvajes: ciervos y jabalíes en los bosques y los prados, y cisnes en los lagos. Aparecen lejos del
// jugador, pasean despacio y huyen si se acerca (o si les ladra un perro); al quedar muy lejos, se van. Nunca en
// lo construido: ni aparecen ni entran bajo un tejado o sobre un suelo, y chocan con los muros con todo su cuerpo.
// Son solo para verlos: cada jugador ve los suyos (no se comparten jugando juntos ni se guardan).
import { B } from './world/biomes.js';
import { inBounds } from './world/village.js';
import { collide } from './physics.js';

const MAX = 6, SPAWN_EVERY = 4, NEAR = [14, 26], GONE = 42;
const KINDS = {
  ciervo: { biomes: [B.FOREST, B.PINES, B.MEADOW], hours: [6, 20], speed: 0.8, flee: 5.5, fear: 7, r: 0.55 },
  jabali: { biomes: [B.FOREST, B.PINES], hours: [5, 23], speed: 0.9, flee: 4.8, fear: 4.5, r: 0.45 },
  cisne: { water: true, biomes: [B.LAKE], hours: [6, 21], speed: 0.4, flee: 1.2, fear: 4, r: 0.35 },
};

class Wild {
  constructor(type, x, y) { Object.assign(this, { type, x, y, tx: x, ty: y, wait: Math.random() * 3, vx: 0, vy: 0, scared: 0 }); }
  faceTo(dx, dy) { this.dir = [dx, dy]; }
}

export class Wildlife {
  constructor(game) { this.game = game; this.list = []; this.t = 0; }
  reset() { this.list = []; }
  get world() { return this.game.world; }

  update(dt) {
    const g = this.game, p = g.player;
    if (!p || g.scene !== this.world || p.inside) { this.list.length = 0; return; }
    this.list = this.list.filter(w => Math.hypot(w.x - p.x, w.y - p.y) < GONE && (KINDS[w.type].water || !this.built(w.x, w.y, 0)));   // (el que se haya quedado dentro de algo construido, se va)
    if ((this.t += dt) > SPAWN_EVERY && this.list.length < MAX) { this.t = 0; this.spawn(p); }
    for (const w of this.list) this.move(w, dt, p);
  }
  // Uno nuevo en un sitio que le vaya, a cierta distancia del jugador y fuera del pueblo
  spawn(p) {
    const h = this.game.days.hour, a = Math.random() * Math.PI * 2, r = NEAR[0] + Math.random() * (NEAR[1] - NEAR[0]);
    const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
    if (inBounds(x, y)) return;
    const biome = this.world.gen.biomeAt(x, y), water = !!this.world.water(x, y);
    const ok = Object.entries(KINDS).filter(([, k]) => k.biomes.includes(biome) && !!k.water === water && h >= k.hours[0] && h < k.hours[1]);
    if (!ok.length || this.world.blocked?.(x, y)) return;
    const [type] = ok[Math.floor(Math.random() * ok.length)];
    if (this.built(x, y, KINDS[type].r + 0.5)) return;   // (ni dentro de una casa ni pegado a ella)
    const at = { x, y };
    if (!KINDS[type].water) { collide(at, this.world.collidersNear(x, y), KINDS[type].r); if (Math.hypot(at.x - x, at.y - y) > 0.05) return; }
    const n = type === 'jabali' && Math.random() < 0.4 ? 2 : 1;   // (los jabalíes, a veces en pareja)
    for (let i = 0; i < n; i++) this.list.push(new Wild(type, x + i * 0.8, y + i * 0.5));
  }
  move(w, dt, p) {
    const k = KINDS[w.type], d = Math.hypot(w.x - p.x, w.y - p.y), g = this.game;
    let sp = k.speed;
    if (d < k.fear || w.scared > g.time) {   // huye, alejándose del jugador
      const ax = w.x - p.x, ay = w.y - p.y, l = Math.hypot(ax, ay) || 1;
      w.tx = w.x + (ax / l) * 6; w.ty = w.y + (ay / l) * 6; w.wait = 0; sp = k.flee;
    } else if ((w.wait -= dt) > 0) { w.vx = w.vy = 0; return; }
    const dx = w.tx - w.x, dy = w.ty - w.y, dist = Math.hypot(dx, dy);
    if (dist < 0.2) { const a = Math.random() * Math.PI * 2; w.tx = w.x + Math.cos(a) * 3; w.ty = w.y + Math.sin(a) * 3; w.wait = 2 + Math.random() * 6; w.vx = w.vy = 0; return; }
    const s = Math.min(dist, sp * dt), q = { x: w.x + (dx / dist) * s, y: w.y + (dy / dist) * s };
    if (!k.water) collide(q, this.world.collidersNear(q.x, q.y), k.r);
    if (!!this.world.water(q.x, q.y) !== !!k.water || inBounds(q.x, q.y) || this.built(q.x, q.y, k.r)) { w.tx = w.x; w.ty = w.y; w.wait = 1; return; }   // (cada uno en su medio, fuera del pueblo y de lo construido)
    w.faceTo(dx, dy);
    w.vx = (q.x - w.x) / dt; w.vy = (q.y - w.y) / dt;
    w.x = q.x; w.y = q.y;
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
  // /summon: uno donde se pide (cada jugador ve los suyos)
  summon(type, x, y) { const w = new Wild(type, x, y); this.list.push(w); return w; }
  entities(scene) { return scene === this.world ? this.list : null; }
  // El salvaje más cercano a un punto (para que el perro le ladre)
  near(x, y, r) { return this.list.find(w => w.type !== 'cisne' && Math.hypot(w.x - x, w.y - y) < r) || null; }
}
