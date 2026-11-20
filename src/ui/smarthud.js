// The smart interface (a PROTOTYPE, only with ?hud=minimo; main.js loads this module only then, so without it nothing
// changes): like GTA 6, RDR2 or Zelda, each part of the HUD shows up when it matters and fades away by itself when it
// does not. Health, hunger and experience go together in one small block left of the hotbar (as RDR2's cores): when
// they change, in danger or when low (low stays); the hotbar when you switch, pick up or use the last of something, then
// it folds away; the money (top right, as in GTA) when you earn or spend; the time at dawn, dusk, a new day, a weather
// change, waking up and before a shop closes; the place when you enter a new one; the minimap while you travel, or while
// a first step sends you somewhere, with a mark over where to go. Holding Tab shows everything (and a card with the
// keys), and opening a window shows health, hunger, money and the time, as GTA's weapon wheel does. With the icon column
// gone, keys are taught once, at the moment they are useful (I the first time you pick something up, C with a new
// recipe…). What needs you shows by itself: hungry, the slot with food beats; drawing the bow, a ring at the cursor with
// the arrows left.
// Nothing here reads the DOM each frame: it compares a few numbers of the game and touches a class only when the
// answer changes (the mark and the bow ring move with the view, so they are written while they show). The look (fades
// of 0.15 s in and 0.5 s out) is the CSS below, injected so the prototype stays in this file and is easy to remove.
import * as THREE from 'three';
import { t, onLangChange } from '../i18n.js';
import { ITEMS, HARVEST } from '../items.js';
import { HP_MAX, HUNGER_MAX } from '../combat.js';
import { inBounds, TAVERN, HOUSE, HOUSE_FAMILY } from '../world/village.js';
import { doorTile } from '../world/blueprints.js';
import { nearX } from '../world/planet.js';
import { parsePlaced } from '../pieces.js';
import { SHOPS } from '../economy.js';
import { HOTBAR } from '../inventory.js';
import { Profile } from '../accounts.js';
import { CAM } from '../camera.js';
import { hud } from './hud.js';

const $ = id => document.getElementById(id);
// How long each thing stays after what brought it (seconds; the fade-out comes after)
const SHOW = { hurt: 5, heal: 3, hunger: 4, money: 4, xp: 3, level: 5, slots: 3, name: 1.6, place: 4, clock: 6, tag: 4, quest: 10, intro: 4, tip: 9, tipShort: 6, build: 7, all: 1.5, mini: 3 };
const LOW_HP = HP_MAX * 0.4, LOW_FOOD = 6, SHOW_FOOD = HUNGER_MAX * 0.6;   // (low health and hunger stay; hunger above 60 % is not news)
const DANGER = 8;          // tiles: a creature this close keeps the hearts in sight
const STALE_HINT = 6;      // seconds: a click hint that has not changed by then has been read
const GOAL_NEAR = 4;       // tiles: the mark of where to go fades this close
const BOW_TEXT = 2;        // draws of the bow that still get the long text (then the ring says it)
const TIPS_KEY = 'pueblo-brotes:pistas';   // (the key tips already shown, per account, in this browser: like Minecraft's tutorial)
// The one-time key tips: the key drawn as a key (hungry and lowhp first; hungry picks its key and text as it goes)
const TIPS = {
  bag: { code: 'KeyI', key: 'I' }, craft: { code: 'KeyC', key: 'C' }, build: { code: 'KeyB', key: 'B' },
  journal: { code: 'KeyJ', key: 'J' }, map: { code: 'KeyM', key: 'M' }, all: { code: 'Tab', key: 'Tab' },
  hungry: {}, lowhp: { key: null },
};
const KNOWN = ['bag', 'craft', 'build', 'journal', 'map'];   // (what a player past the first steps already knows)
// Closing hours of the shops (hours past 24 are after midnight); the ones open all day never close
const CLOSING = [...new Set(Object.values(SHOPS).filter(s => s.hours[1] - s.hours[0] < 24).map(s => s.hours[1] % 24))];
// Where the first steps send you (h: how high over the ground the mark goes)
const HOME_DOOR = doorTile(HOUSE.x0, HOUSE.y0);
const GOALS = {
  nilo: g => g.world.nilo && { x: g.world.nilo.x, y: g.world.nilo.y, h: 1.95 },
  taller: () => ({ x: TAVERN.x0 + 5.5, y: TAVERN.y1 + 1, h: 2.6 }),   // (the tavern door, in the middle of its front)
  dormir: (g, sh) => sh.bed || (sh.bed = findBed(g)),
};
// The bed of your house (searched once, when that step starts; if it is not there, your door)
function findBed(g) {
  const H = HOUSE_FAMILY;
  for (let ty = H.y0; ty <= H.y1; ty++) for (let tx = H.x0; tx <= H.x1; tx++) {
    const raw = g.world.at?.('placed', tx, ty);
    if (raw && /^cama/.test(parsePlaced(raw)[0])) return { x: tx + 0.5, y: ty + 0.5, h: 1.3 };
  }
  return { x: HOME_DOOR[0] + 0.5, y: HOME_DOOR[1] + 1, h: 2.6 };
}

