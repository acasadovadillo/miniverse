// Modo construcción: se elige una pieza de la paleta, se apunta a una casilla (con el ratón, el dedo
// o lo que hay delante del jugador) y se pone pagando sus materiales. Quitar devuelve los materiales
// (o el mueble a la mochila). Lo fijo del pueblo y de las aldeas no se puede quitar.
import { PIECES, parsePlaced } from './pieces.js';
import { floorSprite, wallSprite, doorSprite, hearthSprite, roofSprite, fenceSprite, ROOF_AX, ROOF_AY, WALL_AX, WALL_AY } from './art/build.js';
import { PLACE_AX, PLACE_AY } from './art/stations.js';
import { Audio } from './audio.js';

export const REACH = 7;   // casillas de distancia a las que se puede construir
export const PIECE_IDS = Object.keys(PIECES);

// Sprite de una pieza tal como se ve en la paleta y en la vista previa: el tejado, como casilla suelta
// (pirámide con alero por los cuatro lados); el hogar, con su sprite de estación
// q: girado con la cámara (la vista previa); la paleta lo usa sin girar
export function pieceSprite(id, q = 0) {
  const p = PIECES[id];
  if (p.layer === 'floor') return floorSprite(id, undefined, q);
  if (p.layer === 'roof') return roofSprite(id, { nw: 0, ne: 0, se: 0, sw: 0, c: 0.5 }, { n: true, e: true, s: true, w: true }, false, q);
  if (p.kind === 'door') return doorSprite(true, undefined, false, false, q);
  if (p.kind === 'fence') return fenceSprite(id, 3, q);
  if (p.kind === 'hearth') return hearthSprite(q);
  return wallSprite(id, 3, undefined, false, q);
}
// Apoyo del sprite de una pieza: los tejados usan un lienzo más alto; los muros, las puertas y el hogar, otro también alto
const pieceAnchor = id => (PIECES[id].layer === 'roof' ? [ROOF_AX, ROOF_AY] : ['wall', 'door', 'hearth'].includes(PIECES[id].kind) ? [WALL_AX, WALL_AY] : [PLACE_AX, PLACE_AY]);

export class BuildMode {
  constructor(game) {
    this.game = game;
    this.on = false;
    this.piece = PIECE_IDS[0];
    this.erase = false;          // la "pieza" de quitar (para móvil)
    this.cursor = null;          // casilla apuntada con el ratón o el dedo, [x, y]
    this.cursorAt = 0;
    this.painted = null;         // al arrastrar, no repetir la misma casilla
    this.onChange = null;
  }
  toggle(v = !this.on) {
    const g = this.game;
    if (v && (g.mode !== 'play' || !g.player)) return false;
    this.on = v;
    this.cursor = null;
    document.body.classList.toggle('building', v);
    this.onChange?.();
    return true;
  }
  select(id) { this.erase = id === 'quitar'; if (!this.erase) this.piece = id; this.onChange?.(); }
  cycle(d) {
    const list = ['quitar', ...PIECE_IDS], cur = this.erase ? 0 : list.indexOf(this.piece);
    this.select(list[(cur + d + list.length) % list.length]);
  }

  // Casilla objetivo: la del ratón si se ha movido hace poco; si no, la de delante del jugador
  target() {
    const p = this.game.player;
    if (!p) return null;
    if (this.cursor && performance.now() - this.cursorAt < 4000) return this.cursor;
    return [Math.floor(p.x + p.face.x), Math.floor(p.y + p.face.y)];
  }
  pointTo(tile) { this.cursor = tile; this.cursorAt = performance.now(); }
  inReach(t) { const p = this.game.player; return Math.hypot(t[0] + 0.5 - p.x, t[1] + 0.5 - p.y) <= REACH; }
  affordable(id) { return this.game.admin || PIECES[id].cost.every(([m, n]) => this.game.inv.count(m) >= n); }

  // Qué pasaría en la casilla: { ok, why }
  check(t) {
    const g = this.game, sc = g.scene;
    if (!t) return { ok: false };
    if (!this.inReach(t)) return { ok: false, why: 'Demasiado lejos' };
    if (this.erase) return this.removable(t) ? { ok: true } : { ok: false, why: 'Aquí no hay nada tuyo' };
    if (sc !== g.world) return { ok: false, why: 'Dentro de esta casa solo se ponen muebles' };
    if (!this.affordable(this.piece)) return { ok: false, why: 'Te faltan materiales' };
    if (!sc.canPlace(t[0], t[1], this.piece, g.player)) return { ok: false, why: PIECES[this.piece].layer === 'roof' ? 'El tejado va sobre un muro o un suelo' : 'Ahí no cabe' };
    return { ok: true };
  }

  place(t = this.target(), drag = false) {
    if (!this.on || !t) return;
    if (drag && this.painted === `${t}`) return;
    this.painted = `${t}`;
    if (this.erase) return this.remove(t);
    const g = this.game, c = this.check(t);
    if (!c.ok) { if (!drag) { if (c.why) g.gather.float(c.why, '#ffb0a0'); Audio.error(); } return; }
    if (!g.admin) for (const [m, n] of PIECES[this.piece].cost) g.inv.remove(m, n);
    g.scene.place(t[0], t[1], this.piece);
    g.gather.chips(t[0] + 0.5, t[1] + 0.5, 'wood', 6);
    Audio.place();
    g.skills?.gain('construccion', 1);
    g.stats?.add('piezas', 1);
  }

  // Lo que ha puesto el jugador en una capa de una casilla (lo fijo del pueblo no cuenta)
  ownAt(layer, t) { const sc = this.game.scene; return sc.ownAt ? sc.ownAt(layer, t[0], t[1]) : sc.at(layer, t[0], t[1]); }
  // Lo que se puede quitar en una casilla, de arriba abajo: tejado, objeto y suelo
  removable(t) {
    for (const layer of ['roof', 'placed', 'floor']) if (this.ownAt(layer, t)) return layer;
    return null;
  }
  remove(t = this.target()) {
    const g = this.game, sc = g.scene, layer = this.removable(t);
    if (!layer || !this.inReach(t)) { Audio.error(); return; }
    const [id] = parsePlaced(this.ownAt(layer, t)), o = { tile: t, layer, placed: id };
    if (id === 'cofre' && sc.chestAt(...t)?.some(Boolean)) { g.gather.float('Vacía el cofre antes', '#ffb0a0'); Audio.error(); return; }
    if (PIECES[id]) {
      if (sc.unplace(o) === false) { Audio.error(); return; }   // lo fijo no se quita ni devuelve materiales
      for (const [m, n] of PIECES[id].cost) { const left = g.inv.add(m, n); if (left) g.gather.throwOut(m, left); }
    } else if (!g.pickUp(o)) return;
    g.gather.chips(t[0] + 0.5, t[1] + 0.5, 'wood', 6);
    Audio.chop();
  }

  hint() {
    if (!this.on) return '';
    const c = this.check(this.target());
    return this.erase ? (c.ok ? 'Quitar' : c.why || '') : c.ok ? `Poner ${PIECES[this.piece].name.toLowerCase()}` : c.why || '';
  }

}
