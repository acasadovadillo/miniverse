// Cazar y sacrificar. Los animales de granja y los salvajes tienen vida y un cuerpo (BODY, medido de sus modelos 3D, que
// gira con ellos): con el cursor encima, a 2 casillas o menos, cada clic les pega con lo que se lleve en la mano. Al
// recibir un golpe huyen y parpadean; si pasa un rato sin que les peguen, se recuperan. Al morir sueltan carne, piel y
// lo propio de su especie (PREY); las crías, solo un trozo de carne. El perro, el gato y el caballo no se pueden matar
// (son compañeros que andan siempre bajo el cursor), ni los animales que llevan el nombre de otra persona.
//
// Jugando juntos, los animales (los de granja y los salvajes) los lleva quien lleva el mundo: los demás le dicen a
// quién pegan y él les dice si lo han matado (lo que suelta es para quien lo mata); la lista sin ese animal les llega
// a todos con los animales. En pantalla táctil, sin cursor, se pega al que esté delante y hace falta un arma.
//
// Wounds (Plan G §3.2): an arrow knows where it hit (archery.js strike → zoneOf): the chest band is vital (×VITAL_MUL,
// at most VITAL_CAP), a weak arrow, the top or the rump only grazes. The host applies it (a guest only says which zone:
// hita.z) and, when a deer or a boar survives, makes it bleed (wildlife.js wound): heavily at HEAVY_AT of its hp or less,
// or after a vital hit (a graze never makes it heavy). A heavy wound skips the 30 s heal; when it bleeds out, bledOut
// removes it like a kill, the host places its carcass where it lies (carry.placeCarcass) and whoever wounded it gets the
// rest of the reward (preydead with bled). Hitting one locks its trail for you (tracks.js lock, why 'blood').
import { ANIMALS } from './art/farm.js';
import { Audio } from './audio.js';
import { Profile } from './accounts.js';
import { obb } from './world/fit.js';
import { distOf, dxOf } from './world/planet.js';
import { roll } from './xp.js';
import { woundsOn, trailKey } from './wildlife.js';

