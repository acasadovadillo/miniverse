// Pesca: con la caña en la mano, mirando al agua, se lanza el anzuelo. Al rato pica (el corcho se hunde)
// y hay que pulsar otra vez a tiempo. Lo que sale depende del agua (mar, río, lago…), la estación y la hora.
import { FISH, ITEMS } from './items.js';
import { B } from './world/biomes.js';
import { inBounds, pondDist } from './world/village.js';
import { Audio } from './audio.js';

const WATER_NAMES = { mar: 'el mar', rio: 'el río', lago: 'el lago', estanque: 'el estanque', pantano: 'el pantano', hielo: 'el hielo' };

export class Fishing {
  constructor(game) {
    this.game = game;
    this.state = null;   // { phase: 'wait' | 'bite', t, bx, by, px, py, water }
  }
  get world() { return this.game.world; }
  reset() { this.state = null; }

  // Tipo de agua en un punto (o null si es tierra)
  waterType(x, y) {
    const w = this.world;
    if (inBounds(x, y)) return pondDist(x, y) < 0.95 ? 'estanque' : null;
    if (!w.water(x, y)) return null;
    const b = w.gen.biomeAt(x, y);
    if (b === B.OCEAN) return 'mar';
    if (b === B.LAKE) return 'lago';
    if (b === B.ICE) return 'hielo';
    if (b === B.SWAMP) return 'pantano';
    for (let r = 2; r <= 8; r += 3) for (let a = 0; a < 6; a++) if (w.gen.biomeAt(x + Math.cos(a) * r, y + Math.sin(a) * r) === B.OCEAN) return 'mar';
    return 'rio';
  }
  spotAhead(p) {
    for (const r of [1.4, 2, 2.6]) {
      const x = p.x + p.face.x * r, y = p.y + p.face.y * r, water = this.waterType(x, y);
      if (water) return { x, y, water };
    }
    return null;
  }

  target(p, held, def) {
    if (def?.tool !== 'cana' || this.game.scene !== this.world) return null;
    const s = this.state;
    if (s) return { tile: null, ok: true, label: s.phase === 'bite' ? '¡Ahora!' : 'Esperando a que pique…', use: () => this.press() };
    const spot = this.spotAhead(p);
    return spot ? { tile: null, ok: true, label: `Pescar en ${WATER_NAMES[spot.water]}`, use: () => this.press() } : null;
  }

  press() {
    const g = this.game, p = g.player, s = this.state;
    g.gather.cooldown = 0.3;
    if (!s) {
      const spot = this.spotAhead(p);
      if (!spot || !g.gather.spend('cana')) return;
      this.state = { phase: 'wait', t: 1.5 + Math.random() * 4.5, bx: spot.x, by: spot.y, px: p.x, py: p.y, water: spot.water };
      Audio.swish();
      return;
    }
    if (s.phase === 'bite') this.catch();
    else { g.gather.float('Has recogido el sedal demasiado pronto', '#ffb0a0'); this.state = null; Audio.swish(); }
  }

  pick(water) {
    const T = this.game.days, h = T.hour, season = T.season;
    const okHour = f => !f.hours || (f.hours[0] < f.hours[1] ? h >= f.hours[0] && h < f.hours[1] : h >= f.hours[0] || h < f.hours[1]);
    const list = Object.entries(FISH).filter(([, f]) => f.water.includes(water) && (!f.seasons || f.seasons.includes(season)) && okHour(f));
    const rare = list.filter(([, f]) => f.rare), common = list.filter(([, f]) => !f.rare);
    if (rare.length && Math.random() < 0.04 + (this.game.skills?.bonus('pesca') || 0) * 0.1) return rare[0][0];
    return common.length ? common[Math.floor(Math.random() * common.length)][0] : 'carpa';
  }
  catch() {
    const g = this.game, s = this.state, id = this.pick(s.water);
    this.state = null;
    g.gather.drops.push({ id, x: g.player.x + (Math.random() - 0.5) * 0.3, y: g.player.y + 0.2, z: 14, vz: 70, t: 0.2, scene: g.scene });
    g.gather.float(`¡${ITEMS[id].name}!`, '#9ad0ff');
    Audio.unlock();
    g.skills?.gain('pesca', 3);
    g.stats?.add('peces', 1);
    g.collection?.found(id);
  }

  update(dt) {
    const s = this.state, g = this.game, p = g.player;
    if (!s) return;
    if (Math.hypot(p.x - s.px, p.y - s.py) > 0.4 || g.inv.held?.id !== 'cana') { this.state = null; return; }
    s.t -= dt;
    if (s.phase === 'wait' && s.t <= 0) { s.phase = 'bite'; s.t = 0.9; Audio.noiseHit(700, 0.2, 0.3); Audio.blip(); }
    else if (s.phase === 'bite' && s.t <= 0) { g.gather.float('Se ha escapado…', '#ffb0a0'); this.state = null; }
  }

}
