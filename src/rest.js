// Posturas: sentarse en una silla, tumbarse en la cama (sin dormir) y sentarse o tumbarse en el suelo (G y H).
// Mientras tanto no se anda; moverse, saltar o E (levantarse) devuelven al jugador a donde estaba.
// La postura va en p.pose = { kind: 'sit' | 'floorSit' | 'lie' | 'floorLie', yaw, h } y la ven los demás
// jugadores (va con su estado). h: la altura del cuerpo sobre el suelo (en la cama, sobre el colchón).
import { keys } from './input.js';
import { dirOf, sideOf } from './world/fit.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';

const SEAT = 0.14, SOFA = 0.1, BED = 0.6, FLOOR_LIE = 0.14, FLOOR_SIT = -0.28;

export class Rest {
  constructor(game) { this.game = game; }
  get p() { return this.game.player; }
  reset() { if (this.p) this.p.pose = null; }
  // Mirando hacia (dx, dy): el ángulo del modelo (z+ hacia delante)
  static yaw(dx, dy) { return Math.atan2(dx, dy); }

  // En una silla: en su centro, mirando hacia donde mira ella (con el giro que tenga: o.yaw)
  // En el sofá, en la plaza que quede más cerca (la suya o la de al lado), algo más hundido (y en el sillón)
  sit(o) {
    const yaw = o.yaw, p = this.p;
    let [x, y] = [o.x, o.y];
    if (o.placed === 'sofa') { const [sx, sy] = sideOf(yaw); if (Math.hypot(x + sx - p.x, y + sy - p.y) < Math.hypot(x - p.x, y - p.y)) { x += sx; y += sy; } }
    const soft = o.placed === 'sofa' || o.placed === 'sillon';   // (en el sofá y en el sillón, más hundido y algo más adelante)
    this.take({ kind: 'sit', yaw, h: soft ? SOFA : SEAT }, x + Math.sin(yaw) * (soft ? 0.05 : -0.04), y + Math.cos(yaw) * (soft ? 0.05 : -0.04));
  }
  // En una cama: boca arriba, con la cabeza en la almohada (la casilla de la cabecera). En la doble, del lado
  // que quede más cerca
  lie(o) {
    const p = this.p, along = dirOf(o.yaw);
    // (como en Minecraft: con criaturas cerca no se puede descansar)
    if (this.game.gamemode === 'survival' && this.game.mobs?.near(p.x, p.y, 8)) { hud.toast('No puedes descansar: hay criaturas cerca'); return; }
    let [bx, by] = [o.x, o.y];
    if (o.placed === 'cama_doble') {   // (la otra mitad, a su derecha)
      const [ux, uy] = sideOf(o.yaw), sx = o.x + ux, sy = o.y + uy;
      if (Math.hypot(sx - p.x, sy - p.y) < Math.hypot(bx - p.x, by - p.y)) [bx, by] = [sx, sy];
    }
    const foot = o.placed === 'cama_nino' ? 0.85 : 1.05;   // (de los pies a la cabecera)
    this.take({ kind: 'lie', yaw: Rest.yaw(-along[0], -along[1]) + Math.PI, h: BED }, bx + along[0] * foot, by + along[1] * foot);
  }
  // En el suelo, donde está, mirando hacia donde miraba
  floor(kind) {
    if (this.game.gamemode === 'spectator') return;   // (el espectador no se sienta)
    const p = this.p;
    if (!p || p.boat || p.mount || this.game.busy) return;
    if (p.pose) { const was = p.pose.kind; this.stand(); if (was === kind) return; }
    const yaw = Rest.yaw(p.face.x, p.face.y);
    this.take(kind === 'floorLie' ? { kind, yaw: yaw + Math.PI, h: FLOOR_LIE } : { kind, yaw, h: FLOOR_SIT }, kind === 'floorLie' ? p.x - p.face.x * 0.5 : p.x, kind === 'floorLie' ? p.y - p.face.y * 0.5 : p.y);
  }
  take(pose, x, y) {
    const p = this.p;
    if (!p || p.mount || p.boat) return;
    this.back = [p.x, p.y];   // (al levantarse, vuelve aquí)
    Object.assign(p, { pose, x, y, vx: 0, vy: 0, z: 0, vz: 0, crouch: false });
    Audio.place();
  }
  stand() {
    const p = this.p;
    if (!p?.pose) return;
    p.pose = null;
    if (this.back) [p.x, p.y] = this.back;
    this.back = null;
  }
  // Moverse levanta; con una postura no se usa nada (E: levantarse)
  update() {
    const p = this.p;
    if (p?.pose && (keys.up || keys.down || keys.left || keys.right)) this.stand();
  }
}
