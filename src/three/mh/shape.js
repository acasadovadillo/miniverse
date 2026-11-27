// The shape of a MakeHuman person, made once per look on the CPU (no morphs while drawing): the base mesh plus a linear
// blend of targets, the way MakeHuman's documentation describes its "macro" and face modifiers (our own code, written
// from that concept). Then the bound meshes are fitted on it and the arms are lowered from the base's A pose.
import { target, proxy } from './data.js';

// The look's numbers (look.mh), all optional; sliders are integers -100..100 (age 0..100, 25 to 90 years)
export const BODY_SLIDERS = ['height', 'weight', 'muscle', 'age', 'chest', 'prop'];
export const ORIGINS = ['af', 'as', 'ca'];
const ORIGIN_NAME = { af: 'african', as: 'asian', ca: 'caucasian' };
// (MakeHuman's height goes from a dwarf to a giant: the slider takes the part that keeps doors, beds and the saddle right,
// about 1.55 to 1.80 m for a woman and 1.65 to 1.92 m for a man)
const HEIGHT_K = 0.45;
// (P2: twice MakeHuman's own range for weight, muscle and the face, extrapolating its corners, which are linear; the
// heaviest and strongest still fit a door, a bed and the saddle: a test measures them)
export const RANGE = 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

// The years of a look (age slider 0..100 = 25..90)
export const yearsOf = mh => 25 + clamp(num(mh?.macro?.age, 0), 0, 100) * 0.65;

// What to blend, as [target, weight]: sex x age x muscle x weight corners, the origins, height, proportions and the face
export function weightsFor(D, mh, sex) {
  const m = mh?.macro || {}, out = [], S = sex === 'chico' ? 'male' : 'female';
  const old = clamp((yearsOf(mh) - 25) / 65, 0, 1), ages = [['young', 1 - old], ['old', old]];
  const lv = v => { const x = clamp(num(v) / 100, -1, 1) * RANGE; return [['min', Math.max(0, -x)], ['average', 1 - Math.abs(x)], ['max', Math.max(0, x)]]; };
  let o = ORIGINS.map(k => Math.max(0, num(m[k], k === 'ca' ? 100 : 0)));
  const sum = o.reduce((a, b) => a + b, 0) || 1;
  o = o.map(x => x / sum);
  for (const [age, wa] of ages) {
    if (wa <= 0) continue;
    for (const [mus, wm] of lv(m.muscle)) for (const [wt, ww] of lv(m.weight)) {
      const w = wa * wm * ww;
      if (Math.abs(w) > 1e-4) out.push([`universal-${S}-${age}-${mus}muscle-${wt}weight`, w]);
      // (a woman's chest: MakeHuman's cup, min or max, at this same corner)
      const c = clamp(num(m.chest) / 100, -1, 1);
      if (S === 'female' && c && Math.abs(w) > 1e-4) out.push([`breast-female-${age}-${mus}muscle-${wt}weight-${c > 0 ? 'max' : 'min'}cup-averagefirmness`, w * Math.abs(c)]);
    }
    ORIGINS.forEach((k, i) => { if (o[i] > 1e-4) out.push([`${ORIGIN_NAME[k]}-${S}-${age}`, wa * o[i]]); });
    const h = clamp(num(m.height) / 100, -1, 1), p = clamp(num(m.prop) / 100, -1, 1);
    if (h) out.push([`height-${S}-${age}-averagemuscle-averageweight-${h > 0 ? 'max' : 'min'}height`, wa * Math.abs(h) * HEIGHT_K]);
    if (p) out.push([`prop-${S}-${age}-averagemuscle-averageweight-${p > 0 ? 'ideal' : 'uncommon'}proportions`, wa * Math.abs(p)]);
  }
  const f = mh?.face || {};
  for (const s of D.face) {
    const v = clamp(num(f[s.id]) / 100, -1, 1) * RANGE;
    if (v > 0 && s.pos) out.push([s.pos, v]);
    else if (v < 0 && s.neg) out.push([s.neg, -v]);
  }
  return out;
}

// The blended base (decimetres): every kept vertex, helpers and joint cubes too
export function blend(D, mh, sex) {
  const v = D.pos.slice();
  for (const [name, w] of weightsFor(D, mh, sex)) {
    const t = target(D, name);
    if (!t) continue;
    const { idx, d } = t;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k] * 3;
      v[i] += d[k * 3] * w; v[i + 1] += d[k * 3 + 1] * w; v[i + 2] += d[k * 3 + 2] * w;
    }
  }
  chest(D, v, mh, sex);
  return v;
}

// The chest slider of a man: MakeHuman has no breast targets for men, so the pectorals are a soft bulge of our own
// (a woman's are MakeHuman's cup targets, in weightsFor)
function chest(D, v, mh, sex) {
  const c = clamp(num(mh?.macro?.chest) / 100, -1, 1);
  if (!c || sex !== 'chico') return;
  const amt = c * 0.12, w8 = D.body.chest;
  for (let i = 0; i < w8.length; i++) {
    if (!w8[i]) continue;
    const w = (w8[i] / 255) * amt, x = v[i * 3];
    v[i * 3] += Math.sign(x) * w * 0.18; v[i * 3 + 1] -= w * 0.2; v[i * 3 + 2] += w;
  }
}

