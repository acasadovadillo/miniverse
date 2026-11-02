// Aspecto de las personas ("look"): opciones del creador de personaje y valores por defecto. Las partidas y
// los vecinos de antes no tienen los rasgos que se añadieron después (ojos, cejas, nariz, orejas, barba y
// mofletes): fullLook los completa a partir de lo que sí tienen.
export const LOOK_OPTIONS = {
  sex: [['chico', 'Chico'], ['chica', 'Chica']],
  hairStyle: [['corto', 'Corto'], ['largo', 'Largo'], ['coleta', 'Coleta'], ['rizado', 'Rizado'], ['mono', 'Moño'], ['rapado', 'Rapado'], ['calvo', 'Calvo'], ['pinchos', 'Pinchos'],
    ['melena', 'Melena'], ['coletas', 'Dos coletas'], ['trenza', 'Trenza'], ['cresta', 'Cresta'], ['tupe', 'Tupé'],
    ['afro', 'Afro'], ['rastas', 'Rastas'], ['coletaAlta', 'Coleta alta'], ['monos', 'Dos moños'], ['trenzas', 'Dos trenzas'],
    ['ondas', 'Ondas largas'], ['flequillo', 'Flequillo de lado'], ['mullet', 'Mullet'], ['tazon', 'Tazón'], ['samurai', 'Samurái']],
  hair: ['#2a1e1e', '#4a2c1c', '#7a4a2a', '#a8442a', '#d8742a', '#e8c060', '#f0e6c8', '#a8a4ac', '#e86aa0', '#4a7ae8', '#3aa86a', '#8a4ac8'],
  skin: ['#ffe0c4', '#f6c9a0', '#e8b07a', '#c98a5a', '#a86a42', '#8a5234', '#6a3c26', '#4a2a1c', '#9ec67a', '#a8b8e8'],
  eyeStyle: [['redondos', 'Redondos'], ['almendrados', 'Almendrados'], ['pestanas', 'Con pestañas'], ['entornados', 'Entornados'], ['pequenos', 'Pequeños']],
  eyes: ['#3a2a1e', '#7a4a24', '#c8902a', '#3a8a4a', '#2a6a6a', '#3a6ab8', '#7ab4e8', '#7a7a8a', '#8a4ac8', '#c83a4a'],
  brows: [['finas', 'Finas'], ['rectas', 'Rectas'], ['gruesas', 'Gruesas'], ['arqueadas', 'Arqueadas'], ['pobladas', 'Pobladas']],
  nose: [['boton', 'De botón'], ['respingona', 'Respingona'], ['larga', 'Larga'], ['ancha', 'Ancha'], ['puntiaguda', 'Puntiaguda']],
  ears: [['redondas', 'Redondas'], ['pequenas', 'Pequeñas'], ['grandes', 'Grandes'], ['elfo', 'De elfo'], ['soplillo', 'De soplillo']],
  beard: [['no', 'Sin barba'], ['bigote', 'Bigote'], ['perilla', 'Perilla'], ['candado', 'Candado'], ['completa', 'Completa'], ['larga', 'Larga']],
  cheeks: [[true, 'Con mofletes'], [false, 'Sin mofletes']],
  outfit: [['delantal', 'Camisa y delantal'], ['tunica', 'Túnica con cinturón'], ['chaleco', 'Camisa y chaleco'], ['larga', 'Túnica larga']],
  cloth: ['#c83a3a', '#d8742a', '#e8c050', '#4a9a4a', '#2e8a8a', '#3a5ab8', '#6a4ab8', '#b84a8a', '#6a4a2e', '#4a4a5a', '#e8e0d0'],
};
export const DEFAULT_LOOK = {
  sex: 'chica', hairStyle: 'coleta', hair: '#a8442a', skin: '#e8b07a', outfit: 'delantal', cloth: '#3a5ab8', pants: '#4a3a2a',
  eyes: '#3a8a4a', eyeStyle: 'pestanas', brows: 'finas', nose: 'boton', ears: 'redondas', beard: 'no', cheeks: true,
};

// La ropa de un look (el tipo de ropa y sus colores, como lo elige el creador): con la que empieza el jugador
// y la que llevan los vecinos. bag: con mochila. Devuelve los huecos del cuerpo → { id, color }.
const darken = (hex, k) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
export function clothesFor(look, bag = false) {
  const L = fullLook(look), girl = L.sex === 'chica', cloth = L.cloth || '#3a5ab8', e = {};
  e.interiorAbajo = girl ? { id: 'bragas', color: '#f4d8e2' } : { id: 'calzoncillos', color: '#f2efe8' };
  if (girl) e.interiorArriba = { id: 'camiseta_interior', color: '#f2efe8' };
  if (L.outfit === 'tunica') e.torso = { id: 'tunica', color: cloth };
  else if (L.outfit === 'larga') e.torso = { id: 'tunica_larga', color: cloth };
  else {
    e.torso = { id: 'camisa', color: cloth };
    e.encima = L.outfit === 'delantal' ? { id: 'delantal', color: '#efe6d4' } : { id: 'chaleco', color: darken(cloth, 0.6) };
  }
  if (L.outfit !== 'larga') e.piernas = { id: 'pantalon', color: L.pants || '#4a3a2a' };
  e.calcetines = { id: 'calcetines', color: '#ece6da' };
  e.pies = { id: 'botas', color: '#5a3a24' };
  if (bag) e.espalda = { id: 'mochila', color: '#8a5a34' };
  return e;
}
// El look con la ropa que se lleva puesta (es lo que dibuja el muñeco)
export const dressed = (look, equip) => ({ ...look, wear: Object.fromEntries(Object.entries(equip).map(([k, v]) => [k, { id: v.id, color: v.color }])) });

// Un look con todos sus rasgos (lo que falta se deduce: las chicas de antes tenían pestañas; los chicos, cejas rectas)
export function fullLook(L) {
  const girl = L.sex === 'chica';
  return {
    ...L,
    eyes: L.eyes || '#3a2a1e',
    eyeStyle: L.eyeStyle || (girl ? 'pestanas' : 'redondos'),
    brows: L.brows || (girl ? 'finas' : 'rectas'),
    nose: L.nose || 'boton',
    ears: L.ears || 'redondas',
    beard: typeof L.beard === 'string' ? L.beard : L.beard ? 'completa' : 'no',
    cheeks: L.cheeks ?? true,
  };
}
