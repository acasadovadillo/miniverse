// Iconos de los objetos (16×16 con contorno) y sprites de recolección: tocón y tierra labrada.
import { mk, ramp, poly, line, ellipse, blob, outlined } from '../util.js';
import { ITEMS, TIERS, CROPS, FISH, BUGS } from '../items.js';

const cache = new Map();

const DRAW = {
  madera(R) {
    for (const [y, col] of [[9, '#8a5a30'], [4, '#9a6a3a']]) {
      R(2, y, 11, 5, col); R(2, y, 11, 1, '#b07a44'); R(2, y + 4, 11, 1, '#6a4422');
      R(12, y, 3, 5, '#e0b878'); R(13, y + 1, 1, 3, '#a87a44');
    }
  },
  piedra(R, g) { ellipse(g, 8, 10, 6, 4, '#7e7a72'); ellipse(g, 7, 9, 5, 3, '#9a968d'); R(5, 7, 3, 1, '#c0bcb2'); },
  fibra(R) { for (let i = 0; i < 5; i++) { R(4 + i * 2, 3 + (i % 2), 1, 11, i % 2 ? '#a8b860' : '#7a9a40'); } R(3, 8, 11, 2, '#c8a860'); },
  carbon(R, g) { blob(g, 6, 10, 3, '#2a2a30'); blob(g, 10, 8, 3, '#34343c'); blob(g, 9, 12, 2, '#222228'); R(5, 8, 2, 1, '#6a6a74'); R(9, 6, 2, 1, '#6a6a74'); },
  cobre(R, g) { ellipse(g, 8, 10, 6, 4, '#7e7a72'); ellipse(g, 7, 9, 5, 3, '#9a968d'); for (const [x, y] of [[5, 8], [9, 10], [11, 8], [7, 11]]) R(x, y, 2, 2, '#e08a4a'); },
  hierro(R, g) { ellipse(g, 8, 10, 6, 4, '#7e7a72'); ellipse(g, 7, 9, 5, 3, '#9a968d'); for (const [x, y] of [[5, 8], [9, 10], [11, 8], [7, 11]]) R(x, y, 2, 2, '#e0c4b0'); },
  bellota(R, g) { ellipse(g, 8, 10, 4, 4, '#c8964a'); R(6, 9, 2, 3, '#e0b46a'); ellipse(g, 8, 6, 5, 2, '#6a4a2a'); R(8, 2, 1, 3, '#4a3020'); },
  pina(R) { for (let y = 3; y < 14; y += 2) { const w = 8 - Math.abs(y - 8); R(8 - w / 2, y, w, 2, y % 4 === 1 ? '#8a5a30' : '#6a4422'); } R(8, 1, 1, 2, '#4a7a30'); },
  coco(R, g) { blob(g, 8, 9, 5, '#6a4428'); blob(g, 7, 8, 3, '#8a5a34'); R(6, 6, 1, 1, '#2a1a10'); R(9, 6, 1, 1, '#2a1a10'); R(8, 8, 1, 1, '#2a1a10'); },
  manzana(R, g) { blob(g, 8, 10, 5, '#d8382a'); blob(g, 6, 8, 2, '#ff7a5a'); R(8, 3, 1, 3, '#5a3a20'); R(9, 3, 3, 2, '#4a9a3a'); },
  bayas(R, g) { for (const [x, y] of [[6, 9], [10, 9], [8, 12], [8, 7], [11, 12], [5, 12]]) { blob(g, x, y, 2, '#4a4ab8'); R(x - 1, y - 1, 1, 1, '#9a9aff'); } R(7, 3, 4, 2, '#4a9a3a'); },
  pulpa(R, g) { ellipse(g, 8, 9, 5, 5, '#4f9a52'); ellipse(g, 8, 9, 3, 3, '#ff9ab8'); R(7, 8, 2, 1, '#ffd8e4'); R(4, 6, 1, 1, '#f4f0d0'); R(12, 11, 1, 1, '#f4f0d0'); },
  oro(R, g) { ellipse(g, 8, 10, 6, 4, '#7e7a72'); ellipse(g, 7, 9, 5, 3, '#9a968d'); for (const [x, y] of [[5, 8], [9, 10], [11, 8], [7, 11]]) R(x, y, 2, 2, '#f8d040'); R(9, 10, 1, 1, '#fff6c0'); },
  tablas(R) { for (const [y, col] of [[10, '#c8925a'], [6, '#d8a46a'], [2, '#c8925a']]) { R(1, y, 14, 3, col); R(1, y, 14, 1, '#e8c088'); R(1, y + 3, 14, 1, '#8a5a30'); R(5, y + 1, 1, 1, '#9a6a3a'); R(11, y + 2, 1, 1, '#9a6a3a'); } },
  cuerda(R, g) { ellipse(g, 8, 9, 6, 5, '#c8a860'); ellipse(g, 8, 9, 4, 3, '#a8884a'); ellipse(g, 8, 9, 2, 1, '#c8a860'); for (let x = 3; x < 13; x += 3) R(x, 6, 1, 1, '#e8d090'); R(13, 11, 3, 1, '#c8a860'); },
  tela(R) { R(2, 4, 12, 9, '#e8e0d0'); R(2, 4, 12, 1, '#fffaf0'); for (let x = 3; x < 14; x += 2) R(x, 5, 1, 8, '#d0c8b8'); R(2, 7, 12, 2, '#c0644a'); R(12, 10, 3, 4, '#e8e0d0'); },
  lingote_cobre: (R, g) => ingot(R, g, '#d8844a'),
  lingote_hierro: (R, g) => ingot(R, g, '#b8c2ce'),
  lingote_oro: (R, g) => ingot(R, g, '#f0c840'),
  manzana_asada(R, g) { blob(g, 8, 10, 5, '#a8442a'); blob(g, 6, 8, 2, '#d8744a'); R(8, 3, 1, 3, '#3a2a18'); R(4, 13, 9, 2, '#e8d8b0'); R(5, 6, 1, 1, '#ffd890'); },
  mermelada(R) { R(4, 4, 8, 11, '#8a2a5a'); R(4, 4, 8, 11, '#a83a6a'); R(5, 6, 2, 6, '#d8709a'); R(3, 2, 10, 3, '#e8e0d0'); R(3, 2, 10, 1, '#fffaf0'); R(5, 9, 6, 3, '#f4ecd8'); },
  coco_tostado(R, g) { ellipse(g, 8, 10, 6, 4, '#6a4428'); ellipse(g, 8, 9, 5, 3, '#f4ecd8'); ellipse(g, 8, 9, 3, 2, '#d8b07a'); R(6, 8, 2, 1, '#fff'); },
  pinones(R) { for (const [x, y] of [[4, 9], [7, 7], [10, 9], [6, 11], [9, 12], [12, 12], [3, 12]]) { R(x, y, 2, 3, '#e0c088'); R(x, y, 1, 1, '#fff0c8'); R(x + 1, y + 2, 1, 1, '#a8844a'); } },
  pan_bellota(R, g) { ellipse(g, 8, 10, 7, 4, '#8a5a30'); ellipse(g, 8, 9, 6, 3, '#b07a44'); for (const x of [4, 7, 10]) R(x, 8, 2, 1, '#e0b878'); },
  estofado(R, g) { ellipse(g, 8, 10, 7, 4, '#6a6a76'); ellipse(g, 8, 9, 6, 3, '#c87a3a'); R(5, 8, 2, 2, '#4f9a52'); R(9, 9, 2, 1, '#4a4ab8'); R(10, 7, 1, 1, '#fff0c8'); R(1, 9, 2, 1, '#4a4a54'); R(13, 9, 2, 1, '#4a4a54'); R(7, 2, 1, 3, 'rgba(255,255,255,.5)'); R(10, 1, 1, 3, 'rgba(255,255,255,.4)'); },
  // Lo que se coloca: dibujos de frente, pensados para leerse a 16 píxeles
  banco(R) { R(3, 4, 6, 2, '#c8ccd4'); R(9, 4, 2, 2, '#6a4422'); R(12, 1, 1, 5, '#6a4422'); R(11, 1, 3, 2, '#8a8e96'); R(1, 6, 14, 3, '#c8925a'); R(1, 6, 14, 1, '#e0b070'); R(1, 9, 14, 1, '#7a5030'); R(2, 10, 2, 5, '#7a5030'); R(12, 10, 2, 5, '#7a5030'); R(4, 12, 8, 1, '#7a5030'); },
  horno(R) { R(9, 0, 4, 5, '#8a837a'); R(9, 0, 1, 5, '#a8a298'); R(1, 5, 14, 10, '#9a948a'); R(1, 5, 14, 1, '#b8b2a8'); R(2, 8, 4, 1, '#7a746a'); R(10, 8, 4, 1, '#7a746a'); R(5, 9, 6, 6, '#2a1612'); R(6, 12, 4, 3, '#ff8a2a'); R(7, 13, 2, 2, '#ffd860'); },
  yunque(R) { R(3, 5, 9, 3, '#62626e'); R(3, 5, 9, 1, '#9a9aa8'); R(12, 6, 3, 1, '#62626e'); R(6, 8, 4, 2, '#4a4a54'); R(5, 10, 6, 1, '#3e3e46'); R(4, 11, 8, 4, '#7a5232'); R(4, 11, 8, 1, '#c8a070'); },
  telar(R) { R(2, 1, 2, 14, '#7a5030'); R(12, 1, 2, 14, '#7a5030'); R(4, 2, 8, 2, '#b07a44'); R(4, 12, 8, 2, '#b07a44'); for (let x = 4; x < 12; x++) R(x, 4, 1, 8, x % 2 ? '#e8e0d0' : '#c8c0b0'); R(4, 6, 8, 3, '#c0644a'); R(4, 7, 8, 1, '#e8c070'); },
  cocina(R) { R(5, 0, 6, 4, '#5a5a66'); R(5, 0, 6, 1, '#c87a3a'); R(1, 4, 14, 2, '#3a3a42'); R(1, 6, 14, 9, '#b0563a'); R(1, 9, 14, 1, '#7a3424'); R(1, 12, 3, 1, '#7a3424'); R(5, 8, 6, 5, '#2a2a30'); R(6, 10, 4, 3, '#ff8a2a'); },
  silla(R) { R(4, 1, 2, 14, '#7a5030'); R(4, 1, 8, 2, '#b07a44'); R(4, 4, 8, 1, '#b07a44'); R(4, 8, 9, 2, '#c8925a'); R(4, 10, 9, 1, '#7a5030'); R(11, 10, 2, 5, '#7a5030'); },
  mesa(R) { R(9, 2, 3, 3, '#e8e0d0'); R(1, 5, 14, 3, '#c8925a'); R(1, 5, 14, 1, '#e0b070'); R(1, 8, 14, 1, '#7a5030'); R(2, 9, 2, 6, '#7a5030'); R(12, 9, 2, 6, '#7a5030'); },
  cama(R) { R(1, 5, 3, 10, '#7a5030'); R(4, 9, 11, 3, '#f2efe6'); R(4, 9, 11, 1, '#ffffff'); R(8, 8, 7, 4, '#4a72a8'); R(4, 12, 11, 2, '#7a5030'); R(5, 7, 3, 2, '#ffffff'); R(14, 12, 1, 3, '#7a5030'); },
  estanteria(R) { R(2, 1, 12, 14, '#a8764a'); for (const y of [2, 7, 11]) { R(3, y, 10, 4, '#5a3a22'); for (let x = 3; x < 13; x += 2) R(x, y + 1, 1, 3, ['#a83a3a', '#3a6ab8', '#3f8a4a', '#c8902a'][(x + y) % 4]); } },
  maceta(R, g) { R(5, 10, 6, 5, '#b0603a'); R(4, 10, 8, 1, '#c8784a'); blob(g, 8, 6, 4, '#4f9a3a'); blob(g, 7, 5, 2, '#7cbf55'); R(5, 3, 2, 2, '#ff9ab8'); R(10, 5, 2, 2, '#ffe04a'); },
  lampara(R) { R(7, 6, 2, 8, '#4a4a54'); R(5, 14, 6, 1, '#4a4a54'); R(4, 1, 8, 5, '#ffe6a0'); R(5, 2, 3, 2, '#fff6d8'); R(3, 0, 10, 1, '#34343c'); },
  antorcha(R) { R(7, 6, 2, 9, '#7a5030'); R(6, 5, 4, 2, '#4a4a54'); R(6, 2, 4, 3, '#ff8a2a'); R(7, 1, 2, 3, '#ffd860'); R(7, 0, 1, 1, '#fff6c0'); },
  cofre(R) { R(3, 4, 10, 1, '#c8925a'); R(2, 5, 12, 3, '#b88048'); R(2, 8, 12, 1, '#5a3a22'); R(2, 9, 12, 5, '#a8703a'); R(2, 11, 12, 1, '#8a5a30'); R(2, 13, 12, 1, '#7a5030'); R(4, 4, 1, 10, '#5a5a66'); R(11, 4, 1, 10, '#5a5a66'); R(7, 7, 2, 3, '#e8c050'); R(7, 9, 1, 1, '#2a1c22'); },
  alfombra(R) { R(1, 4, 14, 9, '#8a3a3a'); R(2, 5, 12, 7, '#c0644a'); R(5, 7, 6, 3, '#e8c070'); R(7, 8, 2, 1, '#8a3a3a'); for (let x = 1; x < 15; x += 2) { R(x, 3, 1, 1, '#e8c070'); R(x, 13, 1, 1, '#e8c070'); } },
};
Object.assign(DRAW, {
  semilla_manzano(R) { seedPacket(R, '#d8382a', '#4a9a3a'); },
  regadera(R, g) { R(3, 7, 9, 7, '#5a8ab8'); R(3, 7, 9, 2, '#7aaad8'); R(12, 8, 3, 2, '#5a8ab8'); R(14, 6, 2, 2, '#4a7aa8'); line(g, 4, 6, 7, 3, '#3a5a80'); line(g, 7, 3, 10, 6, '#3a5a80'); R(1, 9, 2, 3, '#4a7aa8'); },
  cana(R, g) { line(g, 2, 15, 13, 1, '#8a5a30'); line(g, 3, 15, 14, 1, '#6a4422'); line(g, 14, 1, 15, 10, '#e8e0d0'); R(14, 10, 2, 2, '#e83a3a'); R(4, 12, 3, 2, '#4a4a54'); },
  abono(R) { R(3, 4, 10, 11, '#8a6a44'); R(3, 4, 10, 2, '#a8865a'); R(5, 8, 6, 3, '#4a3020'); R(6, 1, 4, 3, '#6aa84a'); },
  aspersor(R) { R(7, 6, 2, 9, '#8a8e96'); R(4, 13, 8, 2, '#6a6e76'); R(4, 4, 8, 3, '#b8c2ce'); for (const [x, y] of [[2, 2], [13, 2], [1, 6], [14, 6]]) R(x, y, 1, 1, '#7ab8e0'); },
  gallinero(R) { R(2, 7, 12, 8, '#c8925a'); R(1, 5, 14, 3, '#c95a3c'); R(4, 2, 8, 4, '#c95a3c'); R(6, 10, 4, 5, '#5a3a22'); R(11, 9, 2, 2, '#ffffff'); R(12, 8, 1, 1, '#e83a3a'); },
  establo(R) { R(1, 6, 14, 9, '#b0563a'); R(0, 4, 16, 3, '#8a3a2a'); R(3, 1, 10, 4, '#8a3a2a'); R(5, 8, 6, 7, '#e8e0d0'); R(6, 9, 4, 6, '#7a5030'); line2(R, 6, 9, 10, 15); },
  colmena(R) { R(7, 1, 2, 3, '#7a5030'); for (let y = 3; y < 14; y += 3) R(8 - (y < 6 ? 3 : y > 10 ? 4 : 5), y, (y < 6 ? 3 : y > 10 ? 4 : 5) * 2, 3, y % 2 ? '#e8b040' : '#d09a30'); R(7, 10, 2, 2, '#4a3020'); R(12, 3, 2, 1, '#2a2a2a'); R(12, 2, 2, 1, '#f0e060'); },
  comedero(R) { R(2, 8, 12, 5, '#a8764a'); R(2, 8, 12, 1, '#c8925a'); R(3, 7, 10, 2, '#c8b060'); R(3, 13, 2, 2, '#7a5030'); R(11, 13, 2, 2, '#7a5030'); },
  huevo(R, g) { ellipse(g, 8, 9, 4, 5, '#f4ecd8'); R(6, 6, 2, 2, '#ffffff'); R(10, 12, 1, 1, '#d8c8a8'); },
  leche(R) { R(5, 3, 6, 11, '#f4f4f0'); R(5, 3, 6, 2, '#5a8ab8'); R(6, 1, 4, 2, '#e8e0d0'); R(6, 8, 4, 3, '#5a8ab8'); R(10, 4, 1, 10, '#c8c8c0'); },
  lana(R, g) { for (const [x, y] of [[6, 7], [10, 7], [8, 10], [5, 11], [11, 11], [8, 5]]) blob(g, x, y, 3, '#f4f0e8'); R(6, 6, 2, 1, '#ffffff'); },
  miel(R) { R(4, 5, 8, 10, '#e8a020'); R(4, 5, 8, 10, '#f0b030'); R(5, 7, 2, 6, '#f8d070'); R(3, 2, 10, 3, '#a8764a'); R(6, 9, 4, 3, '#f4ecd8'); },
  tortilla(R, g) { ellipse(g, 8, 10, 7, 4, '#f0d070'); ellipse(g, 8, 9, 6, 3, '#f8e090'); R(5, 8, 2, 1, '#c8a040'); R(10, 10, 2, 1, '#c8a040'); },
  queso(R, g) { poly(g, [[2, 12], [14, 12], [14, 6], [2, 9]], '#f0c840'); poly(g, [[2, 9], [14, 6], [11, 4], [2, 8]], '#f8e070'); R(6, 10, 2, 1, '#c8a020'); R(11, 8, 2, 2, '#c8a020'); },
  pan(R, g) { ellipse(g, 8, 10, 7, 4, '#b07a3a'); ellipse(g, 8, 9, 6, 3, '#d0a060'); for (const x of [4, 7, 10]) R(x, 8, 2, 1, '#f0d090'); },
  tarta_calabaza(R, g) { ellipse(g, 8, 10, 7, 4, '#c8925a'); ellipse(g, 8, 9, 6, 3, '#e8822a'); R(7, 7, 2, 2, '#ffffff'); },
  sopa_verduras(R, g) { ellipse(g, 8, 10, 7, 4, '#e8e0d0'); ellipse(g, 8, 9, 6, 3, '#c87a3a'); R(5, 8, 2, 1, '#f08a2a'); R(9, 9, 2, 1, '#5aa842'); R(7, 2, 1, 3, 'rgba(255,255,255,.6)'); },
  pescado_asado(R, g) { ellipse(g, 8, 11, 7, 3, '#e8e0d0'); ellipse(g, 8, 9, 5, 2, '#c87a3a'); poly(g, [[12, 9], [15, 7], [15, 11]], '#a85a2a'); R(5, 8, 1, 1, '#2a1c22'); },
  mermelada_fresa(R) { R(4, 4, 8, 11, '#c83a4a'); R(5, 6, 2, 6, '#e87a8a'); R(3, 2, 10, 3, '#e8e0d0'); R(6, 9, 4, 3, '#f4ecd8'); },
  palomitas(R, g) { R(4, 8, 8, 7, '#e83a3a'); R(6, 8, 2, 7, '#ffffff'); R(10, 8, 1, 7, '#ffffff'); for (const [x, y] of [[5, 6], [8, 5], [11, 6], [7, 3], [10, 3]]) blob(g, x, y, 2, '#f8f0c8'); },
  tostada_miel(R) { R(3, 4, 10, 10, '#c8925a'); R(4, 5, 8, 8, '#e8c088'); R(5, 6, 6, 4, '#f0b030'); R(6, 10, 3, 2, '#f0b030'); },
});
Object.assign(DRAW, {
  amatista: (R, g) => gem(R, g, '#9a5ae0'), esmeralda: (R, g) => gem(R, g, '#3ac870'), rubi: (R, g) => gem(R, g, '#e83a4a'), diamante: (R, g) => gem(R, g, '#c8f0ff'),
  fosil_concha(R, g) { ellipse(g, 8, 9, 6, 5, '#c8b898'); for (let r = 4; r > 0; r -= 1.5) ellipse(g, 8 + (4 - r) / 2, 9, r, r * 0.8, r % 3 < 1.5 ? '#a89878' : '#d8c8a8'); },
  fosil_hueso(R) { R(3, 7, 10, 3, '#e8e0c8'); R(2, 5, 3, 3, '#e8e0c8'); R(2, 9, 3, 3, '#e8e0c8'); R(11, 5, 3, 3, '#e8e0c8'); R(11, 9, 3, 3, '#e8e0c8'); R(4, 8, 8, 1, '#c8c0a8'); },
  fosil_ambar(R, g) { blob(g, 8, 9, 5, '#e89a20'); blob(g, 7, 8, 3, '#f8c050'); R(7, 9, 2, 1, '#2a1c22'); R(6, 8, 1, 1, '#2a1c22'); R(9, 8, 1, 1, '#2a1c22'); },
  moneda_antigua(R, g) { blob(g, 8, 8, 6, '#c8a030'); blob(g, 8, 8, 4, '#e8c050'); R(7, 5, 2, 6, '#a88020'); R(5, 7, 6, 2, '#a88020'); },
  calavera(R) { R(4, 3, 8, 7, '#f0ece0'); R(5, 10, 6, 3, '#f0ece0'); R(5, 5, 2, 2, '#2a1c22'); R(9, 5, 2, 2, '#2a1c22'); R(7, 8, 2, 1, '#2a1c22'); for (const x of [6, 8, 10]) R(x, 11, 1, 2, '#c8c4b8'); },
  baba(R, g) { ellipse(g, 8, 11, 6, 3, '#6ad84a'); ellipse(g, 8, 9, 4, 3, '#8ae86a'); R(6, 8, 2, 1, '#ffffff'); },
  pocion(R) { R(6, 1, 4, 3, '#a8764a'); R(7, 4, 2, 2, '#c8e8f8'); R(4, 6, 8, 8, '#c8e8f8'); R(5, 8, 6, 5, '#e83a5a'); R(6, 8, 2, 2, '#ff9aaa'); },
  espada(R, g) { line(g, 3, 13, 13, 3, '#d8dce4'); line(g, 4, 13, 14, 3, '#9aa0aa'); R(2, 11, 4, 1, '#8a5a30'); R(4, 9, 1, 4, '#8a5a30'); R(1, 14, 2, 2, '#6a4422'); },
  espada_oro(R, g) { line(g, 3, 13, 13, 3, '#f8e070'); line(g, 4, 13, 14, 3, '#d8a830'); R(2, 11, 4, 1, '#e83a4a'); R(4, 9, 1, 4, '#e83a4a'); R(1, 14, 2, 2, '#a88020'); },
  barca(R) { R(1, 9, 14, 3, '#a8764a'); R(3, 12, 10, 2, '#7a5030'); R(1, 8, 14, 1, '#c8925a'); R(7, 2, 1, 7, '#7a5030'); R(8, 3, 5, 4, '#f4ecd8'); },
  caballo(R) { R(6, 2, 4, 12, '#c8a030'); R(6, 2, 4, 2, '#e8c050'); R(4, 12, 8, 2, '#a88020'); R(7, 5, 2, 1, '#6a4a10'); R(10, 3, 3, 1, '#e83a3a'); },
  brujula(R, g) { blob(g, 8, 8, 6, '#c8a030'); blob(g, 8, 8, 5, '#f4ecd8'); line(g, 8, 8, 11, 4, '#e83a3a'); line(g, 8, 8, 5, 12, '#4a4a54'); R(7, 7, 2, 2, '#2a1c22'); },
});
DRAW.red = (R, g) => { line(g, 2, 15, 10, 7, '#8a5a30'); line(g, 3, 15, 11, 7, '#6a4422'); ellipse(g, 11, 5, 4, 4, '#e8e0d0'); ellipse(g, 11, 5, 3, 3, 'rgba(232,224,208,.35)'); for (let i = 8; i < 15; i += 2) R(i, 3, 1, 5, '#c8c0b0'); };
DRAW.vitrina = R => { R(2, 2, 12, 12, '#a8764a'); R(3, 3, 10, 9, '#c8ecfa'); R(5, 8, 2, 2, '#9a5ae0'); R(9, 7, 3, 3, '#e8c050'); R(2, 12, 12, 2, '#7a5030'); };
function bugIcon(R, g, b, id) {
  if (id === 'mariposa' || id === 'polilla' || id === 'libelula') { const c = ramp(b.col); poly(g, [[8, 8], [2, 3], [3, 11]], c.b); poly(g, [[8, 8], [14, 3], [13, 11]], c.b); R(7, 4, 2, 10, '#2a1c22'); R(4, 6, 2, 1, c.l); R(10, 6, 2, 1, c.l); return; }
  if (id === 'saltamontes' || id === 'grillo') { R(3, 8, 10, 3, b.col); R(11, 6, 3, 3, b.col); line(g, 5, 11, 2, 14, b.col); line(g, 8, 11, 6, 14, b.col); line(g, 13, 6, 15, 2, '#2a1c22'); R(12, 7, 1, 1, '#2a1c22'); return; }
  blob(g, 8, 9, 5, b.col); R(7, 4, 2, 10, '#2a1c22'); R(6, 3, 4, 2, '#2a1c22');
  if (id === 'mariquita') for (const [x, y] of [[5, 8], [10, 7], [6, 11], [11, 11]]) R(x, y, 2, 2, '#2a1c22');
  if (id === 'luciernaga') { R(6, 11, 4, 3, '#f8ff9a'); R(5, 12, 6, 1, '#fffff0'); }
}
function gem(R, g, col) { const r = ramp(col); poly(g, [[8, 2], [14, 7], [8, 14], [2, 7]], r.b); poly(g, [[8, 2], [14, 7], [8, 7]], r.l); poly(g, [[2, 7], [8, 7], [8, 14]], r.d); R(6, 4, 2, 1, '#ffffff'); }
function line2(R, x0, y0, x1, y1) { for (let i = 0; i <= 6; i++) R(Math.round(x0 + (x1 - x0) * i / 6), Math.round(y0 + (y1 - y0) * i / 6), 1, 1, '#e8e0d0'); }
function seedPacket(R, col, leaf) { R(3, 2, 10, 13, '#e8dcc0'); R(3, 2, 10, 2, '#c8b890'); R(5, 6, 6, 6, col); R(7, 4, 2, 3, leaf); R(5, 13, 6, 1, '#a89870'); }
function cropIcon(R, g, c, id) {
  if (id === 'trigo') { for (let i = 0; i < 4; i++) { R(4 + i * 2, 4, 1, 11, '#c8a040'); R(3 + i * 2, 2 + (i % 2), 3, 4, c.color); } return; }
  if (id === 'maiz') { R(5, 3, 6, 11, c.color); for (let y = 4; y < 13; y += 2) R(6, y, 4, 1, '#d8b030'); R(3, 6, 2, 8, c.leaf); R(11, 6, 2, 8, c.leaf); return; }
  if (id === 'zanahoria') { poly(g, [[5, 5], [11, 5], [8, 15]], c.color); R(6, 7, 3, 1, '#c86a1a'); R(5, 1, 2, 4, c.leaf); R(9, 1, 2, 4, c.leaf); return; }
  if (id === 'calabaza') { ellipse(g, 8, 10, 7, 5, c.color); ellipse(g, 6, 9, 2, 4, '#f0a04a'); R(7, 3, 2, 3, '#5a7a3a'); return; }
  blob(g, 8, 10, id === 'fresa' ? 4 : 5, c.color);
  if (id === 'nabo') { R(6, 10, 4, 3, '#b86ab8'); R(8, 15, 1, 1, '#e8e0d0'); }
  if (id === 'fresa') for (const [x, y] of [[6, 9], [9, 10], [7, 12]]) R(x, y, 1, 1, '#f8e070');
  R(6, 3, 2, 4, c.leaf); R(9, 3, 2, 4, c.leaf);
}
function fishIcon(R, g, f) {
  const r = ramp(f.color);
  if (f.crab) { ellipse(g, 8, 10, 5, 3, r.b); R(2, 6, 3, 3, r.b); R(11, 6, 3, 3, r.b); for (const x of [4, 6, 10, 12]) R(x, 13, 1, 2, r.d); R(6, 8, 1, 1, '#2a1c22'); R(9, 8, 1, 1, '#2a1c22'); return; }
  const ry = f.round ? 4 : f.thin ? 2 : 3;
  ellipse(g, 7, 9, Math.min(6, f.size + 1), ry, r.b);
  ellipse(g, 7, 8, Math.min(5, f.size), 1, r.l);
  poly(g, [[12, 9], [15, 6], [15, 12]], r.d);
  R(3, 8, 1, 1, '#2a1c22');
  if (f.round) for (const [x, y] of [[5, 5], [9, 5], [7, 13]]) R(x, y, 1, 1, r.d);
}
function ingot(R, g, col) {
  const r = ramp(col);
  poly(g, [[1, 11], [5, 7], [15, 7], [11, 11]], r.l);
  poly(g, [[1, 11], [11, 11], [11, 14], [1, 14]], r.b);
  poly(g, [[11, 11], [15, 7], [15, 10], [11, 14]], r.d);
  R(5, 8, 6, 1, '#ffffff');
}
// Ropa y mochila: dibujadas con el color de la prenda (c: rampa de ese color)
const WEAR_DRAW = {
  camisa(R, g, c) { poly(g, [[4, 3], [12, 3], [15, 7], [13, 9], [12, 7], [12, 15], [4, 15], [4, 7], [3, 9], [1, 7]], c.b); R(6, 3, 4, 2, c.d); R(7, 5, 2, 8, c.l); R(4, 14, 8, 1, c.d); },
  tunica(R, g, c) { poly(g, [[4, 2], [12, 2], [15, 6], [13, 8], [12, 6], [13, 15], [3, 15], [4, 6], [3, 8], [1, 6]], c.b); R(6, 2, 4, 2, c.d); R(4, 9, 8, 2, '#5a3a22'); R(7, 9, 2, 2, '#e8c050'); },
  tunica_larga(R, g, c) { poly(g, [[5, 1], [11, 1], [14, 5], [12, 6], [11, 5], [13, 15], [3, 15], [5, 5], [4, 6], [2, 5]], c.b); R(6, 1, 4, 2, c.d); R(5, 7, 6, 1, '#5a3a22'); R(3, 14, 10, 1, c.d); },
  chaleco(R, g, c) { poly(g, [[3, 3], [7, 3], [7, 15], [3, 15]], c.b); poly(g, [[9, 3], [13, 3], [13, 15], [9, 15]], c.b); R(7, 3, 2, 12, '#ece4d4'); R(5, 8, 1, 1, c.l); R(11, 8, 1, 1, c.l); R(3, 3, 1, 12, c.d); R(12, 3, 1, 12, c.d); },
  delantal(R, g, c) { R(5, 2, 6, 6, c.b); R(3, 8, 10, 7, c.b); R(2, 8, 12, 1, c.d); R(9, 10, 3, 3, c.d); R(5, 1, 1, 2, c.d); R(10, 1, 1, 2, c.d); },
  pantalon(R, g, c) { R(3, 2, 10, 3, c.b); R(3, 5, 4, 10, c.b); R(9, 5, 4, 10, c.b); R(3, 2, 10, 1, c.d); R(7, 5, 2, 3, c.b); R(4, 6, 1, 8, c.l); R(10, 6, 1, 8, c.l); },
  falda(R, g, c) { poly(g, [[5, 3], [11, 3], [14, 13], [2, 13]], c.b); R(5, 3, 6, 2, c.d); R(5, 6, 1, 6, c.l); R(10, 6, 1, 6, c.l); },
  botas(R, g, c) { R(3, 3, 4, 8, c.b); R(3, 10, 6, 4, c.b); R(9, 3, 4, 8, c.d); R(9, 10, 6, 4, c.d); R(3, 13, 6, 1, '#2a1c14'); R(9, 13, 6, 1, '#2a1c14'); },
  camiseta_interior(R, g, c) { poly(g, [[4, 2], [6, 2], [7, 5], [9, 5], [10, 2], [12, 2], [13, 15], [3, 15]], c.b); R(4, 14, 9, 1, c.d); R(6, 7, 1, 6, c.l); },
  calzoncillos(R, g, c) { R(2, 4, 12, 3, c.b); R(2, 7, 5, 6, c.b); R(9, 7, 5, 6, c.b); R(2, 4, 12, 1, c.d); R(7, 7, 2, 3, c.b); },
  bragas(R, g, c) { poly(g, [[2, 5], [14, 5], [10, 12], [6, 12]], c.b); R(2, 5, 12, 1, c.d); R(7, 9, 2, 2, c.l); },
  sombrero(R, g, c) { ellipse(g, 8, 11, 7, 3, c.d); R(5, 4, 6, 7, c.b); R(5, 8, 6, 2, '#8a5a30'); ellipse(g, 8, 10, 7, 2, c.b); R(6, 5, 2, 2, c.l); },
  gorro(R, g, c) { ellipse(g, 8, 9, 6, 6, c.b); R(2, 10, 12, 4, c.d); ellipse(g, 8, 3, 2, 2, '#f4f0e8'); R(5, 6, 2, 2, c.l); },
  mochila(R, g, c) { R(3, 3, 10, 12, c.b); R(3, 3, 10, 4, c.d); R(5, 9, 6, 4, c.d); R(7, 6, 2, 2, '#c8a048'); R(4, 2, 1, 2, c.d); R(11, 2, 1, 2, c.d); },
};

