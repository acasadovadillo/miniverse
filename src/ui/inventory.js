// Barra rápida (las 9 primeras casillas: manos y bolsillos) y la pantalla del inventario: el personaje en 3D
// con lo que lleva puesto, rodeado de los huecos del cuerpo (ropa y mochila), y las casillas, con arrastrar y
// soltar. Sin mochila, sus 27 casillas están cerradas.
import { ITEMS, WEAR_SLOTS } from '../items.js';
import { DYES } from '../looks.js';
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
    el.title = ITEMS[s.id].name + (ITEMS[s.id].dur ? ` (${s.dur ?? ITEMS[s.id].dur}/${ITEMS[s.id].dur} usos)` : '');
  } else {
    img.hidden = true;
    n.textContent = '';
    el.title = '';
  }
  wearBar(el, s);
}
// Lo gastada que está una herramienta o una armadura: una barrita abajo, de verde a rojo (solo si ya se ha usado)
export function wearBar(el, s) {
  const max = s && ITEMS[s.id].dur, left = max && s.dur !== undefined && s.dur < max ? s.dur / max : null;
  let bar = el.querySelector('.dur');
  if (left === null) { bar?.remove(); return; }
  if (!bar) { bar = document.createElement('span'); bar.className = 'dur'; bar.innerHTML = '<span></span>'; el.append(bar); }
  bar.firstChild.style.width = `${Math.max(4, left * 100)}%`;
  bar.firstChild.style.background = `hsl(${Math.round(left * 120)}, 75%, 50%)`;
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
  // ropa de fuera, de la cabeza a los pies; a la derecha la mochila y lo de debajo (ropa interior y calcetines).
  // Vacíos, muestran en gris una prenda de ejemplo y su nombre.
  const wears = {}, LABEL = Object.fromEntries(WEAR_SLOTS);
  const SIDES = { 'inv-wear-l': ['cabeza', 'torso', 'encima', 'piernas', 'pies'], 'inv-wear-r': ['pelo', 'espalda', 'interiorArriba', 'interiorAbajo', 'calcetines'] };
  const SAMPLE = { cabeza: 'sombrero', torso: 'camisa', encima: 'chaleco', piernas: 'pantalon', pies: 'botas', interiorArriba: 'camiseta_interior', interiorAbajo: 'calzoncillos', calcetines: 'calcetines', espalda: 'mochila', pelo: 'lazo' };
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
  if (matchMedia('(max-width: 520px)').matches) me.resize(176, 246); else me.resize(168, 288);
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
  // Tocar uno da un montón entero; si no cabe, va a la casilla de la mano. El buscador filtra por el nombre
  // (sin tildes ni mayúsculas) y Enter coge el primero que quede
  const all = $('inv-all-grid'), found = [];
  const plain = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const give = id => {
    const inv = game.inv, n = ITEMS[id].stack;
    if (inv.add(id, n) === n) { inv.slots[inv.selected] = { id, n, ...(ITEMS[id].wear && { color: ITEMS[id].dye }) }; inv.changed(); }
    picked = inv.slots.findIndex(s => s?.id === id);
    refresh();
  };
  for (const id of Object.keys(ITEMS)) {
    const el = slotEl(-1, 'slot');
    paint(el, { id, n: 1 });
    el.addEventListener('pointerdown', e => { e.preventDefault(); give(id); });
    all.append(el);
    found.push([el, id, plain(`${ITEMS[id].name} ${id.replace(/_/g, ' ')}`)]);
  }
  const search = $('inv-all-q');
  search.addEventListener('input', () => {
    const q = plain(search.value.trim());
    let any = false;
    for (const [el, , text] of found) { el.hidden = !!q && !text.includes(q); any ||= !el.hidden; }
    $('inv-all-none').hidden = any;
    all.scrollTop = 0;
  });
  search.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const hit = found.find(([el]) => !el.hidden); if (hit) give(hit[1]); }
    if (e.key === 'Escape') search.blur();
  });

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
    // Teñir: las prendas (puestas o en la mochila) se cambian de color tocando uno
    $('inv-dyes').hidden = !def.wear || !!def.noDye;   // (la armadura no se tiñe)
    if (def.wear) {
      const box = $('inv-dyes');
      if (!box.children.length) {
        box.innerHTML = '<span>Teñir:</span>';
        for (const c of DYES) { const b = document.createElement('button'); b.type = 'button'; b.style.background = c; b.dataset.c = c; b.title = 'Teñir de este color'; b.onclick = () => dye(c); box.append(b); }
      }
      for (const b of box.querySelectorAll('button')) b.classList.toggle('on', b.dataset.c === s.color);
    }
    $('inv-wearbtn').textContent = worn ? 'Quitármelo' : 'Ponérmelo';
    $('inv-eat').hidden = !def.food || !!worn;
    $('inv-drop1').hidden = s.n < 2 || !!worn;
    $('inv-drop').hidden = !!worn;
  }

  // Teñir lo elegido (en su casilla o puesto)
  function dye(c) {
    const inv = game.inv, it = picked?.wear ? inv.equip[picked.wear] : typeof picked === 'number' ? inv.slots[picked] : null;
    if (!it || !ITEMS[it.id].wear) return;
    it.color = c;
    inv.changed();
    refresh();
  }

  // Ponerse o quitarse lo elegido
  function wearPicked() {
    const inv = game.inv;
    if (picked?.wear) {
      let why = inv.unwear(picked.wear);
      // (la mochila llena no se guarda: se deja en el suelo, delante, con todo dentro)
      if (why && picked.wear === 'espalda') { why = game.dropBackpack(); if (!why) { picked = null; say('Has dejado la mochila en el suelo, con todo dentro.'); refresh(); return; } }
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
  // Eliminar (modo admin): lo elegido desaparece entero, sin tirarlo al suelo (la mochila puesta, solo vacía)
  $('inv-del').onclick = () => {
    const inv = game.inv, worn = picked?.wear, s = worn ? inv.equip[worn] : typeof picked === 'number' ? inv.slots[picked] : null;
    if (!game.admin || !s) return;
    if (worn === 'espalda' && inv.slots.slice(HOTBAR).some(Boolean)) { say('Vacía la mochila antes de eliminarla.'); return; }
    if (worn) delete inv.equip[worn]; else inv.slots[picked] = null;
    inv.changed();
    picked = null;
    refresh();
    $('inv-name').textContent = `Has eliminado ${ITEMS[s.id].name}${s.n > 1 ? ` ×${s.n}` : ''}`;
  };
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
