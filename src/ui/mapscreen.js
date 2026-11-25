// The screen of the big map (docs/planes/realismo/PLAN-R8-hud-mapa.md §3.8): what is round the map of src/ui/map.js in the pause's
// MAP tab (pausehub.js, mapPane). On the right, what there is on the map, a row per kind, which show and hide it on both maps
// (blips.hide, kept in Settings.v.mapHide); under it, the scale. The cursor is a ring that catches what it is over, with its card
// (its name, how far it is, what is known of it). On the left, what is under the cursor, where you are and your route; L, the index
// of what you know, nearest first, which flies there. R puts a mark of your own (src/mapmarks.js).
// With the keyboard alone: the arrows or WASD move the map under the ring, in the middle, and Enter is the click.
// Nothing runs by itself: frame() is called once a frame while the map is open (map.drawBig), and writes to the page only what changed.
import { CENTER, inBounds } from '../world/village.js';
import { CHUNK } from '../world/gen.js';
import { BIOMES } from '../world/biomes.js';
import { distOf, nearX, wrapIndex, inPlanet } from '../world/planet.js';
import { MARK_NAME } from '../mapmarks.js';
import { Audio } from '../audio.js';
import { Settings } from '../settings.js';
import { t, getLang, onLangChange } from '../i18n.js';
import { chip, ring } from './frontend.js';
import { mapPane, paneKeys } from './pausehub.js';
import { ZOOM_NAMES, LADDER, SHARED, FOG, SOLID } from './map.js';
import { blips, layerOf, FIXED } from './blips.js';
import { svg } from './mapglyphs.js';
import { accent } from './skin.js';
import { distText } from './compass.js';

const $ = id => document.getElementById(id);
const make = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
const SNAP = 14, CLICK_PX = 5, CLICK_MS = 350, WHEEL = 40, WHEEL_MS = 90;   // (px the ring catches from; what is a click; px of wheel of a step of the zoom, and ms between two)
const HOLD_MS = 500, SURE_MS = 5000, FLY_WAIT = 140;                        // (R held to take a mark away; to say yes to the eleventh; ms over a row of the index before flying there)
// (the biomes' own names, biomes.js, are in Spanish)
const landName = b => { if (getLang() === 'es') return BIOMES[b].name; const n = t(`nature.biome.${b}`); return n.charAt(0).toUpperCase() + n.slice(1); };
const GROUPS = ['places', 'village', 'people', 'animals', 'boats', 'markers', 'jobs', 'hunting'];
const TABS = ['all', 'village', 'places', 'mine'], ROWS_MAX = 400, INDEX_MS = 1000;
const MINE = new Set(['mark', 'horse', 'dog', 'cat', 'boat', 'trap']), VILLAGE = new Set(['home', 'tavern', 'shop', 'house']), FIRM = new Set([...VILLAGE, 'place']);

