// Cofre: dos rejillas (el cofre y la mochila). Un clic en una casilla pasa el montón al otro lado. Sirve también
// para la mochila dejada en el suelo, las alforjas del caballo, la mesita, la cómoda y el armario (en el que solo
// cabe ropa).
import { ITEMS, CHESTS } from '../items.js';
import { SLOTS, extraOf } from '../inventory.js';
import { itemIconUrl } from '../art/items.js';

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
  if (s) { const url = itemIconUrl(s.id, s.color); if (img.getAttribute('src') !== url) img.src = url; img.hidden = false; el.title = ITEMS[s.id].name; }
  else { img.hidden = true; el.title = ''; }
  el.querySelector('b').textContent = s && s.n > 1 ? s.n : '';
}

export function initChestUI(game, { onClose }) {
  let chest = null, tile = null, onChange = null, wardrobe = false, hintTimer = 0;   // (sin casilla: las alforjas del caballo, que avisan con onChange)
  const chestCells = [], bagCells = [];
  for (let i = 0; i < 27; i++) chestCells.push(cell($('ch-grid'), () => toBag(i)));
  for (let i = 0; i < SLOTS; i++) bagCells.push(cell($('ch-bag'), () => toChest(i)));

  const changed = () => { if (tile) game.scene.chestTouched(...tile); else onChange?.(); refresh(); };
  function toBag(i) {
    const s = chest?.[i];
    if (!s) return;
    const left = game.inv.add(s.id, s.n, extraOf(s));
    chest[i] = left ? { ...s, n: left } : null;
    changed();
  }
  function toChest(i) {
    const s = game.inv.slots[i];
    if (!chest || !s) return;
    if (wardrobe && !ITEMS[s.id].wear) {
      const el = $('ch-hint');
      el.textContent = `En el armario solo se guarda ropa (${ITEMS[s.id].name.toLowerCase()} no)`; el.classList.add('no');
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
  function refresh() {
    if (!chest) return;
    chestCells.forEach((el, i) => { paint(el, chest[i]); el.hidden = i >= chest.length; });
    bagCells.forEach((el, i) => { paint(el, game.inv.slots[i]); el.classList.toggle('locked', !game.inv.usable(i)); });
  }
  let the = 'el cofre';
  function hint() { const el = $('ch-hint'); el.classList.remove('no'); el.textContent = `Tu mochila (clic para guardar en ${the}${wardrobe ? ': solo ropa' : ''})`; }
  $('ch-close').onclick = () => onClose();
  return {
    refresh,
    open(c, t, cb) {
      chest = c; tile = t; onChange = cb;
      const id = t && (game.scene.at?.('placed', ...t) || '').split('@')[0];
      the = !t ? 'las alforjas' : CHESTS[id]?.[1] || 'el cofre'; wardrobe = id === 'armario';
      $('ch-title').textContent = !t ? 'Alforjas' : CHESTS[id] ? ITEMS[id].name : 'Cofre';
      clearTimeout(hintTimer); hint();
      refresh();
    },
  };
}
