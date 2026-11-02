// Chat, como en Minecraft: T lo abre (o / con la barra ya escrita), Intro envía y Esc cierra.
// Lo que empieza por / es un comando. Los mensajes se van apagando a los pocos segundos; con el chat
// abierto se ven todos los últimos.
import { hud } from './hud.js';
import { clearKeys } from '../input.js';
import { Profile } from '../accounts.js';

const $ = id => document.getElementById(id);
const FADE = 10000;   // milisegundos que un mensaje se queda a la vista con el chat cerrado

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
    if (!text.startsWith('/')) { say(`<${game.player?.name || 'Tú'}> ${text}`); return; }
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
