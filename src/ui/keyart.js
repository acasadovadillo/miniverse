// The picture behind the login, the main menu, its settings and credits and the creator (docs/planes/realismo/PLAN-R9-menus.md
// §3.3): a still of the village, by the real season (the calendar of time.js, in Madrid) and, from 21:00 to 6:00, at night, that
// drifts slowly to the left. One picture, one CSS transform (the compositor moves it: nothing runs per frame), still with the
// menus' reduced motion, with the page hidden, after five minutes without touching anything and while playing.
// KEY_ART: the picture of each season and of the night, and its grade (a colour over it, blended once, not per frame). For now
// all share today's photo; R9-5 brings one for each, without a grade.
// ?menuart=spring|summer|autumn|winter (and, or only, night: winter-night) to look at one
import { madridMs, seasonOf } from '../time.js';
import { opcion } from '../opciones.js';

const PHOTO = 'assets/fondo-menu.jpg', HOUR_MS = 3600000, DAY_MS = 24 * HOUR_MS;
export const SEASON_IDS = ['spring', 'summer', 'autumn', 'winter'];   // (time.js, in order)
export const KEY_ART = {
  spring: { src: PHOTO, grade: ['soft-light', 'linear-gradient(120deg, rgba(150, 220, 150, .3), rgba(255, 226, 236, .28))'] },
  summer: { src: PHOTO, grade: ['soft-light', 'linear-gradient(115deg, rgba(255, 176, 60, .2), rgba(255, 206, 110, .55))'] },
  autumn: { src: PHOTO, grade: ['multiply', 'linear-gradient(115deg, rgba(150, 84, 52, .55), rgba(255, 178, 104, .8))'] },
  winter: { src: PHOTO, grade: ['soft-light', 'linear-gradient(120deg, rgba(96, 140, 214, .5), rgba(226, 238, 255, .7))', 'saturation', 'linear-gradient(rgba(128, 128, 128, .7), rgba(128, 128, 128, .7))'] },
  night: { src: PHOTO, grade: ['multiply', 'linear-gradient(115deg, rgba(20, 30, 62, .94), rgba(64, 80, 138, .9))'] },
};
const NIGHT = [21, 6], IDLE_MS = 5 * 60000, LOOK_EVERY = 10 * 60000;

// { season: 0-3, night } now, or the one asked for
export function artNow(now = Date.now(), asked = opcion('menuart')) {
  const ms = madridMs(now), hour = (ms % DAY_MS) / HOUR_MS, forced = SEASON_IDS.findIndex(s => asked?.includes(s));
  return { season: forced >= 0 ? forced : seasonOf(Math.floor(ms / DAY_MS)).season, night: asked ? asked.includes('night') : hour >= NIGHT[0] || hour < NIGHT[1] };
}
export const artOf = ({ season, night }) => (night ? 'night' : SEASON_IDS[season]);

const KeyArt = {
  on: false, shown: null, idleTimer: 0, lookTimer: 0, touchedAt: 0,
  get el() { return document.getElementById('fe-art'); },
  start() {
    if (this.on || !this.el) return;
    this.on = true;
    this.paint();
    this.lookTimer = setInterval(() => this.paint(), LOOK_EVERY);   // (left open past dusk)
    for (const ev of TOUCH) addEventListener(ev, touched, { passive: true });
    document.addEventListener('visibilitychange', seen);
    this.el.classList.add('pan');
    seen();
    this.wake();
  },
  stop() {
    if (!this.on) return;
    this.on = false;
    clearInterval(this.lookTimer); clearTimeout(this.idleTimer);
    for (const ev of TOUCH) removeEventListener(ev, touched);
    document.removeEventListener('visibilitychange', seen);
    this.el.classList.remove('pan', 'idle');
  },
  paint() {
    const id = artOf(artNow());
    if (id === this.shown) return;
    this.shown = id;
    const { src, grade } = KEY_ART[id], img = this.el.firstElementChild;
    img.style.backgroundImage = [...grade.filter((_, i) => i % 2), `url(${src})`].join(', ');
    img.style.backgroundBlendMode = [...grade.filter((_, i) => i % 2 === 0), 'normal'].join(', ');
    this.el.dataset.art = id;
  },
  wake() {
    this.touchedAt = performance.now();
    this.el.classList.remove('idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.el.classList.add('idle'), IDLE_MS);
  },
};
const TOUCH = ['pointermove', 'pointerdown', 'keydown'];
const touched = () => { if (performance.now() - KeyArt.touchedAt > 1000) KeyArt.wake(); };
const seen = () => KeyArt.el.classList.toggle('away', document.hidden);
export { KeyArt };
