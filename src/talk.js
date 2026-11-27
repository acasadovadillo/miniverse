// Talking to a neighbour, as in GTA and Red Dead (docs/planes/realismo/PLAN-R6-gente.md §3.2, phase R6.2): the world goes on, what
// they say is a subtitle and what you can do is a short list at the bottom right (ui/talkui.js). You leave by walking away. It
// replaces the box with the portrait for the neighbours only; the shops, mending, trades, the barber's window and Nilo's
// reforms are the windows and questions of always: the talk ends and they open (the handoff).
//
//   game.talk.start(id, n)   E on a neighbour (neighbors.js talk; n: undefined for Nilo). A promise: the talk is over
//   on                       you are talking: E, the left button and Y are the talk's (game.js, main.js, gather.js, social.js)
//   press(), move(d), pick(i), back()   the keys and the mouse (ui/talkui.js)
//   say(id, lines)           what they say; a line lasts by its length, and E or a click skips it
//   end(why), cut(why)       it is over. Nothing that cuts a talk costs friendship or reputation
//   holder(n)                who that neighbour is stopped with: you, another player ('tk') or null (neighbors.js talkWith)
//   heard(conn, peer, m)     'tk': another player talks with a neighbour { t: 'tk', npc, on: 0 | 1 }
//   talkOptions.add({ id, order, when(c), label(c), run(c) })   what can be done in a talk, from any file. run may be async and
//                            gives nothing (back to the list), 'end', or { open: fn, line, modal } (the handoff). And askOptions,
//                            the same for what can be asked
//   focus(id, n, near)       the tag over the rows of whoever is aimed at (ui/prompts.js)
//
// Cost: nothing while nobody talks; talking, a few checks a frame (distances), the dearer ones 4 times a second.
// The gestures talk and think (three/actors.js EMOTES) are drawn by each game and never sent: an old client would wave.
import { PEOPLE } from './neighbors.js';   // (a cycle, read only inside functions)
import { Profile } from './accounts.js';
import { CAM } from './camera.js';
import { SHOPS } from './economy.js';
import { TRADES } from './trades.js';
import { FISH, ITEMS, itemNoun } from './items.js';
import { openBarber } from './barber.js';
import { ROUTINES, slotAt, hhmm } from './routines.js';
import { talkContext, pickTopic, topicLines, forecastBy, moodOf, someOf, countOf, tierOf } from './talktopics.js';
import { nearX } from './world/planet.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { TalkUI } from './ui/talkui.js';
import { accent } from './ui/skin.js';
import { carcassOffer, starsOf, starText } from './quality.js';
import { t, tList, has, formatMessage, noun } from './i18n.js';

export const WALK_R = 3.5, AWAY_S = 1.5;      // tiles away, or seconds going away: the talk is over
export const SO_S = 15, IDLE_S = 25;          // s with the list and nothing picked: «So?», and the end
export const CHATS = 3;                       // topics in one talk; the next answer is that they have things to do
export const TK_AGAIN = 20, TK_TTL = 30;      // s: 'tk' is sent again, and how long one holds
const NET_GAP = 1, HELD_R = 8;                // s between two 'tk' of a player; tiles: farther from the neighbour, it does not hold
export const LATE_S = 45;                     // s of talk before their schedule may cut it
const LATE_MIN = 5;                           // minutes to their next thing, walking
const DANGER_R = 8, PARTNER_R = 3, BOW_COS = Math.cos(15 * Math.PI / 180);
const THINK_S = 0.9, POINT_S = 1.2, STAY = 1.8, HANDOFF_S = 1.1;
const HERE = 7, SEEN = 60;                    // tiles: who is this near is not asked about; how far a player is seen
const SLOW = 0.25;                            // s between two looks at what is dearer (danger, schedule…)
const WET = ['lluvia', 'tormenta', 'nieve'];
export const lineTime = text => Math.max(2.2, Math.min(6, 1.8 + text.length / 18));   // s a line stays
// Their gesture is as big as their character
const AMP = { cheerful: 1, kind: 0.8, wry: 0.6, gruff: 0.4, shy: 0.3 };
const TRADING = new Set(['shop', 'carcass', 'mend', 'shoe', 'haircut', 'trade']);   // (what a hunted player is refused; never Nilo's plans)
const AGAIN = '\u0000again', BACK = '\u0000back', NEXT = '\u0000next';   // (rows of its own)

