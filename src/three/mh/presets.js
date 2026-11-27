import { SKIN_TONES, nearestTone } from './skin.js';

// The starting heads of the new creator (plan CR, P2): eight per origin and sex, like Baldur's Gate 3's, each sculpted by
// hand with the face sliders (2026-11-27, at the creator's doubled range: 50 is MakeHuman's whole target) on top of its
// origin, each with a character of its own and an age (macro age, 0..100 = 25..90 years). Their names are in src/lang
// (mh.preset.<id>). The fine sliders then start from the chosen head.
const H = (id, age, face) => ({ id, sex: id[3] === 'f' ? 'chica' : 'chico', o: id.slice(0, 2), age, face });
export const PRESETS = [
  // Caucasian women: Elvira, Clara, Inés, Leonor, Brígida, Sabina, Urraca, Jimena
  H('ca_f1', 15, { head_height: 25, cheek_bones: 25, cheek_volume: -15, nose_width: -25, nose_hump: 25, nose_length: 15, eye_tilt: 30, eye_open: -10, lip_upper: -20, lip_lower: -10, jaw_width: -15, chin_height: 15 }),
  H('ca_f2', 0, { head_shape: -35, cheek_volume: 35, eye_size: 35, eye_open: 20, nose_length: -30, nose_tip: 40, nose_width: -10, chin_height: -20, chin_width: -15, lip_lower: 25, mouth_width: -15 }),
  H('ca_f3', 30, { jaw_width: 30, head_shape: 30, brow_ridge: 30, eye_fold: 35, eye_size: -15, nose_length: 30, nose_projection: 25, mouth_corners: -25, lip_upper: -25, cheek_volume: -30, chin_forward: 20 }),
  H('ca_f4', 55, { head_width: 25, head_fat: 25, cheek_volume: 25, nose_width: 30, nose_nostrils: 20, mouth_width: 25, eye_bags: 40, brow_height: -15, jaw_width: 20, neck_width: 30 }),
  H('ca_f5', 85, { nose_hump: 50, nose_tip: -40, nose_length: 35, lip_upper: -40, lip_lower: -30, eye_fold: 40, eye_size: -20, chin_forward: 35, chin_width: -25, ear_size: 40, cheek_volume: -35, cheek_bones: 25 }),
  H('ca_f6', 10, { eye_spacing: 30, eye_size: 15, nose_length: -20, nose_bridge: -25, nose_tip: 20, mouth_width: 30, mouth_corners: 25, cupid_bow: 30, jaw_width: 15, forehead_height: 20 }),
  H('ca_f7', 40, { forehead_height: 40, head_width: -25, nose_hump: 35, nose_projection: 30, brow_height: 30, brow_angle: 30, lip_upper: -30, lip_lower: -20, chin_forward: 30, cheek_bones: 30, cheek_volume: -30 }),
  H('ca_f8', 20, { cheek_bones: 35, cheek_height: 20, eye_fold: 25, nose_width: 20, nose_bridge: 20, lip_upper: 25, lip_lower: 30, chin_width: 20, chin_height: 15, jaw_width: 20, eye_tilt: -15 }),
  // Caucasian men: Rodrigo, Álvaro, Mateo, Gonzalo, Tomás, Íñigo, Fermín, Bernardo
  H('ca_m1', 25, { jaw_width: 40, head_shape: 35, brow_ridge: 35, eye_fold: 30, chin_width: 25, chin_cleft: 40, nose_bridge: 15, cheek_volume: -25, cheek_bones: 20 }),
  H('ca_m2', 5, { head_width: -20, eye_size: 20, nose_width: -25, nose_length: 10, cheek_volume: -20, chin_height: 10, jaw_width: -20, mouth_width: -10, ear_out: 30 }),
  H('ca_m3', 45, { head_fat: 30, cheek_volume: 30, head_shape: -30, nose_width: 40, nose_nostrils: 30, eye_size: -25, neck_width: 45, jaw_width: 20, mouth_width: 15, eye_bags: 30 }),
  H('ca_m4', 35, { nose_hump: 60, nose_length: 40, nose_projection: 35, nose_tip: -30, head_height: 25, cheek_volume: -40, cheek_bones: 30, brow_ridge: 30, brow_height: -20, lip_upper: -20 }),
  H('ca_m5', 70, { eye_bags: 60, mouth_corners: -40, ear_size: 45, ear_lobe: 40, cheek_volume: -35, nose_length: 30, nose_tip: -25, eye_fold: 45, lip_upper: -30, lip_lower: -20 }),
  H('ca_m6', 15, { jaw_width: 50, neck_width: 50, nose_width: 40, nose_bridge: 35, nose_projection: -30, nose_hump: -20, brow_ridge: 28, eye_size: -20, ear_size: -20, head_width: 20, chin_forward: 20 }),
  H('ca_m7', 25, { nose_tip: 35, nose_width: 25, mouth_corners: 35, mouth_width: 25, cheek_volume: 30, cheek_height: 15, eye_tilt: -20, brow_angle: -20, ear_out: 35 }),
  H('ca_m8', 55, { forehead_height: 45, forehead_slope: -20, nose_length: 35, nose_width: -30, eye_open: -35, lip_upper: -35, lip_lower: -25, chin_height: 35, head_width: -20, cheek_volume: -30, brow_angle: 15 }),
  // African women: Amara, Nia, Zuri, Adaeze, Imani, Ayo, Kesi, Folami
  H('af_f1', 5, { head_shape: -30, eye_size: 30, lip_upper: 20, lip_lower: 25, nose_length: -20, nose_width: 15, cheek_volume: 25, chin_height: -15 }),
  H('af_f2', 20, { cheek_bones: 45, cheek_volume: -20, nose_width: -25, nose_bridge: 10, nose_length: 10, eye_tilt: 30, head_height: 20, jaw_width: -20, chin_height: 10, neck_width: -25 }),
  H('af_f3', 0, { forehead_height: 20, head_width: 15, chin_width: -35, jaw_width: -30, eye_size: 25, mouth_width: -20, lip_upper: 10, cheek_bones: 25 }),
  H('af_f4', 40, { jaw_width: 35, head_width: 25, nose_width: 35, nose_nostrils: 25, eye_fold: 35, eye_open: -20, lip_lower: 30, chin_width: 25, brow_ridge: 20 }),
  H('af_f5', 60, { head_fat: 25, cheek_volume: 25, eye_bags: 45, mouth_width: 30, mouth_corners: -15, neck_width: 35, nose_width: 20, eye_size: -15, ear_lobe: 30 }),
  H('af_f6', 12, { mouth_width: 35, mouth_corners: 35, cheek_volume: 30, cheek_height: 25, nose_tip: 30, eye_spacing: 30, lip_upper: 20, brow_height: 20 }),
  H('af_f7', 30, { head_height: 30, head_width: -20, nose_hump: 30, nose_width: -25, nose_length: 20, eye_fold: 30, jaw_width: 25, cheek_volume: -35, cheek_bones: 30, chin_forward: 20 }),
  H('af_f8', 90, { lip_upper: -25, lip_lower: -15, cheek_volume: -40, cheek_bones: 30, ear_size: 40, mouth_corners: -35, eye_bags: 50, eye_fold: 40, nose_tip: -25 }),
  // African men: Kofi, Jabari, Tunde, Obi, Kwame, Sefu, Ade, Malik
  H('af_m1', 15, { jaw_width: 40, head_shape: 30, nose_width: 30, lip_upper: 20, lip_lower: 25, brow_ridge: 25, chin_width: 20 }),
  H('af_m2', 5, { cheek_bones: 40, cheek_volume: -30, nose_width: -25, head_height: 25, jaw_width: -10, chin_height: 20, eye_tilt: 15, ear_out: 20 }),
  H('af_m3', 45, { head_fat: 30, cheek_volume: 28, head_shape: -30, mouth_width: 30, mouth_corners: 30, neck_width: 45, nose_width: 30, eye_size: -20 }),
  H('af_m4', 30, { brow_ridge: 25, brow_height: -15, eye_fold: 35, nose_projection: -25, nose_width: 40, mouth_corners: -30, chin_forward: 30, jaw_width: 30 }),
  H('af_m5', 75, { ear_size: 45, ear_lobe: 40, eye_bags: 55, cheek_volume: -35, nose_length: 30, nose_tip: -25, lip_upper: -25, mouth_corners: -25, head_width: -15 }),
  H('af_m6', 20, { cheek_bones: 30, eye_tilt: 25, nose_bridge: 15, nose_projection: 15, chin_cleft: 40, chin_height: 15, jaw_width: 20, lip_upper: 10 }),
  H('af_m7', 0, { eye_size: 30, head_shape: -25, nose_length: -25, chin_height: -20, cheek_volume: 20, ear_out: 40, mouth_width: -15 }),
  H('af_m8', 50, { nose_hump: 50, nose_length: 35, nose_projection: 30, nose_width: -15, eye_open: -30, head_height: 25, cheek_volume: -35, brow_ridge: 30, brow_angle: -20 }),
  // Asian women: Mei, Aiko, Yuna, Lan, Hana, Suyin, Min, Rin
  H('as_f1', 5, { head_shape: -20, nose_length: -20, nose_width: -10, lip_upper: 20, lip_lower: 20, eye_size: 15, cheek_volume: 20, chin_height: -10 }),
  H('as_f2', 15, { head_height: 25, cheek_bones: 35, cheek_volume: -20, nose_width: -25, nose_bridge: 20, eye_tilt: 35, eye_open: -10, jaw_width: -20, chin_height: 15 }),
  H('as_f3', 0, { head_shape: -35, eye_size: 30, eye_fold: -30, eye_open: 20, nose_length: -30, nose_tip: 30, mouth_width: -20, cheek_volume: 35 }),
  H('as_f4', 35, { head_shape: 35, jaw_width: 35, cheek_bones: 40, cheek_height: 20, nose_projection: -20, nose_width: 20, mouth_corners: -20, lip_upper: -15, brow_ridge: 15 }),
  H('as_f5', 60, { eye_bags: 50, lip_upper: -30, lip_lower: -20, cheek_volume: -35, ear_size: 35, ear_lobe: 40, mouth_corners: -30, eye_fold: 35, nose_tip: -20 }),
  H('as_f6', 20, { cheek_bones: 35, chin_width: -35, jaw_width: -30, brow_angle: 35, brow_height: 15, lip_lower: 30, eye_tilt: 20, forehead_height: 15 }),
  H('as_f7', 25, { cheek_volume: 30, head_fat: 15, mouth_width: 30, mouth_corners: 35, eye_size: -20, eye_open: -20, nose_width: 25, nose_tip: 20 }),
  H('as_f8', 40, { head_width: -25, jaw_width: 25, head_shape: 20, nose_width: -25, nose_bridge: 25, eye_open: -30, lip_upper: -25, cheek_volume: -35, chin_forward: 20 }),
  // Asian men: Kenji, Wei, Haruto, Jun, Tao, Hiro, Daisuke, Ren
  H('as_m1', 20, { jaw_width: 35, head_shape: 30, nose_bridge: 25, nose_projection: 20, eye_tilt: 20, eye_open: -15, brow_ridge: 25, chin_width: 20 }),
  H('as_m2', 5, { head_width: -20, cheek_volume: -15, ear_size: 30, ear_out: 35, nose_length: -15, eye_size: 15, chin_height: 10, jaw_width: -20 }),
  H('as_m3', 50, { head_fat: 30, head_width: 25, cheek_volume: 28, nose_width: 35, nose_projection: -25, eye_size: -25, neck_width: 45, eye_bags: 30 }),
  H('as_m4', 30, { head_height: 25, cheek_bones: 40, cheek_volume: -40, lip_upper: -30, nose_length: 30, nose_width: -20, eye_open: -25, chin_height: 20 }),
  H('as_m5', 80, { ear_size: 45, ear_lobe: 50, eye_bags: 55, mouth_corners: -35, cheek_volume: -30, lip_upper: -30, eye_fold: 45, nose_tip: -20, mouth_height: -20 }),
  H('as_m6', 15, { mouth_width: 30, mouth_corners: 30, nose_tip: 25, nose_width: 20, cheek_volume: 30, eye_spacing: 25, head_shape: -20 }),
  H('as_m7', 40, { brow_ridge: 25, brow_height: -15, brow_angle: -25, nose_width: 30, jaw_width: 40, mouth_corners: -30, chin_forward: 25, eye_fold: 30 }),
  H('as_m8', 0, { jaw_width: -30, chin_width: -30, eye_size: 30, nose_width: -25, forehead_height: 25, cheek_bones: 20, lip_upper: 10 }),
];
export const presetOf = id => PRESETS.find(p => p.id === id) || null;
export const presetsFor = sex => PRESETS.filter(p => p.sex === sex);

