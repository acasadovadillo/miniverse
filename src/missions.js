// Jobs: what the village asks for that takes a while and is better between two (docs/planes/gta/PLAN-I-juntos.md §1.3, §2, §3.4).
// Each kind is a file of missions/ (drive.js, strongbox.js). They are offered by their giver, in a talk, and on the village's board.
//
// A job is an item of everybody's (ItemSync 'missions', livesync.js), written only by whoever decides the world:
//   { id, kind, by (who started it), nm, crew: [players], away: [those gone for a while], stage, since, until (ms), site: { x, y, poi? },
//     data: { the kind's own }, done?: { at, outcome: 'ok' | 'fail', away, …the kind's own } }
// and '@': { week: { kind: week it was last done }, fail: { kind: day it last went wrong } }. What the players do is a request,
// CLAIMS.job { ev: 'accept' | 'join' | 'leave' | a kind's own, jid, kind, … }, in the chunk of the board (from wherever they are).
// An unknown kind (from a newer game) is kept and shared as it is.
//
// The reward: each one of the crew who is there at the end (not in done.away) is paid by their own game, once, by the job's id
// (save jobs.paid). Solo pays the same.
import { CHUNK } from './world/gen.js';
import { wrapIndex, nearX } from './world/planet.js';
import { BOARD } from './world/village.js';
import { PEOPLE } from './neighbors.js';   // (a cycle, read only inside functions)
import { levelIndex } from './reputation.js';
import { CLAIMS } from './claims.js';
import { Profile } from './accounts.js';
import { randomId } from './carry-items.js';
import { madridMs } from './time.js';
import { JOURNAL_PAGES } from './ui/journal.js';
import { Audio } from './audio.js';
import { reportFault } from './faults.js';
import { hud } from './ui/hud.js';
import { t, tHtml } from './i18n.js';
import { apagada } from './opciones.js';
import { drive } from './missions/drive.js';
import { strongbox } from './missions/strongbox.js';
import { talkOptions } from './talk.js';

