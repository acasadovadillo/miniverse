// Fabricar: qué recetas conoce el jugador, qué estaciones tiene cerca y hacer las cosas.
import { ITEMS } from './items.js';
import { RECIPES, STATIONS, unlocked } from './recipes.js';
import { Audio } from './audio.js';
import { parsePlaced } from './pieces.js';

export const STATION_REACH = 2.4;   // a cuántas casillas puede estar una estación para usarla

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
