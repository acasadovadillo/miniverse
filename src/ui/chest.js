// Cofre: dos rejillas (el cofre y la mochila). Un clic en una casilla pasa el montón al otro lado. Sirve también
// para la mochila dejada en el suelo, las alforjas del caballo, la mesita, la cómoda y el armario (en el que solo
// cabe ropa). And the parked wheelbarrow: its 12 stacks and, below them, the row of its big things, each with its «Take»
// (barrow.js takeLoad); this file makes that row (index.html does not have it)
import { ITEMS, CHESTS, UNKNOWN_NAME } from '../items.js';
import { SLOTS, extraOf } from '../inventory.js';
import { itemIconUrl } from '../art/items.js';
import { HOTBAR } from '../inventory.js';
import { packRows } from './packlist.js';
import { t, noun } from '../i18n.js';

const $ = id => document.getElementById(id);

function cell(parent, onClick) {
  const el = document.createElement('div');
  el.className = 'slot';
  el.innerHTML = '<img alt="" draggable="false"><b></b>';
  el.addEventListener('pointerdown', e => { e.preventDefault(); onClick(); });
  parent.append(el);
  return el;
}
function paint(el, s) {
  const img = el.querySelector('img');
  if (s) { const url = itemIconUrl(s.id, s.color); if (img.getAttribute('src') !== url) img.src = url; img.hidden = false; el.title = ITEMS[s.id]?.name || UNKNOWN_NAME; }   // (sin ITEMS: de una versión más nueva)
  else { img.hidden = true; el.title = ''; }
  el.querySelector('b').textContent = s && s.n > 1 ? s.n : '';
}

