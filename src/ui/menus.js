// Pantallas: inicio de sesión, menú principal, creador de personaje y pausa.
import { Profile } from '../accounts.js';
import { LOOK_OPTIONS, DEFAULT_LOOK } from '../looks.js';
import { CharacterPreview } from '../three/preview.js';
import { SPAWN } from '../world/village.js';
import { hud } from './hud.js';
import { clearKeys } from '../input.js';
import { initInventoryUI } from './inventory.js';
import { initCraftingUI } from './crafting.js';
import { initChestUI } from './chest.js';
import { initShopUI } from './shop.js';
import { initJournalUI } from './journal.js';
import { initSettingsUI } from './settings.js';
import { Settings } from '../settings.js';
import { SHARED } from '../livesync.js';

const $ = id => document.getElementById(id);
const SCREENS = ['s-login', 's-menu', 's-account', 's-creator', 's-pause', 's-map', 's-inv', 's-craft', 's-chest', 's-shop', 's-journal', 's-settings', 's-controls'];
const AUTOSAVE_MS = 15000;
const ADMIN_NAME = 'Alberto';   // (el dueño del mundo, que abre el servidor)

// Lo de la partida que es del mundo (y los ajustes): se conserva al empezar con un personaje nuevo. Lo demás
// (lo que llevas, dinero, habilidades, recetas, amistades, logros, estadísticas…) es del personaje y se borra
const WORLD_KEYS = ['seed', 'clock', 'house', 'projects', 'boardDone', 'animals', 'farm', 'museum', 'family', 'dayBase', 'timeShift', 'seenDay', 'rules', 'worldSpawn', 'weatherLock', 'difficulty', 'maps', 'defaultGamemode', 'frozenHour', 'worldAt', 'cam3d', 'volumes'];

