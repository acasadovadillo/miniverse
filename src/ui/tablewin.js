// The window of the table games (docs/planes/gta/PLAN-I-juntos.md §4.2; what it does: tablegames.js). It opens by itself when you sit
// at a table with something to play with, and closes when you get up. It does not stop the game (windows.js), and the page is
// written only when what it shows changes. Keys while it is open: 1 to 9, its buttons or your tiles (main.js gives them here first)
import { Audio } from '../audio.js';
import { reportFault } from '../faults.js';
import { STAKES, RULES, liveRec } from '../tablegames.js';
import { places } from '../tg/tiles.js';
import { TARGET } from '../tg/crows.js';
import { Profile } from '../accounts.js';
import { t, tList, getLang } from '../i18n.js';

const $ = id => document.getElementById(id);
// (our own crow, seen from the side)
export const CROW = 'M3 13.5 8.2 11c.8-2.600 2.800-4.500 5.600-4.900 1.500-.2 2.800.1 3.800.9l3.900 1-3.500 1.200c-.1 3-1.700 5.700-4.500 7l-.6 3.300h-1.200l.2-2.900c-.5.1-1 .1-1.500.1l-.9 2.800H8.300l.8-3c-2.500-.3-4.400-1.200-6.100-3Z';
const CSS = `
#s-table .panel { padding: 14px 16px 14px; width: min(400px, calc(100vw - 24px)); box-sizing: border-box; }
#s-table h2 { margin: 0 0 8px; font-size: 20px; color: var(--gold); display: flex; align-items: center; justify-content: space-between; padding-bottom: 8px; }
#s-table h2 .sq { width: 34px; height: 30px; font-size: 17px; }
#s-table h2 .tg-pot { margin-left: auto; margin-right: 10px; font: 500 18px/1 var(--font-title); color: var(--coins, #ffe08a); }
#tg-body { display: flex; flex-direction: column; gap: 8px; max-height: min(70vh, 600px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, .32) transparent; }
#tg-body h3 { margin: 4px 0 0; font: 500 13px/1.2 var(--font-title); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2, #d8c8a8); }
#tg-body p, #tg-body summary, #tg-body li { margin: 0; font: 500 14px/1.4 var(--font-ui); color: var(--ink-2, #d8c8a8); } #tg-body ul { margin: 4px 0 0; padding-left: 18px; } #tg-body summary { cursor: pointer; }
#tg-body .tg-cards { display: flex; gap: 6px; } #tg-body .tg-card { flex: 1; text-align: left; padding: 9px 11px; border: 1px solid transparent; border-radius: var(--r-s, 4px); background: rgba(255, 255, 255, .06); color: var(--ink, #f4eee0); cursor: pointer; font: 500 14px/1.35 var(--font-ui); }
#tg-body .tg-card b { display: block; font: 500 17px/1.2 var(--font-title); margin-bottom: 3px; } #tg-body .tg-card small { color: var(--ink-2, #d8c8a8); font-size: 13px; } #tg-body .tg-card:hover { background: rgba(255, 255, 255, .12); } #tg-body .tg-card.on { border-color: var(--accent, #ffd77a); background: rgba(255, 255, 255, .12); }
#tg-body .tg-stakes { display: flex; gap: 4px; flex-wrap: wrap; } #tg-body .tg-stakes button { min-width: 46px; padding: 4px 8px; border: 1px solid transparent; border-radius: var(--r-s, 4px); background: rgba(255, 255, 255, .07); color: var(--ink, #f4eee0); font: 500 15px/1.3 var(--font-ui); cursor: pointer; } #tg-body .tg-stakes button.on { background: #fff; color: #0c0e12; } #tg-body .tg-stakes button:disabled { opacity: .35; cursor: default; }
#tg-body .tg-seat { display: flex; align-items: center; gap: 9px; padding: 5px 9px; border-radius: var(--r-s, 4px); background: rgba(255, 255, 255, .05); font: 500 15px/1.3 var(--font-ui); color: var(--ink, #f4eee0); } #tg-body .tg-seat i { width: 10px; height: 10px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, .3); flex: none; } #tg-body .tg-seat.turn i { border-color: var(--accent, #ffd77a); background: var(--accent, #ffd77a); } #tg-body .tg-seat.out { opacity: .45; } #tg-body .tg-seat span { flex: 1; } #tg-body .tg-seat small { color: var(--ink-2, #d8c8a8); font-size: 13px; } #tg-body .tg-seat b { font: 500 18px/1 var(--font-title); }
#tg-body .tg-seat.pick { cursor: pointer; } #tg-body .tg-seat .bar { flex: none; width: 76px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, .14); overflow: hidden; } #tg-body .tg-seat .bar u { display: block; height: 100%; background: var(--accent, #ffd77a); }
#tg-body .tg-table { display: flex; align-items: center; gap: 10px; min-height: 62px; padding: 8px 12px; border-radius: var(--r-s, 4px); background: rgba(0, 0, 0, .28); } #tg-body .tg-table .sum { margin-left: auto; text-align: right; font: 500 14px/1.3 var(--font-ui); color: var(--ink-2, #d8c8a8); } #tg-body .tg-table .sum b { display: block; font: 500 26px/1 var(--font-title); color: var(--ink, #f4eee0); }
.tg-die { width: 42px; height: 42px; border-radius: 8px; background: linear-gradient(145deg, #f6efdf, #d9ccb2); box-shadow: inset 0 -3px 5px rgba(70, 50, 20, .35), 0 2px 4px rgba(0, 0, 0, .5); display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr); padding: 6px; box-sizing: border-box; } .tg-die u { width: 7px; height: 7px; border-radius: 50%; background: #2b2018; align-self: center; justify-self: center; } .tg-die svg { grid-area: 1 / 1 / 4 / 4; width: 100%; height: 100%; fill: #17130f; } .tg-die.rolling { animation: tg-roll .55s ease-out; }
@keyframes tg-roll { from { transform: translateY(-14px) rotate(-160deg); opacity: .3; } 60% { transform: translateY(2px) rotate(18deg); opacity: 1; } to { transform: none; } }
.tg-crow { width: 24px; height: 24px; } .tg-crow svg { width: 100%; height: 100%; fill: rgba(255, 255, 255, .16); } .tg-crow.on svg { fill: #0a0a0c; filter: drop-shadow(0 0 2px rgba(255, 190, 120, .9)); }
#tg-body .tg-bridge { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; min-height: 40px; padding: 8px 10px; border-radius: var(--r-s, 4px); background: rgba(0, 0, 0, .28); }
#tg-body .tg-hand { display: flex; flex-wrap: wrap; gap: 8px 6px; align-items: flex-end; }
.tg-tile { display: inline-flex; border-radius: 4px; background: linear-gradient(160deg, #5d3d26, #3d2716); box-shadow: inset 0 0 0 1px rgba(255, 220, 170, .22), 0 1px 3px rgba(0, 0, 0, .55); } .tg-tile.up { flex-direction: column; } .tg-tile em { width: 23px; height: 23px; display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr); padding: 3px; box-sizing: border-box; } .tg-tile em u { width: 4.500px; height: 4.500px; border-radius: 50%; background: #f1e6cf; align-self: center; justify-self: center; } .tg-tile em + em { border-left: 1px solid rgba(0, 0, 0, .55); } .tg-tile.up em + em { border-left: 0; border-top: 1px solid rgba(0, 0, 0, .55); } .tg-tile.end { box-shadow: inset 0 0 0 2px var(--accent, #ffd77a); }
.tg-mine { position: relative; padding: 0; border: 0; background: none; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 3px; opacity: .5; } .tg-mine.ok { opacity: 1; } .tg-mine.ok:hover .tg-tile { transform: translateY(-3px); } .tg-mine .tg-tile em { width: 30px; height: 30px; } .tg-mine .tg-tile em u { width: 6px; height: 6px; } .tg-mine kbd { font: 500 11px/1 var(--font-ui); color: var(--ink-2, #d8c8a8); } .tg-mine .ends { display: flex; gap: 2px; } .tg-mine .ends span { padding: 2px 7px; border-radius: 4px; background: rgba(255, 255, 255, .14); font: 500 13px/1 var(--font-ui); color: #fff; } .tg-mine .ends span:hover { background: rgba(255, 255, 255, .34); }
#tg-body .tg-acts { display: flex; gap: 6px; } #tg-body .tg-acts .btn { flex: 1; width: auto; margin: 0; padding: 8px 10px; font-size: 16px; } #tg-body .tg-acts .btn kbd { margin-left: 7px; font: 500 12px/1 var(--font-ui); opacity: .75; }
#tg-log { min-height: 19px; font: 500 14px/1.3 var(--font-ui); color: #ffd9a0; }
`;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const PIPS = [[], [5], [1, 9], [1, 5, 9], [1, 3, 7, 9], [1, 3, 5, 7, 9], [1, 3, 4, 6, 7, 9]];
function pipBox(tag, n, cls) {
  const b = el(tag, cls);
  for (const q of PIPS[n] || []) { const u = el('u'); u.style.gridArea = `${Math.ceil(q / 3)} / ${(q - 1) % 3 + 1}`; b.append(u); }
  return b;
}
const svg = () => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${CROW}"/></svg>`;
export function dieEl(n) { const d = pipBox('div', n === 1 ? 0 : n, 'tg-die'); if (n === 1) d.innerHTML = svg(); return d; }
export function tileEl([a, b], up = false) { const d = el('span', 'tg-tile' + (up ? ' up' : '')); d.append(pipBox('em', a), pipBox('em', b)); return d; }

