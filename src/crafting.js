// Fabricar: qué recetas conoce el jugador, qué estaciones tiene cerca y hacer las cosas.
import { ITEMS } from './items.js';
import { RECIPES, STATIONS, unlocked } from './recipes.js';
import { Audio } from './audio.js';
import { parsePlaced } from './pieces.js';

export const STATION_REACH = 2.4;   // a cuántas casillas puede estar una estación para usarla
const worn = it => !!it && !!ITEMS[it.id]?.dur && it.dur !== undefined && it.dur < ITEMS[it.id].dur;
// Con qué se repara cada cosa: las herramientas, con lo de su cabeza; las armaduras y las espadas, con su lingote
const TIER_MAT = { 1: 'tablas', 2: 'piedra', 3: 'lingote_cobre', 4: 'lingote_hierro', 5: 'lingote_oro' };
export function repairMat(id) {
  const def = ITEMS[id];
  if (def.metal) return `lingote_${def.metal}`;
  if (id === 'espada') return 'lingote_hierro';
  if (id === 'espada_oro') return 'lingote_oro';
  if (def.tool === 'cana' || def.tool === 'red') return 'cuerda';
  return def.tier ? TIER_MAT[def.tier] : null;
}

export class Crafting {
  constructor(game) {
    this.game = game;
    this.seen = new Set();      // objetos que se han tenido alguna vez
    this.taught = new Set();    // recetas que te ha enseñado alguien
    this.known = new Set();     // recetas desbloqueadas
    this.fresh = new Set();     // desbloqueadas y aún sin mirar
    this.onNotice = null;       // la pantalla de fabricar, si está abierta, muestra los avisos ella misma
  }
  say(text, color) {
    if (this.game.mode === 'craft' && this.onNotice) this.onNotice(text);
    else this.game.gather.float(text, color);
  }

  reset(save) {
    // (las partidas guardadas mientras el reloj guardaba su día con el mismo nombre perdieron esta lista: se rehace
    // con lo que se tiene)
    this.seen = new Set(Array.isArray(save.seen) ? save.seen : this.owned());
    this.taught = new Set(save.taught || []);
    this.known = new Set();
    this.fresh = new Set();
    this.check(true);
  }
  toSave() { return { seen: [...this.seen], taught: [...this.taught] }; }
  // Lo que se tiene ahora: en la mochila, puesto, colocado en el mundo y en los cofres
  owned() {
    const g = this.game, out = new Set(), add = id => { if (ITEMS[id]) out.add(id); };
    for (const s of g.inv?.slots || []) if (s) add(s.id);
    for (const w of Object.values(g.inv?.equip || {})) if (w) add(w.id);
    for (const d of g.world?.deltas.values() || []) {
      for (const layer of ['placed', 'hang', 'rug']) for (const raw of Object.values(d[layer] || {})) add(parsePlaced(raw)[0]);
      for (const chest of Object.values(d.chest || {})) for (const s of chest || []) if (s) add(s.id);
    }
    return out;
  }

  // Mira la mochila por si hay objetos nuevos y avisa de las recetas que se desbloquean
  check(silent = false) {
    for (const s of this.game.inv.slots) if (s) this.seen.add(s.id);
    const news = RECIPES.filter(r => !this.known.has(r.id) && unlocked(r, this.seen, this.taught));
    for (const r of news) {
      this.known.add(r.id);
      if (!silent && !r.variant) this.fresh.add(r.id);   // (los otros tamaños de una alfombra no cuentan aparte)
    }
    const shown = news.filter(r => !r.variant);
    if (!silent && shown.length) {
      Audio.unlock();
      const name = ITEMS[shown[0].out].name;
      this.say(shown.length === 1 ? `¡Receta nueva: ${name}!` : `¡${shown.length} recetas nuevas! (C para fabricar)`, '#ffe08a');
    }
  }
  teach(id) {
    this.taught.add(id);
    this.check();
  }

  // Estaciones colocadas al alcance del jugador ({ banco: objeto, ... }); "mano" siempre está
  stationsNear() {
    const g = this.game, p = g.player, out = { mano: true };
    if (!p || p.inside) return out;
    for (const o of g.world.placedNear(p.x, p.y, STATION_REACH)) if (STATIONS[o.placed] && !out[o.placed]) out[o.placed] = o;
    return out;
  }

  // ¿Se puede fabricar ahora? Devuelve el motivo si no.
  problem(r) {
    const inv = this.game.inv;
    if (!this.known.has(r.id)) return 'Todavía no conoces esta receta';
    if (!this.stationsNear()[r.station]) return `Tienes que estar junto a: ${STATIONS[r.station].name.toLowerCase()}`;
    const missing = !inv.infinite && r.ins.find(([id, n]) => inv.count(id) < n);
    if (missing) return `Te falta ${ITEMS[missing[0]].name.toLowerCase()}`;
    if (inv.room(r.out) < r.n && !r.ins.some(([id, n]) => inv.count(id) === n)) return 'No te cabe: no llevas sitio libre';
    return null;
  }
  // Cuántas veces seguidas se podría fabricar con lo que hay
  times(r) {
    const inv = this.game.inv;
    if (inv.infinite) return 99;
    return Math.min(...r.ins.map(([id, n]) => Math.floor(inv.count(id) / n)));
  }

  // ---------- Reparar en el yunque ----------
  // Lo gastado que se lleva (en las casillas o puesto) y con qué se arregla: cada unidad del material le devuelve
  // una cuarta parte de lo que aguanta, como en el yunque de Minecraft. [{ where: casilla o hueco, it, mat }]
  repairable() {
    const inv = this.game.inv, out = [];
    inv.slots.forEach((it, i) => { if (worn(it)) out.push({ where: i, it, mat: repairMat(it.id) }); });
    for (const [slot, it] of Object.entries(inv.equip)) if (worn(it)) out.push({ where: slot, it, mat: repairMat(it.id) });
    return out.filter(r => r.mat);
  }
  repair(r) {
    const g = this.game, inv = g.inv, it = typeof r.where === 'number' ? inv.slots[r.where] : inv.equip[r.where], max = it && ITEMS[it.id].dur;
    if (!worn(it) || !this.stationsNear().yunque) return 'Tienes que estar junto al yunque';
    if (!inv.infinite && inv.count(r.mat) < 1) return `Te falta ${ITEMS[r.mat].name.toLowerCase()}`;
    inv.remove(r.mat, 1);
    it.dur = Math.min(max, (it.dur ?? max) + Math.ceil(max / 4));
    inv.changed();
    Audio.craft();
    this.say(`${ITEMS[it.id].name}: ${it.dur}/${max} usos`, '#fff3c0');
    return null;
  }

  craft(r, times = 1) {
    const g = this.game;
    let made = 0;
    for (let i = 0; i < times && !this.problem(r); i++) {
      for (const [id, n] of r.ins) g.inv.remove(id, n);
      const left = g.inv.add(r.out, r.n);
      if (left) g.gather.throwOut(r.out, left);
      made++;
    }
    if (made) {
      if (r.station === 'cocina') { g.skills?.gain('cocina', 3 * made); g.stats?.add('cocinados', made); }
      Audio.craft();
      this.say(`+${made * r.n} ${ITEMS[r.out].name}`, '#fff3c0');
    } else Audio.error();
    return made;
  }
}
