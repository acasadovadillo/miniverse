// Las ventanas de la partida (mochila, fabricar, cofre): se abren encima del mundo sin parar el juego, así que se
// puede seguir andando con ellas abiertas. Se arrastran por el título y recuerdan su sitio en cada navegador. La chincheta
// decide qué pasa al sacar el cursor: fijada, se queda como está; sin fijar, se recoge y solo se ve el título hasta que
// vuelve el cursor. Esc cierra la de encima. En una pantalla táctil van entre los controles, que siguen a mano; en una
// estrecha, abajo; en las dos, no se mueven.
const $ = id => document.getElementById(id);
const KEY = 'pueblo-brotes:ventanas', COLLAPSE_AFTER = 400, BASE_Z = 11, MARGIN = 8, EDGE = 16, GAP = 8, TITLE_H = 44;   // (EDGE: the HUD's corner margin)
const SLIDE = new Set(['clockp', 'quest', 'body-chip', 'hud-left']);   // (what slides with the bars over it)
const fixedLayout = () => matchMedia('(pointer: coarse), (max-width: 700px)').matches;

function loadSaved() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }

export function initWindows(game) {
  const wins = new Map(), saved = loadSaved();
  let order = [];   // las abiertas, la última, la de encima
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* (sin almacenamiento: se olvida al recargar) */ } };
  const changed = () => { game.windowsOpen = order.length > 0; document.body.classList.toggle('win-open', game.windowsOpen); cover(); };
  // The clock, the first steps and the body chip at the top left hide while an open window lies over them (the windows
  // are a little see-through: the clock's text would show through the title), and come back when it goes, folds or moves away
  function cover() {
    const rs = order.map(id => wins.get(id).el.getBoundingClientRect()).filter(r => r.width);
    for (const el of [$('clockp'), $('quest'), $('body-chip'), $('hud-right')]) {
      if (!el) continue;
      const was = el.classList.contains('under-win');
      if (was) el.classList.remove('under-win');   // (measured where it would be)
      const b = el.getBoundingClientRect();
      el.classList.toggle('under-win', !!b.width && rs.some(r => r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom));
    }
  }
  // (and again when they have slid to a new place: the bars over them came or went, index.html --hud-top)
  addEventListener('transitionend', e => { if (e.propertyName === 'top' && SLIDE.has(e.target.id)) cover(); });
  function stack() { order.forEach((id, i) => { wins.get(id).el.style.zIndex = BASE_Z + i; }); }
  function front(id) { order = [...order.filter(x => x !== id), id]; stack(); }
  // What no window covers at the top left, in survival: the status bars, with every row an open window shows (where they
  // end, page y: ui/needsbar.js; 0, none: creative, spectator)
  const barsEnd = () => game.needsBar?.bottomAll?.() || 0;
  // How low a window from x, w wide, can end: 6 px over the minimap and the hotbar, where they are under it (so the
  // inventory still fits under the clock at 1280 × 800)
  function bottomLimit(x, w) {
    let lim = innerHeight - MARGIN;
    for (const id of ['minimap', 'hotbar']) {
      const r = $(id)?.getBoundingClientRect();
      if (r?.width && r.left < x + w && x < r.right) lim = Math.min(lim, r.top - 6);
    }
    return lim;
  }
  // The left window: in the corner column, under the bars and the clock; if it does not fit there over the minimap and
  // the hotbar, right under the bars, covering the whole clock (never half of it; windows.js hides it then: cover()); on
  // a screen too short even for that, place() makes it end over them and scroll (you drag things to the hotbar from it)
  function leftSpot(w, h) {
    const bars = barsEnd(), ch = game.smartHud ? 0 : $('clockp')?.offsetHeight || 0, floor = bars ? bars + GAP : EDGE;
    // (the body chip in sight, right under the bars (ui/bodychip.js): the clock is under it, and so is the window)
    const bc = $('body-chip'), chip = bc?.classList.contains('on') ? bc.offsetHeight + GAP : 0;
    const under = floor + chip + (ch ? ch + GAP : 0);
    return [EDGE, under + h <= bottomLimit(EDGE, w) ? under : floor];
  }
  // Ponerla donde toca, sin que se salga: siempre queda a la vista su título
  function place(w) {
    const { el, spot } = w;
    if (fixedLayout()) { el.style.left = el.style.top = el.style.maxHeight = ''; return; }
    el.style.maxHeight = '';   // (measured at its full height: a cap from an earlier place would choose another spot)
    const r = el.getBoundingClientRect();
    if (!r.width) return;   // (oculta, en la pausa, el mapa o una tienda: se coloca al volver)
    const s = saved[w.id] || {}, [dx, dy] = spot(r.width, r.height);
    // (entera en la pantalla, si cabe; si no, con el título a la vista y lo demás con su barra)
    const x = Math.max(MARGIN, Math.min(innerWidth - r.width - MARGIN, s.x ?? dx));
    let y = Math.max(MARGIN, Math.min(innerHeight - r.height - MARGIN, s.y ?? dy));
    // (never over the status bars: a place saved before they went to the top left, or a tall window pushed up)
    const bars = barsEnd(), nr = bars && $('needs')?.getBoundingClientRect();
    if (nr && x < nr.right + GAP && y < bars + GAP) y = bars + GAP;
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    fit(el, y, spot === leftSpot && s.y == null ? bottomLimit(x, r.width) : innerHeight - MARGIN);
    cover();
  }
  // Lo que puede medir, según dónde queda: así siempre se llega a su final con la barra
  // (bottom: how low it may end; the left window in its own place, over the minimap and the hotbar)
  const fit = (el, top, bottom = innerHeight - MARGIN) => { el.style.maxHeight = `${Math.max(TITLE_H * 3, bottom - top)}px`; };
  function setPin(w, on) {
    w.pinned = on;
    w.pin.classList.toggle('on', on);
    w.pin.title = on ? 'Fijada: se queda abierta (clic para que se recoja al sacar el cursor)' : 'Sin fijar: se recoge al sacar el cursor (clic para fijarla)';
    w.pin.setAttribute('aria-pressed', on);
    if (on) { clearTimeout(w.timer); w.el.classList.remove('collapsed'); }
    (saved[w.id] ||= {}).unpinned = !on;
    persist();
  }
  function add(id, { close, spot, onOpen, onClose }) {
    const el = $(id), head = el.querySelector('h2'), w = { id, el, head, spot, onOpen, onClose, pinned: true, timer: 0 }, closer = $(close);
    // La chincheta, junto al botón de cerrar (en el mismo grupo)
    let group = closer.parentElement;
    if (group === head) { group = document.createElement('span'); head.append(group); group.append(closer); }
    w.pin = document.createElement('button');
    w.pin.type = 'button'; w.pin.className = 'sq win-pin'; w.pin.textContent = '📌'; w.pin.setAttribute('aria-label', 'Fijar');
    closer.before(w.pin);
    w.pin.onclick = () => setPin(w, !w.pinned);
    setPin(w, !saved[id]?.unpinned);
    wins.set(id, w);
    // Encima de las demás al tocarla; y sin quedarse el foco en un botón (Espacio saltaría y lo pulsaría otra vez)
    el.addEventListener('pointerdown', () => { if (isOpen(id)) front(id); }, true);
    el.addEventListener('click', () => { const a = document.activeElement; if (a instanceof HTMLButtonElement && el.contains(a)) a.blur(); });
    // Recogerse al salir el cursor, si no está fijada
    el.addEventListener('pointerleave', e => {
      if (w.pinned || e.pointerType !== 'mouse' || w.drag) return;
      clearTimeout(w.timer);
      w.timer = setTimeout(() => {
        el.classList.add('collapsed'); cover();
        if (el.contains(document.activeElement)) document.activeElement.blur();   // (lo que se siga tecleando no va a un buscador oculto)
      }, COLLAPSE_AFTER);
    });
    el.addEventListener('pointerenter', () => { clearTimeout(w.timer); if (el.classList.contains('collapsed')) { el.classList.remove('collapsed'); cover(); } });
    // Arrastrarla por el título
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('button, input') || fixedLayout() || e.button !== 0) return;
      const r = el.getBoundingClientRect();
      w.drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      try { head.setPointerCapture(e.pointerId); } catch { /* (un puntero que ya no está) */ }
      e.preventDefault();
    });
    head.addEventListener('pointermove', e => {
      if (!w.drag) return;
      const r = el.getBoundingClientRect();
      el.style.left = `${Math.max(MARGIN - r.width + 80, Math.min(innerWidth - 80, e.clientX - w.drag.dx))}px`;
      const top = Math.max(MARGIN, Math.min(innerHeight - TITLE_H, e.clientY - w.drag.dy));
      el.style.top = `${top}px`;
      fit(el, top);
      cover();
    });
    const endDrag = () => {
      if (!w.drag) return;
      w.drag = null;
      const r = el.getBoundingClientRect();
      if (!r.width) return;   // (se ha cerrado mientras se arrastraba: no hay sitio que recordar)
      Object.assign(saved[id] ||= {}, { x: Math.round(r.left), y: Math.round(r.top) });
      persist();
    };
    head.addEventListener('pointerup', endDrag);
    head.addEventListener('pointercancel', endDrag);
    return w;
  }
  function isOpen(id) { return order.includes(id); }
  function open(id) {
    const w = wins.get(id);
    clearTimeout(w.timer);
    w.el.classList.remove('collapsed');
    if (!isOpen(id)) { w.el.classList.add('show'); w.onOpen?.(); place(w); }
    front(id);
    changed();
  }
  function close(id) {
    if (!isOpen(id)) return false;
    const w = wins.get(id);
    order = order.filter(x => x !== id);
    w.el.classList.remove('show');
    w.drag = null;
    clearTimeout(w.timer);
    w.onClose?.();
    stack(); changed();
    return true;
  }
  const placeAll = () => { for (const id of order) place(wins.get(id)); };
  addEventListener('resize', placeAll);
  return {
    add, open, close, isOpen, placeAll,
    closeTop() { return order.length ? close(order.at(-1)) : false; },
    closeAll() { for (const id of [...order]) close(id); },
    // (the left one under the bars and the clock, at the top left: leftSpot)
    defaults: { left: leftSpot, right: w => [innerWidth - w - 16, 78], center: (w, h) => [(innerWidth - w) / 2, Math.max(MARGIN, (innerHeight - h) / 2)] },
  };
}
