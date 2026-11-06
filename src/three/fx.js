// Efectos en 3D: la casilla o el objeto apuntado, la vista previa de lo que se va a colocar o construir, los
// objetos caídos (con su icono), los textos que suben sobre el jugador, las astillas de lo que se golpea, el
// fuego de hogares, hornos y antorchas, el humo de las chimeneas, las mariposas, la lluvia y la nieve, el agua
// de la fuente, los corazones de la cama doble, la luz del faro, el sedal y el corcho al pescar y el destello rojo al recibir un golpe.
import * as THREE from 'three';
import { itemIcon } from '../art/items.js';
import { dropModel } from './icons.js';
import { yawOf, rugRect, tableRect } from '../art/stations.js';
import { ITEMS } from '../items.js';
import { PIECES } from '../pieces.js';
import { getModel } from './models.js';
import { WALL_H } from './build3d.js';
import { WATER_Y } from './terrain.js';
import { nearX } from '../world/planet.js';

const tmp = new THREE.Object3D(), col = new THREE.Color(), v3 = new THREE.Vector3();

export class Fx {
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    view.scene.add(this.group);
    // Casilla apuntada: un marco en el suelo; objeto apuntado: un aro
    const frame = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.02, 1));
    this.tile = new THREE.LineSegments(frame, new THREE.LineBasicMaterial({ color: '#ffd77a', transparent: true, depthWrite: false }));
    this.tileFill = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd77a', transparent: true, opacity: 0.18, depthWrite: false }));
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.66, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd77a', transparent: true, opacity: 0.8, depthWrite: false }));
    for (const o of [this.tile, this.tileFill, this.ring]) { o.renderOrder = 3; this.group.add(o); }
    this.ghost = null; this.ghostKey = null;
    this.ghostMat = new THREE.MeshStandardMaterial({ color: '#c8ffd0', transparent: true, opacity: 0.5, depthWrite: false, roughness: 0.6, emissive: '#2a6a3a', emissiveIntensity: 0.4 });
    // Objetos caídos: su icono, de cara a la cámara, con una sombrita
    this.drops = new Map();
    this.blob = new THREE.Mesh(new THREE.CircleGeometry(0.18, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.25, depthWrite: false }));
    this.solids = new Map(); this.solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });   // (los objetos del suelo, en 3D)
    this.icons = new Map();
    // Astillas, llamas, humo, gotas de la fuente
    this.chips = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshStandardMaterial({ roughness: 0.8 }), 256);
    this.chips.count = 0; this.chips.frustumCulled = false; this.group.add(this.chips);
    // Los corazones que flotan sobre la cama doble: de cara a la cámara
    const hs = new THREE.Shape(); hs.moveTo(0, -1); hs.bezierCurveTo(-1.4, -0.1, -1.15, 1, -0.5, 1); hs.bezierCurveTo(-0.2, 1, 0, 0.75, 0, 0.5); hs.bezierCurveTo(0, 0.75, 0.2, 1, 0.5, 1); hs.bezierCurveTo(1.15, 1, 1.4, -0.1, 0, -1);
    this.hearts = new THREE.InstancedMesh(new THREE.ExtrudeGeometry(hs, { depth: 0.28, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2, curveSegments: 10 }).translate(0, 0, -0.14), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), 96);
    this.hearts.count = 0; this.hearts.frustumCulled = false; this.hearts.renderOrder = 4; this.group.add(this.hearts);
    const flameGeo = new THREE.ConeGeometry(1, 2, 7).translate(0, 1, 0);
    this.flameOut = new THREE.InstancedMesh(flameGeo, new THREE.MeshBasicMaterial({ color: '#ff7a1a', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }), 400);
    this.flameIn = new THREE.InstancedMesh(flameGeo, new THREE.MeshBasicMaterial({ color: '#ffe080', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }), 400);
    for (const f of [this.flameOut, this.flameIn]) { f.count = 0; f.frustumCulled = false; f.renderOrder = 4; this.group.add(f); }
    this.puff = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshStandardMaterial({ color: '#e8e8ec', transparent: true, opacity: 0.35, depthWrite: false, roughness: 1 }), 300);
    this.puff.count = 0; this.puff.frustumCulled = false; this.puff.renderOrder = 5; this.group.add(this.puff);
    this.spray = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 6, 4), new THREE.MeshStandardMaterial({ color: '#cfeaff', transparent: true, opacity: 0.8, roughness: 0.1 }), 240);
    this.spray.count = 0; this.spray.frustumCulled = false; this.group.add(this.spray);
    // Mariposas
    const wing = new THREE.CircleGeometry(0.06, 8);
    this.butterflies = Array.from({ length: 8 }, (_, i) => {
      const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: ['#ffe04a', '#ffffff', '#ff9ac8', '#9ad0ff'][i % 4], side: THREE.DoubleSide, roughness: 0.6 });
      const a = new THREE.Mesh(wing, m), b = new THREE.Mesh(wing, m); a.position.x = 0.05; b.position.x = -0.05; g.add(a, b);
      g.userData = { a, b, ph: i * 1.7, cx: 0, cz: 0, sp: 0.35 + (i % 3) * 0.12 };
      this.group.add(g);
      return g;
    });
    // Lluvia (rayas) y nieve (copos), en una caja alrededor de la cámara
    const N = 1800, rp = new Float32Array(N * 6);
    this.rainGeo = new THREE.BufferGeometry(); this.rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(this.rainGeo, new THREE.LineBasicMaterial({ color: '#b8c8dc', transparent: true, opacity: 0.55 }));
    this.rain.frustumCulled = false; this.group.add(this.rain);
    this.drop = Array.from({ length: N }, () => [Math.random(), Math.random(), Math.random()]);
    const sp = new Float32Array(N * 3);
    this.snowGeo = new THREE.BufferGeometry(); this.snowGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snow = new THREE.Points(this.snowGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.09, transparent: true, opacity: 0.9 }));
    this.snow.frustumCulled = false; this.group.add(this.snow);
    // Faro: un haz que gira de noche
    this.beam = new THREE.Mesh(new THREE.ConeGeometry(3, 26, 16, 1, true).translate(0, -13, 0).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#fff4c0', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.beam.visible = false; this.group.add(this.beam);
    // Pesca: el sedal y el corcho
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 21 }, () => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: '#f0f0f0', transparent: true, opacity: 0.8 }));
    this.line.frustumCulled = false;
    this.bobber = new THREE.Group();
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#ffffff' })), bot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e83a3a' }));
    this.bobber.add(top, bot);
    this.ripple = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.19, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#e0f4ff', transparent: true, opacity: 0.7, depthWrite: false }));
    this.group.add(this.line, this.bobber, this.ripple);
    // Textos flotantes (HTML encima del lienzo) y el destello rojo de los golpes
    this.layer = document.getElementById('floaters') || Object.assign(document.body.appendChild(document.createElement('div')), { id: 'floaters' });
    this.hurt = document.getElementById('hurt') || Object.assign(document.body.appendChild(document.createElement('div')), { id: 'hurt' });
    this.tags = new Map();
  }

  update(game, scene, dt, t) {
    const playing = !!game.player && game.scene === scene && game.mode !== 'menu';
    const view = this.view, gy = (x, y) => view.groundY(scene, x, y);
    this.updateTarget(game, scene, playing, t, gy);
    this.updateDrops(game, scene, playing, t, gy);
    this.updateChips(game, playing);
    this.updateHearts(game, scene, playing, t);
    this.updateFlames(scene, t);
    this.updateSmoke(scene, t);
    this.updateFountains(scene, t);
    this.updateButterflies(game, scene, playing, dt, t);
    this.updateWeather(t);
    this.updateFishing(game, scene, playing, t);
    this.updateBeacon(scene, t);
    this.updateFloaters(game, playing);
    this.hurt.style.opacity = playing && game.flashHurt > game.time ? '1' : '0';
  }

  // ---------- apuntar y colocar ----------
  updateTarget(game, scene, playing, t, gy) {
    this.tile.visible = this.tileFill.visible = this.ring.visible = false;
    let ghost = null, ghostOk = true, at = null, yaw = 0;
    if (playing) {
      const b = game.build;
      const pulse = Math.sin(t * 6) > 0 ? '#fff3c0' : '#ffd77a';
      if (b.on) {
        const tt = b.target();
        if (tt) {
          const c = b.check(tt);
          this.showTile(tt, gy, c.ok ? pulse : '#ff7a6a');
          if (!b.erase) { ghost = 'piece:' + b.piece; ghostOk = c.ok; at = [tt[0] + 0.5, tt[1] + 0.5]; }
        }
      } else {
        const tg = game.gather.target;
        if (tg?.free) { ghost = tg.model; ghostOk = tg.ok; at = [tg.x, tg.y]; yaw = tg.a; }   // (lo libre: donde y como quedaría, sin casilla)
        else if (tg?.tile && (tg.ok || tg.place)) {
          this.showTile(tg.tile, gy, tg.ok ? pulse : '#ff7a6a');
          // (la alfombra y la mesa grande, enteras, del tamaño elegido; lo demás, arrimado al muro de detrás)
          if (tg.place && ITEMS[tg.place].place === 'rug') { const r = rugRect(...tg.tile, tg.rot); ghost = `rug:${tg.place}:${r.w}x${r.h}`; ghostOk = tg.ok; at = [r.x0 + r.w / 2, r.y0 + r.h / 2]; }
          else if (tg.place === 'mesa_grande') { const r = tableRect(...tg.tile, tg.rot); ghost = `mesa_grande:${r.w}x${r.h}`; ghostOk = tg.ok; at = [r.x0 + r.w / 2, r.y0 + r.h / 2]; }
          else if (tg.place) { const [sx, sy] = game.scene.shiftFor?.(tg.place, ...tg.tile, tg.rot) || [0, 0]; ghost = tg.place; ghostOk = tg.ok; at = [tg.tile[0] + 0.5 + sx, tg.tile[1] + 0.5 + sy]; yaw = yawOf(tg.rot); }
        } else if (tg?.obj) {
          this.ring.visible = true;
          this.ring.position.set(tg.obj.x, gy(tg.obj.x, tg.obj.y) + 0.04, tg.obj.y);
          this.ring.material.color.set(pulse);
          this.ring.scale.setScalar(1 + Math.sin(t * 6) * 0.06);
        }
      }
    }
    const hl = playing && game.highlight;
    if (hl?.ring) {   // (un árbol con fruta apuntado con el cursor: un aro a sus pies)
      this.ring.visible = true;
      this.ring.position.set(hl.box.x, gy(hl.box.x, hl.box.y) + 0.04, hl.box.y);
      this.ring.material.color.set(Math.sin(t * 6) > 0 ? '#fff3c0' : '#ffd77a');
      this.ring.scale.setScalar(1.3 + Math.sin(t * 6) * 0.06);
    }
    if (ghost !== this.ghostKey) {
      if (this.ghost) this.group.remove(this.ghost);
      this.ghost = ghost ? this.makeGhost(ghost) : null;
      if (this.ghost) this.group.add(this.ghost);
      this.ghostKey = ghost;
    }
    if (this.ghost) {
      this.ghost.position.set(at[0], gy(...at) + 0.01, at[1]);
      this.ghost.rotation.y = yaw;
      this.ghostMat.opacity = ghostOk ? 0.55 : 0.5;   // (en rojo, bien visible: así se ve qué corta)
      this.ghostMat.color.set(ghostOk ? '#c8ffd0' : '#ffb0a0');
    }
  }
  showTile([tx, ty], gy, color) {
    const y = gy(tx + 0.5, ty + 0.5) + 0.04;
    this.tile.visible = this.tileFill.visible = true;
    this.tile.position.set(tx + 0.5, y, ty + 0.5); this.tileFill.position.set(tx + 0.5, y, ty + 0.5);
    this.tile.material.color.set(color); this.tileFill.material.color.set(color);
  }
  // Vista previa: el modelo de lo que se coloca, o una forma sencilla de la pieza (muro, suelo, tejado…)
  makeGhost(key) {
    const g = new THREE.Group(), M = this.ghostMat;
    if (key.startsWith('piece:')) {
      const id = key.slice(6), p = PIECES[id], kind = p?.kind, layer = p?.layer;
      const box = (x0, y0, z0, x1, y1, z1) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), M); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); g.add(m); };
      if (layer === 'floor') box(-0.5, 0, -0.5, 0.5, 0.05, 0.5);
      else if (layer === 'roof') { box(-0.5, WALL_H, -0.5, 0.5, WALL_H + 0.16, 0.5); }
      else if (kind === 'wall') { box(-0.5, 0, -0.12, 0.5, WALL_H, 0.12); if (id.startsWith('ventana')) box(-0.3, 1.0, -0.14, 0.3, 1.95, 0.14); }
      else if (kind === 'door') { box(-0.5, 2.05, -0.12, 0.5, WALL_H, 0.12); box(-0.5, 0, -0.12, -0.42, 2.05, 0.12); box(0.42, 0, -0.12, 0.5, 2.05, 0.12); box(-0.4, 0, -0.03, 0.4, 2.0, 0.03); }
      else if (kind === 'gate') return this.modelGhost('puerta_valla');
      else if (kind === 'fence') { box(-0.06, 0, -0.06, 0.06, 0.95, 0.06); box(-0.5, 0.36, -0.04, 0.5, 0.46, 0.04); box(-0.5, 0.72, -0.04, 0.5, 0.82, 0.04); }
      else if (kind === 'hearth') return this.modelGhost('chimenea');
      return g;
    }
    return this.modelGhost(key);
  }
  modelGhost(name) {
    const m = getModel(name), g = new THREE.Group();
    if (!m) return g;
    for (const B of m.parts.values()) g.add(B.mesh(this.ghostMat, { cast: false, receive: false }));
    for (const e of m.extras) { const o = e.clone(); o.traverse(q => { if (q.isMesh) q.material = this.ghostMat; }); g.add(o); }
    return g;
  }

  // ---------- objetos caídos ----------
  // (la ropa, con su color)
  icon(id, color) {
    const k = color ? `${id}|${color}` : id;
    if (!this.icons.has(k)) {
      const t = new THREE.CanvasTexture(itemIcon(id, color)); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
      this.icons.set(k, new THREE.SpriteMaterial({ map: t, transparent: true, alphaTest: 0.3 }));
    }
    return this.icons.get(k);
  }
  // Lo que hay en el suelo, como en Minecraft: el icono hecho pieza (cada píxel, un cubito con grosor) o, si lo
  // tiene, el modelo 3D en miniatura, que gira despacio y flota subiendo y bajando, con su sombra debajo
  updateDrops(game, scene, playing, t, gy) {
    const list = playing ? game.gather.drops.filter(d => d.scene === scene) : [], seen = new Set();
    for (const d of list) {
      seen.add(d);
      let o = this.drops.get(d);
      if (!o) { const s = dropModel(d.id) || new THREE.Mesh(this.solid(d.id, d.extra?.color), this.solidMat); s.castShadow = true; const b = this.blob.clone(); o = { s, b, seed: Math.random() * 6 }; this.group.add(s, b); this.drops.set(d, o); }
      const g = gy(d.x, d.y), bob = Math.sin(t * 2.6 + o.seed) * 0.05;
      o.s.position.set(d.x, g + 0.26 + d.z / 24 + bob, d.y);
      o.s.rotation.y = t * 1.6 + o.seed;
      o.b.position.set(d.x, g + 0.02, d.y);
      o.b.scale.setScalar(1 - Math.min(0.5, d.z / 40) + bob);
    }
    for (const [d, o] of this.drops) if (!seen.has(d)) { this.group.remove(o.s, o.b); this.drops.delete(d); }
  }
  // La pieza 3D de un objeto, a partir de su icono de 18×18: por delante y por detrás cada píxel; por los
  // lados, solo donde acaba el dibujo (los lados, algo más oscuros). Mide 0,36 de ancho
  solid(id, color) {
    const k = color ? `${id}|${color}` : id;
    if (this.solids.has(k)) return this.solids.get(k);
    const c = itemIcon(id, color), W = c.width, H = c.height, px = c.getContext('2d').getImageData(0, 0, W, H).data;
    const S = 0.36 / W, D = S * 0.75, pos = [], col = [], at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && px[(y * W + x) * 4 + 3] > 100;
    const quad = (a, b, c2, d2, r, g, bl) => { pos.push(...a, ...b, ...c2, ...a, ...c2, ...d2); for (let i = 0; i < 6; i++) col.push(r, g, bl); };
    const tc = new THREE.Color();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!at(x, y)) continue;
      const i = (y * W + x) * 4;
      tc.setRGB(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255, THREE.SRGBColorSpace);
      const { r, g, b } = tc, x0 = (x - W / 2) * S, x1 = x0 + S, y1 = (H / 2 - y) * S, y0 = y1 - S;
      quad([x0, y0, D], [x1, y0, D], [x1, y1, D], [x0, y1, D], r, g, b);         // delante
      quad([x1, y0, -D], [x0, y0, -D], [x0, y1, -D], [x1, y1, -D], r, g, b);     // detrás
      const k2 = 0.72;
      if (!at(x - 1, y)) quad([x0, y0, -D], [x0, y0, D], [x0, y1, D], [x0, y1, -D], r * k2, g * k2, b * k2);
      if (!at(x + 1, y)) quad([x1, y0, D], [x1, y0, -D], [x1, y1, -D], [x1, y1, D], r * k2, g * k2, b * k2);
      if (!at(x, y - 1)) quad([x0, y1, D], [x1, y1, D], [x1, y1, -D], [x0, y1, -D], r * 0.9, g * 0.9, b * 0.9);
      if (!at(x, y + 1)) quad([x0, y0, -D], [x1, y0, -D], [x1, y0, D], [x0, y0, D], r * k2, g * k2, b * k2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    this.solids.set(k, geo);
    return geo;
  }
  updateChips(game, playing) {
    const parts = playing ? game.gather.parts : [];
    let n = 0;
    for (const q of parts) {
      if (n >= 256 || q.z === undefined) continue;
      const k = 1 - q.t / q.life;
      tmp.position.set(q.x, q.z, q.y); tmp.rotation.set(q.t * 9, q.t * 7, 0); tmp.scale.setScalar(Math.max(0.1, k));
      tmp.updateMatrix(); this.chips.setMatrixAt(n, tmp.matrix); this.chips.setColorAt(n, col.set(q.col)); n++;
    }
    this.chips.count = n;
    this.chips.instanceMatrix.needsUpdate = true;
    if (this.chips.instanceColor) this.chips.instanceColor.needsUpdate = true;
  }

  updateHearts(game, scene, playing, t) {
    const list = playing && game.player ? game.family.hearts : [], me = game.player;
    let n = 0;
    for (const h of list) {
      if (n >= 96) break;
      const k = h.t / h.life, grow = Math.min(1, h.t * 3) * Math.min(1, (1 - k) * 4);   // (aparece y se va encogiendo)
      const beat = h.big ? 1 + Math.sin(t * 5) * 0.08 : 1, sway = h.big ? 0 : Math.sin(h.t * 2.4 + h.ph) * 0.14;
      tmp.position.set(nearX(h.x, me.x) + sway, this.view.groundY(scene, h.x, h.y) + h.z + (h.big ? Math.sin(t * 1.5) * 0.05 : 0), h.y);
      tmp.quaternion.copy(this.view.camera.quaternion);
      if (!h.big) tmp.rotateZ(Math.sin(h.t * 1.8 + h.ph) * 0.3);
      tmp.scale.setScalar(Math.max(0.001, h.s * grow * beat));
      tmp.updateMatrix(); this.hearts.setMatrixAt(n, tmp.matrix);
      this.hearts.setColorAt(n, col.set(h.big ? '#f0306e' : ['#f0406e', '#ff5f8f', '#ff86aa'][Math.floor(h.ph * 3 / 6.3)]));
      n++;
    }
    tmp.quaternion.identity();
    this.hearts.count = n;
    this.hearts.instanceMatrix.needsUpdate = true;
    if (this.hearts.instanceColor) this.hearts.instanceColor.needsUpdate = true;
  }

  // ---------- fuego, humo y agua ----------
  updateFlames(scene, t) {
    const src = this.view.cave ? this.view.cave.flames() : this.view.world.flames(), target = this.view.cam.target;
    let n = 0;
    for (const [x, y, z, s] of src) {
      if (n >= 400 || Math.abs(x - target.x) > 40 || Math.abs(z - target.z) > 40) continue;
      for (const [im, k, sc] of [[this.flameOut, 0, 1], [this.flameIn, 1, 0.55]]) {
        const fl = 1 + Math.sin(t * 13 + x * 7 + k) * 0.15 + Math.sin(t * 29 + z * 5) * 0.1;
        tmp.position.set(x, y, z); tmp.rotation.set(Math.sin(t * 7 + x) * 0.1, t * 2, Math.sin(t * 9 + z) * 0.1);
        tmp.scale.set(0.09 * s * sc, 0.16 * s * sc * fl, 0.09 * s * sc); tmp.updateMatrix(); im.setMatrixAt(n, tmp.matrix);
      }
      n++;
    }
    this.flameOut.count = this.flameIn.count = n;
    this.flameOut.instanceMatrix.needsUpdate = this.flameIn.instanceMatrix.needsUpdate = true;
  }
  updateSmoke(scene, t) {
    if (this.view.cave) { this.puff.count = 0; return; }
    const src = this.view.world.smoke(), target = this.view.cam.target;
    let n = 0;
    for (const [x, y, z] of src) {
      if (Math.abs(x - target.x) > 45 || Math.abs(z - target.z) > 45) continue;
      for (let i = 0; i < 10 && n < 300; i++) {
        const q = (t * 0.22 + i / 10 + x * 0.13) % 1;
        tmp.position.set(x + q * 1.4 + Math.sin(q * 7 + i) * 0.15, y + q * 2.6, z + Math.cos(q * 5 + i) * 0.15);
        tmp.scale.setScalar(0.12 + q * 0.4); tmp.rotation.set(0, 0, 0); tmp.updateMatrix();
        this.puff.setMatrixAt(n++, tmp.matrix);
      }
    }
    this.puff.count = n;
    this.puff.instanceMatrix.needsUpdate = true;
  }
  updateFountains(scene, t) {
    const src = this.view.cave ? [] : this.view.world.fountains();
    let n = 0;
    for (const [x, y, z] of src) for (let i = 0; i < 60 && n < 240; i++) {
      const a = (i / 60) * Math.PI * 2, q = (t * 0.9 + (i * 0.37) % 1) % 1, r = q * 0.9;
      tmp.position.set(x + Math.cos(a) * r, y + 0.1 + Math.sin(q * Math.PI) * 0.7 - q * 0.6, z + Math.sin(a) * r);
      tmp.scale.setScalar(1); tmp.updateMatrix(); this.spray.setMatrixAt(n++, tmp.matrix);
    }
    this.spray.count = n;
    this.spray.instanceMatrix.needsUpdate = true;
  }
  updateBeacon(scene, t) {
    let b = null;
    if (!this.view.cave) for (const c of this.view.world.chunks.values()) if (c.beacon) b = c.beacon;
    this.beam.visible = !!b && this.view.night > 0.3;
    if (b) { this.beam.position.set(...b); this.beam.rotation.y = t * 0.8; }
  }

  // ---------- ambiente ----------
  updateButterflies(game, scene, playing, dt, t) {
    const show = !this.view.cave && !game.indoors && this.view.night < 0.3 && !this.view.weather?.rain && !this.view.weather?.snow && scene.gen?.season !== 3;
    const target = this.view.cam.target;
    for (const b of this.butterflies) {
      b.visible = show;
      if (!show) continue;
      const u = b.userData;
      if (Math.hypot(u.cx - target.x, u.cz - target.z) > 18) { u.cx = target.x + (Math.random() - 0.5) * 24; u.cz = target.z + (Math.random() - 0.5) * 24; }
      const q = t * u.sp + u.ph;
      b.position.set(u.cx + Math.sin(q) * 2.5, 0.7 + Math.sin(q * 3) * 0.35, u.cz + Math.cos(q * 0.8) * 2.5);
      b.rotation.y = Math.atan2(Math.cos(q), -Math.sin(q * 0.8) * 0.8);
      const f = Math.sin(t * 22 + u.ph) * 1.1;
      u.a.rotation.y = f; u.b.rotation.y = -f;
    }
  }
  updateWeather(t) {
    const w = this.view.weather || {}, c = this.view.camera.position, rain = w.rain || 0, N = this.drop.length;
    this.rain.visible = !!rain && !this.view.cave;
    this.snow.visible = !!w.snow && !this.view.cave;
    if (this.rain.visible) {
      const p = this.rainGeo.attributes.position.array, n = Math.floor(N * (rain === 2 ? 1 : 0.6)), fall = rain === 2 ? 22 : 16;
      for (let i = 0; i < N; i++) {
        const [a, b, h] = this.drop[i];
        if (i >= n) { p.fill(0, i * 6, i * 6 + 6); continue; }
        const y = 18 - ((t * fall + h * 18) % 18), x = c.x + (a - 0.5) * 50 + y * 0.12, z = c.z + (b - 0.5) * 50;
        p.set([x, y + c.y * 0 + this.view.cam.target.y - 2, z, x - 0.06, y + 0.5 + this.view.cam.target.y - 2, z], i * 6);
      }
      this.rainGeo.attributes.position.needsUpdate = true;
    }
    if (this.snow.visible) {
      const p = this.snowGeo.attributes.position.array;
      for (let i = 0; i < N; i++) {
        const [a, b, h] = this.drop[i], y = 16 - ((t * 1.4 + h * 16) % 16);
        p.set([c.x + (a - 0.5) * 44 + Math.sin(t + i) * 0.4, y + this.view.cam.target.y - 2, c.z + (b - 0.5) * 44 + Math.cos(t * 0.7 + i) * 0.4], i * 3);
      }
      this.snowGeo.attributes.position.needsUpdate = true;
    }
  }

  // ---------- pesca ----------
  // El corcho vuela en arco hasta el agua, tiembla en las picadas de mentira, se hunde al picar y, peleando,
  // se agita y se acerca a la orilla según va saliendo el pez; el sedal se tensa. Y los paneles de la pesca
  // (fuerza y pelea), junto al jugador en la pantalla.
  updateFishing(game, scene, playing, t) {
    const s = playing ? game.fishing?.state : null, p = game.player;
    const show = !!s && scene === game.world;
    this.line.visible = this.bobber.visible = this.ripple.visible = show;
    if (!show) return;
    // (el sedal sale de la punta de la caña; si no se ve la caña, de un poco por encima de la mano)
    const hand = this.view.actors.player?.hand, tip = hand?.getObjectByName('tip');
    const from = tip ? tip.getWorldPosition(new THREE.Vector3()) : hand ? hand.getWorldPosition(v3.set(0, 0, 0)).clone() : new THREE.Vector3(p.x, 1.2, p.y);
    if (!tip) from.y += 0.9;
    const x = s.bx, z = s.by; let dip = Math.sin(t * 3) * 0.015, sag = 0.4;
    if (s.phase === 'bite') dip = -0.05 + Math.sin(t * 30) * 0.03;
    else if (s.nib > 0) dip = -0.035 * Math.sin((s.nib / 0.3) * Math.PI);
    const to = new THREE.Vector3(x, WATER_Y + 0.03 + dip, z);
    if (s.fly < 1) { to.lerpVectors(from, to, s.fly); to.y += Math.sin(s.fly * Math.PI) * 1.2; sag = 0.1; }
    this.bobber.position.copy(to);
    const pts = this.line.geometry.attributes.position;
    for (let i = 0; i <= 20; i++) { const k = i / 20; pts.setXYZ(i, from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k - Math.sin(k * Math.PI) * sag, from.z + (to.z - from.z) * k); }
    pts.needsUpdate = true;
    this.ripple.visible = s.phase === 'bite' || s.nib > 0;
    const w = (t * 2) % 1;
    this.ripple.position.set(to.x, WATER_Y + 0.01, to.z);
    this.ripple.scale.setScalar((s.nib > 0 ? 0.7 : 1) + w * 1.5);
    this.ripple.material.opacity = (s.nib > 0 ? 0.4 : 0.7) * (1 - w);
  }

  // ---------- textos flotantes ----------
  updateFloaters(game, playing) {
    const list = playing ? game.gather.floaters : [], seen = new Set(), cam = this.view.camera, w = innerWidth, h = innerHeight;
    for (const f of list) {
      seen.add(f);
      let el = this.tags.get(f);
      if (!el) { el = document.createElement('div'); el.className = 'floater'; el.textContent = f.text; el.style.color = f.color; this.layer.appendChild(el); this.tags.set(f, el); }
      const y = this.view.groundY(game.scene, f.x, f.y) + 2.1 + (f.row || 0) * 0.32 + f.t * 0.6;
      v3.set(f.x, y, f.y).project(cam);
      el.style.transform = `translate(${((v3.x + 1) / 2) * w}px, ${((1 - v3.y) / 2) * h}px) translate(-50%, -50%)`;
      el.style.opacity = String(Math.min(1, 2.5 - f.t * 1.8));
    }
    for (const [f, el] of this.tags) if (!seen.has(f)) { el.remove(); this.tags.delete(f); }
  }
}

