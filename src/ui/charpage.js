// The pause's Character tab (docs/planes/realismo/PLAN-R9-menus.md §3.4): on the left the whole body, as dressed, which
// turns with the mouse or ← →, with the money and what the village thinks; on the right the state (the needs, in
// survival), the body, the load, the clothes with their wear, the skills and, in a couple, the partner.
// Everything is read when the page opens (and on a slow tick while it is in sight, for what the others change): nothing
// is kept. leave() lets the figure go, with what it holds in the graphics card (three/portrait.js Figure).
import { t, tHtml, fmt } from '../i18n.js';
import { ITEMS, WEAR_SLOTS, itemNoun, wearSlotLabel, conditionText } from '../items.js';
import { HP_MAX, HUNGER_MAX } from '../combat.js';
import { THIRST_MAX, STAMINA_MAX, REST_MAX } from '../needs.js';
import { canTear, warmthOf } from '../clothing.js';
import { itemIconUrl } from '../art/items.js';
import { Figure, portrait3D, portraitReady } from '../three/portrait.js';
import { nearX } from '../world/planet.js';
import { inBounds } from '../world/village.js';
import { Profile } from '../accounts.js';
import { apagada } from '../opciones.js';
import { reportFault } from '../faults.js';
import { ACCENTS } from './skin.js';
import { esc } from './brief.js';

const $ = id => document.getElementById(id);
const DAY_MS = 86400000, TURN = 0.012, STEP = 0.4, DPR_MAX = 1.5;
const share = v => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const pct = v => t('hud.need.pct', { pct: Math.round(share(v) * 100) });
const segs = (v, color = '') => `<span class="pg-bar seg"${color ? ` style="--c:${color}"` : ''}><b style="width:${share(v) * 100}%"></b></span>`;

// Who the player's partner is: { id, name, peer (null: not here) }, or null. A child in common, or one on the way
// (social.js isPartner); the partner who is not here, by the shared family
export function partnerOf(game) {
  const L = game.live, S = game.social, me = Profile.id;
  for (const peer of L?.others || []) if (peer.playing && !peer.server && (S?.isPartner?.(peer) || S?.isPartnerId?.(peer.id))) return { id: peer.id, name: peer.name, peer };
  const F = game.family?.v || {}, pairs = [...(Array.isArray(F.kids) ? F.kids.map(k => k?.parents) : []), F.expecting?.father ? [F.expecting.mother, F.expecting.father] : null];
  for (const ids of pairs) {
    if (!me || !Array.isArray(ids) || !ids.includes(me)) continue;
    const id = ids.find(x => x && x !== me), name = id && L?.nameOf?.(id);
    if (name) return { id, name, peer: null };
  }
  return null;
}
// Where a peer is, in words: "Pueblo Brotes · 40 m away", "Forest · 230 m away", or '' (not in the world: a menu)
function whereOf(game, peer) {
  const e = peer?.entity, p = game.player;
  if (!e || !peer.sc) return '';
  if (peer.sc !== 'world') return t('gui.char.underground');
  const place = inBounds(e.x, e.y) ? 'Pueblo Brotes' : t(`nature.biome.${game.world.gen.biomeAt(e.x, e.y)}`), cap = place.charAt(0).toUpperCase() + place.slice(1);
  return game.scene === game.world ? t('gui.char.where', { place: cap, m: fmt.num(Math.round(Math.hypot(nearX(e.x, p.x) - p.x, e.y - p.y))) }) : t('gui.char.at', { place: cap });
}

