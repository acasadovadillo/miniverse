// Cámara del mundo en 3D: la comparten la lógica (andar según la pantalla, el mapa) y el dibujo.
// yaw: giro alrededor del jugador (con yaw = π/4 se mira como en el juego isométrico de antes, hacia -x -y);
// pitch: inclinación (0 a ras de suelo, π/2 desde arriba); dist: lo lejos que está, en casillas.
// turn, tilt y zoom: lo que piden las teclas ahora mismo (-1, 0 o 1); el dibujo lo convierte en movimiento suave.
// first: en primera persona (la Z la cambia), con look la mirada hacia arriba (+) o hacia abajo (-).
export const CAM = { yaw: Math.PI / 4, pitch: 0.84, dist: 22, turn: 0, tilt: 0, zoom: 0, first: false, look: 0 };
export const PITCH = { min: 0.07, max: 1.5 };
export const LOOK = { min: -1.2, max: 1.2 };
export const DIST = { min: 7, max: 46 };

// Mover la mirada con el ratón, en primera persona (dx, dy: lo que se ha movido, en píxeles)
const SENS = 0.0024;
export function lookBy(dx, dy) { CAM.yaw -= dx * SENS; CAM.look = Math.max(LOOK.min, Math.min(LOOK.max, CAM.look - dy * SENS)); }

// Dirección en el mundo (x, y de la rejilla) de un movimiento en pantalla: sx a la derecha, sy hacia abajo
export function screenToWorld(sx, sy) {
  const s = Math.sin(CAM.yaw), c = Math.cos(CAM.yaw);
  return [sx * c + sy * s, -sx * s + sy * c];
}
// Las personas miran hacia una de 8 vistas respecto a la pantalla: 'down' (de frente), 'front' (de frente en
// diagonal), 'side' (de perfil), 'back' (de espaldas en diagonal) y 'up' (de espaldas), y las de la izquierda
// son las de la derecha volteadas (flip). Sirven para saber hacia dónde mira quien no se está moviendo.
const VIEW8 = [['side', false], ['front', false], ['down', false], ['front', true], ['side', true], ['back', true], ['up', false], ['back', false]];
// Vista y volteo según hacia dónde se mueve en pantalla (sx, sy)
export function viewFor(sx, sy) {
  const k = ((Math.round(Math.atan2(sy, sx) / (Math.PI / 4)) % 8) + 8) % 8;   // 0 derecha, 2 abajo, 4 izquierda, 6 arriba
  return VIEW8[k];
}
// Al revés: hacia dónde en pantalla (sx, sy) mira una vista
export function screenDirOf(view, flip) {
  const k = Math.max(0, VIEW8.findIndex(([v, f]) => v === view && f === !!flip)), a = (k * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

// Guardar y cargar la cámara con la partida
export const camToSave = () => ({ yaw: +CAM.yaw.toFixed(3), pitch: +CAM.pitch.toFixed(3), dist: +CAM.dist.toFixed(2), first: CAM.first, look: +CAM.look.toFixed(3) });
export function camFromSave(c) {
  if (!c || typeof c !== 'object') return;
  if (Number.isFinite(c.yaw)) CAM.yaw = c.yaw;
  if (Number.isFinite(c.pitch)) CAM.pitch = Math.max(PITCH.min, Math.min(PITCH.max, c.pitch));
  if (Number.isFinite(c.dist)) CAM.dist = Math.max(DIST.min, Math.min(DIST.max, c.dist));
  CAM.first = !!c.first;
  if (Number.isFinite(c.look)) CAM.look = Math.max(LOOK.min, Math.min(LOOK.max, c.look));
}
