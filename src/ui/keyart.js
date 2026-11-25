// The picture behind the login, the main menu, its settings and credits and the creator (docs/planes/realismo/PLAN-R9-menus.md
// §3.3): a still of the village, by the real season (the calendar of time.js, in Madrid) and, from 21:00 to 6:00, at night, that
// drifts slowly to the left. One picture, one CSS transform (the compositor moves it: nothing runs per frame), still with the
// menus' reduced motion, with the page hidden, after five minutes without touching anything and while playing.
// KEY_ART: the six pictures, taken in the game itself (assets/menu/, assets/LICENCIAS.md). While loading (ui/loading.js) there is
// another one: of this season, of the night or the one of no season (rider), in turns. No more than two are ever asked for at once:
// the menu's and, with it in sight and a moment to spare, the next loading's.
// ?menuart=spring|summer|autumn|winter|rider (and, or only, night: winter-night) to look at one
import { madridMs, seasonOf } from '../time.js';
import { opcion } from '../opciones.js';

const HOUR_MS = 3600000, DAY_MS = 24 * HOUR_MS;
export const SEASON_IDS = ['spring', 'summer', 'autumn', 'winter'];   // (time.js, in order)
// (pos: which part stays in sight on a screen of another shape. The file's name carries its hash: a new picture, a new name)
export const KEY_ART = {
  spring: { src: 'assets/menu/spring.aa6fd6c9.jpg', pos: '50% 50%' },
  summer: { src: 'assets/menu/summer.c2c8b68c.jpg', pos: '90% 50%' },
  autumn: { src: 'assets/menu/autumn.75345360.jpg', pos: '50% 50%' },
  winter: { src: 'assets/menu/winter.c89d488e.jpg', pos: '50% 50%' },
  night: { src: 'assets/menu/night.22e17836.jpg', pos: '50% 50%' },
  rider: { src: 'assets/menu/rider.892740e8.jpg', pos: '50% 50%' },   // (of no season: only while loading)
};
const NIGHT = [21, 6], IDLE_MS = 5 * 60000, LOOK_EVERY = 10 * 60000;

// { season: 0-3, night } now, or the one asked for
export function artNow(now = Date.now(), asked = opcion('menuart')) {
  const ms = madridMs(now), hour = (ms % DAY_MS) / HOUR_MS, forced = SEASON_IDS.findIndex(s => asked?.includes(s));
  return { season: forced >= 0 ? forced : seasonOf(Math.floor(ms / DAY_MS)).season, night: asked ? asked.includes('night') : hour >= NIGHT[0] || hour < NIGHT[1], rider: !!asked?.includes('rider') };
}
export const artOf = ({ season, night, rider }) => (rider ? 'rider' : night ? 'night' : SEASON_IDS[season]);
// The pictures of a loading screen with that one in the menu
export const loadSet = (now, menu) => [...new Set([SEASON_IDS[now.season], 'rider', 'night'])].filter(id => id !== menu);

const KeyArt = {
  on: false, shown: null, load: null, turn: Math.floor(Math.random() * 6), asked: null, kept: null, idleTimer: 0, lookTimer: 0, touchedAt: 0,
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
    put(this.el.firstElementChild, id);
    this.el.dataset.art = id;
    if (this.el.classList.contains('in')) return;
    // (the first one fades in when it is there, or after a while, as it is)
    const im = new Image(), go = () => this.el.classList.add('in');
    im.src = KEY_ART[id].src;
    im.decode().then(go, go);
    setTimeout(go, 4000);
  },
  // ---------- the loading screen's ----------
  // Which is next (it stays until it is shown, unless the menu's has become that one)
  next() {
    const set = loadSet(artNow(), this.shown);
    if (!set.includes(this.load)) this.load = set[this.turn % set.length];
    return this.load;
  },
  // Asked for beforehand, in a spare moment
  preload() {
    const id = this.next();
    if (this.asked === id) return;
    this.asked = id;
    soon(() => { const im = this.kept = new Image(); im.src = KEY_ART[id].src; im.decode?.().catch(() => {}); });
  },
  paintLoad(el) {
    const id = this.next();
    put(el, id);
    el.dataset.art = id;
    this.load = this.kept = this.asked = null; this.turn++;
  },
  wake() {
    this.touchedAt = performance.now();
    this.el.classList.remove('idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.el.classList.add('idle'), IDLE_MS);
  },
};
function put(el, id) { el.style.backgroundImage = `url(${KEY_ART[id].src})`; el.style.backgroundPosition = KEY_ART[id].pos; }
const soon = globalThis.requestIdleCallback ? fn => requestIdleCallback(fn, { timeout: 3000 }) : fn => setTimeout(fn, 800);
const TOUCH = ['pointermove', 'pointerdown', 'keydown'];
const touched = () => { if (performance.now() - KeyArt.touchedAt > 1000) KeyArt.wake(); };
const seen = () => KeyArt.el.classList.toggle('away', document.hidden);
export { KeyArt };
