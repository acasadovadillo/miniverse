// Tablón de encargos: cada día, tres vecinos piden algo a cambio de monedas y amistad.
// En el mismo tablón están los proyectos del pueblo: se pagan entre todos (bueno, tú) y el pueblo crece.
import { ITEMS, CROPS } from './items.js';
import { priceOf } from './economy.js';
import { BOARD, setProjects } from './world/village.js';
import { PEOPLE } from './neighbors.js';
import { ihash } from './util.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';

const POOL = [['madera', 20], ['piedra', 15], ['fibra', 12], ['tablas', 15], ['carbon', 5], ['cobre', 4], ['lingote_cobre', 2], ['manzana', 4],
  ['huevo', 3], ['leche', 2], ['pan', 1], ['miel', 1], ['carpa', 1], ['perca', 1], ['sardina', 2], ['lingote_hierro', 1], ['tela', 2], ['antorcha', 5]];
export const PROJECTS = {
  fuente: { name: 'Fuente en la plaza', desc: 'Una fuente para que la plaza luzca. Y para que los pájaros beban.', money: 1500, items: [['piedra', 40]] },
  muelle: { name: 'Muelle en el estanque', desc: 'Lía lleva años pidiéndolo.', money: 1200, items: [['tablas', 40]] },
  mercado: { name: 'Mercado', desc: 'Dos puestos más: Rosa venderá animales y muebles, y Bruno, hierro.', money: 3000, items: [['tablas', 60], ['lingote_cobre', 5]] },
  casa: { name: 'Casa nueva', desc: 'Si hay casa, alguien vendrá a vivir al pueblo.', money: 5000, items: [['tablas', 80], ['piedra', 60]], needs: 'mercado' },
};

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

  interact(p, scene) {
    if (scene !== this.world || Math.hypot(p.x - BOARD.x, p.y - BOARD.y - 0.4) > 1.4) return null;
    return { text: 'Mirar el tablón de encargos', run: () => this.open() };
  }

  async open() {
    const g = this.game;
    g.busy = true;
    g.player.stop();
    for (;;) {
      const reqs = this.requests(), opts = reqs.map(r => r.done ? `✓ ${PEOPLE[r.who].name}: hecho` : `${PEOPLE[r.who].name} pide ${r.n} × ${ITEMS[r.item].name.toLowerCase()} → ${r.reward} 🪙 (tienes ${g.inv.count(r.item)})`);
      opts.push('Proyectos del pueblo', 'Cerrar');
      const pick = await hud.ask('Tablón de encargos', 'Encargos de hoy. Elige uno para entregarlo.', opts);
      if (pick === opts.length - 1) break;
      if (pick === opts.length - 2) { await this.projectsMenu(); continue; }
      const r = reqs[pick];
      if (r.done) continue;
      if (g.inv.count(r.item) < r.n) { Audio.error(); await hud.say('Tablón', [`Te faltan ${r.n - g.inv.count(r.item)} × ${ITEMS[r.item].name.toLowerCase()}.`]); continue; }
      g.inv.remove(r.item, r.n);
      g.addMoney(r.reward);
      g.neighbors.addPoints(r.who, 60);
      this.done.ids.push(r.i);
      g.stats?.add('encargos', 1);
      Audio.unlock();
      await hud.say(PEOPLE[r.who].name, ['¡Muchísimas gracias! Te debo una. Bueno, te debo esto:', `+${r.reward} monedas.`]);
    }
    g.busy = false;
  }

  async projectsMenu() {
    const g = this.game;
    const list = Object.entries(PROJECTS).filter(([id, p]) => !this.projects[id] && (!p.needs || this.projects[p.needs]));
    if (!list.length) { await hud.say('Tablón', ['¡El pueblo está completo! De momento…']); return; }
    const opts = list.map(([, p]) => `${p.name}: ${p.money} 🪙 + ${p.items.map(([i, n]) => `${n} ${ITEMS[i].name.toLowerCase()}`).join(', ')}`).concat(['Volver']);
    const pick = await hud.ask('Proyectos del pueblo', 'Elige un proyecto para pagarlo.', opts);
    if (pick >= list.length) return;
    const [id, p] = list[pick];
    const missing = p.items.find(([i, n]) => g.inv.count(i) < n);
    if (g.money < p.money || missing) { Audio.error(); await hud.say('Tablón', [p.desc, g.money < p.money ? `Te faltan ${p.money - g.money} monedas.` : `Te falta ${ITEMS[missing[0]].name.toLowerCase()}.`]); return; }
    g.addMoney(-p.money);
    for (const [i, n] of p.items) g.inv.remove(i, n);
    this.projects[id] = true;
    setProjects(this.projects);
    this.world.rebuildVillage();
    if (id === 'casa') g.neighbors.moveIn('dani');
    g.stats?.add('proyectos', 1);
    Audio.unlock();
    hud.toast(`¡Proyecto terminado: ${p.name}!`, 'good');
    await hud.say('Nilo', [id === 'casa' ? '¡Ya tenemos vecino nuevo! Se llama Dani y dice que es artista. Ve a saludar.' : `¡Mira qué maravilla! El pueblo gana mucho con ${p.name.toLowerCase()}.`]);
    g.onSave?.();
  }
}
