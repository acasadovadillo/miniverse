// Ajustes del jugador (de este dispositivo): volúmenes, tamaño de los píxeles, texto grande,
// reducir destellos y la ayuda de teclas. Se guardan en el navegador; si no se puede, se usan los de siempre.
// Los volúmenes van además en la partida de cada cuenta: al entrar con tu cuenta se usan los tuyos, en
// cualquier ordenador.
import { Audio } from './audio.js';
import { Music } from './music.js';

const KEY = 'pueblo-brotes:ajustes';
const VOLUMES = ['master', 'music', 'sfx', 'musicOn'];
export const Settings = {
  v: { master: 0.7, music: 0.5, sfx: 1, scale: 'auto', bigText: false, noFlash: false, musicOn: true },
  load() {
    try { Object.assign(this.v, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ajustes por defecto */ }
    this.apply();
  },
  set(k, val) {
    this.v[k] = val;
    this.store();
    this.apply();
    if (VOLUMES.includes(k)) this.onVolume?.();
  },
  store() { try { localStorage.setItem(KEY, JSON.stringify(this.v)); } catch { /* no pasa nada */ } },
  // Los volúmenes, para guardarlos en la partida, y ponerlos desde ella
  volumes() { return Object.fromEntries(VOLUMES.map(k => [k, this.v[k]])); },
  useVolumes(v) {
    if (!v) return;
    for (const k of VOLUMES) if (k in v) this.v[k] = v[k];
    this.store();
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
