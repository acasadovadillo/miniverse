// Barra del modo construcción: categorías (las piezas de casa y los muebles y estaciones), cada cosa con su coste, y las
// herramientas de mover y de quitar.
import { STATIONS } from '../recipes.js';
import { PIECES } from '../pieces.js';
import { ITEMS } from '../items.js';
import { pieceSprite, BUILD_IDS, ALL_CATS, DEF } from '../build.js';
import { BUILDABLE, PLANS } from '../buildables.js';
import { SHOPS } from '../economy.js';
import { pieceIcon } from '../art/build.js';
import { itemIcon } from '../art/items.js';

const $ = id => document.getElementById(id);

export function initBuildBar(game) {
  const b = game.build;
  let cat = ALL_CATS[0];
  const icons = {};
  const iconOf = id => (icons[id] ||= (BUILDABLE[id] ? itemIcon(id) : pieceIcon(pieceSprite(id))).toDataURL());
  const TOOLS = { Mover: 'mover', Quitar: 'quitar' };
  // Dónde se compra el plano de lo que lo pide (la primera tienda que lo vende)
  const planAt = id => Object.values(SHOPS).find(s => s.stock.some(e => e.plan === id))?.title;

  function render() {
    const tool = b.erase ? 'Quitar' : b.move ? 'Mover' : null;
    if (!tool && DEF(b.piece).cat !== cat) cat = DEF(b.piece).cat;
    const shown = c => BUILD_IDS.filter(id => DEF(id).cat === c && b.available(id));
    $('bb-cats').textContent = '';
    for (const c of [...ALL_CATS, 'Mover', 'Quitar']) {
      if (!TOOLS[c] && !shown(c).length) continue;   // (una categoría de la que aún no se conoce nada no sale)
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = c;
      btn.className = (TOOLS[c] ? tool === c : !tool && c === cat) ? 'on' : '';
      btn.onclick = () => { if (TOOLS[c]) b.select(TOOLS[c]); else { cat = c; b.select(shown(c)[0]); } };
      $('bb-cats').append(btn);
    }
    const box = $('bb-pieces');
    box.textContent = '';
    if (tool) {
      box.innerHTML = `<div class="bb-note">${tool === 'Quitar' ? 'Clic sobre lo que quieras quitar: te devuelve sus materiales.' : b.carry ? `Llevas: ${DEF(b.carry.id).name.toLowerCase()}. Clic donde quieras dejarlo (R: girar).` : 'Clic sobre un mueble o una estación para cogerlo, y otro clic donde quieras dejarlo. No cuesta nada.'}</div>`;
      return;
    }
    for (const id of shown(cat)) {
      const p = DEF(id);
      const btn = document.createElement('button'), near = b.stationFor(id), ok = b.affordable(id) && near;
      btn.type = 'button';
      btn.className = 'bb-piece' + (id === b.piece ? ' on' : '') + (ok ? '' : ' poor');
      btn.title = p.name;
      btn.innerHTML = `<img alt="" src="${iconOf(id)}"><span>${p.name}</span><small>${game.admin ? 'Gratis (admin)' : p.cost.map(([m, n]) => `${n} ${ITEMS[m].name.toLowerCase()}`).join(' · ') + (near ? '' : ` · falta ${STATIONS[p.needs].name.toLowerCase()} cerca`)}</small>`;
      btn.onclick = () => b.select(id);
      box.append(btn);
    }
    // Lo de esta pestaña que aún pide su plano: se ve, en gris, con la tienda donde se compra
    for (const id of BUILD_IDS) {
      if (DEF(id).cat !== cat || !PLANS.has(id) || b.available(id)) continue;
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'bb-piece poor'; btn.disabled = true; btn.title = DEF(id).name;
      btn.innerHTML = `<img alt="" src="${iconOf(id)}"><span>${DEF(id).name}</span><small>Falta su plano: ${planAt(id) || 'se compra en una tienda'}</small>`;
      box.append(btn);
    }
  }
  b.onChange = render;
  const prev = game.onInventory;
  game.onInventory = () => { prev?.(); if (b.on) render(); };
  $('bb-close').onclick = () => b.toggle(false);
  render();
  return { render };
}
