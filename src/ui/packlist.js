// The backpack as a list (the weight prototype, ?inventario=peso: see ../carry.js). Instead of the 27 slots of the
// backpack: the load bar (kg of what you carry and what you carry comfortably), what the arms carry, tabs by kind and one
// row per stack, the heaviest first. A click shows it in the details below (the same #inv-info); dragging a row to a
// slot of the hotbar puts it at hand, to the body puts it on, out of the window drops it. The chest window shows the same
// rows on the side of the backpack (packRows). Nothing of index.html changes: this file adds its elements and its CSS
import { ITEMS } from '../items.js';
import { HOTBAR } from '../inventory.js';
import { weightOf, BULKY, HEAVY } from '../carry-items.js';
import { itemIconUrl } from '../art/items.js';
import { t } from '../i18n.js';

const $ = id => document.getElementById(id);
const CSS = `
#pk-top { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.pk-load { display: flex; align-items: center; gap: 8px; font-size: 15px; color: var(--dim); }
.pk-load > span { flex: none; }
.pk-bar { position: relative; flex: 1; height: 9px; background: rgba(0, 0, 0, .45); border: 1px solid rgba(255, 240, 210, .18); border-radius: 5px; overflow: hidden; }
.pk-bar i { position: absolute; left: 0; top: 0; bottom: 0; background: #8fbf62; border-radius: 4px; transition: width .2s; }
.pk-bar.heavy i { background: #e3a948; } .pk-bar.over i { background: #e0603f; }
.pk-bar s { position: absolute; top: 0; bottom: 0; left: 66.67%; width: 2px; background: rgba(255, 248, 232, .55); }
.pk-bar u { position: absolute; top: 0; bottom: 0; background: repeating-linear-gradient(-45deg, #d9b45a 0 4px, #7a5a24 4px 7px); opacity: .9; }   /* (what the arms carry, apart) */
.pk-load b { flex: none; font: 500 16px/1 var(--font-title); letter-spacing: .02em; font-variant-numeric: tabular-nums; color: var(--cream); white-space: nowrap; }
.pk-load.heavy b { color: #ffc86a; } .pk-load.over b { color: #ff8a6a; }
.pk-arms { display: flex; align-items: center; gap: 8px; padding: 3px 4px 3px 8px; font-size: 15px; background: rgba(255, 215, 122, .1); border: 1px solid rgba(255, 215, 122, .45); border-radius: 6px; }
.pk-arms img { width: 30px; height: 30px; } .pk-arms span { flex: 1; } .pk-arms .btn { padding: 3px 10px; font-size: 15px; }
#pk-box { display: flex; flex-direction: column; gap: 5px; width: 428px; min-height: 120px; }
.pk-tabs { display: flex; gap: 3px; flex-wrap: wrap; }
.pk-tabs button { padding: 2px 8px; font: 500 14px var(--font-ui); color: var(--dim); background: rgba(0, 0, 0, .25); border: 1px solid #6a4a2a; border-radius: 4px; cursor: pointer; }
.pk-tabs button.on { color: var(--cream); border-color: var(--gold); background: rgba(60, 42, 14, .5); }
.pk-list { display: flex; flex-direction: column; gap: 2px; max-height: 204px; overflow-y: auto; padding-right: 4px; scrollbar-width: thin; scrollbar-color: var(--gold) rgba(0, 0, 0, .3); }
.pk-list::-webkit-scrollbar { width: 8px; } .pk-list::-webkit-scrollbar-track { background: rgba(0, 0, 0, .3); border-radius: 4px; } .pk-list::-webkit-scrollbar-thumb { background: var(--gold); border-radius: 4px; }
.pk-list.more { -webkit-mask-image: linear-gradient(#000 calc(100% - 30px), transparent); mask-image: linear-gradient(#000 calc(100% - 30px), transparent); }   /* (there is more below) */
.pk-more { margin-top: -2px; font-size: 13px; text-align: center; color: var(--gold); pointer-events: none; }
.pk-more[hidden] { display: none; }
.pk-row { display: grid; grid-template-columns: 30px 1fr auto 62px; align-items: center; gap: 8px; min-height: 32px; padding: 1px 6px; font-size: 15px; background: rgba(0, 0, 0, .28); border: 1px solid transparent; border-radius: 4px; cursor: pointer; touch-action: none; }
.pk-row:hover { background: rgba(255, 240, 210, .07); } .pk-row.sel { border-color: var(--gold); } .pk-row.lift { opacity: .4; }
.pk-row img { width: 30px; height: 30px; } .pk-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cream); }
.pk-row em { font-style: normal; color: var(--dim); font-variant-numeric: tabular-nums; } .pk-row b { font-weight: 500; text-align: right; color: var(--dim); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pk-none { padding: 8px 4px; font-size: 15px; color: var(--dim); }
#pk-top[hidden], #pk-box[hidden], .pk-arms[hidden], .pk-none[hidden], .pk-bar[hidden], #ch-pack[hidden] { display: none; }
body.pk-on #inv-grid { display: none; }
#ch-pack { display: flex; flex-direction: column; gap: 5px; width: 428px; margin-top: 5px; }
#ch-pack .pk-list { max-height: 170px; }
`;
let styled = false;
export function style() { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.append(s); }

