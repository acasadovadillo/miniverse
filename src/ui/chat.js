// Chat, como en Minecraft: T lo abre (o / con la barra ya escrita), Intro envía y Esc cierra.
// Lo que empieza por / es un comando. Los mensajes se van apagando a los pocos segundos; con el chat
// abierto se ven todos los últimos.
import { hud } from './hud.js';
import { clearKeys } from '../input.js';
import { Profile } from '../accounts.js';

const $ = id => document.getElementById(id);
const FADE = 10000;   // milisegundos que un mensaje se queda a la vista con el chat cerrado
// Horas con nombre para /time set (además de HH:MM)
const NAMED_HOURS = { amanecer: 6, dia: 7, 'día': 7, mediodia: 12, 'mediodía': 12, tarde: 17, noche: 21, medianoche: 0 };
const clockText = h => { const m = Math.round(h * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// /op y /deop (dar o quitar el modo admin) solo se escriben en el terminal del servidor, como en Minecraft
const opHere = (game, say, cmd) => say(`/${cmd} se escribe en el terminal del servidor (el de multijugador.py): /${cmd} <usuario>.${game.admin ? ' Ahora eres op.' : ''}`, 'err');

const COMMANDS = {
  op: { help: 'da el modo admin (objetos infinitos, construir gratis, /tp, /time…) a una cuenta: se escribe en el terminal del servidor, /op <usuario>', run(game, say) { opHere(game, say, 'op'); } },
  deop: { help: 'quita el modo admin a una cuenta: se escribe en el terminal del servidor, /deop <usuario>', run(game, say) { opHere(game, say, 'deop'); } },
  tp: {
    help: 'teletransporta (solo los op): /tp home te lleva a casa y /tp <jugador>, adonde está; /tp <jugador> <jugador> lleva al primero adonde está el segundo; /tp <jugador> home, a casa; @a son todos (/tp @a home)',
    run(game, say, [who = '', to = '']) {
      if (!game.admin) { say('Solo los op pueden usar /tp.', 'err'); return; }
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
      if (!Profile.admin || !game.admin) { say('Para gestionar cuentas, entra como administrador y hazte op (en el terminal del servidor: /op <tu usuario>).', 'err'); return; }
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
      if (!game.admin) { say('Solo los op pueden cambiar la hora.', 'err'); return; }
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
    const [name = '', ...args] = text.slice(1).split(/\s+/), c = COMMANDS[name.toLowerCase()];
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
