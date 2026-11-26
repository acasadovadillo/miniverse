// Progreso: estadísticas, habilidades que suben con el uso, las colecciones (del diario), logros
// y las páginas del diario de un farero, sueltas en los cofres.
import { ITEMS, FISH, BUGS, LEGACY_ITEMS, thingNoun } from './items.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';
import { t } from './i18n.js';
import { apagada } from './opciones.js';
import { SPECIES } from './nature.js';
import { trackerDone } from './tracks.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Estadísticas ----------
export class Stats {
  constructor() { this.v = {}; }
  reset(save) { this.v = save.stats || {}; }
  save(out) { out.stats = this.v; }
  add(k, n = 1) { this.v[k] = (this.v[k] || 0) + n; }
  max(k, n) { this.v[k] = Math.max(this.v[k] || 0, n); }
  get(k) { return this.v[k] || 0; }
}

// ---------- Habilidades ----------
// Their names and perks: skill.<id> and skill.<id>.perk in the language files (read when shown: they follow the language)
export const SKILL_IDS = ['tala', 'mineria', 'agricultura', 'pesca', 'cocina', 'construccion', 'granja', 'combate', 'diving', 'tracking', 'explore'];
const xpFor = lvl => 25 * lvl * (lvl + 1);   // experiencia total para llegar a un nivel
export class Skills {
  constructor(game) { this.game = game; this.xp = {}; }
  reset(save) { this.xp = save.skills || {}; }
  save(out) { out.skills = this.xp; }
  level(k) { let l = 0; while (l < 10 && (this.xp[k] || 0) >= xpFor(l + 1)) l++; return l; }
  gain(k, n) {
    const before = this.level(k);
    this.xp[k] = (this.xp[k] || 0) + n;
    const after = this.level(k);
    if (after > before) { hud.toast(t('skill.up', { skill: t(`skill.${k}`), n: after }), 'good'); Audio.unlock(); }
  }
  bonus(k) { return this.level(k) * 0.03; }                        // probabilidad extra de algo bueno
  costCut(tool) { return (tool === 'hacha' && this.level('tala') >= 5) || (tool === 'pico' && this.level('mineria') >= 5) ? 1 : 0; }
  // Each skill as the Character page shows it: pct, how far it is to the next level (100 at level 10)
  rows() {
    return SKILL_IDS.map(id => {
      const level = this.level(id), x = this.xp[id] || 0, lo = xpFor(level), hi = xpFor(level + 1);
      return { id, level, pct: level >= 10 ? 100 : Math.max(0, Math.min(100, Math.round(((x - lo) / (hi - lo)) * 100))), name: t(`skill.${id}`), perk: t(`skill.${id}.perk`) };
    });
  }
}

// ---------- Colecciones (en el diario, J) ----------
// Lo raro y lo que se colecciona: cada cosa cuenta en cuanto se tiene una vez (no hay que entregarla), y al ir
// llenándolas hay premios. Son de cada jugador. (Antes era el museo del pueblo, donde se donaban: lo donado y lo visto
// entonces cuenta ya como reunido, y los premios que dio no se repiten)
const MINERALS = ['cobre', 'hierro', 'oro', 'carbon', 'amatista', 'esmeralda', 'rubi', 'diamante'];
const FOSSILS = ['fosil_concha', 'fosil_hueso', 'fosil_ambar', 'moneda_antigua', 'calavera'];
const FLOWERS = ['margarita', 'diente_leon'];
const RARE = ['huevo_oro', 'trufa', 'lana_fina', 'asta', 'colmillo'];
// (each collection's name: collections.<id> in the language files)
export const COLLECTIONS = { minerals: MINERALS, fossils: FOSSILS, fish: Object.keys(FISH), insects: Object.keys(BUGS), flowers: FLOWERS, rarities: RARE };
export const COLLECTED_ALL = Object.values(COLLECTIONS).flat().length;
const ALL = Object.values(COLLECTIONS).flat(), IN = new Set(ALL);
// (the fish, insect and flower cells open their nature book page: data-nature, read by the journal; not with ?naturebook=0)
const BOOK = !apagada('naturebook');
const bookCell = id => (BOOK && SPECIES[id] ? ` data-nature="${id}"` : '');
const REWARDS = [[5, 300, 'pocion', 2], [12, 800, 'semilla_manzano', 3], [20, 1500, 'lampara', 1], [30, 3000, 'espada_oro', 1], [ALL.length, 8000, 'vitrina', 3]];

