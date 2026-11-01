// Barra rápida (las 9 primeras casillas) y la pantalla de la mochila, con arrastrar y soltar.
import { ITEMS } from '../items.js';
import { SLOTS, HOTBAR } from '../inventory.js';
import { itemIconUrl } from '../art/items.js';

const $ = id => document.getElementById(id);

function slotEl(i, cls) {
  const el = document.createElement('div');
  el.className = cls;
  el.dataset.i = i;
  el.innerHTML = '<img alt="" draggable="false"><b></b>';
  return el;
}
function paint(el, s) {
  const img = el.querySelector('img'), n = el.querySelector('b');
  if (s) {
    const url = itemIconUrl(s.id);
    if (img.getAttribute('src') !== url) img.src = url;
    img.hidden = false;
    n.textContent = s.n > 1 ? s.n : '';
    el.title = ITEMS[s.id].name;
  } else {
    img.hidden = true;
    n.textContent = '';
    el.title = '';
  }
}

export function initInventoryUI(game, { onClose, onCraft }) {
  // ---------- Barra rápida ----------
  const bar = $('hotbar-slots'), hb = [];
  for (let i = 0; i < HOTBAR; i++) {
    const el = slotEl(i, 'slot');
    el.insertAdjacentHTML('beforeend', `<i>${i + 1}</i>`);
    el.addEventListener('pointerdown', e => { e.preventDefault(); game.inv.select(i); });
    bar.append(el);
    hb.push(el);
  }

  // ---------- Mochila ----------
  const grid = $('inv-grid'), quick = $('inv-quick'), cells = [];
  for (let i = 0; i < SLOTS; i++) {
    const el = slotEl(i, 'slot');
    (i < HOTBAR ? quick : grid).append(el);
    cells[i] = el;
  }
  let picked = null;   // casilla elegida para ver sus detalles

  // ---------- Todos los objetos (modo admin) ----------
  // Tocar uno da un montón entero; si la mochila está llena, va a la casilla de la mano
  const all = $('inv-all-grid');
  for (const id of Object.keys(ITEMS)) {
    const el = slotEl(-1, 'slot');
    paint(el, { id, n: 1 });
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      const inv = game.inv, n = ITEMS[id].stack;
      if (inv.add(id, n) === n) { inv.slots[inv.selected] = { id, n }; inv.changed(); }
      picked = inv.slots.findIndex(s => s?.id === id);
      refresh();
    });
    all.append(el);
  }

  function refresh() {
    const inv = game.inv;
    hb.forEach((el, i) => { paint(el, inv.slots[i]); el.classList.toggle('sel', i === inv.selected); });
    if (!$('s-inv').classList.contains('show')) return;
    cells.forEach((el, i) => { paint(el, inv.slots[i]); el.classList.toggle('sel', i === picked); });
    const s = picked !== null && inv.slots[picked], def = s && ITEMS[s.id];
    $('inv-info').classList.toggle('empty', !s);
    if (!s) { $('inv-name').textContent = 'Toca un objeto para ver qué es'; $('inv-desc').textContent = 'Arrástralo para moverlo. Suéltalo fuera de la mochila para tirarlo.'; return; }
    $('inv-icon').src = itemIconUrl(s.id);
    $('inv-name').textContent = def.name + (s.n > 1 ? ` ×${s.n}` : '');
    $('inv-desc').textContent = def.desc + (def.food ? ` Da ${def.food} de energía.` : '');
    $('inv-eat').hidden = !def.food;
    $('inv-drop1').hidden = s.n < 2;
  }

  $('inv-eat').onclick = () => { if (picked !== null) game.gather.eat(picked); };
  const drop = (i, n) => {
    const s = game.inv.slots[i];
    if (s && game.gather.throwOut(s.id, Math.min(n, s.n))) game.inv.take(i, n, true);
    else if (s) $('inv-desc').textContent = 'Aquí dentro no: sal de casa para tirar cosas.';
  };
  $('inv-drop1').onclick = () => { if (picked !== null) drop(picked, 1); };
  $('inv-drop').onclick = () => { if (picked !== null) drop(picked, Infinity); };
  $('inv-close').onclick = () => onClose();
  $('inv-craft').onclick = () => onCraft();

  // Arrastrar y soltar (ratón y dedo)
  let drag = null;
  const ghost = $('inv-ghost');
  for (const el of cells) {
    el.addEventListener('pointerdown', e => {
      const i = +el.dataset.i;
      if (!game.inv.slots[i]) { picked = null; refresh(); return; }
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      drag = { i, x: e.clientX, y: e.clientY, moving: false };
    });
    el.addEventListener('pointermove', e => {
      if (!drag) return;
      if (!drag.moving && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) {
        drag.moving = true;
        ghost.src = itemIconUrl(game.inv.slots[drag.i].id);
        ghost.hidden = false;
        cells[drag.i].classList.add('lift');
      }
      if (drag.moving) { ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px'; }
    });
    el.addEventListener('pointerup', e => {
      if (!drag) return;
      const d = drag;
      drag = null;
      ghost.hidden = true;
      cells[d.i].classList.remove('lift');
      if (!d.moving) { picked = d.i; refresh(); return; }
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const to = under?.closest('#inv-grid .slot, #inv-quick .slot');
      if (to) { game.inv.move(d.i, +to.dataset.i); picked = +to.dataset.i; refresh(); }
      else if (!under?.closest('.inv-panel')) drop(d.i, Infinity);
    });
    el.addEventListener('pointercancel', () => { drag = null; ghost.hidden = true; cells.forEach(c => c.classList.remove('lift')); });
  }

  return {
    refresh,
    open() { picked = null; refresh(); },
  };
}
