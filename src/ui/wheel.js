// The tool wheel, as in GTA and Red Dead: hold F and, after a moment (HOLD_MS), a ring with the nine slots of the hotbar
// shows in the middle of the screen; the mouse picks one like a virtual stick (its direction, past a dead zone) or the
// mouse wheel steps through them, and letting go of F equips it. A quick tap of F (let go before the ring shows) goes
// back to what you held before (inv.back), without showing anything. Left click equips too; right click or Esc cancel.
// Playing alone the game goes in slow motion while it is open (game.js, slowScale); with others in the world it cannot
// be slowed down, so it only darkens the edges a little. 1-9 and the mouse wheel keep working as always.
// While it is open the mouse is the wheel's: it listens on window, in the capture phase, so neither the windows under
// the cursor nor the canvas (the camera in first person) hear anything, and it stops listening when it closes. The page
// is made once; while open it only touches the page when the slot changes or the stick moves. Its look is the CSS
// below, injected so all of it stays in this file (as smarthud.js does).
import { t, onLangChange } from '../i18n.js';
import { ITEMS } from '../items.js';
import { HOTBAR } from '../inventory.js';
import { itemIconUrl } from '../art/items.js';
import { keys } from '../input.js';
import { Profile } from '../accounts.js';
import { hud } from './hud.js';

export const HOLD_MS = 180;     // how long F is held before the ring shows (shorter: a tap)
const STICK = 120, DEAD = 28;   // px of mouse movement: the stick's reach and its dead zone
const R_OUT = 170, R_IN = 84, GAP = 1.6;   // the ring (px) and the gap between slots (degrees)
const HELP_TIMES = 3;           // the help line under the name, the first times (per account, like the key tips)
const TIPS_KEY = 'pueblo-brotes:pistas';
const SWALLOW_MAX = 3000;       // ms: the longest the click that closed it is waited for (see swallow)
const SECTOR = 360 / HOTBAR;

const CSS = `
#wheel-vignette { position: fixed; inset: 0; z-index: 27; pointer-events: none; opacity: 0; visibility: hidden; transition: opacity .12s ease, visibility 0s linear .12s;
  background: radial-gradient(ellipse at center, rgba(6, 7, 9, 0) 38%, rgba(6, 7, 9, .42) 100%); }
#wheel-vignette.slow { background: radial-gradient(ellipse at center, rgba(6, 7, 9, 0) 30%, rgba(6, 7, 9, .66) 100%); }
#wheel-vignette.on { opacity: 1; visibility: visible; transition: opacity .12s ease, visibility 0s; }
#wheel { position: fixed; left: 50%; top: 50%; z-index: 28; width: ${R_OUT * 2 + 20}px; height: ${R_OUT * 2 + 20}px; margin: ${-(R_OUT + 10)}px 0 0 ${-(R_OUT + 10)}px; pointer-events: none;
  opacity: 0; visibility: hidden; transform: scale(.92); transition: opacity .12s ease, transform .12s ease, visibility 0s linear .12s; }
#wheel.on { opacity: 1; visibility: visible; transform: none; transition: opacity .12s ease, transform .12s ease-out, visibility 0s; }
#wheel svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
#wheel path { fill: var(--glass); stroke: var(--hair); stroke-width: 1; transition: transform .08s ease-out, fill var(--t-sel); }
#wheel path.on { fill: rgba(62, 68, 78, .82); stroke: #fff; stroke-width: 2.5; transform: scale(1.06); }
#wheel .ws { position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px; transition: transform .08s ease-out; }
#wheel .ws img { width: 100%; height: 100%; image-rendering: pixelated; filter: drop-shadow(0 2px 2px rgba(0, 0, 0, .55)); }
#wheel .ws img.hand { width: 32px; height: 32px; margin: 10px; opacity: .45; image-rendering: auto; filter: none; }
#wheel .ws b { position: absolute; right: 2px; bottom: 0; font: 600 16px/1 var(--font-ui); color: var(--ink); text-shadow: var(--shadow-text), 0 0 2px #000; }
#wheel .wn { position: absolute; left: 50%; top: 50%; width: 20px; margin: -9px 0 0 -10px; text-align: center; font: 500 13px/18px var(--font-title); color: var(--ink-2); }
#wheel .wn.on { color: #fff; }
#wheel-mid { position: absolute; left: 50%; top: 50%; width: ${R_IN * 2 - 14}px; height: ${R_IN * 2 - 14}px; margin: ${-(R_IN - 7)}px 0 0 ${-(R_IN - 7)}px; border-radius: 50%;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; padding: 0 14px; box-sizing: border-box; text-align: center;
  background: var(--glass-hi); box-shadow: inset 0 0 0 1px var(--hair); }
#wheel-name { font: 600 18px/1.1 var(--font-title); text-transform: uppercase; letter-spacing: .06em; color: var(--ink); }
#wheel-name.empty { color: var(--ink-2); }
#wheel-uses { display: flex; flex-direction: column; align-items: center; gap: 3px; font: 500 14px/1 var(--font-ui); color: var(--ink-2); }
#wheel-uses i { display: block; width: 70px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, .16); overflow: hidden; }
#wheel-uses i s { display: block; height: 100%; text-decoration: none; }
#wheel-uses em { font-style: normal; }
#wheel-uses em.none { color: #ff8a6a; }
#wheel-help { max-width: 128px; font: 500 12px/1.2 var(--font-ui); color: var(--ink-2); }
#wheel-dot { position: absolute; left: 50%; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 6px rgba(0, 0, 0, .6); opacity: .95; }
body.wheel-open, body.wheel-open * { cursor: none !important; }
body.wheel-open #crosshair, body.wheel-open #aim-free, body.wheel-open #hud-bow, body.wheel-open #prompt, body.wheel-open #hint, body.wheel-open #hud-item, body.wheel-open #hud-tip { visibility: hidden !important; }
`;

