// Posturas: sentarse en una silla, tumbarse en la cama (sin dormir) y sentarse o tumbarse en el suelo (Shift held: posture).
// Mientras tanto no se anda; moverse, saltar o E (levantarse) devuelven al jugador a donde estaba.
// La postura va en p.pose = { kind: 'sit' | 'floorSit' | 'lie' | 'floorLie' | 'bath', yaw, h } y la ven los demás
// jugadores (va con su estado). h: la altura del cuerpo sobre el suelo (en la cama, sobre el colchón).
// 'bath' (Plan E §4.1): sitting in a tub, p.bathing set; body.js runs the bath. On the network it goes as a sit (index 0)
// plus st.ba, so an old client sees someone sitting in the tub (live.js)
import { keys } from './input.js';
import { dirOf, sideOf } from './world/fit.js';
import { nearX } from './world/planet.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';

const SEAT = 0.14, STOOL = 0.27, SOFA = 0.1, BED = 0.6, FLOOR_LIE = 0.14, FLOOR_SIT = -0.28;
const BATH = 0.12, BATH_HIP = 0.85;   // the bather's h, and from the tub's anchor along its length to the hips (the taps' end at the feet)

export class Rest {
  constructor(game) { this.game = game; }
  get p() { return this.game.player; }
  reset() { if (this.p) { this.p.pose = null; this.p.sleeping = false; this.p.bathing = false; } this.twin = null; }
  // Mirando hacia (dx, dy): el ángulo del modelo (z+ hacia delante)
  static yaw(dx, dy) { return Math.atan2(dx, dy); }

