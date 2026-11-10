// Modo construcción: se elige una pieza de la paleta, se apunta a una casilla (con el ratón, el dedo
// o lo que hay delante del jugador) y se pone pagando sus materiales. Quitar devuelve los materiales
// (o el mueble a la mochila). Se puede quitar de todo, también de las casas del pueblo y de las aldeas.
import { STATIONS } from './recipes.js';
import { PIECES, parsePlaced } from './pieces.js';
import { ITEMS, CHESTS } from './items.js';
import { floorSprite, wallSprite, doorSprite, hearthSprite, roofSprite, fenceSprite } from './art/build.js';
import { Audio } from './audio.js';
import { WALL_H, ROOF, outward } from './three/build3d.js';
import { CHUNK } from './world/gen.js';
import { aabb, hull, solidsOf, placeBoxes, rayHits } from './world/fit.js';
import { wallRuns } from './art/build.js';
import { yawOf, rugRect } from './art/stations.js';

const PICK_NEAR = 14;   // (se apunta a lo que haya hasta aquí: lo que está más lejos del alcance, tapa lo de detrás y dice que está lejos)
export const REACH = 7;   // casillas de distancia a las que se puede construir
export const BUILD_STATION_REACH = 16;   // a cuántas casillas puede estar la estación que pide una pieza (el banco, para lo de madera)
export const PIECE_IDS = Object.keys(PIECES).filter(id => !ITEMS[id] || PIECES[id].palette);   // (el hogar se fabrica, como un mueble; la valla, además de fabricarse, se pone aquí)

