// Las sombras del sol, con lo fijo guardado. El mapa de sombras es uno solo (el de la luz del sol, el de siempre: ni
// cambian los sombreadores ni se recompila nada), pero casi todo lo que hay en él no se mueve: casas, árboles, muebles,
// tejados. Antes se rehacía entero cada dos fotogramas solo porque andaban las personas. Ahora:
// - Lo fijo se pinta solo cuando hace falta (se mueve la zona de sombras, gira el sol o cambia el mundo) y se copia a
//   una caché del mismo tamaño.
// - En cada fotograma, donde algo que se mueve dejó su sombra en el anterior, se vuelve a poner lo fijo (una copia de
//   ese rectángulo desde la caché, color y fondo) y se pinta encima, sin borrar, solo lo que se mueve: personas,
//   animales, objetos caídos, la noria. La prueba de profundidad hace el resto (alguien bajo un tejado sigue en su
//   sombra). Así las sombras de lo que se mueve van en todos los fotogramas, no en uno de cada dos.
// - La zona de sombras se mueve a saltos de texel del mapa (las sombras fijas no tiemblan ni nadan al andar) y el sol se
//   queda quieto entre repintado y repintado (si no, la caché no casaría con lo nuevo).
// ?sombras=todas vuelve a lo de antes (todo el mapa cada dos fotogramas), para comparar; y si la gráfica no deja copiar
// entre destinos (sin WebGL2), también.
import * as THREE from 'three';

const ALL = typeof location !== 'undefined' && new URLSearchParams(location.search).get('sombras') === 'todas';
const HALF_GAP = 2;      // m que puede cambiar el tamaño de la zona antes de rehacerla
const MOVE = 3;          // m que puede quedar la zona de sombras lejos de donde querría, antes de moverla
const TURN = 0.0018;     // rad (~0,1°) que gira el sol antes de rehacer lo fijo: con el reloj de verdad, una vez cada ~30 s
const EVERY = 2;         // fotogramas, como poco, entre dos repintados de lo fijo pedidos por el mundo (stale)
const SAFETY = 5000;     // ms: lo fijo se rehace de todos modos cada tanto (por si algo cambió sin avisar)
const MARGIN = 2;        // texels de más alrededor de cada cosa que se mueve (el suavizado lee los vecinos)
const PERSON_R = 1.3;    // m: lo mínimo alrededor de una persona (brazos al andar, al agacharse, la mochila)
const RIDE_R = 2.8;      // … montada a caballo o en barca (con los remos)
const UP = new THREE.Vector3(0, 1, 0), V = new THREE.Vector3(), BX = new THREE.Box3(), SP = new THREE.Sphere();
const AX = new THREE.Vector3(), AY = new THREE.Vector3(), AZ = new THREE.Vector3(), V2 = new THREE.Vector3(), BOX = new THREE.Box3(), PM = new THREE.Matrix4();

export class SunShadow {
  constructor(view) {
    this.v = view;
    this.dir = new THREE.Vector3(0, 1, 0);   // la dirección del sol con la que está pintado lo fijo (la luz va con ella)
    this.center = new THREE.Vector3();
    this.zone = new THREE.Frustum(); this.zoneSet = false;   // la caja de la sombra en el último repintado de lo fijo
    this.dirSet = false;
    this.staticDirty = true;  // hay que repintar lo fijo ya
    this.pending = false;     // el mundo ha cambiado: repintarlo en cuanto toque (ver EVERY)
    this.parked = false;      // en cuevas, el sol está apartado (ver place)
    this.skip = false;        // este fotograma no se toca el mapa (cuevas, sin sol)
    this.hold = false;        // el banco: este fotograma sin sombras
    this.prev = [];           // rectángulos donde se pintó lo móvil en el último pase
    this.n = 0; this.lastStatic = -1e9; this.lastStaticT = 0;
    this.cache = null;
    const r = view.renderer;
    this.ok = !ALL && r.capabilities.isWebGL2 && typeof r.getContext().blitFramebuffer === 'function';
    this.checked = false;
    // Las cifras para F3 y el banco: repintados de lo fijo, llamadas y rectángulos de lo móvil, en la última media vuelta
    this.stats = { fijos: 0, callsFijo: 0, movil: 0, parches: 0, frames: 0, t: performance.now(), out: null };
    this.nStatic = 0;
    // (Three llama a shadowMap.render dentro de renderer.render, con las matrices y los esqueletos ya al día: se envuelve ahí)
    const sm = r.shadowMap, orig = sm.render.bind(sm);
    sm.render = (lights, scene, cam) => this.render(lights, scene, cam, orig);
  }

