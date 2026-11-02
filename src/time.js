// Tiempo: hora del día, días, estaciones y clima. También la luz de la noche (farolas, ventanas,
// antorchas), la lluvia, la nieve, la niebla y las tormentas.
import { mk, ihash } from './util.js';
import { SEASONS } from './art/seasons.js';
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

  // Cambia el aspecto del mundo según la estación (la vista rehace el suelo y las plantas al verlo)
  applySeason() { this.game.world.gen.season = this.season; }

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

  // Poner una hora del día de hoy (en horas, con decimales: 18.5 son las 18:30), con el comando /time set
  setHour(hour) {
    this.game.world.clock = (this.dayIndex + hour / 24 - START_HOUR / 24) * DAY_LEN;
    this.update(0);
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
    const guest = g.live.guest;   // (en el mundo de otro, la hora la lleva su juego: se descansa, pero no pasa la noche)
    if (!guest) this.skipToMorning();
    g.setEnergy(ENERGY_MAX);
    await new Promise(r => setTimeout(r, 700));
    await hud.fade(false);
    g.busy = false;
    g.gather.float(guest ? 'Has descansado. Energía al máximo' : 'Buenos días. Energía al máximo', '#a8f0a0');
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




}