// Herramientas: el mismo dibujo con la cabeza del color del material
const TOOL_DRAW = {
  hacha(R, g, h) { line(g, 3, 14, 11, 4, '#8a5a30'); line(g, 4, 14, 12, 4, '#6a4422'); poly(g, [[9, 2], [15, 4], [14, 9], [10, 6]], h.b); R(13, 4, 1, 4, h.l); R(10, 5, 2, 1, h.d); },
  pico(R, g, h) { line(g, 4, 14, 10, 5, '#8a5a30'); line(g, 5, 14, 11, 5, '#6a4422'); poly(g, [[2, 6], [8, 2], [14, 4], [15, 7], [9, 5], [3, 8]], h.b); R(8, 3, 4, 1, h.l); R(3, 7, 2, 1, h.d); },
  guadana(R, g, h) { line(g, 3, 15, 12, 2, '#8a5a30'); line(g, 4, 15, 13, 2, '#6a4422'); poly(g, [[12, 2], [5, 1], [1, 4], [7, 3]], h.b); R(4, 2, 5, 1, h.l); },
  azada(R, g, h) { line(g, 3, 15, 11, 3, '#8a5a30'); line(g, 4, 15, 12, 3, '#6a4422'); poly(g, [[9, 2], [15, 2], [15, 6], [11, 5]], h.b); R(14, 2, 1, 4, h.l); R(11, 4, 2, 1, h.d); },
};

