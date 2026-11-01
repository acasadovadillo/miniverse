// Datos de lo que se coloca en el mundo (estaciones de trabajo y muebles): luz, fuego, lo que ocupa dos
// casillas y cuánto se arrima a la pared. Y el dibujo del hogar para su icono en la paleta de construcción
// (lienzo 40×70, apoyo en 20,58).
import { ramp } from '../util.js';
import { boxCol } from '../iso.js';

export const PLACE_W = 40, PLACE_H = 70, PLACE_AX = 20, PLACE_AY = 58;

const woodD = boxCol('#7a5030');

// Hogar de piedra: un cuerpo ancho casi como la casilla con la boca grande hacia delante, repisa de madera
// y, encima, el tiro de piedra hasta z = top, apoyado detrás (contra la pared). En una casa, el tiro sube
// hasta el alero (lo dibuja art/build.js en un lienzo más alto) y el tejado pone el remate encima.
export const HEARTH_BACK = 0.34;   // de su centro a su parte de atrás (para arrimarlo a la pared)
export function drawHearth(I, g, top) {
  const st = ramp('#a59e92'), X0 = -0.46, X1 = 0.46, Y0 = -HEARTH_BACK, Y1 = 0.26, H = 40;
  const SX0 = -0.3, SX1 = 0.3, SY1 = 0.02;   // el tiro
  I.box(X0, Y0, X1, Y1, 0, H, { top: st.l, left: st.b, right: st.d });
  // Piedras: hiladas en las dos caras que se ven
  for (const z of [8, 16, 24, 32]) { I.edge([0, 1], [X0, Y1, z], [X1, Y1, z], st.d); I.edge([1, 0], [X1, Y0, z], [X1, Y1, z], st.d2); }
  for (const [u, z] of [[-0.4, 0], [0.38, 0], [-0.4, 16], [0.38, 16], [-0.3, 24], [0.3, 24], [-0.1, 32], [0.2, 32]]) I.faceL(Y1, u, u + 0.02, z, z + 8, st.d);
  for (const [u, z] of [[-0.1, 0], [0.1, 8], [-0.2, 16], [0.05, 24], [-0.12, 32]]) I.faceR(X1, u, u + 0.02, z, z + 8, st.d2);
  // La boca: arco de piedra oscura, hueco negro y la parrilla
  I.faceL(Y1, -0.34, 0.34, 0, 27, '#4a4038');
  I.faceL(Y1, -0.29, 0.29, 0, 24, '#1c1412');
  I.faceL(Y1, -0.22, 0.22, 2, 4, '#3a3036');
  I.faceL(Y1, -0.16, 0.16, 4, 6, '#3a2418');                // brasas apagadas
  I.box(X0 - 0.05, Y0, X1 + 0.05, Y1 + 0.08, H, H + 4, woodD);   // repisa
  // El tiro, contra la pared, con sus hiladas
  I.box(SX0, Y0, SX1, SY1, H + 4, top, { top: st.l, left: st.b, right: st.d });
  for (let z = H + 10; z < top - 2; z += 8) { I.edge([0, 1], [SX0, SY1, z], [SX1, SY1, z], st.d); I.edge([1, 0], [SX1, Y0, z], [SX1, SY1, z], st.d2); }
  for (let z = H + 4, i = 0; z < top - 6; z += 8, i++) I.faceL(SY1, i % 2 ? -0.05 : 0.12, (i % 2 ? -0.05 : 0.12) + 0.02, z, z + 8, st.d);
}

// Dónde está la boca del fuego (para el parpadeo), relativa al apoyo
export const GLOW = { horno: [0, 0.42, 4], cocina: [0, 0.4, 4], chimenea: [0, 0.27, 6] };
// Lo que da luz de noche: [dx, dy, z, radio]
export const LIGHT = { horno: [0, 0.42, 6, 42], cocina: [0, 0.4, 6, 34], lampara: [0, 0, 35, 70], antorcha: [0, 0, 28, 52], chimenea: [0, 0.3, 12, 70] };

// Lo que ocupa dos casillas: la suya y la de delante (+y; girado, la de +x)
export const LONG = { cama: true };
export const BED_BACK = 0.46;   // de la casilla de la cabecera a la parte de atrás de la cama
export const footTile = (tx, ty, rot) => (rot ? [tx + 1, ty] : [tx, ty + 1]);