export class Collection {
  constructor(game) { this.game = game; this.got = new Set(); this.paid = 0; this.wait = 0; }
  reset(save) {
    this.got = new Set([...(save.collected || []), ...(save.seenCollect || []), ...(save.museum || [])].filter(id => IN.has(id)));
    // (los premios ya dados: los del museo, por lo donado)
    this.paid = save.collectPaid ?? REWARDS.filter(([n]) => (save.museum || []).length >= n).length;
  }
  save(out) { out.collected = [...this.got]; out.collectPaid = this.paid; }
  // Algo nuevo para las colecciones (lo llaman al recogerlo y al pescarlo; lo demás, update, por lo que se ha tenido)
  found(id, quiet = false) {
    if (!IN.has(id) || this.got.has(id)) return;
    this.got.add(id);
    if (!quiet) hud.toast(t('collections.new', { item: thingNoun(id), n: this.got.size, total: ALL.length }), 'good');
  }
  update(dt) {
    if ((this.wait -= dt) > 0) return;
    this.wait = 1.5;
    const g = this.game;
    if (!g.player || !g.inv) return;
    for (const s of g.inv.slots) if (s) this.found(s.id);
    for (const id of ALL) if (g.craft?.seen.has(id)) this.found(id, true);
    while (this.paid < REWARDS.length && this.got.size >= REWARDS[this.paid][0]) {
      const [n, money, item, k] = REWARDS[this.paid++];
      g.addMoney(money); const left = g.inv.add(item, k); if (left) g.gather.throwOut(item, left);
      if (LEGACY_ITEMS[item]) g.craft.learnPlan(item);   // (un mueble: llegan sus materiales, y con ellos su plano)
      Audio.unlock();
      hud.toast(t('collections.reward', { n, money, k, item: thingNoun(item) }), 'good');
    }
  }
  journal() {
    const next = REWARDS[this.paid], name = id => esc(t('collections.item', { item: thingNoun(id) }));
    const head = `<p class="j-note">${t('collections.head', { n: this.got.size, total: ALL.length })} ${next ? t('collections.next', { n: next[0], money: next[1], k: next[3], item: thingNoun(next[2]) }) : t('collections.all')}</p>`;
    return head + Object.entries(COLLECTIONS).map(([group, ids]) => `<h3>${t('collections.' + group)} <small>${ids.filter(i => this.got.has(i)).length}/${ids.length}</small></h3><div class="j-grid">${ids.map(id => {
      const state = this.got.has(id) ? 'done' : 'none';
      return `<div class="j-cell ${state}" title="${state === 'none' ? '???' : name(id)}"${bookCell(id)}><img alt="" data-icon="${id}"></div>`;
    }).join('')}</div>`).join('');
  }

  // Red de insectos: en la hierba (y junto al agua) sale un insecto de la estación y la hora
  target(p, held, def) {
    const g = this.game;
    if (def?.tool !== 'red' || g.scene !== g.world) return null;
    return { tile: null, ok: true, auto: true, label: t('collections.net'), use: () => this.net() };
  }
  net() {
    const g = this.game, T = g.days, h = T.hour, p = g.player;
    g.gather.cooldown = 0.6; g.gather.swing = 0.3; g.gather.swingItem = 'red';
    if (!g.gather.spend('red')) return;
    Audio.swish();
    const near = (dx, dy) => g.world.water(p.x + dx, p.y + dy);
    const water = near(1.5, 0) || near(-1.5, 0) || near(0, 1.5) || near(0, -1.5), forest = g.world.gen.biomeAt(p.x, p.y) === 4;
    const okHour = b => (b.hours[0] < b.hours[1] ? h >= b.hours[0] && h < b.hours[1] : h >= b.hours[0] || h < b.hours[1]);
    const list = Object.entries(BUGS).filter(([, b]) => b.seasons.includes(T.season) && okHour(b) && (!b.water || water) && (!b.forest || forest));
    if (!list.length || Math.random() > 0.45) { g.gather.float(t('collections.net_nothing'), '#d8e8ff'); return; }
    const [id] = list[Math.floor(Math.random() * list.length)];
    const left = g.inv.add(id, 1);
    if (left) g.gather.throwOut(id, left);
    const fresh = !this.got.has(id);   // (its "new" toast wins over the nature book's message)
    this.found(id);
    g.nature?.harvested(id, 1, fresh);   // (the nature book: Studied, three netted Known)
    g.gather.float(t('collections.caught', { item: thingNoun(id) }), '#ffe08a');
    Audio.pickup();
  }
}