const registry = () => ({
  list: [],
  add(o) { this.list = [...this.list.filter(x => x.id !== o.id), o].sort((a, b) => a.order - b.order); return () => { this.list = this.list.filter(x => x !== o); }; },
  for(c) { return this.list.filter(o => { try { return o.when(c); } catch { return false; } }); },
});
export const talkOptions = registry(), askOptions = registry();
const opt = (id, order, when, label, run) => talkOptions.add({ id, order, when, label, run });
opt('chat', 10, c => !c.cold, c => t(c.T.chats ? 'talk.opt.more' : 'npc.opt.chat'), c => c.talk.chat(c));
opt('ask', 20, c => !c.cold, () => t('talk.opt.ask'), c => c.talk.ask(c));
opt('gift', 30, c => c.giftable, c => t('npc.opt.gift', { item: itemNoun(c.held.id) }), c => (c.game.inv.held === c.held ? c.N.gift(c.id, c.held, c.npc) : null));
opt('deliver', 40, c => !!c.request && c.game.board.canDeliver(c.request), c => t('talk.opt.deliver', { what: countOf(c.request.item, c.request.n) }), c => c.N.deliver(c.id, c.npc, c.request));
// A hunted carcass in the arms, at Anselmo's while his bar is open (Plan R3-3, quality.js)
opt('carcass', 48, c => c.id === 'anselmo' && c.open && carcassOffer(c.game) > 0, c => t('hunt.sell', { item: noun('item', c.game.carry.held), price: carcassOffer(c.game), stars: starText(starsOf(c.game.carry.cq, c.game.days.now)) }), c => c.game.carry.sellCarcass(carcassOffer(c.game), () => c.talk.say(c.id, [any(tList('hunt.sold.anselmo'))])));
opt('shop', 50, c => c.open, c => t(c.def.shopOpt || 'npc.opt.shop'), c => ({ line: 'handoff', open: () => c.game.onShop?.(c.def.shop) }));
opt('mend', 52, c => c.def.mends && (c.open || !c.shop), () => t('npc.opt.mend'), c => ({ modal: true, open: () => c.N.mend(c.id) }));
// (Bruno shoes your horse at his forge: horsecare.js)
opt('shoe', 53, c => c.id === 'bruno' && c.open && !!c.game.horsecare?.toShoe(c.npc), c => t('shop.bruno.shoe', { name: c.game.horsecare.toShoe(c.npc)?.name || '', price: c.game.horsecare.shoePrice() }), c => { const said = c.game.horsecare.farrier(c.npc); return said ? c.talk.say(c.id, [t('shop.bruno.shoe_done')]) : null; });
opt('when', 51, c => !!c.npc && !!c.shop && !c.open && !c.cold, () => t('talk.opt.when'), c => c.talk.say(c.id, [c.N.whenText(c.id)]));
opt('haircut', 54, c => c.def.service === 'barber' && c.N.inSeat(c.id), () => t('npc.opt.haircut'), c => ({ line: 'handoff', open: () => openBarber(c.game) }));
opt('trade', 56, c => c.open && !!TRADES[c.id], () => t('npc.opt.trade'), c => ({ modal: true, open: () => c.N.trade(c.id) }));
opt('plans', 58, c => c.id === 'nilo', () => t('npc.opt.plans'), c => ({ line: 'handoff', open: () => c.game.onShop?.('nilo') }));   // (the furniture's of always: economy.js, SHOPS.nilo)
opt('house', 60, c => c.id === 'nilo' && !c.game.house.family && Profile.admin && !c.game.live.guest, () => t('npc.opt.house'),   // (the house is the world owner's)
  c => ({ modal: true, open: () => (c.game.house.big ? c.game.offerFamily() : c.game.offerReform()) }));
opt('bye', 1000, () => true, () => t('npc.opt.bye'), () => 'end');
const ask = (id, order, when, run) => askOptions.add({ id, order, when, label: () => t(`talk.ask.${id}`), run });
ask('news', 10, () => true, c => c.talk.askNews(c));
ask('where', 20, c => c.talk.lost(c).length > 0, c => c.talk.askWhere(c));
ask('place', 30, c => c.talk.placesNear().length > 0, c => c.talk.askPlace(c));
ask('weather', 40, () => true, c => c.talk.askWeather(c));

// An hour, in words (the round ones have their own) or as a time
export const untilWords = h => { const k = `npc.until.${String(Math.round(h * 100) / 100).replace('.', '_')}`; return has(k) ? t(k) : t('npc.until.at', { time: hhmm(h) }); };
const DIRS = ['e', 'ne', 'n', 'nw', 'w', 'sw', 's', 'se'];
const dirKey = (dx, dy) => DIRS[(Math.round(Math.atan2(-dy, dx) / (Math.PI / 4)) + 8) % 8];
const any = list => list[Math.floor(Math.random() * list.length)] || '';
const gap = (a, b) => [nearX(a.x, b.x) - b.x, a.y - b.y];   // from b to a
const far = (a, b) => Math.hypot(...gap(a, b));
const roofed = (w, e) => !!w.roofAt?.(Math.floor(e.x), Math.floor(e.y));
// Seated in the tavern or behind the bar: only the head turns
const inPlace = n => !!n && (ROUTINES ? n.spot?.room === 'taberna' : !!n.def.seat);
export const goalKey = node => (String(node).startsWith('door') ? 'home' : String(node).startsWith('pond') ? 'pond' : String(node));
// A neighbour's colour for their name: their clothes', light enough to read over anything
export function nameColor(hex) {
  const n = parseInt(String(hex || '#ffffff').slice(1), 16) || 0xffffff, c = [n >> 16 & 255, n >> 8 & 255, n & 255], top = Math.max(...c, 1);
  const lit = c.map(v => v * 255 / top), L = (0.3 * lit[0] + 0.59 * lit[1] + 0.11 * lit[2]) / 255, k = L < 0.72 ? (0.72 - L) / (1 - L) : 0;
  return `rgb(${lit.map(v => Math.round(v + (255 - v) * k)).join(', ')})`;
}

