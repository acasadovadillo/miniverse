// The window of a player's business (docs/planes/gta/PLAN-H-pueblo-vivo.md §3.5; what it does: business.js). Three faces of it:
// opening one (what a shop and a tavern need), running it (Goods, Till, Sales, Hours) and, for the other players, buying. It does
// not stop the game, like the chest's (windows.js). And what is over the counters in the world: the till's chip, near yours
import { ITEMS, itemNoun } from '../items.js';
import { stackPrice } from '../economy.js';
import { PCT, HOUR_IDS, fairOf, unitPrice, onSale, sellable, lotIds, served, CAP } from '../bizrules.js';
import { weekdayOf } from '../routines.js';
import { itemIconUrl } from '../art/items.js';
import { catchMark, catchText } from './catchmark.js';
import { Audio } from '../audio.js';
import { reportFault } from '../faults.js';
import { Vector3 } from 'three';
import { t, fmt, getLang } from '../i18n.js';

const DAY = 864e5, HOUR = 36e5, FAR = 5.5, CHIP_R = 6;
const $ = id => document.getElementById(id);
const CSS = `
#s-biz .panel { padding: 14px 16px 16px; width: min(500px, calc(100vw - 24px)); box-sizing: border-box; }
#s-biz h2 { margin: 0 0 8px; font-size: 20px; color: var(--gold); display: flex; align-items: center; justify-content: space-between; padding-bottom: 8px; }
#s-biz h2 .sq { width: 34px; height: 30px; font-size: 17px; }
#biz-tabs { display: flex; gap: 4px; margin-bottom: 8px; } #biz-tabs:empty { display: none; }
#biz-tabs button { padding: 4px 12px; border-radius: var(--r-s, 4px); border: 1px solid transparent; background: rgba(255, 255, 255, .07); color: rgba(255, 255, 255, .8); font: 500 15px/1.3 var(--font-ui); cursor: pointer; }
#biz-tabs button:hover { color: #fff; background: rgba(255, 255, 255, .14); } #biz-tabs button.on { color: #0c0e12; background: #fff; }
#biz-line { display: flex; justify-content: space-between; gap: 12px; font: 500 14px/1.35 var(--font-ui); color: var(--ink-2, #d8c8a8); margin-bottom: 6px; }
#biz-line b { color: var(--ink, #f4eee0); font-weight: 600; } #biz-line .open { color: #b9dba2; } #biz-line .shut { color: #e0a58c; }
#biz-note { min-height: 18px; font: 500 14px/1.3 var(--font-ui); color: #ffd9a0; margin: 6px 0 0; }
#biz-body { max-height: min(58vh, 470px); overflow-y: auto; display: flex; flex-direction: column; gap: 4px; scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, .32) transparent; }
#biz-body h3 { margin: 8px 0 2px; font: 500 13px/1.2 var(--font-title); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2, #d8c8a8); }
#biz-body .sh-row { padding: 5px 8px; } #biz-body .sh-row .btn { padding: 3px 9px; font-size: 14px; }
#biz-body .biz-price { display: flex; align-items: center; gap: 4px; } #biz-body .biz-price b { min-width: 58px; text-align: center; font-size: 15px; color: var(--coins, #ffe08a); }
#biz-body .biz-price button { width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; background: rgba(255, 255, 255, .1); color: #fff; font-size: 16px; line-height: 1; cursor: pointer; } #biz-body .biz-price button:hover { background: rgba(255, 255, 255, .25); }
#biz-body .biz-price button:disabled { opacity: .35; cursor: default; }
#biz-body .sh-row small { white-space: normal; } #biz-body .sh-row small.dear { color: #e8b49a; } #biz-body .sh-row small.good { color: #bcdca6; }
#biz-body p { margin: 2px 0; font: 500 14px/1.4 var(--font-ui); color: var(--ink-2, #d8c8a8); }
#biz-body .biz-till { font: 500 30px/1.1 var(--font-title); color: var(--coins, #ffe08a); }
#biz-body .biz-days { display: flex; align-items: flex-end; gap: 6px; height: 96px; margin-top: 6px; } #biz-body .biz-days div { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 3px; height: 100%; font: 500 12px/1 var(--font-ui); color: var(--ink-2, #d8c8a8); }
#biz-body .biz-days i { width: 100%; background: linear-gradient(rgba(255, 224, 138, .85), rgba(255, 224, 138, .35)); border-radius: 3px 3px 0 0; min-height: 2px; }
#biz-body .biz-kind { padding: 10px 12px; border-radius: var(--r-s, 4px); background: rgba(255, 255, 255, .05); } #biz-body .biz-kind .btn { margin: 8px 0 0; width: auto; padding: 6px 16px; }
#biz-body .biz-kind b { font: 500 17px/1.2 var(--font-title); color: var(--ink, #f4eee0); } #biz-body .biz-need { font: 500 14px/1.5 var(--font-ui); color: var(--ink-2, #d8c8a8); } #biz-body .biz-need::before { content: '○ '; } #biz-body .biz-need.ok { color: #bcdca6; } #biz-body .biz-need.ok::before { content: '✓ '; }
#biz-body label { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--r-s, 4px); background: rgba(255, 255, 255, .05); font: 500 15px/1.3 var(--font-ui); cursor: pointer; } #biz-body label:hover { background: rgba(255, 255, 255, .12); }
.biz-chip { position: absolute; left: 0; top: 0; padding: 3px 10px; border-radius: 999px; background: rgba(10, 12, 16, .78); color: var(--coins, #ffe08a); font: 500 14px/1.35 var(--font-title); letter-spacing: .03em; white-space: nowrap; pointer-events: none; } .biz-chip small { display: block; text-align: center; font: 500 11px/1.2 var(--font-ui); color: #d8d2c4; letter-spacing: 0; }
`;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const at = ms => { const d = Math.floor(ms / DAY), h = (ms - d * DAY) / HOUR; return `${t(`time.weekday.${weekdayOf(d)}`)} ${Math.floor(h)}:${String(Math.floor(h % 1 * 60)).padStart(2, '0')}`; };

