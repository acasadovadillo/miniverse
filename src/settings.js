// Ajustes del jugador (de este dispositivo): volúmenes, tamaño de los píxeles, texto grande,
// reducir destellos y la ayuda de teclas. Se guardan en el navegador; si no se puede, se usan los de siempre.
import { Audio } from './audio.js';
import { Music } from './music.js';

const KEY = 'pueblo-brotes:ajustes';
export const Settings = {
  v: { master: 0.7, music: 0.5, sfx: 1, scale: 'auto', bigText: false, noFlash: false, musicOn: true },
  load() {
    try { Object.assign(this.v, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ajustes por defecto */ }
    this.apply();
  },
  set(k, val) {
    this.v[k] = val;
    try { localStorage.setItem(KEY, JSON.stringify(this.v)); } catch { /* no pasa nada */ }
    this.apply();
  },
  apply() {
    const v = this.v;
    Audio.setVolumes({ master: v.master, music: v.musicOn ? v.music : 0, sfx: v.sfx });
    Music.enabled = v.musicOn;
    document.body.classList.toggle('big-text', v.bigText);
    this.onApply?.();
  },
};
