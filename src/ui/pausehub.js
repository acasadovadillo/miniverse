// The pause (docs/planes/realismo/PLAN-R9-menus.md §3.4): a full screen with seven tabs over the game, frozen, blurred and
// darkened behind it. Q and E (or 1-7, or a click) change tab; Esc and P open it on the tab used last (the first time, the
// map), M on the map and J on the journal; the music goes on muffled (Audio.duck).
// game.mode is 'pause' on every tab but the map, where it is 'map' (game.update then moves the map and game.render draws
// it). The blurred game is one copy of one frame, taken when it opens (Game.onShot): nothing runs per frame, open or closed.
// The world somebody else runs goes on meanwhile, as always: the note at the bottom says so.
// R9-1 hosts today's contents: the map, the settings, the journal's pages and the controls. What R9-2 and R8-4 bring hangs
// from here: paneKeys.map(e), keys of the map's own (true: it was one of them).
import { t, fmt, onLangChange } from '../i18n.js';
import { Audio } from '../audio.js';
import { Profile } from '../accounts.js';
import { clearKeys } from '../input.js';
import { reportFault } from '../faults.js';
import { portrait3D } from '../three/portrait.js';
import { nearX } from '../world/planet.js';
import { FE, tabStrip, list, legend } from './frontend.js';

const $ = id => document.getElementById(id);
export const PAUSE_TABS = ['map', 'brief', 'char', 'journal', 'progress', 'settings', 'game'];
export const paneKeys = { map: null };
const LAST_KEY = 'pueblo-brotes:pausa-pestana:';   // (+ the account: the tab used last)
const SHOT = { scale: 6, blur: 0.9 };              // the copy of the frame: 1/6 of its size, blurred once
const CLOCK_EVERY = 30000;
const MAP_KEYS = /^(Key[WASD]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|NumpadAdd|NumpadSubtract)$/;
const FOCUS = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary';

// ---------- A pane without a list: the keyboard goes through its controls, or scrolls it ----------
// (↑↓ from row to row, ← → change the one it is on, Enter or Space press it; without controls, ↑↓ scroll)
export function paneNav(el) {
  let at = -1;
  const stops = () => {
    const seen = new Set(), out = [];
    for (const x of el.querySelectorAll(FOCUS)) {
      if (!x.offsetParent) continue;
      const seg = x.closest('.seg');
      if (!seg) { out.push(x); continue; }
      if (seen.has(seg)) continue;   // (the buttons of a choice are one stop: the one that is on)
      seen.add(seg);
      out.push([...seg.querySelectorAll('button')].find(b => b.classList.contains('on')) || x);
    }
    return out;
  };
  const here = all => { const a = document.activeElement, seg = a?.closest?.('.seg'); return all.findIndex(x => x === a || (seg && seg.contains(x))); };
  const go = (all, i) => { at = Math.max(0, Math.min(all.length - 1, i)); all[at]?.focus({ preventScroll: true }); all[at]?.scrollIntoView({ block: 'nearest' }); };
  function side(d) {
    const a = document.activeElement;
    if (!el.contains(a)) return;
    const seg = a.closest('.seg');
    if (seg) {
      const bs = [...seg.querySelectorAll('button:not(:disabled)')], i = bs.indexOf(a), to = bs[i + d];
      if (to) { const k = here(stops()); to.click(); if (to.isConnected) to.focus({ preventScroll: true }); else go(stops(), k); }
    } else if (a.type === 'range') {
      const was = a.value;
      a.value = String(+a.value + d * 5);
      if (a.value !== was) { a.dispatchEvent(new Event('input', { bubbles: true })); Audio.ui('tick'); }
    }
  }
  return {
    enter() { at = -1; },
    key(e) {
      const d = { ArrowUp: -1, KeyW: -1, ArrowDown: 1, KeyS: 1 }[e.code], s = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 }[e.code];
      if (d) {
        const all = stops(), i = here(all);
        if (!all.length) el.scrollBy({ top: d * 72 });
        else if (i >= 0 || at >= 0) { const from = i >= 0 ? i : at, to = from + d; if (all[to]) { go(all, to); Audio.ui('tick'); } else el.scrollBy({ top: d * 72 }); }
        else { go(all, 0); Audio.ui('tick'); }
        return true;
      }
      if (s) { if (!el.contains(document.activeElement) || !document.activeElement.closest('.seg, [type=range]')) return false; side(s); return true; }
      if (e.code === 'PageDown' || e.code === 'PageUp') { el.scrollBy({ top: (e.code === 'PageDown' ? 1 : -1) * el.clientHeight * 0.9 }); return true; }
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
        const a = document.activeElement;
        if (!e.repeat && el.contains(a) && a !== el && a.matches(FOCUS)) { const k = here(stops()); a.click(); if (!a.isConnected) go(stops(), k); }
        return true;
      }
      return false;
    },
  };
}

