// Banco de medidas del dibujo (?banco=1). Recorre siempre las mismas paradas del mismo mundo, a la misma hora y con
// el mismo tiempo (plaza, de cerca, cámara baja, de lejos, bosque, noche y primera persona; y al final, una pradera de
// cerca, de lejos, con la cámara baja y en primera persona) y en cada una cuenta lo que se
// dibuja (llamadas y triángulos, aparte los del mapa de sombras) y lo que tarda de verdad cada fotograma: dibuja
// tandas seguidas y espera a que la gráfica las termine (leer un píxel obliga a acabarlas), porque sin esperar solo
// se mediría lo que tarda el navegador en encargar el trabajo. Lo lanza banco.py en un Chrome con la gráfica de
// verdad, que recoge las cifras y una captura de cada parada; también se puede abrir a mano en el navegador y leer
// el resultado en pantalla. No guarda nada: la cuenta es de prueba y la partida, nueva.
// banco.py --contra mide con este mismo archivo la versión de antes: lo que lee del juego tiene que valer en las dos
// (lo que solo tenga una, con ?. y sin romper si falta).
//   ?banco=1&px=1      resolución (×1 por defecto, para comparar; px=2 es la de una pantalla Retina)
//   &lotes=5&n=30      cuántas tandas de cuántos fotogramas se miden en cada parada
//   &solo=plaza,noche  solo esas paradas
//   &ab=luces,cielo…   además, lo que cuesta cada cosa (ver variants), quitándola en tandas alternas
//   &estacion=0..3     otra estación (por defecto, otoño: ver SEASON)
import { CAM, PITCH, DIST } from './camera.js';
import { Profile } from './accounts.js';
import { CENTER } from './world/village.js';
import { runCommand } from './commands.js';
import { CHUNK } from './world/gen.js';

const T_MODULE = performance.now();   // (cuando llega este código: lo anterior es cargar la página y el juego)
const Q = new URLSearchParams(location.search);
const STEP = 1 / 60, PX = +Q.get('px') || 1, LOTS = +Q.get('lotes') || 5, N = +Q.get('n') || 30;
const ONLY = Q.get('solo')?.split(',');
const LOOK = { sex: 'chica', hairStyle: 'trenzas', hair: '#2a1e1e', skin: '#c98a5a', outfit: 'delantal', cloth: '#b84a8a', pants: '#4a3a2a', eyes: '#3a2a1e' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => performance.now();
const sec = ms => +(ms / 1000).toFixed(1);
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
// El próximo fotograma sin tocar el mapa de sombras, o rehaciéndolo entero. Con la caché de lo fijo (sunshadow.js) se le
// pide a ella; en las versiones de antes, con el contador de fotogramas y la marca de la zona
const noShadows = v => { if (v.shadows) v.shadows.hold = true; else { v.frames = 1; v.shadowDirty = false; } };
const allShadows = v => { if (v.shadows) v.shadows.stale(true); else v.frames = 0; };
// La estación, fija: la del juego sale del calendario de verdad, y en otra cambian la hierba (en invierno queda menos
// de la mitad), las hojas de los árboles y hasta qué trozo es la pradera. Así una medida de hoy se puede comparar con
// otra de dentro de un mes. Otoño (2), como la medida de partida (9f538e8, 10-11-2026)
const SEASON = Q.has('estacion') ? Math.max(0, Math.min(3, Math.floor(+Q.get('estacion') || 0))) : 2;

// Las paradas: dónde está el jugador, cómo mira la cámara y a qué hora
const PLAZA = () => [CENTER.x, CENTER.y + 3];
const STOPS = [
  { name: 'plaza', at: PLAZA, cam: { yaw: Math.PI / 4, pitch: 0.84, dist: 22 }, hour: 12 },
  { name: 'cerca', at: PLAZA, cam: { yaw: Math.PI / 4 + 0.6, pitch: 0.42, dist: DIST.min }, hour: 12 },
  { name: 'plaza-baja', at: PLAZA, cam: { yaw: Math.PI / 4, pitch: PITCH.min + 0.05, dist: 22 }, hour: 12 },
  { name: 'lejos', at: PLAZA, cam: { yaw: Math.PI / 4 + 1.2, pitch: 0.6, dist: DIST.max }, hour: 12 },
  { name: 'bosque', at: g => forest(g), cam: { yaw: Math.PI / 4, pitch: 0.84, dist: 22 }, hour: 12 },
  { name: 'bosque-baja', at: g => forest(g), cam: { yaw: Math.PI / 4 + 2, pitch: PITCH.min + 0.05, dist: 18 }, hour: 12 },
  { name: 'noche', at: PLAZA, cam: { yaw: Math.PI / 4, pitch: 0.84, dist: 22 }, hour: 23 },
  { name: 'primera', at: PLAZA, cam: { yaw: Math.PI / 4 + Math.PI, first: true }, hour: 12 },
  // (las de la pradera, al final: las de antes se miden igual que siempre, en el mismo orden y con lo mismo detrás)
  { name: 'pradera', at: g => meadow(g), cam: { yaw: Math.PI / 4, pitch: 0.84, dist: 22 }, hour: 12 },
  { name: 'pradera-lejos', at: g => meadow(g), cam: { yaw: Math.PI / 4 + 1.2, pitch: 0.6, dist: DIST.max }, hour: 12 },
  { name: 'pradera-baja', at: g => meadow(g), cam: { yaw: Math.PI / 4 + 2, pitch: PITCH.min + 0.05, dist: 18 }, hour: 12 },
  { name: 'pradera-primera', at: g => meadow(g), cam: { yaw: Math.PI / 4 + Math.PI, first: true }, hour: 12 },
].filter(s => !ONLY || ONLY.includes(s.name));

// El trozo con más árboles cerca del pueblo (siempre el mismo: el mundo sale de la misma semilla)
let forestAt = null;
function forest(game) {
  if (forestAt) return forestAt;
  const w = game.world, cx = Math.floor(CENTER.x / CHUNK), cy = Math.floor(CENTER.y / CHUNK);
  let best = -1;
  for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 3) continue;   // (fuera del pueblo)
    const n = w.contentFor(cx + dx, cy + dy).objects.filter(o => ['oak', 'pine'].includes(o.kind) && !o.poi).length;
    if (n > best) { best = n; forestAt = [(cx + dx + 0.5) * CHUNK, (cy + dy + 0.5) * CHUNK]; }
  }
  return forestAt;
}