export class Talk {
  constructor(game) {
    this.game = game;
    this.cur = null;          // the talk going on
    this.after = null;        // a neighbour that a question of theirs (mending, a trade…) keeps stopped
    this.peers = new Map();   // conn → { npc, until, e, name, peer }: who the others talk with
    this.auto = null;         // (the tests: { say(name, lines), ask(name, text, labels) → index }, instead of the screen)
    this.ui = typeof document !== 'undefined' && !Profile.server ? new TalkUI(this) : null;
  }
  get on() { return !!this.cur; }
  get takesClick() { return this.on && !ITEMS[this.game.inv.held?.id]?.bow; }   // (the left button is the talk's; with a bow in the hand it draws it, and whoever it points at leaves)
  reset() { this.stop(); this.peers.clear(); this.after = null; }
  // Without a word: the game ends, another one starts
  stop() { if (this.cur) this.close(this.cur, 'off'); }
  entity(id, npc = this.game.neighbors.people.find(n => n.id === id)) { return npc || (id === 'nilo' ? this.game.world?.nilo : null); }
  has(id) { return this.cur?.id === id; }

  // ---------- who they are stopped with ----------
  holder(n) {
    const T = this.cur, g = this.game;
    if (T && T.npc === n) return g.player;
    if (this.after === n) { if (g.busy || hud.dialogOpen) return g.player; this.after = null; }
    return this.peers.size ? this.peerWith(n.id, n)?.e || null : null;
  }
  // Another player talking with neighbour id now: their entry, or null
  peerWith(id, e = this.entity(id)) {
    for (const [conn, q] of this.peers) {
      if (q.npc !== id) continue;
      if (this.game.time > q.until || this.game.live.peers.get(conn) !== q.peer || q.peer.entity !== q.e || (e && far(q.e, e) > HELD_R)) { this.letGo(conn, q); continue; }
      return q;
    }
    return null;
  }
  letGo(conn, q) {
    this.peers.delete(conn);
    const e = this.entity(q.npc);
    if (e && e.lookTarget === q.e) delete e.lookTarget;
  }
  heard(conn, peer, m) {
    const g = this.game;
    if (!g.player || !peer?.entity || (m.on !== 0 && m.on !== 1) || typeof m.npc !== 'string' || !Object.prototype.hasOwnProperty.call(PEOPLE, m.npc)) return;
    const was = this.peers.get(conn);
    if (!m.on) { if (was?.npc === m.npc) this.letGo(conn, was); return; }
    if (g.time - (peer.tkAt ?? -Infinity) < NET_GAP) return;
    peer.tkAt = g.time;
    if (was && was.npc !== m.npc) this.letGo(conn, was);
    this.peers.set(conn, { npc: m.npc, until: g.time + TK_TTL, e: peer.entity, name: peer.name, peer });
  }
  send(id, on) { const L = this.game.live; if (L?.joined && !Profile.server && !String(id).startsWith('tv:')) L.net?.send({ t: 'tk', npc: id, on }); }   // (a stranger's talk is nobody else's: stranger)