// The kind of a thing, for the tabs
export function kindOf(id) {
  const d = ITEMS[id];
  if (!d) return 'other';
  if (d.wear) return 'clothes';
  if (d.tool || d.weapon || d.bow || id === 'flecha' || d.vehicle || id === 'brujula' || /^mapa/.test(id) || id === 'pelota' || id === 'cepillo') return 'tools';
  if (d.food || d.heal || d.potion || d.buff) return 'food';
  if (d.place || d.seed || d.sapling || d.flower || d.bug || d.fossil || d.relic || d.gem) return 'other';
  return 'materials';
}
const TABS = ['all', 'tools', 'materials', 'food', 'clothes', 'other'];
const kg = n => Math.round(n * 10) / 10;

// The load line: a bar that fills up to 150 % (the mark: 100 %), green, amber when loaded and red when overloaded; in
// creative, "No limit"
// arms: the kg of what the arms carry (0: nothing), shown apart: a striped stretch after the load and "+ 25" in the
// numbers (the speed rules do not add it: carry.js; but you should see you carry it)
export function loadLine(el, inv, arms = 0) {
  if (!el.firstChild) el.innerHTML = '<span></span><div class="pk-bar"><i></i><u></u><s></s></div><b></b>';
  const [label, bar, num] = el.children, r = inv.load, inf = !isFinite(inv.capKg), cls = r > HEAVY ? 'over' : r > 1 ? 'heavy' : '';
  label.textContent = t('gui.inventory.load_label');
  bar.hidden = inf;
  const w = Math.min(1, r / HEAVY), a = inf || !arms ? 0 : Math.min(1 - w, arms / inv.capKg / HEAVY);
  bar.children[0].style.width = `${w * 100}%`;
  bar.children[1].style.cssText = `left: ${w * 100}%; width: ${a * 100}%`;
  bar.className = 'pk-bar ' + cls; el.className = 'pk-load ' + (inf ? '' : cls);
  const v = { kg: kg(inv.kg), cap: inv.capKg, arms };
  num.textContent = inf ? t('gui.inventory.no_limit') : t(arms ? 'gui.inventory.load_arms' : 'gui.inventory.load', v);
  el.title = inf ? '' : t(arms ? 'gui.inventory.load_title_arms' : 'gui.inventory.load_title', v);
}
// One row per stack of the list (rows: the slots), in the element given; pick(i) on a click. Reuses the rows it has
function paintRows(list, inv, slots, picked, onRow) {
  const rows = list.children;
  while (rows.length > slots.length) list.lastChild.remove();
  slots.forEach((i, k) => {
    let el = rows[k];
    if (!el) { el = document.createElement('div'); el.className = 'pk-row'; el.innerHTML = '<img alt="" draggable="false"><span></span><em></em><b></b>'; list.append(el); onRow(el); }
    const s = inv.slots[i], [img, name, n, w] = el.children, url = itemIconUrl(s.id, s.color);
    el.dataset.i = i;
    if (img.getAttribute('src') !== url) img.src = url;
    name.textContent = ITEMS[s.id].name;
    n.textContent = s.n > 1 ? `×${s.n}` : '';
    w.textContent = inv.infinite ? '' : t('gui.inventory.kg', { kg: kg(weightOf(s.id) * s.n) });   // (creative: no limit, so no weights)
    el.title = ITEMS[s.id].name + (ITEMS[s.id].dur ? ` (${s.dur ?? ITEMS[s.id].dur}/${ITEMS[s.id].dur})` : '');
    el.classList.toggle('sel', i === picked);
  });
}
// The list says when there is more below than shows (a fade at the bottom and "+8 more"), as it scrolls
function moreBelow(list, more) {
  const sync = () => {
    const hid = list.scrollHeight - list.clientHeight - list.scrollTop > 4, rows = list.children, n = hid ? [...rows].filter(r => r.offsetTop - list.offsetTop >= list.scrollTop + list.clientHeight - 6).length : 0;
    list.classList.toggle('more', hid);
    if (more) { more.hidden = !n; more.textContent = n ? t('gui.inventory.more', { n }) : ''; }
  };
  if (!list.dataset.more) { list.dataset.more = '1'; list.addEventListener('scroll', sync, { passive: true }); }
  sync();
}
// The slots of the list, the heaviest first, with the tab's kind
const rowsOf = (inv, tab = 'all') => inv.listSlots().filter(i => tab === 'all' || kindOf(inv.slots[i].id) === tab).sort((a, b) => weightOf(inv.slots[b].id) * inv.slots[b].n - weightOf(inv.slots[a].id) * inv.slots[a].n || a - b);

