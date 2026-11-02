// Pantallas: inicio de sesión, menú principal, creador de personaje y pausa.
import { Profile } from '../accounts.js';
import { LOOK_OPTIONS, DEFAULT_LOOK } from '../looks.js';
import { CharacterPreview } from '../three/preview.js';
import { SPAWN } from '../world/village.js';
import { hud } from './hud.js';
import { Audio } from '../audio.js';
import { clearKeys } from '../input.js';
import { initInventoryUI } from './inventory.js';
import { initCraftingUI } from './crafting.js';
import { initChestUI } from './chest.js';
import { initShopUI } from './shop.js';
import { initJournalUI } from './journal.js';
import { initSettingsUI } from './settings.js';
import { Settings } from '../settings.js';

const $ = id => document.getElementById(id);
const SCREENS = ['s-login', 's-menu', 's-account', 's-creator', 's-pause', 's-map', 's-inv', 's-craft', 's-chest', 's-shop', 's-journal', 's-settings', 's-controls'];
const AUTOSAVE_MS = 15000;

// Lo de la partida que es del mundo (y los ajustes): se conserva al empezar con un personaje nuevo. Lo demás
// (lo que llevas, dinero, habilidades, recetas, amistades, logros, estadísticas…) es del personaje y se borra
const WORLD_KEYS = ['seed', 'clock', 'house', 'projects', 'boardDone', 'animals', 'farm', 'museum', 'family', 'admin', 'cam3d', 'volumes'];