// An empty slot: an open hand, drawn once (light lines on transparent)
const HAND = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5V4a1.5 1.5 0 0 1 3 0v7.5M14 11.5V5.5a1.5 1.5 0 0 1 3 0V13M17 9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3.2 15.4a1.6 1.6 0 0 1 2.5-2l2.3 2.6"/></svg>')}`;

// Whether it can open now (and stay open): playing, not in build mode (its bar is another one), nor talking, nor in a long
// jump in the dark, nor as a spectator (who uses nothing), nor typing
export function canWheel(g) {
  return g.mode === 'play' && !!g.player && !g.busy && !hud.dialogOpen && !g.build?.on && !g.law?.cell && !g.jumping && g.gamemode !== 'spectator' &&
    !(document.activeElement instanceof HTMLInputElement) && !document.hidden;
}

// A ring sector from angle a0 to a1 (degrees, 0 up, clockwise), between the two radii, centred on 0,0
function sector(a0, a1, r0, r1) {
  const p = (a, r) => { const q = (a - 90) * Math.PI / 180; return `${(Math.cos(q) * r).toFixed(2)} ${(Math.sin(q) * r).toFixed(2)}`; };
  return `M${p(a0, r1)} A${r1} ${r1} 0 0 1 ${p(a1, r1)} L${p(a1, r0)} A${r0} ${r0} 0 0 0 ${p(a0, r0)} Z`;
}
const at = (i, r) => { const q = (i * SECTOR - 90) * Math.PI / 180; return [Math.cos(q) * r, Math.sin(q) * r]; };

