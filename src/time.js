// Tiempo: hora del día, días, estaciones y clima. También la luz de la noche (farolas, ventanas,
// antorchas), la lluvia, la nieve, la niebla y las tormentas.
import { mk, ihash } from './util.js';
import { SEASONS, seasonalProps } from './art/seasons.js';
import { ENERGY_MAX } from './items.js';
import { Audio } from './audio.js';
import { Settings } from './settings.js';
import { hud } from './ui/hud.js';

export const DAY_LEN = 1200;      // segundos reales que dura un día (20 minutos)
const START_HOUR = 7;             // la partida empieza a las 7 de la mañana
const HELD_LIGHT = { antorcha: 64, lampara: 76 };   // lo que alumbra llevándolo en la mano, y cuánto
export const SEASON_DAYS = 7;     // días que dura cada estación
const WEATHER = {
  sol: { name: 'Despejado', icon: '☀' },
  nubes: { name: 'Nublado', icon: '⛅' },
  lluvia: { name: 'Lluvia', icon: '🌧', rain: 1 },
  tormenta: { name: 'Tormenta', icon: '⛈', rain: 2 },
  niebla: { name: 'Niebla', icon: '🌫' },
  nieve: { name: 'Nieve', icon: '❄', snow: true },
};
// Probabilidades de cada tiempo por estación (lo que sobra es sol)
const CHANCES = [
  [['lluvia', 0.28], ['tormenta', 0.05], ['niebla', 0.08], ['nubes', 0.15]],
  [['lluvia', 0.1], ['tormenta', 0.12], ['niebla', 0.03], ['nubes', 0.1]],
  [['lluvia', 0.28], ['tormenta', 0.07], ['niebla', 0.2], ['nubes', 0.15]],
  [['nieve', 0.45], ['niebla', 0.15], ['nubes', 0.15]],
];
// Luces fijas del pueblo: la farola (las ventanas de las casas dan luz por sí mismas, como piezas que son)
const VILLAGE_LIGHTS = [{ x: 19.5, y: 20.5, z: 52, r: 64 }];

