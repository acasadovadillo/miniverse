// The body chip (#body-chip, markup and CSS in index.html): one small pill right under the status bars at the top left
// (under the rows in sight, in the corner column: the CSS places it from --nd-end, and moves the clock under it) that says
// what the weather or the work is doing to you ("Cold", "Freezing", "Hot", "Soaked", "Filthy", "Shirt: torn"). Design:
// docs/planes/gta/PLAN-E-cuerpo-aspecto.md §7.1. No icon: a 3 px edge in the chip's colour.
//
// Minimal HUD (game.smartHud), the rules of §7.1, one chip at a time in this order:
//   Cold / Freezing  cold ≥ 0.35 / ≥ 0.7 (it changes stats): while it holds, and 2 s after it drops below 0.3
//   Hot              heat ≥ 0.35: while it holds, and 2 s after it drops below 0.3
//   Soaked           wet ≥ 70 and cold ≥ 0.15 (the wet is making you colder): while both hold
//   Filthy           the first time in a session dirt reaches 70: 4 s
//   Worn / Torn      a garment reaches a new stage (body.chip() says which, with its name): 4 s, once each
// A one-time chip that comes while a stronger one shows waits for it (for a minute at most; Filthy only while you are
// still dirty). Cold and heat count only while they change the stats (body.weatherOn: survival, not peaceful, not
// /gamerule doBodyWeather false, not ?frio=0). In a dialogue the chip steps aside, as the other parts do.
// Full HUD: the same chips, and Cold or Hot also whenever the stress is above 0 at all.
// Both HUDs: holding Tab (and in the full HUD, the mouse over the bars, where their legend shows) adds the felt
// temperature: "Cold · feels 4 °C", or just "Feels 18 °C" when nothing is wrong (not with ?frio=0).
//
// Contract:
//   menus.js makes it once (game.bodyChip = new BodyChip(game)) and calls frame() every frame (game.onFrame), for both
//   HUDs. It reads only Body's contract fields (src/body.js: cold, heat, wet, dirt, feelC, weatherOn, counts, off) and
//   body.chip() for the garment chips (worn, torn: all it gives). Every other chip is decided only here, from the fields.
//   Read by ui/smarthud.js for the one-time tips: bodyChip.id (the chip in sight now, null: none; never 'feels') and
//   bodyChip.cond { cold, hot, soaked, dirty } (whether each condition still holds, to end its tip early).
//   BodyChip is the ONLY writer of the text and of the classes on, bc-<id> of #body-chip and of the class bc-on of #needs
//   (windows.js adds under-win to #body-chip while a window lies over it, as to the clock). NeedsBar keeps #nd-legend
//   and #nd-tag, right of the bars: the chip, under them, never meets them.
//
// Nothing here reads the DOM each frame: a few numbers are compared and the page is written only when the answer changes.
import { t, onLangChange } from '../i18n.js';
import { hud } from './hud.js';

// The order the chips win in (the first that holds shows); the colour of each is the CSS class bc-<id>
export const CHIP_ORDER = ['freezing', 'cold', 'hot', 'soaked', 'filthy', 'worn', 'torn'];
// Thresholds (stresses 0..1, channels 0..100) and times (seconds)
export const CHIP = {
  coldOn: 0.35, coldOff: 0.3, freezeOn: 0.7, freezeOff: 0.65,
  hotOn: 0.35, hotOff: 0.3,
  soakWet: 70, soakWetOff: 65, soakCold: 0.15, soakColdOff: 0.12,
  filthy: 70, filthyForget: 60, dirty: 25,
  fullMin: 0.01,          // (full HUD: a stress this small is noise, not news)
  linger: 2, once: 4, wait: 60,
};
const ONCE = new Set(['worn', 'torn']);   // (the ids body.chip() gives that this file shows once each)
const now = () => performance.now() / 1000;
// "−3", not "-3"; "0", never "−0"
const deg = n => (n < 0 ? `−${-n}` : String(n));   // (n: whole degrees)

export class BodyChip {
  constructor(game) {
    this.game = game;
    this.id = null;                // the chip in sight (null: none, or only the felt temperature)
    this.cond = { cold: false, hot: false, soaked: false, dirty: false };
    this.el = null; this.box = null;   // #body-chip and #needs, found on the first frame (an old page may lack them)
    this.tabHeld = false;          // (Tab in the full HUD: the minimal one has its own, smartHud.on.all)
    this.reset();
    this.offLang = onLangChange(() => { this.kLang = true; });   // (the text again, in the new language)
    const key = (e, on) => { if (e.code === 'Tab' && !(e.target instanceof HTMLInputElement)) this.tabHeld = on; };
    addEventListener('keydown', e => key(e, true), true);
    addEventListener('keyup', e => key(e, false), true);
    addEventListener('blur', () => { this.tabHeld = false; });
  }

  // A new game (a new player object): what was shown once is news again; nothing left over
  reset() {
    this.player = null;   // (frame() sets it right after)
    this.freezing = false; this.cold = false; this.hot = false; this.soaked = false;
    this.coldLast = null; this.coldUntil = 0; this.hotUntil = 0;
    this.seen = new Set();         // the one-time chips already shown (or queued) this session
    this.queue = [];               // [{ id, text (null: the chip's own word), at, until }] one-time chips waiting for their turn
    this.id = null; this.text = '';
    this.kId = undefined; this.kOwn = undefined; this.kFeels = undefined; this.kN = undefined; this.kLang = false;
    for (const k in this.cond) this.cond[k] = false;
    this.sig = ''; this.cls = ''; this.onNow = false;
  }

