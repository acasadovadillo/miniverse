// Greeting and provoking people, as in GTA and Red Dead: Y (or right click on someone) waves at the person under the
// cursor (a neighbor, a child of yours or another player) with a gesture and a short line in a bubble over your head;
// held for HOLD seconds it provokes them instead (a ring shows from RING_FROM, so a quick greeting never sees it). A
// neighbor answers a moment later with a gesture and a line that depend on their character (PEOPLE[id].temper) and on
// how you get along (friendship and the village's reputation, reputation.js). Greeting someone close, once a day, makes
// you a little better friends; provoking them costs friendship and reputation. Another player sees your gesture (the
// counter em/ek in your state, live.js) and your line and the answer (a 'greet' message with indexes, never text: each
// game says them in its own language).
// Who it goes to (pick): this system's own ray against the people around, so E and the yellow outline stay exactly as
// they were (other players are not aimed at with E: a friend in front of your chest would take it). With Y and nobody
// under the cursor (or the cursor on a window), the person in front of you. Its look is the CSS below, injected so all
// of it stays in this file (as smarthud.js does); fx.js draws the bubbles (updateBubbles).
import { t, tList, formatMessage } from './i18n.js';
import { PEOPLE } from './neighbors.js';
import { Profile } from './accounts.js';
import { CAM } from './camera.js';
import { nearX } from './world/planet.js';
import { aabb, rayHits } from './world/fit.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { levelIndex, recent } from './reputation.js';
import { REMARKS, remarkLines, remarkLife } from './remarks.js';

export const HOLD = 0.7;          // s held: provoke instead of greeting
export const RING_FROM = 0.25;    // s held before the ring shows
export const GREET_R = 8;         // tiles: the farthest you can greet someone under the cursor
export const COUNT_R = 4;         // tiles: the farthest a greeting counts for the friendship and the reputation
const FRONT_R = 6, FRONT_COS = Math.cos(35 * Math.PI / 180);   // Y without anyone under the cursor: who is in front of you
export const COOLDOWN = 1.2;      // s between two greetings
export const REPLY_DELAY = 0.6;   // s before the neighbor answers
export const MAX_BUBBLES = 6;
export const NET_GAP = 1;         // s: a second 'greet' of the same player sooner than this is ignored
export const TOAST_GAP = 15;      // s: at most one notice per player this often
const BACK_FOR = 6;               // s after someone greets you in which Y greets them back without aiming
const WITNESS_R = 10;             // tiles: a neighbor this close sees you provoke another player
const PICK_EVERY = 0.2;           // s between two looks under the cursor for the prompt (5 Hz)
const MY_LIFE = 2.6, NPC_LIFE = 2.8, STAY = 1.8;   // s: how long the bubbles last, and a walking neighbor stops to answer
// What goes through the network, by index: only add at the end. 'drink': crouched, drinking from a river or a lake with
// the cupped hand (needs.drinkAt plays it again while drinking; its animation is three/actors.js EMOTES.drink: an old
// client without it shows 'wave', live.js). 'scrub': washing at a river or a lake, or at a basin (body.js, Plan E §4.2);
// 'shiver': the cold as a gesture (actors.js EMOTES; the idle shiver itself is drawn from st.bd)
export const EMOTE_KINDS = ['wave', 'nod', 'shrug', 'hips', 'fist', 'flinch', 'point', 'dismiss', 'drink', 'scrub', 'shiver', 'brush', 'pat', 'whistle', 'talk', 'think', 'inspect', 'pay'];   // (append only: the index travels as st.ek; brush, pat and whistle: the horse, Plan F §5.3; talk and think: a talk's, never sent, talk.js)
export const PLAYER_LINES = ['social.say.greet.morning', 'social.say.greet.day', 'social.say.greet.evening', 'social.say.greet.night', 'social.say.greet_player', 'social.say.greet_partner', 'social.say.insult', 'social.say.insult_player', 'social.say.air'];
const RELS = ['friend', 'neutral', 'cold'];
const MEM_DAYS = 2;   // (a memory of today or the 2 days before: «the last 3 days» of relation())
// ('' : by character and relation; 'remark': about how you look, remarks.js, with the message's rc = the REMARKS index.
// An old client finds REPLY_KINDS[4] undefined and skips the answer)
const REPLY_KINDS = ['', 'rain', 'ignore', 'kid', 'remark', 'asleep'];   // (asleep: in bed, half a word and no gesture)
export const TEMPERS = ['kind', 'cheerful', 'shy', 'gruff', 'wry'];
// How a neighbor answers with the body: [greet | insult][temper][relation]
export const REPLY_GESTURE = {
  greet: {
    kind: { friend: 'wave', neutral: 'wave', cold: 'nod' }, cheerful: { friend: 'wave', neutral: 'wave', cold: 'nod' },
    shy: { friend: 'wave', neutral: 'nod', cold: 'flinch' }, gruff: { friend: 'nod', neutral: 'nod', cold: 'dismiss' },
    wry: { friend: 'wave', neutral: 'nod', cold: 'shrug' },
  },
  insult: {
    kind: { friend: 'hips', neutral: 'shrug', cold: 'hips' }, cheerful: { friend: 'hips', neutral: 'shrug', cold: 'point' },
    shy: { friend: 'flinch', neutral: 'flinch', cold: 'flinch' }, gruff: { friend: 'point', neutral: 'fist', cold: 'fist' },
    wry: { friend: 'shrug', neutral: 'point', cold: 'dismiss' },
  },
};

