// A mark over a point of the world, with its distance, held on the edge of the screen with an arrow while the point is
// off it: the gold diamond of the first steps (#hud-goal, ui/smarthud.js) and the cream pin of the marked route
// (#hud-wp, Plan J §4.1). Both HUDs show the route's pin: the minimal one from SmartHud.frame, the full one from
// route.js (Route.update), so this file has no other owner and its CSS is in index.html.
import * as THREE from 'three';
import { t } from '../i18n.js';
import { nearX } from '../world/planet.js';

const M = 40, TOP = 60, BOTTOM = 110;   // (px: how far from the sides, the top and the bottom the mark is held)

// Puts el over the world point (x, y) at height h above the ground, from the player p, and writes only what changed
// since the last call (cache: a plain object per mark). el holds three children: the mark, the edge arrow and the
// distance text. Returns the distance in tiles.
export function markAt(el, at, p, view, scene, cache, v3) {
  const dx = nearX(at.x, p.x) - p.x, dist = Math.hypot(dx, at.y - p.y);
  const W = innerWidth, H = innerHeight;
  v3.set(p.x + dx, (view.groundY?.(scene, at.x, at.y) || 0) + (at.h ?? 1.6), at.y).project(view.camera);
  let x = (v3.x + 1) / 2 * W, y = (1 - v3.y) / 2 * H;
  const behind = v3.z > 1;
  if (behind) { x = W - x; y = H - y; }
  const edge = behind || x < M || x > W - M || y < TOP || y > H - BOTTOM;
  let angle = 0;
  if (edge) {   // (on the edge of the screen, toward it)
    const cx = W / 2, cy = (TOP + H - BOTTOM) / 2, ex = x - cx, ey = y - cy;
    const k = Math.min(Math.abs(ex) > 1e-3 ? (cx - M) / Math.abs(ex) : Infinity, Math.abs(ey) > 1e-3 ? (cy - TOP) / Math.abs(ey) : Infinity);
    x = cx + ex * k; y = cy + ey * k; angle = Math.atan2(ey, ex);
  }
  const n = Math.round(dist);
  if (n !== cache.n) { cache.n = n; el.lastChild.textContent = t('hud.goal.dist', { n }); }
  if (edge !== cache.edge) { cache.edge = edge; el.classList.toggle('edge', edge); }
  if (Math.abs(x - cache.x) > 0.5 || Math.abs(y - cache.y) > 0.5 || !(cache.x >= 0)) {
    cache.x = x; cache.y = y;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }
  if (edge && Math.abs(angle - (cache.a ?? 9)) > 0.02) { cache.a = angle; el.children[1].style.transform = `rotate(${angle.toFixed(3)}rad) translateX(${(13 + Math.max(0, Math.sin(angle)) * 22).toFixed(1)}px)`; }   // (pointing down, past the distance under the mark)
  return dist;
}

// The route's pin in the world (#hud-wp): shown while a route is set, its target is more than near tiles away and can
// is true (outside, no dialogue, no window, not building). Made on the first show, so nothing is added to the page for
// players who never mark a route
export class RouteMark {
  constructor() { this.el = null; this.on = false; this.cache = {}; this.v3 = new THREE.Vector3(); this.at = { x: 0, y: 0, h: 1.7 }; }
  frame(game, can, near) {
    const r = game.route, p = game.player, tg = r?.target;
    let on = !!(tg && p && can && game.scene === game.world && game.view3d?.camera);
    if (on) {
      const d = Math.hypot(nearX(tg.x, p.x) - p.x, tg.y - p.y);
      on = d > near;
      if (on) {
        if (!this.el) {
          this.el = document.createElement('div');
          this.el.id = 'hud-wp';
          this.el.innerHTML = '<i></i><s></s><b></b>';
          document.body.append(this.el);
        }
        this.at.x = tg.x; this.at.y = tg.y;   // (one object, reused: this runs every frame)
        markAt(this.el, this.at, p, game.view3d, game.scene, this.cache, this.v3);
      }
    }
    if (on !== this.on) { this.on = on; this.el?.classList.toggle('on', on); }
    return on;
  }
  hide() { if (this.on) { this.on = false; this.el?.classList.remove('on'); } }
  destroy() { this.el?.remove(); this.el = null; this.on = false; this.cache = {}; }
}
