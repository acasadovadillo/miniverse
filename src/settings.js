// Ajustes del jugador (de este dispositivo): volúmenes, tamaño de los píxeles, texto grande,
// reducir destellos, cómo se monta a caballo (ride: 'realistic' o 'arcade', game.js), la interfaz (hud: 'minimal' o 'full'; main.js la cambia en caliente), su aspecto (skin: 'glass' o
// 'wood', ui/skin.js), los sonidos de los menús (menuSfx), su movimiento (motion: 'full' o 'reduced') y la ayuda de teclas. Se
// guardan en el navegador; si no se puede, se usan los de siempre.
// Los volúmenes van además en la partida de cada cuenta: al entrar con tu cuenta se usan los tuyos, en
// cualquier ordenador.
// musicMode (Plan J §3.6): 'dynamic' (the score follows what happens: ride, danger, stingers) or 'calm' (moods still
// change, never ride, tense or stingers). It travels with the volumes in the save (a save without it keeps
// this device's, 'dynamic' by default); an unknown value reads 'dynamic'.
// Music reads it as Music.calm, set in apply() (music.js cannot import this file: it would be a cycle)
import { Audio } from './audio.js';
import { Music } from './music.js';
import { useLangSetting } from './i18n.js';
import { applySkin } from './ui/skin.js';

const KEY = 'pueblo-brotes:ajustes';
const VOLUMES = ['master', 'music', 'sfx', 'musicOn', 'musicMode'];
export const MUSIC_MODES = ['dynamic', 'calm'];
export const Settings = {
  v: { master: 0.7, music: 0.5, sfx: 1, scale: 'auto', bigText: false, noFlash: false, musicOn: true, musicMode: 'dynamic', hud: 'minimal', skin: 'glass', menuSfx: true, motion: 'full', ride: 'realistic' },
  load() {
    try { Object.assign(this.v, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ajustes por defecto */ }
    this.apply();
  },
  set(k, val) {
    this.v[k] = val;
    this.store();
    this.apply();
    if (VOLUMES.includes(k)) this.onVolume?.();
    if (k === 'hud') this.onHud?.(val);   // (the interface, swapped while playing: main.js)
  },
  // The music mode in use: anything but 'calm' (an old save, a hand-edited value) is 'dynamic'
  get musicMode() { return this.v.musicMode === 'calm' ? 'calm' : 'dynamic'; },
  // The language: 'auto', 'en' or 'es' (i18n.js reads it at startup; here it is saved and switched without reloading)
  setLang(v) { this.set('lang', v); return useLangSetting(v); },
  store() { try { localStorage.setItem(KEY, JSON.stringify(this.v)); } catch { /* no pasa nada */ } },
  // Los volúmenes, para guardarlos en la partida, y ponerlos desde ella
  volumes() { return Object.fromEntries(VOLUMES.map(k => [k, k === 'musicMode' ? this.musicMode : this.v[k]])); },
  useVolumes(v) {
    if (!v) return;
    for (const k of VOLUMES) if (k in v && (k !== 'musicMode' || MUSIC_MODES.includes(v[k]))) this.v[k] = v[k];   // (a save without musicMode keeps this device's)
    this.store();
    this.apply();
  },
  apply() {
    const v = this.v;
    Audio.setVolumes({ master: v.master, music: v.musicOn ? v.music : 0, sfx: v.sfx });
    Music.enabled = v.musicOn;
    Music.calm = this.musicMode === 'calm';
    Audio.menuSounds = v.menuSfx !== false;
    document.body.classList.toggle('big-text', v.bigText);
    document.body.classList.toggle('still-menus', v.motion === 'reduced');
    applySkin(v.skin);   // (dark glass, or the wood of before: ui/skin.js)
    this.onApply?.();
  },
};