// El trozo más de pradera cerca del pueblo, para medir la hierba: el que tiene más casillas con hierba (gen.grassAt,
// una de cada cuatro) y menos árboles, rocas o casas que la tapen (cada uno, unas doce casillas vistas desde arriba),
// contando también los trozos de alrededor (la cámara de siempre ve unas ±12 casillas y la de lejos, mucho más); el
// suyo cuenta doble. El jugador, en la casilla con hierba más cerca del centro que no tenga nada encima. Solo lee el
// mundo que sale de la semilla y la estación (fija, SEASON): no depende de la versión del dibujo, pero sí de la del
// mundo (gen.js), así que cada parada guarda dónde se ha puesto y banco.py --contra avisa si no coincide. Busca a
// ±7 trozos: con los de alrededor son los mismos ±8 que ya ha mirado forest(), y la caché de trozos (300) no se revuelve
let meadowAt = null;
function meadow(game) {
  if (meadowAt) return meadowAt;
  const w = game.world, gen = w.gen, cx = Math.floor(CENTER.x / CHUNK), cy = Math.floor(CENTER.y / CHUNK);
  const counted = new Map(), grass = (x, y) => {
    const k = `${x},${y}`;
    if (!counted.has(k)) { let n = 0; for (let ty = y * CHUNK; ty < (y + 1) * CHUNK; ty += 2) for (let tx = x * CHUNK; tx < (x + 1) * CHUNK; tx += 2) if (gen.grassAt(tx, ty) > 0) n++; counted.set(k, n); }
    return counted.get(k);
  };
  const solids = new Map(), solid = (x, y) => {   // (las flores no tapan la hierba)
    const k = `${x},${y}`;
    if (!solids.has(k)) solids.set(k, w.contentFor(x, y).objects.filter(o => !o.flower));
    return solids.get(k);
  }, open = (x, y) => grass(x, y) - 3 * solid(x, y).length;
  let best = -Infinity, at = null;
  for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 3) continue;   // (fuera del pueblo)
    const x = cx + dx, y = cy + dy;
    let score = open(x, y);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) score += open(x + i, y + j);
    if (score > best) { best = score; at = [x, y]; }
  }
  const [bx, by] = at, objs = solid(bx, by), mx = (bx + 0.5) * CHUNK, my = (by + 0.5) * CHUNK;
  let d = Infinity;
  meadowAt = [mx, my];
  for (let ty = by * CHUNK; ty < (by + 1) * CHUNK; ty++) for (let tx = bx * CHUNK; tx < (bx + 1) * CHUNK; tx++) {
    const x = tx + 0.5, y = ty + 0.5, e = Math.hypot(x - mx, y - my);
    if (e < d && gen.grassAt(tx, ty) > 0 && !objs.some(o => Math.hypot(o.x - x, o.y - y) < 1.5)) { d = e; meadowAt = [x, y]; }
  }
  return meadowAt;
}

