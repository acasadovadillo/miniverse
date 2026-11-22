// The status bars under the minimap (health, hunger, thirst, energy, air), for both HUDs. Design:
// docs/planes/gta/PLAN-D-barras-buceo.md §1 (markup and CSS in index.html, the rules in §1.3 and §1.4).
//
// One bar, one job: health (green, red when low) comes back by itself when fed and watered; hunger (orange) is food;
// thirst (blue) is drink; energy (yellow) is stamina, with the part of the track that low rest takes away drawn as a
// faint locked tail on the right; air (pale cyan) shows only under water, in its own row above health.
//
// Contract:
//   main.js builds it once, before useSmartHud: game.needsBar = new NeedsBar(game) (not on the world server, so
//   callers use game.needsBar?.…); game.js calls game.needsBar?.frame() every frame, right after smartHud.frame.
//   NeedsBar is the ONLY writer of the classes nd-on, nd-off, low and zero, of #nd-tag, #nd-legend and of body.uw-low.
//   SmartHud never touches them: it calls show(id, secs), crit(id, on) and context(all, quiet), and reset() from its
//   start() and destroy() (then kick()).
//   Bar ids: 'hp' | 'food' | 'water' | 'en' | 'air'. Their name key is 'hud.need.' + NEED_KEY[id].
//   Values read in frame(): combat.hp / HP_MAX, combat.hunger / HUNGER_MAX, needs.thirst / THIRST_MAX,
//   needs.stamina / STAMINA_MAX, needs.cap / STAMINA_MAX, needs.rest / REST_MAX, needs.air / needs.airMax.
//   body.underwater is set by the view (Track C); NeedsBar sets body.uw-low (air ≤ 30 % while the head is under).
//
// Full HUD: health, hunger, thirst and energy always in sight, air while under water or not yet full again; hovering
// the strip shows the legend. Minimal HUD (body.hud-min): each bar on only while SmartHud keeps it on (show, crit) or
// while a window or the tool wheel is open (context); Tab shows every row but air, with the legend. The first 3 times
// a bar comes on by itself (per device, Settings.v.ndSeen) and whenever it turns critical, its name shows over its slot
// for 2 s, so a lone blue bar is known to be thirst.
//
// Nothing here reads the DOM each frame: values are rounded to 1/200 and the page is written only when one changes.
import { t, onLangChange } from '../i18n.js';
import { HP_MAX, HUNGER_MAX } from '../combat.js';
import { THIRST_MAX, STAMINA_MAX, REST_MAX, AIR_MAX } from '../needs.js';
import { apagada } from '../opciones.js';
import { Settings } from '../settings.js';
import { Audio } from '../audio.js';