const CSS = `
.say-bubble { position: absolute; left: 0; top: 0; width: max-content; max-width: 250px; padding: 5px 12px 6px; box-sizing: border-box; border-radius: 12px; background: rgba(255, 248, 232, .95);
  color: #2a1c12; font: 500 16px/1.25 var(--font-ui); text-align: center; white-space: normal; box-shadow: 0 2px 8px rgba(0, 0, 0, .35); will-change: transform, opacity; pointer-events: none; }
.say-bubble::after { content: ''; position: absolute; left: 50%; bottom: -7px; margin-left: -7px; border: 7px solid transparent; border-bottom: 0; border-top-color: rgba(255, 248, 232, .95); }
.say-bubble b { display: block; margin-bottom: 1px; font: 600 11px/1.2 var(--font-title); letter-spacing: .07em; text-transform: uppercase; color: #8a5a2a; }
.say-bubble.mine { background: rgba(10, 12, 16, .88); color: var(--cream); box-shadow: 0 0 0 1px rgba(255, 255, 255, .16), 0 2px 8px rgba(0, 0, 0, .35); }
.say-bubble.mine::after { border-top-color: rgba(10, 12, 16, .88); }
body.big-text .say-bubble { font-size: 20px; max-width: 320px; } body.big-text .say-bubble b { font-size: 14px; }
#social-sub { position: fixed; left: 50%; bottom: max(17%, 152px); z-index: 23; width: max-content; max-width: min(680px, 62vw); transform: translateX(-50%);
  color: #fff; font: 500 max(18px, calc(22 * var(--ui-s)))/1.35 var(--font-ui); text-align: center; text-wrap: balance; text-shadow: 0 1px 2px rgba(0, 0, 0, .95), 0 0 6px rgba(0, 0, 0, .75), 0 0 14px rgba(0, 0, 0, .5); opacity: 0; visibility: hidden; transition: opacity .2s, visibility 0s linear .2s; pointer-events: none; }
#social-sub.on { opacity: 1; visibility: visible; transition: opacity .12s, visibility 0s; }
#social-sub b { margin-right: 9px; font: 600 .95em/1.2 var(--font-title); letter-spacing: .06em; text-transform: uppercase; }
body.big-text #social-sub { font-size: max(22px, calc(27 * var(--ui-s))); }
body:not(.playing) #social-sub { display: none; }
#social-hold { position: fixed; left: 0; top: 0; z-index: 7; display: flex; align-items: center; gap: 6px; pointer-events: none; opacity: 0; visibility: hidden; transition: opacity .12s, visibility 0s linear .12s; }
#social-hold.on { opacity: 1; visibility: visible; transition: opacity .1s, visibility 0s; }
#social-hold svg { width: 34px; height: 34px; transform: rotate(-90deg); }
#social-hold circle { fill: none; stroke-width: 4; }
#social-hold .bg { stroke: rgba(0, 0, 0, .45); }
#social-hold .fg { stroke: #ff9a6a; stroke-linecap: round; }
#social-hold span { font: 600 15px/1 var(--font-title); letter-spacing: .04em; text-transform: uppercase; color: #ffd0b0; text-shadow: 0 1px 3px rgba(0, 0, 0, .8); }
.rep-box { margin: 0 0 10px; padding: 9px 11px 10px; background: rgba(0, 0, 0, .25); border-radius: 5px; }
.rep-box small { display: block; color: var(--dim); font-size: 14px; margin-top: 3px; }
.rep-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.rep-head span { font: 500 14px/1.2 var(--font-title); letter-spacing: .05em; text-transform: uppercase; color: var(--dim); }
.rep-head b { font: 600 21px/1.2 var(--font-title); letter-spacing: .02em; color: var(--gold); }
.rep-outcast .rep-head b, .rep-distrusted .rep-head b { color: #ff9a7a; }
.rep-bar { position: relative; height: 8px; margin: 6px 0 5px; border-radius: 4px; background: rgba(0, 0, 0, .45); overflow: hidden; }
.rep-bar i { position: absolute; left: 0; top: 0; bottom: 0; background: linear-gradient(90deg, #c8543a, #e8b04a 45%, #a8f07a); }
.rep-bar s { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: rgba(255, 240, 210, .3); }
.rep-box h4 { margin: 8px 0 2px; font: 500 14px/1.2 var(--font-title); letter-spacing: .05em; text-transform: uppercase; color: var(--dim); }
.rep-log { list-style: none; margin: 0; padding: 0; font-size: 15px; }
.rep-log li { display: flex; justify-content: space-between; gap: 10px; padding: 1px 0; }
.rep-log b.up { color: #a8f07a; } .rep-log b.down { color: #ff9a7a; }
.rep-box .rep-creative { color: var(--gold); }
`;

