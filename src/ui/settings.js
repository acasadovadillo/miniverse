// The settings (docs/planes/realismo/PLAN-R9-menus.md §3.5): six sub-tabs across the top (Game, Display, Interface, Audio,
// Controls, Account) and, in the first four, rows in groups, «Label ........ ‹ Value ›», with the selected one explained in the
// line at the bottom. The same element, #st-body, in the pause (its Settings tab: pausehub.js) and in the main menu (#s-settings:
// menus.js): whoever shows it mounts it and hands it the keys.
// Keys: on the sub-tabs ← → change them and ↓ or Enter go in; on the rows ↑ ↓ move (↑ on the first, back to the sub-tabs), ← →
// change the value, Enter flips it, R puts the default back and R held (HOLD_MS, with its ring) puts back the whole page. Z and C
// change sub-tab from anywhere (in the main menu, Q, E and 1-6 too). The mouse selects what it moves over.
// Every change applies at once and saves itself (Settings.set).
// Rows of other systems: settingsRows.<tab>.push({ id, group, ... }) before the settings are first shown; see ROWS.
import { Settings, DEFAULTS } from '../settings.js';
import { t, LANGS, autoLang, getLang, getLangSetting, onLangChange } from '../i18n.js';
import { Audio } from '../audio.js';
import { apagada, opcion } from '../opciones.js';
import { FE, tabStrip, list, optionRow, legend, ring, paneNav } from './frontend.js';
import { skinNow, accentOf, ACCENTS, ACCENT_IDS } from './skin.js';
import { MODES, miniMode } from './minimap.js';

const $ = id => document.getElementById(id);
export const SETTINGS_TABS = ['game', 'display', 'interface', 'audio', 'controls', 'account'];
export const HOLD_MS = 800;
const SAID_MS = 1600;   // how long «Reset» stays in the description line

