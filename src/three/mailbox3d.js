// The village mailbox by the plaza (model 'village:mailbox'): a rural mailbox of pressed sheet metal on a wooden post.
// The box is a tunnel (flat bottom, straight sides, a round top) with its ends rolled, two pressed ribs round it, a closed
// back with its seam and, in front (+z), the door: a cap a little larger than the box, hinged at the bottom on a rod,
// with a small latch at the top. On its right side (+x), the red flag on its rivet, raised. It sits on a mounting board
// carried by a square post set in the ground and a diagonal brace.
//
// Everything goes into the village meshes like any other model: three materials of its own (the box's paint and the
// flag's: painted metal, the colour a little uneven, worn where metal really wears, on the rolled ends, the door's rim
// and the bottom edges, down to the grey metal and a little rust; and the weathered wood of the post, darker where it
// goes into the ground) and the iron in the shared one. The geometry is made once (getModel caches the model). Sizes in
// metres, the ground at y = 0; texture coordinates in metres (the paint texture is 0.5 m across, the wood grain runs
// along each piece, 0.4 m a repeat).
import * as THREE from 'three';
import { Builder, mat } from './geo.js';
import { wood } from './textures.js';
import { apagado } from '../arte.js';

// The box (a standard rural mailbox, a little larger: 19 cm wide, 23 cm tall, 49 cm long), the top at 1.155 m
const BOX = { w: 0.095, yb: 0.926, yc: 1.06, rc: 0.012, z0: -0.236, z1: 0.25 };
const POST = { z: -0.06, s: 0.09, top: 0.9, foot: -0.3 };

