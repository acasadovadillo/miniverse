// The pause (docs/planes/realismo/PLAN-R9-menus.md §3.4): a full screen with seven tabs over the game, frozen, blurred and
// darkened behind it. Q and E (or 1-7, or a click) change tab; Esc and P open it on the tab used last (the first time, the
// map), M on the map and J on the journal; the music goes on muffled (Audio.duck).
// game.mode is 'pause' on every tab but the map, where it is 'map' (game.update then moves the map and game.render draws
// it). The blurred game is one copy of one frame, taken when it opens (Game.onShot): nothing runs per frame, open or closed.
// The world somebody else runs goes on meanwhile, as always: the note at the bottom says so.
// The pages: Brief (src/ui/brief.js), Character (charpage.js), Journal (journal.js, its registry JOURNAL_PAGES) and Progress
// (progresspage.js); the map is ui/map.js and the settings, ui/settings.js (with their own sub-tabs). Three of them are a list and a page (PAGED): each
// gives { pages: [{ id, label }], current, open(id, sub), fill(el), hide() }. Anything with data-goto="tab:page" in a pane
// opens that. paneKeys.map(e): keys of the map's own (true: it was one of them); mapPane: the rest of what the map's screen answers for
// (src/ui/mapscreen.js).
import { t, fmt, onLangChange } from '../i18n.js';
import { Audio } from '../audio.js';
import { Profile } from '../accounts.js';
import { clearKeys } from '../input.js';
import { reportFault } from '../faults.js';
import { portrait3D } from '../three/portrait.js';
import { FE, tabStrip, list, legend, paneNav } from './frontend.js';
import { hud } from './hud.js';
import { initBrief } from './brief.js';
import { initCharPage } from './charpage.js';
import { initProgressPage } from './progresspage.js';
import { tipsHtml } from './loading.js';
import { MOVED } from './journal.js';

const $ = id => document.getElementById(id);
export const PAUSE_TABS = ['map', 'brief', 'char', 'journal', 'progress', 'settings', 'game'];
export const paneKeys = { map: null };
// enter(), leave(); wants(e): a key that would move the map is for something else; up(e|null): a key let go; back(): it climbed a level;
// legend(): its keys, for the bottom line
export const mapPane = { enter: null, leave: null, wants: null, up: null, back: null, legend: null };
const LAST_KEY = 'pueblo-brotes:pausa-pestana:';   // (+ the account: the tab used last)
const SHOT = { scale: 6, blur: 0.9 };              // the copy of the frame: 1/6 of its size, blurred once
const TICK = 5000, CLOCK_EVERY = 6;                // ms between two looks at what may have changed, and of them, how many for the header
const MAP_KEYS = /^(Key[WASD]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|NumpadAdd|NumpadSubtract)$/;