// Una cuenta de prueba y una partida nueva (si no lo ha hecho ya ?modo=pruebas&parte=mirar)
async function setup(game) {
  if (game.player) return;
  const key = crypto.subtle ? await crypto.subtle.importKey('raw', new Uint8Array(32).fill(7), 'AES-GCM', false, ['encrypt', 'decrypt']) : null;
  Object.defineProperties(Profile, { id: { get: () => 'banco', configurable: true }, name: { get: () => 'Banco', configurable: true }, admin: { get: () => true, configurable: true } });
  Profile.worldKey = () => Promise.resolve(key);
  Profile.store = () => Promise.resolve({ local: false, remote: null });
  Profile.storeWorld = () => Promise.resolve();
  ['s-login', 's-menu', 's-creator'].forEach(id => document.getElementById(id)?.classList.remove('show'));
  document.body.classList.add('playing');
  document.getElementById('fade')?.classList.remove('on');
  game.visiting = true;
  game.start({ player: { name: 'Banco', x: PLAZA()[0], y: PLAZA()[1], look: { ...LOOK } } });
  game.onSave = null;
}

export async function runBench(game) {
  const tStart = now();
  await setup(game);
  const tSetup = now();
  game.onSave = null;
  if (game.mouse) game.mouse.in = false;
  const v = game.view3d, r = v.renderer, gl = r.getContext(), px = new Uint8Array(4);
  // El bucle lo lleva el banco: el del navegador ya no avanza ni dibuja
  const step = game.update.bind(game), draw = game.render.bind(game);
  game.update = () => {}; game.render = () => {};
  const frame = () => { step(STEP); draw(); };
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const fixRes = () => { v.resize(); v.auto = false; v.pixelRatio = PX; r.setPixelRatio(PX); r.setSize(innerWidth, innerHeight, false); };
  fixRes();
  addEventListener('resize', fixRes);
  const say = () => {};
  runCommand(game, '/gamerule doDaylightCycle false', say);
  runCommand(game, '/weather clear forever', say);
  runCommand(game, '/gamemode creative', say);   // (que no le ataque nada ni pase hambre mientras se mide)
  // (la estación, fija: el reloj del juego la saca de la fecha; en el pueblo, al norte, la de aquí es esa misma)
  try { Object.defineProperty(game.days, 'season', { get: () => SEASON, configurable: true }); game.days.applySeason?.(); } catch {}
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const out = {
    gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    ua: navigator.userAgent, dpr: devicePixelRatio, px: PX, lienzo: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`,
    fecha: new Date().toISOString(), version: document.querySelector('meta[name="miniverse-version"]')?.content || '?',
    lotes: LOTS, n: N, paradas: [],
    // (en segundos desde que se abre la página: llega el código, el juego está creado, la partida empezada, el primer dibujo)
    tiempos: { modulo: sec(T_MODULE), juego: sec(tStart), partida: sec(tSetup) },
  };
  // (lo que tardó en llegar cada parte del código: Three.js viene de fuera)
  const res = performance.getEntriesByType('resource').filter(e => /\.js(\?|$)/.test(e.name));
  out.tiempos.three = sec(res.find(e => e.name.includes('three'))?.responseEnd || 0);
  out.tiempos.ultimoCodigo = sec(Math.max(0, ...res.map(e => e.responseEnd)));
  const tf = now(); frame(); out.tiempos.primerDibujo = sec(now()); out.tiempos.primerDibujoDura = sec(now() - tf);
  out.estacion = game.world.gen.season;
  console.log(`BANCO empieza: ${out.gpu}, lienzo ${out.lienzo}`);
  let hour = null;
  for (const s of STOPS) {
    const t0 = now();
    if (s.hour !== hour) { runCommand(game, `/time set ${String(s.hour).padStart(2, '0')}:00`, say); hour = s.hour; }
    const [x, y] = s.at(game);
    game.teleport(x, y);
    Object.assign(CAM, { turn: 0, tilt: 0, zoom: 0, first: !!s.cam.first, look: 0, yaw: s.cam.yaw });
    if (!s.cam.first) Object.assign(CAM, { pitch: s.cam.pitch, dist: s.cam.dist });
    Object.assign(v.cam, { vel: 0, pvel: 0, zvel: 0 });
    v.snap();
    const ready = await settle(game, v, frame);
    if (!out.arranque) out.arranque = sec(now());   // (desde que se abre la página hasta la primera parada lista)
    // Lo que se dibuja: un fotograma sin tocar el mapa de sombras, otro rehaciéndolo entero (lo fijo y lo que se mueve)
    // y uno normal (solo lo que se mueve, si la versión guarda lo fijo)
    noShadows(v); frame();
    const main = { ...v.lastInfo };
    allShadows(v); frame();
    const all = { ...v.lastInfo };
    // (que no se cuele un repintado de lo fijo: algo pendiente del mundo, la red de seguridad. Si aun así hay uno, se repite)
    const quiet = () => { if (v.shadows) { v.shadows.pending = false; v.shadows.lastStaticT = performance.now(); } return v.shadows?.nStatic; };
    const n0 = quiet(); frame();
    if (v.shadows && v.shadows.nStatic !== n0) { quiet(); frame(); }
    const moving = { ...v.lastInfo };
    const parts = breakdown(v, frame);
    if (s === STOPS[0]) for (let i = 0; i < 3; i++) { timeLot(frame, sync); await sleep(0); }   // (calentar: la primera tanda sale siempre peor)
    // Lo que tarda: tandas de N fotogramas como en el juego (sombras cada dos) y otras sin rehacer las sombras
    // (y aparte, lo que tarda avanzar el juego y lo que tarda encargar el dibujo, sin esperar a la gráfica)
    const lots = [], flat = [], up = [], dr = [];
    for (let i = 0; i < LOTS; i++) {
      let a = 0, b = 0;
      lots.push(timeLot(() => { const t = now(); step(STEP); const t2 = now(); draw(); a += t2 - t; b += now() - t2; }, sync));
      up.push(a / N); dr.push(b / N);
      flat.push(timeLot(() => { noShadows(v); frame(); }, sync));
      await sleep(0);
    }
    const cpu = cpuSplit(v, frame);
    if (Q.get('diag') === 'programas') {   // (qué materiales hacen a Three volver a elegir programa en cada fotograma)
      const count = new Map(), users = new Map();
      v.scene.traverse(o => { if (!o.material) return; for (const m of [].concat(o.material)) {
        if (!users.has(m)) { users.set(m, new Set()); const f = m.customProgramCacheKey; m.customProgramCacheKey = function () { count.set(m, (count.get(m) || 0) + 1); return f.call(this); }; m.__f = f; }
        users.get(m).add(`${o.isSkinnedMesh ? 'esqueleto' : o.isInstancedMesh ? 'instancias' : 'malla'}${o.receiveShadow ? '+recibe' : ''}${o.castShadow ? '+da' : ''}`);
      } });
      for (let i = 0; i < 10; i++) frame();
      const top = [...count].sort((a, b) => b[1] - a[1]).slice(0, 12);
      for (const [m, n] of top) console.log(`BANCO programas: ${(n / 10).toFixed(1)}/fotograma  ${m.type} ${m.name || ''} color=${m.color?.getHexString?.() || ''} map=${!!m.map} vc=${m.vertexColors} usos=${[...users.get(m)].join(',')}`);
      for (const m of users.keys()) { m.customProgramCacheKey = m.__f; delete m.__f; }
    }
    if (Q.get('perfil') && s === STOPS[0]) {   // (banco.py --perfil: el perfilador de Chrome, durante unas tandas)
      console.log('BANCO perfil: empieza'); await sleep(1500);
      for (let i = 0; i < 4; i++) { timeLot(frame, sync); await sleep(0); }
      console.log('BANCO perfil: acaba'); await sleep(1500);
    }
    // (en la misma página, sin el ruido de comparar dos Chromes)
    let ab = null;
    if (Q.get('ab')) {
      // (&ab=grupos,luces…: lo que cuesta cada cosa, quitándola en tandas alternas con todo puesto; lo que sale es
      // cuántos ms se ahorran sin ella)
      // (con el mínimo de cada lado: lo de fuera que use la gráfica a ráfagas solo puede sumar tiempo, nunca quitarlo)
      ab = {};
      for (const [k, set] of variants(v, Q.get('ab').split(','))) {
        const on = [], off = [];
        for (let i = 0; i < Math.max(LOTS, 9); i++) { set(false); frame(); off.push(timeLot(frame, sync)); set(true); frame(); on.push(timeLot(frame, sync)); await sleep(0); }
        ab[k] = +(Math.min(...on) - Math.min(...off)).toFixed(1);
      }
      console.log(`BANCO ${s.name}: cuesta (ms) ` + Object.entries(ab).map(([k, x]) => `${k} ${x}`).join(', '));
    }
    parts.contadores = counters(v, frame);
    const ms = median(lots), stop = {
      name: s.name, at: [+x.toFixed(1), +y.toFixed(1)], llamadas: main.calls, triangulos: main.triangles, llamadasSombra: all.calls - main.calls, triangulosSombra: all.triangles - main.triangles,
      llamadasSombraMovil: moving.calls - main.calls, triangulosSombraMovil: moving.triangles - main.triangles,
      ms: +ms.toFixed(1), fps: +(1000 / ms).toFixed(1), msSinSombra: +median(flat).toFixed(1), min: +Math.min(...lots).toFixed(1), max: +Math.max(...lots).toFixed(1),
      avanzar: +median(up).toFixed(2), encargar: +median(dr).toFixed(2), preparar: sec(now() - t0), ...ready, desglose: parts, cpu, ...(ab && { ab }),
      // (si la versión los lleva: los contadores de las personas que guarda el propio juego)
      ...(v.actors.stats && typeof v.actors.stats === 'object' && { personas: { ...v.actors.stats, ...(Number.isFinite(v.actorsMs) && { ms: +v.actorsMs.toFixed(2) }) } }),
    };
    out.paradas.push(stop);
    console.log(`BANCO ${s.name}: ${stop.ms} ms (${stop.fps} fps), sin sombras ${stop.msSinSombra} ms; ${stop.llamadas} llamadas + ${stop.llamadasSombra} de sombra (${stop.llamadasSombraMovil} de lo móvil); ${Math.round(stop.triangulos / 1000)} k + ${Math.round(stop.triangulosSombra / 1000)} k triángulos`);
    // La captura, justo después de dibujar (luego el lienzo se borra)
    frame();
    const img = r.domElement.toDataURL('image/jpeg', 0.85);
    await post('/banco/captura', { parada: s.name, img });
  }
  CAM.first = false;
  out.programas = r.info.programs?.length ?? null;
  out.geometrias = r.info.memory.geometries;
  out.texturas = r.info.memory.textures;
  out.memoria = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  // (la memoria de vídeo de verdad: lo que piden las texturas y los búferes, ver three/vram.js; las versiones sin él, nada)
  { const m = vramMB(r); if (m) { out.vramMB = m.tex; out.buferesMB = m.rb; } }
  // (el relieve: cuántos bloques salieron de lo guardado y cuántos se calcularon, y lo que tardó cada uno; con
  // banco.py --mismo-perfil, la primera vuelta sale fría y las demás calientes, como al recargar la página)
  if (v.terrain?.stats) out.relieve = Object.fromEntries(Object.entries(v.terrain.stats).map(([k, x]) => [k, Math.round(x * 10) / 10]));
  out.total = +(now() / 1000).toFixed(1);
  console.log('BANCO ' + JSON.stringify(out));
  await post('/banco', out);
  show(out);
  return out;
}

// A qué grupo pertenece cada cosa que se dibuja (suelo, casas, naturaleza, lejanos, personas…): el de la raíz conocida
// más cercana hacia arriba (la hierba va dentro de la naturaleza y gana la hierba: se mira primero lo más de dentro)
function labeler(v) {
  const L = new Map(), put = (o, name) => { if (o) L.set(o, name); };
  put(v.terrain.group, 'suelo'); put(v.terrain.water.group, 'agua'); put(v.sky, 'cielo');
  put(v.world.group, 'mundo, otros'); put(v.world.spin, 'trozos');
  for (const c of v.world.chunks.values()) put(c.group, 'trozos');
  for (const b of v.world.nature.values()) { put(b.group, 'naturaleza'); put(b.ground, 'hierba'); }
  for (const g of v.world.far.values()) put(g, 'lejanos');
  for (const r of v.world.regions.values()) { put(r.roof, 'tejados'); put(r.ceil, 'tejados'); }
  put(v.world.villageGroup, 'pueblo');
  put(v.actors.group, 'actores, otros');
  for (const m of v.actors.models.values()) put(m.root, groupOf(m));
  put(v.fx.group, 'efectos'); put(v.arrows?.group, 'flechas'); put(v.viewmodel, 'en la mano');
  const memo = new Map();
  return o => {
    let k = memo.get(o);
    if (k === undefined) { k = 'otros'; for (let p = o; p; p = p.parent) if (L.has(p)) { k = L.get(p); break; } memo.set(o, k); }
    return k;
  };
}

// El grupo de una persona, un animal o un monstruo (los de la noche, aparte: si no, se cuentan como animales)
const groupOf = m => m.kind === 'person' || m.kind === 'baby' ? 'personas' : m.kind === 'monster' ? 'monstruos' : 'animales';

// Cuántos triángulos dibuja de verdad una llamada, con las mismas cuentas que Three (r160, renderBufferDirect y
// WebGLInfo): solo el tramo que pide drawRange (los niveles de detalle dibujan el principio de la geometría), el del
// grupo si la malla lleva varios materiales, y por cada instancia. -1 si Three la corta sin dibujar (no cuenta como
// llamada); 0 si son líneas o puntos
function trianglesOf(geometry, material, object, group) {
  const index = geometry.index, pos = geometry.attributes.position, R = geometry.drawRange;
  let start = R.start, end = R.start + R.count;
  if (group) { start = Math.max(start, group.start); end = Math.min(end, group.start + group.count); }
  if (index) { start = Math.max(start, 0); end = Math.min(end, index.count); }
  else if (pos) { start = Math.max(start, 0); end = Math.min(end, pos.count); }
  const n = end - start, inst = instancesOf(geometry, object);
  if (n < 0 || n === Infinity || inst === 0) return -1;   // (sin instancias, Three tampoco llega a dibujarla)
  if (!(object.isMesh || object.isSprite) || material.wireframe) return 0;
  return Math.round(n / 3 * inst);
}
const instancesOf = (geometry, object) => object.isInstancedMesh ? object.count
  : geometry.isInstancedBufferGeometry ? Math.min(geometry.instanceCount, geometry._maxInstanceCount ?? Infinity) : 1;

// Cambia una función de un objeto por otra hecha a partir de ella (make(f)) y apunta en undo cómo dejarla como estaba
function patch(obj, name, make, undo) {
  if (!obj || typeof obj[name] !== 'function') return;
  const own = Object.prototype.hasOwnProperty.call(obj, name), f = obj[name];
  obj[name] = make(f);
  undo.push(() => { if (own) obj[name] = f; else delete obj[name]; });
}

// Qué se dibuja en cada llamada, por grupos (suelo, casas, naturaleza, lejanos, personas…), en la pasada normal y en
// la del mapa de sombras: un fotograma que rehace las sombras, apuntando cada llamada y lo que dibuja
function breakdown(v, frame) {
  const labelOf = labeler(v), r = v.renderer, out = { principal: {}, sombra: {} }, undo = [];
  patch(r, 'renderBufferDirect', orig => function (camera, scene, geometry, material, object, group) {
    const n = trianglesOf(geometry, material, object, group);
    if (n < 0) return orig.apply(this, arguments);   // (se corta sin dibujar: no cuenta)
    const into = camera.isOrthographicCamera && camera !== v.camera ? out.sombra : out.principal, k = labelOf(object), e = (into[k] ||= [0, 0]);
    e[0]++; e[1] += n;
    return orig.apply(this, arguments);
  }, undo);
  try { allShadows(v); frame(); } finally { for (const u of undo.reverse()) u(); }
  return out;   // grupo → [llamadas, triángulos]
}

// Contadores de unos fotogramas normales, como en el juego (sin forzar las sombras ni cronometrar nada), para ver por
// qué cambia lo que tarda: cuántas personas, animales y monstruos se llegan a dibujar (los que pasan el recorte de
// la cámara), en la pasada normal y en la de sombra; en cuántos fotogramas se rehace el mapa de sombras y con cuántas
// llamadas y triángulos; cuántas instancias se dibujan por grupo (las matas de la hierba, los árboles…) y lo que hay en la
// gráfica. Va después de medir la parada, así que no cambia lo medido
const COUNT_N = 12;   // (par: sin la caché de lo fijo, las sombras se rehacen cada dos fotogramas)
function counters(v, frame) {
  const labelOf = labeler(v), r = v.renderer, undo = [];
  const owner = new Map(), memo = new Map();
  for (const m of v.actors.models.values()) owner.set(m.root, m);
  const modelOf = o => {
    let m = memo.get(o);
    if (m === undefined) { m = null; for (let p = o; p; p = p.parent) if (owner.has(p)) { m = owner.get(p); break; } memo.set(o, m); }
    return m;
  };
  const main = new Set(), shade = new Set();
  let depth = 0;
  const sh = { fotogramas: 0, pasadas: 0, llamadas: 0, triangulos: 0 }, inst = {}, seen = { personas: 0, personasSombra: 0, animales: 0, animalesSombra: 0, monstruos: 0, monstruosSombra: 0 };
  // (una pasada de sombra que dibuja algo es un repintado: con la caché de lo fijo, también cuenta la de solo lo móvil)
  patch(r.shadowMap, 'render', orig => function (...a) {
    const c0 = sh.llamadas;
    depth++;
    try { return orig.apply(this, a); } finally { if (--depth === 0 && sh.llamadas > c0) sh.pasadas++; }
  }, undo);
  patch(r, 'renderBufferDirect', orig => function (camera, scene, geometry, material, object, group) {
    const n = trianglesOf(geometry, material, object, group);
    if (n >= 0) {
      if (depth) { sh.llamadas++; sh.triangulos += n; }
      else if (object.isInstancedMesh) { const k = labelOf(object); inst[k] = (inst[k] || 0) + object.count; }
      const m = modelOf(object);
      if (m) (depth ? shade : main).add(m);
    }
    return orig.apply(this, arguments);
  }, undo);
  const fixed0 = v.shadows?.nStatic;
  try {
    for (let i = 0; i < COUNT_N; i++) {
      main.clear(); shade.clear();
      const c0 = sh.llamadas;
      frame();
      if (sh.llamadas > c0) sh.fotogramas++;
      for (const m of main) seen[groupOf(m)]++;
      for (const m of shade) seen[groupOf(m) + 'Sombra']++;
    }
  } finally { for (const u of undo.reverse()) u(); }
  const per = x => +(x / COUNT_N).toFixed(2), models = [...v.actors.models.values()];
  const tally = list => ({ modelos: list.length, encendidos: list.filter(m => m.root.visible).length });
  return {
    fotogramas: COUNT_N,
    personas: { ...tally(models.filter(m => groupOf(m) === 'personas')), dibujadas: per(seen.personas), enSombra: per(seen.personasSombra) },
    animales: { ...tally(models.filter(m => groupOf(m) === 'animales')), dibujados: per(seen.animales), enSombra: per(seen.animalesSombra) },
    monstruos: { ...tally(models.filter(m => groupOf(m) === 'monstruos')), dibujados: per(seen.monstruos), enSombra: per(seen.monstruosSombra) },
    sombras: { rehechasPorFotograma: per(sh.fotogramas), pasadasPorFotograma: per(sh.pasadas), llamadasPorFotograma: per(sh.llamadas), triangulosPorFotograma: Math.round(sh.triangulos / COUNT_N),
      // (con la caché de lo fijo: en cuántos fotogramas se repinta lo fijo; el resto solo lleva lo que se mueve)
      ...(fixed0 !== undefined && { fijoPorFotograma: per(v.shadows.nStatic - fixed0) }) },
    instancias: Object.fromEntries(Object.entries(inst).map(([k, n]) => [k, Math.round(n / COUNT_N)])),
    memoria: { geometrias: r.info.memory.geometries, texturas: r.info.memory.textures, programas: r.info.programs?.length ?? null, vramMB: vramMB(r)?.tex ?? null },
  };
}
// Los MB de la gráfica que apunta vram.js en el contexto del juego (texturas y búferes de dibujo), o null si no lo lleva.
// Sin importarlo: banco.py --contra pasa este archivo por versiones que no lo tienen
function vramMB(r) {
  const V = r.getContext().__vram;
  if (!V) return null;
  let t = 0, b = 0;
  for (const e of V.tex.values()) t += e.bytes;
  for (const x of V.rb.values()) b += x;
  return { tex: Math.round(t / 104857.6) / 10, rb: Math.round(b / 104857.6) / 10 };
}

// En qué se va el tiempo de procesador de cada fotograma (sin esperar a la gráfica), por partes del dibujo: N
// fotogramas con cada parte cronometrada; dentro de Three, aparte las matrices y el mapa de sombras
function cpuSplit(v, frame) {
  const parts = {}, undo = [];
  const wrap = (obj, name, label) => patch(obj, name, f => function (...a) { const t = now(); try { return f.apply(this, a); } finally { parts[label] = (parts[label] || 0) + now() - t; } }, undo);
  wrap(v, 'updateSky', 'cielo'); wrap(v, 'updateCamera', 'cámara'); wrap(v.terrain, 'update', 'suelo'); wrap(v.world, 'update', 'mundo');
  // (dentro del mundo; las firmas van también dentro de los trozos y de la naturaleza. Lo que no tenga una versión, no sale)
  wrap(v.world, 'updateNature', 'mundo: naturaleza'); wrap(v.world, 'updateGrass', 'mundo: hierba'); wrap(v.world, 'updateFar', 'mundo: lejanos');
  wrap(v.world, 'updateRegions', 'mundo: casas'); wrap(v.world, 'updateFade', 'mundo: desvanecer'); wrap(v.world, 'signature', 'mundo: firmas');
  wrap(v.actors, 'update', 'actores'); wrap(v.fx, 'update', 'efectos'); wrap(v, 'updateLights', 'luces'); wrap(v, 'updateViewmodel', 'en la mano');
  wrap(v.renderer, 'render', 'three'); wrap(v.scene, 'updateMatrixWorld', 'three: matrices'); wrap(v.renderer.shadowMap, 'render', 'three: sombras');
  wrap(v.renderer, 'renderBufferDirect', 'three: llamadas');   // (dentro de cada llamada: programa, uniformes y dibujo)
  wrap(v, 'render', 'total');
  try { for (let i = 0; i < N; i++) frame(); } finally { for (const u of undo.reverse()) u(); }
  const out = {};
  for (const [k, t] of Object.entries(parts)) out[k] = +(t / N).toFixed(2);
  return out;   // parte → ms por fotograma
}

// Lo que se puede quitar para ver lo que cuesta: set(true) lo deja como en el juego, set(false) lo quita
function variants(v, want) {
  const out = [], hide = list => on => { for (const o of list) o.visible = on; };
  if (want.includes('grupos') || want.includes('personas')) {
    const G = new Map(), put = (k, o) => { if (o) { if (!G.has(k)) G.set(k, []); G.get(k).push(o); } };
    for (const c of v.world.chunks.values()) put('casas y objetos', c.group);
    for (const r of v.world.regions.values()) { put('casas y objetos', r.roof); put('casas y objetos', r.ceil); }
    for (const b of v.world.nature.values()) put('naturaleza', b.group);
    for (const g of v.world.far.values()) put('lejanos', g);
    put('pueblo', v.world.villageGroup); put('suelo', v.terrain.group); put('agua', v.terrain.water.group); put('efectos', v.fx.group);
    // (las personas y los animales, por dentro: su raíz la enciende y apaga el juego, al parpadear si les dan)
    for (const m of v.actors.models.values()) for (const o of m.root.children) put(groupOf(m), o);
    for (const [k, list] of G) if (want.includes('grupos') || want.includes(k)) out.push([k, hide(list)]);
  }
  if (want.includes('luces')) out.push(['luces de cerca', hide(v.pool)]);
  // (los árboles lejanos como impostores frente a los sencillos de antes: se rehace todo lo lejano al cambiar)
  if (want.includes('impostores')) out.push(['impostores', on => v.world.setImpostors(on)]);
  // (resX: cuánto se ahorra bajando de la resolución del banco a ×X)
  for (const w of want) if (/^res[\d.]+$/.test(w)) {
    const x = +w.slice(3), r = v.renderer;
    out.push([`bajar a ×${x}`, on => { r.setPixelRatio(on ? PX : x); r.setSize(innerWidth, innerHeight, false); }]);
  }
  if (want.includes('cielo')) out.push(['cielo', hide([v.sky])]);
  if (want.includes('cielo-primero')) out.push(['cielo al final (no al principio)', on => { v.sky.renderOrder = on ? -1 : 1e6; }]);
  if (want.includes('sombra')) out.push(['mapa de sombras', on => { v.renderer.shadowMap.enabled = on; v.scene.traverse(o => { const m = o.material; if (m) for (const x of [].concat(m)) x.needsUpdate = true; }); }]);
  return out;
}

// Una tanda de N fotogramas, esperando a la gráfica al principio y al final: lo que tarda cada uno, en ms
function timeLot(fn, sync) {
  sync();
  const t0 = now();
  for (let i = 0; i < N; i++) fn();
  sync();
  return (now() - t0) / N;
}

// Dibujar hasta que alrededor esté todo hecho: el suelo (lo calcula un hilo aparte) y lo que se monta poco a poco
async function settle(game, v, frame) {
  const T = v.terrain, size = () => { let n = 0; v.scene.traverse(() => n++); return n; };
  let last = -1, same = 0, worst = 0, i = 0, slow = 0;
  for (; i < 900; i++) {
    const t = now();
    frame();
    const d = now() - t;
    worst = Math.max(worst, d); if (d > 500) slow += d;
    if (i % 3 === 0) await sleep(0);
    if (i % 10 === 9) {
      const n = size();
      const I = v.world.useImpostors ? v.world.impostors : null, baked = !I || I.ready || I.season === -2;   // (y los impostores, horneados)
      same = n === last && !T.pending.size && !T.jobs.size && baked ? same + 1 : 0;
      last = n;
      if (same >= 3 && i >= 60) break;
    }
  }
  // (cuántos fotogramas hicieron falta, el peor y lo que sumaron los de más de medio segundo: compilar, montar)
  return { fotogramas: i + 1, peor: Math.round(worst), parones: sec(slow), objetos: last };
}

async function post(path, body) {
  try { await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); } catch {}
}

// El resultado en pantalla (al abrirlo a mano), con un botón para copiarlo
function show(out) {
  const box = document.createElement('div'), pre = document.createElement('pre'), copy = document.createElement('button');
  box.style.cssText = 'position:fixed;inset:12px;z-index:200;overflow:auto;padding:14px;background:rgba(10,8,6,.88);color:#f4ead8;font:13px/1.45 ui-monospace,monospace;border-radius:8px';
  const rows = out.paradas.map(p => { const c = p.desglose?.contadores;
    return `${p.name.padEnd(16)} ${String(p.ms).padStart(6)} ms ${String(p.fps).padStart(5)} fps  sin sombras ${String(p.msSinSombra).padStart(6)}  llamadas ${p.llamadas}+${p.llamadasSombra}${p.llamadasSombraMovil !== undefined ? ` (móvil ${p.llamadasSombraMovil})` : ''}  triángulos ${Math.round(p.triangulos / 1000)}k+${Math.round(p.triangulosSombra / 1000)}k` +
      (c ? `  personas ${c.personas.dibujadas}/${c.personas.modelos}  sombras ${c.sombras.rehechasPorFotograma}/fotograma` + (c.sombras.fijoPorFotograma !== undefined ? ` (fijo ${c.sombras.fijoPorFotograma})` : '') : ''); });
  pre.textContent = [`Banco · ${out.version} · ${out.gpu}`, `lienzo ${out.lienzo} (px ${out.px}, pantalla ×${out.dpr}) · listo en ${out.arranque} s · ${out.programas} programas`, '', ...rows].join('\n');
  pre.style.cssText = 'margin:0;white-space:pre-wrap';
  copy.textContent = 'Copiar el resultado';
  copy.style.cssText = 'margin-top:12px;padding:8px 14px;font-size:15px';
  copy.onclick = () => navigator.clipboard?.writeText(JSON.stringify(out)).then(() => { copy.textContent = 'Copiado'; }, () => { copy.textContent = 'No se ha podido copiar'; });
  box.append(pre, copy);
  document.body.append(box);
}
