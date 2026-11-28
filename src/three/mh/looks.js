// How a game look picks the parts of the new creator's person (plan CR): hair, brows and lashes from MakeHuman's CC0
// system assets (until P4 makes our own), and the medieval clothes of P3 (tools/mh_garments.py). Only the creator reads this
import { clothesFor, fullLook } from '../../looks.js';
const HAIR = {
  corto: 'short02', largo: 'long01', coleta: 'ponytail01', rizado: 'afro01', mono: 'bob01', rapado: 'short04', calvo: null,
  pinchos: 'short01', melena: 'bob02', coletas: 'ponytail01', trenza: 'braid01', cresta: 'short04', tupe: 'short03',
  afro: 'afro01', rastas: 'afro01', coletaAlta: 'ponytail01', monos: 'bob01', trenzas: 'braid01', ondas: 'long01',
  flequillo: 'bob01', mullet: 'short03', tazon: 'bob02', samurai: 'ponytail01', panuelo: null,
};
const BROWS = { finas: 'eyebrow010', rectas: 'eyebrow004', gruesas: 'eyebrow001', arqueadas: 'eyebrow002', pobladas: 'eyebrow009' };
export const hairOf = look => (look.hairStyle in HAIR ? HAIR[look.hairStyle] : 'short02');
export const browsOf = look => BROWS[look.brows] || (look.sex === 'chico' ? 'eyebrow004' : 'eyebrow010');
export const lashesOf = look => (look.sex === 'chico' ? 'eyelashes01' : 'eyelashes02');
// The clothes a look wears, as garments to dress: { name, colour, colour2, tear (0, 1 worn, 2 torn), leather }, from the
// worn slots (look.wear, as the game builds it) or, for a look being made, the creator's outfit (looks.js clothesFor).
// Order is inside out: each garment sits over the ones before
const shade = (hex, k) => '#' + [1, 3, 5].map(i => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k))).toString(16).padStart(2, '0')).join('');
export function garmentsOf(look) {
  const W = look.wear || clothesFor(fullLook(look)), out = [];
  const put = (name, it, o = {}) => { const c = it?.color || o.colour || '#8a7a6a'; out.push({ name, colour: c, colour2: o.colour2 || shade(c, 0.72), tear: it?.r || 0, leather: !!o.leather, fleece: !!o.fleece }); };
  const torso = W.torso?.id, top = W.encima?.id, legs = W.piernas?.id, outer = W.outer?.id, feet = W.pies?.id;
  // (under a tunic, only the trousers' legs: their seat is hidden and would cross the skirt. A coat is closed down to the knee
  // but parts as one walks: the whole trousers)
  const covered = torso === 'tunica' || torso === 'tunica_larga';
  if (legs === 'pantalon' || legs?.startsWith('grebas_')) put(covered ? 'calzas' : 'pantalon', W.piernas);
  if (feet) put('botas', W.pies, { leather: true, colour2: '#2e2018' });
  if (torso === 'tunica' || torso === 'tunica_larga') { put(torso, W.torso); put('cinturon', null, { colour: '#4a3020', colour2: '#b8964a', leather: true }); }
  else if (torso) put('camisa', W.torso);
  else if (W.interiorArriba) put('camisa', W.interiorArriba);
  if (top === 'chaleco') put('chaleco', W.encima);
  else if (top === 'delantal' || top === 'leather_apron') put('delantal', W.encima, { leather: top === 'leather_apron' });
  if (outer === 'sheepskin_jacket') put('zamarra', W.outer, { leather: true, fleece: true, colour2: '#d9cbae' });
  else if (outer) put('abrigo', W.outer);
  return out;
}