  // ---------- a talk ----------
  can() {
    const g = this.game;
    return !!g.player && g.scene === g.world && g.mode === 'play' && !g.busy && !hud.dialogOpen && !g.jumping && g.gamemode !== 'spectator' && !Profile.server;
  }
  async start(id, npc) {
    const g = this.game, e = npc || (id === 'nilo' ? g.world?.nilo : null), def = PEOPLE[id];
    if (!def || !e || this.cur || !this.can()) return;
    if (npc?.asleep) { this.sleepy(id, npc); return; }
    const p = g.player, N = g.neighbors, other = this.peerWith(id, e), drawn = g.archery && g.archery.drawT !== null;
    if (drawn) g.archery.cancel();
    if (drawn && this.aimed(e)) { this.gesture(e, 'flinch'); this.last(id, e, N.say(id, 'cut.bow')); return; }   // (they do not talk to who points at them)
    g.social.cancel();
    if (g.build?.on) g.build.toggle(false);
    p.stop();
    if (!CAM.first && !p.mount) { const [dx, dy] = gap(e, p), d = Math.hypot(dx, dy); if (d > 0.05) { p.face = { x: dx / d, y: dy / d }; p.dir = [dx, dy]; } }
    const T = this.cur = { id, npc, e, def, f: N.friend(id), live: true, line: null, menu: null, mainSel: null, last: '', chats: 0, rounds: 0,
      t: 0, idle: 0, away: 0, d: null, slow: 0, turn: 0, tk: TK_AGAIN, wins: !!g.windowsOpen, partner: false, pointing: 0,
      mood: moodOf(id, g.days.realDay, g), slot: npc ? this.slotOf(npc) : null, open: this.openNow(id) };
    e.lookTarget = p;
    if (npc) npc.talkWith = p;
    this.turnTo(T);
    this.send(id, 1);
    g.rumours?.prepare(id);   // (what they would tell of, looked for meanwhile)
    this.ui?.open();
    try { await this.run(T, other); }
    finally { this.close(T, 'done'); }
  }
  // A stranger: a traveller of the roads (travellers.js). The same subtitles and list, with their own words and what they offer;
  // no friendship, nothing sent. s: { id ('tv:…'), e, name, temper, say(key) (their words for 'so', 'bye', 'cut.…'), run(T) (the talk) }
  async stranger(s) {
    const g = this.game, e = s.e, p = g.player;
    if (!e || this.cur || !this.can()) return;
    g.social.cancel();
    if (g.build?.on) g.build.toggle(false);
    p.stop();
    if (!CAM.first && !p.mount) { const [dx, dy] = gap(e, p), d = Math.hypot(dx, dy); if (d > 0.05) { p.face = { x: dx / d, y: dy / d }; p.dir = [dx, dy]; } }
    const T = this.cur = { id: s.id, npc: null, e, def: { name: s.name, temper: s.temper || 'kind' }, f: {}, stranger: s, live: true, line: null, menu: null, mainSel: null, last: '', chats: 0, rounds: 0,
      t: 0, idle: 0, away: 0, d: null, slow: 0, turn: 0, tk: Infinity, wins: !!g.windowsOpen, partner: true, pointing: 0, mood: 0, slot: null, open: false };
    e.lookTarget = p;
    this.turnTo(T);
    this.ui?.open();
    try { await s.run(T); }
    finally { this.close(T, 'done'); }
  }
  async run(T, other) {
    const g = this.game, N = g.neighbors, { id, f } = T;
    // Nilo's first words (how the game starts) and what a game of before the hammer has to be told. Cut or not, it was learned
    const told = id === 'nilo' ? g.niloTells() : null;
    if (told) {
      await this.say(id, told.lines, { wait: told.first });
      if (g.player) told.after();
      if (!T.live) return;
      if (told.first) { this.end('bye'); return; }
    }
    const met = N.introduced(id), { cold, sore } = N.meet(id);
    let spoke = !!told;
    for (const ev of cold ? [] : N.dueEvents(id)) {   // (the friendship's moments)
      await this.say(id, ev.lines, { wait: true });
      if (g.player) ev.give();   // (cut too; not if the game is over: it will be told again)
      if (T.live && ev.flag === 'pista_barco') await g.rumours?.wreck(T);
      if (!T.live) return;
      spoke = true;
    }
    if (!spoke) await this.say(id, [cold ? N.line(this.openNow(id) ? 'npc.refuse.shop' : 'npc.refuse') : sore ? N.line('npc.reproach') : other && met ? N.say(id, 'busy_with', { other: other.name }) : N.greeting(id, met)].flatMap(s => s.split(' | ')));
    while (T.live) {
      const c = this.ctx(T, cold, sore), opts = talkOptions.for(c);
      const k = await this.menu(T, opts.map(o => ({ id: o.id, text: o.label(c) })), true);
      if (!T.live) return;
      if (k === AGAIN) continue;
      const o = opts.find(o => o.id === k);
      if (o && TRADING.has(o.id) && g.law?.refuses()) { await this.say(id, [N.line('law.refused')]); continue; }   // (hunted: law.js)
      const r = o ? await o.run(c) : 'end';
      if (!T.live) return;
      if (r === 'end' || (this.auto && ++T.rounds > 12)) { this.bye(T); return; }
      if (r?.open) { await this.handoff(T, r); return; }
    }
  }
  ctx(T, cold, sore) {
    const g = this.game, N = g.neighbors, held = g.inv.held;
    return { talk: this, T, game: g, N, id: T.id, npc: T.npc, def: T.def, f: T.f, cold, sore, held, shop: T.def.shop && SHOPS[T.def.shop], open: this.openNow(T.id),
      giftable: !!held && !!ITEMS[held.id] && !ITEMS[held.id].tool && T.f.gift !== N.today, request: g.board?.requestOf(T.id) };
  }
  openNow(id) {
    return this.game.neighbors.isOpen(id);
  }
  // What else there is: a window or a question of always. The talk is over, but they stay there (after) while a question lasts
  async handoff(T, r) {
    const g = this.game, { id, npc } = T;
    if (r.line) { await this.say(id, [g.neighbors.say(id, r.line)], { wait: true, dur: HANDOFF_S }); if (!T.live) return; }
    this.close(T, 'handoff');
    if (!r.modal) { r.open(); return; }
    g.busy = true; g.player.stop();
    this.after = npc || null;
    if (npc) npc.talkWith = g.player;
    try { await r.open(); } finally { g.busy = false; this.after = null; if (npc) npc.talkWith = this.holder(npc); }
  }

  // ---------- lines ----------
  // What neighbour id says (or you: who 'me'), line by line. wait: until the last one is over too (else the list comes with it)
  async say(id, lines, { wait = false, dur = 0, who = id } = {}) {
    const T = this.cur, list = (Array.isArray(lines) ? lines : [lines]).filter(Boolean), me = who === 'me';
    if (!T || T.id !== id || !list.length) return;
    const name = me ? this.game.player.name : T.def.name;
    if (!me) T.last = list[0];
    if (this.auto) { await this.auto.say?.(name, list); return; }
    for (const [i, text] of list.entries()) {
      if (!T.live) return;
      const held = wait || i < list.length - 1;
      await new Promise(done => {
        this.endLine(T);
        T.line = { me, t: 0, dur: dur || lineTime(text), done: held ? done : null };
        this.show(name, me ? accent.color : nameColor(T.e.look?.cloth), text, T.line.dur + 0.3);
        if (!me) this.talking(T.e, T.def.temper);
        else { const p = this.game.player; if (this.game.social.canEmote(p)) this.game.social.emote(p, 'talk', { amp: 0.8, local: true }); this.gesture(T.e, 'nod'); }
        if (!held) done();
      });
    }
  }
  // Your words, before they answer
  mine(text) { return this.say(this.cur?.id, [text], { wait: true, who: 'me' }); }
  // One subtitle at a time, kept for the pause's Brief tab
  show(name, color, text, life) {
    this.game.social.subtitle('');
    this.game.social.subtitle(text, life, { who: name, color });
    hud.log.say(name, text);
  }
  // The last thing they say: it stays on the screen a moment, but the talk is over. bubble: over their head (you are leaving)
  last(id, e, text, bubble = false) {
    const name = PEOPLE[id]?.name ?? e?.name ?? '';
    if (!text || !e || this.auto) return;
    if (bubble) { this.game.social.say(e, text, { name }); hud.log.say(name, text); }
    else this.show(name, nameColor(e.look?.cloth), text, lineTime(text));
  }
  endLine(T) { const L = T.line; T.line = null; L?.done?.(); }
  // Their hands while their line is up; any other gesture of theirs
  talking(e, temper) { if (e && !e.hidden) this.game.social.emote(e, 'talk', { amp: AMP[temper] ?? 0.7 }); }
  gesture(e, k) { if (e && !e.hidden) this.game.social.emote(e, k); }
  hush(e) { if (e?.emote && (e.emote.k === 'talk' || e.emote.k === 'think')) e.emote.t = Math.max(e.emote.t, 1.6); }   // (it eases out)

