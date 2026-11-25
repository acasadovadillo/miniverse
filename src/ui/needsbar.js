// The status bars at the top left (health, hunger, thirst, energy, air), for both HUDs, as in GTA V and VI. Design:
// docs/planes/gta/PLAN-D-barras-buceo.md §1 (markup and CSS in index.html, the rules in §1.3 and §1.4).
//
// One bar, one job: health (green, red when low) comes back by itself when fed and watered; hunger (orange) is food;
// thirst (blue) is drink; energy (yellow) is stamina, with the part of the track that low rest takes away drawn as a
// faint locked tail on the right; air (pale cyan) shows only under water, in its own row right under health; the horse's
// stamina (warm tan, Plan F §1.4 and §4.1) shows only while riding, in the next row (air and riding never happen
// together: a horse does not swim), with a tick at the 40 % it must reach again while it is winded. A row
// takes room only while its bar is in sight (and for the half second it takes to fade out): the bars in sight sit packed
// from the corner down, and the clock and the first steps under them follow (--nd-end, written here on the page).
//
// Contract:
//   main.js builds it once, before useSmartHud: game.needsBar = new NeedsBar(game) (not on the world server, so
//   callers use game.needsBar?.…); game.js calls game.needsBar?.frame() every frame, right after smartHud.frame.
//   NeedsBar is the ONLY writer of the classes nd-on, nd-off, low, zero and nd-gone (on the rows), of #nd-tag,
//   #nd-legend, of body.uw-low and of --nd-end on the page. windows.js asks bottomAll() where to open the left window.
//   SmartHud never touches them: it calls show(id, secs), crit(id, on) and context(all, quiet), and reset() from its
//   start() and destroy() (then kick()).
//   Bar ids: 'hp' | 'air' | 'horse' | 'food' | 'water' | 'en'. Their name key is 'hud.need.' + NEED_KEY[id].
//   Values read in frame(): combat.hp / HP_MAX, combat.hunger / HUNGER_MAX, needs.thirst / THIRST_MAX,
//   needs.stamina / STAMINA_MAX, needs.cap / STAMINA_MAX, needs.rest / REST_MAX, needs.air / needs.airMax,
//   horse.stam / STAM_MAX and horse.winded (src/horse.js; the horse row only while player.mount, never with ?vinculo=0).
//   body.underwater is set by the view (Track C); NeedsBar sets body.uw-low (air ≤ 30 % while the head is under).
//
// Full HUD: health, hunger, thirst and energy always in sight, air while under water or not yet full again, the horse
// whenever you ride; hovering the strip shows the legend. Minimal HUD (body.hud-min): each bar on only while SmartHud
// keeps it on (show, crit) or while a window or the tool wheel is open (context); Tab shows every row but air, with the
// legend (the horse, only while riding: it is never in sight on foot). The first 3 times
// a bar comes on by itself (per device, Settings.v.ndSeen) and whenever it turns critical, its name shows right of its
// bar for 2 s, so a lone blue bar is known to be thirst. The legend (Tab, or hovering in the full HUD) puts each bar's
// name and % on its row, right of it.
//
// Nothing here reads the DOM each frame: values are rounded to 1/200 and the page is written only when one changes (the
// sizes of the rows are read from the CSS only when the rows in sight change, or the window is resized).
import { t, onLangChange } from '../i18n.js';
import { HP_MAX, HUNGER_MAX } from '../combat.js';
import { THIRST_MAX, STAMINA_MAX, REST_MAX, AIR_MAX } from '../needs.js';
import { STAM_MAX, WINDED_CLEAR } from '../horse.js';
import { MARK } from '../horsecare.js';
import { apagada } from '../opciones.js';
import { Settings } from '../settings.js';
import { Audio } from '../audio.js';
import { glyph } from './glyphs.js';

