// Tablón de encargos: cada día, tres vecinos piden algo a cambio de monedas y amistad.
// En el mismo tablón están los proyectos del pueblo: se pagan entre todos (bueno, tú) y el pueblo crece.
import { CROPS } from './items.js';
import { priceOf } from './economy.js';
import { BOARD, LOTS, setProjects } from './world/village.js';
import { PEOPLE } from './neighbors.js';
import { CHUNK } from './world/gen.js';
import { ihash } from './util.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { t, defineNames } from './i18n.js';
import { countOf } from './talktopics.js';

const POOL = [['madera', 20], ['piedra', 15], ['fibra', 12], ['tablas', 15], ['carbon', 5], ['cobre', 4], ['lingote_cobre', 2], ['manzana', 4],
  ['huevo', 3], ['leche', 2], ['pan', 1], ['miel', 1], ['carpa', 1], ['perca', 1], ['sardina', 2], ['lingote_hierro', 1], ['tela', 2], ['antorcha', 5]];
// (their names and descriptions: project.<id> and project.<id>.desc in the language files)
export const PROJECTS = defineNames({
  fuente: { money: 1500, items: [['piedra', 40]] },
  muelle: { money: 1200, items: [['tablas', 40]] },
  mercado: { money: 3000, items: [['tablas', 60], ['lingote_cobre', 5]] },
  chapel: { money: 2500, items: [['piedra', 80], ['tablas', 30]], lot: 'chapel' },
  casa: { money: 5000, items: [['tablas', 80], ['piedra', 60]], needs: 'mercado' },
}, 'project');

export class Board {
  constructor(game) {
    this.game = game;
    this.projects = {};
    this.done = { day: -1, ids: [] };
  }
  get world() { return this.game.world; }
  reset(save) {
    this.projects = save.projects || {};
    this.done = save.boardDone || { day: -1, ids: [] };
    setProjects(this.projects);
    this.world.rebuildVillage();
  }
  save(out) { out.projects = this.projects; out.boardDone = this.done; }
  // Jugando juntos en directo, como los tiene el anfitrión (y si se ha terminado un proyecto, el pueblo crece)
  share(v) {
    const had = JSON.stringify(this.projects), casa = this.projects.casa;
    this.projects = v.projects || {};
    this.done = v.done || { day: -1, ids: [] };
    if (JSON.stringify(this.projects) === had) return;
    setProjects(this.projects);
    this.world.rebuildVillage();
    if (this.projects.casa && !casa) this.game.neighbors.moveIn('dani');
  }

  // Encargos del día (siempre los mismos para un día y una semilla)
  requests() {
    const T = this.game.days, day = T.dayIndex, seed = this.world.seed, people = ['nilo', 'rosa', 'lia', 'bruno', ...(this.projects.casa ? ['dani'] : [])];
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
      opts.push(t('board.projects'), t('common.close'));
      const pick = await hud.ask(t('board.title'), t('board.ask'), opts);
      if (pick === opts.length - 1) break;
      if (pick === opts.length - 2) { await this.projectsMenu(); continue; }
      const r = reqs[pick];
      if (r.done) continue;
      if (!this.canDeliver(r)) { Audio.error(); await hud.say(t('board.name'), [t('board.short', { what: countOf(r.item, Math.max(1, r.n - g.inv.count(r.item))) })]); continue; }
      const got = this.deliver(r);
      if (got) await hud.say(PEOPLE[r.who].name, [g.neighbors.say(r.who, 'thanks'), t('board.reward', { n: got.reward })]);
    }
    g.busy = false;
  }

  // How many things a player has on a project's ground: pieces, furniture, fields, holes, plans (board: it waits until it is clear)
  lotBusy(id) {
    const L = LOTS[PROJECTS[id]?.lot], w = this.world;
    if (!L) return 0;
    let n = 0;
    for (let y = L.y0; y < L.y1; y++) for (let x = L.x0; x < L.x1; x++) {
      const d = w.delta(Math.floor(x / CHUNK), Math.floor(y / CHUNK)), k = `${x},${y}`;
      if (d && (['placed', 'floor', 'roof', 'hang', 'rug'].some(l => d[l]?.[k]) || d.tilled?.[k] !== undefined || d.crops?.[k] || d.dig?.[k] !== undefined)) n++;
    }
    return n;
  }
  async projectsMenu() {
    const g = this.game;
    const list = Object.entries(PROJECTS).filter(([id, p]) => !this.projects[id] && (!p.needs || this.projects[p.needs]));
    if (!list.length) { await hud.say(t('board.name'), [t('board.complete')]); return; }
    // (the lot of one that has to wait stays marked on the map while it does)
    this.lotShown = list.some(([id]) => this.lotBusy(id) > 0);
    const opts = list.map(([id, p]) => (this.lotBusy(id) ? t('project.row_busy', { name: p.name }) : t('board.project', { name: p.name, money: p.money, items: p.items.map(([i, n]) => countOf(i, n)).join(', ') }))).concat([t('common.back')]);
    const pick = await hud.ask(t('board.projects'), t('board.projects.ask'), opts);
    if (pick >= list.length) return;
    const [id, p] = list[pick], busy = this.lotBusy(id);
    if (busy) { Audio.error(); await hud.say(t('board.name'), [t('project.lot_busy', { n: busy })]); return; }
    const missing = p.items.find(([i, n]) => g.inv.count(i) < n);
    if (g.money < p.money || missing) { Audio.error(); await hud.say(t('board.name'), [p.desc, g.money < p.money ? t('board.poor', { n: p.money - g.money }) : t('board.short', { what: countOf(missing[0], missing[1] - g.inv.count(missing[0])) })]); return; }
    g.addMoney(-p.money);
    for (const [i, n] of p.items) g.inv.remove(i, n);
    this.projects[id] = true;
    setProjects(this.projects);
    this.world.rebuildVillage();
    if (id === 'casa') g.neighbors.moveIn('dani');
    g.stats?.add('proyectos', 1);
    g.rep?.change(60, 'project');
    // (the whole village remembers it: Nilo and everyone who lives here)
    for (const who of ['nilo', ...g.neighbors.people.map(n => n.id)]) g.neighbors.remember?.(who, 'project', id);
    Audio.unlock();
    hud.toast(t('board.project.done', { name: p.name }), 'good');
    await hud.say(PEOPLE.nilo.name, [t(`board.nilo.${id}`)]);
    g.onSave?.();
  }
}
