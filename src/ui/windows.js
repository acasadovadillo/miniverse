// Las ventanas de la partida (mochila, fabricar, diario, cofre): se abren encima del mundo sin parar el juego, así que se
// puede seguir andando con ellas abiertas. Se arrastran por el título y recuerdan su sitio en cada navegador. La chincheta
// decide qué pasa al sacar el cursor: fijada, se queda como está; sin fijar, se recoge y solo se ve el título hasta que
// vuelve el cursor. Esc cierra la de encima. En una pantalla táctil van entre los controles, que siguen a mano; en una
// estrecha, abajo; en las dos, no se mueven.
const $ = id => document.getElementById(id);
const KEY = 'pueblo-brotes:ventanas', COLLAPSE_AFTER = 400, BASE_Z = 11, MARGIN = 8, RAIL = 74, TITLE_H = 44;
const fixedLayout = () => matchMedia('(pointer: coarse), (max-width: 700px)').matches;

function loadSaved() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }

export function initWindows(game) {
  const wins = new Map(), saved = loadSaved();
  let order = [];   // las abiertas, la última, la de encima
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* (sin almacenamiento: se olvida al recargar) */ } };
  const changed = () => { game.windowsOpen = order.length > 0; };
  function stack() { order.forEach((id, i) => { wins.get(id).el.style.zIndex = BASE_Z + i; }); }
  function front(id) { order = [...order.filter(x => x !== id), id]; stack(); }
  // Ponerla donde toca, sin que se salga: siempre queda a la vista su título
  function place(w) {
    const { el, spot } = w;
    if (fixedLayout()) { el.style.left = el.style.top = el.style.maxHeight = ''; return; }
    const r = el.getBoundingClientRect();
    if (!r.width) return;   // (oculta, en la pausa, el mapa o una tienda: se coloca al volver)
    const s = saved[w.id] || {}, [dx, dy] = spot(r.width, r.height);
    // (entera en la pantalla, si cabe; si no, con el título a la vista y lo demás con su barra)
    const x = Math.max(MARGIN, Math.min(innerWidth - r.width - MARGIN, s.x ?? dx)), y = Math.max(MARGIN, Math.min(innerHeight - r.height - MARGIN, s.y ?? dy));
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    fit(el, y);
  }
  // Lo que puede medir, según dónde queda: así siempre se llega a su final con la barra
  const fit = (el, top) => { el.style.maxHeight = `${Math.max(TITLE_H * 3, innerHeight - top - MARGIN)}px`; };
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
        el.classList.add('collapsed');
        if (el.contains(document.activeElement)) document.activeElement.blur();   // (lo que se siga tecleando no va a un buscador oculto)
      }, COLLAPSE_AFTER);
    });
    el.addEventListener('pointerenter', () => { clearTimeout(w.timer); el.classList.remove('collapsed'); });
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
    defaults: { left: () => [RAIL, 56], right: w => [innerWidth - w - 16, 56], center: (w, h) => [(innerWidth - w) / 2, Math.max(MARGIN, (innerHeight - h) / 2)] },
  };
}
