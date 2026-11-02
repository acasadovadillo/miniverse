// Barra rápida (las 9 primeras casillas: manos y bolsillos) y la pantalla del inventario: el personaje en 3D
// con lo que lleva puesto, rodeado de los huecos del cuerpo (ropa y mochila), y las casillas, con arrastrar y
// soltar. Sin mochila, sus 27 casillas están cerradas.
import { ITEMS, WEAR_SLOTS } from '../items.js';
import { SLOTS, HOTBAR, extraOf } from '../inventory.js';
import { itemIconUrl } from '../art/items.js';
import { CharacterPreview } from '../three/preview.js';

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
    const url = itemIconUrl(s.id, s.color);
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

  // ---------- Casillas ----------
  const grid = $('inv-grid'), quick = $('inv-quick'), cells = [];
  for (let i = 0; i < SLOTS; i++) {
    const el = slotEl(i, 'slot');
    (i < HOTBAR ? quick : grid).append(el);
    cells[i] = el;
  }
  // ---------- Lo que se lleva puesto ----------
  // Los huecos a los dos lados del personaje, más o menos a la altura de lo que visten: a la izquierda la
  // ropa de fuera, de la cabeza a los pies; a la derecha la mochila, lo de encima y la ropa interior.
  // Vacíos, muestran en gris una prenda de ejemplo y su nombre.
  const wears = {}, LABEL = Object.fromEntries(WEAR_SLOTS);
  const SIDES = { 'inv-wear-l': ['cabeza', 'torso', 'piernas', 'pies'], 'inv-wear-r': ['espalda', 'encima', 'interiorArriba', 'interiorAbajo'] };
  const SAMPLE = { cabeza: 'sombrero', torso: 'camisa', encima: 'chaleco', piernas: 'pantalon', pies: 'botas', interiorArriba: 'camiseta_interior', interiorAbajo: 'calzoncillos', espalda: 'mochila' };
  for (const [col, slots] of Object.entries(SIDES)) for (const slot of slots) {
    const el = slotEl(-1, 'slot wear');
    el.dataset.wear = slot;
    el.insertAdjacentHTML('beforeend', `<img class="ph" alt="" draggable="false" src="${itemIconUrl(SAMPLE[slot])}"><i>${LABEL[slot]}</i>`);
    el.addEventListener('pointerdown', e => { e.preventDefault(); picked = game.inv.equip[slot] ? { wear: slot } : null; refresh(); });
    $(col).append(el);
    wears[slot] = el;
  }
  // El personaje en 3D, girando despacio (o arrastrándolo)
  const me = new CharacterPreview($('inv-me'));
  if (matchMedia('(max-width: 520px)').matches) me.resize(176, 206); else me.resize(164, 248);
  me.walk = false;
  let meLook = null, meAngle = 0.3, meDrag = null;
  $('inv-me').addEventListener('pointerdown', e => { meDrag = e.clientX; $('inv-me').setPointerCapture(e.pointerId); });
  $('inv-me').addEventListener('pointermove', e => { if (meDrag === null) return; meAngle += (e.clientX - meDrag) * 0.012; meDrag = e.clientX; });
  for (const ev of ['pointerup', 'pointercancel']) $('inv-me').addEventListener(ev, () => { meDrag = null; });
  let last = 0;
  (function spin(t) {
    if ($('s-inv').classList.contains('show')) {
      const look = game.appearance();
      if (look && look !== meLook) { meLook = look; me.setLook(look); }
      if (meDrag === null) meAngle += Math.min(0.05, (t - last) / 1000 || 0) * 0.35;
      me.setAngle(meAngle);
      me.render(t);
    }
    last = t;
    requestAnimationFrame(spin);
  })(0);

  let picked = null;   // casilla elegida (número) o hueco del cuerpo ({ wear }) para ver sus detalles

  // ---------- Todos los objetos (modo admin) ----------
  // Tocar uno da un montón entero; si no cabe, va a la casilla de la mano
  const all = $('inv-all-grid');
  for (const id of Object.keys(ITEMS)) {
    const el = slotEl(-1, 'slot');
    paint(el, { id, n: 1 });
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      const inv = game.inv, n = ITEMS[id].stack;
      if (inv.add(id, n) === n) { inv.slots[inv.selected] = { id, n, ...(ITEMS[id].wear && { color: ITEMS[id].dye }) }; inv.changed(); }
      picked = inv.slots.findIndex(s => s?.id === id);
      refresh();
    });
    all.append(el);
  }

  const say = text => { $('inv-desc').textContent = text; };
  function refresh() {
    const inv = game.inv;
    hb.forEach((el, i) => { paint(el, inv.slots[i]); el.classList.toggle('sel', i === inv.selected); });
    if (!$('s-inv').classList.contains('show')) return;
    cells.forEach((el, i) => { paint(el, inv.slots[i]); el.classList.toggle('sel', i === picked); el.classList.toggle('locked', !inv.usable(i)); });
    for (const [slot, el] of Object.entries(wears)) {
      const it = inv.equip[slot];
      paint(el, it && { ...it, n: 1 });
      if (!it) el.title = LABEL[slot];
      el.classList.toggle('on', !!it);
      el.classList.toggle('sel', picked?.wear === slot);
    }
    $('inv-grid').parentElement.classList.toggle('locked', inv.cap <= HOTBAR);
    const worn = picked?.wear, s = worn ? inv.equip[worn] && { ...inv.equip[worn], n: 1 } : picked !== null && inv.slots[picked], def = s && ITEMS[s.id];
    $('inv-info').classList.toggle('empty', !s);
    if (!s) { $('inv-name').textContent = 'Toca un objeto para ver qué es'; say('Arrástralo para moverlo, o a tu cuerpo para ponértelo. Suéltalo fuera para tirarlo.'); return; }
    $('inv-icon').src = itemIconUrl(s.id, s.color);
    $('inv-name').textContent = def.name + (s.n > 1 ? ` ×${s.n}` : '') + (worn ? ' (puesto)' : '');
    say(def.desc + (def.food ? ` Da ${def.food} de energía.` : ''));
    $('inv-wearbtn').hidden = !def.wear;
    $('inv-wearbtn').textContent = worn ? 'Quitármelo' : 'Ponérmelo';
    $('inv-eat').hidden = !def.food || !!worn;
    $('inv-drop1').hidden = s.n < 2 || !!worn;
    $('inv-drop').hidden = !!worn;
  }

  // Ponerse o quitarse lo elegido
  function wearPicked() {
    const inv = game.inv;
    if (picked?.wear) {
      const why = inv.unwear(picked.wear);
      if (why) { say(why); return; }
      picked = null;
    } else if (picked !== null && inv.wear(picked)) picked = null;
    refresh();
  }
  $('inv-wearbtn').onclick = wearPicked;
  $('inv-eat').onclick = () => { if (typeof picked === 'number') game.gather.eat(picked); };
  const drop = (i, n) => {
    const s = game.inv.slots[i];
    if (s && game.gather.throwOut(s.id, Math.min(n, s.n), extraOf(s))) game.inv.take(i, n, true);
    else if (s) say('Aquí dentro no: sal de casa para tirar cosas.');
  };
  $('inv-drop1').onclick = () => { if (typeof picked === 'number') drop(picked, 1); };
  $('inv-drop').onclick = () => { if (typeof picked === 'number') drop(picked, Infinity); };
  $('inv-close').onclick = () => onClose();
  $('inv-craft').onclick = () => onCraft();

  // Arrastrar y soltar (ratón y dedo): entre casillas, al cuerpo (ponérselo) o fuera (tirarlo)
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
        const s = game.inv.slots[drag.i];
        ghost.src = itemIconUrl(s.id, s.color);
        ghost.hidden = false;
        cells[drag.i].classList.add('lift');
        const w = ITEMS[s.id].wear;
        if (w) wears[w].classList.add('drop-ok');
      }
      if (drag.moving) { ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px'; }
    });
    el.addEventListener('pointerup', e => {
      if (!drag) return;
      const d = drag;
      drag = null;
      ghost.hidden = true;
      cells[d.i].classList.remove('lift');
      for (const w of Object.values(wears)) w.classList.remove('drop-ok');
      if (!d.moving) { picked = d.i; refresh(); return; }
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const to = under?.closest('#inv-grid .slot, #inv-quick .slot'), onBody = under?.closest('#inv-wear, #inv-me');
      if (to) { game.inv.move(d.i, +to.dataset.i); picked = +to.dataset.i; refresh(); }
      else if (onBody) { picked = d.i; if (ITEMS[game.inv.slots[d.i].id].wear) wearPicked(); else { refresh(); say('Eso no se lleva puesto.'); } }
      else if (!under?.closest('.inv-panel')) drop(d.i, Infinity);
    });
    el.addEventListener('pointercancel', () => { drag = null; ghost.hidden = true; cells.forEach(c => c.classList.remove('lift')); });
  }

  return {
    refresh,
    open() { picked = null; refresh(); },
  };
}