  // ---------- the list ----------
  // Rows [{ id, text }]: gives the id picked, or null (back, Esc). main: the options of the talk, which what is in the hand changes
  menu(T, rows, main = false) {
    if (!T.live || !rows.length) return Promise.resolve(null);
    if (this.auto) return Promise.resolve(this.auto.ask(T.stranger ? T.def.name : `${T.def.name}  ${'♥'.repeat(this.game.neighbors.hearts(T.id)) || '·'}`, T.last, rows.map(r => r.text))).then(i => rows[i]?.id ?? null);
    return new Promise(done => {
      const sel = main && T.mainSel ? Math.max(0, rows.findIndex(r => r.id === T.mainSel)) : 0;
      T.menu = { rows, sel, done, sig: main ? this.handSig() : null };
      T.idle = 0;
      this.ui?.list(rows, sel);
    });
  }
  handSig() { const h = this.game.inv.held; return h ? h.id : ''; }
  resolve(T, v) {
    const M = T.menu;
    if (!M) return;
    T.menu = null; T.idle = 0;
    if (M.sig !== null) T.mainSel = v === AGAIN ? M.rows[M.sel].id : v;   // (the list comes back where it was)
    this.ui?.list(null);
    M.done(v);
  }
  // E (or Enter): skips the line, or picks the row
  press() {
    const T = this.cur;
    if (!T) return;
    if (T.line) { Audio.blip(); this.skip(T); } else if (T.menu) this.pick(T.menu.sel);
  }
  // The left button on the world: skips the line; with the pointer caught (first person) it picks too
  click() { const T = this.cur; if (T?.line || (T && CAM.first && document.pointerLockElement)) this.press(); }
  skip(T) { this.game.social.subtitle(''); this.hush(T.e); this.endLine(T); }
  move(d) { const M = this.cur?.menu; if (!M) return; this.hover((M.sel + d + M.rows.length) % M.rows.length); Audio.blip(); }
  hover(i) { const T = this.cur, M = T?.menu; if (M && i !== M.sel && M.rows[i]) { M.sel = i; T.idle = 0; this.ui?.select(i); } }
  pick(i) {
    const T = this.cur, M = T?.menu;
    if (!M?.rows[i]) return;
    Audio.blip();
    M.sel = i;
    if (T.line) this.skip(T);
    this.resolve(T, M.rows[i].id);
  }
  // Esc: out of a sub-list; from the list, goodbye
  back() {
    const T = this.cur;
    if (!T) return;
    Audio.blip();
    if (T.line) this.skip(T);
    if (T.menu) this.resolve(T, null);
  }

  // ---------- the end ----------
  bye(T) {
    const N = this.game.neighbors, h = this.game.days.hour;
    if (T.stranger) { this.end('bye', T.stranger.say('bye'), 'wave'); return; }
    this.end('bye', this.wet(T) ? N.say(T.id, 'cut.rain') : N.say(T.id, T.mood < 0 ? 'bye.low' : h >= 21 || h < 6 ? 'bye.night' : 'bye'), T.mood < 0 ? 'dismiss' : 'wave');
  }
  // Whatever it was, the talk is over. text: their last words; gesture: with them; bubble: over their head
  end(why, text = '', gesture = '', bubble = false) {
    const T = this.cur;
    if (!T) return;
    this.close(T, why);
    if (gesture) this.gesture(T.e, gesture);
    this.last(T.id, T.e, text, bubble);
  }
  cut(why, gesture = '', bubble = false) { const T = this.cur; if (T) this.end(why, T.stranger ? T.stranger.say(`cut.${why}`) : this.game.neighbors.say(T.id, `cut.${why}`), gesture, bubble); }
  hurt() { this.cut('hurt'); }   // (combat.js hit)
  close(T, why) {
    if (!T.live) return;
    T.live = false; this.why = why;
    if (this.cur === T) this.cur = null;
    this.game.social?.subtitle('');
    this.hush(T.e); if (this.game.player) this.hush(this.game.player);
    if (T.e.lookTarget === this.game.player || !this.game.player) delete T.e.lookTarget;
    if (T.npc) { T.npc.talkWith = this.holder(T.npc); if (!inPlace(T.npc) && T.npc.hold < STAY) T.npc.hold = STAY; }   // (a moment more, to say goodbye)
    if (this.game.player) this.send(T.id, 0);
    this.ui?.close();
    const L = T.line, M = T.menu;
    T.line = T.menu = null;
    L?.done?.(); M?.done(null);
  }

