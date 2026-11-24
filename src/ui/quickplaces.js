// The places near (docs/planes/realismo/PLAN-R8-hud-mapa.md §3.3): M held HOLD_MS, the minimap grows a little and up to MAX known
// places within REACH fan out round it, the nearest at the top, each with its glyph, its name and how far it is; the mouse picks one
// like the tool wheel does (a virtual stick: its direction, past a dead zone), or the mouse wheel steps through them, or a digit
// takes it at once, and letting go of M marks the route to it. With a route marked, the first row takes it off. Left click takes
// the picked one too; right click, Esc or letting go with nothing picked leave everything as it was. A tap of M (let go before
// HOLD_MS) is the big map, as always.
// Playing alone the game goes in slow motion while it is open (game.js slowScale), as with the wheel. While it is open the mouse
// is its own (capture, on window). The rows come from the blips (blips.js): what they know is all it can offer.
import { HOUSE } from '../world/village.js';
import { nearX } from '../world/planet.js';
import { keys } from '../input.js';
import { t } from '../i18n.js';
import { hud } from './hud.js';
import { blips } from './blips.js';
import { svg } from './mapglyphs.js';
import { distText } from './compass.js';
import { canWheel } from './wheel.js';

export const HOLD_MS = 300, MAX = 8, REACH = 1500;
const STICK = 120, DEAD = 28, GROW = 1.25, SWALLOW_MAX = 3000;
const ROW = 40, ROW_MIN = 36, SHOPS_MAX = 4, HERE = 6;      // (px between rows, and at least; shops at most, so that they leave room for the rest; tiles: you are there)
const KINDS = new Set(['home', 'tavern', 'shop', 'place', 'horse', 'boat', 'mark']);   // (and whatever says quick: true)

const CSS = `
#quick { position: fixed; left: 16px; bottom: 34px; z-index: 26; width: 0; height: 0; pointer-events: none; opacity: 0; visibility: hidden; transition: opacity .12s ease, visibility 0s linear .12s; }
#quick.on { opacity: 1; visibility: visible; transition: opacity .12s ease, visibility 0s; }
#quick-vig { position: fixed; inset: 0; z-index: 3; pointer-events: none; opacity: 0; transition: opacity .15s ease; background: radial-gradient(ellipse 70vw 90vh at 0% 100%, rgba(6, 7, 9, .62) 0%, rgba(6, 7, 9, 0) 100%); }
#quick-vig.on { opacity: 1; }
#quick h4 { position: absolute; margin: 0; font: 600 15px/20px var(--font-title); letter-spacing: .06em; text-transform: uppercase; color: var(--ink); text-shadow: var(--shadow-bare); white-space: nowrap; }
#quick .qp { position: absolute; display: flex; align-items: center; gap: 9px; box-sizing: border-box; height: 34px; min-width: 190px; max-width: 300px; padding: 0 12px 0 7px; border-radius: 6px; background: rgba(10, 12, 16, .8); box-shadow: inset 0 0 0 1px var(--hair); color: var(--ink); white-space: nowrap; }
#quick .qp i { flex: none; width: 22px; height: 22px; padding: 4px; box-sizing: border-box; border-radius: 50%; background: rgba(12, 15, 20, .9); box-shadow: inset 0 0 0 1.5px currentColor; }
#quick .qp i svg { display: block; width: 14px; height: 14px; }
#quick .qp b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; font: 600 16px/1.2 var(--font-ui); }
#quick .qp em { flex: none; font: 600 14px/1.2 var(--font-ui); font-variant-numeric: tabular-nums; color: var(--ink-2); }
#quick .qp.dim b { color: var(--ink-2); }
#quick .qp.on { background: #fff; box-shadow: 0 2px 10px rgba(0, 0, 0, .4); }
#quick .qp.on b { color: #0c0e12; } #quick .qp.on em { color: rgba(12, 14, 18, .75); }
#quick .qp.none { min-width: 0; padding: 0 14px; }
#minimap.quick .mm-box { transform: scale(${GROW}); }
#minimap.quick .mm-dist { opacity: 0; }
body.quick-open #minimap { opacity: 1 !important; visibility: visible !important; z-index: 26; }
body.quick-open, body.quick-open * { cursor: none !important; }
body.quick-open #crosshair, body.quick-open #aim-free, body.quick-open #hud-bow, body.quick-open #prompt, body.quick-open #hint, body.quick-open #hud-item, body.quick-open #hud-tip, body.quick-open #toasts, body.quick-open #chat { visibility: hidden !important; }
`;

