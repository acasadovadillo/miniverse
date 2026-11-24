// The marks of src/tracks.js on the ground (docs/planes/gta/PLAN-G-caza.md §3.4 and §8.1): one InstancedMesh of flat
// quads (prints, blood) and one of small patches of pressed blades (bent grass), one shared material with the track
// atlas painted on a canvas at load, the fade, the crouch contrast, the fresh-print floor and the locked-trail highlight
// done in the shader. Rebuilt only when tracks.ver or tracks.hver changes or the camera crosses a 4 m step, at most every
// 0.25 s; between rebuilds a frame only sets a few uniforms.
//
// Contract:
//   engine.js makes it once, after the arrows: view.tracks3d = new Tracks3D(view)
//   update(game, scene) every frame, right after arrows.update (hidden in caves, under a roof and with ?tracks=0)
//   proxies() → THREE.Group whose children carry the materials to precompile (engine.prepare adds them once)
//   Reads game.tracks (ver, hver, count, clkP, clkB, readK, the mark arrays, each()) and Settings.v.blood (false:
//   scuffed soil cells in the surface's colour instead of red blood).
//
// Look: the atlas is white with alpha, tinted per instance by the surface (a print is a darker patch of its own ground);
// blood is a muted dark red that dries towards brown with age, always flat on the ground (in tall grass a little raised and
// larger, between the tufts). In tall grass a print is a patch of blades pressed over the way it went, lighter than the
// tufts of the season, over the faint print in the earth: the same dark dot a trail shows from farther away. Fresh marks (under 30 % of their time) get a soft on-screen
// floor in third person (×1 to ×1.6 from 16 m), so the default 22 m camera can spot them without anything glowing; the
// locked trail's marks keep a minimum on-screen size (from 9 m) and get a warm rim round the dark mark (dark on pale ground,
// light on dark ground: either way it reads). Crouching darkens and firms up the marks
// within READ_R of the player.
import * as THREE from 'three';
import { Settings } from '../settings.js';
import { CAM } from '../camera.js';
import { nearX } from '../world/planet.js';
import { READ_R, K, S, DEAD, CAP, F_FLEE, F_LEFT, F_SECOND } from '../tracks.js';
import { GRASS, TUFT_LOD, tuftLods } from './nature3d.js';

const FLAT_MAX = 900, FLECK_MAX = 400, REACH = 45, STEP = 4, EVERY = 250;   // (EVERY: ms between two rebuilds at most)
const CELL = 64, COLS = 4, ROWS = 3, SCUFF = 11;
// The side of each atlas cell's quad, in metres (the drawing fills about 80 % of it): deer 0.11 m, boar 0.12, horse 0.14,
// boot 0.28, drops 0.05-0.1, a pool 0.4; the scuffed-soil cell takes the size of the blood it replaces (×1.5)
const SIZE = [0.14, 0.15, 0.17, 0.11, 0.08, 0.2, 0.34, 0.11, 0.13, 0.5, 0.3, 0.16];
const LIFT = 0.012, LIFT_GRASS = 0.028;   // (above the ground, along its normal: with the polygon offset, no flicker on slopes)
const UP = new THREE.Vector3(0, 1, 0);
const lin = hex => new THREE.Color(hex);
// The surface tints (none: blood scuffs on a path or rock), the pressed grass (the tufts' colour in each season, nature3d.js
// buildGround, a little lighter: blades show their pale side), blood and the locked trail's warm tone
const SURF_TINT = [lin('#4a3a2c'), lin('#66748f'), lin('#3a2a1c'), lin('#8a7656'), lin('#45331f'), lin('#45331f'), lin('#45331f')];
const BENT_TINTS = ['#86a058', '#7e9250', '#b29f5f', '#bec6b8'].map(lin), BLOOD = lin('#661610'), WARM = lin('#e6a544');

