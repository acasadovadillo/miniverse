// Pantallas: menú principal, creador de personaje y pausa.
import { Profile } from '../accounts.js';
import { Saves } from '../save.js';
import { LOOK_OPTIONS, DEFAULT_LOOK } from '../looks.js';
import { CharacterPreview } from '../three/preview.js';
import { SPAWN } from '../world/village.js';
import { hud } from './hud.js';
import { Audio } from '../audio.js';
import { clearKeys } from '../input.js';
import { WorldStore } from '../worldstore.js';
import { initInventoryUI } from './inventory.js';
import { initCraftingUI } from './crafting.js';
import { initChestUI } from './chest.js';
import { initShopUI } from './shop.js';
import { initJournalUI } from './journal.js';
import { initSettingsUI } from './settings.js';
import { exportGame, readExport, importGame } from '../share.js';

const $ = id => document.getElementById(id);
const SCREENS = ['s-menu', 's-creator', 's-pause', 's-map', 's-inv', 's-craft', 's-chest', 's-shop', 's-journal', 's-settings', 's-controls'];
const AUTOSAVE_MS = 15000;

export function initMenus(game) {
  function show(id) {
    SCREENS.forEach(s => $(s).classList.toggle('show', s === id));
    document.body.classList.toggle('playing', !id);
  }

  // ---------- Menú principal ----------
  let currentSave = null;
  const when = ts => new Date(ts).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  async function openMenu() {
    currentSave = await Saves.load(Profile.id);
    $('menu-hello').textContent = currentSave ? `¡Hola, ${currentSave.player.name}!` : '¡Hola!';
    $('menu-save').textContent = currentSave ? `Partida de ${currentSave.player.name} · guardada el ${when(currentSave.savedAt)}` : 'Todavía no tienes ninguna partida.';
    $('m-continue').disabled = !currentSave;
    $('m-continue').classList.toggle('primary', !!currentSave);
    $('m-new').classList.toggle('primary', !currentSave);
    $('m-export').disabled = !currentSave;
    $('menu-msg').textContent = '';
    show('s-menu');
  }
  $('m-continue').addEventListener('click', async () => { if (currentSave) play(currentSave, await WorldStore.load(Profile.id)); });
  $('m-new').addEventListener('click', () => {
    if (currentSave && !confirm('Empezar una partida nueva borrará la que tienes guardada. ¿Seguro?')) return;
    openCreator();
  });

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
    preview.setLook(look);
    rows.forEach(r => r());
  }
  function addRow(page, title, el) {
    const wrap = document.createElement('div');
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
    addRow(page, title, box);
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
    addRow(page, title, box);
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
    addRow(page, title, box);
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
  cycRow('pelo', 'Peinado', 'hairStyle');
  swRow('pelo', 'Color de pelo', 'hair');
  cycRow('pelo', 'Barba', 'beard');

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

  $('cr-back').onclick = () => openMenu();
  $('cr-start').onclick = async () => {
    const name = $('cr-name').value.trim();
    if (!name) { $('cr-err').textContent = 'Ponle un nombre a tu personaje.'; return; }
    const save = { player: { name, look: { ...look }, x: SPAWN.x, y: SPAWN.y, inside: false, view: 'back' } };
    await WorldStore.clear(Profile.id);   // la partida nueva empieza sin cambios en el mundo
    await Saves.write(Profile.id, save);
    play(save, new Map());
  };

  function openCreator() {
    $('cr-name').value = currentSave?.player.name || '';
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
  // Guarda la partida y los trozos del mundo que han cambiado
  const save = async () => {
    if (game.visiting) return false;   // de visita en el mundo de otra persona no se guarda nada
    const ok = await Saves.write(Profile.id, game.snapshot());
    try { await game.flush(Profile.id); } catch (e) { console.error(e); return false; }
    return ok;
  };
  game.onSave = save;
  function play(data, deltas, visiting = false) {
    show(null);
    game.visiting = visiting;
    game.start(data, deltas);
    if (visiting) hud.toast('Modo visita: puedes explorar, pero no se guarda nada');
  }

  // ---------- Exportar, importar y visitar ----------
  $('m-export').onclick = async () => { $('menu-msg').textContent = (await exportGame(Profile.id)) ? 'Partida exportada: busca el archivo en tus descargas.' : 'No hay partida que exportar.'; };
  const pickFile = () => new Promise(resolve => { const i = $('file-pick'); i.value = ''; i.onchange = () => resolve(i.files[0]); i.click(); });
  $('m-import').onclick = async () => {
    const file = await pickFile();
    if (!file) return;
    try {
      const data = await readExport(file);
      if (currentSave && !confirm('Importar sustituye tu partida actual por la del archivo. ¿Seguro?')) return;
      await importGame(Profile.id, data);
      await openMenu();
      $('menu-msg').textContent = `Partida de ${data.save.player.name} importada.`;
    } catch (e) { $('menu-msg').textContent = e.message; }
  };
  $('m-visit').onclick = async () => {
    const file = await pickFile();
    if (!file) return;
    try { const data = await readExport(file); play(data.save, data.deltas, true); } catch (e) { $('menu-msg').textContent = e.message; }
  };
  setInterval(() => { if (game.mode === 'play' && game.player) save(); }, AUTOSAVE_MS);
  addEventListener('pagehide', () => { if (game.player) save(); });

  function resume() { game.mode = 'play'; show(null); }
  function togglePause() {
    if (['map', 'inventory', 'craft', 'chest', 'shop', 'journal'].includes(game.mode)) { resume(); return true; }
    if (game.mode === 'play' && game.build.on) { game.build.toggle(false); return true; }
    if (game.busy || hud.dialogOpen) return false;
    if (game.mode === 'play') { game.mode = 'pause'; $('p-msg').textContent = game.visiting ? 'Estás de visita: no se guarda nada.' : ''; show('s-pause'); return true; }
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
  $('p-save').onclick = async () => { $('p-msg').textContent = (await save()) ? 'Partida guardada.' : 'No se ha podido guardar.'; };
  $('p-menu').onclick = async () => { await save(); game.end(); game.visiting = false; openMenu(); };

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
  initSettingsUI({ onClose: () => { const back = settingsBack; settingsBack = null; show(back); } });
  const openSettings = from => { settingsBack = from; show('s-settings'); };
  $('p-settings').onclick = () => openSettings('s-pause');
  $('m-settings').onclick = () => openSettings('s-menu');
  game.onShop = id => { if (game.mode !== 'play') return; game.mode = 'shop'; show('s-shop'); shopUI.open(id); };
  game.onChest = (chest, tile) => {
    if (!chest || game.mode !== 'play') return;
    game.mode = 'chest';
    show('s-chest');
    chestUI.open(chest, tile);
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
  async function boot() {
    await Profile.init();
    openMenu();
  }
  return { boot, togglePause, toggleMap, zoomMap: zoom, toggleInventory, toggleCraft, toggleJournal };
}
