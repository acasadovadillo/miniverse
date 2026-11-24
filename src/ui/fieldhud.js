// The field HUD of tracking and the nature book (docs/planes/gta/PLAN-G-caza.md §5.1), for both interfaces: the study
// ring #hud-study at the cursor or the crosshair (the bow ring's look, in sage, a little wider so it rings the bow's
// ring when both show) and the track tag #hud-track near the cursor (species, age, heading, blood). Its CSS is
// injected here (index.html is not touched). Tab does not show them; nothing here is ever persistent.
//
// Contract:
//   main.js makes it once (not on the world server): game.fieldHud = new FieldHud(game), and calls frame() every frame
//   from its own hook on game.onFrame (main.js), not from game.js.
//   Reads only: game.nature.study ({ id, k, done } | null), game.tracks.hover ({ idx, reach } | null),
//   game.tracks.info(idx), game.nature.knowsTracks(id), Settings.v.blood. It writes nothing outside its own elements.
//   destroy() removes its elements (a HUD hot-swap must never leave the ring or the tag stuck on: frame() also hides
//   both by itself when the interface is swapped).
//
// Cost: per frame it compares a few numbers and writes a transform only when the pointer moved; the tag's text is
// worked out at 10 Hz and written only when it changes.
import { t, tHtml, has, onLangChange } from '../i18n.js';
import { CAM } from '../camera.js';
import { Settings } from '../settings.js';
import { hud } from './hud.js';

const TAG_HZ = 0.1;       // seconds between two looks at the mark under the cursor (tracks.hover is refreshed at 10 Hz)
const TAG_LINGER = 0.4;   // seconds the tag stays after the cursor leaves the mark
const RING_MIN = 0.06;    // the ring shows from this much study (about 0.1 s: sweeping the cursor over a deer is no study)
const FRESH = 120, RECENT = 600;   // seconds: the age words (Plan G §3.3)
const TAG_DX = 22, TAG_DY = 12, TAG_UNDER = 64;    // px from the cursor to the tag (above it; below, clear of the E prompt)

const CSS = `
#hud-study { position: fixed; left: 0; top: 0; z-index: 6; width: 58px; height: 58px; margin: -29px 0 0 -29px; pointer-events: none; will-change: transform; opacity: 0; visibility: hidden; transition: opacity .3s ease, visibility 0s linear .3s; }
#hud-study.on { opacity: 1; visibility: visible; transition: opacity .12s ease, visibility 0s; }
#hud-study svg { width: 100%; height: 100%; transform: rotate(-90deg); overflow: visible; }
#hud-study circle { fill: none; stroke-width: 3; }
#hud-study .bg { stroke: var(--plate); }
#hud-study .fg { stroke: #b9c98a; stroke-linecap: round; }
#hud-study.done .fg { stroke: #e6f0c4; }
#hud-study.done svg { animation: fh-flash .3s ease-out; filter: drop-shadow(0 0 4px rgba(214, 232, 160, .9)); }
@keyframes fh-flash { 0% { scale: 1; } 45% { scale: 1.2; } 100% { scale: 1; } }
#hud-track { position: fixed; left: 0; top: 0; z-index: 6; max-width: min(560px, 90vw); padding: 2px 9px 3px 8px; font: 600 16px/1.3 var(--font-ui); color: var(--cream); white-space: nowrap; background: var(--plate); border-left: 3px solid var(--mark); border-radius: 0 var(--r-s) var(--r-s) 0; box-shadow: inset 0 0 0 1px var(--hair), 0 2px 8px rgba(0, 0, 0, .25); text-shadow: var(--shadow-text); pointer-events: none; will-change: transform; opacity: 0; visibility: hidden; transition: opacity .3s ease, visibility 0s linear .3s; }
#hud-track.on { opacity: 1; visibility: visible; transition: opacity .12s ease, visibility 0s; }
#hud-track small { display: block; font-size: 14px; font-weight: 500; color: var(--dim); }
#hud-track small.bl { color: #e0a08a; }
#hud-track.blood { border-left-color: #8a3a2c; }
body:not(.playing) #hud-study, body:not(.playing) #hud-track { display: none; }
`;

