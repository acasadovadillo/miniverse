// The feed of notices above the minimap (docs/planes/realismo/PLAN-R8-hud-mapa.md §3.6): short lines that slide in from the
// left, at most four in sight, the newest at the bottom. hud.toast(text, kind) forwards here, so its callers need not know.
//   hud.feed.push({ kind, text, key?, n?, icon? })   kind: KINDS; key: what merges with it (without one, its kind and text);
//     n: how many (an amount that adds up when lines merge: "Wheat ×3"; negative, lost: "−3"); icon: the address of its picture
//     (an item's: art/items.js itemIconUrl)
// The same key again within MERGE_MS updates the line in place. One new line per GAP_MS at most (a burst queues); while a
// dialogue or the tool wheel is open (hud.feed.busy, set by main.js) the lines wait. Settings.v.feed: 'all' or 'important'
// (only IMPORTANT kinds). In the menus and the pause the same lines show at the top, in the middle (index.html).
// Nothing runs per frame: each line has its timer, and the page is written only when a line comes, changes or goes.
import { Settings } from '../settings.js';
import { Audio } from '../audio.js';
import { glyph } from './glyphs.js';

// Kind → its glyph; its accent bar is the CSS (.k-<kind>, index.html)
export const KINDS = { item: 'bag', money: 'coin', place: 'pin', social: 'person', craft: 'hammer', world: 'info', net: 'people', warn: 'warn', good: 'star' };
export const IMPORTANT = new Set(['place', 'money', 'warn', 'net']);
export const MAX_LINES = 4, GAP_MS = 250, MERGE_MS = 2500;
const HOLD = 2800, PER_CHAR = 40, HOLD_MAX = 6000, OUT_MS = 400, QUEUE_MAX = 8;
const TALL = 200;   // (px of the 1080 reference: lines that wrap count by their height)
const uiScale = () => Math.max(0.85, Math.min(1.3, innerHeight / 1080));

class Feed {
  constructor() {
    this.lines = [];    // in sight, the oldest first: { el, key, n, at, timer, … }
    this.queue = [];    // waiting for their turn
    this.last = -Infinity; this.timer = 0;
    this.busy = () => false;
  }
  // Does this kind show, with the setting in use?
  shows(kind) { return Settings.v.feed !== 'important' || IMPORTANT.has(kind); }
  push({ kind = 'world', text = '', key, n = 1, icon }) {
    if (!KINDS[kind]) kind = 'world';
    if (!text || !this.shows(kind)) return false;
    key ??= `${kind}|${text}`;
    const T = performance.now();
    const was = this.lines.find(l => l.key === key && T - l.at < MERGE_MS) || this.queue.find(l => l.key === key);
    if (was) {
      was.n += n; was.text = text; was.at = T;
      if (was.el) { this.write(was); was.num.animate?.([{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 100 }); this.arm(was); }
      return true;
    }
    this.queue.push({ kind, text, key, n, icon, at: T, el: null, num: null, timer: 0 });
    if (this.queue.length > QUEUE_MAX) { const i = this.queue.findIndex(l => !IMPORTANT.has(l.kind)); this.queue.splice(i < 0 ? 0 : i, 1); }
    this.pump();
    return true;
  }
  // The next line of the queue, when it is its turn
  pump() {
    clearTimeout(this.timer);
    if (!this.queue.length) return;
    const left = this.last + GAP_MS - performance.now();
    if (left > 1 || this.busy()) { this.timer = setTimeout(() => this.pump(), Math.max(left, 100)); return; }
    this.last = performance.now();
    this.show(this.queue.shift());
    if (this.queue.length) this.timer = setTimeout(() => this.pump(), GAP_MS);
  }
  show(l) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const el = l.el = document.createElement('div');
    el.className = `toast k-${l.kind}${l.kind === 'good' ? ' good' : ''}`;
    el.innerHTML = '<i></i><span></span><b></b>';
    if (l.icon) { const im = document.createElement('img'); im.src = l.icon; im.alt = ''; el.firstChild.append(im); } else el.firstChild.innerHTML = glyph(KINDS[l.kind]);
    l.num = el.lastChild;
    l.at = performance.now();
    this.write(l);
    box.append(el);
    this.lines.push(l);
    while (this.lines.length > MAX_LINES) this.drop(this.lines[0]);
    // (one look at the height, when a line comes: long ones wrap, and the chat is over the feed)
    const tall = TALL * uiScale();
    while (this.lines.length > 1 && this.lines.reduce((h, q) => h + q.el.offsetHeight + 4, 0) > tall) this.drop(this.lines[0]);
    if (document.body.classList.contains('playing')) Audio.ui('feed');
    this.arm(l);
  }
  write(l) {
    l.el.children[1].textContent = l.text;
    l.num.textContent = l.n < 0 ? `−${-l.n}` : l.n > 1 ? `×${l.n}` : '';
  }
  arm(l) {
    clearTimeout(l.timer);
    l.timer = setTimeout(() => this.drop(l), Math.min(HOLD_MAX, HOLD + PER_CHAR * l.text.length));
  }
  drop(l) {
    const i = this.lines.indexOf(l);
    if (i < 0) return;
    this.lines.splice(i, 1);
    clearTimeout(l.timer);
    l.el.classList.add('out');
    setTimeout(() => l.el.remove(), OUT_MS);
  }
  clear() { clearTimeout(this.timer); this.queue.length = 0; while (this.lines.length) this.drop(this.lines[0]); }
}
export const feed = new Feed();