// ---------- The hub ----------
// show(id): the menus' own (menus.js); resume(): back to play; save({upload}) and savedMsg(r); quit(): saved, to the main
// menu; journal: initJournalUI's; settings: initSettingsUI's; credits(): the credits, over the pause
export function initPauseHub(game, { show, resume, save, savedMsg, quit, journal, settings, credits }) {
  const root = $('s-pause'), shot = $('fe-shot'), panes = new Map([...root.querySelectorAll('.ps-pane')].map(el => [el.dataset.pane, el]));
  let screen = null, tab = null, level = 'list', fresh = false, timer = 0, savedAt = 0, quitting = false, saving = false;

  // ---------- the tabs' lists and panes ----------
  // A head in a canvas, when there is a moment (the first of a look takes a while: three/portrait.js)
  const soon = globalThis.requestIdleCallback ? fn => requestIdleCallback(fn, { timeout: 600 }) : fn => setTimeout(fn, 60);
  const char = initCharPage(game, { soon });
  const PAGED = {
    brief: { src: initBrief(game, { soon }), el: $('ps-brief-list'), body: $('ps-brief') },
    journal: { src: journal, el: $('j-tabs'), body: $('j-body') },
    progress: { src: initProgressPage(game), el: $('ps-progress'), body: $('ps-progress-body') },
  };
  const lists = {
    // (on Tips, all of them beside it)
    game: list($('ps-game'), [...$('ps-game').children].map(el => ({ id: el.id, el })), { start: 0, onPick: r => gamePick(r.id), onFocus: r => { const on = r.id === 'p-tips', el = $('ps-tips'); if (!el) return; if (on && el.hidden) { el.innerHTML = tipsHtml(); el.hidden = false; el.scrollTop = 0; } else if (!on) el.hidden = true; } }),
  };
  // The list of a paged tab: made again when its pages are others (another system added one, or one is there no more)
  function listOf(id) {
    const P = PAGED[id], ids = P.src.pages.map(p => p.id).join();
    if (P.ids !== ids) {
      P.ids = ids;
      P.el.textContent = '';
      const rows = P.src.pages.map(p => {
        const el = document.createElement('div'), name = document.createElement('span');
        name.dataset.i18n = p.label; name.textContent = t(p.label);
        el.dataset.page = p.id;
        if (id === 'journal') el.dataset.jtab = p.id;
        el.append(name);
        return { id: p.id, el };
      });
      lists[id] = list(P.el, rows, { hover: false, start: -1, onFocus: r => { P.src.open(r.id); paintPage(id, true); if (level === 'body') setLevel('list'); }, onPick: () => goIn() });
    }
    return lists[id];
  }
  for (const id of Object.keys(PAGED)) listOf(id);
  // The page of a paged tab, written (from its top, if it is another one)
  function paintPage(id, top = false) {
    const P = PAGED[id], at = P.body.scrollTop;
    for (const row of P.el.children) row.classList.toggle('on', row.dataset.page === P.src.current);
    try { P.src.fill(P.body); } catch (e) { reportFault(e, `PauseHub.${id}`); }
    P.body.scrollTop = top ? 0 : at;
  }
  const bodies = { game: $('ps-tips'), journal: $('j-body'), progress: $('ps-progress-body'), brief: $('ps-brief'), char: $('ps-char') };
  const navs = Object.fromEntries(Object.entries(bodies).filter(([, el]) => el).map(([id, el]) => [id, paneNav(el)]));
  const canGoIn = () => !!navs[tab] && !bodies[tab].hidden;
  function goIn() { if (level === 'list' && lists[tab] && canGoIn()) setLevel('body'); }
  function setLevel(l) {
    level = l;
    if (l === 'body') navs[tab].enter(); else if (root.contains(document.activeElement)) document.activeElement.blur();
    lists[tab]?.el.classList.toggle('dim', l === 'body');
    paintLegend();
  }
  async function gamePick(id) {
    if (id === 'p-resume') close();
    else if (id === 'p-controls') goTo('settings', 'controls');
    else if (id === 'p-tips') goIn();
    else if (id === 'p-credits') credits();
    else if (id === 'p-save' && !saving) {
      saving = true;
      $('p-msg').textContent = '…';
      try { $('p-msg').textContent = savedMsg(await save({ upload: true })); } finally { saving = false; paintNote(); }
    } else if (id === 'p-menu' && !quitting) {
      quitting = true;
      try { await quit(); } finally { quitting = false; }
    }
  }
  const tabs = tabStrip($('ps-tabs'), PAUSE_TABS.map(id => ({ id, text: t(`gui.pause.tab.${id}`), i18n: `gui.pause.tab.${id}` })), { current: 'map', onPick: id => enter(id) });

  // What each tab shows when it is entered
  function enterPaged(id) {
    const L = listOf(id), P = PAGED[id], i = P.src.pages.findIndex(p => p.id === P.src.current);
    if (L.index === i) paintPage(id, true); else L.focus(i);
  }
  const fills = {
    map: () => mapPane.enter?.(),
    brief: () => enterPaged('brief'),
    char: () => char.enter(),
    journal: () => enterPaged('journal'),
    progress: () => enterPaged('progress'),
    settings: () => settings.mount($('ps-settings'), { legendEl: $('ps-legend'), onLegend: () => { if (tab === 'settings') paintLegend(); } }),
    game() { $('p-msg').textContent = ''; lists.game.focus(0); },
  };
  // A page of a tab, or a tab ('journal:pesca', 'settings:controls', 'map'); sub: a part of it (a species of the nature book). With the pause
  // closed, it opens
  function goTo(to, page, sub) {
    if (!PAUSE_TABS.includes(to)) return;
    const P = PAGED[to];
    if (P && page && P.src.pages.some(p => p.id === page)) {
      P.src.open(page, sub);
      // (on that tab already: its page now; else, entering the tab shows it)
      if (screen && tab === to) {
        const L = listOf(to), i = P.src.pages.findIndex(p => p.id === page);
        if (L.index === i) { paintPage(to, true); if (level === 'body') setLevel('list'); } else L.focus(i);
      }
    }
    open(to);
    if (to === 'settings' && page) settings.show(page, true);
  }
  root.addEventListener('click', e => {
    const a = e.target instanceof Element && e.target.closest('[data-goto]');
    if (!a || !screen) return;
    const [to, page, sub] = a.dataset.goto.split(':');
    Audio.ui('select');
    goTo(to, page, sub);
  });
  // What changes while it is in sight: a line said, a notice or the chat (Brief), and on the slow tick, what the others do
  const onLine = what => { if (screen && tab === 'brief' && level === 'list' && PAGED.brief.src.shows(what)) paintPage('brief'); };
  hud.log.onChange = onLine;

  // ---------- the frame: header, note and key legend ----------
  function paintHead() {
    const p = game.player, d = game.days, L = game.live;
    if (!p) return;
    $('ps-name').textContent = p.name;
    const hl = d.localHour, hhmm = `${String(Math.floor(hl)).padStart(2, '0')}:${String(Math.floor((hl % 1) * 60)).padStart(2, '0')}`, when = [t('gui.pause.day', { n: d.dayIndex + 1 }), t(`nature.season.${d.localSeason}`), hhmm];
    if (game.body?.weatherOn) when.push(fmt.num(Math.round(game.body.feelC), { style: 'unit', unit: 'celsius' }));
    $('ps-when').textContent = when.join(' · ');
    $('ps-money').textContent = t('gui.pause.money', { n: game.money });
    const n = L.joined ? L.others.filter(o => o.playing && !o.server).length + 1 : 0;
    $('ps-online').hidden = !L.joined;
    $('ps-online').textContent = L.joined ? t('gui.pause.players', { n }) : '';
  }
  function paintNote() {
    const out = [], s = savedAt ? Math.max(0, Math.round((Date.now() - savedAt) / 1000)) : -1;
    if (s >= 0) {
      const [n, unit] = s < 60 ? [s, 'second'] : s < 5400 ? [Math.round(s / 60), 'minute'] : [Math.round(s / 3600), 'hour'];
      out.push(t('gui.pause.saved_ago', { t: fmt.num(n, { style: 'unit', unit, unitDisplay: unit === 'second' ? 'narrow' : 'short' }) }));
    }
    if (!game.live.aloneInWorld) out.push(t('gui.pause.world_goes_on'));
    $('ps-note').textContent = out.join('  ·  ');
  }
  function paintLegend() {
    const out = [], L = (k, keys, o) => out.push({ keys, text: t(`gui.legend.${k}`), ...o });
    if (tab === 'map') out.push(...mapPane.legend?.() || []);
    else if (lists[tab]) L('move', ['↑', '↓']);
    if (tab === 'settings') out.push(...settings.legendItems());
    else if (tab === 'char') out.push({ keys: ['←', '→'], text: t('gui.char.turn') });
    else if (lists[tab] && level === 'list') L('select', ['Enter']);
    L('tabs', ['Q', 'E']);
    L('back', ['Esc'], { onClick: () => FE.back() });
    legend($('ps-legend'), out);
  }
  const faceOf = new Map();   // canvas → the look drawn in it
  function portrait(cv) {
    const look = game.appearance?.();
    if (!look || faceOf.get(cv) === look) return;
    soon(() => {
      if (!screen || !game.player) return;
      try {
        const src = portrait3D(look), g = cv.getContext('2d');
        g.clearRect(0, 0, cv.width, cv.height);
        g.drawImage(src, 0, 0, cv.width, cv.height);
        faceOf.set(cv, look);
      } catch (e) { reportFault(e, 'PauseHub.portrait'); }
    });
  }

  // ---------- the frozen game behind ----------
  // One copy of the next frame painted (Game.render calls it right after painting it: later its buffer may be gone)
  function takeShot() {
    game.onShot = src => {
      const w = Math.max(1, Math.round(src.width / SHOT.scale)), h = Math.max(1, Math.round(src.height / SHOT.scale));
      shot.width = w; shot.height = h;
      const g = shot.getContext('2d');
      g.imageSmoothingQuality = 'high';
      // (blurred here, once; without the filter, going through half that size blurs enough)
      if ('filter' in g) g.filter = `blur(${SHOT.blur}px) saturate(.8)`;
      const over = SHOT.blur * 2;   // (past the edges, so that they do not fade)
      g.drawImage(src, -over, -over, w + over * 2, h + over * 2);
      if ('filter' in g) g.filter = 'none';
      // (darkened, and more on the left, where the lists are: they read over snow too)
      g.fillStyle = 'rgba(8, 9, 12, .45)';
      g.fillRect(0, 0, w, h);
      const left = g.createLinearGradient(0, 0, w * 0.45, 0);
      left.addColorStop(0, 'rgba(8, 9, 12, .5)'); left.addColorStop(1, 'rgba(8, 9, 12, 0)');
      g.fillStyle = left;
      g.fillRect(0, 0, w, h);
      fresh = true;
    };
    game.view3d.redraw = true;
  }
  const onResize = () => { fresh = false; if (screen && tab !== 'map') takeShot(); if (tab === 'char') char.resize(); };

  // ---------- open, change tab, close ----------
  const lastKey = () => LAST_KEY + (Profile.id || '');
  function last() { try { const v = localStorage.getItem(lastKey()); return PAUSE_TABS.includes(v) ? v : 'map'; } catch { return 'map'; } }
  function enter(id) {
    if (tab === id) return;
    leave();
    tab = id;
    level = 'list';
    panes.get(id).classList.add('on');
    for (const L of Object.values(lists)) L.el.classList.remove('dim');
    game.mode = id === 'map' ? 'map' : 'pause';
    root.classList.toggle('on-map', id === 'map');
    if (id !== 'map' && !fresh) takeShot();
    try { fills[id](); } catch (e) { reportFault(e, `PauseHub.${id}`); }
    if (bodies[id] && !PAGED[id]) bodies[id].scrollTop = 0;
    navs[id]?.enter();
    paintLegend();
    try { localStorage.setItem(lastKey(), id); } catch { /* (no storage: the map next time) */ }
  }
  function leave() {
    if (PAGED[tab]) { try { PAGED[tab].src.hide(); } catch (e) { reportFault(e, `PauseHub.${tab}`); } }
    if (tab === 'char') char.leave();
    if (tab === 'settings') settings.leave();
    if (tab === 'map') { clearKeys(); try { mapPane.leave?.(); } catch (e) { reportFault(e, 'PauseHub.map'); } }   // (a key held moving the map)
    panes.get(tab)?.classList.remove('on');
    if (root.contains(document.activeElement)) document.activeElement.blur();
    tab = null;
  }
  const own = {
    key(e) {
      if (e.code === 'KeyP') { if (!e.repeat) close(); return true; }
      if (e.code === 'KeyM' || e.code === 'KeyJ') {
        const to = e.code === 'KeyM' ? 'map' : 'journal';
        if (!e.repeat) { if (tab === to) close(); else tabs.pick(to); }
        return true;
      }
      return tab === 'map' ? !!paneKeys.map?.(e) : false;
    },
  };
  const pane = {
    key(e) {
      const L = lists[tab];
      if (tab === 'settings') return settings.key(e);
      if (!L) {
        if (tab === 'char' && (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'ArrowRight' || e.code === 'KeyD')) { char.turn(e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : 1); return true; }
        return navs[tab]?.key(e) || false;
      }
      if (level === 'body') {
        if (navs[tab].key(e)) return true;
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') { if (!e.repeat) { setLevel('list'); Audio.ui('back'); } return true; }
        return false;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { if (!e.repeat && canGoIn()) { goIn(); Audio.ui('select'); } return true; }
      if (e.code === 'PageDown' || e.code === 'PageUp') return navs[tab]?.key(e) || false;
      return L.key(e);
    },
  };
  // One level back: out of a field, from the page to its list; from there it closes
  function back() {
    if (tab === 'settings') return settings.back();
    if (tab === 'map' && mapPane.back?.()) return true;
    const a = document.activeElement;
    if (root.contains(a) && a.matches('input:not([type=range]):not([type=checkbox])')) { a.blur(); return true; }
    if (level === 'body') { setLevel('list'); return true; }
    return false;
  }
  function open(id = last()) {
    if (screen) { tabs.pick(id); return true; }
    // (nothing held stays held: no key walks on, the bow's string is let down, a greeting half pressed is forgotten)
    clearKeys();
    try { game.archery?.letDown(); game.social?.cancel(); } catch (e) { reportFault(e, 'PauseHub.open'); }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    fresh = false;
    game.map.recenter();
    Audio.duck(true);
    show('s-pause');
    document.body.classList.add('in-pause');
    screen = FE.open('s-pause', { parts: [own, tabs, pane], pass: e => tab === 'map' && !mapPane.wants?.(e) && (MAP_KEYS.test(e.code) || /^[-+=_]$/.test(e.key)), back, keyup: e => { if (tab === 'settings') settings.keyup(e); else if (tab === 'map') mapPane.up?.(e); }, onClose: closed });
    if (tabs.current === id) enter(id); else tabs.pick(id, { silent: true });
    paintHead(); paintNote();
    portrait($('ps-face'));
    let n = 0;
    timer = setInterval(() => {
      if (++n % CLOCK_EVERY === 0) { paintHead(); paintNote(); if (tab === 'brief' && level === 'list') paintPage('brief'); }
      if (tab === 'char') char.live();
    }, TICK);
    addEventListener('resize', onResize);
    return true;
  }
  let shutting = false;
  function closed() {
    screen = null;
    clearInterval(timer);
    removeEventListener('resize', onResize);
    leave();
    root.classList.remove('on-map');
    document.body.classList.remove('in-pause');
    game.onShot = null;
    shot.width = shot.height = 1;
    Audio.duck(false);
    clearKeys();
    if (!shutting) resume();
  }
  function close() { if (screen) { Audio.ui('back'); FE.close(screen); } }
  // Another screen takes its place, or the game ended: it goes without going back to play
  function shut() {
    if (!screen) return;
    shutting = true;
    try { FE.close(screen); } finally { shutting = false; }
  }
  onLangChange(() => {
    if (!screen) return;
    paintHead(); paintNote(); paintLegend();
    if (PAGED[tab]) paintPage(tab); else if (tab === 'game') { $('p-msg').textContent = ''; if ($('ps-tips')) $('ps-tips').innerHTML = tipsHtml(); } else if (tab !== 'settings') { try { fills[tab](); } catch (e) { reportFault(e, `PauseHub.${tab}`); } }   // (the settings rebuild themselves; the lists' names, applyDom)
  });
  return {
    open, close, shut,
    get isOpen() { return !!screen; },
    get tab() { return tab; },
    goTo, onChat: () => onLine('chat'),
    // A page of the journal (game.openJournal), or where it is now (MOVED); an unknown one, the journal as it was
    journal: (id, sub) => (MOVED[id] ? goTo(...MOVED[id]) : goTo('journal', id, sub)),
    char,   // (for the tests)
    keys: () => { if (screen && tab === 'map') paintLegend(); },   // (the map's keys are others now: mapscreen.js)
    saved() { savedAt = Date.now(); if (screen) paintNote(); },
    reset() { savedAt = 0; faceOf.clear(); },
  };
}
