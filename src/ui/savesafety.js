// Lo que se ve del guardado seguro (ver accounts.js y worldkey.js):
// - los avisos de arriba (setNotice): que no se guarda en GitHub desde hace rato y por qué, que el permiso de guardado va a
//   caducar, que el admin guarde el código de recuperación de la llave del mundo. Se quedan hasta que dejan de valer (o se
//   cierran con ✕: entonces, hasta que cambie lo que dicen);
// - la ventana del código de recuperación (showKeyCode): se enseña ahí, con un botón para copiarlo al gestor de
//   contraseñas, y en ningún otro sitio (ni en el chat ni en la consola);
// - la parte de Ajustes › Cuenta del guardado (saveSettings): cómo va, cuándo caduca el permiso si se sabe y, para el admin,
//   cambiar su token y la llave del mundo (ver el código o recuperarla con él).
import { Profile } from '../accounts.js';
import { t, fmt } from '../i18n.js';

const $ = id => document.getElementById(id);
const DAY = 86400000;
export const EXPIRY_WARN = 7 * DAY;   // cuánto antes de que caduque el permiso de guardado se avisa
const dayOf = at => fmt.date(at, { day: 'numeric', month: 'long' });
const when = at => (new Date(at).toDateString() === new Date().toDateString() ? t('save.when.time', { time: fmt.date(at, { hour: '2-digit', minute: '2-digit' }) })
  : t('save.when.date', { date: fmt.date(at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }));

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
    row.style.cssText = `display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:var(--r-s);pointer-events:auto;background:var(--glass-hi);border-left:3px solid ${n.kind === 'err' ? 'var(--bad)' : 'var(--accent-2)'};box-shadow:0 3px 10px rgba(0,0,0,.4)`;
    p.style.cssText = 'margin:0;flex:1;color:var(--cream);font-size:15px;line-height:1.35';
    p.textContent = `${n.kind === 'err' ? '✕' : '⚠'} ${n.text}`;
    x.type = 'button'; x.className = 'sq'; x.textContent = '✕'; x.setAttribute('aria-label', t('save.notice.close'));
    x.style.cssText = 'flex:none;cursor:pointer';
    x.onclick = () => { n.closed = true; paintNotices(); };
    row.append(p, x);
    box.append(row);
  }
}

