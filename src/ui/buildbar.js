// Barra del modo construcción: categorías, piezas con su coste y la herramienta de quitar.
import { PIECES, CATS } from '../pieces.js';
import { ITEMS } from '../items.js';
import { pieceSprite, PIECE_IDS } from '../build.js';
import { pieceIcon } from '../art/build.js';

const $ = id => document.getElementById(id);

export function initBuildBar(game) {
  const b = game.build;
  let cat = CATS[0];
  const icons = {};
  const iconOf = id => (icons[id] ||= pieceIcon(pieceSprite(id)).toDataURL());

  function render() {
    if (!b.erase && PIECES[b.piece].cat !== cat) cat = PIECES[b.piece].cat;
    $('bb-cats').textContent = '';
    for (const c of [...CATS, 'Quitar']) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = c;
      btn.className = (c === 'Quitar' ? b.erase : !b.erase && c === cat) ? 'on' : '';
      btn.onclick = () => { if (c === 'Quitar') b.select('quitar'); else { cat = c; b.select(PIECE_IDS.find(id => PIECES[id].cat === c)); } };
      $('bb-cats').append(btn);
    }
    const box = $('bb-pieces');
    box.textContent = '';
    if (b.erase) {
      box.innerHTML = '<div class="bb-note">Clic sobre lo que quieras quitar: te devuelve los materiales o el mueble.</div>';
      return;
    }
    for (const id of PIECE_IDS) {
      const p = PIECES[id];
      if (p.cat !== cat) continue;
      const btn = document.createElement('button'), ok = b.affordable(id);
      btn.type = 'button';
      btn.className = 'bb-piece' + (id === b.piece ? ' on' : '') + (ok ? '' : ' poor');
      btn.title = p.name;
      btn.innerHTML = `<img alt="" src="${iconOf(id)}"><span>${p.name}</span><small>${game.admin ? 'Gratis (admin)' : p.cost.map(([m, n]) => `${n} ${ITEMS[m].name.toLowerCase()}`).join(' · ')}</small>`;
      btn.onclick = () => b.select(id);
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
