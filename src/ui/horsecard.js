// The horse's card (Plan R4 §4.2), beside its menu: its name, breed, coat, level and hearts, its four bars (speed, stamina,
// courage, strength: horsebreeds.js) and how it is (fed, watered, its shoes, clean; sore when it is). It only reads: the menu
// acts (ranch.js horseMenu shows and hides it). statBars: those four, also in Rosa's list (shop.js) and in the journal. The look
// is index.html #horse-card and .hs-bars
import { t } from '../i18n.js';
import { glyph } from './glyphs.js';
import { Profile } from '../accounts.js';
import { ANIMALS } from '../art/farm.js';
import { levelOf } from '../horse.js';
import { statsOf, barsOf, segOf, raceOf, racesOff, SEGMENTS, STATS } from '../horsebreeds.js';
import { fedWord, waterWord, shoeWord, cleanWord, soreLeft, LOW, LOOSE } from '../horsecare.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// The four bars of some stats, in SEGMENTS. cls: 'small' (the journal, the shop)
export function statBars(stats, cls = '') {
  const v = barsOf(stats);
  return `<div class="hs-bars${cls ? ' ' + cls : ''}">${STATS.map((k, i) => `<span><b>${esc(t('horse.stat.' + k))}</b><i style="--n:${segOf(v[i])};--of:${SEGMENTS}"></i></span>`).join('')}</div>`;
}
// The rows: [glyph, label key, 0..1, word key, whether it is bad]
export function cardRows(game, a) {
  const C = game.horsecare, fed = C.fed(a), water = C.water(a), shoe = C.shoes(a), dirt = a === game.horse?.ridden ? game.horse.dirt || 0 : +a.dirt || 0;
  return [
    ['drumgrass', 'fed', fed, fedWord(fed), fed < LOW],
    ['droplet', 'water', water, waterWord(water), water < LOW],
    ['horseshoe', 'shoes', shoe, shoeWord({ shod: a.shod, shoe }), !!a.shod && shoe < LOOSE],
    ['brush', 'clean', 1 - dirt, cleanWord(dirt), dirt > 0.6],
  ];
}
export function cardHtml(game, a) {
  const C = game.horsecare, coat = ANIMALS.caballo.breeds.includes(a.breed) ? a.breed : 'castano', L = levelOf(a.love);
  const rows = cardRows(game, a).map(([g, key, v, word, bad]) => `<div class="hc-row${bad ? ' bad' : ''}">${glyph(g)}<b>${esc(t('horse.cond.' + key))}</b><i style="--v:${Math.round(v * 100)}%"></i><span>${esc(t('horse.cond.word.' + word))}</span></div>`).join('');
  const left = C.on() ? soreLeft(a, C.clock) : 0;
  const sore = left > 0 ? `<div class="hc-sore">${glyph('bandage')}${esc(t('horse.cond.sore', { n: Math.max(1, Math.ceil(left / 60)) }))}</div>` : '';
  return `<h4>${esc(a.name)}</h4><small>${esc(t(racesOff() ? 'horse.card.sub_plain' : 'horse.card.sub', { race: t('horse.race.' + raceOf(a)), coat: t('horse.coat.' + coat), n: L, level: t('horse.level.' + L) }))}</small><div class="hc-love" style="--p:${Math.round(Math.max(0, Math.min(10, a.love || 0)) * 10)}%">♥♥♥♥♥</div>${racesOff() ? '' : statBars(statsOf(a))}${rows}${sore}`;
}
let el = null, timer = 0;
export const horseCard = {
  show(game, a) {
    if (typeof document === 'undefined' || Profile.server || !game.horsecare || game.horsecare.off) return;
    if (!el?.isConnected) { el = document.createElement('div'); el.id = 'horse-card'; el.className = 'panel'; el.setAttribute('aria-hidden', 'true'); document.body.append(el); }
    const paint = () => { el.innerHTML = cardHtml(game, a); };
    const again = () => { if (document.getElementById('dialog')?.classList.contains('show')) paint(); else this.hide(); };   // (the menu gone without an answer: the game over)
    paint();
    el.classList.add('show');
    clearInterval(timer);
    timer = setInterval(again, 1000);   // (its menu can stay open while something changes)
  },
  hide() { clearInterval(timer); el?.classList.remove('show'); },
};