const HEAL_AFTER = 30000, HURT = 0.4, PANIC = 2.5, SCARED = 5, YOUNG = 0.55;
const r2 = v => Math.round(v * 100) / 100;
const me = () => Profile.id || 'yo';
// Where an arrow hit (Plan G §3.2): the rest of the body, the chest band (vital) or a graze
export const ZONE = { body: 0, vital: 1, graze: 2 };
export const ARROW_MAX = 6;     // an arrow's base damage at most (archery.js MAX_DMG, a full draw): the host clamps a guest's
export const VITAL_MUL = 1.5, VITAL_CAP = 9, HEAVY_AT = 0.35, GRAZE_DMG = 2;
const LIE_H = 0.6;              // a lying animal's box is this share of its height
const BLED_NEAR = 60;           // a bled-out animal whose carcass the host could not place: its drops fall only if you are this near

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
  return { ...obb(e.x + Math.sin(a) * mid, e.y + Math.cos(a) * mid, hw * k, (front + back) / 2 * k, a), y0: 0, y1: h * k * (e.lying ? LIE_H : 1) + (ANIMALS[e.type].swims ? 0.3 : 0) };
}
// Which zone of a wild land animal a hit point [x, height, y] is in (gy: the ground under the animal; dmg: the arrow's).
// The chest band (15-45 % of the length from the front, 35-75 % of the box's height) is vital; a weak arrow (dmg ≤
// GRAZE_DMG), the top 15 % or the rear 15 % only graze. Without a point (an old caller), or for anything else: the body
export function zoneOf(e, hit, gy, dmg) {
  const A = ANIMALS[e.type];
  if (!A?.wild || A.swims || !BODY[e.type] || !Array.isArray(hit) || !hit.every(Number.isFinite)) return ZONE.body;
  if (dmg <= GRAZE_DMG) return ZONE.graze;
  const b = bodyBox(e), v = dxOf(hit[0], b.x) * b.vx + (hit[2] - b.y) * b.vy;
  const along = (b.hy - v) / (2 * b.hy || 1), up = (hit[1] - gy - b.y0) / ((b.y1 - b.y0) || 1);   // (0 at the front / the ground)
  if (up > 0.85 || along > 0.85) return ZONE.graze;
  // (lying, its box is low and the chest sits in its lower part)
  if (along >= 0.15 && along <= 0.45 && up <= 0.75 && (e.lying || up >= 0.35)) return ZONE.vital;
  return ZONE.body;
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
    if (ANIMALS[e.type].wild) e.lockAsk = g.time;   // (if it bleeds, its trail is locked for you: see damage and wildlife netList)
    g.gather.chips(e.x, e.y, PREY[e.type].chips || 'dirt', 4);
    if (g.live.guest) { g.live.net?.send({ t: 'hita', id: e.id, dmg, x: r2(p.x), y: r2(p.y) }, g.live.hostConn); return; }
    this.damage(e, dmg, [p.x, p.y], null);
  }
  // Una flecha que le da (lo decide quien la dispara). zone: where it hit (ZONE, archery.js strike)
  shot(e, dmg, zone = ZONE.body) {
    const g = this.game, p = g.player;
    e.hurt = HURT;
    if (ANIMALS[e.type].wild) e.lockAsk = g.time;
    g.gather.chips(e.x, e.y, PREY[e.type].chips || 'dirt', 4);
    g.skills?.gain('combate', 1);
    if (g.live.guest) g.live.net?.send({ t: 'hita', id: e.id, dmg, x: r2(p.x), y: r2(p.y), far: 1, ...(zone ? { z: zone } : {}) }, g.live.hostConn);
    else this.damage(e, this.arrowDmg(dmg, zone), [p.x, p.y], null, { zone });
  }
  // (quien lleva el mundo) An arrow's damage: the base clamped to a full draw, and the vital multiplier. With ?wounds=0, as
  // before (no clamp, no multiplier: the overall cap of 10 is hitBy's)
  arrowDmg(dmg, zone) {
    if (!woundsOn()) return dmg;
    const base = Math.min(ARROW_MAX, Math.max(0, dmg));
    return zone === ZONE.vital ? Math.min(VITAL_CAP, base * VITAL_MUL) : base;
  }
  // Can this animal bleed? (wild ones on land: deer and boar; never farm animals or pets, nor the swan on its lake)
  bleeds(e) { const A = ANIMALS[e.type]; return !!A?.wild && !A.swims && woundsOn(); }
  // (quien lleva el mundo) from: desde dónde; by: la conexión de quien ha pegado (null: tú); zone: where an arrow hit;
  // peer: the profile id of whoever hit (by a guest), for the carcass of a bled-out animal
  damage(e, dmg, from, by, { zone = ZONE.body, peer = null } = {}) {
    const g = this.game, def = PREY[e.type], bleeds = this.bleeds(e);
    const now = Date.now();   // (en tiempo de verdad, como el celo de los animales)
    // (while it bleeds it does not heal: a light wound heals HEAL_AFTER after it stops, wildlife.js; a heavy one, never)
    if (e.hp === undefined || (!(bleeds && e.bleed > 0) && now - e.hitAt > HEAL_AFTER)) e.hp = def.hp;
    e.hp -= dmg; e.hitAt = now; e.hurt = HURT;
    this.scare(e, from);
    if (e.hp > 0) { if (bleeds) this.wound(e, zone, from, by, peer); return false; }
    if (ANIMALS[e.type].wild) g.wildlife.list.splice(g.wildlife.list.indexOf(e), 1);
    else g.ranch.remove(e);
    if (by === null) this.reward(e);
    else g.live.net?.send({ t: 'preydead', id: e.id, type: e.type, young: !!e.young, x: r2(e.x), y: r2(e.y), ...(e.sx !== undefined ? { sx: e.sx, sy: e.sy } : {}) }, by);   // (sx, sy: whose trail it was, optional)
    return true;
  }
  // (quien lleva el mundo) It survived the hit: it bleeds (wildlife.js runs the wound). Heavy at HEAVY_AT of its hp or after
  // a vital hit; a graze only lightly. Your own hit locks its trail for you
  wound(e, zone, from, by, peer) {
    const g = this.game, max = PREY[e.type].hp;
    e.hpMax = max;
    const heavy = zone !== ZONE.graze && (zone === ZONE.vital || e.hp <= max * HEAVY_AT);
    e.by = by === null ? { me: true } : { conn: by, id: peer };
    g.wildlife.wound(e, heavy ? 2 : 1, from);
    if (by === null && e.lockAsk !== undefined) { e.lockAsk = undefined; g.tracks?.lock(trailKey(e), 'blood'); }
  }
  // Salir corriendo, lejos de quien pega
  scare(e, [fx, fy]) {
    const g = this.game;
    if (ANIMALS[e.type].wild) { e.scared = g.time + SCARED; e.scareAt = [fx, fy]; return; }   // (wildlife.js: it flees from there)
    const dx = e.x - fx, dy = e.y - fy, d = Math.hypot(dx, dy) || 1;
    e.tx = e.x + dx / d * 6; e.ty = e.y + dy / d * 6; e.wait = 0; e.panic = g.time + PANIC;
  }
  // (quien lleva el mundo) El golpe de otro jugador: de cerca, y no a lo que es de otra persona
  hitBy(conn, peer, msg) {
    const g = this.game, a = g.ranch.animals.find(a => a.id === msg.id) || g.wildlife.list.find(w => w.id === msg.id);
    if (!a || (a.inside && !g.ranch.stall(a)) || !this.canHit(a, peer.id) || !Number.isFinite(msg.dmg)) return;
    if (peer.at && distOf(peer.at[0], peer.at[1], a.x, a.y) > (msg.far ? 60 : 5)) return;   // (con una flecha, de más lejos)
    // (the zone only picks the multiplier, applied here to a clamped base: a guest cannot make a hit stronger; melee and an
    // old client's arrow are the body)
    const zone = msg.far && (msg.z === ZONE.vital || msg.z === ZONE.graze) ? msg.z : ZONE.body;
    const dmg = Math.min(10, Math.max(0, msg.dmg));
    this.damage(a, msg.far ? this.arrowDmg(dmg, zone) : dmg, [msg.x, msg.y], conn, { zone, peer: peer.id ?? null });
  }
  // (invitado) Has matado a uno: ya no está y lo que suelta es para ti (bled: it bled out of your wound; placed: the host
  // left its carcass where it lies)
  killed(msg) {
    if (!PREY[msg.type]) return;
    const R = this.game.ranch, W = this.game.wildlife, a = R.animals.find(a => a.id === msg.id);
    if (ANIMALS[msg.type].wild && !Number.isFinite(msg.sx)) { const w = W.list.find(w => w.id === msg.id); if (w) msg = { ...msg, sx: w.sx, sy: w.sy }; }   // (an old host does not say its spawn point)
    if (ANIMALS[msg.type].wild) W.list = W.list.filter(w => w.id !== msg.id);
    else if (a) R.remove(a); else R.gone.add(msg.id);
    this.reward(msg);
  }
  // Lo que suelta (la cría, solo un trozo de carne), y lo que se aprende. bled: it bled out (far from you, maybe): its
  // carcass was placed by the host (placed), or else what it leaves falls only if you are in the world and near it
  // (id, sx, sy: a wild one's trail, so following it counts: tracks.js taken)
  reward({ type, young, x, y, bled = 0, placed = 0, id, sx, sy }) {
    const g = this.game, def = PREY[type], p = g.player;
    if (ANIMALS[type].wild && id !== undefined && Number.isFinite(sx) && Number.isFinite(sy)) g.tracks?.taken(trailKey({ id, sx, sy }), !!bled);
    const here = !bled || (g.scene === g.world && p && Number.isFinite(x) && Number.isFinite(y) && distOf(p.x, p.y, x, y) < BLED_NEAR);
    if (!placed && here) {
      // (with the weight inventory, an adult deer, boar, cow, sheep, goat or pig leaves its carcass, to carry in the arms: carry.js)
      if (young || !g.carry?.hunted(type, x, y)) g.gather.spawnDrops({ x, y }, { drops: young ? [[def.drops[0][0], 1, 1]] : def.drops });
      g.gather.chips(x, y, def.chips || 'dirt', 16);
    }
    if (!bled) Audio.noiseHit(180, 0.2, 0.35);
    g.skills?.gain('combate', 2);
    g.stats?.add('cazados', 1);
    g.xp?.add(roll(1, 3));
    g.nature?.harvested(type);   // (the nature book: hunted → Known; also through killed and bledOut, which come here)
    g.onSave?.();
  }
  // (host) A heavily wounded wild animal died of its wound: removed like a kill; the host places its carcass where it lies
  // (wherever the host is: in a cave, or the world server with no player), reserved for whoever wounded it for the first
  // seconds as every kill; that player gets the rest of the reward (here, or by preydead with bled). If they have gone,
  // nobody gets it and the carcass is there for whoever finds it. Without the weight inventory, the host leaves nothing
  // (the world server always places it: each guest takes a carcass with the inventory it has). false: it was not there
  bledOut(w) {
    const g = this.game, W = g.wildlife, i = W.list.indexOf(w);
    if (i < 0 || !PREY[w.type]) return false;
    W.list.splice(i, 1);
    const by = w.by || null, forId = !g.live?.joined ? null : by?.me ? (Profile.id || null) : (by?.id ?? null);
    const placed = !w.young && (g.carry?.bigNow || Profile.server) && !!g.carry?.placeCarcass(w.type, w.x, w.y, forId);
    const msg = { id: w.id, type: w.type, young: !!w.young, x: r2(w.x), y: r2(w.y), bled: 1, placed: placed ? 1 : 0, sx: w.sx, sy: w.sy }, conn = by && !by.me ? this.connOf(by) : null;
    if (by?.me && !Profile.server) this.reward(msg);
    else if (conn !== null) g.live.net.send({ t: 'preydead', ...msg }, conn);
    return true;
  }
  // The connection now of a guest ({ conn, id } of who hit): if theirs dropped and came back, the one with their profile id.
  // null: not here
  connOf(by) {
    const L = this.game.live, peers = L.net?.peers;
    if (by.conn !== undefined && by.conn !== null && peers?.has(by.conn)) return by.conn;
    if (by.id != null && L.net) for (const [conn, peer] of L.peers) if (peer.id === by.id && peer.playing) return conn;
    return null;
  }
  update(dt) {
    const g = this.game;
    for (const e of g.ranch.animals) if (e.hurt > 0) e.hurt = Math.max(0, e.hurt - dt);
    for (const e of g.wildlife.list) if (e.hurt > 0) e.hurt = Math.max(0, e.hurt - dt);
  }
}
