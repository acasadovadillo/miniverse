// The loading screen (docs/planes/realismo/PLAN-R9-menus.md §3.6; section s-load): a picture of the game (keyart.js), where and
// when you will appear, what you did the last time (recap.js), a tip that changes and, at the bottom right, what is being
// waited for. menus.js shows it on entering the world and takes it away when the view is ready (the promise that lifted the
// black fade, which stays under it and covers as always what follows: a far /tp, dying); anything that goes wrong meanwhile
// takes it away too, with the menu and its message behind. Nothing runs per frame, and only the ring moves (the compositor
// turns it, a small square): the graphics card is for the loading.
// Not in the automatic tests (they ask for it: on), on the world server nor in the bench: there, only the fade
import { t, fmt, onLangChange } from '../i18n.js';
import { Profile } from '../accounts.js';
import { reportFault } from '../faults.js';
import { recapOf } from '../recap.js';
import { madridMs, seasonOf } from '../time.js';
import { inBounds } from '../world/village.js';
import { distOf } from '../world/planet.js';
import { playedText } from './progresspage.js';
import { FE, legend } from './frontend.js';
import { KeyArt } from './keyart.js';
import { dayAndSeason, whenText } from './mainmenu.js';

const $ = id => document.getElementById(id);
const MIN_MS = 1200, OUT_MS = 600, TIP_MS = 8000, TIP_FADE = 250;
const LEAVE_MS = 3000;     // waiting for the network this long, it says that Esc goes back
const SINCE_MS = 60000;    // the world saved this long after yours is a later session
const NEAR_PLACE = 48;     // tiles from a known place to say its name
const q = new URLSearchParams(globalThis.location?.search || '');
const PLAIN = ['pruebas', 'servidor'].includes(q.get('modo')) || q.has('banco');
const frame = () => new Promise(r => { const x = setTimeout(r, 150); requestAnimationFrame(() => { clearTimeout(x); r(); }); });   // (hidden, there are no frames)

// ---------- tips ----------
// How many there are: the keys tip.1 … tip.N of the language files (a new one, at the end)
export const TIPS = 45;
export const tipText = n => t(`tip.${n}`);
// Shuffled, and none again until all have been seen (they go on from one loading to the next)
let deck = [];
function nextTip() {
  if (!deck.length) {
    deck = Array.from({ length: TIPS }, (_, i) => i + 1);
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  }
  return deck.pop();
}
export const tipsHtml = () => `<ul class="ps-tips">${Array.from({ length: TIPS }, (_, i) => `<li>${tipText(i + 1).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</li>`).join('')}</ul>`;

// ---------- what it says ----------
// The last session in one sentence, or '' (an old save, or nothing done)
export function recapText(save, now = Date.now()) {
  const r = recapOf(save);
  if (!r) return '';
  const did = Object.entries(r.d).map(([k, n]) => t(`load.recap.${k}`, { n })), p = { when: whenText(r.at, now), dur: r.mins ? playedText(r.mins * 60000) : '' };
  if (!did.length) return t('gui.load.last_played', p);
  return `${t(r.mins ? 'gui.load.last_time' : 'gui.load.last_brief', p)} ${fmt.list(did)}.`;
}
// Where a save's character will appear, if it is known without the world: the village (or '')
function whereOf(save) {
  const p = save?.livePos && !Profile.admin ? save.livePos : save?.player;
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) && inBounds(p.x, p.y) ? t('gui.load.village') : '';
}
// The day, the season and the hour, of a save (the world's own day is not known yet for whoever plays in another's)
function whenOf(save) {
  const { day, season } = dayAndSeason(save), ms = madridMs() + (save.timeShift || 0) * 3600000;
  return [day > 0 && save.inventory ? t('gui.pause.day', { n: day }) : '', t(`nature.season.${season}`), clock((ms % 86400000) / 3600000)].filter(Boolean).join(' · ');
}
const clock = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
// The same, of a game that has started: the place it is at, if they know it, or the kind of land
function whereNow(game) {
  const p = game.player;
  if (inBounds(p.x, p.y)) return t('gui.load.village');
  let best = null, bd = NEAR_PLACE;
  for (const k of game.places.knownPlaces()) { const d = distOf(p.x, p.y, k.x, k.y); if (d < bd) { bd = d; best = k; } }
  return best ? game.places.title(best) : cap(t(`nature.biome.${game.world.gen.biomeAt(p.x, p.y)}`));
}
function whenNow(game) {
  const d = game.days;
  return [t('gui.pause.day', { n: d.dayIndex + 1 }), t(`nature.season.${d.localSeason}`), clock(d.localHour)].join(' · ');
}