const rnd = n => Math.floor(Math.random() * n);
const say1 = (list, i, params) => (list.length ? formatMessage(list[((i % list.length) + list.length) % list.length], params) : '');

// Pure: are players x and y a couple, from the family record (family.v: kids' parents, the pregnancy's mother and
// father)? Plan F §3.2. The family is shared, so every game and the world server answer the same. Known limit (accepted): a
// couple whose only child is from before parent ids were saved is not seen here (isPartner's fallback still sees it locally)
export function areCouple(fam, x, y) {
  if (!fam || typeof x !== 'string' || typeof y !== 'string' || !x || !y || x === y) return false;
  const both = ids => Array.isArray(ids) && ids.includes(x) && ids.includes(y);
  if (Array.isArray(fam.kids) && fam.kids.some(k => both(k?.parents))) return true;
  const e = fam.expecting;
  return !!e && typeof e.father === 'string' && both([e.mother, e.father]);
}

export class Social {
  constructor(game) {
    this.game = game;
    this.hold = null;        // the press going on: { src, t, target, x, y }
    this.queue = [];         // what happens a moment later (the neighbor's answer): { t, fn }
    this.bubbles = [];       // the lines in sight: { e, text, name, t, life, mine } (fx.js draws them)
    this.emoting = new Set();
    this.emSeq = 0; this.emKind = 0;   // (your gestures, for the others: live.js puts them in your state)
    this.lastAt = -Infinity;
    this.picked = null; this.pickT = 0;
    this.back = null;        // the player who just greeted you: { conn, until }
    this.subLines = [];      // the subtitle's lines (the last two): { text, until, who, color }
    this.ui = typeof document !== 'undefined' && !Profile.server;
    if (!this.ui) return;
    const style = this.style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    this.sub = Object.assign(document.createElement('div'), { id: 'social-sub' });
    this.ring = Object.assign(document.createElement('div'), { id: 'social-hold' });
    this.ring.innerHTML = '<svg viewBox="0 0 44 44"><circle class="bg" cx="22" cy="22" r="17"/><circle class="fg" cx="22" cy="22" r="17" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg><span></span>';
    document.body.append(this.sub, this.ring);
  }
  get today() { return this.game.days.dayIndex; }
  reset() { this.hold = null; this.queue = []; this.bubbles = []; this.picked = null; this.back = null; this.showRing(-1); this.subtitle(''); }