export function initTableUI(game, wins) {
  const style = document.head.appendChild(document.createElement('style'));
  style.textContent = CSS;
  const sec = document.body.appendChild(el('section', 'win'));
  sec.id = 's-table';
  sec.innerHTML = '<div class="panel"><h2><span id="tg-title"></span><span class="tg-pot" id="tg-pot"></span> <button class="sq" id="tg-close">✕</button></h2><div id="tg-body"></div><div id="tg-log"></div></div>';
  const T = game.tables;
  let shown = '', held = false, pick = 'crows', stake = 0, off = new Set(), keys = [], rolled = null, shut = null, logT = '';
  // (nothing is drawn again under a button being pressed: the click would be lost)
  sec.addEventListener('pointerdown', () => { held = true; }, true);
  for (const ev of ['pointerup', 'pointercancel', 'blur']) addEventListener(ev, () => { held = false; }, true);
  wins.add('s-table', { close: 'tg-close', spot: wins.defaults.right });
  $('tg-close').setAttribute('aria-label', t('common.close'));
  $('tg-close').addEventListener('click', () => { shut = T.mine?.table.key || null; wins.close('s-table'); });
  const body = $('tg-body'), say = (tag, cls, text) => { const e = el(tag, cls, text); body.append(e); return e; };
  function act(box, text, fn, ok = true, key = null) {
    const b = el('button', 'btn', text);
    b.type = 'button'; b.disabled = !ok || T.waiting;
    if (key !== null) { b.append(el('kbd', '', String(key))); keys[key] = () => { if (!b.disabled) b.click(); }; }
    b.onclick = () => { Audio.blip(); fn(); draw(); };
    box.append(b);
    return b;
  }
  const me = () => Profile.id || 'me';
  function howto(game1) {
    const d = el('details');
    d.append(el('summary', '', t('tg.how')));
    const ul = el('ul');
    for (const line of tList(`tg.how.${game1}`)) ul.append(el('li', '', line));
    d.append(ul);
    d.open = !!body.dataset.how;
    d.addEventListener('toggle', () => { if (d.open) body.dataset.how = '1'; else delete body.dataset.how; });
    body.append(d);
  }

  // ---------- before a game ----------
  function lobby(table, rec) {
    $('tg-title').textContent = t('tg.title'); $('tg-pot').textContent = '';
    const can = T.kitAt(table), people = T.peopleAt(table), others = people.filter(q => q.id !== me() || q.npc), players = others.filter(q => !q.npc);
    if (rec?.ph === 'open') {   // (an invitation)
      const i = rec.seats.findIndex(s => s.who === me() && !s.npc);
      $('tg-title').textContent = t(`tg.${rec.game}`);
      $('tg-pot').textContent = rec.stake ? t('tg.stake.n', { n: rec.stake }) : t('tg.stake.none');
      say('p', '', t(`tg.${rec.game}.rule`));
      for (const s of rec.seats) { const r = say('div', 'tg-seat'); r.append(el('i'), el('span', '', T.nameOf(s))); }
      const box = say('div', 'tg-acts');
      if (i < 0) act(box, t('tg.join'), () => T.join(), game.money >= rec.stake, 1);
      else { act(box, t('tg.start'), () => T.go(), rec.seats.length > 1, 1); act(box, t('tg.cancel'), () => T.stand(), true, 2); }
      if (i >= 0 && rec.seats.length < 2) say('p', '', t('tg.wait'));
      howto(rec.game);
      return;
    }
    if (!can.includes(pick)) pick = can[0];
    const cards = say('div', 'tg-cards');
    for (const id of can) {
      const b = el('button', 'tg-card' + (pick === id ? ' on' : ''));
      b.type = 'button';
      b.append(el('b', '', t(`tg.${id}`)), el('small', '', t(`tg.${id}.rule`)));
      b.onclick = () => { pick = id; Audio.blip(); draw(); };
      cards.append(b);
    }
    say('h3', '', t('tg.here'));
    const rivals = others.filter(q => q.npc);
    if (!others.length) say('p', '', t('tg.alone'));
    for (const q of players) { const r = say('div', 'tg-seat'); r.append(el('i'), el('span', '', q.name), el('small', '', t('tg.player'))); }
    const ready = [];
    for (const q of rivals) {
      const why = T.why(q.id, 0), busy = T.gameOf(q.id), r = say('div', 'tg-seat pick' + (why || busy ? ' out' : off.has(q.id) ? '' : ' turn'));
      const lim = T.limitOf(q.id);
      r.append(el('i'), el('span', '', q.name), el('small', '', busy ? t('tg.npc.busy') : why ? t(`tg.why.${why}`) : t('tg.stake.max', { name: q.name, n: lim })));
      if (why || busy) continue;
      if (!off.has(q.id)) ready.push(q);
      if (rivals.length > 1 || players.length) r.onclick = () => { if (off.has(q.id)) off.delete(q.id); else off.add(q.id); Audio.blip(); draw(); };
      else r.classList.remove('pick');
    }
    const max = Math.min(game.money, ...ready.map(q => T.limitOf(q.id)));
    if (stake > max) stake = STAKES.filter(s => s <= max).pop() ?? 0;
    say('h3', '', t('tg.stake'));
    const row = say('div', 'tg-stakes');
    for (const n of STAKES) { const b = el('button', n === stake ? 'on' : '', n ? String(n) : t('tg.stake.none')); b.type = 'button'; b.disabled = n > max; b.onclick = () => { stake = n; Audio.blip(); draw(); }; row.append(b); }
    const box = say('div', 'tg-acts'), ids = ready.slice(0, 3).map(q => q.id);
    if (players.length) act(box, t('tg.invite'), () => T.open(pick, stake, ids, true), true, 1);
    else if (ready.length) act(box, t('tg.deal'), () => T.open(pick, stake, ids), true, 1);
    else act(box, t('tg.call'), () => T.open(pick, stake, [], true), true, 1);
    howto(pick);
  }

  // ---------- a game ----------
  function seats(rec) {
    rec.seats.forEach((s, i) => {
      const r = say('div', 'tg-seat' + (rec.ph === 'play' && rec.st.turn === i ? ' turn' : '') + (s.out ? ' out' : ''));
      r.append(el('i'), el('span', '', T.nameOf(s)));
      if (!rec.st) return;
      const n = RULES[rec.game].score(rec.st, i);
      if (rec.game === 'crows') { const bar = el('div', 'bar'), u = el('u'); u.style.width = `${Math.min(100, n / TARGET * 100)}%`; bar.append(u); r.append(bar, el('b', '', String(n))); }
      else r.append(el('small', '', t('tg.tiles.left', { n })));
    });
  }
  function crowsTable(rec, mine) {
    const st = rec.st, box = say('div', 'tg-table'), key = `${rec.id}:${rec.n}`, L = st.last, dice = L && (L.k === 'roll' || L.k === 'bust' || L.k === 'murder') ? L.dice || st.dice : null;
    for (let i = 0; i < 3; i++) { const d = dieEl(dice ? dice[i] : 1 + (i + 1) % 6); if (!dice) d.style.opacity = '.25'; else if (rolled !== key) d.classList.add('rolling'); box.append(d); }
    rolled = key;
    const down = L?.k === 'bust' || L?.k === 'murder' ? 3 : st.crows, birds = el('div');
    birds.style.display = 'flex';
    for (let i = 0; i < 3; i++) { const c = el('div', 'tg-crow' + (i < down ? ' on' : '')); c.innerHTML = svg(); birds.append(c); }
    birds.title = t('tg.crow', { n: st.crows });
    box.append(birds);
    const sum = el('div', 'sum', t('tg.turn_pot'));
    sum.append(el('b', '', String(st.pot)));
    box.append(sum);
    const acts = say('div', 'tg-acts'), my = rec.ph === 'play' && st.turn === mine, legal = my ? RULES.crows.legal(st, mine) : [];
    act(acts, T.waiting ? '…' : st.pot ? t('tg.roll_again') : t('tg.roll'), () => T.move('roll'), legal.includes('roll'), 1);
    act(acts, st.pot ? t('tg.bank_n', { n: st.pot }) : t('tg.bank'), () => T.move('bank'), legal.includes('bank'), 2);
  }
  function tilesTable(rec, mine) {
    const st = rec.st, box = say('div', 'tg-bridge');
    st.bridge.forEach((q, i) => { const d = tileEl(q); if (i === 0 || i === st.bridge.length - 1) d.classList.add('end'); box.append(d); });
    if (!st.bridge.length) box.append(el('p', '', t('tg.tiles.first')));
    say('p', '', t('tg.tiles.pile', { n: st.pile.length }));
    if (mine < 0) return;
    const hand = st.hands[mine], my = rec.ph === 'play' && st.turn === mine, P = my ? places(st, hand) : [], row = say('div', 'tg-hand');
    hand.forEach((q, i) => {
      const where = P.filter(p => p[0] === i).map(p => p[1]), b = el('button', 'tg-mine' + (where.length ? ' ok' : ''));
      b.type = 'button'; b.disabled = !where.length || T.waiting;
      b.append(tileEl(q, true));
      if (where.length > 1) {
        const ends = el('span', 'ends');
        for (const s of where) { const a = el('span', '', s === 'l' ? '◀' : '▶'); a.title = t(s === 'l' ? 'tg.tiles.left_end' : 'tg.tiles.right_end'); a.onclick = e => { e.stopPropagation(); T.move(['play', i, s]); draw(); }; ends.append(a); }
        b.append(ends);
      } else if (where.length) b.append(el('kbd', '', String(i + 1)));
      b.onclick = () => { if (where.length) { T.move(['play', i, where[where.length - 1]]); draw(); } };
      if (i < 9 && where.length) keys[i + 1] = () => { if (!b.disabled) b.click(); };
      row.append(b);
    });
    const L = my ? RULES.tiles.legal(st, mine) : [];
    if (L.includes('draw') || L.includes('pass')) { const acts = say('div', 'tg-acts'); if (L.includes('draw')) act(acts, T.waiting ? '…' : t('tg.draw'), () => T.move('draw'), true, 1); if (L.includes('pass')) act(acts, T.waiting ? '…' : t('tg.pass'), () => T.move('pass'), true, L.length > 1 ? 9 : 1); }
  }
  function ending(rec, mine) {
    const R = rec.res || {}, box = say('div', 'tg-table'), win = R.win || [];
    box.append(el('p', '', R.abort ? t('tg.aborted') : R.draw ? t('tg.draw_game') : win.includes(mine) ? (rec.pot ? t('tg.win', { n: rec.pot }) : t('tg.win.fun')) : t('tg.lose', { name: T.nameOf(rec.seats[win[0]] || {}) })));
  }
  function play(rec) {
    const mine = rec.seats.findIndex(s => s.who === me() && !s.npc && !s.out);
    $('tg-title').textContent = t(`tg.${rec.game}`);
    $('tg-pot').textContent = rec.pot ? t('tg.pot', { n: rec.pot }) : '';
    seats(rec);
    if (rec.st) (rec.game === 'crows' ? crowsTable : tilesTable)(rec, mine);
    if (rec.ph === 'ante') say('p', '', t('tg.ante'));
    if (rec.ph === 'end') ending(rec, mine);
    howto(rec.game);
  }
  function logLine(rec) {
    const L = rec?.st?.last;
    if (!L || !rec.seats[L.seat]) return '';
    const name = T.nameOf(rec.seats[L.seat]);
    const turn = rec.ph === 'play' ? ' · ' + (rec.seats[rec.st.turn]?.who === me() && !rec.seats[rec.st.turn].npc ? t('tg.your_turn') : t('tg.turn', { name: T.nameOf(rec.seats[rec.st.turn] || {}) })) : '';
    const line = L.k === 'roll' ? t(L.c ? 'tg.log.roll_crow' : 'tg.log.roll', { name, n: L.n, c: L.c || 0 }) : t(`tg.log.${L.k}`, { name, n: L.n || 0 });
    return line + turn;
  }
  function draw() {
    const m = T.mine;
    if (!m) return;
    const rec = T.at(m.table.key), top = body.scrollTop;
    keys = [];
    body.replaceChildren();
    if (rec && rec.ph !== 'open') play(rec); else lobby(m.table, rec);
    const note = T.note && game.time - T.note.at < 5 ? T.note.text : '';
    logT = note || logLine(rec);
    $('tg-log').textContent = logT;
    body.scrollTop = top;
  }
  function frame() {
    const m = T.mine, open = wins.isOpen('s-table');
    if (!m || !T.on) { if (open) wins.close('s-table'); shut = null; return; }
    if (!open) { if (shut !== m.table.key && game.mode === 'play' && !game.busy) { shown = ''; wins.open('s-table'); game.smartHud?.want?.('table'); } else return; }
    const rec = T.at(m.table.key);
    // (who sits here is looked at twice a second, only before a game)
    const here = !rec || !liveRec(rec) || rec.ph === 'open' ? T.peopleAt(m.table).map(q => `${q.id}${q.npc ? T.why(q.id) || '' : ''}${T.gameOf(q.id) ? 'g' : ''}`).join() : '';
    const sig = `${getLang()}|${m.table.key}|${rec ? `${rec.id}${rec.ph}${rec.n}${rec.seats.length}` : ''}|${T.waiting}|${here}|${rec && rec.ph !== 'open' ? '' : game.money}|${T.note && game.time - T.note.at < 5 ? T.note.text : ''}`;
    if (sig === shown || held) return;
    shown = sig;
    draw();
  }
  let last = 0;
  return {
    // (main.js: the number keys are this window's while it is open and you sit in a game, or before one)
    key(i) { if (!wins.isOpen('s-table') || !T.mine || document.body.classList.contains('typing')) return false; const f = keys[i + 1]; if (f) { f(); return true; } const r = T.at(T.mine.table.key); return !!r && liveRec(r); },
    frame() { const now = performance.now(); if (now - last < 120) return; last = now; try { frame(); } catch (e) { reportFault(e, 'TableUI.frame'); } },
    draw,
  };
}
