// Teclado, ratón y controles táctiles. Guarda qué está pulsado y avisa de las acciones.
import { Audio } from './audio.js';
import { CAM, DIST, lookBy } from './camera.js';

// use: el botón de usar se mantiene pulsado (para seguir talando sin repetir la tecla)
// dive: Shift held (swimming, it dives: entities.js diveStep; down is S, backwards, and has nothing to do with it)
// run: W held after a second tap (jog, or sprint with sprint too). sprint: W held after a third tap. See pressW and gaitOf.
// mapFast: on the map, Shift held (it moves faster; its own key, so it never leaves a jog behind when the map closes)
export const keys = { up: false, down: false, left: false, right: false, run: false, sprint: false, use: false, space: false, dive: false, mapFast: false };
const handlers = { chat: () => false, use: () => {}, jump: () => {}, interact: () => {}, pause: () => {}, map: () => {}, bag: () => {}, craft: () => {}, build: () => {}, rotate: () => {}, erase: () => {}, select: () => {}, cycle: () => {}, enabled: () => false };
// Greeting (social.js): Y, or right click on a person; a tap greets, held it provokes
export const SOCIAL_KEY = 'KeyY', SOCIAL_BUTTON = 2;
let socialBtn = false;   // (the right button went to a greeting: its letting go ends it)
const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
// En el juego las flechas mueven la cámara (girar e inclinar) y + y − la acercan o alejan; mientras se
// mantienen, la cámara se mueve suave. Con el mapa abierto, las flechas mueven el mapa como WASD.
const CAMKEYS = { ArrowLeft: ['turn', 1], ArrowRight: ['turn', -1], ArrowUp: ['tilt', 1], ArrowDown: ['tilt', -1] };
// Primera persona, como en Minecraft: el ratón (o el panel táctil) mueve la cámara y se apunta con la cruceta. Para eso se
// captura el puntero (pointer lock): al abrir un menú o un diálogo se suelta y al volver se recoge; con Esc se suelta
// y se abre la pausa. want: se quiere capturar; locked: capturado; asked: ya se ha pedido (si falla, un clic lo pide)
export const aimLock = { want: false, locked: false, asked: false, freed: false, exitAt: 0 };
const askLock = () => { const c = document.getElementById('c'); aimLock.asked = true; try { c.requestPointerLock?.()?.catch?.(() => {}); } catch { /* (sin puntero que capturar) */ } };
export function syncLook(can) {
  const want = aimLock.want = !!(CAM.first && can && !(document.activeElement instanceof HTMLInputElement));
  document.body.classList.toggle('aiming', want);
  document.body.classList.toggle('aim-free', want && !aimLock.locked);
  if (!want) { aimLock.asked = false; if (aimLock.locked) { aimLock.freed = true; document.exitPointerLock?.(); } }
  else if (!aimLock.locked && !aimLock.asked) askLock();
}
const held = new Map();   // tecla → [eje, sentido]
function camAxes() {
  CAM.turn = CAM.tilt = CAM.zoom = 0;
  for (const [axis, d] of held.values()) CAM[axis] = Math.max(-1, Math.min(1, CAM[axis] + d));
}
// Three speeds, as in GTA: W walks; a second press soon after the first (a tap, then press and hold) jogs, and a third
// press soon after the second (tap, tap, press and hold) sprints. Letting go of W goes back to walking: the next press
// walks unless it comes soon after a tap. A press counts as "soon" within TAP_WINDOW of the press before, or within
// TAP_GAP of letting go when that press was a tap (held up to TAP_HOLD: a slow tap). Key repeat never counts. The
// times are the events' own (e.timeStamp), so a long frame does not stretch or squeeze the taps.
// Crouching, the second tap of W stands up too, and jogs
export const TAP_WINDOW = 350, TAP_GAP = 250, TAP_HOLD = 300;   // ms
const W_TAPS = { down: -1e9, up: -1e9, tier: 0, held: false };
// Shift is the posture key (rest.js posture): a tap (let go before SHIFT_HOLD) acts when it is let go, a hold acts when
// SHIFT_HOLD is reached (or, if the timer was late, when it is let go). Only Shift alone: with another key pressed meanwhile
// (Shift+R, Shift+Q, the map's fast move) it is neither. Swimming (handlers.swimming), a hold dives (keys.dive, held) and
// a tap does nothing. Times are the events' own (e.timeStamp, the clock of performance.now()): a long frame between the
// keydown and the keyup does not turn a quick tap into a hold. The hold's timer, if it fires late (that long frame), waits
// once more (SHIFT_LATE) so that a keyup already queued is read first
export const SHIFT_HOLD = 300, SHIFT_LATE = 80;   // ms
export const HOLD_X = 0.3;   // s: X held, for what is not undone (ui/prompts.js: an action's alt.hold)
const SHIFT = { down: null, alone: false, done: false, timer: 0, late: false };
export function pressShift(now = performance.now()) {
  const S = SHIFT;
  clearTimeout(S.timer);
  Object.assign(S, { down: now, alone: true, done: false, late: false });
  keys.dive = true;
}
// The hold's timer (the keydown arms it): on time, the hold acts; late, it looks again a little later (a keyup in between
// decides by its own time)
function shiftTimer() {
  const S = SHIFT, now = performance.now();
  if (S.down === null) return;
  if (!S.late && now - S.down > SHIFT_HOLD + SHIFT_LATE) { S.late = true; S.timer = setTimeout(shiftTimer, 30); return; }
  shiftTick(now);
}
// A posture that changed (rest.js posture says so) stops the running; one that did nothing (walking, on a horse, in a
// boat) leaves the gait as it was
const posture = hold => { if (handlers.posture?.(hold)) walkOnly(); };
export function shiftWithOther() { SHIFT.alone = false; }
export function shiftTick(now = performance.now()) {
  const S = SHIFT;
  if (S.down === null || !S.alone || S.done || now - S.down < SHIFT_HOLD) return;
  S.done = true;
  if (!handlers.enabled() || handlers.mapOpen?.() || handlers.swimming?.()) return;
  posture(true);
}
export function releaseShift(now = performance.now()) {
  const S = SHIFT;
  clearTimeout(S.timer);
  keys.dive = false;
  if (S.down !== null && S.alone && !S.done) {
    shiftTick(now);
    if (!S.done && handlers.enabled() && !handlers.mapOpen?.() && !handlers.swimming?.()) posture(false);
  }
  Object.assign(S, { down: null, alone: false, done: false, late: false });
}
function forgetShift() { clearTimeout(SHIFT.timer); Object.assign(SHIFT, { down: null, alone: false, done: false, late: false }); }
// The tier the keys ask for: 0 walk, 1 jog, 2 sprint (entities.js gates it: a load, the wheelbarrow, exhaustion)
export const gaitOf = k => (k.run ? (k.sprint ? 2 : 1) : 0);
export function pressW(now = performance.now()) {
  const T = W_TAPS;
  if (T.held) return;   // (a second keydown without its keyup: the press already counted)
  const soon = now - T.down <= TAP_WINDOW || (now - T.up <= TAP_GAP && T.up - T.down <= TAP_HOLD);
  T.tier = soon ? Math.min(2, T.tier + 1) : 0;
  T.down = now; T.held = true;
  keys.run = T.tier >= 1; keys.sprint = T.tier === 2;
  if (T.tier === 1) handlers.crouch?.(false);   // (crouching, the second tap stands up, jogging)
}
export function releaseW(now = performance.now()) {
  const T = W_TAPS;
  if (T.held) T.up = now;
  T.held = false;
  keys.run = keys.sprint = false;
}
// Out of breath while sprinting (needs.js, through game.update): down to a jog; sprinting again needs three new taps
export function dropSprint() { if (W_TAPS.tier === 2) W_TAPS.tier = 1; keys.sprint = false; }
// A Shift posture (crouching, sitting) or anything else that stops the running: walking, and the taps start again
function walkOnly() { W_TAPS.tier = 0; W_TAPS.down = W_TAPS.up = -1e9; keys.run = keys.sprint = false; }
// An event's own time, on performance.now()'s clock (0 or a time from the future, as some synthetic events have: now)
const evTime = e => { const n = performance.now(), t = e.timeStamp; return t > 0 && t <= n ? t : n; };
const zoomOf = e => (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd' ? -1 : e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract' ? 1 : 0);

