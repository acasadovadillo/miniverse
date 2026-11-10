// Pantalla de ajustes
import { Settings } from '../settings.js';

const $ = id => document.getElementById(id);

export function initSettingsUI({ onClose }) {
  const box = $('st-body');
  // (se rehace al abrirse: al entrar con tu cuenta, los volúmenes pasan a ser los tuyos)
  const slider = (key, label) => {
    const row = document.createElement('label');
    row.className = 'st-row';
    row.innerHTML = `<span>${label}</span><input type="range" min="0" max="100" value="${Math.round(Settings.v[key] * 100)}"><b>${Math.round(Settings.v[key] * 100)}%</b>`;
    const input = row.querySelector('input'), out = row.querySelector('b');
    input.oninput = () => { out.textContent = input.value + '%'; Settings.set(key, input.value / 100); };
    box.append(row);
  };
  const check = (key, label) => {
    const row = document.createElement('label');
    row.className = 'st-row check';
    row.innerHTML = `<input type="checkbox" ${Settings.v[key] ? 'checked' : ''}><span>${label}</span>`;
    row.querySelector('input').onchange = e => Settings.set(key, e.target.checked);
    box.append(row);
  };
  const choice = (key, label, opts) => {
    const row = document.createElement('div');
    row.className = 'st-row';
    row.innerHTML = `<span>${label}</span><div class="seg"></div>`;
    for (const [v, name] of opts) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = name;
      b.onclick = () => { Settings.set(key, v); paint(); };
      row.querySelector('.seg').append(b);
    }
    const paint = () => [...row.querySelectorAll('button')].forEach((b, i) => b.classList.toggle('on', opts[i][0] === Settings.v[key]));
    paint();
    box.append(row);
  };
  const head = text => { const h = document.createElement('h3'); h.className = 'st-head'; h.textContent = text; box.append(h); };
  // Pantalla completa: el juego ocupa toda la pantalla, sin el navegador, como un vídeo a pantalla completa. Con el
  // teclado bloqueado (Chrome y Edge), Esc sigue abriendo la pausa y para salir se mantiene pulsado; si no, Esc sale
  const full = () => !!document.fullscreenElement;
  const fullRow = () => {
    const row = document.createElement('div');
    row.className = 'st-row';
    row.innerHTML = '<span>Pantalla completa</span><div class="seg"><button type="button">Sí</button><button type="button">No</button></div>';
    const [on, off] = row.querySelectorAll('button');
    const paint = () => { on.classList.toggle('on', full()); off.classList.toggle('on', !full()); };
    on.onclick = () => toggleFullscreen(true).finally(paint);
    off.onclick = () => toggleFullscreen(false).finally(paint);
    document.addEventListener('fullscreenchange', paint);
    paint();
    box.append(row);
    if (!document.fullscreenEnabled) { on.disabled = true; row.title = 'Este navegador no deja ponerlo a pantalla completa'; }
  };
  function build() {
    box.replaceChildren();
    head('Sonido');
    slider('master', 'Volumen general');
    check('musicOn', 'Música');
    slider('music', 'Volumen de la música');
    slider('sfx', 'Volumen de los efectos');
    head('Pantalla');
    fullRow();
    choice('scale', 'Resolución', [['auto', 'Auto'], [1, 'Máxima'], [2, 'Alta'], [3, 'Media'], [4, 'Baja']]);
    check('bigText', 'Texto más grande');
    check('noFlash', 'Reducir destellos (rayos de las tormentas)');
  }
  build();
  $('st-close').onclick = () => onClose();
  return { refresh: build };
}

// Poner o quitar la pantalla completa (lo que se ve es toda la página: el juego y su interfaz)
export async function toggleFullscreen(want = !document.fullscreenElement) {
  try {
    if (want && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      await navigator.keyboard?.lock?.(['Escape']).catch(() => {});
    } else if (!want && document.fullscreenElement) {
      navigator.keyboard?.unlock?.();
      await document.exitFullscreen();
    }
  } catch { /* (el navegador no lo deja) */ }
}