export function initLoading(game) {
  const el = $('s-load');
  let token = 0, up = false, screen = null, shownAt = 0, tipTimer = 0, leaveTimer = 0, outTimer = 0, tip = 0, save = null, started = false, status = null, leave = null, names = [], since = null;
  const L = {
    enabled: !PLAIN && !!el, TIMES: { min: MIN_MS, out: OUT_MS, tip: TIP_MS, leave: LEAVE_MS },
    get on() { return up; },
    // Shows it for the character of a save. what(): the text beside the ring (asked again if the language changes); names: who is playing;
    // onLeave(): Esc, while it is still waiting for the network, goes back to the menu. Returns when it is in sight: what
    // comes after (starting the game) may keep the screen from being painted
    async show(s, { what = null, others = [], onLeave = null } = {}) {
      if (!L.enabled) return;
      save = s; started = false; status = what; leave = onLeave; names = others; since = null;
      if (!up) {
        up = true; token++;
        shownAt = performance.now();
        clearTimeout(outTimer);
        el.classList.remove('out', 'leave');
        KeyArt.paintLoad(el.querySelector('.ld-art'));
        el.classList.add('show');
        screen = FE.open('s-load', { root: true, sound: null, back: () => { if (!el.classList.contains('leave') || !leave) return false; leave(); return true; }, parts: [{ key: () => true }] });
        setTip(nextTip());
        tipTimer = setInterval(() => { el.classList.add('tip-out'); setTimeout(() => { if (up) setTip(nextTip()); el.classList.remove('tip-out'); }, TIP_FADE); }, L.TIMES.tip);
        if (onLeave) leaveTimer = setTimeout(() => { if (leave) { el.classList.add('leave'); paintLegend(); } }, L.TIMES.leave);
      }
      paint();
      await frame(); await frame();
    },
    // The text beside the ring
    say(what) { status = what; if (up) paintStatus(); },
    // From here it cannot be left: the game starts (game.start), and then (started) it says how it is there. What it returns is for ready
    starting() { leave = null; clearTimeout(leaveTimer); el.classList.remove('leave'); L.say(null); return token; },
    started() { if (!up) return; started = true; paint(); },
    // Who saved the shared world last (an account's id; not the server) and when: if it was somebody else, after your last session, it says so
    since(by, at) { since = typeof by === 'string' && by && by !== Profile.id && by !== 'servidor' && at > (recapOf(save)?.at || Infinity) + SINCE_MS ? { name: cap(by), at } : null; if (up) paint(); },
    // The world of that entering is ready: at least MIN_MS after it was shown, it fades out, and the keys are the game's at
    // once. then(): just before (the black fade under it goes). Another entering, or the menu, meanwhile: only then()
    async ready(mine, then) {
      if (up && mine === token) { const left = L.TIMES.min - (performance.now() - shownAt); if (left > 0) await new Promise(r => setTimeout(r, left)); }
      then?.();
      if (!up || mine !== token) return;
      drop();
      el.classList.add('out');
      outTimer = setTimeout(hide, L.TIMES.out);
    },
    // At once, whatever it was waiting for (back in the menu)
    abort() { if (!up) { if (el?.classList.contains('out')) { clearTimeout(outTimer); hide(); } return; } drop(); hide(); },
    tip: () => tip,   // (for the tests)
  };
  // It is not in charge any more: its keys and its timers
  function drop() {
    up = false; token++; leave = null;
    clearInterval(tipTimer); clearTimeout(leaveTimer); clearTimeout(outTimer);
    if (screen) { FE.close(screen); screen = null; }
  }
  function hide() { el.classList.remove('show', 'out', 'leave', 'tip-out'); }
  function setTip(n) { tip = n; $('ld-tip').textContent = tipText(n); }
  function paintStatus() { $('ld-status').textContent = status ? status() : t('gui.load.loading'); }
  function paintLegend() { legend($('ld-legend'), [{ keys: ['Esc'], text: t('gui.legend.back'), onClick: () => FE.back() }]); }
  // (an odd save, or a place that cannot be named, leaves a line empty: never the player without entering)
  function paint() {
    const put = (id, fn) => { let text = ''; try { text = fn() || ''; } catch (e) { reportFault(e, `Loading.${id}`); } $(id).textContent = text; };
    put('ld-where', () => (started ? whereNow(game) : whereOf(save)));
    put('ld-when', () => (started ? whenNow(game) : whenOf(save)));
    put('ld-recap', () => recapText(save));
    put('ld-with', () => (since ? t('gui.load.since', { name: since.name, when: whenText(since.at) }) : names.length ? t('gui.menu.card.playing', { names: fmt.list(names), n: names.length }) : ''));
    paintStatus();
    if (el.classList.contains('leave')) paintLegend();
  }
  onLangChange(() => { if (up) { paint(); setTip(tip); } });
  return L;
}
