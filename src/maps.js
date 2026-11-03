// Mapas y brújula, como objetos. Un mapa en blanco, al usarlo, pasa a ser el mapa de la zona donde estás: un cuadro
// de 128 × 128 casillas encajado en la cuadrícula del planeta, que se va dibujando (por trozos) mientras lo llevas
// encima dentro de su zona. Con él en la mano se ve, con el norte arriba, dónde estás tú, los demás y tu casa. En el
// banco se copia (con otro en blanco: las copias son el mismo mapa, y lo que dibuja una lo ven todas) y se amplía
// (con telas: cubre el doble, hasta 512 × 512). Lo dibujado es del mundo: jugando juntos, lo ven todos. La brújula,
// en la mano, apunta a tu cama o, si no tienes, a tu casa, por el camino más corto alrededor del planeta.
import { ITEMS } from './items.js';
import { CHUNK } from './world/gen.js';
import { HOUSE } from './world/village.js';
import { wrapX, dxOf, wrapIndex, inPlanet } from './world/planet.js';
import { screenToWorld } from './camera.js';
import { Profile } from './accounts.js';
import { Audio } from './audio.js';

const SIDE = 128, MAX_SCALE = 2;   // lo que mide un mapa recién hecho (en casillas) y cuántas veces se puede ampliar
const REVEAL = 2;                  // trozos alrededor de ti que se dibujan
const ENLARGE = [['tela', 4]];     // lo que cuesta ampliar un mapa
const $ = id => document.getElementById(id);
const sideOf = s => SIDE << s;
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// Lo dibujado de un mapa: un bit por trozo, en hexadecimal
const getBit = (hex, i) => (parseInt(hex[i >> 2] || '0', 16) >> (i & 3)) & 1;
function setBit(hex, i) { const k = i >> 2, v = parseInt(hex[k], 16) | (1 << (i & 3)); return hex.slice(0, k) + v.toString(16) + hex.slice(k + 1); }

export class Maps {
  constructor(game) {
    this.game = game;
    this.data = {};   // mapas del mundo: id → { x0, y0, s, seen }
    this.t = 0;
  }
  reset(save) { this.data = save.maps || {}; }
  save(out) { out.maps = this.data; }

  // ---------- hacerlos ----------
  // Usar un mapa en blanco (en la casilla i): pasa a ser el de la zona donde estás
  create(i) {
    const g = this.game, p = g.player, inv = g.inv;
    if (g.scene !== g.world) { g.gather.float('Aquí no se puede dibujar un mapa', '#ffb0a0'); Audio.error(); return; }
    const side = sideOf(0), x0 = Math.floor(wrapX(p.x) / side) * side, y0 = Math.floor(p.y / side) * side, id = newId();
    this.data = { ...this.data, [id]: { x0, y0, s: 0, seen: '0'.repeat((side / CHUNK) ** 2 / 4) } };
    inv.take(i, 1, true);
    const left = inv.add('mapa', 1, { map: id });
    if (left) g.gather.throwOut('mapa', left, { map: id });
    this.reveal();
    g.gather.float('¡Mapa de esta zona! Llévalo en la mano para verlo', '#fff3c0');
    Audio.craft();
    g.onSave?.();
  }
  // En el banco: una copia (con otro mapa en blanco) o el mismo mapa, el doble de grande (con telas)
  copy(i) {
    const g = this.game, inv = g.inv, it = inv.slots[i];
    if (!it?.map) return 'Ese no es un mapa';
    if (!inv.infinite && inv.count('mapa_vacio') < 1) return 'Te falta un mapa en blanco';
    inv.remove('mapa_vacio', 1);
    const left = inv.add('mapa', 1, { map: it.map });
    if (left) g.gather.throwOut('mapa', left, { map: it.map });
    Audio.craft();
    return null;
  }
  enlarge(i) {
    const g = this.game, inv = g.inv, it = inv.slots[i], m = it?.map && this.data[it.map];
    if (!m) return 'Ese no es un mapa';
    if (m.s >= MAX_SCALE) return 'Ya es lo más grande que puede ser';
    const miss = !inv.infinite && ENLARGE.find(([id, n]) => inv.count(id) < n);
    if (miss) return `Te falta ${ITEMS[miss[0]].name.toLowerCase()}`;
    for (const [id, n] of ENLARGE) inv.remove(id, n);
    // (el nuevo, de la cuadrícula de su tamaño; lo dibujado en el viejo sigue dibujado)
    const s = m.s + 1, side = sideOf(s), x0 = Math.floor(m.x0 / side) * side, y0 = Math.floor(m.y0 / side) * side, id = newId();
    let seen = '0'.repeat((side / CHUNK) ** 2 / 4);
    const n0 = sideOf(m.s) / CHUNK, n = side / CHUNK, ox = (m.x0 - x0) / CHUNK, oy = (m.y0 - y0) / CHUNK;
    for (let j = 0; j < n0; j++) for (let k = 0; k < n0; k++) if (getBit(m.seen, j * n0 + k)) seen = setBit(seen, (j + oy) * n + k + ox);
    this.data = { ...this.data, [id]: { x0, y0, s, seen } };
    it.map = id;
    inv.changed();
    Audio.craft();
    return null;
  }
  // Para el banco: los mapas que llevas, con lo que se puede hacer con cada uno
  carried() {
    return this.game.inv.slots.map((it, i) => ({ i, it, m: it?.id === 'mapa' && this.data[it.map] })).filter(o => o.m);
  }
  label(m) { const side = sideOf(m.s); return `${side} × ${side} casillas`; }