// Bar id → its i18n name key suffix (hud.need.health…)
export const NEED_KEY = { hp: 'health', food: 'hunger', water: 'thirst', en: 'energy', air: 'air', horse: 'horse' };
const GLYPH = { hp: 'heart', food: 'drumstick', water: 'droplet', en: 'bolt', air: 'bubbles', horse: 'horseshoe' };   // (at its left, ui/glyphs.js)
const IDS = ['hp', 'air', 'horse', 'food', 'water', 'en'];   // (top to bottom, as on the page; horse: Plan F's row, #nd-horse)
// The bars that only some pages have: without their element the rest still works (a test page from before them)
const OPTIONAL = new Set(['horse']);
// Thresholds (shares of the bar). LOW: the bar pulses; air at LOW also darkens the vignette and beats; the horse at LOW
// pulses (SmartHud keeps it in sight then: crit)
export const LOW = { hp: 0.4, food: 0.3, water: 0.3, rest: 0.25, air: 0.3, horse: 0.2 };
const TAG_SECS = 2, TAG_TIMES = 3;   // the name over a bar that comes on: for 2 s, the first 3 times
const BEAT_EVERY = 1;                // seconds between heartbeats with little air left
const LEGEND_EVERY = 0.25;           // seconds between legend repaints while it shows
// (the horse's: what its bar says beside it, Plan R4-2: a drop, grass, a loose shoe, a bandage)
const HORSE_MARKS = [['thirst', 'droplet'], ['hunger', 'drumgrass'], ['shoe', 'horseshoe'], ['sore', 'bandage']], MARK_LINGER = 5;
const FOLD_AFTER = 0.5;              // seconds a bar that goes keeps its row (its fade out, in index.html), before the row folds away
const q = v => Math.round(Math.max(0, Math.min(1, v)) * 200) / 200;   // (rounded to 1/200: a write only on a real change)
const now = () => performance.now() / 1000;

export class NeedsBar {
  constructor(game) {
    this.game = game;
    this.el = null;          // the elements, found on the first frame (null: this page has no strip, e.g. an old test page)
    this.until = {};         // id → until when show() keeps it on (seconds)
    this.critOn = {};        // id → crit(id, on) from SmartHud
    this.all = false;        // context: a window or the tool wheel open (every row but air)
    this.quiet = false;      // context: in a dialogue (only the critical rows)
    this.hover = false;      // the mouse over the strip (full HUD: the legend)
    this.ids = IDS;          // (the bars this page has: IDS, less an OPTIONAL one without its element; find() sets it)
    this.offLang = onLangChange(() => this.kick());
    addEventListener('resize', () => { this.laySig = ''; });   // (the rows are thicker from 1536 px wide: measured again)
    this.clear();
  }

  // ---------- API (SmartHud and Combat.paint) ----------
  // Force a repaint next frame (Combat.paint, a HUD swap, a language change). The values are read each frame anyway, so
  // this writes the classes and the legend again, but keeps the timers, the name tag and the ghost of a hit running
  // (Combat.paint calls it on every change of health or hunger, many times a second while working or sprinting)
  kick() { this.dirty = true; }
  // (minimal HUD) Keep bar id on for secs from now
  show(id, secs) { const T = now() + secs; if (!(this.until[id] >= T)) this.until[id] = T; }
  // (minimal HUD) Keep bar id on while on is true (critical); quiet: on, but without its name tag (health while short of
  // air: the tag goes by the air's row, which is the one that matters)
  crit(id, on, quiet = false) { this.critOn[id] = on ? (quiet ? 'quiet' : true) : false; }
  // (minimal HUD, each frame) all: a window or the tool wheel is open, every row but air shows; quiet: a dialogue, only
  // the critical rows show
  context(all, quiet) { this.all = !!all; this.quiet = !!quiet; }
  // Clear every timer and class (SmartHud.start and SmartHud.destroy call it)
  reset() {
    this.until = {}; this.critOn = {}; this.all = false; this.quiet = false;
    const el = this.el;
    if (el) {
      for (const id of this.ids) el.bar[id].classList.remove('nd-on', 'low', 'zero', 'winded');
      el.tag.classList.remove('on');
    }
    document.body.classList.remove('uw-low');
    this.clear();
  }
  // (internal) everything written again from the next values, keeping what SmartHud asked for
  refresh() {
    const keep = { until: this.until, critOn: this.critOn, all: this.all, quiet: this.quiet };
    this.clear();
    Object.assign(this, keep);
    this.el?.tag.classList.remove('on');
    document.body.classList.remove('uw-low');
  }
  // (internal) forget what was written, so the next frame writes everything again
  clear() {
    this.v = {}; this.cls = {}; this.on = {}; this.own = {}; this.wasCrit = {};
    this.ghost = undefined; this.ghostDue = undefined; this.ghostSnap = false;
    this.tagUntil = 0; this.tagOn = false; this.uwLow = false; this.beatAt = 0;
    this.legendOn = false; this.legendSig = ''; this.legendAt = 0; this.lockW = undefined;
    this.dirty = false; this.gm = undefined; this.min = undefined;
    this.capW = undefined; this.hMarks = undefined; this.hMarkAt = {};
    this.laid = {}; this.goneAt = {}; this.at = {}; this.laySig = ''; this.m = null; this.tagId = null; this.tagMoved = false;
    this.shown = {};         // (reused each frame: the rows in sight)
  }