const CSS = `
body.hud-min .hm, body.hud-min .hmt { opacity: 0; visibility: hidden; transition: opacity .5s ease, visibility 0s linear .5s; }
body.hud-min .hm.hm-on, body.hud-min.hud-all .hm, body.hud-min .hmt.hm-on { opacity: 1; visibility: visible; transition: opacity .15s ease, visibility 0s; }
body.hud-min.hud-all #hud-tip, body.hud-min.hud-all:not(.building) #hud-build, body.hud-min.hud-all.building #hud-keys { opacity: 0; visibility: hidden; }
body.hud-min.hud-all.building #hud-build { opacity: 1; visibility: visible; transition: opacity .15s ease, visibility 0s; }
body.hud-min.hm-solo #players.show { display: none; }
body.hud-min #admin-tag { left: 50%; top: 10px; transform: translateX(-50%); }
body.hud-min.admin #quest, body.hud-min.spectator #quest { top: 54px; }
body.hud-min.spectator #hotbar-slots, body.hud-min:not(.hud-all) #coords, body.hud-min #vitals { display: none; }
/* The hotbar: light slots that rise into sight and fold away */
body.hud-min #hotbar { background: none; border: 0; box-shadow: none; padding: 0; }
body.hud-min #hotbar .slots { padding: 4px; background: rgba(16, 10, 6, .4); border-radius: 9px; transform: translateY(14px); transition: opacity .5s ease, transform .5s ease, visibility 0s linear .5s; }
body.hud-min #hotbar .slots.hm-on, body.hud-min.hud-all #hotbar .slots { transform: none; transition: opacity .15s ease, transform .2s ease-out, visibility 0s; }
body.hud-min #hotbar .slot { background: rgba(0, 0, 0, .28); border: 1px solid rgba(255, 240, 210, .3); border-radius: 6px; }
body.hud-min #hotbar .slot.sel { background: rgba(60, 42, 14, .55); border-color: var(--gold); box-shadow: 0 0 0 1px var(--gold), inset 0 0 10px rgba(255, 215, 122, .3); }
body.hud-min #hotbar .slot.hm-food { animation: hm-beat 1s ease-in-out infinite; }
@keyframes hm-beat { 50% { border-color: #fff3c0; box-shadow: 0 0 0 2px #ffd77a, 0 0 14px 4px rgba(255, 215, 122, .75); } }
/* Health, hunger and experience: one block left of the hotbar, at the edge of the screen */
#hud-status { position: absolute; right: calc(100% + 8px); bottom: 0; display: flex; flex-direction: column; gap: 5px; padding: 7px 10px 8px; white-space: nowrap; background: rgba(20, 13, 8, .62); border-radius: 10px; pointer-events: none; }
body.hud-min:not(.survival) #hud-status { display: none; }
#hud-status #hearts { font-size: 15px; letter-spacing: 1px; line-height: 1; }
#hud-status #hunger { justify-content: flex-end; }
#hud-status #hearts i.e { color: #7a6262; }
#hud-status #hunger i.e { filter: grayscale(1) brightness(.85); opacity: .4; }
#hud-status #xp { margin: 3px 24px 1px 0; height: 4px; }
#hud-status #xp b { left: auto; right: -22px; top: -4px; transform: none; }
#hud-coins { display: none; margin-top: 1px; font-size: 15px; color: var(--gold); }
#hud-status.hm-wins #hud-coins { display: block; }   /* (with a window open, the money goes here: the windows open at the top right) */
/* The money, top right as in GTA (under the minimap while it shows), and what came in or went out */
body.hud-min #money { position: fixed; right: 12px; top: 52px; margin: 0; padding: 5px 12px; font-size: 16px; transition: opacity .5s ease, visibility 0s linear .5s, top .25s ease; }
body.hud-min #money.hm-on { transition: opacity .15s ease, visibility 0s, top .25s ease; }
body.hud-min.hm-mini #money, body.hud-min.hud-all #money { top: 182px; }
body.hud-min.indoors #money { top: 52px; }
#hud-delta { position: fixed; right: 14px; top: 92px; font-size: 17px; font-weight: 600; white-space: nowrap; pointer-events: none; text-shadow: 1px 0 #2a1c22, -1px 0 #2a1c22, 0 1px #2a1c22, 0 -1px #2a1c22; transition: opacity .5s ease, visibility 0s linear .5s, top .25s ease; }
body.hud-min.hm-mini #hud-delta, body.hud-min.hud-all #hud-delta { top: 222px; }
body.hud-min.indoors #hud-delta { top: 92px; }
#hud-delta.up { color: #a8f07a; } #hud-delta.down { color: #ff9a7a; }
body:not(.playing) #money, body:not(.playing) #hud-delta, body:not(.playing) #hud-goal, body:not(.playing) #hud-bow { display: none; }
#hud-item { position: absolute; left: 50%; bottom: 62px; transform: translateX(-50%); padding: 2px 10px; font-size: 15px; white-space: nowrap; color: var(--cream); background: rgba(24, 16, 10, .72); border-radius: 9px; pointer-events: none; }
body.hud-min #hint { bottom: 100px; }
body.hud-min.building #hint { bottom: 150px; }   /* (above the build bar, which is taller than the hotbar) */
body.hud-min #hint.hm-quiet { opacity: 0; transition: opacity .5s; }
body.hud-min #quest.hm-compact:not(:hover) { padding: 5px 12px; width: auto; max-width: min(300px, calc(100vw - 24px)); }
body.hud-min #quest.hm-compact:not(:hover) > :not(b) { display: none; }
body.hud-min #quest.hm-compact:not(:hover) b { font-size: 15px; }
/* Where the first step sends you: a diamond over it with the distance, on the edge of the screen when it is off it */
#hud-goal { position: fixed; left: 0; top: 0; z-index: 4; display: flex; flex-direction: column; align-items: center; gap: 3px; pointer-events: none; will-change: transform; }
#hud-goal i { width: 13px; height: 13px; background: var(--gold); border: 2px solid #2a1c22; transform: rotate(45deg); box-shadow: 0 0 10px rgba(255, 215, 122, .7); }
#hud-goal b { font-size: 14px; font-weight: 600; color: var(--cream); text-shadow: 1px 0 #2a1c22, -1px 0 #2a1c22, 0 1px #2a1c22, 0 -1px #2a1c22; }
#hud-goal s { display: none; position: absolute; left: 50%; top: 8px; width: 0; height: 0; margin-top: -6px; border: 6px solid transparent; border-right: 0; border-left: 9px solid var(--gold); transform-origin: 0 6px; }
#hud-goal.edge s { display: block; }
/* The bow: a ring at the cursor that fills as it is drawn, with the arrows left */
#hud-bow { position: fixed; left: 0; top: 0; z-index: 6; width: 44px; height: 44px; margin: -22px 0 0 -22px; pointer-events: none; will-change: transform; }
#hud-bow svg { width: 100%; height: 100%; transform: rotate(-90deg); }
#hud-bow circle { fill: none; stroke-width: 3; }
#hud-bow .bg { stroke: rgba(20, 13, 8, .55); }
#hud-bow .fg { stroke: var(--cream); transition: stroke .15s; }
#hud-bow.full .fg { stroke: var(--gold); }
#hud-bow b { position: absolute; left: 46px; top: 10px; padding: 1px 7px; font-size: 17px; font-weight: 600; color: var(--cream); background: rgba(20, 13, 8, .6); border-radius: 8px; text-shadow: 1px 0 #2a1c22, -1px 0 #2a1c22, 0 1px #2a1c22, 0 -1px #2a1c22; }
#hud-bow.empty .bg { stroke: #ff6a4a; } #hud-bow.empty b { color: #ff8a6a; }
/* The key tips: next to the hotbar, where the eye already goes */
#hud-tip { position: absolute; left: calc(100% + 10px); bottom: 0; display: flex; align-items: center; gap: 4px; width: max-content; max-width: min(400px, calc(50vw - 250px)); padding: 7px 12px; font-size: 15px; line-height: 1.3; pointer-events: none; }
#hud-keys, #hud-build { position: fixed; right: 16px; bottom: 40px; z-index: 8; pointer-events: none; }
#hud-build { bottom: 158px; }   /* (above the build bar) */
#hud-tip kbd, .hud-keys kbd { flex: none; font-size: 13px; }
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
  const rows = [['E', 'use'], ['1 – 9', 'slots'], ['I', 'bag'], ['C', 'craft'], ['B', 'build'], ['J', 'journal'], ['M', 'map'], ['T', 'chat'], ['Z', 'view'], ['Tab', 'all'], ['Esc', 'pause']];
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
    this.v3 = new THREE.Vector3();
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    document.body.classList.add('hud-min');
    // The parts that come and go, and the new ones
    const bar = $('hotbar');
    const make = (id, cls, parent = document.body, tag = 'div') => { const el = document.createElement(tag); el.id = id; el.className = cls; parent.append(el); return el; };
    this.el = {
      clock: $('clockp'), tag: $('admin-tag'), place: $('place'), mini: $('minimap'), money: $('money'), slots: $('hotbar-slots'), quest: $('quest'),
      status: make('hud-status', '', bar),
    };
    // (health, hunger and experience into their block; the money out of the hotbar, to the top right)
    this.el.status.append(...['hearts', 'hunger', 'xp'].map($).filter(Boolean));
    this.coins = make('hud-coins', '', this.el.status);
    if (this.el.money) { this.el.money.classList.add('panel'); document.body.append(this.el.money); }
    for (const el of Object.values(this.el)) el?.classList.add('hm');
    this.el.item = make('hud-item', 'hmt', bar);
    this.el.delta = make('hud-delta', 'hmt');
    this.el.tip = make('hud-tip', 'panel hmt', bar);
    this.el.build = make('hud-build', 'panel hud-keys hmt');
    this.el.goal = make('hud-goal', 'hmt');
    this.el.goal.innerHTML = '<i></i><s></s><b></b>';
    this.el.bow = make('hud-bow', 'hmt');
    this.el.bow.innerHTML = '<svg viewBox="0 0 44 44"><circle class="bg" cx="22" cy="22" r="17"/><circle class="fg" cx="22" cy="22" r="17" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg><b></b>';
    this.keys = make('hud-keys', 'panel hud-keys hm');   // (only with Tab: hud-all)
    this.hintEl = $('hint');
    this.pauseKeys = make('hud-pause-keys', 'hud-pause-keys hud-keys', $('s-pause')?.querySelector('.box') || document.body);
    // (Controls: Tab now also shows the whole interface)
    document.querySelector('[data-i18n="controls.players"]')?.setAttribute('data-i18n', 'hud.controls.tab');
    this.paintCards();
    onLangChange(() => this.paintCards());
    // Tab held: everything in sight (input.js keeps doing the player list and stops the browser from moving the focus).
    // Any key of a tip, pressed: that one is known, whether it was showing or not
    addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Tab' && !e.repeat && game.mode === 'play' && game.player) { this.hold(true); this.solo(); }
      const id = Object.keys(TIPS).find(k => TIPS[k].code === e.code);
      if (id) this.learnt(id);
    }, true);
    addEventListener('keyup', e => { if (e.code === 'Tab') this.hold(false); });
    addEventListener('blur', () => this.hold(false));
  }

  paintCards() {
    this.keys.innerHTML = keysCard();
    this.pauseKeys.innerHTML = keysCard();
    this.el.build.innerHTML = buildCard();
    if (this.tip) { this.tipSig = null; this.paintTip(this.tip); }
    const tab = document.querySelector('[data-i18n="hud.controls.tab"]');
    if (tab) tab.textContent = t('hud.controls.tab');
  }

  // ---------- holding Tab ----------
  hold(on) {
    if (on) { this.held = true; this.allUntil = Infinity; }
    else if (this.held) { this.held = false; this.allUntil = now() + SHOW.all; }
  }
  // Alone in the world, the list of players (with only you in it) is noise
  solo() {
    const live = this.game.live, others = live?.joined && live.others?.some(p => p.playing && !p.server);
    document.body.classList.toggle('hm-solo', !others);
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
      if (this.hp !== undefined && surv) show('status', c.hp < this.hp ? SHOW.hurt : SHOW.heal);
      this.hp = c.hp;
    }
    // Hunger: when it drops below 60 % or when eating; always when low
    if (c.hunger !== this.food) {
      if (this.food !== undefined && surv && (c.hunger > this.food || c.hunger <= SHOW_FOOD)) show('status', SHOW.hunger);
      this.food = c.hunger;
    }
    if ((this.tick = (this.tick || 0) + dt) >= 0.25) { this.tick = 0; this.slow(g, p, T, show); }
    // Money (with what came in or went out) and experience
    if (g.money !== this.money) {
      if (this.money !== undefined) { this.delta(g.money - this.money, T); show('money', SHOW.money); }
      this.money = g.money;
      this.coins.textContent = `${g.money} 🪙`;
    }
    const xp = g.xp;
    if (xp.points !== this.xp) {
      if (this.xp !== undefined && surv) show('status', xp.level !== this.level ? SHOW.level : SHOW.xp);
      this.xp = xp.points; this.level = xp.level;
    }
    // The hotbar: when you switch (with the name of what you hold now) or what is in it changes
    if (inv.v !== this.invV) { this.invV = inv.v; this.onInventory(g, inv, show); }
    if (inv.selected !== this.sel) {
      if (this.sel !== undefined) { show('slots', SHOW.slots); this.itemName(inv.held, T); }
      this.sel = inv.selected;
      if (this.tip === 'hungry') this.paintTip('hungry');   // (the food taken: now it says to click)
    }
    // The first steps: whole when they change, then just the task
    if (g.steps.shown !== this.stepKey) {
      if (this.stepKey !== undefined && g.steps.i > this.stepI) this.want('journal');
      if (g.steps.i !== this.stepI) this.bed = null;   // (where the bed is, looked for again)
      this.stepKey = g.steps.shown; this.stepI = g.steps.i;
      show('quest', SHOW.quest);
    }
    // The place, when it is a new one (after a jump or a door in the dark, once it can be seen)
    if (g.placeName !== this.placeName) { this.placeName = g.placeName; this.placeDue = !!g.placeName; }
    if (this.placeDue && !g.jumping && !talking) { this.placeDue = false; show('place', SHOW.place); }
    if (g.gamemode !== this.gm) { if (this.gm !== undefined) show('tag', SHOW.tag); this.gm = g.gamemode; }
    // After the first look at everything, once: Tab is there
    if (!this.toldTab && T - this.started > SHOW.intro) { this.toldTab = true; this.want('all'); }
    // The minimap: while you travel (outside the village, or riding or sailing anywhere)
    const moved = Math.hypot(p.x - this.px, p.y - this.py);
    this.px = p.x; this.py = p.y;
    if (moved > 0.004 && moved < 2) { this.moveT += dt; this.stillT = 0; } else if ((this.stillT += dt) > 0.6) this.moveT = 0;
    const riding = p.mount || p.boat || p.aboard, world = g.scene === g.world, outside = world && !g.indoors;
    if (outside && (riding ? this.moveT > 0.3 : this.moveT > 1 && !inBounds(p.x, p.y))) show('mini', SHOW.mini);

    // What shows now
    const crit = { hearts: surv && c.hp <= LOW_HP, hunger: surv && c.hunger <= LOW_FOOD };
    const heldDef = ITEMS[inv.held?.id], up = k => (this.until[k] || 0) > T;
    const free = !talking;   // (talking, only what is critical: as in RDR2)
    const food = surv && heldDef?.food && c.hunger < HUNGER_MAX;
    this.set('status', crit.hearts || crit.hunger || (free && (up('status') || this.danger || wins || food)));
    this.set('money', free && !spect && up('money'));   // (with a window open it would be under it: in survival it is in the block)
    this.set('wins', wins, this.el.status, 'hm-wins');
    // (hungry with food in the hotbar: it stays, and that slot beats; during the first steps, which name the slots by
    // number, it stays too)
    const feed = crit.hunger && this.foodSlot >= 0;
    this.set('slots', free && (up('slots') || feed || !g.steps.over));
    this.beat(feed && !heldDef?.food ? this.foodSlot : -1);
    this.set('item', free && up('item'));
    this.set('delta', free && up('delta'));
    this.set('clock', free && (up('clock') || wins));
    this.set('tag', free && up('tag'));
    this.set('place', free && up('place'));
    this.set('quest', free);
    this.set('compact', !(up('quest') || all), this.el.quest, 'hm-compact');
    // Where to go, while a first step sends you somewhere: the mark over it, and the minimap with it
    const goal = this.goal(g, p, world && free && !wins && !g.build.on);
    if (!goal !== !this.mapGoal) g.map.lastMini = -Infinity;   // (it comes or goes: drawn now; while it moves, the minimap's own pace)
    this.mapGoal = g.map.goal = goal;
    const mini = free && (up('mini') || !!goal);
    this.set('mini', mini);
    this.set('miniBody', (mini || all) && outside, document.body, 'hm-mini');
    if ((mini || all) && !this.mini) g.map.lastMini = -Infinity;   // (it was not drawn while hidden: draw it now)
    this.mini = mini || all;   // (game.js draws the minimap only then)
    this.set('all', all, document.body, 'hud-all');
    // The bow: the ring, and its long text only the first times
    const bow = this.bowRing(g, inv, heldDef, free && !wins && !g.build.on);
    // A click hint goes quiet when it has been read (6 s without changing; not in build mode, where it says what goes
    // where), when it only says what you cannot do with what you hold (clicking still says it), and when the bow ring
    // says it already
    if (hint !== this.hint) { this.hint = hint; this.hintAt = T; this.neg = !!hint && !g.build.on && this.negative(g) && hint === g.gather.hint(); }
    const eating = crit.hunger && heldDef?.food;   // (the "Eat bread" of the hungry: it stays)
    this.set('quiet', !!hint && !g.build.on && ((T - this.hintAt > STALE_HINT && !eating) || this.neg || bow), this.hintEl, 'hm-quiet');
    // Build mode: its keys, a moment after entering it
    if (g.build.on !== this.building) { this.building = g.build.on; if (g.build.on) show('build', SHOW.build); }
    this.set('build', g.build.on && free && up('build'));
    // The key tips, one at a time, never over a dialogue, a window or the build bar (what to do when hungry or hurt, first)
    if (crit.hunger) this.want('hungry', true);
    if (crit.hearts) this.want('lowhp', true);
    const tipNow = free && !wins && !g.build.on;
    if (this.tip && !tipNow) this.tipUntil += dt;   // (it waits, hidden, until the dialogue or the window is over)
    if (this.tip && (T > this.tipUntil || (this.tip === 'hungry' && !crit.hunger))) this.endTip();
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
    for (const k of ['hp', 'food', 'money', 'xp', 'level', 'invV', 'sel', 'stepKey', 'stepI', 'placeName', 'gm', 'night', 'count', 'sig', 'bed']) this[k] = undefined;
    this.fresh = Infinity;   // (the first look only counts them)
    this.foodSlot = -1; this.foodBag = false;
    this.px = p.x; this.py = p.y; this.moveT = 0; this.stillT = 0;
    this.started = T; this.toldTab = false;
    this.allUntil = 0; this.held = false;
    this.queue = []; this.endTip();
    this.seen = this.loadSeen();
    // (past the first steps, or a game from before them: they know the keys of the bag, crafting, building, the journal
    // and the map)
    if (this.game.steps.over && KNOWN.some(id => !this.seen.has(id))) { KNOWN.forEach(id => this.seen.add(id)); this.saveSeen(); }
    this.bowDraws = this.seen.has('bow2') ? 2 : this.seen.has('bow1') ? 1 : 0;
  }

  // Something changed in what is carried: the hotbar shows if its nine slots changed (not for the wear of a tool on
  // each blow), or if the tool in hand is about to break. And where the food is, for when you are hungry
  onInventory(g, inv, show) {
    let sig = '', count = 0, slot = -1, bag = false;
    for (let i = 0; i < inv.slots.length; i++) {
      const s = inv.slots[i];
      if (!s) continue;
      count += s.n;
      if (i < HOTBAR) sig += `${i}:${s.id}:${s.n};`;
      if (ITEMS[s.id]?.food) { if (i < HOTBAR) { if (slot < 0) slot = i; } else bag = true; }
    }
    if (this.sig !== undefined && sig !== this.sig) show('slots', SHOW.slots);
    if (this.count !== undefined && count > this.count && now() - this.started > 8) this.want('bag');   // (picked something up)
    this.sig = sig; this.count = count;
    if (slot !== this.foodSlot || bag !== this.foodBag) { this.foodSlot = slot; this.foodBag = bag; if (this.tip === 'hungry') this.paintTip('hungry'); }
    const h = inv.held, max = h && ITEMS[h.id]?.dur;
    if (max && h.dur !== undefined && h.dur / max < 0.15 && this.worn !== h) { this.worn = h; show('slots', SHOW.slots); }
    if (inv.count('tablas') >= 6) this.want('build');
  }
  // The slot with food beats (-1: none)
  beat(i) {
    if (i === this.beating) return;
    this.el.slots?.children[this.beating]?.classList.remove('hm-food');
    this.beating = i;
    this.el.slots?.children[i]?.classList.add('hm-food');
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

  // ---------- where to go ----------
  // The place the current first step sends you to, while it is farther than GOAL_NEAR (null: none). The mark is written
  // only while it shows, and only when it moves on the screen
  goal(g, p, can) {
    const st = !g.steps.over && g.steps.step, at = st && GOALS[st.id]?.(g, this);
    const dx = at ? nearX(at.x, p.x) - p.x : 0, dist = at ? Math.hypot(dx, at.y - p.y) : 0;
    const on = !!at && can && dist > GOAL_NEAR;
    this.set('goal', on);
    if (!on) return null;
    const W = innerWidth, H = innerHeight, v = this.v3, view = g.view3d;
    v.set(p.x + dx, (view.groundY?.(g.scene, at.x, at.y) || 0) + at.h, at.y).project(view.camera);
    let x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H;
    const behind = v.z > 1, M = 40, top = 60, bottom = 110;
    if (behind) { x = W - x; y = H - y; }
    const edge = behind || x < M || x > W - M || y < top || y > H - bottom;
    let angle = 0;
    if (edge) {   // (on the edge of the screen, toward it)
      const cx = W / 2, cy = (top + H - bottom) / 2, ex = x - cx, ey = y - cy;
      const k = Math.min(Math.abs(ex) > 1e-3 ? (cx - M) / Math.abs(ex) : Infinity, Math.abs(ey) > 1e-3 ? (cy - top) / Math.abs(ey) : Infinity);
      x = cx + ex * k; y = cy + ey * k; angle = Math.atan2(ey, ex);
    }
    const n = Math.round(dist), el = this.el.goal;
    if (n !== this.goalN) { this.goalN = n; el.lastChild.textContent = t('hud.goal.dist', { n }); }
    if (edge !== this.goalEdge) { this.goalEdge = edge; el.classList.toggle('edge', edge); }
    if (Math.abs(x - this.goalX) > 0.5 || Math.abs(y - this.goalY) > 0.5 || !(this.goalX >= 0)) {
      this.goalX = x; this.goalY = y;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    if (edge && Math.abs(angle - (this.goalA ?? 9)) > 0.02) { this.goalA = angle; el.children[1].style.transform = `rotate(${angle.toFixed(3)}rad) translateX(13px)`; }
    if (!this.goalAt || this.goalAt.x !== at.x || this.goalAt.y !== at.y) this.goalAt = { x: at.x, y: at.y };
    return this.goalAt;
  }

  // ---------- the bow ----------
  // With the bow in hand, the ring at the cursor (at the crosshair in first person): how drawn it is and the arrows left
  // (red with none). Returns whether it says what the click hint would
  bowRing(g, inv, def, can) {
    const on = !!def?.bow && can;
    this.set('bow', on);
    const drawing = g.archery.drawT !== null;
    if (drawing && !this.drawing && this.bowDraws < BOW_TEXT) { this.bowDraws++; this.seen.add('bow' + this.bowDraws); this.saveSeen(); this.longBow = true; }
    if (!drawing && this.drawing) this.longBow = false;
    this.drawing = drawing;
    if (!on) return false;
    const el = this.el.bow, n = g.archery.arrows(), k = g.archery.k;
    const m = CAM.first || !g.mouse?.in ? { x: innerWidth / 2, y: innerHeight / 2 } : g.mouse;
    if (Math.abs(m.x - this.bowX) > 0.5 || Math.abs(m.y - this.bowY) > 0.5 || !(this.bowX >= 0)) {
      this.bowX = m.x; this.bowY = m.y;
      el.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`;
    }
    const fill = Math.round(k * 100);
    if (fill !== this.bowFill) { this.bowFill = fill; el.querySelector('.fg').setAttribute('stroke-dashoffset', String(100 - fill)); el.classList.toggle('full', fill >= 100); }
    if (n !== this.bowN) { this.bowN = n; el.lastChild.textContent = n === Infinity ? '∞' : String(n); el.classList.toggle('empty', !n); }
    return !!n && this.bowDraws >= BOW_TEXT && !this.longBow;
  }

  // Is the click hint only "you need the scythe / the axe / the pickaxe" (what you hold cannot take what you point at)?
  negative(g) {
    const tg = g.gather.target, o = tg?.obj, rule = o && HARVEST[o.kind], def = ITEMS[g.inv.held?.id];
    if (!rule || tg.label !== undefined || tg.free || def?.food || def?.heal || def?.place || def?.tool === 'azada') return false;
    return !(def?.tool === rule.tool || (!def?.tool && rule.hand));
  }

  // ---------- one-time key tips ----------
  loadSeen() {
    try { return new Set((JSON.parse(localStorage.getItem(TIPS_KEY) || '{}') || {})[Profile.id || '-'] || []); } catch { return new Set(); }
  }
  saveSeen() {
    try {
      const all = JSON.parse(localStorage.getItem(TIPS_KEY) || '{}') || {};
      all[Profile.id || '-'] = [...this.seen];
      localStorage.setItem(TIPS_KEY, JSON.stringify(all));
    } catch { /* (no storage: it may be shown again next time) */ }
  }
  want(id, first = false) {
    if (this.seen.has(id) || this.tip === id || this.queue.includes(id) || Profile.server) return;
    if (first) this.queue.unshift(id); else this.queue.push(id);
  }
  // Its key was pressed: known, shown or not
  learnt(id) {
    if (this.tip === id) this.endTip();
    this.queue = this.queue.filter(q => q !== id);
    if (!this.seen.has(id) && this.player) { this.seen.add(id); this.saveSeen(); }
  }
  showTip(id, T) {
    this.tip = id;
    this.seen.add(id);
    this.saveSeen();
    this.tipSig = null;
    const text = this.paintTip(id);
    this.tipUntil = T + (text.length > 48 ? SHOW.tip : SHOW.tipShort);
  }
  // Hungry: what to do depends on where the food is (in hand, in the hotbar, in the bag or nowhere)
  hungryTip() {
    const i = this.foodSlot;
    if (ITEMS[this.game.inv.held?.id]?.food) return [t('key.click'), 'eat'];
    if (i >= 0) return [String(i + 1), 'take', { n: i + 1 }];
    return this.foodBag ? ['I', 'bag'] : [null, 'none'];
  }
  paintTip(id) {
    const [k, sub, params] = id === 'hungry' ? this.hungryTip() : [TIPS[id].key];
    const text = t(`hud.tip.${id}${sub ? '.' + sub : ''}`, params), sig = `${k}|${text}`;
    if (sig !== this.tipSig) { this.tipSig = sig; this.el.tip.innerHTML = `${k ? kbd(k) : ''}<span>${text}</span>`; }
    return text;
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
