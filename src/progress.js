// Progreso: estadísticas, habilidades que suben con el uso, el museo del pueblo (colecciones), logros
// y la historia ligera del farero: páginas de su diario en los cofres, una brújula en un templo y un faro
// muy lejos, en el confín del mundo.
import { ITEMS, FISH, BUGS } from './items.js';
import { MUSEUM } from './world/village.js';
import { Audio } from './audio.js';
import { hud } from './ui/hud.js';

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
const SKILLS = {
  tala: 'Tala', mineria: 'Minería', agricultura: 'Agricultura', pesca: 'Pesca',
  cocina: 'Cocina', construccion: 'Construcción', granja: 'Granja', combate: 'Combate',
};
const PERKS = {
  tala: 'Nivel 5: talar cansa menos. Cada nivel: más madera.', mineria: 'Nivel 5: picar cansa menos. Cada nivel: más mineral.',
  agricultura: 'Cada nivel: más cosecha.', pesca: 'Cada nivel: la red es más grande y salen más peces raros y tesoros.', cocina: 'Cada nivel: platos más sabrosos (más energía).',
  construccion: 'Por construir, que es muy bonito.', granja: 'Cada nivel: animales más contentos.', combate: 'Nivel 5: golpeas más fuerte.',
};
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
    if (after > before) { hud.toast(`¡${SKILLS[k]} sube a nivel ${after}!`, 'good'); Audio.unlock(); }
  }
  bonus(k) { return this.level(k) * 0.03; }                        // probabilidad extra de algo bueno
  costCut(tool) { return (tool === 'hacha' && this.level('tala') >= 5) || (tool === 'pico' && this.level('mineria') >= 5) ? 1 : 0; }
  journal() {
    return Object.entries(SKILLS).map(([k, name]) => {
      const l = this.level(k), x = this.xp[k] || 0, lo = xpFor(l), hi = xpFor(l + 1), pct = l >= 10 ? 100 : Math.round(((x - lo) / (hi - lo)) * 100);
      return `<div class="j-row"><b>${name}</b><span class="lvl">Nivel ${l}</span><span class="bar"><i style="width:${pct}%"></i></span><small>${PERKS[k]}</small></div>`;
    }).join('');
  }
}

// ---------- Museo ----------
const MINERALS = ['cobre', 'hierro', 'oro', 'carbon', 'amatista', 'esmeralda', 'rubi', 'diamante'];
const FOSSILS = ['fosil_concha', 'fosil_hueso', 'fosil_ambar', 'moneda_antigua', 'calavera'];
export const COLLECTIONS = { Minerales: MINERALS, 'Fósiles y reliquias': FOSSILS, Peces: Object.keys(FISH), Insectos: Object.keys(BUGS) };
const ALL = Object.values(COLLECTIONS).flat();
const REWARDS = [[5, 300, 'pocion', 2], [12, 800, 'semilla_manzano', 3], [20, 1500, 'lampara', 1], [30, 3000, 'espada_oro', 1], [ALL.length, 8000, 'vitrina', 3]];

export class Collection {
  constructor(game) { this.game = game; this.donated = new Set(); this.seen = new Set(); }
  reset(save) { this.donated = new Set(save.museum || []); this.seen = new Set(save.seenCollect || []); }
  save(out) { out.museum = [...this.donated]; out.seenCollect = [...this.seen]; }
  found(id) { if (ALL.includes(id)) this.seen.add(id); }
  interact(p, scene) {
    const g = this.game;
    if (scene !== g.world || Math.hypot(p.x - MUSEUM.x, p.y - MUSEUM.y) > 1.5) return null;
    const can = ALL.filter(id => !this.donated.has(id) && g.inv.count(id));
    return { text: can.length ? `Donar al museo (${can.length} nuevo${can.length > 1 ? 's' : ''})` : `Museo del pueblo: ${this.donated.size}/${ALL.length}`, run: () => this.donate(can) };
  }
  async donate(list) {
    const g = this.game;
    g.busy = true;
    if (!list.length) { await hud.say('Museo', [`Llevas ${this.donated.size} de ${ALL.length} piezas. Trae minerales, fósiles, peces o insectos que aún no tengamos (mira el diario, tecla J).`]); g.busy = false; return; }
    const before = this.donated.size;
    for (const id of list) { g.inv.remove(id, 1); this.donated.add(id); }
    g.stats.add('donados', list.length);
    Audio.unlock();
    const lines = [`¡Gracias! Has donado: ${list.map(id => ITEMS[id].name.toLowerCase()).join(', ')}. Ya hay ${this.donated.size} de ${ALL.length} piezas.`];
    for (const [n, money, item, k] of REWARDS) if (before < n && this.donated.size >= n) {
      g.addMoney(money); const left = g.inv.add(item, k); if (left) g.gather.throwOut(item, left);
      lines.push(`¡Premio por llegar a ${n} piezas! ${money} monedas y ${k} × ${ITEMS[item].name.toLowerCase()}.`);
    }
    await hud.say('Museo', lines);
    g.busy = false;
  }
  journal() {
    return Object.entries(COLLECTIONS).map(([title, ids]) => `<h3>${title} <small>${ids.filter(i => this.donated.has(i)).length}/${ids.length}</small></h3><div class="j-grid">${ids.map(id => {
      const state = this.donated.has(id) ? 'done' : this.seen.has(id) || this.game.inv.count(id) ? 'seen' : 'none';
      return `<div class="j-cell ${state}" title="${state === 'none' ? '???' : ITEMS[id].name}"><img alt="" data-icon="${id}"></div>`;
    }).join('')}</div>`).join('');
  }