// A look's MakeHuman part from a head: its face and origin, the body kept (or the average one)
export function fromPreset(p, macro = {}) {
  return { preset: p.id, macro: { ...macro, age: p.age, af: p.o === 'af' ? 100 : 0, as: p.o === 'as' ? 100 : 0, ca: p.o === 'ca' ? 100 : 0 }, face: { ...p.face } };
}
// The first head of a sex: what a look without one starts from (the origin guessed from the skin: the darker, African)
export function defaultMh(look) {
  const all = presetsFor(look.sex === 'chico' ? 'chico' : 'chica'), o = SKIN_TONES.indexOf(nearestTone(look.skin || '')) >= 10 ? 'af' : 'ca';
  return fromPreset(all.find(p => p.o === o) || all[0]);
}
// The same head for the other sex (same origin and place in the list), when the sex changes
export function samePlace(id, sex) {
  const p = presetOf(id), all = presetsFor(sex);
  if (!p) return all[0];
  const mine = all.filter(x => x.o === p.o), k = presetsFor(p.sex).filter(x => x.o === p.o).indexOf(p);
  return mine[Math.max(0, k)] || all[0];
}

// A coherent random face: a head of the sex (and about its age), its origin sometimes mixed with another, a little noise on
// a few sliders, and a body within ordinary ranges. Skin, eyes and hair of colours that go with the origin
const TONES = { af: SKIN_TONES.slice(9), as: SKIN_TONES.slice(2, 9), ca: SKIN_TONES.slice(0, 8) };
const EYES = { af: ['#3a2a1e', '#7a4a24'], as: ['#3a2a1e', '#7a4a24'], ca: ['#3a2a1e', '#7a4a24', '#c8902a', '#3a8a4a', '#2a6a6a', '#3a6ab8', '#7ab4e8', '#7a7a8a'] };
const HAIR = { af: ['#2a1e1e', '#4a2c1c'], as: ['#2a1e1e', '#4a2c1c'], ca: ['#2a1e1e', '#4a2c1c', '#7a4a2a', '#a8442a', '#d8742a', '#e8c060', '#f0e6c8'] };
export function randomMh(look, rnd = Math.random) {
  const pick = a => a[Math.floor(rnd() * a.length)], all = presetsFor(look.sex === 'chico' ? 'chico' : 'chica'), p = pick(all);
  const mh = fromPreset(p), ids = Object.keys(p.face).concat(['eye_size', 'nose_width', 'mouth_width', 'jaw_width', 'cheek_volume']);
  for (let k = 0; k < 6; k++) {
    const id = pick(ids), v = (mh.face[id] || 0) + Math.round(((rnd() * 2 - 1) * 12) / 5) * 5;
    mh.face[id] = Math.max(-100, Math.min(100, v));
  }
  if (rnd() < 0.3) { const other = pick(['af', 'as', 'ca'].filter(o => o !== p.o)); mh.macro[other] = 20 + Math.round(rnd() * 6) * 5; }
  const body = (span, skew = 0) => Math.round(((rnd() * 2 - 1) * span + skew) / 5) * 5;
  Object.assign(mh.macro, { height: body(45), weight: body(30), muscle: body(30), age: Math.max(0, Math.min(100, p.age + body(10))), chest: body(40), prop: body(30) });
  return { mh, skin: pick(TONES[p.o]), eyes: pick(EYES[p.o]), hair: pick(HAIR[p.o]) };
}
