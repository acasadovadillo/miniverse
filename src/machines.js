// Lo que lleva su tiempo, como en Minecraft: el horno funde (cada mineral, un lingote) y hace carbón, y el alambique
// destila pociones (un ingrediente llena hasta tres frascos). Cada uno tiene sus casillas (lo que se funde o el
// ingrediente, los frascos y el combustible) y lo hecho, que se recoge (y da experiencia). Sigue solo aunque no estés
// delante: lo que lleva hecho se calcula con el tiempo que ha pasado; sin combustible o sin nada que hacer, se para.
// Se guarda en el trozo del mundo, como los cofres: jugando juntos lo ven y lo usan todos.
import { ITEMS } from './items.js';
import { CHUNK } from './world/gen.js';
import { Audio } from './audio.js';

// time: segundos por cada cosa; makes: lo que sale de cada cosa y la experiencia que da; fuels: los segundos que arde
export const MACHINES = {
  horno: {
    title: 'Fundir', time: 10, slots: { in: 'Para fundir', fuel: 'Combustible' },
    makes: { cobre: ['lingote_cobre', 0.7], hierro: ['lingote_hierro', 0.7], oro: ['lingote_oro', 1], madera: ['carbon', 0.15] },
    fuels: { carbon: 80, madera: 15, tablas: 7.5, fibra: 2.5, heno: 4 },
  },
  alambique: {
    title: 'Destilar', time: 20, bottles: 3, slots: { in: 'Ingrediente', bottle: 'Frascos', fuel: 'Carbón' },
    makes: { miel: ['pocion', 0.5], bayas: ['pocion_regeneracion', 0.5], calavera: ['pocion_fuerza', 0.5], plumas: ['pocion_rapidez', 0.5], amatista: ['pocion_resistencia', 0.5] },
    fuels: { carbon: 80 },
  },
};
const MAX_STACK = id => ITEMS[id].stack || 99;

// Lo que cabe en cada casilla
export function fits(def, slot, id) {
  if (slot === 'in') return !!def.makes[id];
  if (slot === 'fuel') return !!def.fuels[id];
  if (slot === 'bottle') return id === 'frasco';
  return false;
}
// ¿Qué haría ahora? { out, xp, n } o null (sin nada que hacer, sin frascos o sin sitio para lo hecho)
function job(m, def) {
  const r = m.in && def.makes[m.in.id];
  if (!r) return null;
  const n = def.bottles ? Math.min(def.bottles, m.bottle?.n || 0) : 1;
  if (!n || (m.out && (m.out.id !== r[0] || m.out.n + n > MAX_STACK(r[0])))) return null;
  return { out: r[0], xp: r[1], n };
}
const take = (m, slot, n) => { m[slot].n -= n; if (m[slot].n <= 0) delete m[slot]; };

// Lo que ha hecho desde la última vez que se miró, hasta ahora (now, en ms). Cambia m y lo devuelve
export function settle(m, def, now = Date.now()) {
  let dt = Math.max(0, Math.min(now - (m.t || now), 7 * 864e5)) / 1000;
  m.t = now;
  while (dt > 1e-6) {
    const r = job(m, def);
    if (!r) { m.prog = 0; break; }
    if (!(m.burn > 1e-6)) {
      const f = m.fuel && def.fuels[m.fuel.id];
      if (!f) { m.prog = 0; break; }
      m.burn = m.max = f;
      take(m, 'fuel', 1);
    }
    const step = Math.min(dt, m.burn, def.time - (m.prog || 0));
    m.prog = (m.prog || 0) + step; m.burn -= step; dt -= step;
    if (m.prog >= def.time - 1e-6) {
      m.prog = 0;
      take(m, 'in', 1);
      if (def.bottles) take(m, 'bottle', r.n);
      m.out = { id: r.out, n: (m.out?.n || 0) + r.n };
      m.xp = (m.xp || 0) + r.xp * r.n;
    }
  }
  return m;
}

// El de una estación colocada (tile: su casilla), o null; con create, lo crea vacío si no lo hay
export function machineAt(world, tile, create = false) {
  const d = world.delta(Math.floor(tile[0] / CHUNK), Math.floor(tile[1] / CHUNK), create), k = `${tile[0]},${tile[1]}`;
  if (!d) return null;
  if (create) { d.machine ||= {}; d.machine[k] ||= { burn: 0, max: 0, prog: 0, t: Date.now() }; }
  return d.machine?.[k] || null;
}
export const machineEmpty = m => !m || !(m.in || m.fuel || m.out || m.bottle);

// Lo que se hace con él desde la pantalla de fabricar (kind: horno o alambique; tile: dónde está)
export class Machines {
  constructor(game) { this.game = game; }
  get(tile, kind, create = false) {
    const m = machineAt(this.game.world, tile, create);
    if (m) settle(m, MACHINES[kind]);
    return m;
  }
  touched(tile) { this.game.world.chestTouched(tile[0], tile[1]); }   // (jugando juntos, que lo vean los demás)
  // Poner en una casilla lo de una casilla de la mochila (lo que quepa)
  put(tile, kind, slot, i) {
    const g = this.game, def = MACHINES[kind], s = g.inv.slots[i];
    if (!s || !fits(def, slot, s.id)) return;
    const m = this.get(tile, kind, true), cur = m[slot];
    if (cur && cur.id !== s.id) return;
    const n = Math.min(s.n, MAX_STACK(s.id) - (cur?.n || 0));
    if (n <= 0) return;
    m[slot] = { id: s.id, n: (cur?.n || 0) + n };
    if (g.inv.infinite) g.inv.changed(); else g.inv.take(i, n);
    this.touched(tile);
    Audio.place();
  }
  // Devolver a la mochila lo de una casilla (o recoger lo hecho, con su experiencia)
  takeBack(tile, kind, slot) {
    const g = this.game, m = this.get(tile, kind);
    const cur = m?.[slot];
    if (!cur) return;
    const left = g.inv.add(cur.id, cur.n);
    const got = cur.n - left;
    if (!got) { g.gather.float('No te cabe: no llevas sitio libre', '#ffb0a0'); Audio.error(); return; }
    if (slot === 'out') {
      const xp = (m.xp || 0) * (got / cur.n);
      m.xp = Math.max(0, (m.xp || 0) - xp);
      g.xp?.add(xp);
      g.gather.float(`+${got} ${ITEMS[cur.id].name}`, '#fff3c0');
    }
    if (left) cur.n = left; else delete m[slot];
    this.touched(tile);
    Audio.blip();
  }
}