// The inventory window. ui: { pick(i), picked(), wear(i), drop(i, n), say(text) } (from ui/inventory.js)
export function initPackList(game, ui) {
  style();
  const box = document.querySelector('#s-inv .inv-bagbox'), top = document.createElement('div'), pack = document.createElement('div');
  top.id = 'pk-top'; pack.id = 'pk-box';
  top.innerHTML = '<div class="pk-load"></div><div class="pk-arms" hidden><img alt=""><span></span><button class="btn" type="button"></button></div>';
  pack.innerHTML = `<div class="pk-tabs"></div><div class="pk-list"></div><div class="pk-more" hidden></div><div class="pk-none" hidden></div>`;
  box.parentNode.insertBefore(top, box.previousElementSibling);   // (above "Backpack": the load is of everything, the hotbar too)
  box.prepend(pack);
  const load = top.children[0], arms = top.children[1], tabs = pack.children[0], list = pack.children[1], more = pack.children[2], none = pack.children[3];
  let tab = 'all';
  for (const k of TABS) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.k = k;
    b.onclick = () => { tab = k; list.scrollTop = 0; refresh(); };
    tabs.append(b);
  }
  arms.querySelector('button').onclick = () => { game.carry?.drop(); refresh(); };
  // Dragging a row: to a slot of the hotbar (at hand), to the body (put on) or out of the window (dropped)
  const ghost = $('inv-ghost');
  let drag = null;
  const onRow = el => {
    el.addEventListener('pointerdown', e => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* (a pointer the page did not see go down) */ } drag = { i: +el.dataset.i, el, x: e.clientX, y: e.clientY, moving: false }; });
    el.addEventListener('pointermove', e => {
      if (!drag || drag.el !== el) return;
      if (!drag.moving && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) {
        const s = game.inv.slots[drag.i];
        if (!s) { drag = null; return; }
        drag.moving = true; el.classList.add('lift');
        ghost.src = itemIconUrl(s.id, s.color); ghost.hidden = false;
      }
      if (drag.moving) { ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px'; }
    });
    el.addEventListener('pointerup', e => {
      if (!drag || drag.el !== el) return;
      const d = drag;
      drag = null; ghost.hidden = true; el.classList.remove('lift');
      if (!d.moving) { ui.pick(d.i); return; }
      const under = document.elementFromPoint(e.clientX, e.clientY), to = under?.closest('#inv-quick .slot');
      if (to) { game.inv.move(d.i, +to.dataset.i); ui.pick(+to.dataset.i); }
      else if (under?.closest('#inv-wear, #inv-me')) { if (ITEMS[game.inv.slots[d.i]?.id]?.wear) ui.wear(d.i); }
      else if (!under?.closest('.inv-panel, .win, #hotbar')) ui.drop(d.i, Infinity);
    });
    el.addEventListener('pointercancel', () => { drag = null; ghost.hidden = true; el.classList.remove('lift'); });
  };
  function refresh() {
    const inv = game.inv;
    if (!inv.weight) return;
    const held = game.carry?.held;
    loadLine(load, inv, held ? BULKY[held].kg : 0);
    arms.hidden = !held;
    if (held) {
      const img = arms.children[0], url = itemIconUrl(held);
      if (img.getAttribute('src') !== url) img.src = url;
      arms.children[1].textContent = t('gui.inventory.in_arms', { item: ITEMS[held], kg: BULKY[held].kg });
      arms.children[2].textContent = t('gui.inventory.put_down');
    }
    for (const b of tabs.children) { b.textContent = t('gui.inventory.tab.' + b.dataset.k); b.classList.toggle('on', b.dataset.k === tab); }
    const slots = rowsOf(inv, tab);
    paintRows(list, inv, slots, ui.picked(), onRow);
    moreBelow(list, more);
    none.hidden = slots.length > 0 || inv.cap <= HOTBAR;
    none.textContent = t(inv.listSlots().length ? 'gui.inventory.none_here' : 'gui.inventory.pack_empty');
  }
  // (a game without the weight inventory, after one with it: the grid back)
  const show = on => { document.body.classList.toggle('pk-on', on); top.hidden = pack.hidden = !on; };
  // (each time the window opens: from the top, where the heaviest are)
  const toTop = () => { tab = 'all'; list.scrollTop = 0; };
  return { refresh, show, toTop };
}