export class TimeSystem {
  constructor(game) {
    this.game = game;
    this.day = -1;
    this.weather = 'sol';
    this.light = mk(1, 1);
    this.drops = [];
    this.flash = 0;
    this.nextBolt = 5;
    this.shown = '';
  }
  get clock() { return this.game.world.clock; }
  get t() { return this.clock / DAY_LEN + START_HOUR / 24; }      // días transcurridos (con decimales)
  get dayIndex() { return Math.floor(this.t); }
  get hour() { return (this.t % 1) * 24; }
  get season() { return Math.floor(this.dayIndex / SEASON_DAYS) % 4; }
  get year() { return Math.floor(this.dayIndex / (SEASON_DAYS * 4)) + 1; }
  get dayOfSeason() { return (this.dayIndex % SEASON_DAYS) + 1; }
  get info() { return WEATHER[this.weather]; }
  get raining() { return !!this.info.rain && !this.game.indoors; }
  isNight() { const h = this.hour; return h >= 20 || h < 6; }
  label() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour % 1) * 60 / 10) * 10;
    return `${this.info.icon} ${SEASONS[this.season]}, día ${this.dayOfSeason} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  weatherFor(day) {
    if (day === 0) return 'sol';
    const season = Math.floor(day / SEASON_DAYS) % 4;
    let r = ihash(day, 77, this.game.world.seed);
    for (const [w, p] of CHANCES[season]) { if (r < p) return w; r -= p; }
    return 'sol';
  }

  reset() {
    this.day = -1;
    this.drops = [];
    this.shown = '';
    this.update(0);
  }

  // Cambia el aspecto del mundo según la estación (suelo y plantas)
  applySeason() {
    const g = this.game, w = g.world, s = this.season;
    if (w.gen.season === s && w.seasonApplied) return;
    w.seasonApplied = true;
    w.gen.season = s;
    const props = seasonalProps(g.props, s);
    w.gen.props = props;
    w.gen.cache.clear();
    w.rebuildVillage();
  }

  update(dt) {
    const g = this.game, d = this.dayIndex;
    if (d !== this.day) {
      const first = this.day < 0;
      this.day = d;
      this.weather = this.weatherFor(d);
      this.applySeason();
      if (!first) {
        g.hook('onDay', d);
        hud.toast(`${SEASONS[this.season]}, día ${this.dayOfSeason}${this.dayOfSeason === 1 ? ' · ¡Empieza ' + SEASONS[this.season].toLowerCase() + '!' : ''} · ${this.info.name}`);
      }
    }
    const label = this.label();
    if (label !== this.shown) { this.shown = label; document.getElementById('clock').textContent = label; }
    // Lluvia, nieve y rayos
    const w = this.info, outside = !g.indoors;
    Audio.rain(w.rain && outside ? w.rain : 0);
    Audio.quietBirds = this.isNight() || !!w.rain || !!w.snow;
    if (w.rain === 2 && outside) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.nextBolt = 7 + Math.random() * 10; this.flash = Settings.v.noFlash ? 0.15 : 1; Audio.thunder(); }
    }
    this.flash = Math.max(0, this.flash - dt * 2.5);
  }

  // Avanzar hasta las 6 de la mañana siguiente
  skipToMorning() {
    const t = this.t, morning = (t % 1) < 6 / 24 ? Math.floor(t) + 6 / 24 : Math.floor(t) + 1 + 6 / 24;
    this.game.world.clock = (morning - START_HOUR / 24) * DAY_LEN;
    this.update(0);
  }
  async sleep() {
    const g = this.game, h = this.hour;
    if (h >= 6 && h < 18) {
      const pick = await hud.ask(g.player.name, 'Todavía es de día. ¿Dormir hasta mañana?', ['Sí, hasta mañana', 'No, que hay cosas que hacer']);
      if (pick !== 0) return;
    }
    g.busy = true;
    g.player.stop();
    await hud.fade(true);
    this.skipToMorning();
    g.setEnergy(ENERGY_MAX);
    await new Promise(r => setTimeout(r, 700));
    await hud.fade(false);
    g.busy = false;
    g.gather.float('Buenos días. Energía al máximo', '#a8f0a0');
    g.onSave?.();
  }

  // Oscuridad (0 a 1) según la hora
  darkness() {
    const h = this.hour;
    let d = h < 4.5 ? 0.72 : h < 7 ? 0.72 * (1 - (h - 4.5) / 2.5) : h < 18 ? 0 : h < 21 ? 0.72 * ((h - 18) / 3) : 0.72;
    if (this.info.rain) d += 0.14 * this.info.rain;
    else if (this.weather === 'nubes' || this.weather === 'niebla') d += 0.06;
    return Math.min(0.85, d);
  }

  // Lluvia, nieve, niebla y la luz de la noche, por encima de todo
  drawOverlay(ctx, cam, view, scene, t) {
    const g = this.game, outside = scene === g.world, under = outside && g.underRoof;
    let dark = this.darkness();
    if (scene.dark !== undefined) dark = scene.dark;                 // cuevas y mazmorras
    else if (under) dark *= 0.5;                                     // dentro de casa se ve algo más
    if (outside && !under) this.drawWeather(ctx, view, t);
    if (dark > 0.02) this.drawLight(ctx, cam, view, scene, dark, t);
    if (this.flash > 0 && outside) { ctx.fillStyle = `rgba(255,255,240,${this.flash * 0.55})`; ctx.fillRect(0, 0, view.w, view.h); }
    // Atardecer: un toque cálido
    const h = this.hour;
    if (outside && h > 17 && h < 20.5) { ctx.fillStyle = `rgba(255,120,50,${0.1 * Math.sin(((h - 17) / 3.5) * Math.PI)})`; ctx.fillRect(0, 0, view.w, view.h); }
  }

  drawLight(ctx, cam, view, scene, dark, t) {
    const g = this.game, L = this.light;
    if (L.width !== view.w || L.height !== view.h) { L.width = view.w; L.height = view.h; }
    const lg = L.getContext('2d');
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, view.w, view.h);
    lg.fillStyle = `rgba(14,18,52,${dark})`;
    lg.fillRect(0, 0, view.w, view.h);
    lg.globalCompositeOperation = 'destination-out';
    const lights = this.lightsFor(scene, cam, view);
    const night = dark > 0.25;
    // El jugador solo da luz si lleva en la mano algo que alumbre (de noche y en las cuevas no hay otra)
    const held = HELD_LIGHT[g.inv?.held?.id];
    if (g.player && held) { const [px, py] = scene.P(g.player.x, g.player.y, 20); lights.push({ sx: px - cam.x, sy: py - cam.y, r: held }); }
    for (const l of lights) {
      const f = 1 + Math.sin(t * 7 + l.sx) * 0.04, r = l.r * f;
      const gr = lg.createRadialGradient(l.sx, l.sy, 0, l.sx, l.sy, r);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.5, 'rgba(0,0,0,.7)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      lg.fillStyle = gr;
      lg.fillRect(l.sx - r, l.sy - r, r * 2, r * 2);
    }
    // Dentro de una casa, la noche oscurece multiplicando: así lo de fuera (negro) sigue negro
    if (g.houseRegion) ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(L, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    // Brillo cálido alrededor de cada luz
    if (night) {
      ctx.globalCompositeOperation = 'lighter';
      for (const l of lights) {
        const r = l.r * 0.6, gr = ctx.createRadialGradient(l.sx, l.sy, 0, l.sx, l.sy, r);
        gr.addColorStop(0, `rgba(255,170,80,${0.18 * dark})`); gr.addColorStop(1, 'rgba(255,170,80,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(l.sx - r, l.sy - r, r * 2, r * 2);
        if (l.window) { ctx.fillStyle = `rgba(255,220,140,${0.5 * dark})`; ctx.fillRect(l.sx - 2, l.sy - 3, 5, 6); }
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // Luces que se ven en pantalla, en coordenadas de pantalla
  lightsFor(scene, cam, view) {
    const out = [], add = l => {
      const [sx, sy] = scene.P(l.x, l.y, l.z || 0), x = sx - cam.x, y = sy - cam.y;
      if (x > -l.r && y > -l.r && x < view.w + l.r && y < view.h + l.r) out.push({ sx: x, sy: y, r: l.r, window: l.window });
    };
    if (scene === this.game.world) {
      // Dentro de una casa solo cuentan sus luces y el candelabro del techo (fuera está todo negro, y las
      // ventanas por dentro no alumbran). Desde fuera, las luces de dentro de una casa con tejado no se ven
      // (las ventanas, siempre)
      const house = this.game.houseRegion, mine = l => house.has(`${Math.floor(l.x)},${Math.floor(l.y)}`) && !l.window;
      if (house && this.game.houseLamp) { const [x, y] = this.game.houseLamp; add({ x, y, z: 20, r: 210 }); }
      if (!house) for (const l of VILLAGE_LIGHTS) add(l);
      for (const ch of scene.visible) for (const l of scene.contentFor(ch.cx, ch.cy).lights) if (house ? mine(l) : l.window || !scene.roofAt(Math.floor(l.x), Math.floor(l.y))) add(l);
    } else if (scene.lights) for (const l of scene.lights()) add(l);
    for (const s of this.game.systems) { const more = s.lights?.(scene); if (more) for (const l of more) add(l); }
    return out;
  }

  drawWeather(ctx, view, t) {
    const w = this.info;
    if (w.rain || w.snow) {
      const want = w.rain === 2 ? 220 : w.rain ? 130 : 90;
      while (this.drops.length < want) this.drops.push({ x: Math.random() * view.w, y: Math.random() * view.h, v: 0.7 + Math.random() * 0.6 });
      this.drops.length = want;
      ctx.fillStyle = w.snow ? '#ffffff' : 'rgba(190,215,255,.55)';
      for (const d of this.drops) {
        if (w.snow) { d.y += d.v * 0.9; d.x += Math.sin(t * 2 + d.v * 9) * 0.4; ctx.fillRect(Math.round(d.x), Math.round(d.y), d.v > 1 ? 2 : 1, d.v > 1 ? 2 : 1); }
        else { d.y += d.v * 9; d.x -= d.v * 2.5; ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, 6); }
        if (d.y > view.h) { d.y = -8; d.x = Math.random() * (view.w + 60); }
        if (d.x < -10) d.x += view.w + 20;
      }
      if (w.rain) { ctx.fillStyle = 'rgba(40,60,90,.12)'; ctx.fillRect(0, 0, view.w, view.h); }
    }
    if (this.weather === 'niebla') {
      for (let i = 0; i < 6; i++) {
        const x = ((t * 6 + i * 173) % (view.w + 300)) - 150, y = (i * 97) % view.h, r = 120 + (i % 3) * 40;
        const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(230,236,240,.32)'); gr.addColorStop(1, 'rgba(230,236,240,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.fillStyle = 'rgba(220,228,232,.18)';
      ctx.fillRect(0, 0, view.w, view.h);
    }
  }
}
