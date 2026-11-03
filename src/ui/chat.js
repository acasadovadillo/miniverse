// Chat, como en Minecraft: T lo abre (o / con la barra ya escrita), Intro envía y Esc cierra.
// Lo que empieza por / es un comando (ver commands.js). Los mensajes se van apagando a los pocos segundos; con el
// chat abierto se ven todos los últimos.
import { hud } from './hud.js';
import { clearKeys } from '../input.js';
import { runCommand } from '../commands.js';

const $ = id => document.getElementById(id);
const FADE = 10000;   // milisegundos que un mensaje se queda a la vista con el chat cerrado

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
    runCommand(game, text, say);
  }

  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); const t = input.value.trim(); hide(); if (t) send(t); }
    else if (e.key === 'Escape') { e.preventDefault(); hide(); }
  });
  input.addEventListener('blur', hide);

  return { open: show, close: hide, say, get isOpen() { return open; } };
}
