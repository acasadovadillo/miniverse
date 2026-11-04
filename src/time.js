// Tiempo: hora del día, días, estaciones y clima. También la luz de la noche (farolas, ventanas,
// antorchas), la lluvia, la nieve, la niebla y las tormentas.
// La hora es la de Madrid (con el cambio de hora de verano e invierno) y la estación, la del calendario: si se
// juega de noche, en el juego es de noche. El admin puede adelantarla o atrasarla (/time set) y volver a la de
// Madrid (/time reset). Los días cuentan desde que empezó la partida; los que pasan sin jugar se viven al volver.
import { mk, ihash } from './util.js';
import { SEASONS } from './art/seasons.js';
import { Audio } from './audio.js';
import { Settings } from './settings.js';
import { hud } from './ui/hud.js';
import { lonOf, latOf } from './world/planet.js';

const SLEEP_FED = 14;             // medios muslos de hambre con los que se levanta uno de dormir (si tenía menos)
// (antes, un día duraba 20 minutos y empezaba a las 7: con eso se sabe en qué día iban las partidas de entonces)
const OLD_DAY_LEN = 1200, OLD_START_HOUR = 7;
const HELD_LIGHT = { antorcha: 64, lampara: 76 };   // lo que alumbra llevándolo en la mano, y cuánto
const DAY_MS = 864e5, HOUR_MS = 36e5;
const CATCH_UP = 7;               // días sin jugar que se viven al volver, como mucho
// Cuándo empieza cada estación (mes, día): primavera el 20 de marzo, verano el 21 de junio, otoño el 22 de
// septiembre e invierno el 21 de diciembre
const SEASON_START = [[2, 20], [5, 21], [8, 22], [11, 21]];
const WEATHER = {
  sol: { name: 'Despejado', icon: '☀' },
  nubes: { name: 'Nublado', icon: '⛅' },
  lluvia: { name: 'Lluvia', icon: '🌧', rain: 1 },
  tormenta: { name: 'Tormenta', icon: '⛈', rain: 2 },
  niebla: { name: 'Niebla', icon: '🌫' },
  nieve: { name: 'Nieve', icon: '❄', snow: true },
  ventisca: { name: 'Ventisca', icon: '🌨', snow: true, fog: true },   // (cerca de los polos, siempre)
};
const POLAR = 86;   // a partir de esta latitud, ventisca
// Probabilidades de cada tiempo por estación (lo que sobra es sol)
const CHANCES = [
  [['lluvia', 0.28], ['tormenta', 0.05], ['niebla', 0.08], ['nubes', 0.15]],
  [['lluvia', 0.1], ['tormenta', 0.12], ['niebla', 0.03], ['nubes', 0.1]],
  [['lluvia', 0.28], ['tormenta', 0.07], ['niebla', 0.2], ['nubes', 0.15]],
  [['nieve', 0.45], ['niebla', 0.15], ['nubes', 0.15]],
];
// Luces fijas del pueblo: la farola (las ventanas de las casas dan luz por sí mismas, como piezas que son)
const VILLAGE_LIGHTS = [{ x: 19.5, y: 20.5, z: 52, r: 64 }];

// La hora de Madrid, en milisegundos como si fuera UTC (así el día y la hora salen con divisiones). La
// diferencia con UTC se vuelve a mirar cada minuto, por el cambio de hora.
const MADRID = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
let zone = { at: -Infinity, off: 0 };
export function madridMs(now = Date.now()) {
  if (Math.abs(now - zone.at) > 60000) {
    const p = Object.fromEntries(MADRID.formatToParts(now).map(x => [x.type, +x.value]));
    zone = { at: now, off: Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(now / 1000) * 1000 };
  }
  return now + zone.off;
}
// La estación de un día (días desde el 1 de enero de 1970) y el día en que empezó
function seasonOf(day) {
  const y = new Date(day * DAY_MS).getUTCFullYear();
  let best = null;
  for (const yy of [y - 1, y]) SEASON_START.forEach(([m, d], season) => { const start = Date.UTC(yy, m, d) / DAY_MS; if (start <= day && (!best || start > best.start)) best = { season, start }; });
  return best;
}

