// Pesca: con la caña en la mano y mirando al agua, un clic lanza. El corcho tiembla alguna vez sin que sea nada; cuando
// pica de verdad se hunde y, con otro clic a tiempo (o la barra espaciadora), sale el pez, con su talla y a veces un
// tesoro. Si se pulsa antes, se recoge el sedal; si se tarda, se escapa.
// Lo que sale depende del agua (mar, río, lago…), la estación, la hora y el tiempo.
import { FISH, ITEMS } from './items.js';
import { B } from './world/biomes.js';
import { inBounds, pondDist } from './world/village.js';
import { Audio } from './audio.js';

const WATER_NAMES = { mar: 'el mar', rio: 'el río', lago: 'el lago', estanque: 'el estanque', pantano: 'el pantano', hielo: 'el hielo' };
const SEASON_NAMES = ['primavera', 'verano', 'otoño', 'invierno'];
const LABELS = { wait: 'Esperando a que pique…', bite: '¡Ahora!' };
const MIN_CAST = 1.4, MAX_CAST = 5;   // casillas: hasta dónde llega la caña
// Lo que puede salir en un tesoro (y cuántos), además de unas monedas
const TREASURE = [['moneda_antigua', 1], ['cuerda', 3], ['lingote_cobre', 2], ['lingote_hierro', 1], ['amatista', 1], ['esmeralda', 1], ['fosil_concha', 1], ['fosil_ambar', 1], ['pocion', 1], ['semilla_manzano', 1], ['abono', 4]];

export class Fishing {
  constructor(game) {
    this.game = game;
    this.state = null;     // { phase: 'wait' | 'bite', t, bx, by, px, py, water, nib, fly }
    this.records = {};     // la talla más grande de cada pez (cm)
  }
  get world() { return this.game.world; }
  reset(save) { this.state = null; this.records = save?.fishRecords || {}; }
  save(out) { out.fishRecords = this.records; }

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
  // El primer punto con agua delante del jugador, entre dos distancias (por defecto, todo lo que llega la caña)
  spotAhead(p, from = MIN_CAST, to = MAX_CAST) {
    const step = from < to ? 0.3 : -0.2;
    for (let r = from; step > 0 ? r <= to : r >= to; r += step) {
      const x = p.x + p.face.x * r, y = p.y + p.face.y * r, water = this.waterType(x, y);
      if (water) return { x, y, water, r };
    }
    return null;
  }

  target(p, held, def) {
    if (def?.tool !== 'cana' || this.game.scene !== this.world) return null;
    const s = this.state;
    if (s) return { tile: null, ok: true, label: LABELS[s.phase], use: () => this.press() };
    const spot = this.spotAhead(p);
    return spot ? { tile: null, ok: true, label: `Pescar en ${WATER_NAMES[spot.water]}`, use: () => this.press() } : null;
  }

  // Al pulsar: lanzar, sacar el sedal antes de tiempo o sacar el pez cuando pica
  press() {
    const g = this.game, s = this.state;
    g.gather.cooldown = 0.3;
    if (!s) return this.cast();
    if (s.phase === 'bite') this.land();
    else if (s.phase === 'wait') { g.gather.float('Has recogido el sedal demasiado pronto', '#ffb0a0'); this.state = null; Audio.swish(); }
  }
  // La barra espaciadora también saca el pez
  space() {
    if (this.state?.phase !== 'bite') return false;
    this.land();
    return true;
  }

  // Lanzar: cae en el agua más cercana que haya delante
  cast() {
    const g = this.game, p = g.player, held = g.inv.held, spot = this.spotAhead(p);
    if (!spot || !g.gather.spend('cana')) return;
    g.gather.swing = 0.25; g.gather.swingItem = held.id;
    Audio.swish();
    const tier = ITEMS[held.id].tier || 1, rain = g.days.info.rain ? 0.85 : 1;
    this.state = { phase: 'wait', t: (2 + Math.random() * 5) * (tier > 1 ? 0.7 : 1) * rain, nib: 0, fly: 0, bx: spot.x, by: spot.y, px: p.x, py: p.y, water: spot.water };
  }

  pick(water) {
    const g = this.game, T = g.days, h = T.hour, season = T.season;
    const okHour = f => !f.hours || (f.hours[0] < f.hours[1] ? h >= f.hours[0] && h < f.hours[1] : h >= f.hours[0] || h < f.hours[1]);
    const okWeather = f => !f.weather || (f.weather === 'lluvia' ? !!T.info.rain : T.weather === f.weather);
    const list = Object.entries(FISH).filter(([, f]) => f.water.includes(water) && (!f.seasons || f.seasons.includes(season)) && okHour(f) && okWeather(f));
    const rare = list.filter(([, f]) => f.rare), common = list.filter(([, f]) => !f.rare);
    if (rare.length && Math.random() < 0.04 + (g.skills?.bonus('pesca') || 0) * 0.1) return rare[0][0];
    if (!common.length) return 'carpa';
    // Los más difíciles salen algo menos
    const weight = ([, f]) => 1.2 - f.dif * 0.7;
    let r = Math.random() * common.reduce((t, e) => t + weight(e), 0);
    for (const e of common) if ((r -= weight(e)) <= 0) return e[0];
    return common[0][0];
  }

