// Teclado, ratón y controles táctiles. Guarda qué está pulsado y avisa de las acciones.
import { Audio } from './audio.js';

// use: el botón de usar se mantiene pulsado (para seguir talando sin repetir la tecla)
export const keys = { up: false, down: false, left: false, right: false, run: false, use: false };
const handlers = { chat: () => false, use: () => {}, interact: () => {}, pause: () => {}, map: () => {}, bag: () => {}, craft: () => {}, build: () => {}, rotate: () => {}, erase: () => {}, select: () => {}, cycle: () => {}, enabled: () => false };
const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };

export function clearKeys() { for (const k in keys) keys[k] = false; }

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
    // Girar la cámara: flecha izquierda y derecha (en el juego no mueven; con el mapa abierto, sí lo mueven)
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { if (!e.repeat) handlers.turnCamera?.(e.code === 'ArrowRight' ? 1 : -1); e.preventDefault(); return; }
    // Chat: T lo abre; / lo abre con la barra ya escrita (sin que la tecla se escriba dos veces)
    if ((e.code === 'KeyT' || e.key === '/') && !e.repeat) { if (handlers.chat(e.key === '/' ? '/' : '')) e.preventDefault(); return; }
    Audio.start();
    if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.run = true;
    if (/^Digit[1-9]$/.test(e.code)) handlers.select(+e.code.slice(5) - 1);
    if (e.code === 'KeyR' && !e.repeat) handlers.rotate();
    if ((e.code === 'KeyX' || e.code === 'Delete' || e.code === 'Backspace') && !e.repeat) handlers.erase();
    if (e.code === 'Space' && !e.repeat) { e.preventDefault(); keys.use = true; handlers.use(); }
    if ((e.code === 'KeyE' || e.code === 'Enter') && !e.repeat) { e.preventDefault(); handlers.interact(); }
  });
  addEventListener('keyup', e => {
    if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.run = false;
    if (e.code === 'Space') keys.use = false;
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
      else keys[k] = true;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => b.addEventListener(t, up));
  });
}