  // ---------- each frame ----------
  update(dt) {
    const g = this.game, T = this.cur;
    if (this.peers.size && (this.peerT = (this.peerT || 0) - dt) <= 0) { this.peerT = 1; this.peersTick(); }
    if (!T) return;
    const p = g.player, e = T.e;
    if (!p || g.busy || hud.dialogOpen || g.jumping || g.scene !== g.world || g.gamemode === 'spectator' || g.build?.on || e.hidden || (g.windowsOpen && !T.wins)) { this.end('off'); return; }
    if (!g.windowsOpen) T.wins = false;
    T.t += dt;
    // Walking away
    const d = far(p, e), dd = T.d === null ? 0 : d - T.d;
    T.d = d;
    T.away = dd > 0.2 * dt && d > 1.2 ? T.away + dt : dd < -0.2 * dt || !(Math.hypot(p.vx || 0, p.vy || 0) > 0.1) ? 0 : T.away;
    if (d > WALK_R || T.away > AWAY_S) { this.walked(T); return; }
    // The line, or the list waiting
    const L = T.line;
    if (L) {
      L.t += dt;
      if (!L.me && L.think === undefined && L.t < L.dur - 1 && !e.emote) this.talking(e, T.def.temper);
      if (L.t >= L.dur) this.endLine(T);
    } else if (T.menu) {
      const was = T.idle;
      T.idle += dt;
      if (T.idle >= IDLE_S) { this.cut('idle', 'shrug'); return; }
      if (was < SO_S && T.idle >= SO_S) { const s = T.stranger ? T.stranger.say('so') : g.neighbors.say(T.id, 'so'); if (s) { this.show(T.def.name, nameColor(e.look?.cloth), s, 2.5); this.gesture(e, 'nod'); } }
    }
    if (T.menu && T.menu.sig !== null && T.menu.sig !== this.handSig()) this.resolve(T, AGAIN);
    if ((T.tk -= dt) <= 0) { T.tk = TK_AGAIN; this.send(T.id, 1); }
    if ((T.slow -= dt) > 0) return;
    T.slow = SLOW;
    if ((T.turn += SLOW) >= 1) { T.turn = 0; this.turnTo(T); }
    if (g.archery && g.archery.drawT !== null && this.aimed(e)) { g.archery.cancel(); this.cut('bow', 'flinch'); return; }
    const inside = roofed(g.world, p);
    for (const m of g.combat?.monsters || []) if (far(m, p) < DANGER_R && roofed(g.world, m) === inside) { this.cut('danger', 'flinch'); return; }
    if (T.t > LATE_S && T.npc && this.late(T)) { this.cut('late', 'wave'); return; }
    // Your partner comes: a hello, once
    if (!T.partner && T.menu && !T.line && g.live?.joined) for (const q of g.live.peers.values()) {
      if (!q.playing || q.server || !q.entity || q.sc !== 'world' || far(q.entity, e) > PARTNER_R || !g.social.isPartner(q)) continue;
      T.partner = true;
      this.say(T.id, [g.neighbors.say(T.id, 'cut.partner', { other: q.name })]);
      break;
    }
  }
  // You walked off: mid-sentence, they remember it (the last time only: it must not push better memories out); with the list
  // in sight, it is just a goodbye
  walked(T) {
    const N = this.game.neighbors;
    if (T.stranger) { this.end('walked', T.stranger.say('bye'), 'nod', true); return; }
    if (!T.line || T.line.me || T.line.think) { const h = this.game.days.hour; this.end('walked', N.say(T.id, h >= 21 || h < 6 ? 'bye.night' : 'bye'), 'nod', true); return; }
    if (Array.isArray(T.f.mem)) T.f.mem = T.f.mem.filter(m => m?.[1] !== 'walked_off');
    N.remember(T.id, 'walked_off');
    this.cut('walked', '', true);
  }
  // The neighbours the others talk with: they face them, and speak now and then
  peersTick() {
    for (const q of [...this.peers.values()]) {
      const n = this.game.neighbors.people.find(x => x.id === q.npc), e = this.entity(q.npc, n);
      if (!e || this.cur?.e === e || this.peerWith(q.npc, e) !== q || e.hidden) continue;
      e.lookTarget = q.e;
      if (!e.pose && !inPlace(n)) e.faceTo?.(...gap(q.e, e));
      if (!e.emote && Math.random() < 0.5) this.talking(e, PEOPLE[q.npc].temper);
    }
  }
  // Does their schedule call them? Their next thing has come, or is about to (walking); their shop opens or closes now
  late(T) {
    const n = T.npc, h = this.game.days.hour;
    if (ROUTINES) {
      const s = slotAt(T.id, this.game.days.now);
      if (this.slotOf(n) !== T.slot) return s.spot !== s.prev;
      if (this.openNow(T.id) !== T.open) return true;
      return n.path.length > 0 && (s.until - this.game.days.now) / 6e4 < LATE_MIN;
    }
    if (T.def.seat) return !n.isIn(h);
    if (n.goal(h) !== T.slot || this.openNow(T.id) !== T.open) return true;
    if (!n.path.length) return false;
    const next = T.def.schedule.map(s => s[0]).filter(x => x > h);
    return next.length > 0 && (Math.min(...next) - h) * 60 < LATE_MIN;
  }
  // What they have to do now: a change of it calls them
  slotOf(n) {
    if (!ROUTINES) return n.def.seat ? null : n.goal(this.game.days.hour);
    const s = slotAt(n.id, this.game.days.now);
    return `${s.day}:${s.i}`;
  }
  // In bed: a word half asleep, and that is all
  sleepy(id, e) { this.last(id, e, this.game.neighbors.say(id, 'asleep'), true); }
  // Outdoors, with water or snow falling on them
  wet(T) { const g = this.game; return WET.includes(g.days.weather) && !roofed(g.world, T.e); }
  // Is your bow pointed at them? You face them, or the cursor is on them (it aims at what is under it)
  aimed(e) {
    const g = this.game, p = g.player, [dx, dy] = gap(e, p), d = Math.hypot(dx, dy), fl = Math.hypot(p.face.x, p.face.y) || 1;
    if (g.mouse?.in && g.view3d?.rayAt && g.social.pick(g.mouse.x, g.mouse.y)?.e === e) return true;
    return d > 0.05 && (dx * p.face.x + dy * p.face.y) / (d * fl) >= BOW_COS;
  }
  // Standing, they turn to you; seated (or at their place in the tavern), only the head (three/actors.js lookTarget)
  turnTo(T) { if (!T.e.pose && !inPlace(T.npc) && this.game.time >= T.pointing) T.e.faceTo?.(...gap(this.game.player, T.e)); }
  // They point at what they talk about. Seated, only if it is in front of them
  point(T, x, y) {
    const e = T.e, [dx, dy] = gap({ x, y }, e), d = Math.hypot(dx, dy);
    if (this.auto || d < 0.5) return;
    if (e.pose || inPlace(T.npc)) { const yaw = e.pose?.yaw ?? T.npc?.spot?.yaw ?? T.def.seat?.[2] ?? e.yaw ?? 0; if ((Math.sin(yaw) * dx + Math.cos(yaw) * dy) / d < 0.5) return; }
    else { T.pointing = this.game.time + POINT_S; T.turn = 1 - POINT_S; e.faceTo?.(dx, dy); }
    this.gesture(e, 'point');
  }
  // A moment with the hand to the chin
  async think(T) {
    if (this.auto) return;
    this.endLine(T);
    this.game.social.subtitle('');
    this.gesture(T.e, 'think');
    await new Promise(done => { T.line = { me: false, think: true, t: 0, dur: THINK_S, done }; });
  }