// A hotbar slot or the list dropped on the list: to the list (the first hole, or at the end). Only with a backpack
export function toList(inv, i) {
  if (!inv.weight || inv.cap <= HOTBAR || i >= HOTBAR) return false;
  const S = inv.slots, j = S.findIndex((s, k) => k >= HOTBAR && !s);
  if (j >= 0) inv.move(i, j);
  else { S.push(S[i]); S[i] = null; inv.changed(); }
  return true;
}

// The side of the backpack in the chest window: the load and the rows (onPick(i): to the chest)
// top: from the top of the list (the window has just opened). arms: the kg of what the arms carry
export function packRows(parent, inv, onPick, { top = false, arms = 0 } = {}) {
  style();
  let el = $('ch-pack');
  if (!el) {
    el = document.createElement('div'); el.id = 'ch-pack';
    el.innerHTML = '<div class="pk-load"></div><div class="pk-list"></div><div class="pk-more" hidden></div>';
    parent.after(el);
  }
  loadLine(el.children[0], inv, arms);
  if (top) el.children[1].scrollTop = 0;
  paintRows(el.children[1], inv, rowsOf(inv), null, row => row.addEventListener('pointerdown', e => { e.preventDefault(); onPick(+row.dataset.i); }));
  moreBelow(el.children[1], el.children[2]);
  return el;
}
