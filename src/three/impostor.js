// Los árboles lejanos como impostores: cada especie se pinta una vez, al empezar y al cambiar de estación, desde 8
// lados y 2 alturas (5° y 40°) en un atlas (su color y su normal), y de lejos cada árbol es una tarjeta que mira a la
// cámara con la mezcla de las cuatro vistas más cercanas. Con la normal, la luz es la del juego (el sol o la luna, el
// cielo, el reflejo, la niebla y la curva de tono), así que se ven de día, al atardecer, de noche, con nieve y con las
// hojas de cada estación, y tienen la silueta del árbol de cerca (tarjetas de hojas, pisos del pino, hojas de palmera,
// brazos del cactus, ramas peladas en invierno). Dos triángulos por árbol en vez de unos 200.
//
// El horneado no congela: va por pasos (ImpostorAtlas.step, con un tope de tiempo y de vistas por fotograma) y sus
// programas se compilan en paralelo antes de empezar. Se hace en el menú (View3D.idle, con la estación de donde se va a
// jugar), así que al entrar a jugar ya está; y en la partida, al cambiar de estación. Mientras tanto, lo lejano sale con
// los árboles sencillos de antes (buildFarNature). Sin pantalla (el servidor, ?modo=servidor) no hay View3D ni World3D:
// esto ni se carga.
import * as THREE from 'three';
import { buildNatureChunk, WIND, DITHER } from './nature3d.js';
import { treeK, ageOf } from '../world/treedims.js';
import { CHUNK } from '../world/gen.js';
import { ihash } from '../util.js';

const QS = (() => { try { return new URLSearchParams(globalThis.location?.search || ''); } catch { return new URLSearchParams(); } })();
const LOW_Q = QS.get('q') === 'low';
// ?impostores=0: lo lejano con los árboles sencillos de antes (para comparar en el mismo código)
export const IMPOSTORS_ON = QS.get('impostores') !== '0';

// Las especies (una fila del atlas cada una): el roble en tres (joven y dos adultos distintos) y el pino en tres (el
// tercero, nevado; en invierno ya nievan todos y es uno más), para que de lejos no se vean todos iguales
// yaw: hacia dónde gira el árbol con su rot (nature3d.js, pieces). Lo que va puesto con cos/sin(rot) (las ramas del roble
// y del sauce, la inclinación de la palmera, los brazos del cactus) gira al revés que lo que va con el ángulo rot (los
// pisos del pino): en cada especie manda lo que más se ve de lado, y el impostor gira con eso
const SETS = [
  { id: 'roble joven', kind: 'oak', age: 0.75 }, { id: 'roble A', kind: 'oak', age: 1 }, { id: 'roble B', kind: 'oak', age: 1 },
  { id: 'frutal', kind: 'fruit', age: 1 }, { id: 'sauce', kind: 'swampTree', age: 1 },
  { id: 'pino A', kind: 'pine', age: 1, yaw: -1 }, { id: 'pino B', kind: 'pine', age: 1, yaw: -1 }, { id: 'pino C', kind: 'snowPine', age: 1, yaw: -1 },
  { id: 'palmera', kind: 'palm', age: 1 }, { id: 'cactus', kind: 'cactus', age: 1 },
];
const AZ = 8, ELEV = [5, 40].map(d => d * Math.PI / 180), COLS = AZ * ELEV.length, ROWS = SETS.length;
// Celdas de CELL píxeles (las normales, de la mitad): con la cámara baja, en el borde de lo cercano (unos 50 m) un árbol
// mide unos 250 píxeles en una pantalla Retina; más lejos, menos. Cada vista se pinta al doble (SS) y se reduce: los
// bordes de las hojas salen suaves. MARGIN: los píxeles libres alrededor del árbol, para que los mips (hasta el nivel 3)
// no mezclen una celda con la de al lado
const CELL = LOW_Q ? 128 : 256, NCELL = CELL / 2, SS = 2, SRC = CELL * SS, MARGIN = LOW_Q ? 4 : 8, INNER = (CELL - 2 * MARGIN) / CELL;
// Lo que se hace como mucho en un paso: las vistas (cada una, dos dibujos y dos copias en la gráfica) y el tiempo
const VIEWS_PER_STEP = { menu: 4, game: 2 };

const BAKE_U = { value: 0 };   // 0: el color; 1: la normal
const v3 = new THREE.Vector3(), m4 = new THREE.Matrix4(), col = new THREE.Color();