  // Red de insectos: en la hierba (y junto al agua) sale un insecto de la estación y la hora
  target(p, held, def) {
    const g = this.game;
    if (def?.tool !== 'red' || g.scene !== g.world) return null;
    return { tile: null, ok: true, auto: true, label: 'Cazar insectos', use: () => this.net() };
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
    if (!list.length || Math.random() > 0.45) { g.gather.float('Nada…', '#d8e8ff'); return; }
    const [id] = list[Math.floor(Math.random() * list.length)];
    const left = g.inv.add(id, 1);
    if (left) g.gather.throwOut(id, left);
    this.found(id);
    g.gather.float(`¡${ITEMS[id].name}!`, '#ffe08a');
    Audio.pickup();
  }
}

// ---------- Logros ----------
const S = (k, n) => g => g.stats.get(k) >= n;
const ACH = [
  ['primer_arbol', 'Leñador novato', 'Tala tu primer árbol', S('talados', 1)],
  ['talador', 'Leñador de verdad', 'Tala 100 árboles', S('talados', 100)],
  ['banco', 'Manitas', 'Pon un banco de carpintero', g => g.stats.get('estaciones') >= 1],
  ['oro', 'Fiebre del oro', 'Consigue mineral de oro', g => g.inv.count('oro') > 0 || g.stats.get('oro') > 0],
  ['profundo', 'Hasta el fondo', 'Baja al nivel 10 de una cueva', S('profundidad', 10)],
  ['granjero', 'Manos verdes', 'Cosecha 50 veces', S('cosechas', 50)],
  ['pescador', 'Paciencia de pescador', 'Pesca 25 peces', S('peces', 25)],
  ['dorado', '¿Existe de verdad?', 'Pesca el pez dorado', g => g.collection.seen.has('pez_dorado')],
  ['mano_firme', 'Mano firme', 'Pesca un pez sin que se salga nunca de la red', S('perfectos', 1)],
  ['tesoro_agua', 'Algo brilla ahí abajo', 'Saca un tesoro del agua', S('tesoros', 1)],
  ['constructor', 'Arquitecto', 'Pon 100 piezas de construcción', S('piezas', 100)],
  ['casa', 'Hogar, dulce hogar', 'Amplía la casa del pueblo', g => g.house.big],
  ['amigo', 'Buen vecino', 'Llega a 5 corazones con alguien', g => ['nilo', 'rosa', 'lia', 'bruno', 'dani'].some(id => g.neighbors.hearts(id) >= 5)],
  ['mejor_amigo', 'Uña y carne', 'Llega a 10 corazones con alguien', g => ['nilo', 'rosa', 'lia', 'bruno', 'dani'].some(id => g.neighbors.hearts(id) >= 10)],
  ['rico', 'Ahorrador', 'Junta 10 000 monedas', g => g.money >= 10000],
  ['alcalde', 'Alcalde sin cargo', 'Termina los 4 proyectos del pueblo', S('proyectos', 4)],
  ['explorador', 'Explorador', 'Descubre 10 lugares', S('lugares', 10)],
  ['templo', 'Ladrón de tumbas', 'Saquea el tesoro de un templo', S('templos', 1)],
  ['coleccionista', 'Coleccionista', 'Dona 25 piezas al museo', g => g.collection.donated.size >= 25],
  ['chef', 'Chef', 'Cocina 20 platos', S('cocinados', 20)],
  ['valiente', 'Valiente', 'Derrota 50 criaturas', S('criaturas', 50)],
  ['faro', 'El confín del mundo', 'Llega al faro', g => !!g.story?.done],
];
export class Achievements {
  constructor(game) { this.game = game; this.got = new Set(); this.t = 0; }
  reset(save) { this.got = new Set(save.achievements || []); }
  save(out) { out.achievements = [...this.got]; }
  update(dt) {
    if ((this.t += dt) < 1) return;
    this.t = 0;
    for (const [id, name, , check] of ACH) if (!this.got.has(id) && check(this.game)) { this.got.add(id); hud.toast(`🏆 Logro: ${name}`, 'good'); Audio.unlock(); }
  }
  journal() {
    return `<p class="j-note">${this.got.size} de ${ACH.length} logros</p>` + ACH.map(([id, name, desc]) => `<div class="j-row ach ${this.got.has(id) ? 'done' : ''}"><b>${this.got.has(id) ? '🏆' : '·'} ${name}</b><small>${desc}</small></div>`).join('');
  }
}