  // Lo que se mueve: van en sus propios grupos, colgados de la escena (lo demás de la escena es fijo)
  dynRoots() {
    const v = this.v;
    return (this.roots ||= [v.actors.group, v.fx.group, v.arrows.group, v.world.spin, v.viewmodel].filter(Boolean));
  }

  // Ha cambiado algo de lo fijo. now: repintarlo en este mismo fotograma (cambio de mundo, de estación); si no, en
  // cuanto toque, como mucho uno de cada EVERY fotogramas (una puerta que se abre, un árbol que tiembla al talarlo).
  // box ([x0, z0, x1, z1] del mundo, de lo que ha cambiado): si queda fuera de la zona de sombras pintada, no hace falta
  // (los trozos que se hacen a lo lejos al andar; cuando la zona llegue allí, ya se repinta todo)
  stale(now = false, box = null) {
    if (box && this.zoneSet && !this.zone.intersectsBox(BOX.set(V.set(box[0], -40, box[1]), V2.set(box[2], 120, box[3])))) return;
    if (now) this.staticDirty = true; else this.pending = true;
  }

  // Dónde va la zona de sombras y hacia dónde da el sol, cada fotograma antes de dibujar. target: lo que mira la cámara;
  // yaw y low: hacia dónde y cuánto se adelanta la zona (con la cámara baja se ve más lejos); dir: hacia el sol (o la luna);
  // half: la mitad del lado de la zona que se querría, en metros
  place(target, yaw, low, cave, dir, half) {
    const sun = this.v.sun, sc = sun.shadow.camera;
    if (cave) {
      // (en cuevas el sol no alumbra: se aparta lejos, de modo que ningún píxel cae en su zona y el sombreador ni mira
      // el mapa, y no se pinta nada. Sin tocar castShadow, que haría recompilar todos los materiales al entrar)
      if (!this.parked) {
        sun.target.position.set(1e5, 0, 1e5); sun.position.set(1e5, 50, 1e5);
        sun.updateMatrixWorld(); sun.target.updateMatrixWorld(); sun.shadow.updateMatrices(sun);
        this.parked = true;
      }
      this.skip = true;
      return;
    }
    if (this.parked) { this.parked = false; this.staticDirty = true; this.zoneSet = false; }
    // (entre la puesta y la noche cerrada no hay sol: el mapa ni se toca; al volver la luz, se repinta lo fijo)
    const off = sun.intensity < 0.02;
    if (this.skip && !off) this.staticDirty = true;
    this.skip = off;
    // (el tamaño, a metros enteros y solo si cambia más de HALF_GAP: con la cámara subiendo y bajando sobre los tejados
    // no se repinta a cada momento)
    if (Math.abs(half - sc.right) > HALF_GAP) { half = Math.round(half); Object.assign(sc, { left: -half, right: half, top: half, bottom: -half }); sc.updateProjectionMatrix(); this.staticDirty = true; }
    if (!this.dirSet || this.dir.angleTo(dir) > TURN) { this.dir.copy(dir); this.dirSet = true; this.staticDirty = true; }
    const ahead = 12 * low, wx = target.x - Math.sin(yaw) * ahead, wz = target.z - Math.cos(yaw) * ahead;
    // (a la altura de lo que se mira: en lo alto de un monte, lo de allí también cabe en la profundidad de la zona)
    if (this.staticDirty || Math.hypot(wx - this.center.x, target.y - this.center.y, wz - this.center.z) > MOVE) {
      this.snapTexel(V.set(wx, target.y, wz), 2 * sc.right / sun.shadow.mapSize.x);
      this.staticDirty = true;
    }
    // (la luz solo se mueve cuando se repinta lo fijo: entre medias, la matriz del pase de lo móvil tiene que ser la misma)
    sun.target.position.copy(this.center);
    sun.position.copy(this.center).addScaledVector(this.dir, 50);
  }
  // El centro de la zona, alineado a los texels del mapa: con los mismos ejes que la cámara de la sombra (Camera.lookAt
  // con el sol detrás), se redondea lo que cae a lo ancho y a lo alto del mapa; lo que va hacia el sol no importa
  snapTexel(c, texel) {
    AZ.copy(this.dir);
    AX.crossVectors(UP, AZ);
    if (AX.lengthSq() < 1e-8) AX.set(1, 0, 0);
    AX.normalize(); AY.crossVectors(AZ, AX);
    const x = Math.round(c.dot(AX) / texel) * texel, y = Math.round(c.dot(AY) / texel) * texel, z = c.dot(AZ);
    this.center.copy(AX).multiplyScalar(x).addScaledVector(AY, y).addScaledVector(AZ, z);
  }