// ---------- the sections ----------
function statusHtml(game) {
  if (game.gamemode !== 'survival') return `<section><h3>${t('gui.char.status')}</h3><p class="j-note">${t(game.gamemode === 'spectator' ? 'gui.char.spectator' : 'gui.char.creative')}</p></section>`;
  const c = game.combat, n = game.needs || {};
  const row = (name, v, color, extra = '') => `<div class="pc-need"><span>${name}</span>${segs(v, color)}<b>${pct(v)}</b>${extra}</div>`;
  const out = [row(t('hud.need.health'), c.hp / HP_MAX, 'var(--nd-hp)'), row(t('hud.need.hunger'), c.hunger / HUNGER_MAX, 'var(--nd-food)')];
  if (!apagada('sed') && Number.isFinite(n.thirst)) out.push(row(t('hud.need.thirst'), n.thirst / THIRST_MAX, 'var(--nd-water)'));
  const noStam = apagada('aguante'), noRest = apagada('cansancio');
  if (!(noStam && noRest)) out.push(row(t('hud.need.energy'), noStam ? n.rest / REST_MAX : n.stamina / STAMINA_MAX, 'var(--nd-en)', noStam || noRest ? '' : `<small>${t('hud.need.rest', { pct: Math.round(share(n.rest / REST_MAX) * 100) })}</small>`));
  return `<section><h3>${t('gui.char.status')}</h3>${out.join('')}</section>`;
}
// The body: the felt temperature, the clothes' warmth, how clean, and the days since the last haircut and shave (Plan E
// §7.2; survival only: in creative the body does not count)
function bodyHtml(game) {
  const b = game.body;
  if (!b?.counts) return '';
  const parts = [], now = Date.now(), days = at => Math.max(0, Math.floor((now - at) / DAY_MS));
  if (b.weatherOn) {
    const cls = b.cold >= 0.35 ? 'cold' : b.heat >= 0.35 ? 'hot' : '';
    parts.push(`<span class="${cls}">${t('journal.body.feels', { c: fmt.num(Math.round(b.feelC)) })}</span>`);
  }
  parts.push(`<span>${t('journal.body.warmth', { n: fmt.num(warmthOf(game.inv?.equip), { maximumFractionDigits: 1 }) })}</span>`);
  const dirty = typeof b.washable === 'function' && b.washable();
  parts.push(`<span class="${dirty ? 'dirty' : ''}">${t(dirty ? 'journal.body.dirty' : 'journal.body.clean')}</span>`);
  if (Number.isFinite(b.cutAt)) parts.push(`<span>${t('journal.body.hair', { n: days(b.cutAt) })}</span>`);
  if (Number.isFinite(b.shaveAt) && game.player?.look?.sex === 'chico') parts.push(`<span>${t('journal.body.shave', { n: days(b.shaveAt) })}</span>`);
  return `<section><h3>${t('gui.char.body')}</h3><div class="pc-tags">${parts.join('')}</div></section>`;
}
function loadHtml(game) {
  const I = game.inv;
  if (!I) return '';
  if (!I.weight) {   // (?inventario=casillas: the slots taken)
    const n = I.slots.slice(0, I.cap).filter(Boolean).length;
    return `<section><h3>${t('gui.char.load_bag', { n, cap: I.cap })}</h3>${segs(n / I.cap)}</section>`;
  }
  const kg = v => fmt.num(v, { maximumFractionDigits: 1 }), free = !Number.isFinite(I.capKg);
  return `<section><h3>${free ? t('gui.char.load_free', { kg: kg(I.kg) }) : t('gui.char.load', { kg: kg(I.kg), cap: kg(I.capKg) })}</h3>${free ? '' : segs(I.load, I.load >= 1 ? 'var(--fe-bad)' : '')}</section>`;
}
function clothesHtml(game) {
  const E = game.inv?.equip || {}, rows = WEAR_SLOTS.map(([slot]) => [slot, E[slot]]).filter(([, it]) => it && ITEMS[it.id]);
  const row = ([slot, it]) => {
    const tear = canTear(slot, it) ? Math.round(share((it.tear || 0) / 100) * 100) : -1, cond = tear >= 0 ? conditionText(it) : '';
    const right = tear < 0 ? '' : `<b>${pct(1 - tear / 100)}</b>${segs(1 - tear / 100, tear >= 75 ? 'var(--fe-bad)' : tear >= 40 ? 'var(--fe-warn)' : '')}`;
    return `<div class="pc-wear"><img alt="" data-icon="${esc(it.id)}" data-color="${esc(it.color || '')}"><span>${esc(t('collections.item', { item: itemNoun(it.id) }))}<small>${esc([wearSlotLabel(slot), cond].filter(Boolean).join(' · '))}</small></span>${right}</div>`;
  };
  return `<section><h3>${t('gui.char.clothes')}</h3>${rows.length ? `<div class="pc-clothes">${rows.map(row).join('')}</div>` : `<p class="j-note">${t('gui.char.no_clothes')}</p>`}</section>`;
}
function skillsHtml(game) {
  return `<section class="pc-skills"><h3>${t('gui.char.skills')}</h3>${game.skills.rows().map(s => `<div class="j-row pc-skill"><b>${esc(s.name)}</b>${segs((s.level + (s.level < 10 ? s.pct / 100 : 0)) / 10)}<span class="lvl">${t('skill.level', { n: s.level })}</span><small>${esc(s.perk)}</small></div>`).join('')}</section>`;
}
function partnerHtml(game) {
  const who = partnerOf(game);
  if (!who) return '';
  const on = !!who.peer, col = on && ACCENTS[who.peer.accent] ? ACCENTS[who.peer.accent] : '', where = on ? whereOf(game, who.peer) : '';
  return `<section class="pc-partner${on ? ' on' : ''}"${col ? ` style="--you:${col}"` : ''}><canvas width="96" height="96" aria-hidden="true"></canvas><div><small>${t('gui.char.partner')}</small><b>${esc(who.name)}</b><span>${t(on ? 'gui.char.online' : 'gui.char.offline')}${where ? ` · ${esc(where)}` : ''}</span></div></section>`;
}

