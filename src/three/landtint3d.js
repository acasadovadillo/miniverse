// What is the village's, on the ground (docs/planes/PLAN-pueblo-construido.md §4): with build mode (B) on, or the shovel or
// the hoe in hand, the village land within REACH tiles of what is aimed at gets a soft ochre-red wash, and the edge of the
// player's plot a green line; the rest is free to build. Two instanced meshes, laid out again only when the aimed tile, the
// village or the ground changes (nothing per frame otherwise); hidden the rest of the time.
import * as THREE from 'three';
import { inPlot, inBounds } from '../world/village.js';
import { LAND_RGB, PLOT_RGB, landVersion, landAt } from '../ui/landmask.js';

const REACH = 12, MAX = (REACH * 2 + 1) ** 2, LIFT = 0.07;
const DIG_TOOLS = /^(pala|azada)/;
const col = c => new THREE.Color(`rgb(${c.join(',')})`);
export class LandTint {
  constructor(view) {
    this.view = view; this.key = '';
    const quad = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2), edge = new THREE.PlaneGeometry(1, 0.16).rotateX(-Math.PI / 2);
    const mat = c => new THREE.MeshBasicMaterial({ color: col(c), transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.land = new THREE.InstancedMesh(quad, mat(LAND_RGB), MAX);
    this.plot = new THREE.InstancedMesh(edge, mat(PLOT_RGB), MAX * 2);
    this.plot.material.opacity = 0.85;
    for (const m of [this.land, this.plot]) { m.count = 0; m.visible = false; m.renderOrder = 4; m.frustumCulled = false; m.matrixAutoUpdate = false; view.scene.add(m); }
  }
  // The tile it is about, or null: build mode's cursor, or what is aimed at with a shovel or a hoe, on the overworld
  focus(game, scene) {
    if (!game.player || scene !== game.world || game.mode !== 'play') return null;
    if (game.build?.on) return game.build.target?.() || null;
    const held = game.inv?.held?.id || '';
    return DIG_TOOLS.test(held) ? game.aimTile?.() || null : null;
  }
  update(game, scene) {
    const at = this.focus(game, scene);
    const show = !!at && (inBounds(at[0] + 0.5, at[1] + 0.5) || inPlot(at[0], at[1]) || this.nearLand(at));
    this.land.visible = this.plot.visible = show;
    if (!show) return;
    const key = `${at[0]},${at[1]}|${landVersion()}|${scene.touches ?? 0}`;
    if (key === this.key) return;
    this.key = key;
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    let n = 0, e = 0;
    const h = (x, y) => this.view.groundY(scene, x, y) + LIFT;
    for (let ty = at[1] - REACH; ty <= at[1] + REACH; ty++) for (let tx = at[0] - REACH; tx <= at[0] + REACH; tx++) {
      if (Math.hypot(tx - at[0], ty - at[1]) > REACH) continue;
      const kind = landAt(tx, ty);
      if (kind === 2) {
        // (the plot's edge: a strip along each side that meets what is not the plot)
        for (const [dx, dy, rot] of [[0, -0.46, 0], [0, 0.46, 0], [-0.46, 0, 1], [0.46, 0, 1]]) {
          if (landAt(tx + Math.sign(dx), ty + Math.sign(dy)) === 2 || e >= this.plot.instanceMatrix.count) continue;
          const x = tx + 0.5 + dx, y = ty + 0.5 + dy;
          Q.setFromAxisAngle(Y, rot ? Math.PI / 2 : 0); P.set(x, h(x, y), y); M.compose(P, Q, S); this.plot.setMatrixAt(e++, M);
        }
      } else if (kind === 1 && !scene.at?.('floor', tx, ty)) {
        const x = tx + 0.5, y = ty + 0.5;
        Q.identity(); P.set(x, h(x, y), y); M.compose(P, Q, S); this.land.setMatrixAt(n++, M);
      }
    }
    this.land.count = n; this.plot.count = e;
    this.land.instanceMatrix.needsUpdate = this.plot.instanceMatrix.needsUpdate = true;
  }
  // (just outside the village and the plot, the wash still shows where the village begins)
  nearLand(at) { for (let d = 1; d <= REACH; d += 3) for (const [i, j] of [[d, 0], [-d, 0], [0, d], [0, -d]]) if (inBounds(at[0] + i + 0.5, at[1] + j + 0.5) || inPlot(at[0] + i, at[1] + j)) return true; return false; }
}