export function initMenus(game) {
  function show(id) {
    SCREENS.forEach(s => $(s).classList.toggle('show', s === id));
    document.body.classList.toggle('playing', !id);
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
  // Solo hay un mundo: con personaje se continúa la partida (el admin, en su mundo, que es el de todos; los
  // demás, en el del admin, mientras él está jugando) o se empieza otra con un personaje nuevo (avisando de que
  // el de ahora se borra). Sin personaje, se crea.
  let currentSave = null;
  const when = ts => new Date(ts).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  function openMenu() {
    currentSave = Profile.data?.save || null;
    $('menu-hello').textContent = `¡Hola, ${Profile.name}!`;
    $('menu-save').textContent = currentSave ? `Tu personaje: ${currentSave.player.name} · guardado el ${when(currentSave.savedAt)}` : 'Todavía no tienes personaje.';
    $('m-continue').hidden = !currentSave;
    $('m-new').hidden = false;
    $('m-new').textContent = currentSave ? 'Nueva partida' : 'Crear tu personaje';
    $('m-confirm').hidden = true;
    $('menu-msg').textContent = '';
    show('s-menu');
    paintLive();
    findLive();
  }
  $('m-continue').addEventListener('click', () => { if (currentSave) enter(); });
  async function enter() {
    if (Profile.admin) { play(currentSave, new Map(Profile.data.deltas)); return; }
    // Los demás, en el mundo del admin con su personaje (en su partida se guarda lo suyo)
    const b = $('m-continue');
    b.disabled = true;
    $('menu-msg').textContent = `Entrando en el mundo de ${live.host?.name || 'Alberto'}…`;
    try {
      const solo = { save: currentSave, deltas: new Map(Profile.data.deltas) };
      const { save, deltas } = live.enter(solo, await live.requestWorld());
      play(save, deltas);
      live.join(solo);
    } catch (e) { $('menu-msg').textContent = e.message; paintLive(); } finally { if (!game.player) paintLive(); }
  }
  $('m-session').addEventListener('click', () => { live.close(); Profile.logout(); openLogin(); });

  // ---------- Jugar juntos en directo ----------
  // El admin abre su servidor con multijugador.py, que abre el juego con ?servidor=…: su juego se conecta a
  // él como anfitrión y publica la dirección en GitHub. Los demás la buscan ahí al llegar al menú (o la traen
  // en el enlace) y, si el admin está jugando, pueden entrar con él.
  const live = game.live;
  const LIVE_URL = (u => (u && /^wss?:\/\//.test(u) ? u : null))(new URLSearchParams(location.search).get('servidor'));
  let announced = null;
  async function findLive() {
    const url = LIVE_URL || (Profile.admin ? null : (await Profile.liveServer().catch(() => null))?.url);
    if (!url) { live.close(); paintLive(); return; }
    await live.connect(url);
  }
  // El admin publica la dirección en cuanto su juego se conecta a su servidor (por el túnel, no en local)
  function announce() {
    const url = live.url;
    if (Profile.admin && live.status === 'on' && url?.startsWith('wss://') && announced !== url) { announced = url; Profile.announce(url).catch(() => { announced = null; }); }
  }
  // Los demás, mientras están en el menú sin conexión, vuelven a mirar de vez en cuando si el admin ha abierto
  // su servidor (cada vez que lo abre, la dirección es otra)
  setInterval(() => { if (Profile.id && !Profile.admin && !LIVE_URL && $('s-menu').classList.contains('show') && live.status !== 'on' && live.status !== 'nokey') findLive(); }, 30000);
  function paintLive() {
    const host = live.host, s = live.status;
    let msg = '';
    if (Profile.admin) {
      if (s === 'connecting') msg = 'Conectando con tu servidor para jugar juntos…';
      else if (s === 'error') msg = `No se puede conectar con tu servidor para jugar juntos: ${live.error} Sigo intentándolo… (¿está abierto multijugador.py?)`;
      else if (s === 'on') msg = live.others.length ? `Servidor abierto. Conectados: ${live.others.map(p => p.name).join(', ')}.` : 'Servidor abierto: cuando juegues, los demás podrán entrar contigo.';
    } else {
      // Los demás solo pueden jugar mientras el admin está jugando: su mundo es el único que hay
      const name = host?.name || 'Alberto';
      if (s === 'connecting') msg = `Buscando el mundo de ${name}…`;
      else if (s === 'nokey') msg = 'Pidiendo la llave del mundo…';
      else if (host?.playing) msg = `${name} está jugando ahora: ya puedes entrar.`;
      else if (host) msg = `${name} ha abierto el servidor, pero todavía no está jugando.`;
      else msg = `El mundo está cerrado: se abre cuando ${name} está jugando.`;
      $('m-continue').disabled = !host?.playing;
    }
    const open = Profile.admin ? s === 'on' : !!host?.playing;
    $('m-live').hidden = !msg;
    $('m-live').className = s === 'error' && Profile.admin ? 'err' : open ? '' : 'wait';
    $('m-live-msg').textContent = msg;
  }
  live.onChange = () => { announce(); if ($('s-menu').classList.contains('show')) paintLive(); };
  // Si el anfitrión se va, se sale de su mundo (guardando lo tuyo)
  live.onHostLeft = async () => {
    const name = live.hostName || 'El anfitrión', r = await save({ upload: true });
    game.end();
    openMenu();
    $('menu-msg').textContent = `${name} ha salido y se ha cerrado el mundo compartido. Tu personaje y lo que llevas están guardados${r.remote === false ? ' en este ordenador (no en GitHub)' : ''}.`;
  };
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
    if (Profile.admin) { play(Profile.data.save, new Map(Profile.data.deltas)); return; }
    // Los demás entran en el mundo del admin si está jugando; si no, su personaje queda listo para cuando juegue
    openMenu();
    if (live.host?.playing) enter();
    else $('menu-msg').textContent = 'Tu personaje está listo. Podrás entrar en cuanto Alberto esté jugando.';
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
  const save = async ({ upload = false } = {}) => {
    if (!game.player || !Profile.id) return { local: false, remote: null };
    // (en el mundo de otro, en tu partida se guarda lo tuyo, con tu mundo de siempre)
    if (live.guest) { const g = live.guestSave(game.snapshot(), game.world.deltas); return Profile.store(g.save, g.deltas, { upload }); }
    return Profile.store(game.snapshot(), game.world.deltas, { upload });
  };
  game.onSave = () => save();
  function play(data, deltas) {
    show(null);
    game.start(data, deltas);
    if (!Profile.admin && game.admin) game.setAdmin(false);   // el modo admin es solo del admin
    if (Profile.admin && live.net) live.join();   // (el mundo del admin es el de todos)
  }

  setInterval(() => { if (game.mode === 'play' && game.player) save(); }, AUTOSAVE_MS);
  const savedMsg = r => (r.remote ? 'Partida guardada aquí y en GitHub.' : r.local ? `Partida guardada en este ordenador${r.remote === false ? `, pero no en GitHub: ${Profile.lastError}` : ''}.` : 'No se ha podido guardar.');
  addEventListener('pagehide', () => { if (game.player) save(); });

  function resume() { game.mode = 'play'; show(null); }
  function togglePause() {
    if (['map', 'inventory', 'craft', 'chest', 'shop', 'journal'].includes(game.mode)) { resume(); return true; }
    if (game.mode === 'play' && game.build.on) { game.build.toggle(false); return true; }
    if (game.busy || hud.dialogOpen) return false;
    if (game.mode === 'play') { game.mode = 'pause'; $('p-msg').textContent = live.guest ? `Estás en el mundo de ${live.hostName}: el mundo lo guarda su juego, y lo tuyo, tu partida.` : ''; show('s-pause'); return true; }
    if (game.mode === 'pause') { resume(); return true; }
    return false;
  }
  $('p-resume').onclick = resume;
  const soundLabel = () => { $('p-sound').textContent = `Sonido: ${Audio.on ? 'sí' : 'no'}`; };
  $('p-sound').onclick = () => { Audio.toggle(); soundLabel(); };
  soundLabel();

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
  const zoom = d => { game.map.zoom = Math.max(1, Math.min(8, game.map.zoom + d)); };
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
    const s = game.map.scale;
    game.map.scroll(-(e.clientX - drag.x) / s, -(e.clientY - drag.y) / s);
    drag = { x: e.clientX, y: e.clientY };
  });
  const endDrag = () => { drag = null; big.classList.remove('dragging'); };
  big.addEventListener('pointerup', endDrag);
  big.addEventListener('pointercancel', endDrag);
  big.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1 : -1); }, { passive: false });
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
