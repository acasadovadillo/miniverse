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
// Wounds (Plan G §3.2): an arrow knows where it hit (archery.js strike → zoneOf, the organs of anatomy.js): the chest is
// vital (×VITAL_MUL, at most VITAL_CAP), the spine kills at once, a weak arrow, the top or the rump only grazes (HIT_MUL).
// The host applies it (a guest only says which zone: hita.z) and, when a deer or a boar survives, makes it bleed
// (wildlife.js wound): heavily at HEAVY_AT of its hp or less, or after a vital or a liver hit (a graze never makes it
// heavy; a gut hit bleeds lightly but never heals). A heavy wound skips the 30 s heal; when it bleeds out, bledOut
// removes it like a kill, the host places its carcass where it lies (carry.placeCarcass) and whoever wounded it gets the
// rest of the reward (preydead with bled). Hitting one locks its trail for you (tracks.js lock, why 'blood').
//
// The carcass (Plan R3-3, quality.js): the host keeps how it was shot (e.shot: the arrows that hit it, a gut hit, the blows)
// and the arrows stuck in it (e.arrows: a guest's hita says st: 1 when its arrow stays in), and writes its record when it
// dies: it goes with the carcass it places, or to whoever killed it (preydead.cq; ar, the arrows, without a carcass).
//
// The hunter's code (Plan R3-4, huntcode.js): the host also says whether it was a mother with her young by her (preydead.mo)
// and whether it was a clean kill (cl: 1 one arrow in the chest or the spine; 2 one in the liver, clean if its carcass is found
// soon); whoever gets the reward weighs it (huntcode.killed). An old host says neither: only the young and the swans count.
import { ANIMALS } from './art/farm.js';
import { Audio } from './audio.js';
import { ZONE, GRAZE_DMG, organOf } from './anatomy.js';
import { qualityOn, recordOf, cleanCq, killDrops, starsOf, starText, F } from './quality.js';
import { Profile } from './accounts.js';
import { obb } from './world/fit.js';
import { distOf } from './world/planet.js';
import { roll } from './xp.js';
import { woundsOn, trailKey } from './wildlife.js';
import { scaleOf, nameKey } from './herds.js';
import { t, noun } from './i18n.js';

const HEAL_AFTER = 30000, HURT = 0.4, PANIC = 2.5, SCARED = 5;
const r2 = v => Math.round(v * 100) / 100;
const me = () => Profile.id || 'yo';
export { ZONE, GRAZE_DMG };     // (where an arrow hit: anatomy.js)
export const ARROW_MAX = 6;     // an arrow's base damage at most (archery.js MAX_DMG, a full draw): the host clamps a guest's
export const VITAL_MUL = 1.5, VITAL_CAP = 9, HEAVY_AT = 0.35;
export const HIT_MUL = { [ZONE.vital]: VITAL_MUL, [ZONE.liver]: 1.2, [ZONE.gut]: 0.8, [ZONE.leg]: 0.6 };
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
  const k = scaleOf(e), [hw, back, front, h] = BODY[e.type], d = e.worldDir?.() || e.dir || [0, 1], a = Math.atan2(d[0], d[1]), mid = (front - back) / 2 * k;
  return { ...obb(e.x + Math.sin(a) * mid, e.y + Math.cos(a) * mid, hw * k, (front + back) / 2 * k, a), y0: 0, y1: h * k * (e.lying || e.bedded ? LIE_H : 1) + (ANIMALS[e.type].swims ? 0.3 : 0) };
}
// Which zone of a wild land animal a hit point [x, height, y] is in (gy: the ground under the animal; dmg: the arrow's; dir:
// the way it flies). Without a point (an old caller), or for anything else: the body
export const zoneOf = (e, hit, gy, dmg, dir = null) => organOf(e, hit, gy, dmg, dir);

// The noun of an animal: of a herd, what it is (a hind, a calf, a sow); else its species
export function kindNoun(e) {
  const k = nameKey(e), name = ANIMALS[e.type]?.name || e.type;
  return k ? noun('wild', k) : { name, g: /a$/.test(name) ? 'f' : 'm' };
}
export const kindName = e => { const k = nameKey(e); return k ? t('wild.' + k) : ANIMALS[e.type]?.name || e.type; };

