// Chat, como en Minecraft: T lo abre (o / con la barra ya escrita), Intro envía y Esc cierra.
// Lo que empieza por / es un comando. Los mensajes se van apagando a los pocos segundos; con el chat
// abierto se ven todos los últimos.
import { hud } from './hud.js';
import { clearKeys } from '../input.js';
import { Profile } from '../accounts.js';
import { ITEMS } from '../items.js';
import { GAMEMODES, RULES } from '../game.js';
import { WORLD_SEED } from '../world/gen.js';

const $ = id => document.getElementById(id);
const FADE = 10000;   // milisegundos que un mensaje se queda a la vista con el chat cerrado
// Horas con nombre para /time set (además de HH:MM)
const NAMED_HOURS = { amanecer: 6, dia: 7, 'día': 7, mediodia: 12, 'mediodía': 12, tarde: 17, noche: 21, medianoche: 0 };
const clockText = h => { const m = Math.round(h * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// /op y /deop (dar o quitar los comandos de op) solo se escriben en el terminal del servidor, como en Minecraft
const opHere = (game, say, cmd) => say(`/${cmd} se escribe en el terminal del servidor (el de multijugador.py): /${cmd} <usuario>.${game.live.amOp ? ' Tú eres op.' : ''}`, 'err');
// Los comandos de op: si no lo eres, se dice y no se hace nada
const needOp = (game, say, cmd) => { if (game.live.amOp) return false; say(`Solo los op pueden usar /${cmd}.`, 'err'); return true; };
const plain = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
// Un objeto por su nombre (sin tildes ni mayúsculas) o por su identificador (con _ o con espacios)
function findItem(text) {
  const t = plain(text), id = t.replace(/\s+/g, '_');
  if (ITEMS[id]) return id;
  return Object.keys(ITEMS).find(k => plain(ITEMS[k].name) === t) || Object.keys(ITEMS).find(k => plain(ITEMS[k].name).startsWith(t)) || null;
}
// Los modos de juego, como se pueden escribir
const GM_NAMES = { supervivencia: 'survival', survival: 'survival', s: 'survival', 0: 'survival', creativo: 'creative', creative: 'creative', c: 'creative', 1: 'creative', espectador: 'spectator', spectator: 'spectator', sp: 'spectator', 3: 'spectator' };
const WEATHER_NAMES = { sol: 'sol', despejado: 'sol', clear: 'sol', nubes: 'nubes', nublado: 'nubes', lluvia: 'lluvia', rain: 'lluvia', tormenta: 'tormenta', thunder: 'tormenta', niebla: 'niebla', nieve: 'nieve', snow: 'nieve' };
const num = v => (v !== undefined && v !== '' && Number.isFinite(+v) ? +v : null);
// Pedirle algo a unos jugadores (por su nombre, @a o @s): a ti te lo hace tu juego; a los demás, el suyo
function order(game, say, who, m) {
  const targets = game.live.playersNamed(who);
  if (!targets.length) { say(`No hay nadie jugando que se llame ${who}.`, 'err'); return null; }
  return targets.map(t => { if (t.me) { game.fromOp(m); return 'tú'; } game.live.order(t.conn, m); return t.peer.name; });
}
const r2 = v => Math.round(v * 100) / 100;

const COMMANDS = {
  op: { help: 'da los comandos de op (/gamemode, /tp, /give, /time…) a una cuenta: se escribe en el terminal del servidor, /op <usuario>', run(game, say) { opHere(game, say, 'op'); } },
  deop: { help: 'quita los comandos de op a una cuenta: se escribe en el terminal del servidor, /deop <usuario>', run(game, say) { opHere(game, say, 'deop'); } },
  gamemode: {
    help: 'modo de juego (solo los op): /gamemode supervivencia|creativo|espectador [jugador]',
    run(game, say, [mode = '', who = '@s']) {
      if (needOp(game, say, 'gamemode')) return;
      const gm = GM_NAMES[plain(mode)];
      if (!gm) { say('Uso: /gamemode supervivencia|creativo|espectador [jugador]', 'err'); return; }
      const names = order(game, say, who, { t: 'gamemode', gm });
      if (names) say(`Modo ${GAMEMODES[gm]}: ${names.join(', ')}.`, 'ok');
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
  kill: {
    help: 'matar (solo los op): /kill [jugador] (vuelve a aparecer en su punto o en casa)',
    run(game, say, [who = '@s']) {
      if (needOp(game, say, 'kill')) return;
      const names = order(game, say, who, { t: 'kill' });
      if (names && names.some(n => n !== 'tú')) say(`Muerto: ${names.filter(n => n !== 'tú').join(', ')}.`, 'ok');
    },
  },
  spawnpoint: {
    help: 'dónde reaparece al morir (solo los op): /spawnpoint [jugador] [x y]; sin x y, donde estás tú',
    run(game, say, args) {
      if (needOp(game, say, 'spawnpoint')) return;
      const [who, x, y] = num(args[0]) !== null ? ['@s', num(args[0]), num(args[1])] : [args[0] || '@s', num(args[1]), num(args[2])];
      const p = game.player, at = x !== null && y !== null ? [x, y] : [r2(p.x), r2(p.y)];
      const names = order(game, say, who, { t: 'spawn', x: at[0], y: at[1] });
      if (names) say(`Reaparecerá en ${at.join(', ')}: ${names.join(', ')}.`, 'ok');
    },
  },
  setworldspawn: {
    help: 'dónde aparecen los personajes nuevos (solo los op): /setworldspawn [x y]; sin x y, donde estás',
    run(game, say, [x, y]) {
      if (needOp(game, say, 'setworldspawn')) return;
      const p = game.player;
      game.worldSpawn = num(x) !== null && num(y) !== null ? [num(x), num(y)] : [r2(p.x), r2(p.y)];
      game.onSave?.();
      say(`Los personajes nuevos aparecerán en ${game.worldSpawn.join(', ')}.`, 'ok');
    },
  },
  list: {
    help: 'quién está jugando',
    run(game, say) {
      const live = game.live, me = `${game.player.name}${live.role === 'host' ? ' (lleva el mundo)' : ''}`;
      const others = live.joined ? live.others.filter(p => p.playing && !p.server).map(p => `${p.name}${p.host ? ' (lleva el mundo)' : ''}`) : [];
      say(`Jugando (${others.length + 1}): ${[me, ...others].join(', ')}.${live.joined && live.host?.server ? ' El mundo lo lleva el servidor.' : ''}`, 'sys');
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
  weather: {
    help: 'el tiempo (solo los op): /weather sol|nubes|lluvia|tormenta|niebla|nieve [minutos] (sin minutos, 15); luego vuelve el del día',
    run(game, say, [kind = '', mins = '']) {
      if (needOp(game, say, 'weather')) return;
      const w = WEATHER_NAMES[plain(kind)], m = num(mins) ?? 15;
      if (!w || m <= 0) { say('Uso: /weather sol|nubes|lluvia|tormenta|niebla|nieve [minutos]', 'err'); return; }
      game.weatherLock = { w, until: Date.now() + m * 60000 };
      game.onSave?.();
      say(`Ahora hace ${plain(kind) === 'sol' ? 'sol' : w} durante ${m} minuto${m === 1 ? '' : 's'}${game.rules.doWeatherCycle ? '; luego vuelve el tiempo del día' : ''}.`, 'ok');
    },
  },
  seed: { help: 'la semilla del mundo', run(game, say) { say(`Semilla del mundo: ${WORLD_SEED}`, 'sys'); } },
  gamerule: {
    help: 'las reglas del mundo: /gamerule (las dice); /gamerule <regla> true|false (solo los op): keepInventory, doMobSpawning, doWeatherCycle',
    run(game, say, [rule = '', value = '']) {
      const key = Object.keys(RULES).find(k => k.toLowerCase() === rule.toLowerCase());
      if (!rule) { for (const k of Object.keys(RULES)) say(`${k} = ${game.rules[k]}`, 'sys'); return; }
      if (!key) { say(`No existe la regla ${rule}. Hay: ${Object.keys(RULES).join(', ')}.`, 'err'); return; }
      if (!value) { say(`${key} = ${game.rules[key]}`, 'sys'); return; }
      if (needOp(game, say, 'gamerule')) return;
      const v = { true: true, false: false, si: true, 'sí': true, no: false }[plain(value)];
      if (v === undefined) { say(`Uso: /gamerule ${key} true|false`, 'err'); return; }
      game.rules = { ...game.rules, [key]: v };
      // (sin ciclo del tiempo, se queda el de ahora hasta que se vuelva a poner)
      if (key === 'doWeatherCycle') game.weatherLock = v ? (game.weatherLock?.until === null ? null : game.weatherLock) : { w: game.days.weather, until: null };
      game.onSave?.();
      say(`${key} = ${v}`, 'ok');
    },
  },
  tp: {
    help: 'teletransporta (solo los op): /tp home te lleva a casa y /tp <jugador>, adonde está; /tp <jugador> <jugador> lleva al primero adonde está el segundo; /tp <jugador> home, a casa; @a son todos (/tp @a home)',
    run(game, say, [who = '', to = '']) {
      if (needOp(game, say, 'tp')) return;
      if (who && !to) [who, to] = ['@s', who];   // (con uno solo, el que va eres tú: /tp home, /tp <jugador>)
      if (!who || !to) { say('Uso: /tp home · /tp <jugador> · /tp <jugador> <jugador> · /tp <jugador> home · /tp @a home', 'err'); return; }
      const live = game.live, movers = live.playersNamed(who), home = to.toLowerCase() === 'home';
      if (!movers.length) { say(`No hay nadie jugando que se llame ${who}.`, 'err'); return; }
      let where = { home: true };
      if (!home) {
        if (to === '@a') { say('El destino es un jugador o home.', 'err'); return; }
        const t = live.playersNamed(to)[0], e = t && (t.me ? game.player : t.peer.entity);
        if (!t) { say(`No hay nadie jugando que se llame ${to}.`, 'err'); return; }
        if (!e || (t.me ? game.scene !== game.world : t.peer.sc !== 'world')) { say(`${t.me ? 'Tú no estás' : `${t.peer.name} no está`} en el mundo de fuera.`, 'err'); return; }
        where = { x: Math.round(e.x * 100) / 100, y: Math.round(e.y * 100) / 100 };
      }
      const names = [];
      for (const m of movers) {
        if (m.me) { if (home ? game.teleportHome() : game.teleport(where.x, where.y)) names.push('tú'); }
        else { live.sendTp(m.conn, where); names.push(m.peer.name); }
      }
      const dest = home ? 'a casa' : `adonde está ${to}`;
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
    help: 'la hora (la de Madrid): /time dice qué hora es; /time set HH:MM pone esa hora del día, por ejemplo /time set 18:30, y /time madrid vuelve a la de Madrid (solo los op)',
    run(game, say, [sub = '', value = '']) {
      const T = game.days;
      if (!sub) { say(`Son las ${clockText(T.hour)}${T.shift ? ' (el reloj está movido: /time madrid lo devuelve a la hora de Madrid)' : ', como en Madrid'}.`, 'sys'); return; }
      sub = sub.toLowerCase();
      if (!(sub === 'set' && value) && sub !== 'madrid') { say('Uso: /time set HH:MM (por ejemplo, /time set 18:30) o /time madrid', 'err'); return; }
      // (la hora es la del mundo, que lleva el anfitrión: jugando en el mundo de otro no se puede cambiar)
      if (needOp(game, say, 'time')) return;
      if (game.live.guest) { say(`La hora la lleva el juego de ${game.live.hostName || 'quien lleva el mundo'}: la puede cambiar ese jugador.`, 'err'); return; }
      if (sub === 'madrid') {
        T.realHour();
        if (game.live.timers) game.live.timers.time = Infinity;
        game.onSave?.();
        say(`Vuelve a ser la hora de Madrid: son las ${clockText(T.hour)}.`, 'ok');
        return;
      }
      const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(value), named = NAMED_HOURS[value.toLowerCase()];
      if (!m && named === undefined) { say('Escribe la hora así: /time set 18:30', 'err'); return; }
      if (m && (+m[1] > 23 || +(m[2] || 0) > 59)) { say('Esa hora no existe: va de 00:00 a 23:59.', 'err'); return; }
      const h = named ?? +m[1] + +(m[2] || 0) / 60;
      T.setHour(h);
      if (game.live.timers) game.live.timers.time = Infinity;   // (jugando juntos, que los demás la vean ya)
      game.onSave?.();
      say(`Ahora son las ${clockText(h)} (el reloj sigue andando desde ahí; /time madrid lo devuelve a la hora de Madrid).`, 'ok');
    },
  },
  sentarse: { help: 'sentarse en el suelo (también con la tecla G)', run(game) { game.rest.floor('floorSit'); } },
  tumbarse: { help: 'tumbarse en el suelo (también con la tecla H)', run(game) { game.rest.floor('floorLie'); } },
  levantarse: { help: 'levantarse (también moviéndote o con E)', run(game) { game.rest.stand(); } },
  ayuda: {
    help: 'lista los comandos',
    run(game, say) { for (const [name, c] of Object.entries(COMMANDS)) say(`/${name}: ${c.help}`, 'sys'); },
  },
};

const ALIASES = { tell: 'msg', w: 'msg', help: 'ayuda' };

export function initChat(game) {
  const box = $('chat'), log = $('chat-log'), input = $('chat-input');
  let open = false;

  function say(text, kind = '') {
    const line = document.createElement('div');
    line.className = `chat-line ${kind}`;
    line.textContent = text;
    line.dataset.t = Date.now();
    log.append(line);
    while (log.children.length > 60) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }
  setInterval(() => { const now = Date.now(); for (const l of log.children) l.classList.toggle('old', now - l.dataset.t > FADE); }, 500);

  function show(prefix = '') {
    if (open || game.mode !== 'play' || hud.dialogOpen) return false;
    open = true;
    clearKeys();
    box.classList.add('open');
    input.value = prefix;
    input.focus();
    log.scrollTop = log.scrollHeight;
    return true;
  }
  function hide() {
    if (!open) return;
    open = false;
    box.classList.remove('open');
    input.blur();
  }
  function send(text) {
    if (!text.startsWith('/')) { say(`<${game.player?.name || 'Tú'}> ${text}`); game.live.chat(text); return; }   // (en directo, también a los demás)
    const [name = '', ...args] = text.slice(1).split(/\s+/), c = COMMANDS[ALIASES[name.toLowerCase()] || name.toLowerCase()];
    if (c) c.run(game, say, args);
    else say(`No existe el comando /${name}. Escribe /ayuda para ver los que hay.`, 'err');
  }

  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); const t = input.value.trim(); hide(); if (t) send(t); }
    else if (e.key === 'Escape') { e.preventDefault(); hide(); }
  });
  input.addEventListener('blur', hide);

  return { open: show, close: hide, say, get isOpen() { return open; } };
}