// Dibujo de una pieza para su icono en la paleta: el tejado, como casilla suelta (pirámide con alero por
// los cuatro lados); el hogar, con su chimenea
export function pieceSprite(id) {
  const p = PIECES[id];
  if (p.layer === 'floor') return floorSprite(id);
  if (p.layer === 'roof') return roofSprite(id, { nw: 0, ne: 0, se: 0, sw: 0, c: 0.5 }, { n: true, e: true, s: true, w: true }, false);
  if (p.kind === 'door') return doorSprite(true);
  if (p.kind === 'fence') return fenceSprite(id, 3);
  if (p.kind === 'gate') return fenceSprite('valla', 3);
  if (p.kind === 'hearth') return hearthSprite();
  return wallSprite(id, 3);
}

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
    this.dragLayer = null;       // al arrastrar quitando, la capa de lo primero que se quitó
    this.pickV = 0;              // (cambia al quitar algo: lo apuntado hay que volver a mirarlo)
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
    if (this.erase) { const hit = this.pick(); if (hit) { this.pointTo(hit.tile); return hit.tile; } }
    // Con ratón, la casilla que hay debajo (y, si está sobre la barra de construir, la última); con el dedo, la
    // tocada hace poco; si no, la de delante
    const mt = this.game.mouseTile();
    if (mt) { this.pointTo(mt); return mt; }
    if (this.cursor && (this.game.mouse || performance.now() - this.cursorAt < 4000)) return this.cursor;
    return [Math.floor(p.x + p.face.x), Math.floor(p.y + p.face.y)];
  }
  pointTo(tile) { this.cursor = tile; this.cursorAt = performance.now(); }
  inReach(t) { const p = this.game.player; return Math.hypot(t[0] + 0.5 - p.x, t[1] + 0.5 - p.y) <= REACH; }
  // ¿Está cerca la estación que pide la pieza? (lo de madera, el banco de carpintero; en creativo, nada). Se mira dos
  // veces por segundo: esto se pregunta en cada fotograma
  stationFor(id) {
    const need = PIECES[id]?.needs, g = this.game, p = g.player;
    if (!need || g.admin || !p) return true;
    const now = performance.now();
    if (!this.near || this.near.t < now - 500 || Math.hypot(this.near.x - p.x, this.near.y - p.y) > 1) {
      const found = new Set();
      for (const o of g.world?.placedNear?.(p.x, p.y, BUILD_STATION_REACH) || []) if (STATIONS[o.placed]) found.add(o.placed);
      this.near = { t: now, x: p.x, y: p.y, found };
    }
    return this.near.found.has(need);
  }
  affordable(id) { return this.game.admin || PIECES[id].cost.every(([m, n]) => this.game.inv.count(m) >= n); }

  // Qué pasaría en la casilla: { ok, why }
  check(t) {
    const g = this.game, sc = g.scene;
    if (this.erase) {
      const hit = this.eraseTarget(t);
      if (!hit) return { ok: false, why: 'Aquí no hay nada que quitar' };
      return this.inReach(hit.tile) ? { ok: true } : { ok: false, why: 'Demasiado lejos' };
    }
    if (!t) return { ok: false };
    if (!this.inReach(t)) return { ok: false, why: 'Demasiado lejos' };
    if (sc !== g.world) return { ok: false, why: 'Dentro de esta casa solo se ponen muebles' };
    if (!this.affordable(this.piece)) return { ok: false, why: 'Te faltan materiales' };
    if (!this.stationFor(this.piece)) return { ok: false, why: `Necesitas un ${STATIONS[PIECES[this.piece].needs].name.toLowerCase()} cerca` };
    if (!sc.canPlace(t[0], t[1], this.piece, g.player)) return { ok: false, why: PIECES[this.piece].layer === 'roof' ? 'El tejado va sobre un muro o un suelo' : 'Ahí no cabe' };
    return { ok: true };
  }

  place(t = this.target(), drag = false, at = null) {
    if (!this.on) return;
    if (this.erase) return this.removeAt(t, drag, at);
    if (!t) return;
    if (drag && this.painted === `${t}`) return;
    this.painted = `${t}`;
    const g = this.game, c = this.check(t);
    if (!c.ok) { if (!drag) { if (c.why) g.gather.float(c.why, '#ffb0a0'); Audio.error(); } return; }
    if (!g.admin) for (const [m, n] of PIECES[this.piece].cost) g.inv.remove(m, n);
    g.scene.place(t[0], t[1], this.piece);
    g.gather.chips(t[0] + 0.5, t[1] + 0.5, 'wood', 6);
    Audio.place();
    g.skills?.gain('construccion', 1);
    g.stats?.add('piezas', 1);
  }

  // En una casilla, lo que se quitaría, de arriba abajo (para cuando no se apunta): { tile, layer }. La casilla es donde
  // está guardado (una cama o una alfombra grandes ocupan más)
  removableAt(t) {
    const sc = this.game.scene;
    if (!t || !sc.at) return null;
    for (const layer of ['roof', 'hang', 'placed']) if (sc.at(layer, t[0], t[1])) return { tile: t, layer };
    const long = sc.anchorOf?.(t[0], t[1]);
    if (long) return { tile: long, layer: 'placed' };
    const rug = sc.rugAnchor?.(t[0], t[1]) || (sc.at('rug', t[0], t[1]) ? t : null);
    if (rug) return { tile: rug, layer: 'rug' };
    return sc.at('floor', t[0], t[1]) ? { tile: t, layer: 'floor' } : null;
  }
  removable(t) { return this.removableAt(t)?.layer || null; }
  // Todo lo que se puede quitar cerca, cada cosa con la caja que ocupa de verdad: { tile, layer, o, box }
  pickables() {
    const g = this.game, sc = g.scene, p = g.player, view = g.view3d.world, out = [], memo = new Map();
    const box = (x, y, hx, hy, y0, y1) => ({ ...aabb(x - hx, y - hy, x + hx, y + hy), y0, y1 });
    const add = (o, b) => out.push({ tile: o.tile, layer: o.layer, o, box: b });
    const hidden = (tx, ty, side) => !!view?.faded?.(tx, ty, side);
    const cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = sc.contentFor(cx + dx, cy + dy);
      for (const o of c.floors) if (Math.abs(o.x - p.x) < PICK_NEAR && Math.abs(o.y - p.y) < PICK_NEAR) add(o, box(o.tile[0] + 0.5, o.tile[1] + 0.5, 0.5, 0.5, -0.05, 0.05));
      for (const o of [...c.objects, ...c.flats]) {
        if (!o.placed || !o.tile || !o.layer || Math.abs(o.x - p.x) > PICK_NEAR || Math.abs(o.y - p.y) > PICK_NEAR) continue;
        const [tx, ty] = o.tile;
        if (o.layer === 'roof') {
          if (hidden(tx, ty, 'roof')) continue;   // (desde dentro no se ve)
          add(o, box(tx + 0.5, ty + 0.5, 0.5, 0.5, WALL_H, WALL_H + ROOF.thick + ROOF.level * ((sc.roofGeometry?.(tx, ty, memo)?.h.c ?? 0) + 0.5)));
        } else if (o.layer === 'rug') add(o, { ...(o.obb || aabb(o.fx[0], o.fy[0], o.fx[1], o.fy[1])), y0: 0, y1: 0.08 });
        else if (o.layer === 'hang') add(o, box(o.x, o.y, 0.45, 0.45, 0.9, 2));
        else if (o.fence) {
          const m = o.mask || 0, x0 = m & 2 ? -0.5 : -0.1, x1 = m & 1 ? 0.5 : 0.1, y0 = m & 8 ? -0.5 : -0.1, y1 = m & 4 ? 0.5 : 0.1;
          add(o, box(o.x + (x0 + x1) / 2, o.y + (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0, 0.9));
        } else if (o.door) {
          const alongX = o.door === 'x', high = o.gate ? 1 : WALL_H;
          if (!o.gate && hidden(tx, ty, outward(sc, tx, ty, alongX))) continue;
          add(o, alongX ? box(tx + 0.5, ty + 0.5, 0.5, 0.14, 0, high) : box(tx + 0.5, ty + 0.5, 0.14, 0.5, 0, high));
        } else if (PIECES[o.placed]?.kind === 'wall') {
          // (el muro que da a la cámara, desde dentro, no se ve: se apunta a lo de detrás)
          const m = o.mask ?? 0, sides = [m & 3 || !(m & 12) ? outward(sc, tx, ty, true) : null, m & 12 ? outward(sc, tx, ty, false) : null].filter(Boolean);
          if (sides.every(side => hidden(tx, ty, side))) continue;
          for (const [x0, x1, y0, y1] of wallRuns(m)) add(o, { ...aabb(o.x + x0, o.y + y0, o.x + x1, o.y + y1), y0: 0, y1: WALL_H });
        } else {
          let h = hull(solidsOf(o.model || o.placed));
          if (!isFinite(h[0])) h = [-0.45, 0, -0.45, 0.45, 0.1, 0.45];
          add(o, placeBoxes([h], o.x, o.y, o.yaw ?? yawOf(o.rot))[0]);
        }
      }
    }
    return out;
  }
  // Lo primero que corta el rayo que sale por un punto de la pantalla (at; si no, el ratón): { tile, layer, o, box }, o
  // null. Así se quita lo que se ve ahí: el tejado desde fuera, la pared aunque tenga tejado encima, y lo de dentro de casa
  pick(at) {
    const g = this.game, sc = g.scene, m = g.mouse;
    if (sc !== g.world || !g.player || (!at && !m?.in)) return null;
    if (!at && m.pickFrame === g.frameNo && m.pickV === this.pickV) return m.pick;
    const ray = g.view3d.rayAt?.(at ? at[0] : m.x, at ? at[1] : m.y);
    let best = null, near = Infinity;
    if (ray) for (const c of this.pickables()) {
      const gy = g.view3d.groundY(sc, c.box.x, c.box.y), t = rayHits(ray.o, ray.d, { ...c.box, y0: c.box.y0 + gy, y1: c.box.y1 + gy });
      if (t !== null && t < near) { near = t; best = c; }
    }
    if (!at) { m.pick = best; m.pickFrame = g.frameNo; m.pickV = this.pickV; }
    return best;
  }
  // Con ratón (o tocando la pantalla), lo que se apunta; si no hay nada, nada. Sin apuntar, lo de esa casilla
  eraseTarget(t, at) {
    const g = this.game;
    return g.scene === g.world && (at || g.mouse?.in) ? this.pick(at) : this.removableAt(t);
  }
  remove(t = this.target()) { return this.removeAt(t); }
  // Quitar: si es lo que venía puesto (de una casa del pueblo o de una aldea), igual; se apunta que ya no está. drag: al
  // arrastrar, una vez por pieza y solo de la misma capa que la primera, para que un temblor no se lleve lo de debajo
  removeAt(t, drag = false, at = null) {
    const g = this.game, sc = g.scene, hit = this.eraseTarget(t, at);
    if (!hit) { if (!drag) Audio.error(); return; }
    const { tile, layer } = hit, key = `${layer}:${tile}`;
    if (drag && (this.painted === key || (this.dragLayer && this.dragLayer !== layer))) return;
    this.painted = key; this.dragLayer = layer;
    if (!this.inReach(tile)) { if (!drag) Audio.error(); return; }
    const raw = sc.at(layer, tile[0], tile[1]);
    if (!raw) return;
    const [id, k] = parsePlaced(raw), own = !sc.ownAt || sc.ownAt(layer, tile[0], tile[1]), o = { tile, layer, placed: id, ...(layer === 'rug' ? { rug: rugRect(tile[0], tile[1], k) } : {}), ...(own ? {} : { fixed: true, build: true }) };
    if (CHESTS[id] && sc.chestAt(...tile)?.some(Boolean)) { g.gather.float(`Vacía ${CHESTS[id][1]} antes`, '#ffb0a0'); Audio.error(); return; }
    if (PIECES[id] && !ITEMS[id]) {
      if (sc.unplace(o) === false) { Audio.error(); return; }
      for (const [m, n] of PIECES[id].cost) { const left = g.inv.add(m, n); if (left) g.gather.throwOut(m, left); }
    } else if (!g.pickUp(o)) return;
    this.pickV++;
    g.gather.chips(tile[0] + 0.5, tile[1] + 0.5, 'wood', 6);
    Audio.chop();
  }
  // El borde amarillo de lo que se va a quitar
  pickHighlight() {
    if (!this.on || !this.erase) return null;
    const hit = this.pick();
    return hit && this.inReach(hit.tile) ? { kind: 'placed', o: hit.o, yaw: hit.o.yaw, box: hit.box } : null;
  }

  // Lo que se va a quitar, por su nombre
  eraseHint() {
    const sc = this.game.scene, hit = this.eraseTarget(this.target()), raw = hit && sc.at(hit.layer, hit.tile[0], hit.tile[1]), id = raw && parsePlaced(raw)[0], name = id && (PIECES[id]?.name || ITEMS[id]?.name);
    return name ? `Quitar ${name.toLowerCase()}` : 'Quitar';
  }
  hint() {
    if (!this.on) return '';
    const c = this.check(this.target());
    return this.erase ? (c.ok ? this.eraseHint() : c.why || '') : c.ok ? `Poner ${PIECES[this.piece].name.toLowerCase()}` : c.why || '';
  }

}
