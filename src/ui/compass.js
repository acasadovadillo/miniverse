// The compass strip (docs/planes/realismo/PLAN-R8-hud-mapa.md §3.3, the minimap's mode 'compass'): a slim band at the top with the
// bearings, the camera's in the middle, and what you follow (the tracked blips: the route's end, where a first step sends you, your
// partner…) as a mark with its distance, held at the end of the band while it is farther round. It shows by the same rules as the
// minimap, and indoors and in caves too. Like it, it draws nothing per frame: the band is painted once (and again in another
// language) and slid by CSS, and so are the marks, with strings made beforehand.
import { nearX } from '../world/planet.js';
import { CAM } from '../camera.js';
import { t, fmt } from '../i18n.js';
import { blips } from './blips.js';
import { svg } from './mapglyphs.js';

const W = 380, H = 28, PX = 2.5, MARKS = 6, EVERY = 0.25, EDGE = W / 2 - 14;   // (px; px per degree; marks at most; s between looks at them)
const TURN = 360 * PX, slides = new Array(TURN * 2 + W * 2);
const slideX = x => { const n = Math.round(x * 2), i = n + TURN * 2; return (slides[i] ??= `${n / 2}px 0px`); };
// A distance as the HUD says it: 640 m, 1.2 km
export const distText = d => (d < 1000 ? t('minimap.dist', { n: Math.round(d) }) : t('minimap.dist_km', { n: fmt.num(d / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }));
const CSS = `
#hud-compass { position: fixed; left: 50%; top: 14px; z-index: 4; width: ${W}px; height: ${H}px; margin-left: ${-W / 2}px; pointer-events: none; display: none; }
body.playing.mini-compass #hud-compass { display: block; }
#hud-compass .hc-clip { position: absolute; inset: 0; overflow: hidden; border-radius: 6px; background: var(--glass); box-shadow: inset 0 0 0 1px var(--hair), 0 2px 8px rgba(0, 0, 0, .25); -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 9%, #000 91%, transparent 100%); mask-image: linear-gradient(90deg, transparent 0, #000 9%, #000 91%, transparent 100%); }
#hud-compass canvas { position: absolute; left: 0; top: 0; will-change: translate; }
#hud-compass .hc-me { position: absolute; left: 50%; bottom: -1px; width: 0; height: 0; margin-left: -6px; border: 6px solid transparent; border-top: 0; border-bottom: 7px solid #fff; filter: drop-shadow(0 0 1px #000); }
#hud-compass .hc-mark { position: absolute; left: 50%; top: 4px; width: 20px; margin-left: -10px; visibility: hidden; will-change: translate; }
#hud-compass .hc-mark.on { visibility: visible; }
#hud-compass .hc-mark i { display: block; width: 20px; height: 20px; border-radius: 50%; background: rgba(12, 15, 20, .92); box-shadow: inset 0 0 0 1.5px currentColor; }
#hud-compass .hc-mark svg { display: block; width: 13px; height: 13px; padding: 3.5px; box-sizing: content-box; }
#hud-compass .hc-mark b { position: absolute; left: 50%; top: ${H}px; transform: translateX(-50%); font: 600 13px/16px var(--font-ui); font-variant-numeric: tabular-nums; color: var(--ink); text-shadow: var(--shadow-bare); white-space: nowrap; }
`;

export class Compass {
  constructor(game, mini) {
    this.game = game; this.mini = mini;
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.append(this.style);
    const el = this.el = document.createElement('div');
    el.id = 'hud-compass';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="hc-clip"><canvas></canvas></div><i class="hc-me"></i>';
    document.body.append(el);
    this.tape = el.querySelector('canvas');
    this.marks = Array.from({ length: MARKS }, (_, j) => { const m = document.createElement('div'); m.className = 'hc-mark'; m.innerHTML = '<i></i><b></b>'; m.style.zIndex = MARKS - j; el.append(m); return { el: m, i: m.firstChild, b: m.lastChild, on: false, key: '', text: '', at: '', brg: 0, x: 0 }; });
    this.n = 0; this.at = -Infinity; this.hAt = ''; this.painted = '';
  }
  texts() { this.painted = ''; this.at = -Infinity; }
  // The band: the bearings twice over at its ends, so that any one can be in the middle
  paint() {
    const k = Math.max(1, Math.min(2, devicePixelRatio || 1)), key = `${t('minimap.heading.n')}${t('minimap.heading.w')}${k}${this.fonts()}`;
    if (key === this.painted) return;
    this.painted = key;
    const w = TURN + W, c = this.tape, g = c.getContext('2d');
    c.width = w * k; c.height = H * k; c.style.width = `${w}px`; c.style.height = `${H}px`;
    g.scale(k, k);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const from = Math.ceil(-W / 2 / PX / 15) * 15;
    for (let d = from; d <= 360 + W / 2 / PX; d += 15) {
      const x = Math.round(W / 2 + d * PX) + 0.5, q = ((d % 360) + 360) % 360, card = q % 90 === 0, half = q % 45 === 0;
      if (half) {
        g.font = card ? '600 17px Oswald, Barlow, sans-serif' : '600 12px Barlow, sans-serif';
        g.lineWidth = 3; g.lineJoin = 'round'; g.strokeStyle = 'rgba(0, 0, 0, .55)'; g.fillStyle = card ? '#ffffff' : 'rgba(255, 255, 255, .72)';
        const s = t(`minimap.heading.${['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'][q / 45]}`);
        g.strokeText(s, x, H / 2 - 1); g.fillText(s, x, H / 2 - 1);
      } else { g.fillStyle = 'rgba(255, 255, 255, .6)'; g.fillRect(x - 0.75, H / 2 - 5, 1.5, 10); }
    }
  }
  fonts() { return document.fonts?.check?.('600 17px Oswald') ? 1 : 0; }
  // Each frame: on (it is in sight)
  frame(now, on) {
    if (on !== this.on) { this.on = on; this.at = -Infinity; }
    if (!on) return;
    if (now - this.at >= EVERY) { this.at = now; this.paint(); this.look(now); }
    const h = this.mini.heading, at = slideX(-h * PX);
    if (at === this.hAt && !this.moved) return;
    if (at !== this.hAt) { this.hAt = at; this.tape.style.translate = at; }
    this.moved = false;
    for (let i = 0; i < this.n; i++) {
      const m = this.marks[i];
      const s = slideX(this.xOf(m.brg, h));
      if (s !== m.at) { m.at = s; m.el.style.translate = s; }
    }
  }
  // Where a bearing falls on the band, from its middle (held at its ends), looking toward h
  xOf(brg, h) { return Math.max(-EDGE, Math.min(EDGE, (((brg - h) % 360 + 540) % 360 - 180) * PX)); }
  // What is followed, four times a second: which, where and how far. Under two that fall together, only the first's distance
  look(now) {
    const g = this.game, p = g.player, R = g.route, out = g.scene === g.world, h = this.mini.heading;
    let n = 0;
    if (out) for (const b of blips.refresh(g, now)) {
      if (n >= MARKS || !b.track || b.r || !blips.shown(b) || (b.pin === 'route' && !R?.active)) continue;
      const dx = nearX(b.x, p.x) - p.x, dy = b.y - p.y, m = this.marks[n++], key = b.glyph + b.color;
      m.brg = Math.atan2(dx, -dy) * 180 / Math.PI;
      if (key !== m.key) { m.key = key; m.i.innerHTML = svg(b.glyph, b.color); m.i.style.color = b.color; }
      m.x = this.xOf(m.brg, h);
      let near = false;
      for (let i = 0; i < n - 1; i++) near ||= Math.abs(this.marks[i].x - m.x) < 46;
      const d = b.pin === 'route' ? R.left() : Math.hypot(dx, dy), text = near ? '' : distText(d);
      if (text !== m.text) { m.text = text; m.b.textContent = text; }
    }
    this.n = n; this.moved = true;
    this.marks.forEach((m, i) => { if (m.on !== i < n) { m.on = i < n; m.el.classList.toggle('on', m.on); } });
  }
}
