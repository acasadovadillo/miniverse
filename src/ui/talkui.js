// What a talk shows besides its subtitles (src/talk.js; the subtitles are social.js's): the list of options at the bottom
// right, a key and a text per row, the one picked a solid bar. Number keys, the wheel or the arrows and E, or the mouse. The
// keys it takes go no further (a digit does not change what is in the hand, the wheel neither), W, A, S and D are not its
// own: walking away is how one leaves. And the look of the tag over a neighbour's rows (hud.prompt).
import { t } from '../i18n.js';
import { chip } from './frontend.js';

const CSS = `
#talk-list { position: fixed; right: var(--safe); bottom: calc(96 * var(--ui-s)); z-index: 22; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; max-width: min(calc(430 * var(--ui-s)), 38vw); visibility: hidden; opacity: 0; transition: opacity .12s, visibility 0s linear .12s; }
#talk-list.on { visibility: visible; opacity: 1; transition: opacity .12s; }
#talk-list .tk { display: flex; align-items: center; gap: 10px; max-width: 100%; box-sizing: border-box; min-height: calc(36 * var(--ui-s)); padding: 3px 6px 3px 16px; border-radius: var(--r-s, 4px); font: 500 max(16px, calc(18.5 * var(--ui-s)))/1.2 var(--font-ui); color: #fff; text-align: right; text-shadow: 0 1px 2px rgba(0, 0, 0, .95), 0 0 6px rgba(0, 0, 0, .7); cursor: pointer; }
#talk-list .tk span { flex: 1; min-width: 0; }
#talk-list .tk .chip { flex: none; margin: 0; text-shadow: none; opacity: .82; }
#talk-list .tk.sel { background: var(--fe-sel-bg, #fff); color: var(--fe-sel-text, #0c0e12); text-shadow: none; box-shadow: 0 2px 10px rgba(0, 0, 0, .35); }
#talk-list .tk.sel .chip { opacity: 1; background: #14171c; color: #fff; }
#talk-list.on .tk { animation: tk-in .12s ease-out backwards; animation-delay: calc(var(--i) * 18ms); }
@keyframes tk-in { from { opacity: 0; transform: translateX(16px); } }
body.ui-wood #talk-list .tk.sel { background: #f2dca8; color: #3a2414; }
body.ui-wood #talk-list .tk.sel .chip { background: #6a4424; color: #fff3d6; }
body.big-text #talk-list .tk { font-size: max(20px, calc(23 * var(--ui-s))); min-height: calc(43 * var(--ui-s)); }
body.big-text #talk-list { max-width: min(520px, 46vw); }
body:not(.playing) #talk-list, body.wheel-open #talk-list, body.quick-open #talk-list { visibility: hidden !important; }
body.still-menus #talk-list.on .tk { animation: none; }
/* Talking, what else is down there keeps out: the hint over the hotbar and the bottom prompt, under the subtitles */
body.tk-on #hint, body.tk-on #hud-tip { visibility: hidden !important; }
#prompt .pr-head { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; margin: 0 0 5px 6px; }
#prompt .pr-head b { font: 600 19px/1.15 var(--font-title); letter-spacing: .07em; text-transform: uppercase; }
#prompt .pr-head span { font: 500 15px/1.2 var(--font-ui); }
#prompt .pr-head small { font: 500 14px/1.2 var(--font-ui); opacity: .9; }
body.big-text #prompt .pr-head b { font-size: 24px; } body.big-text #prompt .pr-head span { font-size: 19px; } body.big-text #prompt .pr-head small { font-size: 18px; }
`;
const STEP_MS = 60;   // between two steps of the wheel

export class TalkUI {
  constructor(talk) {
    this.talk = talk;
    const style = this.style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    const el = this.el = document.createElement('div');
    el.id = 'talk-list';
    el.setAttribute('role', 'listbox');
    document.body.append(el);
    this.rows = []; this.wheelAt = 0;
    addEventListener('keydown', e => this.key(e), true);
    addEventListener('wheel', e => this.wheel(e), { capture: true, passive: false });
  }
  open() { document.body.classList.add('tk-on'); this.el.setAttribute('aria-label', t('npc.opt.chat')); }
  close() { document.body.classList.remove('tk-on'); this.list(null); }
  // The rows ([{ id, text }]), or null: none
  list(rows, sel = 0) {
    this.el.classList.toggle('on', !!rows);
    if (!rows) { this.rows = []; return; }   // (the last ones fade where they were)
    this.rows = rows.map((r, i) => {
      const row = document.createElement('div'), text = document.createElement('span');
      row.className = 'tk'; row.style.setProperty('--i', i);
      row.setAttribute('role', 'option');
      text.textContent = r.text;
      row.append(text, chip(String(i + 1)));
      row.onpointerenter = () => this.talk.hover(i);
      row.onpointerdown = e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); this.talk.pick(i); };
      return row;
    });
    this.el.replaceChildren(...this.rows);
    this.select(sel);
  }
  select(i) { this.rows.forEach((r, k) => { r.classList.toggle('sel', k === i); r.setAttribute('aria-selected', k === i); }); }
  // Are the keys the talk's now? Playing, not typing, with nothing open over it
  get listens() {
    const g = this.talk.game, a = document.activeElement;
    return this.talk.on && g.mode === 'play' && !g.wheel?.open && !g.quick?.open && !(a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement);
  }
  key(e) {
    if (!this.listens || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.code, digit = /^(?:Digit|Numpad)([1-9])$/.exec(k);
    if (digit) { if (!e.repeat) this.talk.pick(+digit[1] - 1); }
    else if (k === 'ArrowUp' || k === 'ArrowDown') this.talk.move(k === 'ArrowUp' ? -1 : 1);
    else if ((k === 'Escape' && !document.pointerLockElement) || k === 'Backspace') { if (!e.repeat) this.talk.back(); }   // (with the pointer caught, Esc frees it: the pause)
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }
  wheel(e) {
    if (!this.listens || e.ctrlKey || !(e.target instanceof HTMLCanvasElement || this.el.contains(e.target))) return;
    e.preventDefault(); e.stopPropagation();
    const now = performance.now();
    if (!e.deltaY || now - this.wheelAt < STEP_MS) return;
    this.wheelAt = now;
    this.talk.move(e.deltaY > 0 ? 1 : -1);
  }
}
