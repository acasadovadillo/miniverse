// Who wears a MakeHuman body in the game (plan CR P5; everyone's since P6, ?creador=viejo: nobody), and which: a player with the
// new creator's look (look.mh), or one of before with a head and a body from its look, like the folk below (game.js keeps that
// in look.mh the first time it loads, so a haircut does not change the face); the named neighbours and Nilo with a head and a body chosen for each (Bruno strong, Paco and Eusebio old…);
// the hamlet folk and the travellers with a head of their sex and origin and a body from their look, always the same for
// the same look; the family's children with a child's body and a face of their parents' (kidMhOf). Their colours and
// clothes stay as they are. No Three here: the tables only
import { presetOf, presetsFor, fromPreset } from './presets.js';
import { SKIN_TONES, nearestTone } from './skin.js';
import { CREADOR_NUEVO } from '../../opciones.js';
import { Profile } from '../../accounts.js';

export const MH_ON = CREADOR_NUEVO;

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

// The MakeHuman part of a look, whole (head's face, origin, body), or null for today's person (?creador=viejo, or the world
// server, which draws nobody up close). folk: not a player (a neighbour, a villager, a traveller). A look without look.mh gets
// one from its look either way: a player's of before too (another player still on an older version, or yours before game.js
// keeps it)
// (folk is kept for the callers: a player and the folk get one alike now)
// (kid: a child of the family, family.js: kidMhOf)
export function mhOfLook(look, folk = false, kid = false) {
  if (!MH_ON || !look || Profile.server) return null;
  return kid ? kidMhOf(look, kid === 'baby') : mhOf(look);
}
// (the same without the switch: the parents' heads at a birth, on the host or the world server too)
export function mhOf(look) {
  const mh = look.mh;
  if (mh && typeof mh === 'object') {
    const p = presetOf(mh.preset);
    // (a look saved by the creator carries its face; one that names only a head takes the head's)
    return mh.face ? mh : { ...mh, face: { ...(p?.face || {}) }, macro: { ...(p ? fromPreset(p).macro : {}), ...(mh.macro || {}) } };
  }
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

// ---- The children (the family's kids, family.js): MakeHuman's child shape (shape.js, mh.kid) with a face of their own
// What a child's face keeps of a grown-up one: the features softer (KID_K of each slider), what comes with age gone, and
// a child's own over them: bigger eyes, a small low nose, round cheeks, a small chin and jaw, a smooth brow
const KID_K = 0.45, AGED = new Set(['eye_bags', 'ear_size', 'ear_lobe', 'nose_hump', 'mouth_corners', 'brow_ridge', 'neck_width', 'head_fat']);
const KID_FACE = { eye_size: 10, eye_open: -8, mouth_width: 10, nose_length: -18, nose_width: -12, nose_bridge: -15, nose_tip: 15, cheek_volume: 18, chin_forward: 25, chin_height: -10, jaw_width: -25, chin_width: -10, brow_ridge: -30, forehead_height: 10, lip_upper: -10, lip_lower: -5 };
const clampS = v => Math.max(-100, Math.min(100, Math.round(v)));
function kidFace(face, r) {
  const out = {};
  for (const [k, v] of Object.entries(face || {})) if (Number.isFinite(v) && !AGED.has(k)) out[k] = v * KID_K;
  for (const [k, v] of Object.entries(KID_FACE)) out[k] = (out[k] || 0) + v;
  // (a little of its own: four sliders nudged, by the child's own numbers)
  const ids = Object.keys(out);
  for (let k = 0; k < 4; k++) { const id = ids[Math.floor(r(10 + k) * ids.length) % ids.length]; out[id] += (r(20 + k) * 2 - 1) * 10; }
  for (const k in out) { out[k] = clampS(out[k]); if (!out[k]) delete out[k]; }
  return out;
}
// (a child's body: only its weight and height, ordinary ranges)
const kidBody = (r, origin) => ({ ...origin, weight: Math.round(((r(4) * 2 - 1) * 40) / 5) * 5, height: Math.round(((r(3) * 2 - 1) * 60) / 5) * 5 });
const originOf = m => ({ af: Math.round(m?.af || 0), as: Math.round(m?.as || 0), ca: Math.round(m?.ca ?? (m?.af || m?.as ? 0 : 100)) });
// A newborn's, from its parents' looks (family.js, at the birth; kept in the child's look, so always the same child): the
// origins of both, half each; the face between theirs, nearer one or the other; then a child's (kidFace)
export function childMh(a, b, rnd = Math.random) {
  const A = mhOf(a || {}), B = mhOf(b || a || {}), r = () => rnd(), t = 0.25 + r() * 0.5, oa = originOf(A.macro), ob = originOf(B.macro);
  const face = {};
  for (const k of new Set([...Object.keys(A.face || {}), ...Object.keys(B.face || {})])) face[k] = (A.face?.[k] || 0) * (1 - t) + (B.face?.[k] || 0) * t;
  const n = Array.from({ length: 30 }, r), rr = k => n[k % 30];
  const origin = { af: Math.round((oa.af + ob.af) / 2), as: Math.round((oa.as + ob.as) / 2), ca: Math.round((oa.ca + ob.ca) / 2) };
  return { kid: 1, macro: kidBody(rr, origin), face: kidFace(face, rr) };
}
// A child's, whole: the one made at its birth (childMh), or for a child of before, from its look alone (as anyone's, mhOf),
// always the same for the same look
// (baby: the same child as a baby, mh.baby, its face rounder still: the child it will be)
export function kidMhOf(look, baby = false) {
  const mh = look.mh;
  let out;
  if (mh && typeof mh === 'object' && mh.kid) out = { kid: 1, macro: { ...(mh.macro || {}) }, face: { ...(mh.face || {}) } };
  else {
    const grown = mhOf({ ...look, mh: undefined, hair: GREY.has(look.hair) ? '#4a2c1c' : look.hair });
    const h = hash('kid|' + keyOf(look) + '|' + (look.cloth || '') + '|' + (look.eyes || '')), r = k => ((h >>> (k * 3)) % 97) / 96;
    out = { kid: 1, macro: kidBody(r, originOf(grown.macro)), face: kidFace(grown.face, r) };
  }
  if (baby) {
    out.baby = 1;
    for (const [k, v] of Object.entries(BABY_FACE)) out.face[k] = clampS((out.face[k] || 0) * 0.6 + v);
  }
  return out;
}
const BABY_FACE = { head_shape: -40, head_width: 12, cheek_volume: 30, cheek_bones: -25, eye_size: 15, nose_length: -30, nose_projection: -25, nose_bridge: -25, nose_tip: 20, mouth_width: -20, lip_upper: 10, chin_height: -25, chin_forward: -20, jaw_width: -25, forehead_height: 20, forehead_slope: 25, brow_ridge: -40 };

// What is saved: only the numbers that are not 0 (the look travels whole on the network: under 1 KB)
export function packMh(mh) {
  const clean = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => Number.isFinite(v) && v !== 0).map(([k, v]) => [k, Math.round(v)]));
  const out = { macro: clean(mh.macro), face: clean(mh.face) };
  if (mh.preset) out.preset = mh.preset;
  // (the skin's layers: their numbers that are not 0, and the colours and kinds of those that are on)
  const sk = Object.fromEntries(Object.entries(mh.skin || {}).filter(([, v]) => (typeof v === 'string' ? v && v !== 'none' : Number.isFinite(v) && v !== 0)).map(([k, v]) => [k, typeof v === 'string' ? v : Math.round(v)]));
  if (Object.keys(sk).some(k => k !== 'seed')) out.skin = sk;
  if (mh.eye2) out.eye2 = mh.eye2;
  // (the hair (P4): grey hairs when chosen (0 too: no grey at any age), highlights and their colour)
  if (Number.isFinite(mh.grey)) out.grey = Math.round(mh.grey);
  if (mh.hl > 0) { out.hl = Math.round(mh.hl); if (mh.hlC) out.hlC = mh.hlC; }
  return out;
}