export function initChestUI(game, { onClose }) {
  // No se guarda el contenido: otro jugador, o quien lleva el mundo, puede cambiarlo o quitar el mueble con la ventana
  // abierta. tile: dónde está el mueble (y scene, en qué escena); source: de dónde leer lo que no está en una casilla
  // (las alforjas del caballo, que avisan con onChange)
  let tile = null, scene = null, source = null, onChange = null, wardrobe = false, hintTimer = 0, shown = '';
  const chestCells = [], bagCells = [];
  for (let i = 0; i < 27; i++) chestCells.push(cell($('ch-grid'), () => toBag(i)));
  for (let i = 0; i < SLOTS; i++) bagCells.push(cell($('ch-bag'), () => toChest(i)));

  const current = () => (tile ? (game.scene === scene ? game.scene.chestAt?.(...tile) : null) : source?.()) || null;
  const changed = () => { if (tile) { game.scene.chestTouched(...tile); game.barrow?.stacksChanged(tile); } else onChange?.(); refresh(); };
  // (the wheelbarrow's big things: a row under its stacks)
  const loadsEl = document.createElement('div');
  loadsEl.id = 'ch-loads';
  loadsEl.style.cssText = 'display:none;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0 2px;font-size:15px';   // (display, not hidden: an inline display would beat it)
  $('ch-grid').after(loadsEl);
  const loadsOf = () => (tile && game.scene === game.world && game.barrow?.isAt?.(tile) ? game.barrow.loadsAt(tile) : null);
  const loadsSig = loads => (loads ? JSON.stringify(loads) + (game.barrow.pending?.size || 0) : '');
  function paintLoads(loads) {
    loadsEl.style.display = loads ? 'flex' : 'none';
    loadsEl.textContent = '';
    if (!loads) return;
    const label = document.createElement('span');
    label.textContent = t('gui.chest.loads', { n: loads.length });
    loadsEl.append(label);
    loads.forEach(([id], i) => {
      const b = document.createElement('button'), wait = game.barrow.waiting('take', tile, i);
      b.className = 'btn'; b.style.cssText = 'width:auto;margin:0;padding:4px 10px;font-size:15px';
      b.textContent = `${ITEMS[id]?.name || UNKNOWN_NAME} · ${wait ? t('barrow.wait') : t('gui.chest.take_load')}`;
      b.title = t('carry.take', { item: noun('item', id) });
      b.disabled = wait;
      b.addEventListener('pointerdown', e => { e.preventDefault(); const at = tile; game.barrow.takeLoad(at, i); refresh(); });
      loadsEl.append(b);
    });
  }
  function toBag(i) {
    const chest = current(), s = chest?.[i];
    if (!s || !ITEMS[s.id]) return;   // (lo de una versión más nueva se queda en el cofre: aquí no se puede usar, y no se pierde)
    const left = game.inv.add(s.id, s.n, extraOf(s));
    chest[i] = left ? { ...s, n: left } : null;
    changed();
  }
  function toChest(i) {
    const chest = current(), s = game.inv.slots[i];
    if (!chest || !s) return;
    if (wardrobe && !ITEMS[s.id].wear) {
      const el = $('ch-hint');
      el.textContent = t('gui.chest.wardrobe_only', { item: { name: ITEMS[s.id].name } }); el.classList.add('no');
      clearTimeout(hintTimer); hintTimer = setTimeout(hint, 1800);
      return;
    }
    let n = s.n;
    const max = ITEMS[s.id].stack;
    if (!s.color) for (const c of chest) if (n > 0 && c?.id === s.id && !c.color && c.n < max) { const k = Math.min(n, max - c.n); c.n += k; n -= k; }
    for (let j = 0; j < chest.length && n > 0; j++) if (!chest[j]) { chest[j] = { ...s, n: Math.min(n, max) }; n -= chest[j].n; }
    game.inv.take(i, s.n - n, true);
    changed();
  }
  function refresh(top = false) {
    const chest = current();
    if (!chest) return;
    const loads = loadsOf();
    shown = JSON.stringify(chest) + loadsSig(loads);
    chestCells.forEach((el, i) => { paint(el, chest[i]); el.hidden = i >= chest.length; });
    paintLoads(loads);
    // (the weight inventory: the hotbar and, below it, the list of the backpack, packlist.js)
    if (game.inv.weight) { bagCells.forEach((el, i) => { el.hidden = i >= HOTBAR; if (i < HOTBAR) paint(el, game.inv.slots[i]); }); packRows($('ch-bag'), game.inv, toChest, { top, arms: game.carry?.armsKg() || 0 }).hidden = false; }
    else {
      if ($('ch-pack')) { $('ch-pack').hidden = true; for (const el of bagCells) el.hidden = false; }   // (a game without it, after one with it)
      bagCells.forEach((el, i) => { paint(el, game.inv.slots[i]); el.classList.toggle('locked', !game.inv.usable(i)); });
    }
  }
  let into = null;   // (the furniture as a noun, { name, g }; null: the saddlebags)
  function hint() { const el = $('ch-hint'); el.classList.remove('no'); el.textContent = wardrobe ? t('gui.chest.hint_wardrobe') : into ? t('gui.chest.hint', { chest: into }) : t('gui.chest.hint_bags'); }
  $('ch-close').onclick = () => onClose();
  return {
    refresh,
    // Cada poco, con la ventana abierta: si el mueble ya no está, false (hay que cerrarla); si ha cambiado, se repinta
    check() {
      const chest = current();
      if (!chest) return false;
      if (JSON.stringify(chest) + loadsSig(loadsOf()) !== shown) refresh();
      return true;
    },
    close() { tile = scene = source = onChange = null; loadsEl.style.display = 'none'; },
    // src: lo que hay dentro, solo para lo que no está en una casilla: una función que lo devuelve
    open(src, at, cb) {
      tile = at; scene = game.scene; source = typeof src === 'function' ? src : () => src; onChange = cb;
      const id = at && (game.scene.at?.('placed', ...at) || '').split('@')[0], c = CHESTS[id] ? id : 'cofre';
      into = at ? { name: ITEMS[c].name, g: CHESTS[c][1].startsWith('la ') ? 'f' : 'm' } : null; wardrobe = id === 'armario';
      $('ch-title').textContent = at ? ITEMS[c].name : t('gui.chest.saddlebags');
      clearTimeout(hintTimer); hint();
      refresh(true);
    },
  };
}