// ---------- Historia: el diario del farero ----------
const PAGES = [
  'Día 1. Me han dado el faro más lejano del mundo. Dicen que nadie llega hasta aquí. Mejor: así no me molestan.',
  'Día 40. He plantado tomates en la roca. No crecen. Las gaviotas se ríen de mí, lo sé.',
  'Día 112. He hecho una brújula que no apunta al norte: apunta al faro. Por si algún día me pierdo. Soy así de despistado.',
  'Día 200. Bajé a un pueblo llamado Brotes a por harina. Un niño, Nilo, me preguntó si el mundo se acababa. Le dije que no, que solo se cansa.',
  'Día 365. He escondido la brújula en un templo del desierto. Quien la encuentre, que suba al faro. Le espera algo.',
  'Última página. Una luz no se apaga mientras alguien se acuerde de ella. Si lees esto, gracias por acordarte.',
];
export class Story {
  constructor(game) { this.game = game; this.pages = 0; this.done = false; this.compass = false; }
  reset(save) { this.pages = save.storyPages || 0; this.done = !!save.storyDone; this.compass = !!save.storyCompass; }
  save(out) { out.storyPages = this.pages; out.storyDone = this.done; out.storyCompass = this.compass; }
  // Al abrir un cofre de un lugar: una página más del diario (y la brújula en el templo)
  async found(kind) {
    const g = this.game;
    if (kind === 'templo') {
      g.stats.add('templos', 1);
      if (!this.compass) {
        this.compass = true;
        const left = g.inv.add('brujula', 1); if (left) g.gather.throwOut('brujula', left);
        g.busy = true;
        await hud.say('Templo', ['Al fondo del cofre hay una brújula vieja. Su aguja tiembla… y no apunta al norte.', 'En la tapa pone: «Al faro del confín». (Llévala en la mano para seguirla. También aparece en el mapa.)']);
        g.busy = false;
        return;
      }
    }
    if (this.pages >= PAGES.length) return;
    const text = PAGES[this.pages++];
    g.busy = true;
    await hud.say(`Diario del farero · página ${this.pages}`, [text]);
    g.busy = false;
  }
  // Con la brújula en la mano, la pista dice hacia dónde ir
  hint() {
    const g = this.game, p = g.player;
    if (g.inv.held?.id !== 'brujula' || g.scene !== g.world) return '';
    const f = g.places.faro, dx = f.x - p.x, dy = f.y - p.y, d = Math.round(Math.hypot(dx, dy));
    if (d < 6) return '¡Has llegado! Sube al faro';
    const sx = dx - dy, sy = (dx + dy) / 2, a = Math.atan2(sy, sx);   // dirección en pantalla
    const dirs = ['este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste', 'norte', 'noreste'];
    return `La brújula apunta al ${dirs[(Math.round(a / (Math.PI / 4)) + 8) % 8]} · ${d} pasos`;
  }
  async ending() {
    const g = this.game;
    g.busy = true;
    const first = !this.done;
    this.done = true;
    await hud.say('El faro del confín', first ? [
      'Subes los escalones. Muchos. Demasiados. Arriba, la lámpara sigue encendida, como si alguien la cuidara todavía.',
      'Junto a la lámpara hay una nota: «Si has llegado hasta aquí, ya sabes lo que yo sé: el mundo no se acaba. Solo se cansa. Y tú no».',
      'Desde lo alto ves el mundo entero: bosques, desiertos, el mar… y muy, muy lejos, una columna de humo. La chimenea de tu casa en Pueblo Brotes.',
      '— FIN — (pero el mundo sigue: es infinito, y tuyo)',
    ] : ['La lámpara sigue encendida. Desde aquí arriba se ve todo tan pequeño…']);
    if (first) {
      g.addMoney(5000);
      const left = g.inv.add('lampara', 1); if (left) g.gather.throwOut('lampara', left);
      hud.toast('¡Has llegado al confín del mundo!', 'good');
      Audio.unlock();
    }
    g.busy = false;
    g.onSave?.();
  }
  journal() {
    const g = this.game;
    const goal = this.done ? 'Has llegado al faro del confín. El mundo es tuyo.' : this.compass ? 'Sigue la brújula hasta el faro del confín.' : g.neighbors.flags.faro_rumor ? 'Nilo habla de un faro en el confín del mundo. Busca pistas en ruinas, torres, barcos y templos.' : 'Haz amistad con los vecinos. Quizá alguien sepa qué hay más allá del bosque.';
    return `<p class="j-goal">🧭 ${goal}</p>` + (this.pages ? PAGES.slice(0, this.pages).map((t, i) => `<div class="j-page"><b>Página ${i + 1}</b><p>${t}</p></div>`).join('') : '<p class="j-note">Aún no has encontrado páginas del diario del farero.</p>');
  }
}
export { SKILLS };
