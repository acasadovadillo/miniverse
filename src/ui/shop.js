// Tienda de un vecino: comprar lo que vende y venderle lo que lleves.
import { ITEMS } from '../items.js';
import { SHOPS, priceOf, buyPrice } from '../economy.js';
import { itemIconUrl } from '../art/items.js';
import { animalSprite } from '../art/farm.js';
import { Audio } from '../audio.js';

const $ = id => document.getElementById(id);

export function initShopUI(game, { onClose }) {
  let shop = null, tab = 'buy', note = '';
  const discount = () => (shop === 'rosa' && game.neighbors.flags.descuento ? 0.9 : 1);

  function stock() {
    const s = SHOPS[shop], season = game.days.season, done = game.board.projects;
    return s.stock.filter(e => (!e.seasons || e.seasons.includes(season)) && (!e.project || done[e.project]) && (e.animal || ITEMS[e.id]));
  }
  const animalIcon = type => animalSprite(type, 0).toDataURL();

  function row(icon, name, sub, actions) {
    const el = document.createElement('div');
    el.className = 'sh-row';
    el.innerHTML = `<img alt="" src="${icon}"><div><b>${name}</b><small>${sub}</small></div>`;
    for (const [label, fn, ok] of actions) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn'; b.textContent = label; b.disabled = !ok;
      b.onclick = () => { fn(); render(); };
      el.append(b);
    }
    $('sh-list').append(el);
  }

  function render() {
    if (!shop) return;
    $('sh-title').textContent = SHOPS[shop].title;
    $('sh-money').textContent = `${game.money} 🪙`;
    document.querySelectorAll('[data-shtab]').forEach(b => b.classList.toggle('on', b.dataset.shtab === tab));
    $('sh-note').textContent = note;
    $('sh-list').textContent = '';
    if (tab === 'buy') {
      for (const e of stock()) {
        const price = Math.round((e.price ?? buyPrice(e.id)) * discount());
        if (e.animal) {
          row(animalIcon(e.animal), e.name, `${price} 🪙 · vive en ${e.animal === 'gallina' ? 'un gallinero' : 'un establo'}`, [['Comprar', () => {
            const why = game.ranch.add(e.animal);
            if (why) { note = why; Audio.error(); return; }
            game.addMoney(-price); note = `¡${e.name} nueva! Ya está en su casa.`; Audio.unlock();
          }, game.money >= price]]);
          continue;
        }
        const def = ITEMS[e.id];
        row(itemIconUrl(e.id), def.name, `${price} 🪙 · ${def.desc}`, [
          ['Comprar', () => buy(e.id, price, 1), game.money >= price],
          ['×5', () => buy(e.id, price, 5), game.money >= price * 5 && def.stack > 1],
        ]);
      }
    } else {
      const seen = new Set();
      for (const s of game.inv.slots) {
        if (!s || seen.has(s.id)) continue;
        seen.add(s.id);
        const p = priceOf(s.id), n = game.inv.count(s.id), def = ITEMS[s.id];
        if (!p || (def.tool && def.tier === 1)) continue;
        row(itemIconUrl(s.id), `${def.name} ×${n}`, `${p} 🪙 cada uno`, [['Vender 1', () => sell(s.id, 1, p), true], ['Todo', () => sell(s.id, n, p), n > 1]]);
      }
      if (!seen.size) note = 'No llevas nada que vender.';
    }
  }
  function buy(id, price, n) {
    if (game.money < price * n) return;
    if (game.inv.room(id) < n) { note = 'No te cabe en la mochila'; Audio.error(); return; }
    game.addMoney(-price * n);
    game.inv.add(id, n);
    note = `Has comprado ${n} × ${ITEMS[id].name.toLowerCase()}.`;
    Audio.pickup();
  }
  function sell(id, n, p) {
    game.inv.remove(id, n);
    game.addMoney(p * n);
    game.stats?.add('ventas', p * n);
    note = `+${p * n} monedas`;
    Audio.pickup();
  }
  document.querySelectorAll('[data-shtab]').forEach(b => { b.onclick = () => { tab = b.dataset.shtab; note = ''; render(); }; });
  $('sh-close').onclick = () => onClose();
  return { render, open(id) { shop = id; tab = 'buy'; note = ''; render(); } };
}