  // ---------- chatting (talktopics.js: what about) ----------
  async chat(c) {
    const { T, N, id } = c, wet = this.wet(T);
    if (T.chats >= (T.mood < 0 || wet ? 1 : CHATS)) { this.end('enough', N.say(id, wet ? 'cut.rain' : 'enough'), T.mood < 0 ? 'dismiss' : 'nod'); return; }
    T.chats++;
    await this.say(id, N.chatLines(id, c.npc, T.mood));
  }

  // ---------- asking ----------
  async ask(c) {
    const opts = askOptions.for(c), k = await this.menu(c.T, [...opts.map(o => ({ id: o.id, text: o.label(c) })), { id: BACK, text: t('talk.opt.back') }]);
    if (c.T.live) await opts.find(o => o.id === k)?.run(c);
  }
  // What's new: the newest thing they know and have not told you (gossip.js); with nothing new, what they think of somebody
  async askNews(c) {
    const { T, N, id } = c;
    await this.mine(N.line('talk.you.news'));
    if (!T.live) return;
    const e = this.game.gossip?.fresh(id), heard = e && this.game.gossip.mention(id, e);
    if (heard) { await this.say(id, heard.split(' | ')); return; }
    const x = pickTopic({ ...talkContext(this.game, id, c.npc), only: 'village' });
    await this.say(id, x ? x.text.split(' | ') : N.chatLines(id, c.npc, 0));
  }
  // Who can be asked about: the other players, and the neighbours you know who are not right here
  lost(c) {
    const g = this.game, N = g.neighbors, out = [];
    if (g.live?.joined) for (const q of g.live.peers.values()) if (q.playing && !q.server && q.entity && q.entity.gm !== 3) out.push({ id: `p:${q.id}`, text: q.name, peer: q });
    for (const id of ['nilo', ...N.people.map(n => n.id)]) {
      const e = this.entity(id);
      if (id !== c.id && e && N.introduced(id) && (e.hidden || far(e, g.player) >= HERE)) out.push({ id, text: PEOPLE[id].name });
    }
    return out;
  }
  // One of a list that may not fit: page rows at a time
  async pickFrom(T, all, page = 6) {
    for (let i = 0; T.live;) {
      const more = all.length > page + 1, rows = more ? all.slice(i, i + page) : all;
      const k = await this.menu(T, [...rows, ...(more ? [{ id: NEXT, text: t('talk.opt.next') }] : []), { id: BACK, text: t('talk.opt.back') }]);
      if (k !== NEXT) return all.find(r => r.id === k) || null;
      i = i + page >= all.length ? 0 : i + page;
    }
    return null;
  }
  async askWhere(c) {
    const { T, N, id } = c, who = await this.pickFrom(T, this.lost(c));
    if (!T.live || !who) return;
    await this.mine(N.line('talk.you.where', { who: who.text }));
    if (!T.live) return;
    const a = who.peer ? this.wherePlayer(T.e, who.peer) : this.whereNeighbour(who.id);
    if (!who.peer) this.game.gossip?.news('looked_for', id, who.id);   // (they will hear of it)
    await this.say(id, [a.text]);
    if (T.live && a.at) this.point(T, ...a.at);
  }
  whereNeighbour(id) {
    const N = this.game.neighbors, w = N.whereIs(id), until = w.until === null ? '' : untilWords(w.until);
    return { text: N.line(`npc.where.${w.kind}`, { who: PEOPLE[id].name, until, goal: w.goal ? t(`npc.goal.${goalKey(w.goal)}`) : '', host: w.who ? PEOPLE[w.who].name : '' }), at: w.at };
  }
  wherePlayer(e, q) {
    const [dx, dy] = gap(q.entity, e), d = Math.hypot(dx, dy), seen = q.sc === 'world' && d <= SEEN;
    return { text: this.game.neighbors.line(`npc.where.player.${!seen ? 'none' : d < 15 ? 'near' : 'far'}`, { who: q.name, dir: t(`place.dir.${dirKey(dx, dy)}`) }), at: seen ? [q.entity.x, q.entity.y] : null };
  }
  // The places you know, the nearest first (what neighbours tell of the others: rumours.js)
  placesNear() {
    const g = this.game;
    if (!g.places?.knownPlaces) return [];
    return g.places.knownPlaces().map(q => ({ id: q.key, q, d: far(q, g.player) })).sort((a, b) => a.d - b.d).slice(0, 6).map(o => ({ ...o, text: g.places.title(o.q) }));
  }
  async askPlace(c) {
    const { T, N, id } = c, o = await this.pickFrom(T, this.placesNear());
    if (!T.live || !o) return;
    await this.mine(N.line('talk.you.place', { place: o.text }));
    if (!T.live) return;
    const [dx, dy] = gap(o.q, T.e), d = Math.hypot(dx, dy);
    await this.say(id, [N.line(`npc.way.${d < 60 ? 'near' : d < 250 ? 'walk' : d < 800 ? 'far' : 'very_far'}`, { place: o.text, dir: t(`place.dir.${dirKey(dx, dy)}`) })]);
    if (T.live) this.point(T, o.q.x, o.q.y);
  }
  // Tomorrow's weather, as talktopics.js knows it: who is not sure says so. After midnight «tomorrow» could be either day
  async askWeather(c) {
    const { T, N, id } = c, g = this.game;
    await this.mine(N.line('talk.you.weather'));
    if (T.live) await this.think(T);
    if (!T.live) return;
    const fc = g.days.hour >= 5 ? forecastBy(id, g) : null, x = fc && any(topicLines(talkContext(g, id, c.npc), 'forecast'));
    if (!x) { await this.say(id, [g.days.hour < 5 ? N.say(id, 'forecast.none') : N.say(id, 'topic.forecast.unsure')]); return; }   // (nobody can know it: an op's weather, a stopped clock)
    const more = fc.sure && !x.key.endsWith(`.${id}`) ? this.addon(id, fc.w) : '';
    await this.say(id, [formatMessage(x.src, N.params(x.params)), more]);
  }
  // What tomorrow's weather means for their trade: Lía's fish, Rosa's watering, Paco's prints
  addon(id, w) {
    if (id !== 'lia') return this.game.neighbors.line(`npc.forecast.addon.${id}.${w}`);
    const like = w === 'lluvia' || w === 'tormenta' ? Object.keys(FISH).filter(k => FISH[k].weather === 'lluvia') : [];
    return like.length ? this.game.neighbors.line('npc.forecast.addon.lia', { fish: someOf(any(like)) }) : '';
  }

