// How a game look picks MakeHuman's parts in the new creator (plan CR, P1): hair, brows and lashes from MakeHuman's CC0
// system assets, and provisional clothes, until P3 and P4 make our own. Only the creator's preview reads this
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
// The provisional clothes: a shirt and trousers, or a blouse and a skirt; boots for everybody
export const clothesOf = look => [look.sex === 'chico' || look.outfit === 'chaleco' || look.outfit === 'tunica' ? 'male_casualsuit03' : 'female_elegantsuit01', 'shoes03'];