  // ¡Fuera! El pez salta hacia el jugador, con su talla (y, a veces, un tesoro)
  land() {
    const g = this.game, s = this.state, id = this.pick(s.water), f = FISH[id], lvl = g.skills?.level('pesca') || 0;
    this.state = null;
    g.gather.cooldown = 0.3;
    const cm = Math.round(f.cm[0] + (f.cm[1] - f.cm[0]) * Math.random() ** 1.6), best = this.records[id] || 0;
    if (cm > best) this.records[id] = cm;
    this.jump(id);
    g.gather.float(`¡${ITEMS[id].name}! ${cm} cm`, '#9ad0ff');
    if (best && cm > best) g.gather.float('¡Nuevo récord!', '#a8f07a');
    if (Math.random() < 0.12 + lvl * 0.012) this.treasure();
    Audio.splash(); Audio.unlock();
    g.gather.chips(s.bx, s.by, 'water', 14);
    g.skills?.gain('pesca', Math.round(3 + f.dif * 9));
    g.stats?.add('peces', 1);
    g.xp?.add(1 + Math.floor(Math.random() * 6));   // (como en Minecraft, de 1 a 6 de experiencia)
    g.collection?.found(id);
  }
  treasure() {
    const g = this.game, lvl = g.skills?.level('pesca') || 0, got = [];
    for (let i = Math.random() < 0.35 + lvl * 0.03 ? 2 : 1; i > 0; i--) {
      const [id, n] = TREASURE[Math.floor(Math.random() * TREASURE.length)];
      got.push(`${n > 1 ? n + ' × ' : ''}${ITEMS[id].name.toLowerCase()}`);
      for (let j = 0; j < n; j++) this.jump(id);
    }
    const coins = 20 + Math.floor(Math.random() * 60) + lvl * 10;
    g.addMoney(coins);
    g.gather.float(`Tesoro: ${got.join(', ')} y ${coins} monedas`, '#ffd77a');
    g.stats?.add('tesoros', 1);
  }
  // Algo que sale del agua de un salto y cae junto al jugador (luego va solo a la mochila)
  jump(id) {
    const g = this.game;
    g.gather.drops.push({ id, x: g.player.x + (Math.random() - 0.5) * 0.4, y: g.player.y + 0.2, z: 14, vz: 70 + Math.random() * 20, t: 0.2, scene: g.scene });
  }
  lose(text) {
    if (text) { this.game.gather.float(text, '#ffb0a0'); Audio.error(); }
    this.state = null;
  }

  update(dt) {
    const s = this.state, g = this.game, p = g.player;
    if (!s) return;
    // Cambiar de objeto o de escena suelta la caña; andar recoge el sedal
    if (ITEMS[g.inv.held?.id]?.tool !== 'cana' || g.scene !== this.world) return this.lose(null);
    if (Math.hypot(p.x - s.px, p.y - s.py) > 0.4) { this.state = null; return; }
    if (g.busy) return;   // (con un diálogo o una escena en marcha, el pez espera)
    if (s.fly < 1) {   // el corcho vuela hasta el agua
      s.fly = Math.min(1, s.fly + dt / 0.4);
      if (s.fly === 1) { Audio.plop(); g.gather.chips(s.bx, s.by, 'water', 5); }
    }
    s.t -= dt;
    if (s.phase === 'wait') {
      // Alguna picada de mentira: el corcho tiembla, pero aún no es nada
      if (s.nib > 0) s.nib -= dt;
      else if (s.fly === 1 && s.t > 1 && Math.random() < dt * 0.45) { s.nib = 0.3; Audio.nibble(); }
      if (s.t <= 0) {
        const tier = ITEMS[g.inv.held.id].tier || 1;
        s.phase = 'bite'; s.t = 0.9 + (tier - 1) * 0.2;
        Audio.noiseHit(700, 0.2, 0.3); Audio.blip();
        g.gather.float('¡Pica!', '#ffe08a');
      }
    } else if (s.phase === 'bite' && s.t <= 0) this.lose('Se ha escapado…');
  }

  // Cómo se pone el jugador: con la caña echada
  pose() { return this.state?.fly === 1 ? { arm: -0.35, lean: 0 } : null; }

  // El cuaderno de pesca (en el diario): cada pez con dónde y cuándo sale y la talla más grande pescada
  journal() {
    const g = this.game, ids = Object.keys(FISH), known = id => g.collection.seen.has(id) || !!this.records[id];
    const where = f => f.water.map(w => WATER_NAMES[w]).join(', ').replace(/, ([^,]*)$/, ' o $1');
    const when = f => [
      f.seasons ? 'en ' + f.seasons.map(i => SEASON_NAMES[i]).join(' y ') : 'todo el año',
      f.hours ? `de ${f.hours[0]}:00 a ${f.hours[1]}:00` : '',
      f.weather ? 'con lluvia' : '',
    ].filter(Boolean).join(' · ');
    const n = ids.filter(known).length, count = (k, one, many) => `${g.stats.get(k)} ${g.stats.get(k) === 1 ? one : many}`;
    return `<p class="j-note">Has pescado ${n} de ${ids.length} especies · ${count('peces', 'pez', 'peces')} y ${count('tesoros', 'tesoro', 'tesoros')}.</p>` + ids.map(id => {
      const f = FISH[id], k = known(id), rec = this.records[id];
      return `<div class="j-fish"><span class="j-cell ${k ? 'done' : 'none'}"><img alt="" data-icon="${id}"></span>` +
        `<span><b>${k ? f.name : '???'}</b><small>${k ? `En ${where(f)} · ${when(f)}` : `Se pesca en ${where(f)}`}</small></span>` +
        `<span class="lvl">${rec ? rec + ' cm' : ''}</span></div>`;
    }).join('');
  }
}
