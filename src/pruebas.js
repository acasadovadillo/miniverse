// Pruebas automáticas del juego. Las lanza probar.py en un Chrome invisible con ?modo=pruebas: el juego arranca con
// una cuenta de prueba (sin contraseña ni GitHub: nada se guarda fuera de este navegador) y una partida nueva, y va
// haciendo lo básico (recolectar, pisotear la tierra labrada, el hambre, el pueblo seguro, los primeros pasos, fabricar, colocar, cofres, puertas, comandos, mapas, cocos, la noria, las
// casas de los animales, las vallas, guardar y cargar) comprobando que pasa lo que tiene que pasar. Cada prueba se cuenta a probar.py (POST /pruebas) y sale
// también en la consola. Con &parte=dos&relay=ws://…, dos juegos (quien=a, el anfitrión, y quien=b, el invitado)
// comparten un mundo por el relay de pruebas y comprueban que cada uno ve lo que pone el otro.
import * as THREE from 'three';
import { Profile } from './accounts.js';
import { Person3D } from './three/people.js';
import { distTo } from './world/fit.js';
import { ITEMS, HARVEST, hitsFor } from './items.js';
import { SHOPS } from './economy.js';
import { repairMat } from './crafting.js';
import { RECIPES } from './recipes.js';
import { runCommand } from './commands.js';
import { CHUNK } from './world/gen.js';
import { B, BIOMES } from './world/biomes.js';
import { paintPixels } from './world/ground.js';
import { retireItems } from './game.js';
import { HOUSE, HOUSES, POND, YARD, BOUNDS, BOARD, CENTER, WORKSHOP, inBounds } from './world/village.js';
import { collide as collideNow } from './physics.js';
import { STEPS } from './steps.js';
import { machineAt, settle, MACHINES } from './machines.js';
import { hud } from './ui/hud.js';
import { freePlace } from './gather.js';
import { PIECE_IDS } from './build.js';
import { itemIcon } from './art/items.js';
import { modelKind, ICON3D } from './three/icons.js';

const GATE_X = 20;   // (el hueco de la valla del jardín, en el camino)
const q = new URLSearchParams(location.search), WHO = q.get('quien') || 'a', RELAY = q.get('relay'), PART = q.get('parte') || 'solo';   // parte: 'solo' (un jugador), 'dos' o 'mirar' (sin pruebas: el juego con la cuenta de prueba, para verlo)
const LOOK = { sex: 'chica', hairStyle: 'trenzas', hair: '#2a1e1e', skin: '#c98a5a', outfit: 'delantal', cloth: '#b84a8a', pants: '#4a3a2a', eyes: '#3a2a1e' };
const TEST_TIMEOUT = 25000, LOAD_TIMEOUT = 90000;
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
  return `${game.updateError ? `FALLO al avanzar: ${game.updateError}; ` : ''}${game.renderError ? `FALLO al dibujar: ${game.renderError}; ` : ''}modo ${game.mode}${game.busy ? ' (ocupado)' : ''}; suelo: ${T.blocks.size} bloques, ${T.pending.size} pedidos, ${T.jobs.size} trabajos, ${T.workers.length} hilos`;
}
const check = (cond, what) => { if (!cond) throw new Error(what); };

