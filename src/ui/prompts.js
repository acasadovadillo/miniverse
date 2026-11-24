// What the keys do, at the thing aimed at (docs/planes/realismo/PLAN-R8-hud-mapa.md §3.5, Decision 3 a): the rows of
// hud.prompt (E; X; the click on prey; Y on a person) and where they go: the top of what is aimed at, projected, a little to its
// right. The cursor still aims; with Settings.v.prompts 'cursor' (or for what is as wide as the water, or lies on the
// ground under a label of its own, a print) they go beside it. What is not aimed at (get up, get off, the oars) goes at the
// bottom, in the middle.
// The place holds: what does not move keeps the point it had when it was first aimed at (a door has two boxes, its gap and its
// leaf), and another thing takes it only after HOLD_MS, so a cursor on the line between two does not shake it.
//
// And what X does when it must be held (an action's alt.hold, seconds): game.altAction starts it here, letting go of X, looking
// away, a dialogue or the pause cancel it; the ring of its key says how far it is.
//
// Cost: one projection a frame while something is aimed at; a row is written only when it changes.
import * as THREE from 'three';
import { t } from '../i18n.js';
import { CAM } from '../camera.js';
import { Settings } from '../settings.js';
import { nearX } from '../world/planet.js';
import { hud } from './hud.js';

const RIGHT = 14, OVER = 0.3;       // px to the right of the point; m over the top of the thing
const TALL = 1.7, TALL_1P = 1.2;    // m over its foot, at most (a tree is taller: by its trunk). In first person, lower: in sight
const WIDE = 1.2;                   // m (half): from here on, what is aimed at is ground or water, not a thing
const HOLD_MS = 80, CURSOR = 18;

export class Prompts {
  constructor(game) {
    this.game = game;
    this.v3 = new THREE.Vector3();
    this.rows = [];
    this.pool = Array.from({ length: 4 }, () => ({ key: 'E', text: '', hold: 0, dim: false }));
    this.at = [0, 0];
    this.id = undefined; this.p = { x: 0, y: 0, h: 0 }; this.since = 0; this.shown = false;
    this.held = null;   // { text, t0, ms }: X, being held
    this.click = false;
  }
  add(key, text, hold = 0, dim = false) {
    const r = this.pool[this.rows.length];
    if (!r) return;
    r.key = key; r.text = text; r.hold = hold; r.dim = dim;
    this.rows.push(r);
  }

  // Each frame, after the world is drawn. near: what E does (game.nearest), or null; hl: what is aimed at (game.highlight); prey:
  // a click would hit it; social: greeting someone in sight (social.promptFor: its text, or '')
  frame(near, hl, prey, social) {
    const g = this.game, rows = this.rows;
    rows.length = 0; this.click = false;   // (click: the rows say what the click does, so the hint over the hotbar does not)
    if (near) {
      this.add('E', near.text);
      if (near.alt) this.add('X', near.alt.hold ? `${near.alt.text} ${t('prompt.hold')}` : near.alt.text, near.alt.hold || 0, true);
      this.click = !!prey;
      if (prey) this.add('mouse:l', t('prompt.attack'), 0, true);
    }
    // (building: what is taken down holding, build.js; and the plan the hammer is on, with its swings in the ring, plans.js)
    const plan = g.plans?.row() || null, down = plan || (g.build.on ? g.build.holdRow() : null);
    if (plan) { rows.length = 0; this.click = true; this.add('mouse:l', plan.dim ? plan.text : `${plan.text} ${t('prompt.hold')}`, plan.dim ? 0 : 1, plan.dim); }
    else if (down) { rows.length = 0; this.add('mouse:l', `${down.text} ${t('prompt.hold')}`, 1); }
    if (social && !down) this.add('Y', social, 0, rows.length > 0);
    const target = !rows.length ? null : down ? down.target : near ? hl : social ? g.social.picked : null;
    if (!target) this.id = undefined;
    hud.prompt(rows, target ? this.place(target, down ? down.target : near ? hl : null) : null);
    if (down || this.downK) { const k = down && !down.dim ? down.k : -1; if (k !== this.downK) { this.downK = k; hud.promptHold('mouse:l', k); } if (!down) this.downK = 0; }
    this.shown = !!target;
    this.tick(near);
  }

  // Where they go, for what is aimed at (an entry of game.aimTargets, or social's pick, a person)
  place(a, aim) {
    const g = this.game, m = g.mouse, at = this.at, view = g.view3d;
    const b = aim ? a.box : null, e = a.e;
    if (Settings.v.prompts === 'cursor' || !view?.camera || (aim && (!b || a.track !== undefined || b.hx > WIDE || b.hy > WIDE))) return this.cursor(m);
    const T = performance.now(), id = e || (a.o ? `${a.o.placed}@${a.o.x},${a.o.y}` : a.tile ? `${a.kind}${a.tile[0]},${a.tile[1]}` : b ? `${Math.round(b.x * 2)},${Math.round(b.y * 2)}` : 0);
    const x = b ? b.x : e.x, y = b ? b.y : e.y;
    if (id !== this.id && !(this.shown && this.id !== undefined && T - (this.wait ||= T) < HOLD_MS)) { this.id = id; this.wait = 0; this.fresh = true; }
    else if (id === this.id) this.wait = 0;
    if (this.fresh || (e && id === this.id)) {   // (what can move is followed)
      const gy = b?.abs ? 0 : view.groundY?.(g.scene, x, y) || 0, foot = (b ? b.y0 : 0) + gy, top = (b ? b.y1 : view.personHeight?.(e, 1.5) ?? 1.5) + gy;
      this.p.x = x; this.p.y = y; this.p.h = Math.min(top + OVER, foot + (CAM.first ? TALL_1P : TALL));
    }
    const p = g.player, v = this.v3.set(p.x + nearX(this.p.x, p.x) - p.x, this.p.h, this.p.y).project(view.camera);
    if (!(v.z < 1) || !(Math.abs(v.x) < 1.2) || !(Math.abs(v.y) < 1.2)) return this.cursor(m);
    at[0] = (v.x + 1) / 2 * innerWidth + RIGHT; at[1] = (1 - v.y) / 2 * innerHeight - 11;
    if (this.fresh) { this.fresh = false; if (this.shown) hud.promptFade(); }
    return at;
  }
  cursor(m) {
    this.id = undefined;
    if (!m?.in) return null;
    this.at[0] = m.x + CURSOR; this.at[1] = m.y + CURSOR;
    return this.at;
  }

  // ---------- X held ----------
  start(act) { this.held = { text: act.text, t0: performance.now(), ms: act.hold * 1000 }; }
  stop() { if (this.held) { this.held = null; hud.promptHold('X', -1); } }
  tick(near) {
    const h = this.held, g = this.game;
    if (!h) return;
    const act = near?.alt;
    if (!act?.hold || act.text !== h.text || g.mode !== 'play' || g.busy || hud.dialogOpen || g.wheel?.open) { this.stop(); return; }
    const k = (performance.now() - h.t0) / h.ms;
    if (k < 1) { hud.promptHold('X', k); return; }
    this.held = null;
    hud.promptHold('X', 1, true);
    act.run();
  }
}
