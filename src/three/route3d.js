// The marked route on the ground (Plan J §2.7): one thin ribbon from 2 m behind the feet to about 70 m ahead, along
// route.pts, with soft dashes flowing toward the pin. One mesh, one draw call, at most MAX_VERTS vertices.
//
// Hook (engine.js render(), one line right after fx.update): routeGround(view3d, game, scene, t). With no route it returns
// at once and makes nothing (no mesh, no program). The mesh is made on the first frame with a drawable route (one with a
// known stretch: a 'straight' or all-unknown path draws nothing); its program goes through View3D.gate (compiled in
// parallel, the ribbon shows once it is ready), so there is no hitch and nothing in the precompile list.
// Hidden at once with ?rutasuelo=0, in grid scenes (caves), off the world scene and while the route is 'straight'.
// Faded out (0.6 s) indoors, in dialogue, in build mode, dead or as a spectator, without a route (arrived, cleared) and after
// STILL_S standing still; Tab held (and SHOW.all after it) or the full HUD keep it on while still.
//
// RouteView: constructor(view3d) adds its mesh to view3d.scene; update(game, scene, t) rebuilds the strip only after
// REBUILD m of progress, a new route.version, a scene change or REFRESH_S seconds, at most about 0.3 ms; otherwise it
// only moves uniforms. The ground heights of each section are kept between rebuilds (by the section's index on the
// path's grid, checked against its exact position), so a rebuild reads the ground only for the new sections ahead and a
// rotating 1/REFRESH_PART of the others (1/REFRESH_STILL on a timed rebuild): blocks that finish loading, digs and
// builds are picked up within a few rebuilds. hide() hides it at once; dispose() frees the geometry and the material.
// Geometry: the path sampled every STEP m of its own arc length (a grid fixed to the path, so two rebuilds give the same
// points where they overlap: no shimmer), from BEHIND m behind the player's nearest point to AHEAD m ahead; corners
// rounded by SMOOTH passes of a [1 2 1]/4 filter (the limit of Chaikin's corner cutting, but with a fixed vertex count and
// the arc length kept for the dashes), run over PAD more samples on each side than are drawn, so a section comes out
// the same in every rebuild that draws it; WIDTH m wide; each edge at view3d.groundY + LIFT, the higher of the centre and a
// sample SIDE m out on its side, so it never digs into a cross slope; over water (natural, or a flooded dig) WATER_Y + LIFT.
// Unknown stretches (routegrid.js KIND.unknown at either end of a segment) have no strip: a gap, each side fading over one
// step. Dots instead of dashes where the strip is over water (the same ground test that lifts it to WATER_Y): wading,
// swimming and rowing, exact even on a long string-pulled segment whose two ends have different kinds; on a bridge, dashes.
// Material: MeshBasicMaterial (unlit, fog), transparent, a cream core with a thin dark rim (RIM_DARK, RIM_A), no depth write, polygon offset −2, drawn after the water
// (renderOrder 3, like fx.js's marks); front side up only, so from under the water it is not seen. In the shader: dashes
// flowing at FLOW m/s toward the pin (aS is metres along the path), fade in from the feet over 1.5 m (uFrom, the player's
// arc position, moved every frame between rebuilds) and out over the last FADE_FAR m when the strip is cut by AHEAD (over
// the last step at the pin), opacity 0.55 by day and 0.7 at night, the HUD cream times the scene's light (it never glows).
import * as THREE from 'three';
import { apagada } from '../opciones.js';
import { WATER_Y } from './terrain.js';
import { nearX } from '../world/planet.js';
import { KIND } from '../world/routegrid.js';
import { hud } from '../ui/hud.js';
import { lightAt } from './look.js';

