// The minimal interface, the one everybody plays with (main.js puts it on; ?hud=completo or Settings › Display ›
// Interface: Full give the full one back, and destroy() leaves the page as it was): like GTA 6, RDR2 or Zelda, each
// part of the HUD shows up when it matters and fades away by itself when it does not. The status bars at the top
// left (health, hunger, thirst, energy, air: ui/needsbar.js paints them, this file only says when each one shows)
// come on when they change, in danger or when low (low stays); experience goes in one small block left of the hotbar,
// with the load; the hotbar when you switch, pick up or use the last of something, then it folds away; the money (top right,
// as in GTA) when you earn or spend; the time, under it, at dawn, dusk, a new day, a weather change, waking up and before a
// shop closes; the name of the area, bottom right, when you enter another (PLAN-R8-hud-mapa.md §3.2); the minimap while you travel, or while a first step sends you somewhere,
// with a mark over where to go. Holding Tab shows everything, with the legend of the bars (no keys card: they are in
// Pause › Controls), and opening a window shows the bars, money and the time, as GTA's weapon wheel does. With the icon
// column gone, keys are taught once, in a help box at the top left, at the moment they are useful (I the first time you pick something up, C with a
// new recipe, Shift the first time you swim…). What needs you shows by itself: hungry (or thirsty), the slot with food
// (or a drink) beats; drawing the bow, a ring at the cursor with the arrows left.
// The body chip under the bars (cold, hot, soaked, filthy: ui/bodychip.js paints it, for both HUDs) brings its tip
// once, here, like the needs.
// The horse (Plan F §4.1): its stamina row while you gallop or it is not full, 2 s more once it is, and kept on while
// under 20 % (it pulses); the minimap while a horse comes to your whistle or is just out of earshot (its marker,
// ui/map.js); and four tips, once each: N the first time you have a horse, X the first ride with saddlebags, G the
// first time it gets scared under you, H once it has learnt to rear (level 3).
// Nothing here reads the DOM each frame: it compares a few numbers of the game and touches a class only when the
// answer changes (the mark and the bow ring move with the view, so they are written while they show). The look (fades
// of 0.15 s in and 0.5 s out) is the CSS below, injected so all of it stays in this file and goes away with it.
import * as THREE from 'three';
import { tHtml, t, fmt, onLangChange } from '../i18n.js';
import { Audio } from '../audio.js';
import { ITEMS, HARVEST } from '../items.js';
import * as items from '../items.js';   // (items.thirstOf, read when it is there: Track A2)
import { HP_MAX, HUNGER_MAX } from '../combat.js';
import { THIRST_MAX, STAMINA_MAX, REST_MAX } from '../needs.js';
import { apagada } from '../opciones.js';
import { LOW } from './needsbar.js';
import { STAM_MAX, levelOf } from '../horse.js';
import { shopHours } from '../routines.js';
import { inBounds, CENTER, TAVERN, HOUSE, HOUSE_FAMILY } from '../world/village.js';
import { doorTile } from '../world/blueprints.js';
import { nearX, dxOf } from '../world/planet.js';
import { parsePlaced } from '../pieces.js';
import { SHOPS } from '../economy.js';
import { HOTBAR } from '../inventory.js';
import { BULKY } from '../carry-items.js';
import { Profile } from '../accounts.js';
import { Settings } from '../settings.js';
import { CAM } from '../camera.js';
import { reportFault } from '../faults.js';
import { hud } from './hud.js';
import { markAt } from './routemark.js';
import { miniMode } from './minimap.js';

const $ = id => document.getElementById(id);
// What quenches thirst (items.thirstOf, Track A2; the same rule until it is there), and whether a stack is a drink now
// (a canteen or a jug counts only with water in it)
const thirstOf = def => (!def ? 0 : items.thirstOf ? items.thirstOf(def) : def.thirst ?? (def.drink ? 4 : 0));
const isDrink = s => { const def = s && ITEMS[s.id]; return !!def && (thirstOf(def) > 0 || (!!def.canteen && s.sips > 0)); };
// How long each thing stays after what brought it (seconds; the fade-out comes after)
const SHOW = { sprint: 3, hurt: 5, heal: 3, hunger: 4, thirst: 4, rest: 4, linger: 1.5, held: 0.5, money: 4, xp: 3, level: 5, slots: 3, name: 1.6, place: 4, clock: 6, tag: 4, quest: 10, intro: 4, tip: 9, tipShort: 7.5, build: 7, all: 1.5, mini: 3, horse: 2 };   // (horse: its row after it is full again)
const LOW_HP = HP_MAX * 0.4, LOW_FOOD = 6, SHOW_FOOD = HUNGER_MAX * 0.6;   // (low health and hunger stay; hunger above 60 % is not news)
const DANGER = 8;          // tiles: a creature this close keeps health in sight
const HEAL_NEW = 10;       // seconds without healing: the next heal is news (regen starting), not each 4 s tick
const NEED_GAP = 60;       // seconds: never two tips about needs (hunger, thirst, sleep) closer than this
// (the body's tips count as needs too: cold, heat, soaked, filthy, torn clothes, grown hair; src/body.js, Plan E §7.1)
const NEED_TIPS = new Set(['hungry', 'thirsty', 'tired', 'cold', 'hot', 'wet', 'dirty', 'torn', 'hair']);
// The body chip in sight (ui/bodychip.js) → the tip it brings, once (per account, like the others)
const CHIP_TIP = { cold: 'cold', freezing: 'cold', hot: 'hot', soaked: 'wet', filthy: 'dirty', torn: 'torn' };
const DIVE_TIP = 3;        // seconds swimming before the dive tip
const POSTURE_TIP = 90;    // seconds playing before the posture tip, if no crouch came first
const GAIT_TIP = 60;       // seconds walking on foot before the tip of the three speeds, if no jog came first
const STALE_HINT = 6;      // seconds: a click hint that has not changed by then has been read
const PLACE_AGAIN = 20, PLACE_SETTLE = 1.2;   // seconds: the same area is not named again before; and it counts as entered after
const GOAL_NEAR = 4;       // tiles: the mark of where to go fades this close
const HORSE_FULL = 0.98;   // share of the horse's stamina under which its row stays in sight (riding)
const REAR_LEVEL = 3;      // the bond level that teaches the rear (horse.js levelOf; Plan F §1.2)
const BOW_TEXT = 2;        // draws of the bow that still get the long text (then the ring says it)
const TIPS_KEY = 'pueblo-brotes:pistas';   // (the key tips already shown, per account, in this browser: like Minecraft's tutorial)
// The one-time key tips: the key drawn as a key (hungry and lowhp first; hungry picks its key and text as it goes)
const TIPS = {
  bag: { code: 'KeyI', key: 'I' }, craft: { code: 'KeyC', key: 'C' }, build: { code: 'KeyB', key: 'B' },
  journal: { code: 'KeyJ', key: 'J' }, map: { code: 'KeyM', key: 'M' }, all: { code: 'Tab', key: 'Tab' }, wheel: { code: 'KeyF', key: 'F' }, social: { code: 'KeyY', key: 'Y' },
  hungry: {}, lowhp: { key: null },
  // (the needs: thirsty picks its key and text as hungry does; tired and air say their key in the text; dive, Shift)
  thirsty: {}, tired: { key: null }, dive: { key: 'Shift' }, air: { key: null },
  // (Shift, the posture key: input.js, rest.js posture. No code: a Shift for Shift+R or a crouch does not teach the hold)
  posture: { key: 'Shift' },
  // (the three speeds: input.js pressW. Known once the player jogs or sprints, shown or not)
  gait: { key: 'W' },
  // (no code: E and Q are pressed for many other things, so only being shown makes them known)
  bulky: { key: 'E' }, arms: { key: 'Q' },
  // (the wheelbarrow, barrow.js: parked within reach, then pushing it; a big thing on the horse or in the bow, carry.js)
  barrow: { key: 'E' }, pushing: { key: 'Q' }, ride: { key: 'Q' }, bow: { key: null },
  // (the body, Plan E: what to do about the chip under the bars; dirty says its key, X, in the text)
  cold: { key: null }, hot: { key: null }, wet: { key: null }, dirty: { key: null }, torn: { key: null }, hair: { key: null },
  // (the horse, Plan F: their texts say their key, "N: whistle for Rayo". N is only the whistle, so pressing it makes it
  // known; G and H count only in the saddle, where they are pat and rear (ride); X does many things, so only being shown)
  whistle: { code: 'KeyN', key: null }, bags: { key: null }, jump_fence: { key: null }, pat: { code: 'KeyG', key: null, ride: true }, rear: { code: 'KeyH', key: null, ride: true },
  // (tracking and the nature book, Plan G §5.1: a fresh trail close by, the first study ring, the first wounded animal's
  // trail locked. No key drawn: the text says it)
  tracks: { key: null }, study: { key: null }, blood: { key: null },
  // (stalking, Plan R3: the ring, the wind mark, an animal that stares at you, your dog's point)
  ring: { key: null }, wind: { key: null }, freeze: { key: null }, point: { key: null },
};
// (those three wait at least a minute after any other tip, and are only asked for when they could show at once: a tip
// about prints that already went by would be noise. Not the blood one: it answers your own shot, and it is asked for as
// long as the animal you hit still bleeds)
const FIELD_TIPS = new Set(['tracks', 'study', 'blood', 'ring', 'wind', 'freeze', 'point']);
const FIELD_GAP = 60, FIELD_WAIT = 8;   // seconds: after any tip; the longest one waits (a window open) before it is dropped
const KNOWN = ['bag', 'craft', 'build', 'journal', 'map'];   // (what a player past the first steps already knows)
// Closing hours of the shops (hours past 24 are after midnight); the ones open all day never close
// (those of a day of the calendar: on Sundays they close earlier, routines.js)
const closing = { day: null, list: [] };
function closingOf(realDay) {
  if (closing.day !== realDay) { closing.day = realDay; closing.list = [...new Set(Object.keys(SHOPS).map(s => shopHours(s, realDay)).filter(h => h[1] - h[0] < 24).map(h => h[1] % 24))]; }
  return closing.list;
}
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
body.hud-min.hud-all #hud-tip, body.hud-min.hud-all:not(.building) #hud-build { opacity: 0; visibility: hidden; }
body.hud-min.hud-all.building #hud-build { opacity: 1; visibility: visible; transition: opacity .15s ease, visibility 0s; }
body.hud-min.hm-solo #players.show { display: none; }
body.hud-min #admin-tag { left: 50%; top: 16px; transform: translateX(-50%); }
body.hud-min #debug { top: var(--hud-top); }
#debug:not([hidden]) ~ #hud-left { display: none; }
/* Top left, under the bars and the body chip, which come and go (index.html, --hud-top): the objective, one line with a bar of
   the player's colour, and under it the help box (the key tips), as GTA's help text. --hl, its height, is written by smarthud.js
   when it changes: the chat goes under it */
