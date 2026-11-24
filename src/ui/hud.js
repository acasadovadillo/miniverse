// Interfaz durante la partida: aviso de interacción, diálogos, nombre del lugar y fundido a negro.
import { Audio } from '../audio.js';
import { portrait3D } from '../three/portrait.js';
import { t, fmt } from '../i18n.js';
import { chip } from './frontend.js';
import { feed, KINDS } from './feed.js';
import { glyph } from './glyphs.js';
import { HudLog } from './hudlog.js';

const $ = id => document.getElementById(id);
let shownCoords = null, shownHint = null, shownHintKey, shownClock = null, dialog = null;

// Retrato de quien habla (si es una persona conocida): su cara en 3D. El nombre puede llevar detrás los corazones.
function showFace(name) {
  const look = hud.faces[name.split('  ')[0]], box = $('dialog'), cv = $('dlg-face');
  box.classList.toggle('face', !!look);
  if (!look) return;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  g.drawImage(portrait3D(look), 0, 0, cv.width, cv.height);
}

// The prompt in sight
const prompt = { el: null, sig: '', chips: [], follow: false, x: NaN, y: NaN, w: 0, h: 0, held: null, heldK: 0 };
const one = { key: 'E', text: '' }, single = [one], none = [];
addEventListener('resize', () => { prompt.w = 0; });
// An amount of money in el, with the coin after it
function coins(el, n) {
  if (!el) return;
  if (!el.querySelector('.gl')) el.innerHTML = `<span></span>${glyph('coin')}`;
  el.firstChild.textContent = fmt.num(Number(n) || 0);
}
const BIG_GAP = 20, BIG_HOLD = 3000, BIG_OUT = 700;
let bigAt = -Infinity, bigT = 0, bigOut = 0;
function big(title, sub) {
  const el = $('title-msg');
  el.textContent = '';
  for (const [tag, text] of [['b', title], ['i', ''], ['span', sub]]) { const e = document.createElement(tag); e.textContent = text; el.append(e); }
  el.classList.remove('out'); el.hidden = false;
  bigAt = performance.now() / 1000;
  clearTimeout(bigT); clearTimeout(bigOut);
  bigT = setTimeout(() => el.classList.add('out'), BIG_HOLD);
  bigOut = setTimeout(() => { el.hidden = true; }, BIG_HOLD + BIG_OUT);
}