  // ---------- each frame (menus.js, game.onFrame) ----------
  frame(T = now()) {
    const g = this.game, p = g.player, b = g.body;
    if (!this.el) {   // (a page without it, such as an old test page: looked for again every 2 s)
      if (T < (this.findAt || 0)) return;
      if (!this.find()) { this.findAt = T + 2; return; }
    }
    if (p !== this.player) { this.reset(); this.player = p; }
    // (no player, creative, spectator, the world server: nothing to say)
    if (!p || !b || !b.counts) { this.id = null; for (const k in this.cond) this.cond[k] = false; this.paint(null, '', false); return; }
    if (g.mode !== 'play') return;   // (a full-screen window, the mirror, the pause: as it was, until play goes on)
    const sh = g.smartHud, min = !!sh;
    const weather = !!b.weatherOn;
    const cold = weather ? num(b.cold) : 0, heat = weather ? num(b.heat) : 0;
    const wet = num(b.wet), dirt = num(b.dirt);

    // What holds now (with a little hysteresis, so a value sitting on a threshold does not flicker)
    const C = CHIP;
    const wasCold = this.cold;
    this.freezing = cold >= C.freezeOn || (this.freezing && cold >= C.freezeOff);
    this.cold = this.freezing || cold >= C.coldOn || (this.cold && cold >= C.coldOff);
    const wasHot = this.hot;
    this.hot = heat >= C.hotOn || (wasHot && heat >= C.hotOff);
    this.soaked = (wet >= C.soakWet && cold >= C.soakCold) || (this.soaked && wet >= C.soakWetOff && cold >= C.soakColdOff);
    // (cold or heat gone: its chip stays 2 s more, as it was)
    if (this.cold) this.coldLast = this.freezing ? 'freezing' : 'cold';
    else if (wasCold) this.coldUntil = T + C.linger;
    if (!this.hot && wasHot) this.hotUntil = T + C.linger;
    const cd = this.cond;
    cd.cold = this.cold; cd.hot = this.hot; cd.soaked = this.soaked; cd.dirty = dirt >= C.dirty;

    // The one-time chips: filthy (the first time this session), and a garment's new stage from Body
    if (dirt >= C.filthy && !this.seen.has('filthy')) this.enqueue('filthy', null, T);   // (its text from its id, in the language of the moment)
    const ext = typeof b.chip === 'function' ? b.chip() : null;
    if (ext && ONCE.has(ext.id) && ext.text) this.enqueue(ext.id, String(ext.text), T, `${ext.id}|${ext.text}`);
    // (waiting too long, shown long enough, or filthy no more before its turn: gone)
    while (this.queue.length) {
      const q = this.queue[0];
      const stale = q.until ? T >= q.until : T - q.at > C.wait || (q.id === 'filthy' && dirt < C.filthyForget);
      if (!stale) break;
      this.queue.shift();
    }

    // The one in sight, by the order
    let id = this.freezing ? 'freezing' : this.cold ? 'cold' : T < this.coldUntil ? this.coldLast : null;
    if (!id) id = this.hot || T < this.hotUntil ? 'hot' : this.soaked ? 'soaked' : null;
    let own = null;   // (a one-time chip's own text: a garment's name)
    if (!id && this.queue.length) {
      const q = this.queue[0];
      q.until ||= T + C.once;   // (its 4 s start when it is first in sight)
      id = q.id; own = q.text;
    }
    // (the full HUD: cold or heat whenever there is any)
    if (!id && !min && weather) id = cold >= C.freezeOn ? 'freezing' : cold >= C.fullMin ? 'cold' : heat >= C.fullMin ? 'hot' : null;

    // In a dialogue the minimal HUD shows only what is critical: the chip steps aside
    const talking = min && (g.busy || hud.dialogOpen);
    // Tab (or, in the full HUD, the mouse over the bars): the felt temperature too
    const feels = !talking && !b.off?.cold && Number.isFinite(b.feelC) && (min ? !!sh.on?.all : this.tabHeld || !!g.needsBar?.hover);
    if (talking) id = null;
    this.id = id;
    // The text, made again only when what it says changes (the felt temperature in whole degrees)
    const n = feels ? Math.round(b.feelC) : 0;
    if (id !== this.kId || own !== this.kOwn || feels !== this.kFeels || n !== this.kN || this.kLang) {
      this.kId = id; this.kOwn = own; this.kFeels = feels; this.kN = n; this.kLang = false;
      const state = own || (id ? t('body.chip.' + id) : '');
      this.text = !feels ? state : id ? t('body.chip.feels', { state, c: deg(n) }) : t('journal.body.feels', { c: deg(n) });
    }
    this.paint(id || (feels ? 'none' : null), this.text, !!(id || feels));
  }

  // ---------- inside ----------
  find() {
    const el = document.getElementById('body-chip'), box = document.getElementById('needs');
    if (!el || !box) return false;
    this.el = el; this.box = box;
    return true;
  }
  // A one-time chip, unless it was shown (or is waiting) already this session
  enqueue(id, text, T, key = id) {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.queue.push({ id, text, at: T, until: 0 });
  }
  // Write the page only when the answer changes (the text stays while the chip fades out)
  paint(kind, text, on) {
    const el = this.el, box = this.box;
    if (!el) return;
    if (on && text !== this.sig) { this.sig = text; el.textContent = text; }
    const cls = on ? `bc-${kind}` : this.cls;
    if (cls !== this.cls) { if (this.cls) el.classList.remove(this.cls); if (cls) el.classList.add(cls); this.cls = cls; }
    if (on !== this.onNow) { this.onNow = on; el.classList.toggle('on', on); box.classList.toggle('bc-on', on); }
  }
}

const num = v => (Number.isFinite(v) ? v : 0);