// ---------- The rows ----------
// { id, group (the key of its heading), label, desc (keys, or functions; by default gui.settings.row.<id> and .desc.<id>),
//   key (a field of Settings.v) or get and set, values: [[value, key or function]] | bar: true (a volume, 0-100) | neither: yes and
//   no, def (by default the field's in DEFAULTS), onReset (instead of def), show() (false: it is not there), off() (the key of why it
//   cannot be changed now, or null), colours, keep: true (the page's reset leaves it as it is) }
const G = 'gui.settings.group.', R = 'gui.settings.row.', vals = (id, ...v) => v.map(x => (Array.isArray(x) ? [x[0], `${R}${id}.${x[1]}`] : [x, `${R}${id}.${x}`]));
const forced = (param, on) => () => (on() ? { key: 'gui.settings.forced', params: { what: `?${param}=${opcion(param)}` } } : null);
const volume = key => ({ bar: true, get: () => Math.round(Settings.v[key] * 100), set: v => Settings.set(key, v / 100), def: Math.round(DEFAULTS[key] * 100) });
export const settingsRows = {
  game: [
    // (its heading in both languages: whoever finds the game in one they do not read knows where it is. English is still
    // partial until all texts go through t(): F5)
    { id: 'lang', group: 'gui.settings.language', values: [['auto', 'gui.settings.language.auto'], ...Object.keys(LANGS).map(l => [l, 'lang.' + l])], def: 'auto', keep: true,
      get: () => { const s = getLangSetting(); return s !== 'auto' && s !== getLang() && LANGS[getLang()] ? getLang() : s; },   // (?lang= decides over the saved one)
      set: v => Settings.setLang(v),
      desc: () => (getLangSetting() === 'auto' ? `${t('gui.settings.desc.lang')} ${t('gui.settings.language.auto_title', { lang: t('lang.name.' + autoLang()) })}.` : t('gui.settings.desc.lang')) },
    // Riding (Plan R4-1): the horse's real weight, or quicker turns and stops
    { id: 'ride', group: G + 'play', key: 'ride', values: vals('ride', 'realistic', 'arcade'), get: () => (apagada('montar') ? 'arcade' : Settings.v.ride === 'arcade' ? 'arcade' : 'realistic'), off: forced('montar', () => apagada('montar')) },
    { id: 'hints', group: G + 'help', key: 'hints' },
    { id: 'remarks', group: G + 'help', key: 'remarks', show: () => !apagada('comentarios') },
  ],
  display: [
    // The game takes the whole screen, without the browser. With the keyboard locked (Chrome and Edge), Esc still opens the
    // pause and is held to leave; else, Esc leaves
    { id: 'fullscreen', group: G + 'screen', get: () => !!document.fullscreenElement, set: v => toggleFullscreen(v), def: false, off: () => (document.fullscreenEnabled ? null : { key: 'gui.settings.no_fullscreen' }) },
    { id: 'scale', group: G + 'screen', key: 'scale', values: vals('scale', 'auto', [1, 'max'], [2, 'high'], [3, 'medium'], [4, 'low']) },
    { id: 'big_text', group: G + 'comfort', key: 'bigText' },
    { id: 'no_flash', group: G + 'comfort', key: 'noFlash' },
    { id: 'motion', group: G + 'comfort', key: 'motion', values: vals('motion', 'full', 'reduced'), get: () => (Settings.v.motion === 'reduced' ? 'reduced' : 'full') },
    // Blood on the trails of wounded animals (Plan G), or scuffed ground instead. Not with ?tracks=0 (nothing is drawn)
    { id: 'blood', group: G + 'comfort', key: 'blood', show: () => !apagada('tracks') },
  ],
  interface: [
    // The minimal one (each part shows when it matters, Tab shows everything) or the full one, always in sight. It changes at
    // once, while playing (shown: the one in sight, which the address, the tests or the bench can choose without saving it: main.js)
    { id: 'hud', group: G + 'hud', key: 'hud', values: vals('hud', 'minimal', 'full'), get: () => Settings.hudNow?.() ?? Settings.v.hud,
      desc: () => t('gui.settings.desc.hud') + (opcion('hud') ? ' ' + t('gui.settings.forced_start', { what: `?hud=${opcion('hud')}` }) : '') },
    // (the minimap: by the interface's rules, always, the compass strip instead, or none; and how big: ui/minimap.js)
    { id: 'mini', group: G + 'hud', key: 'mini', values: vals('mini', ...MODES), get: miniMode, def: 'fade' },
    { id: 'mini_size', group: G + 'hud', key: 'miniSize', values: vals('mini_size', 's', 'm', 'l'), get: () => (['s', 'l'].includes(Settings.v.miniSize) ? Settings.v.miniSize : 'm'), def: 'm' },
    // (what the keys do: at the thing aimed at, or at the cursor; and which notices show: ui/prompts.js, ui/feed.js)
    { id: 'prompts', group: G + 'hud', key: 'prompts', values: vals('prompts', 'object', 'cursor'), get: () => (Settings.v.prompts === 'cursor' ? 'cursor' : 'object') },
    { id: 'feed', group: G + 'hud', key: 'feed', values: vals('feed', 'all', 'important'), get: () => (Settings.v.feed === 'important' ? 'important' : 'all') },
    { id: 'skin', group: G + 'hud', key: 'skin', values: vals('skin', 'glass', 'wood'), get: () => skinNow(Settings.v.skin), off: forced('ui', () => ['madera', 'cristal'].includes(opcion('ui'))) },
    { id: 'accent', group: G + 'menus', colours: ACCENTS, values: ACCENTS.map((_, i) => [i, `${R}accent.${ACCENT_IDS[i]}`]) },   // (get, set and off: the character's, from menus.js)
    { id: 'menu_sfx', group: G + 'menus', key: 'menuSfx' },
  ],
  audio: [
    { id: 'master', group: G + 'volume', ...volume('master') },
    { id: 'music_on', group: G + 'volume', key: 'musicOn' },
    // Dynamic music (Plan J §3.6): the score follows what happens, or only its calm side. Not with ?musica=0 (the old music)
    { id: 'music_mode', group: G + 'volume', key: 'musicMode', values: [['dynamic', 'settings.music.dynamic'], ['calm', 'settings.music.calm']], get: () => Settings.musicMode, show: () => !apagada('musica') },
    { id: 'music', group: G + 'volume', ...volume('music') },
    { id: 'sfx', group: G + 'volume', ...volume('sfx') },
  ],
};
const say = x => (typeof x === 'function' ? x() : t(x));