  // ---------- who ----------
  // Can you greet now? Playing, not talking, not building, not with the tool wheel open, not as a spectator, not typing
  can() {
    const g = this.game;
    return !!g.player && g.mode === 'play' && !g.busy && !hud.dialogOpen && !g.talk?.on && g.gamemode !== 'spectator' && !g.build?.on && !g.wheel?.open && !g.jumping &&
      !(typeof document !== 'undefined' && document.activeElement instanceof HTMLInputElement) && !Profile.server;
  }
  // The people around who can be greeted: { kind: 'npc' | 'kid' | 'player', id, e, name, conn, peer }
  candidates() {
    const g = this.game, w = g.world, out = [];
    if (!w || g.scene !== w) return out;
    if (w.nilo) out.push({ kind: 'npc', id: 'nilo', e: w.nilo, name: PEOPLE.nilo.name });
    for (const n of g.neighbors.people) if (!n.hidden) out.push({ kind: 'npc', id: n.id, e: n, name: n.def.name });
    for (const [id, e] of g.family.ents) if (!e.baby && !e.lying) out.push({ kind: 'kid', id, e, name: e.name });
    if (g.live.joined) for (const [conn, peer] of g.live.peers) if (peer.playing && !peer.server && peer.sc === 'world' && peer.entity && peer.entity.gm !== 3) out.push({ kind: 'player', id: peer.id, e: peer.entity, name: peer.name, conn, peer });
    return out;
  }
  // Who a press goes to: the first person whose box the ray under (x, y) cuts, within GREET_R and in sight; with Y
  // (front), if nobody, who greeted you a moment ago, then who is in front of you. null: nobody
  pick(x, y, front = false) {
    const g = this.game, p = g.player, w = g.world;
    if (!p || g.scene !== w) return null;
    const list = this.candidates(), sees = c => !w.reaches || w.reaches(p.x, p.y, c.e.x, c.e.y);
    const ray = x !== null && x !== undefined ? g.view3d.rayAt(x, y) : null;
    // (the cheap tests first: how far, then the box; whether they are in sight, the dearest, only for the ones hit)
    if (ray) {
      const hits = [];
      for (const c of list) {
        const ex = nearX(c.e.x, p.x);
        if (Math.abs(ex - p.x) > GREET_R || Math.abs(c.e.y - p.y) > GREET_R || Math.hypot(ex - p.x, c.e.y - p.y) > GREET_R) continue;
        const gy = g.view3d.groundY(w, ex, c.e.y), h = g.view3d.personHeight?.(c.e, c.kind === 'kid' ? 1.1 : 1.5) ?? 1.5;
        const t = rayHits(ray.o, ray.d, { ...aabb(ex - 0.35, c.e.y - 0.35, ex + 0.35, c.e.y + 0.35), y0: gy, y1: gy + h });
        if (t !== null) hits.push([t, c]);
      }
      hits.sort((a, b) => a[0] - b[0]);
      for (const [, c] of hits) if (sees(c)) return c;
    }
    if (!front) return null;
    if (this.back && g.time < this.back.until) { const c = list.find(c => c.conn === this.back.conn); if (c) return c; }
    let best = null, bd = Infinity;
    for (const c of list) {
      const dx = nearX(c.e.x, p.x) - p.x, dy = c.e.y - p.y, d = Math.hypot(dx, dy);
      if (d > FRONT_R || d < 1e-3 || d >= bd || (dx * p.face.x + dy * p.face.y) / d < FRONT_COS || !sees(c)) continue;
      bd = d; best = c;
    }
    return best;
  }
  // The prompt's Y row: «Greet Rosa», with something to do with E (near) only if E is about the same person (aimE: who E aims
  // at); without it, for whoever is under the cursor farther away. While Y is held, what it is about to do. '' : nothing
  promptFor(aimE, near) {
    const c = this.picked;
    if (!c) return '';
    if (near && !(aimE && c.e === aimE)) return '';
    return this.ringOn && c.kind !== 'kid' && this.hold?.target?.e === c.e ? t('social.hold') : c.kind === 'npc' ? t('talk.row.greet') : t('social.prompt.far', { name: c.name });
  }
  // The neighbour those rows are about, for the tag over them (talk.js focus) and the row of provoking: { id, n } or null
  focused() { const c = this.picked; return c?.kind === 'npc' ? { id: c.id, n: c.id === 'nilo' ? undefined : c.e, ringing: this.ringOn && this.hold?.target?.e === c.e } : null; }

  // ---------- pressing ----------
  // src 'key' (Y) or 'mouse' (right click at x, y). With the mouse and nobody there it returns false: the right click does
  // what it did before (sit the dog down)
  press(src, x, y) {
    const g = this.game;
    if (!this.can()) return src !== 'mouse' ? true : false;
    if (this.hold) return true;
    const m = g.mouse, cursor = src === 'mouse' ? [x, y] : m?.in && !g.windowsOpen ? [m.x, m.y] : [null, null];
    const target = this.pick(cursor[0], cursor[1], src !== 'mouse');
    if (src === 'mouse' && !target) return false;
    if (g.time - this.lastAt < COOLDOWN) { Audio.error(); return true; }
    this.hold = { src, t: 0, target, x: cursor[0], y: cursor[1] };
    return true;
  }
  // Let go before HOLD: a greeting (always)
  release(src) {
    const h = this.hold;
    if (!h || (src && h.src !== src)) return;
    this.hold = null;
    this.showRing(-1);
    this.act(0, h.target);
  }
  cancel() { this.hold = null; this.showRing(-1); }

