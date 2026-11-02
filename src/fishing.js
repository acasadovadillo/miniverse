// Pesca: con la caña en la mano y mirando al agua, se mantiene pulsado para coger fuerza y se suelta para
// lanzar (más lejos: peces algo más grandes y raros). El corcho tiembla alguna vez sin que sea nada; cuando
// pica de verdad se hunde y hay que pulsar a tiempo. Entonces empieza la pelea: el pez sube y baja por una
// columna de agua y hay que tenerlo dentro de la red, que sube mientras se mantiene pulsado (clic, el botón
// de usar o la barra espaciadora) y baja al soltar. Con el pez dentro se llena la barra; fuera, se vacía.
// A veces aparece un tesoro, que se coge igual: con la red encima un rato, antes de sacar el pez.
// Lo que sale depende del agua (mar, río, lago…), la estación, la hora y el tiempo.
import { FISH, ITEMS } from './items.js';
import { B } from './world/biomes.js';
import { inBounds, pondDist } from './world/village.js';
import { Audio } from './audio.js';
import { keys } from './input.js';

const WATER_NAMES = { mar: 'el mar', rio: 'el río', lago: 'el lago', estanque: 'el estanque', pantano: 'el pantano', hielo: 'el hielo' };
const SEASON_NAMES = ['primavera', 'verano', 'otoño', 'invierno'];
const LABELS = { charge: 'Suelta para lanzar', wait: 'Esperando a que pique…', bite: '¡Ahora!', reel: 'Mantén pulsado para subir la red' };
const MIN_CAST = 1.4, MAX_CAST = 5;   // casillas: lanzando sin fuerza y con toda
// Cómo pelea cada tipo de pez: cada cuánto cambia de altura (segundos), cuánto salta, hacia dónde tira
// (0 el fondo, 1 la superficie) y, los nerviosos, la probabilidad de dar un tirón de golpe
const MOVES = {
  calmo: { every: [1.2, 2.4], jump: 0.4, bias: 0.5 },
  mixto: { every: [0.6, 1.6], jump: 0.6, bias: 0.5 },
  nervioso: { every: [0.45, 1.3], jump: 0.6, bias: 0.5, dart: 0.3 },
  fondo: { every: [0.6, 1.6], jump: 0.75, bias: 0.2 },
  flota: { every: [0.6, 1.6], jump: 0.75, bias: 0.8 },
};
// Lo que puede salir en un tesoro (y cuántos), además de unas monedas
const TREASURE = [['moneda_antigua', 1], ['cuerda', 3], ['lingote_cobre', 2], ['lingote_hierro', 1], ['amatista', 1], ['esmeralda', 1], ['fosil_concha', 1], ['fosil_ambar', 1], ['pocion', 1], ['semilla_manzano', 1], ['abono', 4]];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const holding = () => keys.use || keys.space;

