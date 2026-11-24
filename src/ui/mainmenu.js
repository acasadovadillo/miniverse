// The main menu and its credits (docs/planes/realismo/PLAN-R9-menus.md §3.3): over the key art (ui/keyart.js), the list on the
// left with a line that describes the selected item, your character's card on the right, how the server is at the bottom left
// and the keys at the bottom right. What each item does is menus.js's: here is only how it is shown and moved through.
// Nothing runs per frame: only the credits, while they are open, scroll by themselves.
import { t, fmt, onLangChange } from '../i18n.js';
import { Audio } from '../audio.js';
import { Profile } from '../accounts.js';
import { Settings } from '../settings.js';
import { madridMs, seasonOf } from '../time.js';
import { ITEMS } from '../items.js';
import { dressed } from '../looks.js';
import { portrait3D } from '../three/portrait.js';
import { reportFault } from '../faults.js';
import { GAME_VERSION } from '../version.js';
import { FE, list, legend, paneNav } from './frontend.js';

const $ = id => document.getElementById(id);
const DAY_MS = 86400000, HOUR_MS = 3600000;
export const MENU_ITEMS = ['m-continue', 'm-local', 'm-new', 'm-settings', 'm-credits', 'm-session'];

// When something was saved, as it is said: today at 14:05, yesterday at 22:10, on 3 Nov, 14:05
export function whenText(ts, now = Date.now()) {
  const day = d => new Date(d).toDateString(), time = fmt.date(ts, { hour: '2-digit', minute: '2-digit' });
  if (day(ts) === day(now)) return t('gui.menu.when.today', { time });
  if (day(ts) === day(now - DAY_MS)) return t('gui.menu.when.yesterday', { time });
  return t('gui.menu.when.date', { date: dateText(ts) });
}
export const dateText = ts => fmt.date(ts, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// The day and the season of a save's character. The day, only where the save's own world is the one played (the admin's, or a
// game without the server): whoever plays in the world another game runs keeps in their save the world they had before
export function dayAndSeason(save, admin = Profile.admin) {
  const real = Math.floor((madridMs() + (save.timeShift || 0) * HOUR_MS) / DAY_MS), own = (admin || !save.livePos) && Number.isFinite(save.dayBase);
  return { day: own ? real - save.dayBase + 1 : null, season: seasonOf(real).season };
}
// The look of a save's character, dressed (what a newer version added is left out)
export function lookOf(save) {
  const look = save.player.look;
  try { return dressed(look, Object.fromEntries(Object.entries(save.inventory?.equip || {}).filter(([, it]) => it && ITEMS[it.id]))); } catch { return look; }
}

// pick(id): what an item does
export function initMainMenu({ pick }) {
  const soon = globalThis.requestIdleCallback ? fn => requestIdleCallback(fn, { timeout: 600 }) : fn => setTimeout(fn, 60);
  let screen = null, save = null, local = null, live = { names: [], reason: '' }, busy = false, faceLook = null;
  const L = list($('mm-list'), MENU_ITEMS.map(id => ({ id, el: $(id) })), { start: -1, hover: 'over', desc: $('mm-desc'), onPick: r => pick(r.id) });
  const DESC = {
    'm-continue': () => live.reason || (live.names.length ? t('gui.menu.desc.continue_live', { names: fmt.list(live.names), n: live.names.length }) : t('gui.menu.desc.continue')),
    'm-local': () => (local ? t('gui.menu.desc.local_saved', { when: whenText(local.savedAt) }) : t('gui.menu.desc.local')),
    'm-new': () => t(save ? 'gui.menu.desc.new' : 'gui.menu.desc.create'),
    'm-settings': () => t('gui.menu.desc.settings'),
    'm-credits': () => t('gui.menu.desc.credits'),
    'm-session': () => t('gui.menu.desc.logout'),
  };
  function paint() {
    $('menu-hello').textContent = t('gui.menu.hello', { name: Profile.name || '' });
    $('menu-role').hidden = !Profile.admin;
    const word = $('m-new').firstElementChild;
    word.dataset.i18n = save ? 'gui.menu.new' : 'gui.menu.create';
    word.textContent = t(word.dataset.i18n);
    L.set('m-continue', { hidden: !save });
    L.set('m-local', { hidden: !save && !local });   // (it needs a character: the local world starts with the same looks)
    L.settle();
    for (const id of MENU_ITEMS) L.set(id, { desc: DESC[id]() });
    paintCard();
  }
  function paintCard() {
    const p = save?.player;
    $('mm-card').classList.toggle('none', !p);
    $('mm-name').textContent = p ? p.name : '';
    $('menu-save').textContent = p ? t('gui.menu.card.saved', { when: whenText(save.savedAt) }) : t('gui.menu.card.none');
    $('mm-when').textContent = '';
    $('mm-money').textContent = p ? t('gui.pause.money', { n: Number.isFinite(save.money) ? save.money : 0 }) : '';
    if (p) {
      const { day, season } = dayAndSeason(save), name = t(`nature.season.${season}`);
      $('mm-when').textContent = day > 0 ? `${t('gui.pause.day', { n: day })} · ${name}` : name;
    }
    paintPlaying();
    // (the face, when there is a moment: the first of a look takes a while, and then it is kept: three/portrait.js)
    const cv = $('mm-face'), look = p ? lookOf(save) : null, key = JSON.stringify(look);
    if (key === faceLook) return;
    faceLook = key;
    cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
    if (look) soon(() => {
      if (faceLook !== key) return;
      if (!shown()) { faceLook = null; return; }   // (gone playing meanwhile: the next time)
      try { cv.getContext('2d').drawImage(portrait3D(look), 0, 0, cv.width, cv.height); } catch (e) { reportFault(e, 'MainMenu.face'); }
    });
  }
  function paintPlaying() { $('mm-playing').textContent = save && live.names.length ? t('gui.menu.card.playing', { names: fmt.list(live.names), n: live.names.length }) : ''; }
  const shown = () => $('s-menu').classList.contains('show');
  function keysOf() { legend($('mm-legend'), [{ keys: ['↑', '↓'], text: t('gui.legend.move') }, { keys: ['Enter'], text: t('gui.legend.select') }]); }
  onLangChange(() => { if (shown()) { paint(); keysOf(); } });
  return {
    // Its section is in sight (menus.js show)
    open() {
      if (screen && !screen.closed) return;
      screen = FE.open('s-menu', { root: true, sound: null, parts: [L], onClose: () => { screen = null; } });
      paint(); keysOf();
    },
    // The game it offers: a save's, and the local world's, or null; at: the item selected first
    use(s, l, at = null) { save = s; local = l; paint(); L.focusId(at || (s ? 'm-continue' : 'm-new')); },
    focus: id => L.focusId(id),
    // How the server is: who is playing (names), and why Continue cannot be chosen ('' if it can)
    live(names, reason) { live = { names, reason }; L.set('m-continue', { disabled: busy || !!reason }); for (const id of MENU_ITEMS) L.set(id, { desc: DESC[id]() }); paintPlaying(); },
    // Busy entering: Continue waits
    busy(on) { busy = on; L.set('m-continue', { disabled: on || !!live.reason }); },
    list: L,   // (for the tests)
  };
}

// ---------- Credits ----------
// They scroll by themselves, slowly; ↑ ↓ or the wheel move them by hand (and they wait a moment); onClose(): back to the menu
const CREDITS = { speed: 26, wait: 2500, rest: 3500 };   // px/s; ms before they start, and after touching them
export function initCredits({ onClose }) {
  const body = $('cd-body'), nav = paneNav(body);
  let screen = null, raf = 0, from = 0, last = 0, pos = 0, shutting = false;
  const still = () => Settings.v.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rest = ms => { from = performance.now() + ms; };
  function step(now) {
    raf = requestAnimationFrame(step);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (now < from) { pos = body.scrollTop; return; }
    pos += CREDITS.speed * dt;
    body.scrollTop = pos;
  }
  body.addEventListener('wheel', () => rest(CREDITS.rest), { passive: true });
  body.addEventListener('pointerdown', () => rest(CREDITS.rest));
  function paintKeys() { legend($('cd-legend'), [{ keys: ['↑', '↓'], text: t('gui.legend.scroll') }, { keys: ['Esc'], text: t('gui.legend.back'), onClick: () => FE.back() }]); }
  onLangChange(() => { if (screen) paintKeys(); });
  const ui = {
    get isOpen() { return !!screen; },
    open() {
      if (screen) return;
      screen = FE.open('s-credits', { parts: [{ key(e) { if (!/^(Arrow(Up|Down)|Key[WS]|Page(Up|Down))$/.test(e.code)) return false; rest(CREDITS.rest); return nav.key(e); } }],
        onClose: () => { screen = null; cancelAnimationFrame(raf); if (!shutting) onClose(); } });
      body.scrollTop = pos = 0;
      paintKeys();
      rest(CREDITS.wait);
      last = performance.now();
      if (!still()) raf = requestAnimationFrame(step);
    },
    // Another screen takes its place
    shut() { if (!screen) return; shutting = true; try { FE.close(screen); } finally { shutting = false; } },
  };
  $('cd-close').onclick = () => { if (screen) { Audio.ui('back'); FE.close(screen); } };
  return ui;
}
export const versionText = () => (GAME_VERSION ? t('gui.menu.version', { v: GAME_VERSION }) : '');