// ---------- Logros ----------
const S = (k, n) => g => g.stats.get(k) >= n;
// An achievement: its name and description come from the language files (ach.<id>, ach.<id>.desc): the same
// [id, name, desc, check] row, with the texts read when shown, so they follow a language switch
function tAch(id, check) {
  const row = [id, '', '', check];
  Object.defineProperty(row, 1, { get: () => t(`ach.${id}`), enumerable: true });
  Object.defineProperty(row, 2, { get: () => t(`ach.${id}.desc`), enumerable: true });
  return row;
}
export const ACH = [
  tAch('primer_arbol', S('talados', 1)),
  tAch('talador', S('talados', 100)),
  tAch('banco', g => g.stats.get('estaciones') >= 1),
  tAch('oro', g => g.inv.count('oro') > 0 || g.stats.get('oro') > 0),
  tAch('profundo', S('profundidad', 10)),
  tAch('granjero', S('cosechas', 50)),
  tAch('pescador', S('peces', 25)),
  tAch('dorado', g => g.collection.got.has('pez_dorado')),
  tAch('tesoro_agua', S('tesoros', 1)),
  tAch('constructor', S('piezas', 100)),
  tAch('casa', g => g.house.big),
  tAch('amigo', g => ['nilo', 'rosa', 'lia', 'bruno', 'dani'].some(id => g.neighbors.hearts(id) >= 5)),
  tAch('mejor_amigo', g => ['nilo', 'rosa', 'lia', 'bruno', 'dani'].some(id => g.neighbors.hearts(id) >= 10)),
  tAch('rico', g => g.money >= 10000),
  tAch('alcalde', S('encargos', 25)),   // (the village's projects are gone: villagesites.js)
  tAch('explorador', S('lugares', 10)),
  tAch('templo', S('templos', 1)),
  tAch('coleccionista', g => g.collection.got.size >= 25),
  tAch('chef', S('cocinados', 20)),
  tAch('valiente', S('criaturas', 50)),
  tAch('faro', S('faros', 1)),
  // Plan G: the nature book and tracking (tracker: a trail followed 60 m or more to the prey, which
  // tracks.js counts in the stat 'trailsFollowed')
  tAch('naturalist', g => (g.nature?.count().n || 0) >= 15),
  tAch('naturalist_all', g => !!g.nature && g.nature.count().n >= g.nature.count().total),
  tAch('tracker', trackerDone),
  // (the table games: tablegames.js)
  tAch('tavern_regular', S('games_played', 20)),
  tAch('table_shark', S('games_coins', 500)),
];
export class Achievements {
  constructor(game) { this.game = game; this.got = new Set(); this.t = 0; }
  reset(save) { this.got = new Set((save.achievements || []).filter(id => ACH.some(a => a[0] === id))); }   // (los logros que ya no existen no cuentan)
  save(out) { out.achievements = [...this.got]; }
  update(dt) {
    if ((this.t += dt) < 1) return;
    this.t = 0;
    for (const [id, name, , check] of ACH) if (!this.got.has(id) && check(this.game)) this.earn(id, name);
  }
  // Un logro conseguido: se avisa y, jugando juntos (con /gamerule announceAdvancements), lo ven los demás en el chat
  earn(id, name) {
    const g = this.game;
    this.got.add(id);
    hud.toast(t('ach.toast', { name }), 'good');
    Audio.unlock();
    if (g.rules?.announceAdvancements !== false) g.live?.chat(name, { adv: true });
  }
  // /achievement grant|revoke: uno (por su id) o todos (*). Devuelven cuántos
  grant(id) { let n = 0; for (const [k, name] of ACH) if ((id === '*' || id === k) && !this.got.has(k)) { this.earn(k, name); n++; } return n; }
  revoke(id) { let n = 0; for (const [k] of ACH) if ((id === '*' || id === k) && this.got.delete(k)) n++; return n; }
  // (the ones done first: Progress › Achievements)
  journal() {
    const row = ([id, name, desc]) => `<div class="j-row ach ${this.got.has(id) ? 'done' : ''}"><b>${this.got.has(id) ? '🏆' : '·'} ${name}</b><small>${desc}</small></div>`;
    return `<p class="j-note">${t('ach.count', { n: this.got.size, total: ACH.length })}</p>` + [...ACH.filter(a => this.got.has(a[0])), ...ACH.filter(a => !this.got.has(a[0]))].map(row).join('');
  }
}

// ---------- Historia: el diario del farero ----------
// Páginas sueltas del diario de un farero en los cofres de los lugares: se leen y quedan en el diario, sin más
// (their texts: story.page.1 to story.page.6)
export const PAGES = 6;
export class Story {
  constructor(game) { this.game = game; this.pages = 0; }
  reset(save) { this.pages = Math.max(0, save.storyPages | 0); }
  save(out) { out.storyPages = this.pages; }
  // Al abrir un cofre de un lugar: una página más del diario
  async found(kind) {
    const g = this.game;
    if (kind === 'templo') g.stats.add('templos', 1);
    if (kind !== 'faro' && kind !== 'barco') return;   // (a lighthouse keeper's pages: in the lighthouses' lockers and in the beached boats)
    if (this.pages >= PAGES) return;
    const n = ++this.pages;
    g.busy = true;
    await hud.say(t('story.page_title', { n }), [t(`story.page.${n}`)]);
    g.busy = false;
  }
  journal() {
    const page = (_, i) => `<div class="j-page"><b>${t('story.page_n', { n: i + 1 })}</b><p>${t(`story.page.${i + 1}`)}</p></div>`;
    return `<p class="j-goal">🧭 ${t('story.goal')}</p>` + (this.pages ? Array.from({ length: Math.min(PAGES, this.pages) }, page).join('') : `<p class="j-note">${t('story.none')}</p>`);
  }
}
