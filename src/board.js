// Tablón de encargos: cada día, tres vecinos piden algo a cambio de monedas y amistad. (The village's projects that were
// paid here are gone: the village is built from day one, villagesites.js)
import { CROPS } from './items.js';
import { priceOf } from './economy.js';
import { BOARD, hasBuilding } from './world/village.js';
import { PEOPLE } from './neighbors.js';
import { ihash } from './util.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { t } from './i18n.js';
import { countOf } from './talktopics.js';

const POOL = [['madera', 20], ['piedra', 15], ['fibra', 12], ['tablas', 15], ['carbon', 5], ['cobre', 4], ['lingote_cobre', 2], ['manzana', 4],
  ['huevo', 3], ['leche', 2], ['pan', 1], ['miel', 1], ['carpa', 1], ['perca', 1], ['sardina', 2], ['lingote_hierro', 1], ['tela', 2], ['antorcha', 5]];
export class Board {
  constructor(game) {
    this.game = game;
    this.done = { day: -1, ids: [] };
  }
  get world() { return this.game.world; }
  reset(save) {
    this.shared = false;   // (a guest: has the host's board come yet?)
    this.done = save.boardDone || { day: -1, ids: [] };
  }
  save(out) { out.boardDone = this.done; }
  // Jugando juntos en directo, como los tiene el anfitrión (an old game's peer may send its projects too: not wanted)
  share(v) { this.shared = true; this.done = v?.done || { day: -1, ids: [] }; }

  // Encargos del día (siempre los mismos para un día y una semilla)
  requests() {
    const T = this.game.days, day = T.dayIndex, seed = this.world.seed, people = ['nilo', 'rosa', 'lia', 'bruno', ...(hasBuilding('dani') ? ['dani'] : [])];
    const pool = POOL.concat(Object.keys(CROPS).filter(c => CROPS[c].seasons.includes(T.season)).map(c => [c, 3]));
    if (this.done.day !== day) this.done = { day, ids: [] };
    return [0, 1, 2].map(i => {
      const [item, n] = pool[Math.floor(ihash(day, i, seed + 9) * pool.length)], who = people[Math.floor(ihash(day, i + 7, seed) * people.length)];
      return { i, who, item, n, reward: Math.round(priceOf(item) * n * 1.8 + 40), done: this.done.ids.includes(i) };
    });
  }

  // The first request of today of that neighbour that is not done, or null
  requestOf(who) { return this.requests().find(r => r.who === who && !r.done) || null; }
  canDeliver(r) { return !!r && !r.done && this.game.inv.count(r.item) >= r.n; }
  // Deliver a request of today: the items go, the reward comes. One path for the board and for handing it over in person
  // (neighbors.js). null if it cannot be (done meanwhile, not enough), else the request
  deliver(r) {
    const g = this.game, now = r && this.requests()[r.i];
    if (!now || now.done || now.item !== r.item || now.who !== r.who || g.inv.count(now.item) < now.n) return null;
    g.inv.remove(now.item, now.n);
    g.addMoney(now.reward);
    g.neighbors.addPoints(now.who, 60);
    g.neighbors.remember?.(now.who, 'helped', now.item);   // (they remember it: neighbors.js, Plan E §4.5)
    g.gossip?.news('helped', now.who, now.item);
    this.done.ids.push(now.i);
    g.stats?.add('encargos', 1);
    g.rep?.change(10, 'errand');
    Audio.unlock();
    return now;
  }

  interact(p, scene) {
    if (scene !== this.world || Math.hypot(p.x - BOARD.x, p.y - BOARD.y - 0.4) > 1.4) return null;
    return { text: t('board.action'), run: () => this.open() };
  }

  aimables(p, scene, box) {
    if (scene !== this.world) return null;
    // (its model: the outline and the aim follow the board itself, not a box around it; see game.js aimTargets)
    return [{ kind: 'sys', box: box(BOARD.x, BOARD.y, 0.75, 0.3, 0, 1.8), model: { name: 'village:board', x: BOARD.x, y: BOARD.y }, exact: true, act: () => ({ text: t('board.action'), run: () => this.open() }) }];
  }

  async open() {
    const g = this.game;
    g.busy = true;
    g.player.stop();
    for (;;) {
      const reqs = this.requests(), opts = reqs.map(r => r.done ? t('board.row.done', { name: PEOPLE[r.who].name }) : t('board.row', { name: PEOPLE[r.who].name, what: countOf(r.item, r.n), reward: r.reward, have: g.inv.count(r.item) }));
      const wanted = g.law?.posters() || [], up = wanted.length ? opts.push(t('law.poster.read')) - 1 : -1;
      const jobs = g.missions?.on ? 1 : 0;   // (the jobs, its second page: missions.js)
      if (jobs) opts.push(t('job.board'));
      opts.push(t('common.close'));
      const pick = await hud.ask(t('board.title'), t('board.ask'), opts);
      if (pick === opts.length - 1) break;
      if (pick === up) { await hud.say(t('board.name'), wanted.slice(0, 4).map(q => t('law.poster', { name: q.name, n: q.bounty }))); continue; }
      if (jobs && pick === opts.length - 2) { await g.missions.board(); if (g.missions.active) break; continue; }
      const r = reqs[pick];
      if (r.done) continue;
      if (!this.canDeliver(r)) { Audio.error(); await hud.say(t('board.name'), [t('board.short', { what: countOf(r.item, Math.max(1, r.n - g.inv.count(r.item))) })]); continue; }
      const got = this.deliver(r);
      if (got) await hud.say(PEOPLE[r.who].name, [g.neighbors.say(r.who, 'thanks'), t('board.reward', { n: got.reward })]);
    }
    g.busy = false;
  }
}