  // ---------- the focus tag (over the rows of ui/prompts.js) ----------
  // What is known of the neighbour aimed at: { name, tier, hearts, doing, mood } (far, only the name). Made again every half second
  focus(id, n, near) {
    const g = this.game, N = g.neighbors, F = (this.tag ||= {});
    if (F.id === id && F.near === near && Math.abs(g.time - F.at) < 0.5) return F.v;
    const def = PEOPLE[id], v = { name: def.name, tier: '', hearts: '', doing: '', mood: '' };
    if (near) {
      const hearts = N.hearts(id), met = N.introduced(id), m = hearts >= 2 ? moodOf(id, g.days.realDay, g) : 0;
      v.tier = t(`talk.tier.${met ? tierOf(hearts) : 'stranger'}`, { sex: this.entity(id, n)?.look?.sex === 'chica' ? 'girl' : 'boy' });
      v.hearts = met ? '♥'.repeat(hearts) : '';
      v.doing = this.doing(id, n);
      v.mood = m ? t(m < 0 ? 'talk.mood.low' : 'talk.mood.high') : '';
    }
    Object.assign(F, { id, near, at: g.time, v });
    return v;
  }
  doing(id, n) {
    const q = this.peers.size ? this.peerWith(id) : null;
    if (q) return t('talk.doing.talk', { name: q.name });
    if (!n) return t('talk.doing.rest');
    if (ROUTINES && !n.path.length) {
      const s = n.spot;
      if (s) return t(n.asleep ? 'talk.doing.sleep' : s.work && !n.pose ? 'talk.doing.work' : n.meal ? 'talk.doing.eat' : s.room === 'taberna' ? 'talk.doing.tavern' : s.kind === 'chapel' ? 'talk.doing.chapel' : s.kind === 'visit' ? 'talk.doing.visit' : s.kind === 'shopping' ? 'talk.doing.shop' : 'talk.doing.rest');
    }
    if (!ROUTINES && n.def.seat) return t(n.def.shop && !n.def.sits ? 'talk.doing.work' : 'talk.doing.tavern');
    if (n.path.length) return t('talk.doing.walk', { goal: t(`npc.goal.${goalKey(n.path[n.path.length - 1])}`) });
    return t(n.node === n.def.work ? 'talk.doing.work' : 'talk.doing.rest');
  }
}
