// Who wears a MakeHuman body in the game (plan CR P5, ?creador=nuevo), and which: a player with the new creator's look
// (look.mh); the named neighbours and Nilo with a head and a body chosen for each (Bruno strong, Paco and Eusebio old…);
// the hamlet folk and the travellers with a head of their sex and origin and a body from their look, always the same for
// the same look. Their colours and clothes stay as they are. Children and babies keep today's person. No Three here: the
// tables only
import { presetOf, presetsFor, fromPreset } from './presets.js';
import { SKIN_TONES, nearestTone } from './skin.js';
import { opcion } from '../../opciones.js';

export const MH_ON = opcion('creador') === 'nuevo';

// The neighbours, told by the look they have (neighbors.js, world/scenes.js NILO_LOOK): sex, skin, hair, hairstyle,
// outfit. A neighbour whose look changes there falls to the general rule below, still stable
const NAMED = {
  'chica|#f6c9a0|#4a2c1c|mono|delantal': ['ca_f4', { age: 45, weight: 30, height: -20, chest: 20 }],         // Rosa
  'chica|#e8b07a|#e8c060|largo|chaleco': ['ca_f2', { age: 0, weight: -15, height: -10, chest: -10 }],        // Lía
  'chico|#8a5234|#2a1e1e|rapado|delantal': ['af_m1', { age: 25, muscle: 70, weight: 30, height: 10, chest: 40 }],   // Bruno, the smith
  'chico|#c98a5a|#e86aa0|rizado|larga': ['ca_m7', { age: 5, weight: -10, muscle: 10, as: 30 }],             // Dani
  'chico|#e8b07a|#7a4a2a|calvo|delantal': ['ca_m3', { age: 50, weight: 70, height: 0, chest: 30 }],          // Anselmo, the innkeeper
  'chico|#f6c9a0|#a8a4ac|corto|chaleco': ['ca_m5', { age: 75, weight: -10, height: -20, muscle: -20 }],      // Eusebio, the barber
  'chica|#a86a42|#2a1e1e|trenza|tunica': ['af_f2', { age: 15, weight: -20, height: 10 }],                     // Inés
  'chica|#ffe0c4|#a8442a|melena|tunica': ['ca_f6', { age: 35, weight: 10, chest: 10 }],                       // Marta, the tailor
  'chico|#c98a5a|#2a1e1e|rizado|tunica': ['ca_m4', { age: 65, weight: 20, muscle: 20, height: -10 }],        // Paco, older
  'chico|#d9a074|#4a4038|corto|larga': ['ca_m1', { age: 40, muscle: 40, weight: 15, height: 25 }],           // Ramiro, the constable
  'chico|#8a5234|#c8c4cc|corto|tunica': ['af_m5', { age: 80, weight: -10, height: -10, muscle: -30 }],       // Nilo, the elder
};
const keyOf = L => [L.sex, L.skin, L.hair, L.hairStyle, L.outfit].join('|');
const hash = s => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const GREY = new Set(['#a8a4ac', '#c8c4cc', '#8a8480']);

// The MakeHuman part of a look, whole (head's face, origin, body), or null for today's person. folk: not a player (a
// neighbour, a villager, a traveller), who gets one even without look.mh
export function mhOfLook(look, folk = false) {
  if (!MH_ON || !look) return null;
  const mh = look.mh;
  if (mh && typeof mh === 'object') {
    const p = presetOf(mh.preset);
    // (a look saved by the creator carries its face; one that names only a head takes the head's)
    return mh.face ? mh : { ...mh, face: { ...(p?.face || {}) }, macro: { ...(p ? fromPreset(p).macro : {}), ...(mh.macro || {}) } };
  }
  if (!folk) return null;
  const named = NAMED[keyOf(look)];
  if (named) { const p = presetOf(named[0]), base = fromPreset(p); return { ...base, macro: { ...base.macro, ...named[1] } }; }
  // Anyone else: the origin from the skin (the darkest, African; the middle ones, Asian or Caucasian), a head of the sex and
  // origin, older with grey hair, and a body within ordinary ranges
  const h = hash(keyOf(look) + '|' + (look.cloth || '') + '|' + (look.pants || '') + '|' + (look.beard || '')), r = k => ((h >>> (k * 3)) % 97) / 96;
  const tone = SKIN_TONES.indexOf(nearestTone(look.skin || '#c99c76')), o = tone >= 10 ? 'af' : tone >= 5 ? (r(0) < 0.5 ? 'as' : 'ca') : 'ca';
  const sex = look.sex === 'chico' ? 'chico' : 'chica', all = presetsFor(sex).filter(p => p.o === o), p = all[Math.floor(r(1) * all.length) % all.length];
  const base = fromPreset(p), old = GREY.has(look.hair), span = (k, a) => Math.round(((r(k) * 2 - 1) * a) / 5) * 5;
  return { ...base, macro: { ...base.macro, age: old ? 55 + Math.round(r(2) * 35) : Math.round(r(2) * 45), height: span(3, 40), weight: span(4, 35), muscle: span(5, 35), chest: span(6, 30), prop: span(7, 25) } };
}
