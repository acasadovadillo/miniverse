// The skin of the new creator (plan CR, P2): its tones and its layers. The layers are painted by the skin's shader
// (person.js) from where each point is on the face (vertex attribute `face`: across in head halves, up from the nose's tip
// in decimetres) and on the body, so they follow any face and cost no texture: freckles, moles, a scar, vitiligo, blush,
// kohl and a simple tattoo, each with its strength and, some, its colour. They live in look.mh.skin (all optional).

// The tones: from very light to very dark, rosy and olive ones between (look.skin keeps the hex, as before)
export const SKIN_TONES = [
  '#e8c4b0', '#e2b99c', '#d8b292', '#d6a88e', '#c99d7b', '#bf9270', '#b38b66', '#a97c58',
  '#9c714c', '#8f6444', '#82583b', '#775538', '#684230', '#5a3929', '#4c3024', '#40281f', '#35211a',
];
// The nearest tone of the palette (an old look's colour, by how the eye tells colours apart: lightness first)
export function nearestTone(hex) {
  const rgb = h => [1, 3, 5].map(i => parseInt(String(h).slice(i, i + 2), 16) || 0);
  const [r, g, b] = rgb(hex);
  let best = SKIN_TONES[4], bd = Infinity;
  for (const t of SKIN_TONES) {
    const [R, G, B] = rgb(t), dl = (0.3 * (r - R) + 0.59 * (g - G) + 0.11 * (b - B)), d = dl * dl * 3 + (r - R) ** 2 * 0.3 + (g - G) ** 2 * 0.4 + (b - B) ** 2 * 0.3;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

export const SCARS = ['none', 'cheek', 'brow', 'lip', 'eye'];
export const TATTOOS = ['none', 'forehead', 'chin', 'cheeks', 'neck'];
export const BLUSH_COLOURS = ['#d8706a', '#c85a5a', '#e08a7a', '#b85a6a', '#c8784a'];
export const KOHL_COLOURS = ['#1c1612', '#2a2238', '#1e2a3a', '#3a2418', '#24342a'];
export const TATTOO_COLOURS = ['#2a3a4a', '#1c1c22', '#3a2a5a', '#5a2a2a', '#2a4a3a'];

// The layers' numbers for the shader: lay1 (freckles, moles, vitiligo, blush), lay2 (kohl, scar strength, tattoo
// strength, scar), lay3 (tattoo, seed); the moles where the seed puts them, on the face
export function layerUniforms(U, sk = {}) {
  const k = v => Math.max(0, Math.min(100, Number(v) || 0)) / 100;
  U.lay1.value.set(k(sk.freckles), k(sk.moles), k(sk.vitiligo), k(sk.blush));
  U.lay2.value.set(k(sk.kohl), sk.scar ? k(sk.scarK ?? 70) : 0, sk.tattoo ? k(sk.tattooK ?? 80) : 0, SCARS.indexOf(sk.scar) > 0 ? SCARS.indexOf(sk.scar) : 0);
  U.lay3.value.set(TATTOOS.indexOf(sk.tattoo) > 0 ? TATTOOS.indexOf(sk.tattoo) : 0, sk.seed || 0, 0, 0);
  U.blushC.value.set(sk.blushC || BLUSH_COLOURS[0]); U.kohlC.value.set(sk.kohlC || KOHL_COLOURS[0]); U.tatC.value.set(sk.tattooC || TATTOO_COLOURS[0]);
  let s = ((sk.seed || 0) * 9301 + 49297) % 233280;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280, n = Math.round(k(sk.moles) * 6);
  for (let i = 0; i < 6; i++) {
    const m = U.moles.value[i];
    if (i >= n) { m.set(0, 0, 0); continue; }
    // (on the cheeks, the jaw, over the lip or by the eye: never on the eye itself, nor on the lips)
    const spots = [[0.55, 0.05], [0.45, -0.3], [0.2, -0.2], [0.6, 0.4], [0.3, -0.55], [0.75, -0.1], [0.15, 0.75], [0.5, 0.75]];
    const [x, y] = spots[Math.floor(rnd() * spots.length)];
    m.set((rnd() < 0.5 ? -1 : 1) * (x + (rnd() - 0.5) * 0.12), y + (rnd() - 0.5) * 0.1, 0.012 + rnd() * 0.014);
  }
}

// The shader's part (GLSL, in the skin's fragment shader): layers(colour, lightness of the photo's detail) gives the colour
// with every layer on. vFace: across (+ is the person's left, head halves), up from the nose's tip and depth from it (dm);
// vZone.w the face's front; vObj the point on the body (metres); eyesF the left eye's place in the same terms
export const skinLayers = `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  vec2 o = vec2(i.z * 17.0, (i.z + 1.0) * 17.0);
  float a = mix(mix(hash12(i.xy + o.x), hash12(i.xy + vec2(1, 0) + o.x), f.x), mix(hash12(i.xy + vec2(0, 1) + o.x), hash12(i.xy + vec2(1, 1) + o.x), f.x), f.y);
  float b = mix(mix(hash12(i.xy + o.y), hash12(i.xy + vec2(1, 0) + o.y), f.x), mix(hash12(i.xy + vec2(0, 1) + o.y), hash12(i.xy + vec2(1, 1) + o.y), f.x), f.y);
  return mix(a, b, f.z);
}
float segd(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float gauss2(vec2 p, vec2 c, vec2 r) { vec2 q = (p - c) / r; return exp(-dot(q, q)); }
vec3 layers(vec3 col, float dl) {
  float front = vZone.w;
  vec2 f = vFace.xy, P = vec2(vFace.x * 0.7, vFace.y), E = vec2(eyesF.x * 0.7, eyesF.y);
  if (lay1.z > 0.0) {   // vitiligo: pale patches anywhere, soft edged
    float n = vnoise3(vObj * 9.0) * 0.65 + vnoise3(vObj * 23.0) * 0.35, t = 0.8 - lay1.z * 0.42;
    col = mix(col, vec3(0.8, 0.6, 0.52) * dl, smoothstep(t, t + 0.035, n));
  }
  if (lay1.x > 0.0) {   // freckles: small dots of the skin's own darker colour over the cheeks and the nose
    float reg = clamp(gauss2(vec2(abs(P.x), P.y), vec2(0.33, 0.1), vec2(0.2, 0.22)) + gauss2(P, vec2(0.0, 0.2), vec2(0.12, 0.22)), 0.0, 1.0) * front;
    vec2 g = vMapUv * 300.0, c = floor(g);
    float r = hash12(c), d = length(fract(g) - (vec2(hash12(c + 3.7), hash12(c + 9.1)) * 0.6 + 0.2));
    float dotm = smoothstep(0.24 + 0.2 * r, 0.05, d) * step(1.0 - lay1.x * 0.75, r);
    col = mix(col, col * vec3(0.55, 0.4, 0.3), dotm * reg * min(1.0, 0.55 + lay1.x));
  }
  for (int i = 0; i < 6; i++) {   // moles
    if (moles[i].z <= 0.0) continue;
    float d = length(vec2((f.x - moles[i].x) * 0.7, f.y - moles[i].y));
    col = mix(col, col * vec3(0.34, 0.25, 0.2), smoothstep(moles[i].z, moles[i].z * 0.45, d) * step(0.3, front) * 0.92);
  }
  if (lay1.w > 0.0) {   // blush on the cheeks
    vec3 bc = blushC / max(max(blushC.r, blushC.g), max(blushC.b, 1e-3));
    float reg = gauss2(vec2(abs(P.x), P.y), vec2(0.36, 0.0), vec2(0.15, 0.12)) * front;
    col *= mix(vec3(1.0), bc * 1.1 + 0.08, reg * lay1.w * 0.55);
  }
  if (lay2.x > 0.0) {   // kohl round the eyes, with a small wing at the outer corner
    vec2 e = vec2(sign(P.x) * abs(E.x), E.y), q = (P - e) / vec2(0.17, 0.075);
    float r = length(q), out_ = (abs(P.x) - abs(E.x));
    float ring = exp(-pow((r - 1.0) / 0.3, 2.0));
    float wing = smoothstep(0.08, 0.16, out_) * (1.0 - smoothstep(0.2, 0.3, out_)) * exp(-pow((P.y - E.y - 0.02 - (out_ - 0.1) * 0.4) / 0.03, 2.0));
    col = mix(col, kohlC * 0.8, clamp(ring + wing, 0.0, 1.0) * front * lay2.x * 0.88);
  }
  int st = int(lay2.w + 0.5);
  if (st > 0 && lay2.y > 0.0) {   // a scar: a pale, pinkish line
    vec2 a = vec2(0.32, 0.06), b = vec2(0.47, -0.3);
    if (st == 2) { a = vec2(abs(E.x) + 0.04, E.y + 0.3); b = vec2(abs(E.x) + 0.09, E.y - 0.02); }
    else if (st == 3) { a = vec2(-0.045, -0.12); b = vec2(-0.03, -0.36); }
    else if (st == 4) { a = vec2(-abs(E.x) - 0.04, E.y + 0.3); b = vec2(-abs(E.x) + 0.01, E.y - 0.22); }
    float sd = segd(P, a, b), s = smoothstep(0.022, 0.008, sd) * front, rim = smoothstep(0.034, 0.022, sd) * (1.0 - s) * front;
    col = mix(col, col * vec3(0.82, 0.7, 0.68), rim * lay2.y * 0.6);
    col = mix(col, col * vec3(1.35, 1.0, 0.95) + vec3(0.05, 0.012, 0.008), s * lay2.y);
  }
  int tt = int(lay3.x + 0.5);
  if (tt > 0 && lay2.z > 0.0) {   // a simple tattoo
    float m = 0.0;
    if (tt == 1) {
      for (int i = 0; i < 3; i++) m = max(m, smoothstep(0.03, 0.02, length(P - vec2(0.0, E.y + 0.42 + 0.12 * float(i)))));
      m = max(m, smoothstep(0.024, 0.015, length(vec2(abs(P.x) - 0.12, P.y - E.y - 0.48))));
      m *= front;
    } else if (tt == 2) {
      for (int i = -1; i <= 1; i++) m = max(m, smoothstep(0.012, 0.006, segd(P, vec2(0.07 * float(i), -0.45), vec2(0.085 * float(i), -0.74))));
      m *= front;
    } else if (tt == 3) {
      vec2 Q = vec2(abs(P.x), P.y);
      m = max(smoothstep(0.011, 0.005, segd(Q, vec2(0.2, 0.06), vec2(0.33, -0.14))), smoothstep(0.011, 0.005, segd(Q, vec2(0.22, -0.04), vec2(0.35, -0.24)))) * front;
    } else {
      m = max(smoothstep(0.014, 0.006, abs(P.y + 1.22)), smoothstep(0.014, 0.006, abs(P.y + 1.32))) * (1.0 - smoothstep(0.55, 0.65, abs(P.x)));
      m = max(m, smoothstep(0.022, 0.014, length(vec2(fract(P.x * 9.0) - 0.5, (P.y + 1.27) * 9.0) / 9.0)) * (1.0 - smoothstep(0.55, 0.65, abs(P.x))));
    }
    col = mix(col, tatC * 0.8, m * lay2.z * 0.85);
  }
  return col;
}
`;