  // ---------- each frame ----------
  frame() {
    const g = this.game, p = g.player;
    if (!p || !g.world) return;
    if (!this.el && !this.find()) return;
    const T = now(), surv = g.gamemode === 'survival', min = !!g.smartHud;
    // (a new game mode or a HUD swap: everything written again, and no name tag left over; kicked: the classes again)
    if (this.gm !== undefined && (g.gamemode !== this.gm || min !== this.min)) this.refresh();
    else if (this.dirty) { this.dirty = false; this.cls = {}; this.lockW = undefined; this.legendSig = ''; this.legendAt = 0; }
    this.gm = g.gamemode; this.min = min;
    if (!surv) { this.setUwLow(false); return; }   // (creative and spectator: the strip is hidden by the CSS)

    const c = g.combat, n = g.needs || {}, H = g.horse;
    const airMax = n.airMax || AIR_MAX, under = !!n.headUnder;
    const cap = Number.isFinite(n.cap) ? n.cap : STAMINA_MAX;
    const val = {
      hp: c.hp / HP_MAX,
      food: c.hunger / HUNGER_MAX,
      water: Number.isFinite(n.thirst) ? n.thirst / THIRST_MAX : 1,
      en: Number.isFinite(n.stamina) ? n.stamina / STAMINA_MAX : 1,
      air: Number.isFinite(n.air) ? n.air / airMax : 1,
      horse: Number.isFinite(H?.stam) ? H.stam / STAM_MAX : 1,
    };
    const rest = Number.isFinite(n.rest) ? n.rest / REST_MAX : 1;
    const off = this.offs(), ids = this.ids;
    const riding = !!p.mount && ids === IDS;   // (the horse row: only in the saddle, and only on a page that has it)

    // The fills (and the ghost of recent damage on health: what the frame before left pending, first)
    if (this.ghostSnap) { this.ghostSnap = false; this.el.ghost.style.transition = ''; }   // (after an instant rise: the transition back)
    if (this.ghostDue !== undefined) { this.el.ghost.style.transform = `scaleX(${this.ghostDue})`; this.ghostDue = undefined; }   // (a drop: one frame later, so the delayed shrink plays)
    for (const id of ids) {
      const v = q(val[id]);
      if (v === this.v[id]) continue;
      const was = this.v[id];
      this.v[id] = v;
      this.el.fill[id].style.transform = `scaleX(${v})`;
      if (id === 'hp') this.ghostTo(v, was);
    }
    // The locked tail of energy: what low rest takes away from the stamina cap
    const lock = q(1 - cap / STAMINA_MAX);
    if (lock !== this.lockW) { this.lockW = lock; this.el.lock.style.width = `${(lock * 100).toFixed(1)}%`; }

    // The horse's: what hunger or thirst takes from its breath (the dim end of its track) and what its marks say
    let hSays = false;
    if (ids === IDS) {
      const C = g.horsecare, r = riding && C ? H?.ridden : null, hcap = q(r ? C.cap(r) : 1), bits = r ? C.marks(r) : 0;
      if (hcap !== this.capW) { this.capW = hcap; this.el.bar.horse.style.setProperty('--cap', hcap); }
      hSays = this.horseMarks(bits, riding, T);
    }

    // Low (pulses) and zero (empty and hurting: the track flashes)
    this.klass('hp', 'low', val.hp <= LOW.hp);
    this.klass('food', 'low', val.food <= LOW.food); this.klass('food', 'zero', c.hunger <= 0);
    this.klass('water', 'low', val.water <= LOW.water); this.klass('water', 'zero', val.water <= 0);
    this.klass('en', 'low', rest <= LOW.rest || val.en <= 0);
    this.klass('air', 'low', val.air <= LOW.air); this.klass('air', 'zero', under && val.air <= 0);
    if (ids === IDS) { this.klass('horse', 'low', riding && val.horse < LOW.horse); this.klass('horse', 'winded', riding && !!H?.winded); }
    for (const id of ids) this.klass(id, 'nd-off', !!off[id]);

    // Which are on (and, in the minimal HUD, which Tab shows: every bar but air)
    const tab = min && !!g.smartHud?.on?.all;
    const airLive = under || (n.air ?? airMax) < airMax - 1e-3;
    for (const id of ids) {
      let on, own = false, critical = false;
      if (off[id] || (id === 'horse' && !riding)) on = false;   // (the horse: never on foot, whatever SmartHud last asked)
      else if (!min) on = id === 'air' ? airLive : true;
      else {
        critical = !!this.critOn[id];
        own = critical || (this.until[id] || 0) > T || (id === 'horse' && hSays);
        // (a window, the tool wheel or Tab: every row but air; the horse's, only here, since the CSS of Tab leaves it out)
        on = critical || (!this.quiet && (own || (this.all && id !== 'air') || (tab && id === 'horse')));
        // (its name by its bar: when it turns critical, and the first times it comes on by itself)
        if (on && critical && !this.wasCrit[id]) { if (this.critOn[id] !== 'quiet') this.nameTag(id, T); }
        else if (on && own && !this.own[id] && this.seenTimes(id) < TAG_TIMES) { this.countSeen(id); this.nameTag(id, T); }
      }
      this.wasCrit[id] = critical && on;
      this.own[id] = own && on;
      this.klass(id, 'nd-on', on);
      this.on[id] = on;
    }
    if (this.tagOn && T > this.tagUntil) this.setTag(false);
    const shown = this.shown;
    for (const id of ids) shown[id] = !off[id] && (this.on[id] || (tab && id !== 'air' && id !== 'horse'));
    this.lay(shown, T);
    if (this.tagMoved) this.placeTag(true);

    // Little air left under water: the vignette closes in and a soft heartbeat, once a second
    const uwLow = under && val.air <= LOW.air && !off.air;
    this.setUwLow(uwLow);
    if (uwLow && g.mode === 'play' && T >= this.beatAt) { this.beatAt = T + BEAT_EVERY; heartbeat(); }   // (not over the pause menu)

    // The legend: with Tab held (minimal HUD) or the mouse over the strip (full HUD)
    const legend = min ? tab : this.hover;
    if (legend !== this.legendOn) { this.legendOn = legend; this.legendSig = ''; this.legendAt = 0; }
    if (legend && T >= this.legendAt) { this.legendAt = T + LEGEND_EVERY; this.paintLegend(val, rest, off); }
  }