function tell(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ' · ' + detail : ''}`);
  fetch('/pruebas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ who: WHO, name, ok, detail }) }).catch(() => {});
}
async function test(name, fn) {
  const before = errors.length;
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
  await test('ropa: lo que cuelga de la cintura se abre cuando suben las piernas', async () => {
    for (const wear of [{ torso: { id: 'tunica_larga', color: '#222222' } }, { torso: { id: 'camisa', color: '#ffffff' }, piernas: { id: 'falda', color: '#b84a8a' } }, { torso: { id: 'camisa', color: '#ffffff' }, encima: { id: 'delantal', color: '#efe6d4' } }]) {
      const P = new Person3D({ ...LOOK, wear }, '').clone(); check(P.skirt?.children.length, `sin falda: ${JSON.stringify(wear)}`);
      P.legs[0].rotation.x = P.legs[1].rotation.x = 0; P.torso.rotation.x = 0.25; P.fitSkirt();
      check(P.skirt.scale.z === 1 && Math.abs(P.skirt.rotation.x + 0.25) < 1e-6, 'de pie no cuelga recto');
      P.legs[0].rotation.x = P.legs[1].rotation.x = -1; P.fitSkirt();
      check(P.skirt.scale.z > 1.3 && P.skirt.rotation.x < -0.3, 'con los muslos en alto no se abre');
    }
    const plain = new Person3D({ ...LOOK, wear: { torso: { id: 'camisa', color: '#ffffff' }, piernas: { id: 'pantalon', color: '#333333' } } }, '').clone();
    check(!plain.skirt, 'con pantalón hay falda'); plain.fitSkirt();
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
    runCommand(game, '/weather rain', say); check(game.weatherLock?.w === 'lluvia', `weather: ${said.at(-1)}`); runCommand(game, '/weather clear', say);
    runCommand(game, '/gamerule keepInventory true', say); check(game.rules.keepInventory === true, `gamerule: ${said.at(-1)}`); runCommand(game, '/gamerule keepInventory false', say);
    runCommand(game, '/gamemode creative', say); check(game.gamemode === 'creative', `gamemode: ${said.at(-1)}`); runCommand(game, '/gamemode survival', say); check(game.gamemode === 'survival', 'no vuelve a supervivencia');
    runCommand(game, '/help', say); check(said.some(s => s.includes('/tp')), 'help no lista /tp');
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
    const act = game.actionFor({ kind: 'fence', o }); check(act.text.startsWith('Recoger'), `dice: ${act.text}`); act.run();
    check(!w().ownAt('placed', tx, ty) && inv().count('valla') === n0 + 1, 'no ha vuelto a la mochila');
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
      else if (step.id === 'taller') { p().x = WORKSHOP.x0 + 3; p().y = WORKSHOP.y0 + 3; }
      else doing[step.id]?.();
      S.check(); check(S.i > before, `${step.id} no se cumple`);
    }
    check(S.over, `no se terminan: va por ${S.i}`);
    check(game.money === money + total, `recompensas: ${game.money - money}, esperaba ${total}`);
    check(document.getElementById('quest').hidden, 'al terminar sigue viéndose');
    const paid = game.money; S.restart(); check(!S.over && !S.pay, 'no se pueden repasar'); S.check(); doing.segar();
    for (let guard = 0; !S.over && guard < 30; guard++) { const step = S.step; if (step.stat) st.add(step.stat, step.need); else if (step.id === 'taller') { p().x = WORKSHOP.x0 + 3; p().y = WORKSHOP.y0 + 3; } S.check(); }
    check(S.over && game.money === paid, 'al repasarlos también pagan');
    check(game.steps.journal().includes('Repasarlos'), 'el diario no los lista');
    inv().equip.espalda = equip; inv().changed(); S.reset({ steps: was }); await goTo(game, 60, 36);
  });
  await test('puerta de valla: se une, empieza cerrada, se abre, y se recoge', async () => {
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
    const a = game.doorAction([gx, y]); check(a.alt?.text.includes('Recoger'), 'no se puede recoger'); a.alt.run();
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
    const tools = Object.entries(ITEMS).filter(([, d]) => ['hacha', 'pico', 'guadana', 'azada'].includes(d.tool));
    check(tools.length === 4 && tools.every(([id, d]) => id.endsWith('_hierro') && d.name.endsWith('de hierro')), `hay: ${tools.map(t => t[0]).join(', ')}`);
    for (const t of ['hacha', 'pico', 'guadana', 'azada']) {
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
  await test('iconos: los de lo que se coloca y las herramientas salen del modelo 3D, el resto a píxel', async () => {
    check(modelKind('silla') === 'placed' && modelKind('hacha_hierro') === 'tool' && !modelKind('madera') && !modelKind('camisa') && !modelKind('alfombra'), 'la clase de icono no es la esperada');
    const bad = [];
    for (const id of Object.keys(ITEMS)) {
      const c = itemIcon(id), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let magenta = 0, opaque = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100) { opaque++; if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] > 200) magenta++; }
      if (magenta > 20 || opaque < 10 || c.width !== (modelKind(id) ? ICON3D : 18)) bad.push(id);
    }
    check(!bad.length, `iconos vacíos, de relleno o de otro tamaño: ${bad.join(', ')}`);
  });
  await test('ganchos: ningún sistema tapa un gancho con otra cosa', async () => {
    const HOOKS = { target: 3, interact: 2, entities: 1, onDay: 1 };   // (los ganchos con parámetros: un método con ese nombre y otro uso los taparía)
    for (const s of game.systems) for (const [h, n] of Object.entries(HOOKS)) if (typeof s[h] === 'function' && s[h].length < n) throw new Error(`${s.constructor.name}.${h} tiene ${s[h].length} parámetros y el gancho pide ${n}`);
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
    await until(() => F.hearts.length > 3, 10000, 'los corazones');
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
    draw(); check(P()?.bellyMesh?.visible, 'no se le ve la barriga');
    const small = P().bellyMesh.scale.z; x.since = F.today - 6; await frames(2); draw();
    check(P().bellyMesh.scale.z > small, 'no crece');
    await until(() => heard('BARRIGA-VISTA'), 70000, 'a que él la vea');
    hud.askText = (a, b, name) => Promise.resolve(name);
    try {
      game.rest.stand(); F.onDay(x.since + 7);
      check(F.v.kids.length === n + 1 && !F.v.expecting, 'no nace');
      await until(() => F.v.kids.at(-1).named !== false, 8000, 'el nombre');
      draw(); check(F.bellyOf(me) === 0 && !P().bellyMesh.visible, 'sigue la barriga después de nacer');
    } finally { hud.askText = ask; }
    l.chat('NACIDO');
    await until(() => heard('NACIDO-VISTO'), 70000, 'a que él lo vea');   // (si no se sigue jugando, no le llega)
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
    await until(() => { draw(); return P()?.bellyMesh?.visible; }, 20000, 'verle la barriga');
    check(!game.view3d.actors.models.get(me)?.person?.bellyMesh?.visible, 'a él también');
    l.chat('BARRIGA-VISTA');
    await until(() => heard('NACIDO'), 70000, 'el nacimiento');
    await until(() => F.v.kids.length > 0 && !F.v.expecting && F.bellyOf(host()) === 0, 40000, 'que nazca aquí también');
    l.chat('NACIDO-VISTO');
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
  fetch('/pruebas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ who: WHO, fin: true, ok: results.length - ko, ko }) }).catch(() => {});
}
