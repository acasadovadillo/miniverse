// Pruebas automáticas del juego. Las lanza probar.py en un Chrome invisible con ?modo=pruebas: el juego arranca con
// una cuenta de prueba (sin contraseña ni GitHub: nada se guarda fuera de este navegador) y una partida nueva, y va
// haciendo lo básico (recolectar, pisotear la tierra labrada, el hambre, fabricar, colocar, cofres, puertas, comandos, mapas, cocos, la noria, las
// casas de los animales, las vallas, guardar y cargar) comprobando que pasa lo que tiene que pasar. Cada prueba se cuenta a probar.py (POST /pruebas) y sale
// también en la consola. Con &parte=dos&relay=ws://…, dos juegos (quien=a, el anfitrión, y quien=b, el invitado)
// comparten un mundo por el relay de pruebas y comprueban que cada uno ve lo que pone el otro.
import { Profile } from './accounts.js';
import { ITEMS } from './items.js';
import { RECIPES } from './recipes.js';
import { runCommand } from './commands.js';
import { CHUNK } from './world/gen.js';
import { B, BIOMES } from './world/biomes.js';
import { paintPixels } from './world/ground.js';
import { HOUSE } from './world/village.js';
import { machineAt, settle, MACHINES } from './machines.js';
import { hud } from './ui/hud.js';
import { freePlace } from './gather.js';
import { PIECE_IDS } from './build.js';
import { itemIcon } from './art/items.js';
import { modelKind, ICON3D } from './three/icons.js';

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
  await until(() => !game.gather.drops.length, 8000, 'a recoger lo que ha caído');   // (lo que cae vuela hasta el jugador)
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
  await test('colocar: el banco se pone libre, se usa y se recoge', async () => {
    await goTo(game, 60, 36);
    const f = w().fitFree('banco', p().x + 1.5, p().y, 0, 0, p()); check(f.ok, `no cabe: ${f.why}`);
    w().placeFree('banco', f); inv().remove('banco', 1); await frames(2);
    check(game.craft.stationsNear().banco, 'el banco no está cerca');
    const o = w().placedNear(p().x, p().y, 3).find(o => o.placed === 'banco'); check(o, 'no se encuentra el banco colocado');
    check(game.pickUp(o), 'no se recoge'); check(inv().count('banco') === 1, 'el banco no ha vuelto a la mochila');
    // Tirado al suelo se ve como el modelo en miniatura (no como icono hecho pieza) y vuelve solo a la mochila
    inv().remove('banco', 1); game.gather.throwOut('banco', 1); check(inv().count('banco') === 0 && game.gather.drops.length === 1, 'no se ha tirado');
    draw(); const fx = game.view3d.fx, shown = fx.drops.get(game.gather.drops[0]); check(shown?.s?.isGroup, 'en el suelo no está el modelo en miniatura');
    await until(() => !game.gather.drops.length, 8000, 'a recoger el banco'); check(inv().count('banco') === 1, 'el banco tirado no ha vuelto');
  });
  await test('cofre: guarda cosas y lleno no se recoge', async () => {
    const [tx, ty] = freeTile(game, [[62, 38], [63, 38], [62, 39], [61, 38]]);
    w().place(tx, ty, 'cofre'); const chest = w().chestAt(tx, ty); check(chest?.length === 18, 'el cofre no tiene 18 huecos');
    chest[0] = { id: 'madera', n: 2 };
    const o = w().placedObjectAt(tx, ty); check(o, 'no está el cofre');
    check(!game.pickUp(o), 'se ha recogido lleno');
    chest[0] = null; check(game.pickUp(o), 'vacío no se recoge');
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
    const act = game.actionFor({ kind: 'fence', o }); check(act.alt?.text === 'Recoger', 'no se puede recoger'); act.alt.run();
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
    check(modelKind('silla') === 'placed' && modelKind('hacha') === 'tool' && !modelKind('madera') && !modelKind('camisa') && !modelKind('alfombra'), 'la clase de icono no es la esperada');
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
async function hostTests(game) {
  const l = game.live;
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
    const seen = []; const old = l.say; l.say = (t, k) => { seen.push(t); old?.(t, k); };
    await until(() => seen.some(t => t.includes('COFRE-VISTO')), 30000, 'el aviso del invitado');
  });
  await test('dos: la silla que pone el invitado aparece aquí', async () => {
    const got = [], refused = [], oa = l.applyChunk.bind(l), or = l.refuse.bind(l);
    l.applyChunk = (k, ops) => { got.push(k); return oa(k, ops); }; l.refuse = (c, peer, k, ops) => { refused.push(k); return or(c, peer, k, ops); };
    try { await until(() => (game.world.at('placed', ...CHAIR) || '').startsWith('silla'), 90000, `la silla del invitado (llegaron: ${got.join(' ') || 'nada'}; rechazados: ${refused.join(' ') || 'nada'}; el invitado está en ${JSON.stringify(l.others[0]?.at)})`); }
    finally { l.applyChunk = oa; l.refuse = or; }
    l.chat('SILLA-VISTA');
  });
}
async function guestTests(game) {
  const l = game.live;
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
    const seen = []; const old = l.say; l.say = (t, k) => { seen.push(t); old?.(t, k); };
    await frames(30);
    const how = () => `pendientes ${l.pending.size}, aquí hay ${game.world.at('placed', ...CHAIR)}, estado ${l.status}, anfitrión ${l.hostConn}, invitado ${l.guest}`;
    await until(() => seen.some(t => t.includes('SILLA-VISTA')), 150000, `el aviso del anfitrión (${how()})`);
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
