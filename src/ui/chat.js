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

const COMMANDS = {
  admin: {
    help: 'activa o quita el modo admin: objetos infinitos y construir gratis donde quieras (solo el admin)',
    run(game, say) {
      if (!Profile.admin) { say('Solo el administrador puede usar /admin.', 'err'); return; }
      game.setAdmin(!game.admin);
      if (game.admin) say('Modo admin activado. Lo que uses no se gasta, en el inventario (I) tienes todos los objetos y construir (B) es gratis.', 'ok');
      else say('Modo admin desactivado.', 'ok');
      game.onSave?.();
    },
  },
  account: {
    help: 'cuentas (solo el admin, con /admin activado): /account create <usuario>, /account reset <usuario>, /account delete <usuario>, /account list',
    async run(game, say, [sub = '', name = '']) {
      if (!Profile.admin || !game.admin) { say('Para gestionar cuentas, entra como administrador y activa /admin.', 'err'); return; }
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
    help: 'la hora: /time dice qué hora es; /time set HH:MM pone esa hora del día, por ejemplo /time set 18:30 (solo el admin)',
    run(game, say, [sub = '', value = '']) {
      const T = game.days;
      if (!sub) { say(`Son las ${clockText(T.hour)}.`, 'sys'); return; }
      if (sub.toLowerCase() !== 'set' || !value) { say('Uso: /time set HH:MM (por ejemplo, /time set 18:30)', 'err'); return; }
      // (la hora es la del mundo, que lleva el anfitrión: jugando en el mundo de otro no se puede cambiar)
      if (!Profile.admin || game.live.guest) { say('Solo el administrador puede cambiar la hora.', 'err'); return; }
      const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(value), named = NAMED_HOURS[value.toLowerCase()];
      if (!m && named === undefined) { say('Escribe la hora así: /time set 18:30', 'err'); return; }
      if (m && (+m[1] > 23 || +(m[2] || 0) > 59)) { say('Esa hora no existe: va de 00:00 a 23:59.', 'err'); return; }
      const h = named ?? +m[1] + +(m[2] || 0) / 60;
      T.setHour(h);
      if (game.live.timers) game.live.timers.time = Infinity;   // (jugando juntos, que los demás la vean ya)
      game.onSave?.();
      say(`Ahora son las ${clockText(h)}.`, 'ok');
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
