// Cámara del mundo en 3D: la comparten la lógica (andar según la pantalla, el mapa) y el dibujo.
// yaw: giro alrededor del jugador (con yaw = π/4 se mira como en el juego isométrico de antes, hacia -x -y);
// pitch: inclinación (0 a ras de suelo, π/2 desde arriba); dist: lo lejos que está, en casillas.
// turn, tilt y zoom: lo que piden las teclas ahora mismo (-1, 0 o 1); el dibujo lo convierte en movimiento suave.
export const CAM = { yaw: Math.PI / 4, pitch: 0.84, dist: 22, turn: 0, tilt: 0, zoom: 0 };
export const PITCH = { min: 0.07, max: 1.5 };
export const DIST = { min: 7, max: 46 };

// Dirección en el mundo (x, y de la rejilla) de un movimiento en pantalla: sx a la derecha, sy hacia abajo
export function screenToWorld(sx, sy) {
  const s = Math.sin(CAM.yaw), c = Math.cos(CAM.yaw);
  return [sx * c + sy * s, -sx * s + sy * c];
}
// Guardar y cargar la cámara con la partida
export const camToSave = () => ({ yaw: +CAM.yaw.toFixed(3), pitch: +CAM.pitch.toFixed(3), dist: +CAM.dist.toFixed(2) });
export function camFromSave(c) {
  if (!c || typeof c !== 'object') return;
  if (Number.isFinite(c.yaw)) CAM.yaw = c.yaw;
  if (Number.isFinite(c.pitch)) CAM.pitch = Math.max(PITCH.min, Math.min(PITCH.max, c.pitch));
  if (Number.isFinite(c.dist)) CAM.dist = Math.max(DIST.min, Math.min(DIST.max, c.dist));
}
