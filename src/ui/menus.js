// Pantallas: inicio de sesión, menú principal, creador de personaje y pausa.
import { initWindows } from './windows.js';
import { Profile } from '../accounts.js';
import { LOOK_OPTIONS, DEFAULT_LOOK } from '../looks.js';
import { barberStyles, barberBill, payBarber, applyMirror, MIRROR_HIDES } from '../barber.js';
import { CharacterPreview } from '../three/preview.js';
import { SPAWN } from '../world/village.js';
import { hud } from './hud.js';
import { Audio } from '../audio.js';
import { aimLock } from '../input.js';
import { initInventoryUI } from './inventory.js';
import { initCraftingUI } from './crafting.js';
import { initChestUI } from './chest.js';
import { initLoadMeter } from './loadmeter.js';
import { BodyChip } from './bodychip.js';
import { reportFault } from '../faults.js';
import { initShopUI } from './shop.js';
import { initJournalUI } from './journal.js';
import { initSettingsUI } from './settings.js';
import { Settings } from '../settings.js';
import { SHARED } from '../livesync.js';
import { GAME_VERSION, checkPublished } from '../version.js';
import { showUpdateNotice, updateNoticeOpen } from './update.js';
import { setNotice, syncNoticeText, expiryNoticeText, showKeyCode, saveSettings } from './savesafety.js';
import { FE, alertBox, initMenuSounds, tabStrip, list, optionRow, legend, paneNav } from './frontend.js';
import { initMainMenu, initCredits, dateText, versionText } from './mainmenu.js';
import { KeyArt } from './keyart.js';
import { initPauseHub } from './pausehub.js';
import { initMapScreen } from './mapscreen.js';
import { useAccent, accentOf, ACCENTS, ACCENT_IDS } from './skin.js';
import { t, fmt, LANGS, getLang, onLangChange, applyDom, setAccountLang, accountLangOf, savedLang } from '../i18n.js';

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SCREENS = ['s-login', 's-menu', 's-account', 's-creator', 's-credits', 's-pause', 's-shop', 's-settings'];
const AUTOSAVE_MS = 15000;
const CHEST_REACH = 4;   // (lo que se puede alejar uno de un cofre abierto)
const ADMIN_NAME = 'Alberto';   // (el dueño del mundo, que abre el servidor)
const PUBLISHED_EVERY = 5 * 60000;   // cada cuánto se mira si hay una versión nueva publicada (jugando o en el menú)
const PUBLISHED_FRESH = 2 * 60000;   // al entrar en el mundo, lo mirado hace menos de esto vale
const EXPIRY_EVERY = 60 * 60000;     // cada cuánto se mira si el permiso de guardado va a caducar (si se sabe cuándo)
const KEY_CODE_SEEN = 'pueblo-brotes:llave-codigo';   // (el número de la llave del mundo cuyo código ya ha visto el admin)

// Lo de la partida que es del mundo (y los ajustes): se conserva al empezar con un personaje nuevo. Lo demás
// (lo que llevas, dinero, habilidades, recetas, amistades, logros, estadísticas…) es del personaje y se borra
const WORLD_KEYS = ['seed', 'clock', 'house', 'projects', 'boardDone', 'animals', 'farm', 'family', 'dayBase', 'timeShift', 'seenDay', 'rules', 'worldSpawn', 'weatherLock', 'difficulty', 'maps', 'defaultGamemode', 'frozenHour', 'worldAt', 'cam3d', 'volumes'];