  update(dt) {
    const g = this.game;
    if (!g.player) return;
    const h = this.hold;
    if (h) {
      if (!this.can()) this.cancel();
      else {
        h.t += dt;
        if (h.t >= HOLD) { this.hold = null; if (this.rowed) hud.promptHold('Y', 1, true); this.showRing(-1); this.act(h.target?.kind === 'kid' ? 0 : 1, h.target); }   // (a child is never provoked)
        else this.showRing(h.t < RING_FROM ? -1 : (h.t - RING_FROM) / (HOLD - RING_FROM), h);
      }
    }
    if (this.queue.length) {
      for (const q of this.queue) q.t -= dt;
      const due = this.queue.filter(q => q.t <= 0);
      if (due.length) { this.queue = this.queue.filter(q => q.t > 0); for (const q of due) q.fn(); }
    }
    if (this.bubbles.length) {
      for (const b of this.bubbles) b.t += dt;
      if (this.bubbles.some(b => b.t >= b.life)) this.bubbles = this.bubbles.filter(b => b.t < b.life);
    }
    if (this.subLines.length && this.subLines.some(l => g.time >= l.until)) { this.subLines = this.subLines.filter(l => g.time < l.until); this.paintSub(); }
    // (a gesture whose body was never drawn, far away or in first person, does not stay pending)
    for (const e of this.emoting) if (!e.emote || g.time - e.emote.at > 3) { if (e.emote && g.time - e.emote.at > 3) delete e.emote; this.emoting.delete(e); }
    if ((this.pickT -= dt) <= 0) {
      this.pickT = PICK_EVERY;
      const m = g.mouse;
      this.picked = m?.in && !g.windowsOpen && this.can() ? this.pick(m.x, m.y) : null;
    }
  }