export function clearKeys() { for (const k in keys) keys[k] = false; walkOnly(); W_TAPS.held = false; forgetShift(); held.clear(); camAxes(); }
// Letting go of W (or A, S, D) always stops: macOS sends no keyup for a key let go while Cmd is down, so letting go of Cmd
// lets go of the movement keys too (one still held comes back with its next key repeat)
function releaseMoves() { keys.up = keys.down = keys.left = keys.right = false; releaseW(); }

export function initInput(h) {
  Object.assign(handlers, h);

  addEventListener('keydown', e => {
    if (handlers.frontKey?.(e)) return;   // (a menu screen is open: ui/frontend.js)
    if (e.target instanceof HTMLInputElement) return;
    // The tool wheel open (src/ui/wheel.js): Esc cancels it (without the pause), a digit equips that slot, walking,
    // running, crouching and jumping go on as always, and nothing else does anything (the hand is on the mouse: an E
    // by mistake would open a door)
    if (handlers.wheelOpen?.()) {
      if (e.code === 'Escape') { e.preventDefault(); handlers.wheelCancel?.(); return; }
      if (/^Digit[1-9]$/.test(e.code)) { e.preventDefault(); handlers.wheelPick?.(+e.code.slice(5) - 1); return; }
      if (e.code === 'Tab' || e.code === 'KeyF') { e.preventDefault(); return; }
      if (!(KEYMAP[e.code] || e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'Space')) return;
    }
    if (e.code === 'Escape') {
      if (aimLock.locked || performance.now() - aimLock.exitAt < 400) return;   // (Esc suelta el puntero y eso ya abre la pausa)
      if (handlers.pause()) e.preventDefault();
      return;
    }
    if (e.code === 'KeyP' && !e.repeat && !e.metaKey && !e.ctrlKey) { if (handlers.pause()) e.preventDefault(); return; }   // (P: the pause too)
    if (e.code === 'KeyM' && !e.repeat) { if (handlers.map()) e.preventDefault(); return; }
    if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat) handlers.players?.(true); return; }   // (mantenido: quién está jugando)
    if (e.code === 'KeyI' && !e.repeat) { if (handlers.bag()) e.preventDefault(); return; }
    if (e.code === 'KeyC' && !e.repeat) { if (handlers.craft()) e.preventDefault(); return; }
    if (e.code === 'KeyB' && !e.repeat) { if (handlers.build()) e.preventDefault(); return; }
    if (e.code === 'KeyJ' && !e.repeat) { if (handlers.journal?.()) e.preventDefault(); return; }
    // Con el mapa abierto, WASD, flechas y Shift mueven el mapa
    if (handlers.mapOpen?.()) {
      if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.mapFast = true;
      if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') { handlers.mapZoom?.(1); e.preventDefault(); }
      if (e.key === '-' || e.code === 'NumpadSubtract') { handlers.mapZoom?.(-1); e.preventDefault(); }
      return;
    }
    if (!handlers.enabled()) return;
    const isShift = e.code === 'ShiftLeft' || e.code === 'ShiftRight';
    if (isShift && !e.repeat) { pressShift(evTime(e)); SHIFT.timer = setTimeout(shiftTimer, SHIFT_HOLD + 5); }
    else if (!isShift && !e.repeat) shiftWithOther();   // (a held W's key repeat is not another key)
    if (isShift) keys.dive = true;   // (held: swimming, down; it never runs)
    // La cámara: flechas para girarla e inclinarla, + y − para acercarla (Cmd/Ctrl + sigue siendo el zoom del navegador)
    // (en primera persona la cámara va con el ratón: las flechas andan, como WASD)
    if (CAMKEYS[e.code] && !(CAM.first && document.getElementById('c').requestPointerLock)) { held.set(e.code, CAMKEYS[e.code]); camAxes(); e.preventDefault(); return; }
    if (zoomOf(e) && !e.metaKey && !e.ctrlKey) { held.set(e.code, ['zoom', zoomOf(e)]); camAxes(); e.preventDefault(); return; }
    // Chat: T lo abre; / lo abre con la barra ya escrita (sin que la tecla se escriba dos veces)
    if ((e.code === 'KeyT' || e.key === '/') && !e.repeat) { if (handlers.chat(e.key === '/' ? '/' : '')) e.preventDefault(); return; }
    if (e.code === 'F3') { e.preventDefault(); if (!e.repeat) handlers.debug?.(); return; }   // (el panel de depuración, como en Minecraft)
    // F held: the tool wheel; a tap, back to what you held before (not with Cmd or Ctrl: Cmd+F is the browser's search)
    if (e.code === 'KeyF' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); if (!e.repeat) handlers.wheelPress?.(); return; }
    if (e.code === SOCIAL_KEY && !e.metaKey && !e.ctrlKey) { e.preventDefault(); if (!e.repeat) handlers.social?.(true, 'key'); return; }   // (greet; held, provoke)
    if (e.code === 'KeyZ' && !e.repeat) { CAM.first = !CAM.first; e.preventDefault(); return; }   // primera o tercera persona
    if (e.code === 'KeyQ' && !e.repeat) { handlers.drop?.(e.ctrlKey || e.metaKey || e.shiftKey); e.preventDefault(); return; }   // tirar (con Ctrl o Shift, el montón)
    Audio.start();
    // (after Audio.start: the whistle is heard) The horse (Plan F): N whistles for it from anywhere; riding, G pats it and H rears (on foot G and H do nothing yet)
    if (e.code === 'KeyN' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); if (!e.repeat) handlers.whistle?.(); return; }
    if ((e.code === 'KeyG' || e.code === 'KeyH') && !e.metaKey && !e.ctrlKey && !e.repeat) { if (handlers.ride?.(e.code === 'KeyG' ? 'pat' : 'rear')) e.preventDefault(); return; }
    if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
    if (e.code === 'KeyW' && !e.repeat) pressW(evTime(e));
    if (/^Digit[1-9]$/.test(e.code)) handlers.select(+e.code.slice(5) - 1);
    if (e.code === 'KeyR' && !e.repeat) handlers.rotate(e.shiftKey ? -1 : 1);   // (lo libre gira mientras se mantiene)
    if (e.code === 'KeyV' && !e.repeat) handlers.size?.();
    if ((e.code === 'KeyX' || e.code === 'Delete' || e.code === 'Backspace') && !e.repeat) handlers.erase();
    if (e.code === 'Space') { e.preventDefault(); keys.space = true; if (!e.repeat) handlers.jump(); }   // saltar (con un diálogo abierto, seguir)
    if ((e.code === 'KeyE' || e.code === 'Enter') && !e.repeat) { e.preventDefault(); handlers.interact(); }
  });
  addEventListener('keyup', e => {
    if (held.delete(e.code)) camAxes();
    if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false;
    if (e.code === 'KeyW') releaseW(evTime(e));
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      keys.mapFast = false;
      if (handlers.mapOpen?.()) { keys.dive = false; forgetShift(); }   // (con el mapa, Shift lo mueve más rápido)
      else releaseShift(evTime(e));   // (the posture: a tap; swimming, nothing, and a fast swim goes on)
    }
    if (e.key === 'Meta') releaseMoves();
    if (e.code === 'Space') keys.space = false;
    if (e.code === 'KeyR') handlers.rotateEnd?.();
    if (e.code === 'KeyX' || e.code === 'Delete' || e.code === 'Backspace') handlers.eraseEnd?.();
    if (e.code === 'Tab') handlers.players?.(false);
    if (e.code === 'KeyF') handlers.wheelRelease?.();
    if (e.code === SOCIAL_KEY) handlers.social?.(false, 'key');
  });
  addEventListener('blur', () => { handlers.wheelCancel?.(true); handlers.socialCancel?.(); handlers.eraseEnd?.(); socialBtn = false; clearKeys(); });

  // Ratón sobre el juego: clic para usar (mantener para seguir), rueda para cambiar de objeto.
  // En modo construcción, el ratón (o el dedo) apunta a la casilla: clic pone, clic derecho quita, arrastrar pinta.
  const canvas = document.getElementById('c');
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    const was = aimLock.locked;
    aimLock.locked = document.pointerLockElement === canvas;
    if (was && !aimLock.locked) {
      if (!aimLock.freed && aimLock.want) { handlers.wheelCancel?.(); aimLock.exitAt = performance.now(); handlers.pause(); clearKeys(); }   // (lo ha soltado Esc; the tool wheel, if open, closes first)
      aimLock.freed = false;
    }
  });
  canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !aimLock.locked) handlers.mouse?.(e.clientX, e.clientY, false); });
  // (with the tool wheel open the mouse is its own: wheel.js stops these on window before they get here; just in case)
  canvas.addEventListener('pointermove', e => {
    if (handlers.wheelOpen?.()) return;
    if (aimLock.locked) { if (Math.abs(e.movementX) < 300 && Math.abs(e.movementY) < 300) lookBy(e.movementX, e.movementY); return; }   // (a veces da saltos enormes: se ignoran)
    if (e.pointerType === 'mouse') { handlers.mouse?.(e.clientX, e.clientY, true); handlers.hover?.(e.clientX, e.clientY); }   // la casilla bajo el ratón (para colocar)
    if (!handlers.building?.()) return;
    handlers.point(e.clientX, e.clientY);
    if (e.buttons === 1) handlers.paint(e.clientX, e.clientY, true);
    else if (e.buttons === 2) handlers.unpaint(e.clientX, e.clientY, true);
  });
  canvas.addEventListener('pointerdown', e => {
    if (handlers.wheelOpen?.()) return;
    shiftWithOther();   // (Shift+clic no agacha ni se sienta)
    if (!handlers.enabled()) return;
    Audio.start();
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();   // (si se escribía en un buscador, WASD vuelve a mover)
    if (e.pointerType === 'mouse' && aimLock.want && !aimLock.locked) { askLock(); return; }   // (este clic es para capturar el puntero)
    if (handlers.building?.()) {
      handlers.point(e.clientX, e.clientY);
      if (e.button === 2) handlers.unpaint(e.clientX, e.clientY); else handlers.paint(e.clientX, e.clientY, false);
      return;
    }
    // (right click: on a person, greet them, held, provoke them, social.js; on nobody, sit the dog down)
    if (e.pointerType === 'mouse' && e.button === SOCIAL_BUTTON) {
      const x = aimLock.locked ? innerWidth / 2 : e.clientX, y = aimLock.locked ? innerHeight / 2 : e.clientY;
      if (handlers.social?.(true, 'mouse', x, y) === true) { socialBtn = true; return; }
      handlers.secondary?.(x, y);
      return;
    }
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    keys.use = true;
    handlers.use();
  });
  addEventListener('pointerup', e => { if (e.pointerType === 'mouse') keys.use = false; if (socialBtn && e.button === SOCIAL_BUTTON) { socialBtn = false; handlers.social?.(false, 'mouse'); } handlers.release?.(); });
  let wheelAt = 0;
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    // Ctrl + rueda (o pellizcar el panel táctil): acercar o alejar la cámara; la rueda sola cambia de objeto
    if (handlers.wheelOpen?.()) return;
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
