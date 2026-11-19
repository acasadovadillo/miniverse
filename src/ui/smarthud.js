// The smart interface (a PROTOTYPE, only with ?hud=minimo; main.js loads this module only then, so without it nothing
// changes): like GTA 6, RDR2 or Zelda, each part of the HUD shows up when it matters and fades away by itself when it
// does not. Health and hunger when they change, in danger or when low (low stays); the hotbar when you switch, pick
// up or use the last of something, then it folds away; money and experience when you earn or spend; the time at dawn,
// dusk, a new day, a weather change, waking up and before a shop closes; the place when you enter a new one; the
// minimap while you travel outside the village. Holding Tab shows everything (and a card with the keys), and opening
// a window shows health, hunger, money and the time, as GTA's weapon wheel does. With the icon column gone, keys are
// taught once, at the moment they are useful (I the first time you pick something up, C with a new recipe…).
// Nothing here reads the DOM each frame: it compares a few numbers of the game and touches a class only when the
// answer changes. The look (fades of 0.15 s in and 0.5 s out) is the CSS below, injected so the prototype stays in
// this file and is easy to remove.
import { t, onLangChange } from '../i18n.js';
import { ITEMS } from '../items.js';
import { HP_MAX, HUNGER_MAX } from '../combat.js';
import { inBounds } from '../world/village.js';
import { SHOPS } from '../economy.js';
import { HOTBAR } from '../inventory.js';
import { Profile } from '../accounts.js';
import { hud } from './hud.js';

const $ = id => document.getElementById(id);
// How long each thing stays after what brought it (seconds; the fade-out comes after)
const SHOW = { hurt: 5, heal: 3, hunger: 4, money: 4, xp: 3, level: 5, slots: 3, name: 1.6, place: 4, clock: 6, tag: 4, quest: 10, intro: 4, tip: 9, build: 7, all: 1.5, mini: 3 };
const LOW_HP = HP_MAX * 0.4, LOW_FOOD = 6, SHOW_FOOD = HUNGER_MAX * 0.6;   // (low health and hunger stay; hunger above 60 % is not news)
const DANGER = 8;          // tiles: a creature this close keeps the hearts in sight
const STALE_HINT = 6;      // seconds: a click hint that has not changed by then has been read
const TIPS_KEY = 'pueblo-brotes:pistas';   // (the key tips already shown, per account, in this browser: like Minecraft's tutorial)
// The one-time key tips: the key drawn as a key, and what it does
const TIPS = {
  bag: { code: 'KeyI', key: 'I' }, craft: { code: 'KeyC', key: 'C' }, build: { code: 'KeyB', key: 'B' },
  journal: { code: 'KeyJ', key: 'J' }, map: { code: 'KeyM', key: 'M' }, all: { code: 'Tab', key: 'Tab' },
  hungry: { key: 'click' }, lowhp: { key: null },
};
// Closing hours of the shops (hours past 24 are after midnight); the ones open all day never close
const CLOSING = [...new Set(Object.values(SHOPS).filter(s => s.hours[1] - s.hours[0] < 24).map(s => s.hours[1] % 24))];