// Bar id → its i18n name key suffix (hud.need.health…)
export const NEED_KEY = { hp: 'health', food: 'hunger', water: 'thirst', en: 'energy', air: 'air' };
const IDS = ['hp', 'food', 'water', 'en', 'air'];
// Thresholds (shares of the bar). LOW: the bar pulses; air at LOW also darkens the vignette and beats
export const LOW = { hp: 0.4, food: 0.3, water: 0.3, rest: 0.25, air: 0.3 };
const TAG_SECS = 2, TAG_TIMES = 3;   // the name over a bar that comes on: for 2 s, the first 3 times
const BEAT_EVERY = 1;                // seconds between heartbeats with little air left
const LEGEND_EVERY = 0.25;           // seconds between legend repaints while it shows
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
    this.offLang = onLangChange(() => this.kick());
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
  // air: the tag goes over the air's row, which is the one that matters)
  crit(id, on, quiet = false) { this.critOn[id] = on ? (quiet ? 'quiet' : true) : false; }
  // (minimal HUD, each frame) all: a window or the tool wheel is open, every row but air shows; quiet: a dialogue, only
  // the critical rows show
  context(all, quiet) { this.all = !!all; this.quiet = !!quiet; }
  // Clear every timer and class (SmartHud.start and SmartHud.destroy call it)
  reset() {
    this.until = {}; this.critOn = {}; this.all = false; this.quiet = false;
    const el = this.el;
    if (el) {
      for (const id of IDS) el.bar[id].classList.remove('nd-on', 'low', 'zero');
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

    const c = g.combat, n = g.needs || {};
    const airMax = n.airMax || AIR_MAX, under = !!n.headUnder;
    const cap = Number.isFinite(n.cap) ? n.cap : STAMINA_MAX;
    const val = {
      hp: c.hp / HP_MAX,
      food: c.hunger / HUNGER_MAX,
      water: Number.isFinite(n.thirst) ? n.thirst / THIRST_MAX : 1,
      en: Number.isFinite(n.stamina) ? n.stamina / STAMINA_MAX : 1,
      air: Number.isFinite(n.air) ? n.air / airMax : 1,
    };
    const rest = Number.isFinite(n.rest) ? n.rest / REST_MAX : 1;
    const off = this.offs();

    // The fills (and the ghost of recent damage on health: what the frame before left pending, first)
    if (this.ghostSnap) { this.ghostSnap = false; this.el.ghost.style.transition = ''; }   // (after an instant rise: the transition back)
    if (this.ghostDue !== undefined) { this.el.ghost.style.transform = `scaleX(${this.ghostDue})`; this.ghostDue = undefined; }   // (a drop: one frame later, so the delayed shrink plays)
    for (const id of IDS) {
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

    // Low (pulses) and zero (empty and hurting: the track flashes)
    this.klass('hp', 'low', val.hp <= LOW.hp);
    this.klass('food', 'low', val.food <= LOW.food); this.klass('food', 'zero', c.hunger <= 0);
    this.klass('water', 'low', val.water <= LOW.water); this.klass('water', 'zero', val.water <= 0);
    this.klass('en', 'low', rest <= LOW.rest || val.en <= 0);
    this.klass('air', 'low', val.air <= LOW.air); this.klass('air', 'zero', under && val.air <= 0);
    for (const id of IDS) this.klass(id, 'nd-off', !!off[id]);

    // Which are on
    const airLive = under || (n.air ?? airMax) < airMax - 1e-3;
    for (const id of IDS) {
      let on, own = false, critical = false;
      if (off[id]) on = false;
      else if (!min) on = id === 'air' ? airLive : true;
      else {
        critical = !!this.critOn[id];
        own = critical || (this.until[id] || 0) > T;
        on = critical || (!this.quiet && (own || (this.all && id !== 'air')));
        // (its name over its slot: when it turns critical, and the first times it comes on by itself)
        if (on && critical && !this.wasCrit[id]) { if (this.critOn[id] !== 'quiet') this.nameTag(id, T); }
        else if (on && own && !this.own[id] && this.seenTimes(id) < TAG_TIMES) { this.countSeen(id); this.nameTag(id, T); }
      }
      this.wasCrit[id] = critical && on;
      this.own[id] = own && on;
      this.klass(id, 'nd-on', on);
      this.on[id] = on;
    }
    if (this.tagOn && T > this.tagUntil) this.setTag(false);

    // Little air left under water: the vignette closes in and a soft heartbeat, once a second
    const uwLow = under && val.air <= LOW.air && !off.air;
    this.setUwLow(uwLow);
    if (uwLow && g.mode === 'play' && T >= this.beatAt) { this.beatAt = T + BEAT_EVERY; heartbeat(); }   // (not over the pause menu)

    // The legend: with Tab held (minimal HUD) or the mouse over the strip (full HUD)
    const legend = min ? !!g.smartHud?.on?.all : this.hover;
    if (legend !== this.legendOn) { this.legendOn = legend; this.legendSig = ''; this.legendAt = 0; }
    if (legend && T >= this.legendAt) { this.legendAt = T + LEGEND_EVERY; this.paintLegend(val, rest, off); }
  }

  // ---------- inside ----------
  find() {
    const $ = id => document.getElementById(id), root = $('needs');
    if (!root) return false;
    const bar = {}, fill = {};
    for (const id of IDS) { bar[id] = $('nd-' + id); fill[id] = bar[id]?.querySelector('i'); if (!fill[id]) return false; }
    this.el = { root, bar, fill, ghost: bar.hp.querySelector('s'), lock: bar.en.querySelector('u'), tag: $('nd-tag'), legend: $('nd-legend') };
    if (!this.el.ghost || !this.el.lock || !this.el.tag || !this.el.legend) { this.el = null; return false; }
    root.addEventListener('mouseenter', () => { this.hover = true; });
    root.addEventListener('mouseleave', () => { this.hover = false; });
    return true;
  }
  // The needs turned off by a URL switch (src/opciones.js): their slot stays, empty
  offs() {
    if (!this.offCache) {
      const noStam = apagada('aguante'), noRest = apagada('cansancio');
      // (energy shows rest too: it hides only when both stamina and rest are off)
      this.offCache = { water: apagada('sed'), en: noStam && noRest, air: apagada('buceo') };
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
    const el = this.el.tag, slot = this.el.bar[id];
    el.textContent = t('hud.need.' + NEED_KEY[id]);
    // (over its slot: the slots never move, so their place is read only now, when a name shows)
    el.style.left = `${slot.offsetLeft}px`;
    this.tagUntil = T + TAG_SECS;
    this.setTag(true);
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
  // The legend: a swatch, the name and the percentage of each bar in sight (energy with its rest)
  paintLegend(val, rest, off) {
    const pct = v => t('hud.need.pct', { pct: Math.round(Math.max(0, Math.min(1, v)) * 100) });
    const rows = [];
    for (const id of IDS) {
      if (off[id] || (id === 'air' && !this.on.air)) continue;
      const extra = id === 'en' && !apagada('cansancio') ? `<small>${t('hud.need.rest', { pct: Math.round(rest * 100) })}</small>` : '';
      rows.push(`<div style="--c: var(--nd-${id})"><b></b>${t('hud.need.' + NEED_KEY[id])}<span>${pct(val[id])}</span>${extra}</div>`);
    }
    const html = rows.join('');
    if (html !== this.legendSig) { this.legendSig = html; this.el.legend.innerHTML = html; }
  }
}

// A soft heartbeat (lub-dub): low and short filtered noise
function heartbeat() {
  try {
    Audio.noiseHit(70, 0.09, 0.22, 'lowpass');
    setTimeout(() => Audio.noiseHit(60, 0.08, 0.14, 'lowpass'), 170);
  } catch { /* no sound: the vignette says it */ }
}