// A joint: the mean of its cube's vertices
export function joint(D, v, name) {
  const ids = D.head.joints[name], p = [0, 0, 0];
  for (const i of ids) { p[0] += v[i * 3]; p[1] += v[i * 3 + 1]; p[2] += v[i * 3 + 2]; }
  return p.map(x => x / ids.length);
}

// A bound mesh's vertices on the blended base: the barycentric point on its three base vertices plus its offset, scaled
// by how much the body grew along each axis between the two reference vertices of that axis
export function fit(D, v, name) {
  const P = D.proxies.get(name), d = proxy(D, name);
  if (!d) return null;
  const sc = ['x_scale', 'y_scale', 'z_scale'].map((k, ax) => {
    const s = P.scale[k];
    return s ? Math.abs(v[s[0] * 3 + ax] - v[s[1] * 3 + ax]) / s[2] : 1;
  });
  const n = P.nv, out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = d.refs[i * 3] * 3, b = d.refs[i * 3 + 1] * 3, c = d.refs[i * 3 + 2] * 3, wa = d.w[i * 3], wb = d.w[i * 3 + 1], wc = d.w[i * 3 + 2];
    for (let ax = 0; ax < 3; ax++) out[i * 3 + ax] = wa * v[a + ax] + wb * v[b + ax] + wc * v[c + ax] + d.off[i * 3 + ax] * sc[ax];
  }
  return out;
}

// The arms down from the base's A pose (about 50 degrees under the horizontal) to hanging by the sides, with the rig's
// CC0 weights: the upper arm turns round the shoulder, the forearm and hand round the elbow as well. A bound mesh takes
// the weights of its base vertices
const ARM_DOWN = 0.52, ELBOW = 0.16, FORWARD = -0.06, BEND = -0.18;
function rotZ(p, o, a) { const c = Math.cos(a), s = Math.sin(a), x = p[0] - o[0], y = p[1] - o[1]; return [o[0] + x * c - y * s, o[1] + x * s + y * c, p[2]]; }
function rotX(p, o, a) { const c = Math.cos(a), s = Math.sin(a), y = p[1] - o[1], z = p[2] - o[2]; return [p[0], o[1] + y * c - z * s, o[2] + y * s + z * c]; }
export function armPose(D, v) {
  const out = {};
  for (const side of ['l', 'r']) {
    const sh = joint(D, v, `joint-${side}-shoulder`), el = joint(D, v, `joint-${side}-elbow`), sg = side === 'l' ? -1 : 1;
    const up = p => rotX(rotZ(p, sh, sg * ARM_DOWN), sh, FORWARD);
    out[side] = { up, low: p => up(rotX(rotZ(p, el, sg * ELBOW), el, BEND)) };
  }
  return out;
}
export function poseInPlace(v, n, wUp, wLow, pose) {
  for (let i = 0; i < n; i++) {
    const u = wUp(i), l = wLow(i);
    if (u + l < 1e-3) continue;
    const p = [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]], f = pose[p[0] >= 0 ? 'l' : 'r'];
    const a = f.up(p), b = f.low(p), r = Math.max(0, 1 - u - l);
    for (let ax = 0; ax < 3; ax++) v[i * 3 + ax] = p[ax] * r + a[ax] * u + b[ax] * l;
  }
}

// The expressions of a look (blink, smile, the mouth's shapes…): each MakeHuman expression unit blended by the look's
// origin, as offsets over the kept vertices (decimetres). They are drawn as morphs, so blinking or talking costs no build
export function expressions(D, mh) {
  const m = mh?.macro || {};
  let o = ORIGINS.map(k => Math.max(0, num(m[k], k === 'ca' ? 100 : 0)));
  const sum = o.reduce((a, b) => a + b, 0) || 1;
  o = o.map(x => x / sum);
  return (D.head.expr || []).map(id => {
    const acc = new Map();
    ORIGINS.forEach((k, j) => {
      const t = o[j] > 1e-4 && target(D, `expr.${id}.${ORIGIN_NAME[k]}`);
      if (!t) return;
      for (let n = 0; n < t.idx.length; n++) {
        let a = acc.get(t.idx[n]);
        if (!a) acc.set(t.idx[n], (a = [0, 0, 0]));
        a[0] += t.d[n * 3] * o[j]; a[1] += t.d[n * 3 + 1] * o[j]; a[2] += t.d[n * 3 + 2] * o[j];
      }
    });
    const idx = Uint32Array.from(acc.keys()), d = new Float32Array(idx.length * 3);
    let n = 0;
    for (const a of acc.values()) { d[n * 3] = a[0]; d[n * 3 + 1] = a[1]; d[n * 3 + 2] = a[2]; n++; }
    return { id, idx, d };
  });
}