// onClose(): its screen of the main menu was closed; extra(page, head): writes the Account page (menus.js, savesafety.js); accent:
// { who(): the character's save or null, set(n or null: the one of the name) }
export function initSettingsUI({ onClose, extra = null, accent = null }) {
  const body = $('st-body'), box = $('st-rows'), controls = $('s-controls'), account = $('st-account'), descEl = $('st-desc');
  let tab = 'game', level = 'tabs', byKey = false, strip = null, L = null, rows = [], where = null, held = null, saidTimer = 0, screen = null;
  const at = {};                                        // the row of each sub-tab (by its id), while it is open
  const navs = { controls: paneNav(controls), account: paneNav(account) };
  const pageOf = id => (id === 'controls' ? controls : id === 'account' ? account : box);
  const legendEl = () => where?.legendEl;

  function makeStrip() {
    strip?.destroy();
    strip = tabStrip($('st-tabs'), SETTINGS_TABS.map(id => ({ id, text: t(`gui.settings.tab.${id}`), i18n: `gui.settings.tab.${id}` })),
      { current: tab, keys: where?.top ? ['Q', 'E'] : ['Z', 'C'], digits: !!where?.top, onPick: id => { const inside = level === 'rows' && byKey; saveRow(); tab = id; build(); setLevel(inside ? 'rows' : 'tabs'); } });
  }
  const saveRow = () => { if (L && L.index >= 0) at[tab] = rows[L.index]?.id; };

  // ---------- the page ----------
  function build() {
    holdEnd();
    for (const el of [box, controls, account]) el.hidden = el !== pageOf(tab);
    L = null; rows = [];
    if (tab === 'account') buildAccount();
    else if (tab !== 'controls') buildRows();
    pageOf(tab).scrollTop = 0;
  }
  function buildRows() {
    const defs = settingsRows[tab].filter(d => d.show?.() !== false);
    // (grouped: a row another system added goes with the others of its group)
    const groups = [...new Set(defs.map(d => d.group))];
    const sorted = groups.flatMap(g => defs.filter(d => d.group === g));
    rows = sorted.map(d => {
      const own = d.id === 'accent' ? accentRow() : null, spec = own ? { ...d, ...own } : d;
      const why = spec.off?.() || null, get = spec.get || (() => Settings.v[spec.key]), set = spec.set || (v => Settings.set(spec.key, v));
      const opt = optionRow({
        label: say(spec.label || R + spec.id), get, set: v => { set(v); after(); }, disabled: !!why,
        ...(spec.bar ? { min: 0, max: 100, step: 5 } : { values: spec.values?.map(([v, x]) => [v, say(x)]) }),
        def: spec.def ?? DEFAULTS[spec.key], onReset: spec.onReset && (() => { spec.onReset(); after(); }), colours: spec.colours,
      });
      opt.el.dataset.row = spec.id;
      return { id: spec.id, group: spec.group, keep: !!spec.keep, opt, el: opt.el, disabled: !!why, text: () => (why ? t(why.key, why.params) : say(spec.desc || `gui.settings.desc.${spec.id}`)) };
    });
    L = list(box, rows.map(r => ({ id: r.id, el: r.el, disabled: r.disabled })), {
      hover: 'move', start: -1, wrap: false,
      onFocus: () => { level = 'rows'; holdEnd(); paint(); },
      onEdge: d => { if (d < 0) setLevel('tabs', true); },
    });
    let last = null;
    for (const r of rows) {
      if (r.group === last) continue;
      last = r.group;
      const h = document.createElement('h3');
      h.textContent = t(r.group);
      r.el.before(h);
    }
  }
  // (what one changes may show in another: the look, the language…)
  function after() { for (const r of rows) r.opt.refresh(); paintDesc(); }
  function accentRow() {
    const w = accent?.who();
    if (!w?.player) return { get: () => null, off: () => ({ key: 'gui.settings.no_character' }) };
    const get = () => { const x = accent.who(); return x?.player ? accentOf(x.player.name, x.ui?.accent) : null; };
    return { get, set: n => accent.set(n), onReset: () => accent.set(null) };
  }
  function head(text, to = account) { const h = document.createElement('h3'); h.textContent = text; to.append(h); return h; }
  function buildAccount() {
    account.replaceChildren();
    extra?.(account, head);
  }

  // ---------- the sub-tabs or the page ----------
  function setLevel(l, sound = false) {
    const was = level;
    level = l;
    if (l === 'tabs') {
      byKey = false;
      saveRow();
      L?.clear();
      if (body.contains(document.activeElement)) document.activeElement.blur();
    } else if (L) {
      byKey = true;
      L.focus(Math.max(0, rows.findIndex(r => r.id === at[tab])));
    } else { byKey = true; navs[tab].enter(); if (tab === 'account') navs[tab].key({ code: 'ArrowDown' }); }
    if (sound && was !== l) Audio.ui(l === 'tabs' ? 'back' : 'select');
    paint();
  }
  function paint() { body.classList.toggle('on-tabs', level === 'tabs' && !!where); paintDesc(); where?.onLegend?.(); }
  function paintDesc() {
    clearTimeout(saidTimer); saidTimer = 0;
    descEl.textContent = level === 'rows' && L && rows[L.index] ? rows[L.index].text() : t(`gui.settings.tab_desc.${tab}`);
  }

  // ---------- resetting ----------
  function resetPage() {
    for (const r of rows) if (!r.keep) r.opt.reset(true);
    Audio.ui('select');
    after();
    descEl.textContent = t('gui.settings.reset_done');
    saidTimer = setTimeout(paintDesc, SAID_MS);
  }
  function holdStart() {
    const c = legendEl()?.querySelector('.chip.hold');
    if (held || !c || !rows.length) return;
    held = ring(c, HOLD_MS);
    held.done.then(ok => { held = null; if (ok) resetPage(); });
  }
  function holdEnd() { held?.cancel(); }

  // ---------- keys ----------
  function key(e) {
    if (e.code !== 'KeyR') holdEnd();
    if (strip?.key(e)) return true;
    const z = { KeyZ: -1, KeyC: 1 }[e.code];
    if (z) { if (!e.repeat) strip.step(z); return true; }
    if (e.code === 'KeyR' && rows.length) {
      if (e.repeat) return true;
      if (level === 'rows') rows[L.index]?.opt.reset();
      holdStart();
      return true;
    }
    const up = e.code === 'ArrowUp' || e.code === 'KeyW', down = e.code === 'ArrowDown' || e.code === 'KeyS', side = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 }[e.code];
    const enter = e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space';
    if (level === 'tabs' && !L && pageOf(tab).contains(document.activeElement)) { level = 'rows'; byKey = true; paint(); }   // (a button of the page has the focus: Tab, or a click)
    if (level === 'tabs') {
      if (side) { strip.step(side); return true; }
      if (down || enter) { if (!e.repeat) setLevel('rows', true); return true; }
      if (e.code === 'PageDown' || e.code === 'PageUp') return !rows.length && navs[tab].key(e);
      return up;
    }
    if (!L) {
      if (up && !e.repeat && atTop()) { setLevel('tabs', true); return true; }
      return navs[tab].key(e);
    }
    if (up || down) { byKey = true; return L.key(e); }
    return rows[L.index]?.opt.key(e) || enter;
  }
  // At the beginning of a page without rows: nothing above to scroll to, and on its first control (or on none)
  function atTop() {
    const p = pageOf(tab), a = document.activeElement;
    return p.scrollTop <= 0 && (!p.contains(a) || a === p.querySelector('button:not(:disabled), input:not(:disabled)'));
  }
  // One level back (true: there was one): out of a field, from the page to its sub-tabs. From a row the mouse selected, out
  function back() {
    const a = document.activeElement;
    if (body.contains(a) && a.matches('input')) { a.blur(); return true; }
    if (level === 'rows' && byKey) { setLevel('tabs'); return true; }
    return false;
  }
  // What the keys do, for the legend (the screen adds its own)
  function legendItems() {
    const out = [], I = (k, keys, o) => out.push({ keys, text: t(`gui.legend.${k}`), ...o });
    if (level === 'tabs') { I('section', ['←', '→']); I('select', ['↓']); return out; }
    I('move', ['↑', '↓']);
    if (!L) { if (tab === 'account') I('select', ['Enter']); return out; }
    const r = rows[L.index];
    if (r && !r.disabled) { I('change', ['←', '→']); I('reset', ['R'], { onClick: () => { rows[L.index]?.opt.reset(); } }); }
    I('reset_all', ['R'], { hold: true, onHold: d => (d ? holdStart() : holdEnd()) });
    return out;
  }

  document.addEventListener('fullscreenchange', () => { if (where) for (const r of rows) r.opt.refresh(); });
  onLangChange(() => { if (where) { saveRow(); const l = level, k = byKey, y = pageOf(tab).scrollTop; build(); if (l === 'rows') { setLevel('rows'); byKey = k; } else paint(); pageOf(tab).scrollTop = y; } });

  const ui = {
    get tab() { return tab; }, get level() { return level; }, get row() { return level === 'rows' ? rows[L?.index]?.id ?? null : null; }, get mounted() { return !!where; },
    // Shows it in an element. top: its sub-tabs are the screen's own tabs (Q, E, 1-6). legendEl: where its keys are drawn;
    // onLegend: they changed
    mount(host, { top = false, legendEl = null, onLegend = null } = {}) {
      host.append(body);
      where = { host, top, legendEl, onLegend };
      build();
      makeStrip();
      setLevel('tabs');
    },
    leave() { if (!where) return; holdEnd(); clearTimeout(saidTimer); for (const k of Object.keys(at)) delete at[k]; if (body.contains(document.activeElement)) document.activeElement.blur(); where = null; box.replaceChildren(); account.replaceChildren(); L = null; rows = []; },
    // A sub-tab (inside: into its page)
    show(id, inside = false) { if (!SETTINGS_TABS.includes(id)) return; if (where) strip.pick(id, { silent: true }); else tab = id; if (inside && where) setLevel('rows'); },
    // The rows again, in the same place: what they say changed elsewhere (the world key was recovered…)
    refresh() { if (!where) return; saveRow(); const l = level; build(); if (l === 'rows' && L) setLevel('rows'); else setLevel('tabs'); },
    key, back, legendItems,
    keyup(e) { if (!e || e.code === 'KeyR') holdEnd(); },
  };
  // In the main menu: a screen of its own (already in sight: menus.js show)
  ui.openScreen = () => {
    if (screen) return;
    screen = FE.open('s-settings', { parts: [ui], keyup: ui.keyup, back, onClose: () => { screen = null; ui.leave(); if (!shutting) onClose(); } });
    ui.mount($('st-host'), { top: true, legendEl: $('st-legend'), onLegend: () => legend($('st-legend'), [...legendItems(), { keys: ['Esc'], text: t('gui.legend.back'), onClick: () => FE.back() }]) });
  };
  // Another screen takes its place: it goes without going back to the menu
  let shutting = false;
  ui.shut = () => { if (!screen) return; shutting = true; try { FE.close(screen); } finally { shutting = false; } };
  $('st-close').onclick = () => { if (screen) { Audio.ui('back'); FE.close(screen); } };
  return ui;
}

// Into the full screen or out of it (what is seen is the whole page: the game and its interface)
export async function toggleFullscreen(want = !document.fullscreenElement) {
  try {
    if (want && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      await navigator.keyboard?.lock?.(['Escape']).catch(() => {});
    } else if (!want && document.fullscreenElement) {
      navigator.keyboard?.unlock?.();
      await document.exitFullscreen();
    }
  } catch { /* (the browser does not let it) */ }
}
