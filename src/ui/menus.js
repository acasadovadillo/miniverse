// Pantallas: cuenta, menú principal, creador de personaje y pausa.
import { Accounts } from '../accounts.js';
import { Saves } from '../save.js';
import { SW, SH, LOOK_OPTIONS, DEFAULT_LOOK, personSprites } from '../art/people3.js';
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
const SCREENS = ['s-login', 's-menu', 's-creator', 's-pause', 's-map', 's-inv', 's-craft', 's-chest', 's-shop', 's-journal', 's-settings', 's-controls'];
const AUTOSAVE_MS = 15000;

export function initMenus(game) {
  function show(id) {
    SCREENS.forEach(s => $(s).classList.toggle('show', s === id));
    document.body.classList.toggle('playing', !id);
  }

  // ---------- Cuenta ----------
  let tab = 'login';
  function setTab(t) {
    tab = t;
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $('lg-pass2-row').hidden = t !== 'register';
    $('lg-submit').textContent = t === 'login' ? 'Entrar' : 'Crear cuenta';
    $('lg-pass').autocomplete = t === 'login' ? 'current-password' : 'new-password';
    $('lg-err').textContent = '';
  }
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const user = $('lg-user').value, pass = $('lg-pass').value, keep = $('lg-remember').checked;
    const err = tab === 'login' ? await Accounts.login(user, pass, keep) : await Accounts.register(user, pass, $('lg-pass2').value, keep);
    if (err) { $('lg-err').textContent = err; return; }
    $('lg-pass').value = $('lg-pass2').value = '';
    openMenu();
  });

  // ---------- Menú principal ----------
  let currentSave = null;
  const when = ts => new Date(ts).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  async function openMenu() {
    currentSave = await Saves.load(Accounts.id);
    $('menu-hello').textContent = `¡Hola, ${Accounts.user}!`;
    $('menu-save').textContent = currentSave ? `Partida de ${currentSave.player.name} · guardada el ${when(currentSave.savedAt)}` : 'Todavía no tienes ninguna partida.';
    $('m-continue').disabled = !currentSave;
    $('m-continue').classList.toggle('primary', !!currentSave);
    $('m-new').classList.toggle('primary', !currentSave);
    $('m-export').disabled = !currentSave;
    $('menu-msg').textContent = '';
    show('s-menu');
  }
  $('m-continue').addEventListener('click', async () => { if (currentSave) play(currentSave, await WorldStore.load(Accounts.id)); });
  $('m-new').addEventListener('click', () => {
    if (currentSave && !confirm('Empezar una partida nueva borrará la que tienes guardada. ¿Seguro?')) return;
    openCreator();
  });
  $('m-logout').addEventListener('click', () => { Accounts.logout(); setTab('login'); show('s-login'); });

  // ---------- Creador de personaje ----------
  const look = { ...DEFAULT_LOOK };
  const ROT = [['down', false, 'De frente'], ['front', false, 'Frente derecha'], ['side', false, 'Perfil derecho'], ['back', false, 'Espalda derecha'],
    ['up', false, 'De espaldas'], ['back', true, 'Espalda izquierda'], ['side', true, 'Perfil izquierdo'], ['front', true, 'Frente izquierda']];
  let rot = 0, sprites = personSprites(look);
  const preview = $('cr-canvas'), pg = preview.getContext('2d');
  preview.width = SW;
  preview.height = SH;
  const rows = [];

  function rebuild() {
    sprites = personSprites(look);
    rows.forEach(r => r());
  }
  function addRow(title, el) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="opt-t">${title}</div>`;
    wrap.append(el);
    $('cr-opts').append(wrap);
  }
  function segRow(title, key) {
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
    addRow(title, box);
  }
  function cycRow(title, key) {
    const box = document.createElement('div');
    box.className = 'cyc';
    box.innerHTML = '<button type="button" class="sq" aria-label="Anterior">◀</button><span></span><button type="button" class="sq" aria-label="Siguiente">▶</button>';
    const [prev, next] = box.querySelectorAll('button'), label = box.querySelector('span'), list = LOOK_OPTIONS[key];
    const step = d => { const i = list.findIndex(([v]) => v === look[key]); look[key] = list[(i + d + list.length) % list.length][0]; rebuild(); };
    prev.onclick = () => step(-1);
    next.onclick = () => step(1);
    rows.push(() => { label.textContent = list.find(([v]) => v === look[key])[1]; });
    addRow(title, box);
  }
  function swRow(title, key) {
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
    addRow(title, box);
  }
  segRow('Sexo', 'sex');
  cycRow('Peinado', 'hairStyle');
  swRow('Color de pelo', 'hair');
  swRow('Tono de piel', 'skin');
  cycRow('Ropa', 'outfit');
  swRow('Color de la ropa', 'cloth');

  const pickOf = arr => arr[Math.floor(Math.random() * arr.length)];
  $('cr-random').onclick = () => {
    look.sex = pickOf(LOOK_OPTIONS.sex)[0];
    look.hairStyle = pickOf(LOOK_OPTIONS.hairStyle)[0];
    look.hair = pickOf(LOOK_OPTIONS.hair);
    look.skin = pickOf(LOOK_OPTIONS.skin);
    look.outfit = pickOf(LOOK_OPTIONS.outfit)[0];
    look.cloth = pickOf(LOOK_OPTIONS.cloth);
    rebuild();
  };
  const turn = d => { rot = (rot + d + ROT.length) % ROT.length; $('rot-label').textContent = ROT[rot][2]; };
  $('rot-l').onclick = () => turn(-1);
  $('rot-r').onclick = () => turn(1);
  $('cr-back').onclick = () => openMenu();
  $('cr-start').onclick = async () => {
    const name = $('cr-name').value.trim();
    if (!name) { $('cr-err').textContent = 'Ponle un nombre a tu personaje.'; return; }
    const save = { player: { name, look: { ...look }, x: SPAWN.x, y: SPAWN.y, inside: false, view: 'back' } };
    await WorldStore.clear(Accounts.id);   // la partida nueva empieza sin cambios en el mundo
    await Saves.write(Accounts.id, save);
    play(save, new Map());
  };

  function openCreator() {
    $('cr-name').value = Accounts.user || '';
    $('cr-err').textContent = '';
    rot = 0;
    turn(0);
    rebuild();
    const scale = Math.max(3, Math.min(5, Math.floor(Math.min(240, innerWidth - 80) / SW)));
    preview.style.width = SW * scale + 'px';
    preview.style.height = SH * scale + 'px';
    show('s-creator');
  }

  // Vista previa animada: camina en el sitio
  (function animate(t) {
    if ($('s-creator').classList.contains('show')) {
      const [view, flip] = ROT[rot];
      const img = sprites[view][1 + (Math.floor(t / 150) % 4)];
      pg.clearRect(0, 0, SW, SH);
      if (flip) { pg.save(); pg.translate(SW, 0); pg.scale(-1, 1); pg.drawImage(img, 0, 0); pg.restore(); } else pg.drawImage(img, 0, 0);
    }
    requestAnimationFrame(animate);
  })(0);

  // ---------- Partida ----------
  // Guarda la partida y los trozos del mundo que han cambiado
  const save = async () => {
    if (game.visiting) return false;   // de visita en el mundo de otra persona no se guarda nada
    const ok = await Saves.write(Accounts.id, game.snapshot());
    try { await game.flush(Accounts.id); } catch (e) { console.error(e); return false; }
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
  $('m-export').onclick = async () => { $('menu-msg').textContent = (await exportGame(Accounts.id)) ? 'Partida exportada: busca el archivo en tus descargas.' : 'No hay partida que exportar.'; };
  const pickFile = () => new Promise(resolve => { const i = $('file-pick'); i.value = ''; i.onchange = () => resolve(i.files[0]); i.click(); });
  $('m-import').onclick = async () => {
    const file = await pickFile();
    if (!file) return;
    try {
      const data = await readExport(file);
      if (currentSave && !confirm('Importar sustituye tu partida actual por la del archivo. ¿Seguro?')) return;
      await importGame(Accounts.id, data);
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
    if (await Accounts.init()) openMenu();
    else { setTab('login'); show('s-login'); }
  }
  return { boot, togglePause, toggleMap, zoomMap: zoom, toggleInventory, toggleCraft, toggleJournal };
}
