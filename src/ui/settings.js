// Pantalla de ajustes
import { Settings } from '../settings.js';

const $ = id => document.getElementById(id);

export function initSettingsUI({ onClose }) {
  const box = $('st-body');
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
  slider('master', 'Volumen general');
  check('musicOn', 'Música');
  slider('music', 'Volumen de la música');
  slider('sfx', 'Volumen de los efectos');
  choice('scale', 'Tamaño de los píxeles', [['auto', 'Auto'], [1, '1×'], [2, '2×'], [3, '3×'], [4, '4×']]);
  check('bigText', 'Texto más grande');
  check('noFlash', 'Reducir destellos (rayos de las tormentas)');
  $('st-close').onclick = () => onClose();
  return {};
}