const CSS = `
body.hud-min .hm, body.hud-min .hmt { opacity: 0; visibility: hidden; transition: opacity .5s ease, visibility 0s linear .5s; }
body.hud-min .hm.hm-on, body.hud-min.hud-all .hm, body.hud-min .hmt.hm-on { opacity: 1; visibility: visible; transition: opacity .15s ease, visibility 0s; }
body.hud-min.hud-all #hud-tip, body.hud-min.hud-all:not(.building) #hud-build, body.hud-min.hud-all.building #hud-keys { opacity: 0; visibility: hidden; }
body.hud-min.hud-all.building #hud-build { opacity: 1; visibility: visible; transition: opacity .15s ease, visibility 0s; }
body.hud-min #quest, body.hud-min #debug, body.hud-min #chat { left: 12px; }
body.hud-min:not(.survival) #hearts, body.hud-min:not(.survival) #hunger { display: none; }
body.hud-min.spectator #hotbar-slots, body.hud-min:not(.hud-all) #coords { display: none; }
body.hud-min #hotbar { background: none; border: 0; box-shadow: none; padding: 0; }
body.hud-min #hotbar .slots { padding: 5px 6px 6px; background: var(--wood); border: 3px solid var(--border); border-radius: 6px; box-shadow: inset 0 0 0 2px #5a3a20, 0 4px 0 rgba(0, 0, 0, .35); }
body.hud-min #vitals { margin: 0 4px 5px; min-height: 20px; }
body.hud-min #hearts, body.hud-min #hunger { padding: 3px 6px; background: rgba(24, 16, 10, .66); border-radius: 9px; }
body.hud-min #hearts i.e { color: #7a6262; }
body.hud-min #hunger i.e { filter: grayscale(1) brightness(.85); opacity: .4; }
body.hud-min #money { position: absolute; left: calc(100% + 8px); bottom: 8px; padding: 6px 10px; font-size: 15px; background: var(--wood); border: 3px solid var(--border); border-radius: 6px; box-shadow: inset 0 0 0 2px #5a3a20, 0 4px 0 rgba(0, 0, 0, .35); }
body.hud-min #xp { margin: 4px 6px 7px; }
#hud-delta { position: absolute; left: calc(100% + 12px); bottom: 54px; font-size: 17px; font-weight: 600; white-space: nowrap; pointer-events: none; text-shadow: 1px 0 #2a1c22, -1px 0 #2a1c22, 0 1px #2a1c22, 0 -1px #2a1c22; }
#hud-delta.up { color: #a8f07a; } #hud-delta.down { color: #ff9a7a; }
#hud-item { position: absolute; left: 50%; bottom: 64px; transform: translateX(-50%); padding: 2px 10px; font-size: 15px; white-space: nowrap; color: var(--cream); background: rgba(24, 16, 10, .72); border-radius: 9px; pointer-events: none; }
body.hud-min #quest.hm-compact:not(:hover) { padding: 5px 12px; width: auto; max-width: min(300px, calc(100vw - 24px)); }
body.hud-min #quest.hm-compact:not(:hover) > :not(b) { display: none; }
body.hud-min #quest.hm-compact:not(:hover) b { font-size: 15px; }
body.hud-min #hint.hm-stale { opacity: 0; transition: opacity .5s; }
#hud-tip, #hud-keys, #hud-build { position: fixed; right: 16px; bottom: 40px; z-index: 8; pointer-events: none; }
#hud-build { bottom: 158px; }   /* (above the build bar) */
#hud-tip { display: flex; align-items: center; gap: 4px; max-width: 360px; padding: 7px 12px; font-size: 15px; line-height: 1.3; }
#hud-tip kbd, .hud-keys kbd { flex: none; font-size: 13px; }
body.hud-min.building #hint { bottom: 150px; }   /* (above the build bar, which is taller than the hotbar) */
.hud-keys { padding: 8px 12px 10px; font-size: 14px; }
.hud-keys h4 { margin: 0 0 6px; font-size: 14px; font-weight: 400; color: var(--gold); }
.hud-keys dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 0; align-items: center; }
.hud-keys dt { text-align: right; white-space: nowrap; color: var(--dim); font-size: 13px; }
.hud-keys dt kbd { margin: 0; }
.hud-keys dd { margin: 0; color: var(--cream); }
.hud-pause-keys { margin-top: 4px; padding: 10px 0 0; border-top: 1px solid #4a3220; text-align: left; }
.hud-pause-keys.hud-keys { padding: 10px 0 0; }
`;

const kbd = k => `<kbd>${k}</kbd>`;
// The keys card (holding Tab, and in the pause): the keys there is no longer an icon for
function keysCard() {
  const rows = [['I', 'bag'], ['C', 'craft'], ['B', 'build'], ['J', 'journal'], ['M', 'map'], ['T', 'chat'], ['Z', 'view'], ['Tab', 'all'], ['Esc', 'pause']];
  return `<h4>${t('hud.keys.title')}</h4><dl>${rows.map(([k, id]) => `<dt>${kbd(k)}</dt><dd>${t('hud.keys.' + id)}</dd>`).join('')}</dl>`;
}
function buildCard() {
  const rows = [[t('key.click'), 'place'], [`${t('hud.key.right_click')} / ${kbd('X')}`, 'remove'], [kbd('R'), 'rotate'], [kbd('B'), 'exit']];
  return `<h4>${t('gui.build.title')}</h4><dl>${rows.map(([k, id]) => `<dt>${k}</dt><dd>${t('hud.build.' + id)}</dd>`).join('')}</dl>`;
}