const now = () => performance.now() / 1000;
const ageWord = s => (s < FRESH ? 'fresh' : s < RECENT ? 'recent' : 'old');

export class FieldHud {
  constructor(game) {
    this.game = game;
    if (typeof document === 'undefined') return;
    const style = this.style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    const ring = this.ring = document.createElement('div');
    ring.id = 'hud-study';
    ring.innerHTML = '<svg viewBox="0 0 58 58"><circle class="bg" cx="29" cy="29" r="24"/><circle class="fg" cx="29" cy="29" r="24" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg>';
    this.fg = ring.querySelector('.fg');
    const tag = this.tag = document.createElement('div');
    tag.id = 'hud-track';
    document.body.append(ring, tag);
    this.players = null;   // (#players: the full interface's Tab list; looked up once)
    this.reset();
    this.offLang = onLangChange(() => { this.tagSig = ''; });
  }

  // Nothing in sight, every cache forgotten (a new interface, a destroy)
  reset() {
    this.ringOn = false; this.ringFill = -1; this.ringDone = false; this.ringX = NaN; this.ringY = NaN;
    this.tagOn = false; this.tagSig = ''; this.tagW = 0; this.tagH = 0; this.tagX = NaN; this.tagY = NaN; this.tagNext = 0; this.tagSeen = -Infinity; this.tagHas = false;
    this.ring?.classList.remove('on', 'done');
    this.tag?.classList.remove('on');
  }

  frame() {
    const g = this.game, p = g.player;
    if (!this.ring) return;
    const T = now();
    // (the interface swapped while playing: start clean, nothing left on from the other one)
    const min = !!g.smartHud;
    if (min !== this.min) { this.min = min; this.reset(); }
    const body = document.body.classList;
    const tab = body.contains('hud-all') || !!(this.players ||= document.getElementById('players'))?.classList.contains('show');
    const play = !!p && g.mode === 'play' && !g.windowsOpen && !g.busy && !hud.dialogOpen && !g.wheel?.open && !tab && g.gamemode !== 'spectator';
    // Where the pointer is: the crosshair in first person (or with the mouse out of the window), else the cursor
    const m = g.mouse, mx = CAM.first || !m?.in ? innerWidth / 2 : m.x, my = CAM.first || !m?.in ? innerHeight / 2 : m.y;
    this.studyRing(g, play, mx, my);
    this.trackTag(g, play && !g.build?.on, mx, my, T);
  }

  // ---------- the study ring ----------
  // While a new (level 0) wild species is under the pointer: how far the look has got; a short flash when it is in the
  // book. Hidden while the bow is drawn (the study still counts: nature.js)
  studyRing(g, play, mx, my) {
    const s = g.nature?.study, drawing = g.archery?.drawT != null;
    const done = !!s?.done, k = s ? (done ? 1 : +s.k || 0) : 0;
    const on = play && !drawing && !!s && (done || k >= RING_MIN);
    if (on !== this.ringOn) { this.ringOn = on; this.ring.classList.toggle('on', on); }
    if (done !== this.ringDone) { this.ringDone = done; this.ring.classList.toggle('done', done); }
    if (!on) return;
    if (Math.abs(mx - this.ringX) > 0.5 || Math.abs(my - this.ringY) > 0.5 || this.ringX !== this.ringX) {
      this.ringX = mx; this.ringY = my;
      this.ring.style.transform = `translate(${mx.toFixed(1)}px, ${my.toFixed(1)}px)`;
    }
    const fill = Math.round(Math.min(1, k) * 100);
    if (fill !== this.ringFill) { this.ringFill = fill; this.fg.setAttribute('stroke-dashoffset', String(100 - fill)); }
  }