// ---------- The hub ----------
// show(id): the menus' own (menus.js); resume(): back to play; save({upload}) and savedMsg(r); quit(): saved, to the main
// menu; journal: initJournalUI's; settings: initSettingsUI's
export function initPauseHub(game, { show, resume, save, savedMsg, quit, journal, settings }) {
  const root = $('s-pause'), shot = $('fe-shot'), panes = new Map([...root.querySelectorAll('.ps-pane')].map(el => [el.dataset.pane, el]));
  let screen = null, tab = null, level = 'list', fresh = false, timer = 0, savedAt = 0, quitting = false, saving = false;

  // ---------- the tabs' lists and panes ----------
  const pageList = (el, ids, onFocus) => list(el, ids.map(id => ({ id, el: el.querySelector(`[data-page="${id}"]`) })), { hover: false, start: -1, onFocus: r => { onFocus(r); if (level === 'body') setLevel('list'); }, onPick: () => goIn() });
  const lists = {
    journal: pageList($('j-tabs'), journal.pages, r => journal.open(r.id)),
    progress: pageList($('ps-progress'), ['logros', 'datos'], r => journal.fill($('ps-progress-body'), r.id)),
    game: list($('ps-game'), [...$('ps-game').children].map(el => ({ id: el.id, el })), { start: 0, onFocus: () => { setControls(false); if (tab === 'game' && level === 'body') setLevel('list'); }, onPick: r => gamePick(r.id) }),
  };
  const bodies = { journal: $('j-body'), progress: $('ps-progress-body'), game: $('s-controls'), brief: $('ps-brief'), char: $('ps-char'), settings: $('ps-settings') };
  const navs = Object.fromEntries(Object.entries(bodies).map(([id, el]) => [id, paneNav(el)]));
  function goIn() { if (level === 'list' && lists[tab] && (tab !== 'game' || !$('s-controls').hidden)) setLevel('body'); }
  function setLevel(l) {
    level = l;
    if (l === 'body') navs[tab].enter(); else if (root.contains(document.activeElement)) document.activeElement.blur();
    lists[tab]?.el.classList.toggle('dim', l === 'body');
    paintLegend();
  }
  function setControls(on) { $('s-controls').hidden = !on; if (on) $('s-controls').scrollTop = 0; }
  async function gamePick(id) {
    if (id === 'p-resume') close();
    else if (id === 'p-controls') { setControls(true); goIn(); }
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

  // What each tab shows when it is entered (R9-1: today's contents, hosted)
  const fills = {
    map() {},
    brief() { $('ps-brief').innerHTML = briefHtml(); },
    char() {
      $('ps-char-name').textContent = game.player?.name || '';
      journal.fill($('ps-char-body'), 'habilidades', journal.bodyBox());
      portrait($('ps-char-face'));
    },
    journal() { const i = journal.pages.indexOf(journal.current); if (lists.journal.index === i) journal.open(journal.current); else lists.journal.focus(i); },
    progress() { const L = lists.progress; if (L.index < 0) L.focus(0); else journal.fill($('ps-progress-body'), L.rows[L.index].id); },
    settings() { const box = $('st-body'); if (box.parentElement !== $('ps-settings')) $('ps-settings').append(box); settings.refresh(); },
    game() { setControls(false); $('p-msg').textContent = ''; lists.game.focus(0); },
  };
  // The objective: the first step they are on, the marked route and the lighthouse keeper's story
  function briefHtml() {
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const S = game.steps, st = S && !S.over ? S.step : null, R = game.route, p = game.player, out = [];
    if (st) {
      const pr = S.progress(st);
      out.push(`<div class="j-row"><b>▸ ${esc(st.text)}${pr ? ` (${Math.max(0, pr[0])}/${pr[1]})` : ''}</b><small>${esc(S.hintOf(st))}</small></div>`);
    }
    if (R?.active && p && game.scene === game.world) {
      const m = Math.round(Math.hypot(nearX(R.target.x, p.x) - p.x, R.target.y - p.y));
      out.push(`<div class="j-row"><b>▸ ${esc(t('gui.brief.route', { place: R.target.name || `${Math.round(R.target.x)}, ${Math.round(R.target.y)}`, m: fmt.num(m) }))}</b></div>`);
    }
    return `<h3>${t('gui.brief.objective')}</h3>${out.join('') || `<p class="j-note">${t('gui.brief.none')}</p>`}${game.story.journal()}`;
  }

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
    if (tab === 'map') { L('route', ['mouse:l']); L('remove', ['mouse:r']); L('zoom', ['+', '−']); }
    else if (lists[tab] || tab === 'settings') L('move', ['↑', '↓']);
    if (tab === 'settings') L('change', ['←', '→']);
    else if (lists[tab] && level === 'list') L('select', ['Enter']);
    L('tabs', ['Q', 'E']);
    L('back', ['Esc'], { onClick: () => FE.back() });
    legend($('ps-legend'), out);
  }
  // A head in a canvas, when there is a moment (the first of a look takes a while: three/portrait.js)
  const soon = globalThis.requestIdleCallback ? fn => requestIdleCallback(fn, { timeout: 600 }) : fn => setTimeout(fn, 60);
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
  const onResize = () => { fresh = false; if (screen && tab !== 'map') takeShot(); };

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
    if (bodies[id] && id !== 'game') bodies[id].scrollTop = 0;
    navs[id]?.enter();
    paintLegend();
    try { localStorage.setItem(lastKey(), id); } catch { /* (no storage: the map next time) */ }
  }
  function leave() {
    if (tab === 'journal') journal.hide();
    if (tab === 'map') clearKeys();   // (a key held moving the map)
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
      if (!L) return navs[tab]?.key(e) || false;
      if (level === 'body') {
        if (navs[tab].key(e)) return true;
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') { if (!e.repeat) { setLevel('list'); Audio.ui('back'); } return true; }
        return false;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { if (!e.repeat && (tab !== 'game' || !$('s-controls').hidden)) { goIn(); Audio.ui('select'); } return true; }
      if (e.code === 'PageDown' || e.code === 'PageUp') return navs[tab].key(e);
      return L.key(e);
    },
  };
  // One level back: out of a field, from the page to its list; from there it closes
  function back() {
    const a = document.activeElement;
    if (root.contains(a) && a.matches('input:not([type=range]):not([type=checkbox])')) { a.blur(); return true; }
    if (level === 'body') { if (tab === 'game') setControls(false); setLevel('list'); return true; }
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
    screen = FE.open('s-pause', { parts: [own, tabs, pane], pass: e => tab === 'map' && (MAP_KEYS.test(e.code) || /^[-+=_]$/.test(e.key)), back, onClose: closed });
    if (tabs.current === id) enter(id); else tabs.pick(id, { silent: true });
    paintHead(); paintNote();
    portrait($('ps-face'));
    timer = setInterval(() => { paintHead(); paintNote(); }, CLOCK_EVERY);
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
    if (tab !== 'settings') { try { fills[tab](); } catch (e) { reportFault(e, `PauseHub.${tab}`); } }   // (the settings rebuild themselves)
  });
  return {
    open, close, shut,
    get isOpen() { return !!screen; },
    get tab() { return tab; },
    journal: (id, sub) => { open('journal'); if (id) { lists.journal.focus(journal.pages.indexOf(id)); if (sub) journal.open(id, sub); } },
    saved() { savedAt = Date.now(); if (screen) paintNote(); },
    reset() { savedAt = 0; faceOf.clear(); },
  };
}
