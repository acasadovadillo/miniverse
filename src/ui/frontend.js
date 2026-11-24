// The shared pieces of every menu screen, in the style of an open-world game (docs/planes/realismo/PLAN-R9-menus.md §3.1):
// the stack of open screens and where their keys go (FE), a tab strip, a list with one white selected row, option rows
// with ‹ value ›, the key legend, the alert band and the ring of a held key. Plain DOM, driven by events: nothing runs per
// frame. The look is in index.html (.fe-*, .row, .chip), on the tokens of PLAN-R8-hud-mapa.md §3.1.
// Used by the login, the main menu, its credits and the character creator (src/ui/menus.js, mainmenu.js), the pause
// (src/ui/pausehub.js), the settings (src/ui/settings.js, in the pause and in the main menu), the alert band (a new game,
// starting without a save, quitting) and the menu sounds
import { t } from '../i18n.js';
import { Audio } from '../audio.js';
import { Settings } from '../settings.js';

const $ = id => document.getElementById(id);
const make = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
const CLOSE_MS = 100;                                 // --t-close
const REPEAT = { first: 350, every: 70, value: 60 };  // ms: a held arrow in a list, and on a value
const still = () => Settings.v.motion === 'reduced' || !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ---------- A key held: its own repeat (the browser's differs between keyboards) ----------
const rep = { code: null, timer: 0 };
function stopRepeat() { clearTimeout(rep.timer); rep.code = null; }
function repeat(e, fn, every = REPEAT.every) {
  stopRepeat();
  rep.code = e.code;
  fn();
  const again = () => { if (rep.code !== e.code) return; fn(); rep.timer = setTimeout(again, every); };
  rep.timer = setTimeout(again, REPEAT.first);
}
addEventListener('keyup', e => { if (e.code === rep.code) stopRepeat(); for (const s of stack) s.keyup?.(e); }, true);
addEventListener('blur', () => { stopRepeat(); for (const s of stack) s.keyup?.(null); });   // (a key let go elsewhere sends no keyup here)

// ---------- The screens open, the last one on top ----------
// A screen: { id, el, parts: [{ key(e) }], keyup(e|null), pass(e): true if that key is for what is under it (the map's own),
// back(): true if it climbed one level itself, onClose, root: the first screen (the login, the main menu…): there is nothing to
// go back to, only what its own back() does, and it goes when its section is put out of sight (menus.js show, the tests) }
const stack = [];
const gone = s => s.root && !s.el?.classList.contains('show');
const top = () => { for (let s; (s = stack[stack.length - 1]) && gone(s);) FE.close(s); return stack[stack.length - 1] || null; };
export const FE = {
  // Shows a screen (the id of its section) and puts it on top. opts: parts (who gets the keys, in order), pass, back, onClose, sound
  open(screen, opts = {}) {
    top();
    const el = opts.el || $(screen);
    const s = { id: screen, el, parts: opts.parts || [], keyup: opts.keyup, pass: opts.pass, back: opts.back, root: !!opts.root, onClose: opts.onClose, closed: false, shown: !!el && !el.classList.contains('show') };
    stack.push(s);
    el?.classList.add('show', 'fe-open');
    if (!s.root || s.back) el?.addEventListener('contextmenu', onContext);
    if (opts.sound !== null) Audio.ui(opts.sound || 'open');
    return s;
  },
  // One level back: the screen on top climbs a level, or closes
  back(sound = 'back') {
    const s = top();
    if (!s) return false;
    if (s.root) { const done = s.back?.() === true; if (done) Audio.ui(sound); return done; }
    if (!s.closing) Audio.ui(sound);
    if (s.back?.() === true) return true;
    FE.close(s);
    return true;
  },
  close(s = top()) {
    if (!s || s.closed) return;
    s.closed = true;
    stopRepeat();
    const i = stack.indexOf(s);
    if (i >= 0) stack.splice(i, 1);
    s.el?.classList.remove('fe-open');
    if (s.shown) s.el.classList.remove('show');
    s.el?.removeEventListener('contextmenu', onContext);
    s.onClose?.();
  },
  active() { return top()?.id ?? null; },
  // A keydown (input.js asks first): true, it was for the screen on top. Nothing pressed here gets to the game
  key(e) {
    const s = top();
    if (!s) return false;
    if (s.closing) return true;
    const el = e.target instanceof Element ? e.target : null, other = el && el !== document.body && el !== document.documentElement && !s.el?.contains(el);
    if (e.metaKey || e.ctrlKey || e.altKey) return true;   // (the browser's: left alone, but not the game's either)
    if (e.code === 'Escape') {
      if (!e.repeat) { e.preventDefault(); FE.back(); }   // (held Esc leaves the full screen: the browser's)
      return true;
    }
    if ((writes(el) && !(el instanceof HTMLInputElement && /^Arrow(Up|Down)$/.test(e.code))) || (other && /^(Enter|NumpadEnter|Space)$/.test(e.code))) return true;   // (writing: in a line, ↑ and ↓ are still the page's; or a button of a notice over the screen)
    if (s.pass?.(e)) return false;
    for (const p of s.parts) if (p.key(e)) { e.preventDefault(); return true; }
    if (e.code === 'Tab' || /^F\d+$/.test(e.code)) return true;   // (the browser's own focus, its keys)
    if (e.code === 'Backspace' && !e.repeat) FE.back();
    e.preventDefault();
    return true;
  },
};
// A field one writes in (a slider or a check box is not: the arrows and the letters are still the screen's)
const writes = el => el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && !/^(range|checkbox|radio|button|submit|color)$/.test(el.type));
// Right click: back, except over a map (there it removes the route) and in a field (pasting)
function onContext(e) {
  if (e.target instanceof HTMLCanvasElement || writes(e.target)) return;
  e.preventDefault();
  FE.back();
}

