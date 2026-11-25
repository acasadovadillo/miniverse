// The law on the screen, for both interfaces (law.js; docs/planes/gta/PLAN-H-pueblo-vivo.md §6.1): the paper chip with what you owe,
// under the money (when it changes, while Ramiro is after you or near, with Tab and with a window open), and the time left in the cell.
// Nothing here reads the DOM each frame: a few numbers are compared and the page is written only when the answer changes
import { t, onLangChange } from '../i18n.js';
import { apagada } from '../opciones.js';
import { distOf } from '../world/planet.js';

const SHOW = 5, NEAR = 24, EVERY = 0.2;   // s; tiles; s between two looks
const CSS = `
#law-chip { position: fixed; right: 18px; top: 74px; z-index: 5; pointer-events: none; opacity: 0; visibility: hidden; transform: translateY(-4px); transition: opacity .4s, transform .4s, visibility 0s linear .4s; }
#law-chip.on { opacity: 1; visibility: visible; transform: none; transition: opacity .15s, transform .15s; }
#hud-right > #law-chip { position: relative; right: auto; top: auto; height: 0; }
#hud-right > #law-chip.on { height: 36px; }
#law-chip > span { display: inline-flex; align-items: baseline; gap: 9px; margin-top: 4px; padding: 3px 12px 4px 11px; border-radius: 2px; border-left: 4px solid #8a7a52; color: #2b1d10; text-shadow: none;
  background: radial-gradient(120% 160% at 12% 0, #efe4c6 0, #e2d3a9 55%, #cdb98a 100%); box-shadow: 0 1px 0 rgba(255, 255, 255, .35) inset, 0 2px 7px rgba(0, 0, 0, .45); font: 600 15px/1.35 var(--font-title); letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; }
#law-chip b { font: 600 17px/1.2 var(--font-title); letter-spacing: .03em; font-variant-numeric: tabular-nums; }
#law-chip.wanted > span { border-left-color: #b4552c; }
#law-chip.hunted > span { border-left-color: #a01f1a; }
#law-chip.chased > span { animation: law-chip .9s ease-in-out infinite; }
@keyframes law-chip { 50% { box-shadow: 0 1px 0 rgba(255, 255, 255, .35) inset, 0 0 0 2px rgba(196, 52, 36, .85), 0 0 16px rgba(196, 52, 36, .7); } }
#law-cell { position: fixed; left: 50%; top: max(18px, 3.2vh); z-index: 5; transform: translateX(-50%); padding: 5px 18px 6px; border-radius: 4px; background: rgba(10, 12, 16, .62); color: #f2ead6; font: 600 20px/1.3 var(--font-title); letter-spacing: .06em; text-transform: uppercase; font-variant-numeric: tabular-nums; text-shadow: 0 1px 3px rgba(0, 0, 0, .8); pointer-events: none; display: none; }
#law-cell.on { display: block; }
body.big-text #law-chip > span { font-size: 18px; } body.big-text #law-chip b { font-size: 21px; } body.big-text #law-cell { font-size: 24px; }
body:not(.playing) #law-chip, body:not(.playing) #law-cell { display: none; }
@media (prefers-reduced-motion: reduce) { #law-chip.chased > span { animation: none; box-shadow: 0 0 0 2px rgba(196, 52, 36, .85); } }
`;

export class LawHud {
  constructor(game) {
    this.game = game;
    this.off = apagada('law');
    this.chip = null; this.cell = null; this.sig = ''; this.cellSig = ''; this.bounty = null; this.until = -1; this.at = -1;
    if (this.off) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    this.chip = Object.assign(document.createElement('div'), { id: 'law-chip' });
    this.chip.innerHTML = '<span><i style="font-style:normal"></i><b></b></span>';
    this.cell = Object.assign(document.createElement('div'), { id: 'law-cell' });
    document.body.append(this.chip, this.cell);
    onLangChange(() => { this.sig = this.cellSig = ''; });
  }
  reset() { this.bounty = null; this.until = -1; this.at = -1; }
  frame() {
    const g = this.game, L = g.law;
    if (this.off || !this.chip) return;
    if (!g.player || !L) { if (this.sig || this.cellSig) this.hide(); this.reset(); return; }
    const now = performance.now() / 1000, chased = L.chased;
    if (now - this.at < EVERY && chased === this.was) return;
    this.at = now; this.was = chased;
    const n = L.active && g.gamemode === 'survival' ? L.bounty() : 0, lv = L.level();
    if (n !== this.bounty) { if (this.bounty !== null && n > 0) this.until = now + SHOW; this.bounty = n; }
    const m = L.man, p = g.player;
    const near = lv && lv !== 'fined' && m && !m.hidden && g.scene === g.world && distOf(m.x, m.y, p.x, p.y) < NEAR;
    const on = n > 0 && !L.cell && !g.busy && (now < this.until || chased || near || g.windowsOpen || document.body.classList.contains('hud-all'));
    const sig = on ? `${lv}|${n}|${chased ? 1 : 0}` : '';
    const right = document.getElementById('hud-right') || document.body;
    if (this.chip.parentNode !== right) right.append(this.chip);
    if (sig !== this.sig) {
      this.sig = sig;
      this.chip.className = on ? `on ${lv}${chased ? ' chased' : ''}` : this.chip.className.replace(/\bon\b|\bchased\b/g, '').trim();
      if (on) { this.chip.querySelector('i').textContent = t(`law.level.${lv}`); this.chip.querySelector('b').textContent = String(n); }
    }
    const left = L.cell ? Math.ceil(L.left() / 1000) : -1, cs = left >= 0 ? String(left) : '';
    if (cs !== this.cellSig) {
      this.cellSig = cs;
      this.cell.classList.toggle('on', left >= 0);
      if (left >= 0) this.cell.textContent = t('law.cell', { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` });
    }
  }
  hide() { this.sig = this.cellSig = ''; this.chip.className = ''; this.cell.classList.remove('on'); }
}