  // ---------- greeting and provoking ----------
  // a: 0 greet, 1 provoke; c: who (null: the air)
  act(a, c) {
    const g = this.game, p = g.player, R = g.rep;
    if (!this.can() || !p) return;
    if (c && !this.candidates().some(o => o.e === c.e)) c = null;   // (gone meanwhile: hidden indoors, out of the world…)
    this.lastAt = g.time;
    g.archery?.cancel?.();   // (greeting lets go of the drawn bow, as changing tools does)
    if (c) { const dx = nearX(c.e.x, p.x) - p.x, dy = c.e.y - p.y, d = Math.hypot(dx, dy); if (d > 0.05 && !CAM.first) { p.face = { x: dx / d, y: dy / d }; p.dir = [dx, dy]; } }
    const msg = { t: 'greet', a, to: null, npc: null };
    let key = null;
    if (!c) key = a ? null : 'social.say.air';
    else if (c.kind === 'player') key = a ? 'social.say.insult_player' : this.isPartner(c.peer) ? 'social.say.greet_partner' : 'social.say.greet_player';
    else key = a ? 'social.say.insult' : this.dayKey();
    this.emote(p, a ? (Math.random() < 0.5 ? 'fist' : 'point') : 'wave');   // (provoking: never a hand that could read as a wave)
    if (key) {
      const list = this.lines(key), li = rnd(Math.max(1, list.length));
      msg.p = PLAYER_LINES.indexOf(key); msg.pl = li;
      this.say(p, say1(list, li, { name: c?.name || '' }), { mine: true, life: MY_LIFE });
    }
    if (c?.kind === 'player') {
      msg.to = c.id;
      if (a) {
        const w = this.witnessOf();
        if (w && R?.change(-3, 'insult_player')) { const l = this.lines('npc.witness.quarrel'); this.later(() => this.say(w.e, say1(l, rnd(l.length), { name: p.name }), { name: w.name })); }
      }
    } else if (c) {
      const rel = c.kind === 'kid' ? 'friend' : this.relation(c.id);
      if (c.kind === 'npc' && !c.e?.asleep) this.count(a, c);
      const r = this.replyFor(c, a, rel);
      if (c.kind === 'kid') msg.kid = c.id; else msg.npc = c.id;
      Object.assign(msg, { r: RELS.indexOf(rel), rl: r.li, rg: EMOTE_KINDS.indexOf(r.gesture), rk: REPLY_KINDS.indexOf(r.kind) });
      if (r.rc >= 0) msg.rc = r.rc;
      this.later(() => this.reply(c.e, r.text, r.gesture, c.name, true, null, r.kind === 'remark' ? remarkLife(r.text) : NPC_LIFE));
    }
    if (a) Audio.error(); else Audio.blip();
    this.send(msg);
  }
  // What a greeting or a provocation does to the friendship and the reputation (not in creative)
  count(a, c) {
    const g = this.game, R = g.rep, N = g.neighbors, f = N.friend(c.id), today = this.today;
    if (!R?.counts) return;
    if (!a) {
      const d = Math.hypot(nearX(c.e.x, g.player.x) - g.player.x, c.e.y - g.player.y);
      if (d <= COUNT_R && f.greet !== today) { f.greet = today; N.addPoints(c.id, 5); R.change(2, 'greet'); }
      return;
    }
    const first = !(Array.isArray(f.insults) && f.insults[0] === today), n = first ? 1 : (f.insults[1] || 0) + 1;
    N.addPoints(c.id, first && N.hearts(c.id) >= 3 ? -10 : -20);   // (a slip with a friend does not cost Rosa's discount)
    R.change(-8, 'insult');
    N.remember(c.id, 'insult');
    g.gossip?.news('insult', c.id);
    f.insultedAt = today; f.insults = [today, n];
    if (n >= 3) f.snub = today;   // (the third time in a day: they do not talk to you today)
  }
  // How you get along with a neighbor: 'friend', 'neutral' or 'cold' (in creative the reputation counts as «Newcomer»).
  // Their memory (neighbors.js, Plan E §4.5): having seen you take something from a house in the last 3 days makes them
  // cold whatever the hearts, unless you have helped them since; having helped them in the last 3 days lifts any other
  // coldness to neutral. Having heard something bad of you in the last 2 days cools who knows you little (gossip.js). It only changes the answers and gestures, never prices or whether they talk (R.canTalk)
  relation(id) {
    const g = this.game, N = g.neighbors, f = N.friend(id), today = this.today, lv = g.rep?.counts ? g.rep.index : levelIndex('newcomer'), hearts = N.hearts(id);
    const seen = N.memIndex?.(id, 'take_seen', MEM_DAYS) ?? -1, helped = N.memIndex?.(id, 'helped', MEM_DAYS) ?? -1;
    if (seen >= 0 && helped < seen) return 'cold';
    let rel = 'neutral';
    if (f.insultedAt === today || (hearts < 4 && g.gossip?.heardBad(id))) rel = 'cold';   // (they have heard something bad of you: gossip.js)
    else if (hearts >= 4 || lv >= levelIndex('beloved')) rel = 'friend';
    else if (lv <= levelIndex('distrusted') || (hearts === 0 && lv === levelIndex('newcomer') && recent(today, f.insultedAt, 3))) rel = 'cold';
    return rel === 'cold' && helped >= 0 ? 'neutral' : rel;
  }
  // A neighbor's answer: { kind (REPLY_KINDS), key, li, text, gesture, rc (a remark's REMARKS index, or -1) }
  replyFor(c, a, rel) {
    const g = this.game;
    let kind = '', key, gesture, rm = null;
    if (c.kind === 'kid') { kind = 'kid'; key = 'npc.reply.kid'; gesture = 'wave'; }
    else if (c.e?.asleep) { kind = 'asleep'; key = 'npc.reply.asleep'; gesture = ''; }
    else {
      const temper = PEOPLE[c.id]?.temper || 'kind', act = a ? 'insult' : 'greet';
      gesture = REPLY_GESTURE[act][temper][rel];
      if (!a && c.id !== 'nilo' && g.rep?.counts && g.rep.level.id === 'outcast' && g.neighbors.hearts(c.id) < 3) { kind = 'ignore'; key = 'npc.reply.ignore'; gesture = 'dismiss'; }
      else if (!a && (rm = g.remarks?.forGreet(c.id, rel))) { kind = 'remark'; key = rm.key; gesture = rm.gesture; }   // (how you look: remarks.js)
      else if (!a && rel !== 'cold' && g.days.info?.rain && Math.random() < 1 / 3) { kind = 'rain'; key = 'npc.reply.greet.rain'; }
      else key = `npc.reply.${act}.${temper}.${rel}`;
    }
    if (rm) return { kind, key, li: rm.li, gesture, text: rm.text, rc: rm.rc };
    const list = this.lines(key), li = c.kind === 'npc' ? g.neighbors.lineOf(c.id, list) : rnd(Math.max(1, list.length));   // (before you are introduced, without your name)
    return { kind, key, li, gesture, text: say1(list, li, { name: g.player?.name || '' }), rc: -1 };
  }
  // The neighbor (or child) answers: stops, looks at whoever greeted, gestures and says it (life: the bubble's seconds)
  reply(e, text, gesture, name, toMe, from = null, life = NPC_LIFE) {
    const g = this.game, who = toMe ? g.player : from;
    if (!e || e.hidden) return;
    if (!e.pose && 'hold' in e) e.hold = STAY;   // (walking: stops for a moment)
    if (who && typeof e.faceTo === 'function' && !e.pose) e.faceTo(nearX(who.x, e.x) - e.x, who.y - e.y);
    if (gesture) this.emote(e, gesture);
    this.say(e, text, { name, life });
  }
  // A neighbor who sees you (within WITNESS_R, in sight) provoking someone: { e, name } or null
  witnessOf() {
    const g = this.game, w = g.world, p = g.player;
    let best = null, bd = WITNESS_R;
    for (const c of this.candidates()) {
      if (c.kind !== 'npc') continue;
      const d = Math.hypot(nearX(c.e.x, p.x) - p.x, c.e.y - p.y);
      if (d <= bd && (!w.reaches || w.reaches(p.x, p.y, c.e.x, c.e.y))) { bd = d; best = c; }
    }
    return best;
  }
  // The couple (a child in common, or one on the way: see family.js): their own line. The children and pregnancies keep
  // both parents' ids; the ones from before do not, and then it is the player of the other sex, only if there is one
  isPartner(peer) {
    const g = this.game, F = g.family.v, me = Profile.id, id = peer?.id;
    if (!peer?.entity || !id) return false;
    const both = ids => ids.includes(me) && ids.includes(id);
    const kids = Array.isArray(F.kids) ? F.kids : [], x = F.expecting;
    if (kids.some(k => Array.isArray(k?.parents) && both(k.parents)) || (x?.father && both([x.mother, x.father]))) return true;
    if (!kids.some(k => !Array.isArray(k?.parents)) && !(x && !x.father)) return false;   // (no child or pregnancy from before)
    const sex = e => e?.look?.sex || 'chico', mine = sex(g.player);
    const others = [...g.live.peers.values()].filter(q => q.playing && !q.server && q.entity && sex(q.entity) !== mine);
    return others.length === 1 && others[0] === peer;
  }
  // The same by a player's id, also when they are not here (a boat with their big thing in it: carry.js boatGuard): the
  // children and the pregnancy that name both; if they are here, isPartner (which also knows the couples from before)
  isPartnerId(id) {
    const g = this.game, F = g.family?.v || {}, me = Profile.id;
    if (!id || !me || id === me) return false;
    const both = ids => Array.isArray(ids) && ids.includes(me) && ids.includes(id);
    const kids = Array.isArray(F.kids) ? F.kids : [], x = F.expecting;
    if (kids.some(k => both(k?.parents)) || (x?.father && both([x.mother, x.father]))) return true;
    for (const peer of g.live?.peers?.values() || []) if (peer.id === id && peer.entity) return this.isPartner(peer);
    return false;
  }
  // Are players x and y a couple? By the shared family only (no peers, no sex fallback), so every game and the world
  // server agree: the host's guard on horses uses it (Plan F §3.2, src/horse.js ours). See areCouple below
  areCouple(x, y) { return areCouple(this.game.family?.v, x, y); }
  dayKey() {
    const h = this.game.days.hour;
    return PLAYER_LINES[h >= 21 || h < 6 ? 3 : h < 12 ? 0 : h < 19 ? 1 : 2];
  }
  later(fn, s = REPLY_DELAY) { this.queue.push({ t: s, fn }); }