export class ToolWheel {
  constructor(game) {
    this.game = game;
    this.isOpen = false;
    this.pressAt = null;   // when F went down (null: it is not held)
    this.sel = 0;          // the slot picked now
    this.sx = 0; this.sy = 0;   // the stick (px of mouse movement since it opened)
    const style = this.style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    const vig = this.vignette = document.createElement('div');
    vig.id = 'wheel-vignette';
    const el = this.el = document.createElement('div');
    el.id = 'wheel';
    el.setAttribute('aria-hidden', 'true');
    const c = R_OUT + 10, paths = [], slots = [], nums = [];
    for (let i = 0; i < HOTBAR; i++) {
      const a = i * SECTOR;
      paths.push(`<path d="${sector(a - SECTOR / 2 + GAP / 2, a + SECTOR / 2 - GAP / 2, R_IN, R_OUT)}"/>`);
      const [x, y] = at(i, (R_IN + R_OUT) / 2 - 4), [nx, ny] = at(i, R_OUT - 15);
      slots.push(`<div class="ws" style="transform: translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)" data-x="${x.toFixed(1)}" data-y="${y.toFixed(1)}"><img alt=""><b></b></div>`);
      nums.push(`<span class="wn" style="transform: translate(${nx.toFixed(1)}px, ${ny.toFixed(1)}px)">${i + 1}</span>`);
    }
    el.innerHTML = `<svg viewBox="${-c} ${-c} ${c * 2} ${c * 2}">${paths.join('')}</svg>${slots.join('')}${nums.join('')}` +
      '<div id="wheel-mid"><b id="wheel-name"></b><span id="wheel-uses"></span><small id="wheel-help"></small></div><i id="wheel-dot"></i>';
    document.body.append(vig, el);
    this.paths = [...el.querySelectorAll('path')];
    this.slots = [...el.querySelectorAll('.ws')];
    this.nums = [...el.querySelectorAll('.wn')];
    this.nameEl = el.querySelector('#wheel-name'); this.usesEl = el.querySelector('#wheel-uses'); this.helpEl = el.querySelector('#wheel-help'); this.dot = el.querySelector('#wheel-dot');
    // While open: the mouse is the wheel's (capture, on window: see above)
    let wheelAt = 0, lastX = null, lastY = null;
    const stop = e => { e.stopPropagation(); e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault(); };
    this.listeners = [
      ['pointermove', e => {
        stop(e);
        // (with the pointer captured, movementX/Y; without it, the same, and the position as a fallback)
        let dx = e.movementX, dy = e.movementY;
        if (!dx && !dy && lastX !== null) { dx = e.clientX - lastX; dy = e.clientY - lastY; }
        lastX = e.clientX; lastY = e.clientY;
        if (Math.abs(dx) < 300 && Math.abs(dy) < 300) this.move(dx, dy);   // (it sometimes jumps hugely: ignored, as input.js does)
      }],
      ['pointerdown', e => { stop(e); if (e.button !== 0 && e.button !== 2) return; this.swallowBtn = e.button; this.swallowUntil = performance.now() + SWALLOW_MAX; this.close(e.button === 0); }],
      ['wheel', e => { stop(e); if (e.ctrlKey || performance.now() - wheelAt < 60) return; wheelAt = performance.now(); this.step(e.deltaY > 0 ? 1 : -1); }],
      ...['pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'auxclick'].map(type => [type, stop]),
    ];
    this.reset = () => { lastX = lastY = null; };
    // The click that closed it still has its pointerup and click to come, however long the button is held: they are
    // swallowed too, or they would land on the window under the cursor (a slot of the inventory, its drop or eat button)
    // or use the tool just equipped. By button, to the end of that click: the left one's click, the right one's mouseup
    // (its contextmenu, which may come before or after, goes too). SWALLOW_MAX or a new press, in case the end never comes
    // (let go outside the window). (And the pointerup would have let go of the use button: it was never pressed, as the
    // pointerdown did not get through)
    this.swallow = ['pointerdown', 'pointerup', 'mouseup', 'click', 'contextmenu', 'auxclick'].map(type => [type, e => {
      if (this.swallowBtn === null) return;
      if (type === 'pointerdown' || performance.now() > this.swallowUntil) { if (!this.isOpen) this.swallowBtn = null; return; }
      if (e.button !== this.swallowBtn && type !== 'contextmenu') return;
      stop(e);
      if (type === 'pointerup') keys.use = false;
      if (type === 'click' || type === 'auxclick' || (type === 'mouseup' && e.button === 2)) this.swallowBtn = null;
    }]);
    this.swallowBtn = null; this.swallowUntil = 0;
    for (const [type, fn] of this.swallow) addEventListener(type, fn, true);
    this.onHide = () => { if (document.hidden) this.cancel(true); };
    document.addEventListener('visibilitychange', this.onHide);
    this.offLang = onLangChange(() => { if (this.isOpen) this.paint(true); });
  }
  get open() { return this.isOpen; }

  // ---------- F ----------
  // F down: nothing shows yet (as in GTA); held HOLD_MS, it opens (here or in frame, whichever comes first)
  press() {
    if (this.pressAt !== null || this.isOpen || !canWheel(this.game)) return false;
    this.pressAt = performance.now();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; if (this.pressAt !== null && !this.isOpen) { if (canWheel(this.game)) this.show(); else this.pressAt = null; } }, HOLD_MS);
    return true;
  }
  // F up: equip what is picked or, if it had not opened yet, the tap (back to the one before)
  release() {
    if (this.isOpen) { this.close(true); return; }
    if (this.pressAt === null) return;
    this.pressAt = null;
    clearTimeout(this.timer); this.timer = null;
    if (canWheel(this.game)) this.game.inv.back();
  }

  show() {
    const g = this.game, inv = g.inv;
    this.pressAt = null; clearTimeout(this.timer); this.timer = null;
    this.isOpen = true;
    this.sx = this.sy = 0; this.reset();
    this.sel = inv.selected; this.marked = -1;
    // (what was being used stops: with the click held you would keep chopping in slow motion, or use the new tool as soon
    // as it is in hand; the bow lets go without shooting)
    keys.use = false;
    g.archery?.cancel?.();
    for (const [type, fn] of this.listeners) addEventListener(type, fn, { capture: true, passive: false });
    this.helpOn = this.helpShown() < HELP_TIMES;
    if (this.helpOn) this.helpCount();
    this.paint(true);
    this.solo = null; this.frame();
    document.body.classList.add('wheel-open');
    this.el.classList.add('on'); this.vignette.classList.add('on');
  }
  // commit: equip the slot picked (if it is another one); otherwise everything stays as it was
  close(commit) {
    if (!this.isOpen) { this.pressAt = null; clearTimeout(this.timer); this.timer = null; return; }
    this.isOpen = false;
    for (const [type, fn] of this.listeners) removeEventListener(type, fn, { capture: true });
    document.body.classList.remove('wheel-open');
    this.el.classList.remove('on'); this.vignette.classList.remove('on');
    keys.use = false;
    const inv = this.game.inv;
    if (commit && this.sel !== inv.selected) inv.select(this.sel, true);
  }
  // Closed without equipping. hard: the window lost the focus or the tab hid: the game at full speed at once
  cancel(hard = false) {
    this.close(false);
    if (hard) { this.game.timeScale = this.game.timeScaleTarget = 1; }
  }
  // A digit with it open: that slot, and it closes
  pick(i) {
    if (!this.isOpen) return;
    this.sel = i;
    this.close(true);
  }

  // ---------- picking ----------
  // The mouse moved: the stick goes with it, up to STICK; past the dead zone its direction picks the slot (the one
  // picked stays when it comes back to the middle)
  move(dx, dy) {
    if (!this.isOpen) return;
    let x = this.sx + dx, y = this.sy + dy;
    const len = Math.hypot(x, y);
    if (len > STICK) { x *= STICK / len; y *= STICK / len; }
    this.sx = x; this.sy = y;
    if (Math.hypot(x, y) > DEAD) {
      const a = (Math.atan2(y, x) * 180 / Math.PI + 90 + 360) % 360;
      this.sel = Math.round(a / SECTOR) % HOTBAR;
    }
    this.mark();
  }
  // The mouse wheel: one slot more or less, and the stick back to the middle
  step(d) {
    if (!this.isOpen) return;
    this.sel = (this.sel + d + HOTBAR) % HOTBAR;
    this.sx = this.sy = 0;
    this.mark();
  }
  // The slot picked lit, its name in the middle, and the dot on the inner rim, toward where the stick points (only past
  // the dead zone: in the middle it would sit on the name)
  mark() {
    const len = Math.hypot(this.sx, this.sy), out = len > DEAD, k = out ? (R_IN - 9) / len : 0;
    this.dot.style.transform = `translate(${(this.sx * k).toFixed(1)}px, ${(this.sy * k).toFixed(1)}px)`;
    this.dot.style.opacity = out ? '' : '0';
    if (this.sel === this.marked) return;
    const was = this.marked;
    this.marked = this.sel;
    if (was >= 0) {
      this.paths[was].classList.remove('on'); this.nums[was].classList.remove('on');
      const w = this.slots[was]; w.style.transform = `translate(${w.dataset.x}px, ${w.dataset.y}px)`;
    }
    const s = this.slots[this.sel];
    this.paths[this.sel].classList.add('on'); this.nums[this.sel].classList.add('on');
    s.style.transform = `translate(${(s.dataset.x * 1.06).toFixed(1)}px, ${(s.dataset.y * 1.06).toFixed(1)}px) scale(1.1)`;
    this.paintMid();
  }

  // ---------- the page ----------
  // The nine slots (when it opens and when the hotbar changes while open)
  paint(force = false) {
    const inv = this.game.inv;
    if (!force && inv.v === this.v) return;
    this.v = inv.v;
    for (let i = 0; i < HOTBAR; i++) {
      const s = inv.slots[i], el = this.slots[i], img = el.firstChild, n = el.lastChild;
      const url = s ? itemIconUrl(s.id, s.color) : HAND;
      if (img.getAttribute('src') !== url) img.src = url;
      img.classList.toggle('hand', !s);
      n.textContent = s && s.n > 1 ? String(s.n) : '';
    }
    // (everything unlit, the number and the icon too: the slot lit when it last closed stayed gold and big)
    for (let i = 0; i < HOTBAR; i++) {
      const w = this.slots[i];
      this.paths[i].classList.remove('on'); this.nums[i].classList.remove('on');
      w.style.transform = `translate(${w.dataset.x}px, ${w.dataset.y}px)`;
    }
    this.marked = -1;
    this.mark();
  }
  // The middle: the name of what is picked, its uses left (the bar as in the inventory, green to red), the arrows left
  // with the bow, and the help line the first times
  paintMid() {
    const g = this.game, s = g.inv.slots[this.sel], def = s && ITEMS[s.id];
    this.nameEl.textContent = def ? def.name : t('hud.wheel.hands');
    this.nameEl.classList.toggle('empty', !def);
    let uses = '';
    if (def?.dur) {
      const left = s.dur ?? def.dur, k = Math.max(0, Math.min(1, left / def.dur));
      uses += `<i><s style="width: ${Math.max(4, k * 100).toFixed(0)}%; background: hsl(${Math.round(k * 120)}, 75%, 50%)"></s></i><em>${t('hud.wheel.uses', { left, max: def.dur })}</em>`;
    }
    if (def?.bow) {
      const n = g.archery.arrows();
      uses += `<em class="${n ? '' : 'none'}">${n === Infinity ? '∞' : t('hud.wheel.arrows', { n })}</em>`;
    }
    this.usesEl.innerHTML = uses;
    this.helpEl.textContent = this.helpOn ? t('hud.wheel.help') : '';
  }

  // ---------- each frame (game.render) ----------
  // It opens when F has been held long enough (if the timer is late), closes when it can no longer be used, and darkens
  // the edges more when the game is in slow motion (alone)
  frame() {
    const g = this.game;
    if (this.pressAt !== null && !this.isOpen) {
      if (!canWheel(g)) { this.pressAt = null; clearTimeout(this.timer); this.timer = null; }
      else if (performance.now() - this.pressAt >= HOLD_MS) this.show();
    }
    if (!this.isOpen) return;
    if (!canWheel(g)) { this.cancel(document.hidden); return; }
    this.paint();
    const solo = !!g.live?.aloneInWorld;
    if (solo !== this.solo) { this.solo = solo; this.vignette.classList.toggle('slow', solo); }
  }

  // ---------- the help line, the first times (shared with the key tips of the minimal interface) ----------
  helpShown() {
    const sh = this.game.smartHud;
    let seen;
    if (sh?.seen) seen = sh.seen;
    else try { seen = new Set((JSON.parse(localStorage.getItem(TIPS_KEY) || '{}') || {})[Profile.id || '-'] || []); } catch { seen = new Set(); }
    let n = 0;
    while (n < HELP_TIMES && seen.has('wheel' + n)) n++;
    return n;
  }
  helpCount() {
    const id = 'wheel' + this.helpShown(), sh = this.game.smartHud;
    if (sh?.seen) { sh.seen.add(id); sh.saveSeen(); return; }
    try {
      const all = JSON.parse(localStorage.getItem(TIPS_KEY) || '{}') || {}, k = Profile.id || '-';
      all[k] = [...new Set([...(all[k] || []), id])];
      localStorage.setItem(TIPS_KEY, JSON.stringify(all));
    } catch { /* (no storage: it may show again next time) */ }
  }

  destroy() {
    this.close(false);
    for (const [type, fn] of this.swallow) removeEventListener(type, fn, true);
    document.removeEventListener('visibilitychange', this.onHide);
    this.offLang?.();
    this.el.remove(); this.vignette.remove(); this.style.remove();
  }
}
