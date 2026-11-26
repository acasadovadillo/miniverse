// SINGLE PLAYER, from the main menu: NEW GAME (the creator, then a world from scratch) and LOAD GAME, the account's single-player
// games as cards (the face, the name, the day and season of its world, the coins and when it was saved), the last played first.
// Each one is a character with its own world (src/slots.js). Here is how they are shown and moved through; what each thing does
// is menus.js's. Plain DOM over the key art, with the pieces of frontend.js; nothing runs per frame.
import { t, onLangChange } from '../i18n.js';
import { FE, list, legend, alertBox } from './frontend.js';
import { whenText, dayLine, lookOf } from './mainmenu.js';
import { portrait3D } from '../three/portrait.js';
import { reportFault } from '../faults.js';

const $ = id => document.getElementById(id);
const make = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
export const SINGLE_ITEMS = ['sg-new', 'sg-load'];
const DELETE_HOLD = 700;   // ms that Enter is held to remove a game (it cannot be undone)
const PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';
const BIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';

// show(id): menus.js's, puts a section in sight. games(): Profile.singles(). onNew(): the creator. onLoad(id): play it.
// onRemove(id), onRename(id, title): promises. onClose(): SINGLE PLAYER is left (back to the main menu)
export function initSingleMenu({ show, games, onNew, onLoad, onRemove, onRename, onClose }) {
  const soon = globalThis.requestIdleCallback ? fn => requestIdleCallback(fn, { timeout: 600 }) : fn => setTimeout(fn, 60);
  let screen = null, saves = null, shutting = false, SL = null, renaming = null, faces = 0;
  const L = list($('sg-list'), SINGLE_ITEMS.map(id => ({ id, el: $(id) })), { start: -1, hover: 'over', desc: $('sg-desc'), onPick: r => (r.id === 'sg-new' ? onNew() : openSaves()) });
  const say = text => { for (const id of ['sg-msg', 'sv-msg']) $(id).textContent = text || ''; };

  // ---------- SINGLE PLAYER: new game, load game ----------
  function paint() {
    const all = games(), last = all[0];
    L.set('sg-new', { desc: t('gui.single.desc.new') });
    L.set('sg-load', { desc: last ? t('gui.single.desc.load', { n: all.length, name: last.title || last.card.player.name, when: whenText(last.savedAt) }) : t('gui.single.desc.load_none') });
    legend($('sg-legend'), [{ keys: ['↑', '↓'], text: t('gui.legend.move') }, { keys: ['Enter'], text: t('gui.legend.select') }, { keys: ['Esc'], text: t('gui.legend.back'), onClick: () => FE.back() }]);
  }
  // at: the item selected ('sg-new', 'sg-load'; by default, LOAD GAME if there are games)
  function open(at = null) {
    if (!screen || screen.closed) {
      say('');
      screen = FE.open('s-single', { parts: [L], onClose: () => { screen = null; if (!shutting) onClose(); } });
    }
    paint();
    L.clear(); L.focusId(at || (games().length ? 'sg-load' : 'sg-new'));
  }

  // ---------- LOAD GAME: the cards ----------
  function card(g) {
    const el = make('div', 'sv-row'), cv = make('canvas', 'sv-face'), text = make('div', 'sv-text');
    el.dataset.id = g.id;
    cv.width = cv.height = 96; cv.setAttribute('aria-hidden', 'true');
    const c = g.card, name = make('b', 'sv-name', g.title || c.player.name);
    text.append(name);
    if (g.title && g.title !== c.player.name) text.append(make('span', 'sv-who', c.player.name));
    const sub = make('span', 'sv-sub');
    sub.append(make('span', 'sv-day', dayLine(c, true)), ` · ${t('gui.pause.money', { n: Number.isFinite(c.money) ? c.money : 0 })}`);
    text.append(sub, make('span', 'sv-when', t('gui.menu.card.saved', { when: whenText(g.savedAt) })));
    const button = (cls, svg, key, run) => {
      const b = make('button', `sq ${cls}`);
      b.type = 'button'; b.tabIndex = -1; b.innerHTML = svg;
      b.title = t(key); b.setAttribute('aria-label', t(key));
      b.onclick = e => { e.stopPropagation(); if (!renaming) run(g.id); };
      return b;
    };
    el.append(cv, text, button('sv-ren', PEN, 'gui.saves.rename', rename), button('sv-del', BIN, 'gui.saves.delete', remove));
    return el;
  }
  // (the faces, one by one when there is a moment: the first of a look takes a while; three/portrait.js keeps them)
  function paintFaces(rows) {
    const mine = ++faces;
    const next = i => {
      if (mine !== faces || !saves || i >= rows.length) return;
      soon(() => {
        if (mine !== faces || !saves) return;
        const { g, cv } = rows[i];
        try { cv.getContext('2d').drawImage(portrait3D(lookOf(g.card)), 0, 0, cv.width, cv.height); } catch (e) { reportFault(e, 'SingleMenu.face'); }
        next(i + 1);
      });
    };
    next(0);
  }
  // The list as it is now; at: the id selected (or the nearest place to it)
  function build(at = null, near = 0) {
    const all = games();
    $('sv-empty').hidden = all.length > 0;
    const rows = all.map(g => ({ id: g.id, g, el: card(g) }));
    if (!all.length) { const el = make('div', 'sv-new'); el.id = 'sv-new'; el.append(make('span', '', t('gui.single.new'))); rows.push({ id: 'sv-new', el }); }
    SL = list($('sv-list'), rows, { start: -1, hover: 'over', onPick: r => (r.id === 'sv-new' ? onNew() : onLoad(r.id)) });
    const i = rows.findIndex(r => r.id === at);
    SL.focus(i >= 0 ? i : Math.max(0, Math.min(near, rows.length - 1)));
    paintFaces(rows.filter(r => r.g).map(r => ({ g: r.g, cv: r.el.querySelector('canvas') })));
    paintSavesKeys(all.length > 0);
  }
  function paintSavesKeys(some) {
    const I = (k, keys, o) => ({ keys, text: t(k), ...o });
    legend($('sv-legend'), [I('gui.legend.move', ['↑', '↓']), I(some ? 'gui.saves.load' : 'gui.legend.select', ['Enter'], { onClick: () => SL?.pick() }),
      ...(some ? [I('gui.saves.rename', ['R'], { onClick: () => rename(selected()) }), I('gui.saves.delete', ['X'], { onClick: () => remove(selected()) })] : []),
      I('gui.legend.back', ['Esc'], { onClick: () => FE.back() })]);
  }
  const selected = () => (SL && SL.index >= 0 ? SL.rows[SL.index].id : null);
  const keys = { key(e) {
    if (renaming) return true;   // (writing the name: the field's)
    if (/^(Delete|KeyX)$/.test(e.code)) { if (!e.repeat) remove(selected()); return true; }
    if (/^(KeyR|F2)$/.test(e.code)) { if (!e.repeat) rename(selected()); return true; }
    return SL?.key(e) || false;
  } };
  function openSaves() {
    if (saves && !saves.closed) return;
    say('');
    show('s-saves');
    saves = FE.open('s-saves', { parts: [keys], back: () => { if (!renaming) return false; renaming.cancel(); return true; },
      onClose: () => { saves = null; faces++; renaming = null; if (!shutting) { show('s-single'); open('sg-load'); } } });
    build();
  }
  // Removes one, after asking (held Enter: it cannot be undone)
  async function remove(id) {
    const g = games().find(x => x.id === id);
    if (!g || !saves) return;
    const at = SL.index, name = g.title || g.card.player.name;
    if (!(await alertBox({ title: t('gui.saves.delete_title'), text: t('gui.saves.delete_text', { name }), yes: t('gui.saves.delete_yes'), no: t('common.cancel'), hold: DELETE_HOLD }))) return;
    if (!saves) return;
    try { await onRemove(id); } catch (e) { say(e.message); }
    if (saves) build(null, at);
  }
  // Renames one, written in its card: Enter or leaving the field keeps it, Esc leaves it as it was
  function rename(id) {
    const el = SL?.rows.find(r => r.id === id)?.el, g = games().find(x => x.id === id);
    if (!el || !g || renaming) return;
    const name = el.querySelector('.sv-name'), input = make('input', 'sv-input');
    input.type = 'text'; input.maxLength = 40; input.value = g.title || g.card.player.name;
    input.setAttribute('aria-label', t('gui.saves.rename'));
    let done = false;
    const end = async keep => {
      if (done) return;
      done = true; renaming = null;
      const v = input.value.trim();
      if (keep && v !== (g.title || g.card.player.name)) { try { await onRename(id, v === g.card.player.name ? '' : v); } catch (e) { say(e.message); } }
      if (saves) build(id);
    };
    renaming = { id, cancel: () => end(false) };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); end(true); } });
    input.addEventListener('blur', () => end(true));
    for (const ev of ['click', 'pointerdown']) input.addEventListener(ev, e => e.stopPropagation());
    name.replaceWith(input);
    input.focus(); input.select();
  }
  $('sg-close').onclick = () => { if (screen && FE.active() === 's-single') FE.back(); };
  $('sv-close').onclick = () => { if (saves && FE.active() === 's-saves') FE.back(); };
  onLangChange(() => { if (screen) paint(); if (saves && !renaming) build(selected()); });
  return {
    open, openSaves, say,
    get isOpen() { return !!screen; },
    get savesOpen() { return !!saves; },
    // Another screen takes their place (the creator, the game, the main menu): closed without going anywhere
    shut() { shutting = true; try { if (saves) FE.close(saves); if (screen) FE.close(screen); } finally { shutting = false; } },
    list: L, saves: () => SL,   // (for the tests)
  };
}
