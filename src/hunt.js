// Cazar y sacrificar. Los animales de granja y los salvajes tienen vida y un cuerpo (BODY, medido de sus modelos 3D, que
// gira con ellos): con el cursor encima, a 2 casillas o menos, cada clic les pega con lo que se lleve en la mano. Al
// recibir un golpe huyen y parpadean; si pasa un rato sin que les peguen, se recuperan. Al morir sueltan carne, piel y
// lo propio de su especie (PREY); las crías, solo un trozo de carne. El perro, el gato y el caballo no se pueden matar
// (son compañeros que andan siempre bajo el cursor), ni los animales que llevan el nombre de otra persona.
//
// Jugando juntos, los animales (los de granja y los salvajes) los lleva quien lleva el mundo: los demás le dicen a
// quién pegan y él les dice si lo han matado (lo que suelta es para quien lo mata); la lista sin ese animal les llega
// a todos con los animales. En pantalla táctil, sin cursor, se pega al que esté delante y hace falta un arma.
import { ANIMALS } from './art/farm.js';
import { Audio } from './audio.js';
import { Profile } from './accounts.js';
import { obb } from './world/fit.js';
import { distOf } from './world/planet.js';
import { roll } from './xp.js';

const HEAL_AFTER = 30000, HURT = 0.4, PANIC = 2.5, SCARED = 5, YOUNG = 0.55;
const r2 = v => Math.round(v * 100) / 100;
const me = () => Profile.id || 'yo';

// El cuerpo de cada uno (en su modelo, mirando hacia z+): medio ancho, hacia atrás, hacia delante y altura
const BODY = {
  gallina: [0.2, 0.28, 0.26, 0.67], pato: [0.2, 0.32, 0.37, 0.58], conejo: [0.2, 0.23, 0.23, 0.55],
  vaca: [0.34, 0.69, 1.03, 1.26], oveja: [0.36, 0.5, 0.72, 1.01], cabra: [0.22, 0.48, 0.73, 1.19], cerdo: [0.29, 0.49, 0.68, 0.73],
  caballo: [0.29, 0.79, 1.12, 1.55], perro: [0.2, 0.36, 0.46, 0.59], gato: [0.2, 0.36, 0.34, 0.61],
  ciervo: [0.24, 0.53, 0.92, 1.93], jabali: [0.27, 0.52, 0.85, 0.85], cisne: [0.22, 0.35, 0.48, 0.73],
};
// Lo que aguanta (en golpes de puño: la espada pega 3) y lo que suelta: [objeto, mínimo, máximo, probabilidad]. Lo
// primero, la carne
export const PREY = {
  gallina: { hp: 2, chips: 'feather', drops: [['carne_ave', 1, 1], ['plumas', 1, 2]] },
  pato: { hp: 3, chips: 'feather', drops: [['carne_ave', 1, 2], ['plumas', 1, 3]] },
  cisne: { hp: 5, chips: 'feather', drops: [['carne_ave', 2, 3], ['plumas', 2, 4]] },
  conejo: { hp: 3, drops: [['carne_conejo', 1, 2], ['piel', 1, 1], ['angora', 1, 1, 0.3]] },
  oveja: { hp: 8, drops: [['carne_cordero', 1, 3], ['piel', 1, 1], ['lana', 1, 3]] },
  cabra: { hp: 8, drops: [['carne_cabra', 1, 2], ['piel', 1, 1], ['hueso', 1, 1]] },
  cerdo: { hp: 10, drops: [['carne_cerdo', 2, 3], ['piel', 1, 1], ['manteca', 1, 2]] },
  vaca: { hp: 12, drops: [['carne_vaca', 2, 4], ['piel', 1, 2], ['hueso', 1, 2]] },
  ciervo: { hp: 8, drops: [['carne_venado', 2, 3], ['piel', 1, 2], ['asta', 1, 1, 0.6]] },
  jabali: { hp: 10, drops: [['carne_jabali', 2, 3], ['piel', 1, 1], ['colmillo', 1, 2]] },
};

// La caja de un animal en el mundo, girada hacia donde mira (el cisne flota: la suya llega hasta el agua)
export function bodyBox(e) {
  const k = e.young ? YOUNG : 1, [hw, back, front, h] = BODY[e.type], d = e.worldDir?.() || e.dir || [0, 1], a = Math.atan2(d[0], d[1]), mid = (front - back) / 2 * k;
  return { ...obb(e.x + Math.sin(a) * mid, e.y + Math.cos(a) * mid, hw * k, (front + back) / 2 * k, a), y0: 0, y1: h * k + (ANIMALS[e.type].swims ? 0.3 : 0) };
}