export const hud = {
  get dialogOpen() { return !!dialog; },
  faces: {},   // nombre → aspecto, para poner su retrato en los diálogos
  log: new HudLog(),   // (the last lines said and the last notices: the pause's Brief tab)

  feed,        // the lines above the minimap (ui/feed.js); toast() is its old door

  // What the keys do here: up to three rows, each a key and a text ([{ key: 'E', text, hold?, dim? }]; a key of chip(),
  // ui/frontend.js: 'E', 'mouse:l'…), or one text (a string, the old form: one row with key). hold: that key has to be held
  // (its chip has a ring: promptHold). at: [x, y] on the screen, beside which it goes (ui/prompts.js: the thing aimed at, or
  // the cursor); without it, at the bottom, in the middle. The page is written only when the rows change or it moves a pixel
  prompt(rows, at = null, key = 'E') {
    if (typeof rows === 'string' || rows === null || rows === undefined) { one.key = key; one.text = rows || ''; rows = rows ? single : none; }
    const P = prompt, el = P.el ||= $('prompt');
    let sig = '';
    for (const r of rows) sig += `${r.key}\u0001${r.text}\u0001${r.hold ? 1 : 0}${r.dim ? 1 : 0}\u0002`;
    if (sig !== P.sig) {
      P.sig = sig;
      el.classList.toggle('show', !!rows.length);
      if (rows.length) this.paintPrompt(rows);   // (none: the last ones fade where they were)
    }
    if (!rows.length) return;
    const follow = !!at;
    if (follow !== P.follow) { P.follow = follow; P.x = P.y = NaN; el.classList.toggle('follow', follow); if (!follow) el.style.transform = ''; }
    if (!follow) return;
    if (!P.w) { P.w = el.offsetWidth; P.h = el.offsetHeight; }   // (measured once per content, not per frame)
    const safe = 24 * Math.max(0.85, Math.min(1.3, innerHeight / 1080));
    const x = Math.round(Math.max(safe, Math.min(innerWidth - P.w - safe, at[0]))), y = Math.round(Math.max(safe, Math.min(innerHeight - P.h - safe, at[1])));
    if (x !== P.x || y !== P.y) { P.x = x; P.y = y; el.style.transform = `translate3d(${x}px, ${y}px, 0)`; }
  },
  paintPrompt(rows) {
    const P = prompt, box = $('prompt-text');
    box.textContent = '';
    P.chips = rows.map(r => {
      const row = document.createElement('div'), k = chip(r.key, !!r.hold), text = document.createElement('span');
      row.className = r.dim ? 'pr dim' : 'pr';
      text.textContent = r.text;
      row.append(k, text);
      box.append(row);
      return { key: r.key, el: k, hold: !!r.hold };
    });
    P.w = 0;
    if (P.held) this.promptHold(P.held, P.heldK);
  },
  // (it goes to another thing: a short fade, so it does not look like a jump)
  promptFade() { prompt.el?.animate?.([{ opacity: 0.2 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' }); },
  // The key of a row, being held: its ring at k (0 to 1), or let go of (k < 0: it empties). done: it filled, a white flash.
  // Returns whether that key has a row in sight
  promptHold(key, k, done = false) {
    const P = prompt, c = P.sig ? P.chips.find(c => c.key === key) : null;
    P.held = c && k >= 0 && !done ? key : null; P.heldK = k;
    if (!c) return false;
    const n = k < 0 ? 0 : Math.round(Math.min(1, k) * 100);
    if (n && !c.el.querySelector('.ring')) { const full = chip(key, true); full.className = c.el.className + ' hold'; c.el.replaceWith(full); c.el = full; }   // (a tap key that can also be held: its ring comes with the hold)
    if (c.n !== n || done) {
      c.n = n;
      c.el.classList.toggle('filling', k >= 0 && !done);   // (no transition while it fills; emptying, 0.15 s)
      c.el.style.setProperty('--p', done ? 0 : n / 100);
      if (done) c.el.animate?.([{ filter: 'brightness(1.8)', boxShadow: '0 0 14px #fff' }, { filter: 'none', boxShadow: 'none' }], { duration: 220 });
    }
    return true;
  },

  // Nombre del lugar (la interfaz completa; la mínima tiene su ficha, smarthud.js); con flash, destaca un momento
  place(text, flash = false) {
    $('place-name').textContent = text;
    if (flash) $('place').animate([{ transform: 'scale(1.15)', borderColor: '#fff3c0' }, { transform: 'scale(1)' }], { duration: 600, easing: 'ease-out' });
  },
  money(n) { coins($('money'), n); },
  coins,
  // The time, and the glyph of the weather after it
  clock(text, sky) {
    const el = $('clock');
    if (shownClock === null) { el.textContent = ''; el.append(document.createElement('span')); el.insertAdjacentHTML('beforeend', '<i></i>'); }
    if (shownClock?.text !== text) el.firstChild.textContent = text;
    if (shownClock?.sky !== sky) el.lastChild.innerHTML = glyph(sky);
    shownClock = { text, sky };
  },
  // key: the key on its label (undefined: the click, as always; '': none; 'Q'…: that one)
  hint(text, key) {
    if (text === shownHint && key === shownHintKey) return;
    shownHint = text; shownHintKey = key;
    $('hint').classList.toggle('show', !!text);
    if (text) $('hint-text').textContent = text;
    const click = $('hint').querySelector('kbd[data-i18n]');
    let own = $('hint-key');
    if (key !== undefined && !own) { own = document.createElement('kbd'); own.id = 'hint-key'; click?.after(own); }
    if (click) click.style.display = key !== undefined ? 'none' : '';   // (kbd is inline-block: hidden would not hide it)
    if (own) { own.style.display = key ? '' : 'none'; own.textContent = key || ''; }
  },
  coords(xy) {
    const text = xy ? `${xy[0]}, ${xy[1]}` : '';
    if (text !== shownCoords) { shownCoords = text; $('coords').textContent = text; }
  },

  say(name, lines) {
    return new Promise(resolve => {
      let i = 0;
      showFace(name);
      $('dlg-name').textContent = name;
      $('dlg-text').textContent = lines[0];
      hud.log.say(name, lines[0]);
      $('dialog').classList.add('show');
      dialog = {
        next() {
          Audio.blip();
          if (++i < lines.length) { $('dlg-text').textContent = lines[i]; hud.log.say(name, lines[i]); return; }
          hud.closeDialog();
          resolve();
        },
      };
    });
  },
  // Pregunta con opciones; devuelve el índice elegido. Se elige con clic, flechas o números, y se confirma con E, Espacio o clic.
  ask(name, text, options) {
    return new Promise(resolve => {
      let sel = 0;
      showFace(name);
      if (hud.faces[name.split('  ')[0]]) hud.log.say(name, text);   // (somebody asks: what they say with it; not a menu's question)
      $('dlg-name').textContent = name;
      $('dlg-text').textContent = text;
      const box = $('dlg-opts');
      box.textContent = '';
      const btns = options.map((o, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = `${i + 1}. ${o}`;
        b.onclick = e => { e.stopPropagation(); sel = i; dialog.next(); };
        box.append(b);
        return b;
      });
      const paint = () => btns.forEach((b, i) => b.classList.toggle('on', i === sel));
      paint();
      $('dialog').classList.add('show', 'asking');
      dialog = {
        move(d) { sel = (sel + d + options.length) % options.length; paint(); Audio.blip(); },
        pick(i) { if (i < options.length) { sel = i; this.next(); } },
        next() {
          Audio.blip();
          box.textContent = '';
          $('dialog').classList.remove('asking');
          hud.closeDialog();
          resolve(sel);
        },
      };
    });
  },
  // Pide un texto (un nombre): se escribe y se acepta con Intro o con el botón. Si se deja vacío, def.
  askText(name, text, def = '') {
    return new Promise(resolve => {
      showFace(name);
      $('dlg-name').textContent = name;
      $('dlg-text').textContent = text;
      const box = $('dlg-opts'), input = document.createElement('input'), ok = document.createElement('button');
      box.textContent = '';
      Object.assign(input, { type: 'text', maxLength: 16, value: def, className: 'dlg-input', autocomplete: 'off' });
      ok.type = 'button'; ok.textContent = t('common.ok');
      box.append(input, ok);
      $('dialog').classList.add('show', 'asking');
      const done = () => { const v = input.value.trim() || def; box.textContent = ''; Audio.blip(); hud.closeDialog(); resolve(v); };
      ok.onclick = e => { e.stopPropagation(); done(); };
      input.onclick = e => e.stopPropagation();
      input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); done(); } };
      dialog = { move() {}, pick() {}, next() {} };   // (solo se cierra aceptando)
      setTimeout(() => input.focus(), 30);
    });
  },
  get asking() { return !!dialog?.move; },
  next() { dialog?.next(); },
  closeDialog() { $('dialog').classList.remove('show', 'asking'); dialog = null; },

  // Un texto grande en el centro de la pantalla (/title), que se va solo
  title(text) { big(text, ''); },
  // A big message in the middle for what happens seldom: a new day, a level, a record, the first time in a place. One every
  // BIG_GAP seconds at most, and never over a dialogue, the tool wheel or a menu: then it is not shown (false), and who
  // asks says it in the feed. line: that line of the feed, if given (it is pushed here)
  big({ title, sub = '', line = '', kind = 'good' }) {
    const T = performance.now() / 1000;
    if (T - bigAt >= BIG_GAP && !feed.busy() && document.body.classList.contains('playing')) { big(title, sub); Audio.ui('stamp'); hud.log.note(line || title, kind); return true; }
    if (line) hud.toast(line, kind);
    return false;
  },
  // A notice: a line of the feed (ui/feed.js). kind: one of its KINDS ('good' for good news); the old '' and 'ok' still do
  toast(text, kind = '') { hud.log.note(text, kind); feed.push({ kind: KINDS[kind] ? kind : kind === 'ok' ? 'good' : 'world', text: String(text) }); },

  fade(on) {
    $('fade').classList.toggle('on', on);
    return new Promise(r => setTimeout(r, 280));
  },
};
$('dialog').addEventListener('click', () => { if (!hud.asking) hud.next(); });
// Mover la elección con el teclado mientras hay una pregunta
addEventListener('keydown', e => {
  if (!dialog?.move) return;
  const k = e.code;
  if (k === 'ArrowUp' || k === 'KeyW') { dialog.move(-1); e.preventDefault(); e.stopImmediatePropagation(); }
  else if (k === 'ArrowDown' || k === 'KeyS') { dialog.move(1); e.preventDefault(); e.stopImmediatePropagation(); }
  else if (/^Digit[1-9]$/.test(k)) { dialog.pick(+k.slice(5) - 1); e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