export class Fishing {
  constructor(game) {
    this.game = game;
    this.state = null;     // { phase: 'charge' | 'wait' | 'bite' | 'reel', t, bx, by, px, py, water, power, r (la pelea) }
    this.records = {};     // la talla más grande de cada pez (cm)
  }
  get world() { return this.game.world; }
  reset(save) { this.state = null; this.records = save?.fishRecords || {}; }
  save(out) { out.fishRecords = this.records; }
  // Cogiendo fuerza o peleando con un pez no se anda
  get still() { const p = this.state?.phase; return p === 'charge' || p === 'reel'; }

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
    if (s) return { tile: null, ok: true, still: this.still, label: LABELS[s.phase], use: () => this.press() };
    const spot = this.spotAhead(p);
    return spot ? { tile: null, ok: true, label: `Pescar en ${WATER_NAMES[spot.water]}`, use: () => this.press() } : null;
  }

  // Al pulsar: empezar a coger fuerza, sacar el sedal antes de tiempo o clavar el anzuelo cuando pica
  press() {
    const g = this.game, p = g.player, s = this.state;
    g.gather.cooldown = 0.3;
    if (!s) {
      if (!this.spotAhead(p)) return;
      this.state = { phase: 'charge', t: 0, power: 0, px: p.x, py: p.y };
      return;
    }
    if (s.phase === 'bite') this.hook();
    else if (s.phase === 'wait') { g.gather.float('Has recogido el sedal demasiado pronto', '#ffb0a0'); this.state = null; Audio.swish(); }
  }
  // La barra espaciadora también clava el anzuelo (y, mantenida, sube la red)
  space() {
    if (this.state?.phase !== 'bite') return false;
    this.hook();
    return true;
  }

  // Al soltar: se lanza tan lejos como diga la fuerza. Si ahí hay tierra, cae en el agua que haya antes
  cast() {
    const g = this.game, p = g.player, s = this.state, held = g.inv.held;
    const spot = this.spotAhead(p, MIN_CAST + s.power * (MAX_CAST - MIN_CAST), MIN_CAST);
    g.gather.swing = 0.25; g.gather.swingItem = held.id;
    Audio.swish();
    if (!spot) { this.state = null; g.gather.float('Ahí no hay agua', '#ffb0a0'); return; }
    if (!g.gather.spend('cana')) { this.state = null; return; }
    const tier = ITEMS[held.id].tier || 1, rain = g.days.info.rain ? 0.85 : 1;
    this.state = {
      phase: 'wait', t: (2 + Math.random() * 5) * (tier > 1 ? 0.7 : 1) * rain, nib: 0, fly: 0,
      bx: spot.x, by: spot.y, px: p.x, py: p.y, water: spot.water, power: (spot.r - MIN_CAST) / (MAX_CAST - MIN_CAST),
    };
  }

  pick(water, power = 0) {
    const g = this.game, T = g.days, h = T.hour, season = T.season;
    const okHour = f => !f.hours || (f.hours[0] < f.hours[1] ? h >= f.hours[0] && h < f.hours[1] : h >= f.hours[0] || h < f.hours[1]);
    const okWeather = f => !f.weather || (f.weather === 'lluvia' ? !!T.info.rain : T.weather === f.weather);
    const list = Object.entries(FISH).filter(([, f]) => f.water.includes(water) && (!f.seasons || f.seasons.includes(season)) && okHour(f) && okWeather(f));
    const rare = list.filter(([, f]) => f.rare), common = list.filter(([, f]) => !f.rare);
    if (rare.length && Math.random() < 0.04 + (g.skills?.bonus('pesca') || 0) * 0.1 + power * 0.02) return rare[0][0];
    if (!common.length) return 'carpa';
    // Los que pelean más salen algo menos
    const weight = ([, f]) => 1.2 - f.dif * 0.7;
    let r = Math.random() * common.reduce((t, e) => t + weight(e), 0);
    for (const e of common) if ((r -= weight(e)) <= 0) return e[0];
    return common[0][0];
  }

  // Ha picado y se ha clavado: empieza la pelea. La red es más alta con más nivel de pesca y mejor caña
  hook() {
    const g = this.game, s = this.state, lvl = g.skills?.level('pesca') || 0, tier = ITEMS[g.inv.held.id].tier || 1;
    const fish = this.pick(s.water, s.power), h = Math.min(0.42, 0.22 + lvl * 0.012 + (tier - 1) * 0.06), fy = 0.3 + Math.random() * 0.4;
    s.phase = 'reel';
    s.fish = fish;
    s.r = {
      h, y: clamp(fy - h / 2, 0, 1 - h), v: 0,          // la red: dónde empieza (desde el fondo), su alto y su velocidad
      fy, fv: 0, to: fy, next: 0.5,                     // el pez: altura, velocidad, adónde va y cuándo cambia
      prog: 0.3, clean: true, inside: true, t: 0, tick: 0,
      chest: Math.random() < 0.12 + lvl * 0.012 ? { at: 1 + Math.random() * 3, y: 0, got: 0, on: false, done: false } : null,
    };
    g.gather.cooldown = 0.3;
    Audio.splash();
    g.gather.chips(s.bx, s.by, 'water', 12);
  }

  reel(dt) {
    const s = this.state, r = s.r, f = FISH[s.fish], m = MOVES[f.mov] || MOVES.mixto, d = f.dif;
    r.t += dt;
    // El pez: cada poco elige otra altura (más a menudo y más lejos cuanto más difícil) y va hacia ella como un muelle
    if ((r.next -= dt) <= 0) {
      const [a, b] = m.every;
      r.next = (a + Math.random() * (b - a)) * (1.2 - d * 0.75);
      const to = r.fy + (Math.random() - 0.5) * 2 * m.jump * (0.45 + d * 0.95);
      r.to = clamp(to + (m.bias - to) * 0.25, 0.04, 0.96);
      if (m.dart && Math.random() < m.dart * d) r.fv += (r.to - r.fy) * 5;   // un tirón de golpe
    }
    const k = 8 + d * 60;
    r.fv += ((r.to - r.fy) * k - r.fv * Math.sqrt(k) * 1.5) * dt;
    r.fy = clamp(r.fy + r.fv * dt + Math.sin(r.t * 9) * 0.004 * d, 0.03, 0.97);
    if (r.fy <= 0.03 || r.fy >= 0.97) r.fv = 0;
    // La red: sube mientras se mantiene pulsado, cae al soltar y rebota un poco en el fondo
    const up = holding();
    r.v = clamp(r.v + (up ? 3.1 : -2.5) * dt, -1.4, 1.4);
    r.y += r.v * dt;
    if (r.y < 0) { r.y = 0; r.v = r.v < -0.4 ? -r.v * 0.3 : 0; }
    if (r.y > 1 - r.h) { r.y = 1 - r.h; r.v = Math.min(0, -r.v * 0.2); }
    if (up && (r.tick -= dt) <= 0) { r.tick = 0.075; Audio.reel(); }
    // Con el pez dentro de la red, la barra sube; fuera, baja (más deprisa los peces difíciles)
    r.inside = r.fy >= r.y - 0.015 && r.fy <= r.y + r.h + 0.015;
    if (r.inside) r.prog += dt * 0.3;
    else { r.prog -= dt * (0.15 + d * 0.22); if (r.t > 0.3) r.clean = false; }
    // El tesoro: aparece al rato y se coge teniéndolo un poco dentro de la red
    const c = r.chest;
    if (c && !c.on && !c.done && r.t >= c.at) { c.on = true; c.y = r.fy > 0.5 ? 0.12 + Math.random() * 0.25 : 0.63 + Math.random() * 0.25; Audio.blip(); }
    if (c?.on) {
      c.got = c.got + (c.y >= r.y && c.y <= r.y + r.h ? dt * 0.6 : -dt * 0.25);
      c.got = Math.max(0, c.got);
      if (c.got >= 1) { c.on = false; c.done = true; Audio.pickup(); }
    }
    if (r.prog >= 1) this.land();
    else if (r.prog <= 0) this.lose('Se ha escapado…');
  }

  // ¡Fuera! El pez salta hacia el jugador, con su talla (y el tesoro, si se cogió)
  land() {
    const g = this.game, s = this.state, r = s.r, id = s.fish, f = FISH[id];
    this.state = null;
    const k = Math.min(1, Math.random() ** 1.6 + s.power * 0.15 + (r.clean ? 0.1 : 0));
    const cm = Math.round(f.cm[0] + (f.cm[1] - f.cm[0]) * k), best = this.records[id] || 0;
    if (cm > best) this.records[id] = cm;
    this.jump(id);
    g.gather.float(`¡${ITEMS[id].name}! ${cm} cm`, '#9ad0ff');
    if (best && cm > best) g.gather.float('¡Nuevo récord!', '#a8f07a');
    if (r.clean) { g.gather.float('¡Perfecto!', '#ffe08a'); g.stats?.add('perfectos', 1); }
    if (r.chest?.done) this.treasure();
    Audio.unlock();
    g.gather.chips(s.bx, s.by, 'water', 14);
    g.skills?.gain('pesca', Math.round((3 + f.dif * 9) * (r.clean ? 1.5 : 1)));
    g.stats?.add('peces', 1);
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
    // Cambiar de objeto o de escena suelta la caña; andar recoge el sedal (peleando no se anda)
    if (ITEMS[g.inv.held?.id]?.tool !== 'cana' || g.scene !== this.world) return this.lose(s.phase === 'reel' ? 'Se ha escapado…' : null);
    if (!this.still && Math.hypot(p.x - s.px, p.y - s.py) > 0.4) { this.state = null; return; }
    if (g.busy) return;   // (con un diálogo o una escena en marcha, el pez espera)
    if (s.fly < 1) {   // el corcho vuela hasta el agua
      s.fly = Math.min(1, s.fly + dt / 0.4);
      if (s.fly === 1) { Audio.plop(); g.gather.chips(s.bx, s.by, 'water', 5); }
    }
    if (s.phase === 'charge') {
      // La fuerza sube y baja mientras se mantiene pulsado
      s.t += dt;
      s.power = 1 - Math.abs(((s.t * 1.1) % 2) - 1);
      if (!holding()) this.cast();
      return;
    }
    if (s.phase === 'reel') return this.reel(dt);
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

  // Cómo se pone el jugador: el brazo atrás cogiendo fuerza, y la caña tirante peleando
  pose(t) {
    const s = this.state;
    if (!s) return null;
    if (s.phase === 'charge') return { arm: -1.4 - s.power * 1.2, lean: -0.06 };
    if (s.phase === 'reel') return { arm: -0.9 + Math.sin(t * 22) * (holding() ? 0.06 : 0.02), lean: -0.14 };
    return s.fly === 1 ? { arm: -0.35, lean: 0 } : null;
  }

  // El cuaderno de pesca (en el diario): cada pez con dónde y cuándo sale y la talla más grande pescada
  journal() {
    const g = this.game, ids = Object.keys(FISH), known = id => g.collection.seen.has(id) || !!this.records[id];
    const where = f => f.water.map(w => WATER_NAMES[w]).join(', ').replace(/, ([^,]*)$/, ' o $1');
    const when = f => [
      f.seasons ? 'en ' + f.seasons.map(i => SEASON_NAMES[i]).join(' y ') : 'todo el año',
      f.hours ? `de ${f.hours[0]}:00 a ${f.hours[1]}:00` : '',
      f.weather ? 'con lluvia' : '',
      ['fácil', 'normal', 'difícil', 'muy difícil'][f.dif < 0.3 ? 0 : f.dif < 0.55 ? 1 : f.dif < 0.75 ? 2 : 3],
    ].filter(Boolean).join(' · ');
    const n = ids.filter(known).length, count = (k, one, many) => `${g.stats.get(k)} ${g.stats.get(k) === 1 ? one : many}`;
    return `<p class="j-note">Has pescado ${n} de ${ids.length} especies · ${count('peces', 'pez', 'peces')}, ${count('perfectos', 'perfecto', 'perfectos')} y ${count('tesoros', 'tesoro', 'tesoros')}. Lanzando lejos y con capturas perfectas salen peces más grandes.</p>` + ids.map(id => {
      const f = FISH[id], k = known(id), rec = this.records[id];
      return `<div class="j-fish"><span class="j-cell ${k ? 'done' : 'none'}"><img alt="" data-icon="${id}"></span>` +
        `<span><b>${k ? f.name : '???'}</b><small>${k ? `En ${where(f)} · ${when(f)}` : `Se pesca en ${where(f)}`}</small></span>` +
        `<span class="lvl">${rec ? rec + ' cm' : ''}</span></div>`;
    }).join('');
  }
}