export class Hunt {
  constructor(game) { this.game = game; }
  // ¿Se le puede pegar? (los de otra persona, no)
  canHit(e, who = me()) { return !!PREY[e.type] && !e.drove && !(e.owner && e.owner !== who); }
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
    return { tile: null, ok: true, auto: true, prey: e, label: t('hunt.attack', { target: e.name || kindNoun(e) }), use: () => this.hit(e, def) };
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
  // stays: the arrow is left in it (a real one, not a creative player's)
  shot(e, dmg, zone = ZONE.body, stays = false) {
    const g = this.game, p = g.player;
    e.hurt = HURT;
    if (ANIMALS[e.type].wild) e.lockAsk = g.time;
    g.gather.chips(e.x, e.y, PREY[e.type].chips || 'dirt', 4);
    g.skills?.gain('combate', 1);
    if (g.live.guest) g.live.net?.send({ t: 'hita', id: e.id, dmg, x: r2(p.x), y: r2(p.y), far: 1, ...(zone ? { z: zone } : {}), ...(stays ? { st: 1 } : {}) }, g.live.hostConn);
    else this.damage(e, this.arrowDmg(dmg, zone, e), [p.x, p.y], null, { zone, arrow: true, stays });
  }
  // (quien lleva el mundo) An arrow's damage: the base clamped to a full draw, and the vital multiplier. With ?wounds=0, as
  // before (no clamp, no multiplier: the overall cap of 10 is hitBy's)
  // (the spine, with an arrow that is not a weak one: whatever it had left)
  arrowDmg(dmg, zone, e = null) {
    if (!woundsOn()) return dmg;
    const base = Math.min(ARROW_MAX, Math.max(0, dmg));
    if (zone === ZONE.spine && e && this.bleeds(e) && base > GRAZE_DMG) return Math.max(base, e.hp ?? 0, PREY[e.type].hp);
    return Math.min(VITAL_CAP, base * (HIT_MUL[zone] || 1));
  }
  // Can this animal bleed? (wild ones on land: deer and boar; never farm animals or pets, nor the swan on its lake)
  bleeds(e) { const A = ANIMALS[e.type]; return !!A?.wild && !A.swims && woundsOn(); }
  // (quien lleva el mundo) from: desde dónde; by: la conexión de quien ha pegado (null: tú); zone: where an arrow hit;
  // peer: the profile id of whoever hit (by a guest), for the carcass of a bled-out animal; arrow: an arrow (stays: left in it)
  damage(e, dmg, from, by, { zone = ZONE.body, peer = null, arrow = false, stays = false } = {}) {
    const g = this.game, def = PREY[e.type], bleeds = this.bleeds(e);
    const now = Date.now();   // (en tiempo de verdad, como el celo de los animales)
    // (while it bleeds it does not heal: a light wound heals HEAL_AFTER after it stops, wildlife.js; a heavy one, never)
    if (e.hp === undefined || (!(bleeds && e.bleed > 0) && now - e.hitAt > HEAL_AFTER)) { e.hp = def.hp; e.shot = null; }   // (healed, it is whole again)
    e.hp -= dmg; e.hitAt = now; e.hurt = HURT;
    if (ANIMALS[e.type].wild) {
      const s = e.shot ||= { n: 0, gut: 0, melee: 0 };
      if (arrow) { s.n++; if (zone === ZONE.gut) s.gut++; if (stays) e.arrows = Math.min(99, (e.arrows || 0) + 1); } else if (dmg > 0) s.melee++;
      e.lastZone = arrow ? zone : undefined;
    }
    this.scare(e, from);
    if (e.hp > 0) { if (bleeds) this.wound(e, zone, from, by, peer); return false; }
    const mo = ANIMALS[e.type].wild && g.wildlife.motherNow?.(e) ? 1 : 0, cl = this.cleanOf(e);
    if (ANIMALS[e.type].wild) { g.wildlife.list.splice(g.wildlife.list.indexOf(e), 1); g.wildlife.lost(e); }
    else g.ranch.remove(e);
    const cq = this.recordOf(e, cl), ar = e.arrows || 0;
    if (by === null) this.reward({ type: e.type, young: e.young, female: e.female, x: e.x, y: e.y, id: e.id, sx: e.sx, sy: e.sy, cq, ar, mo, cl });
    else g.live.net?.send({ t: 'preydead', id: e.id, type: e.type, young: !!e.young, ...(e.female ? { female: 1 } : {}), x: r2(e.x), y: r2(e.y), ...(e.sx !== undefined ? { sx: e.sx, sy: e.sy } : {}), ...(cq ? { cq } : {}), ...(ar ? { ar } : {}), ...(mo ? { mo } : {}), ...(cl ? { cl } : {}) }, by);   // (sx, sy: whose trail it was; cq, ar: its record and its arrows; mo, cl: the code: optional)
    return true;
  }
  // (host) The record of the carcass of a wild land animal, or null (quality.js)
  recordOf(e, cl = 0) { const A = ANIMALS[e.type]; if (!(A?.wild && !A.swims && qualityOn())) return null; const q = recordOf(e, this.game); if (cl) q[6] |= F.CLEAN; return q; }
  // (host) A clean kill? 1: one arrow and nothing else, in the chest or the spine; 2: one in the liver (clean if its carcass is
  // found soon: huntcode.js); 0. Deer and boar only, grown ones
  cleanOf(e) {
    const A = ANIMALS[e.type], s = e.shot;
    if (!A?.wild || A.swims || e.young || !s || s.n !== 1 || s.melee || s.gut) return 0;
    return e.lastZone === ZONE.vital || e.lastZone === ZONE.spine ? 1 : e.lastZone === ZONE.liver ? 2 : 0;
  }
  // (quien lleva el mundo) It survived the hit: it bleeds (wildlife.js runs the wound). Heavy at HEAVY_AT of its hp or after
  // a vital hit; a graze only lightly. Your own hit locks its trail for you
  wound(e, zone, from, by, peer) {
    const g = this.game, max = PREY[e.type].hp;
    e.hpMax = max;
    const heavy = zone !== ZONE.graze && (zone === ZONE.vital || zone === ZONE.liver || zone === ZONE.gut || e.hp <= max * HEAVY_AT);
    e.by = by === null ? { me: true } : { conn: by, id: peer };
    g.wildlife.wound(e, heavy ? 2 : 1, from, zone);
    if (by === null && e.lockAsk !== undefined) { e.lockAsk = undefined; g.tracks?.lock(trailKey(e), 'blood'); }
  }
  // Salir corriendo, lejos de quien pega
  scare(e, [fx, fy]) {
    const g = this.game;
    if (ANIMALS[e.type].wild) { e.scared = g.time + SCARED; e.scareAt = [fx, fy]; g.wildlife.startle(e, fx, fy); return; }   // (wildlife.js: it flees from there)
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
    const zone = msg.far && Number.isInteger(msg.z) && msg.z >= ZONE.vital && msg.z <= ZONE.spine ? msg.z : ZONE.body;
    const dmg = Math.min(10, Math.max(0, msg.dmg));
    this.damage(a, msg.far ? this.arrowDmg(dmg, zone, a) : dmg, [msg.x, msg.y], conn, { zone, peer: peer.id ?? null, arrow: !!msg.far, stays: !!msg.far && msg.st === 1 });
  }
  // (invitado) Has matado a uno: ya no está y lo que suelta es para ti (bled: it bled out of your wound; placed: the host
  // left its carcass where it lies)
  killed(msg) {
    if (!PREY[msg.type]) return;
    const R = this.game.ranch, W = this.game.wildlife, a = R.animals.find(a => a.id === msg.id);
    if (ANIMALS[msg.type].wild && !Number.isFinite(msg.sx)) { const w = W.list.find(w => w.id === msg.id); if (w) msg = { ...msg, sx: w.sx, sy: w.sy }; }   // (an old host does not say its spawn point)
    if (ANIMALS[msg.type].wild) W.list = W.list.filter(w => w.id !== msg.id);
    else if (a) R.remove(a); else R.gone.add(msg.id);
    this.reward({ ...msg, cq: qualityOn() ? cleanCq(msg.cq) : null, ar: Number.isInteger(msg.ar) ? Math.max(0, Math.min(99, msg.ar)) : 0, mo: msg.mo === 1 ? 1 : 0, cl: msg.cl === 1 || msg.cl === 2 ? msg.cl : 0 });
  }
  // Lo que suelta (la cría, solo un trozo de carne), y lo que se aprende. bled: it bled out (far from you, maybe): its
  // carcass was placed by the host (placed), or else what it leaves falls only if you are in the world and near it
  // (id, sx, sy: a wild one's trail, so following it counts: tracks.js taken; cq: the record of its carcass; ar: the arrows in
  // it, in its record if it leaves a carcass; else they fall with the rest)
  reward({ type, young, female, x, y, bled = 0, placed = 0, id, sx, sy, cq = null, ar = 0, mo = 0, cl = 0 }) {
    const g = this.game, def = PREY[type], p = g.player;
    if (ANIMALS[type].wild && id !== undefined && Number.isFinite(sx) && Number.isFinite(sy)) g.tracks?.taken(trailKey({ id, sx, sy }), !!bled);
    const here = !bled || (g.scene === g.world && p && Number.isFinite(x) && Number.isFinite(y) && distOf(p.x, p.y, x, y) < BLED_NEAR);
    if (!placed && here) {
      // (with the weight inventory, an adult deer, boar, cow, sheep, goat or pig leaves its carcass, to carry in the arms: carry.js)
      const body = !young && !!g.carry?.hunted(type, x, y, !!female, cq);
      if (!body) g.gather.spawnDrops({ x, y }, { drops: young ? [[def.drops[0][0], 1, 1]] : killDrops(female && type === 'ciervo' ? def.drops.filter(d => d[0] !== 'asta') : def.drops, cq, g.days.now) });   // (a hind has no antlers)
      if (ar && !(body && cq)) this.dropArrows(x, y, ar);
      if (cq && !young) g.gather.float(starText(starsOf(cq, g.days.now)), '#ffe08a');
      g.gather.chips(x, y, def.chips || 'dirt', 16);
    }
    if (!bled) Audio.noiseHit(180, 0.2, 0.35);
    g.skills?.gain('combate', 2);
    g.stats?.add('cazados', 1);
    g.xp?.add(roll(1, 3));
    g.nature?.harvested(type);   // (the nature book: hunted → Known; also through killed and bledOut, which come here)
    if (ANIMALS[type].wild) g.huntcode?.killed({ type, young: !!young, female: !!female, x, y, bled: !!bled, placed: !!placed || (!young && !!g.carry?.bigNow && !bled), mo, cl, cq });   // (the hunter's code: huntcode.js)
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
    W.lost(w);
    const by = w.by || null, forId = !g.live?.joined ? null : by?.me ? (Profile.id || null) : (by?.id ?? null);
    const mo = g.wildlife.motherNow?.(w) ? 1 : 0, cl = this.cleanOf(w), cq = this.recordOf(w, cl), ar = w.arrows || 0;
    const placed = !w.young && (g.carry?.bigNow || Profile.server) && !!g.carry?.placeCarcass(w.type, w.x, w.y, forId, !!w.female, cq);
    if (ar && !(placed && cq)) this.dropArrows(w.x, w.y, ar);   // (here: whoever wounded it may be far, or gone)
    const msg = { id: w.id, type: w.type, young: !!w.young, ...(w.female ? { female: 1 } : {}), x: r2(w.x), y: r2(w.y), bled: 1, placed: placed ? 1 : 0, sx: w.sx, sy: w.sy, ...(cq ? { cq } : {}), ...(mo ? { mo } : {}), ...(cl ? { cl } : {}) }, conn = by && !by.me ? this.connOf(by) : null;
    if (by?.me && !Profile.server) this.reward(msg);
    else if (conn !== null) g.live.net.send({ t: 'preydead', ...msg }, conn);
    return true;
  }
  // Arrows that were in an animal, on the ground (as things to pick up: they are not stuck in anything)
  dropArrows(x, y, n) {
    const g = this.game;
    for (let i = 0; i < n; i++) g.gather?.addDrop({ id: 'flecha', x: x + (Math.random() - 0.5) * 0.6, y: y + (Math.random() - 0.5) * 0.6, z: 4, vz: 40, t: 0, scene: g.world });
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