export class SmartHud {
  constructor(game) {
    this.game = game;
    this.until = {};       // part → until when it shows (seconds)
    this.on = {};          // part → shown now (to touch the page only on a change)
    this.player = null;    // (a new game starts the intro again)
    this.queue = [];       // key tips waiting for their turn
    this.seen = new Set(); // (the ones of the account that plays: read at the start of each game)
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    document.body.classList.add('hud-min');
    // The parts that come and go, and the new ones
    const bar = $('hotbar');
    this.el = {
      clock: $('clockp'), tag: $('admin-tag'), place: $('place'), mini: $('minimap'), hearts: $('hearts'), hunger: $('hunger'),
      money: $('money'), xp: $('xp'), slots: $('hotbar-slots'), quest: $('quest'),
    };
    for (const el of Object.values(this.el)) el?.classList.add('hm');
    const make = (id, cls, parent = document.body) => { const el = document.createElement('div'); el.id = id; el.className = cls; parent.append(el); return el; };
    this.el.item = make('hud-item', 'hmt', bar);
    this.el.delta = make('hud-delta', 'hmt', bar);
    this.el.tip = make('hud-tip', 'panel hmt');
    this.el.build = make('hud-build', 'panel hud-keys hmt');
    this.keys = make('hud-keys', 'panel hud-keys hm');   // (only with Tab: hud-all)
    this.hintEl = $('hint');
    this.pauseKeys = make('hud-pause-keys', 'hud-pause-keys hud-keys', $('s-pause')?.querySelector('.box') || document.body);
    // (Controls: Tab now also shows the whole interface)
    document.querySelector('[data-i18n="controls.players"]')?.setAttribute('data-i18n', 'hud.controls.tab');
    this.paintCards();
    onLangChange(() => this.paintCards());
    // Tab held: everything in sight (input.js keeps doing the player list and stops the browser from moving the focus)
    addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Tab' && !e.repeat && game.mode === 'play' && game.player) this.hold(true);
      if (this.tip && TIPS[this.tip].code === e.code) this.endTip();   // (the key of the tip: learnt)
    }, true);
    addEventListener('keyup', e => { if (e.code === 'Tab') this.hold(false); });
    addEventListener('blur', () => this.hold(false));
  }

  paintCards() {
    this.keys.innerHTML = keysCard();
    this.pauseKeys.innerHTML = keysCard();
    this.el.build.innerHTML = buildCard();
    if (this.tip) this.paintTip(this.tip);
    const tab = document.querySelector('[data-i18n="hud.controls.tab"]');
    if (tab) tab.textContent = t('hud.controls.tab');
  }

  // ---------- holding Tab ----------
  hold(on) {
    if (on) { this.held = true; this.allUntil = Infinity; }
    else if (this.held) { this.held = false; this.allUntil = now() + SHOW.all; }
  }

  // ---------- each frame (from game.render) ----------
  frame(hint) {
    const g = this.game, p = g.player, T = now();
    if (!p || !g.world || g.mode !== 'play') return;
    if (p !== this.player) this.start(p, T);
    const surv = g.gamemode === 'survival', spect = g.gamemode === 'spectator';
    const talking = g.busy || hud.dialogOpen, wins = !!g.windowsOpen, all = T < this.allUntil;
    const c = g.combat, inv = g.inv, show = (k, s) => { this.until[k] = Math.max(this.until[k] || 0, T + s); };
    const dt = Math.min(0.25, T - (this.last ?? T));
    this.last = T;

    // Health: when it changes, with a creature close by, and always when low
    if (c.hp !== this.hp) {
      if (this.hp !== undefined && surv) { show('hearts', c.hp < this.hp ? SHOW.hurt : SHOW.heal); if (c.hp < this.hp) this.want('all'); }
      this.hp = c.hp;
    }
    // Hunger: when it drops below 60 % or when eating; always when low
    if (c.hunger !== this.food) {
      if (this.food !== undefined && surv && (c.hunger > this.food || c.hunger <= SHOW_FOOD)) { show('hunger', SHOW.hunger); this.want('all'); }
      this.food = c.hunger;
    }
    if ((this.tick = (this.tick || 0) + dt) >= 0.25) { this.tick = 0; this.slow(g, p, T, show); }
    // Money (with what came in or went out) and experience
    if (g.money !== this.money) {
      if (this.money !== undefined) { this.delta(g.money - this.money, T); show('money', SHOW.money); }
      this.money = g.money;
    }
    const xp = g.xp;
    if (xp.points !== this.xp) {
      if (this.xp !== undefined && surv) show('xp', xp.level !== this.level ? SHOW.level : SHOW.xp);
      this.xp = xp.points; this.level = xp.level;
    }
    // The hotbar: when you switch (with the name of what you hold now) or what is in it changes
    if (inv.v !== this.invV) { this.invV = inv.v; this.onInventory(g, inv, show); }
    if (inv.selected !== this.sel) {
      if (this.sel !== undefined) { show('slots', SHOW.slots); this.itemName(inv.held, T); }
      this.sel = inv.selected;
    }
    // The first steps: whole when they change, then just the task
    if (g.steps.shown !== this.stepKey) {
      if (this.stepKey !== undefined && g.steps.i > this.stepI) this.want('journal');
      this.stepKey = g.steps.shown; this.stepI = g.steps.i;
      show('quest', SHOW.quest);
    }
    // The place, when it is a new one (after a jump or a door in the dark, once it can be seen)
    if (g.placeName !== this.placeName) { this.placeName = g.placeName; this.placeDue = !!g.placeName; }
    if (this.placeDue && !g.jumping && !talking) { this.placeDue = false; show('place', SHOW.place); }
    if (g.gamemode !== this.gm) { if (this.gm !== undefined) show('tag', SHOW.tag); this.gm = g.gamemode; }
    // The minimap: while you travel (outside the village, or riding or sailing anywhere)
    const moved = Math.hypot(p.x - this.px, p.y - this.py);
    this.px = p.x; this.py = p.y;
    if (moved > 0.004 && moved < 2) { this.moveT += dt; this.stillT = 0; } else if ((this.stillT += dt) > 0.6) this.moveT = 0;
    const riding = p.mount || p.boat || p.aboard;
    if (g.scene === g.world && !g.indoors && (riding ? this.moveT > 0.3 : this.moveT > 1 && !inBounds(p.x, p.y))) show('mini', SHOW.mini);

    // What shows now
    const crit = { hearts: surv && c.hp <= LOW_HP, hunger: surv && c.hunger <= LOW_FOOD };
    const bow = g.archery.drawT !== null;
    const food = surv && ITEMS[inv.held?.id]?.food && c.hunger < HUNGER_MAX;
    const up = k => (this.until[k] || 0) > T;
    const free = !talking;   // (talking, only what is critical: as in RDR2)
    this.set('hearts', crit.hearts || (free && (up('hearts') || this.danger || wins)));
    this.set('hunger', crit.hunger || (free && (up('hunger') || food || wins)));
    this.set('money', free && !spect && (up('money') || wins));
    this.set('xp', free && surv && (up('xp') || wins));
    this.set('slots', free && (up('slots') || bow || !g.steps.over));   // (during the first steps, which name the slots by number, it stays)
    this.set('item', free && up('item'));
    this.set('delta', free && up('delta'));
    this.set('clock', free && (up('clock') || wins));
    this.set('tag', free && up('tag'));
    this.set('place', free && up('place'));
    this.set('quest', free);
    this.set('compact', !(up('quest') || all), this.el.quest, 'hm-compact');
    const mini = free && up('mini');
    this.set('mini', mini);
    if ((mini || all) && !this.mini) g.map.lastMini = -Infinity;   // (it was not drawn while hidden: draw it now)
    this.mini = mini || all;   // (game.js draws the minimap only then)
    this.set('all', all, document.body, 'hud-all');
    // A click hint that has not changed in a while has been read (not in build mode, where it says what goes where)
    if (hint !== this.hint) { this.hint = hint; this.hintAt = T; }
    this.set('stale', !!hint && !g.build.on && T - this.hintAt > STALE_HINT, this.hintEl, 'hm-stale');
    // Build mode: its keys, a moment after entering it
    if (g.build.on !== this.building) { this.building = g.build.on; if (g.build.on) show('build', SHOW.build); }
    this.set('build', g.build.on && free && up('build'));
    // The key tips, one at a time, never over a dialogue, a window or the build bar (what to do when hungry or hurt, first)
    if (crit.hunger) this.want('hungry', true);
    if (crit.hearts) this.want('lowhp', true);
    const tipNow = free && !wins && !g.build.on;
    if (this.tip && !tipNow) this.tipUntil += dt;   // (it waits, hidden, until the dialogue or the window is over)
    if (this.tip && T > this.tipUntil) this.endTip();
    else if (!this.tip && this.queue.length && tipNow) this.showTip(this.queue.shift(), T);
    this.set('tip', !!this.tip && tipNow);
  }

  // Four times a second: what needs a look around or the clock
  slow(g, p, T, show) {
    // A creature close by: the hearts stay while it is there
    const near = (g.combat.monsters || []).some(m => Math.hypot(m.x - p.x, m.y - p.y) < DANGER);
    if (near) show('dangerT', 3);
    this.danger = g.gamemode === 'survival' && (this.until.dangerT || 0) > T;
    // The time: at dawn and dusk, a new day, a weather change, after sleeping and before a shop of the village closes
    const d = g.days, night = d.isNight(), sky = d.weatherHere, day = d.dayOfSeason, slept = g.stats.get('dormido');
    if (this.night !== undefined && (night !== this.night || sky !== this.sky || day !== this.day || slept !== this.slept)) show('clock', SHOW.clock);
    Object.assign(this, { night, sky, day, slept });
    if (g.scene === g.world && inBounds(p.x, p.y)) {
      const h = d.localHour;
      for (const close of CLOSING) {
        const left = (close - h + 24) % 24, key = `${day}:${close}`;
        if (left > 0 && left <= 0.5 && this.closing !== key) { this.closing = key; show('clock', SHOW.clock); }
      }
    }
    // Leaving the village for the first time: the map
    if (g.scene === g.world && !g.indoors && !inBounds(p.x, p.y)) this.want('map');
    // A new recipe while playing (not the ones of the start): crafting
    const fresh = g.craft.fresh?.size || 0;
    if (fresh > this.fresh && T - this.started > 8) this.want('craft');
    this.fresh = fresh;
  }

  // A new game: a short look at everything that matters, then it goes
  start(p, T) {
    this.player = p;
    this.until = {};
    for (const k of ['clock', 'tag', 'place', 'slots']) this.until[k] = T + SHOW.intro;
    this.until.quest = T + SHOW.quest;
    for (const k of ['hp', 'food', 'money', 'xp', 'level', 'invV', 'sel', 'stepKey', 'placeName', 'gm', 'night', 'count', 'sig']) this[k] = undefined;
    this.fresh = Infinity;   // (the first look only counts them)
    this.px = p.x; this.py = p.y; this.moveT = 0; this.stillT = 0;
    this.started = T;
    this.allUntil = 0; this.held = false;
    this.queue = []; this.endTip();
    this.seen = this.loadSeen();
  }

  // Something changed in what is carried: the hotbar shows if its nine slots changed (not for the wear of a tool on
  // each blow), or if the tool in hand is about to break
  onInventory(g, inv, show) {
    let sig = '', count = 0;
    for (let i = 0; i < inv.slots.length; i++) { const s = inv.slots[i]; if (!s) continue; count += s.n; if (i < HOTBAR) sig += `${i}:${s.id}:${s.n};`; }
    if (this.sig !== undefined && sig !== this.sig) show('slots', SHOW.slots);
    if (this.count !== undefined && count > this.count && now() - this.started > 8) this.want('bag');   // (picked something up)
    this.sig = sig; this.count = count;
    const h = inv.held, max = h && ITEMS[h.id]?.dur;
    if (max && h.dur !== undefined && h.dur / max < 0.15 && this.worn !== h) { this.worn = h; show('slots', SHOW.slots); }
    if (inv.count('tablas') >= 6) this.want('build');
  }

  itemName(s, T) {
    const name = s && ITEMS[s.id]?.name;
    if (!name) return;
    this.el.item.textContent = name;
    this.until.item = T + SHOW.name;
  }
  delta(n, T) {
    if (!n) return;
    const el = this.el.delta;
    el.textContent = `${n > 0 ? '+' : '−'}${Math.abs(n)} 🪙`;
    el.className = `hmt ${n > 0 ? 'up' : 'down'}${this.on.delta ? ' hm-on' : ''}`;
    this.until.delta = T + SHOW.money;
  }

  // ---------- one-time key tips ----------
  loadSeen() {
    try { return new Set((JSON.parse(localStorage.getItem(TIPS_KEY) || '{}') || {})[Profile.id || '-'] || []); } catch { return new Set(); }
  }
  want(id, first = false) {
    if (this.seen.has(id) || this.tip === id || this.queue.includes(id) || Profile.server) return;
    if (id === 'all' && this.game.gamemode !== 'survival') return;
    if (first) this.queue.unshift(id); else this.queue.push(id);
  }
  showTip(id, T) {
    this.tip = id; this.tipUntil = T + SHOW.tip;
    this.seen.add(id);
    try {
      const all = JSON.parse(localStorage.getItem(TIPS_KEY) || '{}') || {};
      all[Profile.id || '-'] = [...this.seen];
      localStorage.setItem(TIPS_KEY, JSON.stringify(all));
    } catch { /* (no storage: it may be shown again next time) */ }
    this.paintTip(id);
  }
  paintTip(id) {
    const k = TIPS[id].key;
    this.el.tip.innerHTML = `${k ? kbd(k === 'click' ? t('key.click') : k) : ''}<span>${t('hud.tip.' + id)}</span>`;
  }
  endTip() { this.tip = null; }

  // Touch the page only when the answer changes
  set(k, on, el = this.el[k], cls = 'hm-on') {
    if (this.on[k] === on) return;
    this.on[k] = on;
    el?.classList.toggle(cls, on);
  }
}

const now = () => performance.now() / 1000;