export const KINDS = { drive, strongbox };
const ON = !apagada('misiones');   // (?misiones=0: nothing is offered nor shown here; the jobs of the world go on)
const DAY = 864e5, WEEK = 7 * DAY;
export const AWAY_S = 600, DROP_MS = 3 * DAY, JOIN_R = 12, GIVER_HEARTS = 2, REP = 15, FRIEND = 30;
const ASK_R = 9, HIST = 20, SAY_S = 10, TIMER_MIN = 30, LAST_MIN = 10;
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => isMap(o) && Object.prototype.hasOwnProperty.call(o, k);
const me = () => Profile.id || 'me';
const clone = v => structuredClone(v);
const cleanName = s => String(typeof s === 'string' ? s : '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 24);
const sound = j => isMap(j) && typeof j.id === 'string' && own(KINDS, j.kind) && Array.isArray(j.crew) && isMap(j.site) && isMap(j.data);
const KEY = () => `${wrapIndex(Math.floor(BOARD.x / CHUNK), CHUNK)},${Math.floor(BOARD.y / CHUNK)}`;
const now = () => madridMs();

CLAIMS.job = (g, c, d, k, extra) => {
  const M = g.missions;
  if (!M || typeof c.by !== 'string' || !c.by || typeof c.ev !== 'string') return false;
  if (c.ev === 'accept') { const j = M.create(c); if (!j) return false; extra.made = j.id; return true; }
  const j = M.get(c.jid);
  if (!j) return false;
  if (c.ev === 'join') return M.enter(j, c.by);
  if (c.ev === 'leave') return M.quit(j, c.by);
  if (!j.crew.includes(c.by) && !own(KINDS[j.kind], 'open')) return false;
  const ok = !!KINDS[j.kind].onEvent?.(g, j, c.ev, c.by, c);
  if (ok) M.changed();
  return ok;
};

export class Missions {
  constructor(game) {
    this.game = game;
    this.on = ON;
    this.list = new Map();     // id → the item ('@' among them)
    this.clear();
  }
  clear() {
    this.paid = {}; this.history = []; this.left = []; this.mine = {};   // (mine: job → what this game already did of it, once: { box, opened, day })
    this.seen = new Map();     // (here) job → its stage last told
    this.lastSeen = new Map(); // (whoever decides) player → game time they were last here
    this.sayT = -Infinity; this.lineNow = ''; this.slow = 0; this.told = new Set(); this.wait = false; this.v = 0;
  }
  get world() { return this.game.world; }
  decides() { const b = this.game.barrow; return !b || b.decides(); }
  reset(save) {
    this.clear();
    this.list.clear();
    for (const it of Array.isArray(save?.missions) ? save.missions : []) if (isMap(it) && typeof it.id === 'string') this.list.set(it.id, clone(it));
    const S = isMap(save?.jobs) ? save.jobs : {};
    if (isMap(S.paid)) this.paid = S.paid;
    if (Array.isArray(S.history)) this.history = S.history.filter(Array.isArray).slice(-HIST);
    if (Array.isArray(S.left)) this.left = S.left.filter(x => typeof x === 'string').slice(-HIST);
    if (isMap(S.mine)) for (const [id, v] of Object.entries(S.mine)) if (isMap(v)) this.mine[id] = v;
    for (const j of this.jobs()) { this.seen.set(j.id, j.stage); KINDS[j.kind].load?.(this.game, j); }
  }
  save(out) {
    out.missions = [...this.list.values()].map(clone);
    if (Object.keys(this.paid).length || this.history.length || this.left.length || Object.keys(this.mine).length) out.jobs = { paid: this.paid, history: this.history, left: this.left, ...(Object.keys(this.mine).length && { mine: this.mine }) };
  }

  // ---------- everybody's ----------
  netItems() { const out = new Map(); for (const [id, j] of this.list) { const { id: _, ...o } = j; out.set(id, o); } return out; }
  netApply(ops) {
    for (const [kind, id, f, v] of ops) {
      const was = this.list.get(id);
      if (kind === 'drop') { if (was) { this.list.delete(id); if (sound(was)) KINDS[was.kind].end?.(this.game, was); } }
      else if (kind === 'put') this.list.set(id, { ...clone(f), id });
      else if (was && f !== 'id') { if (kind === 'set') was[f] = clone(v); else delete was[f]; }
    }
    this.look();
  }
  share(v) { this.list.clear(); for (const it of Array.isArray(v) ? v : []) if (isMap(it) && typeof it.id === 'string') this.list.set(it.id, clone(it)); this.look(); }
  jobs() { const out = []; for (const j of this.list.values()) if (sound(j)) out.push(j); return out; }
  get(id) { const j = typeof id === 'string' ? this.list.get(id) : null; return sound(j) ? j : null; }
  running() { return this.jobs().filter(j => !j.done); }
  // The job you are in, going on
  get active() { const id = me(); return this.running().find(j => j.crew.includes(id)) || null; }
  isAway(j, id) { return Array.isArray(j.away) && j.away.includes(id); }
  here(j) { return j.crew.filter(id => !this.isAway(j, id)); }
  changed() { this.v++; this.look(); this.game.onSave?.(); }
  // What this game already did of a job (kept in the save, so a reload never does it twice); old notes go after 20 days
  mineOf(id) {
    const day = this.game.days?.realDay ?? 0;
    let v = this.mine[id];
    if (!v) { for (const [k, q] of Object.entries(this.mine)) if (day - (q.day ?? day) > 20) delete this.mine[k]; this.mine[id] = v = { day }; }
    return v;
  }

  // ---------- whoever decides ----------
  mark(what, kind, v) { const it = this.list.get('@') || { id: '@' }; it[what] = { ...(isMap(it[what]) ? it[what] : {}), [kind]: v }; this.list.set('@', it); }
  week() { return Math.floor((now() + 3 * DAY) / WEEK); }   // (from Monday to Sunday)
  // May that kind be taken now in this world? (once a week; after going wrong, the next day)
  free(kind) {
    const at = this.list.get('@');
    return own(KINDS, kind) && !this.running().some(j => j.kind === kind) && !(at?.week?.[kind] === this.week()) && !(at?.fail?.[kind] === Math.floor(now() / DAY));
  }
  near(id, x, y, r) {
    const g = this.game;
    if (id === me() && !Profile.server) { const p = g.player; return !!p && g.scene === g.world && Math.hypot(nearX(p.x, x) - x, p.y - y) <= r; }
    for (const q of g.live?.peers?.values() || []) if (q.id === id && q.playing && q.sc === 'world') { const e = q.entity, at = e ? e.to || [e.x, e.y] : q.at; return Array.isArray(at) && Math.hypot(nearX(at[0], x) - x, at[1] - y) <= r; }
    return false;
  }
  create(c) {
    const g = this.game, K = own(KINDS, c.kind) ? KINDS[c.kind] : null;
    if (!K || !this.free(c.kind) || this.running().some(j => j.crew.includes(c.by))) return null;
    const n = g.neighbors?.people.find(x => x.id === K.giver);
    if (!this.near(c.by, BOARD.x, BOARD.y, ASK_R) && !(n && this.near(c.by, n.x, n.y, ASK_R))) return null;
    const j = { id: randomId() + randomId(), kind: c.kind, by: c.by, nm: cleanName(c.nm), crew: [c.by], stage: K.stages[0], since: now(), until: now() + K.ms, site: null, data: {} };
    let ok = false;
    try { ok = K.start(g, j, c); } catch (e) { reportFault(e, 'Missions.create'); }
    if (!ok || !isMap(j.site)) return null;
    this.list.set(j.id, j);
    this.changed();
    return j;
  }
  enter(j, by) {
    if (j.done || j.crew.includes(by)) return j.crew.includes(by) && !j.done;
    if (j.crew.length >= 4 || KINDS[j.kind].closed(j) || this.running().some(q => q.crew.includes(by))) return false;
    j.crew = [...j.crew, by];
    try { KINDS[j.kind].entered?.(this.game, j, by); } catch (e) { reportFault(e, 'Missions.enter'); }
    this.changed();
    return true;
  }
  quit(j, by) {
    if (j.done || !j.crew.includes(by)) return false;
    j.crew = j.crew.filter(x => x !== by);
    if (Array.isArray(j.away)) j.away = j.away.filter(x => x !== by);
    try { KINDS[j.kind].quitted?.(this.game, j, by); } catch (e) { reportFault(e, 'Missions.quit'); }
    if (!j.crew.length) this.finish(j, 'fail', { why: 'left' }); else this.changed();
    return true;
  }
  stage(j, stage) { if (j.stage === stage) return; j.stage = stage; j.since = now(); this.changed(); }
  finish(j, outcome, more = {}) {
    if (j.done) return;
    j.done = { at: now(), outcome, away: [...(j.away || [])], ...more };
    j.until = Math.min(j.until, now());
    if (outcome === 'ok') this.mark('week', j.kind, this.week()); else this.mark('fail', j.kind, Math.floor(now() / DAY));
    try { KINDS[j.kind].finished?.(this.game, j, outcome); } catch (e) { reportFault(e, 'Missions.finish'); }
    this.changed();
  }
  // Each step, whoever decides: who is here, the time, each kind's own
  run(dt) {
    const g = this.game, R = this.running();
    if (!R.length) { for (const j of this.jobs()) this.over(j, dt); return; }
    const T = g.time;
    if ((this.runT = (this.runT || 0) - dt) <= 0) {
      this.runT = 1;
      for (const j of R) {
        let away = [];
        for (const id of j.crew) {
          const on = (id === me() && !Profile.server && !!g.player) || [...(g.live?.peers?.values() || [])].some(q => q.id === id && q.playing && q.sc);
          if (on || !this.lastSeen.has(id)) this.lastSeen.set(id, T);
          if (T - this.lastSeen.get(id) > AWAY_S || (this.isAway(j, id) && !on)) away.push(id);
        }
        if (JSON.stringify(away) !== JSON.stringify(j.away || [])) { if (away.length) j.away = away; else delete j.away; this.changed(); }
        if (now() >= j.until) { this.finish(j, 'fail', { why: 'time' }); continue; }
        // (everybody gone for over 10 minutes: it goes wrong, unless the game itself was closed)
        if (j.crew.length && away.length === j.crew.length && this.allGone(j, T)) this.finish(j, 'fail', { why: 'left' });
      }
    }
    for (const j of this.jobs()) { if (j.done) this.over(j, dt); else try { KINDS[j.kind].update?.(g, j, dt); } catch (e) { reportFault(e, `Missions.${j.kind}`); } }
  }
  allGone(j, T) { return j.crew.every(id => T - (this.lastSeen.get(id) ?? T) > AWAY_S * 2); }
  over(j, dt) {
    try { KINDS[j.kind].after?.(this.game, j, dt); } catch (e) { reportFault(e, `Missions.${j.kind}`); }
    if (j.done && now() - j.done.at > DROP_MS) { KINDS[j.kind].end?.(this.game, j); this.list.delete(j.id); this.v++; }
  }

  // ---------- asking ----------
  ask(data, done) {
    const g = this.game, w = this.world, k = KEY(), c = { nm: g.player?.name || '', ...data };
    if (this.decides()) {
      const [cx, cy] = k.split(',').map(Number), extra = {};
      let ok = false;
      try { ok = CLAIMS.job(g, { by: me(), k: 'job', ...c }, w.delta(cx, cy, true), k, extra); } catch (e) { reportFault(e, 'Missions.ask'); }
      done?.(!!ok, extra);
      return !!ok;
    }
    this.wait = true;
    g.barrow.claim('job', k, c, v => { this.wait = false; this.v++; done?.(v ? !!v.ok : false, v || {}); });
    return undefined;
  }
  // Could you take that job now? null, or why not: 'taken', 'busy', 'week', 'hearts', 'rep'
  why(kind) {
    const g = this.game, K = KINDS[kind], at = this.list.get('@');
    if (this.active) return 'busy';
    if (this.running().some(j => j.kind === kind)) return 'taken';
    if (at?.week?.[kind] === this.week() || at?.fail?.[kind] === Math.floor(now() / DAY)) return 'week';
    if (g.neighbors.hearts(K.giver) < GIVER_HEARTS) return 'hearts';
    if (g.rep?.counts && g.rep.index < levelIndex('known')) return 'rep';
    return null;
  }
  accept(kind) {
    this.ask({ ev: 'accept', kind, ...(KINDS[kind].propose?.(this.game) || {}) }, ok => { if (ok) Audio.unlock(); else { Audio.error(); hud.toast(t('job.no'), 'warn'); } });
  }
  join(jid) { this.ask({ ev: 'join', jid }, ok => { if (ok) Audio.unlock(); else { Audio.error(); hud.toast(t('job.no_join'), 'warn'); } }); }
  leave(jid) { const j = this.get(jid); if (j) try { KINDS[j.kind].leaving?.(this.game, j); } catch (e) { reportFault(e, 'Missions.leave'); } this.ask({ ev: 'leave', jid }, ok => { if (ok) { this.left = [...this.left, jid].slice(-HIST); this.game.onSave?.(); } }); }
  event(ev, data, done) { const j = this.active; if (j) this.ask({ ev, jid: j.id, ...data }, done); else done?.(false, {}); }
  title(kind) { return t(`job.${kind}.title`); }
  // (the board's second page) The posters: [{ kind, why, join }]
  posters() { return ON ? Object.keys(KINDS).slice(0, 3).map(kind => ({ kind, why: this.why(kind), join: this.running().find(j => j.kind === kind && !j.crew.includes(me()) && !KINDS[j.kind].closed(j)) || null })) : []; }
  poster(kind) { const K = KINDS[kind]; return [t(`job.${kind}.text`), [t('job.reward', { n: K.pay }), t('job.window', { t: t('job.hours', { n: Math.round(K.ms / 36e5) }) }), t('job.best_two')].join(' · ')]; }
  async board() {
    const g = this.game;
    for (;;) {
      const L = this.posters(), opts = L.map(p => t(p.join ? 'job.row_join' : p.why ? 'job.row_no' : 'job.row', { job: this.title(p.kind), giver: PEOPLE[KINDS[p.kind].giver].name, n: KINDS[p.kind].pay, name: p.join?.nm || '', why: p.why ? t(`job.why.${p.why}`, { name: PEOPLE[KINDS[p.kind].giver].name }) : '' }));
      const i = await hud.ask(t('job.board'), t('job.board.ask'), [...opts, t('common.close')]);
      if (!(i >= 0 && i < L.length)) return;
      const p = L[i];
      if (p.join) { if (this.active) { Audio.error(); await hud.say(t('board.name'), [t('job.why.busy')]); continue; } this.join(p.join.id); return; }
      if (p.why) { Audio.error(); await hud.say(t('board.name'), [t(`job.why.${p.why}`, { name: PEOPLE[KINDS[p.kind].giver].name })]); continue; }
      const k = await hud.ask(this.title(p.kind), this.poster(p.kind).join('\n'), [t('job.take'), t('job.not_now')]);
      if (k === 0) { this.accept(p.kind); return; }
    }
  }
  // (in a talk with the giver) Their words, and whether you take it
  async offer(kind) {
    const K = KINDS[kind], name = PEOPLE[K.giver].name, j = this.running().find(q => q.kind === kind && !q.crew.includes(me()));
    if (j && !KINDS[kind].closed(j)) { const k = await hud.ask(name, t('job.offer_join', { name: j.nm || '?', job: this.title(kind) }), [t('job.join'), t('job.not_now')]); if (k === 0) this.join(j.id); return; }
    const why = this.why(kind);
    if (why) { await hud.say(name, [t(`job.${kind}.no.${why === 'busy' ? 'busy' : 'later'}`)]); return; }
    const k = await hud.ask(name, [t(`job.${kind}.offer`), this.poster(kind)[1]].join('\n'), [t('job.take'), t('job.not_now')]);
    if (k === 0) this.accept(kind);
  }

  // ---------- this player ----------
  // What changed in the jobs: a new stage, an end, an invitation
  look() {
    const g = this.game;
    this.v++;
    if (Profile.server || !g.player) return;
    for (const j of this.jobs()) {
      const inIt = j.crew.includes(me()), was = this.seen.get(j.id);
      if (j.done) { this.settle(j, inIt); continue; }
      if (inIt && was !== j.stage) {
        this.seen.set(j.id, j.stage); this.sayT = g.time;
        if (was === undefined && this.on) { hud.toast(t('job.started', { job: this.title(j.kind) }), 'good'); g.smartHud?.want?.('job'); }
        else if (this.on) Audio.blip();
      }
      // (a partner of yours, or somebody at your side, has started one)
      if (!inIt && this.on && !this.told.has(j.id) && !this.left.includes(j.id) && !KINDS[j.kind].closed(j) && j.crew.length && (g.social?.isPartnerId?.(j.by) || this.beside(j.by))) { this.told.add(j.id); hud.toast(t('job.join_toast', { name: j.nm || '?', job: this.title(j.kind) }), 'social'); g.smartHud?.want?.('journal'); }
    }
  }
  beside(id) { const g = this.game; for (const q of g.live?.peers?.values() || []) if (q.id === id && q.entity && q.sc === 'world') return Math.hypot(nearX(q.entity.x, g.player.x) - g.player.x, q.entity.y - g.player.y) <= JOIN_R; return false; }
  // The end of a job you were in: paid once (and once told)
  settle(j, inIt) {
    if (!inIt || own(this.paid, j.id)) return;
    const g = this.game, K = KINDS[j.kind], D = j.done, day = g.days.realDay, ok = D.outcome === 'ok', away = (D.away || []).includes(me());
    this.paid[j.id] = day;
    for (const [id, d] of Object.entries(this.paid)) if (day - d > 20) delete this.paid[id];
    this.history = [...this.history, [day, j.kind, ok ? (away ? 'away' : 'ok') : 'fail']].slice(-HIST);
    if (ok && !away) {
      const r = K.reward(j, g);
      if (r.coins > 0) g.addMoney(r.coins);
      for (const [id, n] of r.items || []) { const left = g.inv.add(id, n); if (left) g.gather.throwOut(id, left); }
      g.neighbors.addPoints(K.giver, FRIEND);
      g.rep?.change(REP, 'job');
      g.stats?.add('jobs_done', 1);
      Audio.unlock();
      hud.toast(t('job.done', { job: this.title(j.kind) }), 'good');
      if (r.coins > 0) hud.toast(t('job.paid', { name: PEOPLE[K.giver].name, n: r.coins }), 'money');
    } else if (ok) hud.toast(t('job.without', { name: j.nm || '?', job: this.title(j.kind) }), 'social');
    else if (this.on) { hud.toast(t('job.failed', { job: this.title(j.kind) }), 'warn'); hud.toast(t(`job.${j.kind}.lost.${D.why === 'time' || D.why === 'herd' ? D.why : 'left'}`), 'social'); }
    g.onSave?.();
  }
  update(dt) {
    const g = this.game;
    if (!this.world) return;
    // (an animal of a job that is no more, after a copy of the world put back: it goes)
    if ((this.strayT = (this.strayT ?? 5) - dt) <= 0) { this.strayT = 30; if (this.decides() && (!g.live?.joined || g.live.role === 'host')) for (const a of [...g.ranch.animals]) if (a.drove && !this.list.has(a.drove)) g.ranch.remove(a); }
    // (with no job in the world, only now and then: a map half or a box left from one that is no more)
    if (!this.list.size) { if ((this.idleT = (this.idleT ?? 0) - dt) <= 0 && !Profile.server && g.player) this.idleT = this.client() ? 0.5 : 2; return; }
    if (this.decides()) this.run(dt);
    if (Profile.server || !g.player) return;
    if ((this.slow -= dt) > 0) return;
    this.slow = 0.5;
    this.look();
    const j = this.active;
    if (j) try { KINDS[j.kind].tell?.(g, j); } catch (e) { reportFault(e, 'Missions.tell'); }
    this.client();
  }
  // Each kind's own of this player, also with no job of theirs (true: call again soon)
  client() { let soon = false; for (const K of Object.values(KINDS)) try { soon = !!K.each?.(this.game) || soon; } catch (e) { reportFault(e, 'Missions.each'); } return soon; }
  minutes(j) { return Math.max(0, Math.ceil((j.until - now()) / 6e4)); }
  // What the line of the first steps says of it (steps.js), or ''. Minimal HUD: a while after each stage, near its place and at the end
  line() {
    const g = this.game, j = this.on && this.active;
    if (!j) return '';
    const m = this.minutes(j), G = KINDS[j.kind].goal?.(g, j), p = g.player, near = G && p && Math.hypot(nearX(G.x, p.x) - p.x, G.y - p.y) < 4;
    if (g.smartHud && g.time - this.sayT > SAY_S && !near && m >= LAST_MIN && !g.smartHud.showAll) return '';
    const text = KINDS[j.kind].line(g, j);
    return m < TIMER_MIN || g.smartHud?.showAll ? `${text} · ${t('job.timer', { m })}` : text;
  }
  // Where the job sends you (the gold mark and the minimap): { x, y }, or null
  goal() {
    const g = this.game, j = this.on && this.active;
    if (!j || g.scene !== g.world) return null;
    const G = KINDS[j.kind].goal?.(g, j);
    return G && Number.isFinite(G.x) ? G : null;
  }
  // (ranch.js) An animal of a job: what E does with it, and the dog's work
  animalAct(a) { const j = this.get(a.drove); return KINDS[j?.kind || 'drive'].animalAct(this.game, j, a); }
  dogWork(dog, owner, dt) {
    if (!this.list.size) return false;
    for (const j of this.running()) if (j.crew.includes(dog.owner) && KINDS[j.kind].dog?.(this.game, j, dog, owner, dt)) return true;
    return false;
  }

  // (game.js) What the cursor offers of a job (the partner with the other half, Bruno's anvil…), and the same without a cursor
  aimables(p, sc, box) {
    if (sc !== this.world || !this.on) return null;
    let out = null;
    for (const K of Object.values(KINDS)) { const L = K.aimables?.(this.game, p, box); if (L?.length) (out ||= []).push(...L); }
    return out;
  }
  interact(p, sc) {
    if (sc !== this.world || !this.on) return null;
    for (const K of Object.values(KINDS)) { const a = K.interact?.(this.game, p); if (a) return a; }
    return null;
  }
  // (gather.js) The left button with the rattle in the hand: thrown (the strongbox's lure)
  target(p, held, def) { return held?.id === 'rattle' && this.game.scene === this.world && this.game.gamemode !== 'spectator' ? strongbox.rattleTarget(this.game, p) : null; }
  // (explore.js) E on the chest of a camp or a tower: a job's, before its own loot (null: as always)
  chestAct(poi) { const j = this.on && this.active; return j ? KINDS[j.kind].chestAct?.(this.game, j, poi) || null : null; }
  // (carry.js speedMul) What slows you with a job's big thing in the arms, if a job says (0: as always)
  helpSlow(id) { return id === 'strongbox' && this.list.size ? strongbox.helpSlow(this.game) : 0; }
  // (mobs.js) A guard of a job killed: it does not come back
  guardDown(m) { const j = this.get(m.guard); if (j && !j.done && Number.isInteger(m.gi) && !(j.data.down || []).includes(m.gi)) { j.data = { ...j.data, down: [...(j.data.down || []), m.gi] }; this.changed(); } }

  // ---------- the journal ----------
  journal() {
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])), out = [], j = this.active, g = this.game;
    const who = q => q.crew.map(id => (id === me() ? g.player?.name || '' : g.live?.nameOf?.(id) || (id === q.by ? q.nm : '') || '?') + (this.isAway(q, id) ? ` (${t('job.away')})` : '')).join(', ');
    if (j) {
      const K = KINDS[j.kind], at = K.stages.indexOf(j.stage);
      out.push(`<h3>${esc(this.title(j.kind))}</h3><p class="j-note">${tHtml('job.timer', { m: this.minutes(j) })} · ${tHtml('job.reward', { n: K.pay })}</p>`);
      out.push(...K.stages.map((s, i) => `<div class="j-row ach ${i < at ? 'done' : ''}"><b>${i < at ? '✓' : i === at ? '▸' : '·'} ${tHtml(`job.${j.kind}.stage.${s}`, K.params?.(g, j))}</b></div>`));
      out.push(`<p class="j-note">${tHtml('job.crew', { list: who(j) })}</p>`);
      out.push(`<p><button type="button" class="btn" data-job-leave="${esc(j.id)}" style="width:auto">${tHtml('job.leave')}</button></p>`);
    }
    for (const q of this.running()) if (q !== j && !q.crew.includes(me())) out.push(`<div class="j-row"><b>${esc(this.title(q.kind))}</b><small>${tHtml('job.of', { name: q.nm || '?' })}</small>${!j && !KINDS[q.kind].closed(q) ? `<button type="button" class="btn" data-job-join="${esc(q.id)}" style="width:auto">${tHtml('job.join')}</button>` : ''}</div>`);
    if (!out.length) out.push(`<p class="j-note">${tHtml('job.none')}</p>`);
    const H = this.history.slice(-10).reverse().filter(h => own(KINDS, h[1]));
    if (H.length) { out.push(`<h3>${tHtml('job.history')}</h3>`); for (const [day, kind, o] of H) out.push(`<div class="j-row"><b>${esc(this.title(kind))}</b><small>${tHtml(`job.hist.${o === 'ok' || o === 'away' ? o : 'fail'}`, { n: Math.max(0, g.days.realDay - day) })}</small></div>`); }
    return out.join('');
  }
  bind(el) {
    el.querySelectorAll('[data-job-join]').forEach(b => { b.onclick = () => { this.join(b.dataset.jobJoin); this.refill(el); }; });
    el.querySelectorAll('[data-job-leave]').forEach(b => { b.onclick = () => { this.leave(b.dataset.jobLeave); this.refill(el); }; });
  }
  refill(el) { setTimeout(() => { if (el.isConnected && el.querySelector('[data-job-join],[data-job-leave]')) { el.innerHTML = this.journal(); this.bind(el); } }, this.decides() ? 0 : 700); }
}
JOURNAL_PAGES.push({ id: 'jobs', label: 'job.tab', when: g => !!g.missions?.on, html: g => g.missions.journal(), bind: (el, g) => g.missions.bind(el) });
// Their giver, in a talk: "Any work for me?"
for (const [kind, K] of Object.entries(KINDS)) talkOptions.add({ id: `job_${kind}`, order: 45, when: c => ON && !c.cold && c.id === K.giver && c.game.neighbors.introduced(c.id), label: () => t('job.ask'), run: c => ({ modal: true, open: () => c.game.missions.offer(kind) }) });