// Icono de 18×18 (16×16 más el contorno). color: el de la prenda (la ropa)
export function itemIcon(id, color) {
  const def = ITEMS[id], k = def?.wear ? `${id}|${color || def.dye}` : id;
  if (cache.has(k)) return cache.get(k);
  const c = mk(18, 18), g = c.getContext('2d');
  g.translate(1, 1);
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), w, h); };
  if (WEAR_DRAW[id]) WEAR_DRAW[id](R, g, ramp(color || def.dye));
  else if (TOOL_DRAW[def.tool]) TOOL_DRAW[def.tool](R, g, ramp(TIERS[def.tier].head));
  else if (def.seed) seedPacket(R, CROPS[def.seed].color, CROPS[def.seed].leaf);
  else if (CROPS[id]) cropIcon(R, g, CROPS[id], id);
  else if (FISH[id]) fishIcon(R, g, FISH[id]);
  else if (BUGS[id]) bugIcon(R, g, BUGS[id], id);
  else if (DRAW[id]) DRAW[id](R, g);
  else R(4, 4, 8, 8, '#ff00ff');
  const icon = outlined(c);
  cache.set(k, icon);
  cache.set(k + ':url', icon.toDataURL());
  return icon;
}
export const itemIconUrl = (id, color) => { itemIcon(id, color); const def = ITEMS[id]; return cache.get((def?.wear ? `${id}|${color || def.dye}` : id) + ':url'); };
