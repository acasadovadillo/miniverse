// The horse cart while it is driven, and the collar of the horse put to it (Plan R4-5; the logic: ../cart.js; the parked
// cart is a model of the world, models.js BUILD.cart). Driven, it hangs from the root of its driver's model (actors.js
// placeCart): the body as models.js draws it ('cart:<ids>:<f>:d', its geometries shared with every cart like it) and its two
// wheels, which turn by the distance its axle goes (cartPose.roll). The collar is a padded oval of leather round the base of
// the horse's neck, resting on its shoulders, with its two hames and a brass knob; it hangs from the horse's body (it
// follows the gait), made once per horse model and shown while the horse is put to a cart (driven, or standing in the
// shafts of a parked one). About 250 triangles.
import * as THREE from 'three';
import { modelMeshes } from './carry3d.js';
import { cartSize } from './models.js';
import { M } from './shapes.js';

export function cartDriven(key) {
  const S = cartSize(), g = new THREE.Group();
  g.rotation.order = 'YXZ';
  g.add(modelMeshes(key));
  const wheels = [-1, 1].map(sd => { const w = modelMeshes('cart_wheel'); w.position.set(sd * S.TRACK, S.WHEEL_R, 0); g.add(w); return w; });
  g.userData.wheels = wheels; g.userData.key = key;
  return g;
}
// The wheels, turned by roll (rad: + forwards)
export function rollCart(g, roll) { for (const w of g.userData.wheels) w.rotation.x = roll; }

const COLLAR = { at: 0.23, r: 1.0, tube: 0.32, tall: 1.4 };   // (tube: the pad's thickness, of the ring's radius)
let GEO = null;
function geos() {
  if (GEO) return GEO;
  const pad = new THREE.TorusGeometry(1, COLLAR.tube, 6, 18), hame = new THREE.TorusGeometry(1.24, 0.11, 5, 10, Math.PI * 0.8), knob = new THREE.SphereGeometry(0.022, 6, 4);
  return (GEO = { pad, hame, knob });
}
let MATS = null;
const mats = () => (MATS ||= { leather: M('#3f2618', { roughness: 0.8 }), wood: M('#a07a48', { roughness: 0.6 }), brass: M('#b8913e', { metalness: 0.6, roughness: 0.4 }) });
// Show (or hide) the collar on a horse's model (horseModel's root: its userData has body and neck)
export function setCollar(root, on) {
  const u = root?.userData;
  if (!u?.body || !u.neckAt) return;
  if (!on) { if (u.collar) u.collar.visible = false; return; }
  if (!u.collar) {
    const N = u.neckAt, G = geos(), T = mats(), c = new THREE.Group();
    const dy = N.y1 - N.y0, dz = N.z1 - N.z0, L = Math.hypot(dy, dz), axis = new THREE.Vector3(0, dy / L, dz / L);
    c.position.set(0, N.y0 + dy * COLLAR.at, N.z0 + dz * COLLAR.at);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
    const R = N.r * COLLAR.r, ring = new THREE.Group();
    ring.scale.set(R * Math.max(1, N.w / 0.26), R * COLLAR.tall, R);
    const pad = new THREE.Mesh(G.pad, T.leather); ring.add(pad);
    c.add(ring);
    // (the hames: a curved bar down each side of it, in the ring's frame, and the knob at the top where they meet)
    for (const sd of [-1, 1]) {
      const h = new THREE.Mesh(G.hame, T.wood);
      h.rotation.z = sd > 0 ? -Math.PI * 0.4 : Math.PI * 0.6;   // (its arc, 0.8 π, centred on its side)
      h.position.z = 0.15;
      ring.add(h);
    }
    const k = new THREE.Mesh(G.knob, T.brass); k.position.set(0, R * COLLAR.tall * 1.3, 0.03); c.add(k);
    c.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.shared = true; } });
    u.body.add(c);
    u.collar = c;
  }
  u.collar.visible = true;
}
