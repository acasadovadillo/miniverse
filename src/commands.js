// Los comandos, como en Minecraft (en inglés; lo que se les pasa se entiende también en español). Los escribe un
// jugador en el chat o, desde el terminal del servidor, el mundo del servidor, que es op (ver server.js). Las
// coordenadas son las que enseña el juego (el pueblo en 0, 0) y ~ es donde está quien lo escribe (~5: cinco más).
// runCommand(game, texto, say): say(texto, tipo) cuenta lo que pasa.
import { Profile } from './accounts.js';
import { ITEMS } from './items.js';
import { GAMEMODES, RULES } from './game.js';
import { DIFFICULTIES, EFFECT_NAMES } from './combat.js';
import { DARK } from './mobs.js';
import { WORLD_SEED, CHUNK } from './world/gen.js';
import { B, BIOMES } from './world/biomes.js';
import { CENTER } from './world/village.js';
import { PIECES } from './pieces.js';
import { RECIPES } from './recipes.js';
import { ACH } from './progress.js';
import { POI_NAMES } from './explore.js';
import { wrapX, dxOf, distOf, inPlanet, wrapIndex } from './world/planet.js';

// Horas con nombre para /time set (además de HH:MM)
const NAMED_HOURS = { sunrise: 6, day: 7, noon: 12, sunset: 19, night: 21, midnight: 0, amanecer: 6, dia: 7, mediodia: 12, tarde: 17, noche: 21, medianoche: 0 };
const clockText = h => { const m = Math.round(h * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// /op y /deop (dar o quitar los comandos de op) solo se escriben en el terminal del servidor, como en Minecraft
const opHere = (game, say, cmd) => say(`/${cmd} se escribe en el terminal del servidor (el de multijugador.py): /${cmd} <usuario>.${game.live.amOp ? ' Tú eres op.' : ''}`, 'err');
// Los comandos de op: si no lo eres, se dice y no se hace nada
const needOp = (game, say, cmd) => { if (game.live.amOp) return false; say(`Solo los op pueden usar /${cmd}.`, 'err'); return true; };
const plain = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// Un objeto por su nombre (sin tildes ni mayúsculas) o por su identificador (con _ o con espacios)
function findItem(text) {
  const t = plain(text), id = t.replace(/\s+/g, '_');
  if (ITEMS[id]) return id;
  return Object.keys(ITEMS).find(k => plain(ITEMS[k].name) === t) || Object.keys(ITEMS).find(k => plain(ITEMS[k].name).startsWith(t)) || null;
}
// Lo que se puede escribir en cada comando (en inglés, como en Minecraft, y en español)
const GM_NAMES = { supervivencia: 'survival', survival: 'survival', s: 'survival', 0: 'survival', creativo: 'creative', creative: 'creative', c: 'creative', 1: 'creative', espectador: 'spectator', spectator: 'spectator', sp: 'spectator', 3: 'spectator' };
const WEATHER_NAMES = { blizzard: 'ventisca', ventisca: 'ventisca', storm: 'tormenta', clear: 'sol', clouds: 'nubes', cloudy: 'nubes', rain: 'lluvia', thunder: 'tormenta', fog: 'niebla', snow: 'nieve', sol: 'sol', despejado: 'sol', nubes: 'nubes', nublado: 'nubes', lluvia: 'lluvia', tormenta: 'tormenta', niebla: 'niebla', nieve: 'nieve' };
const WEATHER_SAID = { sol: 'sol', nubes: 'nubes', lluvia: 'lluvia', tormenta: 'tormenta', niebla: 'niebla', nieve: 'nieve', ventisca: 'ventisca' };
const DIFF_NAMES = { pacifico: 'peaceful', peaceful: 'peaceful', p: 'peaceful', 0: 'peaceful', facil: 'easy', easy: 'easy', e: 'easy', 1: 'easy', normal: 'normal', n: 'normal', 2: 'normal', dificil: 'hard', hard: 'hard', h: 'hard', 3: 'hard' };
const EFFECTS = { speed: 'rapido', rapidez: 'rapido', strength: 'fuerza', fuerza: 'fuerza', resistance: 'resistencia', resistencia: 'resistencia', regeneration: 'regeneracion', regeneracion: 'regeneracion', tireless: 'incansable', incansable: 'incansable', instant_health: 'curacion', curacion: 'curacion' };
const PLACES = { village: 'aldea', aldea: 'aldea', temple: 'templo', templo: 'templo', lighthouse: 'faro', faro: 'faro', cave: 'cueva', cueva: 'cueva', ruins: 'ruinas', ruinas: 'ruinas', camp: 'campamento', campamento: 'campamento', tower: 'torre', torre: 'torre', shipwreck: 'barco', barco: 'barco' };
const BIOME_IDS = { desert: B.DESERT, desierto: B.DESERT, ice: B.ICE, hielo: B.ICE, snowy_tundra: B.SNOW, tundra: B.SNOW, forest: B.FOREST, bosque: B.FOREST, taiga: B.PINES, pinos: B.PINES, swamp: B.SWAMP, pantano: B.SWAMP, plains: B.MEADOW, pradera: B.MEADOW, ocean: B.OCEAN, mar: B.OCEAN, beach: B.BEACH, playa: B.BEACH, mountains: B.ROCKY, montana: B.ROCKY, lake: B.LAKE, lago: B.LAKE };
// Lo que se puede hacer aparecer con /summon: criaturas (las lleva quien lleva el mundo), animales salvajes (los
// de cada uno) y de granja (del mundo)
export const SUMMON = {
  slime: ['mob', 'limo'], limo: ['mob', 'limo'], skeleton: ['mob', 'esqueleto'], esqueleto: ['mob', 'esqueleto'], bat: ['mob', 'murcielago'], murcielago: ['mob', 'murcielago'],
  deer: ['wild', 'ciervo'], ciervo: ['wild', 'ciervo'], boar: ['wild', 'jabali'], jabali: ['wild', 'jabali'], swan: ['wild', 'cisne'], cisne: ['wild', 'cisne'],
  cow: ['farm', 'vaca'], vaca: ['farm', 'vaca'], sheep: ['farm', 'oveja'], oveja: ['farm', 'oveja'], pig: ['farm', 'cerdo'], cerdo: ['farm', 'cerdo'], chicken: ['farm', 'gallina'], gallina: ['farm', 'gallina'],
  duck: ['farm', 'pato'], pato: ['farm', 'pato'], rabbit: ['farm', 'conejo'], conejo: ['farm', 'conejo'], goat: ['farm', 'cabra'], cabra: ['farm', 'cabra'],
};
const FILL_MAX = 4096;   // casillas que puede tocar un /fill
const num = v => (v !== undefined && v !== '' && Number.isFinite(+v) ? +v : null);
const r2 = v => Math.round(v * 100) / 100;
const yes = v => ({ true: true, false: false, si: true, 'sí': true, no: false })[plain(v)];

// Coordenadas: las del juego (el pueblo en 0, 0), o con ~ desde donde está quien lo escribe
const isCoord = v => v !== undefined && (v[0] === '~' ? v === '~' || num(v.slice(1)) !== null : num(v) !== null);
function coord(v, here, center) { if (v[0] === '~') return here + (v.length > 1 ? num(v.slice(1)) : 0); return center + num(v); }
const coords = (game, vx, vy) => { const p = game.player; return [wrapX(coord(vx, p.x, CENTER.x)), coord(vy, p.y, CENTER.y)]; };
const shown = (x, y) => `${Math.round(dxOf(x, CENTER.x))}, ${Math.round(y - CENTER.y)}`;
// Hacia dónde queda (en el mundo: el norte, hacia arriba del mapa)
function heading(dx, dy) {
  const dirs = ['este', 'noreste', 'norte', 'noroeste', 'oeste', 'suroeste', 'sur', 'sureste'];
  return dirs[(Math.round(Math.atan2(-dy, dx) / (Math.PI / 4)) + 8) % 8];
}
// Pedirle algo a unos jugadores (por su nombre, @a o @s): a ti te lo hace tu juego; a los demás, el suyo
function order(game, say, who, m) {
  const targets = game.live.playersNamed(who);
  if (!targets.length) { say(`No hay nadie jugando que se llame ${who}.`, 'err'); return null; }
  return targets.map(t => { if (t.me) { const r = game.fromOp(m); if (r) say(r, 'ok'); return 'tú'; } game.live.order(t.conn, m); return t.peer.name; });
}
// El jugador del principio, si es un jugador (y lo que queda), o @s
function whoFirst(game, args) {
  if (args.length && (args[0][0] === '@' || game.live.playersNamed(args[0]).length)) return [args[0], args.slice(1)];
  return ['@s', args];
}
// Lo que pide al que lleva el mundo jugando en el de otro (o lo hace tu juego si lo llevas tú)
function toHost(game, say, m) {
  if (!game.live.guest) { const r = game.fromHost(m); if (r) say(r, 'ok'); return; }
  game.live.order(game.live.hostConn, m);
  say(`Pedido a ${game.live.hostName || 'quien lleva el mundo'}, que lo lleva.`, 'ok');
}

export const COMMANDS = {
  op: { help: 'da los comandos de op (/gamemode, /tp, /give, /time…) a una cuenta: se escribe en el terminal del servidor, /op <usuario>', run(game, say) { opHere(game, say, 'op'); } },
  deop: { help: 'quita los comandos de op a una cuenta: se escribe en el terminal del servidor, /deop <usuario>', run(game, say) { opHere(game, say, 'deop'); } },
  gamemode: {
    help: 'modo de juego (solo los op): /gamemode survival|creative|spectator [jugador]',
    run(game, say, [mode = '', who = '@s']) {
      if (needOp(game, say, 'gamemode')) return;
      const gm = GM_NAMES[plain(mode)];
      if (!gm) { say('Uso: /gamemode survival|creative|spectator [jugador]', 'err'); return; }
      const names = order(game, say, who, { t: 'gamemode', gm });
      if (names) say(`Modo ${GAMEMODES[gm]}: ${names.join(', ')}.`, 'ok');
    },
  },
  defaultgamemode: {
    help: 'el modo de juego de los personajes nuevos (solo los op): /defaultgamemode survival|creative|spectator',
    run(game, say, [mode = '']) {
      if (!mode) { say(`Los personajes nuevos empiezan en modo ${GAMEMODES[game.defaultGamemode]}.`, 'sys'); return; }
      if (needOp(game, say, 'defaultgamemode')) return;
      const gm = GM_NAMES[plain(mode)];
      if (!gm) { say('Uso: /defaultgamemode survival|creative|spectator', 'err'); return; }
      game.defaultGamemode = gm;
      game.onSave?.();
      say(`Los personajes nuevos empezarán en modo ${GAMEMODES[gm]}.`, 'ok');
    },
  },
  give: {
    help: 'dar objetos (solo los op): /give [jugador] <objeto> [cantidad], por ejemplo /give hafsa tablas 20',
    run(game, say, args) {
      if (needOp(game, say, 'give')) return;
      let who = '@s', rest = args;
      if (args.length > 1 && game.live.playersNamed(args[0]).length && !findItem(args.join(' '))) [who, ...rest] = args;
      const n = rest.length > 1 && num(rest[rest.length - 1]) !== null ? Math.max(1, Math.min(9999, Math.floor(num(rest.pop())))) : 1;
      const id = rest.length && findItem(rest.join(' '));
      if (!id) { say(rest.length ? `No hay ningún objeto que se llame ${rest.join(' ')}.` : 'Uso: /give [jugador] <objeto> [cantidad]', 'err'); return; }
      const names = order(game, say, who, { t: 'give', id, n });
      if (names) say(`${n} × ${ITEMS[id].name.toLowerCase()} para: ${names.join(', ')}.`, 'ok');
    },
  },
  clear: {
    help: 'vaciar la mochila (solo los op): /clear [jugador] [objeto] [cantidad]; sin objeto, todo lo que lleva (no la ropa)',
    run(game, say, args) {
      if (needOp(game, say, 'clear')) return;
      const [who, rest] = whoFirst(game, args);
      const n = rest.length > 1 && num(rest[rest.length - 1]) !== null ? Math.max(1, Math.floor(num(rest.pop()))) : null;
      const id = rest.length ? findItem(rest.join(' ')) : null;
      if (rest.length && !id) { say(`No hay ningún objeto que se llame ${rest.join(' ')}.`, 'err'); return; }
      const names = order(game, say, who, { t: 'clear', id, n });
      if (names?.some(x => x !== 'tú')) say(`${id ? ITEMS[id].name : 'Todo'} fuera de la mochila de: ${names.filter(x => x !== 'tú').join(', ')}.`, 'ok');
    },
  },
  effect: {
    help: 'efectos (solo los op): /effect give <jugador> speed|strength|resistance|regeneration|tireless|instant_health [segundos] (sin segundos, 30) · /effect clear <jugador> [efecto]',
    run(game, say, [sub = '', who = '', kind = '', secs = '']) {
      if (needOp(game, say, 'effect')) return;
      sub = plain(sub);
      const e = kind ? EFFECTS[plain(kind)] : null;
      if (!['give', 'clear'].includes(sub) || !who || (sub === 'give' && !e) || (kind && !e)) { say('Uso: /effect give <jugador> <efecto> [segundos] · /effect clear <jugador> [efecto]', 'err'); return; }
      const s = Math.max(1, Math.min(3600, num(secs) ?? 30));
      const names = order(game, say, who, sub === 'give' ? { t: 'effect', give: e, secs: s } : { t: 'effect', clear: e || 'all' });
      if (names?.some(x => x !== 'tú')) say(`${sub === 'give' ? `Efecto ${EFFECT_NAMES[e]}` : 'Efectos quitados'}: ${names.filter(x => x !== 'tú').join(', ')}.`, 'ok');
    },
  },
  xp: {
    help: 'experiencia (solo los op): /xp add|set <jugador> <cantidad> [levels|points] (sin nada, points)',
    run(game, say, [sub = '', who = '', n = '', unit = '']) {
      if (needOp(game, say, 'xp')) return;
      sub = plain(sub);
      if (!['add', 'set'].includes(sub) || !who || num(n) === null) { say('Uso: /xp add|set <jugador> <cantidad> [levels|points]', 'err'); return; }
      const levels = ['levels', 'level', 'l', 'niveles'].includes(plain(unit));
      const names = order(game, say, who, { t: 'xp', set: sub === 'set', n: Math.floor(num(n)), levels });
      if (names?.some(x => x !== 'tú')) say(`Experiencia ${sub === 'set' ? 'puesta' : 'dada'}: ${names.filter(x => x !== 'tú').join(', ')}.`, 'ok');
    },
  },
  kill: {
    help: 'matar (solo los op): /kill [jugador] (vuelve a aparecer en su punto o en casa) · /kill @e quita las criaturas de alrededor',
    run(game, say, [who = '@s']) {
      if (needOp(game, say, 'kill')) return;
      if (who === '@e') {
        const p = game.player;
        if (game.scene !== game.world) { const n = game.scene.monsters?.length || 0; if (game.scene.monsters) game.scene.monsters.length = 0; say(`Criaturas quitadas: ${n}.`, 'ok'); return; }
        toHost(game, say, { t: 'killmobs', x: r2(p.x), y: r2(p.y) });
        return;
      }
      const names = order(game, say, who, { t: 'kill' });
      if (names && names.some(n => n !== 'tú')) say(`Muerto: ${names.filter(n => n !== 'tú').join(', ')}.`, 'ok');
    },
  },
  summon: {
    help: 'hacer aparecer (solo los op): /summon <slime|skeleton|bat|deer|boar|swan|cow|sheep|pig|chicken|duck|rabbit|goat> [x y]; sin x y, delante de ti',
    run(game, say, [kind = '', vx, vy]) {
      if (needOp(game, say, 'summon')) return;
      const s = SUMMON[plain(kind)], p = game.player;
      if (!s) { say('Uso: /summon <slime|skeleton|bat|deer|boar|swan|cow|sheep|pig|chicken|duck|rabbit|goat> [x y]', 'err'); return; }
      if (game.scene !== game.world) { say('Solo en el mundo de fuera.', 'err'); return; }
      const [x, y] = isCoord(vx) && isCoord(vy) ? coords(game, vx, vy) : [wrapX(p.x + (p.face?.x || 0) * 2), p.y + (p.face?.y || 1) * 2];
      if (!inPlanet(x, y)) { say('Ahí no: fuera del planeta.', 'err'); return; }
      toHost(game, say, { t: 'summon', kind: s[0], type: s[1], x: r2(x), y: r2(y) });
    },
  },
  spawnpoint: {
    help: 'dónde reaparece al morir (solo los op): /spawnpoint [jugador] [x y]; sin x y, donde estás tú',
    run(game, say, args) {
      if (needOp(game, say, 'spawnpoint')) return;
      const [who, rest] = isCoord(args[0]) ? ['@s', args] : [args[0] || '@s', args.slice(1)];
      const p = game.player, at = isCoord(rest[0]) && isCoord(rest[1]) ? coords(game, rest[0], rest[1]) : [r2(p.x), r2(p.y)];
      const names = order(game, say, who, { t: 'spawn', x: r2(at[0]), y: r2(at[1]) });
      if (names) say(`Reaparecerá en ${shown(...at)}: ${names.join(', ')}.`, 'ok');
    },
  },
  setworldspawn: {
    help: 'dónde aparecen los personajes nuevos (solo los op): /setworldspawn [x y]; sin x y, donde estás',
    run(game, say, [x, y]) {
      if (needOp(game, say, 'setworldspawn')) return;
      const p = game.player, at = isCoord(x) && isCoord(y) ? coords(game, x, y) : [p.x, p.y];
      game.worldSpawn = [r2(at[0]), r2(at[1])];
      game.onSave?.();
      say(`Los personajes nuevos aparecerán en ${shown(...game.worldSpawn)}.`, 'ok');
    },
  },
  list: {
    help: 'quién está jugando',
    run(game, say) {
      const live = game.live, me = Profile.server ? null : `${game.player.name}${live.role === 'host' ? ' (lleva el mundo)' : ''}`;
      const others = live.joined ? live.others.filter(p => p.playing && !p.server).map(p => `${p.name}${p.host ? ' (lleva el mundo)' : ''}`) : [];
      const all = me ? [me, ...others] : others;
      say(`Jugando (${all.length}): ${all.join(', ') || 'nadie'}.${live.joined && (live.host?.server || Profile.server) ? ' El mundo lo lleva el servidor.' : ''}`, 'sys');
    },
  },
  msg: {
    help: 'un mensaje que solo ve esa persona: /msg <jugador> <texto> (también /tell y /w)',
    run(game, say, [who = '', ...words]) {
      const text = words.join(' ').trim(), t = who && game.live.playersNamed(who).find(x => !x.me);
      if (!who || !text) { say('Uso: /msg <jugador> <texto>', 'err'); return; }
      if (!t) { say(`No hay nadie más jugando que se llame ${who}.`, 'err'); return; }
      game.live.chat(text, { dm: true }, t.conn);
      say(`Le susurras a ${t.peer.name}: ${text}`, 'dm');
    },
  },
  me: {
    help: 'una acción tuya en el chat: /me <acción> (por ejemplo, /me saluda)',
    run(game, say, words) {
      const text = words.join(' ').trim();
      if (!text) { say('Uso: /me <acción>', 'err'); return; }
      game.live.chat(text, { me: true });
      say(`* ${game.player.name} ${text}`, 'me');
    },
  },
  say: {
    help: 'un aviso para todos con tu nombre (solo los op): /say <texto>',
    run(game, say, words) {
      if (needOp(game, say, 'say')) return;
      const text = words.join(' ').trim();
      if (!text) { say('Uso: /say <texto>', 'err'); return; }
      game.live.chat(text, { say: true });
      say(`[${game.player.name}] ${text}`, 'say');
    },
  },
  title: {
    help: 'un texto grande en la pantalla (solo los op): /title <jugador|@a> <texto>',
    run(game, say, [who = '', ...words]) {
      if (needOp(game, say, 'title')) return;
      const text = words.join(' ').trim();
      if (!who || !text) { say('Uso: /title <jugador|@a> <texto>', 'err'); return; }
      const names = order(game, say, who, { t: 'title', text: text.slice(0, 80) });
      if (names?.some(x => x !== 'tú')) say(`Título para: ${names.filter(x => x !== 'tú').join(', ')}.`, 'ok');
    },
  },
  weather: {
    help: 'el tiempo del mundo: /weather (dice el que hace); los op: /weather clear|clouds|rain|thunder|fog|snow|blizzard [minutos|forever] (sin minutos, 15) y /weather reset (vuelve el del día)',
    run(game, say, [kind = '', mins = '']) {
      const T = game.days, lock = game.weatherLock, word = plain(kind);
      if (!word || word === 'query') {
        const left = lock?.until ? Math.max(1, Math.ceil((lock.until - Date.now()) / 60000)) : 0;
        say(`Aquí hace ${WEATHER_SAID[T.weatherHere] || T.weatherHere}${lock ? (lock.until === null ? ', puesto por un op, sin fin' : `, puesto por un op, ${left} minuto${left === 1 ? '' : 's'} más`) : ', el del día'}.`, 'sys');
        return;
      }
      if (needOp(game, say, 'weather')) return;
      if (word === 'reset' || word === 'auto' || word === 'cycle') {
        game.weatherLock = game.rules.doWeatherCycle === false ? { w: T.weatherFor(T.dayIndex), until: null } : null;
        game.onSave?.();
        say('Vuelve el tiempo del día.', 'ok');
        return;
      }
      const w = WEATHER_NAMES[word], forever = ['forever', 'inf', 'infinite', 'siempre'].includes(plain(mins)), m = forever ? null : num(mins) ?? 15;
      if (!w || (!forever && m <= 0)) { say('Uso: /weather clear|clouds|rain|thunder|fog|snow|blizzard [minutos|forever], o /weather reset', 'err'); return; }
      game.weatherLock = { w, until: forever ? null : Date.now() + m * 60000 };
      game.onSave?.();
      say(forever ? `Ahora hace ${WEATHER_SAID[w]}, hasta que se cambie (/weather reset).` : `Ahora hace ${WEATHER_SAID[w]} durante ${m} minuto${m === 1 ? '' : 's'}; luego vuelve el tiempo del día.`, 'ok');
    },
  },
  toggledownfall: {
    help: 'que empiece o deje de llover (solo los op), 15 minutos',
    run(game, say) {
      if (needOp(game, say, 'toggledownfall')) return;
      const info = game.days.info, w = info.rain || info.snow ? 'sol' : game.days.season === 3 ? 'nieve' : 'lluvia';
      game.weatherLock = { w, until: Date.now() + 15 * 60000 };
      game.onSave?.();
      say(`Ahora hace ${WEATHER_SAID[w]} durante 15 minutos.`, 'ok');
    },
  },
  seed: { help: 'la semilla del mundo', run(game, say) { say(`Semilla del mundo: ${WORLD_SEED}`, 'sys'); } },
  difficulty: {
    help: 'la dificultad: /difficulty (la dice); /difficulty peaceful|easy|normal|hard (solo los op)',
    run(game, say, [level = '']) {
      if (!level) { say(`Dificultad: ${DIFFICULTIES[game.difficulty]}.`, 'sys'); return; }
      if (needOp(game, say, 'difficulty')) return;
      const d = DIFF_NAMES[plain(level)];
      if (!d) { say('Uso: /difficulty peaceful|easy|normal|hard', 'err'); return; }
      game.difficulty = d;
      game.onSave?.();
      say(`Dificultad: ${DIFFICULTIES[d]}.${d === 'peaceful' ? ' No hay criaturas y el hambre no baja.' : ''}`, 'ok');
    },
  },
  light: {
    help: `la luz donde estás (0-15): con ${DARK} o menos, de noche, aparecen criaturas`,
    run(game, say) {
      const p = game.player, m = game.mobs;
      if (game.scene !== game.world) { say('Aquí no hay cielo: en las cuevas, las criaturas están siempre.', 'sys'); return; }
      const tx = Math.floor(p.x), ty = Math.floor(p.y), sky = game.world.roofAt(tx, ty) ? 0 : m.sky(), block = m.block(tx, ty);
      say(`Luz aquí: ${Math.max(sky, block)} (cielo ${sky}, luces ${block}). ${Math.max(sky, block) <= DARK ? 'Aquí pueden aparecer criaturas.' : 'Aquí no aparecen criaturas.'}`, 'sys');
    },
  },
  locate: {
    help: 'dónde está lo más cercano (solo los op): /locate <village|temple|lighthouse|cave|ruins|camp|tower|shipwreck> o /locate biome <desert|ice|snowy_tundra|forest|taiga|swamp|plains|ocean|beach|mountains|lake>',
    run(game, say, [what = '', which = '']) {
      if (needOp(game, say, 'locate')) return;
      const p = game.player;
      if (plain(what) === 'biome' || plain(what) === 'bioma') {
        const b = BIOME_IDS[plain(which)];
        if (b === undefined) { say('Uso: /locate biome <desert|ice|snowy_tundra|forest|taiga|swamp|plains|ocean|beach|mountains|lake>', 'err'); return; }
        // (en anillos alrededor de ti, cada vez más lejos: el primero que salga)
        for (let r = 0; r <= 8000; r += 24) {
          const n = Math.max(1, Math.round((2 * Math.PI * r) / 24));
          let best = null;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2, x = wrapX(p.x + Math.cos(a) * r), y = p.y + Math.sin(a) * r;
            if (inPlanet(x, y) && game.world.gen.biomeAt(x, y) === b) { best = [x, y]; break; }
          }
          if (best) { const d = Math.round(distOf(...best, p.x, p.y)); say(`${BIOMES[b].name}: a ${d} casillas, al ${heading(dxOf(best[0], p.x), best[1] - p.y)} (en ${shown(...best)}).`, 'ok'); return; }
        }
        say(`No hay ${BIOMES[b].name.toLowerCase()} a menos de 8000 casillas.`, 'sys');
        return;
      }
      const kind = PLACES[plain(what)];
      if (!kind) { say('Uso: /locate <village|temple|lighthouse|cave|ruins|camp|tower|shipwreck> · /locate biome <bioma>', 'err'); return; }
      const pcx = Math.floor(p.x / CHUNK), pcy = Math.floor(p.y / CHUNK), E = game.places;
      for (let r = 0; r <= 150; r++) {
        let best = null, bd = Infinity;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const q = E.poi(wrapIndex(pcx + dx, CHUNK), pcy + dy);
          if (q?.kind !== kind) continue;
          const d = distOf(q.x, q.y, p.x, p.y);
          if (d < bd) { bd = d; best = q; }
        }
        if (best) { say(`${POI_NAMES[kind]}: a ${Math.round(bd)} casillas, al ${heading(dxOf(best.x, p.x), best.y - p.y)} (en ${shown(best.x, best.y)}).`, 'ok'); return; }
      }
      say(`No hay ningún lugar así a menos de ${150 * CHUNK} casillas.`, 'sys');
    },
  },
  setblock: {
    help: 'poner una pieza en una casilla (solo los op): /setblock <x> <y> <pieza|air> (air quita lo puesto)',
    run(game, say, [x, y, ...name]) {
      if (needOp(game, say, 'setblock')) return;
      COMMANDS.fill.run(game, say, [x, y, x, y, ...name], 'setblock');
    },
  },
  fill: {
    help: `llenar una zona de piezas (solo los op): /fill <x1> <y1> <x2> <y2> <pieza|air> (air la vacía; como mucho ${FILL_MAX} casillas)`,
    run(game, say, [x1, y1, x2, y2, ...name], cmd = 'fill') {
      if (cmd === 'fill' && needOp(game, say, 'fill')) return;
      const usage = cmd === 'fill' ? 'Uso: /fill <x1> <y1> <x2> <y2> <pieza|air>' : 'Uso: /setblock <x> <y> <pieza|air>';
      if (![x1, y1, x2, y2].every(isCoord) || !name.length) { say(usage, 'err'); return; }
      const t = plain(name.join(' ')), id = ['air', 'aire'].includes(t) ? 'air' : PIECES[t.replace(/\s+/g, '_')] ? t.replace(/\s+/g, '_') : Object.keys(PIECES).find(k => plain(PIECES[k].name) === t);
      if (!id) { say(`No hay ninguna pieza que se llame ${name.join(' ')}. Hay: ${Object.keys(PIECES).join(', ')} (y air).`, 'err'); return; }
      if (game.scene !== game.world) { say('Solo en el mundo de fuera.', 'err'); return; }
      const [ax, ay] = coords(game, x1, y1), [bx, by] = coords(game, x2, y2);
      const w = Math.abs(Math.round(dxOf(bx, ax))) + 1, h = Math.abs(Math.floor(by) - Math.floor(ay)) + 1;
      if (w * h > FILL_MAX) { say(`Demasiado grande: ${w * h} casillas (como mucho ${FILL_MAX}).`, 'err'); return; }
      const sx = Math.sign(dxOf(bx, ax)) || 1, sy = Math.sign(by - ay) || 1, x0 = Math.floor(ax), y0 = Math.floor(ay);
      let n = 0;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const tx = Math.floor(wrapX(x0 + i * sx + 0.5)), ty = y0 + j * sy;
        if (!inPlanet(tx + 0.5, ty + 0.5)) continue;
        game.world.setTile(tx, ty, id);
        n++;
      }
      game.onSave?.();
      say(`${n} casilla${n === 1 ? '' : 's'} ${id === 'air' ? 'vaciada' + (n === 1 ? '' : 's') : `con ${PIECES[id].name.toLowerCase()}`}.`, 'ok');
    },
  },
  recipe: {
    help: 'recetas (solo los op): /recipe give|take <jugador> <objeto|*>',
    run(game, say, [sub = '', who = '', ...what]) {
      if (needOp(game, say, 'recipe')) return;
      sub = plain(sub);
      const all = what.join(' ') === '*', id = all ? '*' : findItem(what.join(' '));
      if (!['give', 'take'].includes(sub) || !who || !id || (!all && !RECIPES.some(r => r.out === id))) { say(id && !all ? `No hay receta de ${ITEMS[id].name.toLowerCase()}.` : 'Uso: /recipe give|take <jugador> <objeto|*>', 'err'); return; }
      const names = order(game, say, who, { t: 'recipe', give: sub === 'give', id });
      if (names?.some(x => x !== 'tú')) say(`${sub === 'give' ? 'Recetas dadas' : 'Recetas quitadas'}: ${names.filter(x => x !== 'tú').join(', ')}.`, 'ok');
    },
  },
  achievement: {
    help: 'logros (solo los op): /achievement grant|revoke <jugador> <logro|*>',
    run(game, say, [sub = '', who = '', ...what]) {
      if (needOp(game, say, 'achievement')) return;
      sub = plain(sub);
      const t = plain(what.join(' ')), id = t === '*' ? '*' : ACH.find(([k, name]) => k === t || plain(name) === t)?.[0];
      if (!['grant', 'revoke'].includes(sub) || !who || !id) { say(`Uso: /achievement grant|revoke <jugador> <logro|*>. Logros: ${ACH.map(a => a[0]).join(', ')}.`, 'err'); return; }
      const names = order(game, say, who, { t: 'achievement', grant: sub === 'grant', id });
      if (names?.some(x => x !== 'tú')) say(`${sub === 'grant' ? 'Logros dados' : 'Logros quitados'}: ${names.filter(x => x !== 'tú').join(', ')}.`, 'ok');
    },
  },
  spectate: {
    help: 'seguir a alguien siendo espectador: /spectate <jugador>; /spectate solo, dejar de seguirlo',
    run(game, say, [who = '']) {
      if (needOp(game, say, 'spectate')) return;
      if (!who) { game.spectating = null; say('Ya no sigues a nadie.', 'ok'); return; }
      if (game.gamemode !== 'spectator') { say('Para seguir a alguien hay que ser espectador (/gamemode spectator).', 'err'); return; }
      const t = game.live.playersNamed(who).find(x => !x.me);
      if (!t) { say(`No hay nadie más jugando que se llame ${who}.`, 'err'); return; }
      game.spectating = t.peer.id;
      say(`Sigues a ${t.peer.name} (/spectate para dejarlo).`, 'ok');
    },
  },
  gamerule: {
    help: `las reglas del mundo: /gamerule (las dice); /gamerule <regla> true|false (solo los op): ${Object.keys(RULES).join(', ')}`,
    run(game, say, [rule = '', value = '']) {
      const key = Object.keys(RULES).find(k => k.toLowerCase() === rule.toLowerCase());
      if (!rule) { for (const k of Object.keys(RULES)) say(`${k} = ${game.rules[k]}`, 'sys'); return; }
      if (!key) { say(`No existe la regla ${rule}. Hay: ${Object.keys(RULES).join(', ')}.`, 'err'); return; }
      if (!value) { say(`${key} = ${game.rules[key]}`, 'sys'); return; }
      if (needOp(game, say, 'gamerule')) return;
      const v = yes(value);
      if (v === undefined) { say(`Uso: /gamerule ${key} true|false`, 'err'); return; }
      game.rules = { ...game.rules, [key]: v };
      // (sin ciclo del tiempo, se queda el de ahora hasta que se vuelva a poner)
      if (key === 'doWeatherCycle') game.weatherLock = v ? (game.weatherLock?.until === null ? null : game.weatherLock) : { w: game.days.weather, until: null };
      game.onSave?.();
      say(`${key} = ${v}${key === 'doDaylightCycle' && !v ? ' (el reloj se queda parado a esta hora)' : ''}`, 'ok');
    },
  },
  tp: {
    help: 'teletransporta (solo los op): /tp home · /tp <jugador> · /tp <x> <y> · /tp <jugador> <jugador> · /tp <jugador> home · /tp <jugador> <x> <y> (~ desde donde estás); @a son todos. También /teleport',
    run(game, say, args) {
      if (needOp(game, say, 'tp')) return;
      let who, to, at = null;
      if (args.length === 2 && isCoord(args[0]) && isCoord(args[1])) { who = '@s'; at = args; }
      else if (args.length === 3 && isCoord(args[1]) && isCoord(args[2])) { who = args[0]; at = args.slice(1); }
      else [who = '', to = ''] = args.length === 1 ? ['@s', args[0]] : args;   // (con uno solo, el que va eres tú: /tp home, /tp <jugador>)
      if (!who || (!to && !at)) { say('Uso: /tp home · /tp <jugador> · /tp <x> <y> · /tp <jugador> <jugador> · /tp <jugador> home · /tp <jugador> <x> <y>', 'err'); return; }
      const live = game.live, movers = live.playersNamed(who), home = !at && to.toLowerCase() === 'home';
      if (!movers.length) { say(`No hay nadie jugando que se llame ${who}.`, 'err'); return; }
      let where = { home: true }, dest = 'a casa';
      if (at) {
        const [x, y] = coords(game, at[0], at[1]);
        if (!inPlanet(x, y)) { say('Ahí no: fuera del planeta.', 'err'); return; }
        where = { x: r2(x), y: r2(y) }; dest = `a ${shown(x, y)}`;
      } else if (!home) {
        if (to === '@a') { say('El destino es un jugador, home o unas coordenadas.', 'err'); return; }
        const t = live.playersNamed(to)[0], e = t && (t.me ? game.player : t.peer.entity);
        if (!t) { say(`No hay nadie jugando que se llame ${to}.`, 'err'); return; }
        if (!e || (t.me ? game.scene !== game.world : t.peer.sc !== 'world')) { say(`${t.me ? 'Tú no estás' : `${t.peer.name} no está`} en el mundo de fuera.`, 'err'); return; }
        where = { x: r2(e.x), y: r2(e.y) }; dest = `adonde está ${to}`;
      }
      const names = [];
      for (const m of movers) {
        if (m.me) { if (Profile.server) continue; if (home ? game.teleportHome() : game.teleport(where.x, where.y)) names.push('tú'); }
        else { live.sendTp(m.conn, where); names.push(m.peer.name); }
      }
      if (!names.length) say('No se ha podido teletransportar a nadie.', 'err');
      else say(names.length === 1 && names[0] === 'tú' ? `Te has teletransportado ${dest}.` : `Teletransportado${names.length > 1 ? 's' : ''} ${dest}: ${names.join(', ')}.`, 'ok');
    },
  },
  account: {
    help: 'cuentas (solo el admin, siendo op): /account create <usuario>, /account reset <usuario>, /account delete <usuario>, /account list',
    async run(game, say, [sub = '', name = '']) {
      if (!Profile.admin || !game.live.amOp) { say('Para gestionar cuentas, entra como administrador y hazte op (en el terminal del servidor: /op <tu usuario>).', 'err'); return; }
      sub = sub.toLowerCase();
      try {
        if (sub === 'create' || sub === 'reset') {
          if (!name) { say(`Falta el usuario: /account ${sub} <usuario>`, 'err'); return; }
          const r = await game.onAccount?.(name, sub === 'reset');
          if (r) say(`${sub === 'reset' ? 'Token nuevo para' : 'Cuenta creada:'} ${r.name}. Código de invitación: ${r.code}`, 'ok');
        } else if (sub === 'delete') {
          if (!name) { say('Falta el usuario: /account delete <usuario>', 'err'); return; }
          if (!confirm(`¿Borrar la cuenta ${name} y su partida? No se puede deshacer.`)) return;
          say(`Cuenta borrada: ${await Profile.remove(name)}.`, 'ok');
        } else if (sub === 'list') {
          say('Leyendo las cuentas…', 'sys');
          for (const a of await Profile.list()) say(`${a.name}${a.admin ? ' (admin)' : ''}: ${a.pending ? 'esperando a que ponga su contraseña' : 'activa'}`, 'sys');
        } else say('Uso: /account create <usuario> · /account reset <usuario> · /account delete <usuario> · /account list', 'err');
      } catch (e) { say(e.message, 'err'); }
    },
  },
  time: {
    help: 'la hora (la de Madrid): /time dice qué hora es; /time set HH:MM (o sunrise, day, noon, sunset, night, midnight) pone esa hora del día; /time add <minutos> la adelanta; /time reset vuelve a la de Madrid (solo los op)',
    run(game, say, [sub = '', value = '']) {
      const T = game.days;
      if (!sub) { say(`Son las ${clockText(T.hour)}${T.shift ? ' (el reloj está movido: /time reset lo devuelve a la hora de Madrid)' : ', como en Madrid'}.`, 'sys'); return; }
      sub = sub.toLowerCase();
      if (sub === 'madrid') sub = 'reset';
      if (!((sub === 'set' || sub === 'add') && value) && sub !== 'reset') { say('Uso: /time set HH:MM (por ejemplo, /time set 18:30) · /time add <minutos> · /time reset', 'err'); return; }
      // (la hora es la del mundo: jugando en el mundo de otro, se le pide a quien lo lleva, que la cambia si eres op)
      if (needOp(game, say, 'time')) return;
      const ask = m => { game.live.order(game.live.hostConn, { t: 'settime', ...m }); say(`Pedido a ${game.live.hostName || 'quien lleva el mundo'}, que lleva la hora del mundo.`, 'ok'); };
      if (sub === 'reset' && game.live.guest) { ask({ madrid: true }); return; }
      if (sub === 'reset') {
        T.realHour();
        if (game.live.timers) game.live.timers.time = Infinity;
        game.onSave?.();
        say(`Vuelve a ser la hora de Madrid: son las ${clockText(T.hour)}.`, 'ok');
        return;
      }
      let h;
      if (sub === 'add') {
        if (num(value) === null) { say('Uso: /time add <minutos>', 'err'); return; }
        h = (((T.hour + num(value) / 60) % 24) + 24) % 24;
      } else {
        const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(value), named = NAMED_HOURS[plain(value)];
        if (!m && named === undefined) { say('Escribe la hora así: /time set 18:30', 'err'); return; }
        if (m && (+m[1] > 23 || +(m[2] || 0) > 59)) { say('Esa hora no existe: va de 00:00 a 23:59.', 'err'); return; }
        h = named ?? +m[1] + +(m[2] || 0) / 60;
      }
      if (game.live.guest) { ask({ h }); return; }
      T.setHour(h);
      if (game.live.timers) game.live.timers.time = Infinity;   // (jugando juntos, que los demás la vean ya)
      game.onSave?.();
      say(`Ahora son las ${clockText(h)} (el reloj sigue andando desde ahí; /time reset lo devuelve a la hora de Madrid).`, 'ok');
    },
  },
  sit: { help: 'sentarse en el suelo (también con la tecla G)', run(game) { game.rest.floor('floorSit'); } },
  lie: { help: 'tumbarse en el suelo (también con la tecla H)', run(game) { game.rest.floor('floorLie'); } },
  stand: { help: 'levantarse (también moviéndote o con E)', run(game) { game.rest.stand(); } },
  help: {
    help: 'lista los comandos',
    run(game, say) { for (const [name, c] of Object.entries(COMMANDS)) say(`/${name}: ${c.help}`, 'sys'); },
  },
};
const ALIASES = { tell: 'msg', w: 'msg', experience: 'xp', advancement: 'achievement', teleport: 'tp' };

// Ejecutar un comando escrito (con la barra)
export function runCommand(game, text, say) {
  const [name = '', ...args] = text.trim().slice(1).split(/\s+/), c = COMMANDS[ALIASES[name.toLowerCase()] || name.toLowerCase()];
  if (c) return c.run(game, say, args);
  say(`No existe el comando /${name}. Escribe /help para ver los que hay.`, 'err');
}