  // El pase de sombras (en lugar del de Three, que se llama desde aquí)
  render(lights, scene, cam, orig) {
    const v = this.v, r = v.renderer, sm = r.shadowMap, sun = v.sun;
    // (otra escena, como el horneado de los impostores: a lo de Three, tal cual)
    if (scene !== v.scene || !lights.includes(sun)) return orig(lights, scene, cam);
    if (!sm.needsUpdate) return;   // (la segunda y tercera pasada de draw(), el borde de lo apuntado)
    const hold = this.hold;
    this.hold = false;
    if (!sm.enabled) { this.staticDirty = true; return; }   // (al volver a encenderlas, lo fijo se repinta)
    if (this.skip || hold) { sm.needsUpdate = false; return; }
    this.n++;
    const now = performance.now();
    if (this.pending && this.n - this.lastStatic >= EVERY) this.staticDirty = true;
    if (now - this.lastStaticT > SAFETY) this.staticDirty = true;
    // Como antes: todo el mapa, cada dos fotogramas o cuando hay que repintar lo fijo
    if (!this.ok) {
      if (this.staticDirty || this.n % 2 === 0) { this.count(() => orig([sun], scene, cam), 'callsFijo'); this.done(now); }
      sm.needsUpdate = false;
      return;
    }
    const dyn = this.dynRoots();
    let ok = true;
    if (this.staticDirty || !sun.shadow.map || !this.cache) {
      // Lo fijo: todo lo de la escena menos lo que se mueve, al mapa, y de ahí a la caché
      for (const g of dyn) { g.userData.shWas = g.visible; g.visible = false; }
      try { this.count(() => orig([sun], scene, cam), 'callsFijo'); }
      finally { for (const g of dyn) g.visible = g.userData.shWas; }
      // (lo que abarca lo pintado: lo que cambie fuera no obliga a repintar; ver stale)
      const sc = sun.shadow.camera;
      this.zone.setFromProjectionMatrix(PM.multiplyMatrices(sc.projectionMatrix, sc.matrixWorldInverse)); this.zoneSet = true;
      this.ensureCache();
      ok = this.blit(sun.shadow.map, this.cache, null);
      this.done(now);
      this.prev = [];
    } else if (this.prev.length) ok = this.blit(this.cache, sun.shadow.map, this.prev);   // (donde estaba lo móvil, lo fijo otra vez)
    // (si la gráfica no deja copiar, se vuelve a lo de antes para siempre, y en este fotograma se pinta todo)
    if (!ok) {
      console.warn('Sombras: no se puede copiar el mapa de sombras; se rehace entero, como antes');
      this.ok = false; this.cache?.dispose(); this.cache = null; this.prev = [];
      sm.needsUpdate = true; orig([sun], scene, cam);
      return;
    }
    // Lo móvil, encima, sin borrar (dentro de su pase, Three borra el destino: se le quita ese borrado un momento)
    sun.shadow.updateMatrices(sun);
    const cur = this.rects();
    if (cur.length) {
      const stat = [];
      for (const o of scene.children) if (o.visible && !o.isLight && !dyn.includes(o)) { o.visible = false; stat.push(o); }
      const clear = r.clear;
      r.clear = () => {};
      sm.needsUpdate = true;
      try { this.count(() => orig([sun], scene, cam), 'movil'); }
      finally { r.clear = clear; for (const o of stat) o.visible = true; }
      this.stats.parches += cur.length;
    }
    this.prev = cur;
    sm.needsUpdate = false;
    this.tally(now);
  }
  done(now) { this.staticDirty = false; this.pending = false; this.lastStatic = this.n; this.lastStaticT = now; this.nStatic++; this.stats.fijos++; }
  count(f, k) { const info = this.v.renderer.info.render, c0 = info.calls; f(); this.stats[k] += info.calls - c0; }
  // Cada media vuelta, las cifras por segundo y por fotograma
  tally(now) {
    const s = this.stats;
    s.frames++;
    if (now - s.t < 500) return;
    const sec = (now - s.t) / 1000;
    s.out = { fijosPorSegundo: s.fijos / sec, llamadasFijo: s.fijos ? s.callsFijo / s.fijos : 0, llamadasMovil: s.movil / s.frames, parches: s.parches / s.frames };
    s.fijos = s.movil = s.parches = s.frames = 0; s.callsFijo = 0; s.t = now;
  }
  // La caché: del mismo tamaño y formato que el mapa (copiar color y fondo entre los dos exige que casen)
  ensureCache() {
    const m = this.v.sun.shadow.map, r = this.v.renderer;
    if (this.cache && this.cache.width === m.width && this.cache.height === m.height) return;
    this.cache?.dispose();
    this.cache = new THREE.WebGLRenderTarget(m.width, m.height, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    // (que Three cree ya su framebuffer: r160 no tiene initRenderTarget)
    const cur = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
    r.setRenderTarget(this.cache); r.setRenderTarget(cur, face, mip);
  }
  // Copia rectángulos (en texels; null, todo) de un destino a otro: color (la profundidad empaquetada que lee el
  // sombreador) y fondo (contra el que se prueba lo móvil). false si la gráfica no lo deja
  blit(from, to, rects) {
    const r = this.v.renderer, gl = r.getContext(), st = r.state, P = r.properties;
    const fa = P.get(from).__webglFramebuffer, fb = P.get(to).__webglFramebuffer;
    if (!fa || !fb) return false;
    const cur = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
    // (a la copia le afecta el recorte de la tijera; las máscaras se dejan abiertas por si el controlador las aplica)
    st.setScissorTest(false); st.buffers.color.setMask(true); st.buffers.depth.setMask(true);
    st.bindFramebuffer(gl.READ_FRAMEBUFFER, fa); st.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fb);
    const bits = gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT;
    if (!rects) gl.blitFramebuffer(0, 0, from.width, from.height, 0, 0, to.width, to.height, bits, gl.NEAREST);
    else for (const q of rects) gl.blitFramebuffer(q[0], q[1], q[2], q[3], q[0], q[1], q[2], q[3], bits, gl.NEAREST);
    st.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    r.setRenderTarget(cur, face, mip);
    // (la primera vez se pregunta a la gráfica si ha ido bien; después no, que esperar a la respuesta frena)
    if (!this.checked) { this.checked = true; const e = gl.getError(); if (e) { console.warn('Sombras: error al copiar', e); return false; } }
    return true;
  }