  // The marks on the horse's row: each while what it says holds and MARK_LINGER s after it ends (drawn fainter). Whether any
  // is in sight
  horseMarks(bits, riding, T) {
    const el = this.el.marks, at = this.hMarkAt;
    let on = 0, gone = 0;
    if (!bits && this.hMarks === 0) return false;
    for (let i = 0; i < HORSE_MARKS.length; i++) {
      const k = HORSE_MARKS[i][0], b = MARK[k];
      if (bits & b) { on |= b; at[k] = T; } else if (riding && at[k] !== undefined && T - at[k] < MARK_LINGER) gone |= b; else at[k] = undefined;
    }
    const sig = on * 256 + gone;
    if (sig !== this.hMarks && el) {
      this.hMarks = sig;
      el.innerHTML = HORSE_MARKS.map(([k, g]) => ((on | gone) & MARK[k] ? glyph(g, `nd-mk mk-${k}${on & MARK[k] ? '' : ' going'}`) : '')).join('');
    }
    return (on | gone) !== 0;
  }

  // ---------- inside ----------
  find() {
    const $ = id => document.getElementById(id), root = $('needs');
    if (!root) return false;
    const bar = {}, fill = {}, row = {};
    const ids = [];
    for (const id of IDS) {
      bar[id] = $('nd-' + id); fill[id] = bar[id]?.querySelector('i'); row[id] = bar[id]?.parentElement;
      if (fill[id]) ids.push(id); else if (!OPTIONAL.has(id)) return false;
    }
    this.ids = ids.length === IDS.length ? IDS : ids;
    for (const id of ids) if (!row[id].querySelector('.gl')) bar[id].insertAdjacentHTML('afterend', glyph(GLYPH[id]));
    let marks = row.horse?.querySelector('.nd-marks') || null;
    if (row.horse && !marks) { marks = document.createElement('span'); marks.className = 'nd-marks'; row.horse.append(marks); }
    // (a winded horse gallops again at WINDED_CLEAR: its tick goes there, index.html .nd-horse.winded)
    bar.horse?.style.setProperty('--nd-wind', `${WINDED_CLEAR * 100}%`);
    this.el = { root, bar, fill, row, marks, ghost: bar.hp.querySelector('s'), lock: bar.en.querySelector('u'), tag: $('nd-tag'), legend: $('nd-legend') };
    if (!this.el.ghost || !this.el.lock || !this.el.tag || !this.el.legend) { this.el = null; return false; }
    root.addEventListener('mouseenter', () => { this.hover = true; });
    root.addEventListener('mouseleave', () => { this.hover = false; });
    return true;
  }
  // The needs turned off by a URL switch (src/opciones.js): never in sight, their row folded away
  offs() {
    if (!this.offCache) {
      const noStam = apagada('aguante'), noRest = apagada('cansancio');
      // (energy shows rest too: it hides only when both stamina and rest are off)
      this.offCache = { water: apagada('sed'), en: noStam && noRest, air: apagada('buceo'), horse: apagada('vinculo') };
    }
    return this.offCache;
  }
  // Toggle a class only when the answer changes
  klass(id, cls, on) {
    const k = id + cls;
    if (this.cls[k] === on) return;
    this.cls[k] = on;
    this.el.bar[id].classList.toggle(cls, on);
  }
  // The ghost chunk of health: on a drop it stays at the old value and shrinks after a delay (the CSS transition); on a
  // rise it jumps at once (no transition), hidden under the fill
  ghostTo(v, was) {
    const s = this.el.ghost;
    if (was === undefined || v >= (this.ghost ?? 0)) {
      s.style.transition = 'none';
      s.style.transform = `scaleX(${v})`;
      this.ghostSnap = true; this.ghostDue = undefined;
    } else this.ghostDue = v;
    this.ghost = v;
  }
  nameTag(id, T) {
    this.el.tag.textContent = t('hud.need.' + NEED_KEY[id]);
    this.tagId = id; this.tagMoved = !this.tagOn;   // (put by its bar once this frame's rows are laid out: lay())
    if (this.tagOn) this.placeTag(false);
    this.tagUntil = T + TAG_SECS;
    this.setTag(true);
  }
  // The name tag right of its bar, level with the middle of it (where the bar is going, when the rows move); fresh: it is
  // only now coming into sight, so it goes there at once instead of sliding from where the last one was
  placeTag(fresh) {
    this.tagMoved = false;
    const id = this.tagId, el = this.el.tag, m = this.m;
    if (!id || !m) return;
    if (fresh) el.style.transition = 'none';
    el.style.top = `${this.at[id] + m.h / 2}px`;
    if (fresh) { void el.offsetWidth; el.style.transition = ''; }   // (one layout, only when a name comes into sight)
  }
  // Which rows take room: the bars in sight, and for FOLD_AFTER more the ones fading out, so the bars in sight sit packed
  // from the corner down. Written only on a change: the rows (.nd-gone), where the strip ends (--nd-end, on the page: the
  // clock and the first steps go under it, index.html) and the name tag's place
  lay(shown, T) {
    let sig = '';
    for (const id of this.ids) {
      if (shown[id]) { this.laid[id] = true; this.goneAt[id] = undefined; }
      else if (this.laid[id]) { this.goneAt[id] ??= T + FOLD_AFTER; if (T >= this.goneAt[id]) this.laid[id] = false; }
      if (!this.laid[id]) this.goneAt[id] = undefined;
      sig += this.laid[id] ? '1' : '0';
    }
    if (sig === this.laySig) return;
    this.laySig = sig;
    const m = this.m = this.metrics();
    let y = 0;
    for (const id of this.ids) {
      this.el.row[id].classList.toggle('nd-gone', !this.laid[id]);
      this.at[id] = y;   // (its top in the strip, once the rows have moved)
      if (this.laid[id]) y += this.rowH(id, m) + m.gap;
    }
    // (no bar in sight: --hud-top, 8 px under it, is the corner)
    document.documentElement.style.setProperty('--nd-end', `${y ? m.y + y - m.gap : m.y - 8}px`);
    if (this.tagOn) this.placeTag(false);
  }
  // The sizes of the strip, from the CSS (whole pixels: index.html)
  metrics() {
    const cs = getComputedStyle(document.documentElement), px = k => parseFloat(cs.getPropertyValue(k)) || 0;
    return { y: px('--nd-y'), h: px('--nd-r') || px('--nd-h'), gap: px('--nd-gap') };
  }
  rowH(id, m) { return m.h; }
  // Where the strip ends (page y) with the rows an open window shows (every bar but air and the horse, and those two while
  // they are in sight), or 0 when there is no strip (creative, spectator): windows.js opens the left window under it, and
  // keeps windows off it
  bottomAll() {
    if (this.game.gamemode !== 'survival' || !document.getElementById('needs')) return 0;
    const m = this.metrics(), off = this.offs();
    let y = 0;
    for (const id of this.ids) if (!off[id] && ((id !== 'air' && id !== 'horse') || this.on[id] || (id === 'horse' && !!this.game.player?.mount))) y += this.rowH(id, m) + m.gap;
    return y ? m.y + y - m.gap : 0;
  }
  setTag(on) {
    if (on === this.tagOn) return;
    this.tagOn = on;
    this.el?.tag.classList.toggle('on', on);
  }
  setUwLow(on) {
    if (on === this.uwLow) return;
    this.uwLow = on;
    document.body.classList.toggle('uw-low', on);
  }
  seenTimes(id) { return Settings.v.ndSeen?.[id] || 0; }
  countSeen(id) {
    const s = Settings.v.ndSeen && typeof Settings.v.ndSeen === 'object' ? Settings.v.ndSeen : (Settings.v.ndSeen = {});
    s[id] = (s[id] || 0) + 1;
    Settings.store();
  }
  // The legend: the name and the percentage of each bar in sight, each on its bar's row (energy with its rest; the horse
  // as one line, "Horse 80 %", with the number set like the others')
  paintLegend(val, rest, off) {
    const pct = v => t('hud.need.pct', { pct: Math.round(Math.max(0, Math.min(1, v)) * 100) });
    const rows = [];
    for (const id of this.ids) {
      if (off[id] || (id === 'air' && !this.on.air) || (id === 'horse' && !this.shown.horse)) continue;
      if (id === 'horse') { rows.push(`<div class="l-horse">${horseLine(val.horse)}</div>`); continue; }
      const extra = id === 'en' && !apagada('cansancio') ? `<small>${t('hud.need.rest', { pct: Math.round(rest * 100) })}</small>` : '';
      rows.push(`<div class="l-${id}">${t('hud.need.' + NEED_KEY[id])}<span>${pct(val[id])}</span>${extra}</div>`);
    }
    const html = rows.join('');
    if (html !== this.legendSig) { this.legendSig = html; this.el.legend.innerHTML = html; }
  }
}

// The horse's legend line: hud.need.horse_pct, with its number (and what follows it, " %") in the span the other rows
// put their % in, so the numbers line up. The language decides where the number goes
const PCT_MARK = '\u0001';
const esc = s => s.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
function horseLine(v) {
  const n = Math.round(Math.max(0, Math.min(1, v)) * 100), line = t('hud.need.horse_pct', { pct: PCT_MARK }), i = line.indexOf(PCT_MARK);
  if (i < 0) return esc(line);
  return `${esc(line.slice(0, i).trimEnd())}<span>${n}${esc(line.slice(i + 1))}</span>`;
}

// A soft heartbeat (lub-dub): low and short filtered noise
function heartbeat() {
  try {
    Audio.noiseHit(70, 0.09, 0.22, 'lowpass');
    setTimeout(() => Audio.noiseHit(60, 0.08, 0.14, 'lowpass'), 170);
  } catch { /* no sound: the vignette says it */ }
}
