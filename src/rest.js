// Posturas: sentarse en una silla, tumbarse en la cama (sin dormir) y sentarse o tumbarse en el suelo (G y H).
// Mientras tanto no se anda; moverse, saltar o E (levantarse) devuelven al jugador a donde estaba.
// La postura va en p.pose = { kind: 'sit' | 'floorSit' | 'lie' | 'floorLie', yaw, h } y la ven los demás
// jugadores (va con su estado). h: la altura del cuerpo sobre el suelo (en la cama, sobre el colchón).
import { keys } from './input.js';
import { extraTiles, front, yawOf } from './art/stations.js';
import { Audio } from './audio.js';

const SEAT = 0.14, BED = 0.6, FLOOR_LIE = 0.14, FLOOR_SIT = -0.28;

export class Rest {
  constructor(game) { this.game = game; }
  get p() { return this.game.player; }
  reset() { if (this.p) this.p.pose = null; }
  // Mirando hacia (dx, dy): el ángulo del modelo (z+ hacia delante)
  static yaw(dx, dy) { return Math.atan2(dx, dy); }

  // En una silla: en su centro, mirando hacia donde mira ella
  sit(o) {
    const yaw = yawOf(o.rot);
    this.take({ kind: 'sit', yaw, h: SEAT }, o.x - Math.sin(yaw) * 0.04, o.y - Math.cos(yaw) * 0.04);
  }
  // En una cama: boca arriba, con la cabeza en la almohada (la casilla de la cabecera). En la doble, del lado
  // que quede más cerca
  lie(o) {
    const p = this.p, along = front(o.rot);
    let [bx, by] = [o.x, o.y];
    if (o.placed === 'cama_doble') {
      const [sx, sy] = extraTiles('cama_doble', ...o.tile, o.rot).map(([x, y]) => [x + 0.5, y + 0.5]).find(([x, y]) => Math.abs(x - o.x) + Math.abs(y - o.y) === 1 && (x - o.x) * along[0] + (y - o.y) * along[1] === 0) || [o.x, o.y];
      if (Math.hypot(sx - p.x, sy - p.y) < Math.hypot(bx - p.x, by - p.y)) [bx, by] = [sx, sy];
    }
    const foot = o.placed === 'cama_nino' ? 0.85 : 1.05;   // (de los pies a la cabecera)
    this.take({ kind: 'lie', yaw: Rest.yaw(-along[0], -along[1]) + Math.PI, h: BED }, bx + along[0] * foot, by + along[1] * foot);
  }
  // En el suelo, donde está, mirando hacia donde miraba
  floor(kind) {
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
    Object.assign(p, { pose, x, y, vx: 0, vy: 0, z: 0, vz: 0 });
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