export const WEATHERS = Object.keys(WEATHER);   // (para /weather)
export class TimeSystem {
  constructor(game) {
    this.game = game;
    this.day = -1;          // el último día (de los de verdad) que ya ha amanecido en la partida
    this.wday = -1;         // el día del tiempo que hace ahora
    this.dayBase = 0;       // el día de verdad en que empezó la partida (su día 0)
    this.shift = 0;         // horas que el admin ha adelantado (o atrasado) el reloj
    this.weather = 'sol';
    this.light = mk(1, 1);
    this.drops = [];
    this.flash = 0;
    this.nextBolt = 5;
    this.shown = '';
  }
  // Jugando en el mundo de otro, su día 0 y su reloj (los manda su juego con la hora)
  get remote() { return this.game.live?.guest ? this.game.live.clockBase : null; }
  get base() { return this.remote?.db ?? this.dayBase; }
  get now() { return madridMs() + (this.remote?.sh ?? this.shift) * HOUR_MS; }
  get realDay() { return Math.floor(this.now / DAY_MS); }
  get dayIndex() { return this.realDay - this.base; }              // días desde que empezó la partida
  get hour() { return (this.now % DAY_MS) / HOUR_MS; }
  // En el planeta, cada longitud tiene su hora (la del pueblo es la de Madrid: una hora más por cada 15° al este) y
  // en el hemisferio sur las estaciones van al revés. «Aquí» es donde está el jugador
  hourAt(x) { return (((this.hour + lonOf(x) / 15) % 24) + 24) % 24; }
  get here() { const p = this.game.player; return p && this.game.scene === this.game.world ? p : { x: 0, y: 30 }; }
  get localHour() { return this.hourAt(this.here.x); }
  get localSeason() { return latOf(this.here.y) < 0 ? (this.season + 2) % 4 : this.season; }
  get weatherHere() { return Math.abs(latOf(this.here.y)) > POLAR ? 'ventisca' : this.weather; }
  get t() { return this.dayIndex + this.hour / 24; }                // (con decimales)
  get season() { return seasonOf(this.realDay).season; }
  get year() { return new Date(this.realDay * DAY_MS).getUTCFullYear(); }
  get dayOfSeason() { return this.realDay - seasonOf(this.realDay).start + 1; }
  get info() { return WEATHER[this.weatherHere]; }
  get raining() { return !!this.info.rain && !this.game.indoors; }
  isNight() { const h = this.localHour; return h >= 20 || h < 6; }
  label() {
    const hl = this.localHour, h = Math.floor(hl), m = Math.floor((hl % 1) * 60);
    return `${this.info.icon} ${SEASONS[this.localSeason]}, día ${this.dayOfSeason} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  weatherFor(day) {
    if (day === 0) return 'sol';
    const season = seasonOf(day + this.base).season;
    let r = ihash(day, 77, this.game.world.seed);
    for (const [w, p] of CHANCES[season]) { if (r < p) return w; r -= p; }
    return 'sol';
  }

  // dayBase: las partidas de antes siguen en el día en que iban. seenDay: el último día que amaneció jugando (antes se
  // guardaba como "seen", que es también lo que ha tenido el jugador: si no es un número, es eso, y se empieza hoy)
  reset(save = {}) {
    const today = Math.floor(madridMs() / DAY_MS);
    this.dayBase = save.dayBase ?? today - Math.floor((save.clock || 0) / OLD_DAY_LEN + OLD_START_HOUR / 24);
    this.shift = save.timeShift || 0;
    this.game.frozenHour = save.frozenHour ?? null;
    const last = Number.isFinite(save.seenDay) ? save.seenDay : Number.isFinite(save.seen) ? save.seen : null;
    this.day = last === null ? this.realDay : Math.min(this.realDay, Math.max(this.realDay - CATCH_UP, last));
    this.wday = -1;
    this.drops = [];
    this.shown = '';
    this.update(0);
  }
  save(out) { Object.assign(out, { dayBase: this.dayBase, timeShift: this.shift, seenDay: this.day, frozenHour: this.game.frozenHour ?? null }); }

  // Cambia el aspecto del mundo según la estación (la vista rehace el suelo y las plantas al verlo)
  applySeason() { this.game.world.gen.season = this.localSeason; }

  update(dt) {
    const g = this.game, rd = this.realDay;
    if (rd !== this.wday) { this.wday = rd; this.weather = this.weatherFor(this.dayIndex); this.applySeason(); }
    if (g.world.gen.season !== this.localSeason) this.applySeason();   // (al cruzar el ecuador)
    // Amanece (ya jugando): un día nuevo, o los que han pasado sin jugar, cada uno con su tiempo
    if (rd > this.day && dt > 0) {
      const n = rd - this.day;
      for (let r = this.day + 1; r <= rd; r++) { this.weather = this.weatherFor(r - this.base); g.hook('onDay', r - this.base); }
      this.day = rd;
      this.weather = this.weatherFor(this.dayIndex);
      const first = this.dayOfSeason === 1 ? ' · ¡Empieza ' + SEASONS[this.season].toLowerCase() + '!' : '';
      if (n > 1 && !g.live.guest) hud.toast(`Han pasado ${n} días desde la última vez · ${SEASONS[this.season]}, día ${this.dayOfSeason}${first} · ${this.info.name}`);
      else if (n === 1) hud.toast(`${SEASONS[this.season]}, día ${this.dayOfSeason}${first} · ${this.info.name}`);
    }
    // El tiempo que ha puesto un op (/weather, o /gamerule doWeatherCycle false): manda mientras dure; al acabar,
    // vuelve el del día
    const lock = g.weatherLock;
    if (lock && lock.until !== null && Date.now() >= lock.until) g.weatherLock = null;
    if (g.weatherLock && WEATHER[g.weatherLock.w]) { this.weather = g.weatherLock.w; this.locked = true; }
    else if (this.locked) { this.locked = false; this.weather = this.weatherFor(this.dayIndex); }
    // /gamerule doDaylightCycle false: el reloj se queda a la hora que era (lo lleva quien lleva el mundo)
    if (g.rules.doDaylightCycle === false && !g.live.guest) {
      if (g.frozenHour == null) g.frozenHour = this.hour;
      else { const d = ((g.frozenHour - this.hour + 36) % 24) - 12; if (Math.abs(d) > 1 / 240) this.shift += d; }
    } else if (g.frozenHour != null && !g.live.guest) g.frozenHour = null;
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

  // Poner una hora del día de hoy (en horas, con decimales: 18.5 son las 18:30), con el comando /time set: el
  // reloj sigue andando desde ahí. Y volver a la hora de Madrid (/time reset)
  setHour(hour) {
    const here = this.now - this.shift * HOUR_MS;
    this.shift = hour - (here % DAY_MS) / HOUR_MS;
    if (this.game.frozenHour != null) this.game.frozenHour = hour;   // (con el reloj parado, se para a la nueva)
    this.update(0);
  }
  realHour() { this.shift = 0; if (this.game.frozenHour != null) this.game.frozenHour = this.hour; this.update(0); }
  // Dormir: el tiempo no se salta (es el de verdad), pero descansar quita parte del hambre (deja SLEEP_FED medios muslos como poco)
  async sleep() {
    const g = this.game, h = this.hour;
    if (h >= 6 && h < 18) {
      const pick = await hud.ask(g.player.name, 'Todavía es de día. ¿Echarte a descansar un rato?', ['Sí, un rato', 'No, que hay cosas que hacer']);
      if (pick !== 0) return;
    }
    g.busy = true;
    g.player.stop();
    await hud.fade(true);
    const fed = g.combat && g.combat.hunger < SLEEP_FED;
    if (fed) g.combat.feed(SLEEP_FED - g.combat.hunger);
    await new Promise(r => setTimeout(r, 700));
    await hud.fade(false);
    g.busy = false;
    g.gather.float(fed ? 'Has descansado y se te ha pasado el hambre' : 'Has descansado', '#a8f0a0');
    g.onSave?.();
  }

  // Oscuridad (0 a 1) según la hora de aquí
  darkness() {
    const h = this.localHour;
    let d = h < 4.5 ? 0.72 : h < 7 ? 0.72 * (1 - (h - 4.5) / 2.5) : h < 18 ? 0 : h < 21 ? 0.72 * ((h - 18) / 3) : 0.72;
    if (this.info.rain) d += 0.14 * this.info.rain;
    else if (['nubes', 'niebla', 'ventisca'].includes(this.weatherHere)) d += 0.06;
    return Math.min(0.85, d);
  }




}
