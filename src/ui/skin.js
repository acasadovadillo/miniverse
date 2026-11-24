// The look of the interface (docs/planes/realismo/PLAN-R8-hud-mapa.md §3.1): dark glass, the rules of <style id="ui-glass">
// in index.html, or, for one version, the wood of before (?ui=madera, or Settings › Look; ?ui=cristal forces the glass).
// The wood is the rules under the glass: turning that sheet off brings it back whole.
// And the player's own colour (PLAN-R9-menus.md §3.8): eight original accents; the save's (ui.accent) or, without one, a
// steady pick by the name, so two players look different from the first day. It sets --me, which --accent reads
import { opcion } from '../opciones.js';

export const ACCENTS = ['#ff4f9a', '#ffb24a', '#37c9c3', '#ff6f61', '#9b7bff', '#a6d84a', '#4aa8ff', '#e0c08a'];   // pink, amber, teal, coral, violet, lime, sky, sand

// The look in use: 'glass' or 'wood' (the address decides over the setting)
export function skinNow(setting) {
  const q = opcion('ui');
  return q === 'madera' ? 'wood' : q === 'cristal' ? 'glass' : setting === 'wood' ? 'wood' : 'glass';
}
export function applySkin(setting) {
  const wood = skinNow(setting) === 'wood', sheet = document.getElementById('ui-glass');
  if (sheet) sheet.media = wood ? 'not all' : 'all';
  document.body.classList.toggle('ui-wood', wood);
}

export function accentOf(name, saved) {
  if (Number.isInteger(saved) && saved >= 0 && saved < ACCENTS.length) return saved;
  let h = 2166136261;
  for (const c of String(name || '').trim().toLowerCase()) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return ((h >>> 16) ^ (h & 0xffff)) % ACCENTS.length;
}
// The colour of the character of this save (null: none yet, the default pink). accent.color: the one in use, for what is drawn on a
// canvas or in the world (the marked route, the minimap); accent.v goes up when it changes
export const accent = { color: ACCENTS[0], v: 0 };
export function useAccent(save) {
  const root = document.documentElement.style, mine = save?.player ? ACCENTS[accentOf(save.player.name, save.ui?.accent)] : null;
  if (mine) root.setProperty('--me', mine); else root.removeProperty('--me');
  if ((mine || ACCENTS[0]) !== accent.color) { accent.color = mine || ACCENTS[0]; accent.v++; }
}