export function initCharPage(game, { soon }) {
  const cv = $('ps-char-face'), el = $('ps-char'), figure = new Figure(cv);
  let open = false, drag = null, frame = 0, seen = '', seenYou = '';
  const draw = () => {
    frame = 0;
    if (!open) return;
    const r = cv.getBoundingClientRect(), k = Math.min(DPR_MAX, devicePixelRatio || 1);
    try { figure.draw(Math.round(r.width * k), Math.round(r.height * k)); } catch (e) { reportFault(e, 'CharPage.draw'); }
  };
  const ask = () => { frame ||= requestAnimationFrame(draw); };   // (one picture per frame at most while it turns)
  const turn = d => { figure.angle += d; ask(); };
  cv.addEventListener('pointerdown', e => { if (e.button !== 0) return; drag = e.clientX; try { cv.setPointerCapture(e.pointerId); } catch { /* (gone) */ } });
  cv.addEventListener('pointermove', e => { if (drag === null) return; turn((e.clientX - drag) * TURN); drag = e.clientX; });
  for (const ev of ['pointerup', 'pointercancel']) cv.addEventListener(ev, () => { drag = null; });
  function card() {
    $('ps-char-name').textContent = game.player?.name || '';
    $('ps-char-money').innerHTML = `<small>${t('gui.char.money')}</small><b>${t('gui.pause.money', { n: game.money })}</b>`;
    const R = game.rep;
    $('ps-char-rep').innerHTML = R ? `<small>${t('gui.char.rep')}</small><b>${tHtml('rep.level.' + R.level.id)}</b>` : '';
  }
  function text() {
    const html = `<div class="pc-cols"><div>${statusHtml(game)}${loadHtml(game)}${bodyHtml(game)}${clothesHtml(game)}</div><div>${skillsHtml(game)}<div class="pc-you"></div></div></div>`;
    const box = $('ps-char-body');
    if (html !== seen) {
      seen = html; seenYou = '';
      box.innerHTML = html;
      box.querySelectorAll('[data-icon]').forEach(img => { img.src = itemIconUrl(img.dataset.icon, img.dataset.color || undefined); });
    }
    // (the partner apart: it changes while they walk, and the rest does not flicker with it)
    const you = partnerHtml(game), slot = box.querySelector('.pc-you');
    if (you === seenYou || !slot) return;
    seenYou = you;
    slot.innerHTML = you;
    const face = slot.querySelector('canvas'), look = face && (partnerOf(game)?.peer?.entity?.look || null);
    const put = () => { try { if (face.isConnected) face.getContext('2d').drawImage(portrait3D(look), 0, 0, face.width, face.height); } catch (e) { reportFault(e, 'CharPage.partner'); } };
    if (look) { if (portraitReady(look)) put(); else soon(put); }
    else face?.classList.add('none');
  }
  return {
    enter() {
      open = true; seen = '';
      card(); text();
      el.scrollTop = 0;
      const look = game.appearance?.();
      // (the first of a look takes a while: the page first, then the body)
      if (look) soon(() => { if (!open) return; try { figure.look(look, game.body?.counts ? game.body.surface() : null); draw(); } catch (e) { reportFault(e, 'CharPage.figure'); } });
    },
    // (a slow tick of the hub: what the others or the world change meanwhile)
    live() { if (open) { card(); text(); } },
    leave() {
      open = false; drag = null; seen = '';
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      figure.dispose();
      figure.angle = 0.3;
      cv.width = cv.height = 1;
    },
    resize: ask,
    turn: d => turn(d * STEP),
    get figure() { return figure; },
  };
}
