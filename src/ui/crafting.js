// Pantalla de fabricar: pestañas por estación, recetas (las bloqueadas salen como "???") y detalle con ingredientes.
// Algunas estaciones tienen además su panel: en el yunque, arreglar y juntar; en el horno, el alambique y la noria,
// lo que tienen dentro (machines.js).
import { ITEMS, hungerText } from '../items.js';
import { RECIPES, STATIONS, lockedHint } from '../recipes.js';
import { itemIconUrl } from '../art/items.js';
import { MACHINES, machineAt, settle, fits } from '../machines.js';

const $ = id => document.getElementById(id);
const TAB_ICON = { mano: null, banco: 'banco', horno: 'horno', yunque: 'yunque', telar: 'telar', cocina: 'cocina', quesera: 'quesera', alambique: 'alambique', noria: 'noria' };

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
    b.onclick = () => { tab = st; picked = null; picking = null; refresh(); };
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
    extraPanel(near);
    // Si hay una estación de esta pestaña cerca, se puede recoger
    const st = near[tab];
    $('cf-pick').hidden = !st || st === true || !!st.fixed;   // (las del taller del pueblo no se recogen)
    if (st && st !== true) $('cf-pick').textContent = `Guardar ${ITEMS[tab].name.toLowerCase()} en el inventario`;
    $('cf-where').textContent = tab === 'mano' ? 'Se fabrica en cualquier sitio.' : near[tab] ? `Estás junto a: ${STATIONS[tab].name.toLowerCase()}.` : `Para esto necesitas estar junto a: ${STATIONS[tab].name.toLowerCase()}.`;
  }

  // ---------- El panel de la estación ----------
  let picking = null;   // (horno, alambique o noria) la casilla para la que se está eligiendo qué poner
  function extraPanel(near) {
    const box = $('cf-repair'), c = cr(), st = near[tab];
    box.textContent = '';
    const head = text => { const e = document.createElement('h3'); e.textContent = text; box.append(e); };
    const note = text => { const e = document.createElement('p'); e.className = 'cf-hint'; e.textContent = text; box.append(e); };
    const row = (id, label, sub, run, off) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cf-fix';
      b.innerHTML = `<img alt="" src="${itemIconUrl(id)}"><span></span><b></b>`;
      b.querySelector('span').textContent = label; b.querySelector('b').textContent = sub;
      b.disabled = !!off;
      b.onclick = () => { const why = run(); if (why) c.onNotice?.(why); refresh(); };
      box.append(b);
    };
    if (tab === 'yunque') {
      // Arreglar (un material cada vez: devuelve un cuarto de lo que aguanta) y juntar dos iguales
      const worn = c.repairable(), pairs = c.combinable();
      if (worn.length) head(`Reparar (1 nivel cada vez; tienes ${game.xp.level})`);
      for (const r of worn) row(r.it.id, `${ITEMS[r.it.id].name} (${r.it.dur}/${ITEMS[r.it.id].dur})`, `1 × ${ITEMS[r.mat].name.toLowerCase()} (tienes ${game.inv.count(r.mat)})`, () => c.repair(r), !near.yunque);
      if (pairs.length) head('Juntar dos iguales');
      for (const p of pairs) row(p.it.id, `2 × ${ITEMS[p.it.id].name} → ${p.it.dur}/${ITEMS[p.it.id].dur}`, `${p.cost} niveles`, () => c.merge(p), !near.yunque);
    } else if (MACHINES[tab] && st && st !== true) machinePanel(box, st.tile, head, note);
    else if (tab === 'banco') {
      // Los mapas que llevas: copiarlos (con un mapa en blanco) o ampliarlos al doble (con telas)
      const maps = game.maps.carried();
      if (maps.length) head('Mapas');
      for (const { i, m } of maps) {
        row('mapa', `Copiar el mapa de ${game.maps.label(m)}`, `1 × mapa en blanco (tienes ${game.inv.count('mapa_vacio')})`, () => game.maps.copy(i), !near.banco);
        if (m.s < 2) row('mapa', `Ampliarlo al doble (${game.maps.label({ s: m.s + 1 })})`, `4 × tela (tienes ${game.inv.count('tela')})`, () => game.maps.enlarge(i), !near.banco);
      }
    }
    box.hidden = !box.childElementCount;
  }
  // El horno, el alambique o la noria: sus casillas (lo de dentro; al pulsar, se saca o se elige qué poner), el fuego, lo que
  // lleva hecho y lo hecho
  function machinePanel(box, tile, head, note) {
    const def = MACHINES[tab], kind = tab, M = game.machines;
    const m = settle(structuredClone(machineAt(game.world, tile) || { burn: 0, max: 0, prog: 0, t: Date.now() }), def);   // (para verlo: lo que lleva hecho ahora)
    head(def.title);
    const wrap = document.createElement('div');
    wrap.className = 'mc';
    const slotBtn = (slot, label, it) => {
      const cell = document.createElement('div'), b = document.createElement('button'), s = document.createElement('small');
      cell.className = 'mc-cell';
      b.type = 'button'; b.className = 'slot mc-slot' + (picking === slot ? ' sel' : '');
      b.innerHTML = it ? `<img alt="" src="${itemIconUrl(it.id)}"><b>${it.n > 1 ? it.n : ''}</b>` : '';
      b.title = it ? `${ITEMS[it.id].name} ×${it.n}` : label;
      b.onclick = () => { if (slot === 'out' || it) { picking = null; M.takeBack(tile, kind, slot); } else picking = picking === slot ? null : slot; refresh(); };
      s.textContent = label;
      cell.append(b, s);
      return cell;
    };
    const ins = document.createElement('div');
    ins.className = 'mc-ins';
    for (const [slot, label] of Object.entries(def.slots)) ins.append(slotBtn(slot, label, m[slot]));
    const bars = document.createElement('div');
    bars.className = 'mc-bars';
    bars.innerHTML = (def.fuels ? `<span class="mc-fire" title="Combustible"><i style="height:${m.max ? Math.round((m.burn / m.max) * 100) : 0}%"></i></span>` : '<span class="mc-fire mc-water" title="La mueve el río"><i style="height:100%"></i></span>') + `<span class="mc-arrow" title="Lo que lleva hecho"><i style="width:${Math.round(((m.prog || 0) / def.time) * 100)}%"></i></span>`;
    wrap.append(ins, bars, slotBtn('out', 'Hecho', m.out));
    box.append(wrap);
    if (picking) {
      const opts = game.inv.slots.map((s, i) => ({ s, i })).filter(({ s }) => s && fits(def, picking, s.id));
      note(opts.length ? `Elige qué poner en «${def.slots[picking].toLowerCase()}»:` : `No llevas nada para «${def.slots[picking].toLowerCase()}».`);
      for (const { s, i } of opts) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'cf-fix';
        b.innerHTML = `<img alt="" src="${itemIconUrl(s.id)}"><span></span><b></b>`;
        b.querySelector('span').textContent = ITEMS[s.id].name; b.querySelector('b').textContent = `×${s.n}`;
        b.onclick = () => { M.put(tile, kind, picking, i); picking = null; refresh(); };
        box.append(b);
      }
    } else if (!m.in && !m.out) note(def.help);
  }

  function showRecipe(r, near) {
    // (una estación sin recetas propias, como el alambique: lo que es, y su panel debajo)
    $('cf-make').hidden = $('cf-make5').hidden = !r;
    if (!r) {
      $('cf-icon').src = itemIconUrl(tab); $('cf-icon').classList.remove('locked');
      $('cf-name').textContent = STATIONS[tab].name; $('cf-desc').textContent = ITEMS[tab]?.desc || '';
      for (const id of ['cf-ins', 'cf-sizes']) $(id).textContent = '';
      $('cf-sizes').hidden = true;
      $('cf-msg').textContent = near[tab] ? '' : `Para esto necesitas estar junto a: ${STATIONS[tab].name.toLowerCase()}.`;
      $('cf-note').textContent = notice;
      return;
    }
    const c = cr(), known = c.known.has(r.id), def = ITEMS[r.out];
    c.fresh.delete(r.id);
    $('cf-icon').src = itemIconUrl(r.out);
    $('cf-icon').classList.toggle('locked', !known);
    $('cf-name').textContent = known ? def.name + (r.n > 1 ? ` ×${r.n}` : '') : '???';
    $('cf-desc').textContent = known ? def.desc + (def.food ? ` ${hungerText(def)}` : '') : lockedHint(r, c.seen);
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

  // (el horno y el alambique siguen trabajando con la pantalla abierta)
  setInterval(() => { if ($('s-craft').classList.contains('show') && MACHINES[tab]) refresh(); }, 500);

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