export class Hunt {
  constructor(game) { this.game = game; }
  // ¿Se le puede pegar? (los de otra persona, no)
  canHit(e, who = me()) { return !!PREY[e.type] && !(e.owner && e.owner !== who); }
  // A quién se le pegaría ahora: al que está bajo el cursor (o, sin ratón y con un arma, al que está delante)
  prey(p, def) {
    const g = this.game;
    if (g.scene !== g.world) return null;
    if (g.mouse) { const aim = g.aimed(); return (aim?.kind === 'animal' || aim?.kind === 'wild') && this.canHit(aim.e) ? aim.e : null; }
    if (!def?.weapon) return null;
    let best = null, bd = 1.8;
    for (const e of [...g.ranch.animals, ...g.wildlife.list]) {
      if (e.inside || e.rider || !this.canHit(e)) continue;
      const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy);
      if (d < bd && (dx * p.face.x + dy * p.face.y) / (d || 1) > 0.2 && g.world.reaches(p.x, p.y, e.x, e.y)) { bd = d; best = e; }
    }
    return best;
  }
  target(p, held, def) {
    if (def?.food || def?.heal || def?.buff) return null;   // (con comida en la mano, el clic es para comer)
    const e = this.prey(p, def);
    if (!e) return null;
    return { tile: null, ok: true, auto: true, prey: e, label: `Atacar a ${e.name || `${/a$/.test(ANIMALS[e.type].name) ? 'la' : 'el'} ${ANIMALS[e.type].name.toLowerCase()}`}`, use: () => this.hit(e, def) };
  }
  // Un golpe (lo da tu juego): si el mundo lo lleva otro, se lo pide
  hit(e, def) {
    const g = this.game, c = g.combat, p = g.player;
    c.swing();
    const dmg = c.blow(def);
    e.hurt = HURT;
    g.gather.chips(e.x, e.y, PREY[e.type].chips || 'dirt', 4);
    if (g.live.guest) { g.live.net?.send({ t: 'hita', id: e.id, dmg, x: r2(p.x), y: r2(p.y) }, g.live.hostConn); return; }
    this.damage(e, dmg, [p.x, p.y], null);
  }
  // (quien lleva el mundo) from: desde dónde; by: la conexión de quien ha pegado (null: tú)
  damage(e, dmg, from, by) {
    const g = this.game, def = PREY[e.type];
    const now = Date.now();   // (en tiempo de verdad, como el celo de los animales)
    if (e.hp === undefined || now - e.hitAt > HEAL_AFTER) e.hp = def.hp;
    e.hp -= dmg; e.hitAt = now; e.hurt = HURT;
    this.scare(e, from);
    if (e.hp > 0) return false;
    if (ANIMALS[e.type].wild) g.wildlife.list.splice(g.wildlife.list.indexOf(e), 1);
    else g.ranch.remove(e);
    if (by === null) this.reward(e);
    else g.live.net?.send({ t: 'preydead', id: e.id, type: e.type, young: !!e.young, x: r2(e.x), y: r2(e.y) }, by);
    return true;
  }
  // Salir corriendo, lejos de quien pega
  scare(e, [fx, fy]) {
    const g = this.game;
    if (ANIMALS[e.type].wild) { e.scared = g.time + SCARED; return; }
    const dx = e.x - fx, dy = e.y - fy, d = Math.hypot(dx, dy) || 1;
    e.tx = e.x + dx / d * 6; e.ty = e.y + dy / d * 6; e.wait = 0; e.panic = g.time + PANIC;
  }
  // (quien lleva el mundo) El golpe de otro jugador: de cerca, y no a lo que es de otra persona
  hitBy(conn, peer, msg) {
    const g = this.game, a = g.ranch.animals.find(a => a.id === msg.id) || g.wildlife.list.find(w => w.id === msg.id);
    if (!a || (a.inside && !g.ranch.stall(a)) || !this.canHit(a, peer.id) || !Number.isFinite(msg.dmg)) return;
    if (peer.at && distOf(peer.at[0], peer.at[1], a.x, a.y) > 5) return;
    this.damage(a, Math.min(10, Math.max(0, msg.dmg)), [msg.x, msg.y], conn);
  }
  // (invitado) Has matado a uno: ya no está y lo que suelta es para ti
  killed(msg) {
    if (!PREY[msg.type]) return;
    const R = this.game.ranch, W = this.game.wildlife, a = R.animals.find(a => a.id === msg.id);
    if (ANIMALS[msg.type].wild) W.list = W.list.filter(w => w.id !== msg.id);
    else if (a) R.remove(a); else R.gone.add(msg.id);
    this.reward(msg);
  }
  // Lo que suelta (la cría, solo un trozo de carne), y lo que se aprende
  reward({ type, young, x, y }) {
    const g = this.game, def = PREY[type];
    g.gather.spawnDrops({ x, y }, { drops: young ? [[def.drops[0][0], 1, 1]] : def.drops });
    g.gather.chips(x, y, def.chips || 'dirt', 16);
    Audio.noiseHit(180, 0.2, 0.35);
    g.skills?.gain('combate', 2);
    g.stats?.add('cazados', 1);
    g.xp?.add(roll(1, 3));
    g.onSave?.();
  }
  update(dt) {
    const g = this.game;
    for (const e of g.ranch.animals) if (e.hurt > 0) e.hurt = Math.max(0, e.hurt - dt);
    for (const e of g.wildlife.list) if (e.hurt > 0) e.hurt = Math.max(0, e.hurt - dt);
  }
}