// ---------- the paint ----------
// Painted sheet metal seen up close: the colour a little uneven, fine grain, a few chips down to the grey metal (each
// with its dark edge), small rust spots and light scratches. Tileable; 256 px are 0.5 m (2 mm a pixel)
function paintTex(base, seed, chips) {
  const N = 256, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  let s = seed >>> 0;
  const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  // (whatever is drawn near an edge is drawn again on the other side: the texture tiles without a seam)
  const wrap = (x, y, r, fn) => { for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) if (x + dx > -r && x + dx < N + r && y + dy > -r && y + dy < N + r) fn(x + dx, y + dy); };
  g.fillStyle = base; g.fillRect(0, 0, N, N);
  // the uneven colour: soft light and dark patches
  for (let i = 0; i < 70; i++) {
    const x = R() * N, y = R() * N, r = 12 + R() * 40, dark = R() < 0.6, a = 0.035 + R() * 0.05;
    wrap(x, y, r, (X, Y) => {
      const gr = g.createRadialGradient(X, Y, 0, X, Y, r);
      gr.addColorStop(0, dark ? `rgba(20,16,12,${a})` : `rgba(255,250,240,${a * 0.7})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(X - r, Y - r, r * 2, r * 2);
    });
  }
  // rust spots, under the chips
  for (let i = 0; i < chips * 0.3; i++) {
    const x = R() * N, y = R() * N, r = 2 + R() * 6;
    wrap(x, y, r, (X, Y) => {
      const gr = g.createRadialGradient(X, Y, 0, X, Y, r);
      gr.addColorStop(0, 'rgba(104,56,30,.4)'); gr.addColorStop(0.6, 'rgba(96,52,30,.16)'); gr.addColorStop(1, 'rgba(90,50,30,0)');
      g.fillStyle = gr; g.fillRect(X - r, Y - r, r * 2, r * 2);
    });
  }
  // chips: small ragged shapes of bare grey metal with a dark rim
  for (let i = 0; i < chips; i++) {
    const x = R() * N, y = R() * N, r = 0.6 + R() ** 3 * 4, k = 5 + Math.floor(R() * 4), pts = [];
    for (let j = 0; j < k; j++) { const a = (j / k) * Math.PI * 2, q = r * (0.5 + R() * 0.7); pts.push([Math.cos(a) * q, Math.sin(a) * q * (0.6 + R() * 0.6)]); }
    const metal = R() < 0.6 ? '#767873' : '#5f4c3c';
    wrap(x, y, r + 2, (X, Y) => {
      const path = (o, sc) => { g.beginPath(); pts.forEach(([a, b], j) => (j ? g.lineTo : g.moveTo).call(g, X + a * sc + o, Y + b * sc + o)); g.closePath(); };
      path(0.5, 1.2); g.fillStyle = 'rgba(25,20,16,.3)'; g.fill();
      path(0, 1); g.fillStyle = metal; g.fill();
    });
  }
  // light scratches
  g.lineCap = 'round';
  for (let i = 0; i < 18; i++) {
    const x = R() * N, y = R() * N, a = R() * Math.PI, l = 6 + R() * 22, dx = Math.cos(a) * l, dy = Math.sin(a) * l;
    wrap(x, y, l, (X, Y) => { g.strokeStyle = `rgba(200,200,195,${0.12 + R() * 0.18})`; g.lineWidth = 0.6; g.beginPath(); g.moveTo(X, Y); g.lineTo(X + dx, Y + dy); g.stroke(); });
  }
  // the fine grain of the paint
  const im = g.getImageData(0, 0, N, N), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// The weathered wood: the grain finer than the photo's (0.4 m a repeat), grey-brown like the fences after some winters
function oldWood() {
  const t = wood(apagado('#7c6a56'));
  t.repeat.set(2.5, 2.5);
  return t;
}
// The paints and the wood (made the first time the mailbox is drawn: models.js modelMat)
export const MAIL_MATS = {
  mailBody: () => mat({ map: paintTex(apagado('#46638a'), 11, 3), vertexColors: true, metalness: 0.15, roughness: 0.5 }),
  mailFlag: () => mat({ map: paintTex(apagado('#b83c30'), 23, 2), metalness: 0.15, roughness: 0.42 }),
  mailWood: () => mat({ map: oldWood(), vertexColors: true, roughness: 0.85 }),
};

// ---------- the sheet metal ----------
// The box's cross-section, grown by e all round: points [x, y], their outward normals and the length along the outline
// (for the texture). Every corner is rounded, so each point has one normal and the whole outline shades smooth
function outline(e, arcSeg = 18, cornerSeg = 3) {
  const w = BOX.w + e, yb = BOX.yb - e, yc = BOX.yc, rc = BOX.rc + e, out = [];
  const add = (x, y, nx, ny) => out.push({ p: [x, y], n: [nx, ny] });
  add(0, yb, 0, -1);
  for (let i = 0; i <= cornerSeg; i++) { const a = -Math.PI / 2 + (i / cornerSeg) * (Math.PI / 2); add(w - rc + Math.cos(a) * rc, yb + rc + Math.sin(a) * rc, Math.cos(a), Math.sin(a)); }
  for (let i = 0; i <= arcSeg; i++) { const a = (i / arcSeg) * Math.PI; add(Math.cos(a) * w, yc + Math.sin(a) * w, Math.cos(a), Math.sin(a)); }
  for (let i = 0; i <= cornerSeg; i++) { const a = Math.PI + (i / cornerSeg) * (Math.PI / 2); add(-w + rc + Math.cos(a) * rc, yb + rc + Math.sin(a) * rc, Math.cos(a), Math.sin(a)); }
  add(0, yb, 0, -1);
  let L = 0;
  out.forEach((o, i) => { if (i) L += Math.hypot(o.p[0] - out[i - 1].p[0], o.p[1] - out[i - 1].p[1]); o.s = L; });
  return out;
}
// (with its tone: the sheet a little dirtier toward its foot, where the rain splashes and the dust sticks, and a little
// faded on top by the sun; wear 0 to 1: the paint worn off there, down to the grey metal with a little rust)
const WORN = [2.3, 1.05, 0.5];
function vtx(B, p, n, uv, wear = 0) {
  const i = B.pos.length / 3, t = Math.min(1, Math.max(0, (p[1] - BOX.yb) / (BOX.yc + BOX.w - BOX.yb))), s = t * t * (3 - 2 * t), k = 0.8 + 0.27 * s;
  B.pos.push(p[0], p[1], p[2]); B.nor.push(n[0], n[1], n[2]); B.uv.push(uv[0], uv[1]);
  B.col ||= [];
  const c = [k * (1 + 0.02 * s), k * (0.98 + 0.03 * s), k * (0.95 + 0.02 * s)];
  B.col.push(...c.map((v, j) => v * (1 - wear) + WORN[j] * k * wear));
  return i;
}
// A length of the box's section from z0 to z1, grown by e, with both ends rolled (radius b0 at the back, b1 at the
// front: the section shrinks by up to b while it turns to face along z) and closed by a flat face. One piece of sheet
// metal: the box, the door, the seam at the back, a rib
function tunnel(B, e, z0, z1, b0, b1, ringSeg = 3, wear = 0.7) {
  const pr = outline(e), rings = [];
  // (the rings along z: [z, how much the section shrinks, the normal's share along z]); the back end turns to -z
  for (let k = ringSeg; k >= 0; k--) { const f = (k / ringSeg) * (Math.PI / 2); rings.push([z0 + b0 - b0 * Math.sin(f), b0 * (1 - Math.cos(f)), -Math.sin(f)]); }
  for (let k = 0; k <= ringSeg; k++) { const f = (k / ringSeg) * (Math.PI / 2); rings.push([z1 - b1 + b1 * Math.sin(f), b1 * (1 - Math.cos(f)), Math.sin(f)]); }
  const at = (o, d) => [o.p[0] - o.n[0] * d, o.p[1] - o.n[1] * d];
  // (the wear: on the rolled ends, most on their very edge, and along the bottom corners)
  const ids = rings.map(([z, d, nz]) => {
    const c = Math.sqrt(1 - nz * nz), w = wear * Math.abs(nz) ** 3;
    return pr.map(o => { const [x, y] = at(o, d), low = o.n[1] < -0.2 && Math.abs(o.n[0]) > 0.2 ? 0.25 : 0; return vtx(B, [x, y, z], [o.n[0] * c, o.n[1] * c, nz], [o.s - d, z], Math.min(1, w + low * wear)); });
  });
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < pr.length - 1; i++) {
    const a = ids[r][i], b = ids[r][i + 1], c = ids[r + 1][i + 1], d = ids[r + 1][i];
    B.idx.push(a, b, c, a, c, d);
  }
  // the flat ends: the worn rim (a band 1.5 cm wide) and inside it a fan from the middle of the section (it is convex),
  // with its paint whole
  for (const [end, d, nz] of [[z0, b0, -1], [z1, b1, 1]]) {
    const n = [0, 0, nz], mid = vtx(B, [0, (BOX.yb + BOX.yc) / 2, end], n, [0, (BOX.yb + BOX.yc) / 2]);
    const ring = pr.map(o => { const [x, y] = at(o, d); return vtx(B, [x, y, end], n, [x, y], wear * 0.8); });
    const inner = pr.map(o => { const [x, y] = at(o, d + 0.015); return vtx(B, [x, y, end], n, [x, y]); });
    const tri3 = (a, b, c) => (nz > 0 ? B.idx.push(a, b, c) : B.idx.push(a, c, b));
    for (let i = 0; i < pr.length - 1; i++) { tri3(mid, inner[i], inner[i + 1]); tri3(inner[i], ring[i], ring[i + 1]); tri3(inner[i], ring[i + 1], inner[i + 1]); }
  }
}

// ---------- wood ----------
// A bar along x with its edges worn round (the wood grain runs along it), made once per size
const BARS = new Map();
function barGeo(len, a, b, r) {
  const k = `${len.toFixed(3)}:${a}:${b}:${r}`;
  let g = BARS.get(k);
  if (!g) { const B = new Builder(); B.roundBox(-len / 2, -a / 2, -b / 2, len / 2, a / 2, b / 2, r); BARS.set(k, (g = B.geometry())); }
  return g;
}
// A bar from p0 to p1 (its section a × b; twist: turned round its own length), into the wood's builder with its tone:
// the wood a little uneven from piece to piece, and darker toward the ground (damp and earth) below the height dampY
const X = new THREE.Vector3(1, 0, 0);
function bar(m, p0, p1, a, b, r = 0.007, { twist = 0, tone = 1, dampY = -9 } = {}) {
  const d = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]), len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(X, d.normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(X, twist));
  const M = new THREE.Matrix4().compose(new THREE.Vector3((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2), q, new THREE.Vector3(1, 1, 1));
  const g = barGeo(len, a, b, r), P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(M);
  const B = m.B('mailWood'), off = B.pos.length / 3;
  B.col ||= [];
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i).applyMatrix4(M); B.pos.push(v.x, v.y, v.z);
    const k = tone * (0.55 + 0.45 * Math.min(1, Math.max(0, (v.y - dampY) / 0.16)));
    B.col.push(k, k * 0.97, k * 0.93);
    v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); B.nor.push(v.x, v.y, v.z);
    B.uv.push(U.getX(i), U.getY(i));
  }
  for (let i = 0; i < g.index.count; i++) B.idx.push(g.index.getX(i) + off);
}

// ---------- the flag ----------
let FLAG;
function flagGeo() {
  if (FLAG) return FLAG;
  // (in its own plane: x toward the back of the box, y up, the rivet at the origin)
  const s = new THREE.Shape(), aw = 0.011;
  s.moveTo(-aw, 0); s.absarc(0, 0, aw, Math.PI, Math.PI * 2, false);
  s.lineTo(aw, 0.172); s.lineTo(0.098, 0.172); s.quadraticCurveTo(0.104, 0.172, 0.104, 0.178);
  s.lineTo(0.104, 0.236); s.quadraticCurveTo(0.104, 0.242, 0.098, 0.242); s.lineTo(-aw + 0.004, 0.242); s.quadraticCurveTo(-aw, 0.242, -aw, 0.238);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.0035, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0012, bevelSegments: 1, curveSegments: 6 });
  // (the uvs of the faces in metres already; a quarter turn so it lies against the +x side, facing out)
  g.rotateY(Math.PI / 2);
  return (FLAG = g);
}

// ---------- the mailbox ----------
// The door's latch: a small tab of the same sheet, rounded, that sticks out at the top of the door
let LATCH;
function latchGeo() {
  if (LATCH) return LATCH;
  const B = new Builder();
  B.roundBox(-0.02, -0.004, 0, 0.02, 0.004, 0.024, 0.0035);
  return (LATCH = B.geometry());
}
export function mailbox(m) {
  const { w, yb, yc, z0, z1 } = BOX, top = yc + w;
  // The box: the body, the rolled seam at the back, two pressed ribs and the door in front
  const P = m.B('mailBody');
  tunnel(P, 0, z0, z1, 0.008, 0.004, 3, 0.4);
  tunnel(P, 0.004, z0 - 0.004, z0 + 0.012, 0.005, 0.005, 3, 0.6);
  for (const z of [-0.085, 0.095]) tunnel(P, 0.0028, z - 0.008, z + 0.008, 0.006, 0.006, 2, 0.3);
  tunnel(P, 0.0065, z1 - 0.014, z1 + 0.012, 0.004, 0.007, 3, 0.85);
  m.solids.push([-w - 0.007, yb - 0.007, z0 - 0.004, w + 0.007, top + 0.007, z1 + 0.012]);
  // The door's hardware: the hinge rod along its foot with two knuckles, and the latch at the top
  const zf = z1 + 0.012;
  m.cyl('iron', w + 0.004, yb - 0.005, zf - 0.002, 0.004, 0.004, 2 * w + 0.008, 8, [0, 0, Math.PI / 2]);
  for (const x of [-0.06, 0.06]) m.cyl('iron', x + 0.017, yb - 0.005, zf - 0.002, 0.0072, 0.0072, 0.034, 10, [0, 0, Math.PI / 2]);
  m.geo('mailBody', latchGeo(), 0, top - 0.03, zf - 0.002, [-0.5, 0, 0]);
  // The flag, raised, on its rivet near the back of the right side
  const fy = yb + 0.07, fz = -0.13;
  m.cyl('iron', w - 0.002, fy, fz, 0.011, 0.011, 0.011, 12, [0, 0, -Math.PI / 2]);
  m.geo('mailFlag', flagGeo(), w + 0.006, fy, fz);
  m.cyl('iron', w + 0.0095, fy, fz, 0.006, 0.005, 0.006, 8, [0, 0, -Math.PI / 2]);
  // The mounting board, the post and the brace (weathered wood, the grain along each piece)
  bar(m, [0, yb - 0.0145, z0 - 0.012], [0, yb - 0.0145, z1 + 0.004], 0.026, 0.15, 0.005, { tone: 1.1 });
  bar(m, [0, POST.foot, POST.z], [0, POST.top, POST.z], POST.s, POST.s, 0.008, { dampY: -0.04 });
  const b0 = [0, 0.69, POST.z + POST.s / 2 - 0.025], b1 = [0, yb - 0.008, 0.17];
  bar(m, b0, b1, 0.042, 0.038, 0.006, { tone: 0.95 });
  // (the bolt that holds the brace: its head and its nut, one on each side of the post)
  m.cyl('iron', POST.s / 2 - 0.001, 0.71, POST.z + 0.01, 0.009, 0.009, 0.006, 8, [0, 0, -Math.PI / 2]);
  m.cyl('iron', -POST.s / 2 + 0.001, 0.71, POST.z + 0.01, 0.009, 0.009, 0.006, 8, [0, 0, Math.PI / 2]);
}
