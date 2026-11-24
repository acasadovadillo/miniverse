// The catch card (fishing.js card): the kind, its length and weight, a record or a trophy, and what to do with it: E keeps
// it, X held lets it go. Bottom centre, over the hotbar, for both interfaces; its CSS is here (the tokens of ui-glass).
// Per frame it compares two references; the text is written once per catch.
import { t, onLangChange } from '../i18n.js';
import { chip, ring } from './frontend.js';
import { fishName, kgText } from '../fishing.js';
import { HOLD_X } from '../input.js';

const CSS = `
#fishcard { position: fixed; left: 50%; bottom: 150px; z-index: 6; transform: translate(-50%, 10px); min-width: 220px; padding: 12px 20px 10px; text-align: center; pointer-events: none;
  background: var(--glass, rgba(14, 16, 18, .72)); border: 1px solid var(--hair, rgba(255, 255, 255, .12)); border-radius: 10px; color: var(--ink, #f4f1ea); font-family: var(--font-ui, sans-serif); opacity: 0; transition: opacity .18s, transform .18s; }
#fishcard.on { opacity: 1; transform: translate(-50%, 0); }
#fishcard b { display: block; font: 500 24px/1.15 var(--font-title, sans-serif); letter-spacing: .02em; }
#fishcard i { display: block; font-style: normal; font-size: 17px; font-variant-numeric: tabular-nums; margin-top: 2px; }
#fishcard em { display: inline-block; font-style: normal; font-size: 13px; text-transform: uppercase; letter-spacing: .07em; color: var(--accent-2, #e8c67a); margin: 4px 6px 0; }
#fishcard p { margin: 9px 0 0; padding-top: 7px; border-top: 1px solid var(--hair, rgba(255, 255, 255, .12)); font-size: 14px; color: var(--dim, #b9b6ae); white-space: nowrap; }
#fishcard .chip { vertical-align: middle; margin: 0 6px 0 10px; }
`;

export class FishCard {
  constructor(game) {
    this.game = game; this.card = null; this.holding = false;
    if (typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    const el = this.el = document.createElement('div');
    el.id = 'fishcard';
    el.innerHTML = '<b></b><i></i><span></span><p></p>';
    const words = () => Object.assign(document.createElement('s'), { style: 'text-decoration: none' });
    this.x = chip('X', true);   // (held: its ring)
    el.lastChild.append(chip('E'), words(), this.x, words());
    document.body.append(el);
    onLangChange(() => { if (this.card) this.write(this.card); });
  }
  frame() {
    const g = this.game, c = g.player && g.mode === 'play' ? g.fishing?.card || null : null, el = this.el;
    if (!el) return;
    if (c !== this.card) {
      this.card = c;
      if (c) this.write(c);
      el.classList.toggle('on', !!c);
    }
    const hold = !!c && c.x0 !== null;
    if (hold !== this.holding) { this.holding = hold; if (hold) this.run = ring(this.x, HOLD_X * 1000); else { if (c) this.run?.cancel(); this.run = null; } }
  }
  write(c) {
    const el = this.el, [keep, free] = el.querySelectorAll('s'), tags = el.querySelector('span');
    el.querySelector('b').textContent = fishName(c.id);
    el.querySelector('i').textContent = t('fish.card', { cm: c.cm, kg: kgText(c.kg) });
    tags.textContent = '';
    for (const [on, key] of [[c.rec, 'fish.record'], [c.trophy, 'fish.trophy']]) if (on) { const e = document.createElement('em'); e.textContent = t(key); tags.append(e); }
    keep.textContent = t('fish.keep'); free.textContent = t('fish.release_hold');
  }
}