// Dónde se planta cada árbol de muestra: un sitio cualquiera en el que su tamaño por el sitio salga en medio (k = su
// edad), lejos de todo; el giro que le toca ahí se apunta, para orientar cada impostor como su árbol de cerca
function sample(def, i, season) {
  for (let n = 0; n < 400; n++) {
    const x = 9000.5 + i * 37 + n * 3, y = 9000.5 + n * 5;
    if (Math.abs(ihash(Math.floor(x * 7), Math.floor(y * 7), 11) - 0.5) < 0.04 || n === 399)
      return { kind: def.kind === 'snowPine' && season === 3 ? 'pine' : def.kind, x, y, key: 'impostor:' + i, age: def.age };
  }
}
// El giro de un árbol de cerca (nature3d.js, pieces: rot)
const rotOf = o => ihash(Math.floor(o.x * 13) + 1, Math.floor(o.y * 13), 32) * Math.PI * 2;

// Un trozo de sombreador: la visibilidad del árbol de cerca en el trozo del punto p (xz), de la máscara de World3D (MASK
// × MASK trozos desde impOrigin; 0: se ve el lejano, 1: el de cerca; entre medias, fundiéndose), en vNear
export const MASK = 32;
export const MASK_GLSL = p => `{ ivec2 mt = ivec2(floor(${p} / ${CHUNK.toFixed(1)})) - ivec2(impOrigin);
        vNear = (all(greaterThanEqual(mt, ivec2(0))) && all(lessThan(mt, ivec2(${MASK})))) ? texelFetch(impMask, mt, 0).r : 0.0; }`;

export class ImpostorAtlas {
  // mask: los uniformes de la máscara de World3D ({ impMask, impOrigin, impFar })
  constructor(renderer, mask) {
    this.renderer = renderer;
    this.season = -1; this.ready = false; this.gen = 0; this.job = null;
    this.done = 0; this.total = ROWS * COLS; this.bakeMs = 0;
    this.sets = [];
    this.U = {
      impAlb: { value: null }, impNor: { value: null }, impGrid: { value: new THREE.Vector2(COLS, ROWS) },
      impRows: { value: new THREE.Vector2(ELEV[0], ELEV[1]) }, ...mask,
    };
    this.material = impostorMaterial(this.U);
  }
  // Empieza a hornear la estación (lo que hubiera a medias se deja)
  start(season) {
    this.cancel();
    this.season = season; this.ready = false; this.done = 0; this.bakeMs = 0; this.maxStep = 0; this.steps = 0;
    this.job = this.bake(season);
  }
  // Vuelve a hornear (se ha perdido el contexto de WebGL: el atlas está vacío)
  invalidate() {
    const s = this.season;
    this.dropTargets();
    this.season = -1;
    if (s >= 0) this.start(s);
  }
  cancel() {
    if (this.job) { this.job.return(); this.job = null; }
    this.dropWork();
  }
  // Un paso del horneado, como mucho ms milisegundos (menu: más vistas por paso, que en el menú no se juega)
  step(ms, menu = false) {
    if (!this.job) return;
    const r = this.renderer, t0 = performance.now(), info = r.info.render;
    // (todo lo que el horneado toca del renderer se deja como estaba: a dónde se pinta, el borrado, la sombra pendiente,
    // las cuentas de F3 y del banco, y el viento, que si se mueve hace que las vistas no casen)
    const rt = r.getRenderTarget(), ac = r.autoClear, cc = r.getClearColor(col).clone(), ca = r.getClearAlpha(), sm = r.shadowMap.needsUpdate;
    const calls = info.calls, tris = info.triangles, pts = info.points, lines = info.lines, frame = info.frame, wind = WIND.value;
    r.shadowMap.needsUpdate = false; r.autoClear = false; WIND.value = 0;
    let views = 0;
    try {
      while (this.job) {
        const s = this.job.next();
        if (s.done) { this.job = null; break; }
        if (s.value === 'compilar' || s.value === 'preparar') break;   // (esperando a los programas; o algo pesado: hasta el siguiente)
        if (s.value === 'vista' && ++views >= VIEWS_PER_STEP[menu ? 'menu' : 'game']) break;
        if (performance.now() - t0 > ms) break;
      }
    } catch (e) {
      console.warn('Impostores: no se han podido hornear', e);
      this.cancel(); this.season = -2;   // (no se vuelve a intentar: lo lejano se queda con los árboles sencillos)
    } finally {
      r.setRenderTarget(rt); r.autoClear = ac; r.setClearColor(cc, ca); r.shadowMap.needsUpdate = sm;
      info.calls = calls; info.triangles = tris; info.points = pts; info.lines = lines; info.frame = frame;
      WIND.value = wind;
    }
    const dt = performance.now() - t0;
    this.bakeMs += dt; this.maxStep = Math.max(this.maxStep || 0, dt); this.steps = (this.steps || 0) + 1;
  }

