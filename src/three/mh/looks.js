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
// The clothes a look wears, as garments to dress: { name, colour, colour2, tear (0, 1 worn, 2 torn), leather, fleece, from }, from
// the worn slots (look.wear, as the game builds it) or, for a look being made, the creator's outfit (looks.js clothesFor).
// Order is inside out: each garment sits over the ones before. from: metres down from its top where it starts to be drawn
// (a skirt under a tunic: only below the tunic's hem); upto: metres down where it stops (socks in boots)
const shade = (hex, k) => '#' + [1, 3, 5].map(i => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k))).toString(16).padStart(2, '0')).join('');
const FLEECE = '#d9cbae', WOLF = '#8c8276';
// (the tunic's hem, measured down the skirt from its waistband on MakeHuman's base body: tools/mh_garments.py)
const SKIRT_UNDER_TUNIC = 0.32;
// (the socks' cloth goes down from the top of the body: down to 4 cm into a boot, and a lined one's, metres)
const SOCKS_IN = [0.565, 0.54];
export function garmentsOf(look) {
  const W = look.wear || clothesFor(fullLook(look)), out = [];
  const put = (name, it, o = {}) => { const c = it?.color || o.colour || '#8a7a6a'; out.push({ name, colour: c, colour2: o.colour2 || shade(c, 0.72), tear: it?.r || 0, leather: !!o.leather, fleece: !!o.fleece, from: o.from || 0, upto: o.upto || 0 }); };
  const torso = W.torso?.id, top = W.encima?.id, legs = W.piernas?.id, outer = W.outer?.id, feet = W.pies?.id, socks = W.calcetines?.id;
  // (under a tunic, only the trousers' legs: their seat is hidden and would cross the skirt. A coat is closed down to the knee
  // but parts as one walks: the whole trousers)
  const tunic = torso === 'tunica' || torso === 'tunica_larga', long = torso === 'tunica_larga', coat = outer === 'wool_coat' || outer === 'wolf_lined_coat';
  const trousers = legs === 'pantalon' || !!legs?.startsWith('grebas_');
  // (what is not seen is not drawn: the underwear under trousers, a skirt, a tunic or a coat, the socks in boots under trousers)
  if (W.interiorAbajo && !legs && !tunic && !coat) put(W.interiorAbajo.id === 'bragas' ? 'bragas' : 'calzoncillos', W.interiorAbajo);
  // (in boots, only what shows over them: the foot inside would poke through the boot)
  if (socks && (!feet || (!trousers && !long))) put(socks === 'wool_socks' ? 'medias' : 'calcetines', W.calcetines, { upto: feet ? SOCKS_IN[feet === 'lined_boots' ? 1 : 0] : 0 });
  if (trousers) put(tunic ? 'calzas' : 'pantalon', W.piernas);
  if (feet === 'lined_boots') put('botas_forro', W.pies, { leather: true, fleece: true, colour2: FLEECE });
  else if (feet) put('botas', W.pies, { leather: true, colour2: '#2e2018' });
  // (the headscarf goes under a collar: tucked in)
  if (W.cabeza?.id === 'hijab') put('hijab', W.cabeza);
  if (tunic) { put(torso, W.torso); put('cinturon', null, { colour: '#4a3020', colour2: '#b8964a', leather: true }); }
  else if (torso === 'linen_shirt') put('camisa_corta', W.torso);
  else if (torso) put('camisa', W.torso);
  else if (W.interiorArriba) put('camiseta', W.interiorArriba);
  // (a skirt over the shirt, tucked in; under a tunic only what shows below it; a coat or a long tunic hides it all)
  if (legs === 'falda' && !long && !coat) {
    if (torso === 'tunica') out.splice(out.findIndex(g => g.name === 'tunica'), 0, { ...skirt(W.piernas), from: SKIRT_UNDER_TUNIC });
    else put('falda', W.piernas);
  }
  if (top === 'chaleco') put('chaleco', W.encima);
  else if (top === 'delantal' || top === 'leather_apron') put('delantal', W.encima, { leather: top === 'leather_apron' });
  if (outer === 'sheepskin_jacket') put('zamarra', W.outer, { leather: true, fleece: true, colour2: '#d9cbae' });
  else if (outer === 'wolf_lined_coat') { put('abrigo', W.outer, { fleece: true, colour2: WOLF }); put('cuello_lobo', null, { colour: WOLF, colour2: WOLF, fleece: true }); }
  else if (outer) put('abrigo', W.outer);
  return out;
  function skirt(it) { const c = it?.color || '#8a7a6a'; return { name: 'falda', colour: c, colour2: shade(c, 0.72), tear: it?.r || 0, leather: false, fleece: false }; }
}