  // Los rectángulos (en texels del mapa) de todo lo que se mueve y da sombra en este fotograma
  rects() {
    const v = this.v, out = [];
    for (const m of v.actors.models.values()) {
      if (!m.root.visible || m.kind === 'none' || !m.root.parent) continue;
      const p = m.root.position, P = m.person;
      if (P) {
        const lying = Math.abs(m.root.rotation.x) > 0.5, h = P.height || 1.7;
        if (lying) this.sphere(out, p.x, p.y + 0.3, p.z, h + 0.4);
        else this.sphere(out, p.x, p.y + P.root.position.y + h * 0.5, p.z, Math.max(PERSON_R * Math.min(1, h / 1.6), h * 0.6 + 0.45));
        if (m.horse?.visible) this.sphere(out, p.x, p.y + 1, p.z, RIDE_R);
        if (m.boat?.visible) this.sphere(out, p.x, p.y + 0.4, p.z, RIDE_R);
        // (lo que lleva en la mano, como esté ahora: un hacha en alto, una caña)
        if (m.hand?.children.length) this.box(out, m.hand);
      } else if (m.kind === 'baby') this.sphere(out, p.x, p.y + 0.2, p.z, 0.8);
      else {
        // (animales y monstruos: su caja una vez, sin escala, como esfera alrededor de su raíz; gira con ellos)
        const s = m.root.scale.x || 1;
        if (!m.shS) {
          BX.setFromObject(m.root);
          if (BX.isEmpty()) continue;
          BX.getBoundingSphere(SP);
          m.shS = [(SP.center.y - p.y) / s, (Math.hypot(SP.center.x - p.x, SP.center.z - p.z) + SP.radius) / s + 0.4];
        }
        this.sphere(out, p.x, p.y + m.shS[0] * s, p.z, m.shS[1] * s);
      }
    }
    // Los objetos caídos y la vista previa de lo que se coloca (su caja, cada vez: son pocos)
    for (const o of v.fx.group.children) {
      if (!o.visible) continue;
      let cast = o.userData.shCast;
      if (cast === undefined) { cast = false; o.traverse(q => { if (q.castShadow && q.isMesh) cast = true; }); o.userData.shCast = cast; }
      if (cast) this.box(out, o);
    }
    // Lo que gira en los modelos (la rueda de la noria): su esfera, una vez, alrededor de su eje
    for (const o of v.world.spin?.children || []) {
      if (!o.visible) continue;
      if (!o.userData.shS) { BX.setFromObject(o); BX.getBoundingSphere(SP); o.userData.shS = SP.radius + SP.center.distanceTo(o.position) + 0.2; }
      this.sphere(out, o.position.x, o.position.y, o.position.z, o.userData.shS);
    }
    return out;
  }
  box(out, o) {
    BX.setFromObject(o);
    if (BX.isEmpty()) return;
    BX.getBoundingSphere(SP);
    this.sphere(out, SP.center.x, SP.center.y, SP.center.z, SP.radius);
  }
  // Una esfera del mundo, en el mapa: la proyección es ortográfica, así que es un círculo del mismo radio
  sphere(out, x, y, z, rad) {
    const sh = this.v.sun.shadow, sc = sh.camera, W = sh.mapSize.x, H = sh.mapSize.y;
    V.set(x, y, z).applyMatrix4(sc.matrixWorldInverse);
    const kx = W / (sc.right - sc.left), ky = H / (sc.top - sc.bottom);
    const px = (V.x - sc.left) * kx, py = (V.y - sc.bottom) * ky, rx = rad * kx + MARGIN, ry = rad * ky + MARGIN;
    const x0 = Math.max(0, Math.floor(px - rx)), y0 = Math.max(0, Math.floor(py - ry)), x1 = Math.min(W, Math.ceil(px + rx)), y1 = Math.min(H, Math.ceil(py + ry));
    if (x1 > x0 && y1 > y0) out.push([x0, y0, x1, y1]);
  }
  // Para F3
  text() {
    const o = this.stats.out;
    if (!this.ok) return `sombras: todo el mapa cada dos fotogramas${ALL ? ' (?sombras=todas)' : ' (sin copia entre destinos)'}`;
    if (!o) return 'sombras: aún sin cifras';
    const f = x => x.toFixed(1).replace('.', ',');
    return `sombras: fijo ${f(o.fijosPorSegundo)}/s (${Math.round(o.llamadasFijo)} llamadas) · móvil ${f(o.llamadasMovil)} llamadas · ${f(o.parches)} parches${this.skip ? ' · sin sol' : ''}`;
  }
}