// ---------- Key chips and the ring of a held key ----------
const RING = '<svg class="ring" aria-hidden="true"><rect class="bg"/><rect class="fg" pathLength="1"/></svg>';
// A key as a chip: 'E', 'Esc', '↑'…; 'mouse:l' and 'mouse:r' are a drawn mouse with that button lit
export function chip(key, hold = false) {
  const mouse = /^mouse:([lr])$/.exec(key), el = make('kbd', 'chip' + (mouse ? ` mouse ${mouse[1]}` : ''), mouse ? '' : key);
  if (mouse) el.setAttribute('aria-label', t(mouse[1] === 'l' ? 'key.click' : 'hud.key.right_click'));
  if (hold) holdChip(el);
  return el;
}
function holdChip(el) {
  el.classList.add('hold');
  if (!el.querySelector('.ring')) el.insertAdjacentHTML('beforeend', RING);
  return el.querySelector('.fg');
}
// Fills the ring of a chip in ms (the key is being held). { done: Promise<boolean>, cancel() }: cancel empties it
export function ring(el, ms) {
  const fg = holdChip(el);
  let finish;
  const done = new Promise(r => { finish = r; });
  const run = fg.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: ms, fill: 'forwards' });
  const timer = setTimeout(() => {
    run.cancel();
    el.animate([{ filter: 'brightness(1.8)' }, { filter: 'none' }], { duration: 160 });
    finish(true);
  }, ms);
  return {
    done,
    cancel() {
      clearTimeout(timer);
      const at = +getComputedStyle(fg).strokeDashoffset.replace('px', '');
      run.cancel();
      fg.animate([{ strokeDashoffset: at }, { strokeDashoffset: 1 }], { duration: 150 });
      finish(false);
    },
  };
}