export function initMenus(game) {
  function show(id) {
    SCREENS.forEach(s => $(s).classList.toggle('show', s === id));
    document.body.classList.toggle('playing', !id);
  }

  // ---------- Contraseñas: un ojo para verlas u ocultarlas ----------
  const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/></svg>';
  for (const input of document.querySelectorAll('.field input[type="password"]')) {
    const wrap = document.createElement('span'), eye = document.createElement('button');
    wrap.className = 'pw';
    eye.type = 'button'; eye.className = 'pw-eye';
    const paint = () => { const shown = input.type === 'text'; eye.innerHTML = shown ? EYE_OFF : EYE; eye.setAttribute('aria-label', shown ? 'Ocultar' : 'Mostrar'); eye.title = shown ? 'Ocultar' : 'Mostrar'; eye.setAttribute('aria-pressed', String(shown)); };
    eye.addEventListener('mousedown', e => e.preventDefault());   // (sin quitarle el foco al campo)
    eye.addEventListener('click', () => { input.type = input.type === 'password' ? 'text' : 'password'; paint(); });
    input.replaceWith(wrap);
    wrap.append(input, eye);
    paint();
  }

  // ---------- Inicio de sesión ----------
  // Según el usuario hace falta su contraseña; la primera vez, además, su código de invitación (y repetir la
  // contraseña nueva); y para crear la cuenta de admin, su token de GitHub.
  let step = null, stepUser = '';
  const ROWS = { login: [], invite: ['lg-code-row', 'lg-pass2-row'], setup: ['lg-pass2-row', 'lg-token-row'] };
  function setStep(s) {
    step = s;
    for (const id of ['lg-code-row', 'lg-pass2-row', 'lg-token-row']) $(id).hidden = !ROWS[s || 'login'].includes(id);
    $('lg-submit').textContent = s === 'setup' ? 'Crear la cuenta de admin' : 'Entrar';
    $('lg-pass').autocomplete = s === 'login' || !s ? 'current-password' : 'new-password';
  }
  function openLogin() {
    setStep(null);
    for (const id of ['lg-pass', 'lg-pass2', 'lg-code', 'lg-token']) $(id).value = '';
    $('lg-err').textContent = '';
    show('s-login');
  }
  $('lg-user').addEventListener('input', () => { if (step) { setStep(null); $('lg-err').textContent = ''; } });
  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const user = $('lg-user').value.trim(), pass = $('lg-pass').value, say = m => { $('lg-err').textContent = m; };
    if (!user) return say('Escribe tu usuario.');
    if (!pass) return say('Escribe tu contraseña.');
    $('lg-submit').disabled = true;
    try {
      if (!step || stepUser !== user) {
        say('Buscando tu cuenta…');
        const s = await Profile.check(user);
        stepUser = user;
        if (s === 'unknown') { setStep(null); return say('Ese usuario no existe.'); }
        setStep(s);
        if (s === 'invite') return say('Es tu primera vez: escribe el código de invitación y repite tu contraseña nueva.');
        if (s === 'setup') return say('Todavía no existe la cuenta de admin: repite tu contraseña y pega tu token de admin de GitHub.');
      }
      say('Abriendo tus datos…');
      const err = step === 'invite' ? await Profile.activate(user, $('lg-code').value, pass, $('lg-pass2').value)
        : step === 'setup' ? await Profile.setup(pass, $('lg-pass2').value, $('lg-token').value)
        : await Profile.login(user, pass);
      if (err) return say(err);
      Settings.useVolumes(Profile.data?.save?.volumes);   // (los volúmenes de tu partida)
      openMenu();
    } catch (err) { say(err.message); } finally { $('lg-submit').disabled = false; }
  });

  // ---------- Menú principal ----------
  // Solo hay un mundo, el de todos: con personaje se continúa la partida (en el mundo compartido; los demás, con
  // el servidor abierto, aunque el admin no esté) o se empieza otra con un personaje nuevo (avisando de que el de
  // ahora se borra). Sin personaje, se crea.
  let currentSave = null;
  const when = ts => new Date(ts).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  function openMenu() {
    currentSave = Profile.data?.save || null;
    $('menu-hello').textContent = `¡Hola, ${Profile.name}!`;
    $('menu-save').textContent = currentSave ? `Tu personaje: ${currentSave.player.name} · guardado el ${when(currentSave.savedAt)}` : 'Todavía no tienes personaje.';
    $('m-continue').hidden = !currentSave;
    $('m-continue').disabled = false;   // (al volver de jugar; sin servidor, los demás no pueden: lo dice paintLive)
    $('m-new').hidden = false;
    $('m-new').textContent = currentSave ? 'Nueva partida' : 'Crear tu personaje';
    $('m-confirm').hidden = true;
    $('menu-msg').textContent = '';
    show('s-menu');
    paintLive();
    findLive();
  }
  $('m-continue').addEventListener('click', () => { if (currentSave) enter(); });
  // Entrar en el mundo: si alguien lo lleva, en el suyo; si no, lo lleva tu juego (con el servidor abierto, los
  // demás entran contigo). Sin servidor solo puede jugar el admin. En tu partida se guarda lo tuyo; el mundo, quien
  // lo lleva lo guarda para todos.
  async function enter() {
    const b = $('m-continue'), solo = { save: currentSave, deltas: new Map(Profile.data.deltas) };
    b.disabled = true;
    try {
      if (live.status === 'kicked') { live.close(); await findLive(); }   // (te echaron: se vuelve a intentar entrar)
      const on = live.status === 'on';
      if (!on && !Profile.admin) throw new Error(`El servidor está cerrado: se puede jugar cuando ${ADMIN_NAME} lo abre.`);
      if (on && !live.host?.playing && !(await live.claim())) await live.waitHost();
      if (on && live.status !== 'on') throw new Error(live.error || 'Se ha cortado la conexión con el servidor.');   // (te han echado o vetado mientras)
      if (on && live.host?.playing) {
        $('menu-msg').textContent = live.host.server ? 'Entrando en el mundo…' : `Entrando en el mundo con ${live.host.name}…`;
        const { save, deltas } = live.enter(solo, await live.requestWorld());
        play(save, deltas, solo, 'guest');
        return;
      }
      $('menu-msg').textContent = 'Abriendo el mundo…';
      const world = await sharedWorld(solo);
      if (on && live.status !== 'on') throw new Error(live.error || 'Se ha cortado la conexión con el servidor.');
      if (world) { const { save, deltas } = live.enter(solo, world); play(save, deltas, Profile.admin ? null : solo, on ? 'host' : null); }
      else play(currentSave, solo.deltas, null, on ? 'host' : null);   // (el admin, con el mundo de su partida)
    } catch (e) { live.unclaim(); $('menu-msg').textContent = e.message; } finally { if (!game.player) { b.disabled = false; paintLive(); } }
  }
  // El mundo compartido como lo guardó la última vez quien lo llevaba. El admin, si el de su partida es más
  // reciente (o aún no se ha guardado aparte), juega con ese: null
  async function sharedWorld(solo) {
    let w;
    try { w = await Profile.loadWorld(); } catch (e) { throw new Error(`No se ha podido traer el mundo compartido: ${e.message}`); }
    if (Profile.admin && (!w || (w.savedAt || 0) <= (solo.save.worldAt || 0))) return null;
    if (!w) throw new Error(`El mundo compartido todavía no está guardado: ${ADMIN_NAME} tiene que entrar una vez para dejarlo listo.`);
    return w;
  }
  $('m-session').addEventListener('click', () => { live.close(); Profile.logout(); openLogin(); });

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
    let msg = '';
    if (s === 'kicked') msg = live.error;
    else if (s === 'on' && host?.server) msg = playing.length ? `Servidor abierto: el mundo está en marcha. Ahora juega${playing.length > 1 ? 'n' : ''}: ${playing.join(', ')}. Al entrar, jugaréis juntos.`
      : 'Servidor abierto: el mundo está en marcha (lo lleva el servidor). Puedes entrar cuando quieras.';
    else if (s === 'on') msg = host?.playing ? `Servidor abierto. Ahora juega${playing.length > 1 ? 'n' : ''}: ${playing.join(', ')}. Al entrar, jugaréis juntos.`
      : Profile.admin ? 'Servidor abierto: los demás pueden entrar en el mundo cuando quieran, aunque tú no estés jugando.'
      : 'Servidor abierto: puedes entrar en el mundo aunque no haya nadie más jugando.';
    else if (Profile.admin) {
      if (s === 'connecting') msg = 'Conectando con tu servidor para jugar juntos…';
      else if (s === 'error' && LIVE_URL) msg = `No se puede conectar con tu servidor para jugar juntos: ${live.error} Sigo intentándolo… (¿está abierto multijugador.py?)`;
    } else {
      // Los demás solo pueden jugar con el servidor abierto: el mundo, el de todos, solo está ahí
      if (s === 'connecting') msg = 'Buscando el servidor del mundo…';
      else if (s === 'nokey') msg = `Pidiendo la llave del mundo… (te la da el juego de ${ADMIN_NAME} la próxima vez que entre)`;
      else msg = `El servidor está cerrado: se puede jugar cuando ${ADMIN_NAME} lo abre.`;
    }
    if (!Profile.admin) $('m-continue').disabled = s !== 'on' && s !== 'kicked';   // (echado: al pulsar, se vuelve a intentar)
    const open = s === 'on';
    $('m-live').hidden = !msg;
    $('m-live').className = s === 'kicked' || (s === 'error' && Profile.admin) ? 'err' : open ? '' : 'wait';
    $('m-live-msg').textContent = msg;
  }
  live.onChange = () => { announce(); if ($('s-menu').classList.contains('show')) paintLive(); };
  // Si hay que salir del mundo compartido (se ha cortado la conexión, u otro ya lo llevaba), se guarda lo tuyo
  // (y, si lo llevabas y no es que otro lo llevara ya, el mundo) y se vuelve al menú
  live.onHostLeft = async (why, text) => {
    const r = await save({ upload: true, world: why !== 'conflict' });
    game.end();
    openMenu();
    const kept = `Tu personaje y lo que llevas están guardados${r.remote === false ? ' en este ordenador (no en GitHub)' : ''}.`;
    $('menu-msg').textContent = why === 'conflict' ? `Otro juego ya llevaba el mundo compartido: vuelve a entrar para jugar juntos. ${kept}`
      : why === 'kicked' || why === 'stop' ? `${text} ${kept}` : `Se ha cortado la conexión con el mundo compartido. ${kept}`;
  };
  // El servidor pide guardar ya (/save-all en su terminal); y cada vez que se sube el mundo, una copia para él
  live.onServerSave = () => save({ upload: true });
  Profile.onWorldBytes = bytes => live.backup(bytes);
  // Tu juego pasa a llevar el mundo (se ha ido quien lo llevaba): se guarda ya para todos. Y deja de llevarlo
  // porque llega el mundo del servidor: se guarda lo tuyo
  live.onHost = () => save({ upload: true });
  live.onYield = () => save({ upload: true });
  // Nueva partida: antes, un aviso (se borra el personaje de ahora; el mundo, no). Sin personaje, al creador
  const confirming = on => { $('m-confirm').hidden = !on; for (const id of ['m-continue', 'm-new']) $(id).hidden = on || (id === 'm-continue' && !currentSave); };
  $('m-new').addEventListener('click', () => (currentSave ? confirming(true) : openCreator()));
  $('m-confirm-no').addEventListener('click', () => confirming(false));
  $('m-confirm-yes').addEventListener('click', () => { confirming(false); openCreator(true); });

  // ---------- Creador de personaje ----------
  // (la vista previa es el mismo modelo en 3D que en el juego)
  const look = { ...DEFAULT_LOOK };
  const preview = new CharacterPreview($('cr-canvas'));
  const rows = [];

  // Pestañas: cuerpo y ropa, cara y pelo (en la de la cara, la cámara se acerca a la cabeza)
  const PAGES = [['cuerpo', 'Cuerpo'], ['cara', 'Cara'], ['pelo', 'Pelo']];
  const pages = {};
  const tabs = document.createElement('div');
  tabs.className = 'tabs cr-tabs';
  for (const [id, label] of PAGES) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.dataset.page = id;
    b.onclick = () => showPage(id);
    tabs.append(b);
    pages[id] = document.createElement('div');
    pages[id].className = 'cr-page';
  }
  $('cr-opts').append(tabs, ...Object.values(pages));
  function showPage(id) {
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.page === id);
    for (const [k, el] of Object.entries(pages)) el.hidden = k !== id;
    preview.focus(id === 'cara' ? 'face' : 'body');
  }

  function rebuild() {
    preview.setLook(mirror ? { ...look, wear: mirror.wear } : look);
    rows.forEach(r => r());
  }
  function addRow(page, title, el, key) {
    const wrap = document.createElement('div');
    if (key) wrap.dataset.key = key;
    wrap.innerHTML = `<div class="opt-t">${title}</div>`;
    wrap.append(el);
    pages[page].append(wrap);
  }
  function segRow(page, title, key) {
    const box = document.createElement('div');
    box.className = 'seg';
    for (const [value, label] of LOOK_OPTIONS[key]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.onclick = () => { look[key] = value; rebuild(); };
      box.append(b);
    }
    rows.push(() => [...box.children].forEach((b, i) => b.classList.toggle('on', LOOK_OPTIONS[key][i][0] === look[key])));
    addRow(page, title, box, key);
  }
  function cycRow(page, title, key) {
    const box = document.createElement('div');
    box.className = 'cyc';
    box.innerHTML = '<button type="button" class="sq" aria-label="Anterior">◀</button><span></span><button type="button" class="sq" aria-label="Siguiente">▶</button>';
    const [prev, next] = box.querySelectorAll('button'), label = box.querySelector('span'), list = LOOK_OPTIONS[key];
    const step = d => { const i = list.findIndex(([v]) => v === look[key]); look[key] = list[(i + d + list.length) % list.length][0]; rebuild(); };
    prev.onclick = () => step(-1);
    next.onclick = () => step(1);
    rows.push(() => { label.textContent = (list.find(([v]) => v === look[key]) || list[0])[1]; });
    addRow(page, title, box, key);
  }
  function swRow(page, title, key) {
    const box = document.createElement('div');
    box.className = 'sw';
    for (const col of LOOK_OPTIONS[key]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = col;
      b.setAttribute('aria-label', title);
      b.onclick = () => { look[key] = col; rebuild(); };
      box.append(b);
    }
    rows.push(() => [...box.children].forEach((b, i) => b.classList.toggle('on', LOOK_OPTIONS[key][i] === look[key])));
    addRow(page, title, box, key);
  }
  segRow('cuerpo', 'Sexo', 'sex');
  swRow('cuerpo', 'Tono de piel', 'skin');
  cycRow('cuerpo', 'Ropa', 'outfit');
  swRow('cuerpo', 'Color de la ropa', 'cloth');
  cycRow('cara', 'Ojos', 'eyeStyle');
  swRow('cara', 'Color de ojos', 'eyes');
  cycRow('cara', 'Cejas', 'brows');
  cycRow('cara', 'Nariz', 'nose');
  cycRow('cara', 'Orejas', 'ears');
  segRow('cara', 'Mofletes', 'cheeks');
  cycRow('cara', 'Boca', 'mouth');
  cycRow('pelo', 'Peinado', 'hairStyle');
  swRow('pelo', 'Color de pelo', 'hair');
  cycRow('pelo', 'Barba', 'beard');
  cycRow('pelo', 'Accesorio', 'hairAcc');
  swRow('pelo', 'Color del accesorio', 'accColor');

  const pickOf = arr => arr[Math.floor(Math.random() * arr.length)];
  $('cr-random').onclick = () => {
    for (const [key, list] of Object.entries(LOOK_OPTIONS)) { const v = pickOf(list); look[key] = Array.isArray(v) ? v[0] : v; }
    // Barba solo a veces (y no a las chicas), y casi siempre con mofletes
    look.beard = look.sex === 'chico' && Math.random() < 0.4 ? pickOf(LOOK_OPTIONS.beard.slice(1))[0] : 'no';
    look.cheeks = Math.random() < 0.75;
    rebuild();
  };

  // Girar al personaje: poco a poco mientras se mantiene pulsado un botón de giro o una flecha (← →) del
  // teclado, o arrastrando sobre él. El texto dice hacia dónde mira (la más cercana de ocho direcciones).
  const FACING = ['De frente', 'Frente derecha', 'Perfil derecho', 'Espalda derecha', 'De espaldas', 'Espalda izquierda', 'Perfil izquierdo', 'Frente izquierda'];
  const SPIN = 2.4;                     // radianes por segundo
  let angle = 0, spin = 0;              // giro y hacia dónde gira ahora (-1, 0 o 1)
  const turnTo = a => {
    angle = a;
    preview.setAngle(angle);
    $('rot-label').textContent = FACING[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8];
  };
  const creatorOpen = () => $('s-creator').classList.contains('show');
  for (const [id, d] of [['rot-l', -1], ['rot-r', 1]]) {
    const b = $(id);
    b.addEventListener('pointerdown', e => { e.preventDefault(); spin = d; b.setPointerCapture?.(e.pointerId); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => { if (spin === d) spin = 0; });
    b.addEventListener('contextmenu', e => e.preventDefault());   // mantener pulsado en el móvil
  }
  const ARROWS = { ArrowLeft: -1, ArrowRight: 1 };
  addEventListener('keydown', e => {
    if (!creatorOpen() || !ARROWS[e.code] || e.target instanceof HTMLInputElement) return;
    spin = ARROWS[e.code];
    e.preventDefault();
  });
  addEventListener('keyup', e => { if (spin && spin === ARROWS[e.code]) spin = 0; });
  addEventListener('blur', () => { spin = 0; });
  const cv = $('cr-canvas');
  let dragX = null;
  cv.addEventListener('pointerdown', e => { dragX = e.clientX; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => { if (dragX === null) return; turnTo(angle + (e.clientX - dragX) * 0.012); dragX = e.clientX; });
  for (const ev of ['pointerup', 'pointercancel']) cv.addEventListener(ev, () => { dragX = null; });

  // El espejo (en el lavabo): cambiarse la cara y el pelo sin empezar de nuevo (la ropa y los accesorios se
  // cambian en la mochila). Al terminar se vuelve al juego
  let mirror = null;
  const MIRROR_HIDES = ['outfit', 'cloth', 'hairAcc', 'accColor'];
  game.onMirror = () => {
    if (game.mode !== 'play' || !game.player) return;
    game.mode = 'mirror';
    mirror = { wear: game.appearance().wear };
    Object.assign(look, DEFAULT_LOOK, game.player.look);
    $('cr-name').value = game.player.name; $('cr-name').disabled = true;
    $('cr-start').textContent = 'Listo';
    for (const el of document.querySelectorAll('#s-creator [data-key]')) el.hidden = MIRROR_HIDES.includes(el.dataset.key);
    $('cr-err').textContent = '';
    spin = 0; turnTo(0); rebuild();
    const w = Math.max(160, Math.min(240, innerWidth - 80));
    preview.resize(w, Math.round(w * 1.25));
    showPage('cara');
    show('s-creator');
  };
  const closeMirror = apply => {
    if (apply) { const keepOut = ['outfit', 'cloth', 'pants', 'hairAcc', 'accColor']; game.player.look = { ...game.player.look, ...Object.fromEntries(Object.entries(look).filter(([k]) => !keepOut.includes(k))) }; game.inv.changed(); save(); }
    mirror = null;
    $('cr-name').disabled = false; $('cr-start').textContent = 'Empezar';
    for (const el of document.querySelectorAll('#s-creator [data-key]')) el.hidden = false;
    resume();
  };
  $('cr-back').onclick = () => (mirror ? closeMirror(false) : openMenu());
  $('cr-start').onclick = async () => {
    if (mirror) { closeMirror(true); return; }
    const name = $('cr-name').value.trim();
    if (!name) { $('cr-err').textContent = 'Ponle un nombre a tu personaje.'; return; }
    // Un personaje nuevo empieza de cero; si ya había partida, el mundo (y los ajustes) se quedan como estaban
    const keep = currentSave && fresh ? Object.fromEntries(WORLD_KEYS.filter(k => k in currentSave).map(k => [k, currentSave[k]])) : {};
    const deltas = currentSave && fresh ? new Map(Profile.data.deltas) : new Map();
    const save = { ...keep, player: { name, look: { ...look }, x: SPAWN.x, y: SPAWN.y, inside: false, view: 'back' } };
    await Profile.store(save, deltas, { upload: true });
    fresh = false;
    // Se entra en el mundo; sin servidor, los demás dejan el personaje listo para cuando esté abierto
    openMenu();
    if (Profile.admin || live.status === 'on') enter();
    else $('menu-msg').textContent = `Tu personaje está listo. Podrás entrar cuando ${ADMIN_NAME} abra el servidor.`;
  };

  let fresh = false;   // (empezando de nuevo con un personaje nuevo, aunque ya hubiera uno)
  function openCreator(again = false) {
    fresh = again;
    $('cr-name').value = again ? Profile.name || '' : currentSave?.player.name || Profile.name || '';
    $('cr-err').textContent = '';
    spin = 0;
    turnTo(0);
    rebuild();
    const w = Math.max(160, Math.min(240, innerWidth - 80));
    preview.resize(w, Math.round(w * 1.25));
    showPage('cuerpo');
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
  const save = async ({ upload = false, world = true } = {}) => {
    if (!game.player || !Profile.id) return { local: false, remote: null };
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
    try { game.start(data, deltas); }
    catch (e) { console.error(e); $('fade').classList.remove('on'); live.unclaim(); game.end(); openMenu(); $('menu-msg').textContent = `No se ha podido abrir la partida: ${e.message}`; return; }
    (game.view3d.whenReady?.(2000) || Promise.resolve()).then(() => hud.fade(false));
    if (role && live.net) live.join(solo, role);
    if (role === 'host' || (!role && Profile.admin)) save({ upload: true });   // (que el mundo quede guardado para los demás cuanto antes)
  }

  setInterval(() => { if (game.mode === 'play' && game.player) save(); }, AUTOSAVE_MS);
  const savedMsg = r => (r.remote ? 'Partida guardada aquí y en GitHub.' : r.local ? `Partida guardada en este ordenador${r.remote === false ? `, pero no en GitHub: ${Profile.lastError}` : ''}.` : 'No se ha podido guardar.');
  addEventListener('pagehide', () => { if (game.player) save({ upload: live.role === 'host' }); });   // (quien lleva el mundo, lo sube ya: los demás lo necesitan)

  function resume() { game.mode = 'play'; show(null); }
  function togglePause() {
    if (['map', 'inventory', 'craft', 'chest', 'shop', 'journal'].includes(game.mode)) { resume(); return true; }
    if (game.mode === 'play' && game.build.on) { game.build.toggle(false); return true; }
    if (game.busy || hud.dialogOpen) return false;
    if (game.mode === 'play') { game.mode = 'pause'; $('p-msg').textContent = live.guest ? `El mundo compartido lo lleva ${live.host?.server ? 'el servidor' : `ahora el juego de ${live.hostName}`}: lo guarda él para todos, y lo tuyo, tu partida.` : live.role === 'host' && !Profile.admin ? 'El mundo compartido lo lleva ahora tu juego: se guarda para todos.' : ''; show('s-pause'); return true; }
    if (game.mode === 'pause') { resume(); return true; }
    return false;
  }
  $('p-resume').onclick = resume;

  // ---------- Mapa ----------
  function toggleMap() {
    if (game.mode === 'map') { resume(); return true; }
    if (game.mode !== 'play' || game.busy || hud.dialogOpen || game.player?.inside) return false;
    game.mode = 'map';
    game.map.recenter();
    clearKeys();
    show('s-map');
    return true;
  }
  const zoom = (d, x, y) => game.map.zoomAt(d, x, y);
  $('map-in').onclick = () => zoom(1);
  $('map-out').onclick = () => zoom(-1);
  $('map-close').onclick = resume;
  $('map-home').onclick = () => game.map.recenter();
  $('minimap').onclick = toggleMap;
  // Arrastrar con el ratón (o el dedo) mueve el mapa
  const big = $('bigmap');
  let drag = null;
  big.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; big.setPointerCapture(e.pointerId); big.classList.add('dragging'); });
  big.addEventListener('pointermove', e => {
    if (!drag) return;
    game.map.scroll(-(e.clientX - drag.x), -(e.clientY - drag.y));
    drag = { x: e.clientX, y: e.clientY };
  });
  const endDrag = () => { drag = null; big.classList.remove('dragging'); };
  big.addEventListener('pointerup', endDrag);
  big.addEventListener('pointercancel', endDrag);
  // La rueda acerca hacia donde está el ratón (lo que se mueve poco a poco, como un trackpad, se va sumando)
  let wheel = 0;
  big.addEventListener('wheel', e => {
    e.preventDefault();
    wheel += e.deltaMode ? e.deltaY * 40 : e.deltaY;
    if (Math.abs(wheel) < 40) return;
    zoom(wheel < 0 ? 1 : -1, e.clientX, e.clientY);
    wheel = 0;
  }, { passive: false });
  $('map-legend').open = innerWidth > 700;   // (en una pantalla estrecha, plegada)
  $('p-save').onclick = async () => { $('p-msg').textContent = 'Guardando…'; $('p-msg').textContent = savedMsg(await save({ upload: true })); };
  $('p-menu').onclick = async () => {
    const r = await save({ upload: true });
    game.end(); openMenu();
    if (r.remote === false) $('menu-msg').textContent = savedMsg(r);
  };

  // ---------- Mochila ----------
  const invUI = initInventoryUI(game, { onClose: resume, onCraft: () => openCraft() });
  const craftUI = initCraftingUI(game, { onClose: resume, onBag: () => { resume(); toggleInventory(); } });
  const chestUI = initChestUI(game, { onClose: resume });
  game.onInventory = () => { invUI.refresh(); craftUI.refresh(); if (game.mode === 'chest') chestUI.refresh(); };
  const shopUI = initShopUI(game, { onClose: resume });
  const journalUI = initJournalUI(game, { onClose: resume });
  function toggleJournal() {
    if (game.mode === 'journal') { resume(); return true; }
    if (game.mode === 'pause') game.mode = 'play';
    if (game.mode !== 'play' || game.busy || hud.dialogOpen) return false;
    game.mode = 'journal';
    show('s-journal');
    journalUI.open();
    return true;
  }
  $('p-journal').onclick = toggleJournal;
  // Controles: una sección de la pausa
  $('p-controls').onclick = () => show('s-controls');
  $('ct-close').onclick = () => show('s-pause');
  // Ajustes: desde la pausa o desde el menú principal (vuelve a donde estaba)
  let settingsBack = null;
  const settingsUI = initSettingsUI({ onClose: () => { const back = settingsBack; settingsBack = null; show(back); } });
  const openSettings = from => { settingsBack = from; settingsUI.refresh(); show('s-settings'); };
  // Los volúmenes se guardan también en tu partida, poco después de dejar de moverlos: jugando, con lo demás;
  // en el menú, en tu partida tal como está (y se sube a GitHub)
  let volumeTimer = null;
  Settings.onVolume = () => { clearTimeout(volumeTimer); volumeTimer = setTimeout(saveVolumes, 1200); };
  function saveVolumes() {
    if (!Profile.id) return;
    if (game.player) { save(); return; }
    const s = Profile.data?.save;
    if (s) Profile.store({ ...s, volumes: Settings.volumes() }, new Map(Profile.data.deltas), { upload: true });
  }
  $('p-settings').onclick = () => openSettings('s-pause');
  $('m-settings').onclick = () => openSettings('s-menu');
  game.onShop = id => { if (game.mode !== 'play') return; game.mode = 'shop'; show('s-shop'); shopUI.open(id); };
  game.onChest = (chest, tile, onChange) => {
    if (!chest || game.mode !== 'play') return;
    game.mode = 'chest';
    show('s-chest');
    chestUI.open(chest, tile, onChange);
  };
  function toggleInventory() {
    if (game.mode === 'inventory') { resume(); return true; }
    if (game.mode === 'craft') game.mode = 'play';
    if (game.mode !== 'play' || game.busy || hud.dialogOpen) return false;
    game.mode = 'inventory';
    show('s-inv');
    invUI.open();
    return true;
  }

  // ---------- Fabricar ----------
  function openCraft(station) {
    if (game.mode === 'inventory') game.mode = 'play';
    if (game.mode !== 'play' || game.busy || hud.dialogOpen) return false;
    game.mode = 'craft';
    show('s-craft');
    craftUI.open(station);
    return true;
  }
  function toggleCraft() {
    if (game.mode === 'craft') { resume(); return true; }
    return openCraft();
  }
  game.onCraft = openCraft;

  // ---------- Inicio ----------
  // ---------- Cuentas (solo el admin, con /account en el chat) ----------
  // /account create y /account reset piden aquí el token de guardado de la cuenta y enseñan su código de invitación
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
        $('ac-who').textContent = r.name; $('ac-code').textContent = r.code;
        $('ac-close').onclick = () => close(r);
      } catch (err) { $('ac-err').textContent = err.message; }
    };
  });

  async function boot() {
    openLogin();
  }
  return { boot, togglePause, toggleMap, zoomMap: zoom, toggleInventory, toggleCraft, toggleJournal };
}
