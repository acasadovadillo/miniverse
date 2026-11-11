// Lo que se ve del guardado seguro (ver accounts.js y worldkey.js):
// - los avisos de arriba (setNotice): que no se guarda en GitHub desde hace rato y por qué, que el permiso de guardado va a
//   caducar, que el admin guarde el código de recuperación de la llave del mundo. Se quedan hasta que dejan de valer (o se
//   cierran con ✕: entonces, hasta que cambie lo que dicen);
// - la ventana del código de recuperación (showKeyCode): se enseña ahí, con un botón para copiarlo al gestor de
//   contraseñas, y en ningún otro sitio (ni en el chat ni en la consola);
// - la parte de Ajustes «Guardado en GitHub» (saveSettings): cómo va, cuándo caduca el permiso si se sabe y, para el admin,
//   cambiar su token y la llave del mundo (ver el código o recuperarla con él).
import { Profile } from '../accounts.js';

const $ = id => document.getElementById(id);
const DAY = 86400000;
export const EXPIRY_WARN = 7 * DAY;   // cuánto antes de que caduque el permiso de guardado se avisa
const hhmm = t => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const dayOf = t => new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
const when = t => (new Date(t).toDateString() === new Date().toDateString() ? `las ${hhmm(t)}` : `el ${new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`);

// ---------- Avisos de arriba ----------
const notices = new Map();   // id → { text, closed }
export function setNotice(id, text, kind = 'warn') {
  const cur = notices.get(id);
  if (!text) { if (!cur) return; notices.delete(id); }
  else if (cur?.text === text) return;
  else notices.set(id, { text, kind, closed: false });
  paintNotices();
}
export const noticeText = id => notices.get(id)?.text || null;
function paintNotices() {
  let box = $('save-notices');
  if (!box) {
    box = document.createElement('div');
    box.id = 'save-notices';
    // (arriba en el centro, por encima del juego y de los menús, por debajo del aviso de versión nueva)
    box.style.cssText = 'position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:60;display:flex;flex-direction:column;gap:6px;width:min(560px,calc(100vw - 32px));pointer-events:none';
    document.body.append(box);
  }
  box.replaceChildren();
  for (const [id, n] of notices) {
    if (n.closed) continue;
    const row = document.createElement('div'), p = document.createElement('p'), x = document.createElement('button');
    row.dataset.notice = id;
    row.style.cssText = `display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:6px;pointer-events:auto;background:rgba(38,26,18,.94);border:2px solid ${n.kind === 'err' ? '#b8483a' : '#a8883a'};box-shadow:0 3px 10px rgba(0,0,0,.4)`;
    p.style.cssText = 'margin:0;flex:1;color:var(--cream);font-size:15px;line-height:1.35';
    p.textContent = `${n.kind === 'err' ? '✕' : '⚠'} ${n.text}`;
    x.type = 'button'; x.className = 'sq'; x.textContent = '✕'; x.setAttribute('aria-label', 'Cerrar el aviso');
    x.style.cssText = 'flex:none;cursor:pointer';
    x.onclick = () => { n.closed = true; paintNotices(); };
    row.append(p, x);
    box.append(row);
  }
}

