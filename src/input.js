// Teclado, ratón y controles táctiles. Guarda qué está pulsado y avisa de las acciones.
import { Audio } from './audio.js';
import { CAM, DIST } from './camera.js';

// use: el botón de usar se mantiene pulsado (para seguir talando sin repetir la tecla)
export const keys = { up: false, down: false, left: false, right: false, run: false, use: false };
const handlers = { chat: () => false, use: () => {}, jump: () => {}, interact: () => {}, pause: () => {}, map: () => {}, bag: () => {}, craft: () => {}, build: () => {}, rotate: () => {}, erase: () => {}, select: () => {}, cycle: () => {}, enabled: () => false };
const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
// En el juego las flechas mueven la cámara (girar e inclinar) y + y − la acercan o alejan; mientras se
// mantienen, la cámara se mueve suave. Con el mapa abierto, las flechas mueven el mapa como WASD.
const CAMKEYS = { ArrowLeft: ['turn', 1], ArrowRight: ['turn', -1], ArrowUp: ['tilt', 1], ArrowDown: ['tilt', -1] };
const held = new Map();   // tecla → [eje, sentido]
function camAxes() {
  CAM.turn = CAM.tilt = CAM.zoom = 0;
  for (const [axis, d] of held.values()) CAM[axis] = Math.max(-1, Math.min(1, CAM[axis] + d));
}
const zoomOf = e => (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd' ? -1 : e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract' ? 1 : 0);

export function clearKeys() { for (const k in keys) keys[k] = false; held.clear(); camAxes(); }

export function initInput(h) {
  Object.assign(handlers, h);

  addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Escape') { if (handlers.pause()) e.preventDefault(); return; }
    if (e.code === 'KeyM' && !e.repeat) { if (handlers.map()) e.preventDefault(); return; }
    if ((e.code === 'KeyI' || e.code === 'Tab') && !e.repeat) { if (handlers.bag()) e.preventDefault(); return; }
    if (e.code === 'KeyC' && !e.repeat) { if (handlers.craft()) e.preventDefault(); return; }
    if (e.code === 'KeyB' && !e.repeat) { if (handlers.build()) e.preventDefault(); return; }
    if (e.code === 'KeyJ' && !e.repeat) { if (handlers.journal?.()) e.preventDefault(); return; }
    // Con el mapa abierto, WASD, flechas y Shift mueven el mapa
    if (handlers.mapOpen?.()) {
      if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.run = true;
      if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') { handlers.mapZoom?.(1); e.preventDefault(); }
      if (e.key === '-' || e.code === 'NumpadSubtract') { handlers.mapZoom?.(-1); e.preventDefault(); }
      return;
    }
    if (!handlers.enabled()) return;
    // La cámara: flechas para girarla e inclinarla, + y − para acercarla (Cmd/Ctrl + sigue siendo el zoom del navegador)
    if (CAMKEYS[e.code]) { held.set(e.code, CAMKEYS[e.code]); camAxes(); e.preventDefault(); return; }
    if (zoomOf(e) && !e.metaKey && !e.ctrlKey) { held.set(e.code, ['zoom', zoomOf(e)]); camAxes(); e.preventDefault(); return; }
    // Chat: T lo abre; / lo abre con la barra ya escrita (sin que la tecla se escriba dos veces)
    if ((e.code === 'KeyT' || e.key === '/') && !e.repeat) { if (handlers.chat(e.key === '/' ? '/' : '')) e.preventDefault(); return; }
    if (e.code === 'KeyF' && !e.repeat) { const el = document.getElementById('fps'); if (el) el.hidden = !el.hidden; return; }
    if (e.code === 'KeyZ' && !e.repeat) { CAM.first = !CAM.first; e.preventDefault(); return; }   // primera o tercera persona
    Audio.start();
    if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.run = true;
    if (/^Digit[1-9]$/.test(e.code)) handlers.select(+e.code.slice(5) - 1);
    if (e.code === 'KeyR' && !e.repeat) handlers.rotate();
    if ((e.code === 'KeyX' || e.code === 'Delete' || e.code === 'Backspace') && !e.repeat) handlers.erase();
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) handlers.jump(); }   // saltar (con un diálogo abierto, seguir)
    if ((e.code === 'KeyE' || e.code === 'Enter') && !e.repeat) { e.preventDefault(); handlers.interact(); }
  });
  addEventListener('keyup', e => {
    if (held.delete(e.code)) camAxes();
    if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.run = false;
  });
  addEventListener('blur', clearKeys);

  // Ratón sobre el juego: clic para usar (mantener para seguir), rueda para cambiar de objeto.
  // En modo construcción, el ratón (o el dedo) apunta a la casilla: clic pone, clic derecho quita, arrastrar pinta.
  const canvas = document.getElementById('c');
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse') handlers.hover?.(e.clientX, e.clientY);   // la casilla bajo el ratón (para colocar)
    if (!handlers.building?.()) return;
    handlers.point(e.clientX, e.clientY);
    if (e.buttons === 1) handlers.paint(e.clientX, e.clientY, true);
    else if (e.buttons === 2) handlers.unpaint(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerdown', e => {
    if (!handlers.enabled()) return;
    Audio.start();
    if (handlers.building?.()) {
      handlers.point(e.clientX, e.clientY);
      if (e.button === 2) handlers.unpaint(e.clientX, e.clientY); else handlers.paint(e.clientX, e.clientY, false);
      return;
    }
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    keys.use = true;
    handlers.use();
  });
  addEventListener('pointerup', e => { if (e.pointerType === 'mouse') keys.use = false; handlers.release?.(); });
  let wheelAt = 0;
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    // Ctrl + rueda (o pellizcar el panel táctil): acercar o alejar la cámara; la rueda sola cambia de objeto
    if (e.ctrlKey) { CAM.dist = Math.max(DIST.min, Math.min(DIST.max, CAM.dist * Math.exp(e.deltaY * 0.01))); return; }
    if (!handlers.enabled() || performance.now() - wheelAt < 60) return;
    wheelAt = performance.now();
    handlers.cycle(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  // Botones táctiles
  document.querySelectorAll('[data-k]').forEach(b => {
    const k = b.dataset.k;
    const up = () => { b.classList.remove('on'); if (k in keys) keys[k] = false; };
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (k === 'bag') { handlers.bag(); return; }
      if (k === 'build') { handlers.build(); return; }
      if (k === 'pause') { handlers.pause(); return; }
      if (k === 'craft') { handlers.craft(); return; }
      if (!handlers.enabled()) return;
      Audio.start();
      b.classList.add('on');
      if (k === 'act') handlers.interact();
      else if (k === 'use') { keys.use = true; handlers.use(); }
      else if (k === 'jump') handlers.jump();
      else keys[k] = true;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => b.addEventListener(t, up));
  });
}