export const MAX_VERTS = 320, WIDTH = 0.32, LIFT = 0.08, STEP = 0.5, BEHIND = 2, AHEAD = 70, REBUILD = 1.5, FLOW = 1.4;
export const OFF = apagada('rutasuelo');
// (seconds standing still before it fades; a rebuild at least this often while shown; the far fade, the side sample and
// the smoothing passes; seconds to fade in and out)
export const STILL_S = 10, REFRESH_S = 5, FADE_FAR = 15, SIDE = 0.25, SMOOTH = 4, FADE_IN = 0.4, FADE_OUT = 0.6;
const SECTS = MAX_VERTS >> 1;                 // (cross sections: two vertices each)
const PAD = SMOOTH + 1;                       // (samples smoothed beyond each drawn end: the filter's reach, and one for the normal)
const HCAP = 512;                             // (the ground heights kept, by section index on the path's grid; > SECTS + 2 * PAD)
const REFRESH_PART = 16, REFRESH_STILL = 4;   // (a rebuild reads again 1/16 of the kept heights; a timed rebuild 1/4)
const DASH = 1.6, DOT = 0.7, WRAP = 11.2;     // (dash and dot periods in m; the flow offset wraps at a common multiple)
// (a thin dark rim on each side of the cream core, as the map line has its outline: it keeps the ribbon readable on snow
// and sand, where cream alone vanishes; RIM_DARK of the cream, at RIM_A of the core's opacity. Dots over water have none)
const RIM_DARK = 0.25, RIM_A = 0.8;
const WINDOW_BACK = 24, WINDOW_AHEAD = 64;    // (segments searched round the last nearest one between rebuilds)
const JUMP = 20;                              // (a move longer than this between frames: search the whole path again)
const CREAM = new THREE.Color('#efe2bf'), OPACITY = 0.55, OPACITY_NIGHT = 0.7;
// The ribbon is unlit (one cheap program), so it takes the scene's light by hand: its colour times how bright the sky
// and the sun are now against a clear noon (look.js), eased by LIGHT_EXP so it stays readable at night, never below
// LIGHT_MIN. Like the ground it lies on, it darkens at dusk, at night and in rain: it never glows
const LIGHT_EXP = 0.75, LIGHT_MIN = 0.15;
const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const NOON = (() => { const L = lightAt(0, 0, 0); return lum(L.hemiC) + lum(L.sun); })();

const VERT_HEAD = 'attribute float aS;\nattribute vec2 aK;\nattribute float aV;\nvarying float vS;\nvarying vec2 vK;\nvarying float vV;\n';
const FRAG_HEAD = `uniform float uFrom, uFar, uFarFade, uShift, uVis;
varying float vS;
varying vec2 vK;
varying float vV;
`;
// (vK.x: 1 dotted (wading, swimming); vK.y: 0 at the ends of a stretch next to a gap)
const FRAG_ALPHA = `
  float flowS = vS - uShift;
  float ph = fract(flowS / ${DASH.toFixed(2)});
  float dash = smoothstep(0.0, 0.16, ph) * (1.0 - smoothstep(0.46, 0.62, ph));
  float av = abs(vV);
  float core = 1.0 - smoothstep(0.4, 0.58, av);
  float rim = smoothstep(0.4, 0.58, av) * (1.0 - smoothstep(0.84, 1.0, av));
  float lineA = (0.5 + 0.5 * dash) * (core + rim * ${RIM_A.toFixed(2)});
  float pd = (fract(flowS / ${DOT.toFixed(2)}) - 0.5) * ${DOT.toFixed(2)};
  float dots = 1.0 - smoothstep(0.075, 0.115, length(vec2(pd, vV * ${(WIDTH / 2).toFixed(3)})));
  float routeA = mix(lineA, dots, step(0.5, vK.x));
  routeA *= smoothstep(uFrom + 0.25, uFrom + 1.5, vS) * (1.0 - smoothstep(uFar - uFarFade, uFar, vS)) * vK.y * uVis;
  diffuseColor.a *= routeA;
  diffuseColor.rgb *= mix(mix(${RIM_DARK.toFixed(2)}, 1.0, core), 1.0, step(0.5, vK.x));
`;