export function initMenus(game) {
  let wins = null;   // (las ventanas de la partida: se hacen más abajo)
  let hub = null;    // (the pause: src/ui/pausehub.js; made below)
  let settingsUI = null;   // (the settings: src/ui/settings.js; made below)
  let menu = null, credits = null;   // (the main menu and its credits: src/ui/mainmenu.js; made below)
  const opened = {};   // what each front screen does when it is put in sight: it takes the keys (frontend.js)
  function show(id) {
    if (id !== 's-pause') hub?.shut();
    if (id !== 's-settings') settingsUI?.shut();
    if (id !== 's-credits') credits?.shut();
    if (id === 's-login' || id === 's-menu') wins?.closeAll();
    SCREENS.forEach(s => $(s).classList.toggle('show', s === id));
    document.body.classList.toggle('playing', !id);
    if (id && !game.player) KeyArt.start(); else KeyArt.stop();
    opened[id]?.();
  }
  const paintVersion = () => { for (const el of document.querySelectorAll('.fe-ver')) el.textContent = versionText(); };
  paintVersion();
  onLangChange(paintVersion);

  // ---------- Contraseñas: un ojo para verlas u ocultarlas ----------
  const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/></svg>';
  for (const input of document.querySelectorAll('.field input[type="password"]')) {
    const wrap = document.createElement('span'), eye = document.createElement('button');
    wrap.className = 'pw';
    eye.type = 'button'; eye.className = 'pw-eye';
    const paint = () => { const shown = input.type === 'text'; eye.innerHTML = shown ? EYE_OFF : EYE; const what = t(shown ? 'gui.login.hide' : 'gui.login.show'); eye.setAttribute('aria-label', what); eye.title = what; eye.setAttribute('aria-pressed', String(shown)); };
    eye.addEventListener('mousedown', e => e.preventDefault());   // (sin quitarle el foco al campo)
    eye.addEventListener('click', () => { input.type = input.type === 'password' ? 'text' : 'password'; paint(); });
    input.replaceWith(wrap);
    wrap.append(input, eye);
    paint();
    onLangChange(paint);
  }

  // ---------- Language: EN | ES in a corner of the login screen ----------
  // (Settings only opens after logging in: the first screen needs its own way to change it. The main menu has Settings,
  // so no corner picker there. A click is an explicit choice, saved like the one in Settings)
  const pickers = [];
  for (const id of ['s-login']) {
    const box = document.createElement('div'), mark = text => { const s = document.createElement('span'); s.textContent = text; s.setAttribute('aria-hidden', 'true'); return s; };
    box.className = 'lang-pick panel';
    box.setAttribute('role', 'group');
    box.dataset.i18nAttr = 'aria-label:gui.lang_picker.label';
    box.setAttribute('aria-label', t('gui.lang_picker.label'));
    box.append(mark('🌐'));
    Object.keys(LANGS).forEach((l, i) => {
      if (i) box.append(mark('|'));
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = l.toUpperCase(); b.lang = l; b.dataset.lang = l;
      b.title = l === 'en' ? t('lang.en.in_progress') : LANGS[l];
      if (l === 'en') b.dataset.i18nAttr = 'title:lang.en.in_progress';   // (applyDom keeps it in the current language)
      // (the language already shown does nothing: on automatic, clicking it must not turn it into a fixed choice)
      b.onclick = () => { if (l !== getLang()) Settings.setLang(l).finally(paintPickers); };
      box.append(b);
    });
    $(id).append(box);
    pickers.push(box);
  }
  function paintPickers() { for (const box of pickers) for (const b of box.querySelectorAll('button')) b.classList.toggle('on', b.dataset.lang === getLang()); }
  paintPickers();
  onLangChange(paintPickers);

  // ---------- Inicio de sesión ----------
  // Según el usuario hace falta su contraseña; la primera vez, además, su código de invitación (y repetir la
  // contraseña nueva); y para crear la cuenta de admin, su token de GitHub.
  let step = null, stepUser = '';
  // (renew: el admin cuyo token ya no acepta GitHub pega uno nuevo)
  const ROWS = { login: [], invite: ['lg-code-row', 'lg-pass2-row'], setup: ['lg-pass2-row', 'lg-token-row'], renew: ['lg-token-row'] };
  function setStep(s) {
    step = s;
    for (const id of ['lg-code-row', 'lg-pass2-row', 'lg-token-row']) $(id).hidden = !ROWS[s || 'login'].includes(id);
    $('lg-submit').dataset.i18n = s === 'setup' ? 'gui.login.submit_setup' : s === 'renew' ? 'gui.login.submit_renew' : 'gui.login.submit';
    applyDom($('lg-submit'));
    $('lg-pass').autocomplete = s === 'login' || !s || s === 'renew' ? 'current-password' : 'new-password';
    damagedBox(false);
  }
  function openLogin() {
    setStep(null);
    useAccent(null);
    for (const id of ['lg-pass', 'lg-pass2', 'lg-code', 'lg-token']) $(id).value = '';
    $('lg-err').textContent = '';
    $('s-login').classList.remove('out');
    show('s-login');
  }
  // The keys: ↑ ↓ go through the fields and the buttons, Enter logs in (from a field, the form's own; with nothing focused, as
  // when the browser has filled them in by itself, here too)
  const loginNav = paneNav($('login-form'), { skip: '.pw-eye' });
  opened['s-login'] = () => {
    if (FE.active() !== 's-login') FE.open('s-login', { root: true, sound: null, parts: [{ key(e) {
      const a = document.activeElement;
      if (/^(Enter|NumpadEnter|Space)$/.test(e.code) && a instanceof HTMLButtonElement) { if (!e.repeat) a.click(); return true; }   // (the language's, the eye's)
      if (/^(Enter|NumpadEnter)$/.test(e.code)) { if (!e.repeat && !$('lg-submit').disabled) $('login-form').requestSubmit(); return true; }
      return loginNav.key(e);
    } }] });
    paintLoginKeys();
  };
  function paintLoginKeys() { legend($('lg-legend'), [{ keys: ['↑', '↓'], text: t('gui.legend.move') }, { keys: ['Enter'], text: t('gui.login.submit') }]); }
  onLangChange(() => { if ($('s-login').classList.contains('show')) paintLoginKeys(); });
  $('lg-user').addEventListener('input', () => { if (step) { setStep(null); $('lg-err').textContent = ''; } });
  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const user = $('lg-user').value.trim(), pass = $('lg-pass').value, say = m => { $('lg-err').textContent = m; };
    if (!user) return say(t('gui.login.need_user'));
    if (!pass) return say(t('gui.login.need_password'));
    $('lg-submit').disabled = true;
    try {
      if (!step || stepUser !== user) {
        say(t('gui.login.searching'));
        const s = await Profile.check(user);
        stepUser = user;
        if (s === 'unknown') { setStep(null); return say(t('gui.login.unknown')); }
        setStep(s);
        if (s === 'invite') return say(t('gui.login.first_time'));
        if (s === 'setup') return say(t('gui.login.first_admin'));
      }
      say(t('gui.login.opening'));
      damagedBox(false);
      const err = step === 'invite' ? await Profile.activate(user, $('lg-code').value, pass, $('lg-pass2').value)
        : step === 'setup' ? await Profile.setup(pass, $('lg-pass2').value, $('lg-token').value)
        : step === 'renew' ? await Profile.renewToken($('lg-token').value)
        : await Profile.login(user, pass);
      if (err) {
        if (Profile.damaged) damagedBox(true);   // (la partida de GitHub no se abre: qué hacer, abajo)
        else if (Profile.needsToken) { setStep('renew'); $('lg-token').value = ''; }
        return say(err);
      }
      if (step === 'renew') $('lg-token').value = '';
      await loggedIn();
    } catch (err) { say(err.message); } finally { $('lg-submit').disabled = false; }
  });
  async function loggedIn() {
    Settings.useVolumes(Profile.data?.save?.volumes);   // (los volúmenes de tu partida)
    // (on automatic, the language of the account: one from before this version stays in Spanish; see i18n.js)
    await setAccountLang(accountLangOf(Profile.data?.save));
    // (the card fades; a game left or started meanwhile, or the session closed, is not this one's any more)
    const who = Profile.id;
    $('s-login').classList.add('out');
    if (Settings.v.motion !== 'reduced') await sleep(200);
    $('s-login').classList.remove('out');
    if (Profile.id !== who || !$('s-login').classList.contains('show')) return;
    openMenu();
    expiryCheck();
    keyReminder();
  }
  // La partida de GitHub no se puede abrir (¿dañada?): no se entra con una vacía (se subiría encima). Se ofrece la copia de
  // este navegador, si la hay, o buscar una anterior en el historial de GitHub; si no hay ninguna, empezar sin partida
  // (con un aviso). Lo elegido se sube encima de la dañada, que sigue en el historial de GitHub
  function damagedBox(open) {
    let box = $('lg-damaged');
    if (!open) { box?.remove(); return; }
    const d = Profile.damaged;
    if (!d) return;
    if (!box) { box = document.createElement('div'); box.id = 'lg-damaged'; $('lg-err').after(box); }
    box.replaceChildren();
    const say = m => { $('lg-err').textContent = m; };
    const button = (text, run, primary = false) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = primary ? 'btn primary' : 'btn'; b.textContent = text;
      b.onclick = async () => {
        for (const x of box.querySelectorAll('button')) x.disabled = true;
        try { await run(b); } catch (e) { say(e.message); } finally { for (const x of box.querySelectorAll('button')) x.disabled = false; }
      };
      box.append(b);
      return b;
    };
    const use = async choice => {
      say(t('gui.login.opening'));
      const err = await Profile.resolveDamaged(choice);
      if (err) return say(err);
      damagedBox(false);
      await loggedIn();
    };
    if (d.localAt !== null) button(d.localAt > 0 ? t('gui.login.damaged.local_at', { when: dateText(d.localAt) }) : t('gui.login.damaged.local'), () => use('local'), true);
    if (d.found) button(t('gui.login.damaged.github', { when: dateText(d.found.at) }), () => use('older'), d.localAt === null);
    else if (d.found === undefined) button(t('gui.login.damaged.search'), async b => {
      b.textContent = t('gui.login.damaged.searching');
      // (si falla, sin conexión o con un error de GitHub, se dice arriba y los botones vuelven a estar como antes)
      try { if (!(await Profile.findOlder())) say(t('gui.login.damaged.none')); }
      finally { damagedBox(true); }
    });
    if (d.localAt === null && d.found === null) button(t('gui.login.damaged.empty'), async () => { if (await alertBox({ title: t('gui.alert.empty_title'), text: t('gui.alert.empty_text') })) await use('empty'); });
  }

  // ---------- Menú principal ----------
  // Solo hay un mundo, el de todos: con personaje se continúa la partida (en el mundo compartido; los demás, con
  // el servidor abierto, aunque el admin no esté) o se empieza otra con un personaje nuevo (avisando de que el de
  // ahora se borra). Sin personaje, se crea.
  let currentSave = null;
  function openMenu() {
    localMode = false; live.local = false;
    // (si se sale a medias de algo a oscuras, un /tp lejos o al reaparecer, que el menú no se quede tapado: al volver a
    // jugar, play lo vuelve a tapar, y el salto viejo ya no destapa nada: ver Game.coverJump)
    $('fade').classList.remove('on');
    currentSave = Profile.data?.save || null;
    useAccent(currentSave);
    $('menu-msg').textContent = '';
    menu.busy(false);   // (al volver de jugar; sin servidor, los demás no pueden: lo dice paintLive)
    menu.use(currentSave, Profile.data?.local?.save || null);
    show('s-menu');
    paintLive();
    findLive();
    publishedNewer(PUBLISHED_FRESH).catch(() => {});   // (para no esperar luego al pulsar Continuar: ver enter)
  }
  menu = game.mainMenu = initMainMenu({ pick: id => MENU[id]?.() });
  credits = initCredits({ onClose: () => backToMenu('m-credits') });
  opened['s-menu'] = () => menu.open();
  function backToMenu(id) { show('s-menu'); menu.focus(id); paintLive(); }
  const MENU = {
    'm-continue': () => { if (currentSave) enter(); },
    'm-local': playLocal,
    'm-new': newCharacter,
    'm-settings': () => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); show('s-settings'); settingsUI.openScreen(); },
    'm-credits': () => { show('s-credits'); credits.open(); },
    'm-session': () => logOut(),
  };
  // Jugar en local: un mundo solo tuyo, sin servidor ni nadie más, guardado con tu cuenta (Profile.storeLocal). Es una
  // partida aparte: su personaje empieza de cero con el nombre y el aspecto del tuyo, y lo que hagas allí no pasa al
  // mundo de todos (ni al revés). En él eres op: puedes usar los comandos
  let localMode = false;
  function playLocal() {
    const loc = Profile.data?.local;
    if (!loc?.save && !currentSave) { $('menu-msg').textContent = t('gui.menu.local.need_character'); return; }
    live.close();   // (fuera del servidor mientras se juega en local; al volver al menú se busca otra vez)
    const data = loc?.save || { player: { name: currentSave.player.name, look: { ...currentSave.player.look }, x: SPAWN.x, y: SPAWN.y, inside: false, view: 'back' } };
    $('menu-msg').textContent = t('gui.menu.local.opening');
    localMode = true; live.local = true;
    play(data, new Map(loc?.deltas || []), null, null);
  }
  // Entrar en el mundo: si alguien lo lleva, en el suyo; si no, lo lleva tu juego (con el servidor abierto, los
  // demás entran contigo). Sin servidor solo puede jugar el admin. En tu partida se guarda lo tuyo; el mundo, quien
  // lo lleva lo guarda para todos.
  async function enter() {
    const solo = { save: currentSave, deltas: new Map(Profile.data.deltas) };
    // (con una versión vieja no se entra a tocar el mundo de todos: ver version.js. Se mira también tras cada espera: el
    // saludo de un juego más nuevo puede llegar mientras)
    const stale = () => { if (live.newer === null) return false; live.unclaim(); $('menu-msg').textContent = ''; outdatedNotice(live.newer); return true; };
    menu.busy(true);
    try {
      if (stale()) return;
      $('menu-msg').textContent = t('gui.menu.enter.checking');
      const pub = await publishedNewer(PUBLISHED_FRESH);
      if (pub) { $('menu-msg').textContent = ''; outdatedNotice(pub, true); return; }
      if (live.status === 'kicked') {
        // (te echaron: se vuelve a intentar entrar, y se espera a saber si ahora te deja)
        live.close(); await findLive();
        for (let i = 0; i < 40 && live.status === 'connecting'; i++) await sleep(150);
      }
      // El servidor está abierto pero no te deja entrar (p. ej. mientras vuelve a una copia del mundo con /restore): no se
      // juega sin él, tampoco el admin, que llevaría el mundo de antes y lo guardaría encima del bueno
      if (live.status === 'kicked') throw new Error(live.error || t('gui.menu.enter.refused'));
      const on = live.status === 'on';
      if (!on && !Profile.admin) throw new Error(t('gui.menu.live.closed', { admin: ADMIN_NAME }));
      if (on && !live.host?.playing && !(await live.claim())) await live.waitHost();
      if (on && live.status !== 'on') throw new Error(live.error || t('gui.menu.enter.lost'));   // (te han echado o vetado mientras)
      if (on && live.host?.playing) {
        $('menu-msg').textContent = live.host.server ? t('gui.menu.enter.entering') : t('gui.menu.enter.entering_with', { name: live.host.name });
        const world = await live.requestWorld();
        if (stale()) return;
        const { save, deltas } = live.enter(solo, world);
        play(save, deltas, solo, 'guest');
        return;
      }
      $('menu-msg').textContent = t('gui.menu.enter.opening');
      const world = await sharedWorld(solo);
      if (on && live.status !== 'on') throw new Error(live.error || t('gui.menu.enter.lost'));
      if (stale()) return;
      if (world) { const { save, deltas } = live.enter(solo, world); play(save, deltas, Profile.admin ? null : solo, on ? 'host' : null); }
      else { live.extraShared = {}; play(currentSave, solo.deltas, null, on ? 'host' : null); }   // (el admin, con el mundo de su partida)
    } catch (e) { live.unclaim(); $('menu-msg').textContent = e.message; } finally { if (!game.player) { menu.busy(false); paintLive(); } }
  }
  // El mundo compartido como lo guardó la última vez quien lo llevaba. El admin, si el de su partida es más
  // reciente (o aún no se ha guardado aparte), juega con ese: null
  async function sharedWorld(solo) {
    let w;
    try { w = await Profile.loadWorld(); } catch (e) { throw new Error(t('gui.menu.enter.world_failed', { why: e.message })); }
    if (Profile.admin && (!w || (w.savedAt || 0) <= (solo.save.worldAt || 0))) return null;
    if (!w) throw new Error(t('gui.menu.enter.world_missing', { admin: ADMIN_NAME }));
    return w;
  }
  function logOut() { live.close(); Profile.logout(); setAccountLang(null); for (const id of ['sync', 'token', 'server-token', 'key-code', 'key-lost']) setNotice(id, null); openLogin(); }
  // Settings › Account › Log out: playing, it asks, saves first and, if it could not be saved anywhere, stays
  let leaving = false;
  async function logOutFromSettings() {
    if (leaving) return;
    const g = game.player, id = Profile.id;
    let r = null;
    leaving = true;
    try {
      if (g) {
        if (!await alertBox({ title: t('gui.account.logout_title'), text: t('gui.account.logout_text'), yes: t('gui.menu.log_out') }) || !hub.isOpen || game.player !== g) return;
        r = await save({ upload: true });
        if (game.player !== g) return;   // (it ended meanwhile: the connection was lost)
        if (!r?.local && r?.remote !== true) { hud.toast(savedMsg(r), 'mal'); return; }
        game.end();
      } else {
        await Promise.race([flushSave(), sleep(3000)]);   // (on this computer it takes nothing; GitHub is not waited for longer)
        if (game.player || Profile.id !== id || !$('s-settings').classList.contains('show')) return;   // (gone elsewhere meanwhile)
      }
      logOut();
      if (r?.remote === false) $('lg-err').textContent = savedMsg(r);
    } finally { leaving = false; }
  }

  // ---------- Guardado seguro ----------
  // Si subir a GitHub falla dos veces seguidas, un aviso arriba con el motivo (y qué hacer), hasta que vuelve a ir
  const who = () => ({ admin: Profile.admin, adminName: ADMIN_NAME, user: Profile.name || Profile.id || '' });
  Profile.onSync = st => setNotice('sync', syncNoticeText(st, who()), 'err');
  // Una semana antes de que caduque el permiso de guardado, si se sabe la fecha (ver tokenExpiry en github.js); y lo que
  // diga el servidor del token del mundo del servidor, que es el del admin (multijugador.py sí puede saber la fecha)
  function expiryCheck() { setNotice('token', expiryNoticeText(Profile.tokenExpires, who()), 'err'); }
  setInterval(() => { if (Profile.id) expiryCheck(); }, EXPIRY_EVERY);
  // (con el texto vacío, que ya está bien: se quita)
  game.live.onNotice = m => { if (Profile.admin && typeof m.text === 'string') setNotice('server-token', m.text.slice(0, 400) || null, 'err'); };
  // La llave del mundo (el admin): si no se puede abrir, se dice (y en Ajustes se recupera con el código); si se abre y
  // todavía no ha visto su código de recuperación, se le recuerda guardarlo
  // (al abrirse, e vacío: se quita el aviso y, si ya estaba conectado sin ella, se le da a la conexión)
  Profile.onWorldKeyError = e => {
    setNotice('key-lost', e || null, 'err');
    const net = game.live.net;
    if (!e) Profile.worldKey().then(k => { if (k && net && game.live.net === net && !net.key) { net.key = k; if (net.ready) game.live.up(); } }).catch(() => {});
    if ($('s-menu').classList.contains('show')) paintLive();
  };
  const seenCode = () => { try { return localStorage.getItem(KEY_CODE_SEEN); } catch { return null; } };
  async function keyReminder() {
    if (!Profile.admin || !(await Profile.worldKey())) return;
    const wid = Profile.worldKeyId();
    setNotice('key-code', wid && seenCode() !== wid ? t('save.key.remind') : null);
  }
  function codeSeen() {
    try { localStorage.setItem(KEY_CODE_SEEN, Profile.worldKeyId() || ''); } catch { /* (sin almacenamiento: se le recordará otra vez) */ }
    setNotice('key-code', null);
  }

  // ---------- Jugar juntos en directo ----------
  // El admin abre su servidor con multijugador.py, que abre el juego con ?servidor=…: su juego se conecta a
  // él como anfitrión y publica la dirección en GitHub. Los demás la buscan ahí al llegar al menú (o la traen
  // en el enlace) y, si el admin está jugando, pueden entrar con él.
  const live = game.live;
  const wsParam = name => (u => (u && /^wss?:\/\//.test(u) ? u : null))(new URLSearchParams(location.search).get(name));
  const LIVE_URL = wsParam('servidor');
  // (local: el servidor, en este mismo ordenador, cuando la pestaña la abre multijugador.py para que el juego del
  // admin le dé las claves al mundo del servidor; ver live.handOver)
  const LOCAL_URL = wsParam('local');
  let announced = null;
  async function findLive() {
    const url = LIVE_URL || (await Profile.liveServer().catch(() => null))?.url;   // (también el admin: si alguien juega, entra con él)
    if (LOCAL_URL && LOCAL_URL !== url && Profile.admin && await Profile.worldKey()) live.handOver(LOCAL_URL);
    if (!url) { live.close(); paintLive(); return; }
    await live.connect(url);
  }
  // El admin publica la dirección en cuanto su juego se conecta a su servidor (por el túnel, no en local)
  function announce() {
    const url = live.url;
    if (Profile.admin && live.status === 'on' && url?.startsWith('wss://') && announced !== url) { announced = url; Profile.announce(url).catch(() => { announced = null; }); }
  }
  // Mientras se está en el menú sin conexión, se vuelve a mirar de vez en cuando si el admin ha abierto su
  // servidor (cada vez que lo abre, la dirección es otra)
  setInterval(() => { if (Profile.id && !LIVE_URL && $('s-menu').classList.contains('show') && !['on', 'nokey', 'kicked'].includes(live.status)) findLive(); }, 30000);
  function paintLive() {
    const host = live.host, s = live.status, playing = live.others.filter(p => p.playing && !p.server).map(p => p.name);
    const who = { names: fmt.list(playing), n: playing.length }, say = (k, p) => t(`gui.menu.live.${k}`, p);
    let msg = '';
    if (s === 'kicked') msg = live.error;
    else if (s === 'on' && host?.server) msg = playing.length ? say('world_playing', who) : say('world');
    else if (s === 'on') msg = host?.playing ? say('playing', who) : say(Profile.admin ? 'open_admin' : 'open');
    else if (Profile.admin) {
      if (s === 'connecting') msg = say('connecting_admin');
      else if (s === 'error' && LIVE_URL) msg = say('error_admin', { why: live.error });
    } else {
      // Los demás solo pueden jugar con el servidor abierto: el mundo, el de todos, solo está ahí
      if (s === 'connecting') msg = say('connecting');
      else if (s === 'nokey') msg = say('nokey', { admin: ADMIN_NAME });
      else msg = say('closed', { admin: ADMIN_NAME });
    }
    if (live.serverOld && s === 'on') msg += ` ${live.serverOld}`;   // (al admin y a los op: ver live.checkVersion)
    if (Profile.admin && Profile.worldKeyError) msg = `${Profile.worldKeyError} ${msg}`.trim();   // (sin ella no se juega con los demás)
    menu.live(s === 'on' ? playing : [], !Profile.admin && s !== 'on' && s !== 'kicked' ? msg : '');   // (echado: al pulsar, se vuelve a intentar)
    const open = s === 'on';
    $('m-live').hidden = !msg;
    $('m-live').className = s === 'kicked' || (s === 'error' && Profile.admin) || (Profile.admin && Profile.worldKeyError) ? 'err' : open ? '' : 'wait';
    $('m-live-msg').textContent = msg;
  }
  live.onChange = () => { announce(); if ($('s-menu').classList.contains('show')) paintLive(); };
  // Si hay que salir del mundo compartido (se ha cortado la conexión, u otro ya lo llevaba), se guarda lo tuyo
  // (y, si lo llevabas y no es que otro lo llevara ya, el mundo) y se vuelve al menú
  live.onHostLeft = async (why, text) => {
    const r = await save({ upload: true, world: why !== 'conflict' });
    game.end();
    openMenu();
    const kept = t(r.remote === false ? 'gui.menu.left.kept_here' : 'gui.menu.left.kept');
    $('menu-msg').textContent = why === 'kicked' || why === 'stop' ? `${text} ${kept}` : `${t(why === 'outdated' || why === 'conflict' ? `gui.menu.left.${why}` : 'gui.menu.left.lost')} ${kept}`;
    if (why === 'outdated') outdatedNotice(live.newer);
  };
  // El servidor pide guardar ya (/save-all en su terminal); y cada vez que se sube el mundo, una copia para él
  live.onServerSave = () => save({ upload: true });
  Profile.onWorldBytes = bytes => live.backup(bytes);
  // Tu juego pasa a llevar el mundo (se ha ido quien lo llevaba): se guarda ya para todos. Y deja de llevarlo
  // porque llega el mundo del servidor: se guarda lo tuyo
  live.onHost = () => save({ upload: true });
  live.onYield = () => save({ upload: true });

  // ---------- Versión nueva ----------
  // Otro juego conectado (o el servidor) tiene una versión más nueva: se sale del mundo compartido (live.outdated) y se
  // pide recargar. Y cada pocos minutos, y al entrar en el mundo, se mira la versión publicada (una pestaña abierta
  // desde antes de publicar no se enteraría nunca). El botón guarda antes de recargar
  const reloadSaved = () => (game.player ? save({ upload: true }) : Promise.resolve());
  function outdatedNotice(v, published = false) {
    const detail = `${published ? 'Se ha publicado' : 'Otro juego conectado tiene'} la versión ${v || 'nueva'}; la tuya es la ${GAME_VERSION || 'de antes'}.`
      + (game.player ? ' Al recargar se guarda antes tu partida.' : ' Hasta que recargues, no puedes entrar en el mundo compartido.');
    showUpdateNotice({ detail, later: !!game.player, reload: reloadSaved });
  }
  live.onOutdated = v => { if (!game.player || !live.joined) outdatedNotice(v); };   // (jugando, sale antes del mundo: ver onHostLeft)
  let published = { at: -Infinity, v: null }, told = null;
  async function publishedNewer(fresh = 0) {
    if (Profile.server) return null;
    if (performance.now() - published.at > fresh) published = { at: performance.now(), v: await checkPublished() };
    return published.v;
  }
  setInterval(async () => {
    if (document.visibilityState !== 'visible' || !Profile.id || updateNoticeOpen()) return;
    const v = await publishedNewer();
    if (v && v !== told) { told = v; outdatedNotice(v, true); }   // (una vez por versión: luego, al ir a entrar)
  }, PUBLISHED_EVERY);
  // Nueva partida: antes, un aviso (se borra el personaje de ahora; el mundo, no). Sin personaje, al creador
  async function newCharacter() {
    if (!currentSave) { openCreator(); return; }
    if (await alertBox({ title: t('gui.alert.new_title'), text: t('gui.menu.new_game_warning'), yes: t('gui.menu.new_game_confirm'), no: t('common.cancel') }) && $('s-menu').classList.contains('show')) openCreator(true);
  }
  initMenuSounds(['s-login', 's-account', 's-creator', 'st-account']);
  // (a button clicked with the mouse does not keep the focus: Enter is still the screen's)
  for (const id of ['s-login', 's-creator']) $(id).addEventListener('click', e => { const b = e.target instanceof Element && e.target.closest('button'); if (e.detail && b) b.blur(); });

  // ---------- Creador de personaje ----------
  // (la vista previa es el mismo modelo en 3D que en el juego)
  const look = { ...DEFAULT_LOOK };
  const preview = new CharacterPreview($('cr-canvas'));
  // Pages (Q and E, or their tabs): body and clothes, face and hair (on the face, the camera comes closer to the head). Each has
  // its rows, «Label ‹ Value ›» (frontend.js optionRow). They are made again each time it opens (buildRows): the mirror and the
  // barber leave some out, and the language may be another
  const PAGES = ['cuerpo', 'cara', 'pelo'];   // (gui.creator.page.*)
  let rows = [], L = null, page = 'cuerpo', colour = null;   // colour: the player's own (0-7), or null, the one of the name (skin.js)
  const nameIn = $('cr-name');
  const tabs = tabStrip($('cr-tabs'), PAGES.map(id => ({ id, text: t(`gui.creator.page.${id}`), i18n: `gui.creator.page.${id}` })), { current: page, onPick: showPage });
  const rowOf = id => rows.find(x => x.id === id);
  function buildRows() {
    rows = [];
    const add = (pg, id, opt, o = {}) => { opt.el.dataset.row = id; rows.push({ id, page: pg, opt, el: opt.el, ...o }); };
    const look0 = (key, o) => ({ label: t(`gui.creator.row.${key}`), get: () => look[key], set: v => { look[key] = v; rebuild(); }, ...o });
    // (a choice with a name, or a colour: its swatches, and which one it is of how many)
    const named = (pg, key) => { const all = (key === 'hairStyle' && mirror?.styles) || LOOK_OPTIONS[key], text = v => t(`look.${key}.${v}`); add(pg, key, optionRow(look0(key, { values: all.map(([v]) => [v, text(v)]), other: text(all[0][0]) })), { key }); };
    const colours = (pg, key) => { const all = LOOK_OPTIONS[key]; add(pg, key, optionRow(look0(key, { colours: all, values: all.map((c, i) => [c, `${i + 1} / ${all.length}`]), other: '—' })), { key }); rowOf(key).el.classList.add('sw'); };
    // The name, written in its row; and the player's own colour, with the character to see it at once
    const nameEl = document.createElement('div'), nameText = document.createElement('span');
    nameEl.className = 'fe-opt cr-name'; nameText.textContent = t('gui.creator.name');
    nameEl.append(nameText, nameIn);
    nameEl.addEventListener('click', () => nameIn.focus());
    add('cuerpo', 'name', { el: nameEl, refresh() {}, key: () => false }, { hide: () => !!mirror?.barber });
    named('cuerpo', 'sex');
    colours('cuerpo', 'skin');
    named('cuerpo', 'outfit');
    colours('cuerpo', 'cloth');
    add('cuerpo', 'accent', optionRow({ label: t('gui.creator.colour'), colours: ACCENTS, values: ACCENTS.map((_, i) => [i, t(`gui.settings.row.accent.${ACCENT_IDS[i]}`)]),
      get: () => accentOf(nameIn.value || Profile.name, colour), set: n => { colour = n; paintColour(); } }), { hide: () => !!mirror, desc: 'gui.settings.desc.accent' });
    rowOf('accent').el.classList.add('sw');
    named('cara', 'eyeStyle');
    colours('cara', 'eyes');
    named('cara', 'brows');
    named('cara', 'nose');
    // (orejas, mofletes, boca y accesorio del pelo eran de los muñecos de antes: la persona de ahora no los dibuja. Siguen en
    // el look, guardado y por red, pero ya no se ofrecen)
    named('pelo', 'hairStyle');
    colours('pelo', 'hair');
    named('pelo', 'beard');
    // The barber's services and the mirror's beard options: yes or no, with the price when there is one (paintMirror says
    // which, what is on and how much)
    for (const [win, id, run] of MARKS) {
      const m = { on: false, gone: true, text: '', price: document.createElement('b') };
      const opt = optionRow({ label: '', get: () => m.on, set: () => { run(); rebuild(); } });
      m.price.className = 'price'; opt.el.firstChild.after(m.price);
      opt.el.classList.add('mark');
      add('pelo', id, opt, { win, mark: m, hide: () => m.gone });
    }
    L = list($('cr-rows'), rows.map(x => ({ id: x.id, el: x.el })), { hover: 'move', start: -1, onFocus: row => { if (row.id !== 'name' && document.activeElement === nameIn) nameIn.blur(); $('cr-desc').textContent = rowOf(row.id).desc ? t(rowOf(row.id).desc) : ''; } });
  }
  // Which rows are in sight: those of the page (at the barber's, the hair and the face together, without tabs: what is left of
  // the two fits one page) that this window has
  function paintRows() {
    for (const x of rows) {
      const here = mirror?.barber ? x.page !== 'cuerpo' : x.page === page;
      x.el.hidden = !here || (x.win && x.win !== (mirror ? (mirror.barber ? 'barber' : 'mirror') : null)) || !!(x.key && mirror?.hides.includes(x.key)) || !!x.hide?.();
    }
    L.settle();
  }
  function showPage(id) {
    page = id;
    if (document.activeElement === nameIn) nameIn.blur();
    paintRows();
    L.focus(rows.findIndex(x => !x.el.hidden));
    const near = id === 'cara' || !!mirror?.barber || (!!mirror && id === 'pelo');
    preview.focus(near ? 'face' : 'body');
    $('cr-stage').classList.toggle('near', near);
  }
  // Back to the first of its pages
  function firstPage(id) { tabs.pick(id, { silent: true }); showPage(id); }
  function paintColour() { useAccent({ player: { name: nameIn.value || Profile.name }, ui: colour === null ? null : { accent: colour } }); rowOf('accent')?.opt.refresh(); }
  nameIn.addEventListener('input', () => { if (!mirror && colour === null) paintColour(); });
  nameIn.addEventListener('focus', () => L?.focusId('name'));
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') nameIn.blur(); });

  function rebuild() {
    preview.setLook(mirror ? mirrorLook() : look);
    if (mirror) paintMirror();
    for (const x of rows) x.opt.refresh();
  }

  const pickOf = arr => arr[Math.floor(Math.random() * arr.length)];
  $('cr-random').onclick = () => {
    for (const [key, list] of Object.entries(LOOK_OPTIONS)) { if (mirror?.hides.includes(key)) continue; const v = pickOf(list); look[key] = Array.isArray(v) ? v[0] : v; }
    // Barba solo a veces (y no a las chicas), y casi siempre con mofletes
    if (!mirror) look.beard = look.sex === 'chico' && Math.random() < 0.4 ? pickOf(LOOK_OPTIONS.beard.slice(1))[0] : 'no';
    look.cheeks = Math.random() < 0.75;
    rebuild();
  };

  // Girar al personaje: poco a poco mientras se mantiene pulsado un botón de giro o la Z o la C del teclado, o arrastrando
  // sobre él. El texto dice hacia dónde mira (la más cercana de ocho direcciones).
  const SPIN = 2.4;                     // radianes por segundo
  let angle = 0, spin = 0;              // giro y hacia dónde gira ahora (-1, 0 o 1)
  const turnTo = a => {
    angle = a;
    preview.setAngle(angle);
    $('rot-label').textContent = t(`gui.creator.facing.${((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8}`);
  };
  const creatorOpen = () => $('s-creator').classList.contains('show');
  for (const [id, d] of [['rot-l', -1], ['rot-r', 1]]) {
    const b = $(id);
    b.addEventListener('pointerdown', e => { e.preventDefault(); spin = d; b.setPointerCapture?.(e.pointerId); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => { if (spin === d) spin = 0; });
    b.addEventListener('contextmenu', e => e.preventDefault());   // mantener pulsado en el móvil
  }
  const TURN = { KeyZ: -1, KeyC: 1 };
  // The keys of the creator: ↑ ↓ and ← → its rows, Q and E its pages, R at random, Enter finishes (a new character, asking
  // first), Esc and right click go back
  const creatorKeys = { key(e) {
    const a = document.activeElement, row = rows[L.index], enter = /^(Enter|NumpadEnter)$/.test(e.code);
    if ((enter || e.code === 'Space') && a instanceof HTMLButtonElement && $('s-creator').contains(a)) { if (!e.repeat) a.click(); return true; }   // (one that Tab got to)
    if (TURN[e.code]) { spin = TURN[e.code]; return true; }
    if (e.code === 'KeyR') { if (!e.repeat && !$('cr-random').hidden) $('cr-random').click(); return true; }
    if (enter) { if (!e.repeat) { if (row?.id === 'name' && !nameIn.disabled && !nameIn.value.trim()) nameIn.focus(); else finish(); } return true; }
    if (!tabs.el.hidden && tabs.key(e)) return true;
    if (row?.id === 'name' && e.code === 'Space') { if (!nameIn.disabled) { nameIn.focus(); nameIn.select(); } return true; }
    return /^(Arrow(Up|Down)|Key[WS])$/.test(e.code) ? L.key(e) : row?.opt.key(e) || false;
  } };
  async function finish() {
    if (!mirror && nameIn.value.trim() && !(await alertBox({ title: t('gui.creator.start_title'), text: t('gui.creator.start_text', { name: nameIn.value.trim() }), yes: t('gui.creator.start') }))) return;
    if (creatorOpen()) $('cr-start').click();
  }
  function paintCreatorKeys() {
    const I = (k, keys, o) => ({ keys, text: t(`gui.legend.${k}`), ...o }), out = [I('move', ['↑', '↓']), I('change', ['←', '→'])];
    if (!tabs.el.hidden) out.push(I('category', ['Q', 'E']));
    out.push(I('turn', ['Z', 'C']));
    if (!$('cr-random').hidden) out.push(I('random', ['R'], { onClick: () => $('cr-random').click() }));
    out.push({ keys: ['Enter'], text: $('cr-start').textContent, onClick: () => $('cr-start').click() }, I('back', ['Esc'], { onClick: () => FE.back() }));
    legend($('cr-legend'), out);
  }
  let crScreen = null;
  opened['s-creator'] = () => {
    if (!crScreen || crScreen.closed) {
      crScreen = FE.open('s-creator', { root: true, parts: [creatorKeys], keyup: e => { if (!e || spin === TURN[e.code]) spin = 0; }, onClose: () => { spin = 0; },
        back() { if (document.activeElement === nameIn) nameIn.blur(); else leaveCreator(); return true; } });
    }
    paintCreatorKeys();
    fit();
  };
  // The size of the preview: what its side of the screen leaves
  function fit() {
    if (!creatorOpen()) return;
    const box = $('cr-stage').getBoundingClientRect(), h = Math.max(200, Math.min(760, box.height - 66, box.width * 1.25));
    preview.resize(Math.round(h * 0.8), Math.round(h));
  }
  addEventListener('resize', fit);
  addEventListener('blur', () => { spin = 0; });
  const cv = $('cr-canvas');
  let dragX = null;
  cv.addEventListener('pointerdown', e => { dragX = e.clientX; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => { if (dragX === null) return; turnTo(angle + (e.clientX - dragX) * 0.012); dragX = e.clientX; });
  for (const ev of ['pointerup', 'pointercancel']) cv.addEventListener(ev, () => { dragX = null; });

  // The mirror (at a basin) and the barber's window (barber.js): the creator's pages without starting anew. The mirror, free,
  // keeps the face, and shaves, tidies the beard and lets it grow or not; the hair (cut, style and colour) and the beard's
  // shape are Eusebio's, priced (Plan E §4.3, Decision 1a). The clothes change in the backpack. Growth grown meanwhile is
  // applied as the window opens (a hidden moment: body.js §2.5)
  let mirror = null;
  const toggle = k => () => { mirror[k] = !mirror[k]; };
  const MARKS = [
    ['barber', 'cut', toggle('cut')], ['barber', 'trim', toggle('trim')],
    ['mirror', 'shave', () => { mirror.act = mirror.act === 'shave' ? null : 'shave'; }], ['mirror', 'tidy', () => { mirror.act = mirror.act === 'tidy' ? null : 'tidy'; }], ['mirror', 'grow', toggle('grow')],
  ];
  const billEl = $('cr-bill');
  const bill = () => barberBill(game.player.look, look, mirror, game.rep?.buyFactor() ?? 1);
  // What the window would leave: the look chosen, with the growth that stays
  function mirrorLook() {
    const now = game.body?.applied, b = mirror.barber ? bill() : null, out = { ...look, wear: mirror.wear };
    const hair = now && !(b && b.cut) ? now.hair : 0, beard = now && !(b ? b.shave : mirror.act || !mirror.grow) ? now.beard : 0;
    if (!b && mirror.act === 'shave') out.beard = 'no';
    if (hair) out.hairGrow = hair;
    if (beard && look.sex === 'chico') out.beardGrow = beard;
    return out;
  }
  // The marks (pressed, with their prices), the bill and the button
  function paintMirror() {
    const mark = (id, on, text, price = '') => { const x = rowOf(id); x.mark.on = !!on; x.mark.price.textContent = price; x.el.firstChild.textContent = text; }, gone = (id, v) => { rowOf(id).mark.gone = v; };
    const grown = game.body?.applied, male = look.sex === 'chico', bearded = (look.beard || 'no') !== 'no';
    if (mirror.barber) {
      const b = bill(), f = game.rep?.buyFactor() ?? 1, price = ask => t('barber.price', { n: barberBill(game.player.look, game.player.look, ask, f).total }), has = id => b.lines.some(l => l.id === id);
      mark('cut', mirror.cut || has('style'), t('barber.cut'), has('style') ? '' : price({ cut: true }));
      const stubble = !bearded && male && (grown?.beard || 0) > 0;
      gone('cut', false); gone('trim', !bearded && !stubble);
      mark('trim', mirror.trim || has('beard'), t(bearded ? 'barber.trim' : 'mirror.shave'), has('beard') ? '' : price({ trim: true }));
      billEl.textContent = [...b.lines.map(l => `${t('barber.line.' + l.id)}: ${t('barber.price', { n: l.n })}`), t('barber.total', { n: b.total })].join('  ·  ');
      billEl.classList.toggle('poor', b.total > game.money);
      $('cr-err').textContent = b.total > game.money ? t('barber.poor') : '';
      setStartLabel(b.total ? 'barber.pay' : 'gui.creator.done');
    } else {
      const some = bearded || (male && (grown?.beard || 0) > 0);
      gone('shave', !some); gone('tidy', !bearded || !male || !(grown?.beard > 0)); gone('grow', !male);
      mark('shave', mirror.act === 'shave', t('mirror.shave'));
      mark('tidy', mirror.act === 'tidy', t('mirror.tidy'));
      mark('grow', mirror.grow, t('mirror.grow'));
      tabs.btns[2].hidden = !some && !male;   // (no beard to see to: no tab)
      if (tabs.btns[2].hidden && page === 'pelo') firstPage('cara');
    }
    paintRows();
  }
  game.onMirror = (mode = 'mirror') => {
    if (game.mode !== 'play' || !game.player) return false;
    const barber = mode === 'barber', hides = MIRROR_HIDES[barber ? 'barber' : 'mirror'];
    game.body?.applyGrowth();
    game.mode = 'mirror';
    const wear = { ...game.appearance().wear };
    if (barber && wear.cabeza?.id !== 'hijab') delete wear.cabeza;   // (the hat off, to see the hair; a hijab stays on)
    mirror = { wear, hides, barber, cut: false, trim: false, act: null, grow: game.body?.beardGrows !== false, styles: barber ? barberStyles(game.player.look.hairStyle) : null };
    Object.assign(look, DEFAULT_LOOK, game.player.look);
    if (typeof look.beard !== 'string') look.beard = look.beard ? 'completa' : 'no';   // (an old look's true)
    nameIn.value = game.player.name; nameIn.disabled = true;
    $('cr-random').hidden = barber;
    setTitle(barber ? 'barber.title' : 'mirror.title');
    setStartLabel('gui.creator.done');
    billEl.hidden = !barber;
    tabs.el.hidden = barber; tabLabel('mirror.beard');
    $('cr-err').textContent = '';
    spin = 0; turnTo(0); buildRows(); rebuild();
    firstPage('cara');
    show('s-creator');
    return true;
  };
  function setTitle(key) { const h = document.querySelector('#s-creator h2'); h.dataset.i18n = key; applyDom(h); }
  function tabLabel(key) { tabs.btns[2].dataset.i18n = key; applyDom(tabs.btns[2]); }
  // Back to the creator as it is for a new character (also when the game ended with one of these windows open)
  function leaveMirror() {
    mirror = null;
    nameIn.disabled = false; $('cr-random').hidden = false;
    setTitle('gui.creator.title');
    setStartLabel('gui.creator.start');
    billEl.hidden = true;
    tabs.el.hidden = false; tabs.btns[2].hidden = false; tabLabel('gui.creator.page.pelo');
  }
  // The basin (E on a lavabo, game.placedAction): wash your face and hands (body.washFace, src/body.js) or look in the
  // mirror, asked like the bed's menu. Without Body, or with ?cuerpo=0 (no dirt to wash), straight to the mirror as
  // before. With something in the arms the wash is refused (both hands are needed); the mirror is not
  game.onBasin = async () => {
    if (game.mode !== 'play' || !game.player || game.busy || hud.dialogOpen) return;
    const body = game.body;
    if (!body || body.off?.surface || typeof body.washFace !== 'function') { game.onMirror?.(); return; }
    game.busy = true;
    let pick;
    try { pick = await hud.ask(game.player.name, t('body.basin.q'), [t('body.wash_face'), t('body.mirror'), t('body.basin.nothing')]); }
    finally { game.busy = false; }
    if (!game.player || game.mode !== 'play') return;   // (the game ended or a window took over meanwhile)
    if (pick === 0 && !game.carry?.refuse()) body.washFace();
    else if (pick === 1) game.onMirror?.();
  };
  // (the start button says "Done" at the mirror: through its data-i18n key, so a language switch keeps it right)
  function setStartLabel(key) { const b = $('cr-start'); b.dataset.i18n = key; applyDom(b); if (creatorOpen()) paintCreatorKeys(); }
  const closeMirror = apply => {
    const p = game.player, barber = mirror.barber;
    if (apply && barber) {
      // (not enough coins: the window says so and stays, nothing changes)
      if (payBarber(game, look, mirror)) { Audio.error(); $('cr-err').textContent = t('barber.poor'); return; }
      Audio.craft(); save();
    } else if (apply) {
      applyMirror(game, look, mirror); save();
    }
    leaveMirror();
    if (barber && p?.pose?.kind === 'sit') game.rest.stand();   // (up from the chair)
    resume();
  };
  const leaveCreator = () => { if (mirror) closeMirror(false); else { openMenu(); menu.focus('m-new'); } };
  $('cr-back').onclick = leaveCreator;
  $('cr-start').onclick = async () => {
    if (mirror) { closeMirror(true); return; }
    const name = nameIn.value.trim();
    if (!name) { $('cr-err').textContent = t('gui.creator.need_name'); return; }
    // Un personaje nuevo empieza de cero; si ya había partida, el mundo (y los ajustes) se quedan como estaban
    const keep = currentSave && fresh ? Object.fromEntries(WORLD_KEYS.filter(k => k in currentSave).map(k => [k, currentSave[k]])) : {};
    const deltas = currentSave && fresh ? new Map(Profile.data.deltas) : new Map();
    const save = { ...keep, player: { name, look: { ...look }, x: SPAWN.x, y: SPAWN.y, inside: false, view: 'back' }, lang: savedLang(), ...(colour !== null && { ui: { accent: colour } }) };
    await Profile.store(save, deltas, { upload: true });
    fresh = false;
    // Se entra en el mundo; sin servidor, los demás dejan el personaje listo para cuando esté abierto
    openMenu();
    if (Profile.admin || live.status === 'on') enter();
    else $('menu-msg').textContent = t('gui.menu.ready', { admin: ADMIN_NAME });
  };

  let fresh = false;   // (empezando de nuevo con un personaje nuevo, aunque ya hubiera uno)
  function openCreator(again = false) {
    if (mirror) leaveMirror();
    fresh = again;
    nameIn.value = again ? Profile.name || '' : currentSave?.player.name || Profile.name || '';
    colour = Number.isInteger(currentSave?.ui?.accent) ? currentSave.ui.accent : null;   // (yours: a new character keeps it, unless another is chosen)
    $('cr-err').textContent = '';
    spin = 0;
    turnTo(0);
    buildRows();
    rebuild();
    paintColour();
    firstPage('cuerpo');
    show('s-creator');
  }

  // Vista previa animada: camina en el sitio (y gira mientras se mantiene pulsado)
  let last = 0;
  (function animate(t) {
    const dt = Math.min(0.25, (t - last) / 1000 || 0);
    last = t;
    if (creatorOpen()) {
      if (spin) turnTo(angle + spin * SPIN * dt);
      preview.render(t);
    }
    requestAnimationFrame(animate);
  })(0);

  // ---------- Partida ----------
  // Guarda la partida (el jugador y los cambios del mundo), cifrada en este ordenador y, si se pide o hace
  // rato de la última vez, también en GitHub. Devuelve { local, remote } (remote: null si no tocaba subirla).
  // world: si tu juego lleva el mundo compartido, guardarlo también para todos (y, el admin, marcar en su partida
  // cuándo, para saber luego cuál es más reciente)
  const save = async (o = {}) => {
    const r = await saveNow(o);
    if (r?.local || r?.remote) hub?.saved();
    return r;
  };
  const saveNow = async ({ upload = false, world = true } = {}) => {
    if (!game.player || !Profile.id) return { local: false, remote: null };
    if (localMode) return Profile.storeLocal(game.snapshot(), game.world.deltas, { upload });   // (el mundo local: aparte, solo con tu cuenta)
    const snap = game.snapshot(), deltas = game.world.deltas, hosting = world && !live.guest && (live.role === 'host' || Profile.admin);
    if (hosting && game.worldSaving !== false) Profile.storeWorld(live.worldOf(snap, deltas), { upload });   // (/save-off en el terminal lo para)
    // (si el mundo lo lleva otro o vienes de fuera, en tu partida se guarda lo tuyo, con tu mundo de siempre)
    if (live.solo) { const g = live.guestSave(snap, deltas); return Profile.store(g.save, g.deltas, { upload }); }
    return Profile.store({ ...snap, worldAt: hosting ? Date.now() : Profile.data?.save?.worldAt }, deltas, { upload });
  };
  game.onSave = () => save();
  // solo y role: jugando con los demás, tu partida de siempre (si no guardas el mundo en ella) y si lo llevas tú
  function play(data, deltas, solo = null, role = null) {
    show(null);
    // (si la partida no se puede abrir, se vuelve al menú diciendo por qué, en vez de quedarse parado)
    $('fade').classList.add('on');   // (a oscuras hasta que el suelo de alrededor esté hecho: se calcula en otro hilo)
    hub?.reset();
    live.entering = role;   // (ranch.reset: in a world somebody else runs, the horses' locks are true and stay)
    useAccent(data);
    try { game.start(data, deltas); }
    catch (e) { console.error(e); $('fade').classList.remove('on'); live.unclaim(); game.end(); openMenu(); $('menu-msg').textContent = t('gui.menu.enter.open_failed', { why: e.message }); return; }
    finally { live.entering = null; }
    // (destapa esta entrada, salvo si mientras tanto otro ha tapado por su cuenta, un /tp lejos o morir, o se ha salido:
    // entonces destapa él; ver Game.coverJump)
    const mine = game.covers;
    (game.view3d.whenReady?.(2000) || Promise.resolve()).then(() => { if (game.covers === mine) hud.fade(false); });
    if (role && live.net) live.join(solo, role);
    if (role === 'host' || (!role && Profile.admin) || localMode) save({ upload: true });   // (que el mundo quede guardado para los demás cuanto antes)
  }

  setInterval(() => { if (game.mode === 'play' && game.player) save(); }, AUTOSAVE_MS);
  const savedMsg = r => (r.remote ? t('save.done.both') : r.local ? (r.remote === false ? t('save.done.not_github', { why: Profile.lastError }) : t('save.done.here')) : t('save.done.failed'));
  addEventListener('pagehide', () => { if (game.player) save({ upload: live.role === 'host' }); });   // (quien lleva el mundo, lo sube ya: los demás lo necesitan)

  function resume() { game.mode = 'play'; show(null); wins?.placeAll(); }
  function togglePause() {
    if (hub.isOpen) { hub.close(); return true; }
    if (game.mode === 'shop') { resume(); return true; }
    if (game.busy || hud.dialogOpen) return false;   // (hablando, las ventanas no se ven: Esc no las toca)
    if (game.mode === 'play' && $('fade').classList.contains('on')) return false;   // (a oscuras, al entrar o en un salto: la pausa no se vería)
    if (game.mode === 'play' && wins.closeTop()) return true;   // (Esc: primero, la ventana de encima)
    if (game.mode === 'play' && game.build.on) { game.build.toggle(false); return true; }
    return game.mode === 'play' ? hub.open() : false;
  }
  // On one of its tabs at once (M, J, a click on the minimap); with it open there, it closes
  function toggleTab(id) {
    if (hub.isOpen) { if (hub.tab === id) hub.close(); else hub.open(id); return true; }
    if (game.mode !== 'play' || game.busy || hud.dialogOpen) return false;
    if ($('fade').classList.contains('on')) return false;   // (a oscuras, al entrar o en un salto: no se vería)
    return hub.open(id);
  }

  // ---------- Mapa ----------
  // (the pause's Map tab: src/ui/pausehub.js)
  const toggleMap = () => toggleTab('map');
  // (what is round the map, its mouse and its keys: src/ui/mapscreen.js)
  const mapScreen = initMapScreen(game);
  $('minimap').onclick = toggleMap;
  // Pause › Game › Save and quit to menu: after asking
  async function quitToMenu() {
    const g = game.player;
    if (!await alertBox({ title: t('gui.game.quit_title'), text: t('gui.game.quit_text'), yes: t('gui.pause.save_quit') }) || !hub.isOpen || game.player !== g) return;
    const r = await save({ upload: true });
    if (game.player !== g) return;   // (it ended meanwhile: the connection was lost)
    game.end(); openMenu();
    if (r.remote === false) $('menu-msg').textContent = savedMsg(r);
  }

  // ---------- Mochila ----------
  wins = game.windows = initWindows(game);
  const invUI = initInventoryUI(game, { onClose: () => wins.close('s-inv'), onCraft: () => openCraft() });
  const craftUI = initCraftingUI(game, { onClose: () => wins.close('s-craft'), onBag: () => wins.open('s-inv') });
  const chestUI = initChestUI(game, { onClose: () => wins.close('s-chest') });
  let loadMeter = null;   // (the weight inventory, the default: carry.js; made the first time a game has it)
  const bodyChip = game.bodyChip = new BodyChip(game);   // (the chip under the bars, both HUDs: src/ui/bodychip.js)
  let chestAt = null, chestTick = 0;   // (dónde se abrió el cofre: si se aleja, se cierra)
  let chestOpts = null;   // (a window with its own rules: the saddlebags follow the horse, keep() says when it closes)
  const chestDone = () => { const o = chestOpts; chestOpts = null; try { o?.onClose?.(); } catch (e) { reportFault(e, 'chest.onClose'); } };
  wins.add('s-inv', { close: 'inv-close', spot: wins.defaults.left, onOpen: () => invUI.open() });
  wins.add('s-craft', { close: 'cf-close', spot: wins.defaults.right });
  wins.add('s-chest', { close: 'ch-close', spot: wins.defaults.right, onClose: () => { chestAt = null; chestUI.close(); chestDone(); } });
  game.onInventory = () => { invUI.refresh(); craftUI.refresh(); if (wins.isOpen('s-chest')) chestUI.refresh(); };
  const shopUI = initShopUI(game, { onClose: resume });
  const journalUI = initJournalUI(game);
  const toggleJournal = () => toggleTab('journal');   // (the pause's Journal tab)
  // Ajustes: en la pausa, su pestaña (pausehub.js); en el menú principal, su pantalla. Los dos, con lo mismo (#st-body)
  // (your colour: the character's, in its save. Playing, the one who plays; in the main menu, the one of the shared world)
  const accent = {
    who: () => (game.player ? { player: game.player, ui: game.ui } : Profile.data?.save || null),
    set(n) {
      const w = accent.who();
      if (!w?.player || (w.ui?.accent ?? null) === n) return;
      const ui = { ...w.ui };
      if (n === null) delete ui.accent; else ui.accent = n;
      const next = Object.keys(ui).length ? ui : null;
      if (game.player) game.ui = next; else if (next) w.ui = next; else delete w.ui;
      useAccent(accent.who());
      saveSoon();
    },
  };
  settingsUI = initSettingsUI({
    onClose: () => { flushSave(); if (!game.player) menu.use(currentSave, Profile.data?.local?.save || null, 'm-settings'); backToMenu('m-settings'); },
    accent,
    // (Guardado en GitHub: cómo va, el token del admin y la llave del mundo; al recuperarla, se vuelve a conectar con ella)
    extra: (box, head) => {
      const line = text => { const p = document.createElement('p'); p.className = 'note'; p.textContent = text; box.append(p); };
      head(t('gui.settings.account.session'));
      if (!Profile.id) { line(t('gui.settings.account.none')); return; }
      line(t(Profile.admin ? 'gui.settings.account.admin' : 'gui.settings.account.user', { name: Profile.name || Profile.id }));
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn'; b.id = 'st-logout'; b.textContent = t('gui.menu.log_out');
      b.onclick = logOutFromSettings;
      box.append(b);
      saveSettings(box, head, { onKey: () => { setNotice('key-lost', null); live.close(); findLive(); keyReminder(); settingsUI.refresh(); }, onCodeSeen: codeSeen });
    },
  });
  // Los volúmenes se guardan también en tu partida, poco después de dejar de moverlos: jugando, con lo demás;
  // en el menú, en tu partida tal como está (y se sube a GitHub)
  let volumeTimer = null;
  const saveSoon = () => { clearTimeout(volumeTimer); volumeTimer = setTimeout(saveVolumes, 1200); };
  Settings.onVolume = saveSoon;
  function saveVolumes() {
    clearTimeout(volumeTimer); volumeTimer = null;
    if (!Profile.id) return;
    if (game.player) return save();
    const s = Profile.data?.save;
    if (!s) return;
    const done = Profile.store({ ...s, volumes: Settings.volumes() }, new Map(Profile.data.deltas), { upload: true });
    currentSave = Profile.data?.save || null;   // (what Continue opens: with the colour just chosen)
    return done;
  }
  const flushSave = () => (volumeTimer ? saveVolumes() : null);   // (what was about to be saved, now: logging out)
  hub = game.pauseHub = initPauseHub(game, { show, resume, save, savedMsg, quit: quitToMenu, journal: journalUI, settings: settingsUI });
  game.openJournal = (page, id) => hub.journal(page, id);
  game.onShop = id => { if (game.mode !== 'play') return; game.mode = 'shop'; show('s-shop'); shopUI.open(id); };
  // opts (optional): { title() its title, may() may the stacks move now, keep() may it stay open (instead of the distance to
  // where it was opened), onClose() } — the saddlebags (saddlebags.js)
  game.onChest = (chest, tile, onChange, opts = null) => {
    if (!chest || game.mode !== 'play') return;
    if (chestOpts && chestOpts !== opts) chestDone();   // (another one takes the window: the one before is closed)
    chestOpts = opts;
    chestUI.open(chest, tile, onChange, opts || {});
    wins.open('s-chest');
    const p = game.player;
    chestAt = p && !opts?.keep ? [p.x, p.y] : null;
  };
  function toggleInventory() {
    if (game.mode !== 'play' || game.busy || hud.dialogOpen) return false;
    if (wins.isOpen('s-inv')) { wins.close('s-inv'); return true; }
    wins.open('s-inv');
    return true;
  }

  // ---------- Fabricar ----------
  function openCraft(station) {
    if (game.mode !== 'play' || game.busy || hud.dialogOpen) return false;
    wins.open('s-craft');
    craftUI.open(station);
    return true;
  }
  function toggleCraft() {
    if (game.mode === 'play' && !game.busy && !hud.dialogOpen && wins.isOpen('s-craft')) { wins.close('s-craft'); return true; }
    return openCraft();
  }
  game.onCraft = openCraft;

  // Cada fotograma: si te alejas del cofre se cierra
  game.onFrame = () => {
    const p = game.player;
    if (game.inv?.weight) loadMeter ||= initLoadMeter(game);
    loadMeter?.frame();
    try { bodyChip.frame(); } catch (e) { reportFault(e, 'BodyChip.frame'); }   // (isolated: render calls onFrame bare)
    if (chestAt && p && Math.hypot(p.x - chestAt[0], p.y - chestAt[1]) > CHEST_REACH) wins.close('s-chest');
    else if (chestOpts?.keep && wins.isOpen('s-chest') && !chestOpts.keep()) wins.close('s-chest');
    // (lo ha quitado alguien, o lo ha cambiado otro jugador: se cierra o se repinta)
    if (wins.isOpen('s-chest') && ++chestTick % 6 === 0 && !chestUI.check()) wins.close('s-chest');
  };

  // ---------- Inicio ----------
  // ---------- Cuentas (solo el admin, con /account en el chat) ----------
  // /account create y /account reset piden aquí el token de guardado de la cuenta y enseñan su código de invitación
  // (the name goes inside a translated paragraph: a language switch rebuilds it, so it is put back)
  let invitee = '';
  onLangChange(() => { const who = $('ac-who'); if (who) who.textContent = invitee; });   // (?lang=keys has no <b>)
  game.onAccount = (name, reset) => new Promise(resolve => {
    const back = game.mode;
    game.mode = 'account';
    $('ac-title').textContent = reset ? `Token nuevo para ${name}` : `Cuenta nueva: ${name}`;
    $('ac-token').value = ''; $('ac-err').textContent = ''; $('ac-result').hidden = true; $('ac-form').hidden = false;
    show('s-account');
    setTimeout(() => $('ac-token').focus(), 50);
    const close = res => { $('ac-form').onsubmit = $('ac-cancel').onclick = $('ac-close').onclick = null; game.mode = back; show(null); resolve(res); };
    $('ac-cancel').onclick = () => close(null);
    $('ac-form').onsubmit = async e => {
      e.preventDefault();
      if (!$('ac-token').value.trim()) { $('ac-err').textContent = 'Pega el token de guardado.'; return; }
      $('ac-err').textContent = 'Guardando en GitHub…';
      try {
        const r = await Profile.invite(name, $('ac-token').value, reset);
        $('ac-token').value = '';
        $('ac-form').hidden = true; $('ac-result').hidden = false;
        $('ac-who').textContent = invitee = r.name; $('ac-code').textContent = r.code;
        $('ac-close').onclick = () => close(r);
      } catch (err) { $('ac-err').textContent = err.message; }
    };
  });

  async function boot() {
    openLogin();
  }
  // (the Esc that let go of the captured pointer has already opened the pause: not the one that closes it)
  const frontKey = e => (e.code === 'Escape' && FE.active() && performance.now() - aimLock.exitAt < 400 ? true : FE.key(e));
  return { boot, frontKey, togglePause, toggleMap, zoomMap: mapScreen.zoom, toggleInventory, toggleCraft, toggleJournal };
}