const CSS = `
#bigmap { position: fixed; inset: 0; cursor: none; touch-action: none; }
#pause-map { padding: 0; --mp: rgba(10, 12, 16, .9); }
#s-pause.on-map .fe-legend { gap: 6px 14px; } #s-pause.on-map .ps-foot { gap: 14px; } #s-pause.on-map .ps-foot > :first-child { min-width: 110px; }
@media (max-width: 1360px) { #s-pause.on-map .fe-legend { gap: 6px 11px; font-size: 15px; } }
#bigmap { transition: opacity .16s linear; }
#s-pause.map3d #bigmap { opacity: 0; } body.still-menus #bigmap { transition: none; } @media (prefers-reduced-motion: reduce) { #bigmap { transition: none; } }
#s-pause.on-map.map3d, #s-pause.on-map.map3d-out { background: transparent; }
.under-map { visibility: hidden !important; clip-path: inset(100%) !important; }
#map-3d { position: fixed; inset: 0; overflow: hidden; pointer-events: none; contain: strict; }
#map-3d > div { position: absolute; left: 0; top: 0; width: 0; height: 0; will-change: transform; }
#map-3d i { position: absolute; left: calc(var(--d) / -2); top: calc(var(--d) / -2); width: var(--d); height: var(--d); box-sizing: border-box; padding: calc(var(--d) * .17); border-radius: 50%; background: rgba(12, 15, 20, .9); box-shadow: inset 0 0 0 1.500px var(--k); line-height: 0; }
#map-3d i svg { display: block; width: 100%; height: 100%; overflow: visible; }
#map-3d .dim i { box-shadow: none; } #map-3d .dim i svg { opacity: .5; }
#map-3d .you i, #map-3d .pin i { padding: 0; background: none; box-shadow: none; border-radius: 0; }
#map-3d .pin i { top: calc(var(--d) * -22 / 24); }
#map-3d b { position: absolute; left: 0; top: 0; font: 600 14px/18px Barlow, system-ui, sans-serif; color: #fff; white-space: nowrap; text-shadow: 1px 1px 0 rgba(10, 12, 16, .85), -1px 1px 0 rgba(10, 12, 16, .85), 1px -1px 0 rgba(10, 12, 16, .85), -1px -1px 0 rgba(10, 12, 16, .85), 0 0 3px rgba(10, 12, 16, .85); }
#map-cursor { position: fixed; left: 0; top: 0; z-index: 2; width: 26px; height: 26px; margin: -13px 0 0 -13px; pointer-events: none; visibility: hidden; }
#map-cursor.on { visibility: visible; }
#map-cursor svg { display: block; width: 26px; height: 26px; transition: scale .12s ease; }
#map-cursor.hot svg { scale: 1.35; } #map-cursor.hot svg > :last-child { opacity: 0; } #map-cursor.drag svg { scale: .7; }
#map-card { position: fixed; left: 0; top: 0; z-index: 3; box-sizing: border-box; min-width: 150px; max-width: 320px; padding: 9px 13px 9px 11px; display: grid; grid-template-columns: auto 1fr; gap: 1px 10px; align-items: center; background: var(--mp); border-radius: var(--r-s); box-shadow: inset 3px 0 0 var(--k, var(--fe-accent)), 0 4px 14px rgba(0, 0, 0, .4); pointer-events: none; color: var(--ink); }
#map-card[hidden] { display: none; }
#map-card > i { grid-row: span 2; width: 28px; height: 28px; padding: 5px; box-sizing: border-box; border-radius: 50%; background: rgba(12, 15, 20, .9); box-shadow: inset 0 0 0 1.5px currentColor; }
#map-card > i svg { display: block; width: 18px; height: 18px; }
#map-card > b { min-width: 0; overflow-wrap: anywhere; font: 600 18px/1.2 var(--font-title); letter-spacing: .03em; }
#map-card > em { font: 500 14px/1.3 var(--font-ui); color: var(--ink-2); font-variant-numeric: tabular-nums; }
#map-card > div { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 5px 12px; margin-top: 6px; padding-top: 7px; border-top: 1px solid var(--fe-line); font: 500 14px/1.2 var(--font-ui); color: var(--ink-2); }
#map-card > div span { display: inline-flex; align-items: center; gap: 5px; }
#map-card .chip { transform: scale(.88); transform-origin: left center; margin-right: -2px; }
#map-card input { grid-column: 1 / -1; box-sizing: border-box; width: 100%; margin-top: 6px; padding: 6px 9px; color: var(--ink); background: rgba(255, 255, 255, .1); border: 1px solid var(--fe-line); border-radius: var(--r-s); font: 500 16px/1.2 var(--font-ui); pointer-events: auto; }
#map-card.edit { pointer-events: auto; }
#map-where { position: fixed; left: 40px; bottom: 62px; z-index: 2; box-sizing: border-box; max-width: min(440px, 38vw); padding: 9px 14px 10px; background: var(--mp); border-radius: var(--r-s); color: var(--ink); }
#map-area { display: flex; align-items: baseline; gap: 12px; font: 600 20px/1.2 var(--font-title); letter-spacing: .03em; }
#map-area em { font: 500 15px/1.2 var(--font-ui); color: var(--ink-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
#map-info { margin-top: 2px; font: 500 14px/1.35 var(--font-ui); color: var(--ink-2); }
#map-info .mi-route:not(.mi-help) { color: var(--route, var(--accent)); }
#map-info .mi-help { opacity: .8; }
#map-where .mw-btns { display: flex; flex-wrap: wrap; gap: 4px; margin: 5px 0 -4px -12px; }
#map-where .mw-btns button { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; color: var(--ink); background: none; border: 0; border-radius: var(--r-s); font: 500 15px/1.2 var(--font-ui); cursor: pointer; }
#map-where .mw-btns button:hover { background: rgba(255, 255, 255, .12); }
#map-where .mw-btns button[hidden] { display: none; }
#map-side { position: fixed; right: 40px; top: 132px; bottom: 62px; z-index: 2; width: 264px; display: flex; flex-direction: column; justify-content: space-between; gap: 10px; pointer-events: none; color: var(--ink); }
#map-side > * { pointer-events: auto; background: var(--mp); border-radius: var(--r-s); }
#map-legend { flex: 0 1 auto; min-height: 0; overflow-y: auto; padding: 8px; scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, .32) transparent; }
.ml { display: flex; align-items: center; gap: 9px; min-height: 26px; padding: 1px 8px; border-radius: var(--r-s); font: 500 15px/1.2 var(--font-ui); color: var(--ink); }
.ml > i { flex: none; width: 18px; height: 18px; line-height: 0; }
.ml > i.sw { width: 12px; height: 12px; margin: 0 3px; border-radius: 2px; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .4); }
.ml > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ml > em { font: 500 14px/1 var(--font-ui); color: var(--ink-2); font-variant-numeric: tabular-nums; }
.ml[role=button] { cursor: pointer; }
.ml[role=button]:hover { background: rgba(255, 255, 255, .09); }
.ml.group { margin-top: 5px; font: 600 14px/1.2 var(--font-title); letter-spacing: .07em; text-transform: uppercase; color: var(--ink-2); }
.ml.all { font: 600 15px/1.2 var(--font-title); letter-spacing: .05em; text-transform: uppercase; }
.ml.all.none { color: var(--ink-3); }
.ml.off > i, .ml.off > em { opacity: .35; } .ml.off > span { color: var(--ink-3); text-decoration: line-through; }
.ml.sel, .ml.sel:hover { background: var(--fe-sel-bg); } .ml.sel > span, .ml.sel > em { color: var(--fe-sel-text); } .ml.sel.off > span { color: rgba(12, 14, 18, .5); }
.ml.sel > i:not(.sw) { border-radius: 50%; background: #14171c; box-shadow: 0 0 0 3px #14171c; } .ml.sel > i svg { scale: .9; }
#map-land { margin-top: 5px; }
#map-land > summary { list-style: none; } #map-land > summary::-webkit-details-marker { display: none; }
#map-land > summary::after { content: '▾'; color: var(--ink-3); transform: rotate(-90deg); } #map-land[open] > summary::after { transform: none; }
#map-tools { flex: none; display: flex; align-items: center; gap: 6px; padding: 6px 8px; }
#map-tools button { width: 32px; height: 30px; padding: 0; color: var(--ink); background: rgba(255, 255, 255, .08); border: 0; border-radius: var(--r-s); font: 500 18px/1 var(--font-ui); cursor: pointer; }
#map-tools button:hover:not(:disabled) { background: rgba(255, 255, 255, .2); } #map-tools button:disabled { opacity: .35; cursor: default; }
#map-scale { flex: 1; text-align: center; font: 600 15px/1.2 var(--font-title); letter-spacing: .06em; text-transform: uppercase; }
#map-north { flex: none; width: 30px; height: 30px; } #map-north.turned { cursor: pointer; } #map-north svg { display: block; width: 30px; height: 30px; }
#map-index { position: fixed; left: 40px; top: 132px; bottom: 62px; z-index: 3; width: 320px; display: flex; flex-direction: column; background: var(--mp); border-radius: var(--r-s); color: var(--ink); }
#map-index[hidden] { display: none; }
#mx-tabs { flex: none; display: flex; gap: 2px; padding: 6px 8px 0; border-bottom: 1px solid var(--fe-line); }
#mx-tabs button { flex: 1; padding: 7px 4px 8px; color: var(--ink-2); background: none; border: 0; box-shadow: none; font: 600 15px/1.2 var(--font-title); letter-spacing: .05em; text-transform: uppercase; cursor: pointer; white-space: nowrap; }
#mx-tabs button:hover { color: var(--ink); }
#mx-tabs button.on { color: var(--ink); box-shadow: inset 0 -3px 0 var(--fe-accent); }
#mx-rows { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, .32) transparent; }
#mx-rows .ml { min-height: 32px; cursor: pointer; font-size: 16px; }
#mx-rows .ml.dim > span { color: var(--ink-2); } #mx-rows .ml.sel.dim > span { color: rgba(12, 14, 18, .6); }
#mx-rows .ml.here > em::before { content: ''; display: inline-block; width: 8px; height: 8px; margin-right: 7px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); background: var(--route, var(--accent)); }
#mx-rows p { margin: 10px; font: 500 15px/1.4 var(--font-ui); color: var(--ink-2); }
#s-pause.on-map #ps-note { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
body.big-text .ml, body.big-text #map-info, body.big-text #map-card > em, body.big-text #map-card > div { font-size: 16.5px; }
@media (max-height: 700px) { #map-side, #map-index { top: 124px; } .ml { min-height: 23px; } }
`;