export class RouteView {
  constructor(view) {
    this.view = view;
    const g = (this.geom = new THREE.BufferGeometry());
    this.pos = new Float32Array(MAX_VERTS * 3);
    this.sArr = new Float32Array(MAX_VERTS);
    this.kArr = new Float32Array(MAX_VERTS * 2);
    const across = new Float32Array(MAX_VERTS);
    for (let i = 0; i < MAX_VERTS; i++) across[i] = i & 1 ? -1 : 1;   // (left edge +1, right edge −1)
    this.idx = new Uint16Array((SECTS - 1) * 6);
    const dyn = a => a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', (this.aPos = dyn(new THREE.BufferAttribute(this.pos, 3))));
    g.setAttribute('aS', (this.aS = dyn(new THREE.BufferAttribute(this.sArr, 1))));
    g.setAttribute('aK', (this.aK = dyn(new THREE.BufferAttribute(this.kArr, 2))));
    g.setAttribute('aV', new THREE.BufferAttribute(across, 1));
    g.setIndex((this.aIdx = dyn(new THREE.BufferAttribute(this.idx, 1))));
    g.setDrawRange(0, 0);
    const U = (this.U = { uFrom: { value: 0 }, uFar: { value: 0 }, uFarFade: { value: FADE_FAR }, uShift: { value: 0 }, uVis: { value: 0 } });
    const m = (this.mat = new THREE.MeshBasicMaterial({ color: CREAM.clone(), transparent: true, opacity: OPACITY, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_HEAD)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvS = aS; vK = aK; vV = aV;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
        .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\n' + FRAG_ALPHA);
    };
    m.customProgramCacheKey = () => 'route-ribbon';
    const mesh = (this.mesh = new THREE.Mesh(g, m));
    mesh.name = 'route-ribbon';
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;   // (one small draw call; its box would change on every rebuild)
    mesh.matrixAutoUpdate = false;   // (the vertices are in world coordinates: the mesh never moves)
    mesh.castShadow = mesh.receiveShadow = false;
    view.scene.add(mesh);
    // (the program, in parallel before the first frame that shows it: View3D.gate; until then nothing is shown. gate
    // compiles what is visible, so it is visible for that call only)
    this.compiled = !view.gate;
    if (view.gate) { mesh.visible = true; try { view.gate(mesh, () => { this.compiled = true; }); } finally { mesh.visible = false; } }
    mesh.visible = false;
    // Scratch, made once: the sampled centre line (x, y in the path's frame), arc lengths, kinds, and the smoothing buffer
    const NS = SECTS + 2 * PAD + 1;
    this.cx = new Float64Array(NS); this.cy = new Float64Array(NS);
    this.tx = new Float64Array(NS); this.ty = new Float64Array(NS);
    this.cs = new Float32Array(NS); this.ck = new Uint8Array(NS); this.ci = new Int32Array(NS);   // (ci: the grid index, -1 for the pin)
    // (the kept ground: per slot k & (HCAP - 1), the grid index, the exact centre and shift it was read at, and the
    // heights of the centre and the two edges with the wet flag)
    this.hK = new Int32Array(HCAP).fill(-1); this.hX = new Float64Array(HCAP); this.hY = new Float64Array(HCAP); this.hSh = new Float64Array(HCAP);
    this.hL = new Float32Array(HCAP); this.hR = new Float32Array(HCAP); this.hW = new Uint8Array(HCAP);
    this.timed = false;
    this.cum = new Float64Array(0);   // (arc length at each path point; grown when a longer path comes)
    this.n = 0;                       // (sections in the strip now)
    this.ver = -1; this.sceneOf = null; this.seg = 0; this.lenOf = 0;
    this.bx = 0; this.by = 0; this.bAt = -1e9;   // (where and when the last rebuild was)
    this.S = 0; this.dirX = 1; this.dirY = 0; this.shift = 0;   // (the player's arc position then, the path's way there)
    this.lx = this.ly = this.lx0 = this.ly0 = NaN; this.stillT = 0; this.lastT = -1;
    this.vis = 0; this.muted = false;   // (muted: the bench's on/off measure)
    this.stats = { rebuilds: 0, ms: 0, lastMs: 0, maxMs: 0, verts: 0, reads: 0 };   // (reads: sections whose ground was read)
  }

  // Shown now? Everything that hides it softly (the hard cases are in routeGround)
  wants(game, now) {
    const r = game.route, p = game.player;
    if (!r?.active || !p || game.dying || game.gamemode === 'spectator' || game.scene !== game.world) return false;
    if (game.indoors || game.busy || hud.dialogOpen || game.build?.on) return false;
    if (this.stillT < STILL_S) return true;
    const sh = game.smartHud;   // (the full HUD keeps it on; the minimal one with Tab held and a moment after)
    return !sh || sh.held || (sh.allUntil || 0) > now;
  }

  update(game, scene, t) {
    if (this.muted) { this.hide(); return; }   // (the bench's off half: nothing drawn and nothing done)
    const p = game.player, r = game.route, now = performance.now() / 1000;
    const dt = this.lastT < 0 ? 0 : Math.min(0.25, now - this.lastT);
    this.lastT = now;
    if (p) {   // (standing still: real time, and a new path shows again)
      const moved = Math.hypot(p.x - this.lx, p.y - this.ly);
      this.lx = p.x; this.ly = p.y;
      this.stillT = moved > 0.004 || !(moved >= 0) ? 0 : this.stillT + dt;
    }
    if (r && r.version !== this.ver) this.stillT = 0;
    const want = this.wants(game, now);
    if (want && p) {
      const moved = r.version !== this.ver || scene !== this.sceneOf || Math.hypot(p.x - this.bx, p.y - this.by) > REBUILD;
      if (moved || now - this.bAt > REFRESH_S) { this.timed = !moved; this.rebuild(game, scene, now); }
    }
    // (fading in or out; out, the strip stays as it was until it is gone)
    const on = want && this.n > 1 && this.compiled;
    this.vis = on ? Math.min(1, this.vis + dt / FADE_IN) : Math.max(0, this.vis - (dt || 1) / FADE_OUT);
    if (!(this.vis > 0)) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    const U = this.U, night = Math.max(0, Math.min(1, this.view.night || 0));
    U.uVis.value = this.vis;
    U.uShift.value = (t * FLOW) % WRAP;
    // (the player's arc position between rebuilds: the step since then along the path's way there)
    if (p) U.uFrom.value = this.S + (nearX(p.x, this.bx) - this.bx) * this.dirX + (p.y - this.by) * this.dirY;
    this.mat.opacity = OPACITY + (OPACITY_NIGHT - OPACITY) * night;
    const v = this.view, lit = (v.hemi ? lum(v.hemi.color) * v.hemi.intensity : 0) + (v.sun ? lum(v.sun.color) * v.sun.intensity : 0);
    const k = v.hemi ? Math.max(LIGHT_MIN, Math.min(1, Math.pow(lit / NOON, LIGHT_EXP))) : 1;
    this.mat.color.copy(CREAM).multiplyScalar(k);
  }

  // The strip, made again round where the player is now
  rebuild(game, scene, now) {
    const t0 = performance.now(), r = game.route, p = game.player, P = r.pts, np = P.length >> 1, K = r.kinds;
    const newPath = r.version !== this.ver;
    if (newPath || scene !== this.sceneOf) this.hK.fill(-1);   // (the kept ground belongs to one path in one scene)
    this.ver = r.version; this.sceneOf = scene; this.bx = p.x; this.by = p.y; this.bAt = now;
    this.n = 0;
    if (np < 2 || r.state === 'straight') { this.finish(0, t0); return; }
    // Arc lengths, once per path
    if (newPath) {
      if (this.cum.length < np) this.cum = new Float64Array(Math.max(np, this.cum.length * 2, 64));
      const C = this.cum;
      C[0] = 0;
      for (let i = 1; i < np; i++) C[i] = C[i - 1] + Math.hypot(P[2 * i] - P[2 * i - 2], P[2 * i + 1] - P[2 * i - 1]);
      this.lenOf = C[np - 1];
    }
    // The player's nearest point: round the last one, or along the whole path after a new path or a jump
    const C = this.cum, len = this.lenOf, ox = P[0], px = nearX(p.x, ox), py = p.y;   // (px: the player in the path's frame)
    const whole = newPath || !(Math.hypot(p.x - this.lx0, p.y - this.ly0) <= JUMP) || !(this.seg < np - 1);
    this.lx0 = p.x; this.ly0 = p.y;
    const i0 = whole ? 0 : Math.max(0, this.seg - WINDOW_BACK), i1 = whole ? np - 1 : Math.min(np - 1, this.seg + WINDOW_AHEAD);
    let best = Infinity, seg = 0, S = 0;
    for (let i = i0; i < i1; i++) {
      const ax = P[2 * i], ay = P[2 * i + 1], dx = P[2 * i + 2] - ax, dy = P[2 * i + 3] - ay, L2 = dx * dx + dy * dy;
      const u = L2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
      const ex = ax + dx * u - px, ey = ay + dy * u - py, d2 = ex * ex + ey * ey;
      if (d2 < best) { best = d2; seg = i; S = C[i] + (C[i + 1] - C[i]) * u; }
    }
    this.seg = seg; this.S = S;
    { const dx = P[2 * seg + 2] - P[2 * seg], dy = P[2 * seg + 3] - P[2 * seg + 1], L = Math.hypot(dx, dy) || 1; this.dirX = dx / L; this.dirY = dy / L; }
    this.shift = p.x - px;   // (path frame → drawn frame: the scene draws near the player, nearX)
    // Sections on the path's own STEP grid, from BEHIND behind to AHEAD ahead (and one at the pin if it falls short),
    // plus PAD on each side (as far as the path goes) that are smoothed but not drawn
    const s0 = Math.max(0, S - BEHIND), s1 = Math.min(len, S + AHEAD);
    if (!(s1 - s0 > STEP * 0.5)) { this.finish(0, t0); return; }
    const k0 = Math.ceil(s0 / STEP - 1e-6);
    let k = Math.max(0, k0 - PAD), j = seg;
    while (j > 0 && C[j] > k * STEP) j--;
    const X = this.cx, Y = this.cy, Sx = this.cs, Kx = this.ck, Ix = this.ci, a0 = k0 - k;
    let m = 0, n = 0;
    const put = (s, kk) => {
      while (j < np - 2 && C[j + 1] < s) j++;
      const sl = C[j + 1] - C[j], u = sl > 1e-9 ? Math.max(0, Math.min(1, (s - C[j]) / sl)) : 0;
      X[m] = P[2 * j] + (P[2 * j + 2] - P[2 * j]) * u; Y[m] = P[2 * j + 1] + (P[2 * j + 3] - P[2 * j + 1]) * u;
      Sx[m] = s; Kx[m] = Math.max(K[j] ?? KIND.unknown, K[j + 1] ?? KIND.unknown); Ix[m] = kk;
      m++;
    };
    const sEnd = Math.min(len, s1 + PAD * STEP);
    for (; m < a0 + SECTS + PAD && k * STEP <= sEnd + 1e-6; k++) { put(k * STEP, k); if (k * STEP <= s1 + 1e-6 && m - a0 <= SECTS) n = m - a0; }
    const cut = s1 < len - 1e-3;   // (cut by AHEAD, not ending at the pin)
    if (sEnd >= len - 1e-3 && k * STEP > sEnd + 1e-6 && m < Sx.length && (!m || len - Sx[m - 1] > 0.05)) {   // (the pin, where the path ends)
      put(len, -1);
      if (!cut && m - a0 <= SECTS) n = m - a0;
    }
    if (n < 2) { this.finish(0, t0); return; }
    this.U.uFar.value = Sx[a0 + n - 1];
    this.U.uFarFade.value = cut || n >= SECTS ? FADE_FAR : STEP;
    this.smooth(m);
    this.n = n;
    this.finish(this.fill(game, scene, a0, n, m), t0);
  }

  // Rounded corners: SMOOTH passes of [1 2 1]/4 inside each known stretch, its ends where they are
  smooth(n) {
    const X = this.cx, Y = this.cy, Kx = this.ck, TX = this.tx, TY = this.ty, U = KIND.unknown;
    for (let pass = 0; pass < SMOOTH; pass++) {
      for (let i = 0; i < n; i++) { TX[i] = X[i]; TY[i] = Y[i]; }
      for (let i = 1; i < n - 1; i++) {
        if (Kx[i] === U || Kx[i - 1] === U || Kx[i + 1] === U) continue;
        X[i] = (TX[i - 1] + 2 * TX[i] + TX[i + 1]) * 0.25; Y[i] = (TY[i - 1] + 2 * TY[i] + TY[i + 1]) * 0.25;
      }
    }
  }

  // The vertices and the triangles of the n sections from sample a0 (of m samples); returns how many indices
  fill(game, scene, a0, n, m) {
    const v = this.view, X = this.cx, Y = this.cy, Sx = this.cs, Kx = this.ck, Ix = this.ci, U = KIND.unknown, sh = this.shift;
    const pos = this.pos, kk = this.kArr, ss = this.sArr, idx = this.idx, hw = WIDTH / 2;
    const HK = this.hK, HX = this.hX, HY = this.hY, HS = this.hSh, HL = this.hL, HR = this.hR, HW = this.hW;
    const part = this.timed ? REFRESH_STILL : REFRESH_PART, turn = this.stats.rebuilds % part;
    let wet = false;
    const surf = (x, y) => {   // (the ground as drawn, or the water's surface over water: natural, or a flooded dig; wet says which)
      const h = v.groundY(scene, x, y);
      wet = false;
      if (!(h < WATER_Y)) return h;
      const tx = Math.floor(x), ty = Math.floor(y), D = scene.digH?.(tx, ty);
      wet = D === null || D === undefined || scene.floodAt?.(tx, ty) !== undefined;
      return wet ? WATER_Y : h;
    };
    let q = 0;
    for (let i = 0; i < n; i++) {
      const p = a0 + i, known = Kx[p] !== U;   // (p: the sample; its neighbours may be outside the drawn sections)
      const a = p > 0 && Kx[p - 1] !== U ? p - 1 : p, b = p < m - 1 && Kx[p + 1] !== U ? p + 1 : p;
      let dx = X[b] - X[a], dy = Y[b] - Y[a];
      if (a === b) { dx = p < m - 1 ? X[p + 1] - X[p] : X[p] - X[p - 1]; dy = p < m - 1 ? Y[p + 1] - Y[p] : Y[p] - Y[p - 1]; }
      const L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;   // (to the left of the way)
      const x = X[p] + sh, y = Y[p], o = i * 6;
      let yl = 0, yr = 0, dot = 0;
      if (known) {
        // (the kept heights of this grid section, if it is exactly where they were read and not its turn to be read again)
        const gk = Ix[p], slot = gk & (HCAP - 1);
        if (gk >= 0 && HK[slot] === gk && HX[slot] === X[p] && HY[slot] === Y[p] && HS[slot] === sh && gk % part !== turn) {
          yl = HL[slot]; yr = HR[slot]; dot = HW[slot];
        } else {
          const hc = surf(x, y);
          dot = wet ? 1 : 0;
          yl = Math.max(hc, surf(x + nx * SIDE, y + ny * SIDE)) + LIFT;
          yr = Math.max(hc, surf(x - nx * SIDE, y - ny * SIDE)) + LIFT;
          if (gk >= 0) { HK[slot] = gk; HX[slot] = X[p]; HY[slot] = Y[p]; HS[slot] = sh; HL[slot] = yl; HR[slot] = yr; HW[slot] = dot; this.stats.reads++; }
        }
      }
      pos[o] = x + nx * hw; pos[o + 1] = yl; pos[o + 2] = y + ny * hw;
      pos[o + 3] = x - nx * hw; pos[o + 4] = yr; pos[o + 5] = y - ny * hw;
      ss[2 * i] = ss[2 * i + 1] = Sx[p];
      // (next to a gap, the strip's end fades over one step; the strip's own two ends fade in the shader)
      const edge = known && (p === 0 || Kx[p - 1] !== U) && (p === m - 1 || Kx[p + 1] !== U) ? 1 : 0;
      kk[4 * i] = kk[4 * i + 2] = dot; kk[4 * i + 1] = kk[4 * i + 3] = edge;
      if (i > 0 && known && Kx[p - 1] !== U) {
        const l0 = 2 * (i - 1), r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
        idx[q++] = l0; idx[q++] = l1; idx[q++] = r0;
        idx[q++] = r0; idx[q++] = l1; idx[q++] = r1;
      }
    }
    // (only what changed goes up to the graphics card)
    upload(this.aPos, n * 6); upload(this.aS, n * 2); upload(this.aK, n * 4); upload(this.aIdx, q);
    return q;
  }

  finish(q, t0) {
    this.geom.setDrawRange(0, q);
    if (!q) this.n = 0;
    const S = this.stats, ms = performance.now() - t0;
    S.rebuilds++; S.ms += ms; S.lastMs = ms; S.maxMs = Math.max(S.maxMs, ms); S.verts = this.n * 2;
  }

  hide() { this.mesh.visible = false; this.vis = 0; }
  dispose() {
    this.mesh.removeFromParent();
    this.geom.dispose();
    this.mat.dispose();
    if (this.view.routeView === this) this.view.routeView = null;
  }
}

function upload(A, count) {
  if (!count) return;
  if (A.clearUpdateRanges) { A.clearUpdateRanges(); A.addUpdateRange(0, count); }
  A.needsUpdate = true;
}

// A path with something to draw: not the straight fallback and at least one known stretch (checked once per version)
function drawable(view, r) {
  if (view.routeChecked === r.version) return view.routeDrawable;
  view.routeChecked = r.version;
  let ok = false;
  if (r.state !== 'straight') for (let i = 1; i < r.kinds.length && !ok; i++) ok = r.kinds[i] !== KIND.unknown && r.kinds[i - 1] !== KIND.unknown;
  return (view.routeDrawable = ok);
}

// The per-frame hook (see above). view: the View3D; scene: the scene being drawn (game.scene or the menu world)
export function routeGround(view, game, scene, t) {
  const r = game.route, rv = view.routeView;
  if (!r || (!rv && (!r.active || !drawable(view, r)))) return;
  if (OFF || scene !== game.scene || scene.kind === 'grid' || (r.active && r.state === 'straight')) { rv?.hide(); return; }
  (view.routeView ||= new RouteView(view)).update(game, scene, t);
}