// The known places within REACH, the nearest first: shops open before closed ones, and few of them
export function known(game, max = MAX) {
  const p = game.player, all = [];
  for (const b of blips.refresh(game, performance.now() / 1000, true)) {
    if (!(KINDS.has(b.kind) || b.quick) || b.pin || b.r || !b.name || !blips.shown(b)) continue;
    const to = b.to || b, d = Math.hypot(nearX(to.x, p.x) - p.x, to.y - p.y);
    if (d > REACH || d < HERE || (b.kind === 'home' && p.x > HOUSE.x0 && p.x < HOUSE.x1 && p.y > HOUSE.y0 && p.y < HOUSE.y1)) continue;
    all.push({ kind: b.kind, name: b.name, glyph: b.glyph, color: b.color, dim: b.dim, d, to: { x: to.x, y: to.y, kind: to.kind || 'point', ...(to.id ? { id: to.id } : {}) } });
  }
  const shops = all.filter(q => q.kind === 'shop').sort((a, b) => a.dim - b.dim || a.d - b.d).slice(0, SHOPS_MAX);
  return [...all.filter(q => q.kind !== 'shop'), ...shops].sort((a, b) => a.d - b.d).slice(0, max);
}

export class QuickPlaces {
  constructor(game) {
    this.game = game;
    this.isOpen = false;
    this.pressAt = null;   // when M went down (null: it is not held)
    this.rows = []; this.sel = -1; this.sx = this.sy = 0;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    this.vig = document.createElement('div'); this.vig.id = 'quick-vig';
    this.el = document.createElement('div'); this.el.id = 'quick';
    document.body.append(this.vig, this.el);
    let wheelAt = 0, lastX = null, lastY = null;
    const stop = e => { e.stopPropagation(); e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault(); };
    this.listeners = [
      ['pointermove', e => {
        stop(e);
        let dx = e.movementX, dy = e.movementY;
        if (!dx && !dy && lastX !== null) { dx = e.clientX - lastX; dy = e.clientY - lastY; }
        lastX = e.clientX; lastY = e.clientY;
        if (Math.abs(dx) < 300 && Math.abs(dy) < 300) this.move(dx, dy);
      }],
      ['pointerdown', e => { stop(e); if (e.button !== 0 && e.button !== 2) return; this.swallowBtn = e.button; this.swallowUntil = performance.now() + SWALLOW_MAX; this.close(e.button === 0); }],
      ['wheel', e => { stop(e); if (e.ctrlKey || performance.now() - wheelAt < 60) return; wheelAt = performance.now(); this.step(e.deltaY > 0 ? 1 : -1); }],
      ...['pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'auxclick'].map(type => [type, stop]),
    ];
    this.reset = () => { lastX = lastY = null; };
    // (the rest of the click that closed it, as the tool wheel does: it must not land on what is under the cursor)
    this.swallowBtn = null; this.swallowUntil = 0;
    for (const type of ['pointerdown', 'pointerup', 'mouseup', 'click', 'contextmenu', 'auxclick']) addEventListener(type, e => {
      if (this.swallowBtn === null) return;
      if (type === 'pointerdown' || performance.now() > this.swallowUntil) { if (!this.isOpen) this.swallowBtn = null; return; }
      if (e.button !== this.swallowBtn && type !== 'contextmenu') return;
      stop(e);
      if (type === 'pointerup') keys.use = false;
      if (type === 'click' || type === 'auxclick' || (type === 'mouseup' && e.button === 2)) this.swallowBtn = null;
    }, true);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancel(); });
  }
  get open() { return this.isOpen; }
  // Where it can open: playing out in the world (the places are there), nothing else in the hand of the mouse
  can() { const g = this.game; return canWheel(g) && g.scene === g.world && !g.route?.off && !g.wheel?.open && !g.windowsOpen && !g.pauseHub?.isOpen && !document.getElementById('fade').classList.contains('on'); }

  // ---------- M ----------
  // tap(): what a tap does. false: it cannot open now
  press(tap) {
    if (this.isOpen) return true;
    if (this.pressAt !== null || !this.can()) return false;
    this.pressAt = performance.now(); this.tap = tap;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.late(), HOLD_MS);
    return true;
  }
  late() { if (this.pressAt === null || this.isOpen) return; if (this.can()) this.show(); else this.forget(); }
  forget() { this.pressAt = null; clearTimeout(this.timer); this.timer = null; }
  release() {
    if (this.isOpen) { this.close(true); return; }
    if (this.pressAt === null) return;
    this.forget();
    if (this.game.mode === 'play') this.tap?.();
  }
  cancel() { this.forget(); this.close(false); }
  pick(i) { if (!this.isOpen || i >= this.rows.length) return; this.sel = i; this.close(true); }

  show() {
    const g = this.game, R = g.route;
    this.forget();
    this.isOpen = true;
    this.sel = -1; this.sx = this.sy = 0; this.reset();
    keys.use = false;
    g.archery?.cancel?.();
    this.rows = known(g);
    if (R?.active) { this.rows.length = Math.min(this.rows.length, MAX); this.rows.unshift({ clear: true, name: t('map.keys.clear'), glyph: 'pin', color: 'var(--route, var(--accent))', d: R.left() }); }
    this.paint();
    for (const [type, fn] of this.listeners) addEventListener(type, fn, { capture: true, passive: false });
    document.body.classList.add('quick-open');
    this.el.classList.add('on'); this.vig.classList.add('on');
    g.minimap?.el.classList.add('quick');
    g.minimap?.kick();
  }
  close(commit) {
    if (!this.isOpen) return;
    this.isOpen = false;
    for (const [type, fn] of this.listeners) removeEventListener(type, fn, { capture: true });
    document.body.classList.remove('quick-open');
    this.el.classList.remove('on'); this.vig.classList.remove('on');
    this.game.minimap?.el.classList.remove('quick');
    keys.use = false;
    const q = this.rows[this.sel], R = this.game.route;
    if (!commit || !q || !R) return;
    if (q.clear) R.clear('user'); else R.set({ ...q.to, name: q.name });
  }

  // ---------- picking ----------
  move(dx, dy) {
    if (!this.isOpen) return;
    let x = this.sx + dx, y = this.sy + dy;
    const len = Math.hypot(x, y);
    if (len > STICK) { x *= STICK / len; y *= STICK / len; }
    this.sx = x; this.sy = y;
    if (Math.hypot(x, y) > DEAD && this.rows.length) {
      const a = Math.atan2(y, x);
      let best = 0, bd = Infinity;
      this.rows.forEach((q, i) => { const d = Math.abs(Math.atan2(Math.sin(a - q.ang), Math.cos(a - q.ang))); if (d < bd) { bd = d; best = i; } });
      this.sel = best;
    }
    this.mark();
  }
  step(d) {
    if (!this.isOpen || !this.rows.length) return;
    this.sel = this.sel < 0 ? (d > 0 ? 0 : this.rows.length - 1) : (this.sel + d + this.rows.length) % this.rows.length;
    this.sx = this.sy = 0;
    this.mark();
  }
  mark() { this.rows.forEach((q, i) => q.el.classList.toggle('on', i === this.sel)); }

  // The rows on an arc round the grown minimap, from over it to its right; the stick's direction to each from its middle (q.ang)
  paint() {
    const S = (this.game.minimap?.S || 200) * GROW, C = S / 2, n = this.rows.length, rad = Math.max(C * 1.42 + 12, ((n - 1) * ROW_MIN + 20 - C) / 0.97), top = -C - rad * 0.97, step = Math.min(ROW, (rad * 0.97 + C - 20) / Math.max(1, n - 1));
    this.el.textContent = '';
    const h = document.createElement('h4');
    h.textContent = t('quick.title');
    h.style.left = '0px'; h.style.bottom = `${C + rad * 0.97 + 26}px`;
    this.el.append(h);
    if (!n) { const el = document.createElement('div'); el.className = 'qp none'; el.innerHTML = '<b></b>'; el.firstChild.textContent = t('quick.none'); el.style.left = '0px'; el.style.bottom = `${S + 14}px`; this.el.append(el); return; }
    this.rows.forEach((q, i) => {
      const y = top + C + i * step, x = Math.sqrt(Math.max(0, rad * rad - y * y));   // (from the middle of the map)
      const el = q.el = document.createElement('div');
      el.className = `qp${q.dim ? ' dim' : ''}`;
      el.innerHTML = `<i style="color:${q.color}">${svg(q.glyph, 'currentColor')}</i><b></b><em></em>`;
      el.children[1].textContent = q.name; el.children[2].textContent = distText(q.d);
      el.style.left = `${Math.round(C + x)}px`; el.style.top = `${Math.round(-C + y - 17)}px`;
      q.ang = Math.atan2(y, x + 60);
      this.el.append(el);
    });
  }
  // Each frame: it opens when M has been held long enough (if the timer is late), and closes when it can no longer be used
  frame() {
    if (this.pressAt !== null && !this.isOpen && performance.now() - this.pressAt >= HOLD_MS) this.late();
    if (this.isOpen && !this.can()) this.cancel();
  }
}