  // ---------- dibujarlos ----------
  // Lo de alrededor, en los mapas que llevas encima y cubren donde estás
  reveal() {
    const g = this.game, p = g.player;
    if (!p || g.scene !== g.world) return;
    let changed = false;
    const next = { ...this.data };
    for (const it of g.inv.slots) {
      const m = it?.id === 'mapa' && next[it.map];
      if (!m) continue;
      const side = sideOf(m.s), n = side / CHUNK, ci = Math.floor(wrapX(p.x - m.x0) / CHUNK), cj = Math.floor((p.y - m.y0) / CHUNK);
      if (ci < -REVEAL || cj < -REVEAL || ci >= n + REVEAL || cj >= n + REVEAL) continue;
      let seen = m.seen;
      for (let dj = -REVEAL; dj <= REVEAL; dj++) for (let di = -REVEAL; di <= REVEAL; di++) {
        const a = ci + di, b = cj + dj;
        if (a >= 0 && b >= 0 && a < n && b < n && !getBit(seen, b * n + a)) seen = setBit(seen, b * n + a);
      }
      if (seen !== m.seen) { next[it.map] = { ...m, seen }; changed = true; }
    }
    if (changed) this.data = next;
  }

  update(dt) {
    if (Profile.server) return;
    if ((this.t += dt) < 0.5) return;
    this.t = 0;
    this.reveal();
    this.paint();
  }
  // Lo que se tiene en la mano: el mapa (se ve) o la brújula (su aguja)
  paint() {
    const g = this.game, held = g.inv.held, m = held?.id === 'mapa' && this.data[held.map], show = !!m && g.mode === 'play' && g.scene === g.world;
    const c = $('held-map');
    if (c) { c.hidden = !show; if (show) this.drawMap(c, m); }
    const k = $('compass'), on = held?.id === 'brujula' && g.mode === 'play' && g.scene === g.world;
    if (k) { k.hidden = !on; if (on) this.drawNeedle(k); }
  }
  drawMap(c, m) {
    const g = this.game, p = g.player, side = sideOf(m.s), n = side / CHUNK;
    if (c.width !== side) c.width = c.height = side;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#e8d8b0'; ctx.fillRect(0, 0, side, side);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (!getBit(m.seen, j * n + i)) continue;
      const key = `${wrapIndex(m.x0 / CHUNK + i, CHUNK)},${m.y0 / CHUNK + j}`, t = g.map.thumb(g.world.gen, key);
      if (t) ctx.drawImage(t, i * CHUNK, j * CHUNK);
    }
    // Tu casa, los demás y tú (con el norte arriba); lo que cae fuera, en el borde
    const dot = (x, y, col, r = 3) => {
      const u = Math.max(r, Math.min(side - r, dxOf(x, m.x0 + side / 2) + side / 2)), v = Math.max(r, Math.min(side - r, y - m.y0));
      ctx.fillStyle = '#2a1c22'; ctx.fillRect(u - r - 1, v - r - 1, r * 2 + 2, r * 2 + 2);
      ctx.fillStyle = col; ctx.fillRect(u - r, v - r, r * 2, r * 2);
    };
    dot((HOUSE.x0 + HOUSE.x1) / 2, (HOUSE.y0 + HOUSE.y1) / 2, '#c95a3c', 2 + m.s);
    if (g.live.joined) for (const peer of g.live.others) if (peer.playing && !peer.server && peer.entity && peer.sc === 'world') dot(peer.entity.x, peer.entity.y, '#4a8ad8', 2 + m.s);
    dot(p.x, p.y, Math.sin(g.time * 6) > 0 ? '#ffd77a' : '#ff4a3a', 2 + m.s);
  }
  // Adónde apunta la brújula: tu cama (o el punto donde reapareces) o, si no, la puerta de tu casa
  target() { const s = this.game.player.spawn; return s ? [s[0], s[1]] : this.game.homeSpot(); }
  drawNeedle(el) {
    const p = this.game.player, [tx, ty] = this.target(), dx = dxOf(tx, p.x), dy = ty - p.y;
    // (de la dirección en el mundo a la de la pantalla, con el giro de la cámara: al revés que screenToWorld)
    const [ax, ay] = screenToWorld(1, 0), [bx, by] = screenToWorld(0, 1), sx = dx * ax + dy * ay, sy = dx * bx + dy * by;
    el.firstChild.style.transform = `rotate(${Math.atan2(sy, sx) + Math.PI / 2}rad)`;
    el.title = `La brújula apunta a ${p.spawn ? 'tu cama' : 'tu casa'} · ${Math.round(Math.hypot(dx, dy))} pasos`;
  }
  hint() {
    const g = this.game, p = g.player;
    if (g.inv.held?.id !== 'brujula' || g.scene !== g.world || !inPlanet(p.x, p.y)) return '';
    const [tx, ty] = this.target(), d = Math.round(Math.hypot(dxOf(tx, p.x), ty - p.y));
    return d < 4 ? `Ya estás en ${p.spawn ? 'tu cama' : 'casa'}` : `La brújula apunta a ${p.spawn ? 'tu cama' : 'tu casa'} · ${d} pasos`;
  }
}
