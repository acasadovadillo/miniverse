// Pantalla de fabricar: pestañas por estación, recetas (las bloqueadas salen como "???") y detalle con ingredientes.
import { ITEMS } from '../items.js';
import { RECIPES, STATIONS, lockedHint } from '../recipes.js';
import { itemIconUrl } from '../art/items.js';

const $ = id => document.getElementById(id);
const TAB_ICON = { mano: null, banco: 'banco', horno: 'horno', yunque: 'yunque', telar: 'telar', cocina: 'cocina', quesera: 'quesera' };

export function initCraftingUI(game, { onClose, onBag }) {
  const cr = () => game.craft;
  let tab = 'mano', picked = null, notice = '', noticeTimer = 0;
  game.craft.onNotice = text => {
    notice = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice = ''; refresh(); }, 2500);
    refresh();
  };

  // Pestañas
  const tabs = {};
  for (const st of Object.keys(STATIONS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cf-tab';
    b.innerHTML = (TAB_ICON[st] ? `<img alt="" src="${itemIconUrl(TAB_ICON[st])}">` : '<span class="hand">✋</span>') + `<span>${STATIONS[st].name}</span>`;
    b.onclick = () => { tab = st; picked = null; refresh(); };
    $('cf-tabs').append(b);
    tabs[st] = b;
  }

  function refresh() {
    if (!$('s-craft').classList.contains('show')) return;
    const c = cr(), near = c.stationsNear();
    for (const [st, b] of Object.entries(tabs)) {
      b.classList.toggle('on', st === tab);
      b.classList.toggle('far', !near[st]);
      b.classList.toggle('new', RECIPES.some(r => r.station === st && c.fresh.has(r.id)));
    }
    // Lista de recetas de la pestaña: primero las conocidas (de las alfombras, la de 1×1: el tamaño se elige luego)
    const list = RECIPES.filter(r => r.station === tab && !r.variant).sort((a, b) => c.known.has(b.id) - c.known.has(a.id));
    if (!picked || picked.station !== tab) picked = list.find(r => c.known.has(r.id)) || list[0];
    const box = $('cf-list');
    box.textContent = '';
    for (const r of list) {
      const el = document.createElement('button'), known = c.known.has(r.id);
      el.type = 'button';
      el.className = 'slot cf-r' + (known ? '' : ' locked') + (r === picked || picked?.variant === r.id ? ' sel' : '') + (known && !c.problem(r) ? ' ok' : '') + (c.fresh.has(r.id) ? ' new' : '');
      el.innerHTML = `<img alt="" src="${itemIconUrl(r.out)}">` + (r.n > 1 ? `<b>${r.n}</b>` : '') + (known ? '' : '<i class="q">?</i>');
      el.title = known ? ITEMS[r.out].plain || ITEMS[r.out].name : '???';
      el.onclick = () => { picked = r; c.fresh.delete(r.id); refresh(); };
      box.append(el);
    }
    showRecipe(picked, near);
    // Si hay una estación de esta pestaña cerca, se puede recoger
    const st = near[tab];
    $('cf-pick').hidden = !st || st === true;
    if (st && st !== true) $('cf-pick').textContent = `Guardar ${ITEMS[tab].name.toLowerCase()} en el inventario`;
    $('cf-where').textContent = tab === 'mano' ? 'Se fabrica en cualquier sitio.' : near[tab] ? `Estás junto a: ${STATIONS[tab].name.toLowerCase()}.` : `Para esto necesitas estar junto a: ${STATIONS[tab].name.toLowerCase()}.`;
  }

  function showRecipe(r, near) {
    const c = cr(), known = c.known.has(r.id), def = ITEMS[r.out];
    c.fresh.delete(r.id);
    $('cf-icon').src = itemIconUrl(r.out);
    $('cf-icon').classList.toggle('locked', !known);
    $('cf-name').textContent = known ? def.name + (r.n > 1 ? ` ×${r.n}` : '') : '???';
    $('cf-desc').textContent = known ? def.desc + (def.food ? ` Da ${def.food} de energía.` : '') : lockedHint(r, c.seen);
    // Las alfombras: aquí se elige el tamaño (cada uno con su receta, que cuesta según lo que ocupa)
    const sizes = $('cf-sizes'), kind = r.variant || (ITEMS[r.out].rug && r.out);
    sizes.textContent = '';
    sizes.hidden = !known || !kind;
    if (known && kind) for (const v of RECIPES.filter(q => q.out === kind || q.variant === kind)) {
      const b = document.createElement('button'), [w, h] = ITEMS[v.out].size;
      b.type = 'button';
      b.className = 'cf-size' + (v === r ? ' on' : '');
      b.textContent = `${w}×${h}`;
      b.onclick = () => { picked = v; refresh(); };
      sizes.append(b);
    }
    const ins = $('cf-ins');
    ins.textContent = '';
    if (known) {
      for (const [id, n] of r.ins) {
        const have = game.inv.count(id), row = document.createElement('div');
        row.className = 'cf-in' + (have >= n ? ' have' : '');
        row.innerHTML = `<img alt="" src="${itemIconUrl(id)}"><span>${ITEMS[id].name}</span><b>${have}/${n}</b>`;
        ins.append(row);
      }
    }
    const problem = c.problem(r), times = known && !problem ? c.times(r) : 0;
    $('cf-make').disabled = !!problem;
    $('cf-make5').hidden = times < 2;
    $('cf-make5').textContent = `×${Math.min(5, times)}`;
    $('cf-msg').textContent = known ? problem || '' : '';
    $('cf-note').textContent = notice;
  }

  $('cf-make').onclick = () => { if (picked) { game.craft.craft(picked, 1); refresh(); } };
  $('cf-make5').onclick = () => { if (picked) { game.craft.craft(picked, Math.min(5, game.craft.times(picked))); refresh(); } };
  $('cf-pick').onclick = () => {
    const st = cr().stationsNear()[tab];
    if (st && st !== true && game.pickUp(st)) { tab = 'mano'; picked = null; refresh(); }
  };
  $('cf-close').onclick = () => onClose();
  $('cf-bag').onclick = () => onBag();

  return {
    refresh,
    // Abre en la pestaña de una estación, o en la de la estación más cercana
    open(station) {
      const near = cr().stationsNear();
      tab = station || Object.keys(near).find(st => st !== 'mano') || 'mano';   // la estación más cercana
      picked = null;
      refresh();
    },
  };
}