  // En una silla: en su centro, mirando hacia donde mira ella (con el giro que tenga: o.yaw)
  // En el sofá, en la plaza que quede más cerca (la suya o la de al lado), algo más hundido (y en el sillón)
  sit(o) {
    if (this.game.carry?.refuse()) return;   // (with something in the arms: carry.js)
    const yaw = o.yaw, p = this.p;
    let [x, y] = [o.x, o.y];
    if (o.placed === 'sofa') { const [sx, sy] = sideOf(yaw); if (Math.hypot(x + sx - p.x, y + sy - p.y) < Math.hypot(x - p.x, y - p.y)) { x += sx; y += sy; } }
    const soft = o.placed === 'sofa' || o.placed === 'sillon';   // (en el sofá y en el sillón, más hundido y algo más adelante)
    this.take({ kind: 'sit', yaw, h: soft ? SOFA : o.placed === 'taburete' ? STOOL : SEAT }, x + Math.sin(yaw) * (soft ? 0.05 : -0.04), y + Math.cos(yaw) * (soft ? 0.05 : -0.04));
  }
  // En una cama: boca arriba, con la cabeza en la almohada (la casilla de la cabecera). En la doble, del lado
  // que quede más cerca y esté libre (twin: dónde está el otro lado, para saber quién se tumba ahí: ver la familia)
  lie(o) {
    if (this.game.carry?.refuse()) return;
    const p = this.p, along = dirOf(o.yaw);
    // (como en Minecraft: con criaturas cerca no se puede descansar)
    if (this.game.gamemode === 'survival' && this.game.mobs?.near(p.x, p.y, 8)) { hud.toast('No puedes descansar: hay criaturas cerca'); return; }
    const foot = o.placed === 'cama_nino' ? 0.85 : 1.05;   // (de los pies a la cabecera)
    const spot = (x, y) => [x + along[0] * foot, y + along[1] * foot];
    let at = spot(o.x, o.y), twin = null;
    if (o.placed === 'cama_doble') {   // (la otra mitad, a su derecha)
      const [ux, uy] = sideOf(o.yaw), sides = [[o.x, o.y], [o.x + ux, o.y + uy]].sort((a, b) => Math.hypot(a[0] - p.x, a[1] - p.y) - Math.hypot(b[0] - p.x, b[1] - p.y)).map(s => spot(...s));
      const taken = s => this.game.live.others.some(q => q.sc === 'world' && q.entity?.pose?.kind === 'lie' && Math.hypot(nearX(q.entity.x, s[0]) - s[0], q.entity.y - s[1]) < 0.4);
      if (taken(sides[0]) && taken(sides[1])) { hud.toast('La cama ya está ocupada'); return; }
      [at, twin] = taken(sides[0]) ? [sides[1], sides[0]] : sides;
    }
    this.take({ kind: 'lie', yaw: Rest.yaw(-along[0], -along[1]) + Math.PI, h: BED }, at[0], at[1]);
    this.twin = p.pose ? twin : null;
  }
  // In a tub (banera: two tiles long, the taps at the anchor's end): sitting with the back at the far end, facing the
  // taps. body.bathe checks first (the arms, the water, another bather) and runs the bath
  bathSpot(o) { const [dx, dy] = dirOf(o.yaw ?? 0); return [o.x + dx * BATH_HIP, o.y + dy * BATH_HIP]; }
  bath(o) {
    if (this.game.carry?.refuse()) return;
    const p = this.p, [dx, dy] = dirOf(o.yaw ?? 0), [x, y] = this.bathSpot(o);
    if (!p) return;
    if (p.pose) this.stand();
    this.take({ kind: 'bath', yaw: Rest.yaw(-dx, -dy), h: BATH }, x, y);
    if (p.pose?.kind === 'bath') p.bathing = true;
  }
  // En el suelo, donde está, mirando hacia donde miraba. True when the posture changed (sat, lay down or got up)
  floor(kind) {
    if (this.game.carry?.refuse()) return false;
    if (this.game.gamemode === 'spectator') return false;   // (el espectador no se sienta)
    const p = this.p;
    if (!p || p.boat || p.aboard || p.mount || this.game.busy) return false;
    if (p.swim || p.depth > 0.3) { hud.toast('En el agua no'); return false; }   // (nadando, o con el agua por las rodillas)
    if (p.pose) { const was = p.pose.kind; this.stand(); if (was === kind) return true; }
    const yaw = Rest.yaw(p.face.x, p.face.y);
    return !!this.take(kind === 'floorLie' ? { kind, yaw: yaw + Math.PI, h: FLOOR_LIE } : { kind, yaw, h: FLOOR_SIT }, kind === 'floorLie' ? p.x - p.face.x * 0.5 : p.x, kind === 'floorLie' ? p.y - p.face.y * 0.5 : p.y);
  }
  // Shift alone (input.js): a tap or a hold (SHIFT_HOLD). Standing: a tap crouches, a hold sits on the floor. Crouching: a
  // tap stands up, a hold sits. Sitting on the floor: a tap gets up crouching, a hold lies down face up. Lying on the
  // floor: a tap sits up. Never on a horse, in a boat, on a chair, in a bed or in a tub (E, Space or walking get up there; in
  // the tub body.js runs the bath until then, so Shift must not end it or crouch the bather); a hold
  // while walking does nothing (walking would get up at once); in the water, only the tap's crouch, as before.
  // True when the posture changed (input.js then stops the running; nothing done leaves the gait as it was)
  posture(hold) {
    const p = this.p;
    if (!p || p.mount || p.boat || p.aboard) return false;
    const kind = p.pose?.kind;
    if (kind === 'sit' || kind === 'lie' || kind === 'bath' || p.bathing) return false;
    // (scrubbing at the water, body.js, is its own crouch: a tap ends it, standing as you were before; a hold ends it and
    // goes on to sit, so the posture's crouch and the scrub's never fight over p.crouch). Drinking on land (needs.js) is
    // the same kind of crouch, and goes the same way
    const body = this.game.body, needs = this.game.needs;
    if (body?.scrubbing) { body.stopScrub(); if (!hold) return true; }
    if (needs?.drinking?.land) { needs.stopDrinking(); if (!hold) return true; }
    if (p.swim || p.depth > 0.3) { if (hold || kind) return false; p.crouch = !p.crouch; return true; }
    if (!hold) {
      if (kind === 'floorLie') return this.floor('floorSit');
      if (kind === 'floorSit') { this.stand(); p.crouch = true; return true; }
      p.crouch = !p.crouch;
      return true;
    }
    if (kind === 'floorLie' || keys.up || keys.down || keys.left || keys.right) return false;
    return this.floor(kind === 'floorSit' ? 'floorLie' : 'floorSit');
  }
  take(pose, x, y) {
    const p = this.p;
    if (!p || p.mount || p.boat || p.aboard) return false;
    this.back = [p.x, p.y];   // (al levantarse, vuelve aquí)
    Object.assign(p, { pose, x, y, vx: 0, vy: 0, z: 0, vz: 0, crouch: false });
    Audio.place();
    return true;
  }
  stand() {
    const p = this.p;
    if (!p?.pose) return;
    p.pose = null;
    p.sleeping = false;   // (asleep in bed until you get up: needs.js sleep, st.zz)
    p.bathing = false;    // (in a tub: body.js, st.ba)
    this.twin = null;
    if (this.back) [p.x, p.y] = this.back;
    this.back = null;
  }
  // Moverse levanta; con una postura no se usa nada (E: levantarse). pose.min: not before (thrown off a horse, horse.js)
  update() {
    const p = this.p;
    if (p?.pose && !this.game.family.scene && !(p.pose.min > this.game.time) && (keys.up || keys.down || keys.left || keys.right)) this.stand();   // (mientras salen los corazones, no)
  }
}
