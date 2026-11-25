// What the windows show of a stack of fish (Plan R1-3, catch.js): a dull icon when it is a few days old, a star on a trophy,
// and the line for its tooltip and its description ("Trophy · 62 cm · 2.6 kg · A few days old").
import { tracked, isFish, stateOf, stateText, unitG } from '../catch.js';
import { t, fmt } from '../i18n.js';

let styled = false;
function style() {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `img.stale { filter: saturate(.42) sepia(.28) brightness(.8); }
.sh-row:has(.trophy), .cf-fix:has(.trophy) { position: relative; }
.slot .trophy, .pk-row .trophy, .sh-row .trophy, .cf-fix .trophy { position: absolute; left: 2px; top: -1px; font: 700 13px/1 var(--font-ui); color: #ffd34d; text-shadow: 0 0 3px #000, 0 1px 1px #000; pointer-events: none; font-style: normal; }
.pk-row .trophy, .sh-row .trophy, .cf-fix .trophy { left: 5px; top: 2px; }`;
  document.head.append(s);
}
// el: the cell or the row; its first image is the icon
export function catchMark(el, s) {
  const img = el.querySelector('img'), st = s && tracked(s.id) ? stateOf(s) : '', star = !!s?.tr;
  if (st || star) style();
  if (img) img.classList.toggle('stale', st === 'old' || st === 'rotten');
  let mark = el.querySelector('.trophy');
  if (!star) { mark?.remove(); return; }
  if (!mark) { mark = document.createElement('i'); mark.className = 'trophy'; mark.textContent = '★'; el.append(mark); }
}
export const kgOf = g => fmt.num(g / 1000, { maximumFractionDigits: g < 1000 ? (g < 100 ? 3 : 2) : 1 });
// '' for anything else
export function catchText(s) {
  if (!s || !tracked(s.id)) return '';
  const list = [];
  if (s.tr) list.push(t('fish.trophy'));
  if (s.cm > 0) list.push(t('fish.cm', { cm: fmt.num(Math.round(s.cm)) }));
  if (isFish(s.id) || s.g > 0) list.push(t(s.n > 1 ? 'fish.kg_each' : 'fish.kg', { kg: kgOf(unitG(s)) }));
  const st = stateText(s);
  if (st) list.push(st);
  return list.join(' · ');
}