// ---------- the atlas (256 × 192: 4 × 3 cells of 64 px, white with alpha; up in a cell is the way the foot points) ----------
function paintAtlas() {
  const c = document.createElement('canvas');
  c.width = CELL * COLS; c.height = CELL * ROWS;
  const x = c.getContext('2d');
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const cell = (n, draw) => {
    x.save();
    x.translate((n % COLS + 0.5) * CELL, (Math.floor(n / COLS) + 0.5) * CELL);
    x.beginPath(); x.rect(-CELL / 2 + 3, -CELL / 2 + 3, CELL - 6, CELL - 6); x.clip();   // (a margin: no bleeding into the next cell)
    x.fillStyle = x.strokeStyle = '#ffffff'; x.lineCap = x.lineJoin = 'round';
    try { x.filter = 'blur(0.6px)'; } catch { /* (soft edges where the canvas can) */ }
    draw();
    x.restore();
  };
  const ellipse = (cx, cy, rx, ry, a = 0, alpha = 1) => { x.globalAlpha = alpha; x.beginPath(); x.ellipse(cx, cy, rx, ry, a, 0, Math.PI * 2); x.fill(); };
  // One half of a cloven hoof: pointed at the front, by the gap, round at the heel (dir: -1 left, +1 right)
  const half = (cx, dir, top, bot, w) => {
    const L = bot - top;
    x.beginPath();
    x.moveTo(cx - dir * 1.5, top);
    x.bezierCurveTo(cx + dir * w * 0.9, top + L * 0.18, cx + dir * w * 1.05, bot - L * 0.35, cx + dir * w * 0.55, bot);
    x.bezierCurveTo(cx + dir * w * 0.1, bot + 2.5, cx - dir * w * 0.55, bot + 1, cx - dir * w * 0.5, bot - L * 0.25);
    x.bezierCurveTo(cx - dir * w * 0.45, top + L * 0.45, cx - dir * w * 0.25, top + 4, cx - dir * 1.5, top);
    x.closePath();
    x.globalAlpha = 0.72; x.fill();
    x.globalAlpha = 0.95; x.lineWidth = 2; x.stroke();
  };
  const blob = (r0, k, n, alpha) => {
    x.globalAlpha = alpha; x.beginPath();
    for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2, r = r0 + (rnd() - 0.5) * k; i ? x.lineTo(Math.cos(a) * r, Math.sin(a) * r) : x.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    x.closePath(); x.fill();
  };
  // 0 deer: two narrow halves with a gap, tips forward, a slight drag mark behind
  cell(0, () => {
    half(-5.5, -1, -22, 18, 7); half(5.5, 1, -22, 18, 7);
    x.globalAlpha = 0.35; x.lineWidth = 1.5;
    for (const d of [-1, 1]) { x.beginPath(); x.moveTo(d * 4, 21); x.lineTo(d * 3, 27); x.stroke(); }
  });
  // 1 boar: rounder, blunter halves and two dew-claw dots behind
  cell(1, () => { half(-6, -1, -15, 12, 8.5); half(6, 1, -15, 12, 8.5); ellipse(-9.5, 20, 2.6, 3.3, 0.2, 0.85); ellipse(9.5, 20, 2.6, 3.3, -0.2, 0.85); });
  // 2 horse: the shoe's crescent, open at the heel, and a faint frog inside (Batch F)
  cell(2, () => {
    x.globalAlpha = 0.9; x.lineWidth = 6.5; x.beginPath(); x.arc(0, 0, 19, 0.68 * Math.PI, 2.32 * Math.PI); x.stroke();
    x.globalAlpha = 0.25; x.beginPath(); x.moveTo(0, -8); x.lineTo(7, 16); x.lineTo(-7, 16); x.closePath(); x.fill();
  });
  // 3 dog: a pad, four toes and their claws (Batch E/F)
  cell(3, () => {
    ellipse(0, 9, 10, 8, 0, 0.85);
    const toes = [[-11, -5, -0.4], [-4, -13, -0.1], [4, -13, 0.1], [11, -5, 0.4]];
    for (const [tx, ty, a] of toes) { ellipse(tx, ty, 4.2, 5.4, a, 0.85); ellipse(tx + Math.sin(a) * 7.5, ty - Math.cos(a) * 7.5, 1.4, 1.8, a, 0.7); }
  });
  // 4 cat: smaller and rounder, no claws
  cell(4, () => { ellipse(0, 8, 8, 6.5, 0, 0.85); for (const [tx, ty] of [[-9, -3], [-3.5, -10], [3.5, -10], [9, -3]]) ellipse(tx, ty, 3.6, 4.2, 0, 0.85); });
  // 5 rabbit: the long hind feet side by side ahead, the small front ones in line behind
  cell(5, () => { ellipse(-6, -8, 4.5, 14, 0.06, 0.8); ellipse(6, -8, 4.5, 14, -0.06, 0.8); ellipse(-1, 14, 3.5, 4.5, 0, 0.8); ellipse(1, 24, 3.5, 4.5, 0, 0.8); });
  // 6 boot: the sole and the heel, with the tread cut out (Batch E)
  cell(6, () => {
    ellipse(0, -9, 10.5, 17, 0, 0.8);
    x.globalAlpha = 0.8; x.beginPath(); x.roundRect(-8, 12, 16, 15, 5); x.fill();
    x.globalCompositeOperation = 'destination-out'; x.globalAlpha = 0.55; x.lineWidth = 1.6;
    for (let y = -22; y <= 24; y += 5) { x.beginPath(); x.moveTo(-12, y); x.lineTo(12, y + 1.5); x.stroke(); }
    x.globalCompositeOperation = 'source-over';
  });
  // 7 a blood drop with its satellites
  cell(7, () => {
    blob(13, 5, 14, 1);
    for (const [a, d, r] of [[0.5, 21, 2.8], [1.15, 25, 1.9], [2.9, 22, 2.2], [3.5, 19, 1.5], [5.2, 23, 2]]) ellipse(Math.cos(a) * d, Math.sin(a) * d, r, r, 0, 0.75);
  });
  // 8 a long drop (flung while running): a ragged splash and the droplets thrown ahead of it, each drawn out that way
  cell(8, () => {
    x.globalAlpha = 1; x.beginPath();
    const N = 18;
    for (let i = 0; i <= N; i++) { const a = (i % N / N) * Math.PI * 2, r = 6.5 + Math.sin(a * 3 + 1) * 1.3 + Math.sin(a * 5) * 0.9, px = Math.cos(a) * r * 0.8, py = 12 + Math.sin(a) * r * (Math.sin(a) < 0 ? 2 : 1); i ? x.lineTo(px, py) : x.moveTo(px, py); }
    x.closePath(); x.fill();
    for (const [cx, cy, rx, ry, al] of [[-3, -8, 1.8, 3.6, 0.95], [4.5, -13, 1.4, 3.2, 0.9], [0.5, -20, 1.2, 2.8, 0.85], [-6.5, -18, 0.9, 1.9, 0.8], [7.5, -2, 1.1, 1.6, 0.8], [-8, 4, 1.2, 1.5, 0.8], [3, -26, 0.8, 1.6, 0.7]]) ellipse(cx, cy, rx, ry, 0, al);
  });
  // 9 a pool: irregular, darker at the centre
  cell(9, () => { blob(23, 7, 26, 0.85); blob(14, 5, 18, 0.95); });
  // 10 pressed grass: the whole cell, opaque (its blades are real geometry: bladesGeometry, all at the cell's centre)
  cell(10, () => { x.globalAlpha = 1; x.fillRect(-CELL / 2, -CELL / 2, CELL, CELL); });
  // 11 scuffed soil: what blood becomes with Settings.v.blood off (no red): kicked earth and a few scratches
  cell(11, () => {
    for (let i = 0; i < 8; i++) ellipse((rnd() - 0.5) * 34, (rnd() - 0.5) * 34, 2 + rnd() * 4, 1.5 + rnd() * 3, rnd() * 3, 0.55);
    x.globalAlpha = 0.7; x.lineWidth = 2;
    for (let i = 0; i < 4; i++) { const sx = (rnd() - 0.5) * 30, sy = (rnd() - 0.5) * 30; x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + (rnd() - 0.5) * 8, sy + 9 + rnd() * 6); x.stroke(); }
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

// ---------- the material: one program for both meshes ----------
const U = { uClkP: { value: 0 }, uClkB: { value: 0 }, uRead: { value: 0 }, uThird: { value: 1 }, uPlayer: { value: new THREE.Vector2() }, uWarm: { value: WARM } };
const VERT_HEAD = `attribute vec4 aData;
attribute float aShade;
uniform float uClkP;
uniform float uClkB;
uniform float uRead;
uniform float uThird;
uniform vec2 uPlayer;
varying float vFade;
varying float vHl;
varying float vRead;
varying float vDry;
varying float vBent;
varying float vShade;
`;
// (aData: atlas cell, born, time to live, flags: 1 highlighted, 2 on the blood clock, 4 red blood that dries, 8 the faint
// print under pressed grass. aShade: the blades are darker at the root, as the tufts)
const VERT_UV = `
#ifdef USE_MAP
  vMapUv = (vMapUv + vec2(mod(aData.x, 4.0), 2.0 - floor(aData.x / 4.0 + 0.001))) * vec2(0.25, 1.0 / 3.0);
#endif`;
const FAINT_K = '0.3';   // (how much fainter the print under pressed grass is)
const R = READ_R.toFixed(1), R0 = (READ_R - 1.5).toFixed(1);
const VERT_BODY = `
  float trFl = floor(aData.w + 0.5);
  float trB = mod(floor(trFl / 2.0), 2.0);
  float trF = clamp((mix(uClkP, uClkB, trB) - aData.y) / max(aData.z, 1.0), 0.0, 1.0);
  vFade = trF < 0.3 ? 1.0 : trF < 0.75 ? mix(1.0, 0.35, (trF - 0.3) / 0.45) : mix(0.35, 0.0, (trF - 0.75) / 0.25);
  vDry = mod(floor(trFl / 4.0), 2.0) * smoothstep(0.0, 0.6, trF);
  vHl = mod(trFl, 2.0);
  vFade *= 1.0 - ${FAINT_K} * step(8.0, trFl) * (1.0 - vHl);
  vShade = aShade;
  vBent = step(9.5, aData.x) * step(aData.x, 10.5);
  vec3 trIp = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float trCd = distance(cameraPosition, trIp);
  float trS = trF < 0.3 ? mix(1.0, min(1.6, max(1.0, trCd / 16.0)), uThird) : 1.0;
  trS = max(trS, vHl * min(mix(2.6, 1.4, vBent), max(1.0, trCd / 9.0)));
  trS = mix(trS, min(trS, 1.4), vBent);
  transformed *= trS;
  vRead = uRead * (1.0 - smoothstep(${R0}, ${R}, distance(trIp.xz, uPlayer)));`;
const FRAG_HEAD = `uniform vec3 uWarm;
varying float vFade;
varying float vHl;
varying float vRead;
varying float vDry;
varying float vBent;
varying float vShade;
`;
// (blood dries from #661610 towards #3a120e: the linear ratio; crouching darkens and firms up; the locked trail keeps a
// floor of opacity while it is not spent, and a warm rim round it, from a blurred look at the same atlas cell)
const FRAG_BODY = `
  float trA = diffuseColor.a;
  diffuseColor.rgb *= vShade * mix(vec3(1.0), vec3(0.32, 0.75, 0.85), vDry);
  diffuseColor.rgb *= 1.0 - max(0.4 * vRead, 0.25 * vHl * (1.0 - vBent));
  diffuseColor.rgb = mix(diffuseColor.rgb, uWarm, 0.45 * vHl * vBent);
  float trH = vHl * min(1.0, vFade * 4.0);
  diffuseColor.a = clamp(max(trA * vFade * (1.0 + 0.6 * vRead), trA * 0.8 * trH), 0.0, 1.0);
  vec2 trL = fract(vMapUv * vec2(4.0, 3.0));
  float trE = min(min(trL.x, 1.0 - trL.x), min(trL.y, 1.0 - trL.y));
  float trR = smoothstep(0.02, 0.4, texture2D(map, vMapUv, 2.5).a) * smoothstep(0.0, 0.12, trE) * (1.0 - smoothstep(0.1, 0.5, trA)) * 0.75 * trH * (1.0 - diffuseColor.a);
  diffuseColor.rgb = (diffuseColor.rgb * diffuseColor.a + uWarm * trR) / max(diffuseColor.a + trR, 1e-4);
  diffuseColor.a += trR;
  if (diffuseColor.a < 0.01) discard;`;
let MAT = null;
function material() {
  if (MAT) return MAT;
  const m = MAT = new THREE.MeshStandardMaterial({ map: paintAtlas(), transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 1, metalness: 0, side: THREE.DoubleSide, forceSinglePass: true });   // (one pass: with two, three.js flips the back faces' normals (dark blades) and switches programs every frame)
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <uv_vertex>', '#include <uv_vertex>' + VERT_UV)
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + VERT_BODY);
    // (the flecks are seen from both sides and lit from above, like the grass tufts: the back face keeps the normal)
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      // (the atlas gives its alpha only: its see-through texels are black, and the filter would bring that black in at the edges)
      .replace('#include <map_fragment>', 'diffuseColor.a *= texture2D(map, vMapUv).a;')
      .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>' + FRAG_BODY)
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'));
  };
  m.customProgramCacheKey = () => 'tracks3d';
  return m;
}
// A flat quad on the ground (cell up = local -z)
function flatGeometry() {
  const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  g.setAttribute('aShade', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(1), 1));
  return g;
}
// A patch of grass pressed over along local +x (the way of travel): BLADES blades rooted around the hoof, each bent low and
// lying forward, narrowing to its tip, a ribbon seen from above and a low blade from the side. Normals up, like the tufts
const BLADES = 15;
function bladesGeometry() {
  let a = 4177;
  const rnd = () => ((a = (a * 16807) % 2147483647) / 2147483647), pos = [], uv = [], sh = [], idx = [];
  for (let i = 0; i < BLADES; i++) {
    const th = rnd() * Math.PI * 2, r = 0.03 + Math.sqrt(rnd()) * 0.12, bx = Math.cos(th) * r - 0.06, bz = Math.sin(th) * r;
    const L = 0.11 + rnd() * 0.11, h = 0.35 + rnd() * 0.4, turn = (rnd() - 0.5) * 0.7, c = Math.cos(turn), sn = Math.sin(turn), w = 0.008 + rnd() * 0.005, tone = 0.86 + rnd() * 0.28;
    const base = pos.length / 3;
    // (along the blade: how far forward, how high (a share of the patch's height), its half width and its shade)
    for (const [f, y, k, s] of [[0, 0, 0.7, 0.5], [0.38, h, 1, 0.85], [0.75, h * 0.8, 0.75, 1.05], [1, h * 0.3, 0, 1.15]]) for (const side of [-1, 1]) {
      const px = L * f, pz = w * k * side;
      pos.push(bx + px * c - pz * sn, y, bz + px * sn + pz * c); uv.push(0.5, 0.5); sh.push(s * tone);
    }
    for (let q = 0; q < 3; q++) { const o = base + q * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  }
  const g = new THREE.BufferGeometry(), n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aShade', new THREE.Float32BufferAttribute(sh, 1));
  g.setIndex(idx);
  return g;
}
function instanced(geo, n) {
  const data = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aData', data);
  const m = new THREE.InstancedMesh(geo, material(), n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
  m.count = 0;
  m.frustumCulled = false;   // (two small draw calls; their boxes would change on every rebuild)
  m.matrixAutoUpdate = false;
  m.receiveShadow = true;    // (a print in the shade is as dark as the ground around it)
  m.castShadow = false;
  m.renderOrder = 1;
  m.data = data;
  return m;
}
// (only the part of a buffer that was written goes to the card)
function upload(attr, n) {
  if (attr.clearUpdateRanges) { attr.clearUpdateRanges(); attr.addUpdateRange(0, Math.max(1, n) * attr.itemSize); }
  attr.needsUpdate = true;
}

// Scratch, made once
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), QN = new THREE.Quaternion(), QY = new THREE.Quaternion();
const P = new THREE.Vector3(), SC = new THREE.Vector3(), N = new THREE.Vector3(), C = new THREE.Color();

export class Tracks3D {
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.name = 'tracks';
    view.scene.add(this.group);
    this.flat = instanced(flatGeometry(), FLAT_MAX);
    this.fleck = instanced(bladesGeometry(), FLECK_MAX);
    this.group.add(this.flat, this.fleck);
    this.ver = -1; this.hver = -1; this.red = null; this.shown = false;
    this.at = -1e9; this.bx = NaN; this.bz = NaN;   // (when and where the last rebuild was)
    this.X0 = 0; this.Z0 = 0; this.top = 0;
    this.putFn = i => this.put(i);
    this.CM = new Float32Array(CAP * 16); this.CS = new Uint32Array(CAP); this.CV = new Uint8Array(CAP);   // (the kept matrices of the flat marks, and of the pressed grass: see draw)
    this.CMK = new Float32Array(CAP * 16); this.CSK = new Uint32Array(CAP);
  }
  update(game, scene) {
    const tr = game.tracks;
    const show = !!tr && !tr.off && !!game.world && scene === game.world && game.scene === game.world && !game.indoors && tr.count > 0;
    if (!show) { this.group.visible = false; this.shown = false; return; }
    const target = this.view.cam.target, now = performance.now(), red = Settings.v.blood !== false;
    const moved = !(Math.abs(target.x - this.bx) < STEP && Math.abs(target.z - this.bz) < STEP);
    const dirty = tr.ver !== this.ver || tr.hver !== this.hver || red !== this.red || moved || !this.shown;
    if (dirty && (now - this.at >= EVERY || !this.shown)) this.rebuild(tr, target, red, now);
    this.shown = true;
    this.group.visible = this.flat.count + this.fleck.count > 0;
    U.uClkP.value = tr.clkP; U.uClkB.value = tr.clkB; U.uRead.value = tr.readK; U.uThird.value = CAM.first ? 0 : 1;
    const p = game.player;
    if (p) U.uPlayer.value.set(nearX(p.x, this.X0), p.y);
  }
  // Fill both meshes with the marks within REACH of the camera target (positions near X0: the world wraps in x)
  rebuild(tr, target, red, now) {
    this.at = now; this.bx = target.x; this.bz = target.z;
    this.ver = tr.ver; this.hver = tr.hver; this.red = red;
    const cp = this.view.camera.position;
    this.tr = tr; this.X0 = target.x; this.Z0 = target.z; this.cx = cp.x; this.cy = cp.y; this.cz = cp.z;
    // (bent grass stands over the tufts only where they are whole: beyond the grass LOD or its fade it lies flat as soil)
    this.near2 = Math.min(TUFT_LOD.G0 / Math.max(GRASS.lodK.value, 1e-3), 1e9) ** 2; this.fade2 = GRASS.fade.value.x ** 2;
    this.bentTint = BENT_TINTS[tr.game.world?.gen?.season ?? 1] || BENT_TINTS[1];
    if (!this.top) this.top = tuftLods()[0].userData.top || 0.5;
    this.nf = 0; this.nk = 0;
    tr.each(target.x, target.z, REACH, this.putFn);
    const f = this.flat, k = this.fleck;
    f.count = this.nf; k.count = this.nk;
    if (this.nf) { upload(f.instanceMatrix, this.nf); upload(f.instanceColor, this.nf); upload(f.data, this.nf); }
    if (this.nk) { upload(k.instanceMatrix, this.nk); upload(k.instanceColor, this.nk); upload(k.data, this.nk); }
    this.tr = null;
  }
  put(i) {
    const tr = this.tr, kind = tr.KIND[i];
    if (kind === DEAD) return;
    const s = tr.SURF[i], fl = tr.FL[i], x = nearX(tr.X[i], this.X0), z = tr.Y[i], h = tr.H[i];
    const blood = kind >= K.blood && kind <= K.bloodPool;
    const dx = x - this.cx, dy = h - this.cy, dz = z - this.cz, gx = x - this.X0, gz = z - this.Z0;
    const grassNear = dx * dx + dy * dy + dz * dz <= this.near2 && gx * gx + gz * gz <= this.fade2;
    let cell = kind, tint = SURF_TINT[s], size = SIZE[kind], flags = (tr.HL[i] ? 1 : 0) | (blood ? 2 : 0);
    if (kind === K.bentGrass) {
      // (the pressed blades, only where the tufts stand whole, and under them (the second patch has none) the print)
      if (grassNear) { this.draw(tr, i, kind, K.bentGrass, true, this.bentTint, 1, flags, fl, false, x, h, z); flags |= 8; }
      if (fl & F_SECOND) return;
      cell = tr.SUB[i]; tint = SURF_TINT[S.soil]; size = SIZE[cell];
    } else if (blood) {
      if (this.red) { tint = BLOOD; flags |= 4; } else { cell = SCUFF; size *= 1.5; }
      if (s === S.grass) size *= 1.3;   // (seen between the tufts)
    }
    this.draw(tr, i, kind, cell, false, tint, size * tr.SC[i], flags, fl, blood, x, h, z);
  }
  // One instance of mark i
  draw(tr, i, kind, cell, fleck, tint, size, flags, fl, blood, x, h, z) {
    let mesh, n;
    if (fleck) { if (this.nk >= FLECK_MAX) return; mesh = this.fleck; n = this.nk++; }
    else { if (this.nf >= FLAT_MAX) return; mesh = this.flat; n = this.nf++; }
    C.copy(tint);
    if (fl & F_FLEE && !blood && !fleck) C.multiplyScalar(0.8);   // (dug in deeper: a running animal's prints read darker)
    if (kind === K.bloodPool && blood) C.multiplyScalar(0.7);   // (deep: darker than the drops)
    // (a mark's matrix never changes but for where the world's seam puts it: kept per slot, made again only for a new mark
    // or another way of drawing it, then copied and shifted; this is most of what a rebuild would cost)
    const cm = fleck ? this.CMK : this.CM, cs = fleck ? this.CSK : this.CS, arr = mesh.instanceMatrix.array, o16 = n * 16, c16 = i * 16;
    if (cs[i] !== tr.SEQ[i] || (!fleck && this.CV[i] !== cell)) {
      cs[i] = tr.SEQ[i]; if (!fleck) this.CV[i] = cell;
      this.compose(tr, i, kind, fleck, size, fl, blood, tr.X[i], h, z);
      M.toArray(cm, c16);
    }
    for (let k = 0; k < 16; k++) arr[o16 + k] = cm[c16 + k];
    arr[o16 + 12] += x - tr.X[i];
    mesh.setColorAt(n, C);
    const d = mesh.data.array, o = n * 4;
    d[o] = cell; d[o + 1] = tr.BORN[i]; d[o + 2] = tr.TTL[i]; d[o + 3] = flags;
  }
  // The matrix of mark i into M (at its world x: put shifts it near X0)
  compose(tr, i, kind, fleck, size, fl, blood, x, h, z) {
    const nx = tr.NX[i], nz = tr.NZ[i], ny = Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz));
    QN.setFromUnitVectors(UP, N.set(nx, ny, nz));
    if (fleck) {
      // (pressed along the slope, never taller than the tufts round it; local +x along the way of travel)
      const gh = tr.GH[i] * this.top, k = tr.SC[i] * (fl & F_FLEE ? 1.15 : 1);
      QY.setFromAxisAngle(UP, -tr.YAW[i]);
      P.set(x, h, z); SC.set(k, Math.min(0.11, Math.max(0.05, gh * 0.5)), k);
      M.compose(P, Q.multiplyQuaternions(QN, QY), SC);
    } else {
      // (the cell's up, local -z, along the way of travel; each foot toes out a little)
      const c = Math.cos(tr.YAW[i]), sn = Math.sin(tr.YAW[i]);
      QY.setFromAxisAngle(UP, Math.atan2(-c, -sn) + (kind <= K.boot ? (fl & F_LEFT ? 0.06 : -0.06) : 0));
      Q.multiplyQuaternions(QN, QY);
      const up = blood && tr.SURF[i] === S.grass ? LIFT_GRASS : LIFT;
      P.set(x + nx * up, h + ny * up, z + nz * up);
      SC.set(size * (fl & F_FLEE && !blood ? 1.1 : 1), 1, size);   // (splayed in flight)
      M.compose(P, Q, SC);
    }
  }
  proxies() {
    if (this.proxy) return this.proxy;
    const g = this.proxy = new THREE.Group(), m = instanced(flatGeometry(), 1);
    m.count = 1; m.setMatrixAt(0, M.identity()); m.setColorAt(0, BLOOD);
    g.add(m);
    return g;
  }
}