// El aviso de que no se guarda en GitHub (st: Profile.syncState()), con el motivo y qué hacer
export function syncNoticeText(st, { admin = false, adminName = 'el admin', user = '' } = {}) {
  if (!st) return null;
  const what = st.what === 'world' ? 'El mundo compartido no se guarda' : 'Tu partida no se guarda';
  const why = {
    offline: 'no hay conexión con GitHub',
    expired: `GitHub no acepta ${admin ? 'tu token' : 'tu permiso de guardado'} (¿ha caducado?). ${admin ? 'Cámbialo en Ajustes › Guardado en GitHub' : `Pide a ${adminName} uno nuevo (/account reset ${user}) y vuelve a entrar con el código que te dé`}`,
    denied: `${admin ? 'tu token' : 'tu permiso de guardado'} no llega al repositorio de las partidas`,
    limit: 'GitHub ha limitado las peticiones por un rato',
  }[st.kind] || (st.message || 'GitHub ha dado un error').replace(/\.$/, '');
  return `${what} en GitHub desde ${when(st.since)}: ${why}. ${st.what === 'world' ? 'Se sigue guardando en este ordenador' : 'Tu partida sigue guardada en este ordenador'} y se vuelve a intentar sola.`;
}
// El aviso de que el permiso de guardado va a caducar (at: cuándo), o null si falta más de una semana
export function expiryNoticeText(at, { admin = false, adminName = 'el admin', user = '' } = {}) {
  if (!at) return null;
  const left = at - Date.now();
  if (left > EXPIRY_WARN) return null;
  const days = Math.max(0, Math.ceil(left / DAY));
  const head = left <= 0 ? `${admin ? 'Tu token de GitHub' : 'Tu permiso de guardado en GitHub'} ha caducado` : `${admin ? 'Tu token de GitHub' : 'Tu permiso de guardado en GitHub'} caduca el ${dayOf(at)} (${days <= 1 ? 'en menos de un día' : `en ${days} días`})`;
  return `${head}. ${admin ? 'Crea uno nuevo en GitHub, cámbialo en Ajustes › Guardado en GitHub y, si tienes el servidor abierto, escribe /link en su terminal.' : `Pide a ${adminName} uno nuevo (/account reset ${user}).`}`;
}

// ---------- El código de recuperación de la llave del mundo ----------
// Solo aquí: en una ventana, con un botón para copiarlo. onSeen: cuando lo ha copiado o dice que ya lo tiene
export function showKeyCode(code, onSeen = null) {
  let box = $('key-code');
  box?.remove();
  box = document.createElement('div');
  box.id = 'key-code';
  box.style.cssText = 'position:fixed;inset:0;z-index:95;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(10,8,6,.78)';
  box.innerHTML = '<div class="panel" style="max-width:520px;padding:18px 22px;color:var(--cream);font-size:16px;line-height:1.4">'
    + '<p style="margin:0;font-size:20px;color:var(--gold)">Código de recuperación de la llave del mundo</p>'
    + '<p style="margin:10px 0 0;color:var(--dim)">Guárdalo en tu gestor de contraseñas. Si el archivo de la llave del mundo se dañara, con él se recupera (Ajustes › Llave del mundo); sin él, el mundo y sus copias no se podrían volver a abrir. Quien lo tenga puede leer el mundo compartido: no se lo pases a nadie. El juego no lo guarda en ningún sitio.</p>'
    + '<div id="key-code-text" class="ac-code" style="font-size:17px;letter-spacing:1px;word-break:break-all;font-family:ui-monospace,Menlo,Consolas,monospace"></div>'
    + '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button type="button" class="btn primary" id="key-code-copy" style="width:auto;padding:8px 18px">Copiar</button>'
    + '<button type="button" class="btn" id="key-code-done" style="width:auto;padding:8px 18px">Ya lo he guardado</button></div>'
    + '<p class="note" id="key-code-msg" style="text-align:center;min-height:20px;margin:8px 0 0"></p></div>';
  document.body.append(box);
  $('key-code-text').textContent = code;
  const close = () => { $('key-code-text').textContent = ''; box.remove(); };
  $('key-code-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(code); $('key-code-msg').textContent = 'Copiado: pégalo en tu gestor de contraseñas.'; onSeen?.(); }
    catch { $('key-code-msg').textContent = 'No se ha podido copiar solo: selecciónalo y cópialo a mano.'; }
  };
  $('key-code-done').onclick = () => { onSeen?.(); close(); };
  box.onclick = e => { if (e.target === box) close(); };
  document.exitPointerLock?.();
  return box;
}

