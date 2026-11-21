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
import { distTo, dirOf } from './world/fit.js';
import { CAM, lookBy } from './camera.js';
import { keys, clearKeys } from './input.js';
import { ITEMS, HARVEST, hitsFor } from './items.js';
import { SHOPS } from './economy.js';
import { repairMat } from './crafting.js';
import { RECIPES } from './recipes.js';
import { runCommand } from './commands.js';
import { faults, resetFaults } from './faults.js';
import { CHUNK, WorldGen } from './world/gen.js';
import { B, BIOMES } from './world/biomes.js';
import { paintPixels, blockHeights, groundSmooth, groundTag } from './world/ground.js';
import { retireItems } from './game.js';
import { HOUSE, HOUSES, POND, YARD, BOUNDS, BOARD, CENTER, TAVERN, inBounds } from './world/village.js';
import { collide as collideNow } from './physics.js';
import { STEPS } from './steps.js';
import { machineAt, settle, MACHINES } from './machines.js';
import { hud } from './ui/hud.js';
import { freePlace } from './gather.js';
import { PIECE_IDS } from './build.js';
import { BUILDABLE } from './buildables.js';
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
import { WeightInventory, Carry } from './carry.js';
import { BULKY, BULKY_PARTS, CARCASS_OF, weightOf, BASE_CAP, BAG_CAP } from './carry-items.js';
import { Player } from './entities.js';
import { screenToWorld } from './camera.js';
import { makeCave } from './world/underground.js';
import { START_KIT } from './items.js';
import { kitOf, kitKey, placeKit, shownOf, splitKit, kindOf, SCABBARD } from './kit.js';
import { buildKit } from './three/kit3d.js';
import { holdPose } from './three/carry3d.js';
import { stowedGeo } from './three/actors.js';
import { t, tHtml, tList, fmt, formatMessage, defineNames, noun, setLang, getLang, onLangChange, accountLangOf, setAccountLang, savedLang, decideFirst, applyDom } from './i18n.js';

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
function freeTile(game, from) {
  const w = game.world, p = game.player;
  for (const [tx, ty] of from) if (w.canPlace(tx, ty, 'cofre', p)) return [tx, ty];
  throw new Error('no hay casilla libre para colocar');
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
    await game.days.sleep(); check(c.hunger === 14, `tras dormir el hambre está a ${c.hunger} (esperaba 14)`);
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
      check(!W.list.includes(d), 'el ciervo sigue vivo'); await collectDrops(game); check(count('carne_venado') >= v + 2, 'el ciervo no suelta carne');
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
    check(SHOPS.anselmo.stock.every(i => ITEMS[i.id]), 'vende lo que no existe');
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
      added: ['hud-status', 'hud-item', 'hud-delta', 'hud-tip', 'hud-build', 'hud-goal', 'hud-bow', 'hud-keys'].filter(el),
      tab: document.querySelector('[data-i18n="controls.players"]')?.textContent, styles: document.head.querySelectorAll('style').length,
    });
    const was = Settings.v.hud;
    check(!game.smartHud, 'the tests do not start with the full interface');
    const full = snap();
    W.closeAll();
    try {
      for (let round = 0; round < 2; round++) {
        // On (the second time, from the setting, as the player does it): the parts go to their places
        if (round) Settings.set('hud', 'minimal'); else useSmartHud(game, true);
        const sh = game.smartHud;
        check(sh && document.body.classList.contains('hud-min'), `round ${round}: it does not go on`);
        check(el('hearts').parentNode.id === 'hud-status' && el('money').parentNode === document.body, 'the parts are not in their places');
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
    check(So().emSeq === seq + 1 && ['fist', 'dismiss'].includes(EMOTE_KINDS[So().emKind]) && !So().hold && !ring(), `held 0.75 s: ${EMOTE_KINDS[So().emKind]}`);
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
    I.add('fresa', 1); I.select(I.slots.findIndex(s => s?.id === 'fresa'));
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
    const I = inv(); I.add('fresa', 1); I.select(I.slots.findIndex(s => s?.id === 'fresa'));
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
    const m = inv().count('madera'); await harvest(game, live, 'hacha'); check(inv().count('madera') > m, 'talarla no da madera');
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

  // ---------- the weight inventory and carrying in the arms (the prototype, ?inventario=peso: carry.js) ----------
  // The game, once, with the weight inventory (Carry.force, as with the URL) and, at the end, back as it was
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
  await test('peso carga (weight load): the game modules load with and without the prototype, without a cycle', async () => {
    check(WeightInventory.prototype instanceof Inventory, 'WeightInventory is not an Inventory');
    const src = async f => (await fetch(`src/${f}?t=${Date.now()}`)).text(), imports = text => [...text.matchAll(/^import[^;]*?from '([^']+)'|^import '([^']+)'/gm)].map(m => m[1] || m[2]);
    const inv = imports(await src('inventory.js')), items = imports(await src('carry-items.js'));
    check(!inv.some(f => /carry\.js$/.test(f)), `inventory.js imports carry.js: ${inv}`);
    check(items.every(f => /\/(items|i18n)\.js$/.test(f)), `carry-items.js imports more than items.js and i18n.js: ${items}`);
    check(ITEMS.log && ITEMS.log.hide && ITEMS.carcass_deer.bulky && !game.inv.weight && Carry.force === null, 'the new ids, or the game started with the prototype without the URL');
  });
  await test('peso (weight): each item weighs, the backpack adds capacity and nothing is ever refused', async () => {
    const W = new WeightInventory();
    for (const [id, n] of START_KIT) W.add(id, n);
    check(Math.abs(W.kg - 10.7) < 0.01 && W.capKg === BASE_CAP && BASE_CAP === 25, `the starting kit: ${W.kg} / ${W.capKg} kg`);
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
    check(Object.keys(new Inventory({ slots: [{ id: 'pan', n: 1 }] }).toSave()).sort().join() === 'equip,selected,slots,wardrobe', 'the slot save changed');
  });
  await test('peso partida vieja (old save): an overweight slot save keeps everything and walks slower', async () => {
    const old = { slots: Array.from({ length: 36 }, () => ({ id: 'piedra', n: 99 })), equip: { espalda: { id: 'mochila', color: ITEMS.mochila.dye } }, keep: [{ id: 'madera', n: 40 }, { id: 'cosa_nueva', n: 2 }] };
    const W = new WeightInventory(JSON.parse(JSON.stringify(old)));
    check(W.count('piedra') === 3564 && W.count('madera') === 40 && W.kept.some(e => e.s.id === 'cosa_nueva'), `stones ${W.count('piedra')}, wood ${W.count('madera')}`);
    const C = new Carry(fake(W));
    check(C.speedMul() === 0.45 && C.noRun() && C.jumpMul() >= 0.82, `speed ${C.speedMul()}`);
    const s = W.toSave(); check(s.keep.some(k => k.id === 'cosa_nueva') && s.slots.length === 36, 'the save loses what is of a newer version');
  });
  await test('peso cargado (encumbered): speed, running, jump and tiredness follow the load; creative and riding ignore it', async () => {
    const W = new WeightInventory(), C = new Carry(fake(W)), at = kg => { W.slots.length = 0; W.slots.push(...Array(HOTBAR).fill(null)); W.equip.espalda = { id: 'mochila' }; W.add('piedra', kg); return C.speedMul(); };
    const close = (a, b) => Math.abs(a - b) < 1e-6;
    check(close(at(70), 1) && !C.noRun() && C.jumpMul() === 1, `r = 1: ${C.speedMul()}`);
    check(close(at(87.5), 0.8) && !C.noRun(), `r = 1.25: ${C.speedMul()}`);
    check(close(at(105), 0.6) && C.noRun(), `r = 1.5: ${C.speedMul()}`);
    check(close(at(210), 0.45) && C.noRun(), `r = 3: ${C.speedMul()}`);
    const jump = 5 * C.jumpMul(); check(jump * jump / 30 > 0.5, `the jump (${jump}) does not get out of a hole`);
    for (const more of [{ player: { mount: true } }, { player: { boat: true } }, { player: { aboard: 'x' } }, { gamemode: 'creative' }]) { const D = new Carry(fake(W, more)); check(D.speedMul() === 1 && !D.noRun() && D.jumpMul() === 1, `ignored: ${JSON.stringify(more)}`); }
    // Tiredness, in the game: walking loaded tires more
    await weightOn();
    const g = game, kept = g.inv.slots.slice(), ex = g.combat.exert.bind(g.combat);
    let n = 0; g.combat.exert = k => { n += k; ex(k); };
    try {
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
    check(game.placedAction(log).text === t('carry.shoulder', { item: ITEMS.log }), `E says: ${game.placedAction(log).text}`);
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
    check(w().delta(Math.floor(c.tile[0] / 16), Math.floor(c.tile[1] / 16))?.carcass?.[`${c.tile}`] === game.days.dayIndex, 'its day is not noted');
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
    w().delta(Math.floor(cow.tile[0] / 16), Math.floor(cow.tile[1] / 16)).carcass[`${cow.tile}`] = game.days.dayIndex - 2;
    const bones = game.gather.drops.length; C.rot(); check(!near('carcass_cow', cow.x, cow.y, 0) && game.gather.drops.length > bones && game.gather.drops.at(-1).id === 'hueso', 'no bones after 2 days');
    await collectDrops(game);
  });
  await test('en brazos, límites (carry limits): Q only puts it down, a held click does not punch, no swimming, no running, no fence hopping, no mounting, sitting or sleeping; the backpack does not take it; in slot mode /give log gives wood', async () => {
    await weightOn();
    const C = game.carry, G = game.gather;
    C.set('log');
    try {
      G.cooldown = 0; G.swing = 0; G.use(); G.use(true); check(G.swing === 0 && G.cooldown === 0, 'a click with the arms full does something');
      check(C.noRun() && C.jumpMul() === 0.82 && C.hint() && game.inv.add('log', 1) === 1, 'run, jump, hint or the backpack');
      check(C.refuse() && C.held === 'log', 'refuse does not refuse');
      game.ranch.mount({ id: 'x', breed: 'alazan', x: p().x, y: p().y }); check(!p().mount, 'mounted with a log');
      game.rest.floor('floorSit'); check(!p().pose, 'sat down with a log');
      check(C.state() === 'log', 'the network does not say it');
    } finally { C.set(null); }
    check(!C.state() && !C.noRun(), 'empty arms');
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
      I.add('tablas', 2); game.build.paid('banco'); check(!I.count('tablas') && chest[1]?.n === 6 && chest[2]?.n === 2, `building: ${I.count('tablas')} / ${chest[1]?.n} / ${chest[2]?.n}`);
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
  await test('peso y en brazos, fin (weight end): the game back to slots, and a save played with the prototype opens without it', async () => {
    if (!weightBack) return;
    const W = game.snapshot();
    Carry.force = null;
    game.end(); game.start(JSON.parse(JSON.stringify(W)), new Map(JSON.parse(JSON.stringify([...game.world.deltas])))); game.onSave = null;
    check(!game.inv.weight && game.inv.slots.length === 36, 'the slot inventory does not come back');
    const back = weightBack; weightBack = null;
    game.end(); game.start(JSON.parse(back.snap), new Map(JSON.parse(back.deltas))); game.onSave = null;
    game.inv.equip.espalda ||= { id: 'mochila', color: ITEMS.mochila.dye }; game.inv.changed();
    await readyGround(game, 8000);
  });
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