// The key legend: [{ keys: ['Q', 'E'], text, hold, onClick, onHold }] (with onClick, it can be pressed with the mouse too; with
// onHold(down), held)
export function legend(el, items) {
  el.classList.add('fe-legend');
  el.replaceChildren(...items.map(it => {
    const box = make(it.onClick || it.onHold ? 'button' : 'span', 'fe-key');
    if (it.onClick) { box.type = 'button'; box.onclick = it.onClick; }
    if (it.onHold) {
      box.type = 'button'; box.tabIndex = -1;
      box.addEventListener('pointerdown', e => { if (e.button === 0) it.onHold(true); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) box.addEventListener(ev, () => it.onHold(false));
    }
    for (const k of it.keys) box.append(chip(k, it.hold));
    box.append(make('span', '', it.text));
    return box;
  }));
}

// ---------- Tabs ----------
// tabs: [{ id, text, i18n (its key: the text follows the language) }]. Q and E (or other two letters: keys) go round, 1-9 jump
// (digits: false, they do not), a click picks; the line under the current one slides. One put out of sight (hidden) is skipped
export function tabStrip(el, tabs, { onPick, current, keys = ['Q', 'E'], digits = true } = {}) {
  let now = Math.max(0, tabs.findIndex(x => x.id === current));
  el.classList.add('fe-tabs');
  el.setAttribute('role', 'tablist');
  const line = make('i', 'fe-line');
  const btns = tabs.map((x, i) => {
    const b = make('button', 'fe-tab', x.text);
    b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.tab = x.id;
    if (x.i18n) b.dataset.i18n = x.i18n;
    b.onclick = () => { go(i); b.blur(); };
    return b;
  });
  el.replaceChildren(chip(keys[0]), ...btns, chip(keys[1]), line);
  function paint() {
    btns.forEach((b, i) => { b.classList.toggle('on', i === now); b.setAttribute('aria-selected', String(i === now)); b.tabIndex = i === now ? 0 : -1; });
    const b = btns[now];
    if (b) line.style.transform = `translateX(${b.offsetLeft}px) scaleX(${b.offsetWidth / 100})`;
  }
  function go(i, { silent = false } = {}) {
    if (!btns[i] || i === now) return;
    now = i;
    paint();
    if (!silent) Audio.ui('tab');
    onPick?.(tabs[now].id);
  }
  const step = d => { const n = tabs.length; for (let k = 1, i; k < n; k++) { i = (now + d * k + n * k) % n; if (!btns[i].hidden) return go(i); } };
  paint();
  const seen = new ResizeObserver(paint);   // (shown later, or wider with another language: the line goes with its tab)
  for (const b of [el, ...btns]) seen.observe(b);
  return {
    el,
    get current() { return tabs[now]?.id; },
    pick: (id, opts) => go(tabs.findIndex(x => x.id === id), opts),
    step, btns,
    destroy: () => seen.disconnect(),
    key(e) {
      const n = tabs.length, k = keys.indexOf(/^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : '');
      if (k >= 0) { if (!e.repeat) step(k ? 1 : -1); return true; }
      if (digits && /^Digit[1-9]$/.test(e.code) && +e.code.slice(5) <= n) { const b = btns[+e.code.slice(5) - 1]; if (!e.repeat && !b.hidden) go(btns.indexOf(b)); return true; }
      return false;
    },
  };
}

// ---------- A list ----------
const dim = (row, off) => { row.classList.toggle('off', !!off); if (off) row.setAttribute('aria-disabled', 'true'); else row.removeAttribute('aria-disabled'); };
// rows: [{ id, text, value, desc, disabled, el (its own element, instead of a new one) }]. One is selected (.sel, the white
// bar): ↑↓ or W S move it (held, they repeat), the mouse selects what it is over (without a tick; hover: false, only a click
// does, and it does not pick: a list of pages; 'move': only when it really moves over it, and a click does not pick: a list of
// options; 'over': the same, and a click picks: a list that shows up under a mouse at rest), Enter, Space or a click pick it. desc: an element for its description. start: the one selected at first (-1: none
// yet). wrap: false, it stops at its ends and says so (onEdge(-1 or 1)). set(id, { disabled, hidden, desc }) changes one; a hidden
// one is skipped
export function list(el, rows, { onPick, onFocus, desc, hover = true, start = 0, wrap = true, onEdge } = {}) {
  let at = -1, over = false;
  el.classList.add('fe-list');
  el.setAttribute('role', 'listbox');
  const els = rows.map((r, i) => {
    const row = r.el || make('div');
    row.classList.add('row');
    row.setAttribute('role', 'option');
    if (!r.el) row.append(make('span', '', r.text));
    if (r.value !== undefined) row.append(make('b', '', r.value));
    dim(row, r.disabled);
    if (r.hidden) row.hidden = true;
    if (hover) row.addEventListener(hover === true ? 'pointerenter' : 'pointermove', () => { if (at === i) return; over = true; focus(i); over = false; });
    row.onclick = () => { if (hover === true || hover === 'over') { focus(i); pick(); } else if (i !== at) { focus(i); Audio.ui('tick'); } };
    return row;
  });
  el.replaceChildren(...els);
  function focus(i) {
    if (!els[i] || els[i].hidden || i === at) return;
    at = i;
    els.forEach((x, k) => { x.classList.toggle('sel', k === i); x.setAttribute('aria-selected', String(k === i)); x.tabIndex = k === i ? 0 : -1; });
    if (!over) els[i].scrollIntoView({ block: 'nearest' });
    if (desc) desc.textContent = rows[i].desc || '';
    onFocus?.(rows[i], i);
  }
  function pick() {
    const r = rows[at];
    if (!r) return;
    if (r.disabled) { Audio.ui('deny'); return; }
    Audio.ui('select');
    onPick?.(r, at);
  }
  const move = d => {
    if (!rows.length) return;
    const n = rows.length;
    let to = -1;
    for (let k = 1; k <= n && to < 0; k++) { const i = at + d * k, j = (i + n * k + n) % n; if (!wrap && !els[i]) break; if (!els[j].hidden) to = j; }
    if (to < 0 || to === at) { if (!wrap) onEdge?.(d); return; }
    focus(to);
    Audio.ui('tick');
  };
  // (which are in sight changed: if the selected one went, the first)
  function settle() { if (els[at] && !els[at].hidden) return; at = -1; for (const x of els) x.classList.remove('sel'); focus(els.findIndex(x => !x.hidden)); }
  if (rows.length) focus(start);
  return {
    el, rows, focus, pick, settle,
    focusId: id => focus(rows.findIndex(r => r.id === id)),
    set(id, o) {
      const i = rows.findIndex(r => r.id === id), r = rows[i];
      if (!r) return;
      Object.assign(r, o);
      if ('disabled' in o) dim(els[i], o.disabled);
      if ('hidden' in o) els[i].hidden = !!o.hidden;
      if ('desc' in o && desc && i === at) desc.textContent = r.desc || '';
    },
    get index() { return at; },
    clear() { at = -1; for (const x of els) { x.classList.remove('sel'); x.setAttribute('aria-selected', 'false'); x.tabIndex = -1; } },
    key(e) {
      const d = { ArrowUp: -1, KeyW: -1, ArrowDown: 1, KeyS: 1 }[e.code];
      if (d) { if (!e.repeat) repeat(e, () => move(d)); return true; }
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') { if (!e.repeat) pick(); return true; }
      return false;
    },
  };
}

// ---------- A pane without a list: the keyboard goes through its controls, or scrolls it ----------
const FOCUS = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary';
// (↑↓ from row to row, ← → change the one it is on, Enter or Space press it; without controls, ↑↓ scroll. skip: a selector of the
// controls only the mouse and Tab get to)
export function paneNav(el, { skip = null } = {}) {
  let at = -1;
  const stops = () => {
    const seen = new Set(), out = [];
    for (const x of el.querySelectorAll(FOCUS)) {
      if (!x.offsetParent || (skip && x.matches(skip))) continue;
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

// ---------- An option: Label ........ ‹ Value › ----------
// values: [[value, text], …]; or min, max, step (a bar with its number, which the mouse can drag); or neither: on and off.
// ← → or A D change it (with Shift, four steps), Enter flips a choice of two, R puts def back (or calls onReset). colours: a
// swatch for each value, which can be clicked. disabled: it is seen and cannot be changed. other: what it says with a value that is
// none of them
export function optionRow({ label, desc = '', get, set, values, min, max, step = 1, def, onReset, colours, disabled = false, other }) {
  const range = min !== undefined, opts = range ? null : values || [[true, t('common.yes')], [false, t('common.no')]];
  const el = make('div', 'row fe-opt'), prev = make('button', 'fe-arrow', '‹'), val = make('b'), next = make('button', 'fe-arrow', '›');
  el.dataset.desc = desc;
  for (const [b, d] of [[prev, -1], [next, 1]]) { b.type = 'button'; b.tabIndex = -1; b.disabled = disabled; b.onclick = () => change(d); }
  el.append(make('span', '', label), prev, val, next);
  let bar = null, sw = null;
  if (range) {
    bar = make('i', 'fe-bar');
    el.classList.add('range');
    val.before(bar);
    if (!disabled) dragBar();
  } else if (!disabled) val.onclick = () => change(1);
  if (colours) {
    sw = make('div', 'fe-sw');
    sw.append(...colours.map((c, i) => { const b = make('button'); b.type = 'button'; b.tabIndex = -1; b.style.background = c; b.title = opts[i][1]; b.disabled = disabled; b.onclick = () => put(opts[i][0]); return b; }));
    prev.before(sw);
  }
  // (the number under the mouse, one by one: the steps are the keyboard's)
  function dragBar() {
    let held = false, from;
    const at = e => { const r = bar.getBoundingClientRect(); put(Math.round(min + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (max - min)), true); };
    bar.addEventListener('pointerdown', e => { if (e.button) return; held = true; from = get(); bar.setPointerCapture(e.pointerId); at(e); e.preventDefault(); });
    bar.addEventListener('pointermove', e => { if (held) at(e); });
    for (const ev of ['pointerup', 'pointercancel']) bar.addEventListener(ev, () => { if (held && get() !== from) Audio.ui('tick'); held = false; });
  }
  function refresh() {
    const v = get();
    if (range) { val.textContent = String(v); bar.style.setProperty('--v', String((v - min) / (max - min))); return; }
    const i = opts.findIndex(o => o[0] === v);
    val.textContent = opts[i]?.[1] ?? other ?? String(v ?? '');
    if (sw) [...sw.children].forEach((b, k) => b.classList.toggle('on', k === i));
  }
  function put(to, quiet = false) {
    if (disabled || to === get()) return;
    set(to);
    if (!quiet) Audio.ui('tick');
    refresh();
  }
  function change(d) {
    if (disabled) { Audio.ui('deny'); return; }
    const v = get();
    if (range) { put(Math.max(min, Math.min(max, Math.round((v + d * step) / step) * step))); return; }
    const i = opts.findIndex(o => o[0] === v);
    put(opts[((i < 0 ? 0 : i + Math.sign(d)) + opts.length) % opts.length][0]);
  }
  function reset(quiet = false) {
    if (disabled) return;
    if (onReset) { onReset(); if (!quiet) Audio.ui('tick'); refresh(); } else if (def !== undefined) put(def, quiet);
  }
  refresh();
  return {
    el, refresh, reset, change, disabled,
    key(e) {
      const d = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 }[e.code];
      if (d) { if (!e.repeat) repeat(e, () => change(e.shiftKey && range ? d * 4 : d), range ? REPEAT.value : 160); return true; }
      if ((e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') && !range) { if (!e.repeat) change(1); return true; }
      if (e.code === 'KeyR') { if (!e.repeat) reset(); return true; }
      return false;
    },
  };
}

// ---------- The alert band ----------
// "Are you sure?": a dark band across the screen. A promise of true (Enter, or a click on its key) or false (Esc, Backspace,
// right click or a click on its key). hold: ms that Enter (or the click) must be held, with its ring
let alertOpen = null;
export function alertBox({ title, text = '', yes = t('gui.alert.yes'), no = t('gui.alert.no'), hold = 0 } = {}) {
  alertOpen?.(false);   // (one at a time: the one before is answered no)
  return new Promise(resolve => {
    const before = document.activeElement, el = make('div', 'fe-alert'), band = make('div', 'fe-band'), keysEl = make('div');
    const h = make('h2', '', title), p = make('p', '', text);
    h.id = 'fe-alert-title'; p.id = 'fe-alert-text';
    el.id = 'fe-alert';
    el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', h.id); el.setAttribute('aria-describedby', p.id);
    el.tabIndex = -1;
    band.append(h, p, keysEl);
    el.append(band);
    let held = null, answered = false;
    const answer = (ok, sound = ok ? 'select' : 'back') => {
      if (answered) return;
      answered = true;
      alertOpen = null;
      letGo();
      if (sound) Audio.ui(sound);
      screen.closing = true;   // (while it fades, its keys still do nothing else)
      el.classList.add('out');
      el.classList.remove('fe-open');
      setTimeout(() => {
        FE.close(screen);
        el.remove();
        if (!alertOpen && before instanceof HTMLElement && before.isConnected) before.focus?.({ preventScroll: true });
        resolve(ok);
      }, still() ? 0 : CLOSE_MS);
    };
    const press = () => {
      if (!hold) { answer(true); return; }
      if (held) return;
      held = ring(keysEl.querySelector('.chip'), hold);
      held.done.then(ok => { held = null; if (ok) answer(true); });
    };
    function letGo() { held?.cancel(); }
    legend(keysEl, [{ keys: ['Enter'], text: yes, hold: !!hold, onClick: hold ? () => {} : press }, { keys: ['Esc'], text: no, onClick: () => answer(false) }]);
    const [yesKey] = keysEl.children;
    if (hold) { yesKey.addEventListener('pointerdown', press); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) yesKey.addEventListener(ev, letGo); }
    document.body.append(el);
    before?.blur?.();
    const screen = FE.open('fe-alert', {
      el,
      // (a held Enter that opened it does not answer it, and Tab does not leave it: the answers are Enter and Esc)
      parts: [{ key(e) { if (e.code === 'Enter' || e.code === 'NumpadEnter') { if (!e.repeat) press(); return true; } return e.code === 'Tab'; } }],
      keyup: e => { if (!e || e.code === 'Enter' || e.code === 'NumpadEnter') letGo(); },
      back: () => { answer(false, null); return true; },   // (FE.back already sounded)
    });
    el.focus({ preventScroll: true });
    alertOpen = answer;
  });
}

// ---------- Sounds of the menus built before this file ----------
// (a click on what their screens have: back, a tab or choice, anything else)
export function initMenuSounds(ids) {
  for (const id of ids) $(id)?.addEventListener('click', e => {
    const b = e.target instanceof Element && e.target.closest('button');
    if (!b || b.disabled || b.closest('.row, .fe-tabs, .fe-legend')) return;   // (they have their own)
    Audio.ui(b.matches('[id$="-close"], [id$="-back"], [id$="-cancel"], #p-resume') ? 'back' : b.closest('.seg, .tabs, .sw, .cyc, .lang-pick') ? 'tick' : 'select');
  });
}