body.hud-min { --chat-top: max(28vh, calc(var(--hud-top) + var(--hl, 0px) + 8px)); }
#hud-left { position: fixed; left: 16px; top: var(--hud-top); z-index: 6; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; pointer-events: none; transition: top .2s ease; }
body:not(.playing) #hud-left, body:not(.playing) #hud-right, body:not(.playing) #hud-place { display: none; }
body.hud-min #hud-left #quest { position: relative; left: auto; top: auto; }
body.hud-min:not(.ui-wood) #quest { padding: 1px 26px 2px 10px; background: none; border-radius: 0; box-shadow: inset 3px 0 0 var(--accent); text-shadow: var(--shadow-bare); }
body.hud-min:not(.ui-wood) #quest small { color: rgba(255, 255, 255, .86); }
body.hud-min:not(.ui-wood) #quest-x { opacity: 0; top: 0; transition: opacity .15s; } body.hud-min #quest:hover #quest-x { opacity: 1; }
body.hud-min.spectator #hotbar-slots, body.hud-min:not(.hud-all) #coords, body.hud-min #vitals, body.hud-min #place { display: none; }
/* The hotbar: light slots that rise into sight and fold away */
body.hud-min #hotbar { background: none; border: 0; box-shadow: none; padding: 0; }
body.hud-min #hotbar .slots { padding: 4px; background: rgba(10, 12, 16, .42); border-radius: 8px; transform: translateY(14px); transition: opacity .5s ease, transform .5s ease, visibility 0s linear .5s; }
body.hud-min #hotbar .slots.hm-on, body.hud-min.hud-all #hotbar .slots { transform: none; transition: opacity .15s ease, transform .2s ease-out, visibility 0s; }
body.hud-min #hotbar .slot { background: rgba(0, 0, 0, .28); border: 1px solid rgba(255, 255, 255, .22); border-radius: var(--r-s); }
body.hud-min #hotbar .slot.sel { background: rgba(255, 255, 255, .24); border-color: var(--gold); box-shadow: 0 0 0 1px var(--gold); }
body.hud-min #hotbar .slot.hm-food { animation: hm-beat 1s ease-in-out infinite; }
@keyframes hm-beat { 50% { border-color: #fff; box-shadow: 0 0 0 2px var(--accent-2), 0 0 14px 4px rgba(255, 178, 74, .7); } }
/* Experience (and the load, with the weight inventory): one block left of the hotbar. Health and the other needs are the
   bars at the top left (ui/needsbar.js) */
#hud-status { position: absolute; right: calc(100% + 8px); bottom: 0; display: flex; flex-direction: column; gap: 5px; padding: 7px 10px 8px; white-space: nowrap; background: var(--plate); border-radius: var(--r-m); pointer-events: none; }
body.hud-min:not(.survival) #hud-status { display: none; }
#hud-status #xp { margin: 3px 24px 1px 0; height: 4px; }
#hud-status #xp b { left: auto; right: -22px; top: -4px; transform: none; }
#hud-coins { display: none; align-items: center; gap: 6px; margin-top: 1px; font: 500 17px/1.2 var(--font-title); letter-spacing: .03em; font-variant-numeric: tabular-nums; color: var(--coins); }
#hud-status.hm-wins #hud-coins { display: flex; }   /* (with a window open, the money goes here: the windows open at the top right) */
/* Top right, as in GTA, no plates: the money, what came in or went out, and the time with the weather (the minimap is bottom
   left). What does not show takes no room, so what does sits in the corner */
#hud-right { position: fixed; right: 18px; top: 14px; z-index: 5; display: flex; flex-direction: column; align-items: flex-end; pointer-events: none; text-shadow: var(--shadow-bare); }
#hud-right > * { height: 0; overflow: visible; }
body.hud-min #hud-right > * { transition: opacity .5s ease, visibility 0s linear .5s, height .2s ease .5s; }
body.hud-min #hud-right > .hm-on, body.hud-min.hud-all #hud-right > .hm { transition: opacity .15s ease, visibility 0s, height .15s ease; }
body.hud-min #money { margin: 0; padding: 0; font-size: 26px; line-height: 34px; color: var(--ink); }
body.hud-min #money.hm-on, body.hud-min.hud-all #money { height: 34px; }
#hud-delta { font: 600 18px/24px var(--font-title); letter-spacing: .03em; font-variant-numeric: tabular-nums; white-space: nowrap; }
#hud-delta.hm-on { height: 24px; }
#hud-delta.up { color: var(--good); } #hud-delta.down { color: var(--bad); }
body.hud-min #clockp { position: static; padding: 0; background: none; border: 0; box-shadow: none; font: 600 15px/24px var(--font-ui); letter-spacing: .06em; color: rgba(255, 255, 255, .94); text-shadow: var(--shadow-bare); }
body.hud-min #clockp.hm-on, body.hud-min.hud-all #clockp { height: 24px; }
body:not(.playing) #hud-goal, body:not(.playing) #hud-bow { display: none; }
/* Bottom right, the name of the area you enter, in two sizes (over the fault dot; not in build mode: the build bar) */
#hud-place { position: fixed; right: max(22px, var(--safe)); bottom: 32px; z-index: 4; display: flex; flex-direction: column; align-items: flex-end; max-width: 40vw; text-align: right; color: var(--ink); text-shadow: var(--shadow-bare); pointer-events: none; }
#hud-place b { font: 600 calc(32 * var(--ui-s))/1.15 var(--font-title); letter-spacing: .06em; text-transform: uppercase; }
#hud-place > span { font: 600 calc(17 * var(--ui-s))/1.25 var(--font-ui); color: rgba(255, 255, 255, .94); }
#hud-place > span:empty { display: none; }
#hud-place #coords { font: 500 14px/1.3 var(--font-ui); color: rgba(255, 255, 255, .78); }
body.hud-min #hud-place { transition: opacity .6s ease, visibility 0s linear .6s; }
body.hud-min #hud-place.hm-on, body.hud-min.hud-all #hud-place { transition: opacity .18s ease-out, visibility 0s; }
body.hud-min #hud-place.hm-on { animation: hud-place .18s ease-out; }
@keyframes hud-place { from { transform: translateY(12px); } }
body.hud-min.building #hud-place { display: none; }
#hud-item { position: absolute; left: 50%; bottom: 62px; transform: translateX(-50%); padding: 2px 10px; font-size: 16px; white-space: nowrap; color: var(--cream); background: rgba(10, 12, 16, .72); border-radius: var(--r-s); pointer-events: none; }
body.hud-min #hint { bottom: 106px; }
body.hud-min.building #hint { bottom: 156px; }   /* (above the build bar, which is taller than the hotbar) */
body.hud-min #hint.hm-quiet { opacity: 0; transition: opacity .5s; }
body.hud-min #quest.hm-compact:not(:hover) { padding: 5px 12px; width: auto; max-width: min(300px, calc(100vw - 24px)); }
body.hud-min #quest.hm-compact:not(:hover) > :not(b) { display: none; }
body.hud-min #quest.hm-compact:not(:hover) b { font-size: 16px; }
/* Where the first step sends you: a diamond over it with the distance, on the edge of the screen when it is off it */
#hud-goal { position: fixed; left: 0; top: 0; z-index: 4; display: flex; flex-direction: column; align-items: center; gap: 3px; pointer-events: none; will-change: transform; }
#hud-goal i { width: 13px; height: 13px; background: var(--mark); border: 2px solid #14171c; transform: rotate(45deg); box-shadow: 0 0 10px rgba(255, 255, 255, .35); }
#hud-goal b { font-size: 15px; font-weight: 600; color: var(--cream); text-shadow: 1px 0 #2a1c22, -1px 0 #2a1c22, 0 1px #2a1c22, 0 -1px #2a1c22; }
#hud-goal s { display: none; position: absolute; left: 50%; top: 8px; width: 0; height: 0; margin-top: -6px; border: 6px solid transparent; border-right: 0; border-left: 9px solid var(--mark); transform-origin: 0 6px; }
#hud-goal.edge s { display: block; }
/* The bow: a ring at the cursor that fills as it is drawn, with the arrows left */
#hud-bow { position: fixed; left: 0; top: 0; z-index: 6; width: 44px; height: 44px; margin: -22px 0 0 -22px; pointer-events: none; will-change: transform; }
#hud-bow svg { width: 100%; height: 100%; transform: rotate(-90deg); }
#hud-bow circle { fill: none; stroke-width: 3; }
#hud-bow .bg { stroke: rgba(10, 12, 16, .55); }
#hud-bow .fg { stroke: var(--cream); transition: stroke .15s; }
#hud-bow.full .fg { stroke: var(--mark); }
#hud-bow b { position: absolute; left: 46px; top: 10px; padding: 1px 7px; font-size: 17px; font-weight: 600; color: var(--cream); background: rgba(10, 12, 16, .6); border-radius: var(--r-s); text-shadow: 1px 0 #2a1c22, -1px 0 #2a1c22, 0 1px #2a1c22, 0 -1px #2a1c22; }
#hud-bow.empty .bg { stroke: #ff6a4a; } #hud-bow.empty b { color: #ff8a6a; }
/* The help box: the key tips, one at a time */
#hud-tip { box-sizing: border-box; display: flex; align-items: center; gap: 6px; width: max-content; max-width: min(360px, 34vw); padding: 8px 12px; font-size: 16px; line-height: 1.3; pointer-events: none; }
#hud-tip.hm-gone { display: none; }
#hud-build { position: fixed; right: 16px; bottom: 40px; z-index: 8; pointer-events: none; }
#hud-build { bottom: 164px; }   /* (above the build bar) */
#hud-tip kbd, .hud-keys kbd { flex: none; font-size: 14px; }
.hud-keys { padding: 8px 12px 10px; font-size: 15px; }
.hud-keys h4 { margin: 0 0 6px; font-size: 15px; font-weight: 400; color: var(--gold); }
.hud-keys dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 0; align-items: center; }
.hud-keys dt { text-align: right; white-space: nowrap; color: var(--dim); font-size: 14px; }
.hud-keys dt kbd { margin: 0; }
.hud-keys dd { margin: 0; color: var(--cream); }
`;

const kbd = k => `<kbd>${k}</kbd>`;
// (no keys card with Tab any more: the user asked for it, the keys are in Pause › Controls)
function buildCard() {
  const rows = [[t('key.click'), 'place'], [`${t('hud.key.right_click')} / ${kbd('X')}`, 'remove'], [kbd('R'), 'rotate'], [kbd('B'), 'exit']];
  return `<h4>${t('gui.build.title')}</h4><dl>${rows.map(([k, id]) => `<dt>${k}</dt><dd>${t('hud.build.' + id)}</dd>`).join('')}</dl>`;
}

export class SmartHud {
  constructor(game) {
    building = this;   // (if this fails halfway, useSmartHud undoes what was done)
    this.game = game;
    this.until = {};       // part → until when it shows (seconds)
    this.on = {};          // part → shown now (to touch the page only on a change)
    this.player = null;    // (a new game starts the intro again)
    this.queue = [];       // key tips waiting for their turn
    this.seen = new Set(); // (the ones of the account that plays: read at the start of each game)
    this.v3 = new THREE.Vector3();
    const style = this.style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    this.moved = [];   // (what is taken out of its place, with where it was: destroy() puts it back)
    const move = (el, to) => { if (!el) return; this.moved.push([el, el.parentNode, el.nextSibling]); to.append(el); };
    document.body.classList.add('hud-min');
    // The parts that come and go, and the new ones
    const bar = $('hotbar');
    const make = (id, cls, parent = document.body, tag = 'div') => { const el = document.createElement(tag); el.id = id; el.className = cls; parent.append(el); return el; };
    this.el = {
      clock: $('clockp'), tag: $('admin-tag'), place: $('place'), mini: $('minimap'), strip: $('hud-compass'), money: $('money'), slots: $('hotbar-slots'), quest: $('quest'),
      status: make('hud-status', '', bar), card: make('hud-place', ''),
    };
    delete this.el.place;   // (the full interface's: here, the card)
    // (experience into its block; the money out of the hotbar, to the top right)
    for (const id of ['xp']) move($(id), this.el.status);
    this.coins = make('hud-coins', '', this.el.status);
    // (top right: the money, what came in or went out, and the time; top left, under the bars: the objective and the help box)
    const right = make('hud-right', ''), left = make('hud-left', '');
    move(this.el.money, right);
    this.el.delta = make('hud-delta', 'hmt', right);
    move(this.el.clock, right);
    move(this.el.quest, left);
    this.el.card.innerHTML = '<b></b><span></span>';
    move($('coords'), this.el.card);
    for (const el of Object.values(this.el)) el?.classList.add('hm');
    this.el.item = make('hud-item', 'hmt', bar);
    this.el.tip = make('hud-tip', 'panel hmt hm-gone', left);
    // (its height, for the chat: written when it changes)
    this.leftSize = new ResizeObserver(() => { const h = left.offsetHeight; if (h !== this.leftH) { this.leftH = h; document.body.style.setProperty('--hl', `${h}px`); } });
    this.leftSize.observe(left);
    this.el.build = make('hud-build', 'panel hud-keys hmt');
    this.el.goal = make('hud-goal', 'hmt');
    this.el.goal.innerHTML = '<i></i><s></s><b></b>';
    this.el.bow = make('hud-bow', 'hmt');
    this.el.bow.innerHTML = '<svg viewBox="0 0 44 44"><circle class="bg" cx="22" cy="22" r="17"/><circle class="fg" cx="22" cy="22" r="17" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg><b></b>';
    this.made = [this.el.status, this.el.item, this.el.build, this.el.goal, this.el.bow, this.el.card, left, right];
    this.hintEl = $('hint');
    // (Controls: Tab now also shows the whole interface)
    document.querySelector('[data-i18n="controls.players"]')?.setAttribute('data-i18n', 'hud.controls.tab');
    this.paintCards();
    this.offLang = onLangChange(() => this.paintCards());
    // Tab held: everything in sight (input.js keeps doing the player list and stops the browser from moving the focus).
    // Any key of a tip, pressed: that one is known, whether it was showing or not
    this.listeners = [
      ['keydown', e => {
        if (e.target instanceof HTMLInputElement) return;
        if (e.code === 'Tab' && !e.repeat && game.mode === 'play' && game.player && !game.wheel?.open) { this.hold(true); this.solo(); }   // (not over the tool wheel)
        const id = Object.keys(TIPS).find(k => TIPS[k].code === e.code);
        if (id && (!TIPS[id].ride || game.player?.mount)) this.learnt(id);
      }, true],
      ['keyup', e => { if (e.code === 'Tab') this.hold(false); }],
      ['blur', () => this.hold(false)],
    ];
    for (const [type, fn, capture] of this.listeners) addEventListener(type, fn, capture);
  }

  // Off: the full interface back exactly as it was (each part in its place, without the classes and the parts added
  // here), so the setting can swap them while playing
  // (it also undoes a constructor that failed halfway: each step only if it was done)
  destroy() {
    for (const [type, fn, capture] of this.listeners || []) removeEventListener(type, fn, capture);
    this.offLang?.();
    if (this.el) this.beat(-1);
    for (const [el, parent, next] of (this.moved || []).reverse()) parent.insertBefore(el, next?.parentNode === parent ? next : null);
    this.leftSize?.disconnect(); document.body.style.removeProperty('--hl');
    for (const el of [...['clock', 'tag', 'mini', 'strip', 'money', 'slots', 'quest'].map(k => this.el?.[k]), this.hintEl]) {
      el?.classList.remove('hm', 'hm-on', 'hm-compact', 'hm-quiet');
      if (el?.getAttribute('class') === '') el.removeAttribute('class');   // (the money had none)
    }
    for (const el of this.made || Object.values(this.el || {}).filter(el => el?.id?.startsWith('hud-'))) el.remove();
    this.style?.remove();
    document.body.classList.remove('hud-min', 'hud-all', 'hm-solo', 'hm-mini');
    const tab = document.querySelector('[data-i18n="hud.controls.tab"]');
    if (tab) { tab.setAttribute('data-i18n', 'controls.players'); tab.textContent = t('controls.players'); }
    const map = this.game.map;
    if (map) { map.goal = null; this.game.minimap?.kick(); }   // (the full interface draws the minimap always: now)
    // (the bars: without the timers of this interface, and painted again for the full one)
    try { this.game.needsBar?.reset(); this.game.needsBar?.kick(); } catch (e) { reportFault(e, 'NeedsBar.reset'); }
  }

  paintCards() {
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
    document.body.classList.toggle('hm-solo', !this.game.live?.othersPlaying);
  }

  // ---------- each frame (from game.render) ----------
  frame(hint) {
    const g = this.game, p = g.player, T = now();
    if (!p || !g.world || g.mode !== 'play') return;
    if (p !== this.player) this.start(p, T);
    const surv = g.gamemode === 'survival', spect = g.gamemode === 'spectator';
    const talking = g.busy || hud.dialogOpen, wins = !!g.windowsOpen, all = T < this.allUntil, wheel = !!g.wheel?.open;
    const c = g.combat, inv = g.inv, show = (k, s) => { this.until[k] = Math.max(this.until[k] || 0, T + s); };
    const dt = Math.min(0.25, T - (this.last ?? T));
    this.last = T;

    const nb = g.needsBar, n = g.needs || {};
    const thirst = Number.isFinite(n.thirst) ? n.thirst / THIRST_MAX : 1, rest = Number.isFinite(n.rest) ? n.rest / REST_MAX : 1;
    const stam = Number.isFinite(n.stamina) ? n.stamina : STAMINA_MAX, cap = Number.isFinite(n.cap) ? n.cap : STAMINA_MAX;
    const airMax = n.airMax || 1, air = Number.isFinite(n.air) ? n.air : airMax, under = !!n.headUnder;
    const noThirst = apagada('sed'), noRest = apagada('cansancio');
    // Health: a hit (5 s); healing when it starts and when it is full again (3 s), not each tick of regen
    if (c.hp !== this.hp) {
      if (this.hp !== undefined && surv) {
        if (c.hp < this.hp) nb?.show('hp', SHOW.hurt);
        else if (T - this.healAt > HEAL_NEW || c.hp >= HP_MAX) nb?.show('hp', SHOW.heal);
        if (c.hp > this.hp) this.healAt = T;
      }
      this.hp = c.hp;
    }
    // Hunger and thirst: each 10 % step down from 60 %, and eating or drinking (4 s); always when low
    const foodStep = Math.floor(c.hunger / HUNGER_MAX * 10);
    if (c.hunger !== this.food) {
      if (this.food !== undefined && surv && (c.hunger > this.food || (foodStep !== this.foodStep && c.hunger <= SHOW_FOOD))) nb?.show('food', SHOW.hunger);
      this.food = c.hunger; this.foodStep = foodStep;
    }
    const waterStep = Math.floor(thirst * 10);
    if (Math.abs(thirst - (this.water ?? thirst)) > 1e-4 || this.water === undefined) {
      if (this.water !== undefined && surv && !noThirst && (thirst > this.water + 1e-4 || (waterStep !== this.waterStep && thirst <= 0.6))) nb?.show('water', SHOW.thirst);
      this.water = thirst; this.waterStep = waterStep;
    }
    // Energy: a long sprint (stamina under half of its cap, or worn out), until it is back over 60 % and 1.5 s more; a
    // change of rest (sleeping, a nap, each 10 % step)
    if (stam < cap * 0.5 || n.exhausted) this.enLow = true;
    else if (this.enLow && stam > cap * 0.6) this.enLow = false;
    if (this.enLow && surv) nb?.show('en', SHOW.linger);
    else if (surv && (p.sprinting || p.fastSwim) && stam < cap * 0.95) nb?.show('en', SHOW.sprint);   // (only the sprint spends it: in sight while it drains, as in GTA)
    const restStep = Math.floor(rest * 10);
    if (restStep !== this.restStep) {
      if (this.restStep !== undefined && surv && !noRest) nb?.show('en', SHOW.rest);
      this.restStep = restStep;
    }
    // Air: while the head is under water and until it is full again, then 1.5 s
    if (surv && (under || air < airMax - 1e-3)) nb?.show('air', SHOW.linger);
    if ((this.tick = (this.tick || 0) + dt) >= 0.25) { this.tick = 0; this.slow(g, p, T, show); }
    // Money (with what came in or went out) and experience
    if (g.money !== this.money) {
      if (this.money !== undefined) { this.delta(g.money - this.money, T); show('money', SHOW.money); }
      this.money = g.money;
      hud.coins(this.coins, g.money);
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
      if (this.tip === 'hungry' || this.tip === 'thirsty') this.paintTip(this.tip);   // (the food or the drink taken: now it says to click)
    }
    // The first steps: whole when they change, then just the task
    if (g.steps.shown !== this.stepKey) {
      if (this.stepKey !== undefined && g.steps.i > this.stepI) this.want('journal');
      if (g.steps.i !== this.stepI) this.bed = null;   // (where the bed is, looked for again)
      this.stepKey = g.steps.shown; this.stepI = g.steps.i;
      show('quest', SHOW.quest);
    }
    // The place, when it is a new one (after a jump or a door in the dark, once it can be seen)
    // (the named area: a step over a border and back is not entering it, and the same name is not said again for a while)
    // (with what goes under it: closing the door of a room is told too, structure.js roomAt)
    const place = g.placeSub ? `${g.placeName} · ${g.placeSub}` : g.placeName;
    if (place !== this.placeName) { this.placeName = place; this.placeAt = T; this.placeDue = !!place; }
    if (this.placeDue && T - this.placeAt > PLACE_SETTLE && !g.jumping && !talking) {
      this.placeDue = false;
      if (this.placeName !== this.placeSaid && !(T - this.placeTimes.get(this.placeName) < PLACE_AGAIN)) { show('card', SHOW.place); this.paintPlace(g, p); }
      this.placeSaid = this.placeName; this.placeTimes.set(this.placeName, T);
    }
    if (all && !this.on.all) this.paintPlace(g, p);   // (Tab: where you are now)
    if (g.gamemode !== this.gm) { if (this.gm !== undefined) show('tag', SHOW.tag); this.gm = g.gamemode; if (this.tip === 'all') this.paintTip('all'); }
    // After the first look at everything, once: Tab is there
    if (!this.toldTab && T - this.started > SHOW.intro) { this.toldTab = true; this.want('all'); }
    // The minimap (or the compass strip, its mode 'compass'): while you travel (outside the village, or riding or sailing anywhere;
    // the strip, also walking indoors and in caves)
    const moved = Math.hypot(p.x - this.px, p.y - this.py);
    this.px = p.x; this.py = p.y;
    if (moved > 0.004 && moved < 2) { this.moveT += dt; this.stillT = 0; } else if ((this.stillT += dt) > 0.6) this.moveT = 0;
    const riding = p.mount || p.boat || p.aboard, world = g.scene === g.world, outside = world && !g.indoors;
    if (outside && (riding ? this.moveT > 0.3 : this.moveT > 1 && !inBounds(p.x, p.y))) show('mini', SHOW.mini);
    const mode = miniMode();
    if (mode === 'compass' && !outside && this.moveT > 1) show('mini', SHOW.mini);
    // (with a marked route it stays, as in GTA: where to turn is on it)
    const R = g.route;
    if (R?.active && outside) show('mini', SHOW.held);
    // (a horse coming to your whistle, or just out of earshot: its marker is on the minimap, so the minimap shows; slow()
    // looks four times a second)
    if (this.horseMini && outside) show('mini', SHOW.mini);
    if (g.huntOverlay?.on && outside) show('mini', SHOW.mini);   // (hunting: your noise ring and the wind are on it)

    // What shows now
    const crit = {
      hearts: surv && c.hp <= LOW_HP, hunger: surv && c.hunger <= LOW_FOOD,
      water: surv && !noThirst && thirst <= LOW.water, rest: surv && !noRest && rest <= LOW.rest,
      air: surv && under && air / airMax <= LOW.air,
    };
    const heldDef = ITEMS[inv.held?.id], up = k => (this.until[k] || 0) > T;
    const free = !talking;   // (talking, only what is critical: as in RDR2)
    const drinkHeld = isDrink(inv.held);
    // The bars: each one critical while it is (health also in danger, short of air, or starving or parched); holding
    // food or a drink, that bar; with a window or the tool wheel open, all of them (in a dialogue, only the critical ones)
    if (nb) {
      const hpOwn = crit.hearts || (surv && (this.danger || c.hunger <= 0 || (!noThirst && thirst <= 0)));
      nb.crit('hp', hpOwn || crit.air, !hpOwn);   // (short of air: health shows too, but the name tag is the air's)
      nb.crit('food', crit.hunger);
      nb.crit('water', crit.water);
      nb.crit('en', crit.rest || (surv && !!n.exhausted));
      nb.crit('air', crit.air);
      // (the horse's stamina, riding: while it gallops or is not full, and 2 s more; critical under 20 %. NeedsBar hides
      // the row on foot whatever is asked here)
      const H = g.horse, rides = surv && !!p.mount && !!H && !H.off, hs = rides && Number.isFinite(H.stam) ? H.stam / STAM_MAX : 1;
      if (rides && (H.galloping === true || hs < HORSE_FULL)) nb.show('horse', SHOW.horse);
      nb.crit('horse', rides && hs < LOW.horse);
      if (free && surv && heldDef?.food && c.hunger < HUNGER_MAX) nb.show('food', SHOW.held);
      if (free && surv && !noThirst && drinkHeld && thirst < 1) nb.show('water', SHOW.held);
      nb.context(wins || wheel, talking);
    }
    // (the block of experience: with the tool wheel open, as with a window; and with the weight inventory, while the
    // load matters: carry.js; the meter goes in this block, ui/loadmeter.js)
    this.set('status', free && (up('status') || wins || wheel || !!g.carry?.showLoad()));
    this.set('money', free && !spect && up('money'));   // (with a window open it would be under it: in survival it is in the block)
    this.set('wins', wins, this.el.status, 'hm-wins');
    // (hungry with food in the hotbar: it stays, and that slot beats; during the first steps, which name the slots by
    // number, it stays too; and with a window open, as in Minecraft: you move things to it and from it, and the block
    // of health sits next to it instead of floating by an empty place)
    // (thirsty with a drink in the hotbar, the same with that slot; hunger first)
    const feed = crit.hunger && this.foodSlot >= 0, quench = crit.water && this.drinkSlot >= 0;
    this.set('slots', free && !wheel && (up('slots') || feed || quench || wins || !g.steps.over));
    this.beat(feed && !heldDef?.food ? this.foodSlot : quench && !drinkHeld ? this.drinkSlot : -1);
    this.set('item', free && up('item'));
    this.set('delta', free && up('delta'));
    this.set('clock', free && (up('clock') || wins || wheel));
    this.set('tag', free && !wins && up('tag'));
    this.set('card', free && !wins && up('card'));
    this.set('quest', free);
    this.set('compact', !(up('quest') || all), this.el.quest, 'hm-compact');
    // Where to go, while a first step sends you somewhere: the mark over it, and the minimap with it
    const goal = this.goal(g, p, world && free && !wins && !g.build.on);
    this.mapGoal = g.map.goal = goal;
    // The route's pin over its target (routemark.js; in the full HUD route.js moves it), like the goal's mark
    try { R?.mark?.frame(g, outside && free && !wins && !g.build.on, GOAL_NEAR); } catch (e) { reportFault(e, 'RouteMark.frame'); }
    const mini = free && mode !== 'off' && (up('mini') || !!goal || (mode === 'always' && outside));
    this.set('mini', mini);
    this.set('strip', mini);
    this.set('miniBody', (mini || all) && outside, document.body, 'hm-mini');
    this.mini = mini || all || !!g.quick?.open;   // (minimap.js draws only then)
    this.set('all', all, document.body, 'hud-all');
    // The bow: the ring, and its long text only the first times
    const bow = this.bowRing(g, inv, heldDef, free && !wins && !g.build.on);
    // A click hint goes quiet when it has been read (6 s without changing; not in build mode, where it says what goes
    // where), when it only says what you cannot do with what you hold (clicking still says it), and when the bow ring
    // or the prompt at the thing says it already
    if (hint !== this.hint) { this.hint = hint; this.hintAt = T; this.neg = !!hint && !g.build.on && this.negative(g) && hint === g.gather.hint(); }
    const eating = (crit.hunger && heldDef?.food) || (crit.water && drinkHeld);   // (the "Eat bread" of the hungry, and the "Drink" of the thirsty: it stays)
    this.set('quiet', !!hint && !g.build.on && ((T - this.hintAt > STALE_HINT && !eating) || this.neg || bow || wheel || g.prompts?.click), this.hintEl, 'hm-quiet');
    // Build mode: its keys, a moment after entering it
    if (g.build.on !== this.building) { this.building = g.build.on; if (g.build.on) show('build', SHOW.build); }
    this.set('build', g.build.on && free && up('build'));
    // The key tips, one at a time, never over a dialogue, a window or the build bar (what to do when short of air, hurt,
    // hungry, thirsty or tired, first: each one put at the front, so the last one asked is shown first; thirst waits
    // behind hunger, and two tips about needs are never closer than a minute)
    if (crit.water) this.want('thirsty', true);
    if (crit.rest) this.want('tired', true);
    if (crit.hunger) this.want('hungry', true);
    if (crit.hearts && !under) this.want('lowhp', true);   // (under water the advice is the air's: "rest and eat" would be wrong)
    if (crit.air) this.want('air', true);
    // (the body chip, while it shows: what to do about it, once)
    const bc = g.bodyChip, chipTip = surv && CHIP_TIP[bc?.id];
    if (chipTip) this.want(chipTip);
    this.swimT = p.swim ? (this.swimT || 0) + dt : 0;
    if (this.swimT > DIVE_TIP && surv && !apagada('buceo')) this.want('dive');
    this.critNow = crit;
    const tipNow = free && !wins && !g.build.on;
    if (Settings.v.hints === false) { if (this.tip) this.endTip(); this.queue.length = 0; }   // (switched off while one shows or waits)
    if (this.tip && !tipNow) this.tipUntil += dt;   // (it waits, hidden, until the dialogue or the window is over)
    const bcd = bc?.cond;
    const over = { hungry: !crit.hunger, thirsty: !crit.water, tired: !crit.rest, air: !crit.air, lowhp: under,
      cold: !!bcd && !bcd.cold, hot: !!bcd && !bcd.hot, wet: !!bcd && !bcd.soaked, dirty: !!bcd && !bcd.dirty }[this.tip];   // (the need is met: its tip goes; low health's, under water; warm, cool, dry or clean again: the body's)
    if (this.tip && (T > this.tipUntil || over)) this.endTip();
    else if (!this.tip && this.queue.length && tipNow) {
      const i = this.queue.findIndex(id => (id !== 'lowhp' || !under) && (!NEED_TIPS.has(id) || T - this.needTipAt >= NEED_GAP) && (!FIELD_TIPS.has(id) || id === 'blood' || T - this.tipAt >= FIELD_GAP));
      if (i >= 0) this.showTip(this.queue.splice(i, 1)[0], T);
    }
    const tip = !!this.tip && tipNow;
    if (tip !== this.on.tip) { if (tip) this.el.tip.classList.remove('hm-gone'); else this.tipGone = T + 0.6; }
    if (!tip && this.tipGone && T > this.tipGone) { this.tipGone = 0; this.el.tip.classList.add('hm-gone'); }   // (faded out: it takes no room)
    this.set('tip', tip);
  }

  // Four times a second: what needs a look around or the clock
  slow(g, p, T, show) {
    // A creature close by: health stays in sight while it is there
    const near = (g.combat.monsters || []).some(m => Math.hypot(m.x - p.x, m.y - p.y) < DANGER);
    if (near) show('dangerT', 3);
    this.danger = g.gamemode === 'survival' && (this.until.dangerT || 0) > T;
    // (a tip about a need still waiting when that need is met: it is not news any more)
    const cr = this.critNow;
    if (cr && this.queue.length) {
      const bcd = g.bodyChip?.cond;
      const gone = { hungry: !cr.hunger, thirsty: !cr.water, tired: !cr.rest, air: !cr.air, lowhp: !cr.hearts,
        cold: !!bcd && !bcd.cold, hot: !!bcd && !bcd.hot, wet: !!bcd && !bcd.soaked, dirty: !!bcd && !bcd.dirty };
      if (this.queue.some(id => gone[id])) this.queue = this.queue.filter(id => !gone[id]);
    }
    // The time: at dawn and dusk, a new day, a weather change, after sleeping and before a shop of the village closes
    const d = g.days, night = d.isNight(), sky = d.weatherHere, day = d.dayOfSeason, slept = g.stats.get('dormido');
    if (this.night !== undefined && (night !== this.night || sky !== this.sky || day !== this.day || slept !== this.slept)) show('clock', SHOW.clock);
    Object.assign(this, { night, sky, day, slept });
    if (g.scene === g.world && inBounds(p.x, p.y)) {
      const h = d.localHour;
      for (const close of closingOf(d.realDay)) {
        const left = (close - h + 24) % 24, key = `${day}:${close}`;
        if (left > 0 && left <= 0.5 && this.closing !== key) { this.closing = key; show('clock', SHOW.clock); }
      }
    }
    // Someone to greet under the cursor (social.js), the first times: Y
    if (g.social?.picked && T - this.started > 8) this.want('social');
    // A log or a carcass within reach, and then one in the arms (the weight inventory: carry.js), the first times: E, then Q
    const C = g.carry;
    if (C?.bigNow && T - this.started > 8) {
      if (C.held) this.want(p.mount ? 'ride' : p.boat ? 'bow' : 'arms');
      else if (!this.seen.has('bulky') && (g.scene?.placedNear?.(p.x, p.y, 2.2) || []).some(o => BULKY[o.placed])) this.want('bulky');   // (four times a second, until it is known)
    }
    // A wheelbarrow within reach, and then pushing it (barrow.js), the first times: E, then Q
    if (g.barrow && T - this.started > 8) {
      if (g.barrow.pushing) this.want('pushing');
      else if (!this.seen.has('barrow') && !C?.held && (g.scene?.placedNear?.(p.x, p.y, 2.2) || []).some(o => o.placed === 'wheelbarrow')) this.want('barrow');
    }
    // The posture key, once: the first crouch or sitting on the floor, or after a while on foot
    if (T - this.started > 8 && !p.swim && !p.mount && !p.boat && !p.aboard && (p.crouch || p.pose?.kind === 'floorSit' || p.pose?.kind === 'floorLie' || T - this.started > POSTURE_TIP)) this.want('posture');
    // The three speeds, once: after a minute walking on foot without ever jogging (a jog or a sprint makes it known)
    if (p.gait >= 1) { if (!this.seen.has('gait')) this.learnt('gait'); }
    else if (!this.seen.has('gait') && !p.swim && !p.mount && !p.boat && !p.aboard && !p.crouch && !p.pose && Math.hypot(p.vx || 0, p.vy || 0) > 1 && (this.walkT = (this.walkT || 0) + 0.25) > GAIT_TIP) this.want('gait');
    // Hair or beard grown a step (src/body.js applies it at a hidden moment: Plan E §2.5): where to get it cut, once
    const ap = g.body?.applied;
    if (ap) {
      const grown = (ap.hair || 0) + (ap.beard || 0);
      if (grown > (this.grown ?? 0) && g.gamemode === 'survival') this.want('hair');
      this.grown = grown;
    }
    // The horse (Plan F): its marker on the minimap, and its tips
    this.horseLook(g, p, T);
    // Tracking and the nature book (Plan G): a fresh trail within 4 m, a study ring filling, a wounded animal's trail
    // locked for you (tracks.js, nature.js)
    this.fieldTips(g, p, T);
    // Leaving the village for the first time: the map
    if (g.scene === g.world && !g.indoors && !inBounds(p.x, p.y)) this.want('map');
    // A new recipe while playing (not the ones of the start): crafting
    const fresh = g.craft.fresh?.size || 0;
    if (fresh > this.fresh && T - this.started > 8) this.want('craft');
    this.fresh = fresh;
  }

  // Four times a second: whether a horse marker is on the minimap (map.markers, game.js: horse.marks() with mini), and the
  // horse's one-time tips: N once you have a horse, X on the first ride with saddlebags, G after the first scare in the
  // saddle (horse.spooks counts them), H riding a horse that can rear. With ?vinculo=0 there is no whistle, scare or rear
  horseLook(g, p, T) {
    const marks = g.map?.markers;
    let mini = false;
    if (marks) for (let i = 0; i < marks.length && !mini; i++) mini = marks[i].kind === 'horse' && !!marks[i].mini;
    this.horseMini = mini;
    const H = g.horse;
    if (!H || T - this.started < 8) return;
    const on = !H.off;
    if (on && !p.mount && !this.seen.has('whistle')) {
      const mine = g.ranch?.myHorse?.();
      if (mine) { this.names.whistle = mine.name || ''; this.want('whistle'); }
    }
    // (Space over a fence, the first time the horse refuses one: horse.fences counts them, R4-1)
    if (H.fences > 0 && p.mount && !this.seen.has('jump_fence')) this.want('jump_fence', true);
    if (!p.mount || (this.seen.has('bags') && this.seen.has('pat') && this.seen.has('rear'))) { this.spooks = H.spooks; return; }
    // (the horse under you: horse.js keeps it in ridden; until then, the one ranch.mount wrote in horseId)
    const rid = H.ridden || g.ranch?.animals?.find(a => a.id === p.horseId) || null;
    if (!this.seen.has('bags') && (rid ? Array.isArray(rid.bags) : !!p.horseBags)) this.want('bags');
    if (on && Number.isFinite(H.spooks)) {
      if (Number.isFinite(this.spooks) && H.spooks > this.spooks && !this.seen.has('pat')) { this.names.pat = rid?.name || ''; this.want('pat', true); }
      this.spooks = H.spooks;
    }
    if (on && rid && !this.seen.has('rear') && levelOf(rid.love || 0) >= REAR_LEVEL) this.want('rear');
  }

  // A new game: a short look at everything that matters, then it goes
  start(p, T) {
    this.player = p;
    this.until = {};
    for (const k of ['clock', 'tag', 'slots']) this.until[k] = T + SHOW.intro;
    this.until.quest = T + SHOW.quest;
    for (const k of ['hp', 'food', 'foodStep', 'water', 'waterStep', 'restStep', 'money', 'xp', 'level', 'invV', 'sel', 'stepKey', 'stepI', 'placeName', 'placeSaid', 'gm', 'night', 'count', 'sig', 'bed', 'critNow', 'grown']) this[k] = undefined;
    this.fresh = Infinity;   // (the first look only counts them)
    this.foodSlot = -1; this.foodBag = false; this.drinkSlot = -1; this.drinkBag = false;
    this.healAt = -Infinity; this.enLow = false; this.swimT = 0; this.needTipAt = -Infinity; this.tipAt = -Infinity; this.fieldAt = 0;
    this.horseMini = false; this.spooks = undefined; this.names = { whistle: '', pat: '' };   // (the horse: its marker, its scares and the names its tips say)
    try { this.game.needsBar?.reset(); } catch (e) { reportFault(e, 'NeedsBar.reset'); }   // (the bars: no timer of the game before)
    this.px = p.x; this.py = p.y; this.moveT = 0; this.stillT = 0;
    this.started = T; this.toldTab = false; this.placeTimes = new Map(); this.placeDue = false;
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
    let sig = '', count = 0, slot = -1, bag = false, dslot = -1, dbag = false;
    for (let i = 0; i < inv.slots.length; i++) {
      const s = inv.slots[i];
      if (!s) continue;
      count += s.n;
      if (i < HOTBAR) sig += `${i}:${s.id}:${s.n};`;
      if (ITEMS[s.id]?.food) { if (i < HOTBAR) { if (slot < 0) slot = i; } else bag = true; }
      if (isDrink(s)) { if (i < HOTBAR) { if (dslot < 0) dslot = i; } else dbag = true; }   // (a drink, or a canteen with water)
    }
    if (dslot !== this.drinkSlot || dbag !== this.drinkBag) { this.drinkSlot = dslot; this.drinkBag = dbag; if (this.tip === 'thirsty') this.paintTip('thirsty'); }
    if (this.sig !== undefined && sig !== this.sig) show('slots', SHOW.slots);
    if (this.count !== undefined && count > this.count && now() - this.started > 8) this.want('bag');   // (picked something up)
    this.sig = sig; this.count = count;
    if (slot !== this.foodSlot || bag !== this.foodBag) { this.foodSlot = slot; this.foodBag = bag; if (this.tip === 'hungry') this.paintTip('hungry'); }
    const h = inv.held, max = h && ITEMS[h.id]?.dur;
    if (max && h.dur !== undefined && h.dur / max < 0.15 && this.worn !== h) { this.worn = h; show('slots', SHOW.slots); }
    if (inv.count('tablas') >= 6) this.want('build');
    // (three tools or more in the hotbar: the tool wheel is worth knowing)
    let tools = 0;
    for (let i = 0; i < HOTBAR; i++) { const d = ITEMS[inv.slots[i]?.id]; if (d && (d.tool || d.weapon || d.bow)) tools++; }
    if (tools >= 3 && now() - this.started > 8) this.want('wheel');
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
    // (an empty slot: no name; a bow with no arrows: the red ring says it. Either way the name before goes, or it would
    // stay over the new slot)
    if (!name || (ITEMS[s.id].bow && !this.game.archery.arrows())) { this.until.item = 0; return; }
    this.el.item.textContent = name;
    this.until.item = T + SHOW.name;
  }
  delta(n, T) {
    if (!n) return;
    const el = this.el.delta;
    el.textContent = `${n > 0 ? '+' : '−'}${Math.abs(n)}`;
    el.className = `hmt ${n > 0 ? 'up' : 'down'}${this.on.delta ? ' hm-on' : ''}`;
    this.until.delta = T + SHOW.money;
  }

  // The card of the area: its name and, under it, how far from home (in the wild) or whose village it is
  paintPlace(g, p) {
    const name = g.placeName || '', [b, small] = this.el.card.children;
    let sub = g.placeSub || '';
    if (g.scene === g.world && !g.underRoof) {
      const d = Math.hypot(dxOf(p.x, CENTER.x), p.y - CENTER.y);
      if (!inBounds(p.x, p.y)) sub = t('place.wild', { dist: d < 1000 ? t('minimap.dist', { n: Math.round(d / 10) * 10 }) : t('minimap.dist_km', { n: fmt.num(d / 1000, { maximumFractionDigits: 1 }) }) });
    }
    if (b.textContent !== name) b.textContent = name;
    if (small.textContent !== sub) small.textContent = sub;
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
    markAt(this.el.goal, at, p, g.view3d, g.scene, this.goalCache ||= {}, this.v3);   // (the projection, shared with the route's pin: routemark.js)
    if (!this.goalAt || this.goalAt.x !== at.x || this.goalAt.y !== at.y) this.goalAt = { x: at.x, y: at.y };
    return this.goalAt;
  }

  // ---------- the bow ----------
  // With the bow in hand, the ring at the cursor (at the crosshair in first person): how drawn it is and the arrows left
  // (red with none). Returns whether it says what the click hint would: with arrows, after the first draws; with none,
  // always but the first time (per account), when the text "no arrows left" goes with the ring
  bowRing(g, inv, def, can) {
    const on = !!def?.bow && can;
    this.set('bow', on);
    const drawing = g.archery.drawT !== null;
    if (drawing && !this.drawing && this.bowDraws < BOW_TEXT) { this.bowDraws++; this.seen.add('bow' + this.bowDraws); this.saveSeen(); this.longBow = true; }
    if (!drawing && this.drawing) this.longBow = false;
    this.drawing = drawing;
    if (!on) { this.emptyText = undefined; return false; }
    const el = this.el.bow, n = g.archery.arrows(), k = g.archery.k;
    if (n) this.emptyText = undefined;
    else if (this.emptyText === undefined) { this.emptyText = !this.seen.has('bow0'); if (this.emptyText) { this.seen.add('bow0'); this.saveSeen(); } }
    const m = CAM.first || !g.mouse?.in ? { x: innerWidth / 2, y: innerHeight / 2 } : g.mouse;
    if (Math.abs(m.x - this.bowX) > 0.5 || Math.abs(m.y - this.bowY) > 0.5 || !(this.bowX >= 0)) {
      this.bowX = m.x; this.bowY = m.y;
      el.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`;
    }
    const fill = Math.round(k * 100);
    if (fill !== this.bowFill) { this.bowFill = fill; el.querySelector('.fg').setAttribute('stroke-dashoffset', String(100 - fill)); el.classList.toggle('full', fill >= 100); }
    if (n !== this.bowN) { this.bowN = n; el.lastChild.textContent = n === Infinity ? '∞' : String(n); el.classList.toggle('empty', !n); }
    return n ? this.bowDraws >= BOW_TEXT && !this.longBow : !this.emptyText;
  }

  // Is the click hint only "you need the scythe / the axe / the pickaxe" (what you hold cannot take what you point at)?
  negative(g) {
    const tg = g.gather.target, o = tg?.obj, rule = o && HARVEST[o.kind], def = ITEMS[g.inv.held?.id];
    if (!rule || tg.label !== undefined || tg.free || def?.food || def?.heal || def?.place || def?.tool === 'azada') return false;
    return !(def?.tool === rule.tool || (!def?.tool && rule.hand));
  }

  // The tips of tracking and the nature book: each one asked for only while it is true and could show now (no tip in
  // sight, a minute since the last one); one that could not show within FIELD_WAIT (a window open) is dropped
  fieldTips(g, p, T) {
    const tr = g.tracks, st = g.nature?.study, blood = !!tr?.bleeding && !this.seen.has('blood');
    if (!this.seen.has('tracks') && g.nature?.tr?.size) this.learnt('tracks');   // (E on a print already: it knows how)
    if (this.queue.length && T - this.fieldAt > FIELD_WAIT && this.queue.some(id => FIELD_TIPS.has(id))) this.queue = this.queue.filter(id => !FIELD_TIPS.has(id));
    if (g.gamemode === 'spectator' || this.tip || (!blood && T - this.tipAt < FIELD_GAP) || T - this.started < 8) return;
    const id = blood ? 'blood' : g.huntOverlay?.tip(this.seen) || (st && !st.done && st.k > 0.15 ? 'study' : tr?.freshNear && g.scene === g.world && !p.swim ? 'tracks' : null);
    if (!id || this.seen.has(id) || this.queue.includes(id)) return;
    this.fieldAt = T;
    this.want(id, true);
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
    if (this.seen.has(id) || this.tip === id || this.queue.includes(id) || Profile.server || Settings.v.hints === false) return;   // (Settings › Game › Key hints)
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
    this.tipAt = T;
    if (NEED_TIPS.has(id)) this.needTipAt = T;
    this.seen.add(id);
    this.saveSeen();
    this.tipSig = null;
    const text = this.paintTip(id);
    Audio.ui('tick');
    this.tipUntil = T + (text.length > 48 ? SHOW.tip : SHOW.tipShort);
  }
  // Hungry: what to do depends on where the food is (in hand, in the hotbar, in the bag or nowhere)
  hungryTip() {
    const i = this.foodSlot;
    if (ITEMS[this.game.inv.held?.id]?.food) return [t('key.click'), 'eat'];
    if (i >= 0) return [String(i + 1), 'take', { n: i + 1 }];
    return this.foodBag ? ['I', 'bag'] : [null, 'none'];
  }
  // Thirsty: the same, with the drinks (a canteen or a jug with water counts); with none, the water of the world, with E
  thirstyTip() {
    const i = this.drinkSlot;
    if (isDrink(this.game.inv.held)) return [t('key.click'), 'drink'];
    if (i >= 0) return [String(i + 1), 'take', { n: i + 1 }];
    return this.drinkBag ? ['I', 'bag'] : ['E', 'none'];
  }
  paintTip(id) {
    // (Tab's: in creative and as a spectator there is no health to see)
    // (the horse's: its name, whichever horse it was about; escaped, it may come from another player)
    const [k, sub, params] = id === 'hungry' ? this.hungryTip() : id === 'thirsty' ? this.thirstyTip() : id === 'all' && this.game.gamemode !== 'survival' ? [TIPS.all.key, 'nohealth']
      : id === 'whistle' || id === 'pat' ? [TIPS[id].key, null, { name: this.names?.[id] || '' }] : [TIPS[id].key];
    const text = tHtml(`hud.tip.${id}${sub ? '.' + sub : ''}`, params), sig = `${k}|${text}`;
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

// Put the minimal interface on, or take it off and give the full one back as it was: at the start (main.js) and from
// the setting, while playing, without reloading
let building = null;   // (the SmartHud being made, so a constructor that fails halfway can be undone)
export function useSmartHud(game, on) {
  if (!on === !game.smartHud) return game.smartHud;
  try {
    if (on) game.smartHud = new SmartHud(game);
    else { const sh = game.smartHud; game.smartHud = null; sh.destroy(); }
  } catch (e) {
    reportFault(e, 'SmartHud');
    // (failed halfway on: give the full interface back whole, not half moved with the health hidden)
    if (on && building && !game.smartHud) try { building.destroy(); } catch { /* as it is */ }
  }
  building = null;
  return game.smartHud;
}