// El aviso de que no se guarda en GitHub (st: Profile.syncState()), con el motivo y qué hacer
export function syncNoticeText(st, { admin = false, adminName = 'el admin', user = '' } = {}) {
  if (!st) return null;
  const who = admin ? 'admin' : 'user', kind = ['offline', 'expired', 'denied', 'limit'].includes(st.kind) ? st.kind : 'other';
  const why = kind === 'other' ? (st.message || t('save.why.other')).replace(/\.$/, '') : t(`save.why.${kind}${kind === 'expired' || kind === 'denied' ? '.' + who : ''}`, { admin: adminName, user });
  return t(st.what === 'world' ? 'save.sync.world' : 'save.sync.game', { when: when(st.since), why });
}
// El aviso de que el permiso de guardado va a caducar (at: cuándo), o null si falta más de una semana
export function expiryNoticeText(at, { admin = false, adminName = 'el admin', user = '' } = {}) {
  if (!at) return null;
  const left = at - Date.now();
  if (left > EXPIRY_WARN) return null;
  const days = Math.max(0, Math.ceil(left / DAY)), who = admin ? 'admin' : 'user';
  const head = left <= 0 ? t(`save.expired.${who}`) : t(`save.expires.${who}`, { day: dayOf(at), n: Math.max(1, days) });
  return `${head} ${t(`save.renew.${who}`, { admin: adminName, user })}`;
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
    + '<h2 style="margin:0;font-size:22px;color:var(--gold)"></h2><p style="margin:10px 0 0;color:var(--dim)"></p>'
    + '<div id="key-code-text" class="ac-code" style="font-size:17px;letter-spacing:1px;word-break:break-all;font-family:ui-monospace,Menlo,Consolas,monospace"></div>'
    + '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button type="button" class="btn primary" id="key-code-copy" style="width:auto;padding:8px 18px"></button>'
    + '<button type="button" class="btn" id="key-code-done" style="width:auto;padding:8px 18px"></button></div>'
    + '<p class="note" id="key-code-msg" style="text-align:center;min-height:20px;margin:8px 0 0"></p></div>';
  box.querySelector('h2').textContent = t('save.key.code_title');
  box.querySelector('p').textContent = t('save.key.code_text');
  document.body.append(box);
  $('key-code-text').textContent = code;
  $('key-code-copy').textContent = t('save.key.copy'); $('key-code-done').textContent = t('save.key.kept');
  const close = () => { removeEventListener('keydown', onKey, true); if (box.isConnected) $('key-code-text').textContent = ''; box.remove(); };
  // (over a menu screen: Esc closes this, not that)
  const onKey = e => { if (!box.isConnected) { close(); return; } if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  $('key-code-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(code); $('key-code-msg').textContent = t('save.key.copied'); onSeen?.(); }
    catch { $('key-code-msg').textContent = t('save.key.copy_failed'); }
  };
  $('key-code-done').onclick = () => { onSeen?.(); close(); };
  box.onclick = e => { if (e.target === box) close(); };
  document.exitPointerLock?.();
  return box;
}

// ---------- Ajustes › Cuenta: el guardado ----------
// Un campo que no se ve y su botón
function oneField(hint, text, max) {
  const form = document.createElement('form'), input = document.createElement('input'), b = document.createElement('button');
  form.className = 'st-row';
  input.type = 'password'; input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = max; input.placeholder = hint; input.setAttribute('aria-label', hint);
  b.type = 'submit'; b.className = 'btn'; b.textContent = text;
  form.append(input, b);
  return form;
}
// box: la página de la cuenta en Ajustes; head(texto): un título; onKey: tras recuperar la llave del mundo (para volver a conectar);
// onCodeSeen: el admin ha visto el código (para no recordárselo más)
export function saveSettings(box, head, { onKey = null, onCodeSeen = null } = {}) {
  if (!Profile.id || Profile.server) return;
  head(t('save.title'));
  const line = (text, cls = '') => { const p = document.createElement('p'); p.className = `note ${cls}`; p.textContent = text; box.append(p); return p; };
  const st = Profile.syncState();
  line(st ? syncNoticeText(st, { admin: Profile.admin, user: Profile.id }) : t('save.fine'), st ? 'err' : '');
  const exp = Profile.tokenExpires;
  if (exp) line(t(`save.until.${Profile.admin ? 'admin' : 'user'}`, { day: dayOf(exp) }));
  if (!Profile.admin) return;
  // Cambiar el token de admin (cuando caduca o se renueva): queda cifrado con tu contraseña en accounts.json
  const form = oneField(t('save.token.new'), t('save.token.change'), 300);
  const msg = line('');
  form.onsubmit = async e => {
    e.preventDefault();
    const input = form.querySelector('input'), b = form.querySelector('button');
    b.disabled = true; msg.textContent = t('save.token.checking');
    const err = await Profile.renewToken(input.value);
    b.disabled = false; input.value = '';
    msg.textContent = err || t('save.token.changed');
  };
  box.append(form);
  // La llave del mundo: ver su código de recuperación o, si no se puede abrir, recuperarla con él
  head(t('save.key.title'));
  const keyErr = Profile.worldKeyError;
  if (!keyErr) {
    line(t('save.key.text'));
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.textContent = t('save.key.show');
    b.onclick = async () => {
      const code = await Profile.worldKeyCode();
      if (code) showKeyCode(code, onCodeSeen); else b.textContent = t('save.key.not_open');
    };
    box.append(b);
    return;
  }
  line(keyErr, 'err');
  const rec = oneField('MV1-…', t('save.key.recover'), 120);
  const recMsg = line('');
  rec.onsubmit = async e => {
    e.preventDefault();
    const input = rec.querySelector('input'), b = rec.querySelector('button');
    b.disabled = true; recMsg.textContent = t('save.key.checking');
    const err = await Profile.recoverWorldKey(input.value);
    b.disabled = false;
    if (err) { recMsg.textContent = err; return; }
    input.value = '';
    recMsg.textContent = t('save.key.recovered');
    onKey?.();
  };
  box.append(rec);
}
