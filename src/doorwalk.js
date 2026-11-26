// Doors and gates by hand. E on a door or a fence gate a little away walks you up to it, on your own side of it (straight, only
// where nothing is in the way: never through a wall), turns you to it and pushes or pulls it with the free hand; the leaf swings
// when the hand gets there. Within arm's reach, only the push or the pull. Any movement key, a dialogue, the pause or a
// change of scene stops the walk, and the door stays as it was. Riding: a lean and a push for a gate, no walk (a door, as
// before); swimming, rowing or pushing the wheelbarrow, as before: at once, with no gesture.
// Push or pull: the leaf opens to one side (three/build3d.js doorTile swing; a gate, always +): opening it from that side, or
// closing it from the other, the hand pulls; otherwise it pushes. The gesture goes to the others as every gesture does
// (social.js emote: 'push', 'pull'; three/actors.js EMOTES), and the door with the world, as before.
import { keys } from './input.js';
import { hud } from './ui/hud.js';

export const REACH = 1.05;   // m from the door's middle: within arm's reach
const STAND = 0.72;          // m from the door's line, where one stands to push it
const FAR = 3.4;             // m: farther than this (or with something in the way), it is used from where you are, as before
const GIVE_UP = 3;           // s walking at most
const ARRIVE = 0.12;         // m: there
export const CONTACT = { push: 0.34, pull: 0.4 };   // s into the gesture when the hand meets the leaf (actors.js EMOTES)

export class DoorWalk {
  constructor(game) { this.game = game; this.go = null; this.touching = null; }
  // The door at tile [tx, ty] (a door or a gate of the scene), and what opens or closes it
  use(door, done) {
    const g = this.game, p = g.player, sc = g.scene;
    this.cancel();
    if (!p || !sc) { done(); return; }
    const o = sc.placedObjectAt?.(door[0], door[1]), axis = o?.door;
    if (!axis || p.swim || p.boat || p.aboard || p.pushing || p.pose) { done(); return; }
    const cx = door[0] + 0.5, cy = door[1] + 0.5, along = axis === 'x';
    const off = along ? p.y - cy : p.x - cx, side = off < 0 ? -1 : 1;
    const kind = this.kindFor(door, side, !sc.doorClosed(...door), o.gate);
    if (p.mount) { if (o.gate && Math.hypot(p.x - cx, p.y - cy) < REACH + 0.6) this.touch(door, kind, done); else done(); return; }
    const sx = along ? cx : cx + side * STAND, sy = along ? cy + side * STAND : cy;
    const d = Math.hypot(p.x - cx, p.y - cy), toStand = Math.hypot(p.x - sx, p.y - sy);
    // (close enough, on its own side: only the hand; and so where there is no straight way to the spot)
    if (d <= REACH || toStand <= ARRIVE || toStand > FAR || !this.clear(sc, p.x, p.y, sx, sy)) { this.touch(door, kind, done); return; }
    this.go = { door, sx, sy, kind, done, scene: sc, t: 0, best: toStand, stuck: 0 };
  }
  // Push or pull (see the top)
  kindFor(door, side, open, gate) {
    const swing = gate ? 1 : this.game.view3d?.world?.doorSwing?.(door) ?? -side;
    return (side === swing) !== open ? 'pull' : 'push';
  }
  // Nothing in the way: no wall or shut door (scenes.js reaches), nor anything that is bumped into on the way
  clear(sc, x0, y0, x1, y1) {
    if (sc.reaches && !sc.reaches(x0, y0, x1, y1, true)) return false;
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.25);
    for (let i = 1; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
      if ((sc.waterDepth?.(x, y) || 0) > 0.4 || sc.collidersNear?.(x, y).some(c => !c.dig && !c.pond && c.top === undefined && (c.r !== undefined ? Math.hypot(c.x - x, c.y - y) < c.r + 0.2 : c.x0 !== undefined && x > c.x0 - 0.2 && x < c.x1 + 0.2 && y > c.y0 - 0.2 && y < c.y1 + 0.2))) return false;
    }
    return true;
  }
  // Turn to it, the gesture, and the door when the hand gets there
  touch(door, kind, done) {
    const g = this.game, p = g.player;
    const dx = door[0] + 0.5 - p.x, dy = door[1] + 0.5 - p.y, l = Math.hypot(dx, dy);
    if (l > 0.05 && !p.mount) { p.face = { x: dx / l, y: dy / l }; p.dir = [dx, dy]; }
    g.social?.emote(p, kind);
    this.touching = { t: CONTACT[kind], done, scene: g.scene };
  }
  cancel() { if (this.go && this.game.player) this.game.player.steer = null; this.go = null; }
  get walking() { return !!this.go; }
  update(dt) {
    const g = this.game, p = g.player;
    const T = this.touching;
    if (T) { T.t -= dt; if (T.t <= 0) { this.touching = null; if (g.scene === T.scene) T.done(); } }
    const G = this.go;
    if (!G) return;
    const moved = keys.up || keys.down || keys.left || keys.right || keys.space;
    if (!p || moved || g.scene !== G.scene || g.busy || hud.dialogOpen || g.mode !== 'play' || p.pose || p.mount || p.swim || g.windowsOpen) { this.cancel(); return; }
    G.t += dt;
    const dx = G.sx - p.x, dy = G.sy - p.y, d = Math.hypot(dx, dy);
    if (d < G.best - 0.02) { G.best = d; G.stuck = 0; } else G.stuck += dt;
    // (there; or stopped by something on the way, or too long: the hand from where it is)
    if (d <= ARRIVE || G.stuck > 0.5 || G.t > GIVE_UP) { this.cancel(); p.vx = p.vy = 0; this.touch(G.door, G.kind, G.done); return; }
    p.steer = { x: dx / d, y: dy / d };
  }
  reset() { this.cancel(); this.touching = null; }
}