// ---------- Ajustes › Guardado en GitHub ----------
// box: el cuerpo de Ajustes; head(texto): un título; onKey: tras recuperar la llave del mundo (para volver a conectar);
// onCodeSeen: el admin ha visto el código (para no recordárselo más)
export function saveSettings(box, head, { onKey = null, onCodeSeen = null } = {}) {
  if (!Profile.id || Profile.server) return;
  head('Guardado en GitHub');
  const line = (text, cls = '') => { const p = document.createElement('p'); p.className = `note ${cls}`; p.style.cssText = 'margin:6px 0;font-size:15px;line-height:1.35;text-align:left'; p.textContent = text; box.append(p); return p; };
  const st = Profile.syncState();
  line(st ? syncNoticeText(st, { admin: Profile.admin, user: Profile.id }) : 'Tu partida se guarda en este ordenador y, cada pocos minutos, en GitHub.', st ? 'err' : '');
  const exp = Profile.tokenExpires;
  if (exp) line(`${Profile.admin ? 'Tu token' : 'Tu permiso de guardado'} caduca el ${dayOf(exp)}.`);
  if (!Profile.admin) return;
  // Cambiar el token de admin (cuando caduca o se renueva): queda cifrado con tu contraseña en accounts.json
  const form = document.createElement('form');
  form.className = 'st-row';
  form.style.cssText = 'grid-template-columns:1fr auto';
  form.innerHTML = '<input type="password" autocomplete="off" spellcheck="false" maxlength="300" placeholder="Token nuevo de admin" style="padding:6px 8px;font-size:15px;color:var(--cream);background:rgba(0,0,0,.35);border:2px solid #8a6034;border-radius:4px;user-select:text;-webkit-user-select:text"><button type="submit" class="btn" style="width:auto;margin:0;padding:5px 12px;font-size:15px">Cambiar el token</button>';
  const msg = line('');
  form.onsubmit = async e => {
    e.preventDefault();
    const input = form.querySelector('input'), b = form.querySelector('button');
    b.disabled = true; msg.textContent = 'Comprobando el token…';
    const err = await Profile.renewToken(input.value);
    b.disabled = false; input.value = '';
    msg.textContent = err || 'Token cambiado. Si tienes el servidor abierto, escribe /link en su terminal para dárselo también al mundo del servidor.';
  };
  box.append(form);
  // La llave del mundo: ver su código de recuperación o, si no se puede abrir, recuperarla con él
  head('Llave del mundo');
  const keyErr = Profile.worldKeyError;
  if (!keyErr) {
    line('Con ella va cifrado el mundo compartido (y sus copias). Guarda su código de recuperación en tu gestor de contraseñas.');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.textContent = 'Ver el código de recuperación';
    b.onclick = async () => {
      const code = await Profile.worldKeyCode();
      if (code) showKeyCode(code, onCodeSeen); else b.textContent = 'La llave todavía no está abierta: prueba en un momento';
    };
    box.append(b);
    return;
  }
  line(keyErr, 'err');
  const rec = document.createElement('form');
  rec.className = 'st-row';
  rec.style.cssText = 'grid-template-columns:1fr auto';
  rec.innerHTML = '<input type="password" autocomplete="off" spellcheck="false" maxlength="120" placeholder="MV1-…" style="padding:6px 8px;font-size:15px;color:var(--cream);background:rgba(0,0,0,.35);border:2px solid #8a6034;border-radius:4px;user-select:text;-webkit-user-select:text"><button type="submit" class="btn" style="width:auto;margin:0;padding:5px 12px;font-size:15px">Recuperar la llave</button>';
  const recMsg = line('');
  rec.onsubmit = async e => {
    e.preventDefault();
    const input = rec.querySelector('input'), b = rec.querySelector('button');
    b.disabled = true; recMsg.textContent = 'Comprobando el código…';
    const err = await Profile.recoverWorldKey(input.value);
    b.disabled = false;
    if (err) { recMsg.textContent = err; return; }
    input.value = '';
    recMsg.textContent = 'Llave del mundo recuperada.';
    onKey?.();
  };
  box.append(rec);
}
