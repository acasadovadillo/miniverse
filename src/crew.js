// La barca ya no es un objeto que se lleva en la mano: se construye (B, pestaña Exterior) en el agua, junto a la
// orilla, y queda amarrada (world.moorBoat). Con E se sube uno a la que tenga cerca, y rema; con E otra vez, junto a
// tierra, se baja y la barca se queda amarrada allí. Apuntándola, X la desmonta y devuelve sus materiales.
// La barca es para dos: quien está cerca de la barca de otro jugador puede subirse (E). El pasajero va sentado en el
// banco de atrás, sin remar: su sitio lo da la barca (cada juego lo calcula con lo que ve, para que no se quede
// atrás con el retraso de la red) y baja con E si hay tierra cerca. Si quien rema baja a tierra, baja con él; si se
// va del mundo en mitad del agua, la barca se queda para el pasajero.
import { nearX } from './world/planet.js';
import { Profile } from './accounts.js';
import { hud } from './ui/hud.js';
import { Audio } from './audio.js';
import { BUILDABLE } from './buildables.js';

const REACH = 2.6, BEHIND = 0.7;   // desde dónde se sube y a qué distancia del que rema se va sentado

export class Crew {
  constructor(game) { this.game = game; this.mate = null; }
  get p() { return this.game.player; }
  reset() { if (this.p) this.p.aboard = null; this.mate = null; }
  // El jugador que lleva la barca, por su id (null si ya no está en el mundo)
  driver(id) {
    const g = this.game;
    if (id === Profile.id) return g.player;
    for (const peer of g.live.others) if (peer.id === id && peer.sc === 'world' && peer.entity) return peer.entity;
    return null;
  }
  // Hacia dónde apunta la barca que se ve (gira poco a poco: se usa ese giro, y así el pasajero va siempre en su banco)
  turn(d) {
    const m = this.game.view3d?.actors.models.get(d);
    return m?.person ? m.person.root.rotation.y : d.remote ? d.yaw ?? 0 : Math.atan2(d.face.x, d.face.y);
  }
  seat(e, d) {
    const a = this.turn(d), sx = Math.sin(a), sy = Math.cos(a);
    e.x = nearX(d.x, e.x) - sx * BEHIND; e.y = d.y - sy * BEHIND;
    if (e.remote) { e.yaw = a; e.to = [e.x, e.y, 0]; }
    else { e.faceTo(sx, sy); e.face = { x: sx, y: sy }; }
  }
  update() {
    const g = this.game, p = this.p;
    if (!p || !g.live.joined) { if (p?.aboard) this.leave(); return; }
    let mate = null;
    for (const peer of g.live.others) {
      const e = peer.entity;
      if (!e?.aboard) continue;
      if (e.aboard === Profile.id) mate = peer.name;
      const d = this.driver(e.aboard);
      if (d?.boat) this.seat(e, d);
    }
    if (mate !== this.mate) { if (mate) { hud.toast(`${mate} se sube a tu barca`); Audio.door(); } this.mate = mate; }
    if (!p.aboard) return;
    const d = this.driver(p.aboard);
    if (d?.boat) this.seat(p, d);
    else this.leave(d);
  }
  // Un sitio en tierra, cerca de la barca (o null)
  land(cx = this.p.x, cy = this.p.y) {
    const w = this.game.world;
    for (const r of [1, 1.5, 2, 2.5, 3, 3.5]) for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, x = cx + Math.sin(a) * r, y = cy + Math.cos(a) * r;
      if (w.water(x, y) || w.blocked(x, y)) continue;
      if (w.collidersNear(x, y).some(c => c.r !== undefined && Math.hypot(c.x - x, c.y - y) < c.r + 0.3)) continue;
      return [x, y];
    }
    return null;
  }
  // Bajar: a tierra si la hay cerca (d: el que remaba, si ha bajado: a su lado). Si no, la barca se queda para ti
  leave(d) {
    const g = this.game, p = this.p, spot = (d && this.land(nearX(d.x, p.x), d.y)) || this.land();
    p.aboard = null;
    // (quien remaba ha bajado a tierra y tú también: la barca se queda amarrada donde ibas; él no la amarró, yendo tú)
    if (spot && d && !d.boat && g.world.water(p.x, p.y)) g.world.moorBoat(p.x, p.y, this.turn(d));
    if (spot) [p.x, p.y] = spot;
    else if (g.world.water(p.x, p.y)) { p.boat = true; hud.toast('Ahora remas tú'); }
    Audio.door();
  }
  // ---------- tu barca ----------
  hasMate() { const g = this.game; return g.live.joined && g.live.others.some(q => q.entity?.aboard === Profile.id); }
  // Remando: E baja a tierra (delante, o lo más cerca que haya) y deja la barca amarrada
  ownAction() {
    const p = this.p, w = this.game.world, ax = p.x + p.face.x * 1.1, ay = p.y + p.face.y * 1.1;
    const free = (x, y) => !w.water(x, y) && !w.blocked(x, y) && !w.collidersNear(x, y).some(c => c.r !== undefined && Math.hypot(c.x - x, c.y - y) < c.r + 0.3);
    const spot = free(ax, ay) ? [ax, ay] : this.land();
    if (!spot) return { text: 'En la barca', run: () => hud.toast('Acércate a la orilla para bajar') };
    return { text: 'Bajar a tierra', run: () => this.disembark(spot) };
  }
  disembark(spot) {
    const g = this.game, p = this.p, at = [p.x, p.y], yaw = this.turn(p);
    p.boat = false; [p.x, p.y] = spot; p.vx = p.vy = 0;
    if (!this.hasMate()) g.world.moorBoat(at[0], at[1], yaw);   // (con pasajero, se la queda él: ver leave)
    Audio.door();
    g.onSave?.();
  }
  embark(b) {
    const g = this.game, p = this.p;
    if (!g.world.unmoorBoat(b)) return;   // (se la ha llevado otro)
    Object.assign(p, { boat: true, x: b.x, y: b.y, vx: 0, vy: 0, z: 0, vz: 0, crouch: false, wading: false });
    Audio.door();
    g.onSave?.();
  }
  dismantle(b) {
    const g = this.game;
    if (!g.world.unmoorBoat(b)) return;
    for (const [m, n] of BUILDABLE.barca?.cost || []) { const left = g.inv.add(m, n); if (left) g.gather.throwOut(m, left); }
    Audio.pickup();
    g.onSave?.();
  }
  mooredAction(b) { return { text: 'Subir a la barca', run: () => this.embark(b), alt: { text: 'Desmontar la barca', run: () => this.dismantle(b) } }; }
  canRow(p, scene) { return scene === this.game.world && !p.boat && !p.mount && !p.aboard && !p.inside; }
  // Lo que hace E en la barca de otro
  action() {
    const d = this.driver(this.p.aboard), name = d?.name || 'otro';
    if (this.land()) return { text: 'Bajar a tierra', run: () => this.leave() };
    return { text: `En la barca de ${name}`, run: () => hud.toast('Acercaos a la orilla para bajar') };
  }
  // Cerca de la barca de otro: subirse, si no va ya alguien
  canBoard(p, scene) { const g = this.game; return scene === g.world && g.live.joined && !p.boat && !p.mount && !p.aboard && !p.inside; }
  actionOn(peer) {
    if (this.game.live.others.some(q => q.entity?.aboard === peer.id)) return { text: `La barca de ${peer.name} ya va llena`, run: () => hud.toast('En la barca caben dos') };
    return { text: `Subir a la barca de ${peer.name}`, run: () => this.board(peer) };
  }
  interact(p, scene) {
    if (this.canRow(p, scene)) { const b = this.game.world.boatsNear(p.x, p.y, REACH)[0]; if (b) return this.mooredAction(b); }
    if (!this.canBoard(p, scene)) return null;
    for (const peer of this.game.live.others) {
      const e = peer.entity;
      if (e?.boat && peer.sc === 'world' && Math.hypot(nearX(e.x, p.x) - p.x, e.y - p.y) <= REACH) return this.actionOn(peer);
    }
    return null;
  }
  aimables(p, scene, box) {
    const moored = this.canRow(p, scene) ? this.game.world.boatsNear(p.x, p.y, 5).map(b => ({ kind: 'sys', e: b, box: box(nearX(b.x, p.x), b.y, 0.9, 0.9, -0.3, 0.9), act: () => this.mooredAction(b) })) : [];
    if (!this.canBoard(p, scene)) return moored.length ? moored : null;
    return moored.concat(this.game.live.others.filter(q => q.entity?.boat && q.sc === 'world').map(peer => ({ kind: 'sys', e: peer.entity, box: box(peer.entity.x, peer.entity.y, 0.9, 0.9, 0, 1.6), act: () => this.actionOn(peer) })));
  }
  board(peer) {
    const p = this.p;
    Object.assign(p, { aboard: peer.id, vx: 0, vy: 0, z: 0, vz: 0, crouch: false, wading: false });
    Audio.door();
  }
}