  // ---------- gestures and lines ----------
  lines(key) { return tList(key); }
  // A gesture of the body (actors.js EMOTES). Yours, not swimming, rowing or lying down; it goes to the others in your state
  // (not with local: only seen here)
  emote(e, k, { amp = 1, local = false } = {}) {
    const g = this.game;
    if (e === g.player && !local) {
      if (!this.canEmote(e)) return;
      this.emSeq++; this.emKind = EMOTE_KINDS.indexOf(k);
    }
    e.emote = { k, t: 0, at: g.time, amp };   // (amp: how big, for the talk's)
    this.emoting.add(e);
  }
  canEmote(p) { const k = p.pose?.kind; return !p.swim && !p.boat && k !== 'lie' && k !== 'floorLie'; }
  // A line over someone's head (yours, in first person, as a subtitle: your body is not drawn). One per person. With a
  // window open the bubbles would be under it: then every line goes to the subtitle, above the windows, with who says it
  say(e, text, { name = '', life = NPC_LIFE, mine = false } = {}) {
    if (!text || !this.ui) return;
    const g = this.game;
    if (e === g.player && CAM.first) { this.subtitle(text, life); return; }
    if (g.windowsOpen) { const who = mine ? g.player?.name : name; this.subtitle(text, life, { who: who || '', color: 'var(--ink-2, #d8c8a8)' }); return; }
    this.bubbles = this.bubbles.filter(b => b.e !== e);
    this.bubbles.push({ e, text, name: mine ? '' : name, t: 0, life, mine });
    if (this.bubbles.length > MAX_BUBBLES) this.bubbles.shift();
  }
  // A line in the subtitle, under the one before (two at most); '' clears it
  // (who, color: whose line it is, before it in that colour)
  subtitle(text, life = MY_LIFE, { who = '', color = '' } = {}) {
    if (!this.ui) return;
    if (text) { this.subLines.push({ text, who, color, until: this.game.time + life }); if (this.subLines.length > 2) this.subLines.shift(); }
    else this.subLines = [];
    this.paintSub();
  }
  paintSub() {
    const sig = this.subLines.map(l => `${l.who}\u0001${l.color}\u0001${l.text}`).join('\u0002');
    if (this.subSig !== sig) {
      this.subSig = sig;
      if (sig) this.sub.replaceChildren(...this.subLines.map(l => {   // (empty: the last one fades where it was)
        const row = document.createElement('div');
        if (l.who) { const b = document.createElement('b'); b.textContent = l.who; b.style.color = l.color; row.append(b); }
        row.append(l.text);
        return row;
      }));
    }
    this.sub.classList.toggle('on', !!sig);
  }
  // The ring while Y (or the right button) is held: next to the cursor, or in the middle (first person, no cursor)
  showRing(k, h) {
    if (!this.ui) return;
    // (on the prompt's Y, if it says it about someone; greeting the air, a ring of its own at the cursor)
    const on = k >= 0, rowed = on && !!h.target && hud.promptHold('Y', k);
    if (!rowed && this.rowed) hud.promptHold('Y', -1);
    this.rowed = rowed; this.ringOn = on;
    if ((on && !rowed) !== this.ownRing) {
      this.ownRing = on && !rowed;
      this.ring.classList.toggle('on', this.ownRing);
      if (this.ownRing) this.ring.lastChild.textContent = t('social.hold');
    }
    if (!this.ownRing) { this.ringK = -1; return; }
    const x = CAM.first || h.x === null ? innerWidth / 2 : h.x, y = CAM.first || h.y === null ? innerHeight / 2 : h.y;
    if (x !== this.ringX || y !== this.ringY) { this.ringX = x; this.ringY = y; this.ring.style.transform = `translate(${Math.round(x + 16)}px, ${Math.round(y - 17)}px)`; }
    const fill = Math.round(Math.min(1, k) * 100);
    if (fill !== this.ringK) { this.ringK = fill; this.ring.querySelector('.fg').setAttribute('stroke-dashoffset', String(100 - fill)); }
  }

