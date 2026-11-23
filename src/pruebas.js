// Pruebas automáticas del juego. Las lanza probar.py en un Chrome invisible con ?modo=pruebas: el juego arranca con
// una cuenta de prueba (sin contraseña ni GitHub: nada se guarda fuera de este navegador) y una partida nueva, y va
// haciendo lo básico (recolectar, pisotear la tierra labrada, el hambre, el pueblo seguro, los primeros pasos, fabricar, colocar, cofres, puertas, comandos, mapas, cocos, la noria, las
// casas de los animales, las vallas, guardar y cargar) comprobando que pasa lo que tiene que pasar. Cada prueba se cuenta a probar.py (POST /pruebas) y sale
// también en la consola. Con &parte=dos&relay=ws://…, dos juegos (quien=a, el anfitrión, y quien=b, el invitado)
// comparten un mundo por el relay de pruebas y comprueban que cada uno ve lo que pone el otro.
// Con &only=<expresión>, solo las pruebas cuyo nombre la cumple (y la de carga): para probar a mano lo que se ha tocado
// sin pasar la batería entera (p. ej. &only=cuevas|fallos|ganchos). Al acabar, el resumen también va en document.title.
import * as THREE from 'three';
import { Profile } from './accounts.js';
import { RealPerson } from './three/realperson.js';
import { distTo, dirOf, obb, bounds } from './world/fit.js';
import { CAM, lookBy } from './camera.js';
import { keys, clearKeys, pressW, releaseW, dropSprint, gaitOf, TAP_WINDOW, TAP_GAP, TAP_HOLD, pressShift, releaseShift, shiftTick, shiftWithOther, SHIFT_HOLD } from './input.js';
import { ITEMS, HARVEST, hitsFor, CHESTS } from './items.js';
import { SHOPS } from './economy.js';
import { repairMat } from './crafting.js';
import { RECIPES } from './recipes.js';
import { runCommand } from './commands.js';
import { faults, resetFaults } from './faults.js';
import { CHUNK, WorldGen } from './world/gen.js';
import { B, BIOMES, climate } from './world/biomes.js';
import { packBd, unpackBd } from './body.js';
import { feelOf, TEMP, clothesOf } from './clothing.js';
import { paintPixels, blockHeights, groundSmooth, groundTag } from './world/ground.js';
import { retireItems } from './game.js';
import { HOUSE, HOUSES, POND, YARD, BOUNDS, BOARD, CENTER, TAVERN, inBounds } from './world/village.js';
import { collide as collideNow } from './physics.js';
import { STEPS } from './steps.js';
import { machineAt, settle, MACHINES } from './machines.js';
import { hud } from './ui/hud.js';
import { freePlace } from './gather.js';
import { PIECE_IDS } from './build.js';
import { BUILDABLE, PLANS, PLANS_V, PLAN_BORN } from './buildables.js';
import { PIECES, parsePlaced } from './pieces.js';
import { diffChunk, applyOps, ItemSync, COLLECTIONS } from './livesync.js';
import { wallTile } from './three/build3d.js';
import { itemIcon } from './art/items.js';
import { PREY, bodyBox } from './hunt.js';
import { priceOf, buyPrice } from './economy.js';
import { levelOf, recent } from './reputation.js';
import { EMOTE_KINDS, PLAYER_LINES, REPLY_GESTURE } from './social.js';
import { modelKind, ICON3D } from './three/icons.js';
import { useSmartHud } from './ui/smarthud.js';
import { Settings } from './settings.js';
import { View3D } from './three/engine.js';
import { sobrio, tonosSuelo } from './arte.js';
import { tintOf } from './three/tints.js';
import { PHOTOS, photo } from './three/photos.js';
import { Inventory, HOTBAR } from './inventory.js';
import { WeightInventory, Carry, weightMode } from './carry.js';
import { BULKY, BULKY_PARTS, CARCASS_OF, weightOf, BASE_CAP, BAG_CAP, BARROW, CENTER_AHEAD, WHEEL_AHEAD } from './carry-items.js';
import { Barrow } from './barrow.js';
import { GAME_VERSION } from './version.js';
import { Player, barrowPen, GAIT } from './entities.js';
import { horseModel, animateHorse, horseCadence } from './three/animals.js';
import { screenToWorld } from './camera.js';
import { makeCave } from './world/underground.js';
import { START_KIT, thirstOf, clothesText } from './items.js';
import { stackKg, SIP_KG } from './carry-items.js';
import { extraOf } from './inventory.js';
import { WATER_Y } from './world/planet.js';
import { RELIEF_V } from './world/ground.js';
import { kitOf, kitKey, placeKit, shownOf, splitKit, kindOf, SCABBARD } from './kit.js';
import { buildKit } from './three/kit3d.js';
import { holdPose } from './three/carry3d.js';
import * as C3 from './three/carry3d.js';   // (pushPose, if the drawing has it: the wheelbarrow's cost)
import { stowedGeo } from './three/actors.js';
import { t, tHtml, tList, fmt, formatMessage, defineNames, noun, setLang, getLang, onLangChange, accountLangOf, setAccountLang, savedLang, decideFirst, applyDom } from './i18n.js';
import { findPath, KIND as RKIND, LIMITS as RLIMITS, releasePool, chunkMask, OVR as ROVR } from './world/routegrid.js';
import { MAX_VERTS as RIBBON_MAX, OFF as RIBBON_OFF, STILL_S as RIBBON_STILL, routeGround } from './three/route3d.js';
import { musicState, pickMood, bandOf, TAVERN_VENUE, BAND_R } from './musicstate.js';
import { Music, LegacyMusic, DynamicMusic, Conductor } from './music.js';
import { Voices, MAX_VOICES, renderPart } from './musicvoices.js';
import { SCORES, barS, unitS, stingerNotes, resolveScore } from './musicscore.js';
import { apagada } from './opciones.js';
import { NORTH, HALF as PHALF, nearX } from './world/planet.js';
import { DOOR, PLAZA, distToPath, doorOf, getProjects, familyHouse } from './world/village.js';

const GATE_X = 20;   // (el hueco de la valla del jardín, en el camino)
const q = new URLSearchParams(location.search), WHO = q.get('quien') || 'a', RELAY = q.get('relay'), PART = q.get('parte') || 'solo';   // parte: 'solo' (un jugador), 'dos' o 'mirar' (sin pruebas: el juego con la cuenta de prueba, para verlo)
const ONLY = q.get('only') ? new RegExp(q.get('only'), 'i') : null;   // (solo esas pruebas: ver arriba)
const LOOK = { sex: 'chica', hairStyle: 'trenzas', hair: '#2a1e1e', skin: '#c98a5a', outfit: 'delantal', cloth: '#b84a8a', pants: '#4a3a2a', eyes: '#3a2a1e' };
const TEST_TIMEOUT = 60000, LOAD_TIMEOUT = 90000;
const results = [];
let errors = [];

const sleep = ms => new Promise(r => setTimeout(r, ms));
// El bucle lo llevan las pruebas, no el navegador: en el Chrome invisible el dibujo va por software y los fotogramas
// no se pueden fiar. frames(n) hace avanzar la simulación n pasos (de 60 por segundo) y dibuja de vez en cuando;
// entre medias deja pasar los mensajes (del hilo del suelo, del relay)
const STEP = 1 / 60, DRAW_EVERY = 120;   // (un dibujo cada dos segundos de juego: por software, cada uno cuesta)
let step = () => {}, draw = () => {}, stepped = 0;
async function frames(n) {
  for (let i = 0; i < n; i++) { step(STEP); if (++stepped % DRAW_EVERY === 0) draw(); }
  await sleep(0);
}
async function until(fn, ms = 10000, what = 'algo') {
  const t0 = performance.now();
  let said = t0;
  while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await frames(3); if (performance.now() - said > 5000) { said = performance.now(); console.log(`… esperando ${what} (${Math.round((said - t0) / 1000)} s)`); } }
  throw new Error(`Esperando ${what}: ${ms} ms y nada`);
}
// Dibujar hasta que el suelo de alrededor de la cámara esté hecho (lo calcula el hilo aparte)
async function readyGround(game, ms = 8000) {
  const t0 = performance.now(), T = game.view3d.terrain, p = game.player;
  while (performance.now() - t0 < ms) { draw(); await sleep(20); if (T.ready(p.x, p.y)) return true; }
  return false;
}
// El estado del dibujo y del suelo (para contarlo si algo falla)
function health(game) {
  const T = game.view3d.terrain;
  const f = faults.last;   // (los fallos de cada sistema no llegan a updateError: van aislados, ver faults.js)
  return `${game.updateError ? `FALLO al avanzar: ${game.updateError}; ` : ''}${game.renderError ? `FALLO al dibujar: ${game.renderError}; ` : ''}${f ? `último fallo: ${f.where}: ${f.message}${f.place}; ` : ''}modo ${game.mode}${game.busy ? ' (ocupado)' : ''}; suelo: ${T.blocks.size} bloques, ${T.pending.size} pedidos, ${T.jobs.size} trabajos, ${T.workers.length} hilos`;
}
const check = (cond, what) => { if (!cond) throw new Error(what); };

function tell(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' · ' + detail : ''}`);
  fetch('/pruebas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ who: WHO, name, ok, detail }) }).catch(() => {});
}
async function test(name, fn) {
  if (ONLY && !ONLY.test(name) && !/^carga/.test(name)) return;
  const before = errors.length;
  resetFaults();   // (un fallo que ya salió en otra prueba se vuelve a decir entero en la consola, y cuenta en esta)
  console.log(`▶ ${name}`);   // (con probar.py --ver se ve por dónde va cada juego)
  try {
    const limit = /carga|^dos:/.test(name) ? LOAD_TIMEOUT : TEST_TIMEOUT;   // (lo que espera a otro juego o al primer dibujo, más)
    await Promise.race([fn(), sleep(limit).then(() => { throw new Error(`más de ${limit / 1000} s`); })]);
    const errs = errors.slice(before);
    tell(name, !errs.length, errs.length ? `fallos: ${errs.join(' | ')}` : '');
  } catch (e) { tell(name, false, e.message); }
}

// Una cuenta de prueba, sin GitHub: la clave del mundo es fija (los dos juegos de las pruebas comparten mundo)
async function mockProfile(game) {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(7), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const admin = WHO === 'a';
  Object.defineProperties(Profile, { id: { get: () => `prueba_${WHO}`, configurable: true }, name: { get: () => (admin ? 'Ana' : 'Bea'), configurable: true }, admin: { get: () => admin, configurable: true } });
  Profile.worldKey = () => Promise.resolve(key);
  Profile.store = () => Promise.resolve({ local: false, remote: null });
  Profile.storeWorld = () => Promise.resolve();
  game.onSave = null;
}
const fresh = () => ({ player: { name: WHO === 'a' ? 'Ana' : 'Bea', x: 21, y: 26, look: { ...LOOK } } });

// ---------- ayudas con el mundo ----------
// Lo más cercano de una clase (árbol, roca, arbusto…) alrededor de un punto, mirando trozo a trozo
function findKind(game, kinds, x, y, rings = 12) {
  const w = game.world, cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
  for (let r = 0; r <= rings; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const o = w.contentFor(cx + dx, cy + dy).objects.find(o => kinds.includes(o.kind) && !o.poi);
    if (o) return o;
  }
  return null;
}
async function goTo(game, x, y) { game.teleport(x, y); await readyGround(game, 6000); await frames(3); }
function selectTool(game, tool) {
  const i = game.inv.slots.findIndex(s => s && ITEMS[s.id]?.tool === tool);
  check(i >= 0, `no llevo ${tool}`);
  game.inv.select(i);
}
// Golpear lo que hay en (x, y) con la herramienta hasta que desaparezca
async function harvest(game, o, tool) {
  const p = game.player, w = game.world;
  selectTool(game, tool);
  p.x = o.x + 0.8; p.y = o.y; p.face = { x: -1, y: 0 }; p.vx = p.vy = 0;
  await frames(2);
  const alive = () => w.harvestablesNear(o.x, o.y).some(k => k.key === o.key);
  for (let i = 0; i < 20 && alive(); i++) { game.gather.cooldown = 0; game.gather.target = game.gather.pickTarget(); check(game.gather.target?.obj, `no apunto a ${o.kind}`); game.gather.use(); await frames(2); }
  check(!alive(), `${o.kind} sigue ahí`);
  await collectDrops(game);
}
// Recoger lo que ha caído (vuela hasta el jugador si está cerca; con el ordenador lento tarda, y lo que cae lejos no
// vendría: se va a por ello)
async function collectDrops(game, what = 'a recoger lo que ha caído') {
  await until(() => { const d = game.gather.drops[0]; if (d) { game.player.x = d.x; game.player.y = d.y; } return !game.gather.drops.length; }, 30000, what);
}
// The weight inventory, the default (carry.js): a felled tree or a hunted adult leaves its big thing lying there (a log,
// a carcass). Opened where it lies, as a player would (the axe splits the log, X butchers the carcass), it gives its
// things as before. Nothing to do with the slot inventory (?inventario=casillas), or if there was no room for it (then
// its things fell as before). true: there was one
function openBig(game, x, y, r = 3) {
  const C = game.carry;
  if (!C?.bigNow) return false;
  const o = (game.scene.placedNear?.(x, y, r) || []).filter(q => BULKY[q.placed]).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
  if (!o) return false;
  if (BULKY[o.placed].prey) C.butcher(o);
  else { selectTool(game, 'hacha'); for (let i = 0; i < 3; i++) { game.gather.cooldown = 0; C.split(o); } }
  return true;
}
function freeTile(game, from) {
  const w = game.world, p = game.player;
  for (const [tx, ty] of from) if (w.canPlace(tx, ty, 'cofre', p)) return [tx, ty];
  throw new Error('no hay casilla libre para colocar');
}

// Hold item id: into the selected hotbar slot if it is in the bag (a fuller hotbar since the canteen joined the start kit)
function holdItem(I, id) {
  let i = I.slots.findIndex(s => s?.id === id);
  check(i >= 0, `no ${id}`);
  if (i >= HOTBAR) { const j = I.selected; [I.slots[j], I.slots[i]] = [I.slots[i], I.slots[j]]; I.changed(); i = j; }
  I.select(i);
}

// ---------- las pruebas de un jugador ----------
const W_place = (game, x, y, id) => game.world.place(x, y, id);
async function soloTests(game) {
  const p = () => game.player, inv = () => game.inv, w = () => game.world;
  await test('carga: el juego arranca y el suelo está hecho', async () => {
    check(game.mode === 'play' && p(), 'no hay partida');
    const ok = await readyGround(game, 60000);   // (el primer dibujo por software compila todos los materiales: tarda)
    check(ok, `el suelo de alrededor no está hecho (${health(game)})`);
    const home = game.view3d.terrain.blocks.get(`${Math.floor(p().x / 64)},${Math.floor(p().y / 64)}`);
    check(home?.waterMesh, 'el estanque del pueblo no tiene agua (malla de agua del bloque)');
    await frames(60);
    check(game.time > 0.9, 'la simulación no avanza');
    console.log(health(game));
  });
  await test('idioma (language): the static HTML in Spanish as before, hot switch, t(), articles and plurals', async () => {
    const $ = id => document.getElementById(id), eq = (got, want, what) => check(got === want, `${what}: "${got}" instead of "${want}"`);
    eq(getLang(), 'es', 'language of the tests');
    // The Spanish of index.html, letter by letter as it was before the language system
    const OLD = { 'p-resume': 'Continuar', 'p-menu': 'Guardar y salir al menú', 'm-continue': 'Continuar partida', 'm-session': 'Cerrar sesión', 'cf-make': 'Fabricar', 'inv-drop1': 'Tirar uno',
      'inv-lock': 'Sin mochila solo llevas lo que cabe en las manos y los bolsillos. Fabrica una (C, a mano: fibra y cuerda) y póntela.', 'aim-free': 'Haz clic para mover la cámara con el ratón' };
    for (const [id, text] of Object.entries(OLD)) eq($(id).textContent, text, `#${id}`);
    for (const [id, attr, text] of [['chat-input', 'placeholder', 'Escribe un mensaje o un comando (/help)'], ['love-heart', 'title', 'Tener un bebé'], ['map-home', 'aria-label', 'Volver a tu posición'], ['inv-del', 'title', 'Modo admin: lo quita para siempre, sin tirarlo']]) eq($(id).getAttribute(attr), text, `#${id} ${attr}`);
    eq($('lg-user').closest('label').textContent, 'Usuario', 'the user field');
    eq(document.querySelector('#s-controls dt[data-i18n-html="controls.interact.keys"]').innerHTML, '<kbd>E</kbd> o <kbd>Enter</kbd>', 'controls: E');
    eq($('ac-result').querySelector('p').innerHTML, 'Pásale a <b id="ac-who"></b> este código de invitación. Lo necesitará la primera vez, junto a la contraseña que elija:', 'the invite');
    // Hot switch: every translated node changes, and coming back gives exactly the same Spanish
    const snap = () => [...document.querySelectorAll('[data-i18n],[data-i18n-html],[data-i18n-attr]')].map(el => [el.dataset.i18n ? el.textContent : '', el.dataset.i18nHtml ? el.innerHTML : '', ...['title', 'aria-label', 'placeholder'].map(a => el.getAttribute(a))].join('|')).join('\n');
    const es = snap();
    let fired = 0;
    const off = onLangChange(() => fired++);
    check(await setLang('en'), 'cannot switch to English');
    eq(document.documentElement.lang, 'en', '<html lang>');
    eq($('p-resume').textContent, 'Back to game', '#p-resume in English');
    eq($('chat-input').placeholder, 'Type a message or a command (/help)', 'the chat in English');
    eq(fired, 1, 'langchange events');
    check(game.mode === 'play' && !game.updateError, 'the game stopped while switching');
    // English grammar
    eq(formatMessage('{x, a}', { x: { name: 'Anvil' } }), 'an anvil', 'a/an');
    eq(formatMessage('{x, a}', { x: { name: 'Unicorn', an: false } }), 'a unicorn', 'a/an exception');
    eq(formatMessage('{x, a}', { x: { name: 'Wood', mass: true } }), 'wood', 'mass noun');
    // (a message never throws, whatever it is given: a number or nothing as a noun, an empty name, odd case names)
    eq(formatMessage('{x, the}', { x: 5 }), 'the 5', 'a number as a noun');
    eq(formatMessage('[{x, Lower}]', { x: '' }), '[]', 'an empty noun');
    eq(formatMessage('{x, select, a {A} other {B}}', { x: 'constructor' }), 'B', 'select on "constructor"');
    eq(formatMessage('{constructor}', {}), '{constructor}', 'a parameter named "constructor"');
    eq(formatMessage('{n, plural, one {# day} other {# days}}', {}), '{n}', 'a missing plural parameter shows');
    // The start button of the creator says "Done" at the mirror, in the current language
    const start = $('cr-start'), startKey = start.dataset.i18n;
    start.dataset.i18n = 'gui.creator.done'; applyDom(start);
    eq(start.textContent, 'Done', 'the mirror button');
    start.dataset.i18n = startKey; applyDom(start);
    eq(start.textContent, 'Start', 'the creator button');
    eq(formatMessage('{x, The} is here', { x: { name: 'Anvil' } }), 'The anvil is here', 'capital article');
    eq(formatMessage('Open {x, the}', { x: noun('gui', 'map.legend') }), 'Open the legend', 'noun from the language file');
    eq(formatMessage('{n, plural, one {# day} other {# days}}', { n: 1 }), '1 day', 'plural one');
    eq(formatMessage('{n, plural, =0 {nothing} one {# day} other {# days}}', { n: 1000 }), '1,000 days', 'plural other');
    eq(formatMessage('{n, plural, =0 {nothing} other {# days}}', { n: 0 }), 'nothing', 'plural =0');
    eq(fmt.list(['Ana', 'Bea', 'Carla']), 'Ana, Bea, and Carla', 'English list');
    // A switch still loading is cancelled by a later one, also one back to the language already shown
    const race = [setLang('es'), setLang('en')];
    await Promise.all(race);
    eq(getLang(), 'en', 'the last switch asked for wins');
    const table = { title: { name: 'Old' }, nope: { name: 'Kept' } };
    defineNames(table, 'gui.settings', ['name']);
    eq(table.title.name, 'Settings', 'defineNames (en)');
    // ?lang=keys: the keys instead of the texts
    check(await setLang('keys'), 'cannot show the keys');
    eq($('p-resume').textContent, 'gui.pause.resume', 'keys mode');
    check(await setLang('es'), 'cannot switch back to Spanish');
    off();
    eq(document.documentElement.lang, 'es', '<html lang> back');
    const back = snap().split('\n'), was = es.split('\n'), diff = back.findIndex((x, i) => x !== was[i]);
    check(diff < 0, `the Spanish of the page is not the same after switching back: "${was[diff]}" / "${back[diff]}"`);
    eq(table.title.name, 'Ajustes', 'defineNames (es)');
    eq(table.nope.name, 'Kept', 'defineNames without a key keeps the old value');
    // Spanish grammar and numbers
    eq(formatMessage('Quita {n, plural, one {# muslo} other {# muslos}} de hambre.', { n: 2.5 }), 'Quita 2,5 muslos de hambre.', 'plural with decimals');
    eq(formatMessage('{n, plural, one {# muslo} other {# muslos}}', { n: 1 }), '1 muslo', 'plural one');
    eq(formatMessage('{sex, select, girl {¡Qué madrugadora!} other {¡Qué madrugador!}}', { sex: 'girl' }), '¡Qué madrugadora!', 'select');
    eq(formatMessage('{n, plural, one {{sex, select, girl {una niña} other {un niño}}} other {# niños}}', { n: 1, sex: 'boy' }), 'un niño', 'select inside plural');
    eq(formatMessage('Necesitas {s, a} cerca', { s: { name: 'Mesa de cantero', g: 'f' } }), 'Necesitas una mesa de cantero cerca', 'una');
    eq(formatMessage('Atacar {x, al}', { x: { name: 'Ciervo' } }), 'Atacar al ciervo', 'al');
    eq(formatMessage('Atacar {x, al}', { x: { name: 'Vaca', g: 'f' } }), 'Atacar a la vaca', 'a la');
    eq(formatMessage('Atacar {x, al}', { x: { name: 'Hacha', g: 'f', the: 'el hacha' } }), 'Atacar al hacha', 'el hacha');
    eq(formatMessage('Quedan pocas {x, del} montón', { x: { name: 'Tablas', g: 'fp' } }), 'Quedan pocas de las tablas montón', 'de las');
    eq(formatMessage('{x, The} está aquí', { x: { name: 'Vaca', g: 'f' } }), 'La vaca está aquí', 'capital article');
    eq(formatMessage('Abrir {x, the}', { x: { name: 'Leyenda', g: 'f' } }), 'Abrir la leyenda', 'noun with its gender');
    eq(formatMessage("Don't {x}", {}), "Don't {x}", 'apostrophe, and a missing parameter shows');
    eq(formatMessage('{n} × {item, lower}', { n: 12345, item: { name: 'Tablas', g: 'fp' } }), '12.345 × tablas', 'number and lowercase noun');
    eq(tHtml('gui.settings.language.auto_title', { lang: '<b>' }), 'Lo elige el juego (de momento, &lt;b&gt;)', 'tHtml escapes parameters');
    eq(t('gui.settings.language.auto_title', { lang: t('lang.name.es') }), 'Lo elige el juego (de momento, español)', 'the automatic language, in a sentence');
    eq(fmt.list(['Ana', 'Bea', 'Carla']), 'Ana, Bea y Carla', 'Spanish list');
    const nokey = ['no', 'such', 'key'].join('.');   // (built: i18n_check.py would rightly complain of a literal)
    eq(t(nokey), nokey, 'a missing key shows the key');
    // Every key of the base has its Spanish, and t() costs next to nothing (it can run every frame)
    const [en, esj] = await Promise.all(['en', 'es'].map(l => fetch(`src/lang/${l}.json?t=${Date.now()}`).then(r => r.json())));
    const missing = Object.keys(en).filter(k => !(k in esj));
    check(!missing.length, `keys without Spanish: ${missing.join(', ')}`);
    const t0 = performance.now();
    for (let i = 0; i < 20000; i++) t('gui.pause.resume');
    check(performance.now() - t0 < 40, `20000 t() take ${Math.round(performance.now() - t0)} ms`);
    check(['auto', 'en', 'es'].includes(game.snapshot().lang), `the save carries lang: ${game.snapshot().lang}`);
    // Accounts from before this version (a save without lang) stay in Spanish; their save keeps saying so
    eq(accountLangOf({ player: {} }), 'es', 'a save from before');
    eq(accountLangOf({ lang: 'auto' }), null, 'a save on automatic');
    eq(accountLangOf({ lang: 'en' }), 'en', 'a save in English');
    eq(accountLangOf(null), null, 'no save yet');
    await setAccountLang('es');
    eq(savedLang(), 'es', 'the save of an old account');
    await setAccountLang(null);
    eq(savedLang(), 'auto', 'a new account on automatic');
    // The first run of this version in a browser: with data of the game, Spanish; in a new one, automatic
    eq(decideFirst(['pueblo-brotes:ajustes', 'other'], []), 'es', 'first run with saved settings');
    eq(decideFirst([], ['other-db', 'pueblo-brotes']), 'es', 'first run with only the accounts database');
    eq(decideFirst([], []), 'auto', 'first run in a new browser');
    eq(decideFirst(['otro-proyecto:x', 'pueblo'], ['pueblo-brotes-relieve']), 'auto', 'first run with data of other projects only');
    eq(getLang(), 'es', 'language after the account checks');
  });
  await test('relieve: lo guardado da lo mismo que calcularlo, y sin costuras entre bloques', async () => {
    // (lo hecho alrededor, venga de lo guardado o del hilo aparte, frente a lo recién calculado aquí: bit a bit)
    const T = game.view3d.terrain, g = new WorldGen(w().gen.seed);
    check(groundTag(new WorldGen(g.seed + 1)) !== groundTag(g), 'la huella del relieve no cambia con la semilla');
    let borders = 0;
    for (const b of T.blocks.values()) {
      const d = blockHeights(g, b.bx, b.bz);
      check(d.heights.every((h, v) => h === b.raw[v]) && d.edge.every((h, v) => h === b.edge[v]), `el bloque ${b.bx},${b.bz} no tiene las alturas de siempre (guardado: ${T.stats.hits}, calculado: ${T.stats.calc})`);
      const nor = b.mesh.geometry.attributes.normal.array, flat = b.heights.some((h, v) => h !== b.raw[v]);
      if (!flat) check(nor.every((x, v) => Math.abs(x - d.normals[v]) < 1e-6), `las normales del bloque ${b.bx},${b.bz} no son las del relieve`);
      // (el vértice que comparte con el de la derecha y el de abajo: la misma altura y la misma normal)
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const o = T.blocks.get(`${b.bx + dx},${b.bz + dz}`), n = b.n;
        if (!o) continue;
        const nb = o.mesh.geometry.attributes.normal.array;
        for (let t = 0; t < n; t++) {
          const va = dx ? t * n + n - 1 : (n - 1) * n + t, vb = dx ? t * n : t;
          check(Math.abs(b.heights[va] - o.heights[vb]) < 1e-6, `grieta entre los bloques ${b.bx},${b.bz} y ${o.bx},${o.bz}`);
          for (let c = 0; c < 3; c++) check(Math.abs(nor[va * 3 + c] - nb[vb * 3 + c]) < 1e-6, `costura de luz entre los bloques ${b.bx},${b.bz} y ${o.bx},${o.bz}`);
        }
        borders++;
      }
      // (el suelo de antes de tener el bloque, para poner cosas, es el mismo que el de la malla)
      for (let i = 0; i < 20; i++) { const x = b.x0 + ((i * 37.31) % 64), z = b.z0 + ((i * 17.77) % 64); check(Math.abs(groundSmooth(g, x, z, T.world) - T.heightAt(x, z)) < 1e-4, `el suelo de reserva no casa con la malla en ${x.toFixed(1)},${z.toFixed(1)}`); }
    }
    check(borders >= 12, `pocas fronteras entre bloques hechos (${borders})`);
    // (la orilla del agua: la tiene cada bloque con agua, y el borde da lo mismo desde los dos bloques: la espuma no se corta)
    for (const b of T.blocks.values()) {
      const sa = b.waterMesh?.geometry.attributes.shore, n = b.n;
      if (!b.waterMesh) continue;
      check(sa?.itemSize === 4 && sa.array.every(Number.isFinite), `el agua del bloque ${b.bx},${b.bz} no tiene su orilla`);
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const sb = T.blocks.get(`${b.bx + dx},${b.bz + dz}`)?.waterMesh?.geometry.attributes.shore;
        if (!sb) continue;
        for (let t = 0; t < n; t++) {
          const va = dx ? t * n + n - 1 : (n - 1) * n + t, vb = dx ? t * n : t;
          for (let c = 0; c < 4; c++) check(Math.abs(sa.array[va * 4 + c] - sb.array[vb * 4 + c]) < 1e-4, `la orilla del agua se corta entre los bloques ${b.bx},${b.bz} y ${b.bx + dx},${b.bz + dz}`);
        }
      }
    }
  });
  await test('talar: un roble con el hacha da madera', async () => {
    const o = findKind(game, ['oak', 'pine'], p().x, p().y); check(o, 'no hay árboles cerca');
    await goTo(game, o.x + 1, o.y);
    const n = inv().count('madera'); await harvest(game, o, 'hacha');
    if (openBig(game, o.x, o.y)) await collectDrops(game);   // (the default: its log, split with the axe)
    check(inv().count('madera') > n, 'no ha caído madera');
  });
  await test('picar: una roca con el pico da piedra', async () => {
    const o = findKind(game, ['rock'], p().x, p().y); check(o, 'no hay rocas cerca');
    await goTo(game, o.x + 1, o.y);
    const n = inv().count('piedra'); await harvest(game, o, 'pico');
    check(inv().count('piedra') > n, 'no ha caído piedra');
  });
  await test('segar: un arbusto con la guadaña da fibra', async () => {
    const o = findKind(game, ['bush'], p().x, p().y); check(o, 'no hay arbustos cerca');
    await goTo(game, o.x + 1, o.y);
    const n = inv().count('fibra'); await harvest(game, o, 'guadana');
    check(inv().count('fibra') > n, 'no ha caído fibra');
  });
  await test('labrar: la azada deja tierra labrada', async () => {
    await goTo(game, 60, 30);
    let tile = null;
    for (let r = 0; r < 12 && !tile; r++) for (let dx = -r; dx <= r && !tile; dx++) for (let dy = -r; dy <= r && !tile; dy++) if (w().canTill(60 + dx, 30 + dy)) tile = [60 + dx, 30 + dy];
    check(tile, 'no hay dónde labrar');
    selectTool(game, 'azada');
    p().x = tile[0] + 0.5; p().y = tile[1] + 1.4; p().face = { x: 0, y: -1 }; await frames(2);
    game.gather.cooldown = 0; game.gather.target = game.gather.pickTarget(); check(game.gather.target?.ok, 'la azada no apunta a la casilla'); game.gather.use();
    check(w().delta(Math.floor(tile[0] / CHUNK), Math.floor(tile[1] / CHUNK))?.tilled[`${tile[0]},${tile[1]}`] !== undefined, 'la casilla no está labrada');
  });
  await test('segar cultivo (cut crop): the scythe cuts a growing crop and gives its seed back', async () => {
    await goTo(game, 60, 30);
    let tile = null;
    for (let r = 0; r < 12 && !tile; r++) for (let dx = -r; dx <= r && !tile; dx++) for (let dy = -r; dy <= r && !tile; dy++) if ([0, 1, 2].every(e => w().canTill(60 + dx, 30 + dy + e))) tile = [60 + dx, 30 + dy];   // (open ground below, where the player stands)
    check(tile, 'nowhere to till');
    const [tx, ty] = tile, k = `${tx},${ty}`, d = () => w().delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK));
    w().till(tx, ty); inv().add('semilla_trigo', 1); game.farm.sow(tx, ty, 'trigo');
    check(game.farm.cropAt(tx, ty) && !game.farm.ready(game.farm.cropAt(tx, ty)), 'the crop is not growing');
    selectTool(game, 'guadana'); game.mouse = null; CAM.first = false;   // (aim at the tile in front, not at the crosshair)
    p().x = tx + 0.5; p().y = ty + 1.4; p().face = { x: 0, y: -1 }; await frames(2);
    game.gather.cooldown = 0; game.gather.target = game.gather.pickTarget();
    check(game.gather.target?.ok && game.gather.target.label === t('farm.cut_crop'), `the scythe does not offer to cut it (${game.gather.target?.label || game.gather.target?.obj?.kind}; aim ${game.aimTile()}; tile ${tx},${ty})`);
    const seeds = inv().count('semilla_trigo'); game.gather.use(); await frames(30);
    check(!game.farm.cropAt(tx, ty), 'the crop is still there');
    check(d()?.tilled[k] !== undefined, 'the tile is no longer tilled');
    await until(() => inv().count('semilla_trigo') > seeds, 4000, 'the seed to be picked up');
    w().setTile(tx, ty, 'air');
  });
  await test('pisotear: saltar sobre tierra labrada sin plantar la deshace', async () => {
    await goTo(game, 60, 30);
    let tile = null;
    for (let r = 0; r < 12 && !tile; r++) for (let dx = -r; dx <= r && !tile; dx++) for (let dy = -r; dy <= r && !tile; dy++) if (w().canTill(60 + dx, 30 + dy)) tile = [60 + dx, 30 + dy];
    check(tile, 'no hay dónde labrar');
    const [tx, ty] = tile, k = `${tx},${ty}`, d = () => w().delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)), tilled = () => d()?.tilled[k] !== undefined;
    const jump = async () => { p().jump(); check(p().z > 0, 'no ha saltado'); await until(() => p().z === 0, 8000, 'a caer del salto'); };
    w().till(tx, ty); d().wet = { ...d().wet, [k]: game.farm.today };
    p().x = tx + 0.5; p().y = ty + 0.5; p().vx = p().vy = 0; await frames(20);
    check(tilled(), 'estar encima sin saltar la ha deshecho');
    inv().add('semilla_trigo', 1); game.farm.sow(tx, ty, 'trigo'); await jump();
    check(tilled() && game.farm.cropAt(tx, ty), 'saltar sobre lo plantado lo ha deshecho');
    delete d().crops[k]; await jump();
    check(!tilled(), 'saltar encima no la ha deshecho');
    check(d().wet?.[k] === undefined, 'la casilla sigue mojada');
    check(w().canTill(tx, ty), 'no se puede volver a labrar');
    w().till(tx, ty); runCommand(game, '/gamemode spectator', () => {}); await jump();
    check(tilled(), 'el espectador la ha pisado');
    runCommand(game, '/gamemode survival', () => {}); w().setTile(tx, ty, 'air');
  });
  await test('hambre: trabajar la gasta, comer la quita y dormir la recupera', async () => {
    const c = game.combat; check(game.gamemode === 'survival' && game.difficulty === 'normal', `modo ${game.gamemode}, dificultad ${game.difficulty}`);
    c.hunger = 20; c.exhaust = 0; c.paint();
    for (let i = 0; i < 8; i++) game.gather.spend('hacha');   // (ocho hachazos: 8 de cansancio, un muslo)
    check(c.hunger === 18, `tras 8 hachazos el hambre está a ${c.hunger} (esperaba 18)`);
    const said = []; const say = (t, k) => said.push(`${k}: ${t}`);
    c.hunger = 4; c.paint(); inv().add('manzana', 1); const slot = inv().slots.findIndex(s => s?.id === 'manzana'); check(slot >= 0, 'no hay manzana');
    game.gather.cooldown = 0; game.gather.eat(slot); check(c.hunger === 8, `tras la manzana el hambre está a ${c.hunger} (esperaba 8)`);
    runCommand(game, '/time set 23:00', say); check(game.days.hour >= 22, `time set: ${said.at(-1)}`);
    game.needs.rest = 50; await game.needs.sleep(); if (game.player.pose) game.rest.stand(); check(c.hunger === 14, `tras dormir el hambre está a ${c.hunger} (esperaba 14)`);
    runCommand(game, '/time reset', say);
    c.hunger = 20; c.paint();
  });
  await test('fabricar: tablas a mano y un banco con tablas y piedra', async () => {
    inv().add('madera', 4); game.craft.check();
    const tablas = RECIPES.find(r => r.id === 'tablas'), banco = RECIPES.find(r => r.id === 'banco');
    check(!game.craft.problem(tablas), `tablas: ${game.craft.problem(tablas)}`);
    game.craft.craft(tablas, 3); check(inv().count('tablas') >= 6, 'no hay 6 tablas');
    inv().add('piedra', 2); game.craft.teach('banco');
    check(!game.craft.problem(banco), `banco: ${game.craft.problem(banco)}`);
    game.craft.craft(banco, 1); check(inv().count('banco') === 1, 'no hay banco');
  });
  await test('casas grandes: caben, la puerta los mete dentro y los saca', async () => {
    await goTo(game, 60, 36);
    const R = game.ranch, keep = [...R.animals], was = hud.ask, Rp = Object.getOwnPropertyDescriptor(R, 'days');
    const noon = { hour: 12, info: { rain: false }, season: 1, dayIndex: game.days.dayIndex };
    Object.defineProperty(R, 'days', { get: () => noon, configurable: true });
    let f = null;
    for (let dx = -8; dx <= 8 && !f?.ok; dx += 2) for (let dy = -10; dy <= 8 && !f?.ok; dy += 2) f = w().fitFree('establo', 60 + dx, 36 + dy, 0, 0, null);
    check(f?.ok, `el establo no cabe: ${f?.why}`);
    w().placeFree('establo', f);
    const house = w().placedNear(f.ox, f.oy, 3).find(o => o.placed === 'establo'); check(house?.obb, 'no está el establo colocado');
    check(house.obb.hx >= 1.9 && house.obb.hy >= 1.4, `es pequeño: ${house.obb.hx}×${house.obb.hy}`);
    let want = '';
    hud.ask = (who, text, options) => { const i = options.findIndex(o => o.includes(want)); check(i >= 0, `el menú no ofrece «${want}»: ${options.join(' | ')}`); return Promise.resolve(i); };
    try {
      for (const n of ['Lola', 'Rosa', 'Nube', 'Trufa']) check(!R.add('vaca', n), `no se puede traer a ${n}`);
      const cows = R.animals.filter(a => a.home?.[0] === house.tile[0] && a.home?.[1] === house.tile[1]); check(cows.length === 4, `viven ${cows.length}`);
      const [hx, hy] = cows[0].home2;
      check(distTo(house.obb, hx, hy) > 0.3, `se sale dentro de la casa: a ${distTo(house.obb, hx, hy)} de la pared`);
      cows.forEach((a, i) => { a.x = a.tx = hx + i - 1.5; a.y = a.ty = hy + 1 + i * 0.5; a.inside = false; });
      await frames(5);
      check(cows.every(a => !a.inside) && cows.every(a => R.entities(w()).includes(a)), 'de día no están fuera');
      // Cerrar: entran todas y dejan de estar en el mapa
      want = 'Cerrar la puerta'; await R.houseMenu(house);
      check(w().placedObjectAt(...house.tile)?.model === 'establo:shut', 'la puerta no se ve cerrada');
      await until(() => cows.every(a => a.inside), 20000, 'a que entren');
      check(!cows.some(a => R.entities(w()).includes(a)), 'siguen en el mapa con la puerta cerrada');
      const at = cows.map(a => [a.x, a.y]); await frames(20); check(cows.every((a, i) => a.x === at[i][0] && a.y === at[i][1]), 'dentro siguen moviéndose');
      // Abrir: salen. De noche, no
      noon.hour = 22; want = 'Abrir la puerta'; await R.houseMenu(w().placedObjectAt(...house.tile));
      await frames(5); check(cows.every(a => a.inside), 'salen de noche');
      noon.hour = 12; await until(() => cows.every(a => !a.inside), 8000, 'a que salgan');
      check(cows.every(a => R.entities(w()).includes(a)), 'al abrir no vuelven al mapa');
      check(!w().placedObjectAt(...house.tile)?.model, 'la puerta no se ve abierta');
    } finally {
      hud.ask = was; R.animals = keep; if (Rp) Object.defineProperty(R, 'days', Rp); else delete R.days;
      const o = w().placedObjectAt(...house.tile); if (o) { game.pickUp(o); inv().remove('establo', 1); }
    }
  });
  await test('colocar: el banco se pone libre, se usa y se recoge', async () => {
    await goTo(game, 60, 36);
    const f = w().fitFree('banco', p().x + 1.5, p().y, 0, 0, p()); check(f.ok, `no cabe: ${f.why}`);
    w().placeFree('banco', f); inv().remove('banco', 1); await frames(2);
    check(game.craft.stationsNear().banco, 'el banco no está cerca');
    const o = w().placedNear(p().x, p().y, 3).find(o => o.placed === 'banco'); check(o, 'no se encuentra el banco colocado');
    check(game.pickUp(o), 'no se recoge'); check(inv().count('banco') === 1, 'el banco no ha vuelto a la mochila');
    // Tirado al suelo se ve como el modelo en miniatura (no como icono hecho pieza) y vuelve solo a la mochila
    await collectDrops(game); inv().remove('banco', 1); game.gather.throwOut('banco', 1); check(inv().count('banco') === 0 && game.gather.drops.length === 1, 'no se ha tirado');
    draw(); const fx = game.view3d.fx, shown = fx.drops.get(game.gather.drops[0]); check(shown?.s?.isGroup, 'en el suelo no está el modelo en miniatura');
    await collectDrops(game, 'a recoger el banco'); check(inv().count('banco') === 1, 'el banco tirado no ha vuelto');
  });
  await test('cofre: guarda cosas y lleno no se recoge', async () => {
    const [tx, ty] = freeTile(game, [[62, 38], [63, 38], [62, 39], [61, 38]]);
    w().place(tx, ty, 'cofre'); const chest = w().chestAt(tx, ty); check(chest?.length === 18, 'el cofre no tiene 18 huecos');
    chest[0] = { id: 'madera', n: 2 };
    const o = w().placedObjectAt(tx, ty); check(o, 'no está el cofre');
    check(!game.pickUp(o), 'se ha recogido lleno');
    chest[0] = null; check(game.pickUp(o), 'vacío no se recoge');
  });
  await test('cursor: se usa lo apuntado, a 2 casillas, con su borde y la opción al lado', async () => {
    const was = game.mouse, aimAt = (x, h, y) => { const v = new THREE.Vector3(x, game.view3d.groundY(w(), x, y) + h, y).project(game.view3d.camera); game.mouse = { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, in: true }; };
    const shot = async (x, y) => { await goTo(game, x, y); draw(); draw(); };
    try {
      await shot(21.5, 17.8);
      aimAt(21.5, 1.1, 16.5); check(/puerta/i.test(game.nearest()?.text || ''), `en la puerta dice: ${game.nearest()?.text}`);
      draw(); check(game.highlight?.kind === 'door', `resalta: ${game.highlight?.kind}`);
      check(document.getElementById('prompt').classList.contains('follow'), 'la opción no sale junto al cursor');
      // Sin apuntarla no hay nada, aunque esté al lado; ni con el ratón fuera del juego
      game.mouse = { x: 3, y: 3, in: true }; check(!game.nearest(), `sin apuntar dice: ${game.nearest()?.text}`); draw(); check(!game.highlight, 'resalta sin apuntar');
      aimAt(21.5, 1.1, 16.5); game.mouse.in = false; check(!game.nearest(), 'con el ratón fuera sigue la opción');
      // Más lejos de 2 casillas, tampoco
      await shot(21.5, 19.6); aimAt(21.5, 1.1, 16.5); check(!game.nearest(), `de lejos dice: ${game.nearest()?.text}`);
      // La cama, una valla del jardín, Nilo y el tablón
      const H = game.houseRect(), bed = w().placedNear((H.x0 + H.x1) / 2, (H.y0 + H.y1) / 2, 16).find(o => o.placed === 'cama'); check(bed, 'no hay cama');
      await shot(bed.x + 1.2, bed.y + 1.2); aimAt(bed.x, 0.45, bed.y); let act = game.nearest(); check(act?.text === 'Usar la cama' && act.alt, `en la cama dice: ${act?.text}`);
      const nilo = w().nilo; await shot(nilo.x + 1, nilo.y + 1); aimAt(nilo.x, 0.8, nilo.y); check(game.nearest()?.text === 'Hablar con Nilo', `con Nilo dice: ${game.nearest()?.text}`);
      await shot(BOARD.x + 0.5, BOARD.y + 1.6); aimAt(BOARD.x, 1, BOARD.y); check(game.nearest()?.text.includes('tablón'), `en el tablón dice: ${game.nearest()?.text}`);
    } finally { game.mouse = was; game.highlight = null; }
  });
  await test('caza: el cursor acierta en su cuerpo, muere y suelta lo suyo', async () => {
    const was = game.mouse, R = game.ranch, g = game.gather, inv = game.inv, p = game.player, X = 62, Y = 44;
    const aimAt = (x, h, y) => { const v = new THREE.Vector3(x, game.view3d.groundY(game.world, x, y) + h, y).project(game.view3d.camera); game.mouse = { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, in: true }; };
    const count = id => inv.count(id);
    const kept = inv.slots.slice(), sel = inv.selected;   // (con la barra llena no cabría lo que suelten)
    inv.slots.fill(null); inv.add('espada', 1); inv.select(inv.slots.findIndex(s => s?.id === 'espada'));
    try {
      await goTo(game, X, Y); draw(); draw();
      // Una vaca mirando a +x: su caja es la de su cuerpo, larga y girada con ella, y se apunta hasta el hocico
      const a = R.summon('vaca', X + 1.4, Y); a.dir = [1, 0]; a.wait = 9999;
      const b = bodyBox(a); check(Math.abs(b.hy - 0.86) < 0.01 && Math.abs(b.hx - 0.34) < 0.01 && Math.abs(b.y1 - 1.26) < 0.01 && Math.abs(b.vx - 1) < 0.01, `caja: ${JSON.stringify(b)}`);
      const put = () => { a.x = a.tx = X + 1.4; a.y = a.ty = Y; a.panic = 0; a.dir = [1, 0]; a.wait = 9999; };
      aimAt(a.x + 0.9, 1, a.y); check(game.aimed()?.e === a, `el hocico no se apunta: ${game.aimed()?.kind}`);
      g.target = g.pickTarget(); draw(); check(document.getElementById('prompt').textContent.includes('Clic: atacar'), `la opción dice: ${document.getElementById('prompt').textContent}`);
      draw(); check(game.highlight?.e === a, 'sin borde');
      game.mouse = { x: 3, y: 3, in: true }; g.target = g.pickTarget(); check(!g.target?.prey, 'pega sin apuntarle');
      // A espadazos: parpadea y huye, y al morir se va y suelta su carne, su piel y su hueso
      const before = ['carne_vaca', 'piel', 'hueso'].map(count); let hits = 0;
      for (; R.animals.includes(a) && hits < 14; hits++) {
        put(); aimAt(a.x, 0.9, a.y); g.cooldown = 0; g.target = g.pickTarget(); check(g.target?.prey === a, `no le apunto: ${g.target?.label}`);
        g.use();
        if (!hits) { check(a.hurt > 0, 'no parpadea'); check(a.panic > game.time, 'no huye'); await frames(30); check(Math.hypot(a.x - X - 1.4, a.y - Y) > 0.5, 'no se mueve al huir'); }
      }
      check(!R.animals.includes(a), `sigue viva tras ${hits} golpes`); check(hits >= 3 && hits <= 4, `${hits} golpes de espada`);
      check(!game.carry.bigNow || openBig(game, a.x, a.y), 'the cow left no carcass');   // (the default: butchered where it fell, the least of each)
      await collectDrops(game);
      check(count('carne_vaca') >= before[0] + 2 && count('piel') >= before[1] + 1 && count('hueso') >= before[2] + 1, 'la vaca no suelta lo suyo');
      await goTo(game, X, Y);
      // La cría, solo un trozo de carne
      const lana = count('lana'), meat = count('carne_cordero'), c = R.summon('oveja', X + 1.4, Y); c.born = R.today; c.young = true; c.wait = 9999;
      for (let i = 0; i < 9 && R.animals.includes(c); i++) game.hunt.hit(c, ITEMS.espada);
      check(!R.animals.includes(c), 'la cría sigue viva'); await collectDrops(game);
      check(count('carne_cordero') === meat + 1 && count('lana') === lana, 'la cría suelta de más');
      await goTo(game, X, Y); draw();
      // Lo de otra persona no se ataca (ni, si no apuntas, nada)
      const o = R.summon('gallina', X + 1.4, Y); o.wait = 9999; o.owner = 'otra-persona';
      aimAt(o.x, 0.3, o.y); g.target = g.pickTarget(); check(game.aimed()?.e === o && !g.target?.prey, 'se ataca lo de otro');
      R.remove(o); R.gone.delete(o.id);
      check(!PREY.perro && !PREY.gato && !PREY.caballo, 'las mascotas y el caballo se pueden matar');
      // Con comida en la mano, el clic es para comer
      inv.add('pan', 1); inv.select(inv.slots.findIndex(s => s?.id === 'pan'));
      const e = R.summon('gallina', X + 1.4, Y); e.wait = 9999; aimAt(e.x, 0.3, e.y); g.target = g.pickTarget(); check(!g.target?.prey, 'con pan en la mano, pega'); R.remove(e); R.gone.delete(e.id); inv.remove('pan', 1);
      // El salvaje huye de quien va de pie; de quien va agachado, solo muy de cerca
      const W = game.wildlife, d = W.summon('ciervo', X + 3, Y); W.t = -999;
      p.crouch = true; const at = [d.x, d.y]; await frames(20);
      check(W.list.includes(d) && Math.hypot(d.x - at[0], d.y - at[1]) < 2 && !(d.scared > game.time), 'huye de quien va agachado');
      p.crouch = false; d.tx = d.x; d.ty = d.y; d.wait = 0; const at2 = [d.x, d.y]; await frames(20);
      check(!W.list.includes(d) || Math.hypot(d.x - at2[0], d.y - at2[1]) > 1, 'no huye de quien va de pie');
      if (!W.list.includes(d)) W.list.push(d);
      d.x = X + 1.3; d.y = Y; const v = count('carne_venado');
      for (let i = 0; i < 9 && W.list.includes(d); i++) { game.hunt.hit(d, ITEMS.espada); check(i || d.scared > game.time, 'no se asusta'); }
      check(!W.list.includes(d), 'el ciervo sigue vivo'); check(!game.carry.bigNow || openBig(game, d.x, d.y), 'the deer left no carcass');
      await collectDrops(game); check(count('carne_venado') >= v + 2, 'el ciervo no suelta carne');
      // Todo lo que sueltan existe y vale algo, y la carne se asa en la cocina y alimenta más
      for (const [t, def] of Object.entries(PREY)) for (const [id] of def.drops) { check(ITEMS[id], `${t} suelta ${id}`); check(priceOf(id) > 0, `${id} no vale nada`); }
      for (const id of Object.keys(ITEMS).filter(k => k.startsWith('carne_'))) { const r = RECIPES.find(r => r.station === 'cocina' && r.ins[0][0] === id); check(r && ITEMS[r.out].food > ITEMS[id].food, `${id} no se asa`); check(itemIcon(id) && itemIcon(r.out), `sin icono: ${id}`); }
      check(RECIPES.some(r => r.out === 'cuero' && r.ins[0][0] === 'piel') && RECIPES.some(r => r.ins.some(([i]) => i === 'cuero')), 'la piel no sirve de nada');
      check(priceOf('vela') === 29, `la vela vale ${priceOf('vela')}`);   // (las recetas nuevas no cambian lo que ya valía)
    } finally { game.mouse = was; game.highlight = null; p.crouch = false; inv.slots.splice(0, inv.slots.length, ...kept); inv.select(sel); }
  });
  await test('establo: abierto se entra y se ve a los de dentro; cerrado, no', async () => {
    await goTo(game, 60, 36);
    const R = game.ranch, keep = [...R.animals], was = hud.ask, Rp = Object.getOwnPropertyDescriptor(R, 'days'), p0 = p();
    const noon = { hour: 22, info: { rain: false }, season: 1, dayIndex: game.days.dayIndex };
    Object.defineProperty(R, 'days', { get: () => noon, configurable: true });
    let f = null;
    for (let dx = -8; dx <= 8 && !f?.ok; dx += 2) for (let dy = -10; dy <= 8 && !f?.ok; dy += 2) f = w().fitFree('establo', 60 + dx, 36 + dy, 0, 0, null);
    check(f?.ok, `no cabe: ${f?.why}`);
    w().placeFree('establo', f);
    let house = w().placedNear(f.ox, f.oy, 3).find(o => o.placed === 'establo');
    hud.ask = (who, text, options) => Promise.resolve(options.findIndex(o => o.includes('Cerrar')));
    try {
      check(!R.add('vaca', 'Lola'), 'no se trae la vaca');
      const cow = R.animals.at(-1); cow.inside = true;
      // Por el hueco de la puerta se pasa, hasta el fondo; por las paredes, no
      const [vx, vy] = dirOf(house.yaw), free = (x, y) => { const q = { x, y }; collideNow(q, w().collidersNear(x, y), 0.25); return Math.hypot(q.x - x, q.y - y) < 0.01; };
      for (const d of [2.2, 1.5, 1, 0, -1]) check(free(house.x + vx * d, house.y + vy * d), `no se pasa a ${d} del centro`);
      check(!free(house.x + vx * 1.45 + Math.cos(house.yaw) * 1.5, house.y + vy * 1.45 - Math.sin(house.yaw) * 1.5), 'se atraviesa la pared');
      Object.assign(p0, { x: house.x, y: house.y }); await frames(5);
      check(Math.hypot(p0.x - house.x, p0.y - house.y) < 0.05, 'dentro le empuja hacia fuera');
      check(R.houseAround(p0)?.key === house.key, 'no sabe que está dentro');
      draw(); check(game.view3d.world.insideKey === house.key, 'dentro no se quita el tejado');
      const s = R.stall(cow); check(s && distTo(house.obb, s[0], s[1]) === 0, 'la vaca no tiene sitio dentro');
      check(R.entities(w()).includes(cow) && Math.hypot(cow.x - s[0], cow.y - s[1]) < 0.01, 'no se ve a la vaca dentro');
      check(game.aimTargets(p0, w()).some(c => c.kind === 'animal' && c.e === cow), 'no se puede apuntar a la vaca de dentro');
      // Cerrar con alguien dentro: sale fuera y dejan de verse
      await R.houseMenu(house); await frames(5);
      house = w().placedObjectAt(...house.tile); check(house.model === 'establo:shut', 'no se cierra');
      check(distTo(house.obb, p0.x, p0.y) > 0.1, 'se queda dentro al cerrar');
      check(!R.stall(cow) && !R.entities(w()).includes(cow), 'se ve dentro con la puerta cerrada');
      draw(); check(!game.view3d.world.insideKey, 'fuera sigue sin tejado');
    } finally {
      hud.ask = was; R.animals = keep; if (Rp) Object.defineProperty(R, 'days', Rp); else delete R.days;
      const o = w().placedObjectAt(...house.tile); if (o) { game.pickUp(o); inv().remove('establo', 1); }
    }
  });
  await test('taberna: el tabernero, los clientes, su tienda y sus asientos', async () => {
    const N = game.neighbors, who = id => N.people.find(n => n.id === id), hidden = (id, h) => { who(id).update(0, h); return who(id).hidden; };
    check(who('anselmo') && who('eusebio') && who('ines') && who('marta') && who('paco'), 'falta gente');
    check(hidden('anselmo', 8) && !hidden('anselmo', 12) && !hidden('anselmo', 1), 'Anselmo no está a sus horas');
    check(hidden('marta', 12) && !hidden('marta', 20) && !hidden('eusebio', 12), 'los clientes no están a sus horas');
    check(who('eusebio').pose?.kind === 'sit' && !who('anselmo').pose, 'mal sentados');
    await goTo(game, 6.5, 36.5); draw();
    const near = w().placedNear(6, 36, 9), has = id => near.some(o => o.placed === id);
    check(has('barra') && has('barril') && has('taburete') && has('mesa') && has('silla'), `falta mobiliario: ${[...new Set(near.map(o => o.placed))]}`);
    check(!has('banco') && !has('telar'), 'quedan el banco o el telar');
    check(game.houseName() === 'La taberna', `se llama ${game.houseName()}`);
    for (const id of ['anselmo', 'eusebio', 'ines', 'marta', 'paco']) { const { x, y } = who(id), q = { x, y }; collideNow(q, w().collidersNear(x, y).filter(c => c.r === undefined && !c.piece), 0.05); check(Math.hypot(q.x - x, q.y - y) < 0.4 || who(id).pose, `${id} está dentro de algo`); }
    check(SHOPS.anselmo.stock.every(i => ITEMS[i.id] || ITEMS[i.plan]), 'vende lo que no existe');   // (Anselmo sells the plans of the tavern's furniture)
    const stool = near.find(o => o.placed === 'taburete'); p().x = stool.x; p().y = stool.y + 1;
    check(game.aimTargets(p(), w()).some(c => c.o === stool), 'el taburete no se apunta');
    const act = game.actionFor({ kind: 'placed', o: stool }); check(act?.text === 'Sentarse' && !act.alt, `dice: ${act?.text}`);
    act.run(); check(p().pose?.kind === 'sit', 'no se sienta'); game.rest.stand();
  });
  await test('primera persona: el ratón mira y se usa lo que está en la cruceta', async () => {
    const was = game.mouse, g = game.gather, M = game.mobs;
    const center = () => { game.mouse = { x: innerWidth / 2, y: innerHeight / 2, in: true }; };
    const press = (code, type = 'keydown') => dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    const yaw = CAM.yaw, look = CAM.look;
    try {
      // En tercera persona las flechas mueven la cámara; en primera, andan
      CAM.first = false; press('ArrowLeft'); check(CAM.turn === 1 && !keys.left, 'en tercera las flechas no giran'); press('ArrowLeft', 'keyup');
      CAM.first = true; press('ArrowLeft'); check(CAM.turn === 0 && keys.left, 'en primera las flechas giran'); press('ArrowLeft', 'keyup'); clearKeys();
      // El ratón: a la derecha gira a la derecha, y hacia arriba mira arriba
      CAM.yaw = 0; CAM.look = 0;
      const [rx, ry] = [Math.cos(0), -Math.sin(0)]; lookBy(100, 0); const fwd = [-Math.sin(CAM.yaw), -Math.cos(CAM.yaw)]; check(fwd[0] * rx + fwd[1] * ry > 0, 'gira al revés');
      lookBy(0, -100); check(CAM.look > 0, 'mira al revés');
      // Cruceta y a quién se pega
      await goTo(game, 62, 46); CAM.yaw = 0; CAM.look = -0.45; p().crouch = false;
      const P = p(), m = M.summon('esqueleto', P.x, P.y - 1.3), keep = [...M.list];
      draw(); draw(); center();
      check(document.body.classList.contains('aiming'), 'no sale la cruceta');
      check(game.aimed()?.e === m, `en la cruceta: ${game.aimed()?.kind}`);
      const t = g.pickTarget(); check(t?.use && t.label.includes('esqueleto'), `objetivo: ${t?.label}`);
      const hp = m.hp; g.cooldown = 0; g.target = t; g.use(); check(m.hp < hp, 'no le pega');
      // Sin apuntarle, no (aunque esté delante)
      CAM.yaw = 0.9; draw(); draw(); center(); check(game.aimed()?.e !== m, 'sigue en la cruceta sin mirarle');
      inv().add('espada', 1);
      M.list = keep.filter(x => x !== m);
      // Un árbol: el de la cruceta, no el de delante
      const oak = w().harvestablesNear(P.x, P.y).find(o => HARVEST[o.kind]?.tool === 'hacha');
      if (oak) {
        P.x = oak.x; P.y = oak.y + 1.1; CAM.yaw = 0; CAM.look = 0; P.face = { x: 0, y: -1 }; draw(); draw(); center(); selectTool(game, 'hacha');
        check(g.pickTarget()?.obj === oak, 'no se apunta al árbol con la cruceta');
        CAM.yaw = Math.PI; draw(); draw(); center(); check(g.pickTarget()?.obj !== oak, 'se apunta al árbol de espaldas');
      }
      inv().remove('espada', 1);
    } finally { CAM.first = false; CAM.yaw = yaw; CAM.look = look; game.mouse = was; clearKeys(); draw(); check(!document.body.classList.contains('aiming'), 'sigue la cruceta en tercera'); }
  });
  await test('arco: se tensa, la flecha hace una parábola, se clava y se recoge al pisarla', async () => {
    const A = game.archery, I = inv(), P = p(), kept = I.slots.slice(), sel = I.selected, was = game.mouse;
    I.slots.fill(null); I.add('arco', 1); I.add('flecha', 10); I.select(I.slots.findIndex(s => s?.id === 'arco'));
    game.mouse = null; CAM.first = false;
    const shoot = async (held) => {   // tensa held segundos (de juego) y suelta
      keys.use = true; game.gather.cooldown = 0; game.gather.use();
      const steps = Math.round(held * 60); for (let i = 0; i < steps; i += 5) await frames(5);
      keys.use = false; await frames(1);
    };
    try {
      await goTo(game, 62, 50); P.face = { x: 1, y: 0 };
      check(!game.gather.pickTarget()?.use && game.gather.pickTarget()?.label.includes('tensar'), `dice: ${game.gather.pickTarget()?.label}`);
      // Tensar: se anda despacio; soltar casi sin tensar, no gasta
      keys.use = true; game.gather.cooldown = 0; game.gather.use(); await frames(2); check(A.drawT !== null && A.walk < 1 && P.drawing, `no se tensa: ${A.drawT} ${A.walk} ${P.drawing} ${game.busy} ${hud.dialogOpen} ${game.mode}`); keys.use = false; await frames(1);
      check(!A.list.length && I.count('flecha') === 10, 'sin tensar sale una flecha');
      // A toda fuerza: sube y baja, y cae lejos
      await shoot(1.2); check(A.list.length === 1 && I.count('flecha') === 9, 'no sale ni se gasta');
      const a = A.list[0], x0 = a.x, h0 = a.h; let top = h0, climbs = 0, falls = 0, last = h0;
      check(a.mine && a.dmg === 6, `daño: ${a.dmg}`);
      for (let i = 0; i < 400 && !a.stuck; i++) { await frames(1); if (a.stuck) break; if (a.h > last) climbs++; else if (a.h < last) falls++; top = Math.max(top, a.h); last = a.h; }
      check(a.stuck, 'no se clava'); check(climbs > 3 && falls > 3 && top > h0, `no es una parábola: sube ${climbs}, baja ${falls}`);
      const far = Math.hypot(a.x - x0, a.y - P.y); check(far > 6, `llega a ${far}`);
      // Tensar menos: llega menos
      await shoot(0.35); const b = A.list.at(-1); check(b !== a && b.dmg < 6, 'tensar poco no daña menos');
      await until(() => b.stuck, 8000, 'la flecha corta'); const near = Math.hypot(b.x - x0, b.y - P.y); check(near < far, `poco tensa llega a ${near} y tensa a ${far}`);
      // Se recoge con solo pasar por encima
      const n = I.count('flecha'); P.x = a.x + 2; P.y = a.y; await frames(2); check(A.list.includes(a), 'se recoge de lejos');
      P.x = a.x + 0.3; await frames(30); check(!A.list.includes(a) && I.count('flecha') === n + 1, 'no se recoge al pisarla');
      // A un animal: le daña y se pierde; un muro la para
      await goTo(game, 62, 50); P.face = { x: 1, y: 0 };
      const R = game.ranch, cow = R.summon('vaca', P.x + 4, P.y); cow.wait = 9999;
      const before = I.count('flecha'), left = A.list.length; await shoot(1.2); const c = A.list.at(-1);
      c.h = game.view3d.groundY(game.world, c.x, c.y) + 0.7; c.vh = 0;
      await until(() => !A.list.includes(c) || c.stuck, 6000, 'que dé');
      check(!A.list.includes(c) && cow.hp === 12 - 6 && I.count('flecha') === before - 1, `a la vaca: vida ${cow.hp}`);
      R.remove(cow); R.gone.delete(cow.id);
      // Sin flechas, no; y tensar y cambiar de objeto cancela
      I.remove('flecha', I.count('flecha')); keys.use = true; game.gather.cooldown = 0; game.gather.use(); check(A.drawT === null, 'tensa sin flechas'); keys.use = false;
      I.add('flecha', 1); keys.use = true; game.gather.cooldown = 0; game.gather.use(); await frames(3); I.select(I.slots.findIndex(s => s?.id === 'arco') + 1); await frames(2); check(A.drawT === null, 'sigue tensando sin el arco'); keys.use = false;
      draw(); check(!!game.view3d.arrows.group.children.length, 'no se dibujan');
      check(RECIPES.some(r => r.out === 'arco') && RECIPES.some(r => r.out === 'flecha'), 'sin receta');
      check(itemIcon('arco') && itemIcon('flecha'), 'sin icono');
    } finally { keys.use = false; A.drawT = null; I.slots.splice(0, I.slots.length, ...kept); I.select(sel); game.mouse = was; }
  });
  await test('interfaz (interface): the minimal one goes on, off and on again, and off leaves the full one as it was', async () => {
    const el = id => document.getElementById(id), W = game.windows;
    // What the full interface is made of: where each part is and its classes (and nothing of the minimal one left)
    const snap = () => JSON.stringify({
      hotbar: el('hotbar').outerHTML.replace(/ style="[^"]*"/g, ''), money: el('money').parentNode.id,
      cls: ['clockp', 'admin-tag', 'place', 'minimap', 'quest', 'hint'].map(id => el(id).className),
      body: ['hud-min', 'hud-all', 'hm-solo', 'hm-mini'].filter(c => document.body.classList.contains(c)),
      added: ['hud-status', 'hud-item', 'hud-delta', 'hud-tip', 'hud-build', 'hud-goal', 'hud-bow'].filter(el),
      tab: document.querySelector('[data-i18n="controls.players"]')?.textContent, styles: document.head.querySelectorAll('style').length,
    });
    const was = Settings.v.hud;
    check(!game.smartHud, 'the tests do not start with the full interface');
    // (the inventory list paints its load bar when it opens: with what is carried now, not what a test before carried)
    W.open('s-inv'); draw(); W.closeAll(); draw();
    const full = snap();
    W.closeAll();
    try {
      for (let round = 0; round < 2; round++) {
        // On (the second time, from the setting, as the player does it): the parts go to their places
        if (round) Settings.set('hud', 'minimal'); else useSmartHud(game, true);
        const sh = game.smartHud;
        check(sh && document.body.classList.contains('hud-min'), `round ${round}: it does not go on`);
        check(!el('hearts') && el('needs')?.parentNode === document.body && el('xp').parentNode.id === 'hud-status' && el('money').parentNode === document.body, 'the parts are not in their places');
        // An empty slot or a bow with no arrows: no name, not even the one before
        sh.until.item = 1e9; sh.itemName(null, 0);
        check(sh.until.item === 0, 'an empty slot keeps the name of the one before');
        await frames(2); draw(); draw();
        // With a window open, the hotbar shows, and the block of health next to it
        W.open('s-inv'); draw();
        check(el('hotbar-slots').classList.contains('hm-on') && el('hud-status').classList.contains('hm-on'), 'with a window open the hotbar does not show');
        W.close('s-inv'); draw();
        // Tab's tip by the game mode: no health to see in creative
        runCommand(game, '/gamemode creative', () => {}); draw();
        const creative = (sh.paintTip('all'), el('hud-tip').querySelector('span').textContent);
        runCommand(game, '/gamemode survival', () => {}); draw();
        const survival = (sh.paintTip('all'), el('hud-tip').querySelector('span').textContent);
        check(creative === t('hud.tip.all.nohealth') && survival === t('hud.tip.all'), `Tab's tip: ${creative} / ${survival}`);
        // Off: everything back as it was
        if (round) Settings.set('hud', 'full'); else useSmartHud(game, false);
        draw();
        check(!game.smartHud, `round ${round}: it does not go off`);
        const now = snap();
        let at = 0; while (at < now.length && now[at] === full[at]) at++;
        check(now === full, `off, the full interface is not as it was: …${now.slice(Math.max(0, at - 60), at + 140)} ≠ …${full.slice(Math.max(0, at - 60), at + 140)}`);
      }
      // The setting lights the one in sight (here the full one, which the tests choose without saving it), and its
      // buttons swap it
      const row = [...el('st-body').querySelectorAll('.st-row')].find(r => r.firstElementChild?.textContent === t('gui.settings.hud'));
      const [bMin, bFull] = row?.querySelectorAll('button') || [];
      check(bMin && bFull, 'no Interface row in the settings');
      const lit = () => (bMin.classList.contains('on') ? 'minimal' : '') + (bFull.classList.contains('on') ? 'full' : '');
      bMin.click(); draw();
      check(game.smartHud && lit() === 'minimal', `Minimal pressed: ${!!game.smartHud}, lit ${lit()}`);
      bFull.click(); draw();
      check(!game.smartHud && lit() === 'full', `Full pressed: ${!!game.smartHud}, lit ${lit()}`);
      check(Settings.hudNow?.() === 'full', 'Settings.hudNow does not say the one in sight');
    } finally { W.closeAll(); Settings.set('hud', was); useSmartHud(game, false); }
  });
  await test('rueda (tool wheel): F held opens it, the mouse direction picks a slot and releasing F equips it', async () => {
    const Wh = game.wheel, I = inv(), kept = I.slots.slice(), sel = I.selected, press = (code, type = 'keydown', o = {}) => dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, ...o }));
    const tools = ['hacha_hierro', 'pico_hierro', 'guadana_hierro', 'azada_hierro', 'pala_hierro', 'regadera', 'arco', 'espada', 'cana'];
    try {
      check(Wh && !Wh.open, 'no tool wheel, or open at the start');
      I.slots.fill(null); tools.forEach((id, i) => { I.slots[i] = { id, n: 1 }; }); I.select(0); I.changed();
      press('KeyF'); check(!Wh.open, 'it opens at once (it must wait 0.18 s)');
      await sleep(260); Wh.frame();
      check(Wh.open && document.body.classList.contains('wheel-open') && document.getElementById('wheel').classList.contains('on'), 'held, it does not open');
      check(Wh.sel === 0, `it does not start on the slot in hand: ${Wh.sel}`);
      // Each of the nine directions (slot 1 up, clockwise), and the dead zone keeps the one picked
      for (let i = 0; i < HOTBAR; i++) { Wh.sx = Wh.sy = 0; const a = i * 40 * Math.PI / 180; Wh.move(Math.sin(a) * 90, -Math.cos(a) * 90); check(Wh.sel === i, `direction ${i}: slot ${Wh.sel}`); }
      Wh.sx = Wh.sy = 0; Wh.move(Math.sin(1.4) * 90, -Math.cos(1.4) * 90); const picked = Wh.sel; Wh.sx = Wh.sy = 0; Wh.move(10, 5); check(Wh.sel === picked, 'the dead zone changes the slot');
      Wh.step(1); check(Wh.sel === (picked + 1) % HOTBAR, 'the mouse wheel does not step'); Wh.step(-1);
      press('KeyF', 'keyup'); check(!Wh.open && I.selected === picked, `letting go of F: open ${Wh.open}, slot ${I.selected} (wanted ${picked})`);
      check(!document.body.classList.contains('wheel-open'), 'body.wheel-open stays');
      // A digit with it open: that slot, and it closes
      Wh.show(); press('Digit4'); check(!Wh.open && I.selected === 3, `digit 4: open ${Wh.open}, slot ${I.selected}`);
      // Right click and Esc cancel without changing anything
      Wh.show(); Wh.move(0, 90); dispatchEvent(new PointerEvent('pointerdown', { button: 2, bubbles: true, cancelable: true })); check(!Wh.open && I.selected === 3, `right click: open ${Wh.open}, slot ${I.selected}`);
      Wh.show(); Wh.move(0, 90); press('Escape'); check(!Wh.open && I.selected === 3 && game.mode === 'play', `Esc: open ${Wh.open}, slot ${I.selected}, mode ${game.mode}`);
    } finally { Wh?.cancel(true); press('KeyF', 'keyup'); I.slots.splice(0, I.slots.length, ...kept); I.select(sel); }
  });
  await test('rueda: a short tap goes back to the item before, without showing the wheel', async () => {
    const Wh = game.wheel, I = inv(), kept = I.slots.slice(), sel = I.selected, press = (code, type = 'keydown', o = {}) => dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, ...o }));
    const tap = () => { press('KeyF'); press('KeyF', 'keyup'); };
    try {
      I.slots.fill(null); ['hacha_hierro', 'pico_hierro', 'pan', 'madera', 'pala_hierro', 'regadera'].forEach((id, i) => { I.slots[i] = { id, n: 1 }; }); I.changed();
      press('Digit2'); press('Digit5'); check(I.selected === 4, 'the digits do not pick');
      tap(); check(I.selected === 1, `the tap does not go back: ${I.selected}`);
      check(!Wh.open && !document.getElementById('wheel').classList.contains('on') && game.timeScale === 1, 'the tap shows the wheel or slows down');
      tap(); check(I.selected === 4, `the second tap does not come back: ${I.selected}`);
      // The mouse wheel goes through several slots in a row: those do not count
      press('Digit2'); I.selectedAt -= 1000;
      for (let i = 0; i < 4; i++) I.select(I.selected + 1);
      check(I.selected === 5, `cycling: ${I.selected}`);
      tap(); check(I.selected === 1, `after cycling, the tap goes to ${I.selected} (wanted the one before starting)`);
      // Used up or moved: the same id elsewhere in the hotbar; gone, nothing
      press('Digit1'); press('Digit5'); I.move(0, 7); tap(); check(I.selected === 7 && I.held?.id === 'hacha_hierro', `the one before was moved: ${I.selected}`);
      press('Digit5'); I.remove('hacha_hierro', 1); tap(); check(I.selected === 4, 'with the one before gone it still changes');
      // Cmd+F is the browser's
      press('KeyF', 'keydown', { metaKey: true }); check(Wh.pressAt === null, 'Cmd+F starts the wheel'); press('KeyF', 'keyup');
    } finally { Wh?.cancel(true); I.slots.splice(0, I.slots.length, ...kept); I.select(sel); }
  });
  await test('rueda: slow motion only alone, never in build mode, a dialogue or as a spectator', async () => {
    const Wh = game.wheel, live = game.live, perf = game.perf, noop = game.update;
    const was = { joined: live.joined, role: live.role }, hidden = Object.getOwnPropertyDescriptor(document, 'hidden');
    let now = performance.now() + 1000;
    const run = n => { for (let i = 0; i < n; i++) { now += 1000 / 60; game.advance(now, 0.25); } };
    game.update = step;   // (the real steps, for game.time)
    try {
      Wh.show(); run(20);
      check(game.timeScale < 0.4 && game.simScale === game.timeScale, `alone, open: timeScale ${game.timeScale}`);
      const t0 = game.time, s0 = perf.steps; run(60);
      check(game.time - t0 < 0.5 && game.time - t0 > 0.2, `in a second of real time the game went ${(game.time - t0).toFixed(3)} s`);
      check(Math.abs(perf.steps - s0 - 60) <= 2, `steps in a second: ${perf.steps - s0} (they must stay about 60)`);
      // Closed, back to 1 in about 0.12 s
      Wh.close(false); run(20); check(game.timeScale === 1, `closed: timeScale ${game.timeScale}`);
      // Someone else playing: never slowed down; as a guest neither, and the minimal interface still says you are alone
      live.joined = true; live.peers.set('prueba-otro', { playing: true, server: false });
      Wh.show(); run(3); check(game.timeScale === 1 && live.othersPlaying && !live.aloneInWorld, `with someone else: ${game.timeScale}`);
      live.peers.delete('prueba-otro'); live.role = 'guest'; run(3);
      check(game.timeScale === 1 && !live.aloneInWorld && !live.othersPlaying, `as a guest: ${game.timeScale}, others ${live.othersPlaying}`);
      live.joined = was.joined; live.role = was.role; Wh.cancel(true);
      // It does not open (and if open, it closes) in build mode, talking, as a spectator or with the map
      for (const [what, on, off] of [
        ['build mode', () => { game.build.on = true; }, () => { game.build.on = false; }],
        ['busy', () => { game.busy = true; }, () => { game.busy = false; }],
        ['spectator', () => runCommand(game, '/gamemode spectator', () => {}), () => runCommand(game, '/gamemode survival', () => {})],
        ['map', () => { game.mode = 'map'; }, () => { game.mode = 'play'; }],
      ]) {
        on();
        try {
          check(!Wh.press(), `it starts with ${what}`);
          Wh.show(); Wh.frame(); check(!Wh.open, `open with ${what} it does not close`);
        } finally { off(); }
      }
      // Losing the focus or hiding the tab: closed and at full speed at once
      Wh.show(); run(20); dispatchEvent(new Event('blur')); dispatchEvent(new Event('focus')); check(!Wh.open && game.timeScale === 1, `blur: open ${Wh.open}, timeScale ${game.timeScale}`);
      Wh.show(); run(20);
      Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      check(!Wh.open && game.timeScale === 1, `hidden: open ${Wh.open}, timeScale ${game.timeScale}`);
      Wh.show(); run(10); check(game.timeScale === 1, `open with the tab hidden it slows down: ${game.timeScale}`);
    } finally {
      if (hidden) Object.defineProperty(document, 'hidden', hidden); else delete document.hidden;
      Wh.cancel(true); game.update = noop; live.joined = was.joined; live.role = was.role; live.peers.delete('prueba-otro');
      game.build.on = false; game.busy = false; game.mode = 'play'; game.timeScale = game.timeScaleTarget = 1;
    }
  });
  await test('rueda: first person moves the selection, not the camera; using stops; the bow lets go without shooting', async () => {
    const Wh = game.wheel, I = inv(), A = game.archery, kept = I.slots.slice(), sel = I.selected, canvas = document.getElementById('c'), g = game.gather, use = g.use;
    const yaw = CAM.yaw;
    try {
      I.slots.fill(null); ['hacha_hierro', 'pico_hierro', 'arco', 'flecha'].forEach((id, i) => { I.slots[i] = { id, n: id === 'flecha' ? 10 : 1 }; }); I.select(0); I.changed();
      CAM.first = true; draw();
      Wh.show();
      canvas.dispatchEvent(new PointerEvent('pointermove', { movementX: 120, movementY: 0, bubbles: true, pointerType: 'mouse' }));
      check(CAM.yaw === yaw, 'the mouse turns the camera with the wheel open');
      check(Wh.sel === 2, `the mouse to the right picks slot ${Wh.sel + 1} (wanted 3)`);
      Wh.close(false);
      // Using with the click held stops, and nothing is used after closing
      let used = 0; g.use = () => { used++; };
      keys.use = true; Wh.show(); check(keys.use === false, 'opening does not stop using'); Wh.close(true); await frames(10);
      check(used === 0, `used ${used} times after closing`);
      g.use = use;
      // The bow, drawn: opening lets go without an arrow
      I.select(2); keys.use = true; g.cooldown = 0; g.use(); await frames(10);
      check(A.drawT !== null, 'the bow does not draw');
      const n = A.list.length, arrows = I.count('flecha');
      Wh.show(); check(A.drawT === null, 'opening does not let go of the string');
      keys.use = false; await frames(5); Wh.close(false); await frames(5);
      check(A.list.length === n && I.count('flecha') === arrows, 'an arrow went off');
    } finally { g.use = use; keys.use = false; Wh.cancel(true); CAM.first = false; CAM.yaw = yaw; draw(); I.slots.splice(0, I.slots.length, ...kept); I.select(sel); A.drawT = null; }
  });
  await test('rueda: with the minimal and the full interface, and over an open window', async () => {
    const Wh = game.wheel, W = game.windows, el = id => document.getElementById(id), I = inv(), sel = I.selected;
    const press = (code, type = 'keydown') => dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    try {
      useSmartHud(game, true); await frames(2); draw();
      Wh.show(); draw();
      check(el('hud-status').classList.contains('hm-on') && !el('hotbar-slots').classList.contains('hm-on'), 'minimal: the health block does not show or the hotbar does');
      Wh.close(false); draw();
      // Tab does nothing over it (and the minimal interface does not show everything)
      Wh.show(); press('Tab'); check(!game.smartHud.held, 'Tab shows everything over the wheel'); press('Tab', 'keyup'); Wh.close(false);
      useSmartHud(game, false); draw();
      Wh.show(); draw(); Wh.close(false); draw();
      check(!document.body.classList.contains('wheel-open') && !el('wheel').classList.contains('on') && !el('wheel-vignette').classList.contains('on'), 'full: classes left behind');
      // Over a window: on top of it, and the mouse is the wheel's (not the window's, not the canvas's)
      W.open('s-inv'); draw();
      Wh.show();
      check(+getComputedStyle(el('wheel')).zIndex > +(el('s-inv').style.zIndex || getComputedStyle(el('s-inv')).zIndex), 'the wheel is under the window');
      let heard = 0; const spy = () => { heard++; };
      for (const t of ['pointermove', 'pointerdown', 'pointerup', 'click', 'wheel']) el('s-inv').addEventListener(t, spy);
      const mouseWas = JSON.stringify(game.mouse);
      el('wheel').dispatchEvent(new PointerEvent('pointermove', { movementX: 0, movementY: 90, bubbles: true, pointerType: 'mouse' }));
      check(Wh.sel === 4 || Wh.sel === 5, `over the wheel the mouse does not pick: ${Wh.sel}`);
      el('s-inv').dispatchEvent(new PointerEvent('pointermove', { movementX: 0, movementY: -200, bubbles: true, pointerType: 'mouse' }));
      check(Wh.sel === 0, `over the window the mouse does not reach the wheel: ${Wh.sel}`);
      document.getElementById('c').dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 5, movementX: 3, bubbles: true, pointerType: 'mouse' }));
      check(JSON.stringify(game.mouse) === mouseWas, 'the canvas hears the mouse with the wheel open');
      const wh = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }); el('s-inv').dispatchEvent(wh);
      check(Wh.sel === 1 && wh.defaultPrevented, `the mouse wheel over the window: slot ${Wh.sel}, scroll stopped ${wh.defaultPrevented}`);
      // Keys: nothing opens; Esc closes it without the pause
      for (const k of ['KeyI', 'KeyC', 'KeyJ', 'KeyM']) press(k);
      check(!W.isOpen('s-craft') && !W.isOpen('s-journal') && W.isOpen('s-inv') && game.mode === 'play', `a key opened something: mode ${game.mode}`);
      el('s-inv').dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, cancelable: true }));
      el('s-inv').dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true, cancelable: true }));
      el('s-inv').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      check(!Wh.open && I.selected === 1 && heard === 0, `the click over the window: open ${Wh.open}, slot ${I.selected}, the window heard ${heard}`);
      for (const t of ['pointermove', 'pointerdown', 'pointerup', 'click', 'wheel']) el('s-inv').removeEventListener(t, spy);
      // A long click: its up and click come after a while, and still nothing hears them
      Wh.show(); Wh.move(0, 90);
      el('s-inv').dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, cancelable: true }));
      await sleep(600);
      let late = 0; const spy2 = () => { late++; };
      for (const t of ['pointerup', 'click']) el('s-inv').addEventListener(t, spy2);
      el('s-inv').dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true, cancelable: true }));
      el('s-inv').dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true }));
      el('s-inv').dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true }));
      for (const t of ['pointerup', 'click']) el('s-inv').removeEventListener(t, spy2);
      check(late === 1, `a long click: the window heard ${late} (wanted only the second click)`);
      I.select(1);
      // Opened again after cancelling on another slot: only one slot lit (the number gold and the icon big)
      Wh.show(); Wh.sx = Wh.sy = 0; Wh.move(0, 90); press('Escape');
      I.select(2); Wh.show();
      const lit = Wh.nums.filter(n => n.classList.contains('on')).length, big = Wh.slots.filter(w => /scale/.test(w.style.transform)).length, paths = Wh.paths.filter(q => q.classList.contains('on')).length;
      check(lit === 1 && big === 1 && paths === 1 && Wh.nums[2].classList.contains('on'), `opened again: ${lit} numbers lit, ${big} icons big, ${paths} sectors`);
      Wh.close(false); I.select(1);
      Wh.show(); press('Escape'); check(!Wh.open && game.mode === 'play' && W.isOpen('s-inv'), `Esc: open ${Wh.open}, mode ${game.mode}`);
    } finally { Wh.cancel(true); W.closeAll(); useSmartHud(game, false); I.select(sel); draw(); }
  });
  await test('herramientas a la vista (stowed tools): which ones and where, without the one in hand, at most four and the quiver', async () => {
    const make = (list, bag = false) => { const I = new Inventory({ slots: list.map(id => (id ? { id, n: id === 'flecha' ? 12 : 1 } : null)) }); if (bag) I.equip.espalda = { id: 'mochila' }; return I; };
    const I = make(['pico_hierro', 'pan', 'guadana_hierro', 'flecha']);
    const ids = kitOf(I); I.selected = 2; check(kitKey(kitOf(I)) === kitKey(ids), 'what shows depends on the slot picked');
    check(kitKey(ids) === 'pico_hierro,guadana_hierro,flecha:6', `kit: ${kitKey(ids)}`);
    const placed = placeKit(ids), spot = (list, id) => list.find(s => s.id === id)?.spot;
    const free = shownOf(placed, 'pan'), held = shownOf(placed, 'pico_hierro');
    check(free === placed, 'with bread in hand something hides');
    check(!spot(held, 'pico_hierro') && spot(held, 'guadana_hierro') === spot(free, 'guadana_hierro'), `the scythe moves when the pickaxe is in hand: ${spot(held, 'guadana_hierro')} / ${spot(free, 'guadana_hierro')}`);
    const many = placeKit(kitOf(make(['hacha_hierro', 'pico_hierro', 'guadana_hierro', 'azada_hierro', 'pala_hierro', 'cana', 'red', 'espada', 'flecha'])));
    check(many.filter(s => s.kind !== 'flecha').length <= 4 && many.some(s => s.spot === 'quiver'), `${many.length} shown: ${many.map(s => s.spot + ':' + s.id).join()}`);
    check(new Set(many.map(s => s.spot)).size === many.length, 'two in the same place');
    const bow = placeKit(kitOf(make(['arco', 'flecha'])));
    check(shownOf(bow, 'arco').some(s => s.spot === 'quiver') && !shownOf(bow, 'arco').some(s => s.kind === 'arco'), 'the bow in hand: no quiver, or the bow still on the back');
    check(spot(placeKit(kitOf(make(['regadera'], true)), { bag: true }), 'regadera') === 'bagSide' && spot(placeKit(kitOf(make(['regadera']))), 'regadera') === 'hipR', 'the watering can');
    check(kindOf('pala_llena') === 'pala' && kitOf(make(['pala_llena']))[0] === 'pala_hierro', 'the full shovel');
    check(kitKey(splitKit('cosa_nueva,hacha_hierro,flecha:6')) === 'hacha_hierro,flecha:6', 'an unknown id gets in');
    check(splitKit('x'.repeat(400)).length === 0, 'a huge kt');
    check(shownOf(placed, 'pico_hierro', { swimming: true }).length === placed.length, 'swimming, the one in hand leaves a gap');
    check(shownOf(placed, 'pico_hierro', { pose: 'lie' }).length === 0 && shownOf(placed, null, { pose: 'sit' }).length === 0, 'lying or sitting something shows');
    const armed = placeKit(kitOf(make(['espada', 'hacha_hierro', 'pico_hierro'])));
    check(shownOf(armed, null, { pose: 'ride' }).every(s => s.spot !== 'hipL' && s.spot !== 'hipR') && shownOf(armed, null, { pose: 'ride' }).some(s => s.spot === 'backA'), 'riding: the hips show, or the back does not');
    check(shownOf(armed, 'espada').find(s => s.spot === 'hipL')?.id === SCABBARD && shownOf(armed, 'espada').length === armed.length, 'the sword drawn: its scabbard does not stay');
    check(shownOf(placed, 'pico_hierro', { arms: 'across' }).every(s => s.spot !== 'backA' && s.spot !== 'backB'), 'arms busy across');
  });
  await test('herramientas a la vista: on the body, through the network, hidden lying and far away', async () => {
    const P = new RealPerson(LOOK), A = game.view3d.actors, live = game.live, I = inv(), kept = I.slots.slice(), sel = I.selected, ents = live.entities;
    try {
      const made = P.setKit(buildKit(shownOf(placeKit(['hacha_hierro', 'pico_hierro', 'espada', 'flecha'])), P.bagFit(), P.beltFit(), stowedGeo));
      check(made.length === 2 && P.kit.back.parent === P.r.bones.torso && P.kit.hip.parent === P.r.bones.body, `meshes: ${made.length}`);
      const back = P.kit.back; P.setKit(buildKit(shownOf(placeKit(['pico_hierro'])), P.bagFit(), P.beltFit(), stowedGeo));
      check(P.kit.back === back && !P.kit.hip.visible, 'a new kit makes new meshes, or the empty hip shows');
      check(stowedGeo('pico_hierro').attributes.position.array.length > 0, 'the baked tool was released');
      P.dispose();
      // Other players: with kt they carry it, without it nothing, and an id from a newer version does not break anything
      for (const [c, kt] of [['k1', 'hacha_hierro,flecha'], ['k2', undefined], ['k3', 'cosa_nueva']]) {
        live.receive(c, { t: 'hi', id: 'id-' + c, name: c, playing: true, look: LOOK });
        live.receive(c, { t: 'st', sc: 'world', x: p().x + 1.5, y: p().y + 0.5, yaw: 0, kt, h: 'pan' });
      }
      live.entities = sc => (sc === game.world ? live.others.filter(o => o.entity).map(o => o.entity) : null);
      draw(); draw();
      const mOf = c => A.models.get(live.peers.get(c).entity), m1 = mOf('k1');
      check(m1?.person?.kit?.back?.userData.has, 'the other player shows nothing');
      check(!mOf('k2')?.person?.kit?.back?.userData.has && !mOf('k3')?.person?.kit?.back?.userData.has, 'without kt (or with an unknown id) something shows');
      const geo = m1.person.kit.back.geometry;
      for (let i = 0; i < 10; i++) draw();
      check(m1.person.kit.back.geometry === geo, 'the same kt rebuilds the kit');
      live.peers.get('k1').entity.pose = { kind: 'lie', yaw: 0, h: 0 }; draw();
      check(!m1.person.kit.back.visible && !m1.person.kit.hip.visible, 'lying it shows');
      // The player: ten switches between tools and other things leave no materials or meshes behind, and kt stays
      I.slots.fill(null); ['pico_hierro', 'pan', 'pala_hierro', 'madera', 'hacha_hierro', 'espada', 'flecha'].forEach((id, i) => { I.slots[i] = { id, n: 1 }; }); I.select(1); I.changed(); draw(); draw();
      const me = A.player, mats = me.mats.length, body = me.body.length, kit = { ...me.person.kit }, kt = kitKey(game.kitIds());
      check(me.person.kit?.back?.userData.has, 'the player shows nothing');
      for (let i = 0; i < 10; i++) { I.select(i % 7); draw(); check(kitKey(game.kitIds()) === kt, 'kt changes with the slot'); }
      I.select(1); draw();
      check(me.mats.length === mats && me.body.length === body, `materials: ${mats} → ${me.mats.length}, ${body} → ${me.body.length}`);
      check(me.person.kit.back === kit.back && me.person.kit.hip === kit.hip, 'the meshes were made again');
      // The backpack on and off: the same places, somewhere else (on its face, or back on the body)
      const bagWas = I.equip.espalda;
      delete I.equip.espalda; I.changed(); draw(); draw();
      const bagGeo = me.person.kit.back.geometry;
      I.equip.espalda = { id: 'mochila', color: ITEMS.mochila.dye }; I.changed(); draw(); draw();
      const onBag = me.person.kit.back.geometry;
      check(onBag !== bagGeo && me.kitShown.startsWith('B|'), `putting the backpack on leaves the tools where they were: ${me.kitShown}`);
      delete I.equip.espalda; I.changed(); draw(); draw();
      check(me.person.kit.back.geometry !== onBag && !me.kitShown.startsWith('B|'), 'taking the backpack off leaves the tools where they were');
      if (bagWas) { I.equip.espalda = bagWas; I.changed(); draw(); }
      // Riding and crouching: rebuilt (higher on the back, nothing at the hips; the hips tilted back)
      const P0 = p(), was = { mount: P0.mount, crouch: P0.crouch };
      try {
        P0.crouch = true; draw(); check(me.kitShown.includes('|crouch|'), `crouching: ${me.kitShown}`);
        P0.crouch = false; P0.mount = true; draw(); check(me.kitShown.includes('|ride|') && !/hip[LR]:/.test(me.kitShown), `riding: ${me.kitShown}`);
      } finally { P0.mount = was.mount; P0.crouch = was.crouch; draw(); }
      // Far away: hidden
      me.tier = 2; A.kit(me, p(), me.person, null, false); check(!me.person.kit.back.visible, 'far away it shows'); me.tier = 0; A.kit(me, p(), me.person, null, false);
      // The inventory's preview: it gets the tools, and keeps them when the look changes
      game.windows.open('s-inv');
      for (let i = 0; i < 30 && !game.invPreview?.person?.kit; i++) await sleep(100);   // (its own frame loop: it may take a few)
      const pv = game.invPreview;
      check(pv?.person?.kit?.back?.userData.has, `the preview does not show the tools: ${pv?.kitIds}, person ${!!pv?.person}, kit ${Object.keys(pv?.person?.kit || {})}, show ${document.getElementById('s-inv').classList.contains('show')}`);
      I.equip.cabeza = { id: 'sombrero', color: ITEMS.sombrero?.dye }; I.changed(); await sleep(150);
      check(pv.person?.kit?.back?.userData.has, 'after a change of clothes the preview lost the tools');
    } finally {
      delete I.equip.cabeza; game.windows.closeAll(); live.entities = ents;
      for (const c of ['k1', 'k2', 'k3']) live.peers.delete(c);
      I.slots.splice(0, I.slots.length, ...kept); I.select(sel); I.changed(); draw();
    }
  });
  // ---------- greeting, provoking and the village's reputation (social.js, reputation.js) ----------
  const So = () => game.social, Rp = () => game.rep, Nb = () => game.neighbors, nb = id => Nb().people.find(n => n.id === id);
  const keyY = (type = 'keydown') => dispatchEvent(new KeyboardEvent(type, { code: 'KeyY', key: 'y', bubbles: true, cancelable: true }));
  const aimAtE = (e, h = 1) => { const v = new THREE.Vector3(e.x, game.view3d.groundY(w(), e.x, e.y) + h, e.y).project(game.view3d.camera); game.mouse = { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, in: true }; };
  // A neighbor stopped at (x, y), out (their schedule would walk them off: hold keeps them still)
  const put = (id, x, y) => { const n = nb(id); n.x = x; n.y = y; n.hidden = false; n.path = []; n.hold = 1e6; return n; };
  const cand = id => So().candidates().find(c => c.id === id);
  const today = () => game.days.dayIndex;
  // Each one from a clean state (survival at 11:00, the neighbors held far away, a new reputation and new friendships),
  // and everything put back after
  const social = fn => async () => {
    const keep = { rep: JSON.stringify(Rp().v), friends: JSON.stringify(Nb().friends), flags: JSON.stringify(Nb().flags), mouse: game.mouse, ask: hud.ask, say: hud.say, nilo: [w().nilo.x, w().nilo.y], slots: inv().slots.slice(), sel: inv().selected };
    runCommand(game, '/gamemode survival', () => {}); runCommand(game, '/time set 11:00', () => {});
    for (const n of Nb().people) if (!n.def.seat) put(n.id, 300 + Math.random() * 9, 300);
    Rp().v = { v: 1, pts: 0, lvl: 'newcomer', log: [], cap: {}, taken: {}, knocks: {} };
    Nb().friends = {}; So().reset(); So().lastAt = -Infinity;
    hud.say = () => Promise.resolve();
    try { await fn(); }
    finally {
      Rp().v = JSON.parse(keep.rep); Nb().friends = JSON.parse(keep.friends); Nb().flags = JSON.parse(keep.flags);
      game.mouse = keep.mouse; hud.ask = keep.ask; hud.say = keep.say; [w().nilo.x, w().nilo.y] = keep.nilo;
      inv().slots.splice(0, inv().slots.length, ...keep.slots); inv().select(keep.sel); inv().changed();
      So().reset(); So().lastAt = -Infinity; game.busy = false; game.build.on = false; CAM.first = false; game.mode = 'play';
      runCommand(game, '/gamemode survival', () => {});
      const P = p(); Object.assign(P, { swim: false, boat: false, mount: false, aboard: null, pose: null });
      for (const n of Nb().people) { n.hold = 0; n.placeAt(game.days.hour); }
    }
  };
  await test('saludo (greet): Y saluda al vecino apuntado, contesta con gesto y frase, y la amistad sube una vez al día', social(async () => {
    await goTo(game, 21, 27); const P = p(), r = put('rosa', 23, 27); draw();
    const gestures = [], em = So().emote.bind(So()); So().emote = (e, k) => { gestures.push([e, k]); em(e, k); };
    try {
      aimAtE(r); const seq = So().emSeq;
      keyY(); await frames(6); keyY('keyup'); r.hold = 0;
      check(So().emSeq === seq + 1 && gestures.some(([e, k]) => e === P && k === 'wave'), `my gesture: ${gestures.map(g => g[1])}`);
      const mine = So().bubbles.find(b => b.e === P);
      check(mine?.mine && tList(So().dayKey()).some(l => mine.text === formatMessage(l, { name: 'Rosa' })), `my line: ${mine?.text}`);
      await frames(45);
      const hers = So().bubbles.find(b => b.e === r);
      check(hers?.name === 'Rosa' && hers.text, 'Rosa does not answer');
      check(gestures.some(([e, k]) => e === r && k === REPLY_GESTURE.greet.cheerful.neutral), `her gesture: ${gestures.map(g => g[1])}`);
      check(r.hold > 0 && r.hold <= 1.8, `she does not stop: ${r.hold}`);
      const f = Nb().friend('rosa');
      check(f.pts === 5 && f.greet === today() && Rp().pts === 2, `friendship ${f.pts}, reputation ${Rp().pts}`);
      So().lastAt = -Infinity; So().act(0, cand('rosa'));
      check(Nb().friend('rosa').pts === 5 && Rp().pts === 2, 'a second greeting the same day counts again');
    } finally { delete So().emote; }
  }));
  await test('saludo: el clic derecho sobre una persona saluda; sobre nada sienta al perro; en modo B quita', social(async () => {
    await goTo(game, 21, 27); const r = put('rosa', 23, 27); draw();
    const canvas = document.getElementById('c'), B = game.build, sit = game.ranch.sitAt, rm = B.removeAt;
    const down = (x, y) => canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 2, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'mouse' }));
    const up = () => dispatchEvent(new PointerEvent('pointerup', { button: 2, bubbles: true, pointerType: 'mouse' }));
    let sat = 0, removed = 0;
    game.ranch.sitAt = () => { sat++; }; B.removeAt = () => { removed++; };
    try {
      aimAtE(r); let seq = So().emSeq;
      down(game.mouse.x, game.mouse.y); await frames(3); up();
      check(So().emSeq === seq + 1 && !sat, `on Rosa: gesture ${So().emSeq - seq}, dog ${sat}`);
      await frames(45); check(So().bubbles.some(b => b.e === r), 'Rosa does not answer the right click');
      So().lastAt = -Infinity; seq = So().emSeq;
      down(3, 3); up(); check(sat === 1 && So().emSeq === seq, `on nothing: dog ${sat}, gesture ${So().emSeq - seq}`);
      B.on = true; So().lastAt = -Infinity;
      down(game.mouse.x, game.mouse.y); up(); check(removed === 1 && So().emSeq === seq && sat === 1, `in build mode: removed ${removed}, gesture ${So().emSeq - seq}`);
    } finally { game.ranch.sitAt = sit; B.removeAt = rm; B.on = false; }
  }));
  await test('saludo: de lejos se ve pero solo cuenta a 4 casillas; tope de +6 al día; al aire sin nadie; nada en diálogo, mapa o espectador', social(async () => {
    await goTo(game, 21, 27); const P = p();
    put('rosa', 26.5, 27); So().act(0, cand('rosa'));
    check(So().bubbles.some(b => b.e === P) && Nb().friend('rosa').pts === 0 && Rp().pts === 0, `5.5 tiles away it counts: ${Nb().friend('rosa').pts}, ${Rp().pts}`);
    Rp().v.cap = { day: today(), greet: 4 };
    put('lia', 22.5, 27); So().lastAt = -Infinity; So().act(0, cand('lia'));
    put('bruno', 21, 28.5); So().lastAt = -Infinity; So().act(0, cand('bruno'));
    check(Rp().pts === 2 && Nb().friend('lia').pts === 5 && Nb().friend('bruno').pts === 5, `the cap: reputation ${Rp().pts}, Lía ${Nb().friend('lia').pts}, Bruno ${Nb().friend('bruno').pts}`);
    // Nobody: to the air (gesture and line, no answer); Y with the cursor out of the game
    for (const id of ['rosa', 'lia', 'bruno']) put(id, 300, 300);
    w().nilo.x = 60; game.mouse = { x: 3, y: 3, in: false }; So().reset(); So().lastAt = -Infinity;
    let seq = So().emSeq; So().press('key'); So().release('key');
    const air = So().bubbles.find(b => b.e === P);
    check(So().emSeq === seq + 1 && air && tList('social.say.air').includes(air.text) && !So().queue.length, `to the air: ${air?.text}, queue ${So().queue.length}`);
    // Talking, the big map, a spectator: nothing
    seq = So().emSeq;
    for (const [what, on, off] of [
      ['a dialogue', () => { game.busy = true; }, () => { game.busy = false; }],
      ['the map', () => { game.mode = 'map'; }, () => { game.mode = 'play'; }],
      ['spectator', () => runCommand(game, '/gamemode spectator', () => {}), () => runCommand(game, '/gamemode survival', () => {})],
    ]) {
      on(); So().lastAt = -Infinity; keyY(); keyY('keyup'); So().press('key'); So().release('key'); off();
      check(So().emSeq === seq && !So().hold, `with ${what} it greets`);
    }
  }));
  await test('saludo: el aviso de E solo añade «Y: saludar» si es la misma persona; con la E en una puerta, nada', social(async () => {
    const text = () => document.getElementById('prompt-text').textContent, look = async e => { aimAtE(e); So().pickT = 0; await frames(2); draw(); };
    await goTo(game, 21, 27); draw();
    const r = put('rosa', 22.3, 27); await look(r);
    check(text().includes('Hablar con Rosa') && text().endsWith(t('social.prompt')) && document.querySelector('#prompt kbd').textContent === 'E', `next to Rosa: «${text()}»`);
    // Farther than E reaches: only her name and Y
    put('rosa', 25.5, 27.5); await look(nb('rosa'));
    check(text() === t('social.prompt.far', { name: 'Rosa' }) && document.querySelector('#prompt kbd').textContent === 'Y', `far: «${text()}», key ${document.querySelector('#prompt kbd').textContent}`);
    // E on a door, with Rosa next to it: nothing added
    await goTo(game, 21.5, 17.8); draw(); put('rosa', 22.6, 18.4);
    aimAtE({ x: 21.5, y: 16.5 }, 1.1); So().pickT = 0; await frames(2); draw();
    check(/puerta/i.test(text()) && !text().includes(t('social.prompt')) && document.querySelector('#prompt kbd').textContent === 'E', `on the door: «${text()}»`);
  }));
  await test('saludo: la E y el borde amarillo no cambian con otro jugador delante de un cofre', social(async () => {
    const live = game.live, was = live.joined;
    await goTo(game, 40, 40); const P = p();
    const [tx, ty] = freeTile(game, [[41, 38], [42, 38], [41, 39]]); w().place(tx, ty, 'cofre');
    P.x = tx + 0.5; P.y = ty + 2.1; draw(); draw();
    // (the other player on the way from the camera to the chest, close to it)
    const cam = game.view3d.camera.position, dx = tx + 0.5 - cam.x, dy = ty + 0.5 - cam.z, dl = Math.hypot(dx, dy), ox = tx + 0.5 - dx / dl * 0.9, oy = ty + 0.5 - dy / dl * 0.9;
    try {
      live.receive('so1', { t: 'hi', id: 'id-so1', name: 'Pepa', playing: true, look: LOOK });
      live.receive('so1', { t: 'st', sc: 'world', x: ox, y: oy, yaw: 0 });
      live.joined = true; draw();
      aimAtE({ x: tx + 0.5, y: ty + 0.5 }, 0.4);
      check(/cofre/i.test(game.nearest()?.text || ''), `E says: ${game.nearest()?.text}`);
      draw(); check(game.highlight?.kind === 'placed' && game.highlight.o?.placed === 'cofre', `outlined: ${game.highlight?.kind}`);
      So().pickT = 0; So().update(0.01);
      check(So().picked?.kind === 'player', `the greeting does not see the other player on the way: ${So().picked?.kind}`);
      check(So().promptFor(game.highlight.e || null, true) === '', 'the prompt adds the greeting for someone else');
    } finally { live.joined = was; live.peers.delete('so1'); w().setTile(tx, ty, 'air'); }
  }));
  await test('saludo: nadando y remando solo la frase; a caballo, sentado y de pasajero con gesto; en primera persona, subtítulo', social(async () => {
    await goTo(game, 21, 27); const P = p(); put('rosa', 22.5, 27);
    for (const [what, set, gesture] of [['swimming', { swim: true }, false], ['rowing', { boat: true }, false], ['riding', { mount: true }, true], ['sitting', { pose: { kind: 'sit', yaw: 0, h: 0 } }, true],
      ['aboard', { aboard: 'x' }, true], ['lying', { pose: { kind: 'floorLie', yaw: 0, h: 0 } }, false]]) {
      Object.assign(P, set); const seq = So().emSeq; So().bubbles = []; So().lastAt = -Infinity;
      So().act(0, cand('rosa'));
      const line = So().bubbles.some(b => b.e === P);
      Object.assign(P, { swim: false, boat: false, mount: false, aboard: null, pose: null });
      check(line && (So().emSeq > seq) === gesture, `${what}: line ${line}, gesture ${So().emSeq > seq}`);
    }
    CAM.first = true; So().bubbles = []; So().lastAt = -Infinity; So().act(0, cand('rosa'));
    check(So().sub.classList.contains('on') && So().sub.textContent && !So().bubbles.some(b => b.e === P), 'first person: no subtitle, or a bubble over me');
    await frames(45); check(So().bubbles.some(b => b.e === nb('rosa')), 'first person: Rosa does not answer in her bubble');
    CAM.first = false;
  }));
  await test('increpar (carga): soltar a 0,5 s saluda sin anillo antes de 0,25 s; mantener 0,7 s increpa', social(async () => {
    await goTo(game, 21, 27); const b = put('bruno', 22.8, 27); draw(); aimAtE(b);
    const ring = () => So().ring.classList.contains('on');
    let seq = So().emSeq;
    So().press('key'); await frames(12); check(!ring(), 'the ring shows at 0.2 s');
    await frames(18); check(ring(), 'no ring at 0.5 s');
    So().release('key'); check(!ring() && So().emSeq === seq + 1 && EMOTE_KINDS[So().emKind] === 'wave', `let go at 0.5 s: ${EMOTE_KINDS[So().emKind]}`);
    So().lastAt = -Infinity; seq = So().emSeq;
    So().press('key'); await frames(45);
    check(So().emSeq === seq + 1 && ['fist', 'point', 'dismiss'].includes(EMOTE_KINDS[So().emKind]) && !So().hold && !ring(), `held 0.75 s: ${EMOTE_KINDS[So().emKind]}`);
    So().release('key'); check(So().emSeq === seq + 1, 'letting go after provoking greets too');
    check(Rp().pts === -6 && Nb().friend('bruno').pts === 0, `greeting and provoking: ${Rp().pts}`);
  }));
  await test('increpar (provoke): baja amistad (−10 la primera con un amigo, −20 si no) y reputación, contesta frío ese día y a la tercera no habla', social(async () => {
    await goTo(game, 21, 27); const r = put('rosa', 22.5, 27), b = put('bruno', 21, 28.5), fr = Nb().friend('rosa');
    fr.pts = 500; fr.events = [3, 6];   // (her friendship moments, already seen: talking goes straight to the options)
    check(So().relation('rosa') === 'friend', `5 hearts: ${So().relation('rosa')}`);
    So().act(1, cand('rosa')); check(fr.pts === 490 && fr.insultedAt === today() && Rp().pts === -8, `first with a friend: ${fr.pts}, ${Rp().pts}`);
    check(So().relation('rosa') === 'cold', `after: ${So().relation('rosa')}`);
    So().lastAt = -Infinity; So().act(1, cand('rosa')); check(fr.pts === 470, `second: ${fr.pts}`);
    const fb = Nb().friend('bruno'); fb.pts = 150;
    for (let i = 0; i < 3; i++) { So().lastAt = -Infinity; So().act(1, cand('bruno')); }
    check(fb.pts === 90 && fb.snub === today() && Rp().pts === -40, `Bruno: ${fb.pts}, snub ${fb.snub}, reputation ${Rp().pts} (the day cap is -40)`);
    let seen = null;
    hud.ask = (who, text, opts) => { seen = { text, opts }; return Promise.resolve(opts.indexOf('Adiós')); };
    await Nb().talk('bruno', b);
    check(!seen.opts.includes('Charlar') && tList(seen.opts.includes('Ver la tienda') ? 'npc.refuse.shop' : 'npc.refuse').includes(seen.text), `Bruno talks: «${seen.text}» ${seen.opts}`);
    const talked = fr.talk; await Nb().talk('rosa', r);
    check(seen.opts.includes('Charlar') && tList('npc.reproach').includes(seen.text) && fr.talk === talked, `Rosa: «${seen.text}», chat counted ${fr.talk !== talked}`);
    await frames(45); check(So().bubbles.some(x => x.e === b), 'Bruno does not answer');
  }));
  await test('reputacion (reputation): niveles, precios de compra y venta, la línea de la tienda, el diario y el aviso al cambiar de nivel', social(async () => {
    for (const [pts, id] of [[-1000, 'outcast'], [-401, 'outcast'], [-400, 'distrusted'], [-121, 'distrusted'], [-120, 'newcomer'], [99, 'newcomer'], [100, 'known'], [300, 'liked'], [599, 'liked'], [600, 'beloved'], [1000, 'beloved']]) {
      check(levelOf(pts).id === id, `${pts}: ${levelOf(pts).id}`);
    }
    Rp().v.pts = -800; Rp().v.lvl = 'outcast';
    check(Rp().buyFactor() === 1.35 && Rp().sellFactor() === 0.75, 'outcast factors');
    check(Rp().shopNote() === t('rep.shopnote', { sign: '+', n: 35, level: t('rep.level.outcast') }), `shop line: ${Rp().shopNote()}`);
    runCommand(game, '/gamemode creative', () => {}); check(Rp().buyFactor() === 1 && Rp().shopNote() === '', 'creative changes the prices'); runCommand(game, '/gamemode survival', () => {});
    // The shop itself: dearer to buy, cheaper to sell, and it says why
    inv().add('manzana', 2);
    game.onShop('rosa');
    try {
      check(document.getElementById('sh-note').textContent === Rp().shopNote(), `the note: ${document.getElementById('sh-note').textContent}`);
      const e = SHOPS.rosa.stock.find(s => s.id && (!s.seasons || s.seasons.includes(game.days.season)) && !s.project && !s.plan), d = Nb().flags.descuento ? 0.9 : 1;
      const want = Math.round((e.price ?? buyPrice(e.id)) * d * 1.35);
      check([...document.querySelectorAll('#sh-list .sh-row small')].some(s => s.textContent.startsWith(`${want} `)), `no row at ${want} for ${e.id}`);
      document.querySelector('[data-shtab="sell"]').click();
      const sell = Math.max(1, Math.round(priceOf('manzana') * 0.75));
      check([...document.querySelectorAll('#sh-list .sh-row')].some(r => r.textContent.includes(ITEMS.manzana.name) && r.textContent.includes(`${sell} `)), `no apple at ${sell}`);
    } finally { document.getElementById('sh-close').click(); game.mode = 'play'; }
    const html = Rp().journal();
    check(html.includes(t('rep.level.outcast')) && html.includes(t('rep.title')) && html.includes('rep-bar'), 'the journal does not say it');
    // The notice when the level changes, up and down
    const toasts = [], toast = hud.toast; hud.toast = (m, k) => toasts.push([m, k]);
    try {
      Rp().v.pts = 95; Rp().v.lvl = 'newcomer';
      Rp().change(10, 'errand'); check(toasts.at(-1)?.[0] === t('rep.toast.up', { level: t('rep.level.known') }) && Rp().v.lvl === 'known', `up: ${toasts.at(-1)}`);
      Rp().change(3, 'errand'); check(toasts.length === 1, 'a notice without a new level');
      Rp().change(-20, 'take'); check(toasts.at(-1)?.[0] === t('rep.toast.down', { level: t('rep.level.newcomer') }), `down: ${toasts.at(-1)}`);
    } finally { hud.toast = toast; }
  }));
  await test('reputacion: encargo, proyecto, regalo, trato y perdón diario la suben; topes del día con días de otro mundo (!==)', social(async () => {
    const I = inv(), B = game.board, rq = B.requests().find(r => !r.done);
    check(rq, 'no errand left today');
    I.add(rq.item, rq.n);
    let asked = 0;
    hud.ask = (who, text, opts) => Promise.resolve(asked++ ? opts.length - 1 : rq.i);
    await B.open();
    check(Rp().pts === 10 && Rp().v.log.at(-1)[2] === 'errand', `errand: ${Rp().pts}`);
    check(Rp().change(60, 'project') === 60, 'a project');   // (paying one for real changes the village for the other tests)
    // A gift she loves, while the village distrusts you: double
    Rp().v.pts = -500; Rp().v.lvl = 'distrusted';
    I.add('fresa', 1); holdItem(I, 'fresa');
    await Nb().gift('rosa', I.held);
    check(Rp().pts === -484 && Rp().v.log.at(-1)[2] === 'gift_loved', `gift: ${Rp().pts}`);
    // A trade, then at most five a day
    Rp().v.pts = 0; Rp().v.lvl = 'newcomer'; I.add('trigo', 20); asked = 0;
    hud.ask = (who, text, opts) => Promise.resolve(asked++ ? opts.length - 1 : 0);
    await Nb().trade('rosa');
    check(Rp().pts === 1, `trade: ${Rp().pts}`);
    for (let i = 0; i < 6; i++) Rp().change(1, 'trade');
    check(Rp().pts === 5, `five trades a day: ${Rp().pts}`);
    // Forgiving every morning, only below zero
    Rp().v.pts = -50; Rp().onDay(today()); check(Rp().pts === -40, `forgive: ${Rp().pts}`);
    Rp().v.pts = 50; Rp().onDay(today()); check(Rp().pts === 50, 'forgives above zero');
    // A cap kept with a day of another world (a guest plays with the host's calendar) is not today's
    Rp().v.cap = { day: today() + 3, greet: 6 }; check(Rp().change(2, 'greet') === 2, 'a cap of another day stops it');
    check(Rp().change(6, 'greet') === 4, 'the cap of today');
    check(!recent(today(), today() + 2, 3) && recent(today(), today() - 3, 3) && !recent(today(), today() - 4, 3) && !recent(today(), undefined, 3), 'recent');
  }));
  // A wall of Rosa's house with a roof over it, still as the village made it
  function rosaWall(skip = []) {
    const h = HOUSES.rosa, W = w();
    for (let tx = h.x0 + 7; tx < h.x1 - 1; tx++) {
      const t = [tx, h.y1 - 1], raw = W.at('placed', ...t);
      if (raw && PIECES[parsePlaced(raw)[0]]?.kind === 'wall' && W.at('roof', ...t) && !W.ownAt('placed', ...t) && !W.ownAt('roof', ...t) && !skip.some(s => s[0] === tx)) return t;
    }
    throw new Error('no wall left in Rosa\'s house');
  }
  await test('reputacion: quitar de la casa de Rosa baja; con Rosa en casa (escondida) es testigo desde dentro y baja más', social(async () => {
    const B = game.build, t1 = rosaWall();
    await goTo(game, t1[0] + 0.5, t1[1] + 1.6); game.mouse = null; w().nilo.x = 60;
    Nb().friend('rosa').pts = 200;
    B.toggle(true); B.select('quitar');
    try {
      B.remove(t1); check(!w().at('roof', ...t1), 'the roof stays');
      check(Rp().pts === -12 && Rp().v.log.at(-1)[2] === 'take' && Rp().v.taken[`roof:${t1}`]?.[0] === 12, `nobody saw it: ${Rp().pts} ${JSON.stringify(Rp().v.taken)}`);
      nb('rosa').hidden = true;   // (at home)
      B.remove(t1); check(!w().at('placed', ...t1), 'the wall stays');
      check(Rp().pts === -37 && Rp().v.log.at(-1)[2] === 'take_seen' && Nb().friend('rosa').pts === 190, `Rosa at home: ${Rp().pts}, friendship ${Nb().friend('rosa').pts}`);
      const said = So().bubbles.find(b => b.name === t('npc.witness.inside', { name: 'Rosa' }));
      check(said && tList('npc.witness.take.own').includes(said.text), `what she says: ${JSON.stringify(So().bubbles.map(b => [b.name, b.text]))}`);
    } finally { B.toggle(false); }
  }));
  await test('reputacion: devolver una pieza recupera la mitad una vez; poner y quitar la misma pared suma 0; en creativo no cambia', social(async () => {
    const B = game.build, I = inv(), t1 = rosaWall(), station = B.stationFor;
    await goTo(game, t1[0] + 0.5, t1[1] + 2.5); game.mouse = null; w().nilo.x = 60;
    nb('rosa').hidden = true; nb('lia').hidden = false;
    B.toggle(true); B.select('quitar'); B.stationFor = () => true;   // (the stone wall wants the mason's table near: not what is tested)
    try {
      B.remove(t1); B.remove(t1);   // (the roof, then the wall: Rosa hears both)
      check(Rp().pts === -50, `taken: ${Rp().pts}`);
      I.add('piedra', 30); B.select('muro_piedra'); B.place(t1);
      check(w().ownAt('placed', ...t1) === 'muro_piedra' && Rp().pts === -37 && Rp().v.log.at(-1)[2] === 'return', `put back: ${Rp().pts}`);
      B.select('quitar'); B.remove(t1); check(Rp().pts === -50 && Rp().v.log.at(-1)[2] === 'retake', `taken again: ${Rp().pts}`);
      B.select('muro_piedra'); B.place(t1); B.select('quitar'); B.remove(t1); B.select('muro_piedra'); B.place(t1);
      check(Rp().pts === -37, `put and take, put and take: ${Rp().pts}`);
      // Picked up by hand (X) or moved with B › Move: the same as removing it
      const wall = { tile: t1, layer: 'placed', placed: 'muro_piedra' }; I.add('piedra', 30);
      check(game.pickUp(wall) && Rp().pts === -50 && Rp().v.log.at(-1)[2] === 'retake', `picked up with X: ${Rp().pts}`);
      B.place(t1); check(Rp().pts === -37, `put back again: ${Rp().pts}`);
      check(game.pickUp(wall, true) && Rp().pts === -50, `moved with B › Move: ${Rp().pts}`);
      B.place(t1); check(Rp().pts === -37, `and back: ${Rp().pts}`);
      B.select('quitar'); B.remove(t1);
      // In creative nothing changes
      runCommand(game, '/gamemode creative', () => {}); B.toggle(true); B.select('quitar');
      const before = Rp().pts, t2 = rosaWall([t1]); p().x = t2[0] + 0.5; p().y = t2[1] + 2.5;
      B.remove(t2); check(!w().at('roof', ...t2) && Rp().pts === before, `creative: ${Rp().pts}`);
    } finally { B.toggle(false); B.stationFor = station; }
  }));
  await test('reputacion: llamar de noche baja una vez por puerta y noche', social(async () => {
    const h = HOUSES.rosa, door = [h.x0 + 6, h.y1 - 1];
    check(game.vecinoAt(door) === 'rosa', 'not Rosa\'s door');
    await goTo(game, door[0] + 0.5, door[1] + 1.6);
    runCommand(game, '/time set 23:00', () => {});
    nb('rosa').hidden = true;
    game.knock(door); await sleep(1100);
    check(Rp().pts === -3 && Rp().v.log.at(-1)[2] === 'knock_night', `knocking at night: ${Rp().pts}`);
    game.knock(door); await sleep(1100);
    check(Rp().pts === -3, `twice the same night: ${Rp().pts}`);
  }));
  await test('reputacion: mal visto no charla pero la tienda abre más cara, los tratos siguen, regalar ayuda y Nilo siempre habla', social(async () => {
    Rp().v.pts = -800; Rp().v.lvl = 'outcast';
    runCommand(game, '/time set 12:00', () => {});
    const r = nb('rosa'); r.hold = 0; r.placeAt(12); r.update(0, 12);
    await goTo(game, r.x, r.y + 1.3);
    Nb().friend('rosa').pts = 100;
    const I = inv(); I.add('fresa', 1); holdItem(I, 'fresa');
    let seen = null;
    hud.ask = (who, text, opts) => { seen = { text, opts }; return Promise.resolve(opts.indexOf('Adiós')); };
    await Nb().talk('rosa', r);
    check(!seen.opts.includes('Charlar') && seen.opts.includes('Ver la tienda') && seen.opts.includes('Hacer tratos') && seen.opts.some(o => o.startsWith('Regalar')), `options: ${seen.opts}`);
    check(tList('npc.refuse.shop').includes(seen.text), `she says (at her stall): ${seen.text}`);
    check(Rp().buyFactor() === 1.35, 'the shop is not dearer');
    await Nb().gift('rosa', I.held); check(Rp().pts === -784, `the gift: ${Rp().pts}`);
    check(Rp().canTalk('nilo'), 'Nilo does not talk');
    if (game.craft.taught.has('banco')) { await Nb().talk('nilo'); check(seen.opts.includes('Charlar') && tList('npc.greet.cold').some(l => seen.text === formatMessage(l, { name: p().name })), `Nilo: «${seen.text}» ${seen.opts}`); }
  }));
  await test('reputacion: en creativo no tiene efectos (charlan, no hay frío por nivel ni «ignore»)', social(async () => {
    Rp().v.pts = -900; Rp().v.lvl = 'outcast';
    check(!Rp().canTalk('bruno') && So().relation('bruno') === 'cold', 'outcast in survival: they talk');
    runCommand(game, '/gamemode creative', () => {});
    check(Rp().canTalk('bruno') && So().relation('bruno') === 'neutral', `creative: talk ${Rp().canTalk('bruno')}, relation ${So().relation('bruno')}`);
    check(So().replyFor({ kind: 'npc', id: 'bruno', e: nb('bruno') }, 0, 'neutral').kind !== 'ignore', 'creative: they ignore you');
    check(Rp().buyFactor() === 1 && !Rp().eventsWait(), 'creative: dearer shop or events waiting');
  }));
  await test('reputacion: una partida vieja nace de lo hecho; se guarda y se carga igual', social(async () => {
    const st = game.stats, kept = { ...st.v };
    try {
      Rp().reset({}); check(Rp().pts === 0 && !Rp().v.seeded, `a new game: ${Rp().pts}`);
      Object.assign(st.v, { encargos: 10, proyectos: 2, regalos: 5 });
      Nb().friends = { rosa: { pts: 420, talk: -1, gift: -1, events: [] }, bruno: { pts: 150, talk: -1, gift: -1, events: [] } };
      Rp().reset({ inventory: {} });
      check(Rp().pts === 170 && Rp().v.seeded === 1 && Rp().v.lvl === 'known', `an old game: ${Rp().pts} ${Rp().v.lvl}`);
      st.v.proyectos = 30; Rp().reset({ inventory: {} }); check(Rp().pts === 400 && Rp().level.id === 'liked', `at most «Liked»: ${Rp().pts}`);
      Rp().change(-12, 'take'); Rp().v.taken['placed:1,2'] = [12, 0];
      const out = JSON.parse(JSON.stringify({ rep: game.snapshot().rep }));
      check(out.rep?.pts === 388, 'the save does not carry it');
      Rp().reset({}); Rp().reset(out);
      check(Rp().pts === 388 && Rp().v.log.at(-1)[2] === 'take' && Rp().v.taken['placed:1,2']?.[0] === 12 && Rp().v.seeded === 1, `loaded: ${JSON.stringify(Rp().v)}`);
    } finally { st.v = kept; }
  }));
  await test('red (net): el estado sin em/ek y un greet con índices raros o un vecino desconocido no rompen nada; diez greet seguidos del mismo peer dan un aviso', social(async () => {
    const live = game.live, was = { joined: live.joined, net: live.net }, sent = [], toasts = [], toast = hud.toast;
    await goTo(game, 21, 27);
    const st = (more = {}) => live.receive('sn1', { t: 'st', sc: 'world', x: p().x + 1.5, y: p().y, yaw: 0, ...more });
    try {
      live.receive('sn1', { t: 'hi', id: 'id-sn1', name: 'Pepa', playing: true, look: LOOK });
      st(); const e = live.peers.get('sn1').entity;
      check(e && !e.emote, 'a state without em makes a gesture');
      st({ em: 4, ek: 0 }); check(!e.emote, 'the first count replays an old gesture');
      st({ em: 5, ek: 99 }); check(e.emote?.k === 'wave', `an unknown gesture: ${e.emote?.k}`);
      st({ em: 6, ek: 4 }); check(e.emote?.k === 'fist', `fist: ${e.emote?.k}`);
      st({ em: 6, ek: 1 }); check(e.emote?.k === 'fist', 'the same count, another gesture');
      check(e.emote.at === game.time && So().emoting.has(e), 'their gesture is not in the clean-up');
      game.time += 4; So().update(0); check(!e.emote, 'a gesture never drawn stays pending');
      // A player who has made no gesture yet sends em: 0, so their first one is seen
      live.receive('sn2', { t: 'hi', id: 'id-sn2', name: 'Teo', playing: true, look: LOOK });
      live.receive('sn2', { t: 'st', sc: 'world', x: p().x - 1.5, y: p().y, yaw: 0, em: 0, ek: 0 });
      const e2 = live.peers.get('sn2').entity;
      check(!e2.emote, 'em: 0 makes a gesture');
      live.receive('sn2', { t: 'st', sc: 'world', x: p().x - 1.5, y: p().y, yaw: 0, em: 1, ek: 0 }); check(e2.emote?.k === 'wave', `the first gesture: ${e2.emote?.k}`);
      live.joined = true; live.net = { send: m => sent.push(m) };
      hud.toast = (m, k) => toasts.push(m);
      for (const m of [{ t: 'greet', a: 7, p: 99, pl: -1, npc: 'nobody', r: 50, rl: 'x', rk: 9 }, { t: 'greet', p: 'x', pl: {} }, { t: 'greet', a: 0, p: 4, pl: 2, to: 'someone-else', npc: 'constructor', rk: 0, rl: 1, rg: 2 },
        { t: 'greet', kid: 'nope', rk: 3, rl: 0 }, { t: 'greet', a: 0, npc: 'rosa', rk: 0, rl: 1, rg: 77, r: 1 }, { t: 'greet', a: 1, npc: 'nilo', rk: 2, rl: 5, rg: 1, r: 2, p: 8, pl: 1 }]) {
        live.peers.get('sn1').greetAt = -Infinity; live.receive('sn1', m);
      }
      So().update(1);
      check(So().bubbles.some(b => b.e === w().nilo), 'Nilo does not answer the other player');
      // Ten greetings in a row to you: one notice; then Y without aiming greets back
      live.peers.get('sn1').greetAt = -Infinity; live.peers.get('sn1').toastAt = -Infinity; toasts.length = 0;
      for (let i = 0; i < 10; i++) live.receive('sn1', { t: 'greet', a: 0, to: Profile.id, p: 4, pl: i });
      game.time += 2; live.receive('sn1', { t: 'greet', a: 0, to: Profile.id, p: 4, pl: 0 });
      check(toasts.length === 1 && toasts[0] === t('social.toast.greeted', { name: 'Pepa' }), `notices: ${toasts}`);
      check(So().back?.conn === 'sn1', 'no window to greet back');
      game.mouse = { x: 3, y: 3, in: false }; So().lastAt = -Infinity;
      So().press('key'); So().release('key');
      check(sent.some(m => m.t === 'greet' && m.a === 0 && m.to === 'id-sn1' && PLAYER_LINES[m.p] === 'social.say.greet_player'), `sent: ${JSON.stringify(sent)}`);
    } finally { live.joined = was.joined; live.net = was.net; hud.toast = toast; live.peers.delete('sn1'); live.peers.delete('sn2'); }
  }));
  await test('saludo: la pareja es quien tiene un hijo contigo (los dos ids); con hijos de antes, solo si hay un jugador del otro sexo', social(async () => {
    const live = game.live, F = game.family, keep = F.v, other = (p().look?.sex || 'chico') === 'chica' ? 'chico' : 'chica';
    try {
      for (const c of ['pa', 'pb']) { live.receive(c, { t: 'hi', id: 'id-' + c, name: c, playing: true, look: { ...LOOK, sex: other } }); live.receive(c, { t: 'st', sc: 'world', x: p().x + 2, y: p().y, yaw: 0 }); }
      const A = live.peers.get('pa'), B = live.peers.get('pb');
      F.v = { kids: [{ id: 'k1', name: 'Ana', parents: [Profile.id, 'id-pa'] }], expecting: null };
      check(So().isPartner(A) && !So().isPartner(B), 'with both ids: the wrong partner');
      F.v = { kids: [], expecting: { since: 0, mother: 'id-pb', father: Profile.id } };
      check(So().isPartner(B) && !So().isPartner(A), 'a pregnancy with both ids');
      F.v = { kids: [{ id: 'k2', name: 'Leo' }], expecting: null };
      check(!So().isPartner(A) && !So().isPartner(B), 'an old child and two players of the other sex: someone is the partner');
      live.peers.delete('pb');
      check(So().isPartner(A), 'an old child and one player of the other sex: not the partner');
      F.v = { kids: [], expecting: null }; check(!So().isPartner(A), 'no child: a partner');
    } finally { F.v = keep; live.peers.delete('pa'); live.peers.delete('pb'); }
  }));
  await test('saludo: con una ventana abierta las frases van al subtítulo, encima de las ventanas', social(async () => {
    await goTo(game, 21, 27); const r = put('rosa', 23, 27); draw();
    try {
      game.windows.open('s-inv'); await frames(2);
      So().say(r, 'Hola', { name: 'Rosa' }); So().say(p(), 'Buenas', { mine: true });
      const z = +getComputedStyle(So().sub).zIndex, wz = Math.max(...[...document.querySelectorAll('.win')].map(el => +getComputedStyle(el).zIndex || 0));
      check(!So().bubbles.length && So().sub.textContent === `Rosa: Hola\n${p().name}: Buenas` && So().sub.classList.contains('on'), `subtitle: «${So().sub.textContent}», bubbles ${So().bubbles.length}`);
      check(z > wz, `the subtitle (${z}) is under the windows (${wz})`);
      game.time += 3; So().update(0); check(!So().sub.classList.contains('on'), 'the subtitle stays');
      game.windows.closeAll(); So().say(r, 'Hola', { name: 'Rosa' }); check(So().bubbles.length === 1, 'no bubble with the windows closed');
    } finally { game.windows.closeAll(); }
  }));
  await test('inventario: prev is remembered and the save does not change', async () => {
    const I = new Inventory({ slots: [{ id: 'pan', n: 2 }, { id: 'hacha_hierro', n: 1 }] });
    I.select(1, true); I.select(0, true);
    check(I.prev?.slot === 1, 'prev is not remembered');
    const keys = Object.keys(I.toSave()).sort().join();
    check(keys === 'equip,selected,slots,wardrobe', `the save has ${keys}`);
  });
  await test('ventanas: encima del mundo, sin parar el juego', async () => {
    const W = game.windows, P = p(), press = (code, type = 'keydown') => dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    const el = id => document.getElementById(id);
    const wasPlaying = document.body.classList.contains('playing');
    document.body.classList.add('playing');
    W.closeAll();
    try {
      // By its key, without leaving the game (there is no icon column any more: just the keys)
      press('KeyI'); check(W.isOpen('s-inv') && el('s-inv').classList.contains('show') && game.mode === 'play', `modo ${game.mode}`);
      check(getComputedStyle(el('s-inv')).display === 'block', 'no se ve');
      check(!el('rail'), 'the icon column is still there');
      press('KeyI'); check(!W.isOpen('s-inv'), 'I no la cierra'); press('KeyI'); check(W.isOpen('s-inv'), 'I no la abre');
      // Se sigue andando con ella abierta
      await goTo(game, 62, 50); const x0 = P.x, y0 = P.y; keys.up = true; await frames(30); keys.up = false;
      check(Math.hypot(P.x - x0, P.y - y0) > 0.5, 'no se anda con la ventana abierta');
      // Varias a la vez: la última, encima; Esc cierra de una en una antes que la pausa
      press('KeyC'); press('KeyJ'); check(W.isOpen('s-craft') && W.isOpen('s-journal') && W.isOpen('s-inv'), 'no se abren varias');
      check(+el('s-journal').style.zIndex > +el('s-inv').style.zIndex, 'la última no queda encima');
      el('s-inv').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); check(+el('s-inv').style.zIndex > +el('s-journal').style.zIndex, 'tocarla no la sube');
      press('Escape'); check(!W.isOpen('s-inv') && W.isOpen('s-journal') && game.mode === 'play', 'Esc no cierra la de encima');
      press('Escape'); press('Escape'); check(!game.windowsOpen && game.mode === 'play', 'quedan abiertas'); 
      press('Escape'); check(game.mode === 'pause', 'sin ventanas, Esc no pausa'); press('Escape'); check(game.mode === 'play', 'no vuelve de la pausa');
      // Se arrastra por el título, se queda dentro de la pantalla y lo recuerda
      const realMM = window.matchMedia; window.matchMedia = () => ({ matches: false });   // (aquí la pantalla es pequeña: como en un ordenador)
      W.open('s-craft'); const head = el('s-craft').querySelector('h2'), r0 = el('s-craft').getBoundingClientRect(), ev = (t, x, y) => head.dispatchEvent(new PointerEvent(t, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }));
      ev('pointerdown', r0.left + 40, r0.top + 10); ev('pointermove', r0.left + 10, r0.top + 60); ev('pointerup', r0.left + 10, r0.top + 60);
      const r1 = el('s-craft').getBoundingClientRect(); check(Math.abs(r1.top - r0.top - 50) < 2, `no se mueve: ${r0.top} → ${r1.top}`);
      check(JSON.parse(localStorage.getItem('pueblo-brotes:ventanas'))['s-craft'].y === Math.round(r1.top), 'no recuerda su sitio');
      ev('pointerdown', r1.left + 40, r1.top + 10); ev('pointermove', r1.left + 40, 99999); ev('pointerup', r1.left + 40, 99999); check(el('s-craft').getBoundingClientRect().top < innerHeight - 20, 'se sale de la pantalla');
      W.close('s-craft'); window.matchMedia = realMM;
      // La chincheta: sin fijar se recoge al salir el cursor y vuelve al entrar
      W.open('s-journal'); const pin = el('s-journal').querySelector('.win-pin'); check(pin.classList.contains('on'), 'no empieza fijada'); pin.click();
      el('s-journal').dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' })); await sleep(500); check(el('s-journal').classList.contains('collapsed'), 'no se recoge'); check(getComputedStyle(el('j-tabs')).display === 'none' && getComputedStyle(el('j-body')).display === 'none', 'se recoge, pero se sigue viendo');
      el('s-journal').dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' })); check(!el('s-journal').classList.contains('collapsed'), 'no vuelve');
      pin.click(); el('s-journal').dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' })); await sleep(500); check(!el('s-journal').classList.contains('collapsed'), 'fijada se recoge'); W.close('s-journal');
      // Hablando se apartan; un cofre se cierra al alejarse
      W.open('s-inv'); game.busy = true; draw(); check(getComputedStyle(el('s-inv')).visibility === 'hidden', 'se ven hablando'); game.busy = false; draw(); check(getComputedStyle(el('s-inv')).visibility === 'visible', 'no vuelven');
      game.onChest(Array(18).fill(null), null); check(W.isOpen('s-chest'), 'no se abre el cofre'); draw(); check(W.isOpen('s-chest'), 'se cierra sola'); P.x += 6; draw(); check(!W.isOpen('s-chest'), 'sigue abierto de lejos');
      // La ventana del cofre va sobre el cofre de verdad: lo que cambie otro se ve, y si lo quitan se cierra y no se pierde ni se duplica nada
      await goTo(game, 62, 50);
      const [cx, cy] = freeTile(game, [[62, 47], [63, 47], [61, 47], [62, 46]]), I = inv(); W_place(game, cx, cy, 'cofre'); const box = game.world.chestAt(cx, cy);
      box[0] = { id: 'madera', n: 10 }; box[1] = { id: 'piedra', n: 7 }; game.world.chestTouched(cx, cy);
      game.onChest(box, [cx, cy]); check(W.isOpen('s-chest'), 'no se abre');
      const cells = () => document.querySelectorAll('#ch-grid .slot'), click = el => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      const wood = I.count('madera'); click(cells()[0]); check(I.count('madera') === wood + 10 && !game.world.chestAt(cx, cy)[0], 'no saca');
      // Llega un cambio de otro jugador (el array del trozo es otro): se sigue leyendo el de verdad
      const d = game.world.delta(Math.floor(cx / CHUNK), Math.floor(cy / CHUNK)); d.chest[`${cx},${cy}`] = [null, { id: 'piedra', n: 7 }, ...Array(16).fill(null)];
      const stone = I.count('piedra'); for (let i = 0; i < 8; i++) draw(); click(cells()[1]); check(I.count('piedra') === stone + 7 && !d.chest[`${cx},${cy}`][1], `el segundo montón no sale del de verdad: ${I.count('piedra') - stone}`);
      // Se recoge el mueble con la ventana abierta: se cierra y lo guardado no se va a un array huérfano
      check(game.pickUp(game.world.placedObjectAt(cx, cy)), 'no se recoge el cofre vacío'); const keepWood = I.count('madera'); for (let i = 0; i < 8; i++) draw(); check(!W.isOpen('s-chest'), 'sigue abierta sin cofre');
      I.remove('cofre', 1); check(I.count('madera') === keepWood, 'cambia lo que llevas');
      // Las alforjas: todos los movimientos de una apertura se quedan
      const horse = { bags: [{ id: 'cuerda', n: 2 }, { id: 'fibra', n: 3 }, ...Array(7).fill(null)] }; game.onChest(() => horse.bags, null, () => game.ranch.bagsChanged(horse));
      const rope = I.count('cuerda'), fib = I.count('fibra'); click(cells()[0]); click(cells()[1]); check(I.count('cuerda') === rope + 2 && I.count('fibra') === fib + 3 && !horse.bags.some(Boolean), `alforjas: ${JSON.stringify(horse.bags.slice(0, 2))}`);
      W.close('s-chest'); I.remove('cuerda', 2); I.remove('fibra', 3); I.remove('madera', 10); I.remove('piedra', 7);
      // En primera persona, con una ventana, el puntero queda libre
      CAM.first = true; draw(); check(!document.body.classList.contains('aiming'), 'sigue la cruceta con una ventana abierta'); W.closeAll(); draw(); check(document.body.classList.contains('aiming'), 'no vuelve la cruceta');
    } finally { CAM.first = false; game.busy = false; clearKeys(); W.closeAll(); document.body.classList.toggle('playing', wasPlaying); try { localStorage.removeItem('pueblo-brotes:ventanas'); } catch {} draw(); }
  });
  await test('vallado: al lado de una puerta de valla cabe otra valla, por los dos lados y en el hueco del jardín', async () => {
    const W = w(), own = [], put = (x, y, id) => { W.place(x, y, id); own.push([x, y]); };
    try {
      for (const [gate, fence] of [[[GATE_X + 1, YARD.y1 - 1], [GATE_X, YARD.y1 - 1]], [[GATE_X, YARD.y1 - 1], [GATE_X + 1, YARD.y1 - 1]]]) {
        put(...gate, 'puerta_valla');
        check(W.canPlace(...fence, 'valla', null), `no cabe la valla en ${fence} con la puerta en ${gate}`);
        check(W.canPlace(...fence, 'puerta_valla', null), `no cabe otra puerta en ${fence} con la puerta en ${gate}`);
        put(...fence, 'valla');
        const q = { x: fence[0] + 0.5, y: fence[1] + 0.5 }; collideNow(q, W.collidersNear(q.x, q.y), 0.25); check(Math.hypot(q.x - fence[0] - 0.5, q.y - fence[1] - 0.5) > 0.01, 'se atraviesa la valla');
        for (const t of own.splice(0)) W.setTile(...t, 'air');
      }
      // Lo que sí estorba sigue estorbando: el tronco o el buzón de la casilla de al lado, de cerca
      check(!W.canPlace(22, 20, 'valla', null), 'la valla se mete en el buzón');
    } finally { for (const t of own) W.setTile(...t, 'air'); }
  });
  await test('casas: de las del pueblo se quita y se pone de todo, y queda guardado', async () => {
    const h = HOUSES.rosa, B = game.build, I = inv(), P = p(), W = w(), kept = I.slots.slice();
    const wallT = [h.x0 + 2, h.y1 - 1], roofT = [h.x0 + 3, h.y0 + 3], floorT = [h.x0 + 4, h.y0 + 4];
    const k = t => `${t[0]},${t[1]}`, d = t => W.delta(Math.floor(t[0] / CHUNK), Math.floor(t[1] / CHUNK));
    I.slots.fill(null);
    await goTo(game, h.x0 + 3.5, h.y1 + 1.5);
    const mouse = game.mouse; game.mouse = null;
    try {
      B.toggle(true); B.select('quitar');
      // El muro de una vecina, con su material de vuelta
      const wallId = parsePlaced(W.at('placed', ...wallT))[0], before = W.collidersNear(wallT[0] + 0.5, wallT[1] + 0.5).filter(c => c.wall).length;
      check(PIECES[wallId], `en ${wallT} hay ${wallId}`); check(!W.ownAt('placed', ...wallT), 'ya era tuyo');
      check(B.check(wallT).ok, `no deja: ${B.check(wallT).why}`);
      const roofFirst = B.removable(wallT); check(roofFirst === 'roof', `primero: ${roofFirst}`);
      B.remove(wallT); check(!W.at('roof', ...wallT), 'no quita el tejado'); check(d(wallT).gone?.[`roof:${k(wallT)}`], 'no apunta el tejado');
      B.remove(wallT); check(!W.at('placed', ...wallT), 'no quita el muro'); check(d(wallT).gone?.[k(wallT)], 'no apunta el muro');
      check(PIECES[wallId].cost.every(([m]) => I.count(m) > 0), 'no devuelve los materiales');
      const after = W.collidersNear(wallT[0] + 0.5, wallT[1] + 0.5).filter(c => c.wall).length; check(after < before, `sigue chocando: ${before} → ${after}`);
      draw();
      // Sigue quitado después de guardar y al volver a pedir el trozo
      const saved = JSON.parse(JSON.stringify(d(wallT).gone)); check(saved[k(wallT)] && saved[`roof:${k(wallT)}`], 'no se guardaría');
      W.merged.delete(`${Math.floor(wallT[0] / CHUNK)},${Math.floor(wallT[1] / CHUNK)}`);
      check(!W.contentFor(Math.floor(wallT[0] / CHUNK), Math.floor(wallT[1] / CHUNK)).objects.some(o => o.tile?.[0] === wallT[0] && o.tile?.[1] === wallT[1] && (o.layer === 'placed' || o.layer === 'roof')), 'vuelve a salir');
      // Y se puede poner otra cosa ahí: es de quien lo pone, y al quitarlo no vuelve lo de antes
      B.select('muro_piedra'); I.add('piedra', 9); P.x = wallT[0] + 2.5; P.y = wallT[1] + 2.5; check(W.canPlace(...wallT, 'muro_piedra', P), 'no se puede poner otro muro');
      B.place(wallT); check(W.ownAt('placed', ...wallT) === 'muro_piedra', 'no se pone');
      B.select('quitar'); B.remove(wallT); check(!W.at('placed', ...wallT), 'vuelve el muro de antes');
      // Tejado y suelo de dentro, y un mueble
      P.x = roofT[0] + 0.5; P.y = roofT[1] + 3.5; B.remove(roofT); check(!W.at('roof', ...roofT), 'tejado de dentro');
      B.remove(floorT); B.remove(floorT); check(!W.at('floor', ...floorT), `suelo: ${W.at('roof', ...floorT)}, ${W.at('floor', ...floorT)}`);
      const thing = W.placedNear(h.x0 + 4, h.y0 + 2, 6).find(o => o.fixed && ITEMS[o.placed] && o.layer === 'placed' && !PIECES[o.placed]); check(thing, 'sin mueble');
      P.x = thing.x; P.y = thing.y + 2; while (B.removable(thing.tile) === 'roof') B.remove(thing.tile);
      const has = I.count(thing.placed); B.remove(thing.tile); check(I.count(thing.placed) === has + 1, `${thing.placed} no vuelve a la mochila`);
      // Lo mismo con /fill air: toda una esquina, de una vez, y sigue la casa de al lado
      const c = [h.x1 - 2, h.y0 + 1]; W.setTile(...c, 'air'); check(!W.at('roof', ...c) && !W.at('floor', ...c), '/fill air no quita lo que venía puesto');
      // En la taberna y en una aldea, igual
      const bar = [3, 34]; P.x = 3.5; P.y = 36.5; while (B.removable(bar) === 'roof') B.remove(bar); check(W.at('placed', ...bar) === 'barra', 'no está la barra'); B.remove(bar); check(!W.at('placed', ...bar), 'la barra no se quita');
      // Con el ratón, lo que se ve bajo el cursor
      draw(); draw();
      const pick = (x, H, y) => { const v = new THREE.Vector3(x, game.view3d.groundY(W, x, y) + H, y).project(game.view3d.camera); game.mouse = { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, in: true }; return B.pick(); };
      await goTo(game, h.x0 + 8.5, h.y1 + 2.5); draw(); draw();
      const wt = [h.x0 + 8, h.y1 - 1], got = pick(wt[0] + 0.5, 1.2, wt[1] + 0.5); check(got?.layer === 'placed' && got.tile[0] === wt[0] && got.tile[1] === wt[1], `al muro: ${JSON.stringify(got)}`);
      const top = pick(h.x0 + 7.5, 3.1, h.y0 + 5.5); check(top?.layer === 'roof', `al tejado: ${JSON.stringify(top)}`);
    } finally { game.mouse = mouse; B.select(PIECE_IDS[0]); B.toggle(false); I.slots.splice(0, I.slots.length, ...kept); I.changed(); }
  });
  await test('casas: en las aldeas se quita de todo, y dentro se apunta a lo que se ve', async () => {
    const B = game.build, W = w(), P = p(), E = game.places, I = inv(), kept = I.slots.slice(), mouse = game.mouse;
    let v = null;
    for (let r = 2; r < 80 && !v; r++) for (let cy = -r; cy <= r && !v; cy++) for (let cx = -r; cx <= r && !v; cx++) { if (Math.max(Math.abs(cx), Math.abs(cy)) !== r) continue; const q = E.poi(cx, cy); if (q?.kind === 'aldea') v = q; }
    check(v, 'no hay aldeas cerca');
    const walls = Object.entries(E.aldea(v).all.placed).filter(([, id]) => id === 'muro_entramado').map(([t]) => t.split(',').map(Number));
    const [wx, wy] = walls[Math.floor(walls.length / 2)];
    I.slots.fill(null); game.mouse = null;
    try {
      await goTo(game, wx + 0.5, wy + 3.5); B.toggle(true); B.select('quitar'); draw(); draw();
      check(W.at('hang', wx, wy) === undefined && W.at('rug', wx, wy) === undefined, 'preguntar por otras capas falla');
      check(W.at('placed', wx, wy) === 'muro_entramado', 'no está el muro');
      B.remove([wx, wy]); check(!W.at('roof', wx, wy), 'el tejado de la aldea no se quita'); B.remove([wx, wy]); check(!W.at('placed', wx, wy), 'el muro de la aldea no se quita');
      check(W.canPlace(wx, wy, 'muro_piedra', null), 'en su hueco no se puede construir');
      W.setTile(wx + 1, wy, 'air'); check(!W.at('placed', wx + 1, wy) && !W.at('roof', wx + 1, wy), '/fill air no vacía la aldea');
      // Una pieza sobre lo que venía puesto: al quitarla no vuelve lo de antes
      const [ox, oy] = walls[0]; W.setTile(ox, oy, 'muro_piedra'); P.x = ox + 0.5; P.y = oy + 3; B.select('quitar'); W.setTile(ox, oy, 'air'); check(!W.at('placed', ox, oy), 'vuelve lo de antes');
      // Dentro de una casa, con la cámara por defecto: no se apunta a la pared oculta sino a lo que hay detrás
      const h = HOUSES.bruno, T = [h.x0 + 1, h.y1 - 2];
      await goTo(game, h.x0 + 5.5, h.y0 + 5.5); game.underRoof = true; CAM.first = false; for (let i = 0; i < 80; i++) { game.view3d.world.updateFade(game, W, 0.1); draw(); }
      const aim = (x, H, y) => { const v3 = new THREE.Vector3(x, game.view3d.groundY(W, x, y) + H, y).project(game.view3d.camera); game.mouse = { x: (v3.x + 1) / 2 * innerWidth, y: (1 - v3.y) / 2 * innerHeight, in: true }; return B.pick(); };
      const got = aim(T[0] + 0.5, 0.03, T[1] + 0.5);
      check(got && got.tile[0] === T[0] && got.tile[1] === T[1] && PIECES[got.o.placed]?.kind !== 'wall', `junto a la pared oculta: ${got?.o.placed} en ${got?.tile} (tenía que ser ${T})`);
      game.mouse = null;
      // Una alfombra grande se apunta en cualquiera de sus casillas, y no se quita el suelo de debajo
      const R = [h.x0 + 4, h.y0 + 4]; W.setTile(...R, 'air'); W.setTile(...R, 'suelo_madera'); W.place(R[0], R[1], 'alfombra', 2); W.setTile(R[0] + 1, R[1], 'air'); W.setTile(R[0], R[1] + 1, 'air'); draw();
      check(B.removableAt([R[0] + 1, R[1]])?.layer === 'rug' || B.removableAt([R[0], R[1] + 1])?.layer === 'rug', `fuera del ancla: ${JSON.stringify(B.removableAt([R[0] + 1, R[1]]))}`);
    } finally { game.mouse = mouse; game.underRoof = false; B.select(PIECE_IDS[0]); B.toggle(false); I.slots.splice(0, I.slots.length, ...kept); I.changed(); }
  });
  await test('jugar juntos: lo primero que se quita de un trozo no pisa lo demás', async () => {
    const ops = diffChunk({ v: 1 }, { v: 1, gone: { '1,1': true } });
    check(ops.length === 1 && ops[0][1] === '1,1', `sale: ${JSON.stringify(ops)}`);
    const d = { gone: { '2,2': true } }; applyOps(d, ops); check(d.gone['1,1'] && d.gone['2,2'], `se pisan: ${JSON.stringify(d)}`);
    check(JSON.stringify(diffChunk({}, { closed: {} })) === '[["closed",null,{}]]', 'un mapa vacío deja de llegar');
  });
  await test('muro en T: el de fuera sigue entero donde llega un tabique', async () => {
    const at = { '5,5': 'muro_entramado', '4,5': 'muro_entramado', '6,5': 'muro_entramado', '5,6': 'muro_madera' };
    const scene = { pieceAt: (x, y) => (at[`${x},${y}`] ? PIECES[at[`${x},${y}`]] : null), at: (l, x, y) => (l === 'floor' && y > 5 ? 'suelo_madera' : null), roofAt: (x, y) => y > 5, doorClosed: () => false };
    const boxes = [], emit = key => ({ box: (x0, y0, z0, x1, y1, z1) => { boxes.push({ key, x0, y0, z0, x1, y1, z1 }); return emit(key); }, quad: () => emit(key), geo: () => emit(key), ball: () => emit(key), cyl: () => emit(key), tube: () => emit(key), verts: () => emit(key), add: () => emit(key), push: () => emit(key), tri: () => emit(key), beam: () => emit(key), plane: () => emit(key) });
    let failed = null;
    try { wallTile(scene, 5, 5, 'muro_entramado', k => new Proxy(emit(k), { get: (o, n) => o[n] || (() => emit(k)) }), {}); } catch (e) { failed = e.message; }
    check(!failed, `falla al dibujar: ${failed}`);
    const stone = boxes.filter(b => b.key === 'stone'); check(stone.length, 'sin zócalo');
    check(Math.min(...stone.map(b => b.x0)) <= 5 && Math.max(...stone.map(b => b.x1)) >= 6, `zócalo de ${Math.min(...stone.map(b => b.x0))} a ${Math.max(...stone.map(b => b.x1))}`);
    const covered = stone.filter(b => b.z0 < 5.5 && b.x1 - b.x0 > 0.95); check(covered.length, `el zócalo de fuera se corta: ${JSON.stringify(stone)}`);
    // Sin suelo bajo el tabique, pero con tejado: sigue siendo de la casa
    const noFloor = { ...scene, at: () => null, roofAt: (x, y) => y >= 5 };
    const seen = new Set(); wallTile(noFloor, 5, 5, 'muro_entramado', (k, side) => { seen.add(side); return new Proxy({}, { get: () => () => {} }); }, {});
    check(seen.has('n') && !seen.has('free'), `lados: ${[...seen]}`);
  });
  await test('persona: huesos, mochila, barriga y niño', async () => {
    const P = new RealPerson({ ...LOOK, wear: { torso: { id: 'camisa', color: '#ffffff' }, espalda: { id: 'mochila', color: '#8a5a34' } } });
    check(P.head && P.hand && P.legs.length === 2 && P.shins.length === 2 && P.arms.length === 2 && P.fore.length === 2, 'le faltan huesos');
    check(P.bag, 'sin mochila');
    P.setBelly(0.5); check(P.belly?.visible, 'sin barriga');
    P.setBelly(0); check(!P.belly.visible, 'la barriga no se va');
    const K = new RealPerson(LOOK, { kid: true });
    check(K.height < P.height * 0.75 && K.height > 1, `el niño mide ${K.height} (la adulta, ${P.height})`);
    P.dispose(); K.dispose();   // (sueltan su prototipo: ver persona.js release)
  });
  await test('puerta: se cierra y se abre', async () => {
    const door = [21, 16];   // (la de tu casa)
    check(w().pieceAt(...door)?.kind === 'door', 'no hay puerta en la casa');
    const was = w().doorClosed(...door); w().toggleDoor(...door); check(w().doorClosed(...door) !== was, 'no cambia'); w().toggleDoor(...door); check(w().doorClosed(...door) === was, 'no vuelve');
  });
  await test('sentarse: en una silla y levantarse', async () => {
    await goTo(game, HOUSE.x0 + 7.5, HOUSE.y0 + 5.5);
    const silla = w().placedNear(p().x, p().y, 3).find(o => o.placed === 'silla'); check(silla, 'no hay silla en casa');
    game.rest.sit(silla); check(p().pose?.kind === 'sit', 'no está sentado'); game.rest.stand(); check(!p().pose, 'no se levanta');
  });
  await test('comandos: /give, /tp, /time, /weather, /gamerule y /gamemode', async () => {
    const said = []; const say = (t, k) => said.push(`${k}: ${t}`);
    const n = inv().count('tablas'); runCommand(game, '/give tablas 5', say); check(inv().count('tablas') === n + 5, `give: ${said.at(-1)}`);
    runCommand(game, '/tp 10 -5', say); await frames(2); check(Math.round(p().x - 21) === 10 && Math.round(p().y - 24) === -5, `tp: ${said.at(-1)} (${p().x}, ${p().y})`);
    runCommand(game, '/time set 12:00', say); check(Math.abs(game.days.hour - 12) < 0.05, `time set: ${game.days.hour} (${said.at(-1)})`);
    runCommand(game, '/time reset', say);
    runCommand(game, '/weather rain', say); check(game.weatherLock?.w === 'lluvia', `weather: ${said.at(-1)}`);
    runCommand(game, '/weather', say); check(said.at(-1).includes('op'), `dice: ${said.at(-1)}`);
    runCommand(game, '/weather blizzard forever', say); check(game.weatherLock?.w === 'ventisca' && game.weatherLock.until === null, `sin fin: ${said.at(-1)}`);
    await frames(2); check(game.days.weatherHere === 'ventisca', `hace: ${game.days.weatherHere}`);
    runCommand(game, '/toggledownfall', say); check(game.weatherLock?.w === 'sol', `toggledownfall: ${said.at(-1)}`);
    runCommand(game, '/weather reset', say); check(!game.weatherLock, 'no vuelve el del día'); runCommand(game, '/weather clear', say);
    runCommand(game, '/gamerule keepInventory true', say); check(game.rules.keepInventory === true, `gamerule: ${said.at(-1)}`); runCommand(game, '/gamerule keepInventory false', say);
    runCommand(game, '/gamemode creative', say); check(game.gamemode === 'creative', `gamemode: ${said.at(-1)}`); runCommand(game, '/gamemode survival', say); check(game.gamemode === 'survival', 'no vuelve a supervivencia');
    runCommand(game, '/help', say); check(said.some(s => s.includes('/tp')), 'help no lista /tp');
  });
  await test('saltos lejos: a oscuras, con la pausa delante, sin destapar dos veces; con la pausa o el mapa no se dibuja', async () => {
    const v = game.view3d, fade = document.getElementById('fade'), [hx, hy] = [p().x, p().y];
    // (hasta que acabe el salto, dibujando como el bucle del juego: whenReady espera a fotogramas pintados)
    const settle = async (ms = 20000) => { const t0 = performance.now(); while ((game.jumping || v.prep) && performance.now() - t0 < ms) { draw(); await frames(1); await sleep(15); } };
    try {
      game.teleport(hx + 200, hy, true);
      check(game.jumping && fade.classList.contains('on'), 'un /tp lejos no funde a negro');
      // (con la pausa abierta a medias, como si la hubiera abierto antes de llegar el /tp de un op, la vista se sigue
      // preparando detrás: antes se quedaba a oscuras unos 13 s)
      game.mode = 'pause';
      const t0 = performance.now();
      await settle();
      check(!game.jumping && !v.prep, 'el salto no acaba con la pausa abierta');
      check(performance.now() - t0 < 12000, `con la pausa abierta, el salto tarda ${Math.round(performance.now() - t0)} ms`);
      await sleep(350);
      check(!fade.classList.contains('on'), 'el salto no destapa');
      check(await readyGround(game, 8000), 'el suelo de allí no se hace');
      // (sin nada que preparar, con la pausa o el mapa delante no se dibuja el mundo)
      for (const mode of ['pause', 'map']) {
        game.mode = mode; v.redraw = false;
        const n = v.drawn;
        for (let i = 0; i < 4; i++) { draw(); await sleep(10); }
        check(v.drawn === n, `con ${mode === 'map' ? 'el mapa' : 'la pausa'} se sigue dibujando el mundo`);
      }
      game.mode = 'play';
      // (si otro tapa a medias, al morir o al salir, el salto no destapa: lo hace quien tapó después)
      game.teleport(hx, hy, true);
      game.covers++;
      await settle();
      await sleep(350);
      check(fade.classList.contains('on'), 'un salto viejo destapa lo que tapó otro');
    } finally { game.mode = 'play'; fade.classList.remove('on'); game.jumping = false; v.hold = false; }
  });
  await test('mapas y brújula: un mapa de la zona y la aguja hacia casa', async () => {
    await goTo(game, 30, 30);
    inv().add('mapa_vacio', 1); const i = inv().slots.findIndex(s => s?.id === 'mapa_vacio'); game.maps.create(i);
    const it = inv().slots.find(s => s?.id === 'mapa'); check(it && game.maps.data[it.map], 'no hay mapa de la zona');
    const [tx, ty] = game.maps.pointsTo(); check(Number.isFinite(tx) && Number.isFinite(ty), 'la brújula no apunta');
    check(w().gen.thumbnail(1, 1).width === CHUNK, 'sin miniatura del mapa');
  });
  await test('cocos: sacudir una palmera con E y talarla', async () => {
    const o = findKind(game, ['palm'], -120, 90, 10) || findKind(game, ['palm'], 0, 0, 30); check(o, 'no hay palmeras');
    await goTo(game, o.x + 0.9, o.y + 0.9);
    p().x = o.x + 0.9; p().y = o.y + 0.9; await frames(2);
    const n = inv().count('coco'), near = game.nearest(); check(near?.text === 'Coger cocos', `E dice: ${near?.text}`); near.run();
    await until(() => { const d = game.gather.drops[0]; if (d) { p().x = d.x; p().y = d.y; } return !game.gather.drops.length; }, 8000, 'a recoger los cocos');   // (se va a por cada coco: a veces caen lejos)
    check(inv().count('coco') > n, 'no han caído cocos');
    const live = w().harvestablesNear(o.x, o.y).find(k => k.key === o.key); check(live?.bare, 'la palmera no se queda sin cocos');
    const m = inv().count('madera'); await harvest(game, live, 'hacha'); if (openBig(game, live.x, live.y)) await collectDrops(game);
    check(inv().count('madera') > m, 'talarla no da madera');
  });
  await test('noria: va en un río y muele trigo', async () => {
    let spot = null;
    for (let r = 60; r < 400 && !spot; r += 4) for (let a = 0; a < 64 && !spot; a++) { const x = 21 + Math.cos(a / 64 * 6.283) * r, y = 24 + Math.sin(a / 64 * 6.283) * r; if (w().riverAt(x, y)) spot = [x, y]; }
    check(spot, 'no hay río cerca');
    await goTo(game, spot[0] + 3, spot[1]);
    let f = null;
    for (let dx = -2; dx <= 2 && !f?.ok; dx += 0.5) for (let dy = -2; dy <= 2 && !f?.ok; dy += 0.5) for (const a of [0, Math.PI / 2]) { f = w().fitFree('noria', spot[0] + dx, spot[1] + dy, a, 0, null); if (f.ok) break; }
    check(f?.ok, `la noria no cabe: ${f?.why}`);
    let dry = null;
    for (let r = 4; r < 30 && !dry; r++) for (let a = 0; a < 8 && !dry; a++) { const x = spot[0] + Math.cos(a) * r, y = spot[1] + Math.sin(a) * r; if (!w().water(x, y) && !w().water(x + 1, y) && !w().water(x - 1, y)) dry = [x, y]; }
    check(dry, 'no hay tierra cerca del río');
    const land = w().fitFree('noria', dry[0], dry[1], 0, 0, null); check(!land.ok, 'la noria cabe en tierra');
    w().placeFree('noria', f);
    const tile = w().placedNear(f.cx, f.cy, 3).find(o => o.placed === 'noria')?.tile; check(tile, 'no está la noria');
    inv().add('trigo', 2); const i = inv().slots.findIndex(s => s?.id === 'trigo'); game.machines.put(tile, 'noria', 'in', i);
    const m = machineAt(w(), tile); m.t -= 13000; settle(m, MACHINES.noria);
    check(m.out?.id === 'harina' && m.out.n === 2, `molido: ${JSON.stringify(m.out)}`);
  });
  await test('pozo grande (big well): on 2 × 2 tiles dug 5 deep, water from any side, no digging on it, and it comes down', async () => {
    const W = w(), today = () => game.days.dayIndex, B = BUILDABLE.big_well;
    check(B?.cat === 'Exterior' && B.needs === 'cantero' && B.cost.find(([m]) => m === 'piedra')?.[1] === 48 && !RECIPES.find(r => r.id === B.recipe)?.plan, `in B: ${JSON.stringify(B)}`);
    check(ITEMS.big_well.name === t('item.big_well') && ITEMS.big_well.desc === t('item.big_well.desc'), 'its name is not from the language files');
    let A = null;
    find: for (let y = 120; y < 400; y += 5) for (let x = -120; x < 120; x += 7) {
      let ok = true;
      for (let j = 0; j < 4 && ok; j++) for (let i = 0; i < 4 && ok; i++) if (W.digWhy(x + i, y + j, false)) ok = false;
      if (ok) { A = [x + 1, y + 1]; break find; }
    }
    check(A, 'nowhere to dig');
    await goTo(game, A[0] + 1, A[1] - 1.5);
    const tiles = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => [A[0] + i, A[1] + j]), sel = inv().selected, keep = inv().slots[sel];
    const dig = (x, y, n) => { for (let i = 0; i < n; i++) W.digTile(x, y, -1, today()); };
    try {
      // (a hole on its way, 4 deep: aimed at any of its tiles, the mark is the hole, not the 2 × 2 by the nearest corner)
      tiles.forEach(([x, y]) => dig(x, y, 4));
      for (const [x, y] of tiles) for (const [u, v] of [[0.3, 0.3], [0.7, 0.7], [0.3, 0.7]]) {
        const g = W.fitFree('big_well', x + u, y + v, 0, 0, null);
        check(g.square?.join() === `${A[0]},${A[1]},2`, `the mark of a hole 4 deep, aiming at ${x - A[0] + u}, ${y - A[1] + v}: ${g.square}`);
      }
      tiles.slice(0, 3).forEach(([x, y]) => dig(x, y, 1));
      let f = W.fitFree('big_well', A[0] + 0.3, A[1] + 0.4, 0, 0, null);
      check(!f.ok && f.why === t('why.big_well.dig', { n: 5 }) && f.square?.join() === `${A[0]},${A[1]},2`, `with a shallow tile: ${f.why} ${f.square}`);
      dig(...tiles[3], 2);   // (6 deep: its lining goes down to it)
      f = W.fitFree('big_well', A[0] + 1.7, A[1] + 1.6, 0, 0, null);
      check(f.ok && f.anchor.join() === A.join(), `it does not fit: ${f.why}`);
      W.placeFree('big_well', f); await frames(2);
      const o = W.placedObjectAt(...A), L = W.levelAt(A[0] + 0.5, A[1] + 0.5);
      check(o?.model === `big_well:${Math.round((L - W.digH(...tiles[3])) / 0.25)}` && Math.abs(o.x - A[0] - 1) < 1e-6, `model ${o?.model} at ${o?.x - A[0]}`);
      check(tiles.every(([x, y]) => W.levelAt(x + 0.5, y + 0.5) === L && W.wellAt(x + 0.5, y + 0.5) && W.digWhy(x, y, false) === 'Ahí está el pozo'), 'its four tiles');
      check(!W.wellAt(A[0] - 0.5, A[1] + 0.5) && !W.wellAt(A[0] + 2.5, A[1] + 1.5), 'it takes more than its four tiles');
      check(W.wellMouth(A[0] + 1, A[1] + 1) > 1.2 && !W.wellMouth(A[0] + 0.1, A[1] + 1), 'its mouth');
      check(!W.fitFree('pozo', A[0] + 1.5, A[1] + 1.5, 0, 0, null).ok, 'a small well fits on it');
      // (nothing on it: not in its mouth, where its boxes leave room, nor a floor on any of its tiles)
      for (const [x, y] of [[A[0] + 1, A[1] + 1], [A[0] + 0.6, A[1] + 1.3]]) { const g = W.fitFree('cofre', x, y, 0, 0, null); check(!g.ok, `a chest fits in its mouth at ${x - A[0]}, ${y - A[1]}`); }
      check(tiles.every(([x, y]) => !W.canPlace(x, y, 'suelo_madera', null)), 'a floor fits on it');
      W.floodAt(...A);
      check(W.floodCand.get(`${Math.floor(A[0] / CHUNK)},${Math.floor(A[1] / CHUNK)}`)?.cover?.length === 6, 'its other tiles are not left out of the water of the holes');
      // The watering can fills from any side
      inv().slots[sel] = { id: 'regadera', n: 1 }; inv().changed();
      for (const [px, py, fx, fy] of [[A[0] + 1, A[1] - 0.45, 0, 1], [A[0] + 1, A[1] + 2.45, 0, -1], [A[0] - 0.45, A[1] + 1, 1, 0], [A[0] + 2.45, A[1] + 0.6, -1, 0]]) {
        p().x = px; p().y = py; p().face = { x: fx, y: fy }; game.farm.can = 0; game.gather.cooldown = 0;
        const tg = game.gather.pickTarget(); check(tg?.use, `the can from ${px - A[0]}, ${py - A[1]}: ${tg?.label}`); tg.use(); check(game.farm.can > 0, 'the can is still empty');
      }
      // (clicked from a corner, on its far quarter, looking away: in reach, measured to the well and not to that tile)
      try {
        game.aimTile = () => [A[0] + 1, A[1] + 1]; p().x = A[0] - 0.34; p().y = A[1] - 0.34; p().face = { x: -1, y: 0 }; game.farm.can = 0;
        const tg = game.farm.target(p(), { id: 'regadera', n: 1 }, ITEMS.regadera);
        check(tg?.ok && tg.label.startsWith('Llenar'), `the can from a corner, on the far quarter: ${tg?.label}`);
      } finally { delete game.aimTile; }   // (back to the class's own)
      const stone = inv().count('piedra');
      check(game.pickUp(W.placedObjectAt(...A)), 'it does not come down');
      check(inv().count('piedra') - stone === 48, 'its stone does not come back');
      inv().remove('piedra', 48); inv().remove('tablas', 18); inv().remove('cuerda', 9);
      check(tiles.every(([x, y]) => W.levelAt(x + 0.5, y + 0.5) === null && W.digH(x, y) !== null && !W.wellAt(x + 0.5, y + 0.5)), 'the hole is not left as it was');
    } finally {
      if (W.ownAt('placed', ...A)) W.setTile(...A, 'air');
      for (const [x, y] of tiles) W.digReset(x, y);
      inv().slots[sel] = keep; inv().changed();
    }
  });
  await test('casas: el menú asigna tus animales a una casa con sitio', async () => {
    await goTo(game, 60, 36);
    const R = game.ranch, was = hud.ask, [ax, ay] = freeTile(game, [[66, 34], [67, 34], [66, 35]]), A = [ax, ay]; w().place(ax, ay, 'gallinero');
    const [bx, by] = freeTile(game, [[70, 38], [71, 38], [70, 39]]), B = [bx, by]; w().place(bx, by, 'gallinero');
    const houseA = w().placedObjectAt(ax, ay), houseB = w().placedObjectAt(bx, by), keep = [...R.animals];
    let picks = [], seen = [];
    hud.ask = (who, text, options) => { seen.push(options); const want = picks.shift(), i = options.findIndex(o => o.includes(want)); check(i >= 0, `el menú no ofrece «${want}»: ${options.join(' | ')}`); return Promise.resolve(i); };
    try {
      check(!R.add('gallina', 'Pepa'), 'no se puede comprar'); const pepa = R.animals.at(-1);
      check(pepa.home[0] === ax && pepa.home[1] === ay && pepa.owner, 'la gallina no está en la primera casa, o sin dueño');
      const pato = R.summon('pato', 60, 36), ajeno = R.summon('gallina', 60, 36), vaca = R.summon('vaca', 60, 36); ajeno.owner = 'otra-persona';
      // (el pato, sin casa, primero; ni la vaca ni el animal de otro salen en el menú; y la gallina se puede mudar)
      const who = R.assignable('gallinero', B);
      check(who[0] === pato && who.includes(pepa) && !who.includes(ajeno) && !who.includes(vaca), `lista: ${who.map(a => a.name).join(', ')}`);
      check(R.objectAction(houseB).text.includes('vacío'), `aviso: ${R.objectAction(houseB).text}`);
      picks = ['Asignar', pato.name]; await R.houseMenu(houseB); await sleep(0); await frames(2);
      check(pato.home?.[0] === bx && pato.home?.[1] === by && !game.busy, 'el pato no vive en la casa elegida');
      check(Math.hypot(pato.x - (bx + 0.5), pato.y - (by + 1.5)) < 3, `el pato no ha ido a su casa: ${pato.x}, ${pato.y}`);
      picks = ['Asignar', 'Pepa']; await R.houseMenu(houseB); await sleep(0);
      check(R.livingIn(B).length === 2 && !R.livingIn(A).length, 'Pepa no se ha mudado');
      // (llena, no se ofrece; la puerta sigue funcionando desde el menú)
      for (const n of ['a', 'b']) Object.assign(R.summon('gallina', 60, 36), { name: n, home: [bx, by] });
      picks = ['Cerrar']; await R.houseMenu(houseB); await sleep(0);
      check(!seen.at(-1).includes('Asignar un animal'), 'en una casa llena se ofrece asignar');
      check(!R.doorOpen(pato), 'la puerta no se ha cerrado');
      // (al perder su casa, queda sin casa y se le puede dar otra)
      game.pickUp(houseB);
      check(R.assignable('gallinero', A)[0] && !R.homeOf(pato), 'sin casa no se le puede asignar otra');
      R.assign(pato, A); check(R.homeOf(pato)?.tile[0] === ax, 'no se le ha podido dar otra casa');
    } finally { hud.ask = was; R.animals = keep; w().setTile(ax, ay, 'air'); w().setTile(bx, by, 'air'); inv().remove('gallinero', 1); }
  });
  await test('vallas: se fabrican, se colocan, se unen y se recogen', async () => {
    await goTo(game, 60, 36);
    inv().add('tablas', 2); game.craft.check();
    const f = w().fitFree('banco', p().x + 1.5, p().y, 0, 0, p()); check(f.ok, `el banco no cabe: ${f.why}`); w().placeFree('banco', f); await frames(2);
    const r = RECIPES.find(r => r.id === 'valla'); check(r && !game.craft.problem(r), `receta: ${r && game.craft.problem(r)}`);
    const n0 = inv().count('valla'); game.craft.craft(r, 2); check(inv().count('valla') === n0 + 2, 'no hay vallas');
    const banco = w().placedNear(p().x, p().y, 3).find(o => o.placed === 'banco'); check(banco && game.pickUp(banco), 'no se recoge el banco'); inv().remove('banco', 1);
    check(!freePlace('valla') && PIECE_IDS.includes('valla'), 'la valla no va por casillas, o ya no está en la paleta');
    inv().selected = inv().slots.findIndex(s => s?.id === 'valla'); inv().changed(); check(inv().held?.id === 'valla', 'no la llevo en la mano');
    let [tx, ty] = freeTile(game, [[64, 42], [66, 42], [68, 42]]);
    const clear = (x, y) => w().canPlace(x, y, 'valla', p()) && w().canPlace(x + 1, y, 'valla', p());
    for (let i = 0; i < 30 && !clear(tx, ty); i++) tx += 2;
    check(clear(tx, ty), 'no hay dos casillas libres seguidas');
    const put = async x => { p().x = x + 0.5; p().y = ty + 1.4; p().face = { x: 0, y: -1 }; await frames(2); game.gather.cooldown = 0; game.gather.target = game.gather.pickTarget(); check(game.gather.target?.ok && game.gather.target.tile[0] === x, `no apunta a ${x},${ty}`); game.gather.use(); await frames(1); };
    await put(tx); await put(tx + 1);
    check(w().ownAt('placed', tx, ty) === 'valla' && w().ownAt('placed', tx + 1, ty) === 'valla', 'no se han colocado (o llevan giro)');
    check(inv().count('valla') === n0, 'no se han gastado');
    check(w().pieceAt(tx, ty)?.kind === 'fence', 'no es una pieza de valla');
    check(w().collidersNear(tx + 1, ty + 0.5).some(c => c.low && c.x0 === tx + 0.5), 'no se une a la de al lado');
    const obj = c => c.objects.find(o => o.tile?.[0] === tx && o.tile?.[1] === ty);
    const o = obj(w().contentFor(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))); check(o?.fence && !o.fixed, 'no se reconoce como valla');
    check(!game.aimTargets(p(), w()).some(a => a.kind === 'fence'), 'la valla se puede quitar sin el modo construir');
    check(game.pickUp(o), 'no se recoge'); check(!w().ownAt('placed', tx, ty) && inv().count('valla') === n0 + 1, 'no ha vuelto a la mochila');
    check(!game.pickUp({ tile: [tx + 1, ty], layer: 'placed', placed: 'valla', fixed: true }), 'lo fijo se ha recogido');
    game.build.piece = 'valla'; game.build.erase = true; game.build.on = true; game.build.remove([tx + 1, ty]); game.build.on = false; game.build.erase = false;
    check(!w().ownAt('placed', tx + 1, ty) && inv().count('valla') === n0 + 2, 'quitarla en el modo construir no la devuelve');
    inv().remove('valla', n0 + 2);
  });
  await test('bordes de biomas: el color cambia poco a poco, también entre trozos', async () => {
    const gen = w().gen, N = 64, kinds = f => [...new Set(f.biome)], dry = f => Math.max(...f.wet) < -0.5 && !kinds(f).some(b => BIOMES[b].water);
    let spot = null;
    for (let r = 6; r < 60 && !spot; r++) for (let a = 0; a < 40 && !spot; a++) {
      const cx = Math.round(Math.cos(a / 40 * 6.283) * r), cy = Math.round(Math.sin(a / 40 * 6.283) * r), f = gen.field(cx, cy);
      if (kinds(f).includes(B.ROCKY) && kinds(f).includes(B.MEADOW) && dry(f) && dry(gen.field(cx + 1, cy)) && !gen.nearVillage(cx, cy) && !gen.nearVillage(cx + 1, cy)) spot = [cx, cy];
    }
    check(spot, 'no hay un borde de roca y pradera sin agua');
    const A = paintPixels(gen, spot[0], spot[1], 0), C = paintPixels(gen, spot[0] + 1, spot[1], 0), at = (d, i, j, c) => d[(j * N + i) * 4 + c];
    let inside = 0, seam = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) {
      if (i < N - 1) inside = Math.max(inside, Math.abs(at(A, i, j, c) - at(A, i + 1, j, c)));
      if (j < N - 1) inside = Math.max(inside, Math.abs(at(A, i, j, c) - at(A, i, j + 1, c)));
    }
    for (let j = 0; j < N; j++) for (let c = 0; c < 3; c++) seam = Math.max(seam, Math.abs(at(A, N - 1, j, c) - at(C, 0, j, c)));
    check(inside < 40, `salto de color dentro del trozo: ${inside}`);   // (de roca a pradera sin mezclar son más de 50)
    check(seam < 40, `salto de color entre dos trozos: ${seam}`);
  });
  await test('pueblo seguro: de noche ahí no aparecen, no entran ni persiguen', async () => {
    const M = game.mobs, say = () => {}, ok = (x, y) => !w().water(x, y) && !w().collidersNear(x, y).some(c => (c.r !== undefined ? Math.hypot(c.x - x, c.y - y) < c.r + 0.5 : x > c.x0 - 0.5 && x < c.x1 + 0.5 && y > c.y0 - 0.5 && y < c.y1 + 0.5));
    runCommand(game, '/time set 23:00', say);
    for (let ty = BOUNDS.y0 + 1; ty < BOUNDS.y1 - 1; ty++) for (let tx = BOUNDS.x0 + 1; tx < BOUNDS.x1 - 1; tx++) check(!M.canSpawn(tx, ty), `puede aparecer en ${tx},${ty}`);
    let y = null;
    for (let ty = BOUNDS.y0 + 4; ty < BOUNDS.y1 - 4 && y === null; ty++) { let free = true; for (let x = BOUNDS.x0 - 8; x < BOUNDS.x0 + 3 && free; x++) free = ok(x + 0.5, ty + 0.5); if (free) y = ty + 0.5; }
    check(y !== null, 'no hay una tira libre junto al pueblo');
    await goTo(game, BOUNDS.x0 - 2, y);
    let out = false; for (let x = BOUNDS.x0 - 14; x < BOUNDS.x0 - 2 && !out; x++) out = M.canSpawn(x, Math.floor(y));
    check(out, 'fuera del pueblo tampoco aparecen (¿es de noche?)');
    const X0 = BOUNDS.x0, hp = game.combat.hp;
    // (desde dentro: se queda fuera y no persigue)
    p().x = X0 + 1.5; p().y = y; p().vx = p().vy = 0; await frames(2);
    const limo = M.summon('limo', X0 - 0.5, y);
    await frames(180);
    check(M.list.includes(limo) && limo.x <= X0, `ha entrado en el pueblo: ${limo.x}, ${limo.y}`);
    // (desde fuera: sí persigue)
    M.remove(limo); p().x = X0 - 2; p().y = y; await frames(2);
    const otro = M.summon('limo', X0 - 7, y), d0 = Math.hypot(otro.x - p().x, otro.y - p().y);
    await frames(60);
    check(Math.hypot(otro.x - p().x, otro.y - p().y) < d0 - 0.5, 'fuera del pueblo no persigue');
    M.remove(otro); M.clearNear(p().x, p().y, 60); game.combat.hp = hp; game.combat.invuln = 0; game.combat.paint();
    runCommand(game, '/time reset', say);
  });
  await test('mapa grande: norte arriba, nombres, leyenda, y el zoom hacia el ratón', async () => {
    await goTo(game, CENTER.x, CENTER.y);
    const M = game.map, gen = w().gen, was = M.zoom; M.recenter(); M.zoom = 3; M.markers = game.places.markers();
    M.people = [{ x: CENTER.x + 3, y: CENTER.y, name: 'Vecina de prueba' }];
    M.drawBig(gen, game.explored, p().x, p().y, 0);
    const [, up] = M.toScreen(p().x, p().y - 10, p().x, p().y), [, down] = M.toScreen(p().x, p().y + 10, p().x, p().y), [left] = M.toScreen(p().x - 10, p().y, p().x, p().y), [right] = M.toScreen(p().x + 10, p().y, p().x, p().y);
    check(up < down && left < right, 'el norte no está arriba');
    check(M.labels.includes('Tú') && M.labels.includes('Casa de Rosa'), `nombres: ${M.labels.join(', ')}`);
    M.zoom = 8; M.recenter(); M.scroll(0, -M.tile * 2); M.drawBig(gen, game.explored, HOUSE.x0 + 6, HOUSE.y0 + 5, 0); check(M.labels.includes('Tu casa'), `sin tu casa: ${M.labels.join(', ')}`);
    M.recenter(); M.zoom = 3;
    // (lo que hay bajo el ratón se queda bajo el ratón al acercar)
    const sx = innerWidth / 2 + 90, sy = innerHeight / 2 - 40, cx = p().x + M.pan.x, cy = p().y + M.pan.y, wx = cx + (sx - innerWidth / 2) / M.tile, wy = cy + (sy - innerHeight / 2) / M.tile;
    M.zoomAt(2, sx, sy);
    const nx = p().x + M.pan.x + (sx - innerWidth / 2) / M.tile, ny = p().y + M.pan.y + (sy - innerHeight / 2) / M.tile;
    check(M.zoom === 5 && Math.abs(nx - wx) < 0.01 && Math.abs(ny - wy) < 0.01, `se ha movido: ${wx},${wy} → ${nx},${ny}`);
    M.zoomAt(99); check(M.zoom === 8, 'el zoom se pasa'); M.zoomAt(-99); check(M.zoom === 1, 'el zoom se pasa por abajo');
    // (arrastrar 40 píxeles a la derecha mueve la vista lo mismo, con el zoom que sea)
    M.recenter(); M.zoom = 4; M.scroll(40, 0); check(Math.abs(M.pan.x - 40 / M.tile) < 0.01 && M.pan.y === 0, 'el arrastre no sigue al ratón');
    const legend = document.getElementById('map-legend-rows').textContent; check(legend.includes('Tu casa') && legend.includes('Pradera'), `leyenda: ${legend}`);
    M.recenter(); M.zoom = was; M.people = [];
  });
  await test('primeros pasos: se cumplen de uno en uno, con recompensa, y se guardan', async () => {
    const S = game.steps, st = game.stats, was = { i: S.i, base: S.base, pay: S.pay }, equip = inv().equip.espalda;
    S.reset({}); check(S.i === 0 && S.pay && !S.over, 'una partida nueva no empieza por el primero');
    S.reset({ inventory: {} }); check(S.over, 'a una partida de antes le salen');
    S.reset({ steps: { i: 3, base: 7 } }); check(S.i === 3 && S.base === 7 && S.pay, 'no se recupera lo guardado');
    const out = {}; S.save(out); check(out.steps.i === 3 && out.steps.base === 7, 'no se guarda');
    const money = game.money;
    S.reset({}); S.check(); check(document.getElementById('quest').hidden === false && document.getElementById('quest-text').textContent.length > 3, 'no se ve lo que toca');
    const doing = {
      nilo: () => game.craft.teach('banco'), segar: () => st.add('segados', 3), mochila: () => { inv().equip.espalda = { id: 'mochila', color: ITEMS.mochila.dye }; }, talar: () => st.add('talados', 1),
      tablas: () => inv().add('tablas', 6), picar: () => st.add('picados', 1), banco: () => st.add('estaciones', 1), dormir: () => st.add('dormido', 1), labrar: () => st.add('labrados', 3), sembrar: () => st.add('sembrados', 1),
    };
    const total = STEPS.reduce((n, s) => n + (s.skip?.(game) ? 0 : s.money || 0), 0);
    for (let guard = 0; !S.over && guard < STEPS.length + 2; guard++) {
      const before = S.i, step = S.step;
      S.check(); if (S.i !== before) continue;   // (ya estaba hecho, como hablar con Nilo: ya no se pide)
      if (step.stat) { const p = S.progress(); st.add(step.stat, p[1] - 1); S.check(); check(S.i === before, `${step.id} se da por hecho sin terminarlo`); st.add(step.stat, 1); }
      else if (step.id === 'taller') { p().x = TAVERN.x0 + 3; p().y = TAVERN.y0 + 3; }
      else doing[step.id]?.();
      S.check(); check(S.i > before, `${step.id} no se cumple`);
    }
    check(S.over, `no se terminan: va por ${S.i}`);
    check(game.money === money + total, `recompensas: ${game.money - money}, esperaba ${total}`);
    check(document.getElementById('quest').hidden, 'al terminar sigue viéndose');
    const paid = game.money; S.restart(); check(!S.over && !S.pay, 'no se pueden repasar'); S.check(); doing.segar();
    for (let guard = 0; !S.over && guard < 30; guard++) { const step = S.step; if (step.stat) st.add(step.stat, step.need); else if (step.id === 'taller') { p().x = TAVERN.x0 + 3; p().y = TAVERN.y0 + 3; } S.check(); }
    check(S.over && game.money === paid, 'al repasarlos también pagan');
    check(game.steps.journal().includes('Repasarlos'), 'el diario no los lista');
    inv().equip.espalda = equip; inv().changed(); S.reset({ steps: was }); await goTo(game, 60, 36);
  });
  await test('puerta de valla: se une, empieza cerrada, se abre, y se quita en el modo construir', async () => {
    await goTo(game, 60, 36);
    let y = null, x0 = null;
    for (let ty = 30; ty < 50 && y === null; ty++) for (let tx = 56; tx < 80 && y === null; tx++) if ([0, 1, 2].every(i => w().canPlace(tx + i, ty, 'valla', null)) && [0, 1, 2].every(i => w().canPlace(tx + i, ty + 1, 'valla', null)) && [0, 1, 2].every(i => w().canPlace(tx + i, ty - 1, 'valla', null))) { x0 = tx; y = ty; }
    check(y !== null, 'no hay sitio para el cercado');
    const gx = x0 + 1, blocks = (px, py) => { const q = { x: px, y: py }; collideNow(q, w().collidersNear(px, py), 0.25); return Math.hypot(q.x - px, q.y - py) > 0.01; };
    inv().add('puerta_valla', 1); inv().selected = inv().slots.findIndex(s => s?.id === 'puerta_valla'); inv().changed();
    w().place(x0, y, 'valla'); w().place(x0 + 2, y, 'valla');
    p().x = gx + 0.5; p().y = y + 1.4; p().face = { x: 0, y: -1 }; await frames(2);
    game.gather.cooldown = 0; game.gather.target = game.gather.pickTarget(); check(game.gather.target?.ok && game.gather.target.tile[0] === gx && game.gather.target.tile[1] === y, 'no apunta al hueco de la valla'); game.gather.use(); await frames(1);
    check(w().ownAt('placed', gx, y) === 'puerta_valla', 'no se ha colocado (o lleva giro)'); check(inv().count('puerta_valla') === 0, 'no se ha gastado');
    const gate = w().contentFor(Math.floor(gx / CHUNK), Math.floor(y / CHUNK)).objects.find(o => o.tile?.[0] === gx && o.tile?.[1] === y);
    check(gate?.door === 'x' && gate.gate, `no va en la línea de las vallas: ${gate?.door}`);
    check(w().doorClosed(gx, y) && blocks(gx + 0.5, y + 0.5), 'no empieza cerrada');
    check(game.doorAction([gx, y]).text === 'Abrir la puerta de valla', `dice: ${game.doorAction([gx, y]).text}`);
    await frames(2); game.doorAction([gx, y]).run(); await frames(2);
    check(!w().doorClosed(gx, y) && !blocks(gx + 0.5, y + 0.5), 'abierta no se puede pasar');
    check(w().collidersNear(x0 + 1, y + 0.5).some(c => c.low && c.x0 === x0 + 0.5), 'la valla no se une a la puerta');
    check(!game.doorAction([gx, y])?.alt, 'la puerta de valla se puede recoger sin el modo construir');
    game.build.piece = 'puerta_valla'; game.build.erase = true; game.build.on = true; game.build.remove([gx, y]); game.build.on = false; game.build.erase = false;
    check(!w().ownAt('placed', gx, y) && inv().count('puerta_valla') === 1, 'no ha vuelto a la mochila'); check(!w().doorClosed(gx, y), 'se queda apuntada como cerrada');
    inv().remove('puerta_valla', 1); w().setTile(x0, y, 'air'); w().setTile(x0 + 2, y, 'air');
    const r = RECIPES.find(r => r.id === 'puerta_valla'); check(r && r.station === 'banco', 'no se fabrica en el banco'); check(PIECE_IDS.includes('puerta_valla'), 'no está en la paleta');
  });
  await test('vallas del jardín: se recogen, vuelven a ponerse y no las de otros', async () => {
    let t = null; for (const [x, yy] of [[YARD.x0, YARD.y0 + 5], [YARD.x0, YARD.y0 + 6], [YARD.x0 + 1, YARD.y0]]) if (w().yardFenceAt(x, yy)) { t = [x, yy]; break; }
    check(t, 'no hay valla en el jardín');
    await goTo(game, t[0] + 3.5, t[1] + 0.5);
    const [tx, ty] = t, keep = inv().count('valla'), find = () => w().contentFor(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)).objects.find(o => o.tile?.[0] === tx && o.tile?.[1] === ty);
    const o = find(); check(o?.yard && o.fixed && o.fence, `no se reconoce como valla del jardín: ${JSON.stringify(o)}`);
    check(game.pickUp(o), 'no se recoge'); check(inv().count('valla') === keep + 1, 'no ha vuelto a la mochila');
    check(!w().pieceAt(tx, ty) && !find(), 'sigue ahí');
    check(w().delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)).gone?.[`${tx},${ty}`], 'no queda apuntado');
    check(!w().collidersNear(tx + 0.5, ty + 0.5).some(c => c.low && c.x === tx + 0.5 && c.y === ty + 0.5), 'sigue chocando');
    check(!game.pickUp({ tile: [HOUSES.rosa.x0, HOUSES.rosa.y0], layer: 'placed', placed: 'muro_entramado', fixed: true }), 'se ha recogido un muro de un vecino');
    check(w().canPlace(tx, ty, 'valla', p()), 'no se puede volver a poner'); w().place(tx, ty, 'valla'); check(w().ownAt('placed', tx, ty) === 'valla' && w().pieceAt(tx, ty)?.kind === 'fence', 'no se ha vuelto a poner');
    const hole = [GATE_X, YARD.y1 - 1]; check(w().canPlace(hole[0], hole[1], 'puerta_valla', null), 'en el hueco del jardín no cabe la puerta');
    check(!w().canPlace(hole[0], hole[1], 'silla', null), 'en el camino del jardín cabe cualquier cosa');
    w().setTile(tx, ty, 'air'); delete w().delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)).gone[`${tx},${ty}`]; w().touchAround(tx, ty); inv().remove('valla', 1);
  });
  await test('pesca: un clic lanza y otro saca el pez cuando pica', async () => {
    const F = game.fishing, peces = game.stats.get('peces');
    inv().add('cana', 1); inv().selected = inv().slots.findIndex(s => s?.id === 'cana'); inv().changed();
    await goTo(game, POND.x, POND.y - POND.ry - 0.6); p().x = POND.x; p().y = POND.y - POND.ry - 0.6; p().vx = p().vy = 0; p().face = { x: 0, y: 1 }; await frames(2);
    const use = () => { game.gather.cooldown = 0; game.gather.target = game.gather.pickTarget(); check(game.gather.target?.use, `la caña no apunta al agua: ${game.gather.target?.label}`); game.gather.target.use(); };
    use(); check(F.state?.phase === 'wait', 'un clic no lanza'); F.state.t = 99; await frames(2);
    use(); check(!F.state, 'pulsar antes de que pique no recoge el sedal'); check(game.stats.get('peces') === peces, 'ha salido un pez sin picar');
    use(); F.state.fly = 1; F.state.t = 0.01; await frames(3); check(F.state?.phase === 'bite', 'no pica');
    use(); check(!F.state && game.stats.get('peces') === peces + 1, 'al clic no sale el pez'); await collectDrops(game, 'a recoger el pez');
    await frames(2); game.gather.cooldown = 0; game.gather.target = game.gather.pickTarget(); p().x = POND.x; p().y = POND.y - POND.ry - 0.6; p().face = { x: 0, y: 1 }; await frames(2);
    use(); F.state.fly = 1; F.state.t = 0.01; await frames(3); F.state.t = 0.01; await frames(3); check(!F.state && game.stats.get('peces') === peces + 1, 'tardando, también sale');
    inv().remove('cana', 1); check(!ITEMS.mesa_encantar && !document.getElementById('fishbar'), 'quedan restos');
  });
  await test('mesa de encantar retirada: al cargar se quita y se devuelven sus materiales', async () => {
    const cx = 100, cy = 100, k = `${cx},${cy}`, deltas = new Map([[k, { removed: {}, tilled: {}, v: 0, placed: { '1600,1600': 'mesa_encantar@1', '1601,1600': 'silla' }, pos: { 'placed:1600,1600': [1, 2, 3] }, chest: { '1602,1600': [{ id: 'mesa_encantar', n: 1 }, { id: 'madera', n: 2 }] } }]]);
    const save = game.snapshot(); save.inventory.slots = [{ id: 'mesa_encantar', n: 1 }, { id: 'hacha', n: 1, dur: 15, ench: { filo: 2 } }, ...save.inventory.slots.slice(2)];
    save.inventory.equip = { cabeza: { id: 'casco_hierro', dur: 3, ench: { proteccion: 1 } } }; deltas.get(k).chest['1602,1600'][1].ench = { fortuna: 1 };
    const before = save.inventory.slots.length, owed = retireItems(save, deltas), d = deltas.get(k);
    check(!d.placed['1600,1600'] && d.placed['1601,1600'] === 'silla' && !d.pos['placed:1600,1600'], 'no se ha quitado la del mundo'); check(d.chest['1602,1600'][0] === null && d.chest['1602,1600'][1].id === 'madera', 'no se ha quitado la del cofre');
    check(save.inventory.slots[0] === null && save.inventory.slots.length === before, 'no se ha quitado la de la mochila');
    check(owed.iron && save.inventory.slots[1].id === 'hacha_hierro' && save.inventory.slots[1].dur === Math.ceil(ITEMS.hacha_hierro.dur * 15 / 60), `el hacha de madera no pasa a hierro: ${JSON.stringify(save.inventory.slots[1])}`);
    check(owed.spell && !save.inventory.slots[1].ench && !save.inventory.equip.cabeza.ench && !d.chest['1602,1600'][1].ench, 'quedan encantamientos en la partida vieja');
    const count = id => owed.filter(o => o[0] === id).reduce((n, o) => n + o[1], 0); check(count('amatista') === 12 && count('tablas') === 18 && count('lingote_hierro') === 6, `devuelve: ${JSON.stringify(owed)}`);
  });
  await test('herramientas: solo las de hierro, desde el principio', async () => {
    // (la pala llena es la misma pala con tierra: no cuenta como otra herramienta)
    const tools = Object.entries(ITEMS).filter(([, d]) => ['hacha', 'pico', 'guadana', 'azada', 'pala'].includes(d.tool) && !d.empty);
    check(tools.length === 5 && tools.every(([id, d]) => id.endsWith('_hierro') && d.name.endsWith('de hierro')), `hay: ${tools.map(t => t[0]).join(', ')}`);
    for (const t of ['hacha', 'pico', 'guadana', 'azada', 'pala']) {
      check(inv().slots.some(s => s?.id === `${t}_hierro`), `no se empieza con ${t} de hierro`);
      check(RECIPES.some(r => r.out === `${t}_hierro` && r.station === 'yunque'), `no se fabrica ${t} de hierro`);
    }
    check(!RECIPES.some(r => /^(hacha|pico|guadana|azada)(_|$)/.test(r.out) && !r.out.endsWith('_hierro')), 'quedan recetas de las otras');
    for (const shop of Object.values(SHOPS)) for (const it of shop.stock) if (it.id) check(ITEMS[it.id], `se vende algo que no existe: ${it.id}`);
    check(repairMat('pico_hierro') === 'lingote_hierro', 'no se repara con hierro');
    check(hitsFor(HARVEST.boulder) === 2 && HARVEST.veta_diamante.drops[0][0] === 'diamante', 'los golpes no son los del hierro');
  });
  await test('yunque: sin encantamientos, dos iguales gastados se juntan', async () => {
    const said = []; runCommand(game, '/enchant @s sharpness', (t, k) => said.push(`${k}: ${t}`)); check(said.some(t => t.startsWith('err')), `/enchant sigue: ${said.join(' | ')}`);
    const free = () => inv().slots.findIndex(s => !s), a = free(); inv().slots[a] = { id: 'espada_oro', n: 1, dur: 10 };
    const b = free(); inv().slots[b] = { id: 'espada_oro', n: 1, dur: 20 };
    try {
      const pair = game.craft.combinable().find(c => c.a === a && c.b === b), max = ITEMS.espada_oro.dur;
      check(pair && pair.cost === 2 && pair.it.dur === Math.min(max, 30 + Math.floor(max * 0.12)) && !pair.it.ench, `sale: ${JSON.stringify(pair)}`);
    } finally { inv().slots[a] = inv().slots[b] = null; inv().changed(); }
  });
  await test('guardar y cargar: la partida vuelve igual', async () => {
    await goTo(game, 40, 40);
    inv().add('bayas', 7);
    const [tx, ty] = freeTile(game, [[41, 41], [42, 41], [41, 42]]); w().place(tx, ty, 'cofre'); w().chestAt(tx, ty)[2] = { id: 'piedra', n: 3 };
    const snap = game.snapshot(), deltas = game.world.deltas, x = p().x, y = p().y, bayas = inv().count('bayas');
    game.end(); game.start(JSON.parse(JSON.stringify(snap)), new Map(JSON.parse(JSON.stringify([...deltas]))));
    await readyGround(game, 6000);
    check(Math.abs(p().x - x) < 0.01 && Math.abs(p().y - y) < 0.01, `posición: ${p().x}, ${p().y}`);
    check(inv().count('bayas') === bayas, 'las bayas no vuelven');
    check(w().chestAt(tx, ty)?.[2]?.n === 3, 'el cofre no vuelve con lo suyo');
  });
  await test('panel F3: se abre, dice los fotogramas y se cierra', async () => {
    const key = () => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'F3', key: 'F3', bubbles: true, cancelable: true }));
    const el = document.getElementById('debug');
    key(); await frames(2); check(el && !el.hidden, 'no se abre');
    // (el bucle lo llevan las pruebas: el panel no tiene fotogramas que contar, y lo dice)
    check(/fps|fotogramas/.test(el.textContent) && /bioma/.test(el.textContent) && /trozos/.test(el.textContent), `no dice lo suyo: ${el.textContent.slice(0, 120)}`);
    key(); await frames(2); check(el.hidden, 'no se cierra');
  });
  await test('iconos: los de lo que se coloca, las herramientas y la comida salen del modelo 3D, el resto a píxel', async () => {
    check(modelKind('silla') === 'placed' && modelKind('hacha_hierro') === 'tool' && modelKind('estofado') === 'food' && modelKind('carpa') === 'food' && !modelKind('madera') && !modelKind('camisa') && !modelKind('alfombra') && !modelKind('trigo'), 'la clase de icono no es la esperada');
    const bad = [];
    for (const id of Object.keys(ITEMS)) {
      const c = itemIcon(id), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let magenta = 0, opaque = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100) { opaque++; if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] > 200) magenta++; }
      if (magenta > 20 || opaque < 10 || c.width !== (modelKind(id) ? ICON3D : 18)) bad.push(id);
    }
    check(!bad.length, `iconos vacíos, de relleno o de otro tamaño: ${bad.join(', ')}`);
  });
  await test('dibujo: el jugador no se pinta a ciegas, las luces apagadas no se calculan, el cielo va al final y la lista de objetos pinta al verse', async () => {
    const v = game.view3d;
    await goTo(game, CENTER.x, CENTER.y + 3); draw();
    // El jugador: en la primera pasada (sin color ni fondo) se salta; con color, se pinta
    const hand = v.actors.player.hand, held = o => { for (let q = o; q; q = q.parent) if (q === hand) return true; return false; };   // (lo que lleva en la mano va aparte)
    const meshes = [];
    v.actors.player.person.root.traverse(o => { if (o.isMesh && !held(o)) meshes.push(o); });
    const pm = meshes[0], geo = pm.geometry;
    pm.onBeforeRender(null, null, null, geo, { colorWrite: false, depthWrite: false }); const blind = geo.drawRange.count; pm.onAfterRender(null, null, null, geo);
    pm.onBeforeRender(null, null, null, geo, { colorWrite: true, depthWrite: true }); const seen = geo.drawRange.count; pm.onAfterRender(null, null, null, geo);
    check(blind < 0 && seen === Infinity && geo.drawRange.count === Infinity, `el jugador: ${blind} a ciegas, ${seen} con color`);
    // Las luces de cerca se saltan donde no dan luz, y el cielo se pinta después de lo opaco
    check(THREE.ShaderChunk.lights_fragment_begin.includes('if ( directLight.visible ) RE_Direct'), 'las luces de cerca se calculan aunque no den luz');
    let later = 0;
    v.scene.traverse(o => { if (o !== v.sky && o.isMesh && !o.material.transparent) later = Math.max(later, o.renderOrder); });
    check(!v.sky.material.transparent && v.sky.renderOrder > later, `el cielo va en el orden ${v.sky.renderOrder} y hay opaco en el ${later}`);
    // La lista de todos los objetos (modo creativo): al abrirla se pintan los que se ven, no todos
    const W = game.windows, said = [];
    runCommand(game, '/gamemode creative', t => said.push(t));
    try {
      W.open('s-inv');
      const cells = [...document.querySelectorAll('#inv-all-grid .slot')], shown = () => !cells[0].querySelector('img').hidden;
      await until(() => { void cells[0].getBoundingClientRect(); return shown(); }, 20000, 'que se pinte el primer icono al abrir');
      check(cells[0].querySelector('img').src, 'el primer icono no tiene dibujo');
      check(cells.at(-1).querySelector('img').hidden, 'se pintan también los que no se ven');
    } finally { W.closeAll(); runCommand(game, '/gamemode survival', () => {}); }
  });
  await test('resolución automática: baja mientras sirve y no se queda donde no gana nada', async () => {
    // (como un MacBook Air con pantalla Retina: a ×2 va a 12 fps y por debajo de ×1 ya no mejora)
    const FPS = { 2: 12, 1.75: 15, 1.5: 18, 1.25: 22, 1: 26, 0.75: 27 }, fake = { pixelRatio: 2, setScale(x) { this.pixelRatio = x; } };
    for (let i = 0; i < 200; i++) View3D.prototype.autoScale.call(fake, FPS[fake.pixelRatio] ?? 30, 0.5);
    check(fake.pixelRatio === 1 && fake.scaling.floor === 1, `se queda en ×${fake.pixelRatio}`);
    // (y con una gráfica que sí gana al bajar, baja hasta el final)
    const G = { 2: 10, 1.75: 14, 1.5: 18, 1.25: 24, 1: 30, 0.75: 36 }, g = { pixelRatio: 2, setScale(x) { this.pixelRatio = x; } };
    for (let i = 0; i < 200; i++) View3D.prototype.autoScale.call(g, G[g.pixelRatio], 0.5);
    check(g.pixelRatio === 0.75, `con gráfica lenta se queda en ×${g.pixelRatio}`);
  });
  await test('arte: la luz y la paleta sobrias son las de todos, y sobrio() da lo de la propuesta', async () => {
    check(game.view3d.renderer.toneMapping === THREE.CustomToneMapping, 'la curva de tono no es la del arte (AgX con ajuste)');
    check(sobrio('#c83a3a') === '#b84949' && sobrio('#e8b07a', 'piel') === '#e1b386', `sobrio() no da lo de la propuesta: ${sobrio('#c83a3a')}, ${sobrio('#e8b07a', 'piel')}`);
    check(BIOMES[B.MEADOW].pal[0] === tonosSuelo('#6a7845', 1)[0] && BIOMES[B.MEADOW].rgb.length === 4, `la pradera es ${BIOMES[B.MEADOW].pal[0]}`);
    check(tintOf('stone')[1] === '#958f84', `la piedra compartida es ${tintOf('stone')[1]}`);
  });
  await test('texturas de fotos: cada archivo de assets/tex está en la lista y en las licencias, y llegan', async () => {
    const files = Object.values(PHOTOS).map(p => p.file), list = await (await fetch('assets/tex/')).text(), lic = await (await fetch('assets/LICENCIAS.md')).text();
    const onDisk = [...list.matchAll(/href="([^"]+\.webp)"/g)].map(m => decodeURIComponent(m[1]));
    check(onDisk.length === files.length && onDisk.every(f => files.includes(f)), `assets/tex no casa con photos.js: ${onDisk.filter(f => !files.includes(f)).join(', ') || files.filter(f => !onDisk.includes(f)).join(', ')}`);
    const missing = files.filter(f => !lic.includes(`tex/${f}`));
    check(!missing.length, `faltan en assets/LICENCIAS.md: ${missing.join(', ')}`);
    for (const f of files) { const r = await fetch(`assets/tex/${f}`, { method: 'HEAD' }); check(r.ok, `no se sirve assets/tex/${f}`); }
    const img = await photo('teja');
    check(img && img.width === 512, `la foto de la teja no llega (${img?.width})`);
  });
  await test('cuevas: se entra, se baja, se sube y se sale; del templo también, y el faro es aparte', async () => {
    // (hasta 2026-11-11 el del faro se llamaba igual que el de las escaleras y lo tapaba: ni se bajaba ni se salía)
    const ex = game.places, v = game.view3d, wr = v.whenReady, say = hud.say;
    v.whenReady = () => sleep(50); hud.say = () => Promise.resolve();   // (sin esperar a la gráfica ni al diálogo del faro)
    try {
      const near = kind => { for (let r = 0; r < 30; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; const q = ex.poi(Math.floor(CENTER.x / CHUNK) + dx, Math.floor(CENTER.y / CHUNK) + dy); if (q?.kind === kind) return q; } return null; };
      // (aim: como con el ratón, lo que dice la escalera apuntada, que es como se juega en el ordenador; si no, con E)
      const ladder = async (dir, want, aim = false) => {
        const o = game.scene.live().find(o => o.ladder === dir);
        check(o, `no hay escalera para ${dir === 'up' ? 'subir' : 'bajar'}`);
        p().x = o.x + 0.6; p().y = o.y; await frames(1);
        const a = aim ? game.aimTargets(p(), game.scene).filter(t => t.kind === 'sys' && t.sys === ex && Math.hypot(t.box.x - o.x, t.box.y - o.y) < 0.1).map(t => game.actionFor(t))[0]
          : ex.interact(p(), game.scene);
        check(a?.text === want, `la escalera dice «${a?.text}» y no «${want}»`);
        await a.run(); await frames(2);
      };
      const cave = near('cueva'), faros = game.stats.get('faros');
      check(cave, 'no hay ninguna cueva cerca del pueblo');
      await goTo(game, cave.x, cave.y + 1.8);
      const enter = ex.interact(p(), w());
      check(enter?.text === 'Entrar en la cueva', `en la entrada dice «${enter?.text}»`);
      await enter.run(); await frames(2);
      check(game.scene !== w() && game.scene.depth === 1, 'no se entra en la cueva');
      await ladder('down', 'Bajar al nivel 2', true);
      check(game.scene.depth === 2 && game.stats.get('profundidad') >= 2, `después de bajar, en el nivel ${game.scene.depth}`);
      await ladder('up', 'Subir al nivel 1', true);
      check(game.scene.depth === 1, `después de subir, en el nivel ${game.scene.depth}`);
      await ladder('up', 'Salir');
      check(game.scene === w() && Math.hypot(p().x - cave.x, p().y - cave.y) < 3, 'no se sale a la entrada de la cueva');
      check(game.stats.get('faros') === faros && ![...game.explored].some(k => k.includes('NaN')), 'las escaleras suben a un faro');
      // (el templo y el faro, si hay alguno cerca del pueblo; si no, se dice, para que no pase por probado)
      const tem = near('templo');
      if (!tem) console.log('cuevas: no hay templo cerca del pueblo (no se prueba)');
      else { await ex.enterDungeon(tem); await frames(2); check(game.scene.style === 'temple', 'no se entra en el templo'); await ladder('up', 'Salir'); check(game.scene === w(), 'no se sale del templo'); }
      const faro = near('faro');
      if (!faro) console.log('cuevas: no hay faro cerca del pueblo (no se prueba)');
      else {
        await goTo(game, faro.x + 1.2, faro.y + 1.2);
        const a = ex.interact(p(), w()), n = game.explored.size;
        check(a?.text === 'Subir al faro', `en el faro dice «${a?.text}»`);
        await a.run();
        check(game.stats.get('faros') === faros + 1 && game.explored.size > n, 'el faro no descubre la costa');
      }
    } finally { v.whenReady = wr; hud.say = say; if (game.scene !== w()) game.teleport(CENTER.x, CENTER.y + 3); }
  });
  await test('fallos: un sistema que falla no para a los que van detrás, no inunda la consola y se ve', async () => {
    let behind = 0;
    const broken = { constructor: { name: 'Broken' }, update() { throw new Error('fallo a propósito'); } }, after = { update() { behind++; } };
    const before = errors.length, clock = w().clock, dot = document.getElementById('fault');
    game.systems.push(broken, after);
    try {
      await frames(120);
      check(behind >= 120 && w().clock > clock, `los de detrás se paran: ${behind} pasos, reloj ${w().clock - clock}`);
      const said = errors.slice(before);
      check(said.length === 1 && /fallo a propósito/.test(said[0]), `en la consola: ${said.length} veces`);
      check(dot && !dot.hidden && /Broken\.update/.test(dot.textContent), 'no sale el punto rojo con el error');
      dot.click();
      check(dot.hidden, 'el punto no se esconde con un clic');
    } finally { game.systems.splice(game.systems.indexOf(broken), 2); errors.length = before; }   // (el fallo era a propósito: no cuenta)
  });
  await test('ganchos: ningún sistema tapa un gancho con otra cosa', async () => {
    const HOOKS = { target: 3, interact: 2, entities: 1, onDay: 1 };   // (los ganchos con parámetros: un método con ese nombre y otro uso los taparía)
    for (const s of game.systems) for (const [h, n] of Object.entries(HOOKS)) if (typeof s[h] === 'function' && s[h].length < n) throw new Error(`${s.constructor.name}.${h} tiene ${s[h].length} parámetros y el gancho pide ${n}`);
  });
  await test('red: animales y granja elemento a elemento (cría y caricia a la vez, heno a la vez, otro anfitrión, foto entera, embarazos)', async () => {
    // Dos juegos de mentira (cada colección, un mapa id → objeto) repartiendo como en live.js, sin relay: H lleva el mundo, I es invitado
    const fake = () => {
      const st = { animals: new Map(), family: new Map([['@', {}]]), farm: new Map([['@', { hay: 50 }]]) };
      const io = name => [() => new Map([...st[name]].map(([k, v]) => [k, structuredClone(v)])), ops => {
        for (const [k, id, f, v] of ops) { const o = st[name].get(id); if (k === 'put') st[name].set(id, structuredClone(f)); else if (k === 'drop') st[name].delete(id); else if (o) { if (k === 'set') o[f] = v; else delete o[f]; } }
      }];
      const [ai, aa] = io('animals'), [fi, fa] = io('farm'), [mi, ma] = io('family');
      return { st, ranch: { netItems: ai, netApply: aa, farmItems: fi, farmApply: fa }, family: { netItems: mi, netApply: ma } };
    };
    const H = fake(), I = fake(), sync = () => Object.fromEntries(Object.keys(COLLECTIONS).map(k => [k, new ItemSync(k)]));
    for (const g of [H, I]) g.st.animals.set('vaca', { type: 'vaca', love: 5 });
    const sh = sync(), si = sync();
    let seq = 0, acked = -1;
    for (const k in sh) { sh[k].reset(H); si[k].reset(I); }
    const fromI = n => { const s = ++seq; return { n, ops: si[n].diff(I, s), seq: s }; };
    const toH = m => { sh[m.n].apply(H, m.ops, false); acked = m.seq; };
    const fromH = n => ({ n, ops: sh[n].diff(H), ack: acked });
    const toI = m => si[m.n].apply(I, m.ops, true, m.ack, { full: !!m.full });
    const json = (g, n) => JSON.stringify([...g.st[n]].sort());
    const same = () => Object.keys(COLLECTIONS).every(n => json(H, n) === json(I, n));
    // Nace una cría en H mientras I acaricia la vaca: lo de I llega cuando H ya ha mandado la cría
    H.st.animals.set('cria', { type: 'vaca', named: false }); I.st.animals.get('vaca').love = 6;
    const m1 = fromI('animals'), h1 = fromH('animals');
    toI(h1); check(I.st.animals.get('vaca').love === 6, 'lo de H, de antes de saber lo de I, deshace la caricia');
    toH(m1); toI(fromH('animals'));
    check(H.st.animals.has('cria') && I.st.animals.has('cria') && H.st.animals.get('vaca').love === 6 && same(), `cría o caricia perdidas: ${json(H, 'animals')} / ${json(I, 'animals')}`);
    // Heno a la vez: H saca 20 e I saca 5
    H.st.farm.get('@').hay = 30; I.st.farm.get('@').hay = 45;
    const m2 = fromI('farm'); toI(fromH('farm'));
    check(I.st.farm.get('@').hay === 45, 'lo de I se deshace antes de llegar');
    toH(m2); toI(fromH('farm'));
    check(H.st.farm.get('@').hay === 25 && same(), `heno: ${H.st.farm.get('@').hay}/${I.st.farm.get('@').hay}`);
    // I compra una gallina y quien lo llevaba se va sin aplicarlo: al nuevo (aquí, H otra vez) se le vuelve a mandar
    I.st.animals.set('gal', { type: 'gallina', love: 1 }); fromI('animals');   // (se pierde)
    for (const k in si) si[k].unsend();
    toH(fromI('animals')); toI(fromH('animals'));
    check(H.st.animals.has('gal') && same(), 'la gallina comprada se pierde al cambiar quien lleva el mundo');
    // H quita la vaca y no llega (se pierde); I compra otra gallina, aún sin aplicar: la foto entera quita la vaca y no la gallina
    H.st.animals.delete('vaca'); fromH('animals');
    I.st.animals.set('gal2', { type: 'gallina' }); const m3 = fromI('animals');
    toI({ n: 'animals', ops: sh.animals.full(H), ack: acked, full: 1 });
    check(!I.st.animals.has('vaca') && I.st.animals.has('gal2'), `foto entera: ${json(I, 'animals')}`);
    toH(m3); toI(fromH('animals'));
    check(same(), `distintos al final: ${json(H, 'animals')} / ${json(I, 'animals')}`);
    // El segundo embarazo: el primero ya se quitó, y uno nuevo tiene otro id (que no esté en lo quitado)
    const F = game.family, k1 = [...F.netItems({ kids: [], expecting: { since: 3, mother: 'x' } }).keys()].find(k => k.startsWith('exp:'));
    const k2 = [...F.netItems({ kids: [], expecting: { since: 12, mother: 'x' } }).keys()].find(k => k.startsWith('exp:'));
    check(k1 && k2 && k1 !== k2, `los embarazos tienen el mismo id: ${k1} ${k2}`);
  });

  // ---------- the weight inventory and carrying in the arms (the default: carry.js) ----------
  // The suite's game already has it (a new game, without ?inventario=casillas). If it was started with the slot inventory
  // (?inventario=casillas in the address), once with the weight one (Carry.force) and, at the end, back as it was
  let weightBack = null;
  const weightOn = async () => {
    if (game.inv.weight) return;
    weightBack = { snap: JSON.stringify(game.snapshot()), deltas: JSON.stringify([...game.world.deltas]) };
    Carry.force = true;
    game.end();
    try { game.start(JSON.parse(weightBack.snap), new Map(JSON.parse(weightBack.deltas))); } catch (e) { throw new Error(`start: ${e.stack?.split('\n').slice(0, 4).join(' < ')}`); }
    game.onSave = null;
    await readyGround(game, 8000); await frames(3);
    check(game.inv.weight, 'the game did not start with the weight inventory');
  };
  const near = (id, x, y, r = 3) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy; if ((w().ownAt('placed', tx, ty) || '').split('@')[0] === id) return w().placedObjectAt(tx, ty) || { tile: [tx, ty], layer: 'placed', placed: id, x: tx + 0.5, y: ty + 0.5 }; } return null; };
  const fake = (inv, more = {}) => ({ inv, gamemode: 'survival', player: { face: { x: 1, y: 0 } }, gather: { float() {} }, ...more });
  await test('pond (english): the player wades across the village pond; animals still go round it', async () => {
    const W = w(), up = screenToWorld(0, -1), l = Math.hypot(...up), d = [up[0] / l, up[1] / l], keysUp = { up: true };
    check(W.waterDepth(POND.x, POND.y) > 0.4, `no water in the middle of the pond: ${W.waterDepth(POND.x, POND.y)}`);
    check(W.waterDepth(POND.x + POND.rx * 1.5, POND.y) === 0, 'water outside the pond');
    check(!W.natWater(POND.x, POND.y), 'the pond became world water (boats, digging)');
    check(W.blocked(POND.x, POND.y), 'animals walk into the middle of the pond');
    const P = new Player({ name: 'x', x: POND.x - d[0] * 5, y: POND.y - d[1] * 5, look: {} });
    let waded = false, maxDepth = 0;
    for (let i = 0; i < 60 * 8; i++) { P.update(1 / 60, keysUp, W); waded ||= P.wading; maxDepth = Math.max(maxDepth, P.depth || 0); }
    const past = (P.x - POND.x) * d[0] + (P.y - POND.y) * d[1];
    check(past > 2, `stopped at the pond: ${past.toFixed(2)} m past its centre`);
    check(waded && maxDepth > 0.3, `did not wade (depth ${maxDepth.toFixed(2)})`);
  });

  await test('peso carga (weight load): the game modules load, without a cycle, and the weight inventory is the default', async () => {
    check(WeightInventory.prototype instanceof Inventory, 'WeightInventory is not an Inventory');
    const src = async f => (await fetch(`src/${f}?t=${Date.now()}`)).text(), imports = text => [...text.matchAll(/^import[^;]*?from '([^']+)'|^import '([^']+)'/gm)].map(m => m[1] || m[2]);
    const inv = imports(await src('inventory.js')), items = imports(await src('carry-items.js'));
    check(!inv.some(f => /carry\.js$/.test(f)), `inventory.js imports carry.js: ${inv}`);
    check(items.every(f => /\/(items|i18n)\.js$/.test(f)), `carry-items.js imports more than items.js and i18n.js: ${items}`);
    check(ITEMS.log && ITEMS.log.hide && ITEMS.carcass_deer.bulky, 'the new ids');
    const slotsURL = /[?&]inventario=(casillas|0)(&|$)/.test(location.search);
    check(Carry.force === null && weightMode() === !slotsURL && !!game.inv.weight === !slotsURL, `the default: weightMode ${weightMode()}, the game's ${!!game.inv.weight}, force ${Carry.force}`);
    Carry.force = false; check(!weightMode(), 'Carry.force = false does not turn it off'); Carry.force = null;
  });
  await test('peso (weight): each item weighs, the backpack adds capacity and nothing is ever refused', async () => {
    const W = new WeightInventory();
    for (const [id, n] of START_KIT) W.add(id, n);
    check(Math.abs(W.kg - (10.7 + weightOf('canteen'))) < 0.01 && W.capKg === BASE_CAP && BASE_CAP === 25, `the starting kit: ${W.kg} / ${W.capKg} kg`);
    W.equip.espalda = { id: 'mochila', color: ITEMS.mochila.dye }; W.changed();
    check(W.capKg === BASE_CAP + BAG_CAP && W.capKg === 70, `with the backpack: ${W.capKg}`);
    check(W.add('piedra', 500) === 0 && W.count('piedra') === 500 && W.room('piedra') === Infinity, `500 stones: ${W.count('piedra')}, room ${W.room('piedra')}`);
    check(W.kg > W.capKg && W.load > 1.5, `load ${W.load}`);
    check(W.add('log', 1) === 1 && !W.count('log'), 'a log went into the backpack');
    const N = new WeightInventory(); for (let i = 0; i < HOTBAR; i++) N.add('piedra', 99);
    check(N.room('piedra') === 0 && N.add('madera', 3) === 3, 'without a backpack more than the hotbar fits');
    const i = W.slots.findIndex((s, k) => k >= HOTBAR && s?.id === 'piedra');
    W.take(i, 99, true); check(W.slots[i] === null, 'taking leaves no hole');
    W.add('tablas', 5); check(W.slots[i]?.id === 'tablas', 'add does not fill the hole');
    const C = new WeightInventory(); C.infinite = true; C.add('piedra', 99); check(C.capKg === Infinity && C.load === 0, 'creative has a limit');
    check(weightOf('madera') === 2 && weightOf('peto_hierro') === 8 && weightOf('carpa') === 1 && weightOf('semilla_trigo') === 0.01 && weightOf('alfombra_persa_3x4') === 12, 'some weights are not as in the table');
    const before = W.kg; W.equip.encima = { id: 'peto_hierro' }; W.changed(); check(Math.abs(W.kg - before - 8) < 0.01, 'the armour worn does not count');
  });
  await test('peso guardado (weight save): more than 36 stacks and the carried log load in slot mode without losing anything, and back', async () => {
    const ids = Object.keys(ITEMS).filter(id => !ITEMS[id].wear && !ITEMS[id].hide && !BULKY[id] && !ITEMS[id].place && ITEMS[id].stack > 1).slice(0, 50);
    check(ids.length === 50, `${ids.length} ids`);
    const W = new WeightInventory(); W.equip.espalda = { id: 'mochila', color: ITEMS.mochila.dye };
    for (const id of ids) W.add(id, 3);
    W.armsItem = { id: 'log', day: null };
    const save = JSON.parse(JSON.stringify(W.toSave()));
    check(save.slots.length === 36 && save.keep.length === 50 - 36 + 1 && save.keep.at(-1).arms === 1 && save.w === 1, `slots ${save.slots.length}, keep ${save.keep?.length}`);
    const S = new Inventory(save), all = I => ids.every(id => I.count(id) + I.kept.filter(e => e.s.id === id).reduce((t, e) => t + e.s.n, 0) === 3);
    check(all(S), 'the slot inventory loses something');
    check(S.armsSaved?.id === 'log' && !S.count('log'), 'the log is not set aside');
    check(S.add('log', 1) === 0 && S.count('madera') >= 4, 'in slot mode a log is not its wood');
    const back = new WeightInventory(JSON.parse(JSON.stringify(S.toSave())));
    const want = id => (id === 'madera' ? 7 : 3);   // (the wood: the log's 4 too)
    check(ids.every(id => back.count(id) === want(id)) && !back.kept.length, `back: ${ids.filter(id => back.count(id) !== want(id))}`);
    const again = new WeightInventory(save);
    check(ids.every(id => again.count(id) === 3) && again.armsSaved?.id === 'log', 'weight → weight loses something');
    // (what goes in keep is the end of the list: it comes back there, not to the hotbar's holes)
    again.slots[6] = again.slots[7] = again.slots[8] = null; again.changed();
    const holes = new WeightInventory(JSON.parse(JSON.stringify(again.toSave())));
    check([6, 7, 8].every(k => !holes.slots[k]) && ids.slice(6, 9).every(id => !holes.count(id)) && ids.slice(9).every(id => holes.count(id) === 3), `keep went to the hotbar: ${holes.slots.slice(6, 9).map(x => x?.id)}`);
    check(Object.keys(new Inventory({ slots: [{ id: 'pan', n: 1 }] }).toSave()).sort().join() === 'equip,selected,slots,wardrobe', 'the slot save changed');
  });
  await test('peso partida vieja (old save): an overweight slot save keeps everything and walks slower', async () => {
    const old = { slots: Array.from({ length: 36 }, () => ({ id: 'piedra', n: 99 })), equip: { espalda: { id: 'mochila', color: ITEMS.mochila.dye } }, keep: [{ id: 'madera', n: 40 }, { id: 'cosa_nueva', n: 2 }] };
    const W = new WeightInventory(JSON.parse(JSON.stringify(old)));
    check(W.count('piedra') === 3564 && W.count('madera') === 40 && W.kept.some(e => e.s.id === 'cosa_nueva'), `stones ${W.count('piedra')}, wood ${W.count('madera')}`);
    const C = new Carry(fake(W));
    check(C.speedMul() === 0.45 && C.noRun() && C.jumpMul() >= 0.82, `speed ${C.speedMul()}`);
    const s = W.toSave(); check(s.keep.some(k => k.id === 'cosa_nueva') && s.slots.length === 36, 'the save loses what is of a newer version');
    // The notice, only the first time a slot save opens with weight (its save has no w yet), once the world is in sight
    // for a while (not under the dark of the way in); a weight save, never
    const toast = hud.toast, said = [], fade = document.getElementById('fade'), dark = fade?.classList.contains('on'); hud.toast = m => said.push(m);
    try {
      C.game.mode = 'play'; fade?.classList.add('on');
      C.reset({ inventory: old }); C.update(5); check(!said.length && C.oldWarn, `said in the dark: ${JSON.stringify(said)}`);
      fade?.classList.remove('on'); C.update(1); check(!said.length, 'said at once');
      C.update(2); check(said.length === 1 && said[0] === t('hud.load.too_heavy_old'), `a heavy slot save: ${JSON.stringify(said)}`);
      C.reset({ inventory: s }); C.update(5); check(said.length === 1 && s.w === 1, `a weight save says it again: ${JSON.stringify(said)}`);
    } finally { hud.toast = toast; fade?.classList.toggle('on', !!dark); }
  });
  await test('peso cargado (encumbered): speed, running, jump and tiredness follow the load; creative and riding ignore it', async () => {
    const W = new WeightInventory(), C = new Carry(fake(W)), at = kg => { W.slots.length = 0; W.slots.push(...Array(HOTBAR).fill(null)); W.equip.espalda = { id: 'mochila' }; W.add('piedra', kg); return C.speedMul(); };
    const close = (a, b) => Math.abs(a - b) < 1e-6;
    // (noRun: no sprint, past 125 %; noJog: only walking, past 150 %: the three speeds, entities.js GAIT)
    check(close(at(70), 1) && !C.noRun() && !C.noJog() && C.jumpMul() === 1, `r = 1: ${C.speedMul()}`);
    check(close(at(87.5), 0.8) && !C.noRun() && !C.noJog(), `r = 1.25: ${C.speedMul()}`);
    check(close(at(105), 0.6) && C.noRun() && !C.noJog(), `r = 1.5: ${C.speedMul()}`);
    at(106); check(C.noRun() && C.noJog(), `r = 1.51 still jogs: ${C.speedMul()}`);
    check(close(at(210), 0.45) && C.noRun() && C.noJog(), `r = 3: ${C.speedMul()}`);
    const jump = 5 * C.jumpMul(); check(jump * jump / 30 > 0.5, `the jump (${jump}) does not get out of a hole`);
    for (const more of [{ player: { mount: true } }, { player: { boat: true } }, { player: { aboard: 'x' } }, { gamemode: 'creative' }]) { const D = new Carry(fake(W, more)); check(D.speedMul() === 1 && !D.noRun() && !D.noJog() && D.jumpMul() === 1, `ignored: ${JSON.stringify(more)}`); }
    // Tiredness, in the game: walking loaded tires more
    await weightOn();
    const g = game, kept = g.inv.slots.slice(), ex = g.combat.exert.bind(g.combat);
    let n = 0; g.combat.exert = k => { n += k; ex(k); };
    try {
      g.inv.slots.fill(null); g.inv.changed();   // (light: whatever the tests before left in the bag must not count)
      p().vx = 3; p().vy = 0;
      g.carry.update(1); const light = n; n = 0;
      g.inv.add('piedra', 300); p().vx = 3; g.carry.update(1);
      check(n > light + 0.05, `loaded does not tire more: ${light} → ${n}`);
      g.carry.set('log'); n = 0; g.carry.update(1); check(n > 0.1, `the log does not tire: ${n}`);
      g.carry.set(null);
    } finally { g.combat.exert = ex; g.inv.slots.splice(0, g.inv.slots.length, ...kept); g.inv.changed(); p().vx = 0; }
  });
  await test('en brazos, tronco (log): a felled oak leaves a log away from you; E on the shoulder, Q down, the axe gives 2 wood and the bench 10 planks', async () => {
    await weightOn();
    const C = game.carry, sides = [[0.85, 0], [-0.85, 0], [0, 0.85], [0, -0.85]];
    for (const [sx, sy] of sides) {
      const o = findKind(game, ['oak', 'pine'], p().x, p().y); check(o, 'no trees near');
      await goTo(game, o.x + sx, o.y + sy);
      selectTool(game, 'hacha'); p().x = o.x + sx; p().y = o.y + sy; p().face = { x: -Math.sign(sx), y: -Math.sign(sy) }; p().vx = p().vy = 0;
      const madera = inv().count('madera'), alive = () => w().harvestablesNear(o.x, o.y).some(k => k.key === o.key);
      for (let i = 0; i < 20 && alive(); i++) { game.gather.cooldown = 0; game.gather.target = game.gather.pickTarget(); check(game.gather.target?.obj, `not aiming at the ${o.kind}`); game.gather.use(); await frames(2); }
      check(!alive(), 'the tree is still there');
      const log = near('log', o.x, o.y, 2); check(log, `no log from ${[sx, sy]}`);
      const dl = Math.hypot(log.x - p().x, log.y - p().y), dt = Math.hypot(o.x - p().x, o.y - p().y);
      check(dl >= dt - 0.2, `the log fell towards you (${dl.toFixed(2)} < ${dt.toFixed(2)})`);
      await frames(40); check(inv().count('madera') === madera, 'the tree also gave its wood');
    }
    // E: on the shoulder; Q: down in front
    const log = near('log', p().x, p().y, 3); check(log, 'no log near');
    check(game.placedAction(log).text === t('carry.shoulder', { item: noun('item', 'log') }), `E says: ${game.placedAction(log).text}`);
    game.placedAction(log).run(); check(C.held === 'log' && p().carrying === 'log' && p().armsBusy === 'shoulder' && !inv().held, 'not in the arms');
    check(!near('log', log.x, log.y, 0), 'still on the ground');
    game.toss(); check(!C.held, 'Q does not put it down');
    const down = near('log', p().x, p().y, 3); check(down, 'not on the ground');
    // The axe splits it where it lies: three blows, 2 wood
    selectTool(game, 'hacha');
    const wood = inv().count('madera'); for (let i = 0; i < 3; i++) C.split(down);
    check(!near('log', down.x, down.y, 0), 'three blows and it is still there');
    await collectDrops(game); check(inv().count('madera') >= wood + 2, `wood: ${inv().count('madera') - wood}`);
    // The bench: 10 planks
    const other = near('log', p().x, p().y, 4) || (() => { const [tx, ty] = freeTile(game, [[Math.floor(p().x) + 2, Math.floor(p().y)], [Math.floor(p().x), Math.floor(p().y) + 2], [Math.floor(p().x) - 2, Math.floor(p().y)]]); w().place(tx, ty, 'log'); return w().placedObjectAt(tx, ty); })();
    C.take(other); check(C.held === 'log', 'the second log is not in the arms');
    const [bx, by] = freeTile(game, [[Math.floor(p().x) + 1, Math.floor(p().y) + 1], [Math.floor(p().x) - 1, Math.floor(p().y) + 1], [Math.floor(p().x) + 1, Math.floor(p().y) - 1]]);
    w().place(bx, by, 'banco'); const bench = w().placedObjectAt(bx, by);
    const a = game.placedAction(bench), planks = inv().count('tablas');
    check(a.text === t('carry.saw'), `E on the bench says: ${a.text}`);
    a.run(); check(!C.held && inv().count('tablas') === planks + 10, `planks: ${inv().count('tablas') - planks}`);
    w().unplace(bench);
  });
  await test('en brazos, caza (carcass): a deer leaves its carcass; in the field the least, at the kitchen the most; a hen as before; the parts match PREY; after 2 days it turns to bones', async () => {
    await weightOn();
    for (const [id, B] of Object.entries(BULKY)) if (B.prey) check(JSON.stringify(B.drops) === JSON.stringify(PREY[B.prey].drops) && CARCASS_OF[B.prey] === id, `${id} does not match PREY.${B.prey}`);
    const C = game.carry, X = 62, Y = 44;
    await goTo(game, X, Y);
    game.hunt.reward({ type: 'ciervo', young: false, x: X + 2.5, y: Y + 0.5 });
    const c = near('carcass_deer', X + 2.5, Y + 0.5, 2); check(c, 'no carcass');
    check(w().delta(Math.floor(c.tile[0] / 16), Math.floor(c.tile[1] / 16))?.carcass?.[`${c.tile}`] === game.days.realDay, 'its day is not noted');
    check(C.dayOf(game.days.dayIndex) === game.days.realDay && C.dayOf(game.days.realDay + 5) === game.days.realDay, 'a day of the prototype or of the future');
    // (playing together, for a few seconds only whoever hunted it takes it: the note of its chunk)
    const L0 = game.live, j0 = L0.joined, P = C.picks(c.tile, true), k0 = `${c.tile}`, clk = w().clock || 0;
    try {
      L0.joined = true; P[k0] = ['id-someone-else', clk];
      const why = C.notYours(c), a0 = game.placedAction(c);
      check(why && a0.text === why && !a0.alt, `another's carcass: ${a0.text}`);
      C.take(c); C.butcher(c); check(!C.held && near('carcass_deer', c.x, c.y, 0), 'taken before its time');
      P[k0] = ['id-someone-else', clk - 4]; check(!C.notYours(c), 'still not free after the seconds');
      P[k0] = [Profile.id, clk]; check(!C.notYours(c), 'not even its hunter');
      L0.joined = false; P[k0] = ['id-someone-else', clk]; check(!C.notYours(c), 'alone, not free');
    } finally { L0.joined = j0; delete P[k0]; }
    const meat = inv().count('carne_venado'); game.placedAction(c).alt.run(); check(!near('carcass_deer', c.x, c.y, 0), 'X does not butcher it');
    await collectDrops(game); check(inv().count('carne_venado') === meat + 2, `field: ${inv().count('carne_venado') - meat} meat`);
    game.hunt.reward({ type: 'ciervo', young: false, x: X + 2.5, y: Y + 0.5 });
    const c2 = near('carcass_deer', X + 2.5, Y + 0.5, 2); C.take(c2); check(C.held === 'carcass_deer' && p().armsBusy === 'across', 'not on the shoulders');
    const [kx, ky] = freeTile(game, [[X + 1, Y + 1], [X - 1, Y + 1], [X + 1, Y - 1]]); w().place(kx, ky, 'cocina');
    const kitchen = w().placedObjectAt(kx, ky), a = game.placedAction(kitchen), m2 = inv().count('carne_venado'), bone = inv().count('hueso');
    check(a.text === t('carry.butcher_here'), `the kitchen says: ${a.text}`);
    a.run(); check(!C.held && inv().count('carne_venado') === m2 + 3 && inv().count('hueso') === bone + 1, 'the kitchen does not give the most and the extra');
    w().unplace(kitchen);
    // A hen and a young one: as before; in creative, the meat
    const drops = game.gather.drops.length; game.hunt.reward({ type: 'gallina', young: false, x: X + 2.5, y: Y });
    check(game.gather.drops.length > drops && !near('carcass_deer', X + 2.5, Y, 2), 'the hen is not as before');
    await collectDrops(game);
    game.hunt.reward({ type: 'ciervo', young: true, x: X + 2.5, y: Y }); check(!near('carcass_deer', X + 2.5, Y, 2), 'a fawn leaves a carcass'); await collectDrops(game);
    // After 2 days only bones
    game.hunt.reward({ type: 'vaca', young: false, x: X + 2.5, y: Y + 0.5 });
    const cow = near('carcass_cow', X + 2.5, Y + 0.5, 2); check(cow, 'no cow carcass');
    w().delta(Math.floor(cow.tile[0] / 16), Math.floor(cow.tile[1] / 16)).carcass[`${cow.tile}`] = game.days.realDay - 2;
    // (playing together, only the game that decides the world rots it: a guest's, never)
    const L = game.live, was = { joined: L.joined, role: L.role };
    try { L.joined = true; L.role = 'guest'; check(!C.rotsWorld(), 'a guest rots'); C.rot(); check(near('carcass_cow', cow.x, cow.y, 0), 'a guest rotted it'); L.role = 'host'; check(C.rotsWorld(), 'the host does not rot'); }
    finally { L.joined = was.joined; L.role = was.role; }
    const bones = game.gather.drops.length; C.rot(); check(!near('carcass_cow', cow.x, cow.y, 0) && game.gather.drops.length > bones && game.gather.drops.at(-1).id === 'hueso' && game.gather.drops.at(-1).ttl > 0, 'no bones after 2 days');
    await collectDrops(game);
  });
  await test('en brazos, límites (carry limits): Q only puts it down, a held click does not punch, no swimming, no sprinting (a jog is fine), no fence hopping, sitting or sleeping; the backpack does not take it; in slot mode /give log gives wood', async () => {
    await weightOn();
    const C = game.carry, G = game.gather;
    // (what the tests before piled up in the bag must not leave the player too loaded to run: heavy stacks out)
    game.inv.slots.forEach((s, i) => { if (s && weightOf(s.id) * s.n > 5) game.inv.slots[i] = null; }); game.inv.changed();
    C.set('log');
    try {
      G.cooldown = 0; G.swing = 0; G.use(); G.use(true); check(G.swing === 0 && G.cooldown === 0, 'a click with the arms full does something');
      check(C.noRun() && C.jumpMul() >= 0.86 && C.hint()?.key === 'Q' && game.inv.add('log', 1) === 1 && game.inv.room('log') === 0, 'run, jump, hint or the backpack');
      game.build.toggle(true); check(!C.hint(), 'in build mode the carry hint hides B\'s'); game.build.toggle(false);
      check(C.refuse() && C.held === 'log', 'refuse does not refuse');   // (mounting with it is allowed since phase 2: see «caballo con bulto»)
      game.rest.floor('floorSit'); check(!p().pose, 'sat down with a log');
      check(C.state() === 'log', 'the network does not say it');
    } finally { C.set(null); }
    check(!C.state() && !C.noRun(), 'empty arms');
    // E never puts it down (only Q); riding, a log is not taken; B › Remove on a log gives its parts (it is not lost)
    const [lx, ly] = freeTile(game, [[Math.floor(p().x) + 2, Math.floor(p().y)], [Math.floor(p().x), Math.floor(p().y) + 2], [Math.floor(p().x) - 2, Math.floor(p().y)]]);
    C.set('log'); game.mouse = null; game.nearest = () => null;
    try { game.action(); check(C.held === 'log', 'E with nothing to do put it down'); } finally { delete game.nearest; C.set(null); }
    w().place(lx, ly, 'log'); const lg = w().placedObjectAt(lx, ly);
    p().mount = { id: 'x' }; try { const a = game.placedAction(lg); check(a.text === t('carry.not_riding'), `riding, E says: ${a.text}`); C.take(lg); check(!C.held && near('log', lx + 0.5, ly + 0.5, 0), 'riding, the log was taken'); } finally { p().mount = null; }
    const wood = inv().count('madera'); check(game.pickUp(lg) && !near('log', lx + 0.5, ly + 0.5, 0) && inv().count('madera') === wood + 4, `B › Remove on a log: ${inv().count('madera') - wood} wood`);
    // On foot: into deep water, no; over a fence in a jump, no (the same player without it: yes, and yes)
    const up = screenToWorld(0, -1), l = Math.hypot(...up), d = [up[0] / l, up[1] / l], keysUp = { up: true };
    const walk = (carrying, scene, steps, high = false) => { const P = new Player({ name: 'x', x: 0, y: 0, look: {} }); P.carrying = carrying; for (let i = 0; i < steps; i++) { if (high) { P.z = 0.6; P.vz = 0; } P.update(1 / 60, keysUp, scene); } return P; };
    const sea = { waterDepth: (x, y) => (Math.hypot(x, y) > 2 ? 2 : 0), collidersNear: () => [], digNear: () => null };
    check(Math.hypot(walk('log', sea, 240).x, walk('log', sea, 240).y) < 2.05, 'walked into deep water with a log');
    check(walk(null, sea, 240).swim, 'without it does not swim');
    const fence = [{ x: d[0] * 5.8, y: d[1] * 5.8, r: 5, low: true }];   // (a fence 0.8 m ahead: the near edge of a big low circle)
    const flat = { collidersNear: () => fence, digNear: () => null }, past = P => P.x * d[0] + P.y * d[1];
    check(past(walk(null, flat, 45, true)) > 1, 'without it the jump does not pass the fence');
    check(past(walk('log', flat, 45, true)) < 0.8, 'with the log the jump passes the fence');
    // Slot mode: a log is its wood
    const S = new Inventory(); S.add('log', 1); check(S.count('madera') === 4 && !S.count('log'), 'slot mode keeps a log');
  });
  await test('peso cofres (weight chests): B and C take what is missing from chests within 16 tiles and say from where', async () => {
    await weightOn();
    const I = inv(), kept = I.slots.slice();
    try {
      for (const id of ['fibra', 'cuerda', 'tablas', 'piedra']) I.remove(id, I.count(id));
      const [tx, ty] = freeTile(game, [[Math.floor(p().x) + 3, Math.floor(p().y)], [Math.floor(p().x), Math.floor(p().y) + 3], [Math.floor(p().x) - 3, Math.floor(p().y)]]);
      w().place(tx, ty, 'cofre'); const chest = w().chestAt(tx, ty);
      chest[0] = { id: 'fibra', n: 5 }; chest[1] = { id: 'tablas', n: 10 }; chest[2] = { id: 'piedra', n: 4 };
      const r = RECIPES.find(r => r.station === 'mano' && r.out === 'cuerda'); game.craft.grant('cuerda');
      check(!game.craft.problem(r) && game.craft.times(r) === 1, `crafting does not see the chest: ${game.craft.problem(r)}`);
      game.craft.craft(r); check(I.count('cuerda') === 1 && chest[0]?.n === 2, `crafting did not take from the chest: ${chest[0]?.n}`);
      check(game.gather.floaters.some(f => f.text.includes(t('carry.from_chest', { n: 3, item: ITEMS.fibra, chest: { name: ITEMS.cofre.name, g: 'm' } }))), `it does not say from where: ${game.gather.floaters.map(f => f.text)}`);
      game.build.near = null; check(game.build.affordable('banco'), 'building does not see the chest');
      // (the stones: from the nearest chest, which may be one an earlier test left closer: counted over all of them)
      const stones = () => game.carry.chests().reduce((n, { c }) => n + c.reduce((k, s) => k + (s?.id === 'piedra' ? s.n : 0), 0), 0), st0 = stones();
      I.add('tablas', 2); game.build.paid('banco'); check(!I.count('tablas') && chest[1]?.n === 6 && stones() === st0 - 2, `building: ${I.count('tablas')} / ${chest[1]?.n} / ${st0 - stones()} stones`);
      // All or nothing: what was counted a moment ago and is gone (another player took it) is not given away
      I.remove('tablas', I.count('tablas')); game.carry.have('tablas'); const gone = chest[1]; chest[1] = null;
      const pieces = inv().count('piedra'), st1 = stones(); check(game.carry.spend([['tablas', 2], ['piedra', 1]]) === false && stones() === st1 && inv().count('piedra') === pieces, 'spend took part of a cost it could not pay');
      chest[1] = gone;
      // Too far (17 tiles), or a neighbor's: no
      game.carry.near = null; const far = p().x; p().x += 400; check(game.carry.have('piedra') === 0, 'a chest far away counts'); p().x = far;
      for (let i = 0; i < chest.length; i++) chest[i] = null;
      w().unplace({ tile: [tx, ty], layer: 'placed', placed: 'cofre' });
    } finally { I.slots.splice(0, I.slots.length, ...kept); I.changed(); }
  });
  await test('en brazos, cuevas y casas (carry places): down a cave and into a house with it, and put down there', async () => {
    await weightOn();
    const cave = makeCave(game, 1, 1, false);
    const floor = (() => { for (let y = 1; y < 30; y++) for (let x = 1; x < 30; x++) if (cave.canPlace(x, y, 'antorcha')) return [x, y]; return null; })();
    check(floor && cave.canPlace(...floor, 'log') && cave.canPlace(...floor, 'carcass_deer') && !cave.canPlace(...floor, 'silla'), 'a cave does not let it down');
    const H = game.houseRect(), C = game.carry;
    await goTo(game, (H.x0 + H.x1) / 2 + 0.5, H.y0 + 2.5); p().face = { x: 1, y: 0 };
    C.set('log'); check(C.drop(), 'it cannot be put down in the house'); check(!C.held && near('log', p().x, p().y, 2), 'not in the house');
    C.take(near('log', p().x, p().y, 2)); check(C.held === 'log', 'not picked up again'); C.set(null);
  });
  await test('en brazos, muerte (carry death): the carried log stays where you fell', async () => {
    await weightOn();
    await goTo(game, 40, 40);
    const kept = inv().slots.slice(), equip = { ...inv().equip };
    game.carry.set('log');
    try { game.combat.dropAll(); check(!game.carry.held && near('log', 40, 40, 1), 'the log is not where you fell'); }
    finally { inv().slots.splice(0, inv().slots.length, ...kept); Object.assign(inv().equip, equip); inv().changed(); game.gather.drops.length = 0; }
  });
  await test('red en brazos (carry net): the st message says what you carry and a remote player draws it', async () => {
    await weightOn();
    const live = game.live, A = game.view3d.actors, ents = live.entities;
    try {
      live.receive('c1', { t: 'hi', id: 'id-c1', name: 'c1', playing: true, look: LOOK });
      live.receive('c1', { t: 'st', sc: 'world', x: p().x + 1.5, y: p().y + 0.5, yaw: 0, ca: 'carcass_deer' });
      const e = live.peers.get('c1').entity;
      check(e.carrying === 'carcass_deer' && e.armsBusy === 'across', `carrying: ${e.carrying}`);
      live.entities = sc => (sc === game.world ? live.others.filter(o => o.entity).map(o => o.entity) : null);
      draw(); draw();
      const m = A.models.get(e); check(m?.carriedObj?.parent === m.person.r.bones.torso, 'the other player does not show it');
      live.receive('c1', { t: 'st', sc: 'world', x: p().x + 1.5, y: p().y + 0.5, yaw: 0, ca: 'cosa_nueva' }); draw();
      check(!e.carrying && !m.carriedObj, 'an unknown id is carried');
      // The player: on the body, with the tools hidden as PLAN-A says (kit.js shownOf, arms)
      game.carry.set('log'); draw(); draw();
      check(A.player.carriedObj && game.view3d.actors.player.kitSig?.a === 'shoulder', 'the player does not show it, or the kit does not know');
      game.carry.set(null); draw(); check(!A.player.carriedObj, 'it stays drawn');
    } finally { live.entities = ents; live.peers.delete('c1'); draw(); }
  });
  await test('peso interfaz (weight UI): the list, the load bar and the HUD meter in the minimal and the full interface', async () => {
    await weightOn();
    const $ = id => document.getElementById(id), W = game.windows, I = inv(), kept = I.slots.slice();
    try {
      I.equip.espalda ||= { id: 'mochila', color: ITEMS.mochila.dye }; I.changed();   // (the list is the backpack's)
      for (const [id, n] of [['piedra', 30], ['madera', 12], ['manzana', 4], ['tablas', 9], ['carbon', 5], ['fibra', 20], ['cuerda', 3], ['hueso', 2], ['tela', 2], ['cuero', 1], ['lana', 3], ['harina', 2]]) I.add(id, n);   // (more than the hotbar: some go to the list)
      W.open('s-inv'); await frames(2);
      check($('pk-box') && !$('pk-box').hidden && getComputedStyle($('inv-grid')).display === 'none', 'the list does not replace the grid');
      const rows = [...document.querySelectorAll('#pk-box .pk-row')];
      check(rows.length === I.listSlots().length && rows.length > 0, `${rows.length} rows for ${I.listSlots().length} stacks`);
      check($('pk-top').querySelector('.pk-load b').textContent === t('gui.inventory.load', { kg: I.kg, cap: I.capKg }), `the load says: ${$('pk-top').querySelector('.pk-load b').textContent}`);
      rows[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })); rows[0].dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      check($('inv-desc').textContent.includes('kg'), `the details do not say the weight: ${$('inv-desc').textContent}`);
      W.closeAll();
      for (const min of [false, true, false, true]) {
        useSmartHud(game, min); draw();
        const m = $('hud-load'); check(m?.parentNode?.id === (min ? 'hud-status' : 'hotbar'), `the meter is in ${m?.parentNode?.id} with the ${min ? 'minimal' : 'full'} interface`);
      }
    } finally { W.closeAll(); I.slots.splice(0, I.slots.length, ...kept); I.changed(); useSmartHud(game, true); draw(); }
  });
  await test('peso coste (weight cost): 4 players carrying cost less than 0.5 ms per frame', async () => {
    await weightOn();
    const live = game.live, A = game.view3d.actors, ents = live.entities, C = game.carry, N = 2000;
    try {
      for (let k = 0; k < 4; k++) { live.receive('q' + k, { t: 'hi', id: 'id-q' + k, name: 'q' + k, playing: true, look: LOOK }); live.receive('q' + k, { t: 'st', sc: 'world', x: p().x + 1 + k, y: p().y + 1, yaw: 0, ca: k % 2 ? 'log' : 'carcass_deer' }); }
      live.entities = sc => (sc === game.world ? live.others.filter(o => o.entity).map(o => o.entity) : null);
      draw(); draw();
      C.set('log');
      // The logic of each frame (the load, the speed, the meter) and the pose of the four (each pose, the arms)
      let t0 = performance.now();
      for (let i = 0; i < N; i++) { C.update(1 / 60); C.speedMul(); C.noRun(); C.jumpMul(); C.showLoad(); game.onFrame?.(); }
      const logic = (performance.now() - t0) / N;
      const Ps = [...live.others].map(o => A.models.get(o.entity)?.person).filter(Boolean);
      t0 = performance.now();
      for (let i = 0; i < N; i++) for (const P of Ps) holdPose(P, 'shoulder');
      const pose = (performance.now() - t0) / N;
      const calls = [...live.others].reduce((n, o) => { let k = 0; A.models.get(o.entity)?.carriedObj?.traverse(q => { if (q.isMesh) k++; }); return n + k; }, 0);
      console.log(`peso coste: ${(logic * 1000).toFixed(1)} µs logic, ${(pose * 1000).toFixed(1)} µs pose of 4, ${calls} meshes for 4 players`);
      check(logic + pose < 0.5 && calls <= 4 * 8, `${logic.toFixed(3)} + ${pose.toFixed(3)} ms, ${calls} meshes`);
      tell('peso coste: medida', true, `${(logic * 1000).toFixed(1)} µs/frame logic, ${(pose * 1000).toFixed(1)} µs pose ×4, ${calls} meshes ×4`);
    } finally { C.set(null); live.entities = ents; for (let k = 0; k < 4; k++) live.peers.delete('q' + k); draw(); }
  });
  // ---------- phase 2: the wheelbarrow, a big thing on the horse and in the boat (barrow.js; docs/planes/gta/PLAN-C2-fase2.md) ----------
  const WB = () => game.barrow, meId = () => Profile.id || 'me', ckey = (tx, ty) => `${Math.floor(tx / CHUNK)},${Math.floor(ty / CHUNK)}`;
  const dOf = (tx, ty) => w().delta(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK), true);
  // Open ground (7 × 7 free tiles, out of the village), near (x, y)
  const openGround = (x = 62, y = 44) => {
    const free = (cx, cy) => { for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) if (!w().canPlace(cx + i, cy + j, 'cofre', null) || w().water(cx + i + 0.5, cy + j + 0.5) || inBounds(cx + i + 0.5, cy + j + 0.5)) return false; return true; };
    for (let r = 0; r < 60; r++) for (let a = 0; a < 16; a++) { const cx = Math.floor(x + Math.cos(a / 16 * 6.283) * r * 2), cy = Math.floor(y + Math.sin(a / 16 * 6.283) * r * 2); if (free(cx, cy)) return [cx, cy]; }
    throw new Error('no open ground for the wheelbarrow');
  };
  // A wheelbarrow placed free with its centre on a tile's centre and heading yaw (as B places it)
  const placeBarrow = (tx, ty, yaw = 0) => {
    const f = w().fitFree('wheelbarrow', tx + 0.5, ty + 0.5, yaw, 0, null);
    check(f.ok, `the wheelbarrow does not fit: ${f.why}`);
    w().placeFree('wheelbarrow', f);
    const o = w().placedObjectAt(...f.anchor);
    check(o?.placed === 'wheelbarrow', 'not placed');
    return o;
  };
  // Stand behind its grips (where push puts you) and push it
  const pushIt = q => {
    const o = w().placedObjectAt(...q.tile) || q, [fx, fy] = dirOf(o.yaw ?? 0);   // (as the chunk is now: its own box is skipped by reference)
    Object.assign(p(), { x: o.x - fx * CENTER_AHEAD, y: o.y - fy * CENTER_AHEAD, vx: 0, vy: 0, z: 0, vz: 0, floor: 0, mount: false, boat: false, aboard: null, swim: false, pose: null });
    const why = WB().cantPush(o);
    check(!why && WB().push(o), `push refused: ${why}`);
  };
  const parkedNear = (x, y, r = 3) => near('wheelbarrow', x, y, r);
  const letGo = () => { if (WB().pushing) WB().park(true); if (game.carry.held) game.carry.set(null); };
  const angle = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  await test('carretilla plano (wheelbarrow plan): a B Exterior buildable at the bench, Dani sells its plan for 250 and only the plan teaches it', async () => {
    const b = BUILDABLE.wheelbarrow;
    check(b && b.cat === 'Exterior' && b.needs === 'banco' && JSON.stringify(b.cost) === JSON.stringify([['tablas', 10], ['lingote_hierro', 1]]), `buildable: ${JSON.stringify(b && { cat: b.cat, needs: b.needs, cost: b.cost })}`);
    check(PLANS.has('wheelbarrow') && PLAN_BORN.has('wheelbarrow') && PLANS_V === 2 && ITEMS.wheelbarrow?.name === t('item.wheelbarrow') && CHESTS.wheelbarrow?.[0] === 12, 'its plan, name or chest');
    check(SHOPS.dani.stock.some(s => s.plan === 'wheelbarrow' && s.price === 250), 'Dani does not sell its plan for 250');
    const C = game.craft, before = JSON.parse(JSON.stringify(C.toSave()));
    try {
      // (old saves, with planks and iron seen, get the plans of then; never the wheelbarrow's)
      for (const planos of [0, 1, 2]) { C.reset({ seen: ['tablas', 'lingote_hierro', 'cuerda', 'madera'], taught: [], planos }); check(!C.hasPlan('wheelbarrow'), `an old save (planos ${planos}) learnt it for free`); }
      C.reset({ seen: ['tablas'], taught: [], planos: 0 }); check(C.hasPlan('silla') || !RECIPES.find(r => r.out === 'silla')?.plan, 'the old gift of plans is gone');
      C.reset(JSON.parse(JSON.stringify(before)));
      check(!C.hasPlan('wheelbarrow') || before.taught.includes('wheelbarrow'), 'known without its plan');
      C.learnPlan('wheelbarrow'); check(C.hasPlan('wheelbarrow'), 'learnPlan does not teach it');
    } finally { C.reset(JSON.parse(JSON.stringify(before))); }
    const planks = inv().count('tablas'), iron = inv().count('lingote_hierro');
    inv().add('wheelbarrow', 1); check(inv().count('tablas') === planks + 10 && inv().count('lingote_hierro') === iron + 1 && !inv().count('wheelbarrow'), '/give wheelbarrow does not give its materials');
    inv().remove('tablas', 10); inv().remove('lingote_hierro', 1);
  });
  await test('carretilla cofre (wheelbarrow chest): 12 stacks that B and C pay from; Remove and Move refuse it while it has stacks or bundles', async () => {
    await weightOn();
    const [tx, ty] = openGround(); await goTo(game, tx + 0.5, ty + 3.5);
    const o = placeBarrow(tx, ty), k = `${o.tile}`, d = dOf(...o.tile), chest = w().chestAt(...o.tile);
    try {
      check(o.free && chest?.length === 12 && /^[a-z0-9]{8}$/.test(d.barrow?.[k]?.id || ''), `its chest or id: ${chest?.length} ${JSON.stringify(d.barrow?.[k])}`);
      check(game.carry.chests().some(c => String(c.o.tile) === k), 'B and C do not see it');
      const empty = o.obb; check(!o.model, `empty, a model: ${o.model}`);
      for (const id of ['piedra']) inv().remove(id, inv().count(id));
      chest[0] = { id: 'piedra', n: 5 }; w().chestTouched(...o.tile); WB().stacksChanged(o.tile);
      check(w().placedObjectAt(...o.tile)?.model === 'wheelbarrow::f', `with stacks: ${w().placedObjectAt(...o.tile)?.model}`);
      game.carry.near = null; check(game.carry.spend([['piedra', 2]]) && chest[0]?.n === 3, `B/C do not pay from it: ${chest[0]?.n}`);
      check(!game.pickUp(w().placedObjectAt(...o.tile)) && WB().isAt(o.tile), 'taken down with stacks');
      chest[0] = null; w().chestTouched(...o.tile); WB().stacksChanged(o.tile);
      d.barrow[k].l = [['log', null]]; w().touch(...o.tile.map(v => Math.floor(v / CHUNK)));
      const o2 = w().placedObjectAt(...o.tile);
      check(o2?.model === 'wheelbarrow:log' && Math.abs(o2.obb.hx - empty.hx) < 1e-6 && Math.abs(o2.obb.hy - empty.hy) < 1e-6, `with a log: ${o2?.model}, its boxes the empty one's`);
      check(!game.pickUp(o2, true) && WB().isAt(o2.tile), 'moved (B › Move) with a big thing on it');
      const was = game.mouse; game.mouse = null;
      try { game.build.removeAt(o2.tile); check(WB().isAt(o2.tile), 'B › Remove took it down with a big thing'); } finally { game.mouse = was; }
      d.barrow[k].l = [];
      const planks = inv().count('tablas'), iron = inv().count('lingote_hierro');
      check(game.pickUp(w().placedObjectAt(...o.tile)) && !WB().isAt(o.tile) && !d.barrow[k], 'empty, not taken down (or its id stays)');
      check(inv().count('tablas') === planks + 10 && inv().count('lingote_hierro') === iron + 1, 'its materials do not come back');
      inv().remove('tablas', 10); inv().remove('lingote_hierro', 1);
      // (put by tiles, /setblock: free, with the empty one's boxes; air takes everything)
      w().setTile(tx, ty, 'wheelbarrow'); const s = w().placedObjectAt(tx, ty);
      check(s?.free && Math.abs(s.obb.hx - empty.hx) < 1e-6, `by /setblock: free ${s?.free}`);
      w().setTile(tx, ty, 'air'); check(!w().ownAt('placed', tx, ty), '/setblock air');
    } finally { if (WB().isAt(o.tile)) { w().setTile(...o.tile, 'air'); } }
  });
  await test('carretilla empujar (wheelbarrow push): E pushes it, it leaves its tile as one world record; ×0.85, no running, no jumping; Q parks it where it is drawn with the same things and id', async () => {
    await weightOn();
    const [tx, ty] = openGround(); await goTo(game, tx + 0.5, ty + 3.5);
    const C = game.carry, kg = inv().kg, base = C.speedMul();
    try {
      const o = placeBarrow(tx, ty), k = `${o.tile}`, id = WB().idAt(o.tile);
      w().chestAt(...o.tile)[0] = { id: 'piedra', n: 3 }; dOf(...o.tile).barrow[k].l = [['log', null]];
      game.mouse = null; check(game.placedAction(w().placedObjectAt(...o.tile)).text === t('barrow.push'), `E says: ${game.placedAction(w().placedObjectAt(...o.tile)).text}`);
      pushIt(o);
      const r = WB().record();
      check(!w().ownAt('placed', ...o.tile) && r && r.by === meId() && r.c[0]?.id === 'piedra' && r.l[0]?.[0] === 'log', `the record: ${JSON.stringify(r)}`);
      check(p().pushing === 'wheelbarrow:log:f' && !inv().held && inv().armsFull && p().armsBusy === 'push', `the body: ${p().pushing} ${p().armsBusy} held ${inv().held?.id}`);
      check(Math.abs(C.speedMul() - base * BARROW.SLOW) < 1e-6 && C.noRun() && C.noJog() && C.state() === p().pushing, `speed ${C.speedMul()} (${base} on foot), run ${C.noRun()} jog ${C.noJog()}`);
      p().jump(); check(p().vz === 0, 'jumped with it');
      check(Math.abs(inv().kg - kg) < 1e-6, 'what it carries weighs on you');
      const stones = Math.max(1, Math.ceil((1.2 * inv().capKg - inv().kg) / weightOf('piedra')));   // (well over what it carries freely, whatever earlier tests left)
      inv().add('piedra', stones); check(C.speedMul() < base * BARROW.SLOW - 0.01, `the backpack's load does not slow it more: ${C.speedMul()} at ${inv().load.toFixed(2)}`); inv().remove('piedra', stones);
      // (its x, y: a note, the chunk is not made again)
      const t0 = w().touches; WB().rec.sentAt = -99; WB().rec.sx = p().x - 5; WB().update(1 / 60);
      check(w().touches === t0 && WB().record().x === Math.round(p().x * 100) / 100, `writing x, y made the chunk again: ${w().touches - t0}`);
      // E: a neighbour talks; a station says the hands are full; at nothing, parks it
      const wasM = game.mouse, n0 = game.neighbors.people[0];
      try {
        game.mouse = { in: true, x: 0, y: 0 };
        game.aimed = () => ({ kind: 'npc', n: n0, e: n0 }); check(game.nearest()?.text === `Hablar con ${n0.def.name}`, `at a neighbour: ${game.nearest()?.text}`);
        game.aimed = () => ({ kind: 'placed', o: { placed: 'banco', tile: [tx, ty] } }); check(game.nearest()?.text === t('barrow.hands_full'), `at a station: ${game.nearest()?.text}`);
        game.aimed = () => null; check(game.nearest()?.text === t('barrow.park'), `at nothing: ${game.nearest()?.text}`);
      } finally { delete game.aimed; game.mouse = wasM; }
      // No room: it says so and goes on pushing
      const ff = w().fitFree; w().fitFree = () => ({ ok: false, why: 'x' });
      try { check(!WB().park() && WB().pushing, 'parked with no room'); } finally { w().fitFree = ff; delete w().fitFree; }
      const f = p().face, Cx = p().x + f.x * CENTER_AHEAD, Cy = p().y + f.y * CENTER_AHEAD, yaw = Math.atan2(f.x, f.y);
      game.toss();
      const back = parkedNear(Cx, Cy, 2);
      check(!WB().pushing && back && Math.hypot(back.x - Cx, back.y - Cy) < 0.03 && angle(back.yaw, yaw) < 0.01, `Q did not park it where it is drawn: ${back && [back.x - Cx, back.y - Cy, back.yaw - yaw]}`);
      check(WB().idAt(back.tile) === id && w().chestAt(...back.tile)[0]?.id === 'piedra' && WB().loadsAt(back.tile)[0]?.[0] === 'log', 'not the same things or id');
      check(!inv().armsFull && !p().pushing && !p().armsBusy, 'the hands are not free');
      w().chestAt(...back.tile)[0] = null; dOf(...back.tile).barrow[`${back.tile}`].l = []; w().setTile(...back.tile, 'air');
      // The heading: facing the four ways, parked as it was (the same yaw as fitFree's, risk 1 of the plan)
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        const q = placeBarrow(tx, ty, a); pushIt(q);
        check(angle(Math.atan2(p().face.x, p().face.y), a) < 0.01, `pushing, the heading is not its own (${a})`);
        WB().park(); const z = parkedNear(q.x, q.y, 2); check(z && angle(z.yaw, a) < 0.01 && Math.hypot(z.x - q.x, z.y - q.y) < 0.03, `parked facing ${a}: ${z && [z.yaw, z.x - q.x, z.y - q.y]}`);
        w().setTile(...z.tile, 'air');
      }
    } finally { letGo(); }
  });
  await test('carretilla límites (wheelbarrow limits): no deep water, fences, rocks or tower stairs, no step down into a hole, no cave, no mounting, boarding, sitting or sleeping; through an open door', async () => {
    await weightOn();
    const up = screenToWorld(0, -1), l = Math.hypot(...up), d = [up[0] / l, up[1] / l], side = [d[1], -d[0]], keysUp = { up: true }, past = P => P.x * d[0] + P.y * d[1];
    const walk = (pushing, scene, steps) => { const P = new Player({ name: 'x', x: 0, y: 0, look: {} }); P.pushing = pushing ? 'wheelbarrow' : null; P.face = { x: d[0], y: d[1] }; for (let i = 0; i < steps; i++) P.update(1 / 60, keysUp, scene); return P; };
    const flat = list => ({ collidersNear: () => list, digNear: () => null });
    const shallow = { waterDepth: (x, y) => (x * d[0] + y * d[1] > 2.5 ? 0.6 : 0), collidersNear: () => [], digNear: () => null };
    // (it stops with its wheel, WHEEL_AHEAD ahead, at the edge: the axle in the water, the tyre on what it bumps)
    const wet = 2.5 - WHEEL_AHEAD + 0.08, bump = 2.5 - WHEEL_AHEAD - BARROW.WHEEL_R + 0.1;
    check(past(walk(true, shallow, 240)) < wet && past(walk(false, shallow, 240)) > 2, `into water of 0.6 m: ${past(walk(true, shallow, 240))}`);
    const ahead = (r, more) => [{ x: d[0] * (2.5 + r), y: d[1] * (2.5 + r), r, ...more }];   // (a big circle whose near edge is 2.5 m ahead)
    check(past(walk(true, flat(ahead(5, { low: true })), 240)) < bump, 'pushed over a fence');
    check(past(walk(true, flat(ahead(5, { top: 0.5 })), 240)) < bump && past(walk(false, flat(ahead(5, { top: 0.5 })), 240)) > 2, 'a rock: pushed onto it (or a walker could not climb it)');
    const hole = { collidersNear: () => [], digNear: () => true, digWalls: () => [], digH: () => null, surfaceAt: (x, y) => (x * d[0] + y * d[1] > 2.5 ? -0.5 : 0), waterDepth: () => 0 };
    check(past(walk(true, hole, 240)) < wet, `down into a hole: ${past(walk(true, hole, 240))}`);
    // A doorway: 0.72 m between its posts lets the box (0.62) through; 0.5 does not
    const posts = gap => [1, -1].map(s => ({ x: d[0] * 3 + side[0] * s * (gap / 2 + 0.1), y: d[1] * 3 + side[1] * s * (gap / 2 + 0.1), r: 0.1 }));
    check(past(walk(true, flat(posts(0.72)), 300)) > 3.6, `not through an open door: ${past(walk(true, flat(posts(0.72)), 300))}`);
    check(past(walk(true, flat(posts(0.5)), 300)) < 2, 'through a gap narrower than it');
    // In the game: no mounting, boarding, sitting, sleeping or caves; goTo parks it; not from a rock
    const [tx, ty] = openGround(); await goTo(game, tx + 0.5, ty + 3.5);
    const o = placeBarrow(tx, ty);
    try {
      p().floor = 0.3; check(WB().cantPush(o) === t('barrow.cant_here'), 'pushed from a rock'); p().floor = 0;
      pushIt(o);
      const C = game.carry;
      check(C.refuse('mount') && C.refuse('boat') && C.refuse('cave') && C.refuse() && C.dropFirst() === t('barrow.drop_first'), 'refuse does not refuse');
      game.ranch.mount({ id: 'x', breed: 'alazan', x: p().x, y: p().y }); check(!p().mount, 'mounted pushing it');
      game.rest.floor('floorSit'); check(!p().pose, 'sat down pushing it');
      await game.goTo(game.world, p().x, p().y, { inside: false, sound: false });
      check(!WB().pushing && parkedNear(p().x, p().y, 4), 'goTo did not park it');
    } finally { letGo(); const z = parkedNear(tx + 0.5, ty + 0.5, 5); if (z) w().setTile(...z.tile, 'air'); }
  });
  await test('carretilla muros (wheelbarrow walls): turning is slow and never puts the box through a wall; parking never lands behind a wall, a closed door or in a doorway', async () => {
    await weightOn();
    const up = screenToWorld(0, -1), l = Math.hypot(...up), d = [up[0] / l, up[1] / l], a = Math.atan2(d[0], d[1]);
    // A thin wall 1.2 m behind: turning round (down) stops where the box touches it
    const box = obb(-d[0] * 1.2, -d[1] * 1.2, 3, 0.05, a), wall = [{ ...bounds(box), obb: box, wall: true }], scene = { collidersNear: () => wall, digNear: () => null };
    const P = new Player({ name: 'x', x: 0, y: 0, look: {} }); P.pushing = 'wheelbarrow'; P.face = { x: d[0], y: d[1] }; P.speedMul = 1e-4;
    let worst = 0;
    const turned = [];
    for (let i = 0; i < 120; i++) { P.update(1 / 60, { down: true }, scene); worst = Math.max(worst, barrowPen(scene, wall, P.x, P.y, P.face.x, P.face.y)); turned.push(Math.atan2(P.face.x, P.face.y)); }
    check(worst < 0.01, `the box went into the wall: ${worst.toFixed(3)}`);
    check(P.face.x * d[0] + P.face.y * d[1] > -0.9, 'turned round through the wall');
    const steps = turned.map((v, i) => (i ? angle(v, turned[i - 1]) : 0));
    check(Math.max(...steps) <= BARROW.TURN / 60 + 1e-6, `turned too fast: ${Math.max(...steps)}`);
    // In the game: behind a wall from the player (reached), or by a door, it is not parked there
    const [tx, ty] = openGround(); await goTo(game, tx + 0.5, ty + 3.5);
    const o = placeBarrow(tx, ty);
    try {
      pushIt(o);
      const C = game.carry, R = C.reached, DN = w().doorNear;
      C.reached = () => false; try { check(!WB().park() && WB().pushing, 'parked behind a wall'); } finally { C.reached = R; delete C.reached; }
      w().doorNear = (x, y) => [Math.floor(x), Math.floor(y)]; try { check(!WB().park() && WB().pushing, 'parked in a doorway'); } finally { w().doorNear = DN; delete w().doorNear; }
      check(WB().park(), 'not parked in the open');
    } finally { letGo(); const z = parkedNear(tx + 0.5, ty + 0.5, 5); if (z) w().setTile(...z.tile, 'air'); }
  });
  await test('carretilla atasco (wheelbarrow stuck): a door closed on it is refused; a wall built on it still lets you back out; Q parks it further away after 2 s, never where a normal park could not go', async () => {
    await weightOn();
    const up = screenToWorld(0, -1), l = Math.hypot(...up), d = [up[0] / l, up[1] / l], past = P => P.x * d[0] + P.y * d[1];
    // Something new right on the wheel: forward, no; back, yes
    const rock = [{ x: d[0] * 1.75, y: d[1] * 1.75, r: 0.3 }], scene = { collidersNear: () => rock, digNear: () => null };
    const go = keys => { const P = new Player({ name: 'x', x: 0, y: 0, look: {} }); P.pushing = 'wheelbarrow'; P.face = { x: d[0], y: d[1] }; for (let i = 0; i < 40; i++) P.update(1 / 60, keys, scene); return P; };
    check(past(go({ up: true })) < 0.02, `went further into it: ${past(go({ up: true }))}`);
    check(past(go({ down: true })) < -0.05, `could not back out: ${past(go({ down: true }))}`);
    const [tx, ty] = openGround(); await goTo(game, tx + 0.5, ty + 3.5);
    const o = placeBarrow(tx, ty), L = game.live, was = { joined: L.joined, role: L.role };
    try {
      pushIt(o);
      const f = p().face, c = [Math.floor(p().x + f.x * CENTER_AHEAD), Math.floor(p().y + f.y * CENTER_AHEAD)];
      check(WB().onDoor(c) && game.doorAction(c) === null, 'a door closes on it');
      check(!WB().onDoor([c[0] + 6, c[1] + 6]), 'a door far from it is held');
      // (another player's, pushing it: neither)
      WB().park();
      L.joined = true; L.role = 'host';
      L.receive('c9', { t: 'hi', id: 'id-c9', name: 'c9', playing: true, look: LOOK, v: GAME_VERSION });
      L.receive('c9', { t: 'st', sc: 'world', x: tx + 0.5, y: ty + 0.5, yaw: 0, ca: 'wheelbarrow' });
      const e = L.peers.get('c9').entity; e.x = tx + 0.5; e.y = ty + 0.5;
      check(e.pushing === 'wheelbarrow' && WB().onDoor([Math.floor(e.x), Math.floor(e.y + CENTER_AHEAD)]), 'a door closes on another\'s');
      L.peers.delete('c9'); L.joined = was.joined; L.role = was.role;
      // Stuck 2 s: Q parks it further away (no room right there), reached and with the village's rule; with no room at all,
      // not (as /setblock it would go where a normal park could not: a wall built on it on purpose)
      const z = parkedNear(tx + 0.5, ty + 0.5, 4); pushIt(z);
      const ff = w().fitFree, P0 = { x: p().x, y: p().y };
      w().fitFree = function (id, x, y, ...a) { return Math.hypot(x - P0.x, y - P0.y) < 2.6 ? { ok: false, why: 'x' } : ff.call(this, id, x, y, ...a); };
      try {
        const f = p().face, fs = WB().forcedSpot({ x: p().x + f.x * CENTER_AHEAD, y: p().y + f.y * CENTER_AHEAD }, Math.atan2(f.x, f.y), { player: p(), avoid: [p().x, p().y], strict: true });
        WB().rec.stuck = 2.5; game.toss();
        check(!WB().pushing && parkedNear(P0.x, P0.y, 10), `Q did not park it further away: ${WB().pushing} ${game.mode} ${game.busy} ${fs && [fs.ok, fs.cx, fs.cy]} ${[P0.x, P0.y]}`);
      } finally { w().fitFree = ff; delete w().fitFree; }
      pushIt(parkedNear(P0.x, P0.y, 10));
      w().fitFree = () => ({ ok: false, why: 'x' });
      try { WB().rec.stuck = 2.5; game.toss(); check(!!WB().pushing, 'Q parked it with no room at all, as /setblock'); } finally { w().fitFree = ff; delete w().fitFree; }
    } finally { L.peers.delete('c9'); L.joined = was.joined; L.role = was.role; letGo(); for (let i = 0; i < 3; i++) { const z = parkedNear(tx + 0.5, ty + 0.5, 12); if (z) w().setTile(...z.tile, 'air'); } }
  });
  await test('carretilla bultos (wheelbarrow bundles): E on a log while pushing loads it, 3 at most; E with a carcass on the parked one, also on a horse; Take gives it back; carcasses on it rot to bones in its stacks', async () => {
    await weightOn();
    const [tx, ty] = openGround(); await goTo(game, tx + 0.5, ty + 3.5);
    const C = game.carry, wasM = game.mouse;
    let o = placeBarrow(tx, ty);
    try {
      game.mouse = null;
      pushIt(o);
      const px = Math.floor(p().x), py = Math.floor(p().y), [lx, ly] = Math.abs(p().face.x) > Math.abs(p().face.y) ? [px, py + 1] : [px + 1, py];   // (the tile beside yours: within 1.7 m)
      w().place(lx, ly, 'log');
      const a = game.nearest(); check(a?.text === t('barrow.load', { item: noun('item', 'log') }), `E by a log says: ${a?.text}`);
      a.run(); check(!near('log', lx + 0.5, ly + 0.5, 0) && WB().record().l.length === 1 && p().pushing === 'wheelbarrow:log', `not loaded: ${p().pushing}`);
      WB().record().l.push(['log', null], ['log', null]);
      w().place(lx, ly, 'log'); check(game.nearest()?.text === t('barrow.full'), `a fourth: ${game.nearest()?.text}`);
      w().unplace({ tile: [lx, ly], layer: 'placed', placed: 'log' });
      WB().record().l = [];
      WB().park(); o = parkedNear(tx + 0.5, ty + 0.5, 4); check(o, 'not parked');
      // With a carcass in the arms: on top (also riding)
      C.set('carcass_deer', C.today()); check(game.placedAction(o).text === t('barrow.load', { item: noun('item', 'carcass_deer') }), `with a carcass: ${game.placedAction(o).text}`);
      game.placedAction(o).run(); check(!C.held && WB().loadsAt(o.tile)[0]?.[0] === 'carcass_deer', 'the carcass is not on it');
      C.set('log'); p().mount = true;
      try { game.placedAction(o).run(); check(!C.held && WB().loadsAt(o.tile).length === 2, 'riding, not put on it'); } finally { p().mount = false; C.syncArms(); }
      // Take: to the arms; with the arms full, no; creative (or the slots): its parts
      WB().takeLoad(o.tile, 1); check(C.held === 'log' && WB().loadsAt(o.tile).length === 1, 'Take does not give it back');
      WB().takeLoad(o.tile, 0); check(C.held === 'log' && WB().loadsAt(o.tile).length === 1, 'taken with the arms full');
      C.set(null);
      Object.defineProperty(C, 'bigNow', { get: () => false, configurable: true });
      const meat = inv().count('carne_venado');
      try { WB().takeLoad(o.tile, 0); check(!C.held && inv().count('carne_venado') > meat && !WB().loadsAt(o.tile).length, 'creative: not its parts'); } finally { delete C.bigNow; }
      // A carcass on it for 2 days: bones in its stacks
      const k = `${o.tile}`, d = dOf(...o.tile);
      d.barrow[k].l = [['carcass_deer', C.today() - 2]];
      WB().sweep([ckey(...o.tile)]);
      check(!WB().loadsAt(o.tile).length && w().chestAt(...o.tile).some(s => s?.id === 'hueso'), 'it does not rot to bones');
      // Its tile is something else now (/setblock): its big things to the ground
      d.barrow[k].l = [['log', null]]; d.placed[k] = 'cofre';
      WB().sweep([ckey(...o.tile)]);
      check(!d.barrow[k] && near('log', o.x, o.y, 4), 'the big things of a tile that is no longer a wheelbarrow are lost');
      w().setTile(...o.tile, 'air');
    } finally { game.mouse = wasM; letGo(); const lg = near('log', tx + 0.5, ty + 0.5, 5); if (lg) w().unplace(lg); const z = parkedNear(tx + 0.5, ty + 0.5, 5); if (z) w().setTile(...z.tile, 'air'); }
  });
  await test('carretilla guardado (wheelbarrow save): saving while pushing, reopening, dying (also with keepInventory), spectator, teleporting and leaving park it where you were with everything; an older game keeps its fields', async () => {
    await weightOn();
    const [tx, ty] = openGround(); await goTo(game, tx + 0.5, ty + 3.5);
    const o = placeBarrow(tx, ty), id = WB().idAt(o.tile);
    w().chestAt(...o.tile)[0] = { id: 'tablas', n: 7 };
    pushIt(o);
    const snap = game.snapshot(), deltas = JSON.stringify([...w().deltas]);
    check(!JSON.stringify(snap).includes(id) && WB().record()?.x === Math.round(p().x * 100) / 100, 'the save of the player has the wheelbarrow, or the record is not where you are');
    // Quit while pushing it and open the game again: the first step parks it where you went, with its things
    game.end(); game.start(snap, new Map(JSON.parse(deltas))); game.onSave = null;
    await readyGround(game, 8000); await frames(2);
    const back = parkedNear(snap.player.x, snap.player.y, 4);
    check(!WB().pushing && back && WB().idAt(back.tile) === id && w().chestAt(...back.tile)[0]?.id === 'tablas', `not parked again with its things: ${back && WB().idAt(back.tile)}`);
    check(![...w().deltas.values()].some(dd => dd?.pushed?.[id]), 'its record stays');
    // Dying (keepInventory), the spectator, a teleport
    const keep = game.rules.keepInventory;
    try {
      game.rules.keepInventory = true;
      pushIt(back); const at = [p().x, p().y];
      await game.combat.die(null); game.busy = false;
      check(!WB().pushing && parkedNear(at[0], at[1], 4), 'dying with keepInventory did not park it');
    } finally { game.rules.keepInventory = keep; game.busy = false; }
    await goTo(game, tx + 0.5, ty + 3.5);
    let z = parkedNear(tx + 0.5, ty + 0.5, 6); pushIt(z);
    game.setGamemode('spectator'); check(!WB().pushing && parkedNear(p().x, p().y, 4), 'the spectator pushes it'); game.setGamemode('survival');
    z = parkedNear(p().x, p().y, 4); pushIt(z); const at = [p().x, p().y];
    game.teleport(at[0] + 10, at[1]); check(!WB().pushing && parkedNear(at[0], at[1], 4), 'a teleport took it along');
    await goTo(game, at[0], at[1]);
    z = parkedNear(at[0], at[1], 4);
    // An older game: the wheelbarrow is a «?» box, and its fields are kept as they are
    const d = dOf(...z.tile), k = `${z.tile}`;
    d.pushed ||= {}; d.pushed.zz = { by: 'id-old', x: z.x, y: z.y, c: [], l: [], t: 0 }; d.claim = { q1: { by: 'id-old', k: 'take', at: 0 } }; d.boatLoad = { b1: ['log', 'id-old', null, z.x, z.y, 'n1'] };
    const was = JSON.stringify({ c: d.chest[k], b: d.barrow, p: d.pushed, q: d.claim, l: d.boatLoad }), item = ITEMS.wheelbarrow;
    try {
      delete ITEMS.wheelbarrow; w().touch(...z.tile.map(v => Math.floor(v / CHUNK)));
      const u = w().contentFor(...z.tile.map(v => Math.floor(v / CHUNK))).objects.find(q => q.tile && String(q.tile) === k);
      check(u?.unknown === 'wheelbarrow', `an older game does not see a «?»: ${u?.unknown}`);
    } finally { ITEMS.wheelbarrow = item; w().touch(...z.tile.map(v => Math.floor(v / CHUNK))); }
    check(JSON.stringify({ c: d.chest[k], b: d.barrow, p: d.pushed, q: d.claim, l: d.boatLoad }) === was, 'its fields changed');
    delete d.pushed.zz; delete d.claim; delete d.boatLoad;
    w().setTile(...z.tile, 'air'); check(!d.barrow[k] && !d.chest[k], '/setblock air leaves its id or chest');
  });
  await test('carretilla forzada (wheelbarrow forced park): with no room around, it skips the village rule and at last goes in like /setblock; nothing is lost', async () => {
    await weightOn();
    const [tx, ty] = openGround(); await goTo(game, tx + 0.5, ty + 3.5);
    const W = w(), drops = game.gather.drops.length, rec = (rid, x, y) => { const d = dOf(Math.floor(x), Math.floor(y)); (d.pushed ||= {})[rid] = { by: 'id-gone', x, y, c: [{ id: 'piedra', n: 4 }, ...Array(11).fill(null)], l: [['log', null]], t: 0 }; return ckey(Math.floor(x), Math.floor(y)); };
    const ff = W.fitFree;
    try {
      // (only fits skipping the village's rule)
      W.fitFree = function (...a) { return this.buildAnywhere ? ff.apply(this, a) : { ok: false, why: 'plaza' }; };
      const k1 = rec('aaaa1111', tx + 0.5, ty + 0.5);
      check(WB().parkRecord('aaaa1111', k1) && !W.buildAnywhere, 'not parked skipping the village rule');
      let z = parkedNear(tx + 0.5, ty + 0.5, 9); check(z && WB().idAt(z.tile) === 'aaaa1111' && W.chestAt(...z.tile)[0]?.id === 'piedra' && WB().loadsAt(z.tile)[0]?.[0] === 'log', 'not parked with its things');
      W.setTile(...z.tile, 'air');
      // (no room anywhere: as /setblock, with everything in it)
      W.fitFree = () => ({ ok: false, why: 'full' });
      const k2 = rec('bbbb2222', tx + 0.5, ty + 0.5);
      check(WB().parkRecord('bbbb2222', k2), 'the last resort failed');
      z = parkedNear(tx + 0.5, ty + 0.5, 17); check(z && WB().idAt(z.tile) === 'bbbb2222' && W.chestAt(...z.tile)[0]?.id === 'piedra' && WB().loadsAt(z.tile)[0]?.[0] === 'log', 'as /setblock without its things');
      check(game.gather.drops.length === drops, 'something fell as drops');
      W.setTile(...z.tile, 'air');
    } finally { W.fitFree = ff; delete W.fitFree; W.buildAnywhere = false; }
  });
  await test('carretilla casa (wheelbarrow house): enlarging the house moves it with its stacks and bundles; with no room, nothing is lost', async () => {
    await weightOn();
    const H = game.houseRect(), W = w();
    let wt = null;
    for (let ty = H.y0 + 2; ty < H.y1 - 1 && !wt; ty++) if (W.pieceAt(H.x0, ty)?.kind === 'wall' && W.ownAt('placed', H.x0, ty) && !W.ownAt('placed', H.x0, ty).startsWith('ventana')) wt = [H.x0, ty];
    check(wt, 'no wall of your house to put it on');
    const wall = W.ownAt('placed', ...wt), kt = `${wt}`, moved = () => { for (let y = H.y0; y < H.y1; y++) for (let x = H.x0; x < H.x1; x++) if (WB().isAt([x, y]) && WB().idAt([x, y]) === 'hhhh0001') return [x, y]; return null; };
    try {
      for (const stacks of [false, true]) {
        W.unplace({ tile: wt, layer: 'placed', placed: parsePlaced(wall)[0] }); W.place(...wt, 'wheelbarrow');
        const d = dOf(...wt); d.barrow[kt] = { id: 'hhhh0001', l: [['log', null]] }; if (stacks) d.chest[kt][0] = { id: 'piedra', n: 2 };
        game.layHouse(game.houseSize, false);
        const m = moved(); check(m && WB().loadsAt(m)[0]?.[0] === 'log' && (!stacks || W.chestAt(...m)[0]?.id === 'piedra'), `not moved with ${stacks ? 'its stacks and ' : ''}its big things`);
        check(W.ownAt('placed', ...wt) === wall, 'the wall is not back');
        W.setTile(...m, 'air');
      }
      // No room in the house: the stacks to the backpack and the big things to the ground nearby
      W.unplace({ tile: wt, layer: 'placed', placed: parsePlaced(wall)[0] }); W.place(...wt, 'wheelbarrow');
      const d = dOf(...wt); d.barrow[kt] = { id: 'hhhh0001', l: [['log', null]] }; d.chest[kt][0] = { id: 'piedra', n: 2 };
      const stones = inv().count('piedra'), ft = game.freeTile; game.freeTile = () => null;
      try { game.layHouse(game.houseSize, false); } finally { game.freeTile = ft; delete game.freeTile; }
      const lg = near('log', (H.x0 + H.x1) / 2, H.y1, 10);
      check(inv().count('piedra') === stones + 2 && lg, 'with no room something is lost');
      inv().remove('piedra', 2); if (lg) W.unplace(lg);
    } finally { if (W.ownAt('placed', ...wt) !== wall) { W.setTile(...wt, 'air'); W.place(...wt, parsePlaced(wall)[0], parsePlaced(wall)[1]); } const m = moved(); if (m) W.setTile(...m, 'air'); }
  });
  await test('carretilla red (wheelbarrow net): st.ca carries its model key and a remote draws it; the host lets the first claim win; parks on request; releases a gone or idle player\'s; claims resolve in order', async () => {
    await weightOn();
    const [tx, ty] = openGround(); await goTo(game, tx + 0.5, ty + 3.5);
    const L = game.live, was = { joined: L.joined, role: L.role }, W = w();
    try {
      // What the others see
      L.receive('c1', { t: 'hi', id: 'id-c1', name: 'c1', playing: true, look: LOOK, v: GAME_VERSION, wb: 1 });
      L.receive('c1', { t: 'st', sc: 'world', x: tx + 0.5, y: ty + 3, yaw: 0, ca: 'wheelbarrow:log:f' });
      const e = L.peers.get('c1').entity;
      check(L.peers.get('c1').barrows && e.pushing === 'wheelbarrow:log:f' && e.armsBusy === 'push' && !e.carrying, `a remote pushing: ${e.pushing} ${e.armsBusy}`);
      L.receive('c1', { t: 'st', sc: 'world', x: tx + 0.5, y: ty + 3, yaw: 0, ca: 'wheelbarrow:zzz,log' }); check(e.pushing === 'wheelbarrow', `garbage: ${e.pushing}`);
      L.receive('c1', { t: 'st', sc: 'world', x: tx + 0.5, y: ty + 3, yaw: 0, m: 1, ca: 'log' }); check(e.carrying === 'log' && !e.armsBusy && !e.pushing, 'riding with a log: the arms are busy');
      // The host arbitrates: the first take wins (with its stacks as they are here), the second goes back
      const o = placeBarrow(tx, ty), kp = `${o.tile}`, k = ckey(...o.tile), d = dOf(...o.tile), id = WB().idAt(o.tile);
      W.chestAt(...o.tile)[0] = { id: 'piedra', n: 4 };
      const take = by => [['placed', kp], ['chest', kp], ['barrow', kp], ['pos', 'placed:' + kp], ['pushed', id, { by, x: tx + 0.5, y: ty - 0.5, c: [], l: [['log', null]], t: 0 }]];
      const A = { id: 'id-c1', at: [tx + 0.5, ty - 0.5] }, Bp = { id: 'id-c2', at: [tx + 0.5, ty - 0.5] };
      const r1 = WB().arbitrate(A, k, take('id-c1')), r2 = WB().arbitrate(Bp, k, take('id-c2'));
      const won = r1.ok.find(([f]) => f === 'pushed')?.[2];
      check(won && won.by === 'id-c1' && won.c[0]?.id === 'piedra' && !won.l.length && !r1.back.length, `the first take: ${JSON.stringify(r1)}`);
      applyOps(d, [...r1.rest, ...r1.ok]);
      const r2b = WB().arbitrate(Bp, k, take('id-c2'));
      check(!r2b.ok.length && r2b.back.some(([f, c, v]) => f === 'pushed' && c === id && v?.by === 'id-c1'), `the second take: ${JSON.stringify(r2b.back)}`);
      check(r2.ok.length === 1, '(the same moment, before the first is applied: each would win, as the plan says the order decides)');
      // A late change of its stacks goes into its record, not to an orphan chest
      const late = WB().arbitrate(Bp, k, [['chest', kp, [{ id: 'tablas', n: 2 }, ...Array(11).fill(null)]]]);
      WB().afterArbitrate(k, late, Bp);
      check(!late.rest.length && d.pushed[id].c[0]?.id === 'tablas' && !d.chest[kp], `a late chest: ${JSON.stringify(late)}`);
      // Its own record: x, y only (l stays the host's); a park near where it is; another's, a delete or the whole field: back
      const own = WB().arbitrate(A, k, [['pushed', id, { ...d.pushed[id], l: [['log', null], ['log', null]], x: tx + 40, park: [tx + 40, ty, 0] }]]);
      const nv = own.ok[0]?.[2];
      check(nv && !nv.l.length && Math.hypot(nv.x - A.at[0], nv.y - A.at[1]) < 0.01 && Math.hypot(nv.park[0] - A.at[0], nv.park[1] - A.at[1]) < 0.01 && own.park[0] === id, `its own: ${JSON.stringify(own)}`);
      check(WB().arbitrate(Bp, k, [['pushed', id, { ...d.pushed[id], x: 0 }]]).back.length === 1, 'another\'s record changed');
      check(WB().arbitrate(A, k, [['pushed', id]]).back.length === 1 && WB().arbitrate(A, k, [['pushed', null, {}]]).back.length === 1, 'a guest deleted a record');
      // A park asked for: parked by whoever decides
      applyOps(d, own.ok); WB().afterArbitrate(k, own, A);
      const pk = parkedNear(A.at[0], A.at[1], 5);
      check(!d.pushed[id] && pk && WB().idAt(pk.tile) === id && W.chestAt(...pk.tile)[0]?.id === 'tablas', 'the park asked for is not done, or not with its things');
      W.setTile(...pk.tile, 'air');
      // Only pushed: no chunk made again
      const t0 = W.touches; L.applyChunk(k, [['pushed', 'xxxx0000', { by: 'id-c1', x: tx, y: ty, c: [], l: [], t: 0 }]]);
      check(W.touches === t0, 'a record alone made the chunks again');
      delete d.pushed.xxxx0000;
      // A player gone (bye, cut off, out to the menu): parked where they were; one present that does not push: after GRACE
      L.joined = true; L.role = 'host';
      const rec = (rid, by) => { d.pushed[rid] = { by, x: tx + 0.5, y: ty - 0.5, c: [], l: [], t: 0 }; };
      for (const how of ['bye', 'drop', 'menu']) {
        L.receive('c5', { t: 'hi', id: 'id-c5', name: 'c5', playing: true, look: LOOK, v: GAME_VERSION, wb: 1 });
        L.receive('c5', { t: 'st', sc: 'world', x: tx + 0.5, y: ty - 0.5, yaw: 0, ca: 'wheelbarrow' });
        rec('gone' + how, 'id-c5');
        if (how === 'bye') L.receive('c5', { t: 'bye' }); else if (how === 'drop') L.drop('c5', true); else L.receive('c5', { t: 'hi', id: 'id-c5', name: 'c5', playing: false, look: LOOK, v: GAME_VERSION, wb: 1 });
        check(!d.pushed['gone' + how], `not parked after ${how}`);
        const z = parkedNear(tx + 0.5, ty - 0.5, 6); if (z) W.setTile(...z.tile, 'air');
        L.peers.delete('c5');
      }
      L.receive('c6', { t: 'hi', id: 'id-c6', name: 'c6', playing: true, look: LOOK, v: GAME_VERSION, wb: 1 });
      L.receive('c6', { t: 'st', sc: 'world', x: tx + 0.5, y: ty - 0.5, yaw: 0 });
      rec('idle0001', 'id-c6');
      WB().sweep([k]); check(d.pushed.idle0001, 'parked at once');
      WB().idle.set('idle0001', game.time - 9); WB().sweep([k]); check(!d.pushed.idle0001, 'a present player who does not push keeps it hidden');
      let z = parkedNear(tx + 0.5, ty - 0.5, 6); if (z) W.setTile(...z.tile, 'air');
      L.receive('c6', { t: 'st', sc: 'world', x: tx + 0.5, y: ty - 0.5, yaw: 0, ca: 'wheelbarrow' });
      rec('idle0002', 'id-c6'); WB().idle.set('idle0002', game.time - 9); WB().sweep([k]); check(d.pushed.idle0002, 'parked while its pusher pushes it');
      L.peers.delete('c6'); WB().peerGone('id-c6', [tx + 0.5, ty - 0.5]); z = parkedNear(tx + 0.5, ty - 0.5, 6); if (z) W.setTile(...z.tile, 'air');
      // Requests, in order: two loads of one log, two takes of one bundle, a put on a full one
      const [lx, ly] = [tx + 2, ty + 2]; W.place(lx, ly, 'log');
      rec('load0001', 'id-c7'); rec('load0002', 'id-c8');
      d.claim = { n1: { by: 'id-c7', k: 'load', rec: 'load0001', tile: [lx, ly], id: 'log', at: W.clock || 0 }, n2: { by: 'id-c8', k: 'load', rec: 'load0002', tile: [lx, ly], id: 'log', at: W.clock || 0 } };
      WB().resolve(k, 'n1'); WB().resolve(k, 'n2');
      check(d.claim.n1.ok === true && d.claim.n2.ok === false && d.pushed.load0001.l.length === 1 && !d.pushed.load0002.l.length, `two loads: ${JSON.stringify(d.claim)}`);
      delete d.pushed.load0001; delete d.pushed.load0002;
      const q = placeBarrow(tx, ty, 0), qk = ckey(...q.tile), dq = dOf(...q.tile);
      dq.barrow[`${q.tile}`].l = [['log', null]];
      dq.claim = { t1: { by: 'id-c7', k: 'take', tile: q.tile, i: 0, id: 'log', at: W.clock || 0 }, t2: { by: 'id-c8', k: 'take', tile: q.tile, i: 0, id: 'log', at: W.clock || 0 } };
      WB().resolve(qk, 't1'); WB().resolve(qk, 't2');
      check(dq.claim.t1.ok === true && dq.claim.t2.ok === false && !WB().loadsAt(q.tile).length, `two takes: ${JSON.stringify(dq.claim)}`);
      dq.barrow[`${q.tile}`].l = [['log', null], ['log', null], ['log', null]];
      dq.claim.p1 = { by: 'id-c7', k: 'put', tile: q.tile, id: 'log', day: null, at: W.clock || 0 }; WB().resolve(qk, 'p1');
      check(dq.claim.p1.ok === false && WB().loadsAt(q.tile).length === 3, 'put on a full one');
      delete dq.claim; delete d.claim; W.setTile(...q.tile, 'air');
      // A guest's: the host's word confirms it; another's record lets go and says so
      L.role = 'guest';
      WB().rec = { id: 'gggg0001', k, key: 'wheelbarrow', confirmed: false, since: game.time, sentAt: game.time, sx: 0, sy: 0, stuck: 0 };
      WB().onHostOps(k, [['pushed', 'gggg0001', { by: meId(), x: 0, y: 0, c: [], l: [['log', null]] }]]);
      check(WB().rec?.confirmed && WB().pushing === 'wheelbarrow:log', 'the host\'s word does not confirm it');
      const said = []; const toast = hud.toast; hud.toast = m => said.push(m);
      try { WB().onHostOps(k, [['pushed', 'gggg0001', { by: 'id-c1', x: 0, y: 0, c: [], l: [] }]]); } finally { hud.toast = toast; }
      check(!WB().rec && !p().pushing && said[0] === t('barrow.taken', { name: 'c1' }), `another's: ${JSON.stringify(said)}`);
    } finally { L.joined = was.joined; L.role = was.role; for (const c of ['c1', 'c5', 'c6']) L.peers.delete(c); WB().rec = null; game.carry.syncArms(); for (let i = 0; i < 4; i++) { const z = parkedNear(tx + 0.5, ty + 0.5, 8); if (z) W.setTile(...z.tile, 'air'); } const lg = near('log', tx + 2.5, ty + 2.5, 1); if (lg) W.unplace(lg); }
  });
  await test('carretilla petición (wheelbarrow request): a guest\'s put leaves the arms at once and comes back only on a no or unsent; the host\'s own take catches late chest changes, not a new chest\'s; a boat\'s load with no land gives its parts, no drops', async () => {
    await weightOn();
    const [tx, ty] = openGround(); await goTo(game, tx + 0.5, ty + 3.5);
    const L = game.live, was = { joined: L.joined, role: L.role }, W = w(), C = game.carry, first = () => [...WB().pending.keys()][0];
    try {
      const o = placeBarrow(tx, ty), kp = `${o.tile}`, k = ckey(...o.tile), d = dOf(...o.tile);
      L.joined = true; L.role = 'guest'; L.flush = () => {}; WB().hostOld = () => false;
      // Put on it: out of the arms now (nothing to drop, to die with or to save twice)
      C.set('log'); WB().loadParked(o); const n1 = first();
      check(!C.held && !game.inv.armsItem && d.claim?.[n1]?.k === 'put' && !game.inv.toSave().keep?.some(q => q.arms) && C.drop() === false, 'the put did not leave the arms');
      WB().onHostOps(k, [['claim', n1, { ...d.claim[n1], ok: false }]]);
      check(C.held === 'log' && !WB().pending.size, 'a no does not give it back');
      // Answered in the world (an answer gone by unseen, or this game's own sweep once it decides): it stays on it
      WB().loadParked(o); const n2 = first(); d.claim[n2] = { ...d.claim[n2], ok: true };
      game.time += 1; WB().update(0);
      check(!C.held && !WB().pending.size, 'an answer in the world is not taken');
      // Gone from the world unanswered (it never reached whoever decides): back; unanswered and there: it waits
      C.set('log'); WB().loadParked(o); const n3 = first(); delete d.claim[n3]; game.time += 9; WB().update(0);
      check(C.held === 'log' && !WB().pending.size, 'a request that never reached the host is lost');
      WB().loadParked(o); game.time += 30; WB().update(0);
      check(!C.held && WB().pending.size === 1, 'a timer gave it back');
      WB().pending.clear(); delete d.claim;
      // The host's own take: a guest's late change of its stacks goes into its record; on a chest placed there since, not
      L.role = 'host'; pushIt(o);
      check(WB().recent.get(kp)?.id === WB().rec?.id, 'the host\'s own take does not catch late changes');
      const peer = { id: 'id-c2', at: [p().x, p().y] }, stacks = [{ id: 'tablas', n: 2 }, ...Array(11).fill(null)];
      const late = WB().arbitrate(peer, k, [['chest', kp, stacks]]);
      check(late.late.length === 1 && !late.rest.length, `a late change after the host's take: ${JSON.stringify(late)}`);
      W.place(...o.tile, 'cofre');
      const own = WB().arbitrate(peer, k, [['chest', kp, stacks]]);
      check(!own.late.length && own.rest.length === 1, 'the change of a chest placed there since went into the record');
      W.unplace({ tile: o.tile, layer: 'placed', placed: 'cofre' });
      WB().park(true);
      // A boat's load put on the shore with no land near: its parts to whoever asked, never drops at sea
      const bid = W.moorBoat(p().x, p().y, 0, 'mmmm0001'), bx = Math.floor(p().x), by = Math.floor(p().y), db = dOf(bx, by), drops = game.gather.drops.length;
      db.boatLoad = { [bid]: ['log', 'id-c7', null, p().x, p().y, 'mmmm0001'] };
      db.claim = { s1: { by: 'id-c8', k: 'boat', boat: bid, n: 'mmmm0001', to: 'shore', at: W.clock || 0 } };
      const cp = W.canPlace; W.canPlace = () => false;
      try { WB().resolve(ckey(bx, by), 's1'); } finally { W.canPlace = cp; delete W.canPlace; }
      check(db.claim.s1.ok === true && db.claim.s1.parts && game.gather.drops.length === drops && !db.boatLoad[bid], `no land: ${JSON.stringify(db.claim.s1)}`);
      delete db.claim;
    } finally {
      L.joined = was.joined; L.role = was.role; delete L.flush; delete WB().hostOld; WB().pending.clear(); letGo();
      for (const b of W.boatsNear(tx + 0.5, ty + 3.5, 8)) W.unmoorBoat(b);
      for (let i = 0; i < 3; i++) { const z = parkedNear(tx + 0.5, ty + 0.5, 10); if (z) W.setTile(...z.tile, 'air'); }
      const cf = near('cofre', tx + 0.5, ty + 0.5, 2); if (cf) W.unplace(cf);
    }
  });
  await test('carretilla invitado (wheelbarrow guest start): joining as a guest with an old record of yours does not park it locally; the host does', async () => {
    await weightOn();
    const [tx, ty] = openGround(); await goTo(game, tx + 0.5, ty + 3.5);
    const L = game.live, was = { joined: L.joined, role: L.role }, d = dOf(tx, ty), k = ckey(tx, ty);
    (d.pushed ||= {}).mine0001 = { by: meId(), x: tx + 0.5, y: ty + 0.5, c: [], l: [], t: 0 };
    try {
      L.joined = true; L.role = 'guest'; WB().started = false; WB().update(1 / 60);
      check(d.pushed.mine0001, 'a guest parked it locally');
      L.joined = was.joined; L.role = was.role; WB().started = false; WB().update(1 / 60);
      check(!d.pushed.mine0001 && parkedNear(tx + 0.5, ty + 0.5, 4), 'whoever decides did not park it');
    } finally { L.joined = was.joined; L.role = was.role; delete d.pushed.mine0001; const z = parkedNear(tx + 0.5, ty + 0.5, 6); if (z) w().setTile(...z.tile, 'air'); }
    void k;
  });
  await test('carretilla servidor (wheelbarrow server): the headless world with the slot inventory parks a gone player\'s record', async () => {
    await weightOn();
    const [tx, ty] = openGround(); await goTo(game, tx + 0.5, ty + 3.5);
    const srv = new Barrow({ world: w(), scene: w(), player: null, carry: game.carry, gather: game.gather, live: { joined: true, role: 'host', peers: new Map(), others: [] }, time: game.time, inv: new Inventory() });
    const d = dOf(tx, ty), k = ckey(tx, ty);
    (d.pushed ||= {}).srv00001 = { by: 'id-far', x: tx + 0.5, y: ty + 0.5, c: [], l: [], t: 0 };
    try {
      srv.peerGone('id-far', [tx + 0.5, ty + 0.5]); check(!d.pushed.srv00001 && parkedNear(tx + 0.5, ty + 0.5, 4), 'the server did not park it');
      const z = parkedNear(tx + 0.5, ty + 0.5, 4); w().place(tx + 2, ty + 2, 'log');
      (d.pushed ||= {}).srv00002 = { by: 'id-far', x: tx + 0.5, y: ty + 0.5, c: [], l: [], t: 0 };
      d.claim = { s1: { by: 'id-far', k: 'load', rec: 'srv00002', tile: [tx + 2, ty + 2], id: 'log', at: w().clock || 0 } };
      srv.resolve(k, 's1'); check(d.claim.s1.ok === true && d.pushed.srv00002.l.length === 1, 'the server does not resolve');
      w().setTile(...z.tile, 'air');
    } finally { delete d.pushed.srv00001; delete d.pushed.srv00002; delete d.claim; const z = parkedNear(tx + 0.5, ty + 0.5, 6); if (z) w().setTile(...z.tile, 'air'); }
  });
  await test('carretilla casillas (wheelbarrow slots): with ?inventario=casillas the hands are busy and it is slowed; carretilla creativo: full speed and running', async () => {
    const S = new Inventory(); S.add('hacha_hierro', 1);
    const P = { face: { x: 1, y: 0 } }, bw = { pushing: 'wheelbarrow' };
    const C = new Carry({ inv: S, gamemode: 'survival', player: P, barrow: bw, gather: { float() {} } });
    C.syncArms();
    check(!S.held && S.armsFull && P.armsBusy === 'push' && P.pushing === 'wheelbarrow', 'with the slots the hands are not busy');
    check(Math.abs(C.speedMul() - BARROW.SLOW) < 1e-6 && C.noRun(), `with the slots: ${C.speedMul()}`);
    bw.pushing = null; C.syncArms(); check(S.held?.id === 'hacha_hierro' && !S.armsFull && !P.armsBusy, 'parked, the axe is not back');
    bw.pushing = 'wheelbarrow'; const K = new Carry({ inv: S, gamemode: 'creative', player: P, barrow: bw, gather: { float() {} } });
    check(K.speedMul() === 1 && !K.noRun(), `creative: ${K.speedMul()} ${K.noRun()}`);
  });
  await test('caballo con bulto (horse bundle): mount with a log, not slowed, the hands free, the log rides on the horse; off, back in the arms; Q drops it beside the horse; not off in deep water; pushing refuses mounting', async () => {
    await weightOn();
    const [tx, ty] = openGround(); await goTo(game, tx + 0.5, ty + 0.5);
    const C = game.carry, R = game.ranch, horse = () => ({ id: 'hx', breed: 'alazan', x: p().x, y: p().y });
    try {
      selectTool(game, 'hacha');
      C.set('log');
      R.mount(horse()); check(p().mount && C.held === 'log', 'not mounted with a log');
      check(C.speedMul() === 1 && !C.noRun() && inv().held?.id?.startsWith('hacha') && !p().armsBusy && p().carrying === 'log' && C.state() === 'log' && C.viewKey() === null, `riding: ${C.speedMul()} ${inv().held?.id} ${p().armsBusy}`);
      check(C.hint()?.text === t('carry.tip_ride', { item: noun('item', 'log') }), `the hint: ${C.hint()?.text}`);
      const wd = w().waterDepth; w().waterDepth = () => 1.5;
      try { R.dismount(); check(p().mount && C.held === 'log', 'got off into deep water with it'); } finally { w().waterDepth = wd; delete w().waterDepth; }
      R.dismount(); check(!p().mount && C.held === 'log' && p().armsBusy === 'shoulder' && !inv().held, 'off, not back in the arms');
      R.mount(horse()); p().face = { x: 1, y: 0 };
      check(C.drop() && !C.held && near('log', p().x, p().y, 2), 'Q riding did not put it beside the horse');
      const lg = near('log', p().x, p().y, 2); check(Math.floor(lg.x) !== Math.floor(p().x) || Math.floor(lg.y) !== Math.floor(p().y), 'under the horse'); w().unplace(lg);
      R.dismount();
      // Pushing the wheelbarrow, no
      const o = placeBarrow(tx, ty + 2); pushIt(o);   // (inside openGround's free square: its wheel clear of what grows past it)
      R.mount(horse()); check(!p().mount, 'mounted pushing the wheelbarrow');
    } finally { if (p().mount) R.dismount(); letGo(); const z = parkedNear(tx + 0.5, ty + 2.5, 5); if (z) w().setTile(...z.tile, 'air'); }
  });
  await test('barca con bulto (boat bundle): board with a log, off with it; diving leaves it in the moored boat; the owner gets it back, the partner puts it on the shore, others cannot board; dying in the boat moors it', async () => {
    await weightOn();
    const [tx, ty] = openGround(); await goTo(game, tx + 0.5, ty + 0.5);
    const C = game.carry, Cr = game.crew, W = w(), boat = () => W.boatsNear(p().x, p().y, 3)[0], F = game.family, kids = F.v.kids;
    const reset = () => { for (const b of W.boatsNear(tx + 0.5, ty + 0.5, 6)) W.unmoorBoat(b); };
    try {
      W.moorBoat(p().x, p().y, 0); C.set('log');
      Cr.embark(boat()); check(p().boat && C.held === 'log' && !p().armsBusy && C.viewKey() === 'bow:log', 'not boarded with a log');
      Cr.disembark([p().x, p().y + 1]); check(!p().boat && C.held === 'log' && p().armsBusy === 'shoulder', 'off, not back in the arms');
      // Diving: it stays in the moored boat, with the same mark in both
      Cr.embark(boat()); Cr.dive(); const b = boat(), d = dOf(Math.floor(b.x), Math.floor(b.y));
      check(!C.held && d.boatLoad?.[b.id]?.[0] === 'log' && d.boatLoad[b.id][5] === d.boats[b.id][3] && b.load === 'log' && b.key.endsWith(':log'), `diving: ${JSON.stringify(d.boatLoad)} ${b.key}`);
      // Its owner: back to the arms
      Object.assign(p(), { x: b.x, y: b.y + 1, swim: false });
      Cr.embark(b); check(p().boat && C.held === 'log' && !d.boatLoad[b.id], 'the owner does not get it back');
      Cr.dive();
      // Someone else's: no boarding nor taking apart; the partner's: on the shore, for its owner
      const b2 = boat(); dOf(Math.floor(b2.x), Math.floor(b2.y)).boatLoad[b2.id][1] = 'id-other';
      Cr.embark(b2); check(!p().boat && boat()?.id === b2.id, 'boarded someone else\'s');
      Cr.dismantle(b2); check(boat()?.id === b2.id, 'took apart someone else\'s');
      F.v.kids = [...kids, { id: 'kid-x', parents: [meId(), 'id-other'] }];
      try { check(game.social.isPartnerId('id-other'), 'the partner by their child is not known'); Cr.embark(b2); } finally { F.v.kids = kids; }
      const sh = near('log', b2.x, b2.y, 8);
      check(p().boat && !C.held && sh && C.picks(sh.tile, false)?.[`${sh.tile}`]?.[0] === 'id-other', 'the partner\'s boarding does not leave it on the shore for its owner');
      W.unplace(sh); Cr.disembark([p().x, p().y + 1]);
      // Taking it apart: on the shore; with no land near: its parts
      C.set('log'); Cr.embark(boat()); Cr.dive(); Cr.dismantle(boat()); const sh2 = near('log', p().x, p().y, 8); check(sh2 && !boat(), 'taken apart, it is lost'); W.unplace(sh2);
      W.moorBoat(p().x, p().y, 0); C.set('log'); Cr.embark(boat()); Cr.dive();
      const cp = W.canPlace, wood = inv().count('madera'); W.canPlace = () => false;
      try { Cr.dismantle(boat()); check(inv().count('madera') === wood + 4, 'no land near: not its parts'); } finally { W.canPlace = cp; delete W.canPlace; }
      // Dying while rowing: moored with it inside; with keep, moored and still in the arms
      W.moorBoat(p().x, p().y, 0); C.set('log'); Cr.embark(boat());
      Cr.onDeath(false); const b3 = boat(), d3 = dOf(Math.floor(b3.x), Math.floor(b3.y)); check(!p().boat && !C.held && d3.boatLoad?.[b3.id]?.[0] === 'log', 'dying: the boat or the log is lost');
      Object.assign(p(), { x: b3.x, y: b3.y + 1 }); Cr.embark(b3); check(C.held === 'log', 'not back'); Cr.onDeath(true); check(!p().boat && C.held === 'log' && boat(), 'dying with keep');
      // Orphans (no boat, or another mark) and two requests for one: to the shore; only one ok
      const b4 = boat(), d4 = dOf(Math.floor(b4.x), Math.floor(b4.y)); C.set(null);
      d4.boatLoad = { [b4.id]: ['log', meId(), null, b4.x, b4.y, 'zzzz9999'], gone0001: ['carcass_deer', meId(), C.today(), b4.x, b4.y, 'yyyy8888'] };
      WB().sweep([ckey(Math.floor(b4.x), Math.floor(b4.y))]); check(!Object.keys(d4.boatLoad).length && near('log', b4.x, b4.y, 9) && near('carcass_deer', b4.x, b4.y, 9), 'orphans are lost');
      for (const id of ['log', 'carcass_deer']) { const q = near(id, b4.x, b4.y, 9); if (q) W.unplace(q); }
      W.unmoorBoat(b4); const bid = W.moorBoat(p().x, p().y, 0, 'nnnn0001'), k5 = ckey(Math.floor(p().x), Math.floor(p().y)), d5 = dOf(Math.floor(p().x), Math.floor(p().y));
      d5.boatLoad = { [bid]: ['log', 'id-c7', null, p().x, p().y, 'nnnn0001'] };
      d5.claim = { b1: { by: 'id-c7', k: 'boat', boat: bid, n: 'nnnn0001', to: 'arms', at: W.clock || 0 }, b2: { by: 'id-c7', k: 'boat', boat: bid, n: 'nnnn0001', to: 'arms', at: W.clock || 0 } };
      WB().resolve(k5, 'b1'); WB().resolve(k5, 'b2'); check(d5.claim.b1.ok === true && d5.claim.b2.ok === false && d5.claim.b1.id === 'log', `two boat requests: ${JSON.stringify(d5.claim)}`);
      delete d5.claim;
    } finally { F.v.kids = kids; if (p().boat) p().boat = false; C.set(null); reset(); const q = near('log', tx + 0.5, ty + 0.5, 9); if (q) W.unplace(q); }
  });
  await test('cuevas con bulto (cave bundle): a bundle in the arms still goes down into caves; the wheelbarrow does not', async () => {
    await weightOn();
    const [tx, ty] = openGround(); await goTo(game, tx + 0.5, ty + 3.5);
    const C = game.carry, poi = { id: 1, x: p().x, y: p().y, snow: false };
    const o = placeBarrow(tx, ty);
    try {
      pushIt(o); await game.places.enterCave(poi, 1); check(game.scene === w() && WB().pushing, 'down a cave pushing the wheelbarrow');
      WB().park(true);
      C.set('log'); check(!C.refuse('cave'), 'a log refuses caves');
      await game.places.enterCave(poi, 1); check(game.scene !== w() && C.held === 'log', 'a log does not go down a cave');
      await game.places.climb(game.scene, -1); check(game.scene === w(), 'not out of the cave');
    } finally { if (game.scene !== w()) await game.goTo(w(), tx + 0.5, ty + 3.5, { inside: false }); C.set(null); letGo(); const z = parkedNear(tx + 0.5, ty + 0.5, 6); if (z) w().setTile(...z.tile, 'air'); }
  });
  await test('carretilla coste (wheelbarrow cost): pushing costs less than 0.5 ms per frame', async () => {
    await weightOn();
    const H = game.houseRect(); await goTo(game, (H.x0 + H.x1) / 2, H.y1 + 1.5);   // (by your house: walls, the fence of the garden)
    const live = game.live, ents = live.entities, N = 600;
    const P = new Player({ name: 'x', x: p().x, y: p().y, look: {} }); P.pushing = 'wheelbarrow'; P.face = { ...p().face };
    try {
      for (let k = 0; k < 4; k++) { live.receive('w' + k, { t: 'hi', id: 'id-w' + k, name: 'w' + k, playing: true, look: LOOK, v: GAME_VERSION }); live.receive('w' + k, { t: 'st', sc: 'world', x: p().x + 1 + k, y: p().y + 1, yaw: 0, ca: 'wheelbarrow:log,log:f' }); }
      live.entities = sc => (sc === game.world ? live.others.filter(o => o.entity).map(o => o.entity) : null);
      draw(); draw();
      const keysW = [{ up: true }, { up: true, left: true }, { down: true }, { right: true }];
      let t0 = performance.now();
      for (let i = 0; i < N; i++) { P.update(1 / 60, keysW[(i >> 6) & 3], w()); WB().update(1 / 60); }
      const logic = (performance.now() - t0) / N;
      const Ps = [...live.others].map(o => game.view3d.actors.models.get(o.entity)?.person).filter(Boolean);
      t0 = performance.now();
      for (let i = 0; i < N; i++) for (const Q of Ps) (C3.pushPose || C3.holdPose)(Q, 'shoulder');
      const pose = (performance.now() - t0) / N;
      console.log(`carretilla coste: ${(logic * 1000).toFixed(1)} µs logic, ${(pose * 1000).toFixed(1)} µs pose of ${Ps.length}`);
      check(logic + pose < 0.5, `${logic.toFixed(3)} + ${pose.toFixed(3)} ms`);
      tell('carretilla coste: medida', true, `${(logic * 1000).toFixed(1)} µs/frame logic, ${(pose * 1000).toFixed(1)} µs pose ×${Ps.length}`);
    } finally { live.entities = ents; for (let k = 0; k < 4; k++) live.peers.delete('w' + k); draw(); }
  });
  // ---------- the status bars, the needs and diving (docs/planes/gta/PLAN-D-barras-buceo.md §8) ----------
  const N = () => game.needs, Cb = () => game.combat, say0 = () => {};
  // Everything as a new game has it, in survival and normal, by day: what each needs test starts from and leaves
  const needsBase = () => {
    runCommand(game, '/gamemode survival', say0); game.difficulty = 'normal'; game.rules.doThirst = true; game.rules.doFatigue = true;
    if (p().pose) game.rest.stand();
    Object.assign(p(), { swim: false, sink: 0, dive: 0, forceRise: false, sprinting: false, fastSwim: false, sleeping: false });
    N().reset({}); Cb().hp = 20; Cb().hunger = 20; Cb().regen = 0; Cb().invuln = 0; Cb().paint();
    delete game.buffs.incansable;
    // (clean and dry: the hunt, the carcass or a swim before leave dirt, blood or wet, and a dirty body offers to scrub
    // at the water where Plan D's tests expect no target: body.js aimables, Plan E §4.2)
    const bo = game.body;
    if (bo) { bo.stopScrub?.(); bo.dirt = bo.mud = bo.wet = bo.wetLegs = bo.snow = bo.blood = 0; bo.tickT = 0; }
    clearKeys();
  };
  // A spy on the floats and the toasts (what the player is told), undone by the returned function
  const told = () => {
    const out = [], G = game.gather, f = G.float, ts = hud.toast;
    G.float = (text, c) => { out.push(String(text)); return f.call(G, text, c); };
    hud.toast = (text, k) => { out.push(String(text)); return ts.call(hud, text, k); };
    return { out, undo: () => { G.float = f; hud.toast = ts; } };
  };
  // The cursor on a point given in absolute heights (the water, a find on the bed)
  // (the needs keep the water under the cursor for the frame: a new cursor within the same frame looks again)
  const aimAbs = (x, h, y) => { const v = new THREE.Vector3(x, h, y).project(game.view3d.camera); game.mouse = { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, in: true }; N().aim = null; };
  // The deep sea nearest the village, the shore on the way to it, and a sea tile next to that shore (found once)
  let seaAt = null;
  const sea = () => {
    if (seaAt) return seaAt;
    const G = w().gen, W = w();
    let deep = null;
    for (let r = 80; r < 1600 && !deep; r += 8) for (let a = 0, n = Math.ceil(r * 6.283 / 8); a < n; a++) {
      const x = 21 + Math.cos(a / n * 6.283) * r, y = 26 + Math.sin(a / n * 6.283) * r;
      if (G.biomeAt(x, y) === B.OCEAN && G.groundAt(x, y) < -9) { deep = [Math.floor(x) + 0.5, Math.floor(y) + 0.5]; break; }
    }
    check(deep, 'no deep sea within 1.6 km of the village');
    // (from the deep spot back towards the village: the first land is the shore, and 1.5 tiles out from it the sea)
    const [dx, dy] = deep, L = Math.hypot(dx - 21, dy - 26), ux = (21 - dx) / L, uy = (26 - dy) / L;
    let shore = null, water = null;
    for (let s = 0; s < L; s += 0.25) {
      const x = dx + ux * s, y = dy + uy * s;
      if (!W.water(x, y)) { shore = [x + ux * 0.3, y + uy * 0.3]; water = [x - ux * 1.5, y - uy * 1.5]; break; }
    }
    // The finds around the deep spot: one down deep (an oyster bed or seaweed: shells stay above 5 m), and a sunken chest
    // (one chunk in twelve of the deep sea has one)
    const cx0 = Math.floor(dx / CHUNK), cy0 = Math.floor(dy / CHUNK);
    let shell = null, chest = null;
    for (let r = 0; r <= 14 && !(shell && chest); r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      for (const o of G.seabed(cx0 + i, cy0 + j).finds) {
        if (!shell && (o.kind === 'oyster' || o.kind === 'seaweed') && o.bed < -6) shell = { o, cx: cx0 + i, cy: cy0 + j };
        if (!chest && o.kind === 'sunken_chest') chest = { o, cx: cx0 + i, cy: cy0 + j };
      }
    }
    return (seaAt = { deep, shore, water, shell, chest });
  };
  // Swimming at (x, y), at the surface (a few frames for the water to take the player)
  const swimAt = async (x, y) => {
    await goTo(game, x, y);
    p().dive = 0; p().sink = 0;
    await until(() => p().swim, 4000, 'swimming');
  };
  // How deep to dive so that the diver's height (dive.js diverY) is a little over a bed at height bed
  const diveFor = bed => Math.max(0, WATER_Y - 0.7 - (p().sink || 0) - (bed + 0.4));

  await test('needs (english): old save loads full', async () => {
    try {
      needsBase();
      N().reset({ hp: 7, hunger: 9 });
      check(N().thirst === 20 && N().rest === 100 && N().stamina === 100 && N().air === N().airMax, `an old save: thirst ${N().thirst}, rest ${N().rest}`);
      N().reset({ thirst: 'x', rest: null, dry: -4 });
      check(N().thirst === 20 && N().rest === 100 && N().dry === 0, 'bad values do not load full');
      Object.assign(N(), { thirst: 13.5, dry: 1.2, rest: 42 });
      const out = {}; N().save(out); N().reset(JSON.parse(JSON.stringify(out)));
      check(N().thirst === 13.5 && Math.abs(N().dry - 1.2) < 1e-9 && Math.abs(N().rest - 42) < 0.01, `the round trip: ${N().thirst} ${N().dry} ${N().rest}`);
      const snap = game.snapshot();
      check('thirst' in snap && 'rest' in snap && 'restAt' in snap && !('energy' in snap), `the save keys: ${Object.keys(snap).filter(k => /thirst|rest|energy|dry|nap/.test(k))}`);
    } finally { needsBase(); }
  });
  await test('needs (english): rest recovers offline', async () => {
    try {
      needsBase();
      N().reset({ rest: 10, restAt: Date.now() - 3 * 3600e3, thirst: 7 });
      check(Math.abs(N().rest - 60) < 0.5 && N().thirst === 7, `3 h away: rest ${N().rest}, thirst ${N().thirst}`);
      N().reset({ rest: 10, restAt: Date.now() - 7 * 3600e3 });
      check(N().rest === 100, `7 h away: rest ${N().rest}`);
      N().reset({ rest: 10, restAt: Date.now() + 3600e3 });
      check(N().rest === 10, `a clock from the future: rest ${N().rest}`);
    } finally { needsBase(); }
  });
  await test('needs (english): thirst drains in survival only', async () => {
    try {
      needsBase(); await goTo(game, 21, 26);
      N().update(120); check(N().thirst === 19, `120 s idle: thirst ${N().thirst}`);
      // (idle exertion does not dry: only the needs' own clock; a non-idle one does a little)
      N().thirst = 20; N().dry = 0; Cb().exert(1, true); check(N().dry === 0, `idle exertion dried ${N().dry}`);
      Cb().exert(1); check(N().dry > 0, 'work does not dry');
      for (const [cmd, what] of [['/gamemode creative', 'creative'], ['/gamemode spectator', 'spectator']]) {
        N().thirst = 12; runCommand(game, cmd, say0); N().update(240); check(N().thirst === 20, `${what}: ${N().thirst}`);
        runCommand(game, '/gamemode survival', say0);
      }
      game.difficulty = 'peaceful'; N().thirst = 15; N().update(240); check(N().thirst === 15, `peaceful: ${N().thirst}`);
      // (doThirst false: full, so a thirst left at 0 neither hurts nor blocks healing: review 2026-11-22)
      game.difficulty = 'normal'; game.rules.doThirst = false; N().update(240); check(N().thirst === 20, `doThirst false: ${N().thirst}`);
    } finally { needsBase(); }
  });
  await test('needs (english): thirst damage floors', async () => {
    const kept = game.rules.keepInventory, spy = told();
    try {
      for (const [d, floor] of [['easy', 10], ['normal', 1]]) {
        needsBase(); game.difficulty = d; N().thirst = 0;
        for (let i = 0; i < 30; i++) Cb().update(4.01);
        check(Cb().hp === floor, `${d}: health ${Cb().hp} (wanted ${floor})`);
      }
      needsBase(); game.difficulty = 'peaceful'; N().thirst = 0; Cb().hp = 15;
      for (let i = 0; i < 5; i++) Cb().update(4.01);
      check(Cb().hp >= 15, `peaceful hurts: ${Cb().hp}`);
      // Hard kills, and says why
      needsBase(); game.rules.keepInventory = true; game.difficulty = 'hard'; N().thirst = 0; Cb().hp = 2;
      for (let i = 0; i < 4 && !game.dying; i++) Cb().update(4.01);
      check(game.dying, `hard does not kill: ${Cb().hp}`);
      await until(() => !game.dying, 20000, 'coming back');
      check(spy.out.some(s => s.includes(t('needs.dehydrated'))), `the death says: ${spy.out.slice(-3)}`);
    } finally { spy.undo(); game.rules.keepInventory = kept; game.busy = false; needsBase(); await goTo(game, 21, 26); }
  });
  await test('needs (english): regen needs food and water', async () => {
    try {
      needsBase(); Cb().hp = 10; N().thirst = 9;
      Cb().update(4.01); check(Cb().hp === 10, `fed but thirsty heals: ${Cb().hp}`);
      N().thirst = 10; Cb().update(4.01); check(Cb().hp === 11, `fed and watered does not heal: ${Cb().hp}`);
      Cb().hunger = 17; Cb().update(4.01); check(Cb().hp === 11, `hungry heals: ${Cb().hp}`);
    } finally { needsBase(); }
  });
  await test('needs (english): drink river not sea', async () => {
    const was = game.mouse, spy = told();
    try {
      needsBase();
      // The village pond (fresh): aimed from its shore, Drink; one press drinks on, a step stops it, another drinks to full
      await goTo(game, 27.4, 27); draw(); draw();
      check(N().waterKind(29.2, 27) === 'fresh', `the pond is ${N().waterKind(29.2, 27)}`);
      N().thirst = 19; aimAbs(29.2, WATER_Y, 27);
      check(!game.nearest(), `at 95 % it offers: ${game.nearest()?.text}`);
      N().thirst = 6; aimAbs(29.2, WATER_Y, 27);
      let act = game.nearest(); check(act?.text === t('needs.drink_water'), `at the pond it says: ${act?.text}`);
      act.run(); check(N().drinking && p().crouch, 'it does not start drinking, crouched');
      await frames(30); const sipped = N().thirst; check(sipped > 7.5, `half a second drank ${sipped - 6}`);
      keys.up = true; await frames(2); keys.up = false;
      check(!N().drinking && !p().crouch, 'a step does not stop drinking or leaves the player crouched');
      await goTo(game, 27.4, 27); draw(); aimAbs(29.2, WATER_Y, 27); game.nearest()?.run();
      await until(() => !N().drinking, 8000, 'drinking to full');
      check(N().thirst === 20, `one press drinks to ${N().thirst}`);
      // Full: no target; in a cave or a house (not the world), none either
      aimAbs(29.2, WATER_Y, 27); check(!game.nearest(), 'full, it still offers to drink');
      N().thirst = 5; check(!N().aimables(p(), { placedNear: () => [] }, () => ({})), 'another scene offers water');
      // A well drinks (the big one and the small one: farm.wellAction)
      const well = game.farm.wellAction({ x: p().x + 1, y: p().y }, null);
      check(well?.text === t('needs.well.drink'), `the well says: ${well?.text}`);
      well.run(); check(N().drinking, 'the well does not drink'); N().stopDrinking();
      // The sea: salty, and nothing changes
      const S = sea();
      check(S.shore && N().waterKind(...S.water) === 'salt', `the sea water there is ${S.water && N().waterKind(...S.water)}`);
      await goTo(game, ...S.shore); draw(); draw();
      N().thirst = 6; aimAbs(S.water[0], WATER_Y, S.water[1]);
      act = game.nearest(); check(act?.text === t('needs.sea_salty'), `at the sea it says: ${act?.text} (aim ${JSON.stringify(N().waterAim(p()))}, at ${p().x.toFixed(2)},${p().y.toFixed(2)} swim ${p().swim}, water ${S.water.map(v => v.toFixed(2))}, ray ${JSON.stringify(game.view3d.rayAt(game.mouse.x, game.mouse.y))})`);
      act.run(); await frames(30); check(N().thirst <= 6 && !N().drinking, `the sea quenched: ${N().thirst}`);
    } finally { spy.undo(); game.mouse = was; game.highlight = null; N().stopDrinking(); needsBase(); await goTo(game, 21, 26); }
  });
  await test('needs (english): canteen fill sip and keep', async () => {
    const was = game.mouse, I = inv(), kept = I.slots.slice(), sel = I.selected;
    try {
      needsBase();
      // A new game starts with a full canteen
      const W = new WeightInventory(); for (const [id, n, extra] of START_KIT) W.add(id, n, extra);
      check(W.slots.find(s => s?.id === 'canteen')?.sips === 4, 'the start kit has no full canteen');
      // Empty, filled at the pond (the needs' fill target), then a sip
      I.slots[I.selected] = { id: 'canteen', n: 1 }; I.changed();
      await goTo(game, 27.4, 27); draw(); draw(); aimAbs(29.2, WATER_Y, 27);
      const tg = N().target(p(), I.held, ITEMS.canteen);
      check(tg?.label === t('needs.canteen.fill', { item: noun('item', 'canteen'), n: 0, max: 4 }), `the fill label: ${tg?.label}`);
      tg.use(); check(I.held.sips === 4, `filled to ${I.held.sips}`);
      check(!N().target(p(), I.held, ITEMS.canteen), 'full, it still offers to fill');
      N().thirst = 10; game.gather.cooldown = 0; game.gather.sip(I.selected);
      check(I.held.sips === 3 && N().thirst === 15, `a sip: ${I.held.sips} left, thirst ${N().thirst}`);
      // The sips weigh, in the load (carry), and stay through a chest's copy, a toss and a save
      const s = I.held, kg = I.kg;
      check(Math.abs(stackKg(s) - stackKg({ id: 'canteen', n: 1 }) - 3 * SIP_KG) < 1e-9 && SIP_KG === 0.25, `stackKg: ${stackKg(s)}`);
      s.sips = 4; I.changed(); check(Math.abs(I.kg - kg - 0.25) < 0.051, `the load does not grow with a sip: ${kg} → ${I.kg}`);
      s.sips = 3; I.changed();
      check(extraOf(s)?.sips === 3, 'a chest would lose the sips (extraOf)');
      const saved = new WeightInventory(JSON.parse(JSON.stringify(I.toSave())));
      check(saved.slots.find(q => q?.id === 'canteen')?.sips === 3, 'the save loses the sips');
      I.take(I.selected, 1, true); check(!I.held, 'the canteen is still in hand');
      game.gather.throwOut('canteen', 1, { sips: 3 }); await collectDrops(game);
      const back = I.slots.find(q => q?.id === 'canteen' && q.sips === 3); check(back, 'a tossed canteen comes back without its water');
      // The packlist row and the tooltip weigh it with its water (ui/packlist.js, ui/inventory.js)
      check(stackKg(back) > weightOf('canteen'), 'the stack weight ignores the water');
    } finally { game.mouse = was; I.slots.splice(0, I.slots.length, ...kept); I.select(sel); I.changed(); needsBase(); await goTo(game, 21, 26); }
  });
  await test('needs (english): drinks quench', async () => {
    const I = inv(), kept = I.slots.slice(), sel = I.selected;
    try {
      for (const id of ['leche', 'apple_juice', 'sopa_verduras', 'coco']) {
        needsBase(); check(ITEMS[id], `no ${id}`);
        N().thirst = 0; Cb().hunger = 0;
        I.slots[I.selected] = { id, n: 1 }; I.changed(); game.gather.cooldown = 0; game.gather.eat(I.selected);
        check(N().thirst === Math.min(20, thirstOf(ITEMS[id])) && thirstOf(ITEMS[id]) > 0, `${id}: thirst ${N().thirst} (its value ${thirstOf(ITEMS[id])})`);
      }
      // Full on both (and not hurt): refused, nothing used
      needsBase(); I.slots[I.selected] = { id: 'leche', n: 1 }; I.changed(); game.gather.cooldown = 0; game.gather.eat(I.selected);
      check(I.held?.id === 'leche', 'drunk with no thirst and no hunger');
    } finally { I.slots.splice(0, I.slots.length, ...kept); I.select(sel); I.changed(); needsBase(); }
  });
  await test('needs (english): stamina sprint and exhaust', async () => {
    const spy = told(), step = (secs, f) => { for (let i = 0; i < Math.round(secs * 60); i++) { f?.(); game.time += 1 / 60; N().update(1 / 60); } };
    const I = inv(), kept = I.slots.slice();
    try {
      needsBase();
      I.slots.fill(null); I.changed();   // (light: what the tests before piled up would stop the running, carry.js)
      // The keys: the third tap of W makes the player sprint (entities.js); the second only jogs
      await goTo(game, 21, 26); keys.up = true; keys.run = true; await frames(20);
      check(!p().sprinting && p().jogging, 'jogging is sprinting');
      keys.sprint = true; await frames(5);
      check(p().sprinting, 'sprinting is not sprinting'); keys.up = false; keys.run = keys.sprint = false; await frames(2); check(!p().sprinting, 'stopped, still sprinting');
      needsBase();
      p().sprinting = true; step(1, () => { p().sprinting = true; });
      check(Math.abs(N().stamina - 95) < 0.5, `a second of sprint: ${N().stamina}`);
      N().stamina = 1; keys.run = keys.sprint = true; step(2, () => { p().sprinting = true; });
      check(N().stamina === 0 && N().exhausted && N().noRun(), `empty: ${N().stamina}, exhausted ${N().exhausted}`);
      check(spy.out.filter(s => s === t('needs.too_tired')).length === 1, `the "too tired" float: ${spy.out.filter(s => s === t('needs.too_tired')).length} times`);
      // (riding or rowing spends no stamina: exhausted, the horse still gallops and the boat still rows fast)
      for (const k of ['mount', 'boat', 'aboard']) { p()[k] = {}; const no = N().noRun(); delete p()[k]; check(!no, `exhausted ${k} cannot run`); }
      keys.run = keys.sprint = false; p().sprinting = false;
      step(3.4); check(N().exhausted, `exhausted cleared early, at ${N().stamina}`);
      step(0.3); check(!N().exhausted && N().stamina >= 50, `not cleared at half the cap: ${N().stamina}`);
      step(3); check(N().stamina === N().cap, `not full in about 6 s: ${N().stamina}`);
      // Tools spend, but do not delay the refill; the vegetable soup (incansable) spends nothing
      N().stamina = 50; N().idleT = 9; N().work('hacha'); const after = N().stamina; check(after < 50, 'a tool costs nothing');
      step(0.2); check(N().stamina > after, 'a tool delays the refill');
      game.buffs.incansable = game.time + 60; N().stamina = 80; step(1, () => { p().sprinting = true; }); check(N().stamina >= 80, `tireless spends: ${N().stamina}`);
      delete game.buffs.incansable;
      // Lying in bed after a sprint: nothing drains
      p().pose = { kind: 'lie', yaw: 0, h: 0 }; N().stamina = 60; step(0.5, () => { p().sprinting = true; }); check(N().stamina >= 60, `lying drains: ${N().stamina}`);
    } finally { spy.undo(); I.slots.splice(0, I.slots.length, ...kept); I.changed(); p().pose = null; p().sprinting = false; needsBase(); }
  });
  // ---------- the three speeds: W walks, a second tap jogs, a third sprints (input.js pressW, entities.js GAIT) ----------
  const tapW = (at, hold = 80) => { pressW(at); releaseW(at + hold); };
  const tier = () => gaitOf(keys);
  const keyW = (type, repeat = false) => dispatchEvent(new KeyboardEvent(type, { code: 'KeyW', key: 'w', repeat, bubbles: true }));
  const shiftTap = () => { for (const type of ['keydown', 'keyup']) dispatchEvent(new KeyboardEvent(type, { code: 'ShiftLeft', key: 'Shift', bubbles: true })); };
  await test('gait (english): taps of W pick walk jog sprint, and letting go walks', async () => {
    try {
      clearKeys();
      let t0 = performance.now() - 9e5;   // (times in the past: a real key event later never chains to them)
      pressW(t0); check(tier() === 0, `one press walks: ${tier()}`); releaseW(t0 + 80);
      pressW(t0 + 200); check(tier() === 1 && keys.run && !keys.sprint, `a tap and a press jog: ${tier()}`); releaseW(t0 + 260);
      pressW(t0 + 400); check(tier() === 2 && keys.run && keys.sprint, `two taps and a press sprint: ${tier()}`);
      pressW(t0 + 500); pressW(t0 + 520); check(tier() === 2, 'a keydown without its keyup changed the tier');
      releaseW(t0 + 4000); check(tier() === 0 && !keys.run && !keys.sprint, `let go, still ${tier()}`);
      pressW(t0 + 4100); check(tier() === 0, `after a long sprint a quick press walks: ${tier()}`); releaseW(t0 + 4150);
      // Timing out: a second press too late walks
      t0 += 1e4; tapW(t0); pressW(t0 + TAP_WINDOW + TAP_GAP); check(tier() === 0, `a late second press: ${tier()}`); releaseW(t0 + 900);
      t0 += 1e4; tapW(t0); pressW(t0 + TAP_WINDOW - 10); check(tier() === 1, `just in the window: ${tier()}`); releaseW(t0 + 900);
      // A slow tap (a long press, a short gap) still counts; a hold does not
      t0 += 1e4; pressW(t0); releaseW(t0 + TAP_HOLD - 20); pressW(t0 + TAP_HOLD - 20 + TAP_GAP - 20); check(tier() === 1, `a slow tap: ${tier()}`); releaseW(t0 + 1500);
      t0 += 1e4; pressW(t0); releaseW(t0 + TAP_HOLD + 100); pressW(t0 + TAP_HOLD + 150); check(tier() === 0, `a hold counted as a tap: ${tier()}`); releaseW(t0 + 2000);
      // More taps than three: still a sprint; a jog let go and pressed again: walking
      t0 += 1e4; tapW(t0); tapW(t0 + 150); tapW(t0 + 300); pressW(t0 + 450); check(tier() === 2, `four taps: ${tier()}`); releaseW(t0 + 600);
      t0 += 1e4; tapW(t0); pressW(t0 + 150); releaseW(t0 + 3000); pressW(t0 + 3100); check(tier() === 0, `a jog let go: ${tier()}`); releaseW(t0 + 3200);
      // Out of breath (dropSprint): down to a jog while held; then three new taps to sprint again
      t0 += 1e4; tapW(t0); tapW(t0 + 150); pressW(t0 + 300); dropSprint(); check(tier() === 1 && keys.run && !keys.sprint, `dropped: ${tier()}`);
      releaseW(t0 + 5000); pressW(t0 + 5100); check(tier() === 0, `after the drop: ${tier()}`); releaseW(t0 + 5150);
      t0 += 1e4; tapW(t0); tapW(t0 + 150); pressW(t0 + 300); check(tier() === 2, `three new taps: ${tier()}`); releaseW(t0 + 400);
      // The real keys: key repeat never counts, and the second tap stands up from a crouch (and jogs). (A first key warms
      // the sound up: the first keydown of a page starts it, slowly, and a synthetic keyup made after it takes that time
      // as a long hold; a real one has its own time)
      keyW('keydown'); keyW('keyup'); clearKeys(); await frames(2); p().crouch = true;
      keyW('keydown'); for (let i = 0; i < 5; i++) keyW('keydown', true);
      check(keys.up && tier() === 0 && p().crouch, `held W with key repeat: tier ${tier()}, crouch ${p().crouch}`);
      keyW('keyup'); keyW('keydown');
      check(keys.up && tier() === 1 && !p().crouch, `the second tap: tier ${tier()}, crouch ${p().crouch}`);
      keyW('keyup'); keyW('keydown'); check(tier() === 2, `the third tap: ${tier()}`);
      for (let i = 0; i < 5; i++) keyW('keydown', true); check(tier() === 2, 'key repeat dropped the sprint');
      // A Shift tap crouches and walks; letting go of W, nothing is left held
      shiftTap(); check(tier() === 0 && p().crouch, `a Shift tap: tier ${tier()}, crouch ${p().crouch}`);
      keyW('keyup'); check(!keys.up && tier() === 0, 'let go');
      // The pause (clearKeys) forgets the taps
      keyW('keydown'); keyW('keyup'); clearKeys(); keyW('keydown'); check(tier() === 0, `a tap before the pause chained: ${tier()}`); keyW('keyup');
    } finally { p().crouch = false; clearKeys(); }
  });
  await test('gait (english): speeds per tier on foot, crouching, riding, rowing and swimming', async () => {
    const I = inv(), kept = I.slots.slice();
    const at = async (run, sprint, n = 40) => { keys.up = true; keys.run = run; keys.sprint = sprint; await frames(n); return Math.hypot(p().vx, p().vy) / (p().speedMul || 1); };
    const near = (a, b) => Math.abs(a - b) < 0.04 * b;
    try {
      needsBase(); I.slots.fill(null); I.changed();
      await goTo(game, 21, 26);
      const [w0, j0, s0] = GAIT.foot;
      check(w0 === 3.2 && j0 > w0 && s0 > j0 && s0 <= 5.3 * 1.1 + 1e-9 && (j0 - w0) / (s0 - w0) >= 0.6 && (j0 - w0) / (s0 - w0) <= 0.7, `the numbers: ${GAIT.foot}`);
      let v = await at(false, false); check(near(v, w0) && p().gait === 0 && !p().jogging && !p().sprinting, `walk ${v}, gait ${p().gait}`);
      v = await at(true, false); check(near(v, j0) && p().gait === 1 && p().jogging && !p().sprinting, `jog ${v}, gait ${p().gait}`);
      v = await at(true, true); check(near(v, s0) && p().gait === 2 && p().sprinting && !p().jogging, `sprint ${v}, gait ${p().gait}`);
      keys.up = false; keys.run = keys.sprint = false; await frames(30); check(p().gait === 0 && !p().sprinting, `stopped: gait ${p().gait}`);
      // Crouching: always slow (the taps stand up first: see the taps test)
      p().crouch = true; v = await at(false, false); check(near(v, 1.4) && p().gait === 0, `crouching ${v}`); p().crouch = false;
      // Riding: walk, trot, gallop (the gallop is the run of before); out of breath the horse still gallops
      p().mount = true; await frames(2);
      for (let k = 0; k < 3; k++) { v = await at(k > 0, k > 1); check(near(v, GAIT.ride[k]) && p().gait === k && !p().sprinting && !p().jogging, `riding, tier ${k}: ${v}, gait ${p().gait}`); }
      check(GAIT.ride[2] === 5.3, `the gallop: ${GAIT.ride[2]}`);
      N().stamina = 0; N().exhausted = true; v = await at(true, true); check(near(v, GAIT.ride[2]) && keys.sprint, `exhausted, the gallop: ${v}`);
      p().mount = false; N().reset({});
      // Rowing (on land the boat does not move, but the stroke asks for the speed): the fast row from the jog up
      p().boat = true;
      for (let k = 0; k < 3; k++) { v = await at(k > 0, k > 1); check(near(v, GAIT.row[k] * 1.4), `rowing, tier ${k}: ${v}`); }
      p().boat = false;
      // Swimming: the jog is a steady crawl, the sprint the fast swim (the only one that spends)
      const S = sea(); await swimAt(...S.deep);
      for (let k = 0; k < 3; k++) { v = await at(k > 0, k > 1, 150); check(near(v, GAIT.swim[k]) && p().fastSwim === (k === 2) && !p().sprinting && !p().jogging, `swimming, tier ${k}: ${v}, fast ${p().fastSwim}`); }
    } finally { clearKeys(); p().mount = false; p().boat = false; p().crouch = false; I.slots.splice(0, I.slots.length, ...kept); I.changed(); needsBase(); await goTo(game, 21, 26); }
  });
  await test('gait (english): only the sprint spends stamina; out of breath drops to a jog', async () => {
    const I = inv(), kept = I.slots.slice(), spy = told();
    try {
      needsBase(); I.slots.fill(null); I.changed();
      await goTo(game, 21, 26);
      const run = async (k, secs) => { keys.up = k >= 0; keys.run = k > 0; keys.sprint = k > 1; await frames(Math.round(secs * 60)); };
      N().stamina = 40; N().idleT = 9; await run(-1, 1); const still = N().stamina - 40;
      N().stamina = 40; N().idleT = 9; await run(1, 1); const jog = N().stamina - 40;
      N().stamina = 40; N().idleT = 9; await run(2, 1); const sprint = N().stamina - 40;
      check(jog > 2 && jog < still - 2, `a second: standing +${still}, jogging +${jog}`);
      check(sprint < -3 && sprint > -7, `a second of sprint: ${sprint}`);
      keys.up = false; clearKeys(); await frames(5);
      // Out of breath sprinting: a jog (it never stops), and after the refill still a jog until three new taps
      N().tooTiredSaidAt = -Infinity; const t0 = performance.now() - 6e4; tapW(t0); tapW(t0 + 150); pressW(t0 + 300); keys.up = true;
      N().stamina = 0.5; await frames(20);
      check(N().exhausted && keys.run && !keys.sprint && p().gait === 1 && p().jogging && !p().sprinting, `exhausted: run ${keys.run}, sprint ${keys.sprint}, gait ${p().gait}`);
      const v = Math.hypot(p().vx, p().vy) / (p().speedMul || 1); check(Math.abs(v - GAIT.foot[1]) < 0.2, `exhausted speed ${v}`);
      check(spy.out.filter(s => s === t('needs.too_tired')).length === 1, `the "too tired" float: ${spy.out.filter(s => s === t('needs.too_tired')).length}`);
      await frames(120); check(N().stamina > 5, `jogging does not refill: ${N().stamina}`);
      N().stamina = N().cap; N().exhausted = false; await frames(10);
      check(p().gait === 1 && !keys.sprint, `recovered, sprinting again without taps: ${p().gait}`);
      releaseW();
      // Peaceful or creative: no stamina, the sprint never drops
      runCommand(game, '/gamemode creative', () => {}); tapW(t0 + 9e3); tapW(t0 + 9e3 + 150); pressW(t0 + 9e3 + 300); await frames(60);
      check(keys.sprint && p().gait === 2, `creative: sprint ${keys.sprint}, gait ${p().gait}`);
    } finally { spy.undo(); clearKeys(); I.slots.splice(0, I.slots.length, ...kept); I.changed(); needsBase(); }
  });
  await test('gait (english): a load stops the sprint, overloaded or the wheelbarrow only walk, the arms jog', async () => {
    const W = new WeightInventory(), C = new Carry(fake(W)), load = kg => { W.slots.length = 0; W.slots.push(...Array(HOTBAR).fill(null)); W.equip.espalda = { id: 'mochila' }; W.add('piedra', kg); };
    load(80); check(!C.noRun() && !C.noJog(), 'light, held back');
    load(95); check(C.noRun() && !C.noJog(), 'loaded: no sprint, but jogging');
    load(120); check(C.noRun() && C.noJog(), 'overloaded: walking');
    load(10); C.held = 'log'; check(C.noRun() && !C.noJog(), 'in the arms: no sprint, but jogging'); C.held = null;
    const B = new Carry(fake(W, { barrow: { pushing: true } })); load(10); check(B.noRun() && B.noJog(), 'pushing the wheelbarrow: walking');
    // In the game: the gate of the tier, and what the player is told
    await weightOn();
    const I = inv(), kept = I.slots.slice(), spy = told(), G = game.carry;
    const fill = r => { I.slots.fill(null); I.changed(); const n = Math.ceil((r * I.capKg - I.kg) / weightOf('piedra')); if (n > 0) I.add('piedra', n); };
    try {
      needsBase(); await goTo(game, 21, 26);
      fill(1.35); G.runSaidAt = -1e9; G.runWas = false;
      keys.up = true; keys.run = keys.sprint = true; await frames(20);
      check(p().gait === 1 && !p().sprinting && p().noSprint && !p().noJog, `loaded, sprinting: gait ${p().gait} at ${I.load.toFixed(2)}`);
      check(spy.out.includes(t('carry.no_sprint_heavy')), `told: ${JSON.stringify(spy.out)}`);
      fill(1.7); G.runSaidAt = -1e9; G.runWas = false; keys.sprint = false; await frames(20);
      check(p().gait === 0 && p().noJog, `overloaded, jogging: gait ${p().gait} at ${I.load.toFixed(2)}`);
      check(spy.out.includes(t('carry.no_run_heavy')), `told: ${JSON.stringify(spy.out)}`);
    } finally { spy.undo(); clearKeys(); I.slots.splice(0, I.slots.length, ...kept); I.changed(); needsBase(); }
  });
  await test('gait (english): the jog and the sprint look like runs; old calls keep their look', async () => {
    const look = { ...LOOK }, A = new RealPerson(look), Bp = new RealPerson(look), b = P => P.r.bones;
    try {
      // (the same calls give the same bones: an old call without gait is the walk tier's look)
      for (let i = 0; i < 90; i++) { A.animate(1 / 60, 5.3); Bp.animate(1 / 60, 5.3, 0); }
      check(['legL', 'armL', 'body', 'foreR'].every(k => Math.abs(b(A)[k].rotation.x - b(Bp)[k].rotation.x) < 1e-9), 'without the gait the old look changed');
      const measure = (P, speed, gait) => { let lean = 0, arm = 0, elbow = 0, high = -9, low = 9; for (let i = 0; i < 180; i++) { P.animate(1 / 60, speed, gait); if (i < 60) continue; const B = b(P); lean += B.body.rotation.x; arm = Math.max(arm, Math.abs(B.armL.rotation.x)); elbow = Math.max(elbow, -B.foreL.rotation.x); high = Math.max(high, B.body.position.y); low = Math.min(low, B.body.position.y); } return { lean: lean / 120, arm, elbow, bob: high - low }; };
      const W0 = measure(A, 3.2, 0), J = measure(A, 4.8, 1), S = measure(A, 5.8, 2);
      check(J.lean > W0.lean + 0.03 && S.lean > J.lean + 0.06, `the lean: ${W0.lean} ${J.lean} ${S.lean}`);
      check(J.arm > W0.arm && S.arm > J.arm + 0.15 && S.elbow > J.elbow && J.elbow > W0.elbow, `the arms: ${JSON.stringify([W0, J, S])}`);
      check(J.bob > 0.02 && S.bob > 0.02, `no flight: ${J.bob} ${S.bob}`);
      const [ZA, ZT, ZJ, ZS] = A.r.zancadas, hz = [3.2 / ZT, 4.8 / ZJ, 5.8 / ZS];
      check(hz[0] < hz[1] && hz[1] < hz[2] && hz[2] < 3, `cycles per second: ${hz}`);
    } finally { A.dispose(); Bp.dispose(); }
  });
  await test('gait (english): the ridden horse walks, trots and gallops; a free horse as before', async () => {
    const h = horseModel('castano'), u = h.userData, hips = () => u.legs.map(l => l.hip.rotation.x), spread = (i, j, sign = 1) => { let m = 0; for (let f = 0; f < 60; f++) { animateHorse(h, 8, 0, null, 1 / 60, h.g); const a = hips(); m = Math.max(m, Math.abs(a[i] - sign * a[j])); } return m; };
    h.g = 1; for (let f = 0; f < 300; f++) animateHorse(h, 8, 0, null, 1 / 60, 1);
    check(spread(0, 3) < 0.02 && spread(1, 2) < 0.02 && spread(0, 1, -1) < 0.02, `the trot is not by diagonal pairs: ${spread(0, 3)} ${spread(0, 1, -1)}`);
    h.g = 2; for (let f = 0; f < 300; f++) animateHorse(h, 9.5, 0, null, 1 / 60, 2);
    check(spread(0, 3) > 0.2 && spread(2, 3) < 0.6 && Math.abs(u.body.rotation.x) <= 0.08, `the gallop: ${spread(0, 3)} ${spread(2, 3)}`);
    h.g = 0; for (let f = 0; f < 300; f++) animateHorse(h, 5.8, 0, null, 1 / 60, 0);
    check(spread(0, 3) > 0.2 && spread(0, 1, -1) < 0.03 && u.amp[0] < 0.5, `the walk: ${spread(0, 3)} ${spread(0, 1, -1)}`);
    // Without a gait (a free horse, a rider of an old game): the cycle of before, by the time
    const F = horseModel('castano'), k = Math.min(1, 6 / 3); animateHorse(F, 6, 2, null, 1 / 60);
    check(F.userData.legs.every(l => Math.abs(l.hip.rotation.x - Math.sin(2 * (4 + 6 * 2.2) + l.phase) * 0.6 * k) < 1e-9) && !F.userData.bob, 'a free horse changed');
    // The cadence follows the stride (with rideSpeed 1.8: 5.76, 7.92 and 9.54 m/s), near the free horse's 2.6 to 3.4 cycles
    // a second, never paddling; and the hooves stay down while the trunk bobs and rocks
    const hz = [[0, 5.76], [1, 7.92], [2, 9.54]].map(([g, v]) => horseCadence(g, v));
    check(hz.every(f => f > 2 && f < 3.5) && hz[0] < hz[1] && hz[1] < hz[2], `cycles per second: ${hz.map(f => f.toFixed(2))}`);
    const H = horseModel('castano'), HU = H.userData, hipW = new THREE.Vector3(); let worst = 0;
    H.updateMatrixWorld(true); const rest = HU.legs.map(l => l.hip.getWorldPosition(hipW).y);
    for (let f = 0; f < 240; f++) {
      animateHorse(H, 9.54, 0, null, 1 / 60, 2); H.updateMatrixWorld(true);
      HU.legs.forEach((l, i) => { worst = Math.max(worst, Math.abs(l.hip.getWorldPosition(hipW).y - rest[i])); });
    }
    check(HU.bob > 0 || HU.body.rotation.x !== 0, 'the gallop no longer bobs');
    check(worst < 0.004, `the hips ride with the trunk at the gallop: ${worst.toFixed(4)} m`);
  });
  await test('gait (english): the gait goes to the others as an optional field', async () => {
    const L = game.live;
    try {
      L.receive('g1', { t: 'hi', id: 'id-g1', name: 'g1', playing: true, look: LOOK, v: GAME_VERSION });
      const st = more => L.receive('g1', { t: 'st', sc: 'world', x: 21, y: 27, yaw: 0, ...more }), e = () => L.peers.get('g1').entity;
      st({ gt: 2 }); check(e().gait === 2, `gt 2: ${e().gait}`);
      st({ gt: 1, m: 1 }); check(e().gait === 1 && e().mount, `gt 1 riding: ${e().gait}`);
      st({ gt: 0 }); check(e().gait === 0, `gt 0: ${e().gait}`);
      st({}); check(e().gait === undefined, `a game from before: ${e().gait}`);
      st({ gt: 9 }); check(e().gait === undefined, `garbage: ${e().gait}`);
      st({ gt: 'x' }); check(e().gait === undefined, `garbage: ${e().gait}`);
      const text = await (await fetch(`src/live.js?t=${Date.now()}`)).text();
      check(/gt: p\.gait \|\| 0/.test(text), 'the state does not send the gait');
    } finally { L.peers.delete('g1'); }
  });
  // ---------- Shift, the posture key: a tap or a hold (input.js pressShift/releaseShift, rest.js posture) ----------
  const shiftHeld = (at, ms) => { pressShift(at); if (ms >= SHIFT_HOLD) shiftTick(at + SHIFT_HOLD); releaseShift(at + ms); };
  const poseNow = () => p().pose?.kind || (p().crouch ? 'crouch' : 'stand');
  const keyEv = (code, type, more = {}) => dispatchEvent(new KeyboardEvent(type, { code, key: code.startsWith('Shift') ? 'Shift' : code.startsWith('Meta') ? 'Meta' : code.slice(3).toLowerCase(), bubbles: true, ...more }));
  await test('posture (english): Shift taps and holds go stand, crouch, sit on the floor and lie face up', async () => {
    await weightOn();
    const I = inv(), kept = I.slots.slice();
    try {
      clearKeys(); needsBase(); I.slots.fill(null); I.changed(); await goTo(game, 21, 26);
      Object.assign(p(), { pose: null, crouch: false });
      let t0 = performance.now() - 9e5;
      const go = (ms, want, what) => { shiftHeld(t0, ms); t0 += 2000; check(poseNow() === want, `${what}: ${poseNow()}, wanted ${want}`); };
      go(80, 'crouch', 'standing, a tap');
      go(80, 'stand', 'crouching, a tap');
      go(SHIFT_HOLD + 200, 'floorSit', 'standing, a hold');
      check(p().pose.h < 0 && !p().crouch, `sitting on the floor: ${JSON.stringify(p().pose)}`);
      go(80, 'crouch', 'sitting, a tap');
      go(SHIFT_HOLD + 200, 'floorSit', 'crouching, a hold');
      go(SHIFT_HOLD + 200, 'floorLie', 'sitting, a hold');
      go(SHIFT_HOLD + 200, 'floorLie', 'lying, a hold');
      go(80, 'floorSit', 'lying, a tap');
      // (the hold acts when it is reached, before letting go; a late timer: the hold at the letting go)
      game.rest.stand(); pressShift(t0); shiftTick(t0 + SHIFT_HOLD - 30); check(poseNow() === 'stand', `before the hold: ${poseNow()}`);
      shiftTick(t0 + SHIFT_HOLD); check(poseNow() === 'floorSit', `the hold reached: ${poseNow()}`); releaseShift(t0 + 900); check(poseNow() === 'floorSit', `its letting go: ${poseNow()}`); t0 += 2000;
      game.rest.stand(); pressShift(t0); releaseShift(t0 + SHIFT_HOLD + 60); check(poseNow() === 'floorSit', `a late timer: ${poseNow()}`); t0 += 2000;
      game.rest.stand();
      // With another key meanwhile (Shift+R, Shift+Q, Shift+click): no posture, neither the tap nor the hold
      pressShift(t0); shiftWithOther(); releaseShift(t0 + 80); check(poseNow() === 'stand', `Shift with another key, a tap: ${poseNow()}`); t0 += 2000;
      pressShift(t0); shiftWithOther(); shiftTick(t0 + SHIFT_HOLD + 50); releaseShift(t0 + 900); check(poseNow() === 'stand', `Shift with another key, a hold: ${poseNow()}`); t0 += 2000;
      keyEv('ShiftLeft', 'keydown'); keyEv('KeyR', 'keydown', { shiftKey: true }); keyEv('KeyR', 'keyup', { shiftKey: true }); keyEv('ShiftLeft', 'keyup');
      check(poseNow() === 'stand', `the real Shift+R: ${poseNow()}`);
      keyEv('ShiftLeft', 'keydown'); keyEv('ShiftLeft', 'keyup'); check(poseNow() === 'crouch', `the real Shift tap: ${poseNow()}`);
      keyEv('ShiftLeft', 'keydown'); await sleep(SHIFT_HOLD + 120); check(poseNow() === 'floorSit', `the real Shift held: ${poseNow()}`); keyEv('ShiftLeft', 'keyup'); check(poseNow() === 'floorSit', `its letting go: ${poseNow()}`);
      // G and H do nothing any more (the floor poses are Shift's)
      game.rest.stand(); p().crouch = false;
      for (const c of ['KeyG', 'KeyH']) { keyEv(c, 'keydown'); keyEv(c, 'keyup'); check(poseNow() === 'stand', `${c}: ${poseNow()}`); }
      // Walking gets up from the floor; W W from a crouch stands up and jogs
      shiftHeld(t0, SHIFT_HOLD + 100); t0 += 2000; check(poseNow() === 'floorSit', `sat: ${poseNow()}`);
      keys.up = true; await frames(3); check(!p().pose, `walking did not get up: ${poseNow()}`); keys.up = false; await frames(20);
      shiftHeld(t0, SHIFT_HOLD + 100); t0 += 2000; shiftHeld(t0, SHIFT_HOLD + 100); t0 += 2000; check(poseNow() === 'floorLie', `lying: ${poseNow()}`);
      keys.up = true; await frames(3); check(!p().pose, `walking did not get up from lying: ${poseNow()}`); keys.up = false; await frames(20);
      shiftHeld(t0, 80); t0 += 2000; check(poseNow() === 'crouch', 'not crouched');
      tapW(t0); pressW(t0 + 150); check(poseNow() === 'stand' && gaitOf(keys) === 1, `W W from a crouch: ${poseNow()}, tier ${gaitOf(keys)}`); releaseW(t0 + 400); t0 += 2000;
      // A hold while walking: nothing (walking would get up at once); the tap while walking crouches, and walks
      keys.up = true; shiftHeld(t0, SHIFT_HOLD + 100); t0 += 2000; check(poseNow() === 'stand', `a hold while walking: ${poseNow()}`);
      tapW(t0); pressW(t0 + 150); shiftHeld(t0 + 200, 80); check(poseNow() === 'crouch' && gaitOf(keys) === 0, `a tap while jogging: ${poseNow()}, tier ${gaitOf(keys)}`); releaseW(t0 + 500); t0 += 2000;
      keys.up = false; p().crouch = false; await frames(20);
      // Riding, in a boat, on a chair or in a bed: Shift is no posture
      for (const [what, set] of [['riding', { mount: true }], ['rowing', { boat: true }], ['on a chair', { pose: { kind: 'sit', yaw: 0, h: 0.14 } }], ['in bed', { pose: { kind: 'lie', yaw: 0, h: 0.6 } }]]) {
        Object.assign(p(), set); const was = JSON.stringify(p().pose);
        shiftHeld(t0, 80); t0 += 2000; shiftHeld(t0, SHIFT_HOLD + 100); t0 += 2000;
        check(!p().crouch && JSON.stringify(p().pose) === was, `${what}: crouch ${p().crouch}, pose ${JSON.stringify(p().pose)}`);
        Object.assign(p(), { mount: false, boat: false, pose: null });
      }
      // With something in the arms: no sitting (carry.js refuse), the crouch still
      game.carry.set('log');
      shiftHeld(t0, SHIFT_HOLD + 100); t0 += 2000; check(!p().pose, `sat down with a log: ${poseNow()}`);
      game.carry.set(null);
      // The tip of the minimal HUD, once, through t()
      check(t('hud.tip.posture') !== 'hud.tip.posture', 'the posture tip has no text');
    } finally { clearKeys(); game.carry.set?.(null); Object.assign(p(), { pose: null, crouch: false, mount: false, boat: false }); I.slots.splice(0, I.slots.length, ...kept); I.changed(); needsBase(); }
  });
  await test('posture (english): taps go by the events own times, key repeat is no other key, a refused posture keeps the gait', async () => {
    const busy = ms => { const end = performance.now() + ms; while (performance.now() < end) { /* (a long frame) */ } };
    const ev = (code, type, more = {}) => new KeyboardEvent(type, { code, key: code.startsWith('Shift') ? 'Shift' : code.slice(3).toLowerCase(), bubbles: true, ...more });
    try {
      clearKeys(); needsBase(); await goTo(game, 21, 26); Object.assign(p(), { pose: null, crouch: false });
      // A 90 ms tap whose keyup is handled 450 ms late (a long frame between them): still a tap
      keyEv('ShiftLeft', 'keydown'); busy(90); const up = ev('ShiftLeft', 'keyup'); busy(450); dispatchEvent(up);
      check(poseNow() === 'crouch', `a tap handled late: ${poseNow()}`);
      // The same, with the hold's timer firing late before the keyup is read: it waits, and the keyup decides
      p().crouch = false; await sleep(50);
      keyEv('ShiftLeft', 'keydown'); busy(90); const up2 = ev('ShiftLeft', 'keyup'); busy(450); await sleep(0); dispatchEvent(up2); await sleep(60);
      check(poseNow() === 'crouch', `a late timer before the keyup: ${poseNow()}`);
      // A W double tap whose second keydown is handled 400 ms late: by its own time, a jog
      clearKeys(); p().crouch = false;
      keyEv('KeyW', 'keydown'); busy(60); keyEv('KeyW', 'keyup'); const w2 = ev('KeyW', 'keydown'); busy(400); dispatchEvent(w2);
      check(tier() === 1, `a second press handled late: tier ${tier()}`); keyEv('KeyW', 'keyup'); clearKeys(); await frames(5);
      // W held with key repeat, then a Shift tap: it crouches (the repeats are not another key); a real other key still is
      keyEv('KeyW', 'keydown'); keyEv('ShiftLeft', 'keydown'); for (let i = 0; i < 4; i++) keyEv('KeyW', 'keydown', { repeat: true }); keyEv('ShiftLeft', 'keyup');
      check(p().crouch, `a Shift tap with W repeating: ${poseNow()}`); keyEv('KeyW', 'keyup'); p().crouch = false; await frames(5);
      keyEv('ShiftLeft', 'keydown'); keyEv('KeyD', 'keydown'); keyEv('KeyD', 'keyup'); keyEv('ShiftLeft', 'keyup');
      check(poseNow() === 'stand', `Shift with D pressed meanwhile: ${poseNow()}`); clearKeys(); await frames(5);
      // A hold while sprinting changes no posture (moving): the sprint goes on; riding, a tap keeps the gallop
      let t0 = performance.now() - 7e5;
      keys.up = true; tapW(t0); tapW(t0 + 150); pressW(t0 + 300); shiftHeld(t0 + 400, SHIFT_HOLD + 100);
      check(poseNow() === 'stand' && tier() === 2, `a hold while sprinting: ${poseNow()}, tier ${tier()}`); releaseW(t0 + 1500); t0 += 4000;
      p().mount = true; tapW(t0); tapW(t0 + 150); pressW(t0 + 300); shiftHeld(t0 + 400, 80);
      check(tier() === 2 && !p().crouch, `a tap at the gallop: tier ${tier()}, crouch ${p().crouch}`); releaseW(t0 + 1500); t0 += 4000;
      p().mount = false; keys.up = false;
      // The map's fast move is its own key: closing the map with Shift held leaves no jog behind
      keys.mapFast = true; keyEv('ShiftLeft', 'keyup'); check(!keys.mapFast && !keys.run && tier() === 0, `after the map: mapFast ${keys.mapFast}, run ${keys.run}`);
    } finally { Object.assign(p(), { mount: false, crouch: false, pose: null }); clearKeys(); await frames(10); }
  });
  await test('posture (english): swimming, a Shift hold dives and a tap does nothing', async () => {
    try {
      needsBase(); const S = sea(); await swimAt(...S.deep);
      let t0 = performance.now() - 9e5;
      pressShift(t0); check(keys.dive, 'Shift held does not dive'); shiftTick(t0 + SHIFT_HOLD + 50); check(keys.dive && !p().pose && !p().crouch, `the hold swimming: dive ${keys.dive}, ${poseNow()}`);
      releaseShift(t0 + 900); check(!keys.dive && !p().pose && !p().crouch, `let go: ${poseNow()}`); t0 += 2000;
      keys.run = keys.sprint = true; shiftHeld(t0, 80); check(!p().pose && !p().crouch && keys.sprint, `a tap swimming: ${poseNow()}, sprint ${keys.sprint}`);
    } finally { clearKeys(); needsBase(); await goTo(game, 21, 26); }
  });
  // ---------- letting go of W stops, at any speed and on anything (entities.js STOP_SWIM; input.js releaseMoves) ----------
  const speedNow = () => Math.hypot(p().vx, p().vy);
  // Moving at the tier k with real W events (tier 0 one press, 1 tap and press, 2 two taps and press), then let go:
  // the speed and the way gone 0.3 s and 0.6 s later
  const letGoOfW = async (k, n = 40) => {
    clearKeys();
    for (let i = 0; i < k; i++) { keyEv('KeyW', 'keydown'); keyEv('KeyW', 'keyup'); }
    keyEv('KeyW', 'keydown'); await frames(n);
    const v0 = speedNow(), x0 = p().x, y0 = p().y, tier = gaitOf(keys), gait = p().gait;
    keyEv('KeyW', 'keyup'); await frames(18); const v1 = speedNow(); await frames(18);
    return { v0, v1, v2: speedNow(), way: Math.hypot(p().x - x0, p().y - y0), tier, gait };
  };
  const stopped = (r, what, v1 = 0.3, way = 0.8, v2 = 0.02) => check(r.v0 > 1 && r.v1 < v1 && r.v2 < v2 && r.way < way && !keys.up && !keys.run && !keys.sprint, `${what}: ${JSON.stringify(r)}`);
  await test('stop (english): on foot, letting go of W stops at walk, jog and sprint', async () => {
    const I = inv(), kept = I.slots.slice();
    try {
      needsBase(); I.slots.fill(null); I.changed(); await goTo(game, 21, 26);
      for (let k = 0; k < 3; k++) { const r = await letGoOfW(k); check(r.tier === k, `tier ${r.tier}, wanted ${k}`); stopped(r, `on foot, tier ${k}`); await goTo(game, 21, 26); }
      // S, A and D still move while held, and stop too
      keys.down = true; await frames(40); check(speedNow() > 2, `S does not move: ${speedNow()}`); keyEv('KeyS', 'keyup'); await frames(30); check(speedNow() < 0.02 && !keys.down, `S let go: ${speedNow()}`);
      keys.left = true; await frames(40); check(speedNow() > 2, `A does not move: ${speedNow()}`); keyEv('KeyA', 'keyup'); await frames(30); check(speedNow() < 0.02, `A let go: ${speedNow()}`);
      // Cmd (macOS sends no keyup for W let go while Cmd is down): letting go of Cmd lets go of W
      clearKeys(); keyEv('KeyW', 'keydown'); keyEv('KeyW', 'keyup'); keyEv('KeyW', 'keydown'); keyEv('MetaLeft', 'keydown', { metaKey: true }); keyEv('MetaLeft', 'keyup');
      check(!keys.up && !keys.run && gaitOf(keys) === 0, `W stuck after Cmd: up ${keys.up}, tier ${gaitOf(keys)}`);
      await frames(30); check(speedNow() < 0.02, `still going after Cmd: ${speedNow()}`);
    } finally { clearKeys(); I.slots.splice(0, I.slots.length, ...kept); I.changed(); needsBase(); await goTo(game, 21, 26); }
  });
  await test('stop (english): riding, letting go of W stops at walk, trot and gallop', async () => {
    try {
      needsBase(); await goTo(game, 21, 26); p().mount = true; await frames(2);
      for (let k = 0; k < 3; k++) { const r = await letGoOfW(k); stopped(r, `riding, tier ${k}`, 0.3, 0.9); p().x = 21; p().y = 26; await frames(2); }
    } finally { clearKeys(); p().mount = false; needsBase(); await goTo(game, 21, 26); }
  });
  await test('stop (english): rowing, letting go of W stops the boat', async () => {
    try {
      needsBase(); await goTo(game, 21, 26); p().boat = true; await frames(2);
      // (on land the boat does not move, but the stroke asks for the speed: vx and vy are the boat's)
      for (let k = 0; k < 3; k++) { const r = await letGoOfW(k); check(r.v0 > 1 && r.v1 < 0.3 && r.v2 < 0.02 && !keys.up, `rowing, tier ${k}: ${JSON.stringify(r)}`); }
    } finally { clearKeys(); p().boat = false; needsBase(); await goTo(game, 21, 26); }
  });
  await test('stop (english): swimming, letting go of W stops in under half a second', async () => {
    const I = inv(), kept = I.slots.slice();
    try {
      needsBase(); I.slots.fill(null); I.changed(); const S = sea(); await swimAt(...S.deep);   // (empty-handed: a load left by an earlier test slows the swim)
      for (let k = 0; k < 3; k++) {
        const r = await letGoOfW(k, 150); stopped(r, `swimming, tier ${k}`, 0.35, 0.7, 0.05);
        await swimAt(...S.deep);
      }
    } finally { clearKeys(); needsBase(); I.slots.splice(0, I.slots.length, ...kept); I.changed(); await goTo(game, 21, 26); }
  });
  await test('stop (english): pushing the wheelbarrow, letting go of W stops it', async () => {
    await weightOn();
    const [tx, ty] = openGround(); await goTo(game, tx + 0.5, ty + 3.5);
    try {
      const o = placeBarrow(tx, ty); pushIt(o);
      check(p().pushing, 'not pushing');
      const r = await letGoOfW(2, 90); check(r.tier === 2 && r.gait === 0, `pushing, the taps still walk: ${JSON.stringify(r)}`); stopped(r, 'pushing', 0.3, 0.6);
    } finally { clearKeys(); letGo(); const z = parkedNear(tx + 0.5, ty + 0.5, 5); if (z) w().setTile(...z.tile, 'air'); await goTo(game, 21, 26); }
  });
  await test('needs (english): rest caps stamina', async () => {
    try {
      needsBase();
      N().rest = 20; check(Math.abs(N().cap - 64) < 1e-9, `cap at rest 20: ${N().cap}`);
      N().rest = 60; check(N().cap === 100, `cap at rest 60: ${N().cap}`);
      N().rest = 20; N().stamina = 100; N().update(0.1); check(N().stamina <= 64, `the stamina is over its cap: ${N().stamina}`);
      p().pose = { kind: 'lie', yaw: 0, h: 0 }; N().update(60); const bed = N().rest - 20;
      N().rest = 20; p().pose = { kind: 'sit', yaw: 0, h: 0 }; N().update(60); const seat = N().rest - 20;
      check(Math.abs(bed - 12.5) < 0.1 && seat > 0 && seat < bed / 3, `a minute in bed ${bed}, seated ${seat}`);
      p().pose = null; N().rest = 50; N().update(60); check(N().rest < 50, 'awake, rest does not fall');
    } finally { p().pose = null; needsBase(); }
  });
  await test('needs (english): sleep restores rest', async () => {
    const spy = told(), St = game.steps, stepWas = St.i, live = game.live, was = { joined: live.joined, net: live.net, T: { ...live.timers }, lastSent: live.lastSent, sent: live.sent };
    try {
      needsBase(); St.i = STEPS.length;   // (the first steps' "try your bed" lets you nap any time: not here)
      const H = game.houseRect(), bed = w().placedNear((H.x0 + H.x1) / 2, (H.y0 + H.y1) / 2, 16).find(o => o.placed === 'cama'); check(bed, 'no bed');
      await goTo(game, bed.x + 1.2, bed.y + 1.2);
      // At night: a mob within 8 refuses; without it, rest 100, "well rested", lying, zz, and fed to 14 at least
      runCommand(game, '/time set 23:00', say0);
      const limo = game.mobs.summon('limo', p().x + 3, p().y);
      N().rest = 40; check(await N().sleep(bed) === false && spy.out.includes(t('needs.sleep.mobs')) && N().rest === 40, 'a creature nearby does not stop sleeping');
      game.mobs.remove(limo); game.mobs.clearNear(p().x, p().y, 30);
      Cb().hunger = 3;
      check(await N().sleep(bed) === true, 'does not sleep at night');
      check(N().rest === 100 && N().rested > Date.now() && p().pose?.kind === 'lie' && p().sleeping && Cb().hunger >= 14, `asleep: rest ${N().rest}, pose ${p().pose?.kind}, hunger ${Cb().hunger}`);
      // (what the others are told: zz only lying in bed)
      const sent = [];
      live.joined = true; live.net = new Proxy({ ready: true, key: 1, send: m => sent.push(m) }, { get: (o, k) => (k in o ? o[k] : () => {}) });
      const st = () => { for (const k in live.timers) live.timers[k] = -1e9; live.lastSent = null; sent.length = 0; live.tick(1); return sent.find(m => m.t === 'st'); };
      check(st()?.zz === 1, 'zz is not sent in bed');
      game.rest.stand(); check(!p().sleeping, 'standing up does not wake');
      p().sleeping = true; check(st()?.zz === undefined, 'zz is sent without lying'); p().sleeping = false;
      live.joined = was.joined; live.net = was.net; Object.assign(live.timers, was.T);
      // By day: a nap adds 40; a second within the hour is refused; rested, not sleepy
      runCommand(game, '/time set 12:00', say0);
      N().rest = 30; N().napAt = 0;
      check(await N().sleep(bed) === true && Math.abs(N().rest - 70) < 0.5, `the nap: rest ${N().rest}`);
      game.rest.stand(); N().rest = 30;
      check(await N().sleep(bed) === false && spy.out.includes(t('needs.sleep.cant_nap')), `a second nap: ${spy.out.slice(-2)}`);
      N().napAt = 0; N().rest = 95;
      check(await N().sleep(bed) === false && spy.out.includes(t('needs.sleep.not_tired')), 'rested, sleepy by day');
    } finally {
      spy.undo(); St.i = stepWas; live.joined = was.joined; live.net = was.net; Object.assign(live.timers, was.T); live.lastSent = was.lastSent; live.sent = was.sent;
      if (p().pose) game.rest.stand(); runCommand(game, '/time reset', say0); needsBase(); await goTo(game, 21, 26);
    }
  });
  await test('needs (english): death refills', async () => {
    const kept = game.rules.keepInventory;
    try {
      needsBase(); game.rules.keepInventory = true;
      Object.assign(N(), { thirst: 2, stamina: 3, exhausted: true, rest: 10, air: 1 }); p().sleeping = true;
      await Cb().die('test');
      check(N().thirst === 20 && N().stamina === N().cap && !N().exhausted && N().air === N().airMax && N().rest >= 50 && !p().sleeping, `after dying: thirst ${N().thirst}, stamina ${N().stamina}, air ${N().air}, rest ${N().rest}, asleep ${p().sleeping}`);
    } finally { game.rules.keepInventory = kept; game.busy = false; needsBase(); await goTo(game, 21, 26); }
  });
  await test('dive (english): air drains under water', async () => {
    const Sk = game.skills, xpWas = Sk.xp.diving, hid = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    const under = () => Object.assign(p(), { swim: true, sink: 0.5, dive: 1 });
    try {
      needsBase(); under();
      check(p().headUnder && N().headUnder, 'with the head under, headUnder is false');
      N().update(1); check(Math.abs(N().air - 29) < 1e-6, `a second under: air ${N().air}`);
      p().dive = 0; p().sink = 0; N().update(0.5); check(N().air === N().airMax, `surfacing does not refill: ${N().air}`);
      // At 0: drowning ticks every second, floored like hunger (normal: down to 1, then up to the surface)
      under(); N().air = 0; Cb().hp = 10;
      for (let i = 0; i < 3; i++) N().update(1.01);
      check(Cb().hp === 4, `normal: 3 s at air 0 leave ${Cb().hp}`);
      Cb().hp = 1; N().update(1.01); check(Cb().hp === 1 && p().forceRise, `normal kills or does not push up: ${Cb().hp}, ${p().forceRise}`);
      // Peaceful: no damage, pushed up at once
      needsBase(); under(); game.difficulty = 'peaceful'; N().air = 0; N().update(1.01);
      check(Cb().hp === 20 && p().forceRise, `peaceful: ${Cb().hp}, rise ${p().forceRise}`);
      // A hidden tab: nothing drains
      needsBase(); under(); Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
      N().update(2); check(N().air === N().airMax, `the hidden tab drains: ${N().air}`);
      delete document.hidden; if (!hid) check(false, 'no document.hidden');
      // Creative: full; the diving skill gives more air
      runCommand(game, '/gamemode creative', say0); under(); N().air = 5; N().update(1); check(N().air === N().airMax, `creative: ${N().air}`);
      runCommand(game, '/gamemode survival', say0);
      const base = N().airMax; Sk.xp.diving = 1e7; check(N().airMax === base + 20 && Sk.level('diving') === 10, `level ${Sk.level('diving')}: air ${N().airMax}`);
    } finally { delete document.hidden; if (xpWas === undefined) delete Sk.xp.diving; else Sk.xp.diving = xpWas; needsBase(); }
  });
  await test('dive (english): shift dives space rises', async () => {
    const S = sea(), press = (code, type) => dispatchEvent(new KeyboardEvent(type, { code, key: 'Shift', bubbles: true }));
    try {
      needsBase(); await swimAt(...S.deep);
      const d = w().waterDepth(p().x, p().y), room = d - 1 - 0.55;
      check(d > 6, `the deep spot is ${d} m deep`);
      keys.dive = true; await frames(60);
      check(p().dive > 0.5 && p().headUnder, `a second of Shift: dive ${p().dive}`);
      await frames(60 * 12); check(p().dive <= room + 1e-6 && p().dive > room - 0.3, `holding Shift, dive ${p().dive} (the bed lets ${room})`);
      keys.dive = false;
      // (S is still backwards, not up: keys.down is not keys.dive)
      keys.down = true; const dv = p().dive; await frames(30); keys.down = false; check(p().dive > dv - 0.2, `S comes up: ${dv} → ${p().dive}`);
      const d0 = p().dive; await frames(120); const drift = (d0 - p().dive) / 2;
      check(drift > 0.1 && drift < 0.2, `nothing held drifts up at ${drift} m/s`);
      // The jump out at the shore only at the surface
      p().shore = true; p().jump(); check(p().swim, 'jumped out from depth');
      keys.space = true; await until(() => !p().dive && !p().headUnder, 15000, 'coming up'); keys.space = false;
      check(!p().headUnder, 'up, the head is still under');
      // A Shift tap while swimming neither crouches nor stops a fast swim
      keys.up = true; keys.run = keys.sprint = true; await frames(6);
      const fast = p().fastSwim; check(fast || p().noSprint || N().exhausted, `W W W held does not swim fast: gait ${p().gait}`);
      press('ShiftLeft', 'keydown'); check(keys.dive, 'Shift does not dive'); press('ShiftLeft', 'keyup'); await frames(3);
      check(keys.run && keys.sprint && p().fastSwim === fast && !keys.dive && !p().crouch, `a Shift tap: run ${keys.run}, sprint ${keys.sprint}, fast ${p().fastSwim}, crouch ${p().crouch}`);
      keys.up = keys.run = keys.sprint = false;
    } finally { clearKeys(); needsBase(); await goTo(game, 21, 26); }
  });
  await test('dive (english): swimming E reaches finds', async () => {
    const S = sea(), was = game.mouse;
    try {
      needsBase(); check(S.shell, 'no deep find near the deep sea');
      const { o } = S.shell;
      await swimAt(o.x + 0.6, o.y);
      p().dive = diveFor(o.bed); draw(); draw();
      check(p().headUnder, `not under at the depth of the ${o.kind}`);
      const bed = game.view3d.bedY(o.x, o.y);
      aimAbs(o.x, (Number.isFinite(bed) ? bed : o.bed) + 0.1, o.y);
      const said = t(o.kind === 'oyster' ? 'dive.open_oyster' : 'dive.cut_seaweed'), act = game.nearest(); check(act?.text === said, `aimed at the ${o.kind} it says: ${act?.text}`);
      draw(); check(game.highlight?.find === o.key, `highlighted: ${game.highlight?.kind} ${game.highlight?.find}`);
      // Without a mouse: the nearest find
      game.mouse = null; check(game.nearest()?.text === said, 'without a mouse the find is not offered');
      // No boat from the bottom
      check(!game.crew.canRow(p(), w()), 'a boat is offered at depth');
    } finally { game.mouse = was; game.highlight = null; needsBase(); await goTo(game, 21, 26); }
  });
  await test('dive (english): deep sea exists', async () => {
    const G = w().gen, S = sea();
    check(RELIEF_V === 2, `RELIEF_V ${RELIEF_V}`);
    check(G.groundAt(...S.deep) < -9 && G.groundAt(S.deep[0], S.deep[1]) < -6, `the deep sea is at ${G.groundAt(...S.deep)}`);
    // A river's centre is as before (about -2.2 or more), and the village ground is 0
    let river = null;
    for (let r = 40; r < 500 && !river; r += 3) for (let a = 0, n = Math.ceil(r * 6.283 / 3); a < n; a++) {
      const x = 21 + Math.cos(a / n * 6.283) * r, y = 26 + Math.sin(a / n * 6.283) * r;
      if (w().water(x, y) && game.fishing.waterType(x, y) === 'rio' && w().water(x + 1, y) && w().water(x - 1, y)) { river = [x, y]; break; }
    }
    check(river, 'no river');
    check(G.groundAt(...river) >= -2.6, `a river is ${G.groundAt(...river)} deep`);
  });
  await test('dive (english): finds are deterministic and apart', async () => {
    const S = sea(), G = w().gen, G2 = new WorldGen(G.seed), { cx, cy } = S.shell;
    const a = G.seabed(cx, cy).finds, b = G2.seabed(cx, cy).finds;
    check(a.length && JSON.stringify(a.map(o => o.key)) === JSON.stringify(b.map(o => o.key)), 'two generators give other finds');
    check(a.every(o => Number.isFinite(o.bed) && o.key.startsWith(o.kind + ':')), 'a find without its bed or key');
    check(new Set(a.map(o => o.key.split(':')[1])).size === a.length, 'two finds on one tile');
    const kinds = new Set(['seashell', 'seaweed', 'oyster', 'mussel', 'sunken_chest']);
    check(!G.content(cx, cy).objects.some(o => kinds.has(o.kind)), 'content holds finds');
    check(!w().harvestablesNear(S.shell.o.x, S.shell.o.y).some(o => kinds.has(o.kind)), 'harvestablesNear gives finds');
  });
  await test('dive (english): reach is vertical', async () => {
    const S = sea();
    try {
      needsBase(); const { o } = S.shell;
      await swimAt(o.x + 0.5, o.y);
      check(!game.dive.reachable(p()).some(f => f.o.key === o.key), `a find ${o.bed} m down is reached from the surface`);
      p().dive = diveFor(o.bed);
      check(game.dive.reachable(p()).some(f => f.o.key === o.key), `at its depth the ${o.kind} is not reached`);
    } finally { needsBase(); await goTo(game, 21, 26); }
  });
  await test('dive (english): chest alone opens at once', async () => {
    const S = sea(), spy = told();
    let d = null;
    try {
      needsBase(); check(S.chest, 'no sunken chest near the deep sea');
      const { o, cx, cy } = S.chest, money = game.money, xp = game.skills.xp.diving || 0;
      await swimAt(o.x + 0.6, o.y);
      p().dive = diveFor(o.bed);
      const f = game.dive.reachable(p()).find(q => q.o.key === o.key); check(f, 'the chest is not in reach at its depth');
      game.dive.take(f);
      d = w().delta(cx, cy);
      check(d?.opened?.[o.key] === Profile.id && game.money > money && (game.skills.xp.diving || 0) > xp, `opened by ${d?.opened?.[o.key]}, money ${money} → ${game.money}`);
      check(!game.dive.reachable(p()).some(q => q.o.key === o.key), 'an open chest is offered again');
      await frames(480);
      check(!spy.out.includes(t('dive.too_late')), '"too late" after opening it alone');
    } finally { spy.undo(); if (d?.opened && S.chest) delete d.opened[S.chest.o.key]; needsBase(); await goTo(game, 21, 26); }
  });
  await test('red (net): dv and zz optional', async () => {
    const live = game.live;
    try {
      live.receive('dv1', { t: 'hi', id: 'id-dv1', name: 'Buzo', playing: true, look: LOOK });
      live.receive('dv1', { t: 'st', sc: 'world', x: p().x + 2, y: p().y, yaw: 0, na: 1, hu: 0.3 });
      const e = live.peers.get('dv1').entity;
      for (let i = 0; i < 30; i++) e.update(1 / 30, w());
      check(e.dive === 0 && !e.sleeping && !e.headUnder, `without dv/zz: dive ${e.dive}, asleep ${e.sleeping}`);
      live.receive('dv1', { t: 'st', sc: 'world', x: p().x + 2, y: p().y, yaw: 0, na: 1, hu: 0.5, dv: 5, zz: 1 });
      e.update(1 / 30, w()); check(e.dive > 0 && e.dive < 5 && e.sleeping, `smoothed: ${e.dive}`);
      for (let i = 0; i < 120; i++) e.update(1 / 30, w());
      check(Math.abs(e.dive - 5) < 0.05 && e.headUnder, `dv 5 gives ${e.dive}`);
      live.receive('dv1', { t: 'st', sc: 'world', x: p().x + 2, y: p().y, yaw: 0, na: 1, hu: 0.5, dv: 999 }); check(e.diveTo === 30, `dv is not clamped: ${e.diveTo}`);
      live.receive('dv1', { t: 'st', sc: 'world', x: p().x + 2, y: p().y, yaw: 0, dv: 4 }); check(e.diveTo === 0, 'dv without swimming');
    } finally { live.peers.delete('dv1'); draw(); }
  });
  await test('hud (english): bars in place', async () => {
    const $ = id => document.getElementById(id), on = id => $('nd-' + id).classList.contains('nd-on');
    const box = id => $(id).getBoundingClientRect(), cross = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const r4 = b => [b.left, b.top, b.right, b.bottom].map(Math.round).join(',');
    // Where they are (after the rows' and the clock's .2 s slide): the bars in the top-left corner and the clock under
    // the last bar in sight (or under the body chip, when it shows: it goes right under the bars, ui/bodychip.js), the
    // minimap in the bottom-left corner and the chat over it, none over another
    const places = async (what, last) => {
      for (let i = 0; i < 4; i++) { draw(); await sleep(120); }
      const n = box('needs'), c = box('clockp'), m = box('minimap'), ch = box('chat'), b = last && box('nd-' + last);
      const k = $('body-chip')?.classList.contains('on') && box('body-chip'), u = k || b;   // (u: what the clock goes under)
      check(n.left <= 20 && n.top <= 20 && n.width >= 240, `${what}: the bars at ${r4(n)}`);
      if (b) check(b.top <= 40 + (last === 'hp' ? 0 : 60) && !cross(n, c), `${what}: the clock at ${r4(c)}, its last bar at ${r4(b)}`);
      if (k) check(k.left <= 20 && (b ? k.top >= b.bottom + 4 && k.top <= b.bottom + 12 : k.top <= 20) && !cross(n, k) && !cross(k, c), `${what}: the body chip at ${r4(k)}, the bars at ${r4(n)}, the clock at ${r4(c)}`);
      if (u) check(c.top >= u.bottom + 4 && c.top <= u.bottom + 12, `${what}: the clock at ${r4(c)}, under ${k ? 'the body chip' : 'its last bar'} at ${r4(u)}`);
      else check(c.top <= 20, `${what}: no bar in sight and the clock at ${r4(c)}`);
      if (m.width) check(m.left <= 20 && innerHeight - m.bottom >= 12 && innerHeight - m.bottom <= 20 && !cross(n, m), `${what}: the minimap at ${r4(m)}`);
      if (m.width && ch.width) check(ch.bottom <= m.top, `${what}: the chat at ${r4(ch)} over the minimap at ${r4(m)}`);
    };
    try {
      needsBase(); useSmartHud(game, false); await goTo(game, 21, 26);
      check($('needs') && !$('hearts') && !$('hunger') && !$('hud-keys'), 'the strip, or the hearts, drumsticks or keys card are there');
      // The full interface: every row but air
      draw(); draw();
      check(['hp', 'food', 'water', 'en'].every(on) && !on('air'), `full: ${['hp', 'food', 'water', 'en', 'air'].filter(on)}`);
      await places('full', 'en');
      // A window on the left: under the bars, never over them
      game.windows.open('s-inv'); draw();
      check(!cross(box('s-inv'), box('needs')) && box('s-inv').left <= 20, `full: the inventory at ${r4(box('s-inv'))}, the bars at ${r4(box('needs'))}`);
      game.windows.close('s-inv'); draw();
      // The minimal one: the xp in its status block; health after a hit, gone after 5.5 s; a short sprint no energy
      useSmartHud(game, true); await frames(2); draw(); draw();
      check($('xp').parentNode.id === 'hud-status' && $('needs').parentNode === document.body, 'minimal: the parts are not in place');
      check(!['hp', 'food', 'water', 'en', 'air'].some(on), `minimal, nothing happening: ${['hp', 'food', 'water', 'en', 'air'].filter(on)}`);
      await places('minimal, nothing in sight', null);
      Cb().hp = 16; draw(); draw(); check(on('hp'), 'minimal: a hit does not show the health');
      await places('minimal, health', 'hp');
      const t0 = performance.now(); while (performance.now() - t0 < 5600) { draw(); await sleep(250); }
      check(!on('hp'), 'minimal: the health stays after 5.5 s');
      N().stamina = 75; draw(); draw(); check(!on('en'), 'minimal: a 5 s sprint shows the energy');
      N().stamina = 30; draw(); draw(); check(on('en'), 'minimal: a long sprint does not show the energy');
      // (energy alone: packed up into the corner, with the clock right under it)
      await sleep(700); await places('minimal, energy alone', 'en');
      check(box('nd-en').top <= 20, `minimal: energy alone is not in the corner, at ${r4(box('nd-en'))}`);
      // A hot swap: nothing left on
      N().stamina = 100; useSmartHud(game, false); draw(); useSmartHud(game, true); draw(); draw();
      check(!['hp', 'food', 'water', 'en', 'air'].some(on), `after a swap, on: ${['hp', 'food', 'water', 'en', 'air'].filter(on)}`);
      // Tab: the legend with the bars (and no keys card)
      game.smartHud.hold(true); draw(); draw();
      check(!$('hud-keys') && $('nd-legend').textContent.includes(t('hud.need.thirst')), `Tab's legend: ${$('nd-legend').textContent}`);
      game.smartHud.hold(false);
    } finally { useSmartHud(game, false); needsBase(); draw(); }
  });
  // ---------- the marked route and the dynamic music (docs/planes/gta/PLAN-J-ruta-musica.md §10) ----------
  const R = () => game.route;
  // A synthetic cost grid (× 10, 255 blocked) of gw × gh tiles, blocked outside
  const grid = (gw, gh, f) => { const a = new Uint8Array(gw * gh); for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) a[y * gw + x] = f(x, y); return (x, y) => (x < 0 || y < 0 || x >= gw || y >= gh ? 255 : a[y * gw + x]); };
  // The points of a path sampled every quarter tile (as [x, y] pairs), and how far it strays from the straight line a → b
  const along = (pts, step = 0.25) => { const out = []; for (let i = 2; i < pts.length; i += 2) { const ax = pts[i - 2], ay = pts[i - 1], bx = pts[i], by = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step)); for (let k = i === 2 ? 0 : 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]); } return out; };
  const stray = (pts, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1; let m = 0; for (let i = 0; i < pts.length; i += 2) m = Math.max(m, Math.abs((pts[i] - a.x) * dy - (pts[i + 1] - a.y) * dx) / L); return m; };
  // (no tile of the path is blocked, but its two ends: the goal may sit on one)
  const clearOf = (r, c) => along(r.pts).slice(1, -1).every(([x, y]) => c(Math.floor(x), Math.floor(y)) !== 255);
  // A route worker of our own (the one route.js makes, spoken to directly): ask(msg) → its 'path' answer; 'need' is
  // answered with no masks (the untouched world) unless maskOf(key) gives one
  const routeWorker = (maskOf = null) => {
    const wk = new Worker(new URL('./world/routeworker.js?v=' + encodeURIComponent(GAME_VERSION), import.meta.url), { type: 'module' });
    const waiting = new Map();
    let id = 0;
    wk.onmessage = e => {
      const m = e.data;
      if (m.t === 'need') wk.postMessage({ t: 'masks', id: m.id, masks: maskOf ? m.chunks.map(k => { const v = maskOf(k); return v ? [k, 0, v] : [k, -1, null]; }) : [] });
      else if (m.t === 'path') waiting.get(m.id)?.(m);
    };
    wk.postMessage({ t: 'init', seed: w().seed, projects: getProjects(), family: familyHouse() });
    return {
      ask: msg => new Promise((res, rej) => { const i = ++id; const tm = setTimeout(() => rej(new Error('the route worker does not answer')), 30000); waiting.set(i, m => { clearTimeout(tm); res(m); }); wk.postMessage({ t: 'route', id: i, mode: 'walk', explored: [], ...msg }); }),
      end: () => wk.terminate(),
    };
  };
  // The explored keys of the box of a and b plus m chunks (all of them: as if the player had been everywhere there)
  const boxKeys = (a, b, m = 2) => { const out = []; for (let cy = Math.floor(Math.min(a.y, b.y) / CHUNK) - m; cy <= Math.floor(Math.max(a.y, b.y) / CHUNK) + m; cy++) for (let cx = Math.floor(Math.min(a.x, b.x) / CHUNK) - m; cx <= Math.floor(Math.max(a.x, b.x) / CHUNK) + m; cx++) out.push(`${cx},${cy}`); return out; };
  // Waits for the route's search: ready or straight
  const routed = async (ms = 20000) => { await until(() => R().state === 'ready' || R().state === 'straight', ms, 'the route search'); return R().state; };
  // Real time passing while the game steps (route.js and the ribbon run on real seconds)
  const realWait = async ms => { const t0 = performance.now(); while (performance.now() - t0 < ms) { await frames(2); await sleep(25); } };
  const keyM = () => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true, cancelable: true }));

  await test('route (english): costs and modes', async () => {
    try {
      // A road detour: a wall across a swamp, a cheap road round its end
      let c = grid(100, 60, (x, y) => (y === 30 && x > 5 ? 255 : x <= 5 ? 6 : 22));
      let r = findPath(c, { x: 50, y: 10 }, { x: 50, y: 50 });
      check(r.ok && clearOf(r, c), `the detour: ${r.why}, or a blocked tile on it`);
      check(Math.min(...along(r.pts).map(q => q[0])) < 6.5, 'the detour does not take the road');
      // A road cheaper than the straight way through a forest is taken, and its points say road
      c = grid(80, 30, (x, y) => (y === 16 ? 6 : 15));
      r = findPath(c, { x: 5, y: 10 }, { x: 70, y: 10 }, { kindAt: (x, y) => (y === 16 ? RKIND.road : RKIND.land) });
      const onRoad = along(r.pts).filter(([, y]) => Math.floor(y) === 16).length / along(r.pts).length;
      check(r.ok && onRoad > 0.6 && r.kinds.includes(RKIND.road), `the road: ${(onRoad * 100).toFixed(0)}% on it`);
      // The ends are exact, the steps continuous (no NaN, each segment clear)
      check(r.pts[0] === 5 && r.pts[1] === 10 && r.pts[r.pts.length - 2] === 70 && r.pts.every(Number.isFinite), 'the ends are not exact');
      // A lake: walking swims only when it is much shorter; riding goes round; nothing at all cuts a corner
      const lake = sw => grid(200, 120, (x, y) => (Math.hypot(x - 100, y - 60) < 40 ? sw : 10));
      r = findPath(lake(90), { x: 50, y: 60 }, { x: 150, y: 60 });
      check(r.ok && r.len > 110, `walking swims across the lake: ${r.len.toFixed(1)}`);
      const river = sw => grid(200, 300, (x, y) => (x >= 100 && x < 102 ? (y > 290 ? 10 : sw) : 10));   // (a river 2 wide, a ford at its far end)
      r = findPath(river(90), { x: 60, y: 20 }, { x: 140, y: 20 }, { kindAt: (x, y) => (x >= 100 && x < 102 && y <= 290 ? RKIND.swim : RKIND.land) });
      check(r.ok && r.len < 90 && r.kinds.includes(RKIND.swim), `walking does not swim a narrow river: ${r.len.toFixed(1)}`);
      r = findPath(river(255), { x: 60, y: 20 }, { x: 140, y: 20 });
      check(r.ok && r.len > 500, `riding crosses deep water: ${r.len.toFixed(1)}`);
      // Rowing: water costs 1, land 6: it rows to the shore nearest an inland pin and walks only from there
      c = grid(120, 100, (x, y) => (y < 50 ? 10 : 60));
      r = findPath(c, { x: 10, y: 10 }, { x: 80, y: 70 }, { kindAt: (x, y) => (y < 50 ? RKIND.swim : RKIND.land) });   // (as combine marks them: a kind change is always a point)
      const land = along(r.pts).filter(([, y]) => y >= 50), landAt = land[0];
      check(r.ok && landAt && landAt[0] > 70 && land.length * 0.25 < 26, `rowing lands at x ${landAt?.[0].toFixed(1)}, ${(land.length * 0.25).toFixed(1)} tiles on land`);
      // No path at all: the straight line, both points unknown
      r = findPath(grid(50, 50, x => (x === 25 ? 255 : 10)), { x: 1, y: 1 }, { x: 40, y: 40 });
      check(!r.ok && r.why === 'nopath' && r.pts.length === 4 && r.kinds[0] === RKIND.unknown, `no path: ${r.why}`);
    } finally { releasePool(); }
  });

  await test('route (english): explored only, seam, poles', async () => {
    const wk = routeWorker();
    try {
      // A lake near the village (the same gen for everyone): seen, the way goes round it; not seen, straight across
      const G = w().gen, W = w();
      let spot = null;
      for (let r = 40; r < 1500 && !spot; r += 6) for (let a = 0, n = Math.ceil(r * 6.283 / 6); a < n && !spot; a++) {
        const x = Math.floor(21 + Math.cos(a / n * 6.283) * r) + 0.5, y = Math.floor(26 + Math.sin(a / n * 6.283) * r) + 0.5;
        if (G.biomeAt(x, y) !== B.LAKE || !W.water(x, y)) continue;
        let x0 = x, x1 = x;
        while (W.water(x0 - 1, y) && x - x0 < 200) x0--;
        while (W.water(x1 + 1, y) && x1 - x < 200) x1++;
        if (x1 - x0 >= 10 && x1 - x0 < 150) spot = { y, x0, x1 };
      }
      check(spot, 'no lake within 1.5 km of the village');
      const from = { x: spot.x0 - 8, y: spot.y }, to = { x: spot.x1 + 8, y: spot.y };
      const wet = r => [...r.kinds].some(k => k === RKIND.swim || k === RKIND.wade);
      const seen = await wk.ask({ from, to, explored: boxKeys(from, to, 6), margin: 6 });
      console.log(`route by a lake ${spot.x1 - spot.x0} tiles wide at ${spot.x0},${spot.y}: seen ${seen.len.toFixed(1)} tiles (${seen.why}), strays ${stray(seen.pts, from, to).toFixed(1)}, kinds ${[...new Set(seen.kinds)]}`);
      check(seen.ok && (stray(seen.pts, from, to) > 2 || wet(seen)), `seen: ${seen.why}, it strays ${stray(seen.pts, from, to).toFixed(1)} tiles and knows no water`);
      const blind = await wk.ask({ from, to, explored: [], margin: 3 });
      check(stray(blind.pts, from, to) < 0.75 && !wet(blind) && [...blind.kinds].includes(RKIND.unknown), `unexplored: it strays ${stray(blind.pts, from, to).toFixed(2)} tiles, kinds ${[...blind.kinds]}`);
      // Over LIMITS.maxTiles: straight and 'far' at once
      const far = await wk.ask({ from: { x: 21, y: 26 }, to: { x: 21 + RLIMITS.maxTiles + 50, y: 26 } });
      check(!far.ok && far.why === 'far' && far.pts.length === 4, `far: ${far.why}`);
      // Across the seam: a short way (to.x is brought next to from.x)
      const seam = await wk.ask({ from: { x: PHALF - 20.5, y: 26 }, to: { x: nearX(-PHALF + 20.5, PHALF - 20.5), y: 26 } });
      check(seam.len < 60 && seam.pts.every(Number.isFinite), `across the seam: ${seam.len}`);
      // Next to the north pole: nothing goes beyond it
      const pole = await wk.ask({ from: { x: 100.5, y: NORTH + 3.5 }, to: { x: 300.5, y: NORTH + 2.5 } });
      let north = Infinity; for (let i = 1; i < pole.pts.length; i += 2) north = Math.min(north, pole.pts[i]);
      check(north >= NORTH, `beyond the pole: y ${north} < ${NORTH}`);
    } finally { wk.end(); }
    // Masks drawn by a rule (x, y → OVR bits) for the chunks that have any
    const maskBy = f => key => {
      const c = key.indexOf(','), x0 = +key.slice(0, c) * CHUNK, y0 = +key.slice(c + 1) * CHUNK, m = new Uint8Array(256).fill(ROVR.own);
      let any = false;
      for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) { const v = f(x0 + i, y0 + j); if (v) { m[j * CHUNK + i] |= v; any = true; } }
      return any ? m : null;
    };
    // A pin shut in by a 13 × 13 block: the way goes to the nearest open tile, and the last stretch to the pin is a gap
    const wk2 = routeWorker(maskBy((x, y) => (x >= 44 && x <= 56 && y >= 30 && y <= 42 ? ROVR.blocked : 0)));
    try {
      const a = { x: 50.5, y: 2.5 }, b = { x: 50.5, y: 36.5 };
      const r = await wk2.ask({ from: a, to: b, explored: boxKeys(a, b) });
      const n = r.pts.length >> 1, lx = r.pts[n * 2 - 4], ly = r.pts[n * 2 - 3];
      check(r.ok && r.cut && r.kinds[n - 1] === RKIND.unknown && r.pts[n * 2 - 2] === b.x && r.pts[n * 2 - 1] === b.y && ly < 30 && Math.hypot(lx - b.x, ly - b.y) < 9,
        `a shut-in pin: ${r.why}, cut ${r.cut}, the way ends at ${lx},${ly}`);
    } finally { wk2.end(); }
    // A pin in a pocket (open inside, a ring of walls round it, as a cave's mouth): the way to the nearest tile reached
    const wk4 = routeWorker(maskBy((x, y) => (Math.max(Math.abs(x - 50), Math.abs(y - 36)) === 4 ? ROVR.blocked : 0)));
    try {
      const a = { x: 50.5, y: 2.5 }, b = { x: 50.5, y: 36.5 };
      const r = await wk4.ask({ from: a, to: b, explored: boxKeys(a, b, 8), margin: 2, wide: 8 });
      const n = r.pts.length >> 1, lx = r.pts[n * 2 - 4], ly = r.pts[n * 2 - 3];
      check(r.ok && r.cut && r.kinds[n - 1] === RKIND.unknown && ly < 32 && Math.hypot(lx - b.x, ly - b.y) < 8,
        `a pin in a pocket: ${r.why}, cut ${r.cut}, the way ends at ${lx},${ly} (${r.expanded} nodes)`);
    } finally { wk4.end(); }
    // A wall 2 tiles wide across the first box (2 chunks round): no way there; the wide box (8) finds the road round its end
    const wk3 = routeWorker(maskBy((x, y) => (x >= 50 && x <= 51 && y >= -110 && y <= 200 ? ROVR.blocked : (y === -115 && x >= 20 && x <= 81) || ((x === 20 || x === 81) && y >= -115 && y <= 3) ? ROVR.road : 0)));
    try {
      const a = { x: 20.5, y: 2.5 }, b = { x: 81.5, y: 2.5 };
      const narrow = await wk3.ask({ from: a, to: b, explored: boxKeys(a, b, 8), margin: 2 });
      check(!narrow.ok && narrow.why === 'nopath', `the first box alone: ${narrow.why}`);
      const r = await wk3.ask({ from: a, to: b, explored: boxKeys(a, b, 8), margin: 2, wide: 8 });
      let minY = Infinity; for (let i = 1; i < r.pts.length; i += 2) minY = Math.min(minY, r.pts[i]);
      check(r.ok && minY < -100, `the wide box: ${r.why}, as far north as ${minY.toFixed(1)} (${Math.round(r.ms)} ms, ${r.expanded} nodes)`);
    } finally { wk3.end(); }
  });

  await test('route (english): ribbon bounded and idle free', async () => {
    const v = game.view3d;
    try {
      // Nothing yet: no worker, no mesh, no pin
      if (!R().active && !R().worker) check(!v.routeView && !document.getElementById('hud-wp'), 'without a route there is a ribbon or a pin already');
      await goTo(game, 50.5, 2.5);
      check(R().set({ x: 50.5, y: 36.5, kind: 'point' }), 'the route is not set');
      check(await routed() === 'ready', `the search: ${R().state} (${R().debug?.why})`);
      for (let i = 0; i < 4; i++) { draw(); await sleep(40); }
      if (RIBBON_OFF) { check(!v.routeView, '?rutasuelo=0 and a ribbon'); return; }
      const rv = v.routeView;
      check(rv && rv.mesh.isMesh && !rv.mesh.children.length, 'no ribbon, or more than one mesh');
      await until(() => { draw(); return rv.mesh.visible && rv.vis >= 1; }, 6000, 'the ribbon shown');
      check(rv.n * 2 <= RIBBON_MAX && rv.geom.drawRange.count > 0 && rv.geom.attributes.position.count <= RIBBON_MAX, `vertices: ${rv.n * 2}, buffer ${rv.geom.attributes.position.count}`);
      const fadeOut = async () => { for (let i = 0; i < 30 && rv.mesh.visible; i++) { draw(); await sleep(40); } return !rv.mesh.visible; };
      const fadeIn = async () => { for (let i = 0; i < 30 && !(rv.mesh.visible && rv.vis >= 1); i++) { draw(); await sleep(40); } return rv.mesh.visible; };
      // Indoors it fades out; outside again it comes back
      game.underRoof = true; check(await fadeOut(), 'it shows under a roof');
      game.underRoof = false; check(await fadeIn(), 'it does not come back outside');
      // A cave (a grid scene): hidden at once
      const sc = game.scene; game.scene = { kind: 'grid' };
      try { routeGround(v, game, game.scene, 0); } finally { game.scene = sc; }
      check(!rv.mesh.visible, 'it shows in a cave');
      check(await fadeIn(), 'it does not come back from the cave');
      // Standing still 10 s: the full HUD keeps it; the minimal one fades it, and Tab brings it back
      rv.stillT = RIBBON_STILL + 1; draw(); check(rv.mesh.visible, 'the full HUD hides it standing still');
      useSmartHud(game, true);
      rv.stillT = RIBBON_STILL + 1; check(await fadeOut(), 'the minimal HUD keeps it after 10 s still');
      game.smartHud.hold(true); check(await fadeIn(), 'Tab does not bring it back');
      game.smartHud.hold(false);
    } finally { useSmartHud(game, false); game.underRoof = false; R().clear('user'); draw(); }
    // Cleared: it goes, and nothing is rebuilt
    const rv = v.routeView;
    if (rv) { for (let i = 0; i < 20 && rv.mesh.visible; i++) { draw(); await sleep(40); } check(!rv.mesh.visible, 'the ribbon stays after clearing'); const n = rv.stats.rebuilds; draw(); draw(); check(rv.stats.rebuilds === n, 'cleared, it is still rebuilt'); }
  });

  await test('route (english): save round trip', async () => {
    try {
      R().set({ x: 60.257, y: 30.5, kind: 'place', name: 'Prueba', id: 'poi:3,1' }, { quiet: true });
      const out = {}; R().save(out);
      check(JSON.stringify(out.route) === JSON.stringify({ v: 1, x: 60.26, y: 30.5, kind: 'place', name: 'Prueba', id: 'poi:3,1' }), `saved: ${JSON.stringify(out.route)}`);
      check(JSON.stringify(game.snapshot().route) === JSON.stringify(out.route), 'the snapshot has no route');
      R().reset(JSON.parse(JSON.stringify(out)));
      check(R().active && R().target.x === 60.26 && R().target.name === 'Prueba' && R().target.kind === 'place', `loaded: ${JSON.stringify(R().target)}`);
      // No key, no route; bad numbers or out of the planet load none without throwing; an unknown kind is a point
      R().reset({}); check(!R().active, 'a save without a route has one');
      for (const bad of [{ v: 1, x: NaN, y: 3 }, { v: 1, x: 'a', y: 3 }, { v: 1, x: 3, y: NORTH - 20 }, null, 7, { x: Infinity, y: 0 }]) { R().reset({ route: bad }); check(!R().active, `loaded ${JSON.stringify(bad)}`); }
      R().reset({ route: { v: 1, x: 40, y: 20, kind: 'person', name: 'x'.repeat(90) } });
      check(R().target?.kind === 'point' && R().target.name.length === 40, `an old kind: ${JSON.stringify(R().target)}`);
      const o2 = {}; R().clear('user'); R().save(o2); check(!('route' in o2), 'cleared, it is saved');
    } finally { R().clear('user'); }
  });

  await test('route (english): map click', async () => {
    const M = game.map, big = document.getElementById('bigmap');
    const ptr = (type, x, y, o = {}) => big.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, pointerType: 'mouse', bubbles: true, cancelable: true, ...o }));
    const click = (x, y) => { ptr('pointerdown', x, y); ptr('pointerup', x, y); };
    try {
      R().clear('user');
      await goTo(game, CENTER.x, CENTER.y);
      keyM(); await frames(2); check(game.mode === 'map', `the map does not open: ${game.mode}`);
      M.zoom = 4; M.recenter(); draw();
      check(document.getElementById('map-info').textContent.includes(t('map.route.help')), `no help line: ${document.getElementById('map-info').textContent}`);
      // A free spot on the screen (no named spot within 20 px)
      let sx = innerWidth / 2 + 70, sy = innerHeight / 2 + 50;
      for (let k = 0; k < 30 && M.spotAt(sx, sy, 20); k++) { sx += 13; sy -= 7; }
      const at = M.toWorld(sx, sy);
      click(sx, sy); await frames(1);
      check(R().active && R().target.kind === 'point' && Math.abs(R().target.x - at[0]) < 0.01 && Math.abs(R().target.y - at[1]) < 0.01, `a click does not set: ${JSON.stringify(R().target)} / ${at}`);
      draw(); check(!document.getElementById('map-route').hidden, 'no Remove route button');
      // A drag pans and sets nothing
      R().clear('user'); const pan = M.pan.x;
      ptr('pointerdown', sx, sy); ptr('pointermove', sx + 40, sy); ptr('pointerup', sx + 40, sy); await frames(1);
      check(!R().active && M.pan.x !== pan, 'a drag sets a route, or does not pan');
      // A click on the pin clears it; so does a right click
      // (the map is drawn before each click, as every frame in play: its spots are those of the last drawing)
      M.recenter(); draw(); click(sx, sy); draw();
      const pin = M.hits.find(q => q.pin === 'route'); check(pin, 'the pin is not drawn');
      click(pin.sx, pin.sy - 8); await frames(1); check(!R().active, 'a click on the pin does not clear');
      draw(); click(sx, sy); check(R().active, 'not set again');
      const cm = new MouseEvent('contextmenu', { clientX: sx, clientY: sy, button: 2, bubbles: true, cancelable: true });
      big.dispatchEvent(cm); check(!R().active && cm.defaultPrevented, 'a right click does not clear');
      // Near "Your house" it snaps to its door and takes the name
      draw(); const home = M.hits.find(q => q.name === t('gui.map.home')); check(home, `no house on the map: ${M.hits.map(q => q.name)}`);
      click(home.sx + 6, home.sy + 4); await frames(1);
      check(R().target?.id === 'home' && R().target.name === t('gui.map.home') && R().target.x === DOOR.x && R().target.y === DOOR.y, `no snap: ${JSON.stringify(R().target)}`);
      draw(); check(document.getElementById('map-info').textContent.includes(t('gui.map.home')), `the info line: ${document.getElementById('map-info').textContent}`);
      // A shared pin of someone's house is named from this side ("Hafsa's house", not "Your house"); the tavern in this
      // player's language; an old peer's plain name stays as sent
      const prune = R().prunePins; R().prunePins = () => {};
      try {
        R().heard(9101, { name: 'Hafsa', playing: true }, { t: 'wp', x: game.player.x + 6, y: game.player.y - 6, name: '', id: 'home' });
        R().heard(9102, { name: 'Lía', playing: true }, { t: 'wp', x: game.player.x - 8, y: game.player.y + 7, name: 'Tavern', id: 'tavern' });
        R().heard(9103, { name: 'Bo', playing: true }, { t: 'wp', x: game.player.x + 9, y: game.player.y + 9, name: 'Old pin' });
        const P = R().pins;
        check(P.get(9101)?.name === t('gui.map.house_of', { name: 'Hafsa' }) && P.get(9101).own, `home pin: ${JSON.stringify(P.get(9101))}`);
        check(P.get(9102)?.name === t('gui.map.tavern') && P.get(9103)?.name === 'Old pin', `pins: ${JSON.stringify([...P.values()])}`);
        draw(); check(M.hits.some(q => q.pin === 'shared' && q.name === t('gui.map.house_of', { name: 'Hafsa' })), `home pin label: ${M.hits.filter(q => q.pin).map(q => q.name)}`);
      } finally { for (const k of [9101, 9102, 9103]) R().pins.delete(k); R().pinsVersion++; R().prunePins = prune; }
    } finally { if (game.mode === 'map') keyM(); await frames(2); R().clear('user'); }
    check(game.mode === 'play', `the map stays open: ${game.mode}`);
  });

  await test('route (english): roads used', async () => {
    const placed = [], cut = [];
    try {
      // Plaza → Bruno's door: along the village path
      await goTo(game, PLAZA.x, PLAZA.y);
      const door = doorOf(HOUSES.bruno);
      R().set({ x: door.x, y: door.y, kind: 'place' }, { quiet: true });
      check(await routed() === 'ready', `the search: ${R().state} (${R().debug?.why})`);
      const S = along(R().pts, 0.5), onPath = S.filter(([x, y]) => distToPath(x, y) < 0.8 || ((x - PLAZA.x) / PLAZA.rx) ** 2 + ((y - PLAZA.y) / PLAZA.ry) ** 2 < 1).length / S.length;
      console.log(`route plaza → Bruno: ${R().len.toFixed(1)} tiles, ${(onPath * 100).toFixed(0)}% on the path, ${R().pts.length / 2} points`);
      check(onPath >= 0.6, `only ${(onPath * 100).toFixed(0)}% on the village path`);
      check(Math.hypot(R().pts[R().pts.length - 2] - door.x, R().pts[R().pts.length - 1] - door.y) < 1e-3, 'it does not end on the door');
      // A gravel path built across the field east of the village is used the next time: a column 5 or more tiles east
      // of the straight way, from y -9 to 39, with its two spurs (the first column with no water and nothing built or of
      // the village on it; the trees and rocks of the world on it are cleared first, as a player would)
      const A = { x: 50.5, y: -8.5 }, Bp = { x: 50.5, y: 38.5 }, strip = RX => { const t = []; for (let y = -9; y <= 39; y++) t.push([RX, y]); for (let x = 51; x < RX; x++) t.push([x, -9], [x, 38]); return t; };
      const genOn = (x, y) => w().colliderShapes(Math.floor(x / CHUNK), Math.floor(y / CHUNK)).objects.filter(o => o.col && !o.placed && !o.fixed && !o.boat && Math.floor(o.x) === x && Math.floor(o.y) === y);
      const builtOn = (x, y) => w().colliderShapes(Math.floor(x / CHUNK), Math.floor(y / CHUNK)).colliders.some(c => !c.pond && !c.dig && !genOn(x, y).some(o => o.col === c) && (c.r !== undefined ? Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) < c.r + 0.3 : c.rx !== undefined ? Math.hypot((x + 0.5 - c.x) / (c.rx + 0.3), (y + 0.5 - c.y) / (c.ry + 0.3)) < 1 : c.x0 !== undefined && x + 0.5 > c.x0 - 0.3 && x + 0.5 < c.x1 + 0.3 && y + 0.5 > c.y0 - 0.3 && y + 0.5 < c.y1 + 0.3));
      let RX = 0;
      for (let x = 56; x <= 70 && !RX; x++) if (strip(x).every(([tx, ty]) => !w().water(tx + 0.5, ty + 0.5) && !builtOn(tx, ty) && !w().at('floor', tx, ty))) RX = x;
      check(RX, 'no column for the gravel path east of the village');
      for (const [tx, ty] of strip(RX)) for (const o of genOn(tx, ty)) { w().remove(o); cut.push(o); }
      await goTo(game, A.x, A.y);
      R().set({ x: Bp.x, y: Bp.y, kind: 'point' }, { quiet: true });
      check(await routed() === 'ready', `before: ${R().state}`);
      const roadOf = () => { const s = along(R().pts, 0.5); return s.filter(([x, y]) => w().at('floor', Math.floor(x), Math.floor(y)) === 'camino').length / s.length; };
      const before = roadOf();
      const lay = (x, y) => { if (!w().water(x + 0.5, y + 0.5) && !w().at('floor', x, y)) { w().place(x, y, 'camino'); placed.push([x, y]); } };
      for (const [tx, ty] of strip(RX)) lay(tx, ty);
      const key = `${Math.floor(RX / CHUNK)},0`, dv = w().deltas.get(key)?.v;
      R().set({ x: Bp.x, y: Bp.y, kind: 'point' }, { quiet: true });
      check(await routed() === 'ready', `after: ${R().state}`);
      const after = roadOf();
      console.log(`route over the gravel path: ${(before * 100).toFixed(0)}% before, ${(after * 100).toFixed(0)}% after (${placed.length} tiles)`);
      const mbits = R().masks.get(key)?.mask, fresh = chunkMask(w(), Math.floor(RX / CHUNK), 0), li = 5 * CHUNK + RX - Math.floor(RX / CHUNK) * CHUNK;
      check(after >= 0.5 && after > before + 0.3 && R().kinds.includes(RKIND.road), `the gravel path is not used: ${(before * 100).toFixed(0)}% → ${(after * 100).toFixed(0)}% (column ${RX}, ${cut.length} cleared, mask bits at ${RX},5: sent ${mbits?.[li]}, now ${fresh[li]}; kinds ${[...R().kinds]}; pts ${[...R().pts].map(v => v.toFixed(1))})`);
      check(R().masks.get(key)?.v === dv, `the mask of ${key} is not of its d.v ${dv}: ${R().masks.get(key)?.v}`);
    } finally {
      for (const [x, y] of placed) w().unplace({ tile: [x, y], layer: 'floor', placed: 'camino' });
      for (const o of cut) { const cx = Math.floor(o.x / CHUNK), cy = Math.floor(o.y / CHUNK), d = w().delta(cx, cy); if (d?.removed) { delete d.removed[o.key]; w().touch(cx, cy); } }
      R().clear('user'); await goTo(game, 21, 26);
    }
  });

  await test('route (english): follow and arrive', async () => {
    const cue = Music.cue, cues = [], told0 = told();
    let plans = 0; const plan = R().plan;
    R().plan = function () { plans++; return plan.call(this); };
    Music.cue = function (id, o) { cues.push(id); return cue.call(this, id, o); };
    try {
      await goTo(game, 50.5, 0.5);
      await goTo(game, 50.5, 80.5); await realWait(400); await goTo(game, 50.5, 0.5);   // (a long move without a route: not a teleport for the next one)
      // (all the land round explored: no quiet search again for land explored on the way while this measures searches)
      for (let cy = -3; cy <= 5; cy++) for (let cx = 0; cx <= 6; cx++) game.explored.add(`${cx},${cy}`);
      R().set({ x: 50.5, y: 36.5, kind: 'point' }, { quiet: true });
      check(await routed() === 'ready', `the search: ${R().state}`);
      await realWait(3200);   // (past REPLAN_GAP since that search)
      check(plans === 1, `${plans} searches for one set (a move before it taken as a teleport)`);
      // The pin in the world (full HUD): on, with its distance
      check(document.getElementById('hud-wp')?.classList.contains('on'), 'no pin in the world');
      // 9 tiles off the line for 2 s: one search again (and only one)
      plans = 0;
      let off = 0; for (let k = 9; k < 16 && off <= 8.5; k++) { await goTo(game, R().pts[0] + k, R().pts[1] + 2); off = R().follow(p()); }
      check(off > 8, `not off the line: ${off.toFixed(1)}`);
      await until(() => plans >= 1, 9000, 'the search again');
      await routed(); await realWait(2600);
      check(plans === 1, `${plans} searches again`);
      await until(() => !R().pending, 9000, 'the answer');
      check(R().follow(p()) < 1, `the new way does not start where the player is: ${R().follow(p()).toFixed(1)} tiles off (${R().state}, ${R().debugText || R().debug?.why}, unknown ${R().unknownPart})`);
      // Mounting: a search in riding mode
      await realWait(3200); plans = 0;
      const mount = p().mount; p().mount = { fake: true };
      try { R().tickAt = -Infinity; R().update(0); } finally { p().mount = mount; }
      check(plans === 1 && R().mode === 'ride', `mounting: ${plans} searches, mode ${R().mode}`);
      await routed();
      // Within 4 tiles: cleared, the arrive cue and the float
      await goTo(game, 50.5, 33.5); R().tickAt = -Infinity; R().update(0);
      check(!R().active && cues.includes('arrive') && told0.out.includes(t('route.arrived')), `arriving: active ${R().active}, cues ${cues}, said ${told0.out}`);
      draw(); check(!document.getElementById('hud-wp')?.classList.contains('on'), 'the pin stays after arriving');
    } finally { R().plan = plan; Music.cue = cue; told0.undo(); R().clear('user'); await goTo(game, 21, 26); }
  });

  // The music: musicState on a made-up game (nothing real moves), and offline renders recording every note
  const mgame = (o = {}) => {
    const pl = { x: 200.5, y: 26.5, moving: true, vx: 1, vy: 0, speedMul: 1, ...(o.player || {}) }, Wd = { kind: 'world' };
    return { mode: 'play', player: pl, scene: o.scene || Wd, world: Wd, indoors: false, underRoof: false, gamemode: 'survival', difficulty: 'normal',
      days: { hour: 12, localHour: 12, localSeason: 1, info: {}, ...(o.days || {}) }, combat: { monsters: o.monsters || [] }, neighbors: { people: [] }, ...(o.game || {}) };
  };
  const recordNotes = (secs, script) => {
    const rec = [], orig = Voices.prototype.play;
    Voices.prototype.play = function (voice, at, midi, dur, vel, dest, layer) { const r = orig.call(this, voice, at, midi, dur, vel, dest, layer); rec.push({ voice, at, midi, layer, ok: !!r, live: this.liveAt(at) }); return r; };
    try { DynamicMusic.render(new OfflineAudioContext(2, 8000 * secs, 8000), script); } finally { Voices.prototype.play = orig; }
    return rec;
  };

  await test('music (english): state priorities', async () => {
    const mood = o => pickMood(mgame(o));
    check(mood({ player: { headUnder: true } }) === 'deep', 'under water is not deep');
    check(mood({ scene: { kind: 'grid' } }) === 'cave' && mood({ scene: { kind: 'grid', style: 'temple' } }) === 'temple', 'a cave is not cave');
    const inside = { player: { x: TAVERN.x0 + 4, y: TAVERN.y0 + 3 }, game: { underRoof: true, indoors: true } };
    check(mood({ ...inside, days: { hour: 21, localHour: 21 } }) === 'tavern' && mood({ ...inside, days: { hour: 1, localHour: 1 } }) === 'tavern', 'the tavern at 21:00 or 1:00 is not tavern');
    check(mood({ ...inside, days: { hour: 8, localHour: 8 } }) === 'home', 'the closed tavern is not home');
    check(mood({ player: { sleeping: true, headUnder: true } }) === 'sleep', 'sleep does not win');
    // The local hour: far east it is night while the village has noon (and the other way round)
    check(mood({ days: { hour: 12, localHour: 23 } }) === 'night' && mood({ days: { hour: 23, localHour: 12 } }) === 'day', 'the mood follows the village hour, not the local one');
    check(mood({ days: { info: { rain: 1 } } }) === 'rain' && mood({ days: { localSeason: 3 } }) === 'winter' && mood({ days: { localHour: 18 } }) === 'dusk', 'rain, winter or dusk');
    check(pickMood({ mode: 'menu' }) === 'menu', 'the menu');
    // A new mood holds a second before it plays; leaving deep three
    let s = musicState(mgame(), null, { now: 0 }); check(s.mood === 'day', `first: ${s.mood}`);
    s = musicState(mgame({ days: { localHour: 23 } }), s, { now: 500 }); check(s.mood === 'day' && s.want === 'night', 'night at once');
    s = musicState(mgame({ days: { localHour: 23 } }), s, { now: 1550 }); check(s.mood === 'night', 'night after a second');
    s = musicState(mgame({ player: { headUnder: true } }), s, { now: 2000 }); s = musicState(mgame({ player: { headUnder: true } }), s, { now: 3100 }); check(s.mood === 'deep', 'deep');
    s = musicState(mgame(), s, { now: 4000 }); s = musicState(mgame(), s, { now: 5100 }); check(s.mood === 'deep', 'left deep after one second');
    s = musicState(mgame(), s, { now: 7100 }); check(s.mood === 'day', 'deep does not end');
  });

  await test('music (english): intensity hysteresis', async () => {
    const mob = d => [{ x: 200.5 + d, y: 26.5 }];
    // Danger: a creature 9 tiles away, at once; it holds 6 s after it goes (polls at 1 Hz); 10.5 tiles is not danger
    let s = null;
    for (let i = 0; i <= 3; i++) s = musicState(mgame({ monsters: mob(9) }), s, { now: i * 1000 });
    check(s.intensity === 3, `danger at 9 tiles: ${s.intensity}`);
    for (let i = 4; i <= 9; i++) s = musicState(mgame(), s, { now: i * 1000 });
    check(s.intensity === 3, 'danger ends before 6 s');
    s = musicState(mgame(), s, { now: 10000 }); check(s.intensity === 1, `danger does not end: ${s.intensity}`);
    s = musicState(mgame({ monsters: mob(10.5) }), null, { now: 0 }); check(s.intensity === 1, 'danger at 10.5 tiles');
    // In the village, a creature outside it is no danger; peaceful and creative never
    check(musicState(mgame({ player: { x: 21, y: 4 }, monsters: [{ x: 21, y: -3 }] }), null, { now: 0 }).intensity === 1 && musicState(mgame({ player: { x: 21, y: 4 }, monsters: [{ x: 21, y: 9 }] }), null, { now: 0 }).intensity === 3, 'danger from outside the village, or none from inside it');
    check(musicState(mgame({ monsters: mob(3), game: { difficulty: 'peaceful' } }), null, { now: 0 }).intensity === 1 && musicState(mgame({ monsters: mob(3), game: { gamemode: 'creative' } }), null, { now: 0 }).intensity === 1, 'danger in peaceful or creative');
    // Ride: after 1.5 s of gallop (Plan F's flag or the fallback speed), off 3 s after it stops
    const gallop = mgame({ player: { mount: {}, vx: 6 } });
    s = null;
    for (const t0 of [0, 1000]) s = musicState(gallop, s, { now: t0 });
    check(s.intensity === 1, 'ride before 1.5 s');
    s = musicState(gallop, s, { now: 2000 }); check(s.intensity === 2, `no ride after 2 s of gallop: ${s.intensity}`);
    for (const t0 of [3000, 4000, 5000]) s = musicState(mgame({ player: { mount: {}, vx: 2 } }), s, { now: t0 });
    check(s.intensity === 2, 'ride ends before 3 s');
    s = musicState(mgame({ player: { mount: {}, vx: 2 } }), s, { now: 6000 }); check(s.intensity === 1, `ride does not end: ${s.intensity}`);
    s = musicState(mgame({ player: { mount: {}, vx: 0.5 }, game: { horse: { galloping: true } } }), null, { now: 0 });
    s = musicState(mgame({ player: { mount: {}, vx: 0.5 }, game: { horse: { galloping: true } } }), s, { now: 1600 });
    check(s.intensity === 2, 'Plan F\'s galloping flag is not read');
    // Danger beats ride; calm mode never rides or fears
    s = musicState(mgame({ player: { mount: {}, vx: 6 }, monsters: mob(5) }), s, { now: 2600 }); check(s.intensity === 3, 'ride beats danger');
    let c = null; for (const t0 of [0, 1000, 2000, 3000]) c = musicState(mgame({ player: { mount: {}, vx: 6 }, monsters: mob(5) }), c, { now: t0, calm: true });
    check(c.intensity === 1, `calm: ${c.intensity}`);
    // Idle after 30 s still, back after 1 s moving
    s = null; for (let i = 0; i <= 31; i += 1) s = musicState(mgame({ player: { moving: false, vx: 0 } }), s, { now: i * 1000 });
    check(s.intensity === 0, `not idle after 31 s: ${s.intensity}`);
    s = musicState(mgame(), s, { now: 32000 }); s = musicState(mgame(), s, { now: 33100 }); check(s.intensity === 1, 'idle after moving');
  });

  await test('music (english): bars, stingers, voices', async () => {
    // A change in the middle of a bar lands on the next bar line, the danger stinger on the next beat
    const B1 = recordNotes(20, [{ at: 0, mood: 'day', intensity: 1 }, { at: 1.3, intensity: 3 }]);
    const t0 = B1.find(e => e.layer === 'pad').at, bs = barS(SCORES.day), tense = B1.find(e => e.layer === 'tense' && e.ok);
    const bar = Math.ceil((1.3 - t0) / bs - 1e-9) * bs + t0;
    check(tense && Math.abs(tense.at - bar) < 1e-3, `the change lands at ${tense?.at.toFixed(3)}, the bar at ${bar.toFixed(3)}`);
    const st = B1.find(e => e.layer === 'stinger'), beat = unitS(SCORES.day);
    check(st && st.at > 1.3 && st.at - 1.3 <= beat + 1e-3, `the danger stinger at ${st?.at}`);
    // The same stinger not again within 20 s
    const K = recordNotes(40, [{ at: 0, mood: 'day', intensity: 1 }, { at: 2, cue: 'arrive' }, { at: 4, cue: 'arrive' }, { at: 25, cue: 'arrive' }]);
    const arr = K.filter(e => e.layer === 'stinger' && e.ok).map(e => e.at), starts = arr.filter((v, i) => !i || v - arr[i - 1] > 1.5);
    check(starts.length === 2 && starts[0] < 3 && starts[1] > 25, `arrive played at ${starts.map(v => v.toFixed(1))}`);
    // The cap: 28 voices; pad and bass always play
    const A = recordNotes(60, [{ at: 0, mood: 'day', intensity: 1 }, { at: 20, intensity: 2 }, { at: 40, intensity: 3 }]);
    check(Math.max(...A.map(e => e.live)) <= MAX_VOICES && A.filter(e => e.layer === 'pad').every(e => e.ok), `live ${Math.max(...A.map(e => e.live))}, pads dropped ${A.filter(e => e.layer === 'pad' && !e.ok).length}`);
    const ctx = new OfflineAudioContext(1, 8000 * 10, 8000), V = new Voices(ctx, ctx.destination);
    V.ignoreHidden = true;   // (a hidden page plays only pad and bass: not what this measures)
    let leads = 0; for (let i = 0; i < 40; i++) if (V.play('pluck', 1, 60 + (i % 12), 2, 0.5, null, 'lead')) leads++;
    let pads = 0; for (let i = 0; i < 5; i++) if (V.play('pad', 1, 60, 2, 0.5, null, 'pad')) pads++;
    check(leads === MAX_VOICES && pads === 5 && V.liveAt(1) <= MAX_VOICES, `${leads} leads, ${pads} pads, ${V.liveAt(1)} live`);
    // The danger stinger's swell in every score within what the pad and the bass play (C3 less half an octave; the bass range)
    const lowS = Object.keys(SCORES).flatMap(id => stingerNotes('danger', resolveScore(id, 62)).filter(n => (n.voice === 'pad' && n.midi < 42) || (n.voice === 'bass' && (n.midi < 29 || n.midi > 55))).map(n => `${id} ${n.voice} ${n.midi}`));
    check(!lowS.length, `danger stinger notes out of range: ${lowS}`);
    // The voices' worker renders the same buffers as this thread (the synthesis is deterministic)
    const vw = new Worker(new URL('./musicworker.js?v=' + encodeURIComponent(GAME_VERSION), import.meta.url), { type: 'module' });
    try {
      const parts = await new Promise((res, rej) => { const got = []; const tm = setTimeout(() => rej(new Error('the voices worker does not answer')), 20000); vw.onerror = e => { clearTimeout(tm); rej(new Error('the voices worker failed: ' + (e.message || ''))); }; vw.onmessage = e => { if (e.data?.t === 'part') got.push(e.data); else if (e.data?.t === 'done') { clearTimeout(tm); res(got); } }; vw.postMessage({ t: 'render', jobs: [['pad', 0], ['pluck', 1]] }); });
      const same = parts.length === 2 && parts.every(m => { const o = renderPart(m.voice, m.i); return m.data instanceof Float32Array && m.data.length === o.data.length && m.sr === o.sr && m.data.every((v, k) => v === o.data[k]); });
      check(same, `the voices worker: ${parts.map(m => `${m.voice} ${m.i} ${m.data?.length ?? m.error}`)}`);
    } finally { vw.terminate(); }
    // A hidden tab: the clock jumps ahead and the score resyncs to now, no burst of old notes
    const ctx2 = new OfflineAudioContext(2, 8000 * 60, 8000), out = ctx2.createGain(), c = new Conductor(ctx2, out, { offline: true });
    c.voices.prerender(null);
    const rec = [], orig = Voices.prototype.play;
    Voices.prototype.play = function (voice, at, ...rest) { const r = orig.call(this, voice, at, ...rest); rec.push(at); return r; };
    try {
      c.apply({ mood: 'day', intensity: 1 }, 0);
      for (let t1 = 0; t1 <= 10; t1 += 0.09) c.pump(t1 + 0.35, t1);
      const n = rec.length; c.pump(41.6, 40);
      const late = rec.slice(n);
      check(late.every(a => a >= 40) && late.length < 40, `after the gap: ${late.length} notes, the first at ${late[0]}`);
    } finally { Voices.prototype.play = orig; }
  });

  await test('music (english): calm, legacy, tavern', async () => {
    // Calm: no ride, tense or stingers
    const D = recordNotes(30, [{ at: 0, mood: 'day', intensity: 3, calm: true }, { at: 10, intensity: 2, calm: true }, { at: 12, cue: 'arrive' }]);
    check(D.length > 20 && !D.some(e => ['ride', 'tense', 'stinger'].includes(e.layer)), `calm plays ${[...new Set(D.map(e => e.layer))]}`);
    // ?musica=0 (or chip): the old music, chosen at load
    check(Music === (apagada('musica') ? LegacyMusic : DynamicMusic) && typeof LegacyMusic.render === 'function', 'the music is not the one the address asks for');
    // A save without musicMode reads dynamic; calm in the save sets Music.calm
    const was = Settings.v.musicMode;
    try {
      Settings.v.musicMode = undefined; check(Settings.musicMode === 'dynamic', 'no musicMode does not read dynamic');
      Settings.useVolumes({ musicMode: 'loud' }); check(Settings.musicMode === 'dynamic', 'an unknown mode is taken');
      Settings.useVolumes({ musicMode: 'calm' }); check(Settings.musicMode === 'calm' && Settings.volumes().musicMode === 'calm', 'calm is not kept');
      if (Music === DynamicMusic) check(Music.isCalm, 'Music.calm is not set');
    } finally { Settings.useVolumes({ musicMode: was || 'dynamic' }); }
    check(!Music.isCalm || Settings.musicMode === 'calm', 'Music stays calm');
    // The tavern band: 1 inside (under its roof), about a third at the wall, 0 from 25 m, none out of hours
    const g = h => mgame({ days: { hour: h, localHour: h }, game: { underRoof: true } }), pin = { x: TAVERN.x0 + 4, y: TAVERN.y0 + 3 };
    check(bandOf(g(21), TAVERN_VENUE, pin) === 1, 'inside is not 1');
    check(bandOf(g(21), TAVERN_VENUE, { x: TAVERN.x1 + BAND_R + 1, y: TAVERN.y0 + 3 }) === 0 && bandOf(g(21), TAVERN_VENUE, { x: TAVERN.x1 + 10, y: TAVERN.y0 + 3 }) > 0, 'outside the band is not heard as it should');
    check(bandOf(g(8), TAVERN_VENUE, pin) === 0, 'the band plays out of hours');
    const T = recordNotes(20, [{ at: 0, mood: 'tavern', intensity: 1, band: 1, patrons: 3, claps: true }]);
    check(T.some(e => e.ok && ['clap', 'hat', 'frame'].includes(e.voice)) && !T.some(e => e.layer === 'pad' && e.ok), 'inside the tavern the band does not play, or the score does');
  });
  // ---------- the body: dirt, wet, snow, the felt temperature, the bath (docs/planes/gta/PLAN-E-cuerpo-aspecto.md §12, E1) ----------
  const Bo = () => game.body;
  // Clean, dry and comfortable, with the factors and the chip from scratch (what each body test starts from and leaves)
  const bodyBase = () => {
    needsBase(); game.rules.doBodyWeather = true; game.underRoof = false;
    if (Bo().bath || p().bathing) { game.rest.stand(); Bo().endBath(); }
    Bo().reset({}); Bo().off.surface = false; Bo().off.cold = false; delete Bo().groundKind;
  };
  // W 3: the creator's "shirt and apron" outfit (the feel table of §2.2 is made with it)
  const W3 = { torso: { id: 'camisa' }, encima: { id: 'delantal' }, piernas: { id: 'pantalon' }, pies: { id: 'botas' }, calcetines: { id: 'calcetines' } };
  const near1 = (a, b, e = 0.05) => Math.abs(a - b) <= e;
  await test('body (english): old save loads clean', async () => {
    try {
      bodyBase();
      Bo().reset({ hp: 7 });
      const b = Bo(), now = Date.now();
      check(b.dirt === 0 && b.mud === 0 && b.wet === 0 && b.snow === 0 && b.blood === 0 && !b.fresh && b.beardGrows, `an old save: dirt ${b.dirt}, mud ${b.mud}, wet ${b.wet}, blood ${b.blood}`);
      check(Math.abs(b.cutAt - now) < 5000 && Math.abs(b.shaveAt - now) < 5000, 'an old save does not start its clocks now (it would wake up with a beard)');
      Bo().reset({ body: { dirt: 'x', mud: -4, wet: 1e9, blood: null, cutAt: now + 864e5, freshUntil: 'y' } });
      check(b.dirt === 0 && b.mud === 0 && b.wet === 100 && b.blood === 0 && b.cutAt <= Date.now() && b.freshUntil === 0, `bad values: dirt ${b.dirt} mud ${b.mud} wet ${b.wet} cutAt ${b.cutAt - now}`);
      Object.assign(b, { dirt: 33.3, mud: 12, wet: 40.5, blood: 5, freshUntil: now + 3600e3, cutAt: now - 5 * 864e5, shaveAt: now - 2 * 864e5, beardGrows: false });
      const out = {}; b.save(out); Bo().reset(JSON.parse(JSON.stringify(out)));
      check(b.dirt === 33.3 && b.mud === 12 && b.wet === 40.5 && b.blood === 5 && b.freshUntil === now + 3600e3 && b.cutAt === now - 5 * 864e5 && b.shaveAt === now - 2 * 864e5 && b.beardGrows === false, `the round trip: ${JSON.stringify(out.body)}`);
      check(b.snow === 0 && b.wetLegs === 0, 'snow or the wet legs were saved');
      check(game.snapshot().body?.v === 1, `the save has no body: ${JSON.stringify(game.snapshot().body)}`);
    } finally { bodyBase(); }
  });
  await test('body (english): temperature', async () => {
    const eqWas = Bo().cl;
    try {
      bodyBase();
      const W = clothesOf(W3, {}).warm; check(W === 3, `the default outfit gives W ${W}`);
      // The village is Tl 0.52 (the formula's reference)
      const Tl = climate(21, 26, w().gen.seed, {}).Tl; check(near1(Tl, TEMP.tlRef, 0.01), `the village's Tl is ${Tl}`);
      const env = (o = {}) => ({ Tl: 0.52, season: 0, hour: 12, weather: 'sol', indoors: false, cave: false, fireD: Infinity, swim: null, W: 3, rain: 0, shade: 0, wet: 0, raining: false, ...o });
      // The feel table of §2.2, row by row: [what, env, airC, cold, heat]
      const rows = [
        ['village, summer 15:00', { season: 1, hour: 15 }, 27, 0, 0],
        ['village, spring noon', { season: 0 }, 17.8, 0, 0],
        ['village, autumn noon', { season: 2 }, 16.8, 0, 0],
        ['village, winter noon', { season: 3 }, 9.8, 0, 0],
        ['village, winter 03:00', { season: 3, hour: 3 }, 3, 0.31, 0],
        ['village, snowy morning', { season: 3, hour: 9, weather: 'nieve' }, 1, 0.44, 0],
        ['village, snowy morning in a wool coat (W 6)', { season: 3, hour: 9, weather: 'nieve', W: 6 }, 1, 0.06, 0],
        ['village, autumn rain at 20:00, soaked', { season: 2, hour: 20, weather: 'lluvia', wet: 100, raining: true }, 12, 0.25, 0],
        ['snow land, winter noon', { Tl: 0.25, season: 3 }, -6.4, 0.9, 0],
        ['snow land, winter noon, full kit (W 9)', { Tl: 0.25, season: 3, W: 9 }, -6.4, 0.15, 0],
        ['snow land, winter 03:00, full kit', { Tl: 0.25, season: 3, hour: 3, W: 9 }, -13.2, 0.58, 0],
        ['desert, summer 15:00', { Tl: 0.7, season: 1, hour: 15 }, 37.8, 0, 0.98],
        ['desert, summer 15:00, straw hat', { Tl: 0.7, season: 1, hour: 15, shade: 1 }, 37.8, 0, 0.68],
        ['desert, spring noon', { Tl: 0.7, season: 0 }, 28.6, 0, 0.06],
        ['village, summer 15:00 in a coat (W 6)', { season: 1, hour: 15, W: 6 }, 27, 0, 0.15],
      ];
      for (const [what, o, air, cold, heat] of rows) {
        const f = feelOf(env(o), {});
        check(near1(f.airC, air, 0.1) && near1(f.cold, cold) && near1(f.heat, heat), `${what}: airC ${f.airC.toFixed(2)} (${air}), cold ${f.cold.toFixed(3)} (${cold}), heat ${f.heat.toFixed(3)} (${heat})`);
      }
      // Every clear noon of the four seasons in the village: nothing
      for (let s = 0; s < 4; s++) { const f = feelOf(env({ Tl, season: s }), {}); check(f.cold === 0 && f.heat === 0, `the village, season ${s}: cold ${f.cold}, heat ${f.heat}`); }
      // Indoors pulls toward 17; a lit hearth within 5 raises it; wet lowers the feel; a wool coat (+3) adds 6
      const cold = env({ season: 3, hour: 3 }), base = feelOf(cold, {});
      const inside = feelOf({ ...cold, indoors: true }, {}); check(near1(inside.airC, 3 + (17 - 3) * 0.7, 0.01) && inside.cold === 0, `indoors: ${inside.airC}`);
      const fire = feelOf({ ...cold, fireD: 2 }, {}); check(near1(fire.airC - base.airC, 12 * (1 - 2 / 5), 0.01), `a hearth at 2: +${fire.airC - base.airC}`);
      check(feelOf({ ...cold, fireD: 6 }, {}).airC === base.airC, 'a hearth at 6 still warms');
      const wet = feelOf({ ...cold, wet: 50 }, {}); check(near1(base.feelC - wet.feelC, 3, 0.01), `wet 50 lowers the feel by ${base.feelC - wet.feelC}`);
      check(near1(feelOf({ ...cold, W: 6 }, {}).feelC - base.feelC, 6, 0.01), 'a wool coat does not add 6');
      check(feelOf({ ...cold, cave: true }, {}).airC === TEMP.caveC, 'a cave is not at 12');
      // The real Body polls the same formula (no lag on the first poll) and its clothes come from inv.equip
      Bo().snap = true; Bo().poll(p());
      const f = feelOf(Bo()._env, {});
      check(near1(Bo().airC, f.airC, 0.01) && near1(Bo().feelC, f.feelC, 0.01) && near1(Bo().cold, f.cold, 0.01) && Number.isFinite(Bo().feelC), `the poll: ${Bo().airC} vs ${f.airC}`);
      check(Bo().cl.warm === clothesOf(game.inv.equip, {}).warm, 'the poll does not read the worn clothes');
    } finally { Bo().cl = eqWas; bodyBase(); }
  });
  await test('body (english): factors feed needs', async () => {
    const mode = game.difficulty;
    try {
      bodyBase(); await goTo(game, 21, 26);
      const drain = cold => { Bo().cold = cold; Bo().heat = 0; Bo().tick(); N().rest = 80; N().idleT = 10; N().rested = 0; N().update(60); return 80 - N().rest; };
      const d0 = drain(0), d1 = drain(1);
      check(d0 > 0 && near1(d1 / d0, 2, 0.02), `cold 1: the rest drain ×${(d1 / d0).toFixed(3)} (${d0.toFixed(3)} → ${d1.toFixed(3)})`);
      check(Bo().factors.hunger === 1.3 && near1(Bo().factors.regen, 0.6, 1e-9), `cold 1: hunger ×${Bo().factors.hunger}, regen ×${Bo().factors.regen}`);
      // The bath pose rests at twice a chair
      const sitting = kind => { p().pose = { kind, yaw: 0, h: 0 }; N().rest = 20; N().update(60); const r = N().rest - 20; p().pose = null; return r; };
      const sit = sitting('sit'), bath = sitting('bath');
      check(sit > 0 && near1(bath / sit, 2, 0.01), `a minute in the tub ${bath}, seated ${sit}`);
      // Heat: idle thirst ×1.8 outside the desert; in it, never below Plan D's ×1.5
      const dried = (heat, desert = false) => {
        Bo().cold = 0; Bo().heat = heat; Bo().tick(); let got = 0; N().dryBy = n => { got += n; };
        try { N().heatT = 1e9; N().heat = desert ? 1.5 : 1; N().thirst = 20; N().update(10); } finally { delete N().dryBy; N().heatT = 0; }
        return got;
      };
      const t0 = dried(0), t1 = dried(1);
      check(t0 > 0 && near1(t1 / t0, 1.8, 0.01), `heat 1: thirst ×${(t1 / t0).toFixed(3)}`);
      check(near1(dried(0.25, true) / t0, 1.5, 0.01) && near1(dried(1, true) / t0, 1.8, 0.01), 'the desert floor of ×1.5 is lost, or heat does not add to it');
      // Switched off: ?frio=0, doBodyWeather false, peaceful, creative: factors 1
      const ones = () => Object.values(Bo().factors).every(v => v === 1);
      Bo().cold = 1; Bo().heat = 1;
      Bo().off.cold = true; Bo().tick(); check(ones(), `?frio=0: ${JSON.stringify(Bo().factors)}`); Bo().off.cold = false;
      game.rules.doBodyWeather = false; Bo().tick(); check(ones(), 'doBodyWeather false changes the factors'); game.rules.doBodyWeather = true;
      game.difficulty = 'peaceful'; Bo().tick(); check(ones(), 'peaceful changes the factors'); game.difficulty = mode;
      Bo().tick(); check(Bo().factors.rest === 2, 'the factors do not come back');
      runCommand(game, '/gamemode creative', say0); Bo().update(0.6); check(ones() && Bo().cold === 0, `creative: ${JSON.stringify(Bo().factors)}`);
    } finally { game.difficulty = mode; bodyBase(); }
  });
  await test('body (english): surface grows and washes', async () => {
    const I = inv(), kept = I.slots.slice(), sel = I.selected, clWas = Bo().cl, eqPies = I.equip.pies;
    try {
      bodyBase(); runCommand(game, '/weather clear forever', say0); await goTo(game, 21, 26); await frames(2); bodyBase();
      // Tool work counts the seconds worked, not the uses: 100 hoe uses a second apart +4.5 (an apron: ×0.7); uses that
      // come faster add only the time between them (45 min of steady work to Filthy at any swing speed, §2.3)
      const uses = (kind, n, gap) => { for (let i = 0; i < n; i++) { Bo().workAt = game.time - gap; Bo().work(kind); } };
      Bo().cl = clothesOf({}, {}); uses('azada', 100, 5);
      check(near1(Bo().dirt, 4.5, 1e-6), `100 hoe uses: dirt ${Bo().dirt}`);
      Bo().dirt = 0; uses('azada', 100, 0.32); check(near1(Bo().dirt, 100 * 0.32 * 0.045, 1e-6), `100 quick hoe uses: dirt ${Bo().dirt}`);
      Bo().dirt = 0; Bo().workAt = game.time; for (let i = 0; i < 10; i++) Bo().work('azada'); check(Bo().dirt === 0, `ten uses at once: dirt ${Bo().dirt}`);
      Bo().dirt = 0; Bo().cl = clothesOf({ encima: { id: 'delantal' } }, {}); uses('azada', 100, 5);
      check(near1(Bo().dirt, 3.15, 1e-6), `with an apron: dirt ${Bo().dirt}`);
      Bo().dirt = 0; uses('hacha', 100, 5); check(near1(Bo().dirt, 100 * 0.026 * 0.7, 1e-6), `an axe dirties less than a hoe: ${Bo().dirt}`);
      Bo().cl = clWas;
      // 10 m on tilled soil, with shoes: +0.8 mud; on a path, not raining, it dries
      if (!I.equip.pies) I.equip.pies = { id: 'botas' };
      Bo().dirt = 0; Bo().mud = 0; Bo().groundKind = () => 3; Bo().last = null;
      const x0 = p().x;
      for (let i = 0; i <= 100; i++) { p().x = x0 + i * 0.1; Bo().surfaceStep(1 / 60, p()); }
      p().x = x0;
      check(near1(Bo().mud, 0.8, 0.01), `10 m on tilled soil: mud ${Bo().mud}`);
      Bo().groundKind = () => 1; Bo().last = null; Bo().mud = 10; Bo().surfaceStep(10, p());
      check(near1(Bo().mud, 9.4, 0.01), `on a path, dry: mud ${Bo().mud}`);
      delete Bo().groundKind;
      // Swimming: wet 100 at once, dirt down to 15 and no further
      Object.assign(Bo(), { dirt: 40, mud: 30, blood: 20 }); p().swim = true;
      Bo().surfaceStep(1, p()); check(Bo().wet === 100 && Bo().mud === 0 && Bo().dirt === 32 && Bo().blood === 10, `a second swimming: wet ${Bo().wet}, dirt ${Bo().dirt}, mud ${Bo().mud}, blood ${Bo().blood}`);
      Bo().surfaceStep(10, p()); check(Bo().dirt === 15, `swimming washes below 15: ${Bo().dirt}`);
      p().swim = false; Bo().wet = 0;
      // A carcass cut up: dirt and blood; a hit: dirt
      Bo().dirt = 0; Bo().blood = 0; Bo().butchered(); Bo().hit(); check(Bo().dirt === 13 && Bo().blood === 8, `butchered and hit: dirt ${Bo().dirt}, blood ${Bo().blood}`);
      // The basin: −30 once, never below 25
      Bo().dirt = 40; Bo().washFace(); check(Bo().dirt === 25, `the basin at 40 gives ${Bo().dirt}`);
      Bo().dirt = 70; Bo().washFace(); check(Bo().dirt === 40, `the basin at 70 gives ${Bo().dirt}`);
      Bo().dirt = 20; Bo().washFace(); check(Bo().dirt === 20, 'the basin washes below 25');
      // The tub with soap: everything off by 12 s, one soap used, fresh; out at 15 s, towelled (wet 30)
      const had = I.count('soap'); if (had) I.remove('soap', had);
      I.add('soap', 2); I.changed();
      Object.assign(Bo(), { dirt: 80, mud: 50, blood: 30, wet: 0 });
      const tub = { tile: [Math.floor(p().x) + 2, Math.floor(p().y)], layer: 'placed', placed: 'banera', x: Math.floor(p().x) + 2.5, y: Math.floor(p().y) + 0.5, yaw: 0 };
      check(game.placedAction(tub)?.text === t('body.bath.soap'), `E on the tub says: ${game.placedAction(tub)?.text}`);
      check(Bo().bathe(tub) && p().pose?.kind === 'bath' && p().bathing && Bo().bathing, `no bath: pose ${p().pose?.kind}`);
      let s = 0;
      for (; s < 119; s++) Bo().update(0.1);
      check(Bo().dirt > 0 && I.count('soap') === 2, `clean before 12 s: dirt ${Bo().dirt}`);
      for (; s < 125 && I.count('soap') === 2; s++) Bo().update(0.1);
      check(Bo().dirt === 0 && Bo().mud === 0 && Bo().blood === 0 && I.count('soap') === 1 && Bo().fresh && p().pose?.kind === 'bath', `at 12 s: dirt ${Bo().dirt}, soap ${I.count('soap')}, fresh ${Bo().fresh}, pose ${p().pose?.kind}`);
      for (; s < 200 && p().pose; s++) Bo().update(0.1);
      check(!p().pose && !p().bathing && !Bo().bathing && Bo().wet <= 30 && Bo().wet >= 29, `out of the tub: pose ${p().pose?.kind}, wet ${Bo().wet}, after ${(s / 10).toFixed(1)} s`);
      check(s >= 149 && s <= 152, `the bath lasted ${(s / 10).toFixed(1)} s`);
      // Without soap: clean, not fresh
      I.remove('soap', 1); I.changed(); Bo().freshUntil = 0; Bo().dirt = 50;
      check(game.placedAction(tub)?.text === t('body.bath'), `without soap E says: ${game.placedAction(tub)?.text}`);
      Bo().bathe(tub); for (s = 0; s < 200 && p().pose; s++) Bo().update(0.1);
      check(Bo().dirt === 0 && !Bo().fresh, `a bath without soap: dirt ${Bo().dirt}, fresh ${Bo().fresh}`);
      // Moving gets you out early (rest.js stands you up), with something in the arms you put it down first
      Bo().bathe(tub); game.rest.stand(); Bo().update(0.1); check(!Bo().bathing && !p().bathing, 'standing up leaves the bath on');
      // Dying in the tub (combat.die calls onDeath before going home): out of it, and no step back to it later
      const at = [p().x, p().y]; Bo().bathe(tub); check(Bo().bathing, 'no bath to die in'); Bo().onDeath();
      check(!p().pose && !p().bathing && !Bo().bathing && !game.rest.back && Math.hypot(p().x - at[0], p().y - at[1]) > 0.3, `after dying in the tub: pose ${p().pose?.kind}, bathing ${Bo().bathing}, back ${game.rest.back}`);
      p().x = at[0]; p().y = at[1];
    } finally {
      if (p().pose) game.rest.stand(); Bo().endBath(); delete Bo().groundKind; Bo().cl = clWas;
      if (eqPies) I.equip.pies = eqPies; else delete I.equip.pies;
      I.slots.splice(0, I.slots.length, ...kept); I.select(sel); I.changed(); runCommand(game, '/weather reset', say0); bodyBase(); await goTo(game, 21, 26);
    }
  });
  await test('body (english): snow melts to wet', async () => {
    try {
      bodyBase(); runCommand(game, '/weather snow forever', say0); await goTo(game, 21, 26); await frames(3); bodyBase();
      check(game.days.info.snow && !game.indoors, `not snowing outdoors: ${game.days.weatherHere}, indoors ${game.indoors}`);
      Bo().snap = true; Bo().poll(p());
      check(Bo().airC <= 1 && Bo().fireD === Infinity, `snowing in the village: airC ${Bo().airC}, a fire at ${Bo().fireD}`);
      for (let i = 0; i < 10; i++) Bo().surfaceStep(1, p());
      check(near1(Bo().snow, 8, 0.01) && Bo().wet === 0, `10 s of snow outdoors: snow ${Bo().snow}, wet ${Bo().wet}`);
      // Under a roof: it melts (2/s) and the body gets wet (0.8 per point), and nothing dries while it melts
      game.underRoof = true;
      try { Bo().surfaceStep(2, p()); } finally { game.underRoof = false; }
      check(near1(Bo().snow, 4, 0.01) && near1(Bo().wet, 3.2, 0.01), `2 s indoors: snow ${Bo().snow}, wet ${Bo().wet}`);
      // By a lit hearth too: a full coat of snow melted soaks you (wet 80, the Soaked of §1.1), then it dries
      Bo().snow = 100; Bo().wet = 0; const fd = Bo().fireD; Bo().fireD = 1;
      try { for (let i = 0; i < 50; i++) Bo().surfaceStep(1, p()); check(Bo().snow === 0 && near1(Bo().wet, 80, 0.01), `100 snow melted by the fire: wet ${Bo().wet}`);
        Bo().surfaceStep(1, p()); check(Bo().wet < 80, `by the fire it does not dry: ${Bo().wet}`); } finally { Bo().fireD = fd; }
      // Cold makes rest fall faster: 1 + cold
      Bo().wet = 0; Bo().snow = 0; Bo().cold = 0.44; Bo().tick();
      check(near1(Bo().factors.rest, 1.44, 1e-9), `rest factor ${Bo().factors.rest}`);
    } finally { game.underRoof = false; runCommand(game, '/weather reset', say0); bodyBase(); }
  });
  await test('body (english): bath pose and tub taken', async () => {
    const live = game.live, was = { joined: live.joined, net: live.net, T: { ...live.timers }, lastSent: live.lastSent, sent: live.sent }, spy = told();
    try {
      bodyBase(); await goTo(game, 21, 26);
      const tub = { tile: [Math.floor(p().x) + 2, Math.floor(p().y)], layer: 'placed', placed: 'banera', x: Math.floor(p().x) + 2.5, y: Math.floor(p().y) + 0.5, yaw: Math.PI / 2 };
      game.placedAction(tub).run();
      check(p().pose?.kind === 'bath' && p().bathing, `E on a tub gives ${p().pose?.kind}`);
      // The spot: along the tub (its +z, from the anchor) and facing the taps
      const spot = game.rest.bathSpot(tub);
      check(near1(p().x, spot[0], 1e-6) && near1(p().y, spot[1], 1e-6) && near1(spot[0] - tub.x, 0.85, 1e-6), `the bather is at ${p().x},${p().y}, the spot ${spot}`);
      // What the others are told: a sit (index 0, an old game sees someone sitting) with ba: 1, and bd when there is something on the body
      const sent = [];
      live.joined = true; live.net = new Proxy({ ready: true, key: 1, send: m => sent.push(m) }, { get: (o, k) => (k in o ? o[k] : () => {}) });
      const st = () => { for (const k in live.timers) live.timers[k] = -1e9; live.lastSent = null; sent.length = 0; live.tick(1); return sent.find(m => m.t === 'st'); };
      let m = st(); check(m?.po?.[0] === 0 && m.ba === 1, `in the tub sends po ${JSON.stringify(m?.po)}, ba ${m?.ba}`);
      Bo().update(0.6); m = st(); check(m.bd > 0, `in the tub (wet) bd is ${m.bd}`);
      game.rest.stand(); Bo().update(0.1); Bo().reset({}); Bo().tickT = 0; Bo().update(0.01);
      m = st(); check(m.ba === undefined && m.bd === undefined && !m.po, `out of it, clean: ba ${m.ba}, bd ${m.bd}, po ${JSON.stringify(m.po)}`);
      live.joined = was.joined; live.net = was.net;
      // Another player in that tub: refused with "The tub is taken"
      live.receive('tb1', { t: 'hi', id: '!tb1', name: 'Bañista', playing: true, look: LOOK });
      live.receive('tb1', { t: 'st', sc: 'world', x: spot[0], y: spot[1], yaw: 0, po: [0, 0, 0.12], ba: 1 });
      const e = live.peers.get('tb1').entity;
      check(e.bathing && e.pose?.kind === 'bath', `the other bather: ${e.bathing}, ${e.pose?.kind}`);
      live.joined = true;
      check(Bo().bathe(tub) === false && !p().pose && spy.out.includes(t('body.bath.taken')), `a second bather gets in: pose ${p().pose?.kind}`);
      // Both in at once: the one whose id sorts later gets out (here, this one: '!tb1' sorts first)
      live.joined = false; check(Bo().bathe(tub), 'alone, no bath'); live.joined = true;
      Bo().tickT = 0; Bo().update(0.01); Bo().update(0.01);
      check(!p().pose && !Bo().bathing && spy.out.filter(s => s === t('body.bath.taken')).length === 2, 'two in one tub: the later id stays in');
      live.receive('tb1', { t: 'hi', id: '~tb1', name: 'Bañista', playing: true, look: LOOK });
      live.receive('tb1', { t: 'st', sc: 'world', x: spot[0], y: spot[1], yaw: 0, po: [0, 0, 0.12], ba: 1 });
      live.joined = false; Bo().bathe(tub); live.joined = true; Bo().tickT = 0; Bo().update(0.01);
      check(p().pose?.kind === 'bath', 'two in one tub: the earlier id gets out');
    } finally {
      spy.undo(); live.peers.delete('tb1'); live.joined = was.joined; live.net = was.net; Object.assign(live.timers, was.T); live.lastSent = was.lastSent; live.sent = was.sent;
      if (p().pose) game.rest.stand(); Bo().endBath(); bodyBase(); draw();
    }
  });
  await test('body (english): Shift in the tub and at the scrub', async () => {
    try {
      bodyBase(); await goTo(game, 21, 26);
      const tub = { tile: [Math.floor(p().x) + 2, Math.floor(p().y)], layer: 'placed', placed: 'banera', x: Math.floor(p().x) + 2.5, y: Math.floor(p().y) + 0.5, yaw: Math.PI / 2 };
      game.placedAction(tub).run();
      check(p().pose?.kind === 'bath', `E on a tub gives ${p().pose?.kind}`);
      // (the posture key never ends the bath nor crouches the bather: E, Space or walking get out)
      const tap = game.rest.posture(false), hold = game.rest.posture(true);
      check(!tap && !hold && p().pose?.kind === 'bath' && p().bathing && !p().crouch, `Shift in the tub: tap ${tap}, hold ${hold}, pose ${p().pose?.kind}, crouch ${p().crouch}`);
      game.rest.stand(); Bo().update(0.1);
      // (scrubbing is its own crouch: a tap ends it and stands as before; a hold ends it and sits on the floor)
      for (const hold of [false, true]) {
        p().crouch = true; Bo().scrubbing = { x: p().x, y: p().y, px: p().x, py: p().y, sc: game.scene, t: 0, crouch: false, land: true, emoteAt: -Infinity };
        const did = game.rest.posture(hold);
        check(did && !Bo().scrubbing && (hold ? p().pose?.kind === 'floorSit' : !p().crouch && !p().pose), `Shift ${hold ? 'held' : 'tapped'} while scrubbing: ${did}, scrub ${!!Bo().scrubbing}, crouch ${p().crouch}, pose ${p().pose?.kind}`);
        if (p().pose) game.rest.stand();
      }
      // (drinking on land, needs.js, is the same kind of crouch: the same two answers)
      const N = game.needs;
      for (const hold of [false, true]) {
        p().crouch = true; N.drinking = { x: p().x, y: p().y, px: p().x, py: p().y, sc: game.scene, land: true, crouch: false, step: 0, emoteAt: -Infinity, from: N.thirst };
        const did = game.rest.posture(hold);
        check(did && !N.drinking && (hold ? p().pose?.kind === 'floorSit' && !p().crouch : !p().crouch && !p().pose), `Shift ${hold ? 'held' : 'tapped'} while drinking: ${did}, drinking ${!!N.drinking}, crouch ${p().crouch}, pose ${p().pose?.kind}`);
        if (p().pose) game.rest.stand();
      }
    } finally {
      Bo().scrubbing = null; if (game.needs) game.needs.drinking = null; if (p().pose) game.rest.stand(); p().crouch = false; Bo().endBath(); bodyBase(); draw();
    }
  });
  await test('looks (english): growth clocks count, nothing applied yet (E1)', async () => {
    const lookWas = p().look, spy = [];
    try {
      bodyBase();
      const before = JSON.stringify(game.appearance());
      runCommand(game, '/body hair 30', s => spy.push(s));
      const b = Bo(), now = Date.now();
      check(Math.abs(b.cutAt - (now - 30 * 864e5)) < 5000 && spy.length === 1, `/body hair 30: cutAt ${(now - b.cutAt) / 864e5} days, said ${spy}`);
      check(b.growth().hairStep === 3 && !b.growth().pending && b.applied.hair === 0 && b.applyGrowth() === false, `the hair step ${b.growth().hairStep}, applied ${b.applied.hair}`);
      check(!('hairGrow' in p().look) && !('beardGrow' in p().look) && JSON.stringify(game.appearance()) === before, 'the growth got into the look');
      // The steps (§2.5): hair 8 days 1, 30 days 3; a beard 2 days 1, 20 days 4; a female body or beardGrows false: 0
      b.cutAt = now - 8 * 864e5; check(b.growth().hairStep === 1, `8 days: hair ${b.growth().hairStep}`);
      p().look = { ...lookWas, sex: 'chico' };
      b.shaveAt = now - 2 * 864e5; check(b.growth().beardStep === 1, `2 days: beard ${b.growth().beardStep}`);
      b.shaveAt = now - 20 * 864e5; check(b.growth().beardStep === 4, `20 days: beard ${b.growth().beardStep}`);
      b.beardGrows = false; check(b.growth().beardStep === 0, 'beardGrows false still grows'); b.beardGrows = true;
      p().look = { ...lookWas, sex: 'chica' }; check(b.growth().beardStep === 0, 'a female body grows a beard');
      p().look = lookWas;
      // /body dirt and clean in survival; the usage line on nonsense
      spy.length = 0; runCommand(game, '/body dirt 55', s => spy.push(s)); check(b.dirt === 55, `/body dirt 55: ${b.dirt}`);
      runCommand(game, '/body clean', s => spy.push(s)); check(b.dirt === 0, `/body clean: ${b.dirt}`);
      runCommand(game, '/body nothing', s => spy.push(s)); check(spy.at(-1) === t('cmd.body.usage'), `nonsense says: ${spy.at(-1)}`);
      // The clocks go in the save
      const out = {}; b.save(out); check(out.body.cutAt === b.cutAt && out.body.shaveAt === b.shaveAt, 'the clocks are not saved');
    } finally { p().look = lookWas; bodyBase(); }
  });
  await test('clothes (english): warmth values and soap', async () => {
    check(ITEMS.camisa.warm === 1 && ITEMS.delantal.work === 0.3 && ITEMS.sombrero.shade === 1 && ITEMS.gorro.warm === 1.5, 'garment values are not on the items');
    check(clothesText(ITEMS.calzoncillos) === '' && clothesText(ITEMS.camisa) === t('item.warmth', { n: 1 }), `the warmth line: «${clothesText(ITEMS.camisa)}»`);
    const r = RECIPES.find(q => q.out === 'soap');
    check(r?.station === 'cocina' && r.n === 2 && r.ins.some(([id]) => id === 'manteca') && r.ins.some(([id]) => id === 'carbon'), `soap: ${JSON.stringify(r)}`);
    check(SHOPS.rosa.stock.find(s => s.id === 'soap')?.price === 25, 'Rosa does not sell soap at 25');
    check(ITEMS.soap?.name && noun('item', 'soap'), 'soap has no name');
  });
  await test('red (net): bd and ba optional', async () => {
    const live = game.live;
    try {
      live.receive('bd1', { t: 'hi', id: 'id-bd1', name: 'Sucia', playing: true, look: LOOK });
      live.receive('bd1', { t: 'st', sc: 'world', x: p().x + 2, y: p().y, yaw: 0, po: [0, 0, 0.14] });
      const e = live.peers.get('bd1').entity;
      check(!e.grime && !e.bathing && e.pose?.kind === 'sit', `without bd and ba: grime ${JSON.stringify(e.grime)}, bathing ${e.bathing}, pose ${e.pose?.kind}`);
      const s = { dirt: 0.5, mud: 0.2, wet: 1, snow: 0, blood: 0.33, shiver: 1, sweat: 0 };
      live.receive('bd1', { t: 'st', sc: 'world', x: p().x + 2, y: p().y, yaw: 0, bd: packBd(s), po: [0, 0, 0.12], ba: 1 });
      check(['dirt', 'mud', 'wet', 'snow', 'blood'].every(k => Math.abs(e.grime[k] - s[k]) <= 1 / 15) && e.grime.shiver === 1 && e.grime.sweat === 0, `unpacked: ${JSON.stringify(e.grime)}`);
      check(e.bathing && e.pose.kind === 'bath', `ba 1 with a sit: bathing ${e.bathing}, pose ${e.pose.kind}`);
      const obj = e.grime;
      live.receive('bd1', { t: 'st', sc: 'world', x: p().x + 2, y: p().y, yaw: 0, bd: packBd(s) });
      check(e.grime === obj && !e.bathing && !e.pose, 'the same bd makes a new grime, or ba stays');
      live.receive('bd1', { t: 'st', sc: 'world', x: p().x + 2, y: p().y, yaw: 0, po: [2, 0, 0.1], ba: 1 });
      check(!e.grime && !e.bathing && e.pose.kind === 'lie', `ba with a lying pose, no bd: ${e.bathing}, ${e.pose.kind}, ${JSON.stringify(e.grime)}`);
      for (const bad of ['x', -5, 1.5, 1e12, null]) { live.receive('bd1', { t: 'st', sc: 'world', x: p().x + 2, y: p().y, yaw: 0, bd: bad }); check(!e.grime, `bd ${bad} gives ${JSON.stringify(e.grime)}`); }
      check(unpackBd(packBd(null)).dirt === 0 && packBd(unpackBd(packBd(s))) === packBd(s), 'packBd does not round-trip');
      // A message this game does not know (a later phase's remarks): dropped
      live.receive('bd1', { t: 'rmk', npc: 'rosa', rc: 3, li: 0 });
      draw();
    } finally { live.peers.delete('bd1'); draw(); }
  });
  await test('grime (english): one program', async () => {
    const live = game.live, A = game.view3d.actors, R = game.view3d.renderer, ents = live.entities;
    try {
      bodyBase(); await goTo(game, 21, 26);
      live.receive('gr1', { t: 'hi', id: 'id-gr1', name: 'Sucia', playing: true, look: LOOK });
      live.receive('gr1', { t: 'st', sc: 'world', x: p().x + 1.2, y: p().y + 0.6, yaw: 0 });
      live.entities = sc => (sc === game.world ? live.others.filter(o => o.entity).map(o => o.entity) : null);
      for (let i = 0; i < 4; i++) draw();
      const e = live.peers.get('gr1').entity, m = A.models.get(e), P = m?.person;
      check(P?.shared && P.r.mesh.material === P.shared, 'the other player is not on the shared material');
      // (a material never written draws nothing: every component 0, w too, on the shared one and the player's own copy)
      const zero = mt => { const u = R.properties.get(mt).uniforms; return !!u?.uGrime && [u.uGrime.value, u.uGrime2.value].every(v => v.x === 0 && v.y === 0 && v.z === 0 && v.w === 0); };
      check(zero(P.shared) && zero(A.player.person.r.mesh.material), 'a clean material has a nonzero overlay uniform (snow or shiver on everyone)');
      const n0 = R.info.programs.length;
      // The player dirty, the other one muddy and wet: drawn, and no program more
      Bo().dirt = 60; Bo().blood = 20;
      live.receive('gr1', { t: 'st', sc: 'world', x: p().x + 1.2, y: p().y + 0.6, yaw: 0, bd: packBd({ mud: 0.8, wet: 0.5 }) });
      for (let i = 0; i < 4; i++) draw();
      check(P.r.mesh.material !== P.shared && P.r.mesh.material === P.grimeMat, 'the muddy one has no material of its own');
      check(A.player.person.r.mesh.material !== A.player.person.grimeMat && !A.player.person.grimeMat, 'the player got one more material');
      check(R.info.programs.length === n0, `programs ${n0} → ${R.info.programs.length}`);
      // (the overlay compiles: a GLSL error, such as a reserved word, would leave every person undrawn)
      const bad = R.info.programs.filter(pg => pg.diagnostics && !pg.diagnostics.runnable);
      check(!bad.length, `a program did not compile: ${bad.map(pg => pg.diagnostics.fragmentShader?.log || pg.diagnostics.programLog).join(' | ').slice(0, 300)}`);
      // Clean again: back on the shared one, its own released
      live.receive('gr1', { t: 'st', sc: 'world', x: p().x + 1.2, y: p().y + 0.6, yaw: 0 });
      draw(); draw();
      check(P.r.mesh.material === P.shared && !P.grimeMat, 'clean, still on its own material');
      check(R.info.programs.length === n0, `programs after cleaning ${n0} → ${R.info.programs.length}`);
    } finally { live.entities = ents; live.peers.delete('gr1'); bodyBase(); draw(); }
  });
  await test('hud (english): body chip', async () => {
    const $ = id => document.getElementById(id), C = () => game.bodyChip, el = () => $('body-chip');
    // (Body's own update would poll the real weather between frames: everything here is set and read in one go)
    const set = o => { const b = Bo(); Object.assign(b, { cold: 0, heat: 0, wet: 0, dirt: 0, feelC: 20 }, o); };
    try {
      bodyBase(); useSmartHud(game, true); await goTo(game, 21, 26); draw(); draw();
      check(el() && el().parentNode.id === 'needs', 'no #body-chip in #needs');
      let T = performance.now() / 1000 + 0.01;
      // (what the tests before left on the chip, a cold that lingers 2 s, goes first)
      set({}); C().frame(T); C().frame(T += 2.5); check(!C().id && !el().classList.contains('on'), `at 20 °C a chip shows: ${C().id}`);
      set({ cold: 0.5 }); C().frame(T += 1);
      check(C().id === 'cold' && el().classList.contains('on') && el().textContent === t('body.chip.cold'), `cold 0.5: ${C().id} «${el().textContent}»`);
      // (right under the bars in sight, in the corner column, and the clock under it: index.html)
      await sleep(300);
      { const nb = $('needs').getBoundingClientRect(), kb = el().getBoundingClientRect(), cb = $('clockp').getBoundingClientRect();
        check(kb.left <= 20 && kb.top >= nb.bottom - 1 && kb.top <= nb.bottom + 12 && cb.top >= kb.bottom + 4, `the chip at ${Math.round(kb.left)},${Math.round(kb.top)}, the bars end at ${Math.round(nb.bottom)}, the clock at ${Math.round(cb.top)}`); }
      set({ cold: 0.1 }); C().frame(T += 1); check(C().id === 'cold', 'the chip goes at once');
      C().frame(T += 2.1); check(!C().id && !el().classList.contains('on'), `still there 2 s after: ${C().id}`);
      set({ cold: 0.8 }); C().frame(T += 1); check(C().id === 'freezing', `cold 0.8: ${C().id}`);
      // One at a time: cold wins over filthy, which waits and shows once the cold is gone, for 4 s
      set({ cold: 0.5, dirt: 80 }); C().frame(T += 1); check(C().id === 'cold', `cold and filthy: ${C().id}`);
      set({ cold: 0, dirt: 80 }); C().frame(T += 0.5); C().frame(T += 2.1); check(C().id === 'filthy' && el().textContent === t('body.chip.filthy'), `after the cold: ${C().id}`);
      C().frame(T += 4.1); check(!C().id, 'filthy stays more than 4 s');
      set({ dirt: 90 }); C().frame(T += 1); check(!C().id, 'filthy shows twice in a session');
      // Soaked: wet and chilled
      set({ wet: 90, cold: 0.2 }); C().frame(T += 1); check(C().id === 'soaked', `soaked: ${C().id}`);
      set({ wet: 90, cold: 0 }); C().frame(T += 1); check(!C().id, 'soaked without the cold');
      // Tab: the felt temperature
      set({}); game.smartHud.hold(true); draw(); set({}); C().frame(T += 1);
      check(el().classList.contains('on') && el().textContent === t('journal.body.feels', { c: '20' }), `Tab says «${el().textContent}»`);
      set({ cold: 0.5, feelC: 4.4 }); C().frame(T += 1);
      check(el().textContent === t('body.chip.feels', { state: t('body.chip.cold'), c: '4' }), `Tab, cold: «${el().textContent}»`);
      game.smartHud.hold(false);
      // Peaceful or doBodyWeather false: no cold chip; creative: nothing at all
      game.difficulty = 'peaceful'; set({ cold: 0.9 }); C().frame(T += 0.1); C().frame(T += 2.5); check(!C().id, `peaceful: ${C().id}`); game.difficulty = 'normal';
      runCommand(game, '/gamemode creative', say0); set({ cold: 0.9, dirt: 99 }); C().frame(T += 3); check(!C().id && !el().classList.contains('on'), `creative: ${C().id}`);
      runCommand(game, '/gamemode survival', say0);
      // The full interface: any cold at all shows
      useSmartHud(game, false); set({ cold: 0.05 }); C().frame(T += 3); check(C().id === 'cold', `full HUD, cold 0.05: ${C().id}`);
    } finally { game.smartHud?.hold(false); useSmartHud(game, false); game.difficulty = 'normal'; bodyBase(); draw(); }
  });
  await test('peso y en brazos, fin (weight end): a save played with the weight inventory opens with ?inventario=casillas without losing anything, and back', async () => {
    const W = JSON.stringify(game.snapshot()), D = JSON.stringify([...game.world.deltas]), was = Carry.force;
    const all = () => { const n = new Map(); for (const s of game.inv.slots) if (s) n.set(s.id, (n.get(s.id) || 0) + s.n); for (const { s } of game.inv.kept) n.set(s.id, (n.get(s.id) || 0) + s.n); return n; };
    const before = all();
    try {
      Carry.force = false;
      game.end(); game.start(JSON.parse(W), new Map(JSON.parse(D))); game.onSave = null;
      check(!game.inv.weight && game.inv.slots.length === 36, 'the slot inventory does not come back');
      const now = all(); check([...before].every(([id, n]) => now.get(id) === n), `the slot inventory loses: ${[...before].filter(([id, n]) => now.get(id) !== n).map(([id]) => id)}`);
    } finally {
      Carry.force = was;   // (null, the default; true only while the group holds it for a game started with the slots)
      game.end(); game.start(JSON.parse(W), new Map(JSON.parse(D))); game.onSave = null;
    }
    check(!!game.inv.weight === weightMode(), 'the game does not come back with its inventory');
    await readyGround(game, 8000);
  });
  // (a game started with the slots, always back to them, also when only= chose some weight tests: the rest run as they started)
  if (weightBack) {
    const back = weightBack; weightBack = null; Carry.force = null;
    game.end(); game.start(JSON.parse(back.snap), new Map(JSON.parse(back.deltas))); game.onSave = null;
    await readyGround(game, 8000);
  }
}

// ---------- dos jugadores por el relay ----------
const CHEST = [19, 13], CHAIR = [20, 13];   // (dentro de la casa del pueblo)
// Lo que se oye por el chat (desde el principio, para no perder ningún aviso)
function listen(l) {
  const seen = [], old = l.say;
  l.say = (t, k) => { seen.push(t); old?.(t, k); };
  return { heard: w => seen.find(t => t.includes(w)) };
}
// Un sitio con agua alrededor, cerca de un río
function riverSpot(game) {
  const w = game.world;
  for (let r = 60; r < 400; r += 4) for (let a = 0; a < 64; a++) {
    const x = Math.round(21 + Math.cos(a / 64 * 6.283) * r), y = Math.round(24 + Math.sin(a / 64 * 6.283) * r);
    if (w.water(x, y) && w.water(x + 1, y) && w.water(x - 1, y) && w.water(x, y + 1) && w.water(x, y - 1)) return [x, y];
  }
  return null;
}
// The sunken chest nearest the village (gen.seabed, the same on every peer): { o, cx, cy } or null
function sunkSpot(game) {
  const G = game.world.gen, cx0 = Math.floor(21 / CHUNK), cy0 = Math.floor(26 / CHUNK);
  for (let r = 0; r <= 48; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
    if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
    const o = G.seabed(cx0 + i, cy0 + j).finds.find(q => q.kind === 'sunken_chest');
    if (o) return { o, cx: cx0 + i, cy: cy0 + j };
  }
  return null;
}
async function hostTests(game) {
  const l = game.live, { heard } = listen(l);
  await test('dos: el anfitrión entra en el relay', async () => {
    await l.connect(RELAY); await until(() => l.status === 'on', 15000, 'el relay');
    l.join(null, 'host'); await frames(5); check(l.role === 'host', 'no lleva el mundo');
  });
  await test('dos: deja un cofre con madera para el invitado', async () => {
    await goTo(game, CHEST[0] + 0.5, CHEST[1] + 1.5);
    if (game.world.at('placed', ...CHEST)) game.world.unplace({ tile: CHEST, layer: 'placed', placed: game.world.at('placed', ...CHEST).split('@')[0] });
    game.world.place(...CHEST, 'cofre'); game.world.chestAt(...CHEST)[0] = { id: 'madera', n: 5 }; game.world.chestTouched(...CHEST);
  });
  await test('dos: llega el invitado y ve el cofre', async () => {
    await until(() => l.others.some(o => o.playing), 90000, 'al invitado');
    await until(() => heard('COFRE-VISTO'), 30000, 'el aviso del invitado');
  });
  await test('dos: la silla que pone el invitado aparece aquí', async () => {
    const got = [], refused = [], oa = l.applyChunk.bind(l), or = l.refuse.bind(l);
    l.applyChunk = (k, ops) => { got.push(k); return oa(k, ops); }; l.refuse = (c, peer, k, ops) => { refused.push(k); return or(c, peer, k, ops); };
    try { await until(() => (game.world.at('placed', ...CHAIR) || '').startsWith('silla'), 90000, `la silla del invitado (llegaron: ${got.join(' ') || 'nada'}; rechazados: ${refused.join(' ') || 'nada'}; el invitado está en ${JSON.stringify(l.others[0]?.at)})`); }
    finally { l.applyChunk = oa; l.refuse = or; }
    l.chat('SILLA-VISTA');
  });
  const guest = () => l.others.find(o => o.playing);
  await test('dos: lo que el invitado quita de una casa, se quita para todos', async () => {
    const W = game.world, h = HOUSES.bruno, t = [h.x0 + 2, h.y1 - 1];
    check(W.at('placed', ...t), 'no hay muro');
    l.chat(`QUITA ${t[0]} ${t[1]}`);
    await until(() => heard('QUITADO'), 85000, 'a que lo quite');
    await until(() => !W.at('placed', ...t) && !W.at('roof', ...t), 30000, 'verlo aquí');
    check(W.deltas.get(`${Math.floor(t[0] / CHUNK)},${Math.floor(t[1] / CHUNK)}`).gone?.[`${t[0]},${t[1]}`], 'no queda apuntado');
    l.chat('QUITADO-VISTO');
  });
  await test('dos: el invitado ve la flecha y la recoge', async () => {
    const A = game.archery, I = game.inv, X = 62, Y = 56;
    await goTo(game, X, Y); game.mouse = null;
    I.add('arco', 1); I.add('flecha', 2); const was = I.selected; I.slots.splice(0, 0); const at = I.slots.findIndex(s => s?.id === 'arco');
    const a = A.add({ id: 'prueba-1', x: X + 1, h: game.view3d.groundY(game.world, X + 1, Y) + 1, y: Y, vx: 4, vh: 1, vy: 0, dmg: 3, mine: true, free: false, scene: game.world });
    l.net.send({ t: 'arrow', id: a.id, x: a.x, h: a.h, y: a.y, vx: a.vx, vh: a.vh, vy: a.vy, free: 0 });
    await until(() => a.stuck, 8000, 'que se clave');
    l.chat(`FLECHA ${a.x} ${a.y}`);
    await until(() => !A.list.includes(a), 70000, 'que la recoja el invitado');
    I.remove('arco', 1); I.remove('flecha', 2); I.select(was); check(at >= -1, '');
    l.chat('FLECHA-VISTA');
    await frames(30);
  });
  await test('dos: el ciervo es el mismo para los dos', async () => {
    const W = game.wildlife, X = 62, Y = 52;
    await goTo(game, X, Y - 12);
    const d = W.summon('ciervo', X, Y);
    l.chat(`CIERVO ${d.id} ${X} ${Y}`);
    await until(() => heard('CIERVO-MUERTO'), 85000, 'a que el invitado lo cace');
    check(!W.list.includes(d), 'sigue aquí');
    l.chat('CIERVO-VISTO');
    await frames(30);
  });
  await test('dos: en la barca caben dos', async () => {
    const spot = riverSpot(game), me = game.player; check(spot, 'no hay un río cerca');
    await goTo(game, ...spot); me.boat = true;
    l.chat(`BARCA ${spot[0]} ${spot[1]}`);
    await until(() => guest()?.entity?.aboard === Profile.id, 70000, 'a que se suba a la barca');
    check(guest().entity.boat === false, 'el pasajero lleva su propia barca');
    me.x += 0.6; me.faceTo(1, 0); me.face = { x: 1, y: 0 };
    l.chat('REMO');
  });
  await test('dos: quien va de pasajero baja con quien rema', async () => {
    const me = game.player;
    await until(() => heard('SIGUE'), 70000, 'a que me siga');
    const w = game.world;
    let land = null; for (let r = 1; r < 60 && !land; r++) for (let a = 0; a < 16 && !land; a++) { const x = me.x + Math.cos(a / 16 * 6.283) * r, y = me.y + Math.sin(a / 16 * 6.283) * r; if (!w.water(x, y) && !w.blocked(x, y)) land = [x, y]; }
    check(land, 'no hay tierra cerca');
    me.boat = false; me.x = land[0]; me.y = land[1];
    await until(() => heard('EN-TIERRA'), 70000, 'a que baje');
  });
  await test('dos: la cama doble, cada uno a un lado', async () => {
    const H = game.houseRect(), w = game.world, F = game.family, me = game.player;
    await goTo(game, (H.x0 + H.x1) / 2, (H.y0 + H.y1) / 2);
    const fit = id => { for (let y = H.y0 + 1; y < H.y1 - 1; y += 0.5) for (let x = H.x0 + 1; x < H.x1 - 1; x += 0.5) { const f = w.fitFree(id, x, y, 0, 0, null); if (f.ok) return f; } return null; };
    const cuna = fit('cuna'); check(cuna, 'no cabe la cuna'); w.placeFree('cuna', cuna);
    const bed = fit('cama_doble'); check(bed, 'no cabe la cama doble'); w.placeFree('cama_doble', bed); await frames(2);
    const o = w.placedNear(me.x, me.y, 16).find(o => o.placed === 'cama_doble'); check(o, 'no está la cama');
    check(F.furniture('cuna').length && !F.why(), `no se puede: ${F.why()}`);
    me.x = o.x; me.y = o.y + 2; game.rest.lie(o); check(me.pose?.kind === 'lie' && game.rest.twin, 'no se tumba en un lado');
    l.chat(`CAMA ${o.x.toFixed(2)} ${o.y.toFixed(2)}`);
    // Con alguien del mismo sexo al otro lado no sale el corazón
    await until(() => heard('TUMBADA-ELLA'), 70000, 'a que se tumbe la otra');
    await until(() => guest()?.entity?.pose?.kind === 'lie', 20000, 'verla tumbada');
    await frames(10); check(!F.pair && document.getElementById('love').hidden, 'sale el corazón con alguien del mismo sexo');
    l.chat('SIN-CORAZON');
  });
  await test('dos: los dos pulsan el corazón y sale la escena', async () => {
    const F = game.family;
    await until(() => F.pair && guest().entity?.look?.sex === 'chico', 70000, 'a que se tumbe él y salga el corazón');
    check(!document.getElementById('love').hidden, 'no se ve el corazón');
    document.getElementById('love-heart').click();
    check(F.pair.mine && !F.scene && !F.v.expecting, 'con uno solo no vale');
    await until(() => F.scene, 40000, 'a que él pulse el suyo');
    check(document.getElementById('love').hidden, 'el corazón sigue durante la escena');
    await until(() => F.hearts.length > 3, 30000, 'los corazones');
    check(F.v.expecting?.mother === Profile.id && F.v.expecting.looks.length === 2, `no está embarazada ella: ${JSON.stringify(F.v.expecting)}`);
    check(F.bellyOf(game.player) === 0, 'la barriga se nota el primer día');
    F.scene.t = 999; await frames(2); check(!F.scene, 'la escena no se acaba');
    F.hearts.forEach(h => { h.t = h.life; }); await frames(2); check(!F.hearts.length, 'los corazones no se van');
  });
  await test('dos: la barriga crece y nace el bebé', async () => {
    const F = game.family, me = game.player, x = F.v.expecting, n = F.v.kids.length, ask = hud.askText;
    x.since = F.today - 3; await frames(8);
    check(Math.abs(F.bellyOf(me) - 0.5) < 0.01, `a los 3 días: ${F.bellyOf(me)}`);
    const P = () => game.view3d.actors.models.get(me)?.person;
    draw(); check(P()?.belly?.visible, 'no se le ve la barriga');
    const small = P().belly.scale.z; x.since = F.today - 6; await frames(2); draw();
    check(P().belly.scale.z > small, 'no crece');
    await until(() => heard('BARRIGA-VISTA'), 70000, 'a que él la vea');
    hud.askText = (a, b, name) => Promise.resolve(name);
    try {
      game.rest.stand(); F.onDay(x.since + 7);
      check(F.v.kids.length === n + 1 && !F.v.expecting, 'no nace');
      await until(() => F.v.kids.at(-1).named !== false, 8000, 'el nombre');
      draw(); check(F.bellyOf(me) === 0 && !P().belly.visible, 'sigue la barriga después de nacer');
    } finally { hud.askText = ask; }
    l.chat('NACIDO');
    await until(() => heard('NACIDO-VISTO'), 70000, 'a que él lo vea');   // (si no se sigue jugando, no le llega)
  });
  await test('dos: el invitado mata a un animal y lo suelta para él', async () => {
    const R = game.ranch, X = 62, Y = 46;
    await goTo(game, X, Y - 3);
    const a = R.summon('oveja', X, Y), mine = R.summon('gallina', X + 1.5, Y); a.wait = mine.wait = 9999; mine.owner = 'prueba_a';
    const old = JSON.parse(JSON.stringify(R.animals.map(x => x.toSave())));
    l.chat(`CAZA ${X} ${Y}`);
    await until(() => heard('CAZADA'), 85000, 'a que la mate');
    check(!R.animals.includes(a), 'la oveja sigue aquí');
    check(R.animals.includes(mine) && mine.hp === undefined, 'el invitado ha pegado a lo que no es suyo');
    R.share(old); check(!R.animals.some(x => x.id === a.id), 'una lista vieja la resucita');
    l.chat('CAZA-VISTA');
    await frames(30);
    await until(() => heard('FIN-CAZA'), 40000, 'a que él acabe');
  });
  // Greeting each other (social.js): the guest greets, the host sees the gesture, the line and the notice, and greets back
  await test('dos: ve el saludo del invitado, el aviso, y lo devuelve con Y', async () => {
    const S = game.social, said = [], toasts = [], say = S.say.bind(S), toast = hud.toast;
    S.say = (e, text, o) => { said.push([e, text]); say(e, text, o); }; hud.toast = (m, k) => { toasts.push(m); toast(m, k); };
    try {
      l.chat('SALUDA-YA');
      await until(() => heard('SALUDO-HECHO'), 60000, 'el saludo del invitado');
      await frames(10);
      const g = guest()?.entity;
      check(g && g.emSeq > 0, 'no gesture of the guest');
      check(said.some(([e]) => e === g), 'no line over the guest');
      check(toasts.includes(t('social.toast.greeted', { name: guest().name })), `notices: ${toasts}`);
      check(S.back && game.time < S.back.until, 'no window to greet back');
      game.mouse = { x: 3, y: 3, in: false }; S.lastAt = -Infinity;
      S.press('key'); S.release('key');
      l.chat('SALUDO-DEVUELTO');
      // Nilo, greeted by the guest: his answer here too
      await until(() => heard('NILO-SALUDADO'), 60000, 'el saludo a Nilo');
      await frames(60);
      check(said.some(([e]) => e === game.world.nilo), 'Nilo does not answer the guest here');
      l.chat('NILO-VISTO');
    } finally { delete S.say; hud.toast = toast; }
  });
  await test('dos: el cofre hundido, una vez (sunken chest once): the host opens it, the guest who asks after gets nothing', async () => {
    const c = sunkSpot(game); check(c, 'no sunken chest near the village');
    const { o, cx, cy } = c, p = game.player;
    l.chat(`HUNDIDO:${o.key}`);
    await until(() => heard('HUNDIDO-LISTO'), 85000, 'the guest at the chest');
    // (a talk left open by the greeting tests before, when they fail, would keep the host from moving: closed)
    if (hud.dialogOpen || game.busy) { hud.closeDialog(); game.busy = false; await frames(2); }
    await goTo(game, o.x + 0.6, o.y);
    await until(() => p.swim, 4000, 'swimming');
    p.dive = Math.max(0, WATER_Y - 0.7 - (p.sink || 0) - (o.bed + 0.4));
    const f = game.dive.reachable(p).find(q => q.o.key === o.key); check(f, 'the chest is not in reach');
    const money = game.money; game.dive.take(f);
    check(game.world.delta(cx, cy)?.opened?.[o.key] === Profile.id && game.money > money, 'the host does not open it at once');
    l.chat('HUNDIDO-ABIERTO');
    const said = await until(() => heard('HUNDIDO-VISTO'), 60000, 'the guest\'s answer');
    check(said.includes(`by=${Profile.id}`) && said.includes('SIN-BOTIN'), `the guest says: ${said}`);
    p.dive = 0; await goTo(game, 21, 26);
  });
  // The marked route's pin, shared (Plan J §2.9): the guest sees it and adopts it; a second share within 2 s is dropped
  await test('dos: shared mark (english): the guest sees the host\'s pin and adopts it; a second within 2 s is dropped', async () => {
    const R = game.route;
    await until(() => heard('WP-LISTO'), 85000, 'the guest ready for the mark');
    try {
      check(R.set({ x: 60.5, y: 40.5, kind: 'point', name: 'Mark test' }, { quiet: true }), 'the route is not set');
      check(R.canShare, 'the route cannot be shared');
      R.share(); R.share();   // (the second within 2 s: the guest drops it)
      l.chat('WP-ENVIADO');
      const said = await until(() => heard('WP-VISTO'), 60000, 'the guest\'s answer');
      await frames(30);
      check(said.includes('WP-VISTO ok'), `the guest says: ${said}`);
      check(!R.pins.size, 'the adopted pin came back to the host');
    } finally { R.clear('user'); }
  });
}
async function guestTests(game) {
  const l = game.live, { heard } = listen(l);
  await test('dos: el invitado entra en el mundo del anfitrión', async () => {
    await l.connect(RELAY); await until(() => l.status === 'on', 15000, 'el relay');
    await until(() => l.host?.playing, 60000, 'a que el anfitrión juegue');
    const solo = { save: game.snapshot(), deltas: new Map() };
    // (con dos Chromes por software el anfitrión puede estar compilando materiales: se pide el mundo hasta tres veces)
    let world = null; for (let i = 0; i < 3 && !world; i++) { try { world = await l.requestWorld(); } catch (e) { if (i === 2) throw e; } }
    const { save, deltas } = l.enter(solo, world);
    game.end(); game.start(save, deltas); l.join(solo, 'guest');
    await readyGround(game, 6000);
    check(l.guest, 'no es invitado');
  });
  await test('dos: ve el cofre del anfitrión con su madera', async () => {
    await until(() => game.world.chestAt(...CHEST)?.[0]?.id === 'madera', 40000, 'el cofre');
    check(game.world.chestAt(...CHEST)[0].n === 5, 'la madera no son 5');
    l.chat('COFRE-VISTO');
  });
  await test('dos: pone una silla y el anfitrión la ve', async () => {
    await goTo(game, CHAIR[0] + 0.5, CHAIR[1] + 1.5);
    game.world.place(...CHAIR, 'silla');
    await frames(30);
    const how = () => `pendientes ${l.pending.size}, aquí hay ${game.world.at('placed', ...CHAIR)}, estado ${l.status}, anfitrión ${l.hostConn}, invitado ${l.guest}`;
    await until(() => heard('SILLA-VISTA'), 150000, `el aviso del anfitrión (${how()})`);
  });
  const nums = (word) => { const t = heard(word); return t.slice(t.indexOf(word) + word.length).trim().split(' ').map(Number); };
  await test('dos: quita un muro de una casa del pueblo', async () => {
    const B = game.build, W = game.world, mouse = game.mouse, msg = await until(() => heard('QUITA '), 70000, 'el aviso'), t = msg.slice(msg.indexOf('QUITA ') + 6).trim().split(' ').map(Number);
    await goTo(game, t[0] + 0.5, t[1] + 2.5); game.mouse = null;
    try {
      B.toggle(true); B.select('quitar'); B.remove(t); B.remove(t);
      check(!W.at('placed', ...t) && !W.at('roof', ...t), 'no se quita aquí');
    } finally { game.mouse = mouse; B.select(PIECE_IDS[0]); B.toggle(false); }
    await frames(30);
    l.chat('QUITADO');
    await until(() => heard('QUITADO-VISTO'), 70000, 'a que el otro lo vea');
    check(!W.at('placed', ...t), 'vuelve a aparecer');
  });
  await test('dos: ve volar la flecha del otro y la recoge al pisarla', async () => {
    const A = game.archery, I = game.inv;
    const a = await until(() => A.list.find(x => x.id === 'prueba-1'), 70000, 'ver la flecha');
    check(!a.mine, 'la toma por suya');
    const t = await until(() => heard('FLECHA '), 70000, 'el aviso'), [x, y] = t.slice(t.indexOf('FLECHA ') + 7).trim().split(' ').map(Number);
    await until(() => a.stuck, 8000, 'que se clave aquí');
    const n = I.count('flecha'); await goTo(game, a.x + 0.3, a.y);
    await until(() => !A.list.includes(a), 8000, 'recogerla');
    check(I.count('flecha') === n + 1, 'no vuelve a la mochila'); check(Math.hypot(x - a.x, y - a.y) < 6, 'se clava en otro sitio');
    await until(() => heard('FLECHA-VISTA'), 70000, 'a que el otro lo vea');
  });
  await test('dos: ve el mismo ciervo, lo caza y se lleva lo suyo', async () => {
    const W = game.wildlife, H = game.hunt, inv = game.inv;
    const t = await until(() => heard('CIERVO '), 70000, 'el ciervo'), [id, x, y] = t.slice(t.indexOf('CIERVO ') + 7).trim().split(' ');
    const made = W.n, d = await until(() => W.list.find(w => w.id === id), 30000, 'ver el ciervo');
    await frames(60);
    check(Math.hypot(d.netTo[0] - +x, d.netTo[1] - +y) < 12, `lejos de donde está: ${d.netTo}`);
    check(W.n === made, 'aquí también aparecen');   // (los que hubiera solo, antes de entrar, no cuentan)
    game.player.crouch = true;
    const before = inv.count('carne_venado'); let last = 0;
    await until(() => {
      if (!W.list.includes(d)) return true;
      if (performance.now() - last > 1000) { last = performance.now(); game.player.x = d.x; game.player.y = d.y + 1.5; H.hit(d, ITEMS.espada); }
      return false;
    }, 80000, 'que muera el ciervo');
    game.player.crouch = false;
    openBig(game, d.x, d.y, 5);
    await collectDrops(game);
    check(inv.count('carne_venado') > before, 'no ha caído carne para él');
    l.chat('CIERVO-MUERTO');
    await until(() => heard('CIERVO-VISTO'), 70000, 'a que el anfitrión lo vea');
  });
  await test('dos: se sube a la barca del otro', async () => {
    await until(() => heard('BARCA '), 70000, 'la barca');
    const [x, y] = nums('BARCA '), me = game.player;
    await goTo(game, x, y + 1.2);
    const act = await until(() => l.host?.entity?.boat && game.crew.interact(me, game.world), 30000, 'poder subir');
    check(act.text.includes('Subir a la barca'), `dice: ${act.text}`);
    act.run(); check(me.aboard, 'no va a bordo');
    await frames(10);
    const host = l.host.entity, d = () => Math.hypot(host.x - me.x, host.y - me.y);
    check(Math.abs(d() - 0.7) < 0.1, `no va en su banco: a ${d()}`);
    check(me.toSave().boat, 'guardando en la barca de otro, se ahogaría');
    const at = [me.x, me.y];
    await until(() => heard('REMO'), 70000, 'a que reme');
    await until(() => Math.hypot(me.x - at[0], me.y - at[1]) > 0.3, 30000, 'que la barca me lleve');
    check(Math.abs(d() - 0.7) < 0.15, `se queda atrás: a ${d()}`);
    l.chat('SIGUE');
  });
  await test('dos: baja cuando baja quien rema', async () => {
    const me = game.player;
    await until(() => !me.aboard, 70000, 'a bajar');
    check(!me.boat && !game.world.water(me.x, me.y), 'no ha bajado a tierra');
    l.chat('EN-TIERRA');
  });
  await test('dos: se tumba al otro lado; del mismo sexo, sin corazón', async () => {
    const me = game.player;
    await until(() => heard('CAMA '), 70000, 'la cama');
    const [x, y] = nums('CAMA ');
    await goTo(game, x, y + 2);
    const o = await until(() => game.world.placedNear(x, y, 3).find(o => o.placed === 'cama_doble'), 40000, 'ver la cama');
    await until(() => l.host?.entity?.pose?.kind === 'lie', 20000, 'verla tumbada');
    game.rest.lie(o);
    check(me.pose?.kind === 'lie' && game.rest.twin, 'no se tumba');
    const host = l.host.entity; check(Math.hypot(host.x - me.x, host.y - me.y) > 0.6, `en el mismo lado: a ${Math.hypot(host.x - me.x, host.y - me.y)}`);
    l.chat('TUMBADA-ELLA');
    await until(() => heard('SIN-CORAZON'), 70000, 'el aviso');
    check(!game.family.pair, 'sale el corazón con alguien del mismo sexo');
    game.rest.stand();
    me.look = { ...me.look, sex: 'chico' };   // (ahora, de chico)
    await frames(10);
    me.x = x; me.y = y + 2; game.rest.lie(o); check(me.pose?.kind === 'lie', 'no se tumba otra vez');
  });
  await test('dos: los dos pulsan el corazón y queda embarazada ella', async () => {
    const F = game.family, me = game.player, host = () => l.host?.entity;
    await until(() => F.pair, 40000, 'el corazón');
    await until(() => F.theirs === F.pair?.conn, 40000, 'a que ella pulse el suyo');
    document.getElementById('love-heart').click();
    check(F.scene, 'no sale la escena');
    await until(() => F.v.expecting, 40000, 'la noticia');
    check(F.v.expecting.mother === 'prueba_a', `la madre es ${F.v.expecting.mother}`);
    check(F.bellyOf(me) === 0, 'la barriga le sale a él');
    F.scene && (F.scene.t = 999); await frames(2);
    await until(() => F.bellyOf(host()) > 0, 40000, 'ver que le crece la barriga');
    const P = () => game.view3d.actors.models.get(host())?.person;
    await until(() => { draw(); return P()?.belly?.visible; }, 20000, 'verle la barriga');
    check(!game.view3d.actors.models.get(me)?.person?.belly?.visible, 'a él también');
    l.chat('BARRIGA-VISTA');
    await until(() => heard('NACIDO'), 70000, 'el nacimiento');
    await until(() => F.v.kids.length > 0 && !F.v.expecting && F.bellyOf(host()) === 0, 40000, 'que nazca aquí también');
    l.chat('NACIDO-VISTO');
  });
  await test('dos: mata a un animal del anfitrión y se lo lleva', async () => {
    const R = game.ranch, inv = game.inv, H = game.hunt;
    await until(() => heard('CAZA '), 70000, 'la caza');
    const t = heard('CAZA '), [x, y] = t.slice(t.indexOf('CAZA ') + 5).trim().split(' ').map(Number);
    await goTo(game, x, y + 1.2);
    const find = type => R.animals.find(a => a.type === type && Math.hypot(a.x - x, a.y - y) < 4);
    const a = await until(() => find('oveja'), 30000, 'ver la oveja'), mine = await until(() => find('gallina'), 30000, 'ver la gallina');
    check(!H.canHit(mine), 'deja pegar a lo de otro');
    l.net.send({ t: 'hita', id: mine.id, dmg: 10, x: game.player.x, y: game.player.y }, l.hostConn);   // (y si se pide igual, se niega)
    const before = inv.count('carne_cordero');
    // (huye con cada golpe y lo decide el anfitrión, que con dos Chromes por software tarda en contestar: se la persigue y se espera)
    let last = 0;
    await until(() => {
      if (!R.animals.includes(a)) return true;
      if (performance.now() - last > 1000) { last = performance.now(); game.player.x = a.x; game.player.y = a.y + 1.2; H.hit(a, ITEMS.espada); }
      return false;
    }, 80000, 'que muera la oveja');
    openBig(game, a.x, a.y, 5);   // (the default: the guest's game leaves the carcass, butchered here)
    await collectDrops(game);
    check(inv.count('carne_cordero') > before, 'no ha caído carne para él');
    l.chat('CAZADA');
    await until(() => heard('CAZA-VISTA'), 70000, 'a que el anfitrión lo vea');
    await frames(30);
    check(!R.animals.some(b => b.id === a.id), 'vuelve a aparecer');
    l.chat('FIN-CAZA');
  });
  await test('dos: el invitado saluda al anfitrión con gesto y frase', async () => {
    const S = game.social, said = [], say = S.say.bind(S);
    S.say = (e, text, o) => { said.push([e, text]); say(e, text, o); };
    try {
      await until(() => heard('SALUDA-YA'), 60000, 'a que el anfitrión espere');
      const h = await until(() => l.host?.entity, 30000, 'ver al anfitrión');
      await goTo(game, h.x + 1.5, h.y + 0.5);
      const c = await until(() => S.candidates().find(c => c.kind === 'player'), 20000, 'al anfitrión entre la gente');
      const seq = S.emSeq; S.lastAt = -Infinity; S.act(0, c);
      check(S.emSeq === seq + 1 && said.some(([e]) => e === game.player), 'no gesture or line');
      await frames(20);
      l.chat('SALUDO-HECHO');
      await until(() => heard('SALUDO-DEVUELTO'), 60000, 'el saludo de vuelta');
      await until(() => said.some(([e]) => e === h), 20000, 'la frase del anfitrión');
      // Nilo (always in the plaza in both games): the host sees him answer
      const nilo = game.world.nilo; await goTo(game, nilo.x + 1.4, nilo.y + 1);
      S.lastAt = -Infinity; S.act(0, S.candidates().find(c => c.id === 'nilo'));
      await frames(20);
      l.chat('NILO-SALUDADO');
      await until(() => heard('NILO-VISTO'), 60000, 'a que el anfitrión lo vea');
    } finally { delete S.say; }
  });
  await test('dos: el cofre hundido (sunken chest): asking after the host opened it gives nothing; both see it open, by the host', async () => {
    const msg = await until(() => heard('HUNDIDO:'), 90000, 'the host\'s chest'), key = msg.slice(msg.indexOf('HUNDIDO:') + 8).trim().split(/\s/)[0];
    const c = sunkSpot(game); check(c?.o.key === key, `another chest here: ${c?.o.key} / ${key}`);
    const { o, cx, cy } = c, p = game.player, toast = hud.toast, toasts = [];
    await goTo(game, o.x - 0.6, o.y); await until(() => p.swim, 4000, 'swimming');
    p.dive = Math.max(0, WATER_Y - 0.7 - (p.sink || 0) - (o.bed + 0.4));
    const f = game.dive.reachable(p).find(q => q.o.key === o.key); check(f, 'the chest is not in reach');
    const money = game.money;
    hud.toast = (m, k) => { toasts.push(String(m)); return toast.call(hud, m, k); };
    try {
      l.chat('HUNDIDO-LISTO');
      await until(() => heard('HUNDIDO-ABIERTO'), 85000, 'the host opening it');
      game.dive.take(f);   // (its claim, if the opened chest has not come yet; else nothing to take)
      await until(() => game.world.delta(cx, cy)?.opened?.[o.key], 30000, 'the open chest here');
      await until(() => !game.dive.asked.has(o.key), 15000, 'the host\'s answer');
      await frames(30);
      const by = game.world.delta(cx, cy).opened[o.key], got = game.money !== money;
      l.chat(`HUNDIDO-VISTO by=${by} ${got ? 'BOTIN' : 'SIN-BOTIN'} ${toasts.includes(t('dive.too_late')) ? 'TARDE' : 'NO-PEDIDO'}`);
      console.log(`sunken chest, the guest: by ${by}, ${got ? 'loot' : 'no loot'}, ${toasts.includes(t('dive.too_late')) ? 'claimed and refused (too late)' : 'not claimed (it came open first)'}`);
      check(!got && by !== Profile.id, `the guest got the loot (${game.money - money}) or opened it (${by})`);
    } finally { hud.toast = toast; p.dive = 0; }
    await goTo(game, 21, 26);
  });
  await test('dos: shared mark (english): sees the host\'s pin with a toast, drops the second, adopts it from the map', async () => {
    const R = game.route, M = game.map, p = game.player, toast = hud.toast, toasts = [], v0 = R.pinsVersion;
    hud.toast = (m, k) => { toasts.push(String(m)); return toast.call(hud, m, k); };
    try {
      l.chat('WP-LISTO');
      await until(() => heard('WP-ENVIADO'), 85000, 'the host\'s mark');
      await until(() => R.pins.size > 0, 20000, 'the shared pin');
      const t0 = performance.now(); while (performance.now() - t0 < 2500) { await frames(2); await sleep(25); }
      const q = [...R.pins.values()][0], once = R.pinsVersion - v0 === 1;
      // (adopted from the big map: a click on the pin's head)
      // (the map centred on the pin: the guest may be anywhere by now)
      M.zoom = 4; M.recenter(); if (q) { M.pan.x = nearX(q.x, p.x) - p.x; M.pan.y = q.y - p.y; } M.drawBig(game.world.gen, game.explored, p.x, p.y, 0);
      const h = M.hits.find(s => s.pin === 'shared');
      if (h) R.pickAt(...M.toWorld(h.sx, h.sy - 8), h.sx, h.sy - 8);
      const ok = once && q?.x === 60.5 && q.y === 40.5 && q.name === 'Mark test' && !!h && R.active && R.target.x === 60.5 && R.target.y === 40.5 && !R.pins.size && toasts.some(m => m.includes(q.by) && q.by);
      const why = `once ${once} (${R.pinsVersion - v0}), pin ${JSON.stringify(q)}, on the map ${!!h}, route ${JSON.stringify(R.target)}, pins left ${R.pins.size}, toasts ${toasts.join(' / ')}`;
      l.chat(`WP-VISTO ${ok ? 'ok' : 'mal'} ${why}`.slice(0, 280));
      check(ok, why);
    } finally { hud.toast = toast; R.clear('user'); }
  });
}

export async function runTests(game) {
  addEventListener('error', e => errors.push(e.message));
  const err = console.error.bind(console); console.error = (...a) => { errors.push(a.map(x => x?.stack || String(x)).join(' ').slice(0, 300)); err(...a); };
  addEventListener('unhandledrejection', e => errors.push(`rechazo: ${e.reason?.message || e.reason}`));
  await mockProfile(game);
  ['s-login', 's-menu', 's-creator'].forEach(id => document.getElementById(id)?.classList.remove('show'));
  document.body.classList.add('playing');
  document.getElementById('fade')?.classList.remove('on');
  if (PART !== 'mirar') hud.ask = (who, text, options) => Promise.resolve(0);   // (las preguntas, siempre la primera opción: que nada se quede esperando)
  game.visiting = true;
  if (PART === 'mirar') { game.start(fresh()); game.onSave = null; return; }
  // (en el Chrome invisible el dibujo va por software: lo más barato posible, sin sombras ni resolución)
  const r = game.view3d.renderer; if (r) { r.shadowMap.enabled = false; r.setPixelRatio(0.5); game.view3d.auto = false; game.view3d.resize(); }
  // (el bucle del navegador no avanza ni dibuja nada: lo hacen las pruebas con frames())
  step = game.update.bind(game); draw = game.render.bind(game);
  game.update = () => {}; game.render = () => {};
  game.start(fresh());
  game.inv.equip.espalda = { id: 'mochila', color: ITEMS.mochila.dye }; game.inv.changed();   // (con mochila: que quepa lo que se recoge)
  game.onSave = null;
  if (game.mouse) game.mouse.in = false;
  await readyGround(game, 90000);   // (el primer dibujo por software compila todos los materiales: que no cuente)
  try {
    if (PART === 'dos') await (WHO === 'b' ? guestTests(game) : hostTests(game));
    else await soloTests(game);
  } catch (e) { tell('pruebas', false, `se han parado: ${e.message}`); }
  const ko = results.filter(r => !r.ok).length;
  console.log(`FIN ${results.length - ko} bien, ${ko} mal`);
  document.title = `FIN ${results.length - ko} bien, ${ko} mal ${JSON.stringify(results.filter(r => !r.ok).map(r => `${r.name}: ${r.detail}`.slice(0, 300)))}`;
  fetch('/pruebas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ who: WHO, fin: true, ok: results.length - ko, ko }) }).catch(() => {});
}
