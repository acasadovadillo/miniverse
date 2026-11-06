// Interfaz durante la partida: aviso de interacción, diálogos, nombre del lugar y fundido a negro.
import { Audio } from '../audio.js';
import { portrait3D } from '../three/portrait.js';

const $ = id => document.getElementById(id);
let shownPrompt = null, shownCoords = null, shownHint = null, dialog = null;

// Retrato de quien habla (si es una persona conocida): su cara en 3D. El nombre puede llevar detrás los corazones.
function showFace(name) {
  const look = hud.faces[name.split('  ')[0]], box = $('dialog'), cv = $('dlg-face');
  box.classList.toggle('face', !!look);
  if (!look) return;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  g.drawImage(portrait3D(look), 0, 0, cv.width, cv.height);
}

export const hud = {
  get dialogOpen() { return !!dialog; },
  faces: {},   // nombre → aspecto, para poner su retrato en los diálogos

  // Solo toca la página cuando el aviso cambia
  // at: junto a qué punto de la pantalla (el cursor); sin él, abajo, en el centro
  prompt(text, at = null) {
    const label = text || '', el = $('prompt');
    if (label !== shownPrompt) {
      shownPrompt = label;
      el.classList.toggle('show', !!label);
      if (label) $('prompt-text').textContent = label;
    }
    el.classList.toggle('follow', !!(label && at));
    if (label && at) {
      const x = Math.max(6, Math.min(innerWidth - el.offsetWidth - 6, at[0] + 18)), y = Math.max(6, Math.min(innerHeight - el.offsetHeight - 6, at[1] + 18));
      el.style.transform = `translate(${x}px, ${y}px)`;
    } else el.style.transform = '';
  },

  // Nombre del lugar; con flash, destaca un momento (al cambiar de bioma)
  place(text, flash = false) {
    $('place-name').textContent = text;
    if (flash) $('place').animate([{ transform: 'scale(1.15)', borderColor: '#fff3c0' }, { transform: 'scale(1)' }], { duration: 600, easing: 'ease-out' });
  },
  money(n) { $('money').textContent = `${n} 🪙`; },
  hint(text) {
    if (text === shownHint) return;
    shownHint = text;
    $('hint').classList.toggle('show', !!text);
    if (text) $('hint-text').textContent = text;
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
      $('dialog').classList.add('show');
      dialog = {
        next() {
          Audio.blip();
          if (++i < lines.length) { $('dlg-text').textContent = lines[i]; return; }
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
      ok.type = 'button'; ok.textContent = 'Aceptar';
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
  title(text) {
    const el = $('title-msg');
    el.textContent = text;
    el.classList.remove('out'); el.hidden = false;
    clearTimeout(this.titleT); clearTimeout(this.titleOut);
    this.titleT = setTimeout(() => el.classList.add('out'), 3500);
    this.titleOut = setTimeout(() => { el.hidden = true; }, 4200);
  },
  // Aviso breve arriba en el centro (logros, días nuevos…)
  toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast panel ' + kind;
    el.textContent = text;
    $('toasts').append(el);
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3700);
  },

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