  // ---------- the network ----------
  send(m) { const L = this.game.live; if (L.joined && !Profile.server) L.net?.send(m); }
  // A 'greet' from another player (live.js): their line over their head, the neighbor's answer a moment later, and if it
  // was for you, a small notice (one per player every TOAST_GAP s) and BACK_FOR s in which your Y greets them back.
  // Indexes that do not fit, a neighbor this game does not know or has indoors: that part is left out
  heard(conn, peer, m) {
    const g = this.game, e = peer?.entity;
    if (!g.player || !e || g.scene !== g.world) return;
    if (g.time - (peer.greetAt ?? -Infinity) < NET_GAP) return;
    peer.greetAt = g.time;
    const a = m.a === 1 ? 1 : 0, int = v => Number.isInteger(v) && v >= 0 && v < 1000;
    const kid = typeof m.kid === 'string' ? g.family.ents.get(m.kid) : null, kidName = kid && g.family.v.kids.find(k => k.id === m.kid)?.name;
    const npcId = typeof m.npc === 'string' && Object.prototype.hasOwnProperty.call(PEOPLE, m.npc) ? m.npc : null;
    const npc = npcId === 'nilo' ? g.world.nilo : npcId ? g.neighbors.people.find(n => n.id === npcId && !n.hidden) : null;
    const toMe = m.to === Profile.id, other = !toMe && typeof m.to === 'string' ? [...g.live.peers.values()].find(q => q.id === m.to) : null;
    const name = npcId ? PEOPLE[npcId].name : kid ? kidName || '' : toMe ? g.player.name : other?.name || '';
    if (int(m.p) && PLAYER_LINES[m.p] && int(m.pl)) this.say(e, say1(this.lines(PLAYER_LINES[m.p]), m.pl, { name }), { name: peer.name, life: MY_LIFE });
    if ((npc || kid) && int(m.rl) && int(m.rk) && REPLY_KINDS[m.rk] !== undefined) {
      const kind = REPLY_KINDS[m.rk], rel = RELS[m.r] || 'neutral', temper = PEOPLE[npcId]?.temper || 'kind';
      const cond = kind === 'remark' && Number.isInteger(m.rc) && m.rc >= 0 ? REMARKS[m.rc] : null;
      const key = kid ? 'npc.reply.kid' : kind === 'remark' ? null : kind ? (kind === 'rain' ? 'npc.reply.greet.rain' : 'npc.reply.' + kind) : `npc.reply.${a ? 'insult' : 'greet'}.${temper}.${rel}`;
      const list = kind === 'remark' ? (cond ? remarkLines(cond, temper) : null) : this.lines(key);   // (a remark: li into the joined list, remarks.js)
      const text = list ? say1(list, m.rl, { name: peer.name }) : '', gesture = EMOTE_KINDS[m.rg] || null;
      if (list) this.later(() => this.reply(npc || kid, text, gesture, npcId ? PEOPLE[npcId].name : name, false, e, kind === 'remark' ? remarkLife(text) : NPC_LIFE));   // (a remark this game cannot read: no answer)
    }
    if (toMe) {
      if (!a) this.back = { conn, until: g.time + BACK_FOR };
      if (g.time - (peer.toastAt ?? -Infinity) >= TOAST_GAP) { peer.toastAt = g.time; hud.toast(t(a ? 'social.toast.insulted' : 'social.toast.greeted', { name: peer.name }), 'social'); }
    }
  }
}