export function initMapScreen(game) {
  const map = game.map, big = $('bigmap'), style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const cursor = $('map-cursor'), card = $('map-card'), index = $('map-index');
  cursor.innerHTML = '<svg viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="10" fill="none" stroke="rgba(8,9,12,.75)" stroke-width="4.4"/><circle cx="13" cy="13" r="10" fill="none" stroke="#fff" stroke-width="2.2"/><circle cx="13" cy="13" r="2.6" fill="#fff" stroke="rgba(8,9,12,.75)" stroke-width="1.4"/></svg>';
  $('map-north').innerHTML = '<svg viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="13.4" fill="none" stroke="rgba(255,255,255,.28)"/><path d="M15 1.5 19 15h-8z" fill="var(--accent)"/><path d="M15 28.500 11 15h8z" fill="rgba(255,255,255,.5)"/></svg>';
  let open = false, mouse = null, byKey = true, drag = null, at = null, hover = null;   // (at: where the ring is; hover: what it is over, of map.hits)
  let filters = false, fsel = 0, list = null, editing = null, held = null, sureAt = -Infinity;
  const say = (id, fn) => { const el = $(id); return v => { if (el.said !== v) { el.said = v; (fn || (x => { el.textContent = x; }))(v, el); } }; };
  const me = () => map.me || [game.player.x, game.player.y];   // (in a cave, its mouth: game.js)
  const far = q => distOf(q.x, q.y, ...me());

  // ---------- the cursor, its card and what is under it ----------
  function point() {
    const pos = byKey ? [innerWidth / 2, innerHeight / 2] : mouse;
    const q = pos && !drag?.far ? map.spotAt(pos[0], pos[1], SNAP) : null;
    hover = q;
    at = q ? [q.sx, q.pin ? q.sy - 8 : q.sy] : pos;
    const s = at && !editing ? `${at[0]},${at[1]}|${q ? 1 : 0}${drag?.far ? 1 : 0}` : '';
    if (s === cursor.said) return;
    cursor.said = s;
    cursor.classList.toggle('on', !!s); cursor.classList.toggle('hot', !!q); cursor.classList.toggle('drag', !!drag?.far);
    if (at) cursor.style.transform = `translate(${at[0]}px, ${at[1]}px)`;
  }
  const keyed = (k, text, cls = '') => { const el = make('span', cls); el.append(chip(k), text); return el; };
  function paintCard() {
    const q = editing?.q || hover;
    const m = q?.mark ? game.marks?.byId(q.mark) : null, sure = performance.now() - sureAt < SURE_MS && !q;
    const s = editing ? `edit${editing.m.id}` : q ? `${q.kind}|${q.glyph}|${q.name}|${q.sub || ''}|${Math.round(far(q))}|${q.col}|${q.mark}|${getLang()}` : sure ? `sure|${getLang()}` : '';
    if (s !== card.said) {
      card.said = s;
      card.hidden = !s;
      card.classList.toggle('edit', !!editing);
      if (s && !(editing && card.contains(editing.input))) {
        card.style.setProperty('--k', q ? q.col : 'var(--fe-warn)');
        const face = make('i'), name = make('b', '', sure ? t('map.keys.marker') : q.name || t(q.pin === 'route' ? 'map.legend.route' : 'map.keys.dest')), sub = make('em'), does = make('div');
        face.style.color = q ? q.col : 'var(--ink)';
        face.innerHTML = svg(q?.pin ? 'pin' : q?.glyph || game.marks.last, 'currentColor');
        sub.textContent = sure ? t('map.marker.full') : [distText(far(q)), q.sub].filter(Boolean).join(' · ');
        if (sure) does.append(keyed('R', t('map.marker.replace')));
        else {
          does.append(keyed('mouse:l', t(q.pin === 'route' ? 'map.keys.clear' : 'map.keys.dest')));
          if (m) does.append(keyed('R', t('map.marker.change'), 'mc-r'), keyed('N', t('map.marker.rename')), keyed('R', t('map.marker.remove'), 'mc-hold'));
        }
        card.replaceChildren(face, name, sub, does);
        if (editing) { does.remove(); card.append(editing.input); }
        card.size = null;
      }
    }
    if (!s) return;
    const o = editing?.at || at;
    if (!o) { card.hidden = true; return; }
    card.hidden = false;
    card.size ||= [card.offsetWidth, card.offsetHeight];
    const [w, h] = card.size, rim = innerWidth - 40, bottom = innerHeight - 56;
    const x = Math.round(o[0] + 22 + w > rim - 270 ? Math.max(8, o[0] - 22 - w) : o[0] + 22), y = Math.round(Math.max(124, Math.min(bottom - h, o[1] + 14)));
    const place = `translate(${x}px, ${y}px)`;
    if (card.style.transform !== place) card.style.transform = place;
  }
  const sayArea = say('map-area', (v, el) => { const [a, b] = v.split('\n'); el.replaceChildren(make('span', '', a), make('em', '', b || '')); });
  function under() {
    const xy = at && map.toWorld(at[0], at[1]);
    if (!xy || !inPlanet(xy[0], xy[1])) { sayArea(t('gui.map.title')); return; }
    const [x, y] = xy, seen = game.explored.has(`${wrapIndex(Math.floor(x / CHUNK), CHUNK)},${Math.floor(y / CHUNK)}`);
    const name = hover?.name || (!seen ? t('map.unexplored') : inBounds(x, y) ? 'Pueblo Brotes' : landName(game.world.gen.biomeAt(x, y)));
    sayArea(`${name}\n${distText(distOf(hover ? hover.x : x, hover ? hover.y : y, ...me()))}`);
  }
  // The small line: where you are and what you look at, and the route (how far, to where, whether part of it is unexplored), or, with
  // none, a faint "Click: mark a route"
  function info() {
    const R = map.route, box = $('map-info'), c = map.center, moved = map.moved;
    if (!box.firstChild) box.append(make('span'), make('span', 'mi-route'));
    const main = t('gui.map.position', { x: Math.round(me()[0] - CENTER.x), y: Math.round(me()[1] - CENTER.y) }) + ' · ' +
      (moved && c ? t('gui.map.looking', { x: Math.round(c[0] - CENTER.x), y: Math.round(c[1] - CENTER.y) }) : t('gui.map.explored', { n: game.explored.size }));
    let route = '', help = false;
    if (R?.active) {
      const name = R.target.name;
      if (R.state === 'finding') route = (name ? name + ' · ' : '') + t('map.route.finding');   // (the target's name at once: the search may take a second)
      else {
        const n = Math.round(R.left() || R.len);
        route = name ? t('map.route.to', { name, n }) : t('map.route.len', { n });
        if (R.unknownPart) route += ' · ' + t('map.route.straight');
      }
      if (R.debugText) route += ' · ' + R.debugText;
    } else if (R && !R.off) { route = t('map.route.help'); help = true; }
    const s = `${main}|${route}`;
    if (box.said === s) return;
    box.said = s;
    box.children[0].textContent = main;
    box.children[1].textContent = route ? ' · ' + route : '';
    box.children[1].classList.toggle('mi-help', help);
  }
  // Each frame, after the map was drawn (map.drawBig)
  function frame() {
    const R = map.route, moved = map.moved;
    point();
    paintCard();
    under(); info();
    $('map-route').hidden = !R?.active;
    $('map-share').hidden = !(R?.active && R.canShare);
    $('map-home').disabled = !moved;
    $('map-in').disabled = map.zoom === LADDER.length - 1; $('map-out').disabled = map.zoom === 0;
    $('map-scale').textContent !== t(`map.zoom.${ZOOM_NAMES[map.zoom]}`) && ($('map-scale').textContent = t(`map.zoom.${ZOOM_NAMES[map.zoom]}`));
    paintLegend();
    if (list && (performance.now() - list.at > INDEX_MS && blips.v !== list.v)) fillIndex(true);
    const rose = `rotate(${(-map.yaw * 180 / Math.PI).toFixed(1)}deg)`, svg0 = $('map-north').firstChild;
    if (rose !== frame.rose) { frame.rose = rose; svg0.style.transform = rose; $('map-north').classList.toggle('turned', Math.abs(map.yaw) > 1e-3); }
    const s = `${!!R?.active}${moved}${!!list}${filters}${!!R?.off}${getLang()}${map.step >= SOLID}${map.canSolid}${map.solid}${!!Settings.v.mapFlat}`;
    if (s !== frame.keys) { frame.keys = s; game.pauseHub?.keys?.(); }
    game.marks?.update();
  }

  // ---------- what there is (right) ----------
  const named = l => (l.startsWith('poi:') ? l.slice(4) : t(l));
  const isOff = (layer, group) => blips.hide.has(layer) || blips.hide.has('g:' + group);
  function setHide(set) { blips.setHide(set); Settings.set('mapHide', [...set]); Audio.ui('tick'); paintLegend(true); }
  let rows = [];   // (of the filters: { el, kind: 'all' | 'group' | 'layer', group, layer })
  function layers() {
    const L = new Map();
    for (const b of blips.list) {
      if (!b.legend || b.pin || FIXED.has(b.kind)) continue;
      const k = layerOf(b), q = L.get(k);
      if (q) q.n++; else L.set(k, { layer: k, group: GROUPS.includes(b.filter) ? b.filter : 'markers', name: named(b.legend), glyph: b.glyph, color: b.color, n: 1 });
    }
    return L;
  }
  function paintLegend(force = false) {
    const R = map.route, k = `${blips.v}|${map.seenBiomes.size}|${!!R?.active}${!!R?.pins.size}${!!R?.unknownPart}|${accent.v}|${getLang()}`;
    if (!force && k === paintLegend.key) return;
    paintLegend.key = k;
    const L = layers(), extra = [];
    if (R?.active) extra.push([accent.route, t('map.legend.route'), 'pin']);
    if (R?.pins.size) extra.push([SHARED, t('map.legend.pins'), 'pin']);
    if (R?.active && R.unknownPart) extra.push([FOG, t('map.route.unknown')]);
    const land = [...map.seenBiomes].sort((a, b) => a - b);
    const s = JSON.stringify([[...L.values()], extra, land, [...blips.hide], getLang()]);
    if (s === paintLegend.said) return;
    paintLegend.said = s;
    const box = $('map-legend'), top = box.scrollTop, was = rows[fsel] && (rows[fsel].layer || rows[fsel].group || 'all'), wasLand = $('map-land')?.open;
    rows = [];
    const row = (cls, name, glyph, color, n, act) => {
      const el = make('div', `ml ${cls}`), face = make('i');
      if (glyph) { face.innerHTML = svg(glyph, color); el.append(face); } else if (color) { face.className = 'sw'; face.style.background = color; el.append(face); }
      el.append(make('span', '', name));
      if (n) el.append(make('em', '', String(n)));
      if (act) { const i = rows.length; el.setAttribute('role', 'button'); rows.push({ el, ...act }); el.onclick = () => { fsel = i; toggle(rows[i]); }; }
      box.append(el);
      return el;
    };
    box.textContent = '';
    row(`all${blips.hide.size ? '' : ' none'}`, t('map.legend.all'), '', '', 0, { kind: 'all' });
    row('', t('gui.map.you'), 'you', '#ffffff');
    for (const [c, n, g] of extra) row('', n, g, c);
    for (const g of GROUPS) {
      const in_ = [...L.values()].filter(q => q.group === g);
      if (!in_.length) continue;
      if (g === 'places') in_.sort((a, b) => (b.layer === 'home') - (a.layer === 'home') || a.name.localeCompare(b.name));
      row(`group${in_.every(q => isOff(q.layer, g)) ? ' off' : ''}`, t(`map.legend.group.${g}`), '', '', 0, { kind: 'group', group: g });
      for (const q of in_) row(isOff(q.layer, g) ? 'off' : '', q.name, q.glyph, q.color, q.n, { kind: 'layer', group: g, layer: q.layer });
    }
    // (the land: what its colours are)
    if (land.length) {
      const d = make('details'), h = make('summary', 'ml group', t('map.legend.land'));
      d.id = 'map-land'; d.open = !!wasLand;
      d.append(h);
      for (const b of land) { const el = make('div', 'ml'), sw = make('i', 'sw'); sw.style.background = `rgb(${BIOMES[b].rgb[1]})`; el.append(sw, make('span', '', landName(b))); d.append(el); }
      box.append(d);
    }
    box.scrollTop = top;
    if (was) fsel = Math.max(0, rows.findIndex(q => (q.layer || q.group || 'all') === was));
    markFilter();
  }
  function toggle(q) {
    const H = new Set(blips.hide), L = [...layers().values()].filter(x => x.group === q.group), all = 'g:' + q.group;
    if (q.kind === 'all') { if (!H.size) { Audio.ui('deny'); return; } setHide(new Set()); return; }
    if (q.kind === 'group') {
      const off = L.every(x => isOff(x.layer, q.group));
      for (const x of L) H.delete(x.layer);
      if (off) H.delete(all); else H.add(all);
    } else if (H.has(all)) { H.delete(all); for (const x of L) if (x.layer !== q.layer) H.add(x.layer); }
    else if (H.has(q.layer)) H.delete(q.layer);
    else H.add(q.layer);
    setHide(H);
  }
  function markFilter() { rows.forEach((q, i) => q.el.classList.toggle('sel', filters && i === fsel)); if (filters) rows[fsel]?.el.scrollIntoView({ block: 'nearest' }); }
  function setFilters(on) { if (filters === on) return; filters = on; if (on) closeIndex(); fsel = Math.max(0, Math.min(fsel, rows.length - 1)); markFilter(); Audio.ui(on ? 'open' : 'back'); }

  // ---------- the index of places (left) ----------
  let flyTimer = 0;
  function openIndex() {
    setFilters(false);
    fresh();
    list = { tab: list?.tab || openIndex.tab || 'all', sel: -1, rows: [], at: 0, v: -1 };
    index.hidden = false;
    $('map-where').hidden = true;
    Audio.ui('open');
    fillIndex();
  }
  function closeIndex() {
    if (!list) return;
    openIndex.tab = list.tab;
    list = null;
    clearTimeout(flyTimer);
    index.hidden = true;
    $('map-where').hidden = false;
    Audio.ui('back');
  }
  const inTab = (b, tab) => (tab === 'village' ? VILLAGE.has(b.kind) : tab === 'places' ? b.filter === 'places' || b.kind === 'place' : tab === 'mine' ? MINE.has(b.kind) : true);
  // keep: what there was stays in its order (things move while it is open), and what is new goes after
  function fillIndex(keep = false) {
    const tabs = $('mx-tabs'), box = $('mx-rows'), was = list.rows, sel = was[list.sel]?.id, order = keep ? new Map(was.map((q, i) => [q.id, i])) : null;
    if (tabs.said !== getLang()) { tabs.said = getLang(); tabs.replaceChildren(...TABS.map(k => { const b = make('button', '', t(`map.places.tab.${k}`)); b.dataset.k = k; b.onclick = () => { b.blur(); pickTab(k); }; return b; })); }
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.k === list.tab);
    const seen = new Map();
    let all = [];
    for (const b of blips.list) {
      if (!b.name || b.kind === 'neighbor' || b.kind === 'goal' || b.pin === 'route' || !b.to || !inTab(b, list.tab)) continue;
      const base = b.mark ? `mark:${b.mark}` : `${b.kind}:${b.name}:${b.kind === 'place' || VILLAGE.has(b.kind) ? `${b.x | 0},${b.y | 0}` : b.who || ''}`, k = (seen.get(base) || 0) + 1;
      seen.set(base, k);   // (two with the same name)
      all.push({ id: `${base}#${k}`, name: b.name, sub: b.sub, glyph: b.pin ? 'pin' : b.glyph, color: b.pin ? SHARED : b.color, dim: b.dim, x: b.x, y: b.y, to: { ...b.to }, mark: b.mark, conn: b.pin === 'shared' ? b.conn : undefined, d: far(b) });
    }
    all.sort((a, b) => (order ? (order.get(a.id) ?? 1e6) - (order.get(b.id) ?? 1e6) : 0) || a.d - b.d);
    all = all.slice(0, ROWS_MAX);
    list.rows = all; list.at = performance.now(); list.v = blips.v;
    list.sel = sel === undefined ? -1 : all.findIndex(q => q.id === sel);
    const R = map.route, here = q => R?.active && Math.abs(nearX(q.to.x, R.target.x) - R.target.x) < 0.5 && Math.abs(q.to.y - R.target.y) < 0.5;
    // (its rows are made again only if they are others, not under a click: else, how far each is and which the route goes to)
    const s = JSON.stringify([list.tab, getLang(), all.map(q => [q.id, q.name, q.color, q.glyph, q.dim])]);
    const tell = () => all.forEach((q, i) => { const el = box.children[i], d = distText(q.d); if (el.lastChild.textContent !== d) el.lastChild.textContent = d; el.classList.toggle('here', !!here(q)); });
    if (s === box.said) { tell(); mark(); return; }
    box.said = s;
    const top = box.scrollTop;
    box.replaceChildren(...all.map((q, i) => {
      const el = make('div', `ml${q.dim ? ' dim' : ''}`), face = make('i');
      face.innerHTML = svg(q.glyph, q.color);
      el.append(face, make('span', '', q.name), make('em'));
      el.onpointermove = () => { if (list.sel !== i) select(i, false); };
      el.onclick = () => { select(i, false); go(); };
      return el;
    }));
    tell();
    if (!all.length) box.append(make('p', '', t('map.places.none')));
    box.scrollTop = keep ? top : 0;
    mark();
  }
  function mark() { [...$('mx-rows').children].forEach((el, i) => el.classList.toggle('sel', !!list && i === list.sel)); }
  function pickTab(k) { if (list.tab === k) return; list.tab = k; list.sel = -1; list.rows = []; Audio.ui('tab'); fillIndex(); }
  function select(i, byKeys) {
    if (!list.rows[i]) return;
    list.sel = i;
    mark();
    if (byKeys) $('mx-rows').children[i].scrollIntoView({ block: 'nearest' });
    byKey = true; cursor.said = null;   // (the ring waits for it in the middle)
    clearTimeout(flyTimer);
    const q = list.rows[i];
    flyTimer = setTimeout(() => { if (open) map.flyTo(q.x, q.y); }, byKeys ? 0 : FLY_WAIT);
  }
  function go() {
    const q = list?.rows[list.sel], R = map.route;
    if (!q || !R || R.off) return;
    clearTimeout(flyTimer);
    map.flyTo(q.x, q.y);
    if (q.conn !== undefined) { const s = R.pins.get(q.conn); if (s) { R.pins.delete(q.conn); R.pinsVersion++; R.set({ x: s.x, y: s.y, kind: 'point', name: s.name || s.by }, { from: q.conn }); } }
    else R.set({ ...q.to, name: q.name });
    Audio.ui('select');
    fillIndex(true);
  }

  // ---------- your marks ----------
  const ownAt = () => (hover?.mark ? game.marks.byId(hover.mark) : null);
  function dropMark() {
    const M = game.marks, xy = at && map.toWorld(at[0], at[1]);
    if (!M || !xy || !inPlanet(xy[0], xy[1])) { Audio.ui('deny'); return; }
    if (M.full && performance.now() - sureAt > SURE_MS) { sureAt = performance.now(); Audio.ui('deny'); return; }
    sureAt = -Infinity;
    const q = hover && !hover.pin ? hover : null;   // (over a thing, on it; on a place, with its name)
    const m = M.add(q ? q.x : xy[0], q ? q.y : xy[1]);
    if (m) { if (q?.name && FIRM.has(q.kind)) M.rename(m, q.name); Audio.ui('select'); }
    fresh();
  }
  const fresh = () => { blips.refresh(game, performance.now() / 1000, true); };
  function pressR(e) {
    if (e.repeat || held) return;
    const m = ownAt();
    if (!m) { dropMark(); return; }
    const el = card.querySelector('.mc-hold .chip');
    held = { m, ring: el ? ring(el, HOLD_MS) : null, timer: setTimeout(() => { const q = held?.m; letGo(false); if (q) { game.marks.remove(q); Audio.ui('back'); fresh(); } }, HOLD_MS) };
  }
  // R let go before that: the next drawing
  function letGo(tap) {
    if (!held) return;
    const { m, timer, ring: r } = held;
    held = null;
    clearTimeout(timer); r?.cancel();
    if (tap) { game.marks.cycle(m); Audio.ui('tick'); fresh(); }
  }
  function rename() {
    const m = ownAt();
    if (!m) { Audio.ui('deny'); return; }
    const input = make('input');
    input.type = 'text'; input.maxLength = MARK_NAME; input.value = m.n || ''; input.placeholder = t('map.marker.name');
    input.setAttribute('aria-label', t('map.marker.name')); input.autocomplete = 'off'; input.spellcheck = false;
    editing = { m, q: { ...hover }, at: [...at], input };
    input.addEventListener('keydown', e => { if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); e.stopPropagation(); endEdit(true); } });
    input.addEventListener('blur', () => endEdit(true));
    paintCard();
    input.focus(); input.select();
  }
  function endEdit(keep) {
    if (!editing) return;
    const { m, input } = editing;
    editing = null;
    if (keep && game.marks.byId(m.id)) { game.marks.rename(m, input.value); fresh(); }
    input.blur();
    card.said = null;
    if (open) paintCard();
  }

  // ---------- the mouse ----------
  const look = e => { mouse = [e.clientX, e.clientY]; byKey = false; };
  // (a click that hardly moved, < 5 px and < 350 ms, marks a route there or snaps to a spot: route.pickAt; dragging pans. Right click
  // on the map removes the route; in play right click is the greeting, untouched)
  big.addEventListener('pointerdown', e => {
    look(e);
    if (e.button !== 0 && e.pointerType === 'mouse') return;   // (only the left button drags or clicks)
    if (editing) { endEdit(true); return; }
    if (filters) setFilters(false);
    drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, at: performance.now(), far: false };
    try { big.setPointerCapture(e.pointerId); } catch { /* a pointer no longer down */ }
  });
  big.addEventListener('pointermove', e => {
    look(e);
    if (!drag) return;
    map.scroll(-(e.clientX - drag.x), -(e.clientY - drag.y), [drag.x, drag.y], [e.clientX, e.clientY]);
    drag.x = e.clientX; drag.y = e.clientY;
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) >= CLICK_PX) drag.far = true;
  });
  big.addEventListener('pointerleave', () => { if (!drag && !byKey) mouse = null; });
  big.addEventListener('pointerup', e => {
    const d = drag;
    drag = null;
    if (!d || d.far || performance.now() - d.at > CLICK_MS || game.mode !== 'map') return;
    point();
    pick();
  });
  big.addEventListener('pointercancel', () => { drag = null; });
  big.addEventListener('contextmenu', e => { e.preventDefault(); if (game.mode === 'map') game.route?.clear('user'); });
  function pick() {
    const xy = at && map.toWorld(at[0], at[1]);
    if (xy && game.route && !game.route.off) { game.route.pickAt(xy[0], xy[1], at[0], at[1]); Audio.ui('select'); }
  }
  // La rueda acerca hacia donde está el ratón (lo que se mueve poco a poco, como un trackpad, se va sumando)
  let wheel = 0, wheelAt = 0;
  const zoom = (d, x, y) => { if (map.zoomAt(d, x, y)) Audio.ui('tick'); };
  big.addEventListener('wheel', e => {
    e.preventDefault();
    wheel += e.deltaMode ? e.deltaY * 40 : e.deltaY;
    const now = performance.now();
    if (Math.abs(wheel) < WHEEL || now - wheelAt < WHEEL_MS) return;
    wheelAt = now;
    zoom(wheel < 0 ? 1 : -1, e.clientX, e.clientY);
    wheel = 0;
  }, { passive: false });
  $('map-in').onclick = () => zoom(1);
  $('map-out').onclick = () => zoom(-1);
  $('map-home').onclick = () => map.recenter(true);
  // The 3D map (three/map3d.js): V, with relief or flat; Z and C turn it; a click on the rose, north up again
  const solid = () => { if (map.setFlat(!Settings.v.mapFlat)) Audio.ui('select'); else Audio.ui('deny'); };
  const turn = d => { if (map.turn(d)) Audio.ui('tick'); else if (d) Audio.ui('deny'); };
  $('map-north').onclick = () => turn(0);
  // The marked route (Plan J §4.2, route.js): remove it, or share its pin with everyone playing with you
  for (const [id, k, key] of [['map-route', 'X', 'gui.map.route_clear'], ['map-share', 'G', 'map.pin.share']]) { const s = make('span'); s.dataset.i18n = key; s.textContent = t(key); $(id).replaceChildren(chip(k), s); }
  $('map-route').onclick = () => game.route?.clear('user');
  $('map-share').onclick = () => game.route?.share();
  for (const el of [$('map-in'), $('map-out'), $('map-home'), $('map-route'), $('map-share')]) el.addEventListener('click', () => el.blur());

  // ---------- the keys (the pause gives them: pausehub.js) ----------
  // (not Q and E, 1-7, M, J, P nor Esc, the pause's own)
  paneKeys.map = e => {
    const c = e.code, d = { ArrowUp: -1, ArrowDown: 1 }[c], s = { ArrowLeft: -1, ArrowRight: 1 }[c], yes = c === 'Enter' || c === 'NumpadEnter';
    if (list) {
      const n = list.rows.length;
      if (d) { if (n) { select(list.sel < 0 ? (d > 0 ? 0 : n - 1) : (list.sel + d + n) % n, true); if (!e.repeat) Audio.ui('tick'); } return true; }
      if (s) { if (!e.repeat) pickTab(TABS[(TABS.indexOf(list.tab) + s + TABS.length) % TABS.length]); return true; }
      if (yes) { if (!e.repeat) go(); return true; }
    } else if (filters) {
      const n = rows.length;
      if (d && n) { fsel = (fsel + d + n) % n; markFilter(); if (!e.repeat) Audio.ui('tick'); return true; }
      if (s) { if (!e.repeat) setFilters(false); return true; }
      if (yes || c === 'Space') { if (!e.repeat && rows[fsel]) toggle(rows[fsel]); return true; }
    }
    if (yes) { if (!e.repeat) pick(); return true; }
    const on = { KeyL: () => (list ? closeIndex() : openIndex()), KeyF: () => setFilters(!filters), Space: () => map.recenter(true), KeyX: () => game.route?.active && game.route.clear('user'), KeyG: () => { if (!$('map-share').hidden) game.route.share(); }, KeyN: () => rename(), KeyR: () => pressR(e), KeyV: solid, KeyZ: () => turn(-1), KeyC: () => turn(1) }[c];
    if (!on) return false;
    if (!e.repeat) on();
    return true;
  };
  Object.assign(mapPane, {
    wants: e => (list || filters) && /^Arrow/.test(e.code),
    up: e => { if (!e || e.code === 'KeyR') letGo(!!e); },
    back() { if (editing) { endEdit(false); return true; } if (filters) { setFilters(false); return true; } if (list) { closeIndex(); return true; } return false; },
    enter() { open = true; frame.keys = null; byKey = !mouse; cursor.said = card.said = null; paintLegend.key = ''; sureAt = -Infinity; },
    leave() { open = false; letGo(false); endEdit(true); clearTimeout(flyTimer); if (list) { openIndex.tab = list.tab; list = null; index.hidden = true; $('map-where').hidden = false; } filters = false; drag = null; hover = at = null; cursor.classList.remove('on'); card.hidden = true; map.close(); },
    legend() {
      const out = [], L = (text, ks, o) => out.push({ keys: ks, text: t(text), ...o }), R = map.route;
      if (list) { L('gui.legend.move', ['↑', '↓']); L('gui.legend.change', ['←', '→']); L('map.keys.dest', ['Enter']); L('map.keys.places', ['L'], { onClick: closeIndex }); }
      else if (filters) { L('gui.legend.move', ['↑', '↓']); L('map.keys.toggle', ['Enter']); L('map.keys.filters', ['F'], { onClick: () => setFilters(false) }); }
      else {
        if (!R?.off) { L('map.keys.dest', ['mouse:l']); if (R?.active && innerWidth > 1360) L('map.keys.clear', ['mouse:r']); }   // (in a narrow window, its button says it)
        L('map.keys.marker', ['R']);
        L('map.keys.places', ['L'], { onClick: openIndex });
        L('map.keys.filters', ['F'], { onClick: () => setFilters(true) });
        if (map.relief || map.canSolid) {
          const near = map.step >= SOLID && map.canSolid;
          L(Settings.v.mapFlat || !near ? 'map.view.3d' : 'map.view.2d', ['V'], { dim: !near, onClick: solid });
          L('map.keys.turn', ['Z', 'C'], { dim: !(near && map.solid && !Settings.v.mapFlat) });
        }
        if (map.moved) L('map.keys.recentre', [t('key.space')], { onClick: () => map.recenter(true) });
      }
      return out;
    },
  });
  blips.setHide(Array.isArray(Settings.v.mapHide) ? Settings.v.mapHide.filter(k => typeof k === 'string').slice(0, 60) : []);
  onLangChange(() => { paintLegend.key = ''; $('mx-rows').said = null; if (list) fillIndex(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) letGo(false); });
  map.screen = { frame, byKeys() { byKey = true; }, zoom, get hover() { return hover; }, get at() { return at; }, get index() { return list; }, get rows() { return rows; }, toggle: q => toggle(q), get editing() { return !!editing; } };
  return map.screen;
}
