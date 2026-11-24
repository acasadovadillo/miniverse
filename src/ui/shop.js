// Tienda de un vecino: comprar lo que vende y venderle lo que lleves.
import { ITEMS, TIERS, LEGACY_ITEMS, clothesText } from '../items.js';
import { STATIONS } from '../recipes.js';
import { BUILDABLE, PLANS } from '../buildables.js';
import { SHOPS, priceOf, buyPrice } from '../economy.js';
import { itemIconUrl } from '../art/items.js';
import { animalSprite, ANIMALS } from '../art/farm.js';
import { Audio } from '../audio.js';
import { hud } from './hud.js';
import { t, fmt, has } from '../i18n.js';

const $ = id => document.getElementById(id);

export function initShopUI(game, { onClose }) {
  let shop = null, tab = 'buy', note = '';
  // (Rosa's discount, and the village's reputation: reputation.js; selling, the reputation only)
  const discount = () => (shop === 'rosa' && game.neighbors.flags.descuento ? 0.9 : 1) * (game.rep?.buyFactor() ?? 1);
  const sellPrice = id => { const p = priceOf(id); return p ? Math.max(1, Math.round(p * (game.rep?.sellFactor() ?? 1))) : 0; };

  function stock() {
    const s = SHOPS[shop], season = game.days.season, done = game.board.projects;
    return s.stock.filter(e => (!e.seasons || e.seasons.includes(season)) && (!e.project || done[e.project]) && (e.animal || (e.plan ? PLANS.has(e.plan) : ITEMS[e.id] && !LEGACY_ITEMS[e.id])));   // (lo que ahora se construye no se vende, ya no es un objeto: se vende su plano)
  }
  const animalIcon = type => animalSprite(type, 0).toDataURL();

  function row(icon, name, sub, actions) {
    const el = document.createElement('div');
    el.className = 'sh-row';
    el.innerHTML = `<img alt="" src="${icon}"><div><b>${name}</b><small>${sub}</small></div>`;
    el.querySelector('small').title = el.querySelector('small').textContent;   // (the line is cut with … when long: the whole of it on hover)
    for (const [label, fn, ok] of actions) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn'; b.textContent = label; b.disabled = !ok;
      b.onclick = () => { fn(); render(); };
      el.append(b);
    }
    $('sh-list').append(el);
  }

  function render() {
    if (!shop || !SHOPS[shop]) return;
    // (the title from the language files when the shop has one, shop.title.<id>: Marta's, Plan E §4.4; else its own)
    $('sh-title').textContent = has(`shop.title.${shop}`) ? t(`shop.title.${shop}`) : SHOPS[shop].title ?? '';
    hud.coins($('sh-money'), game.money);
    document.querySelectorAll('[data-shtab]').forEach(b => b.classList.toggle('on', b.dataset.shtab === tab));
    $('sh-note').textContent = note || game.rep?.shopNote() || '';   // (why the prices are not the usual ones, until something else is said)
    $('sh-list').textContent = '';
    if (tab === 'buy') {
      for (const e of stock()) {
        const price = Math.round((e.price ?? buyPrice(e.id)) * discount());
        if (e.animal) {
          row(animalIcon(e.animal), e.name, `${price} 🪙 · vive en: ${ITEMS[ANIMALS[e.animal].home].name.toLowerCase()}`, [['Comprar', () => {
            const why = game.ranch.add(e.animal);
            if (why) { note = why; Audio.error(); return; }
            game.addMoney(-price); note = `${e.name}: ya está en su casa.`; Audio.unlock();
          }, game.money >= price]]);
          continue;
        }
        if (e.plan) {   // (un plano: se compra una vez y enseña a construir eso con B)
          const d = BUILDABLE[e.plan], has = game.craft.hasPlan(e.plan), S = d.needs && STATIONS[d.needs];
          const cost = fmt.list(d.cost.map(([m, n]) => t('shop.cost_part', { n, item: ITEMS[m] })));
          const offer = S ? t('shop.plan.offer_station', { price, cost, station: { name: S.name, g: S.fem ? 'f' : 'm' } }) : t('shop.plan.offer', { price, cost });
          row(itemIconUrl(e.plan), t('shop.plan.name', { item: d }), has ? t('shop.plan.has') : offer, [[has ? t('shop.plan.learned_btn') : t('shop.buy'), () => {
            game.addMoney(-price); game.craft.learnPlan(e.plan);
            note = t('shop.plan.learned', { item: d }); Audio.unlock();
          }, !has && game.money >= price]]);
          continue;
        }
        const def = ITEMS[e.id], clothes = clothesText(def);   // (a garment also says what it does: "Warmth +3 · Keeps off rain")
        row(itemIconUrl(e.id), def.name, `${price} 🪙 · ${clothes ? `${clothes} · ` : ''}${def.desc}`, [   // (what it does first: the line is cut when long)
          [t('shop.buy'), () => buy(e.id, price, 1), game.money >= price],
          ['×5', () => buy(e.id, price, 5), game.money >= price * 5 && def.stack > 1],
        ]);
      }
    } else {
      const seen = new Set();
      for (const s of game.inv.slots) {
        if (!s || seen.has(s.id)) continue;
        seen.add(s.id);
        const p = sellPrice(s.id), n = game.inv.count(s.id), def = ITEMS[s.id];
        if (!p || (def.tool && (def.tier === 1 || TIERS[def.tier]))) continue;   // (las herramientas de siempre no se venden)
        row(itemIconUrl(s.id), `${def.name} ×${n}`, `${p} 🪙 cada uno`, [['Vender 1', () => sell(s.id, 1, p), true], ['Todo', () => sell(s.id, n, p), n > 1]]);
      }
      if (!seen.size) note = 'No llevas nada que vender.';
    }
  }
  function buy(id, price, n) {
    if (game.money < price * n) return;
    if (game.inv.room(id) < n) { note = 'No te cabe: no llevas sitio libre'; Audio.error(); return; }
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
