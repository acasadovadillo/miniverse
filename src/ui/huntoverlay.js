// What the minimap says while you hunt (Plan R3 §4, docs/planes/realismo/PLAN-R3-caza.md): a faint ring round your arrow,
// as far as a deer can hear you now (presence.js; it swells on a loud thing), and a mark on the rim, where the wind blows
// to: your scent goes that way. Only while hunting (the bow in hand, or crouched, out of the village: wildlife.hunting), in
// both interfaces, and nothing over the animals: what they do says what they have noticed.
//
// Contract:
//   main.js makes it once (game.huntOverlay); it puts its draw() in game.map.overlay, which MapView.draw calls on the
//   minimap under your arrow. Reads only: game.wildlife (hunting, tension, presence), game.wind, game.ranch. .on: whether
//   it shows (smarthud.js keeps the minimap in sight meanwhile). .tip(seen): the one-time tip to ask for now, or null.
import { hearRange, SENSES, DIFF_K } from '../senses.js';
import { sensesOn } from '../wildlife.js';
import { Profile } from '../accounts.js';

const RING_A = 0.35, EASE = 0.4, PULSE_S = 0.9, EDGE = 9, TIP_AFTER = 3, DOG_NEAR = 20;

export class HuntOverlay {
  constructor(game) {
    this.game = game;
    this.r = 0; this.since = -1;
    if (game.map) game.map.overlay = (ctx, toMap, me, a, w, h) => this.draw(ctx, toMap, me, a, w, h);
  }
  get on() { const g = this.game; return !!g.wildlife?.hunting && sensesOn() && !g.indoors; }
  destroy() { if (this.game.map) this.game.map.overlay = null; }
  // How far you are heard now (m), by a deer
  heardAt() {
    const g = this.game, P = g.wildlife.presence, me = P.byKey.get('me');
    return me ? hearRange(SENSES.ciervo, me.noise, DIFF_K[g.difficulty] ?? 1) : 0;
  }
  colors() {
    if (this.c) return this.c;
    const s = getComputedStyle(document.documentElement), v = (k, d) => s.getPropertyValue(k).trim() || d;
    return (this.c = { ink: v('--ink', '#ffffff'), cool: v('--cool', '#37c9c3'), dark: 'rgba(10, 12, 16, .85)' });
  }
  // On the minimap's canvas (w, h: its size in the px it draws in; a: pixels per tile of its view; a circle on the ground is an ellipse half as tall)
  draw(ctx, toMap, me, a, w = ctx.canvas.width, h = ctx.canvas.height) {
    const g = this.game;
    if (!this.on) { this.since = -1; this.r = 0; return; }
    if (this.since < 0) this.since = g.time;
    const W = w, H = h, [mx, my] = toMap(me[0], me[1]), C = this.colors(), P = g.wildlife.presence;
    const left = 1 - (g.time - P.pulse) / PULSE_S, loud = left > 0 && left <= 1 ? hearRange(SENSES.ciervo, P.pulseN, DIFF_K[g.difficulty] ?? 1) * left : 0;
    this.r += (Math.max(this.heardAt(), loud) - this.r) * EASE;
    // (past the edge of the map it stays just inside it, thicker: far enough)
    const full = this.r * a * Math.SQRT2, rx = Math.min(full, W / 2 - 3), ry = Math.min(full / 2, H / 2 - 3), over = full / 2 > H / 2 - 3;
    ctx.save();
    if (rx > 3) {
      ctx.beginPath(); ctx.ellipse(mx, my, rx, ry, 0, 0, Math.PI * 2);
      ctx.globalAlpha = 0.06; ctx.fillStyle = C.ink; ctx.fill();
      ctx.globalAlpha = RING_A + (loud > 0 ? 0.35 * left : 0); ctx.lineWidth = over ? 2.5 : 1.5; ctx.strokeStyle = C.ink; ctx.stroke();
    }
    const V = g.wind;
    if (V) {
      const [qx, qy] = toMap(me[0] + V.x * 40, me[1] + V.y * 40), dx = qx - mx, dy = qy - my, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
      const t = Math.min((W / 2 - EDGE) / (Math.abs(ux) || 1e-6), (H / 2 - EDGE) / (Math.abs(uy) || 1e-6)), x = W / 2 + ux * t, y = H / 2 + uy * t, nx = -uy, ny = ux;
      // (the point of it, and three dashes behind: longer the stronger it blows)
      const dash = 2 + 5 * V.s;
      ctx.globalAlpha = 1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? C.cool : C.dark; ctx.lineWidth = pass ? 2 : 4;
        ctx.beginPath();
        ctx.moveTo(x - ux * 5 + nx * 4.5, y - uy * 5 + ny * 4.5); ctx.lineTo(x + ux * 2, y + uy * 2); ctx.lineTo(x - ux * 5 - nx * 4.5, y - uy * 5 - ny * 4.5);
        for (let i = 0; i < 3; i++) { const s = 6 + i * (dash + 3); ctx.moveTo(x - ux * s, y - uy * s); ctx.lineTo(x - ux * (s + dash), y - uy * (s + dash)); }
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  // (smarthud.js fieldTips asks four times a second at most) The animal that stares first, then the dog, then what the map
  // says
  tip(seen) {
    const g = this.game, p = g.player;
    if (!p || !this.on) return null;
    if (!seen.has('freeze') && g.wildlife.tension) return 'freeze';
    if (!seen.has('point') && g.ranch?.animals.some(d => d.pointing && d.owner === (Profile.id || 'yo') && Math.hypot(d.x - p.x, d.y - p.y) < DOG_NEAR)) return 'point';
    if (this.since < 0 || g.time - this.since < TIP_AFTER) return null;
    if (!seen.has('wind')) return 'wind';
    if (!seen.has('ring') && this.r > 4) return 'ring';
    return null;
  }
}