export function initBizUI(game, wins) {
  const style = document.head.appendChild(document.createElement('style'));
  style.textContent = CSS;
  const sec = document.body.appendChild(el('section', 'win'));
  sec.id = 's-biz';
  sec.innerHTML = '<div class="panel"><h2><span id="biz-title"></span> <button class="sq" id="biz-close">✕</button></h2><div id="biz-tabs"></div><div id="biz-line"></div><div id="biz-body"></div><div id="biz-note"></div></div>';
  let key = null, tab = 'goods', note = '', shown = '', noteAt = 0, held = false;
  // (nothing is drawn again under a button being pressed: the click would be lost)
  sec.addEventListener('pointerdown', () => { held = true; }, true);
  for (const ev of ['pointerup', 'pointercancel', 'blur']) addEventListener(ev, () => { held = false; }, true);
  const B = () => game.business, say = s => { note = s || ''; noteAt = performance.now(); };
  const done = (ok, v) => { if (!ok) { Audio.error(); say(t(v?.poor ? 'biz.no.money' : v?.full ? 'biz.no.room' : v?.why || 'biz.no.refused')); } shown = ''; };
  wins.add('s-biz', { close: 'biz-close', spot: wins.defaults.right, onClose: () => { key = null; } });
  $('biz-close').setAttribute('aria-label', t('common.close'));
  $('biz-close').addEventListener('click', () => wins.close('s-biz'));

  function row(s, sub, cls) {
    const r = el('div', 'sh-row'), img = el('img'), d = el('div'), small = el('small', cls, sub);
    img.alt = ''; img.src = itemIconUrl(s.id, s.color);
    small.title = sub;
    d.append(el('b', '', t('shop.stack', { item: ITEMS[s.id].name, n: s.n })), small);
    r.append(img, d);
    catchMark(r, s);
    $('biz-body').append(r);
    return r;
  }
  function btn(to, text, fn, ok = true) { const b = el('button', 'btn', text); b.type = 'button'; b.disabled = !ok; b.onclick = () => { fn(); shown = ''; frame(true); }; to.append(b); return b; }
  const head = text => $('biz-body').append(el('h3', '', text)), p = text => $('biz-body').append(el('p', '', text));

  // ---------- opening one ----------
  const NEEDS = { shop: ['counter'], tavern: ['counter', 'roof', 'barrel', 'seats', 'table'] };
  function drawNew() {
    $('biz-title').textContent = t('biz.new.title');
    for (const kind of ['shop', 'tavern']) {
      const P = B().premises(key, kind), box = el('div', 'biz-kind'), has = { counter: P.why !== 'no_counter', roof: P.roof, barrel: P.barrels > 0, seats: P.seats.length >= 2, table: P.tables > 0 };
      const mine = B().has(kind);
      box.append(el('b', '', t(`biz.kind.${kind}`)), el('p', '', t(`biz.kind.${kind}.desc`)));
      for (const n of NEEDS[kind]) box.append(el('div', 'biz-need' + (has[n] ? ' ok' : ''), t(`biz.need.${n}`)));
      box.append(el('div', 'biz-need' + (P.shelves.length ? ' ok' : ''), t('biz.need.shelves', { n: P.cap })));
      if (mine) box.append(el('p', '', t(`biz.why.one_${kind}`)));
      btn(box, t(`biz.open.${kind}`), () => B().open(key, kind, (ok, v) => { done(ok, v); if (ok) { Audio.unlock(); tab = 'goods'; } }), P.ok && !mine && !B().waiting());
      $('biz-body').append(box);
    }
    const far = B().far(key);
    p(t(far <= 30 ? 'biz.far.near' : far <= 200 ? 'biz.far.road' : 'biz.far.none'));
  }
  const isMe = rec => B().mine(rec);

  // ---------- running it ----------
  function goods(rec) {
    const P = B().premises(key, rec.kind), sale = new Set(onSale(rec, P.cap)), L = lotIds(rec);
    head(t('biz.goods.on_sale', { n: L.length, max: P.cap }));
    if (!L.length) p(t('biz.goods.none'));
    for (const lot of L) {
      const s = rec.goods[lot], price = unitPrice(s), fair = fairOf(rec, s), off = !sale.has(lot);
      const r = row(s, [off ? t('biz.goods.stored') : t('biz.fair', { n: fair }), catchText(s)].filter(Boolean).join(' · '), off ? 'dear' : price > fair * 1.25 ? 'dear' : price <= fair ? 'good' : '');
      if (!off) r.querySelector('small').title = t('biz.fair.hint', { n: fair });
      const q = el('div', 'biz-price'), step = d => { B().price(key, s.id, s.m + d, done); };
      const b1 = el('button', '', '−'), b2 = el('button', '', '+');
      b1.type = b2.type = 'button'; b1.disabled = s.m <= PCT.min; b2.disabled = s.m >= PCT.max;
      b1.title = b2.title = t('biz.price.hint', { pct: s.m });
      b1.onclick = e => { step(e.shiftKey ? -50 : -PCT.step); shown = ''; frame(true); }; b2.onclick = e => { step(e.shiftKey ? 50 : PCT.step); shown = ''; frame(true); };
      q.append(b1, el('b', '', `${price} 🪙`), b2);
      r.append(q);
      btn(r, t('biz.take.one'), () => B().take(key, lot, 1, done), !B().waiting('shop_take'));
      if (s.n > 1) btn(r, t('biz.take.all'), () => B().take(key, lot, s.n, done), !B().waiting('shop_take'));
    }
    head(t('biz.goods.yours'));
    let any = false;
    game.inv.slots.forEach((s, i) => {
      if (!s || s.map || !sellable(s, rec.kind)) return;
      any = true;
      const r = row(s, [t('biz.goods.worth', { n: stackPrice(s) }), catchText(s)].filter(Boolean).join(' · ')), full = L.length >= P.cap && !L.some(l => rec.goods[l].id === s.id);
      btn(r, t('biz.put.one'), () => B().put(key, i, 1, done), !full);
      if (s.n > 1) btn(r, t('biz.put.all'), () => B().put(key, i, s.n, done), !full);
    });
    if (!any) p(t(rec.kind === 'tavern' ? 'biz.goods.no_food' : 'biz.goods.nothing'));
    else if (L.length >= P.cap) p(t(P.cap < CAP.max ? 'biz.goods.full' : 'biz.goods.full_max', { n: P.cap }));
  }
  function till(rec) {
    const b = el('div', 'biz-till', `${fmt.num(rec.till)} 🪙`);
    $('biz-body').append(b);
    btn($('biz-body'), t('biz.collect'), () => B().collect(key, (ok, v) => { done(ok, v); if (ok) { Audio.pickup(); say(t('biz.collected', { n: v.pay })); } }), rec.till > 0 && !B().waiting('shop_collect')).style.width = 'auto';
    head(t('biz.till.week'));
    const today = Math.floor(B().now() / DAY), max = Math.max(1, ...Object.values(rec.hist || {}).map(h => h[1])), box = el('div', 'biz-days');
    for (let d = today - 6; d <= today; d++) {
      const h = rec.hist?.[d] || [0, 0], c = el('div'), i = el('i');
      i.style.height = `${Math.round(h[1] / max * 64)}px`;
      c.title = t('biz.till.day', { n: h[0], coins: h[1] });
      c.append(el('span', '', h[1] ? fmt.num(h[1]) : ''), i, el('span', '', t(`time.weekday.${weekdayOf(d)}`)));
      box.append(c);
    }
    $('biz-body').append(box);
    p(t('biz.till.total', { n: rec.tot?.[0] || 0, coins: rec.tot?.[1] || 0 }));
  }
  function sales(rec) {
    head(t('biz.sales.last'));
    const L = [...(rec.log || [])].reverse();
    if (!L.length) p(t('biz.sales.none'));
    for (const [ms, who, id, n, coins] of L) if (ITEMS[id]) row({ id, n }, t('biz.sales.row', { when: at(ms), name: B().whoName(who), coins }));
    const best = Object.entries(rec.best || {}).filter(([id]) => ITEMS[id]).sort((a, b) => b[1][1] - a[1][1]).slice(0, 5);
    if (best.length) { head(t('biz.sales.best')); for (const [id, [n, coins]] of best) row({ id, n }, t('biz.sales.sum', { coins })); }
  }
  function hours(rec) {
    head(t('biz.hours.title'));
    for (const h of HOUR_IDS) {
      const l = el('label'), i = el('input');
      i.type = 'radio'; i.name = 'biz-hours'; i.checked = rec.hours === h;
      i.onchange = () => B().hours(key, h, rec.sun, done);
      l.append(i, el('span', '', t(`biz.hours.${h}`)));
      $('biz-body').append(l);
    }
    const l = el('label'), i = el('input');
    i.type = 'checkbox'; i.checked = !!rec.sun;
    i.onchange = () => B().hours(key, rec.hours, i.checked, done);
    l.append(i, el('span', '', t('biz.hours.sun')));
    $('biz-body').append(l);
    head(t('biz.close.title'));
    const empty = !Object.keys(rec.goods).length && !(rec.till > 0);
    p(t(empty ? 'biz.close.ready' : 'biz.close.first'));
    btn($('biz-body'), t('biz.close.btn'), () => B().close(key, (ok, v) => { done(ok, v); if (ok) { Audio.door?.(); wins.close('s-biz'); } }), empty && !B().waiting()).style.width = 'auto';
  }
  // ---------- buying ----------
  function drawBuy(rec) {
    const P = B().premises(key, rec.kind), L = onSale(rec, P.cap).filter(l => rec.goods[l].n > 0 && sellable(rec.goods[l], rec.kind));
    if (!P.ok) p(t(`biz.why.${P.why}`));
    if (!L.length) p(t('biz.buy.none'));
    for (const lot of L) {
      const s = rec.goods[lot], c = unitPrice(s), free = !B().waiting('shop_buy');
      const r = row(s, [t('shop.each', { price: c }), catchText(s)].filter(Boolean).join(' · '));
      if (rec.kind === 'tavern' && served(s.id)) btn(r, t(ITEMS[s.id].drink ? 'biz.drink' : 'biz.eat'), () => B().buy(key, lot, 1, done, true), free && game.money >= c);
      btn(r, t('shop.buy'), () => B().buy(key, lot, 1, (ok, v) => { done(ok, v); if (ok) Audio.pickup(); }), free && game.money >= c);
      if (s.n >= 5) btn(r, '×5', () => B().buy(key, lot, 5, (ok, v) => { done(ok, v); if (ok) Audio.pickup(); }), free && game.money >= c * 5);
    }
  }
  const TABS = { goods, till, sales, hours };
  function draw() {
    const rec = B().at(key), mine = rec && isMe(rec), body = $('biz-body'), top = body.scrollTop;
    body.textContent = ''; $('biz-tabs').textContent = ''; $('biz-line').textContent = '';
    if (!rec) drawNew();
    else {
      $('biz-title').textContent = B().nameOf(rec);
      const P = B().premises(key, rec.kind), open = B().isOpen(rec), l = el('span', open ? 'open' : 'shut', t(open ? 'biz.slate.open' : 'biz.slate.closed') + ' · ' + t(`biz.hours.${rec.hours}`));
      $('biz-line').append(l, el('span', '', mine ? t('biz.line.till', { n: rec.till }) : t('biz.line.money', { n: game.money })));
      if (mine) {
        for (const id of Object.keys(TABS)) { const b = el('button', tab === id ? 'on' : '', t(`biz.tab.${id}`)); b.type = 'button'; b.onclick = () => { tab = id; say(''); draw(); $('biz-body').scrollTop = 0; }; $('biz-tabs').append(b); }
        if (!P.ok) { const w = el('p', '', t('biz.why.stopped', { why: t(`biz.why.${P.why}`) })); w.style.color = '#e8b49a'; body.append(w); }
        TABS[tab](rec);
      } else drawBuy(rec);
    }
    $('biz-note').textContent = B().waiting() ? t('biz.wait') : note;
    body.scrollTop = top;
  }
  function frame(now = false) {
    chip();
    if (!key || !wins.isOpen('s-biz')) return;
    const C = B().counter(key), q = game.player;
    if (!q || game.scene !== game.world || !C || Math.hypot(C.x - q.x, C.y - q.y) > FAR) { wins.close('s-biz'); return; }
    if (note && performance.now() - noteAt > 5000) { note = ''; shown = ''; }
    const sig = `${getLang()}|${key}|${tab}|${B().v}|${game.inv.v}|${game.money}|${Math.floor(B().now() / 6e4)}|${B().waiting()}|${note}`;
    if (!now && (sig === shown || held)) return;
    shown = sig;
    draw();
  }
  // ---------- over the counters ----------
  let chipEl = null;
  const v = new Vector3();
  function chip() {
    const b = B(), q = game.player;
    let best = null;
    if (b?.shops.size && q && game.mode === 'play' && game.scene === game.world && game.view3d.camera && !wins.isOpen('s-biz')) {
      let d = CHIP_R;
      for (const { key: k, rec } of b.list()) {
        if (!b.mine(rec)) continue;
        const C = b.counter(k), r = C && Math.hypot(C.x - q.x, C.y - q.y);
        if (C && r < d) { d = r; best = { C, rec }; }
      }
    }
    if (!best) { if (chipEl) chipEl.style.display = 'none'; return; }
    chipEl ||= (document.getElementById('floaters') || document.body).appendChild(el('div', 'biz-chip'));
    v.set(best.C.x, game.view3d.groundY(game.world, best.C.x, best.C.y) + 1.62, best.C.y).project(game.view3d.camera);
    if (v.z > 1) { chipEl.style.display = 'none'; return; }
    const text = t('biz.chip', { n: best.rec.till }), sub = t(b.isOpen(best.rec) ? 'biz.slate.open' : 'biz.slate.closed');
    if (chipEl.dataset.s !== text + sub) { chipEl.dataset.s = text + sub; chipEl.textContent = text; chipEl.append(el('small', '', sub)); }
    chipEl.style.display = '';
    chipEl.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
  }
  return {
    frame() { try { frame(); } catch (e) { reportFault(e, 'BizUI.frame'); } },
    open(k) { key = k; shown = ''; note = ''; if (!B().at(k)) tab = 'goods'; wins.open('s-biz'); draw(); $('biz-body').scrollTop = 0; },
    get key() { return key; },
  };
}
// The journal's page (ui/journal.js)
export function bizJournal(game) {
  const B = game.business, L = B.list().filter(e => B.mine(e.rec));
  return L.map(({ rec }) => {
    const today = Math.floor(B.now() / DAY), h = rec.hist?.[today] || [0, 0], week = Object.values(rec.hist || {}).reduce((a, x) => a + x[1], 0);
    const best = Object.entries(rec.best || {}).filter(([id]) => ITEMS[id]).sort((a, b) => b[1][1] - a[1][1]).slice(0, 3).map(([id, [n]]) => t('shop.stack', { item: ITEMS[id].name, n }));
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const last = (rec.log || []).slice(-5).reverse().filter(x => ITEMS[x[2]]).map(([ms, who, id, n, coins]) => `<div class="j-row"><b>${esc(t('shop.stack', { item: ITEMS[id].name, n }))}</b><span>${coins} 🪙</span><small>${esc(at(ms))} · ${esc(B.whoName(who))}</small></div>`).join('');
    return `<h3>${esc(B.nameOf(rec))}</h3><div class="j-row"><b>${esc(t('biz.chip', { n: rec.till }))}</b><span>${esc(t(B.isOpen(rec) ? 'biz.slate.open' : 'biz.slate.closed'))}</span><small>${esc(t('biz.journal.sum', { n: h[0], coins: h[1], week }))}${best.length ? ` · ${esc(t('biz.journal.best', { list: fmt.list(best) }))}` : ''}</small></div>${last}`;
  }).join('');
}