  // ---------- the track tag ----------
  // The mark under the pointer: whose it is (once its tracks are known), how old, where it heads, the blood (or the
  // scuffed ground, with blood off) and, out of reach, "come closer". It stays TAG_LINGER after leaving the mark
  trackTag(g, can, mx, my, T) {
    if (T >= this.tagNext) {
      this.tagNext = T + TAG_HZ;
      this.tagHas = can && this.readMark(g, T);
      if (this.tagHas) this.tagSeen = T;
    }
    const on = can && !!this.tagSig && (this.tagHas || T - this.tagSeen < TAG_LINGER);
    if (on !== this.tagOn) { this.tagOn = on; this.tag.classList.toggle('on', on); }
    if (!on) return;
    // (above the cursor: the E prompt, «Study the tracks», follows it below (hud.js prompt). Kept on the screen: to the
    // left of the cursor near the right edge; under the prompt near the top)
    let x = mx + TAG_DX, y = my - TAG_DY - this.tagH;
    if (x + this.tagW > innerWidth - 8) x = mx - TAG_DX - this.tagW;
    if (y < 8) y = my + TAG_UNDER;
    if (Math.abs(x - this.tagX) > 0.5 || Math.abs(y - this.tagY) > 0.5 || this.tagX !== this.tagX) {
      this.tagX = x; this.tagY = y;
      this.tag.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }
  }
  // Reads the mark under the pointer and writes the tag if what it says changed. False: no mark
  readMark(g, T) {
    const tr = g.tracks, hov = tr?.hover;
    if (!hov || !(hov.idx >= 0)) return false;
    let info = null;
    try { info = tr.info(hov.idx); } catch { info = null; }
    if (!info) return false;
    const type = info.type || null;
    const N = g.nature, mine = !!info.src && info.src === tr.locked;
    // (known: its tracks studied, or the whole species Known; or it is the trail of the animal you just hit, which you saw)
    let known = false;
    try { known = !!type && has(`tracks.label.${type}`) && (!!N?.knowsTracks?.(type) || N?.level?.(type) >= 3 || (mine && tr.why === 'blood')); } catch { known = false; }
    const age = Number.isFinite(info.age) ? info.age : (Number.isFinite(tr.now) ? tr.now : g.time) - info.born;
    const word = ageWord(Number.isFinite(age) ? Math.max(0, age) : 0);
    const heading = typeof info.heading === 'string' && has(`tracks.dir.${info.heading}`) ? info.heading : '';
    const blood = info.blood | 0, red = Settings.v.blood !== false, reach = !!hov.reach || mine;   // (the trail you follow: nothing to come closer for)
    const sig = `${known ? type : '?'}|${word}|${heading}|${blood}|${red}|${reach}`;
    if (sig === this.tagSig) return true;
    this.tagSig = sig;
    const drops = !!blood && red, what = t(`tracks.${drops ? 'blood_of' : 'label'}.${known ? type : 'unknown'}`), ageText = t(`tracks.${drops ? 'blood_age' : 'age'}.${word}`);
    const line = heading ? tHtml('tracks.tag', { what, age: ageText, heading: t('tracks.heading', { dir: t(`tracks.dir.${heading}`) }) })
      : tHtml('tracks.tag_still', { what, age: ageText });
    let html = line;
    if (blood) html += `<small${red ? ' class="bl"' : ''}>${t(`tracks.${red ? 'blood' : 'scuff'}.${blood >= 2 ? 'heavy' : 'light'}`)}</small>`;
    if (!reach) html += `<small>${t(blood ? 'tracks.closer_follow' : 'tracks.closer')}</small>`;
    this.tag.innerHTML = html;
    this.tag.classList.toggle('blood', !!blood && red);
    // (its size, for keeping it on the screen: measured only when the text changes)
    this.tagW = this.tag.offsetWidth; this.tagH = this.tag.offsetHeight;
    return true;
  }

  destroy() {
    this.offLang?.();
    this.ring?.remove();
    this.tag?.remove();
    this.style?.remove();
    this.ring = this.tag = this.style = this.fg = null;
  }
}
