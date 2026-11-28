// The cloth of the new creator's clothes (plan CR, P3): a material per garment, tinted with its colours, with the weave of
// the cloth (or the grain of leather) in relief, its seams and their stitches, a stitched hem, the folds' shadows, the
// inside a little darker, and the wear of a worn or torn piece (faded patches, a frayed and then ragged hem). The weave and
// the grain are made here, once, by code (no download). The garment's vertex attribute `att` (tools/mh_garments.py) gives
// per vertex: its part (0 its colour, 1 the second), the distance to a seam and to its border (mm) and the occlusion.
import * as THREE from 'three';

// A height map that tiles, made once: N x N, from f(x, y) in 0..1 (x, y in 0..1)
function heightTex(N, f) {
  const px = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = Math.max(0, Math.min(255, Math.round(f(x / N, y / N) * 255))), i = (y * N + x) * 4;
    px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
  }
  const t = new THREE.DataTexture(px, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
let weave = null, grain = null;
// Plain weave: threads over and under, eight each way per tile, a little uneven
function weaveTex() {
  if (weave) return weave;
  const n = 8, jitter = Array.from({ length: n * 2 }, (_, i) => 0.85 + 0.3 * ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1);
  return (weave = heightTex(64, (x, y) => {
    const cx = x * n, cy = y * n, ix = Math.floor(cx), iy = Math.floor(cy), fx = cx - ix, fy = cy - iy;
    const over = (ix + iy) % 2 === 0;   // (warp over weft, or under)
    const warp = Math.sin(Math.PI * fx) * jitter[ix], weft = Math.sin(Math.PI * fy) * jitter[n + iy];
    return 0.15 + 0.7 * (over ? Math.max(warp * (0.6 + 0.4 * Math.sin(Math.PI * fy)), weft * 0.55) : Math.max(weft * (0.6 + 0.4 * Math.sin(Math.PI * fx)), warp * 0.55));
  }));
}
// Leather: a soft cellular grain
function grainTex() {
  if (grain) return grain;
  const pts = [];
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 70; i++) pts.push([rnd(), rnd()]);
  return (grain = heightTex(128, (x, y) => {
    let d1 = 9, d2 = 9;
    for (const [px, py] of pts) {
      const dx = Math.min(Math.abs(x - px), 1 - Math.abs(x - px)), dy = Math.min(Math.abs(y - py), 1 - Math.abs(y - py)), d = dx * dx + dy * dy;
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return Math.min(1, 0.35 + (Math.sqrt(d2) - Math.sqrt(d1)) * 6);
  }));
}

// A garment's material: colour and second colour, leather or cloth
export function clothMaterial({ leather = false } = {}) {
  const U = {
    c1: { value: new THREE.Color('#8a7a6a') }, c2: { value: new THREE.Color('#5a4a3a') }, tear: { value: 0 },
    rep: { value: leather ? 60 : 210 }, bumpK: { value: leather ? 4.0 : 6.0 },
  };
  const m = new THREE.MeshStandardMaterial({ roughness: leather ? 0.55 : 0.93, side: THREE.DoubleSide, bumpMap: leather ? grainTex() : weaveTex(), bumpScale: 1 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 att; varying vec4 vAtt; varying vec2 vCloth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAtt = att; vCloth = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec3 c1, c2; uniform float tear, rep, bumpK; varying vec4 vAtt; varying vec2 vCloth;
float hashC(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noiseC(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hashC(i), hashC(i + vec2(1, 0)), f.x), mix(hashC(i + vec2(0, 1)), hashC(i + vec2(1, 1)), f.x), f.y); }
// (seam in mm, border in mm: the stitches; 1 on a stitch, 0 off)
float stitches() {
  float seam = vAtt.y * 255.0, edge = vAtt.z * 255.0, along = (vCloth.x + vCloth.y) * 260.0;
  float dash = step(0.45, fract(along));
  float s = (1.0 - smoothstep(0.7, 1.3, abs(seam - 2.5))) * dash;
  s = max(s, (1.0 - smoothstep(0.6, 1.2, abs(edge - 9.0))) * step(0.45, fract(vCloth.x * 260.0)));
  return s;
}`)
      .replace('#include <map_fragment>', `
float part = step(0.5, vAtt.x * 255.0);
vec3 col = mix(c1, c2, part);
// (a seam: the cloth folds into it, a little darker; and the stitches over it, of a lighter thread)
float seamD = vAtt.y * 255.0;
col *= mix(0.72, 1.0, smoothstep(0.0, 2.0, seamD));
col = mix(col, col * 1.35 + 0.04, stitches() * 0.8);
// (the folds' shadows, and slow variation of the dye)
col *= vAtt.w * (0.92 + 0.16 * noiseC(vCloth * 9.0));
// (a worn piece: faded, uneven patches; torn: more of them, darker grime)
if (tear > 0.0) {
  float w = noiseC(vCloth * 5.0) * 0.6 + noiseC(vCloth * 13.0) * 0.4;
  col = mix(col, mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))) * 1.25, 0.6), smoothstep(0.62 - 0.12 * tear, 0.75, w));
  if (tear > 1.5) col *= mix(1.0, 0.7, smoothstep(0.5, 0.8, noiseC(vCloth * 7.0 + 3.1)));
}
diffuseColor.rgb *= col;
// (the inside, darker)
if (!gl_FrontFacing) diffuseColor.rgb *= 0.55;`)
      // (a worn hem frays; a torn one is ragged, up to 2 cm in)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
if (tear > 0.0) {
  float edge = vAtt.z * 255.0, rag = tear > 1.5 ? 22.0 : 5.0;
  if (edge < rag * noiseC(vec2(vCloth.x * 90.0, 0.5)) * noiseC(vec2(vCloth.x * 23.0, 7.0)) * 1.6) discard;
}`)
      // (the weave in relief: from the tiling map, at the cloth's own scale, by the screen's derivatives)
      .replace('#include <bumpmap_pars_fragment>', `#ifdef USE_BUMPMAP
uniform sampler2D bumpMap; uniform float bumpScale;
vec2 dHdxy_fwd() {
  float h = bumpScale * bumpK * 0.02 * texture2D(bumpMap, vCloth * rep).x;
  return vec2(dFdx(h), dFdy(h));
}
vec3 perturbNormalArb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz)), vSigmaY = normalize(dFdy(surf_pos.xyz)), vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN), R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
#endif`);
  };
  m.customProgramCacheKey = () => 'mh-cloth' + leather;
  m.userData.U = U;
  return m;
}