  // El horneado, por pasos: 'arbol' (montar un árbol de muestra y pedir sus programas), 'compilar' (esperar a que estén),
  // 'preparar' (subir a la gráfica las texturas y reservar las de destino, cada una en su paso) y 'vista'. Nada de eso
  // pasa de unos pocos ms: en la partida (al cambiar de estación) no se nota
  *bake(season) {
    const r = this.renderer, W = (this.work = { groups: [], mats: new Map(), scene: new THREE.Scene() });
    const cam = (W.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 100)), waiting = new Set();
    // (cada lote de programas se compila en paralelo; compileAsync solo espera al último programa de cada material, por
    // eso cada copia de horneado tiene un solo uso: con o sin color por pieza, ver bakeMaterial. Y con una textura de
    // destino puesta, como al pintar: si no, salen con la curva de tono y el sRGB de la pantalla, y al pintar se
    // compilarían otra vez, de golpe)
    W.rtA = new THREE.WebGLRenderTarget(SRC, SRC, { colorSpace: THREE.SRGBColorSpace, depthBuffer: true });
    W.rtN = new THREE.WebGLRenderTarget(SRC, SRC, { depthBuffer: true });
    const compile = (obj) => { r.setRenderTarget(W.rtA); const p = r.compileAsync(obj, cam, W.scene).catch(() => {}).finally(() => waiting.delete(p)); waiting.add(p); };
    W.copy = copyPass();
    compile(W.copy.scene);
    // 1. Los árboles de muestra, en el origen, con materiales que dan el color y la normal en vez de la luz
    const sets = [], maps = new Set();
    for (let i = 0; i < SETS.length; i++) {
      const def = SETS[i], o = sample(def, i, season), g = buildNatureChunk([o], season, () => 0, false).group;
      g.position.set(-o.x, 0, -o.y);
      g.updateMatrixWorld(true);
      let y0 = Infinity, y1 = -Infinity, R = 0, cr = 0, cg = 0, cb = 0, cn = 0;
      // (el tamaño, con los vértices de cada pieza ya colocada: con las esquinas de sus cajas, los pisos del pino y las
      // hojas de la palmera salían bastante más anchos, y su celda del atlas se quedaba medio vacía)
      for (const im of g.children) {
        const pos = im.geometry.attributes.position;
        for (let k = 0; k < im.count; k++) {
          im.getMatrixAt(k, m4);
          for (let c = 0; c < pos.count; c++) {
            v3.fromBufferAttribute(pos, c).applyMatrix4(m4);
            const x = v3.x - o.x, z = v3.z - o.y;
            y0 = Math.min(y0, v3.y); y1 = Math.max(y1, v3.y); R = Math.max(R, Math.hypot(x, z));
          }
          if (im.instanceColor) { im.getColorAt(k, col); cr += col.r; cg += col.g; cb += col.b; cn++; }
        }
        if (im.material.map) maps.add(im.material.map);
        im.material = this.bakeMaterial(im.material, W.mats, !!im.instanceColor);
        im.frustumCulled = false;
      }
      y0 = Math.max(y0, -0.3);   // (lo que va bajo tierra no cuenta)
      R += 0.12; y1 += 0.06;     // (y algo más por el vaivén, que con el viento quieto no es cero: ver nature3d.js, sway)
      const H = y1 - y0, hw = R / INNER, hh = Math.max(...ELEV.map(e => (H / 2) * Math.cos(e) + R * Math.sin(e))) / INNER;
      // (el color de relleno de lo transparente, por si los mips lo alcanzan: el medio de las hojas, más oscuro por la textura)
      const fill = cn ? new THREE.Color(cr / cn, cg / cn, cb / cn).multiplyScalar(0.7) : new THREE.Color('#4a3a2c');
      g.visible = false;
      W.scene.add(g); W.groups.push(g);
      sets.push({ id: def.id, row: i, kind: o.kind, k: treeK(o), rot: rotOf(o), yaw: def.yaw || 1, yc: (y0 + y1) / 2, hw, hh, H, R, fill, g });
      compile(g);
      yield 'arbol';
    }
    // 2. Las texturas de las hojas y la corteza, a la gráfica; las de destino, reservadas (y vacías); y los programas, listos
    for (const t of maps) { r.initTexture(t); yield 'preparar'; }
    this.makeTargets();
    for (const t of [W.rtA, W.rtN, this.atlasA, this.atlasN]) { t.scissorTest = false; r.setRenderTarget(t); r.setClearColor(0x000000, 0); r.clear(true, true, false); yield 'preparar'; }
    while (waiting.size) yield 'compilar';
    // 3. Las vistas: cada una se pinta (color y normal) en W.rtA y W.rtN al doble de tamaño, y se copia a su celda
    for (const s of sets) {
      s.g.visible = true;
      for (let e = 0; e < ELEV.length; e++) for (let a = 0; a < AZ; a++) {
        const th = (a / AZ) * Math.PI * 2, el = ELEV[e], D = s.R + s.H + 4;
        Object.assign(cam, { left: -s.hw, right: s.hw, top: s.hh, bottom: -s.hh, near: 0.05, far: D * 2 + s.R });
        cam.updateProjectionMatrix();
        cam.position.set(Math.sin(th) * Math.cos(el) * D, s.yc + Math.sin(el) * D, Math.cos(th) * Math.cos(el) * D);
        cam.up.set(0, 1, 0); cam.lookAt(0, s.yc, 0);
        for (const [mode, rt] of [[0, W.rtA], [1, W.rtN]]) {
          BAKE_U.value = mode;
          r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(true, true, false);
          r.render(W.scene, cam);
        }
        yield 'pintada';   // (las dos pasadas y las dos copias, en pasos distintos si va justo de tiempo)
        const last = s === sets[sets.length - 1] && e === ELEV.length - 1 && a === AZ - 1, col0 = a + e * AZ;
        this.copyTo(W, this.atlasA, col0 * CELL, s.row * CELL, CELL, 0, s.fill, last);
        this.copyTo(W, this.atlasN, col0 * NCELL, s.row * NCELL, NCELL, 1, s.fill, last);
        this.done++;
        yield 'vista';
      }
      s.g.visible = false;
    }
    // 4. Listo: el atlas al material y fuera lo de horneado
    this.sets = sets.map(({ g, ...s }) => s);
    this.U.impAlb.value = this.atlasA.texture; this.U.impNor.value = this.atlasN.texture;
    this.dropWork();
    this.ready = true; this.gen++;
  }
  // La copia de una vista a su celda: reduce (cada píxel, la media de SS × SS o de 2·SS × 2·SS, pesada por lo que cubre)
  // y, donde no hay nada, pone el color del vecino con algo más cercano (dilatado): así, al alejarse, los mips no mezclan
  // el borde de las hojas con negro ni con blanco
  copyTo(W, target, x, y, size, mode, fill, last) {
    const r = this.renderer, U = W.copy.material.uniforms;
    U.srcA.value = W.rtA.texture; U.srcN.value = W.rtN.texture; U.mode.value = mode; U.S.value = SRC / size;
    U.origin.value.set(x, y); U.fill.value.copy(mode ? col.setRGB(0.5, 1, 0.5) : fill);
    target.viewport.set(x, y, size, size); target.scissor.set(x, y, size, size); target.scissorTest = true;
    // (los mips, una sola vez al final: si no, se rehacen los de todo el atlas en cada copia)
    target.texture.generateMipmaps = last;
    r.setRenderTarget(target);
    r.render(W.copy.scene, W.cam);
    target.texture.generateMipmaps = false;
  }
  makeTargets() {
    if (this.atlasA) return;
    const opts = { depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter };
    this.atlasA = new THREE.WebGLRenderTarget(COLS * CELL, ROWS * CELL, { ...opts, colorSpace: THREE.SRGBColorSpace });
    this.atlasN = new THREE.WebGLRenderTarget(COLS * NCELL, ROWS * NCELL, opts);
    this.atlasA.texture.anisotropy = this.atlasN.texture.anisotropy = 4;
  }
  dropTargets() {
    for (const k of ['atlasA', 'atlasN']) if (this[k]) { this[k].dispose(); this[k] = null; }
    this.U.impAlb.value = this.U.impNor.value = null;
    this.ready = false;
  }
  // Lo de horneado (los árboles de muestra, sus materiales y las texturas intermedias); GEO es de todos y no se toca
  dropWork() {
    const W = this.work;
    if (!W) return;
    for (const g of W.groups) for (const im of g.children) im.dispose();
    for (const m of W.mats.values()) m.dispose();
    W.rtA?.dispose(); W.rtN?.dispose();
    if (W.copy) { W.copy.material.dispose(); W.copy.geometry.dispose(); }
    this.work = null;
  }
  // La copia de un material del árbol que, en vez de la luz, da su color (el mapa por el color de la pieza, después del
  // corte de las tarjetas) o su normal en el mundo del horneado; con el resto de su sombreador (el vaivén, las tarjetas
  // por las dos caras)
  bakeMaterial(m, cache, colored) {
    const key = m.uuid + (colored ? ':c' : '');
    if (cache.has(key)) return cache.get(key);
    const c = m.clone(), prevKey = m.customProgramCacheKey(), prev = m.onBeforeCompile;
    c.onBeforeCompile = (sh, r) => {
      prev.call(m, sh, r);
      sh.uniforms.uBake = BAKE_U;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uBake;').replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 bkN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
        gl_FragColor = uBake < 0.5 ? vec4(diffuseColor.rgb, 1.0) : vec4(bkN * 0.5 + 0.5, 1.0);
        return;`);
    };
    c.customProgramCacheKey = () => prevKey + ':bake';
    cache.set(key, c);
    return c;
  }
  // La especie de un árbol lejano (o null: lo que no tiene, como las flores)
  pick(o) {
    const S = this.byId ||= new Map(), sets = this.sets;
    if (S.gen !== this.gen) { S.clear(); for (const s of sets) S.set(s.id, s); S.gen = this.gen; }
    const h = ihash(Math.floor(o.x * 3), Math.floor(o.y * 3), 91);
    switch (o.kind) {
      case 'oak': return S.get(ageOf(o) <= 0.75 ? 'roble joven' : h < 0.5 ? 'roble A' : 'roble B');
      case 'fruit': return S.get('frutal');
      case 'swampTree': return S.get('sauce');
      case 'pine': return S.get(this.season === 3 ? ['pino A', 'pino B', 'pino C'][Math.floor(h * 3)] : h < 0.5 ? 'pino A' : 'pino B');
      case 'snowPine': return S.get(this.season === 3 ? ['pino A', 'pino B', 'pino C'][Math.floor(h * 3)] : 'pino C');
      case 'palm': return S.get('palmera');
      case 'cactus': return S.get('cactus');
    }
    return null;
  }
  // Para F3
  stats() {
    if (this.season === -2) return 'impostores: no se han podido hornear (lo lejano, sencillo)';
    if (!this.ready) return `impostores: horneando ${this.done}/${this.total}`;
    const mb = (COLS * CELL * ROWS * CELL + COLS * NCELL * ROWS * NCELL) * 4 * 4 / 3 / 1048576;
    return `impostores: listos (${ROWS} especies, ${Math.round(mb)} MB, horneados en ${Math.round(this.bakeMs)} ms en ${this.steps} pasos, el mayor ${Math.round(this.maxStep)} ms)`;
  }
}

// Los impostores de un bloque lejano: una tarjeta por árbol (en su sitio, a su escala y con su giro), en una sola malla
export function buildFarImpostors(objs, groundY, atlas) {
  const list = [];
  for (const o of objs) { const s = atlas.pick(o); if (s) list.push([o, s]); }
  if (!list.length) return null;
  // (la tarjeta, propia de cada bloque: al soltarlo se tira entera, con su aImp)
  const n = list.length, aImp = new Float32Array(n * 2), geo = new THREE.PlaneGeometry(1, 1);
  geo.setAttribute('aImp', new THREE.InstancedBufferAttribute(aImp, 2));
  const im = new THREE.InstancedMesh(geo, atlas.material, n);
  list.forEach(([o, s], i) => {
    const sg = treeK(o) / s.k, y = groundY(o.x, o.y);
    m4.makeScale(2 * s.hw * sg, 2 * s.hh * sg, 1).setPosition(o.x, y + s.yc * sg, o.y);
    im.setMatrixAt(i, m4);
    // (girado como su árbol de cerca: rot, en la muestra, va a parar a rot del árbol, en el sentido de su especie)
    aImp[i * 2] = s.yaw * (s.rot - rotOf(o)); aImp[i * 2 + 1] = s.row;
    const t = 0.94 + 0.12 * ihash(Math.floor(o.x * 3), Math.floor(o.y * 3), 93);
    im.setColorAt(i, col.setRGB(t, t, t));
  });
  im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
  im.castShadow = im.receiveShadow = false;
  im.computeBoundingSphere();   // (la tarjeta gira: su esfera, la de la caja de la tarjeta, la cubre de cualquier lado)
  im.userData.own = true;       // (su geometría es suya: se tira con el bloque)
  return im;
}

// El material de los impostores (uno para todos): una tarjeta que mira a la cámara y, de las 16 vistas de su especie,
// mezcla las cuatro más cercanas (dos giros y dos alturas), con el color y la normal horneados y la luz del juego
function impostorMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, alphaToCoverage: !LOW_Q });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec2 aImp;
      uniform sampler2D impMask; uniform vec2 impOrigin; uniform float impFar; uniform vec2 impGrid; uniform vec2 impRows;
      varying vec4 vA; varying vec4 vB; varying vec2 vW; varying float vNear; varying float vYaw;`)
      // (el centro y el tamaño, de la matriz de la instancia; la tarjeta, de cara a la cámara)
      .replace('#include <begin_vertex>', `
      vec3 iC = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
      vec2 iS = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
      vec3 iV = cameraPosition - iC; float iD = length(iV); iV /= max(iD, 1e-4);
      vec3 iR = cross(vec3(0.0, 1.0, 0.0), iV); iR = dot(iR, iR) > 1e-6 ? normalize(iR) : vec3(1.0, 0.0, 0.0);
      vec3 iU = cross(iV, iR);
      vec3 transformed = iC + iR * position.x * iS.x + iU * position.y * iS.y;
      // (de dónde se mira, en el árbol sin girar: qué dos giros y qué dos alturas, y cuánto de cada uno)
      float ic = cos(aImp.x), is = sin(aImp.x);
      vec3 iL = vec3(ic * iV.x - is * iV.z, iV.y, is * iV.x + ic * iV.z);
      float fa = fract(atan(iL.x, iL.z) / 6.2831853) * ${AZ.toFixed(1)}, a0 = floor(fa), a1 = mod(a0 + 1.0, ${AZ.toFixed(1)});
      vW = vec2(fa - a0, clamp((asin(clamp(iL.y, -1.0, 1.0)) - impRows.x) / (impRows.y - impRows.x), 0.0, 1.0));
      vYaw = aImp.x;
      vec2 q = uv;
      vA = vec4((vec2(a0, aImp.y) + q) / impGrid, (vec2(a1, aImp.y) + q) / impGrid);
      vB = vec4((vec2(a0 + ${AZ.toFixed(1)}, aImp.y) + q) / impGrid, (vec2(a1 + ${AZ.toFixed(1)}, aImp.y) + q) / impGrid);
      ${MASK_GLSL('iC.xz')}`)
      .replace('#include <project_vertex>', `vec4 mvPosition = viewMatrix * vec4(transformed, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      // (donde ya está del todo el de cerca, o donde la niebla ya lo tapa entero, ni se pinta. La niebla va por la
      // profundidad de la vista, no por la distancia: a los lados de la pantalla, un árbol lejano está menos hondo)
      float iZ = -(viewMatrix * vec4(iC, 1.0)).z;
      if (vNear > 0.999 || iZ > impFar + max(iS.x, iS.y)) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);`)
      .replace('#include <worldpos_vertex>', `#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
        vec4 worldPosition = vec4(transformed, 1.0);
      #endif`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D impAlb; uniform sampler2D impNor;
      varying vec4 vA; varying vec4 vB; varying vec2 vW; varying float vNear; varying float vYaw;
      // (las cuatro vistas, pesadas por lo que cubre cada una: así el borde de una no aclara ni oscurece el color de otra;
      // con la cámara justo en una altura, solo dos)
      vec4 impMix(sampler2D t, out float cover) {
        vec4 a = texture2D(t, vA.xy), b = texture2D(t, vA.zw);
        float wa = (1.0 - vW.x) * (1.0 - vW.y), wb = vW.x * (1.0 - vW.y), wc = (1.0 - vW.x) * vW.y, wd = vW.x * vW.y;
        vec4 s = vec4(a.rgb * a.a, a.a) * wa + vec4(b.rgb * b.a, b.a) * wb;
        if (vW.y > 0.002) { vec4 c = texture2D(t, vB.xy), d = texture2D(t, vB.zw); s += vec4(c.rgb * c.a, c.a) * wc + vec4(d.rgb * d.a, d.a) * wd; }
        cover = s.a;
        return vec4(s.a > 1e-4 ? s.rgb / s.a : a.rgb, s.a);
      }`)
      // (el color: el del atlas; el borde, afilado con lo que cambia de un píxel al de al lado, para que la copa no adelgace
      // de lejos con los mips; y el tramado, el contrario del de cerca: entre los dos, cada píxel una vez)
      .replace('#include <map_fragment>', `float impCov;
      vec4 impA = impMix(impAlb, impCov);
      diffuseColor.rgb *= impA.rgb;
      float impCv = (impCov - 0.5) / max(fwidth(impCov), 1e-4) + 0.5;
      if (impCv <= ${LOW_Q ? '0.5' : '0.0'}) discard;
      if (${DITHER} < vNear) discard;
      diffuseColor.a = clamp(impCv, 0.0, 1.0);`)
      // (la normal: la del atlas, girada como el árbol y a la vista)
      .replace('#include <normal_fragment_begin>', `float impNc;
      vec3 nT = impMix(impNor, impNc).xyz * 2.0 - 1.0;
      float iyc = cos(vYaw), iys = sin(vYaw);
      vec3 nW = normalize(vec3(iyc * nT.x + iys * nT.z, nT.y, -iys * nT.x + iyc * nT.z) + vec3(0.0, 1e-4, 0.0));
      vec3 normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
      float faceDirection = 1.0;
      vec3 nonPerturbedNormal = normal;`)
      // (con OPAQUE, Three pondría el alfa a 1 y la cobertura no haría nada)
      .replace('#include <opaque_fragment>', 'gl_FragColor = vec4(outgoingLight, diffuseColor.a);');
  };
  m.customProgramCacheKey = () => 'impostor-v2' + (LOW_Q ? '-q' : '');
  return m;
}

// La copia de una vista a su celda del atlas (ver ImpostorAtlas.copyTo): un cuadro que cubre la celda
function copyPass() {
  const material = new THREE.ShaderMaterial({
    uniforms: { srcA: { value: null }, srcN: { value: null }, mode: { value: 0 }, S: { value: 2 }, origin: { value: new THREE.Vector2() }, fill: { value: new THREE.Color() } },
    depthTest: false, depthWrite: false,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D srcA; uniform sampler2D srcN; uniform float mode; uniform float S; uniform vec2 origin; uniform vec3 fill;
      vec4 grab(ivec2 p) {
        p = clamp(p, ivec2(0), ivec2(${SRC - 1}));
        vec4 a = texelFetch(srcA, p, 0);
        if (mode > 0.5) a.rgb = texelFetch(srcN, p, 0).rgb;
        return a;
      }
      void main() {
        int s = int(S + 0.5);
        ivec2 o = ivec2(floor(gl_FragCoord.xy - origin));
        vec3 c = vec3(0.0); float a = 0.0;
        for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
          if (i >= s || j >= s) continue;
          vec4 t = grab(o * s + ivec2(i, j));
          c += t.rgb * t.a; a += t.a;
        }
        if (a > 0.0) { gl_FragColor = vec4(c / a, a / float(s * s)); return; }
        const ivec2 D8[8] = ivec2[8](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1), ivec2(1, 1), ivec2(-1, 1), ivec2(1, -1), ivec2(-1, -1));
        const int RAD[6] = int[6](1, 2, 3, 5, 8, 12);
        for (int r = 0; r < 6; r++) {
          vec3 acc = vec3(0.0); float w = 0.0;
          for (int d = 0; d < 8; d++) { vec4 t = grab((o + D8[d] * RAD[r]) * s + ivec2(s / 2)); acc += t.rgb * t.a; w += t.a; }
          if (w > 0.0) { gl_FragColor = vec4(acc / w, 0.0); return; }
        }
        gl_FragColor = vec4(fill, 0.0);
      }`,
  });
  const geometry = new THREE.PlaneGeometry(2, 2), mesh = new THREE.Mesh(geometry, material), scene = new THREE.Scene();
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { material, geometry, scene };
}
